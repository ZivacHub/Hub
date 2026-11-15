// Helper-task feed (phase 15, step 15.1). READ-ONLY: reads the record files the hooks write and the saved chat files; writes nothing.
// shapeHelpers() is pure (no files); readHelpers() loads the real records of every project and looks the manager chats up.
import { readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const HOUR = 36e5;
const STUCK_MS = 2 * HOUR;
const MAX_TASKS = 300;
const STATE_ORDER = ["parked", "review", "failed", "stuck", "running", "done"];
const STATE_OF = { review: "review", parked: "parked", failed: "failed", passed: "done" };

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0; };
const zero = () => ({ running: 0, stuck: 0, review: 0, parked: 0, failed: 0, done: 0 });

/** "claude-fable-5-2" -> "Fable 5.2". Empty -> null; no fit -> the id unchanged. */
export function plainModel(id) {
  if (id === null || id === undefined || String(id).trim() === "") return null;
  const s = String(id).trim();
  const m = /^claude-(fable|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i.exec(s);
  if (!m) return s;
  const name = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return `${name} ${m[2]}${m[3] !== undefined ? "." + m[3] : ""}`;
}

/**
 * records: raw record objects, each with an extra text field `project`.
 * Returns { totals, projects } (the caller adds generatedAt).
 */
export function shapeHelpers(records, { now = Date.now(), managerOf = () => null, redact = (s) => String(s ?? "") } = {}) {
  const red = (s, n) => clip(String(redact(String(s ?? ""))), n);
  const valid = [];
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || typeof r !== "object") continue;
    let state;
    if (r.status === "running") state = now - Date.parse(r.startedAt) > STUCK_MS ? "stuck" : "running";
    else state = STATE_OF[r.status];
    if (!state) continue;
    const sessionId = typeof r.sessionId === "string" && r.sessionId ? r.sessionId : "";
    const projectRaw = String(r.project ?? "");
    const note = r.status === "parked" ? r.note : (state === "done" || state === "failed") ? r.check && r.check.note : "";
    valid.push({
      projectRaw, sessionId, rank: STATE_ORDER.indexOf(state), t: ms(r.startedAt),
      task: {
        id: String(r.id ?? ""), step: String(r.step ?? ""), title: red(r.title, 120), grade: String(r.grade ?? ""), model: String(r.model ?? ""),
        effort: r.effort ? String(r.effort) : null, state, since: r.startedAt ?? null, finishedAt: r.finishedAt ?? null,
        seconds: num(r.seconds), tokens: num(r.tokens), toolCalls: num(r.toolCalls),
        owns: (Array.isArray(r.owns) ? r.owns : []).map((o) => red(o, 120)), note: red(note, 300), retryOf: r.retryOf ? String(r.retryOf) : null,
      },
    });
  }

  const totals = zero();
  const projCounts = new Map(), projNewest = new Map();
  for (const v of valid) {
    totals[v.task.state]++;
    if (!projCounts.has(v.projectRaw)) { projCounts.set(v.projectRaw, zero()); projNewest.set(v.projectRaw, 0); }
    projCounts.get(v.projectRaw)[v.task.state]++;
    projNewest.set(v.projectRaw, Math.max(projNewest.get(v.projectRaw), v.t));
  }

  // cap: the oldest tasks are left out
  const kept = [...valid].sort((a, b) => b.t - a.t).slice(0, MAX_TASKS);

  const byProject = new Map();
  for (const v of kept) {
    if (!byProject.has(v.projectRaw)) byProject.set(v.projectRaw, new Map());
    const mg = byProject.get(v.projectRaw);
    if (!mg.has(v.sessionId)) mg.set(v.sessionId, []);
    mg.get(v.sessionId).push(v);
  }

  const projects = [];
  for (const [projectRaw, mg] of byProject) {
    const managers = [];
    for (const [sessionId, items] of mg) {
      items.sort((a, b) => a.rank - b.rank || b.t - a.t);
      let info = null;
      if (sessionId) { try { info = managerOf(projectRaw, sessionId) || null; } catch { info = null; } }
      managers.push({
        newest: Math.max(...items.map((x) => x.t)), hasId: !!sessionId,
        m: {
          id: sessionId ? sessionId.slice(0, 8) : null,
          chat: info && info.chat ? red(info.chat, 120) : null,
          model: info && info.model ? String(info.model) : null,
          lastActive: info && info.lastActive ? info.lastActive : null,
          tasks: items.map((x) => x.task),
        },
      });
    }
    managers.sort((a, b) => (a.hasId === b.hasId ? b.newest - a.newest : a.hasId ? -1 : 1));
    const counts = projCounts.get(projectRaw);
    const attention = counts.parked + counts.review + counts.failed + counts.stuck > 0 ? 0 : counts.running > 0 ? 1 : 2;
    projects.push({ attention, newest: projNewest.get(projectRaw), p: { project: projectRaw === "_workflow" ? "BUSNUS workshop" : projectRaw, counts: { ...counts }, managers: managers.map((x) => x.m) } });
  }
  projects.sort((a, b) => a.attention - b.attention || b.newest - a.newest);
  return { totals, projects: projects.map((x) => x.p) };
}

