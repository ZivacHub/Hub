// Hub dashboard server. Plain Node, no dependencies, this PC only. GET shows things; the one POST route (/api/action) can only
// start or stop the programs listed in config/projects.json, open Claude Code in a project folder, or flip a start-up switch.
//   node tools/dashboard/server.mjs             real data from this PC's projects  -> http://127.0.0.1:4780
//   node tools/dashboard/server.mjs --demo      made-up sample data (for screenshots, safe to show to anyone; buttons off)
//   node tools/dashboard/server.mjs --open      also open the browser once the page is ready
//   node tools/dashboard/server.mjs --boot      PC start-up mode: start the programs Ivan ticked "start with PC"
//   node tools/dashboard/server.mjs --selftest  start on a spare port and check the safety rules
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "public");
const args = process.argv.slice(2);
const DEMO = args.includes("--demo");
const SELFTEST = args.includes("--selftest");
const PORT = SELFTEST ? 0 : Number(process.env.HUB_PORT || 4780);
const HOST = "127.0.0.1"; // never 0.0.0.0: nothing outside this PC can reach the page (D8)

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };
const HEADERS = {
  "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store",
};

import { buildRunning, workCount } from "./lib/running.mjs";
import { makeBusyMeter } from "./lib/cpu.mjs";
import { makeDoneTracker } from "./lib/done.mjs";
const real = DEMO ? null : await import("./lib/data.mjs");
const control = DEMO ? null : (await import("./lib/control.mjs")).makeControl();
const sample = DEMO ? JSON.parse(readFileSync(join(HERE, "demo", "sample.json"), "utf8")) : null;
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const demoProjects = () => ({ generatedAt: new Date().toISOString(), demo: true, projects: sample.projects });

// a fresh secret per run: only the page this server serves can read it (no CORS headers are ever sent), so other websites cannot use the POST route
const meter = makeBusyMeter();          // processor use of the programs the Hub started (only measured while there are any)
const doneTracker = makeDoneTracker();  // "everything is done" (D28: only tells, never shuts down)
const TOKEN = randomBytes(24).toString("hex");
let allowedOrigins = [];

const api = {
  "/api/projects": () => (DEMO ? demoProjects() : real.projects()),
  "/api/decisions": () => (DEMO ? { generatedAt: new Date().toISOString(), decisions: sample.decisions } : real.decisions()),
  "/api/answers": () => (DEMO ? { generatedAt: new Date().toISOString(), answers: sample.answers.map((a) => ({ ...a, at: ago(a.agoMinutes) })) } : real.answers()),
  "/api/running": async () => {
    if (DEMO) return { generatedAt: new Date().toISOString(), items: sample.running.map((x) => ({ ...x, since: x.agoMinutes === undefined ? null : ago(x.agoMinutes) })), done: sample.done || { allDone: false, finishedAt: null } };
    const [runtime, manager] = await Promise.all([control.runtime(), real.manager()]);
    const pids = control.startedPids();
    const byPid = await meter.read(Object.values(pids));
    const busy = Object.fromEntries(Object.entries(pids).map(([id, pid]) => [id, byPid[pid] ?? null]));
    const items = buildRunning({ runtime, chats: real.workingChats(), manager, busy });
    return { generatedAt: new Date().toISOString(), items, done: doneTracker.update(workCount(items)) };
  },
  "/api/needs-you": () => (DEMO ? { generatedAt: new Date().toISOString(), items: sample.needsYou.map((x) => ({ ...x, since: ago(x.agoMinutes) })) } : real.needsYou()),
  "/api/manager": () => (DEMO ? sample.manager : real.manager()),
  "/api/runtime": () => (DEMO ? { demo: true, items: sample.runtime } : control.runtime().then((items) => ({ demo: false, items }))),
  "/api/session": () => ({ token: TOKEN, demo: DEMO }),
};

const hostOk = (h) => /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(h || ""); // blocks DNS-rebinding tricks
const ACTIONS = ["start", "stop", "open-claude", "autostart"];
const err = (m) => JSON.stringify({ ok: false, error: m });

async function handleAction(req, send) {
  const h = req.headers;
  if (!String(h["content-type"] || "").toLowerCase().startsWith("application/json")) return send(415, err("JSON only"));
  if (!allowedOrigins.includes(h.origin)) return send(403, err("forbidden origin"));
  if (h["sec-fetch-site"] && h["sec-fetch-site"] !== "same-origin") return send(403, err("forbidden origin"));
  const got = Buffer.from(String(h["x-hub-token"] || "")); const want = Buffer.from(TOKEN);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return send(403, err("missing or wrong token"));
  let raw = ""; for await (const chunk of req) { raw += chunk; if (raw.length > 2000) return send(413, err("too big")); }
  let body; try { body = JSON.parse(raw); } catch { return send(400, err("not JSON")); }
  if (!body || body.confirm !== true) return send(400, err("confirmation missing"));
  if (!ACTIONS.includes(body.action)) return send(400, err("unknown action"));
  if (DEMO) return send(200, err("Sample data mode: the buttons are switched off."));
  let result;
  if (body.action === "start") result = await control.start(String(body.id));
  else if (body.action === "stop") result = await control.stop(String(body.id));
  else if (body.action === "autostart") result = control.setAutostart(String(body.id), body.value === true);
  else result = control.openClaude(body.name);
  send(200, JSON.stringify(result));
}

