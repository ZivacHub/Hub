# Phase 15 — Managers and helpers (Ivan's wish 2026-11-15)
Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file holds the detail. A pickup reads only the CURRENT phase's file.

## Ivan's words (2026-11-15)
> "the overview I asked for, a Hub screen that shows for every project the manager and its helpers (which task went to which model, and whether it is running, done, waiting for the manager's check, or waiting for me), read from the helper records (node ~/.claude/hooks/helpers.mjs list --all). Add it to the plan as a phase (this is my OK), run the phase gate with the hand-out list, then do the whole phase."

## Purpose in plain words
Since 2026-11-13 the main chat of a project is a "manager": it hands tasks to helper chats on cheaper models and checks their work. Every hand-out leaves a small record file in that project (`.claude/helpers/`). This phase shows those records on the Hub: per project, each manager chat and under it its helpers: the task, which model got it, and whether it is running, done, waiting for the manager's check, or waiting for Ivan. Look only: no buttons that change anything.

## Read first (when working on this phase)
- This file (the data shape below is the contract between the steps).
- `~/.claude/hooks/lib/helpers.mjs` (the record format and the status words), `~/.claude/hooks/helpers.mjs` (the command Ivan named).
- tools/dashboard/server.mjs (how a GET route and its sample-data twin are added), tools/dashboard/lib/data.mjs (redact(), how chat files are found), tools/dashboard/public/app.js + style.css (the page's building blocks and design tokens).

## Where the data comes from
- One JSON file per task in `<project>/.claude/helpers/<id>.json`, written by the Claude Code hooks (not by the Hub). Fields used: id, step, title, grade, model, effort, owns, status (running / review / passed / failed / parked), startedAt, finishedAt, sessionId (the manager chat that started it), retryOf, check {result, note}, tokens, toolCalls, seconds, note.
- The Hub reads them with the same library functions the command `node ~/.claude/hooks/helpers.mjs list --all` uses (listRecords + the project list), in-process, so the Hub stays tiny; the self-test proves the feed and the command agree.
- The manager chat: found by `sessionId` among the saved chat files (`~/.claude/projects/<encoded project path>*/<sessionId>.jsonl`, read-only): its title, its model, when it was last active.

## The data shape (contract; `GET /api/helpers`)
```
{ generatedAt: ISO, demo?: true,
  totals: { running, stuck, review, parked, failed, done },
  projects: [                       // only projects with at least one record; those needing attention first, then newest activity
    { project: "Hub",               // the workshop's records show as "BUSNUS workshop"
      counts: { running, stuck, review, parked, failed, done },
      managers: [                   // one per manager chat, newest first; records with no sessionId go under one manager with id null
        { id: "a1b2c3d4" | null,    // first 8 characters of the chat id
          chat: "Hub · 15.1 feed · 15 Nov 14:30" | null,   // chat title when found
          model: "Fable 5.2" | null,                        // plain name made from the chat's model id
          lastActive: ISO | null,
          tasks: [ { id, step, title, grade, model, effort, state, since, finishedAt, seconds, tokens, toolCalls, owns: [..], note, retryOf } ] } ] } ] }
```
- `state` is one of: `running`, `stuck` (running for over 2 hours), `review` (waiting for the manager's check), `parked` (waiting for Ivan), `failed` (failed the check), `done` (passed the check).
- `note`: for parked = why it waits; for done / failed = the manager's check note; otherwise "".
- Task order inside a manager: parked, review, failed, stuck, running, done; newest first inside each.
- Every text (title, note, chat, owns) goes through `redact()` and is clipped (title 120, note 300 characters). At most 300 tasks in total, newest first.
- Words on the page: Running · Stuck (running over 2 hours) · Waiting for the manager's check · Waiting for you · Failed the check · Done.

## Steps (grades judged on the spot 2026-11-15)
**15.1 Helper-records feed** — Grade: standard (a feature with a clear contract and a pattern to follow). Use: new tools/dashboard/lib/helpers.mjs: a pure `shapeHelpers(records, opts)` that builds the shape above, and `readHelpers()` that loads the records of every project and looks the manager chats up. Done when: the shape above comes out for made-up records of every state and for the real records on this PC. Test: `node tools/dashboard/lib/helpers.mjs --selftest` (every state, stuck after 2 hours, grouping by manager, both orders, redaction, clipping, the 300 cap, and the real feed has exactly the ids that `node ~/.claude/hooks/helpers.mjs list --json --all` prints). Decisions needed: none.
**15.2 Sample data for screenshots** — Grade: light (made-up data in a fixed shape, checked by one command). Use: new tools/dashboard/demo/helpers.json in the shape above: 3 made-up projects, 4 manager chats, about 14 tasks, every state at least once, no real names or paths. Done when: the file parses and covers every state. Test: a node check script (parses, 3 projects, all six states, totals equal the counted tasks). Decisions needed: none.
**15.3 The /api/helpers route** — Grade: light (copies the pattern of the other GET routes, checked by the server self-test). Use: tools/dashboard/server.mjs: `/api/helpers` returns readHelpers() (real) or demo/helpers.json with fresh times (sample data); two self-test lines. Done when: both modes answer with the shape. Test: `node tools/dashboard/server.mjs --selftest` all OK (old lines too) and a GET against `--demo`. Decisions needed: none.
**15.4 A line on the main page** — Grade: standard (page code inside the existing design). Use: public/app.js, index.html, style.css: a small "Helpers" panel in the side column ("2 running · 1 waiting for the manager's check · 1 waiting for you", or "No helper tasks yet"), linking to the Helpers screen; hidden parts stay quiet when a count is 0. Done when: the line shows the totals and the link opens the screen. Test: page loaded in sample-data mode shows the panel with the sample totals; console clean. Decisions needed: D42 (where the screen lives).
**15.5 The Helpers screen** — Grade: standard (a screen built from the existing page's parts; design skills: impeccable + frontend-design). Use: new public/helpers.html, helpers.js, helpers.css (same header, theme switch and tokens as the main page): per project a block, per manager chat a row (chat name, model, last active), under it its tasks: step, title, who got it (model, effort), state as a labelled tag, how long ago or how long it took, the note; finished tasks older than 7 days behind "Show older"; refreshes by itself; light and dark; phone width. Done when: Ivan can read from it, without explanation, who is doing what and what waits for him. Test: screenshots in sample-data mode (light, dark, phone width) looked at by the manager; console clean; the empty state ("No helper tasks yet") checked. Decisions needed: D42.
**15.6 README and docs** — Grade: light (docs from given facts). Use: README bullet + screenshot link, CLAUDE.md "Current state" line. Done when: both name the screen and how to open it. Test: the links resolve. Decisions needed: none.
**15.7 Milestone** — Grade: light (needs Ivan). Done when: Ivan looks at the screen with this phase's real records on it and says what to change. Test: his words.

## Risks and open points (only for this phase)
- A manager chat's title is only in its saved chat file when the app wrote one; otherwise the screen says "Manager chat" with the start time.
- Records are written by hooks in the chat's project; a helper started outside a BUSNUS project leaves no record and can not be shown.
- "Stuck" is only a guess from time (over 2 hours): the screen says so.
- The repo is public: screenshots only in sample-data mode; the record files themselves stay off GitHub (D43 default).

## Phase gate record
- Plain-words preview, search result, questions (D42, D43) and the hand-out list shown 2026-11-15. Search: GitHub (atc-claude-kanban, claude-code-kanban, claudedash, agents-observe, Mohano, claude-code-karma) and the skills catalog ("subagent monitor dashboard", "agent task board"); ideas only, nothing adopted, no code copied. Decisions: D42 (own screen + a line), D43 (five defaults accepted). The owner's go: 2026-11-15 ("Go, whole phase").
- Phase close 2026-11-16: six helper tasks, all passed at the first try (Sonnet: 15.1, 15.4, 15.5; Haiku: 15.2, 15.3, 15.6); Ivan on the live screen: "Looks good, close it". Left as is: long check notes on the screen; a parked step shows under "No manager chat recorded" (the park command saves no chat id; a workshop matter).
