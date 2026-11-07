# Handoff: Hub   (updated 2026-11-07)
Git: main @ 9964304 "Dashboard first: read-only local dashboard (cards, waiting decisions, Claude's latest words, Manager card, light/dark), plan re-ordered (D19, D20), README with screenshots" · pushed: yes (private repo ZivacHub/Hub) · uncommitted: this file and the memory entry (committed right after writing)

## Where we are in the plan
Phase 3 of 11 — Dashboard page: project cards, waiting decisions, Manager card, in progress. Steps done 14/53 (Phase 0 done; 3.1, 3.3, 3.6, 3.7, 6.4 ticked this session). Next per plan: 3.2 Design direction (built already, waits for Ivan's yes or changes), then 3.8 milestone. Plan v2: dashboard first, voice track optional at the bottom of the board (D19, board Change log 2026-11-07).
(Copied from docs/plan/BOARD.md.)

## What we're building
A local dashboard that shows all BUSNUS projects at a glance (cards, one list of waiting decisions, Claude's latest words per project, the Manager card), read-only, light by default with a dark switch. A Jarvis voice assistant is an optional extra in its own chat. Ivan's words: docs/PRODUCT.md. He wants to put Hub on his CV as an external program that maintains and overviews all projects, so the README and screenshots matter.

## Last session
- Ivan reordered everything: dashboard first, "jarvis is an optional thing and probaly will not live up" (D19); first-version contents and look (D20). Plan re-ordered, Phase 10 added (docs/plan/phases/10-dashboard-always-on.md), Phase 3 file rewritten.
- Built tools/dashboard/ (server.mjs, lib/data.mjs, public/*, demo/sample.json): run `node tools/dashboard/server.mjs` (real, http://127.0.0.1:4780) or `--demo` (sample data); `--selftest` 5/5. Proofs are on the board lines of 3.1, 3.3, 3.6, 3.7, 6.4 and in memory 2026-11-07.
- README rewritten with screenshots (docs/screenshots/, sample data only), pushed to the PRIVATE repo; secret scan clean.
- Left unfinished: 3.2 (his look approval), 3.5 (Manager only seen "not running" for real; running state only on sample data), 6.1 and 6.2 (not yet compared with the app for two projects), 3.8, Phase 10. The voice track (step 2.6 demo, D15 nicknames) is untouched since 2026-11-04 and belongs to the Jarvis chat.

## Next steps (strictly in order; step 1 is where the next session starts)
1. Show Ivan the pictures (docs/screenshots/dashboard-light.png, dashboard-dark.png, dashboard-phone-light.png) and the real page (`node tools/dashboard/server.mjs`, open http://127.0.0.1:4780); done when he says yes or lists changes to the look (3.2), then ask 3.8 ("does one glance tell you enough?"); changes become new steps with the next free numbers.
   Read first: docs/plan/phases/03-dashboard-by-voice.md, docs/reference/DESIGN.md
2. Close the loose ends of stage 2: start the AI_Orcestration Manager for real (server.py in AI_Orcestration/ai_company, port 8000) and check the card (3.5); compare "Claude last said" with the app for two projects (6.1, 6.2). Then Phase 6 step 6.3 and Phase 10 (start with Windows, security pass).
3. CV repo: only after his answer (see Waiting): either make ZivacHub/Hub public after removing or hiding internal notes, or publish a separate showcase repo. Never make the repo public without his yes.

## Waiting on the owner
- Public or not: README and screenshots are ready, but ZivacHub/Hub is PRIVATE and contains his decisions, handoff, memory and chat-derived notes. Options: make it public after a cleanup, a separate clean showcase repo, or share the private link on request. Not decided.
- 3.2: his yes or changes on the look (light default, dark switch).
- CV wording: how the voice part should be described (README says "optional, experimental, built on isair/jarvis, not included").
- D15 nicknames (tools/hub_status/aliases.json); step 2.6 demo and the offline backup model (voice track, Jarvis chat).
- Cleanup he can OK: C:\Users\Ivan\JarvisTrial\installed (893 MB) and the partial Ollama zip in JarvisTrial\ollama-new (564 MB).

## Gotchas a fresh session would get wrong (max 8, only things still true)
- Folder rule: this chat owns tools/dashboard/ and the dashboard docs; the Jarvis chat owns tools/jarvis_trial/. tools/hub_status/ is shared: the dashboard only imports it.
- Real mode needs Ivan's shared reader (~/.claude/hooks/lib/busnus.mjs); `--demo` is the only mode that runs elsewhere. Screenshots for the repo must come from `--demo`: the real page shows private project text. Playwright snapshots (.playwright-cli/) are git-ignored; delete them.
- The page runs under a strict Content-Security-Policy: no inline styles or scripts; set widths with element.style, add scripts as files.
- The Manager has /health, /goal, /queue (not /progress or /summary); it may ask for an API key, then the card says so.
- Chat history lives in ~/.claude/projects/<project path with every non-letter/digit as a dash>; files are tens of MB, so read only the tail.
- Voice track (from the Jarvis chat, still true): start with tools/jarvis_trial/start_jarvis_trial.ps1, never Jarvis.exe alone; C:\Users\Ivan\.config\jarvis\config.json holds the Gemini key, never print or commit it or its JarvisTrial backups.
- Use `.venv\Scripts\python.exe` (3.11.9) for Python, Node 24 for the dashboard; disk about 39 GB free; any download needs his yes and the size told first. Write files with the Write tool (PowerShell Set-Content breaks non-ASCII).

## Running / not committed
- Services running: none started by this chat (dashboard servers stopped); the Jarvis chat's services (speaker 8788, relay 8787, Jarvis, Ollama) may still run  ·  Not committed: this handoff and the memory entry (committed right after writing)
