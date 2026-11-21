// Answer a CLOSED app chat from the Hub (Phase 17, step 17.5, decision D54).
// "Closed" = the Claude app has a record for the chat (T14) but no program runs it. The answer goes into the SAME chat through
// `claude -p --resume <saved-file id>`, run by the Hub, ONLY when the D49 rule holds (docs/reference/CLAUDE_CONTROL.md, "Added 2026-11-21"):
//   1. the saved-file id is NOT in `claude agents --json` (and that list could be read);
//   2. the app record exists, is not archived, and its folder is a project folder (the folder the Hub runs claude in);
//   3. the saved chat file has not changed for at least 60 seconds;
//   4. at most one answer per chat at a time (this module's own busy list);
//   5. right AFTER the run the open list is read again: if the chat appeared meanwhile, the result says "may be split".
// Also refused: Remote Control on (not tested; answer on the phone), a chat that is one of the Hub's own chats.
// Every check is done by code right before sending; nothing about the chat (id, folder) is taken from the page, only the app id and the text.
//   node tools/dashboard/lib/appanswer.mjs --selftest     (fakes only: never runs the real claude, never touches a real chat)
import { spawn, spawnSync, execFile } from "node:child_process";
import { statSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAppRecords } from "./chatlist.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUSNUS = resolve(HERE, "..", "..", "..", "..");
export const MAX_TEXT = 4000;            // the same limit as chat-answer (lib/chats.mjs MAX_TEXT); the self-test checks they still match
export const QUIET_MS = 60_000;          // rule 3: the saved file must be this quiet
export const RUN_MS = 10 * 60_000;       // time limit for one answer (a real task with tools can take minutes)
const PERMISSION_MODE = "auto";          // the same fixed mode as the Hub's own answer (D39, lib/chats.mjs); nothing can change it
const APP_ID_RE = /^local_[0-9a-f-]{8,64}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encodeCwd = (p) => String(p).replace(/[^A-Za-z0-9]/g, "-"); // how Claude names a folder's chat-file folder (chats.mjs and chatlist.mjs do the same)
const clip = (s, n) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const logSafe = (s, n = 70) => String(s ?? "-").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, n) || "-";

/** Every refusal, in plain words (the page shows them as they are). */
export const SAY = {
  unknown: "The Hub does not know that chat. Look at the page again.",
  text: `The answer must be 1 to ${MAX_TEXT} characters.`,
  noFileId: "This chat has no saved file the Hub can find, so nothing was sent. Open it in the app.",
  hubChat: "This is a Hub chat: answer it in its own box.",
  archived: "This chat is archived in the app, so nothing was sent. Unarchive it there first.",
  folder: "This chat does not run in a project folder (for example a worktree), so the Hub can not answer it. Answer it in the app.",
  rc: "Remote Control is on for this chat: answer it on your phone.",
  busy: "The Hub is already answering this chat. Wait for that answer to finish.",
  listUnreadable: "Can't check whether this chat is open in the app, so nothing was sent. Try again in a moment.",
  open: "This chat is open in the app: answer it there, so it does not split in two.",
  noFile: "Can't find this chat's saved file, so nothing was sent. Open it in the app.",
  recent: "The chat changed less than a minute ago, so nothing was sent. Try again in a moment.",
  done: "Done: Claude answered in the same chat.",
  maySplit: "Claude replied, but the chat may be split: check it in the app.",
  copy: "Claude answered in a copy of the chat, not the chat itself: check it in the app.",
  timeout: `Claude took longer than ${Math.round(RUN_MS / 60000)} minutes, so the Hub stopped it. Check the chat in the app.`,
};

/** The arguments of one answer: the SAME flags as the Hub's own windowless answer (lib/chats.mjs turnArgs), never the text. */
export function answerArgs(sessionId) {
  return ["-p", "--output-format", "json", "--permission-mode", PERMISSION_MODE, "--permission-prompts", "none", "--resume", sessionId];
}

