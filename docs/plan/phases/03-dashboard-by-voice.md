# Phase 3 — Dashboard page: project cards, waiting decisions, Manager card
Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file holds the detail. A pickup reads only the CURRENT phase's file.
(File name kept from the old title "Dashboard by voice"; the voice step moved out on 2026-11-07, D19.)

## Purpose in plain words
You open a clean page and see, at one glance, every BUSNUS project: a card each with progress bar, current step, decisions waiting and how old its last save-point is; one list of every question waiting on you; and a card for the AI_Orcestration Manager. Light by default, a switch for dark. The page only shows things: nothing on it can change a file (D20). Voice is not needed for any of this.

## Read first (when working on this phase)
- docs/DECISIONS.md (D6, D8, D19, D20), docs/reference/DESIGN.md
- tools/hub_status/status.mjs (the existing reader: `allProjects()` already returns every project's numbers)

## Folder rule (D19)
This chat owns `tools/dashboard/`. The Jarvis chat owns `tools/jarvis_trial/`. `tools/hub_status/` is shared and read-only for the dashboard (import it, do not edit it without telling the Jarvis chat).

## Steps
**3.1 Local data feed for the page (Node, this PC only)** — Grade: standard. Use: a small Node server in `tools/dashboard/` that imports `tools/hub_status/status.mjs` and serves `/api/projects` and `/api/decisions` as JSON on 127.0.0.1 only (no open internet port, D8). Done when: opening the local address in a browser shows JSON for all 16 projects with progress, next step, decisions waiting and handoff age. Test: curl compared with `busnus-status`; try the PC's network address from another device or `curl` with the LAN IP and see it refused. Decisions needed: none.
**3.2 Design direction (Ivan sees a light and a dark picture, light is default)** — Grade: strong (design judgement and Ivan's taste). Use: impeccable (layout) + frontend-design (baseline), one design skill per role; design-taste-frontend only if a curated look is wanted. Done when: Ivan sees one light and one dark picture of the same page (cards, decisions list, Manager card) and approves or changes it; tokens go into docs/reference/DESIGN.md. Test: screenshots shown to Ivan. Decisions needed: his yes on the look.
**3.3 Build the page: one card per project, "not set up" group, refreshes itself** — Grade: standard. Use: Node (D6), the approved design, playwright-cli for screenshots. Done when: every project with a plan is a card with real data; projects with no plan sit in a small "not set up" group at the bottom; the page updates by itself every 30 seconds without a reload. Test: screenshot at laptop size (1280) and narrow (375) against the approved design; data on the page equals the feed; edit a plan board and see the card change within a minute. Decisions needed: none.
**3.6 All waiting decisions in one list** — Grade: standard. Use: the decisions reader behind `decisionsSpoken` (tools/hub_status/status.mjs), extended to return the full text per decision. Done when: one list shows every open or proposed decision across all projects: project, title, the question, status. Test: the count equals the "decisions waiting" numbers on the cards and in `busnus-status`; screenshot. Decisions needed: none.
**3.5 Show the AI_Orcestration Manager on the dashboard** — Grade: standard (the Manager must still run; not tested since July). Use: the Manager's `/health` (identity: it reports queue_depth) and `/status` (queue by state, active goal, run_active) over its local address, port 18000 when the Hub starts it. (It has no /progress or /summary.) Done when: one card shows the Manager's current progress, or says plainly "Manager not running". Test: start the Manager, see the card; stop it, see the message. Decisions needed: none (if the Manager is broken, a choice card whether to fix it first).
**3.7 Light / dark switch (light by default, remembered)** — Grade: light. Use: CSS theme tokens from 3.2. Done when: first visit is light; a switch flips to dark and the choice is kept on reload; no unreadable text in either. Test: screenshots in both, reload keeps the choice. Decisions needed: none.
**3.8 Milestone: Ivan opens the page and says whether one glance tells him enough** — Grade: light (needs Ivan). Done when: Ivan says it shows what he wants, or lists what to change (changes become new steps). Test: Ivan's words in DECISIONS.md. Decisions needed: his verdict.
**3.4 (moved)** — "Pull out the dashboard" by voice now belongs to the optional voice track (D19). Not part of this phase.

## Risks and open points (only for this phase)
- The Manager's server may not start today (checked in 3.5).
- The reader takes numbers from each project's plan board; a project with an odd board shows a quiet "can't read this plan" card instead of failing.
- The other chat may edit `tools/hub_status/`; re-run the 3.1 comparison after each change there.

## Phase gate record
- Plain-words preview shown: 2026-11-07 (planning chat). Skills/repos search: reused docs/reference/PRIOR_ART.md (sniffly, claude-code-monitor, Stargx dashboard: ideas only, nothing copied); impeccable and frontend-design applied, design detector clean. Decisions asked: D19, D20. The owner's go: 2026-11-07 ("finish this project at least as demo" and "lets focus on dashboard itself"). Built in one pass, so the design picture (3.2) is shown after the build instead of before it; Ivan can still change it.
