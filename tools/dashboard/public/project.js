// Hub project page (step 17.4, chat workspace from Phase 19). One project: what waits on Ivan, its chats, the handoff's next steps.
// Reads GET /api/project?name=... every 30 s. The "Latest chat" tab is a chat workspace (chatview.js); a chat chosen in "All chats" opens in the same view.
// The only things that change anything: the composer and the buttons in the workspace (chatview.js) and the New chat form here, all using the
// SAME request route the dashboard already uses (POST /api/action with the per-run token, confirm:true), and every one of them asks "...?" first.
// All text goes in with textContent (via h()), never as HTML, because it comes from project files.
import { createChatView } from "./chatview.js";

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

const STATE_WORD = { working: "Working", idle: "Idle", failed: "Failed", stopped: "Stopped", closed: "Closed" };
const KIND_WORD = { hub: "Hub chat", app: "App chat", terminal: "Terminal chat" };
const TASK_MAX = 4000;
// the same choices as the dashboard's New chat form (public/app.js)
const MODELS = [["", "Default"], ["haiku", "Haiku"], ["sonnet", "Sonnet"], ["opus", "Opus"]];
function lastModel() { try { const m = localStorage.getItem("hub-chat-model"); return MODELS.some(([v]) => v === m) ? m : ""; } catch { return ""; } }
function rememberModel(m) { try { localStorage.setItem("hub-chat-model", m); } catch { /* storage blocked: still works for this visit */ } }

let data = null;
let session = null;
let noteText = "";
let chatTab = "latest";            // "latest" | "all": the chosen Chats tab, kept across the 30 s refresh (D56)
let viewId = null;                 // a chat chosen in "All chats"; null = the latest chat
let newForm = null;                // { text, model, remoteControl, skipWorkflow } while the New chat form is open
let openDecs = new Set();           // decisions folded open on this page, kept across the 30 s refresh
let nextOpen = false;              // the "Next steps" fold
let newAsk = null;                 // { text, extra } while "Start a chat ...?" is open

function setNote(text, bad = false) { noteText = text; const n = $("note"); n.textContent = text; n.hidden = !text; n.className = "note" + (bad ? " bad" : ""); }

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

function fill(pct) { const i = document.createElement("i"); i.style.width = `${pct}%`; return i; }

const cv = createChatView({
  h, ago, send, appIdOf, setNote,
  onChanged: () => load(true),
  onRoundDone: () => { viewId = null; },   // the new chat is now the latest chat
});

// ---------- pieces ----------
function header(p) {
  const pct = p.percent ?? 0;
  const done = p.phase === null && pct === 100;
  const phase = done ? "Every phase finished" : p.phase ? `Phase ${p.phase.number} of ${p.phase.of} · ${p.phase.title}` : "No phase in progress";
  return h("section", { class: "panel ph", "aria-labelledby": "ph-name" },
    h("div", { class: "ph-id" }, h("h2", { id: "ph-name", class: "ph-name" }, p.name), h("p", { class: "ph-phase" }, phase)),
    h("div", { class: "ph-prog" },
      h("div", { class: "bar", role: "progressbar", "aria-valuenow": pct, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": `${p.name} progress` }, fill(pct)),
      h("p", { class: "ph-steps" }, h("b", { class: "ph-pct" }, `${pct}%`), ` done · ${p.stepsDone} of ${p.stepsTotal} steps · ${p.phasesDone} of ${p.phasesTotal} phases`)),
    p.nextStep ? h("p", { class: "ph-next" }, h("span", { class: "k" }, "Next step"), p.nextStep) : null);
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

function decisionsSection(list) {
  return h("section", { class: "panel sec decs-panel", "aria-labelledby": "h-dec" },
    h("div", { class: "decs-head" },
      h("h2", { id: "h-dec" }, "Waiting on you ", list.length ? h("span", { class: "count" }, String(list.length)) : null),
      list.length ? h("p", { class: "quiet-line" }, "Answering decisions from this page comes later. For now, tell Claude your choice in the chat.") : null),
    list.length ? h("ul", { class: "decs" }, list.map(decisionItem)) : h("p", { class: "empty" }, "Nothing waits on you here."));
}

function msOf(c) { const n = Date.parse(c && c.lastActive); return Number.isFinite(n) ? n : 0; }
function latestOf(chats) { return chats.reduce((best, c) => (!best || msOf(c) > msOf(best) ? c : best), null); }

// a row in "All chats": a summary and one button that opens the chat in the workspace
function chatRow(c) {
  const state = STATE_WORD[c.state] ? c.state : "idle";
  const current = viewId === c.id;
  return h("li", { class: "pg-row" + (c.needsYou ? " needs" : "") },
    h("div", { class: "row-main" },
      h("span", { class: "ch-title" }, c.title || "Chat"),
      h("span", { class: "ch-tags" },
        h("span", { class: "ckind" }, KIND_WORD[c.kind] || "Chat"),
        h("span", { class: "cstate cs-" + state }, STATE_WORD[state]),
        c.needsYou ? h("span", { class: "cneeds" }, c.why === "permission" ? "Needs you: permission" : "Needs you") : null),
      h("span", { class: "row-when" }, c.lastActive ? ago(c.lastActive) : ""),
      h("button", { class: "btn row-show", type: "button", "data-act": "open", "data-id": c.id, "aria-label": `Open chat: ${c.title || "Chat"}`, "aria-current": current ? "true" : null }, "Open")));
}

// ---------- New chat (19.5): the same request the dashboard's form sends ----------
function newChatForm() {
  const project = (data.project || { name: NAME }).name;
  const ta = h("textarea", { id: "nc-text", class: "chat-text", rows: "4", maxlength: String(TASK_MAX), "aria-describedby": "nc-count" });
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
    h("label", { class: "cf-check", for: "nc-skip" }, h("input", { type: "checkbox", id: "nc-skip", checked: newForm.skipWorkflow === true }), "Skip the project workflow (for a quick question)"),
    ask || h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "button", "data-act": "nc-ask" }, "Start chat"),
      h("button", { class: "btn", type: "button", "data-act": "nc-close" }, "Cancel")));
}

