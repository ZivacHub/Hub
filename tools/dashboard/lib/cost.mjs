// Cost view data (phase 21, step 21.6). READ-ONLY: reads the saved chat files (.jsonl) and the helper records; writes nothing.
// Reads numbers, ids, model names and chat titles (the custom-title field) only. Never message text, file contents or account ids.
// Contract: docs/plan/phases/21-cost-view.md.  Self-test: node tools/dashboard/lib/cost.mjs --selftest
import { readdirSync, statSync, existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const GAP = 15 * 60 * 1000;          // a pause longer than this is not "active time" (same rule as token-report.mjs)
const CACHE_MS = 60 * 1000;
const CHAT_CAP = 60;
const RUNNING_SPAN = 2 * 36e5;       // a helper task with no end time is assumed to run at most this long
export const WEIGHTS = { fresh: 1, cacheWrite: 1.25, cacheRead: 0.1, out: 5 }; // the Hub's own rough weighting, NOT a price

const zero = () => ({ fresh: 0, cacheWrite: 0, cacheRead: 0, out: 0, replies: 0, weighted: 0 });
const weigh = (s) => s.fresh * WEIGHTS.fresh + s.cacheWrite * WEIGHTS.cacheWrite + s.cacheRead * WEIGHTS.cacheRead + s.out * WEIGHTS.out;
const finish = (s) => { const r = { fresh: Math.round(s.fresh), cacheWrite: Math.round(s.cacheWrite), cacheRead: Math.round(s.cacheRead), out: Math.round(s.out), replies: Math.round(s.replies) }; r.weighted = Math.round(weigh(r)); return r; };
const add = (a, b) => { a.fresh += b.fresh; a.cacheWrite += b.cacheWrite; a.cacheRead += b.cacheRead; a.out += b.out; a.replies += b.replies || 0; return a; };
const scale = (s, f) => ({ fresh: s.fresh * f, cacheWrite: s.cacheWrite * f, cacheRead: s.cacheRead * f, out: s.out * f, replies: (s.replies || 0) * f });
const total = (s) => s.fresh + s.cacheWrite + s.cacheRead + s.out;
const encodeCwd = (p) => String(p).replace(/[^A-Za-z0-9]/g, "-");
const clean = (s, n) => String(s ?? "").replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const toMs = (v) => { if (typeof v === "number") return v; const t = Date.parse(v); return Number.isFinite(t) ? t : 0; };
const short = (m) => String(m || "?").replace(/^claude-/, "");
const hasWork = /"type":"(assistant|user)"/;

/** Phase titles from a plan board: "- [x] Phase 14 — Title" (board) or "## Phase 3: Title" (old PLAN.md). Missing file -> empty Map. */
export function parsePhases(text) {
  const out = new Map();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^\s*(?:-\s*\[.\]\s*|#+\s*)Phase\s+(\d+)\s*[—–:.\-]*\s*(.*)$/.exec(line);
    if (m && !out.has(+m[1])) out.set(+m[1], clean(m[2], 90));
  }
  return out;
}

/** Phase of a helper record: the number before the dot of its step id; else a step-like "14.7" in the title; else null. */
export function phaseOfRecord(r) {
  const m = /^\s*(\d{1,3})\.\d+/.exec(String(r?.step ?? ""));
  if (m) return { phase: +m[1], basis: "step" };
  const t = /(?:^|[^\d.])(\d{1,2})\.\d{1,2}(?![\d.])/.exec(String(r?.title ?? ""));
  if (t) return { phase: +t[1], basis: "title" };
  return null;
}

// One log file -> feeds the chat record. Dedupe by requestId (fallback message.id) over the whole chat (main + helpers).
// A repeated reply keeps the LARGEST value per field (the final one) - same as token-report.mjs.
function readText(text, chat, agentId) {
  for (const line of text.split("\n")) {
    if (!line) continue;
    if (line.charCodeAt(0) === 123 && line.includes('"custom-title"') && !agentId) {
      try { const o = JSON.parse(line); if (o.type === "custom-title" && typeof o.customTitle === "string") chat.title = clean(o.customTitle, 120); } catch {}
      continue;
    }
    if (!hasWork.test(line)) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== "assistant" && o.type !== "user") continue;
    const t = o.timestamp ? Date.parse(o.timestamp) : 0;
    if (t) chat.times.push(t);
    if (o.type !== "assistant") continue;
    const m = o.message;
    if (!m || m.model === "<synthetic>") continue;
    const u = m.usage; if (!u) continue;
    const vals = { fresh: u.input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, out: u.output_tokens || 0 };
    const id = o.requestId || m.id; if (!id) continue;
    const prev = chat.seen.get(id);
    if (prev) {
      for (const k in vals) if (vals[k] > prev.v[k]) { prev.side[k] += vals[k] - prev.v[k]; if (prev.agent) prev.agent[k] += vals[k] - prev.v[k]; prev.v[k] = vals[k]; }
      continue;
    }
    const side = agentId ? chat.helpers : chat.main;
    const agent = agentId ? (chat.agents.get(agentId) || chat.agents.set(agentId, zero()).get(agentId)) : null;
    const rec = { v: vals, side, agent, t, main: !agentId };
    chat.seen.set(id, rec);
    add(side, { ...vals, replies: 1 });
    if (agent) add(agent, { ...vals, replies: 1 });
    if (!agentId) chat.mainReplies.push(rec);
    const mm = short(m.model);
    chat.models[mm] = (chat.models[mm] || 0) + 1;
  }
}

