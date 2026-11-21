// Hub project page (step 17.4). One project: what waits on Ivan, its chats, the handoff's next steps.
// Reads GET /api/project?name=... every 30 s. The only things that change anything: the answer box (Send) and "Open this chat",
// both using the SAME requests the dashboard already uses (POST /api/action with the per-run token), and both ask "...?" first.
// All text goes in with textContent (via h()), never as HTML, because it comes from project files.
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
const ANSWER_MAX = 4000;
const FOLD_CHARS = 320, FOLD_LINES = 6;

let data = null;
let session = null;
let asking = null;                 // { id, text } while "Send this answer?" is open
const drafts = new Map();          // chat id -> half-typed answer
const sending = new Set();
const expanded = new Set();        // chat ids whose "Show more" is open
let noteText = "";

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

// ---------- pieces ----------
function header(p) {
  const pct = p.percent ?? 0;
  const done = p.phase === null && pct === 100;
  const phase = done ? "Every phase finished" : p.phase ? `Phase ${p.phase.number} of ${p.phase.of} · ${p.phase.title}` : "No phase in progress";
  return h("section", { class: "panel ph", "aria-labelledby": "ph-name" },
    h("div", { class: "ph-top" },
      h("div", { class: "ph-id" }, h("h2", { id: "ph-name", class: "ph-name" }, p.name), h("p", { class: "ph-phase" }, phase)),
      h("p", { class: "ph-pct", "aria-hidden": "true" }, `${pct}%`)),
    h("div", { class: "bar", role: "progressbar", "aria-valuenow": pct, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": `${p.name} progress` }, fill(pct)),
    h("p", { class: "ph-steps" }, `${pct}% done · ${p.stepsDone} of ${p.stepsTotal} steps · ${p.phasesDone} of ${p.phasesTotal} phases`),
    p.nextStep ? h("p", { class: "ph-next" }, h("span", { class: "k" }, "Next step"), p.nextStep) : null);
}

function decisionItem(d) {
  return h("li", { class: "dec" },
    h("div", { class: "dec-head" },
      h("span", { class: "dec-id" }, d.id),
      h("span", { class: "dec-title" }, d.title || "Untitled decision"),
      h("span", { class: "dec-status" }, d.status === "proposed" ? "Proposed" : "Open"),
      d.date ? h("span", { class: "dec-date" }, d.date) : null),
    d.question ? h("p", { class: "dec-q" }, d.question) : null,
    Array.isArray(d.options) && d.options.length ? h("ul", { class: "opts" }, d.options.map((o) => h("li", {}, h("span", { class: "opt-key" }, o.key), h("span", {}, o.text)))) : null,
    d.ownerSaid ? h("p", { class: "dec-line" }, h("span", { class: "k" }, "Your words"), d.ownerSaid) : null,
    d.recommendation ? h("p", { class: "dec-line rec" }, h("span", { class: "k" }, "Claude recommends"), d.recommendation) : null);
}

function decisionsSection(list) {
  return h("section", { class: "panel sec", "aria-labelledby": "h-dec" },
    h("h2", { id: "h-dec" }, "Waiting on you ", list.length ? h("span", { class: "count" }, String(list.length)) : null),
    list.length ? h("ul", { class: "decs" }, list.map(decisionItem)) : h("p", { class: "empty" }, "Nothing waits on you here."),
    list.length ? h("p", { class: "quiet-line" }, "Answering decisions from this page comes later. For now, tell Claude your choice in the chat.") : null);
}

function saidBlock(c) {
  const text = c.lastSaid || "";
  if (!text) return h("p", { class: "empty" }, c.state === "working" ? "Working on it…" : "No saved reply found.");
  const long = text.length > FOLD_CHARS || text.split("\n").length > FOLD_LINES;
  const open = expanded.has(c.id);
  return h("div", { class: "said-wrap" },
    h("span", { class: "cp-label" }, "Claude last said", c.lastSaidAt ? h("span", { class: "said-when" }, ` · ${ago(c.lastSaidAt)}`) : null),
    h("div", { class: "said-text" + (long && !open ? " folded" : "") }, text),
    long ? h("button", { class: "chat-more", type: "button", "aria-expanded": String(open), "data-act": "more", "data-id": c.id }, open ? "Show less" : "Show more") : null);
}

function askRow() {
  return h("div", { class: "actions ask", role: "group", "aria-label": asking.text },
    h("div", { class: "ask-text" }, h("b", {}, asking.text), asking.extra ? h("span", {}, asking.extra) : null),
    h("button", { class: "btn primary", type: "button", "data-act": "yes" }, "Yes"),
    h("button", { class: "btn", type: "button", "data-act": "cancel" }, "Cancel"));
}

function chatItem(c, i) {
  const state = STATE_WORD[c.state] ? c.state : "idle";
  const kids = [
    h("div", { class: "ch-head" },
      h("span", { class: "ch-title" }, c.title || "Chat"),
      h("span", { class: "ch-tags" },
        h("span", { class: "ckind" }, KIND_WORD[c.kind] || "Chat"),
        h("span", { class: "cstate cs-" + state }, STATE_WORD[state]),
        c.needsYou ? h("span", { class: "cneeds" }, c.why === "permission" ? "Needs you: permission" : "Needs you") : null,
        c.remoteControl === true ? h("span", { class: "crc" }, "Remote Control") : null)),
    h("p", { class: "ch-meta" }, c.lastActive ? `Last active ${ago(c.lastActive)}` : "", c.needsYou && c.since ? ` · waiting since ${ago(c.since)}` : ""),
    saidBlock(c)];

  if (c.kind === "hub") {
    if (c.canAnswer) {
      const busy = sending.has(c.id);
      const draft = drafts.get(c.id) || "";
      const ta = h("textarea", { id: "ans-" + i, class: "chat-text", rows: "3", maxlength: String(ANSWER_MAX), "data-id": c.id, "aria-describedby": "cnt-" + i });
      ta.value = draft;
      kids.push(h("div", { class: "cf-field" }, h("label", { for: "ans-" + i }, "Your answer"), ta, h("span", { class: "cf-count", id: "cnt-" + i }, `${draft.length} / ${ANSWER_MAX}`)));
      kids.push(asking && asking.id === c.id ? askRow()
        : h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", "data-act": "ask-send", "data-id": c.id, disabled: busy || !draft.trim() }, "Send")));
    } else if (c.remoteControl === true) {
      kids.push(h("p", { class: "cp-note" }, "Remote Control is on. Answer it on your phone, or turn Remote Control off on the dashboard to answer it here."));
    } else if (c.state === "working") {
      kids.push(h("p", { class: "cp-note" }, "Claude is working on it. You can answer when it stops."));
    }
    const appId = appIdOf(c.openLink);
    if (typeof c.openLink === "string" && c.openLink.startsWith("claude://resume?session=")) {
      kids.push(h("div", { class: "actions" }, h("button", { class: "btn", type: "button", "data-act": "open-hub", "data-id": c.id }, "Open in the app")));
    } else if (appId) kids.push(h("div", { class: "actions" }, h("button", { class: "btn", type: "button", "data-act": "open-app", "data-app-id": appId }, "Open this chat")));
  } else if (c.kind === "app") {
    kids.push(h("p", { class: "cp-note" }, c.state === "closed" ? "This chat is closed. Open it in the Claude app and answer it there." : "This chat is open in the Claude app. Answer it there so it does not split."));
    // FUTURE (D40/D54): answering app chats from this page is NOT built. It waits for the safety test. Do not add a writing box here before that.
    const appId = appIdOf(c.openLink);
    const rc = c.remoteControl === true ? "Remote Control: on" : c.remoteControl === false ? "Remote Control: off" : null;
    if (appId || rc) kids.push(h("div", { class: "actions" }, appId ? h("button", { class: "btn open-this", type: "button", "data-act": "open-app", "data-app-id": appId }, "Open this chat") : null, rc ? h("span", { class: "cp-rc" }, rc) : null));
  } else {
    kids.push(h("p", { class: "cp-note" }, "This chat is open in a terminal. Answer it there."));
  }
  return h("li", { class: "chat-card" + (c.needsYou ? " needs" : "") }, kids);
}

function chatsSection(chats) {
  const need = chats.filter((c) => c.needsYou), rest = chats.filter((c) => !c.needsYou);
  let n = 0;
  const kids = [h("h2", { id: "h-chats" }, "Chats ", chats.length ? h("span", { class: "count" }, String(chats.length)) : null)];
  if (!chats.length) kids.push(h("p", { class: "empty" }, "No chats for this project yet. Start one from the card on the dashboard."));
  if (need.length) kids.push(h("h3", { class: "sub" }, "Needs you"), h("ul", { class: "chat-cards" }, need.map((c) => chatItem(c, n++))));
  else if (chats.length) kids.push(h("p", { class: "empty" }, "No chat needs you right now."));
  if (rest.length) kids.push(h("h3", { class: "sub" }, need.length ? "Other chats" : "Chats"), h("ul", { class: "chat-cards" }, rest.map((c) => chatItem(c, n++))));
  return h("section", { class: "panel sec", "aria-labelledby": "h-chats" }, kids);
}

function nextStepsSection(ho) {
  const t = ho && typeof ho.nextSteps === "string" ? ho.nextSteps.trim() : "";
  return h("section", { class: "panel sec", "aria-labelledby": "h-next" },
    h("h2", { id: "h-next" }, "Next steps from the handoff"),
    t ? h("pre", { class: "handoff" }, t) : h("p", { class: "empty" }, "No handoff note with next steps yet."));
}

// ---------- render with nothing lost ----------
function render() {
  const d = data;
  const ae = document.activeElement;
  const keepId = ae && ae.tagName === "TEXTAREA" ? ae.dataset.id : null;
  const sel = keepId ? [ae.selectionStart, ae.selectionEnd] : null;
  const keepMore = ae && ae.dataset && ae.dataset.act === "more" ? ae.dataset.id : null;
  const y = window.scrollY;

  const p = d.project || { name: NAME };
  document.title = `Hub · ${p.name}`;
  $("crumb").textContent = p.name;
  $("demo-tag").hidden = !d.demo;
  const dec = d.decisions || [], chats = d.chats || [];
  const needN = chats.filter((c) => c.needsYou).length;
  $("summary").textContent = `${dec.length ? dec.length + " decision" + (dec.length > 1 ? "s" : "") : "No decisions"} waiting · ${needN ? needN + " chat" + (needN > 1 ? "s" : "") + " need" + (needN > 1 ? "" : "s") + " you" : "no chat needs you"}`;
  $("page").replaceChildren(header(p), decisionsSection(dec), chatsSection(chats), nextStepsSection(d.handoff));

  if (keepId) {
    const t = [...document.querySelectorAll("textarea[data-id]")].find((x) => x.dataset.id === keepId);
    if (t) { t.focus(); try { t.setSelectionRange(sel[0], sel[1]); } catch { /* ignore */ } }
  } else if (keepMore) {
    const b = [...document.querySelectorAll('button[data-act="more"]')].find((x) => x.dataset.id === keepMore);
    if (b) b.focus();
  }
  if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
}

// only an open "Send this answer?" question pauses redrawing; typed text and open folds are kept across a redraw
function busy() { return !!asking; }

function findChat(id) { return data && (data.chats || []).find((c) => c.id === id); }

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (act === "more") { if (expanded.has(id)) expanded.delete(id); else expanded.add(id); render(); return; }
  if (act === "ask-send") {
    const text = (drafts.get(id) || "").trim();
    if (!text) return;
    asking = { id, text: "Send this answer to this chat?", extra: "Claude works without a window and uses your Claude allowance." };
    setNote(""); render();
    const y = document.querySelector(".actions.ask .btn.primary"); if (y) y.focus();
    return;
  }
  if (act === "cancel") { asking = null; setNote(""); render(); return; }
  if (act === "yes") {
    const a = asking; asking = null;
    const c = a && findChat(a.id);
    const text = a ? (drafts.get(a.id) || "").trim() : "";
    if (!c || c.kind !== "hub" || !/^h-/.test(a.id) || !text || sending.has(a.id)) { render(); return; }
    sending.add(a.id); setNote("Working on it…"); render();
    let r;
    try { r = await send({ action: "chat-answer", id: a.id, text }); } finally { sending.delete(a.id); }
    if (r.ok) { setNote(r.message || "Sent."); drafts.delete(a.id); } else setNote(r.error || "That did not work.", true);
    await load(true);
    return;
  }
  if (act === "open-app") { if (APP_ID.test(b.dataset.appId || "")) await open({ action: "chat-open-app", appId: b.dataset.appId }); return; }
  if (act === "open-hub") { if (/^h-/.test(id || "")) await open({ action: "chat-open-app", hubId: id }); return; }
});
async function open(body) {
  setNote("Working on it…");
  const r = await send(body);
  setNote(r.ok ? r.message || "Opening in the Claude app." : r.error || "That did not work.", !r.ok);
}

document.addEventListener("input", (e) => {
  const t = e.target;
  if (!(t instanceof HTMLTextAreaElement) || !t.dataset.id) return;
  drafts.set(t.dataset.id, t.value);
  const cnt = t.parentElement.querySelector(".cf-count"); if (cnt) cnt.textContent = `${t.value.length} / ${ANSWER_MAX}`;
  const btn = t.closest(".chat-card").querySelector('button[data-act="ask-send"]'); if (btn) btn.disabled = !t.value.trim() || sending.has(t.dataset.id);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && asking) { asking = null; render(); } });

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
// refresh every 30 s while in front; a half-typed answer or an open question is never replaced
setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
