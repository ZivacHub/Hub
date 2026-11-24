Read when: building or changing the cost view (Phase 21).
# Phase 21, step 21.6: the cost view data (contract)

Goal (Ivan, point 4): "Cost view per project: tokens per chat and per phase, split main chat vs helpers, so I can see where tokens go."
Code: `tools/dashboard/lib/cost.mjs` (read-only; `node tools/dashboard/lib/cost.mjs --selftest`). Sample data: `tools/dashboard/demo/cost.json` (for `--demo`). The route and the page come in a later step.

## Call
```js
const cost = makeCost({ homeDir, bussnusRoot, projects: () => ["Hub", ...], now: () => Date.now(), readFileFn, helperRecords: (project) => [...] });
cost.forProject("Hub", { since: "2026-11-01" });   // since optional: date text or ms
cost.overview({ since });                          // { projects: [{ name, totals, chatCount }] }
```
Every argument has a default (`homeDir` = this user's home, `readFileFn` = read a text file, `helperRecords` = read `<project>/.claude/helpers/*.json`). Results are cached 60 seconds per project and `since`.

## Where the numbers come from
1. **Saved chats**: `~/.claude/projects/<project folder, every non-letter/digit turned into "-">/<sessionId>.jsonl` = the main chat. Its helpers (sub-agents) are in `<sessionId>/subagents/agent-<agentId>.jsonl`. Chat title = the last `custom-title` line (a title field, never a message).
2. **Each reply is counted once.** The log writes one line per content block of a reply, all with the same `requestId` (fallback `message.id`). The first line counts; if a repeat line shows a larger value for a field, the larger value is kept (the final one). Same rule as `~/.claude/hooks/token-report.mjs`. Replies with no id and `<synthetic>` replies are not counted (as there). The count runs over the whole chat, main and helper files together. Checked on this PC: per chat identical to `token-report.mjs --project hub`.
3. **Helper records** (`<project>/.claude/helpers/*.json`, written by the BUSNUS hooks): step id (`14.7`), session that started the task, agent id, start and end time, total tokens. Phase = the number before the dot of the step id; if the step is empty, a step-like `14.8` in the title is used; else the task is "not matched to a phase".
4. **Phase titles** from `docs/plan/BOARD.md` (lines like `- [x] Phase 14 — Title`), else `PLAN.md` (`## Phase 3: Title`). A missing file just means empty titles.

Never output: message text, file contents, account ids. Only numbers, session ids, chat titles, model names, phase titles.

## Weighting (the Hub's own rough number, not a price)
`weighted = fresh x 1 + cacheWrite x 1.25 + cacheRead x 0.1 + out x 5`. It only helps to rank "where do tokens go"; it is not money and not the app's limit meter.
Token kinds: `fresh` = new input, `cacheWrite` = text stored for re-use, `cacheRead` = stored text read again (huge numbers, cheap), `out` = what the model wrote.

## Output shape (forProject)
```json
{ "name": "Hub",
  "totals": { "main": T, "helpers": T, "all": T, "weighted": 11880980 },
  "chatCount": 4,
  "chats": [ { "sessionId": "...", "title": "Hub · 21.1 ...", "start": "ISO", "end": "ISO", "hours": 2.5,
               "main": T, "helpers": T, "helperCount": 2,
               "models": { "opus-5": 62, "sonnet-5-5": 38 },
               "phaseGuess": { "phase": 21, "share": 0.5, "basis": "time" } } ],
  "phases": [ { "phase": 14, "title": "Run my chats from the Hub",
                "helperTokens": T + { "recordedOnly": 0 }, "helperTasks": 2,
                "mainShare": { "tokens": T, "basis": "helpers" } },
              { "phase": null, "title": "Not matched to a phase", ... } ] }
```
`T` = `{ fresh, cacheWrite, cacheRead, out, replies, weighted }` (whole numbers). `models` = percent of the chat's replies (main and helpers together). `chats` is newest first (by last activity), at most 60; `chatCount` and `totals` cover all. `hours` = active time (pauses over 15 minutes not counted). `phases` is ordered by number, the "not matched" row (`phase: null`) last, and only lists phases that have helper tasks or main tokens. `since` skips chat files not modified since then (chat level: a chat that spans the date is counted whole).

## What is exact and what is an estimate
- **Exact** (counted from the logs): totals, per chat, main vs helpers, models, hours, and helper tokens per phase WHEN the task's agent file is found (record `agentId` = file name). `helperTokens.recordedOnly` = tokens the record claims for a task whose file is gone; it is a single total, not split by kind, and is NOT in `totals`.
- **Estimate** (never show as exact): which phase a MAIN-chat token belongs to. A chat's work is not tagged with a phase, so `mainShare` and `phaseGuess` are guesses, labelled by `basis`:
  - `helpers`: the chat started phased helper tasks; its main tokens are split in proportion to those tasks' tokens per phase.
  - `time`: no such tasks; each main reply is given to the phase of any phased helper task (from any chat) running at that moment (split equally when several phases overlap).
  - `unassigned`: nothing matched; the tokens go to the "not matched" row.
  - `mixed` (phase level only): shares from more than one basis. `none`: no main share.
- Helper files with no record (not started through the BUSNUS hooks) and records with no usable step go to the "not matched" row.
- The weighting numbers are the Hub's own.

## Row for docs/INDEX.md
`| docs/plan/phases/21-cost-view.md | Contract of the cost view data (shape, sources, weighting, exact vs estimate) | building or changing the cost view (Phase 21) |`
