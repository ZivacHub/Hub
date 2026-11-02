# Handoff: Hub   (updated 2026-11-02)
Git: main @ d4088e7 "Hub: planned and approved (goal, decisions D1-D8, prior art, 9-phase plan)" · pushed: no (no GitHub repo yet, waiting for Ivan's repo name) · uncommitted: this handoff

## Where we are in the plan
Phase 0 of 9 (Phase 0 to 8) — Check the PC. Steps done 0/43. Next per plan: 0.1 Install the basics (with Ivan's yes), after the Phase 0 gate.
(Copied from docs/plan/BOARD.md. Plan APPROVED by Ivan 2026-11-02. No step is started; nothing is installed and no code exists.)

## What we're building
A Jarvis voice assistant that starts with Windows on Ivan's PC and a clean dashboard of all BUSNUS projects. It does not know answers, it only fetches them (plan boards, decisions, handoffs, chat history, the AI_Orcestration Manager). Ivan's words: docs/PRODUCT.md.

## Last session
- Did (2026-11-01 to 02, in a chat opened in the BUSNUS workshop): the full `new-project` flow. PRODUCT CONFIRMED; DECISIONS D1, D2, D3, D5, D6, D7, D8 decided in his words; PRIOR_ART.md; plan BOARD.md APPROVED (9 phases, 43 steps, grades 3 light / 26 standard / 14 strong) with phase files 00 to 08; setup files (CLAUDE.md, README, reference docs, .gitignore, .claude/busnus.json); secrets scan clean; `git init` and first commit d4088e7.
- Left unfinished: the private GitHub repo (Ivan has not given a name; nothing is pushed); D4 (which Jarvis voice) is open until step 1.4.

## Next steps (strictly in order; step 1 is where the next session starts)
1. Phase 0 gate (plan skill) for "Check the PC": plain-words preview, the visible skills/repos search note (docs/reference/PRIOR_ART.md: nothing to install in skills), the phase's decisions (none), then ask Ivan's go. Also ask the GitHub repo name and create it PRIVATE (secrets already scanned). Done when: Ivan says go and the repo exists or he chose to wait.
   Read first: docs/plan/phases/00-check-the-pc.md, docs/reference/PRIOR_ART.md
2. Step 0.1 Install the basics (Python, Node check, Ollama) with Ivan's yes and the download sizes told first; grade it again on the spot (delegate skill). Done when: three version commands print.
3. Step 0.2 Try the two local models on 10 sample commands. Done when: a results table with speed and graphics memory exists.

## Waiting on the owner
- GitHub repo name for the private backup (or "later").
- Phase 0 go (after the gate preview).
- D4 Jarvis voice — film actor clone (private use only) vs licence-free butler sample vs try both; he hears them in step 1.3 and decides in 1.4.
- PRIOR_ART pending ideas (no rush): sniffly's chat-log reading idea and "needs you" alerts, both for phase 6.

## Gotchas a fresh session would get wrong (max 8, only things still true)
- The Hub was planned in a chat opened in the BUSNUS workshop; open the next chat INSIDE the Hub folder so the start-up check and this project's skills run.
- "ClipForge" is the folder `Socials Automatisation`; the 11 folders without workflow files show as "not set up" on the dashboard.
- Ivan chose Python voice + Node dashboard (D6) although Python-only was recommended: the voice program feeds the dashboard through a local data feed.
- His PC: i7-13650HX, 15.6 GB RAM, RTX 4060 Laptop with 8 GB graphics memory, 41 GB disk free. Installs and model downloads need his yes and their size told first.
- He wants it always on from Windows start (phase 5 keeps idle cost small and measures it) and a casual, a-bit-vulgar tone (phase 8, with a setting).
- Never post, spend money, delete/overwrite files or speak secrets on its own; anything that changes something needs a read-back and a spoken "yes".
- The AI_Orcestration Manager (ai_company/execution/manager_query.py) was last edited in the summer and is untested; step 3.5 checks it.
- The BUSNUS workshop handoff still has its own open step 1 (Game folder, Install.bat, old chats); set aside by Ivan's new idea, not dropped.

## Running / not committed
- Services running: none  ·  Not committed: this handoff (committed right after writing it)
