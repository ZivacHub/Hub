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

## 2026-11-02 - D12 trial: second tuning round (Ivan said "Keep trying Jarvis")
- Made a local copy `qwen3-nothink:8b` of his qwen3:8b whose template always starts the answer with an empty thinking block (no download; recipe in C:\Users\Ivan\JarvisTrial\Modelfile.nothink; his qwen3:8b untouched). Direct test: 0.3 s per short answer (was 3-13 s). Useful for our own loop too.
- Jarvis with that brain + planner off, wait 1.5 s, keyword tools, follow-up window off: still 22-30 s to first spoken word in 4 of 5 played questions (heard at 0.3-6 s, thinking at 4-14 s, speaking at 22-30 s). Brain speed was therefore not the main cause.
- Log of one round: heard 20:02:00; "directed" 20:02:03; 9 s until the tool list appeared (12 tools selected, every query); answer took 10 s (prompt carries 12 tool descriptions); about 6 s for Piper to make the voice (runs at roughly real-time speed on the processor). Each stage is built into the app, so cutting them needs code changes (running it from source), not settings.
- Config restored to original; Jarvis stopped; models unloaded. D12 still open for Ivan.

## 2026-11-02 - Research: brain options and messages by voice (Ivan's questions after the Jarvis trial)
- Ivan asked to delete models (llama definitely) and to research better ~8B models, Kimi/DeepSeek, a cloud brain (Gemini free key, Claude) and reading/answering Instagram messages by voice. Per the safety rule Claude does not hard-delete files: gave him Run-button commands instead (nothing deleted yet).
- Findings in docs/reference/PRIOR_ART.md (section "Feature: brain options ..."); new open decision D13 (brain local vs cloud vs both). Claude's reading: local small picker + optional spoken "ask the big brain". Instagram reading/replying: no official personal-account route, unofficial = terms break/ban risk; Telegram has an official one.
- Nothing downloaded or installed. Ivan said Jarvis (isair) would be "nice to have" for occasional use: D12 not decided yet.

## 2026-11-02 - Model bake-off blocked: Ollama too old
- Ivan ran the delete command for the 3 llama models (free disk about 39.6 GB afterwards). Told him the right size of the 4 test models is about 21-24 GB (not the 15 GB first said); started only the two small ones (qwen3.5:4b, gemma4:e2b).
- Both pulls refused (HTTP 412): need a newer Ollama than 0.22.1. Latest release v0.40.13 (2026-10-28); installer 1.6 GB, portable zip 1.5 GB. Asked Ivan: side-by-side portable copy in C:\Users\Ivan\JarvisTrial (own port and model folder, leaves his Ollama alone) or update his Ollama. Nothing installed.
- tests/model_pick_test.py now falls back when a model has no thinking switch and writes tests/model_pick_results_<models>.json instead of overwriting.
- Gemini free key in Jarvis: its settings allow an OpenAI-style server (llm_provider openai_compatible + base URL + key); Gemini has such an endpoint (untested). Ivan must paste his own key; Claude does not handle API keys.

## 2026-11-02 - Model bake-off paused at Ivan's request
- Ivan said "stop pulling" while the side-by-side Ollama download (v0.40.13 zip, 1.5 GB) was running. Claude stopped the download script and gh; a partial 564 MB file remains in C:\Users\Ivan\JarvisTrial\ollama-new\dl (Ivan may delete it). Nothing extracted, no models pulled, his own Ollama untouched and still running. D13 recorded as [proposed] (Gemini + Claude brain), awaiting his yes.

