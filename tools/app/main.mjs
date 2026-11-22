// The Hub as its own window (Phase 16, step 16.1; D48). It only WRAPS the local dashboard page: it finds the dashboard at
// http://127.0.0.1:PORT (or starts it), shows it in one locked-down window, and stops the dashboard on quit only if it started it.
// Run: "Start Hub App.bat" in the Hub folder, or `npm start` in tools/app. Self-test: `node tools/app/selftest.mjs`.
// Contract (env variables, functions 16.2 and 16.3 hook into): docs/plan/phases/16-17-18-app-work-reports.md, "App contract (16.1)".
// 16.3 (D53): a real quit first asks the dashboard to stop every project it started (stopHubProjects), then stops the dashboard
// if this app started it. `--hidden` on the command line (the start-with-Windows entry) = no visible window, dashboard with --boot.
import { app, BrowserWindow, clipboard, dialog, Menu, nativeTheme, session, shell } from "electron";
import { buildContextMenuTemplate } from "./lib/contextmenu.mjs";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { hubUrl, isAllowedChatLink, isHubOrigin, isOtherLocalPortLink, parsePort, parseServerArgs } from "./lib/rules.mjs";
import { findOrStartServer, stopServer } from "./lib/server.mjs";
import { createTray, destroyTray, getTray, setTrayMenuExtras, windowImage } from "./lib/tray.mjs";
import { appendAppLog, countRunning, countWaiting, quitSequence, stopHubProjects, STOP_LIMIT_MS } from "./lib/projects.mjs";
import { makeStartupMenu, oldStartupEntryPath, parseAppFlags, startPlan } from "./lib/startup.mjs";
export { setTrayMenuExtras }; // 16.3: insert menu items (Start with Windows, projects) into the background icon's menu

const HERE = dirname(fileURLToPath(import.meta.url));
export const HUB_DIR = join(HERE, "..", ".."); // tools/app -> the Hub folder
const SELFTEST = process.env.HUB_APP_SELFTEST === "1";
const DEVTOOLS = process.env.HUB_APP_DEVTOOLS === "1";
const PORT = parsePort(process.env.HUB_PORT);
const SERVER_ARGS = parseServerArgs(process.env.HUB_APP_ARGS);
const SERVER_LOG = join(HUB_DIR, "logs", "hub_app_server.log");
export const APP_DIR = HERE; // the folder electron.exe runs (the start-with-Windows entry passes it as the first argument)
const SELFTEST_DIR = join(tmpdir(), "hub-app-selftest");
// one line per project stop and per start-with-Windows change (git-ignored logs/ folder; the self-test writes to its temp folder instead)
export const APP_LOG = SELFTEST ? join(SELFTEST_DIR, "hub_app.log") : join(HUB_DIR, "logs", "hub_app.log");
// start-up plan from the command line (only the exact flag --hidden) and HUB_APP_ARGS (which can never carry --boot)
export const PLAN = startPlan({ argv: process.argv, envArgs: SERVER_ARGS });
// the old "Install Hub Autostart.bat" shortcut: only checked for existence (the self-test points at a file that does not exist)
const OLD_ENTRY = SELFTEST ? join(SELFTEST_DIR, "no-such-Hub Dashboard.lnk") : oldStartupEntryPath();

// The Windows start-up entry ("Start with Windows" in the icon menu). In self-test mode a FAKE is used and the real
// app.setLoginItemSettings is replaced by a guard that throws, so no test can ever write the real registry.
export const fakeLoginItems = {
  on: false, gets: [], sets: [],
  get(options) { this.gets.push(options); return { openAtLogin: this.on, executableWillLaunchAtLogin: this.on }; },
  set(settings) { this.sets.push(settings); this.on = !!settings.openAtLogin; },
};
if (SELFTEST) {
  const guard = () => { throw new Error("app.setLoginItemSettings is blocked in self-test mode"); };
  guard.selftestGuard = true;
  app.setLoginItemSettings = guard;
}
const loginItems = SELFTEST ? fakeLoginItems : {
  get: (options) => app.getLoginItemSettings(options),
  set: (settings) => app.setLoginItemSettings(settings), // only ever called from the menu click (startup.mjs toggle)
};

// Page background while the page loads (matches --bg in tools/dashboard/public/style.css, light and dark).
const BG = { light: "#f4f6fa", dark: "#111419" };

// What this app owns right now. 16.3 (projects as part of the app) reads and extends this.
// quitting = the app is really quitting (the window may close for real); until then the X button only hides the window (D51).
// 16.3: startupMenu = the icon menu controller; quitAsked/quitPromise/quitResult/quitDone = the real-quit sequence; onQuitDone = self-test hook.
export const state = { port: PORT, server: null, window: null, quitting: false, stopped: false, openExternal: (url) => shell.openExternal(url), startupMenu: null, quitAsked: false, quitPromise: null, quitResult: null, quitDone: false, onQuitDone: null };
export const events = new EventEmitter(); // "second-instance" (self-test listens)

