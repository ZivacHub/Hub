// Game mode, step 13.3 (D37): while a game runs, pause the openshorts Docker container and unload Ollama's loaded models; afterwards un-pause.
// These two are the ONLY programs the Hub touches that it did not start (Ivan's exception to D31, 2026-11-12). The names come from
// config/throttle.json, never from a web request. Nothing is done if they are not running (a broken or stopped Docker is simply skipped).
//   node tools/dashboard/lib/pauses.mjs --selftest
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

const NAME_OK = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/;

/** Runs the docker command line tool. Resolves { ok, out } and never throws (Docker may be stopped or broken). */
export function runDocker(args, timeout = 20_000) {
  return new Promise((resolve) => {
    execFile("docker", args, { timeout, windowsHide: true, maxBuffer: 1_000_000 }, (err, out) => resolve({ ok: !err, out: String(out || "") }));
  });
}

/** Asks Ollama (or the stand-in in the self-test). Resolves the parsed JSON or null. Only talks to this PC. */
export async function ollamaCall(base, path, body) {
  try {
    const r = await fetch(base + path, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const t = await r.text();
    return t ? JSON.parse(t.split("\n")[0]) : {};
  } catch { return null; }
}

export function makePauses({ cfg = {}, statePath, docker = runDocker, ollama = ollamaCall, log = () => {} }) {
  const containers = (cfg.dockerContainers || []).filter((n) => NAME_OK.test(n));
  const base = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(cfg.ollamaUrl || "") ? cfg.ollamaUrl : null;
  const readState = () => { try { return JSON.parse(readFileSync(statePath, "utf8")); } catch { return null; } };
  const writeState = (s) => { mkdirSync(dirname(statePath), { recursive: true }); const tmp = statePath + ".tmp"; writeFileSync(tmp, JSON.stringify(s, null, 2)); renameSync(tmp, statePath); };
  let busy = false;

  async function pauseOnce(state) {
    let changed = 0;
    for (const name of containers) {
      // only a container that is running right now and is exactly this name (not a look-alike)
      const r = await docker(["ps", "--filter", `name=^/${name}$`, "--filter", "status=running", "--format", "{{.Names}}"]);
      if (!r.ok || !r.out.split(/\r?\n/).map((l) => l.trim()).includes(name)) continue;
      const p = await docker(["pause", name]);
      if (p.ok) { if (!state.docker.includes(name)) state.docker.push(name); changed++; log("game-mode", "pause-docker", name); }
    }
    if (base) {
      const ps = await ollama(base, "/api/ps");
      for (const m of ps?.models || []) {
        const model = m.name || m.model;
        if (!model || typeof model !== "string") continue;
        const u = await ollama(base, "/api/generate", { model, keep_alive: 0 });
        if (u) { if (!state.ollama.includes(model)) state.ollama.push(model); changed++; log("game-mode", "unload-ollama", model); }
      }
    }
    if (changed) writeState(state);
    return changed;
  }

  return {
    async engage() {
      if (readState()) return this.status();
      const state = { at: new Date().toISOString(), docker: [], ollama: [] };
      writeState(state);
      busy = true;
      try { await pauseOnce(state); } finally { busy = false; }
      return this.status();
    },
    /** Every half minute while the game is on: a container started or a model loaded in the meantime is dealt with too. */
    async tick() {
      const state = readState();
      if (!state || busy) return 0;
      busy = true;
      try { return await pauseOnce(state); } finally { busy = false; }
    },
    /** The game ended: un-pause what WE paused. Ollama needs nothing: it loads its model again with the next request. */
    async release() {
      const state = readState();
      if (!state) return { unpaused: 0, failed: 0 };
      let unpaused = 0, failed = 0;
      for (const name of state.docker || []) {
        if (!NAME_OK.test(name)) continue;
        const u = await docker(["unpause", name]);
        if (u.ok) { unpaused++; log("game-mode", "unpause-docker", name); } else { failed++; log("game-mode", "unpause-docker", `${name} FAILED (already running, or Docker is down)`); }
      }
      try { unlinkSync(statePath); } catch { /* already gone */ }
      log("game-mode", "pauses-off", `unpaused ${unpaused}, failed ${failed}, ${(state.ollama || []).length} model(s) will load again on next use`);
      return { unpaused, failed, models: state.ollama || [] };
    },
    async recover(gameOnNow) {
      const state = readState();
      if (state && !gameOnNow) return this.release();
      return null;
    },
    status() { const s = readState(); return { active: !!s, docker: s?.docker || [], ollamaUnloaded: s?.ollama || [], watching: { containers, ollama: !!base } }; },
  };
}

// ---------- self-test: a pretend Docker and a pretend Ollama (a real little web server), plus the real docker command with a name that cannot exist ----------
import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";
if (process.argv[1] && fileURLToPath(import.meta.url) === resolvePath(process.argv[1]) && process.argv.includes("--selftest")) {
  const { createServer } = await import("node:http");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { existsSync } = await import("node:fs");
  let bad = 0;
  const ok = (name, cond) => { console.log(`${cond ? "OK  " : "FAIL"} ${name}`); if (!cond) bad++; };

  // pretend Docker: a few containers with a state
  const boxes = new Map([["openshorts-backend", "running"], ["other-service", "running"], ["openshorts-backend-2", "running"], ["already-paused", "paused"]]);
  const calls = [];
  let dockerDown = false;
  const fakeDocker = async (args) => {
    calls.push(args.join(" "));
    if (dockerDown) return { ok: false, out: "" };
    if (args[0] === "ps") {
      const want = args[args.indexOf("--filter") + 1].replace("name=^/", "").replace("$", "");
      const st = args[args.lastIndexOf("--filter") + 1].replace("status=", "");
      // like the real one, the name filter is a regular expression ^/name$ and matches the exact name only
      return { ok: true, out: [...boxes].filter(([n, s]) => n === want && s === st).map(([n]) => n).join("\n") };
    }
    if (args[0] === "pause") { if (boxes.get(args[1]) !== "running") return { ok: false, out: "" }; boxes.set(args[1], "paused"); return { ok: true, out: args[1] }; }
    if (args[0] === "unpause") { if (boxes.get(args[1]) !== "paused") return { ok: false, out: "" }; boxes.set(args[1], "running"); return { ok: true, out: args[1] }; }
    return { ok: false, out: "" };
  };
  // pretend Ollama: really listens, keeps a list of loaded models, loads one on the first generate request
  const loaded = new Set(["qwen3:8b"]);
  const server = createServer((q, r) => {
    let body = ""; q.on("data", (c) => { body += c; });
    q.on("end", () => {
      r.setHeader("Content-Type", "application/json");
      if (q.url === "/api/ps") return r.end(JSON.stringify({ models: [...loaded].map((name) => ({ name })) }));
      if (q.url === "/api/generate") { const j = JSON.parse(body); if (j.keep_alive === 0) loaded.delete(j.model); else loaded.add(j.model); return r.end(JSON.stringify({ model: j.model, done: true })); }
      r.statusCode = 404; r.end("{}");
    });
  });
  await new Promise((d) => server.listen(0, "127.0.0.1", d));
  const url = `http://127.0.0.1:${server.address().port}`;
  const dir = join(tmpdir(), "hub-pauses-test-" + process.pid); mkdirSync(dir, { recursive: true });
  const statePath = join(dir, "game_pauses.json");
  const cfg = { dockerContainers: ["openshorts-backend"], ollamaUrl: url };
  const mk = (over = {}) => makePauses({ cfg, statePath, docker: fakeDocker, ...over });

  let p = mk();
  const st0 = await p.engage();
  ok("the openshorts container is paused", boxes.get("openshorts-backend") === "paused" && st0.docker.includes("openshorts-backend"));
  ok("another container is NOT touched", boxes.get("other-service") === "running");
  ok("a container with a look-alike name is NOT touched", boxes.get("openshorts-backend-2") === "running");
  ok("a container someone else paused is left alone", boxes.get("already-paused") === "paused" && !calls.some((c) => /pause already-paused/.test(c)));
  ok("Ollama's loaded model is unloaded", !loaded.has("qwen3:8b") && st0.ollamaUnloaded.includes("qwen3:8b"));

  // mid-game: Ollama gets asked for the model again (Jarvis, say) and the container is restarted
  loaded.add("qwen3:8b");
  boxes.set("openshorts-backend", "running");
  await p.tick();
  ok("a model loaded during the game is unloaded again on the next check", !loaded.has("qwen3:8b"));
  ok("a container that came back during the game is paused again", boxes.get("openshorts-backend") === "paused");

  const rel = await p.release();
  ok("game over: the container is running again", boxes.get("openshorts-backend") === "running" && rel.unpaused === 1);
  ok("...the other containers are exactly as before", boxes.get("other-service") === "running" && boxes.get("already-paused") === "paused");
  ok("the saved state is gone", !existsSync(statePath));
  // the model is simply loaded again by the next request
  await ollamaCall(url, "/api/generate", { model: "qwen3:8b", prompt: "hi" });
  ok("Ollama loads its model again on the next request (nothing for the Hub to do)", loaded.has("qwen3:8b"));

  // nothing running: nothing to do, no errors
  boxes.set("openshorts-backend", "exited"); loaded.clear();
  const idle = mk(); await idle.engage();
  ok("container stopped and no model loaded: nothing is done", idle.status().docker.length === 0 && idle.status().ollamaUnloaded.length === 0);
  await idle.release();

  // Docker broken or off (as on this PC right now), Ollama off
  dockerDown = true; server.close();
  const down = mk({ cfg: { ...cfg, ollamaUrl: "http://127.0.0.1:1" } });
  let threw = false; try { await down.engage(); await down.tick(); await down.release(); } catch { threw = true; }
  ok("Docker down and Ollama off: skipped quietly, nothing thrown", !threw && !existsSync(statePath));
  dockerDown = false;

  // the server stopped during a game: the next start puts things back
  boxes.set("openshorts-backend", "running");
  const a = mk({ cfg: { ...cfg, ollamaUrl: "" } }); await a.engage();
  ok("paused again for the restart case", boxes.get("openshorts-backend") === "paused");
  const b = mk({ cfg: { ...cfg, ollamaUrl: "" } });
  ok("game still on after a restart: left paused", (await b.recover(true)) === null && boxes.get("openshorts-backend") === "paused");
  await b.recover(false);
  ok("no game after a restart: un-paused", boxes.get("openshorts-backend") === "running" && !existsSync(statePath));

  // somebody un-paused it by hand during the game: releasing does not fail the game mode or touch anything else
  const c = mk({ cfg: { ...cfg, ollamaUrl: "" } }); await c.engage(); boxes.set("openshorts-backend", "running");
  const rc = await c.release();
  ok("un-paused by hand meanwhile: reported, not a crash", rc.failed === 1 && boxes.get("openshorts-backend") === "running");

  // bad names and addresses in the config are ignored
  const evil = makePauses({ cfg: { dockerContainers: ["x; calc", "--all", ""], ollamaUrl: "http://evil.example.com:11434" }, statePath, docker: fakeDocker });
  ok("names that are not plain container names, and an address that is not this PC, are ignored", JSON.stringify(evil.status().watching) === JSON.stringify({ containers: [], ollama: false }));

  // the real docker command line tool, with a name that cannot exist: it must find nothing, whatever state Docker is in
  const real = makePauses({ cfg: { dockerContainers: ["hub-selftest-no-such-container"] }, statePath: join(dir, "real.json") });
  const rs = await real.engage();
  ok("the real docker tool finds no such container and pauses nothing", rs.docker.length === 0);
  await real.release();

  try { server.close(); } catch { /* closed */ }
  try { (await import("node:fs")).rmSync(dir, { recursive: true, force: true }); } catch { /* temp folder */ }
  process.exit(bad ? 1 : 0);
}
