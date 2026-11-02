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

## 2026-11-02: Phase 1 gate, microphone, step 1.1 first results, research on ready-made Jarvis
- Phase 1 gate: Ivan "Yes, start Phase 1"; D11: laptop built-in Microphone Array (sounddevice device 2), voice sample = his film clip + a licence-free butler clip + Kokoro (D4 still open). Installed sounddevice (under 1 MB).
- Microphone check (tests/mic_check.py): working, "hey_jarvis" 0.99, hearing wrote the sentence exactly; peak reached 82% of maximum, so he must not lean closer. Two earlier checks were silent because he was not ready (lesson: announce the timing in a message BEFORE the recording starts, use warning beeps).
- 1.1 wake test (tests/wake_test.py, results tests/wake_results.jsonl and the .log files): first run crashed on a JSON number bug before saving (fixed), second run 16/20 woke at threshold 0.5 (scores of misses: 0.01, 0.49, 0.11, 0.39). First run's tries 12-20 had 7 woke / 2 missed. 20-minute noise test with a video (Opera on Instagram): 0 events at 0.5, events logged 0.25 to 0.37, loudest moment 0.48 (hidden by the 3 s debounce, so false wakes at threshold 0.4 or lower are at least 1). A threshold of about 0.39 would give 18/20 and about 1 false wake, exactly at the target edge: weak evidence (one run each). NOT ticked.
- Closed Opera GX for Ivan after the noise test (he asked while going to sleep): normal close, no prompt, 0 processes left.
- Research (Ivan's question): added a section to docs/reference/PRIOR_ART.md on OpenJarvis (Apache-2.0, 12.9k stars), isair/jarvis (2.2k, licence not named), PanPenek/JarvisAi (MIT, 21 stars, same parts as ours). Opened D12 (try isair/jarvis as shell for about one hour, or keep our own loop). Corrected my earlier claim that no Jarvis project fits: the first three were paid/Mac, these three are free/local; none knows BUSNUS files.

## 2026-11-02 - D12 trial of isair/jarvis: installed and configured (not yet judged)
- What: Ivan said "Yes, try it first" / "Yes, install it". The Windows download is an Inno installer (223 MB, unsigned, licence = free for non-commercial use). Two copies exist: mine in C:\Users\Ivan\JarvisTrial\installed (893 MB, duplicate, delete later) and Ivan's default install in C:\Program Files\Jarvis (with the GPU add-on, about 1.7 GB of CUDA files; disk now about 18 GB free). Nothing was added to Windows startup.
- Config written by Claude to C:\Users\Ivan\.config\jarvis\config.json: qwen3:8b brain and fast model, bge-m3:567m embeddings (his existing model), whisper small.en on the graphics card (float16), Piper voice en_GB-alan-medium (63 MB, auto-downloaded), location, web search and dictation off. Wizard showed because the default fast model was missing; setting fast_model removed it.
- Measured: running, brain 6.0 GB on the graphics card (100% GPU), whole card 6.3 GB, Jarvis process about 620 MB RAM. Its wake word is the spoken word "jarvis" found in the speech-to-text output (not a separate wake model).
- Not verified: whether it heard a played test sentence (no log window readable; database stayed empty). A real test needs Ivan's voice and the tray Logs window.
- Lessons: Ivan's earlier error was "unexpected response, $0" at first launch; did not reproduce. Screenshot of the full screen can catch his private windows: capture only the app window (PrintWindow). Stopped Jarvis and unloaded qwen3 afterwards.

## 2026-11-02 - D12 trial: first live test with Ivan's voice (his pasted Jarvis log, 18:57-19:01)
- Hearing: whisper small.en on the card, 0.3-0.44 s per utterance, wrote "Jarvis, what is 2 plus 2?" exactly twice; a bare "Jarvis" was dropped (confidence 0.03). Sentences without "Jarvis" were correctly ignored. Its wake word is the word "jarvis" in the transcript, so it transcribes every sound (no separate wake model).
- Slow: about 26 s, 20 s and 22 s from end of speech to first spoken word. Steps: intent judge about 5 s, wait for more speech 4.6 s (voice_collect_seconds 4.5), tool picking about 5 s, answer about 7 s, Piper voice about 4 s; all on one qwen3:8b so the calls queue up.
- Wrong/odd: "2+2" answered "5. A most elegant..." (wrong), then "4." (right), then ignored the question. Persona prompt (British butler) adds jokes; 8B model not reliable on facts, which supports our design (model only picks commands, code builds answers).
- Not tested: MCP custom fetch tool, tuning of speed settings, voice cloning (Piper Alan only). Jarvis left running at the time of writing; stop it to free 6 GB of the card.

## 2026-11-02 - D12 trial: hands-free speed tuning (Ivan away); face hidden
- Face: no setting for it in isair/jarvis (opens at every launch, window only). Claude hid the window by script after each start; it will reappear on a normal launch.
- Method: computer-voice question ("Jarvis, what is two plus two?") played through the speakers, state read from %TEMP%/jarvis_state, log window read by capturing only that window. Stereo Mix as input does not work with Jarvis (WDM-KS needs a format it cannot open); the Array mic hears the speakers (and Jarvis's own voice, which polluted rounds). Only 5 of 10 played questions were heard at the current speaker volume.
- Tuned settings (planner off, wait 1.5 s, keyword tool choice, endpoint 600 ms) with qwen3:8b: 26 s to first spoken word (heard at 0.9 s, thinking at 8.6 s, speaking at 26 s).
- Found: qwen3:8b writes about 225 hidden thinking tokens per answer unless told not to (direct test: 12.9 s vs 3.1 s with think=false). Jarvis did not stop it. llama3.1:8b has no thinking, but with Jarvis's tool picking it called logMeal / toolSearchTool on a plain question and looped through 2-3 agent turns (about 7-11 s each): 20-36 s to speaking.
- Reading: Jarvis runs several sequential model calls per sentence (intent judge, tool router, planner, agent loop of up to 8 turns, then Piper voice about real-time speed on the processor). Settings alone did not get it under about 20 s on this card. Config was restored to the original; tuned copies are in C:\Users\Ivan\JarvisTrial\config_*.json. Jarvis stopped, models unloaded.
- Files: tests/jarvis_latency.py (+ jarvis_latency.jsonl). Not tested: MCP fetch tool, voice cloning. D12 still open: Ivan decides.
