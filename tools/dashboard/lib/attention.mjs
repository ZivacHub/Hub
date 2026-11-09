// "A chat needs you" (plan step 6.3). READ-ONLY: decides from the saved chat files, with no hooks and no change to Claude's settings.
// What a saved chat looks like (checked on the real chats, 2026-11-08):
//   - a chat that is working ends mid-way: a tool result, or an assistant row that still has a tool call;
//   - a chat that finished its turn ends with an assistant row that has text (stop_reason end_turn);
//   - the app's next-step box is the tool call "wrap_up" with the question in input.ask; the question tool is "AskUserQuestion".
// So: waiting for you = the turn ended AND (the box asked something, or the last paragraph ends with "?"), or a question tool
// call is open, or a normal tool call has been open for more than 3 minutes (probably a permission prompt, shown as "maybe").
//   node tools/dashboard/lib/attention.mjs --selftest

const MIN = 60_000;
const PERMISSION_AFTER_MS = 3 * MIN;   // a tool call with no result for this long: probably waiting for permission
const STOPPED_AFTER_MS = 30 * MIN;     // the last row is Ivan's or a tool result and nothing happened for this long

const blocksOf = (r) => (Array.isArray(r.message?.content) ? r.message.content : typeof r.message?.content === "string" ? [{ type: "text", text: r.message.content }] : []);
const isUserText = (r) => r.type === "user" && !r.isMeta && blocksOf(r).some((b) => b.type === "text" && String(b.text || "").trim()) && !blocksOf(r).some((b) => b.type === "tool_result");

/** When this stretch of work began: the first row after the last pause of 10 minutes or more. (A chat that waited overnight for an
 *  answer and then carried on is "working since the answer", not "since last night": answers to question boxes arrive as tool results.) */
function runStart(rows) {
  let i = rows.length - 1;
  while (i > 0) {
    const gap = Date.parse(rows[i].timestamp) - Date.parse(rows[i - 1].timestamp);
    if (!(gap < 10 * MIN)) break;
    i--;
  }
  return rows[i].timestamp || null;
}

