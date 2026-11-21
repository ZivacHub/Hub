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
import { makeAppAnswer } from "./lib/appanswer.mjs";
import { makeHandoffRound } from "./lib/handoffround.mjs";
import { makePins, MAX_PINS } from "./lib/pins.mjs";
import { readChatImage } from "./lib/chatimage.mjs";
import { deflateSync } from "node:zlib";
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
  // Hub chats that are working count as Hub programs (Phase 14), so game mode slows them like the rest
  hubPids: () => ({ ...control.startedPids(), ...chats.workingPids() }), statePath: dataFile("game_state.json"), cfg: throttleCfg, log: gameLog,
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

// Project page (Phase 17.4, read only): GET /api/project?name=<project name>. The name is only compared with the known project names;
// it never becomes part of a file path. Unknown name -> 404.
const projectPageLib = await import("./lib/projectpage.mjs");
const projectPageSample = DEMO ? JSON.parse(readFileSync(join(HERE, "demo", "project-page.json"), "utf8")) : null;
async function projectApiRaw(rawName) {
  const notFound = { status: 404, body: { error: "unknown project" } };
  if (DEMO) {
    const known = sample.projects.map((p) => p.name);
    const name = projectPageLib.resolveName(rawName, known);
    if (!name) return notFound;
    const group = demoChats().projects.find((p) => p.project === name);
    return { status: 200, body: projectPageLib.demoPage({ card: sample.projects.find((p) => p.name === name), chatGroup: group, demoJson: projectPageSample }) };
  }
  const cards = real.projects().projects;
  const name = projectPageLib.resolveName(rawName, cards.map((p) => p.name));
  if (!name) return notFound;
  const hub = chats.list();
  const cl = await chatlist.readChats({ hubChats: hub, redact: real.redact });
  const root = await projectPageLib.projectRoot(name, { known: cards.map((p) => p.name) });
  const body = await projectPageLib.buildProjectPage({ name, card: cards.find((p) => p.name === name), root, chatGroup: cl.projects.find((p) => String(p.project).toLowerCase() === name.toLowerCase()), hubChats: hub, redact: real.redact });
  return { status: 200, body };
}

// every chat of a project page carries `pinned: true|false` (Phase 19 pins; the feed lib is not touched, the server adds the flag)
async function projectApi(rawName) {
  const r = await projectApiRaw(rawName);
  if (r.status === 200 && r.body && Array.isArray(r.body.chats)) r.body = { ...r.body, chats: r.body.chats.map((c) => ({ ...c, pinned: pinHooks.pins.isPinned(c && c.id) })) };
  return r;
}

// Chat log (Phase 19, read only): GET /api/chat-log?id=<chat id>[&before=<index>][&limit=<n>]. The id is only compared with the ids of the
// live chat list; the saved file comes from the Hub's own records. Unknown id -> 404. Shape: docs/plan/phases/19-claude-in-the-hub.md
const chatLogLib = await import("./lib/chatlog.mjs");
const chatLogSample = DEMO ? JSON.parse(readFileSync(join(HERE, "demo", "chat-log.json"), "utf8")) : null;
async function chatLogApi(sp) {
  const q = { id: sp.get("id"), before: sp.get("before"), limit: sp.get("limit") };
  if (DEMO) return chatLogLib.demoChatLog({ ...q, demoJson: chatLogSample, chatList: demoChats() });
  const hub = chats.list();
  const cl = await chatlist.readChats({ hubChats: hub, redact: real.redact });
  return chatLogLib.readChatLog({ ...q, chatList: cl, hubChats: hub, appRecords: chatlist.readAppRecords(), redact: real.redact });
}

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
const ACTIONS = ["start", "stop", "open-claude", "autostart", "game-off", "game-on", "game-ignore", "game-unignore", "chat-start", "chat-answer", "chat-stop", "chat-app-link", "chat-remote-control", "chat-open-app", "chat-answer-app", "chat-handoff-round", "chat-fork", "chat-pin"];
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
// "Open this chat" / "Open in the app" (14.11): the PAGE never navigates to a claude:// address (that took the Hub page away). The page sends only an id;
// the server checks it against the app records / the Hub's chats, builds the link itself and has Windows open it. The pieces are replaceable so the self-test never opens a real chat.
const openHooks = {
  open: (link) => new Promise((resolve) => {
    try {
      const p = spawn("explorer.exe", [link], { windowsHide: true, detached: true, stdio: "ignore", shell: false });
      p.on("error", () => resolve(false)); p.unref(); setTimeout(() => resolve(true), 150);
    } catch { resolve(false); }
  }),
  appRecords: () => chatlist.readAppRecords(),
  hubChats: () => chats.list(),
  log: (...a) => gameLog(...a),
};
async function openApp(body) {
  const hubId = typeof body.hubId === "string" ? body.hubId : undefined, appId = typeof body.appId === "string" ? body.appId : undefined;
  const which = hubId !== undefined ? "hub" : "app";
  const id = String(hubId ?? appId ?? "-").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 70) || "-";
  const wrongType = (body.appId !== undefined && appId === undefined) || (body.hubId !== undefined && hubId === undefined);
  const link = wrongType ? null : chatlist.openLinkFor({ appId, hubId }, { appRecords: openHooks.appRecords(), hubChats: openHooks.hubChats() });
  if (!link) { openHooks.log("chat-open-app", id, "refused"); return { ok: false, error: "The Hub can not open that chat. Look at the page again." }; }
  const done = await openHooks.open(link);
  openHooks.log("chat-open-app", id, done ? "ok" : "failed:" + which);
  return done ? { ok: true, message: "Opening in the Claude app." } : { ok: false, error: "Windows did not open the Claude app." };
}

// "Answer a closed app chat" (17.5, D54): the page sends ONLY the app id and the text; the engine (lib/appanswer.mjs) looks up the chat's saved-file id
// and folder in the app's own records and checks the whole D49 rule right before it runs `claude -p --resume`. Replaceable so the self-test only uses fakes.
const appAnswerHooks = { engine: DEMO ? null : makeAppAnswer({ redact: real.redact, log: (...a) => gameLog(...a), hubChats: () => chats.list() }), log: (...a) => gameLog(...a) };
const APP_ANSWER_KEYS = new Set(["action", "appId", "text", "confirm"]);
async function appAnswer(body) {
  if (Object.keys(body).some((k) => !APP_ANSWER_KEYS.has(k)) || typeof body.appId !== "string" || typeof body.text !== "string") {
    appAnswerHooks.log("chat-answer-app", String(typeof body.appId === "string" ? body.appId : "-").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 70) || "-", "refused: wrong request shape");
    return { ok: false, status: "refused", error: "The Hub can not answer that chat. Look at the page again." };
  }
  return appAnswerHooks.engine.answer({ appId: body.appId, text: body.text });
}

// "Hand off and pick up" (19.3): the page sends ONLY the Hub chat id; the engine (lib/handoffround.mjs) sends /handoff, checks handoff.md really changed,
// then starts a new /pickup chat. It uses the same chat engine object as every other chat button. Replaceable so the self-test only uses fakes.
const handoffHooks = { engine: DEMO ? null : makeHandoffRound({ chats, log: (...a) => gameLog(...a) }), log: (...a) => gameLog(...a), redact: DEMO ? (s) => s : real.redact };
const HANDOFF_KEYS = new Set(["action", "id", "confirm"]);
const HUB_CHAT_ID = /^h-[A-Za-z0-9_-]{1,60}$/, ROUND_ID = /^r-[A-Za-z0-9_-]{1,60}$/;
async function handoffRound(body) {
  const logId = String(typeof body.id === "string" ? body.id : "-").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 70) || "-";
  if (Object.keys(body).some((k) => !HANDOFF_KEYS.has(k)) || typeof body.id !== "string" || !HUB_CHAT_ID.test(body.id)) {
    handoffHooks.log("chat-handoff-round", logId, "refused: wrong request shape");
    return { ok: false, error: "The Hub can not hand off that chat. Look at the page again." };
  }
  const r = await handoffHooks.engine.start({ id: body.id });
  handoffHooks.log("chat-handoff-round", logId, r && r.ok ? "accepted " + r.roundId : "refused");
  if (!r || r.ok !== true) return { ok: false, error: handoffHooks.redact(String(r?.error || "The hand-off did not start.")) };
  return { ok: true, roundId: r.roundId, note: "The hand-off is running. The new chat starts only after handoff.md is saved." };
}
// GET /api/chat-handoff?round=<round id> or ?chat=<Hub chat id>: read only, the round's status (or null for a chat that has none). Ids are only compared, never used as paths.
function handoffApi(sp) {
  const notFound = { status: 404, body: { error: "unknown round" } };
  const round = sp.get("round"), chat = sp.get("chat");
  const clean = (r) => {
    if (!r) return r;
    const red = (s) => (typeof s === "string" ? handoffHooks.redact(s) : s);
    return { ...r, error: red(r.error), next: red(r.next), steps: Array.isArray(r.steps) ? r.steps.map((s) => ({ ...s, text: red(s.text) })) : r.steps };
  };
  if (round !== null) {
    if (DEMO || !ROUND_ID.test(round)) return notFound;
    const r = handoffHooks.engine.status(round);
    return r ? { status: 200, body: clean(r) } : notFound;
  }
  if (chat !== null && HUB_CHAT_ID.test(chat)) return { status: 200, body: DEMO ? null : clean(handoffHooks.engine.forChat(chat) || null) };
  return notFound;
}

// ---------- Phase 19 wiring: attached files, fork, pictures in the chat view, pinned chats ----------
// Every piece is replaceable through a hooks object so the self-test only ever uses fakes (no real chat, no real data/pins.json).
const redactText = (s) => (DEMO ? String(s) : real.redact(String(s)));
const chatHooks = { engine: chats };   // start / answer / fork / the upload store (chats.uploads) come from here
const uploadHooks = { hubChats: () => chatHooks.engine.list(), log: (...a) => gameLog(...a), pollMs: 3000, watchMs: 45 * 60000 };
const UPLOAD_MAX = Math.round(10.5 * 1024 * 1024);   // the body limit of POST /api/upload ONLY (the store itself still says 10 MB per file)
const UPLOAD_ID = /^[0-9a-f]{32}$/;
const BUTTONS_OFF = "Sample data mode: the buttons are switched off.";

