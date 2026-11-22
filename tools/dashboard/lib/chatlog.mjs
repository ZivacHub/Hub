// Chat log feed (Phase 19, "Claude inside the Hub"). READ-ONLY: reads saved chat files, never writes, never starts Claude.
// GET /api/chat-log?id=<chat id>[&before=<index>][&limit=<n>] -> the conversation of one chat + how full it is + meta.
// Shape and the context-window table: docs/plan/phases/19-claude-in-the-hub.md.
//   node tools/dashboard/lib/chatlog.mjs --selftest
// Safety: the id from the query is only checked against a pattern and then COMPARED with the ids of the live chat list (lib/chatlist.mjs);
// the saved file is then found from the Hub's own records (Hub chat session id, the app's records) in that project's saved-chat folders.
// Nothing from the query ever becomes part of a file path. The only process started is `git rev-parse` (read-only, no shell, 3 s limit).
import { readdirSync, statSync, openSync, readSync, closeSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, "..", "..", "..", "..");      // the BUSNUS folder (same as chatlist.mjs)
const CHATS_BASE = join(homedir(), ".claude", "projects");

export const LIMITS = { text: 20000, output: 1500, summary: 200, defaultMessages: 200, maxMessages: 400, outputs: 50, readBytes: 64 * 1024 * 1024 };

// ---------- how big the context window is, per model (ONE place; documented in the phase 19 file) ----------
// Checked 2026-11-21 against the claude-api reference (model table) and the app's own number (get_usage: contextWindow 1,000,000 for Sonnet 5.5).
// First match wins. A "[1m]" suffix always means 1,000,000.
export const CONTEXT_WINDOWS = [
  { match: /\[1m\]/i, tokens: 1_000_000, note: "[1m] model" },
  { match: /fable|mythos/i, tokens: 1_000_000, note: "Fable / Mythos" },
  { match: /opus-5|opus-4-[678]\b/i, tokens: 1_000_000, note: "Opus 5.x, Opus 4.6-4.8" },
  { match: /sonnet-5|sonnet-4-6\b/i, tokens: 1_000_000, note: "Sonnet 5.x, Sonnet 4.6" },
  { match: /haiku-5/i, tokens: 1_000_000, note: "Haiku 5.x" },
  { match: /^(opus|sonnet|haiku|fable)$/i, tokens: 1_000_000, note: "short name = current model" },
  { match: /haiku-4-5|sonnet-4-5|opus-4-5|opus-4-1|opus-4-0|sonnet-4-0|claude-(opus|sonnet)-4$|claude-3/i, tokens: 200_000, note: "older models" },
];
export const DEFAULT_WINDOW = 200_000; // an unknown model: the smallest window (so the bar never looks emptier than it is)

/** { tokens, known } for a model id. */
export function windowFor(model) {
  const m = String(model || "");
  const hit = m ? CONTEXT_WINDOWS.find((w) => w.match.test(m)) : null;
  return hit ? { tokens: hit.tokens, known: true } : { tokens: DEFAULT_WINDOW, known: false };
}

// ---------- small helpers ----------
const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const ID_RE = /^(h-[A-Za-z0-9-]{1,60}|s-[0-9a-fA-F-]{8}|local_[0-9a-f-]{8,64})$/i;
const SESSION_ID = /^[0-9a-fA-F-]{8,64}$/;
const APP_LINK = "claude://claude.ai/epitaxy/";
const encode = (p) => String(p).replace(/[^A-Za-z0-9]/g, "-");
const normP = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
const lc = (s) => s.toLowerCase();

/** A path as the page may show it: relative to cwd when inside it; otherwise only "…/<folder>/<file>" (outside: true). */
export function shownPath(p, cwd) {
  const f = normP(p); if (!f) return { path: "", outside: false };
  const c = normP(cwd);
  if (c && (lc(f) === lc(c) || lc(f).startsWith(lc(c) + "/"))) return { path: f.slice(c.length + 1) || ".", outside: false };
  if (!/^([A-Za-z]:\/|\/)/.test(f)) return { path: f, outside: false }; // already relative
  const parts = f.split("/").filter(Boolean);
  return { path: "…/" + parts.slice(-2).join("/"), outside: true };
}

// Wrapper tags that are the app's or a hook's words, not Ivan's. Removed with their content.
const HIDDEN_TAGS = ["system-reminder", "local-command-stdout", "local-command-stderr", "local-command-caveat", "ide_opened_file", "ide_selection", "ide_diagnostics",
  "task-notification", "user-prompt-submit-hook", "bash-stdout", "bash-stderr", "command-stdout"];
const HIDDEN_RE = new RegExp(`<(${HIDDEN_TAGS.join("|")})\\b[^>]*>[\\s\\S]*?(?:</\\1>|$)`, "g");

/** What Ivan actually typed in one user text: slash commands folded to "/name args", injected reminders and "[BUSNUS ...]" lines removed. */
export function cleanUserText(t) {
  let s = String(t ?? "");
  const cmd = /<command-name>([\s\S]*?)<\/command-name>/.exec(s);
  if (cmd) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(s)?.[1]?.trim() || "";
    const name = cmd[1].trim();
    return ((name.startsWith("/") ? name : "/" + name) + (args ? " " + args : "")).trim();
  }
  s = s.replace(HIDDEN_RE, "").replace(/<\/?(command-message|command-args)>/g, "");
  s = s.split("\n").filter((l) => !/^\s*\[BUSNUS[^\]]*\]/.test(l)).join("\n");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

function toolSummary(name, input, cwd) {
  const n = String(name || "tool"); const i = input && typeof input === "object" ? input : {};
  const p = (x) => shownPath(x, cwd).path;
  let s;
  if (["Write", "Edit", "MultiEdit", "Read", "NotebookEdit"].includes(n)) s = `${n} ${p(i.file_path || i.notebook_path || "")}`;
  else if (n === "Bash" || n === "PowerShell") s = `${n}: ${oneLine(i.command)}`;
  else if (n === "Grep") s = `Grep: ${oneLine(i.pattern)}${i.path ? " in " + p(i.path) : ""}`;
  else if (n === "Glob") s = `Glob: ${oneLine(i.pattern)}`;
  else if (n === "WebFetch") s = `WebFetch: ${oneLine(i.url)}`;
  else if (n === "WebSearch") s = `WebSearch: ${oneLine(i.query)}`;
  else if (n === "Agent" || n === "Task") s = `${n}: ${oneLine(i.description || i.subagent_type || "")}`;
  else if (n === "Skill") s = `Skill: ${oneLine(i.skill || i.command || "")}`;
  else if (n === "TodoWrite") s = "Update the task list";
  else {
    const short = n.startsWith("mcp__") ? n.split("__").slice(2).join("__") || n : n;
    const first = Object.values(i).find((v) => typeof v === "string" && v.trim());
    s = first ? `${short}: ${oneLine(first)}` : short;
  }
  return s.trim();
}

function resultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (b && b.type === "text" ? String(b.text ?? "") : b && b.type === "image" ? (imageData(b) ? "" : "[image]") : b && b.type === "tool_reference" ? `[tool loaded: ${b.tool_name || b.name || "?"}]` : "")).filter(Boolean).join("\n");
}

