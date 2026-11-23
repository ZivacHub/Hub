// Hub dashboard page. Reading is plain GETs. The only things that change anything are the buttons below: Start, Stop, Open in
// Claude Code and "Start with PC". Each one asks "...?" first (D25) and the server only accepts programs from config/projects.json.
// All text goes in with textContent, never as HTML, because it comes from project files.
const REFRESH_MS = 30_000;
const $ = (id) => document.getElementById(id);

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
const saved = (d) => (d === null || d === undefined ? "no handoff note" : d === 0 ? "saved today" : d === 1 ? "saved yesterday" : `saved ${d} days ago`);

// the width is set on the element (allowed by the strict style policy), not as an inline style attribute
function fill(pct) { const i = document.createElement("i"); i.style.width = `${pct}%`; return i; }

// ---------- start / stop / open / start-with-PC ----------
let session = null;                 // { token, demo } from /api/session
let runtime = [];                   // one entry per startable project
let lastData = null;                // last render input, so the question row survives the 30 s refresh
let asking = null;                  // { kind, name, id, label, text } while a "...?" row is open
let note = "";
let runningNow = [];
let doneInfo = { allDone: false, finishedAt: null };   // "everything is done" (from /api/running)                   // what is working right now (from /api/running)
let game = null;                    // game mode state from /api/game
const GAME_ASK = "__game";           // the name a game-mode question is filed under (never a project name)
let ignoredOpen = false;
let needs = [];                     // chats that are waiting for Ivan (from /api/needs-you)
const needsFor = (name) => needs.filter((n) => n.project === name);
const waited = (iso) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 60 ? `${Math.max(m, 1)} min` : m < 1440 ? `${Math.round(m / 60)} h` : (d => d === 1 ? "1 day" : `${d} days`)(Math.round(m / 1440)); };
const rtFor = (name) => runtime.find((r) => r.name === name);

function setNote(text, bad = false) { note = text; const n = $("note"); n.textContent = text; n.hidden = !text; n.className = "note" + (bad ? " bad" : ""); }

function question(kind, name, rt, text, extra) {
  return { kind, name, id: rt ? rt.id : null, label: rt ? rt.label : name, text, extra: extra || "" };
}

function controls(name) {
  const rt = rtFor(name);
  if (!rt) return null;
  if (asking && asking.name === name) {
    return h("div", { class: "actions ask", role: "group", "aria-label": asking.text },
      h("div", { class: "ask-text" }, h("b", {}, asking.text), asking.extra ? h("span", {}, asking.extra) : null),
      h("button", { class: "btn primary", type: "button", "data-act": "yes" }, "Yes"),
      h("button", { class: "btn", type: "button", "data-act": "cancel" }, "Cancel"));
  }
  const kids = [];
  if (rt) {
    if (rt.status === "running") kids.push(h("a", { class: "run on", href: rt.url, target: "_blank", rel: "noopener" }, h("span", { class: "dot on", "aria-hidden": "true" }), `Running · port ${rt.port}`));
    else if (rt.status === "starting") kids.push(h("span", { class: "run" }, h("span", { class: "dot busy", "aria-hidden": "true" }), "Starting…"));
    else kids.push(h("span", { class: "run" }, h("span", { class: "dot", "aria-hidden": "true" }), "Stopped"));
    if (rt.status === "stopped" && rt.canStart) kids.push(h("button", { class: "btn primary", type: "button", "data-act": "ask-start", "data-name": name }, "Start"));
    if ((rt.status === "running" || rt.status === "starting") && rt.startedByHub) kids.push(h("button", { class: "btn", type: "button", "data-act": "ask-stop", "data-name": name }, "Stop"));
  }
  if (rt) kids.push(h("button", { class: "switch", type: "button", role: "switch", "aria-checked": String(rt.startWithPc), "data-act": "ask-autostart", "data-name": name }, h("span", { class: "track", "aria-hidden": "true" }), "Start with PC"));
  const msgs = [];
  if (rt && rt.error) msgs.push(h("p", { class: "run-err" }, `Last start failed: ${rt.error}`));
  if (rt && rt.status === "running" && !rt.startedByHub) msgs.push(h("p", { class: "run-note" }, "Started outside the Hub, so the Hub will not stop it."));
  if (rt && rt.status === "stopped" && !rt.canStart) msgs.push(h("p", { class: "run-note" }, "Can't start from here: its folder or program was not found."));
  return h("div", { class: "actions-wrap" }, h("div", { class: "actions" }, kids), msgs);
}

async function ensureSession() {
  if (session) return session;
  const r = await fetch("/api/session", { cache: "no-store" });
  session = await r.json();
  return session;
}

async function send(body, retry = true) {
  await ensureSession();
  const r = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Token": session.token }, body: JSON.stringify({ ...body, confirm: true }) });
  if (r.status === 403 && retry) { session = null; return send(body, false); } // the server was restarted: fetch the new token once
  return r.json().catch(() => ({ ok: false, error: "The Hub answered something unexpected." }));
}

async function loadGame() {
  try { game = await (await fetch("/api/game", { cache: "no-store" })).json(); } catch { /* keep the last state */ }
}

let helpers = null;                 // totals from /api/helpers; null = never read yet
let helpersFailed = false;
async function loadHelpers() {
  try {
    const r = await fetch("/api/helpers", { cache: "no-store" });
    if (!r.ok) throw new Error("helpers");
    const t = (await r.json()).totals;
    if (!t || typeof t !== "object") throw new Error("helpers");
    helpers = t; helpersFailed = false;
  } catch { if (!helpers) helpersFailed = true; /* later failures: keep the last numbers */ }
}

