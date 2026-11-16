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
import { loadGamesConfig, makeGameDetector, makeIgnoreStore, normName, startProbe } from "./lib/game.mjs";
import { loadThrottleConfig, makeThrottle } from "./lib/throttle.mjs";
import { makePauses } from "./lib/pauses.mjs";
import { appendFileSync, mkdirSync } from "node:fs";
const real = DEMO ? null : await import("./lib/data.mjs");
const control = DEMO ? null : (await import("./lib/control.mjs")).makeControl();
// Hub chats (Phase 14): windowless Claude chats the Hub starts itself (lib/chats.mjs), and the live list of every chat (lib/chatlist.mjs)
const chats = DEMO ? null : (await import("./lib/chats.mjs")).makeChats({ redact: real.redact });
const chatlist = DEMO ? null : await import("./lib/chatlist.mjs");
const chatSample = DEMO ? JSON.parse(readFileSync(join(HERE, "demo", "chats.json"), "utf8")) : null;
const sample = DEMO ? JSON.parse(readFileSync(join(HERE, "demo", "sample.json"), "utf8")) : null;
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const demoProjects = () => ({ generatedAt: new Date().toISOString(), demo: true, projects: sample.projects });
// Helpers screen (Phase 15): per project the manager chats and their helper tasks. Read-only; real data from the helper records, sample data from demo/helpers.json
const helpersLib = DEMO ? null : await import("./lib/helpers.mjs");
const helperSample = DEMO ? JSON.parse(readFileSync(join(HERE, "demo", "helpers.json"), "utf8")) : null;
const demoHelpers = () => (args.includes("--demo-helpers=empty") ? { generatedAt: new Date().toISOString(), demo: true, totals: { running: 0, stuck: 0, review: 0, parked: 0, failed: 0, done: 0 }, projects: [] } : {
  generatedAt: new Date().toISOString(), demo: true, totals: helperSample.totals,
  projects: helperSample.projects.map((p) => ({ ...p, managers: p.managers.map(({ lastActiveAgoMinutes, tasks, ...m }) => ({
    ...m, lastActive: lastActiveAgoMinutes == null ? null : ago(lastActiveAgoMinutes),
    tasks: tasks.map(({ sinceAgoMinutes, finishedAgoMinutes, ...t }) => ({ ...t, since: ago(sinceAgoMinutes), finishedAt: finishedAgoMinutes == null ? null : ago(finishedAgoMinutes) })),
  })) })),
});

// a fresh secret per run: only the page this server serves can read it (no CORS headers are ever sent), so other websites cannot use the POST route
const gameCfg = DEMO ? null : loadGamesConfig();
const gameIgnore = DEMO ? null : makeIgnoreStore({ path: join(HERE, "..", "..", "data", "game_ignore.json"), cfg: gameCfg });   // apps Ivan told the page to ignore
const gameDetector = DEMO ? null : makeGameDetector({ cfg: gameCfg });   // game mode (Phase 13): is Ivan in a game right now?
let lastGameSample = null;
// game mode: when a game starts, slow down what the Hub started; when it ends (or the server finds a finished game), put everything back
const throttleCfg = DEMO ? null : loadThrottleConfig();
const gameLog = (action, id, result) => { try { mkdirSync(join(HERE, "..", "..", "logs"), { recursive: true }); appendFileSync(join(HERE, "..", "..", "logs", "hub_actions.log"), `${new Date().toISOString()} ${action} ${id} ${result}\n`); } catch { /* logging never breaks game mode */ } };
const dataFile = (n) => join(HERE, "..", "..", "data", n);
const throttle = DEMO ? null : makeThrottle({
  hubPids: () => ({ ...control.startedPids(), ...chats.workingPids() }), statePath: dataFile("game_state.json"),   // Hub chats that are working count as Hub programs cfg: throttleCfg, log: gameLog,
  // programs the Hub started AND Ivan flagged in config/projects.json with "usesGpu": true get frozen, not only slowed (step 13.3)
  gpuPids: () => Object.fromEntries(Object.entries(control.startedPids()).filter(([id]) => control.config().find((p) => p.id === id)?.usesGpu === true)),
});
// D37: the only two things outside the Hub that game mode pauses (names in config/throttle.json): the openshorts container, Ollama's loaded models
const pauses = DEMO ? null : makePauses({ cfg: throttleCfg.pauses, statePath: dataFile("game_pauses.json"), log: gameLog });
// engage / tick / release never overlap each other (a game that flickers on and off must not un-pause in the middle of pausing)
let gameChain = Promise.resolve();
const gameJob = (fn) => { gameChain = gameChain.then(fn).catch((e) => gameLog("game-mode", "error", String(e && e.message || e).slice(0, 160))); return gameChain; };
let gameSamples = 0;
function onGameSample(s) {
  lastGameSample = { at: s.at, fg: s.fg, full: s.full, gpu: s.gpu };
  const before = gameDetector.state().on; const after = gameDetector.update(s);
  gameSamples++;
  if (!before && after.on) gameJob(async () => { await throttle.engage(); await pauses.engage(); });
  else if (before && !after.on) gameJob(async () => { await pauses.release(); await throttle.release(); });
  if (gameSamples === 3) gameJob(async () => { await pauses.recover(after.on); await throttle.recover(after.on); }); // a game that was on when the server stopped: decided once the state is stable (3 samples)
}
const meter = makeBusyMeter();          // processor use of the programs the Hub started (only measured while there are any)
const doneTracker = makeDoneTracker();  // "everything is done" (D28: only tells, never shuts down)
const TOKEN = randomBytes(24).toString("hex");
let allowedOrigins = [];

