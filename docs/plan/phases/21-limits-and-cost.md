Read when: working on Phase 21 (usage meter, hand-off before the limit, per-project settings, cost view) or its gate.
# Phase 21: Limits and cost (Ivan's wishes 2026-11-23)

## Ivan's words (pasted 2026-11-23, with his OK to add them as a new phase, run the gate first and say where it fits)
1. Usage meter: how much of the 5-hour session limit and the weekly limit is used, per running chat and in total, updated live. Use the app's own usage numbers if the Hub can read them; per-chat token numbers from `node ~/.claude/hooks/token-report.mjs --json` (it counts every reply once; do NOT use session-report.mjs, it counts replies 2-3 times). Warning at 70 percent, stop sign at 90 percent.
2. Hand-off before the limit: when a chat or the session is near the limit, a button "save and continue in a new chat" that asks that chat to run the hand-off and then opens a new chat in the same project folder starting with /pickup. Never at 100 percent: work is lost there.
3. Settings per project (saved in the project, read by the workflow): how much to generate after each phase (full report with pictures / short summary only / only when asked) and whether background pictures run at all. Default: short summary. These exist to save tokens.
4. Cost view per project: tokens per chat and per phase, split main chat vs helpers, to see where tokens go.
5. Ideas only (no code copied) from the older orchestration project in ..\AI_Orcestration\ai_company: the budget guard (warn at 80 percent, stop at 100 percent) and the plan / run / progress pattern of its documenter page. Do not reuse its server.
"Read-only rule stays: the Hub never changes a project's files except the settings file of point 3."

## What exists already (checked 2026-11-23)
- `node ~/.claude/hooks/token-report.mjs --json` prints per chat: project, session, start/end, hours, main and helper tokens (fresh, cache write, cache read, output), replies, models. Read-only, numbers and names only.
- The hand-off round engine (lib/handoffround.mjs, D57, step 19.3) already does "ask the chat for /handoff, check handoff.md changed, start a new chat with /pickup": point 2 reuses it.
- The helper records of the BUSNUS hooks (`.claude/helpers/`, Phase 15) hold tokens per helper task with its step id: the source for "per phase" in point 4.
- The Claude app shows the 5-hour and weekly usage, and the in-app session tools can read it (`get_usage`), but those tools are not reachable from the Hub. Whether any file or command lets the Hub read the real numbers is the first question of the phase (step 21.1).

## Gate preview (plain words), proposed steps
- 21.1 Find out if the Hub can read the REAL 5-hour and weekly numbers (try `claude -p "/usage"`, the app's data, the live session files) and say yes/no with proof. If not: the meter uses the Hub's own count against limits Ivan types in once, and says "estimate".
- 21.2 The meter: total and per running chat, top bar of the page, live; words and a mark at 70 percent (warning) and 90 percent (stop sign), not colour only.
- 21.3 "Save and continue in a new chat": offered from the warning level, asks first, uses the hand-off round; refuses to start the round in the last few percent (default: not above 95) and says why; never sends by itself.
- 21.4 The settings file in each project (the ONLY file the Hub writes in a project; proposed `.claude/hub-settings.json`), a Settings page in the Hub to change it per project, defaults: short summary after a phase, background pictures per his answer.
- 21.5 The workflow reads the file (changes in the BUSNUS workshop skills, NOT in the Hub: proposed separately, applied only with his OK).
- 21.6 Cost view per project: tokens per chat and per phase, main chat vs helpers.
- 21.7 Ideas from the old orchestration project (read-only look, a short note of ideas, nothing copied).
- 21.8 Milestone with Ivan.

## Decisions needed at the gate (choice cards)
Where the phase goes in the order; the default for background pictures; the settings file name and place; his go.
