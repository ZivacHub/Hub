// Runs INSIDE the Electron app when HUB_APP_SELFTEST=1 (started by tools/app/selftest.mjs; sample data on port 4792 only).
// Prints one line per check, "OK name" or "FAIL name", then "SELFTEST DONE pass=N fail=M" and exits 0 (all passed) or 1.
// It never opens a real chat: every claude:// hand-off goes to a fake opener that only records the link.
import { app, BrowserWindow, screen, session } from "electron";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { hubUrl } from "./lib/rules.mjs";
import { findOrStartServer, pageAnswers } from "./lib/server.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SELFTEST_PORT = 4792;

export async function runSelfTest({ state, lockDownSession, createWindow, stopOwnedServer, port, serverArgs, hubDir, serverLog }) {
  let pass = 0, fail = 0;
  const ok = (name, cond) => { if (cond) pass++; else fail++; console.log(`${cond ? "OK" : "FAIL"} ${name}`); };
  const finish = async (code) => {
    try { state.window?.destroy(); } catch { /* already gone */ }
    if (state.server?.ownsServer) {
      await stopOwnedServer();
      let gone = false;
      for (let i = 0; i < 20 && !gone; i++) { gone = !(await pageAnswers(port, { timeoutMs: 500 })); if (!gone) await sleep(250); }
      ok("the dashboard the app started is stopped when the app quits (port no longer answers)", gone);
    }
    console.log(`SELFTEST DONE pass=${pass} fail=${fail}`);
    app.exit(code ?? (fail ? 1 : 0));
  };
  const watchdog = setTimeout(() => { ok("self-test finished within 90 seconds", false); finish(1); }, 90000);

  try {
    // ---- 0. only ever the sample-data test port
    if (port !== SELFTEST_PORT || !serverArgs.includes("--demo")) { ok(`self-test runs only with HUB_PORT=${SELFTEST_PORT} and HUB_APP_ARGS=--demo`, false); clearTimeout(watchdog); return finish(1); }

    // ---- 1. attach case: something already answers -> attach, start nothing
    const fake = createServer((req, res) => { res.writeHead(req.url === "/" ? 200 : 404); res.end("fake hub"); });
    await new Promise((r) => fake.listen(0, "127.0.0.1", r));
    const fakePort = fake.address().port;
    const spawned = [];
    const spySpawn = (...a) => { spawned.push(a); throw new Error("must not spawn"); };
    const att = await findOrStartServer({ port: fakePort, hubDir, serverArgs: ["--demo"], spawnFn: spySpawn });
    ok("attach: a page that already answers 200 is used (ownsServer false)", att.ok === true && att.ownsServer === false && att.child === null && att.url === `http://127.0.0.1:${fakePort}/`);
    ok("attach: no node process was spawned", spawned.length === 0);
    await new Promise((r) => fake.close(r));

    // ---- 2. Node missing -> the plain sentence, no stack trace
    const enoentSpawn = () => { const c = new EventEmitter(); c.pid = undefined; c.exitCode = null; c.signalCode = null; c.kill = () => true; process.nextTick(() => c.emit("error", Object.assign(new Error("spawn node ENOENT"), { code: "ENOENT" }))); return c; };
    const deadFetch = async () => { throw new Error("connection refused"); };
    const nm = await findOrStartServer({ port: 1, hubDir, spawnFn: enoentSpawn, fetchFn: deadFetch, pollMs: 20, waitMs: 3000 });
    ok("Node missing: plain message 'Node.js was not found on this PC, so the Hub cannot start.'", nm.ok === false && nm.reason === "node-missing" && nm.message === "Node.js was not found on this PC, so the Hub cannot start.");

    // ---- 3. start the sample-data dashboard on 4792 (must not already be running there)
    ok(`port ${port} was free before the test`, !(await pageAnswers(port)));
    lockDownSession(session.defaultSession);
    const started = await findOrStartServer({ port, hubDir, serverArgs, logFile: serverLog });
    state.server = started.ok ? started : null;
    ok(`the app started the sample-data dashboard itself (ownsServer true, --demo, port ${port})`, started.ok === true && started.ownsServer === true && Number.isInteger(started.pid));
    if (started.ok) console.log(`SERVER_PID ${started.pid}`);
    if (!started.ok) { console.log(`(reason: ${started.reason})`); clearTimeout(watchdog); return finish(1); }

    // ---- 4. the window
    const opened = [];
    const win = createWindow({ port, openExternal: (url) => { opened.push(url); }, showInactive: true });
    await new Promise((resolve) => { if (!win.webContents.isLoading()) resolve(); else win.webContents.once("did-finish-load", resolve); });
    const wc = win.webContents;
    const js = (code, gesture = false) => wc.executeJavaScript(code, gesture);
    const origin = hubUrl(port);
    ok("the window loaded the Hub page (title 'Hub')", (await js("document.title")) === "Hub" && win.getTitle() === "Hub");
    ok(`the window's address is exactly ${origin}`, wc.getURL() === origin);
    let demo = false;
    for (let i = 0; i < 40 && !demo; i++) { demo = await js("(() => { const t = document.getElementById('demo-tag'); return !!t && t.hidden === false; })()"); if (!demo) await sleep(250); }
    ok("the page shows sample data (the 'Sample data' tag is visible)", demo);
    ok("no menu bar", win.isMenuBarVisible() === false);
    const sz = win.getSize(), min = win.getMinimumSize();
    console.log(`(window size ${sz[0]}x${sz[1]}, smallest ${min[0]}x${min[1]}, screen work area ${JSON.stringify(screen.getDisplayMatching(win.getBounds()).workAreaSize)})`);
    // Windows display scaling can round the size by a pixel or two (seen: 1360x902 at 125 %)
    ok("window size about 1360x900 (within 4 px), smallest 380x600", Math.abs(sz[0] - 1360) <= 4 && Math.abs(sz[1] - 900) <= 4 && min[0] === 380 && min[1] === 600);

    const wp = wc.getLastWebPreferences() || {};
    console.log(`(webPreferences read back: ${JSON.stringify({ contextIsolation: wp.contextIsolation, nodeIntegration: wp.nodeIntegration, sandbox: wp.sandbox, webSecurity: wp.webSecurity, preload: wp.preload, webviewTag: wp.webviewTag, devTools: wp.devTools, spellcheck: wp.spellcheck })})`);
    ok("webPreferences: contextIsolation true, nodeIntegration false, sandbox true, webSecurity true", wp.contextIsolation === true && wp.nodeIntegration === false && wp.sandbox === true && wp.webSecurity === true);
    ok("webPreferences: no preload, webview tag off", !wp.preload && wp.webviewTag === false);
    wc.openDevTools({ mode: "detach" }); await sleep(600);
    const devOpen = wc.isDevToolsOpened(); if (devOpen) wc.closeDevTools();
    ok("developer tools cannot be opened (HUB_APP_DEVTOOLS is not 1)", !devOpen);
    ok("the page cannot reach Node (window.require and process are undefined)", (await js("typeof window.require === 'undefined' && typeof process === 'undefined' && typeof require === 'undefined'")) === true);

    // ---- 5. navigation lock-down
    const stays = () => wc.getURL() === origin && BrowserWindow.getAllWindows().length === 1;
    await js("location.href = 'http://example.com/'"); await sleep(1200);
    ok("location.href = http://example.com does not leave the Hub", stays() && (await js("location.origin")) === `http://127.0.0.1:${port}`);
    await js("location.href = 'http://localhost:" + port + "/'"); await sleep(800);
    ok("http://localhost (same port, other name) is refused too", stays());
    const w = await js("String(window.open('https://example.com'))"); await sleep(800);
    ok("window.open('https://example.com') opens nothing", w === "null" && BrowserWindow.getAllWindows().length === 1 && opened.length === 0);
    const sameWin = await js("String(window.open('/helpers.html'))"); await sleep(500);
    ok("window.open of a Hub page opens no second window either", sameWin === "null" && BrowserWindow.getAllWindows().length === 1);

    const click = (href) => js(`(() => { const a = document.createElement('a'); a.href = ${JSON.stringify(href)}; document.body.append(a); a.click(); a.remove(); return true; })()`, true);
    const CHAT = "claude://claude.ai/epitaxy/local_x";
    await click(CHAT); await sleep(1200);
    ok("a click on a claude://claude.ai/epitaxy/local_ link goes to the (fake) opener exactly once with that exact link", opened.length === 1 && opened[0] === CHAT);
    ok("after that click the window is still on the Hub", stays());

    for (const bad of ["claude://evil/", "file:///C:/Windows/win.ini", "claude://code/new", "claude://claude.ai/epitaxy/remote_x", "claude://resume?sessionX=1", "javascript:alert(1)"]) {
      await click(bad); await sleep(700);
      ok(`a click on ${bad} is refused and the opener is not called`, opened.length === 1 && stays());
    }
    const NEWCHAT = "claude://code/new?q=Hello%20there&folder=C%3A%5Cfake";
    const w2 = await js(`String(window.open(${JSON.stringify(NEWCHAT)}))`, true); await sleep(800);
    ok("window.open of a claude://code/new? link goes to the opener, no new window", w2 === "null" && opened.length === 2 && opened[1] === NEWCHAT && stays());
    const RESUME = "claude://resume?session=00000000-0000-4000-8000-000000000000";
    await click(RESUME); await sleep(1000);
    ok("a click on a claude://resume?session= link goes to the opener", opened.length === 3 && opened[2] === RESUME && stays());

    // ---- 6. permissions
    const notif = await js("Notification.requestPermission()", true).catch(() => "error");
    ok("notification permission is denied", notif === "denied");
    const mic = await js("navigator.mediaDevices ? Promise.race([navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => { s.getTracks().forEach((t) => t.stop()); return 'granted'; }, (e) => 'denied:' + e.name), new Promise((r) => setTimeout(() => r('timeout'), 5000))]) : 'denied:no-api'", true).catch(() => "error");
    ok("microphone permission is denied", typeof mic === "string" && mic.startsWith("denied"));
    const geo = await js("new Promise((r) => { if (!navigator.geolocation) return r('denied'); navigator.geolocation.getCurrentPosition(() => r('granted'), () => r('denied'), { timeout: 4000 }); setTimeout(() => r('timeout'), 5000); })", true).catch(() => "error");
    ok("location permission is denied", geo === "denied");
    console.log(`(page saw: notifications ${notif}, microphone ${mic}, location ${geo})`);

    // ---- 7. one screenshot of the window (sample data only), if HUB_APP_SHOT is set
    if (process.env.HUB_APP_SHOT) {
      await js("location.reload()"); await new Promise((r) => wc.once("did-finish-load", r)); await sleep(1500);
      const img = await wc.capturePage();
      mkdirSync(dirname(process.env.HUB_APP_SHOT), { recursive: true });
      writeFileSync(process.env.HUB_APP_SHOT, img.toPNG());
      ok(`screenshot saved (${img.getSize().width}x${img.getSize().height})`, !img.isEmpty());
    } else console.log("(no HUB_APP_SHOT set: screenshot skipped)");
  } catch (e) {
    ok(`self-test ran without an unexpected error (${e?.message || e})`, false);
  }
  clearTimeout(watchdog);
  return finish();
}
