# Phase 2 — Project status by voice
Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file holds the detail. A pickup reads only the CURRENT phase's file.

## Purpose in plain words
You ask "Hey Jarvis, how is ClipForge going?" and he answers with the real phase, step, percent and decisions waiting, read from that project's own files. The model only picks WHICH question you asked; the answer comes from the files, so it can't make numbers up. This is the first milestone: you can already talk to it.

## Read first (when working on this phase)
- docs/DECISIONS.md (D2, D8)
- `~/.claude/hooks/lib/busnus.mjs` and `busnus-status` (existing scripts that already compute plan progress; reuse their logic, don't re-invent)

## Steps
**2.1 Read every project's status from its files** — Grade: standard (existing scripts show how). Use: Node/Python reading docs/plan/BOARD.md, docs/DECISIONS.md, .claude/handoff.md. Done when: one list shows each BUSNUS project with phase x of y, next step, decisions waiting, handoff age, or "not set up". Test: the list matches the output of `busnus-status` for the same projects. Decisions needed: none.
**2.2 Write the safe command list** — Grade: strong (this defines what Jarvis is allowed to do). Use: a plain table in docs/reference/COMMANDS.md. Done when: the list names each command, what it fetches, and whether it changes anything (in phase 2 none do). Starting list: status of one project, next step, decisions waiting, list projects, "what did you hear". Test: Ivan read it and said OK. Decisions needed: none (he approves the table).
**2.3 Local model picks the command (accuracy test)** — Grade: standard (fixed test file). Use: Ollama with the model chosen in 0.2/0.4. Done when: from 40 test sentences (including slang, mumbles, unknown requests) the model returns the right command in at least 90% and "didn't catch that" for unknown ones. Test: the test file run printed as a table with the score. Decisions needed: none.
**2.4 Project names and nicknames (ClipForge)** — Grade: light (a small lookup file). Use: a `aliases` file. Done when: "ClipForge" maps to Socials Automatisation, plus other nicknames Ivan wants. Test: say each nickname, the right project answers. Decisions needed: Ivan names nicknames (one question).
**2.5 Spoken answers built from real data** — Grade: standard. Use: templates filled by code, not by the model. Done when: answers are short plain sentences like "ClipForge is on phase 6 of 14, step 6.3 is next, two decisions are waiting". Test: compare the spoken text with the file contents for 3 projects. Decisions needed: none.
**2.6 Milestone demo: ask three questions by voice** — Grade: light (run the script and record). Use: the loop from 1.5. Done when: Ivan asks three real questions by voice and gets right answers. Test: recording or log shown to Ivan. Decisions needed: none.

## Risks and open points (only for this phase)
- Projects without workflow files (11 folders) have no plan board: Jarvis says "not set up".
- A mis-picked command is harmless here (everything is read-only), which is why this phase comes before any that change things.

## Phase gate record
- Plain-words preview shown: (not yet). Skills/repos search: (not yet). Decisions asked: none expected. The owner's go: (not yet).