// ---------- the real feed ----------
const HOOKS = join(homedir(), ".claude", "hooks", "lib");
const CHATS = join(homedir(), ".claude", "projects");
const encode = (p) => String(p).replace(/[^A-Za-z0-9]/g, "-");
const fileCache = new Map(); // file -> { mtimeMs, value }

function readTail(file, bytes) {
  const size = statSync(file).size;
  const fd = openSync(file, "r");
  try {
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n");
    if (size > len) lines.shift();
    return lines;
  } finally { closeSync(fd); }
}

function chatInfo(root, sessionId) {
  try {
    if (!/^[A-Za-z0-9-]{8,64}$/.test(sessionId)) return null;
    const enc = encode(root);
    let folders = []; try { folders = readdirSync(CHATS); } catch { return null; }
    for (const f of folders) {
      if (f !== enc && !f.startsWith(enc + "-")) continue;
      const file = join(CHATS, f, sessionId + ".jsonl");
      let st; try { st = statSync(file); } catch { continue; }
      const hit = fileCache.get(file);
      if (hit && hit.mtimeMs === st.mtimeMs) return hit.value;
      let chat = null, model = null;
      const lines = readTail(file, 400 * 1024);
      for (let i = lines.length - 1; i >= 0 && (!chat || !model); i--) {
        let j; try { j = JSON.parse(lines[i]); } catch { continue; }
        if (!chat && j.type === "custom-title") chat = j.customTitle || j.title || null;
        if (!model && j.type === "assistant" && !j.isSidechain && j.message && j.message.model) model = plainModel(j.message.model);
      }
      const value = { chat, model, lastActive: st.mtime.toISOString() };
      fileCache.set(file, { mtimeMs: st.mtimeMs, value });
      return value;
    }
  } catch {}
  return null;
}

let feedCache = null;
export async function readHelpers() {
  if (feedCache && Date.now() - feedCache.at < 8000) return feedCache.value;
  let value;
  try {
    const hl = await import(pathToFileURL(join(HOOKS, "helpers.mjs")).href);
    const inbox = await import(pathToFileURL(join(HOOKS, "inbox.mjs")).href);
    const bus = await import(pathToFileURL(join(HOOKS, "busnus.mjs")).href);
    const { redact } = await import("./data.mjs");
    const homes = [...inbox.projectHomes(), { root: join(bus.BUSNUS, "_workflow"), name: "_workflow" }];
    const seen = new Set(), all = [], roots = new Map();
    for (const h of homes) {
      try {
        const key = h.root.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const name = h.name || h.root.split(/[\\/]/).pop();
        if (!roots.has(name)) roots.set(name, []);
        roots.get(name).push(h.root);
        for (const r of hl.listRecords(h.root)) all.push({ ...r, project: name });
      } catch {}
    }
    const managerOf = (project, sessionId) => {
      for (const root of roots.get(project) || []) { const i = chatInfo(root, sessionId); if (i) return i; }
      return null;
    };
    value = { generatedAt: new Date().toISOString(), ...shapeHelpers(all, { now: Date.now(), managerOf, redact }) };
  } catch {
    value = { generatedAt: new Date().toISOString(), totals: zero(), projects: [] };
  }
  feedCache = { at: Date.now(), value };
  return value;
}

