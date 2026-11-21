# What the Hub can do with Claude chats from outside (checked 2026-11-13)
Read when: building or changing anything that starts, shows, answers or steers a Claude chat from the Hub (Phase 14), or after a Claude app / command line update (re-run the tests marked RE-TEST).

Checked on this PC with real runs, not from memory. Versions: `claude` command line 2.1.316, Claude desktop app 5.1231.2.0 (Windows Store build), logged in with the Claude subscription (no API key, D2). Test chats used the cheapest model and no tools; the test replies were fixed words (HUB-TEST-...).

Two kinds of chat exist, and they behave differently:
- **App chat** = a chat that lives in the Claude desktop app's Code tab (what Ivan uses today).
- **Hub chat** = a chat the Hub starts itself through the `claude` command line, with no window.

## Proven to work (each line = one real test)
| # | What | How | Proof |
|---|---|---|---|
| T1 | Start a new chat with a task, no window | `claude -p "<task>" --output-format json` in the project folder | exit 0, reply `HUB-TEST-ONE`, a chat id came back, 2 s |
| T2 | Answer that same chat later | `claude -p --resume <chat id> "<answer>"` | reply `HUB-TEST-ONE AGAIN`, same chat id, same saved file |
| T3 | Start a chat in the background and list it | `claude --bg "<task>" --name <name>`; `claude agents --json --all` | listed as `kind: background`, `status: idle`, `state: done` |
| T10 | Background chat born with Remote Control on | `claude --bg --remote-control <name> "<task>"` | its screen says "/remote-control is active · Continue here, on your phone, or at claude.ai/..." |
| T12b | Answer a stopped background chat | `claude stop <id>`, wait until it has no `pid` in the list, then `claude -p --resume <chat id> "<answer>"` | reply `HUB-TEST-RC-THREE`, same chat id |
| T11 | Slash commands (skills) work with no window | `claude -p "/info"` in a project folder | the command list came back |
| T7b | Move a command-line chat into the desktop app | open the link `claude://resume?session=<chat id>` | the app listed a new chat `local_<chat id>` in the same folder |
| T8 | Open one exact app chat from outside | open `claude://claude.ai/epitaxy/local_<app chat id>` | Windows accepted the link; the link format is the one the app itself reports for every chat |
| T6 | Open the app's new-chat page with folder and task | open `claude://code/new?q=<task>&folder=<folder>` (both URL-encoded) | the page opened; **no chat started by itself** (the app waits for Send). The app's code reads `q` (or `prompt`) and `folder`; the filled-in boxes were not looked at on screen: RE-TEST with Ivan watching |
| T13 | Live list of every open chat | `claude agents --json` | app chats appear as `kind: interactive` with folder, chat id, name and `status: busy / idle` |
| T14 | The app's own record of each chat | read-only: `%LOCALAPPDATA%\Claude-Data\claude_*\claude-code-sessions\*\*\local_*.json` | fields `sessionId` (app id), `cliSessionId` (saved-file id), `cwd`, `title`, `isArchived`, `remoteControlUserEnabled` |
| T15 | One app chat can steer another | inside the app only: the tools `send_message` and `set_remote_control` | a message was delivered to the test chat and answered; its Remote Control went on, then off |

## Proven NOT to work, or dangerous
| # | What | Proof |
|---|---|---|
| T9 | **Answering an app chat from outside splits it.** `claude -p --resume <id>` on a chat that is open in the app is not refused: it writes into the same saved file, but the app never sees that message | the outside reply `HUB-TEST-APP-CHAT` and the app's next message both hang from the same earlier message; asked to list its replies, the app chat left the outside one out. **Rule: the Hub never sends into a chat the list (T13) shows as open elsewhere** |
| T4 | A follow-up to a running background chat makes a copy | `claude --bg --resume <id>` printed "is already running in the background, so this started a copy" |
| T5 | A plain answer to a running background chat is refused | "That session is running in the background ... `claude stop` first" |
| T12 | Resuming right after `claude stop` can still make a copy | stop, then resume at once gave a copy; wait until the list shows no `pid` |
| - | Background chats need a trusted folder | in a fresh temp folder: "Workspace not trusted. Run `claude` in ... once". Ivan's project folders are trusted |
| - | No window = nobody to approve | T11 in `--permission-mode default`: two commands were denied, not asked. A Hub chat needs a permission mode chosen up front (D39) |
| - | Remote Control of an app chat cannot be switched from outside | the command line has only `--remote-control` for a chat it starts itself; no link and no command flips another chat. Only the app's own switch, or a chat inside the app (T15) |
| - | `claude --desktop` cannot be run by a program | "can't run non-interactively"; use the links above instead |
| - | `claude rm <id>` does not delete the saved chat file | the files were still there after "removed" |
| - | `claude logs <id>` is a screen dump with colour codes | read the saved chat file instead (the Hub already does, Phase 6) |

