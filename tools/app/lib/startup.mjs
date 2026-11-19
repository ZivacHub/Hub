// Start-up of the Hub app (step 16.3): the --hidden flag, the "Start with Windows" switch in the background icon's menu,
// the "Projects running: N" line and the warning about the OLD start-up entry. No Electron import: the login-item calls,
// the file check and the counter are injected, so plain Node tests it with fakes and no test can write the real registry.
import { join } from "node:path";

export const HIDDEN_FLAG = "--hidden";
export const LOGIN_ITEM_NAME = "Hub";
export const OLD_ENTRY_TEXT = "Old start-up entry found: run Remove Hub Autostart.bat";
export const MENU_REFRESH_MS = 15000;

/**
 * The app's own command line -> { hidden }. Only the exact element "--hidden" counts (not "--hidden=1", not an env variable).
 * argv[0] is the program itself and is skipped; an unpackaged start looks like [electron.exe, <app folder>, "--hidden"].
 */
export function parseAppFlags(argv = []) {
  return { hidden: Array.isArray(argv) && argv.slice(1).some((a) => a === HIDDEN_FLAG) };
}

/**
 * What start-up does. hidden: no visible window (it is created hidden, so Windows' session-end still reaches it) and the
 * dashboard is started WITH --boot (the projects ticked "Start with PC" start after its 20 s delay). --boot is added only
 * here, never from HUB_APP_ARGS (parseServerArgs drops it), and it only matters when the app starts its own dashboard:
 * findOrStartServer uses serverArgs only when it spawns, so in attach mode nothing is started.
 */
export function startPlan({ argv = [], envArgs = [] } = {}) {
  const { hidden } = parseAppFlags(argv);
  const base = envArgs.filter((a) => a !== "--boot");
  return { hidden, showWindow: !hidden, serverArgs: hidden ? [...base, "--boot"] : base };
}

/** A path with a space must be in quotes on the Windows Run line (Electron joins args with spaces and does not quote them). */
const quoteIfSpaces = (p) => (/\s/.test(p) ? `"${p}"` : p);

/**
 * The ONE set of options for both getLoginItemSettings and setLoginItemSettings (on Windows path/args/name must match).
 * The program is electron.exe running the app folder, so the app folder is the first argument: "electron.exe <app folder> --hidden".
 */
export function loginItemOptions({ execPath, appDir }) {
  return { path: execPath, args: [quoteIfSpaces(appDir), HIDDEN_FLAG], name: LOGIN_ITEM_NAME };
}

/** The old start-up shortcut made by "Install Hub Autostart.bat" (only ever checked for existence, never touched). */
export function oldStartupEntryPath(env = process.env) {
  return env.APPDATA ? join(env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Hub Dashboard.lnk") : null;
}

/** The extra tray items (between "Open Hub" and "Quit Hub"). */
/** "Waiting on you: 2 decisions, 1 chat" / "Waiting on you: nothing" / null (no line) when the menu has no counter for it. */
export function waitingLabel(waiting) {
  if (waiting === undefined) return null;
  if (waiting === null) return "Waiting on you: unknown (dashboard not answering)";
  const part = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const bits = [];
  if (waiting.decisions > 0) bits.push(part(waiting.decisions, "decision"));
  if (waiting.chats > 0) bits.push(part(waiting.chats, "chat"));
  return `Waiting on you: ${bits.length ? bits.join(", ") : "nothing"}`;
}

export function buildStartupExtras({ startWithWindows, running, waiting, oldEntry, onToggle }) {
  const items = [
    { id: "start-with-windows", label: "Start with Windows", type: "checkbox", checked: !!startWithWindows, click: () => onToggle() },
    { id: "projects-running", label: running === null || running === undefined ? "Projects running: unknown (dashboard not answering)" : `Projects running: ${running}`, enabled: false },
  ];
  const wl = waitingLabel(waiting);
  if (wl) items.push({ id: "waiting-on-you", label: wl, enabled: false });
  if (oldEntry) items.push({ id: "old-startup-entry", label: OLD_ENTRY_TEXT, enabled: false });
  return items;
}

/**
 * The menu controller. loginItems = { get(options) -> { openAtLogin, executableWillLaunchAtLogin? }, set(settings) } (the real
 * Electron calls in normal use, a fake in every test). countFn() -> number | null. exists(path) -> boolean. setExtras(items).
 * The switch is written ONLY by toggle() (a click by Ivan); refresh() only reads.
 */
export function makeStartupMenu({ loginItems, execPath, appDir, oldEntryPath, exists, countFn, waitFn, setExtras, log = () => {}, refreshMs = MENU_REFRESH_MS }) {
  const opts = loginItemOptions({ execPath, appDir });
  let lastKey = null, timer = null, running = null, waiting = waitFn ? null : undefined, busy = null;

  function isOn() {
    try {
      const s = loginItems.get({ path: opts.path, args: opts.args });
      // Task Manager can switch the entry off: then it will not start, so the box shows unticked
      return !!s?.openAtLogin && s.executableWillLaunchAtLogin !== false;
    } catch { return false; }
  }
  function oldEntry() { try { return !!oldEntryPath && exists(oldEntryPath); } catch { return false; } }
  function render() {
    const view = { startWithWindows: isOn(), running, waiting, oldEntry: oldEntry() };
    const key = JSON.stringify(view);
    if (key !== lastKey) { lastKey = key; setExtras(buildStartupExtras({ ...view, onToggle: () => toggle() })); }
    return view;
  }
  async function refresh() {
    if (busy) return busy;
    busy = (async () => {
      try { running = await countFn(); } catch { running = null; }
      if (waitFn) { try { waiting = await waitFn(); } catch { waiting = null; } }
      return render();
    })();
    try { return await busy; } finally { busy = null; }
  }
  function toggle() {
    const next = !isOn();
    try {
      loginItems.set({ openAtLogin: next, path: opts.path, args: opts.args, name: opts.name });
      log(`start-with-windows ${next ? "on" : "off"}`);
    } catch (e) { log(`start-with-windows could not be changed (${String(e?.message || e).slice(0, 80)})`); }
    lastKey = null; // always rebuild: Electron flips a checkbox by itself on click, the menu must show the real state again
    return render();
  }
  function start() { render(); refresh(); timer = setInterval(() => { refresh(); }, refreshMs); timer.unref?.(); }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  function redraw() { lastKey = null; return render(); } // put the items back after someone else replaced the extras
  return { start, stop, refresh, toggle, redraw, isOn, options: opts };
}