// ---------- pictures and files (Phase 19, docs/plan/phases/19-pictures-pins.md) ----------
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
/** { data, mediaType } of a picture block ({source:{data,media_type}} or an attachment's {file:{base64,type}}), or null when the data is missing. */
export function imageData(b) {
  if (!b || typeof b !== "object") return null;
  const src = b.source && typeof b.source === "object" ? { data: b.source.data, mediaType: b.source.media_type } : b.file && typeof b.file === "object" ? { data: b.file.base64, mediaType: b.file.type } : null;
  if (!src || typeof src.data !== "string" || !src.data) return null;
  return { data: src.data, mediaType: String(src.mediaType || "").toLowerCase() };
}
const b64Bytes = (s) => Math.max(0, Math.floor((s.length * 3) / 4) - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0));
const baseName = (p) => { const x = normP(p).split("/").filter(Boolean); return x.length ? x[x.length - 1] : ""; };
/** The block the feed shows for a picture; `_src` says where the data lives (removed when m and b are known). null = no usable picture. */
function imageBlock(b, path, line, name, red) {
  const d = imageData(b);
  if (!d || !IMAGE_TYPES.includes(d.mediaType)) return null;
  const out = { type: "image", mediaType: d.mediaType, bytes: b64Bytes(d.data) };
  const n = name ? red(baseName(name), 120) : ""; if (n) out.name = n;
  out._src = { line, path };
  return out;
}
function fileBlock(mediaType, bytes, name, red) {
  const out = { type: "file", mediaType: /^[a-z]+\/[a-z0-9.+-]{1,60}$/i.test(String(mediaType || "")) ? String(mediaType).toLowerCase() : "application/octet-stream", bytes: bytes || 0 };
  const n = name ? red(baseName(name), 120) : ""; if (n) out.name = n;
  return out;
}


// ---------- question cards (AskUserQuestion and the Hub's wrap_up tool) ----------
export const QUESTION_LIMITS = { questions: 6, options: 12, question: 600, header: 80, label: 200, description: 400, recap: 1200, answer: 300 };
const isQuestionTool = (n) => { n = String(n || ""); return n === "AskUserQuestion" ? "AskUserQuestion" : n === "wrap_up" || /__wrap_up$/.test(n) ? "wrap_up" : null; };
/** The block for a question tool call, or null when the input is unusable (then the normal tool fold is shown). Pure.
 *  answered: true + answer (AskUserQuestion with a result text) / false (no result yet) / null (unknown: the user declined, or wrap_up, whose result is only a note, not the answer). */
function questionBlock(source, input, res, red) {
  const i = input && typeof input === "object" ? input : {};
  const Q = QUESTION_LIMITS;
  const out = { type: "question", source, questions: [] };
  if (source === "AskUserQuestion") {
    const qs = Array.isArray(i.questions) ? i.questions : [];
    for (const q of qs.slice(0, Q.questions)) {
      if (!q || typeof q !== "object" || typeof q.question !== "string" || !q.question.trim()) continue;
      const item = { question: red(q.question, Q.question) };
      if (typeof q.header === "string" && q.header.trim()) item.header = red(q.header, Q.header);
      if (q.multiSelect === true) item.multiSelect = true;
      item.options = (Array.isArray(q.options) ? q.options : []).slice(0, Q.options).filter((o) => o && typeof o === "object" && typeof o.label === "string" && o.label.trim())
        .map((o) => { const x = { label: red(o.label, Q.label) }; if (typeof o.description === "string" && o.description.trim()) x.description = red(o.description, Q.description); return x; });
      out.questions.push(item);
    }
    if (!out.questions.length) return null;
  } else {
    const ask = typeof i.ask === "string" ? i.ask.trim() : "";
    const recap = typeof i.recap === "string" ? i.recap.trim() : "";
    if (!ask && !recap) return null;
    if (recap) out.recap = red(recap, Q.recap);
    if (ask) out.questions.push({ question: red(ask, Q.question), options: (Array.isArray(i.actions) ? i.actions : []).slice(0, Q.options).filter((a) => a && typeof a === "object" && typeof a.label === "string" && a.label.trim()).map((a) => ({ label: red(a.label, Q.label) })) });
  }
  if (!res) out.answered = false;
  else if (source === "wrap_up" || res.is_error === true) out.answered = null;
  else {
    const t = cleanUserText(resultText(res.content)) || resultText(res.content).trim();
    if (t) { out.answered = true; out.answer = red(t, Q.answer); } else out.answered = null;
  }
  return out;
}

