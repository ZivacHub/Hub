# Handoff: Hub   (updated 2026-11-12)
Git: main @ 2f8d3f6 "Step 13.4: game-mode strip with off-for-now and ignore buttons, ignore list, tests, screenshots" · pushed: yes (repo ZivacHub/Hub is PUBLIC, D21) · uncommitted: only this handoff (committed and pushed right after)

## Where we are in the plan
Phase 11 of 14 is the first unfinished phase on the board (11.5 and 11.6 need Ivan), but at his word ("Phase 13 gate now") Phase 13 "Game mode" was started ahead of it: gate passed 2026-11-12, 13.1 to 13.4 done. Steps done 33/69. Phases 3, 6 and 12 are CLOSED. Next in Phase 13: 13.5 smoothness test. Plan v2: dashboard first, voice track optional at the bottom (D19).
(Copied from docs/plan/BOARD.md.)

## What we're building
A local dashboard of all BUSNUS projects: cards, waiting decisions, chats waiting for Ivan, Running now and "Everything is done", Claude's latest words, the Manager card, light/dark, Start / Stop / Open in Claude Code / "Start with PC" per project (always asks first). Now: a game mode that calms what the Hub started while Ivan plays (League of Legends mostly). Public on GitHub for his CV. Jarvis voice is optional, in its own chat. Ivan's words: docs/PRODUCT.md.

## Last session (2026-11-12, all pushed)
- 13.1 game detection: config/games.json, tools/dashboard/lib/game.mjs, lib/probe.ps1 (one long-lived PowerShell, ends when the server ends), GET /api/game. League counts only when "League of Legends.exe" runs, not the Riot client (seen live: "The Riot client is open but no game is running"). Only League, Roblox and Asphalt Legends are really installed.
- 13.2 slow-down: lib/throttle.ps1 + throttle.mjs + config/throttle.json (25 percent = last 5 of 20 processors, lowest priority, 2 GB memory ceiling), exact restore, recovery after a restart; end-to-end on the real server with a stand-in game (HUB_GAMES_CONFIG) and the real Learning Script Maker.
- 13.3 pauses: lib/pauses.mjs (docker pause/unpause of openshorts-backend by exact name, Ollama models unloaded; they load again by themselves), throttle.ps1 suspend/resume for programs flagged "usesGpu" in config/projects.json (none flagged). Tests: pauses 19/19, throttle 31/31, end-to-end with a pretend Ollama and the real docker tool. NOT tested on the real openshorts container or real Ollama: Docker Desktop's engine does not start on this PC ("Docker Desktop is unable to start", WSL error) and Ollama is not running.
- 13.4 dashboard strip: "Game mode is on · reason · since HH:MM" + what was slowed/frozen/paused; buttons "Turn game mode off for now" and "Ignore this app" (both ask first), "Turn it back on", ignored-apps list with "Stop ignoring". POST actions game-off, game-on, game-ignore, game-unignore (same guards); ignore list in data/game_ignore.json (git-ignored). Tests: game 42/42, server 21/21, end-to-end 14/14, real page driven with Playwright. Screenshots docs/screenshots/game-mode-*.png (sample data; `node tools/dashboard/server.mjs --demo --demo-game=on|overridden|ignored`). "Off for now" lasts until the game has ended once; a server restart forgets it.
- Bug caught on the way (13.2): probe.ps1 emptied its own watch list because PowerShell variable names ignore case; test detectors with a real stand-in (renamed node.exe), not only the shape of the answer.
- Left unfinished: 13.5, 13.6, 11.5, 11.6, Phase 10, Phase 4. Not yet seen live: a real League game.

## Next steps (strictly in order; step 1 is where the next session starts)
1. Step 13.5 smoothness test with a fake game load (grade standard; a script in tests/): a counting loop is the fake game (measure its speed alone), then a fake heavy background program started like a Hub program, once at normal priority and once slowed by the real throttle (tools/dashboard/lib/throttle.mjs engage with the 25 percent / last 5 processors setting). Done when: numbers on the board line show the fake game keeps at least 90 percent of its solo speed with the slow-down on, and how much less without it. Say honestly that Windows decides where a real game runs (the fake game is not pinned unless you state it). Report the numbers plainly even if the target is missed.
   Read first: docs/plan/phases/13-game-mode.md, tools/dashboard/lib/throttle.mjs
