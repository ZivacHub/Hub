# Phase 4 — Answer decisions by voice
Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file holds the detail. A pickup reads only the CURRENT phase's file.

## Purpose in plain words
Jarvis reads out a question that is waiting on you in a project, you say your choice, he reads it back, and only after your spoken "yes" it is written into that project's decision file in your own words. This is the first thing the Hub ever changes, so the safety rules matter most here.

## Read first (when working on this phase)
- The decision-file format rules: `~/.claude/CLAUDE.md` ("Ivan decides, Claude proposes"; log every decision with his words and the date) and `_template/docs/DECISIONS.md`
- docs/reference/COMMANDS.md

## Steps
**4.1 Read waiting decisions aloud** — Grade: standard. Use: parse each project's docs/DECISIONS.md "Waiting on the owner" part. Done when: "what's waiting in Game?" reads each question and its options in plain words. Test: compare with the file for a project with waiting decisions (Game has some). Decisions needed: none.
**4.2 Take the answer, read it back, wait for "yes"** — Grade: strong (the mishear safety rule). Use: the model only matches your words to an option; the read-back is built by code. Done when: an answer is only accepted after "yes" in the next utterance; "no", silence for 15 seconds or anything unclear cancels with nothing written. A vague answer ("depends", "whatever") is NOT written as a decision (Ivan's rule). Test: scripted runs of yes / no / mumble / silence / vague. Decisions needed: none.
**4.3 Append the answer to the project's decision file safely** — Grade: strong (writes into other projects). Use: append only, never replace; make a backup copy first; refuse if the file changed during the read-back; write the status line, date and Ivan's words as the project's rules require. Done when: the entry appears correctly and the old text is unchanged. Test: a file comparison before and after shows only the added lines. Decisions needed: Ivan's go before it ever touches a real project (4.4).
**4.4 Test on a scratch copy, then once on a real project** — Grade: standard. Use: a throwaway copy of a project first. Done when: the scratch test passes, then Ivan answers one real waiting decision by voice with the project's chat closed or told. Test: the real file shows the entry and the project's own check script (`handoff-lint`/pickup context) still reads it. Decisions needed: Ivan's go.

## Risks and open points (only for this phase)
- Open chats in a project may be editing the same file; the Hub tells Ivan which projects have an active chat and refuses to write then, unless he says so.
- Misheard names: the project name and the option are both read back.

## Phase gate record
- Plain-words preview shown: (not yet). Skills/repos search: (not yet). Decisions asked: go before touching a real project. The owner's go: (not yet).
