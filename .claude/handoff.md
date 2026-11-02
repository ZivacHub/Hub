# Handoff: Hub   (updated 2026-11-02)
Git: main @ 0abf6bc "Hub: step 0.3 done, voice parts measured (PC_FIT.md), test scripts" · pushed: yes (private https://github.com/ZivacHub/Hub) · uncommitted: this handoff

## Where we are in the plan
Phase 0 of 9 (Phase 0 to 8) — Check the PC. Steps done 3/43 (0.1, 0.2, 0.3 done). Next per plan: 0.4 Show Ivan the fit result and get his go.
(Copied from docs/plan/BOARD.md. Plan APPROVED 2026-11-02; Phase 0 gate passed the same day.)

## What we're building
A Jarvis voice assistant that starts with Windows on Ivan's PC and a clean dashboard of all BUSNUS projects. It does not know answers, it only fetches them (plan boards, decisions, handoffs, chat history, the AI_Orcestration Manager). Ivan's words: docs/PRODUCT.md.

## Last session
- Did: 0.1 (tools already there), 0.2 (Llama 10/10, Qwen3 9/10 on 10 sentences), 0.3: created Hub/.venv, installed wake phrase, hearing, PyTorch+CUDA, Kokoro, Chatterbox; measured every part idle and working and three combinations really loaded together. Results: docs/reference/PC_FIT.md. Fits: brain + hearing(small.en) + Kokoro = 6.9 of 8.19 GB. Chatterbox + brain = 7.5 GB (brain 31% on processor, still 0.17 s). All three heavy on the card does not fit; hearing on processor 1.15 s per clip. Chatterbox is slow (1.5 to 4 s per sentence) vs Kokoro 0.12 s. Wake phrase: 4% of one core idle.
- Left unfinished: 0.4 (Ivan has to read the result and say go or choose the memory layout).

## Next steps (strictly in order; step 1 is where the next session starts)
1. Step 0.4: show Ivan docs/reference/PC_FIT.md in plain words, put the memory-layout choice to him as a choice card (see Waiting on the owner), log his words as D10 in docs/DECISIONS.md, tick 0.4 and Phase 0, then run `handoff`. Done when: his words are in DECISIONS.md and the board shows Phase 0 `[x]`.
   Read first: docs/plan/phases/00-check-the-pc.md, docs/reference/PC_FIT.md, docs/DECISIONS.md
2. Phase 1 gate (Ears and mouth): plain-words preview, search note (PRIOR_ART), decisions (D4 is decided in step 1.4, after he hears voices in 1.3), his go. Then 1.1 "Hey Jarvis" wake test with a real microphone (20 spoken tries + 20 minutes of normal noise).
3. Step 1.3 needs voice samples: tests/audio/kokoro_sample.wav and chatterbox_sample.wav already exist (default voices, not clones).

## Waiting on the owner
- 0.4 go, with the memory-layout choice: (a) go to Phase 1 and decide the layout after hearing the voices (my pick), (b) plan now for the cloned voice with hearing on the processor, (c) plan now for the light voice Kokoro only.
- D4 Jarvis voice — film actor clone (private use only) vs licence-free butler sample vs try both; he hears them in step 1.3 and decides in 1.4.
- PRIOR_ART pending ideas (no rush): sniffly's chat-log reading idea and "needs you" alerts, both for phase 6.

## Gotchas a fresh session would get wrong (max 8, only things still true)
- Use `.venv\Scripts\python.exe` in Hub for the voice parts (Python 3.11.9, PyTorch 2.6.0+cu124, numpy 1.26.4, transformers 5.2.0 pinned by Chatterbox). Import torch BEFORE faster_whisper in the same program, or the graphics-card hearing fails with cublas64_12.dll missing. Bare `py` opens 3.14.0: don't.
- The Ollama server was started by Claude and is probably still running (idle, no model loaded). Other models on his disk (lexi/uncensored llama variants, wizardlm 13b, gpt-oss cloud, embeddings) are his: don't delete.
- Disk: 21 GB free after installs (venv about 6 GB, model files in his user Hugging Face cache, Qwen3 5.2 GB). Any further download needs his yes and the size told first.
- GitHub account is ZivacHub; repo is private; never make it public.
- "ClipForge" is the folder `Socials Automatisation`; the 11 folders without workflow files show as "not set up" on the dashboard.
- Ivan chose Python voice + Node dashboard (D6) although Python-only was recommended. He wants it always on from Windows start (phase 5) and a casual, a-bit-vulgar tone (phase 8).
- Never post, spend money, delete/overwrite files or speak secrets on its own; anything that changes something needs a read-back and a spoken "yes".
- The AI_Orcestration Manager was last edited in the summer and is untested (step 3.5). The BUSNUS workshop handoff still has its own open step 1 (Game folder, Install.bat, old chats), set aside by Ivan, not dropped.

## Running / not committed
- Services running: Ollama server (idle)  ·  Not committed: this handoff (committed right after writing it)
