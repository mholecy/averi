# 33. A held rendered "no" ends the second look before a cheap rung

Status: accepted 2026-10-31 (performance backlog row D2, docs/plans/2026-10-30-performance-backlog.md, section "D2 and
D11 analysed"; the orchestrator's decision, variant A). Implemented on `perf/d2-held-no`.

## Context

- `ensure_state`'s ladder (`flow/engine.ts#ensureStateLadder`) probes the state with ONE read before its first rung.
  When that probe is BARE — every tree it read was a cold launch's decor or splash (`ui-tree/bare-tree.ts`) — or, before
  a destructive rung, learned nothing at all, it gets a SECOND LOOK: `detects` polled over `ensureTimeoutMs` (20 s by
  default; ARCHITECTURE.md, "…and it never wipes blind" and "…and a bare tree decides no condition";
  docs/bugs/2026-10-06-second-look-reads-android-decor-as-not-in-state.md).
- That look ended only on "yes". A window whose reads turned rendered but outside the state answered "no" — correctly
  — but only at its deadline, as every detect window does. So a bare cold launch that settled on a screen which is not
  the state (a login screen for `logged_in`) polled the whole 20 s before a CHEAP rung that could have run ~2 s after
  the screen appeared. D0 never hit it (the lab app renders fast and both ensure scenarios start on a rendered screen);
  the backlog's estimate is ~15–17 s per such ensure on a fast app.
- The full window was chosen (2026-10-07) for the DESTRUCTIVE case: a cold launch's decor or splash, and a loading
  screen, must not be read as "not in state" and lead to a wipe. Before a cheap rung the stakes are a relaunch or a tap,
  and the entry probe already runs a cheap rung at once on ONE rendered "no" read.
- The ladder already has a "a screen has landed" budget: `reachRecheckMs` (2 s), the grace window a rung's re-check
  polls before escalating. `ui-tree/read-tree.ts#treeFingerprint` already says "this read is the same screen as that
  one" for `scroll_until`.

## Decision

**Before a CHEAP (non-destructive) rung, the second look also ends — answering `no` — once a rendered tree outside the
state has held the same `treeFingerprint` across fresh reads spanning at least `reachRecheckMs`. Then the rung runs.
Before a DESTRUCTIVE rung the second look keeps its full window, exactly as before.**

- The seam is `detects`' `hold` option, passed only at the second-look call site and only when the rung is not
  destructive (`flowItselfIsDestructive`). Without it a `no` waits for the deadline as before.
- The hold starts at the first rendered not-"yes" read with a given fingerprint and is checked on each later read: the
  same fingerprint at least `hold` ms after it started ends the look. A different fingerprint starts a new hold; a BARE
  read clears it (the screen went back to decor — it did not hold). A failed read between two equal ones neither breaks
  it nor is counted as a read.
- A rendered tree that shows a progress indicator (`ui-tree/read-tree.ts#showsProgress`: a `progress` node with area —
  Android's ProgressBar, Compose's progress indicators) never starts or continues a hold: for the hold it is a bare
  read, and clears it. It still counts as rendered — the look's answer at its deadline is `no`, as before. A spinner
  keeps a fixed rect and no text, so its screen keeps one fingerprint while it loads; it is the one loading screen
  that says so, and the rule costs nothing on a screen that does not. (The coordinator's decision before review,
  2026-10-31.)
- A look the hold ended writes one trace line, right before the rung: `state <name>` — `second look: not detected, the
  screen held still <s> — running <rung> before the <ensureTimeoutMs> window's end`, so a rung that runs seconds
  before the deadline is not read as a look cut short for no reason. A `no` at the deadline writes none, as before.
- A handed-on read (ADR 0030) never counts toward the hold: in `detects` it may answer `yes` and nothing else, as before.
  The second look is not handed a read today; the rule holds if it ever is.
- Bare and unknown answers are unchanged: a look whose every tree was bare still answers `bare` at its deadline (a cheap
  rung then runs, a destructive one is refused), one that read no tree still answers `unknown`.
- A state that appears inside the hold ends the look "yes" — "already active", or "reached after" the previous rung —
  as before.
- The rung's re-detect after a rung (its grace window, `reachRecheckMs`) gets no hold: it is not a second look, and its
  window IS the hold, so a hold could never end it sooner. When it answers bare, the next turn of the loop gives the
  next rung the second look — with the hold if that rung is cheap.

## Why destructive rungs keep the full window

The second look exists because a wipe on a screen that is still drawing cannot be taken back (the 2026-10-06 incident:
three of three runs wiped an app that was already logged out). A rendered loading screen keeps one fingerprint while it
waits; the hold sets aside those that show a spinner (`read-tree.ts#showsProgress`), but a "Loading…" label or a
skeleton says nothing a tree can read, so a 2 s hold cannot tell "settled outside the state" from "still loading, about
to become the state". Before a rung that
costs a wipe and a login, 20 s of polling is the cheaper mistake.

## Risk accepted

A rendered loading screen WITHOUT a progress indicator — a "Loading…" label alone, a skeleton of placeholder boxes, a
static splash drawn as a rendered screen, an indicator a tree source does not report as `progress` — that holds still
for `reachRecheckMs` before a CHEAP rung ends the look as "no" (one with a spinner never holds, above): the rung runs
on it — a wasted relaunch or tap — or fails, and the ladder judges its next rung as after any failed rung (the re-check
first; the state reached there ends the call). This is the risk the entry probe already accepts on ONE read: a cold
launch already rendered on a loading screen answers "no" at once and runs a cheap rung with no second look at all. The
hold asks more of the screen than the entry probe does (reads spanning 2 s, one fingerprint), not less.

## Consequences

- A cold launch that settles on a rendered screen outside the state reaches its cheap rung ~`reachRecheckMs` after that
  screen appears, not at `ensureTimeoutMs` — up to ~18 s saved per such ensure (device-unmeasured; proven in fakes,
  tests/flow/bare-tree-ladder.test.ts, "the second look before a CHEAP rung ends on a held rendered 'no' (D2)").
- The second look's held "no" writes one trace line (above); a rendered "no" at the deadline still writes none.
- Changing `reachRecheckMs` now changes two windows: the re-check after a rung and the hold before a cheap one.
