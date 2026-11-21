// Pinned chats, kept by the Hub itself (the Claude app's own pin cannot be changed from outside). Phase 19.
// The only file this writes is data/pins.json of the Hub folder (git-ignored). Atomic write (temp file + rename), 50 pins at most.
// Nothing here ever throws: a bad answer is { ok:false, error }, a corrupt file is ignored and replaced on the next change.
//   node tools/dashboard/lib/pins.mjs --selftest
// Contract: docs/plan/phases/19-pictures-pins.md
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PINS_FILE = resolve(HERE, "..", "..", "..", "data", "pins.json");
export const MAX_PINS = 50;
const ID_RE = /^(h-[A-Za-z0-9-]{1,60}|s-[0-9a-fA-F-]{8}|local_[0-9a-f-]{8,64})$/i;
const projectOk = (p) => typeof p === "string" && p.length >= 1 && p.length <= 120 && !/[\\/:\0]|^\.+$/.test(p);

/** makePins({ file, now }) -> { list(project?), pin({chatId, project}), unpin({chatId}), isPinned(chatId) }. `now` = a function or a number (ms). */
export function makePins({ file = DEFAULT_PINS_FILE, now = Date.now } = {}) {
  const stamp = () => new Date(typeof now === "function" ? now() : Number(now)).toISOString();
  const load = () => {
    try {
      const j = JSON.parse(readFileSync(file, "utf8"));
      const arr = j && Array.isArray(j.pins) ? j.pins : [];
      const seen = new Set(); const out = [];
      for (const p of arr) {
        if (!p || typeof p.chatId !== "string" || !ID_RE.test(p.chatId) || !projectOk(p.project) || seen.has(p.chatId)) continue;
        seen.add(p.chatId); out.push({ chatId: p.chatId, project: p.project, at: typeof p.at === "string" ? p.at : "" });
        if (out.length >= MAX_PINS) break;
      }
      return out;
    } catch { return []; }
  };
  const save = (pins) => {
    const tmp = file + "." + process.pid + ".tmp";
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(tmp, JSON.stringify({ version: 1, pins }, null, 2) + "\n");
      renameSync(tmp, file);
      return true;
    } catch { try { rmSync(tmp, { force: true }); } catch { /* ignore */ } return false; }
  };
  const byNewest = (a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);
  return {
    list(project) {
      try { const all = load().sort(byNewest); return typeof project === "string" && project ? all.filter((p) => p.project === project) : all; } catch { return []; }
    },
    pin({ chatId, project } = {}) {
      try {
        if (typeof chatId !== "string" || !ID_RE.test(chatId)) return { ok: false, error: "bad chat id" };
        if (!projectOk(project)) return { ok: false, error: "bad project name" };
        const pins = load();
        if (pins.some((p) => p.chatId === chatId)) return { ok: true, already: true, count: pins.length };
        if (pins.length >= MAX_PINS) return { ok: false, error: `at most ${MAX_PINS} pinned chats; unpin one first` };
        pins.push({ chatId, project, at: stamp() });
        return save(pins) ? { ok: true, count: pins.length } : { ok: false, error: "could not save the pins file" };
      } catch { return { ok: false, error: "could not pin" }; }
    },
    unpin({ chatId } = {}) {
      try {
        if (typeof chatId !== "string" || !ID_RE.test(chatId)) return { ok: false, error: "bad chat id" };
        const pins = load(); const left = pins.filter((p) => p.chatId !== chatId);
        if (left.length === pins.length) return { ok: true, already: true, count: pins.length };
        return save(left) ? { ok: true, count: left.length } : { ok: false, error: "could not save the pins file" };
      } catch { return { ok: false, error: "could not unpin" }; }
    },
    isPinned(chatId) { try { return typeof chatId === "string" && load().some((p) => p.chatId === chatId); } catch { return false; } },
  };
}

