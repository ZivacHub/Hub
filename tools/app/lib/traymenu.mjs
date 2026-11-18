// The tray (background icon) menu as plain data, no Electron import, so plain Node can test it.
// 16.3 adds items through `extras` (e.g. a "Start with Windows" checkbox, project entries): they go between "Open Hub" and "Quit Hub".

/** extras = array of Electron menu-item objects (label, type, checked, click, ...). Returns the menu template. */
export function buildTrayTemplate({ onOpen, onQuit, extras = [] }) {
  const items = [{ label: "Open Hub", click: () => onOpen() }, { type: "separator" }];
  if (extras.length) items.push(...extras, { type: "separator" });
  items.push({ label: "Quit Hub", click: () => onQuit() });
  return items;
}
