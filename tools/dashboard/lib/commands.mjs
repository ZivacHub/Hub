// Slash-command list for the Hub chat box (Phase 19). Read only, no dependencies.
// Sources: user skills (~/.claude/skills/*/SKILL.md), the project's own skills (.claude/skills/*/SKILL.md) and commands (.claude/commands/*.md).
// Plugins are NOT read (no reliable list of enabled plugins on this PC). The app's built-in commands (/compact ...) are not files, so not listed.
//   node tools/dashboard/lib/commands.mjs --selftest
import { readdirSync, openSync, readSync, closeSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

export const MAX_COMMANDS = 300, MAX_DESC = 180, CACHE_MS = 30000, HEAD_BYTES = 8192;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,63}$/;   // what can be typed after "/" (no spaces, slashes or odd signs)

export const DEMO_COMMANDS = [
  ["delegate", "Hand each task to the right helper and check the result."],
  ["docs", "Open only the documents the work needs."],
  ["handoff", "Save where the work stands so the next chat continues."],
  ["info", "List the BUSNUS workflow commands and how to use each one."],
  ["overview", "Show where a project is, in a short plain summary."],
  ["pickup", "Continue a project in a new chat without losing the thread."],
  ["plan", "Show, edit and run the project's build plan."],
].map(([name, description]) => ({ name, description, source: "user" }));

