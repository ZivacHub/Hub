# Prior art (2026-11-02)
Read when: choosing the voice, wake-phrase, speech-recognition or dashboard parts of the Hub, or before adopting any outside code.
Search phrases: openwakeword; faster-whisper; pipecat; chatterbox tts; wyoming piper; kokoro tts; claude code monitor / dashboard; local voice assistant ollama whisper; plus the three Jarvis repos and cloning-voice tools found earlier in the chat. Facts (stars, dates, licences) are from GitHub on 2026-11-02; anything marked "(unverified)" is from memory or a blog post.

| Repo | Stars | Updated | Licence | What it is |
|---|---|---|---|---|
| dscripka/openWakeWord | 2.9k | 2026-11-01 | Apache-2.0 | "Hey ..." wake-phrase detector that runs on the processor |
| SYSTRAN/faster-whisper | 26k | 2026-11-01 | MIT | Fast speech-to-text, runs locally on the graphics card |
| devnen/Chatterbox-TTS-Server | 1.5k | 2026-11-01 | MIT | Windows-ready local server for the Chatterbox cloning voice, with a web page and an API |
| resemble-ai/chatterbox | n/a | n/a | MIT | The cloning voice model itself (about 10 s sample) |
| nazdridoy/kokoro-tts | 2.0k | 2026-11-01 | MIT | Small, fast, good-sounding local voice (no cloning) |
| pipecat-ai/pipecat | 17k | 2026-11-01 | BSD-2 | Framework for voice agents (listen, think, speak pipelines) |
| chiphuyen/sniffly | 1.3k | 2026-10-19 | MIT | Local dashboard that reads Claude Code chat logs |
| onikan27/claude-code-monitor | 314 | 2026-10-22 | MIT | Live dashboard of Claude Code sessions (Mac only) |
| Julian-Ivanov/jarvis-voice-assistant | small | n/a | MIT | Windows Jarvis, needs Anthropic key + ElevenLabs |
| vsomayaji2004/jarvis-cli | 3 | n/a | MIT | Uses `claude` command, Fish Audio paid, Mac/Linux |
| ethanplusai/jarvis | n/a | n/a | personal use only | Mac only; session dashboard + orb |
| s260o/VoiceAssistant | small | n/a | n/a | Windows, faster-whisper + Ollama, launches apps, no wake word |

## dscripka/openWakeWord
- Does well: small, free, runs on the processor so the graphics card stays free. Has ready-made wake phrases (I believe including "hey jarvis", unverified) so no training is needed.
- Reuse (code): as a library, Apache-2.0 (free to use with credit).
- Our edge: ours only listens for one phrase and then wakes the rest.

## SYSTRAN/faster-whisper
- Does well: accurate English speech-to-text, small model sizes (about 1 GB graphics memory for the "small" size, unverified).
- Reuse: as a library, MIT.

## devnen/Chatterbox-TTS-Server + resemble-ai/chatterbox
- Does well: Windows 10/11 supported, "portable mode" bundles Python, graphics card (NVIDIA) or processor, web page for trying voices, accepts a .wav/.mp3 voice sample, has an API (`/tts`, plus an OpenAI-style `/v1/audio/speech`).
- Reuse: run as a separate local service the Hub calls. MIT. Memory need on 8 GB card: not stated, to be tested.
- Edge: we keep the voice sample as a file the user can swap (D4).

## Kokoro (nazdridoy/kokoro-tts)
- Does well: very small and fast, clear voices, runs even on the processor. One 2026 article suggests it as the safer choice because Piper was archived in Oct 2025 (unverified).
- Limit: it does not clone a voice; it has fixed voices. Good fallback if cloning is too heavy.

## pipecat-ai/pipecat
- Does well: a ready "listen, think, speak" pipeline with interruption handling.
- Borrow (idea): the pipeline stages. Reuse is possible (BSD-2) but it is a big framework; for a small command-picker it may be more than needed. Decision in the plan.

