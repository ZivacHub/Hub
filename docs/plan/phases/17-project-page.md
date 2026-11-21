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
