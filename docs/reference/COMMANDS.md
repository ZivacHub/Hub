# Safe command list (plan step 2.2)
Read when: adding or changing what Jarvis may do. Status: DRAFT for Ivan's OK (2026-11-03). In Phase 2 nothing on this list changes anything.

## What Jarvis can do today (read-only)
| Tool name | What you say (example) | What it fetches | Changes anything? |
|---|---|---|---|
| `hub__list_projects` | "Which projects do I have?" | every BUSNUS project with percent done; says which are not set up | No |
| `hub__project_status` | "How is ClipForge going?" | one project: phase, steps done, percent, next step, decisions waiting, handoff age (from its plan board, decisions list, handoff) | No |
| `hub__decisions_waiting` | "Are any decisions waiting on me?" | open and proposed decisions, for one project or all | No |
| `claude__ask_claude` | "Ask Claude which phase the Hub project is in." | Claude reads files in the BUSNUS folder (never secret-looking files) and answers in about three sentences; 10 to 20 seconds | No (read-only; every call logged on this PC) |
| `webSearch`, `fetchWebPage`, `weather`, `time` | "Search the web for ...", "what time is it" | the internet or the clock | No change on this PC (web text could try to give the model instructions: see the rails below) |
| `stop` | "Stop." | stops the voice | No |

Answers for the `hub__` tools are sentences built by code from the files (tools/hub_status/status.mjs); Gemini reads them aloud in its own words.

## Removed on purpose (Jarvis has them built in; the relay hides them from the model)
`localFiles` (can read, write, append and DELETE any file in your user folder, no questions asked), `screenshot` (would send screen text to Google), and the meal tools (not relevant).

## Not allowed yet (needs a read-back and a spoken "yes", and its own phase)
Anything that changes something: answering a decision in a project (Phase 4), starting or opening Claude work (Phase 7), posting or publishing, sending messages, spending money, deleting or overwriting files, speaking anything that looks like a secret.

## Safety rails (what actually enforces this)
1. The relay (tools/jarvis_trial/gemini_relay.py) removes the denied tools from every request to Gemini; self-test and a live test passed (2026-11-03).
2. The `hub__` tools only read files through Ivan's existing library; the helper has no write code.
3. The Claude helper has no blanket read permission, only the BUSNUS folder, plus hard blocks on secret-looking files and Jarvis's own settings folder; it cannot run commands, edit, browse or send.
4. Known gap: rails 1 only apply while Jarvis talks through the relay; Jarvis started some other way would have `localFiles` again. The start script always uses the relay.