function head(file) {   // first HEAD_BYTES of a file as text; "" when unreadable
  let fd;
  try {
    if (!statSync(file).isFile()) return "";
    fd = openSync(file, "r"); const buf = Buffer.alloc(HEAD_BYTES); const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.toString("utf8", 0, n).replace(/^﻿/, "");
  } catch { return ""; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ } }
}
const unquote = (v) => { v = v.trim(); return (v.length > 1 && /^(["']).*\1$/.test(v)) ? v.slice(1, -1) : v; };

/** Hand-made frontmatter reader: { data: {key: value}, body } . Only "key: value" lines (and > / | block values). Broken input gives data {} . */
export function parseFrontmatter(text) {
  const t = String(text || "").replace(/\r\n?/g, "\n");
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(t);
  if (!m) return { data: {}, body: t };
  const lines = m[1].split("\n"), data = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let v = kv[2];
    if (/^[>|][+-]?$/.test(v.trim())) {   // block value: the indented lines that follow
      const parts = [];
      while (i + 1 < lines.length && /^[ \t]+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
      v = parts.join(" ");
    }
    data[kv[1].toLowerCase()] = unquote(v);
  }
  return { data, body: t.slice(m[0].length) };
}
const clip = (s) => { const one = String(s || "").split("\n")[0].replace(/\s+/g, " ").trim(); return one.length > MAX_DESC ? one.slice(0, MAX_DESC - 1).trimEnd() + "…" : one; };
const firstLine = (body) => (String(body || "").split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find((l) => l && !/^---+$/.test(l)) || "");
const notInvocable = (d) => /^(false|no|0)$/i.test(String(d["user-invocable"] ?? d["user_invocable"] ?? "").trim());

function entry(kind, fallbackName, file, source) {   // kind "skill" | "command"
  const { data, body } = parseFrontmatter(head(file));
  if (notInvocable(data)) return null;
  let name = kind === "skill" ? (data.name || fallbackName) : fallbackName;
  if (typeof name !== "string" || !NAME_RE.test(name)) return null;
  const e = { name, description: clip(data.description || firstLine(body)), source };
  if (data["argument-hint"]) e.hint = clip(data["argument-hint"]).slice(0, 80);
  return e;
}
function safeDir(dir) { try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; } }

/** Reads one `.claude` folder: skills/<x>/SKILL.md and commands/*.md. Pure file reading, never throws. */
export function readClaudeDir(claudeDir, source) {
  const out = [];
  for (const d of safeDir(join(claudeDir, "skills"))) {
    if (!d.isDirectory()) continue;
    const f = join(claudeDir, "skills", d.name, "SKILL.md");
    if (existsSync(f)) { const e = entry("skill", d.name, f, source); if (e) out.push(e); }
  }
  for (const f of safeDir(join(claudeDir, "commands"))) {
    if (!f.isFile() || !/\.md$/i.test(f.name)) continue;
    const e = entry("command", f.name.replace(/\.md$/i, ""), join(claudeDir, "commands", f.name), source);
    if (e) out.push(e);
  }
  return out;
}

/** user list + (optional) project list; a project entry wins over a user entry with the same name; sorted by name, at most 300. */
export function buildList({ userClaudeDir, projectRoot } = {}) {
  const byName = new Map();
  const user = userClaudeDir ? readClaudeDir(userClaudeDir, "user") : [];
  const proj = projectRoot ? readClaudeDir(join(projectRoot, ".claude"), "project") : [];
  for (const e of [...user, ...proj]) byName.set(e.name.toLowerCase(), e);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "en")).slice(0, MAX_COMMANDS);
}

/** Cached (30 s) list per project name. `rootOf(name)` returns the project folder or null (the caller already checked the name). */
export function makeCommands({ userClaudeDir = join(homedir(), ".claude"), now = () => Date.now() } = {}) {
  const cache = new Map();
  return {
    get(projectName, projectRoot) {
      const key = projectName || "";
      const hit = cache.get(key);
      if (hit && now() - hit.at < CACHE_MS) return hit.list;
      const list = buildList({ userClaudeDir, projectRoot: projectName ? projectRoot : null });
      cache.set(key, { at: now(), list });
      return list;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("lib/commands.mjs") && process.argv.includes("--selftest")) {
  let bad = 0; const ok = (n, c) => { console.log(`${c ? "OK  " : "FAIL"} ${n}`); if (!c) { bad++; process.exitCode = 1; } };
  const tmp = mkdtempSync(join(tmpdir(), "hub-cmd-"));
  try {
    const w = (p, t) => { const f = join(tmp, p); mkdirSync(join(f, ".."), { recursive: true }); writeFileSync(f, t); };
    // user skills
    w("u/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: Does alpha things.\nSecond line.\n---\nBody that must not be needed.\n");
    w("u/skills/beta/SKILL.md", "---\nname: beta\ndescription: >\n  Folded text\n  over two lines.\nargument-hint: <what>\n---\n");
    w("u/skills/nodesc/SKILL.md", "---\nname: nodesc\n---\n# Heading line\nbody\n");
    w("u/skills/hidden/SKILL.md", "---\nname: hidden\ndescription: no\nuser-invocable: false\n---\n");
    w("u/skills/broken/SKILL.md", "---\nname: broken\ndescription: never closed\n");
    w("u/skills/garbage/SKILL.md", "\u0000\u0001 not a skill at all");
    w("u/skills/huge/SKILL.md", "---\nname: huge\ndescription: " + "x".repeat(900) + "\n---\n");
    w("u/skills/odd/SKILL.md", "---\nname: ../evil name\ndescription: odd\n---\n");
    w("u/skills/quoted/SKILL.md", "---\r\nname: \"quoted\"\r\ndescription: 'Windows line ends'\r\n---\r\n");
    w("u/skills/dup/SKILL.md", "---\nname: shared\ndescription: from user\n---\n");
    w("u/skills/emptydir/readme.txt", "no SKILL.md here");
    w("u/skills/stray.md", "not a folder");
    // project
    w("p/.claude/skills/pskill/SKILL.md", "---\nname: pskill\ndescription: Project skill.\n---\n");
    w("p/.claude/skills/dup/SKILL.md", "---\nname: shared\ndescription: from project\n---\n");
    w("p/.claude/commands/deploy.md", "---\ndescription: Deploy it.\nargument-hint: [env]\n---\nbody");
    w("p/.claude/commands/plainline.md", "\n\nFirst real line of the command\nmore");
    w("p/.claude/commands/bad name.md", "x");
    w("p/.claude/commands/notes.txt", "ignored");
    const uDir = join(tmp, "u"), pRoot = join(tmp, "p");
    const lu = buildList({ userClaudeDir: uDir }), lp = buildList({ userClaudeDir: uDir, projectRoot: pRoot });
    const by = (l, n) => l.find((e) => e.name === n);
    ok("user list: frontmatter name and first line of the description, source user", by(lu, "alpha")?.description === "Does alpha things." && by(lu, "alpha").source === "user");
    ok("block description (>) is joined; argument-hint becomes hint", by(lu, "beta")?.description === "Folded text over two lines." && by(lu, "beta").hint === "<what>");
    ok("missing description falls back to the first non-empty line (heading marks removed)", by(lu, "nodesc")?.description === "Heading line");
    ok("user-invocable: false is skipped", !by(lu, "hidden"));
    ok("broken or garbage files do not crash (listed by folder name); a bad name in the frontmatter is dropped", !by(lu, "../evil name") && !lu.some((e) => /[\\/ ]/.test(e.name)) && by(lu, "garbage") !== undefined);
    ok("a skill whose frontmatter never closes is listed by folder name with a safe description", by(lu, "broken") !== undefined && by(lu, "broken").description.length <= MAX_DESC);
    ok("huge description is clipped to 180 characters", by(lu, "huge")?.description.length === MAX_DESC && by(lu, "huge").description.endsWith("…"));
    ok("Windows line ends and quotes are handled", by(lu, "quoted")?.description === "Windows line ends");
    ok("folders without SKILL.md and stray files are ignored", !by(lu, "emptydir") && !by(lu, "stray"));
    ok("project commands: name = file name without .md, description from frontmatter or first line", by(lp, "deploy")?.description === "Deploy it." && by(lp, "deploy").source === "project" && by(lp, "deploy").hint === "[env]" && by(lp, "plainline")?.description === "First real line of the command");
    ok("project skill listed; bad file names and non-.md files are not", by(lp, "pskill")?.source === "project" && !by(lp, "bad name") && !by(lp, "notes"));
    ok("same name: the project one wins, only one entry", lp.filter((e) => e.name === "shared").length === 1 && by(lp, "shared").source === "project");
    ok("sorted by name", lp.every((e, i) => i === 0 || lp[i - 1].name.localeCompare(e.name, "en") <= 0));
    ok("no project: only user entries", !lu.some((e) => e.source === "project") && buildList({ userClaudeDir: uDir, projectRoot: join(tmp, "nope") }).length === lu.length);
    ok("a missing user folder gives an empty list, no crash", buildList({ userClaudeDir: join(tmp, "none") }).length === 0 && buildList({}).length === 0);
    for (let i = 0; i < 320; i++) w(`big/skills/s${String(i).padStart(3, "0")}/SKILL.md`, `---\nname: s${String(i).padStart(3, "0")}\ndescription: d\n---\n`);
    const lb = buildList({ userClaudeDir: join(tmp, "big") });
    ok("capped at 300", lb.length === 300 && lb[0].name === "s000");
    let t = 1000; const mc = makeCommands({ userClaudeDir: uDir, now: () => t });
    const c1 = mc.get("P", pRoot); w("u/skills/late/SKILL.md", "---\nname: late\ndescription: x\n---\n");
    t += 29000; const c2 = mc.get("P", pRoot); t += 2000; const c3 = mc.get("P", pRoot);
    ok("cached for 30 seconds, then read again", c1 === c2 && !by(c2, "late") && by(c3, "late") !== undefined && mc.get("", null).every((e) => e.source === "user"));
    ok("parseFrontmatter: no frontmatter gives empty data", Object.keys(parseFrontmatter("just text").data).length === 0 && Object.keys(parseFrontmatter(null).data).length === 0);
    ok("the demo list has the seven sample commands", DEMO_COMMANDS.length === 7 && DEMO_COMMANDS.every((e) => e.name && e.description && e.source === "user"));
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } }
  console.log(bad ? `${bad} FAILED` : "all passed");
}
