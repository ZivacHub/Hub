// Hub dashboard page. Only shows things: every request is a GET, nothing here can change a file.
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
    answer ? h("details", { class: "said" },
      h("summary", {}, h("span", { class: "when" }, `Claude last said · ${ago(answer.at)}${answer.chat ? " · " + answer.chat : ""}`), h("span", { class: "short" }, answer.short)),
      answer.long && answer.long !== answer.short ? h("p", { class: "long" }, answer.long) : null) : null);
}

function render({ projects, decisions, answers, manager }) {
  const byName = new Map(answers.map((a) => [a.project, a]));
  const ready = projects.filter((p) => p.setUp);
  const finished = ready.filter((p) => p.percent === 100 && p.decisionsWaiting === 0);
  const active = ready.filter((p) => !finished.includes(p)).sort((a, b) => (b.decisionsWaiting > 0) - (a.decisionsWaiting > 0) || String(b.lastCommit).localeCompare(String(a.lastCommit)) || a.name.localeCompare(b.name));
  const unset = projects.filter((p) => !p.setUp);

  const waiting = decisions.length;
  $("summary").replaceChildren(
    h("b", {}, `${ready.length} projects`), ` with a plan · `,
    h("b", {}, waiting === 0 ? "nothing" : `${waiting} decision${waiting > 1 ? "s" : ""}`), waiting === 0 ? " waiting on you" : " waiting on you",
    unset.length ? ` · ${unset.length} not set up` : "");

  $("active-count").textContent = active.length;
  $("active").replaceChildren(...active.map((p) => card(p, byName.get(p.name))));
  $("done-section").hidden = finished.length === 0;
  $("done-count").textContent = finished.length;
  $("done").replaceChildren(...finished.map((p) => card(p, byName.get(p.name))));
  $("unset-section").hidden = unset.length === 0;
  $("unset-count").textContent = unset.length;
  $("unset").replaceChildren(...unset.map((p) => h("li", {}, p.name)));

  $("wait-count").textContent = waiting ? waiting : "";
  $("waitlist").replaceChildren(...(waiting ? decisions.map((d) => h("li", {},
    h("div", { class: "w-top" }, h("b", {}, d.project), h("span", {}, `${d.id} · ${d.status}`)),
    h("div", { class: "w-title" }, d.title),
    d.question ? h("div", { class: "w-q" }, d.question) : null)) : [h("li", {}, h("p", { class: "empty" }, "Nothing is waiting on you."))]));

  $("manager").replaceChildren(h("div", { class: "mgr" },
    h("div", { class: "mgr-line" }, h("span", { class: "dot" + (manager.running ? " on" : ""), "aria-hidden": "true" }), manager.running ? "Running" : "Not running"),
    manager.goal ? h("p", {}, manager.goal) : null,
    manager.running && manager.queueDepth !== null && manager.queueDepth !== undefined ? h("p", {}, `${manager.queueDepth} task${manager.queueDepth === 1 ? "" : "s"} in the queue`) : null,
    manager.note ? h("p", {}, manager.note) : null));
}

async function load() {
  const get = async (path) => { const r = await fetch(path, { cache: "no-store" }); if (!r.ok) throw new Error(path); return r.json(); };
  const [p, d, a, m] = await Promise.allSettled([get("/api/projects"), get("/api/decisions"), get("/api/answers"), get("/api/manager")]);
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
setInterval(load, REFRESH_MS);
