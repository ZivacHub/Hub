// Hub Settings screen. Reads GET /api/settings; a change sends one guarded POST /api/action ("settings-set").
// A default or override change is reversible and instant, so there is no question: it saves, shows a small toast, and rolls back on an error.
// All text goes in with textContent (via h()), never as HTML, because project names come from folders.
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

let data = null;
let session = null;
let chain = Promise.resolve();

const choiceOf = (def, v) => def.choices.find((c) => c.value === v);
const labelOf = (def, v) => (choiceOf(def, v) || { label: String(v) }).label;

function control(def, name, selected, attrs, { defaultLabel, disabled } = {}) {
  const opts = [];
  if (defaultLabel) opts.push({ value: "", face: [h("span", {}, "Use the default", h("span", { class: "seg-sub" }, defaultLabel))] });
  for (const c of def.choices) opts.push({ value: c.value, face: [c.label] });
  return h("fieldset", { class: "seg" },
    h("legend", { class: "sr" }, def.label),
    opts.map((o, i) => h("label", { class: "seg-opt" },
      h("input", { type: "radio", name, value: o.value, checked: selected === o.value, disabled: disabled || false, "data-key": `${name}#${i}`, ...attrs }),
      h("span", { class: "seg-face" }, o.face))));
}

function defaultsSection() {
  const sec = h("section", { "aria-labelledby": "t-defaults" },
    h("h2", { class: "sec-title", id: "t-defaults" }, "Defaults for every project"),
    h("p", { class: "sec-help" }, "A project follows these unless you change it for that project below."));
  for (const def of data.definitions) {
    const cur = data.defaults[def.id];
    const c = choiceOf(def, cur);
    sec.append(h("div", { class: "set panel" },
      h("h3", { class: "set-name" }, def.label),
      h("p", { class: "set-help" }, def.help),
      control(def, `default|${def.id}`, cur, { "data-scope": "default", "data-id": def.id }),
      h("p", { class: "set-now" }, h("b", {}, "Chosen: "), c ? `${c.label}. ${c.help}` : String(cur))));
  }
  return sec;
}

function projectCard(p, pi) {
  const changed = data.definitions.filter((d) => p.values[d.id] && p.values[d.id].source === "project").length;
  const head = h("div", { class: "pcard-head" },
    h("h3", { id: `p-${pi}` }, p.name),
    changed ? h("span", { class: "mark" }, `Changed here`) : null,
    h("span", { class: "pcard-state" }, changed ? `${changed} of ${data.definitions.length} changed for this project` : "Follows the defaults"));
  const rows = data.definitions.map((def) => {
    const v = p.values[def.id] || { value: data.defaults[def.id], source: "default" };
    const own = v.source === "project";
    const dl = `(${labelOf(def, data.defaults[def.id])})`;
    return h("div", { class: "prow" },
      h("div", { class: "prow-name" }, def.label),
      h("div", { class: "prow-ctl" },
        control(def, `project|${p.name}|${def.id}`, own ? v.value : "", { "data-scope": "project", "data-project": p.name, "data-id": def.id }, { defaultLabel: dl, disabled: !!p.problem }),
        own ? h("span", { class: "mark" }, "Changed here") : h("span", { class: "prow-note" }, `Following the default: ${labelOf(def, v.value)}`)));
  });
  return h("section", { class: "pcard panel", "aria-labelledby": `p-${pi}` }, head, p.problem ? h("p", { class: "problem", role: "alert" }, p.problem) : null, rows);
}

function projectsSection() {
  const sec = h("section", { "aria-labelledby": "t-projects" },
    h("h2", { class: "sec-title", id: "t-projects" }, "Per project"),
    h("p", { class: "sec-help" }, "Pick “Use the default” to follow the setting above, or choose something else for one project only. The choice is saved in that project's own folder."));
  if (!data.projects.length) {
    sec.append(h("div", { class: "none" }, h("p", { class: "none-title" }, "No projects found."), h("p", {}, "When a project folder exists in BUSNUS, it shows up here.")));
  } else {
    sec.append(h("div", { class: "plist" }, data.projects.map(projectCard)));
  }
  return sec;
}

