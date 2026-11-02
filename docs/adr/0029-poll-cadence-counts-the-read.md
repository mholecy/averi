# 29. The poll cadence counts the read

Status: accepted 2026-10-31 (performance backlog row D1, docs/plans/2026-10-30-performance-backlog.md; the
orchestrator's decision on the owner's standing: fast AND stable). Implemented on `perf/d1-poll-cadence`: `220b4eca`
(the read counted), `3e551237` (the 150 ms floor, R2 pinned), `57017e11` (the rule named `pauseAfterRead`); this
record `bbfb0244`, `fa1cdedf` and the measurement below.
Amended 2026-11-02 (D35, loop L5): the settle's `pollMs` defaults to the adapter's `settleCadenceMs` (ADR 0040);
`pauseAfterRead` is unchanged.

## Context

- `ui-tree/read-tree.ts#pollTree` is the one tree-side deadline loop: the settle wait of every tap, fill and flow step
  (`interact/resolve.ts#resolveSettled`), the asserts (`Verifier.poll`, `verify/pixel-poll.ts#pollPixels`), the flow
  engine's waits and its state-detect probe. Each round reads the tree once, runs the predicate, checks the deadline,
  and then slept the whole `pollMs`.
- So a read's own cost was added to the cadence on top of the pause. On idb (~167 ms a read) a 500 ms poll was a
  ~667 ms one. On Android a `uiautomator dump` waits for the app to go idle and takes 2.2–2.5 s (D0's baseline: 87 %
  of a tap), and the 500 ms (300 ms for the asserts) was slept after it anyway: every settle and every pixel round
  paid it.

## Decision

**`pollTree` sleeps `min(pollMs, max(SETTLE_FLOOR_MS, pollMs − read duration))`, with `SETTLE_FLOOR_MS` = 150:
consecutive reads start about `pollMs` apart, rather than `pollMs` after the previous read ends, and never less than
the floor apart (for a `pollMs` at or above it).**
- The duration is that of the READ alone — the `uiTree` call, a failed one included — timed on `Date.now()`, the clock
  the deadline already uses. The predicate's time is never subtracted: the color and ocr predicates capture a settled
  frame of their own, up to 1.5 s, and letting that eat the pause would shrink the gap between the two TREES a settle
  compares.
- The floor (`SETTLE_FLOOR_MS`, exported beside `pollTree`) keeps two reads from ever running back to back. A `pollMs`
  below it is slept whole: the pause is never longer than the caller's cadence, and `min(pollMs, …)` also keeps a clock
  that steps backwards mid-read from lengthening it.
- The deadline rule is unchanged: it is checked after each round, never before a read, so the next read is still
  taken when a round ends inside the deadline. Where that last read starts relative to the deadline moves with the
  cadence (R2).
- Value polls and the clear's waits are unchanged: `interact/fill-type.ts#pollValue`, the clear's re-read sleep, and
  every other fixed sleep (the focus delay, the keyboard hide delay, the capture's stability delay, the post-swipe
  pause) keep their whole length.
- `resolveSettled` has no loop of its own (it is a `pollTree` predicate plus, on a run of one, one immediate late
  read), so it takes the rule with no change of its own; its proof is the two-equal-reads proof argued below.

## Why it is safe

The settle proof is "the same rect on two consecutive reads". What it compares is two SNAPSHOTS — the moment each
read captured the screen — and a read's cost says nothing about where inside the read that moment fell. The bound on
the gap between two snapshots, per source:
- **Android** (`uiautomator dump`): each dump snapshots after its own idle wait of at least a second (AOSP's
  `DumpCommand` calls `waitForIdle(1000, 10000)`; the source, not measured here), so two snapshots are ≥ 1 s + 150 ms
  apart, larger than the gap idb ever had.
