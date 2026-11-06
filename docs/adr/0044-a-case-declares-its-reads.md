# 44. A live case declares what it reads; one module runs it

Status: accepted 2026-11-06 (performance backlog row A11, docs/plans/2026-10-30-performance-backlog.md). Harness only.
Measured against the loop it replaces: two independent throwaway characterizations through fakes (8,733 runs, then 15,269
by the reviewer), both 0 differences, neither kept; the same ops, timers included; the `src` diff is empty. The live A/B on
the AVD was inconclusive for the carousel group (T11), and its records were deleted.

## Context

- The live device loop sat at the top of the CLI (`live.ts`), and no test ran it. D30, D67, D69 and T7a each added a phase
  to it.
- It inferred phases from three `c.group` branches: `logsSwipes`, the reads between calls, and the late read.
- The late-read rule was split between the loop (whether) and `judged` in `live-cases.ts` (how), and the record was built in
  two places, a skip's and a run's.
- T7b adds cases. lc1–lc3 and lc4'' are ordinary calls, but lc4' reaches its first screen from the launcher, by a verb the
  harness does not perform, so another phase was coming.

## Decision

**`runCase(case, source, rig)` in `scripts/truth/run-case.ts` runs one case on one source and answers its record and verdict.
What a case reads is declared on the case (`Case.reads` and three fields beside it), never inferred from its group.**

- `Case.reads` is `{ betweenCalls?: true; swipes?: { drop?: number }; late?: false }`: what a case reads around its
  calls. Unset is the forms' cycle. The carousel and visibility cases each carry it, a required field where
  live-carousel.ts and live-visibility.ts build them, beside their judges; `selectCases` only passes it on.
  tests/truth/live-reads.test.ts pins every selectable case of a group to what the loop inferred, with a list of
  exceptions that say why (lv-d62-drop).
- A drop needs the stroke log, so it lives inside the log's field (`swipes: {}` logs, `swipes: { drop: 2 }` also drops): a
  drop with no log, once silently inert, cannot be written.
- The reads before the calls keep their own fields on `Case`: `warmUp`, `preDrag`, `measuresPanel` (which also reads after
  them). So "what a case reads" is `reads` and those three.
- `c.group` selects a case and names it. No read of it remains in the cycle. A new read costs a field on the declaration,
  a field on `CaseRecord` and in `caseRecord`, and its read in `runCase`; one the judge must see also goes through
  `CaseEvidence`, `judgeOn` and the judge's parameters or `DeviceLog`. The loop infers nothing.
- The late-read rule's one home is `live-cases.ts`: `wantsLateRead` (whether), `judged` (how), `LATE_READ_MS`. Both take
  `CaseEvidence`, the fields as a record holds them, so a run and a rejudge pass the same shape.
- **`judged` judges a recorded `late` whatever the case declares today.** A record is what was read then. If `judged` also
  asked `reads.late`, a declaration changed later would turn over the verdicts of old records. The committed records hold
  no late read on a visibility or carousel case, so this is the safe reading rather than a live difference.
- `caseRecord` in run-case.ts is the one record builder. A skip and a run differ only in what they hand it.
- The rig is the interface: `lab`, `callTool`, `configFor`, `swipes`, and optionally `keepShot`, `note`, `pause`, `now`.
  The CLI keeps argv, selection, the loops over cases and sources, connect and close, printing, `--record`.
- `note` carries the two lines that must reach the run while the case is still going (a warm-up or a panel read that
  failed); a case can take a minute. The case's outcome line is the CLI's, from the returned verdict: a SKIP's line and a
  run's have the same format, so the CLI prints one.
- `CaseLab` tells the Android lab from the iOS one by `platform`, not by optional methods. A pre-drag and a panel read are
  the Android lab's, and tests/helpers/fake-lab.ts has both shapes.

## What T7b still has to add

This module does not make T7b ready. lc1–lc3 and lc4'' (ADR 0041's proposed cases) are ordinary calls after an ordinary
launch. The rest is new work:

- a start verb for lc4', which starts from the launcher, not from `lab.launch`;
- a new read for `mFocusedApp` and for no `ResolverActivity` being left, which `LabState` does not carry;
- a first `state()` with no cell: the lab app has not written, and the cycle assumes a state (T10);
- `CaseRecord.launched` and the judge's `launched: LabState` are required, and lc4' from the launcher may have no `LabState`
  to give, so a placeholder or a widened type is T7b's decision;
- probably a teardown after a chooser, so the next case does not start over it. That is an inference, unmeasured.

A `Case.start` was built here for the first of these and deleted at review: it was a hypothetical seam, and its type could
not do the work (`adb` is not on `CaseLab`). T7b can add what it needs at the same price.

## Considered

- **A list of phase functions on the case.** Each phase needs the state of the earlier ones (launched, replies, a
  pre-drag's stroke), so the shared context would be the loop's locals under another name. Refused: flags over one cycle
  read in order have more depth for what exists.
- **Printing through the rig for every line.** The outcome line needs nothing the returned run does not hold.
- **The config file written once, before the warm-up.** `configFor` stays called at the same two points, so nothing a
  server reads moves.

## Consequences

- The cycle has a test (tests/truth/run-case.test.ts): order, each read, each SKIP, the screenshot, no real sleep.
- The cycle still throws a raw TypeError when the app wrote no state and the judge reads it, as the old loop did. A test
  pins it; T10 is the row.
- A first verdict that asks for a late read now gets the case's stroke log, as `judged`'s does. The old loop asked without
  it. No case both logs strokes and takes a late read, so nothing changes today.
- run-case.ts joins the mutation run (ADR 0038): every device call sits behind the rig, its tests take milliseconds, and
  its branches are what this ADR protects. T2's runner.ts is the precedent for an orchestrator over a fake seam. ADR 0038's amendment says what that costs.
- iOS is unmeasured live here. The cycle has no iOS-only branch beyond a SKIP's words, and a fake of each shape runs it.
