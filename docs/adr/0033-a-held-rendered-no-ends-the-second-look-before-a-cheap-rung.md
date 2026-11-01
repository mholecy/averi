# 33. A held rendered "no" ends the second look before a cheap rung

Status: accepted 2026-10-31 (performance backlog row D2, docs/plans/2026-10-30-performance-backlog.md, section "D2 and
D11 analysed"; the orchestrator's decision, variant A). Implemented on `perf/d2-held-no`
(938a8426, 3ab677f3, 52cb2e41, 04ec6000, d0efd6f0, a883e09a), merged 11cb9064. Amended 2026-10-31 (D27: WDA
`ActivityIndicator` → `progress`, so a React Native spinner stops a hold — the D27 sub-bullet below; commits 4b5e254f,
8a4efe1b, 021fade0 and 8999f3ff, merged e26fa898). Amended 2026-11-01 (A7): both checks now live in one module — the
last section.

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

**The second look also ends — answering `no` — once a rendered tree outside the state has held the same
`treeFingerprint` across fresh reads spanning at least `reachRecheckMs`, but only when NO WIPE LIES AHEAD: the rung
about to run and every rung after it are non-destructive under the transitive predicate, and no enclosing ladder has a
destructive rung after the rung that led into this one. Then the rung runs. Everywhere else the second look keeps its
full window, exactly as before.**

- "No wipe ahead" (amended 2026-10-31 after the round-1 review, below) is two checks at the second-look call site:
  - `!state.reach.slice(i).some(r => flowIsDestructive(cfg, r))` — `flow/config.ts#flowIsDestructive`, the recovery
    pass's predicate, which follows a flow's `requires:` into the required state's whole ladder (and calls a cycle or
    an unknown flow destructive). So a cheap rung whose `requires:` can reach a `clearState` login holds nothing.
  - `wipeAhead === 0` — an engine counter raised while a rung runs whose own ladder has a destructive rung after it
    (`state.reach.slice(i + 1)`, same predicate). A cheap ladder entered through that rung's `requires:` (`outer:
    [via_inner, fresh_launch]`, `via_inner.requires: inner`, `inner: [cheap]`) would otherwise hold, fail its cheap
    rung on a loading screen, and hand the outer ladder the same immediate wipe as below.
- The hold is `flow/hold-tracker.ts#holdTracker(holdMs)`, a pure state machine shown each fresh not-"yes" read with a
  timestamp (`observe(tree, nowMs)`; `tree` is undefined for a read that failed); `detects` gets it through its
  `holdMs` option. The run starts at the first rendered read with a given fingerprint; the same fingerprint at least
  `holdMs` after it started ends the look. A different fingerprint starts a new run; a BARE read clears it (the screen
  went back to decor — it did not hold); so does a FAILED read (the code review, 2026-10-31: the same tree before and
  after reads that saw nothing did not provably hold across them — "held across reads spanning `holdMs`" means reads
  that each saw it). `pollTree` never shows its predicate a failed read, so with a hold `detects` reads through a thin
  wrapper of the adapter that shows the tracker each read that threw.
- A rendered tree that shows a progress indicator (`ui-tree/read-tree.ts#showsProgress`: a `progress` node with area —
  Android's ProgressBar, Compose's progress indicators, an iOS `ProgressIndicator`, and through WDA an iOS
  `ActivityIndicator` since D27) never starts or continues a hold:
  for the hold it is a bare read, and clears it. It still counts as rendered — the look's answer at its deadline is
  `no`, as before. A spinner keeps a fixed rect and no text, so its screen keeps one fingerprint while it loads; it is
  the one loading screen that says so, and the rule costs nothing on a screen that does not. (The coordinator's
  decision before review, 2026-10-31.)
  - The gap this decision shipped with, backlog row D27 — closed 2026-10-31: on iOS through WDA an XCUI
    `ActivityIndicator` — React Native's ActivityIndicator — read as `other`, not `progress`, and did NOT stop a hold
    there. `adapters/wda-source.ts`'s role map now makes it `progress` (WDA only: no idb capture shows idb's spelling
    of a UIActivityIndicatorView, so through idb it may still read `other`).
    Residual, by decision (D27 review): an invisible or off-screen spinner also counts as loading — a covered layer's
    0/0 indicator, a list footer's spinner below the viewport — safe direction, bounded by `ensureTimeoutMs` /
    `maxSwipes`.
- A look the hold ended writes one trace line, right before the rung: `state <name>` — `second look: not detected, the
  screen held still <s> — running <rung> before the <ensureTimeoutMs> window's end`, so a rung that runs seconds
  before the deadline is not read as a look cut short for no reason. A `no` at the deadline writes none, as before.
- A handed-on read (ADR 0030) is never shown to the hold: in `detects` it may answer `yes` and nothing else, as before.
  The second look is not handed a read today; the rule holds if it ever is.
- Bare and unknown answers are unchanged: a look whose every tree was bare still answers `bare` at its deadline (a cheap
  rung then runs, a destructive one is refused), one that read no tree still answers `unknown`.
