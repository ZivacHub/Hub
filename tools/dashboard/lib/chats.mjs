// Chat engine (plan Phase 14, step 14.1). Starts, answers and stops "Hub chats": windowless Claude chats run through the
// `claude` command line. One TURN = one `claude -p --output-format json` process in the project's folder; the task or
// answer goes in on standard input (never on a command line, never through a shell). The engine only ever continues
// session ids it created itself, never sends into a chat that is open anywhere else (docs/reference/CLAUDE_CONTROL.md
// T9 / T13), and logs every action without the text. Contract: docs/plan/phases/14-run-chats-from-the-hub.md.
// Step 14.6: a chat started WITH Remote Control is a background chat (`claude --bg --remote-control <name> ... -- <task>`)
// that stays alive for the phone. `--bg` reads nothing from standard input and ignores `--session-id` (real runs
// 2026-11-16), so for these chats ONLY the task goes on the argument list, after `--` (still no shell), and the session id
// is found in `claude agents --json` by the chat's unique name. Off = `claude stop`, then wait until the list shows no pid.
// Phase 19 (19.9 fork, 19.10 pictures and files; contract docs/plan/phases/19-attachments-fork.md): an answer or a start may
// carry upload ids from lib/uploads.mjs. Pictures and PDFs go as image / document blocks through the stream route (ONE JSON
// line on standard input, `--input-format stream-json --output-format stream-json --verbose`, tests T26 / T29); text files go
// as `@<path>` in the text on the normal route (T28). A fork (`--resume <old> --fork-session --session-id <new>`, T32) makes a
// NEW Hub chat that starts as a copy; the old chat's saved file is only read by Claude, never written.
//   node tools/dashboard/lib/chats.mjs --selftest            pretend claude: fast, uses no Claude allowance
//   node tools/dashboard/lib/chats.mjs --selftest --real     also ONE real round trip (cheapest model, all tools off)
//   node tools/dashboard/lib/chats.mjs --selftest --real-rc  also the real Remote Control checks (cheapest model, all tools off)
import { spawn, spawnSync, execFile, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, openSync, closeSync, readdirSync, renameSync, statSync, rmSync, existsSync, readSync, fstatSync } from "node:fs";
import { join, dirname, resolve, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir, homedir } from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { makeUploads } from "./uploads.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HUB = join(HERE, "..", "..", "..");
const BUSNUS = dirname(HUB);

/** Short model names `claude --model` accepts (help: "an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet')"; haiku proven by a real run 2026-11-16). */
export const MODELS = ["haiku", "sonnet", "opus", "fable"];
const PERMISSION_MODE = "auto"; // D39. A constant on purpose: nothing can switch a Hub chat to a mode that skips the checks.
const MAX_TEXT = 4000;
const ID_RE = /^h-\d{8}-\d{6}-[a-z0-9]{4}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAD_PROJECT = /[&|<>^%"`\/\\\x00-\x1f]/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BG_ID_RE = /^[0-9a-f]{8}$/; // the short id `claude --bg` prints and `claude stop` takes (= the first 8 characters of the session id)
export const RC_ANSWER_REFUSED = "Remote Control is on for this chat: answer it on your phone, or turn Remote Control off here first.";
export const RC_ON_REFUSED = "Remote Control can only be switched on when the chat is started."; // kept for the page; not used while switching on is proven to work
/** Phase 19: plain-words refusals and the fork's fixed first message (all in docs/plan/phases/19-attachments-fork.md). */
export const ATTACH_MESSAGES = {
  notList: "Attachments must be a list of attached files.",
  readFailed: "One of the attached files could not be read, so nothing was sent. Attach it again.",
  noRc: "Files can't be sent to a chat that starts with Remote Control. Start it without Remote Control, or send the files in a later message.",
  workflow: "A new chat that starts with pick up (the project workflow) can't carry files in its first message. Start the chat first and attach the files to your next message, or tick \"Skip the project workflow\".",
  slash: "Files can't go with a / command. Send the command and the files as two messages.",
};
export const FORK_MESSAGES = {
  rc: "Remote Control is on for this chat. Turn it off first, then make the copy.",
  working: "This chat is still working. Wait for it to finish before making a copy.",
  closing: "The stopped chat is still closing. Try again in a few seconds.",
  switching: "This chat is being switched. Try again in a few seconds.",
  noSession: "This chat has no Claude session to copy.",
  cantCheck: "Can't check whether the chat is open elsewhere, so no copy was made.",
  open: "This chat is open somewhere else (the Claude app or a terminal), so no copy was made. Close it there first.",
  name: "The name must be text.",
  sameId: "Claude continued the old chat instead of making a copy, so this copy has no chat of its own.",
};
/** What a fork sends when no first message is given: `claude -p` needs one, and "Continue." could restart the old task. */
export const FORK_FIRST_MESSAGE = "This chat is a copy of an earlier chat, made in the Hub. Reply with one short sentence saying you are ready. Do not do anything else yet.";
const EXT_OF = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "application/pdf": "pdf", "text/plain": "txt", "text/markdown": "md", "text/csv": "csv", "application/json": "json" };

const clip = (s, n) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const pad = (n) => String(n).padStart(2, "0");
const logSafe = (s, n = 40) => String(s ?? "-").replace(/\s+/g, "_").replace(/[^\w.()\-]/g, "?").slice(0, n) || "-";
const stripAnsi = (s) => String(s ?? "").replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "");
const encodeCwd = (p) => String(p).replace(/[^A-Za-z0-9]/g, "-"); // how Claude names a folder's chat-file folder (chatlist.mjs does the same)

/** "What the chat does" for its name (D44): the task's first 5 words (only letters, digits, spaces, dots, dashes), at most 40 characters,
 *  cut at a word boundary. A task starting with "/" shows its command word (/pickup = "Pick up", /handoff = "Hand off") plus up to 3 words. */
