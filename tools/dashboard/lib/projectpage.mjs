// Project page feed (Phase 17, step 17.4, read side). READ-ONLY: only reads files, never writes, never starts anything.
// GET /api/project?name=<project name> -> one JSON object (shape: docs/plan/phases/17-project-page.md).
//   node tools/dashboard/lib/projectpage.mjs --selftest
// Safety: the name from the query is only ever COMPARED with the names of the known projects (resolveName); it is never put into a file path.
// The folder comes from the Hub's own project list (registry or the BUSNUS folder), and only after the name matched exactly.
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUSNUS_DIR = resolve(HERE, "..", "..", "..", "..");
const MAX_DECISIONS = 20, MAX_CHATS = 30, MAX_FIELD = 600, MAX_SAID = 1400, MAX_HANDOFF_LINES = 40, MAX_HANDOFF_CHARS = 3000;

const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
const noMd = (s) => String(s ?? "").replace(/```[\s\S]*?```/g, " ").replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
const isoOrNull = (v) => { const t = typeof v === "number" ? v : Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const msOf = (s) => Date.parse(s || "") || 0;
// 17.5 (D54): a CLOSED app chat with Remote Control off and a real "open in the app" link gets an answer box. A cheap first look only:
// the full D49 rule (lib/appanswer.mjs) is checked by the server right before anything is sent.
const APP_LINK_RE = /^claude:\/\/claude\.ai\/epitaxy\/local_[0-9a-f-]{8,64}$/i;
export const canAnswerApp = (c) => !!c && c.kind === "app" && c.state === "closed" && c.remoteControl === false && typeof c.openLink === "string" && APP_LINK_RE.test(c.openLink);

let libPromise = null; // the shared BUSNUS helper library (same one data.mjs uses), loaded only when real data is needed
const busnusLib = () => (libPromise ??= import(pathToFileURL(join(homedir(), ".claude", "hooks", "lib", "busnus.mjs")).href));

/** The query name counts only when it is exactly one of the known project names. Returns that name or null. */
export function resolveName(name, known) {
  if (typeof name !== "string" || !name || name.length > 120) return null;
  return Array.isArray(known) && known.includes(name) ? name : null;
}

/** Folder of a known project: a registered home first, else a folder of that name in the BUSNUS folder. Null when nothing is there.
 *  `name` must already have passed resolveName; it is checked again to hold no path pieces. */
export async function projectRoot(name, { known, busnusDir = BUSNUS_DIR, registry } = {}) {
  if (!resolveName(name, known) || /[\\/:]|^\.+$/.test(name)) return null;
  let reg = registry;
  if (!reg) { try { reg = (await busnusLib()).readRegistry().projects; } catch { reg = []; } }
  const hit = (reg || []).find((p) => p && (p.name || "") === name && p.home && existsSync(p.home));
  if (hit) return resolve(hit.home);
  const dir = join(busnusDir, name);
  return existsSync(dir) ? dir : null;
}

// ---------- decisions ----------
function sectionOf(text, id) {
  const head = new RegExp(`^#{2,3}\\s+${id}\\b.*$`, "im").exec(text);
  if (!head) return "";
  const rest = text.slice(head.index + head[0].length);
  const next = /^#{2,3}\s/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}
const DATE = /\d{4}-\d{2}-\d{2}/;

/** Parses one decision block (the text under its heading). Pure. */
export function parseBlock(body, note = "") {
  const q = /\*\*Question:\*\*\s*(.+)/i.exec(body)?.[1]
    || body.split("\n").map((l) => l.trim()).find((l) => l && !/^\*\*Affects/i.test(l)) || "";
  const options = [];
  for (const line of body.split("\n")) {
    const m = /^\s*(?:[-*]\s*)?\**([A-F])\)\**\s*(.+)$/.exec(line);
    if (m && options.length < 6) options.push({ key: m[1], text: noMd(m[2]) });
  }
  const said = /\*\*The owner said[^*]*\*\*\s*(.+)/i.exec(body)?.[1] || "";
  const rec = /\*\*(?:Recommendation|My recommendation):?\*\*\s*(.+)/i.exec(body)?.[1] || "";
  const date = DATE.exec(note)?.[0] || DATE.exec(/\*\*The owner said[^*]*\*\*/i.exec(body)?.[0] || "")?.[0] || null;
  return { question: noMd(q), options, ownerSaid: /not answered yet/i.test(said) ? "" : noMd(said), recommendation: noMd(rec), date };
}

/** Every open or proposed decision of a DECISIONS.md text, with question, options, owner's words and date. Read-only. */
export async function parseOpenDecisions(text, { redact = (s) => s } = {}) {
  const { parseDecisions } = await busnusLib();
  const red = (s) => clip(redact(String(s ?? "")), MAX_FIELD);
  const out = [];
  for (const d of [...parseDecisions(text).items].filter((i) => i.status === "open" || i.status === "proposed")) {
    if (out.length >= MAX_DECISIONS) break;
    const b = parseBlock(sectionOf(text, d.id), d.note);
    out.push({
      id: d.id, title: red(d.title), status: d.status, question: red(b.question),
      options: b.options.map((o) => ({ key: o.key, text: red(o.text) })), ownerSaid: red(b.ownerSaid), recommendation: red(b.recommendation), date: b.date,
    });
  }
  return out;
}

// ---------- handoff ----------
/** First 40 lines of the "Next steps" section of .claude/handoff.md, redacted and clipped. Null when there is none. */
export function nextSteps(text, { redact = (s) => s } = {}) {
  const m = /^##\s+[^\n]*next steps[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(String(text ?? ""));
  if (!m) return null;
  const lines = m[1].replace(/\r/g, "").split("\n").slice(0, MAX_HANDOFF_LINES).join("\n").trim();
  return lines ? clip(redact(lines), MAX_HANDOFF_CHARS) : null;
}

// ---------- the last thing Claude said in a saved chat file ----------
function lastAssistantOf(file) {
  const size = statSync(file).size;
  for (const bytes of [1_500_000, 12_000_000]) {
    const len = Math.min(size, bytes); const buf = Buffer.alloc(len); const fd = openSync(file, "r");
    try { readSync(fd, buf, 0, len, size - len); } finally { closeSync(fd); }
    const lines = buf.toString("utf8").split("\n"); if (size > len) lines.shift();
    for (let i = lines.length - 1; i >= 0; i--) {
      let j; try { j = JSON.parse(lines[i]); } catch { continue; }
      if (j.type === "assistant" && !j.isSidechain && Array.isArray(j.message?.content)) {
        const text = j.message.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
        if (text) return { text, at: j.timestamp || null };
      }
    }
    if (size <= bytes) break;
  }
  return null;
}
const encode = (p) => String(p).replace(/[^A-Za-z0-9]/g, "-");
const tidy = (s) => String(s).replace(/```[\s\S]*?```/g, "[code]").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();

/** Saved chat files of one project folder: [{ name (no .jsonl), file, m }] newest first. Read-only listing. */
function chatFiles(root, base) {
  const enc = encode(root); const out = [];
  let folders = []; try { folders = readdirSync(base); } catch { return out; }
  for (const f of folders.filter((f) => f === enc || f.startsWith(enc + "-"))) {
    const dir = join(base, f); let names = []; try { names = readdirSync(dir).filter((n) => n.endsWith(".jsonl")); } catch { continue; }
    for (const n of names) { try { out.push({ name: n.slice(0, -6), file: join(dir, n), m: statSync(join(dir, n)).mtimeMs }); } catch { /* skip */ } }
  }
  return out.sort((a, b) => b.m - a.m);
}

// ---------- the page ----------
/**
 * Builds the project page object.
 *  name      = a name that already passed resolveName
 *  card      = the card from /api/projects for that project
 *  root      = the project folder (from projectRoot), or null
 *  chatGroup = the { project, chats } entry of the chat list for this project (or undefined)
 *  hubChats  = the engine's Hub chat list (used only to find a Hub chat's saved file by its session id)
 *  chatsBase = folder of saved chats (default ~/.claude/projects); the tests point it at a temp folder
 */
export async function buildProjectPage({ name, card, root, chatGroup, hubChats = [], redact = (s) => s, chatsBase = join(homedir(), ".claude", "projects"), now = Date.now() } = {}) {
  let decisions = [], handoff = null;
  if (root) {
    try {
      const { docPath, read } = await busnusLib();
      decisions = await parseOpenDecisions(read(docPath(root, "DECISIONS.md")), { redact });
      const ns = nextSteps(read(join(root, ".claude", "handoff.md")), { redact });
      handoff = ns ? { nextSteps: ns } : null;
    } catch { /* a project with unreadable notes still gets its chats */ }
  }
  const files = root ? chatFiles(root, chatsBase) : [];
  const sessionOfHub = new Map((Array.isArray(hubChats) ? hubChats : []).map((h) => [h && h.id, h && h.sessionId]));
  const list = (chatGroup && Array.isArray(chatGroup.chats) ? chatGroup.chats : []).slice();
  list.sort((a, b) => (b.needsYou === true) - (a.needsYou === true) || msOf(b.lastActive) - msOf(a.lastActive));
  const chats = list.slice(0, MAX_CHATS).map((c) => {
    // find the saved file: a Hub chat by its session id; any other chat by the first 8 characters of its id ("s-xxxxxxxx")
    let f = null;
    const sid = c.kind === "hub" ? sessionOfHub.get(c.id) : null;
    if (typeof sid === "string" && /^[0-9a-fA-F-]{8,64}$/.test(sid)) f = files.find((x) => x.name === sid);
    else if (/^s-[0-9a-fA-F-]{8}$/.test(String(c.id))) f = files.find((x) => x.name.toLowerCase().startsWith(String(c.id).slice(2).toLowerCase()));
    let said = null;
    if (f) { try { said = lastAssistantOf(f.file); } catch { /* unreadable: no lastSaid */ } }
    const text = said ? tidy(said.text) : (c.kind === "hub" && c.lastReply ? String(c.lastReply) : "");
    return {
      id: c.id, kind: c.kind, state: c.state, title: c.name, needsYou: c.needsYou === true, why: c.why || "", snippet: c.snippet || "",
      lastActive: c.lastActive ?? null, since: c.since ?? null, openLink: c.openLink ?? null, remoteControl: c.remoteControl ?? null, canAnswer: c.canAnswer === true, canAnswerApp: canAnswerApp(c),
      lastSaid: clip(redact(text), MAX_SAID), lastSaidAt: said ? said.at : null,
    };
  });
  return { generatedAt: new Date(now).toISOString(), demo: false, project: card, decisions, chats, handoff };
}

/** Sample data for --demo. demoJson = demo/project-page.json (minutes-ago numbers); chatGroup = the sample chat group of the project. */
export function demoPage({ card, chatGroup, demoJson, now = Date.now() }) {
  const d = (demoJson && demoJson.projects && demoJson.projects[card.name]) || {};
  const said = d.lastSaid || {};
  const ago = (m) => new Date(now - m * 60000).toISOString();
  const list = (chatGroup && chatGroup.chats ? chatGroup.chats : []).slice();
  list.sort((a, b) => (b.needsYou === true) - (a.needsYou === true) || msOf(b.lastActive) - msOf(a.lastActive));
  return {
    generatedAt: new Date(now).toISOString(), demo: true, project: card,
    decisions: Array.isArray(d.decisions) ? d.decisions.slice(0, MAX_DECISIONS) : [],
    chats: list.slice(0, MAX_CHATS).map((c) => {
      const s = said[c.id];
      return { id: c.id, kind: c.kind, state: c.state, title: c.name, needsYou: c.needsYou === true, why: c.why || "", snippet: c.snippet || "", lastActive: c.lastActive ?? null, since: c.since ?? null,
        openLink: c.openLink ?? null, remoteControl: c.remoteControl ?? null, canAnswer: c.canAnswer === true, canAnswerApp: canAnswerApp(c), lastSaid: s ? clip(s.text, MAX_SAID) : (c.lastReply || ""), lastSaidAt: s ? ago(s.agoMinutes) : null };
    }),
    handoff: d.handoff ? { nextSteps: String(d.handoff) } : null,
  };
}

// ---------- self-test (fake folders in a temp dir; nothing real is touched) ----------
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv.includes("--selftest")) {
  const fs = await import("node:fs"); const os = await import("node:os");
  const { redact } = await import("./data.mjs");
  let ok = 0, total = 0;
  const check = (n, c, x = "") => { total++; if (c) { ok++; console.log("OK   " + n); } else console.log("FAIL " + n + (x ? " " + x : "")); };
  const tmp = fs.mkdtempSync(join(os.tmpdir(), "hub-projectpage-"));
  const put = (p, t) => { fs.mkdirSync(dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
  const longQ = "Why ".repeat(500);
  const dec = (extra = "") => `# Decisions\n\n## Waiting on the owner (open and proposed)\n\n` +
    `## D3 — Pick a voice   [open]\n**Question:** Which voice should it use?\n**Options:**\n- A) Film voice: sounds like the film. Cost: private only.\n- B) Free voice: similar.\n- C) Try both.\n**Recommendation:** C, so you can hear both.\n**The owner said (2026-11-02):** "let me hear them"\n\n` +
    `## D5 — Naming   [proposed 2026-11-03: Claude's default]\n**Question:** ${longQ}\n**The owner said:** (not answered yet)\n\n` +
    `## D6 — Keys   [open]\n**Question:** Use api_key: abcdef1234567890 or sk-${"a1".repeat(12)} here?\n\n` +
    `## D1 — Old   [decided 2026-10-01]\n**Question:** Already done.\n**The owner said:** yes\n\n` + extra;
  const root3 = join(tmp, "Alpha"), root2 = join(tmp, "Beta");
  put(join(root3, "docs", "INDEX.md"), "x"); put(join(root3, "docs", "DECISIONS.md"), dec());
  put(join(root3, ".claude", "handoff.md"), "# Handoff\n## Next steps\n1. Do the thing\n2. Then the other thing with password: hunter2hunter2\n" + Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n") + "\n## Waiting on Ivan\nnothing\n");
  put(join(root2, "DECISIONS.md"), `# Decisions\n## D2 - Plain   [open]\n**Question:** Which one?\n`);
  // saved chats for Alpha
  const base = join(tmp, "chats"); const encA = encode(root3);
  const SID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", SID2 = "99887766-aaaa-bbbb-cccc-111122223333";
  const row = (type, text, at) => JSON.stringify({ type, timestamp: at, message: { content: type === "assistant" ? [{ type: "text", text }] : text } });
  put(join(base, encA, SID + ".jsonl"), [row("user", "hi", "2026-11-20T10:00:00Z"), row("assistant", "First answer", "2026-11-20T10:01:00Z"), row("assistant", "Last answer with api_key=supersecret99 inside " + "z".repeat(2000), "2026-11-20T10:02:00Z")].join("\n") + "\n");
  put(join(base, encA, SID2 + ".jsonl"), [row("user", "q", "2026-11-20T09:00:00Z"), row("assistant", "App chat said this", "2026-11-20T09:01:00Z")].join("\n") + "\n");
  put(join(base, "other-project", SID + ".jsonl"), row("assistant", "WRONG", "2026-11-20T11:00:00Z") + "\n");
  const t = (m) => new Date(Date.parse("2026-11-20T12:00:00Z") - m * 60000).toISOString();
  const group = { project: "Alpha", chats: [
    { id: "h-1", kind: "hub", name: "Hub chat", state: "idle", needsYou: false, why: "", snippet: "", remoteControl: false, since: t(60), lastActive: t(5), canAnswer: true, openLink: "claude://resume?session=" + SID, lastReply: "fallback" },
    { id: "s-99887766", kind: "app", name: "App chat", state: "closed", needsYou: true, why: "question", snippet: "Which?", remoteControl: true, since: t(90), lastActive: t(50), canAnswer: false, openLink: "claude://claude.ai/epitaxy/local_x1234567", lastReply: "" },
    { id: "s-deadbeef", kind: "terminal", name: "Term", state: "idle", needsYou: false, why: "", snippet: "", remoteControl: null, since: null, lastActive: t(1), canAnswer: false, openLink: null, lastReply: "" },
  ] };
  const card = { name: "Alpha", phase: { number: 2, title: "T", of: 5 }, percent: 40, stepsDone: 4, stepsTotal: 10, nextStep: "2.1 Go", handoffDaysOld: 1, lastCommit: "2026-11-19" };

  const page = await buildProjectPage({ name: "Alpha", card, root: root3, chatGroup: group, hubChats: [{ id: "h-1", sessionId: SID }], redact, chatsBase: base });
  const d = page.decisions;
  check("v3: only open and proposed decisions (decided D1 left out), file order", d.map((x) => x.id).join() === "D3,D5,D6", d.map((x) => x.id).join());
  check("status open / proposed", d[0].status === "open" && d[1].status === "proposed");
  check("question, owner's words, date, recommendation parsed", d[0].question === "Which voice should it use?" && d[0].ownerSaid.includes("let me hear them") && d[0].date === "2026-11-02" && d[0].recommendation.startsWith("C,"));
  check("options A/B/C parsed", d[0].options.length === 3 && d[0].options[0].key === "A" && d[0].options[0].text.startsWith("Film voice") && d[0].options[2].text === "Try both.");
  check("proposed: date from the heading note; 'not answered yet' = no owner's words", d[1].date === "2026-11-03" && d[1].ownerSaid === "");
  check("long text clipped to about 600 characters", d[1].question.length <= 600 && d[1].question.endsWith("…"));
  check("secret-looking text redacted in decisions", !JSON.stringify(d[2]).includes("abcdef1234567890") && !JSON.stringify(d[2]).includes("sk-a1") && d[2].question.includes("[hidden]"));
  // an open chat that is waiting for the person (live state "waiting") passes through whole and sorts first
  { const pw = await buildProjectPage({ name: "Alpha", card, root: root3, chatGroup: { project: "Alpha", chats: [{ id: "s-aaaaaaaa", kind: "app", name: "Waits", state: "waiting", needsYou: true, why: "question", snippet: "", lastActive: t(1), canAnswer: false, openLink: null }, { id: "s-bbbbbbbb", kind: "app", name: "Quiet", state: "idle", needsYou: false, lastActive: t(0), canAnswer: false }] }, hubChats: [], redact, chatsBase: base });
    check("waiting state passes through: needs you, why question, listed first", pw.chats[0].id === "s-aaaaaaaa" && pw.chats[0].state === "waiting" && pw.chats[0].needsYou === true && pw.chats[0].why === "question" && pw.chats[1].state === "idle"); }
  const page2 = await buildProjectPage({ name: "Beta", card: { name: "Beta" }, root: root2, chatGroup: undefined, hubChats: [], redact, chatsBase: base });
  check("v2 layout (DECISIONS.md in the root) works, no handoff, no chats", page2.decisions.length === 1 && page2.decisions[0].id === "D2" && page2.handoff === null && page2.chats.length === 0);
  const many = Array.from({ length: 30 }, (_, i) => `## D${100 + i} — N${i}   [open]\n**Question:** q${i}\n`).join("\n");
  put(join(tmp, "Gamma", "DECISIONS.md"), many);
  check("at most 20 decisions", (await buildProjectPage({ name: "Gamma", card: { name: "Gamma" }, root: join(tmp, "Gamma"), redact, chatsBase: base })).decisions.length === 20);
  check("handoff: first 40 lines of Next steps only, secret redacted, section after it left out", (() => { const h = page.handoff.nextSteps; return h.split("\n").length <= 40 && h.startsWith("1. Do the thing") && !h.includes("hunter2hunter2") && !h.includes("Waiting on Ivan") && !h.includes("line 59"); })());
  check("project card fields passed through", page.project.name === "Alpha" && page.project.percent === 40 && typeof page.generatedAt === "string" && page.demo === false);
  check("project page keeps Remote Control null for a chat that does not know it (terminal), and false/true", page.chats.find((c) => c.id === "s-deadbeef").remoteControl === null && page.chats.find((c) => c.id === "h-1").remoteControl === false && page.chats.find((c) => c.id === "s-99887766").remoteControl === true);
  check("chats: needs-you first, then newest", page.chats.map((c) => c.id).join() === "s-99887766,s-deadbeef,h-1", page.chats.map((c) => c.id).join());
  const hubC = page.chats.find((c) => c.id === "h-1"), appC = page.chats.find((c) => c.id === "s-99887766"), noC = page.chats.find((c) => c.id === "s-deadbeef");
  check("chat fields", hubC.kind === "hub" && hubC.title === "Hub chat" && hubC.openLink === "claude://resume?session=" + SID && hubC.canAnswer === true && hubC.remoteControl === false && appC.needsYou && appC.why === "question" && appC.remoteControl === true);
  check("lastSaid of a Hub chat = last assistant message from its saved file (by session id), redacted, clipped to 1400", hubC.lastSaid.startsWith("Last answer with") && !hubC.lastSaid.includes("supersecret99") && hubC.lastSaid.length <= 1400 && hubC.lastSaidAt === "2026-11-20T10:02:00Z");
  check("lastSaid of an app chat found by its id prefix", appC.lastSaid === "App chat said this");
  check("chat without a saved file: empty lastSaid, no crash; other projects' files never used", noC.lastSaid === "" && !JSON.stringify(page).includes("WRONG"));
  const manyChats = { project: "Alpha", chats: Array.from({ length: 40 }, (_, i) => ({ id: "s-0000000" + (i % 10), kind: "app", name: "c" + i, state: "closed", needsYou: false, lastActive: t(i) })) };
  check("at most 30 chats", (await buildProjectPage({ name: "Alpha", card, root: root3, chatGroup: manyChats, redact, chatsBase: base })).chats.length === 30);
  check("a project with no folder still answers (empty lists)", (await buildProjectPage({ name: "X", card: { name: "X" }, root: null, chatGroup: undefined, redact })).decisions.length === 0);

  // names and paths
  const known = ["Alpha", "Beta", "Clip Studio"];
  check("resolveName: known names accepted exactly", resolveName("Alpha", known) === "Alpha" && resolveName("Clip Studio", known) === "Clip Studio");
  check("resolveName: unknown, wrong case, empty, non-string, too long refused", [resolveName("alpha", known), resolveName("Nope", known), resolveName("", known), resolveName(undefined, known), resolveName(["Alpha"], known), resolveName("A".repeat(500), known)].every((x) => x === null));
  check("resolveName: path tricks refused", ["..\\..\\Windows", "../..", "Alpha/..", "Alpha\\", "C:\\Windows", "Alpha\0", "%2e%2e"].every((n) => resolveName(n, known) === null));
  check("projectRoot: known name -> folder; unknown or path-like -> null (no path built from the query)", await (async () => {
    const r = await projectRoot("Alpha", { known: ["Alpha"], busnusDir: tmp, registry: [] });
    return r === join(tmp, "Alpha") && (await projectRoot("..\\..\\Windows", { known: ["..\\..\\Windows"], busnusDir: tmp, registry: [] })) === null
      && (await projectRoot("Nope", { known, busnusDir: tmp, registry: [] })) === null && (await projectRoot("Beta", { known: ["Alpha"], busnusDir: tmp, registry: [] })) === null && (await projectRoot("..", { known: [".."], busnusDir: tmp, registry: [] })) === null;
  })());
  check("projectRoot: a registered home wins", (await projectRoot("Alpha", { known: ["Alpha"], busnusDir: tmp, registry: [{ name: "Alpha", home: root2 }] })) === resolve(root2));

  // 17.5: canAnswerApp only for a closed app chat with Remote Control off and a real app link
  check("canAnswerApp: closed app chat, Remote Control off -> true; Remote Control on, open, Hub, terminal -> false", (() => {
    const base = { kind: "app", state: "closed", remoteControl: false, openLink: "claude://claude.ai/epitaxy/local_0bac1d2e-0001" };
    return canAnswerApp(base) === true && canAnswerApp({ ...base, remoteControl: true }) === false && canAnswerApp({ ...base, remoteControl: null }) === false
      && canAnswerApp({ ...base, state: "idle" }) === false && canAnswerApp({ ...base, state: "working" }) === false && canAnswerApp({ ...base, kind: "hub" }) === false
      && canAnswerApp({ ...base, kind: "terminal" }) === false && canAnswerApp({ ...base, openLink: null }) === false && canAnswerApp({ ...base, openLink: "claude://claude.ai/epitaxy/local_x1234567" }) === false && canAnswerApp({ ...base, openLink: "claude://resume?session=x" }) === false;
  })());
  check("canAnswerApp in the page: the closed app chat with Remote Control on gets false; every chat has the field", page.chats.every((c) => typeof c.canAnswerApp === "boolean") && appC.canAnswerApp === false && hubC.canAnswerApp === false);
  { const g2 = { project: "Alpha", chats: [{ ...group.chats[1], remoteControl: false, openLink: "claude://claude.ai/epitaxy/local_0bac1d2e-0001" }] };
    const p3 = await buildProjectPage({ name: "Alpha", card, root: root3, chatGroup: g2, hubChats: [], redact, chatsBase: base });
    check("canAnswerApp in the page: closed app chat with Remote Control off -> true", p3.chats[0].canAnswerApp === true); }

  // demo shape
  const dj = { projects: { Alpha: { decisions: [{ id: "D1", title: "t", status: "open", question: "q", options: [], ownerSaid: "", recommendation: "", date: null }], lastSaid: { "h-1": { text: "Demo said", agoMinutes: 3 } }, handoff: "1. Demo step" } } };
  const dp = demoPage({ card, chatGroup: group, demoJson: dj, now: Date.parse("2026-11-20T12:00:00Z") });
  check("demoPage: same shape, minutes-ago turned into times, unknown project gets empty lists", dp.demo === true && dp.decisions.length === 1 && dp.chats.find((c) => c.id === "h-1").lastSaid === "Demo said" && dp.chats.find((c) => c.id === "h-1").lastSaidAt === "2026-11-20T11:57:00.000Z" && dp.handoff.nextSteps === "1. Demo step" && dp.chats.every((c) => typeof c.canAnswerApp === "boolean") && demoPage({ card: { name: "Q" }, chatGroup: undefined, demoJson: dj }).chats.length === 0);

  // read-only: the module has no write calls
  const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("// ---------- self-test")[0];
  check("module source contains no file write or process start", !/writeFile|appendFile|mkdirSync|rmSync|unlinkSync|renameSync|child_process|spawn\(|execFile/.test(src));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${ok}/${total}`);
  process.exit(ok === total ? 0 : 1);
}
