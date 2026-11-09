// "Everything is done" (plan step 12.3, D28 and D32): once something has been working and then nothing has worked for 2 minutes,
// the dashboard says so, with the time the last work was seen. New work clears it. The Hub only tells: it never shuts the PC down.
//   node tools/dashboard/lib/done.mjs --selftest

export function makeDoneTracker({ now = Date.now, quietMs = 120_000 } = {}) {
  let lastWork = null;   // ms: the last time work was seen
  let sawWork = false;   // something has worked since the Hub started watching
  return {
    /** Call with how many things are working right now. */
    update(workingCount) {
      const t = now();
      if (workingCount > 0) { lastWork = t; sawWork = true; return { allDone: false, finishedAt: null }; }
      if (sawWork && lastWork !== null && t - lastWork >= quietMs) return { allDone: true, finishedAt: new Date(lastWork).toISOString() };
      return { allDone: false, finishedAt: null };
    },
  };
}

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv.includes("--selftest")) {
  let bad = 0;
  const ok = (name, cond) => { console.log(`${cond ? "OK  " : "FAIL"} ${name}`); if (!cond) bad++; };
  let t = Date.parse("2026-11-09T12:00:00Z");
  const d = makeDoneTracker({ now: () => t, quietMs: 120_000 });
  const min = (n) => { t += n * 60_000; };
  ok("nothing ever ran: no notice (idle all day is not 'done')", d.update(0).allDone === false);
  min(30); ok("still nothing 30 minutes later: no notice", d.update(0).allDone === false);
  ok("work starts: not done", d.update(2).allDone === false);
  min(1); ok("work goes on: not done", d.update(1).allDone === false);
  min(1); ok("just stopped (a minute of quiet): not yet", d.update(0).allDone === false);
  min(2); const r = d.update(0);
  ok("quiet for 2 minutes after work: done", r.allDone === true);
  ok("it says when the last work was seen", r.finishedAt === "2026-11-09T12:31:00.000Z");
  min(60); ok("an hour later: still shows done with the same time", d.update(0).finishedAt === "2026-11-09T12:31:00.000Z");
  ok("new work clears it", d.update(1).allDone === false);
  min(3); ok("and it can finish again", d.update(0).allDone === true);
  process.exit(bad ? 1 : 0);
}