const usageTokens = (u) => (u ? (Number(u.input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) : null);

// ---------- parse one saved chat file (pure: takes the text) ----------
/**
 * text = the jsonl text. Returns { messages, context, file: { cwd, model, permissionMode, title, firstAt, lastAt, compactions, badLines }, outputs }.
 * messages = every shown message, oldest first, each with its index `i`. Redaction and clipping happen here.
 */
export function parseChat(text, { redact = (s) => String(s ?? ""), cwdHint = "" } = {}) {
  const rows = []; const lineOf = new Map(); let badLines = 0;
  const rawLines = String(text ?? "").split("\n");
  for (let n = 0; n < rawLines.length; n++) {
    const line = rawLines[n];
    if (!line.trim()) continue;
    try { const j = JSON.parse(line); if (j && typeof j === "object" && !Array.isArray(j)) { rows.push(j); lineOf.set(j, n); } else badLines++; } catch { badLines++; }
  }
  const main = (r) => r.isSidechain !== true;
  let cwd = cwdHint || "", model = null, permissionMode = null, title = null, firstAt = null, lastAt = null;
  for (const r of rows) {
    if (r.type === "custom-title" && r.customTitle) title = String(r.customTitle);
    if (!main(r) || (r.type !== "user" && r.type !== "assistant")) continue;
    if (r.cwd) cwd = String(r.cwd);
    if (r.timestamp) { firstAt ??= r.timestamp; lastAt = r.timestamp; }
    if (r.type === "user" && r.permissionMode) permissionMode = String(r.permissionMode);
    if (r.type === "assistant" && r.message?.model && r.message.model !== "<synthetic>") model = String(r.message.model);
  }
  // tool results by tool_use_id (main chain only)
  const results = new Map();
  for (const r of rows) {
    if (r.type !== "user" || !main(r) || !Array.isArray(r.message?.content)) continue;
    r.message.content.forEach((b, bi) => { if (b && b.type === "tool_result" && b.tool_use_id) results.set(String(b.tool_use_id), { ...b, _line: lineOf.get(r), _bi: bi }); });
  }
  const red = (s, n) => clip(redact(String(s ?? "")), n);
  const messages = []; const outputs = [];
  let lastUsage = null, afterUsage = false, compactions = 0, lastCompact = null, lastUser = null;
  for (const r of rows) {
    if (!main(r)) continue;
    if (r.type === "attachment" && lastUser && r.attachment && r.attachment.type === "file" && r.attachment.content && typeof r.attachment.content === "object") {
      // "@path" in Ivan's text: the saved file has a separate line right after his message; it belongs to that message
      const at = r.attachment, c = at.content, nm = at.displayPath || at.filename || "";
      if (c.type === "image") { const ib = imageBlock(c, ["attachment", "content"], lineOf.get(r), nm, red); if (ib) lastUser.blocks.push(ib); }
      else if (c.type === "pdf") lastUser.blocks.push(fileBlock("application/pdf", Number(c.file && c.file.originalSize) || 0, nm, red));
      continue;
    }
    if (r.type === "system" && r.subtype === "compact_boundary") { compactions++; lastCompact = { at: r.timestamp || null, postTokens: Number(r.compactMetadata?.postTokens) || null }; afterUsage = true; continue; }
    if (r.type === "assistant") {
      const msg = r.message || {};
      const content = Array.isArray(msg.content) ? msg.content : typeof msg.content === "string" ? [{ type: "text", text: msg.content }] : [];
      if (msg.usage && msg.model !== "<synthetic>") { lastUsage = { usage: msg.usage, model: msg.model, at: r.timestamp || null }; afterUsage = false; lastCompact = null; }
      const blocks = [];
      for (const b of content) {
        if (!b || typeof b !== "object") continue;
        if (b.type === "text") { const t = String(b.text ?? ""); if (t.trim()) blocks.push({ type: "text", text: red(t, LIMITS.text) }); }
        else if (b.type === "tool_use") {
          const res = results.get(String(b.id));
          const qsrc = isQuestionTool(b.name);
          if (qsrc) { const qb = questionBlock(qsrc, b.input, res, red); if (qb) { blocks.push(qb); continue; } } // the question card replaces the tool fold
          const status = res ? (res.is_error === true ? "error" : "ok") : "unknown";
          const out = res ? cleanUserText(resultText(res.content)) || resultText(res.content).trim() : "";
          blocks.push({ type: "tool", name: String(b.name || "tool"), summary: red(toolSummary(b.name, b.input, cwd), LIMITS.summary), status, output: red(out, LIMITS.output) });
          if (res && Array.isArray(res.content)) {
            const nm = b.name === "Read" && b.input ? b.input.file_path : "";
            res.content.forEach((x, k) => { if (x && x.type === "image") { const ib = imageBlock(x, ["message", "content", res._bi, "content", k], res._line, nm, red); if (ib) blocks.push(ib); } });
          }
          const fp = b.input && (b.input.file_path || b.input.notebook_path);
          if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(b.name) && typeof fp === "string" && fp && status !== "error") outputs.push({ raw: fp, tool: b.name, at: r.timestamp || null });
        }
        // thinking / redacted_thinking: never shown
      }
      lastUser = null;
      if (!blocks.length) continue;
      const prev = messages[messages.length - 1];
      if (prev && prev.role === "assistant" && msg.id && prev._mid === msg.id) prev.blocks.push(...blocks);
      else messages.push({ role: "assistant", at: r.timestamp || null, blocks, _mid: msg.id || null });
      continue;
    }
    if (r.type === "user") {
      if (lastUsage) afterUsage = true;
      if (r.isMeta === true || r.isCompactSummary === true || r.isVisibleInTranscriptOnly === true) continue;
      const c = r.message?.content;
      const parts = typeof c === "string" ? [{ type: "text", text: c }] : Array.isArray(c) ? c : [];
      const blocks = [];
      parts.forEach((b, bi) => {
        if (!b) return;
        if (b.type === "text") { const t = cleanUserText(b.text); if (t) blocks.push({ type: "text", text: red(t, LIMITS.text) }); }
        else if (b.type === "image") blocks.push(imageBlock(b, ["message", "content", bi], lineOf.get(r), "", red) || { type: "text", text: "[image]" });
        else if (b.type === "document") {
          const d = b.source && typeof b.source === "object" ? b.source : {};
          blocks.push(fileBlock(d.media_type || (d.type === "text" ? "text/plain" : ""), typeof d.data === "string" ? (d.type === "text" ? d.data.length : b64Bytes(d.data)) : 0, typeof b.title === "string" ? b.title : "", red));
        }
      });
      lastUser = null;
      if (blocks.length) { const msg = { role: "user", at: r.timestamp || null, blocks }; messages.push(msg); lastUser = msg; }
    }
  }
  const blockSources = new Map(); // "m:b" -> { line, path }: where the picture data sits in the file (chatimage.mjs reads it)
  messages.forEach((m, i) => {
    m.i = i; delete m._mid;
    m.blocks.forEach((b, j) => { if (b._src) { blockSources.set(i + ":" + j, b._src); delete b._src; } if (b.type === "image" || b.type === "file") { b.m = i; b.b = j; } });
  });

  // how full the chat is now
  let context;
  const win = windowFor(lastUsage?.model || model);
  if (lastCompact && lastCompact.postTokens) {
    context = { usedTokens: lastCompact.postTokens, windowTokens: win.tokens, estimated: true, basis: "compacted after the last reply: the size the compaction left" };
  } else if (lastUsage) {
    const used = usageTokens(lastUsage.usage);
    context = { usedTokens: used, windowTokens: win.tokens, estimated: afterUsage || !win.known,
      basis: afterUsage ? "last reply's size; newer messages since then are not counted yet" : "last reply's size (input + cache read + cache write tokens)" };
  } else context = { usedTokens: null, windowTokens: win.tokens, estimated: true, basis: "no reply yet" };
  if (context.usedTokens != null && context.usedTokens > context.windowTokens) { context.windowTokens = 1_000_000; context.estimated = true; context.basis += "; bigger than the known window, so 1,000,000 assumed"; }
  context.percent = context.usedTokens == null ? null : Math.round((context.usedTokens / context.windowTokens) * 100);
  if (!win.known) context.basis += "; unknown model, window guessed";

  // files this chat wrote or changed: newest first, unique, at most 50
  const seen = new Set(); const outs = [];
  for (const o of outputs.slice().reverse()) {
    const k = lc(normP(o.raw)); if (seen.has(k)) continue; seen.add(k);
    const sp = shownPath(o.raw, cwd);
    outs.push({ path: red(sp.path, 400), outside: sp.outside, tool: o.tool, at: o.at });
    if (outs.length >= LIMITS.outputs) break;
  }
  return { messages, context, outputs: outs, blockSources, file: { cwd, model, permissionMode, title, firstAt, lastAt, compactions, badLines } };
}

// ---------- reading the real file (read-only, cached per file) ----------
const parseCache = new Map(); // file -> { m, size, parsed }
function readText(file) {
  const size = statSync(file).size; const len = Math.min(size, LIMITS.readBytes);
  const buf = Buffer.alloc(len); const fd = openSync(file, "r");
  try { readSync(fd, buf, 0, len, size - len); } finally { closeSync(fd); }
  let t = buf.toString("utf8");
  if (size > len) t = t.slice(t.indexOf("\n") + 1); // the cut first line
  return { text: t, cut: size > len };
}
export function parseFile(file, opts = {}) {
  const st = statSync(file);
  const hit = parseCache.get(file);
  if (hit && hit.m === st.mtimeMs && hit.size === st.size && hit.redact === opts.redact) return hit.parsed;
  const { text, cut } = readText(file);
  const parsed = parseChat(text, opts); parsed.file.cut = cut;
  parseCache.set(file, { m: st.mtimeMs, size: st.size, redact: opts.redact, parsed });
  if (parseCache.size > 4) parseCache.delete(parseCache.keys().next().value);
  return parsed;
}

// Where is picture m:b? Own small cache (only the places, never the picture data); the redaction setting does not matter here.
const sourceCache = new Map(); // file -> { m, size, sources }
/** { line, path } of the picture/file block `m`:`b` in a saved chat file (same message and block numbers as the feed), or null. Read-only. */
export function blockSourceOf(file, m, b) {
  try {
    const st = statSync(file);
    let hit = sourceCache.get(file);
    if (!hit || hit.m !== st.mtimeMs || hit.size !== st.size) {
      const { text } = readText(file);
      hit = { m: st.mtimeMs, size: st.size, sources: parseChat(text).blockSources };
      sourceCache.set(file, hit);
      if (sourceCache.size > 4) sourceCache.delete(sourceCache.keys().next().value);
    }
    return hit.sources.get(m + ":" + b) || null;
  } catch { return null; }
}
/** The parsed JSON of line number `line` (0-based, counted like parseChat does) of a saved chat file, or null. */
export function readLineAt(file, line) {
  try {
    const { text } = readText(file);
    let from = 0;
    for (let n = 0; n < line; n++) { const k = text.indexOf("\n", from); if (k < 0) return null; from = k + 1; }
    let to = text.indexOf("\n", from); if (to < 0) to = text.length;
    const j = JSON.parse(text.slice(from, to));
    return j && typeof j === "object" ? j : null;
  } catch { return null; }
}

/** The saved chat file of a chat id (same lookup as the feed: only through the chat list), or null. For the picture route. */
export function resolveChatFile(id, opts = {}) {
  const hit = resolveChat(id, opts);
  return hit && hit.file ? hit.file : null;
}