/** rows = the main-chain user and assistant rows of one chat, oldest first. Returns { state, at, snippet, urgent } or null. */
export function classify(rows, nowMs = Date.now()) {
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const at = last.timestamp || null;
  const age = at ? nowMs - Date.parse(at) : 0;
  const since = runStart(rows);
  if (last.type === "user") return { state: age < STOPPED_AFTER_MS ? "working" : "stopped", at, since };

  const lastBlocks = blocksOf(last);
  const tools = lastBlocks.filter((b) => b.type === "tool_use");
  if (tools.length) {
    const q = tools.find((t) => t.name === "AskUserQuestion");
    if (q) return { state: "question", why: "question-tool", urgent: true, at, snippet: String(q.input?.questions?.[0]?.question || "A question is open") };
    if (age > PERMISSION_AFTER_MS) return { state: "permission", at, snippet: `Maybe waiting for your permission to run ${tools[0].name.replace(/^mcp__/, "").slice(0, 40)}` };
    return { state: "working", at, since };
  }

  // the assistant ended its turn: look at what that turn said to Ivan
  let i = rows.length - 1; while (i >= 0 && !isUserText(rows[i])) i--;
  const turn = rows.slice(i + 1);
  let box = null;
  for (const r of turn) for (const b of blocksOf(r)) if (b.type === "tool_use" && /wrap_up$/.test(b.name || "")) box = b.input || null;
  const text = lastBlocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  const lastPara = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).pop() || "";
  if (box && String(box.ask || "").trim()) return { state: "question", why: "next-step-box", urgent: box.blocked === true, at, snippet: String(box.ask) };
  if (/\?["')\]]*\s*$/.test(lastPara)) return { state: "question", why: "ends-with-question", urgent: false, at, snippet: lastPara };
  return { state: "idle", at };
}

// ---------- real chat files ----------
import { readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";

function tailRows(file, bytes = 3_000_000) {
  const size = statSync(file).size; const fd = openSync(file, "r");
  let lines;
  try { const len = Math.min(size, bytes); const buf = Buffer.alloc(len); readSync(fd, buf, 0, len, size - len); lines = buf.toString("utf8").split("\n"); if (size > len) lines.shift(); } finally { closeSync(fd); }
  const rows = []; let title = null;
  for (const line of lines) {
    if (!line.startsWith("{")) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type === "custom-title") title = j.customTitle || j.title || title;
    else if ((j.type === "user" || j.type === "assistant") && !j.isSidechain) rows.push(j);
  }
  return { rows, title };
}

/** For one project: every recent chat (last message within maxDays) that needs Ivan, newest first. */
export function chatsNeedingYou(chatDirs, { maxDays = 7, nowMs = Date.now(), max = 6 } = {}) {
  const files = [];
  for (const dir of chatDirs) { let names = []; try { names = readdirSync(dir).filter((n) => n.endsWith(".jsonl")); } catch { continue; } for (const n of names) { const p = join(dir, n); try { files.push({ p, m: statSync(p).mtimeMs }); } catch { /* skip */ } } }
  files.sort((a, b) => b.m - a.m);
  const out = [];
  for (const f of files) {
    if (nowMs - f.m > maxDays * 86_400_000) break; // older than the window (and so is every file after it)
    let c; try { const { rows, title } = tailRows(f.p); c = classify(rows, nowMs); if (c) c.title = title; } catch { continue; }
    if (c && (c.state === "question" || c.state === "permission") && c.at && nowMs - Date.parse(c.at) <= maxDays * 86_400_000) out.push(c);
    if (out.length >= max) break;
  }
  return out.sort((a, b) => (b.urgent === true) - (a.urgent === true) || String(b.at).localeCompare(String(a.at)));
}

/** For one project: the chats that are working right now (last row mid-turn, under 30 minutes old), newest first. */
export function chatsWorking(chatDirs, { nowMs = Date.now() } = {}) {
  const files = [];
  for (const dir of chatDirs) { let names = []; try { names = readdirSync(dir).filter((n) => n.endsWith(".jsonl")); } catch { continue; } for (const n of names) { const p = join(dir, n); try { files.push({ p, m: statSync(p).mtimeMs }); } catch { /* skip */ } } }
  files.sort((a, b) => b.m - a.m);
  const out = [];
  for (const f of files) {
    if (nowMs - f.m > STOPPED_AFTER_MS) break; // a chat that is working touches its file at least every few minutes
    try { const { rows, title } = tailRows(f.p); const c = classify(rows, nowMs); if (c && c.state === "working") out.push({ ...c, title }); } catch { /* skip */ }
  }
  return out;
}

// ---------- self-test on made-up chats (no real files) ----------
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv.includes("--selftest")) {
  const NOW = Date.parse("2026-11-08T12:00:00Z");
  const t = (min) => new Date(NOW - min * MIN).toISOString();
  const user = (min, text = "do it") => ({ type: "user", timestamp: t(min), message: { content: text } });
  const result = (min) => ({ type: "user", timestamp: t(min), message: { content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] } });
  const say = (min, text) => ({ type: "assistant", timestamp: t(min), message: { stop_reason: "end_turn", content: [{ type: "text", text }] } });
  const call = (min, name, input = {}) => ({ type: "assistant", timestamp: t(min), message: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "x", name, input }] } });
  let bad = 0;
  const ok = (name, cond) => { console.log(`${cond ? "OK  " : "FAIL"} ${name}`); if (!cond) bad++; };
  const s = (rows) => classify(rows, NOW)?.state;

  ok("finished turn, plain statement: idle", s([user(10), say(9, "All done. The page is live.")]) === "idle");
  ok("finished turn, last paragraph is a question: question", s([user(10), say(9, "Built it.\n\nDo you want the dark mode too?")]) === "question");
  ok("question mid-text but statement last: idle", s([user(10), say(9, "Should it be dark? I chose light.\n\nDone.")]) === "idle");
  const box = (blocked) => call(9, "mcp__ccd_turn__wrap_up", { recap: "r", ask: "Which one first?", blocked });
  ok("next-step box with a question: question", s([user(10), box(false), result(9), say(8, "Summary of the work.")]) === "question");
  ok("blocked next-step box is urgent", classify([user(10), box(true), result(9), say(8, "Summary.")], NOW).urgent === true);
  ok("next-step box without a question: idle", s([user(10), call(9, "mcp__ccd_turn__wrap_up", { recap: "r" }), result(9), say(8, "Done.")]) === "idle");
  ok("box from an EARLIER turn does not count", s([user(30), call(29, "mcp__ccd_turn__wrap_up", { ask: "Old question?" }), result(29), say(28, "x"), user(5, "answer"), say(4, "Fine, done.")]) === "idle");
  ok("open AskUserQuestion: question, urgent", (() => { const c = classify([user(10), call(1, "AskUserQuestion", { questions: [{ question: "Pick one?" }] })], NOW); return c.state === "question" && c.urgent; })());
  ok("tool call 20 s old: working", s([user(10), call(0.3, "Bash")]) === "working");
  ok("tool call 10 min old with no result: maybe permission", s([user(20), call(10, "Bash")]) === "permission");
  ok("Ivan answered (last row is his): working", s([user(10), say(9, "Which one?"), user(1, "the first")]) === "working");
  ok("his message 2 h old, no reply: stopped, not an alert", s([user(120)]) === "stopped");
  ok("tool result last and recent: working", s([user(10), call(2, "Bash"), result(1)]) === "working");
  ok("answering clears the alert", s([user(10), say(9, "Which one?")]) === "question" && s([user(10), say(9, "Which one?"), user(2, "A")]) === "working");
  ok("empty chat: nothing", classify([], NOW) === null);
  ok("a working chat knows when its work began", classify([user(40, "old"), say(39, "ok"), user(7, "now do this"), call(1, "Bash")], NOW).since === t(7));
  ok("work after a long pause counts from the end of the pause", classify([user(900, "start"), say(899, "Which one?"), result(2.5), call(1, "Bash")], NOW).since === t(2.5));
  process.exit(bad ? 1 : 0);
}
