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

- `Case.reads` is `{ betweenCalls?: true; swipes?: { drop?: readonly number[]; shorten?: Shorten }; late?: false }`: what a case reads around its
  calls. Unset is the forms' cycle. The carousel and visibility cases each carry it, a required field where
  live-carousel.ts and live-visibility.ts build them, beside their judges; `selectCases` only passes it on.
  tests/truth/live-reads.test.ts pins every selectable case of a group to what the loop inferred, with a list of
  exceptions that say why (lv-d62-drop, lv-d62-short, lv-d62-drop-two).
- A drop needs the stroke log, so it lives inside the log's field (`swipes: {}` logs, `swipes: { drop: [2] }` also drops): a
  drop with no log, once silently inert, cannot be written. `shorten: { stroke, px }` (T11, ADR 0013) lives there for the same
  reason: the stroke is sent only its first `px` px, averi handed back what it drew, and the log says both (`sentTo`). So
  `lv-d62-short` draws the short carry a device otherwise gives by its own mood, with no load on anything, in both device states seen (carry 94 or less 40 of 40), on its geometry: its premise of 94 px is the old line for that case's 142-px probe. `lv-d62-drop-two` drops strokes 2 and 3.
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
  to give. lc4' widens `launched` or judges it apart, which touches every judge; a made-up `LabState` handed to the judges
  is not an option;
- probably a teardown after a chooser, so the next case does not start over it. That is an inference, unmeasured.

A `Case.start` was built here for the first of these and deleted at review: it was a hypothetical seam, and its type could
not do the work (`adb` is not on `CaseLab`). T7b can add the start verb at the same price; widening `launched` costs more, as above.

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

## Amendment: T7b paid the price list (2026-11-09)

**Context.** "What T7b still has to add" above listed five items. T7b (backlog row T7, the chooser group,
`scripts/truth/live-chooser.ts`) built the group; this is what each item cost.

**Decision.**
- **The start verb for lc4'.** `Case.fromLauncher?: true`, beside `preDrag`: after the ordinary launch, `AndroidLab.toLauncher`
  force-stops the lab and presses HOME, then reads the HOME activity the device resolves (`cmd package resolve-activity
  --brief -c android.intent.category.HOME -a android.intent.action.MAIN`, read-only), kept as `focus.home`: the judges'
  premise is that activity focused before the calls. It is a step, not a read, so it is a field on `Case`, not on `reads`; on the iOS lab
  it is the case's SKIP. `CaseLab`'s Android shape gains `FocusLab` (`focus`, `toLauncher`, `back`); `adb` itself stays off
  it, so the 2026-11-06 objection to `Case.start` (its type could not do the work) does not apply.
- **The new read.** `CaseReads.focus?: true`, as this ADR prices a read: the declaration, `CaseRecord.focus`
  (`{ home?, before, between, after, teardown? }`) written by `caseRecord`, its reads in `runCase` (before the calls, between
  them, after the final state), and `CaseEvidence`, `judgeOn` and `DeviceLog.focus` for the judge. Each read is
  `AndroidLab.focus`: the window manager's `mCurrentFocus`/`mFocusedApp` lines and the `* Hist #n: ActivityRecord{…}` lines
  of `dumpsys activity activities`, raw. The grep and the parser (`frontOf` and `isChooser` in `scripts/truth/live-chooser.ts`) are the
  harness's own, not src's `CHOOSER_FOCUS_COMMAND` and `chooserInFocus`, so the oracle does not share the code it judges.
  A read taken mid-transition (`mCurrentFocus=null`) is taken again, 300 ms apart, 5 s at most (the last poll shortened),
  its wait recorded (`waitedMs`) and its first window read kept (`firstWindow`): the first live run read lc4'' 800 ms
  after monkey's return and found the ResolverActivity record still on the stack, gone about 1.3 s later together with
  the null focus (measured by hand). Each judge reads what it asks of the read it belongs to (review round 1): what averi's
  reply claims (`mFocusedApp`) on the first window read, what is left on the stack on the settled one, and a read that
  never settles leaves the stack unread (SKIP). The FocusRead type lives in lab-device.ts, the DeviceLog in
  live-cases.ts, so no type cycle runs through live-chooser.ts.
- **A first `state()` with no cell (T10).** Not needed: lc4' and lc4'' launch a cell first, so the state file exists, and
  after monkey's start the fresh process writes `cell: ""` (MainActivity.kt, `lab.none()`), which the judges quote but do
  not rest on. T10 stays open.
- **`launched` for lc4'.** Not widened: `launched` is the ordinary launch's state, which the app really wrote; the focus
  read before the calls is what says the launcher is in front (the judges' premise, else SKIP). No judge reads a made-up
  `LabState`, and no other judge changed.
- **The teardown.** Measured, not inferred: lc1 leaves the chooser in front every run. When the settled read after the
  calls names a chooser in front (`chooserInFront` in `scripts/truth/live-chooser.ts`), `runCase` presses BACK once (`AndroidLab.back`) after the verdict and its screenshot, reads the focus
  again into `focus.teardown`, and says so through `note` if the chooser is still there. lc1's teardown dropped it in all
  seven runs. A chooser on the stack but not in front is left: the next launch covers it, and ResolverActivity finishes on
  stop.

**Consequences.** `run-case.ts` (mutation scope) has three new branches, each pinned in tests/truth/run-case.test.ts over
`FakeAndroidLab`; the group's `reads` is pinned in tests/truth/live-reads.test.ts; the judges' rules in
tests/truth/live-chooser.test.ts over recorded device text; the seven live runs in tests/truth/t7b-records.test.ts.
