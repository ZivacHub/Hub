// Usage meter feed (Phase 21, step 21.2). READ-ONLY: it reads files and asks one windowless `claude` a question that sends no chat message.
// GET /api/usage draws snapshot(). Shape, sources, levels and an example: docs/plan/phases/21-usage-meter.md.
//   node tools/dashboard/lib/usage.mjs --selftest          fakes only: no real claude, no real chats, no real app data
//   node tools/dashboard/lib/usage.mjs --selftest --real   also ONE read-only real run at the end (prints counts only)
// Privacy: the app's account id (`org`) is never kept; session ids leave this module as their first 8 characters only; no message text is kept.
// Sources per limit, best first: "claude" (live get_usage answer), "app-history" (the app's plan-usage-history.json), "estimate" (own token count).
import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { open as openFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const HUB_DIR = resolve(HERE, "..", "..", "..");
const MIN = 60000, HOUR = 60 * MIN, FIVE_H = 5 * HOUR, WEEK = 7 * 24 * HOUR;

/** Weights per token kind (the API price ratios, research U4): fresh x1, cache write x1.25, cache read x0.1, output x5. */
export const WEIGHTS = Object.freeze({ fresh: 1, cacheWrite: 1.25, cacheRead: 0.1, out: 5 });
/** Weighted tokens per percent until learned from the app's history (research U4: about 150k-160k per 5-hour percent, about 1.2M per weekly percent). */
export const DEFAULT_CALIBRATION = Object.freeze({ fiveHour: 155000, weekly: 1200000 });
/** Ivan's numbers: warning at 70, stop sign at 90; the hand-off button never starts a round above 95. */
export const DEFAULT_LEVELS = Object.freeze({ warnAt: 70, stopAt: 90, neverAbove: 95 });
const TIMES = { probeMs: 8000, liveCacheMs: 60000, backoffMs: 5 * MIN, scanCacheMs: 60000, staleMinutes: 15, chatCap: 40 };
const KINDS = ["fresh", "cacheWrite", "cacheRead", "out"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const zero = () => ({ fresh: 0, cacheWrite: 0, cacheRead: 0, out: 0 });
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const iso = (t) => (Number.isFinite(t) ? new Date(t).toISOString() : null);
const short = (id) => String(id || "").slice(0, 8);
/** Weighted size of one token count. */
export const weigh = (k) => k.fresh * WEIGHTS.fresh + k.cacheWrite * WEIGHTS.cacheWrite + k.cacheRead * WEIGHTS.cacheRead + k.out * WEIGHTS.out;
const add = (a, b) => { for (const k of KINDS) a[k] += b[k]; return a; };
const isoOf = (v) => {   // ISO text, or Unix seconds / milliseconds
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  if (typeof v === "string" && v) { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
  return null;
};
const pctOf = (v) => (typeof v === "number" && Number.isFinite(v) ? r1(Math.min(100, Math.max(0, v))) : null);

// ---------- levels (data/hub-usage-config.json, optional) ----------
/** Pure. text = the file's content or null when there is none. Wrong content -> defaults plus a plain `problem` line. */
export function levelsFrom(text) {
  const dflt = (problem) => ({ ...DEFAULT_LEVELS, source: "default", ...(problem ? { problem } : {}) });
  if (text === null || text === undefined) return dflt();
  let j; try { j = JSON.parse(String(text)); } catch { return dflt("The levels file could not be read, so the usual 70 and 90 are used."); }
  const ok = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
  if (!j || typeof j !== "object" || Array.isArray(j) || !ok(j.warnAt) || !ok(j.stopAt) || !(j.warnAt < j.stopAt)) return dflt("The levels file has wrong numbers (each 0 to 100, the warning below the stop sign), so the usual 70 and 90 are used.");
  const out = { warnAt: j.warnAt, stopAt: j.stopAt, neverAbove: Math.max(DEFAULT_LEVELS.neverAbove, j.stopAt), source: "config" };
  if (j.neverAbove !== undefined) {
    if (ok(j.neverAbove) && j.neverAbove >= j.stopAt) out.neverAbove = j.neverAbove;
    else out.problem = "The 'neverAbove' number in the levels file is wrong (0 to 100, not below the stop sign), so " + out.neverAbove + " is used.";
  }
  return out;
}
export const statusOf = (p, lv) => (p === null || p === undefined ? "unknown" : p >= lv.stopAt ? "stop" : p >= lv.warnAt ? "warn" : "ok");
const RANK = { ok: 0, unknown: 1, warn: 2, stop: 3 };
export const worst = (a, b) => (RANK[a] >= RANK[b] ? a : b);

// ---------- (a) live: one get_usage question to a windowless claude ----------
/** Pure. The `response` object of a successful get_usage answer -> { available, fiveHour, weekly, variants }. Only percentages and reset times are kept. */
export function parseUsageAnswer(resp) {
  const win = (w) => (w && typeof w === "object" ? { percent: pctOf(w.utilization ?? w.used_percentage), resetsAt: isoOf(w.resets_at) } : null);
  if (!resp || typeof resp !== "object" || resp.rate_limits_available !== true || !resp.rate_limits || typeof resp.rate_limits !== "object") return { available: false };
  const rl = resp.rate_limits;
  const fiveHour = win(rl.five_hour), weekly = win(rl.seven_day);
  if ((!fiveHour || fiveHour.percent === null) && (!weekly || weekly.percent === null)) return { available: false };
  const variants = [];
  const named = { seven_day_opus: "Opus, 7 days", seven_day_sonnet: "Sonnet, 7 days" };
  for (const [k, name] of Object.entries(named)) { const w = win(rl[k]); if (w && w.percent !== null) variants.push({ name, ...w }); }
  if (Array.isArray(rl.model_scoped)) for (const m of rl.model_scoped.slice(0, 6)) {
    const w = win(m); if (w && w.percent !== null) variants.push({ name: String(m.display_name || "Model").replace(/[^\w .,()+-]/g, "").slice(0, 40) + ", 7 days", ...w });
  }
  return { available: true, fiveHour, weekly, variants };
}

/** The exact arguments (research U5): print mode, stream-json both ways, no saved chat file. No prompt is ever given. */
export const PROBE_ARGS = Object.freeze(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--no-session-persistence"]);
const defaultKill = (child) => {
  if (!child) return;
  if (process.platform === "win32" && typeof child.pid === "number") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 10000 });
  else child.kill();
};

/** Runs the probe once: no shell, no window, one control line on standard input, then closed; killed after timeoutMs.
 *  -> { state: "ok", parsed } | { state: "not-available" } | { state: "failed", why } | { state: "timeout" }. Never throws. */
export function runProbe({ spawnFn = nodeSpawn, killFn = defaultKill, cmd = ["claude"], cwd = HUB_DIR, timeoutMs = TIMES.probeMs } = {}) {
  return new Promise((done) => {
    const reqId = "usage-" + randomBytes(8).toString("hex");
    let child = null, buf = "", total = 0, fin = false, closed = false;
    const finish = (r) => { if (!fin) { fin = true; done(r); } };
    const timer = setTimeout(() => { if (!closed) { try { killFn(child); } catch { /* gone */ } } finish({ state: "timeout" }); }, timeoutMs);
    const onLine = (line) => {
      const s = line.trim(); if (!s || s[0] !== "{") return;
      let o; try { o = JSON.parse(s); } catch { return; }
      if (!o || o.type !== "control_response" || !o.response || typeof o.response !== "object") return;
      const r = o.response;
      if ((r.request_id ?? o.request_id) !== reqId) return;
      if (r.subtype !== "success") return finish({ state: "failed", why: "error answer" });
      const parsed = parseUsageAnswer(r.response);
      finish(parsed.available ? { state: "ok", parsed } : { state: "not-available" });
    };
    try {
      child = spawnFn(cmd[0], [...cmd.slice(1), ...PROBE_ARGS], { cwd, env: process.env, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "ignore"] });
    } catch { clearTimeout(timer); return finish({ state: "failed", why: "could not start" }); }
    if (!child || !child.stdout || !child.stdin) { clearTimeout(timer); return finish({ state: "failed", why: "could not start" }); }
    child.stdout.on("data", (d) => {
      const t = typeof d === "string" ? d : d.toString("utf8");
      total += t.length;
      if (total > (4 << 20)) { try { killFn(child); } catch { /* gone */ } return finish({ state: "failed", why: "too much output" }); }
      buf += t; let i;
      while ((i = buf.indexOf("\n")) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    child.on("error", () => { closed = true; clearTimeout(timer); finish({ state: "failed", why: "could not start" }); });
    child.on("close", () => { closed = true; clearTimeout(timer); if (buf) onLine(buf); buf = ""; finish({ state: "failed", why: "no answer" }); });
    if (child.stdin.on) child.stdin.on("error", () => { /* it ended before reading */ });
    try { child.stdin.end(JSON.stringify({ type: "control_request", request_id: reqId, request: { subtype: "get_usage", skip_behaviors: true } }) + "\n"); }
    catch { /* the close handler reports it */ }
  });
}

// ---------- (b) the app's own usage history ----------
/** Pure. The file's text -> { ok: true, samples: [{ t, fh, sd }] sorted } or { ok: false, problem }. `org` is dropped here and never kept. */
export function parseHistory(text) {
  let j; try { j = JSON.parse(String(text)); } catch { return { ok: false, problem: "corrupt" }; }
  if (!j || !Array.isArray(j.samples)) return { ok: false, problem: "corrupt" };
  const p = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1000 ? Math.min(100, v) : null);
  const samples = [];
  for (const s of j.samples) {
    if (!s || typeof s.t !== "number" || !Number.isFinite(s.t) || !s.u || typeof s.u !== "object") continue;
    const fh = p(s.u.fh), sd = p(s.u.sd);
    if (fh === null && sd === null) continue;
    samples.push({ t: s.t, fh, sd });
  }
  if (!samples.length) return { ok: false, problem: "empty" };
  samples.sort((a, b) => a.t - b.t);
  return { ok: true, samples };
}

/** Pure. When did the current weekly window start? liveReset = the last reset time claude itself gave (ms), if any. */
export function weeklyWindowStart(samples, t, liveReset) {
  if (Number.isFinite(liveReset) && liveReset > t) return { start: liveReset - WEEK, basis: "reset-from-claude", resetsAt: liveReset, guess: false };
  for (let i = (samples || []).length - 1; i > 0; i--) {
    const a = samples[i - 1], b = samples[i];
    if (a.sd === null || b.sd === null || a.sd - b.sd < 10) continue;   // a big drop of the weekly number = the window was reset in between
    let start = b.t - a.t <= 12 * HOUR ? a.t : b.t;   // a short gap: take the earlier sample (counts a little more, the safe side)
    let rolled = false;
    while (start + WEEK <= t) { start += WEEK; rolled = true; }
    if (start > t) break;
    return { start, basis: rolled ? "reset-seen-plus-7-days" : "since-reset-seen", resetsAt: start + WEEK, guess: true };
  }
  return { start: t - WEEK, basis: "last-7-days", resetsAt: null, guess: true };
}

/** Pure. Learn weighted tokens per percent from stretches of the history where the number only went up.
 *  weightedBetween(a, b) = weighted tokens of replies with a < time <= b. Stretches must start at or after horizonT (older tokens are not scanned). */
export function learnCalibration(samples, weightedBetween, { horizonT = -Infinity } = {}) {
  const one = (key, maxGap, minDelta, dflt) => {
    const ratios = [];
    const close = (run) => {
      if (run.length < 2) return;
      const lastV = run[run.length - 1][key], firstV = run[0][key];
      const end = run.find((s) => s[key] === lastV);             // stop at the first sample that reached the final value (a cap at 100 adds nothing)
      const start = [...run].reverse().find((s) => s[key] === firstV && s.t <= end.t);   // leave a flat start out
      const delta = end[key] - start[key];
      if (delta < minDelta || start.t < horizonT) return;
      const w = weightedBetween(start.t, end.t);
      if (!(w > 0)) return;
      const ratio = w / delta;
      if (ratio >= dflt / 10 && ratio <= dflt * 10) ratios.push(Math.round(ratio));
    };
    let run = [];
    for (const s of samples || []) {
      if (s[key] === null) continue;
      const prev = run[run.length - 1];
      if (prev && (s[key] < prev[key] || s.t - prev.t > maxGap)) { close(run); run = []; }
      run.push(s);
    }
    close(run);
    ratios.sort((a, b) => a - b);
    const median = ratios.length ? (ratios.length % 2 ? ratios[(ratios.length - 1) / 2] : Math.round((ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2)) : null;
    const learned = ratios.length >= 2;
    return { tokensPerPercent: learned ? median : dflt, learned, stretches: ratios.length, default: dflt };
  };
  return { fiveHour: one("fh", 90 * MIN, 10, DEFAULT_CALIBRATION.fiveHour), weekly: one("sd", 2 * 24 * HOUR, 3, DEFAULT_CALIBRATION.weekly) };
}

// ---------- (c) the Hub's own count: every API reply on this PC, once ----------
const K_USAGE = Buffer.from('"usage"'), K_ASSIST = Buffer.from('"assistant"');
const keyOf = (n) => String(n).replace(/[^A-Za-z0-9]/g, "-").toLowerCase();

/**
 * The engine. Every outside piece can be replaced (the self-test uses fakes for all of them):
 *  homeDir      chats under <homeDir>/.claude/projects                      default: this user's home
 *  appDataDir   the app's history under <appDataDir>/Claude-Data/claude_*  default: %LOCALAPPDATA%
 *  claudeCmd    [program, ...first arguments]                               default: ["claude"]
 *  now()        clock in ms                                                  default: Date.now
 *  readFileFn   (path) -> text (throws when missing)                         default: readFileSync utf8
 *  spawnFn, killFn                                                           default: node spawn, taskkill /T /F
 *  config       { hubDir, projectsRoot, levelsFile, probeMs, liveCacheMs, backoffMs, scanCacheMs }
 */
export function makeUsage({ homeDir = homedir(), appDataDir = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), claudeCmd = ["claude"], now = Date.now, readFileFn = (p) => readFileSync(p, "utf8"), spawnFn = nodeSpawn, killFn = defaultKill, config = {} } = {}) {
  const cmd = Array.isArray(claudeCmd) ? claudeCmd.slice() : [String(claudeCmd || "claude")];
  const hubDir = config.hubDir || HUB_DIR;
  const projectsRoot = config.projectsRoot || resolve(hubDir, "..");
  const levelsFile = config.levelsFile || join(hubDir, "data", "hub-usage-config.json");
  const tm = { ...TIMES, ...Object.fromEntries(Object.entries(config).filter(([k, v]) => k in TIMES && Number.isFinite(v))) };
  const stats = { probes: 0, bytesRead: 0, filesRead: 0, scans: 0 };

  // --- live probe state: 60 s cache after an answer, 5 min pause after "not available" or a failure ---
  const live = { last: null, state: "not-tried", checkedAt: null, nextTryAt: 0, inflight: null, weekReset: null };
  async function refreshLive(allowProbe) {
    const t = now();
    if (!allowProbe || t < live.nextTryAt) return;
    if (!live.inflight) {
      stats.probes++;
      live.inflight = runProbe({ spawnFn, killFn, cmd, cwd: hubDir, timeoutMs: tm.probeMs }).then((r) => {
        const at = now();
        live.state = r.state; live.checkedAt = at;
        if (r.state === "ok") {
          live.last = { at, ...r.parsed };
          live.nextTryAt = at + tm.liveCacheMs;
          const wr = r.parsed.weekly && r.parsed.weekly.resetsAt ? Date.parse(r.parsed.weekly.resetsAt) : NaN;
          if (Number.isFinite(wr)) live.weekReset = wr;
        } else live.nextTryAt = at + tm.backoffMs;
      }).catch(() => { live.state = "failed"; live.checkedAt = now(); live.nextTryAt = now() + tm.backoffMs; }).finally(() => { live.inflight = null; });
    }
    await live.inflight;
  }

  // --- the app's history file: the newest claude_*/plan-usage-history.json ---
  function readHistory() {
    const base = join(appDataDir, "Claude-Data");
    let best = null;
    let names = []; try { names = readdirSync(base); } catch { names = []; }
    for (const d of names) {
      if (!d.startsWith("claude_")) continue;
      const f = join(base, d, "plan-usage-history.json");
      try { const st = statSync(f); if (st.isFile() && (!best || st.mtimeMs > best.mtimeMs)) best = { f, mtimeMs: st.mtimeMs }; } catch { /* not there */ }
    }
    if (!best) return { ok: false, problem: "missing" };
    let text; try { text = readFileFn(best.f); } catch { return { ok: false, problem: "missing" }; }
    return parseHistory(text);
  }

  function readLevels() {
    let text = null;
    try { text = readFileFn(levelsFile); } catch (e) { text = e && e.code && e.code !== "ENOENT" ? "{bad" : null; }
    return levelsFrom(text);
  }

  // --- chat files: per-file offsets and times, so a refresh reads only what was added ---
  const files = new Map();   // path -> { path, mtimeMs, size, offset, chat, helper, project, firstT, byKey: Map, list: [] }
  let projNames = null, projAt = -Infinity, scanCache = null, scanInflight = null;
  function projectOfFolder(folder) {
    if (!projNames || now() - projAt > tm.scanCacheMs) {
      projAt = now();
      try { projNames = readdirSync(projectsRoot).filter((n) => { try { return !n.startsWith(".") && statSync(join(projectsRoot, n)).isDirectory(); } catch { return false; } }); } catch { projNames = []; }
    }
    const rootKey = keyOf(projectsRoot), f = String(folder).toLowerCase();
    if (f === rootKey) return "workshop";
    let hit = null;
    for (const n of projNames) { const k = rootKey + "-" + keyOf(n); if ((f === k || f.startsWith(k + "-")) && (!hit || n.length > hit.length)) hit = n; }
    return hit || "other";
  }

  function handleLine(b, st, horizon) {
    if (b.indexOf(K_USAGE) === -1 || b.indexOf(K_ASSIST) === -1) return;
    let o; try { o = JSON.parse(b.toString("utf8")); } catch { return; }
    if (!o || o.type !== "assistant") return;
    const m = o.message;
    if (!m || typeof m !== "object" || m.model === "<synthetic>" || !m.usage || typeof m.usage !== "object") return;
    const keys = [];
    if (typeof o.requestId === "string" && o.requestId) keys.push("r:" + o.requestId);
    if (typeof m.id === "string" && m.id) keys.push("m:" + m.id);
    if (!keys.length) return;
    const t = Date.parse(o.timestamp);
    if (!Number.isFinite(t) || t < horizon) return;
    const u = m.usage;
    const v = { fresh: num(u.input_tokens), cacheWrite: num(u.cache_creation_input_tokens), cacheRead: num(u.cache_read_input_tokens), out: num(u.output_tokens) };
    let prev = null; for (const k of keys) { prev = st.byKey.get(k); if (prev) break; }
    if (prev) { for (const k of KINDS) if (v[k] > prev.v[k]) prev.v[k] = v[k]; for (const k of keys) { st.byKey.set(k, prev); if (!prev.keys.includes(k)) prev.keys.push(k); } return; }
    const rec = { t, v, keys };
    for (const k of keys) st.byKey.set(k, rec);
    st.list.push(rec);
    if (!(st.firstT <= t)) st.firstT = t;
  }

  async function readFrom(st, horizon) {
    const fh = await openFile(st.path, "r");
    try {
      const buf = Buffer.allocUnsafe(1 << 22);
      let pos = st.offset, carry = null;
      for (;;) {
        const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
        if (!bytesRead) break;
        stats.bytesRead += bytesRead; pos += bytesRead;
        const chunk = carry ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
        let start = 0, nl;
        while ((nl = chunk.indexOf(10, start)) !== -1) { handleLine(chunk.subarray(start, nl), st, horizon); start = nl + 1; }
        carry = start < chunk.length ? Buffer.from(chunk.subarray(start)) : null;   // a copy: the read buffer is reused
      }
      st.offset = pos - (carry ? carry.length : 0);   // a half-written last line is read again next time
    } finally { await fh.close(); }
  }

  async function scanFiles() {
    const t = now(), horizon = t - WEEK - HOUR;
    const base = join(homeDir, ".claude", "projects");
    const ls = (d) => { try { return readdirSync(d, { withFileTypes: true }); } catch { return null; } };
    const top = ls(base);
    if (!top) { files.clear(); return { ok: false }; }
    const seen = new Set();
    const consider = async (path, folder, chat, helper) => {
      let st; try { st = statSync(path); } catch { return; }
      if (!st.isFile() || st.mtimeMs < t - WEEK) return;   // only files changed in the last 7 days
      seen.add(path);
      let f = files.get(path);
      if (f && f.size === st.size && f.mtimeMs === st.mtimeMs) return;   // unchanged: nothing is read again
      if (!f || st.size < f.offset) { f = { path, mtimeMs: 0, size: 0, offset: 0, chat, helper, project: projectOfFolder(folder), firstT: Infinity, byKey: new Map(), list: [] }; files.set(path, f); }
      try { stats.filesRead++; await readFrom(f, horizon); f.size = st.size; f.mtimeMs = st.mtimeMs; } catch { /* unreadable now: tried again next time */ }
    };
    for (const d of top) {
      if (!d.isDirectory()) continue;
      const folder = join(base, d.name);
      const inner = ls(folder) || [];
      for (const e of inner) {
        if (e.isFile() && e.name.endsWith(".jsonl")) await consider(join(folder, e.name), d.name, e.name.slice(0, -6), false);
        else if (e.isDirectory() && UUID.test(e.name)) {
          const sub = join(folder, e.name, "subagents");
          for (const h of ls(sub) || []) if (h.isFile() && h.name.endsWith(".jsonl")) await consider(join(sub, h.name), d.name, e.name, true);
        }
      }
    }
    for (const p of [...files.keys()]) if (!seen.has(p)) files.delete(p);
    return { ok: true };
  }

  /** The deduped replies of the last 7 days (plus an hour), cached tm.scanCacheMs. Each API reply once, across ALL files (a resumed chat copies old lines). */
  async function scan() {
    if (scanCache && now() - scanCache.at < tm.scanCacheMs) return scanCache;
    if (!scanInflight) scanInflight = (async () => {
      stats.scans++;
      const r = await scanFiles();
      const horizon = now() - WEEK - HOUR;
      const order = [...files.values()].sort((a, b) => a.firstT - b.firstT || (a.path < b.path ? -1 : 1));
      const seen = new Map(), replies = [];
      for (const f of order) {
        f.list = f.list.filter((x) => x.t >= horizon);
        for (const x of f.list) {
          let g = null; for (const k of x.keys) { g = seen.get(k); if (g) break; }
          if (g) { for (const k of KINDS) if (x.v[k] > g.v[k]) g.v[k] = x.v[k]; for (const k of x.keys) seen.set(k, g); continue; }
          g = { t: x.t, v: { ...x.v }, chat: f.chat, helper: f.helper, project: f.project };
          for (const k of x.keys) seen.set(k, g);
          replies.push(g);
        }
      }
      replies.sort((a, b) => a.t - b.t);
      const times = replies.map((x) => x.t), pre = [0];
      for (const x of replies) { x.w = weigh(x.v); pre.push(pre[pre.length - 1] + x.w); }
      scanCache = { at: now(), ok: r.ok, replies, times, pre, files: files.size };
      return scanCache;
    })().finally(() => { scanInflight = null; });
    return scanInflight;
  }
  const lowerIdx = (arr, x) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; } return lo; };   // first index with arr[i] > x
  const weightedBetween = (sc) => (a, b) => (b <= a ? 0 : sc.pre[lowerIdx(sc.times, b)] - sc.pre[lowerIdx(sc.times, a)]);

  /** One snapshot for the page. liveSessionIds: full or 8-character ids of running chats; labels: { [fullSessionId]: { name?, chatId? } }; probe: false = never run claude now. */
  async function snapshot({ liveSessionIds, labels, probe = true } = {}) {
    const [, sc] = await Promise.all([refreshLive(probe !== false), scan()]);
    const t = now();
    const lv = readLevels();
    const hist = readHistory();
    const samples = hist.ok ? hist.samples : [];
    const lastS = samples.length ? samples[samples.length - 1] : null;
    const between = weightedBetween(sc);
    const calibration = learnCalibration(samples, between, { horizonT: t - WEEK });
    const ws = weeklyWindowStart(samples, t, live.weekReset);
    const age = (at) => Math.max(0, Math.round((t - at) / MIN));
    const cand = (source, percent, at, extra = {}) => ({ source, percent, asOf: iso(at), ageMinutes: age(at), stale: age(at) > tm.staleMinutes, ...extra });

    // estimates (only when the chat folder could be read at all)
    const est = { fiveHour: null, weekly: null };
    if (sc.ok) {
      const c5 = calibration.fiveHour.tokensPerPercent, cw = calibration.weekly.tokensPerPercent;
      const plain = between(t - FIVE_H, t) / c5;
      let p5 = plain, b5 = "last-5-hours";
      if (lastS && lastS.fh !== null && t - lastS.t < FIVE_H) { const anchored = lastS.fh + between(lastS.t, t) / c5; if (anchored > p5) { p5 = anchored; b5 = "app-value-plus-since"; } }
      est.fiveHour = cand("estimate", pctOf(p5), sc.at, { basis: b5, resetsAt: null, resetsAtGuess: false });
      const anchorW = [...samples].reverse().find((s) => s.sd !== null && s.t >= ws.start && s.t >= t - WEEK);
      const pw = anchorW ? anchorW.sd + between(anchorW.t, t) / cw : between(ws.start, t) / cw;
      est.weekly = cand("estimate", pctOf(pw), sc.at, { basis: anchorW ? "app-value-plus-since" : ws.basis, resetsAt: ws.resetsAt && ws.resetsAt > t ? iso(ws.resetsAt) : null, resetsAtGuess: !!(ws.resetsAt && ws.resetsAt > t && ws.guess) });
    }
    const histC = {
      fiveHour: lastS && lastS.fh !== null ? cand("app-history", lastS.fh, lastS.t, { resetsAt: null, resetsAtGuess: false }) : null,
      weekly: lastS && lastS.sd !== null ? (() => { const ra = ws.resetsAt && ws.resetsAt > t ? iso(ws.resetsAt) : null; return cand("app-history", lastS.sd, lastS.t, { resetsAt: ra, resetsAtGuess: !!ra && ws.guess }); })() : null,
    };
    const liveC = {
      fiveHour: live.last && live.last.fiveHour && live.last.fiveHour.percent !== null ? cand("claude", live.last.fiveHour.percent, live.last.at, { resetsAt: live.last.fiveHour.resetsAt, resetsAtGuess: false }) : null,
      weekly: live.last && live.last.weekly && live.last.weekly.percent !== null ? cand("claude", live.last.weekly.percent, live.last.at, { resetsAt: live.last.weekly.resetsAt, resetsAtGuess: false }) : null,
    };
    const pick = (k) => {
      const all = [liveC[k], histC[k], est[k]].filter(Boolean);
      const chosen = (liveC[k] && !liveC[k].stale && liveC[k]) || (histC[k] && !histC[k].stale && histC[k]) || est[k] || [liveC[k], histC[k]].filter(Boolean).sort((a, b) => a.ageMinutes - b.ageMinutes)[0] || null;
      const alternatives = all.filter((x) => x !== chosen).map(({ source, percent, asOf, ageMinutes, stale, basis }) => ({ source, percent, asOf, ageMinutes, stale, ...(basis ? { basis } : {}) }));
      if (!chosen) return { percent: null, resetsAt: null, resetsAtGuess: false, source: "none", asOf: null, ageMinutes: null, stale: false, status: "unknown", alternatives };
      const { source, percent, asOf, ageMinutes, stale, basis, resetsAt, resetsAtGuess } = chosen;
      return { percent, resetsAt: resetsAt || null, resetsAtGuess: !!resetsAtGuess, source, asOf, ageMinutes, stale, status: statusOf(percent, lv), ...(basis ? { basis } : {}), alternatives };
    };
    const limits = { fiveHour: pick("fiveHour"), weekly: pick("weekly") };

    // per chat and totals
    const liveSet = new Set((Array.isArray(liveSessionIds) ? liveSessionIds : []).filter((x) => typeof x === "string" && x).map((x) => short(x).toLowerCase()));
    const t5 = t - FIVE_H, tw = Math.max(ws.start, t - WEEK);
    const tot = { fiveHour: { tokens: zero(), weighted: 0, replies: 0, helpers: { tokens: zero(), weighted: 0, replies: 0 } }, week: { tokens: zero(), weighted: 0, replies: 0, helpers: { tokens: zero(), weighted: 0, replies: 0 } } };
    const perChat = new Map();
    for (const x of sc.replies) {
      if (x.t < t - WEEK) continue;
      let c = perChat.get(x.chat);
      if (!c) { c = { chat: x.chat, project: x.project, lastT: 0, tokens: zero(), weighted5h: 0, helperWeighted5h: 0 }; perChat.set(x.chat, c); }
      if (x.t > c.lastT) c.lastT = x.t;
      if (!x.helper && x.project !== "other") c.project = x.project;
      const into = (bucket) => { add(bucket.tokens, x.v); bucket.weighted += x.w; bucket.replies++; if (x.helper) { add(bucket.helpers.tokens, x.v); bucket.helpers.weighted += x.w; bucket.helpers.replies++; } };
      if (x.t > t5) { into(tot.fiveHour); add(c.tokens, x.v); c.weighted5h += x.w; if (x.helper) c.helperWeighted5h += x.w; }
      if (x.t > tw) into(tot.week);
    }
    const all5 = tot.fiveHour.weighted;
    const lab = labels && typeof labels === "object" ? labels : {};
    const chatsAll = [...perChat.values()].sort((a, b) => b.lastT - a.lastT);
    const chats = chatsAll.slice(0, tm.chatCap).map((c) => {
      const l = lab[c.chat] && typeof lab[c.chat] === "object" ? lab[c.chat] : {};
      const o = { sessionId: short(c.chat), project: c.project, lastActive: iso(c.lastT), weighted5h: Math.round(c.weighted5h), helperWeighted5h: Math.round(c.helperWeighted5h), share5h: all5 > 0 ? Math.round((c.weighted5h / all5) * 1000) / 1000 : 0, tokens: c.tokens, live: liveSet.has(short(c.chat).toLowerCase()) };
      if (typeof l.name === "string" && l.name) o.name = l.name.slice(0, 80);
      if (typeof l.chatId === "string" && /^(h-[A-Za-z0-9_-]{1,60}|s-[0-9a-fA-F-]{8})$/.test(l.chatId)) o.chatId = l.chatId;
      return o;
    });
    const roundW = (b) => ({ ...b, weighted: Math.round(b.weighted), helpers: { ...b.helpers, weighted: Math.round(b.helpers.weighted) } });
    const notes = [];
    if (live.state === "not-available") notes.push("The command line gave no plan numbers (it is probably signed out: run 'claude /login' once in a terminal).");
    if (!hist.ok) notes.push(hist.problem === "missing" ? "The Claude app's usage history was not found." : "The Claude app's usage history could not be read.");
    if (!sc.ok) notes.push("The saved chats folder could not be read, so there is no estimate.");
    if (lv.problem) notes.push(lv.problem);

    return {
      generatedAt: iso(t), demo: false,
      limits, overall: worst(limits.fiveHour.status, limits.weekly.status),
      levels: { warnAt: lv.warnAt, stopAt: lv.stopAt, neverAbove: lv.neverAbove, source: lv.source, ...(lv.problem ? { problem: lv.problem } : {}) },
      live: { state: live.state, checkedAt: iso(live.checkedAt), nextTryAt: live.nextTryAt ? iso(live.nextTryAt) : null, ...(live.last && live.last.variants && live.last.variants.length ? { variants: live.last.variants } : {}) },
      history: hist.ok ? { found: true, asOf: iso(lastS.t), ageMinutes: age(lastS.t), samples: samples.length } : { found: false, problem: hist.problem },
      calibration,
      total: { fiveHour: { from: iso(t5), ...roundW(tot.fiveHour) }, week: { from: iso(tw), basis: ws.basis, ...roundW(tot.week) } },
      chats, chatsTotal: chatsAll.length,
      notes,
    };
  }

  return { snapshot, stats: () => ({ ...stats, cachedFiles: files.size }) };
}

/** --demo: a fixed made-up sample (one warning at 74 percent, one ok), for screenshots. Same shape as snapshot(). */
export function demoUsage(t = Date.now()) {
  const at = (m) => new Date(t - m * MIN).toISOString();
  const tk = (f, w, r, o) => ({ fresh: f, cacheWrite: w, cacheRead: r, out: o });
  const chats = [
    { sessionId: "a1b2c3d4", chatId: "h-20261116-101500-k3x9", project: "Hub", name: "Usage meter", lastActive: at(2), weighted5h: 5310000, helperWeighted5h: 1850000, share5h: 0.46, tokens: tk(820, 1650000, 21400000, 182000), live: true },
    { sessionId: "b2c3d4e5", chatId: "s-b2c3d4e5", project: "Socials Automatisation", name: "ClipForge captions", lastActive: at(18), weighted5h: 3920000, helperWeighted5h: 0, share5h: 0.34, tokens: tk(410, 1210000, 16100000, 140000), live: true },
    { sessionId: "c3d4e5f6", chatId: "s-c3d4e5f6", project: "THE UNMADE", name: "Enemy sprites", lastActive: at(140), weighted5h: 2310000, helperWeighted5h: 640000, share5h: 0.2, tokens: tk(220, 690000, 10300000, 80000), live: false },
    { sessionId: "d4e5f6a7", project: "Hub", lastActive: at(60 * 30), weighted5h: 0, helperWeighted5h: 0, share5h: 0, tokens: tk(0, 0, 0, 0), live: false },
  ];
  return {
    generatedAt: new Date(t).toISOString(), demo: true,
    limits: {
      fiveHour: { percent: 74, resetsAt: null, resetsAtGuess: false, source: "app-history", asOf: at(6), ageMinutes: 6, stale: false, status: "warn", alternatives: [{ source: "estimate", percent: 71.5, asOf: at(0), ageMinutes: 0, stale: false, basis: "app-value-plus-since" }] },
      weekly: { percent: 41, resetsAt: new Date(t + 3 * 24 * HOUR).toISOString(), resetsAtGuess: true, source: "app-history", asOf: at(6), ageMinutes: 6, stale: false, status: "ok", alternatives: [{ source: "estimate", percent: 43.2, asOf: at(0), ageMinutes: 0, stale: false, basis: "app-value-plus-since" }] },
    },
    overall: "warn",
    levels: { ...DEFAULT_LEVELS, source: "default" },
    live: { state: "not-available", checkedAt: at(1), nextTryAt: new Date(t + 4 * MIN).toISOString() },
    history: { found: true, asOf: at(6), ageMinutes: 6, samples: 125 },
    calibration: { fiveHour: { tokensPerPercent: 158000, learned: true, stretches: 3, default: DEFAULT_CALIBRATION.fiveHour }, weekly: { tokensPerPercent: 1200000, learned: false, stretches: 1, default: DEFAULT_CALIBRATION.weekly } },
    total: {
      fiveHour: { from: at(300), tokens: tk(1450, 3550000, 47800000, 402000), weighted: 11540000, replies: 412, helpers: { tokens: tk(300, 760000, 9900000, 98000), weighted: 2490000, replies: 96 } },
      week: { from: at(60 * 24 * 4), basis: "app-value-plus-since", tokens: tk(9800, 24100000, 610000000, 3900000), weighted: 110630000, replies: 3880, helpers: { tokens: tk(2100, 5200000, 120000000, 900000), weighted: 23000000, replies: 810 } },
    },
    chats, chatsTotal: chats.length,
    notes: ["The command line gave no plan numbers (it is probably signed out: run 'claude /login' once in a terminal)."],
  };
}

// ---------------------------------------------------------------- self-test (fakes only) ----------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv.includes("--selftest")) {
  const { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, utimesSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { EventEmitter } = await import("node:events");
  let pass = 0, fail = 0;
  const check = (name, cond) => { console.log(`${cond ? "OK  " : "FAIL"} ${name}`); if (cond) pass++; else { fail++; process.exitCode = 1; } };
  const tmp = mkdtempSync(join(tmpdir(), "hub-usage-"));
  const ORG = "org-SECRET-5e3f9a1c-7777-4444-8888-123456789abc";
  const NOW0 = Date.now();
  let clock = NOW0; const now = () => clock;

  // a fake spawn: behaviour "answer" | "na" | "hang" | "garbage" | "error-answer" | "throw"
  const calls = [];
  const fakeSpawn = (mode, answer) => (prog, args, opts) => {
    calls.push({ prog, args, opts });
    if (mode === "throw") throw new Error("ENOENT");
    const ch = new EventEmitter(); ch.stdout = new EventEmitter(); ch.killed = false; let input = "";
    ch.stdin = { on() {}, end(s) { input += s; setTimeout(() => respond(), 5); } };
    ch.kill = () => { ch.killed = true; setTimeout(() => ch.emit("close", null), 1); };
    const respond = () => {
      let rid = null; try { rid = JSON.parse(input.trim()).request_id; } catch { /* bad */ }
      if (mode === "hang") return;
      if (mode === "garbage") { ch.stdout.emit("data", "not json at all\n{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"someone-else\",\"response\":{}}}\n{broken"); setTimeout(() => ch.emit("close", 0), 2); return; }
      const ans = mode === "na" ? { session: { total_cost_usd: 0 }, subscription_type: null, rate_limits_available: false, rate_limits: null, behaviors: null } : answer;
      ch.stdout.emit("data", JSON.stringify({ type: "system", subtype: "init" }) + "\n");
      const line = JSON.stringify(mode === "error-answer" ? { type: "control_response", response: { subtype: "error", request_id: rid, error: "nope" } } : { type: "control_response", response: { subtype: "success", request_id: rid, response: ans } });
      ch.stdout.emit("data", line.slice(0, 20)); ch.stdout.emit("data", line.slice(20) + "\n");   // split across two chunks
      setTimeout(() => ch.emit("close", 0), 2);
    };
    return ch;
  };
  const RESET5 = new Date(NOW0 + 2 * HOUR).toISOString(), RESETW = new Date(NOW0 + 3 * 24 * HOUR).toISOString();
  const ANSWER = { session: { total_cost_usd: 0 }, subscription_type: "max", rate_limits_available: true, rate_limits: { five_hour: { utilization: 75.4, resets_at: RESET5 }, seven_day: { utilization: 92, resets_at: RESETW }, seven_day_opus: { utilization: 10, resets_at: RESETW }, seven_day_sonnet: null, model_scoped: [{ display_name: "Fable", utilization: 5, resets_at: RESETW }] }, behaviors: null };

  // ---- pure parts ----
  check("weights: fresh x1, cache write x1.25, cache read x0.1, output x5", weigh({ fresh: 100, cacheWrite: 1000, cacheRead: 10000, out: 10 }) === 100 + 1250 + 1000 + 50);
  check("levels: no file = 70 / 90 / 95 defaults", JSON.stringify(levelsFrom(null)) === JSON.stringify({ warnAt: 70, stopAt: 90, neverAbove: 95, source: "default" }));
  const lv1 = levelsFrom(JSON.stringify({ warnAt: 60, stopAt: 85 }));
  check("levels: a valid file is used", lv1.warnAt === 60 && lv1.stopAt === 85 && lv1.neverAbove === 95 && lv1.source === "config" && !lv1.problem);
  check("levels: valid neverAbove is used, stopAt above 95 lifts neverAbove", levelsFrom(JSON.stringify({ warnAt: 50, stopAt: 80, neverAbove: 92 })).neverAbove === 92 && levelsFrom(JSON.stringify({ warnAt: 50, stopAt: 97 })).neverAbove === 97);
  const bads = [JSON.stringify({ warnAt: 90, stopAt: 70 }), JSON.stringify({ warnAt: 70, stopAt: 70 }), JSON.stringify({ warnAt: -1, stopAt: 90 }), JSON.stringify({ warnAt: 70, stopAt: 101 }), JSON.stringify({ warnAt: "70", stopAt: 90 }), JSON.stringify([70, 90]), "{oops", "null"];
  check("levels: wrong order, out of range, text numbers, a list, broken JSON, null -> defaults with a problem line", bads.every((b) => { const l = levelsFrom(b); return l.warnAt === 70 && l.stopAt === 90 && l.source === "default" && typeof l.problem === "string"; }));
  check("levels: a wrong neverAbove keeps the others and says so", (() => { const l = levelsFrom(JSON.stringify({ warnAt: 60, stopAt: 80, neverAbove: 50 })); return l.warnAt === 60 && l.neverAbove === 95 && /neverAbove/.test(l.problem); })());
  check("status per level: 69.9 ok, 70 warn, 89.9 warn, 90 stop, null unknown", statusOf(69.9, DEFAULT_LEVELS) === "ok" && statusOf(70, DEFAULT_LEVELS) === "warn" && statusOf(89.9, DEFAULT_LEVELS) === "warn" && statusOf(90, DEFAULT_LEVELS) === "stop" && statusOf(null, DEFAULT_LEVELS) === "unknown");
  check("overall = the worse of the two (ok < unknown < warn < stop)", worst("ok", "warn") === "warn" && worst("stop", "warn") === "stop" && worst("ok", "unknown") === "unknown" && worst("unknown", "warn") === "warn" && worst("ok", "ok") === "ok");
  const pa = parseUsageAnswer(ANSWER);
  check("get_usage answer: utilization and resets_at read for both windows, variants kept small", pa.available && pa.fiveHour.percent === 75.4 && pa.fiveHour.resetsAt === RESET5 && pa.weekly.percent === 92 && pa.variants.length === 2 && pa.variants.some((v) => v.name === "Fable, 7 days"));
  check("get_usage answer: rate_limits_available false / rate_limits null / no numbers = not available", !parseUsageAnswer({ rate_limits_available: false, rate_limits: null }).available && !parseUsageAnswer({ rate_limits_available: true, rate_limits: null }).available && !parseUsageAnswer({ rate_limits_available: true, rate_limits: { five_hour: { utilization: null } } }).available && !parseUsageAnswer(null).available);
  check("get_usage answer: unix-second reset times become ISO", parseUsageAnswer({ rate_limits_available: true, rate_limits: { five_hour: { used_percentage: 12, resets_at: 1790000000 } } }).fiveHour.resetsAt === new Date(1790000000 * 1000).toISOString());
  check("history: corrupt text, no samples list, only bad samples", parseHistory("{nope").problem === "corrupt" && parseHistory("{}").problem === "corrupt" && parseHistory(JSON.stringify({ samples: [{ t: "x" }, { t: 1, u: {} }] })).problem === "empty");
  const ph = parseHistory(JSON.stringify({ version: 2, samples: [{ t: 2000, org: ORG, u: { fh: 5, sd: 9 } }, { t: 1000, org: ORG, u: { fh: 1, sd: 8 } }] }));
  check("history: samples sorted, org dropped", ph.ok && ph.samples[0].t === 1000 && !JSON.stringify(ph).includes(ORG) && Object.keys(ph.samples[0]).join() === "t,fh,sd");
  const S = (t, fh, sd) => ({ t, fh, sd });
  const T0 = NOW0 - 3 * 24 * HOUR;
  const wsDrop = weeklyWindowStart([S(T0 - HOUR, 0, 70), S(T0, 0, 2), S(T0 + HOUR, 0, 5)], NOW0, null);
  check("weekly window: a big drop of the weekly number is the start (earlier sample when the gap is short)", wsDrop.start === T0 - HOUR && wsDrop.basis === "since-reset-seen" && wsDrop.resetsAt === T0 - HOUR + WEEK);
  const wsLong = weeklyWindowStart([S(T0 - 30 * HOUR, 0, 68), S(T0, 0, 38)], NOW0, null);
  check("weekly window: a drop across a long gap uses the later sample", wsLong.start === T0 && wsLong.basis === "since-reset-seen");
  const wsOld = weeklyWindowStart([S(NOW0 - 9 * 24 * HOUR - HOUR, 0, 80), S(NOW0 - 9 * 24 * HOUR, 0, 1)], NOW0, null);
  check("weekly window: a drop older than 7 days rolls forward by 7 days", wsOld.start === NOW0 - 2 * 24 * HOUR - HOUR && wsOld.basis === "reset-seen-plus-7-days");
  check("weekly window: no drop = the last 7 days; small dips are not a reset", weeklyWindowStart([S(T0, 0, 50), S(T0 + HOUR, 0, 45)], NOW0, null).basis === "last-7-days" && weeklyWindowStart([], NOW0, null).start === NOW0 - WEEK);
  check("weekly window: claude's own reset time wins", (() => { const w = weeklyWindowStart([S(T0 - HOUR, 0, 70), S(T0, 0, 2)], NOW0, NOW0 + HOUR); return w.basis === "reset-from-claude" && w.start === NOW0 + HOUR - WEEK && w.guess === false; })());
  // calibration: 200k weighted tokens per minute, two 5-hour stretches (+50 % in 50 min, +30 % in 45 min) and one weekly stretch
  const perMin = (a, b) => Math.max(0, (b - a) / MIN) * 200000;
  const H0 = NOW0 - 2 * 24 * HOUR;
  const cs = [S(H0, 10, 20), S(H0 + 10 * MIN, 10, 20), S(H0 + 60 * MIN, 60, 22), S(H0 + 70 * MIN, 60, 22), S(H0 + 6 * HOUR, 0, 24), S(H0 + 6 * HOUR + 45 * MIN, 30, 25)];
  const cal = learnCalibration(cs, perMin, { horizonT: NOW0 - WEEK });
  check("calibration: 5-hour stretches learned, flat start/end left out, median of 200k and 300k per percent", cal.fiveHour.learned && cal.fiveHour.stretches === 2 && cal.fiveHour.tokensPerPercent === 250000);
  check("calibration: a stretch far outside the plausible range is thrown away", learnCalibration(cs, (a, b) => perMin(a, b) / 1000).fiveHour.stretches === 0);
  check("calibration: too few weekly stretches = the default, marked not learned", !cal.weekly.learned && cal.weekly.tokensPerPercent === DEFAULT_CALIBRATION.weekly && cal.weekly.default === 1200000);
  check("calibration: stretches before the scan horizon and empty token counts are not used", !learnCalibration(cs, perMin, { horizonT: NOW0 }).fiveHour.learned && learnCalibration(cs, () => 0).fiveHour.stretches === 0);
  check("calibration: the research's numbers are the defaults", DEFAULT_CALIBRATION.fiveHour >= 150000 && DEFAULT_CALIBRATION.fiveHour <= 160000 && DEFAULT_CALIBRATION.weekly === 1200000);

  // ---- probe ----
  calls.length = 0;
  const pr = await runProbe({ spawnFn: fakeSpawn("answer", ANSWER), cmd: ["claude"], cwd: tmp });
  const sent = calls[0];
  check("probe: answered (the answer split over two chunks, other lines skipped)", pr.state === "ok" && pr.parsed.fiveHour.percent === 75.4);
  check("probe: exact flags, no prompt text, no shell, no window, in the given folder", sent.args.join(" ") === "-p --input-format stream-json --output-format stream-json --verbose --no-session-persistence" && sent.opts.shell === false && sent.opts.windowsHide === true && sent.opts.cwd === tmp && !sent.args.some((a) => /usage/.test(a)));
  check("probe: not available is a state, not an error", (await runProbe({ spawnFn: fakeSpawn("na") })).state === "not-available");
  const t1 = Date.now(); let killed = 0;
  const hung = await runProbe({ spawnFn: fakeSpawn("hang"), killFn: (c) => { killed++; c.kill(); }, timeoutMs: 150 });
  check("probe: killed on time-out", hung.state === "timeout" && killed === 1 && Date.now() - t1 < 2000);
  check("probe: garbage / someone else's answer / an error answer / a start failure = failed", (await runProbe({ spawnFn: fakeSpawn("garbage") })).state === "failed" && (await runProbe({ spawnFn: fakeSpawn("error-answer") })).state === "failed" && (await runProbe({ spawnFn: fakeSpawn("throw") })).state === "failed");

  // ---- a fake home with chat files, a fake app folder, a fake Hub folder ----
  const home = join(tmp, "home"), appData = join(tmp, "appdata"), busnus = join(tmp, "BUSNUS"), hubDir = join(busnus, "Hub");
  for (const d of [join(busnus, "Hub", "data"), join(busnus, "Alpha"), join(appData, "Claude-Data", "claude_abc123")]) mkdirSync(d, { recursive: true });
  const projects = join(home, ".claude", "projects");
  const fHub = join(projects, String(busnus).replace(/[^A-Za-z0-9]/g, "-") + "-Hub"), fAlpha = join(projects, String(busnus).replace(/[^A-Za-z0-9]/g, "-") + "-Alpha"), fOther = join(projects, "C--scratch");
  for (const d of [fHub, fAlpha, fOther]) mkdirSync(d, { recursive: true });
  const U = (n) => `${String(n).padStart(8, "0")}-1111-4222-8333-${String(n).padStart(12, "0")}`;
  const line = (o) => JSON.stringify({ parentUuid: null, type: "assistant", timestamp: new Date(o.t).toISOString(), requestId: o.req, sessionId: o.sid, message: { id: o.mid || "msg_" + o.req, model: o.model || "claude-sonnet-4-5", role: "assistant", content: [{ type: "text", text: "SECRET MESSAGE TEXT " + o.req }], usage: { input_tokens: o.f || 0, cache_creation_input_tokens: o.cw || 0, cache_read_input_tokens: o.cr || 0, output_tokens: o.o || 0 } } }) + "\n";
  const userLine = (t) => JSON.stringify({ type: "user", timestamp: new Date(t).toISOString(), message: { role: "user", content: "SECRET USER TEXT with \"usage\" and \"assistant\" words" } }) + "\n";
  const A = U(1), B = U(2), C = U(3);
  const fileA = join(fHub, A + ".jsonl"), fileB = join(fAlpha, B + ".jsonl"), fileC = join(fOther, C + ".jsonl");
  // chat A (Hub): one reply written as three lines (content blocks), later line with a bigger output; one reply 6 hours ago; one helper reply
  writeFileSync(fileA, userLine(NOW0 - 7 * HOUR) + line({ t: NOW0 - 6 * HOUR, req: "rA0", sid: A, f: 10, cw: 1000, cr: 10000, o: 100 })
    + line({ t: NOW0 - 30 * MIN, req: "rA1", sid: A, f: 100, cw: 1000, cr: 10000, o: 10 }) + line({ t: NOW0 - 30 * MIN, req: "rA1", sid: A, f: 100, cw: 1000, cr: 10000, o: 10 }) + line({ t: NOW0 - 30 * MIN, req: "rA1", sid: A, f: 100, cw: 1000, cr: 10000, o: 40 })
    + line({ t: NOW0 - 20 * MIN, req: "rSyn", sid: A, model: "<synthetic>", o: 999999 }));
  mkdirSync(join(fHub, A, "subagents"), { recursive: true });
  const fileAh = join(fHub, A, "subagents", "agent-x1.jsonl");
  writeFileSync(fileAh, line({ t: NOW0 - 10 * MIN, req: "rH1", sid: A, f: 4, cw: 400, cr: 4000, o: 40 }));
  // chat B (Alpha): a resumed copy of A's reply rA1 (must count once, for A) and its own reply; a reply with no requestId (falls back to message.id), written twice
  const noReq = (t, mid, o) => JSON.stringify({ type: "assistant", timestamp: new Date(t).toISOString(), message: { id: mid, model: "claude-opus-4-1", content: [], usage: { input_tokens: 1, output_tokens: o } } }) + "\n";
  writeFileSync(fileB, line({ t: NOW0 - 30 * MIN, req: "rA1", sid: B, f: 100, cw: 1000, cr: 10000, o: 40 }) + line({ t: NOW0 - 5 * MIN, req: "rB1", sid: B, f: 1, cw: 0, cr: 2000, o: 20 }) + noReq(NOW0 - 4 * MIN, "msg_only", 7) + noReq(NOW0 - 4 * MIN, "msg_only", 7));
  // chat C (outside the projects): an old reply only (3 days ago) -> active in the week, nothing in 5 hours
  writeFileSync(fileC, line({ t: NOW0 - 3 * 24 * HOUR, req: "rC1", sid: C, f: 1000, o: 1000 }));
  // a file not changed for 8 days: not read at all
  const fileOld = join(fOther, U(9) + ".jsonl");
  writeFileSync(fileOld, line({ t: NOW0 - 30 * MIN, req: "rOld", sid: U(9), f: 123456, o: 5 }));
  const eightDays = (NOW0 - 8 * 24 * HOUR) / 1000; utimesSync(fileOld, eightDays, eightDays);
  // fake app history: fresh (6 minutes old), org inside
  const histFile = join(appData, "Claude-Data", "claude_abc123", "plan-usage-history.json");
  const writeHist = (samples) => writeFileSync(histFile, JSON.stringify({ version: 2, samples: samples.map((s) => ({ t: s.t, org: ORG, u: { fh: s.fh, sd: s.sd } })) }));
  writeHist([S(NOW0 - 2 * 24 * HOUR, 0, 70), S(NOW0 - 2 * 24 * HOUR + 10 * MIN, 0, 3), S(NOW0 - 6 * MIN, 52, 41)]);

  const mk = (o = {}) => makeUsage({ homeDir: home, appDataDir: appData, now, spawnFn: o.spawnFn || fakeSpawn("na"), killFn: o.killFn, config: { hubDir, projectsRoot: busnus, probeMs: 200, ...(o.config || {}) }, ...(o.readFileFn ? { readFileFn: o.readFileFn } : {}) });
  const wA1 = weigh({ fresh: 100, cacheWrite: 1000, cacheRead: 10000, out: 40 }), wH1 = weigh({ fresh: 4, cacheWrite: 400, cacheRead: 4000, out: 40 }), wB1 = weigh({ fresh: 1, cacheWrite: 0, cacheRead: 2000, out: 20 }), wM = weigh({ fresh: 1, cacheWrite: 0, cacheRead: 0, out: 7 });

  calls.length = 0;
  const eng = mk();
  const s1 = await eng.snapshot({ liveSessionIds: [B], labels: { [A]: { name: "Usage meter", chatId: "h-20261124-0101-abcd" }, [B]: { name: "Other", chatId: "../../x" } } });
  const cA = s1.chats.find((c) => c.sessionId === short(A)), cB = s1.chats.find((c) => c.sessionId === short(B)), cC = s1.chats.find((c) => c.sessionId === short(C));
  check("chats: each reply once (repeated lines, a resumed copy in another chat, message.id fallback), synthetic skipped", cA && cB && cA.weighted5h === Math.round(wA1 + wH1) && cB.weighted5h === Math.round(wB1 + wM) && s1.total.fiveHour.replies === 4);
  check("chats: the repeated reply keeps its largest numbers (output 40, not 10 or 3 x 10)", cA.tokens.out === 40 + 40 && cA.tokens.fresh === 104);
  check("total 5 h: weighted and raw sums; helpers marked separately", s1.total.fiveHour.weighted === Math.round(wA1 + wH1 + wB1 + wM) && s1.total.fiveHour.tokens.cacheRead === 10000 + 4000 + 2000 && s1.total.fiveHour.helpers.replies === 1 && s1.total.fiveHour.helpers.weighted === Math.round(wH1) && cA.helperWeighted5h === Math.round(wH1));
  check("total week: counted from the weekly window start the history shows (drop 2 days ago)", s1.total.week.basis === "since-reset-seen" && s1.total.week.replies === 5 && Date.parse(s1.total.week.from) === NOW0 - 2 * 24 * HOUR);
  check("chats: project from the folder name (Hub, Alpha, other), newest first, a file unchanged for 8 days skipped", cA.project === "Hub" && cB.project === "Alpha" && cC && cC.project === "other" && s1.chats[0].sessionId === short(B) && !s1.chats.some((c) => c.sessionId === short(U(9))) && s1.chatsTotal === 3);
  check("chats: share of the 5-hour use, a chat with nothing in 5 hours has 0", Math.abs(cA.share5h + cB.share5h - 1) < 0.002 && cC.share5h === 0 && cC.weighted5h === 0);
  check("chats: live from the passed ids, a name and a valid chat id from the labels, a bad chat id dropped", cB.live === true && cA.live === false && cA.name === "Usage meter" && cA.chatId === "h-20261124-0101-abcd" && cB.chatId === undefined);
  check("source: fresh app history picked when claude gives no numbers, the estimate kept as an alternative", s1.limits.fiveHour.source === "app-history" && s1.limits.fiveHour.percent === 52 && s1.limits.fiveHour.ageMinutes === 6 && s1.limits.fiveHour.stale === false && s1.limits.fiveHour.alternatives.some((a) => a.source === "estimate"));
  check("live: 'not available' reported as a state with a sign-in note, no error", s1.live.state === "not-available" && s1.notes.some((n) => /signed out/.test(n)));
  check("levels and status: 52 ok, 41 ok, overall ok, never-above 95 reported", s1.limits.fiveHour.status === "ok" && s1.limits.weekly.status === "ok" && s1.overall === "ok" && s1.levels.neverAbove === 95 && s1.levels.source === "default");
  const text1 = JSON.stringify(s1);
  check("privacy: no org, no full session id, no request or message id, no message text, no app folder name", !text1.includes(ORG) && !text1.includes("org-") && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text1) && !/rA1|rB1|msg_only|SECRET|claude_abc123/.test(text1));

  // caching: within 60 s nothing new is probed or read; after "not available" no retry for 5 minutes
  const p0 = eng.stats().probes, b0 = eng.stats().bytesRead, sc0 = eng.stats().scans;
  clock = NOW0 + 30000; await eng.snapshot({});
  check("cache: a second look within 60 s neither runs claude nor reads chat files", eng.stats().probes === p0 && eng.stats().bytesRead === b0 && eng.stats().scans === sc0);
  clock = NOW0 + 4 * MIN; await eng.snapshot({});
  check("backoff: after 'not available' claude is not asked again for 5 minutes", eng.stats().probes === p0 && eng.stats().scans === sc0 + 1);
  check("scan: unchanged files are not read again (offsets and file times kept)", eng.stats().bytesRead === b0);
  appendFileSync(fileB, line({ t: NOW0 + 3 * MIN, req: "rB2", sid: B, f: 0, cw: 0, cr: 0, o: 100 }) + '{"type":"assistant","half written');
  const before = eng.stats().bytesRead;
  clock = NOW0 + 5 * MIN + 1000; const s2 = await eng.snapshot({});
  check("backoff over: claude is asked again after 5 minutes", eng.stats().probes === p0 + 1);
  check("scan: only the added bytes of the changed file are read, a half-written last line waits", eng.stats().bytesRead - before < 600 && s2.chats.find((c) => c.sessionId === short(B)).tokens.out === 20 + 7 + 100);
  clock = NOW0 + 6 * MIN + 2000;
  appendFileSync(fileB, ' line"}\n');
  check("scan: a finished half line that is not valid JSON is skipped without harm", (await eng.snapshot({})).chats.length === 3);

  // live answer: used for both limits, cached 60 s
  calls.length = 0; clock = NOW0;
  const engL = mk({ spawnFn: fakeSpawn("answer", ANSWER) });
  const sl = await engL.snapshot({ probe: true });
  check("live answer: source claude for both, percent and reset time, status warn (75.4) and stop (92), overall stop", sl.limits.fiveHour.source === "claude" && sl.limits.fiveHour.percent === 75.4 && sl.limits.fiveHour.resetsAt === RESET5 && sl.limits.fiveHour.status === "warn" && sl.limits.weekly.source === "claude" && sl.limits.weekly.status === "stop" && sl.overall === "stop" && sl.live.state === "ok" && sl.live.variants.length === 2);
  check("live answer: the history and the estimate stay as alternatives", ["app-history", "estimate"].every((s) => sl.limits.fiveHour.alternatives.some((a) => a.source === s)) && sl.limits.weekly.alternatives.length === 2);
  check("live answer: the weekly window now starts at claude's reset time minus 7 days", sl.total.week.basis === "reset-from-claude" || Date.parse(sl.total.week.from) >= Date.parse(RESETW) - WEEK);
  clock = NOW0 + 59000; await engL.snapshot({});
  check("live cache: claude is not run twice within 60 s", calls.length === 1);
  clock = NOW0 + 61000; await engL.snapshot({});
  check("live cache: asked again after 60 s", calls.length === 2);
  clock = NOW0 + 200000; await engL.snapshot({ probe: false });
  check("probe:false never runs claude", calls.length === 2);

  // time-out and garbage: back off 5 minutes, never an error
  let k2 = 0; clock = NOW0;
  const engT = mk({ spawnFn: fakeSpawn("hang"), killFn: (c) => { k2++; c.kill(); } });
  const st1 = await engT.snapshot({});
  check("time-out: the child is killed, state timeout, the page still gets numbers", k2 === 1 && st1.live.state === "timeout" && st1.limits.fiveHour.source === "app-history");
  clock = NOW0 + 2 * MIN; await engT.snapshot({});
  check("time-out: no retry within 5 minutes", engT.stats().probes === 1);
  const engG = mk({ spawnFn: fakeSpawn("garbage") });
  check("garbage output: state failed, no throw", (await engG.snapshot({})).live.state === "failed");

  // history old / missing / corrupt
  writeHist([S(NOW0 - 2 * 24 * HOUR, 0, 70), S(NOW0 - 2 * 24 * HOUR + 10 * MIN, 0, 3), S(NOW0 - 16 * HOUR, 0, 30)]);
  clock = NOW0; const so = await mk().snapshot({});
  check("old history (16 h): the estimate is picked, the old value kept as a stale alternative", so.limits.fiveHour.source === "estimate" && so.limits.fiveHour.basis === "last-5-hours" && so.limits.fiveHour.alternatives.some((a) => a.source === "app-history" && a.stale === true && a.ageMinutes === 960));
  check("old history: the weekly estimate starts from the app's value plus the tokens since", so.limits.weekly.source === "estimate" && so.limits.weekly.basis === "app-value-plus-since" && so.limits.weekly.percent >= 30);
  const expect5 = r1(so.total.fiveHour.weighted / so.calibration.fiveHour.tokensPerPercent);
  check("estimate: weighted 5-hour tokens divided by the calibration (default, marked not learned)", so.calibration.fiveHour.learned === false && so.calibration.fiveHour.tokensPerPercent === 155000 && Math.abs(so.limits.fiveHour.percent - expect5) <= 0.1);
  writeFileSync(histFile, "{corrupt");
  const sx = await mk().snapshot({});
  check("corrupt history: no throw, estimate used, note says it could not be read", sx.history.found === false && sx.history.problem === "corrupt" && sx.limits.fiveHour.source === "estimate" && sx.notes.some((n) => /could not be read/.test(n)));
  check("corrupt history: weekly estimate over the last 7 days", sx.total.week.basis === "last-7-days" && sx.limits.weekly.basis === "last-7-days");
  rmSync(histFile);
  const sm = await mk().snapshot({});
  check("missing history: estimate for both, history found false", sm.history.found === false && sm.history.problem === "missing" && sm.limits.weekly.source === "estimate");
  const sn = await makeUsage({ homeDir: join(tmp, "nobody"), appDataDir: join(tmp, "nothing"), now, spawnFn: fakeSpawn("na"), config: { hubDir, projectsRoot: busnus } }).snapshot({});
  check("nothing at all: source none, status unknown, overall unknown, no throw", sn.limits.fiveHour.source === "none" && sn.limits.fiveHour.percent === null && sn.limits.fiveHour.status === "unknown" && sn.overall === "unknown" && sn.chats.length === 0);

  // levels file: valid and invalid, read from the Hub folder's data/
  writeFileSync(join(hubDir, "data", "hub-usage-config.json"), JSON.stringify({ warnAt: 40, stopAt: 50 }));
  writeHist([S(NOW0 - 3 * MIN, 45, 55)]);
  const sv = await mk().snapshot({});
  check("levels file valid: 45 warn, 55 stop with warn 40 / stop 50", sv.levels.source === "config" && sv.limits.fiveHour.status === "warn" && sv.limits.weekly.status === "stop" && sv.overall === "stop");
  writeFileSync(join(hubDir, "data", "hub-usage-config.json"), JSON.stringify({ warnAt: 95, stopAt: 50 }));
  const si = await mk().snapshot({});
  check("levels file invalid: defaults used and a note says why", si.levels.source === "default" && si.levels.warnAt === 70 && typeof si.levels.problem === "string" && si.notes.includes(si.levels.problem));

  // calibration learned from the history and the chat files
  const calHome = join(tmp, "calhome"), calDir = join(calHome, ".claude", "projects", "C--x"); mkdirSync(calDir, { recursive: true });
  let body = ""; const c0 = NOW0 - 2 * 24 * HOUR;
  for (let i = 1; i <= 50; i++) body += line({ t: c0 + i * MIN, req: "c1-" + i, sid: U(5), cr: 1550000 });   // 50 x 155000 weighted over +50 %
  for (let i = 1; i <= 30; i++) body += line({ t: c0 + 6 * HOUR + i * MIN, req: "c2-" + i, sid: U(5), cr: 2500000 });   // 30 x 250000 weighted over +30 %
  writeFileSync(join(calDir, U(5) + ".jsonl"), body);
  writeHist([S(c0, 10, 20), S(c0 + 50 * MIN, 60, 21), S(c0 + 6 * HOUR, 0, 21), S(c0 + 6 * HOUR + 30 * MIN, 30, 22)]);
  const sc = await makeUsage({ homeDir: calHome, appDataDir: appData, now, spawnFn: fakeSpawn("na"), config: { hubDir, projectsRoot: busnus } }).snapshot({});
  check("calibration learned from the app's history: median of 155000 and 250000 weighted per percent", sc.calibration.fiveHour.learned === true && sc.calibration.fiveHour.stretches === 2 && sc.calibration.fiveHour.tokensPerPercent === 202500);

  // 40-chat cap
  const capHome = join(tmp, "caphome"), capDir = join(capHome, ".claude", "projects", "C--cap"); mkdirSync(capDir, { recursive: true });
  for (let i = 0; i < 45; i++) writeFileSync(join(capDir, U(100 + i) + ".jsonl"), line({ t: NOW0 - (i + 1) * MIN, req: "cap" + i, sid: U(100 + i), o: 1 }));
  const scap = await makeUsage({ homeDir: capHome, appDataDir: appData, now, spawnFn: fakeSpawn("na"), config: { hubDir, projectsRoot: busnus } }).snapshot({});
  check("at most 40 chats, newest first, the total count still says 45", scap.chats.length === 40 && scap.chatsTotal === 45 && scap.chats[0].sessionId === short(U(100)) && scap.chats[39].sessionId === short(U(139)));

  // demo sample
  const d = demoUsage(NOW0);
  check("demo sample: one warn at 74, one ok, app-history with an estimate alternative, a few chats, no ids", d.limits.fiveHour.percent === 74 && d.limits.fiveHour.status === "warn" && d.limits.weekly.status === "ok" && d.limits.fiveHour.source === "app-history" && d.limits.fiveHour.alternatives[0].source === "estimate" && d.chats.length >= 3 && !/org-|[0-9a-f]{8}-[0-9a-f]{4}-/.test(JSON.stringify(d)));
  check("demo sample: the same top-level keys as a real snapshot", JSON.stringify(Object.keys(d)) === JSON.stringify(Object.keys(s1)));

  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
  console.log(`\n${pass} passed, ${fail} failed`);

  // ---- ONE clearly-marked read-only real run (only with --real): the real claude get_usage question, the real history and chat files; counts only ----
  if (process.argv.includes("--real")) {
    console.log("\nREAL RUN (read-only): one get_usage question to claude, the app's history file, this PC's chat files. Counts only.");
    const t0 = Date.now();
    const realEng = makeUsage();
    const r = await realEng.snapshot({});
    const lim = (l) => `source ${l.source}, percent ${l.percent}, age ${l.ageMinutes} min, stale ${l.stale}, status ${l.status}${l.basis ? ", basis " + l.basis : ""}, alternatives ${l.alternatives.map((a) => a.source + " " + a.percent).join(" / ") || "none"}`;
    console.log(`live state: ${r.live.state}`);
    console.log(`5-hour: ${lim(r.limits.fiveHour)}`);
    console.log(`weekly: ${lim(r.limits.weekly)}`);
    console.log(`history: found ${r.history.found}, samples ${r.history.samples ?? 0}, age ${r.history.ageMinutes ?? "-"} min`);
    console.log(`calibration: 5h ${r.calibration.fiveHour.tokensPerPercent} (learned ${r.calibration.fiveHour.learned}, ${r.calibration.fiveHour.stretches} stretches), weekly ${r.calibration.weekly.tokensPerPercent} (learned ${r.calibration.weekly.learned}, ${r.calibration.weekly.stretches} stretches)`);
    console.log(`total 5h: ${r.total.fiveHour.replies} replies (helpers ${r.total.fiveHour.helpers.replies}), weighted ${r.total.fiveHour.weighted}; week (${r.total.week.basis}): ${r.total.week.replies} replies, weighted ${r.total.week.weighted}`);
    console.log(`chats listed ${r.chats.length} of ${r.chatsTotal}; files cached ${realEng.stats().cachedFiles}; MB read ${(realEng.stats().bytesRead / 1e6).toFixed(0)}; took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const t2 = Date.now(); await realEng.snapshot({}); console.log(`second look (cached): ${Date.now() - t2} ms, probes ${realEng.stats().probes}`);
    const txt = JSON.stringify(r);
    console.log(`privacy scan of the real JSON: full session ids ${(txt.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || []).length}, "org" keys ${(txt.match(/"org"/g) || []).length}, claude_ folder names ${(txt.match(/claude_[a-z0-9]{6,}/g) || []).length}`);
  }
}
