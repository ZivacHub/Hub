# Handoff: Hub   (updated 2026-11-02)
Git: main @ 28ff14a "Hub: Phase 0 gate passed, step 0.1 done (tools already installed), repo decision D9" · pushed: yes (private https://github.com/ZivacHub/Hub) · uncommitted: this handoff

## Where we are in the plan
Phase 0 of 9 (Phase 0 to 8) — Check the PC. Steps done 1/43 (0.1 done). Next per plan: 0.2 Try the two local models on sample commands.
(Copied from docs/plan/BOARD.md. Plan APPROVED 2026-11-02; Phase 0 gate passed the same day, Ivan: "Go, start Phase 0".)

## What we're building
A Jarvis voice assistant that starts with Windows on Ivan's PC and a clean dashboard of all BUSNUS projects. It does not know answers, it only fetches them (plan boards, decisions, handoffs, chat history, the AI_Orcestration Manager). Ivan's words: docs/PRODUCT.md.

## Last session
- Did: ran the Phase 0 gate (preview, search note, no decisions); Ivan said go and named the repo "Hub" (D9); created the PRIVATE repo and pushed (secrets re-scan clean); step 0.1 ticked: Python 3.11.9, Node v24.13.1, Ollama 0.22.1 were already installed, nothing downloaded.
- Left unfinished: nothing half-done. Step 0.2 not started; Ivan has not yet said yes to the model downloads.

## Next steps (strictly in order; step 1 is where the next session starts)
1. Step 0.2 Try the two local models on 10 sample sentences. First tell Ivan the download sizes (Qwen3 8B and Llama 3.1 8B, roughly 5 GB each, exact size shown by Ollama; disk 40 GB free) and get his yes; start Ollama yourself; grade the step on the spot (delegate skill). Done when: a results table (sentence, model, command picked, seconds) plus speed and graphics memory per model exists. Save it as a section in docs/reference/PC_FIT.md (create the file; add its row state to docs/INDEX.md is already there).
   Read first: docs/plan/phases/00-check-the-pc.md, docs/DECISIONS.md
2. Step 0.3 Measure each voice part (idle and active): openWakeWord, faster-whisper, Chatterbox, Kokoro, local model; numbers into docs/reference/PC_FIT.md. Make a Python 3.11 virtual environment inside Hub (announce it); pip downloads need Ivan's yes with sizes.
3. Step 0.4 Show Ivan the fit result in plain words and get his go (new decision if tight).

## Waiting on the owner
- Yes to the model downloads for step 0.2 (asked at the end of the last chat; no answer yet).
- D4 Jarvis voice — film actor clone (private use only) vs licence-free butler sample vs try both; he hears them in step 1.3 and decides in 1.4.
- PRIOR_ART pending ideas (no rush): sniffly's chat-log reading idea and "needs you" alerts, both for phase 6.

## Gotchas a fresh session would get wrong (max 8, only things still true)
- Use `python` (3.11.9) or `py -3.11`; bare `py` opens 3.14.0, too new for voice libraries. Ollama is installed but not running until started. ffmpeg is not installed (add only if a part needs it, with Ivan's yes).
- GitHub account is ZivacHub (git user name shows Zivac). Repo is private; never make it public.
- "ClipForge" is the folder `Socials Automatisation`; the 11 folders without workflow files show as "not set up" on the dashboard.
- Ivan chose Python voice + Node dashboard (D6) although Python-only was recommended: the voice program feeds the dashboard through a local data feed.
- PC: i7-13650HX, 15.6 GB RAM, RTX 4060 Laptop with 8 GB graphics memory, 40 GB disk free. Installs and model downloads need his yes and their size told first.
- He wants it always on from Windows start (phase 5 keeps idle cost small and measures it) and a casual, a-bit-vulgar tone (phase 8, with a setting).
- Never post, spend money, delete/overwrite files or speak secrets on its own; anything that changes something needs a read-back and a spoken "yes".
- The AI_Orcestration Manager (ai_company/execution/manager_query.py) was last edited in the summer and is untested; step 3.5 checks it. The BUSNUS workshop handoff still has its own open step 1 (Game folder, Install.bat, old chats), set aside by Ivan, not dropped.

## Running / not committed
- Services running: none  ·  Not committed: this handoff (committed right after writing it)
