# Docs index (Hub)
Every document with "read when". Keep this list current: new doc => new row, same change.

| File | Read when |
|---|---|
| docs/PRODUCT.md | always (the goal in Ivan's words) |
| docs/plan/BOARD.md | always (progress and rules) |
| docs/DECISIONS.md | always (open decisions on top); D-ids are named by steps |
| .claude/handoff.md | always (where we stopped, next steps) |
| docs/plan/phases/00-check-the-pc.md | working on Phase 0 |
| docs/plan/phases/01-ears-and-mouth.md | working on Phase 1 |
| docs/plan/phases/02-project-status-by-voice.md | working on Phase 2 |
| docs/plan/phases/09-continue-claude-chat-by-voice.md | working on Phase 9 (runs right after Phase 2) |
| docs/plan/phases/03-dashboard-by-voice.md | working on Phase 3 |
| docs/plan/phases/11-start-stop-projects.md | working on Phase 11 (start/stop projects from the dashboard, start with the PC) |
| docs/plan/phases/12-running-now-and-done.md | working on Phase 12 (running-now panel, everything-done notice, keep the Hub quiet) |
| docs/plan/phases/13-game-mode.md | working on Phase 13 (game detection, slow-down, pause, override) |
| docs/plan/phases/15-managers-and-helpers.md | working on Phase 15 (the Helpers screen: per project the manager chat and its helper tasks; holds the /api/helpers data shape) |
| docs/plan/phases/14-run-chats-from-the-hub.md | working on Phase 14 (start, see and answer Claude chats from the Hub page) |
| docs/plan/phases/16-17-18-app-work-reports.md | working on Phases 16 (Hub as its own app), 17 (work from the Hub) or 18 (phase reports): Ivan's words and open questions |
| docs/plan/phases/17-project-page.md | building or changing the project page (17.4) or its feed (GET /api/project) |
| docs/plan/phases/19-claude-in-the-hub.md | building or changing the Hub chat view (Phase 19) or its feeds (GET /api/chat-log: messages, context bar, meta, outputs) |
| docs/plan/phases/19-claude-in-the-hub-handoff.md | building or changing the hand-off round of Phase 19 ("Hand off and pick up": API, steps, exact messages) |
| docs/plan/phases/19-pictures-pins.md | wiring /api/chat-image, drawing pictures or file chips in the chat view, or the Hub pinned chats (feed blocks, picture reader, pins) |
| docs/plan/phases/19-attachments-fork.md | building or changing attachments or fork of Hub chats (Phase 19): upload store, pictures/files on start and answer, fork, refusal sentences |
| docs/plan/phases/19-slash-commands.md | building or changing the slash-command list of the Hub chat box (GET /api/commands: contract, sources, what is skipped) |
| docs/plan/phases/21-limits-and-cost.md | working on Phase 21 (usage meter, hand-off before the limit, settings per project, cost view): his words, what exists, proposed steps |
| docs/plan/phases/21-usage-meter.md | building or changing the usage meter (Phase 21): GET /api/usage shape, sources (claude / app history / estimate), levels, calibration, caching |
| docs/plan/phases/21-settings.md | building or changing the Hub settings (Phase 21): definitions, files written, GET /api/settings and settings-set contract |
| docs/plan/phases/21-cost-view.md | building or changing the cost view data (Phase 21): shape, sources, weighting, exact vs estimate |
| docs/reference/ORCHESTRATION_IDEAS.md | designing the Hub's usage meter, budget warnings, cost view or phase-report page (Phase 21, 18): ideas from Ivan's older orchestration project, no code |
| docs/plan/phases/10-dashboard-always-on.md | working on Phase 10 (dashboard starts with Windows, security pass) |
| docs/plan/phases/04-answer-decisions-by-voice.md | working on Phase 4 |
| docs/plan/phases/05-always-on-safely.md | working on Phase 5 |
| docs/plan/phases/06-claudes-answers-and-alerts.md | working on Phase 6 |
| docs/plan/phases/07-dictate-ideas-start-work.md | working on Phase 7 |
| docs/plan/phases/08-personality-and-clipforge.md | working on Phase 8 |
| docs/reference/PRIOR_ART.md | choosing or adopting any outside part (wake phrase, hearing, voice, dashboard ideas) |
| docs/reference/TASKS.md | starting a phase that could use parallel helpers, or closing a phase |
| docs/reference/COMMANDS.md | adding or changing what Jarvis may do (draft written 2026-11-03, step 2.2) |
| docs/reference/CLAUDE_CONTROL.md | anything that starts, shows, answers or steers a Claude chat from the Hub (Phase 14): what works from outside, what splits a chat, with the tests |
| docs/reference/PC_FIT.md (created in step 0.3) | deciding what loads when, or any memory problem |
| docs/screenshots/ | the README pictures (made-up sample data only, never real projects) |
| tools/dashboard/ | working on the dashboard code (server, readers, page, sample data) |
| CLAUDE.md | always (rules, stack, docs map) |
| docs/reference/ARCHITECTURE.md | adding a part or changing how the voice program and dashboard talk |
| docs/reference/DESIGN.md | working on the dashboard look |
| docs/reference/TESTING.md | writing or running a step test |
| docs/reference/SECURITY_CHECKLIST.md | the security phase (5.6) and before anything is shared |