/** Saved chat files of one project folder (and its sub-folders' chats): [{ name, file, m }] newest first. Same rule as projectpage.mjs. */
export function chatFiles(projectDir, base = CHATS_BASE) {
  const enc = encode(projectDir); const out = [];
  let folders = []; try { folders = readdirSync(base); } catch { return out; }
  for (const f of folders.filter((f) => f === enc || f.startsWith(enc + "-"))) {
    const dir = join(base, f); let names = []; try { names = readdirSync(dir).filter((n) => n.endsWith(".jsonl")); } catch { continue; }
    for (const n of names) { try { out.push({ name: n.slice(0, -6), file: join(dir, n), m: statSync(join(dir, n)).mtimeMs }); } catch { /* skip */ } }
  }
  return out.sort((a, b) => b.m - a.m);
}

/** Current git branch of a folder, or null (read-only `git rev-parse --abbrev-ref HEAD`, no shell, 3 s). */
export function gitBranch(dir) {
  return new Promise((res) => {
    try {
      if (!dir || !existsSync(dir)) return res(null);
      execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir, timeout: 3000, windowsHide: true, shell: false, encoding: "utf8" }, (err, out) => {
        const b = String(out || "").trim();
        res(err || !b || b.length > 200 ? null : b);
      });
    } catch { res(null); }
  });
}

const projectOfCwd = (cwd, root) => {
  const r = lc(normP(root)), c = lc(normP(cwd));
  if (!r || !c.startsWith(r + "/")) return null;
  return normP(cwd).slice(normP(root).length + 1).split("/")[0] || null;
};

/**
 * Finds the chat and its saved file. Only through the lists: the id must be one of the chat list's ids (or, for local_..., an app chat's link).
 * chatList = the /api/chats answer; hubChats = the engine's list(); appRecords = chatlist.readAppRecords().
 * Returns null (unknown chat) or { project, chat, file (or null), appRecord, hubChat }.
 */
export function resolveChat(id, { chatList, hubChats = [], appRecords = [], root = DEFAULT_ROOT, chatsBase = CHATS_BASE } = {}) {
  if (typeof id !== "string" || !ID_RE.test(id)) return null;
  const groups = chatList && Array.isArray(chatList.projects) ? chatList.projects : [];
  let project = null, chat = null;
  const isApp = /^local_/i.test(id);
  for (const g of groups) for (const c of Array.isArray(g.chats) ? g.chats : []) {
    if (chat) break;
    if (isApp ? c && c.openLink === APP_LINK + id : c && c.id === id) { project = String(g.project || ""); chat = c; }
  }
  if (!chat || !project || /[\\/:]|^\.+$/.test(project)) return null;
  const dir = join(root, project);
  const recs = (Array.isArray(appRecords) ? appRecords : []).filter((r) => r && r.isArchived !== true && typeof r.cliSessionId === "string" && SESSION_ID.test(r.cliSessionId));
  let sid = null, appRecord = null, hubChat = null;
  if (chat.kind === "hub") {
    hubChat = (Array.isArray(hubChats) ? hubChats : []).find((h) => h && h.id === chat.id) || null;
    if (hubChat && typeof hubChat.sessionId === "string" && SESSION_ID.test(hubChat.sessionId)) sid = hubChat.sessionId;
  } else {
    const link = typeof chat.openLink === "string" && chat.openLink.startsWith(APP_LINK) ? chat.openLink.slice(APP_LINK.length) : null;
    appRecord = (link && recs.find((r) => r.sessionId === link)) || null;
    if (!appRecord && /^s-/.test(chat.id)) appRecord = recs.find((r) => lc(r.cliSessionId).startsWith(lc(chat.id.slice(2))) && projectOfCwd(r.cwd, root) === project) || null;
    if (appRecord) sid = appRecord.cliSessionId;
  }
  const files = existsSync(dir) ? chatFiles(dir, chatsBase) : [];
  let f = null;
  if (sid) f = files.find((x) => x.name === sid) || null;
  if (!f && !sid && /^s-[0-9a-fA-F-]{8}$/.test(chat.id)) f = files.find((x) => lc(x.name).startsWith(lc(chat.id.slice(2)))) || null; // a terminal chat: newest file with that start
  return { project, dir, chat, file: f ? f.file : null, appRecord, hubChat };
}

const intOr = (v, d) => { if (v === null || v === undefined || v === "") return d; const n = Number(v); return Number.isInteger(n) && n >= 0 ? n : d; };

/** Picks the page of messages: the last `limit` before index `before`. */
export function pageOf(messages, { before, limit } = {}) {
  const total = messages.length;
  const lim = Math.min(Math.max(intOr(limit, LIMITS.defaultMessages) || LIMITS.defaultMessages, 1), LIMITS.maxMessages);
  const end = Math.min(intOr(before, total), total);
  const start = Math.max(0, end - lim);
  return { messages: messages.slice(start, end), messagesTotal: total, hasMore: start > 0, firstIndex: start };
}

/** The whole answer for one id. Returns { status, body }. */
export async function readChatLog({ id, before, limit, chatList, hubChats = [], appRecords = [], redact = (s) => String(s ?? ""), root = DEFAULT_ROOT, chatsBase = CHATS_BASE, branchOf = gitBranch, now = Date.now() } = {}) {
  const hit = resolveChat(id, { chatList, hubChats, appRecords, root, chatsBase });
  if (!hit) return { status: 404, body: { error: "unknown chat" } };
  const { project, dir, chat, file, appRecord, hubChat } = hit;
  let parsed = null;
  if (file) { try { parsed = parseFile(file, { redact, cwdHint: (appRecord && appRecord.cwd) || dir }); } catch { parsed = null; } }
  const p = parsed || parseChat("", { redact, cwdHint: (appRecord && appRecord.cwd) || dir });
  const cwd = p.file.cwd || (appRecord && appRecord.cwd) || dir;
  const inProject = projectOfCwd(cwd, root) === project && existsSync(cwd);
  const branch = await branchOf(inProject ? cwd : dir);
  const page = pageOf(p.messages, { before, limit });
  const model = p.file.model || (appRecord && appRecord.model) || (hubChat && hubChat.model) || chat.model || null;
  if (!p.file.model && model) { const w = windowFor(model); p.context.windowTokens = w.tokens; }
  const meta = {
    cwd: redact(cwd), projectName: project, branch: branch ? redact(branch) : null, model,
    permissionMode: p.file.permissionMode || (appRecord && appRecord.permissionMode) || null,
    remoteControl: typeof chat.remoteControl === "boolean" ? chat.remoteControl : null,
    kind: chat.kind, state: chat.state, title: chat.name || p.file.title || null,
    startedAt: chat.since || p.file.firstAt || null, lastActive: p.file.lastAt && Date.parse(p.file.lastAt) > Date.parse(chat.lastActive || 0) ? p.file.lastAt : chat.lastActive || p.file.lastAt || null,
    compactions: p.file.compactions, savedFileFound: !!parsed, olderPartCut: parsed ? parsed.file.cut === true : false,
    outputs: p.outputs,
  };
  return { status: 200, body: { generatedAt: new Date(now).toISOString(), demo: false, id, chatId: chat.id, ...page, context: p.context, meta } };
}