function renderHelpers() {
  const t = helpers || {}, n = (k) => Number(t[k]) || 0;
  const lines = [
    ["parked", `${n("parked")} waiting for you`, "hl-urgent"],
    ["review", `${n("review")} waiting for the manager's check`, ""],
    ["failed", `${n("failed")} failed the check`, ""],
    ["stuck", `${n("stuck")} stuck (running over 2 hours)`, ""],
    ["running", `${n("running")} running`, ""],
    ["done", `${n("done")} done`, "hl-quiet"],
  ].filter(([k]) => n(k) > 0);
  const need = n("parked") + n("review") + n("failed") + n("stuck");
  $("helpers-count").textContent = need || "";
  $("helpers").replaceChildren(...(helpers
    ? (lines.length ? lines.map(([, text, cls]) => h("li", { class: cls }, text)) : [h("li", { class: "hl-quiet" }, "No helper tasks yet.")])
    : [h("li", { class: "hl-quiet" }, helpersFailed ? "Can't read the helper records." : "Loading…")]));
}

async function loadRunning() {
  await loadGame();
  await loadHelpers();
  await loadChats();
  try { const j = await (await fetch("/api/running", { cache: "no-store" })).json(); runningNow = j.items || []; doneInfo = j.done || { allDone: false, finishedAt: null }; } catch { /* keep the last list */ }
}

async function loadNeeds() {
  try { needs = (await (await fetch("/api/needs-you", { cache: "no-store" })).json()).items || []; } catch { /* keep the last list */ }
}

async function loadRuntime() {
  try { const r = await (await fetch("/api/runtime", { cache: "no-store" })).json(); runtime = r.items || []; } catch { /* keep the last state */ }
}

let polling = false;
async function pollWhileStarting() {
  if (polling) return; polling = true;
  const until = Date.now() + 5 * 60_000;
  while (Date.now() < until) {
    await new Promise((d) => setTimeout(d, 2000));
    await Promise.all([loadRuntime(), loadRunning()]); if (lastData && !form && !answerBusy()) render(lastData);
    if (!runtime.some((r) => r.status === "starting")) break;
  }
  polling = false;
}

async function perform(a) {
  const body = a.kind === "start" ? { action: "start", id: a.id }
    : a.kind === "stop" ? { action: "stop", id: a.id }
    : a.kind === "game-off" ? { action: "game-off" }
    : a.kind === "game-on" ? { action: "game-on" }
    : a.kind === "game-ignore" ? { action: "game-ignore", app: a.app }
    : a.kind === "game-unignore" ? { action: "game-unignore", app: a.app }
    : { action: "autostart", id: a.id, value: a.kind === "autostart-on" };
  setNote("Working on it…");
  const r = await send(body);
  setNote(r.ok ? r.message : r.error || "That did not work.", !r.ok);
  await Promise.all([loadRuntime(), loadRunning()]); if (lastData) render(lastData);
  if (r.ok && a.kind === "start") pollWhileStarting();
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const act = b.dataset.act, name = b.dataset.name, rt = rtFor(name);
  if (act === "open-app") { const id = b.dataset.appId; if (APP_ID.test(id || "")) openInApp({ action: "chat-open-app", appId: id }); return; }
  if (act === "open-app-hub") { const id = b.dataset.id; if (/^h-/.test(id || "")) openInApp({ action: "chat-open-app", hubId: id }); return; }
  if (act === "cancel") { asking = null; setNote(""); }
  else if (act === "yes") { const a = asking; asking = null; if (a && a.kind.startsWith("cp-")) { doPanel(a); if (lastData) render(lastData); } else if (a && a.kind.startsWith("chat-")) { doChat(a); if (lastData) render(lastData); } else if (a) perform(a); return; }
  else if (act === "chat-open") { const id = b.dataset.id; asking = null; form = null; openChat = openChat === id ? null : id; setNote(""); }
  else if (act === "cp-send") askPanel(b.dataset.id, name, "cp-send");
  else if (act === "cp-handoff") askPanel(b.dataset.id, name, "cp-handoff");
  else if (act === "cp-pickup") askPanel(b.dataset.id, name, "cp-pickup");
  else if (act === "cp-rc-on") askPanel(b.dataset.id, name, "cp-rc-on");
  else if (act === "cp-rc-off") askPanel(b.dataset.id, name, "cp-rc-off");
  else if (act === "cp-stop") askPanel(b.dataset.id, name, "cp-stop");
  else if (act === "chat-new") { asking = null; openChat = null; form = { project: name, text: "", model: lastModel(), remoteControl: false, skipWorkflow: false }; focusForm = true; setNote(""); }
  else if (act === "chat-cancel") { form = null; asking = null; setNote(""); }
  else if (act === "chat-ask-here") { if (form) askChat("chat-here", form.project); }
  else if (act === "chat-ask-app") { if (form) askChat("chat-app", form.project); }
  else if (act === "chat-ask-pickup") { if (form) askChat("chat-pickup", form.project); }
  else if (act === "chat-ask-terminal") { if (form) askChat("chat-terminal", form.project); }
  else if (act === "chat-more") { if (chatsExpanded.has(name)) chatsExpanded.delete(name); else chatsExpanded.add(name); }
  else if (act === "ask-game-off") asking = question("game-off", GAME_ASK, null, "Turn game mode off for now?", "Background programs go back to full speed and anything paused starts again. Game mode switches on again with your next game.");
  else if (act === "ask-game-on") asking = question("game-on", GAME_ASK, null, "Turn game mode back on?", "It switches on at the next check, about 10 seconds, if a game is running.");
  else if (act === "ask-game-ignore") asking = { ...question("game-ignore", GAME_ASK, null, `Ignore ${game.game}?`, "Game mode will not switch on for this app again, even while it is full screen. You can undo this in the list below."), app: game.app };
  else if (act === "ask-game-unignore") asking = { ...question("game-unignore", GAME_ASK, null, `Stop ignoring ${b.dataset.app}?`, "Game mode can switch on for it again."), app: b.dataset.app };
  else if (act === "ask-start") asking = question("start", name, rt, `Start ${rt.label}?`, rt.warn || rt.note);
  else if (act === "ask-stop") asking = question("stop", name, rt, `Stop ${rt.label}?`);
  else if (act === "ask-autostart") asking = rt.startWithPc ? question("autostart-off", name, rt, `Stop ${rt.label} from starting with the PC?`)
    : question("autostart-on", name, rt, `Start ${rt.label} together with the PC?`, rt.warn || "It starts a few seconds after the PC does, once the Hub's start-up entry is installed.");
  if (lastData) render(lastData);
  const focus = document.querySelector(".actions.ask .btn.primary"); if (focus && asking) focus.focus();
  else if (focusForm && form) { const t = $("chat-text"); if (t) t.focus(); }
  else if (act === "chat-open") { const again = [...document.querySelectorAll('button[data-act="chat-open"]')].find((x) => x.dataset.id === b.dataset.id); if (again) again.focus(); }
  else if (act === "chat-more") { const again = [...document.querySelectorAll('button[data-act="chat-more"]')].find((x) => x.dataset.name === name); if (again) again.focus(); }
  focusForm = false;
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (asking) { asking = null; if (lastData) render(lastData); }
  else if (form) { form = null; if (lastData) render(lastData); }
});

