// The Hub as its own window (Phase 16, step 16.1; D48). It only WRAPS the local dashboard page: it finds the dashboard at
// http://127.0.0.1:PORT (or starts it), shows it in one locked-down window, and stops the dashboard on quit only if it started it.
// Run: "Start Hub App.bat" in the Hub folder, or `npm start` in tools/app. Self-test: `node tools/app/selftest.mjs`.
// Contract (env variables, functions 16.2 and 16.3 hook into): docs/plan/phases/16-17-18-app-work-reports.md, "App contract (16.1)".
import { app, BrowserWindow, dialog, nativeTheme, session, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { hubUrl, isAllowedChatLink, isHubOrigin, parsePort, parseServerArgs } from "./lib/rules.mjs";
import { findOrStartServer, stopServer } from "./lib/server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const HUB_DIR = join(HERE, "..", ".."); // tools/app -> the Hub folder
const SELFTEST = process.env.HUB_APP_SELFTEST === "1";
const DEVTOOLS = process.env.HUB_APP_DEVTOOLS === "1";
const PORT = parsePort(process.env.HUB_PORT);
const SERVER_ARGS = parseServerArgs(process.env.HUB_APP_ARGS);
const SERVER_LOG = join(HUB_DIR, "logs", "hub_app_server.log");

// Page background while the page loads (matches --bg in tools/dashboard/public/style.css, light and dark).
const BG = { light: "#f4f6fa", dark: "#111419" };

// What this app owns right now. 16.2 (tray, hide on close) and 16.3 (projects as part of the app) read and extend this.
export const state = { port: PORT, server: null, window: null, quitting: false, stopped: false };

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
 * (lib/rules.mjs CHAT_LINK_PREFIXES) is handed to `openExternal` and the window stays on the Hub. Everything else is refused.
 * `openExternal` is injectable: the self-test passes a fake, so it never opens a real chat.
 */
export function lockDownNavigation(contents, { port, openExternal }) {
  const handOff = (url) => { try { Promise.resolve(openExternal(url)).catch(() => {}); } catch { /* never crash on a link */ } };
  contents.on("will-navigate", (e) => {
    const url = e.url;
    if (isHubOrigin(url, port)) return;
    e.preventDefault();
    if (isAllowedChatLink(url)) handOff(url);
  });
  contents.on("will-frame-navigate", (e) => { if (!e.isMainFrame && !isHubOrigin(e.url, port)) e.preventDefault(); });
  contents.on("will-redirect", (e) => { if (!isHubOrigin(e.url, port)) e.preventDefault(); });
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedChatLink(url)) handOff(url);
    return { action: "deny" }; // the Hub is one window: no new windows at all, not even Hub pages
  });
  contents.on("will-attach-webview", (e) => e.preventDefault());
}

/** The one Hub window. `show: false` until the first paint so there is no white flash. */
export function createWindow({ port, openExternal, showInactive = false }) {
  const win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 380, minHeight: 600,
    title: "Hub",
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

/** Quit hook: before the app quits, stop the dashboard it started, then quit for real. 16.2/16.3 add their own stops to stopOwnedServer's caller. */
function installQuitHooks() {
  app.on("before-quit", (e) => {
    if (state.stopped || !state.server?.ownsServer) return;
    e.preventDefault();
    stopOwnedServer().finally(() => app.quit());
  });
  // 16.1: closing the window quits. 16.2 replaces this with "hide to the background icon" (D51).
  app.on("window-all-closed", () => app.quit());
}

/** Start-up: find or start the dashboard, then open the window. Errors are plain-language dialogs, never a stack trace. */
async function startHub() {
  if (PORT === null) { dialog.showErrorBox("Hub", "The Hub port setting (HUB_PORT) is not a valid number, so the Hub cannot start."); app.quit(); return; }
  lockDownSession(session.defaultSession);
  const result = await findOrStartServer({ port: PORT, hubDir: HUB_DIR, serverArgs: SERVER_ARGS, logFile: SERVER_LOG });
  if (!result.ok) { dialog.showErrorBox("Hub", result.message); app.quit(); return; }
  state.server = result;
  createWindow({ port: PORT, openExternal: (url) => shell.openExternal(url) });
}

installQuitHooks();
if (SELFTEST) {
  const { runSelfTest } = await import("./selftest-inapp.mjs");
  app.whenReady().then(() => runSelfTest({ state, lockDownSession, createWindow, stopOwnedServer, port: PORT, serverArgs: SERVER_ARGS, hubDir: HUB_DIR, serverLog: SERVER_LOG }));
} else {
  app.whenReady().then(startHub).catch(() => { dialog.showErrorBox("Hub", "Something went wrong while starting the Hub."); app.quit(); });
}
