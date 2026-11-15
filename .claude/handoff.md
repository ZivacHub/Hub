# Handoff: Hub   (updated 2026-11-15 17:25)
Git: main @ 2178ee9 "Phase 15 'Managers and helpers': Helpers screen and feed (15.1 to 15.6), main-page line, sample data, screenshots, D42 and D43" · pushed: yes (repo ZivacHub/Hub is PUBLIC, D21) · uncommitted: only this handoff and the memory entry (committed and pushed right after)

## Where we are in the plan
Phase 11 of 16 is the first unfinished phase on the board (next by board order: 11.5 Start with the PC, then 11.6; both need Ivan). Steps done 39/83, phases done 4/16. Worked ahead of it at Ivan's word (Change log 2026-11-15): Phase 15 "Managers and helpers", 6 of 7 steps done; only 15.7 (Ivan looks at the screen) is left, parked for him. Still open as before: Phase 13 (13.5, 13.6), Phase 14 (gate waits for D38 to D41), Phase 10, Phase 4.
(Copied from docs/plan/BOARD.md.)

## What we're building
A local dashboard of all BUSNUS projects: cards, waiting decisions, chats waiting for Ivan, Running now, Claude's latest words, the Manager card, Start / Stop / Open in Claude Code, game mode, and now a Helpers screen (per project: each manager chat and the helper tasks it handed out, with model and state). Public on GitHub for his CV. Jarvis voice is optional, in its own chat. Ivan's words: docs/PRODUCT.md.

## Last session (2026-11-15)
- Phase 15 added to the board at Ivan's word, gate passed (D42 own screen + a line, D43 five defaults, his go "Go, whole phase"), built in whole-phase mode with Sonnet and Haiku helpers; commit 2178ee9.
- 15.1 feed tools/dashboard/lib/helpers.mjs · 15.2 sample data demo/helpers.json · 15.3 GET /api/helpers in server.mjs · 15.4 "Helpers" panel on the main page · 15.5 the screen public/helpers.html + helpers.js + helpers.css · 15.6 README and CLAUDE.md. Every step ticked with proof on the board.
- All six helper tasks passed the manager's check at the first try (records: `node ~/.claude/hooks/helpers.mjs list .`).
- Left unfinished: 15.7. The dashboard running on port 4780 still runs the OLD server code (no /api/helpers there), and game mode was on (Ivan was playing League), so it was not restarted.

## Next steps (strictly in order; step 1 is where the next session starts)
1. 15.7 Milestone with Ivan: when no game is on (GET http://127.0.0.1:4780/api/game says "on": false), restart the dashboard (he closes its window and double-clicks Start Hub Dashboard.bat, or says "restart it"), open http://127.0.0.1:4780/helpers.html (or "Open the Helpers screen" in the side column), and ask what to change. Then `node ~/.claude/hooks/helpers.mjs unpark . 20261115-160936-15-7`, tick 15.7 and Phase 15 with his words, phase close. Done when: his words are on the 15.7 board line and Phase 15 is [x].
   Read first: docs/plan/phases/15-managers-and-helpers.md
2. Phase 14 gate: get Ivan's answers to D38 to D41 (choice cards; recommended: D38 both buttons, D39 auto mode like now, D40 see and open, D41 accept all), record his words, then build 14.1 to 14.6 (docs/plan/phases/14-run-chats-from-the-hub.md, docs/reference/CLAUDE_CONTROL.md).
3. Phase 13: 13.5 smoothness test (fake game loop, fake heavy program, target 90 percent of solo speed), 13.6 with Ivan (League about 10 minutes; a real League game was detected live on 2026-11-15, ask him how it felt).
4. 11.5 and 11.6 (his install file + restart, when it suits him), then Phase 10 (security pass over all routes, now including /api/helpers and helpers.html) and Phase 4.

## Waiting on the owner
- 15.7 Look at the Helpers screen with real records and say what to change (after a dashboard restart).
- D38 Where a chat started from the Hub runs (both buttons / Hub only / app only).
- D39 What a windowless chat may do without asking (auto like now / edit files only / ask on the Hub page).
- D40 How far the Hub goes with app chats (see and open / also a helper chat inside the app).
- D41 Five small defaults for Phase 14.
- D15 nicknames [proposed] (voice track). 11.5/11.6 install + restart. 13.6 playing League. Small: LICENSE line (D22), public internal notes (D21), first-run audit and template sync v3 to v6 offered by the start-up check (neither applied), cleanup of JarvisTrial leftovers (about 1.4 GB), Phase 14 test chats (D41).

## Gotchas a fresh session would get wrong (max 8, only things still true)
- NEVER send a message from outside (`claude -p --resume`) into a chat that `claude agents --json` shows as open: it splits the chat silently. After `claude stop`, wait until the list shows no pid.
- The repo is PUBLIC and Ivan wants every update pushed: list the files and scan for keys first; screenshots only with `--demo`. `.playwright-cli/`, `data/` and `.claude/helpers/` (the helper records) are git-ignored.
- New server routes need a restart of the dashboard on port 4780 (page files are read fresh, server code is not). Do not restart it while game mode is on, and never start a second real-mode server beside it (both would write the game-mode state files): test with `--demo` on a spare port (`HUB_PORT`), `--demo-helpers=empty` for the empty Helpers screen.
- Folder rule: this chat owns tools/dashboard/, config/ and the dashboard docs; the Jarvis chat owns tools/jarvis_trial/; tools/hub_status/ is shared.
- D31/D37: the Hub slows or pauses only what it started, plus the openshorts-backend container and Ollama's model during a game. Claude chats and the browser are never touched by game mode.
- Strict Content-Security-Policy: no inline styles or scripts. POST routes need the per-run token, same Origin, JSON, confirm:true. The Helpers screen is GET only. Ports: never 8765 or 8000; Manager on 18000; dashboard on 4780.
- Test files: write them with node, not PowerShell Set-Content (BOM). In git bash, node -e with apostrophes breaks: write a script to the scratchpad. Foreground `sleep` is blocked. A test script that spawns the server must wait for the child's exit before ending (else Node crashes on Windows). Ivan's answers over Remote Control: a question box may close with no text; then ask again in plain text with lettered options.
- The permission system blocked killing a process tree (taskkill /T): do not work around it. Windows start-up is changed only by Ivan running Install Hub Autostart.bat. Memory is tight (11 to 14 of 15.6 GB).

## Running / not committed
- Services running: the real dashboard on http://127.0.0.1:4780 (old code from 2026-11-12, game mode was on at 17:09); sample-data test servers on ports 4792 to 4796 stop by themselves within 20 minutes. Helper tasks: none running, none waiting for the manager's check; parked for Ivan: step 15.7 (record 20261115-160936-15-7).   ·   Not committed: nothing after the handoff commit
