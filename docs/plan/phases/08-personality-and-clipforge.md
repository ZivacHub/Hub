# Phase 8 — Personality and ClipForge actions
Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file holds the detail. A pickup reads only the CURRENT phase's file.

## Purpose in plain words
Jarvis gets the casual, a-bit-vulgar tone you asked for (with a setting so you can turn it down), and learns two ClipForge tricks: "pull up today's clips" and "post it" (after a spoken yes). The ClipForge side needs two small new commands inside the Socials Automatisation project; the Hub only asks, it never posts by itself.

## Read first (when working on this phase)
- Socials Automatisation's own docs (its docs/PRODUCT.md and docs/plan/BOARD.md) before touching it, and its project chat state
- docs/reference/COMMANDS.md

## Steps
**8.1 Personality with a setting (off / mild / spicy)** — Grade: strong (taste). Use: a short style note for the replies, applied to the wording only; numbers still come from data. Done when: Ivan hears the same status in three levels and picks the default. Test: Ivan listened. Decisions needed: the default level (choice card).
**8.2 Add "latest clips" and "publish queue" commands to ClipForge** — Grade: standard. Use: ClipForge's own code and its plan; this is a change INSIDE the Socials Automatisation project, so it needs that project's chat or Ivan's go and a plan line there. Done when: ClipForge answers "what did you make today" and "what's queued to post" with real data on its local address. Test: call both and compare with ClipForge's own screen. Decisions needed: Ivan's go to change that project.
**8.3 "Pull up today's clips" by voice** — Grade: standard. Use: the commands from 8.2. Done when: the phrase opens or shows today's clips (page or file view) and Jarvis says how many there are. Test: say it with clips present and with none. Decisions needed: none.
**8.4 "Post it" with a spoken yes** — Grade: strong (publishing, outward-facing). Use: ClipForge's own publish function only. Done when: Jarvis reads back exactly what will be posted and where, posts only after "yes", logs it, and never posts anything Ivan didn't name. Test: a dry-run mode first (shows what it would post), then one real post with Ivan present. Decisions needed: Ivan's go for the first real post.

## Risks and open points (only for this phase)
- Socials Automatisation has its own plan and an active chat; changes there follow its board and the owner's go, not the Hub's.
- A mistaken post is public and can't be undone; hence the dry run and the read-back.

## Phase gate record
- Plain-words preview shown: (not yet). Skills/repos search: (not yet). Decisions asked: default personality level; go to change ClipForge; go for first real post. The owner's go: (not yet).
