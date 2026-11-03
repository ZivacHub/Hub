// Hub status reader (plan step 2.1 + 2.5): what every BUSNUS project looks like, from its own files. READ-ONLY.
// Reuses Ivan's existing library (~/.claude/hooks/lib/busnus.mjs, the same one `busnus-status` uses), so numbers always match.
// Spoken sentences are built by code from the files; no model writes numbers.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const lib = await import(pathToFileURL(join(homedir(), ".claude", "hooks", "lib", "busnus.mjs")).href);

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
function aliases() {
  try { return JSON.parse(readFileSync(join(HERE, "aliases.json"), "utf8")); } catch { return {}; }
}
const words = (n) => ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
/** First clause of a title, at most about 100 characters, never cut inside a bracket or a word. */
const short = (title) => {
  let s = String(title).split(/\s+[—–-]\s+/)[0].replace(/\s+/g, " ").trim();
  if (s.length > 100) {
    s = s.slice(0, 100);
    if (s.lastIndexOf("(") > s.lastIndexOf(")")) s = s.slice(0, s.lastIndexOf("("));
    s = s.replace(/\s+\S*$/, "");
  }
  return s.replace(/[\s,;:(]+$/, "");
};
/** "Phase 6 — Realistic pipeline — more" -> "Realistic pipeline". */
const noPhasePrefix = (t) => short(String(t).replace(/^Phase\s+[A-Za-z0-9.]+\s*[—–-]\s*/i, ""));

/** All projects with a compact, speakable summary. */
export function allProjects() {
  return lib.collectProjects().map((r) => summarize(r));
}

export function summarize(r) {
  const out = { name: r.name, setUp: !!r.hasClaudeMd && !r.isTemplate && !!r.plan, planning: !!r.isTemplate, hasCode: !!r.hasCode };
  const waiting = [...r.decisions.open, ...r.decisions.proposed];
  out.decisionsWaiting = waiting.map((d) => ({ id: d.id, title: short(d.title), status: d.status }));
  out.handoffDaysOld = r.handoff.exists ? Math.round(r.handoff.ageDays) : null;
  if (r.plan) {
    const p = r.plan;
    // use the phase's own number from its name ("Phase 1 — ..."); fall back to its position in the list
    const own = p.now ? /^Phase\s+([A-Za-z0-9.]+)/i.exec(p.now.title) : null;
    const idx = p.now ? (own ? own[1] : p.phases.indexOf(p.now) + 1) : null;
    Object.assign(out, {
      phasesDone: p.phasesDone, phasesTotal: p.phasesTotal, stepsDone: p.stepsDone, stepsTotal: p.stepsTotal,
      percent: p.stepsTotal ? Math.round((p.stepsDone / p.stepsTotal) * 100) : null,
      currentPhaseNumber: idx, currentPhase: p.now ? noPhasePrefix(p.now.title) : null,
      nextStep: p.next && !p.next.phaseOnly ? short(p.next.title) : null,
    });
  }
  out.spoken = sentence(out);
  return out;
}

/** The sentence Jarvis may read aloud: built here, from the files. */
export function sentence(o) {
  if (o.planning) return `${o.name} is still being planned and has no plan board yet.`;
  if (!o.setUp) return o.hasCode ? `${o.name} is not set up with a plan yet.` : `${o.name} is an empty folder with no plan yet.`;
  const parts = [];
  if (o.currentPhase) parts.push(`${o.name} is on phase ${o.currentPhaseNumber} of ${o.phasesTotal}, ${o.currentPhase}`);
  else parts.push(`${o.name} has finished every phase of its plan`);
  parts.push(`${o.stepsDone} of ${o.stepsTotal} steps are done, about ${o.percent} percent`);
  if (o.nextStep) parts.push(`the next step is ${o.nextStep}`);
  const w = o.decisionsWaiting.length;
  if (w === 0) parts.push("no decisions are waiting");
  else parts.push(`${words(w)} decision${w > 1 ? "s are" : " is"} waiting: ${o.decisionsWaiting.slice(0, 3).map((d) => `${d.id}, ${d.title}`).join("; ")}${w > 3 ? ", and more" : ""}`);
  if (o.handoffDaysOld !== null) parts.push(`the last handoff note is ${o.handoffDaysOld === 0 ? "from today" : o.handoffDaysOld + " day" + (o.handoffDaysOld > 1 ? "s" : "") + " old"}`);
  return parts.join(". ").replace(/\.\s+([a-z])/g, (m, c) => ". " + c.toUpperCase()) + ".";
}

/** Find a project from what was said: exact folder, nickname, then a unique partial match. */
export function findProject(query, rows = allProjects()) {
  const q = norm(query);
  if (!q) return { error: "No project was named." };
  const al = Object.entries(aliases()).find(([k]) => norm(k) === q);
  const target = al ? norm(al[1]) : q;
  let hit = rows.filter((r) => norm(r.name) === target);
  // partial match: the project name inside what was said ("the hub project") or what was said inside the name ("casino");
  // very short folder names (like "SA") only match exactly, otherwise "usage" would hit them
  if (!hit.length) hit = rows.filter((r) => norm(r.name).includes(target) || (norm(r.name).length >= 4 && target.includes(norm(r.name))));
  if (hit.length === 1) return { project: hit[0] };
  if (hit.length > 1) return { error: `That could be ${hit.map((h) => h.name).join(", or ")}. Which one?` };
  return { error: `I don't know a project called ${query}.` };
}

export function listSpoken(rows = allProjects()) {
  const ready = rows.filter((r) => r.setUp);
  const rest = rows.filter((r) => !r.setUp);
  let s = `There are ${words(rows.length)} projects. ${ready.length ? `With a plan: ${ready.map((r) => `${r.name} at ${r.percent} percent`).join(", ")}.` : ""}`;
  if (rest.length) s += ` Not set up yet: ${rest.map((r) => r.name).join(", ")}.`;
  return s.replace(/\s+/g, " ").trim();
}

export function decisionsSpoken(query, rows = allProjects()) {
  if (!query || norm(query) === "all" || norm(query) === "everything") {
    const withW = rows.filter((r) => r.decisionsWaiting.length);
    if (!withW.length) return "No decisions are waiting in any project.";
    return withW.map((r) => `${r.name}: ${words(r.decisionsWaiting.length)} waiting, ${r.decisionsWaiting.slice(0, 2).map((d) => d.title).join("; ")}`).join(". ") + ".";
  }
  const f = findProject(query, rows);
  if (f.error) return f.error;
  const w = f.project.decisionsWaiting;
  return w.length ? `${f.project.name} has ${words(w.length)} decision${w.length > 1 ? "s" : ""} waiting: ${w.slice(0, 4).map((d) => `${d.id}, ${d.title}`).join("; ")}.` : `No decisions are waiting in ${f.project.name}.`;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "list") console.log(listSpoken());
  else if (cmd === "project") { const f = findProject(arg); console.log(f.error || f.project.spoken); }
  else if (cmd === "decisions") console.log(decisionsSpoken(arg));
  else if (cmd === "json") console.log(JSON.stringify(allProjects(), null, 1));
  else console.log("usage: node status.mjs list | project <name> | decisions <name|all> | json");
}