function chatsSection(chats) {
  const newBtn = newForm ? null : h("button", { class: "btn", type: "button", "data-act": "nc-open" }, "New chat");
  const heading = h("h2", { id: "h-chats" }, "Chats ", chats.length ? h("span", { class: "count" }, String(chats.length)) : null);
  const pad = [];
  if (newForm) pad.push(newChatForm());
  if (!chats.length) {
    pad.push(h("p", { class: "empty" }, "No chats for this project yet."));
    return h("section", { class: "panel sec chats-panel", "aria-labelledby": "h-chats" }, h("div", { class: "chats-bar" }, heading, h("span", { class: "chats-fill" }), newBtn), h("div", { class: "chats-pad" }, pad));
  }
  const latest = latestOf(chats);
  const shown = viewId && chats.find((c) => c.id === viewId);
  if (viewId && !shown) viewId = null;
  const others = chats.filter((c) => c.needsYou && c !== latest);
  const older = !!shown && shown !== latest;
  // the two notices sit in the slim bar (one line each), so the conversation starts high on the page
  const notices = [];
  if (others.length) {
    const names = others.map((c) => c.title || "Chat");
    notices.push(h("p", { class: "chat-notice", role: "status" },
      h("span", { class: "dia", "aria-hidden": "true" }, "◆"),
      h("span", { class: "cn-text" }, others.length === 1 ? "1 other chat needs you: " : `${others.length} other chats need you: `, h("b", {}, names.join(", "))),
      h("button", { class: "linkbtn", type: "button", "data-act": "tab", "data-tab": "all" }, "open All chats")));
  }
  if (older && chatTab !== "all") notices.push(h("p", { class: "view-note" }, "An older chat. ", h("button", { class: "linkbtn", type: "button", "data-act": "latest" }, "Show the latest chat")));
  const tab = (key, label, extra) => h("button", { class: "tab", type: "button", role: "tab", id: "tab-" + key, "aria-controls": "tabpanel-chats", "aria-selected": String(chatTab === key), tabindex: chatTab === key ? "0" : "-1", "data-act": "tab", "data-tab": key }, label, extra);
  const bar = h("div", { class: "chats-bar" }, heading,
    h("div", { class: "tabs", role: "tablist", "aria-label": "Chats" },
      tab("latest", older ? "This chat" : "Latest chat"),
      tab("all", `All chats (${chats.length})`, others.length ? [h("span", { class: "tab-dia", "aria-hidden": "true" }, " ◆"), h("span", { class: "sr" }, ", some need you")] : null)),
    h("div", { class: "chats-notices" }, notices), newBtn);
  const panel = h("div", { class: "tabpanel", role: "tabpanel", id: "tabpanel-chats", "aria-labelledby": "tab-" + chatTab, tabindex: "-1" });
  if (chatTab === "all") {
    panel.append(h("div", { class: "chats-pad" }, h("ul", { class: "pg-rows" }, chats.map(chatRow))));
  } else {
    panel.append(h("div", { id: "cw-slot", class: "cw-slot" }));
  }
  return h("section", { class: "panel sec chats-panel", "aria-labelledby": "h-chats" }, bar, pad.length ? h("div", { class: "chats-pad" }, pad) : null, panel);
}