/** The project folder the record's folder IS (a folder directly inside root), or null (a subfolder, a worktree, root itself, elsewhere). */
export function projectFolder(cwd, root) {
  if (typeof cwd !== "string" || !cwd || typeof root !== "string" || !root) return null;
  const n = (p) => p.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  const ci = process.platform === "win32";
  const eq = (a, b) => (ci ? a.toLowerCase() === b.toLowerCase() : a === b);
  const c = n(cwd), i = c.lastIndexOf("/");
  if (i < 0 || !eq(c.slice(0, i), n(root))) return null;
  const name = c.slice(i + 1);
  if (!name || name === "." || name === "..") return null;
  let dirs = [];
  try { dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return null; }
  const hit = dirs.find((d) => eq(d, name));
  return hit ? join(root, hit) : null;
}

/** The result object of a `claude -p --output-format json` run, or null. */
export function parseResult(out) {
  const t = String(out || "").trim();
  if (!t) return null;
  try { const o = JSON.parse(t); if (o && o.type === "result") return o; } catch { /* look line by line */ }
  const lines = t.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const at = lines[i].indexOf("{");
    if (at < 0) continue;
    try { const o = JSON.parse(lines[i].slice(at)); if (o && o.type === "result") return o; } catch { /* not it */ }
  }
  return null;
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

/** Run one answer: argument list (no shell), the text on standard input only, no window, killed after timeoutMs. */
export function runClaude({ prog = ["claude"], cwd, sessionId, text, timeoutMs = RUN_MS }) {
  return new Promise((done) => {
    let out = "", err = "", fin = false, child = null, timedOut = false;
    const end = (code) => { if (fin) return; fin = true; clearTimeout(timer); done({ code, out, err, timedOut, pid: child && child.pid }); };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child && child.pid && process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 10000 });
        else if (child) child.kill();
      } catch { /* gone */ }
      setTimeout(() => end("timeout"), 300);
    }, timeoutMs);
    try { child = spawn(prog[0], [...prog.slice(1), ...answerArgs(sessionId)], { cwd, env: process.env, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (e) { err = String(e && e.message || e); end("spawn"); return; }
    child.stdout.on("data", (d) => { if (out.length < (2 << 20)) out += d; });
    child.stderr.on("data", (d) => { if (err.length < 65536) err += d; });
    child.on("error", (e) => { err += String(e && e.message || e); end("spawn"); });
    child.on("close", (code) => end(code));
    child.stdin.on("error", () => { /* it ended before reading: the output says why */ });
    child.stdin.end(text, "utf8");
  });
}

/** The live open-chats list (`claude agents --json`), or null when it cannot be read. Read-only. */
function makeListOpen(prog) {
  return () => new Promise((done) => {
    try {
      execFile(prog[0], [...prog.slice(1), "agents", "--json"], { timeout: 5000, windowsHide: true, shell: false, encoding: "utf8", maxBuffer: 8 << 20 }, (e, out) => {
        if (e) return done(null);
        try { const j = JSON.parse(out); done(Array.isArray(j) ? j : Array.isArray(j && j.agents) ? j.agents : null); } catch { done(null); }
      });
    } catch { done(null); }
  });
}

/**
 * The engine. Every outside piece can be replaced (the self-tests use fakes for all of them):
 *  listOpen()          -> array | null (null or a throw = can't read)        default: `claude agents --json`
 *  appRecords()        -> the app records (T14)                               default: chatlist.readAppRecords()
 *  hubChats()          -> the Hub's own chats ({ sessionId })                 default: none
 *  fileMtime(cwd, sid) -> ms | null (the saved chat file's last change)       default: ~/.claude/projects/<encoded cwd>/<sid>.jsonl
 *  run({ cwd, sessionId, text, timeoutMs }) -> { code, out, err, timedOut }   default: runClaude with `claude`
 *  root (the projects folder), now(), log(action, id, result), redact(text), quietMs, timeoutMs
 */