- A state that appears inside the hold ends the look "yes" — "already active", or "reached after" the previous rung —
  as before.
- The rung's re-detect after a rung (its grace window, `reachRecheckMs`) gets no hold: it is not a second look, and its
  window IS the hold, so a hold could never end it sooner. When it answers bare, the next turn of the loop gives the
  next rung the second look — with the hold if no wipe lies ahead of it.

## Why the full window stays wherever a wipe lies ahead

The second look exists because a wipe on a screen that is still drawing cannot be taken back (the 2026-10-06 incident:
three of three runs wiped an app that was already logged out). A rendered loading screen keeps one fingerprint while it
waits; the hold sets aside those that show a spinner (`read-tree.ts#showsProgress`), but a "Loading…" label or a
skeleton says nothing a tree can read, so a 2 s hold cannot tell "settled outside the state" from "still loading, about
to become the state". Before a rung that costs a wipe and a login, 20 s of polling is the cheaper mistake.

The first version of this decision guarded only the destructive rung ITSELF (`flowItselfIsDestructive` of the rung
about to run). The round-1 review (2026-10-31) reproduced the hole: `logged_in: reach: [dismiss_prompts (an optional
tap), fresh_launch]`, a cold launch of decor → a rendered "Loading" label with no progress node → login_screen. The
hold ended the look on the label, `dismiss_prompts` ran, and its re-check read the same label as a RENDERED "no" — not
bare, so no second look follows — and `fresh_launch` wiped at once: WIPES 1, where 2f431be7 waited the window out and
answered "already active", WIPES 0. A hold before a cheap rung shortens the wait before every rung after it, not only
its own. The same holds for a cheap rung whose `requires:` reaches a destructive ladder, and for a cheap ladder entered
from a rung whose own ladder has a wipe after it.

Why this guard (static: "no destructive rung ahead") and not a time-based one (keep the destructive rung from running
before the first second look's original deadline, whatever ran in between):
- It is decided from the config alone, at the call site, by the predicate the recovery pass already trusts — no clock
  carried across rungs, nested ladders, salvage and the recovery pass. A ladder-wide deadline threaded through every
  window is the D11 shape the same analysis deferred for its blast radius.
- A time guard still runs the cheap rung on the loading screen and then waits anyway; the ladders that would gain from
  it are exactly those that end in a wipe, where the gain is a few seconds against a wipe if the guard has a gap.
- The cost is plain and accepted: a ladder that can end in a wipe — transitively — gives up the gain and polls the full
  window, exactly as before D2.

## Risk accepted

With NO wipe ahead, a rendered loading screen WITHOUT a progress indicator — a "Loading…" label alone, a skeleton of
placeholder boxes, a static splash drawn as a rendered screen, an indicator a tree source does not report as `progress`
(a React Native ActivityIndicator through WDA was one until D27 closed it, 2026-10-31, above; through idb its spelling is
unmeasured) — that holds still for `reachRecheckMs` ends
the look as "no" (one with a spinner never holds): the cheap rung runs on it — a wasted relaunch or tap — or fails,
and the ladder escalates to its next rung, also cheap by construction, or ends in its final wait (`ensureTimeoutMs`).
The worst case is therefore a wasted cheap rung or a failed call that a retry cures, never a wipe. It is NOT the same
risk as the entry probe's "no" on one read for an escalation into a wipe — that is why the hold is refused wherever a
wipe lies ahead (above).

## Consequences

- A cold launch that settles on a rendered screen outside the state reaches its cheap rung ~`reachRecheckMs` after that
  screen appears, not at `ensureTimeoutMs` — up to ~18 s saved per such ensure (device-unmeasured; proven in fakes,
  tests/flow/bare-tree-ladder.test.ts, "the second look before a CHEAP rung ends on a held rendered 'no' (D2)", and
  tests/flow/hold-tracker.test.ts) — on ladders with no wipe ahead only. A ladder that ends in `clearState` (the common
  `logged_in: [cheap, login]` shape, if its login wipes) keeps the 20 s.
- On Android a read is a `uiautomator dump` (~2.3 s each, the D3 figure in the performance backlog), so a 2 s hold is
  met by two identical consecutive reads: the read that starts the run and the next one, ~2.3 s later. On iOS (reads
  ~70–180 ms) it spans many reads.
- The second look's held "no" writes one trace line (above); a rendered "no" at the deadline still writes none.
- Changing `reachRecheckMs` now changes two windows: the re-check after a rung and the hold before a cheap one.

## Amendment: one owner for "is a wipe ahead?" (2026-11-01, backlog A7)

The two checks of "No wipe ahead" above — `wipeAhead === 0`, the engine counter, and `state.reach.slice(i)` under
`flowIsDestructive` — now live in `flow/wipes-ahead.ts#WipesAhead`: `noneAheadOf(rungs, i)` asks both,
`running(rungs, i, fn)` raises and lowers the count around a rung. The decision is unchanged.
