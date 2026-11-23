// Hub chat workspace (Phase 19; clean-up redesign 2026-11). One chat shown as a real conversation, and nothing else on the page:
//   one slim header band (title with a chevron that opens the chat list, status, Remote Control, compact context bar, "Hand off and pick up", one "..." menu)
//   + the whole conversation from GET /api/chat-log (Claude's replies as markdown, tools folded, question cards, a quiet action row under every message)
//   + one long composer (writing box with Attach and Send inside it, slash commands, one slim banner above it when the chat cannot be answered here)
//   + a "Chat details" rail on the right (closed by default).
// The root element is built ONCE and kept in the page by project.js, so a refresh never loses the draft, the scroll place or open folds.
// Safety: every piece of text goes in with textContent (via h()) or md.js (which never makes HTML from the text). No inline styles (the page's policy forbids them): sizes are set with element.style from here.
import { renderMarkdown } from "./md.js";

const ANSWER_MAX = 4000;
const POLL_WORKING_MS = 15_000;
const POLL_IDLE_MS = 30_000;
const ROUND_POLL_MS = 3_000;
const ROUND_KEEP_MS = 10 * 60_000;
const OUTPUTS_FIRST = 12;
const SOON = 60, NOW = 80;
const STATE_WORD = { working: "Working", idle: "Idle", waiting: "Waiting for you", failed: "Failed", stopped: "Stopped", closed: "Closed" };
const KIND_WORD = { hub: "Hub chat", app: "App chat", terminal: "Terminal chat" };
const SVGNS = "http://www.w3.org/2000/svg";
const ICONS = {
  chev: "M6 3.5 10.5 8 6 12.5", check: "M3 8.5 6.5 12 13 4.5", cross: "M4 4l8 8M12 4l-8 8", down: "M3.5 6 8 10.5 12.5 6", left: "M10 3.5 5.5 8l4.5 4.5",
  clip: "M13 7.4 8 12.4a3 3 0 0 1-4.3-4.3l5.3-5.3a2 2 0 0 1 2.9 2.9L6.8 11a1 1 0 0 1-1.4-1.4l4.7-4.7",
  copy: "M5.5 5.5h7.5v8H5.5zM3 10.5V2.5h7.5",
  pin: "M9.6 2.3 13.7 6.4 12.2 7.1 10.4 9 10.7 11.7 9.9 12.5 3.5 6.1 4.3 5.3 7 5.6 8.9 3.8zM6.6 9.4 2.6 13.4",
  fork: "M3 3.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M3 12.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M10 5.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M4.5 5v6M11.5 7c0 2.6-2.2 3.3-7 3.6",
  play: "M5.2 3.3 12.4 8 5.2 12.7z",
  file: "M4 1.8h5l3 3v9.4H4zM9 1.8v3h3",
  picture: "M2.5 3h11v10h-11zM2.5 11l3.5-3.5 3 3 2-2 2.5 2.5M10.5 6.2h.01",
  speaker: "M2.5 6.2h2.3L8 3.4v9.2L4.8 9.8H2.5zM10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.4 3.8a6 6 0 0 1 0 8.4",
  stop: "M4.5 4.5h7v7h-7z",
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  search: "M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.4 10.4l3.1 3.1",
  panel: "M2.5 3h11v10h-11zM10 3v10",
  plus: "M8 3v10M3 8h10",
  open: "M9 2.5h4.5V7M13.5 2.5 7 9M12 9.5v3.5H3V4h3.5",
  radio: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12z",
  square: "M3 3h10v10H3z",
  dia: "M8 2.5 13.5 8 8 13.5 2.5 8z",
  clock: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8 5v3.2l2 1.3",
  list: "M3 4.5h10M3 8h10M3 11.5h10",
};
export function icon(name) {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", "0 0 16 16"); s.setAttribute("width", "16"); s.setAttribute("height", "16"); s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "1.6"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true"); s.setAttribute("class", "ic ic-" + name);
  const p = document.createElementNS(SVGNS, "path"); p.setAttribute("d", ICONS[name]); s.append(p);
  return s;
}

export function fmtTokens(n) {
  if (!Number.isFinite(n)) return "?";
  if (n >= 1_000_000) { const m = n / 1_000_000; return (Number.isInteger(m) ? String(m) : m.toFixed(1).replace(/\.0$/, "")) + "M"; }
  if (n >= 1000) return Math.round(n / 1000) + "k";
  return String(Math.round(n));
}
export function ctxLevel(pct) { return pct >= NOW ? "now" : pct >= SOON ? "soon" : "ok"; }

function fmtTime(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const t = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const same = d.toDateString() === new Date().toDateString();
  return same ? t : `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${t}`;
}

// ---------- one small real menu (role="menu"): the "..." menus and the right-click menu share it ----------
// items: { label, icon?, onSelect(), disabled?, reason? (shown under a greyed item), checked?, sep? }. Arrow keys, Home/End, Esc, Tab close it; the focus goes back to returnTo().
let menuState = null;
export function closeMenu(restore = true) {
  const m = menuState;
  if (!m) return;
  menuState = null;
  document.removeEventListener("pointerdown", m.onDown, true);
  window.removeEventListener("resize", m.onAway);
  window.removeEventListener("blur", m.onAway);
  document.removeEventListener("wheel", m.onScroll, true);
  document.removeEventListener("touchmove", m.onScroll, true);
  m.el.remove();
  if (m.opener) m.opener.setAttribute("aria-expanded", "false");
  if (restore) { const t = m.returnTo ? m.returnTo() : null; if (t && t.isConnected) t.focus({ preventScroll: true }); }
}
export function menuIsOpen() { return !!menuState; }
export function openMenu({ items, label, anchor = null, point = null, returnTo = null, className = "" }) {
  closeMenu(false);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const el = mk("div", "mn " + className);
  el.setAttribute("role", "menu"); el.setAttribute("aria-label", label || "Menu");
  const btns = [];
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { const sp = mk("div", "mn-sep"); sp.setAttribute("role", "separator"); el.append(sp); continue; }
    const b = mk("button", "mn-item"); b.type = "button"; b.setAttribute("role", it.checked !== undefined ? "menuitemcheckbox" : "menuitem"); b.tabIndex = -1;
    if (it.checked !== undefined) b.setAttribute("aria-checked", String(!!it.checked));
    if (it.disabled) b.setAttribute("aria-disabled", "true");
    const ic = mk("span", "mn-ic"); if (it.icon) ic.append(icon(it.icon)); b.append(ic);
    const tx = mk("span", "mn-tx"); tx.append(mk("span", "mn-lab", it.label));
    if (it.disabled && it.reason) tx.append(mk("span", "mn-why", it.reason));
    b.append(tx);
    if (it.badge) b.append(mk("span", "mn-badge", it.badge));
    b.addEventListener("click", () => {
      if (it.disabled) return;
      closeMenu(true);
      if (it.onSelect) it.onSelect();
    });
    btns.push(b); el.append(b);
  }
  const onKey = (e) => {
    const i = btns.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
    else if (e.key === "Home") { e.preventDefault(); btns[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); btns[btns.length - 1].focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
    else if (e.key === "Tab") { e.preventDefault(); closeMenu(true); }
  };
  el.addEventListener("keydown", onKey);
  const m = {
    el, opener: anchor, returnTo,
    onDown: (e) => { if (!el.contains(e.target) && !(anchor && anchor.contains(e.target))) closeMenu(false); },
    onAway: () => closeMenu(false),
    onScroll: (e) => { if (!el.contains(e.target)) closeMenu(false); },
  };
  menuState = m;
  document.body.append(el);
  const r = el.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
  let x, y;
  if (point) { x = point.x; y = point.y; }
  else if (anchor) { const a = anchor.getBoundingClientRect(); x = a.right - r.width; y = a.bottom + 4; if (y + r.height > vh - 8 && a.top - r.height - 4 > 8) y = a.top - r.height - 4; }
  else { x = 8; y = 8; }
  x = Math.max(8, Math.min(x, vw - r.width - 8)); y = Math.max(8, Math.min(y, vh - r.height - 8));
  el.style.left = `${Math.round(x)}px`; el.style.top = `${Math.round(y)}px`;
  if (anchor) anchor.setAttribute("aria-expanded", "true");
  document.addEventListener("pointerdown", m.onDown, true);
  window.addEventListener("resize", m.onAway);
  window.addEventListener("blur", m.onAway);
  document.addEventListener("wheel", m.onScroll, { capture: true, passive: true });
  document.addEventListener("touchmove", m.onScroll, { capture: true, passive: true });
  (btns.find((b) => b.getAttribute("aria-disabled") !== "true") || btns[0] || el).focus({ preventScroll: true });
  return el;
}

// ---------- attachments: what the page checks before it uploads (the Hub checks again, by the file's first bytes) ----------
const ATT_MAX = 4;
const ATT_BIG = 10 * 1024 * 1024, ATT_TEXT = 1024 * 1024;
const ATT_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.markdown,.csv,.json,image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv,application/json";
const ATT_WORDS = {
  svg: "SVG pictures and web pages can't be attached.",
  other: "This kind of file can't be attached. Use a picture (PNG, JPEG, GIF or WebP), a PDF, or a text file (text, Markdown, CSV or JSON).",
  big: "Files can be at most 10 MB.", bigText: "Text files can be at most 1 MB.", empty: "The file is empty.", many: "At most 4 files per message.",
  lost: "The Hub did not answer. Try attaching it again.",
};
export function precheckFile(f) {
  const name = String(f && f.name ? f.name : "");
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const type = String(f && f.type ? f.type : "").toLowerCase();
  let kind = "";
  if (type === "image/svg+xml" || type === "text/html" || type === "application/xhtml+xml" || /xml$/.test(type) || ["svg", "svgz", "html", "htm", "xhtml", "xml"].includes(ext)) return { kind: "", error: ATT_WORDS.svg };
  if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(type) || ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) kind = "image";
  else if (type === "application/pdf" || ext === "pdf") kind = "pdf";
  else if (["text/plain", "text/markdown", "text/csv", "application/json"].includes(type) || ["txt", "md", "markdown", "csv", "json"].includes(ext)) kind = "text";
  else return { kind: "", error: ATT_WORDS.other };
  if (!f.size) return { kind, error: ATT_WORDS.empty };
  if (kind === "text" && f.size > ATT_TEXT) return { kind, error: ATT_WORDS.bigText };
  if (f.size > ATT_BIG) return { kind, error: ATT_WORDS.big };
  return { kind, error: "" };
}
export function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
const KIND_LABEL = { image: "Picture", pdf: "PDF", text: "Text file" };
const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";

const commandCache = new Map();   // project name -> the command list, asked once per page load
async function getJson(url) {
  const r = await fetch(url, { cache: "no-store" });
  let json = null;
  try { json = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, json };
}

