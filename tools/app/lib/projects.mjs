// Projects as a part of the Hub app (step 16.3, D53). No Electron import, so plain Node can test it with a fake dashboard.
// The app never stops a program itself: it asks the running dashboard, over the same guarded route the page uses
// (GET /api/session for the token, POST /api/action with the Hub Origin, JSON and confirm:true), to stop each project the
// dashboard started (runtime list: startedByHub true). The dashboard's own stop (taskkill in tools/dashboard/lib/control.mjs) does the work.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { hubOrigin } from "./rules.mjs";

export const STOP_LIMIT_MS = 20000; // the whole "stop the projects" part of a real quit, at most
const ID = /^[A-Za-z0-9_-]{1,64}$/;   // the same kind of id config/projects.json uses; anything else is never sent back

/** One plain line (no newlines, at most 200 characters) appended to the app log; a log that cannot be written never breaks anything. */
export function appendAppLog(file, text) {
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${new Date().toISOString()} ${String(text).replace(/[\r\n\t]+/g, " ").slice(0, 200)}\n`);
  } catch { /* logging must never block quitting */ }
}

const short = (e) => String(e?.cause?.code || e?.name || e?.message || e).replace(/[\r\n]+/g, " ").slice(0, 80);

/** GET a JSON route of the dashboard. Throws on anything but a 200 with JSON. */
async function getJson(fetchFn, url, ms) {
  const res = await fetchFn(url, { method: "GET", headers: { Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(Math.max(1, ms)) });
  if (res.status !== 200) { try { await res.body?.cancel?.(); } catch { /* nothing */ } throw new Error(`status ${res.status}`); }
  return res.json();
}

/** The dashboard's runtime list (GET /api/runtime -> { demo, items: [{ id, status, startedByHub, ... }] }). */
export async function readRuntime({ port, fetchFn = globalThis.fetch, timeoutMs = 3000 }) {
  const j = await getJson(fetchFn, `${hubOrigin(port)}/api/runtime`, timeoutMs);
  return Array.isArray(j?.items) ? j.items : [];
}

/** How many projects are running right now (status "running"), or null when the dashboard does not answer. Read-only. */
export async function countRunning({ port, fetchFn = globalThis.fetch, timeoutMs = 3000 }) {
  try { return (await readRuntime({ port, fetchFn, timeoutMs })).filter((i) => i && i.status === "running").length; } catch { return null; }
}

/**
 * What waits on Ivan right now: { decisions, chats } or null when the dashboard does not answer. Read-only.
 * decisions = the "decisions waiting" of every project card (GET /api/projects), chats = chats that need him (GET /api/needs-you).
 */
export async function countWaiting({ port, fetchFn = globalThis.fetch, timeoutMs = 3000 }) {
  try {
    const origin = hubOrigin(port);
    const [p, n] = await Promise.all([getJson(fetchFn, `${origin}/api/projects`, timeoutMs), getJson(fetchFn, `${origin}/api/needs-you`, timeoutMs)]);
    const decisions = (Array.isArray(p?.projects) ? p.projects : []).reduce((s, x) => s + (Number.isInteger(x?.decisionsWaiting) && x.decisionsWaiting > 0 ? x.decisionsWaiting : 0), 0);
    const chats = Array.isArray(n?.items) ? n.items.length : 0;
    return { decisions, chats };
  } catch { return null; }
}

/**
 * Stop every project the dashboard on PORT started (startedByHub true), one after the other, all within limitMs.
 * Never throws. log(text) gets one line per project (and one line when there is nothing to do or the dashboard is gone).
 * Returns { ok, reason, ids, stopped: [id], failed: [{ id, error }], timedOut }.
 *   reason: "" | "nothing-to-stop" | "dashboard-gone" | "no-token" | "time-limit"
 */
export async function stopHubProjects({ port, fetchFn = globalThis.fetch, limitMs = STOP_LIMIT_MS, log = () => {} }) {
  const origin = hubOrigin(port);
  const deadline = Date.now() + limitMs;
  const left = () => Math.max(1, deadline - Date.now());
  const out = { ok: true, reason: "", ids: [], stopped: [], failed: [], timedOut: false };
  const giveUp = (reason, text) => { out.ok = false; out.reason = reason; log(text); return out; };

  let items;
  try { items = await readRuntime({ port, fetchFn, timeoutMs: Math.min(left(), 5000) }); }
  catch (e) { return giveUp(Date.now() >= deadline ? "time-limit" : "dashboard-gone", `stop-projects skipped: the dashboard did not answer (${short(e)})`); }
  out.ids = items.filter((i) => i && i.startedByHub === true && typeof i.id === "string" && ID.test(i.id)).map((i) => i.id);
  if (!out.ids.length) { out.reason = "nothing-to-stop"; log("stop-projects: no project started by the Hub is running"); return out; }

  let token;
  try { token = (await getJson(fetchFn, `${origin}/api/session`, Math.min(left(), 5000)))?.token; } catch (e) { token = null; }
  if (typeof token !== "string" || !token) {
    for (const id of out.ids) { out.failed.push({ id, error: "no session token" }); log(`stop ${id} failed: the dashboard gave no session token`); }
    out.ok = false; out.reason = "no-token"; return out;
  }

  for (const id of out.ids) {
    if (Date.now() >= deadline) { out.timedOut = true; out.failed.push({ id, error: "time limit" }); log(`stop ${id} not tried: the time limit was reached`); continue; }
    try {
      const res = await fetchFn(`${origin}/api/action`, {
        method: "POST", redirect: "manual",
        headers: { "Content-Type": "application/json", Origin: origin, "X-Hub-Token": token },
        body: JSON.stringify({ action: "stop", id, confirm: true }),
        signal: AbortSignal.timeout(left()),
      });
      let j = null; try { j = await res.json(); } catch { /* not JSON */ }
      if (res.status === 200 && j && j.ok === true) { out.stopped.push(id); log(`stop ${id} ok`); }
      else { const error = String(j?.error || `answer ${res.status}`).slice(0, 120); out.failed.push({ id, error }); log(`stop ${id} failed: ${error}`); }
    } catch (e) {
      const late = Date.now() >= deadline || e?.name === "TimeoutError";
      if (late) out.timedOut = true;
      out.failed.push({ id, error: late ? "time limit" : short(e) });
      log(`stop ${id} failed: ${late ? "the time limit was reached" : short(e)}`);
    }
  }
  if (out.failed.length) out.ok = false;
  if (out.timedOut) out.reason = "time-limit";
  return out;
}

/** Resolves with the promise's value, or with `fallback` after ms (the promise is then left to finish on its own). */
function within(promise, ms, fallback) {
  let timer;
  const limit = new Promise((r) => { timer = setTimeout(() => r(fallback), ms); });
  return Promise.race([Promise.resolve(promise).catch((e) => ({ ok: false, reason: "error", error: short(e) })), limit]).finally(() => clearTimeout(timer));
}
const LATE = Symbol("late");

/**
 * The whole real-quit order (D53): first the projects the dashboard started (attached or own dashboard alike), then the
 * dashboard itself ONLY if this app started it. Each part is bounded on its own (a stuck project stop never keeps the
 * app's own dashboard running), so the whole takes at most projectsMs + serverMs.
 * Resolves { projects, serverStopped, timedOut }.
 */
export async function quitSequence({ server, stopProjects, stopServer, projectsMs = STOP_LIMIT_MS + 2000, serverMs = 8000 }) {
  const result = { projects: null, serverStopped: null, timedOut: false };
  if (server && server.ok) {
    const p = await within(Promise.resolve().then(() => stopProjects()), projectsMs, LATE);
    if (p === LATE) { result.timedOut = true; result.projects = { ok: false, reason: "time-limit" }; } else result.projects = p;
  }
  if (server && server.ownsServer) {
    const s = await within(Promise.resolve().then(() => stopServer()), serverMs, LATE);
    if (s === LATE) { result.timedOut = true; result.serverStopped = false; } else result.serverStopped = s === true;
  }
  return result;
}