2. Then 13.6 milestone (Ivan plays League about 10 minutes with a background task running and says whether it was smooth). At that point also ask him: should a program get "usesGpu": true (freezing ClipForge would stop its scheduled posting while he plays)? And tell him Docker Desktop's engine does not start. Add the game strip to docs/reference/DESIGN.md when convenient.
3. 11.5 (Ivan runs Install Hub Autostart.bat, switches on "Start with PC" for one harmless project, restarts; he rarely turns the PC off: ask when it suits him) and 11.6; then Phase 10 (security pass over all routes including /api/game and the four game-mode actions) and Phase 4.
   Read first: docs/plan/phases/11-start-stop-projects.md, docs/reference/SECURITY_CHECKLIST.md

## Waiting on the owner
- 11.5/11.6: his install + restart + own try-out; closing the leftover "Claude Code - Hub" terminal window (if still open).
- 13.6 later: playing League with a background task running and saying whether it was smooth; his call on "usesGpu".
- Small: the LICENSE copyright line "Ivan (ZivacHub)" is my guess (D22); whether the internal notes (decisions, memory, handoff) should stay public (D21); whether chats older than 7 days should ever count as "waiting"; the session-start check offers a first-run audit (no AUDIT.md) and a template sync v3 to v5 (neither applied, ask him before either); the Hub holds about 150 MB in the background (server 61 + probe 87).
- D15 nicknames (tools/hub_status/aliases.json); step 2.6 demo and the offline backup model (voice track, Jarvis chat).
- Cleanup he can OK: C:\Users\Ivan\JarvisTrial\installed (893 MB) and the partial Ollama zip in JarvisTrial\ollama-new (564 MB).

## Gotchas a fresh session would get wrong (max 8, only things still true)
- The repo is PUBLIC and Ivan wants every update pushed: before each push list the files and scan for keys; keep real project text out of screenshots (shoot with `--demo`). Playwright writes .playwright-cli/ with page text: git-ignored, delete it.
- Folder rule: this chat owns tools/dashboard/, config/ and the dashboard docs; the Jarvis chat owns tools/jarvis_trial/; tools/hub_status/ is shared.
- D31: the Hub never slows or pauses anything it did not start, EXCEPT D37: the openshorts-backend container and Ollama's loaded model, only while a game is on. Claude chats, the browser (Opera about 3 GB) and everything else are never touched. Windows cannot read or cap per-program graphics use.
- A game is on only when the game program runs (League: "League of Legends.exe", not the Riot client) or a fullscreen non-ignored app runs with a busy graphics card; on = 1 sample for the list and 2 for fullscreen, off = 3 samples in a row (10 s apart).
- Strict Content-Security-Policy: no inline styles or scripts. The POST route needs the per-run token, same Origin, JSON, confirm:true. After a dashboard restart the first page load takes several seconds; check the browser console after every UI edit. Ports: never 8765 or 8000; the Manager runs on 18000.
- Testing with a stand-in game: a renamed copy of node.exe listed in a temporary games file via HUB_GAMES_CONFIG (and HUB_THROTTLE_CONFIG for a pretend Ollama); write that file with node, not PowerShell Set-Content (it adds a BOM the server cannot parse). Keep PowerShell polling loops short (tool timeout 150 s).
- The permission system blocked killing a process tree (taskkill /T): do not work around it. Windows start-up is changed only by Ivan running Install Hub Autostart.bat. Memory is tight (11 to 14 of 15.6 GB): gh and node crashed once with "cannot allocate memory"; retry one at a time.
- In git bash, node -e with apostrophes breaks: write scripts to the scratchpad and run them; write files with the Write tool. Voice track (Jarvis chat): start with tools/jarvis_trial/start_jarvis_trial.ps1, never Jarvis.exe alone; the Gemini key file is never printed or committed.

## Running / not committed
- Services running: the real dashboard on http://127.0.0.1:4780 (started by this chat, hidden window; stop node on that port) with its game probe (a PowerShell that ends by itself when the server ends); the Jarvis chat's services may still run  ·  Not committed: this handoff until the push right after this file
