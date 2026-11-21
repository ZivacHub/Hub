Read when: building or changing attachments or fork of Hub chats (Phase 19)
# Phase 19, steps 19.9 (fork) and 19.10 (pictures and files): the engine side

Code: `tools/dashboard/lib/uploads.mjs` (the store for attached files, new) and `tools/dashboard/lib/chats.mjs` (the chat engine). The page and the server route are other steps; this file is the contract they build on. Background and the real tests behind every rule: docs/reference/CLAUDE_CONTROL.md, section "Added 2026-11-21 (pictures, files and fork)" (T26 to T32c).

With no attachment and no fork, everything works exactly as before (all old engine checks pass unchanged).

## 1. The upload store (`lib/uploads.mjs`)
`makeUploads({ dir, now, maxFileBytes, maxPerMessage, keepDays, maxTotalBytes })`, all optional:
- `dir`: default the Hub's own `.claude/hub-uploads/` (git-ignored). One sub-folder per chat key, file names are random (`<24 hex>.<ext>`). The person's file name is never part of a path; a cleaned display name is kept in the store's `index.json`.
- `now`: a clock function (tests use a fake one). `keepDays`: default 7. `maxPerMessage`: default 4. `maxFileBytes`: default 10 MB (pictures and PDFs; text is always at most 1 MB or this, whichever is smaller). `maxTotalBytes`: default 200 MB for the whole folder (my addition, protects the disk).

Methods:
| Call | Gives back |
|---|---|
| `save({ chatKey, bytes, originalName })` | `{ ok: true, uploadId, kind: "image"\|"pdf"\|"text", mediaType, name, bytes }` or `{ ok: false, error }` |
| `get(uploadId)` | `{ path, kind, mediaType, bytes, name, chatKey }` or `null` |
| `resolve({ chatKey, uploadIds })` | the files of ONE message: `{ ok: true, files: [...] }` or `{ ok: false, error }` (the engine uses this) |
| `lookupFile(pathOrName)` | `{ uploadId, name, kind, mediaType, bytes }` for one of the store's own files, found by its stored path or file name, else `null`. For the viewing side: shows "note.txt" instead of the random name in an `@...` path |
| `remove(uploadId)` | `true` when it was there |
| `cleanup()` | `{ removedFiles, removedFolders }`. Deletes files older than `keepDays` (recorded ones by their save time, unrecorded leftovers by their file time), index lines whose file is gone, and empty folders. Does nothing when the folder does not exist. `makeChats()` calls it once when it starts |

Rules:
- `chatKey` = a Hub chat id (`h-...`) for an answer, or `"new"` for a chat that is being started. Pattern `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`; anything else is refused ("Unknown chat.").
- `bytes` = a Buffer or Uint8Array (the raw file, as the browser sent it).
- `uploadId` = 32 random hex characters, never a path. `get()` only answers for ids in the store's own index, only for a plain file inside the store's folder whose size still matches; an edited index that points outside, or at the index itself, gives `null`.
- The kind is decided by the FIRST BYTES, never by the name or the browser: PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, GIF `GIF87a`/`GIF89a`, WebP `RIFF....WEBP`, PDF `%PDF-`; text = valid UTF-8 with no zero bytes. A text file named `.png` is stored as text (`.txt`); a PNG named `.txt` is a picture. For text only, the name picks the label: `.md` = text/markdown, `.csv` = text/csv, JSON that parses = application/json, else text/plain.

Caps and plain-words refusals (exact sentences, exported as `UPLOAD_MESSAGES` where fixed):
| Case | Sentence |
|---|---|
| over 10 MB (any file) | "Files can be at most 10 MB." |
| text over 1 MB | "Text files can be at most 1 MB." |
| empty file | "The file is empty." |
| not bytes | "The file did not arrive. Try attaching it again." |
| SVG, HTML, XML | "SVG pictures and web pages can't be attached." |
| anything else (zip, exe, non-UTF-8 text...) | "This kind of file can't be attached. Use a picture (PNG, JPEG, GIF or WebP), a PDF, or a text file (text, Markdown, CSV or JSON)." |
| folder full (200 MB) | "The Hub's folder for attached files is full. Files older than a week are removed by themselves; try again later." |
| more than 4 in one message | "At most 4 files per message." |
| unknown id, or a file saved for another chat | "One of the attached files is no longer there. Attach it again." |
| the same id twice | "The same file was attached twice." |
| not a list | "Attachments must be a list of attached files." |

