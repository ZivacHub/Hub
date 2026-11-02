# Phase 3 — Dashboard by voice
Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file holds the detail. A pickup reads only the CURRENT phase's file.

## Purpose in plain words
You say "Hey Jarvis, pull out the dashboard" and a clean modern page opens with one card per project: progress bar, next step, decisions waiting, handoff age. At the end you can look once and know where every project stands.

## Read first (when working on this phase)
- docs/reference/COMMANDS.md (the safe command list)
- docs/DECISIONS.md (D6, D8)

## Steps
**3.1 Local data feed for the dashboard** — Grade: standard. Use: the Python program from phase 2 offering the project list as JSON on this PC only (no open internet port, D8). Done when: opening the local address in a browser shows the JSON for all projects. Test: curl the address, compare with the 2.1 list; try it from another device on the network and see it refused. Decisions needed: none.
**3.2 Design direction for the dashboard (Ivan sees it)** — Grade: strong (design judgement and Ivan's taste). Use: frontend-design (baseline), impeccable (layout), design-taste-frontend only if a curated look is wanted; one design skill per role. Done when: Ivan sees one picture of the planned page (clean modern dashboard, D-look choice 2026-11-01) and approves or changes it. Test: screenshot shown. Decisions needed: Ivan's yes on the look.
**3.3 Build the dashboard page** — Grade: standard. Use: Node (D6), the approved design, playwright-cli for screenshots. Done when: the page shows every project as a card with real data, "not set up" cards for the 11 empty folders, and refreshes when the data changes. Test: screenshot at a laptop-size window compared with the approved design; data on the page equals the feed. Decisions needed: none.
**3.4 "Pull out the dashboard" by voice** — Grade: light (one new command). Use: the voice program starts the Node page if it isn't running and opens it. Done when: saying the phrase opens the page within 5 seconds. Test: three tries from a cold start. Decisions needed: none.
**3.5 Show the AI_Orcestration Manager on the dashboard** — Grade: standard (the Manager must still run; not tested since July). Use: the Manager's `/progress`, `/summary` over its local address. Done when: one extra card shows the Manager's current progress, or says plainly "Manager not running" and the Hub can start it. Test: start the Manager, see the card; stop it, see the message. Decisions needed: none (if the Manager is broken, a new decision whether to fix it first).

## Risks and open points (only for this phase)
- Two languages (D6): the Python program owns the data and voice; the Node page only displays. They talk through the local feed in 3.1.
- Reaching the Manager depends on its server working today; checked in 3.5.

## Phase gate record
- Plain-words preview shown: (not yet). Skills/repos search: (not yet). Decisions asked: look approval in 3.2. The owner's go: (not yet).