const server = createServer(async (req, res) => {
  const send = (code, body, type = "application/json") => { res.writeHead(code, { "Content-Type": type, ...HEADERS }); res.end(body); };
  try {
    if (!hostOk(req.headers.host)) return send(403, '{"error":"forbidden"}');
    const path = new URL(req.url, "http://x").pathname;
    if (req.method === "POST" && path === "/api/action") return await handleAction(req, send);
    if (req.method !== "GET" && req.method !== "HEAD") return send(405, '{"error":"method not allowed"}');
    if (api[path]) return send(200, JSON.stringify(await api[path]()));
    const rel = path === "/" ? "index.html" : normalize(decodeURIComponent(path)).replace(/^[/\\]+/, "");
    const file = join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + sep) || !existsSync(file) || !statSync(file).isFile()) return send(404, '{"error":"not found"}');
    send(200, readFileSync(file), TYPES[extname(file)] || "application/octet-stream");
  } catch (e) {
    send(500, '{"error":"could not read the project files"}');
  }
});

server.on("error", (e) => {
  console.error(e.code === "EADDRINUSE" ? `Port ${PORT} is already in use. The dashboard may already be running: open http://${HOST}:${PORT}` : `Could not start: ${e.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, async () => {
  const port = server.address().port;
  allowedOrigins = [`http://${HOST}:${port}`, `http://localhost:${port}`];
  if (!SELFTEST) {
    console.log(`Hub dashboard${DEMO ? " (sample data)" : ""}: http://${HOST}:${port}`);
    // read every project once now so the first page load is quick, then (with --open) open the browser: it never opens to a dead page
    try { if (!DEMO) { console.log("Reading your projects..."); await Promise.all([real.projects(), real.decisions(), real.answers(), real.manager()]); } } catch { /* the page shows its own error */ }
    if (args.includes("--open") && process.platform === "win32") spawn("cmd", ["/c", "start", "", `http://${HOST}:${port}`], { stdio: "ignore", detached: true }).unref();
    if (args.includes("--boot") && control) setTimeout(() => control.bootStart().catch(() => {}), 20000);
    console.log("Ready.");
    return;
  }
  const base = `http://${HOST}:${port}`;
  const ok = (name, cond) => { console.log(`${cond ? "OK  " : "FAIL"} ${name}`); if (!cond) process.exitCode = 1; };
  const r1 = await fetch(base + "/api/projects"); const j = await r1.json();
  ok("GET /api/projects returns projects", r1.status === 200 && Array.isArray(j.projects) && j.projects.length > 0);
  ok("GET / serves the page", (await fetch(base + "/")).status === 200);
  ok("PUT is refused", (await fetch(base + "/api/projects", { method: "PUT" })).status === 405);
  ok("POST to a data route is refused", (await fetch(base + "/api/projects", { method: "POST" })).status === 405);
  ok("path tricks refused", (await fetch(base + "/..%2f..%2fserver.mjs")).status === 404);
  const { request } = await import("node:http");
  const raw = (path, headers, body = "", method = "GET") => new Promise((resolve) => {
    const r = request({ host: HOST, port, path, method, headers: { Host: `${HOST}:${port}`, ...headers } }, (res) => { let t = ""; res.on("data", (d) => (t += d)); res.on("end", () => resolve({ status: res.statusCode, text: t })); });
    r.on("error", () => resolve({ status: 0, text: "" })); r.end(body);
  });
  ok("foreign Host header refused", (await raw("/api/projects", { Host: "evil.example" })).status === 403);
  const tok = (await (await fetch(base + "/api/session")).json()).token;
  const json = { "Content-Type": "application/json", Origin: base, "X-Hub-Token": tok };
  const act = JSON.stringify({ action: "start", id: "does-not-exist", confirm: true });
  ok("action without token refused", (await raw("/api/action", { ...json, "X-Hub-Token": "" }, act, "POST")).status === 403);
  ok("action with wrong token refused", (await raw("/api/action", { ...json, "X-Hub-Token": "x".repeat(tok.length) }, act, "POST")).status === 403);
  ok("action from another website refused", (await raw("/api/action", { ...json, Origin: "http://evil.example" }, act, "POST")).status === 403);
  ok("action with no Origin refused", (await raw("/api/action", { "Content-Type": "application/json", "X-Hub-Token": tok }, act, "POST")).status === 403);
  ok("action without JSON type refused", (await raw("/api/action", { ...json, "Content-Type": "text/plain" }, act, "POST")).status === 415);
  ok("action without confirm refused", (await raw("/api/action", json, JSON.stringify({ action: "start", id: "x" }), "POST")).status === 400);
  ok("unlisted action refused", (await raw("/api/action", json, JSON.stringify({ action: "run", cmd: "calc", confirm: true }), "POST")).status === 400);
  const unk = await raw("/api/action", json, act, "POST");
  ok("unlisted project id refused (not started)", unk.status === 200 && JSON.parse(unk.text).ok === false);
  const bad = await raw("/api/action", json, JSON.stringify({ action: "open-claude", name: "..\\..\\Windows", confirm: true }), "POST");
  ok("open-claude outside the projects folder refused", bad.status === 200 && JSON.parse(bad.text).ok === false);
  const big = await raw("/api/action", json, JSON.stringify({ action: "start", id: "x".repeat(5000), confirm: true }), "POST");
  ok("oversized body refused", big.status === 413 || big.status === 0);
  server.close();
});
