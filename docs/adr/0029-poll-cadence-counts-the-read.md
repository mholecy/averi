# 29. The poll cadence counts the read

Status: accepted 2026-10-31 (performance backlog row D1, docs/plans/2026-10-30-performance-backlog.md; the
orchestrator's decision on the owner's standing: fast AND stable). Implemented on `perf/d1-poll-cadence`.

## Context

- `ui-tree/read-tree.ts#pollTree` is the one tree-side deadline loop: the settle wait of every tap, fill and flow step
  (`interact/resolve.ts#resolveSettled`), the asserts (`Verifier.poll`, `verify/pixel-poll.ts#pollPixels`), the flow
  engine's waits and its state-detect probe. Each round reads the tree once, runs the predicate, checks the deadline,
  and then slept the whole `pollMs`.
- So a read's own cost was added to the cadence on top of the pause. On idb (~167 ms a read) a 500 ms poll was a
  ~667 ms one. On Android a `uiautomator dump` waits for the app to go idle and takes 2.2–2.5 s (D0's baseline: 87 %
  of a tap), and the 500 ms (300 ms for the asserts) was slept after it anyway: two dumps that already lay more than
  2 s apart were pushed further apart, and every settle and every pixel round paid it.

## Decision

**`pollTree` sleeps `max(0, pollMs − read duration)`: consecutive reads start at least `pollMs` apart, rather than
`pollMs` after the previous read ends.**
- The duration is that of the READ alone — the `uiTree` call, a failed one included — timed on `Date.now()`, the clock
  the deadline already uses. The predicate's time is never subtracted: the color and ocr predicates capture a settled
  frame of their own, up to 1.5 s, and letting that eat the pause would shrink the gap between the two TREES a settle
  compares.
- The deadline rule is unchanged: checked after each round, never before a read, so the read that starts inside the
  deadline is still taken and a late element is still found by it.
- Value polls and the clear's waits are unchanged: `interact/fill-type.ts#pollValue`, the clear's re-read sleep, and
  every other fixed sleep (the focus delay, the keyboard hide delay, the capture's stability delay, the post-swipe
  pause) keep their whole length.
- `resolveSettled` has no loop of its own (it is a `pollTree` predicate plus, on a run of one, one immediate late
  read), so it takes the rule with no change of its own; its proof is the two-equal-reads proof argued below.

## Why it is safe

- The settle proof is "the same rect on two consecutive reads". A read slower than `pollMs` already spans the
  stillness interval on its own: with no pause, two Android dumps are still more than 2 s apart, further than two idb
  reads ever were under the old cadence. A read faster than `pollMs` still waits out the rest of it, so two reads that
  agree began at least `pollMs` apart — the interval the proof was always argued on.
- The pixel asserts' region-only settle (a second read confirming the rect, `verify/pixel-poll.ts`) is the same proof,
  and its captures run inside the predicate, so they are not counted against the pause.
- Nothing becomes faster than the device: the gap collapses to 0 only when the read itself took longer than the poll.

## Risks accepted

- (R1) Rounds are denser on a slow device: within the same budget a poll takes more reads (Android: one every ~2.3 s
  instead of every ~2.8 s). More reads are more chances to find the element; the device is busy dumping either way.
- (R2) A deadline that the old pause pushed the last read past now lands differently: an element that appears just
  before the deadline may be caught a round earlier, or the extra round the old pause bought past the deadline may not
  be taken. The slack rule itself (one read past the deadline at most) is unchanged.
- (R3) Tests that pin the settle pause as an exact `pollMs` now need a deterministic clock: on a real clock a fake read
  that straddles a millisecond tick shortens the pause by 1. The files that pin it (`tests/interact/keyboard-*.test.ts`,
  two tests of `tests/interact/fill.test.ts`) fake Date, as `tests/helpers/sleep-recorder.ts` already does.

## Measured

Before/after on the D0 harness (`scripts/perf/baseline.ts`, Android, averi_lab API 33): to be added.
