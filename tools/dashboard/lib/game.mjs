// Game detection (plan step 13.1; D29, D35). Is Ivan in a game right now?
//   1) a program from his game list is running (config/games.json), e.g. "League of Legends.exe": the game itself, not the Riot client, or
//   2) the app in front covers the whole screen, is not on the ignore list (browsers, video players) and the graphics card is busy.
// Switching on needs 1 sample for a list hit and 2 for the fullscreen rule; switching off needs 3 samples in a row (about 30 seconds),
// so a loading screen or an alt-tab does not make background work speed up and slow down again and again.
// The probe is ONE long-lived PowerShell process (lib/probe.ps1) that reads only: running watched programs, the app in front, fullscreen yes/no.
//   node tools/dashboard/lib/game.mjs --selftest
import { spawn, execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const normName = (s) => String(s || "").toLowerCase().replace(/\.exe$/, "");

export function loadGamesConfig(path = process.env.HUB_GAMES_CONFIG || join(HERE, "..", "..", "..", "config", "games.json")) {
  const j = JSON.parse(readFileSync(path, "utf8"));
  return { games: j.games || [], clients: j.clients || [], ignore: (j.ignore || []).map(normName), gpuBusyPercent: j.gpuBusyPercent ?? 30, sampleSeconds: j.sampleSeconds ?? 10 };
}

/** One sample in, one verdict out. sample = { running: [names], fg, full, cls, gpu }. Pure: no timing, no side effects. */
export function decideGame(sample, cfg) {
  const running = (sample.running || []).map(normName);
  for (const g of cfg.games) for (const e of g.exe || []) if (running.includes(normName(e))) return { on: true, by: "list", game: g.name, reason: `Game list: ${g.name}`, notes: [] };
  const notes = [];
  if (cfg.clients.some((c) => running.includes(normName(c)))) notes.push("The Riot client is open but no game is running");
  const fg = normName(sample.fg);
  const desktop = ["progman", "workerw"].includes(String(sample.cls || "").toLowerCase());
  if (sample.full && fg && !desktop && !cfg.ignore.includes(fg) && (sample.gpu ?? 0) >= cfg.gpuBusyPercent)
    return { on: true, by: "fullscreen", game: sample.fg, reason: `Fullscreen app (${sample.fg}) with a busy graphics card`, notes };
  return { on: false, by: null, game: null, reason: notes[0] || "No game", notes };
}

/** Remembers recent verdicts so the state does not flicker. update(sample) -> { on, since, game, reason, by, notes, at }. */
export function makeGameDetector({ cfg, now = Date.now, onStepsList = 1, onStepsFullscreen = 2, offSteps = 3 }) {
  let state = { on: false, since: null, game: null, reason: "No game", by: null, notes: [], at: null };
  let onCount = 0, offCount = 0;
  return {
    state: () => ({ ...state }),
    update(sample) {
      const d = decideGame(sample, cfg);
      const t = new Date(now()).toISOString();
      if (d.on) {
        onCount++; offCount = 0;
        const need = d.by === "list" ? onStepsList : onStepsFullscreen;
        if (!state.on && onCount >= need) state = { on: true, since: t, game: d.game, reason: d.reason, by: d.by, notes: d.notes, at: t };
        else if (state.on) state = { ...state, game: d.game, reason: d.reason, by: d.by, notes: d.notes, at: t };
      } else {
        offCount++; onCount = 0;
        if (state.on && offCount >= offSteps) state = { on: false, since: t, game: null, reason: d.reason, by: null, notes: d.notes, at: t };
        else if (!state.on) state = { ...state, reason: d.reason, notes: d.notes, at: t };
      }
      return { ...state };
    },
  };
}

/** Total graphics-card load in percent, or null when it cannot be read. Only asked when a fullscreen app is in front. */
export function gpuPercent() {
  return new Promise((resolve) => {
    execFile("nvidia-smi", ["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"], { timeout: 5000, windowsHide: true }, (err, out) => {
      const n = err ? NaN : Number(String(out).trim().split(/\r?\n/)[0]);
      resolve(Number.isFinite(n) ? n : null);
    });
  });
}

/** Starts the probe and feeds every sample to onSample(sample). Returns { stop() }. */
export function startProbe({ cfg, onSample, seconds = cfg.sampleSeconds, once = false }) {
  const watch = [...cfg.games.flatMap((g) => g.exe || []), ...cfg.clients].map(normName).filter(Boolean).join(",");
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(HERE, "probe.ps1"), "-Seconds", String(seconds), "-Watch", watch, "-ParentPid", String(process.pid)];
  if (once) args.push("-Once");
  const child = spawn("powershell", args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  const rl = createInterface({ input: child.stdout });
  rl.on("line", async (line) => {
    let s; try { s = JSON.parse(line); } catch { return; }
    s.running = Array.isArray(s.running) ? s.running : s.running ? [s.running] : [];
    s.gpu = s.full && s.fg && !cfg.ignore.includes(normName(s.fg)) ? await gpuPercent() : null;
    onSample(s);
  });
  child.on("error", () => {});
  return { stop: () => { try { child.kill(); } catch { /* already gone */ } } };
}

// ---------- self-test ----------
import { resolve as resolvePath } from "node:path";
if (process.argv[1] && fileURLToPath(import.meta.url) === resolvePath(process.argv[1]) && process.argv.includes("--selftest")) {
  let bad = 0;
  const ok = (name, cond) => { console.log(`${cond ? "OK  " : "FAIL"} ${name}`); if (!cond) bad++; };
  const skip = (name, why) => console.log(`SKIP ${name} (${why})`);
  const cfg = loadGamesConfig();
  const S = (o) => ({ running: [], fg: null, full: false, cls: "", gpu: null, ...o });

  // 1) the rule, made-up samples
  ok("League game program running: game", decideGame(S({ running: ["league of legends"] }), cfg).game === "League of Legends");
  ok("only the Riot client running: NOT a game, with a note", (() => { const d = decideGame(S({ running: ["leagueclient", "riotclientservices"] }), cfg); return d.on === false && d.notes.length === 1; })());
  ok("client and game both running: game", decideGame(S({ running: ["riotclientservices", "league of legends"] }), cfg).on === true);
  ok("Roblox player: game", decideGame(S({ running: ["robloxplayerbeta"] }), cfg).game === "Roblox");
  ok("a not-installed game has no program name and never matches", decideGame(S({ running: ["onceHuman".toLowerCase()] }), cfg).on === false);
  ok("unlisted fullscreen app with a busy graphics card: game", decideGame(S({ fg: "somegame", full: true, gpu: 80 }), cfg).by === "fullscreen");
  ok("fullscreen but the graphics card is idle: not a game", decideGame(S({ fg: "somegame", full: true, gpu: 3 }), cfg).on === false);
  ok("fullscreen browser with a busy card (a video): ignored", decideGame(S({ fg: "opera", full: true, gpu: 70 }), cfg).on === false);
  ok("the desktop covering the screen: ignored", decideGame(S({ fg: "explorer", full: true, cls: "Progman", gpu: 60 }), cfg).on === false);
  ok("a windowed app with a busy card: not a game", decideGame(S({ fg: "blender", full: false, gpu: 90 }), cfg).on === false);
  ok("nothing: not a game", decideGame(S({}), cfg).on === false);

  // 2) no flicker
  let t = Date.parse("2026-11-12T20:00:00Z"); const det = makeGameDetector({ cfg, now: () => t });
  const tick = (s) => { t += 10_000; return det.update(s); };
  ok("a list hit switches on at once", tick(S({ running: ["league of legends"] })).on === true);
  ok("one quiet sample does not switch off", tick(S({})).on === true);
  ok("two quiet samples do not switch off", tick(S({})).on === true);
  ok("three quiet samples in a row switch off", tick(S({})).on === false);
  ok("fullscreen needs two samples", tick(S({ fg: "x", full: true, gpu: 90 })).on === false && tick(S({ fg: "x", full: true, gpu: 90 })).on === true);
  ok("a game that comes back before the third quiet sample stays on", (() => { tick(S({})); tick(S({})); return tick(S({ fg: "x", full: true, gpu: 90 })).on === true; })());
  ok("it remembers since when", typeof det.state().since === "string");

  // 3) the real probe on this PC
  await new Promise((resolve) => {
    const p = startProbe({ cfg, once: true, onSample: (s) => {
      ok("the real probe answers with the app in front", typeof s.fg === "string" || s.fg === null);
      ok("the real probe reports the watched programs that run now", Array.isArray(s.running));
      console.log(`     real sample: in front = ${s.fg}, fullscreen = ${s.full}, class = ${s.cls}, watched programs running = [${s.running.join(", ")}]`);
      p.stop(); resolve();
    } });
    setTimeout(() => { ok("the real probe answered within 15 s", false); p.stop(); resolve(); }, 15_000);
  });
  // the probe must really SEE a watched program that runs (a renamed copy of node.exe stands in for a game)
  {
    const { copyFileSync, mkdirSync, rmSync } = await import("node:fs"); const { tmpdir } = await import("node:os");
    const dir = join(tmpdir(), "hub-game-test-" + process.pid); mkdirSync(dir, { recursive: true });
    copyFileSync(process.execPath, join(dir, "hubfakegame.exe"));
    const fake = spawn(join(dir, "hubfakegame.exe"), ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true });
    await new Promise((d) => setTimeout(d, 1500));
    const cfg2 = { ...cfg, games: [{ name: "Fake game", exe: ["hubfakegame.exe"] }, ...cfg.games] };
    await new Promise((resolve) => {
      const p = startProbe({ cfg: cfg2, once: true, onSample: (s) => {
        ok("the probe sees a watched program that is really running", s.running.includes("hubfakegame"));
        ok("...and the rule turns that into a game", decideGame(s, cfg2).game === "Fake game");
        p.stop(); resolve();
      } });
      setTimeout(() => { ok("the probe answered within 15 s", false); p.stop(); resolve(); }, 15_000);
    });
    try { fake.kill(); } catch { /* done */ }
    await new Promise((d) => setTimeout(d, 800));
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* the temp folder is cleaned up by Windows later */ }
  }
  const g = await gpuPercent();
  g === null ? skip("graphics card load", "nvidia-smi not available") : ok(`graphics card load is readable (${g} percent now)`, g >= 0 && g <= 100);

  // 4) a real fullscreen window: open one, bring it to the front, and see whether the probe notices
  const fsScript = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object Windows.Forms.Form; $f.FormBorderStyle = 'None'; $f.StartPosition = 'Manual'; $b = [Windows.Forms.Screen]::PrimaryScreen.Bounds; $f.Bounds = $b; $f.TopMost = $true; $f.BackColor = 'Black'; $f.Show(); $f.Activate(); $end = (Get-Date).AddSeconds(14); while ((Get-Date) -lt $end) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }; $f.Close()`;
  const win = spawn("powershell", ["-NoProfile", "-Command", fsScript], { stdio: "ignore" });
  await new Promise((d) => setTimeout(d, 4000));
  await new Promise((resolve) => {
    const p = startProbe({ cfg, once: true, onSample: (s) => {
      console.log(`     fullscreen test sample: in front = ${s.fg}, fullscreen = ${s.full}`);
      s.fg === "powershell" || s.fg === "pwsh" ? ok("a real fullscreen window in front is seen as fullscreen", s.full === true) : skip("real fullscreen window", "Windows did not let a background program take the front");
      p.stop(); resolve();
    } });
    setTimeout(() => { skip("real fullscreen window", "probe timed out"); p.stop(); resolve(); }, 15_000);
  });
  try { win.kill(); } catch { /* done */ }
  process.exit(bad ? 1 : 0);
}
