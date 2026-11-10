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
  pins it; T10 is the row. (Superseded by the T10 amendment below: a named LOUD failure, the run goes on.)
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
  premise is that activity focused before the calls. It is a step, not a read, so it is a field on `Case`, not on
  `reads`; on the iOS lab it is the case's SKIP. Its premise is a focus read, so `fromLauncher` implies the focus reads
  in `runCase`, declared or not (a launcher start with no premise to judge cannot be written). `CaseLab`'s Android shape gains `FocusLab` (`focus`, `toLauncher`, `back`); `adb` itself stays off
  it, so the 2026-11-06 objection to `Case.start` (its type could not do the work) does not apply.
- **The new read.** `CaseReads.focus?: true`, as this ADR prices a read: the declaration, `CaseRecord.focus`
  (`{ home?, before, between, after, teardown? }`) written by `caseRecord`, its reads in `runCase` (before the calls, between
  them, after the final state), and `CaseEvidence`, `judgeOn` and `DeviceLog.focus` for the judge. Each read is
  `AndroidLab.focus`: the window manager's `mCurrentFocus`/`mFocusedApp` lines and the `* Hist #n: ActivityRecord{…}` lines
  of `dumpsys activity activities`, raw. The grep and the parser (`frontOf` and `isChooser` in `scripts/truth/live-chooser.ts`) are the
  harness's own, not src's `CHOOSER_FOCUS_COMMAND` and `chooserInFocus`, so the oracle does not share the code it judges.
  A read taken mid-transition (`mCurrentFocus=null`) is taken again, 300 ms apart, 5 s at most (the last poll shortened),
  its wait and first window read kept as one field (`settle: { waitedMs, firstWindow }`; review round 1's records keep
  both at the read's top, and `frontOf` reads either): the first live run read lc4'' 800 ms
  after monkey's return and found the ResolverActivity record still on the stack, gone about 1.3 s later together with
  the null focus (measured by hand). Each judge reads what it asks of the read it belongs to (review round 1): what averi's
  reply claims (`mFocusedApp`) on the first window read, what is left on the stack on the settled one. A read whose wait
  ran out with a chooser record still listed is a MISMATCH; with none listed, or an old record's unwaited read, the stack
  is unread (SKIP). The FocusRead type lives in lab-device.ts, the DeviceLog in
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

## Amendment: the carousel group reads the device's state around its cases (T16, 2026-11-10)

**Context.** The carousel group's verdicts depend on a state of the device no case declares: some sessions a 142-px
`input swipe` carries 135–146 px (fast), others 94 px or less one stroke in four or more (short). T11 found the short
state by accident and T12, T13 and T19 needed it labelled; each labelled its runs by hand, with
`docs/truth/live-records/t11-carousel-visible/raw/raw-strokes.mjs` and a per-folder `label-group.mjs`, outside `live.ts`.

**Decision.** A run-level read, not a case-level one: the state belongs to the device over the run, not to a case's calls.
- `readDevice` in `scripts/truth/device-state.ts` ports raw-strokes.mjs onto `AndroidLab` and live-carousel.ts's
  constants: per round, a fresh launch of `carousel-recycler-free` (`RECYCLER_FREE`; `AndroidLab.launch`, settled on the
  app's ready, then the script's own 1.5 s, `LAUNCH_SETTLE_MS`: the settle on ready is a floor, never a shorter wait),
  the carousel's offset read then (0 when the state file has none, the script's `off()??0`; an unreadable file fails
  the read), the probes' 440-px pre-drag (`preDragStroke`, `PRE_DRAG_PX`, 1.2 s to settle), then four raw 142-px, 300-ms strokes
  along the clip's mid-line from 80 % to 65 % of its width (lv-d62's first probe, the script's 824 → 682 at y 497), each
  carry the change of the state file's carousel offset 1.5 s after it, and the device's loadavg. Four rounds (T19's
  count; T11's final A/B read six); fewer than one is refused. Then the lab app's frames (`dumpsys gfxinfo`, reset after
  each launch; `parseGfxinfo`), the framework's `sys.system_server.start_count` (final-ab.sh's restart check) and the
  host's loadavg; the read ends, as the script does, with the lab app force-stopped.
- The frames are the last round's: its pre-drag and four strokes, read once per read. They are not comparable with T11's
  `frames-*.txt`, whose window was one pre-drag and one stroke in a launch of its own (final-ab.sh's `read_device`):
  four strokes and their settles put more frames, and more of them idle, into the percentiles. A Device line's p50 is
  compared with another Device line's, never with those files.
- `stateOf` is the T11/T19 rule exactly as T11's `final-ab/label-group.mjs`, T12's `label-group.mjs` and T19's
  `analyze.mjs` read it: every round's strokes pooled, short when one in four or more carried 94 px or less (the old
  line for lv-d62's 142-px probe, ADR 0013's T11 amendment), else fast. tests/truth/device-state-records.test.ts holds
  it to every label those scripts wrote into the T11 and T12 records.
