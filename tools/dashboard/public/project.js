// Hub project page (step 17.4, chat workspace from Phase 19, clean-up redesign 2026-11). One project: the chat IS the page.
// One slim top bar (name, phase, progress, a quiet "N decisions waiting" chip, a "..." project menu). Everything else opens in a right-hand drawer:
// All chats (search, pinned first then newest), Decisions waiting, Next steps from the handoff, New chat. The chat view itself lives in chatview.js.
// Reads GET /api/project?name=... every 30 s.
// The only things that change anything: the composer and the menus in the workspace (chatview.js) and the New chat form here, all using the
// SAME request route the dashboard already uses (POST /api/action with the per-run token, confirm:true), and every one of them asks "...?" first.
// All text goes in with textContent (via h()), never as HTML, because it comes from project files.
import { createChatView, icon, openMenu, closeMenu } from "./chatview.js";

const REFRESH_MS = 30_000;
const $ = (id) => document.getElementById(id);
const NAME = new URLSearchParams(location.search).get("name") || "";

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v; else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

function ago(iso) {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const d = Math.round(hrs / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

const STATE_WORD = { working: "Working", idle: "Idle", waiting: "Waiting for you", failed: "Failed", stopped: "Stopped", closed: "Closed" };
const KIND_WORD = { hub: "Hub chat", app: "App chat", terminal: "Terminal chat" };
const TASK_MAX = 4000;
// the same choices as the dashboard's New chat form (public/app.js)
const MODELS = [["", "Default"], ["haiku", "Haiku"], ["sonnet", "Sonnet"], ["opus", "Opus"]];
function lastModel() { try { const m = localStorage.getItem("hub-chat-model"); return MODELS.some(([v]) => v === m) ? m : ""; } catch { return ""; } }
function rememberModel(m) { try { localStorage.setItem("hub-chat-model", m); } catch { /* storage blocked: still works for this visit */ } }

let data = null;
let session = null;
let viewId = null;                 // a chat chosen in the drawer; null = the latest chat
let newForm = null;                // { text, model, remoteControl, skipWorkflow } while the New chat form is open
let openDecs = new Set();          // decisions folded open in the drawer, kept across the 30 s refresh
let newAsk = null;                 // { text, extra } while "Start a chat ...?" is open
let drawer = null;                 // { kind: "chats" | "decs" | "next" | "new", opener } while the drawer is open
let chatQuery = "";                // the search words in the All chats drawer
let updatedText = "";

function setNote(text, bad = false) { const n = $("note"); n.textContent = text; n.hidden = !text; n.className = "note" + (bad ? " bad" : ""); }

async function ensureSession() {
  if (session) return session;
  const r = await fetch("/api/session", { cache: "no-store" });
  session = await r.json();
  return session;
}
// the same request the dashboard sends: POST /api/action, per-run token, confirm:true
async function send(body, retry = true) {
  await ensureSession();
  const r = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Token": session.token }, body: JSON.stringify({ ...body, confirm: true }) });
  if (r.status === 403 && retry) { session = null; return send(body, false); }
  return r.json().catch(() => ({ ok: false, error: "The Hub answered something unexpected." }));
}

const APP_LINK = "claude://claude.ai/epitaxy/";
const APP_ID = /^local_[0-9a-f-]{8,64}$/i;
function appIdOf(link) {
  if (typeof link !== "string" || !link.startsWith(APP_LINK)) return null;
  const id = link.slice(APP_LINK.length);
  return APP_ID.test(id) ? id : null;
}

// the per-run token for the file upload (same token the other requests use); fresh = ask the Hub for a new one
async function getToken(fresh = false) { if (fresh) session = null; await ensureSession(); return session.token; }

const cv = createChatView({
  h, ago, send, appIdOf, setNote, getToken, projectName: () => ((data && data.project) || { name: NAME }).name,
  onChanged: () => load(),
  onRoundDone: () => { viewId = null; },   // the new chat is now the latest chat
  openChats: (opener) => openDrawer("chats", opener),
});

// ---------- helpers on the chat list ----------
function msOf(c) { const n = Date.parse(c && c.lastActive); return Number.isFinite(n) ? n : 0; }
function latestOf(chats) { return chats.reduce((best, c) => (!best || msOf(c) > msOf(best) ? c : best), null); }
function chatInView() {
  const chats = (data && data.chats) || [];
  if (!chats.length) return null;
  return (viewId && chats.find((c) => c.id === viewId)) || latestOf(chats);
}
// pinned chats first, then the newest
function ordered(chats) { return [...chats].sort((a, b) => (b.pinned === true) - (a.pinned === true) || msOf(b) - msOf(a)); }
const needsYou = (c) => c.needsYou === true || c.state === "waiting";
// chats other than the one in view that wait for Ivan
function othersNeeding() { const cur = chatInView(); return ((data && data.chats) || []).filter((c) => needsYou(c) && (!cur || c.id !== cur.id)); }

// ---------- the top bar ----------
function paintTop() {
  const d = data;
  const p = d.project || { name: NAME };
  document.title = `Hub · ${p.name}`;
  $("pt-name").textContent = p.name;
  const pct = p.percent ?? 0;
  const done = p.phase === null && pct === 100;
  $("pt-phase").textContent = done ? "Every phase finished" : p.phase ? `Phase ${p.phase.number} of ${p.phase.of} · ${p.phase.title}` : "No phase in progress";
  const bar = $("pt-bar");
  bar.setAttribute("aria-valuenow", String(pct)); bar.setAttribute("aria-label", `${p.name} progress`);
  bar.replaceChildren(fill(pct));
  $("pt-pct").textContent = `${pct}%`;
  $("pt-prog").title = `${p.stepsDone} of ${p.stepsTotal} steps · ${p.phasesDone} of ${p.phasesTotal} phases`;
  $("demo-tag").hidden = !d.demo;
  const dec = d.decisions || [];
  const chip = $("pt-decs");
  chip.hidden = !dec.length;
  chip.querySelector(".pt-chip-text").textContent = `${dec.length} decision${dec.length > 1 ? "s" : ""} waiting`;
  const n = othersNeeding().length;
  const dot = $("pt-dot");
  dot.hidden = !n; dot.textContent = n ? String(n) : "";
  $("pt-more").setAttribute("aria-label", n ? `Project menu. ${n} other chat${n > 1 ? "s" : ""} need${n > 1 ? "" : "s"} you` : "Project menu");
  $("summary").textContent = `${p.name}: ${dec.length ? dec.length + " decision" + (dec.length > 1 ? "s" : "") + " waiting" : "no decisions waiting"}`;
}
function fill(pct) { const i = document.createElement("i"); i.style.width = `${pct}%`; return i; }

function openProjectMenu() {
  const chats = (data && data.chats) || [];
  const n = othersNeeding().length;
  openMenu({
    label: "Project menu", anchor: $("pt-more"), returnTo: () => $("pt-more"),
    items: [
      { label: `All chats (${chats.length})`, icon: "list", badge: n ? `${n} need${n > 1 ? "" : "s"} you` : "", onSelect: () => openDrawer("chats", $("pt-more")) },
      { label: "New chat", icon: "plus", onSelect: () => startNewChat($("pt-more")) },
      { label: "Next steps from the handoff", icon: "clock", onSelect: () => openDrawer("next", $("pt-more")) },
      { sep: true },
      { label: updatedText || "Not updated yet", disabled: true },
    ],
  });
}

// ---------- the drawer (one at a time; the page behind it is switched off while it is open) ----------
const scrim = h("div", { class: "dr-scrim", hidden: true });
const drTitle = h("h2", { class: "sheet-title", id: "dr-title" });
const drTools = h("div", { class: "dr-tools" });
const drClose = h("button", { class: "cv-ibtn", type: "button", "data-act": "dr-close", "aria-label": "Close", title: "Close" }, icon("cross"));
const drBody = h("div", { class: "dr-body" });
const dr = h("aside", { class: "dr", role: "dialog", "aria-modal": "true", "aria-labelledby": "dr-title", tabindex: "-1", hidden: true },
  h("div", { class: "sheet-head" }, drTitle, drTools, drClose), drBody);
document.body.append(scrim, dr);
const BEHIND = () => [document.querySelector("header.top"), $("banner"), $("project-main")].filter(Boolean);

function openDrawer(kind, opener) {
  closeMenu(false);
  const was = drawer;
  drawer = { kind, opener: (was && was.opener) || opener || $("pt-more") };
  if (kind === "chats") chatQuery = "";
  scrim.hidden = false; dr.hidden = false;
  for (const e of BEHIND()) e.setAttribute("inert", "");
  requestAnimationFrame(() => { dr.classList.add("open"); scrim.classList.add("open"); });
  renderDrawer(true);
}
function closeDrawer(restore = true) {
  if (!drawer) return;
  const op = drawer.opener;
  if (drawer.kind === "new") newForm = null;   // Esc, the scrim and Cancel all drop an unsent New chat form
  drawer = null; newAsk = null;
  dr.classList.remove("open"); scrim.classList.remove("open");
  scrim.hidden = true; dr.hidden = true;
  for (const e of BEHIND()) e.removeAttribute("inert");
  if (restore) { const t = op && op.isConnected && !op.disabled ? op : $("pt-more"); t.focus({ preventScroll: true }); }
}
scrim.addEventListener("click", () => closeDrawer());
// on the document (not only the drawer): a redraw can drop the focus on the page, and Esc and Tab must still work
document.addEventListener("keydown", (e) => {
  if (!drawer) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (newAsk) { newAsk = null; renderDrawer(); const t = $("nc-text"); if (t) t.focus(); } else closeDrawer(); return; }
  if (e.key !== "Tab") return;
  const f = [...dr.querySelectorAll("button, [href], input, select, textarea, summary, [tabindex]:not([tabindex='-1'])")].filter((x) => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  const inDr = dr.contains(document.activeElement) && document.activeElement !== dr;
  if (e.shiftKey && (document.activeElement === first || !inDr)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !inDr)) { e.preventDefault(); first.focus(); }
});

function chatRow(c) {
  const state = STATE_WORD[c.state] && c.state !== "waiting" ? c.state : "idle";
  const current = chatInView() && chatInView().id === c.id;
  return h("li", {}, h("button", { class: "dr-row" + (current ? " cur" : ""), type: "button", "data-act": "open", "data-id": c.id, "aria-current": current ? "true" : null },
    h("span", { class: "dr-row-top" },
      h("span", { class: "dr-row-title" }, c.title || "Chat"),
      c.pinned === true ? h("span", { class: "dr-pin", title: "Pinned" }, icon("pin"), h("span", { class: "sr" }, "Pinned")) : null,
      current ? h("span", { class: "dr-cur" }, icon("check"), h("span", { class: "sr" }, "Open now")) : null),
    h("span", { class: "dr-row-sub" },
      needsYou(c) && c.state !== "working" ? h("span", { class: "cneeds" }, "Waiting for you") : h("span", { class: "cstate cs-" + state }, STATE_WORD[state]),
      h("span", { class: "ckind" }, KIND_WORD[c.kind] || "Chat"),
      c.lastActive ? h("span", { class: "dr-when" }, ago(c.lastActive)) : null)));
}

function decisionItem(d) {
  const hasMore = !!(d.question || (Array.isArray(d.options) && d.options.length) || d.ownerSaid || d.recommendation);
  const row = [
    h("span", { class: "dec-id" }, d.id),
    h("span", { class: "dec-title" }, d.title || "Untitled decision"),
    h("span", { class: "dec-status" }, d.status === "proposed" ? "Proposed" : "Open"),
    d.date ? h("span", { class: "dec-date" }, d.date) : null];
  if (!hasMore) return h("li", { class: "dec" }, h("div", { class: "dec-row dec-flat" }, row));
  return h("li", { class: "dec" },
    h("details", { class: "dec-fold", "data-id": d.id, open: openDecs.has(d.id) },
      h("summary", { class: "dec-row" }, h("span", { class: "dec-chev", "aria-hidden": "true" }), row),
      h("div", { class: "dec-more" },
        d.question ? h("p", { class: "dec-q" }, d.question) : null,
        Array.isArray(d.options) && d.options.length ? h("ul", { class: "opts" }, d.options.map((o) => h("li", {}, h("span", { class: "opt-key" }, o.key), h("span", {}, o.text)))) : null,
        d.ownerSaid ? h("p", { class: "dec-line" }, h("span", { class: "k" }, "Your words"), d.ownerSaid) : null,
        d.recommendation ? h("p", { class: "dec-line rec" }, h("span", { class: "k" }, "Claude recommends"), d.recommendation) : null)));
}

// ---------- New chat (19.5): the same request the dashboard's form sends ----------
function newChatForm() {
  const project = (data.project || { name: NAME }).name;
  const ta = h("textarea", { id: "nc-text", class: "chat-text", rows: "5", maxlength: String(TASK_MAX), "aria-describedby": "nc-count" });
  ta.value = newForm.text;
  const sel = h("select", { id: "nc-model", class: "chat-model" }, MODELS.map(([v, l]) => h("option", { value: v }, l)));
  sel.value = newForm.model;
  const ask = newAsk ? h("div", { class: "actions ask", role: "group", "aria-label": newAsk.text },
    h("div", { class: "ask-text" }, h("b", {}, newAsk.text), newAsk.extra ? h("span", {}, newAsk.extra) : null),
    h("button", { class: "btn primary", type: "button", "data-act": "nc-yes" }, "Yes"),
    h("button", { class: "btn", type: "button", "data-act": "nc-cancel-ask" }, "Cancel")) : null;
  return h("div", { class: "chat-form", role: "group", "aria-label": `New chat in ${project}` },
    h("div", { class: "cf-field" },
      h("label", { for: "nc-text" }, "What should Claude do?"), ta,
      h("span", { class: "cf-count", id: "nc-count" }, `${newForm.text.length} / ${TASK_MAX}`)),
    h("div", { class: "cf-field cf-model" }, h("label", { for: "nc-model" }, "Model"), sel),
    h("label", { class: "cf-check", for: "nc-rc" }, h("input", { type: "checkbox", id: "nc-rc", checked: newForm.remoteControl === true }), "Reach it from my phone (Remote Control)"),
    h("p", { class: "cf-quiet" }, "Start the chat first, then attach files to your next message."),
    h("label", { class: "cf-check", for: "nc-skip" }, h("input", { type: "checkbox", id: "nc-skip", checked: newForm.skipWorkflow === true }), "Skip the project workflow (for a quick question)"),
    ask || h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "button", "data-act": "nc-ask" }, "Start chat"),
      h("button", { class: "btn", type: "button", "data-act": "nc-close" }, "Cancel")));
}

