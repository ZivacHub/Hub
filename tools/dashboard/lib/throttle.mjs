// Game-mode slow-down engine (plan step 13.2; D30, D31, D36). While a game runs, the programs the Hub started (and everything they started)
// get the lowest priority, at most cpuPercent of the processor (the last logical processors) and a share of memoryMB in RAM.
// Everything is put back EXACTLY as it was when the game ends, or when the server starts and finds a game that is no longer running.
// D31: the process ids come only from the Hub's own start/stop engine (control.startedPids); nothing from outside, never the game, never Claude.
//   node tools/dashboard/lib/throttle.mjs --selftest     (starts fake programs; takes about a minute and uses the processor briefly)
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { cpus } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HUB = join(HERE, "..", "..", "..");
const SCRIPT = join(HERE, "throttle.ps1");

export function loadThrottleConfig(path = process.env.HUB_THROTTLE_CONFIG || join(HUB, "config", "throttle.json")) {   // the environment variable is for tests only
  const j = JSON.parse(readFileSync(path, "utf8"));
  return { cpuPercent: j.cpuPercent ?? 25, memoryMB: j.memoryMB ?? 2048, reapplySeconds: j.reapplySeconds ?? 30, pauses: j.pauses || {} };
}

/** Runs the PowerShell helper and returns its JSON answer (or null). Only integers and our own file path are ever passed. */
export function runHelper(action, { pids = [], cores = 0, workingSetMB = 0, stateFile = "" } = {}) {
  const ids = pids.filter((p) => Number.isInteger(p) && p > 0);
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-Action", action];
  if (ids.length) args.push("-Pids", ids.join(","));
  if (cores) args.push("-Cores", String(cores));
  if (workingSetMB) args.push("-WorkingSetMB", String(workingSetMB));
  if (stateFile) args.push("-StateFile", stateFile);
  return new Promise((resolve) => {
    execFile("powershell", args, { timeout: 30_000, windowsHide: true, maxBuffer: 4_000_000 }, (err, out) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(out)); } catch { resolve(null); }
    });
  });
}