- **idb** (`describe-all`, ~167 ms): the read is shorter than the poll, so the remainder is slept; two snapshots are
  at least `pollMs − r₁` apart (r₁ the first read's cost), typically ≈ `pollMs`, the interval the proof was always
  argued on.
- **WDA** (`/source`, 0.3–1.7 s): the snapshot may fall anywhere in the read. A slow read is followed by the floor
  alone, so two snapshots are at least 150 ms plus whatever of the two reads lies between them apart. Residual: on WDA
  two snapshots as close as ~150 ms may agree on an element moving too slowly to show a change in that time; without
  the floor they could have been milliseconds apart.

Why 150 ms: the settle proof already accepts two snapshots about that close — `resolveSettled`'s run-of-one late read
(`interact/resolve.ts`, the `run === 1` branch) reads again back to back, ~167 ms apart on idb, and takes the same
rect as settled; it is nine frames at 60 Hz — an element in visible motion moves between two snapshots that far
apart; and it is small beside the read it follows on the slow sources, so the saving survives (an Android round pays
150 ms where it paid 500). It is a judgement, not a measurement.

The pixel asserts' region-only settle (a second read confirming the rect, `verify/pixel-poll.ts`) is the same proof,
and its captures run inside the predicate, so they are not counted against the pause.

## Risks accepted

- (R1) Rounds are denser on a slow device: within the same budget a poll takes more reads (Android: one every
  ~2.45 s instead of every ~2.8 s). More reads are more chances to find the element; the device is busy dumping
  either way.
- (R2) The last read moves. The deadline is checked after each round. Under the old cadence the whole pause pushed the
  last read's start up to `pollMs` later — past the deadline, by chance of where the rounds fell — and that read
  sometimes found an element that appeared late. Now an element appearing at 2.5 s of a 3 s budget behind 1 s reads
  under a 300 ms poll is read at 0, 1.15 and 2.3 s, and the poll times out at 3.3 s, where the old cadence's read at
  2.6 s found it (pinned as the accepted residual in `tests/ui-tree/read-tree.test.ts`). Neither cadence guaranteed
  finding an element that appears during the last read. The cure — always one more read starting at or after the
  deadline — would cost a full read on every timeout, `ensure_state`'s detect probe included, so it is not taken.
- (R3) Tests that pin the settle pause as an exact `pollMs` at or above the floor need a deterministic clock: on a real
  clock a fake read that straddles a millisecond tick shortens the pause by 1. The files that pin it
  (`tests/interact/keyboard-*.test.ts`, two tests of `tests/interact/fill.test.ts`) fake Date, as
  `tests/helpers/sleep-recorder.ts` already does.

## Device measurement

2026-10-31, averi_lab AVD (Android 13, API 33), native app, `scripts/perf/baseline.ts --platform android --device
emulator-5554 --scenarios tap,fill,ensure-cold,ensure-warm,color --repeat 5`, the branch's base `429da60d` against
`57017e11` (D1 alone). Medians, ms (host load 2.6–4.1 on the base run, 1.7–3.0 on the branch's):

| scenario | wall before | wall after | Δ wall | slept before | slept after | uiautomator dumps |
|---|---|---|---|---|---|---|
| tap | 5243 | 4976 | −267 | 502 | 152 | 2 → 2 |
| fill, 3 chars | 11706 | 11455 | −251 | 1761 | 1412 | 4 → 4 |
| ensure_state cold | 14291 | 13979 | −312 | 804 | 454 | 5 → 5 |
| ensure_state warm | 3383 | 3456 | +73 | 302 | 302 | 1 → 1 |
| color assert | 3381 | 3621 | +240 | 302 | 302 | 1 → 1 |

- Every scenario whose settle polls a second read saves the 350 ms the rule predicts (`read-tree.ts`'s sleep 500 →
  150 ms, once per call); its wall moves by −250 to −310 ms, within the dumps' own spread (±100–200 ms a dump).
- The color assert and the warm `ensure_state` read the tree once and never pause in `pollTree`: their sleeps are
  identical, and their wall difference is the device's (dump ms 2251 → 2375 and 2270 → 2290), not the rule's.
- The device calls are the same in number on every scenario: no extra read, no read lost.
- Live golden, `scripts/truth/live.ts --serial emulator-5554` (the `forms` group), base and branch: 32 cases each,
  27 ok, 2 LOUD (b1d, b7: `adb input text` refuses the non-ASCII characters, known), 3 SKIP (kf1–kf3: Gboard came up
  docked), 0 mismatches — every verdict the same case for case.

Raw runs: the session's `scratchpad/d1-live/` (baseline-base/branch .json and .log, live-base/branch .log).
