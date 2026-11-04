# Decisions

Rule: a decision is **decided** only when the owner said it. Anything Claude suggested is **proposed** until the owner answers.
A vague answer ("depends", "whatever") is not a decision: write Claude's reading as `[proposed]` and ask the owner to confirm.
Never delete: replace with `[superseded by D<n>]`. Status line format (read by a script): `## D<n> — <title>   [decided <date>]` or `[open]` / `[proposed]` / `[superseded by D<n>]`.
Layout: the two sections below. When a decision is answered, move its block from "Waiting on the owner" to the bottom of "Decided" (so the top of this file is always what is still open).

## Waiting on the owner (open and proposed)

## D12 — Build our own voice loop, or try a ready-made local Jarvis (isair/jarvis) as the shell?   [decided 2026-11-02: one-hour trial first; install itself waits for his yes to the download size]
**The owner said (2026-11-02):** "Yes, try it first"
**Result:** Do the one-hour trial of isair/jarvis in a separate folder before step 1.5. Facts told to him before install: Windows zip 223 MB (release v2.8.0, 2026-10-19), licence = free for non-commercial/personal use only (fine for Ivan alone), first start downloads its own hearing + voice models on top (size shown by its setup wizard; we pick small ones), 21 GB disk free. Outcome (keep it / not) is logged here after the trial.
**Question:** Ivan asked (2026-11-02): "So we are building our own? Research the web... what about openjarvis, jarvis-ai...?" The research (docs/reference/PRIOR_ART.md, newest section) found three free local Windows projects.
**Claude's reading, not a decision:** keep the plan, but add a one-hour trial of isair/jarvis in a separate folder before step 1.5. If it can call our fetch tools through MCP and sounds good, we write only the fetch tools + dashboard; if not, we continue our own loop. Nothing is installed for this until Ivan says yes.
**Affects:** Phase 1.5, Phase 2

