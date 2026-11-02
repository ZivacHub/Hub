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

## 2026-11-02: step 0.3 done (voice parts measured)
- Ivan said yes ("small parts first"). Created Hub/.venv (Python 3.11.9, git-ignored); installed openwakeword 0.6.0, faster-whisper 1.2.1, torch 2.6.0+cu124, kokoro, chatterbox-tts 0.1.7 (pins numpy 1.26.4, transformers 5.2.0). Disk free went from 40 GB to about 21 GB (venv ~6 GB, HF cache with whisper small.en + large-v3-turbo + Kokoro + Chatterbox, Qwen3 5.2 GB).
- faster-whisper needed cublas64_12.dll; fixed by importing torch first in the same process (no extra download).
- Results in docs/reference/PC_FIT.md. Fits: brain + hearing(small.en) + Kokoro = 6.9 GB of 8.19. Chatterbox + brain = 7.5 GB, brain 31% on processor. All three heavy on the card does not fit; hearing on processor takes 1.15 s per clip (measured). Chatterbox is the slow part (about 1.5 to 4 s per sentence); wake phrase costs 4% of one core idle.
- Scripts: tests/measure_part.py, measure_ollama_proc.py, measure_combo.py; spoken test clip and voice samples in tests/audio/ (git-ignored; kokoro_sample.wav, chatterbox_sample.wav for Ivan to hear later).
- Lesson: pip installs of cu124 PyTorch must use the pytorch index; default PyPI gives a processor-only build.

## 2026-11-02: Phase 0 closed
- Step 0.4: Ivan read the fit result in plain words and chose "Go to Phase 1, decide the layout after I hear the voices" (D10). Phase 0 ticked (4/4 steps, 43 total, 4 done).
- Open: memory layout (hearing on processor vs card) decided together with D4 in step 1.4.