// deps: { h, ago, send, appIdOf, setNote, onChanged, onRoundDone, getToken(fresh), projectName() }
export function createChatView(deps) {
  const { h, ago, send, appIdOf, setNote } = deps;
  const drafts = new Map();        // chat id -> half-typed message
  const atts = new Map();          // chat id -> attached files [{ key, chatId, name, size, kind, status: uploading|done|error, pct, error, thumb, uploadId }]; kept until a full reload
  const seenPics = new Set();      // picture addresses that loaded once (no placeholder flash on a redraw)
  let attSeq = 0, dragDepth = 0, pinBusy = false, copyTick = 0, lbOpener = "";
  const results = new Map();       // chat id -> last answer result of a closed app chat
  const rounds = new Map();        // chat id -> hand-off round { roundId, state, steps, error, next, result, finishedLocal, dismissed }
  const st = {
    chat: null, id: null, visible: false,
    messages: [], total: 0, context: null, meta: null, savedOk: true,
    loading: false, error: "", olderBusy: false, olderErr: "",
    stick: true, top: 0, openTools: new Set(), sig: "", outputsAll: false,
    ask: null, sending: false, roundMsg: "",
    timer: null, timerMs: 0, fetching: false, sideOpen: null,
  };

  // ---------- the fixed frame ----------
  const titleEl = h("h3", { class: "cv-title", id: "cv-title", tabindex: "-1" });
  const chatsBtn = h("button", { class: "cv-ibtn cv-chev", type: "button", "data-k": "chats", "aria-haspopup": "dialog", "aria-label": "Switch chat", title: "Switch chat" }, icon("down"));
  const tagsEl = h("div", { class: "cv-tags" });
  const ctxEl = h("div", { class: "cv-ctx-wrap" });
  const menuBtn = h("button", { class: "cv-ibtn cv-more", type: "button", "data-k": "menu", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": "Chat menu", title: "Chat menu" }, icon("more"));
  const bandEl = h("div", { class: "cv-band" }, h("div", { class: "cv-titlewrap" }, titleEl, chatsBtn), tagsEl, h("span", { class: "cv-fill" }), ctxEl, menuBtn);
  const askEl = h("div", { class: "cv-askbar", hidden: true });
  const roundEl = h("div", { class: "cv-round", hidden: true });
  const roundLive = h("p", { class: "sr", role: "status" });
  const bannerEl = h("p", { class: "cv-banner", role: "status", hidden: true });
  const thread = h("div", { class: "cv-thread" });
  const scroll = h("div", { class: "cv-scroll", tabindex: "0", role: "region", "aria-label": "Conversation" }, thread);
  const jump = h("button", { class: "btn cv-jump", type: "button", "data-k": "jump", hidden: true }, icon("down"), "Jump to latest");
  const scrollWrap = h("div", { class: "cv-scrollwrap" }, scroll, jump);
  const composer = h("div", { class: "cv-composer" });
  const side = h("aside", { class: "cv-side", "aria-label": "Chat details" });
  const grid = h("div", { class: "cv-grid" }, h("div", { class: "cv-main" }, bannerEl, scrollWrap, composer), side);
  const attSay = h("p", { class: "sr", role: "status" });
  const fileInput = h("input", { type: "file", multiple: true, class: "sr", tabindex: "-1", "aria-hidden": "true", accept: ATT_ACCEPT });
  // the large view of a picture: a native dialog (Esc closes it, the focus goes back to the picture that opened it)
  const lbImg = h("img", { class: "cv-lb-img", alt: "" });
  const lbName = h("span", { class: "cv-lb-name" });
  const lb = h("dialog", { class: "cv-lb", "aria-label": "Picture, large view" },
    h("div", { class: "cv-lb-bar" }, lbName, h("button", { class: "btn", type: "button", "data-k": "lb-close" }, icon("cross"), "Close")),
    h("div", { class: "cv-lb-stage" }, lbImg));
  const el = h("section", { class: "cw", "aria-labelledby": "cv-title" }, bandEl, askEl, roundEl, roundLive, attSay, grid, fileInput, lb);

  const ta = h("textarea", { id: "cv-ta", class: "cv-ta", rows: "3", maxlength: String(ANSWER_MAX), "aria-describedby": "cv-hint", placeholder: "Write your message" });
  let countEl = null;

  // ---------- focus and scroll that survive a redraw ----------
  function focusKey() {
    const ae = document.activeElement;
    if (!ae || !el.contains(ae)) return null;
    if (ae === ta) return { ta: true, a: ta.selectionStart, b: ta.selectionEnd };
    if (!ae.dataset || !ae.dataset.k) return null;
    const f = { k: ae.dataset.k, id: ae.dataset.id || "" };
    if (ae.tagName === "INPUT" && ae.type === "text") { f.a = ae.selectionStart; f.b = ae.selectionEnd; }
    return f;
  }
  function putFocus(f) {
    if (!f) return;
    if (f.ta) { if (ta.isConnected && !ta.disabled) { ta.focus({ preventScroll: true }); try { ta.setSelectionRange(f.a, f.b); } catch { /* ignore */ } } return; }
    const b = [...el.querySelectorAll("[data-k]")].find((x) => x.dataset.k === f.k && (x.dataset.id || "") === f.id);
    if (b) { b.focus({ preventScroll: true }); if (f.a !== undefined && f.a !== null) { try { b.setSelectionRange(f.a, f.b); } catch { /* ignore */ } } }
  }
  function withFocus(fn) { const f = focusKey(); fn(); putFocus(f); }

  const atBottom = () => (scroll.clientHeight === 0 ? st.stick : scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 48);
  function toBottom() { scroll.scrollTop = scroll.scrollHeight; }
  function updateJump() { jump.hidden = atBottom() || !st.messages.length; }
  scroll.addEventListener("scroll", () => { if (scroll.clientHeight) { st.stick = atBottom(); st.top = scroll.scrollTop; } updateJump(); }, { passive: true });

  // project.js moves this element when it redraws the page; a moved element loses its scroll place, so it is put back here
  let saved = null;
  function snapshot() { saved = { focus: focusKey() }; }
  function restore() {
    if (st.stick) toBottom(); else scroll.scrollTop = st.top;
    updateJump();
    if (saved) putFocus(saved.focus);
    saved = null;
  }

  // ---------- helpers on the chat ----------
  const c = () => st.chat;
  const isHub = () => !!st.chat && st.chat.kind === "hub" && /^h-/.test(st.chat.id);
  const roundOf = (id) => rounds.get(id) || null;
  function visibleRound(id = st.id) {
    const r = roundOf(id);
    if (!r || r.dismissed) return null;
    if (r.state === "running") return r;
    const fin = r.finishedLocal || Date.parse(r.finishedAt) || 0;
    return Date.now() - fin < ROUND_KEEP_MS ? r : null;
  }
  const roundRunning = (id = st.id) => { const r = roundOf(id); return !!r && r.state === "running"; };
  function rcValue() {
    if (st.chat && (st.chat.remoteControl === true || st.chat.remoteControl === false)) return st.chat.remoteControl;
    if (st.meta && (st.meta.remoteControl === true || st.meta.remoteControl === false)) return st.meta.remoteControl;
    return null;
  }
  const rcWord = () => { const v = rcValue(); return v === true ? "On" : v === false ? "Off" : "Unknown"; };
  // a real switch only for a Hub chat the Hub runs itself: turning it OFF is always possible, turning it ON only while the chat rests (the same rule as the dashboard)
  const rcSwitchable = () => isHub() && !!st.chat && (rcValue() === true || (rcValue() === false && st.chat.canAnswer === true));
  // Fork: only a resting Hub chat with Remote Control off (the Hub's engine refuses everything else in words)
  const forkable = () => isHub() && !!st.chat && st.chat.canAnswer === true && rcValue() === false && !roundRunning();
  // Resume: a closed or stopped chat that can be answered from here; it only moves the cursor to the message box
  const resumable = () => { const k = mode().kind; return !!st.chat && (st.chat.state === "closed" || st.chat.state === "stopped") && (k === "hub-write" || k === "app-write"); };
  const pctNow = () => (st.context && Number.isFinite(st.context.percent) ? st.context.percent : null);

  // ---------- header band: title, status, Remote Control; context bar, hand-off button and the "..." menu on the right ----------
  const isResting = () => !!st.chat && (st.chat.state === "idle" || st.chat.state === "waiting");
  const isWaiting = () => !!st.chat && st.chat.state !== "working" && (st.chat.state === "waiting" || st.chat.needsYou === true);
  const RC_HINT = {
    on: "Remote Control is on: you can reach this chat from your phone. The Hub can't write into it while this is on.",
    off: "Remote Control is off: this chat is not open to your phone.",
    unknown: "Remote Control is unknown: the Claude app did not tell the Hub.",
    terminal: "Remote Control is unknown: a terminal chat does not tell the Hub.",
  };
  function drawHead() {
    const ch = c();
    if (!ch) return;
    const state = STATE_WORD[ch.state] && ch.state !== "waiting" ? ch.state : "idle";
    titleEl.textContent = ch.title || "Chat";
    const rv = rcValue();
    const showRc = !(ch.kind === "terminal" && rv === null);
    const status = isWaiting()
      ? h("span", { class: "cneeds", title: ch.why === "permission" ? "Waiting for your permission" : ch.why === "question" ? "Waiting for your answer" : null }, "Waiting for you")
      : h("span", { class: "cstate cs-" + state }, STATE_WORD[state]);
    const rcHint = rv === true ? RC_HINT.on : rv === false ? RC_HINT.off : ch.kind === "terminal" ? RC_HINT.terminal : RC_HINT.unknown;
    withFocus(() => tagsEl.replaceChildren(...[
      status,
      showRc ? h("span", { class: "crc" + (rv === true ? " on" : rv === null ? " unk" : ""), title: rcHint }, "Remote Control ", h("b", {}, rcWord())) : null,
      ch.pinned === true ? h("span", { class: "cpinned", title: "Pinned" }, icon("pin"), h("span", { class: "sr" }, "Pinned")) : null].filter(Boolean)));
    drawPinRows();
  }

  function askRow(ask) {
    let nameBox = null;
    if (typeof ask.name === "string") {
      const inp = h("input", { class: "cv-ask-input", type: "text", id: "cv-fork-name", maxlength: "80", "data-k": "fork-name", placeholder: "Name of the copy (optional)", autocomplete: "off" });
      inp.value = ask.name;
      nameBox = h("div", { class: "ask-name" }, h("label", { for: "cv-fork-name", class: "sr" }, "Name of the copy (optional)"), inp);
    }
    return h("div", { class: "actions ask", role: "group", "aria-label": ask.text },
      h("div", { class: "ask-text" }, h("b", {}, ask.text), ask.extra ? h("span", {}, ask.extra) : null),
      nameBox,
      h("button", { class: "btn primary", type: "button", "data-k": "yes" }, "Yes"),
      h("button", { class: "btn", type: "button", "data-k": "cancel" }, "Cancel"));
  }

  function drawContext() {
    withFocus(() => {
      const ch = c();
      const kids = [];
      const ctx = st.context;
      const pct = pctNow();
      if (!ch) { ctxEl.replaceChildren(); askEl.replaceChildren(); askEl.hidden = true; return; }
      if (pct === null) {
        kids.push(h("p", { class: "cv-ctx-none" }, st.loading ? "Context: reading…" : "Context: not known"));
      } else {
        const lv = ctxLevel(pct);
        const used = ctx.usedTokens, win = ctx.windowTokens;
        const label = `Context: ${pct}% full (about ${fmtTokens(used)} of ${fmtTokens(win)})`;
        const bar = h("div", { class: "cv-bar lv-" + lv, role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.min(100, pct), "aria-label": label },
          fillEl(Math.min(100, pct)), tickEl(SOON), tickEl(NOW));
        kids.push(h("div", { class: "cv-ctx" },
          h("p", { class: "cv-ctx-label" }, h("b", {}, `Context ${pct}% full`), h("span", { class: "cv-ctx-sub" }, `${fmtTokens(used)} of ${fmtTokens(win)}${ctx.estimated ? ", estimate" : ""}`),
            lv === "soon" ? h("b", { class: "cv-lv lv-soon" }, "Time to hand off soon") : lv === "now" ? h("b", { class: "cv-lv lv-now" }, "Hand off now") : null),
          bar));
        const ho = handoffControl(pct);
        if (ho) kids.push(ho);
      }
      const asks = [];
      if (st.ask && st.ask.where === "ctx") asks.push(askRow(st.ask));
      if (st.roundMsg) asks.push(h("p", { class: "cv-ctx-err", role: "status" }, st.roundMsg));
      ctxEl.replaceChildren(...kids);
      askEl.replaceChildren(...asks);
      askEl.hidden = !asks.length;
    });
    // after the redraw (the redraw gives focus back to what had it before): a fresh question takes the focus on its Yes button
    if (st.ask && st.ask.where === "ctx" && st.ask.fresh) { st.ask.fresh = false; const y = askEl.querySelector(st.ask.kind === "fork" ? '[data-k="fork-name"]' : '[data-k="yes"]'); if (y) y.focus(); }
  }
  function fillEl(pct) { const i = document.createElement("i"); i.style.width = `${pct}%`; return i; }
  function tickEl(at) { const i = document.createElement("i"); i.className = "cv-tick"; i.style.left = `${at}%`; return i; }

  function roundWhy() {
    const ch = c();
    if (rcValue() === true) return "Turn Remote Control off first.";
    if (!isResting()) return ch.state === "working" ? "Wait until Claude stops working." : "Only a resting chat can be handed off.";
    if (roundRunning()) return "A hand-off is already running.";
    return "";
  }
  // "Hand off and pick up": always there on Hub chats (D59); a glow from 60 percent (amber) and 80 percent (red-orange); pressed only by Ivan, after a question
  function handoffControl(pct) {
    if (!isHub()) return null;
    if (visibleRound()) return null;
    const why = roundWhy();
    const asking = st.ask && st.ask.kind === "round";
    return h("div", { class: "cv-ho" },
      h("button", { class: "btn cv-hobtn" + (pct >= NOW ? " primary glow-now" : pct >= SOON ? " glow-soon" : ""), type: "button", "data-k": "round", disabled: !!why || asking || st.sending, title: why || null, "aria-describedby": why ? "cv-ho-why" : null }, "Hand off and pick up"),
      why ? h("span", { class: "sr", id: "cv-ho-why" }, why) : null);
  }

  // ---------- the chat menu ("..." in the header) ----------
  const answerWhy = () => {
    const ch = c();
    if (roundRunning()) return "A hand-off is running.";
    if (rcValue() === true) return "Turn Remote Control off first.";
    if (ch.state === "working") return "Wait until Claude stops working.";
    if (ch.canAnswer !== true) return "This chat can't take a message right now.";
    return "";
  };
  const forkWhy = () => (!isHub() ? "Only Hub chats can be copied for now." : answerWhy() || (rcValue() !== false ? "Turn Remote Control off first." : ""));
  function chatMenuItems() {
    const ch = c();
    if (!ch) return [];
    const items = [];
    const pinned = ch.pinned === true;
    items.push({ label: pinned ? "Unpin this chat" : "Pin this chat", icon: "pin", disabled: pinBusy, onSelect: () => togglePin() });
    items.push(forkable() ? { label: "Fork this chat", icon: "fork", onSelect: () => startAsk("fork") } : { label: "Fork this chat", icon: "fork", disabled: true, reason: forkWhy() });
    if (rcSwitchable()) items.push({ label: rcValue() === true ? "Turn Remote Control off" : "Turn Remote Control on", onSelect: () => startAsk("rc") });
    else items.push({ label: "Remote Control", disabled: true, reason: isHub() ? (rcValue() === false ? "You can switch it on once Claude stops working." : "The Hub can't tell if it is on.") : ch.kind === "app" ? "Switch it in the Claude app. The Hub can't change it there." : "A terminal chat does not tell the Hub." });
    const hubLink = ch.kind === "hub" && typeof ch.openLink === "string" && ch.openLink.startsWith("claude://resume?session=");
    const appId = ch.kind === "app" ? appIdOf(ch.openLink) : null;
    if (hubLink) items.push({ label: "Open this chat in the app", icon: "open", onSelect: () => openIn({ action: "chat-open-app", hubId: st.id }) });
    else if (appId) items.push({ label: "Open this chat in the app", icon: "open", onSelect: () => openIn({ action: "chat-open-app", appId }) });
    if (isHub()) {
      items.push({ sep: true });
      const why = answerWhy();
      items.push({ label: "Hand off", disabled: !!why || !!st.ask || st.sending, reason: why, onSelect: () => startAsk("handoff") });
      items.push({ label: "Pick up", disabled: !!why || !!st.ask || st.sending, reason: why, onSelect: () => startAsk("pickup") });
    }
    if (resumable()) items.push({ label: "Resume: write the next message", icon: "play", onSelect: () => { if (!ta.disabled) { ta.focus(); composer.scrollIntoView({ block: "nearest" }); } } });
    items.push({ sep: true });
    items.push({ label: "Chat details", icon: "panel", checked: !!st.sideOpen, onSelect: () => setSide(!st.sideOpen) });
    if (isHub() && ch.state === "working") items.push({ label: "Stop this chat", icon: "stop", disabled: !!st.ask || st.sending, onSelect: () => startAsk("stop") });
    return items;
  }
  function openChatMenu() { openMenu({ items: chatMenuItems(), label: "Chat menu", anchor: menuBtn, returnTo: () => menuBtn }); }

  // ---------- hand-off progress ----------
  function drawRound() {
    const r = visibleRound();
    if (!r) { roundEl.hidden = true; roundEl.replaceChildren(); return; }
    roundEl.hidden = false;
    const running = r.state === "running";
    const steps = Array.isArray(r.steps) ? r.steps : [];
    const title = running ? "Handing off and picking up…" : r.state === "done" ? "Hand-off finished" : "Hand-off stopped";
    const list = steps.map((s, i) => {
      const last = i === steps.length - 1;
      const bad = s.ok === false;
      const now = running && last && !bad;
      return h("li", { class: "cv-step" + (bad ? " bad" : now ? " now" : " done"), "aria-current": now ? "step" : null },
        h("span", { class: "cv-step-mark" }, bad ? icon("cross") : now ? h("span", { class: "cv-pulse" }) : icon("check"), h("span", { class: "sr" }, bad ? "Failed: " : now ? "Now: " : "Done: ")),
        h("span", { class: "cv-step-text" }, s.text || ""));
    });
    if (running && !steps.length) list.push(h("li", { class: "cv-step now", "aria-current": "step" }, h("span", { class: "cv-step-mark" }, h("span", { class: "cv-pulse" }), h("span", { class: "sr" }, "Now: ")), h("span", { class: "cv-step-text" }, "Starting…")));
    const kids = [h("h4", { class: "cv-round-title" }, title), h("ol", { class: "cv-steps" }, list)];
    if (r.state === "done") {
      const nm = r.result && r.result.newName ? r.result.newName : "a new chat";
      kids.push(h("p", { class: "cv-round-end ok" }, `Done: a new chat started: ${nm} (it is now your latest chat)`));
    } else if (r.state === "failed" || r.state === "lost") {
      kids.push(h("p", { class: "cv-round-end bad" }, r.error || "The hand-off did not finish."));
      if (r.next) kids.push(h("p", { class: "cv-round-next" }, r.next));
    }
    if (!running) kids.push(h("div", { class: "actions" }, h("button", { class: "btn", type: "button", "data-k": "round-dismiss" }, "Close this")));
    withFocus(() => roundEl.replaceChildren(...kids));
    const lastLine = steps.length ? steps[steps.length - 1].text : "";
    const spoken = r.state === "running" ? lastLine : r.state === "done" ? "Hand-off done. A new chat started." : (r.error || "");
    if (roundLive.textContent !== spoken) roundLive.textContent = spoken;
  }

  let roundTimer = null;
  function adopt(r, chatId) {
    if (!r || typeof r !== "object" || typeof r.state !== "string") return null;
    const prev = rounds.get(chatId) || {};
    const next = { ...prev, ...r, steps: Array.isArray(r.steps) ? r.steps : prev.steps || [] };
    if (next.state !== "running" && !next.finishedLocal) next.finishedLocal = Date.now();
    rounds.set(chatId, next);
    return next;
  }
  function ensureRoundPoll() {
    if (roundTimer || ![...rounds.values()].some((r) => r.state === "running")) return;
    roundTimer = setInterval(pollRounds, ROUND_POLL_MS);
  }
  async function pollRounds() {
    const running = [...rounds.entries()].filter(([, r]) => r.state === "running" && r.roundId);
    if (!running.length) { clearInterval(roundTimer); roundTimer = null; return; }
    for (const [chatId, r] of running) {
      let res;
      try { res = await getJson(`/api/chat-handoff?round=${encodeURIComponent(r.roundId)}`); } catch { continue; }
      if (res.status === 404) {
        adopt({ state: "lost", error: "The Hub lost track of this hand-off (it may have restarted). Nothing was stopped or deleted.", next: "Look at the All chats tab for the new chat. If it is not there, start a new chat with /pickup yourself." }, chatId);
      } else if (res.ok && res.json) {
        const body = res.json.round !== undefined ? res.json.round : res.json;
        const before = r.state;
        const now = adopt(body, chatId);
        if (now && before === "running" && now.state !== "running") finished(chatId, now);
      } else continue;
      if (chatId === st.id) drawRound();
      drawContext();
    }
    if (![...rounds.values()].some((r) => r.state === "running")) { clearInterval(roundTimer); roundTimer = null; }
  }
  function finished(chatId, r) {
    if (r.state === "done") {
      const nm = r.result && r.result.newName ? r.result.newName : "a new chat";
      setNote(`Done: a new chat started: ${nm} (it is now your latest chat)`);
      if (deps.onRoundDone) deps.onRoundDone(r);
    } else setNote(r.error || "The hand-off did not finish.", true);
    if (deps.onChanged) deps.onChanged();
  }
  async function findRound(chatId) {
    if (!/^h-/.test(chatId)) return;
    let res;
    try { res = await getJson(`/api/chat-handoff?chat=${encodeURIComponent(chatId)}`); } catch { return; }
    if (!res.ok || !res.json) return;
    const body = res.json.round !== undefined ? res.json.round : res.json;
    if (!body || typeof body !== "object" || typeof body.state !== "string") return;
    const fin = Date.parse(body.finishedAt) || 0;
    if (body.state !== "running" && (!fin || Date.now() - fin >= ROUND_KEEP_MS)) return;
    const r = adopt(body, chatId);
    if (r && r.state !== "running") r.finishedLocal = fin;
    ensureRoundPoll();
    if (chatId === st.id) { drawRound(); drawContext(); drawComposer(); }
  }

  // ---------- the conversation ----------
  function drawThread(opts = {}) {
    const wasBottom = opts.force ? true : atBottom();
    const prevH = scroll.scrollHeight, prevTop = scroll.scrollTop;
    const kids = [];
    if (st.meta && st.meta.olderPartCut) kids.push(h("p", { class: "cv-cut" }, "This chat is very long: only its last part is shown."));
    if (st.messages.length && st.messages[0].i > 0) {
      kids.push(h("div", { class: "cv-older" },
        h("button", { class: "btn", type: "button", "data-k": "older", disabled: st.olderBusy }, st.olderBusy ? "Loading…" : "Show older messages"),
        st.olderErr ? h("span", { class: "cv-older-err", role: "status" }, st.olderErr) : null));
    }
    if (!st.messages.length) {
      if (st.loading) kids.push(h("p", { class: "cv-state", role: "status" }, "Reading the conversation…"));
      else if (st.error) kids.push(errorBlock());
      else kids.push(h("p", { class: "cv-state" }, st.savedOk ? "No messages in this chat yet." : "This chat's saved file is not there yet. The messages show up once Claude has saved some."));
    } else {
      for (const g of groups(st.messages)) kids.push(g.role === "user" ? userMsg(g.msgs[0]) : claudeMsg(g));
    }
    thread.replaceChildren(...kids);
    drawPinRows(); paintSpeak();
    if (opts.anchorOlder) scroll.scrollTop = prevTop + (scroll.scrollHeight - prevH);
    else if (wasBottom) toBottom();
    else scroll.scrollTop = prevTop;
    if (scroll.clientHeight) st.stick = atBottom();
    updateJump();
  }
  function errorBlock() {
    const ch = c();
    return h("div", { class: "cv-fail" },
      h("p", { class: "cv-fail-title" }, "Could not read this chat's messages."),
      h("p", { class: "cv-fail-why" }, st.error),
      h("button", { class: "btn", type: "button", "data-k": "retry" }, "Try again"),
      ch && ch.lastSaid ? h("div", { class: "cv-fallback" }, h("span", { class: "cp-label" }, "Claude last said"), h("div", { class: "said-text" }, ch.lastSaid)) : null);
  }
  function groups(msgs) {
    const out = [];
    for (const m of msgs) {
      const last = out[out.length - 1];
      if (m.role === "assistant" && last && last.role === "assistant") last.msgs.push(m);
      else out.push({ role: m.role === "user" ? "user" : "assistant", msgs: [m] });
    }
    return out;
  }
  // ----- pictures and files in the conversation -----
  const picSrc = (b) => `/api/chat-image?id=${encodeURIComponent(st.id)}&m=${b.m}&b=${b.b}`;
  function brokenPic(name) {
    return h("div", { class: "cv-pic-broken" }, icon("picture"), h("span", {}, "Picture could not be loaded"), name ? h("span", { class: "cv-pic-broken-name" }, name) : null);
  }
  function pictureEl(b) {
    if (!st.id || !Number.isInteger(b.m) || !Number.isInteger(b.b)) return h("figure", { class: "cv-pic" }, brokenPic(b.name));
    const src = picSrc(b);
    const label = b.name ? `Picture: ${b.name}` : "Picture in the conversation";
    const known = seenPics.has(src);
    const img = h("img", { class: "cv-pic-img", src, alt: label, loading: "lazy", decoding: "async" });
    const btn = h("button", { class: "cv-pic-btn", type: "button", "data-k": "pic", "data-id": `${b.m}:${b.b}`, "aria-label": `View large: ${b.name || "picture"}` }, img);
    const fig = h("figure", { class: "cv-pic" + (known ? "" : " is-loading") }, btn, b.name ? h("figcaption", { class: "cv-pic-cap" }, b.name) : null);
    img.addEventListener("load", () => {
      seenPics.add(src); fig.classList.remove("is-loading");
      if (st.stick && scroll.clientHeight) { toBottom(); updateJump(); }
    });
    img.addEventListener("error", () => { fig.classList.remove("is-loading"); btn.replaceWith(brokenPic("")); });
    return fig;
  }
  function fileChip(b) {
    const word = b.name || (b.mediaType === "application/pdf" ? "PDF" : "File");
    return h("div", { class: "cv-fileitem" }, icon("file"), h("span", { class: "cv-fileitem-name" }, word), Number.isFinite(b.bytes) ? h("span", { class: "cv-fileitem-size" }, fmtBytes(b.bytes)) : null);
  }
  const textOf = (msgs) => msgs.flatMap((m) => (m.blocks || []).filter((b) => b.type === "text" && b.text).map((b) => b.text)).join("\n\n");
  const groupAt = (i) => groups(st.messages).find((x) => x.msgs[0].i === i) || null;

  // ----- the quiet row under EVERY message (always visible): Copy, Fork, Pin, Read aloud, and the time at the right end -----
  const forkTitle = () => (forkable() ? "Fork this chat: start a new chat from everything said here" : `Fork this chat: ${forkWhy().replace(/\.$/, "").toLowerCase()}`);
  function actBtn(k, ic, label, id) {
    return h("button", { class: "cv-act", type: "button", "data-k": k, "data-id": String(id), "aria-label": label, title: label }, icon(ic));
  }
  function actRow(msgs) {
    const i = msgs[0].i;
    const hasText = !!textOf(msgs).trim();
    const kids = [];
    if (hasText) kids.push(actBtn("copy", "copy", "Copy message", i));
    if (isHub()) kids.push(actBtn("fork", "fork", "Fork this chat", i));
    kids.push(actBtn("pin", "pin", "Pin this chat", i));
    if (hasText && canSpeak) kids.push(actBtn("speak", "speaker", "Read aloud", i));
    const at = msgs[msgs.length - 1].at;
    return h("div", { class: "cv-acts", role: "group", "aria-label": "Message actions" }, ...kids, at ? h("time", { class: "cv-time", datetime: at }, fmtTime(at)) : null);
  }
  // keeps the Pin and Fork icons in every row in step with the chat (state, "pressed", why Fork is off)
  function drawPinRows() {
    const ch = c();
    if (!ch) return;
    const pinned = ch.pinned === true;
    for (const b of thread.querySelectorAll('.cv-act[data-k="pin"]')) {
      b.setAttribute("aria-pressed", String(pinned));
      const t = pinned ? "Unpin this chat" : "Pin this chat";
      b.setAttribute("aria-label", t); b.title = t; b.disabled = pinBusy;
    }
    const can = forkable() && !st.ask && !st.sending;
    for (const b of thread.querySelectorAll('.cv-act[data-k="fork"]')) { b.disabled = !can; b.title = forkTitle(); }
  }
  function userMsg(m) {
    const parts = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const text = run.join("\n\n");
      parts.push(h("div", { class: "cv-bubble" + (/^\/[\w:-]+/.test(text) && !text.includes("\n") ? " cmd" : "") }, text));
      run = [];
    };
    for (const b of m.blocks || []) {
      if (b.type === "text") run.push(b.text);
      else if (b.type === "image") { flush(); parts.push(pictureEl(b)); }
      else if (b.type === "file") { flush(); parts.push(fileChip(b)); }
    }
    flush();
    if (!parts.length) parts.push(h("div", { class: "cv-bubble" }, "(empty)"));
    return h("article", { class: "cv-msg cv-u", "data-mi": String(m.i), tabindex: "-1", "aria-label": "You" }, ...parts, actRow([m]));
  }
  function claudeMsg(g) {
    const body = h("div", { class: "cv-body" });
    let tools = null;
    for (const m of g.msgs) {
      (m.blocks || []).forEach((b, bi) => {
        if (b.type === "image") { tools = null; body.append(pictureEl(b)); }
        else if (b.type === "file") { tools = null; body.append(fileChip(b)); }
        else if (b.type === "tool") {
          if (!tools) { tools = h("ul", { class: "cv-tools" }); body.append(tools); }
          tools.append(toolItem(b, `${m.i}:${bi}`));
        } else if (b.type === "question") {
          tools = null;
          const card = questionCard(b, `${m.i}:${bi}`);
          if (card) body.append(card);
        } else if (b.type === "text" && b.text) {
          tools = null;
          const box = h("div", { class: "md cv-md" });
          try { box.append(renderMarkdown(b.text, { document })); } catch { box.textContent = b.text; }
          body.append(box);
        }
      });
    }
    if (!body.childNodes.length) body.append(h("p", { class: "cv-empty-reply" }, "(no text in this reply)"));
    return h("article", { class: "cv-msg cv-c", "data-mi": String(g.msgs[0].i), tabindex: "-1", "aria-label": "Claude" }, body, actRow(g.msgs));
  }

  // ----- question cards (feed block "question"): drawn like the Claude app, read-only. The card never sends anything. -----
  const qPage = new Map();         // block key -> the question shown (a block can hold several)
  const qBlocks = new Map();       // block key -> the block, for the pager
  const plainLabel = (t) => String(t || "").replace(/\s*\(recommended\)\s*$/i, "").trim().toLowerCase();
  function answerTexts(b, qs, page) {
    const a = b.answer;
    if (a === undefined || a === null || a === "") return [];
    if (Array.isArray(a)) { const v = qs.length > 1 && a.length === qs.length ? a[page] : a; return (Array.isArray(v) ? v : [v]).map(String).filter(Boolean); }
    if (typeof a === "object") { const v = a[qs[page].question] !== undefined ? a[qs[page].question] : Object.values(a)[page]; return v === undefined ? [] : (Array.isArray(v) ? v : [v]).map(String).filter(Boolean); }
    return [String(a)];
  }
  function questionCard(b, key) {
    const qs = Array.isArray(b.questions) ? b.questions.filter((q) => q && typeof q.question === "string" && q.question) : [];
    if (!qs.length) return null;
    qBlocks.set(key, b);
    const page = Math.max(0, Math.min(qPage.get(key) || 0, qs.length - 1));
    const q = qs[page];
    const multi = q.multiSelect === true;
    const answered = b.answered === true;
    const texts = answered ? answerTexts(b, qs, page) : [];
    const opts = Array.isArray(q.options) ? q.options.filter((o) => o && typeof o.label === "string") : [];
    const joined = texts.map((t) => t.toLowerCase());
    const chosen = opts.map((o) => { const l = plainLabel(o.label); return !!l && joined.some((t) => t === o.label.toLowerCase() || t === l || t.includes(l)); });
    const unmatched = answered && texts.length > 0 && !chosen.some(Boolean);
    const rows = opts.map((o, i) => h("li", { class: "cv-q-opt" + (chosen[i] ? " on" : ""), role: multi ? "checkbox" : "radio", "aria-checked": String(chosen[i]), "aria-disabled": "true" },
      h("span", { class: "cv-q-mark" + (multi ? " sq" : ""), "aria-hidden": "true" }, chosen[i] && multi ? icon("check") : null),
      h("span", { class: "cv-q-opt-tx" }, h("span", { class: "cv-q-lab" }, o.label), o.description ? h("span", { class: "cv-q-desc" }, o.description) : null)));
    if (unmatched) {
      rows.push(h("li", { class: "cv-q-opt on", role: multi ? "checkbox" : "radio", "aria-checked": "true", "aria-disabled": "true" },
        h("span", { class: "cv-q-mark" + (multi ? " sq" : ""), "aria-hidden": "true" }, multi ? icon("check") : null),
        h("span", { class: "cv-q-opt-tx" }, h("span", { class: "cv-q-lab" }, "Answer"), h("span", { class: "cv-q-desc" }, texts.join(", ")))));
    } else {
      rows.push(h("li", { class: "cv-q-opt other", role: multi ? "checkbox" : "radio", "aria-checked": "false", "aria-disabled": "true" },
        h("span", { class: "cv-q-mark" + (multi ? " sq" : ""), "aria-hidden": "true" }), h("span", { class: "cv-q-opt-tx" }, h("span", { class: "cv-q-lab" }, "Other"))));
    }
    const pager = qs.length > 1 ? h("div", { class: "cv-q-pager", role: "group", "aria-label": "Questions" },
      h("button", { class: "cv-ibtn sm", type: "button", "data-k": "q-prev", "data-id": key, "aria-label": "Previous question", disabled: page === 0 }, icon("left")),
      h("span", { class: "cv-q-count", "aria-live": "polite" }, `${page + 1} of ${qs.length}`),
      h("button", { class: "cv-ibtn sm", type: "button", "data-k": "q-next", "data-id": key, "aria-label": "Next question", disabled: page === qs.length - 1 }, icon("chev"))) : null;
    let foot = null;
    if (answered) foot = h("p", { class: "cv-q-foot ok" }, icon("check"), "Answered");
    else if (b.answered === false && st.chat && st.chat.kind === "app") foot = h("p", { class: "cv-q-foot" }, "Answer it in the Claude app");
    else if (b.answered === false && mode().kind === "hub-write") foot = h("p", { class: "cv-q-foot" }, "Write your answer in the box below");
    return h("div", { class: "cv-q-wrap", "data-qkey": key },
      b.recap ? h("p", { class: "cv-q-recap" }, b.recap) : null,
      h("section", { class: "cv-q", "aria-label": "Question" + (qs.length > 1 ? ` ${page + 1} of ${qs.length}` : "") },
        h("header", { class: "cv-q-head" },
          h("div", { class: "cv-q-ask" }, q.header ? h("span", { class: "cv-q-chip" }, q.header) : null, h("p", { class: "cv-q-text" }, q.question)),
          pager),
        h("ul", { class: "cv-q-opts", role: multi ? "group" : "radiogroup", "aria-label": q.question, "aria-disabled": "true" }, rows),
        foot ? h("div", { class: "cv-q-footrow" }, foot) : null));
  }
  function qMove(key, dir, btn) {
    const b = qBlocks.get(key);
    if (!b) return;
    const n = (b.questions || []).length;
    qPage.set(key, Math.max(0, Math.min((qPage.get(key) || 0) + dir, n - 1)));
    const old = [...thread.querySelectorAll("[data-qkey]")].find((x) => x.dataset.qkey === key);
    const card = questionCard(b, key);
    if (old && card) old.replaceWith(card);
    const want = dir < 0 ? "q-next" : "q-prev";
    const nb = card && ([...card.querySelectorAll("button[data-k]")].find((x) => x.dataset.k === btn.dataset.k && !x.disabled) || [...card.querySelectorAll("button[data-k]")].find((x) => x.dataset.k === want));
    if (nb) nb.focus({ preventScroll: true });
  }
  function toolItem(b, key) {
    const status = b.status === "ok" || b.status === "error" ? b.status : "unknown";
    const open = st.openTools.has(key);
    const bodyId = "cv-t-" + key.replace(":", "-");
    const stWord = status === "ok" ? "ok" : status === "error" ? "error" : "no result yet";
    const btn = h("button", { class: "cv-tool-btn st-" + status, type: "button", "aria-expanded": String(open), "aria-controls": bodyId, "data-k": "tool", "data-id": key },
      icon("chev"), h("span", { class: "cv-tool-sum" }, b.summary || b.name || "Tool"), h("span", { class: "cv-tool-dot", "aria-hidden": "true" }, "·"), h("span", { class: "cv-tool-st" }, status === "error" ? icon("cross") : null, stWord));
    const out = h("div", { class: "cv-tool-body", id: bodyId, hidden: !open }, h("pre", { class: "cv-out" }, b.output ? b.output : "No output was saved for this step."));
    return h("li", { class: "cv-tool" }, btn, out);
  }
  function signature() {
    let n = 0;
    for (const m of st.messages) for (const b of m.blocks || []) n += (b.text ? b.text.length : 0) + (b.output ? b.output.length : 0) + (b.status ? b.status.length : 0) + 1;
    const f = st.messages[0], l = st.messages[st.messages.length - 1];
    return [st.id, st.messages.length, f ? f.i : "", l ? l.i : "", n, st.loading, st.error, st.olderBusy, st.olderErr, st.savedOk, st.meta && st.meta.olderPartCut].join("|");
  }

  // ---------- fetching ----------
  function merge(list) {
    const m = new Map(st.messages.map((x) => [x.i, x]));
    for (const x of list) if (x && Number.isInteger(x.i)) m.set(x.i, x);
    st.messages = [...m.values()].sort((a, b) => a.i - b.i);
  }
  function takeLog(j) {
    if (Array.isArray(j.messages)) merge(j.messages);
    st.total = j.messagesTotal ?? st.total;
    if (j.context) st.context = j.context;
    if (j.meta) { st.meta = j.meta; st.savedOk = j.meta.savedFileFound !== false; }
  }
  async function refresh(opts = {}) {
    const id = st.id;
    if (!id || st.fetching) return;
    st.fetching = true;
    let res = null, fail = "";
    try { res = await getJson(`/api/chat-log?id=${encodeURIComponent(id)}`); }
    catch { fail = "The Hub did not answer."; }
    st.fetching = false;
    if (st.id !== id) return;
    st.loading = false;
    if (res && res.ok && res.json && Array.isArray(res.json.messages)) { st.error = ""; takeLog(res.json); }
    else if (res) st.error = res.status === 404 ? "The Hub does not list this chat any more, so its messages are not available." : (res.json && res.json.error) || `The Hub answered with an error (${res.status}).`;
    else st.error = fail;
    drawAfterLog(opts);
  }
  function drawAfterLog(opts = {}) {
    const hasMsgs = st.messages.length > 0;
    bannerEl.hidden = !(st.error && hasMsgs);
    if (st.error && hasMsgs) bannerEl.textContent = `Could not read this chat's messages. ${st.error} Showing what was read before.`;
    drawHead(); drawContext(); drawSide(); drawComposer();
    const sig = signature();
    if (sig !== st.sig || opts.force) { st.sig = sig; withFocus(() => drawThread(opts)); }
  }
  async function loadOlder() {
    const id = st.id;
    if (!id || st.olderBusy || !st.messages.length || st.messages[0].i === 0) return;
    st.olderBusy = true; st.olderErr = "";
    st.sig = ""; withFocus(() => drawThread({ anchorOlder: true }));
    let res = null;
    try { res = await getJson(`/api/chat-log?id=${encodeURIComponent(id)}&before=${st.messages[0].i}`); } catch { /* shown below */ }
    if (st.id !== id) return;
    st.olderBusy = false;
    if (res && res.ok && res.json && Array.isArray(res.json.messages)) merge(res.json.messages);
    else st.olderErr = "Could not read older messages. Try again.";
    st.sig = signature();
    withFocus(() => drawThread({ anchorOlder: true }));
    const nb = thread.querySelector('[data-k="older"]'); if (nb && st.olderErr) nb.focus({ preventScroll: true });
  }

  function schedule() {
    if (!st.visible || !st.id) { clearTimeout(st.timer); st.timer = null; st.timerMs = 0; return; }
    const ms = st.chat && st.chat.state === "working" ? POLL_WORKING_MS : POLL_IDLE_MS;
    if (st.timer && st.timerMs === ms) return;
    clearTimeout(st.timer);
    st.timerMs = ms;
    st.timer = setTimeout(async () => {
      st.timer = null; st.timerMs = 0;
      if (!document.hidden && st.visible) await refresh();
      schedule();
    }, ms);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && st.visible && st.id) refresh(); });

  // ---------- copy, the large picture view, pin ----------
  function legacyCopy(text) {
    const t = h("textarea", { class: "cv-copybuf", "aria-hidden": "true", tabindex: "-1", readonly: true });
    t.value = text; el.append(t); t.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    t.remove();
    return ok;
  }
  async function copyPlain(text) {
    if (!text) return false;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = legacyCopy(text); }
    if (!ok) { setNote("Could not copy. Select the text and press Ctrl+C.", true); return false; }
    const tick = ++copyTick;
    setNote("Copied");
    setTimeout(() => { const n = document.getElementById("note"); if (tick === copyTick && n && n.textContent === "Copied") setNote(""); }, 1600);
    return true;
  }
  async function copyMessage(btn) {
    const g = groupAt(Number(btn.dataset.id));
    const text = g ? textOf(g.msgs) : "";
    if (!text || !(await copyPlain(text))) return;
    btn.replaceChildren(icon("check")); btn.classList.add("done");
    setTimeout(() => { if (btn.isConnected) { btn.replaceChildren(icon("copy")); btn.classList.remove("done"); } }, 1600);
  }

  // ----- read aloud (Ivan's wish): the browser's own speech, no download. Reads the reply text only: no code blocks, no tool lines. -----
  function speechText(md) {
    return String(md)
      .replace(/```[\s\S]*?(```|$)/g, " ").replace(/~~~[\s\S]*?(~~~|$)/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/`([^`]*)`/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s*/gm, "").replace(/^\s*[-*+]\s+/gm, "").replace(/^\s*\d+[.)]\s+/gm, "").replace(/^\s*>\s?/gm, "")
      .replace(/\*{1,3}|~~/g, "").replace(/\|/g, " ").replace(/<[^>]+>/g, " ")
      .replace(/([.!?:;])[ \t]*\n+/g, "$1 ").replace(/\n+/g, ". ").replace(/\s{2,}/g, " ").trim();
  }
  let speaking = null, speakUtter = null;
  function paintSpeak() {
    for (const b of el.querySelectorAll('.cv-act[data-k="speak"]')) {
      const on = speaking !== null && Number(b.dataset.id) === speaking;
      if (on === (b.dataset.on === "1")) continue;
      b.dataset.on = on ? "1" : "";
      b.replaceChildren(icon(on ? "stop" : "speaker"));
      const t = on ? "Stop reading" : "Read aloud";
      b.setAttribute("aria-label", t); b.title = t; b.setAttribute("aria-pressed", String(on));
    }
  }
  function stopSpeak() {
    if (canSpeak) { try { speechSynthesis.cancel(); } catch { /* ignore */ } }
    speaking = null; speakUtter = null; paintSpeak();
  }
  function toggleSpeak(i) {
    if (!canSpeak) return;
    if (speaking === i) { stopSpeak(); return; }
    const g = groupAt(i);
    const text = g ? speechText(textOf(g.msgs)) : "";
    if (!text) { setNote("There is no text to read in this message."); return; }
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
    const u = new SpeechSynthesisUtterance(text);
    // D60 (proposed): window voice; Jarvis voice may replace it later
    const done = () => { if (speakUtter === u) { speaking = null; speakUtter = null; paintSpeak(); } };
    u.onend = done; u.onerror = done;
    speaking = i; speakUtter = u; paintSpeak();
    try { speechSynthesis.speak(u); } catch { done(); }
  }

  // ----- right-click on a message: a real menu at the pointer (Shift+F10 or the Menu key opens it on the focused message) -----
  const visibleText = (m) => [...m.querySelectorAll(".cv-bubble, .cv-md")].map((x) => x.innerText.trim()).filter(Boolean).join("\n\n");
  function selectionIn(m) {
    const sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || !sel.anchorNode || !m.contains(sel.anchorNode) || !m.contains(sel.focusNode)) return "";
    return sel.toString().trim();
  }
  function msgMenu(m, { point, picBtn = null, returnTo }) {
    const i = Number(m.dataset.mi);
    const g = groupAt(i);
    if (!g) return;
    const items = [];
    const sel = selectionIn(m);
    if (sel) items.push({ label: "Copy selection", icon: "copy", onSelect: () => copyPlain(sel) });
    if (picBtn) items.push({ label: "Open large view", icon: "picture", onSelect: () => openPicture(picBtn) });
    const raw = textOf(g.msgs);
    if (raw.trim()) {
      items.push({ label: "Copy message", icon: "copy", onSelect: () => copyPlain(visibleText(m) || raw) });
      items.push({ label: "Copy as Markdown", onSelect: () => copyPlain(raw) });
      if (canSpeak) items.push({ label: speaking === i ? "Stop reading" : "Read aloud", icon: speaking === i ? "stop" : "speaker", onSelect: () => toggleSpeak(i) });
    }
    if (items.length) items.push({ sep: true });
    if (isHub()) items.push(forkable() && !st.ask && !st.sending ? { label: "Fork this chat", icon: "fork", onSelect: () => startAsk("fork") } : { label: "Fork this chat", icon: "fork", disabled: true, reason: forkWhy() || "Finish the question that is open first." });
    items.push({ label: c() && c().pinned === true ? "Unpin this chat" : "Pin this chat", icon: "pin", disabled: pinBusy, onSelect: () => togglePin() });
    openMenu({ items, label: "Message menu", point, returnTo, className: "mn-msg" });
  }
  thread.addEventListener("contextmenu", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t || t.closest("input, textarea, [contenteditable]")) return;
    const m = t.closest(".cv-msg");
    if (!m) return;
    e.preventDefault();
    const pic = t.closest(".cv-pic");
    const prev = document.activeElement, id = m.dataset.mi;
    msgMenu(m, { point: { x: e.clientX, y: e.clientY }, picBtn: pic ? pic.querySelector(".cv-pic-btn") : null,
      returnTo: () => (prev && prev !== document.body && prev.isConnected && thread.contains(prev) ? prev : [...thread.querySelectorAll(".cv-msg")].find((x) => x.dataset.mi === id) || null) });
  });
  scroll.addEventListener("keydown", (e) => {
    if (!(e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))) return;
    const t = e.target instanceof Element ? e.target : null;
    if (!t || t.closest("input, textarea, [contenteditable]")) return;
    const m = t.closest(".cv-msg") || (t === scroll ? [...thread.querySelectorAll(".cv-msg")].pop() : null);
    if (!m) return;
    e.preventDefault();
    const r = (t === scroll ? m : t).getBoundingClientRect();
    msgMenu(m, { point: { x: Math.max(r.left + 8, 8), y: Math.min(r.bottom, window.innerHeight - 80) }, returnTo: () => (t.isConnected ? t : m) });
  });

  function openPicture(btn) {
    const img = btn.querySelector("img");
    if (!img) return;
    lbOpener = btn.dataset.id || "";
    lbImg.alt = img.alt || "";
    lbImg.src = img.getAttribute("src");
    const cap = btn.parentElement && btn.parentElement.querySelector(".cv-pic-cap");
    lbName.textContent = cap ? cap.textContent : "Picture";
    try { lb.showModal(); } catch { /* already open */ }
    const close = lb.querySelector('[data-k="lb-close"]'); if (close) close.focus();
  }
  lb.addEventListener("close", () => {
    lbImg.removeAttribute("src");
    const back = [...el.querySelectorAll('[data-k="pic"]')].find((x) => x.dataset.id === lbOpener);
    if (back) back.focus({ preventScroll: true });
  });
  lb.addEventListener("click", (e) => { if (e.target === lb || (e.target.classList && e.target.classList.contains("cv-lb-stage"))) lb.close(); });
  lb.addEventListener("keydown", (e) => { if (e.key === "Escape") e.stopPropagation(); });
  lbImg.addEventListener("error", () => { lbName.textContent = "Picture could not be loaded"; });

  async function togglePin() {
    const ch = c();
    if (!ch || pinBusy) return;
    const next = ch.pinned !== true;
    pinBusy = true; ch.pinned = next; drawHead();
    let r;
    try { r = await send({ action: "chat-pin", chatId: ch.id, project: deps.projectName(), pinned: next }); }
    catch { r = { ok: false, error: "The Hub did not answer." }; }
    pinBusy = false;
    if (!r.ok) { ch.pinned = !next; if (st.chat && st.chat.id === ch.id) st.chat.pinned = !next; setNote(r.error || "That did not work.", true); }
    else { if (st.chat && st.chat.id === ch.id) st.chat.pinned = next; setNote(next ? "Pinned. It stays at the top of All chats." : "Unpinned."); }
    if (st.chat && st.chat.id === ch.id) drawHead();
    if (r.ok && deps.onChanged) deps.onChanged();
  }

  // ---------- attached files (Hub chats that can be answered) ----------
  const attList = (id = st.id) => atts.get(id) || [];
  const attDone = (id = st.id) => attList(id).filter((a) => a.status === "done");
  const attBusy = (id = st.id) => attList(id).some((a) => a.status === "uploading");
  const attLive = (id = st.id) => attList(id).filter((a) => a.status !== "error");
  const canAttach = () => mode().kind === "hub-write" && !st.ask && !st.sending;
  const sendReady = () => !st.sending && !attBusy() && (!!(drafts.get(st.id) || "").trim() || attDone().length > 0);

  function say(text) { attSay.textContent = ""; setTimeout(() => { attSay.textContent = text; }, 30); }
  function paintProgress(e) {
    if (st.id !== e.chatId) return;
    const li = [...composer.querySelectorAll("[data-att]")].find((x) => x.dataset.att === e.key);
    if (!li) return;
    const i = li.querySelector(".cv-chip-bar i"); if (i) i.style.width = `${e.pct}%`;
    const bar = li.querySelector(".cv-chip-bar"); if (bar) bar.setAttribute("aria-valuenow", String(e.pct));
    const sub = li.querySelector(".cv-chip-sub"); if (sub) sub.textContent = `Uploading ${e.pct}%`;
  }
  // a small picture for the chip, drawn from the chosen file (data: pictures are allowed by the page's policy, blob: ones are not)
  async function makeThumb(e, file) {
    try {
      const bmp = await createImageBitmap(file);
      const s = Math.min(1, 96 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(bmp.width * s)); cv.height = Math.max(1, Math.round(bmp.height * s));
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      if (bmp.close) bmp.close();
      e.thumb = cv.toDataURL("image/png");
    } catch { /* the chip keeps its file icon */ }
    if (!e.removed && st.id === e.chatId) drawComposer();
  }
  function xhrUpload(e, file, token) {
    return new Promise((resolve) => {
      const x = new XMLHttpRequest();
      e.xhr = x;
      x.open("POST", `/api/upload?chat=${encodeURIComponent(e.chatId)}`);
      x.setRequestHeader("X-Hub-Token", token);
      x.setRequestHeader("Content-Type", "application/octet-stream");
      x.setRequestHeader("X-Upload-Name", encodeURIComponent(e.name));
      x.upload.onprogress = (ev) => { if (ev.lengthComputable && ev.total) { e.pct = Math.min(99, Math.round((ev.loaded / ev.total) * 100)); paintProgress(e); } };
      x.onload = () => { let json = null; try { json = JSON.parse(x.responseText); } catch { /* not JSON */ } resolve({ status: x.status, json }); };
      x.onerror = () => resolve({ status: 0, json: null });
      x.onabort = () => resolve({ aborted: true });
      x.send(file);
    });
  }
  async function startUpload(e, file) {
    let r;
    try {
      r = await xhrUpload(e, file, await deps.getToken(false));
      if (r.status === 403 && !e.removed) r = await xhrUpload(e, file, await deps.getToken(true));
    } catch { r = { status: 0, json: null }; }
    e.xhr = null;
    if (e.removed || r.aborted) return;
    if (r.json && r.json.ok === true && typeof r.json.uploadId === "string") {
      e.status = "done"; e.pct = 100; e.uploadId = r.json.uploadId;
      if (r.json.kind) e.kind = r.json.kind;
      if (typeof r.json.name === "string" && r.json.name) e.name = r.json.name;
      if (Number.isFinite(r.json.bytes)) e.size = r.json.bytes;
      say(`Attached ${e.name}.`);
    } else {
      e.status = "error";
      e.error = (r.json && typeof r.json.error === "string" && r.json.error) || (r.status === 0 ? ATT_WORDS.lost : `The Hub answered with an error (${r.status}). Try attaching it again.`);
      say(`Could not attach ${e.name}. ${e.error}`);
    }
    if (st.id === e.chatId) drawComposer();
  }
  function addFiles(files) {
    const id = st.id;
    if (!id || !canAttach()) return;
    const list = atts.get(id) || [];
    atts.set(id, list);
    const started = [];
    for (const f of Array.from(files || [])) {
      const chk = precheckFile(f);
      const e = { key: "a" + (++attSeq), chatId: id, name: f.name || "file", size: f.size, kind: chk.kind, status: "uploading", pct: 0, error: "", thumb: "", uploadId: null, xhr: null, removed: false };
      if (chk.error) { e.status = "error"; e.error = chk.error; }
      else if (attLive(id).length >= ATT_MAX) { e.status = "error"; e.error = ATT_WORDS.many; }
      list.push(e);
      if (e.status === "uploading") started.push([e, f]);
    }
    drawComposer();
    for (const [e, f] of started) { startUpload(e, f); if (e.kind === "image") makeThumb(e, f); }
    const bad = list.filter((a) => a.status === "error" && !a.said);
    bad.forEach((a) => { a.said = true; });
    if (bad.length) say(`Could not attach ${bad.map((a) => a.name).join(", ")}. ${bad[0].error}`);
  }
  function removeAtt(key) {
    const list = attList();
    const i = list.findIndex((a) => a.key === key);
    if (i < 0) return;
    const e = list[i];
    e.removed = true;
    if (e.xhr) { try { e.xhr.abort(); } catch { /* ignore */ } }
    list.splice(i, 1);
    drawComposer();
    const next = [...composer.querySelectorAll('[data-k="att-remove"]')];
    const target = next[Math.min(i, next.length - 1)] || composer.querySelector('[data-k="attach"]');
    if (target) target.focus({ preventScroll: true });
    say(`Removed ${e.name}.`);
  }
  function chipEl(e, locked) {
    const up = e.status === "uploading", bad = e.status === "error";
    const lead = e.thumb ? h("img", { class: "cv-chip-thumb", src: e.thumb, alt: "" }) : h("span", { class: "cv-chip-ico" }, icon(e.kind === "image" ? "picture" : "file"));
    const sub = bad ? e.error : up ? `Uploading ${e.pct}%` : [KIND_LABEL[e.kind] || "File", fmtBytes(e.size)].filter(Boolean).join(", ");
    const bar = up ? h("span", { class: "cv-chip-bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": e.pct, "aria-label": `Uploading ${e.name}` }, fillEl(e.pct)) : null;
    return h("li", { class: "cv-chip" + (up ? " up" : "") + (bad ? " bad" : ""), "data-att": e.key },
      lead,
      h("span", { class: "cv-chip-text" }, h("span", { class: "cv-chip-name", title: e.name }, e.name), h("span", { class: "cv-chip-sub" }, sub)),
      h("button", { class: "cv-chip-x", type: "button", "data-k": "att-remove", "data-id": e.key, "aria-label": `Remove ${e.name}`, disabled: locked }, icon("cross")),
      bar);
  }

  // ---------- composer ----------
  function mode() {
    const ch = c();
    if (!ch) return { kind: "none" };
    if (ch.kind === "hub") {
      if (roundRunning()) return { kind: "hub-round" };
      if (ch.canAnswer) return { kind: "hub-write" };
      if (ch.remoteControl === true) return { kind: "hub-rc" };
      if (ch.state === "working") return { kind: "hub-working" };
      return { kind: "hub-other" };
    }
    if (ch.kind === "app") {
      const appId = appIdOf(ch.openLink);
      const canApp = ch.canAnswerApp === true && ch.state === "closed" && ch.remoteControl === false && !!appId;
      return canApp ? { kind: "app-write", appId } : { kind: "app-note", appId };
    }
    return { kind: "terminal" };
  }
  function openButtons(m) {
    const ch = c();
    const out = [];
    if (ch.kind === "hub" && typeof ch.openLink === "string" && ch.openLink.startsWith("claude://resume?session=")) out.push(h("button", { class: "btn", type: "button", "data-k": "open-hub" }, "Open it"));
    if (ch.kind === "app" && m.appId) out.push(h("button", { class: "btn open-this", type: "button", "data-k": "open-app", "data-id": m.appId }, "Open it"));
    return out;
  }
  const writable = (m = mode()) => m.kind === "hub-write" || m.kind === "app-write";
  const PLACEHOLDER = {
    "hub-write": "Write your message. Type / for commands.", "app-write": "Write your answer. Type / for commands.",
    "hub-working": "Claude is working. You can write when it stops.", "hub-round": "A hand-off is running. You can write when it is finished.",
    "hub-rc": "Remote Control is on: answer it on your phone.", "hub-other": "This chat can't take a message from the Hub right now.",
    "app-note": "Answer it in the Claude app.", terminal: "Answer it in the terminal.", none: "",
  };

  // ONE slim banner above the writing box when this chat cannot be answered here (instead of notices stacked under it)
  function composerBanner(m) {
    const ch = c();
    const text = (t, work = false) => h("span", { class: "cv-cb-text" }, work ? h("span", { class: "cv-pulse", "aria-hidden": "true" }) : null, t);
    const acts = [];
    let t = null;
    if (m.kind === "hub-working") {
      t = text("Claude is working. You can write when it stops.", true);
      acts.push(h("button", { class: "btn", type: "button", "data-k": "stop", disabled: st.sending || !!st.ask }, "Stop"));
    } else if (m.kind === "hub-round") t = text("A hand-off is running. You can write when it is finished.", true);
    else if (m.kind === "hub-rc") {
      t = text("Remote Control is on. Answer it on your phone, or turn it off to answer here.", ch.state === "working");
      if (rcSwitchable()) acts.push(h("button", { class: "btn", type: "button", "data-k": "rc-toggle", disabled: st.sending || !!st.ask }, "Turn Remote Control off"));
      if (ch.state === "working") acts.push(h("button", { class: "btn", type: "button", "data-k": "stop", disabled: st.sending || !!st.ask }, "Stop"));
      acts.push(...openButtons(m));
    } else if (m.kind === "hub-other") { t = text("This chat can't take a message from the Hub right now."); acts.push(...openButtons(m)); }
    else if (m.kind === "app-note") {
      t = text(ch.state === "closed" ? (ch.remoteControl === true ? "This chat is closed and Remote Control is on. Answer it on your phone, or open it in the Claude app." : "This chat is closed. Answer it in the Claude app.") : "This chat runs in the Claude app.");
      acts.push(...openButtons(m));
    } else if (m.kind === "terminal") t = text("This chat runs in a terminal. Answer it there.");
    else if (m.kind === "app-write") { t = text("This chat is closed. Answering here continues it in the Claude app."); acts.push(...openButtons(m)); }
    if (!t) return null;
    const bits = [];
    if (m.kind === "app-note" || m.kind === "terminal") {
      bits.push(h("span", { class: "cv-cb-or" }, "or"));
      bits.push(h("span", { class: "cv-cb-soon", title: "Copying an app or terminal chat into the Hub needs your decision first" }, "continue it here as a copy", h("em", {}, "coming soon")));
    } else if (forkable()) {
      bits.push(h("span", { class: "cv-cb-or" }, "or"), h("button", { class: "linkbtn", type: "button", "data-k": "fork" }, "continue it here as a copy"));
    }
    return h("div", { class: "cv-cbanner", role: "status" }, t, h("span", { class: "cv-cb-acts" }, ...acts, ...bits));
  }

  // the writing box is at least 3 lines and grows with the text up to about 10 lines
  function autosize() {
    if (!ta.isConnected || !ta.clientWidth) return;
    if (!ta.value) { ta.style.height = ""; return; }
    ta.style.height = "auto";
    const cs = getComputedStyle(ta);
    const line = parseFloat(cs.lineHeight) || 22;
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    ta.style.height = `${Math.min(ta.scrollHeight, Math.round(line * 10 + pad))}px`;
  }

  function drawComposer() {
    withFocus(() => {
      const ch = c();
      if (!ch) { composer.replaceChildren(); return; }
      const m = mode();
      const kids = [];
      const can = writable(m);
      const asking = st.ask && st.ask.where === "composer";
      const busy = st.sending;
      const hasText = !!(drafts.get(st.id) || "").trim();
      const bn = composerBanner(m);
      if (bn) kids.push(bn);
      if (asking) kids.push(askRow(st.ask));
      if (m.kind === "app-write") {
        if (busy) kids.push(h("p", { class: "app-busy", role: "status" }, h("span", { class: "dot", "aria-hidden": "true" }), "Answering from the Hub. Don't type in this chat in the app until it is done."));
        const res = results.get(st.id);
        if (res && !busy) kids.push(appResult(res));
      }
      const draft = drafts.get(st.id) || "";
      if (ta.value !== draft) ta.value = draft;
      ta.disabled = !can || busy; ta.readOnly = !!asking;
      ta.placeholder = PLACEHOLDER[m.kind] || "";
      countEl = h("span", { class: "cv-count" }, `${ta.value.length} / ${ANSWER_MAX}`);
      const list = m.kind === "hub-write" ? attList() : [];
      const locked = busy || !!asking;
      const sendKey = m.kind === "app-write" ? "send-app" : "send";
      const sendOn = can && (m.kind === "app-write" ? !busy && hasText : sendReady());
      const sendLabel = busy ? (m.kind === "app-write" ? "Answering…" : "Sending…") : attBusy() && m.kind === "hub-write" ? "Uploading…" : "Send";
      const box = h("div", { class: "cv-box" + (can ? "" : " off") },
        list.length ? h("ul", { class: "cv-chips", "aria-label": "Attached files" }, list.map((e) => chipEl(e, locked))) : null,
        h("label", { for: "cv-ta", class: "sr" }, "Your message"),
        ta,
        h("div", { class: "cv-box-foot" },
          m.kind === "hub-write" ? h("button", { class: "cv-ibtn", type: "button", "data-k": "attach", "aria-label": "Attach files or pictures", title: "Attach files or pictures", disabled: locked }, icon("clip")) : h("span", {}),
          h("button", { class: "btn primary cv-send", type: "button", "data-k": sendKey, disabled: !sendOn }, sendLabel)));
      kids.push(h("div", { class: "cv-boxwrap" }, slashEl, box));
      if (can) kids.push(h("p", { class: "cv-hint", id: "cv-hint" }, h("span", {}, "Ctrl+Enter sends. Enter starts a new line.", m.kind === "hub-write" ? h("span", { class: "cv-hint-files" }, " Drop files here or paste a picture to attach it.") : null), countEl));
      else kids.push(h("span", { id: "cv-hint", class: "sr" }, PLACEHOLDER[m.kind] || ""));
      composer.replaceChildren(...kids);
      paintSlash();
      autosize();
    });
    if (st.ask && st.ask.where === "composer" && st.ask.fresh) { st.ask.fresh = false; const y = composer.querySelector('[data-k="yes"]'); if (y) y.focus(); }
  }

  // ---------- slash commands: "/" as the first character opens a small list above the box. It only inserts "/name " into the box; nothing is sent. ----------
  // The list comes from GET /api/commands?project=<name> (asked once per page load and project). If the route fails there is no list, and typing "/" is just text.
  const sl = { open: false, items: [], active: 0 };
  const slashEl = h("ul", { class: "cv-slash", id: "cv-slash", role: "listbox", "aria-label": "Commands", hidden: true });
  async function loadCommands() {
    const proj = deps.projectName();
    if (commandCache.has(proj)) return commandCache.get(proj);
    const p = (async () => {
      try {
        const r = await getJson(`/api/commands?project=${encodeURIComponent(proj)}`);
        if (r.ok && r.json && Array.isArray(r.json.commands)) {
          return r.json.commands.filter((x) => x && typeof x.name === "string" && /^[\w:.-]{1,64}$/.test(x.name))
            .map((x) => ({ name: x.name, description: typeof x.description === "string" ? x.description : "", hint: typeof x.hint === "string" ? x.hint : "", source: typeof x.source === "string" ? x.source : "" }));
        }
      } catch { /* no list: the box stays plain text */ }
      return [];
    })();
    commandCache.set(proj, p);
    return p;
  }
  function closeSlash() { if (!sl.open) return; sl.open = false; paintSlash(); }
  function paintSlash() {
    const show = sl.open && sl.items.length > 0 && writable();
    slashEl.hidden = !show;
    ta.setAttribute("aria-expanded", String(show));
    if (!show) { ta.removeAttribute("aria-controls"); ta.removeAttribute("aria-activedescendant"); slashEl.replaceChildren(); return; }
    ta.setAttribute("aria-controls", "cv-slash");
    slashEl.replaceChildren(...sl.items.map((c2, i) => h("li", { class: "cv-sl-opt" + (i === sl.active ? " on" : ""), role: "option", id: "cv-sl-" + i, "aria-selected": String(i === sl.active), "data-i": String(i) },
      h("span", { class: "cv-sl-name" }, "/" + c2.name, c2.hint ? h("i", {}, " " + c2.hint) : null), h("span", { class: "cv-sl-desc" }, c2.description), c2.source ? h("span", { class: "cv-sl-src" }, c2.source) : null)));
    ta.setAttribute("aria-activedescendant", "cv-sl-" + sl.active);
    const on = slashEl.children[sl.active];
    if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
  }
  async function updateSlash() {
    const v = ta.value;
    if (!writable() || !/^\/[^\s]*$/.test(v)) { closeSlash(); return; }
    const q = v.slice(1).toLowerCase();
    const all = await loadCommands();
    if (ta.value !== v) return;   // typed on meanwhile: the newer call decides
    const starts = all.filter((x) => x.name.toLowerCase().startsWith(q)), inside = all.filter((x) => !x.name.toLowerCase().startsWith(q) && x.name.toLowerCase().includes(q));
    sl.items = [...starts, ...inside].slice(0, 60);
    sl.active = 0; sl.open = sl.items.length > 0;
    paintSlash();
  }
  function pickSlash(i) {
    const it = sl.items[i];
    if (!it || !st.id) return;
    ta.value = `/${it.name} `;
    drafts.set(st.id, ta.value);
    closeSlash();
    onDraftChange();
    ta.focus({ preventScroll: true });
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch { /* ignore */ }
  }
  slashEl.addEventListener("mousedown", (e) => e.preventDefault());
  slashEl.addEventListener("click", (e) => { const li = e.target instanceof Element ? e.target.closest(".cv-sl-opt") : null; if (li) pickSlash(Number(li.dataset.i)); });
  ta.addEventListener("blur", () => { setTimeout(() => { if (document.activeElement !== ta) closeSlash(); }, 0); });

  function appResult(res) {
    if (res.ok && res.reply) {
      const box = h("div", { class: "said-wrap app-result" + (res.warn ? " warn" : "") }, h("span", { class: "cp-label" }, res.warn ? res.text : "Claude replied"));
      const md = h("div", { class: "md cv-md" });
      try { md.append(renderMarkdown(res.reply, { document })); } catch { md.textContent = res.reply; }
      box.append(md);
      return box;
    }
    return h("p", { class: "app-result-line" + (res.ok && !res.warn ? "" : " bad"), role: "status" }, res.text);
  }

  // asking first: nothing is sent before Yes
  const SAFE = "Claude works without a window and uses your Claude allowance.";
  function startAsk(kind) {
    const ch = c();
    if (!ch || st.sending) return;
    const text = (drafts.get(st.id) || "").trim();
    let a = null;
    if (kind === "send") {
      const done = attDone();
      if (!isHub() || (!text && !done.length)) return;
      if (attBusy()) { setNote("Wait until the files have finished uploading.", true); return; }
      const n = done.length;
      const files = `${n} attachment${n > 1 ? "s" : ""}`;
      const names = done.map((x) => x.name);
      const body = { action: "chat-answer", id: st.id, text };
      if (n) body.attachments = done.map((x) => x.uploadId);
      a = { where: "composer", text: !n ? "Send this to the chat?" : text ? `Send this and ${files} to the chat?` : `Send ${files} to the chat?`,
        extra: (n ? `Attached: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}. ` : "") + SAFE, body, payload: text };
    }
    else if (kind === "fork") {
      if (!forkable()) return;
      a = { where: "ctx", name: "", text: "Make a copy of this chat?", extra: "The copy starts from everything said so far and your original chat stays as it is. " + SAFE, body: { action: "chat-fork", id: st.id } };
    }
    else if (kind === "send-app") {
      const m = mode(); if (m.kind !== "app-write" || !text) return;
      a = { where: "composer", text: "Send this answer into the chat in the Claude app?", extra: "Don't type in that chat while it works.", body: { action: "chat-answer-app", appId: m.appId, text }, payload: text };
    }
    else if (kind === "stop") { if (!isHub()) return; a = { where: "ctx", text: "Stop this chat?", extra: "You can answer it later to continue.", body: { action: "chat-stop", id: st.id } }; }
    else if (kind === "handoff") { if (!isHub()) return; a = { where: "ctx", text: "Hand off this chat?", extra: "Claude saves where the work stands and writes the handoff note. " + SAFE, body: { action: "chat-answer", id: st.id, text: "/handoff" } }; }
    else if (kind === "pickup") { if (!isHub()) return; a = { where: "ctx", text: "Run /pickup in this chat?", extra: SAFE, body: { action: "chat-answer", id: st.id, text: "/pickup" } }; }
    else if (kind === "rc") {
      if (!rcSwitchable()) return;
      const on = rcValue() !== true;
      a = { where: "ctx", on, text: on ? "Turn Remote Control on?" : "Turn Remote Control off?",
        extra: on ? "The chat runs in the background so you can open it on your phone. You cannot answer it here while it is on. " + SAFE : "The chat stops running in the background; you can answer it here afterwards.",
        body: { action: "chat-remote-control", id: st.id, on } };
    }
    else if (kind === "round") {
      if (!isHub()) return;
      a = { where: "ctx", text: "Hand off and pick up?", extra: "This tells the chat to write its hand-off, then starts a new chat that picks up. Your old chat stays in All chats.", body: { action: "chat-handoff-round", id: st.id } };
    }
    if (!a) return;
    st.ask = { ...a, kind, chatId: st.id, fresh: true };
    st.roundMsg = "";
    setNote("");
    drawComposer(); drawContext(); drawHead(); drawSide(); drawPinRows();
  }
  // a closed question hands the focus back to the button that opened it (the switch), so the keyboard does not lose its place
  function focusBack(a) {
    if (!a || (a.kind !== "rc" && a.kind !== "fork")) return;
    menuBtn.focus({ preventScroll: true });
  }
  function cancelAsk() { if (!st.ask) return; const a = st.ask; st.ask = null; drawComposer(); drawContext(); drawHead(); drawSide(); focusBack(a); }

  async function confirmAsk() {
    const a = st.ask;
    if (!a || a.chatId !== st.id || st.sending) { cancelAsk(); return; }
    // the text that was asked about is exactly the text that goes out
    st.ask = null;
    const id = st.id;
    if (a.kind === "fork") { const nm = (a.name || "").replace(/\s+/g, " ").trim(); if (nm) a.body = { ...a.body, name: nm }; }
    st.sending = true;
    setNote(a.kind === "send-app" ? "Answering from the Hub. Don't type in this chat in the app until it is done." : "Working on it…");
    results.delete(id);
    drawComposer(); drawContext(); drawHead(); drawSide();
    let r;
    try { r = await send(a.body); }
    catch { r = { ok: false, error: a.kind === "send-app" ? "The Hub did not answer. Look at the chat in the app before you try again." : "The Hub did not answer." }; }
    st.sending = false;
    if (a.kind === "rc") {
      setNote(r.ok ? r.message || (a.on ? "Remote Control is on." : "Remote Control is off.") : r.error || "That did not work.", !r.ok);
      drawComposer(); drawContext(); drawHead(); drawSide(); focusBack(a);
      if (deps.onChanged) await deps.onChanged();
      refresh({ force: false });
      return;
    }
    if (a.kind === "fork") {
      if (r.ok) {
        const nm = a.body.name || `Fork of ${(st.chat && st.chat.title) || "this chat"}`;
        setNote(`Copy started: ${nm}`);
      } else setNote(r.error || "The copy did not start.", true);
      drawComposer(); drawContext(); drawHead(); drawSide();
      if (r.ok && deps.onChanged) {
        await deps.onChanged();
        // the copy needs a few seconds to get its own chat: look again, so it shows up in All chats (and as the latest chat when it is the newest)
        setTimeout(() => deps.onChanged(), 3000); setTimeout(() => deps.onChanged(), 8000);
      }
      return;
    }
    if (a.kind === "round") {
      if (r.ok && r.roundId) {
        rounds.set(id, { roundId: r.roundId, state: "running", steps: [], startedLocal: Date.now() });
        ensureRoundPoll();
        setNote("Hand-off started.");
        setTimeout(pollRounds, 1200);
      } else { st.roundMsg = r.error || "The hand-off did not start."; setNote(st.roundMsg, true); }
      drawRound(); drawContext(); drawComposer(); drawHead(); drawSide();
      return;
    }
    if (a.kind === "send-app") {
      if (r.ok) {
        const warn = r.status !== "done";
        const msg = r.message || (warn ? "Claude replied, but the chat may be split: check it in the app." : "Done.");
        results.set(id, { ok: true, warn, text: r.reply ? (warn ? msg : "Claude replied") : msg, reply: r.reply || "" });
        setNote(r.message || "Done.", warn);
        drafts.delete(id); if (st.id === id) ta.value = "";
      } else { results.set(id, { ok: false, text: r.error || "That did not work." }); setNote(r.error || "That did not work.", true); }
    } else if (r.ok) {
      setNote(r.message || (a.kind === "stop" ? "Stopped." : "Sent."));
      if (a.kind === "send") {
        drafts.delete(id); if (st.id === id) ta.value = "";
        // the files that went out are cleared; any that were still uploading or had failed stay on their chips
        const sent = new Set(a.body.attachments || []);
        if (sent.size && atts.has(id)) atts.set(id, atts.get(id).filter((x) => !sent.has(x.uploadId)));
      }
    } else setNote(r.error || "That did not work.", true);
    drawComposer(); drawHead(); drawSide();
    if (deps.onChanged) await deps.onChanged();
    refresh({ force: false });
    setTimeout(() => { if (st.id === id) refresh(); }, 2500);
  }

  function onDraftChange() {
    if (!st.id) return;
    drafts.set(st.id, ta.value);
    if (countEl) countEl.textContent = `${ta.value.length} / ${ANSWER_MAX}`;
    const b = composer.querySelector('[data-k="send"], [data-k="send-app"]');
    if (b) b.disabled = !writable() || (b.dataset.k === "send" ? !sendReady() : !ta.value.trim() || st.sending);
    autosize();
  }
  ta.addEventListener("input", () => { onDraftChange(); updateSlash(); });
  ta.addEventListener("paste", (e) => {
    const cd = e.clipboardData;
    if (!cd || !cd.files || !cd.files.length || cd.getData("text/plain")) return;   // text pastes as text; a picture on its own is attached
    if (mode().kind !== "hub-write") return;
    e.preventDefault();
    if (canAttach()) addFiles(cd.files);
  });
  // drag and drop onto the composer (a dropped file is never opened by the browser itself)
  const dragHasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  composer.addEventListener("dragenter", (e) => { if (!dragHasFiles(e)) return; e.preventDefault(); dragDepth++; if (canAttach()) composer.classList.add("drop-on"); });
  composer.addEventListener("dragover", (e) => { if (!dragHasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = canAttach() ? "copy" : "none"; });
  composer.addEventListener("dragleave", (e) => { if (!dragHasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) composer.classList.remove("drop-on"); });
  composer.addEventListener("drop", (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; composer.classList.remove("drop-on");
    if (canAttach()) addFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener("change", () => { const fl = Array.from(fileInput.files || []); fileInput.value = ""; if (fl.length) addFiles(fl); });
  el.addEventListener("input", (e) => { const t = e.target; if (t && t.dataset && t.dataset.k === "fork-name" && st.ask) st.ask.name = t.value; });
  el.addEventListener("keydown", (e) => { const t = e.target; if (e.key === "Enter" && t && t.dataset && t.dataset.k === "fork-name") { e.preventDefault(); confirmAsk(); } });
  ta.addEventListener("keydown", (e) => {
    if (sl.open && sl.items.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sl.active = (sl.active + (e.key === "ArrowDown" ? 1 : sl.items.length - 1)) % sl.items.length; paintSlash(); return; }
      if ((e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); pickSlash(sl.active); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeSlash(); return; }
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (st.ask) return;
      startAsk(mode().kind === "app-write" ? "send-app" : "send");
    }
  });

  // ---------- details column (right edge, own scroll). Closed by default as a slim rail; the choice is remembered. On a phone it opens as a full-screen sheet. ----------
  function setSide(open) {
    st.sideOpen = !!open;
    try { localStorage.setItem("hub-chat-side-v2", st.sideOpen ? "open" : "closed"); } catch { /* storage blocked */ }
    drawSide();
    if (scroll.clientHeight) { if (st.stick) toBottom(); updateJump(); }
    const f = st.sideOpen ? side.querySelector('[data-k="side-close"]') : side.querySelector('[data-k="side-open"]');
    if (f && (st.sideOpen || window.innerWidth > 900)) f.focus({ preventScroll: true });
    else if (!st.sideOpen) menuBtn.focus({ preventScroll: true });
  }
  function drawSide() {
    const ch = c();
    if (!ch) { side.replaceChildren(); return; }
    if (st.sideOpen === null) {
      let saved = null;
      try { saved = localStorage.getItem("hub-chat-side-v2"); } catch { /* storage blocked */ }
      st.sideOpen = saved === "open";
    }
    const open = st.sideOpen;
    el.classList.toggle("side-closed", !open);
    const prev = side.querySelector(".cv-side-body");
    const keepTop = prev ? prev.scrollTop : 0;
    withFocus(() => {
      if (!open) {
        side.replaceChildren(h("button", { class: "cv-rail", type: "button", "data-k": "side-open", "aria-expanded": "false", "aria-controls": "cv-side-body", title: "Show chat details" }, icon("panel"), h("span", { class: "cv-rail-label" }, "Chat details")));
        return;
      }
      const meta = st.meta || {};
      const val = (v) => (v === null || v === undefined || v === "" ? h("span", { class: "unk" }, st.loading ? "Reading…" : "Not known") : String(v));
      const dl = (rows) => h("dl", { class: "cv-dl" }, rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
      const outs = Array.isArray(meta.outputs) ? meta.outputs : [];
      const shown = st.outputsAll ? outs : outs.slice(0, OUTPUTS_FIRST);
      const ctx = st.context;
      const secs = [
        h("section", { class: "cv-sec" }, h("h4", {}, "Chat"),
          dl([["Kind", KIND_WORD[ch.kind] || "Chat"], ["Last active", ch.lastActive ? ago(ch.lastActive) : val(null)]])),
        h("section", { class: "cv-sec" }, h("h4", {}, "Environment"),
          dl([["Folder", val(meta.cwd)], ["Branch", val(meta.branch)], ["Model", val(meta.model)], ["Permission mode", val(meta.permissionMode)]])),
        h("section", { class: "cv-sec" }, h("h4", {}, "Outputs", outs.length ? h("span", { class: "count" }, String(outs.length)) : null),
          outs.length ? h("ul", { class: "cv-outs" }, shown.map((o) => h("li", {},
            h("span", { class: "cv-path" }, o.path), h("span", { class: "cv-out-meta" }, [o.tool, o.outside ? "outside the project" : null, o.at ? ago(o.at) : null].filter(Boolean).join(", ")))))
            : h("p", { class: "cv-small" }, st.loading ? "Reading…" : "No files created or changed yet."),
          outs.length > OUTPUTS_FIRST ? h("button", { class: "chat-more", type: "button", "data-k": "outputs-all", "aria-expanded": String(st.outputsAll) }, st.outputsAll ? "Show fewer" : `Show all (${outs.length})`) : null),
        h("section", { class: "cv-sec" }, h("h4", {}, "Context"),
          ctx && Number.isFinite(ctx.percent)
            ? dl([["Full", `${ctx.percent}%${ctx.estimated ? " (estimate)" : ""}`], ["Used", `${ctx.usedTokens.toLocaleString("en-US")} tokens`], ["Room in total", `${ctx.windowTokens.toLocaleString("en-US")} tokens`], ["Compacted", meta.compactions ? `${meta.compactions} time${meta.compactions > 1 ? "s" : ""}` : "Never"]])
            : h("p", { class: "cv-small" }, st.loading ? "Reading…" : "Not known for this chat."),
          ctx && ctx.basis ? h("p", { class: "cv-small" }, `Counted from the ${ctx.basis}.`) : null)];
      side.replaceChildren(
        h("div", { class: "sheet-head" }, h("h4", { class: "sheet-title" }, "Chat details"),
          h("button", { class: "cv-ibtn", type: "button", "data-k": "side-close", "aria-label": "Close chat details", title: "Close chat details" }, icon("cross"))),
        h("div", { class: "cv-side-body", id: "cv-side-body" }, secs));
    });
    const body = side.querySelector(".cv-side-body");
    if (body && keepTop) body.scrollTop = keepTop;
  }

  // ---------- clicks inside the workspace ----------
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-k]");
    if (!b || !el.contains(b)) return;
    const k = b.dataset.k;
    if (k === "tool") {
      const key = b.dataset.id;
      const open = !st.openTools.has(key);
      if (open) st.openTools.add(key); else st.openTools.delete(key);
      b.setAttribute("aria-expanded", String(open));
      const body = document.getElementById(b.getAttribute("aria-controls"));
      if (body) body.hidden = !open;
      return;
    }
    if (k === "jump") { toBottom(); st.stick = true; updateJump(); scroll.focus({ preventScroll: true }); return; }
    if (k === "older") { loadOlder(); return; }
    if (k === "retry") { st.loading = true; st.error = ""; st.sig = ""; drawThread({ force: true }); refresh({ force: true }); return; }
    if (k === "outputs-all") { st.outputsAll = !st.outputsAll; drawSide(); return; }
    if (k === "side-open") { setSide(true); return; }
    if (k === "side-close") { setSide(false); return; }
    if (k === "menu") { if (menuIsOpen()) closeMenu(true); else openChatMenu(); return; }
    if (k === "chats") { if (deps.openChats) deps.openChats(b); return; }
    if (k === "speak") { toggleSpeak(Number(b.dataset.id)); return; }
    if (k === "q-prev" || k === "q-next") { qMove(b.dataset.id, k === "q-prev" ? -1 : 1, b); return; }
    if (k === "attach") { if (canAttach()) fileInput.click(); return; }
    if (k === "att-remove") { removeAtt(b.dataset.id); return; }
    if (k === "pic") { openPicture(b); return; }
    if (k === "lb-close") { lb.close(); return; }
    if (k === "copy") { copyMessage(b); return; }
    if (k === "pin") { togglePin(); return; }
    if (k === "fork") { if (!b.disabled) startAsk("fork"); return; }
    if (k === "resume") { if (!ta.disabled) { ta.focus(); composer.scrollIntoView({ block: "nearest" }); } return; }
    if (k === "rc-toggle") { startAsk("rc"); return; }
    if (k === "send" || k === "send-app" || k === "stop" || k === "handoff" || k === "pickup" || k === "round") { startAsk(k); return; }
    if (k === "yes") { confirmAsk(); return; }
    if (k === "cancel") { cancelAsk(); return; }
    if (k === "round-dismiss") { const r = roundOf(st.id); if (r) { r.dismissed = true; drawRound(); drawContext(); drawComposer(); } return; }
    if (k === "open-app") { if (/^local_[0-9a-f-]{8,64}$/i.test(b.dataset.id || "")) await openIn({ action: "chat-open-app", appId: b.dataset.id }); return; }
    if (k === "open-hub") { if (isHub()) await openIn({ action: "chat-open-app", hubId: st.id }); return; }
  });
  async function openIn(body) {
    setNote("Working on it…");
    let r;
    try { r = await send(body); } catch { r = { ok: false, error: "The Hub did not answer." }; }
    setNote(r.ok ? r.message || "Opening in the Claude app." : r.error || "That did not work.", !r.ok);
  }
  el.addEventListener("keydown", (e) => { if (e.key === "Escape" && st.ask) { e.stopPropagation(); cancelAsk(); } });

  // ---------- public ----------
  function reset(chat) {
    st.id = chat.id; st.messages = []; st.total = 0; st.context = null; st.meta = null; st.savedOk = true;
    st.loading = true; st.error = ""; st.olderBusy = false; st.olderErr = ""; st.stick = true; st.top = 0; st.openTools = new Set();
    st.sig = ""; st.outputsAll = false; st.ask = null; st.sending = false; st.roundMsg = ""; st.fetching = false;
    stopSpeak(); closeSlash(); closeMenu(false);
    bannerEl.hidden = true;
    ta.value = drafts.get(chat.id) || "";
  }
  function show(chat) {
    if (!chat) { st.visible = false; schedule(); return false; }
    const changed = st.id !== chat.id;
    const prevState = !changed && st.chat ? st.chat.state : null;
    st.chat = chat; st.visible = true;
    if (changed) {
      reset(chat);
      drawHead(); drawContext(); drawRound(); drawSide(); drawComposer(); drawThread({ force: true });
      refresh({ force: true });
      findRound(chat.id);
    } else {
      drawHead(); drawContext(); drawRound(); drawSide(); drawComposer();
      if (prevState && prevState !== chat.state) refresh();
    }
    schedule();
    return changed;
  }
  function focusHeading() { titleEl.focus({ preventScroll: false }); }

  return { el, show, refresh: () => refresh(), snapshot, restore, focusHeading, hasFocus: () => el.contains(document.activeElement) };
}
