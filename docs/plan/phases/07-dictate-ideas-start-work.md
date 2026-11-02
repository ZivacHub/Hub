# Phase 7 — Dictate ideas, start work
Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file holds the detail. A pickup reads only the CURRENT phase's file.

## Purpose in plain words
You say "Hey Jarvis, new idea: I want a dropshipping site with this and this..." and he writes it down. And you say "continue ClipForge" and he either opens that project's chat for you ("open") or runs it quietly in the background and tells you when it finishes ("quiet"). Nothing gets built from an idea; it only becomes a note ready for the planning interview.

## Read first (when working on this phase)
- docs/reference/COMMANDS.md
- `~/.claude/TOOLS.md` (how Claude can be started from a program)

## Steps
**7.1 Dictate a new idea into a note** — Grade: standard. Use: faster-whisper in a longer listening mode that ends on "that's all". Done when: the note is saved in `ideas/<date>-<title>.md` with Ivan's words as spoken (cleaned of "um"). Test: dictate a 1-minute idea, open the file. Decisions needed: none.
**7.2 Read back and confirm the note** — Grade: standard. Use: the read-back/yes rule from phase 4. Done when: Jarvis reads a short summary and the note is kept only after "yes", or deleted on "no". Test: both paths. Decisions needed: none.
**7.3 "Open" mode: open the project's Claude chat** — Grade: strong (starting Claude from outside; unknown how best on Windows). Use: the desktop app or terminal, claude command. Done when: "open ClipForge" opens a new chat in that project's folder, where the pickup start-up check runs. Test: say it for two projects. Decisions needed: a choice card on which way to open (app vs terminal) once tested.
**7.4 "Quiet" mode: run a task in the background and report back** — Grade: strong (runs Claude with real access to files). Use: the `claude` command in headless mode on the subscription, with permissions limited to the project folder and a time limit. Done when: "quietly run the next step of ClipForge" starts it after a read-back and yes, logs it, and Jarvis announces the result. Never publishes, spends money or deletes (PRODUCT non-negotiables). Test: a harmless task (7.5). Decisions needed: Ivan's go on the permission limits, as a choice card.
**7.5 Test with a harmless task** — Grade: standard. Use: a scratch project. Done when: a task that only writes a text file is started by voice, finished, and reported. Test: the file exists, the log has the entry, nothing else changed. Decisions needed: none.

## Risks and open points (only for this phase)
- Quiet runs use your subscription's allowance (same Pro limit as your chats); the Hub says when one starts.
- A quiet run can't ask you questions mid-way; it stops and reports if it needs you.

## Phase gate record
- Plain-words preview shown: (not yet). Skills/repos search: (not yet). Decisions asked: open-vs-quiet mechanics, permission limits. The owner's go: (not yet).