const SLASH_NAMES = { pickup: "Pick up", handoff: "Hand off" };
const cleanWords = (s) => String(s ?? "").replace(/[^\p{L}\p{N} .\-]/gu, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
function cutWords(words, max = 40) {
  let out = "";
  for (const w of words) { const n = out ? out + " " + w : w; if (n.length > max) break; out = n; }
  return out || (words[0] ? words[0].slice(0, max) : "");
}
export function whatItDoes(task) {
  const t = String(task ?? "").trim();
  let words;
  if (t.startsWith("/")) {
    const m = /^\/(\S*)\s*([\s\S]*)$/.exec(t);
    const cmd = cleanWords(m[1]).join("");
    if (!cmd) words = [];
    else {
      const head = SLASH_NAMES[cmd.toLowerCase()] || cmd.charAt(0).toUpperCase() + cmd.slice(1);
      words = [...head.split(" "), ...cleanWords(m[2]).slice(0, 3)];
    }
  } else words = cleanWords(t).slice(0, 5);
  return cutWords(words) || "New chat";
}

export function makeChats(opts = {}) {
  const root = opts.root || BUSNUS;
  const dataDir = opts.dataDir || join(HUB, "data");
  const logDir = opts.logDir || join(HUB, "logs");
  const prog = Array.isArray(opts.claude) ? opts.claude.slice() : [opts.claude || "claude"]; // [program, ...first arguments]
  const maxWorking = Number.isInteger(opts.maxWorking) && opts.maxWorking > 0 ? opts.maxWorking : 2; // D41
  const redact = typeof opts.redact === "function" ? opts.redact : (s) => s;
  const noTools = opts.noTools === true; // tests only: every turn runs with `--tools ""` (all tools off)
  const findMs = Number.isInteger(opts.findTimeoutMs) && opts.findTimeoutMs > 0 ? opts.findTimeoutMs : 20000; // wait for a background chat to show / to lose its pid
  const refreshMs = Number.isInteger(opts.rcRefreshMs) && opts.rcRefreshMs > 0 ? opts.rcRefreshMs : 3000; // how old the open list may be for Remote Control chats
  const sessionsDir = opts.sessionsDir || join(homedir(), ".claude", "projects"); // the saved chat files (read-only)
  const statePath = join(dataDir, "hub_chats.json");
  const turnDir = join(dataDir, "chats");
  const image = (() => { const b = basename(prog[0]).toLowerCase(); return process.platform === "win32" && !extname(b) ? b + ".exe" : b; })();
  const uploads = opts.uploads || makeUploads(); // Phase 19: the attached files (the server passes the same store it saves into)
  try { uploads.cleanup(); } catch { /* an old file can wait for the next start */ }

  const listOpen = opts.listOpen || (() => new Promise((done, fail) => {
    execFile(prog[0], [...prog.slice(1), "agents", "--json"], { timeout: 5000, windowsHide: true, maxBuffer: 8 << 20 }, (err, stdout) => {
      if (err) return fail(err);
      try { const v = JSON.parse(stdout); if (!Array.isArray(v)) throw new Error("not a list"); done(v); } catch (e) { fail(e); }
    });
  }));

  function readState() {
    try { const s = JSON.parse(readFileSync(statePath, "utf8")); if (s && typeof s.chats === "object") return { seq: s.seq || 0, chats: s.chats }; } catch { /* none yet */ }
    return { seq: 0, chats: {} };
  }
  function writeState(s) {
    mkdirSync(dataDir, { recursive: true });
    const tmp = statePath + ".tmp";
    writeFileSync(tmp, JSON.stringify(s, null, 2));
    renameSync(tmp, statePath);
  }
  function log(action, id, project, result) {
    try { mkdirSync(logDir, { recursive: true }); appendFileSync(join(logDir, "hub_actions.log"), `${new Date().toISOString()} ${action} ${logSafe(id)} ${logSafe(project)} ${result}\n`); } catch { /* logging must never break an action */ }
  }
  function fail(action, id, project, error) { log(action, id, project, "refused: " + error); return { ok: false, error }; }

  const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
  // Alive AND still the program this engine started (Windows can give a dead process's number to another program).
  function ours(pid) {
    if (!alive(pid)) return false;
    if (process.platform !== "win32") return true;
    const r = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    if (r.status !== 0 || typeof r.stdout !== "string") return true; // could not look: trust the alive check
    const m = r.stdout.match(/^"([^"]+)","(\d+)"/m);
    return !!m && Number(m[2]) === pid && m[1].toLowerCase() === image;
  }

  function projectError(project) {
    if (typeof project !== "string" || !project || project.length > 120 || BAD_PROJECT.test(project) || project === "." || project === "..") return "Unknown project folder.";
    let dirs = [];
    try { dirs = readdirSync(root).filter((d) => { try { return statSync(join(root, d)).isDirectory(); } catch { return false; } }); } catch { /* none */ }
    return dirs.includes(project) ? "" : "Unknown project folder.";
  }
  const cleanText = (t) => (typeof t === "string" ? t.trim() : "");
  const textOk = (t) => t.length >= 1 && t.length <= MAX_TEXT;

  function newId() {
    const d = new Date(); const a = "abcdefghijklmnopqrstuvwxyz0123456789";
    const r = [...randomBytes(4)].map((b) => a[b % 36]).join("");
    return `h-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${r}`;
  }

  // ---------- reading a finished turn ----------
  function readResult(file) {
    let text = "";
    try { text = readFileSync(file, "utf8"); } catch { return { lines: [] }; }
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const at = lines[i].indexOf("{");
      if (at < 0) continue;
      try { const o = JSON.parse(lines[i].slice(at)); if (o && o.type === "result") return { result: o, lines }; } catch { /* not the result line */ }
    }
    return { lines };
  }
  function refusedLines(denials) {
    if (!Array.isArray(denials)) return [];
    return denials.slice(0, 10).map((d) => {
      const tool = d && typeof d.tool_name === "string" ? d.tool_name : "A tool";
      const inp = d && d.tool_input && typeof d.tool_input === "object" ? d.tool_input : {};
      const what = inp.command || inp.file_path || inp.path || inp.url || inp.pattern || "";
      return clip(what ? `${tool}: ${String(what).replace(/\s+/g, " ")}` : `${tool} was refused`, 160);
    });
  }
  /** Fill a chat from its last turn's output file. Returns true when a result was found. */
  function applyTurn(c) {
    const { result: r, lines } = readResult(c.turnFile);
    c.lastTurnAt = new Date().toISOString();
    const forkTurn = c.forkPending === true; delete c.forkPending;
    if (!r) { c.state = "failed"; c.lastError = clip(lines.length ? lines[lines.length - 1] : "The chat ended without a reply.", 600); c.refused = []; return false; }
    if (forkTurn && r.session_id === c.forkedFromSession) { // never adopt the old chat's id: answering would write into the old chat
      c.state = "failed"; c.lastError = FORK_MESSAGES.sameId; c.sessionId = null; c.refused = []; log("chat-fork", c.id, c.project, "failed: no copy was made");
      return true;
    }
    if (typeof r.session_id === "string" && UUID_RE.test(r.session_id)) {
      if (c.sessionId && r.session_id !== c.sessionId) log("chat-session", c.id, c.project, "Claude reported another session id; using it");
      c.sessionId = r.session_id;
    }
    const text = typeof r.result === "string" ? r.result : "";
    c.refused = refusedLines(r.permission_denials);
    if (r.is_error === true || (r.subtype && r.subtype !== "success")) {
      c.state = "failed"; c.lastError = clip(text || String(r.subtype || "") || "The chat ended with an error.", 600);
    } else { c.state = "idle"; c.lastReply = clip(text, 1400); c.lastError = ""; }
    return true;
  }
  /** Settle every turn whose process has ended. Cheap: no process is started. */
  function settle(st) {
    let changed = false;
    for (const c of Object.values(st.chats)) {
      if (c.remoteControl && !c.sessionId && !acting.has(c.id)) { // a background start that never finished (the Hub was closed meanwhile)
        Object.assign(c, { remoteControl: false, state: "failed", lastError: "The background chat did not start.", pid: null }); changed = true;
        log("chat-end", c.id, c.project, "failed: background start never finished"); continue;
      }
      if (c.state !== "working" || c.remoteControl || alive(c.pid)) continue; // Remote Control chats follow the open list instead
      applyTurn(c); changed = true;
      log("chat-end", c.id, c.project, c.state);
    }
    if (changed) writeState(st);
    return st;
  }
  // Busy turns: running -p turns, busy Remote Control chats, and background chats still starting.
  const working = (st) => Object.values(st.chats).filter((c) => c.state === "working" && (alive(c.pid) || (c.remoteControl && !c.sessionId && acting.has(c.id)))).length;
  const busyMessage = () => `${maxWorking === 2 ? "Two" : maxWorking} chats are already working. Wait for one to finish.`;

  // ---------- one turn ----------
  /** `o.stream`: the turn carries image / document blocks (T26: stream-json input needs stream-json output and --verbose).
   *  `o.forkFrom`: the old session id this NEW chat starts as a copy of (T32: the old saved file is only read). */
  function turnArgs(c, first, o = {}) {
    const a = ["-p", "--output-format", "json", "--permission-mode", PERMISSION_MODE, "--permission-prompts", "none"];
    if (o.stream) a.splice(1, 2, "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"); // lib/appanswer.mjs's self-test reads the line above
    if (o.forkFrom) a.push("--resume", o.forkFrom, "--fork-session", "--session-id", c.sessionId, "--name", c.name);
    else if (first) a.push("--session-id", c.sessionId, "--name", c.name); else a.push("--resume", c.sessionId);
    if (c.model) a.push("--model", c.model);
    if (c.noTools) a.push("--tools", ""); // last: --tools takes a list
    return a;
  }
  function launch(c, text, first, o = {}) {
    mkdirSync(turnDir, { recursive: true });
    const file = join(turnDir, `${c.id}-t${(c.turns || 0) + 1}.log`);
    const fd = openSync(file, "w");
    let child;
    try {
      child = spawn(prog[0], [...prog.slice(1), ...turnArgs(c, first, o)], { cwd: join(root, c.project), env: process.env, detached: true, windowsHide: true, shell: false, stdio: ["pipe", fd, fd] });
    } catch (err) { closeSync(fd); return { error: "Could not start Claude: " + err.message }; }
    closeSync(fd);
    child.on("error", (err) => log("chat-error", c.id, c.project, logSafe(err.code || err.message, 60)));
    if (!child.pid) return { error: "Could not start Claude (the claude program was not found)." };
    child.stdin.on("error", () => { /* the process ended before reading: the turn file shows why */ });
    child.stdin.end(text, "utf8");
    child.unref();
    return { pid: child.pid, file };
  }
  // ---------- attached files (Phase 19) ----------
  /** The upload records of one message ({ files: [] } when there are none), or { error }. Only files saved for `chatKey`. */
  function attachList(attachments, chatKey) {
    if (attachments === undefined || attachments === null) return { files: [] };
    if (!Array.isArray(attachments)) return { error: ATTACH_MESSAGES.notList };
    if (!attachments.length) return { files: [] };
    const r = uploads.resolve({ chatKey, uploadIds: attachments });
    return r.ok ? { files: r.files } : { error: r.error };
  }
  const atRef = (p) => { const f = String(p).replace(/\\/g, "/"); return /\s/.test(f) ? `@"${f}"` : `@${f}`; };
  /** What goes on standard input. No pictures / PDFs: the text (text files as `@<path>` lines, T28). Otherwise ONE JSON line
   *  with the image / document blocks first and the text last (T26, T29). Every file is read here, right before sending. */
  function buildMessage(text, files) {
    const blocks = files.filter((f) => f.kind === "image" || f.kind === "pdf");
    const texts = files.filter((f) => f.kind === "text");
    for (const f of texts) { try { if (!statSync(f.path).isFile()) return { error: ATTACH_MESSAGES.readFailed }; } catch { return { error: ATTACH_MESSAGES.readFailed }; } }
    const at = texts.map((f) => atRef(f.path)).join("\n");
    const body = at ? (text ? text + "\n\n" + at : at) : text;
    if (!blocks.length) return { input: body, stream: false };
    const content = [];
    for (const f of blocks) {
      let data;
      try { const b = readFileSync(f.path); if (b.length !== f.bytes || !b.length) throw new Error("changed"); data = b.toString("base64"); } catch { return { error: ATTACH_MESSAGES.readFailed }; }
      content.push({ type: f.kind === "image" ? "image" : "document", source: { type: "base64", media_type: f.kind === "image" ? f.mediaType : "application/pdf", data } });
    }
    if (body) content.push({ type: "text", text: body });
    return { input: JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n", stream: true };
  }
  const filesNote = (files) => (files.length ? ` files ${files.map((f) => EXT_OF[f.mediaType] || "file").join(",")}` : ""); // the log names extensions only

  function beginTurn(c, l) {
    c.state = "working"; c.pid = l.pid; c.turnFile = l.file; c.turns = (c.turns || 0) + 1;
    c.lastTurnAt = new Date().toISOString(); c.lastError = ""; c.refused = [];
  }

  // ---------- background chats with Remote Control (14.6) ----------
  const acting = new Set(); // Hub ids an action is busy with right now (start, switch, stop): the open-list refresh leaves them alone
  let snapAt = 0, refreshing = null;
  const secs = () => Math.round(findMs / 1000);
  const pause = (ms) => new Promise((d) => setTimeout(d, ms));

  /** The open-chats list (`claude agents --json`), or null when it cannot be read. */
  async function readOpen() {
    let timer;
    try {
      const v = await Promise.race([Promise.resolve().then(() => listOpen()), new Promise((_, no) => { timer = setTimeout(() => no(new Error("timeout")), 6000); })]);
      return Array.isArray(v) ? v : null;
    } catch { return null; } finally { clearTimeout(timer); }
  }
  const pidEntry = (open, sid) => (Array.isArray(open) ? open : []).find((e) => e && e.sessionId === sid && e.pid) || null;
  /** Poll the open list until test(list) returns something truthy; null after findMs. */
  async function waitOpen(test, ms = findMs) {
    const t0 = Date.now();
    for (;;) {
      const open = await readOpen();
      if (open) { const r = test(open); if (r) return r; }
      if (Date.now() - t0 >= ms) return null;
      await pause(400);
    }
  }
  /** Run one short claude command (argument list, no shell, nothing on standard input) and collect what it printed. */
  function runCmd(args, cwd, ms = 30000) {
    return new Promise((done) => {
      let out = "", err = "", fin = false, child = null, timer = null;
      const end = (code) => { if (fin) return; fin = true; clearTimeout(timer); setTimeout(() => done({ code, out: stripAnsi(out), err: stripAnsi(err) }), 50); };
      timer = setTimeout(() => { try { if (child) child.kill(); } catch { /* gone */ } end("timeout"); }, ms);
      try { child = spawn(prog[0], [...prog.slice(1), ...args], { cwd, env: process.env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] }); }
      catch { end("spawn"); return; }
      child.stdout.on("data", (d) => { if (out.length < 65536) out += d; });
      child.stderr.on("data", (d) => { if (err.length < 65536) err += d; });
      child.on("error", () => end("spawn"));
      child.on("exit", (code) => end(code));
    });
  }
  const shortIdOf = (out) => (String(out).match(/backgrounded\s*·\s*([0-9a-f]{8})\b/) || [])[1] || null;
  const firstLine = (s) => clip(String(s || "").split(/\r?\n/).map((x) => x.trim()).find(Boolean) || "", 200);
  /** Arguments for a background chat. `bare`: a chat that already ran in the background keeps its saved options (auto mode,
   *  Remote Control, model, tools, name); passing ANY flag there starts a COPY (real run 2026-11-16), so only --resume goes. */
  function bgArgs(c, { task, resume, bare } = {}) {
    if (bare) return ["--bg", "--resume", c.sessionId];
    const a = ["--bg", "--name", c.name, "--remote-control", c.name, "--permission-mode", PERMISSION_MODE];
    if (c.model) a.push("--model", c.model);
    if (resume) a.push("--resume", c.sessionId);
    if (c.noTools) a.push("--tools", "");
    if (task !== undefined) a.push("--", task); // `--` ends the options: the task can never be read as a flag
    return a;
  }
  /** The short id `claude stop` may get for this chat: only one that is the start of the chat's own session id. */
  function stopRef(c, e) {
    const ref = e && typeof e.id === "string" ? e.id : c.bgId;
    return typeof ref === "string" && BG_ID_RE.test(ref) && UUID_RE.test(c.sessionId || "") && c.sessionId.startsWith(ref) ? ref : null;
  }
  /** After a failed background launch: stop what that launch started (its printed short id, or new entries with the chat's unique name). */
  async function cleanupLaunch(short, name, before) {
    const refs = new Set(short ? [short] : []);
    for (const e of (await readOpen()) || []) {
      if (e && e.name === name && typeof e.id === "string" && BG_ID_RE.test(e.id) && typeof e.sessionId === "string" && e.sessionId.startsWith(e.id) && !before.has(e.sessionId)) refs.add(e.id);
    }
    for (const ref of refs) await runCmd(["stop", ref], root);
    if (refs.size) await waitOpen((l) => (l.some((e) => e && e.pid && typeof e.sessionId === "string" && [...refs].some((r) => e.sessionId.startsWith(r))) ? null : true));
  }
  /** `claude stop` this chat (only this one), then wait until the open list shows no pid for it (T12b: continuing earlier makes a copy). */
  async function endBg(c) {
    const open = await readOpen();
    if (!open) return { error: "Can't read the list of running chats, so nothing was stopped." };
    const e = pidEntry(open, c.sessionId);
    if (e) {
      const ref = stopRef(c, e);
      if (!ref) return { error: "This chat's background id does not match its session, so nothing was stopped." };
      const r = await runCmd(["stop", ref], root);
      if (r.code !== 0) log("chat-rc", c.id, c.project, `claude stop exit ${logSafe(r.code, 12)}`);
    }
    const gone = await waitOpen((l) => (pidEntry(l, c.sessionId) ? null : true));
    return gone ? { ok: true } : { error: `Claude did not close the chat within ${secs()} seconds. Try again in a moment.` };
  }
  /** Last reply in the chat's saved file (read-only, the end of the file only), or null. */
  function lastReplyOf(c) {
    if (!UUID_RE.test(c.sessionId || "")) return null;
    try {
      const fd = openSync(join(sessionsDir, encodeCwd(join(root, c.project)), c.sessionId + ".jsonl"), "r");
      let text = "";
      try { const size = fstatSync(fd).size; const n = Math.min(size, 1 << 20); const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, size - n); text = buf.toString("utf8"); } finally { closeSync(fd); }
      const lines = text.split(/\r?\n/);
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"assistant"')) continue;
        let o; try { o = JSON.parse(lines[i]); } catch { continue; }
        if (!o || o.type !== "assistant" || !o.message || !Array.isArray(o.message.content)) continue;
        const t = o.message.content.filter((p) => p && p.type === "text" && typeof p.text === "string").map((p) => p.text).join("\n").trim();
        if (t) return t;
      }
    } catch { /* no saved file yet */ }
    return null;
  }
  /** Size and time of the saved chat file ("" when there is none): the reply is read again only when this changes. */
  function replyStamp(c) {
    if (!UUID_RE.test(c.sessionId || "")) return "";
    try { const s = statSync(join(sessionsDir, encodeCwd(join(root, c.project)), c.sessionId + ".jsonl")); return `${s.size}-${s.mtimeMs}`; } catch { return ""; }
  }
  /** Change one chat on a FRESH copy of the state (actions wait for Claude, so their earlier copy may be old). */
  function update(id, fn) {
    const st = readState(); const c = st.chats[id];
    if (!c) return null;
    fn(c, st); writeState(st);
    return c;
  }
  /** Remote Control chats follow the open list: busy = working, idle = idle; missing twice with no live pid = it really ended. */
  function applyOpen(open) {
    const st = readState(); let changed = false; const now = new Date().toISOString();
    for (const c of Object.values(st.chats)) {
      if (!c.remoteControl || !c.sessionId || acting.has(c.id)) continue;
      const e = pidEntry(open, c.sessionId);
      if (e) {
        let next = e.status === "busy" ? "working" : e.status === "idle" ? "idle" : c.state;
        if (c.pid !== e.pid || c.misses) { c.pid = e.pid; c.misses = 0; changed = true; }
        // A new background chat can show "idle" for a moment BEFORE its first turn runs (real run 2026-11-16): the first turn
        // only counts as done once a reply is saved, or after findMs of idle without one.
        if (c.firstTurn && next === "idle") {
          if (!c.idleSince) { c.idleSince = Date.now(); changed = true; }
          if (lastReplyOf(c) !== null || Date.now() - c.idleSince >= findMs) { c.firstTurn = false; c.idleSince = 0; changed = true; } else next = "working";
        } else if (c.firstTurn && c.idleSince) { c.idleSince = 0; changed = true; }
        if (next !== c.state) {
          if (next === "working") c.turns = (c.turns || 0) + 1; // a new turn (from the phone)
          c.state = next; c.lastTurnAt = now; changed = true;
        }
        if (c.state === "idle") { // keep the reply fresh (a short phone turn can fall between two looks)
          const m = replyStamp(c);
          if (m !== c.replyStamp) { const r = lastReplyOf(c); if (r) c.lastReply = clip(r, 1400); c.replyStamp = m; changed = true; }
        }
      } else {
        c.misses = (c.misses || 0) + 1; changed = true;
        if (c.misses >= 2 && !alive(c.pid)) {
          const r = lastReplyOf(c); if (r) c.lastReply = clip(r, 1400);
          c.remoteControl = false; c.state = "stopped"; c.pid = null; c.misses = 0; c.firstTurn = false; c.lastTurnAt = now;
          log("chat-end", c.id, c.project, "Remote Control chat ended outside the Hub");
        }
      }
    }
    if (changed) writeState(st);
  }
  function refreshOpen() {
    if (!refreshing) {
      snapAt = Date.now();
      refreshing = readOpen().then((open) => { if (open) { try { applyOpen(open); } catch { /* next time */ } } return open; }).finally(() => { refreshing = null; });
    }
    return refreshing;
  }
  /** list() and workingPids() must answer at once: they use the last known state and ask for a fresh open list in the background. */
  function kick(st) { if (Date.now() - snapAt >= refreshMs && Object.values(st.chats).some((c) => c.remoteControl && c.sessionId)) refreshOpen().catch(() => { /* next time */ }); }

  async function startBg(st, c, t) {
    c.name = `${c.name} · ${c.id.slice(-4)}`; // unique: the session id is found by this name
    Object.assign(c, { remoteControl: true, bg: true, bgId: null, sessionId: null, turns: 1 });
    const before = new Set(((await readOpen()) || []).filter((e) => e && e.pid).map((e) => e.sessionId));
    st = readState(); while (st.chats[c.id]) c.id = newId();
    c.seq = ++st.seq; st.chats[c.id] = c; writeState(st); acting.add(c.id); // listed as working while it starts
    try {
      const r = await runCmd(bgArgs(c, { task: t }), join(root, c.project));
      const short = shortIdOf(r.out);
      const hit = r.code === 0 ? await waitOpen((l) => l.find((e) => e && e.name === c.name && e.pid && typeof e.sessionId === "string" && UUID_RE.test(e.sessionId) && !before.has(e.sessionId)
        && (!short || e.sessionId.startsWith(short)) && (typeof e.id !== "string" || e.sessionId.startsWith(e.id))) || null) : null;
      if (!hit) {
        await cleanupLaunch(short, c.name, before);
        update(c.id, (x, s) => { delete s.chats[c.id]; });
        const why = r.code !== 0 ? `Claude could not start the background chat${firstLine(r.err || r.out) ? ": " + firstLine(r.err || r.out) : "."}` : `Claude did not show the new chat within ${secs()} seconds, so it was stopped. Try again.`;
        return fail("chat-start", c.id, c.project, why);
      }
      update(c.id, (x) => { x.sessionId = hit.sessionId; x.bgId = stopRef({ sessionId: hit.sessionId, bgId: short }, hit); x.pid = hit.pid; x.state = "working"; x.firstTurn = true; x.idleSince = 0; x.misses = 0; }); // the open list decides when the first turn is done
      log("chat-start", c.id, c.project, `ok background pid ${hit.pid} Remote Control on${c.model ? " model " + c.model : ""}`);
      return { ok: true, id: c.id, message: `Started a chat in ${c.project} with Remote Control on. Open it on your phone in the Claude app.` };
    } finally { acting.delete(c.id); }
  }

  // ---------- the actions ----------
  async function start({ project, task, model, remoteControl, workflow, attachments } = {}) {
    const pe = projectError(project);
    if (pe) return fail("chat-start", "-", project, pe);
    const t = cleanText(task);
    const hasFiles = Array.isArray(attachments) && attachments.length > 0; // then the task may be empty (Phase 19)
    if (!(textOk(t) || (hasFiles && t.length === 0))) return fail("chat-start", "-", project, `The task must be 1 to ${MAX_TEXT} characters.`);
    const m = model === undefined || model === null || model === "" ? null : model;
    if (m !== null && !MODELS.includes(m)) return fail("chat-start", "-", project, `Unknown model. Pick one of: ${MODELS.join(", ")}.`);
    if (remoteControl !== undefined && remoteControl !== null && typeof remoteControl !== "boolean") return fail("chat-start", "-", project, "Remote Control must be on or off.");
    const att = attachList(attachments, "new"); // files for a chat that does not exist yet are saved under the key "new"
    if (att.error) return fail("chat-start", "-", project, att.error);
    if (att.files.length) {
      if (remoteControl === true) return fail("chat-start", "-", project, ATTACH_MESSAGES.noRc); // --bg takes the task on the argument list only (T17)
      if (t.startsWith("/")) return fail("chat-start", "-", project, ATTACH_MESSAGES.slash);
      if (workflow !== false) return fail("chat-start", "-", project, ATTACH_MESSAGES.workflow); // "/pickup" inside a stream message is not run as a command (real probe 2026-11-21)
    }
    if (remoteControl === true && Object.values(readState().chats).some((x) => x.remoteControl && x.sessionId)) await refreshOpen(); // busy Remote Control chats count
    const st = settle(readState());
    if (working(st) >= maxWorking) return fail("chat-start", "-", project, busyMessage());
    const d = new Date();
    const wf = workflow !== false; // D44: a Hub chat follows the project workflow unless this is exactly false
    const first = wf && !t.startsWith("/") ? "/pickup " + t : t; // the length limit applied to the task Ivan typed, not to this
    const c = {
      id: newId(), project, workflow: wf, name: `${project} · ${whatItDoes(t)} · ${d.getDate()} ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      task: clip(t, 300), model: m, remoteControl: false, bg: false, noTools, state: "working", startedAt: d.toISOString(), lastTurnAt: d.toISOString(),
      turns: 0, sessionId: randomUUID(), lastReply: "", lastError: "", refused: [], pid: null, turnFile: null, seq: ++st.seq,
    };
    while (st.chats[c.id]) c.id = newId();
    if (remoteControl === true) return startBg(st, c, first);
    const msg = buildMessage(first, att.files);
    if (msg.error) return fail("chat-start", "-", project, msg.error);
    const l = launch(c, msg.input, true, { stream: msg.stream });
    if (l.error) return fail("chat-start", c.id, project, l.error);
    beginTurn(c, l);
    st.chats[c.id] = c; writeState(st);
    log("chat-start", c.id, project, `ok pid ${l.pid}${m ? " model " + m : ""}${filesNote(att.files)}`);
    return { ok: true, id: c.id, message: `Started a chat in ${project}.` };
  }

  function notAnswerable(c) {
    if (!c.sessionId) return "This chat has no Claude session to continue.";
    if (c.state === "working") return "This chat is still working. Wait for it to finish, or stop it.";
    if (c.state === "stopped" && ours(c.pid)) return "The stopped chat is still closing. Try again in a few seconds.";
    return "";
  }

  async function answer({ id, text, attachments } = {}) {
    if (typeof id !== "string" || !ID_RE.test(id)) return fail("chat-answer", id, "-", "Unknown chat.");
    let st = settle(readState()); let c = st.chats[id];
    if (!c) return fail("chat-answer", id, "-", "Unknown chat.");
    if (c.remoteControl || acting.has(id)) return fail("chat-answer", id, c.project, c.remoteControl ? RC_ANSWER_REFUSED : "This chat is being switched. Try again in a few seconds.");
    const t = cleanText(text);
    const hasFiles = Array.isArray(attachments) && attachments.length > 0; // then the answer may be empty (Phase 19)
    if (!(textOk(t) || (hasFiles && t.length === 0))) return fail("chat-answer", id, c.project, `The answer must be 1 to ${MAX_TEXT} characters.`);
    const att = attachList(attachments, id);
    if (att.error) return fail("chat-answer", id, c.project, att.error);
    if (att.files.length && t.startsWith("/")) return fail("chat-answer", id, c.project, ATTACH_MESSAGES.slash);
    let why = notAnswerable(c);
    if (why) return fail("chat-answer", id, c.project, why);
    if (working(st) >= maxWorking) return fail("chat-answer", id, c.project, busyMessage());
    // Rule 3 (T9): never write into a chat that is open anywhere else. If the list cannot be read, nothing is sent.
    const open = await readOpen();
    if (!open) return fail("chat-answer", id, c.project, "Can't check whether the chat is open elsewhere, so nothing was sent.");
    if (open.some((e) => e && e.sessionId === c.sessionId && (e.pid || e.kind === "interactive")))
      return fail("chat-answer", id, c.project, "This chat is open somewhere else (the Claude app or a terminal). Answer it there, so the chat does not split.");
    // The check above waited: look again before sending.
    st = settle(readState()); c = st.chats[id];
    if (!c) return fail("chat-answer", id, "-", "Unknown chat.");
    if (c.remoteControl || acting.has(id)) return fail("chat-answer", id, c.project, c.remoteControl ? RC_ANSWER_REFUSED : "This chat is being switched. Try again in a few seconds.");
    why = notAnswerable(c);
    if (why) return fail("chat-answer", id, c.project, why);
    if (working(st) >= maxWorking) return fail("chat-answer", id, c.project, busyMessage());
    const msg = buildMessage(t, att.files);
    if (msg.error) return fail("chat-answer", id, c.project, msg.error);
    const l = launch(c, msg.input, false, { stream: msg.stream });
    if (l.error) return fail("chat-answer", id, c.project, l.error);
    beginTurn(c, l); writeState(st);
    log("chat-answer", id, c.project, `ok pid ${l.pid} turn ${c.turns}${filesNote(att.files)}`);
    return { ok: true, message: `Sent to the chat in ${c.project}.` };
  }

  async function stop({ id } = {}) {
    if (typeof id !== "string" || !ID_RE.test(id)) return fail("chat-stop", id, "-", "Unknown chat.");
    const st = settle(readState()); const c = st.chats[id];
    if (!c) return fail("chat-stop", id, "-", "Unknown chat.");
    if (acting.has(id)) return fail("chat-stop", id, c.project, "This chat is still starting or being switched. Try again in a few seconds.");
    if (c.remoteControl) { // a background chat: the same `claude stop` as switching Remote Control off
      acting.add(id);
      try {
        const r = await endBg(c);
        if (r.error) return fail("chat-stop", id, c.project, r.error);
        update(id, (x) => { const rep = lastReplyOf(x); if (rep) x.lastReply = clip(rep, 1400); Object.assign(x, { remoteControl: false, state: "stopped", pid: null, misses: 0, firstTurn: false, lastTurnAt: new Date().toISOString() }); });
        log("chat-stop", id, c.project, "ok (background chat, Remote Control off)");
        return { ok: true, message: "Chat stopped. Remote Control is off; you can answer it here later." };
      } finally { acting.delete(id); }
    }
    if (c.state !== "working") return fail("chat-stop", id, c.project, "This chat is not working, so there is nothing to stop.");
    if (!ours(c.pid)) { applyTurn(c); writeState(st); return fail("chat-stop", id, c.project, "That chat had already finished."); }
    let ok;
    if (process.platform === "win32") ok = spawnSync("taskkill", ["/PID", String(c.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).status === 0;
    else { try { process.kill(c.pid, "SIGTERM"); ok = true; } catch { ok = false; } }
    if (!ok) return fail("chat-stop", id, c.project, "Windows could not stop it.");
    const had = applyTurn(c); // keep a reply that arrived just before the stop
    c.state = "stopped"; if (!had) c.lastError = "";
    writeState(st);
    log("chat-stop", id, c.project, "ok");
    return { ok: true, message: "Chat stopped. You can answer it later to continue." };
  }

  /** Remote Control on or off for one Hub chat. OFF: `claude stop` of this chat, wait for no pid, then it is a normal idle Hub chat.
   *  ON (idle / failed / stopped chat): continue the SAME session as a background chat with Remote Control. Real runs 2026-11-16:
   *  a chat that never ran in the background continues under the same id with the flags; one that did must be woken with only
   *  `--bg --resume <id>` (its saved options include Remote Control), flags would start a copy. A copy is detected, stopped, refused. */
  async function setRemoteControl({ id, on } = {}) {
    if (typeof id !== "string" || !ID_RE.test(id)) return fail("chat-rc", id, "-", "Unknown chat.");
    let st = settle(readState()); let c = st.chats[id];
    if (!c) return fail("chat-rc", id, "-", "Unknown chat.");
    if (typeof on !== "boolean") return fail("chat-rc", id, c.project, "Say whether Remote Control should be on or off.");
    if (acting.has(id)) return fail("chat-rc", id, c.project, "This chat is still starting or being switched. Try again in a few seconds.");
    if (!on) {
      if (!c.remoteControl) return fail("chat-rc", id, c.project, "Remote Control is already off for this chat.");
      if (!c.sessionId) return fail("chat-rc", id, c.project, "This chat is still starting. Try again in a few seconds.");
      acting.add(id);
      try {
        const r = await endBg(c);
        if (r.error) return fail("chat-rc", id, c.project, r.error);
        update(id, (x) => { const rep = lastReplyOf(x); if (rep) x.lastReply = clip(rep, 1400); Object.assign(x, { remoteControl: false, state: "idle", pid: null, misses: 0, firstTurn: false, lastTurnAt: new Date().toISOString() }); });
        log("chat-rc", id, c.project, "ok off");
        return { ok: true, message: "Remote Control is off. The chat stopped running in the background; you can answer it here now." };
      } finally { acting.delete(id); }
    }
    if (c.remoteControl) return fail("chat-rc", id, c.project, "Remote Control is already on for this chat.");
    let why = notAnswerable(c);
    if (why) return fail("chat-rc", id, c.project, why);
    // Rule 3 (T9): never continue a chat that is open anywhere else.
    const open = await readOpen();
    if (!open) return fail("chat-rc", id, c.project, "Can't check whether the chat is open elsewhere, so nothing was changed.");
    if (open.some((e) => e && e.sessionId === c.sessionId && (e.pid || e.kind === "interactive")))
      return fail("chat-rc", id, c.project, "This chat is open somewhere else (the Claude app or a terminal), so Remote Control was not switched on.");
    st = settle(readState()); c = st.chats[id];
    if (!c) return fail("chat-rc", id, "-", "Unknown chat.");
    if (c.remoteControl || acting.has(id)) return fail("chat-rc", id, c.project, "This chat changed meanwhile. Try again.");
    why = notAnswerable(c);
    if (why) return fail("chat-rc", id, c.project, why);
    acting.add(id);
    try {
      const before = new Set(open.filter((e) => e && e.pid && e.sessionId !== c.sessionId).map((e) => e.sessionId));
      const bare = c.bg === true;
      const r = await runCmd(bgArgs(c, { resume: true, bare }), join(root, c.project));
      const short = shortIdOf(r.out);
      if (short && !c.sessionId.startsWith(short)) { // Claude made a copy (T4): stop the copy, keep the chat as it was
        await cleanupLaunch(short, c.name, before);
        return fail("chat-rc", id, c.project, "Claude started a copy of the chat instead of continuing it, so the copy was stopped and Remote Control stays off.");
      }
      const hit = r.code === 0 ? await waitOpen((l) => pidEntry(l, c.sessionId)) : null;
      if (!hit) {
        await cleanupLaunch(short, c.name, before);
        return fail("chat-rc", id, c.project, r.code !== 0 ? `Claude could not continue the chat in the background${firstLine(r.err || r.out) ? ": " + firstLine(r.err || r.out) : "."}` : `Claude did not show the chat within ${secs()} seconds, so it was stopped and Remote Control stays off.`);
      }
      update(id, (x) => Object.assign(x, { remoteControl: true, bg: true, bgId: stopRef(x, hit) || short, pid: hit.pid, state: hit.status === "busy" ? "working" : "idle", firstTurn: false, misses: 0, lastError: "", refused: [] }));
      log("chat-rc", id, c.project, `ok on pid ${hit.pid}${bare ? " (woken with its saved options)" : ""}`);
      return { ok: true, message: "Remote Control is on. Open the chat on your phone in the Claude app." };
    } finally { acting.delete(id); }
  }

  // ---------- fork (Phase 19, step 19.9) ----------
  /** Why this Hub chat can't be copied now ("" = it can): only a RESTING chat (idle / failed / stopped) with Remote Control off. */
  function forkBlock(c) {
    if (acting.has(c.id)) return FORK_MESSAGES.switching;
    if (c.remoteControl) return FORK_MESSAGES.rc;
    if (!c.sessionId) return FORK_MESSAGES.noSession;
    if (c.state === "working") return FORK_MESSAGES.working;
    if (c.state === "stopped" && ours(c.pid)) return FORK_MESSAGES.closing;
    if (!["idle", "failed", "stopped"].includes(c.state)) return FORK_MESSAGES.working;
    return "";
  }
  /** A clean chat name, the fallback when none is given, or { error }. */
  function forkName(name, fallback) {
    if (name !== undefined && name !== null && typeof name !== "string") return { error: FORK_MESSAGES.name };
    const n = String(name ?? "").replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
    return { name: clip(n || fallback, 120) };
  }
  /** Shared by fork() and forkSession(): the checks around the open-list look, then ONE turn that makes the copy. */
  async function doFork({ sessionId, project, hubId, name, text, model, chatNoTools, workflow }) {
    const A = "chat-fork";
    const t = cleanText(text);
    if (t.length > MAX_TEXT) return fail(A, hubId || "-", project, `The first message must be at most ${MAX_TEXT} characters.`);
    const own = (st) => (hubId ? st.chats[hubId] : Object.values(st.chats).find((x) => x.sessionId === sessionId)) || null;
    let st = settle(readState());
    let o = own(st);
    if (hubId && !o) return fail(A, hubId, "-", "Unknown chat.");
    if (o) { const why = forkBlock(o); if (why) return fail(A, o.id, project, why); }
    if (working(st) >= maxWorking) return fail(A, hubId || "-", project, busyMessage());
    // Fork rule (CLAUDE_CONTROL.md): never copy a chat that is open anywhere else (a busy chat would be copied half-way).
    const open = await readOpen();
    if (!open) return fail(A, hubId || "-", project, FORK_MESSAGES.cantCheck);
    if (open.some((e) => e && e.sessionId === sessionId)) return fail(A, hubId || "-", project, FORK_MESSAGES.open);
    st = settle(readState()); o = own(st);
    if (hubId && !o) return fail(A, hubId, "-", "Unknown chat.");
    if (o) { const why = forkBlock(o); if (why) return fail(A, o.id, project, why); }
    if (working(st) >= maxWorking) return fail(A, hubId || "-", project, busyMessage());
    const d = new Date();
    const c = {
      id: newId(), project, workflow: workflow !== false, name, task: clip(t, 300), model: model || null, remoteControl: false, bg: false, noTools: noTools || chatNoTools === true,
      state: "working", startedAt: d.toISOString(), lastTurnAt: d.toISOString(), turns: 0, sessionId: randomUUID(), lastReply: "", lastError: "", refused: [],
      pid: null, turnFile: null, seq: ++st.seq, forkedFrom: o ? o.id : null, forkedFromSession: sessionId, forkPending: true,
    };
    while (st.chats[c.id]) c.id = newId();
    const l = launch(c, t || FORK_FIRST_MESSAGE, false, { forkFrom: sessionId });
    if (l.error) return fail(A, c.id, project, l.error);
    beginTurn(c, l);
    st.chats[c.id] = c; writeState(st);
    log(A, c.id, project, `ok pid ${l.pid} copy of ${o ? o.id : "session " + sessionId.slice(0, 8)}${c.model ? " model " + c.model : ""}`);
    return { ok: true, id: c.id, message: `Made a copy of the chat in ${project}. The old chat stays as it was.` };
  }
  /** Copy a resting Hub chat into a NEW Hub chat of the same project (same model, Remote Control off, forkedFrom = the old id). */
  async function fork({ id, name, text } = {}) {
    if (typeof id !== "string" || !ID_RE.test(id)) return fail("chat-fork", id, "-", "Unknown chat.");
    const c = settle(readState()).chats[id];
    if (!c) return fail("chat-fork", id, "-", "Unknown chat.");
    const why = forkBlock(c);
    if (why) return fail("chat-fork", id, c.project, why);
    const n = forkName(name, `Fork of ${c.name}`);
    if (n.error) return fail("chat-fork", id, c.project, n.error);
    return doFork({ sessionId: c.sessionId, project: c.project, hubId: id, name: n.name, text, model: c.model, chatNoTools: c.noTools, workflow: c.workflow });
  }
  /** Copy a session the CALLER has checked (the server: a closed app chat that passes the D49 rule). The engine still refuses a
   *  session in the open list or when that list can't be read, a session with no saved file in that project's folder, and a
   *  session of its own Hub chats that is not resting. */
  async function forkSession({ sourceSessionId, project, name, text, model } = {}) {
    const pe = projectError(project);
    if (pe) return fail("chat-fork", "-", project, pe);
    if (typeof sourceSessionId !== "string" || !UUID_RE.test(sourceSessionId)) return fail("chat-fork", "-", project, "Unknown chat.");
    try { if (!statSync(join(sessionsDir, encodeCwd(join(root, project)), sourceSessionId + ".jsonl")).isFile()) throw new Error("not a file"); }
    catch { return fail("chat-fork", "-", project, "Unknown chat."); }
    const m = model === undefined || model === null || model === "" ? null : model;
    if (m !== null && !MODELS.includes(m)) return fail("chat-fork", "-", project, `Unknown model. Pick one of: ${MODELS.join(", ")}.`);
    const n = forkName(name, `Fork of a ${project} chat · ${sourceSessionId.slice(0, 8)}`);
    if (n.error) return fail("chat-fork", "-", project, n.error);
    const mine = Object.values(readState().chats).find((x) => x.sessionId === sourceSessionId);
    return doFork({ sessionId: sourceSessionId, project, hubId: mine ? mine.id : null, name: n.name, text, model: m ?? (mine ? mine.model : null), chatNoTools: mine ? mine.noTools : false, workflow: true });
  }

  function list() {
    const st = settle(readState());
    kick(st);
    return Object.values(st.chats).sort((a, b) => (b.seq || 0) - (a.seq || 0)).map((c) => ({
      id: c.id, project: c.project, name: c.name, task: clip(redact(c.task || ""), 300), model: c.model || null, remoteControl: c.remoteControl === true, workflow: c.workflow !== false,
      state: c.state, startedAt: c.startedAt, lastTurnAt: c.lastTurnAt, turns: c.turns || 0, sessionId: c.sessionId || null,
      lastReply: clip(redact(c.lastReply || ""), 1400), lastError: clip(redact(c.lastError || ""), 600),
      refused: (c.refused || []).slice(0, 10).map((r) => clip(redact(r), 160)),
      forkedFrom: c.forkedFrom || null, forkedFromSession: c.forkedFromSession || null,
    }));
  }

  /** "Start in the app" (D38): the link that opens the Claude app's new-chat page with the folder and the task filled in. The app
   *  waits for Send (test T6), so nothing starts by itself. The folder is chosen here, never by the page. */
  function appLink({ project, task } = {}) {
    const pe = projectError(project);
    if (pe) return fail("chat-app-link", "-", project, pe);
    const t = cleanText(task);
    if (!textOk(t) || t.length > 1500) return fail("chat-app-link", "-", project, "For \"Start in the app\" the task must be 1 to 1500 characters.");
    log("chat-app-link", "-", project, "ok");
    return { ok: true, message: `Opening the Claude app in ${project}. Press Send there to start.`, link: `claude://code/new?q=${encodeURIComponent(t)}&folder=${encodeURIComponent(join(root, project))}` };
  }

  /** { id: pid } of the turns that are running, busy Remote Control chats included (game mode slows them like other Hub programs). */
  function workingPids() {
    const st = readState(); kick(st);
    const out = {};
    for (const c of Object.values(st.chats)) if (c.state === "working" && alive(c.pid)) out[c.id] = c.pid;
    return out;
  }

  return { start, answer, stop, list, workingPids, appLink, setRemoteControl, fork, forkSession, uploads };
}

