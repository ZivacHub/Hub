// The right-click menu of the Hub window (Ivan 2026-11-22: "enable the right click usage as claude desktop use").
// Electron has no right-click menu by default, so copy and paste by mouse did nothing. This builds the menu as plain data
// (role items only: Electron runs the real clipboard actions itself), with no Electron import, so plain Node can test it.
// Rules: a text box gets Undo / Cut / Copy / Paste / Select all (greyed when not possible); selected text elsewhere gets Copy;
// a link gets "Copy link address" (the page itself decides what a click does: this menu never opens anything);
// right-clicking empty space shows no menu at all, so the page's own message menu (project page) is not covered.

/** params = the 'context-menu' event's params from Electron (isEditable, selectionText, editFlags, linkURL, mediaType). Returns the menu template. */
export function buildContextMenuTemplate(params = {}, { copyLink } = {}) {
  const p = params && typeof params === "object" ? params : {};
  const flags = p.editFlags && typeof p.editFlags === "object" ? p.editFlags : {};
  const hasSelection = typeof p.selectionText === "string" && p.selectionText.trim().length > 0;
  const items = [];
  if (p.isEditable === true) {
    items.push(
      { role: "undo", enabled: flags.canUndo !== false },
      { role: "redo", enabled: flags.canRedo !== false },
      { type: "separator" },
      { role: "cut", enabled: flags.canCut !== false && hasSelection },
      { role: "copy", enabled: flags.canCopy !== false && hasSelection },
      { role: "paste", enabled: flags.canPaste !== false },
      { type: "separator" },
      { role: "selectAll", enabled: flags.canSelectAll !== false },
    );
    return items;
  }
  if (hasSelection) items.push({ role: "copy" });
  const link = typeof p.linkURL === "string" && /^https?:\/\//i.test(p.linkURL) ? p.linkURL : null;
  if (link && typeof copyLink === "function") {
    if (items.length) items.push({ type: "separator" });
    items.push({ label: "Copy link address", click: () => copyLink(link) });
  }
  return items;
}