- `live.ts` reads before the first case and after the last when the run is on Android and a carousel case is among the
  cases selected (`deviceLabelling`: the cases `--groups`, `--cases` and `--cells` leave, not the groups asked), into
  `RunRecord.deviceLabel` (`{ before, after }`), and `summarize` prints `Device: before <state> <short>/<strokes>, after
  … (frames p50 … → …)`, `DISAGREE — ` first when the two states differ, `, framework restarted (start count a → b)` last
  when the start count changed between the reads. A label never holds an error with both reads (a union type). A read
  that fails (adb, no carousel offset in the state file) leaves `{ error, side }` and `Device: unlabelled — <why>`; an
  after read that fails keeps the good before read beside its error (`{ error, side: 'after', before }`, printed `Device:
  before <state> (frames p50 …), unlabelled — after: <why>`), the evidence this label exists to keep; `deviceLabelling` is the one guard: nothing is read after a
  failure, the cases still run, and the exit code is untouched: a label, not a gate. A case that throws ends the cases
  without the after read: the record keeps `{ before }` and prints `Device: unlabelled — no read after the cases`.
  `--device-read none` skips both reads and records `{ error: 'not read (--device-read none)' }`, so the record still
  says it is unlabelled; live.ts checks the flag beside its usage check, before the lab guard, and refuses it with
  `--rejudge`, which reads no device. Any other run, and iOS, reads nothing and prints no line.
- The record's key is `deviceLabel`: `device` holds the device's name in two Android records of 2026-10, and
  `deviceState` holds label-group.mjs's labels, in another shape, in the T11 and T12 records. The Device line is the
  record's, not a case's: `--rejudge` prints it whatever groups its selection keeps, carousel or not. A record without
  the key prints none, so every committed record rejudges byte-identically (698 records, in the forms groups and in
  `visibility,dismissal,ensure,carousel,chooser`, base 3b811b28 against T16).

**Not yet run on a device.** `readDevice` has run only over a fake exec: the emulator was down when T16 was built, and
the smoke went to the owner's list, its record and log to be committed as
`docs/truth/live-records/t16-device-state/smoke-1.json` and `smoke-1.log.txt` (`live.ts --serial emulator-5554 --groups
carousel --cases lv-d62-control --record …`). The first live carousel run must confirm: `deviceLabel.before` and `.after` each hold
four rounds of four strokes with carries the state file gave (none NaN, none from a stale file), the pre-drag carrying
about 438 px, frames present (`dumpsys gfxinfo` prints the four lines `parseGfxinfo` reads on this AVD) and the start
count read; the `Device:` line printed under the summary and again, byte for byte, by `--rejudge` of the record; the
case between the reads judged as without them; the reads' real cost against the estimate below; and the port's
fidelity: `node docs/truth/live-records/t11-carousel-visible/raw/raw-strokes.mjs <out> 4` run right next to the
`--groups carousel` run on the same boot, each read's state and short count compared with the Device line's (the
same state expected, short counts close; a disagreement is the port's to explain before any label is trusted).

**Consequences.** A read costs about 55 s, estimated, not measured: T11's raw-1.jsonl rounds ran 12 s apart with the
script's 1.5-s launch sleep, and the settle on ready adds about half a second a round; four rounds and the frames' read.
Two reads take a single-case carousel run from about 23 s to about 2 minutes, five times as long; a run of the whole
group pays the same 110 s once. `--device-read none` is the opt-out where the label is not wanted. raw-strokes.mjs and
the label-group scripts stay as the evidence of the runs they labelled (a note beside raw-strokes.mjs says so); a new
labelled run needs neither. The gfxinfo summariser T11 used (`fs.mjs`) is lost; `parseGfxinfo` reads only the four lines
its outputs kept. device-state.ts is in the mutation scope (group `lab`), its read pinned over a fake exec through
`AndroidLab`.

## Amendment: no first state is a named failure (T10, 2026-11-10)

**Context.** The cycle read the state after the calls as `stamped(await lab.state())!`: when the app wrote none, the
judge met `undefined`, and a judge that read it threw a raw TypeError that ended the whole run. A11 kept that for byte
parity and pinned it. T7b did not run into it (its fresh process writes `cell: ""`, a state), but a lab app that stops
writing would.

**Decision.** A first state that is undefined is the case's LOUD verdict of class `no-state`, named with the case's id
(`noFirstState` in `scripts/truth/live-cases.ts`: `no first state for <id>: the app wrote none after the calls`),
decided in `runCase` before any judge, never a SKIP (a SKIP reads as harmless and would hide a lab app that stopped
writing). With no state there is no judge to ask, no late read (`wantsLateRead` asks the judge) and no second panel read
(it is kept on the state); the focus read after the calls, the screenshot (the verdict is not ok) and the teardown run
as for any case, and the record keeps `state` undefined with no `skip`. The run goes on to the next case. `summarize`
counts it as loud and fails the run on it, a `--side` run too (the lab app is broken whatever averi drove it), with a
line of its own (`NO FIRST STATE — the app wrote none, the run fails: <source> <id>, …`), as it does a SKIP of a
`skipFails` case. A `no-state` verdict is not a judged one: `isJudged` in `scripts/truth/live-visibility.ts` (not SKIP,
not `no-state`) is what every count a pass is claimed on asks — the carousel's hedged ceiling (`hedgedCeiling`) and
the residual tally's "N of M judged run(s)" — so a leg nothing judged never turns the ceiling's "no pass claimed" into a
pass. `hedgedStops` deliberately does not ask it: it counts averi's real replies, so a `no-state` case's hedge stays,
in the `other` bucket. `rejudgedResults` gives such a record the same verdict (no committed record has one: each with
no state has a `skip`, so every committed record rejudges as before; the old `no state recorded` SKIP is gone). The
between-calls reads already keep an undefined state as it was read (every judge that reads one falls back to the final
state or SKIPs, so none throws; pinned), and the late read already drops one, so neither changes. A `no-state` case
carries no KNOWN or NOT-known mark in the summary (`isStateless`, beside `isJudged`): no averi behaviour was judged.
tests/truth/run-case.test.ts pins it, from the run to its summary and the rejudged record, in place of A11's pin;
tests/truth/live-carousel.test.ts pins the ceiling and the residual tally.
