# Handoff: Hub   (updated 2026-11-08)
Git: main @ 2e58d55 "Real Start/Stop test on Learning Script Maker, Open in Claude Code works (11.3, 11.4); Manager start-up finding" · pushed: yes (repo ZivacHub/Hub is PUBLIC, D21) · uncommitted: the Manager test (3.5), card fixes, new screenshots and this handoff (committed and pushed right after)

## Where we are in the plan
Phase 3 of 12 — Dashboard page, in progress. Steps done 20/58 (Phase 0; 3.1, 3.2, 3.3, 3.5, 3.6, 3.7; 6.4; 11.1 to 11.4). Next per plan order: 3.8 (Ivan's one-glance verdict). Phase 11 (start/stop projects, D23 to D25) has 11.5 and 11.6 left and needs Ivan. Plan v2: dashboard first, voice track optional at the bottom (D19). The dashboard showcase is finished and public (D26).
(Copied from docs/plan/BOARD.md.)

## What we're building
A local dashboard of all BUSNUS projects: cards, one list of waiting decisions, Claude's latest words, the Manager card, light by default with a dark switch, plus Start / Stop / Open in Claude Code / "Start with PC" per project (always asks "Start X?" first). Public on GitHub for Ivan's CV. Jarvis voice is optional, in its own chat. Ivan's words: docs/PRODUCT.md.

## Last session
- Ivan chose "Back up the leftover first" for the Manager test. The Manager itself said its start-up clean-up would delete nothing (so run-2f1ed04a was never at risk); backup made anyway in Hub/data/backups/manager-leftover-2026-11-08 (git-ignored).
- Found: port 8000 is ClipForge's openshorts-backend Docker container, not the Manager, so the card had falsely said "Running". Fixed: the Manager runs on port 18000 (config/projects.json), the card only trusts a service whose /health reports queue_depth, and it reads queue and goal from /status (pending tasks only).
- Claude pressed the buttons on the real page: Manager Start > Running in about 12 s (2 tasks waiting, idle, goal "Build a calculator"), Stop > port closed, card "Not running"; Hub still knew it had started it after a dashboard restart. Ticked 3.5 (proofs on its board line). Selftests: server 16/16, control 11/11.
- Left unfinished: 3.8, 6.1/6.2 comparison with the app, 11.5 (his install + restart), 11.6, Phase 10 security pass. The terminal window "Claude Code - Hub" from the earlier test may still be open: Claude was not allowed to kill it; Ivan closes it.

## Next steps (strictly in order; step 1 is where the next session starts)
1. Step 3.8: show Ivan the real dashboard (double-click Start Hub Dashboard.bat) and ask whether one glance tells him enough; done when he says yes or lists changes (changes become new steps with the next free numbers; write his words into docs/DECISIONS.md and tick 3.8, which closes Phase 3).
   Read first: docs/plan/phases/03-dashboard-by-voice.md, docs/plan/phases/11-start-stop-projects.md
2. 11.5 and 11.6: Ivan double-clicks Install Hub Autostart.bat, switches on "Start with PC" for one harmless project (not ClipForge: it publishes on its own schedule while open), restarts the PC, and says whether it came up; he also tries Start on one project himself. Tick 11.5 and 11.6 with his word.
3. Then compare "Claude last said" with the app for two projects (6.1/6.2), Phase 6 step 6.3, Phase 10 (security pass including the POST route, probe from a second website and the LAN).

## Waiting on the owner
- 3.8: his verdict on the one-glance view; 11.5/11.6: his install + restart + own try-out; closing the leftover "Claude Code - Hub" terminal window.
- Small: the LICENSE copyright line "Ivan (ZivacHub)" is my guess (D22); whether the internal notes (decisions, memory, handoff) should stay public (D21).
- D15 nicknames (tools/hub_status/aliases.json); step 2.6 demo and the offline backup model (voice track, Jarvis chat).
- Cleanup he can OK: C:\Users\Ivan\JarvisTrial\installed (893 MB) and the partial Ollama zip in JarvisTrial\ollama-new (564 MB).

## Gotchas a fresh session would get wrong (max 8, only things still true)
- The repo is PUBLIC and Ivan wants every update pushed: before each push list the files and scan for keys; keep real project text out of screenshots (shoot with `--demo`; real-page shots go to the scratchpad only). Playwright writes .playwright-cli/ with page text: git-ignored, delete it.
- Folder rule: this chat owns tools/dashboard/, config/projects.json and the dashboard docs; the Jarvis chat owns tools/jarvis_trial/; tools/hub_status/ is shared (the dashboard only imports it).
- Real mode needs Ivan's shared reader (~/.claude/hooks/lib/busnus.mjs); `--demo` is the only mode that runs elsewhere, and there the buttons answer "Sample data mode".
- Strict Content-Security-Policy: no inline styles or scripts (set widths with element.style). The POST route needs the per-run token (GET /api/session), same Origin, JSON, confirm:true. After a dashboard restart the first page load takes several seconds (it reads all projects): wait before clicking in tests.
- Ports: never 8765 (another chat's dev server) and never 8000 (ClipForge's openshorts container). The Manager runs on 18000 on 127.0.0.1 (its own server.py would listen on 0.0.0.0). Stop only ends programs the Hub started (PID in data/hub_state.json, git-ignored; survives a dashboard restart).
- The permission system blocked killing a process tree (taskkill /T) for the test terminal: do not work around it; avoid tests that open windows you cannot close another way. In git bash, node -e with apostrophes breaks: write scripts to the scratchpad. Write files with the Write tool.
- Voice track (Jarvis chat): start with tools/jarvis_trial/start_jarvis_trial.ps1, never Jarvis.exe alone; C:\Users\Ivan\.config\jarvis\config.json holds the Gemini key, never print or commit it.
- Python in Hub is .venv\Scripts\python.exe (3.11.9), Node 24 for the dashboard; any download needs his yes and the size told first.

## Running / not committed
- Services running: the real dashboard on http://127.0.0.1:4780 (started by this chat, hidden window; stop node on that port); the Manager and Learning Script Maker are stopped; the Jarvis chat's services may still run  ·  Not committed: the 3.5 proof, card fixes, screenshots and this handoff until the push right after this file