app.setName("Hub");
app.setAppUserModelId("Hub");
// self-test: its own throw-away profile folder, so it never touches the real app's saved settings
if (SELFTEST) app.setPath("userData", join(tmpdir(), "hub-app-selftest-profile"));

/** Session-wide lock-down: every permission (camera, microphone, notifications, location, ...) and every download is refused. */
export function lockDownSession(ses) {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler?.(() => false);
  ses.on("will-download", (e) => e.preventDefault());
}

/**
 * The window may only show http://127.0.0.1:PORT. A navigation or new-window request to one of the three claude:// chat links
 * (lib/rules.mjs CHAT_LINK_PREFIXES), or to another local program's page (http on 127.0.0.1/localhost, other port 1024-65535,
 * no credentials), is handed to `openExternal` (the default browser) and the window stays on the Hub. Everything else is refused.
 * `openExternal` is injectable: the self-test passes a fake, so it never opens a real chat.
 */
export function lockDownNavigation(contents, { port, openExternal }) {
  const handOff = (url) => { try { Promise.resolve(openExternal(url)).catch(() => {}); } catch { /* never crash on a link */ } };
  contents.on("will-navigate", (e) => {
    const url = e.url;
    if (isHubOrigin(url, port)) return;
    e.preventDefault();
    if (isAllowedChatLink(url) || isOtherLocalPortLink(url, port)) handOff(url);
  });
  contents.on("will-frame-navigate", (e) => { if (!e.isMainFrame && !isHubOrigin(e.url, port)) e.preventDefault(); });
  contents.on("will-redirect", (e) => { if (!isHubOrigin(e.url, port)) e.preventDefault(); });
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedChatLink(url) || isOtherLocalPortLink(url, port)) handOff(url);
    return { action: "deny" }; // the Hub is one window: no new windows at all, not even Hub pages
  });
  contents.on("will-attach-webview", (e) => e.preventDefault());
}

/** The one Hub window. `show: false` until the first paint so there is no white flash. */
export function createWindow({ port, openExternal, showInactive = false, showOnReady = true }) {
  const win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 380, minHeight: 600,
    title: "Hub",
    icon: windowImage(),
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? BG.dark : BG.light,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      spellcheck: false, devTools: DEVTOOLS, webviewTag: false,
    },
  });
  win.removeMenu();
  lockDownNavigation(win.webContents, { port, openExternal });
  // right-click: Copy / Paste / Select all like Claude desktop (Electron shows nothing by itself); empty space shows no menu
  win.webContents.on("context-menu", (_e, params) => {
    try {
      const tpl = buildContextMenuTemplate(params, { copyLink: (u) => clipboard.writeText(u) });
      if (tpl.length) Menu.buildFromTemplate(tpl).popup({ window: win });
    } catch { /* a menu problem must never break the window */ }
  });
  // showOnReady false (--hidden start): the window is made but stays hidden until "Open Hub"; it exists so Windows' session-end reaches the app
  win.once("ready-to-show", () => { if (showOnReady) (showInactive ? win.showInactive() : win.show()); });
  // D51: the X button (and Alt+F4) only HIDES the window; the Hub keeps running in the background icon. Real quit: state.quitting.
  win.on("close", (e) => { if (!state.quitting) { e.preventDefault(); win.hide(); } });
  // Windows is shutting down or logging off (before-quit is NOT emitted then): let go and try to stop the projects (best effort: Windows may end the app first)
  win.on("session-end", () => { state.quitting = true; runQuitSequence(); });
  win.on("closed", () => { if (state.window === win) state.window = null; });
  state.window = win;
  win.loadURL(hubUrl(port)).catch(() => {}); // a failed load shows Chromium's own error page inside the locked window
  return win;
}

/** Stop the dashboard only if this app started it. Safe to call more than once. */
export async function stopOwnedServer() {
  const s = state.server;
  if (!s || !s.ownsServer || state.stopped) return true;
  state.stopped = true;
  return stopServer(s.child);
}

/**
 * The real-quit order (D53), once: stop every project the dashboard started (also an attached dashboard's), then the dashboard
 * itself only if this app started it. At most STOP_LIMIT_MS for the projects; quitSequence bounds the whole.
 */
export function runQuitSequence() {
  if (!state.quitPromise) {
    state.quitPromise = quitSequence({
      server: state.server,
      stopProjects: () => stopHubProjects({ port: state.port, limitMs: STOP_LIMIT_MS, log: (t) => appendAppLog(APP_LOG, t) }),
      stopServer: () => stopOwnedServer(),
    }).then((r) => { state.quitResult = r; return r; });
  }
  return state.quitPromise;
}

