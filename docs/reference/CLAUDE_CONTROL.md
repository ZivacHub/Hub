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
