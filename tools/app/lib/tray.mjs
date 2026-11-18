// The background icon (Windows "hidden icons" area), step 16.2. Left click / double click = show the window; menu = Open Hub, Quit Hub.
// 16.3 calls setTrayMenuExtras([...]) to insert its own items (Start with Windows, projects) without touching this file again.
import { Menu, Tray, nativeImage } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTrayTemplate } from "./traymenu.mjs";

export const ASSETS = join(import.meta.dirname, "..", "assets");

/** The Hub icon for the tray: 16 px with a 32 px sharper version for high-DPI screens. */
export function trayImage(needsYou = false) {
  if (needsYou) return nativeImage.createFromPath(join(ASSETS, "tray-needs.png"));
  const img = nativeImage.createFromPath(join(ASSETS, "icon-16.png"));
  img.addRepresentation({ scaleFactor: 2, buffer: readFileSync(join(ASSETS, "icon-32.png")) });
  return img;
}
/** The icon of the window and the taskbar. */
export const windowImage = () => nativeImage.createFromPath(join(ASSETS, "icon.png"));

let tray = null, handlers = null, extras = [], lastTemplate = null;

function rebuild() {
  if (!tray || tray.isDestroyed()) return;
  lastTemplate = buildTrayTemplate({ ...handlers, extras });
  tray.setContextMenu(Menu.buildFromTemplate(lastTemplate));
}

/** Creates the tray icon once. onOpen = show the window; onQuit = quit for real. */
export function createTray({ onOpen, onQuit }) {
  if (tray && !tray.isDestroyed()) return tray;
  handlers = { onOpen, onQuit };
  tray = new Tray(trayImage(false));
  tray.setToolTip("Hub");
  tray.on("click", () => onOpen());
  tray.on("double-click", () => onOpen());
  rebuild();
  return tray;
}

/** Hook for 16.3: replace the extra menu items (array of menu-item objects) and rebuild the menu. */
export function setTrayMenuExtras(items) { extras = Array.isArray(items) ? items : []; rebuild(); }
/** Hook for a later "something needs you" state: switches between the plain and the amber-dot icon. */
export function setTrayNeedsYou(flag) { if (tray && !tray.isDestroyed()) tray.setImage(trayImage(!!flag)); }

export const getTray = () => tray;
export const getTrayTemplate = () => lastTemplate; // what the menu was built from (for the self-test)
export function destroyTray() { if (tray && !tray.isDestroyed()) tray.destroy(); tray = null; }
