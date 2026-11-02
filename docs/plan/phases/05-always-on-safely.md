# Phase 5 — Always on, safely
Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file holds the detail. A pickup reads only the CURRENT phase's file.

## Purpose in plain words
Jarvis starts with Windows and waits quietly. He barely uses your PC until you wake him, never listens to or keeps anything outside his job, can be stopped by voice or key, and keeps a log of everything he did. At the end you can play a game or use Unity with him sitting there.

## Read first (when working on this phase)
- docs/reference/PC_FIT.md (the measured numbers from phase 0)
- docs/DECISIONS.md (D8)

## Steps
**5.1 Start with Windows with a tiny listener** — Grade: standard. Use: a Windows startup entry (Ivan's choice 2026-11-01). Done when: after a restart, "Hey Jarvis" works within a minute without opening anything. Test: restart the PC and try it. Decisions needed: none.
**5.2 Load heavy parts only when needed; measure during a game** — Grade: standard. Use: the measurements from phase 0. Done when: idle use is small (target: no graphics memory held while idle, under 1 GB RAM, near 0% processor) and heavy parts load on the wake phrase and free again after about a minute. Test: the numbers measured idle, while talking, and while a game or the Unity editor runs. Decisions needed: if the targets can't be met, a new decision.
**5.3 "Stop listening", visible indicator, hard stop** — Grade: standard. Use: a small tray icon or page indicator plus a keyboard shortcut. Done when: "Hey Jarvis, stop listening" mutes him until a key press; the indicator always shows whether the microphone is live. Test: say it, then confirm the wake phrase no longer works until re-enabled. Decisions needed: none.
**5.4 Action log on the dashboard** — Grade: standard. Use: a log file plus a dashboard tab. Done when: each wake shows time, what was heard, command run, and whether a yes was given. Audio is not kept unless Ivan asks. Test: run three commands and see three lines. Decisions needed: none.
**5.5 Mishear test (50 spoken commands)** — Grade: strong (this proves the safety promise). Use: 50 spoken or recorded sentences including noise, TV talk, near-misses. Done when: nothing that changes something ran without a read-back and a yes, and false wakes stay at the phase-1 target. Test: the 50 results in a table. Decisions needed: none.
**5.6 Security pass** — Grade: strong (security). Use: the security-review skill (the free default), then probing the running Hub from another device and with bad input. Done when: the Hub's local address is closed to the network, nothing reads keys or password files, and each finding was fixed and re-probed. Test: the probe requests and results listed. Decisions needed: none.

## Risks and open points (only for this phase)
- Always-on voice on a laptop affects battery; measured in 5.2.
- Anything overheard stays on the PC; no audio is sent anywhere (all parts are local).

## Phase gate record
- Plain-words preview shown: (not yet). Skills/repos search: (not yet). Decisions asked: none expected. The owner's go: (not yet).
