// Runs INSIDE the Electron app when HUB_APP_SELFTEST=1 (started by tools/app/selftest.mjs; sample data on port 4792 only).
// Prints one line per check, "OK name" or "FAIL name", then "SELFTEST DONE pass=N fail=M" and exits 0 (all passed) or 1.
// It never opens a real chat: every claude:// hand-off goes to a fake opener that only records the link.
// 16.3: the runner starts it with --hidden; the start-with-Windows switch uses a FAKE login item (the real setter is guarded);
// it ends with a REAL quit (quitHub -> before-quit -> stop the projects the sample dashboard lists as started by the Hub -> stop the dashboard).
import { app, BrowserWindow, screen } from "electron";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { hubUrl, isHubOrigin as isHubUrl } from "./lib/rules.mjs";
import { getTray, getTrayTemplate, setTrayMenuExtras, trayImage, windowImage } from "./lib/tray.mjs";
import { findOrStartServer, pageAnswers } from "./lib/server.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SELFTEST_PORT = 4792;

export async function runSelfTest({ state, events, showHub, installTray, lockDownSession, createWindow, stopOwnedServer, port, serverArgs, hubDir, serverLog,
  startHub, quitHub, plan, fakeLoginItems, appDir, appLog, oldEntryPath }) {
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

    // ---- 3. start-up as the start-with-Windows entry does it (the runner passes --hidden): the real startHub() on 4792 with sample data
    ok(`port ${port} was free before the test`, !(await pageAnswers(port)));
    const opened = [];
    state.openExternal = (url) => { opened.push(url); }; // every window (also the hidden one startHub makes) gets this fake opener
    try { rmSync(appLog, { force: true }); } catch { /* none yet */ }
    ok("the app was started with --hidden and read it from its command line (no visible window, server flags --demo --boot)", plan.hidden === true && plan.showWindow === false && JSON.stringify(plan.serverArgs) === '["--demo","--boot"]' && process.argv.includes("--hidden"));
    const started = await startHub({ plan });
    ok(`the app started the sample-data dashboard itself (ownsServer true, --demo, port ${port})`, started.ok === true && started.ownsServer === true && Number.isInteger(started.pid) && state.server === started);
    if (started.ok) console.log(`SERVER_PID ${started.pid}`);
    if (!started.ok) { console.log(`(reason: ${started.reason})`); clearTimeout(watchdog); return finish(1); }
    ok("hidden start: the dashboard command carries --demo and --boot (sample data: --boot starts nothing there)", started.child.spawnargs.includes("--boot") && started.child.spawnargs.includes("--demo"));
    const hw = state.window;
    if (hw) { await new Promise((resolve) => { if (!hw.webContents.isLoading()) resolve(); else hw.webContents.once("did-finish-load", resolve); }); await sleep(1000); }
    ok("hidden start: the Hub window exists (so Windows' session-end reaches it) but is NOT shown; the tray icon is there", !!hw && !hw.isDestroyed() && hw.isVisible() === false && BrowserWindow.getAllWindows().length === 1 && !!getTray() && !getTray().isDestroyed());

    // ---- 3b. the icon menu (16.3) with the FAKE login item; the real setter is guarded and never reached
    ok("self-test mode: the real app.setLoginItemSettings is replaced by a guard, and the menu read the FAKE login item", app.setLoginItemSettings?.selftestGuard === true && fakeLoginItems.gets.length > 0 && fakeLoginItems.sets.length === 0);
    await state.startupMenu.refresh();
    const menuLabels = () => (getTrayTemplate() || []).filter((i) => i.type !== "separator").map((i) => i.label);
    const swItem = () => (getTrayTemplate() || []).find((i) => i.label === "Start with Windows");
    ok("tray menu (16.3): Open Hub, Start with Windows (checkbox, unticked), Projects running: 3 (sample data), Waiting on you: <sample numbers>, Quit Hub; no old-entry line", menuLabels().length === 5 && JSON.stringify([menuLabels()[0], menuLabels()[1], menuLabels()[2], menuLabels()[4]]) === JSON.stringify(["Open Hub", "Start with Windows", "Projects running: 3", "Quit Hub"]) && /^Waiting on you: (nothing|\d+ (decision|chat))/.test(menuLabels()[3]) && swItem()?.type === "checkbox" && swItem().checked === false && !existsSync(oldEntryPath));
    const wantArgs = [/\s/.test(appDir) ? `"${appDir}"` : appDir, "--hidden"];
    swItem().click();
    const s1 = fakeLoginItems.sets[0] || {};
    ok("clicking 'Start with Windows' calls the FAKE setter once: openAtLogin true, path = this electron.exe, args = [app folder, --hidden], name Hub", fakeLoginItems.sets.length === 1 && s1.openAtLogin === true && s1.path === process.execPath && JSON.stringify(s1.args) === JSON.stringify(wantArgs) && s1.name === "Hub");
    ok("after the click the menu shows it ticked; the app folder in args is the folder electron.exe runs", swItem()?.checked === true && wantArgs[0].replace(/"/g, "") === app.getAppPath());
    swItem().click();
    ok("a second click switches it off (fake): one more call, unticked", fakeLoginItems.sets.length === 2 && fakeLoginItems.sets[1].openAtLogin === false && swItem()?.checked === false);
    console.log(`(the real start-up entry would be: "${process.execPath}" ${wantArgs.join(" ")} ; never written by this test)`);
    hw?.destroy(); await sleep(300); // the rest of the test uses its own visible test window

    // ---- 4. the window
    const win = createWindow({ port, openExternal: state.openExternal, showInactive: true });
    const tray = installTray();
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

    // other local programs' pages go to the default browser (fake opener), the Hub's own port and odd links stay denied
    await click("http://127.0.0.1:5057/"); await sleep(900);
    ok("a click on http://127.0.0.1:5057/ (another local port) goes to the opener once with that exact URL, window stays", opened.length === 4 && opened[3] === "http://127.0.0.1:5057/" && stays());
    const w3 = await js("String(window.open('http://localhost:5058/x'))", true); await sleep(800);
    ok("window.open of http://localhost:5058/x goes to the opener, no new window", w3 === "null" && opened.length === 5 && opened[4] === "http://localhost:5058/x" && stays());
    for (const bad of ["http://example.com/", "https://127.0.0.1:1234/", "http://127.0.0.1:80/", "http://127.0.0.1/", "http://user@127.0.0.1:5000/", "http://user:pw@localhost:5000/", `http://localhost:${port}/`, "http://127.0.0.1:1023/"]) {
      await click(bad); await sleep(600);
      ok(`a click on ${bad} stays denied and the opener is not called`, opened.length === 5 && stays());
    }

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

    // ---- 8. background icon and hide on close (16.2, D51)
    const icon = windowImage(), tIcon = trayImage(false), tNeeds = trayImage(true);
    ok("icons load: window icon 256 px, tray icon 16 px (+2x), amber-dot icon 32 px", !icon.isEmpty() && icon.getSize().width === 256 && !tIcon.isEmpty() && tIcon.getSize().width === 16 && !tNeeds.isEmpty() && tNeeds.getSize().width === 32);
    ok("the tray icon exists (created, not destroyed)", !!getTray() && getTray() === tray && !tray.isDestroyed());
    console.log(`(tray bounds as Windows reports them: ${JSON.stringify(tray.getBounds())}; the icon sits in the hidden-icons area, a test cannot see it)`);
    const tpl = getTrayTemplate() || [];
    const labels = tpl.filter((i) => i.type !== "separator").map((i) => i.label);
    ok("the tray menu is 'Open Hub', separator, the 16.3 lines (incl. Waiting on you), separator, 'Quit Hub'", labels.length === 5 && labels[0] === "Open Hub" && labels[4] === "Quit Hub" && labels[2] === "Projects running: 3" && /^Waiting on you: /.test(labels[3]) && tpl.length === 7 && tpl[1].type === "separator" && tpl[5].type === "separator");
    setTrayMenuExtras([{ label: "Extra item", type: "checkbox", checked: false }]);
    ok("setTrayMenuExtras puts items between Open Hub and Quit Hub", JSON.stringify((getTrayTemplate() || []).filter((i) => i.type !== "separator").map((i) => i.label)) === JSON.stringify(["Open Hub", "Extra item", "Quit Hub"]));
    setTrayMenuExtras([]);
    ok("setTrayMenuExtras([]) gives the plain menu back", (getTrayTemplate() || []).length === 3);
    state.startupMenu.redraw();
    ok("the 16.3 lines come back (redraw), still nothing written to the start-up entry beyond the two test clicks", (getTrayTemplate() || []).length === 7 && fakeLoginItems.sets.length === 2);
    ok("the window is visible before the close test and the app is not quitting", win.isVisible() && state.quitting === false);

    win.close(); await sleep(400); // what the X button and Alt+F4 do
    ok("closing the window (X / Alt+F4) HIDES it: not visible, not destroyed, still the one window, no dialog", !win.isDestroyed() && !win.isVisible() && state.window === win && BrowserWindow.getAllWindows().length === 1);
    ok("after the close the tray icon is still there (app stays alive)", !tray.isDestroyed());
    tray.emit("click"); await sleep(400);
    ok("a click on the tray icon shows the window again", win.isVisible());
    win.hide(); tray.emit("double-click"); await sleep(300);
    ok("a double click on the tray icon shows it too", win.isVisible());
    win.hide(); tpl[0].click(); await sleep(300);
    ok("the menu item 'Open Hub' shows it", win.isVisible());
    win.minimize(); await sleep(300); showHub(); await sleep(400);
    ok("showHub restores a minimized window", !win.isMinimized() && win.isVisible());

    // second start of the Hub: the OUTER runner starts a second electron.exe with the same profile when it sees the next line
    win.hide();
    const gotSecond = new Promise((resolve) => { const t = setTimeout(() => resolve(false), 25000); events.once("second-instance", () => { clearTimeout(t); resolve(true); }); });
    console.log("READY_FOR_SECOND_INSTANCE");
    const second = await gotSecond; await sleep(500);
    ok("a second start of the Hub is reported to this one ('second-instance') and the hidden window is shown again", second === true && win.isVisible() && !win.isDestroyed());
    console.log(`(window focused after the second start: ${win.isFocused()}; Windows may refuse focus to a background test)`);

    // window destroyed (not just hidden): showHub re-creates it
    win.destroy(); await sleep(300);
    ok("after the window is destroyed state.window is empty and the tray is still there", state.window === null && !tray.isDestroyed());
    const win2 = showHub();
    for (let i = 0; i < 40 && !(win2.isVisible() && isHubUrl(win2.webContents.getURL(), port) && !win2.webContents.isLoading()); i++) await sleep(250);
    ok("showHub re-creates the window on the Hub page and shows it", win2 !== win && win2.isVisible() && isHubUrl(win2.webContents.getURL(), port) && BrowserWindow.getAllWindows().length === 1);

    // real quit: only when quitting is set does close really close
    state.quitting = true; win2.close(); await sleep(500);
    ok("with the app quitting, closing really closes the window (destroyed)", win2.isDestroyed() && BrowserWindow.getAllWindows().length === 0);
    ok("with no window left the app is still alive (window-all-closed does not quit) and the tray is still there", !tray.isDestroyed());

    // ---- 9. a REAL quit through the app (D53): before-quit -> stop the projects the dashboard started -> stop the own dashboard
    // The sample dashboard lists clip-studio and manager as started by the Hub; it answers every POST that passed the Origin and
    // token checks with "Sample data mode: the buttons are switched off." (so that answer also proves the guarded call got through).
    clearTimeout(watchdog);
    const quitWatch = setTimeout(() => { ok("the real quit finished within 40 seconds", false); console.log(`SELFTEST DONE pass=${pass} fail=${fail}`); app.exit(1); }, 40000);
    const t0 = Date.now();
    state.onQuitDone = async (r) => {
      clearTimeout(quitWatch);
      const ms = Date.now() - t0;
      const p = r?.projects || {};
      const SAMPLE = "Sample data mode: the buttons are switched off.";
      ok("real quit: stopHubProjects asked to stop exactly the projects with startedByHub true (clip-studio, manager)", JSON.stringify(p.ids) === JSON.stringify(["clip-studio", "manager"]));
      ok("real quit: the sample dashboard's refusal is handled (both counted as not stopped with its message, no error, no time-out)", p.stopped?.length === 0 && p.failed?.length === 2 && p.failed.every((f) => f.error === SAMPLE) && p.timedOut === false && r.timedOut === false);
      let logText = ""; try { logText = readFileSync(appLog, "utf8"); } catch { /* none */ }
      ok("real quit: one log line per project in the app log (self-test log in the temp folder)", logText.includes(`stop clip-studio failed: ${SAMPLE}`) && logText.includes(`stop manager failed: ${SAMPLE}`) && logText.includes("start hidden (--hidden), own dashboard with --boot"));
      let gone = false;
      for (let i = 0; i < 20 && !gone; i++) { gone = !(await pageAnswers(port, { timeoutMs: 500 })); if (!gone) await sleep(250); }
      ok("the dashboard the app started is stopped when the app quits (port no longer answers)", r.serverStopped === true && gone);
      ok(`real quit: projects first, then the dashboard, all within the limit (${ms} ms), the tray icon is gone`, ms < 30000 && !getTray() && state.quitting === true);
      ok("real quit: the real start-up setter was never reached (only the 2 fake test clicks)", fakeLoginItems.sets.length === 2 && app.setLoginItemSettings?.selftestGuard === true);
      console.log(`SELFTEST DONE pass=${pass} fail=${fail}`);
      app.exit(fail ? 1 : 0);
    };
    quitHub(); // the tray's "Quit Hub": app.quit() -> before-quit runs the sequence, then calls onQuitDone
    return;
  } catch (e) {
    ok(`self-test ran without an unexpected error (${e?.message || e})`, false);
  }
  clearTimeout(watchdog);
  return finish();
}
