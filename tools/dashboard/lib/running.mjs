// "Running now" (plan step 12.1): one list of what is working, built from three sources. Pure function, so it can be tested with made-up input.
//   program  = a program the Hub started (and it is up or starting)
//   outside  = a program from the Hub's list that is up but was started somewhere else (read-only, never touched: D31)
//   chat     = a Claude chat whose last message is mid-turn and under 30 minutes old
//   manager  = the Manager is running a task right now
// Only names, kinds and times are returned: never command lines and never chat text (D32).
//   node tools/dashboard/lib/running.mjs --selftest

export function buildRunning({ runtime = [], chats = [], manager = null, busy = {} }) {
  const items = [];
  for (const r of runtime) {
    if (r.status === "stopped") continue;
    if (r.startedByHub) items.push({ kind: "program", project: r.name, label: r.label, since: r.startedAt || null, detail: r.status === "starting" ? "starting" : `port ${r.port}`, busy: busy[r.id] ?? null });
    else if (r.status === "running") items.push({ kind: "outside", project: r.name, label: r.label, since: null, detail: "started outside the Hub", busy: null });
  }
  for (const c of chats) items.push({ kind: "chat", project: c.project, label: c.chat || "Claude chat", since: c.since || null, detail: "Claude is working", busy: null });
  if (manager && manager.running && manager.busy) items.push({ kind: "manager", project: "AI_Orcestration", label: "AI_Orcestration Manager", since: null, detail: "running a task", busy: null });
  const order = { chat: 0, manager: 1, program: 2, outside: 3 };
  return items.sort((a, b) => order[a.kind] - order[b.kind] || String(a.since || "9").localeCompare(String(b.since || "9")));
}

/** What counts as work for "everything is done": a working chat, a busy Manager, a Hub-started program that is busy or whose busyness is not known yet.
 *  A program that is simply up and idle (a web page waiting for visitors) is not work; one the Hub did not start is never counted (D31). */
export function workCount(items) {
  return items.filter((i) => i.kind === "chat" || i.kind === "manager" || (i.kind === "program" && i.busy !== false)).length;
}

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv.includes("--selftest")) {
  let bad = 0;
  const ok = (name, cond) => { console.log(`${cond ? "OK  " : "FAIL"} ${name}`); if (!cond) bad++; };
  const rt = (o) => ({ name: "P", label: "Prog", port: 1, status: "running", startedByHub: true, startedAt: "2026-11-09T10:00:00Z", ...o });
  ok("nothing running: empty list", buildRunning({}).length === 0);
  ok("stopped program is not listed", buildRunning({ runtime: [rt({ status: "stopped", startedByHub: false })] }).length === 0);
  ok("Hub-started program: kind program with its start time", (() => { const r = buildRunning({ runtime: [rt({})] }); return r.length === 1 && r[0].kind === "program" && r[0].since === "2026-11-09T10:00:00Z"; })());
  ok("starting program shows 'starting'", buildRunning({ runtime: [rt({ status: "starting" })] })[0].detail === "starting");
  ok("program started elsewhere: kind outside", buildRunning({ runtime: [rt({ startedByHub: false })] })[0].kind === "outside");
  ok("a chat becomes a chat row", (() => { const r = buildRunning({ chats: [{ project: "Hub", chat: "Hub · 12.1", since: "2026-11-09T11:00:00Z" }] }); return r[0].kind === "chat" && r[0].project === "Hub"; })());
  ok("Manager only when it is busy", buildRunning({ manager: { running: true, busy: false } }).length === 0 && buildRunning({ manager: { running: true, busy: true } })[0].kind === "manager");
  ok("chats come first, then manager, program, outside", buildRunning({ runtime: [rt({}), rt({ startedByHub: false, label: "X" })], chats: [{ project: "Hub" }], manager: { running: true, busy: true } }).map((x) => x.kind).join() === "chat,manager,program,outside");
  ok("no command lines or chat text in a row", Object.keys(buildRunning({ runtime: [rt({})] })[0]).sort().join() === "busy,detail,kind,label,project,since");
  ok("an idle Hub-started program is not work", workCount(buildRunning({ runtime: [rt({ id: "a" })], busy: { a: false } })) === 0);
  ok("a busy Hub-started program is work", workCount(buildRunning({ runtime: [rt({ id: "a" })], busy: { a: true } })) === 1);
  ok("a program whose busyness is not known yet counts as work (never say done too early)", workCount(buildRunning({ runtime: [rt({ id: "a" })] })) === 1);
  ok("a program started outside the Hub is never work", workCount(buildRunning({ runtime: [rt({ startedByHub: false })] })) === 0);
  ok("a working chat and a busy Manager are work", workCount(buildRunning({ chats: [{ project: "Hub" }], manager: { running: true, busy: true } })) === 2);
  process.exit(bad ? 1 : 0);
}