## 2. Pictures and files in the engine (`lib/chats.mjs`)
`start({ project, task, model, remoteControl, workflow, attachments })` and `answer({ id, text, attachments })`; `attachments` = a list of upload ids (optional).
- The text may be empty only when at least one file is attached; otherwise the old sentences stay ("The task / answer must be 1 to 4000 characters.").
- `start` only takes uploads saved with `chatKey: "new"`; `answer` only takes uploads saved with the chat's own Hub id.
- **Pictures and PDFs** (stream route, T26 / T29 / T30): the turn runs `claude -p --input-format stream-json --output-format stream-json --verbose --permission-mode auto --permission-prompts none` + the same `--session-id <id> --name <name>` (start) or `--resume <id>` (answer) + `--model` as usual. Standard input = ONE line, then closed:
  `{"type":"user","message":{"role":"user","content":[ <blocks> ]}}` where the blocks are, in the order attached, `{"type":"image","source":{"type":"base64","media_type":"image/png|jpeg|gif|webp","data":"..."}}` or `{"type":"document","source":{"type":"base64","media_type":"application/pdf","data":"..."}}`, and LAST `{"type":"text","text":"<the text>"}` (left out when the text is empty). The result is read from the LAST line whose `type` is `result` (same fields as before: `result`, `session_id`, `is_error`, `permission_denials`).
- **Text files** (normal route, T28): `@<absolute path of the stored file>` lines (forward slashes; `@"..."` if the path ever has a space) are added after the text, with an empty line between. Same flags as a plain answer. A message with pictures AND text files sends the `@` lines inside the text block (proven by the fake only, see "not verified").
- Each file is read right before sending. If one can't be read: "One of the attached files could not be read, so nothing was sent. Attach it again." Nothing is sent.
- Refused, nothing sent (sentences exported as `ATTACH_MESSAGES`):
  - files with Remote Control at the start: "Files can't be sent to a chat that starts with Remote Control. Start it without Remote Control, or send the files in a later message." (a background chat takes its task on the command line only, T17). A chat with Remote Control on refuses every answer as before ("Remote Control is on for this chat: ...").
  - files with a text that starts with `/`: "Files can't go with a / command. Send the command and the files as two messages."
  - files in the FIRST message of a chat that follows the project workflow (D44, `workflow` not false): "A new chat that starts with pick up (the project workflow) can't carry files in its first message. Start the chat first and attach the files to your next message, or tick "Skip the project workflow"." Reason, real probe 2026-11-21: in the stream route a `/info` text block was NOT run as a command (no command lines in the saved file; Claude only saw the words). So "/pickup <task>" plus a picture would not run pick up.
  - all old refusals stay (working, open elsewhere, two chats working, unknown chat).
- The log line gets the extensions only, e.g. `chat-answer h-... Hub ok pid 123 turn 2 files pdf,txt,png`. Never the text, names or paths.
- The stored files stay until the 7-day cleanup (not deleted after the turn). After a picture or PDF turn the saved chat holds the data, so the server MAY `remove()` those ids after the turn; text files must stay at least until the turn ends (Claude reads them during the turn).

