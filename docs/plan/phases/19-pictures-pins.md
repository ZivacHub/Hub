Read when: wiring the picture route, drawing pictures or file chips in the chat view, or the Hub's own pinned chats (Phase 19)
# Phase 19: pictures in the chat view and pinned chats (data side contract)

Code: `tools/dashboard/lib/chatlog.mjs` (feed), `tools/dashboard/lib/chatimage.mjs` (one picture out of a saved chat), `tools/dashboard/lib/pins.mjs` (pins). Background: `docs/reference/CLAUDE_CONTROL.md`, section "Added 2026-11-21 (pictures, files and fork)" (T26 to T32c, design items 5 and 6). Replaces the line "A pasted image shows as `[image]`" in `19-claude-in-the-hub.md`.

## 1. The chat-log feed: new block shapes
The picture data is NEVER in the feed. A block says where the picture is (`m` = the message's `i`, `b` = the block's place in that message's `blocks`), and the picture is fetched separately.

| Block | Shape | Where it comes from |
|---|---|---|
| picture | `{ type: "image", mediaType, bytes, name?, m, b }` | an image block in Ivan's message (T26); an `attachment` line of an `@path` picture (T27); a picture inside a tool result, e.g. Read (T27b) |
| file | `{ type: "file", mediaType, bytes, name?, m, b }` | a `document` block in Ivan's message (PDF, T29); an `attachment` line of a PDF (its data is empty on this PC, so `bytes` is the original size, and it can not be fetched) |

- `mediaType` of a picture is one of `image/png`, `image/jpeg`, `image/gif`, `image/webp` as the saved file says. `bytes` = size of the data (from the base64 length; no decoding).
- `name` = only the file's name (never a folder), redacted: for an `@path` picture the name of the file; for a Read result the name of the file Claude read; a pasted picture has none; a document block uses its `title` if it has one.
- Where the blocks sit: pasted pictures and documents keep their place in Ivan's message (text and pictures in the order sent). An `attachment` line belongs to the user message right before it, and its block is added at the END of that message's blocks. A tool picture comes right after its `tool` block in the assistant message. The tool block's `output` no longer says `[image]` when the picture is shown.
- Old behaviour kept only when the picture cannot be shown: no data (`source.data` empty or missing) or a type that is not PNG / JPEG / GIF / WebP (e.g. SVG) gives the text block `[image]`, as before.
- Text-file attachments (`@file.txt`) add nothing (Ivan's text still holds the `@path`).
- Message numbers `i`, paging (`before`, `limit`, `firstIndex`) and everything else in the feed are unchanged. `parseChat` also returns `blockSources` (a Map `"m:b" -> { line, path }`, line numbers and key paths only) for `chatimage.mjs`; it is not part of any answer.
- Page rule: draw a `file` as a chip (name or the type, and the size), not a picture; draw an `image` with `<img src="/api/chat-image?id=<chat id>&m=<m>&b=<b>">` (the page's `img-src 'self' data:` already allows it).

## 2. `chatimage.mjs`: one picture
`readChatImage({ file, m, b, maxBytes })` -> `{ ok: true, mediaType, bytes: Buffer }` or `{ ok: false, status, error }`.
- `file` = a saved chat file the CALLER found. It is never taken from a request; it must end in `.jsonl`.
- `m`, `b` = whole numbers (a string of digits from a query string is fine; `-1`, `1.5`, `1e3`, text = 400). Same numbering as the feed (the module asks `chatlog.mjs` where block `m:b` sits, then reads that one line).
- Decodes the base64 and checks the FIRST BYTES: PNG, JPEG, GIF or WebP only. `mediaType` in the answer is what the bytes are, not what the file says. SVG, text, PDF and anything else are refused.
- Cap: 12 MB (`MAX_IMAGE_BYTES`); `maxBytes` can only lower it.
- Status codes: `400` bad numbers or bad file name, `404` no such picture (wrong message or block number, a text or file block, no data, file missing), `413` bigger than the cap, `415` the bytes are not PNG / JPEG / GIF / WebP, `422` the data is not valid base64.
- The server (later helper) does: `resolveChatFile(id, { chatList, hubChats, appRecords, root })` (exported by `chatlog.mjs`; the same lookup as `/api/chat-log`, only through the chat list; returns the file or `null`, unknown id = `null` = 404), then `readChatImage`, then answers with `Content-Type: <mediaType>`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, max-age=300`. GET only, same host guards as the other routes. Errors answer with the status above and a tiny JSON body.
- Read-only, starts no process. Cost: a picture request re-reads the saved chat file once (plus the place list, cached per file and change time).

## 3. `pins.mjs`: pinned chats (the Hub's own, the app's pin cannot be set from outside)
`makePins({ file, now })` -> `{ list(project?), pin({ chatId, project }), unpin({ chatId }), isPinned(chatId) }`.
- File: `data/pins.json` in the Hub folder (`data/` is git-ignored). Written atomically (temp file in the same folder, then rename). Content `{ "version": 1, "pins": [ { "chatId", "project", "at" } ] }`.
- `list()` = newest first; `list("Alpha")` = that project's pins. `at` = ISO time (`now` is a function or a number; default `Date.now`).
- `chatId` must match `h-...`, `s-<8 hex>` or `local_...` (the same pattern as the chat feed); `project` = a plain folder name (1-120 characters, no `\ / :`, not `..`).
- `pin` answers `{ ok: true, count }` (`already: true` when it was pinned), or `{ ok: false, error }`: bad id, bad project, 50 pins already ("at most 50 pinned chats; unpin one first"), file could not be written. `unpin` of something not pinned is `ok` with `already: true`.
- Never throws. A corrupt or wrong-shaped file reads as empty, bad or duplicate entries inside a good file are dropped, and the next change replaces the file. Pins of chats that no longer exist are the caller's to hide (the chat list decides what is shown).

## Tests
- `node tools/dashboard/lib/chatlog.mjs --selftest` (48 checks; the picture checks are at the end), `node tools/dashboard/lib/chatimage.mjs --selftest` (22), `node tools/dashboard/lib/pins.mjs --selftest` (22). All use fake files in a temp dir.
- Read-only try on the 11 real test chats (counts only): every picture block in them was fetched and came back as the right type (PNG or JPEG), the two PDF attachments and the PDF document block are file chips, no `[image]` text is left.
