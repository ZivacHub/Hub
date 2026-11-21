Read when: building or changing the Hub chat view (Phase 19) or its feeds
# Phase 19: Claude inside the Hub (D57, D58). The chat log feed

Code: `tools/dashboard/lib/chatlog.mjs` (feed), route in `tools/dashboard/server.mjs`, sample data `tools/dashboard/demo/chat-log.json`.
Everything is read-only. The browser view (other helper) draws this; the hand-off round has its own file (`19-claude-in-the-hub-handoff.md`).

## Route
`GET /api/chat-log?id=<chat id>[&before=<index>][&limit=<n>]`
- `id` = an id from the live chat list (`GET /api/chats`, also used by `/api/project`): a Hub chat `h-...`, an app or terminal chat `s-<8 characters>`, or an app chat's own id `local_...` (matched against the chat list's "open in the app" links).
- The id is only checked against a pattern and then compared with the list. The saved file is found from the Hub's own records: a Hub chat by its session id (engine list), an app chat by the app's record (`cliSessionId`), a terminal chat by the newest file in that project's saved-chat folders whose name starts with the 8 characters. Files live in `~/.claude/projects/<encoded folder>/<session id>.jsonl`; only the project's own folders (and its sub-folders) are searched. Nothing from the query becomes a path.
- Unknown id, path tricks, a bare Claude session id, empty or missing id: `404 {"error":"unknown chat"}`. POST / PUT: `405`.
- A known chat whose file is not there yet: `200` with no messages and `meta.savedFileFound: false`.
- Closed app chats: only the newest 12 per project are in the chat list (chatlist.mjs `CLOSED_MAX`), so older closed chats answer 404.
- `--demo`: two sample conversations (`h-20261116-101500-k3x9` with tools, headings, a list and code; `s-7a8b9c0d` short). Every other sample chat id answers with an empty log; other ids 404.

