# Handoff: Hub   (updated 2026-11-02)
Git: none yet (the folder is not a git repo; git init + private GitHub repo come after the plan is approved) · pushed: no · uncommitted: everything (new folder, docs only)

## Where we are in the plan
Phase 0 of 9 (Phase 0 to 8) — Check the PC. Steps done 0/43. Next per plan: 0.1 Install the basics (with Ivan's yes), but only after Ivan approves the plan (board Status is DRAFT).
(Copied from docs/plan/BOARD.md. No step is started; the interview, research, technical choices and plan are done.)

## What we're building
A Jarvis voice assistant that starts with Windows on Ivan's PC and a clean dashboard of all BUSNUS projects. It does not know answers, it only fetches them (plan boards, decisions, handoffs, chat history, the AI_Orcestration Manager). Ivan's words: docs/PRODUCT.md.

## Last session
- Did (2026-11-01 to 02, in a chat opened in the BUSNUS workshop): the whole `new-project` interview (5 rounds), docs/PRODUCT.md CONFIRMED by Ivan; DECISIONS D1, D2, D3, D5, D6, D7, D8 decided in his words; docs/reference/PRIOR_ART.md (GitHub search: no ready-made Jarvis fits, but wake phrase, hearing, cloning voice and dashboard parts exist and are free); docs/plan/BOARD.md (DRAFT, 9 phases, 43 steps; grades 3 light, 26 standard, 14 strong) with phase files docs/plan/phases/00 to 08; docs/reference/TASKS.md; docs/INDEX.md.
- Ivan chose the phase list ("Yes, go with it") but has NOT yet approved the steps/grades. Nothing is installed, no code exists.
- Left unfinished: D4 (which Jarvis voice) is open; his steps/grades approval; new-project Phase F setup (below).

## Next steps (strictly in order; step 1 is where the next session starts)
1. Ask Ivan to approve the plan (docs/plan/BOARD.md and the nine phase files; grades 3 light, 26 standard, 14 strong). Done when: he says yes; then set the board to `Status: APPROVED <date>`, copy the rest of `_template` (CLAUDE.md filled from decisions with its docs map, README.md, `.claude/busnus.json`, docs/reference/{DESIGN,ARCHITECTURE,TESTING,SECURITY_CHECKLIST}.md), do the secrets scan, `git init` + first commit, ask the repo name and create a PRIVATE GitHub repo.
   Read first: docs/plan/BOARD.md, docs/reference/TASKS.md, docs/DECISIONS.md
2. Phase 0 gate (plan skill): plain-words preview of "Check the PC", visible skills/repos search note (see docs/reference/PRIOR_ART.md: nothing to install in skills), ask the go. Done when: Ivan says go.
3. Step 0.1 Install the basics (Python, Node check, Ollama) with Ivan's yes and download sizes told first. Done when: three version commands print.

## Waiting on the owner
- Plan approval (BOARD.md, grades and steps): he saw the phase list and agreed, not the full steps yet.
- D4 Jarvis voice — film actor clone (private use only) vs licence-free butler sample vs try both; hear them in step 1.3.
- PRIOR_ART pending ideas (no rush): borrow sniffly's chat-log reading idea (phase 6); borrow "needs you" alerts (phase 6).

## Gotchas a fresh session would get wrong (max 8, only things still true)
- This project was planned in a chat opened in the BUSNUS workshop, so no Hub-specific start-up check ran; open a chat inside the Hub folder after setup.
- "ClipForge" is the folder `Socials Automatisation`; the 11 folders without workflow files show as "not set up" on the dashboard.
- Ivan chose Python voice + Node dashboard (D6) although two languages were not the recommendation: the voice program talks to the dashboard through a local data feed.
- His PC: i7-13650HX, 15.6 GB RAM, RTX 4060 Laptop with 8 GB graphics memory, 41 GB disk free. Installs and model downloads need his yes and their size told first.
- Ivan wants it always on from Windows start (phase 5 keeps idle cost small and measures it) and a casual, a-bit-vulgar tone (phase 8, with a setting).
- Never post, spend money, delete/overwrite files or speak secrets on its own; changing anything needs a read-back and spoken "yes".
- The AI_Orcestration Manager (ai_company/execution/manager_query.py) was last edited in the summer and is untested; step 3.5 checks it.
- Another set of workshop work waits in the BUSNUS root handoff (Game folder, Install.bat, old chats); it was set aside, not dropped.

## Running / not committed
- Services running: none  ·  Not committed: all files (no git yet)