function startNewChat(opener) {
  newForm = { text: "", model: lastModel(), remoteControl: false, skipWorkflow: false }; newAsk = null; setNote("");
  openDrawer("new", opener);
  const t = $("nc-text"); if (t) t.focus();
}

function listOfChats() {
  const chats = ordered((data && data.chats) || []);
  const q = chatQuery.trim().toLowerCase();
  const shown = q ? chats.filter((c) => (c.title || "").toLowerCase().includes(q)) : chats;
  return shown.length ? h("ul", { class: "dr-list" }, shown.map(chatRow)) : h("p", { class: "empty dr-empty" }, chats.length ? "No chat matches those words." : "No chats for this project yet.");
}

// fill the drawer for its kind. `first` = just opened (the focus goes in); otherwise only what is safe to redraw is redrawn.
function renderDrawer(first = false) {
  if (!drawer || !data) return;
  const chats = data.chats || [];
  const ae = document.activeElement;
  const keepId = !first && ae && ae.id && /^nc-(text|model|rc|skip)$/.test(ae.id) ? ae.id : null;
  const sel = keepId === "nc-text" ? [ae.selectionStart, ae.selectionEnd] : null;
  const keepAct = !first && ae && ae.dataset && ae.closest && dr.contains(ae) && ["open", "nc-ask", "nc-yes", "nc-cancel-ask", "nc-close"].includes(ae.dataset.act) ? { act: ae.dataset.act, id: ae.dataset.id } : null;
  drTools.replaceChildren();
  if (drawer.kind === "chats") {
    drTitle.textContent = `All chats (${chats.length})`;
    drTools.append(h("button", { class: "btn dr-new", type: "button", "data-act": "nc-open" }, icon("plus"), "New chat"));
    const n = othersNeeding().length;
    let box = drBody.querySelector(".dr-search input");
    if (!box || first) {
      box = h("input", { class: "dr-q", type: "search", id: "dr-q", placeholder: "Search chats", "aria-label": "Search chats", autocomplete: "off" });
      box.value = chatQuery;
      drBody.replaceChildren(
        h("div", { class: "dr-attn-slot" }),
        h("div", { class: "dr-search" }, icon("search"), box),
        h("div", { class: "dr-listwrap" }));
    }
    const attn = drBody.querySelector(".dr-attn-slot");
    attn.replaceChildren(n ? h("p", { class: "dr-attn", role: "status" }, h("span", { class: "pt-dot sm" }, String(n)), `${n} other chat${n > 1 ? "s" : ""} need${n > 1 ? "" : "s"} you`) : "");
    drBody.querySelector(".dr-listwrap").replaceChildren(listOfChats());
  } else if (drawer.kind === "decs") {
    const list = data.decisions || [];
    drTitle.textContent = `Decisions waiting (${list.length})`;
    drBody.replaceChildren(
      h("p", { class: "quiet-line" }, "Answering decisions from this page comes later. For now, tell Claude your choice in the chat."),
      list.length ? h("ul", { class: "decs" }, list.map(decisionItem)) : h("p", { class: "empty" }, "Nothing waits on you here."));
  } else if (drawer.kind === "next") {
    const t = data.handoff && typeof data.handoff.nextSteps === "string" ? data.handoff.nextSteps.trim() : "";
    drTitle.textContent = "Next steps from the handoff";
    drBody.replaceChildren(t ? h("pre", { class: "handoff" }, t) : h("p", { class: "empty" }, "No handoff note with next steps yet."));
  } else if (drawer.kind === "new") {
    drTitle.textContent = "New chat";
    if (newForm) drBody.replaceChildren(newChatForm());
  }
  if (!first && !dr.contains(document.activeElement)) dr.focus({ preventScroll: true });   // the redraw dropped the focus: keep it in the drawer
  if (first) {
    const f = drawer.kind === "chats" ? $("dr-q") : drawer.kind === "new" ? $("nc-text") : drClose;
    (f || drClose).focus({ preventScroll: true });
  } else if (keepId) {
    const t = $(keepId);
    if (t) { t.focus(); if (sel) { try { t.setSelectionRange(sel[0], sel[1]); } catch { /* ignore */ } } }
  } else if (keepAct) {
    const b = [...dr.querySelectorAll(`button[data-act="${keepAct.act}"]`)].find((x) => x.dataset.id === keepAct.id);
    if (b) b.focus();
  }
}