export function makeThrottle({ hubPids, gpuPids = () => ({}), statePath, cfg, run = runHelper, log = () => {}, totalCpus = cpus().length }) {
  const readState = () => { try { return JSON.parse(readFileSync(statePath, "utf8")); } catch { return null; } };
  const writeState = (s) => { mkdirSync(dirname(statePath), { recursive: true }); const tmp = statePath + ".tmp"; writeFileSync(tmp, JSON.stringify(s, null, 2)); renameSync(tmp, statePath); };
  const coresFor = () => Math.max(1, Math.round((totalCpus * cfg.cpuPercent) / 100));
  const roots = () => Object.values(hubPids()).filter((p) => Number.isInteger(p));
  const perProgramMB = (n) => Math.max(256, Math.floor(cfg.memoryMB / Math.max(1, n)));

  async function applyNew(state) {
    const programs = roots();
    const tree = programs.length ? (await run("tree", { pids: programs })) || [] : [];
    const have = new Set(state.entries.map((e) => e.pid));
    const fresh = tree.filter((p) => !have.has(p));
    if (!fresh.length) return 0;
    const r = await run("apply", { pids: fresh, cores: state.cores, workingSetMB: state.perProgramMB });
    if (!r) return 0;
    state.entries.push(...r.entries);
    writeState(state);
    log("game-mode", "slow", `${r.entries.length} process(es) slowed, ${(r.failed || []).length} failed`);
    return r.entries.length;
  }

  // 13.3: the Hub's own programs that Ivan flagged as graphics users (config/projects.json "usesGpu": true) are frozen as a whole while the game runs
  async function suspendNew(state) {
    const flagged = Object.values(gpuPids()).filter((p) => Number.isInteger(p));
    if (!flagged.length) return 0;
    const tree = (await run("tree", { pids: flagged })) || [];
    state.paused = state.paused || [];
    const have = new Set(state.paused.map((e) => e.pid));
    const fresh = tree.filter((p) => !have.has(p));
    if (!fresh.length) return 0;
    const r = await run("suspend", { pids: fresh });
    if (!r) return 0;
    state.paused.push(...r.entries);
    writeState(state);
    log("game-mode", "pause", `${r.entries.length} process(es) frozen, ${(r.failed || []).length} failed`);
    return r.entries.length;
  }

  return {
    /** The game started: slow down everything the Hub started, and freeze the ones flagged as graphics users. */
    async engage() {
      if (readState()?.engaged) return this.status();
      const n = roots().length;
      const state = { engaged: true, at: new Date().toISOString(), cores: coresFor(), perProgramMB: perProgramMB(n), entries: [], paused: [] };
      writeState(state);
      await applyNew(state);
      await suspendNew(state);
      log("game-mode", "on", `${state.entries.length} process(es), ${state.cores} cores, ${state.perProgramMB} MB each, ${state.paused.length} frozen`);
      return this.status();
    },
    /** Called every few seconds while the game is on: slow down programs that started or spawned children in the meantime. */
    async tick() {
      const state = readState();
      if (!state?.engaged) return 0;
      state.perProgramMB = perProgramMB(roots().length) || state.perProgramMB;
      const n = await applyNew(state);
      return n + (await suspendNew(state));
    },
    /** The game ended: un-freeze, then put every saved original back and forget the state. */
    async release() {
      const state = readState();
      if (!state) return { restored: 0, skipped: 0, resumed: 0 };
      let resumed = 0;
      // un-freezing comes first: a frozen program must never be left behind
      if (state.paused?.length) { const rr = (await run("resume", { stateFile: statePath })) || { resumed: 0, skipped: state.paused.length }; resumed = rr.resumed; }
      const r = state.entries.length ? (await run("restore", { stateFile: statePath })) || { restored: 0, skipped: state.entries.length } : { restored: 0, skipped: 0 };
      try { unlinkSync(statePath); } catch { /* already gone */ }
      log("game-mode", "off", `restored ${r.restored}, skipped ${r.skipped} (gone or reused), resumed ${resumed}`);
      return { ...r, resumed };
    },
    /** At server start: if a game was on when the server stopped and no game is on now, put things back. */
    async recover(gameOnNow) {
      const state = readState();
      if (state?.engaged && !gameOnNow) return this.release();
      return null;
    },
    status() { const s = readState(); return { engaged: !!s?.engaged, since: s?.at || null, processes: s ? s.entries.length : 0, frozen: s?.paused ? s.paused.length : 0, cores: s?.cores ?? coresFor(), perProgramMB: s?.perProgramMB ?? null }; },
  };
}

