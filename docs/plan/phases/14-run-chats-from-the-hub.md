# Phase 14 — Run my chats from the Hub (Ivan's wish 2026-11-13)
Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file holds the detail. A pickup reads only the CURRENT phase's file.
Status: GATE PASSED 2026-11-16. D38 both buttons, D39 auto mode, D40 see and open, D41 all five defaults; Ivan's go: "Go, whole phase". Built in whole-phase mode (manager + helpers).

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

## Engine contract (written by the manager 2026-11-16; binding for 14.1 to 14.6)
`tools/dashboard/lib/chats.mjs` exports `makeChats(opts)`; opts (all optional, for tests): `root` (the projects folder), `dataDir`, `logDir`, `claude` (the program to run), `maxWorking` (2, D41), `listOpen` (async, the `claude agents --json` reader). It returns:
- `start({ project, task, model, remoteControl })` -> `{ ok: true, id, message }` or `{ ok: false, error }`. `project` = a real folder directly under `root` (same rule as openClaude in control.mjs). `task` = 1 to 4000 characters. `model` = one of the engine's own short list, or missing for the default. `remoteControl` is refused with a plain message until step 14.6 adds it.
- `answer({ id, text })`, `stop({ id })` -> `{ ok, message }` or `{ ok: false, error }`.
- `list()` -> `[{ id, project, name, task, model, remoteControl, state, startedAt, lastTurnAt, turns, sessionId, lastReply, lastError, refused }]`, newest first. `state` = `working` (a turn is running), `idle` (the last turn ended, it can be answered), `failed` (the last turn ended with an error), `stopped` (Ivan stopped it). `task` and `lastReply` are clipped (300 / 1400 characters); `refused` = the actions the safety checker refused in the last turn (short plain lines, D39).
- `workingPids()` -> `{ id: pid }` of running turns (game mode slows them like other Hub programs).
Rules the engine itself enforces (the server and the page are not trusted to):
1. The Hub's chat id (`id`) is made by the engine (`h-` + date, time and 4 random characters) and is the only id the page ever sends. Claude's own session id never comes from the page.
2. Task and answer text reach Claude through standard input, never on a command line and never through a shell; the program is started with an argument list (`shell: false`).
3. Before every `answer`: refuse while this chat's own turn is still running, and refuse when the open-chats list (CLAUDE_CONTROL T13) shows the chat's session as open anywhere (T9: writing into an open chat splits it). If the list cannot be read, refuse.
4. At most `maxWorking` turns at once; one more is refused with a plain message.
5. Permission mode is auto (D39); nothing in the engine can switch it to a mode that skips the checks.
6. Every start, answer, stop and refusal is one line in logs/hub_actions.log (action, chat id, project, result), without the task or answer text. State is kept in data/hub_chats.json (written to a temporary file, then renamed).

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
- Check with proof: docs/reference/CLAUDE_CONTROL.md (2026-11-13). Skills/repos search: GitHub (vibe-kanban, happy, opcode, claudecodeui, claude-squad, crystal, claude-code-webui, session managers), nothing copied; no new skill needed (frontend-design, impeccable, playwright-cli, security-review cover it). Preview and questions shown 2026-11-13 and again 2026-11-16. Decisions: D38 to D41 (2026-11-16). Hand-out list shown 2026-11-16: 14.1 and 14.6 Opus high, 14.2 to 14.5 Sonnet medium, sample data Haiku low, server routes and the test-chat cleanup with the manager; almost everything runs one at a time (real test chats, browser, shared page files). Ivan's go: 2026-11-16 ("Go, whole phase").

## Risks and open points (only for this phase)
- Memory is tight (11 to 14 of 15.6 GB): each windowless chat is a full Claude program.
- Windowless chats use Ivan's Claude allowance like any chat; the Hub shows which are working.
- The app's chat records and links are not a published interface; an app update can change them. Re-run the tests in CLAUDE_CONTROL.md after an update.
- The test chat "hub-test-bg" is still in the app's sidebar (Remote Control off) and 5 test chat files are in the Hub's chat folder: cleanup waits for D41.