/** Pure part: turns the raw per-chat numbers and helper records into the output shape. */
export function shapeProject(name, chats, records, phaseTitles, { now = Date.now() } = {}) {
  // helper records -> tasks with a phase, a time span, tokens
  const tasks = [];
  const agentSeen = new Set();
  const chatBySession = new Map(chats.map((c) => [c.sessionId, c]));
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || typeof r !== "object") continue;
    const ph = phaseOfRecord(r);
    const start = toMs(r.startedAt), endRaw = toMs(r.finishedAt);
    const end = endRaw || (start ? Math.min(now, start + RUNNING_SPAN) : 0);
    const chat = chatBySession.get(r.sessionId);
    const file = chat && r.agentId ? chat.agents.get(String(r.agentId)) : null;
    if (file) agentSeen.add(r.sessionId + "/" + r.agentId);
    tasks.push({ phase: ph ? ph.phase : null, start, end, sessionId: r.sessionId || "", file, recorded: typeof r.tokens === "number" && Number.isFinite(r.tokens) ? r.tokens : 0 });
  }

  const phases = new Map();
  const ph = (n) => { if (!phases.has(n)) phases.set(n, { helper: zero(), tasks: 0, recordedOnly: 0, main: zero(), bases: new Set() }); return phases.get(n); };
  for (const t of tasks) {
    const p = ph(t.phase); p.tasks++;
    if (t.file) add(p.helper, t.file); else p.recordedOnly += t.recorded;
  }
  // helper files that no record owns (not started through the BUSNUS hooks) -> unassigned
  for (const c of chats) for (const [aid, s] of c.agents) if (!agentSeen.has(c.sessionId + "/" + aid)) { const p = ph(null); add(p.helper, s); p.tasks++; }

  // main-chat tokens -> phases (ESTIMATE)
  const phased = tasks.filter((t) => t.phase !== null && t.start);
  for (const c of chats) {
    c.phaseSplit = [];
    const main = c.main;
    if (!total(main)) continue;
    // (1) helpers this chat launched: proportional to their tokens per phase
    const mine = tasks.filter((t) => t.phase !== null && t.sessionId === c.sessionId);
    const wt = new Map(); let wsum = 0;
    for (const t of mine) { const w = t.file ? weigh(t.file) : t.recorded; if (w > 0) { wt.set(t.phase, (wt.get(t.phase) || 0) + w); wsum += w; } }
    if (wsum > 0) {
      for (const [p, w] of wt) { const f = w / wsum; add(ph(p).main, scale(main, f)); ph(p).bases.add("helpers"); c.phaseSplit.push({ phase: p, share: f, basis: "helpers" }); }
      continue;
    }
    // (2) reply by reply: which phased helper task was running at that moment
    const split = new Map(); let un = zero();
    for (const rp of c.mainReplies) {
      const hit = rp.t ? [...new Set(phased.filter((t) => rp.t >= t.start && rp.t <= (t.end || t.start)).map((t) => t.phase))] : [];
      if (!hit.length) { add(un, { ...rp.v, replies: 1 }); continue; }
      for (const p of hit) { if (!split.has(p)) split.set(p, zero()); add(split.get(p), scale({ ...rp.v, replies: 1 }, 1 / hit.length)); }
    }
    for (const [p, s] of split) { add(ph(p).main, s); ph(p).bases.add("time"); c.phaseSplit.push({ phase: p, share: total(s) / total(main), basis: "time" }); }
    if (total(un) > 0) { add(ph(null).main, un); ph(null).bases.add("unassigned"); c.phaseSplit.push({ phase: null, share: total(un) / total(main), basis: "unassigned" }); }
  }

  const phaseList = [...phases.entries()].map(([n, p]) => ({
    phase: n, title: n === null ? "Not matched to a phase" : (phaseTitles.get(n) || ""),
    helperTokens: Object.assign(finish(p.helper), { recordedOnly: Math.round(p.recordedOnly) }), helperTasks: p.tasks,
    mainShare: { tokens: finish(p.main), basis: p.bases.size === 0 ? "none" : p.bases.size === 1 ? [...p.bases][0] : "mixed" },
  })).filter((p) => p.helperTasks || p.mainShare.tokens.weighted)
    .sort((a, b) => (a.phase === null) - (b.phase === null) || (a.phase ?? 0) - (b.phase ?? 0));

  const main = zero(), helpers = zero();
  const chatList = chats.map((c) => {
    add(main, c.main); add(helpers, c.helpers);
    const allReplies = Object.values(c.models).reduce((a, b) => a + b, 0) || 1;
    const ts = [...c.times].sort((a, b) => a - b);
    let active = 0; for (let i = 1; i < ts.length; i++) { const g = ts[i] - ts[i - 1]; if (g < GAP) active += g; }
    const top = [...c.phaseSplit].filter((s) => s.phase !== null).sort((a, b) => b.share - a.share)[0];
    return {
      sessionId: c.sessionId, ...(c.title ? { title: c.title } : {}),
      start: new Date(ts[0]).toISOString(), end: new Date(ts[ts.length - 1]).toISOString(), hours: +(active / 3.6e6).toFixed(2),
      main: finish(c.main), helpers: finish(c.helpers), helperCount: c.agents.size,
      models: Object.fromEntries(Object.entries(c.models).sort((a, b) => b[1] - a[1]).map(([m, v]) => [m, Math.round((100 * v) / allReplies)])),
      ...(top ? { phaseGuess: { phase: top.phase, share: +top.share.toFixed(2), basis: top.basis } } : {}),
    };
  }).sort((a, b) => b.end.localeCompare(a.end) || a.sessionId.localeCompare(b.sessionId));

  const all = add(add(zero(), main), helpers);
  const t = { main: finish(main), helpers: finish(helpers), all: finish(all) };
  t.weighted = t.all.weighted;
  return { name, totals: t, chatCount: chatList.length, chats: chatList.slice(0, CHAT_CAP), phases: phaseList };
}