## Shape
- `generatedAt`, `demo`, `id` (as asked), `chatId` (the list's id, `s-...` for a `local_...` request).
- `messages`: in time order, `{ i, role: "user"|"assistant", at, blocks }`. `i` = the message's place in the whole chat (0 = first).
  - `{ type: "text", text }`: markdown as Claude wrote it, 20000 characters at most.
  - `{ type: "tool", name, summary, status, output }`: `summary` is one plain line (`Edit sub/page.html`, `Bash: npm test`, `Grep: salary in src`, `get_usage: self`), 200 at most; `status` = `ok` / `error` / `unknown` (no result yet, e.g. still running or waiting for permission); `output` = the tool's result, 1500 at most.
  - Thinking is never sent. One assistant message = one reply of the model (lines with the same message id are merged); a long turn is several assistant messages in a row, the view may draw them as one.
  - Not shown as Ivan's words: meta lines, compaction summaries, task notifications, `<system-reminder>` and other injected tags, lines starting with `[BUSNUS ...]`, sub-agent (sidechain) lines. A slash command shows as `/pickup Alpha`. A pasted image shows as `[image]`.
- `messagesTotal`, `hasMore` (older messages exist), `firstIndex`. Paging: the last `limit` messages before `before` (default: the last 200; `limit` 1-400; a bad number falls back to the default). Older page: `before=<firstIndex>`.
- `context`: `{ usedTokens, windowTokens, percent, estimated, basis }`, see below.
- `meta`: `cwd`, `projectName`, `branch` (`git rev-parse --abbrev-ref HEAD` in the chat's folder, no shell, 3 s, `null` on failure), `model`, `permissionMode` (last one recorded in the file, else the app record), `remoteControl` (true / false / null, from the chat list: the app record or the Hub chat's own flag), `kind` (hub / app / terminal), `state`, `title`, `startedAt`, `lastActive`, `compactions` (how often the chat was compacted), `savedFileFound`, `olderPartCut` (true only for a file over 64 MB: only its last 64 MB are read), `outputs`.
- `meta.outputs`: files this chat created or changed (Write / Edit / MultiEdit / NotebookEdit calls that did not fail), newest first, each path once, 50 at most: `{ path, outside, tool, at }`. `path` is relative to the chat's folder; a file outside it shows only `…/<folder>/<file>` with `outside: true`.
- Every text is redacted like the other routes (keys, tokens, passwords, long random strings become `[hidden]`).

## Example (shortened)
```json
{ "generatedAt": "2026-11-21T01:07:05.398Z", "demo": true, "id": "h-20261116-101500-k3x9", "chatId": "h-20261116-101500-k3x9",
  "messages": [
    { "i": 0, "role": "user", "at": "2026-11-20T23:32:05.398Z", "blocks": [ { "type": "text", "text": "/pickup Clip Studio" } ] },
    { "i": 1, "role": "assistant", "at": "2026-11-20T23:33:05.398Z", "blocks": [
      { "type": "tool", "name": "Read", "summary": "Read docs/plan/BOARD.md", "status": "ok", "output": "# Board ..." },
      { "type": "text", "text": "## Where we are\n\nPhase 4 ..." } ] } ],
  "messagesTotal": 5, "hasMore": false, "firstIndex": 0,
  "context": { "usedTokens": 642310, "windowTokens": 1000000, "percent": 64, "estimated": false, "basis": "last reply's size (input + cache read + cache write tokens)" },
  "meta": { "cwd": "C:\\...\\Clip Studio", "projectName": "Clip Studio", "branch": "main", "model": "claude-sonnet-5-5", "permissionMode": "auto",
    "remoteControl": false, "kind": "hub", "state": "idle", "title": "Hub · Clip Studio · 16 Nov 10:15", "startedAt": "...", "lastActive": "...",
    "compactions": 0, "savedFileFound": true, "olderPartCut": false,
    "outputs": [ { "path": "src/captions/export.mjs", "outside": false, "tool": "Edit", "at": "..." } ] } }
```

## How full the chat is (`context`)
- `usedTokens` = the usage of the LAST assistant reply in the file (main chat, not sub-agents, not `<synthetic>` error replies): `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` (field names checked on the real files).
- `percent` = `usedTokens / windowTokens`, rounded (the app rounds the same way: 27.7% shows as 28).
- `estimated: false` when nothing came after that reply. `true` when newer messages came after it (they are not counted yet), when the chat was compacted after it (then `usedTokens` = the compaction's `postTokens`), or when the model is unknown.
- The app compacts on its own at 97% (it reported `autoCompactsAtPercent: 97`). Ivan's habit is to hand off at 60-70%.

### Window per model (one table: `CONTEXT_WINDOWS` in chatlog.mjs; first match wins)
| Model id contains | Window |
|---|---|
| `[1m]` | 1,000,000 |
| fable, mythos | 1,000,000 |
| opus-5 (5, 5.5), opus-4-6 / 4-7 / 4-8 | 1,000,000 |
| sonnet-5 (5, 5.5), sonnet-4-6 | 1,000,000 |
| haiku-5 (5.5) | 1,000,000 |
| short names opus / sonnet / haiku / fable (Hub chats) | 1,000,000 |
| haiku-4-5, sonnet-4-5, opus-4-5, opus-4-1, opus-4-0, claude-3 | 200,000 |
| anything else | 200,000, `estimated: true` |
If `usedTokens` is above the window, 1,000,000 is assumed and `estimated: true`.
Sources (2026-11-21): the claude-api reference's model table, and the app itself (`contextWindow: 1000000` for Sonnet 5.5 chats). The saved files do not record the window.

### Accuracy check (2026-11-21, read-only: `get_usage` of the session tools vs this feed on the same file)
| Chat | App says | Feed says | Difference |
|---|---|---|---|
| Hub manager chat (Sonnet 5.5), waiting, 1st look | 277,157 tokens = 28% | 277,157 = 28% | none |
| Same chat, 2nd look later | 287,468 = 29% | 287,468 = 29% | none |
| Socials Automatisation chat (Sonnet 5.5), WORKING mid-turn | 163,562 = 16%, then 170,452 = 17% | 168,139 = 17% (then 173,700) | about 2,000-5,000 tokens (under 0.5 points) |
Result: for a chat that is not in the middle of a turn the number is exact. While a chat is working, the app also counts what arrived since the last reply (tool results), and the file moves every few seconds, so the two differ by a few thousand tokens. Idle, closed and archived chats cannot be checked against the app (it only reports a running chat), so for them the number is proven only by the same rule.

## Tests
- `node tools/dashboard/lib/chatlog.mjs --selftest` (38 checks, fake files in a temp dir); add `--real` to print counts (never text) for the 3 newest real Hub chats.
- `node tools/dashboard/server.mjs --selftest` (chat-log checks: known id from the live list, unknown 404, path tricks 404, POST/PUT 405, and the `--demo` sample conversation with paging).