// Memory-only pins for --demo (really toggles, never touches data/pins.json). Same rules as lib/pins.mjs.
function memoryPins() {
  const ID = /^(h-[A-Za-z0-9-]{1,60}|s-[0-9a-fA-F-]{8}|local_[0-9a-f-]{8,64})$/i;
  const proj = (p) => typeof p === "string" && p.length >= 1 && p.length <= 120 && !/[\\/:\0]|^\.+$/.test(p);
  let pins = [], tick = 0;
  return {
    list: (project) => { const all = [...pins].reverse(); return typeof project === "string" && project ? all.filter((p) => p.project === project) : all; },
    pin: ({ chatId, project } = {}) => {
      if (typeof chatId !== "string" || !ID.test(chatId)) return { ok: false, error: "bad chat id" };
      if (!proj(project)) return { ok: false, error: "bad project name" };
      if (pins.some((p) => p.chatId === chatId)) return { ok: true, already: true, count: pins.length };
      if (pins.length >= MAX_PINS) return { ok: false, error: `at most ${MAX_PINS} pinned chats; unpin one first` };
      pins.push({ chatId, project, at: new Date(Date.now() + ++tick).toISOString() });
      return { ok: true, count: pins.length };
    },
    unpin: ({ chatId } = {}) => {
      if (typeof chatId !== "string" || !ID.test(chatId)) return { ok: false, error: "bad chat id" };
      const left = pins.filter((p) => p.chatId !== chatId); const already = left.length === pins.length; pins = left;
      return already ? { ok: true, already: true, count: pins.length } : { ok: true, count: pins.length };
    },
    isPinned: (id) => pins.some((p) => p.chatId === id),
  };
}
const pinHooks = { pins: DEMO ? memoryPins() : makePins(), log: (...a) => gameLog(...a) };

// --- POST /api/upload?chat=<Hub chat id or "new">: raw file body, guarded like /api/action, 10.5 MB limit counted while reading ---
async function handleUpload(req, res, send, sp) {
  const h = req.headers;
  // a refusal never reads the rest of the body; for a too-big file the connection is closed after the answer (nothing more is accepted), otherwise the small leftover is thrown away
  const refuse = (code, m) => {
    if (code === 413) { res.writeHead(413, { "Content-Type": "application/json", ...HEADERS, Connection: "close" }); res.end(err(m)); res.once("finish", () => { try { req.destroy(); } catch { /* already gone */ } }); }
    else { send(code, err(m)); req.resume(); }
  };
  if (String(h["content-type"] || "").split(";")[0].trim().toLowerCase() !== "application/octet-stream") return refuse(415, "Send the file as application/octet-stream");
  if (!allowedOrigins.includes(h.origin)) return refuse(403, "forbidden origin");
  if (h["sec-fetch-site"] && h["sec-fetch-site"] !== "same-origin") return refuse(403, "forbidden origin");
  const got = Buffer.from(String(h["x-hub-token"] || "")); const want = Buffer.from(TOKEN);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return refuse(403, "missing or wrong token");
  const chat = sp.get("chat");
  if (chat !== "new" && !(typeof chat === "string" && HUB_CHAT_ID.test(chat))) return refuse(400, "Unknown chat.");
  let name = "file";
  if (h["x-upload-name"] !== undefined) {
    try { name = decodeURIComponent(String(h["x-upload-name"])); } catch { return refuse(400, "The file name could not be read."); }
    if (name.length > 300) return refuse(400, "The file name could not be read.");
  }
  if (!/^\d+$/.test(String(h["content-length"] ?? ""))) return refuse(411, "The file size is missing. Try attaching it again.");
  if (Number(h["content-length"]) > UPLOAD_MAX) return refuse(413, "Files can be at most 10 MB.");   // refused from the header alone: nothing is read
  if (DEMO) { send(200, err(BUTTONS_OFF)); req.resume(); return; }
  if (chat !== "new" && !uploadHooks.hubChats().some((c) => c && c.id === chat)) { uploadHooks.log("upload", chat, "refused: unknown chat"); req.resume(); return send(200, err("Unknown chat.")); }
  const chunks = []; let total = 0;
  for await (const chunk of req) { total += chunk.length; if (total > UPLOAD_MAX) return refuse(413, "Files can be at most 10 MB."); chunks.push(chunk); }
  const r = chatHooks.engine.uploads.save({ chatKey: chat, bytes: Buffer.concat(chunks), originalName: name });
  if (!r || r.ok !== true) { uploadHooks.log("upload", chat, "refused"); return send(200, err(redactText(String(r?.error || "The file could not be attached.")))); }
  uploadHooks.log("upload", chat, `ok ${r.kind} ${r.bytes}`);   // kind and size only: never the name
  send(200, JSON.stringify({ ok: true, uploadId: r.uploadId, kind: r.kind, name: r.name, bytes: r.bytes, mediaType: r.mediaType }));
}

// attachments on chat-start / chat-answer: absent or empty = none (the old behaviour, nothing extra is passed); else 1 to 4 ids of 32 hex characters
function attachmentsOf(body) {
  if (body.attachments === undefined || (Array.isArray(body.attachments) && body.attachments.length === 0)) return { ids: null };
  const a = body.attachments;
  if (!Array.isArray(a) || a.length > 4 || a.some((x) => typeof x !== "string" || !UPLOAD_ID.test(x))) return { bad: true };
  return { ids: a };
}
// Pictures and PDFs are copied into the chat's own saved file when the turn runs, so the stored copy goes as soon as the turn is over (success or failure).
// Text files stay (Claude reads them during the turn) until the 7-day cleanup. Nothing is removed when the engine refused the message (the person may retry).
function dropPictures(chatId, ids) {
  const up = chatHooks.engine.uploads; if (!up || !ids || typeof chatId !== "string") return;
  const pics = ids.filter((id) => { try { const g = up.get(id); return g && (g.kind === "image" || g.kind === "pdf"); } catch { return false; } });
  if (!pics.length) return;
  const t0 = Date.now();
  const look = () => {
    let st = "working"; try { const c = chatHooks.engine.list().find((x) => x && x.id === chatId); st = c ? c.state : null; } catch { /* look again */ }
    if (st !== "working" || Date.now() - t0 > uploadHooks.watchMs) { for (const id of pics) { try { up.remove(id); } catch { /* the 7-day cleanup will get it */ } } return; }
    setTimeout(look, uploadHooks.pollMs).unref();
  };
  setTimeout(look, uploadHooks.pollMs).unref();
}
const attachRefused = (action, id) => { uploadHooks.log(action, id || "-", "refused: wrong attachments"); return { ok: false, error: "The Hub can not send those attached files. Attach them again." }; };

// --- chat-fork: body exactly { action, id, name?, text?, confirm } ---
const FORK_KEYS = new Set(["action", "id", "name", "text", "confirm"]);
async function forkAction(body) {
  const logId = String(typeof body.id === "string" ? body.id : "-").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 70) || "-";
  if (Object.keys(body).some((k) => !FORK_KEYS.has(k)) || typeof body.id !== "string" || !HUB_CHAT_ID.test(body.id) || (body.name !== undefined && typeof body.name !== "string") || (body.text !== undefined && typeof body.text !== "string")) {
    uploadHooks.log("chat-fork", logId, "refused: wrong request shape");
    return { ok: false, error: "The Hub can not copy that chat. Look at the page again." };
  }
  if (body.name !== undefined && body.name.length > 80) return { ok: false, error: "The name must be at most 80 characters." };
  if (body.text !== undefined && body.text.length > 4000) return { ok: false, error: "The first message must be at most 4000 characters." };
  const o = { id: body.id }; if (body.name !== undefined) o.name = body.name; if (body.text !== undefined) o.text = body.text;
  const r = await chatHooks.engine.fork(o);   // the engine writes its own log line
  if (!r || r.ok !== true) return { ok: false, error: redactText(String(r?.error || "The copy was not made.")) };
  return { ok: true, id: r.id, note: String(r.message || "Made a copy of the chat. The old chat stays as it was.") };
}

// --- pins: GET /api/pins?project=<name> and the action chat-pin { action, chatId, project, pinned, confirm } ---
const PIN_KEYS = new Set(["action", "chatId", "project", "pinned", "confirm"]);
function pinAction(body) {
  const logId = String(typeof body.chatId === "string" ? body.chatId : "-").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 70) || "-";
  if (Object.keys(body).some((k) => !PIN_KEYS.has(k)) || typeof body.chatId !== "string" || typeof body.project !== "string" || typeof body.pinned !== "boolean") {
    pinHooks.log("chat-pin", logId, "refused: wrong request shape");
    return { ok: false, error: "The Hub can not pin that chat. Look at the page again." };
  }
  const r = body.pinned ? pinHooks.pins.pin({ chatId: body.chatId, project: body.project }) : pinHooks.pins.unpin({ chatId: body.chatId });
  if (!r || r.ok !== true) {
    const e = String(r?.error || "");
    pinHooks.log("chat-pin", logId, "refused");
    return { ok: false, error: /^at most/.test(e) ? `At most ${MAX_PINS} pinned chats. Unpin one first.` : /save/.test(e) ? "The Hub could not save the pinned chats. Try again." : "The Hub can not pin that chat. Look at the page again." };
  }
  pinHooks.log("chat-pin", logId, (body.pinned ? "pinned" : "unpinned") + (r.already ? " (already)" : ""));
  return { ok: true, pinned: body.pinned, count: r.count, ...(r.already ? { already: true } : {}) };
}

// --- GET /api/chat-image?id=<chat id>&m=<n>&b=<n>: one picture out of a saved chat. The file is found like /api/chat-log finds it; no path from the query ---
const imageHooks = {
  resolveFile: async (id) => {
    const hub = chats.list();
    const cl = await chatlist.readChats({ hubChats: hub, redact: real.redact });
    return chatLogLib.resolveChatFile(id, { chatList: cl, hubChats: hub, appRecords: chatlist.readAppRecords() });
  },
  read: readChatImage,
};
const IMG_NOT_FOUND = { status: 404, body: { error: "unknown chat" } };
async function chatImageApi(sp, demoJson = chatLogSample) {
  const id = sp.get("id"), m = sp.get("m"), b = sp.get("b");
  if (DEMO) return demoImage(id, m, b, demoJson);
  if (typeof id !== "string" || !id) return IMG_NOT_FOUND;
  const file = await imageHooks.resolveFile(id);
  if (!file) return IMG_NOT_FOUND;
  const r = imageHooks.read({ file, m, b });
  if (r && r.ok === true) return { status: 200, mediaType: r.mediaType, bytes: r.bytes };
  const st = r && [400, 404, 413, 415, 422].includes(r.status) ? r.status : 404;
  return { status: st, body: { error: String(r?.error || "no such picture") } };
}
// --demo: a tiny made-up picture (120x80, one colour with a lighter box) for sample chats whose log has an image block at m / b
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function demoPng() {
  const W = 120, H = 80, raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = y * (W * 3 + 1);
    const box = x >= 30 && x < 90 && y >= 20 && y < 60; const px = box ? [150, 190, 235] : [60, 110, 190];
    raw[o + 1 + x * 3] = px[0]; raw[o + 2 + x * 3] = px[1]; raw[o + 3 + x * 3] = px[2];
  }
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function demoImage(id, m, b, demoJson) {
  const msgs = demoJson && demoJson.chats && typeof id === "string" && Object.hasOwn(demoJson.chats, id) ? demoJson.chats[id].messages : null;
  if (!Array.isArray(msgs)) return IMG_NOT_FOUND;
  if (!/^\d{1,6}$/.test(String(m)) || !/^\d{1,6}$/.test(String(b))) return { status: 400, body: { error: "bad request" } };
  const blk = msgs[Number(m)] && Array.isArray(msgs[Number(m)].blocks) ? msgs[Number(m)].blocks[Number(b)] : null;
  if (!blk || blk.type !== "image") return { status: 404, body: { error: "no such picture" } };
  return { status: 200, mediaType: "image/png", bytes: demoPng() };
}

