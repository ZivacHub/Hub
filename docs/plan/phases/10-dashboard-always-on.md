# Phase 10 — Dashboard always on and safe (stage 3, no voice needed)
Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file holds the detail. A pickup reads only the CURRENT phase's file.

## Purpose in plain words
The dashboard is there when you want it: it starts with Windows (or opens with one click or one short command), nothing outside this PC can reach it, and nothing on it can change a file or show a password. Ivan uses it for a day and says what to change.

## Read first (when working on this phase)
- docs/reference/SECURITY_CHECKLIST.md, docs/DECISIONS.md (D8, D19, D20)

## Steps
**10.1 Starts with Windows and opens with one click or one short command** — Grade: standard. Use: a Windows startup entry (Ivan's earlier choice: starts with Windows, keep it small) and a desktop shortcut. Done when: after a restart the page is reachable without starting anything by hand; one click opens it. Test: restart the PC, open the address; measure the memory the small server holds and report it. Decisions needed: a choice card for "starts with Windows, or only when I click" if the memory cost is not tiny.
**10.2 Security pass on the page (this PC only, nothing editable, no keys shown)** — Grade: strong. Use: /security-review (free default) then probe the running page with curl/playwright-cli: LAN access refused, no write routes, odd URLs, path tricks, key-like text hidden (6.4). Done when: each finding has a proving request and a fix, re-probed clean. Test: the probe list. Decisions needed: none.
**10.3 Milestone: Ivan uses it for a day and says what to change** — Grade: light (needs Ivan). Done when: Ivan's list of changes is in DECISIONS.md or becomes new steps. Test: his words. Decisions needed: his verdict.

## Risks and open points (only for this phase)
- Starting with Windows adds a little background memory; measured in 10.1.

## Phase gate record
- Plain-words preview shown: (not yet). Skills/repos search: (not yet). Decisions asked: startup choice in 10.1 if needed. The owner's go: (not yet).