// sample chats: the file holds minutes-ago numbers, the answer gets real times (`--demo-chats=empty` shows the empty state)
const demoChats = () => {
  const projects = args.includes("--demo-chats=empty") ? [] : chatSample.projects.map((p) => ({ ...p, chats: p.chats.map(({ sinceAgoMinutes, lastActiveAgoMinutes, ...c }) => ({ ...c, since: ago(sinceAgoMinutes), lastActive: ago(lastActiveAgoMinutes) })) }));
  return { generatedAt: new Date().toISOString(), demo: true, max: 2, working: projects.flatMap((p) => p.chats).filter((c) => c.kind === "hub" && c.state === "working").length, openListOk: true, projects };
};

const api = {
  "/api/chats": () => (DEMO ? demoChats() : chatlist.readChats({ hubChats: chats.list(), redact: real.redact })),
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
  "/api/game": () => (DEMO ? (sample.gameStates?.[(args.find((a) => a.startsWith("--demo-game=")) || "").slice(12)] || sample.game || { on: false, reason: "No game", game: null, since: null, notes: [], ignored: [] }) : { ...gameDetector.state(), watching: gameCfg.games.filter((g) => g.exe.length).map((g) => g.name), lastSample: lastGameSample, slowdown: throttle.status(), pauses: pauses.status(), ignored: gameIgnore.list() }),
  "/api/needs-you": () => (DEMO ? { generatedAt: new Date().toISOString(), items: sample.needsYou.map((x) => ({ ...x, since: ago(x.agoMinutes) })) } : real.needsYou()),
  "/api/helpers": () => (DEMO ? demoHelpers() : helpersLib.readHelpers()),
  "/api/manager": () => (DEMO ? sample.manager : real.manager()),
  "/api/runtime": () => (DEMO ? { demo: true, items: sample.runtime } : control.runtime().then((items) => ({ demo: false, items }))),
  "/api/session": () => ({ token: TOKEN, demo: DEMO }),
};

const hostOk = (h) => /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(h || ""); // blocks DNS-rebinding tricks
const ACTIONS = ["start", "stop", "open-claude", "autostart", "game-off", "game-on", "game-ignore", "game-unignore", "chat-start", "chat-answer", "chat-stop", "chat-app-link"];
const err = (m) => JSON.stringify({ ok: false, error: m });

