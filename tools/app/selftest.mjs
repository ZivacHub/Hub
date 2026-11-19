// Self-test of the Hub app (step 16.1). Plain Node:  node tools/app/selftest.mjs   (or `npm run selftest` in tools/app)
// 1. checks the pure rules (port, server flags, Hub origin, claude:// allow-list) without opening anything;
// 2. starts the real app (electron.exe) in self-test mode on port 4792 with sample data (--demo) and reads its OK/FAIL lines;
// 2b. (16.2) when the app says READY_FOR_SECOND_INSTANCE this runner starts a second electron.exe with the same profile and checks
//     it exits by itself within a few seconds while the first one shows its window again;
// 3. checks afterwards that the app exited with 0, the sample dashboard it started is gone, and no Electron process was left behind.
// 16.3: part 1 also tests, with a FAKE dashboard on a spare port, the quit that stops what the Hub started (stopHubProjects,
// quitSequence), the --hidden flag and --boot rule, and the icon menu with a FAKE login item; part 2 starts the app with
// --hidden and ends with a real quit through the app. No test writes the real start-up entry (registry) or touches the Startup folder.
// A Hub window shows briefly (sample data only). It never touches the real dashboard on 4780 and never opens a real chat.
// Optional: HUB_APP_SHOT=<path.png> saves one screenshot of the window. Exit code 0 = everything passed.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowedChatLink, isHubOrigin, isOtherLocalPortLink, parsePort, parseServerArgs } from "./lib/rules.mjs";
import { buildTrayTemplate } from "./lib/traymenu.mjs";
import { findOrStartServer, pageAnswers } from "./lib/server.mjs";
import { countRunning, countWaiting, quitSequence, stopHubProjects } from "./lib/projects.mjs";
import { loginItemOptions, makeStartupMenu, oldStartupEntryPath, parseAppFlags, startPlan, waitingLabel } from "./lib/startup.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ELECTRON = join(HERE, "node_modules", "electron", "dist", "electron.exe");
const PORT = 4792;
const EXPECTED_APP_CHECKS = 73; // (16.3; was 59) OK lines the app prints when every check runs (screenshot line only with HUB_APP_SHOT)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else fail++; console.log(`${cond ? "OK" : "FAIL"} ${name}`); };

// ---------- 1. pure rules
ok("rules: HUB_PORT default 4780, '4792' -> 4792, junk refused", parsePort(undefined) === 4780 && parsePort("") === 4780 && parsePort("4792") === 4792 && parsePort("0") === null && parsePort("70000") === null && parsePort("4780; calc") === null && parsePort("-1") === null);
ok("rules: HUB_APP_ARGS keeps --demo/--demo-x=y, drops --open, --selftest, --boot (16.3: only the app adds it) and non-flags", JSON.stringify(parseServerArgs(" --demo  --boot --boot=1 --demo-chats=empty --open --selftest x & calc --a=b;c ")) === JSON.stringify(["--demo", "--demo-chats=empty"]) && parseServerArgs(undefined).length === 0);
ok("rules: Hub origin is exactly http://127.0.0.1:PORT", isHubOrigin("http://127.0.0.1:4792/helpers.html", 4792) && !isHubOrigin("http://localhost:4792/", 4792) && !isHubOrigin("http://127.0.0.1:4780/", 4792) && !isHubOrigin("https://127.0.0.1:4792/", 4792) && !isHubOrigin("http://127.0.0.1.evil.com:4792/", 4792) && !isHubOrigin("not a url", 4792));
ok("rules: the three claude:// chat links are allowed", ["claude://claude.ai/epitaxy/local_abc", "claude://code/new?q=Hi&folder=C%3A%5Cx", "claude://resume?session=0000"].every(isAllowedChatLink));
ok("rules: everything else is refused", ["claude://evil/", "claude://claude.ai/epitaxy/remote_x", "claude://claude.ai/epitaxy/local_", "claude://code/new", "claude://code/newx?", "claude://resume?sessionX=1", "CLAUDE://code/new?x", "file:///C:/x", "https://claude.ai/", "claude://code/new?q=a b", "claude://code/new?q=\"x", "claude://code/new?" + "a".repeat(5000), null, 5].every((u) => !isAllowedChatLink(u)));