// ---------- game mode strip (step 13.4) ----------
function renderGame() {
  const el = $("game"), g = game || {}, ignored = g.ignored || [];
  const main = g.on || g.overridden;
  el.hidden = !(main || ignored.length);
  if (el.hidden) { el.replaceChildren(); return; }
  el.className = "game" + (g.on ? "" : " off");
  const askHere = asking && asking.name === GAME_ASK;
  const askRow = askHere ? h("div", { class: "actions ask", role: "group", "aria-label": asking.text },
    h("div", { class: "ask-text" }, h("b", {}, asking.text), asking.extra ? h("span", {}, asking.extra) : null),
    h("button", { class: "btn primary", type: "button", "data-act": "yes" }, "Yes"),
    h("button", { class: "btn", type: "button", "data-act": "cancel" }, "Cancel")) : null;
  const askMain = askHere && main && asking.kind !== "game-unignore";   // the question for an ignored app sits under the list, the others replace the buttons
  const kids = [];
  if (main) {
    let title, detail, buttons;
    if (g.on) {
      const s = g.slowdown || {}, p = g.pauses || {}, bits = [];
      if (s.processes > 0) bits.push(`${s.processes} background process${s.processes > 1 ? "es" : ""} slowed`);
      if (s.frozen > 0) bits.push(`${s.frozen} frozen`);
      if ((p.docker || []).length) bits.push(`${p.docker.join(", ")} paused`);
      if ((p.ollamaUnloaded || []).length) bits.push(`AI model${p.ollamaUnloaded.length > 1 ? "s" : ""} unloaded`);
      title = [h("span", { class: "dot on", "aria-hidden": "true" }), "Game mode is on", h("span", { class: "why" }, `${g.reason}${g.since ? " · since " + new Date(g.since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}`)];
      detail = bits.length ? bits.join(" · ") : "Nothing the Hub started is running, so nothing needed slowing down.";
      buttons = [h("button", { class: "btn", type: "button", "data-act": "ask-game-off" }, "Turn game mode off for now"),
        g.app ? h("button", { class: "btn", type: "button", "data-act": "ask-game-ignore" }, "Ignore this app") : null];
    } else {
      title = [h("span", { class: "dot", "aria-hidden": "true" }), "Game mode is off for now"];
      detail = `You turned it off${g.overriddenGame ? " while " + g.overriddenGame + " is running" : ""}. Everything is back to normal. It switches on again with your next game.`;
      buttons = [h("button", { class: "btn", type: "button", "data-act": "ask-game-on" }, "Turn it back on")];
    }
    kids.push(h("div", { class: "game-main" },
      h("div", { class: "game-text" }, h("div", { class: "game-title" }, title), h("div", { class: "game-detail" }, detail)),
      askMain ? askRow : h("div", { class: "game-btns" }, buttons)));
  }
  if (ignored.length) {
    const det = h("details", { class: "game-ignored", open: ignoredOpen || (askHere && asking.kind === "game-unignore") },
      h("summary", {}, `Ignored apps (${ignored.length})`),
      h("ul", {}, ignored.map((n) => h("li", {}, h("span", {}, n), h("button", { class: "btn", type: "button", "data-act": "ask-game-unignore", "data-app": n }, "Stop ignoring")))));
    det.addEventListener("toggle", () => { ignoredOpen = det.open; });
    kids.push(det);
  }
  if (askHere && !askMain) kids.push(askRow);
  el.replaceChildren(...kids);
}

// ---------- chats on the cards (step 14.3) ----------
let chatsData = null;               // answer of /api/chats; null = never read yet
const chatsExpanded = new Set();    // projects whose "Show N more" is open
let form = null;                    // { project, text, model } while the New chat form is open (only one on the page)
let focusForm = false;
let openChat = null;                // id of the chat whose panel is open (only one panel or the form on the page)
const drafts = new Map();           // chat id -> text typed in its answer box
const sending = new Set();          // chat ids with a request on its way
const ANSWER_MAX = 4000;
const TASK_MAX = 4000;
const MODELS = [["", "Default"], ["haiku", "Haiku"], ["sonnet", "Sonnet"], ["opus", "Opus"]];
const STATE_WORD = { working: "Working", waiting: "Waiting for you", idle: "Idle", failed: "Failed", stopped: "Stopped", closed: "Closed" };
const KIND_WORD = { hub: "Hub", app: "App", terminal: "Terminal" };
const FIRST_LINES = 4;
function lastModel() { try { const m = localStorage.getItem("hub-chat-model"); return MODELS.some(([v]) => v === m) ? m : ""; } catch { return ""; } }
function rememberModel(m) { try { localStorage.setItem("hub-chat-model", m); } catch { /* storage blocked: still works for this visit */ } }
const chatKey = (project) => "chat:" + project;   // the name a chat question is filed under, so the card's Start / Stop row stays as it is