async function chatAction(body) {
  if (body.action === "chat-handoff-round") return handoffRound(body);
  if (body.action === "chat-open-app") return openApp(body);
  if (body.action === "chat-answer-app") return appAnswer(body);
  // workflow (D44): the chat first runs /pickup, unless the page says exactly false (the "Skip the project workflow" tick)
  if (body.action === "chat-fork") return forkAction(body);
  if (body.action === "chat-start") {
    const at = attachmentsOf(body); if (at.bad) return attachRefused("chat-start", "-");
    const r = await chatHooks.engine.start({ project: body.project, task: body.task, model: body.model, remoteControl: body.remoteControl === true, workflow: body.workflow !== false, ...(at.ids ? { attachments: at.ids } : {}) });
    if (at.ids && r && r.ok === true) dropPictures(r.id, at.ids);
    return r;
  }
  if (body.action === "chat-answer") {
    const at = attachmentsOf(body); if (at.bad) return attachRefused("chat-answer", typeof body.id === "string" ? body.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 70) : "-");
    const r = await chatHooks.engine.answer({ id: body.id, text: body.text, ...(at.ids ? { attachments: at.ids } : {}) });
    if (at.ids && r && r.ok === true) dropPictures(body.id, at.ids);
    return r;
  }
  if (body.action === "chat-stop") return chats.stop({ id: body.id });
  if (body.action === "chat-remote-control") return chats.setRemoteControl({ id: body.id, on: typeof body.on === "boolean" ? body.on : undefined }); // only the Hub id and a true / false
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
  if (body.action === "chat-pin") return send(200, JSON.stringify(pinAction(body)));   // pinning is reversible and stays on in --demo (memory only)
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
    if (path === "/api/upload") return req.method === "POST" ? await handleUpload(req, res, send, new URL(req.url, "http://x").searchParams) : send(405, '{"error":"method not allowed"}');
    if (req.method !== "GET" && req.method !== "HEAD") return send(405, '{"error":"method not allowed"}');
    if (path === "/api/project") { const r = await projectApi(new URL(req.url, "http://x").searchParams.get("name")); return send(r.status, JSON.stringify(r.body)); }
    if (path === "/api/chat-handoff") { const r = handoffApi(new URL(req.url, "http://x").searchParams); return send(r.status, JSON.stringify(r.body)); }
    if (path === "/api/chat-log") { const r = await chatLogApi(new URL(req.url, "http://x").searchParams); return send(r.status, JSON.stringify(r.body)); }
    if (path === "/api/pins") { const p = new URL(req.url, "http://x").searchParams.get("project"); return send(200, JSON.stringify({ pins: pinHooks.pins.list(p === null ? undefined : p) })); }
    if (path === "/api/chat-image") {
      const r = await chatImageApi(new URL(req.url, "http://x").searchParams);
      if (r.status !== 200) return send(r.status, JSON.stringify(r.body));
      res.writeHead(200, { ...HEADERS, "Content-Type": r.mediaType, "Content-Length": r.bytes.length, "Cache-Control": "private, max-age=300", "Content-Disposition": "inline" });
      return res.end(r.bytes);
    }
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
  // project page (17.4): known name -> the page object; anything else -> 404; no write method works; nothing from the query becomes a path
  const firstName = j.projects[0].name;
  const rp = await fetch(base + "/api/project?name=" + encodeURIComponent(firstName)); const jp = await rp.json();
  ok("GET /api/project?name=<known> returns project, decisions, chats, handoff", rp.status === 200 && jp.project?.name === firstName && Array.isArray(jp.decisions) && Array.isArray(jp.chats) && "handoff" in jp && typeof jp.generatedAt === "string");
  ok("GET /api/project with an unknown name is 404", (await fetch(base + "/api/project?name=NoSuchProject")).status === 404);
  ok("GET /api/project with a path trick, an empty or missing name is 404", (await Promise.all(["..%5C..%5CWindows", "..%2F..", "C%3A%5CWindows", "", firstName.toLowerCase() === firstName ? firstName.toUpperCase() : firstName.toLowerCase()].map((n) => fetch(base + "/api/project?name=" + n).then((r) => r.status)))).every((s) => s === 404) && (await fetch(base + "/api/project")).status === 404);
  ok("POST and PUT to /api/project are refused", (await fetch(base + "/api/project?name=" + encodeURIComponent(firstName), { method: "POST" })).status === 405 && (await fetch(base + "/api/project?name=" + encodeURIComponent(firstName), { method: "PUT" })).status === 405);
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
  ok("chat-start refuses an empty task, an unknown model, and Remote Control with an empty task", await refused({ action: "chat-start", project: "Hub", task: "  " }) && await refused({ action: "chat-start", project: "Hub", task: "x", model: "gpt-4" }) && await refused({ action: "chat-start", project: "Hub", task: " ", remoteControl: true }));   // never a valid project AND a task here: that would really start a chat
  ok("chat-answer and chat-stop refuse an unknown chat and a Claude session id", await refused({ action: "chat-answer", id: "h-20260101-000000-abcd", text: "x" }) && await refused({ action: "chat-answer", id: "18ec7052-3a6a-46cc-ade3-7ff857195e3d", text: "x" }) && await refused({ action: "chat-stop", id: "h-20260101-000000-abcd" }));
  ok("chat-remote-control without the token is refused", (await raw("/api/action", { ...json, "X-Hub-Token": "" }, cj({ action: "chat-remote-control", id: "h-20260101-000000-abcd", on: true }), "POST")).status === 403);
  ok("chat-remote-control refuses an unknown chat, a Claude session id, a missing or non-boolean value", await refused({ action: "chat-remote-control", id: "h-20260101-000000-abcd", on: true }) && await refused({ action: "chat-remote-control", id: "18ec7052-3a6a-46cc-ade3-7ff857195e3d", on: false }) && await refused({ action: "chat-remote-control", id: "h-20260101-000000-abcd" }) && await refused({ action: "chat-remote-control", id: "h-20260101-000000-abcd", on: "yes" }));
  ok("chat-start with Remote Control on is refused for an unknown project (nothing started)", await refused({ action: "chat-start", project: "NoSuchProject", task: "x", remoteControl: true }));
  ok("a long chat task is not cut off as 'too big' but still refused for its project", await refused({ action: "chat-start", project: "NoSuchProject", task: "x".repeat(3000) }));
  ok("a long body on any other action is still 413", (await raw("/api/action", json, JSON.stringify({ action: "stop", id: "x", pad: "y".repeat(3000), confirm: true }), "POST")).status === 413);
  const lnk = await raw("/api/action", json, cj({ action: "chat-app-link", project: "Hub", task: "Hello there" }), "POST"); const lj = JSON.parse(lnk.text);
  ok("chat-app-link builds the app's new-chat link for a real project only", lnk.status === 200 && lj.ok === true && lj.link.startsWith("claude://code/new?q=Hello%20there&folder=") && await refused({ action: "chat-app-link", project: "NoSuchProject", task: "x" }));
  // 14.11 "Open this chat": fake opener + fake records, so no real chat is ever opened
  const opened = [], logged = [];
  const U1 = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  openHooks.open = async (l) => { opened.push(l); return true; };
  openHooks.log = (...a) => logged.push(a.join(" "));
  openHooks.appRecords = () => [{ sessionId: "local_abcdef12-3456", cliSessionId: "x-1" }, { sessionId: "local_deadbeef-0001", cliSessionId: "x-2", isArchived: true }];
  openHooks.hubChats = () => [{ id: "h-rest", state: "idle", remoteControl: false, sessionId: U1 }, { id: "h-busy", state: "working", remoteControl: false, sessionId: U1 }];
  const oa = (o, h = json) => raw("/api/action", h, cj({ action: "chat-open-app", ...o }), "POST");
  const noOpen = async (o) => { const n = opened.length; const r = await oa(o); return r.status === 200 && JSON.parse(r.text).ok === false && opened.length === n; };
  ok("chat-open-app without the token is refused", (await oa({ appId: "local_abcdef12-3456" }, { ...json, "X-Hub-Token": "" })).status === 403 && opened.length === 0);
  ok("chat-open-app from another Origin is refused", (await oa({ appId: "local_abcdef12-3456" }, { ...json, Origin: "http://evil.example" })).status === 403 && opened.length === 0);
  ok("chat-open-app without confirm is refused", (await raw("/api/action", json, JSON.stringify({ action: "chat-open-app", appId: "local_abcdef12-3456" }), "POST")).status === 400 && opened.length === 0);
  ok("chat-open-app refuses an unknown, an archived and a malformed app id", await noOpen({ appId: "local_00000000-0000" }) && await noOpen({ appId: "local_deadbeef-0001" }) && await noOpen({ appId: "local_../x" }) && await noOpen({ appId: 5 }) && await noOpen({}));
  ok("chat-open-app refuses a link sent as the app id", await noOpen({ appId: "claude://claude.ai/epitaxy/local_abcdef12-3456" }) && await noOpen({ appId: "calc.exe" }) && await noOpen({ hubId: "claude://resume?session=" + U1 }));
  ok("chat-open-app refuses both ids, and a working or unknown Hub chat", await noOpen({ appId: "local_abcdef12-3456", hubId: "h-rest" }) && await noOpen({ hubId: "h-busy" }) && await noOpen({ hubId: "h-nope" }) && await noOpen({ hubId: "h-rest", appId: 5 }));
  const good = await oa({ appId: "local_abcdef12-3456" }); const gj = JSON.parse(good.text);
  ok("chat-open-app with a known app id calls the opener once with exactly the epitaxy link", good.status === 200 && gj.ok === true && gj.message === "Opening in the Claude app." && opened.length === 1 && opened[0] === "claude://claude.ai/epitaxy/local_abcdef12-3456");
  const goodHub = await oa({ hubId: "h-rest" });
  ok("chat-open-app with a resting Hub chat opens the resume link built by the server", JSON.parse(goodHub.text).ok === true && opened.length === 2 && opened[1] === "claude://resume?session=" + U1);
  ok("chat-open-app logs action, id and result only", logged.some((l) => l === "chat-open-app local_abcdef12-3456 ok") && logged.some((l) => l.startsWith("chat-open-app") && l.endsWith("refused")) && logged.every((l) => !l.includes("claude://")));
  // 17.5 "answer a closed app chat": a FAKE engine (fake records, open list, file times and run), so no real claude runs and no real chat is touched
  const aaRuns = [], aaLogs = [];
  const AA = "local_abcdef12-3456", AU = "abcdef12-1111-4222-8333-444455556666";
  const aaRoot = join(HERE, "..", "..", "..");   // the projects folder; the fake record says the chat is in the Hub folder
  let aaOpen = [];
  appAnswerHooks.log = (...a) => aaLogs.push(a.join(" "));
  appAnswerHooks.engine = makeAppAnswer({
    root: aaRoot, now: () => 1_000_000_000, log: (...a) => aaLogs.push(a.join(" ")), redact: (s) => String(s).replace(/SECRET\w*/g, "[hidden]"), hubChats: () => [],
    appRecords: () => [{ sessionId: AA, cliSessionId: AU, cwd: join(aaRoot, "Hub"), isArchived: false, remoteControlUserEnabled: false }],
    listOpen: async () => aaOpen, fileMtime: () => 1_000_000_000 - 120_000,
    run: async (o) => { aaRuns.push(o); return { code: 0, out: JSON.stringify({ type: "result", subtype: "success", session_id: o.sessionId, result: "Fake reply SECRET7" }), err: "" }; },
  });
  const aa = (o, h = json) => raw("/api/action", h, cj({ action: "chat-answer-app", ...o }), "POST");
  const aaNo = async (o, h) => { const n = aaRuns.length; const r = await aa(o, h); return r.status === 200 && JSON.parse(r.text).ok === false && aaRuns.length === n; };
  ok("chat-answer-app without the token / with a wrong token is refused, nothing run", (await aa({ appId: AA, text: "x" }, { ...json, "X-Hub-Token": "" })).status === 403 && (await aa({ appId: AA, text: "x" }, { ...json, "X-Hub-Token": "y".repeat(tok.length) })).status === 403 && aaRuns.length === 0);
  ok("chat-answer-app from another Origin or with no Origin is refused, nothing run", (await aa({ appId: AA, text: "x" }, { ...json, Origin: "http://evil.example" })).status === 403 && (await aa({ appId: AA, text: "x" }, { "Content-Type": "application/json", "X-Hub-Token": tok })).status === 403 && aaRuns.length === 0);
  ok("chat-answer-app without confirm, or not JSON, is refused, nothing run", (await raw("/api/action", json, JSON.stringify({ action: "chat-answer-app", appId: AA, text: "x" }), "POST")).status === 400 && (await raw("/api/action", { ...json, "Content-Type": "text/plain" }, cj({ action: "chat-answer-app", appId: AA, text: "x" }), "POST")).status === 415 && aaRuns.length === 0);
  ok("chat-answer-app refuses an unknown, a malformed and a link-shaped app id", await aaNo({ appId: "local_00000000-0000", text: "x" }) && await aaNo({ appId: "local_../x", text: "x" }) && await aaNo({ appId: "claude://claude.ai/epitaxy/" + AA, text: "x" }) && await aaNo({ appId: 5, text: "x" }) && await aaNo({ text: "x" }));
  ok("chat-answer-app refuses an empty and an over-long text (4001), and a body over the size limit", await aaNo({ appId: AA, text: " " }) && await aaNo({ appId: AA, text: "x".repeat(4001) }) && (await aa({ appId: AA, text: "x".repeat(15000) })).status === 413 && aaRuns.length === 0);
  ok("chat-answer-app refuses extra fields (only appId and text): no cliSessionId, cwd or id from the page", await aaNo({ appId: AA, text: "x", cliSessionId: AU }) && await aaNo({ appId: AA, text: "x", cwd: "C:\\Windows" }) && await aaNo({ appId: AA, text: "x", id: "h-1" }));
  aaOpen = [{ sessionId: AU, kind: "interactive", pid: 1 }];
  const aaOpenR = await aa({ appId: AA, text: "x" });
  ok("chat-answer-app refuses a chat that is open in the app, in words", JSON.parse(aaOpenR.text).error === "This chat is open in the app: answer it there, so it does not split in two." && aaRuns.length === 0);
  aaOpen = [];
  const aaGood = await aa({ appId: AA, text: "Hello" }); const aaJ = JSON.parse(aaGood.text);
  ok("chat-answer-app with a known closed chat runs once with the saved-file id and folder from the record; reply redacted", aaJ.ok === true && aaJ.status === "done" && aaJ.reply === "Fake reply [hidden]" && aaRuns.length === 1 && aaRuns[0].sessionId === AU && aaRuns[0].cwd === join(aaRoot, "Hub") && aaRuns[0].text === "Hello");
  ok("chat-answer-app logs one line per request, never the text", aaLogs.length >= 1 && aaLogs.every((l) => l.startsWith("chat-answer-app ") && !l.includes("Hello")) && aaLogs.some((l) => l === "chat-answer-app " + AA + " ok done"));
  // the real route in --demo mode: a separate sample-data server on a spare port answers "buttons off" (its engine does not even exist there)
  ok("chat-answer-app in --demo mode: 'Sample data mode: the buttons are switched off.' and nothing starts", await (async () => {
    const { createServer: cs } = await import("node:net");
    const spare = await new Promise((d) => { const s = cs(); s.listen(0, HOST, () => { const p = s.address().port; s.close(() => d(p)); }); });
    const kid = spawn(process.execPath, [fileURLToPath(import.meta.url), "--demo"], { env: { ...process.env, HUB_PORT: String(spare) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    try {
      await new Promise((d, no) => { let t = ""; const to = setTimeout(() => no(new Error("demo server did not start")), 15000); kid.stdout.on("data", (x) => { t += x; if (t.includes("Ready.")) { clearTimeout(to); d(); } }); });
      const db = `http://${HOST}:${spare}`;
      const dt = (await (await fetch(db + "/api/session")).json()).token;
      const r = await fetch(db + "/api/action", { method: "POST", headers: { "Content-Type": "application/json", Origin: db, "X-Hub-Token": dt }, body: JSON.stringify({ action: "chat-answer-app", appId: "local_0bac1d2e-0000-4000-8000-000000000004", text: "Hello", confirm: true }) });
      const j = await r.json();
      return r.status === 200 && j.ok === false && j.error === "Sample data mode: the buttons are switched off.";
    } catch { return false; } finally { kid.kill(); }
  })());
  // 19.3 "Hand off and pick up": a FAKE rounds object, so no real round starts and no real chat is touched
  const hoStarts = [], hoLogs = [];
  const HO_ROUND = { roundId: "r-20261121-100000-ab12", chatId: "h-rest", project: "Hub", state: "done", step: 6, steps: [{ step: 6, at: "2026-11-21T10:00:00.000Z", text: "Done SECRET1", ok: true }], startedAt: "2026-11-21T10:00:00.000Z", finishedAt: "2026-11-21T10:01:00.000Z", error: "bad SECRET2", next: null, handoffChanged: true, result: { oldId: "h-rest", newId: "h-new", newName: "N", handoffChanged: true } };
  handoffHooks.log = (...a) => hoLogs.push(a.join(" "));
  handoffHooks.redact = (s) => String(s).replace(/SECRET\w*/g, "[hidden]");
  handoffHooks.engine = {
    start: async (o) => { hoStarts.push(o); return o.id === "h-busy" ? { ok: false, error: "Still working SECRET3" } : { ok: true, roundId: HO_ROUND.roundId }; },
    status: (id) => (id === HO_ROUND.roundId ? HO_ROUND : null),
    forChat: (id) => (id === "h-rest" ? HO_ROUND : null),
    active: () => [],
  };
  const ho = (o, h = json) => raw("/api/action", h, cj({ action: "chat-handoff-round", ...o }), "POST");
  const hoNo = async (o) => { const n = hoStarts.length; const r = await ho(o); return r.status === 200 && JSON.parse(r.text).ok === false && hoStarts.length === n; };
  ok("chat-handoff-round without / with a wrong token is refused, nothing started", (await ho({ id: "h-rest" }, { ...json, "X-Hub-Token": "" })).status === 403 && (await ho({ id: "h-rest" }, { ...json, "X-Hub-Token": "y".repeat(tok.length) })).status === 403 && hoStarts.length === 0);
  ok("chat-handoff-round from another Origin or with no Origin is refused, nothing started", (await ho({ id: "h-rest" }, { ...json, Origin: "http://evil.example" })).status === 403 && (await ho({ id: "h-rest" }, { "Content-Type": "application/json", "X-Hub-Token": tok })).status === 403 && hoStarts.length === 0);
  ok("chat-handoff-round without confirm, or not JSON, is refused, nothing started", (await raw("/api/action", json, JSON.stringify({ action: "chat-handoff-round", id: "h-rest" }), "POST")).status === 400 && (await raw("/api/action", { ...json, "Content-Type": "text/plain" }, cj({ action: "chat-handoff-round", id: "h-rest" }), "POST")).status === 415 && hoStarts.length === 0);
  ok("chat-handoff-round refuses extra fields (only the id): no project, text, model or folder from the page", await hoNo({ id: "h-rest", project: "Hub" }) && await hoNo({ id: "h-rest", text: "/handoff" }) && await hoNo({ id: "h-rest", cwd: "C:\\Windows" }));
  ok("chat-handoff-round refuses a missing, non-string, path-like, session-like or link-shaped id", await hoNo({}) && await hoNo({ id: 5 }) && await hoNo({ id: "..\\..\\x" }) && await hoNo({ id: "h-../x" }) && await hoNo({ id: "18ec7052-3a6a-46cc-ade3-7ff857195e3d" }) && await hoNo({ id: "local_abcdef12-3456" }) && await hoNo({ id: "claude://resume?session=x" }) && await hoNo({ id: "h-" + "x".repeat(80) }));
  const hoGood = JSON.parse((await ho({ id: "h-rest" })).text);
  ok("chat-handoff-round with a good id passes only the id and returns the round id at once", hoGood.ok === true && hoGood.roundId === HO_ROUND.roundId && typeof hoGood.note === "string" && hoStarts.length === 1 && JSON.stringify(hoStarts[0]) === '{"id":"h-rest"}');
  const hoBusy = JSON.parse((await ho({ id: "h-busy" })).text);
  ok("chat-handoff-round shows the engine's refusal in words (redacted)", hoBusy.ok === false && hoBusy.error === "Still working [hidden]" && hoBusy.roundId === undefined);
  ok("chat-handoff-round logs one line per request, never text", hoLogs.length === 13 && hoLogs.every((l) => l.startsWith("chat-handoff-round ") && !l.includes("/handoff") && !l.includes("SECRET")) && hoLogs.some((l) => l === "chat-handoff-round h-rest accepted " + HO_ROUND.roundId));
  const hg = async (q) => { const r = await fetch(base + "/api/chat-handoff" + q); return { status: r.status, body: await r.json() }; };
  const hr = await hg("?round=" + HO_ROUND.roundId);
  ok("GET /api/chat-handoff?round=<known> returns the round object, error texts redacted", hr.status === 200 && hr.body.roundId === HO_ROUND.roundId && hr.body.state === "done" && Array.isArray(hr.body.steps) && hr.body.result.newId === "h-new" && hr.body.error === "bad [hidden]" && hr.body.steps[0].text === "Done [hidden]");
  const hc = await hg("?chat=h-rest"), hc0 = await hg("?chat=h-other");
  ok("GET /api/chat-handoff?chat=<id> returns that chat's newest round, or null", hc.status === 200 && hc.body.roundId === HO_ROUND.roundId && hc0.status === 200 && hc0.body === null);
  const hu = await hg("?round=r-20200101-000000-zzzz");
  ok("GET /api/chat-handoff with an unknown round is 404 {error:'unknown round'}", hu.status === 404 && hu.body.error === "unknown round");
  ok("GET /api/chat-handoff with a path trick, a bad id, or no id is 404", (await Promise.all(["?round=..%5C..%5Cx", "?round=..%2F..", "?round=", "?chat=..%5Cx", "?chat=18ec7052-3a6a-46cc-ade3-7ff857195e3d", "?chat=", ""].map((q) => fetch(base + "/api/chat-handoff" + q).then((r) => r.status)))).every((s) => s === 404));
  ok("POST and PUT to /api/chat-handoff are refused", (await fetch(base + "/api/chat-handoff?round=" + HO_ROUND.roundId, { method: "POST" })).status === 405 && (await fetch(base + "/api/chat-handoff?round=" + HO_ROUND.roundId, { method: "PUT" })).status === 405 && hoStarts.length === 2);
  ok("chat-handoff-round and chat-handoff in --demo mode: buttons off, chat answers null, round 404, nothing starts", await (async () => {
    const { createServer: cs } = await import("node:net");
    const spare = await new Promise((d) => { const s = cs(); s.listen(0, HOST, () => { const p = s.address().port; s.close(() => d(p)); }); });
    const kid = spawn(process.execPath, [fileURLToPath(import.meta.url), "--demo"], { env: { ...process.env, HUB_PORT: String(spare) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    try {
      await new Promise((d, no) => { let t = ""; const to = setTimeout(() => no(new Error("demo server did not start")), 15000); kid.stdout.on("data", (x) => { t += x; if (t.includes("Ready.")) { clearTimeout(to); d(); } }); });
      const db = `http://${HOST}:${spare}`;
      const dt = (await (await fetch(db + "/api/session")).json()).token;
      const r = await fetch(db + "/api/action", { method: "POST", headers: { "Content-Type": "application/json", Origin: db, "X-Hub-Token": dt }, body: JSON.stringify({ action: "chat-handoff-round", id: "h-20261116-101500-k3x9", confirm: true }) });
      const j = await r.json();
      const c = await fetch(db + "/api/chat-handoff?chat=h-20261116-101500-k3x9");
      const rr = await fetch(db + "/api/chat-handoff?round=r-20261116-101500-k3x9");
      return r.status === 200 && j.ok === false && j.error === "Sample data mode: the buttons are switched off." && c.status === 200 && (await c.json()) === null && rr.status === 404;
    } catch { return false; } finally { kid.kill(); }
  })());
  // ---------- Phase 19 wiring (attached files, fork, pictures, pins): a FAKE engine, a FAKE picture finder and pins in a temp folder.
  // Nothing here touches a real chat, the real upload folder or the real data/pins.json. ----------
  const { mkdtempSync, writeFileSync: wf } = await import("node:fs"); const { tmpdir } = await import("node:os");
  const sleep = (ms) => new Promise((d) => setTimeout(d, ms));
  const realPinsFile = join(HERE, "..", "..", "data", "pins.json");
  const pinsBefore = existsSync(realPinsFile) ? statSync(realPinsFile).mtimeMs : null;
  const withDemo = async (fn) => {   // a separate --demo server on a spare port (its engine does not even exist there)
    const { createServer: cs } = await import("node:net");
    const spare = await new Promise((d) => { const s = cs(); s.listen(0, HOST, () => { const p = s.address().port; s.close(() => d(p)); }); });
    const kid = spawn(process.execPath, [fileURLToPath(import.meta.url), "--demo"], { env: { ...process.env, HUB_PORT: String(spare) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    try {
      await new Promise((d, no) => { let t = ""; const to = setTimeout(() => no(new Error("demo server did not start")), 15000); kid.stdout.on("data", (x) => { t += x; if (t.includes("Ready.")) { clearTimeout(to); d(); } }); });
      const db = `http://${HOST}:${spare}`;
      return await fn(db, (await (await fetch(db + "/api/session")).json()).token);
    } catch (e) { console.log("demo helper failed: " + (e && e.message)); return false; } finally { kid.kill(); }
  };
  ok("chat-start with an empty task and an empty attachments list is still refused in the old words (real engine, nothing starts)", await refused({ action: "chat-start", project: "Hub", task: "", attachments: [] }));
  const realEngine = chatHooks.engine;
  const I1 = "1".repeat(32), I2 = "2".repeat(32), I3 = "3".repeat(32), kinds = { [I1]: "image", [I2]: "pdf", [I3]: "text" };
  const fx = { saves: [], removed: [], starts: [], answers: [], forks: [], state: "idle", logs: [] };
  chatHooks.engine = {
    uploads: {
      save: (o) => { fx.saves.push({ chatKey: o.chatKey, name: o.originalName, len: o.bytes.length, isBuf: Buffer.isBuffer(o.bytes) }); return o.bytes.length ? { ok: true, uploadId: "a".repeat(32), kind: "image", mediaType: "image/png", name: "my pic.png", bytes: o.bytes.length, path: "C:\\secret\\x.png" } : { ok: false, error: "The file is empty." }; },
      get: (id) => (kinds[id] ? { kind: kinds[id] } : null),
      remove: (id) => { fx.removed.push(id); return true; },
    },
    list: () => [{ id: "h-rest", state: fx.state }, { id: "h-new1", state: fx.state }],
    start: async (o) => { fx.starts.push(o); return o.project === "Nope" ? { ok: false, error: "Unknown project." } : { ok: true, id: "h-new1", message: "Started." }; },
    answer: async (o) => { fx.answers.push(o); return o.id === "h-gone" ? { ok: false, error: "Unknown chat." } : { ok: true, message: "Sent." }; },
    fork: async (o) => { fx.forks.push(o); return o.id === "h-busy" ? { ok: false, error: "This chat is still working. Wait for it to finish before making a copy." } : { ok: true, id: "h-fork1", message: "Made a copy of the chat in Hub. The old chat stays as it was." }; },
  };
  uploadHooks.pollMs = 20; uploadHooks.log = (...a) => fx.logs.push(a.join(" "));
  // --- upload ---
  const octet = { "Content-Type": "application/octet-stream", Origin: base, "X-Hub-Token": tok, "X-Upload-Name": encodeURIComponent("my pic \u00e9.png") };
  const up = (q, h = octet, body = Buffer.from("PNGDATA")) => raw("/api/upload" + q, h, body, "POST");
  const headersOnly = (path, headers) => new Promise((resolve) => {
    const r = request({ host: HOST, port, path, method: "POST", headers: { Host: `${HOST}:${port}`, ...headers } }, (res) => { let t = ""; res.on("data", (d) => (t += d)); res.on("end", () => resolve({ status: res.statusCode, text: t })); });
    r.on("error", () => resolve({ status: 0, text: "" })); r.flushHeaders();
  });
  const u1 = await up("?chat=new"); const uj = JSON.parse(u1.text);
  ok("upload for a new chat: answers uploadId, kind, name, bytes, mediaType and no path; the store got the raw bytes, the decoded name and chat key 'new'", u1.status === 200 && uj.ok === true && uj.uploadId === "a".repeat(32) && uj.kind === "image" && uj.name === "my pic.png" && uj.bytes === 7 && uj.mediaType === "image/png" && !("path" in uj) && !u1.text.includes("secret") && fx.saves.length === 1 && fx.saves[0].chatKey === "new" && fx.saves[0].name === "my pic \u00e9.png" && fx.saves[0].isBuf && fx.saves[0].len === 7);
  const u2 = JSON.parse((await up("?chat=h-rest")).text);
  ok("upload for a chat the engine knows (h-rest): saved under that chat key", u2.ok === true && fx.saves.length === 2 && fx.saves[1].chatKey === "h-rest");
  const u3 = await up("?chat=h-nosuch");
  ok("upload for an unknown Hub chat: 'Unknown chat.' and nothing saved", u3.status === 200 && JSON.parse(u3.text).ok === false && JSON.parse(u3.text).error === "Unknown chat." && fx.saves.length === 2);
  ok("upload with a bad, missing, path-like or session-like chat is 400 and nothing is saved", (await Promise.all(["?chat=..%5Cx", "?chat=", "", "?chat=18ec7052-3a6a-46cc-ade3-7ff857195e3d", "?chat=h-../x", "?chat=local_abc"].map((q) => up(q).then((r) => r.status)))).every((s) => s === 400) && fx.saves.length === 2);
  const u4 = await up("?chat=new", octet, Buffer.alloc(0));
  ok("upload of an empty file: the store's sentence, status 200", u4.status === 200 && JSON.parse(u4.text).ok === false && JSON.parse(u4.text).error === "The file is empty." && fx.saves.length === 3);
  ok("upload with another content type (text/plain, JSON, multipart) is 415, nothing saved", (await Promise.all(["text/plain", "application/json", "multipart/form-data; boundary=x", ""].map((t) => up("?chat=new", { ...octet, "Content-Type": t }).then((r) => r.status)))).every((s) => s === 415) && fx.saves.length === 3);
  ok("upload without the token, with a wrong token, another Origin or no Origin is 403, nothing saved", (await up("?chat=new", { ...octet, "X-Hub-Token": "" })).status === 403 && (await up("?chat=new", { ...octet, "X-Hub-Token": "y".repeat(tok.length) })).status === 403 && (await up("?chat=new", { ...octet, Origin: "http://evil.example" })).status === 403 && (await up("?chat=new", { "Content-Type": "application/octet-stream", "X-Hub-Token": tok })).status === 403 && fx.saves.length === 3);
  ok("upload from a foreign Host or with sec-fetch-site cross-site is 403", (await up("?chat=new", { ...octet, Host: "evil.example" })).status === 403 && (await up("?chat=new", { ...octet, "Sec-Fetch-Site": "cross-site" })).status === 403 && fx.saves.length === 3);
  const u5 = await headersOnly("/api/upload?chat=new", { ...octet, "Content-Length": String(30 * 1024 * 1024) });
  ok("upload that announces 30 MB is 413 'Files can be at most 10 MB.' from the header alone (no body was sent, nothing saved)", u5.status === 413 && JSON.parse(u5.text).error === "Files can be at most 10 MB." && fx.saves.length === 3);
  const u6 = await up("?chat=new", octet, Buffer.alloc(10 * 1024 * 1024 + 1000, 7));
  ok("upload of 10 MB + 1000 bytes passes this route's limit (the store decides about 10 MB itself); the action limit of 14000 does not apply", u6.status === 200 && fx.saves.length === 4 && fx.saves[3].len === 10 * 1024 * 1024 + 1000);
  const u7 = await up("?chat=new", octet, Buffer.alloc(11 * 1024 * 1024 + 1, 7));
  ok("upload of 11 MB + 1 byte is 413 (announced size over 10.5 MB), nothing saved", (u7.status === 413 || u7.status === 0) && fx.saves.length === 4);
  ok("upload with no Content-Length (chunked) is 411, nothing saved", await new Promise((resolve) => {
    const r = request({ host: HOST, port, path: "/api/upload?chat=new", method: "POST", headers: { Host: `${HOST}:${port}`, ...octet } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode === 411 && fx.saves.length === 4)); });
    r.on("error", () => resolve(false)); r.write("abc"); r.end();
  }));
  ok("upload with a broken file name header is 400, nothing saved", (await up("?chat=new", { ...octet, "X-Upload-Name": "%E0%A4%A" })).status === 400 && fx.saves.length === 4);
  ok("GET, PUT and DELETE on /api/upload are 405", (await fetch(base + "/api/upload?chat=new")).status === 405 && (await fetch(base + "/api/upload?chat=new", { method: "PUT" })).status === 405 && (await fetch(base + "/api/upload?chat=new", { method: "DELETE" })).status === 405);
  ok("the upload log lines name chat key, kind and size only: never the file name", fx.logs.some((l) => l === "upload new ok image 7") && fx.logs.every((l) => !/pic|PNGDATA|\u00e9/.test(l)));
  // --- attachments on chat-answer / chat-start ---
  const ca = (action, o, h = json) => raw("/api/action", h, cj({ action, ...o }), "POST");
  const caJ = async (action, o) => JSON.parse((await ca(action, o)).text);
  const aOk = await caJ("chat-answer", { id: "h-rest", text: "Look", attachments: [I1, I3] });
  ok("chat-answer with attachments passes id, text and the ids to the engine exactly", aOk.ok === true && JSON.stringify(fx.answers[0]) === JSON.stringify({ id: "h-rest", text: "Look", attachments: [I1, I3] }));
  await caJ("chat-answer", { id: "h-rest", text: "Hi" }); await caJ("chat-answer", { id: "h-rest", text: "Hi", attachments: [] });
  ok("chat-answer without attachments (or an empty list) calls the engine exactly as before: no attachments key", JSON.stringify(fx.answers[1]) === '{"id":"h-rest","text":"Hi"}' && JSON.stringify(fx.answers[2]) === '{"id":"h-rest","text":"Hi"}');
  const aEmpty = await caJ("chat-answer", { id: "h-rest", text: "", attachments: [I1] });
  ok("chat-answer with an empty text and a file reaches the engine", aEmpty.ok === true && JSON.stringify(fx.answers[3]) === JSON.stringify({ id: "h-rest", text: "", attachments: [I1] }));
  const nA = fx.answers.length, nS = fx.starts.length;
  const badAtt = [["x"], [5], ["A".repeat(32)], ["1".repeat(31)], ["1".repeat(33)], [null], [I1, I1, I1, I1, I1], "abc", 5, { 0: I1 }, [I1, "../x"], [[I1]]];
  const badRes = await Promise.all(badAtt.map((a) => caJ("chat-answer", { id: "h-rest", text: "x", attachments: a })));
  ok("chat-answer refuses bad attachments (not 32 hex, not a string, 5 ids, not a list) in words, nothing sent", badRes.every((r) => r.ok === false && r.error === "The Hub can not send those attached files. Attach them again.") && fx.answers.length === nA);
  const badRes2 = await Promise.all(badAtt.map((a) => caJ("chat-start", { project: "Hub", task: "x", attachments: a })));
  ok("chat-start refuses the same bad attachments, nothing started", badRes2.every((r) => r.ok === false && r.error === "The Hub can not send those attached files. Attach them again.") && fx.starts.length === nS);
  const sOk = await caJ("chat-start", { project: "Hub", task: "", attachments: [I1], workflow: false });
  ok("chat-start with an empty task and a file reaches the engine with the ids; Remote Control stays false", sOk.ok === true && sOk.id === "h-new1" && JSON.stringify(fx.starts[0]) === JSON.stringify({ project: "Hub", task: "", remoteControl: false, workflow: false, attachments: [I1] }));
  await caJ("chat-start", { project: "Hub", task: "x" });
  ok("chat-start without attachments calls the engine exactly as before: no attachments key", JSON.stringify(fx.starts[1]) === '{"project":"Hub","task":"x","remoteControl":false,"workflow":true}');
  ok("the engine's own refusals are passed on in its words", (await caJ("chat-answer", { id: "h-gone", text: "x", attachments: [I1] })).error === "Unknown chat." && (await caJ("chat-start", { project: "Nope", task: "x", attachments: [I1] })).error === "Unknown project.");
  ok("chat-answer / chat-start with attachments need the token", (await ca("chat-answer", { id: "h-rest", text: "x", attachments: [I1] }, { ...json, "X-Hub-Token": "" })).status === 403 && (await ca("chat-start", { project: "Hub", task: "x", attachments: [I1] }, { ...json, "X-Hub-Token": "" })).status === 403);
  // pictures and PDFs go from the store after the turn; text files stay; a refused message removes nothing
  await sleep(150); fx.removed.length = 0; fx.state = "working";   // earlier answers above were watched while resting: their pictures are already gone
  await caJ("chat-answer", { id: "h-rest", text: "x", attachments: [I1, I2, I3] }); await sleep(120);
  ok("while the turn is still working nothing is removed", fx.removed.length === 0);
  fx.state = "idle"; await sleep(150);
  ok("when the turn has finished the picture and the PDF are removed, the text file stays", fx.removed.slice().sort().join() === [I1, I2].join());
  fx.removed.length = 0; fx.state = "working";
  await caJ("chat-start", { project: "Hub", task: "x", attachments: [I1] }); fx.state = "failed"; await sleep(150);
  ok("a turn that failed removes the picture too (start: the new chat's id is watched)", fx.removed.join() === I1);
  fx.removed.length = 0; fx.state = "idle";
  await caJ("chat-answer", { id: "h-gone", text: "x", attachments: [I1] }); await caJ("chat-answer", { id: "h-rest", text: "x", attachments: [I3] }); await sleep(120);
  ok("a message the engine refused, or one with only a text file, removes nothing", fx.removed.length === 0);
  // --- fork ---
  const fkNo = async (o) => { const n = fx.forks.length; const r = await caJ("chat-fork", o); return r.ok === false && fx.forks.length === n; };
  const f1 = await caJ("chat-fork", { id: "h-rest", name: "Copy", text: "Go" });
  ok("chat-fork passes id, name and text to the engine and answers { ok, id, note }", f1.ok === true && f1.id === "h-fork1" && f1.note === "Made a copy of the chat in Hub. The old chat stays as it was." && JSON.stringify(fx.forks[0]) === '{"id":"h-rest","name":"Copy","text":"Go"}');
  await caJ("chat-fork", { id: "h-rest" });
  ok("chat-fork with only an id passes only the id", JSON.stringify(fx.forks[1]) === '{"id":"h-rest"}');
  const f2 = await caJ("chat-fork", { id: "h-busy" });
  ok("chat-fork shows the engine's refusal in words, with no id", f2.ok === false && f2.error === "This chat is still working. Wait for it to finish before making a copy." && f2.id === undefined);
  ok("chat-fork refuses a missing, non-string, path-like, session-like or link-shaped id", await fkNo({}) && await fkNo({ id: 5 }) && await fkNo({ id: "x" }) && await fkNo({ id: "h-../x" }) && await fkNo({ id: "18ec7052-3a6a-46cc-ade3-7ff857195e3d" }) && await fkNo({ id: "local_abcdef12-3456" }) && await fkNo({ id: "claude://resume?session=x" }));
  ok("chat-fork refuses extra fields (model, cwd, project, attachments)", await fkNo({ id: "h-rest", model: "opus" }) && await fkNo({ id: "h-rest", cwd: "C:\\Windows" }) && await fkNo({ id: "h-rest", project: "Hub" }) && await fkNo({ id: "h-rest", attachments: [I1] }));
  const f3 = await caJ("chat-fork", { id: "h-rest", name: "x".repeat(81) }), f4 = await caJ("chat-fork", { id: "h-rest", text: "x".repeat(4001) });
  ok("chat-fork: a name over 80 and a text over 4000 characters are refused in words; non-text name or text refused", f3.error === "The name must be at most 80 characters." && f4.error === "The first message must be at most 4000 characters." && await fkNo({ id: "h-rest", name: 5 }) && await fkNo({ id: "h-rest", text: 5 }) && (await caJ("chat-fork", { id: "h-rest", name: "x".repeat(80), text: "y".repeat(4000) })).ok === true);
  ok("chat-fork without the token is 403, without confirm is 400, not JSON is 415", (await ca("chat-fork", { id: "h-rest" }, { ...json, "X-Hub-Token": "" })).status === 403 && (await raw("/api/action", json, JSON.stringify({ action: "chat-fork", id: "h-rest" }), "POST")).status === 400 && (await ca("chat-fork", { id: "h-rest" }, { ...json, "Content-Type": "text/plain" })).status === 415);
  ok("fork and attachment refusals are logged without any text", fx.logs.some((l) => l.startsWith("chat-fork ") && l.endsWith("refused: wrong request shape")) && fx.logs.some((l) => l.endsWith("refused: wrong attachments")) && fx.logs.every((l) => !/Look|Copy|\bGo\b/.test(l)));
  chatHooks.engine = realEngine;
  // --- pins (a real pins object on a temp file; never data/pins.json) ---
  const pinTmp = mkdtempSync(join(tmpdir(), "hub-srv-pins-")); let pt = Date.parse("2026-11-21T10:00:00Z");
  pinHooks.pins = makePins({ file: join(pinTmp, "data", "pins.json"), now: () => (pt += 1000) }); const pinLogs = []; pinHooks.log = (...a) => pinLogs.push(a.join(" "));
  const pn = (o, h = json) => raw("/api/action", h, cj({ action: "chat-pin", ...o }), "POST");
  const pnJ = async (o) => JSON.parse((await pn(o)).text);
  const p1 = await pnJ({ chatId: "h-20261121-1", project: "Alpha", pinned: true }), p1b = await pnJ({ chatId: "h-20261121-1", project: "Alpha", pinned: true });
  ok("chat-pin pins a chat ({ ok, pinned, count}); pinning again says already", p1.ok === true && p1.pinned === true && p1.count === 1 && !("already" in p1) && p1b.ok === true && p1b.already === true && p1b.count === 1);
  await pnJ({ chatId: "s-99887766", project: "Beta", pinned: true });
  const gp = await (await fetch(base + "/api/pins")).json(), gpA = await (await fetch(base + "/api/pins?project=Alpha")).json(), gpN = await (await fetch(base + "/api/pins?project=Nope")).json();
  ok("GET /api/pins lists newest first, ?project= filters, an unknown project gives an empty list", gp.pins.length === 2 && gp.pins[0].chatId === "s-99887766" && gp.pins[1].chatId === "h-20261121-1" && gpA.pins.length === 1 && gpA.pins[0].project === "Alpha" && gpN.pins.length === 0 && typeof gp.pins[0].at === "string");
  const p2 = await pnJ({ chatId: "h-20261121-1", project: "Alpha", pinned: false }), p2b = await pnJ({ chatId: "h-20261121-1", project: "Alpha", pinned: false });
  ok("chat-pin pinned:false unpins; unpinning again says already", p2.ok === true && p2.pinned === false && p2.count === 1 && p2b.ok === true && p2b.already === true);
  for (let i = 1; i <= 49; i++) await pnJ({ chatId: "h-20261122-" + i, project: "Alpha", pinned: true });
  const p50 = await pnJ({ chatId: "h-20261123-1", project: "Alpha", pinned: true });
  ok("the 51st pin is refused in words (50 at most), and an unpin makes room again", p50.ok === false && p50.error === "At most 50 pinned chats. Unpin one first." && (await pnJ({ chatId: "h-20261122-1", project: "Alpha", pinned: false })).ok === true && (await pnJ({ chatId: "h-20261123-1", project: "Alpha", pinned: true })).ok === true);
  const pnNo = async (o) => { const r = await pnJ(o); return r.ok === false && r.error === "The Hub can not pin that chat. Look at the page again."; };
  ok("chat-pin refuses a non-boolean pinned, a missing project, extra fields and bad ids, in words", await pnNo({ chatId: "h-1", project: "Alpha", pinned: "yes" }) && await pnNo({ chatId: "h-1", pinned: true }) && await pnNo({ chatId: "h-1", project: "Alpha", pinned: true, cwd: "C:\\x" }) && await pnNo({ chatId: 5, project: "Alpha", pinned: true }) && await pnNo({ chatId: "..\\x", project: "Alpha", pinned: true }) && await pnNo({ chatId: "claude://x", project: "Alpha", pinned: true }) && await pnNo({ chatId: "h-1", project: "..", pinned: true }) && await pnNo({ chatId: "h-1", project: "C:\\x", pinned: true }));
  ok("chat-pin without the token is 403, without confirm 400, from another Origin 403; nothing changes", (await pn({ chatId: "h-5", project: "Alpha", pinned: true }, { ...json, "X-Hub-Token": "" })).status === 403 && (await raw("/api/action", json, JSON.stringify({ action: "chat-pin", chatId: "h-5", project: "Alpha", pinned: true }), "POST")).status === 400 && (await pn({ chatId: "h-5", project: "Alpha", pinned: true }, { ...json, Origin: "http://evil.example" })).status === 403 && !pinHooks.pins.isPinned("h-5"));
  ok("POST and PUT to /api/pins are 405", (await fetch(base + "/api/pins", { method: "POST" })).status === 405 && (await fetch(base + "/api/pins", { method: "PUT" })).status === 405);
  ok("pin log lines carry the chat id and the result only", pinLogs.some((l) => l === "chat-pin h-20261121-1 pinned") && pinLogs.some((l) => l === "chat-pin h-20261121-1 unpinned") && pinLogs.every((l) => !/Alpha|Beta/.test(l)));
  const keepPins = pinHooks.pins; pinHooks.pins = { ...keepPins, isPinned: () => true };
  const pjAll = await (await fetch(base + "/api/project?name=" + encodeURIComponent(firstName))).json();
  pinHooks.pins = { ...keepPins, isPinned: () => false };
  const pjNone = await (await fetch(base + "/api/project?name=" + encodeURIComponent(firstName))).json();
  ok(`GET /api/project: every chat has a pinned flag, true when pinned, false when not (${pjAll.chats.length} chats on this PC's first project)`, pjAll.chats.every((c) => c.pinned === true) && pjNone.chats.every((c) => c.pinned === false) && pjNone.chats.length === pjAll.chats.length);
  pinHooks.pins = keepPins;
  ok("the real data/pins.json was not written by these tests", (existsSync(realPinsFile) ? statSync(realPinsFile).mtimeMs : null) === pinsBefore);
  // --- chat-image: a fake finder that knows ONE chat, with a saved file made here ---
  const imgTmp = mkdtempSync(join(tmpdir(), "hub-srv-img-"));
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake-png-body-1234567890")]);
  const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake-jpeg-body-1234567890")]);
  const imgRow = (i, content) => ({ type: "user", timestamp: new Date(Date.parse("2026-11-20T12:00:00Z") + i * 60000).toISOString(), isSidechain: false, message: { role: "user", content } });
  const blk = (buf, t = "image/png") => ({ type: "image", source: { type: "base64", media_type: t, data: buf.toString("base64") } });
  const imgLines = [imgRow(0, [blk(PNG)]), imgRow(1, [blk(JPG, "image/png")]), imgRow(2, [blk(Buffer.from("text renamed png"))]), imgRow(3, [blk(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'))]), imgRow(4, "just words")].map((r) => JSON.stringify(r));
  const imgFile = join(imgTmp, "chat.jsonl"); wf(imgFile, imgLines.join("\n") + "\n");
  const imgFeed = chatLogLib.parseChat(imgLines.join("\n")).messages;
  const asked = [];
  imageHooks.resolveFile = async (id) => { asked.push(id); return id === "h-img1" ? imgFile : null; };
  ok("the fixture's message and block numbers are what the tests ask for", imgFeed[0].blocks[0].type === "image" && imgFeed[0].blocks[0].m === 0 && imgFeed[1].blocks[0].m === 1 && imgFeed[4].blocks[0].type === "text");
  const ci = async (q, o) => fetch(base + "/api/chat-image" + q, o);
  const c0 = await ci("?id=h-img1&m=0&b=0"); const c0b = Buffer.from(await c0.arrayBuffer());
  ok("chat-image: a PNG comes back byte for byte, with the right type, nosniff, a 5 minute private cache, inline", c0.status === 200 && c0.headers.get("content-type") === "image/png" && c0b.equals(PNG) && c0.headers.get("x-content-type-options") === "nosniff" && c0.headers.get("cache-control") === "private, max-age=300" && c0.headers.get("content-disposition") === "inline" && c0.headers.get("content-length") === String(PNG.length));
  const c1 = await ci("?id=h-img1&m=1&b=0"); const c1b = Buffer.from(await c1.arrayBuffer());
  ok("chat-image: a JPEG labelled as PNG in the file is sent as image/jpeg (the type comes from the bytes)", c1.status === 200 && c1.headers.get("content-type") === "image/jpeg" && c1b.equals(JPG));
  const cu = await ci("?id=h-nosuch&m=0&b=0");
  ok("chat-image: an unknown chat is 404 {error:'unknown chat'}", cu.status === 404 && (await cu.json()).error === "unknown chat");
  ok("chat-image: path tricks, a session id, an empty or missing id are 404, and a 'file' or 'path' in the query changes nothing", (await Promise.all(["?id=..%5C..%5Cx&m=0&b=0", "?id=..%2F..%2Fx&m=0&b=0", "?id=18ec7052-3a6a-46cc-ade3-7ff857195e3d&m=0&b=0", "?id=C%3A%5CWindows&m=0&b=0", "?id=&m=0&b=0", "?m=0&b=0", "?file=" + encodeURIComponent(imgFile) + "&m=0&b=0", "?path=" + encodeURIComponent(imgFile) + "&id=h-nosuch&m=0&b=0"].map((q) => ci(q).then((r) => r.status)))).every((s) => s === 404) && asked.every((id) => !id.includes(imgTmp)));
  ok("chat-image: text bytes labelled PNG and SVG bytes labelled PNG are 415 (never sent)", (await ci("?id=h-img1&m=2&b=0")).status === 415 && (await ci("?id=h-img1&m=3&b=0")).status === 415);
  ok("chat-image: a text block, a wrong message or a wrong block number is 404", (await ci("?id=h-img1&m=4&b=0")).status === 404 && (await ci("?id=h-img1&m=99&b=0")).status === 404 && (await ci("?id=h-img1&m=0&b=9")).status === 404);
  ok("chat-image: bad numbers (negative, fraction, exponent, text, missing) are 400", (await Promise.all(["?id=h-img1&m=-1&b=0", "?id=h-img1&m=1.5&b=0", "?id=h-img1&m=1e3&b=0", "?id=h-img1&m=x&b=0", "?id=h-img1&b=0", "?id=h-img1&m=0"].map((q) => ci(q).then((r) => r.status)))).every((s) => s === 400));
  ok("chat-image: POST, PUT and DELETE are 405; a foreign Host is 403", (await ci("?id=h-img1&m=0&b=0", { method: "POST" })).status === 405 && (await ci("?id=h-img1&m=0&b=0", { method: "PUT" })).status === 405 && (await ci("?id=h-img1&m=0&b=0", { method: "DELETE" })).status === 405 && (await raw("/api/chat-image?id=h-img1&m=0&b=0", { Host: "evil.example" })).status === 403);
  ok("the strict policy already lets the page show same-origin pictures: img-src 'self' is in the header of the page and of the picture", /img-src 'self'/.test(c0.headers.get("content-security-policy") || "") && /img-src 'self'/.test((await fetch(base + "/")).headers.get("content-security-policy") || "") && !/script-src[^;]*(unsafe|data:)/.test(c0.headers.get("content-security-policy") || ""));
  ok("chat-image error answers are small JSON, never the saved file's text", (await (await ci("?id=h-img1&m=2&b=0")).text()).length < 120);
  // demo picture: the generator makes a valid 120x80 PNG; it is served only for a sample chat block that is an image
  {
    const { inflateSync } = await import("node:zlib");
    const dj = { chats: { "h-demo": { messages: [{ blocks: [{ type: "image" }, { type: "text" }] }] } } };
    const dp = demoImage("h-demo", "0", "0", dj); let valid = false;
    try {
      const bb = dp.bytes; let o = 8; const chunks = [];
      while (o < bb.length) { const len = bb.readUInt32BE(o), type = bb.toString("latin1", o + 4, o + 8), data = bb.subarray(o + 8, o + 8 + len); if (bb.readUInt32BE(o + 8 + len) !== crc32(bb.subarray(o + 4, o + 8 + len))) throw new Error("crc"); chunks.push([type, data]); o += 12 + len; }
      valid = chunks.map((c) => c[0]).join() === "IHDR,IDAT,IEND" && chunks[0][1].readUInt32BE(0) === 120 && chunks[0][1].readUInt32BE(4) === 80 && inflateSync(chunks[1][1]).length === (120 * 3 + 1) * 80;
    } catch { valid = false; }
    ok("demo picture: a valid 120x80 PNG (right signature, chunk checksums, data size) for a sample image block", dp.status === 200 && dp.mediaType === "image/png" && valid);
    ok("demo picture: 404 for a text block, a wrong number, an unknown chat or an object-prototype name; 400 for bad numbers", demoImage("h-demo", "0", "1", dj).status === 404 && demoImage("h-demo", "5", "0", dj).status === 404 && demoImage("h-x", "0", "0", dj).status === 404 && demoImage("__proto__", "0", "0", dj).status === 404 && demoImage("constructor", "0", "0", dj).status === 404 && demoImage("h-demo", "-1", "0", dj).status === 400 && demoImage("h-demo", null, "0", dj).status === 400);
  }
  // --demo server: uploads, fork off; pins really toggle in memory; chat-image only for sample image blocks
  ok("--demo: upload and chat-fork say 'Sample data mode: the buttons are switched off.', pins toggle in memory (and show in /api/project), pictures only for sample image blocks", await withDemo(async (db, dt) => {
    const dh = { "Content-Type": "application/json", Origin: db, "X-Hub-Token": dt };
    const dpost = async (o) => (await fetch(db + "/api/action", { method: "POST", headers: dh, body: JSON.stringify({ confirm: true, ...o }) })).json();
    const upR = await fetch(db + "/api/upload?chat=new", { method: "POST", headers: { "Content-Type": "application/octet-stream", Origin: db, "X-Hub-Token": dt, "X-Upload-Name": "a.png" }, body: Buffer.from("PNGDATA") });
    const upJ = await upR.json();
    const forkJ = await dpost({ action: "chat-fork", id: "h-20261116-101500-k3x9" });
    const cl = (await (await fetch(db + "/api/chats")).json()).projects.find((p) => p.chats.length);
    const cid = cl.chats[0].id, proj = cl.project;
    const pin1 = await dpost({ action: "chat-pin", chatId: cid, project: proj, pinned: true });
    const list1 = (await (await fetch(db + "/api/pins")).json()).pins;
    const pg1 = await (await fetch(db + "/api/project?name=" + encodeURIComponent(proj))).json();
    const pin2 = await dpost({ action: "chat-pin", chatId: cid, project: proj, pinned: false });
    const pg2 = await (await fetch(db + "/api/project?name=" + encodeURIComponent(proj))).json();
    const imgU = await fetch(db + "/api/chat-image?id=h-nope&m=0&b=0"), imgP = await fetch(db + "/api/chat-image?id=" + cid + "&m=999&b=0", { method: "POST" });
    let pic = true;   // a sample image block, if the sample file has one: it must come back as a PNG
    const sj = JSON.parse(readFileSync(join(HERE, "demo", "chat-log.json"), "utf8"));
    for (const [id, c] of Object.entries(sj.chats || {})) for (const [mi, m] of (c.messages || []).entries()) for (const [bi, bk] of (m.blocks || []).entries()) if (bk.type === "image" && pic === true) { const r = await fetch(db + `/api/chat-image?id=${id}&m=${mi}&b=${bi}`); const bb = Buffer.from(await r.arrayBuffer()); pic = r.status === 200 && r.headers.get("content-type") === "image/png" && bb.subarray(1, 4).toString() === "PNG"; }
    return upR.status === 200 && upJ.ok === false && upJ.error === "Sample data mode: the buttons are switched off." && forkJ.ok === false && forkJ.error === "Sample data mode: the buttons are switched off."
      && pin1.ok === true && pin1.pinned === true && list1.length === 1 && list1[0].chatId === cid && pg1.chats.find((c) => c.id === cid)?.pinned === true && pg1.chats.filter((c) => c.id !== cid).every((c) => c.pinned === false)
      && pin2.ok === true && pg2.chats.find((c) => c.id === cid)?.pinned === false && (await (await fetch(db + "/api/pins")).json()).pins.length === 0
      && imgU.status === 404 && imgP.status === 405 && pic;
  }));
  ok("--demo: a token-less pin and an upload without the token are refused", await withDemo(async (db) => (await fetch(db + "/api/action", { method: "POST", headers: { "Content-Type": "application/json", Origin: db }, body: JSON.stringify({ action: "chat-pin", chatId: "h-1", project: "A", pinned: true, confirm: true }) })).status === 403 && (await fetch(db + "/api/upload?chat=new", { method: "POST", headers: { "Content-Type": "application/octet-stream", Origin: db }, body: "x" })).status === 403));
  ok("the real data/pins.json was still not written after the demo server ran", (existsSync(realPinsFile) ? statSync(realPinsFile).mtimeMs : null) === pinsBefore);
  const rc = await fetch(base + "/api/chats"); const jc = await rc.json();
  ok("GET /api/chats returns the list shape", rc.status === 200 && Array.isArray(jc.projects) && Number.isFinite(jc.max) && typeof jc.openListOk === "boolean");
  // chat log (Phase 19): a known id from the live list returns the conversation; anything else is 404; no write method works
  const firstChat = jc.projects.flatMap((p) => p.chats)[0];
  if (firstChat) {
    const rl = await fetch(base + "/api/chat-log?id=" + encodeURIComponent(firstChat.id)); const jl = await rl.json();
    ok("GET /api/chat-log?id=<known> returns messages, context and meta", rl.status === 200 && jl.chatId === firstChat.id && Array.isArray(jl.messages) && Number.isInteger(jl.messagesTotal) && typeof jl.hasMore === "boolean" && "percent" in jl.context && jl.meta.kind === firstChat.kind && Array.isArray(jl.meta.outputs));
  } else ok("GET /api/chat-log?id=<known> (no chats on this PC: skipped)", true);
  const rlu = await fetch(base + "/api/chat-log?id=h-20260101-000000-abcd");
  ok("GET /api/chat-log with an unknown id is 404 {error:'unknown chat'}", rlu.status === 404 && (await rlu.json()).error === "unknown chat");
  ok("GET /api/chat-log with a path trick, a Claude session id, an empty or missing id is 404", (await Promise.all(["..%5C..%5Cx", "..%2F..%2Fx", "18ec7052-3a6a-46cc-ade3-7ff857195e3d", "C%3A%5CWindows", ""].map((n) => fetch(base + "/api/chat-log?id=" + n).then((r) => r.status)))).every((s) => s === 404) && (await fetch(base + "/api/chat-log")).status === 404);
  ok("POST and PUT to /api/chat-log are refused", (await fetch(base + "/api/chat-log?id=x", { method: "POST" })).status === 405 && (await fetch(base + "/api/chat-log?id=x", { method: "PUT" })).status === 405);
  ok("chat log in --demo mode: a sample chat returns its sample conversation, an unknown one 404", await (async () => {
    const { createServer: cs } = await import("node:net");
    const spare = await new Promise((d) => { const s = cs(); s.listen(0, HOST, () => { const p = s.address().port; s.close(() => d(p)); }); });
    const kid = spawn(process.execPath, [fileURLToPath(import.meta.url), "--demo"], { env: { ...process.env, HUB_PORT: String(spare) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    try {
      await new Promise((d, no) => { let t = ""; const to = setTimeout(() => no(new Error("demo server did not start")), 15000); kid.stdout.on("data", (x) => { t += x; if (t.includes("Ready.")) { clearTimeout(to); d(); } }); });
      const db = `http://${HOST}:${spare}`;
      const r = await fetch(db + "/api/chat-log?id=h-20261116-101500-k3x9"); const j = await r.json();
      const p = await (await fetch(db + "/api/chat-log?id=h-20261116-101500-k3x9&before=2&limit=1")).json();
      return r.status === 200 && j.demo === true && j.messages.length >= 4 && j.messages.some((m) => m.blocks.some((b) => b.type === "tool")) && j.context.percent === 64 && j.meta.outputs.length > 0
        && p.messages.length === 1 && p.messages[0].i === 1 && p.hasMore === true && (await fetch(db + "/api/chat-log?id=h-nope")).status === 404;
    } catch { return false; } finally { kid.kill(); }
  })());
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
