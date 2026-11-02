# Handoff: Hub   (updated 2026-11-02)
Git: main @ b102204 "Hub: step 1.1 first results (not met), memory" · pushed: yes (private https://github.com/ZivacHub/Hub) · uncommitted: this line

## Where we are in the plan
Phase 1 of 9 (Phase 0 to 8) — Ears and mouth, in progress: 0/5 steps ticked, step 1.1 is `[~]`. Steps done 4/43 (all of Phase 0). Next per plan: finish 1.1 "Hey Jarvis" wake-phrase test (target not yet met), then 1.2.
(Copied from docs/plan/BOARD.md. Plan APPROVED 2026-11-02; Phase 1 gate passed the same day.)

## What we're building
A Jarvis voice assistant that starts with Windows on Ivan's PC and a clean dashboard of all BUSNUS projects. It does not know answers, it only fetches them (plan boards, decisions, handoffs, chat history, the AI_Orcestration Manager). Ivan's words: docs/PRODUCT.md.

## Last session
- Did: Phase 0 closed (D10). Phase 1 gate passed (D11: built-in laptop microphone, voice sample from his film clip + a licence-free butler clip + Kokoro). Microphone works (score 0.99, hearing exact). 1.1 results: 16/20 woke at threshold 0.5 (target 18); 20-minute video noise test: 0 false wakes at 0.5, loudest moment 0.48. A threshold near 0.39 would give 18/20 with about 1 false wake: right at the edge, one run each. Closed Opera GX for Ivan at his request. Researched OpenJarvis, isair/jarvis, PanPenek/JarvisAi (docs/reference/PRIOR_ART.md newest section) and opened D12.
- Left unfinished: step 1.1 (needs a re-run with Ivan speaking, after the threshold is chosen), steps 1.2 to 1.5.

## Next steps (strictly in order; step 1 is where the next session starts)
1. Put D12 to Ivan as a choice card (docs/DECISIONS.md): keep our own voice loop, or a one-hour trial of isair/jarvis in a separate folder first (Claude's reading: do the trial before 1.5). Nothing is installed for the trial until he says yes; its download size must be told first. Done when: D12 is `[decided]` with his words.
   Read first: docs/DECISIONS.md, docs/reference/PRIOR_ART.md, docs/plan/phases/01-ears-and-mouth.md
2. Finish 1.1: re-run `.venv\Scripts\python.exe tests\wake_test.py tries 2 20` with Ivan awake (warn him first, 10 s lead-in with three beeps, he says "Hey Jarvis" after each high beep), judge it at thresholds 0.5 and about 0.4, and repeat the 20-minute noise test at the chosen threshold with a different video. Tick 1.1 only if at least 18 of 20 and at most 1 false wake in 20 minutes; otherwise propose a fix as a choice card (other threshold, a second phrase, headset mic).
3. Step 1.2 speech-to-text test with his 10 spoken sentences (needs him present), then 1.3 (needs his film clip, about 10 s, clean; Claude finds the butler clip and shows its licence).

## Waiting on the owner
- D12 Build our own voice loop vs try isair/jarvis first (see step 1).
- D4 Jarvis voice (film actor clone, private use only, vs butler vs both): he hears them in 1.3 and decides in 1.4; the hearing-on-card-or-processor layout is settled in the same step (D10).
- His film-voice clip (about 10 s) for step 1.3.
- PRIOR_ART pending ideas (no rush): sniffly's chat-log reading idea, "needs you" alerts (phase 6), borrow-ideas-only from PanPenek and OpenJarvis.

## Gotchas a fresh session would get wrong (max 8, only things still true)
- Use `.venv\Scripts\python.exe` in Hub (Python 3.11.9, PyTorch 2.6.0+cu124, numpy 1.26.4, transformers 5.2.0 pinned by Chatterbox). Import torch BEFORE faster_whisper or graphics-card hearing fails with cublas64_12.dll missing. Bare `py` opens 3.14.0: don't.
- Tests that need his voice: announce the timing in a message BEFORE starting, use warning beeps; two earlier mic checks were silent because he was not ready. Mic: sounddevice device 2 (Microphone Array). His loud peak reached 82% of maximum: he must not lean closer.
- The 20-minute noise test hides repeat events within 3 s (debounce), so its "false wakes at 0.4" count is a lower bound (the loudest moment was 0.48).
- Ollama server was started by Claude and may still be running (idle). Other models on his disk are his: don't delete. Disk about 21 GB free; any download needs his yes and the size told first.
- GitHub account ZivacHub; repo private. Film-actor voice is private use only, never published.
- "ClipForge" is the folder `Socials Automatisation`. He chose Python voice + Node dashboard (D6), always on from Windows (phase 5), casual tone (phase 8). FxSound audio enhancer is installed on his PC (watch for effects on playback).
- Never post, spend money, delete/overwrite files or speak secrets on its own; anything that changes something needs a read-back and a spoken "yes". Closing his browser was explicitly asked by him this once.
- The BUSNUS workshop handoff still has its own open step 1 (Game folder, Install.bat, old chats), set aside by Ivan, not dropped.

## Running / not committed
- Services running: Ollama server (idle)  ·  Not committed: this handoff (committed right after writing it)