// Game mode buttons (step 13.4). No names come from the page except the app to ignore, and that must be the app the Hub itself is showing.
async function gameAction(body) {
  const st = gameDetector.state();
  const release = () => gameJob(async () => { await pauses.release(); await throttle.release(); });
  if (body.action === "game-off") {
    if (!st.on) return { ok: false, error: "Game mode is not on right now." };
    gameDetector.suppress(); await release();
    gameLog("game-mode", "off-for-now", `turned off by Ivan while ${st.game} runs`);
    return { ok: true, message: "Game mode is off for now. Everything is back to normal; it switches on again with your next game." };
  }
  if (body.action === "game-on") {
    if (!st.overridden) return { ok: false, error: "Game mode was not turned off by you." };
    gameDetector.unsuppress();
    gameLog("game-mode", "back-on", "turned back on by Ivan");
    return { ok: true, message: "Game mode is back on. It switches on at the next check (about 10 seconds) if a game is running." };
  }
  if (body.action === "game-ignore") {
    if (!st.on || !st.app || st.app !== normName(body.app)) return { ok: false, error: "The game changed. Look at the page again." };
    if (!gameIgnore.add(st.app)) return { ok: false, error: "That app name can not be ignored." };
    gameDetector.forceOff(); await release();
    gameLog("game-mode", "ignore", st.app);
    return { ok: true, message: `${st.game} is ignored from now on. Everything is back to normal.` };
  }
  // game-unignore
  if (!gameIgnore.remove(String(body.app || ""))) return { ok: false, error: "That app is not on your ignore list." };
  gameLog("game-mode", "unignore", String(body.app));
  return { ok: true, message: "Not ignored any more." };
}

// Chat buttons (Phase 14). Nothing but plain values comes from the page: the project is checked against the real folders, the chat id is the
// Hub's own id (never a Claude session id), the permission mode is fixed inside the engine, and every refusal is logged there.
async function chatAction(body) {
  if (body.action === "chat-start") return chats.start({ project: body.project, task: body.task, model: body.model, remoteControl: body.remoteControl === true });
  if (body.action === "chat-answer") return chats.answer({ id: body.id, text: body.text });
  if (body.action === "chat-stop") return chats.stop({ id: body.id });
  return chats.appLink({ project: body.project, task: body.task }); // chat-app-link: only builds the link; the page opens it and Ivan presses Send in the app
}

