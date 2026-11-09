// "Running now" (plan step 12.1): one list of what is working, built from three sources. Pure function, so it can be tested with made-up input.
//   program  = a program the Hub started (and it is up or starting)
//   outside  = a program from the Hub's list that is up but was started somewhere else (read-only, never touched: D31)
//   chat     = a Claude chat whose last message is mid-turn and under 30 minutes old
//   manager  = the Manager is running a task right now
// Only names, kinds and times are returned: never command lines and never chat text (D32).
//   node tools/dashboard/lib/running.mjs --selftest

export function buildRunning({ runtime = [], chats = [], manager = null }) {
  const items = [];
  for (const r of runtime) {
    if (r.status === "stopped") continue;
    if (r.startedByHub) items.push({ kind: "program", project: r.name, label: r.label, since: r.startedAt || null, detail: r.status === "starting" ? "starting" : `port ${r.port}` });
    else if (r.status === "running") items.push({ kind: "outside", project: r.name, label: r.label, since: null, detail: "started outside the Hub" });
  }
  for (const c of chats) items.push({ kind: "chat", project: c.project, label: c.chat || "Claude chat", since: c.since || null, detail: "Claude is working" });
  if (manager && manager.running && manager.busy) items.push({ kind: "manager", project: "AI_Orcestration", label: "AI_Orcestration Manager", since: null, detail: "running a task" });
  const order = { chat: 0, manager: 1, program: 2, outside: 3 };
  return items.sort((a, b) => order[a.kind] - order[b.kind] || String(a.since || "9").localeCompare(String(b.since || "9")));
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
  ok("no command lines or chat text in a row", Object.keys(buildRunning({ runtime: [rt({})] })[0]).sort().join() === "detail,kind,label,project,since");
  process.exit(bad ? 1 : 0);
}
