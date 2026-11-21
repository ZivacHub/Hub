Read when: building or changing the project page (step 17.4) or its feed.
# Phase 17, step 17.4: the project page feed (read side)

Code: `tools/dashboard/lib/projectpage.mjs` (feed), route in `tools/dashboard/server.mjs`, sample data `tools/dashboard/demo/project-page.json`.
Everything is read-only. Nothing from the query is ever put into a file path: the name is only compared with the known project names.

## Route
`GET /api/project?name=<project name>`
- `name` must be exactly one of the names in `/api/projects` (case counts). Anything else, empty, or missing: `404 {"error":"unknown project"}`.
- POST / PUT / DELETE: `405`. The answer is redacted like the other routes (keys, tokens, passwords, long random strings become `[hidden]`).
- `--demo` serves made-up data for `Clip Studio` and `Job Applier` (other sample projects get empty lists).

## Shape
- `generatedAt`: ISO time. `demo`: true / false.
- `project`: the card from `/api/projects` (name, phase, percent, stepsDone, stepsTotal, nextStep, decisionsWaiting, handoffDaysOld, lastCommit ...).
- `decisions` (at most 20; open and proposed only, file order, every text field about 600 characters at most):
  `id` (D15), `title`, `status` (open or proposed), `question`, `options` (`[{key:"A",text}]`, empty when the file lists none), `ownerSaid` (his words, empty if none or "not answered yet"), `recommendation`, `date` (YYYY-MM-DD from the heading note or his words, or null).
  Read from `docs/DECISIONS.md` (v3) or `DECISIONS.md` (v2).
- `chats` (at most 30; chats that need Ivan first, then newest): `id`, `kind` (hub / app / terminal), `state` (working / idle / failed / stopped / closed), `title`, `needsYou`, `why` (question / permission / ""), `snippet`, `lastActive`, `since`, `openLink` (or null), `remoteControl` (true / false / null), `canAnswer` (true only for a resting Hub chat), `lastSaid` (the last thing Claude said, read from the saved chat file, 1400 characters at most; empty if no file is found), `lastSaidAt`.
- `handoff`: `{ nextSteps }` = first 40 lines of the "Next steps" section of `.claude/handoff.md` (3000 characters at most), or `null`.

## Example (shortened)
```json
{ "generatedAt": "2026-11-21T00:06:10.507Z", "demo": true,
  "project": { "name": "Clip Studio", "percent": 48, "nextStep": "4.3 Burn captions", "decisionsWaiting": 2 },
  "decisions": [ { "id": "D7", "title": "Which caption style?", "status": "open",
    "question": "Word-by-word or whole sentences?", "options": [ { "key": "A", "text": "Word-by-word ..." }, { "key": "B", "text": "Whole sentences ..." } ],
    "ownerSaid": "", "recommendation": "A, because ...", "date": "2026-11-05" } ],
  "chats": [ { "id": "h-2026...", "kind": "hub", "state": "idle", "title": "Hub · Clip Studio · 16 Nov 10:15", "needsYou": true, "why": "question",
    "snippet": "Which caption style ...?", "lastActive": "2026-11-20T23:15:00.000Z", "since": "...", "openLink": "claude://resume?session=...",
    "remoteControl": false, "canAnswer": true, "lastSaid": "The caption export now handles empty captions ...", "lastSaidAt": "2026-11-20T23:15:00.000Z" } ],
  "handoff": { "nextSteps": "1. Step 4.3 ...\n2. ..." } }
```

