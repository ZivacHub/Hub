# Handoff: Hub   (updated 2026-11-03)
Git: main @ d436d6e "Demo 2.6 attempt 2: relay timeout + backup model, latency tests, memory" · pushed: no (pushed right after this file) · uncommitted: this file (committed right after writing)

## Where we are in the plan
Phase 2 of 10 (Phase 0 to 8 plus Phase 9, placed right after Phase 2) — Project status by voice, in progress: 5/6 steps ticked (2.1 to 2.5). Steps done 9/48. Next per plan: 2.6 Milestone demo (needs Ivan's voice and his "the answers were right"). Phase 1 "Ears and mouth" is PARKED at 0/5 on purpose (D14, board Change log 2026-11-03).
(Copied from docs/plan/BOARD.md. Plan approved 2026-11-02.)

## What we're building
A Jarvis voice assistant on Ivan's PC and a clean dashboard of all BUSNUS projects. It fetches answers (plan boards, decisions, handoffs, Claude chat history), it does not hold them. Ivan's words: docs/PRODUCT.md. Today it runs on the installed isair/jarvis (trial) plus our own parts: Gemini free key as the brain (D13), Daniel (Kokoro bm_daniel) as the voice (D4), a relay in between (formal butler persona, hides dangerous built-in tools, timeout + backup model), a read-only "ask Claude" helper and a read-only project-status helper.
Folder rule (Ivan, 2026-11-03): everything about Hub and Jarvis lives in this Hub folder; the BUSNUS root is only the workshop for templates and shared workflow. This chat's working folder is now Hub.

## Last session
- Demo 2.6, attempt 1 (earlier): three questions in one sentence got only the first answer; fixed with tool_selection_strategy "all" (commit 44d8eff).
- Attempt 2 (Ivan: "Yes, go again"): Jarvis.exe had been closed (found not running at 18:41), restarted. Ivan reported: "he didn't even respond most of the time ... why is it such delayed". Measured: Google's free tier stalls (tests/gemini_latency.py): with Jarvis's real prompt the main model had a median of 17 s, up to 90 s and a 503; at 18:50-18:52 answer calls took 28-46 s; Jarvis makes about 4 Gemini calls per question (2 helper calls, tool pick, final answer) so one stall delays all. Not our pipeline. Earlier the same model answered in 0.4-1.2 s: it depends on Google's load.
- Fix (commit d436d6e): tools/jarvis_trial/gemini_relay.py gives the asked-for model 5 s to start answering, then asks the backup gemini-3.1-flash-lite (39/44 on the tool test, 88%; harmless misses); a failing model is skipped for 120 s. Seen live: main stalled, backup finished at 7.4 s total. Gemma 4 rejected (33/44, leaks "<thought>" text that Daniel would speak). Checks: tests/relay_retry_check.py, gemini_relay.py --selftest. Nickname "orchestration project" added (36). Hub entry moved from the BUSNUS workshop memory into this project's memory.
- Left unfinished: 2.6 is NOT ticked. Ivan has not yet heard a right answer through the fixed relay (the live test only showed the log; his reply to "were the answers right" is still open).

## Next steps (strictly in order; step 1 is where the next session starts)
1. (Plan order would say 1.1, but 1.1 to 1.5 are parked on purpose: D14.) Step 2.6 milestone demo: first check Jarvis.exe is really running (it was closed twice; `Get-CimInstance Win32_Process` with ExecutablePath under C:\Program Files\Jarvis, or just run tools/jarvis_trial/start_jarvis_trial.ps1, which is safe to repeat), warn Ivan, open a 4-minute listening window, he asks his three questions (which projects, how is ClipForge going, decisions waiting), read tools/jarvis_trial/relay_log.jsonl (fields model, asked, kind, seconds) and speaker_log.jsonl, show him. Done when he says the answers were right; then tick 2.6 on the board with that proof. If answers are still slow because Google is slow, do not decide alone: offer him the speed options (paid Google key for pennies, local model for the small helper calls, or wait for a calmer hour).
   Read first: docs/plan/phases/02-project-status-by-voice.md, docs/reference/COMMANDS.md
2. Close Phase 2 (tick it, show what works, handoff), then run the gate of Phase 9 "Continue a project's Claude chat by voice" (detail and the decisions he must make: docs/plan/phases/09-continue-claude-chat-by-voice.md), then the Phase 3 gate (dashboard by voice). Messages and email overview are still only pending ideas (docs/reference/PRIOR_ART.md, PRODUCT.md) and need his OK to become a phase.

## Waiting on the owner
- D15: his yes (or changes) on the nicknames (tools/hub_status/aliases.json, now 36); he said "Use defaults".
- 2.6: his word that Daniel's answers were right (or what was wrong). Possible choice if Google stays slow: paid key / local helper model / wait.
- Cheap leftover: which small local model is the offline backup for the Gemini brain (D13 detail); Qwen3.5/Gemma 4 locally needs a newer Ollama (side-by-side 1.5 GB; he paused that download).
- Cleanup he can OK: C:\Users\Ivan\JarvisTrial\installed (893 MB duplicate Jarvis copy) and the partial Ollama zip in JarvisTrial\ollama-new (564 MB). Also: JarvisTrial (1.7 GB, outside BUSNUS, scripts point to it, config backups hold his key) was left where it is; moving it into Hub is possible if he wants, with a .gitignore entry.
- PRIOR_ART pending ideas: email overview, the project loop, Instagram (no official personal route), an "ask the big brain" cloud command.

## Gotchas a fresh session would get wrong (max 8, only things still true)
- Start everything with tools/jarvis_trial/start_jarvis_trial.ps1 (speaker, relay with --speak, Jarvis, closes the "Model recommendations" notice, hides the face). Never start Jarvis.exe alone (localFiles can delete files, its own voice and jokes return). Jarvis's own voice is ON but muted per app by the speaker service (pycaw) so its 8 s follow-up window opens when Daniel finishes. Jarvis sometimes is simply not running (state file %TEMP%\jarvis_state says "asleep"): check before a demo.
- C:\Users\Ivan\.config\jarvis\config.json holds the Gemini key: never print, copy or commit it; JarvisTrial\config_*.json backups hold it too except config_gemini_working.json. Scripts may read it in-process (tests do), never echo it.
- Relay (port 8787): RELAY_FIRST_BYTE_S (5) and RELAY_BACKUP_MODELS (gemini-3.1-flash-lite) tune the fallback. It never logs what was said; `kind` is only the first 60 chars of Jarvis's own fixed prompt. Tests that call it add lines to relay_log.jsonl (git-ignored).
- tests/tool_pick_test.py through the live relay would make Daniel read all 44 answers: run a second relay without --speak (python tools/jarvis_trial/gemini_relay.py 8790) and set PICK_URL / PICK_MODEL; it overwrites tests/tool_pick_results.json (the step 2.3 proof): `git checkout` it afterwards.
- Mic-path tests use computer voice plus temporary settings voice_device "Microphone Array (Realtek(R) Au" and hot_window_enabled false (remove afterwards); Stereo Mix does not work. Never take full-screen screenshots (capture only the Jarvis window with PrintWindow).
- The `claude` command-line login is separate from the desktop app and expired once (Ivan runs /login in a terminal). Never ask the Claude helper to read real key files. Write files with the Write tool; PowerShell Get-Content/Set-Content breaks non-ASCII characters.
- Use `.venv\Scripts\python.exe` in Hub (Python 3.11.9); import torch before faster_whisper; Node 24 for tools/hub_status. Disk about 39 GB free; any download needs his yes and the size told first. Never post, spend, delete/overwrite files or speak secrets on its own.
- The BUSNUS workshop handoff still has its own open step 1 (Game folder, Install.bat, old chats), set aside by Ivan, not dropped; it is not Hub's business.

## Running / not committed
- Services running: Daniel speaker (8788), relay (8787, new code), Jarvis (face hidden), Ollama (idle)  ·  Not committed: this handoff (committed and pushed right after writing)
