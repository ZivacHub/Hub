// Hub Helpers screen. Reading only: one GET (/api/helpers), no buttons that change anything.
// All text goes in with textContent (via h()), never as HTML, because it comes from project files.
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

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
const STATES = [
  ["parked", "waiting for you"],
  ["review", "waiting for the manager's check"],
  ["failed", "failed the check"],
  ["stuck", "stuck"],
  ["running", "running"],
  ["done", "done"],
];
const TAG = {
  running: "Running",
  stuck: "Stuck (running over 2 hours)",
  review: "Waiting for the manager's check",
  parked: "Waiting for you",
  failed: "Failed the check",
  done: "Done",
};
const WEEK = 7 * 24 * 3600 * 1000;

let data = null;
let showOlder = false;

const isOld = (t) => t.state === "done" && t.finishedAt && Date.now() - new Date(t.finishedAt).getTime() > WEEK;
const countsText = (c) => STATES.filter(([k]) => Number(c && c[k]) > 0).map(([k, w]) => `${c[k]} ${w}`);

function took(t) {
  const bits = [];
  if (typeof t.seconds === "number") bits.push(t.seconds < 60 ? `took ${Math.round(t.seconds)} s` : `took ${Math.round(t.seconds / 60)} min`);
  if (typeof t.tokens === "number") bits.push(t.tokens < 1000 ? `${t.tokens} tokens` : `${(t.tokens / 1000).toFixed(1)}k tokens`);
  return bits;
}

function timeLine(t) {
  const s = t.state;
  if (s === "running" || s === "stuck") return [`started ${ago(t.since)}`];
  if (s === "review") return [`reported ${ago(t.finishedAt)}`];
  if (s === "parked") return [`waiting since ${ago(t.since)}`];
  return [`finished ${ago(t.finishedAt)}`, ...took(t)];
}

function taskRow(t, all) {
  const step = t.step ? String(t.step) : "";
  const title = t.title || "";
  const showStep = step && !title.startsWith(step);
  const who = t.state === "parked" || !t.model ? "You" : [cap(t.model), t.effort].filter(Boolean).join(" · ");
  let retry = null;
  if (t.retryOf) {
    const o = all.get(t.retryOf);
    retry = o ? `Retry of step ${o.step || "?"} (failed on ${cap(o.model) || "an earlier helper"})` : "Retry of an earlier try";
  }
  return h("li", { class: `task st-${t.state}` },
    h("div", { class: "t-head" },
      h("span", { class: "t-title" }, showStep ? h("span", { class: "t-step" }, step) : null, title || "Untitled task"),
      h("span", { class: `state st-${t.state}` }, TAG[t.state] || t.state)),
    h("div", { class: "t-meta" },
      h("span", { class: "who" }, who === "You" ? "For you" : [h("span", { class: "k" }, "Given to "), who]),
      h("span", { class: "when" }, timeLine(t).join(" · "))),
    t.note ? h("p", { class: "t-note" }, t.note) : null,
    retry ? h("p", { class: "t-retry" }, retry) : null);
}

function render() {
  const d = data;
  const t = d.totals || {};
  const parts = STATES.filter(([k]) => Number(t[k]) > 0).map(([k, w]) => `${t[k]} ${k === "stuck" ? "stuck" : w}`);
  $("summary").textContent = parts.length ? parts.join(" · ") : "No helper tasks yet";
  $("demo-tag").hidden = !d.demo;

  const all = new Map();
  let hiddenCount = 0;
  for (const p of d.projects || []) for (const m of p.managers || []) for (const k of m.tasks || []) { all.set(k.id, k); if (isOld(k)) hiddenCount++; }

  const root = $("projects");
  if (!(d.projects || []).length) {
    root.replaceChildren(h("div", { class: "none" }, h("p", { class: "none-title" }, "No helper tasks yet."), h("p", {}, "When a project's main chat hands a task to a helper, it shows up here.")));
    return;
  }

  const blocks = [];
  d.projects.forEach((p, pi) => {
    const mgrs = [];
    for (const m of p.managers || []) {
      const tasks = (m.tasks || []).filter((k) => showOlder || !isOld(k));
      if (!tasks.length) continue;
      const head = m.id === null ? "No manager chat recorded" : (m.chat || "Manager chat");
      const meta = m.id === null ? [] : [m.model, m.lastActive ? `active ${ago(m.lastActive)}` : null].filter(Boolean);
      mgrs.push(h("section", { class: "mgr-block", "aria-labelledby": `m-${pi}-${mgrs.length}` },
        h("h3", { class: "mgr-head", id: `m-${pi}-${mgrs.length}` }, m.id === null ? null : h("span", { class: "mgr-label" }, "Manager"), h("span", { class: "mgr-name" }, head), meta.length ? h("span", { class: "mgr-meta" }, meta.join(" · ")) : null),
        h("ul", { class: "tasks" }, tasks.map((k) => taskRow(k, all)))));
    }
    if (!mgrs.length) return;
    const c = countsText(p.counts);
    blocks.push(h("section", { class: "proj panel", "aria-labelledby": `p-${pi}` },
      h("div", { class: "proj-head" }, h("h2", { id: `p-${pi}` }, p.project), c.length ? h("p", { class: "proj-counts" }, c.join(" · ")) : null),
      mgrs));
  });

  const kids = [...blocks];
  if (hiddenCount > 0 || showOlder) {
    kids.push(h("button", { class: "btn older", id: "older", type: "button", "aria-expanded": String(showOlder) },
      showOlder ? "Hide older finished tasks" : `Show ${hiddenCount} older finished task${hiddenCount === 1 ? "" : "s"}`));
  }
  const hadFocus = document.activeElement && document.activeElement.id === "older";
  root.replaceChildren(...kids);
  if (hadFocus && $("older")) $("older").focus();
}

function draw() {
  const y = window.scrollY;
  render();
  if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
}

$("projects").addEventListener("click", (e) => {
  if (!e.target.closest("#older")) return;
  showOlder = !showOlder;
  draw();
});

async function load() {
  try {
    const r = await fetch("/api/helpers", { cache: "no-store" });
    if (!r.ok) throw new Error("helpers");
    const j = await r.json();
    if (!j || typeof j !== "object") throw new Error("helpers");
    data = j;
    $("banner").hidden = true;
    draw();
    $("updated").textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    $("banner").hidden = false;
    if (!data) $("summary").textContent = "Can't read the helper tasks";
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
  try { localStorage.setItem("hub-theme", root.dataset.theme); } catch { /* storage blocked: still works for this visit */ }
  paintToggle();
});
paintToggle();

load();
// refresh: every 10 s while in front, every 2 minutes while the tab is hidden, at once when it comes back
let ticks = 0;
setInterval(() => {
  ticks++;
  if (document.hidden) { if (ticks % 12 === 0) load(); return; }
  load();
}, 10_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
