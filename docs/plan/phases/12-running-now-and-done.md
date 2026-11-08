# Phase 12 — Running now and done
Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file holds the detail. A pickup reads only the CURRENT phase's file.

## Purpose in plain words
One panel on the dashboard says what is working right now: the programs the Hub started, the Claude chats that are busy, and the Manager's queue. When nothing is working any more, the dashboard says "Everything is done" (it never shuts the PC down: D28). The Hub itself stays tiny.

## Read first (when working on this phase)
- docs/DECISIONS.md (D28, D31), tools/dashboard/lib/control.mjs, tools/dashboard/lib/attention.mjs

## Steps
**12.1 List what is running** — Grade: standard. Use: the start/stop engine's runtime (programs the Hub started), the chat classifier's "working" state (a chat whose last row is mid-turn and under 30 minutes old), the Manager's /status (run_active, pending), and a read-only look at which node, python and claude processes have a project folder in their command line. Done when: /api/running returns one row per thing: project, kind (program, chat, manager, process), since when. Test: start Learning Script Maker from the page and keep this chat working: both appear; stop it and finish the turn: both disappear. Decisions needed: none.
**12.2 "Running now" panel** — Grade: standard. Use: the page design from Phase 3. Done when: a panel in the side column lists the rows with how long each has run, says "Nothing is running" when empty, and updates by itself. Test: screenshots with real work and with nothing; sample-data version for the README. Decisions needed: none.
**12.3 "Everything is done" notice** — Grade: standard. Use: 12.1's list. Done when: when the list has been empty for 2 minutes after something was running, a calm notice appears ("Everything is done · finished 14:32") and clears when new work starts; chats that only wait for Ivan do not count as running. Test: made-up cases in a self-test (running, just stopped, empty for 2 minutes, new work starts) plus one real run. Decisions needed: none (D28 decided: only tell).
**12.4 Keep the Hub quiet** — Grade: light. Use: measure memory and processor of the dashboard server with the page open, hidden and closed; refresh every 2 minutes while the tab is hidden. Done when: the numbers are on the board line and the server stays under its measured idle (92 MB, 0 percent processor on 2026-11-09). Test: the measurement. Decisions needed: none.
**12.5 Milestone** — Grade: light (needs Ivan). Done when: Ivan watches the panel while real work runs and says what to change. Test: his words.

## Risks and open points (only for this phase)
- A chat that is thinking for a long time looks the same as a stuck one: "working" means "last row is mid-turn and under 30 minutes old".
- Looking at other programs' command lines is read-only but must not show secrets: only project name and kind are shown, never the command line.
- D31: programs that are not the Hub's are shown, never touched.

## Phase gate record
- Plain-words preview shown 2026-11-09 (the wishes and the questions). Skills/repos search: (to show before the first build step). Decisions asked: D28, D31. The owner's go: plan approved 2026-11-09 ("Add both"); the phase gate itself still runs when it starts.