async function loadChats() {
  try {
    const r = await fetch("/api/chats", { cache: "no-store" });
    if (!r.ok) throw new Error("chats");
    const j = await r.json();
    if (!j || !Array.isArray(j.projects)) throw new Error("chats");
    chatsData = j;
  } catch { /* keep the last data */ }
}

const APP_LINK = "claude://claude.ai/epitaxy/";
const APP_ID = /^local_[0-9a-f-]{8,64}$/i;
// 14.11: never a link: the page only sends an id, and the SERVER opens the chat (a claude:// link in the page took the Hub away)
function openThis(link) {
  if (typeof link !== "string" || !link.startsWith(APP_LINK)) return null;
  const id = link.slice(APP_LINK.length);
  return APP_ID.test(id) ? h("button", { class: "btn open-this", type: "button", "data-act": "open-app", "data-app-id": id }, "Open this chat") : null;
}
async function openInApp(body) {
  setNote("Working on it…");
  const r = await send(body);
  setNote(r.ok ? r.message || "Opening in the Claude app." : r.error || "That did not work.", !r.ok);
}

function chatLine(c, project) {
  const state = STATE_WORD[c.state] ? c.state : "idle";
  const open = openChat === c.id;
  return h("li", { class: "chat" + (c.needsYou ? " needs" : "") + (open ? " open" : "") },
    h("button", { class: "chat-row chat-btn", type: "button", "aria-expanded": String(open), "aria-controls": "cp-" + c.id, "data-act": "chat-open", "data-id": c.id, "data-name": project },
      h("span", { class: "chat-name", title: c.name }, c.name),
      h("span", { class: "cstate cs-" + state }, STATE_WORD[state]),
      h("span", { class: "ckind" }, KIND_WORD[c.kind] || "Chat"),
      c.remoteControl === true ? h("span", { class: "crc" }, "Remote Control") : null,
      c.needsYou ? h("span", { class: "cneeds" }, "Needs you") : null,
      h("span", { class: "chev", "aria-hidden": "true" })),
    c.needsYou && c.snippet && !open ? h("p", { class: "chat-snip" }, c.snippet) : null,
    open ? chatPanel(c, project) : null);
}

function panelMeta(c) {
  const state = STATE_WORD[c.state] ? c.state : "idle";
  const bits = [];
  if (c.kind === "hub") {
    if (c.since) bits.push("Started " + ago(c.since));
    if (c.lastActive) bits.push("Last turn " + ago(c.lastActive));
    if (c.model) bits.push(c.model);
    if (c.turns !== null && c.turns !== undefined) bits.push("Turns: " + c.turns);
  } else if (c.lastActive) bits.push("Last active " + ago(c.lastActive));
  return h("div", { class: "cp-meta" }, h("span", { class: "cstate cs-" + state }, STATE_WORD[state]), bits.map((t) => h("span", {}, t)));
}

function panelAsk(c, rcRow = false) {
  if (!(asking && asking.kind.startsWith("cp-") && asking.id === c.id)) return null;
  if (rcRow !== asking.kind.startsWith("cp-rc-")) return null;
  return h("div", { class: "actions ask", role: "group", "aria-label": asking.text },
    h("div", { class: "ask-text" }, h("b", {}, asking.text), asking.extra ? h("span", {}, asking.extra) : null),
    h("button", { class: "btn primary", type: "button", "data-act": "yes" }, "Yes"),
    h("button", { class: "btn", type: "button", "data-act": "cancel" }, "Cancel"));
}

function chatPanel(c, project) {
  const kids = [panelMeta(c)];
  if (c.kind === "hub") {
    if (c.state === "failed") {
      kids.push(h("div", { class: "cp-block" }, h("span", { class: "cp-label" }, "What went wrong"), h("div", { class: "cp-text bad" }, c.snippet || "No details were saved.")));
    } else {
      kids.push(h("div", { class: "cp-block" }, h("span", { class: "cp-label" }, "Claude last said"),
        c.lastReply ? h("div", { class: "cp-text" }, c.lastReply)
          : h("p", { class: "cp-empty" }, c.state === "working" ? "Working on it…" : "No reply yet.")));
    }
    if (Array.isArray(c.refused) && c.refused.length) {
      kids.push(h("div", { class: "cp-block" }, h("span", { class: "cp-label" }, "Claude was not allowed to:"), h("ul", { class: "cp-refused" }, c.refused.map((r) => h("li", {}, r)))));
    }
    const busy = sending.has(c.id);
    const ask = panelAsk(c);
    const rcAsk = panelAsk(c, true);
    const rcOn = c.remoteControl === true;
    kids.splice(1, 0, h("p", { class: "cp-rcline" }, rcOn ? "Remote Control: on" : "Remote Control: off"));
    if (c.canAnswer) {
      const draft = drafts.get(c.id) || "";
      const ta = h("textarea", { id: "ans-text", class: "chat-text", rows: "3", maxlength: String(ANSWER_MAX), "data-id": c.id });
      ta.value = draft;
      kids.push(h("div", { class: "cf-field" }, h("label", { for: "ans-text" }, "Your answer"), ta, h("span", { class: "cf-count", id: "ans-count" }, `${draft.length} / ${ANSWER_MAX}`)));
      kids.push(ask || h("div", { class: "actions" },
        h("button", { class: "btn primary", id: "ans-send", type: "button", "data-act": "cp-send", "data-id": c.id, "data-name": project, disabled: busy || !draft.trim() }, "Send"),
        h("button", { class: "btn", type: "button", "data-act": "cp-handoff", "data-id": c.id, "data-name": project, disabled: busy }, "Hand off"),
        h("button", { class: "btn", type: "button", "data-act": "cp-pickup", "data-id": c.id, "data-name": project, disabled: busy }, "Pick up")));
    } else {
      if (rcOn) kids.push(h("p", { class: "cp-note" }, "Remote Control is on. Answer it on your phone, or turn Remote Control off here to answer it from the Hub."));
      if (c.state === "working") kids.push(ask || h("div", { class: "actions" }, h("button", { class: "btn", type: "button", "data-act": "cp-stop", "data-id": c.id, "data-name": project, disabled: busy }, "Stop"), h("span", { class: "cp-rc" }, "Working…")));
    }
    if (rcOn) kids.push(rcAsk || h("div", { class: "actions" }, h("button", { class: "btn", type: "button", "data-act": "cp-rc-off", "data-id": c.id, "data-name": project, disabled: busy }, "Turn Remote Control off")));
    else if (c.canAnswer) kids.push(rcAsk || h("div", { class: "actions" }, h("button", { class: "btn", type: "button", "data-act": "cp-rc-on", "data-id": c.id, "data-name": project, disabled: busy }, "Turn Remote Control on")));
    if (typeof c.openLink === "string" && c.openLink.startsWith("claude://resume?session=")) {
      kids.push(h("div", { class: "actions" }, h("button", { class: "btn", type: "button", "data-act": "open-app-hub", "data-id": c.id }, "Open in the app"), h("span", { class: "cp-rc" }, "Afterwards the chat lives in the app; answer it there.")));
    }
  } else if (c.kind === "app") {
    kids.push(h("p", { class: "cp-note" }, c.state === "closed" ? "This chat is closed. Open it in the Claude app and answer it there." : "This chat is open in the Claude app. Answer it there so it does not split."));
    if (c.needsYou && c.snippet) kids.push(h("div", { class: "cp-block" }, h("span", { class: "cp-label" }, "Waiting for you"), h("div", { class: "cp-text" }, c.snippet)));
    const ok = openThis(c.openLink);
    const rc = c.remoteControl === true ? "Remote Control: on" : c.remoteControl === false ? "Remote Control: off" : null;
    if (ok || rc) kids.push(h("div", { class: "actions" }, ok, rc ? h("span", { class: "cp-rc" }, rc) : null));
  } else {
    kids.push(h("p", { class: "cp-note" }, "This chat is open in a terminal. Answer it there."));
    if (c.needsYou && c.snippet) kids.push(h("div", { class: "cp-block" }, h("span", { class: "cp-label" }, "Waiting for you"), h("div", { class: "cp-text" }, c.snippet)));
  }
  return h("div", { class: "chat-panel", id: "cp-" + c.id, role: "group", "aria-label": `Chat ${c.name}` }, kids);
}

