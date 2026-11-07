# Handoff: Hub   (updated 2026-11-07)
Git: main @ 5b880bc "Phase 11: Start / Stop / Open in Claude Code buttons, start with PC (install files), launchers in root, README and plan updated" · pushed: yes (repo ZivacHub/Hub is PUBLIC, D21) · uncommitted: the 3.2 approval and D26 (committed and pushed right after)

## Where we are in the plan
Phase 3 of 12 — Dashboard page, in progress. Steps done 17/58 (Phase 0; 3.1, 3.3, 3.6, 3.7; 6.4; 11.1, 11.2, 11.3). Look approved (3.2 ticked, D26) and the dashboard is done as a showcase; next per plan order: 3.5 (Manager running for real), then 3.8. Beside it Ivan asked for Phase 11 (start/stop projects, open in Claude Code, start with the PC; D23, D24, D25), placed right after Phase 3; 11.4 and 11.5 are built but need real tests with him (11.6). Plan v2: dashboard first, voice track optional at the bottom (D19).
(Copied from docs/plan/BOARD.md.)

## What we're building
A local dashboard of all BUSNUS projects: cards, one list of waiting decisions, Claude's latest words, the Manager card, light by default with a dark switch, plus Start / Stop / Open in Claude Code / "Start with PC" per project (always asks "Start X?" first). Public on GitHub for Ivan's CV. Jarvis voice is optional, in its own chat. Ivan's words: docs/PRODUCT.md.

## Last session
- Launchers in the project ROOT (Ivan insisted): Start Hub Dashboard.bat (starts the server, opens the browser when ready; `demo` for sample data; `boot` for Windows start-up), Install Hub Autostart.bat and Remove Hub Autostart.bat (he runs them; Claude never edits Windows start-up). Bug I caused and fixed: the moved bat kept its old folder path ("port is showing nothing").
- Phase 11 built: config/projects.json (5 projects, ports 4317 / 18767 / 18765 / 18766 / 8000), tools/dashboard/lib/control.mjs, POST /api/action in tools/dashboard/server.mjs, buttons in tools/dashboard/public/app.js. Proofs are on the board lines of 11.1 to 11.5 (control selftest 11/11, server selftest 16/16, installer tested into a temp folder, hidden boot launcher works).
- README rewritten for the new behaviour (it had claimed read-only); standing rule from Ivan: every update is pushed to GitHub after a file list and key scan.
- Left unfinished: 3.5 with the Manager actually started, 6.1/6.2 comparison with the app, 11.4 real press, 11.5 his install + restart, 11.6, Phase 10 security pass (probe from a second website and the LAN).

## Next steps (strictly in order; step 1 is where the next session starts)
1. Ask Ivan to try it for real: double-click Start Hub Dashboard.bat, press Start on ONE harmless project (Learning Script Maker or the Manager), then Stop; press Open in Claude Code on one card; done when he says each worked or lists what broke (11.3/11.4/11.6: tick 11.4 and 11.6 with his word). Look is approved (D26); 3.8 (his one-glance verdict) is still open.
   Read first: docs/plan/phases/11-start-stop-projects.md, docs/reference/SECURITY_CHECKLIST.md
2. 11.5: have him double-click Install Hub Autostart.bat, switch on "Start with PC" for one project, restart the PC and check it came up (then tick 11.5). ClipForge stays off until he ticks it himself (it publishes on its own schedule while open).
3. Then compare "Claude last said" with the app (6.1/6.2), check 3.5 against the running Manager, Phase 6 step 6.3, Phase 10 (security pass of the page including the POST route).

## Waiting on the owner
- 11.6: his try-out of Start / Stop / Open in Claude Code (look approved 2026-11-07, D26; showcase done).
- Small: the LICENSE copyright line "Ivan (ZivacHub)" is my guess (D22); whether the internal notes (decisions, memory, handoff) should stay public (D21).
- D15 nicknames (tools/hub_status/aliases.json); step 2.6 demo and the offline backup model (voice track, Jarvis chat).
- Cleanup he can OK: C:\Users\Ivan\JarvisTrial\installed (893 MB) and the partial Ollama zip in JarvisTrial\ollama-new (564 MB).

## Gotchas a fresh session would get wrong (max 8, only things still true)
- The repo is PUBLIC: before every push list the files and scan for keys; keep real project text out of screenshots (shoot with `--demo`). Playwright writes .playwright-cli/ with page text: it is git-ignored, delete it.
- Folder rule: this chat owns tools/dashboard/, config/projects.json and the dashboard docs; the Jarvis chat owns tools/jarvis_trial/; tools/hub_status/ is shared (the dashboard only imports it).
- Real mode needs Ivan's shared reader (~/.claude/hooks/lib/busnus.mjs); `--demo` is the only mode that runs elsewhere, and there the buttons answer "Sample data mode".
- Strict Content-Security-Policy: no inline styles or scripts (set widths with element.style). The POST route needs the per-run token (GET /api/session), same Origin, JSON, confirm:true.
- Ports: never 8765 (another chat's dev server and the old default of three apps). The Manager has /health, /goal, /queue (no /progress); its own server.py listens on 0.0.0.0, so the Hub starts uvicorn itself on 127.0.0.1. Stop only ends programs the Hub started (PID in data/hub_state.json, git-ignored).
- In git bash, node -e with apostrophes breaks: write the script to the scratchpad and run it. Write files with the Write tool; PowerShell Set-Content breaks non-ASCII.
- Voice track (Jarvis chat): start with tools/jarvis_trial/start_jarvis_trial.ps1, never Jarvis.exe alone; C:\Users\Ivan\.config\jarvis\config.json holds the Gemini key, never print or commit it.
- Python in Hub is .venv\Scripts\python.exe (3.11.9), Node 24 for the dashboard; any download needs his yes and the size told first.

## Running / not committed
- Services running: the real dashboard on http://127.0.0.1:4780, started by this chat (stop node on that port); the Jarvis chat's services may still run  ·  Not committed: Phase 11's page, launchers and docs until the push right after this file