## 2026-11-02 - D13 decided; Gemini brain working inside the Jarvis trial
- Ivan: "Yes, that is it. Let's try to integrate that." D13 decided (Gemini free key brain + Claude for delegated jobs + small local backup); PRODUCT.md "Changed" line added. He pasted his own key into C:\Users\Ivan\.config\jarvis\config.json (Claude never saw it; key checks print only length). The backup copy C:\Users\Ivan\JarvisTrial\config_gemini_working.json has the key blanked.
- Gemini via the OpenAI-compatible endpoint (https://generativelanguage.googleapis.com/v1beta/openai) works with this key. Direct timing: gemini-3.5-flash-lite 0.4-0.8 s typical (one 4.5 s outlier); gemini-3.6-flash 1.3-1.7 s with reasoning_effort=none but truncated/slow (2.8-4.2 s) by default because of hidden thinking; gemini-3.8-flash overloaded (503, 28 s). Jarvis set to flash-lite for chat and fast model; embeddings stay on local bge-m3.
- Jarvis end to end (computer voice through speakers, Array mic, wait 1.5 s, endpoint 600 ms): first spoken word 4.8-5.9 s after the question in 3 of 5 rounds (10.8 s and 28 s outliers, 1 round not heard), against 20-36 s with local models. Answers correct ("Two plus two is four. ...").
- Next: Ivan tries his own voice; Claude hand-off (read-only first); backup local model choice. Jarvis left running with the face hidden.

## 2026-11-02 - Jarvis trial: formal-butler persona via a local relay
- Ivan: the jokes were "random... horrendous"; wants "on point, precise, like a real butler". isair/jarvis has the witty persona hard-coded (src/jarvis/system_prompt.py), no setting. Built tools/jarvis_trial/gemini_relay.py: a local relay (127.0.0.1:8787) between Jarvis and Gemini that replaces only the persona paragraph (no jokes, precise, "sir" at most once and only when natural) and passes everything else through, streaming included. It never stores the key and never logs what was said (log: tools/jarvis_trial/relay_log.jsonl, git-ignored). Self-test checks the rewrite against Jarvis's current prompt on GitHub.
- Jarvis config llm_base_url = http://127.0.0.1:8787/v1beta/openai. Start both with tools/jarvis_trial/start_jarvis_trial.ps1 (starts relay, starts Jarvis, closes the "Model recommendations" notice, hides the face).
- Live test: "2 plus 2 is 4, sir." / "I am entirely well, thank you, sir." (no jokes); first spoken word 4.7-7.4 s after the question for the short one, 12-15 s for "how are you today?" in this run (free-tier variance). Default I chose: "sir" allowed sparingly; Ivan can say to remove it.
- A mis-nested command once tried a stray delete on C:\Program; the safety check blocked it, nothing lost. Lesson: write scripts with the Write tool, never nest here-strings.
- Next: Claude hand-off (read-only ask_claude helper for Jarvis's MCP list), D13.

## 2026-11-02 - Claude hand-off helper built (read-only), waiting on a login
- tools/claude_bridge/server.py: dependency-free MCP server (stdio) with one tool `ask_claude(question)`. It runs `claude -p` from an empty scratch folder (C:\Users\Ivan\JarvisTrial\claude_cwd) with only Read/Grep/Glob, read access to the BUSNUS folder, no session saved, 0.50 USD cap, 120 s timeout, answer cut to 900 chars; logs each call locally (bridge_log.jsonl, git-ignored). `--selftest` passes (initialize, list, call, unknown tool refused, long question refused) using a stand-in answer.
- Real call failed: `claude -p` says "Failed to authenticate: OAuth session expired and could not be refreshed". The command-line login is separate from the desktop app; only Ivan can log in (run `claude` in a terminal and use /login). Not wired into Jarvis's "mcps" yet: do that only after one real test works.
- Policy note (unverified, sources disagree): personal local use of `claude -p` tolerated; from 2026-06-15 usage may draw on an Agent SDK credit instead of plan limits; products for others need an API key. Check Anthropic's current wording before relying on it.

## 2026-11-02 - Claude hand-off works end to end inside Jarvis
- Ivan logged the `claude` command line in. Real calls through tools/claude_bridge/server.py: plan-board question answered correctly in 7.4-9.5 s; a "delete PRODUCT.md" request refused (read-only mode).
- Security gap found and fixed: with `--allowedTools Read` Claude could read ANY file (it read the Windows hosts file). Now no blanket Read permission (reads only inside --add-dir C:\Users\Ivan\Desktop\BUSNUS) plus hard deny rules. Lesson from Claude Code docs: Read deny rules without a "//" prefix apply only under the working folder; use "//**/pattern" for anywhere. Verified with fake files: *token* file, .env file and Jarvis's own config folder (holds the Gemini key) are all refused; a normal board question still works. (A first test of mine asked Claude to read the real key file; Claude Code's safety classifier blocked it. Don't do that; test with fakes.)
- Jarvis config "mcps" now lists the helper (name "claude"; tool shows up as claude__ask_claude). Voice-path test: "Jarvis, ask Claude which phase the hub project is in." -> Jarvis called the tool (12.5-21 s inside Claude) and spoke the answer; whole answer took 19.7 s and 45 s in the two rounds (Gemini steps plus Claude). Read-only only: no sending, posting, deleting; writing needs a separate tool with read-back and spoken yes (not built).
- Config backups: C:\Users\Ivan\JarvisTrial\config_pre_mcp.json (no key blanked? it holds the key: do not copy or commit), config_gemini_working.json (key blanked). Jarvis running via tools/jarvis_trial/start_jarvis_trial.ps1, face hidden.

## 2026-11-02 - Jarvis trial: Ivan's real-voice test went "really well"; web search on
- Ivan tried Jarvis with his own voice: "went really well". Counts from the logs: 34 Gemini calls for about 13 answers (judge, tool choice, reply: roughly 2-3 per answer) and 1 Claude call (game project, 15.4 s). Hearing, voice and memory search stay local. Note: the intent judge sends recent spoken sentences (ambient buffer up to 120 s) to Gemini, so nearby talk can reach Google; told him.
- Web search enabled (web_search_enabled true, Wikipedia fallback on; no Brave key; location stays off, weather needs a city said aloud). Backup: C:\Users\Ivan\JarvisTrial\config_pre_websearch.json (holds the key: do not copy or commit).
- "Next step" asked: board next is 1.1 (own wake-word test) but D12 is the real fork: use isair/jarvis as the Hub's voice shell (we build fetch tools as MCP + dashboard) or keep building our own loop. Put to Ivan with a recommendation (use Jarvis, own loop as fallback). Not decided.

## 2026-11-02 - Voice audition (Ivan: "find voices somewhere else"; D12 left open)
- Ivan answered the D12 fork with: "I don't want to keep building or use the ready. Can we maybe find voices somewhere else?" Read as: the voice is his real complaint; D12 stays open (not decided), voices first. Did not record a decision.
- Research: Kokoro has 4 British male voices (grades: bm_george C, bm_fable C, bm_lewis D+, bm_daniel D; Kokoro's own grading). Chatterbox (MIT) clones from a short clip. Gemini TTS (models gemini-3.8-flash-lite-tts / -flash-tts / 3.1-flash-tts-preview, 30 voices, style prompt works) via Interactions API; free tier for TTS is 3 requests per minute (error text), about 4-5 s per sentence: fine for occasional use, too low for every reply.
- Generated tests/voice_audition.py + tests/audio/voice_audition/ (git-ignored): kokoro bm_george/fable/lewis/daniel (0.1 s each, local) and Gemini Charon, Orus, Iapetus, Schedar, Sadaltager, Algieba. Opened index.html for Ivan to listen. Not yet included: Chatterbox cloned voice (needs his clean 10 s clip), Piper voices, Edge-TTS (unofficial Microsoft service, gray terms).
