Read when: building or changing the usage meter (Phase 21).
# Usage meter: the data feed (step 21.2, data side)

Code: `tools/dashboard/lib/usage.mjs` (the engine, `makeUsage(...)`, `demoUsage()`), route in `tools/dashboard/server.mjs`.
Background: research rows U1-U5 in `docs/reference/CLAUDE_CONTROL.md` ("Added 2026-11-24"), budget-guard ideas in `docs/reference/ORCHESTRATION_IDEAS.md`.
Read-only: the feed never writes a file. The page, the hand-off button and the settings come later (other steps).

## Route
- `GET /api/usage` -> the snapshot below. `?live=0` = do not ask `claude` now (use what is cached). Anything else = may ask (still limited by the cache and the pause).
- `POST`, `PUT` and every other method: 405. No token needed (it only reads).
- `--demo`: a fixed made-up sample (`demoUsage()`): 5-hour 74 percent "warn", weekly 41 percent "ok", both from `app-history` with an `estimate` alternative, four sample chats. Same keys as the real answer.

## Where the numbers come from (best first, per limit)
| source | what | freshness |
|---|---|---|
| `claude` | One windowless `claude -p --input-format stream-json --output-format stream-json --verbose --no-session-persistence` in the Hub folder, no shell, no window. ONE line on standard input `{"type":"control_request","request_id":"usage-<random>","request":{"subtype":"get_usage","skip_behaviors":true}}`, then closed. The matching `control_response` carries `rate_limits_available` and `rate_limits.five_hour` / `seven_day` (each `{utilization 0-100, resets_at ISO}`; also `seven_day_opus`, `seven_day_sonnet`, `model_scoped`). No model call, no saved chat file (U5). 8 s limit, killed after that (`taskkill /T /F`). | answer cached 60 s; after "not available", a time-out or garbage: not asked again for 5 minutes |
| `app-history` | `%LOCALAPPDATA%\Claude-Data\claude_*\plan-usage-history.json` (newest file), read-only, the LAST sample: `u.fh` = 5-hour percent, `u.sd` = weekly percent. The account id (`org`) is dropped on reading. | `stale` when older than 15 minutes |
| `estimate` | The Hub's own count (below) divided by the calibration. | computed at each scan (60 s cache) |
| `none` | nothing usable | `percent: null`, `status: "unknown"` |

Picking: `claude` if it has a number not older than 15 minutes, else fresh `app-history`, else `estimate`, else the least old stale one, else `none`. The others go into `alternatives`, so the page can say "app says 52 percent as of 11:30".
`claude -p "/usage"` is never used (U1: it can turn into a model call).