ok("rules: another local port (127.0.0.1 or localhost, http, 1024-65535, not the Hub's) goes to the browser", ["http://127.0.0.1:5057/", "http://localhost:5058/x?y=1", "http://127.0.0.1:65535/", "http://127.0.0.1:1024/"].every((u) => isOtherLocalPortLink(u, 4780)));
ok("rules: the Hub's own port, wrong scheme, low or missing port, credentials, other hosts are not 'other local port' links", ["http://127.0.0.1:4780/", "http://localhost:4780/", "https://127.0.0.1:1234/", "http://127.0.0.1:80/", "http://127.0.0.1/", "http://127.0.0.1:1023/", "http://127.0.0.1:65536/", "http://user@127.0.0.1:5000/", "http://user:pw@localhost:5000/", "http://example.com/", "http://example.com:5000/", "http://127.0.0.1.evil.com:5000/", "http://0.0.0.0:5000/", "claude://code/new?x", "javascript:alert(1)", "nonsense", null, 5].every((u) => !isOtherLocalPortLink(u, 4780)));
{
  const calls = [];
  const plain = buildTrayTemplate({ onOpen: () => calls.push("open"), onQuit: () => calls.push("quit") });
  plain[0].click(); plain[2].click();
  ok("tray menu: exactly 'Open Hub', separator, 'Quit Hub'; the items call the open and quit handlers", plain.length === 3 && plain[0].label === "Open Hub" && plain[1].type === "separator" && plain[2].label === "Quit Hub" && calls.join() === "open,quit");
  const withExtras = buildTrayTemplate({ onOpen() {}, onQuit() {}, extras: [{ label: "A" }, { label: "B" }] });
  ok("tray menu: extras (16.3) sit between Open Hub and Quit Hub", withExtras.map((i) => i.label || i.type).join() === "Open Hub,separator,A,B,separator,Quit Hub");
}

