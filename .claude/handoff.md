# Handoff: Hub   (updated 2026-11-03)
Git: main @ 31943bf "Step 2.3 done: 39/40 tool-pick test; alias and description fixes" · pushed: yes (private https://github.com/ZivacHub/Hub) · uncommitted: this file

## Where we are in the plan
Phase 2 of 9 (Phase 0 to 8) — Project status by voice, in progress: 3/6 steps ticked (2.1, 2.2, 2.3). Steps done 7/43. Next per plan: 2.4 Project names and nicknames. Phase 1 "Ears and mouth" is PARKED at 0/5 (1.1 stays `[~]`) with Ivan's OK ("Yes, Phase 2 now", D14; board Change log 2026-11-03).
(Copied from docs/plan/BOARD.md. Plan approved 2026-11-02.)

## What we're building
A Jarvis voice assistant on Ivan's PC and a clean dashboard of all BUSNUS projects. It fetches answers (plan boards, decisions, handoffs, Claude chat history), it does not hold them. Ivan's words: docs/PRODUCT.md. Today it runs on the installed isair/jarvis (trial) plus our own parts: Gemini free key as the brain (D13), Daniel (Kokoro bm_daniel) as the voice (D4), a persona relay (formal butler, no jokes), a read-only "ask Claude" helper and a read-only project-status helper.

## Last session
- Did: D12 trial of isair/jarvis done; D13 (Gemini + Claude for delegated jobs + small local backup), D4 (voice = Daniel, fastest), D14 (Jarvis is the voice shell for now) decided in his words. Built tools/jarvis_trial/ (gemini_relay.py: persona rewrite, hides the dangerous built-in tools localFiles/screenshot/meal tools, forwards replies to the speaker; kokoro_speaker.py: Daniel on the graphics card; start_jarvis_trial.ps1), tools/claude_bridge/ (read-only ask_claude, hard read limits), tools/hub_status/ (read-only list_projects, project_status, decisions_waiting; reuses ~/.claude/hooks/lib/busnus.mjs). Steps 2.1 (16 projects match busnus-status), 2.2 (Ivan: "they're all fine"; docs/reference/COMMANDS.md) and 2.3 (39/40) ticked with proof. Web search is on.
- Left unfinished: 2.4 to 2.6; the 40-sentence test ran through Gemini + relay, not the full Jarvis loop; Ivan has not yet tried the project questions with his own voice.

## Next steps (strictly in order; step 1 is where the next session starts)
1. (Plan order would say 1.1, but 1.1 to 1.5 are parked on purpose: D14 and the board Change log 2026-11-03, Ivan's "Yes, Phase 2 now".) Step 2.4: ask Ivan which nicknames he uses for his projects (ClipForge is done; others in tools/hub_status/aliases.json), add them, and test each nickname with `node tools/hub_status/status.mjs project "<nickname>"`. Done when every nickname he names answers the right project.
   Read first: docs/plan/phases/02-project-status-by-voice.md, docs/reference/COMMANDS.md
2. Step 2.5 spoken answers check: compare the spoken text with the files for 3 projects; then 2.6 milestone demo (Ivan asks three real questions by voice).
3. Phase 3 gate (dashboard by voice) after Phase 2 closes; his later wishes (messages/email overview, "ask a project what's going on, answer, Claude continues") are recorded as pending in docs/reference/PRIOR_ART.md and PRODUCT.md and need his OK to become phases.

## Waiting on the owner
- 2.4: his project nicknames.
- Cheap leftover: which small local model is the offline backup for the Gemini brain (D13 detail); the Qwen3.5/Gemma 4 test needs a newer Ollama (side-by-side copy, 1.5 GB; he paused that download).
- Cleanup he can OK: my duplicate Jarvis copy C:\Users\Ivan\JarvisTrial\installed (893 MB) and the partial Ollama zip in JarvisTrial\ollama-new (564 MB).
- PRIOR_ART pending ideas: email overview, project loop, Instagram (no official personal route), ask-the-big-brain cloud command.

## Gotchas a fresh session would get wrong (max 8, only things still true)
- Start everything with tools/jarvis_trial/start_jarvis_trial.ps1 (speaker, relay with --speak, Jarvis, closes the "Model recommendations" notice, hides the face). Never start Jarvis.exe alone: it would have localFiles (can delete files) and its own voice and jokes back.
- C:\Users\Ivan\.config\jarvis\config.json holds the Gemini key: never print, copy or commit it; JarvisTrial\config_*.json backups hold it too except config_gemini_working.json. Claude must not enter or handle his keys.
- Tests that need the microphone path use computer voice + temp settings voice_device "Microphone Array (Realtek(R) Au" and hot_window_enabled false (remove afterwards); Stereo Mix does not work with Jarvis. Never take full-screen screenshots (his private windows were caught once): capture only the Jarvis window with PrintWindow.
- The `claude` command-line login is separate from the desktop app and expired once (Ivan runs /login in a terminal). Never ask the Claude helper to read real key files: test with fake files. Write scripts with the Write tool, never nest PowerShell here-strings.
- Use `.venv\Scripts\python.exe` in Hub (Python 3.11.9); import torch before faster_whisper; Node 24 for tools/hub_status. Disk about 39 GB free; any download needs his yes and the size told first.
- Free tiers: Gemini TTS 3 requests a minute; chat calls can be slow at times (one 28 s outlier).
- Never post, spend, delete/overwrite files or speak secrets on its own; anything that changes something needs a read-back and a spoken "yes". Film-actor voice is private use only.
- The BUSNUS workshop handoff still has its own open step 1 (Game folder, Install.bat, old chats), set aside by Ivan, not dropped.

## Running / not committed
- Services running: Daniel speaker (port 8788), relay (8787), Jarvis (face hidden), Ollama (idle)  ·  Not committed: this handoff (committed right after writing it)