// ---------- the page: the chat, or a short empty state ----------
const slot = h("div", { id: "cw-slot", class: "cw-slot" });
const empty = h("div", { class: "pg-empty", hidden: true },
  h("p", { class: "pg-empty-title" }, "No chats for this project yet."),
  h("button", { class: "btn primary", type: "button", "data-act": "nc-open" }, icon("plus"), "New chat"));
$("page").append(slot, empty);
slot.append(cv.el);

function render() {
  paintTop();
  const cur = chatInView();
  slot.hidden = !cur; empty.hidden = !!cur;
  cv.show(cur);
  if (drawer && drawer.kind !== "new") renderDrawer();   // the New chat form is never redrawn under Ivan's hands
}

document.addEventListener("toggle", (e) => {
  const t = e.target;
  if (t && t.classList && t.classList.contains("dec-fold")) { if (t.open) openDecs.add(t.dataset.id); else openDecs.delete(t.dataset.id); }
}, true);

document.addEventListener("click", async (e) => {
  const tgt = e.target instanceof Element ? e.target : null;
  if (!tgt) return;
  if (tgt.closest("#pt-more")) { if (document.querySelector(".mn")) closeMenu(true); else openProjectMenu(); return; }
  if (tgt.closest("#pt-decs")) { openDrawer("decs", $("pt-decs")); return; }
  const b = tgt.closest("button[data-act]");
  if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (act === "dr-close") { closeDrawer(); return; }
  if (act === "open") { viewId = id; closeDrawer(false); render(); cv.focusHeading(); return; }
  if (act === "nc-open") { startNewChat(drawer ? drawer.opener : $("pt-more")); return; }
  if (act === "nc-close") { closeDrawer(); return; }
  if (act === "nc-ask") {
    const text = newForm ? newForm.text.trim() : "";
    if (!text) { setNote("Write what Claude should do first.", true); const t = $("nc-text"); if (t) t.focus(); return; }
    const project = (data.project || { name: NAME }).name;
    newAsk = {
      text: `Start a chat in ${project} with this task?`,
      extra: (newForm.skipWorkflow ? "The chat gets your task as it is, without the project workflow. " : "The chat first runs /pickup so it knows where the project stands, and is named like your other chats. ")
        + "Claude works without a window and uses your Claude allowance."
        + (newForm.remoteControl ? " Remote Control is on: the chat keeps running in the background so you can open it on your phone. You cannot answer it here while it is on." : ""),
    };
    setNote(""); renderDrawer();
    const y2 = dr.querySelector(".chat-form .actions.ask .btn.primary"); if (y2) y2.focus();
    return;
  }
  if (act === "nc-cancel-ask") { newAsk = null; renderDrawer(); const t = $("nc-text"); if (t) t.focus(); return; }
  if (act === "nc-yes") {
    const f = newForm; newAsk = null;
    const task = f ? f.text.trim() : "";
    if (!task) { renderDrawer(); return; }
    const project = (data.project || { name: NAME }).name;
    const body = { action: "chat-start", project, task };
    if (f.model) body.model = f.model;
    if (f.remoteControl) body.remoteControl = true;
    if (f.skipWorkflow) body.workflow = false;
    setNote("Working on it…"); renderDrawer();
    let r;
    try { r = await send(body); } catch { r = { ok: false, error: "The Hub did not answer." }; }
    if (r.ok) {
      setNote(r.message || "Done.");
      newForm = null; viewId = null;
      closeDrawer();
      await load();
      // the new chat becomes the latest chat as soon as the Hub lists it
      setTimeout(() => load(), 3000); setTimeout(() => load(), 8000);
    } else { setNote(r.error || "That did not work.", true); renderDrawer(); }
    return;
  }
});