function askPanel(id, project, kind) {
  const draft = (drafts.get(id) || "").trim();
  if (kind === "cp-send" && !draft) return;
  const text = kind === "cp-rc-on" ? "Turn Remote Control on?"
    : kind === "cp-rc-off" ? "Turn Remote Control off?"
    : kind === "cp-send" ? `Send this answer to the chat in ${project}?`
    : kind === "cp-handoff" ? "Hand off this chat?"
    : kind === "cp-pickup" ? "Run /pickup in this chat?"
    : "Stop this chat?";
  const extra = kind === "cp-rc-on" ? "The chat runs in the background so you can open it on your phone. You cannot answer it here while it is on. Claude works without a window and uses your Claude allowance."
    : kind === "cp-rc-off" ? "The chat stops running in the background; you can answer it here afterwards."
    : kind === "cp-handoff" ? "Claude saves where the work stands and writes the handoff note. Claude works without a window and uses your Claude allowance."
    : kind === "cp-stop" ? "You can answer it later to continue."
    : "Claude works without a window and uses your Claude allowance.";
  asking = { kind, name: chatKey(project), project, id, label: project, text, extra };
  setNote("");
}

async function doPanel(a) {
  const c = findChat(a.id);
  if (!c || c.kind !== "hub" || !/^h-/.test(a.id) || sending.has(a.id)) return;
  const body = a.kind === "cp-rc-on" || a.kind === "cp-rc-off" ? { action: "chat-remote-control", id: a.id, on: a.kind === "cp-rc-on" }
    : a.kind === "cp-stop" ? { action: "chat-stop", id: a.id }
    : { action: "chat-answer", id: a.id, text: a.kind === "cp-handoff" ? "/handoff" : a.kind === "cp-pickup" ? "/pickup" : (drafts.get(a.id) || "").trim() };
  if (a.kind === "cp-send" && !body.text) return;
  sending.add(a.id);
  setNote("Working on it…");
  let r;
  try { r = await send(body); } finally { sending.delete(a.id); }
  if (r.ok) { setNote(r.message || "Done."); if (a.kind === "cp-send") drafts.delete(a.id); }
  else setNote(r.error || "That did not work.", true);
  await loadChats(); if (lastData) render(lastData);
}

function findChat(id) {
  if (!chatsData) return null;
  for (const e of chatsData.projects) { const c = e.chats.find((x) => x.id === id); if (c) return c; }
  return null;
}

// the answer box counts as busy while it holds text or has the cursor: a refresh then leaves the page alone
function answerBusy() {
  const ae = document.activeElement;
  return !!(openChat && ((drafts.get(openChat) || "").length || (ae && ae.id === "ans-text")));
}

