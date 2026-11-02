# Tasks: work split and quality checklist
Read when: starting a phase that could run helpers in parallel, or before closing a phase.

## Work split (who owns which paths; shared files belong to the foundation)
The Hub is small enough that most steps run one after another in the main chat. Parallel helpers are allowed only between these disjoint areas:
| Area | Owns (paths) | Phases |
|---|---|---|
| Foundation | `docs/`, `CLAUDE.md`, `README.md`, `config/` (aliases, settings), `voices/` (chosen voice samples) | all |
| Voice program (Python) | `voice/` (wake phrase, hearing, speaking, command picker, data feed) | 0, 1, 2, 4, 5, 6, 7 |
| Dashboard (Node) | `dashboard/` (the page) | 3, 6 |
| Tests and measurements | `tests/`, `docs/reference/PC_FIT.md` | all |
Other projects' files are never owned by the Hub. The only exceptions are the append in phase 4 (decision files) and phase 8 (ClipForge commands), each with Ivan's go.

## Quality checklist (each line has the phase that must satisfy it)
- [ ] Phase 0: PC_FIT.md has measured numbers for all five parts (not guesses).
- [ ] Phase 1: wake phrase meets the 18-of-20 / 1-false-wake targets on a recorded run.
- [ ] Phase 2: command picker scores at least 90% on the 40-sentence test; answers match the files.
- [ ] Phase 3: dashboard screenshot matches the approved design; local address refuses other devices.
- [ ] Phase 4: no write without a read-back and "yes"; before/after file diff shows only added lines.
- [ ] Phase 5: idle cost within targets; 50-command mishear test passes; security review findings fixed and re-probed.
- [ ] Phase 6: secret filter hides fake keys; chat reader is read-only.
- [ ] Phase 7: quiet run cannot publish, spend or delete; harmless-task test passes.
- [ ] Phase 8: "post it" dry-run matches the real post; the first real post done with Ivan present.
- [ ] Every phase: board ticked with proof, handoff written, memory entry added.
