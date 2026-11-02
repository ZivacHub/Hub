# Phase 0 — Check the PC
Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file holds the detail. A pickup reads only the CURRENT phase's file.

## Purpose in plain words
Find out, before building anything, whether your laptop (8 GB graphics memory, 15.6 GB RAM, 41 GB free disk) can run the wake phrase, the hearing, the local model and the cloned voice, and how much each one costs while idle and while working. At the end you see a one-page result: "this fits" or "this is tight, here is the fix".

## Read first (when working on this phase)
- docs/reference/PRIOR_ART.md (the four parts adopted for testing, D7)
- docs/DECISIONS.md (D2, D3, D7)

## Steps
**0.1 Install the basics (with Ivan's yes)** — Grade: standard (clear list, but changes the PC so Ivan approves each install). Use: winget/pip, context7 for current install steps. Done when: Python, Node and Ollama each print a version in a new terminal; sizes were told to Ivan before downloading. Test: run the three version commands and show the output. Decisions needed: none (D6 already says Python voice + Node dashboard).
**0.2 Try the two local models on sample commands** — Grade: standard (fixed test, easy to check). Use: Ollama, context7. Done when: Qwen3 8B and Llama 3.1 8B each answered the same 10 sample sentences ("how is ClipForge going?", "pull out the dashboard"...) with a command name, and their speed and graphics memory were noted. Test: a results table (sentence, model, command picked, seconds). Decisions needed: none.
**0.3 Measure each voice part (idle and active)** — Grade: standard (measurement script, clear output). Use: nvidia-smi, Task Manager numbers via a script. Done when: for openWakeWord, faster-whisper, Chatterbox, Kokoro and the local model there is a number for graphics memory, RAM and processor, idle and working, saved in docs/reference/PC_FIT.md. Test: the file exists with all 5 rows filled and the numbers were measured, not guessed. Decisions needed: none.
**0.4 Show Ivan the fit result and get his go** — Grade: strong (needs Ivan's decision on what to do if something is tight). Use: choice card. Done when: Ivan has read PC_FIT.md in plain words and said go, or chose a fix (smaller model, voice loaded only when speaking). Test: his words are in DECISIONS.md. Decisions needed: a new one if the result is tight.

## Risks and open points (only for this phase)
- Chatterbox may not fit next to the local model in 8 GB at the same time; the fix is to load them one after another (adds about a second of wait) or to use Kokoro.
- Disk: models take about 10-15 GB of the 41 GB free; the sizes are announced before download.

## Phase gate record
- Plain-words preview shown: 2026-11-02. Skills/repos search: done for the whole project 2026-11-02 (docs/reference/PRIOR_ART.md; no skills worth installing). Decisions asked: none. The owner's go: 2026-11-02 ("Go, start Phase 0"). Repo name asked in the same card: D9.