document.addEventListener("input", (e) => {
  const t = e.target;
  if (!t || !t.id) return;
  if (t.id === "dr-q") { chatQuery = t.value; const w = dr.querySelector(".dr-listwrap"); if (w) w.replaceChildren(listOfChats()); return; }
  if (!newForm) return;
  if (t.id === "nc-text") { newForm.text = t.value; const c = $("nc-count"); if (c) c.textContent = `${t.value.length} / ${TASK_MAX}`; }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (!newForm || !t || !t.id) return;
  if (t.id === "nc-rc") newForm.remoteControl = t.checked;
  if (t.id === "nc-skip") newForm.skipWorkflow = t.checked;
  if (t.id === "nc-model") { newForm.model = t.value; rememberModel(newForm.model); }
});

function fail(msg) {
  $("summary").textContent = msg;
  $("pt-name").textContent = "Project";
  slot.hidden = true; empty.hidden = true;
  $("page").replaceChildren(h("div", { class: "none" }, h("p", { class: "none-title" }, msg), h("p", {}, h("a", { href: "/" }, "Back to the dashboard"))));
}

async function load() {
  if (!NAME) { fail("No project chosen."); return; }
  try {
    const r = await fetch("/api/project?name=" + encodeURIComponent(NAME), { cache: "no-store" });
    if (r.status === 404) { fail("This project is not known to the Hub."); return; }
    if (!r.ok) throw new Error("project");
    const j = await r.json();
    if (!j || typeof j !== "object" || !j.project) throw new Error("project");
    data = j;
    $("banner").hidden = true;
    updatedText = "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    render();
  } catch {
    $("banner").hidden = false;
    if (!data) $("summary").textContent = "Can't read the project";
  }
}

// theme switch (same as the main page)
const root = document.documentElement;
function paintToggle() {
  const dark = root.dataset.theme === "dark";
  $("theme").setAttribute("aria-pressed", String(dark));
  $("theme").setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
}
$("theme").addEventListener("click", () => {
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem("hub-theme", root.dataset.theme); } catch { /* storage blocked */ }
  paintToggle();
});
paintToggle();

load();
// refresh every 30 s while in front (the chat view also reads its own messages, 15 s while Claude works); what Ivan typed is never replaced
setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
