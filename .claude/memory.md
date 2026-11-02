# Project memory
Append newest entries at the bottom. Format: `YYYY-MM-DD: what changed / why / paths`.

## 2026-11-02: planning done, waiting for approval
- Ivan started the Hub idea on 2026-11-01 (hub for all projects + Jarvis voice + his AI_Orcestration Manager as the "fetcher"). Five-round interview done; docs/PRODUCT.md CONFIRMED 2026-11-02 with five assumptions standing.
- Decisions in his words (docs/DECISIONS.md): D1 new project Hub; D2 local model only; D3 free cloned voice (D4 which voice still open); D5 small program we write (Pipecat rejected); D6 Python voice + Node dashboard; D7 four free parts tested (openWakeWord, faster-whisper, Chatterbox, Kokoro); D8 six defaults accepted.
- Research: docs/reference/PRIOR_ART.md (gh search 2026-11-02). Skills search found nothing to install; design skills already global.
- Plan: docs/plan/BOARD.md DRAFT, 9 phases, 43 steps, grades 3 light / 26 standard / 14 strong, phase files 00-08, docs/reference/TASKS.md, docs/INDEX.md.
- Verified: nothing installed or built; files are docs only. PC specs read with PowerShell/nvidia-smi (8 GB graphics memory, 15.6 GB RAM, 41 GB disk free).
- Lesson: Ivan chose the non-recommended Python+Node split (D6); the cost was told to him.

## 2026-11-02: Phase 0 gate passed, step 0.1 done, private repo
- Ivan said go on Phase 0 and named the repo "Hub" (D9). Created private https://github.com/ZivacHub/Hub, pushed main (25 files, secrets re-scan clean first).
- Step 0.1: nothing to install. Verified by commands: Python 3.11.9 (`py` default is 3.14.0), Node v24.13.1, Ollama 0.22.1 (service not running), nvidia-smi sees RTX 4060 8188 MiB with 0 used, C: free 40.1 GB, ffmpeg missing (only needed if a part asks for it).
- Lesson: check what is installed before announcing downloads; use `python`/`py -3.11`, not bare `py`.

## 2026-11-02: step 0.2 done (local models tried)
- Ivan said yes to the downloads. llama3.1:8b was already installed (4.9 GB); pulled qwen3:8b (5.2 GB). Started Ollama server (left running, idle).
- tests/model_pick_test.py + tests/model_pick_results.json; results table in docs/reference/PC_FIT.md. Llama 10/10 (0.75 s), Qwen3 9/10 (0.51 s, missed the dictate-idea sentence). Both about 5.5 GB graphics memory. Not a winner yet: 40-sentence test in 2.3.
- Other models already on disk (not ours, untouched): lexi/uncensored llama variants, wizardlm 13b, gpt-oss cloud, embedding models.
