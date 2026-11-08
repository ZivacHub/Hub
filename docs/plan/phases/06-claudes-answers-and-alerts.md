# Phase 6 — Claude's latest answers and "needs you" alerts
Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file holds the detail. A pickup reads only the CURRENT phase's file.

## Purpose in plain words
The dashboard and Jarvis show what Claude last said in each project's chat ("Finished the caption step, tests pass"), and tell you when a chat is waiting on you. Ivan allowed reading the saved chat files read-only; they stay on this PC.

## Read first (when working on this phase)
- docs/reference/PRIOR_ART.md (sniffly's log-reading idea, claude-code-monitor's "needs you" idea)
- docs/DECISIONS.md (D8)

## Steps
**6.1 Find the latest Claude answer per project (read-only)** — Grade: standard. Use: the saved chat files under `~/.claude/projects/` (one folder per project; a folder name is the project path with dashes), read only. Done when: for each project with chats, the Hub gives the last Claude message text and time. Test: compare with what the app shows for two projects. Decisions needed: none.
**6.2 Show them on the dashboard** — Grade: standard. Use: the dashboard design from 3.2. Done when: each card shows a short "Claude's last words" line and time, with a button for the longer text. Test: screenshot. Decisions needed: none.
**6.3 Detect "a chat needs you" and say so** — Grade: strong (we don't yet know a reliable signal). Use: look at how chat files end (a question or permission wait), possibly Claude Code hooks. Done when: when a chat has been waiting for your answer, Jarvis says "Game is waiting for you" once, and the dashboard marks it. Test: leave a test chat on a question and see the alert; answer it and see it clear. Decisions needed: none (hooks turned out not to be needed; the saved chat files are enough). Optional later: a Claude hook would give an exact permission-prompt signal instead of the 3-minute "maybe".
**6.4 Never speak anything that looks like a secret** — Grade: standard. Use: a filter for key-like text before anything is spoken or shown large. Done when: text containing key-looking strings (e.g. "sk-...", long random tokens) is replaced by "[hidden]". Test: feed a sample with fake keys and see them hidden. Decisions needed: none.

## Risks and open points (only for this phase)
- Chat files may hold private text; they are only read on this PC and never sent anywhere.
- The file format may change when Claude Code updates; the reader should fail quietly with "can't read this chat".

## Phase gate record
- Plain-words preview shown: (not yet). Skills/repos search: (not yet). Decisions asked: possible hook change in 6.3. The owner's go: (not yet).
