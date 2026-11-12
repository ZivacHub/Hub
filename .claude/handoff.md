# Handoff: Hub   (updated 2026-11-12)
Git: main @ 8c016d5 "Step 13.1: game detection (list + fullscreen rule, League game not client), /api/game, probe" · pushed: yes (repo ZivacHub/Hub is PUBLIC, D21) · uncommitted: this handoff (committed and pushed right after)

## Where we are in the plan
Phase 11 of 14 is the first unfinished phase on the board (11.5 and 11.6 need Ivan), but at his word ("Phase 13 gate now") Phase 13 "Game mode" was started ahead of it: gate passed 2026-11-12, 13.1 done. Steps done 30/69. Phases 3, 6 and 12 are CLOSED. Next in Phase 13: 13.2 slow-down engine. Plan v2: dashboard first, voice track optional at the bottom (D19).
(Copied from docs/plan/BOARD.md.)

## What we're building
A local dashboard of all BUSNUS projects: cards, waiting decisions, chats waiting for Ivan, Running now and "Everything is done", Claude's latest words, the Manager card, light/dark, Start / Stop / Open in Claude Code / "Start with PC" per project (always asks first). Now: a game mode that slows what the Hub started while Ivan plays (League of Legends mostly). Public on GitHub for his CV. Jarvis voice is optional, in its own chat. Ivan's words: docs/PRODUCT.md.

## Last session
- Phase 12 closed (12.5 "Looks good", D33). Phase 13 gate: search shown (ThreadPilot AGPL, Winderust GPL, quick-fps-optimizer MIT: ideas only), decisions D34 (build in the Hub), D35 (ten games; League counts only when "League of Legends.exe" runs, NOT the Riot client), D36 (25 percent processor, 2 GB), D37 (exception to D31: pause the openshorts Docker container and unload Ollama's model while a game runs, resume afterwards).
- 13.1 built: config/games.json, tools/dashboard/lib/game.mjs (24/24 self-test incl. a real fullscreen window), lib/probe.ps1 (one long-lived PowerShell, exits when the server dies), GET /api/game (live: off). Only League of Legends, Roblox and Asphalt Legends are really installed; the other games' folders are empty leftovers (no program name yet; the fullscreen rule covers them).
- Cost of the always-on probe: 0.23 percent of a core, 87 MB; server 0 percent. Not yet seen live: a real League game.
- Left unfinished: 13.2 to 13.6, 11.5, 11.6, Phase 10. Open question to keep in mind: the Hub now holds about 150 MB in the background (server 61 + probe 87).

## Next steps (strictly in order; step 1 is where the next session starts)
1. Step 13.2 slow-down engine (grade strong): for programs the Hub started (PIDs from data/hub_state.json and their child processes): lowest priority, at most 25 percent of the processor (affinity on the LAST ~5 of 20 logical processors, which are the efficiency cores on this Intel chip), a per-process working-set cap (2 GB divided by the number of programs; gentler than a hard memory limit: extra pages go to disk, nothing crashes), restore exactly the saved originals when the game ends or when the server restarts mid-game (state in data/game_state.json). Settings in a file (his numbers, D36). Done when: a fake multi-threaded program started by the Hub shows the lowered priority, cores and working-set cap while a simulated game is on and the original values after; its total processor use drops to about 5 cores or less. Test with fake programs only first; never touch anything the Hub did not start (D31; the Docker/Ollama exception D37 is step 13.3).
   Read first: docs/plan/phases/13-game-mode.md, docs/DECISIONS.md
2. 13.3 pauses: the Hub's flagged programs (suspend/resume), the openshorts container (docker pause/unpause) and Ollama (unload loaded models via its API, GET /api/ps then keep_alive 0), only while a game is on; then 13.4 indicator + manual override on the dashboard (asks first), 13.5 smoothness test with a fake game load, 13.6 milestone (Ivan plays League with a background task running).
3. 11.5 (Ivan runs Install Hub Autostart.bat, switches on "Start with PC" for one harmless project, restarts; he rarely turns the PC off: ask when it suits him) and 11.6; then Phase 10 (security pass over all routes including /api/game and the new action endpoints) and Phase 4.
   Read first: docs/plan/phases/11-start-stop-projects.md, docs/reference/SECURITY_CHECKLIST.md

## Waiting on the owner
- 11.5/11.6: his install + restart + own try-out; closing the leftover "Claude Code - Hub" terminal window (if still open).
- 13.6 later: playing League with a background task running and saying whether it was smooth.
- Small: the LICENSE copyright line "Ivan (ZivacHub)" is my guess (D22); whether the internal notes (decisions, memory, handoff) should stay public (D21); whether chats older than 7 days should ever count as "waiting"; the session-start check offers a first-run audit (no AUDIT.md) and a template sync v3 to v4 (neither applied).
- D15 nicknames (tools/hub_status/aliases.json); step 2.6 demo and the offline backup model (voice track, Jarvis chat).
- Cleanup he can OK: C:\Users\Ivan\JarvisTrial\installed (893 MB) and the partial Ollama zip in JarvisTrial\ollama-new (564 MB).

## Gotchas a fresh session would get wrong (max 8, only things still true)
- The repo is PUBLIC and Ivan wants every update pushed: before each push list the files and scan for keys; keep real project text out of screenshots (shoot with `--demo`). Playwright writes .playwright-cli/ with page text: git-ignored, delete it.
- Folder rule: this chat owns tools/dashboard/, config/ and the dashboard docs; the Jarvis chat owns tools/jarvis_trial/; tools/hub_status/ is shared.
- D31: the Hub never slows or pauses anything it did not start, EXCEPT D37: the openshorts container and Ollama's loaded model, only while a game is on. Claude chats, the browser (Opera uses about 3 GB) and everything else are never touched. Windows cannot read or cap per-program graphics use; only the app in front and the total graphics load can be read.
- A game is on only when the game program runs (League: "League of Legends.exe", not the Riot client) or a fullscreen non-ignored app runs with a busy graphics card; on = 1 sample for the list and 2 for fullscreen, off = 3 samples in a row (10 s apart).
- Strict Content-Security-Policy: no inline styles or scripts. The POST route needs the per-run token, same Origin, JSON, confirm:true. After a dashboard restart the first page load takes several seconds; check the browser console after every UI edit. Ports: never 8765 or 8000; the Manager runs on 18000.
- Saved chats: compare message times not file times, skip isSidechain, answers to question boxes are tool_result rows; summaries cached per file; the project scan is redone only when a watched document changed or after 5 minutes.
- The permission system blocked killing a process tree (taskkill /T): do not work around it. Windows start-up is changed only by Ivan running Install Hub Autostart.bat. Memory is tight (10.9 to 13.9 of 15.6 GB used): gh and node crashed once with "cannot allocate memory"; retry one at a time.
- Voice track (Jarvis chat): start with tools/jarvis_trial/start_jarvis_trial.ps1, never Jarvis.exe alone; the Gemini key file is never printed or committed. In git bash, node -e with apostrophes breaks: write scripts to the scratchpad; write files with the Write tool.

## Running / not committed
- Services running: the real dashboard on http://127.0.0.1:4780 (started by this chat, hidden window; stop node on that port) with its game probe (a PowerShell that ends by itself when the server ends); the Jarvis chat's services may still run  ·  Not committed: this handoff until the push right after this file