// ---------- self-test ----------
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv.includes("--selftest")) {
  let bad = 0;
  const ok = (name, cond) => { console.log(`${cond ? "OK  " : "FAIL"} ${name}`); if (!cond) bad++; };
  const pause = (ms) => new Promise((d) => setTimeout(d, ms));
  const waitFor = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await pause(150); } return false; };
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

  // ===== A. pretend claude =====
  const base = join(tmpdir(), "hub-chats-test-" + process.pid);
  const projects = join(base, "projects");
  mkdirSync(join(projects, "Fake"), { recursive: true });
  writeFileSync(join(projects, "notadir.txt"), "x");
  const recDir = join(base, "calls");
  const fake = join(base, "fake-claude.mjs");
  writeFileSync(fake, `
import { writeFileSync, mkdirSync, readFileSync, renameSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
const argv = process.argv.slice(2);
const get = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const dir = process.env.HUB_FAKE_DIR;
const record = (input) => { if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "call-" + Date.now() + "-" + process.pid + "-" + Math.random().toString(36).slice(2, 7) + ".json"), JSON.stringify({ argv, input, cwd: process.cwd() })); } };
// background chats (14.6): a registry file stands in for Claude's background service
const regPath = process.env.HUB_FAKE_REG || join(dir || ".", "reg.json");
const readReg = () => { for (let i = 0; i < 50; i++) { try { return JSON.parse(readFileSync(regPath, "utf8")); } catch (e) { if (e.code === "ENOENT") return []; } } return []; };
const writeReg = (r) => { const tmp = regPath + "." + process.pid; writeFileSync(tmp, JSON.stringify(r)); for (let i = 0; i < 50; i++) { try { renameSync(tmp, regPath); return; } catch { /* reader busy */ } } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const showsPid = (e) => !!e.pid && (e.goneAt ? Date.now() < e.goneAt : alive(e.pid)); // after a stop the pid lingers ~1 s in the list (T12)
if (argv[0] === "agents") {
  const out = readReg().filter((e) => !e.hidden && showsPid(e)).map((e) => ({ pid: e.pid, id: e.id, cwd: e.cwd, kind: "background", startedAt: e.startedAt, sessionId: e.sessionId, name: e.name,
    status: Date.now() >= (e.turnStart || 0) && Date.now() < e.busyUntil ? "busy" : "idle", state: !e.busyUntil ? "blocked" : Date.now() < e.busyUntil ? "working" : "done" }));
  process.stdout.write(JSON.stringify(out, null, 2) + "\\n");
} else if (argv[0] === "stop") {
  record("");
  const reg = readReg(); const e = reg.find((x) => x.id === argv[1] && !x.goneAt && alive(x.pid));
  if (!e) { process.stderr.write("no running background session " + argv[1] + "\\n"); process.exitCode = 1; }
  else { try { process.kill(e.pid); } catch { /* gone */ } e.goneAt = Date.now() + 900; writeReg(reg); process.stdout.write("stopped " + e.id + "\\n"); }
} else if (argv.includes("--bg")) {
  record("");
  const reg = readReg();
  const resume = get("--resume");
  const dash = argv.indexOf("--"); const task = dash >= 0 ? argv.slice(dash + 1).join(" ") : "";
  const flags = argv.some((a, i) => a !== "--bg" && a !== "--resume" && argv[i - 1] !== "--resume");
  const old = resume ? reg.find((x) => x.sessionId === resume) : null;
  // like the real one: a chat that ran in the background before + any flag = a copy; so is a chat still running
  const copy = !!resume && ((old && old.saved && flags) || (old && showsPid(old)) || (process.env.HUB_FAKE_COPY && existsSync(process.env.HUB_FAKE_COPY)));
  const sessionId = resume && !copy ? resume : randomUUID();
  const name = old && !flags ? old.name : get("--name") || "unnamed";
  // like the real one: a new chat lists as "idle" for a moment BEFORE its first turn, then busy; the reply is saved when the turn ends
  const now = Date.now(); const turnStart = now + 1200; const busyUntil = task ? turnStart + (task.includes("SLOW") ? 4000 : 400) : 0;
  let file = "", line = "";
  if (task && process.env.HUB_FAKE_SESSIONS) {
    const d = join(process.env.HUB_FAKE_SESSIONS, process.cwd().replace(/[^A-Za-z0-9]/g, "-")); mkdirSync(d, { recursive: true });
    file = join(d, sessionId + ".jsonl");
    appendFileSync(file, JSON.stringify({ type: "user", message: { content: task } }) + "\\n");
    line = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "BG ECHO: " + task }] } }) + "\\n";
  }
  const writer = "const [f, t, d] = process.argv.slice(1); if (f) setTimeout(() => require('fs').appendFileSync(f, t), Number(d)); setInterval(() => {}, 1000);";
  const kid = spawn(process.execPath, ["-e", writer, file, line, String(busyUntil - now - 100)], { detached: true, stdio: "ignore", windowsHide: true }); kid.unref();
  const e = { id: sessionId.slice(0, 8), sessionId, name, cwd: process.cwd(), startedAt: now, pid: kid.pid, turnStart: task ? turnStart : 0, busyUntil,
    saved: true, rc: argv.includes("--remote-control") || !!(old && old.rc), hidden: task.includes("NOSHOW") };
  writeReg(reg.filter((x) => x.sessionId !== sessionId).concat([e]));
  process.stdout.write("backgrounded · " + e.id + " · " + name + "\\n");
  if (copy) process.stderr.write("note: started a copy as " + e.id + "\\n");
} else {
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  record(input);
  // Phase 19: the stream route (like the real one, T26c: stream input needs stream output and --verbose; ONE user line)
  const stream = get("--input-format") === "stream-json";
  let probe = input, echo = "ECHO: " + input;
  if (stream) {
    if (get("--output-format") !== "stream-json") { process.stderr.write("Error: --input-format=stream-json requires output-format=stream-json\\n"); process.exitCode = 1; return; }
    if (!argv.includes("--verbose")) { process.stderr.write("Error: --output-format=stream-json requires --verbose\\n"); process.exitCode = 1; return; }
    const rows = input.split("\\n").filter(Boolean);
    let msg = null; try { msg = rows.length === 1 ? JSON.parse(rows[0]) : null; } catch { /* not JSON */ }
    const content = msg && msg.type === "user" && msg.message && msg.message.role === "user" && Array.isArray(msg.message.content) ? msg.message.content : null;
    if (!content) { process.stdout.write("bad stream input\\n"); process.exitCode = 1; return; }
    probe = content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
    echo = "STREAM: " + content.map((b) => b.type === "text" ? "text=" + b.text : b.type + "=" + b.source.media_type + "/" + Buffer.from(b.source.data, "base64").length).join(" | ");
    process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: get("--session-id") || get("--resume") }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "not-the-last-line", result: "NOT THE LAST RESULT LINE" }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "thinking" }] } }) + "\\n");
  }
  const wait = probe.includes("SLOWEST") ? 30000 : probe.includes("SLOW") ? 2500 : 200;
  setTimeout(() => {
    if (probe.includes("NOISE")) process.stderr.write("a warning on standard error\\n");
    if (probe.includes("NOJSON")) { process.stdout.write("Something broke before any result.\\n"); process.exitCode = 1; return; }
    const running = get("--resume") && readReg().find((x) => x.sessionId === get("--resume") && showsPid(x));
    if (running) { process.stdout.write(JSON.stringify({ type: "result", subtype: "error", is_error: true, session_id: get("--resume"), result: "That session is running in the background (T5)." }) + "\\n"); process.exitCode = 1; return; }
    const failed = probe.includes("FAIL");
    const denials = probe.includes("DENY") ? [{ tool_name: "Bash", tool_use_id: "t1", tool_input: { command: "rm -rf build" } }, { tool_name: "Write", tool_use_id: "t2", tool_input: { file_path: "C:\\\\x\\\\notes.txt" } }] : [];
    const sid = probe.includes("SAMEID") ? get("--resume") : get("--session-id") || get("--resume"); // SAMEID: a fork that did not fork
    // saved chat files (only with HUB_FAKE_PSAVE): a fork copies the old file to the new id first, like the real one (T32b)
    if (process.env.HUB_FAKE_PSAVE && process.env.HUB_FAKE_SESSIONS && sid && !failed) {
      const d = join(process.env.HUB_FAKE_SESSIONS, process.cwd().replace(/[^A-Za-z0-9]/g, "-")); mkdirSync(d, { recursive: true });
      const f = join(d, sid + ".jsonl");
      if (argv.includes("--fork-session") && sid !== get("--resume")) { const old = join(d, get("--resume") + ".jsonl"); if (existsSync(old)) writeFileSync(f, readFileSync(old)); }
      appendFileSync(f, JSON.stringify({ type: "user", message: { content: probe } }) + "\\n" + JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: echo }] } }) + "\\n");
    }
    process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: failed, session_id: sid,
      result: failed ? "Pretend failure: the model is unavailable." : echo, permission_denials: denials }) + "\\n");
    process.exitCode = failed ? 1 : 0;
  }, wait);
});
}
`);
  process.env.HUB_FAKE_DIR = recDir;
  process.env.HUB_FAKE_REG = join(base, "reg.json");
  process.env.HUB_FAKE_SESSIONS = join(base, "sessions");
  process.env.HUB_FAKE_COPY = join(base, "force-copy");
  let openList = [];
  const listOpen = async () => { if (openList === "throw") throw new Error("agents list failed"); return openList; };
  const redact = (s) => String(s).replace(/SECRET\w*/g, "[hidden]");
  const mk = () => makeChats({ root: projects, dataDir: join(base, "data"), logDir: join(base, "logs"), claude: [process.execPath, fake], listOpen, redact });
  const c0 = mk();
  const c = { ...c0, start: (o) => c0.start({ workflow: false, ...o }) }; // the older tests check the plain text: workflow off (D44); new tests use c0
  const get = (id) => c.list().find((x) => x.id === id);
  const settled = (id) => waitFor(() => { const x = get(id); return x && x.state !== "working"; });
  const calls = () => { try { return readdirSync(recDir).map((f) => JSON.parse(readFileSync(join(recDir, f), "utf8"))); } catch { return []; } };
  const call = (marker) => calls().find((k) => k.input.includes(marker));

  try {
    // refusals before anything starts
    ok("unknown project refused", (await c.start({ project: "Nope", task: "hi" })).ok === false);
    ok("slash in project refused", (await c.start({ project: "Fake/..", task: "hi" })).ok === false && (await c.start({ project: "..\\Windows", task: "hi" })).ok === false);
    ok("bad characters in project refused", (await c.start({ project: 'Fa"ke', task: "hi" })).ok === false && (await c.start({ project: "Fake&calc", task: "hi" })).ok === false);
    ok("a file (not a folder) refused", (await c.start({ project: "notadir.txt", task: "hi" })).ok === false);
    ok("non-text project refused", (await c.start({ project: ["Fake"], task: "hi" })).ok === false);
    ok("empty task refused", (await c.start({ project: "Fake", task: "   " })).ok === false);
    ok("too long task refused", (await c.start({ project: "Fake", task: "x".repeat(4001) })).ok === false);
    ok("unknown model refused", (await c.start({ project: "Fake", task: "hi", model: "gpt-4" })).ok === false);
    const rc = await c.start({ project: "Nope", task: "hi", remoteControl: true });
    const rc2 = await c.start({ project: "Fake", task: "hi", remoteControl: "yes" });
    ok("remoteControl: unknown project still refused, a non-boolean refused", rc.ok === false && rc.error === "Unknown project folder." && rc2.ok === false && rc2.error === "Remote Control must be on or off.");
    ok("nothing started by the refusals", c.list().length === 0 && calls().length === 0);

    // start, then idle with reply and session id
    const a = await c.start({ project: "Fake", task: "  Hello MARKER-A SECRET42 NOISE  ", model: "haiku" });
    ok("start ok with a Hub id", a.ok === true && /^h-\d{8}-\d{6}-[a-z0-9]{4}$/.test(a.id));
    ok("state working right after start", get(a.id).state === "working");
    ok("workingPids lists the running turn", Number.isInteger(c.workingPids()[a.id]));
    ok("becomes idle", await settled(a.id));
    const A1 = get(a.id);
    ok("reply and session id kept", A1.state === "idle" && A1.lastReply.startsWith("ECHO: Hello MARKER-A") && /^[0-9a-f-]{36}$/.test(A1.sessionId) && A1.turns === 1);
    ok("redact applied to task and reply", !A1.task.includes("SECRET42") && A1.task.includes("[hidden]") && !A1.lastReply.includes("SECRET42"));
    ok("model kept, remoteControl false", A1.model === "haiku" && A1.remoteControl === false);
    ok("workingPids empty when idle", Object.keys(c.workingPids()).length === 0);
    const k1 = call("MARKER-A");
    ok("text arrived on standard input (trimmed)", k1 && k1.input === "Hello MARKER-A SECRET42 NOISE");
    ok("text not in the arguments", k1 && !k1.argv.some((x, i) => k1.argv[i - 1] !== "--name" && (x.includes("MARKER") || x.includes("SECRET"))));
    ok("auto permission mode, json output, model flag", k1 && k1.argv.join(" ").includes("-p --output-format json --permission-mode auto --permission-prompts none") && k1.argv.includes("haiku"));
    ok("new session id given by the engine", k1 && k1.argv[k1.argv.indexOf("--session-id") + 1] === A1.sessionId);
    ok("ran in the project folder", k1 && resolve(k1.cwd).toLowerCase() === resolve(projects, "Fake").toLowerCase());
    ok("standard error noise does not break the reading", A1.lastError === "");

    // answer continues the same session
    ok("answer ok", (await c.answer({ id: a.id, text: "Second MARKER-B" })).ok === true);
    ok("answer turn settles", await settled(a.id));
    const A2 = get(a.id); const k2 = call("MARKER-B");
    ok("answer continues the same session", k2 && k2.argv[k2.argv.indexOf("--resume") + 1] === A1.sessionId && !k2.argv.includes("--session-id") && A2.sessionId === A1.sessionId);
    ok("answer reply and turn count", A2.lastReply === "ECHO: Second MARKER-B" && A2.turns === 2);

    // answer refused while running
    ok("slow answer ok", (await c.answer({ id: a.id, text: "Third SLOW MARKER-C" })).ok === true);
    const r1 = await c.answer({ id: a.id, text: "again MARKER-D" });
    ok("answer refused while the turn is running", r1.ok === false && /still working/.test(r1.error));
    ok("slow turn settles", await settled(a.id));
    ok("refused answer never reached claude", !call("MARKER-D"));

    // open elsewhere (pretend open-list only)
    const sid = A1.sessionId; const turnsBefore = get(a.id).turns;
    openList = [{ sessionId: sid, kind: "interactive", status: "idle" }];
    const o1 = await c.answer({ id: a.id, text: "open MARKER-E" });
    ok("answer refused: open as interactive (no pid)", o1.ok === false && /open somewhere else/.test(o1.error));
    openList = [{ sessionId: sid, kind: "background", pid: 4242 }];
    ok("answer refused: open with a pid", (await c.answer({ id: a.id, text: "open MARKER-E" })).ok === false);
    openList = "throw";
    const o3 = await c.answer({ id: a.id, text: "open MARKER-E" });
    ok("answer refused when the open-list reader throws", o3.ok === false && o3.error === "Can't check whether the chat is open elsewhere, so nothing was sent.");
    openList = { not: "a list" };
    ok("answer refused when the open-list is not a list", (await c.answer({ id: a.id, text: "open MARKER-E" })).ok === false);
    openList = [{ sessionId: sid, kind: "interactive", status: "idle" }];
    const on0 = await c.setRemoteControl({ id: a.id, on: true });
    ok("Remote Control on refused: the chat is open elsewhere", on0.ok === false && /open somewhere else/.test(on0.error));
    openList = "throw";
    const on00 = await c.setRemoteControl({ id: a.id, on: true });
    ok("Remote Control on refused when the open-list cannot be read", on00.ok === false && /Can't check/.test(on00.error));
    ok("...and nothing was started in the background", !calls().some((k) => k.argv.includes("--bg")) && get(a.id).remoteControl === false);
    ok("no turn started by those refusals", get(a.id).turns === turnsBefore && !call("MARKER-E"));
    openList = [{ sessionId: "11111111-2222-3333-4444-555555555555", kind: "interactive", pid: 1 }];
    ok("another chat open elsewhere does not block", (await c.answer({ id: a.id, text: "Fourth MARKER-F" })).ok === true && await settled(a.id));
    openList = [];

    // at most two working
    const b = await c.start({ project: "Fake", task: "SLOW MARKER-G" });
    const b2 = await c.start({ project: "Fake", task: "SLOW MARKER-H" });
    const third = await c.start({ project: "Fake", task: "MARKER-I" });
    ok("two slow starts ok", b.ok && b2.ok);
    ok("third start refused while two are working", third.ok === false && third.error === "Two chats are already working. Wait for one to finish.");
    ok("answer also refused at the limit", (await c.answer({ id: a.id, text: "MARKER-J" })).ok === false);
    ok("workingPids lists both", Object.keys(c.workingPids()).length === 2);
    ok("both settle", (await settled(b.id)) && (await settled(b2.id)));

    // failed turns
    const f = await c.start({ project: "Fake", task: "FAIL MARKER-K" });
    ok("failed turn becomes failed with lastError", f.ok && (await settled(f.id)) && get(f.id).state === "failed" && get(f.id).lastError.includes("Pretend failure"));
    const n = await c.start({ project: "Fake", task: "NOJSON MARKER-L" });
    ok("turn without a result becomes failed", n.ok && (await settled(n.id)) && get(n.id).state === "failed" && get(n.id).lastError.includes("Something broke"));

    // refused actions
    const d = await c.start({ project: "Fake", task: "DENY MARKER-M" });
    ok("refused actions listed", d.ok && (await settled(d.id)) && get(d.id).refused.length === 2 && get(d.id).refused[0] === "Bash: rm -rf build");

    // stop
    const s = await c.start({ project: "Fake", task: "SLOWEST MARKER-N" });
    ok("long turn started", s.ok && get(s.id).state === "working");
    const spid = c.workingPids()[s.id];
    await waitFor(() => call("MARKER-N"), 5000);
    const st1 = await c.stop({ id: s.id });
    ok("stop ends a running turn", st1.ok === true && get(s.id).state === "stopped");
    ok("its process is gone", await waitFor(() => !alive(spid), 5000));
    ok("stop on a stopped chat refused", (await c.stop({ id: s.id })).ok === false);
    ok("stop on an idle chat refused", (await c.stop({ id: a.id })).ok === false);
    ok("stop on an unknown id refused", (await c.stop({ id: "h-20990101-000000-zzzz" })).ok === false && (await c.stop({ id: "../x" })).ok === false);
    ok("answer on an unknown id refused", (await c.answer({ id: "h-20990101-000000-zzzz", text: "hi" })).ok === false);
    ok("a stopped chat can be answered later", (await c.answer({ id: s.id, text: "after stop MARKER-O" })).ok === true && (await settled(s.id)) && get(s.id).state === "idle" && get(s.id).turns === 2);
    const kO = call("MARKER-O");
    ok("...in the same session", kO && kO.argv[kO.argv.indexOf("--resume") + 1] === get(s.id).sessionId);

    // "Start in the app" link (D38)
    const lk = c.appLink({ project: "Fake", task: "Fix the A&B page?" });
    ok("app link: claude://code/new with the task and the folder encoded", lk.ok === true && lk.link.startsWith("claude://code/new?q=Fix%20the%20A%26B%20page%3F&folder=") && lk.link.includes(encodeURIComponent(join(projects, "Fake"))));
    ok("app link refused: unknown project, slash, empty, too long", [{ project: "Nope", task: "hi" }, { project: "Fake/..", task: "hi" }, { project: "Fake", task: " " }, { project: "Fake", task: "x".repeat(1501) }].every((x) => c.appLink(x).ok === false));
    ok("app link starts nothing", calls().every((k) => !k.input.includes("A&B")));
    const logNow = readFileSync(join(base, "logs", "hub_actions.log"), "utf8");
    ok("app link is logged without the task text", logNow.includes("chat-app-link") && !logNow.includes("A&B"));

    // order, survival, log
    const all = c.list();
    ok("newest first", all[0].id === s.id && all[all.length - 1].id === a.id);
    const again = mk().list();
    ok("state survives a new makeChats()", again.length === all.length && again.every((x, i) => x.id === all[i].id && x.sessionId === all[i].sessionId && x.state === all[i].state));
    const logText = readFileSync(join(base, "logs", "hub_actions.log"), "utf8");
    ok("log has start, answer, stop and refusal lines", ["chat-start", "chat-answer", "chat-stop", "refused:"].every((w) => logText.includes(w)));
    ok("log has no task or answer text", !/MARKER|SECRET|Hello|Pretend/.test(logText));
    ok("log lines have action, id, project, result", logText.trim().split(/\n/).every((l) => /^\S+ chat-[\w-]+ \S+ \S+ .+/.test(l)));
    const stateText = readFileSync(join(base, "data", "hub_chats.json"), "utf8");
    ok("state file holds no full long task", !stateText.includes("x".repeat(301)));

    // D44: the project workflow
    const w1 = await c0.start({ project: "Fake", task: "  Fix the card layout WFMARK1  " });
    ok("workflow default: first turn is '/pickup <task>' on standard input", w1.ok && await settled(w1.id) && !!call("WFMARK1") && call("WFMARK1").input === "/pickup Fix the card layout WFMARK1");
    ok("workflow default: list() says workflow true", get(w1.id).workflow === true);
    const w2 = await c0.start({ project: "Fake", task: "/handoff WFMARK2" });
    ok("a task starting with '/' is sent unchanged", w2.ok && await settled(w2.id) && call("WFMARK2").input === "/handoff WFMARK2");
    const w3 = await c0.start({ project: "Fake", task: "Plain WFMARK3", workflow: false });
    ok("workflow false: task sent unchanged, list() says workflow false", w3.ok && await settled(w3.id) && call("WFMARK3").input === "Plain WFMARK3" && get(w3.id).workflow === false);
    const w4 = await c0.start({ project: "Fake", task: "x".repeat(4000) });
    ok("the 4000 limit counts the task only, not '/pickup '", w4.ok === true && await settled(w4.id));
    const w5 = await c0.start({ project: "Fake", task: "WFMARK5" });
    await settled(w5.id);
    const w5a = await c0.answer({ id: w5.id, text: "Answer WFMARK6" });
    ok("an answer is never wrapped", w5a.ok === true && await settled(w5.id) && call("WFMARK6").input === "Answer WFMARK6");
    const nameOf = async (task) => { const r = await c.start({ project: "Fake", task }); const n = get(r.id).name; await settled(r.id); return n; };
    const nm = {
      normal: await nameOf("Fix the card layout please now"),
      long: await nameOf("Reorganise the complete dashboard navigation structure and more words here"),
      odd: await nameOf('Say "hi" to a/b\nthen c\\d `rm` & more words'),
      pick: await nameOf("/pickup"), hand: await nameOf("/handoff"),
      other: await nameOf("/something else"), pickTask: await nameOf("/pickup fix the footer now please"),
      punct: await nameOf("?!?! ... ***"), slash: await nameOf("/"),
    };
    console.log("# names: " + JSON.stringify(nm));
    const dateTail = / · \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d\d:\d\d$/;
    const what = (n) => { const m = /^Fake · (.*?)( · \d{1,2} \w{3} \d\d:\d\d)$/.exec(n); return m && dateTail.test(n) ? m[1] : null; };
    ok("name: a normal task = first 5 words", what(nm.normal) === "Fix the card layout please");
    ok("name: a long task is cut at a word boundary, at most 40 characters", what(nm.long) === "Reorganise the complete dashboard" && what(nm.long).length <= 40);
    ok("name: odd characters removed (quotes, slashes, newlines, backticks, &)", what(nm.odd) === "Say hi to a b" && !/["`\\\n&]/.test(nm.odd));
    ok("name: /pickup = Pick up, /handoff = Hand off", what(nm.pick) === "Pick up" && what(nm.hand) === "Hand off");
    ok("name: another /word = capitalised, plus up to 3 words", what(nm.other) === "Something else" && what(nm.pickTask) === "Pick up fix the footer");
    ok("name: only punctuation (or just '/') = New chat", what(nm.punct) === "New chat" && what(nm.slash) === "New chat");
    ok("name: never holds the full task", !nm.long.includes("more words") && !nm.normal.includes("now"));
    ok("name is passed as --name on the first turn", call("WFMARK1").argv[call("WFMARK1").argv.indexOf("--name") + 1] === get(w1.id).name && get(w1.id).name.startsWith("Fake · Fix the card layout WFMARK1 · "));
    const logWf = readFileSync(join(base, "logs", "hub_actions.log"), "utf8");
    ok("log has no task text after the workflow starts", !/WFMARK|card layout|Reorganise/.test(logWf));
  } catch (err) { ok("self-test crashed: " + (err && err.stack), false); }
  await waitFor(() => Object.keys(c.workingPids()).length === 0, 10000); // let every pretend process end first (Windows)

  // ===== B. Remote Control with pretend background chats (14.6) =====
  const regPath = process.env.HUB_FAKE_REG;
  const reg = () => { for (let i = 0; i < 20; i++) { try { return JSON.parse(readFileSync(regPath, "utf8")); } catch (e) { if (e.code === "ENOENT") return []; } } return []; };
  const foreignKid = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore", windowsHide: true }); foreignKid.unref();
  const foreignSid = randomUUID();
  writeFileSync(regPath, JSON.stringify([{ id: foreignSid.slice(0, 8), sessionId: foreignSid, name: "Someone else's chat", cwd: join(projects, "Fake"), startedAt: Date.now(), pid: foreignKid.pid, busyUntil: 0, saved: true, rc: true }]));
  const rcDir = join(base, "rc");
  const rce0 = makeChats({ root: projects, dataDir: join(rcDir, "data"), logDir: join(rcDir, "logs"), claude: [process.execPath, fake], redact, findTimeoutMs: 3000, rcRefreshMs: 150, sessionsDir: join(base, "sessions") });
  const rce = { ...rce0, start: (o) => rce0.start({ workflow: false, ...o }) }; // plain text for the older checks (D44); new tests use rce0
  const rget = (id) => rce.list().find((x) => x.id === id);
  const rstate = (id, s, ms = 10000) => waitFor(() => { const x = rget(id); return x && x.state === s; }, ms);
  const agentsNow = () => JSON.parse(execFileSync(process.execPath, [fake, "agents", "--json"], { encoding: "utf8", env: process.env, windowsHide: true }));
  const bgCalls = () => calls().filter((k) => k.argv.includes("--bg"));
  const stopCalls = () => calls().filter((k) => k.argv[0] === "stop");
  try {
    const r1 = await rce.start({ project: "Fake", task: "SLOW RC-MARKER-1 SECRET9", model: "haiku", remoteControl: true });
    ok("RC: start with Remote Control ok", r1.ok === true && ID_RE.test(r1.id));
    const R1 = rget(r1.id); const sid1 = R1.sessionId;
    const e1 = reg().find((e) => e.sessionId === sid1);
    ok("RC: listed remoteControl true; session id found by the chat's unique name", R1.remoteControl === true && UUID_RE.test(sid1 || "") && !!e1 && e1.name === R1.name && R1.name.endsWith(" · " + r1.id.slice(-4)));
    ok("RC: working right after start, its pid in workingPids", R1.state === "working" && rce.workingPids()[r1.id] === e1.pid);
    let early = true, sawIdle = false; const tEarly = Date.now();
    while (Date.now() - tEarly < 3000) { const st0 = agentsNow().find((e) => e.sessionId === sid1).status; if (st0 === "busy") break; sawIdle = true; if (rget(r1.id).state !== "working") early = false; await pause(150); }
    ok("RC: listed idle by Claude BEFORE its first turn: still working here", early && sawIdle);
    const kb = bgCalls().find((k) => k.argv.join(" ").includes("RC-MARKER-1"));
    ok("RC: --bg --remote-control <name>, auto mode, model, the task only after --, nothing on stdin", !!kb && kb.argv[0] === "--bg" && kb.argv[kb.argv.indexOf("--remote-control") + 1] === R1.name
      && kb.argv.join(" ").includes("--permission-mode auto") && kb.argv.includes("haiku") && kb.argv.indexOf("--") === kb.argv.length - 2 && kb.argv[kb.argv.length - 1] === "SLOW RC-MARKER-1 SECRET9"
      && !kb.argv.includes("-p") && !kb.argv.includes("--session-id") && kb.input === "");
    ok("RC: becomes idle from the open list; reply read from the saved chat file (redacted)", (await rstate(r1.id, "idle")) && rget(r1.id).lastReply.startsWith("BG ECHO: SLOW RC-MARKER-1") && !rget(r1.id).lastReply.includes("SECRET9"));
    ok("RC: idle, so not in workingPids", rce.workingPids()[r1.id] === undefined);
    const ra = await rce.answer({ id: r1.id, text: "RC-MARKER-X" });
    const ra2 = await rce.answer({ id: r1.id, text: "" });
    ok("RC: answer refused with the exact sentence (before any other check)", ra.ok === false && ra.error === RC_ANSWER_REFUSED && ra2.error === RC_ANSWER_REFUSED);
    ok("RC: the refused answer never reached claude", !calls().some((k) => (k.input + k.argv.join(" ")).includes("RC-MARKER-X")));
    ok("RC: switching on while on is refused", (await rce.setRemoteControl({ id: r1.id, on: true })).ok === false);

    // the limit counts busy Remote Control chats
    const r2 = await rce.start({ project: "Fake", task: "SLOW RC-MARKER-2", remoteControl: true });
    const n1 = await rce.start({ project: "Fake", task: "SLOW RC-MARKER-3" });
    const r3 = await rce.start({ project: "Fake", task: "RC-MARKER-4", remoteControl: true });
    ok("RC: a busy Remote Control chat counts; the third start is refused at the limit", r2.ok === true && n1.ok === true && r3.ok === false && r3.error === "Two chats are already working. Wait for one to finish." && Object.keys(rce.workingPids()).length === 2);
    ok("RC: the refused third start launched nothing", !bgCalls().some((k) => k.argv.join(" ").includes("RC-MARKER-4")));
    ok("RC: both settle to idle", (await rstate(r2.id, "idle")) && (await rstate(n1.id, "idle")));

    // off: stop, wait for no pid, then a normal Hub chat
    const off1 = await rce.setRemoteControl({ id: r1.id, on: false });
    ok("RC off: ok", off1.ok === true);
    ok("RC off: `claude stop` got this chat's short id, nothing else", stopCalls().length === 1 && stopCalls()[0].argv.length === 2 && stopCalls()[0].argv[1] === sid1.slice(0, 8));
    ok("RC off: returned only once the open list showed no pid for it (T12b)", !agentsNow().some((e) => e.sessionId === sid1 && e.pid));
    ok("RC off: a normal idle Hub chat, same session", (() => { const x = rget(r1.id); return x.remoteControl === false && x.state === "idle" && x.sessionId === sid1; })());
    ok("RC off twice is refused", (await rce.setRemoteControl({ id: r1.id, on: false })).ok === false);
    ok("RC off: answers normally", (await rce.answer({ id: r1.id, text: "RC-MARKER-5" })).ok === true && (await waitFor(() => rget(r1.id).state !== "working")) && rget(r1.id).lastReply === "ECHO: RC-MARKER-5");
    const k5 = call("RC-MARKER-5");
    ok("RC off: ...with -p --resume <the same session id>", !!k5 && k5.argv.includes("-p") && k5.argv[k5.argv.indexOf("--resume") + 1] === sid1 && rget(r1.id).sessionId === sid1);

    // on again: a chat that ran in the background before is woken with only --bg --resume (flags would make a copy)
    const on1 = await rce.setRemoteControl({ id: r1.id, on: true });
    const kOn = bgCalls().filter((k) => k.argv.includes("--resume")).pop();
    ok("RC on (ran in the background before): ok, woken with only `--bg --resume <id>`", on1.ok === true && !!kOn && kOn.argv.join(" ") === "--bg --resume " + sid1);
    ok("RC on: the SAME session, Remote Control on, running again", (() => { const x = rget(r1.id); return x.remoteControl === true && x.sessionId === sid1 && agentsNow().some((e) => e.sessionId === sid1 && e.pid); })());
    ok("RC on: answer refused again", (await rce.answer({ id: r1.id, text: "hi" })).error === RC_ANSWER_REFUSED);

    // on for a chat that never ran in the background: the flags, same session, no task
    const sidN = rget(n1.id).sessionId;
    const on2 = await rce.setRemoteControl({ id: n1.id, on: true });
    const kOn2 = bgCalls().filter((k) => k.argv.includes(sidN)).pop();
    ok("RC on (plain Hub chat): ok with --remote-control, auto mode, --resume <its id>, no task", on2.ok === true && !!kOn2 && kOn2.argv.includes("--remote-control") && kOn2.argv.join(" ").includes("--permission-mode auto") && kOn2.argv[kOn2.argv.indexOf("--resume") + 1] === sidN && !kOn2.argv.includes("--"));
    ok("RC on (plain Hub chat): the same session", rget(n1.id).remoteControl === true && rget(n1.id).sessionId === sidN);

    // stop works for a Remote Control chat
    const stN = await rce.stop({ id: n1.id });
    ok("RC stop: ok; stopped, Remote Control off, no pid left", stN.ok === true && rget(n1.id).state === "stopped" && rget(n1.id).remoteControl === false && !agentsNow().some((e) => e.sessionId === sidN && e.pid));
    ok("RC stop: a stopped chat can be answered later", (await rce.answer({ id: n1.id, text: "RC-MARKER-7" })).ok === true && (await waitFor(() => rget(n1.id).state !== "working")) && rget(n1.id).lastReply === "ECHO: RC-MARKER-7");

    // a copy is never kept
    const sid2 = rget(r2.id).sessionId;
    ok("RC: second chat switched off", (await rce.setRemoteControl({ id: r2.id, on: false })).ok === true);
    writeFileSync(process.env.HUB_FAKE_COPY, "1");
    const known = new Set(reg().map((e) => e.sessionId));
    const cp = await rce.setRemoteControl({ id: r2.id, on: true });
    rmSync(process.env.HUB_FAKE_COPY, { force: true });
    const copyEntry = reg().find((e) => !known.has(e.sessionId));
    ok("RC on that made a copy: refused plainly; the copy was stopped", cp.ok === false && cp.error === "Claude started a copy of the chat instead of continuing it, so the copy was stopped and Remote Control stays off."
      && !!copyEntry && (await waitFor(() => !alive(copyEntry.pid), 5000)) && !agentsNow().some((e) => e.sessionId === copyEntry.sessionId));
    ok("RC on that made a copy: the chat stays as it was (off, idle, same session)", rget(r2.id).remoteControl === false && rget(r2.id).sessionId === sid2 && rget(r2.id).state === "idle");

    // a background start whose session never shows up
    const nsBefore = rce.list().length;
    const ns = await rce.start({ project: "Fake", task: "NOSHOW RC-MARKER-6", remoteControl: true });
    const hidden = reg().find((e) => e.hidden);
    ok("RC start that never shows: fails plainly", ns.ok === false && ns.error === "Claude did not show the new chat within 3 seconds, so it was stopped. Try again.");
    ok("RC start that never shows: nothing left running, no chat kept", !!hidden && (await waitFor(() => !alive(hidden.pid), 5000)) && stopCalls().some((k) => k.argv[1] === hidden.id) && rce.list().length === nsBefore);

    // ids: only the engine's own chats can be stopped or switched
    let idsOk = true;
    for (const bad of ["h-20990101-000000-zzzz", "../x", foreignSid, foreignSid.slice(0, 8), 42, undefined, null]) {
      for (const on of [true, false]) if ((await rce.setRemoteControl({ id: bad, on })).ok !== false) idsOk = false;
      if ((await rce.stop({ id: bad })).ok !== false) idsOk = false;
    }
    ok("RC: unknown ids and someone else's chat can never be stopped or switched", idsOk);
    ok("RC: `on` must be true or false", (await rce.setRemoteControl({ id: r1.id, on: "off" })).ok === false && rget(r1.id).remoteControl === true);
    ok("RC: someone else's background chat was never stopped", alive(foreignKid.pid) && !stopCalls().some((k) => k.argv[1] === foreignSid.slice(0, 8)));

    // D44: workflow on the Remote Control path (task after --)
    const wr = await rce0.start({ project: "Fake", task: "RCWF1 task words", remoteControl: true });
    const kw = bgCalls().find((k) => k.argv.join(" ").includes("RCWF1"));
    const wrName = wr.ok ? rget(wr.id).name : "";
    ok("RC + workflow: the task after -- is '/pickup <task>'", wr.ok === true && !!kw && kw.argv[kw.argv.length - 2] === "--" && kw.argv[kw.argv.length - 1] === "/pickup RCWF1 task words" && rget(wr.id).workflow === true);
    ok("RC + workflow: the name keeps its 4-character suffix", /^Fake · RCWF1 task words · \d{1,2} \w{3} \d\d:\d\d · [a-z0-9]{4}$/.test(wrName) && wrName.endsWith(" · " + wr.id.slice(-4)) && kw.argv[kw.argv.indexOf("--name") + 1] === wrName);
    await rstate(wr.id, "idle"); const wr2 = await rce0.start({ project: "Fake", task: "/handoff RCWF2", remoteControl: true });
    await rstate(wr2.id, "idle"); const wr3 = await rce0.start({ project: "Fake", task: "RCWF3 plain", remoteControl: true, workflow: false });
    const kw2 = bgCalls().find((k) => k.argv.join(" ").includes("RCWF2")); const kw3 = bgCalls().find((k) => k.argv.join(" ").includes("RCWF3"));
    ok("RC: a '/' task and workflow false are sent unchanged", wr2.ok === true && wr3.ok === true && kw2.argv[kw2.argv.length - 1] === "/handoff RCWF2" && kw3.argv[kw3.argv.length - 1] === "RCWF3 plain" && rget(wr3.id).workflow === false);
    for (const x of [wr, wr2, wr3]) if (x.ok) { await waitFor(() => rget(x.id).state === "idle", 10000); await rce0.stop({ id: x.id }); }

    // a Remote Control chat that really ended (outside the Hub) shows as stopped, Remote Control off
    const pidR1 = reg().find((e) => e.sessionId === sid1).pid;
    ok("RC: still on while it runs (no false 'stopped')", (await pause(600), rget(r1.id).remoteControl === true && rget(r1.id).state === "idle"));
    try { process.kill(pidR1); } catch { /* gone */ }
    ok("RC: a chat that really ended shows as stopped with Remote Control off", await waitFor(() => { const x = rget(r1.id); return x.state === "stopped" && x.remoteControl === false; }, 8000));
    ok("RC: no background chat of the engine left running", reg().filter((e) => e.sessionId !== foreignSid).every((e) => !alive(e.pid)));

    const rlog = readFileSync(join(rcDir, "logs", "hub_actions.log"), "utf8");
    ok("RC: log has chat-rc lines (on, off, refused) and background starts", /chat-rc \S+ Fake ok off/.test(rlog) && /chat-rc \S+ Fake ok on/.test(rlog) && /chat-rc \S+ \S+ refused: /.test(rlog) && /chat-start \S+ Fake ok background/.test(rlog));
    ok("RC: log has no task or answer text", !/MARKER|SECRET|ECHO/.test(rlog));
    ok("RC: log lines have action, id, project, result", rlog.trim().split(/\n/).every((l) => /^\S+ chat-[\w-]+ \S+ \S+ .+/.test(l)));
  } catch (err) { ok("RC self-test crashed: " + (err && err.stack), false); }
  for (const e of reg()) { try { process.kill(e.pid); } catch { /* gone */ } }
  try { process.kill(foreignKid.pid); } catch { /* gone */ }
  await waitFor(() => Object.keys(rce.workingPids()).length === 0, 10000);

  // ===== E. pictures, files and fork (Phase 19) with pretend claude: no real chat is touched =====
  process.env.HUB_FAKE_PSAVE = "1";
  const eDir = join(base, "att"); const sess = join(base, "att-sessions");
  process.env.HUB_FAKE_SESSIONS = sess;
  let eOpen = [];
  const eList = async () => { if (eOpen === "throw") throw new Error("agents list failed"); return eOpen; };
  const up = makeUploads({ dir: join(eDir, "uploads") });
  const eOpts = { root: projects, dataDir: join(eDir, "data"), logDir: join(eDir, "logs"), claude: [process.execPath, fake], listOpen: eList, redact, sessionsDir: sess };
  const ee = makeChats({ ...eOpts, uploads: up });
  const eget = (id) => ee.list().find((x) => x.id === id);
  const esettled = (id) => waitFor(() => { const x = eget(id); return x && x.state !== "working"; });
  const eState = () => JSON.parse(readFileSync(join(eDir, "data", "hub_chats.json"), "utf8"));
  const setRec = (id, fields) => { const s = eState(); Object.assign(s.chats[id], fields); writeFileSync(join(eDir, "data", "hub_chats.json"), JSON.stringify(s, null, 2)); };
  const savedFile = (sid) => join(sess, encodeCwd(join(projects, "Fake")), sid + ".jsonl");
  const fwd = (p) => p.replace(/\\/g, "/");
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(30, 9)]);
  const PDF = Buffer.from("%PDF-1.4\n%%EOF\n", "latin1");
  const nCalls = () => calls().length;
  try {
    // a new chat with a picture (stream route)
    const p1 = up.save({ chatKey: "new", bytes: PNG, originalName: "Blue Photo.png" });
    const s1 = await ee.start({ project: "Fake", task: "ATT-MARK-1 what colour?", workflow: false, model: "haiku", attachments: [p1.uploadId] });
    ok("E: start with a picture ok, becomes idle", s1.ok === true && (await esettled(s1.id)) && eget(s1.id).state === "idle");
    const S1 = eget(s1.id); const k1 = call("ATT-MARK-1");
    ok("E: stream flags, then the usual Hub flags, --session-id and --name, model", !!k1 && k1.argv.join(" ").startsWith("-p --input-format stream-json --output-format stream-json --verbose --permission-mode auto --permission-prompts none --session-id " + S1.sessionId + " --name ")
      && k1.argv.includes("haiku") && !/--output-format json/.test(k1.argv.join(" ")) && !k1.argv.includes("--resume"));
    const L1 = k1 && JSON.parse(k1.input);
    ok("E: standard input is ONE JSON line: image block (base64, image/png, the same bytes) first, then the text", !!k1 && k1.input.endsWith("\n") && k1.input.trim().split("\n").length === 1
      && L1.type === "user" && L1.message.role === "user" && L1.message.content.length === 2 && L1.message.content[0].type === "image" && L1.message.content[0].source.type === "base64"
      && L1.message.content[0].source.media_type === "image/png" && Buffer.from(L1.message.content[0].source.data, "base64").equals(PNG) && L1.message.content[1].type === "text" && L1.message.content[1].text === "ATT-MARK-1 what colour?");
    ok("E: no text, file name or path on the command line", !!k1 && !k1.argv.some((a, i) => k1.argv[i - 1] !== "--name" && /ATT-MARK|Blue Photo|uploads/.test(a)));
    ok("E: the result is read from the LAST result line of the stream", S1.lastReply === "STREAM: image=image/png/38 | text=ATT-MARK-1 what colour?" && S1.turns === 1 && S1.lastError === "");

    // an answer with a PDF, a text file and a picture
    const a1 = up.save({ chatKey: s1.id, bytes: PDF, originalName: "doc.pdf" });
    const a2 = up.save({ chatKey: s1.id, bytes: Buffer.from("note"), originalName: "my note.txt" });
    const a3 = up.save({ chatKey: s1.id, bytes: PNG, originalName: "p.png" });
    const r2 = await ee.answer({ id: s1.id, text: "ATT-MARK-2", attachments: [a1.uploadId, a2.uploadId, a3.uploadId] });
    ok("E: answer with a PDF, a text file and a picture ok", r2.ok === true && (await esettled(s1.id)) && eget(s1.id).state === "idle");
    const k2 = call("ATT-MARK-2"); const L2 = k2 && JSON.parse(k2.input); const notePath = fwd(up.get(a2.uploadId).path);
    ok("E: answer: --resume <the same session>, stream flags, no --session-id", !!k2 && k2.argv.join(" ").startsWith("-p --input-format stream-json --output-format stream-json --verbose --permission-mode auto --permission-prompts none --resume " + S1.sessionId) && !k2.argv.includes("--session-id"));
    ok("E: answer: document block (application/pdf), image block, then the text with '@<path>' of the text file", !!L2 && L2.message.content.length === 3
      && L2.message.content[0].type === "document" && L2.message.content[0].source.type === "base64" && L2.message.content[0].source.media_type === "application/pdf" && Buffer.from(L2.message.content[0].source.data, "base64").equals(PDF)
      && L2.message.content[1].type === "image" && L2.message.content[2].type === "text" && L2.message.content[2].text === "ATT-MARK-2\n\n@" + notePath);
    ok("E: the '@' path is the store's own random file (inside the upload folder, not the person's name)", notePath.startsWith(fwd(join(eDir, "uploads", s1.id))) && !notePath.includes("my note") && !/\s/.test(notePath));
    ok("E: answer reply from the last result line, same session", eget(s1.id).lastReply.startsWith("STREAM: document=application/pdf/15 | image=image/png/38 | text=ATT-MARK-2") && eget(s1.id).sessionId === S1.sessionId && eget(s1.id).turns === 2);

    // only text files: the normal route with '@<path>' (T28)
    const t1 = up.save({ chatKey: s1.id, bytes: Buffer.from("# x"), originalName: "a.md" });
    const r3 = await ee.answer({ id: s1.id, text: "ATT-MARK-3", attachments: [t1.uploadId] });
    const r3ok = r3.ok === true && (await esettled(s1.id));
    const k3 = call("ATT-MARK-3"); const tPath = fwd(up.get(t1.uploadId).path);
    ok("E: text file only: normal route (json output, no stream flags), '@<path>' after the text", r3ok && !!k3 && k3.input === "ATT-MARK-3\n\n@" + tPath
      && k3.argv.join(" ").includes("-p --output-format json --permission-mode auto") && !k3.argv.includes("--input-format") && eget(s1.id).lastReply === "ECHO: ATT-MARK-3\n\n@" + tPath);
    const t2 = up.save({ chatKey: s1.id, bytes: Buffer.from("y"), originalName: "b.txt" });
    const r4 = await ee.answer({ id: s1.id, text: "   ", attachments: [t2.uploadId] });
    ok("E: empty text is fine when a file is attached (the message is only '@<path>')", r4.ok === true && (await esettled(s1.id)) && eget(s1.id).lastReply === "ECHO: @" + fwd(up.get(t2.uploadId).path));
    const p5 = up.save({ chatKey: s1.id, bytes: PNG, originalName: "only.png" });
    const r5 = await ee.answer({ id: s1.id, text: "", attachments: [p5.uploadId] });
    ok("E: a picture with no text: one image block and no text block", r5.ok === true && (await esettled(s1.id)) && eget(s1.id).lastReply === "STREAM: image=image/png/38");

    // refusals: nothing reaches claude
    let before = nCalls();
    const empty1 = await ee.answer({ id: s1.id, text: "  " }); const empty2 = await ee.answer({ id: s1.id, text: "", attachments: [] });
    ok("E: empty text without files is refused with the old sentence", empty1.error === "The answer must be 1 to 4000 characters." && empty2.error === empty1.error);
    const five = [0, 1, 2, 3, 4].map(() => up.save({ chatKey: s1.id, bytes: PNG, originalName: "x.png" }).uploadId);
    ok("E: five files refused", (await ee.answer({ id: s1.id, text: "ATT-NO-1", attachments: five })).error === "At most 4 files per message.");
    ok("E: a file saved for another chat refused", (await ee.answer({ id: s1.id, text: "ATT-NO-2", attachments: [p1.uploadId] })).error === "One of the attached files is no longer there. Attach it again.");
    ok("E: an unknown or path-like id refused", (await ee.answer({ id: s1.id, text: "ATT-NO-3", attachments: ["../../secret.png"] })).error === "One of the attached files is no longer there. Attach it again.");
    ok("E: attachments that are not a list refused", (await ee.answer({ id: s1.id, text: "ATT-NO-4", attachments: "abc" })).error === ATTACH_MESSAGES.notList);
    ok("E: a / command with files refused", (await ee.answer({ id: s1.id, text: "/handoff ATT-NO-5", attachments: [five[0]] })).error === ATTACH_MESSAGES.slash);
    const nw = up.save({ chatKey: "new", bytes: PNG, originalName: "n.png" }).uploadId;
    ok("E: a new chat with files and the project workflow on refused (pick up can't carry files)", (await ee.start({ project: "Fake", task: "ATT-NO-6", attachments: [nw] })).error === ATTACH_MESSAGES.workflow);
    ok("E: a new chat with files and Remote Control refused", (await ee.start({ project: "Fake", task: "ATT-NO-7", attachments: [nw], remoteControl: true, workflow: false })).error === ATTACH_MESSAGES.noRc);
    ok("E: a new chat with a / task and files refused", (await ee.start({ project: "Fake", task: "/info ATT-NO-8", attachments: [nw], workflow: false })).error === ATTACH_MESSAGES.slash);
    ok("E: a new chat with an upload of another chat refused", (await ee.start({ project: "Fake", task: "ATT-NO-9", attachments: [five[0]], workflow: false })).error === "One of the attached files is no longer there. Attach it again.");
    const stub = (kind) => ({ cleanup() { return {}; }, resolve: () => ({ ok: true, files: [{ uploadId: "0".repeat(32), path: join(eDir, "missing-file." + (kind === "text" ? "txt" : "png")), kind, mediaType: kind === "text" ? "text/plain" : "image/png", bytes: 38 }] }) });
    ok("E: a picture that can't be read: refused plainly, nothing sent", (await makeChats({ ...eOpts, uploads: stub("image") }).answer({ id: s1.id, text: "ATT-NO-10", attachments: ["x"] })).error === ATTACH_MESSAGES.readFailed);
    ok("E: a text file that is gone: refused plainly, nothing sent", (await makeChats({ ...eOpts, uploads: stub("text") }).answer({ id: s1.id, text: "ATT-NO-11", attachments: ["x"] })).error === ATTACH_MESSAGES.readFailed);
    setRec(s1.id, { remoteControl: true });
    const rcA = await ee.answer({ id: s1.id, text: "ATT-NO-12", attachments: [five[0]] }); const rcF = await ee.fork({ id: s1.id, text: "ATT-NO-13" });
    setRec(s1.id, { remoteControl: false });
    ok("E: Remote Control on: an answer with files and a fork are refused", rcA.error === RC_ANSWER_REFUSED && rcF.error === FORK_MESSAGES.rc);
    ok("E: none of the refused messages reached claude", nCalls() === before && !calls().some((k) => /ATT-NO-/.test(k.input + k.argv.join(" "))));
    const sl = up.save({ chatKey: s1.id, bytes: PNG, originalName: "s.png" }).uploadId;
    ok("E: a slow answer with a picture ok", (await ee.answer({ id: s1.id, text: "SLOW ATT-MARK-6", attachments: [sl] })).ok === true);
    const busyA = await ee.answer({ id: s1.id, text: "ATT-NO-14", attachments: [five[1]] });
    const busyF = await ee.fork({ id: s1.id, text: "ATT-NO-15" });
    ok("E: while it works: another answer with files and a fork are refused", /still working/.test(busyA.error) && busyF.error === FORK_MESSAGES.working && !call("ATT-NO-14") && !call("ATT-NO-15"));
    ok("E: the slow picture turn settles", await esettled(s1.id));
    const elog = readFileSync(join(eDir, "logs", "hub_actions.log"), "utf8");
    ok("E: the log names file extensions only", /chat-start \S+ Fake ok pid \d+ model haiku files png/.test(elog) && /chat-answer \S+ Fake ok pid \d+ turn 2 files pdf,txt,png/.test(elog) && /chat-answer \S+ Fake ok pid \d+ turn 3 files md/.test(elog));
    ok("E: the log has no text, no file names, no paths", !/ATT-MARK|ATT-NO|Blue|Photo|note|only\.png|uploads|[0-9a-f]{24}\./.test(elog));

    // fork of a resting Hub chat
    const oldSid = eget(s1.id).sessionId; const oldName = eget(s1.id).name;
    const oldRec = JSON.stringify(eState().chats[s1.id]); const oldFile = readFileSync(savedFile(oldSid));
    const f1 = await ee.fork({ id: s1.id, text: "FORK-MARK-1" });
    ok("E: fork ok: a new Hub id", f1.ok === true && ID_RE.test(f1.id) && f1.id !== s1.id && (await esettled(f1.id)));
    const F1 = eget(f1.id); const kf = call("FORK-MARK-1");
    ok("E: fork flags: Hub flags, --resume <old> --fork-session --session-id <new> --name <name>, same model", !!kf && kf.argv.join(" ").startsWith(`-p --output-format json --permission-mode auto --permission-prompts none --resume ${oldSid} --fork-session --session-id ${F1.sessionId} --name `)
      && kf.argv[kf.argv.indexOf("--name") + 1] === "Fork of " + oldName && kf.argv[kf.argv.indexOf("--model") + 1] === "haiku" && kf.input === "FORK-MARK-1");
    ok("E: fork record: forkedFrom = the old Hub id, own new session, same project and model, Remote Control off, idle", F1.forkedFrom === s1.id && F1.forkedFromSession === oldSid && UUID_RE.test(F1.sessionId) && F1.sessionId !== oldSid
      && F1.project === "Fake" && F1.model === "haiku" && F1.remoteControl === false && F1.state === "idle" && F1.name === "Fork of " + oldName && F1.lastReply === "ECHO: FORK-MARK-1" && F1.turns === 1);
    ok("E: the old chat's record and saved file are untouched", JSON.stringify(eState().chats[s1.id]) === oldRec && readFileSync(savedFile(oldSid)).equals(oldFile));
    ok("E: the fork's saved file starts as a copy of the old one", readFileSync(savedFile(F1.sessionId)).subarray(0, oldFile.length).equals(oldFile));
    ok("E: old chats show forkedFrom null", eget(s1.id).forkedFrom === null && eget(s1.id).forkedFromSession === null);
    const fa = await ee.answer({ id: f1.id, text: "FORK-MARK-2" });
    const faok = fa.ok === true && (await esettled(f1.id));
    const kfa = call("FORK-MARK-2");
    ok("E: answering the fork continues the FORK's session, the old file stays the same", faok && !!kfa && kfa.argv[kfa.argv.indexOf("--resume") + 1] === F1.sessionId && !kfa.argv.includes("--fork-session") && readFileSync(savedFile(oldSid)).equals(oldFile));
    before = nCalls();
    const f2 = await ee.fork({ id: s1.id, name: "  My \n copy  " });
    ok("E: fork without text sends the fixed first message; a given name is cleaned", f2.ok === true && (await esettled(f2.id)) && eget(f2.id).name === "My copy" && calls().some((k) => k.input === FORK_FIRST_MESSAGE && k.argv.includes("--fork-session")) && nCalls() === before + 1);
    const f3 = await ee.fork({ id: f1.id, text: "FORK-MARK-3" });
    ok("E: a fork of a fork points to its own parent", f3.ok === true && (await esettled(f3.id)) && eget(f3.id).forkedFrom === f1.id && eget(f3.id).forkedFromSession === F1.sessionId);
    const fs = await ee.fork({ id: s1.id, text: "SAMEID FORK-MARK-4" });
    ok("E: a fork where Claude kept the OLD id is marked failed and gets no session (never writes into the old chat)", fs.ok === true && (await esettled(fs.id)) && eget(fs.id).state === "failed" && eget(fs.id).lastError === FORK_MESSAGES.sameId && eget(fs.id).sessionId === null);
    ok("E: ...and it can't be answered", (await ee.answer({ id: fs.id, text: "FORK-NO-0" })).error === "This chat has no Claude session to continue.");

    // fork refusals
    before = nCalls();
    ok("E: fork: unknown or bad ids refused", (await ee.fork({ id: "h-20990101-000000-zzzz" })).error === "Unknown chat." && (await ee.fork({ id: "../x" })).error === "Unknown chat." && (await ee.fork({ id: oldSid })).error === "Unknown chat.");
    eOpen = [{ sessionId: oldSid, kind: "interactive", status: "idle" }];
    ok("E: fork: refused when the old chat is open elsewhere", (await ee.fork({ id: s1.id, text: "FORK-NO-1" })).error === FORK_MESSAGES.open);
    eOpen = "throw";
    ok("E: fork: refused when the open list can't be read", (await ee.fork({ id: s1.id, text: "FORK-NO-2" })).error === FORK_MESSAGES.cantCheck);
    eOpen = [];
    ok("E: fork: a name that is not text refused; a too long first message refused", (await ee.fork({ id: s1.id, name: 5 })).error === FORK_MESSAGES.name && (await ee.fork({ id: s1.id, text: "x".repeat(4001) })).error === "The first message must be at most 4000 characters.");
    setRec(s1.id, { state: "working", pid: process.pid });
    ok("E: fork: a chat marked working refused", (await ee.fork({ id: s1.id, text: "FORK-NO-3" })).error === FORK_MESSAGES.working);
    setRec(s1.id, { state: "idle" });
    const w1 = await ee.answer({ id: f1.id, text: "SLOW FORK-BUSY-1" }); const w2 = await ee.answer({ id: f2.id, text: "SLOW FORK-BUSY-2" });
    const lim = await ee.fork({ id: s1.id, text: "FORK-NO-4" });
    ok("E: fork: refused at the limit of 2 working turns", w1.ok && w2.ok && lim.error === "Two chats are already working. Wait for one to finish.");
    await esettled(f1.id); await esettled(f2.id);
    ok("E: fork: none of the refusals started anything (only the 2 slow answers ran)", !calls().some((k) => /FORK-NO-/.test(k.input)) && nCalls() === before + 2);

    // forkSession: a session the caller checked (a closed app chat)
    const appSid = randomUUID(); mkdirSync(dirname(savedFile(appSid)), { recursive: true });
    writeFileSync(savedFile(appSid), JSON.stringify({ type: "user", message: { content: "app chat" } }) + "\n");
    const appFile = readFileSync(savedFile(appSid));
    ok("E: forkSession: bad id, unknown saved file, bad project refused", (await ee.forkSession({ sourceSessionId: "nope", project: "Fake" })).error === "Unknown chat."
      && (await ee.forkSession({ sourceSessionId: randomUUID(), project: "Fake" })).error === "Unknown chat." && (await ee.forkSession({ sourceSessionId: appSid, project: "Nope" })).error === "Unknown project folder.");
    eOpen = [{ sessionId: appSid, kind: "interactive", pid: 4242, status: "idle" }];
    ok("E: forkSession: refused when the session is in the open list", (await ee.forkSession({ sourceSessionId: appSid, project: "Fake", text: "FORK-NO-5" })).error === FORK_MESSAGES.open);
    eOpen = "throw";
    ok("E: forkSession: refused when the open list can't be read", (await ee.forkSession({ sourceSessionId: appSid, project: "Fake", text: "FORK-NO-6" })).error === FORK_MESSAGES.cantCheck);
    eOpen = [];
    const fa1 = await ee.forkSession({ sourceSessionId: appSid, project: "Fake", name: "Copy of the app chat", text: "FORK-MARK-APP", model: "sonnet" });
    const fa1ok = fa1.ok === true && (await esettled(fa1.id));
    const kapp = call("FORK-MARK-APP");
    ok("E: forkSession ok: --resume <session> --fork-session --session-id <new>, own record with forkedFromSession", fa1ok && !!kapp && kapp.argv.includes("--fork-session") && kapp.argv[kapp.argv.indexOf("--resume") + 1] === appSid
      && eget(fa1.id).forkedFrom === null && eget(fa1.id).forkedFromSession === appSid && eget(fa1.id).name === "Copy of the app chat" && eget(fa1.id).model === "sonnet" && kapp.argv[kapp.argv.indexOf("--session-id") + 1] === eget(fa1.id).sessionId);
    ok("E: forkSession: the source file is untouched", readFileSync(savedFile(appSid)).equals(appFile));
    const fh = await ee.forkSession({ sourceSessionId: oldSid, project: "Fake", text: "FORK-MARK-HUB" });
    ok("E: forkSession of a Hub chat's session points forkedFrom to that Hub chat", fh.ok === true && (await esettled(fh.id)) && eget(fh.id).forkedFrom === s1.id && eget(fh.id).model === "haiku");
    setRec(s1.id, { state: "working", pid: process.pid });
    ok("E: forkSession of a Hub chat that is not resting refused", (await ee.forkSession({ sourceSessionId: oldSid, project: "Fake", text: "FORK-NO-7" })).error === FORK_MESSAGES.working && !call("FORK-NO-7"));
    setRec(s1.id, { state: "idle" });
    const flog = readFileSync(join(eDir, "logs", "hub_actions.log"), "utf8");
    ok("E: log has chat-fork lines without text", /chat-fork \S+ Fake ok pid \d+ copy of h-/.test(flog) && /chat-fork \S+ Fake ok pid \d+ copy of session [0-9a-f]{8}/.test(flog) && /chat-fork \S+ Fake refused: /.test(flog) && !/FORK-MARK|FORK-NO|My copy|app chat/.test(flog));
    ok("E: log lines have action, id, project, result", flog.trim().split(/\n/).every((l) => /^\S+ chat-[\w-]+ \S+ \S+ .+/.test(l)));
  } catch (err) { ok("E self-test crashed: " + (err && err.stack), false); }
  await waitFor(() => Object.keys(ee.workingPids()).length === 0, 15000);
  delete process.env.HUB_FAKE_PSAVE;
  await pause(300);
  try { rmSync(base, { recursive: true, force: true }); } catch { /* temp only */ }

  // ===== C. one real round trip (only with --real) =====
  if (process.argv.includes("--real")) {
    const rbase = join(tmpdir(), "hub-chats-real-" + process.pid);
    const r = makeChats({ dataDir: join(rbase, "data"), logDir: join(rbase, "logs"), noTools: true });
    const rget = (id) => r.list().find((x) => x.id === id);
    const rsettled = (id) => waitFor(() => { const x = rget(id); return x && x.state !== "working"; }, 180000);
    const one = await r.start({ project: "Hub", task: "Reply with exactly: HUB-ENGINE-ONE", model: "haiku", workflow: false });
    ok("real: start ok", one.ok === true);
    if (one.ok) {
      await rsettled(one.id);
      const R1 = rget(one.id);
      console.log(`real: session id ${R1.sessionId} (state ${R1.state}${R1.lastError ? ", error: " + R1.lastError : ""})`);
      ok("real: reply HUB-ENGINE-ONE and a session id", R1.state === "idle" && R1.lastReply.trim() === "HUB-ENGINE-ONE" && /^[0-9a-f-]{36}$/i.test(R1.sessionId || ""));
      const two = await r.answer({ id: one.id, text: "Reply with exactly: HUB-ENGINE-TWO" });
      ok("real: answer ok" + (two.ok ? "" : " (" + two.error + ")"), two.ok === true);
      if (two.ok) {
        await rsettled(one.id);
        const R2 = rget(one.id);
        console.log(`real: session id after the answer ${R2.sessionId} (state ${R2.state}${R2.lastError ? ", error: " + R2.lastError : ""})`);
        ok("real: reply HUB-ENGINE-TWO in the SAME session", R2.state === "idle" && R2.lastReply.trim() === "HUB-ENGINE-TWO" && R2.sessionId === R1.sessionId && R2.turns === 2);
      }
    }
    await waitFor(() => Object.keys(r.workingPids()).length === 0, 30000);
    try { rmSync(rbase, { recursive: true, force: true }); } catch { /* temp only */ }
  }

  // ===== D. real Remote Control checks (only with --real-rc; Hub folder, cheapest model, all tools off; only its own chats) =====
  if (process.argv.includes("--real-rc")) {
    const rbase = join(tmpdir(), "hub-chats-realrc-" + process.pid);
    const r = makeChats({ dataDir: join(rbase, "data"), logDir: join(rbase, "logs"), noTools: true });
    const g = (id) => r.list().find((x) => x.id === id);
    const created = new Set(); const names = new Set();
    const agentsReal = () => { try { const v = JSON.parse(execFileSync("claude", ["agents", "--json"], { encoding: "utf8", windowsHide: true, timeout: 15000 })); return Array.isArray(v) ? v : []; } catch { return null; } };
    const logsOf = (sid) => { try { return stripAnsi(execFileSync("claude", ["logs", sid.slice(0, 8)], { encoding: "utf8", windowsHide: true, timeout: 15000 })); } catch (e) { return stripAnsi(String((e && e.stdout) || "")); } };
    const hubFiles = () => { try { return new Set(readdirSync(join(homedir(), ".claude", "projects", encodeCwd(HUB))).filter((f) => f.endsWith(".jsonl"))); } catch { return new Set(); } };
    const rcActive = (sid) => waitFor(() => /remote-control is active/i.test(logsOf(sid)), 30000);
    const runningOurs = (l) => (l || []).filter((e) => e && e.pid && (created.has(e.sessionId) || names.has(e.name)));
    const noneRunning = () => { const l = agentsReal(); return l !== null && !runningOurs(l).length; };
    const note = (id) => { const x = g(id); if (x && x.sessionId) { created.add(x.sessionId); names.add(x.name); } return x; };
    try {
      // 1. start with Remote Control
      const one = await r.start({ project: "Hub", task: "Reply with exactly: HUB-RC-ONE", model: "haiku", remoteControl: true, workflow: false });
      ok("real-rc: start with Remote Control ok" + (one.ok ? "" : " (" + one.error + ")"), one.ok === true);
      if (one.ok) {
        const c1 = note(one.id);
        console.log(`real-rc: chat 1 session id ${c1.sessionId} (name "${c1.name}")`);
        const e1 = (agentsReal() || []).find((x) => x.sessionId === c1.sessionId);
        ok("real-rc: in `claude agents --json` with a pid; listed remoteControl true", !!(e1 && e1.pid) && c1.remoteControl === true);
        ok("real-rc: idle after its first turn, reply HUB-RC-ONE (read from the saved chat file)", (await waitFor(() => g(one.id).state === "idle", 120000)) && g(one.id).lastReply.trim() === "HUB-RC-ONE");
        ok("real-rc: `claude logs` says Remote Control is active", (await rcActive(c1.sessionId)));
        ok("real-rc: answer refused while Remote Control is on", (await r.answer({ id: one.id, text: "Reply with exactly: NO" })).error === RC_ANSWER_REFUSED);
        // 2. off, wait for no pid, answer with -p --resume
        const t0 = Date.now(); const off = await r.setRemoteControl({ id: one.id, on: false });
        console.log(`real-rc: switch off took ${Date.now() - t0} ms: ${off.ok ? off.message : off.error}`);
        ok("real-rc: switch off ok; no pid for it any more; listed off and idle", off.ok === true && noneRunning() && g(one.id).remoteControl === false && g(one.id).state === "idle");
        const two = await r.answer({ id: one.id, text: "Reply with exactly: HUB-RC-TWO" });
        ok("real-rc: answer after off ok" + (two.ok ? "" : " (" + two.error + ")"), two.ok === true);
        await waitFor(() => g(one.id).state !== "working", 180000);
        const c2 = g(one.id);
        console.log(`real-rc: chat 1 session id after the answer ${c2.sessionId} (state ${c2.state}${c2.lastError ? ", error: " + c2.lastError : ""})`);
        ok("real-rc: reply HUB-RC-TWO in the SAME session", c2.state === "idle" && c2.lastReply.trim() === "HUB-RC-TWO" && c2.sessionId === c1.sessionId);
        // 3. on again (woken with its saved options)
        const filesBefore = hubFiles();
        const on = await r.setRemoteControl({ id: one.id, on: true });
        console.log(`real-rc: switch on again: ${on.ok ? on.message : on.error}`);
        const run3 = (agentsReal() || []).filter((x) => x.pid && x.name === c1.name);
        run3.forEach((x) => created.add(x.sessionId));
        const newFiles = [...hubFiles()].filter((f) => !filesBefore.has(f));
        console.log(`real-rc: running under its name after on: ${run3.map((x) => x.sessionId).join(", ") || "none"}; new chat files in the Hub folder: ${newFiles.join(", ") || "none"}`);
        ok("real-rc: on again continues the SAME session (one running chat, same id, no file for a copy)", on.ok === true && g(one.id).remoteControl === true && g(one.id).sessionId === c1.sessionId && run3.length === 1 && run3[0].sessionId === c1.sessionId && !newFiles.some((f) => run3.some((x) => f.startsWith(x.sessionId)) || f.startsWith(c1.sessionId)));
        ok("real-rc: on again: `claude logs` says Remote Control is active", (await rcActive(c1.sessionId)));
        const s1 = await r.stop({ id: one.id });
        ok("real-rc: stop of the Remote Control chat ok; no pid left", s1.ok === true && noneRunning());
      }
      // 4. a plain Hub chat switched on (it never ran in the background: the flags, same session)
      const p = await r.start({ project: "Hub", task: "Reply with exactly: HUB-RC-PLAIN", model: "haiku", workflow: false });
      ok("real-rc: plain chat start ok", p.ok === true);
      if (p.ok) {
        await waitFor(() => g(p.id).state !== "working", 180000);
        const p1 = note(p.id);
        console.log(`real-rc: chat 2 session id ${p1.sessionId} (state ${p1.state}, reply ${JSON.stringify(p1.lastReply)})`);
        const filesBefore = hubFiles();
        const on = await r.setRemoteControl({ id: p.id, on: true });
        console.log(`real-rc: plain chat switch on: ${on.ok ? on.message : on.error}`);
        const run4 = (agentsReal() || []).filter((x) => x.pid && (x.name === p1.name || x.sessionId === p1.sessionId));
        run4.forEach((x) => created.add(x.sessionId));
        const newFiles = [...hubFiles()].filter((f) => !filesBefore.has(f));
        ok("real-rc: plain chat on continues the SAME session", on.ok === true && g(p.id).remoteControl === true && g(p.id).sessionId === p1.sessionId && run4.length === 1 && run4[0].sessionId === p1.sessionId && !newFiles.some((f) => f.startsWith(p1.sessionId)));
        ok("real-rc: plain chat on: `claude logs` says Remote Control is active", (await rcActive(p1.sessionId)));
        const off = await r.setRemoteControl({ id: p.id, on: false });
        ok("real-rc: plain chat off again ok; no pid left", off.ok === true && noneRunning());
      }
    } catch (err) { ok("real-rc crashed: " + (err && err.stack), false); }
    finally {
      // ALWAYS: stop every chat this test created (only those: their session ids or their unique names), then wait for no pid.
      for (const x of r.list()) if (x.sessionId) { created.add(x.sessionId); names.add(x.name); }
      for (const e of runningOurs(agentsReal())) {
        if (typeof e.id === "string" && BG_ID_RE.test(e.id) && typeof e.sessionId === "string" && e.sessionId.startsWith(e.id)) {
          try { execFileSync("claude", ["stop", e.id], { encoding: "utf8", windowsHide: true, timeout: 15000 }); console.log(`real-rc: cleanup stopped ${e.id}`); } catch { console.log(`real-rc: cleanup could not stop ${e.id}`); }
          created.add(e.sessionId);
        }
      }
      await waitFor(() => { const l = agentsReal(); return l !== null && !runningOurs(l).length; }, 20000);
      await waitFor(() => Object.keys(r.workingPids()).length === 0, 60000);
      console.log(`real-rc: every session id this test created: ${[...created].join(", ") || "none"}`);
      ok("real-rc: none of the test's chats left running", noneRunning());
      try { rmSync(rbase, { recursive: true, force: true }); } catch { /* temp only */ }
    }
  }
  process.exitCode = bad ? 1 : 0;
}