// ---------- 1b. (16.3) quit stops what the Hub started: a FAKE dashboard on a spare port records every request
{
  const TOKEN = "fake-token-123";
  let runtimeItems = [], postDelay = 0, dropIds = new Set(), sessionOk = true;
  const reqs = [];
  const fakeDash = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    reqs.push({ method: req.method, url: req.url, headers: req.headers, body });
    const json = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.method === "GET" && req.url === "/api/runtime") return json(200, { demo: false, items: runtimeItems });
    if (req.method === "GET" && req.url === "/api/session") return sessionOk ? json(200, { token: TOKEN, demo: false }) : json(500, {});
    if (req.method === "POST" && req.url === "/api/action") {
      let b = {}; try { b = JSON.parse(body); } catch { /* bad */ }
      if (postDelay) await sleep(postDelay);
      if (dropIds.has(b.id)) { req.socket.destroy(); return; } // a project whose stop breaks the connection
      if (b.id === "fails") return json(200, { ok: false, error: "Windows could not stop it." });
      return json(200, { ok: true, message: `${b.id} stopped.` });
    }
    json(404, {});
  });
  await new Promise((r) => fakeDash.listen(0, "127.0.0.1", r));
  const fport = fakeDash.address().port, forigin = `http://127.0.0.1:${fport}`;
  const posts = () => reqs.filter((r) => r.method === "POST");

  runtimeItems = [
    { id: "fails", status: "running", startedByHub: true }, { id: "outside", status: "running", startedByHub: false },
    { id: "breaks", status: "running", startedByHub: true }, { id: "ours", status: "starting", startedByHub: true },
    { id: "bad id & calc", status: "running", startedByHub: true }, { id: "stopped", status: "stopped", startedByHub: false },
  ];
  dropIds = new Set(["breaks"]);
  const lines = [];
  const r1 = await stopHubProjects({ port: fport, limitMs: 5000, log: (t) => lines.push(t) });
  ok("quit: the runtime list and the session token are fetched first (GET /api/runtime, GET /api/session)", reqs[0]?.url === "/api/runtime" && reqs[1]?.url === "/api/session");
  ok("quit: 'stop' is posted only for projects with startedByHub true (not the outside one, not a strange id), in list order", JSON.stringify(posts().map((p) => JSON.parse(p.body).id)) === JSON.stringify(["fails", "breaks", "ours"]));
  ok("quit: every stop sends Origin = the Hub origin, X-Hub-Token, JSON type and { action: 'stop', id, confirm: true }", posts().length === 3 && posts().every((p) => p.headers.origin === forigin && p.headers["x-hub-token"] === TOKEN && p.headers["content-type"] === "application/json" && !p.headers["sec-fetch-site"] && (() => { const b = JSON.parse(p.body); return b.action === "stop" && b.confirm === true && Object.keys(b).length === 3; })()));
  ok("quit: a project that fails and one whose connection breaks do not stop the rest ('ours' still stopped)", JSON.stringify(r1.stopped) === JSON.stringify(["ours"]) && r1.failed.length === 2 && r1.failed[0].id === "fails" && r1.failed[0].error === "Windows could not stop it." && r1.failed[1].id === "breaks" && r1.ok === false && r1.timedOut === false);
  ok("quit: one log line per project, no token in the log", lines.length === 3 && lines[0] === "stop fails failed: Windows could not stop it." && lines[1].startsWith("stop breaks failed:") && lines[2] === "stop ours ok" && !lines.join().includes(TOKEN));

  reqs.length = 0; lines.length = 0;
  runtimeItems = [{ id: "outside", status: "running", startedByHub: false }];
  const r2 = await stopHubProjects({ port: fport, log: (t) => lines.push(t) });
  ok("quit: nothing started by the Hub -> no token asked, nothing posted, one log line", r2.reason === "nothing-to-stop" && reqs.length === 1 && posts().length === 0 && lines.length === 1);

  reqs.length = 0; lines.length = 0; sessionOk = false;
  runtimeItems = [{ id: "ours", status: "running", startedByHub: true }];
  const r3 = await stopHubProjects({ port: fport, log: (t) => lines.push(t) });
  ok("quit: no session token -> nothing posted, the project counted as failed and logged", r3.reason === "no-token" && posts().length === 0 && r3.failed.length === 1 && lines.length === 1);
  sessionOk = true;

  reqs.length = 0; lines.length = 0; postDelay = 3000;
  runtimeItems = [{ id: "slow1", status: "running", startedByHub: true }, { id: "slow2", status: "running", startedByHub: true }];
  const t0 = Date.now();
  const r4 = await stopHubProjects({ port: fport, limitMs: 800, log: (t) => lines.push(t) });
  const took = Date.now() - t0;
  ok(`quit: the time limit is kept (limit 0.8 s, a stop that takes 3 s): returned after ${took} ms, both counted as not stopped, the second not even tried`, took < 1600 && r4.timedOut === true && r4.reason === "time-limit" && r4.stopped.length === 0 && r4.failed.map((f) => f.id).join() === "slow1,slow2" && posts().length === 1 && lines.length === 2);
  postDelay = 0;

  await new Promise((r) => { fakeDash.closeAllConnections?.(); fakeDash.close(r); });
  lines.length = 0;
  const t1 = Date.now();
  const r5 = await stopHubProjects({ port: fport, log: (t) => lines.push(t) });
  ok(`quit: a dashboard that is gone -> no error, nothing to do, one log line (${Date.now() - t1} ms)`, r5.reason === "dashboard-gone" && r5.ok === false && Date.now() - t1 < 6000 && lines.length === 1);
  ok("menu: the running count is null (shown as 'unknown') when the dashboard is gone", (await countRunning({ port: fport })) === null);

  // the quit order: projects first (attached or own dashboard), the dashboard only when the app started it, each part bounded
  const order = [];
  const sp = async () => { order.push("projects"); return { ok: true }; }, ss = async () => { order.push("server"); return true; };
  const qa = await quitSequence({ server: { ok: true, ownsServer: false }, stopProjects: sp, stopServer: ss });
  ok("quit order, attached dashboard: its projects are stopped, the dashboard itself is left running", order.join() === "projects" && qa.serverStopped === null && qa.timedOut === false);
  order.length = 0;
  const qo = await quitSequence({ server: { ok: true, ownsServer: true }, stopProjects: sp, stopServer: ss });
  ok("quit order, own dashboard: projects first, then the dashboard", order.join() === "projects,server" && qo.serverStopped === true);
  order.length = 0;
  const t2 = Date.now();
  const qh = await quitSequence({ server: { ok: true, ownsServer: true }, stopProjects: () => new Promise(() => {}), stopServer: ss, projectsMs: 300 });
  ok(`quit order: a project stop that hangs is given up after its limit and the own dashboard is still stopped (${Date.now() - t2} ms)`, qh.timedOut === true && order.join() === "server" && Date.now() - t2 < 1500);
  order.length = 0;
  const qn = await quitSequence({ server: null, stopProjects: sp, stopServer: ss });
  const qt = await quitSequence({ server: { ok: true, ownsServer: true }, stopProjects: () => { throw new Error("boom"); }, stopServer: ss });
  ok("quit order: no dashboard -> nothing to do; a stop that throws does not block the rest", qn.projects === null && qn.serverStopped === null && qt.projects?.ok === false && qt.serverStopped === true);
}