## Claude chat dashboards (sniffly, claude-code-monitor, Stargx/claude-code-dashboard)
- sniffly: shows how to read Claude Code's saved chat logs locally with no data leaving the PC. Borrow the idea of reading the log files; Windows support not confirmed.
- claude-code-monitor: Mac only (uses AppleScript), watches chats through hooks. Borrow the idea of "needs you" alerts.
- Our edge: ours also reads each project's plan, decisions and handoff, and speaks.

## The Jarvis repos (seen earlier)
- None combines Windows + no API key + free voice + a dashboard. The closest are Julian-Ivanov (Windows but needs paid keys) and ethanplusai (best features, Mac only, personal use only).
- Borrow (idea): ethanplusai's "announce when a chat needs you" and the dashboard tabs (Runs, Sessions, Memory, Specs, Projects, Usage); do NOT copy code (personal-use licence; Mac-only anyway).

## Search result, in one line
No ready-made project does all of this. The parts (wake phrase, speech-to-text, cloning voice, local model, dashboard) all exist, are free and are Windows-ready, so the Hub is mainly the glue plus the "how to fetch" command list.

## Recommendations
- [x] adopted for testing 2026-11-02 (D7): use openWakeWord for "Hey Jarvis" (Apache-2.0) → voice phase
- [x] adopted for testing 2026-11-02 (D7): use faster-whisper for speech-to-text (MIT) → voice phase
- [x] adopted for testing 2026-11-02 (D7): run Chatterbox-TTS-Server as the cloning voice, with Kokoro as the light fallback (MIT) → voice-test step
- [ ] pending: borrow sniffly's idea of reading Claude Code chat logs locally → dashboard "latest answers" step
- [ ] pending: borrow "announce when a chat needs you" from claude-code-monitor / ethanplusai → later phase
- [-] rejected 2026-11-02 (D5): Pipecat; Ivan chose the small program we write

## Don't copy
- ethanplusai/jarvis code: licence limits it to personal, non-commercial use and it only works on Mac.
- Anything needing an Anthropic API key, ElevenLabs or Fish Audio, because of the free-and-unlimited rule.


## Feature: ready-made Jarvis shells that run locally on Windows (2026-11-02, asked by Ivan: "what about openjarvis, jarvis-ai?")
Read from the GitHub pages themselves (WebFetch). Anything the page did not say is marked "not stated"; dates of last commits were not shown.

| Repo | Stars | Licence | What it is | Voice parts | Windows | Key/paid? | Can it fetch from BUSNUS files? |
|---|---|---|---|---|---|---|---|
| open-jarvis/OpenJarvis (Stanford labs) | 12.9k | Apache-2.0 | Framework for personal agents on your own device; Ollama; skills/tools; `jarvis gui` chat page; scheduled digests | Text-to-speech in the "morning digest"; wake word, hearing, cloning: not stated | Native installer + scheduled-task service | not stated for local use | Yes in principle: skills are tools it can call. Bigger than needed |
| isair/jarvis | 2.2k | not named on the page ("free for personal use, commercial: contact author") | Desktop assistant: voice + text, memory (diary, knowledge graph), dictation, MCP tools | faster-whisper; Piper, and Chatterbox on source installs; addressed by name anywhere in a sentence (no literal wake file); cloning not stated | Windows zip, but "development primarily on macOS" | No key; optional Brave search key | Yes: supports MCP, so a small BUSNUS "fetch" tool could be plugged in |
| PanPenek/JarvisAi | 21 | MIT | Voice assistant with Iron-Man-style web page, 31 tools (screen reading, clicking, typing, volume, lock screen, power, run Python) | openWakeWord "Hey Jarvis", faster-whisper, Kokoro: the SAME parts we tested; cloning not stated | `install.bat` + `start.bat` | Local by default | Adding tools: not stated. Only 3 commits; its desktop-control tools break our rule "nothing changes anything without a spoken yes" unless removed |

