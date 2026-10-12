# 12. The pixel assert's residuals: no fresh size, the visible strip, one box (D4–D6)

Status: accepted, 2026-10-12 (owner).

## Context

Moving the pixel assert onto standing (`ui-tree/standing.ts#Scene`) could have taken three more tap rules with it:

- the fresh screen-size re-read;
- the cut-sliver refusal;
- judging in every box.

Each would change behaviour beyond the refactor.

## Decision

- **D4: no fresh re-read.** The pixel assert reads the device's size from the adapter's memo, never afresh. The tap's
  `fresh` re-read (`interact/resolve.ts#refuseOffScreen`) stays the tap's alone.
- **D5: the visible strip.** A node cut by its scroll container is measured on what shows of it. The one exception is the
  ocr crop flush at the navigation bar (ADR 0009, N-b). Revisit when a second source of clip evidence appears.
- **D6: one box.** The pixel assert judges a single box, the usable screen's `oriented` one.

## Residuals accepted

- **D4.** After a fold or a `wm size` change, the pixel assert judges the old box. With a stale size, idb's band is drawn
  on the stale box too, because one screen source feeds the poll and the band. That one source made 64 elements fail
  closed: those lying between a stale tree's bottom and the device's. It is a safe tightening.
- **D5.** A cut text can be read as its visible strip.
- **D6.** On a screen whose turn is suggested but not witnessed (two `boxes`), the other orientation is never judged.
  Landscape is unmeasured.

## Bug note

No tracked note.
