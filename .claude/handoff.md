# Handoff: Hub   (updated 2026-11-08)
Git: main @ a37e03a "Phase 3 closed: one glance is enough (3.8, D27); handoff for Phase 11" · pushed: yes (repo ZivacHub/Hub is PUBLIC, D21) · uncommitted: the 6.1/6.2 check, the latest-words fix, tests/latest_words_check.mjs and this handoff (committed and pushed right after)

## Where we are in the plan
Phase 11 of 12 — Start and stop projects from the dashboard, in progress. Steps done 23/58. Phase 3 is CLOSED (D27). Next per plan: 11.5 Start with the PC (needs Ivan to run the install file and restart). With Ivan's OK ("Yes, do that") Phase 6 steps 6.1 and 6.2 were done meanwhile; 6.3 is the only Phase 6 step left. Plan v2: dashboard first, voice track optional at the bottom (D19).
(Copied from docs/plan/BOARD.md.)

## What we're building
A local dashboard of all BUSNUS projects: cards, one list of waiting decisions, Claude's latest words, the Manager card, light by default with a dark switch, plus Start / Stop / Open in Claude Code / "Start with PC" per project (always asks "Start X?" first). Public on GitHub for Ivan's CV. Jarvis voice is optional, in its own chat. Ivan's words: docs/PRODUCT.md.

## Last session
- Phase 3 closed (3.5 after the real Manager Start/Stop test, 3.8 on Ivan's "Yes, enough", D27). Manager runs on port 18000 (8000 is ClipForge's openshorts container).
- 6.1/6.2: `node tests/latest_words_check.mjs` (dashboard must be up) compares the page's "Claude last said" with an independent read of the whole saved chat files: 6 of 6 match. It first caught a real bug (Socials Automatisation showed an 8 Oct message instead of today's): the newest chat was chosen by file modified time; now by the time of the last message (lib/data.mjs answers()). "Compared with the app" = compared with the saved chat files, the app window itself cannot be read.
- Left unfinished: 11.5 (his install + restart), 11.6 (his own try-out), 6.3, Phase 10 security pass. A terminal window "Claude Code - Hub" from an earlier test may still be open (Ivan closes it).

## Next steps (strictly in order; step 1 is where the next session starts)
1. Step 11.5: ask Ivan to double-click Install Hub Autostart.bat, switch on "Start with PC" for ONE harmless project on the dashboard (not ClipForge: it publishes on its own schedule while open), restart the PC, and say whether it came up; done when the project is Running after the restart with no one pressing Start (tick 11.5 with his word). Then 11.6: he presses Start himself on one project and says what to change.
   Read first: docs/plan/phases/11-start-stop-projects.md, docs/reference/SECURITY_CHECKLIST.md
2. Phase 6 step 6.3 "a chat needs you" (grade strong: no reliable signal known yet; look at how saved chats end, possibly hooks, which would change Claude settings and needs a choice card first), with his OK to run ahead of Phase 11 if 11.5 still waits.
   Read first: docs/plan/phases/06-claudes-answers-and-alerts.md
3. Phase 10: security pass of the page including the POST route (probe from a second website and from the LAN), then Phase 4 later.

## Waiting on the owner
- 11.5/11.6: his install + restart + own try-out; closing the leftover "Claude Code - Hub" terminal window.
- Small: the LICENSE copyright line "Ivan (ZivacHub)" is my guess (D22); whether the internal notes (decisions, memory, handoff) should stay public (D21).
- D15 nicknames (tools/hub_status/aliases.json); step 2.6 demo and the offline backup model (voice track, Jarvis chat).
- Cleanup he can OK: C:\Users\Ivan\JarvisTrial\installed (893 MB) and the partial Ollama zip in JarvisTrial\ollama-new (564 MB).

## Gotchas a fresh session would get wrong (max 8, only things still true)
- The repo is PUBLIC and Ivan wants every update pushed: before each push list the files and scan for keys; keep real project text out of screenshots (shoot with `--demo`; real-page shots go to the scratchpad only). Playwright writes .playwright-cli/ with page text: git-ignored, delete it.
- Folder rule: this chat owns tools/dashboard/, config/projects.json and the dashboard docs; the Jarvis chat owns tools/jarvis_trial/; tools/hub_status/ is shared (the dashboard only imports it).
- Real mode needs Ivan's shared reader (~/.claude/hooks/lib/busnus.mjs); `--demo` is the only mode that runs elsewhere, and there the buttons answer "Sample data mode".
- Strict Content-Security-Policy: no inline styles or scripts. The POST route needs the per-run token (GET /api/session), same Origin, JSON, confirm:true. After a dashboard restart the first page load takes several seconds: wait before clicking in tests.
- Ports: never 8765 (another chat's dev server) and never 8000 (ClipForge's openshorts container). The Manager runs on 18000 on 127.0.0.1. Stop only ends programs the Hub started (PID in data/hub_state.json, git-ignored; survives a dashboard restart).
- Saved chats (~/.claude/projects/<path with every non-letter/digit as a dash>/*.jsonl) are tens of MB: a file's modified time can change without a new message (renames), so compare message times, skip isSidechain messages, read tails.
- The permission system blocked killing a process tree (taskkill /T): do not work around it. Windows start-up is changed only by Ivan running Install Hub Autostart.bat. In git bash, node -e with apostrophes breaks: write scripts to the scratchpad; write files with the Write tool.
- Voice track (Jarvis chat): start with tools/jarvis_trial/start_jarvis_trial.ps1, never Jarvis.exe alone; C:\Users\Ivan\.config\jarvis\config.json holds the Gemini key, never print or commit it.

## Running / not committed
- Services running: the real dashboard on http://127.0.0.1:4780 (started by this chat, hidden window; stop node on that port); the Manager and Learning Script Maker are stopped; the Jarvis chat's services may still run  ·  Not committed: the 6.1/6.2 work and this handoff until the push right after this file
