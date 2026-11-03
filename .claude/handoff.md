# Handoff: Hub   (updated 2026-11-03)
Git: main @ 0276fea "Handoff rewritten for Phase 2" · pushed: yes (private https://github.com/ZivacHub/Hub) · uncommitted: this file, board, tests (committed right after writing)

## Where we are in the plan
Phase 2 of 10 (Phase 0 to 8 plus the new Phase 9, placed right after Phase 2) — Project status by voice, in progress: 5/6 steps ticked (2.1 to 2.5). Steps done 9/48. Next per plan: 2.6 Milestone demo (needs Ivan's voice). Phase 1 "Ears and mouth" is PARKED at 0/5 (1.1 stays `[~]`) with Ivan's OK ("Yes, Phase 2 now", D14; board Change log 2026-11-03).
(Copied from docs/plan/BOARD.md. Plan approved 2026-11-02.)

## What we're building
A Jarvis voice assistant on Ivan's PC and a clean dashboard of all BUSNUS projects. It fetches answers (plan boards, decisions, handoffs, Claude chat history), it does not hold them. Ivan's words: docs/PRODUCT.md. Today it runs on the installed isair/jarvis (trial) plus our own parts: Gemini free key as the brain (D13), Daniel (Kokoro bm_daniel) as the voice (D4), a persona relay (formal butler, no jokes), a read-only "ask Claude" helper and a read-only project-status helper.

## Last session
- Did: D12 trial of isair/jarvis done; D13 (Gemini + Claude for delegated jobs + small local backup), D4 (voice = Daniel, fastest), D14 (Jarvis is the voice shell for now) decided in his words. Built tools/jarvis_trial/ (gemini_relay.py: persona rewrite, hides the dangerous built-in tools localFiles/screenshot/meal tools, forwards replies to the speaker; kokoro_speaker.py: Daniel on the graphics card; start_jarvis_trial.ps1), tools/claude_bridge/ (read-only ask_claude, hard read limits), tools/hub_status/ (read-only list_projects, project_status, decisions_waiting; reuses ~/.claude/hooks/lib/busnus.mjs). Ticked with proof: 2.1 (16 projects match busnus-status), 2.2 (Ivan: "they're all fine"; docs/reference/COMMANDS.md), 2.3 (39/40), 2.4 (30 default nicknames, D15 proposed), 2.5 (tests/spoken_check.py: 5/5 projects match their files). Web search is on. Then Ivan's first real-use report was fixed: tool routing rules in the relay (hub tools for status, ask_claude only when told, only the project he names), follow-up window restored (Jarvis voice muted per app, 8 s window, verified live), mishearing nicknames ("clipboard" for ClipForge).
- Not built, asked by Ivan: "continue the newest Learning Script Maker chat with Claude" (Phase 6.1 and 7, needs his OK to reorder), messages and email overview.
- Left unfinished: 2.6 (milestone demo with his own voice). The 40-sentence test ran through Gemini and the relay, not the full Jarvis loop; Ivan has not yet tried the project questions with his own voice.

## Next steps (strictly in order; step 1 is where the next session starts)
1. (Plan order would say 1.1, but 1.1 to 1.5 are parked on purpose: D14 and the board Change log 2026-11-03, Ivan's "Yes, Phase 2 now".) Step 2.6 milestone demo: start everything with tools/jarvis_trial/start_jarvis_trial.ps1, warn Ivan before he speaks, he asks three real project questions by voice (for example how ClipForge is going, which projects he has, decisions waiting) and gets right answers; show the log. Done when he says the answers were right.
   Read first: docs/plan/phases/02-project-status-by-voice.md, docs/reference/COMMANDS.md
2. Close Phase 2 (tick it, show what works, handoff), then run the gate of Phase 9 "Continue a project's Claude chat by voice" (Ivan: "Yes, move it up", board Change log 2026-11-03; detail and the decisions he must make: docs/plan/phases/09-continue-claude-chat-by-voice.md), then the Phase 3 gate (dashboard by voice). Messages and email overview are still only recorded as pending ideas (docs/reference/PRIOR_ART.md, PRODUCT.md) and need his OK to become a phase.

## Waiting on the owner
- D15: his yes (or changes) on the 30 default nicknames (tools/hub_status/aliases.json); he said "Use defaults".
- Cheap leftover: which small local model is the offline backup for the Gemini brain (D13 detail); the Qwen3.5/Gemma 4 test needs a newer Ollama (side-by-side copy, 1.5 GB; he paused that download).
- Cleanup he can OK: my duplicate Jarvis copy C:\Users\Ivan\JarvisTrial\installed (893 MB) and the partial Ollama zip in JarvisTrial\ollama-new (564 MB).
- PRIOR_ART pending ideas: email overview, the project loop, Instagram (no official personal route), an "ask the big brain" cloud command.

## Gotchas a fresh session would get wrong (max 8, only things still true)
- Start everything with tools/jarvis_trial/start_jarvis_trial.ps1 (speaker, relay with --speak, Jarvis, closes the "Model recommendations" notice, hides the face). Never start Jarvis.exe alone: it would have localFiles (can delete files) and its own voice and jokes back. Jarvis's own voice is ON but muted in the Windows mixer by the speaker service (pycaw, installed with Ivan's OK) so its 8 s follow-up window opens when Daniel finishes (Piper length 0.95 matches Daniel's pace); if the speaker is not running you would hear two voices.
- C:\Users\Ivan\.config\jarvis\config.json holds the Gemini key: never print, copy or commit it; JarvisTrial\config_*.json backups hold it too except config_gemini_working.json. Claude must not enter or handle his keys.
- Tests that use the microphone path use computer voice plus temporary settings voice_device "Microphone Array (Realtek(R) Au" and hot_window_enabled false (remove afterwards); Stereo Mix does not work with Jarvis. Never take full-screen screenshots (his private windows were caught once): capture only the Jarvis window with PrintWindow.
- The `claude` command-line login is separate from the desktop app and expired once (Ivan runs /login in a terminal). Never ask the Claude helper to read real key files: test with fake files. Write files with the Write tool; editing text files from PowerShell with Get-Content/Set-Content breaks non-ASCII characters (it happened to this handoff).
- Use `.venv\Scripts\python.exe` in Hub (Python 3.11.9); import torch before faster_whisper; Node 24 for tools/hub_status. Disk about 39 GB free; any download needs his yes and the size told first.
- Free tiers: Gemini TTS 3 requests a minute; chat calls are sometimes slow (one 28 s outlier).
- Never post, spend, delete/overwrite files or speak secrets on its own; anything that changes something needs a read-back and a spoken "yes".
- The BUSNUS workshop handoff still has its own open step 1 (Game folder, Install.bat, old chats), set aside by Ivan, not dropped.

## Running / not committed
- Services running: Daniel speaker (port 8788), relay (8787), Jarvis (face hidden), Ollama (idle)  ·  Not committed: this handoff, board, tests (committed right after writing)