## D15 — Project nicknames Jarvis understands   [proposed 2026-11-03: Claude's defaults, waiting for Ivan's yes]
**Question:** Which nicknames should Jarvis understand for each project (step 2.4)? Asked on 2026-11-03.
**The owner said:** "Use defaults" (so these are Claude's proposal, not his choice).
**Proposal (30 nicknames, tools/hub_status/aliases.json):** ClipForge / clips / socials = Socials Automatisation; orchestration / orchestrator = AI_Orcestration; the game / my game = Game; jobs / job applier = Automatic_Job_Application; script maker = Learning_Script_Maker; new casino / casino revamp = Casino Rewamp; old casino = Casino Old; navigator = Daily_Navigator; cash gate = Cash_Gate; local tts = lokalni_tts; portfolio = Porfolio_Site; roblox = Rblx game; the hub = Hub. "Casino" alone makes Jarvis ask which one. Say "accept all" or name the ones to change.
**Affects:** step 2.4 (ticked with these defaults), Phase 2

## D14 — Who is the voice shell for now: the installed Jarvis (with our relay), or our own voice loop?   [decided 2026-11-03: the Jarvis trial for now, own loop parked]
**Question:** (the fork left open as D12's second half) Phase 2 and later need a voice shell: the installed isair/jarvis with our additions, or our own loop from Phase 1.
**The owner said (2026-11-03):** after hearing Daniel speak for Jarvis ("Sounds good"), chose "Yes, Phase 2 now (Recommended)": start Phase 2 on top of the working Jarvis and park the rest of Phase 1.
**Result:** Phase 2 and the fetch tools are built on the Jarvis trial (Gemini brain D13, Daniel voice D4, persona relay, Claude helper). Phase 1 steps 1.1 to 1.5 are parked, not dropped. Revisit if Jarvis blocks something we need (voice switching, standby memory, Windows quirks, licence limits: free for personal use only). Fetch tools work with either route.
**Affects:** all later phases

## D13 — What should the brain be: a small local model, a cloud model, or both?   [decided 2026-11-02: Gemini free key + Claude for delegated jobs + small local backup]
**Decided (2026-11-02), his words:** "Yes, that is it. Let's try to integrate that." (after the restated proposal below, with the Google privacy cost spelled out). Order of work: first Gemini inside the Jarvis trial, then the Claude hand-off (read-only first). Which small local model is the backup is still open and cheap to settle.
**Question:** Ivan asked (2026-11-02): "better models ... Kimi or DeepSeek ... or ... talk to you, the Claude, or maybe some free API key, maybe like Gemini". Facts and options: docs/reference/PRIOR_ART.md, section "Feature: brain options".
**Claude's reading, not a decision:** keep a small local model as the always-on picker (fast, private, free; PRODUCT.md and D2 say local, no API key), and add an optional spoken "ask the big brain" command that sends one question to a cloud model only when Ivan says so, with a spoken warning that it leaves the PC. Changing D2 needs his words. Which local model: a short test of Qwen3.5 4B and 9B and Gemma 4 E2B/E4B against qwen3:8b would settle it (downloads 3.3 to 7.6 GB each, only with his yes).
**The owner said (2026-11-02):** "if we could just use Gemini and Claude together into one as Jarvis, then that could ... be great. I know that Gemini free API key isn't the best, but honestly, it is fast because it is done in their service, not on my local PC. Also, that means that my PC will be faster, and I won't be really talking to him that much, so free API key just works fine." (Earlier: "I have a free API key" for Gemini; "maybe he can delegate some jobs to Claude".)
**[proposed, restated for a yes]:** brain = Gemini free key (cloud, fast, frees the PC); Claude does delegated jobs; a small local model stays only as the offline fallback. Cost to know: Google says free-tier prompts are used to improve its products, humans may read them, and it asks not to send personal or confidential information. This replaces the "local model only" rule (D2, PRODUCT.md non-negotiables), so it needs his explicit yes and a dated "Changed" line in PRODUCT.md.
**Affects:** Phase 1.4, Phase 2, Phase 7

## D4 — Which voice for Jarvis: the film actor's cloned voice, or a licence-free butler-style voice?   [decided 2026-11-03: kokoro bm_daniel (fastest); replaces the 2026-11-02 Iapetus-copy choice]
**Question:** Should Jarvis sound like the actor from the Iron Man films (cloned from film audio), or like a similar British butler voice cloned from a sample that is free to use?
**Why it matters:** Cloning a real actor's voice is fine to try privately on your own PC, but it must never be published or used in anything public. A licence-free sample has no such limit.
**Options:**
- A) Film-style Jarvis voice from film audio: sounds exactly like the films. You'd notice: instant "that's Jarvis". Cost/risk: private use only; never publish.
- B) Licence-free butler-style sample: sounds similar, not identical. You'd notice: slightly different voice. Cost/risk: none.
- C) Try both, decide after hearing them in the plan's voice test.
**Recommendation:** C, because you can hear both before choosing.
**The owner said (2026-11-02, after hearing 10 British male voices on the audition page):** top two = "gemini Iapetus" and "kokoro bm daniel". Earlier: the current Jarvis voice (Piper Alan) is "okay" but "not that UK butlery". He has not yet chosen between the film actor's cloned voice and these.
**Shortlist (his picks, not yet the final voice):** kokoro bm_daniel (local, 0.1 s a sentence, no limit) and Gemini Iapetus (Google voice service, free tier 3 requests a minute, about 4 s a sentence). Constraint found: the installed isair/jarvis can only use Piper voice files (Chatterbox cloning only when run from source), so neither pick works inside it as it is. Where the voice runs depends on D12.
**CHANGED (2026-11-03), his words, after the speed comparison (Daniel 0.1 s a sentence vs about 9 s for the Iapetus copy):** "if the Daniel from Corco is faster as a local mode ... than Lapetus, then let's use Daniel, right? Whoever is the fastest from that to, let's use him. And that should be the voice of the Jarvis." => **Voice = kokoro bm_daniel (Kokoro, British male).** This replaces the Iapetus-copy choice below, which stays on record. The installed Jarvis only takes Piper voices, so Daniel is played by a local speaker service fed by the relay (trial, see memory).
**Earlier today (2026-11-02), his words:** "I think that Lepidus local copy only is just enough." (He means the local Chatterbox copy of Gemini Iapetus, after hearing Daniel, Google's Iapetus and the local copy played back to back, and after being told the local copy takes about 8-9 s a sentence, holds about 3-4 GB only while he talks, and needs a load of 15-17 s from standby; he said these costs are fine.)
**Result:** Voice = local copy of Gemini Iapetus (Chatterbox cloned from tests/audio/voice_audition/gemini_Iapetus.wav, to be regenerated with a longer, cleaner reference). Daniel and the film actor's clone are not used unless he asks later. It only runs inside our own loop or Jarvis-from-source (Chatterbox is not in the installed Jarvis): where it runs depends on D12.
**Affects:** the voice phase

## D8 — Defaults for the small technical points   [decided 2026-11-02]
**Question:** Do you accept these defaults?
**The owner said (2026-11-02):** chose "Accept all (Recommended)".
**Defaults:** (1) everything runs on this PC only, no open internet port; (2) the dashboard is a plain local web page; (3) no database at first (the Hub only reads files that already exist), plus a small log file of every voice command run; (4) every voice command that changes something is read back and needs a spoken "yes", and is logged; (5) the local model (Qwen3 8B or Llama 3.1 8B) is picked by a short test in the plan; (6) checks: a recorded test of "Hey Jarvis" wake-ups and screenshots of the dashboard; design skills: frontend-design baseline + impeccable layout, verified with playwright-cli.
**Recommendation:** accept all.
**The owner said:** (not answered yet)
**Affects:** all phases

## Decided (newest at the bottom)

## D1 — Where the voice layer and project hub live   [decided 2026-11-01]
**Question:** Where should the voice layer and project hub live?
**The owner said (2026-11-01):** chose "New project 'Hub'" (a new folder, planned first with the usual interview; nothing in AI_Orcestration changes).
**Result:** New project folder `Hub` in the BUSNUS folder. It talks to the AI_Orcestration Manager and to other projects through their fetch commands.
**Affects:** whole project

## D2 — How the "brain" that understands the voice is set up   [decided 2026-11-01]
**Question:** Which brain understands the spoken commands?
**The owner said (2026-11-01):** chose "Local model only": a small model on his PC understands him and picks a command. Free, works offline. Earlier he said: "He isn't a brain of all operations. He's just here to tell me when I ask him something, right? He doesn't know. He doesn't need to know the answers. But he needs to know how to fetch them. That's the main". And: "It would be perfect if it needs an Anthropic key, but I did find that you can use it with offline models. So I want to see how strong would that be." (Note: the first sentence reads as "it would be perfect if it did NOT need an Anthropic key"; the choice made is the local model, no Anthropic API key.)
**Result:** A small local model (about 8 billion parameters, via Ollama, fits his 8 GB graphics card) only picks which fetch command to run. Commands that change something ask "yes?" first (Claude's proposal, to confirm in the plan).
**Affects:** voice phase, command list

## D3 — Which voice speaks and listens   [decided 2026-11-01]
**Question:** Who speaks and listens?
**The owner said (2026-11-01), verbatim:** "there is a free voice that we can use, I know I saw it, we basicly say smt and it learns how we speek and we can use that voice, so if we can replicate jarvice voice for free and make it use for free unlimitet that would be fire"
**Result:** Direction decided: a free, unlimited, local voice that is cloned from a short sample, ideally Jarvis-like. Which tool and which exact voice are NOT decided (see D4; the tool is chosen after a voice test in the plan). Candidates found: Chatterbox (MIT licence, about 10 seconds of sample), OpenVoice (MIT), F5-TTS, XTTS-v2 (non-commercial licence).
**Affects:** voice phase

## D5 — How the voice parts are wired together   [decided 2026-11-02]
**Question:** Small program we write, Pipecat framework, or test both?
**The owner said (2026-11-02):** chose "Small program we write (Recommended)".
**Result:** A short readable loop: wake phrase, listen, pick a command, fetch, speak. Pipecat is not used (PRIOR_ART idea rejected for now).
**Affects:** voice phase

## D6 — What the Hub is written in   [decided 2026-11-02]
**Question:** Python for everything, or Python voice + Node dashboard?
**The owner said (2026-11-02):** chose "Python voice + Node dashboard" (not the recommended Python-for-everything).
**Result:** The voice program is Python; the dashboard web page is Node. Claude noted the cost: two languages and two installs to keep running, and the AI_Orcestration Manager is Python/FastAPI, so the voice program talks to it directly while the Node dashboard reaches it over its local web address.
**Affects:** foundation, voice phase, dashboard phase

## D7 — Which free parts may be tested   [decided 2026-11-02]
**Question:** Which free parts from the research may Claude use for testing?
**The owner said (2026-11-02):** ticked all four: openWakeWord ("Hey Jarvis"), faster-whisper (hearing), Chatterbox cloning voice, Kokoro as the light backup voice.
**Result:** These four are tested in the voice phase; the final pick of each comes after Ivan hears and tries them. Nothing is installed before the plan is approved.
**Affects:** voice phase

## D9 — Name of the private GitHub backup   [decided 2026-11-02]
**Question:** What should the private backup copy be called?
**The owner said (2026-11-02):** chose "Hub".
**Result:** Private repo https://github.com/ZivacHub/Hub (account ZivacHub), main pushed, 25 files, secrets re-scanned right before the push (clean). Nothing else is uploaded.
**Affects:** foundation (backup)

## D10 — Phase 0 result accepted; memory layout for voice and hearing   [decided 2026-11-02]
**Question:** After the PC check: move on to Phase 1, and settle now whether hearing runs on the card or the processor?
**The owner said (2026-11-02):** chose "Go to Phase 1, decide the layout after I hear the voices".
**Result:** Phase 0 closed. Memory layout (hearing on the processor if the cloned voice is chosen, otherwise everything on the card) is NOT decided; it is settled in one sentence right after D4 (step 1.4). Facts it rests on: docs/reference/PC_FIT.md.
**Affects:** Phase 1 (1.3, 1.4), Phase 5 (5.2)

## D11 — Microphone and voice-sample source for Phase 1   [decided 2026-11-02]
**Question:** Which microphone do you normally speak into, and where does the Jarvis voice sample come from?
**The owner said (2026-11-02):** microphone "Laptop built-in (Array)"; voice sample "Both: your clip and a butler sample (Recommended)".
**Result:** Wake and hearing tests use the laptop's built-in Microphone Array (Realtek). For step 1.3 Ivan supplies a clean clip (about 10 s) of the film voice (private use only, never published) and Claude finds a licence-free British butler-style clip and shows its licence; Kokoro is the third voice. D4 itself stays open until step 1.4.
**Affects:** Phase 1 (1.1, 1.2, 1.3)

## D16 — Jarvis personality: an exact answer, now and then one dry remark; Gemini only   [decided 2026-11-04]
**Question:** Ivan wanted an uncensored model (and AirLLM to run a big one) so Jarvis could talk back in a sarcastic, provocative way. Card 2026-11-04: when should he be sarcastic, and with which brain?
**The owner said (2026-11-04):** "he awnsers, but somethines adds a lil bit in the end, or like ohh your asking me again this are we... like that, maby we can reasarch online and see if someone already has smt like this set up some instructions or smt..." and "ok so it will be only gemeni with a new personality".
**Result:** Gemini only, no uncensored local model. AirLLM not used (it reads the whole model from disk for every word: seconds to minutes per word, about 140 GB of disk for a 70B model, 39 GB free; Ivan: "if the response time is much slower, then it just isn't worth it"). Personality: precise answer first; only now and then one short dry remark at the end; a dry comment when he asks the same thing again. The off / mild / spicy switch (step 8.1) is still open.
**Affects:** tools/jarvis_trial/gemini_relay.py (persona text), step 8.1 (partly pulled forward, board Change log 2026-11-04)

## D17 — Jarvis timing and small fixes after Ivan's log   [decided 2026-11-04]
**Question:** (card 2026-11-04, after his pasted log) How long Jarvis waits for him to finish a sentence; how long he keeps listening after speaking; two small fixes (farewell instead of silence, extra spellings of "Jarvis").
**The owner said (2026-11-04):** wait time "6 seconds (as now)"; follow-up window "12s"; small fixes "Yes, both (Recommended)".
**Result:** voice_collect_seconds stays 6.0 (known cost: every answer starts about 6 s after he stops talking; the log showed exactly 7 s from "Working on it" to the plan on 8 of 8 turns); hot_window_seconds 8 -> 12; goodbye/goodnight gets a spoken farewell and the stop tool is used only for stop / quiet / shut up / stop listening; wake aliases get jarrus, jarris, jarvas, jarvez added to Jarvis's 12 defaults; the repeat remark fires only on a near word-for-word repeat and remarks never state unknown facts (time of day).
**Affects:** C:/Users/Ivan/.config/jarvis/config.json, tools/jarvis_trial/gemini_relay.py
