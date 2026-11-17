# Handoff: Hub   (updated 2026-11-17 05:00)
Git: main @ ed8ab83 "Handoff: test chats cleaned up with Ivan's yes" · pushed: yes (repo ZivacHub/Hub is PUBLIC, D21) · uncommitted: Phase 14 steps 14.8 and 14.9 (engine, data, page, README, board, this handoff, memory), committed and pushed right after this file is written

## Where we are in the plan
Phase 11 of 16 is still the first unfinished phase on the board (11.5 and 11.6 need Ivan). Steps done 48/85, phases done 5/16 (0, 3, 6, 12, 15). Worked ahead at Ivan's word: Phase 14 "Run my chats from the Hub": 14.1 to 14.6 done 2026-11-16, and two steps he asked for on 2026-11-17 (D44 to D46) done: 14.8 Hub chats follow the project workflow, 14.9 "Open this chat" instead of a new terminal chat. Only 14.7 (Ivan uses it) is left, parked for him. Open as before: Phase 13 (13.5, 13.6), Phase 10, Phase 4.
(Copied from docs/plan/BOARD.md.)

## What we're building
A local dashboard of all BUSNUS projects: cards, waiting decisions, chats waiting for Ivan, Running now, Helpers screen, game mode, and chats run from the page. Every card lists its Claude chats and has a New chat form: "Start here" (a windowless Hub chat that FIRST RUNS /pickup with the task and is named like his desktop chats, "Project · what it does · date time"; a tick skips this), "Start in the app", "Pick up", an optional Remote Control tick and a quiet "New terminal chat". A Hub chat opens a panel (reply, answer, Hand off, Pick up, Stop, Remote Control switch, Open in the app). Every chat waiting for him and every app chat has "Open this chat" (opens that exact chat in the app); app chats are never written into (D40/D46), they are answered in the app or from the phone through Remote Control. Public on GitHub for his CV. Jarvis voice is optional, in its own chat. Ivan's words: docs/PRODUCT.md.

## Last session (2026-11-16 to 17)
- Phase 15 closed; Phase 14 gate and 14.1 to 14.6 built (helper records: `node ~/.claude/hooks/helpers.mjs table . --since 2026-11-16`); on 2026-11-17 Ivan's screenshot of the app sidebar and his words led to D44 (workflow by default), D45 ("Open this chat", terminal button demoted), D46 (D40 stands) and steps 14.8 and 14.9, built with Sonnet helpers and checked by the manager. Details and lessons: .claude/memory.md (2026-11-16, 2026-11-17).
- The dashboard was restarted 2026-11-17 (`Start Hub Dashboard.bat nobrowser`, minimized window) and a REAL /pickup chat through it worked (windowless, cheapest model, 12 s, no file changed).
- Cleanup: all test chats of 2026-11-16 and the old ones deleted with Ivan's yes. One new harmless test chat exists (the /pickup run, session 579ca1e9-1cf0-4059-8c99-62f2ff44e3fd, in the Hub folder); delete with the next cleanup after his yes.
- Left unfinished: 14.7 (his use), refreshing the README screenshots that still show the old button, Phase 13 and the rest.

## Next steps (strictly in order; step 1 is where the next session starts)
1. 14.7 Milestone with Ivan: he opens http://127.0.0.1:4780, starts a small real task with "Start here" on a project card (it runs /pickup first), answers it from the panel, presses "Open this chat" on a chat waiting for him, tries "Start in the app" and WATCHES that the Claude app's new-chat page has folder and task filled in (test T6, never seen), and starts one chat with the Remote Control tick and opens it on his phone. Make his changes (page files are read fresh; a server file change needs a dashboard restart). Then `node ~/.claude/hooks/helpers.mjs unpark . 20261116-193726-14-7`, tick 14.7 and Phase 14 with his words, phase close. Done when: his words are on the 14.7 board line and Phase 14 is [x].
   Read first: docs/plan/phases/14-run-chats-from-the-hub.md, docs/reference/CLAUDE_CONTROL.md
2. Refresh the README screenshots that still show the removed "Open in Claude Code" button: dashboard-light.png, dashboard-dark.png (1360x1300), dashboard-phone-light.png (390x2100), dashboard-start-question.png, game-mode-on / ask / off-for-now / ignored (1280x800), all from `--demo` (sample data only; `--demo-game=on|overridden|ignored`). A Sonnet or Haiku helper can do it (browser, runs alone).
3. Phase 13: 13.5 smoothness test (fake game loop, fake heavy program, target 90 percent of solo speed; real games were detected live: League on 2026-11-15, Roblox on 2026-11-16), then 13.6 with Ivan (League about 10 minutes).
4. 11.5 and 11.6 (his install file + restart, when it suits him), then Phase 10 (security pass over ALL routes incl. /api/helpers and the chat actions) and Phase 4.

## Waiting on the owner
- 14.7 use the chat buttons on the real dashboard and say what to change.
- D15 nicknames [proposed] (voice track). 11.5/11.6 install + restart. 13.6 playing League. Small: LICENSE line (D22), public internal notes (D21), first-run audit and template sync v3 to v6 offered by the start-up check (neither applied), cleanup of JarvisTrial leftovers (about 1.4 GB), his yes to delete the one new test chat.

## Gotchas a fresh session would get wrong (max 8, only things still true)
- NEVER send a message from outside (`claude -p --resume`, `claude stop`, `--bg --resume`) into a chat the open list (`claude agents --json`) shows as open (Ivan's real chats): it splits it silently. Real tests only with chats the test created itself; stop them afterwards.
- A test that sends chat-start for a REAL project with a REAL task starts a real chat (with Remote Control a background chat that keeps running; with the default workflow a real /pickup). Never write one into a self-test; use an unknown project or an empty task. Look at /api/game after touching game-mode wiring (a comment at the end of a line once swallowed the rest of it).
- The dashboard runs on http://127.0.0.1:4780, started 2026-11-17 by `Start Hub Dashboard.bat nobrowser` in a minimized window; server code changes need a restart (stop that node process, run the launcher again); page files are read fresh. Never start a second real-mode server beside it; test with `--demo` on a spare port (`HUB_PORT`, `--demo-chats=empty`, `--demo-helpers=empty`, `--demo-game=...`).
- The repo is PUBLIC and Ivan wants every update pushed: list the files and scan for keys first; screenshots only from `--demo`. `.playwright-cli/`, `data/`, `logs/` and `.claude/helpers/` are git-ignored.
- Folder rule: this chat owns tools/dashboard/, config/ and the dashboard docs; the Jarvis chat owns tools/jarvis_trial/.
- D31/D37: game mode slows or pauses only what the Hub started (including working Hub chats) plus the openshorts-backend container and Ollama's model. Chats of the app and the browser are never touched.
- Strict Content-Security-Policy: no inline styles or scripts. POST routes need the per-run token, same Origin, JSON, confirm:true. Ports: never 8765 or 8000; Manager on 18000; dashboard on 4780.
- Test files: write with node, not PowerShell Set-Content (BOM). In git bash `node -e` with apostrophes breaks and one long heredoc with quotes broke: write scripts and big texts with the file tool. A test script that spawns a server or chat must wait for the child's exit. The permission system blocked killing a process tree (taskkill /T): do not work around it. Windows start-up is changed only by Ivan running Install Hub Autostart.bat.

## Running / not committed
- Services running: the real dashboard on http://127.0.0.1:4780 (new code). Helper tasks: none running; parked for Ivan: 14.7 (record 20261116-193726-14-7). No Hub test chat is running (`claude agents --json` shows only Ivan's own).   ·   Not committed: nothing after the commit that follows this handoff