/** --demo: demoJson = demo/chat-log.json ({ chats: { <id>: { context, meta, messages:[{role, agoMinutes, blocks}] } } }); chatList = the demo /api/chats answer. */
export function demoChatLog({ id, before, limit, demoJson, chatList, now = Date.now() } = {}) {
  if (typeof id !== "string" || !ID_RE.test(id)) return { status: 404, body: { error: "unknown chat" } };
  let project = null, chat = null;
  for (const g of (chatList && chatList.projects) || []) for (const c of g.chats || []) if (!chat && c.id === id) { project = g.project; chat = c; }
  if (!chat) return { status: 404, body: { error: "unknown chat" } };
  const d = (demoJson && demoJson.chats && demoJson.chats[id]) || {};
  const ago = (m) => (typeof m === "number" ? new Date(now - m * 60000).toISOString() : null);
  const msgs = (Array.isArray(d.messages) ? d.messages : []).map(({ agoMinutes, ...m }, i) => ({ ...m, at: ago(agoMinutes), i }));
  const page = pageOf(msgs, { before, limit });
  const ctx = d.context || { usedTokens: null, windowTokens: 1_000_000, estimated: true, basis: "no reply yet" };
  const outputs = (d.meta && Array.isArray(d.meta.outputs) ? d.meta.outputs : []).map(({ agoMinutes, ...o }) => ({ ...o, at: ago(agoMinutes) }));
  const meta = {
    cwd: `C:\\Users\\Sample\\Projects\\${project}`, projectName: project, branch: "main", model: chat.model || null, permissionMode: "default",
    ...(d.meta || {}), outputs,
    remoteControl: typeof chat.remoteControl === "boolean" ? chat.remoteControl : null, kind: chat.kind, state: chat.state, title: chat.name,
    startedAt: chat.since || null, lastActive: chat.lastActive || null, compactions: (d.meta && d.meta.compactions) || 0, savedFileFound: msgs.length > 0, olderPartCut: false,
  };
  return { status: 200, body: { generatedAt: new Date(now).toISOString(), demo: true, id, chatId: chat.id, ...page, context: { ...ctx, percent: ctx.usedTokens == null ? null : Math.round((ctx.usedTokens / ctx.windowTokens) * 100) }, meta } };
}