function nextStepsSection(ho) {
  const t = ho && typeof ho.nextSteps === "string" ? ho.nextSteps.trim() : "";
  return h("details", { class: "panel sec next-fold", id: "next-fold", open: nextOpen },
    h("summary", { id: "h-next" }, "Next steps from the handoff"),
    t ? h("pre", { class: "handoff" }, t) : h("p", { class: "empty" }, "No handoff note with next steps yet."));
}

// ---------- render with nothing lost ----------
function paintTop() {
  const d = data;
  const p = d.project || { name: NAME };
  document.title = `Hub · ${p.name}`;
  $("crumb").textContent = p.name;
  $("demo-tag").hidden = !d.demo;
  const dec = d.decisions || [], chats = d.chats || [];
  const needN = chats.filter((c) => c.needsYou).length;
  $("summary").textContent = `${dec.length ? dec.length + " decision" + (dec.length > 1 ? "s" : "") : "No decisions"} waiting · ${needN ? needN + " chat" + (needN > 1 ? "s" : "") + " need" + (needN > 1 ? "" : "s") + " you" : "no chat needs you"}`;
}

function chatInView() {
  const chats = (data && data.chats) || [];
  if (!chats.length) return null;
  return (viewId && chats.find((c) => c.id === viewId)) || latestOf(chats);
}

// the workspace shows only while the Latest chat tab is open; the other tab leaves it out of the page (its state is kept)
function placeWorkspace() {
  const slot = $("cw-slot");
  if (!slot) { cv.show(null); return; }
  cv.snapshot();
  slot.append(cv.el);
  fitWorkspace();
  cv.show(chatInView());
  cv.restore();
}

// The workspace is as tall as the window space left under the blocks above it (never less than MIN_CW, so the conversation stays readable).
// Only a CSS variable is set; the look itself lives in chatview.css.
const MIN_CW = 690, BOTTOM_GAP = 16;
function fitWorkspace() {
  const slot = $("cw-slot");
  if (!slot) return;
  const top = slot.getBoundingClientRect().top + window.scrollY;
  const h2 = Math.max(MIN_CW, Math.floor(window.innerHeight - top - BOTTOM_GAP));
  document.documentElement.style.setProperty("--cw-h", `${h2}px`);
}
let fitTimer = null;
function fitSoon() { cancelAnimationFrame(fitTimer); fitTimer = requestAnimationFrame(fitWorkspace); }
window.addEventListener("resize", fitSoon);
// a decision folded open or closed moves the workspace: measure again
document.addEventListener("toggle", (e) => {
  const t = e.target;
  if (!t || !t.classList) return;
  if (t.classList.contains("dec-fold")) { if (t.open) openDecs.add(t.dataset.id); else openDecs.delete(t.dataset.id); fitSoon(); }
  else if (t.id === "next-fold") nextOpen = t.open;
}, true);

function render() {
  const d = data;
  const ae = document.activeElement;
  const keepId = ae && ae.id && /^nc-(text|model|rc|skip)$/.test(ae.id) ? ae.id : null;
  const sel = keepId === "nc-text" ? [ae.selectionStart, ae.selectionEnd] : null;
  const keepBtn = ae && ae.dataset && ["tab", "open", "nc-open"].includes(ae.dataset.act) ? { act: ae.dataset.act, id: ae.dataset.id, tab: ae.dataset.tab } : null;
  const y = window.scrollY;
  cv.snapshot();

  paintTop();
  const p = d.project || { name: NAME };
  $("page").replaceChildren(header(p), decisionsSection(d.decisions || []), chatsSection(d.chats || []), nextStepsSection(d.handoff));
  placeWorkspace();

  if (keepId) {
    const t = $(keepId);
    if (t) { t.focus(); if (sel) { try { t.setSelectionRange(sel[0], sel[1]); } catch { /* ignore */ } } }
  } else if (keepBtn) {
    const b = [...document.querySelectorAll(`button[data-act="${keepBtn.act}"]`)].find((x) => x.dataset.id === keepBtn.id && x.dataset.tab === keepBtn.tab);
    if (b) b.focus();
  }
  if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
}

