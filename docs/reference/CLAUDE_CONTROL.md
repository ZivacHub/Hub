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

## Added 2026-11-21 (pictures, files and fork)
Real runs by a helper for steps 19.9 and 19.10, same versions (`claude` 2.1.316). All runs windowless from the Hub folder, cheapest model (`--model haiku`, = claude-haiku-5-5), Hub flags unless a row says otherwise. Test files were made by code in a scratch folder OUTSIDE the project (64x64 PNGs with one colour and a white square, random-noise PNGs of 3.0 / 4.0 / 6.3 / 15.9 MB, a text file renamed `.png`, a text file, two tiny PDFs, one with its text compressed so it cannot be read as plain bytes). Each run cost about 1 US cent of subscription use. Test chats (saved files only, never in the app, not running): `4f82f9d9` ONE, `7b680b84` TWO, `76842f9f` THREE, `6859bfd9` FOUR, `ceaa066b` FIVE, `1fd40f21` SIX, `d7b0ca0a` SEVEN, `1462d317` EIGHT, `d11f99ea` NINE, forks `22ca506c` FORK-ONE and `649aa61e` FORK-TWO.

"Hub flags" = `claude -p --output-format json --permission-mode auto --permission-prompts none [--session-id <id> --name N | --resume <id>]`, text on standard input (lib/chats.mjs `turnArgs`).

| # | What | How | Proof |
|---|---|---|---|
| T26 | **Picture sent as an image block**, new chat | `claude -p --input-format stream-json --output-format stream-json --verbose --permission-mode auto --permission-prompts none --session-id <id> --name N --model haiku`; standard input = ONE line `{"type":"user","message":{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":"<base64>"}},{"type":"text","text":"<question>"}]}}`, then close it | red picture: reply `Red`, exit 0, 9 s, no denials. The run ends by itself when standard input closes; the last output line is `{"type":"result",...}` with the same fields as `--output-format json` (`result`, `session_id`, `is_error`, `permission_denials`, `total_cost_usd`) |
| T26b | Same, as an answer to an existing chat | same with `--resume <id>` instead of `--session-id`/`--name` | blue picture: reply `Blue`, same chat id, same saved file |
| T26c | Image blocks need the stream flags | `--input-format stream-json` with `--output-format json` | refused at once: "--input-format=stream-json requires output-format=stream-json"; without `--verbose`: "--output-format=stream-json requires --verbose" |
| T27 | **Picture by `@path` in the text**, Hub flags unchanged | text `... the picture @C:/.../yellow.png ? Answer one word.` | reply `Yellow`, 1 turn (no tool needed), no denials. The file was OUTSIDE the project folder |
| T27b | Picture by plain path, Claude opens it itself | Hub flags + `--resume`, text "Look at the picture file C:/.../red.png with your Read tool" | reply `Red`, 2 turns (one Read), no denial in auto mode, file outside the project |
| T28 | Text file by `@path` | Hub flags, `@C:/.../note.txt` (outside) and `@LICENSE` (inside the project) | replies `HUB-ATT-TXT-MANGO` and `MIT License`; no denials either way |
| T29 | **PDF sent as a document block** | stream route of T26 on `--resume`, block `{"type":"document","source":{"type":"base64","media_type":"application/pdf","data":"<base64>"}}` | compressed-text PDF: reply `HUB-ATT-PDF-PEAR`, no tools used |
| T30 | Big pictures are shrunk by Claude itself | image blocks of 3.0, 4.0, 6.3 and 15.9 MB PNG (standard input up to 21 MB) | all replied `Purple`. The saved chat holds a re-compressed JPEG instead (6.3 MB PNG became 0.67 MB of base64; 15.9 MB became 0.60 MB). No upper limit was hit |
| T31 | A broken picture does not break the chat | a text file named `.png`: as an image block, and by `@path` | block: Claude replaced it with the text "[Image could not be processed: ...]" and said it could not see it; `@path`: the Read tool answered "not a valid PNG/JPEG/GIF/WebP". Both runs ended normally, exit 0 |
| T32 | **Fork** = a new chat that starts as a copy | Hub flags with `--resume <old id> --fork-session` (optional `--session-id <new id>` and `--name N`) | FORK-ONE: new id `22ca506c`, reply `Red, Blue` (the colours from the old chat). FORK-TWO with a chosen id: came back with exactly that id and name, reply `HUB-ATT-TXT-MANGO` (word from the old chat). Old saved files: byte size, change time and line count IDENTICAL before and after, both times |
| T32b | What the fork's saved file looks like | read-only | all old messages copied with the SAME message ids (`uuid`) but the new `sessionId`, pictures included; then the new turn. No field names the parent (no `forkedFrom`): the Hub must remember the parent itself. Without `--name` the fork keeps the old chat's title (two chats with one title) |
| T32c | The app does not list a fork (or any of these chats) | read-only: no app record (T14) mentions any test id; `claude agents --json --all` lists none | 0 records for all 11 ids |

