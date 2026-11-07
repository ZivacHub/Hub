# Design
Read when: working on the dashboard (Phase 3 and 6) or the voice indicator.

## Direction
- Vibe: clean modern dashboard (Ivan, 2026-11-01); one card per project with a progress bar. Not the Iron Man HUD look.
- Reference sites: none given yet; the design picture in step 3.2 is shown to Ivan before building.
- Avoid: clutter, glowing sci-fi effects, anything hard to read at a glance ("one glance tells me everything").

## Tokens (built 2026-11-07, step 3.2 waits for Ivan's yes)
- Surface: Operate (scan, not persuade). Light by default, dark by switch (D20); stored choice `hub-theme`.
- Colours (OKLCH, in tools/dashboard/public/style.css): cool neutral page, white cards, one accent (deep blue, lighter in dark), amber only for "waiting on you" and stale handoffs, green only for "Manager running".
- Type: system UI stack (Segoe UI Variable first), 15px base, tabular numbers; no display face.
- Shape: 12px radius cards, 1px lines, soft two-layer shadow; progress bar 6px.
- Pictures: docs/screenshots/ (sample data).

## Motion
- Level: none beyond 150 ms hover/switch transitions; reduced-motion respected. A small "listening" indicator only if the voice track needs it.

## Verification
- playwright-cli screenshots at laptop size (1280) and one narrow check (375) even though it is a PC page; no console errors.
