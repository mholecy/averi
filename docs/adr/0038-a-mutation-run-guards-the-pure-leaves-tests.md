# 38. A mutation run guards the pure leaves' tests, each module held to its own floor

Status: accepted 2026-11-01 (backlog row D36, docs/plans/2026-10-30-performance-backlog.md). Tooling only: no
behaviour changes.
Amended 2026-11-02 (D45: geometry.ts joined the run — see the amendment below).
Amended 2026-11-02 (D33: adapters/ios-liveness.ts joined the run — see the second amendment below).
Amended 2026-11-03 (D43: adapters/typeable.ts and adapters/ios-typing.ts joined the run — see the D43 amendment below).
Amended 2026-11-04 (T2 S1: scripts/truth/batch/ joined the run — see the T2 amendment below).
Amended 2026-11-04 (T2 S2: bounded.ts and abort.ts joined the run — see the T2 amendment's S2 part below).

## Context

- Mutation checks were manual: each implementation loop's implementer and reviewer mutated by hand. Nothing ran them
  again, so a later change could weaken a test and nobody would notice.
- An evaluation on 2026-11-01 ran Stryker 10.1.1 with its vitest runner over the pure leaves, each against its own
  tests. The cold runs took 3 to 47 s per module.
- geometry.ts reached 49.5 % from its own tests. Its broad suite takes over 12 minutes per run.
- vitest's `related` mode pulled in the whole suite, and the suite's `process.chdir()` callers fail inside Stryker's
  worker threads.

## Decision

**`npm run mutate` runs Stryker over five pure leaves, each against its direct tests only, and fails when any module's
score drops below its own floor. A merge runs it cold.**

- Scope: one data file, `scripts/mutation/scope.json`. For each mutated module it gives the module's direct tests
  (globs), its floor and the baseline the floor came from. The modules are flow/wipes-ahead.ts,
  interact/fill-reformat.ts, fill-verdict.ts and fill-landing.ts, and ui-tree/draw-order.ts. `stryker.config.mjs`
  (`mutate`), `vitest.mutation.config.ts` (`include`, with `related: false` and a cache of its own) and
  `scripts/mutation/mutate.ts` all read it. The normal `npx vitest run` never reads the mutation vitest config.
- Per-module floors, not Stryker's `thresholds.break`: `break` is one global score, and the baselines lie 23 points
  apart (draw-order 77 %, the other four 94 to 100 %). A global break low enough for draw-order would let a fill module
  lose a fifth of its kills unnoticed. So scope.json holds a floor per module, about 2 points below its baseline.
  `scripts/mutation/mutate.ts` (`checkFloors`) fails on a module below its floor, on a mutated module without a floor
  and on a floor for a module Stryker did not mutate. It also fails when Stryker writes no report.
- The floor rule: raise a floor when its module's baseline rises. Lower it only with a reason written in that module's
  `baseline` field.
- Cold at merge: `npm run mutate -- --force` (about 45 s) reruns every mutant. Stryker's incremental mode
  (`reports/mutation/stryker-incremental.json`) stays a local convenience of one checkout and is never committed. Its
  blind spot is why: it compares only the mutated files and their test files with the last run, never the modules they
  import. A change to `fill-facts.ts` can turn a killed mutant of `fill-landing.ts` into a survivor, and an incremental
  run would still report the old result. The cold run at every merge also replaces the monthly cold run that D36's
  spec proposed.
- Surviving mutants stay counted, equivalent ones included. The floors absorb them. A mutant is excluded only with
  `// Stryker disable next-line <mutator>: <reason>`, and only when that mutator kills nothing else on the line: the
  comment ignores every mutant of that mutator there, the killed ones too. On 2026-11-01 no line qualified with an
  honest reason, so the modules carry no such comment.

## Consequences

- A branch that touches one of the five modules, their tests or a module they import runs `npm run mutate -- --force`
  before merging.
- A module joins the run only with direct tests of its own. Adding it is one edit: an entry in scope.json with its
  tests, its floor and its baseline.
- geometry.ts stays out until its direct tests exist. That is a backlog row of its own.
- The tests added with the run pin behaviour, not object shape. So a mutant that only adds an `undefined` key, such as
  `...(x !== undefined && { x })` turned into `...{ x }`, survives. It is counted against the floor, not hidden.
- draw-order's floor is low on purpose. Its 61 uncovered mutants (`paintsOver`'s own-content and clickable-layer
  exemptions, `drawnOver`, `drawnOverStrip`) and its idb keyboard band survivors are exercised by other suites
  (tests/verify/pixel-chrome.test.ts, tests/ui-tree/keyboard-position.test.ts, the adapters'), not by
  draw-order*.test.ts.

## Amendment: geometry.ts joins the run (2026-11-02, backlog D45)

geometry.ts is the run's sixth module. It joined once it had direct tests of its own: tests/ui-tree/geometry.test.ts,
which reached 49.5 % alone, and four new files: geometry-viewport.test.ts, geometry-clips.test.ts,
geometry-screen-size.test.ts and geometry-text.test.ts. Its scope.json entry names them as
`tests/ui-tree/geometry*.test.ts`, with a floor of 93 under a baseline of 95.1 %. tests/truth/geometry.test.ts stays
out: it tests scripts/truth/truth.ts, not this module, and the sandbox's allowlist does not copy the scripts it imports.

One run holds every module's tests, and Stryker's per-test coverage runs a mutant against every test that reaches
it, not only its module's. draw-order*.test.ts call geometry.ts heavily, so their kills count toward geometry's score
too: about 0.2 points over its own tests' score. Each module is still held to a floor its own tests earn, within that
margin. This cross-module coverage is also most of the added cost: the cold run takes about 60 s, against 45 s for
the five modules before.

Running Stryker once per module, each with only its own tests, was considered and not taken. It would score each
module strictly by its direct tests, but it gives up the kills a module's mutants get from its neighbours' tests, and
it adds a Stryker start-up per module. Revisit it if an idle cold run passes about 90 s.

draw-order's floor rises from 75 to 84. The same backlog row gave its 61 uncovered mutants direct tests
(tests/ui-tree/draw-order-paints-over.test.ts): `paintsOver`'s own-content and clickable-layer exemptions,
`drawnOverAt`, `drawnOverStrip` and `ofKeyboardBand`. Its baseline went from 77.2 % to 86.6 %, and the floor rule
moves the floor with it. Its idb keyboard band survivors are still covered only elsewhere
(tests/ui-tree/keyboard-position.test.ts, the adapters' suites), not by draw-order*.test.ts.

## Amendment: ios-liveness.ts joins the run (2026-11-02, backlog D33)

adapters/ios-liveness.ts is the run's seventh module (ADR 0039). It is a pure leaf: the host process pattern for an
iOS app (its escape, its end anchor, the rule that the Path is this simulator's), the reading of pgrep's outcome and
its reason for the stderr line. A dropped escape or anchor there would flip a liveness verdict without failing any
other test. Its scope.json entry names tests/adapters/ios-liveness.test.ts, with a floor of 98 under a baseline of
100 % (70 mutants, 0 survived, 0 without coverage). That 100 % came after one survivor was killed and one string
covered: the first run's ExecError type check survived (a plain Error reads the same), and a test now pins that only
exec's ExecError is read; a later run left `pgrepReason`'s "no exit code" uncovered. The cold run takes 60 to 71 s.

## Amendment: typeable.ts and ios-typing.ts join the run (2026-11-03, backlog D43)

adapters/typeable.ts and adapters/ios-typing.ts are pure leaves of the typing refusal and its routing (ADR 0037's D43
amendment): which characters each iOS path types, which path a text goes to, and the refusal's words and remedy. A
flipped router or a remedy that names the wrong path would fail no device test. typeable.ts's entry names
tests/adapters/typeable.test.ts, ios-typing.test.ts and tests/interact/type-text.test.ts, with a floor of 88 under a
baseline of 89.74 % (39 mutants, 4 survived): the four are `named()`'s class tests with an anchor dropped, equivalent,
since the character a refusal names is one code point. ios-typing.ts's names tests/adapters/ios-typing.test.ts and
typeable.test.ts, with a floor of 98 under a baseline of 100 % (24 valid mutants; 2 runtime errors). Stryker does not
mutate a RegExp built with `new RegExp`, as both iOS sets are, so their character classes are held by hand mutants and
per-character tests instead. The cold run of all ten modules took 74 s.

## Amendment: the device batches' core joins the run (2026-11-04, backlog T2 slice S1)

scripts/truth/batch/ is the first scope outside src/: words.ts (the verdict vocabulary, the SUMMARY and the exit
code), select.ts (ONLY= and the knobs), run-dir.ts (the refusals to start and the exclusive run folders), steps.ts
(the run's own output) and io.ts (their one filesystem seam). Each is tested on its own, io.ts and the folder code on
real files in a temp dir; a dropped guard there would let a batch start over state an earlier run left, or write
into an earlier run's folder, and no other test would notice. Their baselines: words.ts 100 %, steps.ts 99.26 %
(1 survivor), select.ts 99.44 %, run-dir.ts 99.36 %, io.ts 94.55 %, every survivor equivalent and named in
scope.json; floors 98, 97, 97, 97 and 92. steps.ts's floor is 97, not 98: 98 sat a quarter point under its baseline,
less than one mutant, where the rule above asks for about 2 points.

Adding a module outside src/ takes two edits, not one: its scope.json entry, and its folder in stryker.config.mjs's
allowlist (`ignorePatterns`), which copies `scripts/truth/batch/` into the sandbox and still none of the rest of
scripts/truth/. A test that imports a scripts/truth module outside that folder therefore stays out of the entry's tests:
tests/truth/batch/steps-live.test.ts, which holds steps.ts's live.ts header to live-cases.ts, runs in the normal suite
only, as does tests/truth/batch/terminal.test.ts, which spawns a child whose stdout's reader has gone.
tests/mutation/mutate.test.ts accepts a scope key under src/ or scripts/truth/batch/. The cold run of all fifteen
modules took 86 to 108 s, past the 90 s at which the amendment for geometry.ts said to revisit one Stryker run per
module; that is left for a later look, since the five new modules add about 30 s of it.

What of batch-11's and batch-12's safety core S1 does not port, each with the slice that owns it or the reason (spec
T2: no row dropped silently):
- bounded device calls, the process-group timeout and `detached()` restores: S2.
- the dirty windows, `on_abort` on INT/TERM/HUP and TRAPEXIT's port, which also trigger the abort SUMMARY: S2.
- marking a state file dirty (`markDirty`): S2 and S5, where it is first used.
- the precondition reasons behind an INCONCLUSIVE, `.cases` completeness, the clean checkout and the ancestry gates
  (`git merge-base --is-ancestor`): S3.
- the D43 keys restored one by one, the schemeapproval key read-only, `sim-domains --compare`: S4.
- safeTap, the preferred-activities read, the abort-safe reinstall with `pm path`: S5.
- the missing-verdict backstop, the per-run steps and details printout, the `lab` folder made on every run, and the
  ERROR lines batch-12 collected from each block's logs and analyze.txt: S6, the runner.
- b11-dry's assertions go to the slices that own them; its "out.txt newer than batch-11.sh" check is dropped, an
  artefact of its sed-copy harness.
- ported in another shape: B2's "folder holds more than its `.cases`" check is the exclusive mkdir (as strong against
  another run's data, weaker only against this run writing into a later block's folder, which no batch does);
  batch-12's pre-D62 worktree refusal stays the batch's own, passed to `refusals` as `batchReasons`; the `grep "run
  $RUN_ID"` filter on RESTORE is gone, since a run refuses to start while a RESTORE exists and only appends to it.

Where S1 departs from batch-12, on purpose:
- every SUMMARY has a RESTORE line, `RESTORE: none — …` when nothing is left, not only the abort SUMMARY.
- an ERROR line is a step line, one that starts with ERROR; an ERROR inside a verdict line (`E5 cleanup: ERROR — …`)
  reaches the SUMMARY as that block's verdict line, not as an ERROR.
- the exit rule fails on a step-form FAIL line too (`FAIL …`), besides batch-12's `^[^:]+: FAIL( |$)`.
- ONLY= takes spaces as well as commas between block names.
- an out folder inside the checkout is refused already in S1 (analysis §5), not left to S6.

### S2: bounded calls and the abort (2026-11-04, backlog T2 slice S2, the risk gate)

S2 adds three files. bounded.ts bounds every call: its tool's own bound (at most a day, `MAX_SECS`), exit 142 past it,
and the whole process group ended, SIGTERM and then SIGKILL; once a call's leader has ended, its group gets SIGKILL, so
nothing it started outlives it, unless the call keeps its group (`keepGroup`), and then stopAll ends that group at the
abort. Output a grandchild writes after its leader's end is dropped on purpose: the result is the leader's. A group kill
never throws or rejects: EPERM, seen under parallel load, is tried once more 50 ms later, and a kill still not delivered
is said at once as an ERROR line, on the normal path too, and gets a RESTORE hand line (`group N may still be running:
kill -9 -N, then check <window>'s state`), first in the file; the abort puts the windows back all the same, and a
restore past its bound whose kill was not delivered says it may still be running, not that it was stopped part-way.
abort.ts holds the dirty windows and the abort: SIGINT, SIGTERM or SIGHUP, a throw out of the run's body, or an uncaught
exception or unhandled rejection puts back every dirty window, writes RESTORE for what it cannot prove, prints the abort
SUMMARY through words.ts and steps.ts, and exits 130. proc.ts is the one process and signal seam: spawn in a group of
its own, kill a group, the signal and fatal handlers, exit, stderr; it only reports a child's exit and its pipes' close,
and bounded.ts decides how long to wait for either. io.ts gains `replace`, which writes a state file's text beside it
and renames it over the old one (`markDirty`).

bounded.ts and abort.ts join the run. Each is tested over a fake seam (tests/truth/batch/bounded.test.ts,
abort.test.ts), with real files in a temp dir and tiny real timers. Their baselines after review round 3: bounded.ts
98.96 % (2 survivors), abort.ts 98.03 % (4 survivors, 4 mutants without coverage — three of them in a defensive catch
that cannot run), every one equivalent and named in scope.json; floors 97 and 96. io.ts rose to 95.38 % with `replace`
and its tests (the same three equivalents), so its floor rises from 92 to 93. The cold run of all seventeen modules took
about 2 minutes (Stryker's own 108 to 131 s), past the 90 s mark the S1 part already noted; the look at one Stryker run
per module is still left for later. proc.ts stays out: it is only spawn, kill and process.on, and its tests start real
children. Those are tests/truth/batch/bounded-proc.test.ts (a grandchild that traps SIGTERM is gone after a timeout, a
leader's leftover gone after its end, a kept group ended by stopAll) and abort-proc.test.ts (b11-dry's int.sh scenarios
as vitest tests: a group sent SIGINT, a second SIGINT, a throw, a rejection and an uncaught exception inside a window,
stdout EPIPE, a terminal that blocks, batch-12's worktree window). Both run in the normal suite only, as
terminal.test.ts does.

Which tools keep their group by default (bounded.ts `KEEPS_GROUP`; a call's own `keepGroup` overrides it):
- idb: kept. A local idb client may start idb_companion without a session of its own, in the call's group, where
  the SIGKILL at the leader's end would kill it.
- emulator: kept. The emulator binary is the Android device itself; a call starts it to keep it running.
- adb: not kept. The adb server it starts calls setsid(), so it leaves the call's group.
- xcrun (simctl): not kept. The simulator runs under launchd, outside the call's group.

Residuals of S2, open:
- whether idb_companion really starts in the idb client's group is not measured; a lab check (an idb call, then the
  companion's process group read outside the sandbox) decides whether idb may drop `keepGroup`. Not run in S2.
- a kept group is kept only while it exists: it is asked (`kill(-id, 0)`) when its leader ends, so an idb call that
  started no companion keeps nothing, and asked again just before stopAll signals it, so one gone since is dropped,
  never signalled. While any of its processes lives its id cannot be reused. What is left is the moment between that
  last ask and the signal; telling groups apart for certain needs a process's start time (ps, which the sandbox
  blocks).

What of batch-11's and batch-12's safety core S2 does not port, each with the slice that owns it or the reason:
- the `B_*` bound knobs and their validation: S1's select.ts `knobs` already covers them; a batch passes the value as
  a call's `secs`.
- the cleanup after a build passes its bound: the group kill ends an `xcodebuild` the call started, so `pkill
  xcodebuild` is not needed; but the Gradle daemon leaves the call's group by design, so `gradlew --stop` stays with
  the lab build step: S6.
- on_abort's own restores: BACK/HOME, the reinstall checked with `adb get-state` and `pm path`, and the chooser's
  `--check` exits (S5); the D43 restore after `kill_lab_wda` and its 4 s wait (S4); `pkill` of idb_companion and the
  lab's WebDriverAgent (lab plumbing for the runner: S6). S2 gives each of them a window: a restore, its hand lines,
  its bound and its block. batch-12's worktree window is shown as one in abort-proc.test.ts's fixture.
- `A_DIRTY` and `CLIP_DIRTY` as flags: no block of batch-11 or batch-12 ever set them. A batch that writes the
  schemeapproval domain or the clipboard opens a window for it.
- `exec >>$STEPS` after the tee died: steps.ts already writes the run's own files (S1); the abort writes only to them
  until the SUMMARY's last write to the terminal.
- block_complete's per-block rules (the `.cases` with their records, kf's premise verdict, T6's capture): the batch's
  `AbortBlock.complete`. The generic `.cases` completeness is S3. The analyzer that judges a complete block stays per
  batch, called through `judge`.
- the abort-path hand lines of int-reinstall, int-reinstall-nolab and -noadb, and int-after-e2: S5.
- a SIGKILL to the runner: nothing can catch it, in zsh or in Node. A state file a window marked dirty still refuses
  the next run (S1's refusals).

Where S2 departs from batch-12, on purpose:
- a throw or an uncaught error outside every window takes the abort path too: the abort SUMMARY, exit 130. batch-12's
  TRAPEXIT acted only inside a window. A waiter waits for `======== SUMMARY`, so a run that died without printing one
  would leave it waiting, and the SUMMARY's ERROR line names the error.
- a block interrupted inside its own window is never judged, even when the abort then puts the window back.
  batch-12's block_complete read CHOOSER_DIRTY after on_abort had cleared it, although its comment says "never while
  interrupted inside it". The comment is the rule: one of that block's legs was cut short.
- the abort's cleanup line (`E5 cleanup: OK — … (verified by the abort)`) follows the block's INTERRUPTED line
  unprefixed. batch-12 appended it to verdict.txt, so it was printed as "(before the interrupt)".
- the windows are put back last opened first. batch-12 used a fixed order, which mattered only with two windows
  open.
- a restore is bounded as a whole by its window's `secs` (300 by default, as B_RESTORE), not only each command in it. A
  restore past its bound is stopped there, with the detached calls it started (`Calls.scope`), and its RESTORE lines say
  it was stopped part-way; its scope then refuses any further call, so it cannot start its next step (a judge past the
  budget likewise). A window's `secs` is checked when it opens: more than 0, at most `MAX_SECS`. The judges of the
  complete blocks share one budget, `judgeBudgetSecs` (120 s by default), where batch-12 gave its analyzer 300 s per
  block; a block not judged in it, or after a restore passed its bound, is `INTERRUPTED — not judged (<why>; rerun
  ONLY=<block>)`. The abort's worst case is then the probes' stop (2 s), each dirty window's bound and its stop (300 s +
  2 s by default), and the budget and its stop (120 s + 2 s): about 7 minutes for one window at the defaults.
- the windows the abort puts back are those open when it began, taken before its first await. The run's body goes on
  meanwhile (a probe the abort stopped returns to it), so close() and finish() are only noted from then on; else a
  body that closed its window after its probe was killed would leave the device dirty with `RESTORE: none`. A window
  opens only inside run(), where the abort is installed, and a cleanup line only for a wanted block.
- the abort does not rely on its log: a line it cannot write (ENOSPC, the out folder gone) is dropped, each window is
  put back on its own, and when the RESTORE file cannot be written its lines go to stderr once.
- a block's own restore on the normal path runs as a probe, so the abort may stop it part-way and then run the
  window's restore again: every restore must be safe to run twice, as batch-12's were.
- the runner stops its running probes itself, before the first restore: SIGTERM to each probe's group, then SIGKILL
  after a 2 s grace or once the probe has ended. In a group of its own a probe no longer gets the terminal's Ctrl-C.
  Once stopping, no probe starts and no window opens, so a body that goes on after its probe was killed cannot touch
  a device.
- a window with a state file: opening it marks an existing state file dirty (`markDirty`). This covers batch-11's
  forced-dirty state after the reinstall: a window reopened over a state that a restore had cleared reads dirty
  again. A restore that says it is done while that file is still not clean is not put back.
- a signal that arrives during the abort is noted in steps.log, not silently ignored.
- the normal end's RESTORE header is S1's writeRestore form: `<name> run <id> ended at <date>; state to put back by
  hand:`.

