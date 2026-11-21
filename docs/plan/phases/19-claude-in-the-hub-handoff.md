Read when: building or changing the hand-off round (Phase 19)
# Phase 19, step 19.3: the hand-off round ("Hand off and pick up")

Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file is the contract of the hand-off round only.
Decisions: D57 (work chats live in the Hub, a button hands off at about 60 to 70 percent full), D44 (Hub chats follow the project workflow), D41 (Remote Control off at start, at most 2 chats working), D39 (auto mode). Facts: docs/reference/CLAUDE_CONTROL.md (T9: never write into a chat open elsewhere; T12 / T18: Remote Control chats are refused for answers).

## In plain words
Today Ivan does this by hand when a work chat gets full: he types `/handoff` into it (Claude rewrites the project's `.claude/handoff.md` and memory), then opens a NEW chat in the same project and types `/pickup`. The button does exactly that, with one extra safety check in the middle: **the new chat is only started if `.claude/handoff.md` really changed and the chat's reply was not an error.** A lost hand-off is the one thing that must not happen. The old chat is never stopped, changed or deleted; it simply rests and moves to "All chats" because the page shows the newest chat first.

## Code
`tools/dashboard/lib/handoffround.mjs`. Self-test (fakes only, never a real claude, never a real chat): `node tools/dashboard/lib/handoffround.mjs --selftest` (60 checks).
It uses ONLY the chat engine's own `list`, `answer` and `start` (`lib/chats.mjs` makeChats), so every engine rule still holds: T9 (never into a chat open elsewhere), Remote Control on = refused, at most 2 chats working, auto mode, logging without text. It never calls `stop` or `setRemoteControl`.

## API
```js
import { makeHandoffRound, SAY } from "./lib/handoffround.mjs";
const rounds = makeHandoffRound({ chats, log: (...a) => gameLog(...a) });   // chats = the makeChats() object of the server
await rounds.start({ id })   // -> { ok: true, roundId } | { ok: false, error }   (a refusal makes no round)
rounds.status(roundId)       // -> the round (below) | null (unknown or pruned)
rounds.active()              // -> [round, ...] every round still running
rounds.forChat(chatId)       // -> the newest round of that chat | null (a reloaded page can find its round by chat id)
```
Options (all but `chats` have defaults): `readHandoffStamp(folder) -> { mtimeMs, size } | null` (null = no file yet; default reads `<folder>/.claude/handoff.md`), `projectFolder(project) -> folder | null` (default: a folder with exactly that name directly inside `root`, the BUSNUS folder), `root`, `now()`, `sleep(ms)`, `log(action, id, result)`, `waitMs` (default 600000 = 10 minutes), `pollMs` (default 3000), `keep` (finished rounds kept, default 20).
`start` returns as soon as the checks pass; the rest runs on inside the server. The page polls `status(roundId)` (every 2 to 3 seconds is enough). Rounds live in the server's memory: a page reload keeps them, a Hub restart loses them (safe: the chat keeps its own state, and nothing is started blindly).
Exports for the page or server: `SAY` (all sentences below), `HANDOFF_TEXT` = "/handoff", `PICKUP_TEXT` = "/pickup", `WAIT_MS`, `POLL_MS`, `KEEP_FINISHED`.

## The round object (what `status` returns; a copy, changing it changes nothing)
`roundId` (`r-YYYYMMDD-HHMMSS-xxxx`), `chatId` (the old chat), `project`, `state` (`running` / `done` / `failed`), `step` (1 to 6, the last step reached), `steps` (`[{ step, at (ISO time), text (plain words), ok }]`, a failure is the last entry with `ok: false`), `startedAt`, `finishedAt` (null while running), `error` (null, or the plain reason), `next` (null, or what Ivan should do now), `handoffChanged` (null until checked, then true / false), `result` (null, or `{ oldId, newId, newName, handoffChanged: true }` when done).

## The steps
1. **Checks** (refused at once, nothing sent, no round made): the id is a chat in the engine's list (only Hub chats are there); Remote Control is off; the state is exactly `idle` (resting); the project folder is known; no round is running for this chat (one round per chat; the lock is taken before anything is read, so a double press makes one round).
2. **Stamp**: time and size of the project's `.claude/handoff.md` are remembered (or "no file yet").
3. **Send** exactly `/handoff` with `chats.answer`, then look at `chats.list()` every 3 seconds until the chat is resting again (it must have been seen working, or its turn count went up). Time limit 10 minutes. A list that can't be read for a moment is skipped; a chat missing from the list 3 times in a row ends the round.
4. **Verify**: the chat is `idle` with no error line, AND the stamp of `.claude/handoff.md` changed (time or size; a file that did not exist and now exists counts). If not: STOP, no new chat.
5. **New chat**: `chats.start({ project, task: "/pickup", remoteControl: false, model })`: same project, the project workflow left at its default (a task that starts with "/" is not wrapped again, D44), the old chat's model when it had one, Remote Control off (the old chat had it off, step 1).
6. **Result**: `{ oldId, newId, newName, handoffChanged: true }`. The old chat stays resting and untouched.

Only two texts ever leave this module: `/handoff` (into the old chat) and `/pickup` (as the new chat's task). The self-test proves it over every path.

## The exact messages (`SAY`)
Refusals (`start` returns `{ ok: false, error }`):
| When | Message |
|---|---|
| unknown chat, no id | The Hub does not know that chat. Look at the page again. |
| chat list unreadable | The Hub can't read its list of chats right now, so nothing was sent. Try again in a moment. |
| Remote Control on | Remote Control is on for this chat, and the Hub can't write into a chat while Remote Control is on. Turn Remote Control off here first, then press the button again. |
| not resting | The hand-off only starts on a resting chat, and this one is {still working / ended with an error / stopped}. Wait until it is resting, or answer it yourself. |
| round already running | A hand-off round is already running for this chat. Wait for it to finish. |
| folder unknown | The Hub can't find this chat's project folder, so nothing was sent. |
| handoff.md unreadable before | The Hub can't read the project's .claude/handoff.md, so it could not check the hand-off afterwards. Nothing was sent. |

Step lines (in `steps`):
| Step | Line |
|---|---|
| 1 | Checked: the chat is resting, Remote Control is off, the project folder is known. |
| 2 | Noted how .claude/handoff.md looks now (its time and size). / The project has no .claude/handoff.md yet; noted that. |
| 3 | Sent /handoff to the chat. Waiting for it to finish (at most 10 minutes). |
| 3 | The chat finished the hand-off and is resting again. |
| 4 | Checked: .claude/handoff.md changed and the chat's reply is not an error. |
| 5 | Started the new chat with /pickup: {new chat's name}. |
| 6 | Done. The old chat is resting in All chats (nothing was stopped or deleted); the new chat is picking up. |

Failures (`state: "failed"`, `error` + `next`):
| When | `error` | `next` |
|---|---|---|
| the engine refused /handoff (open elsewhere, two chats working ...) | The chat did not take the /handoff: {the engine's reason} No new chat was started. | Answer the chat yourself, or press the button again later. |
| the chat left the list | The chat disappeared from the Hub's list during the hand-off. No new chat was started. | Look at the All chats tab. |
| over 10 minutes | The hand-off took longer than 10 minutes, so the Hub stopped waiting. No new chat was started. | Open the chat and look. If the hand-off finished, start a new chat in this project with /pickup yourself. |
| reply was an error | The chat's reply to /handoff was an error, so no new chat was started. | Open the chat and look at its last reply; answer it yourself if it asks something. |
| chat stopped meanwhile | The chat was stopped during the hand-off, so no new chat was started. | (same as above) |
| handoff.md unchanged | The hand-off did not change handoff.md, no new chat was started. | (same as above) |
| handoff.md unreadable after | The Hub can't read .claude/handoff.md after the hand-off, so it can't prove the hand-off happened. No new chat was started. | Open the project's .claude/handoff.md and look; if it is new, start a new chat with /pickup yourself. |
| new chat did not start | handoff.md WAS updated, but the new chat did not start: {the engine's reason} | The hand-off is saved. Start a new chat in {project} with /pickup yourself. |
| a fault inside the Hub | Something went wrong inside the Hub during the hand-off round. No new chat was started. (after the new chat started: ... Look at the All chats tab.) | Open the chat and look at its last reply ... / Look at the All chats tab. |
The timeout never stops the chat: it keeps running and Ivan decides.

## Log
One line per step in `logs/hub_actions.log` through the server's `log(action, id, result)`: action `handoff-round`, the round id, and a short code such as `step 1 ok chat h-...`, `step 3 ok sent /handoff, waiting`, `step 4 failed: handoff.md unchanged`, `refused: Remote Control on h-...`. Never the chat's text or its error text.

## Wiring (for the manager, not done by this step)
- Server: one `makeHandoffRound({ chats, log })` next to the chat engine (not in `--demo`). Routes, for example `POST /api/chats/handoff-round { id }` -> `start`, `GET /api/chats/handoff-round?round=<id>` -> `status`, and `forChat` / `active` for a reloaded page. Only the chat id comes from the page.
- Page: the "Hand off and pick up" button (from about 60 percent, never pressed for him) shows the step lines while running, then the new chat (it becomes the latest chat on the project page), or the error and the `next` line.

## Not verified yet
- No real run: the self-test uses a pretend chat engine, a pretend clock and a pretend handoff.md. The real round is run later with Ivan watching (a real `/handoff` and `/pickup` in a real project).
- How long a real `/handoff` takes (the 10-minute limit is a guess), and whether a real `/handoff` could leave handoff.md unchanged on purpose (for example nothing new to save): then the round stops, which is the safe side.
- A Hub restart in the middle of a round loses the round's status (the chat itself is not affected).
