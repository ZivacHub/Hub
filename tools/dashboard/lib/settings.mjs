// Hub settings (step 21.4): what the BUSNUS workflow should do "on the go", changeable per project.
// Hub-wide defaults live in the Hub's own data file (git-ignored, e.g. data/hub-defaults.json).
// A per-project override lives ONLY in <project folder>/.claude/hub-settings.json:
//   { "version": 1, "settings": { "<id>": "<value>" } }     (only overrides; a missing key = use the default)
// These two files are the ONLY files this module ever writes. Plain JSON, so the workflow can read it.
//   node tools/dashboard/lib/settings.mjs --selftest
import * as realFs from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

export const FILE_VERSION = 1;
export const PROJECT_FILE = ["." + "claude", "hub-settings.json"]; // .claude/hub-settings.json

// The registry. Data on purpose: add an entry here and the API and the page show it.
export const DEFINITIONS = [
  {
    id: "reportAfterPhase",
    label: "After each phase, make",
    help: "What the workflow writes up when a phase is finished. A shorter report costs fewer tokens.",
    choices: [
      { value: "full", label: "Full report", help: "A full report with pictures." },
      { value: "short", label: "Short summary", help: "A few plain sentences, no pictures." },
      { value: "onRequest", label: "Only when I ask", help: "Nothing until you ask for it." },
    ],
    default: "short",
  },
  {
    id: "backgroundPictures",
    label: "Pictures made in the background",
    help: "Reference pictures the workflow can prepare while you do other things. Each one uses tokens.",
    choices: [
      { value: "always", label: "Always", help: "Made automatically whenever the workflow wants them." },
      { value: "onRequest", label: "Only when I ask", help: "Made only after you ask for them." },
      { value: "off", label: "Off", help: "Never made in the background." },
    ],
    default: "always",
  },
];

const SAY = {
  badId: "That setting does not exist.",
  badValue: "That choice is not one of the options for this setting.",
  badScope: "Settings can be changed for the defaults or for one project.",
  noProject: "That is not one of your BUSNUS projects.",
  nullDefault: "A default cannot be removed; pick one of the choices.",
  badProjectFile: "This project's settings file could not be read, so it was left as it is. Fix or delete .claude/hub-settings.json in the project, then try again.",
  badDefaultsFile: "The Hub's defaults file could not be read, so it was left as it is. Delete it to start again from the built-in defaults.",
  writeFail: "The setting could not be saved. Nothing was changed.",
};

const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);

