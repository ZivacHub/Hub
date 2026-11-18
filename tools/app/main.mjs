// The Hub as its own window (Phase 16, step 16.1; D48). It only WRAPS the local dashboard page: it finds the dashboard at
// http://127.0.0.1:PORT (or starts it), shows it in one locked-down window, and stops the dashboard on quit only if it started it.
// Run: "Start Hub App.bat" in the Hub folder, or `npm start` in tools/app. Self-test: `node tools/app/selftest.mjs`.
// Contract (env variables, functions 16.2 and 16.3 hook into): docs/plan/phases/16-17-18-app-work-reports.md, "App contract (16.1)".
import { app, BrowserWindow, dialog, nativeTheme, session, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { hubUrl, isAllowedChatLink, isHubOrigin, isOtherLocalPortLink, parsePort, parseServerArgs } from "./lib/rules.mjs";
import { findOrStartServer, stopServer } from "./lib/server.mjs";
import { createTray, destroyTray, setTrayMenuExtras, windowImage } from "./lib/tray.mjs";
export { setTrayMenuExtras }; // 16.3: insert menu items (Start with Windows, projects) into the background icon's menu

const HERE = dirname(fileURLToPath(import.meta.url));
export const HUB_DIR = join(HERE, "..", ".."); // tools/app -> the Hub folder
const SELFTEST = process.env.HUB_APP_SELFTEST === "1";
const DEVTOOLS = process.env.HUB_APP_DEVTOOLS === "1";
const PORT = parsePort(process.env.HUB_PORT);
const SERVER_ARGS = parseServerArgs(process.env.HUB_APP_ARGS);
const SERVER_LOG = join(HUB_DIR, "logs", "hub_app_server.log");

// Page background while the page loads (matches --bg in tools/dashboard/public/style.css, light and dark).
const BG = { light: "#f4f6fa", dark: "#111419" };

// What this app owns right now. 16.3 (projects as part of the app) reads and extends this.
// quitting = the app is really quitting (the window may close for real); until then the X button only hides the window (D51).
export const state = { port: PORT, server: null, window: null, quitting: false, stopped: false, openExternal: (url) => shell.openExternal(url) };
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
export function createWindow({ port, openExternal, showInactive = false }) {
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
  win.once("ready-to-show", () => (showInactive ? win.showInactive() : win.show()));
  // D51: the X button (and Alt+F4) only HIDES the window; the Hub keeps running in the background icon. Real quit: state.quitting.
  win.on("close", (e) => { if (!state.quitting) { e.preventDefault(); win.hide(); } });
  win.on("session-end", () => { state.quitting = true; }); // Windows is shutting down or logging off: let go
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

/** Quit hook: before the app quits, stop the dashboard it started, then quit for real. 16.3 adds "stop every project the Hub started" here (D53). */
function installQuitHooks() {
  app.on("before-quit", (e) => {
    state.quitting = true; // from here the window may close for real
    destroyTray();
    if (state.stopped || !state.server?.ownsServer) return;
    e.preventDefault();
    stopOwnedServer().finally(() => app.quit());
  });
  // D51: no window left does NOT quit: the Hub keeps running in the background icon (only "Quit Hub" quits).
  app.on("window-all-closed", () => {});
  // a second start of the Hub: show and focus this one
  app.on("second-instance", () => { if (state.server) showHub(); /* before start-up finished there is nothing to show yet */ if (SELFTEST) console.log("SECOND_INSTANCE shown"); events.emit("second-instance"); });
}

/** Start-up: find or start the dashboard, then open the window. Errors are plain-language dialogs, never a stack trace. */
async function startHub() {
  if (PORT === null) { dialog.showErrorBox("Hub", "The Hub port setting (HUB_PORT) is not a valid number, so the Hub cannot start."); app.quit(); return; }
  lockDownSession(session.defaultSession);
  const result = await findOrStartServer({ port: PORT, hubDir: HUB_DIR, serverArgs: SERVER_ARGS, logFile: SERVER_LOG });
  if (!result.ok) { dialog.showErrorBox("Hub", result.message); app.quit(); return; }
  state.server = result;
  createWindow({ port: PORT, openExternal: state.openExternal });
  installTray();
}

// only one Hub at a time (the lock is per profile folder, so the self-test's own profile never meets a real Hub)
if (!app.requestSingleInstanceLock()) {
  app.exit(0); // the first Hub gets 'second-instance' and shows itself
} else if (SELFTEST) {
  installQuitHooks();
  const { runSelfTest } = await import("./selftest-inapp.mjs");
  app.whenReady().then(() => runSelfTest({ state, events, showHub, installTray, lockDownSession, createWindow, stopOwnedServer, port: PORT, serverArgs: SERVER_ARGS, hubDir: HUB_DIR, serverLog: SERVER_LOG }));
} else {
  installQuitHooks();
  app.whenReady().then(startHub).catch(() => { dialog.showErrorBox("Hub", "Something went wrong while starting the Hub."); app.quit(); });
}
