// Is a program the Hub started actually busy, or just sitting there? (plan step 12.3)
// Reads the processor time used by each started program and everything it started (its whole process tree), twice, and compares.
// One short PowerShell call every 20 seconds, and only while the Hub has a program running: so it costs nothing when idle.
//   node tools/dashboard/lib/cpu.mjs --selftest     starts one busy and one idle program and tells them apart
import { execFile } from "node:child_process";

/** { pid: processor seconds used by that pid and all its children } for the given pids (numbers only). */
export function cpuSeconds(pids) {
  const ids = pids.filter((p) => Number.isInteger(p) && p > 0);
  if (!ids.length) return Promise.resolve({});
  const script = `
$ids = @(${ids.join(",")})
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
function Tree($r) { $o = @($r); foreach ($k in ($all | Where-Object { $_.ParentProcessId -eq $r })) { $o += Tree $k.ProcessId }; $o }
$res = @{}
foreach ($r in $ids) { $s = 0.0; foreach ($p in (Tree $r)) { $pr = Get-Process -Id $p -ErrorAction SilentlyContinue; if ($pr -and $pr.CPU) { $s += $pr.CPU } }; $res["$r"] = [math]::Round($s, 2) }
$res | ConvertTo-Json -Compress`;
  return new Promise((resolve) => {
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 10000, windowsHide: true }, (err, out) => {
      if (err) return resolve({});
      try { const j = JSON.parse(out); resolve(Object.fromEntries(Object.entries(j).map(([k, v]) => [Number(k), Number(v)]))); } catch { resolve({}); }
    });
  });
}

/** Remembers the last reading and says, per pid, true (busy), false (idle) or null (not known yet). Busy = at least 3 percent of one core. */
export function makeBusyMeter({ read = cpuSeconds, now = Date.now, minGapMs = 20_000, threshold = 0.03 } = {}) {
  let prev = {};      // pid -> { cpu, at }
  let last = {};      // pid -> true | false | null, from the latest reading
  let lastAt = 0;
  return {
    async read(pids) {
      if (!pids.length) { prev = {}; last = {}; return {}; }
      if (now() - lastAt < minGapMs && pids.every((p) => p in last)) return last;
      const cpu = await read(pids); const at = now(); const next = {}; const nextPrev = {};
      for (const p of pids) {
        if (!(p in cpu)) { next[p] = null; continue; }
        nextPrev[p] = { cpu: cpu[p], at };
        const before = prev[p];
        next[p] = before && at > before.at ? (cpu[p] - before.cpu) / ((at - before.at) / 1000) >= threshold : null;
      }
      prev = nextPrev; last = next; lastAt = at;
      return last;
    },
  };
}

import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";
if (process.argv[1] && fileURLToPath(import.meta.url) === resolvePath(process.argv[1]) && process.argv.includes("--selftest")) {
  const { spawn } = await import("node:child_process");
  let bad = 0;
  const ok = (name, cond) => { console.log(`${cond ? "OK  " : "FAIL"} ${name}`); if (!cond) bad++; };

  // 1) the rule, with made-up readings
  let t = 0; let cpu = { 1: 0, 2: 0 };
  const m = makeBusyMeter({ read: async () => ({ ...cpu }), now: () => t, minGapMs: 1000 });
  ok("first reading: not known yet", (await m.read([1, 2]))[1] === null);
  t += 20_000; cpu = { 1: 10, 2: 0.1 };
  const r = await m.read([1, 2]);
  ok("50 percent of a core: busy", r[1] === true);
  ok("0.5 percent of a core: idle", r[2] === false);
  ok("no programs: nothing", Object.keys(await m.read([])).length === 0);

  // 2) the real thing: one program that burns the processor and one that sleeps
  const busy = spawn(process.execPath, ["-e", "while(true){}"], { stdio: "ignore", windowsHide: true });
  const idle = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true });
  await new Promise((d) => setTimeout(d, 1500));
  const a = await cpuSeconds([busy.pid, idle.pid]); const t0 = Date.now();
  await new Promise((d) => setTimeout(d, 3000));
  const b = await cpuSeconds([busy.pid, idle.pid]); const dt = (Date.now() - t0) / 1000;
  const rateBusy = (b[busy.pid] - a[busy.pid]) / dt, rateIdle = (b[idle.pid] - a[idle.pid]) / dt;
  console.log(`     measured: busy program ${(rateBusy * 100).toFixed(0)} percent of a core, idle program ${(rateIdle * 100).toFixed(1)} percent`);
  ok("real busy program reads as busy", rateBusy >= 0.5);
  ok("real idle program reads as idle", rateIdle < 0.03);
  ok("a pid that does not exist gives no number", !(99999999 in (await cpuSeconds([99999999])) && (await cpuSeconds([99999999]))[99999999] > 0));
  busy.kill(); idle.kill();
  process.exit(bad ? 1 : 0);
}