/** The icon menu's extra lines (Start with Windows, Projects running: N, old start-up entry). Once, after the tray exists. */
export function installStartupMenu() {
  if (state.startupMenu) return state.startupMenu;
  state.startupMenu = makeStartupMenu({
    loginItems, execPath: process.execPath, appDir: APP_DIR, oldEntryPath: OLD_ENTRY, exists: existsSync,
    countFn: () => countRunning({ port: state.port }), waitFn: () => countWaiting({ port: state.port }), setExtras: setTrayMenuExtras, log: (t) => appendAppLog(APP_LOG, t),
  });
  state.startupMenu.start();
  getTray()?.on("mouse-enter", () => { state.startupMenu?.refresh(); }); // a fresh count just before the menu is opened
  return state.startupMenu;
}

/** Show the Hub window: re-create it if destroyed, restore if minimized, show and focus. Used by the icon, a second start and 16.3. */
export function showHub() {
  let win = state.window;
  if (!win || win.isDestroyed()) win = createWindow({ port: state.port, openExternal: state.openExternal });
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

/** Quit for real (the icon's "Quit Hub"). */
export function quitHub() { state.quitting = true; app.quit(); }

/** The background icon (once). */
export function installTray() { return createTray({ onOpen: () => showHub(), onQuit: () => quitHub() }); }

/** Quit hook: before the app quits, run the real-quit order (projects, then an own dashboard), then quit for real. Never hangs. */
function installQuitHooks() {
  app.on("before-quit", (e) => {
    state.quitting = true; // from here the window may close for real
    destroyTray();
    state.startupMenu?.stop();
    if (state.quitDone) return;
    e.preventDefault();
    if (state.quitAsked) return; // already on its way
    state.quitAsked = true;
    const backstop = setTimeout(() => app.exit(0), STOP_LIMIT_MS + 15000); // whatever happens, the app exits
    runQuitSequence()
      .then(async (r) => { if (state.onQuitDone) await state.onQuitDone(r); })
      .catch(() => {})
      .finally(() => { clearTimeout(backstop); state.quitDone = true; app.quit(); });
  });
  // D51: no window left does NOT quit: the Hub keeps running in the background icon (only "Quit Hub" quits).
  app.on("window-all-closed", () => {});
  // a second start of the Hub: show and focus this one
  // (a second start that is itself the start-with-Windows entry, --hidden, does not pop the window up)
  app.on("second-instance", (_e, argv) => { if (state.server && !parseAppFlags(argv).hidden) showHub(); /* before start-up finished there is nothing to show yet */ if (SELFTEST) console.log("SECOND_INSTANCE shown"); events.emit("second-instance"); });
}

/**
 * Start-up: find or start the dashboard (with --boot only in --hidden mode, and only used if the app starts it), then the
 * window (hidden in --hidden mode), the icon and its menu. Errors are plain-language dialogs, never a stack trace.
 */
export async function startHub({ plan = PLAN } = {}) {
  if (PORT === null) { dialog.showErrorBox("Hub", "The Hub port setting (HUB_PORT) is not a valid number, so the Hub cannot start."); app.quit(); return { ok: false, reason: "port" }; }
  lockDownSession(session.defaultSession);
  const result = await findOrStartServer({ port: PORT, hubDir: HUB_DIR, serverArgs: plan.serverArgs, logFile: SERVER_LOG });
  if (!result.ok) { if (!SELFTEST) { dialog.showErrorBox("Hub", result.message); app.quit(); } return result; }
  state.server = result;
  createWindow({ port: PORT, openExternal: state.openExternal, showOnReady: plan.showWindow });
  installTray();
  installStartupMenu();
  const how = result.ownsServer ? `own dashboard${plan.serverArgs.includes("--boot") ? " with --boot" : ""}` : "attached to a running dashboard";
  appendAppLog(APP_LOG, `start ${plan.hidden ? "hidden (--hidden)" : "normal"}, ${how}`);
  return result;
}

// only one Hub at a time (the lock is per profile folder, so the self-test's own profile never meets a real Hub)
if (!app.requestSingleInstanceLock()) {
  app.exit(0); // the first Hub gets 'second-instance' and shows itself
} else if (SELFTEST) {
  installQuitHooks();
  const { runSelfTest } = await import("./selftest-inapp.mjs");
  app.whenReady().then(() => runSelfTest({ state, events, showHub, installTray, lockDownSession, createWindow, stopOwnedServer, port: PORT, serverArgs: SERVER_ARGS, hubDir: HUB_DIR, serverLog: SERVER_LOG,
    startHub, quitHub, plan: PLAN, fakeLoginItems, appDir: APP_DIR, appLog: APP_LOG, oldEntryPath: OLD_ENTRY }));
} else {
  installQuitHooks();
  app.whenReady().then(startHub).catch(() => { dialog.showErrorBox("Hub", "Something went wrong while starting the Hub."); app.quit(); });
}
