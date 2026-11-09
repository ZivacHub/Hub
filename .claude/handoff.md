# Handoff: Hub   (updated 2026-11-09)
Git: main @ a71224c "Step 12.2: Running now panel on the dashboard" · pushed: yes (repo ZivacHub/Hub is PUBLIC, D21) · uncommitted: steps 12.3 and 12.4 and this handoff (committed and pushed right after)

## Where we are in the plan
Phase 11 of 14 — Start and stop projects from the dashboard, in progress (11.5 and 11.6 need Ivan). Steps done 27/69. Phases 3 and 6 are CLOSED. Beside it, with Ivan's OK ("Yes, start 12"), Phase 12 "Running now and done" is under way: 12.1, 12.2, 12.4 done, 12.3 built (live confirmation pending), 12.5 is his milestone. Phase 13 (Game mode) is next after that; its gate needs his game names, ceilings and which programs use the graphics card. Plan v2: dashboard first, voice track optional at the bottom (D19).
(Copied from docs/plan/BOARD.md.)

## What we're building
A local dashboard of all BUSNUS projects: cards, one list of waiting decisions, chats waiting for Ivan, a Running now panel with an "Everything is done" line, Claude's latest words, the Manager card, light by default with a dark switch, plus Start / Stop / Open in Claude Code / "Start with PC" per project (always asks first). Next: a game mode that slows the programs the Hub started while he plays (Phase 13). Public on GitHub for Ivan's CV. Jarvis voice is optional, in its own chat. Ivan's words: docs/PRODUCT.md.

## Last session
- Phase 12 gate passed (search shown, five defaults accepted: D32). 12.1: GET /api/running (tools/dashboard/lib/running.mjs; chats working, Hub-started programs, programs started outside the Hub from the Hub's list, Manager busy). 12.2: Running now panel (10 s refresh in front, 2 min hidden). 12.3 built: lib/done.mjs, lib/cpu.mjs (busy = at least 3 percent of a core; idle servers are not work), green "Everything is done · finished HH:MM" line and tab title; self-tests all pass. 12.4: measured and fixed: page open cost 6.6 percent of a core before, 0.83 percent after; 0 percent and 55 MB with no page open.
- Lessons: Ivan's answers to the app's question boxes arrive as tool results, so "work since" counts from the last 10-minute pause; a module variable named `running` was shadowed in render() and froze the page (check the console after each UI edit); polling cost must be measured (first version 8x too costly).
- Left unfinished: 12.3 live proof (a background logger polls /api/running every 30 s into the scratchpad file done-log.txt; after this chat's turn ends the line should show allDone true with the time the last work was seen; read it first, then tick 12.3), 12.5 (Ivan watches the panel with real work), 11.5, 11.6, Phase 13, Phase 10.

## Next steps (strictly in order; step 1 is where the next session starts)
1. Step 12.3: read the scratchpad file done-log.txt (or call GET /api/running on http://127.0.0.1:4780): when no chat is working and nothing the Hub started is busy for 2 minutes, `done.allDone` must be true with a `finishedAt`; if true, tick 12.3 with that proof (and check that this chat shows as working again while a turn runs). Then 12.5: Ivan watches the Running now panel while real work runs and says what to change.
   Read first: docs/plan/phases/12-running-now-and-done.md, docs/DECISIONS.md
2. Step 11.5: ask Ivan to double-click Install Hub Autostart.bat, switch on "Start with PC" for ONE harmless project (not ClipForge: it publishes on its own schedule while open), restart the PC, and say whether it came up (he rarely turns the PC off: ask when it suits him); then 11.6 (his own try-out).
   Read first: docs/plan/phases/11-start-stop-projects.md, docs/reference/SECURITY_CHECKLIST.md
3. Phase 13 gate: plain preview, a visible search (Windows Game Mode, Process Lasso ideas), his game names and ignore list, his ceilings (proposed 25 percent processor, 2 GB), which of his programs use the graphics card; then 13.1 Detect a game. Then Phase 10 (security pass over all routes) and Phase 4.
   Read first: docs/plan/phases/13-game-mode.md, docs/DECISIONS.md

## Waiting on the owner
- 12.5: his look at the Running now panel with real work; 11.5/11.6: his install + restart + own try-out; closing the leftover "Claude Code - Hub" terminal window (if still open).
- For Phase 13: his game names, ceilings, which programs use the graphics card.
- Small: the LICENSE copyright line "Ivan (ZivacHub)" is my guess (D22); whether the internal notes (decisions, memory, handoff) should stay public (D21); whether chats older than 7 days should ever count as "waiting".
- D15 nicknames (tools/hub_status/aliases.json); step 2.6 demo and the offline backup model (voice track, Jarvis chat).
- Cleanup he can OK: C:\Users\Ivan\JarvisTrial\installed (893 MB) and the partial Ollama zip in JarvisTrial\ollama-new (564 MB).

## Gotchas a fresh session would get wrong (max 8, only things still true)
- The repo is PUBLIC and Ivan wants every update pushed: before each push list the files and scan for keys; keep real project text out of screenshots (shoot with `--demo`; real-page shots go to the scratchpad only). Playwright writes .playwright-cli/ with page text: git-ignored, delete it.
- Folder rule: this chat owns tools/dashboard/, config/projects.json and the dashboard docs; the Jarvis chat owns tools/jarvis_trial/; tools/hub_status/ is shared (the dashboard only imports it).
- Real mode needs Ivan's shared reader (~/.claude/hooks/lib/busnus.mjs); `--demo` is the only mode that runs elsewhere, and there the buttons answer "Sample data mode".
- Strict Content-Security-Policy: no inline styles or scripts. The POST route needs the per-run token (GET /api/session), same Origin, JSON, confirm:true. After a dashboard restart the first page load takes several seconds: wait before clicking in tests; check the browser console after every UI edit.
- Ports: never 8765 (another chat's dev server) and never 8000 (ClipForge's openshorts container). The Manager runs on 18000. Stop only ends programs the Hub started (PID in data/hub_state.json, git-ignored). D31: the Hub never slows or pauses anything it did not start (Claude chats, Docker, Ollama, the game). Windows cannot read or cap per-program graphics use; the app in front and total graphics load can be read.
- Saved chats (~/.claude/projects/<path with every non-letter/digit as a dash>/*.jsonl) are tens of MB: compare message times not file times, skip isSidechain messages. Answers to the app's question boxes are tool_result rows, not typed rows. Chat summaries are cached per file (path + modified time + size); the project scan is redone only when a watched document changed or after 5 minutes.
- The permission system blocked killing a process tree (taskkill /T): do not work around it. Windows start-up is changed only by Ivan running Install Hub Autostart.bat. In git bash, node -e with apostrophes breaks: write scripts to the scratchpad; write files with the Write tool.
- Voice track (Jarvis chat): start with tools/jarvis_trial/start_jarvis_trial.ps1, never Jarvis.exe alone; C:\Users\Ivan\.config\jarvis\config.json holds the Gemini key, never print or commit it.

## Running / not committed
- Services running: the real dashboard on http://127.0.0.1:4780 (started by this chat, hidden window; stop node on that port); a background logger writing done-log.txt in the scratchpad (ends by itself after about 8 minutes); the Manager and Learning Script Maker are stopped; the Jarvis chat's services may still run  ·  Not committed: steps 12.3 and 12.4 and this handoff until the push right after this file