// ---------- self-test ----------
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv.includes("--selftest")) {
  const fs = await import("node:fs"); const os = await import("node:os");
  let ok = 0, total = 0;
  const check = (n, c, x = "") => { total++; if (c) { ok++; console.log("OK   " + n); } else console.log("FAIL " + n + (x ? " " + x : "")); };
  const tmp = fs.mkdtempSync(join(os.tmpdir(), "hub-pins-"));
  const file = join(tmp, "data", "pins.json");
  let t = Date.parse("2026-11-21T10:00:00Z");
  const pins = makePins({ file, now: () => (t += 1000) });
  check("empty at first (no file): list [], nothing pinned", pins.list().length === 0 && pins.isPinned("h-20261121-1") === false);
  const r1 = pins.pin({ chatId: "h-20261121-1", project: "Alpha" });
  check("pin: ok, file created in a new folder", r1.ok === true && r1.count === 1 && fs.existsSync(file));
  pins.pin({ chatId: "s-0a1b2c3d", project: "Beta" }); pins.pin({ chatId: "local_abcdef12-3456", project: "Alpha" });
  check("list: newest first, all three", pins.list().map((p) => p.chatId).join() === "local_abcdef12-3456,s-0a1b2c3d,h-20261121-1", pins.list().map((p) => p.chatId).join());
  check("list(project) filters", pins.list("Alpha").length === 2 && pins.list("Beta").length === 1 && pins.list("Nope").length === 0);
  check("each entry is { chatId, project, at (ISO time) }", (() => { const p = pins.list()[0]; return Object.keys(p).join() === "chatId,project,at" && !Number.isNaN(Date.parse(p.at)); })());
  check("isPinned true / false", pins.isPinned("s-0a1b2c3d") === true && pins.isPinned("s-ffffffff") === false);
  check("pinning twice changes nothing (already: true)", (() => { const r = pins.pin({ chatId: "s-0a1b2c3d", project: "Beta" }); return r.ok && r.already === true && pins.list().length === 3; })());
  check("a new Pins object on the same file sees the same pins (survives a restart)", makePins({ file }).list().length === 3);
  check("unpin removes; unpinning something not pinned is ok", (() => { const a = pins.unpin({ chatId: "s-0a1b2c3d" }), b = pins.unpin({ chatId: "s-0a1b2c3d" }); return a.ok && !a.already && b.ok && b.already === true && pins.list().length === 2 && !pins.isPinned("s-0a1b2c3d"); })());
  const badIds = ["", "x", "h-", "../x", "..\\x", "h-a/b", "s-123", "s-0a1b2c3dd", "local_x", "C:\\Windows", null, undefined, 5, {}, "h-" + "a".repeat(61), "h-ok\0"];
  check("bad chat ids refused for pin and unpin, nothing written", badIds.every((x) => pins.pin({ chatId: x, project: "A" }).ok === false && pins.unpin({ chatId: x }).ok === false) && pins.list().length === 2);
  check("bad project names refused", ["", "..", "a/b", "a\\b", "C:x", null, 5, "p".repeat(121)].every((x) => pins.pin({ chatId: "h-valid-1", project: x }).ok === false) && pins.list().length === 2);
  check("pin() with no argument does not throw", pins.pin().ok === false && pins.unpin().ok === false);
  // 50 limit
  for (let i = 0; i < 60; i++) pins.pin({ chatId: "h-lim-" + i, project: "Alpha" });
  check("at most 50 pins; the 51st is refused with a plain message", pins.list().length === 50 && pins.pin({ chatId: "h-over", project: "A" }).ok === false && /at most 50/.test(pins.pin({ chatId: "h-over", project: "A" }).error));
  check("after one unpin there is room again", pins.unpin({ chatId: "h-lim-3" }).ok && pins.pin({ chatId: "h-over", project: "A" }).ok && pins.list().length === 50);
  check("atomic write: no temp file left behind, file is valid JSON with version 1", fs.readdirSync(dirname(file)).join() === "pins.json" && JSON.parse(fs.readFileSync(file, "utf8")).version === 1);
  // corrupt files
  fs.writeFileSync(file, "{ this is not json");
  const bad = makePins({ file, now: () => t });
  check("a corrupt file reads as empty, no throw", bad.list().length === 0 && bad.isPinned("h-lim-1") === false);
  check("the next pin replaces the corrupt file", bad.pin({ chatId: "h-fresh-1", project: "Alpha" }).ok && JSON.parse(fs.readFileSync(file, "utf8")).pins.length === 1);
  fs.writeFileSync(file, JSON.stringify({ version: 1, pins: [{ chatId: "h-good-1", project: "A", at: "2026-01-01T00:00:00.000Z" }, { chatId: "../evil", project: "A" }, { chatId: "h-good-2", project: "a/b" }, null, 7, { chatId: "h-good-1", project: "A" }] }));
  check("a file with bad or duplicate entries: only the good ones are used", makePins({ file }).list().length === 1);
  fs.writeFileSync(file, JSON.stringify([1, 2, 3])); check("a file with the wrong shape reads as empty", makePins({ file }).list().length === 0);
  // save failure: the "file" folder is blocked by a regular file
  const blocked = makePins({ file: join(tmp, "data", "pins.json", "nested", "pins.json") });
  check("a place that cannot be written: ok:false with a message, no throw", blocked.pin({ chatId: "h-x-1", project: "A" }).ok === false);
  check("data/ is git-ignored in the Hub folder", /^data\/$/m.test(fs.readFileSync(resolve(HERE, "..", "..", "..", ".gitignore"), "utf8")));
  check("the default file is data/pins.json of the Hub folder", DEFAULT_PINS_FILE === resolve(HERE, "..", "..", "..", "data", "pins.json"));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${ok}/${total}`);
  process.exit(ok === total ? 0 : 1);
}