export function makeSettings({ dataFile, projectFolder, projectNames, now = () => new Date(), fsHooks = {}, definitions = DEFINITIONS } = {}) {
  const fs = { ...realFs, ...fsHooks };
  const defs = () => definitions;
  const def = (id) => (typeof id === "string" ? definitions.find((d) => d.id === id) : undefined);
  const okValue = (d, v) => typeof v === "string" && d.choices.some((c) => c.value === v);
  const projFile = (folder) => join(folder, PROJECT_FILE[0], PROJECT_FILE[1]);

  // Read a settings file. { state: "missing" | "ok" | "bad", data }
  function readFile(path) {
    let text;
    try { text = fs.readFileSync(path, "utf8"); } catch (e) { return e && e.code === "ENOENT" ? { state: "missing" } : { state: "bad" }; }
    if (!text.trim()) return { state: "bad" };
    let j;
    try { j = JSON.parse(text); } catch { return { state: "bad" }; }
    if (!isObj(j) || j.version !== FILE_VERSION || (j.settings !== undefined && !isObj(j.settings))) return { state: "bad" };
    return { state: "ok", data: j };
  }

  function atomicWrite(path, obj) {
    fs.mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
      fs.renameSync(tmp, path);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
      throw e;
    }
  }

  function builtIn() { return Object.fromEntries(definitions.map((d) => [d.id, d.default])); }

  function currentDefaults() {
    const r = readFile(dataFile);
    const out = builtIn();
    if (r.state === "ok") for (const d of definitions) { const v = (r.data.settings || {})[d.id]; if (okValue(d, v)) out[d.id] = v; }
    return { values: out, state: r.state, data: r.data };
  }

  function knownProject(name) {
    if (typeof name !== "string" || !name || name.length > 120) return null;
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._()-]*$/.test(name) || name.includes("..") || /[. ]$/.test(name)) return null;
    let folder = null;
    try { folder = typeof projectFolder === "function" ? projectFolder(name) : null; } catch { folder = null; }
    return typeof folder === "string" && folder && isAbsolute(folder) ? folder : null;
  }

  function getAll() {
    const dflt = currentDefaults();
    const names = [];
    try { for (const n of (typeof projectNames === "function" ? projectNames() : []) || []) if (typeof n === "string") names.push(n); } catch { /* none */ }
    const projects = [];
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      const folder = knownProject(name);
      if (!folder) continue;
      const r = readFile(projFile(folder));
      const values = {};
      for (const d of definitions) {
        const v = r.state === "ok" ? (r.data.settings || {})[d.id] : undefined;
        values[d.id] = okValue(d, v) ? { value: v, source: "project" } : { value: dflt.values[d.id], source: "default" };
      }
      const p = { name, values };
      if (r.state === "bad") p.problem = SAY.badProjectFile;
      projects.push(p);
    }
    const out = { definitions, defaults: dflt.values, projects };
    if (dflt.state === "bad") out.problem = SAY.badDefaultsFile;
    return out;
  }

  function setDefault(id, value) {
    const d = def(id);
    if (!d) return { ok: false, error: SAY.badId };
    if (value === null || value === undefined) return { ok: false, error: SAY.nullDefault };
    if (!okValue(d, value)) return { ok: false, error: SAY.badValue };
    const cur = readFile(dataFile);
    if (cur.state === "bad") return { ok: false, error: SAY.badDefaultsFile };
    const data = cur.state === "ok" ? cur.data : { version: FILE_VERSION };
    data.settings = { ...(data.settings || {}), [id]: value };
    data.updated = now().toISOString();
    try { atomicWrite(dataFile, data); } catch { return { ok: false, error: SAY.writeFail }; }
    return { ok: true };
  }

  function setProject(project, id, value) {
    const folder = knownProject(project);
    if (!folder) return { ok: false, error: SAY.noProject };
    const d = def(id);
    if (!d) return { ok: false, error: SAY.badId };
    if (value !== null && value !== undefined && !okValue(d, value)) return { ok: false, error: SAY.badValue };
    const path = projFile(folder);
    const cur = readFile(path);
    if (cur.state === "bad") return { ok: false, error: SAY.badProjectFile };
    const remove = value === null || value === undefined;
    if (cur.state === "missing" && remove) return { ok: true };
    const data = cur.state === "ok" ? cur.data : { version: FILE_VERSION };
    const s = { ...(data.settings || {}) };
    if (remove) delete s[id]; else s[id] = value;
    data.settings = s;
    try { atomicWrite(path, data); } catch { return { ok: false, error: SAY.writeFail }; }
    return { ok: true };
  }

  return { definitions: defs, getAll, setDefault, setProject };
}

