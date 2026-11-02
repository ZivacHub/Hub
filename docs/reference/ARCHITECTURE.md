# Architecture
Read when: adding a part, changing how the voice program and dashboard talk, or any memory problem.

## Stack (versions to be confirmed via context7 in Phase 0)
- Voice program (Python): wake phrase (openWakeWord), hearing (faster-whisper), command picker (local model via Ollama), voice (Chatterbox, Kokoro backup). A small hand-written loop (D5).
- Dashboard (Node): a plain local web page that reads a local data feed from the Python program (D6).
- Everything runs on this PC; no open internet port (D8).

## Shape (one line each)
wake phrase -> listen -> local model picks one command from the safe list (docs/reference/COMMANDS.md) -> code fetches the answer from files or the Manager -> code builds the sentence -> voice speaks. Changing commands add: read-back -> spoken "yes" -> action -> log.

## Where answers come from (read-only unless stated)
- Each project's docs/plan/BOARD.md, docs/DECISIONS.md, .claude/handoff.md (phase 4 may append to DECISIONS.md).
- Claude chat history files under `~/.claude/projects/` (read-only, phase 6).
- The AI_Orcestration Manager over its local address (phase 3.5).

## Data model
- None at first: files in, a command log out (D8). Revisit only if the log or ideas grow.

## Key decisions
| Decision | Why | Date |
|---|---|---|
| Local model only, no Anthropic key (D2) | free, offline, he only needs command-picking | 2026-11-01 |
| Small program, not Pipecat (D5) | readable, light at idle | 2026-11-02 |
| Python voice + Node dashboard (D6) | Ivan's choice; two languages joined by a local data feed | 2026-11-02 |

## Scalability
- What breaks first: graphics memory when a game or Unity runs next to the voice parts. Plan: load heavy parts on demand and free them (phase 5.2).

## Security
- Local address only, closed to the network. No secrets read or spoken. Secrets in .env (never committed). Security review in step 5.6.