// ---------- 1c. (16.3) the --hidden flag and the --boot rule
{
  ok("--hidden: only the exact flag counts, argv[0] (the program) is skipped", parseAppFlags(["electron.exe", "C:\\Hub\\tools\\app", "--hidden"]).hidden === true && parseAppFlags(["Hub.exe", "--hidden"]).hidden === true && !parseAppFlags(["electron.exe", "C:\\Hub\\tools\\app"]).hidden && !parseAppFlags(["electron.exe", "--hidden=1"]).hidden && !parseAppFlags(["electron.exe", "--HIDDEN"]).hidden && !parseAppFlags(["--hidden"]).hidden && !parseAppFlags(undefined).hidden);
  const ph = startPlan({ argv: ["electron.exe", "app", "--hidden"], envArgs: ["--demo"] }), pn = startPlan({ argv: ["electron.exe", "app"], envArgs: ["--demo", "--boot"] });
  ok("--hidden: no visible window, server args get --boot; a normal start shows the window and never has --boot (even if it sneaked into the list)", ph.hidden && ph.showWindow === false && JSON.stringify(ph.serverArgs) === '["--demo","--boot"]' && !pn.hidden && pn.showWindow === true && JSON.stringify(pn.serverArgs) === '["--demo"]');
  const spawned = [];
  const fakeChild = () => { const c = new EventEmitter(); c.pid = 4242; c.exitCode = null; c.signalCode = null; c.kill = () => { c.exitCode = 0; c.emit("exit", 0); return true; }; return c; };
  const spySpawn = (cmd, a) => { spawned.push([cmd, ...a]); return fakeChild(); };
  let calls = 0;
  const upAfterSpawn = async () => { calls++; if (!spawned.length) throw new Error("refused"); return { status: 200, body: null }; };
  const own = await findOrStartServer({ port: 1, hubDir: join(HERE, "..", ".."), serverArgs: ph.serverArgs, spawnFn: spySpawn, fetchFn: upAfterSpawn, pollMs: 10, waitMs: 2000 });
  ok("--hidden, the app starts its own dashboard: the server command carries --boot", own.ok && own.ownsServer && spawned.length === 1 && spawned[0][0] === "node" && spawned[0].at(-1) === "--boot" && spawned[0].includes("--demo"));
  spawned.length = 0;
  const att = await findOrStartServer({ port: 1, hubDir: join(HERE, "..", ".."), serverArgs: ph.serverArgs, spawnFn: spySpawn, fetchFn: async () => ({ status: 200, body: null }) });
  ok("--hidden, a dashboard already runs (attach): nothing is started, so --boot goes nowhere", att.ok && att.ownsServer === false && spawned.length === 0);
  const norm = await findOrStartServer({ port: 1, hubDir: join(HERE, "..", ".."), serverArgs: pn.serverArgs, spawnFn: spySpawn, fetchFn: upAfterSpawn, pollMs: 10, waitMs: 2000 });
  ok("normal start, own dashboard: no --boot on the server command", norm.ok && spawned.length === 1 && !spawned[0].includes("--boot") && calls > 0);
}

