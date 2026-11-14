# Handoff: Hub   (updated 2026-11-14)
Git: main @ 101ba96 "Phase 14 'Run my chats from the Hub': check with proof (CLAUDE_CONTROL.md), phase on the board, gate questions D38-D41 open, handoff" · pushed: yes (repo ZivacHub/Hub is PUBLIC, D21) · uncommitted: only this Git line (committed and pushed right after)

## Where we are in the plan
Phase 11 of 15 is the first unfinished phase on the board (11.5 and 11.6 need Ivan). Phase 13 "Game mode" was started ahead of it at his word: 13.1 to 13.4 done, next 13.5. NEW Phase 14 "Run my chats from the Hub" (Ivan, 2026-11-13, Change log line of that date) goes BEFORE 13.5 at his word ("Before continuing the plan"): its check is done, its gate waits for his answers D38 to D41. Steps done 33/76. Phases 3, 6 and 12 are CLOSED.
(Copied from docs/plan/BOARD.md.)

## What we're building
A local dashboard of all BUSNUS projects: cards, waiting decisions, chats waiting for Ivan, Running now and "Everything is done", Claude's latest words, the Manager card, Start / Stop / Open in Claude Code / "Start with PC", game mode. Next: running Claude chats from the Hub page (start with a task, see, answer, pick up, hand off, Remote Control). Public on GitHub for his CV. Jarvis voice is optional, in its own chat. Ivan's words: docs/PRODUCT.md.

## Last session (2026-11-13)
- Checked with 15 real tests what the Claude app and the `claude` command line allow from outside: docs/reference/CLAUDE_CONTROL.md (row in docs/INDEX.md). Short version: chats the Hub starts itself (windowless) can be started, listed, answered, picked up, handed off and started with Remote Control on; chats inside the Claude app can be listed and opened with one click, but NOT answered from outside (they split silently, test T9) and their Remote Control has no outside switch.
- GitHub search (vibe-kanban, happy, opcode, claudecodeui, claude-squad, crystal): all start their own chats the same way; nothing copied; no new skill needed.
- Phase 14 added to the board (7 steps, docs/plan/phases/14-run-chats-from-the-hub.md) and the gate questions written as D38 to D41 [open] in docs/DECISIONS.md.
- Ivan's answer to the question box did NOT arrive (the box closed as "sent a message" with no text); the questions were repeated in plain text; still unanswered.
- Left unfinished: Phase 14 gate and build, 13.5, 13.6, 11.5, 11.6, Phase 10, Phase 4.

## Next steps (strictly in order; step 1 is where the next session starts)
1. Phase 14 gate: get Ivan's answers to D38 to D41 (choice cards; recommended: D38 both buttons, D39 auto mode like now, D40 see and open, D41 accept all). Record his own words in docs/DECISIONS.md, move the blocks to "Decided", write his go in the phase file's gate record. Then step 14.1 (chat engine, strong, here in the main chat). Done when: the four decisions are recorded with his words and he said go.
   Read first: docs/plan/phases/14-run-chats-from-the-hub.md, docs/reference/CLAUDE_CONTROL.md, tools/dashboard/lib/control.mjs
2. Build 14.1 to 14.6 in order (each step's Done when / Test is in the phase file), then 14.7 with Ivan. If D41 is accepted: archive the app chat "hub-test-bg" and delete the 5 test chat files named in .claude/memory.md (2026-11-13).
3. Then back to Phase 13: 13.5 smoothness test (fake game loop, fake heavy program at normal priority and slowed by tools/dashboard/lib/throttle.mjs; target 90 percent of solo speed), 13.6 with Ivan (League about 10 minutes; ask about "usesGpu"; tell him Docker Desktop's engine does not start).
4. 11.5 and 11.6 (his install file + restart, when it suits him), then Phase 10 (security pass over all routes, including the new chat routes) and Phase 4.

## Waiting on the owner
- D38 Where a chat started from the Hub runs (both buttons / Hub only / app only).
- D39 What a windowless chat may do without asking (auto like now / edit files only / ask on the Hub page).
- D40 How far the Hub goes with app chats (see and open / also a helper chat inside the app).
- D41 Five small defaults for Phase 14 (model picker, Remote Control off at start, 2 chats at once, never write into an open app chat, clean up test chats).
- D15 nicknames [proposed] (voice track). 11.5/11.6 install + restart. 13.6 playing League. Small: LICENSE line (D22), public internal notes (D21), first-run audit and template sync v3 to v5 offered by the start-up check (neither applied), cleanup of JarvisTrial leftovers (about 1.4 GB).

## Gotchas a fresh session would get wrong (max 8, only things still true)
- NEVER send a message from outside (`claude -p --resume`) into a chat that `claude agents --json` shows as open (kind interactive or a pid): it splits the chat silently. `claude --bg --resume` on a running chat makes a copy. After `claude stop`, wait until the list shows no pid.
- The repo is PUBLIC and Ivan wants every update pushed: list the files and scan for keys first; screenshots only with `--demo`. Playwright writes .playwright-cli/ (git-ignored, delete it).
- Folder rule: this chat owns tools/dashboard/, config/ and the dashboard docs; the Jarvis chat owns tools/jarvis_trial/; tools/hub_status/ is shared.
- D31/D37: the Hub slows or pauses only what it started, plus the openshorts-backend container and Ollama's model during a game. Claude chats and the browser are never touched by game mode.
- Strict Content-Security-Policy: no inline styles or scripts. POST routes need the per-run token, same Origin, JSON, confirm:true. Ports: never 8765 or 8000; Manager on 18000; dashboard on 4780.
- Test files for the server: write them with node, not PowerShell Set-Content (BOM). Keep PowerShell polling loops short (tool timeout). Foreground `sleep` is blocked in Bash: use a background command or Monitor.
- The permission system blocked killing a process tree (taskkill /T): do not work around it. Windows start-up is changed only by Ivan running Install Hub Autostart.bat. Memory is tight (11 to 14 of 15.6 GB).
- In git bash, node -e with apostrophes breaks: write scripts to the scratchpad and run them. Ivan's answers sometimes arrive over Remote Control (phone): a question box may close with no text; then ask again in plain text with lettered options.

## Running / not committed
- Services running: unverified (the dashboard on http://127.0.0.1:4780 was started on 2026-11-12; check before relying on it). No background test chats left (`claude agents --json --all` showed only finished ones).   ·   Not committed: nothing (all pushed)
