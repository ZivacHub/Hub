# Phase 13 — Game mode
Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file holds the detail. A pickup reads only the CURRENT phase's file.

## Purpose in plain words
When Ivan plays a game, the programs the Hub started slow down by themselves (lowest priority, fewer processor cores, a memory ceiling) and the graphics-heavy ones pause, so the game stays smooth while the rest of the work keeps crawling along. When the game ends everything goes back to normal.

## Read first (when working on this phase)
- docs/DECISIONS.md (D29, D30, D31), docs/reference/PC_FIT.md (the PC's numbers), tools/dashboard/lib/control.mjs

## What the PC can and cannot do (checked 2026-11-09)
- The app in front can be read (Windows user32). The graphics card's TOTAL use can be read (nvidia-smi); per-program graphics use is NOT available on Windows (N/A).
- Windows has no simple per-program graphics limit: graphics-heavy work can be paused, not capped.
- Memory is tight: 13.9 of 15.6 GB was in use with 21 Claude and 18 Node programs open; the Hub can only cap what it started.
- Services the Hub did not start (the openshorts Docker container on port 8000, Ollama) are never touched (D31).

## Steps
**13.1 Detect a game** — Grade: strong (a wrong guess slows the wrong things). Use: the app in front + fullscreen check + Ivan's game list + an ignore list (video players) + total graphics-card load; a small background helper that reports every few seconds. Done when: /api/game says on or off with the reason ("Game list: name" or "Fullscreen app with a busy graphics card"). Test: made-up cases in a self-test (list hit, fullscreen and busy, fullscreen and idle, ignored app, nothing); a real fullscreen window. Decisions needed: his game names and ignore list (phase gate).
**13.2 Slow-down engine** — Grade: strong. Use: for programs in config/projects.json that the Hub started: lowest priority, fewer processor cores (this limits the share of the processor), a memory ceiling (a Windows job object), restore on exit; the ceilings are his numbers (proposed: 25 percent of the processor, 2 GB). Done when: a fake program started by the Hub shows the lowered priority, cores and memory cap during game mode and the normal values after. Test: a fake heavy program through the engine and a check of its priority, cores and memory; then restore. Decisions needed: his ceilings (phase gate).
**13.3 Pause graphics-heavy programs** — Grade: strong. Use: a flag in config/projects.json per program (uses the graphics card yes or no, his word) and a suspend and resume of that program's processes. Done when: a flagged fake program is suspended while the game runs and resumes after. Test: fake flagged program, state checked before, during, after. Decisions needed: which of his programs use the graphics card (phase gate).
**13.4 Indicator and manual override** — Grade: standard. Done when: the dashboard shows "Game mode on (reason) · N programs slowed, M paused" and a button "Turn game mode off for now" (asks first) plus "Ignore this app". Test: screenshots in each state; the override survives a refresh. Decisions needed: none.
**13.5 Smoothness test with a fake game load** — Grade: standard. Use: a counting loop as the fake game, a fake heavy background program, once at normal priority and once slowed. Done when: the numbers show the fake game keeps a much higher share of its solo speed with the slow-down on (target: at least 90 percent). Test: the measurement on the board line. Decisions needed: none.
**13.6 Milestone** — Grade: light (needs Ivan). Done when: Ivan plays his game for about 10 minutes with a background task running and says whether it was smooth. Test: his words.

## Risks and open points (only for this phase)
- A fullscreen video or a browser game may look like a game: the ignore list and the manual button fix that.
- Memory caps can crash a program that really needs more: the ceiling is his number and a crash is reported on its card.
- Slowing a program that is writing files can leave half-written files: only programs he lists are touched, and "pause" is used for the heavy ones only.
- The game itself is never touched (D31 goes further: nothing the Hub did not start).

## Phase gate record
- Plain-words preview shown 2026-11-09 (the wishes and the questions). Skills/repos search: (to show before the first build step; ideas to check: Windows Game Mode, Process Lasso). Decisions asked: D29, D30, D31. The owner's go: plan approved 2026-11-09 ("Add both"); the phase gate itself, with his game list and ceilings, still runs when it starts.
