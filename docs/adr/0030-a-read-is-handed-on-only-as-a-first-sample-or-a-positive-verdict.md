# 30. A read is handed on only as a first sample or a positive verdict

Status: accepted 2026-10-31 (performance backlog row D3, docs/plans/2026-10-30-performance-backlog.md, "Next (decided
2026-10-31 …)"; the orchestrator's decision on the owner's standing: fast AND stable — acting on a stale or still-moving
tree is unacceptable). Implemented on `perf/d3-read-handoff`: `844076de`
(the hand-off, `pollTree`'s first round, the settle's first sample), `a77c1451` (the asserts), `9461eee8` (the engine,
the `verify` leg, ARCHITECTURE.md §8); the device measurement follows.

## Context

- One `uiautomator dump` costs 2.2–2.5 s on Android (D0: 87 % of a tap, 86 % of a cold `ensure_state`). Within one
  tool call the engine reads the tree again where nothing has happened since the last read. D0's cold ensure: the
  rung's closing `wait:` read `yes` at 8511 ms, then the ladder's re-detect read the same screen at 10732 ms.
- The same shape: an assert after an assert (each `Verifier` assert polls from a fresh read), a tap after a `wait:`
  (the settle's first read is the screen the wait just read), the first element assert of a `verify` leg after the
  state's detect answered `yes`.
- A transparent cache under `uiTree` was rejected. It would answer the settle's SECOND read too, and two reads of one
  snapshot agree by construction: `resolveSettled`'s "same rect on two consecutive reads" would pass on an element
  still moving. The same for an absence: an old tree without the element says nothing about now.

## Decision

**A read is handed on only as a first sample or a positive verdict — never as a stability proof, a pixel locator or
an absence.** `ui-tree/read-handoff.ts#ReadHandOff` keeps the last read; a poll asks for it by name, once.

- **Eligible read**, all of: taken inside a PRODUCER (`ReadHandOff.producing`: the engine's detect probe, a `wait:`
  step, every `Verifier` assert); no action since the read STARTED; at most `HANDOFF_MAX_AGE_MS` (1 s) since it ENDED
  when taken. Any read outside a producer, and any failed read, empties the slot: what is kept is the last read or
  nothing.
- **Actions**: the adapter is wrapped (`ReadHandOff.watch`, a Proxy) and every DeviceAdapter member is classified in
  `ADAPTER_SURFACE`, an exhaustive `Record<keyof DeviceAdapter, …>` — a new member fails to compile until classified.
  `uiTree` is the kept read; `screenshot`, `viewport`, `focusedWindow`, `keyboard` (its oracle's queries), `logs`,
  `isAppRunning` are reads that leave it standing; `install`, `launch`, `terminate`, `openDeepLink`, `tap`,
  `longPress`, `swipe`, `typeText`, `clearText`, `pressKey`, `dispose` — and any method the interface does not
  declare — bump an epoch before and after they run.
- **One-shot**: `take` empties the slot whatever it returns. The keyboard guard's re-look inside the same tap, the
  next assert, the late read of a run of one: all read fresh.
- **`pollTree(opts.first)`**: the handed tree is round zero. Only a value ends the poll on it. A miss, a PollMiss (its
  detail is not kept), `Undecided` or a predicate's throw is discarded; `treesRead`, `lastTree` and `undecidedTree`
  count fresh reads only; the deadline is not checked, so at least one fresh read always follows; that read starts
  as if the handed read had been this poll's previous round (`pauseAfterRead` of its duration, less what has passed
  since it ended, ADR 0029). A predicate that keeps a tally across rounds is told `handedOn` and keeps the handed
  round out of it.
- **Takers**:
  1. The ladder's re-detect after a rung (`detects(state.detect, grace)`), as a `yes` only, and only when the
     detect asks no absence (`flow/condition.ts#asksAbsence`, through the states it names). The handed round never
     counts as rendered or bare, so the probe's `no`/`bare`/`unknown` — what the ladder escalates and refuses a wipe
     on — rest on fresh reads.
  2. A `Verifier` element assert (present, with or without `text`/`match`/`error`), as a pass only. Never `absent`,
     `rect`, `color`, `ocr` or `screenshot`.
  3. A flow's `tap:` and `fill:` (and a `type_pin` keypad key), as the settle's FIRST sample: `resolveSettled`
     takes the handed rect as the one the first fresh read must match; it is not a sighting, not a run, and never
     the tree returned. So the settle always needs one fresh read that agrees with it.
- **Producers**, so where a taker can find one: the detect probe — the entry probe, the second look, the post-rung
  re-detect, the salvage and recovery probes (the entry probe's read → the rung's first tap; a re-detect's `yes` →
  the flow's first tap or, in `verify`, the leg's first element assert) — a `wait:`, an assert. The ladder's final
  wait for the state after the last rung (`waitFor`, an engine poll outside `detects`) is not a producer: a state
  reached only there hands nothing on.
  The detect probe as a producer is one step beyond the brief's list (a tap after a `wait:`/`assert:`); its read is
  the same kind — a look at a screen with no action since — and its taker is the same first sample.
- **Scope**: one per engine run (`FlowEngine.run`), shared with that run's `assert:` steps; one per `Verifier`; one per
  `verify` leg, shared by its engine run and its asserts (`run/verify.ts`). Never module-level, never across tool
  calls: the agent acts between two calls and nothing here sees it. Not taken: the entry probe, the second look,
  the salvage and recovery probes, a `wait:`, a `branch:`, an `optional:` probe, `scroll_until`, the final frame.

## Why it is safe

Each use is one of two things.
- **A positive verdict seen after the last action.** The ladder's detect and an element assert are polls for
  something to be TRUE. A `yes` on a tree read inside a producer, with no action since, is the same evidence the
  producer itself acted on — the `wait:` already returned on it. The fresh read it replaces would have been one more
  sample of the same screen, ~2.3 s later; it could not have made a `yes` truer, only caught a screen that changed
  by itself since (R1). A `no` is never taken: an absence, a miss, a bare tree all read fresh.
- **A first sample whose fresh second read must agree.** The settle proof is two snapshots at one rect. The handed
  snapshot is OLDER than the first read it replaces, so the two are further apart than ADR 0029's argued gap, never
  closer: on Android a dump snapshots after its ~1 s idle wait inside a ~2.3 s call, so the handed snapshot is ≥
  ~1.3 s before the handed read ended and the fresh one ≥ 1 s after the fresh read starts; on idb and WDA the pause
  rule gives the fresh read at least the floor after the handed read ended, plus whatever of either read lies
  between the snapshots. An element that moved in between fails the comparison and needs a second fresh read
  (pinned). The tree the tap acts on is always the fresh one.
- **The tap point is never handed.** The guard's keyboard reading (on iOS the band is in the tree), the judgement's
  screen and the point come off the fresh settled tree, so a keyboard that rose after the handed read is seen.

## Residual accepted

- (R1) A positive verdict is up to ~2.3 s + the 1 s bound older than the fresh read it replaces (Android). A screen
  that changes by itself in that time — a state detected on a splash that then navigates away with no action — is
  reported reached where a fresh read might have seen the next screen. The producer's own `yes` already rested on
  that read; the old fresh re-detect was one more sample, not a proof of persistence.

- (R2) Concurrent tool calls on one device. The hand-off sees only actions through its own run's adapter: an MCP
  `tap` sent while a `verify` or `run_flow` call is running acts on the raw adapter, and the run may then hand on a
  read taken before that tap. This is the race every read-then-act already has between two concurrent calls (the
  run's own fresh read could have been taken just before the other call's tap), widened by at most the 1 s bound plus
  the handed snapshot's age within its read. Calls on one device are not meant to overlap; nothing here serializes
  them.

## Costs accepted

- (C1) A handed round that does not decide pays the pause before the fresh read where there was none: a 0 ms detect
  window (the last rung's re-detect) on Android ~150 ms less the few ms since the read ended; on idb up to pollMs −
  the read (~333 ms under the engine's 500). Paid only when the rung's last read does not answer the detect.
- (C2) One extra predicate evaluation per handed round (CPU, sub-millisecond on a lab tree).
- (C3) Every adapter call in an engine run, a Verifier and a `verify` leg goes through a Proxy.

## Expected gain

One dump per eligible read on Android, ≈ 2.3 s: cold `ensure_state` (launch, tap, wait, re-detect) 5 → 4 dumps; a
flow `tap:` after a `wait:`/assert/detect 2 → 1 dump; each element assert after an assert, and a `verify` leg's first
element assert after its state's detect. The MCP `tap` tool, a warm ensure and the color assert are unchanged (one
call, no producer before them).