// ---------- 1d. (16.3) the icon menu: Start with Windows (FAKE login item, never the real registry), Projects running, old entry
{
  const fake = { on: false, executable: undefined, gets: [], sets: [], get(o) { this.gets.push(o); return { openAtLogin: this.on, executableWillLaunchAtLogin: this.executable ?? this.on }; }, set(s) { this.sets.push(s); this.on = !!s.openAtLogin; } };
  let extras = null, count = 2, oldThere = false;
  const appDir = "C:\\Hub\\tools\\app", exe = "C:\\Hub\\tools\\app\\node_modules\\electron\\dist\\electron.exe";
  const m = makeStartupMenu({ loginItems: fake, execPath: exe, appDir, oldEntryPath: "C:\\fake\\Startup\\Hub Dashboard.lnk", exists: (p) => oldThere && p === "C:\\fake\\Startup\\Hub Dashboard.lnk", countFn: async () => count, setExtras: (x) => { extras = x; }, refreshMs: 60 });
  m.start(); await sleep(30);
  const labels = () => (extras || []).map((i) => i.label);
  const box = () => (extras || []).find((i) => i.label === "Start with Windows");
  ok("menu: 'Start with Windows' is a checkbox showing the (fake) real state: unticked", box()?.type === "checkbox" && box().checked === false);
  ok("menu: 'Projects running: 2' is a greyed-out (disabled) line; no old-entry line when the old shortcut is not there", JSON.stringify(labels()) === '["Start with Windows","Projects running: 2"]' && extras[1].enabled === false);
  ok("menu: get uses the same path and args as set will (electron.exe, [app folder, --hidden])", fake.gets.length > 0 && fake.gets.every((g) => g.path === exe && JSON.stringify(g.args) === JSON.stringify([appDir, "--hidden"])));
  ok("menu: opening and refreshing never writes the start-up entry (no set call)", fake.sets.length === 0);
  const tpl = buildTrayTemplate({ onOpen() {}, onQuit() {}, extras });
  ok("menu: the whole icon menu is Open Hub, Start with Windows, Projects running: 2, Quit Hub", tpl.filter((i) => i.type !== "separator").map((i) => i.label).join("|") === "Open Hub|Start with Windows|Projects running: 2|Quit Hub");
  box().click();
  ok("menu: clicking it calls the FAKE setter exactly once with { openAtLogin: true, path: electron.exe, args: [app folder, '--hidden'], name: 'Hub' }", fake.sets.length === 1 && JSON.stringify(fake.sets[0]) === JSON.stringify({ openAtLogin: true, path: exe, args: [appDir, "--hidden"], name: "Hub" }));
  ok("menu: after the click it shows ticked (read back), a second click switches it off again (one more call)", box().checked === true && (box().click(), fake.sets.length === 2 && fake.sets[1].openAtLogin === false && box().checked === false));
  fake.on = true; fake.executable = false; m.redraw();
  ok("menu: an entry switched off in Task Manager (openAtLogin true, will not launch) shows unticked", box().checked === false);
  fake.executable = undefined; fake.on = false;
  count = 4; await sleep(200);
  ok("menu: the running count is refreshed by the timer (now 'Projects running: 4')", labels().includes("Projects running: 4"));
  oldThere = true; await m.refresh();
  ok("menu: the old-entry line appears only when the old shortcut exists, disabled", labels().at(-1) === "Old start-up entry found: run Remove Hub Autostart.bat" && extras.at(-1).enabled === false);
  count = null; await m.refresh();
  ok("menu: dashboard not answering -> 'Projects running: unknown (dashboard not answering)'", labels()[1] === "Projects running: unknown (dashboard not answering)");
  m.stop();
  // "Waiting on you" line (Ivan 2026-11-19): decisions + chats that need him, from fake answers only
  ok("waiting label: wording for nothing / one / many / unknown / no counter", waitingLabel({ decisions: 0, chats: 0 }) === "Waiting on you: nothing" && waitingLabel({ decisions: 1, chats: 0 }) === "Waiting on you: 1 decision" && waitingLabel({ decisions: 2, chats: 1 }) === "Waiting on you: 2 decisions, 1 chat" && waitingLabel({ decisions: 0, chats: 3 }) === "Waiting on you: 3 chats" && waitingLabel(null) === "Waiting on you: unknown (dashboard not answering)" && waitingLabel(undefined) === null);
  const jsonRes = (o) => ({ status: 200, json: async () => o, body: null });
  const fakeFetch = async (url) => jsonRes(String(url).endsWith("/api/projects") ? { projects: [{ decisionsWaiting: 2 }, { decisionsWaiting: 0 }, { decisionsWaiting: 1 }, { decisionsWaiting: "x" }] } : { items: [{}, {}] });
  const w = await countWaiting({ port: 4780, fetchFn: fakeFetch });
  ok("countWaiting: sums the decisions of every card and counts the chats that need him (fake dashboard)", w && w.decisions === 3 && w.chats === 2);
  ok("countWaiting: a dashboard that does not answer -> null", (await countWaiting({ port: 4780, fetchFn: async () => { throw new Error("down"); } })) === null);
  let wnow = { decisions: 1, chats: 2 }, extras2 = null;
  const m2 = makeStartupMenu({ loginItems: fake, execPath: exe, appDir, oldEntryPath: null, exists: () => false, countFn: async () => 1, waitFn: async () => wnow, setExtras: (x) => { extras2 = x; }, refreshMs: 60 });
  m2.start(); await sleep(40);
  ok("menu with a counter: 'Waiting on you: 1 decision, 2 chats' is a greyed-out line under 'Projects running'", extras2?.map((i) => i.label).join("|") === "Start with Windows|Projects running: 1|Waiting on you: 1 decision, 2 chats" && extras2[2].enabled === false);
  wnow = { decisions: 0, chats: 0 }; await sleep(150);
  ok("menu with a counter: the line follows the timer (now 'nothing')", extras2?.at(-1).label === "Waiting on you: nothing");
  m2.stop();
  ok("menu: a path with spaces is quoted on the Run line, the same for get and set", JSON.stringify(loginItemOptions({ execPath: exe, appDir: "C:\\My Hub\\tools\\app" }).args) === JSON.stringify(['"C:\\My Hub\\tools\\app"', "--hidden"]));
  ok("menu: the old entry is looked for at %APPDATA%\\...\\Startup\\Hub Dashboard.lnk (read-only check)", oldStartupEntryPath({ APPDATA: "C:\\Users\\x\\AppData\\Roaming" }) === "C:\\Users\\x\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Hub Dashboard.lnk" && oldStartupEntryPath({}) === null);
  // the real setter: in the code it is reached only from the non-self-test branch, and no helper file calls it
  const mainSrc = readFileSync(join(HERE, "main.mjs"), "utf8");
  const libCalls = ["lib/startup.mjs", "lib/projects.mjs", "lib/tray.mjs", "lib/traymenu.mjs", "lib/server.mjs", "lib/rules.mjs"].filter((f) => /\.setLoginItemSettings\s*\(/.test(readFileSync(join(HERE, f), "utf8")));
  ok("code: app.setLoginItemSettings( appears once in main.mjs, in the non-self-test wrapper; self-test mode installs a guard; no lib file calls it", (mainSrc.match(/app\.setLoginItemSettings\s*\(/g) || []).length === 1 && /const loginItems = SELFTEST \? fakeLoginItems : \{/.test(mainSrc) && mainSrc.includes("guard.selftestGuard = true;") && mainSrc.includes("app.setLoginItemSettings = guard;") && libCalls.length === 0);
}

// ---------- 2. the real app, self-test mode
const electronPids = () => {
  try { return new Set(execFileSync("tasklist", ["/FI", "IMAGENAME eq electron.exe", "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/).map((l) => l.split('","')[1]).filter((p) => /^\d+$/.test(p || ""))); } catch { return new Set(); }
};
const pidAlive = (pid) => {
  try { return execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true }).includes(`"${pid}"`); } catch { return false; }
};

if (!existsSync(ELECTRON)) {
  ok("Electron is installed (run npm install in tools/app, then node node_modules/electron/install.js)", false);
} else if (await pageAnswers(PORT)) {
  ok(`port ${PORT} is free before the test (something already answers there; stop it first)`, false);
} else {
  const before = electronPids();
  const env = { ...process.env, HUB_APP_SELFTEST: "1", HUB_PORT: String(PORT), HUB_APP_ARGS: "--demo" };
  delete env.ELECTRON_RUN_AS_NODE; delete env.HUB_APP_DEVTOOLS;
  // 16.3: started like the start-with-Windows entry starts it: electron.exe <app folder> --hidden
  const child = spawn(ELECTRON, [HERE, "--hidden"], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: false });
  let out = "";
  let shown = 0; // echo the app's lines as they come, whole lines only
  const echo = (flush) => { const parts = out.slice(shown).split(/\r?\n/); const ready = flush ? parts : parts.slice(0, -1); for (const l of ready) if (l.trim()) console.log(`  app: ${l}`); shown = flush ? out.length : out.length - parts[parts.length - 1].length; };
  let second = null; // the second start: { code, ms }
  const startSecond = () => {
    if (second) return; second = { code: undefined, ms: null, pending: true };
    const t0 = Date.now();
    const c2 = spawn(ELECTRON, [HERE], { env, stdio: "ignore", windowsHide: true });
    const kill = setTimeout(() => { try { c2.kill(); } catch { /* gone */ } }, 15000);
    c2.on("exit", (c) => { clearTimeout(kill); second.code = c; second.ms = Date.now() - t0; second.pending = false; });
  };
  child.stdout.on("data", (d) => { out += d; if (out.includes("READY_FOR_SECOND_INSTANCE")) startSecond(); echo(false); });
  child.stderr.on("data", (d) => { out += d; });
  const code = await new Promise((resolve) => {
    const t = setTimeout(() => { try { child.kill(); } catch { /* gone */ } resolve("timeout"); }, 120000);
    child.on("exit", (c) => { clearTimeout(t); resolve(c); });
  });
  await sleep(100); echo(true);
  const lines = out.split(/\r?\n/);
  const appOk = lines.filter((l) => l.startsWith("OK ")).length, appFail = lines.filter((l) => l.startsWith("FAIL ")).length;
  const done = lines.find((l) => l.startsWith("SELFTEST DONE"));
  const want = EXPECTED_APP_CHECKS + (process.env.HUB_APP_SHOT ? 1 : 0);
  ok(`the app ran its checks: ${appOk} OK, ${appFail} FAIL (expected ${want} OK, 0 FAIL)`, appOk === want && appFail === 0 && done === `SELFTEST DONE pass=${appOk} fail=0`);
  ok("the app exited by itself with code 0", code === 0);
  ok(`a second start of the Hub exited by itself with code 0 within 10 s (${second?.ms ?? "never ran"} ms) and the first one reported it`, !!second && second.pending === false && second.code === 0 && second.ms < 10000 && lines.includes("SECOND_INSTANCE shown"));
  const serverPid = Number((lines.find((l) => l.startsWith("SERVER_PID ")) || "").slice(11)) || null;
  let left = true;
  for (let i = 0; i < 20 && left; i++) { left = (await pageAnswers(PORT, { timeoutMs: 500 })) || (serverPid !== null && pidAlive(serverPid)); if (left) await sleep(250); }
  ok(`the sample dashboard the app started (pid ${serverPid}) is gone and port ${PORT} no longer answers`, serverPid !== null && !left);
  let extra = [];
  for (let i = 0; i < 20; i++) { extra = [...electronPids()].filter((p) => !before.has(p)); if (!extra.length) break; await sleep(250); }
  ok("no Electron process was left behind", extra.length === 0);
  if (extra.length) console.log(`  left behind: electron pids ${extra.join(", ")}`);
}

console.log(`${fail ? "FAIL" : "PASS"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
