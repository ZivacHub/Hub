# Phase 9 — Continue a project's Claude chat by voice
Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file holds the detail. A pickup reads only the CURRENT phase's file.
Added 2026-11-03 at Ivan's request ("Yes, move it up"): it runs right after Phase 2 although its number is 9. It is the narrow, first version of the wish in Phase 7 (steps 7.3 and 7.4 may shrink later).

## Purpose in plain words
Ivan's wish: "boot up certain projects, ask him 'what's going on there?', he tells me, then I answer him, and Claude continues working on the project with what I said." Example he tried: "continue the newest chat of the Learning Script Maker". You say "Jarvis, what's going on in the script maker?" and he tells you what the newest chat last said. You say what Claude should do next, he reads it back, you say "yes", and only then is it sent to Claude. Nothing is sent without your spoken "yes".

## Read first (when working on this phase)
- docs/reference/COMMANDS.md (the safe list; this phase adds the first tools that CHANGE something)
- docs/reference/PRIOR_ART.md (section "Feature: brain options and read my messages by voice": the policy note on `claude -p`)

## Steps
**9.1 Find a project's chats, read-only** — Grade: standard. Use: a new read-only tool `hub__latest_chat(project)` in tools/hub_status. Chat files live in `~/.claude/projects/<project folder, path with dashes>/*.jsonl` (one per chat; Learning_Script_Maker has 7). Done when: it lists the chats newest first with age and first line, and says plainly when two chats were written minutes apart ("two chats are active, which one?"). Test: Learning_Script_Maker and Hub give the right chats; nothing is written. Decisions needed: none.
**9.2 Say what the newest chat last said** — Grade: standard. Use: the last assistant message of that chat, cut to a short spoken summary (by code first; Claude summary only if asked). Done when: "what's going on in the script maker?" returns the real last answer in about three sentences. Test: compare with the file for 3 projects. Decisions needed: none. Privacy note: the text goes to Gemini's free tier like everything else; secret-looking lines are dropped (step 6.4 logic).
**9.3 Take the instruction, read it back, wait for "yes"** — Grade: strong (this is the safety step). Use: two tools, `prepare_continue(project, instruction)` which only stores the request and returns the read-back sentence, and `confirm_continue()`. The RELAY lets `confirm_continue` through only when a pending request exists AND the latest thing Ivan said is a clear yes ("yes", "go ahead", "send it"); a model cannot confirm by itself. Done when: a scratch run proves: no yes, no send; "no" cancels; a yes after silence (older than 60 s) is refused. Test: scripted cases, each logged. Decisions needed: yes-words list (Claude proposes).
**9.4 Send it to Claude, on a scratch project first** — Grade: strong. Use: `claude -p --resume <chat id>` (or `--continue`) in the project folder with ONLY the rights Ivan picks, result read back later. Done when: on a scratch copy of a project the instruction is carried out and the result is spoken; then once on a real project with Ivan watching. Test: the chat file gets the new messages and the repo shows the expected change. Decisions needed: see below.
**9.5 Milestone demo** — Grade: light. Done when: Ivan says by voice "what's going on in the script maker", answers, hears the read-back, says yes, and Claude continues; the log shows each step.

## Decisions Ivan must make at the phase gate (choice cards, not decided)
- What may Claude do when it continues a chat: (a) only write notes and edit files inside that project, no commands; (b) also run commands (installs, tests); (c) nothing, only queue the instruction as a note and open the chat for him. Claude's reading: start with (a) on a scratch project.
- Which chat is "the newest" when two were written minutes apart, or one is open on his screen right now (Learning_Script_Maker has two within 6 minutes today): ask him every time, or always the one written last.
- Where the result goes: spoken only when he asks, or announced when Claude finishes.

## Risks and open points (only for this phase)
- Two writers on one chat: if the same chat is open in the Claude app while a headless `claude -p --resume` appends to it, the chat can end up with two diverging histories. Mitigation: refuse (or ask) when the chat file changed in the last few minutes.
- Policy: personal local use of `claude -p` with his subscription looks tolerated, but Anthropic's wording was unclear in search results (June 2026 change about Agent SDK credit). Verify the current text before building 9.4.
- Mishearing: the recognizer hears project names wrongly (it heard "clipboard" for ClipForge); the read-back must name the project and the chat, and "yes" only works right after the read-back.
- A spoken "yes" can come from anything audible (a video). Keep the 60 s limit and the visible indicator; consider requiring his name or a code word for sends.
- Prompt injection: text from files or the web must never be able to call `confirm_continue` (the relay gate on his own words covers this).

## Phase gate record
- Plain-words preview shown: (this file; to be shown again when the phase starts). Skills/repos search: (not yet; check how others resume Claude Code sessions headlessly). Decisions asked: not yet. The owner's go to START the phase: (not yet; Ivan's 2026-11-03 "Yes, move it up" moved the phase in the plan, the gate still has to run).
