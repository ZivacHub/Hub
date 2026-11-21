// The hand-off round (plan Phase 19, step 19.3, decision D57). One button, "Hand off and pick up", does what Ivan does by hand
// when a Hub chat gets about 60 to 70 percent full: send "/handoff" to the chat (it rewrites the project's .claude/handoff.md and
// memory), wait until it is resting again, PROVE handoff.md changed, and only then start a NEW Hub chat in the same project with
// "/pickup". The old chat is never stopped, changed or deleted; the page's newest-first rule moves it to "All chats".
// A lost hand-off is the one thing that must not happen, so a new chat is NEVER started unless handoff.md changed AND the chat's
// reply was not an error. Every refusal and failure is a plain sentence plus what to do next.
// Uses ONLY the chat engine's own list / answer / start (lib/chats.mjs makeChats), so every engine safety rule still holds
// (T9: never into a chat open elsewhere, Remote Control on = refused, at most 2 chats working, auto mode, logged without text).
// Rounds live in the server's memory: the page polls status(roundId), so a page reload does not lose a round (a Hub restart does).
// Contract: docs/plan/phases/19-claude-in-the-hub-handoff.md.
//   node tools/dashboard/lib/handoffround.mjs --selftest     (fakes only: never runs the real claude, never touches a real chat)
import { statSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUSNUS = resolve(HERE, "..", "..", "..", "..");

export const HANDOFF_TEXT = "/handoff";   // the ONLY text this module ever sends into a chat
export const PICKUP_TEXT = "/pickup";     // the ONLY task this module ever starts a chat with
export const WAIT_MS = 10 * 60_000;       // how long the /handoff turn may take
export const POLL_MS = 3000;              // how often the chat list is looked at while waiting
export const KEEP_FINISHED = 20;          // finished rounds kept in memory (running ones are always kept)
const BAD_PROJECT = /[&|<>^%"`\/\\\x00-\x1f]/;
const logSafe = (s, n = 60) => String(s ?? "-").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, n) || "-";
const mins = (ms) => Math.round(ms / 60000);

/** Every sentence the page may show, in plain words (shown as they are). */
export const SAY = {
  // refusals: nothing was sent, no round was made
  unknown: "The Hub does not know that chat. Look at the page again.",
  listFailed: "The Hub can't read its list of chats right now, so nothing was sent. Try again in a moment.",
  rc: "Remote Control is on for this chat, and the Hub can't write into a chat while Remote Control is on. Turn Remote Control off here first, then press the button again.",
  notIdle: (word) => `The hand-off only starts on a resting chat, and this one is ${word}. Wait until it is resting, or answer it yourself.`,
  already: "A hand-off round is already running for this chat. Wait for it to finish.",
  noFolder: "The Hub can't find this chat's project folder, so nothing was sent.",
  noStamp: "The Hub can't read the project's .claude/handoff.md, so it could not check the hand-off afterwards. Nothing was sent.",
  // steps that went well
  checked: "Checked: the chat is resting, Remote Control is off, the project folder is known.",
  stampSeen: "Noted how .claude/handoff.md looks now (its time and size).",
  stampNone: "The project has no .claude/handoff.md yet; noted that.",
  sent: (ms) => `Sent /handoff to the chat. Waiting for it to finish (at most ${mins(ms)} minutes).`,
  finished: "The chat finished the hand-off and is resting again.",
  verified: "Checked: .claude/handoff.md changed and the chat's reply is not an error.",
  started: (name) => `Started the new chat with /pickup: ${name}.`,
  done: "Done. The old chat is resting in All chats (nothing was stopped or deleted); the new chat is picking up.",
  // failures: the round ends, the error and the next thing to do are shown
  answerFailed: (why) => `The chat did not take the /handoff: ${why} No new chat was started.`,
  chatGone: "The chat disappeared from the Hub's list during the hand-off. No new chat was started.",
  timeout: (ms) => `The hand-off took longer than ${mins(ms)} minutes, so the Hub stopped waiting. No new chat was started.`,
  turnFailed: "The chat's reply to /handoff was an error, so no new chat was started.",
  turnStopped: "The chat was stopped during the hand-off, so no new chat was started.",
  unchanged: "The hand-off did not change handoff.md, no new chat was started.",
  stampAfter: "The Hub can't read .claude/handoff.md after the hand-off, so it can't prove the hand-off happened. No new chat was started.",
  startFailed: (why) => `handoff.md WAS updated, but the new chat did not start: ${why}`,
  internal: "Something went wrong inside the Hub during the hand-off round. No new chat was started.",
  internalAfterStart: "Something went wrong inside the Hub after the new chat was started. Look at the All chats tab.",
  // what to do next
  nextAnswer: "Answer the chat yourself, or press the button again later.",
  nextOpen: "Open the chat and look at its last reply; answer it yourself if it asks something.",
  nextLook: "Open the chat and look. If the hand-off finished, start a new chat in this project with /pickup yourself.",
  nextAllChats: "Look at the All chats tab.",
  nextStampAfter: "Open the project's .claude/handoff.md and look; if it is new, start a new chat with /pickup yourself.",
  nextPickup: (project) => `The hand-off is saved. Start a new chat in ${project} with /pickup yourself.`,
};
const STATE_WORD = { working: "still working", failed: "ended with an error", stopped: "stopped" };

/** Default stamp reader: { mtimeMs, size } of <folder>/.claude/handoff.md, null when the file does not exist; throws on other errors. */
export function readHandoffStampFs(folder) {
  try { const s = statSync(join(folder, ".claude", "handoff.md")); return { mtimeMs: s.mtimeMs, size: s.size }; }
  catch (e) { if (e && e.code === "ENOENT") return null; throw e; }
}

/** Default folder finder: the folder directly inside root with exactly this name, or null. */
export function projectFolderIn(root) {
  return (project) => {
    if (typeof project !== "string" || !project || project.length > 120 || BAD_PROJECT.test(project) || project === "." || project === "..") return null;
    try { return readdirSync(root, { withFileTypes: true }).some((d) => d.isDirectory() && d.name === project) ? join(root, project) : null; } catch { return null; }
  };
}

const sameStamp = (a, b) => (a === null && b === null) || (!!a && !!b && a.mtimeMs === b.mtimeMs && a.size === b.size);

/**
 * makeHandoffRound(opts) -> { start, status, active, forChat }
 *   chats             the object makeChats() returns (list, answer, start are used; nothing else). Required.
 *   readHandoffStamp  (projectFolder) -> { mtimeMs, size } | null (no file). Default: statSync of .claude/handoff.md.
 *   projectFolder     (projectName) -> absolute folder | null. Default: a folder directly inside root (the BUSNUS folder).
 *   root              the projects folder for the default projectFolder.
 *   now               () -> milliseconds. Default Date.now.
 *   sleep             (ms) -> Promise. Default setTimeout.
 *   log               (action, id, result) like the other engines (one line per step, never chat text).
 *   waitMs, pollMs, keep   limits (defaults WAIT_MS, POLL_MS, KEEP_FINISHED).
 */
export function makeHandoffRound(opts = {}) {
  const chats = opts.chats;
  if (!chats || typeof chats.list !== "function" || typeof chats.answer !== "function" || typeof chats.start !== "function") throw new Error("makeHandoffRound needs the chats engine (list, answer, start).");
  const readStamp = typeof opts.readHandoffStamp === "function" ? opts.readHandoffStamp : readHandoffStampFs;
  const folderOf = typeof opts.projectFolder === "function" ? opts.projectFolder : projectFolderIn(opts.root || BUSNUS);
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();
  const sleep = typeof opts.sleep === "function" ? opts.sleep : (ms) => new Promise((r) => setTimeout(r, ms));
  const logFn = typeof opts.log === "function" ? opts.log : () => {};
  const waitMs = Number.isFinite(opts.waitMs) && opts.waitMs > 0 ? opts.waitMs : WAIT_MS;
  const pollMs = Number.isFinite(opts.pollMs) && opts.pollMs > 0 ? opts.pollMs : POLL_MS;
  const keep = Number.isInteger(opts.keep) && opts.keep >= 0 ? opts.keep : KEEP_FINISHED;

  const rounds = new Map();   // roundId -> round (insertion order = oldest first)
  const busy = new Set();     // chat ids with a round running (one round per chat)
  const note = (rid, result) => { try { logFn("handoff-round", logSafe(rid), result); } catch { /* logging never breaks a round */ } };
  const iso = (ms) => new Date(ms).toISOString();
  const pad = (n) => String(n).padStart(2, "0");
  function newRoundId() {
    const d = new Date(now());
    const a = "abcdefghijklmnopqrstuvwxyz0123456789";
    let id;
    do id = `r-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${[...randomBytes(4)].map((b) => a[b % 36]).join("")}`;
    while (rounds.has(id));
    return id;
  }
  async function listChats() { const l = await chats.list(); if (!Array.isArray(l)) throw new Error("not a list"); return l; }
  const find = (l, id) => l.find((c) => c && c.id === id) || null;

  function view(r) {
    return {
      roundId: r.roundId, chatId: r.chatId, project: r.project, state: r.state, step: r.step,
      steps: r.steps.map((s) => ({ ...s })), startedAt: r.startedAt, finishedAt: r.finishedAt,
      error: r.error, next: r.next, handoffChanged: r.handoffChanged, result: r.result ? { ...r.result } : null,
    };
  }
  function addStep(r, step, text, ok = true) { r.step = step; r.steps.push({ step, at: iso(now()), text, ok }); }
  function prune() {
    const finished = [...rounds.values()].filter((r) => r.state !== "running");
    for (let i = 0; i < finished.length - keep; i++) rounds.delete(finished[i].roundId);
  }
  function finish(r, { error = null, next = null } = {}) {
    if (error) { addStep(r, r.step, error, false); r.state = "failed"; r.error = error; r.next = next; }
    else r.state = "done";
    r.finishedAt = iso(now());
    busy.delete(r.chatId);
    prune();
  }

  /** Steps 2 to 6, after the checks passed. Never throws: every way out ends the round with a plain reason. */
  async function run(r, old, folder) {
    let newStarted = false;
    try {
      // 2) remember the stamp of handoff.md (read once already in start(); recorded here)
      addStep(r, 2, r.before === null ? SAY.stampNone : SAY.stampSeen);
      note(r.roundId, `step 2 ok stamp ${r.before === null ? "none" : "noted"}`);

      // 3) send exactly "/handoff", then wait until the chat rests again
      const turnsBefore = Number(old.turns) || 0;
      let a;
      try { a = await chats.answer({ id: r.chatId, text: HANDOFF_TEXT }); } catch { a = { ok: false, error: "the Hub could not send it." }; }
      if (!a || a.ok !== true) {
        const why = String((a && a.error) || "the Hub could not send it.").trim();
        note(r.roundId, "step 3 failed: answer refused");
        return finish(r, { error: SAY.answerFailed(/[.!?]$/.test(why) ? why : why + "."), next: SAY.nextAnswer });
      }
      const sentAt = now();
      addStep(r, 3, SAY.sent(waitMs));
      note(r.roundId, "step 3 ok sent /handoff, waiting");
      let seenWorking = false, last = null, misses = 0;
      for (;;) {
        await sleep(pollMs);
        let l = null;
        try { l = await listChats(); } catch { l = null; }
        if (l) {
          const c = find(l, r.chatId);
          if (!c) { if (++misses >= 3) { note(r.roundId, "step 3 failed: chat left the list"); return finish(r, { error: SAY.chatGone, next: SAY.nextAllChats }); } }
          else {
            misses = 0; last = c;
            if (c.state === "working") seenWorking = true;
            else if (seenWorking || (Number(c.turns) || 0) > turnsBefore) break;
          }
        }
        if (now() - sentAt >= waitMs) { note(r.roundId, `step 3 failed: no rest within ${mins(waitMs)} min`); return finish(r, { error: SAY.timeout(waitMs), next: SAY.nextLook }); }
      }
      addStep(r, 3, SAY.finished);
      note(r.roundId, `step 3 ok chat resting (${last.state})`);

      // 4) verify: the reply is not an error AND handoff.md changed
      if (last.state === "stopped") { note(r.roundId, "step 4 failed: chat stopped"); return finish(r, { error: SAY.turnStopped, next: SAY.nextOpen }); }
      if (last.state !== "idle" || (typeof last.lastError === "string" && last.lastError.trim())) { note(r.roundId, "step 4 failed: reply was an error"); return finish(r, { error: SAY.turnFailed, next: SAY.nextOpen }); }
      let after;
      try { after = await readStamp(folder); } catch { note(r.roundId, "step 4 failed: stamp unreadable"); return finish(r, { error: SAY.stampAfter, next: SAY.nextStampAfter }); }
      if (after === undefined || after === null || sameStamp(r.before, after)) {
        r.handoffChanged = false;
        note(r.roundId, "step 4 failed: handoff.md unchanged");
        return finish(r, { error: SAY.unchanged, next: SAY.nextOpen });
      }
      r.handoffChanged = true;
      addStep(r, 4, SAY.verified);
      note(r.roundId, "step 4 ok handoff.md changed");

      // 5) the new chat in the same project: "/pickup", project workflow (default), same model, Remote Control off (as the old one)
      const o = { project: r.project, task: PICKUP_TEXT, remoteControl: false };
      if (typeof old.model === "string" && old.model) o.model = old.model;
      let s;
      try { s = await chats.start(o); } catch { s = { ok: false, error: "the Hub could not start it." }; }
      if (!s || s.ok !== true || typeof s.id !== "string") {
        const why = String((s && s.error) || "the Hub could not start it.").trim();
        note(r.roundId, "step 5 failed: new chat did not start");
        return finish(r, { error: SAY.startFailed(/[.!?]$/.test(why) ? why : why + "."), next: SAY.nextPickup(r.project) });
      }
      newStarted = true;
      let newName = "";
      try { const n = find(await listChats(), s.id); newName = n && typeof n.name === "string" ? n.name : ""; } catch { /* the name is only for the page */ }
      addStep(r, 5, SAY.started(newName || "the new chat"));
      note(r.roundId, `step 5 ok new chat ${logSafe(s.id)}`);

      // 6) result; the old chat is left as it is (resting, Remote Control off)
      r.result = { oldId: r.chatId, newId: s.id, newName, handoffChanged: true };
      addStep(r, 6, SAY.done);
      note(r.roundId, `step 6 ok old ${logSafe(r.chatId)} new ${logSafe(s.id)}`);
      return finish(r);
    } catch {
      note(r.roundId, `failed: internal error at step ${r.step}`);
      return finish(r, newStarted ? { error: SAY.internalAfterStart, next: SAY.nextAllChats } : { error: SAY.internal, next: SAY.nextOpen });
    }
  }

  /** Start one round for a Hub chat. Refusals return { ok:false, error } and make no round. */
  async function start({ id } = {}) {
    if (typeof id !== "string" || !id || id.length > 80) { note("-", "refused: unknown chat"); return { ok: false, error: SAY.unknown }; }
    if (busy.has(id)) { note("-", `refused: round already running for ${logSafe(id)}`); return { ok: false, error: SAY.already }; }
    busy.add(id); // taken before any wait, so a double press can never make two rounds
    const refuse = (error, why) => { busy.delete(id); note("-", `refused: ${why} ${logSafe(id)}`); return { ok: false, error }; };
    try {
      let l;
      try { l = await listChats(); } catch { return refuse(SAY.listFailed, "chat list unreadable"); }
      const c = find(l, id);
      if (!c) return refuse(SAY.unknown, "unknown chat");
      if (c.remoteControl === true) return refuse(SAY.rc, "Remote Control on");
      if (c.state !== "idle") return refuse(SAY.notIdle(STATE_WORD[c.state] || "not resting"), `not idle (${logSafe(c.state, 12)})`);
      const folder = folderOf(c.project);
      if (typeof folder !== "string" || !folder) return refuse(SAY.noFolder, "project folder unknown");
      let before;
      try { before = await readStamp(folder); } catch { return refuse(SAY.noStamp, "stamp unreadable"); }
      if (before !== null && (typeof before !== "object" || before === undefined)) return refuse(SAY.noStamp, "stamp unreadable");
      const t = now();
      const r = { roundId: newRoundId(), chatId: id, project: c.project, state: "running", step: 1, steps: [], startedAt: iso(t), finishedAt: null,
        error: null, next: null, handoffChanged: null, result: null, before: before ? { mtimeMs: before.mtimeMs, size: before.size } : null };
      rounds.set(r.roundId, r);
      addStep(r, 1, SAY.checked);
      note(r.roundId, `step 1 ok chat ${logSafe(id)}`);
      run(r, c, folder); // runs on in the server; the page polls status(roundId)
      return { ok: true, roundId: r.roundId };
    } catch {
      return refuse(SAY.listFailed, "internal error during checks");
    }
  }

  /** One round as the page shows it, or null (unknown or pruned). */
  function status(roundId) { const r = typeof roundId === "string" ? rounds.get(roundId) : null; return r ? view(r) : null; }
  /** Every round still running. */
  function active() { return [...rounds.values()].filter((r) => r.state === "running").map(view); }
  /** The newest round of one chat (running or finished), or null: lets a reloaded page find its round by the chat id. */
  function forChat(chatId) { let hit = null; for (const r of rounds.values()) if (r.chatId === chatId) hit = r; return hit ? view(hit) : null; }

  return { start, status, active, forChat };
}

// ---------- self-test: fakes only (fake chats engine, fake clock, fake stamp reader) ----------
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv.includes("--selftest")) {
  let ok = 0, total = 0;
  const check = (n, c, x = "") => { total++; if (c) { ok++; console.log("OK   " + n); } else console.log("FAIL " + n + (x ? "  " + x : "")); };
  const T0 = Date.parse("2026-11-21T12:00:00Z");
  const tick = () => new Promise((r) => setImmediate(r));

  /** A pretend chat engine. Each chat: { id, project, name, model, remoteControl, state, turns, lastError, lastReply }.
   *  answer() makes the chat "working" for turnMs of fake time; when that time has passed, list() shows the outcome
   *  (default: idle, and the project's handoff.md stamp changes). */
  function world() {
    const w = { t: T0, chats: {}, stamps: {}, calls: [], logs: [], answerImpl: null, startImpl: null, listThrows: false, outcome: {}, seq: 0 };
    w.now = () => w.t;
    w.sleep = async (ms) => { w.t += ms; await tick(); };
    w.add = (c) => { w.chats[c.id] = { project: "Alpha", name: "Alpha · Work · 21 Nov 11:00", model: null, remoteControl: false, state: "idle", turns: 1, lastError: "", lastReply: "SECRET-CHAT-TEXT reply", ...c }; return c.id; };
    const settle = () => {
      for (const c of Object.values(w.chats)) {
        if (c.startAt !== undefined && w.t >= c.startAt) { c.state = "working"; c.turns += 1; c.doneAt = c.startAt + 45_000; delete c.startAt; }
        if (c.state !== "working" || c.doneAt === undefined || w.t < c.doneAt) continue;
        const o = w.outcome[c.id] || {};
        c.state = o.state || "idle"; c.lastError = o.lastError || ""; c.lastReply = "SECRET-CHAT-TEXT handed off";
        if (o.changeStamp !== false) { const s = w.stamps[c.project]; w.stamps[c.project] = { mtimeMs: (s ? s.mtimeMs : T0) + 1000, size: (s ? s.size : 0) + 37 }; }
        delete c.doneAt;
      }
    };
    w.engine = {
      list: () => { w.calls.push({ fn: "list" }); if (w.listThrows) throw new Error("list failed"); settle(); return Object.values(w.chats).map((c) => ({ ...c })); },
      answer: async (o) => {
        w.calls.push({ fn: "answer", ...o });
        if (w.answerImpl) return w.answerImpl(o);
        const c = w.chats[o.id];
        c.state = "working"; c.turns += 1; c.doneAt = w.t + ((w.outcome[o.id] && w.outcome[o.id].turnMs) ?? 45_000);
        return { ok: true, message: "Sent to the chat in " + c.project + "." };
      },
      start: async (o) => {
        w.calls.push({ fn: "start", ...o });
        if (w.startImpl) return w.startImpl(o);
        const id = `h-20261121-1200${String(++w.seq).padStart(2, "0")}-new${w.seq}`;
        w.chats[id] = { id, project: o.project, name: `${o.project} · Pick up · 21 Nov 12:00`, model: o.model || null, remoteControl: false, state: "working", turns: 1, lastError: "", lastReply: "" };
        return { ok: true, id, message: "Started a chat in " + o.project + "." };
      },
      stop: async (o) => { w.calls.push({ fn: "stop", ...o }); return { ok: true }; },
      setRemoteControl: async (o) => { w.calls.push({ fn: "setRemoteControl", ...o }); return { ok: true }; },
    };
    w.round = (extra = {}) => makeHandoffRound({
      chats: w.engine, now: w.now, sleep: w.sleep, log: (...a) => w.logs.push(a.join(" ")),
      projectFolder: (p) => (p === "Alpha" || p === "Beta" ? "C:/fake/BUSNUS/" + p : null),
      readHandoffStamp: (folder) => { if (w.stampThrows) throw new Error("no access"); const p = folder.split("/").pop(); return w.stamps[p] === undefined ? null : { ...w.stamps[p] }; },
      ...extra,
    });
    w.wait = async (h, rid) => { for (let i = 0; i < 20000; i++) { const s = h.status(rid); if (!s || s.state !== "running") return s; await tick(); } return h.status(rid); };
    w.of = (fn) => w.calls.filter((c) => c.fn === fn);
    return w;
  }
  const A = "h-20261121-110000-aaaa", B = "h-20261121-110000-bbbb";

  // ----- 1. the happy path -----
  {
    const w = world(); w.add({ id: A, model: "sonnet" }); w.stamps.Alpha = { mtimeMs: T0 - 86_400_000, size: 900 };
    const h = w.round();
    const s = await h.start({ id: A });
    check("happy: start ok with a round id", s.ok === true && /^r-\d{8}-\d{6}-[a-z0-9]{4}$/.test(s.roundId), JSON.stringify(s));
    check("happy: the round is running and listed in active()", h.status(s.roundId).state === "running" && h.active().length === 1 && h.active()[0].roundId === s.roundId);
    const f = await w.wait(h, s.roundId);
    check("happy: round done", f.state === "done" && f.error === null && f.next === null, JSON.stringify(f));
    check("happy: result names old and new chat, handoffChanged true", f.result && f.result.oldId === A && /new1$/.test(f.result.newId) && f.result.newName === "Alpha · Pick up · 21 Nov 12:00" && f.result.handoffChanged === true && f.handoffChanged === true);
    check("happy: steps 1 to 6 recorded in order, each with a time and a plain line", JSON.stringify(f.steps.map((x) => x.step)) === "[1,2,3,3,4,5,6]" && f.steps.every((x) => x.ok && typeof x.text === "string" && x.text && !Number.isNaN(Date.parse(x.at))));
    check("happy: the step lines are the documented ones", f.steps[0].text === SAY.checked && f.steps[1].text === SAY.stampSeen && f.steps[2].text === SAY.sent(WAIT_MS) && f.steps[3].text === SAY.finished && f.steps[4].text === SAY.verified && f.steps[5].text === SAY.started("Alpha · Pick up · 21 Nov 12:00") && f.steps[6].text === SAY.done);
    const st = w.of("start")[0];
    check("happy: new chat in the same project, task /pickup, same model, Remote Control off, workflow left at the default", w.of("start").length === 1 && st.project === "Alpha" && st.task === "/pickup" && st.model === "sonnet" && st.remoteControl === false && !("workflow" in st));
    check("happy: /handoff sent exactly once, and before the new chat started", w.of("answer").length === 1 && w.of("answer")[0].text === "/handoff" && w.calls.findIndex((c) => c.fn === "answer") < w.calls.findIndex((c) => c.fn === "start"));
    check("happy: the old chat is untouched and resting (never stopped, Remote Control never switched)", w.of("stop").length === 0 && w.of("setRemoteControl").length === 0 && w.chats[A].state === "idle" && w.chats[A].remoteControl === false);
    check("happy: waited with the fake clock (45 s turn polled every 3 s)", w.t - T0 >= 45_000 && w.t - T0 < 60_000, String(w.t - T0));
    check("happy: no longer active, still in status()", h.active().length === 0 && h.status(s.roundId).state === "done" && h.forChat(A).roundId === s.roundId);
    check("happy: log has one line per step, without any chat text", w.logs.length >= 6 && w.logs.every((l) => l.startsWith("handoff-round ") && !/SECRET|handed off|reply/.test(l)) && ["step 1 ok", "step 2 ok", "step 3 ok", "step 4 ok", "step 5 ok", "step 6 ok"].every((k) => w.logs.some((l) => l.includes(k))), w.logs.join(" | "));
    check("happy: a status copy can not change the stored round", (() => { const v = h.status(s.roundId); v.state = "x"; v.steps.push({}); v.result.newId = "x"; const v2 = h.status(s.roundId); return v2.state === "done" && v2.steps.length === 7 && v2.result.newId !== "x"; })());
  }
  // a project with no handoff.md yet: the new file counts as changed
  {
    const w = world(); w.add({ id: A });
    const h = w.round(); const s = await h.start({ id: A }); const f = await w.wait(h, s.roundId);
    check("no handoff.md before: noted, and the new file counts as a change", f.state === "done" && f.steps[1].text === SAY.stampNone && f.result.handoffChanged === true && !("model" in w.of("start")[0]));
  }

  // ----- 2. refusals: nothing is sent, no round is made -----
  {
    const w = world();
    w.add({ id: A, state: "working" }); w.add({ id: B, remoteControl: true });
    w.add({ id: "h-20261121-110000-cccc", state: "failed", lastError: "x" }); w.add({ id: "h-20261121-110000-dddd", state: "stopped" });
    w.add({ id: "h-20261121-110000-eeee", project: "Gone" });
    const h = w.round();
    const r1 = await h.start({ id: A });
    check("refused: a working chat (not idle)", r1.ok === false && r1.error === SAY.notIdle("still working"), r1.error);
    const r2 = await h.start({ id: B });
    check("refused: Remote Control on, and the reason says so", r2.ok === false && r2.error === SAY.rc && /Remote Control is on/.test(r2.error));
    const r3 = await h.start({ id: "h-20261121-110000-cccc" }); const r4 = await h.start({ id: "h-20261121-110000-dddd" });
    check("refused: a failed chat and a stopped chat", r3.ok === false && r3.error === SAY.notIdle("ended with an error") && r4.ok === false && r4.error === SAY.notIdle("stopped"));
    const r5 = await h.start({ id: "h-20261121-110000-zzzz" }); const r6 = await h.start({ id: 42 }); const r7 = await h.start({});
    check("refused: unknown chat, a non-text id, no id", [r5, r6, r7].every((r) => r.ok === false && r.error === SAY.unknown));
    const r8 = await h.start({ id: "h-20261121-110000-eeee" });
    check("refused: project folder not known", r8.ok === false && r8.error === SAY.noFolder);
    w.listThrows = true; const r9 = await h.start({ id: A }); w.listThrows = false;
    check("refused: chat list unreadable", r9.ok === false && r9.error === SAY.listFailed);
    w.chats[A].state = "idle"; w.stampThrows = true; const r10 = await h.start({ id: A }); w.stampThrows = false;
    check("refused: handoff.md can not be read before", r10.ok === false && r10.error === SAY.noStamp);
    check("refusals: nothing sent, nothing started, no round made", w.of("answer").length === 0 && w.of("start").length === 0 && h.active().length === 0 && h.forChat(A) === null);
    check("refusals: logged as refused, without chat text", w.logs.length >= 10 && w.logs.every((l) => l.includes("refused:") && !/SECRET/.test(l)));
    const r11 = await h.start({ id: A });
    check("after a refusal the chat is free again (a later press works)", r11.ok === true);
    await w.wait(h, r11.roundId);
  }
  // a round already running for the chat (also a double press before the first press has even read the list)
  {
    const w = world(); w.add({ id: A }); w.outcome[A] = { turnMs: 120_000 };
    const h = w.round();
    const [p1, p2] = await Promise.all([h.start({ id: A }), h.start({ id: A })]);
    check("double press at the same moment: one round, one refused", [p1, p2].filter((x) => x.ok).length === 1 && [p1, p2].some((x) => x.ok === false && x.error === SAY.already));
    const first = p1.ok ? p1 : p2;
    await w.sleep(1); await tick();
    const p3 = await h.start({ id: A });
    check("refused: round already running for this chat", p3.ok === false && p3.error === SAY.already);
    const f = await w.wait(h, first.roundId);
    check("...and only one /handoff was sent", w.of("answer").length === 1 && f.state === "done");
  }

  // ----- 3. /handoff did not change the stamp -> no new chat -----
  {
    const w = world(); w.add({ id: A }); w.stamps.Alpha = { mtimeMs: T0 - 5000, size: 400 }; w.outcome[A] = { changeStamp: false };
    const h = w.round(); const s = await h.start({ id: A }); const f = await w.wait(h, s.roundId);
    check("unchanged handoff.md: round failed with the exact message", f.state === "failed" && f.error === "The hand-off did not change handoff.md, no new chat was started." && f.next === SAY.nextOpen);
    check("unchanged handoff.md: NO new chat, handoffChanged false, old chat untouched", w.of("start").length === 0 && f.handoffChanged === false && f.result === null && w.of("stop").length === 0 && w.chats[A].state === "idle");
    check("unchanged handoff.md: the failed step is recorded as not ok", f.steps[f.steps.length - 1].ok === false && f.steps[f.steps.length - 1].text === f.error);
  }
  // only the size changed, or only the time: both count as changed
  {
    const w = world(); w.add({ id: A }); w.stamps.Alpha = { mtimeMs: T0, size: 10 };
    const h = w.round({ readHandoffStamp: () => (w.of("answer").length ? { mtimeMs: T0, size: 11 } : { mtimeMs: T0, size: 10 }) });
    const s = await h.start({ id: A }); const f = await w.wait(h, s.roundId);
    check("only the size changed: counts as a change", f.state === "done");
  }
  // the chat still shows "idle" for a moment after /handoff was accepted: the round must not take that old rest as the end
  {
    const w = world(); w.add({ id: A }); w.stamps.Alpha = { mtimeMs: T0, size: 5 };
    w.answerImpl = (o) => { w.chats[o.id].startAt = w.t + 7000; return { ok: true }; };
    const h = w.round(); const s = await h.start({ id: A }); const f = await w.wait(h, s.roundId);
    check("turn not visible yet right after sending: the round waits for the real end", f.state === "done" && w.t - T0 >= 52_000, `${f.state} ${f.error} ${w.t - T0}`);
  }
  // the reply was an error (the stamp changed anyway): still no new chat
  {
    const w = world(); w.add({ id: A }); w.outcome[A] = { state: "failed", lastError: "SECRET-CHAT-TEXT model unavailable" };
    const h = w.round(); const s = await h.start({ id: A }); const f = await w.wait(h, s.roundId);
    check("error reply: failed, no new chat even though the file changed", f.state === "failed" && f.error === SAY.turnFailed && w.of("start").length === 0 && !/SECRET/.test(JSON.stringify(f)) && !w.logs.some((l) => /SECRET/.test(l)));
  }
  {
    const w = world(); w.add({ id: A }); w.outcome[A] = { state: "idle", lastError: "Something odd" };
    const h = w.round(); const s = await h.start({ id: A }); const f = await w.wait(h, s.roundId);
    check("idle but with an error line: treated as an error, no new chat", f.state === "failed" && f.error === SAY.turnFailed && w.of("start").length === 0);
  }
  {
    const w = world(); w.add({ id: A }); w.outcome[A] = { state: "stopped" };
    const h = w.round(); const s = await h.start({ id: A }); const f = await w.wait(h, s.roundId);
    check("chat stopped during the hand-off: no new chat", f.state === "failed" && f.error === SAY.turnStopped && w.of("start").length === 0);
  }
  {
    const w = world(); w.add({ id: A });
    let n = 0; const h = w.round({ readHandoffStamp: () => { if (n++ > 0) throw new Error("locked"); return null; } });
    const s = await h.start({ id: A }); const f = await w.wait(h, s.roundId);
    check("handoff.md unreadable afterwards: no new chat", f.state === "failed" && f.error === SAY.stampAfter && f.next === SAY.nextStampAfter && w.of("start").length === 0);
  }

  // ----- 4. the answer fails -----
  {
    const w = world(); w.add({ id: A });
    w.answerImpl = () => ({ ok: false, error: "This chat is open somewhere else (the Claude app or a terminal). Answer it there, so the chat does not split." });
    const h = w.round(); const s = await h.start({ id: A }); const f = await w.wait(h, s.roundId);
    check("answer refused by the engine: failed, the engine's reason is shown, no new chat", f.state === "failed" && f.error === SAY.answerFailed("This chat is open somewhere else (the Claude app or a terminal). Answer it there, so the chat does not split.") && f.next === SAY.nextAnswer && w.of("start").length === 0);
    const w2 = world(); w2.add({ id: A }); w2.answerImpl = () => { throw new Error("boom"); };
    const h2 = w2.round(); const s2 = await h2.start({ id: A }); const f2 = await w2.wait(h2, s2.roundId);
    check("answer throws: failed with a plain reason, no new chat, chat free again", f2.state === "failed" && f2.error === SAY.answerFailed("the Hub could not send it.") && w2.of("start").length === 0 && h2.active().length === 0);
  }

  // ----- 5. the wait times out -----
  {
    const w = world(); w.add({ id: A }); w.outcome[A] = { turnMs: 11 * 60_000 };
    const h = w.round(); const s = await h.start({ id: A }); const f = await w.wait(h, s.roundId);
    check("timeout: failed after 10 minutes of fake time, the exact message", f.state === "failed" && f.error === SAY.timeout(WAIT_MS) && f.error.includes("10 minutes") && f.next === SAY.nextLook && w.t - T0 >= WAIT_MS && w.t - T0 < WAIT_MS + 10_000);
    check("timeout: no new chat, the chat is NOT stopped", w.of("start").length === 0 && w.of("stop").length === 0);
    const w2 = world(); w2.add({ id: A }); w2.outcome[A] = { turnMs: 90_000 };
    const h2 = w2.round({ waitMs: 60_000, pollMs: 1000 }); const s2 = await h2.start({ id: A }); const f2 = await w2.wait(h2, s2.roundId);
    check("timeout: the limit and the poll interval are options", f2.state === "failed" && f2.error === SAY.timeout(60_000) && w2.t - T0 >= 60_000 && w2.t - T0 <= 61_000);
  }
  // the chat list fails for a while during the wait: the round keeps waiting; the chat vanishing ends it
  {
    const w = world(); w.add({ id: A });
    const h = w.round(); const s = await h.start({ id: A });
    await tick(); w.listThrows = true; await w.sleep(10_000); await tick(); await tick(); w.listThrows = false;
    const f = await w.wait(h, s.roundId);
    check("chat list unreadable for a moment while waiting: the round still finishes", f.state === "done");
    const w2 = world(); w2.add({ id: A });
    const h2 = w2.round(); const s2 = await h2.start({ id: A }); await tick(); delete w2.chats[A];
    const f2 = await w2.wait(h2, s2.roundId);
    check("chat gone from the list during the wait: failed, no new chat", f2.state === "failed" && f2.error === SAY.chatGone && w2.of("start").length === 0);
  }

  // ----- 6. the new chat fails to start -----
  {
    const w = world(); w.add({ id: A }); w.startImpl = () => ({ ok: false, error: "Two chats are already working. Wait for one to finish." });
    const h = w.round(); const s = await h.start({ id: A }); const f = await w.wait(h, s.roundId);
    check("new chat fails: failed, the reason says handoff.md WAS updated", f.state === "failed" && f.error === "handoff.md WAS updated, but the new chat did not start: Two chats are already working. Wait for one to finish." && f.handoffChanged === true);
    check("new chat fails: what to do next is to pick up by hand", f.next === SAY.nextPickup("Alpha") && /\/pickup yourself/.test(f.next));
    check("new chat fails: the old chat is untouched and resting", w.of("stop").length === 0 && w.of("setRemoteControl").length === 0 && w.chats[A].state === "idle" && f.result === null);
    const w2 = world(); w2.add({ id: A }); w2.startImpl = () => { throw new Error("x"); };
    const h2 = w2.round(); const s2 = await h2.start({ id: A }); const f2 = await w2.wait(h2, s2.roundId);
    check("new chat start throws: same rule, plain reason", f2.state === "failed" && f2.error === SAY.startFailed("the Hub could not start it.") && f2.handoffChanged === true);
  }

  // ----- 7. two rounds for two chats at once -----
  {
    const w = world(); w.add({ id: A, project: "Alpha", model: "opus" }); w.add({ id: B, project: "Beta", name: "Beta · Work · 21 Nov 10:00" });
    w.outcome[A] = { turnMs: 30_000 }; w.outcome[B] = { turnMs: 50_000 };
    const h = w.round();
    const [sa, sb] = await Promise.all([h.start({ id: A }), h.start({ id: B })]);
    check("two chats: both rounds start, two different ids, both active", sa.ok && sb.ok && sa.roundId !== sb.roundId && h.active().length === 2);
    const [fa, fb] = await Promise.all([w.wait(h, sa.roundId), w.wait(h, sb.roundId)]);
    check("two chats: both done", fa.state === "done" && fb.state === "done");
    const starts = w.of("start");
    check("two chats: each new chat in its own project, with its own model", starts.length === 2 && starts.some((x) => x.project === "Alpha" && x.model === "opus") && starts.some((x) => x.project === "Beta" && !("model" in x)) && fa.result.newId !== fb.result.newId);
    check("two chats: forChat finds each round", h.forChat(A).roundId === sa.roundId && h.forChat(B).roundId === sb.roundId);
  }

  // ----- 8. status after finish, and at most 20 finished rounds kept -----
  {
    const w = world(); const h = w.round();
    const ids = [];
    for (let i = 0; i < 23; i++) {
      const id = `h-20261121-1100${String(i).padStart(2, "0")}-k${String(i).padStart(3, "0")}`;
      w.add({ id }); const s = await h.start({ id }); ids.push(s.roundId); await w.wait(h, s.roundId);
    }
    check("status after finish: kept, with its finish time", h.status(ids[22]).state === "done" && !Number.isNaN(Date.parse(h.status(ids[22]).finishedAt)));
    check("at most 20 finished rounds kept: the 3 oldest are gone", ids.slice(0, 3).every((r) => h.status(r) === null) && ids.slice(3).every((r) => h.status(r) !== null));
    check("status of an unknown round is null", h.status("r-nope") === null && h.status(5) === null);
    const w2 = world(); w2.add({ id: A }); w2.outcome[A] = { turnMs: 200_000 };
    const h2 = w2.round({ keep: 0 }); const sr = await h2.start({ id: A });
    check("a running round is never pruned", h2.status(sr.roundId).state === "running");
    await w2.wait(h2, sr.roundId);
  }

  // ----- 9. only "/handoff" and "/pickup" are ever sent -----
  {
    const texts = new Set(), tasks = new Set();
    for (const scenario of ["happy", "unchanged", "startFail", "timeout"]) {
      const w = world(); w.add({ id: A });
      if (scenario === "unchanged") w.outcome[A] = { changeStamp: false };
      if (scenario === "startFail") w.startImpl = () => ({ ok: false, error: "no" });
      if (scenario === "timeout") w.outcome[A] = { turnMs: 20 * 60_000 };
      const h = w.round(); const s = await h.start({ id: A }); await w.wait(h, s.roundId);
      for (const c of w.of("answer")) texts.add(c.text);
      for (const c of w.of("start")) tasks.add(c.task);
      for (const c of w.calls) if (!["list", "answer", "start"].includes(c.fn)) texts.add("OTHER:" + c.fn);
    }
    check("only '/handoff' is ever sent into a chat", [...texts].length === 1 && texts.has("/handoff"), [...texts].join(","));
    check("only '/pickup' is ever started as a task", [...tasks].length === 1 && tasks.has("/pickup"), [...tasks].join(","));
  }

  // ----- 10. the defaults (no fakes beyond a temp folder; still no claude) -----
  {
    const fs = await import("node:fs"); const os = await import("node:os");
    const tmp = fs.mkdtempSync(join(os.tmpdir(), "hub-handoffround-"));
    try {
      fs.mkdirSync(join(tmp, "Alpha", ".claude"), { recursive: true }); fs.mkdirSync(join(tmp, "Beta"));
      fs.writeFileSync(join(tmp, "Alpha", ".claude", "handoff.md"), "x".repeat(12));
      const pf = projectFolderIn(tmp);
      check("default folder finder: exact names only, nothing outside the folder", pf("Alpha") === join(tmp, "Alpha") && pf("alpha") === null && pf("..") === null && pf("Alpha/../Beta") === null && pf("Gone") === null && pf(3) === null);
      const s1 = readHandoffStampFs(join(tmp, "Alpha"));
      check("default stamp reader: time and size of handoff.md; no file = null", s1 && s1.size === 12 && typeof s1.mtimeMs === "number" && readHandoffStampFs(join(tmp, "Beta")) === null);
      let threw = false; try { makeHandoffRound({}); } catch { threw = true; }
      check("making a round machine without the chat engine is refused", threw);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  console.log(`${ok}/${total}`);
  process.exit(ok === total ? 0 : 1);
}
