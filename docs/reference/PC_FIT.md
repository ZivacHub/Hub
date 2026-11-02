# PC fit (measured, never guessed)
Read when: deciding what loads when, or any memory problem. Machine: i7-13650HX, 15.6 GB RAM, RTX 4060 Laptop 8 GB graphics memory (0 MiB in use before tests), Windows 11.

## 0.2 Local models: pick the right command from 10 spoken sentences (2026-11-02)
Test: `python tests/model_pick_test.py qwen3:8b llama3.1:8b` (script `tests/model_pick_test.py`, raw numbers in `tests/model_pick_results.json`). Temperature 0, JSON answer, draft command list (the real one comes in step 2.2). Seconds exclude the first load.

| Model | Download | Right (of 10) | Average seconds per sentence | First load | Graphics memory in use (peak) |
|---|---|---|---|---|---|
| llama3.1:8b | 4.9 GB (already on the PC) | 10 | 0.75 | 5.3 s | about 5.4 GB |
| qwen3:8b | 5.2 GB (downloaded today) | 9 | 0.51 | 4.1 s | about 5.5 GB |

Misses: qwen3:8b heard "I want to build a dropshipping site with this and this." and picked `unsupported` instead of `dictate_idea`. Every other sentence, including both unsafe ones ("Delete the casino folder", "Post it on Instagram right now"), went to `unsupported` correctly with both models.

Reading it: both fit in 8 GB with about 2.5 GB left over, and answer in well under one second, so picking a command is not the slow part. Only 10 easy sentences: NOT enough to choose a winner. The real accuracy test is 40 sentences in step 2.3 (target 90 percent); the model is picked there. Open question for step 0.3: whether the cloned voice (Chatterbox) fits in the remaining 2.5 GB at the same time.

## 0.3 Voice parts, idle and working (measured 2026-11-02)
How: one process per part (`tests/measure_part.py`, `tests/measure_ollama_proc.py`, `tests/measure_combo.py`; raw lines in `tests/measure_results.jsonl`). Test audio only (a Windows-voice clip of "Hey Jarvis. How is ClipForge going, and are any decisions waiting on me?", about 6 s), no microphone. Graphics memory = card total in use minus 83 MiB already used by Windows before any test. Processor = percent of ONE core (100 = one core fully busy; the CPU has many cores). "Idle" = loaded and waiting; "working" = doing its job.

| Part | Graphics memory idle / working | RAM idle / working | Processor idle / working | Speed and notes |
|---|---|---|---|---|
| Wake phrase: openWakeWord "hey_jarvis" (runs on processor) | 0 / 0 | 184 MB / 184 MB | 4.0% / 53% (burst) | Loads in 0.1 s. Idle = listening to room noise in real time for 20 s. Download about 8 MB. It scored 1.00 on the Windows-voice "Hey Jarvis" clip (real wake test is step 1.1) |
| Hearing: faster-whisper `small.en` on graphics card | 0.66 GB / 0.74 GB | 580 / 903 MB | 0.8% / 73% | 0.15 s per 6 s clip, loads in 1.4 s, heard the sentence exactly (model 0.5 GB) |
| Hearing: faster-whisper `large-v3-turbo` on graphics card | 2.1 GB / 2.3 GB | 580 / 916 MB | 0.6% / 89% | 0.31 s per clip, loads in 3.6 s, heard it exactly (model 1.6 GB). Not needed for short commands |
| Hearing: `small.en` on the processor only (int8) | 0 / 0 | about 405 MB | n/a (about 1 s busy per clip) | 1.15 s per clip, heard it exactly. The fallback if the card is full |
| Light voice: Kokoro (bm_george, no cloning) | 0.43 GB / 0.92 GB | 1.7 / 2.0 GB | 1.3% / 40% | A 6 s sentence in about 0.12 s once warm (first call 1.7 to 3.8 s). First-ever load took 106 s because it downloaded model files |
| Cloned voice: Chatterbox (default voice for now) | 3.19 GB / 3.46 GB | 1.5 / 2.0 GB | 0.4% / 86% | 4 s of speech takes 3.2 to 4.0 s to make (about real time; the very first call 12.7 s); a short 2 s sentence took 1.5 s warm. Loads in 9 s from disk (first load 269 s: 3 GB download) |
| Brain: Qwen3 8B (Ollama) | 5.45 GB / 5.45 GB | 0.88 / 0.93 GB | 0.4% / 135% | 0.11 s per short request when warm (0.5 s with the longer command prompt of step 0.2), loads in 4.3 s |
| Brain: Llama 3.1 8B (Ollama) | 5.30 GB / 5.30 GB | 0.84 / 0.85 GB | 0.0% / 107% | 0.62 s per short request, loads in 7.2 s |

### What fits together (card total 8.19 GB, measured by really loading them)
- **Brain + hearing (`small.en`) + Kokoro:** 6.9 GB in use, everything stays 100% on the card. Hearing 0.6 s, Kokoro 1.7 s for a short sentence, brain 0.14 s. Fits with about 1.2 GB to spare.
- **Brain + Chatterbox:** 7.5 GB in use. It works, but Ollama moved 31% of the brain onto the processor (69% stays on the card). The brain still answered a short request in 0.17 s. Speech 1.5 s for a 2 s sentence. NOT measured: a long command prompt in this split state.
- **Brain + Chatterbox + hearing on the card:** does not fit (7.5 GB plus about 0.7 GB for hearing is about the whole 8.19 GB). Not loaded together on purpose. Fix: hearing on the processor (about 1.15 s per clip, measured), or load Chatterbox only while speaking.
- **Windows desktop alone already uses 0.08 to 0.17 GB of the card.** A game or Unity needs the card too; phase 5 measures that.

### Reading it in plain words
- The wake phrase is almost free (4% of one core, no graphics memory, 184 MB RAM). Always-on listening is realistic.
- Hearing and the brain are fast. The one slow part is the cloned voice: about 1.5 to 4 s before it finishes a sentence, against 0.1 s for Kokoro. Whether that feels too slow is for Ivan to hear in step 1.3.
- Install side effects: Chatterbox pinned older versions (numpy 1.26.4, transformers 5.2.0, PyTorch 2.6.0 with CUDA 12.4); all parts were re-run after that and still work. Kokoro also downloaded a small English language file (en_core_web_sm) by itself. Python workspace `.venv` is about 6 GB; model files sit in the user's Hugging Face cache.
- Disk after everything: see the line at the bottom of this section.
Disk free after all installs: 21.8 GB
