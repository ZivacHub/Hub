# Handoff: Hub   (updated 2026-11-12)
Git: main @ 6047cfa "Handoff: Phase 13 under way, 13.1 done" · pushed: yes (repo ZivacHub/Hub is PUBLIC, D21) · uncommitted: step 13.2 (throttle engine, wiring, probe fix) and this handoff (committed and pushed right after)

## Where we are in the plan
Phase 11 of 14 is the first unfinished phase on the board (11.5 and 11.6 need Ivan), but at his word ("Phase 13 gate now") Phase 13 "Game mode" was started ahead of it: gate passed 2026-11-12, 13.1 and 13.2 done. Steps done 31/69. Phases 3, 6 and 12 are CLOSED. Next in Phase 13: 13.3 pauses. Plan v2: dashboard first, voice track optional at the bottom (D19).
(Copied from docs/plan/BOARD.md.)

## What we're building
A local dashboard of all BUSNUS projects: cards, waiting decisions, chats waiting for Ivan, Running now and "Everything is done", Claude's latest words, the Manager card, light/dark, Start / Stop / Open in Claude Code / "Start with PC" per project (always asks first). Now: a game mode that slows what the Hub started while Ivan plays (League of Legends mostly). Public on GitHub for his CV. Jarvis voice is optional, in its own chat. Ivan's words: docs/PRODUCT.md.

## Last session
- Phase 12 closed (12.5 "Looks good", D33). Phase 13 gate: search shown (ThreadPilot AGPL, Winderust GPL, quick-fps-optimizer MIT: ideas only), decisions D34 (build in the Hub), D35 (ten games; League counts only when "League of Legends.exe" runs, NOT the Riot client), D36 (25 percent processor, 2 GB), D37 (exception to D31: pause the openshorts Docker container and unload Ollama's model while a game runs, resume afterwards).
- 13.1 built: config/games.json, tools/dashboard/lib/game.mjs (24/24 self-test incl. a real fullscreen window), lib/probe.ps1 (one long-lived PowerShell, exits when the server dies), GET /api/game (live: off). Only League of Legends, Roblox and Asphalt Legends are really installed; the other games' folders are empty leftovers (no program name yet; the fullscreen rule covers them).
- Cost of the always-on probe: 0.23 percent of a core, 87 MB; server 0 percent. Not yet seen live: a real League game (the Riot-client-only case WAS seen live: "The Riot client is open but no game is running").
- 13.2 built (lib/throttle.ps1 + throttle.mjs + config/throttle.json, wired into the server): fake program 9.8 cores to 4.6 under the 5-core ceiling, memory 500 to 297 MB under a 300 MB cap, exact restore, recovery after a restart; END-TO-END on the real server with a stand-in game (renamed node.exe listed in a temporary games file via HUB_GAMES_CONFIG) and the real Learning Script Maker: on within 11 s, all 4 processes Idle on the last 5 of 20 processors, restored exactly about 40 s after the game ended. The end-to-end run caught a real bug (probe.ps1 emptied its own watch list: $Watch and $watch are the same variable in PowerShell); fixed and tested with a real stand-in.
- Left unfinished: 13.3 to 13.6, 11.5, 11.6, Phase 10. Open question to keep in mind: the Hub now holds about 150 MB in the background (server 61 + probe 87).

## Next steps (strictly in order; step 1 is where the next session starts)
1. Step 13.3 pauses (grade strong; D37 exception): while a game is on, (a) programs the Hub started that are flagged as graphics users in config/projects.json get suspended and resumed (flag field to add; ClipForge first), (b) the openshorts Docker container (docker pause / unpause, name openshorts-backend) and (c) Ollama's loaded models (GET http://127.0.0.1:11434/api/ps, then POST /api/generate with keep_alive 0 for each) are paused/unloaded; everything resumes when the game ends or when the server restarts and finds the game gone (extend data/game_state.json). Only these two outside programs, never anything else (D31, D37); do nothing if they are not running. Done when: the flagged fake program is suspended and resumed; the real openshorts container is paused and unpaused and Ollama's model unloaded and reloadable (only if running), tested with a simulated game state (HUB_GAMES_CONFIG stand-in as in the end-to-end test) and resumed right after. Test notes: docker CLI must be on PATH; resume must be in a finally block.
   Read first: docs/plan/phases/13-game-mode.md, docs/DECISIONS.md
2. Then 13.4 indicator + manual override on the dashboard (asks first; show "Game mode on (reason), N programs slowed, M paused", a button to turn game mode off for now and "ignore this app"), 13.5 smoothness test with a fake game load (numbers with and without the slow-down; target at least 90 percent of solo speed), 13.6 milestone (Ivan plays League with a background task running).
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
