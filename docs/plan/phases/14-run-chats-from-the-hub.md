# Phase 14 — Run my chats from the Hub (Ivan's wish 2026-11-13)
Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file holds the detail. A pickup reads only the CURRENT phase's file.
Status: GATE OPEN. The check is done and the preview, search and questions were shown on 2026-11-13; Ivan's answers (D38 to D41) did not arrive. Build nothing until he answers and says go.

## Ivan's words (2026-11-13)
> "I want a new phase right after the current one: "Run my chats from the Hub". From the Hub page I want to start a new chat for any project with a task, see and answer chats, pick up, hand off, and turn Remote Control on and off. First check, with proof, what the Claude desktop app and the claude command line really allow from outside (no guessing). Then run the phase gate with choice cards, then build it."
Background: ../.claude/plans/fable-window.md, job B ("The Hub as the one window").

## Purpose in plain words
From each project card on the Hub page: start a new Claude chat with a task, see what chats are doing, read and answer them, run pick up and hand off, switch Remote Control (reach a chat from the phone) on and off, and open a chat in the Claude app. Every button asks "Send this to Claude in X? Yes / Cancel" and is logged, like Start / Stop.

## Read first (when working on this phase)
- docs/reference/CLAUDE_CONTROL.md (the 15 tests: what works from outside and what breaks a chat)
- docs/DECISIONS.md (D38 to D41 once answered), tools/dashboard/lib/control.mjs (the safety rules every new action copies), tools/dashboard/lib/attention.mjs (chat files already read)

## The one hard rule found by testing
A chat that is open in the Claude app must never get a message from outside: it splits silently (test T9). The Hub checks `claude agents --json` before every send and refuses if the chat is open anywhere else.

## Steps (proposed grades; re-graded on the spot before each starts)
**14.1 Chat engine** — Grade: strong (starts Claude with permissions). Use: tools/dashboard/lib/chats.mjs: start (`claude -p` or `--bg` in the project folder, folder chosen by the server from the project list), answer (`--resume`, only when T13's list shows the chat closed), stop, the permission mode from D39, at most N at once (D41), a log line per action, game mode treats them like Hub programs. Done when: a self-test starts a test chat, answers it, refuses to answer one that is open elsewhere, stops it. Test: `node tools/dashboard/lib/chats.mjs --selftest` with the cheapest model and no tools.
**14.2 Live list of all chats** — Grade: standard. Use: `claude agents --json` + the app's chat records (read-only, CLAUDE_CONTROL T14) + the existing attention check. Done when: /api/chats lists every open chat per project with app/Hub kind, working or idle, needs you, Remote Control on/off. Test: compare with the app's sidebar on the real PC.
**14.3 New chat form on the card** — Grade: standard. Use: task box, model picker, Remote Control tick (D41), the buttons D38 allows. Done when: a chat started from the page appears in the list and answers. Test: screenshots (sample data) and one real harmless chat.
**14.4 Chat panel with answer box** — Grade: standard. Use: last messages from the saved chat file (redact() as in 6.4), answer box only for chats the Hub may answer. Done when: an answer typed on the page arrives in the same chat. Test: real round trip; an app chat shows "Open in the app" instead of a box.
**14.5 Pick up and Hand off buttons** — Grade: standard. Use: send `/pickup` or `/handoff` to a Hub chat (test T11 showed slash commands work without a window). Done when: both run and their result shows on the card. Test: on the Hub project itself, read-only pickup first.
**14.6 Remote Control switch and Open in the app** — Grade: strong. Use: Hub chats: start with `--remote-control`, off = stop and continue without it; Open in the app = `claude://resume?session=<id>` (T7b) or `claude://claude.ai/epitaxy/local_<id>` (T8); app chats only as far as D40 allows. Done when: the switch changes the state the list shows and the phone can reach the chat. Test: Ivan opens it on his phone.
**14.7 Milestone** — Grade: light (needs Ivan). Done when: Ivan starts a real task from the Hub, answers it from the page, and says what to change. Test: his words.

## Open questions for the gate (D38 to D41, as asked 2026-11-13)
1. D38 Where a new chat runs: both buttons (recommended) / only in the Hub / only in the app.
2. D39 What a windowless chat may do: auto like now (recommended) / edit files only / ask on the Hub page (untested).
3. D40 App chats: see and open (recommended) / also a helper chat inside the app that sends answers and flips Remote Control.
4. D41 Five small defaults: model picker; Remote Control off at start; at most 2 chats at once; never write into an open app chat; clean up the test chats.

## Phase gate record
- Check with proof: docs/reference/CLAUDE_CONTROL.md (2026-11-13). Skills/repos search: GitHub (vibe-kanban, happy, opcode, claudecodeui, claude-squad, crystal, claude-code-webui, session managers), nothing copied; no new skill needed (frontend-design, impeccable, playwright-cli, security-review cover it). Preview and questions shown 2026-11-13. Ivan's go: not yet.

## Risks and open points (only for this phase)
- Memory is tight (11 to 14 of 15.6 GB): each windowless chat is a full Claude program.
- Windowless chats use Ivan's Claude allowance like any chat; the Hub shows which are working.
- The app's chat records and links are not a published interface; an app update can change them. Re-run the tests in CLAUDE_CONTROL.md after an update.
- The test chat "hub-test-bg" is still in the app's sidebar (Remote Control off) and 5 test chat files are in the Hub's chat folder: cleanup waits for D41.
