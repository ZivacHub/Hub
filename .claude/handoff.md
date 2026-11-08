# Handoff: Hub   (updated 2026-11-08)
Git: main @ e4f8ffc "Look approved (3.2, D26): dashboard done as a showcase" · pushed: yes (repo ZivacHub/Hub is PUBLIC, D21) · uncommitted: the 11.3/11.4 proofs and this handoff (committed and pushed right after)

## Where we are in the plan
Phase 3 of 12 — Dashboard page, in progress. Steps done 19/58 (Phase 0; 3.1, 3.2, 3.3, 3.6, 3.7; 6.4; 11.1 to 11.4). Next per plan order: 3.5 (the Manager running for real), then 3.8. Phase 11 (start/stop projects, D23 to D25) is placed right after Phase 3 and has 11.5 and 11.6 left. Plan v2: dashboard first, voice track optional at the bottom (D19). The dashboard showcase is finished and public (D26).
(Copied from docs/plan/BOARD.md.)

## What we're building
A local dashboard of all BUSNUS projects: cards, one list of waiting decisions, Claude's latest words, the Manager card, light by default with a dark switch, plus Start / Stop / Open in Claude Code / "Start with PC" per project (always asks "Start X?" first). Public on GitHub for Ivan's CV. Jarvis voice is optional, in its own chat. Ivan's words: docs/PRODUCT.md.

## Last session
- Pickup, then Ivan asked "Cant you test it?": Claude pressed the buttons on the real page. Learning Script Maker: Start > Yes gave Running in about 6 s (answers on 127.0.0.1:18767, listens only there), Stop > Yes closed the port and left no process. Open in Claude Code on the Hub card opened a terminal "Claude Code - Hub - claude". Ticked 11.4; proofs on the board lines of 11.3 and 11.4.
- Found in the Manager's start-up code: every start deletes leftover throwaway "run-*" projects (now: AI_Orcestration/ai_company/projects/run-2f1ed04a). It starts no task and spends nothing. Ivan has NOT yet decided how to test the Manager.
- Left unfinished: 3.5 (needs his choice below), 3.8, 6.1/6.2 comparison with the app, 11.5 (his install + restart), 11.6, Phase 10 security pass. The terminal window "Claude Code - Hub" from the test is still open: Claude was not allowed to kill it; Ivan closes it.

## Next steps (strictly in order; step 1 is where the next session starts)
1. Step 3.5: ask Ivan to choose how to start the Manager: back up run-2f1ed04a first (copy outside AI_Orcestration) then Start from the Manager card, or Start as it is. Done when the Manager card says Running after Start and Not running after Stop (Claude may press the buttons itself once he chooses), then fix the 3.5 text on the board (it names /progress and /summary, which do not exist; the card uses /health, /goal, /queue) and tick 3.5.
   Read first: docs/plan/phases/03-dashboard-by-voice.md, docs/plan/phases/11-start-stop-projects.md
2. 11.5 and 11.6: Ivan double-clicks Install Hub Autostart.bat, switches on "Start with PC" for one harmless project (not ClipForge: it publishes on its own schedule while open), restarts the PC, and says whether it came up; he also tries Start on one project himself. Tick 11.5 and 11.6 with his word. Then 3.8 (his one-glance verdict).
3. Then compare "Claude last said" with the app for two projects (6.1/6.2), Phase 6 step 6.3, Phase 10 (security pass including the POST route, probe from a second website and the LAN).

## Waiting on the owner
- How to test the Manager (step 1), and closing the leftover "Claude Code - Hub" terminal window.
- Small: the LICENSE copyright line "Ivan (ZivacHub)" is my guess (D22); whether the internal notes (decisions, memory, handoff) should stay public (D21).
- D15 nicknames (tools/hub_status/aliases.json); step 2.6 demo and the offline backup model (voice track, Jarvis chat).
- Cleanup he can OK: C:\Users\Ivan\JarvisTrial\installed (893 MB) and the partial Ollama zip in JarvisTrial\ollama-new (564 MB).

## Gotchas a fresh session would get wrong (max 8, only things still true)
- The repo is PUBLIC and Ivan wants every update pushed: before each push list the files and scan for keys; keep real project text out of screenshots (shoot with `--demo`; real-page shots go to the scratchpad only). Playwright writes .playwright-cli/ with page text: git-ignored, delete it.
- Folder rule: this chat owns tools/dashboard/, config/projects.json and the dashboard docs; the Jarvis chat owns tools/jarvis_trial/; tools/hub_status/ is shared (the dashboard only imports it).
- Real mode needs Ivan's shared reader (~/.claude/hooks/lib/busnus.mjs); `--demo` is the only mode that runs elsewhere, and there the buttons answer "Sample data mode".
- Strict Content-Security-Policy: no inline styles or scripts (set widths with element.style). The POST route needs the per-run token (GET /api/session), same Origin, JSON, confirm:true.
- Ports: never 8765 (another chat's dev server). The Manager has /health, /goal, /queue (no /progress); its own server.py listens on 0.0.0.0, so the Hub starts uvicorn itself on 127.0.0.1. Stop only ends programs the Hub started (PID in data/hub_state.json, git-ignored).
- The permission system blocked killing a process tree (taskkill /T) for the test terminal: do not work around it; avoid tests that open windows you cannot close another way. In git bash, node -e with apostrophes breaks: write scripts to the scratchpad. Write files with the Write tool.
- Voice track (Jarvis chat): start with tools/jarvis_trial/start_jarvis_trial.ps1, never Jarvis.exe alone; C:\Users\Ivan\.config\jarvis\config.json holds the Gemini key, never print or commit it.
- Python in Hub is .venv\Scripts\python.exe (3.11.9), Node 24 for the dashboard; any download needs his yes and the size told first.

## Running / not committed
- Services running: the real dashboard on http://127.0.0.1:4780 (started by this chat; stop node on that port); a "Claude Code - Hub" terminal window left open by the test; the Jarvis chat's services may still run  ·  Not committed: the 11.3/11.4 proofs and this handoff until the push right after this file