## Things to know
- App chat ids and saved-file ids differ (`local_0bac...` in the app, another id on disk); T14's file links them. A chat moved into the app with T7b gets `local_<the same id>`.
- A background chat starts Claude's own "background service"; it ended by itself once the test chats were stopped.
- A background chat with nothing chosen ran in "auto mode" (Ivan's usual mode).
- App setting "Connect new sessions to Remote Control" is Off (2026-11-13). Switched on (Ivan approves a card), every new app chat is reachable from the phone without flipping a switch.
- Not tested: showing "Claude wants to run X, allow?" on the Hub page (the command line has `--permission-prompts host` for it); cost and speed of long chats; what the app does when the same chat is moved in twice.

## Similar open-source tools (looked up on GitHub 2026-11-13; nothing copied)
| Repo | Stars | Licence | What it is |
|---|---|---|---|
| BloopAI/vibe-kanban | 28.7k | Apache-2.0 | Board of tasks, each run by a coding agent |
| slopus/happy | 24.6k | MIT | Phone and web client for Claude chats running on the PC |
| winfunc/opcode | 22.4k | AGPL-3.0 | Desktop app to manage Claude Code chats and agents |
| siteboon/claudecodeui | 14.6k | AGPL-3.0 | Web and phone page for Claude Code chats |
| smtg-ai/claude-squad | 8.8k | AGPL-3.0 | Several terminal agents side by side |
| stravu/crystal | 3.1k | MIT | Several chats in parallel copies of a project (renamed, last push 2026-02) |
| sugyan/claude-code-webui | 1.1k | MIT | Web page for the command line (archived) |
Ideas worth borrowing: one list of all chats with a "needs you" mark (already ours), a task box per project, a chat view that shows only the last messages. All of them start their own chats through the command line, the same route as T1 and T2; none steers chats inside the official desktop app.

## Added 2026-11-16 (step 14.6, real runs by the Opus helper and again by the manager)
| # | What | Proof |
|---|---|---|
| T16 | A chat can be started WITH Remote Control as a background chat: `claude --bg --name N --remote-control N --permission-mode auto [--model m] [--tools ""] -- <task>` | the open list shows it with a pid within about 2 s; `claude logs <id>` says "/remote-control is active" a few seconds after the start. The short id is printed as "backgrounded · <8 hex> · name" and is the first 8 characters of the session id |
| T17 | `--session-id` is ignored with `--bg` ("--bg manages the session id"); the task cannot go on standard input, it goes on the argument list after `--` | a stdin-only task never arrived in the saved file |
| T18 | Switching Remote Control off: `claude stop <short id>`, wait until the list shows no pid (about 1.5 s), then `claude -p --resume <session id>` answers in the SAME session | reply in the same session id, twice |
| T19 | Switching it on again: a chat that ran in the background is woken with ONLY `claude --bg --resume <id>` (it keeps its saved options, Remote Control included); adding any flag there starts a COPY. A chat that only ever ran as `-p` turns continues under the same id with `--bg --name N --remote-control N --permission-mode auto --resume <id>` | same session id, no new file, Remote Control active again; the copy case was seen once and stopped |
| T20 | A new background chat can be listed as idle before its first turn has run | the engine keeps the first turn "working" until a reply is in the saved file (or 20 s of idle) |
RE-TEST all of T16 to T20 after a Claude update: `node tools/dashboard/lib/chats.mjs --selftest --real-rc` (starts and stops its own chats only, cheapest model).

## Added 2026-11-21 (D49 test: closed app chats)
Real runs by a helper, same versions as above (`claude` 2.1.316). One test chat only (`4fda14bc-...`, app id `local_4fda14bc-...`, cheapest model, no tools, replies HUB-D49-ONE to -SEVEN). "Closed" = the app has a record for the chat (T14) but no process: not in `claude agents --json`, and the app's own session tool says `isRunning: false`. Ivan's chats get there when the app restarts or the chat is archived; an idle open chat keeps its process for days (seen: processes from 18 Nov still idle on 21 Nov), so "I am not looking at it" does NOT make a chat closed. "Split" was checked in the saved file: each new message points to the message it follows (`parentUuid`).
| # | What | Proof |
|---|---|---|
| T21 | Moving a command-line chat into the app (T7b) makes a record but NO process | the record `local_<id>.json` appeared within 6 s; `claude agents --json` did not list the chat; the app's session tool said `isRunning: false`. The link also put that chat on Ivan's screen (it takes the main window) |
| T22 | **Closed app chat, answered from outside, no split** (3 rounds) | `claude -p --resume <id> "..."` (guard: not in the agents list first) replied HUB-D49-TWO / -FOUR / -SIX in the same id and the same saved file. The app's next message (sent from inside the app with its own messaging tool) hung from the outside answer each time, and the app's reply listed every earlier word including the outside ones (last one: "HUB-D49-SEVEN: ...ONE, TWO, THREE, FOUR, FIVE, SIX") |
| T22b | Also safe when the app already had its own turns in that chat | round 2: the record's `lastAssistantUuid` still pointed at the app's own last reply (THREE) after the outside answer, yet the app continued from the end of the file (after FOUR), not from that pointer |
| T22c | Also safe when the closed chat is ON SCREEN (shown, but no process) | round 3: chat open in the main window, no process; outside answer SIX, then the app's message hung from SIX |
| T23 | The app's record does not notice an outside answer | round 2: 0 fields changed after the outside answer (round 1: only `lastFocusedAt`, from moving the screen away). `lastActivityAt`, `title`, `completedTurns`, `lastAssistantUuid`, `postTurnSummary` stay as they were until the app's own next turn updates them. So the chat does not jump up in the app's list and the app's own "what happened" summary is out of date. The app's transcript reader (`list_events`) did show the outside answer, because it reads the saved file |
| T24 | A chat started by the command line gets its title from Ivan's start-up hook, not from `--name` | `--name HUB-D49-TEST-1` was replaced by "Hub · 11.5 Start with the PC... · 21 Nov 01:04" |
| T25 | Safe way to bring a test chat back to "closed" | the app's archive tool stops its process (pid gone, not listed); unarchive brings it back closed. Only for the Hub's own test chats |

NOT proven, or still risky:
- **On screen, the app's page itself was not looked at.** Whether a chat that is on screen shows the outside answer at once, or only after it is reopened, is unknown (the saved file and the app's next turn were right). RE-TEST with Ivan watching.
- **Race:** if Ivan (or his phone) sends a message into the same chat WHILE the Hub's answer is still running, the app starts its own process on a half-written file: that is the T9 split again. Short fixed answers took a few seconds; a real task with tools can take minutes.
- Not checked: whether a `claude -p` run shows up in `claude agents --json` while it runs (so the Hub must keep its own "busy" list); chats with Remote Control on; chats in a worktree; the outside runs were started from a shell inside the app (the saved lines are marked `claude-desktop`), not from the Hub's own process: RE-TEST from the Hub.
- The test chat `local_4fda14bc-b4b3-405e-b96b-c68457079ff4` is left ARCHIVED in the app (nothing running); Ivan can delete it from the Archived list.

**Rule for the Hub (D49)**, all must hold, checked by code right before sending:
1. the chat's saved-file id is NOT in `claude agents --json` (no app process, no background chat);
2. the app record (T14) for it exists, `isArchived` is false, and its `cwd` is the folder the Hub runs `claude` in;
3. the saved file has not changed for at least 60 seconds (no turn in flight, nobody just started it);
4. the Hub sends at most one answer per chat at a time (its own list), and shows "answering from the Hub, don't type in this chat" while it runs;
5. right AFTER the run, check the agents list again: if the chat appeared during the run, mark it "may be split, check it in the app" instead of "done".
If any check fails: do not send; tell Ivan "this chat is open in the app, answer it there" (T9). Expect the app's list order and summary to lag (T23).