function chatForm(project) {
  const ask = asking && asking.name === chatKey(project) && asking.kind.startsWith("chat-") ? h("div", { class: "actions ask", role: "group", "aria-label": asking.text },
    h("div", { class: "ask-text" }, h("b", {}, asking.text), asking.extra ? h("span", {}, asking.extra) : null),
    h("button", { class: "btn primary", type: "button", "data-act": "yes" }, "Yes"),
    h("button", { class: "btn", type: "button", "data-act": "cancel" }, "Cancel")) : null;
  const ta = h("textarea", { id: "chat-text", class: "chat-text", rows: "4", maxlength: String(TASK_MAX) });
  ta.value = form.text;
  const sel = h("select", { id: "chat-model", class: "chat-model" }, MODELS.map(([v, l]) => h("option", { value: v }, l)));
  sel.value = form.model;
  return h("div", { class: "chat-form", role: "group", "aria-label": `New chat in ${project}` },
    h("div", { class: "cf-field" },
      h("label", { for: "chat-text" }, "What should Claude do?"),
      ta,
      h("span", { class: "cf-count", id: "chat-count" }, `${form.text.length} / ${TASK_MAX}`)),
    h("div", { class: "cf-field cf-model" }, h("label", { for: "chat-model" }, "Model"), sel),
    h("label", { class: "cf-check", for: "chat-rc" }, h("input", { type: "checkbox", id: "chat-rc", checked: form.remoteControl === true }), "Reach it from my phone (Remote Control)"),
    h("label", { class: "cf-check", for: "chat-skip" }, h("input", { type: "checkbox", id: "chat-skip", checked: form.skipWorkflow === true }), "Skip the project workflow (for a quick question)"),
    ask || h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "button", "data-act": "chat-ask-here" }, "Start here"),
      h("button", { class: "btn", type: "button", "data-act": "chat-ask-app" }, "Start in the app"),
      h("button", { class: "btn", type: "button", "data-act": "chat-ask-pickup" }, "Pick up"),
      h("button", { class: "btn", type: "button", "data-act": "chat-cancel" }, "Cancel"),
      h("button", { class: "btn quiet term-btn", type: "button", "data-act": "chat-ask-terminal" }, "New terminal chat")));
}

function chatsArea(project) {
  const entry = chatsData ? chatsData.projects.find((x) => x.project === project) : null;
  const list = entry ? entry.chats : [];
  const open = form && form.project === project;
  const expanded = chatsExpanded.has(project);
  const shown = expanded ? list : list.filter((c, i) => i < FIRST_LINES || c.id === openChat);
  const kids = [h("div", { class: "chats-head" }, h("h4", {}, "Chats"), list.length ? h("span", { class: "count" }, String(list.length)) : null)];
  if (list.length) kids.push(h("ul", { class: "chat-list" }, shown.map((c) => chatLine(c, project))));
  else if (chatsData) kids.push(h("p", { class: "chat-none" }, "No chats yet."));
  if (list.length > FIRST_LINES) kids.push(h("button", { class: "chat-more", type: "button", "aria-expanded": String(expanded), "data-act": "chat-more", "data-name": project }, expanded ? "Show fewer" : `Show ${list.length - FIRST_LINES} more`));
  if (chatsData && chatsData.openListOk === false) kids.push(h("p", { class: "chat-none" }, "Can't see the chats that are open in the Claude app right now."));
  if (open) kids.push(chatForm(project));
  else kids.push(h("div", { class: "actions" }, h("button", { class: "btn", type: "button", "data-act": "chat-new", "data-name": project }, "New chat")));
  return h("div", { class: "chats" }, kids);
}

function askChat(kind, project) {
  if (kind === "chat-terminal") {
    asking = { kind, name: chatKey(project), project, id: null, label: project, text: `Open a NEW Claude Code chat in a terminal window in ${project}? It is a new chat: it does not continue a chat that asked you something.`, extra: "" };
    setNote(""); return;
  }
  if (kind !== "chat-pickup" && kind !== "chat-terminal" && !form.text.trim()) { setNote("Write what Claude should do first.", true); return; }
  const text = kind === "chat-here" ? `Start a chat in ${project} with this task?`
    : kind === "chat-app" ? `Open the Claude app in ${project} with this task?`
    : `Start a chat in ${project} that runs /pickup?`;
  const extra = kind === "chat-app" ? "You press Send there."
    : (kind === "chat-here" ? (form.skipWorkflow ? "The chat gets your task as it is, without the project workflow. " : "The chat first runs /pickup so it knows where the project stands, and is named like your other chats. ") : "") + "Claude works without a window and uses your Claude allowance." + (form.remoteControl ? " Remote Control is on: the chat keeps running in the background so you can open it on your phone. You cannot answer it here while it is on." : "");
  asking = { kind, name: chatKey(project), project, id: null, label: project, text, extra };
  setNote("");
}

async function doChat(a) {
  if (!form || form.project !== a.project) return;
  if (a.kind === "chat-terminal") {
    setNote("Working on it…");
    const t = await send({ action: "open-claude", name: a.project });
    setNote(t.ok ? t.message || "Done." : t.error || "That did not work.", !t.ok);
    if (t.ok) form = null;
    if (lastData) render(lastData);
    return;
  }
  const task = a.kind === "chat-pickup" ? "/pickup" : form.text.trim();
  if (!task) { setNote("Write what Claude should do first.", true); return; }
  let body;
  if (a.kind === "chat-app") body = { action: "chat-app-link", project: a.project, task };
  else { body = { action: "chat-start", project: a.project, task }; if (form.model) body.model = form.model; if (form.remoteControl) body.remoteControl = true; if (form.skipWorkflow && a.kind === "chat-here") body.workflow = false; }
  setNote("Working on it…");
  const r = await send(body);
  if (!r.ok) { setNote(r.error || "That did not work.", true); if (lastData) render(lastData); return; }
  if (a.kind === "chat-app") {
    if (typeof r.link !== "string" || !r.link.startsWith("claude://code/new?")) { setNote("The Hub did not get a valid link.", true); if (lastData) render(lastData); return; }
    const link = h("a", { href: r.link });
    document.body.append(link); link.click(); link.remove();
  }
  setNote(r.message || "Done.");
  form = null;
  await loadChats(); if (lastData) render(lastData);
}

document.addEventListener("input", (e) => {
  if (form && e.target.id === "chat-text") { form.text = e.target.value; const c = $("chat-count"); if (c) c.textContent = `${form.text.length} / ${TASK_MAX}`; }
});
document.addEventListener("input", (e) => {
  if (e.target.id !== "ans-text" || !openChat) return;
  drafts.set(openChat, e.target.value);
  const c = $("ans-count"); if (c) c.textContent = `${e.target.value.length} / ${ANSWER_MAX}`;
  const b = $("ans-send"); if (b) b.disabled = !e.target.value.trim() || sending.has(openChat);
});
document.addEventListener("change", (e) => {
  if (form && e.target.id === "chat-rc") form.remoteControl = e.target.checked;
  if (form && e.target.id === "chat-skip") form.skipWorkflow = e.target.checked;
  if (form && e.target.id === "chat-model") { form.model = e.target.value; rememberModel(form.model); }
});

