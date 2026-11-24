# Ideas from the older orchestration project (budget guard, run progress)

Read when: designing the Hub's usage meter, budget warnings, cost view or phase-report page (Phase 21, 18).

Source: Ivan's older project in `AI_Orcestration/ai_company`, read only (2026-11-24, step 21.7).
Files looked at: `execution/budget_guard.py`, `execution/model_config.py` (the two levels),
`execution/token_tracker.py`, `execution/persistent_spend.py`, `execution/balance_tracker.py`,
`orchestrator.py` (where the guard is called), `server.py` (events and job routes),
`project_documenter.py`, `ui/SPEC.md`, `ui/js/index.js`. Nothing was run or copied.
Ideas only: no code, no keys, no data from that project is kept here.

## Part 1: the budget guard

**How it works.** One spending cap per run, set by one setting (a dollar number). After every
single call to an AI model, the code adds the cost to a running total (tokens in and out,
times a price list per model, cached tokens priced lower) and then asks the guard: "how far
are we?". The guard divides spend by cap.
- At 80 percent: one warning line in the log, only once per run. Work continues.
- At 100 percent: it throws a "budget exceeded" error that carries the spent and the cap
  amounts. The run stops cleanly at that point. A wave of parallel tasks that hits it
  re-raises it, so the whole run halts rather than the one task failing quietly.
- No cap set = the guard does nothing.
- Reset: a fresh guard is made at the start of each run (so the warning can fire again).
  A separate "spend history" per project is kept in a small database and has a manual reset.
- Before a run starts, a cost ESTIMATE is shown (cheap mode and fast mode side by side) and
  the person must confirm. If the estimate alone is already over the cap, the run is refused.
- Shown to the person: a live "run cost, balance left, tokens in/out" strip updated after
  every call, a toast when the run ends or is paused with its cost, and a note when the
  account balance is under twice the cap ("consider topping up").

**Why it helps the Hub.**
- Same two-level shape as our usage meter: warn at 70, stop sign at 90. We only change the numbers.
- "Warn once, then stay quiet" avoids nagging; the Hub should do the same per meter window.
- The estimate-before-you-start check fits phase gates: show the expected size of a phase
  next to what is left of the limit before Ivan says go.
- "Stop cleanly, with a save point" fits our hand-off before the limit: at 90 percent the
  manager writes the handoff instead of cutting off mid-step.
- Per-call recording (who, which task, which model, how many tokens, a label) is exactly
  the record needed for a cost view per project, per phase and per helper.

**What we would do differently.**
- Our meter is the Claude plan limit (a share of a time window), not dollars; there is no
  API key (D2). Count what the session files already hold, or the plan's own percentage,
  and say "about" when it is a guess.
- Show the level on the dashboard (bar with the two marks, color change at 70, a clear stop
  sign at 90) and in Jarvis, not only in a log line.
- At 90 percent do not throw an error: ask the manager to finish the step, write the handoff
  and park the phase. Ivan decides whether to go on (his limit, his call).
- Warn level can fire again after a window reset (the old guard only resets per run).
- Keep the thresholds in `config/`, not hard-coded, and log each crossing with a time stamp.

**What NOT to take over.** Its dollar prices table, the API balance lookups, its run queue,
the docker and nginx setup, its web server and live socket, and the single global "run" idea.

## Part 2: plan, run and progress page

Finding: `project_documenter.py` is NOT a plan page. It scans the source files and writes one
long documentation file (file index first, then one section per file). The plan / run / progress
pattern lives in the main server and the web page, and in how the documenter is started as a job.

**Ideas worth borrowing**
1. Write the header and file list FIRST, then add sections as work finishes, so an
   interrupted run leaves a usable file. Hub use: phase reports built step by step.
2. Progress as a simple counter "done / total" plus a percent, plus the wave or step name.
   Events at milestones only (not every tick), with a "log detail" switch: full, clean, minimal.
   Hub use: one bar per phase on the report page; a "short view" for the phone.
3. Repeated events are dropped inside a short time window (same key = skip). Hub use: stops
   the feed from showing the same helper line five times.
4. A job started from the page gets a short id; the page asks "how is job X?" and gets status
   (running, done, failed, stopped), the last lines of output, and done/total read from the
   output text. Plain asking every few seconds, no special channel. Hub already polls, so this
   fits our plain local page.
5. Ask the person to confirm before an overwrite or a very large scan; keep a few timestamped
   backups and prune old ones. Hub use: keep the last few phase reports, never lose one.
6. A run that is cut short keeps a "paused, save point written" state and the page offers to
   resume. Hub use: the "waiting / parked" state of a phase.
7. Cost shown on the run-finished message and as one small card (run cost, tokens in/out,
   balance). Hub use: the same three numbers on each phase report.

**What we would do differently.** Read the data we already have (plan board, handoff, helper
records, session files) instead of a live socket; show step ticks with proof, not just percent;
roll cost up per helper, per phase and per project; one plain-words sentence at the top of each
report for Ivan.

**What NOT to take over.** The documenter's own job (source scanning, model calls to write docs),
its large single page and its server; its settings screens; docker.

## Short list of ideas
1. Two levels (warn once, then stop), checked after every call, thresholds in config.
2. Estimate before the phase starts, next to what is left of the limit.
3. At the stop level: finish the step, write the handoff, park the phase.
4. One record per call (who, step, model, tokens) feeds the cost view per project/phase/helper.
5. Reports written header-first and progressively, with done/total, and a cost card.