How the saved chat file stores attachments (field names only; checked on the test chats):
- **Image block** (T26): the user message line holds `{"type":"image","source":{"type":"base64","media_type":"image/png" or "image/jpeg","data":"..."}}` next to the text block, plus `imagePasteIds: [1]` on the line. A second, hidden line (`isMeta: true`) says `[Image: source: %TEMP%\claude\<encoded folder>\<session id>\images\1.png]`: Claude keeps a FULL-SIZE copy of the original there (6.3 MB for the 6.3 MB picture). The picture's data also appears a second time in an `api-request-blob` line. Growth: a 12 KB picture added about 60 KB to the file; a 6.3 MB picture about 1.3 MB (file 1.83 MB against 0.49 MB for the same chat without a picture).
- **`@path`** (T27, T28): the user message is only the text; a separate line `{"type":"attachment","attachment":{"type":"file","filename":"<full path>","displayPath":"<path from the project>","content":{"type":"image","file":{"base64":"...","type":"image/png","originalSize":12420,"dimensions":{...}}}}}`. For a text file `content` is `{"type":"text","file":{"filePath","content","numLines","startLine","totalLines"}}`. For a PDF `content.type` is `"pdf"` with an EMPTY `base64`.
- **Read tool** (T27b): a `tool_result` whose `content` is `[{"type":"image","source":{"type":"base64","data":"...","media_type":"..."}}]`, and the line's `toolUseResult` holds the same picture again (`{type:"image",file:{base64,type,originalSize,dimensions}}`): 1.3 MB line for the 6.3 MB picture.
- **Document block** (T29): stored as sent, `{"type":"document","source":{"type":"base64","media_type":"application/pdf","data":"..."}}`.

What the Hub's chat-log feed (`lib/chatlog.mjs`) does today (checked by running its `parseChat` read-only on the test files): an image block in Ivan's message shows as the text `[image]`; a picture in a tool result shows as `[image]` inside the tool's output; `attachment` lines (`@path`) are skipped, so Ivan sees only his text with the `@C:/...` path in it; a `document` block (PDF) is dropped without a trace; a broken picture shows Claude's "[Image could not be processed ...]" note. Nothing is drawn as a picture yet.

NOT proven, or does not work:
- **PDF by `@path` or by the Read tool does NOT work on this PC.** The attachment carries an empty `base64`, and the Read tool asks for `pdftoppm` (poppler), which is not installed: "I can't read the word". Once Claude got the right answer only by dumping the raw bytes with Python (works only for a PDF whose text is not compressed). Use the document block (T29).
- A 6.3 MB picture by `@path` was NOT attached (no attachment line); Claude fell back to the Read tool by itself and still answered right (`Purple`). So `@path` has a size limit somewhere below 6 MB (not measured).
- A text file sent as a block (document with `source.type: "text"`), GIF / WebP / JPEG input, more than one picture per message, pictures plus `--fork-session` in one run, forking a chat that is open in the app or busy: not tried.
- Folder rule: in auto mode Claude read files OUTSIDE the project folder without asking (T27, T27b, T28). The files do not have to be in the project.

**Fork rule (B1, not tried on an open chat):** a fork only READS the old chat's file and never writes to it (T32), so it cannot split the old chat the way T9 does. But a fork of a chat that is busy copies a half-finished turn. So the Hub forks only when the D49 checks 1 and 3 hold (not in `claude agents --json`, file unchanged for 60 s), always passes `--session-id <new id>` and `--name <"Copy of ...">`, and records the parent id itself.

**Recommended Hub design (pictures and files):**
1. **Where files go:** the Hub's own git-ignored folder (for example `Hub/.claude/hub-uploads/<Hub chat id>/<random name>.<ext>`), never inside another project (CLAUDE.md: other projects' files are not the Hub's). T27/T27b/T28 show Claude can read them from there. Cap: 20 MB per chat folder, 200 MB in all; delete a chat's folder when the chat is deleted and anything older than 14 days. After an image or document block is sent the copy is not needed (the saved chat holds the data, T26), so the Hub may delete it right after the turn.
2. **How the page sends a file:** a separate route, not `/api/action` (its 14,000-character body limit stays). `POST /api/upload?chat=<Hub chat id>` with the raw file as the body (no multipart, no base64 from the browser), same guards as `/api/action` (origin, `sec-fetch-site`, `X-Hub-Token`), `Content-Length` required, stop reading at the cap. Answer: an upload id (random), never a path. The answer action then carries upload ids only.
3. **Caps and types:** pictures PNG / JPEG / GIF / WebP up to 10 MB each (Claude shrinks them itself, T30); PDF up to 10 MB; plain text / Markdown / CSV / JSON up to 1 MB; at most 4 files per message. Type decided by the first bytes (PNG `89 50 4E 47`, JPEG `FF D8 FF`, GIF `GIF8`, WebP `RIFF....WEBP`, PDF `%PDF-`; text = valid UTF-8 with no zero bytes), never by the name. SVG, HTML and anything else refused.
4. **How Claude gets it:** pictures and PDFs as image / document blocks through the stream route (T26, T29): add `--input-format stream-json --output-format stream-json --verbose` for that turn and read the last `"type":"result"` line of the turn log instead of the single JSON. Text files: `@<path>` in the text with the current flags (T28), or the file's text as a text block. Only Hub chats and closed app chats that pass the D49 checks.
5. **Showing pictures:** the feed gives each picture `{type:"image", m, b, mediaType, width, height}` instead of `[image]` (also for `attachment` lines and Read results). A new read-only route `GET /api/chat-image?id=<chat id>&m=<message index>&b=<block index>` finds the saved file the same way `/api/chat-log` does (nothing from the query becomes a path), decodes that one block, checks the first bytes are PNG / JPEG / GIF / WebP, and sends it with its real type, `X-Content-Type-Options: nosniff` and `Cache-Control: private, max-age=300`; anything else 404. The page's current rule `img-src 'self' data:` already allows it. PDFs show as a file chip (name and size), not drawn.
6. **Hidden copies:** Claude itself keeps full-size copies of block pictures in `%TEMP%\claude\<encoded folder>\<session id>\images\`. They are Claude's, not the Hub's; the Hub does not delete them, but Ivan should know big pictures leave a copy there.
