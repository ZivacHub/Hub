# Handoff: Hub   (updated 2026-11-02)
Git: main @ 8616881 "Hub: step 0.2 done, local model results in PC_FIT.md" · pushed: yes (private https://github.com/ZivacHub/Hub) · uncommitted: this handoff

## Where we are in the plan
Phase 0 of 9 (Phase 0 to 8) — Check the PC. Steps done 2/43 (0.1, 0.2 done). Next per plan: 0.3 Measure each voice part (idle and active).
(Copied from docs/plan/BOARD.md. Plan APPROVED 2026-11-02; Phase 0 gate passed the same day.)

## What we're building
A Jarvis voice assistant that starts with Windows on Ivan's PC and a clean dashboard of all BUSNUS projects. It does not know answers, it only fetches them (plan boards, decisions, handoffs, chat history, the AI_Orcestration Manager). Ivan's words: docs/PRODUCT.md.

## Last session
- Did: Phase 0 gate; private repo (D9); 0.1 (tools already installed); 0.2: Ollama started, qwen3:8b downloaded (5.2 GB), llama3.1:8b was already there. 10-sentence test: Llama 10/10 at 0.75 s, Qwen3 9/10 at 0.51 s, both about 5.5 GB graphics memory (docs/reference/PC_FIT.md, tests/model_pick_test.py). Not a winner yet: step 2.3 decides.
- Left unfinished: nothing half-done. Step 0.3 not started.

## Next steps (strictly in order; step 1 is where the next session starts)
1. Step 0.3 Measure openWakeWord, faster-whisper, Chatterbox, Kokoro (idle and working: graphics memory, RAM, processor) and the local model; fill the "0.3" section of docs/reference/PC_FIT.md. Before downloading anything: create a Python 3.11 virtual environment in Hub/.venv (already git-ignored), tell Ivan each package's size (Chatterbox pulls PyTorch with CUDA, several GB, plus its model), check current install steps with context7, get his yes. Grade each piece on the spot (delegate skill). Done when: PC_FIT.md has all 5 rows with measured numbers. Test: numbers come from nvidia-smi / a script, not guesses.
   Read first: docs/plan/phases/00-check-the-pc.md, docs/reference/PC_FIT.md, docs/reference/PRIOR_ART.md
2. Step 0.4 Show Ivan the fit result in plain words and get his go (new decision if tight; key question: do Chatterbox and the 8B brain fit together in 8 GB, or load one after the other).
3. Phase 1 gate (Ears and mouth).

## Waiting on the owner
- Nothing for step 0.3 until the install sizes are told and he says yes (asked at the start of 0.3).
- D4 Jarvis voice — film actor clone (private use only) vs licence-free butler sample vs try both; he hears them in step 1.3 and decides in 1.4.
- PRIOR_ART pending ideas (no rush): sniffly's chat-log reading idea and "needs you" alerts, both for phase 6.

## Gotchas a fresh session would get wrong (max 8, only things still true)
- Use `python` (3.11.9) or `py -3.11`; bare `py` opens 3.14.0, too new for voice libraries. The Ollama server was started by Claude and may still be running (idle); ffmpeg is not installed (add only if a part needs it, with Ivan's yes).
- Other models already on his disk (lexi/uncensored llama variants, wizardlm 13b, gpt-oss cloud, embeddings) are his, not ours: don't delete them.
- GitHub account is ZivacHub (git user name shows Zivac). Repo is private; never make it public.
- "ClipForge" is the folder `Socials Automatisation`; the 11 folders without workflow files show as "not set up" on the dashboard.
- Ivan chose Python voice + Node dashboard (D6) although Python-only was recommended: the voice program feeds the dashboard through a local data feed.
- PC: i7-13650HX, 15.6 GB RAM, RTX 4060 Laptop with 8 GB graphics memory, about 34 GB disk free after Qwen3. Installs and model downloads need his yes and their size told first.
- Never post, spend money, delete/overwrite files or speak secrets on its own; anything that changes something needs a read-back and a spoken "yes".
- The AI_Orcestration Manager was last edited in the summer and is untested (step 3.5). The BUSNUS workshop handoff still has its own open step 1 (Game folder, Install.bat, old chats), set aside by Ivan, not dropped.

## Running / not committed
- Services running: Ollama server (idle)  ·  Not committed: this handoff (committed right after writing it)
