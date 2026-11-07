# Phase 11 — Start and stop projects from the dashboard
Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file holds the detail. A pickup reads only the CURRENT phase's file.

## Purpose in plain words
Each project card on the dashboard can start and stop that project's program, open the project in Claude Code, and (if Ivan ticks it) start together with the PC. He never opens a folder to launch something. Every start or stop asks "Start X?" first.

## Read first (when working on this phase)
- docs/DECISIONS.md (D23, D24, D25), docs/reference/SECURITY_CHECKLIST.md
- tools/dashboard/server.mjs, tools/dashboard/lib/control.mjs

## Projects hooked up first (Ivan, D23) and how each starts
- ClipForge (Socials Automatisation): node server/index.js, port 4317 (PORT). Warning: it runs its own scheduled publishing while open.
- Learning Script Maker: uv run python -m scriptmaker, port 8767 (SM_PORT; the file opens a browser itself).
- Automatic_Job_Application and Student_Job_Assistant (identical start.bat): run with NO_BROWSER=1, ports 8765 and 8766 (JOBS_PORT).
- AI_Orcestration Manager: ai_company .venv python -m uvicorn server:app --host 127.0.0.1 --port 8000 (its own file would listen on every network interface; the Hub starts it on this PC only).
Other projects' files are never edited: the Hub only runs their own start commands.

## Steps
**11.1 Project start list** — Grade: light. Use: config/projects.json (id, project folder, command, env, port, url, warning). Done when: the five entries load and each folder and start file exists. Test: a check script lists each entry and whether its command's program is found. Decisions needed: none.
**11.2 Start / stop engine with the safety rules** — Grade: strong (a page that starts programs). Use: tools/dashboard/lib/control.mjs; POST only with a per-run token, same origin, JSON content type, Host check; ids only from the list; no shell, no command text from the page; log to logs/hub_actions.log; Stop ends only what the Hub started (taskkill of that process tree); running = the port answers. Done when: a fake project started and stopped through the engine, and every refused request type is refused. Test: `node tools/dashboard/lib/control.mjs --selftest` and the server self-test (no token, wrong origin, wrong type, unknown id, unlisted action). Decisions needed: none.
**11.3 Start / Stop buttons with a question** — Grade: standard. Use: the card design from Phase 3. Done when: a card shows Running or Stopped, Start / Stop open "Start X? Yes / Cancel", the result is announced, no modal. Test: screenshots of each state; clicking Cancel does nothing. Decisions needed: none.
**11.4 "Open in Claude Code" button** — Grade: standard. Use: a new terminal window running `claude` in that project's folder (folder chosen by the server, never by the page). Done when: pressing it opens Claude Code in the right folder. Test: open for Hub and compare the folder. Decisions needed: none.
**11.5 Start with the PC** — Grade: strong (touches start-up). Use: `Install Hub Autostart.bat` / `Remove Hub Autostart.bat` in the root (Ivan runs them; Claude does not edit Windows start-up), a hidden launcher, `--boot` mode that starts the ticked projects after about 20 seconds, a switch per card stored in data/hub_state.json. Done when: after Ivan runs the install file and restarts, the Hub and the ticked project run. Test: restart with one harmless project ticked (the Manager or a fake one), see it Running. Decisions needed: none.
**11.6 Milestone** — Grade: light (needs Ivan). Done when: Ivan starts ClipForge from the page, opens a project in Claude Code, and says what to change. Test: his words.

## Risks and open points (only for this phase)
- Three apps defaulted to port 8765: the list gives each its own, and Start refuses if a port is already in use.
- ClipForge may publish while open; its start-up switch warns and stays off until ticked.
- A project's start can fail (missing Python environment, Docker not running): the error line is shown on the card from logs/<id>.log, nothing is retried silently.
- The Manager's own file listens on 0.0.0.0 and the key in its web mode is its own business; the Hub's command avoids that.

## Phase gate record
- Plain-words preview shown 2026-11-07 (the question card). Skills/repos search: reuses docs/reference/PRIOR_ART.md; nothing copied. Decisions asked: D23, D24, D25. The owner's go: 2026-11-07 (his answers).