// While Ivan types in the composer or the New chat form, or a "...?" question is open, the page is not redrawn
// (the chat view still gets fresh data); everything he typed is kept in any case.
function busy() {
  if (newAsk) return true;
  const ae = document.activeElement;
  if (cv.hasFocus()) return true;
  return !!(newForm && ae && ae.closest && ae.closest(".chat-form"));
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (act === "tab") {
    chatTab = b.dataset.tab === "all" ? "all" : "latest";
    render();
    const t2 = $("tab-" + chatTab); if (t2) t2.focus();
    return;
  }
  if (act === "open") { viewId = id; chatTab = "latest"; render(); cv.focusHeading(); return; }
  if (act === "latest") { viewId = null; render(); cv.focusHeading(); return; }
  if (act === "nc-open") {
    newForm = { text: "", model: lastModel(), remoteControl: false, skipWorkflow: false }; newAsk = null; setNote(""); render();
    const t = $("nc-text"); if (t) t.focus();
    return;
  }
  if (act === "nc-close") { newForm = null; newAsk = null; render(); const o = document.querySelector('button[data-act="nc-open"]'); if (o) o.focus(); return; }
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
    setNote(""); render();
    const y2 = document.querySelector(".chat-form .actions.ask .btn.primary"); if (y2) y2.focus();
    return;
  }
  if (act === "nc-cancel-ask") { newAsk = null; render(); const t = $("nc-text"); if (t) t.focus(); return; }
  if (act === "nc-yes") {
    const f = newForm; newAsk = null;
    const task = f ? f.text.trim() : "";
    if (!task) { render(); return; }
    const project = (data.project || { name: NAME }).name;
    const body = { action: "chat-start", project, task };
    if (f.model) body.model = f.model;
    if (f.remoteControl) body.remoteControl = true;
    if (f.skipWorkflow) body.workflow = false;
    setNote("Working on it…"); render();
    let r;
    try { r = await send(body); } catch { r = { ok: false, error: "The Hub did not answer." }; }
    if (r.ok) {
      setNote(r.message || "Done.");
      newForm = null; viewId = null; chatTab = "latest";
      await load(true);
      // the new chat becomes the latest chat as soon as the Hub lists it
      setTimeout(() => load(true), 3000); setTimeout(() => load(true), 8000);
    } else { setNote(r.error || "That did not work.", true); render(); }
    return;
  }
});

document.addEventListener("input", (e) => {
  const t = e.target;
  if (!newForm || !t || !t.id) return;
  if (t.id === "nc-text") { newForm.text = t.value; const c = $("nc-count"); if (c) c.textContent = `${t.value.length} / ${TASK_MAX}`; }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (!newForm || !t || !t.id) return;
  if (t.id === "nc-rc") newForm.remoteControl = t.checked;
  if (t.id === "nc-skip") newForm.skipWorkflow = t.checked;
  if (t.id === "nc-model") { newForm.model = t.value; rememberModel(newForm.model); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && newAsk) { newAsk = null; render(); return; }
  const tb = e.target instanceof Element ? e.target.closest('button[role="tab"]') : null;
  if (!tb) return;
  let to = null;
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") to = tb.dataset.tab === "all" ? "latest" : "all";
  else if (e.key === "Home") to = "latest"; else if (e.key === "End") to = "all";
  if (!to) return;
  e.preventDefault();
  chatTab = to; render();
  const t2 = $("tab-" + to); if (t2) t2.focus();
});

function fail(msg) {
  $("summary").textContent = msg;
  $("page").replaceChildren(h("div", { class: "none" }, h("p", { class: "none-title" }, msg), h("p", {}, h("a", { href: "/" }, "Back to the dashboard"))));
}

async function load(force = false) {
  if (!NAME) { fail("No project chosen."); return; }
  try {
    const r = await fetch("/api/project?name=" + encodeURIComponent(NAME), { cache: "no-store" });
    if (r.status === 404) { fail("This project is not known to the Hub."); return; }
    if (!r.ok) throw new Error("project");
    const j = await r.json();
    if (!j || typeof j !== "object" || !j.project) throw new Error("project");
    data = j;
    $("banner").hidden = true;
    if (force || !busy()) render();
    else { paintTop(); if ($("cw-slot")) cv.show(chatInView()); }
    $("updated").textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
// refresh every 30 s while in front; typed text and open questions are never replaced (the chat view also reads its own messages, 15 s while Claude works)
setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