## How the chat's saved file is found
A Hub chat: by its session id (from the Hub's own chat list). An app or terminal chat: its id is `s-` plus the first 8 characters of the session id; the file is the one in that project's saved-chat folders whose name starts with them. No file found: `lastSaid` is empty (a Hub chat falls back to its own `lastReply`).

## Tests
- `node tools/dashboard/lib/projectpage.mjs --selftest` (25 checks, fake folders in a temp dir).
- `node tools/dashboard/server.mjs --selftest` (route checks: known name, unknown, path tricks, 405).

# Step 17.5: answering a CLOSED app chat from the project page (D54, rule D49)
Code: `tools/dashboard/lib/appanswer.mjs` (the engine and its rule checks), the action `chat-answer-app` in `tools/dashboard/server.mjs`, the field `canAnswerApp` in `lib/projectpage.mjs`, the answer box in `public/project.js` / `project.css`. Screenshot (sample data): `docs/screenshots/project-page-app-answer.png`.

## Feed field
`canAnswerApp`: true only for an app chat with `state` "closed", `remoteControl` false and a real "open in the app" link. A cheap first look; the full rule is checked when Send is pressed. Open app chats never get it (D40/D46).

## Request
`POST /api/action` with exactly `{ "action": "chat-answer-app", "appId": "local_...", "text": "...", "confirm": true }`, same guards as the other buttons (per-run token, same Origin, JSON, confirm, body limit). Any other field is refused. `text` 1 to 4000 characters (same as `chat-answer`). The server finds the chat's saved-file id (`cliSessionId`) and folder in the app's own records; nothing of that comes from the page. One log line per request, never the text. `--demo`: "Sample data mode: the buttons are switched off."

## The rule, checked by code right before sending (lib/appanswer.mjs)
1. the saved-file id is not in `claude agents --json`, and that list could be read;
2. the app record exists, is not archived, has a real saved-file id, is not one of the Hub's own chats, its folder IS a project folder (directly inside the BUSNUS folder: no subfolder, no worktree), and Remote Control is off; checked again after the open list was read;
3. the saved chat file `~/.claude/projects/<encoded folder>/<id>.jsonl` exists and has not changed for at least 60 seconds;
4. at most one answer per chat at a time (taken before the first wait, so a double click is refused at once);
5. after the run the open list is read again: if the chat is in it (or the list can't be read), the answer says "may be split".
Run: `claude -p --output-format json --permission-mode auto --permission-prompts none --resume <id>` (the same flags as the Hub's own answer), text on standard input only, no shell, no window, in the project folder, stopped after 10 minutes.

## Answers (shown on the card in these words)
- done: `{ ok: true, status: "done", message: "Done: Claude answered in the same chat.", reply, refused }` (page: "Claude replied" + the reply)
- may be split: `status: "may-split"`, "Claude replied, but the chat may be split: check it in the app." (or "Claude answered in a copy of the chat, not the chat itself: check it in the app." when Claude reports another session id)
- refused (`ok: false`, nothing sent): "This chat is open in the app: answer it there, so it does not split in two." / "Can't check whether this chat is open in the app, so nothing was sent. Try again in a moment." / "The chat changed less than a minute ago, so nothing was sent. Try again in a moment." / "The Hub is already answering this chat. Wait for that answer to finish." / "Remote Control is on for this chat: answer it on your phone." / "This chat is archived in the app, so nothing was sent. Unarchive it there first." / "This chat does not run in a project folder (for example a worktree), so the Hub can not answer it. Answer it in the app." / "Can't find this chat's saved file, so nothing was sent. Open it in the app." / "This chat has no saved file the Hub can find, so nothing was sent. Open it in the app." / "This is a Hub chat: answer it in its own box." / "The Hub does not know that chat. Look at the page again." / "The answer must be 1 to 4000 characters." / "The Hub can not answer that chat. Look at the page again." (wrong request shape)
- failed: "Claude could not answer: <first line>" or "Claude took longer than 10 minutes, so the Hub stopped it. Check the chat in the app."

## Page
Answer box + Send + "Open this chat" on such cards. Send first asks "Send this answer into the chat in the Claude app? Don't type in that chat while it works." (Yes / Cancel; nothing is sent before Yes). While it runs: "Answering from the Hub. Don't type in this chat in the app until it is done." and the box is locked. The draft is kept across the 30-second refresh and after a refusal; it is cleared after a reply.

## Tests (fakes only: no test runs the real claude or touches a real chat)
- `node tools/dashboard/lib/appanswer.mjs --selftest` (55 checks: each rule refused/accepted incl. 59 s vs 61 s, open list unreadable, archived, wrong folder, Remote Control, open chat, one at a time, "may be split" after the run, flags and limit still equal to chats.mjs, a fake claude program for standard input / no shell / time limit).
- `node tools/dashboard/server.mjs --selftest` (10 more checks for `chat-answer-app` with a fake engine, incl. the `--demo` server answering "buttons off").
- `node tools/dashboard/lib/projectpage.mjs --selftest` (28 checks, 3 new for `canAnswerApp`).
- Not yet done: a real answer into a real closed app chat, with Ivan watching.
