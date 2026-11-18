// Find the running Hub dashboard, or start it. No Electron import: spawn, fetch and timing are injectable so the
// self-test can prove the "attach" case starts nothing and the "Node missing" case gives a plain message.
import { spawn as realSpawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync } from "node:fs";
import { join } from "node:path";
import { hubUrl } from "./rules.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** true when GET http://127.0.0.1:PORT/ answers 200 within timeoutMs. Never throws. */
export async function pageAnswers(port, { fetchFn = globalThis.fetch, timeoutMs = 2000 } = {}) {
  try {
    const res = await fetchFn(hubUrl(port), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    try { await res.body?.cancel?.(); } catch { /* nothing to drain */ }
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Attach to the dashboard if it already answers, otherwise start `node tools/dashboard/server.mjs <serverArgs>` and wait for it.
 * Returns one of:
 *   { ok: true,  ownsServer: false, child: null, url }                    the dashboard was already running (the normal case)
 *   { ok: true,  ownsServer: true,  child: <ChildProcess>, pid, url }     the app started it; the app must stop it on quit (stopServer)
 *   { ok: false, reason: "node-missing" | "no-server-file" | "exited" | "timeout" | "spawn-failed", message }   message = plain words for a dialog
 */
export async function findOrStartServer({
  port, hubDir, serverArgs = [], logFile = null,
  spawnFn = realSpawn, fetchFn = globalThis.fetch,
  checkTimeoutMs = 2000, pollMs = 250, waitMs = 30000,
}) {
  const url = hubUrl(port);
  if (await pageAnswers(port, { fetchFn, timeoutMs: checkTimeoutMs })) return { ok: true, ownsServer: false, child: null, url };

  const serverFile = join(hubDir, "tools", "dashboard", "server.mjs");
  if (!existsSync(serverFile)) return { ok: false, reason: "no-server-file", message: "The Hub could not find its dashboard (tools\\dashboard\\server.mjs). Keep the app inside the Hub folder." };

  let out = "ignore";
  if (logFile) {
    try { mkdirSync(join(logFile, ".."), { recursive: true }); out = openSync(logFile, "a"); } catch { out = "ignore"; }
  }
  let child;
  try {
    child = spawnFn("node", [serverFile, ...serverArgs], {
      cwd: hubDir, shell: false, windowsHide: true, stdio: ["ignore", out, out],
      env: { ...process.env, HUB_PORT: String(port) },
    });
  } catch (e) {
    if (typeof out === "number") closeSync(out);
    return e?.code === "ENOENT" ? nodeMissing() : { ok: false, reason: "spawn-failed", message: "The Hub could not start its dashboard." };
  }
  if (typeof out === "number") { try { closeSync(out); } catch { /* the child keeps its own copy */ } }

  let failure = null;
  child.once("error", (e) => { failure = e?.code === "ENOENT" ? nodeMissing() : { ok: false, reason: "spawn-failed", message: "The Hub could not start its dashboard." }; });
  child.once("exit", () => { if (!failure) failure = { ok: false, reason: "exited", message: "The Hub dashboard stopped right after starting. The details are in logs\\hub_app_server.log in the Hub folder." }; });

  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    if (failure) return failure;
    if (await pageAnswers(port, { fetchFn, timeoutMs: Math.min(checkTimeoutMs, 1000) })) return { ok: true, ownsServer: true, child, pid: child.pid, url };
    await sleep(pollMs);
  }
  if (failure) return failure;
  await stopServer(child);
  return { ok: false, reason: "timeout", message: "The Hub dashboard did not start within 30 seconds. The details are in logs\\hub_app_server.log in the Hub folder." };
}

const nodeMissing = () => ({ ok: false, reason: "node-missing", message: "Node.js was not found on this PC, so the Hub cannot start." });

/** Stop a dashboard process the app started itself (child.kill only; its own child processes are step 16.3's business). Resolves when it has exited or after waitMs. */
export function stopServer(child, { waitMs = 5000 } = {}) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve(true);
    const t = setTimeout(() => resolve(false), waitMs);
    child.once("exit", () => { clearTimeout(t); resolve(true); });
    try { child.kill(); } catch { clearTimeout(t); resolve(false); }
  });
}