// ---------- self-test: fake programs, real settings, real measurements ----------
import { fileURLToPath as toPath } from "node:url";
import { resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
if (process.argv[1] && toPath(import.meta.url) === resolvePath(process.argv[1]) && process.argv.includes("--selftest")) {
  const { makeControl } = await import("./control.mjs");
  const { cpuSeconds } = await import("./cpu.mjs");
  let bad = 0;
  const ok = (name, cond) => { console.log(`${cond ? "OK  " : "FAIL"} ${name}`); if (!cond) bad++; };
  const sleep = (ms) => new Promise((d) => setTimeout(d, ms));
  const total = cpus().length;
  const popcount = (n) => { let c = 0n; let x = BigInt(n); while (x) { c += x & 1n; x >>= 1n; } return Number(c); };

  const base = join(tmpdir(), "hub-throttle-test-" + process.pid);
  mkdirSync(join(base, "projects", "Fake"), { recursive: true }); mkdirSync(join(base, "projects", "Late"), { recursive: true });
  const port = 4950 + Math.floor(Math.random() * 40), port2 = port + 50;
  const burner = (p, workers, mb) => `const http=require("http"),{Worker}=require("worker_threads");http.createServer((q,r)=>r.end("x")).listen(${p},"127.0.0.1");` +
    (mb ? `const keep=Buffer.alloc(${mb}*1024*1024,1);setInterval(()=>{keep[0]=1},500);` : "") +
    `for(let i=0;i<${workers};i++)new Worker("while(true){}",{eval:true});` +
    `if(${workers}>2)require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});`;
  writeFileSync(join(base, "projects", "Fake", "fake.js"), burner(port, 12, 450));
  writeFileSync(join(base, "projects", "Late", "late.js"), burner(port2, 1, 0));
  writeFileSync(join(base, "projects.json"), JSON.stringify({ projects: [
    { id: "fake", name: "Fake", label: "Fake", command: ["node", "fake.js"], port },
    { id: "late", name: "Late", label: "Late", command: ["node", "late.js"], port: port2 }] }));
  const control = makeControl({ configPath: join(base, "projects.json"), dataDir: join(base, "data"), logDir: join(base, "logs"), busnusRoot: join(base, "projects") });
  const statePath = join(base, "data", "game_state.json");
  const cfg = { cpuPercent: 25, memoryMB: 300, reapplySeconds: 30 };
  const gpuIds = () => { const s = control.startedPids(); return s.gpuprog ? { gpuprog: s.gpuprog } : {}; };  // like the server: only programs flagged "usesGpu"
  const mk = () => makeThrottle({ hubPids: () => control.startedPids(), gpuPids: gpuIds, statePath, cfg });
  const th = mk();
  const rate = async (pid, secs) => { const a = (await cpuSeconds([pid]))[pid]; const t0 = Date.now(); await sleep(secs * 1000); const b = (await cpuSeconds([pid]))[pid]; return (b - a) / ((Date.now() - t0) / 1000); };
  const info = async (pids) => (await runHelper("get", { pids })) || [];
  const wsMB = (pid) => new Promise((r) => execFile("powershell", ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).WorkingSet64/1MB`], (e, o) => r(Number(String(o).trim().replace(",", ".")))));
  const expectMask = (n) => { let m = 0n; for (let i = total - n; i < total; i++) m |= 1n << BigInt(i); return m; };
  const expectCores = Math.round((total * cfg.cpuPercent) / 100);

  // a program NOT started by the Hub: must never be touched
  const foreign = spawn(process.execPath, ["-e", "while(true){}"], { stdio: "ignore", windowsHide: true });
  ok("a fake program starts through the Hub's engine", (await control.start("fake")).ok === true);
  for (let i = 0; i < 30 && (await control.runtime())[0].status !== "running"; i++) await sleep(300);
  const pid = control.startedPids().fake;
  await sleep(2500);
  const before = await rate(pid, 4);
  console.log(`     fake program before game mode: ${before.toFixed(1)} cores busy (this PC has ${total} logical processors)`);
  ok("it really uses many processor cores", before >= 6);
  const orig = (await info([pid]))[0];
  ok("original: normal priority, all processors", orig.priority === "Normal" && popcount(orig.affinity) === total);

  const r = await th.engage();
  ok("engage slows the fake program and its child (2 or more processes)", r.engaged && r.processes >= 2);
  const slowed = await info([pid]);
  ok("priority is now the lowest (Idle)", slowed[0].priority === "Idle");
  ok(`only the last ${expectCores} logical processors are allowed (25 percent of ${total})`, BigInt(slowed[0].affinity) === expectMask(expectCores));
  ok("a hard working-set cap of 300 MB is set", Math.round(Number(slowed[0].wsMax) / 1048576) === 300 && (slowed[0].wsFlags & 4) === 4);
  await sleep(4000);
  const mb = await wsMB(pid);
  console.log(`     memory in RAM now: ${mb.toFixed(0)} MB (it holds about 500 MB)`);
  ok("memory kept in RAM dropped under the cap (plus a small margin)", mb < 380);
  const after = await rate(pid, 5);
  console.log(`     fake program during game mode: ${after.toFixed(1)} cores busy`);
  ok(`processor use is held to about ${expectCores} cores`, after <= expectCores + 0.6);
  const f1 = (await info([foreign.pid]))[0];
  ok("a program the Hub did NOT start is untouched (D31)", f1.priority === "Normal" && popcount(f1.affinity) === total);

  ok("a program started during the game is slowed on the next tick", (await control.start("late")).ok === true);
  for (let i = 0; i < 30 && (await control.runtime())[1].status !== "running"; i++) await sleep(300);
  await th.tick();
  ok("  ...the late program has the lowest priority too", (await info([control.startedPids().late]))[0].priority === "Idle");

  const rel = await th.release();
  ok("release puts things back", rel.restored >= 2);
  const back = (await info([pid, control.startedPids().late]));
  ok("priority and processors are exactly as before", back.every((b) => b.priority === "Normal" && popcount(b.affinity) === total));
  ok("the working-set cap is gone", back.every((b) => (b.wsFlags & 5) === 0));
  const rateBack = await rate(pid, 4);
  console.log(`     fake program after release: ${rateBack.toFixed(1)} cores busy`);
  ok("full speed is back", rateBack >= 6);

  // 13.3: a program flagged as a graphics user is FROZEN while the game runs and runs again afterwards
  const port3 = port + 25;
  mkdirSync(join(base, "projects", "Gpu"), { recursive: true });
  writeFileSync(join(base, "projects", "Gpu", "gpu.js"), `require("http").createServer((q,r)=>r.end("alive")).listen(${port3},"127.0.0.1");new (require("worker_threads").Worker)("while(true){}",{eval:true});`);
  const cfgFile = JSON.parse(readFileSync(join(base, "projects.json"), "utf8"));
  cfgFile.projects.push({ id: "gpuprog", name: "Gpu", label: "Gpu", command: ["node", "gpu.js"], port: port3, usesGpu: true });
  writeFileSync(join(base, "projects.json"), JSON.stringify(cfgFile));
  const answers = async () => { try { return (await (await fetch(`http://127.0.0.1:${port3}/`, { signal: AbortSignal.timeout(1500) })).text()) === "alive"; } catch { return false; } };
  ok("the flagged program starts through the Hub's engine", (await control.start("gpuprog")).ok === true);
  for (let i = 0; i < 40 && !(await answers()); i++) await sleep(300);
  const gpid = control.startedPids().gpuprog;
  ok("before the game it answers", await answers());
  const busyBefore = await rate(gpid, 2);
  ok("...and uses the processor", busyBefore > 0.5);
  const e2 = await th.engage();
  ok("engage freezes it (and nothing else of the other programs)", e2.frozen >= 1);
  ok("while frozen it does not answer", !(await answers()));
  const busyFrozen = await rate(gpid, 3);
  console.log(`     flagged program: ${busyBefore.toFixed(2)} cores before, ${busyFrozen.toFixed(2)} while frozen`);
  ok("while frozen it uses no processor at all", busyFrozen < 0.05);
  ok("the program NOT flagged keeps running (slowed, not frozen)", (await rate(pid, 3)) > 0.5);
  const rel2 = await th.release();
  ok("game over: it answers again", rel2.resumed >= 1 && (await answers()));
  ok("...and uses the processor again", (await rate(gpid, 2)) > 0.5);
  await control.stop("gpuprog");

  // the server stopped during a game: the next start puts things back
  await th.engage();
  ok("engaged again (a game was on when the server stopped)", (await info([pid]))[0].priority === "Idle");
  const th2 = mk();
  ok("a game that is still on after a restart is left slowed", (await th2.recover(true)) === null && (await info([pid]))[0].priority === "Idle");
  await th2.recover(false);
  ok("no game after a restart: recover puts everything back", (await info([pid]))[0].priority === "Normal" && !existsSync(statePath));

  await control.stop("fake"); await control.stop("late"); try { foreign.kill(); } catch { /* done */ }
  process.exit(bad ? 1 : 0);
}