async function handleAction(req, send) {
  const h = req.headers;
  if (!String(h["content-type"] || "").toLowerCase().startsWith("application/json")) return send(415, err("JSON only"));
  if (!allowedOrigins.includes(h.origin)) return send(403, err("forbidden origin"));
  if (h["sec-fetch-site"] && h["sec-fetch-site"] !== "same-origin") return send(403, err("forbidden origin"));
  const got = Buffer.from(String(h["x-hub-token"] || "")); const want = Buffer.from(TOKEN);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return send(403, err("missing or wrong token"));
  let raw = ""; for await (const chunk of req) { raw += chunk; if (raw.length > 14000) return send(413, err("too big")); }   // chat tasks and answers may be long; every other action stays under 2000 (checked below)
  let body; try { body = JSON.parse(raw); } catch { return send(400, err("not JSON")); }
  if (!body || body.confirm !== true) return send(400, err("confirmation missing"));
  if (!ACTIONS.includes(body.action)) return send(400, err("unknown action"));
  if (raw.length > 2000 && !body.action.startsWith("chat-")) return send(413, err("too big"));
  if (DEMO) return send(200, err("Sample data mode: the buttons are switched off."));
  let result;
  if (body.action.startsWith("game-")) result = await gameAction(body);
  else if (body.action.startsWith("chat-")) result = await chatAction(body);
  else if (body.action === "start") result = await control.start(String(body.id));
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
    if (!DEMO) startProbe({ cfg: gameCfg, onSample: onGameSample });
    if (!DEMO) setInterval(() => { if (gameDetector.state().on) gameJob(async () => { await throttle.tick(); await pauses.tick(); }); }, throttleCfg.reapplySeconds * 1000).unref();
    if (args.includes("--boot") && control) setTimeout(() => control.bootStart().catch(() => {}), 20000);
    console.log("Ready.");
    return;
  }
  const base = `http://${HOST}:${port}`;
  const ok = (name, cond) => { console.log(`${cond ? "OK  " : "FAIL"} ${name}`); if (!cond) process.exitCode = 1; };
  const r1 = await fetch(base + "/api/projects"); const j = await r1.json();
  ok("GET /api/projects returns projects", r1.status === 200 && Array.isArray(j.projects) && j.projects.length > 0);
  ok("GET / serves the page", (await fetch(base + "/")).status === 200);
  const rh = await fetch(base + "/api/helpers"); const jh = await rh.json();
  ok("GET /api/helpers returns totals and projects", rh.status === 200 && Array.isArray(jh.projects) && ["running", "stuck", "review", "parked", "failed", "done"].every((k) => Number.isFinite(jh.totals?.[k])));
  ok("POST to /api/helpers is refused", (await fetch(base + "/api/helpers", { method: "POST" })).status === 405);
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
  // Hub chat buttons (Phase 14): every one needs the token; none of these tests may start a real chat (bad project, empty task or no such chat)
  const cj = (o) => JSON.stringify({ confirm: true, ...o });
  const refused = async (o, h = json) => { const r = await raw("/api/action", h, cj(o), "POST"); return r.status === 200 && JSON.parse(r.text).ok === false; };
  ok("chat-start without the token is refused", (await raw("/api/action", { ...json, "X-Hub-Token": "" }, cj({ action: "chat-start", project: "Hub", task: "x" }), "POST")).status === 403);
  ok("chat-answer and chat-stop without the token are refused", (await raw("/api/action", { ...json, "X-Hub-Token": "" }, cj({ action: "chat-answer", id: "h-20260101-000000-abcd", text: "x" }), "POST")).status === 403 && (await raw("/api/action", { ...json, "X-Hub-Token": "" }, cj({ action: "chat-stop", id: "h-20260101-000000-abcd" }), "POST")).status === 403);
  ok("chat-start refuses an unknown project and a path", await refused({ action: "chat-start", project: "NoSuchProject", task: "x" }) && await refused({ action: "chat-start", project: "..\\Windows", task: "x" }) && await refused({ action: "chat-start", project: "../..", task: "x" }));
  ok("chat-start refuses an empty task, an unknown model and Remote Control", await refused({ action: "chat-start", project: "Hub", task: "  " }) && await refused({ action: "chat-start", project: "Hub", task: "x", model: "gpt-4" }) && await refused({ action: "chat-start", project: "Hub", task: "x", remoteControl: true }));
  ok("chat-answer and chat-stop refuse an unknown chat and a Claude session id", await refused({ action: "chat-answer", id: "h-20260101-000000-abcd", text: "x" }) && await refused({ action: "chat-answer", id: "18ec7052-3a6a-46cc-ade3-7ff857195e3d", text: "x" }) && await refused({ action: "chat-stop", id: "h-20260101-000000-abcd" }));
  ok("a long chat task is not cut off as 'too big' but still refused for its project", await refused({ action: "chat-start", project: "NoSuchProject", task: "x".repeat(3000) }));
  ok("a long body on any other action is still 413", (await raw("/api/action", json, JSON.stringify({ action: "stop", id: "x", pad: "y".repeat(3000), confirm: true }), "POST")).status === 413);
  const lnk = await raw("/api/action", json, cj({ action: "chat-app-link", project: "Hub", task: "Hello there" }), "POST"); const lj = JSON.parse(lnk.text);
  ok("chat-app-link builds the app's new-chat link for a real project only", lnk.status === 200 && lj.ok === true && lj.link.startsWith("claude://code/new?q=Hello%20there&folder=") && await refused({ action: "chat-app-link", project: "NoSuchProject", task: "x" }));
  const rc = await fetch(base + "/api/chats"); const jc = await rc.json();
  ok("GET /api/chats returns the list shape", rc.status === 200 && Array.isArray(jc.projects) && Number.isFinite(jc.max) && typeof jc.openListOk === "boolean");
  // game-mode buttons (13.4): with no game running every one of them is refused, and none can be reached without the token
  for (const a of [{ action: "game-off" }, { action: "game-on" }, { action: "game-ignore", app: "opera" }, { action: "game-unignore", app: "opera" }]) {
    const r = await raw("/api/action", json, JSON.stringify({ ...a, confirm: true }), "POST");
    ok(`${a.action} with no game running is refused without changing anything`, r.status === 200 && JSON.parse(r.text).ok === false);
  }
  ok("game-off without the token is refused", (await raw("/api/action", { ...json, "X-Hub-Token": "" }, JSON.stringify({ action: "game-off", confirm: true }), "POST")).status === 403);
  const bad = await raw("/api/action", json, JSON.stringify({ action: "open-claude", name: "..\\..\\Windows", confirm: true }), "POST");
  ok("open-claude outside the projects folder refused", bad.status === 200 && JSON.parse(bad.text).ok === false);
  const big = await raw("/api/action", json, JSON.stringify({ action: "start", id: "x".repeat(5000), confirm: true }), "POST");
  ok("oversized body refused", big.status === 413 || big.status === 0);
  server.close();
});
