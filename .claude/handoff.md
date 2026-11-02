# Handoff: Hub   (updated 2026-11-02)
Git: main @ 343a45c "Hub: Phase 0 closed (D10), handoff" · pushed: yes (private https://github.com/ZivacHub/Hub) · uncommitted: this line

## Where we are in the plan
Phase 0 of 9 is DONE (4/4). Phase 1 of 9 — Ears and mouth: 0/5 steps. Steps done 4/43. Next per plan: 1.1 "Hey Jarvis" wake-phrase test, after the Phase 1 gate (preview shown, Ivan's go pending).
(Copied from docs/plan/BOARD.md. Plan APPROVED 2026-11-02.)

## What we're building
A Jarvis voice assistant that starts with Windows on Ivan's PC and a clean dashboard of all BUSNUS projects. It does not know answers, it only fetches them (plan boards, decisions, handoffs, chat history, the AI_Orcestration Manager). Ivan's words: docs/PRODUCT.md.

## Last session
- Did: Phase 0 end to end. 0.1 tools already there; 0.2 Llama 10/10, Qwen3 9/10; 0.3 Hub/.venv with wake phrase, hearing, PyTorch+CUDA, Kokoro, Chatterbox, everything measured (docs/reference/PC_FIT.md); 0.4 Ivan chose "Go to Phase 1, decide the layout after I hear the voices" (D10). Private repo created (D9).
- Left unfinished: nothing in Phase 0. The Phase 1 gate (preview + go) was being shown when the chat ended.

## Next steps (strictly in order; step 1 is where the next session starts)
1. Phase 1 gate (plan skill) for "Ears and mouth": plain-words preview, search note (docs/reference/PRIOR_ART.md covers the parts; nothing new to install), ask Ivan's go and where the voice sample for step 1.3 comes from (he supplies a clean clip of about 10 s of the film voice, or Claude finds a licence-free butler-style sample and shows its licence). Done when: Ivan says go and the sample source is noted (decision D11 if he chooses).
   Read first: docs/plan/phases/01-ears-and-mouth.md, docs/reference/PC_FIT.md, docs/DECISIONS.md
2. Step 1.1 "Hey Jarvis" wake test with his real microphone: needs him to speak 20 times and 20 minutes of normal noise; check the microphone with him first (which one, volume). Done when: counts printed (target at least 18 of 20, at most 1 false wake in 20 minutes).
3. Step 1.2 speech-to-text test with his 10 spoken sentences.

## Waiting on the owner
- Phase 1 go and the source of the Jarvis voice sample (see step 1 above).
- D4 Jarvis voice — film actor clone (private use only) vs licence-free butler sample vs try both; he hears them in step 1.3 and decides in 1.4. The memory layout (hearing on card or processor) is settled in the same step (D10).
- PRIOR_ART pending ideas (no rush): sniffly's chat-log reading idea and "needs you" alerts, both for phase 6.

## Gotchas a fresh session would get wrong (max 8, only things still true)
- Use `.venv\Scripts\python.exe` in Hub for the voice parts (Python 3.11.9, PyTorch 2.6.0+cu124, numpy 1.26.4, transformers 5.2.0 pinned by Chatterbox). Import torch BEFORE faster_whisper in the same program, or graphics-card hearing fails with cublas64_12.dll missing. Bare `py` opens 3.14.0: don't.
- The Ollama server was started by Claude and is probably still running (idle, no model loaded). Other models on his disk (lexi/uncensored llama variants, wizardlm 13b, gpt-oss cloud, embeddings) are his: don't delete.
- Disk: 21 GB free after installs. Any further download needs his yes and the size told first. Voice samples made so far (default voices, not clones): tests/audio/kokoro_sample.wav, chatterbox_sample.wav (git-ignored).
- Chatterbox is the slow voice (1.5 to 4 s per sentence); Kokoro 0.1 s. Brain + hearing + Kokoro fit on the card together; with Chatterbox the hearing should run on the processor.
- GitHub account is ZivacHub; repo is private; never make it public. Film-actor voice is private use only, never published.
- "ClipForge" is the folder `Socials Automatisation`. Ivan chose Python voice + Node dashboard (D6). He wants it always on from Windows start (phase 5) and a casual, a-bit-vulgar tone (phase 8).
- Never post, spend money, delete/overwrite files or speak secrets on its own; anything that changes something needs a read-back and a spoken "yes".
- The BUSNUS workshop handoff still has its own open step 1 (Game folder, Install.bat, old chats), set aside by Ivan, not dropped.

## Running / not committed
- Services running: Ollama server (idle)  ·  Not committed: files named in the Git line (committed right after writing this)