export function makeAppAnswer(opts = {}) {
  const prog = Array.isArray(opts.claude) ? opts.claude.slice() : [opts.claude || "claude"];
  const root = opts.root || BUSNUS;
  const sessionsDir = opts.sessionsDir || join(homedir(), ".claude", "projects");
  const listOpen = opts.listOpen || makeListOpen(prog);
  const appRecords = opts.appRecords || (() => readAppRecords());
  const hubChats = opts.hubChats || (() => []);
  const fileMtime = opts.fileMtime || ((cwd, sid) => { try { return statSync(join(sessionsDir, encodeCwd(cwd), sid + ".jsonl")).mtimeMs; } catch { return null; } });
  const run = opts.run || ((o) => runClaude({ prog, ...o }));
  const now = opts.now || (() => Date.now());
  const log = typeof opts.log === "function" ? opts.log : () => {};
  const redact = typeof opts.redact === "function" ? opts.redact : (s) => s;
  const quietMs = Number.isFinite(opts.quietMs) ? opts.quietMs : QUIET_MS;
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : RUN_MS;
  const busy = new Set(); // rule 4: saved-file ids being answered right now

  const note = (id, result) => { try { log("chat-answer-app", logSafe(id), result); } catch { /* logging never breaks an answer */ } };
  const refuse = (id, error) => { note(id, "refused: " + error); return { ok: false, status: "refused", error }; };

  async function readOpen() {
    let timer;
    try {
      const v = await Promise.race([Promise.resolve().then(() => listOpen()), new Promise((_, no) => { timer = setTimeout(() => no(new Error("timeout")), 6000); })]);
      return Array.isArray(v) ? v : null;
    } catch { return null; } finally { clearTimeout(timer); }
  }
  const listed = (open, sid) => open.some((e) => e && e.sessionId === sid);

  /** Rule 2 (+ Remote Control, + not a Hub chat), on a FRESH read of the records. Returns { rec, folder } or { error }. */
  function recordCheck(appId) {
    let recs = [];
    try { recs = appRecords(); } catch { recs = []; }
    const rec = (Array.isArray(recs) ? recs : []).find((r) => r && r.sessionId === appId);
    if (!rec) return { error: SAY.unknown };
    if (rec.isArchived === true) return { error: SAY.archived };
    if (typeof rec.cliSessionId !== "string" || !UUID_RE.test(rec.cliSessionId)) return { error: SAY.noFileId };
    let hubs = [];
    try { hubs = hubChats() || []; } catch { hubs = []; }
    if (hubs.some((h) => h && h.sessionId === rec.cliSessionId)) return { error: SAY.hubChat };
    const folder = projectFolder(rec.cwd, root);
    if (!folder) return { error: SAY.folder };
    if (rec.remoteControlUserEnabled === true) return { error: SAY.rc };
    return { rec, folder };
  }

  async function answer({ appId, text } = {}) {
    if (typeof appId !== "string" || !APP_ID_RE.test(appId)) return refuse("-", SAY.unknown);
    const t = typeof text === "string" ? text.trim() : "";
    if (t.length < 1 || t.length > MAX_TEXT) return refuse(appId, SAY.text);
    const first = recordCheck(appId);
    if (first.error) return refuse(appId, first.error);
    const sid = first.rec.cliSessionId;
    if (busy.has(sid)) return refuse(appId, SAY.busy);                       // rule 4
    busy.add(sid);                                                            // taken BEFORE the first wait: a second click is refused at once
    try {
      const open = await readOpen();                                          // rule 1
      if (!open) return refuse(appId, SAY.listUnreadable);
      if (listed(open, sid)) return refuse(appId, SAY.open);
      const again = recordCheck(appId);                                       // rule 2 again: the list took a moment
      if (again.error) return refuse(appId, again.error);
      if (again.rec.cliSessionId !== sid) return refuse(appId, SAY.unknown);
      const m = fileMtime(again.rec.cwd, sid);                                // rule 3
      if (typeof m !== "number" || !Number.isFinite(m)) return refuse(appId, SAY.noFile);
      if (now() - m < quietMs) return refuse(appId, SAY.recent);
      // nothing waits between the checks above and the start below
      let r;
      try { r = await run({ cwd: again.folder, sessionId: sid, text: t, timeoutMs }); } catch (e) { r = { code: "spawn", out: "", err: String(e && e.message || e) }; }
      r = r || {};
      const after = await readOpen();                                         // rule 5
      const split = !after || listed(after, sid);
      const res = parseResult(r.out);
      const reply = res && typeof res.result === "string" ? clip(redact(res.result), 1400) : "";
      const refused = res ? refusedLines(res.permission_denials).map((x) => clip(redact(x), 160)) : [];
      if (r.timedOut) { note(appId, `failed: time limit${split ? " may-split" : ""}`); return { ok: false, status: "failed", error: SAY.timeout, reply, refused }; }
      const bad = !res || res.is_error === true || (res.subtype && res.subtype !== "success") || (r.code !== 0 && r.code !== null);
      if (bad) {
        const line = String(reply || (res && res.subtype) || r.err || r.out || "").split(/\r?\n/).map((x) => x.trim()).find(Boolean) || "it ended without a reply.";
        note(appId, `failed: exit ${logSafe(r.code, 12)}${split ? " may-split" : ""}`);
        return { ok: false, status: "failed", error: clip(redact(`Claude could not answer: ${line}`), 600) + (split ? " " + SAY.maySplit : ""), reply: "", refused };
      }
      if (typeof res.session_id === "string" && res.session_id !== sid) { note(appId, "ok copy"); return { ok: true, status: "may-split", message: SAY.copy, reply, refused }; }
      if (split) { note(appId, `ok may-split${after ? "" : " (open list unreadable after the run)"}`); return { ok: true, status: "may-split", message: SAY.maySplit, reply, refused }; }
      note(appId, "ok done");
      return { ok: true, status: "done", message: SAY.done, reply, refused };
    } finally { busy.delete(sid); }
  }

  return { answer, busyCount: () => busy.size };
}