// ---------- cards ----------
// A card is a short, visual summary and one big link to the project page (/project.html?name=...). Start / Stop stay on the card as small
// buttons that do not open the page. The chats list, the New chat form and "Claude last said" sit in the folded "Chats and more" part.
const SVG = "http://www.w3.org/2000/svg";
function ring(pct) {
  const R = 20, C = 2 * Math.PI * R;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 48 48"); svg.setAttribute("class", "ring"); svg.setAttribute("aria-hidden", "true");
  const mk = (cls, extra) => { const c = document.createElementNS(SVG, "circle"); c.setAttribute("cx", "24"); c.setAttribute("cy", "24"); c.setAttribute("r", String(R)); c.setAttribute("fill", "none"); c.setAttribute("class", cls); for (const [k, v] of Object.entries(extra || {})) c.setAttribute(k, v); return c; };
  svg.append(mk("ring-track"), mk("ring-fill", { "stroke-dasharray": `${(C * Math.max(0, Math.min(100, pct))) / 100} ${C}`, transform: "rotate(-90 24 24)" }));
  return svg;
}
const moreOpen = new Set();          // projects whose "Chats and more" fold is open

function card(p, answer) {
  const decs = p.decisionsWaiting || 0;
  const entry = chatsData ? chatsData.projects.find((x) => x.project === p.name) : null;
  const chatsNeed = entry ? entry.chats.filter((c) => c.needsYou).length : needsFor(p.name).length;
  const needs = decs > 0 || chatsNeed > 0;
  const done = p.phase === null && p.percent === 100;
  const pct = p.percent ?? 0;
  const forceOpen = (form && form.project === p.name) || (asking && asking.name === chatKey(p.name));
  const chatCount = entry ? entry.chats.length : 0;
  const more = h("details", { class: "more", open: moreOpen.has(p.name) || forceOpen },
    h("summary", {}, "Chats and more", chatCount ? h("span", { class: "count" }, String(chatCount)) : null),
    h("div", { class: "more-body" },
      chatsArea(p.name),
      answer ? h("details", { class: "said" },
        h("summary", {}, h("span", { class: "when" }, `Claude last said · ${ago(answer.at)}${answer.chat ? " · " + answer.chat : ""}`), h("span", { class: "short" }, answer.short)),
        answer.long && answer.long !== answer.short ? h("p", { class: "long" }, answer.long) : null) : null));
  more.addEventListener("toggle", () => { if (more.open) moreOpen.add(p.name); else moreOpen.delete(p.name); });
  const ctl = controls(p.name);
  return h("article", { class: "card" + (needs ? " needs" : "") },
    h("div", { class: "card-top" },
      h("div", { class: "card-id" },
        h("h3", { class: "name" }, h("a", { class: "card-link", href: "/project.html?name=" + encodeURIComponent(p.name) }, p.name)),
        h("p", { class: "phase" }, done ? "Every phase finished" : p.phase ? `Phase ${p.phase.number} of ${p.phase.of} · ${p.phase.title}` : "No phase in progress")),
      h("div", { class: "ring-wrap", role: "img", "aria-label": `${p.name} is ${pct} percent done` }, ring(pct), h("span", { class: "ring-pct", "aria-hidden": "true" }, `${pct}%`))),
    p.nextStep ? h("p", { class: "next" }, h("span", {}, "Next: "), p.nextStep) : null,
    h("div", { class: "marks" },
      h("span", { class: "mark" + (decs ? " on" : "") }, h("b", {}, String(decs)), decs === 1 ? " decision waiting" : " decisions waiting"),
      h("span", { class: "mark" + (chatsNeed ? " on" : "") }, h("b", {}, String(chatsNeed)), chatsNeed === 1 ? " chat needs you" : " chats need you")),
    ctl ? h("div", { class: "card-ctl" }, ctl) : null,
    h("div", { class: "card-more" }, more));
}