// ---------------------------------------------------------------- self-test
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv.includes("--selftest")) {
  const assert = (await import("node:assert/strict")).default;
  let n = 0;
  const t = (name, fn) => { fn(); n++; console.log("ok  " + name); };
  const root = realFs.mkdtempSync(join(tmpdir(), "hub-settings-"));
  const BUS = join(root, "BUSNUS");
  const dataFile = join(root, "hub", "data", "hub-defaults.json");
  for (const p of ["Alpha", "Beta", "Gamma"]) realFs.mkdirSync(join(BUS, p), { recursive: true });
  realFs.mkdirSync(join(BUS, "Alpha", ".claude"), { recursive: true });
  realFs.writeFileSync(join(root, "outside.txt"), "keep");
  const names = ["Alpha", "Beta", "Gamma"];
  const written = [];
  const hooks = {
    writeFileSync: (p, ...a) => { written.push(p); return realFs.writeFileSync(p, ...a); },
    renameSync: (a, b) => { written.push(b); return realFs.renameSync(a, b); },
  };
  const mk = (extra = {}) => makeSettings({ dataFile, projectFolder: (nm) => (names.includes(nm) ? join(BUS, nm) : null), projectNames: () => names, now: () => new Date("2026-11-24T10:00:00Z"), fsHooks: hooks, ...extra });
  const s = mk();
  const pf = (nm) => join(BUS, nm, ".claude", "hub-settings.json");
  const val = (nm, id) => s.getAll().projects.find((p) => p.name === nm).values[id];

  t("defaults come from the definitions (short summary, pictures always)", () => {
    const a = s.getAll();
    assert.equal(a.defaults.reportAfterPhase, "short");
    assert.equal(a.defaults.backgroundPictures, "always");
    assert.equal(a.projects.length, 3);
    assert.deepEqual(val("Beta", "reportAfterPhase"), { value: "short", source: "default" });
    assert.ok(a.definitions.every((d) => d.id && d.label && d.help && d.choices.length === 3 && d.choices.some((c) => c.value === d.default)));
  });
  t("changing a default is stored in the Hub's own file and followed by projects", () => {
    assert.deepEqual(s.setDefault("reportAfterPhase", "full"), { ok: true });
    assert.equal(s.getAll().defaults.reportAfterPhase, "full");
    assert.deepEqual(val("Beta", "reportAfterPhase"), { value: "full", source: "default" });
    assert.equal(JSON.parse(realFs.readFileSync(dataFile, "utf8")).version, 1);
  });
  t("a project override creates .claude/hub-settings.json and wins over the default", () => {
    assert.deepEqual(s.setProject("Beta", "backgroundPictures", "off"), { ok: true });
    assert.deepEqual(val("Beta", "backgroundPictures"), { value: "off", source: "project" });
    assert.deepEqual(val("Alpha", "backgroundPictures"), { value: "always", source: "default" });
    assert.deepEqual(JSON.parse(realFs.readFileSync(pf("Beta"), "utf8")), { version: 1, settings: { backgroundPictures: "off" } });
  });
  t("removing an override goes back to the default", () => {
    assert.deepEqual(s.setProject("Beta", "backgroundPictures", null), { ok: true });
    assert.deepEqual(val("Beta", "backgroundPictures"), { value: "always", source: "default" });
    assert.deepEqual(JSON.parse(realFs.readFileSync(pf("Beta"), "utf8")).settings, {});
  });
  t("removing an override where there is no file writes nothing", () => {
    const before = written.length;
    assert.deepEqual(s.setProject("Gamma", "reportAfterPhase", null), { ok: true });
    assert.equal(written.length, before);
    assert.ok(!realFs.existsSync(pf("Gamma")));
  });
  t("bad id, bad value, null default are refused in plain words", () => {
    for (const r of [s.setDefault("nope", "full"), s.setProject("Alpha", "nope", "full"), s.setDefault("reportAfterPhase", "huge"), s.setProject("Alpha", "reportAfterPhase", "huge"), s.setProject("Alpha", "reportAfterPhase", 5), s.setDefault("reportAfterPhase", null), s.setDefault("__proto__", "x"), s.setDefault(undefined, "x")]) {
      assert.equal(r.ok, false); assert.match(r.error, /^[A-Z].*\.$/);
    }
    assert.ok(!realFs.existsSync(pf("Alpha")));
  });
  t("an unknown project is refused", () => {
    assert.equal(s.setProject("Nope", "reportAfterPhase", "full").ok, false);
    assert.equal(s.setProject("", "reportAfterPhase", "full").ok, false);
    assert.equal(s.setProject(undefined, "reportAfterPhase", "full").ok, false);
  });
  t("path tricks in the project name are refused and nothing leaves the project", () => {
    // a lenient lookup that would happily resolve the name still must not be reached
    const lenient = mk({ projectFolder: (nm) => join(BUS, nm) });
    for (const bad of ["..", "../hub", "..\\hub", "Alpha/..", "Alpha/../Beta", "C:\\Windows", "/etc", "Alpha\0", ".claude", "Alpha.", "a/b"]) {
      assert.equal(lenient.setProject(bad, "reportAfterPhase", "full").ok, false, bad);
    }
    assert.equal(realFs.readFileSync(join(root, "outside.txt"), "utf8"), "keep");
    assert.ok(!realFs.existsSync(join(root, ".claude")));
  });
  t("a corrupt project file is kept and reported, never overwritten", () => {
    realFs.mkdirSync(join(BUS, "Gamma", ".claude"), { recursive: true });
    realFs.writeFileSync(pf("Gamma"), "{ not json");
    const r = s.setProject("Gamma", "reportAfterPhase", "full");
    assert.equal(r.ok, false); assert.match(r.error, /left as it is/);
    assert.equal(realFs.readFileSync(pf("Gamma"), "utf8"), "{ not json");
    assert.match(s.getAll().projects.find((p) => p.name === "Gamma").problem, /could not be read/);
    realFs.writeFileSync(pf("Gamma"), JSON.stringify({ version: 2, settings: {} }));
    assert.equal(s.setProject("Gamma", "reportAfterPhase", "full").ok, false);
    assert.equal(JSON.parse(realFs.readFileSync(pf("Gamma"), "utf8")).version, 2);
    realFs.rmSync(pf("Gamma"));
  });
  t("a corrupt defaults file is kept and reported", () => {
    const keep = realFs.readFileSync(dataFile, "utf8");
    realFs.writeFileSync(dataFile, "garbage");
    assert.equal(s.setDefault("reportAfterPhase", "short").ok, false);
    assert.equal(realFs.readFileSync(dataFile, "utf8"), "garbage");
    assert.ok(s.getAll().problem);
    assert.equal(s.getAll().defaults.reportAfterPhase, "short");
    realFs.writeFileSync(dataFile, keep);
  });
  t("unknown keys in an existing file are kept when writing", () => {
    realFs.writeFileSync(pf("Alpha"), JSON.stringify({ version: 1, note: "mine", settings: { reportAfterPhase: "onRequest", futureThing: "x" } }));
    assert.deepEqual(s.setProject("Alpha", "backgroundPictures", "onRequest"), { ok: true });
    const j = JSON.parse(realFs.readFileSync(pf("Alpha"), "utf8"));
    assert.deepEqual(j, { version: 1, note: "mine", settings: { reportAfterPhase: "onRequest", futureThing: "x", backgroundPictures: "onRequest" } });
    assert.equal(s.setProject("Alpha", "reportAfterPhase", null).ok, true);
    assert.equal(JSON.parse(realFs.readFileSync(pf("Alpha"), "utf8")).settings.futureThing, "x");
  });
  t("an invalid stored value is read as the default (file untouched)", () => {
    realFs.writeFileSync(pf("Alpha"), JSON.stringify({ version: 1, settings: { reportAfterPhase: "weird" } }));
    assert.deepEqual(val("Alpha", "reportAfterPhase"), { value: "full", source: "default" });
  });
  t("writes are atomic: no temp file is left behind", () => {
    for (const d of [dirname(dataFile), join(BUS, "Alpha", ".claude"), join(BUS, "Beta", ".claude")]) assert.deepEqual(realFs.readdirSync(d).filter((f) => f.includes(".tmp-")), []);
    // a failing rename leaves the target untouched and removes the temp file
    const before = realFs.readFileSync(pf("Alpha"), "utf8");
    const bad = mk({ fsHooks: { renameSync: () => { throw new Error("boom"); } } });
    assert.equal(bad.setProject("Alpha", "backgroundPictures", "off").ok, false);
    assert.equal(realFs.readFileSync(pf("Alpha"), "utf8"), before);
    assert.deepEqual(realFs.readdirSync(join(BUS, "Alpha", ".claude")).filter((f) => f.includes(".tmp-")), []);
  });
  t("only the two allowed files are ever written", () => {
    const ok = new Set([dataFile, pf("Alpha"), pf("Beta"), pf("Gamma")].map((p) => p.toLowerCase()));
    assert.ok(written.length > 0);
    for (const w of written) assert.ok(ok.has(w.toLowerCase()) || /hub-settings\.json\.tmp-|hub-defaults\.json\.tmp-/.test(w), w);
    assert.equal(realFs.readFileSync(join(root, "outside.txt"), "utf8"), "keep");
    assert.deepEqual(realFs.readdirSync(join(BUS, "Beta")).sort(), [".claude"]);
  });
  t("a new definition shows up and works without other changes", () => {
    const extra = [...DEFINITIONS, { id: "testSetting", label: "T", help: "t", choices: [{ value: "a", label: "A", help: "a" }, { value: "b", label: "B", help: "b" }], default: "a" }];
    const x = mk({ definitions: extra });
    assert.equal(x.getAll().defaults.testSetting, "a");
    assert.equal(x.setProject("Beta", "testSetting", "b").ok, true);
    assert.deepEqual(x.getAll().projects.find((p) => p.name === "Beta").values.testSetting, { value: "b", source: "project" });
    assert.equal(x.setProject("Beta", "testSetting", "c").ok, false);
    assert.equal(s.setProject("Beta", "testSetting", "b").ok, false); // the plain registry does not know it
  });
  t("the file is plain JSON the workflow can read", () => {
    const j = JSON.parse(realFs.readFileSync(pf("Beta"), "utf8"));
    assert.equal(j.version, 1); assert.equal(typeof j.settings, "object");
  });
  realFs.rmSync(root, { recursive: true, force: true });
  console.log(`settings selftest: ${n} passed`);
}