## 3. Fork (`fork` and `forkSession`)
`fork({ id, name, text })`: copies a RESTING Hub chat (idle, failed or stopped; Remote Control off) into a NEW Hub chat.
- Runs ONE turn: `claude -p --output-format json --permission-mode auto --permission-prompts none --resume <old session> --fork-session --session-id <new uuid> --name <name> [--model <the old chat's model>]` in the same project folder, `text` on standard input (T32).
- No text: the fixed first message `FORK_FIRST_MESSAGE` = "This chat is a copy of an earlier chat, made in the Hub. Reply with one short sentence saying you are ready. Do not do anything else yet." (`claude -p` needs a message; "Continue." could restart the old chat's last task.)
- The new chat: own `h-...` id, name "Fork of <old name>" unless `name` is given (cleaned: no control characters, one space, at most 120 characters), same project, model and workflow flag, Remote Control off, `forkedFrom: <old Hub id>`, `forkedFromSession: <old session id>`. `list()` returns both fields for every chat (`null` when it is not a fork). Answers to the fork continue the FORK's own session.
- The old chat is never written: its Hub record is not changed, and Claude only reads its saved file (fake test and real run: size, time and line count identical).
- If Claude ever answers with the OLD session id, the copy is marked failed with "Claude continued the old chat instead of making a copy, so this copy has no chat of its own." and gets no session, so nothing can be sent into the old chat through it.
- Answer: `{ ok: true, id, message: "Made a copy of the chat in <project>. The old chat stays as it was." }`.

`forkSession({ sourceSessionId, project, name, text, model })`: the same for a session the CALLER has checked (the server: a closed app chat after the D49 checks; the 60-second "file unchanged" check is the caller's). The engine itself still refuses: a session id that is not a uuid or has no saved file `~/.claude/projects/<project folder>/<id>.jsonl` ("Unknown chat."); a session in `claude agents --json` or when that list can't be read; a session of one of its own Hub chats that is not resting (then `forkedFrom` points to that Hub chat). Default name "Fork of a <project> chat · <first 8 characters>". `forkedFrom` is `null` for a non-Hub source.

Fork refusals (exported as `FORK_MESSAGES`):
| Case | Sentence |
|---|---|
| unknown chat | "Unknown chat." |
| working | "This chat is still working. Wait for it to finish before making a copy." |
| stopped but still closing | "The stopped chat is still closing. Try again in a few seconds." |
| Remote Control on | "Remote Control is on for this chat. Turn it off first, then make the copy." |
| no session | "This chat has no Claude session to copy." |
| open elsewhere (in `claude agents --json`) | "This chat is open somewhere else (the Claude app or a terminal), so no copy was made. Close it there first." |
| list can't be read | "Can't check whether the chat is open elsewhere, so no copy was made." |
| two chats working | "Two chats are already working. Wait for one to finish." |
| name not text / first message over 4000 | "The name must be text." / "The first message must be at most 4000 characters." |

## 4. For the server step (wiring)
- Make ONE store `makeUploads()` and pass it: `makeChats({ ..., uploads })`. The engine also returns it as `chats.uploads`.
- Upload route (design point 2 in CLAUDE_CONTROL.md): raw body, `Content-Length` required, stop reading at 10 MB, then `uploads.save({ chatKey: <Hub chat id or "new">, bytes, originalName })`; answer with `{ uploadId, kind, name, bytes }` only, never a path.
- Answer / start actions carry `attachments: [uploadId, ...]`; fork actions call `fork({ id, name, text })`; closed app chats call `forkSession(...)` after D49 checks 1 to 3.

## 5. Tests
- `node tools/dashboard/lib/uploads.mjs --selftest`: 39 checks (each type, a text file named .png, a PNG named .txt, SVG / HTML / XML, zip and non-UTF-8 refused, empty, oversize 10 MB and 1 MB, the folder cap, path tricks in names, edited index pointing outside, size changed, 4 / 5 per message, another chat's file, cleanup with a fake clock).
- `node tools/dashboard/lib/chats.mjs --selftest`: 186 checks (127 old ones unchanged + 59 new in section E with the pretend claude: exact stream flags, the one JSON line with image, document and text blocks and the same bytes, result from the last result line, `@path` on the normal route, empty text with a file, every refusal with nothing sent, log without names, fork flags, fork record with forkedFrom, old record and old saved file unchanged, the fixed first message, fork of a fork, "kept the old id" guard, forkSession refusals and success). No test touches a real chat.

## 6. Real run 2026-11-21 (claude 2.1.316, `--model haiku`, all tools off, Hub folder, windowless)
Script outside the project (scratch folder), through the engine itself; `claude agents --json` read before each continue ("our session not listed" each time):
- New chat with a 95-byte solid blue PNG as an image block: reply `Blue` (Hub id `h-20261121-204148-ujja`, session `184c1ba7-d35b-4cdc-ad05-3e5511f07efd`). The turn log was stream lines ending with `result`.
- Same chat, answer with `@<stored note.txt>` (holds "The secret word is HUB-ATT2-KIWI."): reply `HUB-ATT2-KIWI`, same session, turn 2. Works with all tools off, so the CLI attaches the file itself.
- Fork with no text: new Hub id `h-20261121-204208-ywyx`, session `36cb87d4-5eba-471e-892c-5e04ad23854f`, name "Fork of Hub · What colour is this picture · 21 Nov 20:41", forkedFrom the old id, model haiku, reply `Ready.` Answering the fork "Reply exactly as: <colour>, <word>": `Blue, HUB-ATT2-KIWI`.
- Old saved file: 196184 bytes, same time, 53 lines before the fork, after it and at the end (IDENTICAL).
- The picture chat's saved file holds an image block and an `attachment` line for the `@` file. None of the test chats is in `claude agents --json` at the end.
- Probe (same day): session `4084beaf-c836-4a93-841b-83678af946c5`, a stream message with the text block `/info` plus a picture: not run as a command (section 2).
Each run cost about 1 US cent of subscription use. The test pictures and Claude's own hidden copies of them (`%TEMP%\claude\C--Users-Ivan-Desktop-BUSNUS-Hub\<session>\images\`) were deleted; the saved chat files of the three sessions are left (never in the app, not running), like the earlier test chats.

## 7. Not verified
- GIF, WebP and JPEG pictures, more than one picture in one message, pictures and text files in the same message, a PDF through the engine (T29 proved the block by hand), big pictures through the engine (T30 proved up to 15.9 MB by hand; 4 x 10 MB in one message is about 54 MB on standard input, never tried).
- `@"path with spaces"` (the Hub's path has no spaces).
- `forkSession` against a real closed app chat (fakes only). Forking a chat that HAS a picture in it works (real run above); sending a picture IN the fork's first turn is not offered (fork takes text only).
- Whether a start with files could follow the project workflow some other way (for example pick up first, then the files as a second turn): needs a decision; today it is refused in plain words.

## 8. Wiring (server): the contract for the page
Done in `tools/dashboard/server.mjs`. Every POST below needs the per-run token (`X-Hub-Token`, from `GET /api/session`) and the same Origin; the action ones also need `Content-Type: application/json` and `confirm: true`. In `--demo` every button answers `{ ok:false, error:"Sample data mode: the buttons are switched off." }` and stores nothing, EXCEPT pins (memory only, really toggles).

### 8.1 Upload: `POST /api/upload?chat=<Hub chat id h-... | new>`
- Headers: `Content-Type: application/octet-stream` (exactly), `Origin`, `X-Hub-Token`, `X-Upload-Name: <encodeURIComponent(original name)>`; `Content-Length` is required (a normal `fetch(url, { body: file })` sends it). Body = the raw file, no multipart.
- Body limit 10.5 MB for this route only. A bigger announced size is refused from the header alone (nothing read, connection closed); a body that grows past it while reading is cut off. The store itself still refuses files over 10 MB (text over 1 MB) with its own sentence.
- `chat`: `new` (chat not started yet) or a Hub chat id that the engine knows. For an answer attach to the chat's own id.
- Answer 200: `{ ok:true, uploadId, kind:"image"|"pdf"|"text", name, bytes, mediaType }` (never a path). Store refusals: status 200 `{ ok:false, error }` with the store's sentences from section 1 (for example "The file is empty.", "Files can be at most 10 MB.", "This kind of file can't be attached. ...").
- Other answers: 400 `{ok:false,error:"Unknown chat."}` (bad or missing `chat`), 400 "The file name could not be read.", 411 "The file size is missing. Try attaching it again.", 413 "Files can be at most 10 MB.", 415 "Send the file as application/octet-stream", 403 "forbidden origin" / "missing or wrong token", 405 for any method but POST. A well-formed but unknown Hub chat id: status 200 `{ ok:false, error:"Unknown chat." }`.
- Demo: after the guards, 200 `{ ok:false, error:"Sample data mode: the buttons are switched off." }`.
- Log: `upload <chat key> ok <kind> <bytes>` or `refused`; never the name.

### 8.2 Sending files: the `attachments` field
- `chat-answer` body `{ action, id, text, attachments?, confirm }` and `chat-start` body `{ action, project, task, model?, remoteControl?, workflow?, attachments?, confirm }`. `attachments` = a list of 1 to 4 upload ids (each 32 lower-case hex characters). Absent or `[]` = exactly the old behaviour (nothing extra reaches the engine).
- The text may be empty ONLY with at least one attachment (the engine decides and keeps its old sentences otherwise).
- Bad `attachments` (not a list, more than 4, an id that is not 32 hex characters or not a string): `{ ok:false, error:"The Hub can not send those attached files. Attach them again." }`, nothing sent. Everything else the engine says (section 2 and 3 sentences) is passed on unchanged.
- After a turn with pictures or PDFs has finished (the chat is no longer working: success or failure) the server removes those stored files; text files stay until the 7-day cleanup; a message the engine refused removes nothing (the person can retry with the same ids). The page must not reuse a picture's id after the message was accepted.

### 8.3 Fork: action `chat-fork`
- Body exactly `{ action:"chat-fork", id, name?, text?, confirm:true }`; `id` = a Hub chat id (`h-...`), `name` a string of at most 80 characters, `text` a string of at most 4000.
- Answer: `{ ok:true, id:<new Hub chat id>, note }` (note = "Made a copy of the chat in <project>. The old chat stays as it was.") or `{ ok:false, error }`.
- Sentences added by the server: "The Hub can not copy that chat. Look at the page again." (extra field, bad id, wrong type), "The name must be at most 80 characters.", "The first message must be at most 4000 characters." The engine's FORK_MESSAGES (section 3) are passed on.
- Hub chats only (no closed app chats yet).

### 8.4 Pictures: `GET /api/chat-image?id=<chat id>&m=<n>&b=<n>`
- `id` = any chat id of the chat list (Hub and app chats), `m` and `b` = the numbers of an `image` block from `/api/chat-log` (digits only).
- 200: the picture bytes with `Content-Type` taken from the bytes (png, jpeg, gif or webp), `X-Content-Type-Options: nosniff`, `Cache-Control: private, max-age=300`, `Content-Disposition: inline`, `Content-Length`.
- Errors, small JSON `{ error }`: 400 (bad numbers), 404 (`unknown chat`, or `no such picture`), 413 (over 12 MB), 415 (bytes are not a picture), 422 (bad data). POST/PUT/DELETE: 405. Foreign Host: 403.
- Use as `<img src="/api/chat-image?id=...&m=...&b=...">`. Demo: a made-up 120x80 PNG for sample chat blocks that are `image` blocks in demo/chat-log.json, 404 otherwise.

### 8.5 Pins
- `GET /api/pins` -> `{ pins:[{ chatId, project, at }] }` newest first; `?project=<name>` keeps that project's pins. Read-only (POST/PUT 405).
- Action `chat-pin`, body exactly `{ action:"chat-pin", chatId, project, pinned:true|false, confirm:true }` (token and Origin needed; the page does not ask Ivan first). `chatId` = `h-...`, `s-<8 hex>` or `local_...`; `project` = a plain folder name.
- Answer: `{ ok:true, pinned, count }` (plus `already:true` when nothing changed) or `{ ok:false, error }`: "The Hub can not pin that chat. Look at the page again." (bad shape, id or project), "At most 50 pinned chats. Unpin one first.", "The Hub could not save the pinned chats. Try again."
- `GET /api/project?name=...`: every entry of `chats` now also has `pinned: true|false`. The pins of chats that no longer exist are simply not shown by the chat list.
- Demo: really toggles in memory (gone when the demo server stops); `data/pins.json` is never written in demo.

### 8.6 Content-Security-Policy
The header already says `img-src 'self' data:`, so same-origin pictures from `/api/chat-image` are allowed; nothing was changed.

### 8.7 Tests and not verified
- `node tools/dashboard/server.mjs --selftest`: 140 checks (about 90 new, all with a fake engine, a fake picture finder, pins in a temp folder; demo checks use a second `--demo` server on a spare port). No test touches a real chat, the real upload folder or `data/pins.json`.
- Not verified: a real upload of a big file from a browser, the real engine behind the new routes (only fakes in the server test), `chat-image` against a real saved chat in the browser, the page side.