## The Hub's own count (estimate, per chat, totals)
- Files: every `*.jsonl` under `%USERPROFILE%\.claude\projects\<folder>\` (main chats) and `<folder>\<chat id>\subagents\*.jsonl` (helpers), only files changed in the last 7 days. Read line by line from the last offset; unchanged files (same size and time) are not read again; a half-written last line is read next time. Scan cached 60 s.
- Only `assistant` lines with `message.usage` (not `<synthetic>`). Each API reply counted ONCE across all files: key `requestId`, fallback `message.id`; a repeated line keeps the largest number per kind; a resumed chat's copied lines count for the original chat (the file with the earliest reply wins). Same idea as `~/.claude/hooks/token-report.mjs` (read, not imported or run). No message text is kept.
- Weights: fresh x1, cache write x1.25, cache read x0.1, output x5 (`weighted`).
- 5-hour estimate: weighted tokens of the last 5 hours / calibration; when the app's last sample is younger than 5 hours, also "that value + tokens since", and the higher of the two is shown (`basis`: `last-5-hours` or `app-value-plus-since`).
- Weekly estimate: the window start is (1) claude's own `seven_day.resets_at` minus 7 days if seen in this run, else (2) the last big drop (10 points or more) of `sd` in the history (the earlier sample if the gap is 12 hours or less, else the later one; moved forward by 7 days when older than 7 days), else (3) the last 7 days. If a history sample lies after that start: that value + tokens since (`app-value-plus-since`), else tokens since the start / calibration (`basis`: `reset-from-claude`, `since-reset-seen`, `reset-seen-plus-7-days`, `last-7-days`).
- Calibration (`calibration`): learned from the history: stretches where the number only went up (5-hour: split at a drop or a gap over 90 minutes, at least +10 points; weekly: split at a drop or a gap over 2 days, at least +3 points), flat starts and ends left out, only stretches inside the scanned 7 days, values more than 10 times off the default thrown away; the median is used when there are at least 2 stretches (`learned: true`), else the defaults from the research: 155,000 weighted per 5-hour percent, 1,200,000 per weekly percent (`learned: false`).
- Use from claude.ai, the phone or Cowork is not in these files: the estimate can be too low for that reason.

## Levels
- `data/hub-usage-config.json` in the Hub folder (git-ignored), optional: `{ "warnAt": 70, "stopAt": 90, "neverAbove": 95 }`. Each 0-100, warnAt below stopAt, neverAbove not below stopAt. Wrong or unreadable: the defaults 70 / 90 / 95 and a plain `problem` line (also in `notes`).
- `status` per limit: `stop` at or above stopAt, `warn` at or above warnAt, else `ok`; `unknown` without a number. `overall` = the worse of the two (ok < unknown < warn < stop).
- `neverAbove` (95): only reported; the hand-off button (21.3) must not start a round above it.

## Shape (example, shortened)
```json
{
  "generatedAt": "2026-11-24T10:00:00.000Z", "demo": false,
  "limits": {
    "fiveHour": { "percent": 74, "resetsAt": null, "resetsAtGuess": false, "source": "app-history", "asOf": "2026-11-24T09:54:00.000Z", "ageMinutes": 6, "stale": false, "status": "warn",
                  "alternatives": [ { "source": "estimate", "percent": 71.5, "asOf": "2026-11-24T10:00:00.000Z", "ageMinutes": 0, "stale": false, "basis": "app-value-plus-since" } ] },
    "weekly":   { "percent": 41, "resetsAt": "2026-11-27T10:00:00.000Z", "resetsAtGuess": true, "source": "app-history", "asOf": "...", "ageMinutes": 6, "stale": false, "status": "ok", "alternatives": [ ... ] }
  },
  "overall": "warn",
  "levels": { "warnAt": 70, "stopAt": 90, "neverAbove": 95, "source": "default" },
  "live": { "state": "not-available", "checkedAt": "...", "nextTryAt": "...", "variants": [ { "name": "Opus, 7 days", "percent": 10, "resetsAt": "..." } ] },
  "history": { "found": true, "asOf": "...", "ageMinutes": 6, "samples": 125 },
  "calibration": { "fiveHour": { "tokensPerPercent": 155000, "learned": false, "stretches": 1, "default": 155000 }, "weekly": { "tokensPerPercent": 1029048, "learned": true, "stretches": 2, "default": 1200000 } },
  "total": {
    "fiveHour": { "from": "...", "tokens": { "fresh": 1450, "cacheWrite": 3550000, "cacheRead": 47800000, "out": 402000 }, "weighted": 11540000, "replies": 412, "helpers": { "tokens": { ... }, "weighted": 2490000, "replies": 96 } },
    "week":     { "from": "...", "basis": "since-reset-seen", "tokens": { ... }, "weighted": 110630000, "replies": 3880, "helpers": { ... } }
  },
  "chats": [ { "sessionId": "a1b2c3d4", "chatId": "h-20261116-101500-k3x9", "project": "Hub", "name": "Usage meter", "lastActive": "...", "weighted5h": 5310000, "helperWeighted5h": 1850000, "share5h": 0.46,
               "tokens": { "fresh": 820, "cacheWrite": 1650000, "cacheRead": 21400000, "out": 182000 }, "live": true } ],
  "chatsTotal": 105,
  "notes": [ "The command line gave no plan numbers (it is probably signed out: run 'claude /login' once in a terminal)." ]
}
```
Field notes:
- `live.state`: `not-tried`, `ok`, `not-available` (signed out or no plan limits; never an error), `failed`, `timeout`. `variants` only with an `ok` answer.
- `resetsAtGuess: true` = worked out from the history, not said by claude. `resetsAt` is null when unknown (the history has no reset times).
- `chats`: chats with a reply in the last 7 days, newest first, at most 40 (`chatsTotal` = all). `sessionId` = the FIRST 8 characters only (the chat list's `s-<8>` id). `chatId` (optional) = the chat list's id (`h-...` for Hub chats, `s-<8>` for app chats); `name` (optional) = the title from the Hub's records or the app's records, redacted like the chat list. `tokens` and `weighted5h` are the last 5 hours, helpers included; `helperWeighted5h` = the helpers' part. `live` = running now (the server passes the running program's live files plus the Hub's working chats). `project` = the BUSNUS folder the chat ran in (`workshop` for the BUSNUS root, `other` outside).
- Never in the output: the account id, full session ids, request or message ids, message text, the app's `claude_<id>` folder name, file paths.

## Engine (for tests and the page step)
`makeUsage({ homeDir, appDataDir, claudeCmd, now, readFileFn, spawnFn, killFn, config: { hubDir, projectsRoot, levelsFile, probeMs, liveCacheMs, backoffMs, scanCacheMs } })` -> `{ snapshot({ liveSessionIds?, labels?, probe? }), stats() }`. Everything outside can be replaced; `node tools/dashboard/lib/usage.mjs --selftest` uses fakes only; `--selftest --real` adds one read-only real run that prints counts only.

## Not verified yet
- A real `get_usage` answer WITH numbers: the command line on this PC is signed out (U5), so the live answer is "not available". After Ivan runs `claude /login` once: check that the live percentages match the app, then trust source `claude`.
- Whether the weekly limit is a fixed window or rolling: the history shows drops on uneven days (for example 68 to 38), so the window start is a best guess, labelled in `basis`.
- How close the estimate is: the 5-hour calibration has only one usable stretch in the last 7 days, so it uses the default.