export function makeCost({ homeDir = homedir(), bussnusRoot, projects = () => [], now = Date.now, readFileFn = (p) => readFileSync(p, "utf8"), helperRecords = null, fsx = {} } = {}) {
  const readdir = fsx.readdirSync || readdirSync, stat = fsx.statSync || statSync, exists = fsx.existsSync || existsSync;
  const clock = () => (typeof now === "function" ? now() : now);
  const cache = new Map();
  const records = helperRecords || ((project) => {
    const dir = join(bussnusRoot || "", project, ".claude", "helpers"), out = [];
    try { for (const f of readdir(dir)) if (f.endsWith(".json")) { try { const r = JSON.parse(readFileFn(join(dir, f))); if (r && typeof r === "object") out.push(r); } catch {} } } catch {}
    return out;
  });
  const board = (project) => {
    for (const rel of [["docs", "plan", "BOARD.md"], ["PLAN.md"], ["docs", "PLAN.md"]]) {
      try { const m = parsePhases(readFileFn(join(bussnusRoot || "", project, ...rel))); if (m.size) return m; } catch {}
    }
    return new Map();
  };

  function loadChats(project, sinceMs) {
    const dir = join(homeDir, ".claude", "projects", encodeCwd(join(bussnusRoot || "", project)));
    let names; try { names = readdir(dir); } catch { return []; }
    const chats = [];
    for (const n of names) {
      if (!n.endsWith(".jsonl")) continue;
      const sessionId = n.slice(0, -6), file = join(dir, n), sub = join(dir, sessionId, "subagents");
      let newest = 0;
      try { newest = stat(file).mtimeMs; } catch { continue; }
      let subs = [];
      try { if (exists(sub)) subs = readdir(sub).filter((f) => f.endsWith(".jsonl")); } catch {}
      for (const f of subs) { try { newest = Math.max(newest, stat(join(sub, f)).mtimeMs); } catch {} }
      if (sinceMs && newest < sinceMs) continue;                 // not touched since: skip without reading
      const chat = { sessionId, main: zero(), helpers: zero(), seen: new Map(), mainReplies: [], agents: new Map(), models: {}, times: [], title: "" };
      try { readText(String(readFileFn(file)), chat, null); } catch { continue; }
      for (const f of subs) {
        const aid = f.replace(/^agent-/, "").slice(0, -6);
        try { readText(String(readFileFn(join(sub, f))), chat, aid); } catch {}
      }
      if (!chat.times.length || (!chat.main.replies && !chat.helpers.replies)) continue;
      if (sinceMs && Math.max(...chat.times) < sinceMs) continue;
      chats.push(chat);
    }
    return chats;
  }

  function forProject(name, { since } = {}) {
    const sinceMs = since ? toMs(since) : 0, key = name + "|" + sinceMs, t = clock();
    const hit = cache.get(key);
    if (hit && t - hit.at < CACHE_MS) return hit.value;
    const value = shapeProject(name, loadChats(name, sinceMs), records(name), board(name), { now: t });
    cache.set(key, { at: t, value });
    return value;
  }
  function overview({ since } = {}) {
    const list = (projects() || []).map((p) => (typeof p === "string" ? p : p && p.name)).filter(Boolean);
    return { projects: list.map((name) => { const r = forProject(name, { since }); return { name, totals: r.totals, chatCount: r.chatCount }; }) };
  }
  return { forProject, overview };
}

