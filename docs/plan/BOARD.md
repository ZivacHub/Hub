# Hub — Plan board
Status: APPROVED 2026-11-02 (Ivan: "Approve (Recommended)")        Plan version: 2        Last changed: 2026-11-07
Goal and non-negotiables: docs/PRODUCT.md. Every decision: docs/DECISIONS.md. Detail of each phase: docs/plan/phases/ (one file per phase).
This file stays SMALL on purpose: the tick-list, the rules and the change log. It is read at the start of every session.

## Status board
Legend: `[ ]` not started · `[~]` in progress · `[x]` done (proof in the step) · `[-]` dropped (reason in the Change log).
This board is the ONLY place that tracks progress. Tick a step in the same change set that finishes it. A script reads it
(phases = top-level lines, steps = indented lines), so keep exactly this shape. Each phase title starts with `Phase <number>`
and has a detail file `docs/plan/phases/<NN>-<name>.md` (NN = the phase number, two digits: Phase 4 -> `04-screens.md`).

- [x] Phase 0 — Check the PC
  - [x] 0.1 Install the basics (with Ivan's yes) — all three already installed, nothing downloaded: Python 3.11.9, Node v24.13.1, Ollama 0.22.1 (2026-11-02)
  - [x] 0.2 Try the two local models on sample commands — llama3.1:8b 10/10 at 0.75 s, qwen3:8b 9/10 at 0.51 s, both about 5.5 GB graphics memory; table in docs/reference/PC_FIT.md (2026-11-02)
  - [x] 0.3 Measure each voice part (idle and active) — all 5 parts plus both brains measured, plus 3 combinations really loaded together; table in docs/reference/PC_FIT.md (2026-11-02)
  - [x] 0.4 Show Ivan the fit result and get his go — Ivan: "Go to Phase 1, decide the layout after I hear the voices" (D10, 2026-11-02)
- [~] Phase 3 — Dashboard page: project cards, waiting decisions, Manager card
  - [x] 3.1 Local data feed for the page (Node, this PC only) — tools/dashboard/server.mjs binds 127.0.0.1 only; `node tools/dashboard/server.mjs --selftest` 5/5 (JSON, page, POST refused, path tricks refused, foreign Host refused); the PC's network address refused the connection; 19 project folders read, numbers via the same library as busnus-status (2026-11-07)
  - [~] 3.2 Design direction (Ivan sees a light and a dark picture, light is default) — built straight to a working page at Ivan's "finish this as a demo"; light, dark and phone pictures in docs/screenshots/ (sample data); design detector clean; WAITS for Ivan's yes or changes (2026-11-07)
  - [x] 3.3 Build the page: one card per project, "not set up" group, refreshes itself — real data: 5 cards with a plan + 14 in the "not set up" group; "Updated" time moved from 01:31 to 01:32 with no reload; no console errors; screenshots at 1360 and 390 wide (2026-11-07)
  - [x] 3.6 All waiting decisions in one list — real data: list shows 5 (Game 4 + Hub 1), equal to the "waiting on you" pills on the cards (2026-11-07)
  - [~] 3.5 Show the AI_Orcestration Manager on the dashboard — "Not running" state checked on the real PC; "Running" state only seen with sample data (the Manager has /health, /goal, /queue, not /progress); not yet started for real
  - [x] 3.7 Light / dark switch (light by default, remembered) — first visit light; after switching to dark and reloading it stayed dark; screenshots of both (2026-11-07)
  - [ ] 3.8 Milestone: Ivan opens the page and says whether one glance tells him enough
  - [-] 3.4 "Pull out the dashboard" by voice — moved to the optional voice track on 2026-11-07 (D19); comes back as a new step if the voice lives
- [~] Phase 6 — Claude's latest answers and "needs you" alerts (stage 2: 6.1, 6.2, 6.4 first, 6.3 last)
  - [~] 6.1 Find the latest Claude answer per project (read-only) — reads the saved chat files (last 1.5 MB of the newest file per project); real data returns 6 projects; still to compare with the app for two projects
  - [~] 6.2 Show them on the dashboard — each card shows Claude's last words and time, click for more; waits for the 6.1 comparison
  - [x] 6.4 Never show or speak anything that looks like a secret — redact() in tools/dashboard/lib/data.mjs: fake sk-, AIza, token= and long random strings all became [hidden] (tested 2026-11-07); covers what the page shows, the spoken side stays with the voice track
  - [ ] 6.3 Detect "a chat needs you" and say so
- [ ] Phase 10 — Dashboard always on and safe (stage 3, no voice needed)
  - [ ] 10.1 Starts with Windows and opens with one click or one short command
  - [ ] 10.2 Security pass on the page (this PC only, nothing editable, no keys shown)
  - [ ] 10.3 Milestone: Ivan uses it for a day and says what to change
- [ ] Phase 4 — Answer decisions (by click or by voice, later)
  - [ ] 4.1 Read waiting decisions aloud
  - [ ] 4.2 Take the answer, read it back, wait for "yes"
  - [ ] 4.3 Append the answer to the project's decision file safely
  - [ ] 4.4 Test on a scratch copy, then once on a real project
- [~] Phase 1 — Ears and mouth (optional voice track, runs in the Jarvis chat)
  - [~] 1.1 "Hey Jarvis" wake-phrase test — NOT met yet: 16/20 woke at the standard setting (target 18); 20 min of video: 0 false wakes at 0.5, loudest 0.48. See memory 2026-11-02
  - [ ] 1.2 Speech-to-text test
  - [ ] 1.3 Voice test page: actor-style, butler-style, Kokoro
  - [ ] 1.4 Ivan picks the voice (closes D4)
  - [ ] 1.5 First loop: wake, listen, repeat back aloud
- [~] Phase 2 — Project status by voice (optional voice track, runs in the Jarvis chat)
  - [x] 2.1 Read every project's status from its files — tools/hub_status/status.mjs reuses busnus.mjs; `node tools/hub_status/server.mjs --selftest`: 16 projects match `busnus-status` (phases done, decisions waiting), nickname ClipForge works, ambiguous/unknown names refused; asked by voice through Jarvis: "which projects" and "decisions waiting" answered with the real numbers (2026-11-03)
  - [x] 2.2 Write the safe command list — docs/reference/COMMANDS.md; Ivan: "they're all fine" (2026-11-03); also hides Jarvis's file-deleting and screen-reading built-ins via the relay (tested)
  - [x] 2.3 The brain (Gemini inside Jarvis) picks the right fetch tool (accuracy test) — tests/tool_pick_test.py: 39/40 right (97%, target 90%) with Jarvis's real tool list through the relay, incl. slang, mumbles, chit-chat and 5 unsupported requests all declined; 1 miss ("approval in the Hub" asked for all projects, harmless); first run 38/40 before fixing the "Rewamp" spelling alias and the tool description (2026-11-03)
  - [x] 2.4 Project names and nicknames (ClipForge) — 30 nicknames in tools/hub_status/aliases.json, every one resolved to the right project (check run, 0 mismatches); Ivan said "Use defaults", so they are Claude's proposal (D15, [proposed], waits for his yes); "casino" asks which one; short folder names match only exactly (2026-11-03)
  - [x] 2.5 Spoken answers built from real data — sentences built by code (tools/hub_status/status.mjs); `python tests/spoken_check.py` counts phase, steps, percent, next step and decisions waiting a second way from the plan board and decisions files: 5/5 projects match (Hub, Game, Socials Automatisation, Automatic_Job_Application, Learning_Script_Maker); the check also showed the library correctly ignores a "superseded" decision (2026-11-03)
  - [ ] 2.6 Milestone demo: ask three questions by voice
- [ ] Phase 9 — Continue a project's Claude chat by voice (optional voice track, runs in the Jarvis chat)
  - [ ] 9.1 Find a project's chats, read-only
  - [ ] 9.2 Say what the newest chat last said
  - [ ] 9.3 Take the instruction, read it back, wait for "yes"
  - [ ] 9.4 Send it to Claude, on a scratch project first
  - [ ] 9.5 Milestone demo
- [ ] Phase 5 — Always on, safely (optional voice track, runs in the Jarvis chat)
  - [ ] 5.1 Start with Windows with a tiny listener
  - [ ] 5.2 Load heavy parts only when needed; measure during a game
  - [ ] 5.3 "Stop listening", visible indicator, hard stop
  - [ ] 5.4 Action log on the dashboard
  - [ ] 5.5 Mishear test (50 spoken commands)
  - [ ] 5.6 Security pass
- [ ] Phase 7 — Dictate ideas, start work (optional voice track, runs in the Jarvis chat)
  - [ ] 7.1 Dictate a new idea into a note
  - [ ] 7.2 Read back and confirm the note
  - [ ] 7.3 "Open" mode: open the project's Claude chat
  - [ ] 7.4 "Quiet" mode: run a task in the background and report back
  - [ ] 7.5 Test with a harmless task
- [ ] Phase 8 — Personality and ClipForge actions (optional voice track, runs in the Jarvis chat)
  - [ ] 8.1 Personality with a setting (off / mild / spicy)
  - [ ] 8.2 Add "latest clips" and "publish queue" commands to ClipForge
  - [ ] 8.3 "Pull up today's clips" by voice
  - [ ] 8.4 "Post it" with a spoken yes

## Rules for this plan
- **Order:** the next step is the first unticked step of the first unfinished phase. Jumping ahead, reordering or dropping needs the owner's OK and a Change log line. Add new steps with the next free number; never renumber old ones.
- **Phase gate (before starting each phase):** (1) say in plain words what this phase builds and what the owner will be able to see/try at the end; (2) show the skills/repos search result for this phase, even when it is "nothing worth adopting, here is what I checked"; (3) put every open decision this phase needs to the owner as a choice card; (4) wait for the owner's go. Then build.
- **Phase close:** show the owner what now works (screenshot / command output / recording), tick the phase, run the `handoff` skill.
- **Every step has a Grade** (`light` / `standard` / `strong`, in the phase file; the `delegate` skill explains them). The owner approves the grades with the plan; they are a first guess, and Claude grades the step again on the spot right before starting it. Light and standard steps may run in helpers on a cheaper model and effort; Claude checks the result before ticking.
- **Done means proven:** each step has a "Done when" and a "Test" (written in the phase file); tick only after the test ran.
- **Hub-specific:** nothing that changes anything (a file, a post, money) ever runs from a voice command without a read-back and a spoken "yes". Other projects' files are only changed by the Hub in phase 4 (append to decisions) and phase 8 (ClipForge), each with Ivan's go. Big downloads (models) are announced with their size first; disk is 41 GB free.
- **Where things go:** step detail -> the phase file. Decisions -> docs/DECISIONS.md (open ones as `[open]`). Skills list -> CLAUDE.md. Quality checklist and work split -> docs/reference/TASKS.md. Risks -> the phase file they belong to, or DECISIONS.md once the owner has to answer.

## Change log
- 2026-11-07 (Ivan: "lets focus on dashboard itself, so we can menage all projects from there, jarvis is an optional thing and probaly will not live up", then "Yes, dashboard first (Recommended)", D19, D20): plan re-ordered. Dashboard track first: Phase 3 (widened: data feed, design, cards, waiting-decisions list 3.6, Manager card, light/dark switch 3.7, milestone 3.8), then Phase 6 (6.1, 6.2, 6.4 first, 6.3 last), then NEW Phase 10 (always on and safe, no voice), then Phase 4. Voice phases 1, 2, 9, 5, 7, 8 move to an optional voice track at the bottom, kept by the Jarvis chat; nothing deleted, no step renumbered. 3.4 (voice opens the dashboard) marked dropped from this track with the reason on its line. The Jarvis chat last pointed at 2.6 as next: it should now read this board as the dashboard first, voice on the side. Phase 5 steps 5.1 and 5.6 stay in the voice track; Phase 10 covers the same for the page.
- 2026-11-04 (Ivan: "ok so it will be only gemeni with a new personality", D16): personality work started early, as a relay-only change (answer exactly, only now and then one short dry remark, a dry comment when he repeats a question). Step 8.1 (the off / mild / spicy switch) stays open in Phase 8. Also fixes for Jarvis cutting him off while he thinks and for old answers coming back (Jarvis settings + relay), done beside step 2.6, which is still the next step on the board. AirLLM and an uncensored local model were looked at and not used (D16).
- 2026-11-03 (Ivan: "Yes, move it up"): NEW Phase 9 "Continue a project's Claude chat by voice" (5 steps, detail in docs/plan/phases/09-continue-claude-chat-by-voice.md), placed right after Phase 2 in the list on purpose (numbers are never changed, so it keeps number 9). It is the narrow first version of Ivan's wish "ask a project what's going on, answer, Claude continues"; Phase 7's 7.3 and 7.4 may shrink later. Its phase gate (preview, search, decisions) still runs before it starts. Messages and email overview are still only recorded as ideas.
- 2026-11-03 (Ivan: "Yes, Phase 2 now (Recommended)" after "Sounds good" about Daniel's voice): Phase 2 started before Phase 1 is finished. Steps 1.1 to 1.5 are PARKED, not dropped: for now the voice part (ears, Gemini brain D13, Daniel's voice D4, persona relay, Claude hand-off) runs inside the installed Jarvis trial; D12 (own loop or Jarvis) stays open and the parked steps come back if we build our own loop. Step 2.3 now reads "the brain picks the right fetch tool" (Gemini inside Jarvis instead of a local model). Fetch tools are built as a read-only helper in tools/hub_status/ and work with either route.
- 2026-11-02 (outside the phase order, at Ivan's go): D13 decided (brain = Gemini free key + Claude for delegated jobs + small local backup). Built early in the isair/jarvis trial, not product code: tools/jarvis_trial/ (persona relay, start script) and tools/claude_bridge/ (read-only `ask_claude` helper, protocol self-test passes; real Claude call blocked until Ivan logs the `claude` command line in again). Phase 1 steps unchanged; Phase 7 (start work from voice) will reuse the bridge. D12 still open.
- 2026-11-02 (no plan change): Phase 1 gate passed (Ivan: "Yes, start Phase 1", D11). Step 1.1 started, target not yet met. D12 (try a ready-made local Jarvis as shell) opened by Ivan's question; not decided.
- 2026-11-02 (no plan change): Phase 0 closed; step 0.4 ticked with D10 (memory layout to be settled at step 1.4).
- 2026-11-02 (no plan change): step 0.3 ticked; PC_FIT.md has the measured numbers.
- 2026-11-02 (no plan change): Phase 0 gate passed (Ivan: "Go, start Phase 0"); step 0.1 ticked, the tools were already on the PC.
- 2026-11-02 (Ivan approved the plan, grades 3 light / 26 standard / 14 strong): Status set to APPROVED. Setup files (CLAUDE.md, README, reference docs, git) added the same day.
- 2026-11-02 (Ivan chose the phase list "Yes, go with it"; Claude wrote the steps): first version of the plan, 9 phases, 43 steps, from the interview in docs/PRODUCT.md and decisions D1 to D8.