Reading: the first three Jarvis repos from the earlier search (Julian-Ivanov, vsomayaji2004, ethanplusai) are paid/Mac-only. These three are different: free and local. None of them knows the BUSNUS plan boards, decisions, handoffs or chat files, and none states a cloned Jarvis voice. PanPenek's repo uses the exact stack we measured (openWakeWord, faster-whisper, Kokoro, Qwen3 8B), which supports D7. isair/jarvis is the one most worth a time-boxed trial as a shell (MCP lets us add our own fetch tool).
- [ ] pending (Ivan decides, D12): try isair/jarvis in a separate folder for about an hour, to see whether it can replace our own voice loop (Phase 1.5, 2.x) while we still write the BUSNUS fetch tools and the dashboard.
- [ ] pending: borrow ideas only from PanPenek/JarvisAi (web page style, tool registry) and OpenJarvis (skills as tools, scheduled digest); no code copied.

## Feature: brain options and "read my messages by voice" (2026-11-02)
Searched: best local models for an 8 GB card, Ollama pages for Qwen3.5, Gemma 4, DeepSeek-R1, Kimi, Ollama cloud pricing, Gemini free-tier terms, Claude Code headless policy, Instagram DM automation. Blog benchmarks are self-reported; sizes come from ollama.com.
| Option | Size / cost | Notes |
|---|---|---|
| qwen3.5:4b | 3.3-4.0 GB | newest Qwen family, tools + thinking, 256K context; fits beside hearing and voice. Untested here. |
| qwen3.5:9b | 6.6-7.6 GB | strongest that "fits"; leaves almost nothing on an 8 GB card, would spill to the processor. Untested here. |
| gemma4:e2b / e4b | 4.6 / 6.6 GB | native tools, audio input; e4b is big. Untested here. |
| deepseek-r1:8b | 5.2 GB | a "thinks a lot" model, slow for voice. MIT licence. Not recommended for the picker. |
| Kimi (k2.6, k3, k2.7-code) | cloud only on Ollama | too big to run locally; the only small Kimi found (Kimi-VL-A3B, 16B total) is a vision model, not on Ollama. |
| Ollama cloud (Kimi k3, DeepSeek v4, gpt-oss 120b) | "free" plan = pay per token, no included credits; Pro $20/mo | same interface as local models; page says prompts are never logged or trained on. Ivan already has gpt-oss:120b-cloud listed. |
| Gemini API free tier | free of charge (Ivan confirmed his key is free) | Google's own pricing page (aistudio.google.com/docs/pricing) lists free models (e.g. Gemini 3.8 Flash, 3.6 Flash, Flash-Lite, Gemma 4) and marks them "Used to improve our products: Yes"; paid tier "not used". Google's terms (aistudio.google.com/docs/terms): human reviewers may read inputs and outputs, and "Do not submit sensitive, confidential, or personal information to the Unpaid Services." No fixed limits shown ("generous"). Everything said goes to Google. |
| Claude via `claude -p` (his subscription) | covered by plan / Agent SDK credit from 2026-06-15 per Anthropic support text | personal local use tolerated; products for others must use an API key; sources disagree, verify the current wording. Several seconds per answer (unmeasured). |
- [ ] pending: test Qwen3.5 4B/9B and Gemma 4 E2B/E4B against qwen3:8b on this card (D13)
- [ ] pending: optional spoken "ask the big brain" cloud command (D13)
- [ ] pending: read and answer chat messages by voice. Instagram: no official way for a personal account (the official API is for business/creator accounts); unofficial tools break Instagram's terms and can get the account restricted or banned (vendor blogs, Meta's own text not found); would also need his login stored on the PC. Telegram has an official way for personal accounts. Voice side (read back, "tell her this", read-back and spoken "yes" before sending) fits our existing safety rule.
- [ ] pending (2026-11-03, Ivan's wish): overview of emails by voice. Official routes exist for email: Gmail API / Google Workspace connector (Jarvis can load a "google_workspace" MCP helper from its docs; Claude's desktop app has its own Gmail connector). Cost to know: email text read through Gemini's free tier is seen by Google; a read-only helper could send only sender and subject. Would be a new phase after 4 (needs Ivan's OK to add).
- [ ] pending (2026-11-03, Ivan's wish): "boot up a project, ask what is going on, answer, Claude continues". Needs phase 4 (answer saved to the project's decisions with read-back and spoken yes) plus phase 7 (start Claude work with that answer: open the project's chat, or `claude -p` in that folder with write rights only after a spoken yes). Policy on `claude -p` with his subscription still unverified.
