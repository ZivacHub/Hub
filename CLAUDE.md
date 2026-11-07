# Hub

One-line purpose: a Jarvis voice assistant that starts with Windows on Ivan's PC, plus a clean dashboard of all BUSNUS projects. It fetches answers (plans, decisions, handoffs, chat history, the AI_Orcestration Manager); it does not hold them. For Ivan alone.

## Stack (decided with Ivan, see docs/DECISIONS.md)
- Voice program: Python, a small hand-written loop (D5, D6). Parts under test (D7): openWakeWord ("Hey Jarvis"), faster-whisper (hearing), Chatterbox cloning voice with Kokoro as the light backup. Local model through Ollama (Qwen3 8B or Llama 3.1 8B, picked by test in Phase 0), no Anthropic API key (D2).
- Dashboard: Node, a plain local web page (D6, D8). No database at first; a log file of every voice command (D8).
- Hosting: this PC only, no open internet port (D8). Starts with Windows (phase 5).
- PC: i7-13650HX, 15.6 GB RAM, RTX 4060 Laptop with 8 GB graphics memory, 41 GB disk free. Announce model/download sizes before downloading.

## Commands
- Versions on this PC (checked 2026-11-02): `python` = 3.11.9 (use this one; `py` alone opens 3.14.0, too new for voice libraries, so use `py -3.11`), Node v24.13.1, Ollama 0.22.1 (not running until started), ffmpeg not installed (add only if a part needs it, with Ivan's yes).
- Dashboard: double-click `Start Hub Dashboard.bat` in the project root (Ivan's launcher), or `node tools/dashboard/server.mjs` (add `--demo` for sample data); test: `node tools/dashboard/server.mjs --selftest`. Voice tools: see tools/hub_status and tools/jarvis_trial.

## Conventions
- Voice commands come from the safe list in docs/reference/COMMANDS.md (created in step 2.2). The model only PICKS a command; answers are built by code from fetched data.
- Anything that changes something (a file, a post, money) needs a read-back and a spoken "yes", and is logged. Never on its own: post/publish, spend money, delete or overwrite files, speak secrets.
- English only. Project nicknames live in `config/` (ClipForge = the Socials Automatisation folder).
- Other projects' files are not the Hub's: only the phase 4 append and phase 8 ClipForge commands, each with Ivan's go.

## Design stack (approved by Ivan: clean modern dashboard, 2026-11-01)
- Structure/typography/layout: impeccable (+ frontend-design as the baseline)
- Motion: none beyond a small voice indicator unless Ivan asks (emil's animate if so)
- Curation: design-taste-frontend only if a curated look is wanted (one design skill per role)
- Verify visually with playwright-cli (screenshot before calling UI done)

## Skills (chosen with find-skills 2026-11-02; Claude must use these, not skip them)
| Skill | Used for |
|---|---|
| context7 | current docs / versions of openWakeWord, faster-whisper, Chatterbox, Ollama, Node |
| playwright-cli | dashboard screenshots and checks |
| unlazy | long multi-part work |
| frontend-design, impeccable | dashboard design (Phase 3) |
| security-review (free default) | Phase 5 security pass |
No new skills were installed (search found nothing worth adding; paid voice skills rejected).

## Plugins (enabled for this project)
- None. No database in the first versions (D8); if one is needed later, SQLite (local-only).

## Skill routing
- UI work: Design stack above · DB: none · Docs/versions: context7

## Current state
- Plan v2, re-ordered 2026-11-07 (D19): dashboard first, voice optional (Jarvis chat). Dashboard runs: `node tools/dashboard/server.mjs` (real data, http://127.0.0.1:4780) or `--demo` (sample data). Steps 3.1, 3.3, 3.6, 3.7, 6.4, 11.1-11.3 done; 3.2 waits for Ivan's look approval; Phase 11 (start/stop projects, open in Claude Code, start with PC; D23-D25) waits on 11.4-11.6 (real tests with Ivan). Standing rule (Ivan 2026-11-07): every update is committed and pushed to GitHub; the repo is PUBLIC, so list the files and scan for keys first. This chat owns tools/dashboard/; the Jarvis chat owns tools/jarvis_trial/.

## How we work here (BUSNUS workflow v3, details in ~/.claude/CLAUDE.md)
- docs/PRODUCT.md = the goal in the owner's words (compass). docs/plan/BOARD.md = progress, in order. docs/DECISIONS.md = what the owner decided.
- The owner decides; Claude proposes. Plain words, choice cards, no jargon. Phase gate before each phase.
- `/pickup` continues, `/handoff` saves, `/plan` shows/changes the plan, `/project-sync` brings this project up to the current template.

## Where things are (docs map; full list with "read when" in docs/INDEX.md)
- Always read: this file, docs/PRODUCT.md, docs/plan/BOARD.md, docs/DECISIONS.md (open part), .claude/handoff.md.
- Current phase only: docs/plan/phases/NN-name.md. The handoff's `Read first:` line names the rest for the next step.
- On demand: docs/reference/ (ARCHITECTURE, DESIGN, TESTING, TASKS, SECURITY_CHECKLIST, PRIOR_ART; COMMANDS and PC_FIT once created). History: .claude/memory.md.
- Root of the project = code + this file + README.md + LICENSE + the three launcher files Start Hub Dashboard.bat, Install Hub Autostart.bat, Remove Hub Autostart.bat (Ivan wants them in the root, 2026-11-07). config/projects.json = what the dashboard may start. New doc? Put it in docs/ and add a row to docs/INDEX.md.

## Tools (Claude starts these itself; paid ones are optional extras)
- Security: Claude's own review + local probing (free, default). Strix only if configured (paid API).
- Local model: Ollama (Claude starts/stops it; tell Ivan in one line). See ~/.claude/TOOLS.md.