function render(data) {
  lastData = data;
  if (openChat && chatsData && !findChat(openChat)) { openChat = null; if (asking && asking.kind.startsWith("cp-")) asking = null; }
  for (const id of [...drafts.keys()]) if (chatsData && !findChat(id)) drafts.delete(id);
  const ae = document.activeElement;
  const keep = ae && (ae.id === "chat-text" || ae.id === "chat-model" || ae.id === "ans-text") ? ae.id : null;
  const sel = keep === "ans-text" ? [ae.selectionStart, ae.selectionEnd] : null;
  renderGame();
  const { projects, decisions, answers, manager } = data;
  const byName = new Map(answers.map((a) => [a.project, a]));
  const ready = projects.filter((p) => p.setUp);
  const finished = ready.filter((p) => p.percent === 100 && p.decisionsWaiting === 0);
  const active = ready.filter((p) => !finished.includes(p)).sort((a, b) => (b.decisionsWaiting > 0) - (a.decisionsWaiting > 0) || String(b.lastCommit).localeCompare(String(a.lastCommit)) || a.name.localeCompare(b.name));
  const unset = projects.filter((p) => !p.setUp);

  const waiting = decisions.length;
  $("summary").replaceChildren(
    h("b", {}, `${ready.length} projects`), ` with a plan · `,
    h("b", {}, waiting === 0 ? "nothing" : `${waiting} decision${waiting > 1 ? "s" : ""}`), " waiting on you",
    unset.length ? ` · ${unset.length} not set up` : "",
    needs.length ? ` · ${needs.length} chat${needs.length > 1 ? "s" : ""} waiting for you` : "",
    runningNow.length ? ` · ${runningNow.length} running now` : "");

  $("active-count").textContent = active.length;
  $("active").replaceChildren(...active.map((p) => card(p, byName.get(p.name))));
  $("done-section").hidden = finished.length === 0;
  $("done-count").textContent = finished.length;
  $("done").replaceChildren(...finished.map((p) => card(p, byName.get(p.name))));
  $("unset-section").hidden = unset.length === 0;
  $("unset-count").textContent = unset.length;
  $("unset").replaceChildren(...unset.map((p) => h("li", {}, p.name)));

  const KIND = { chat: "Claude chat", manager: "Manager", program: "Started by the Hub", outside: "Started outside the Hub" };
  $("running-count").textContent = runningNow.length || "";
  $("running").replaceChildren(...(runningNow.length ? runningNow.map((r) => h("li", {},
    h("div", { class: "w-top" }, h("span", { class: "dot " + (r.kind === "program" ? "on" : r.kind === "outside" ? "" : "busy"), "aria-hidden": "true" }), h("b", {}, r.project), h("span", {}, KIND[r.kind] || r.kind)),
    r.kind === "chat" && r.label ? h("div", { class: "w-title" }, r.label) : h("div", { class: "w-title" }, r.label),
    (parts => parts ? h("div", { class: "w-q" }, parts) : null)([r.kind === "outside" ? null : r.detail, r.since ? `for ${waited(r.since)}` : null].filter(Boolean).join(" · ")))) : [h("li", {}, h("p", { class: "empty" }, "Nothing is running."))]));
  $("done-note").hidden = !doneInfo.allDone;
  if (doneInfo.allDone) $("done-note").replaceChildren(h("b", {}, "Everything is done"), ` · finished ${new Date(doneInfo.finishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  document.title = doneInfo.allDone ? "Hub · everything is done" : "Hub";

  renderHelpers();

  $("needs-panel").hidden = needs.length === 0;
  $("needs-count").textContent = needs.length || "";
  $("needs").replaceChildren(...needs.map((n) => h("li", {},
    h("div", { class: "w-top" }, h("b", {}, n.project), h("span", {}, `waiting ${waited(n.since)}${n.state === "permission" ? " · maybe permission" : ""}`)),
    n.chat ? h("div", { class: "w-title" }, n.chat) : null,
    h("div", { class: "w-q" }, n.snippet),
    openThis(n.openLink) ? h("div", { class: "w-act" }, openThis(n.openLink)) : null)));

  $("wait-count").textContent = waiting ? waiting : "";
  $("waitlist").replaceChildren(...(waiting ? decisions.map((d) => h("li", {},
    h("div", { class: "w-top" }, h("b", {}, d.project), h("span", {}, `${d.id} · ${d.status}`)),
    h("div", { class: "w-title" }, d.title),
    d.question ? h("div", { class: "w-q" }, d.question) : null)) : [h("li", {}, h("p", { class: "empty" }, "Nothing is waiting on you."))]));

  const mrt = rtFor("AI_Orcestration");
  const running = mrt ? mrt.status === "running" : manager.running;
  $("manager").replaceChildren(h("div", { class: "mgr" },
    h("div", { class: "mgr-line" }, h("span", { class: "dot" + (running ? " on" : mrt && mrt.status === "starting" ? " busy" : ""), "aria-hidden": "true" }), running ? "Running" : mrt && mrt.status === "starting" ? "Starting…" : "Not running"),
    running && manager.goal ? h("p", {}, manager.goal) : null,
    running && manager.busy ? h("p", {}, "Working on a task now.") : null,
    running && manager.queueDepth !== null && manager.queueDepth !== undefined ? h("p", {}, `${manager.queueDepth} task${manager.queueDepth === 1 ? "" : "s"} waiting in the queue`) : null,
    manager.note && !mrt ? h("p", {}, manager.note) : null,
    controls("AI_Orcestration")));
  if (keep && $(keep)) { $(keep).focus(); if (sel) try { $(keep).setSelectionRange(sel[0], sel[1]); } catch { /* ignore */ } }
}

async function load() {
  const get = async (path) => { const r = await fetch(path, { cache: "no-store" }); if (!r.ok) throw new Error(path); return r.json(); };
  const [p, d, a, m] = await Promise.allSettled([get("/api/projects"), get("/api/decisions"), get("/api/answers"), get("/api/manager"), loadRuntime(), loadNeeds(), loadRunning()]);
  if (p.status !== "fulfilled") { $("banner").hidden = false; return; }
  $("banner").hidden = true;
  $("demo-tag").hidden = !p.value.demo;
  render({
    projects: p.value.projects,
    decisions: d.status === "fulfilled" ? d.value.decisions : [],
    answers: a.status === "fulfilled" ? a.value.answers : [],
    manager: m.status === "fulfilled" ? m.value : { running: false, note: "Can't reach the Manager." },
  });
  $("updated").textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (runtime.some((r) => r.status === "starting")) pollWhileStarting();
}

// theme switch (light default, remembered when storage works)
const root = document.documentElement;
function paintToggle() {
  const dark = root.dataset.theme === "dark";
  $("theme").setAttribute("aria-pressed", String(dark));
  $("theme").setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
}
$("theme").addEventListener("click", () => {
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem("hub-theme", root.dataset.theme); } catch { /* storage blocked: still works for this visit */ }
  paintToggle();
});
paintToggle();

$("active").replaceChildren(...[0, 1, 2].map(() => h("div", { class: "skeleton" })));
load();
// refresh rhythm (D32): the running panel every 10 s and the rest every 30 s while the page is in front; once every 2 minutes while the tab is hidden.
// A refresh never closes a question that is open.
let ticks = 0;
setInterval(async () => {
  ticks++;
  if (document.hidden) { if (ticks % 12 === 0 && !asking && !form && !answerBusy()) load(); return; }
  if (asking || form || answerBusy()) return;
  if (ticks % 3 === 0) load();
  else { await loadRunning(); if (lastData && !form && !asking && !answerBusy()) render(lastData); }
}, 10_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && !asking && !form && !answerBusy()) load(); });