// ---------- self-test (fake files in a temp dir; nothing real is changed) ----------
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv.includes("--selftest")) {
  const fs = await import("node:fs"); const os = await import("node:os");
  const { redact } = await import("./data.mjs");
  let ok = 0, total = 0;
  const check = (n, c, x = "") => { total++; if (c) { ok++; console.log("OK   " + n); } else console.log("FAIL " + n + (x ? " " + x : "")); };
  const tmp = fs.mkdtempSync(join(os.tmpdir(), "hub-chatlog-"));
  const put = (p, t) => { fs.mkdirSync(dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
  const root = join(tmp, "BUSNUS"), proj = join(root, "Alpha"), base = join(tmp, "chats");
  fs.mkdirSync(join(proj, "sub"), { recursive: true });
  const T = (m) => new Date(Date.parse("2026-11-20T12:00:00Z") + m * 60000).toISOString();
  const U = (m, content, extra = {}) => ({ type: "user", timestamp: T(m), cwd: proj, permissionMode: "auto", isSidechain: false, message: { role: "user", content }, ...extra });
  const A = (m, id, content, extra = {}) => ({ type: "assistant", timestamp: T(m), cwd: proj, isSidechain: false, message: { id, model: "claude-sonnet-5-5", role: "assistant", content }, ...extra });
  const usage = { input_tokens: 2, cache_read_input_tokens: 270000, cache_creation_input_tokens: 7155, output_tokens: 400 };
  const SECRET = "sk-" + "Ab1".repeat(10);
  const rowsA = [
    { type: "custom-title", customTitle: "Alpha chat" },
    { type: "file-history-snapshot", snapshot: {} },
    U(0, "<command-message>pickup</command-message>\n<command-name>/pickup</command-name>\n<command-args>Alpha</command-args>"),
    U(1, "[BUSNUS project check] Alpha is set up.\nPlease build the page", { isMeta: true }),
    U(1, [{ type: "text", text: "<system-reminder>Hook said things</system-reminder>\nPlease build the page with key " + SECRET }]),
    A(2, "m1", [{ type: "thinking", thinking: "secret plan" }]),
    A(2, "m1", [{ type: "text", text: "## Plan\n- one\n- two\n```js\nx()\n```" }]),
    A(3, "m1", [{ type: "tool_use", id: "t1", name: "Write", input: { file_path: join(proj, "sub", "page.html"), content: "x" } }]),
    U(3, [{ type: "tool_result", tool_use_id: "t1", content: "File created" }]),
    A(4, "m2", [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "npm test\n--watch=false" } }]),
    U(4, [{ type: "tool_result", tool_use_id: "t2", is_error: true, content: [{ type: "text", text: "boom " + "e ".repeat(1500) }] }]),
    A(5, "m3", [{ type: "tool_use", id: "t3", name: "Edit", input: { file_path: join(proj, "sub", "page.html"), old_string: "a", new_string: "b" } }]),
    U(5, [{ type: "tool_result", tool_use_id: "t3", content: "ok" }]),
    A(5, "m3b", [{ type: "tool_use", id: "t4", name: "Edit", input: { file_path: "C:\\Elsewhere\\deep\\folder\\notes.md", old_string: "a", new_string: "b" } }]),
    U(5, [{ type: "tool_result", tool_use_id: "t4", content: "ok" }]),
    A(5, "m3c", [{ type: "tool_use", id: "t5", name: "Edit", input: { file_path: join(proj, "broken.js") } }]),
    U(5, [{ type: "tool_result", tool_use_id: "t5", is_error: true, content: "String not found" }]),
    A(6, "m4", [{ type: "tool_use", id: "t6", name: "mcp__ccd_session_mgmt__get_usage", input: { session_id: "self" } }]),
    A(7, "side", [{ type: "text", text: "SIDECHAIN TEXT" }], { isSidechain: true }),
    U(7, "SIDECHAIN USER", { isSidechain: true }),
    { type: "system", subtype: "stop_hook_summary", timestamp: T(8) },
    U(8, "Hello", { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
    U(8, "<task-notification><task-id>x</task-id></task-notification>"),
    U(9, "Huge: " + "h ".repeat(15000)),
    A(10, "m5", [{ type: "text", text: "Done. Which colour?" }], { message: { id: "m5", model: "claude-sonnet-5-5", usage, content: [{ type: "text", text: "Done. Which colour?" }] } }),
  ];
  const lines = rowsA.map((r) => JSON.stringify(r)); lines.splice(5, 0, "{not json", "", "[]");
  const SID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  put(join(base, encode(proj), SID + ".jsonl"), lines.join("\n") + "\n");
  const p = parseChat(lines.join("\n"), { redact, cwdHint: proj });
  const all = p.messages, txt = JSON.stringify(p);
  check("user / assistant messages in order, each with its index", all.every((m, i) => m.i === i && (m.role === "user" || m.role === "assistant")) && all[0].role === "user", all.map((m) => m.role).join());
  check("slash command folded to '/pickup Alpha'", all[0].blocks[0].text === "/pickup Alpha", all[0].blocks[0].text);
  check("meta lines, compaction summaries, task notifications and system reminders never shown as Ivan's words", !txt.includes("[BUSNUS project check]") && !txt.includes("Hook said things") && !txt.includes("task-id") && !all.some((m) => m.role === "user" && m.blocks.some((b) => b.text === "Hello")));
  check("Ivan's real words kept (reminder stripped), secret redacted", all[1].role === "user" && all[1].blocks[0].text.startsWith("Please build the page") && !txt.includes(SECRET) && all[1].blocks[0].text.includes("[hidden]"));
  check("thinking never shown; sidechain lines skipped", !txt.includes("secret plan") && !txt.includes("SIDECHAIN"));
  check("assistant lines of one response (same message id) merge into one message: text + tool", all[2].role === "assistant" && all[2].blocks.length === 2 && all[2].blocks[0].type === "text" && all[2].blocks[0].text.startsWith("## Plan") && all[2].blocks[1].type === "tool");
  const tools = all.flatMap((m) => m.blocks).filter((b) => b.type === "tool");
  check("tool summaries are one plain line", tools[0].summary === "Write sub/page.html" && tools[1].summary === "Bash: npm test --watch=false" && tools[2].summary === "Edit sub/page.html" && tools[3].summary === "Edit …/folder/notes.md" && tools[5].summary === "get_usage: self", tools.map((t) => t.summary).join(" | "));
  check("tool status ok / error / unknown (no result yet)", tools[0].status === "ok" && tools[1].status === "error" && tools[2].status === "ok" && tools[5].status === "unknown");
  check("tool output clipped to 1500", tools[1].output.length === 1500 && tools[1].output.startsWith("boom") && tools[1].output.endsWith("…") && tools[0].output === "File created");
  check("huge text clipped to 20000", all.some((m) => m.blocks.some((b) => b.type === "text" && b.text.length === 20000 && b.text.startsWith("Huge:"))));
  check("malformed lines counted, not fatal", p.file.badLines === 2, String(p.file.badLines));
  check("context from the LAST assistant usage: 277157 of 1,000,000 = 28%, not estimated", p.context.usedTokens === 277157 && p.context.windowTokens === 1_000_000 && p.context.percent === 28 && p.context.estimated === false, JSON.stringify(p.context));
  check("meta from the file: cwd, model, permission mode, title, times", p.file.cwd === proj && p.file.model === "claude-sonnet-5-5" && p.file.permissionMode === "auto" && p.file.title === "Alpha chat" && p.file.firstAt === T(0) && p.file.lastAt === T(10));
  check("outputs: Write/Edit only, newest first, unique, failed edit left out, outside path only folder + file", p.outputs.length === 2 && p.outputs[0].path === "…/folder/notes.md" && p.outputs[0].outside === true && p.outputs[1].path === "sub/page.html" && p.outputs[1].tool === "Edit" && p.outputs[1].at === T(5) && !JSON.stringify(p.outputs).includes("broken") && !JSON.stringify(p.outputs).includes("Elsewhere"), JSON.stringify(p.outputs));
  // context variants
  const ctxOf = (rows) => parseChat(rows.map((r) => JSON.stringify(r)).join("\n")).context;
  const u2 = { input_tokens: 10, cache_read_input_tokens: 150000, cache_creation_input_tokens: 40 };
  const one = (model, extraRows = []) => ctxOf([U(0, "hi"), { type: "assistant", timestamp: T(1), message: { id: "z", model, usage: u2, content: [{ type: "text", text: "a" }] } }, ...extraRows]);
  check("a [1m] model: window 1,000,000", one("claude-sonnet-4-5[1m]").windowTokens === 1_000_000 && one("claude-sonnet-4-5[1m]").percent === 15);
  check("an older 200k model: 75%", one("claude-haiku-4-5").windowTokens === 200_000 && one("claude-haiku-4-5").percent === 75);
  check("unknown model: 200k guessed, marked estimated", (() => { const c = one("claude-new-9"); return c.windowTokens === 200_000 && c.estimated === true && /unknown model/.test(c.basis); })());
  check("used more than the known window: 1,000,000 assumed, estimated", (() => { const c = ctxOf([{ type: "assistant", timestamp: T(1), message: { id: "z", model: "claude-haiku-4-5", usage: { input_tokens: 300000 }, content: [{ type: "text", text: "a" }] } }]); return c.windowTokens === 1_000_000 && c.percent === 30 && c.estimated === true; })());
  check("messages after the last reply: marked estimated", one("claude-opus-5-5", [U(2, "more")]).estimated === true);
  check("compaction after the last reply: its size, estimated", (() => { const c = one("claude-opus-5-5", [{ type: "system", subtype: "compact_boundary", timestamp: T(2), compactMetadata: { preTokens: 150050, postTokens: 31000 } }]); return c.usedTokens === 31000 && c.percent === 3 && c.estimated === true; })());
  check("synthetic error replies do not count as usage", one("claude-opus-5-5", [{ type: "assistant", timestamp: T(3), message: { id: "q", model: "<synthetic>", usage: { input_tokens: 0 }, content: [{ type: "text", text: "API Error" }] } }]).usedTokens === 150050);
  check("empty file: no messages, no usage, no crash", (() => { const e = parseChat(""); return e.messages.length === 0 && e.context.usedTokens === null && e.context.percent === null && e.outputs.length === 0; })());
  check("window table", windowFor("claude-opus-5-5").tokens === 1e6 && windowFor("claude-fable-5-2").tokens === 1e6 && windowFor("claude-haiku-5-5").tokens === 1e6 && windowFor("claude-opus-4-5").tokens === 2e5 && windowFor("claude-opus-4-8").tokens === 1e6 && windowFor("sonnet").tokens === 1e6 && windowFor("").known === false);
  // paging
  const many = parseChat(Array.from({ length: 450 }, (_, i) => JSON.stringify(U(i, "msg " + i))).join("\n")).messages;
  const pg = (o) => pageOf(many, o);
  check("paging: default = last 200, hasMore", (() => { const r = pg({}); return r.messages.length === 200 && r.messages[0].i === 250 && r.messages[199].i === 449 && r.hasMore && r.messagesTotal === 450 && r.firstIndex === 250; })());
  check("paging: before=250 gives 50..249; before=50&limit=400 gives 0..49, no more", (() => { const a = pg({ before: "250" }), b = pg({ before: 50, limit: 400 }); return a.messages[0].i === 50 && a.messages.at(-1).i === 249 && a.hasMore && b.messages.length === 50 && b.messages[0].i === 0 && !b.hasMore; })());
  check("paging: limit capped at 400, bad values fall back to defaults", pg({ limit: 9999 }).messages.length === 400 && pg({ limit: "abc" }).messages.length === 200 && pg({ before: "-5" }).messages.length === 200 && pg({ before: "1e3" }).messages.at(-1).i === 449 && pg({ before: 0 }).messages.length === 0);
  // resolving ids only through the lists
  const T2 = "99887766-aaaa-bbbb-cccc-111122223333", T3 = "55667788-0000-1111-2222-333344445555";
  put(join(base, encode(proj), T2 + ".jsonl"), JSON.stringify(U(0, "app chat words")) + "\n");
  put(join(base, encode(join(proj, "sub")), T3 + ".jsonl"), JSON.stringify(U(0, "terminal words")) + "\n");
  put(join(base, "C--Other", SID + ".jsonl"), JSON.stringify(U(0, "WRONG PROJECT")) + "\n");
  const chatList = { projects: [{ project: "Alpha", chats: [
    { id: "h-20261120-1", kind: "hub", name: "Hub chat", state: "idle", remoteControl: false, since: T(0), lastActive: T(10), model: "sonnet" },
    { id: "s-99887766", kind: "app", name: "App chat", state: "closed", remoteControl: true, openLink: APP_LINK + "local_abcdef12-3456", since: T(0), lastActive: T(1) },
    { id: "s-55667788", kind: "terminal", name: "Term", state: "idle", remoteControl: null, openLink: null },
    { id: "s-00000000", kind: "terminal", name: "No file", state: "idle", remoteControl: null, openLink: null },
  ] }] };
  const hubChats = [{ id: "h-20261120-1", sessionId: SID, project: "Alpha" }];
  const appRecords = [{ sessionId: "local_abcdef12-3456", cliSessionId: T2, cwd: proj, isArchived: false, model: "claude-opus-5-5", permissionMode: "default" }];
  const opts = { chatList, hubChats, appRecords, root, chatsBase: base, redact, branchOf: async () => "main" };
  const rh = await readChatLog({ id: "h-20261120-1", ...opts });
  check("Hub chat id: its saved file by session id; meta filled", rh.status === 200 && rh.body.messagesTotal === all.length && rh.body.meta.kind === "hub" && rh.body.meta.projectName === "Alpha" && rh.body.meta.branch === "main" && rh.body.meta.model === "claude-sonnet-5-5" && rh.body.meta.permissionMode === "auto" && rh.body.meta.remoteControl === false && rh.body.meta.outputs.length === 2 && rh.body.context.percent === 28 && rh.body.meta.savedFileFound === true);
  const ra = await readChatLog({ id: "s-99887766", ...opts }), rl = await readChatLog({ id: "local_abcdef12-3456", ...opts });
  check("app chat by s- id and by its local_ app id: the file from the app record", ra.status === 200 && ra.body.messages[0].blocks[0].text === "app chat words" && ra.body.meta.remoteControl === true && rl.status === 200 && rl.body.chatId === "s-99887766" && rl.body.messages[0].blocks[0].text === "app chat words" && ra.body.meta.model === "claude-opus-5-5" && ra.body.meta.permissionMode === "auto");
  const rt = await readChatLog({ id: "s-55667788", ...opts });
  check("terminal chat: found by id start in the project's (sub)folder chats", rt.status === 200 && rt.body.messages[0].blocks[0].text === "terminal words" && !JSON.stringify(rt.body).includes("WRONG PROJECT"));
  check("chat-log meta keeps null (unknown Remote Control): terminal null, other values only true/false", rt.body.meta.remoteControl === null && typeof rh.body.meta.remoteControl === "boolean");
  const rn = await readChatLog({ id: "s-00000000", ...opts });
  check("known chat with no saved file: 200, empty, savedFileFound false", rn.status === 200 && rn.body.messages.length === 0 && rn.body.meta.savedFileFound === false && rn.body.context.usedTokens === null);
  const bad = await Promise.all(["h-nope", "s-12345678", "local_00000000-0000", "..\\..\\x", "../../x", "", null, 5, SID, "s-99887766/..", "h-20261120-1\0", "C:\\Windows"].map((x) => readChatLog({ id: x, ...opts }).then((r) => r.status)));
  check("unknown ids, path tricks, Claude session ids, non-strings: 404", bad.every((s) => s === 404), bad.join());
  check("unknown answer is exactly {error:'unknown chat'}", JSON.stringify((await readChatLog({ id: "h-nope", ...opts })).body) === '{"error":"unknown chat"}');
  check("archived app record is not used (its model is not taken; the file is then found only by the id start)", (await readChatLog({ id: "s-99887766", ...opts, appRecords: [{ ...appRecords[0], isArchived: true }] })).body.meta.model === null);
  check("a project name with path pieces is refused", (await readChatLog({ id: "s-99887766", ...opts, chatList: { projects: [{ project: "..\\..", chats: chatList.projects[0].chats }] } })).status === 404);
  check("git branch of a real folder (this repo) or null; a missing folder gives null", await (async () => { const b = await gitBranch(resolve(HERE, "..", "..", "..")); return (b === null || typeof b === "string") && (await gitBranch(join(tmp, "nope"))) === null; })());
  // demo
  const dj = { chats: { "h-20261120-1": { context: { usedTokens: 250000, windowTokens: 1000000, estimated: false, basis: "sample" }, meta: { outputs: [{ path: "a.md", tool: "Write", agoMinutes: 3 }] }, messages: [{ role: "user", agoMinutes: 5, blocks: [{ type: "text", text: "hi" }] }, { role: "assistant", agoMinutes: 4, blocks: [{ type: "text", text: "yo" }] }] } } };
  const d1 = demoChatLog({ id: "h-20261120-1", demoJson: dj, chatList, now: Date.parse("2026-11-20T12:00:00Z") });
  check("demo: sample conversation with times, percent and outputs", d1.status === 200 && d1.body.demo === true && d1.body.messages.length === 2 && d1.body.messages[0].at === "2026-11-20T11:55:00.000Z" && d1.body.context.percent === 25 && d1.body.meta.outputs[0].at === "2026-11-20T11:57:00.000Z");
  check("demo: a sample chat without a log is empty; an unknown id is 404", demoChatLog({ id: "s-55667788", demoJson: dj, chatList }).body.messages.length === 0 && demoChatLog({ id: "h-x", demoJson: dj, chatList }).status === 404 && demoChatLog({ id: "..\\x", demoJson: dj, chatList }).status === 404);
  // pictures and files in the feed
  {
    const pngB = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)]).toString("base64");
    const rr = [
      U(0, [{ type: "image", source: { type: "base64", media_type: "image/png", data: pngB } }, { type: "text", text: "what is this?" }]),
      { type: "attachment", attachment: { type: "file", filename: "C:\\Elsewhere\\secret-folder\\yellow.png", displayPath: "..\\..\\yellow.png", content: { type: "image", file: { base64: pngB, type: "image/png", originalSize: 308 } } } },
      { type: "attachment", attachment: { type: "file", filename: "C:\\a\\LICENSE", displayPath: "LICENSE", content: { type: "text", file: { content: "MIT" } } } },
      { type: "attachment", attachment: { type: "file", filename: "C:\\a\\p.pdf", displayPath: "p.pdf", content: { type: "pdf", file: { base64: "", originalSize: 900 } } } },
      A(1, "p1", [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "C:\\a\\red.png" } }]),
      U(1, [{ type: "tool_result", tool_use_id: "r1", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: pngB } }] }]),
      A(2, "p2", [{ type: "text", text: "It is red." }]),
      U(3, [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from("%PDF-1.4 abc").toString("base64") } }, { type: "text", text: "the file" }]),
      U(4, [{ type: "image", source: { type: "base64", media_type: "image/png", data: "" } }]),
      U(5, [{ type: "image", source: { type: "base64", media_type: "image/svg+xml", data: "PHN2Zz4=" } }, { type: "text", text: "svg" }]),
      { type: "attachment", attachment: { type: "file", filename: "x", displayPath: "x", content: { type: "image", file: { base64: pngB, type: "image/png" } } } },
    ];
    const pp = parseChat(rr.map((r) => JSON.stringify(r)).join("\n"), { redact });
    const pj = JSON.stringify(pp.messages);
    const m0 = pp.messages[0].blocks, m1 = pp.messages[1], m3 = pp.messages[3];
    check("pictures: image block in Ivan's message = {type, m, b, mediaType, bytes} without data", m0[0].type === "image" && m0[0].m === 0 && m0[0].b === 0 && m0[0].mediaType === "image/png" && m0[0].bytes === 308 && !("name" in m0[0]) && !pj.includes(pngB.slice(0, 20)), JSON.stringify(m0[0]));
    check("pictures: an @path picture is a block of the same user message, after his text, named by its file only", m0.length === 4 && m0[1].type === "text" && m0[2].type === "image" && m0[2].b === 2 && m0[2].name === "yellow.png" && !pj.includes("secret-folder"), JSON.stringify(m0));
    check("pictures: a text-file attachment adds nothing; a PDF attachment is a file chip", !pj.includes("MIT") && pp.messages[0].blocks.length === 4 && m0[3].type === "file" && m0[3].m === 0 && m0[3].b === 3 && m0[3].mediaType === "application/pdf" && m0[3].bytes === 900 && m0[3].name === "p.pdf", JSON.stringify(m0[3]));
    check("pictures: a Read result picture sits right after its tool block with the file's name; the tool output has no '[image]'", m1.role === "assistant" && m1.blocks[0].type === "tool" && m1.blocks[0].output === "" && m1.blocks[1].type === "image" && m1.blocks[1].m === 1 && m1.blocks[1].b === 1 && m1.blocks[1].name === "red.png" && m1.blocks[1].mediaType === "image/jpeg", JSON.stringify(m1.blocks));
    check("pictures: a document block is a file chip with size", m3.role === "user" && m3.blocks[0].type === "file" && m3.blocks[0].mediaType === "application/pdf" && m3.blocks[0].bytes === 12 && m3.blocks[1].text === "the file", JSON.stringify(m3.blocks));
    check("pictures: data missing = old '[image]' text; an unsafe type (svg) = '[image]' too", pp.messages[4].blocks[0].text === "[image]" && pp.messages[5].blocks[0].text === "[image]" && pp.messages[5].blocks[1].text === "svg");
    check("pictures: an attachment line after the last user message joins it (the svg one gets the picture at b2); message indexes unchanged", pp.messages.length === 6 && pp.messages.every((m, i) => m.i === i) && pp.blockSources.size === 4, String(pp.blockSources.size));
    check("pictures: sources point at lines and paths, never hold data", [...pp.blockSources.values()].every((s) => Number.isInteger(s.line) && Array.isArray(s.path)) && !JSON.stringify([...pp.blockSources]).includes(pngB.slice(0, 20)));
    check("paging keeps picture blocks whole", (() => { const q = pageOf(pp.messages, { before: 1, limit: 1 }).messages[0]; return q.i === 0 && q.blocks[0].type === "image" && q.blocks[0].m === 0; })());
  }
  // question cards
  {
    const KEY = "sk-" + "Zq9".repeat(10);
    const AQ = { questions: [
      { question: "Which colour?", header: "Colour", multiSelect: false, options: [{ label: "Red", description: "warm" }, { label: "Blue" }] },
      { question: "Pick extras", header: "Extras", multiSelect: true, options: [{ label: "A", description: "x" }, { label: "B", description: "y" }] },
    ] };
    const rr = [
      U(0, "go"),
      A(1, "q1", [{ type: "text", text: "Asking." }, { type: "tool_use", id: "aq1", name: "AskUserQuestion", input: AQ }]),
      U(1, [{ type: "tool_result", tool_use_id: "aq1", content: "User has answered your questions: \"Which colour?\"=\"Red\" with " + KEY + " " + "z ".repeat(300) }]),
      A(2, "q2", [{ type: "tool_use", id: "aq2", name: "AskUserQuestion", input: { questions: [{ question: "Unanswered?", options: [{ label: "Yes" }] }] } }]),
      A(3, "q3", [{ type: "tool_use", id: "wu1", name: "mcp__ccd_turn__wrap_up", input: { ask: "Commit now?", actions: [{ label: "Commit" }, { label: "Not now" }, {}], recap: "Done " + KEY } }]),
      U(3, [{ type: "tool_result", tool_use_id: "wu1", content: [{ type: "text", text: "Shown in the next-step box." }] }]),
      A(4, "q4", [{ type: "tool_use", id: "wu2", name: "mcp__ccd_turn__wrap_up", input: { recap: "Nothing pending" } }]),
      A(5, "q5", [{ type: "tool_use", id: "aq3", name: "AskUserQuestion", input: { questions: [{ question: "No options?" }] } }]),
      U(5, [{ type: "tool_result", tool_use_id: "aq3", is_error: true, content: "The user doesn't want to proceed" }]),
      A(6, "q6", [{ type: "tool_use", id: "aq4", name: "AskUserQuestion", input: { questions: "bad" } }]),
      A(7, "q7", [{ type: "tool_use", id: "wu3", name: "wrap_up", input: {} }]),
      A(8, "q8", [{ type: "tool_use", id: "aq5", name: "AskUserQuestion", input: { questions: [{ question: "Q ".repeat(450), options: [{ label: "L ".repeat(250), description: "D ".repeat(450) }] }] } }]),
      A(9, "q9", [{ type: "tool_use", id: "rd", name: "Read", input: { file_path: "C:\a\b.png" } }]),
    ];
    const pq = parseChat(rr.map((r) => JSON.stringify(r)).join("\n"), { redact });
    const qs = pq.messages.flatMap((m) => m.blocks).filter((b) => b.type === "question");
    const tools = pq.messages.flatMap((m) => m.blocks).filter((b) => b.type === "tool");
    const qj = JSON.stringify(pq.messages);
    check("questions: AskUserQuestion becomes a question block with both questions, headers, multiSelect, options", qs[0].source === "AskUserQuestion" && qs[0].questions.length === 2 && qs[0].questions[0].header === "Colour" && !("multiSelect" in qs[0].questions[0]) && qs[0].questions[1].multiSelect === true && qs[0].questions[0].options[0].label === "Red" && qs[0].questions[0].options[0].description === "warm" && !("description" in qs[0].questions[0].options[1]), JSON.stringify(qs[0]));
    check("questions: answered one = answered true + answer, redacted and clipped to 300", qs[0].answered === true && qs[0].answer.length === 300 && qs[0].answer.endsWith("…") && qs[0].answer.includes("Red") && !qj.includes(KEY));
    check("questions: no result yet = answered false, no answer", qs[1].answered === false && !("answer" in qs[1]) && qs[1].questions[0].question === "Unanswered?");
    check("questions: wrap_up = one question from ask, options from actions (empty one dropped), recap redacted; result is only a note so answered null", qs[2].source === "wrap_up" && qs[2].questions.length === 1 && qs[2].questions[0].question === "Commit now?" && qs[2].questions[0].options.map((o) => o.label).join() === "Commit,Not now" && qs[2].recap.startsWith("Done ") && qs[2].answered === null && !("answer" in qs[2]), JSON.stringify(qs[2]));
    check("questions: wrap_up with only a recap = no questions, only recap; no result = answered false", qs[3].source === "wrap_up" && qs[3].questions.length === 0 && qs[3].recap === "Nothing pending" && qs[3].answered === false);
    check("questions: a declined question (error result) = answered null; question without options = empty options", qs[4].answered === null && qs[4].questions[0].options.length === 0 && qs[4].questions[0].question === "No options?");
    check("questions: malformed input (questions not a list; wrap_up with nothing) falls back to the plain tool fold", tools.some((t) => t.name === "AskUserQuestion") && tools.some((t) => t.name === "wrap_up") && qs.length === 6, String(qs.length));
    check("questions: long text clipped (question 600, label 200, description 400)", qs[5].questions[0].question.length === 600 && qs[5].questions[0].options[0].label.length === 200 && qs[5].questions[0].options[0].description.length === 400);
    check("questions: the question block replaces the tool fold (no tool block for answered/valid ones), messages keep their indexes", !tools.some((t) => t.name === "AskUserQuestion" && t.summary.includes("Which")) && pq.messages.every((m, i) => m.i === i) && pq.messages[1].blocks.map((b) => b.type).join() === "text,question");
    check("questions: other tools unchanged", tools.some((t) => t.name === "Read"));
    check("questions: paging keeps the block whole", pageOf(pq.messages, { limit: 200 }).messages[1].blocks[1].type === "question");
  }
  // read-only: no writes in the module; the only process is git
  const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("// ---------- self-test")[0];
  check("module source has no file writes; the only process started is git rev-parse", !/writeFile|appendFile|mkdirSync|rmSync|unlinkSync|renameSync|spawn|execSync|fork\(/.test(src) && /import \{ execFile \} from "node:child_process"/.test(src) && (src.match(/execFile\(/g) || []).length === 1 && /execFile\("git", \["rev-parse", "--abbrev-ref", "HEAD"\]/.test(src));

  // read-only run against the real saved chats of the Hub folder: counts only, never text
  if (process.argv.includes("--real")) {
    const hubDir = resolve(HERE, "..", "..", "..");
    for (const f of chatFiles(hubDir).slice(0, 3)) {
      const t0 = Date.now(); const r = parseFile(f.file, { redact, cwdHint: hubDir }); const ms = Date.now() - t0;
      const blocks = r.messages.flatMap((m) => m.blocks);
      console.log(`real ${f.name.slice(0, 8)}: ${r.messages.length} messages (${r.messages.filter((m) => m.role === "user").length} user), ${blocks.filter((b) => b.type === "tool").length} tool blocks (${blocks.filter((b) => b.status === "error").length} error, ${blocks.filter((b) => b.status === "unknown").length} unknown), ${r.outputs.length} outputs, context ${r.context.usedTokens} / ${r.context.windowTokens} = ${r.context.percent}% estimated=${r.context.estimated}, compactions ${r.file.compactions}, bad lines ${r.file.badLines}, ${ms} ms`);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${ok}/${total}`);
  process.exit(ok === total ? 0 : 1);
}
