// Live list of every Claude chat per project (phase 14, step 14.2). READ-ONLY.
// buildChats() is pure (no files, no processes); readChats() does the real reading (one read-only command: `claude agents --json`).
// Shape: see docs/plan/phases/14-run-chats-from-the-hub.md, "Chat list contract".
import { readdirSync, statSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { chatFileState } from "./attention.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, "..", "..", "..", "..");
const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
/** Remote Control from the app's own record: true, false, or null when the field is missing (unknown, never "off"). */
const rcOf = (rec) => (rec && typeof rec.remoteControlUserEnabled === "boolean" ? rec.remoteControlUserEnabled : null);
const iso = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const msOf = (s) => (s ? Date.parse(s) : 0) || 0;
const norm = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const APP_ID = /^local_[0-9a-f-]{8,64}$/i;
const SESSION_ID = /^[0-9a-fA-F-]{8,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Folder name directly under root that contains cwd, or null. */
function projectOf(cwd, root) {
  const r = norm(root), c = norm(cwd);
  if (!r || !c.startsWith(r + "/")) return null;
  const first = String(cwd).replace(/\\/g, "/").slice(r.length + 1).split("/")[0];
  return first || null;
}

const CLOSED_MAX = 12; // per project: the newest closed app chats that are listed (keeps the list and the per-refresh file reading small)
const numOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Pure. The app records that count as CLOSED chats: not archived, with a session id, not a Hub chat, not in the open list, cwd inside a project folder.
 *  At most CLOSED_MAX newest (by lastActivityAt, then createdAt) per project. Returns [{ project, rec }]. */
export function closedCandidates({ hubChats = [], open = [], appRecords = [], root } = {}) {
  const listed = new Set();
  for (const h of Array.isArray(hubChats) ? hubChats : []) if (h && h.sessionId) listed.add(String(h.sessionId));
  for (const e of Array.isArray(open) ? open : []) if (e && e.sessionId) listed.add(String(e.sessionId));
  const per = new Map();
  for (const r of Array.isArray(appRecords) ? appRecords : []) {
    if (!r || typeof r.cliSessionId !== "string" || !r.cliSessionId || r.isArchived === true || listed.has(r.cliSessionId)) continue;
    const project = projectOf(r.cwd, root);
    if (!project) continue;
    listed.add(r.cliSessionId); // the same session twice in the records: once
    if (!per.has(project)) per.set(project, []);
    per.get(project).push(r);
  }
  const t = (r) => numOrNull(r.lastActivityAt) ?? numOrNull(r.createdAt) ?? 0;
  const out = [];
  for (const [project, list] of per) for (const rec of list.sort((a, b) => t(b) - t(a)).slice(0, CLOSED_MAX)) out.push({ project, rec });
  return out;
}

/**
 * Pure. hubChats: engine list() items; open: `claude agents --json` entries; appRecords: the six fields of the app records;
 * states: { [sessionId]: { state, at, why, snippet, title } }; live: { [sessionId]: "busy"|"idle"|"waiting" } from the running program's own live files
 * (only for OPEN chats; missing = the old rule from the agents list). Returns { max, working, openListOk, projects }.
 */
export function buildChats({ hubChats = [], open = [], appRecords = [], states = {}, live = {}, root, now = Date.now(), maxWorking = 2, openListOk = true, redact = (s) => String(s ?? "") } = {}) {
  const red = (s, n) => clip(String(redact(String(s ?? ""))), n);
  const st = (sid) => (sid && states && typeof states === "object" ? states[sid] : null) || null;
  const needs = (x) => !!x && (x.state === "question" || x.state === "permission");
  const byProject = new Map();
  const add = (project, chat) => { if (!byProject.has(project)) byProject.set(project, []); byProject.get(project).push(chat); };
  const hubSessions = new Set();
  let working = 0;

  for (const h of Array.isArray(hubChats) ? hubChats : []) {
    if (!h || typeof h !== "object") continue;
    const state = ["working", "idle", "failed", "stopped"].includes(h.state) ? h.state : "idle";
    if (state === "working") working++;
    if (h.sessionId) hubSessions.add(String(h.sessionId));
    const s = st(h.sessionId);
    const nm = needs(s);
    const rc = h.remoteControl === true; // 14.6: a background chat reachable from the phone; the Hub never answers it
    const rest = state === "idle" || state === "failed" || state === "stopped";
    add(String(h.project ?? ""), {
      id: String(h.id ?? ""), kind: "hub", name: red(h.name, 80), state,
      needsYou: nm, why: nm ? s.state : "",
      snippet: nm ? red(s.snippet, 220) : state === "failed" ? red(h.lastError, 220) : "",
      remoteControl: rc, since: iso(h.startedAt), lastActive: iso(h.lastTurnAt) ?? iso(h.startedAt), model: h.model ? String(h.model) : null,
      turns: typeof h.turns === "number" ? h.turns : null,
      canAnswer: rest && !rc,
      // T7b: moves the chat into the Claude app; only for a resting chat with Remote Control off and a real session id
      openLink: rest && !rc && typeof h.sessionId === "string" && UUID.test(h.sessionId) ? "claude://resume?session=" + h.sessionId : null,
      lastReply: red(h.lastReply, 1400),
      refused: (Array.isArray(h.refused) ? h.refused : []).map((x) => red(x, 160)),
    });
  }

  const appBySession = new Map();
  for (const r of Array.isArray(appRecords) ? appRecords : []) {
    if (!r || typeof r.cliSessionId !== "string" || r.isArchived === true) continue;
    if (!appBySession.has(r.cliSessionId)) appBySession.set(r.cliSessionId, r);
  }

  for (const e of Array.isArray(open) ? open : []) {
    if (!e || typeof e !== "object" || !e.sessionId) continue;
    const sid = String(e.sessionId);
    if (hubSessions.has(sid)) continue;
    const project = projectOf(e.cwd, root);
    if (!project) continue;
    const rec = appBySession.get(sid) || null;
    const s = st(sid);
    const lv = live && typeof live === "object" && Object.prototype.hasOwnProperty.call(live, sid) ? live[sid] : null;
    const waiting = lv === "waiting";
    const nm = needs(s) || waiting;
    const state = lv === "busy" ? "working" : lv === "waiting" ? "waiting" : lv === "idle" ? "idle" : e.status === "busy" ? "working" : "idle";
    add(project, {
      id: "s-" + sid.slice(0, 8), kind: rec ? "app" : "terminal",
      name: red(rec && rec.title ? rec.title : e.name, 80),
      state,
      needsYou: nm, why: nm ? (needs(s) ? s.state : "question") : "", snippet: needs(s) ? red(s.snippet, 220) : "",
      remoteControl: rec ? rcOf(rec) : null, // true / false from the app record, null = the record does not say
      since: iso(e.startedAt), lastActive: (s && iso(s.at)) || iso(e.startedAt), model: null, turns: null, canAnswer: false,
      openLink: rec && typeof rec.sessionId === "string" && APP_ID.test(rec.sessionId) ? "claude://claude.ai/epitaxy/" + rec.sessionId : null,
      lastReply: "", refused: [],
    });
  }

  // closed app chats: the app's own records of chats that are not running any more (no answer box here; open them in the app)
  for (const { project, rec } of closedCandidates({ hubChats, open, appRecords, root })) {
    const s = st(rec.cliSessionId);
    const nm = needs(s);
    add(project, {
      id: "s-" + rec.cliSessionId.slice(0, 8), kind: "app", name: red(rec.title || "Chat", 80), state: "closed",
      needsYou: nm, why: nm ? s.state : "", snippet: nm ? red(s.snippet, 220) : "",
      remoteControl: rcOf(rec), // true / false / null (record does not say)
      since: iso(rec.createdAt), lastActive: iso(rec.lastActivityAt) ?? iso(rec.createdAt), model: null, turns: null, canAnswer: false,
      openLink: typeof rec.sessionId === "string" && APP_ID.test(rec.sessionId) ? "claude://claude.ai/epitaxy/" + rec.sessionId : null,
      lastReply: "", refused: [],
    });
  }

  const rank = (c) => (c.needsYou ? 0 : c.state === "working" ? 1 : 2);
  const projects = [];
  for (const [project, chats] of byProject) {
    chats.sort((a, b) => rank(a) - rank(b) || msOf(b.lastActive) - msOf(a.lastActive));
    projects.push({
      project, chats,
      _needs: chats.some((c) => c.needsYou), _work: chats.some((c) => c.state === "working"), _t: Math.max(...chats.map((c) => msOf(c.lastActive))),
    });
  }
  projects.sort((a, b) => (b._needs - a._needs) || (b._work - a._work) || b._t - a._t || a.project.localeCompare(b.project));
  return { max: maxWorking, working, openListOk: openListOk !== false, projects: projects.map(({ project, chats }) => ({ project, chats })) };
}

// ---------- the real reading ----------
const encode = (p) => String(p).replace(/[^A-Za-z0-9]/g, "-");
let liveCache = null; // { key, at, map }
/** Reads the running program's live files (%USERPROFILE%\.claude\sessions\<pid>.json), READ-ONLY. Takes ONLY sessionId and status; nothing else is kept or shown.
 *  Cached 4 s. Returns { [sessionId]: "busy"|"idle"|"waiting" }; any problem = fewer entries (never throws). Not checkable: a stale file of a dead process
 *  (we do not test whether the pid is alive); that is harmless because only chats in the agents list use it. */
export function readLiveSessions(dir) {
  try {
    const d = dir || join(homedir(), ".claude", "sessions");
    const key = String(d);
    if (liveCache && liveCache.key === key && Date.now() - liveCache.at < 4000) return liveCache.map;
    const map = {};
    let names = [];
    try { names = readdirSync(d); } catch { names = []; }
    for (const f of names) {
      if (!/^\d+\.json$/.test(f)) continue;
      try {
        const j = JSON.parse(readFileSync(join(d, f), "utf8"));
        if (!j || typeof j.sessionId !== "string" || !SESSION_ID.test(j.sessionId)) continue;
        if (j.status === "busy" || j.status === "idle" || j.status === "waiting") map[j.sessionId] = j.status;
      } catch { /* corrupt: skip */ }
    }
    liveCache = { key, at: Date.now(), map };
    return map;
  } catch { return {}; }
}
let slowCache = null; // { at, open, openListOk, appRecords }
const recCache = new Map(); // file -> { mtimeMs, rec }

function readOpenList() {
  return new Promise((res) => {
    try {
      execFile("claude", ["agents", "--json"], { timeout: 5000, windowsHide: true, shell: false, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
        if (err) return res(null);
        try { const j = JSON.parse(out); const arr = Array.isArray(j) ? j : Array.isArray(j && j.agents) ? j.agents : null; res(arr); } catch { res(null); }
      });
    } catch { res(null); }
  });
}

function readAppRecords(baseDir) {
  const out = [];
  try {
    const base = baseDir || join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Claude-Data");
    const ls = (d) => { try { return readdirSync(d); } catch { return []; } };
    for (const d of ls(base).filter((n) => n.startsWith("claude_"))) {
      const sess = join(base, d, "claude-code-sessions");
      for (const a of ls(sess)) for (const b of ls(join(sess, a))) for (const f of ls(join(sess, a, b))) {
        if (!/^local_.*\.json$/.test(f)) continue;
        const p = join(sess, a, b, f);
        try {
          const mt = statSync(p).mtimeMs;
          const hit = recCache.get(p);
          if (hit && hit.mtimeMs === mt) { if (hit.rec) out.push(hit.rec); continue; }
          const j = JSON.parse(readFileSync(p, "utf8"));
          const rec = { sessionId: j.sessionId, cliSessionId: j.cliSessionId, cwd: j.cwd, title: j.title, isArchived: j.isArchived, remoteControlUserEnabled: j.remoteControlUserEnabled, lastActivityAt: numOrNull(j.lastActivityAt), createdAt: numOrNull(j.createdAt) };
          recCache.set(p, { mtimeMs: mt, rec });
          out.push(rec);
        } catch { /* unreadable: skip */ }
      }
    }
  } catch { /* less data */ }
  return out;
}

/** Reads the app records (read-only, file-time cached). Exported for the server's "open in the app" check. */
export { readAppRecords };

/** Pure. The link the SERVER may open for one chat, or null. Exactly one of appId / hubId counts.
 *  appId must look like local_<id> AND be the id of a (not archived) app record; hubId must be a resting (idle / failed / stopped) Hub chat
 *  with Remote Control off and a real session id. The link is always built here, never taken from the page. */
export function openLinkFor({ appId, hubId } = {}, { appRecords = [], hubChats = [] } = {}) {
  if ((appId === undefined) === (hubId === undefined)) return null;
  if (appId !== undefined) {
    if (typeof appId !== "string" || !APP_ID.test(appId)) return null;
    const hit = (Array.isArray(appRecords) ? appRecords : []).find((r) => r && r.sessionId === appId && r.isArchived !== true);
    return hit ? "claude://claude.ai/epitaxy/" + appId : null;
  }
  if (typeof hubId !== "string" || !/^h-[A-Za-z0-9-]{1,60}$/.test(hubId)) return null;
  const c = (Array.isArray(hubChats) ? hubChats : []).find((x) => x && x.id === hubId);
  if (!c || !["idle", "failed", "stopped"].includes(c.state) || c.remoteControl === true) return null;
  return typeof c.sessionId === "string" && UUID.test(c.sessionId) ? "claude://resume?session=" + c.sessionId : null;
}

const linkCache = new Map(); // base ("" = real folder) -> { at, bySession: Map }
/** Synchronous, cached (8 s): the "open in the app" link for a saved chat (its file name = the app record's cliSessionId), or null.
 *  Uses the same app-records reader as readChats. baseDir is only for self-tests (a folder shaped like Claude-Data). Never throws. */
export function appLinkForSession(cliSessionId, baseDir) {
  try {
    if (typeof cliSessionId !== "string" || !SESSION_ID.test(cliSessionId)) return null;
    const key = baseDir ? String(baseDir) : "";
    let c = linkCache.get(key);
    if (!c || Date.now() - c.at >= 8000) {
      const bySession = new Map();
      for (const r of readAppRecords(baseDir || undefined)) {
        if (!r || typeof r.cliSessionId !== "string" || r.isArchived === true) continue;
        if (!bySession.has(r.cliSessionId)) bySession.set(r.cliSessionId, r);
      }
      c = { at: Date.now(), bySession }; linkCache.set(key, c);
    }
    const rec = c.bySession.get(cliSessionId);
    return rec && typeof rec.sessionId === "string" && APP_ID.test(rec.sessionId) ? "claude://claude.ai/epitaxy/" + rec.sessionId : null;
  } catch { return null; }
}

export async function readChats({ hubChats = [], redact = (s) => String(s ?? ""), root = DEFAULT_ROOT, maxWorking } = {}) {
  try {
    if (!slowCache || Date.now() - slowCache.at >= 8000) {
      const open = await readOpenList();
      slowCache = { at: Date.now(), open: open || [], openListOk: open !== null, appRecords: readAppRecords() };
    }
    const hubs = Array.isArray(hubChats) ? hubChats : [];
    const states = {};
    const look = (sid, cwd) => {
      try {
        if (typeof sid !== "string" || !SESSION_ID.test(sid) || states[sid] !== undefined || !cwd) return;
        const r = chatFileState(join(homedir(), ".claude", "projects", encode(cwd), sid + ".jsonl"));
        if (r) states[sid] = r;
      } catch { /* skip */ }
    };
    for (const e of slowCache.open) if (e && projectOf(e.cwd, root)) look(e.sessionId, e.cwd);
    for (const h of hubs) if (h && h.project && h.sessionId) look(h.sessionId, join(root, String(h.project)));
    for (const { rec } of closedCandidates({ hubChats: hubs, open: slowCache.open, appRecords: slowCache.appRecords, root })) look(rec.cliSessionId, rec.cwd); // at most 12 per project
    const opts = { hubChats: hubs, open: slowCache.open, appRecords: slowCache.appRecords, states, live: readLiveSessions(), root, now: Date.now(), openListOk: slowCache.openListOk, redact };
    if (typeof maxWorking === "number") opts.maxWorking = maxWorking;
    return { generatedAt: new Date().toISOString(), ...buildChats(opts) };
  } catch {
    return { generatedAt: new Date().toISOString(), max: typeof maxWorking === "number" ? maxWorking : 2, working: 0, openListOk: false, projects: [] };
  }
}

// ---------- self-test ----------
async function selftest() {
  let ok = 0, total = 0;
  const check = (name, cond, extra = "") => { total++; if (cond) { ok++; console.log("OK  " + name); } else console.log("FAIL " + name + (extra ? " " + extra : "")); };
  const NOW = Date.parse("2026-11-16T12:00:00Z");
  const ago = (min) => new Date(NOW - min * 60000).toISOString();
  const ROOT = "C:\\Proj";
  const hub = (o) => ({ id: "h-1", project: "Alpha", name: "Hub chat", task: "t", model: "haiku", remoteControl: false, state: "idle", startedAt: ago(60), lastTurnAt: ago(30), turns: 2, sessionId: "aaaaaaaa-0000-1111", lastReply: "ok", lastError: "", refused: [], ...o });
  const ent = (o) => ({ pid: 1, cwd: "C:\\Proj\\Alpha", kind: "interactive", startedAt: NOW - 3600000, sessionId: "bbbbbbbb-1111-2222", name: "term", status: "idle", ...o });
  const rec = (o) => ({ sessionId: "local_abcdef12-3456", cliSessionId: "bbbbbbbb-1111-2222", cwd: "C:\\Proj\\Alpha", title: "App title", isArchived: false, remoteControlUserEnabled: true, ...o });
  const b = (o) => buildChats({ root: ROOT, now: NOW, ...o });
  const all = (r) => r.projects.flatMap((p) => p.chats);
  const one = (o) => all(b(o))[0];

  const e0 = b({});
  check("empty input", e0.projects.length === 0 && e0.max === 2 && e0.working === 0 && e0.openListOk === true);
  check("garbage input tolerated", b({ hubChats: [null, 3], open: [null, {}], appRecords: [null] }).projects.length === 0);

  // kinds
  const k = all(b({ hubChats: [hub({})], open: [ent({}), ent({ sessionId: "cccccccc-1", name: "t2" })], appRecords: [rec({})] }));
  check("three kinds", k.filter((c) => c.kind === "hub").length === 1 && k.filter((c) => c.kind === "app").length === 1 && k.filter((c) => c.kind === "terminal").length === 1);
  const app = k.find((c) => c.kind === "app"), term = k.find((c) => c.kind === "terminal");
  check("app: name from record, id, link, rc", app.name === "App title" && app.id === "s-bbbbbbbb" && app.openLink === "claude://claude.ai/epitaxy/local_abcdef12-3456" && app.remoteControl === true && !app.canAnswer);
  check("terminal: name, rc null, no link", term.name === "t2" && term.remoteControl === null && term.openLink === null && term.model === null && term.turns === null && term.lastReply === "" && term.refused.length === 0);
  check("remoteControl false for app", one({ open: [ent({})], appRecords: [rec({ remoteControlUserEnabled: false })] }).remoteControl === false);
  check("remoteControl missing = null (unknown) for app, never false", one({ open: [ent({})], appRecords: [rec({ remoteControlUserEnabled: undefined })] }).remoteControl === null && one({ open: [ent({})], appRecords: [rec({ remoteControlUserEnabled: "yes" })] }).remoteControl === null);
  check("remoteControl true for app", one({ open: [ent({})], appRecords: [rec({ remoteControlUserEnabled: true })] }).remoteControl === true);
  check("duplicate skipped", all(b({ hubChats: [hub({ sessionId: "bbbbbbbb-1111-2222" })], open: [ent({})] })).length === 1);
  check("entry name used when record has no title", one({ open: [ent({ name: "entry" })], appRecords: [rec({ title: "" })] }).name === "entry");

  // root matching
  check("outside root skipped", all(b({ open: [ent({ cwd: "C:\\Other\\Alpha" })] })).length === 0);
  check("root itself skipped", all(b({ open: [ent({ cwd: "C:\\Proj" })] })).length === 0);
  check("prefix-sibling skipped", all(b({ open: [ent({ cwd: "C:\\Proj2\\Alpha" })] })).length === 0);
  check("slash style and case match", b({ open: [ent({ cwd: "c:/proj/Alpha/sub" })] }).projects[0].project === "Alpha");
  check("project = first folder", b({ open: [ent({ cwd: "C:\\Proj\\Beta\\deep\\er" })] }).projects[0].project === "Beta");

  // app record matching
  check("archived record: terminal", one({ open: [ent({})], appRecords: [rec({ isArchived: true })] }).kind === "terminal");
  check("other session record: terminal", one({ open: [ent({})], appRecords: [rec({ cliSessionId: "zzz" })] }).kind === "terminal");
  check("bad app id: link null", one({ open: [ent({})], appRecords: [rec({ sessionId: "local_../x" })] }).openLink === null);
  check("non-local app id: link null", one({ open: [ent({})], appRecords: [rec({ sessionId: "abc-12345678" })] }).openLink === null);
  check("uppercase app id ok", one({ open: [ent({})], appRecords: [rec({ sessionId: "LOCAL_ABCDEF12" })] }).openLink === "claude://claude.ai/epitaxy/LOCAL_ABCDEF12");

  // busy / idle
  check("busy -> working", one({ open: [ent({ status: "busy" })] }).state === "working");
  check("idle -> idle", one({ open: [ent({ status: "idle" })] }).state === "idle");
  check("other status -> idle", one({ open: [ent({ status: "weird" })] }).state === "idle");
  check("since/lastActive from startedAt (number)", one({ open: [ent({})] }).since === new Date(NOW - 3600000).toISOString() && one({ open: [ent({})] }).lastActive === ago(60));

  // needsYou
  const stq = { "bbbbbbbb-1111-2222": { state: "question", at: NOW - 60000, snippet: "Which one?" } };
  const q = one({ open: [ent({})], states: stq });
  check("question needs you", q.needsYou && q.why === "question" && q.snippet === "Which one?" && q.lastActive === ago(1));
  check("permission needs you", one({ open: [ent({})], states: { "bbbbbbbb-1111-2222": { state: "permission", snippet: "ok?" } } }).why === "permission");
  const ni = one({ open: [ent({})], states: { "bbbbbbbb-1111-2222": { state: "idle", snippet: "x" } } });
  const nw = one({ open: [ent({})], states: { "bbbbbbbb-1111-2222": { state: "working", snippet: "x" } } });
  check("idle/working state: no alert, no snippet", !ni.needsYou && ni.why === "" && ni.snippet === "" && !nw.needsYou && nw.snippet === "");
  check("state with ISO at", one({ open: [ent({})], states: { "bbbbbbbb-1111-2222": { state: "idle", at: ago(5) } } }).lastActive === ago(5));
  check("hub chat needs you from states", one({ hubChats: [hub({})], states: { "aaaaaaaa-0000-1111": { state: "question", snippet: "Q" } } }).needsYou);

  // hub chats
  const hs = (state, extra) => one({ hubChats: [hub({ state, ...extra })] });
  check("hub fields", (() => { const c = hs("idle"); return c.kind === "hub" && c.id === "h-1" && c.name === "Hub chat" && c.since === ago(60) && c.lastActive === ago(30) && c.model === "haiku" && c.turns === 2 && c.lastReply === "ok" && c.remoteControl === false && c.openLink === null; })());
  check("canAnswer per state", hs("idle").canAnswer && hs("failed").canAnswer && hs("stopped").canAnswer && !hs("working").canAnswer);
  check("hub state passes through", ["working", "idle", "failed", "stopped"].every((s) => hs(s).state === s));
  check("failed snippet = lastError clipped", (() => { const c = hs("failed", { lastError: "E".repeat(400) }); return c.snippet.length === 220 && c.snippet.endsWith("…") && !c.needsYou && c.why === ""; })());
  check("idle hub: snippet empty", hs("idle", { lastError: "old" }).snippet === "");
  check("lastActive falls back to startedAt", hs("idle", { lastTurnAt: null }).lastActive === ago(60));
  check("refused lines clipped", (() => { const c = hs("idle", { refused: ["R".repeat(300), "short"] }); return c.refused.length === 2 && c.refused[0].length === 160 && c.refused[1] === "short"; })());
  check("lastReply clipped 1400", hs("idle", { lastReply: "L".repeat(2000) }).lastReply.length === 1400);

  // 14.6: Remote Control and "Open in the app" for Hub chats
  const U = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  check("hub open link: idle / failed / stopped with Remote Control off", ["idle", "failed", "stopped"].every((s) => hs(s, { sessionId: U }).openLink === "claude://resume?session=" + U));
  check("hub open link: uppercase UUID ok", hs("idle", { sessionId: U.toUpperCase() }).openLink === "claude://resume?session=" + U.toUpperCase());
  check("hub open link: none while working", hs("working", { sessionId: U }).openLink === null);
  check("hub open link: none with Remote Control on (any state)", ["working", "idle", "failed", "stopped"].every((s) => hs(s, { sessionId: U, remoteControl: true }).openLink === null));
  check("hub open link: none without a real UUID", [null, undefined, "", "aaaaaaaa-0000-1111", U + "x", "x" + U, U.replace(/-/g, ""), "../" + U, U + "&evil=1", 42].every((sid) => hs("idle", { sessionId: sid }).openLink === null));
  check("hub remoteControl passes through; true only for true", hs("idle", { remoteControl: true }).remoteControl === true && hs("idle", { remoteControl: "yes" }).remoteControl === false && hs("idle", { remoteControl: undefined }).remoteControl === false);
  check("hub with Remote Control on cannot be answered here", ["idle", "failed", "stopped", "working"].every((s) => hs(s, { sessionId: U, remoteControl: true }).canAnswer === false));
  check("app chat keeps its epitaxy link, hub chat gets the resume link", (() => { const r = all(b({ hubChats: [hub({ sessionId: U })], open: [ent({})], appRecords: [rec({})] })); return r.find((c) => c.kind === "app").openLink === "claude://claude.ai/epitaxy/local_abcdef12-3456" && r.find((c) => c.kind === "hub").openLink === "claude://resume?session=" + U; })());
  check("hub Remote Control chat also in the open list is listed once, as hub", (() => { const r = all(b({ hubChats: [hub({ sessionId: U, remoteControl: true, state: "working" })], open: [ent({ sessionId: U, kind: "background", status: "busy" })] })); return r.length === 1 && r[0].kind === "hub" && r[0].remoteControl === true && r[0].openLink === null; })());

  // redact + clip
  const fake = (s) => String(s).replace(/SECRET/g, "[hidden]");
  const rd = b({ redact: fake, hubChats: [hub({ name: "n SECRET", lastReply: "r SECRET", refused: ["x SECRET"], state: "failed", lastError: "e SECRET" })], open: [ent({ name: "t SECRET" })], states: { "bbbbbbbb-1111-2222": { state: "question", snippet: "s SECRET" } } });
  const rc = all(rd);
  check("redaction everywhere", rc.every((c) => !JSON.stringify(c).includes("SECRET")) && rc.some((c) => c.name === "n [hidden]") && rc.some((c) => c.snippet === "s [hidden]"));
  check("name clipped 80", one({ open: [ent({ name: "N".repeat(200) })] }).name.length === 80);
  check("redact before clip", one({ open: [ent({ name: "SECRET".repeat(30) })], }) && b({ redact: (s) => s.replace(/SECRET/g, ""), open: [ent({ name: "SECRET".repeat(30) })] }).projects[0].chats[0].name === "");

  // ordering
  const ord = b({
    hubChats: [hub({ id: "h-a", project: "Calm", state: "idle", lastTurnAt: ago(500), sessionId: "11111111-a" }), hub({ id: "h-b", project: "Busy", state: "working", lastTurnAt: ago(400), sessionId: "11111111-b" }), hub({ id: "h-c", project: "Fresh", state: "idle", lastTurnAt: ago(1), sessionId: "11111111-c" })],
    open: [ent({ cwd: "C:\\Proj\\Need", sessionId: "22222222-n", startedAt: NOW - 9e8 }), ent({ cwd: "C:\\Proj\\Need", sessionId: "22222222-w", status: "busy", startedAt: NOW - 8e8 }), ent({ cwd: "C:\\Proj\\Need", sessionId: "22222222-i1", startedAt: NOW - 7e8 }), ent({ cwd: "C:\\Proj\\Need", sessionId: "22222222-i2", startedAt: NOW - 1e8 })],
    states: { "22222222-n": { state: "question", snippet: "q" } },
  });
  check("project order: needs, working, newest", ord.projects.map((p) => p.project).join(",") === "Need,Busy,Fresh,Calm", ord.projects.map((p) => p.project).join(","));
  check("chat order: needs, working, rest newest first", ord.projects[0].chats.map((c) => c.id).join(",") === "s-22222222,s-22222222,s-22222222,s-22222222" && ord.projects[0].chats[0].needsYou && ord.projects[0].chats[1].state === "working" && msOf(ord.projects[0].chats[2].lastActive) > msOf(ord.projects[0].chats[3].lastActive));
  check("working count = hub working only", ord.working === 1 && b({ hubChats: [hub({ state: "working" }), hub({ id: "h-2", state: "working", sessionId: "x-2" })], open: [ent({ status: "busy" })] }).working === 2);
  check("max and openListOk pass through", (() => { const r = b({ maxWorking: 5, openListOk: false }); return r.max === 5 && r.openListOk === false; })());
  check("project without chats not listed", b({ hubChats: [], open: [ent({ cwd: "C:\\Elsewhere" })] }).projects.length === 0);

  // 14.10: closed app chats (the app's own records of chats that are not running)
  const T0 = NOW - 7200000;
  const crec = (o) => rec({ cliSessionId: "dddddddd-1111-2222", sessionId: "local_c0ffee00-0001", title: "Closed one", lastActivityAt: T0, createdAt: T0 - 3600000, ...o });
  const cl = all(b({ appRecords: [crec({})] }));
  check("closed: appears with state closed, kind app", cl.length === 1 && cl[0].kind === "app" && cl[0].state === "closed" && cl[0].id === "s-dddddddd");
  check("closed: fields", (() => { const c = cl[0]; return c.name === "Closed one" && c.openLink === "claude://claude.ai/epitaxy/local_c0ffee00-0001" && c.remoteControl === true && c.since === new Date(T0 - 3600000).toISOString() && c.lastActive === new Date(T0).toISOString() && c.canAnswer === false && c.model === null && c.turns === null && c.lastReply === "" && c.refused.length === 0 && !c.needsYou && c.snippet === ""; })());
  check("closed: lastActive falls back to createdAt", all(b({ appRecords: [crec({ lastActivityAt: undefined })] }))[0].lastActive === new Date(T0 - 3600000).toISOString());
  check("closed: archived record not listed", all(b({ appRecords: [crec({ isArchived: true })] })).length === 0);
  check("closed: record without a session id not listed", all(b({ appRecords: [crec({ cliSessionId: undefined }), crec({ cliSessionId: "" })] })).length === 0);
  check("closed: open chat not listed twice", (() => { const r = all(b({ open: [ent({ sessionId: "dddddddd-1111-2222" })], appRecords: [crec({})] })); return r.length === 1 && r[0].state === "idle"; })());
  check("closed: Hub chat not listed twice", (() => { const r = all(b({ hubChats: [hub({ sessionId: "dddddddd-1111-2222" })], appRecords: [crec({})] })); return r.length === 1 && r[0].kind === "hub"; })());
  check("closed: same session in two records once", all(b({ appRecords: [crec({}), crec({ sessionId: "local_c0ffee00-0002" })] })).length === 1);
  check("closed: record outside the projects folder skipped", all(b({ appRecords: [crec({ cwd: "C:\\Other\\Alpha" }), crec({ cwd: "C:\\Proj" }), crec({ cwd: "C:\\Proj2\\Alpha" })] })).length === 0);
  check("closed: project from the first folder", b({ appRecords: [crec({ cwd: "C:\\Proj\\Beta\\sub" })] }).projects[0].project === "Beta");
  check("closed: bad app id gives no link", all(b({ appRecords: [crec({ sessionId: "local_../x" })] }))[0].openLink === null);
  check("closed: remote control null when the record does not say; false and true kept", all(b({ appRecords: [crec({ remoteControlUserEnabled: undefined })] }))[0].remoteControl === null && all(b({ appRecords: [crec({ remoteControlUserEnabled: false })] }))[0].remoteControl === false && all(b({ appRecords: [crec({ remoteControlUserEnabled: true })] }))[0].remoteControl === true);
  check("closed: needs you when the saved state says question", (() => { const c = one({ appRecords: [crec({})], states: { "dddddddd-1111-2222": { state: "question", snippet: "Pick one?" } } }); return c.needsYou && c.why === "question" && c.snippet === "Pick one?"; })());
  check("closed: name redacted and clipped", (() => { const c = all(b({ redact: fake, appRecords: [crec({ title: "SECRET " + "x".repeat(200) })] }))[0]; return c.name.length === 80 && !c.name.includes("SECRET"); })());
  const many = Array.from({ length: 15 }, (_, i) => crec({ cliSessionId: "eeeeeeee-" + String(i).padStart(4, "0") + "-aaaa", sessionId: "local_ab" + String(i).padStart(6, "0"), title: "C" + i, lastActivityAt: NOW - (i + 1) * 60000 }));
  const mc = b({ appRecords: [...many, crec({ cwd: "C:\\Proj\\Beta" })] });
  const alphaClosed = mc.projects.find((p) => p.project === "Alpha").chats;
  check("closed: at most 12 per project, newest kept", alphaClosed.length === 12 && alphaClosed[0].name === "C0" && alphaClosed[11].name === "C11" && mc.projects.find((p) => p.project === "Beta").chats.length === 1);
  check("closed: candidates helper caps like the list", closedCandidates({ appRecords: [...many], root: ROOT }).length === 12);
  check("closed: order is needs-you, open ones, then closed", (() => { const r = b({ open: [ent({})], appRecords: [crec({}), crec({ cliSessionId: "ffffffff-1", sessionId: "local_f0000001", title: "Q" })], states: { "ffffffff-1": { state: "question", snippet: "?" } } }).projects[0].chats; return r[0].name === "Q" && r[1].kind === "terminal" && r[2].name === "Closed one"; })());

  // 14.11: which link the server may open
  {
    const recs = [{ sessionId: "local_abcdef12-3456", cliSessionId: "x-1" }, { sessionId: "local_deadbeef-0001", cliSessionId: "x-2", isArchived: true }];
    const hubs = [hub({ id: "h-ok", sessionId: U }), hub({ id: "h-work", state: "working", sessionId: U }), hub({ id: "h-rc", remoteControl: true, sessionId: U }), hub({ id: "h-bad", sessionId: "aaaaaaaa-0000-1111" })];
    const L = (a) => openLinkFor(a, { appRecords: recs, hubChats: hubs });
    check("openLinkFor: known app id", L({ appId: "local_abcdef12-3456" }) === "claude://claude.ai/epitaxy/local_abcdef12-3456");
    check("openLinkFor: unknown, archived, malformed, link-shaped app ids refused", ["local_00000000-0000", "local_deadbeef-0001", "local_../x", "claude://claude.ai/epitaxy/local_abcdef12-3456", "abc", "", 5, null].every((x) => L({ appId: x }) === null));
    check("openLinkFor: resting hub chat gives the resume link", L({ hubId: "h-ok" }) === "claude://resume?session=" + U);
    check("openLinkFor: working, remote-control, bad-session, unknown hub chats refused", ["h-work", "h-rc", "h-bad", "h-nope", "../h-ok", "h-ok&x=1", 5, null].every((x) => L({ hubId: x }) === null));
    check("openLinkFor: both or neither refused", L({}) === null && L({ appId: "local_abcdef12-3456", hubId: "h-ok" }) === null);
  }

  // appLinkForSession with made-up record files
  {
    const fs = await import("node:fs"); const os = await import("node:os");
    const base = fs.mkdtempSync(join(os.tmpdir(), "hub-applink-"));
    const dir = join(base, "claude_x", "claude-code-sessions", "a", "b"); fs.mkdirSync(dir, { recursive: true });
    const put = (n, o) => fs.writeFileSync(join(dir, n + ".json"), JSON.stringify({ title: "T", cwd: "C:\\x", ...o }));
    put("local_one", { sessionId: "local_abcdef12-3456", cliSessionId: "11111111-aaaa" });
    put("local_two", { sessionId: "local_deadbeef-0001", cliSessionId: "22222222-bbbb", isArchived: true });
    put("local_three", { sessionId: "local_../x", cliSessionId: "33333333-cccc" });
    check("appLinkForSession: found", appLinkForSession("11111111-aaaa", base) === "claude://claude.ai/epitaxy/local_abcdef12-3456");
    check("appLinkForSession: archived record gives null", appLinkForSession("22222222-bbbb", base) === null);
    check("appLinkForSession: bad session id gives null", [null, undefined, 5, "", "short", "../x", "11111111-aaaa/..", "zzzzzzzz-1"].every((s) => appLinkForSession(s, base) === null));
    check("appLinkForSession: unknown session gives null", appLinkForSession("99999999-ffff", base) === null);
    check("appLinkForSession: bad record id gives null", appLinkForSession("33333333-cccc", base) === null);
    fs.rmSync(base, { recursive: true, force: true });
  }

  // live state of OPEN chats (the running program's own session files)
  check("live busy -> working", one({ open: [ent({ status: "idle" })], live: { "bbbbbbbb-1111-2222": "busy" } }).state === "working");
  check("live idle beats agents busy -> idle", one({ open: [ent({ status: "busy" })], live: { "bbbbbbbb-1111-2222": "idle" } }).state === "idle");
  check("live waiting -> waiting, needs you, why question", (() => { const c = one({ open: [ent({ status: "idle" })], live: { "bbbbbbbb-1111-2222": "waiting" } }); return c.state === "waiting" && c.needsYou && c.why === "question" && c.snippet === ""; })());
  check("live waiting + saved permission -> why permission, snippet", (() => { const c = one({ open: [ent({})], live: { "bbbbbbbb-1111-2222": "waiting" }, states: { "bbbbbbbb-1111-2222": { state: "permission", snippet: "Run it?" } } }); return c.state === "waiting" && c.why === "permission" && c.snippet === "Run it?"; })());
  check("no live entry -> old rule", one({ open: [ent({ status: "busy" })], live: { "other-0000-1111": "waiting" } }).state === "working" && one({ open: [ent({ status: "idle" })], live: {} }).state === "idle");
  check("live ignored for a chat not in the agents list", all(b({ open: [], live: { "bbbbbbbb-1111-2222": "waiting" } })).length === 0);
  check("live junk value ignored", one({ open: [ent({ status: "busy" })], live: { "bbbbbbbb-1111-2222": "weird" } }).state === "working");
  check("waiting chat sorts first", (() => { const r = all(b({ open: [ent({ sessionId: "aaaaaaaa-1", status: "busy" }), ent({ sessionId: "cccccccc-1", status: "idle" })], live: { "cccccccc-1": "waiting" } })); return r[0].state === "waiting"; })());
  {
    const fs = await import("node:fs"); const os = await import("node:os");
    const dir = fs.mkdtempSync(join(os.tmpdir(), "hub-live-"));
    const w = (n, o) => fs.writeFileSync(join(dir, n), typeof o === "string" ? o : JSON.stringify(o));
    w("101.json", { sessionId: "aaaaaaaa-1111", status: "busy", socket: "SECRET-PATH" });
    w("102.json", { sessionId: "bbbbbbbb-1111", status: "idle" });
    w("103.json", { sessionId: "cccccccc-1111", status: "waiting", updatedAt: 1 });
    w("104.json", "{not json");
    w("105.json", { sessionId: "dddddddd-1111", status: "strange" });
    w("106.json", { status: "busy" });
    w("notes.txt", "x");
    const m = readLiveSessions(dir);
    check("live reader: busy/idle/waiting read", m["aaaaaaaa-1111"] === "busy" && m["bbbbbbbb-1111"] === "idle" && m["cccccccc-1111"] === "waiting");
    check("live reader: corrupt, odd status, no id, other files skipped; only id+status kept", Object.keys(m).length === 3 && JSON.stringify(m).indexOf("SECRET") < 0);
    check("live reader: cached a few seconds", (() => { w("107.json", { sessionId: "eeeeeeee-1111", status: "busy" }); return readLiveSessions(dir)["eeeeeeee-1111"] === undefined; })());
    check("live reader: missing folder -> empty", Object.keys(readLiveSessions(join(dir, "nope"))).length === 0);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // real check
  let r = null, err = "";
  try { r = await readChats({ hubChats: [], redact: (s) => String(s ?? "") }); } catch (e) { err = String(e && e.message); }
  const shapeOk = r && typeof r.generatedAt === "string" && typeof r.max === "number" && typeof r.working === "number" && typeof r.openListOk === "boolean" && Array.isArray(r.projects)
    && r.projects.every((p) => typeof p.project === "string" && Array.isArray(p.chats) && p.chats.every((c) => ["hub", "app", "terminal"].includes(c.kind) && ["working", "idle", "waiting", "failed", "stopped", "closed"].includes(c.state) && typeof c.needsYou === "boolean" && typeof c.canAnswer === "boolean" && Array.isArray(c.refused)));
  check("real read: shape, no throw", !!shapeOk, err);
  if (r) console.log(`real: openListOk=${r.openListOk}, ${r.projects.length} projects, ${all(r).length} chats (app ${all(r).filter((c) => c.kind === "app").length}, terminal ${all(r).filter((c) => c.kind === "terminal").length}, needing you ${all(r).filter((c) => c.needsYou).length})`);
  const again = await readChats({ hubChats: [], redact: (s) => String(s ?? "") });
  check("second read (cached) same counts", all(again).length === (r ? all(r).length : -1));

  console.log(`${ok}/${total}`);
  process.exit(ok === total ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv.includes("--selftest")) await selftest();
