# Handoff: Hub   (updated 2026-11-09)
Git: main @ 936775f "New wishes recorded (running-now overview, game mode, all-done notice): decisions D28-D31, phases proposed" · pushed: yes (repo ZivacHub/Hub is PUBLIC, D21) · uncommitted: Phases 12 and 13 on the board and this handoff (committed and pushed right after)

## Where we are in the plan
Phase 11 of 14 — Start and stop projects from the dashboard, in progress. Steps done 24/69. Phases 3 and 6 are CLOSED. Next per plan: 11.5 Start with the PC (needs Ivan to run the install file and restart), then 11.6. Ivan added Phases 12 (Running now and done) and 13 (Game mode) on 2026-11-09 ("Add both", D28 to D31), placed after Phase 6 and before Phase 10. Plan v2: dashboard first, voice track optional at the bottom (D19).
(Copied from docs/plan/BOARD.md.)

## What we're building
A local dashboard of all BUSNUS projects: cards, one list of waiting decisions, chats waiting for Ivan, Claude's latest words, the Manager card, light by default with a dark switch, plus Start / Stop / Open in Claude Code / "Start with PC" per project (always asks first). Next: a "Running now" panel and "everything is done" notice (Phase 12), and a game mode that slows the programs the Hub started while he plays (Phase 13). Public on GitHub for Ivan's CV. Jarvis voice is optional, in its own chat. Ivan's words: docs/PRODUCT.md.

## Last session
- Step 6.3 done (chats waiting for Ivan, from the saved chat files; 15/15 self-test, real chats flagged correctly), closing Phase 6.
- Ivan's new wishes: the Hub works while the PC stays on and says when everything is done, a quiet Hub, an overview of all running tasks, and a game mode with percent limits. Measured: dashboard 92 MB and 0 percent processor idle; the PC had 13.9 of 15.6 GB memory in use; per-program graphics use is unreadable on Windows (so no graphics cap, only pause); the app in front can be read. His answers: all done = only tell me (D28), game detection = automatic + his list (D29), in a game = slow down never stop (D30), only programs the Hub started (D31). Phases 12 and 13 written (docs/plan/phases/12-running-now-and-done.md and 13-game-mode.md).
- Left unfinished: 11.5, 11.6, Phases 12, 13, 10. Not yet seen live: that the Hub chat's own "waiting for you" alert clears when Ivan answers.

## Next steps (strictly in order; step 1 is where the next session starts)
1. Step 11.5: ask Ivan to double-click Install Hub Autostart.bat, switch on "Start with PC" for ONE harmless project (not ClipForge: it publishes on its own schedule while open), restart the PC, and say whether it came up; done when the project is Running after the restart with no one pressing Start (tick 11.5 with his word). Then 11.6: he presses Start himself on one project and says what to change. Note: Ivan said he rarely turns the PC off, so a restart is a special occasion: ask when it suits him.
   Read first: docs/plan/phases/11-start-stop-projects.md, docs/reference/SECURITY_CHECKLIST.md
2. While 11.5 waits (needs his OK to run ahead): the Phase 12 gate (plain preview, a visible skills/repos search, his go), then 12.1 List what is running.
   Read first: docs/plan/phases/12-running-now-and-done.md, docs/DECISIONS.md
3. Then Phase 13 (its gate needs his game names, his processor and memory ceilings, and which of his programs use the graphics card), then Phase 10 (security pass over all routes), then Phase 4.

## Waiting on the owner
- 11.5/11.6: his install + restart + own try-out; his OK to start the Phase 12 gate meanwhile; closing the leftover "Claude Code - Hub" terminal window (if still open).
- For Phase 13 later: his game names, ceilings (proposed 25 percent processor, 2 GB), which programs use the graphics card.
- Small: the LICENSE copyright line "Ivan (ZivacHub)" is my guess (D22); whether the internal notes (decisions, memory, handoff) should stay public (D21); whether chats older than 7 days should ever count as "waiting".
- D15 nicknames (tools/hub_status/aliases.json); step 2.6 demo and the offline backup model (voice track, Jarvis chat).
- Cleanup he can OK: C:\Users\Ivan\JarvisTrial\installed (893 MB) and the partial Ollama zip in JarvisTrial\ollama-new (564 MB).

## Gotchas a fresh session would get wrong (max 8, only things still true)
- The repo is PUBLIC and Ivan wants every update pushed: before each push list the files and scan for keys; keep real project text out of screenshots (shoot with `--demo`; real-page shots go to the scratchpad only). Playwright writes .playwright-cli/ with page text: git-ignored, delete it.
- Folder rule: this chat owns tools/dashboard/, config/projects.json and the dashboard docs; the Jarvis chat owns tools/jarvis_trial/; tools/hub_status/ is shared (the dashboard only imports it).
- Real mode needs Ivan's shared reader (~/.claude/hooks/lib/busnus.mjs); `--demo` is the only mode that runs elsewhere, and there the buttons answer "Sample data mode".
- Strict Content-Security-Policy: no inline styles or scripts. The POST route needs the per-run token (GET /api/session), same Origin, JSON, confirm:true. After a dashboard restart the first page load takes several seconds: wait before clicking in tests.
- Ports: never 8765 (another chat's dev server) and never 8000 (ClipForge's openshorts container). The Manager runs on 18000. Stop only ends programs the Hub started (PID in data/hub_state.json, git-ignored). D31: the Hub never slows or pauses anything it did not start (Claude chats, Docker, Ollama, the game).
- Saved chats (~/.claude/projects/<path with every non-letter/digit as a dash>/*.jsonl) are tens of MB: compare message times not file times, skip isSidechain messages, read tails. Waiting-for-you comes from wrap_up's input.ask, AskUserQuestion and a final "?" paragraph.
- Windows cannot read or cap per-program graphics use (nvidia-smi shows N/A); the app in front and total graphics load can be read. The permission system blocked killing a process tree (taskkill /T): do not work around it. Windows start-up is changed only by Ivan running Install Hub Autostart.bat.
- Voice track (Jarvis chat): start with tools/jarvis_trial/start_jarvis_trial.ps1, never Jarvis.exe alone; C:\Users\Ivan\.config\jarvis\config.json holds the Gemini key, never print or commit it. In git bash, node -e with apostrophes breaks: write scripts to the scratchpad; write files with the Write tool.

## Running / not committed
- Services running: the real dashboard on http://127.0.0.1:4780 (started by this chat, hidden window; stop node on that port); the Manager and Learning Script Maker are stopped; the Jarvis chat's services may still run  ·  Not committed: Phases 12 and 13 and this handoff until the push right after this file
