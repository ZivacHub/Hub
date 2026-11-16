// Chat engine (plan Phase 14, step 14.1). Starts, answers and stops "Hub chats": windowless Claude chats run through the
// `claude` command line. One TURN = one `claude -p --output-format json` process in the project's folder; the task or
// answer goes in on standard input (never on a command line, never through a shell). The engine only ever continues
// session ids it created itself, never sends into a chat that is open anywhere else (docs/reference/CLAUDE_CONTROL.md
// T9 / T13), and logs every action without the text. Contract: docs/plan/phases/14-run-chats-from-the-hub.md.
//   node tools/dashboard/lib/chats.mjs --selftest          pretend claude: fast, uses no Claude allowance
//   node tools/dashboard/lib/chats.mjs --selftest --real   also ONE real round trip (cheapest model, all tools off)
import { spawn, spawnSync, execFile } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, openSync, closeSync, readdirSync, renameSync, statSync, rmSync } from "node:fs";
import { join, dirname, resolve, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomBytes, randomUUID } from "node:crypto";

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

const clip = (s, n) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const pad = (n) => String(n).padStart(2, "0");
const logSafe = (s, n = 40) => String(s ?? "-").replace(/\s+/g, "_").replace(/[^\w.()\-]/g, "?").slice(0, n) || "-";

