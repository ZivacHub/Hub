// Start / stop engine (plan Phase 11). It can ONLY run the programs listed in config/projects.json, with arguments from
// that file: no command text ever comes from the page. Stop only ends programs this engine started. Every action is logged.
//   node tools/dashboard/lib/control.mjs --selftest     starts and stops a fake project through the engine
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, openSync, closeSync, readdirSync, renameSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import { join, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const HUB = join(HERE, "..", "..", "..");
const BUSNUS = dirname(HUB);

export function makeControl(opts = {}) {
  const configPath = opts.configPath || join(HUB, "config", "projects.json");
  const dataDir = opts.dataDir || join(HUB, "data");
  const logDir = opts.logDir || join(HUB, "logs");
  const root = opts.busnusRoot || BUSNUS;
  const statePath = join(dataDir, "hub_state.json");

  const config = () => JSON.parse(readFileSync(configPath, "utf8")).projects;
  const entry = (id) => config().find((p) => p.id === id);
  const dirOf = (e) => join(root, e.name);
  const cwdOf = (e) => (e.cwd ? join(dirOf(e), e.cwd) : dirOf(e));

  function readState() { try { return JSON.parse(readFileSync(statePath, "utf8")); } catch { return { started: {}, autostart: {} }; } }
  function writeState(s) {
    mkdirSync(dataDir, { recursive: true });
    const tmp = statePath + ".tmp";
    writeFileSync(tmp, JSON.stringify(s, null, 2));
    renameSync(tmp, statePath);
  }
  function log(action, id, result) {
    try { mkdirSync(logDir, { recursive: true }); appendFileSync(join(logDir, "hub_actions.log"), `${new Date().toISOString()} ${action} ${id} ${result}\n`); } catch { /* logging must never break an action */ }
  }

  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const portOpen = (port) => new Promise((done) => {
    const s = createConnection({ host: "127.0.0.1", port });
    const end = (v) => { s.destroy(); done(v); };
    s.setTimeout(400, () => end(false)); s.once("connect", () => end(true)); s.once("error", () => end(false));
  });
  function lastLogLine(id) {
    try {
      const lines = readFileSync(join(logDir, id + ".log"), "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      return lines.length ? lines[lines.length - 1].slice(0, 200) : "";
    } catch { return ""; }
  }
  function programFound(e) {
    const prog = e.command[0];
    if (prog.includes("/") || prog.includes("\\") || prog.startsWith(".")) return existsSync(isAbsolute(prog) ? prog : resolve(cwdOf(e), prog));
    const r = spawnSync(process.platform === "win32" ? "where" : "which", [prog], { stdio: "ignore" });
    return r.status === 0;
  }

  async function runtime() {
    const st = readState();
    const out = [];
    for (const e of config()) {
      const rec = st.started[e.id];
      const ownAlive = !!(rec && alive(rec.pid));
      const open = await portOpen(e.port);
      let status = open ? "running" : ownAlive ? "starting" : "stopped";
      let error = "";
      if (!open && !ownAlive && rec) { error = lastLogLine(e.id) || "It stopped right after starting."; delete st.started[e.id]; writeState(st); }
      out.push({
        id: e.id, name: e.name, label: e.label, port: e.port, url: `http://127.0.0.1:${e.port}`, status, error,
        startedByHub: ownAlive, startWithPc: !!st.autostart[e.id], warn: e.warn || "", note: e.note || "",
        startSeconds: e.startSeconds || 60, canStart: existsSync(dirOf(e)) && programFound(e),
      });
    }
    return out;
  }

  async function start(id) {
    const e = entry(id);
    if (!e) return fail("start", id, "Not on the start list.");
    if (!existsSync(cwdOf(e))) return fail("start", id, "The project folder was not found.");
    if (!programFound(e)) return fail("start", id, `${e.command[0]} was not found on this PC.`);
    if (await portOpen(e.port)) return fail("start", id, `Port ${e.port} is already answering: it may already be running (or something else uses that port).`);
    mkdirSync(logDir, { recursive: true });
    const fd = openSync(join(logDir, e.id + ".log"), "w");
    const prog = e.command[0];
    const exe = prog.startsWith(".") ? resolve(cwdOf(e), prog) : prog;
    let child;
    try {
      child = spawn(exe, e.command.slice(1), { cwd: cwdOf(e), env: { ...process.env, ...(e.env || {}) }, detached: true, windowsHide: true, stdio: ["ignore", fd, fd] });
    } catch (err) { closeSync(fd); return fail("start", id, "Could not start: " + err.message); }
    child.on("error", (err) => log("start-error", id, err.message));
    child.unref(); closeSync(fd);
    const st = readState(); st.started[e.id] = { pid: child.pid, at: new Date().toISOString() }; writeState(st);
    log("start", id, "ok pid " + child.pid);
    return { ok: true, message: `Starting ${e.label}...` };
  }

  async function stop(id) {
    const e = entry(id);
    if (!e) return fail("stop", id, "Not on the start list.");
    const st = readState(); const rec = st.started[id];
    if (!rec || !alive(rec.pid)) {
      if (await portOpen(e.port)) return fail("stop", id, `${e.label} was started outside the Hub, so the Hub will not stop it.`);
      delete st.started[id]; writeState(st);
      return fail("stop", id, `${e.label} is not running.`);
    }
    const r = spawnSync("taskkill", ["/PID", String(rec.pid), "/T", "/F"], { stdio: "ignore" });
    delete st.started[id]; writeState(st);
    log("stop", id, r.status === 0 ? "ok" : "taskkill exit " + r.status);
    return r.status === 0 ? { ok: true, message: `${e.label} stopped.` } : { ok: false, error: "Windows could not stop it." };
  }

  function setAutostart(id, value) {
    const e = entry(id);
    if (!e) return fail("autostart", id, "Not on the start list.");
    const st = readState(); if (value) st.autostart[id] = true; else delete st.autostart[id]; writeState(st);
    log("autostart", id, value ? "on" : "off");
    return { ok: true, message: value ? `${e.label} will start with the PC.` : `${e.label} will not start with the PC.` };
  }

  // Open Claude Code in a project's folder. The folder must be a real directory directly under the projects folder.
  function openClaude(name) {
    let dirs = []; try { dirs = readdirSync(root).filter((d) => { try { return statSync(join(root, d)).isDirectory(); } catch { return false; } }); } catch { /* none */ }
    if (typeof name !== "string" || !dirs.includes(name) || /[&|<>^%"`]/.test(name)) return fail("open-claude", String(name).slice(0, 40), "Unknown project folder.");
    if (process.platform !== "win32") return fail("open-claude", name, "Only implemented for Windows.");
    spawn("cmd.exe", ["/c", "start", `Claude Code - ${name}`, "cmd", "/k", "claude"], { cwd: join(root, name), detached: true, stdio: "ignore" }).unref();
    log("open-claude", name, "ok");
    return { ok: true, message: `Opening Claude Code in ${name}...` };
  }

  async function bootStart() {
    const st = readState();
    for (const id of Object.keys(st.autostart)) { const r = await start(id); log("boot-start", id, r.ok ? "ok" : r.error); await new Promise((d) => setTimeout(d, 2000)); }
  }

  function fail(action, id, error) { log(action, id, "refused: " + error); return { ok: false, error }; }
  return { config, runtime, start, stop, setAutostart, openClaude, bootStart, readState };
}

// ---------- self-test: a fake project started and stopped through the real engine ----------
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv.includes("--selftest")) {
  const base = join(tmpdir(), "hub-control-test-" + process.pid);
  mkdirSync(join(base, "projects", "Fake"), { recursive: true });
  const port = 4900 + Math.floor(Math.random() * 90);
  writeFileSync(join(base, "projects", "Fake", "fake.js"), `require("http").createServer((q,r)=>r.end("hi")).listen(${port},"127.0.0.1");`);
  writeFileSync(join(base, "projects.json"), JSON.stringify({ projects: [{ id: "fake", name: "Fake", label: "Fake", command: ["node", "fake.js"], port }] }));
  const c = makeControl({ configPath: join(base, "projects.json"), dataDir: join(base, "data"), logDir: join(base, "logs"), busnusRoot: join(base, "projects") });
  let bad = 0;
  const ok = (name, cond) => { console.log(`${cond ? "OK  " : "FAIL"} ${name}`); if (!cond) bad++; };
  const wait = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((d) => setTimeout(d, 200)); } return false; };
  const rt = async () => (await c.runtime())[0];
  ok("stopped before start", (await rt()).status === "stopped");
  ok("unlisted id refused", (await c.start("../evil")).ok === false);
  ok("start ok", (await c.start("fake")).ok === true);
  ok("becomes running", await wait(async () => (await rt()).status === "running"));
  ok("started by the hub", (await rt()).startedByHub === true);
  ok("second start refused", (await c.start("fake")).ok === false);
  ok("autostart on and off", c.setAutostart("fake", true).ok && (await rt()).startWithPc === true && c.setAutostart("fake", false).ok && (await rt()).startWithPc === false);
  ok("open-claude refuses an unknown folder", c.openClaude("..\\..\\Windows").ok === false);
  ok("stop ok", (await c.stop("fake")).ok === true);
  ok("becomes stopped (port closed)", await wait(async () => (await rt()).status === "stopped"));
  ok("stop when not running refused", (await c.stop("fake")).ok === false);
  process.exit(bad ? 1 : 0);
}
