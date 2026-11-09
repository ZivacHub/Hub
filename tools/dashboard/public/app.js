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
let runningNow = [];                   // what is working right now (from /api/running)
let needs = [];                     // chats that are waiting for Ivan (from /api/needs-you)
const needsFor = (name) => needs.filter((n) => n.project === name);
const waited = (iso) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 60 ? `${Math.max(m, 1)} min` : m < 1440 ? `${Math.round(m / 60)} h` : (d => d === 1 ? "1 day" : `${d} days`)(Math.round(m / 1440)); };
const rtFor = (name) => runtime.find((r) => r.name === name);

function setNote(text, bad = false) { note = text; const n = $("note"); n.textContent = text; n.hidden = !text; n.className = "note" + (bad ? " bad" : ""); }

function question(kind, name, rt, text, extra) {
  return { kind, name, id: rt ? rt.id : null, label: rt ? rt.label : name, text, extra: extra || "" };
}

function controls(name, { claude = true } = {}) {
  const rt = rtFor(name);
  if (!rt && !claude) return null;
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
  if (claude) kids.push(h("button", { class: "btn", type: "button", "data-act": "ask-claude", "data-name": name }, "Open in Claude Code"));
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

async function loadRunning() {
  try { runningNow = (await (await fetch("/api/running", { cache: "no-store" })).json()).items || []; } catch { /* keep the last list */ }
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
    await Promise.all([loadRuntime(), loadRunning()]); if (lastData) render(lastData);
    if (!runtime.some((r) => r.status === "starting")) break;
  }
  polling = false;
}

async function perform(a) {
  const body = a.kind === "claude" ? { action: "open-claude", name: a.name }
    : a.kind === "start" ? { action: "start", id: a.id }
    : a.kind === "stop" ? { action: "stop", id: a.id }
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
  if (act === "cancel") { asking = null; setNote(""); }
  else if (act === "yes") { const a = asking; asking = null; if (a) perform(a); return; }
  else if (act === "ask-start") asking = question("start", name, rt, `Start ${rt.label}?`, rt.warn || rt.note);
  else if (act === "ask-stop") asking = question("stop", name, rt, `Stop ${rt.label}?`);
  else if (act === "ask-claude") asking = question("claude", name, rt, `Open Claude Code in ${name}?`, "A new terminal window opens in that project's folder.");
  else if (act === "ask-autostart") asking = rt.startWithPc ? question("autostart-off", name, rt, `Stop ${rt.label} from starting with the PC?`)
    : question("autostart-on", name, rt, `Start ${rt.label} together with the PC?`, rt.warn || "It starts a few seconds after the PC does, once the Hub's start-up entry is installed.");
  if (lastData) render(lastData);
  const focus = document.querySelector(".actions.ask .btn.primary"); if (focus && asking) focus.focus();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && asking) { asking = null; if (lastData) render(lastData); } });

// ---------- cards ----------
function card(p, answer) {
  const needs = p.decisionsWaiting > 0;
  const stale = (p.handoffDaysOld ?? 0) >= 7;
  const done = p.phase === null && p.percent === 100;
  return h("article", { class: "card" + (needs ? " needs" : "") },
    h("div", { class: "card-head" }, h("h3", { class: "name" }, p.name), h("span", { class: "pct" }, `${p.percent ?? 0}%`)),
    h("p", { class: "phase" }, done ? "Every phase finished" : p.phase ? `Phase ${p.phase.number} of ${p.phase.of} · ${p.phase.title}` : "No phase in progress"),
    h("div", { class: "bar", role: "progressbar", "aria-valuenow": p.percent ?? 0, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": `${p.name} progress` }, fill(p.percent ?? 0)),
    h("div", { class: "steps" }, h("span", {}, `${p.stepsDone} of ${p.stepsTotal} steps`), h("span", {}, `${p.phasesDone} of ${p.phasesTotal} phases`)),
    p.nextStep ? h("p", { class: "next" }, h("span", {}, "Next: "), p.nextStep) : null,
    h("div", { class: "meta" },
      needs ? h("span", { class: "pill" }, `${p.decisionsWaiting} waiting on you`) : h("span", { class: "pill quiet" }, "nothing waiting"),
      h("span", { class: stale ? "stale" : "" }, saved(p.handoffDaysOld))),
    needsFor(p.name).slice(0, 1).map((n) => h("div", { class: "asking" },
      h("div", { class: "asking-top" }, h("span", { class: "pill" }, n.state === "permission" ? "Maybe waiting for permission" : "Claude is asking you"), h("span", {}, `waiting ${waited(n.since)}`)),
      h("p", { class: "asking-q" }, n.snippet))),
    controls(p.name),
    answer ? h("details", { class: "said" },
      h("summary", {}, h("span", { class: "when" }, `Claude last said · ${ago(answer.at)}${answer.chat ? " · " + answer.chat : ""}`), h("span", { class: "short" }, answer.short)),
      answer.long && answer.long !== answer.short ? h("p", { class: "long" }, answer.long) : null) : null);
}

function render(data) {
  lastData = data;
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

  $("needs-panel").hidden = needs.length === 0;
  $("needs-count").textContent = needs.length || "";
  $("needs").replaceChildren(...needs.map((n) => h("li", {},
    h("div", { class: "w-top" }, h("b", {}, n.project), h("span", {}, `waiting ${waited(n.since)}${n.state === "permission" ? " · maybe permission" : ""}`)),
    n.chat ? h("div", { class: "w-title" }, n.chat) : null,
    h("div", { class: "w-q" }, n.snippet))));

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
    controls("AI_Orcestration", { claude: false })));
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
  if (document.hidden) { if (ticks % 12 === 0 && !asking) load(); return; }
  if (asking) return;
  if (ticks % 3 === 0) load();
  else { await loadRunning(); if (lastData) render(lastData); }
}, 10_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && !asking) load(); });