export function makeChats(opts = {}) {
  const root = opts.root || BUSNUS;
  const dataDir = opts.dataDir || join(HUB, "data");
  const logDir = opts.logDir || join(HUB, "logs");
  const prog = Array.isArray(opts.claude) ? opts.claude.slice() : [opts.claude || "claude"]; // [program, ...first arguments]
  const maxWorking = Number.isInteger(opts.maxWorking) && opts.maxWorking > 0 ? opts.maxWorking : 2; // D41
  const redact = typeof opts.redact === "function" ? opts.redact : (s) => s;
  const noTools = opts.noTools === true; // tests only: every turn runs with `--tools ""` (all tools off)
  const statePath = join(dataDir, "hub_chats.json");
  const turnDir = join(dataDir, "chats");
  const image = (() => { const b = basename(prog[0]).toLowerCase(); return process.platform === "win32" && !extname(b) ? b + ".exe" : b; })();

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
    if (!r) { c.state = "failed"; c.lastError = clip(lines.length ? lines[lines.length - 1] : "The chat ended without a reply.", 600); c.refused = []; return false; }
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
      if (c.state !== "working" || alive(c.pid)) continue;
      applyTurn(c); changed = true;
      log("chat-end", c.id, c.project, c.state);
    }
    if (changed) writeState(st);
    return st;
  }
  const working = (st) => Object.values(st.chats).filter((c) => c.state === "working" && alive(c.pid)).length;
  const busyMessage = () => `${maxWorking === 2 ? "Two" : maxWorking} chats are already working. Wait for one to finish.`;

  // ---------- one turn ----------
  function turnArgs(c, first) {
    const a = ["-p", "--output-format", "json", "--permission-mode", PERMISSION_MODE, "--permission-prompts", "none"];
    if (first) a.push("--session-id", c.sessionId, "--name", c.name); else a.push("--resume", c.sessionId);
    if (c.model) a.push("--model", c.model);
    if (c.noTools) a.push("--tools", ""); // last: --tools takes a list
    return a;
  }
  function launch(c, text, first) {
    mkdirSync(turnDir, { recursive: true });
    const file = join(turnDir, `${c.id}-t${(c.turns || 0) + 1}.log`);
    const fd = openSync(file, "w");
    let child;
    try {
      child = spawn(prog[0], [...prog.slice(1), ...turnArgs(c, first)], { cwd: join(root, c.project), env: process.env, detached: true, windowsHide: true, shell: false, stdio: ["pipe", fd, fd] });
    } catch (err) { closeSync(fd); return { error: "Could not start Claude: " + err.message }; }
    closeSync(fd);
    child.on("error", (err) => log("chat-error", c.id, c.project, logSafe(err.code || err.message, 60)));
    if (!child.pid) return { error: "Could not start Claude (the claude program was not found)." };
    child.stdin.on("error", () => { /* the process ended before reading: the turn file shows why */ });
    child.stdin.end(text, "utf8");
    child.unref();
    return { pid: child.pid, file };
  }
  function beginTurn(c, l) {
    c.state = "working"; c.pid = l.pid; c.turnFile = l.file; c.turns = (c.turns || 0) + 1;
    c.lastTurnAt = new Date().toISOString(); c.lastError = ""; c.refused = [];
  }

  // ---------- the actions ----------
  async function start({ project, task, model, remoteControl } = {}) {
    const pe = projectError(project);
    if (pe) return fail("chat-start", "-", project, pe);
    const t = cleanText(task);
    if (!textOk(t)) return fail("chat-start", "-", project, `The task must be 1 to ${MAX_TEXT} characters.`);
    const m = model === undefined || model === null || model === "" ? null : model;
    if (m !== null && !MODELS.includes(m)) return fail("chat-start", "-", project, `Unknown model. Pick one of: ${MODELS.join(", ")}.`);
    if (remoteControl) return fail("chat-start", "-", project, "Remote Control for Hub chats comes in step 14.6.");
    const st = settle(readState());
    if (working(st) >= maxWorking) return fail("chat-start", "-", project, busyMessage());
    const d = new Date();
    const c = {
      id: newId(), project, name: `Hub · ${project} · ${d.getDate()} ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      task: clip(t, 300), model: m, remoteControl: false, noTools, state: "working", startedAt: d.toISOString(), lastTurnAt: d.toISOString(),
      turns: 0, sessionId: randomUUID(), lastReply: "", lastError: "", refused: [], pid: null, turnFile: null, seq: ++st.seq,
    };
    while (st.chats[c.id]) c.id = newId();
    const l = launch(c, t, true);
    if (l.error) return fail("chat-start", c.id, project, l.error);
    beginTurn(c, l);
    st.chats[c.id] = c; writeState(st);
    log("chat-start", c.id, project, `ok pid ${l.pid}${m ? " model " + m : ""}`);
    return { ok: true, id: c.id, message: `Started a chat in ${project}.` };
  }

  function notAnswerable(c) {
    if (!c.sessionId) return "This chat has no Claude session to continue.";
    if (c.state === "working") return "This chat is still working. Wait for it to finish, or stop it.";
    if (c.state === "stopped" && ours(c.pid)) return "The stopped chat is still closing. Try again in a few seconds.";
    return "";
  }

  async function answer({ id, text } = {}) {
    if (typeof id !== "string" || !ID_RE.test(id)) return fail("chat-answer", id, "-", "Unknown chat.");
    let st = settle(readState()); let c = st.chats[id];
    if (!c) return fail("chat-answer", id, "-", "Unknown chat.");
    const t = cleanText(text);
    if (!textOk(t)) return fail("chat-answer", id, c.project, `The answer must be 1 to ${MAX_TEXT} characters.`);
    let why = notAnswerable(c);
    if (why) return fail("chat-answer", id, c.project, why);
    if (working(st) >= maxWorking) return fail("chat-answer", id, c.project, busyMessage());
    // Rule 3 (T9): never write into a chat that is open anywhere else. If the list cannot be read, nothing is sent.
    let open;
    try {
      let timer;
      open = await Promise.race([Promise.resolve().then(() => listOpen()), new Promise((_, no) => { timer = setTimeout(() => no(new Error("timeout")), 6000); })]).finally(() => clearTimeout(timer));
      if (!Array.isArray(open)) throw new Error("not a list");
    } catch { return fail("chat-answer", id, c.project, "Can't check whether the chat is open elsewhere, so nothing was sent."); }
    if (open.some((e) => e && e.sessionId === c.sessionId && (e.pid || e.kind === "interactive")))
      return fail("chat-answer", id, c.project, "This chat is open somewhere else (the Claude app or a terminal). Answer it there, so the chat does not split.");
    // The check above waited: look again before sending.
    st = settle(readState()); c = st.chats[id];
    if (!c) return fail("chat-answer", id, "-", "Unknown chat.");
    why = notAnswerable(c);
    if (why) return fail("chat-answer", id, c.project, why);
    if (working(st) >= maxWorking) return fail("chat-answer", id, c.project, busyMessage());
    const l = launch(c, t, false);
    if (l.error) return fail("chat-answer", id, c.project, l.error);
    beginTurn(c, l); writeState(st);
    log("chat-answer", id, c.project, `ok pid ${l.pid} turn ${c.turns}`);
    return { ok: true, message: `Sent to the chat in ${c.project}.` };
  }

  async function stop({ id } = {}) {
    if (typeof id !== "string" || !ID_RE.test(id)) return fail("chat-stop", id, "-", "Unknown chat.");
    const st = settle(readState()); const c = st.chats[id];
    if (!c) return fail("chat-stop", id, "-", "Unknown chat.");
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

  function list() {
    const st = settle(readState());
    return Object.values(st.chats).sort((a, b) => (b.seq || 0) - (a.seq || 0)).map((c) => ({
      id: c.id, project: c.project, name: c.name, task: clip(redact(c.task || ""), 300), model: c.model || null, remoteControl: false,
      state: c.state, startedAt: c.startedAt, lastTurnAt: c.lastTurnAt, turns: c.turns || 0, sessionId: c.sessionId || null,
      lastReply: clip(redact(c.lastReply || ""), 1400), lastError: clip(redact(c.lastError || ""), 600),
      refused: (c.refused || []).slice(0, 10).map((r) => clip(redact(r), 160)),
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

  /** { id: pid } of the turns that are running (game mode slows them like other Hub programs). */
  function workingPids() {
    const out = {};
    for (const c of Object.values(readState().chats)) if (c.state === "working" && alive(c.pid)) out[c.id] = c.pid;
    return out;
  }

  return { start, answer, stop, list, workingPids, appLink };
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
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const argv = process.argv.slice(2);
const get = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  const dir = process.env.HUB_FAKE_DIR;
  if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "call-" + Date.now() + "-" + process.pid + ".json"), JSON.stringify({ argv, input, cwd: process.cwd() })); }
  const wait = input.includes("SLOWEST") ? 30000 : input.includes("SLOW") ? 2500 : 200;
  setTimeout(() => {
    if (input.includes("NOISE")) process.stderr.write("a warning on standard error\\n");
    if (input.includes("NOJSON")) { process.stdout.write("Something broke before any result.\\n"); process.exitCode = 1; return; }
    const failed = input.includes("FAIL");
    const denials = input.includes("DENY") ? [{ tool_name: "Bash", tool_use_id: "t1", tool_input: { command: "rm -rf build" } }, { tool_name: "Write", tool_use_id: "t2", tool_input: { file_path: "C:\\\\x\\\\notes.txt" } }] : [];
    process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: failed, session_id: get("--session-id") || get("--resume"),
      result: failed ? "Pretend failure: the model is unavailable." : "ECHO: " + input, permission_denials: denials }) + "\\n");
    process.exitCode = failed ? 1 : 0;
  }, wait);
});
`);
  process.env.HUB_FAKE_DIR = recDir;
  let openList = [];
  const listOpen = async () => { if (openList === "throw") throw new Error("agents list failed"); return openList; };
  const redact = (s) => String(s).replace(/SECRET\w*/g, "[hidden]");
  const mk = () => makeChats({ root: projects, dataDir: join(base, "data"), logDir: join(base, "logs"), claude: [process.execPath, fake], listOpen, redact });
  const c = mk();
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
    const rc = await c.start({ project: "Fake", task: "hi", remoteControl: true });
    ok("remoteControl refused with the 14.6 message", rc.ok === false && rc.error === "Remote Control for Hub chats comes in step 14.6.");
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
    ok("text not in the arguments", k1 && !k1.argv.some((x) => x.includes("MARKER") || x.includes("SECRET")));
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
  } catch (err) { ok("self-test crashed: " + (err && err.stack), false); }
  await waitFor(() => Object.keys(c.workingPids()).length === 0, 10000); // let every pretend process end first (Windows)
  try { rmSync(base, { recursive: true, force: true }); } catch { /* temp only */ }

  // ===== B. one real round trip (only with --real) =====
  if (process.argv.includes("--real")) {
    const rbase = join(tmpdir(), "hub-chats-real-" + process.pid);
    const r = makeChats({ dataDir: join(rbase, "data"), logDir: join(rbase, "logs"), noTools: true });
    const rget = (id) => r.list().find((x) => x.id === id);
    const rsettled = (id) => waitFor(() => { const x = rget(id); return x && x.state !== "working"; }, 180000);
    const one = await r.start({ project: "Hub", task: "Reply with exactly: HUB-ENGINE-ONE", model: "haiku" });
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
  process.exitCode = bad ? 1 : 0;
}