// ---------- self-test ----------
async function selftest() {
  let ok = 0, total = 0;
  const check = (name, cond, extra = "") => { total++; if (cond) { ok++; console.log("OK  " + name); } else console.log("FAIL " + name + (extra ? " " + extra : "")); };
  const NOW = Date.parse("2026-11-15T12:00:00Z");
  const ago = (min) => new Date(NOW - min * 60000).toISOString();
  const rec = (o) => ({ id: "x", step: "1.1", title: "t", grade: "light", model: "haiku", effort: "low", owns: [], status: "running", startedAt: ago(10), finishedAt: null, sessionId: "aaaaaaaa-1111", retryOf: null, check: null, tokens: null, toolCalls: null, seconds: null, note: "", project: "P", ...o });
  const flat = (res) => res.projects.flatMap((p) => p.managers.flatMap((m) => m.tasks));
  const stateOf = (r) => flat(shapeHelpers([r], { now: NOW }))[0]?.state;

  check("state running", stateOf(rec({ status: "running" })) === "running");
  check("state stuck just over 2h", stateOf(rec({ startedAt: ago(121) })) === "stuck");
  check("state running just under 2h", stateOf(rec({ startedAt: ago(119) })) === "running");
  check("state review", stateOf(rec({ status: "review" })) === "review");
  check("state parked", stateOf(rec({ status: "parked" })) === "parked");
  check("state failed", stateOf(rec({ status: "failed" })) === "failed");
  check("state done", stateOf(rec({ status: "passed" })) === "done");
  check("unknown status skipped", shapeHelpers([rec({ status: "weird" })], { now: NOW }).projects.length === 0);

  const t = flat(shapeHelpers([rec({ id: "f", status: "passed", effort: undefined, tokens: 5, seconds: "x", owns: ["a/b"], retryOf: "r1", finishedAt: ago(1) })], { now: NOW }))[0];
  check("task fields", t.id === "f" && t.effort === null && t.tokens === 5 && t.seconds === null && t.toolCalls === null && t.since === ago(10) && t.finishedAt === ago(1) && t.owns[0] === "a/b" && t.retryOf === "r1" && t.model === "haiku" && t.grade === "light" && t.step === "1.1");

  const n = (r) => flat(shapeHelpers([r], { now: NOW }))[0].note;
  check("note parked", n(rec({ status: "parked", note: "why", check: { note: "no" } })) === "why");
  check("note done", n(rec({ status: "passed", note: "zz", check: { result: "pass", note: "good" } })) === "good");
  check("note failed", n(rec({ status: "failed", check: { result: "fail", note: "bad" } })) === "bad");
  check("note running empty", n(rec({ status: "running", note: "zz" })) === "");
  check("note missing empty", n(rec({ status: "passed", check: null })) === "");

  // grouping + orders
  const recs = [
    rec({ id: "a1", sessionId: "aaaaaaaa-1", startedAt: ago(50), status: "passed" }),
    rec({ id: "a2", sessionId: "aaaaaaaa-1", startedAt: ago(40), status: "parked" }),
    rec({ id: "a3", sessionId: "aaaaaaaa-1", startedAt: ago(30), status: "running" }),
    rec({ id: "a4", sessionId: "aaaaaaaa-1", startedAt: ago(35), status: "review" }),
    rec({ id: "a5", sessionId: "aaaaaaaa-1", startedAt: ago(20), status: "passed" }),
    rec({ id: "a6", sessionId: "aaaaaaaa-1", startedAt: ago(25), status: "failed" }),
    rec({ id: "a7", sessionId: "aaaaaaaa-1", startedAt: ago(300), status: "running" }),
    rec({ id: "a8", sessionId: "aaaaaaaa-1", startedAt: ago(45), status: "parked" }),
    rec({ id: "n1", sessionId: "", startedAt: ago(1) }),
    rec({ id: "n2", sessionId: undefined, startedAt: ago(2) }),
    rec({ id: "b1", sessionId: "bbbbbbbb-2", startedAt: ago(5) }),
  ];
  const g = shapeHelpers(recs, { now: NOW, managerOf: (p, s) => (s === "bbbbbbbb-2" ? { chat: "Chat B", model: "Opus 5.5", lastActive: ago(3) } : null) });
  const ms1 = g.projects[0].managers;
  check("one project", g.projects.length === 1);
  check("managers: newest first, id-null last", ms1.map((m) => String(m.id)).join(",") === "bbbbbbbb,aaaaaaaa,null", ms1.map((m) => String(m.id)).join(","));
  check("id-null manager holds both", ms1[2].tasks.length === 2 && ms1[2].chat === null && ms1[2].model === null && ms1[2].lastActive === null);
  check("managerOf used", ms1[0].chat === "Chat B" && ms1[0].model === "Opus 5.5" && ms1[0].lastActive === ago(3));
  check("managerOf null gives nulls", ms1[1].chat === null && ms1[1].model === null && ms1[1].lastActive === null);
  check("task order", ms1[1].tasks.map((x) => x.id).join(",") === "a2,a8,a4,a6,a7,a3,a5,a1", ms1[1].tasks.map((x) => x.id).join(","));

  const old = shapeHelpers([rec({ id: "o1", sessionId: "aaaaaaaa", startedAt: ago(100) }), rec({ id: "o2", sessionId: "cccccccc", startedAt: ago(10) })], { now: NOW });
  check("managers newest first (plain)", old.projects[0].managers.map((m) => m.id).join(",") === "cccccccc,aaaaaaaa");

  // project order
  const po = shapeHelpers([
    rec({ id: "r1", project: "Run", status: "running", startedAt: ago(1) }),
    rec({ id: "d1", project: "Done", status: "passed", startedAt: ago(0.5) }),
    rec({ id: "w1", project: "OldWait", status: "parked", startedAt: ago(500) }),
    rec({ id: "w2", project: "NewWait", status: "review", startedAt: ago(100) }),
    rec({ id: "r2", project: "Run2", status: "running", startedAt: ago(30) }),
    rec({ id: "d2", project: "Done2", status: "passed", startedAt: ago(200) }),
  ], { now: NOW });
  check("project order", po.projects.map((p) => p.project).join(",") === "NewWait,OldWait,Run,Run2,Done,Done2", po.projects.map((p) => p.project).join(","));
  check("workshop name", shapeHelpers([rec({ project: "_workflow" })], { now: NOW }).projects[0].project === "BUSNUS workshop");

  // counts and totals
  const c = shapeHelpers([...recs, rec({ id: "z", project: "Q", status: "failed" })], { now: NOW });
  check("project counts", JSON.stringify(c.projects.find((p) => p.project === "P").counts) === JSON.stringify({ running: 4, stuck: 1, review: 1, parked: 2, failed: 1, done: 2 }), JSON.stringify(c.projects[0].counts));
  check("totals", c.totals.failed === 2 && c.totals.running === 4 && c.totals.done === 2 && c.totals.parked === 2 && c.totals.review === 1 && c.totals.stuck === 1);

  // redaction + clipping
  const fake = (s) => String(s).replace(/SECRET/g, "[hidden]");
  const rd = shapeHelpers([rec({ title: "has SECRET x", status: "parked", note: "n SECRET", owns: ["SECRET/f"], sessionId: "dddddddd-9" })], { now: NOW, redact: fake, managerOf: () => ({ chat: "chat SECRET", model: null, lastActive: null }) });
  const rt = rd.projects[0].managers[0];
  check("redaction", rt.tasks[0].title === "has [hidden] x" && rt.tasks[0].note === "n [hidden]" && rt.tasks[0].owns[0] === "[hidden]/f" && rt.chat === "chat [hidden]");
  const long = flat(shapeHelpers([rec({ title: "T".repeat(500), status: "parked", note: "N".repeat(500), owns: ["O".repeat(500)] })], { now: NOW }))[0];
  check("clipping", long.title.length <= 121 && long.title.endsWith("…") && long.note.length <= 301 && long.note.endsWith("…") && long.owns[0].length <= 121 && long.owns[0].endsWith("…"));
  const pre = flat(shapeHelpers([rec({ title: "SECRET".repeat(30) })], { now: NOW, redact: (s) => s.replace(/SECRET/g, "") }))[0];
  check("redact before clip", pre.title === "");

  // cap
  const many = Array.from({ length: 350 }, (_, i) => rec({ id: "m" + i, startedAt: ago(i + 1), status: "passed" }));
  const cap = shapeHelpers(many, { now: NOW });
  const ids = new Set(flat(cap).map((x) => x.id));
  check("cap 300 listed", ids.size === 300 && ids.has("m0") && ids.has("m299") && !ids.has("m300") && !ids.has("m349"));
  check("cap keeps totals", cap.totals.done === 350 && cap.projects[0].counts.done === 350);

  // plainModel
  check("plainModel fable", plainModel("claude-fable-5-2") === "Fable 5.2");
  check("plainModel opus", plainModel("claude-opus-5-5") === "Opus 5.5");
  check("plainModel sonnet dated", plainModel("claude-sonnet-4-5-20250929") === "Sonnet 4.5");
  check("plainModel haiku", plainModel("claude-haiku-5-5") === "Haiku 5.5");
  check("plainModel empty", plainModel("") === null && plainModel(null) === null && plainModel(undefined) === null);
  check("plainModel other", plainModel("gpt-x") === "gpt-x");

  // real checks
  let feed = null, err = "";
  try { feed = await readHelpers(); } catch (e) { err = String(e && e.message); }
  const shapeOk = feed && typeof feed.generatedAt === "string" && feed.totals && ["running", "stuck", "review", "parked", "failed", "done"].every((k) => typeof feed.totals[k] === "number") && Array.isArray(feed.projects)
    && feed.projects.every((p) => typeof p.project === "string" && p.counts && Array.isArray(p.managers) && p.managers.every((m) => "id" in m && "chat" in m && "model" in m && "lastActive" in m && Array.isArray(m.tasks)));
  check("real feed shape", !!shapeOk, err);
  let cmdIds = null;
  try {
    const out = execFileSync(process.execPath, [join(homedir(), ".claude", "hooks", "helpers.mjs"), "list", "--json", "--all"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    cmdIds = new Set(JSON.parse(out).filter((r) => ["running", "review", "passed", "failed", "parked"].includes(r.status)).map((r) => r.id));
  } catch (e) { err = String(e && e.message); }
  const feedIds = new Set(feed ? flat(feed).map((x) => x.id) : []);
  const same = cmdIds && cmdIds.size === feedIds.size && [...cmdIds].every((i) => feedIds.has(i));
  check(`real feed ids equal the command's (${feedIds.size})`, !!same, err + (cmdIds ? ` command=${cmdIds.size}` : ""));

  console.log(`${ok}/${total}`);
  process.exit(ok === total ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes("--selftest")) await selftest();