// ---------------------------------------------------------------- self-test
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes("--selftest")) {
  let pass = 0, fail = 0;
  const ok = (label, cond) => { if (cond) pass++; else { fail++; console.log("FAIL:", label); } };
  const tmp = mkdtempSync(join(tmpdir(), "hubcost-"));
  try {
    const home = join(tmp, "home"), root = join(tmp, "root");
    const proj = (n) => join(home, ".claude", "projects", encodeCwd(join(root, n)));
    const iso = (min) => new Date(Date.UTC(2026, 10, 20, 10, min)).toISOString();
    const reply = (req, min, u, model = "claude-opus-5", extra = {}) => JSON.stringify({ type: "assistant", requestId: req, timestamp: iso(min), message: { id: "m_" + req, model, content: [{ type: "text", text: "SECRET WORDS" }], usage: { input_tokens: u[0], cache_creation_input_tokens: u[1], cache_read_input_tokens: u[2], output_tokens: u[3] } }, ...extra });
    const userLine = (min) => JSON.stringify({ type: "user", timestamp: iso(min), message: { content: "SECRET WORDS" } });
    mkdirSync(join(root, "P1", "docs", "plan"), { recursive: true });
    writeFileSync(join(root, "P1", "docs", "plan", "BOARD.md"), "# Plan\n- [x] Phase 14 — Run chats\n  - [x] 14.1 x\n- [~] Phase 21 — Limits and cost (Ivan)\n## Phase 3: old style\n");
    // chat A: duplicate lines for one reply, session launched a phase-14 helper
    const A = "aaaaaaaa-0000-0000-0000-000000000001";
    mkdirSync(join(proj("P1"), A, "subagents"), { recursive: true });
    writeFileSync(join(proj("P1"), A + ".jsonl"), [
      JSON.stringify({ type: "custom-title", customTitle: "First title", sessionId: A }),
      userLine(0), reply("r1", 1, [10, 100, 1000, 50]), reply("r1", 1, [10, 100, 1000, 50]), reply("r1", 1, [10, 100, 1000, 60]),
      reply("r2", 3, [5, 0, 2000, 20], "claude-sonnet-5-5"), "not json {{{", JSON.stringify({ type: "assistant", timestamp: iso(4), message: { id: "x", model: "<synthetic>", usage: { input_tokens: 999 } } }),
      JSON.stringify({ type: "assistant", timestamp: iso(5), message: { model: "claude-opus-5", usage: { input_tokens: 777 } } }), // no id: skipped like token-report
      JSON.stringify({ type: "custom-title", customTitle: "Final title", sessionId: A }),
    ].join("\n") + "\n");
    writeFileSync(join(proj("P1"), A, "subagents", "agent-ag1.jsonl"), [reply("h1", 2, [20, 200, 3000, 100], "claude-sonnet-5-5"), reply("h1", 2, [20, 200, 3000, 100], "claude-sonnet-5-5")].join("\n") + "\n");
    writeFileSync(join(proj("P1"), A, "subagents", "agent-orphan.jsonl"), reply("h2", 2, [1, 1, 1, 1], "claude-haiku-5") + "\n");
    // chat B: no helpers, replies fall inside a phase-21 helper span (time basis) and one outside (unassigned)
    const B = "bbbbbbbb-0000-0000-0000-000000000002";
    writeFileSync(join(proj("P1"), B + ".jsonl"), [reply("b1", 30, [1, 0, 100, 10]), reply("b2", 90, [1, 0, 100, 10])].join("\n") + "\n");
    // chat C: empty and odd files
    writeFileSync(join(proj("P1"), "empty.jsonl"), "");
    writeFileSync(join(proj("P1"), "notes.txt"), "hi");
    // old chat for the since filter
    const D = "dddddddd-0000-0000-0000-000000000004";
    writeFileSync(join(proj("P1"), D + ".jsonl"), reply("d1", 200, [1, 1, 1, 1]) + "\n");
    const old = new Date("2020-01-01"); utimesSync(join(proj("P1"), D + ".jsonl"), old, old);
    mkdirSync(join(root, "Empty"), { recursive: true });

    const recs = (p) => p !== "P1" ? [] : [
      { id: "t1", step: "14.7", sessionId: A, agentId: "ag1", startedAt: iso(1), finishedAt: iso(2), tokens: 4000 },
      { id: "t2", step: "21.3", sessionId: "other", agentId: "gone", startedAt: iso(25), finishedAt: iso(40), tokens: 5000 },
      { id: "t3", step: "", title: "no step here", sessionId: "other", startedAt: iso(100), finishedAt: iso(101), tokens: 10 },
      null, "bad",
    ];
    let reads = 0;
    const clockBox = { t: Date.now() };
    const cost = makeCost({ homeDir: home, bussnusRoot: root, projects: () => ["P1", "Empty", "Nothing"], now: () => clockBox.t, readFileFn: (p) => { reads++; return readFileSync(p, "utf8"); }, helperRecords: recs });
    const r = cost.forProject("P1");
    const a = r.chats.find((c) => c.sessionId === A), b = r.chats.find((c) => c.sessionId === B);
    ok("dedupe: duplicate lines counted once, largest value kept", a.main.fresh === 15 && a.main.out === 80 && a.main.cacheWrite === 100 && a.main.cacheRead === 3000 && a.main.replies === 2);
    ok("synthetic and id-less replies are not counted", a.main.fresh === 15);
    ok("helper file counted once (duplicate line)", a.helpers.fresh === 21 && a.helpers.replies === 2 && a.helperCount === 2);
    ok("weighted = fresh + 1.25 cw + 0.1 cr + 5 out", a.main.weighted === Math.round(15 + 125 + 300 + 400));
    ok("title = the last custom-title", a.title === "Final title");
    ok("models in percent of replies", a.models["opus-5"] === 25 && a.models["sonnet-5-5"] === 50 && a.models["haiku-5"] === 25);
    ok("hours and dates", a.hours >= 0.04 && a.start === iso(0) && a.end === iso(5));
    ok("empty/odd files skipped, old chat counted w/o since", r.chats.length === 3 && r.chatCount === 3);
    ok("newest first", r.chats[0].end >= r.chats[1].end && r.chats[1].end >= r.chats[2].end);
    ok("totals add up", r.totals.all.fresh === r.totals.main.fresh + r.totals.helpers.fresh && r.totals.weighted === r.totals.all.weighted);
    const ph = (n) => r.phases.find((p) => p.phase === n);
    ok("phases parsed from the board (both shapes)", ph(14).title === "Run chats" && ph(21).title === "Limits and cost (Ivan)");
    ok("helper tokens per phase from the file by agentId", ph(14).helperTokens.fresh === 20 && ph(14).helperTasks === 1);
    ok("record without a file: recordedOnly", ph(21).helperTokens.recordedOnly === 5000 && ph(21).helperTokens.fresh === 0);
    ok("orphan helper file and step-less record go to unassigned", r.phases.at(-1).phase === null && r.phases.at(-1).helperTasks === 2 && r.phases.at(-1).helperTokens.fresh === 1);
    ok("main chat of the launching session: helpers basis, all to phase 14", ph(14).mainShare.basis === "helpers" && ph(14).mainShare.tokens.out === 80 && a.phaseGuess.phase === 14 && a.phaseGuess.basis === "helpers");
    ok("time basis: reply inside a helper span goes to that phase", ph(21).mainShare.tokens.fresh === 1 && ph(21).mainShare.basis === "time" && b.phaseGuess.phase === 21);
    ok("reply outside every span is unassigned (never exact)", r.phases.at(-1).mainShare.tokens.fresh === 2 && r.phases.at(-1).mainShare.basis === "unassigned");
    const mainSum = r.phases.reduce((s, p) => s + p.mainShare.tokens.fresh, 0);
    ok("main tokens over phases add up to the main total", mainSum === r.totals.main.fresh);
    ok("no message text anywhere in the output", !JSON.stringify(r).includes("SECRET"));
    const n0 = reads; cost.forProject("P1"); ok("second call is served from the 60 s cache", reads === n0);
    clockBox.t += 61000; cost.forProject("P1"); ok("after 60 s it reads again", reads > n0);
    const rs = cost.forProject("P1", { since: "2026-01-01" });
    ok("since: untouched old chat skipped", rs.chats.length === 2 && !rs.chats.some((c) => c.sessionId === D));
    const rs2 = cost.forProject("P1", { since: "2030-01-01" });
    ok("since in the future: nothing", rs2.chats.length === 0 && rs2.totals.all.replies === 0);
    ok("old chat is counted when since is early", cost.forProject("P1", { since: "2019-01-01" }).chats.length === 3);
    const e = cost.forProject("Empty");
    ok("empty project: zero totals, no crash", e.chats.length === 0 && e.totals.all.weighted === 0 && e.phases.length === 0);
    ok("project without a chat folder: no crash", cost.forProject("Nothing").chats.length === 0);
    const ov = cost.overview();
    ok("overview lists every project with totals", ov.projects.length === 3 && ov.projects[0].name === "P1" && ov.projects[0].totals.all.replies === r.totals.all.replies);
    // cap
    mkdirSync(proj("Empty"), { recursive: true });
    for (let i = 0; i < 70; i++) writeFileSync(join(proj("Empty"), "cap" + String(i).padStart(3, "0") + ".jsonl"), reply("c" + i, i, [1, 0, 0, 1]) + "\n");
    const capped = makeCost({ homeDir: home, bussnusRoot: root, now: () => 1, helperRecords: () => [] }).forProject("Empty");
    ok("chat list capped at 60, totals cover all 70", capped.chats.length === 60 && capped.chatCount === 70 && capped.totals.all.replies === 70);
    // default record reader (files in .claude/helpers)
    mkdirSync(join(root, "P2", ".claude", "helpers"), { recursive: true });
    writeFileSync(join(root, "P2", ".claude", "helpers", "x.json"), JSON.stringify({ step: "5.1", tokens: 7, startedAt: iso(0), finishedAt: iso(1), sessionId: "s" }));
    writeFileSync(join(root, "P2", ".claude", "helpers", "bad.json"), "{{");
    const p2 = makeCost({ homeDir: home, bussnusRoot: root, now: () => 1 }).forProject("P2");
    ok("default reader takes .claude/helpers records, ignores bad files", p2.phases.length === 1 && p2.phases[0].phase === 5 && p2.phases[0].helperTokens.recordedOnly === 7);
    ok("parsePhases tolerates empty/garbage", parsePhases(undefined).size === 0 && parsePhases("x\n- [ ] Phase x").size === 0);
    ok("phaseOfRecord: step, title fallback, none", phaseOfRecord({ step: "19.12" }).phase === 19 && phaseOfRecord({ title: "14.8/14.9 page" }).phase === 14 && phaseOfRecord({ title: "nothing" }) === null);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  console.log(`cost self-test: ${pass} OK, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