// ---------- self-test: fakes only (fake records, fake open list, fake file times, fake runs or a fake claude program) ----------
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv.includes("--selftest")) {
  const fs = await import("node:fs"); const os = await import("node:os");
  let ok = 0, total = 0;
  const check = (n, c, x = "") => { total++; if (c) { ok++; console.log("OK   " + n); } else console.log("FAIL " + n + (x ? "  " + x : "")); };
  const tmp = fs.mkdtempSync(join(os.tmpdir(), "hub-appanswer-"));
  const root = join(tmp, "BUSNUS");
  for (const d of ["Alpha", "Beta", join("Alpha", "sub")]) fs.mkdirSync(join(root, d), { recursive: true });
  const U = (n) => `${String(n).repeat(8).slice(0, 8)}-1111-4222-8333-444455556666`;
  const T = Date.parse("2026-11-21T12:00:00Z");
  const recs = [
    { sessionId: "local_a0000001-0001", cliSessionId: U(1), cwd: join(root, "Alpha"), isArchived: false, remoteControlUserEnabled: false },
    { sessionId: "local_a0000002-0002", cliSessionId: U(2), cwd: join(root, "Alpha"), isArchived: true, remoteControlUserEnabled: false },
    { sessionId: "local_a0000003-0003", cliSessionId: U(3), cwd: join(root, "Alpha", "sub"), isArchived: false },
    { sessionId: "local_a0000004-0004", cliSessionId: U(4), cwd: join(root, "Alpha"), isArchived: false, remoteControlUserEnabled: true },
    { sessionId: "local_a0000005-0005", cliSessionId: U(5), cwd: root, isArchived: false },
    { sessionId: "local_a0000006-0006", cliSessionId: "not-a-uuid", cwd: join(root, "Alpha"), isArchived: false },
    { sessionId: "local_a0000007-0007", cliSessionId: U(7), cwd: join(tmp, "Elsewhere", "Alpha"), isArchived: false },
    { sessionId: "local_a0000008-0008", cliSessionId: U(8), cwd: join(root, "Beta"), isArchived: false },
    { sessionId: "local_a0000009-0009", cliSessionId: U(9), cwd: join(root, "Gone"), isArchived: false },
  ];
  let open = [], openAfter = null, mtimes = {}, runs = [], logs = [], runImpl = null, hubs = [];
  const okResult = (sid, text) => ({ code: 0, out: JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: sid, result: "ECHO: " + text, permission_denials: [] }), err: "" });
  const fresh = () => {
    open = []; openAfter = null; runs = []; logs = []; runImpl = null; hubs = [];
    mtimes = Object.fromEntries(recs.map((r) => [r.cliSessionId, T - 61_000]));
  };
  const eng = (extra = {}) => makeAppAnswer({
    root, now: () => T, redact: (s) => String(s).replace(/SECRET\w*/g, "[hidden]"), log: (...a) => logs.push(a.join(" ")),
    appRecords: () => recs, hubChats: () => hubs,
    listOpen: async () => { if (open === "throw") throw new Error("agents failed"); return open; },
    fileMtime: (cwd, sid) => (sid in mtimes ? mtimes[sid] : null),
    run: async (o) => { runs.push(o); if (runImpl) return runImpl(o); return okResult(o.sessionId, o.text); },
    ...extra,
  });
  const A = "local_a0000001-0001";

  // the happy path and what goes to the run
  fresh(); let e = eng(); let r = await e.answer({ appId: A, text: "  Hello SECRET1 there  " });
  check("closed chat, all 5 rules hold: sent once, status done", r.ok === true && r.status === "done" && r.message === SAY.done && runs.length === 1, JSON.stringify(r));
  check("run gets the record's saved-file id, the PROJECT folder, the trimmed text (cwd, id never from the request)", runs[0].sessionId === U(1) && runs[0].cwd === join(root, "Alpha") && runs[0].text === "Hello SECRET1 there" && runs[0].timeoutMs === RUN_MS);
  check("reply returned, redacted and clipped", r.reply === "ECHO: Hello [hidden] there");
  check("one log line, no answer text in it", logs.length === 1 && logs[0] === "chat-answer-app local_a0000001-0001 ok done" && !logs.join().includes("Hello"));
  check("busy list empty after the run", e.busyCount() === 0);

  // rule 1
  fresh(); e = eng(); open = [{ sessionId: U(1), kind: "interactive", pid: 123, status: "idle" }];
  r = await e.answer({ appId: A, text: "x" });
  check("rule 1: chat in the open list -> refused, nothing run", r.ok === false && r.error === SAY.open && runs.length === 0);
  fresh(); e = eng(); open = [{ sessionId: U(1) }];
  check("rule 1: listed even without a pid -> refused", (await e.answer({ appId: A, text: "x" })).error === SAY.open && runs.length === 0);
  fresh(); e = eng(); open = "throw";
  r = await e.answer({ appId: A, text: "x" });
  check("rule 1: open list can't be read (error) -> refused, nothing run", r.ok === false && r.error === SAY.listUnreadable && runs.length === 0);
  fresh(); e = eng({ listOpen: async () => ({ not: "a list" }) });
  check("rule 1: open list not a list -> refused", (await e.answer({ appId: A, text: "x" })).error === SAY.listUnreadable && runs.length === 0);
  fresh(); e = eng(); open = [{ sessionId: U(8), pid: 5 }];
  check("rule 1: OTHER chats in the open list do not block", (await e.answer({ appId: A, text: "x" })).ok === true && runs.length === 1);

  // rule 2
  fresh(); e = eng();
  check("rule 2: unknown app id -> refused", (await e.answer({ appId: "local_ffffffff-0000", text: "x" })).error === SAY.unknown && runs.length === 0);
  check("rule 2: archived -> refused", (await e.answer({ appId: "local_a0000002-0002", text: "x" })).error === SAY.archived && runs.length === 0);
  check("rule 2: folder is a subfolder (worktree-like) -> refused", (await e.answer({ appId: "local_a0000003-0003", text: "x" })).error === SAY.folder && runs.length === 0);
  check("rule 2: folder is the projects folder itself -> refused", (await e.answer({ appId: "local_a0000005-0005", text: "x" })).error === SAY.folder && runs.length === 0);
  check("rule 2: same-named folder elsewhere -> refused", (await e.answer({ appId: "local_a0000007-0007", text: "x" })).error === SAY.folder && runs.length === 0);
  check("rule 2: project folder that does not exist -> refused", (await e.answer({ appId: "local_a0000009-0009", text: "x" })).error === SAY.folder && runs.length === 0);
  check("record without a real saved-file id -> refused", (await e.answer({ appId: "local_a0000006-0006", text: "x" })).error === SAY.noFileId && runs.length === 0);
  check("a different project folder is fine (Beta)", (await e.answer({ appId: "local_a0000008-0008", text: "x" })).ok === true && runs.length === 1 && runs[0].cwd === join(root, "Beta"));
  fresh(); e = eng();
  check("Remote Control on -> refused (answer on the phone)", (await e.answer({ appId: "local_a0000004-0004", text: "x" })).error === SAY.rc && runs.length === 0);
  fresh(); hubs = [{ id: "h-x", sessionId: U(1) }]; e = eng();
  check("a Hub chat's session -> refused", (await e.answer({ appId: A, text: "x" })).error === SAY.hubChat && runs.length === 0);
  // record archived WHILE the open list was read: the second look refuses
  fresh(); { let n = 0; const recs2 = () => (n++ === 0 ? recs : recs.map((x) => (x.sessionId === A ? { ...x, isArchived: true } : x))); e = eng({ appRecords: recs2 }); }
  check("rule 2 checked again right before sending (archived meanwhile) -> refused", (await e.answer({ appId: A, text: "x" })).error === SAY.archived && runs.length === 0);

  // rule 3
  fresh(); mtimes[U(1)] = T - 59_000; e = eng();
  check("rule 3: saved file changed 59 s ago -> refused", (await e.answer({ appId: A, text: "x" })).error === SAY.recent && runs.length === 0);
  fresh(); mtimes[U(1)] = T - 61_000; e = eng();
  check("rule 3: saved file changed 61 s ago -> sent", (await e.answer({ appId: A, text: "x" })).ok === true && runs.length === 1);
  fresh(); mtimes[U(1)] = T - 60_000; e = eng();
  check("rule 3: exactly 60 s -> sent", (await e.answer({ appId: A, text: "x" })).ok === true);
  fresh(); delete mtimes[U(1)]; e = eng();
  check("rule 3: no saved file -> refused", (await e.answer({ appId: A, text: "x" })).error === SAY.noFile && runs.length === 0);
  fresh(); mtimes[U(1)] = T + 5000; e = eng();
  check("rule 3: file time in the future -> refused", (await e.answer({ appId: A, text: "x" })).error === SAY.recent && runs.length === 0);

  // rule 4
  fresh(); { const releases = []; runImpl = (o) => new Promise((d) => { releases.push(() => d(okResult(o.sessionId, o.text))); }); e = eng();
    const p1 = e.answer({ appId: A, text: "first" });
    await new Promise((d) => setTimeout(d, 30));
    const r2 = await e.answer({ appId: A, text: "second" });
    check("rule 4: a second answer while the first runs -> refused, only one run", r2.ok === false && r2.error === SAY.busy && runs.length === 1 && e.busyCount() === 1);
    const p3 = e.answer({ appId: "local_a0000008-0008", text: "other chat" });
    await new Promise((d) => setTimeout(d, 30));
    check("rule 4: another chat is not blocked by it (both run)", runs.length === 2 && e.busyCount() === 2);
    releases.forEach((f) => f());
    const [r1, r3] = await Promise.all([p1, p3]);
    check("rule 4: both finish normally; busy list empty again", r1.ok === true && r3.ok === true && e.busyCount() === 0);
  }
  fresh(); { let release; runImpl = (o) => new Promise((d) => { release = () => d(okResult(o.sessionId, o.text)); }); e = eng();
    const p1 = e.answer({ appId: A, text: "first" }); const p2 = e.answer({ appId: A, text: "same moment" });
    const r2 = await p2;
    check("rule 4: two clicks in the same moment -> the second is refused at once", r2.error === SAY.busy);
    await new Promise((d) => setTimeout(d, 20)); release(); await p1;
    runImpl = null;
    const r4 = await e.answer({ appId: A, text: "later" });
    check("rule 4: after it finished, the chat can be answered again", runs.length === 2 && r4.ok === true);
  }
  fresh(); runImpl = async () => { throw new Error("boom"); }; e = eng();
  r = await e.answer({ appId: A, text: "x" });
  check("a run that throws -> failed in words, busy list freed", r.ok === false && r.status === "failed" && r.error.startsWith("Claude could not answer") && e.busyCount() === 0);

  // rule 5
  fresh(); runImpl = (o) => { open = [{ sessionId: U(1), kind: "interactive", pid: 9 }]; return okResult(o.sessionId, o.text); }; e = eng();
  r = await e.answer({ appId: A, text: "x" });
  check("rule 5: chat appeared in the open list during the run -> 'may be split', not 'done'", r.ok === true && r.status === "may-split" && r.message === SAY.maySplit && r.reply === "ECHO: x" && logs[0].endsWith("ok may-split"));
  fresh(); runImpl = (o) => { open = "throw"; return okResult(o.sessionId, o.text); }; e = eng();
  check("rule 5: open list unreadable after the run -> 'may be split' (can't prove it is not)", (await e.answer({ appId: A, text: "x" })).status === "may-split");
  fresh(); runImpl = (o) => ({ ...okResult(o.sessionId, o.text), out: JSON.stringify({ type: "result", subtype: "success", session_id: U(8), result: "hi" }) }); e = eng();
  r = await e.answer({ appId: A, text: "x" });
  check("Claude reported another session id -> 'answered in a copy', not 'done'", r.status === "may-split" && r.message === SAY.copy);
  fresh(); runImpl = (o) => { open = [{ sessionId: U(1) }]; return { code: 1, out: "Something broke", err: "" }; }; e = eng();
  r = await e.answer({ appId: A, text: "x" });
  check("a failed run that also split says both", r.ok === false && r.error.includes("Something broke") && r.error.endsWith(SAY.maySplit));
  fresh(); runImpl = () => ({ code: 0, out: JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, session_id: U(1), result: "Model unavailable SECRET2" }), err: "" }); e = eng();
  r = await e.answer({ appId: A, text: "x" });
  check("Claude's own error -> failed, redacted", r.ok === false && r.error.includes("Model unavailable") && !r.error.includes("SECRET2"));
  fresh(); runImpl = () => ({ code: "timeout", out: "", err: "", timedOut: true }); e = eng();
  check("time limit -> failed with the time-limit words", (await e.answer({ appId: A, text: "x" })).error === SAY.timeout);

  // input
  fresh(); e = eng();
  check("text empty / blanks / over 4000 / not text -> refused", [await e.answer({ appId: A, text: "" }), await e.answer({ appId: A, text: "   " }), await e.answer({ appId: A, text: "x".repeat(MAX_TEXT + 1) }), await e.answer({ appId: A, text: 5 })].every((x) => x.error === SAY.text) && runs.length === 0);
  check("text of exactly 4000 -> sent", (await e.answer({ appId: A, text: "y".repeat(MAX_TEXT) })).ok === true && runs.length === 1);
  fresh(); e = eng();
  check("malformed app ids refused (link, path, number, missing)", [await e.answer({ appId: "claude://claude.ai/epitaxy/" + A, text: "x" }), await e.answer({ appId: "local_../x", text: "x" }), await e.answer({ appId: 5, text: "x" }), await e.answer({ text: "x" }), await e.answer()].every((x) => x.ok === false && x.error === SAY.unknown) && runs.length === 0);
  check("refusals are logged without the text", logs.length === 5 && logs.every((l) => l.startsWith("chat-answer-app ") && l.includes("refused:")));

  // the flags match the Hub's own answer (lib/chats.mjs), and so does the length limit
  const chatsSrc = fs.readFileSync(join(HERE, "chats.mjs"), "utf8");
  check("same flags as chats.mjs's answer: -p, json, auto mode, no prompts, --resume <id>; the text is not among them",
    chatsSrc.includes('const PERMISSION_MODE = "auto";') && chatsSrc.includes('const a = ["-p", "--output-format", "json", "--permission-mode", PERMISSION_MODE, "--permission-prompts", "none"];')
    && chatsSrc.includes('else a.push("--resume", c.sessionId);') && answerArgs(U(1)).join(" ") === `-p --output-format json --permission-mode auto --permission-prompts none --resume ${U(1)}`);
  check("same text limit as chats.mjs", chatsSrc.includes(`const MAX_TEXT = ${MAX_TEXT};`));

  // the real run and list code, against a FAKE claude program (node), never the real one
  const fake = join(tmp, "fake-claude.mjs");
  fs.writeFileSync(fake, `
const argv = process.argv.slice(2);
if (argv[0] === "agents") { process.stdout.write(process.env.HUB_FAKE_AGENTS || "[]"); }
else {
  let input = ""; process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (input += d));
  process.stdin.on("end", () => {
    const wait = input.includes("SLOWEST") ? 30000 : 50;
    setTimeout(() => {
      if (input.includes("NOJSON")) { process.stdout.write("Something broke before any result.\\n"); process.exitCode = 1; return; }
      const i = argv.indexOf("--resume");
      process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: argv[i + 1], result: "FAKE: " + input + " | ARGS: " + argv.join(" ") + " | CWD: " + process.cwd(), permission_denials: input.includes("DENY") ? [{ tool_name: "Bash", tool_input: { command: "rm -rf build" } }] : [] }) + "\\n");
    }, wait);
  });
}
`);
  const prog = [process.execPath, fake];
  const rr = await runClaude({ prog, cwd: join(root, "Alpha"), sessionId: U(1), text: "Hi \"there\" & | < > %PATH% --model opus", timeoutMs: 15000 });
  const pr = parseResult(rr.out);
  check("fake program: text arrives on standard input exactly, not as an argument; no shell (special characters untouched)", pr && pr.result.startsWith("FAKE: Hi \"there\" & | < > %PATH% --model opus | ARGS: ") && !pr.result.split(" | ARGS: ")[1].split(" | CWD")[0].includes("Hi"), rr.out.slice(0, 300));
  check("fake program: arguments are exactly the answer flags; runs in the project folder", pr && pr.result.includes(" | ARGS: " + answerArgs(U(1)).join(" ") + " | CWD: ") && pr.result.toLowerCase().endsWith(join(root, "Alpha").toLowerCase()));
  const slow = Date.now(); const rt = await runClaude({ prog, cwd: join(root, "Alpha"), sessionId: U(1), text: "SLOWEST", timeoutMs: 700 });
  check("fake program: the time limit stops a run that takes too long", rt.timedOut === true && Date.now() - slow < 8000);
  const eFake = makeAppAnswer({ claude: prog, root, appRecords: () => recs, fileMtime: () => T - 120_000, now: () => T, log: () => {}, redact: (s) => String(s) });
  process.env.HUB_FAKE_AGENTS = JSON.stringify([{ sessionId: U(8), pid: 1 }]);
  r = await eFake.answer({ appId: A, text: "DENY please" });
  check("whole path with the fake program: done, reply and refused tools come back", r.ok === true && r.status === "done" && r.reply.startsWith("FAKE: DENY please") && r.refused.length === 1 && r.refused[0] === "Bash: rm -rf build", JSON.stringify(r).slice(0, 300));
  process.env.HUB_FAKE_AGENTS = JSON.stringify({ agents: [{ sessionId: U(1), pid: 1 }] });
  check("default open list reader understands { agents: [...] } and refuses an open chat", (await eFake.answer({ appId: A, text: "x" })).error === SAY.open);
  process.env.HUB_FAKE_AGENTS = "not json";
  check("default open list reader: garbage -> can't read -> refused", (await eFake.answer({ appId: A, text: "x" })).error === SAY.listUnreadable);
  process.env.HUB_FAKE_AGENTS = "[]";
  r = await eFake.answer({ appId: A, text: "NOJSON" });
  check("fake program printing no result -> failed in words", r.ok === false && r.error.startsWith("Claude could not answer: Something broke"));
  const eMissing = makeAppAnswer({ claude: [join(tmp, "no-such-program.exe")], root, appRecords: () => recs, listOpen: async () => [], fileMtime: () => T - 120_000, now: () => T });
  r = await eMissing.answer({ appId: A, text: "x" });
  check("claude program missing -> failed in words, no crash", r.ok === false && r.status === "failed");
  // default file-time reader: looks only at <sessions>/<encoded cwd>/<id>.jsonl
  const sdir = join(tmp, "sessions"); fs.mkdirSync(join(sdir, encodeCwd(join(root, "Alpha"))), { recursive: true });
  const sf = join(sdir, encodeCwd(join(root, "Alpha")), U(1) + ".jsonl"); fs.writeFileSync(sf, "{}\n");
  const realNow = Date.now(); fs.utimesSync(sf, new Date(realNow - 61_000), new Date(realNow - 61_000));
  let seen = 0;
  const eFile = makeAppAnswer({ root, sessionsDir: sdir, appRecords: () => recs, listOpen: async () => [], now: () => realNow, run: async (o) => { seen++; return okResult(o.sessionId, o.text); } });
  check("default file-time reader: a quiet saved file (61 s) -> sent", (await eFile.answer({ appId: A, text: "x" })).ok === true && seen === 1);
  fs.utimesSync(sf, new Date(realNow - 59_000), new Date(realNow - 59_000));
  check("default file-time reader: 59 s -> refused", (await eFile.answer({ appId: A, text: "x" })).error === SAY.recent && seen === 1);
  check("default file-time reader: chat of another folder has no file -> refused", (await eFile.answer({ appId: "local_a0000008-0008", text: "x" })).error === SAY.noFile && seen === 1);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${ok}/${total}`);
  process.exit(ok === total ? 0 : 1);
}