function summaryText() {
  const n = data.projects.filter((p) => data.definitions.some((d) => p.values[d.id] && p.values[d.id].source === "project")).length;
  return n ? `${n} of ${data.projects.length} project${data.projects.length === 1 ? "" : "s"} changed from the defaults` : "Every project follows the defaults";
}

function render() {
  const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
  const y = window.scrollY;
  $("demo-tag").hidden = !data.demo;
  $("summary").textContent = summaryText();
  const kids = [];
  if (data.problem) kids.push(h("p", { class: "problem", role: "alert" }, data.problem));
  kids.push(defaultsSection(), projectsSection());
  $("content").replaceChildren(...kids);
  if (focusKey) { const el = document.querySelector(`[data-key="${CSS.escape(focusKey)}"]`); if (el) el.focus({ preventScroll: true }); }
  if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
}

let toastTimer = 0;
function toast(text, bad = false) {
  const t = $("toast");
  t.textContent = text;
  t.className = "toast" + (bad ? " bad" : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 1800);
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
  if (r.status === 403 && retry) { session = null; return send(body, false); }
  return r.json().catch(() => ({ ok: false, error: "The Hub answered something unexpected." }));
}

function snapshot() { return JSON.parse(JSON.stringify({ defaults: data.defaults, projects: data.projects })); }

function applyLocal(scope, project, id, value) {
  if (scope === "default") { data.defaults[id] = value; return; }
  const p = data.projects.find((x) => x.name === project);
  if (!p) return;
  p.values[id] = value === null ? { value: data.defaults[id], source: "default" } : { value, source: "project" };
}
// a default change also changes what the "following" projects show
function refollow() {
  for (const p of data.projects) for (const d of data.definitions) if (p.values[d.id] && p.values[d.id].source === "default") p.values[d.id].value = data.defaults[d.id];
}

$("content").addEventListener("change", (e) => {
  const el = e.target;
  if (!el.matches || !el.matches("input[type=radio][data-scope]")) return;
  const scope = el.dataset.scope, project = el.dataset.project, id = el.dataset.id;
  const value = scope === "project" && el.value === "" ? null : el.value;
  const before = snapshot();
  applyLocal(scope, project, id, value);
  refollow();
  render();
  const body = scope === "default" ? { action: "settings-set", scope, id, value } : { action: "settings-set", scope, project, id, value };
  chain = chain.then(async () => {
    let res;
    try { res = await send(body); } catch { res = { ok: false, error: "Can't reach the Hub server, so nothing was saved." }; }
    if (res && res.ok && res.settings) {
      data = { ...res.settings, demo: data.demo };
      render();
      toast("Saved");
    } else {
      data.defaults = before.defaults; data.projects = before.projects;
      render();
      toast((res && res.error) || "That could not be saved.", true);
    }
  });
});

async function load() {
  try {
    const r = await fetch("/api/settings", { cache: "no-store" });
    if (!r.ok) throw new Error("settings");
    const j = await r.json();
    if (!j || !Array.isArray(j.definitions) || !Array.isArray(j.projects) || typeof j.defaults !== "object") throw new Error("settings");
    data = j;
    $("banner").hidden = true;
    render();
  } catch {
    if (!data) {
      $("summary").textContent = "Can't read the settings";
      $("content").replaceChildren(h("div", { class: "errbox", role: "alert" }, h("p", {}, "Can't read the settings from the Hub server."), h("button", { class: "btn", id: "retry", type: "button" }, "Try again")));
    } else $("banner").hidden = false;
  }
}
$("content").addEventListener("click", (e) => { if (e.target.closest("#retry")) { $("summary").textContent = "Loading settings…"; load(); } });

// theme switch (same as the other pages)
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
// pick up changes made elsewhere (the workflow, another tab) when the tab comes back
document.addEventListener("visibilitychange", () => { if (!document.hidden && data) load(); });
