# 38. A mutation run guards the pure leaves' tests, each module held to its own floor

Status: accepted 2026-11-01 (backlog row D36, docs/plans/2026-10-30-performance-backlog.md). Tooling only: no
behaviour changes.
Amended 2026-11-02 (D45: geometry.ts joined the run — see the amendment below).
Amended 2026-11-02 (D33: adapters/ios-liveness.ts joined the run — see the second amendment below).
Amended 2026-11-03 (D43: adapters/typeable.ts and adapters/ios-typing.ts joined the run — see the D43 amendment below).
Amended 2026-11-04 (T2 S1: scripts/truth/batch/ joined the run — see the T2 amendment below).
Amended 2026-11-04 (T2 S2: bounded.ts and abort.ts joined the run — see the T2 amendment's S2 part below).
Amended 2026-11-04 (T2 S3: preconditions.ts and cases.ts joined the run — see the T2 amendment's S3 part below).
Amended 2026-11-05 (T2 S5: lab-chooser.ts and lab-emu.ts joined the run — see the T2 amendment's S5 part below).
Amended 2026-11-05 (T2 S6a: runner-lines.ts, runner.ts and records.ts joined the run — see the T2 amendment's S6a part
below).
Amended 2026-11-05 (T2 batch-13 fixes: idb disconnect after each companion end, the Android guard's adb words, the
simulator's binary export, and batch-13's live check — see the T2 amendment's batch-13 part below).
Amended 2026-11-05 (T2b-1: a changed protected key exits 1, a need's end and its calls recorded, the out-folder
refusal, the cleanup's and the domains window's labels — see the T2 amendment's T2b-1 part below).
Amended 2026-11-05 (T2b-2: the run in two groups, core and lab, one Stryker process each — see the T2 amendment's
T2b-2 part below).
Amended 2026-11-05 (T2c: the abort's and the runner's budget tests on fake time, their bounds pinned exactly — see the
T2 amendment's T2c part below).
Amended 2026-11-06 (A11: scripts/truth/run-case.ts joined the run — see the amendment at the end).
Amended 2026-11-10 (T13: flush-check.ts, replies.ts, live-carousel.ts and live-visibility.ts joined the run — see the T13
amendment at the end).
Amended 2026-11-11 (T20b: scripts/truth/batch/lab-run.ts joined the run — see the T20b amendment at the end).
Amended 2026-11-11 (T9: src/interact/fill-type.ts joined the run — see the T9 amendment at the end).

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
out: it tests scripts/truth/truth.ts, not this module, and (until A11, see the amendment at the end) the sandbox's allowlist did not copy the scripts it imports.

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
allowlist (`ignorePatterns`), which copies `scripts/truth/batch/` into the sandbox and, until A11 (see the amendment at the
end), none of the rest of scripts/truth/. A test that imports a scripts/truth module outside that folder therefore stayed out of the entry's tests:
tests/truth/batch/steps-live.test.ts, which holds steps.ts's live.ts header to live-cases.ts, runs in the normal suite
only, as does tests/truth/batch/terminal.test.ts, which spawns a child whose stdout's reader has gone.
tests/mutation/mutate.test.ts accepted a scope key under src/ or scripts/truth/batch/ (A11 adds scripts/truth/ itself). The cold run of all fifteen
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
nothing it started outlives it, unless the call keeps its group (`keepGroup`), and then stopKept ends that group at the
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
abort.test.ts), with real files in a temp dir and tiny real timers. Their baselines after the final check: bounded.ts
99.08 % (2 survivors), abort.ts 98.03 % (4 survivors, 4 mutants without coverage — three of them in a defensive catch
that cannot run), every one equivalent and named in scope.json; floors 97 and 96. io.ts rose to 95.71 % with `replace`
and `withAppend` and its tests (the same three equivalents), so its floor rises from 92 to 93. The cold run of all
seventeen modules took about 2 minutes (Stryker's own 108 to 141 s), past the 90 s mark the S1 part already noted; the
look at one Stryker run per module is still left for later. proc.ts stays out: it is only spawn, kill and process.on,
and its tests start real children. Those are tests/truth/batch/bounded-proc.test.ts (a grandchild that traps SIGTERM is
gone after a timeout, a leader's leftover gone after its end, a kept group ended by stopAll) and abort-proc.test.ts
(b11-dry's int.sh scenarios as vitest tests: a group sent SIGINT, a second SIGINT, a throw, a rejection and an uncaught
exception inside a window, stdout EPIPE, a terminal that blocks, batch-12's worktree window). Both run in the normal
suite only, as terminal.test.ts does.

Which tools keep their group by default (bounded.ts `KEEPS_GROUP`; a call's own `keepGroup` overrides it). The emulator
is not in it: no batch starts it through bounded, so a call that did would pass `keepGroup` itself.
- idb: kept. A local idb client may start idb_companion without a session of its own, in the call's group, where
  the SIGKILL at the leader's end would kill it.
- adb: not kept. The adb server it starts calls setsid(), so it leaves the call's group.
- xcrun (simctl): not kept. The simulator runs under launchd, outside the call's group.

Residuals of S2, open:
- whether idb_companion really starts in the idb client's group is not measured; a lab check (an idb call, then the
  companion's process group read outside the sandbox) decides whether idb may drop `keepGroup`. Not run in S2.
- a kept group is kept only while it exists: it is asked (`kill(-id, 0)`) when its leader ends, so an idb call that
  started no companion keeps nothing, and asked again just before stopAll signals it, so one gone since is dropped,
  never signalled; every new call asks about the kept groups first and drops those gone. While any of its processes
  lives its id cannot be reused. What is left is the time between the last call or check and the signal; telling
  groups apart for certain needs a process's start time (ps, which the sandbox blocks). A refused check (EPERM) keeps
  the group, on purpose the safe side: the abort signals it, a kill refused too gets its RESTORE hand line, and so the
  next run refuses to start.

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
- once a call's leader has ended, its whole group gets SIGKILL, so nothing it started outlives it; batch-12's `bounded`
  (perl's alarm) reached the leader alone, and only past its bound.
- which groups outlive their leader is a per-tool table, `KEEPS_GROUP` (idb kept, adb and xcrun not), a call's own
  `keepGroup` over it; batch-12 had no such notion and pkilled idb_companion by name.
- the abort stops the running probes first and the kept groups only last, after the restores and the judging, which
  may need them: batch-11's on_abort pkilled idb_companion at its end too, and S2 keeps that order. The normal end
  (`finish()`, now async) ends them as well, after its RESTORE, appending a hand line for a kill not delivered, so a
  companion lives across blocks but not past the run; a block can end its own earlier with `stopKept(owner)`, as
  batch-12 did after each iOS block — the owner is the call's `owner`, recorded when its group is kept.
- `markDirty` on open() and io.ts's `replace` port batch-11's forced-dirty state after a reinstall into S2 already, not
  S5: a window reopened over a state file a restore had cleared must read dirty again, and S2's windows need that.
- TRAPEXIT's `$ZSH_SUBSHELL -eq 0` guard has no Node counterpart: Node has no subshells, so nothing else's exit can
  look like the runner's. A child process's failure is a call's result, never the runner's error ("only the run's own
  errors abort it", abort.test.ts).

### S3: preconditions and the cases (2026-11-04, backlog T2 slice S3)

S3 adds three files. preconditions.ts shows a block's preconditions or says why not, each answer git's, read through a
bounded call: `checkout` (HEAD is the commit refs/heads/main is, no modified tracked file), `ancestor` (a required
commit's sha format, then `git cat-file -e <sha>^{commit}`, then `git merge-base --is-ancestor <sha> HEAD`),
`casesOnMain` and `cellsOnMain` (the live cases and lab cells from main's own live-cases.ts and catalog, never grepped),
and `preconditionLine`, which turns the failed ones into the block's `<label>: INCONCLUSIVE — precondition: <why>; …`.
cases.ts holds a live run's `.cases`: `writeCases` (written before anything of the run, never overwritten),
`stepOutcome` (the judged exit-1 rule with its why, over steps.ts's stepWordOf), `completeness` (b11-analyze.ts's rule:
the `.cases`, a record, `# Live golden:` in the log and in the summary, every case main picks there; and, since review
round 1, something to prove) and `incompleteLine` (`<label>: INCONCLUSIVE — <k> of <n> run(s) incomplete: <name> —
<why> | …`, or `not run` when the folder holds no `.cases`). live-table.ts holds what both read of main's table: the
`LiveCases` and `LiveSelection` types, `DEFAULT_GROUPS` (forms), `liveTableOf(repo)` (the loader), `loadTable` and
`unreadLive` (a load that fails, named). bounded.ts gains git's own bound, 30 s (`GIT_SECS`), for reads — a slow git
operation passes its own secs; steps.ts shares `holdsGoldenHeader`; run-dir.ts exports `PLAIN_SEGMENT` and
`plainSegment(what, name)`, which openRun and writeCases both use; words.ts gains `nameInLine` and `firstLineOf`.

preconditions.ts, cases.ts and live-table.ts join the run. Each is tested over fakes: a fake `Run` that answers git as
git does, a fake live-cases table, and real files in a temp dir (tests/truth/batch/preconditions.test.ts,
cases.test.ts). The same code over real temporary git repos (`git init -b main` in a mkdtemp with its own HOME and git
config, no inherited GIT_DIR, GIT_WORK_TREE or GIT_INDEX_FILE; git started through bounded.ts) is
preconditions-git.test.ts, and over this checkout's own live-cases table cases-live.test.ts; both run in the normal
suite only — the first starts processes, the second imports live-cases.ts, which the sandbox does not hold. Main's table
is read by a dynamic import of the checkout's own file (live-table.ts's `liveTableOf(repo)`, as b11-analyze.ts did),
never a static one, so the sandbox needs no new entry; the sandbox tests reach `liveTableOf` through a temp folder that
holds no live-cases.ts, whose load rejects. Baselines after the code review: preconditions.ts 100 % (279 mutants, 1
timeout), cases.ts 99.64 % (275 mutants, 1 equivalent survivor: `asked !== undefined` beside no gap, there for the
type), live-table.ts 100 % (11 mutants); floors 98, 97 and 98. words.ts stays at 100 % with its two new helpers (113
mutants). The cold run of all twenty modules took 2 min 15 s.

Decisions S3 pins:
- a detached HEAD, or another branch, at main's very commit passes: what runs is main's code as committed. batch-11 and
  batch-12 compared the two shas too; S3 tests it.
- HEAD ≠ main and modified tracked files are both said, in one why, when both hold: one rerun fixes both. An untracked
  file is allowed (`--untracked-files=no`, as both batches); a staged change counts; a rename or copy counts once, by
  its new path (`status --porcelain -z`); the first three paths are named, then how many more.
- the preconditions take a `Run` (a Calls' `bounded`, or a scope's `run`), not a Calls object: any Run can be faked, and
  a restore's scope can use the same checks. The top check reads real paths through the `BatchFs` given (`Git.fs`),
  the real one by default.
- every git call runs `git -C <repo>` with GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_COMMON_DIR,
  GIT_OBJECT_DIRECTORY and GIT_ALTERNATE_OBJECT_DIRECTORIES dropped from its env: a batch started inside a hook's
  context would otherwise read another repo. Config given through the env is dropped too (GIT_CONFIG_PARAMETERS, which
  `git -c` passes down, GIT_CONFIG_COUNT and every GIT_CONFIG_KEY_n/VALUE_n): a `core.fileMode=false` there hides a
  modified file (preconditions-git.test.ts). The config files' own variables (GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM)
  are kept.
- `checkout` and `ancestor` first ask `git rev-parse --show-toplevel`, and the top must be the repo named, both by
  real path: a folder inside another checkout would have git read that one. Not shown, it ends the check: `<repo> is
  not the top of a git checkout (top is …)`.
- a name inside a why (a path, a case id, a source, a run's name) that holds a line break, or is empty, is JSON-quoted
  (words.ts `nameInLine`, as words.ts's own errors quote a value; summarize's ` ⏎ ` is for replies, not names), and
  git's or an error's words are cut at their first `\n` or `\r` (`firstLineOf`): preconditionLine and incompleteLine
  never throw on what the device, git or a file says.
- a LiveTable is loaded inside each check: a load that fails (a missing file, a syntax error) or a read that fails is
  `main's live cases could not be read: <first line>`, never thrown; a catalog read that fails, `main's catalog could
  not be read: <first line>`.
- a sha's format is batch-11's knob rule exactly (`^[0-9a-f]{7,40}$`), checked before any git call; an empty one is
  `<what> is not set`. cat-file exits 128 both for an unknown commit and for no repo, so its why carries git's own first
  line. `merge-base --is-ancestor` exit 1 is "not an ancestor"; any other failure is git failing. Past its bound, or not
  started, at any call, is said as such, never as a precondition's answer.
- `casesOnMain` asks selectCases for the platform, the lab app (native) and the groups (forms, as batch-11's live_run
  ran), so a case main holds for the other platform only is missing (p7w on Android): batch-11's grep would have passed
  it. No id at all is never a pass, for cases or cells.
- `writeCases` takes what a live run is asked (`Asked`) and nothing else, by its type and at run time: runsIn and
  completeness read every `.cases` as a live run's, so a non-live block keeps its own record elsewhere (batch-12's E5
  wrote `{"runs":3}` as a `.cases`; such a record is the runner's, S6). batch-11's `"kind": "new"` is not asked for:
  nothing read it, and a `.cases` holding it still reads. `completeness` reads the live shape and refuses a
  `.cases` that is not it (platform ios or android, an app, one source at least, case ids, optional groups), where
  b11-analyze.ts trusted it. Every gap is said at once, in order: the `.cases`, the record, the log, the summary, the
  cases. The one exception: the cases are checked only when the `.cases` was read as asked (else what to pick is
  unknown), and against the summary only when it can be read — with its header or without. A file that is there but
  cannot be read is "unreadable", never "missing". A case line counts only under its own `## <source>` at a line's
  start. A name that is no plain path segment (a stray `.cases` or `x.y.cases` in a block's folder) is a gap of its own,
  `<name>.cases: its name is no plain path segment …, not read as a run`, and the other runs are still judged.

§1a and §1b rows S3 ports, each to its tests:
- "INCONCLUSIVE when a precondition is unshown": preconditionLine (preconditions.test.ts, its describe block), every
  why branch of checkout and ancestor over the fake and over real repos, casesOnMain and cellsOnMain over the fake and
  the real table.
- "Preconditions via `merge-base --is-ancestor`, clean checkout": checkout (HEAD = main; a branch ≠ main; detached at
  main; a modified, an untracked and a staged file; a rename; a path with a line break; no main; no repo; a folder
  inside the checkout; a hook's GIT_DIR; config given through the env; a git that hangs past an injected bound) and
  ancestor (the format; unknown; a tree; a side branch; HEAD itself; a short sha; merged later; not the top).
- "`.cases` completeness": writeCases, runsIn, completeness (asked but never ran; never ran; each file missing,
  unreadable, no JSON or without its header; the cases main picks per source; a run that proves nothing; a stray
  `.cases`; a table that does not load), incompleteLine, over temp folders and over the real selector.
- §1b "`step` with the judged exit-1 rule": stepOutcome (cases.test.ts), over steps.ts's stepWordOf and its
  steps-live.test.ts.

What of batch-11's and batch-12's preconditions and cases S3 does not port, each with the slice that owns it or the
reason:
- the lab install verification (the installed cells.json byte-equal to main's catalog, the handler count) and the lab
  guards: S4 and S5, which read the devices.
- the catalog's `--check` precheck before the lab build: S6, with the lab build step.
- `live_run` itself (live.ts with its record, then its rejudge, each a bounded step) and the missing-verdict backstop
  "not run (see the ERROR lines)": S6, the runner, which owns the steps; incompleteLine gives it the lines.
- b11-analyze.ts's judgement (per-source PASS/FAIL/INCONCLUSIVE, tallies, the KNOWN marks): stays per batch, the
  analyzer's; completeness only says whether there is a whole run to judge.
- batch-12's `PRE_D62 = M_D62^1` first-parent check: one batch's own worktree setup, not a general precondition; a batch
  that needs one runs it through the same bounded git.
- the D64B_CASES id-list format: S1's select.ts text knobs.

Where S3 departs from batch-11 and batch-12, on purpose:
- git is bounded, 30 s a call; both batches ran it unbounded.
- a failed checkout or ancestry gives a result, not a refusal: batch-12 refused to start, batch-11 skipped the blocks
  with INCONCLUSIVE. Which of the two a batch does is the runner's (S6); the why is the same.
- the modified paths are named, not only counted; both failures of the checkout are said, not only the first.
- the live cases are main's table read in process, per platform, never `grep "id: '$1'"`.
- a `.cases` is never overwritten, where both batches removed a run's files and wrote it again: run folders are
  exclusive since S1, so a second one of a name is the batch's mistake, thrown.
- a block folder that holds no `.cases` at all gives an INCONCLUSIVE `not run: no .cases in its folder (nothing was
  asked)` from incompleteLine, not only from the backstop.
- a run that proves nothing is not complete, where b11-analyze.ts counted it (review round 1): every id asked that main
  runs under none of the sources asked is a gap (`zz-nope: no case main runs on android under uiautomator`), and a
  selection of no case at all for any source is one too (`main picks no case for what was asked (…): the run proves
  nothing`). b11-analyze.ts only checked that what main picks is in the summary, so a `.cases` asking for an unknown
  id, beside a summary of 0 cases, passed.
- a case line before any `## <source>` counts under none; b11-analyze.ts filed it under a source named `?`, which no
  run asks.
- the checkout's repo must be the top of its checkout, and config given through the env is dropped: both batches ran
  git in the shell's env, from `cd $MAIN`.
- a `.cases` is a live run's only: batch-12 also wrote one for its E5 and T6 blocks, in shapes of their own.

### S4: the iOS settings (2026-11-05, backlog T2 slice S4)

S4 adds two files, split in the code review: ios-defaults.ts, pure — the values and the words — and ios-domains.ts, the
calls and the files. They hold the lab simulator's three settings domains around the WDA window
(com.apple.keyboard.preferences, com.apple.Preferences, com.apple.Accessibility) and the read-only schemeapproval key.
ios-defaults.ts holds what moved from d43-gate.ts almost unchanged: the typed map (per top-level key its plist type, its
canonical JSON and a scalar's write text, so bool false is never int 0), `diffMaps`, `decideRestore` (each changed or
missing scalar written back typed, each extra key deleted — a key, never the domain; still differing, the whole backup
imported; after the import, `defaults delete <domain>` + import only when the import exited 0 and is proven to have
merged; else NOT VERIFIED with its hand commands; a domain absent before gets key deletes only, never a domain
delete or an import) and `restoreDomain`, which drives the rule to its end over an injected run and read. With them:
one table of the restore's actions (what each runs, how its exits are recorded), read by `actionArgs` and
`restoreDomain`; `defaultsArgv`; the protected key and what its read means (`protectedReadOf`, `protectedLine`); what an
empty export's `defaults read` probe means (`absentIn`); the state file's shape (`stateIn`, `DomainEntry`); and every
line. ios-domains.ts holds, over the injected `Run` and `BatchFs`: `LabSim` (had only through lab-device.ts's guard),
`backup`, `restore`, `compare`, `readProtected` and `domainsWindow` (the window as abort.ts's dirty window, its restore
over the abort's detached runner). words.ts gains the verdict word WARN, for the compare's line.

Why two files, where the first cut had one: the code review found the one file changing for two reasons — the rule and
its words, and the simulator calls around them — and its pure half could be read and mutated without a fake simulator at
all. ios-domains.ts reuses lab-device.ts's guards (spec T2: reuse, not copy) by a static import, so the sandbox's
allowlist names two more files of scripts/truth/: lab-device.ts and the schema.ts it imports (their other imports are
src/, already there, or types only) — the S1 part's "none of the rest of scripts/truth/" holds but for these two;
ios-defaults.ts imports nothing outside scripts/truth/batch/. Their tests: ios-defaults.test.ts (the pure parts over
batch-10's real exports, committed as typed maps in tests/fixtures/batch/d43-b10/ with the home folder as `~` and the
udid a placeholder) and ios-domains-sim.test.ts (a fake simulator: its domains in memory, `defaults export` writing the
typed map to a real temp file that the fake plistlib reads back; every call checked, in afterEach, for device-check's
udid, ports 8100/8101 and a non-read `defaults` on the schemeapproval domain — b11-dry's VIOLATION checks made exact);
ios-defaults.ts runs against both, ios-domains.ts against the second. ios-domains-plist.test.ts runs TYPED_PY on the
host's plistlib over XML plists and is in the normal suite only: it starts python3. Baselines after the code review,
cold: ios-defaults.ts 99.82 % (544 mutants, 4 timeouts, 1 equivalent survivor: `valueOf`'s state check, which an absent
read without a value makes moot), floor 97; ios-domains.ts 100 % (334 mutants), floor 98; words.ts stays at 100 % (113
mutants). The cold run of all twenty-two modules took 2 min 48 s. The S1 hygiene test now also refuses any UUID (a
device udid or any other id) in the batch module's directories.

Decisions S4 pins:
- every call goes to the lab simulator: a `LabSim` exists only after `IosLab.guard()` (device-check's udid refused
  before any call; then `simctl list devices -j` must list the udid under `averi-lab …`), its `simctl list` run through
  the `Run` given; `using(run)` keeps the guarded simulator over another runner. Nothing in the module names a port.
- `defaultsArgv` is the module's only `defaults` argv builder, and an allowlist (review round 1). It runs read, export,
  write, delete and import, nothing else (rename, or an option first, throws). Any verb but a read must name, as its
  domain, exactly one of the three (no other case, no long s, no plist path, no prefix): everything else throws, so the
  schemeapproval domain is only ever read. No batch writes that domain since batch-11; a future need is a new decision.
- the state-file protocol: `backup` writes `{dirty: true, udid, port: 8120, domains: [{name, backup}]}` (d43-gate.ts's
  shape, so its --restore can still read it) only after every domain was exported and read typed, or found absent; a
  failure writes none, so the window must not run. A state must name the three domains, each once (review round 1):
  none, one missing, a duplicate or another domain is refused whole, so a restore can never say "every domain equals its
  backup" over nothing proven. `restore` clears `dirty` only when every domain's read-back equals its backup, and
  refuses, doing nothing, a state of another udid or one that cannot be read.
- `compare` marking the state dirty itself, not leaving it to a person, is confirmed (code review): a late writer means
  the lab is not at its backup, so the next run must refuse to start until a restore verifies.
- `compare` runs only on a state the restore has cleared, for the simulator it names (review round 1): on a dirty state
  every domain is unread, `not compared: the restore has not verified (the state file is dirty)`, never "a late writer";
  another udid or a state that cannot be read, likewise; then no hand line, the state left as it is. Compared, a domain
  that changed since or could not be read marks the state dirty again (abort.ts's markDirty; a mark that fails is said
  in the line, never thrown) and gets LATE_HAND lines for RESTORE.
- the compare's line is batch-11's verdict line, `D43 WDA-window compare: OK — every domain still equals its backup
  after the end check` or `D43 WDA-window compare: WARN — <domain>: <key> <before> → <after>, …; <domain> unread (<why>)
  — the state file marked dirty again; the hand lines are in RESTORE`, each value `<type> <canonical value>` or
  `absent`, one line (nameInLine) and cut at COMPARE_VALUE_CHARS (60) code points with `…` (never half a surrogate pair,
  review round 2). WARN is a verdict word since S4; it alone never fails the run. What S6 must surface: the line as one
  of the D43 block's verdict lines (its BlockReport, so the SUMMARY shows it), and `hand` appended to RESTORE
  (writeRestore), which exits the run 1 and makes the next run refuse to start until a restore verifies; compare is
  called after the restore and the end check, as batch-11 did.
- a plist plistlib cannot read is unread, never an empty map: a backup that fails, a read-back that throws, a compare
  that says unread. unread is never unchanged, for a domain and for the protected key.
- absent is defaults' own words for that domain only (review rounds 1 and 2), the host defaults wording (Darwin 27, seen
  by the round-2 reviewer, committed as tests/fixtures/batch/defaults-host-*; no simulator stderr of a missing domain
  was captured, the scratch evidence holds none): a read of a domain not there exits 1 with `Domain '<domain>' not
  found.`, and an export of one exits 0 with an empty dictionary. So an export never says absent, and an empty one
  proves nothing: `backup` asks `defaults read <domain>` for a domain that exported empty — exit 1 with that domain's
  `not found` words, not past its bound, is absent (backup null); exit 0 is there and empty (its empty backup kept);
  anything else fails the backup, `cannot tell absent from empty`. Elsewhere an empty domain and an absent one compare
  equal (diffMaps), so restore and compare need no probe. `readProtected`: exit 0, the value (its trailing line breaks
  dropped, as `$(…)` did); exit 1, not past its bound, with `Could not find key '<the finportal key>' in domain
  '<schemeapproval>'` (batch-8's and batch-9's words; their own lines name `-->averilab`, which reads unreadable — a
  not-found for a key not asked is unexpected, code review — and a fixture derived from batch-8's names the finportal
  key) or `Domain '<schemeapproval>' not found.`, absent; anything else — another exit, those words about another
  domain, a call past its bound whatever its stderr — unreadable, with why. `protectedLine` is OK only when both reads
  were read and hold the same value (or both are absent); else an ERROR saying CHANGED or unread.
- a domain absent before is never deleted; the keys it gained are deleted one by one — d43-gate.ts's rule, confirmed in
  review round 1 (the spec's wording updated). The why: with no backup there is nothing to bring back, so a domain
  delete could only take keys a system process wrote meanwhile.
- `domainsWindow`'s hand lines are read from the state file when the abort asks: per domain an import of its backup, or
  for one absent before `defaults read` and a delete of each key it holds, never an import; with no state yet, one line
  saying both; with a state file there that cannot be read, a line saying so and why first (review round 2).
- no file is ever overwritten or removed: each read of a domain is a fresh `<state>.<domain>.<after|readback|compare>
  [-n].plist` beside the state file, kept, so a restore run twice (the abort's after the block's own) leaves both; an
  earlier state file or backup at the path refuses the backup.
- python3's plistlib on a host file is bounded by PLIST_SECS (15 s, d43-gate.ts's); xcrun by bounded.ts's own 120 s.

§1a and §1b rows S4 ports, each to its tests:
- "D43 keys restored one by one": decideRestore over the real exports (the G4 pair and two domains equal; the flip bool
  true → int 0 written back `-bool true`; batch-10's read-back equal; the reverse flip bool false → int 0 put back and
  read equal), the rule stage by stage (extra key, every write flag, the import for a dict, the proven-merge fallback,
  NOT VERIFIED after an import that did not merge or exited non-zero and after the fallback, absent before),
  restoreDomain, and over the fake: backup, and restore (batch-10's run end to end and its line, a refused write and
  import, an unreadable read-back, a domain that fails beside two that are put back, a key already gone with batch-9's
  stderr, an absent-before domain, a state that cannot be cleared, a state naming no domain or one twice); domainsWindow
  for the abort path (batch-11.sh:158–164).
- "schemeapproval key read-only": defaultsArgv (every non-read verb, any key, another case, a long s, a path, a prefix),
  a forged state naming the domain, the recorder's invariants in every simulator test, readProtected (value, batch-8's
  and batch-9's stderr as absent, the words about another domain, other failures and 142 as unreadable) and
  protectedLine.
- "`sim-domains --compare`": compare (OK; the runner flipping a key after the restore, before → after; bounded and
  one-line values; an unreadable plist; a backup gone and an export past its bound; a domain absent before that gained a
  key and one that went; a dirty state, another udid, no state; a state that cannot be marked).
- §1b "Read-supported vs unchanged" (the tri-state) and "Mark a state file dirty / the state-file protocol": compare's
  and protectedLine's unread, backup/restore/compare's state file.
- check.sh 43–44 (`d43-latediff` WARN, `full-pass` compare OK) and `d43-restorefail`'s hand lines: compare and restore.

For batch-13 (the module's first run on the lab simulator): record the simulator's own stderr and exit for a read and an
export of a missing domain, and for a read of a missing key, and replace the host-wording fixtures with them if they
differ.

What of batch-11's and batch-12's iOS settings S4 does not port, each with the slice that owns it or the reason:
- the WDA window's orchestration (the `.cases` first, the kill of the lab's WebDriverAgent and the 4 s wait before the
  restore, the port 8120 free check d43-gate.ts's restore made, the finportal reads at the iOS stretch's start and end,
  the compare's step after the end check, `d43-backupfail`'s INCONCLUSIVE): S6, the runner. S4 gives the pieces.
- the lab install verification for iOS (the installed cells.json byte-equal to main's catalog): it reads the app's
  container, no read this module does — S6.
- d43-gate.ts's gate (G1–G5), its `--analyze` and its CLI modes, and sim-domains.ts's CLI: the probes', out of the repo;
  the module's functions replace `--backup`, `--restore` and `--compare`.

Where S4 departs, on purpose, from d43-gate.ts, sim-domains.ts (with its `--compare`) and batch-11:
- compare refuses a dirty state, and another udid, itself; batch-11 only ran it on a clean state, and sim-domains.ts
  checked neither.
- compare marks the state dirty itself when a domain differs or is unread, so the next run refuses to start; batch-11
  left the state clean and its LATE_HAND told the human to mark it dirty and run d43-gate.ts --restore. The module's
  LATE_HAND lines are the per-key `defaults` commands (write, delete, or the import), or "compare it by hand" for an
  unread domain, prefixed `D43 (iOS, changed after the restore — a late writer):`.
- the line: batch-11 wrapped sim-domains.ts's `D43 compare: DIFFERS — <domain>: <key> <type> <repr> → <type> <repr>` as
  `D43 WDA-window compare: WARN — D43 compare: DIFFERS — …`; the module writes `D43 WDA-window compare: WARN — <domain>:
  <key> <type> <canonical JSON> → …`, the values one line and cut at 60 characters, unread domains and the state's
  marking in the same line. A state that cannot be read was `D43 compare: UNREAD — …`; here a WARN `not compared: …`. An
  export that failed was `export failed (exit n)`; here its exit, first line and a passed bound. The OK words are
  batch-11's.
- the typed compare is d43-gate.ts's map (type and canonical JSON), where sim-domains.ts compared Python's type name and
  `repr`: the same bool ≠ int distinction, one reader for restore and compare.
- `backup` creates the state file dirty in one exclusive write (`createExclusive`), where sim-domains.ts wrote it and
  the S2 protocol marks an existing one (abort.ts's markDirty): there is none before the backup, and an exclusive create
  also refuses one an earlier run left — stronger, kept (code review).
- nothing stale is removed before an export (io.ts removes nothing): each read is a fresh file, and a state or backup
  already there is refused, where both scripts removed and rewrote theirs.
- absent is never an export's failure: d43-gate.ts, sim-domains.ts and batch-11 took an export (or read) that failed
  saying `does not exist` for an absent domain, a wording no captured stderr shows and the host's defaults does not use;
  the module fails such an export, and tells absent from empty by a `defaults read` probe after an empty export
  (d43-gate.ts's intent: an absent-before domain is never deleted or imported into, so it must be proven absent, not
  guessed from an empty export). The protected read is absent on exit 1 with that domain's words only (`Could not find
  key … in domain '<it>'`, `Domain '<it>' not found.`), not past its bound: batch-11 took any non-zero exit with `does
  not exist` anywhere.
- the restore line has no port part (S6 owns the WDA), its label is batch-11's `D43 WDA-window restore`, and its words
  are words.ts's: `OK — …` or `ERROR — NOT VERIFIED — …` (NOT VERIFIED is no verdict word). Its hand commands go to
  RESTORE, one line each, `D43 (iOS): xcrun simctl spawn <udid> defaults …`, a path shell-quoted, where d43-gate.ts put
  them inline after `by hand:` and batch-11's RESTORE named `d43-gate.ts --restore`; restoreDomain keeps no separate log
  (what it did is its `performed`).
- the protected-key line keeps batch-11's step-line form and its OK / ERROR, and says unchanged, CHANGED or unread; an
  unread end is unread, never only "differs". It says "no batch writes it", not "this batch".
- the typed map's real is `float`, as d43-gate.ts and `defaults write -float` name it.

### S5: the Android chooser (2026-11-05, backlog T2 slice S5)

S5 adds two files, split as S4's: lab-chooser.ts, pure — the values and the words — and lab-emu.ts, the calls and the
files. Named apart from src/adapters/android-chooser.ts, which they reuse: the focus is its `chooserInFocus` over its
`CHOOSER_FOCUS_COMMAND`, the tree src's own uiautomator parser's (D66's `UiNode.disabled`, no private parser), the fresh
sheet its `chooserSheet`, a hand line's quoting adb-shell.ts's `shellQuote`, a shell call's argv its `adbShellArgv`.
lab-chooser.ts holds `preferredOf`, `leaksOf`, `lastChosenOf`, `acceptedOf`, `focusOf`, `checkExit` and its line,
`safeTap`, the tri-state reads (`shellReadOf`, `compareReads`), `handlersOf`, `installedOf`, `sanitizeFixture` and the
hand lines. lab-emu.ts holds, over the injected `Run` and `BatchFs`: `LabEmu` (had only through lab-device.ts's
`AndroidLab.guard()`: `emu avd name` must say `averi_lab`; every adb call names its serial first), `readCheck`,
`dismissChooser`, `labInstalled`, `tapSafely`, `clearLabEntry`, `cleanUp` and `chooserWindow` (the chooser as abort.ts's
dirty window). Two helpers moved to be shared: `exitText` to words.ts (from ios-defaults.ts) and `execOf` to bounded.ts
(from ios-domains.ts), each now tested where it lives. The sandbox needs no new file: src/ and lab-device.ts are in it.
Since T20a (2026-11-10) the preferred block's parse, the leak rule (`leaksOf`, `unflaggedOf`, `lastChosenOf`), the
handler query and its count, and the hand lines' parts (`adbLine`, `defaultHand`, `checkHand`, `HAND_PREFIX`,
`LAB_PACKAGE`, `PREFERRED_ARGV`) live in scripts/truth/chooser-readers.ts, a leaf outside batch/ that the live golden's
chooser premise shares; lab-chooser.ts re-exports them and keeps `preferredOf` and `handlersOf` as its CallResult
wrappers.

Tests: lab-chooser.test.ts (the pure parts over the committed fixtures: batch-9's whole `dumpsys package` trimmed to its
first lines, the Activity Resolver Table's averilab handlers as a decoy and the Preferred Activities block; batch-10's
`preferred` block, focus, handlers and AVD name; batch-9's role-holder and clipboard reads, all in tests/fixtures/batch/
as `*-api33-b<N>-*.txt`; and T4's resolver trees) and lab-emu.test.ts (a fake emulator whose uninstall clears the lab's
defaults but never a last-chosen entry, as batch-11 measured; every call checked in afterEach for another serial, an
`input tap` inside an "Always" node of the last tree dumped (read from its XML, not by the module's isAlways), a
`pm`/`settings`/`cmd`/`am` write, and an uninstall or install outside a reinstall). Each under 2 s; no device. Baselines
after review round 4, cold: lab-chooser.ts 99.89 % (884 mutants, 1 equivalent survivor: `chooserOf`'s state check, which
an unread read with no chooser makes moot), floor 97; lab-emu.ts 99.75 % (392 mutants, 3 timeouts, 1 equivalent: the
window's state-file check, which stateOf of no path makes moot), floor 98; abort.ts 98.04 % (its WARN put back; the same
survivors). The cold run of all twenty-four modules took 3 min 29 s. 40 hand mutants, one per decision branch or
boundary, each run bounded (a timeout counts as killed): 39 killed at once; the 40th (a node inside the target under the
point refused) killed by a test added for it. Review round 1: 15 more, on its fixes, 13 killed at once, 2 (exit 6 not
proving a reinstall; an entity decoded wrong) by tests added for them — the decoder then designed away (below).

Decisions S5 pins:
- the preferred read is only the `Preferred Activities User N:` block(s), each to the next top-level line, read line by
  line; a read that failed or a dump with no such block is unread, never "no lab entry". A lab entry is one whose
  component is `dev.averi.lab/…` or whose lines hold `Scheme: "averilab"`; its mAlways is read from its first line
  after it only. `mAlways=true` is a leak (a default); `mAlways=false` the last-chosen entry "Just once" writes; an
  entry with no mAlways line cannot be compared, so --check says unproven (exit 3, ERROR, the check's hand line, no
  write) — never a leak, so it never triggers a reinstall (code review). A non-lab default (Gmail's mailto) is no lab
  leak.
- --check's exits are batch-12's final ones, where they differ from d55-b11.ts: 0 clean, 1 a leak, 3 unproven, 4 a
  chooser up, 5 last-chosen entries every one accepted, 6 a last-chosen entry not accepted; and batch-12's order — a
  leak first, then a chooser in front, then unproven, then the last-chosen (d55-b11.ts put 5 before 4). The accepted
  list is the batch's, passed in (`AcceptedEntry`: Authority and component); none passed, every last-chosen entry is 6.
- one table, CHECK_OUTCOME (code review), gives each exit its verdict word, whether it proves the lab put back, its
  words around --check's own and its hand lines; --check's line, `clearLabEntry`'s proof, `cleanUp` and the window's
  restore all read it, so the window's words are the cleanup's, exit by exit.
- the cleanup by exit (batch-11.sh's D55 cleanup, batch-12's e5_check): 0 and 5 OK; 6 a WARN, no RESTORE, no
  reinstall tried; 3 and 4 ERROR with a hand line, 4 after BACK, HOME and a second check; 1 FAIL even when the
  reinstall clears it ("Always" is never tapped, so a default predates the batch or is a defect), the reinstall's
  hand lines when it does not.
- `clearLabEntry` (only for a default): refused, nothing done, with no pulled APK, no catalog to compare with, or a
  probe state file that cannot be marked dirty — a missing one too (code review: the protocol needs its dirty mark
  first), its hand line saying no reinstall was done because the state file was not marked dirty, and naming the probe's
  `--state` run (`StateRestore.stateCommand`, else those words) before the uninstall and install by hand (review round
  4: a `--restore` with no state does nothing); then the state marked dirty, BACK/HOME, `progress` started, uninstall,
  install of the pulled APK, `pm path` (after `adb get-state`), the APK pulled to a fresh `reinstalled[-n].apk`, its
  `assets/cells.json` equal to main's catalog, --check exiting 0, 5 or 6 — nothing else proves it (review round 1: a
  chooser in front over a preferred read that failed, exit 4, hid the read; every other exit is not proven, its hand
  line the check's); only then `progress` proven and the probe's state put back (`StateRestore`: the probe's
  `--restore`, and its command for a RESTORE line when it fails with no hand line of its own). Each step that fails gets
  its own hand line: the uninstall's (again), the install's (`pm path`, then the install), the pull's, unzip's or
  cells.json's (the proof by hand, then uninstall and install), the check's; each ends `then: <command>`, the probe's
  restore or the preferred read again. The module never writes the probe's state clean itself: the reinstall wipes the
  lab's data, and only the probe's restore, which writes it back and reads it back, may; the spec's "written clean only
  after the proof" holds as that order.
- `labInstalled`: `adb get-state` first (`unreachableOf`); not `device` is unknown and `pm path` is not asked; then
  `installedOf` reads `pm path`: `package:<path>` exit 0 installed, exit 1 with nothing said missing, anything else
  unknown. Unknown is never "missing", never "put back".
- `chooserWindow`'s restore: `adb get-state` first, before any key (review round 1): unreachable is unknown at once,
  nothing pressed and nothing put back; then BACK/HOME; inside the reinstall, `pm path`: unknown is not put back (hand:
  get-state, `pm path` once adb answers, then the install if it prints nothing), missing is installed again from the
  pulled APK, and the lab installed — again or found so — is proven by its cells.json as clearLabEntry proves it, or not
  put back; the probe's `StateRestore` whenever its state file is not clean, whatever the reinstall step — a decision
  corrected in review round 4: the code review ran it only once a reinstall had started, but the probe's `--restore`
  also undoes what the probe changed itself (it force-stops the lab, puts its state file back; the probe marks its state
  dirty mid-run), and abort.ts needs that file clean after, as batch-11 and batch-12 ran it; a clean state file needs no
  restore and says so; when no reinstall started, the note "nothing was wiped; the probe's state put back" is added
  after a restore that verified (review round 5), never instead of it; then --check, by CHECK_OUTCOME: 0 and 5 put back,
  6 put back with a WARN in the cleanup's own words (abort.ts's Putback may now carry `verdict: 'WARN'`, its step and
  cleanup line then WARN, no RESTORE), a default FAIL, the rest ERROR. Its hand lines are read when the abort asks:
  inside the reinstall the install line first, then the check's, then the state restore's command — never an uninstall
  no default was measured for (code review).
- a row target with more than one `resolver_list` is `not-unique`, naming the count (code review).
- the tri-state reads S6 wires: `readRoleHolders` and `readClipboard` (the clipboard by `cmd clipboard help`, API 33's
  `No shell command implementation.` unread) before and after a block, `compareReads` and `comparedLine` for their
  lines; `handlers` at the lab check; `sanitizeFixture` over any tree a batch keeps as a fixture. S5 gives the pieces,
  tested; S6's runner calls them.
- `treeOf` reads a dump twice (review round 1): src's parser for the tree and its bounds, and each `<node>` tag, paired
  with the tree node for node in document order, for what src's tree drops — resource-id, text and content-desc apart
  (src's label is content-desc before text), and `enabled`. A dump whose tags and parsed nodes do not pair up is no
  tree: their counts differ, or a tag's resource-id is not its node's identifier (review round 2). Tags are matched
  quote-aware (a `>` inside a quoted value ends none), and "Always" is asked of src's identifier as well as the tag. The
  tags are read as written, not entity-decoded: uiautomator writes an entity only for `&`, `<`, `>`, `"` and control
  characters, none in a resource id or in the word "always".
- `safeTap(dump, target, at?)` returns the one point or a named refusal: `no-target`, `not-unique` (a label two rows
  share: both lab rows say "AveriLab"), `no-sheet` (chooserSheet reads none: AOSP's with_default header, no chooser),
  `always` (the target or a label inside it reads as "Always"; any "Always" node holding the point or overlapping the
  target, an "Always" ancestor of the target too), `disabled` (UiNode.disabled: "Just once" until a row is selected),
  `enabled-unshown` (fail closed, review round 1: enabled only when the tag says `enabled="true"`, as d55-b11.ts and
  pure-b12.ts read it), `outside` (half-open rects: a far edge is
  the next node's), `off-centre` (a given point more than 2 px from the centre, batch-12's row-1 rule), `other-node`.
  "Always" is a resource id whose last segment is `button_always` whatever its words, or the word "always", any
  case, in the text or the content-desc, each read on its own — the fixtures hold English only, so a localized label
  is caught by the id alone. `\balways\b` also refuses the row of an app named "Always…": safe by design, the batch
  never needs to tap one. A row is named by its number from 1 or a text1/text2 label.
- src's tree carries no `clickable`, so "another clickable node" is any node holding the point that is not the target,
  inside it, nor above it — every clickable one and more (rows are not clickable; the list above takes the click).
- the tree is parsed with `NOT_JUDGED` (nothing drawn over): the tap is judged on the bounds as dumped, never widened.
- the tri-state reads: a read that exits 0 but says `Unknown command…` or `No shell command implementation.` (at a
  line's start) is unread, as is any failed one; `compareReads` is unchanged only when both were read and equal; the
  line OK unchanged, ERROR CHANGED, WARN not compared — never OK unread.
- `tapSafely` taps only at safeTap's point, after a fresh dump; a dump that fails or does not parse taps nothing.
- the labels are D55's (`D55 check`, `D55 cleanup`, `D55 (Android): …`), as S4's are D43's.

§1a and §1b rows S5 ports, each to its tests:
- "safeTap, never 'Always'": safeTap over T4's resolver trees (the twin row, row 1, "Just once" disabled then enabled,
  "Always" by id and by text, overlapping or touching, outside, off centre, a scrim, not unique, with_default) and
  tapSafely under the recorder's tap invariant; the cleanup's exits 0/1/3/4/5/6 and the FAIL after a clean reinstall
  (b11-dry `d55-left`) in cleanUp.
- "Preferred-activities read": preferredOf over batch-9's whole dump (its resolver-table decoy) and batch-10's block.
- "Abort-safe reinstall with `pm path`": clearLabEntry (the state dirty at the uninstall, the order of the calls, every
  failure's hand line) and chooserWindow (b11-dry `int-d55`, `int-reinstall`, `-nolab`, `-noadb`).
- §1b "Read-supported vs unchanged" (role holders, clipboard), "Fixture sanitising" (sanitizeFixture over every S5
  fixture and T4's trees), "Lab install verification" for Android as far as this module reads it (the reinstalled
  APK's cells.json, handlersOf), the lab guard (LabEmu.open), "Mark a state file dirty".

What S5 does not port, each with the slice that owns it or the reason:
- the Android lab check at the batch's start (pulling the installed APK, its cells.json against the catalog, the handler
  counts as a precondition, `ONLY=lab`): S6, the runner, from these pieces.
- the probe's own state put back (`run-as … cat > files/lab-state.json` with stdin): bounded.ts's Run takes no stdin,
  and the probe owns its before-state; it comes in as a `StateRestore`.
- batch-12's with_default and `pair` trees: not committed — lost with the scratch run folders; the with_default refusal
  is tested on T4's tree with AOSP's header synthesised; batch-13 captures the real one.
- d55-b11.ts's E1/E3/D55b/E2 legs, its `--analyze`, twinRow's label rule and treeFacts: the probe's, out of the repo
  (spec T2 §4).
- batch-12's `install -r` path (main's APK over the lab, data kept): a batch's own step, not the safety core.

Where S5 departs, on purpose, from d55-b11.ts, batch-11 (its final, 735-line version: the abort 160–180, the cleanup
539–583) and batch-12:
- the abort asks `adb get-state` before any key; batch-11 and batch-12 pressed BACK, BACK, HOME blind first, and asked
  get-state only when interrupted inside the reinstall.
- the abort proves a lab installed mid-reinstall by its cells.json; batch-11's abort installed the pulled APK and
  checked `pm path` only.
- batch-11's reinstall called itself cleared only on --check exit 0 after it; the module also on 5 and 6 (last-chosen
  entries, which no reinstall clears), and never on 4 or 3. A default is FAIL either way, as batch-11's review round 1
  made it ("then: …" after the default named).
- a last-chosen entry is never reinstalled for (batch-11 reinstalled on exit 5; batch-12 found AOSP 13's uninstall
  does not clear it).
- an unread focus is no chooser to press BACK for; BACK at most 3 times, then HOME, each followed by a 1 s settle.
- the reinstall proves itself by --check too, besides `pm path` and cells.json (batch-11 checked before `pm path`).
- the "other clickable node" rule is any other node there (src's tree has no `clickable`), stricter than d55-b11.ts's.
- hand lines are adb commands with every word shell-quoted, `D55 (Android): …`, ending in the probe's restore command
  when the batch gives one, where batch-11's named d55-b11.ts's CLI inline.

### S6a: the runner core (2026-11-05, backlog T2 slice S6, its first part)

The orchestrator split slice S6 in two: S6a, the runner core (this part), and S6b, the lab plumbing. S6a adds three
files, split as S4's and S5's are: runner-lines.ts, pure — the runner's config from argv and env (`configOf`: `--out`,
`--udid`, `--serial`, `--repo`, falling back to AVERI_BATCH_OUT, AVERI_LAB_UDID and AVERI_LAB_SERIAL), every line it
writes of its own (the checkout line, a need's lab line, a block not run for its needs, the backstop), a non-live
block's records and their rule, the ERROR lines of a log, this run's part of steps.log, the details printout, and
live.ts's argv — and runner.ts, the io: `runBatch`, which composes words, select, run-dir, steps, bounded, abort,
preconditions, cases and live-table into one run, in this order: the config, ONLY= and the knobs, each error a refusal →
the refusals (RESTORE, a dirty state file, an out folder inside the checkout, the batch's own) → the run's folders (one
fresh `run-<id>` per wanted block, meta's, and the `lab` folder on every run) and its own output → the AbortGuard armed
→ the preconditions (the checkout, then every wanted block's own, all before the first block runs) → each wanted block
in the batch's order, its needs first → the windows still open to RESTORE (finish) → each block's judge → the backstop →
the details → the SUMMARY → the exit code. A refusal exits 2 with no folder made and no call. A block is `{ id, label,
needs, preconditions?, stateful?, run(ctx), judge?, complete?, details? }`; its ctx gives the steps, bounded probes
owned by the block, the dirty windows, its folder and the lab folder, its verdict lines (several), `restoreHand`,
`verdictAndHand` (a line and its hand lines: S4's compare, S5's cleanUp), the protected-key line slot, `liveRun` and a
non-live block's `asks` and `record`. abort.ts gains `leave(block, hand)` (a block's hand lines to RESTORE now, said as
an ERROR), `interrupted`, and `head().errors` (the run's other ERROR lines in the abort SUMMARY); cases.ts's
`incompleteLine` takes any run result of Completeness's shape (a record's too) and the words for nothing asked (`none`),
so the not-run rule has one source. The code review moved a non-live block's records into a third file, records.ts
(`recordOf`, `recordGap`, `recordGapIn`, `writeAsked`, `writeDone`, `recordsIn`), out of runner-lines.ts and the
runner's class; its file-presence `recordsComplete` went in review round 5 (completeness is `assess`'s, below).

runner-lines.ts, runner.ts and records.ts join the run. runner-lines.ts is tested on its own
(tests/truth/batch/runner-lines.test.ts) and inside runBatch; runner.ts over a fake process seam that answers git, the
probes and live.ts by rules, with real files in a temp dir, a fixed clock and pid and a fake live-cases table
(tests/truth/batch/runner.test.ts: a fake two-block batch, one iOS block and one Android, yields the whole SUMMARY,
golden-style). The same run on the real process seam is tests/truth/batch/runner-proc.test.ts (its child
tests/fixtures/batch/runner-child.ts makes a git repo of one commit, runs two blocks, and is sent a Ctrl-C mid-block, or
ends by itself), in the normal suite only, as abort-proc.test.ts. Baselines, cold: runner-lines.ts 100 % (322 mutants, 2
timeouts), floor 98; records.ts 100 % (73 mutants), floor 98; runner.ts 99.29 % after review round 6 (422 mutants, 0
survived, 3 without coverage, each a `?? ''` turned into "Stryker was here!" — equivalent because that text holds no `#
Live golden:` header (live.ts's log, the rejudge summary) and no run's header (steps.log), so stepOutcome and stepsOfRun
read it as they read '' — not because the file is always there), floor 97; words.ts 100 % (143 mutants); run-dir.ts
99.38 % (161, the same equivalent); abort.ts 98.85 % (436 mutants: open's stateFile check, the equivalent named before,
and the same unreachable catch); cases.ts 99.64 % (275 mutants, the same equivalent). The first cold run left runner.ts
at 90.44 % (27 survived, 8 without coverage) and runner-lines.ts at 98.53 % (4 survived): each was killed by a test or
designed away, and one of them showed a real gap — a probe's progress line (a lone CR) in a log would have made the
SUMMARY refuse its ERROR line, so the run would have lost its SUMMARY (below). The cold run of all twenty-seven modules
took 3 min 57 s. Review round 1: 26 more hand mutants on its decisions, 25 killed at once, 1 by a test made stricter (a
block named `meta` thrown before a config refusal), and one Stryker survivor (a run counter only compared with 0)
designed away as a boolean. 95 hand mutants, one per decision branch, each run bounded (a timeout counts as killed): 85
killed at once, 9 by tests added for them (no block starts once the abort began, nor one whose need was being checked; a
judge is never run on nothing; a cut rejudge leaves its run incomplete; complete records with no judge are INTERRUPTED;
a block's own verdict is not judged again; the rejudge's exit-1 rule; a block's stopKept ends its own kept groups only;
a block named twice is thrown before a config refusal), 1 designed away (a list of the blocks that ran: a block not run
always holds its own INCONCLUSIVE line, which the judge's check reads).

Decisions S6a pins:
- a failed checkout or precondition makes the blocks INCONCLUSIVE, never a refusal (S3 left the choice to the runner):
  batch-11's way, not batch-12's. The checkout line is `ERROR checkout: <why> — every block INCONCLUSIVE, none run`;
  every block's line is `<label>: INCONCLUSIVE — precondition: <why>`; no block's own precondition is asked then, no
  need checked, no block run; the SUMMARY is written, and the exit is 2 (EXIT.nothingDone, review round 1: one name for
  2): an agent reading only the exit code must not see success. The same 2 when every wanted block was skipped for its
  needs or preconditions, and the SUMMARY then says so after the blocks' lines: `NOTE no wanted block ran (each one's
  why above)` (review rounds 2 and 3: it names no exit code, which is exitCodeOf's, and stays when a RESTORE makes the
  exit 1; EXIT's 2 is "nothing done": refused to start, with no SUMMARY, or no wanted block ran, with that NOTE); 1 for
  a FAIL or a RESTORE and 130 for an interrupt still come first. The failed checkout line is said once: a NOTE step, no
  ERROR line besides it in the SUMMARY. A precondition's why is one line (its first); a check that throws is not shown
  (`its check threw: <first line>`), never the run's error.
- the preconditions of every wanted block are asked before the first block runs, as batch-11's prechecks were: a block's
  state is never changed by an earlier block's run before its premise is read.
- a need is checked in full by the first wanted block that names it, so a need no wanted block names is never checked;
  its lab line (`LAB <need>: OK — <how>` or `ERROR — <why>`, one line) goes to the SUMMARY in the order checked. A need
  met is never trusted blindly for a later block (review round 1): before each later block naming it, its `alive` runs
  (a cheap recheck S6b supplies: `{ check, alive }`), or its `check` again when it has none; a failed recheck makes that
  block INCONCLUSIVE naming the need, adds `LAB <need>: ERROR — <why> (rechecked before <block>)`, and the need is down
  from then on — a need down is not asked again, every later block INCONCLUSIVE with its why. batch-11 checked each lab
  once (ANDROID_OK) and trusted it for the stretch. A block whose need failed is `<label>: INCONCLUSIVE — <need>: <why>;
  …`, every failed need named, and not run; a check that throws is a failed need and an ERROR line. A block naming a
  need the batch gives no check for, an id twice, an id openRun would refuse (run-dir.ts's `blockName`: no plain path
  segment, or `meta`; `lab` is allowed, batch-11's and batch-12's block) or a label with a colon: the batch's mistake,
  thrown before anything — before a config refusal too.
- a block not run (its precondition or need) gets a `SKIP <id> not run: <why>` step, not an ERROR: its INCONCLUSIVE line
  says the why once. batch-11 also wrote an ERROR line for it.
- the backstop reads a verdict of the block's own label (`<label>:` at a line's start, batch-11's grep): a cleanup or
  compare line is none. With nothing asked, `not run (see the ERROR lines)`; with runs asked, S3's incompleteLine over
  every live run's completeness and every record's gap; every run complete but no verdict written, `its <n> run(s) are
  complete, but no verdict line was written (see the ERROR lines)` — never a silent gap.
- a block's `judge` (its analyzer, device-free) runs only for a complete block, on both paths (the code review: a dead
  live run or a record that does not match got the judge's PASS and the gap vanished) — one rule, `assess`, on both
  paths (review round 5: files being there proved nothing — a rejudge summary holding kf1 of kf1–3 got the judge's
  PASS): S3's completeness over every live run plus records.ts's gap of every record, complete only when incompleteLine
  has nothing to say; a block's own `complete()` only adds a requirement (review round 6: it hid a live run's gap; false
  or a throw: not complete), and alone makes a block that asked nothing complete (a premise verdict, a capture); a block
  that declares `noRecords` (it asks no run and records none — one that asks, records or runs live anyway throws, naming
  it) is complete once its run returned before any abort began, and its `complete()` holds if given. At the normal end
  it runs after finish — the analyses after the restores, as batch-11 and batch-12 ran them — for a complete block with
  no verdict of its label, through the bounded runner; a throw is an ERROR line `<id> analyze: …`; an incomplete block
  gets the backstop's line (incompleteLine). The abort, by the same rule: a block with a verdict of its label keeps its
  own lines (the judge not run again); one whose run had started but not returned when the abort began stays
  INTERRUPTED, its gap the why and `rerun ONLY=<block>` kept (review round 6); one whose run returned but is incomplete
  is INCONCLUSIVE with its gap (incompleteLine); a complete one with a judge is judged; one that asked nothing, or is
  complete with no judge, INTERRUPTED. abort.ts's `AbortBlock.complete` may now be async and may say why a block is not
  complete (a string); it is read within what is left of the judges' budget — past it `completeness not read in time`, a
  throw `completeness not read: <first line>`, no budget left the budget's why (review round 6: a table that never
  loaded would have held the abort). A block with complete records and no judge is INTERRUPTED: nothing is invented. A
  block the abort judged whose judge wrote no verdict of its label gets `<label>: INCONCLUSIVE — interrupted: its judge
  wrote no verdict` after its lines (review round 1, MAJOR: such a block was missing from the abort SUMMARY): every
  wanted block has a line in both SUMMARYs, a test asserts it over every state a block can be in at the interrupt.
- the ERROR lines: this run's steps' (steps.ts, named `steps.log`), then every line starting ERROR of each `*.log` and
  analyze.txt in this run's folders (meta, lab, each wanted block, in that order) — not another file, not an earlier
  run's. Counted across all of them first, a step's line by what it says, its time aside (steps.log's lines only,
  `timed`: another log's line starting with a time is no ERROR line, batch-12's `^ERROR`), shown as first seen (the code
  review: a line said as a step and repeated in a log is one line) and bounded (review rounds 1 to 3, `logErrors`): one
  line per distinct ERROR in first-seen order, bare when said once in one log, else `(×<total>, in <block>/<file>, …)`
  naming the first 3 logs then `+<n> more` (50 of one must not bury a different one, nor one line show three times with
  three counts); each cut so the whole is at most 700 code points (`…` the last of what is cut); at most
  ERROR_LINES_SHOWN (20) distinct lines run-wide, then `… <n> more distinct ERROR lines (in <logs>)`; a listed log that
  cannot be read is `NOTE <file> not read: unreadable`, with `: a folder` when that is known, never skipped silently.
  Once the abort has begun, no further need of a block is checked. The abort SUMMARY carries the same section (head's
  errors replace its steps' own), where batch-12's abort printed the steps' only.
- a probe's text, a judge's or an analyzer's lines are split at CR LF, LF and a lone CR (a progress line) before the
  runner keeps them (`linesOf`, `linesIn`): the SUMMARY refuses a line break, and a probe's output must never cost the
  run its SUMMARY (found in the cold run's review of the survivors). A verdict or protected-key line a block writes with
  a break is the batch's mistake, thrown before it is kept, so the abort SUMMARY never meets it.
- `restoreHand` and `verdictAndHand` write RESTORE at once (abort.ts's `leave`), under `<name> run <id> left by <block>
  at <date> <time>; state to put back by hand:`, with an ERROR line naming the file; the SUMMARY's RESTORE section and
  the exit code (1) count them, and the next run refuses to start. batch-11 wrote its LATE_HAND only at the end; a line
  written at once survives an interrupt after it. A RESTORE that cannot be written sends the lines to stderr once.
- once the abort has begun, no block starts (nor one whose need was being checked), the normal end's judges and SUMMARY
  never run, and a verdict or protected-key line a block writes after it (its probe stopped, the block goes on) is only
  noted, not kept: what it says then is not trusted. A need's answer that comes after the interrupt is only noted too,
  never a lab line or an ERROR blaming the lab for the interrupt (review round 1, MAJOR). The exit is called
  synchronously right after the normal SUMMARY, so no signal can start a second SUMMARY between them.
- a non-live block's record: `asks(name, {kind: 'runs', runs})` writes `<name>.asked.json` before the run and
  `record(name, …)` `<name>.done.json` once done, each exclusive (never overwritten); a record before its asks, a value
  that is no record (a negative or a fraction) or a name that is no plain segment is thrown. Complete only when the runs
  recorded equal the runs asked; more is a gap too. One kind for now; another is a member of the union. Kept apart from
  S3's `.cases` (live runs only).
- `liveRun`: the `.cases` written first; live.ts from the checkout under test (`<repo>/scripts/truth/live.ts`, the
  running node, cwd the repo), its log to `<name>.log` through the call's log, bounded by the secs given (B_LIVE); a
  record written: its rejudge, bounded by `rejudgeSecs` or REJUDGE_SECS (120 s; batch-11 ran it unbounded), into
  `<name>.rejudge.txt`; each step's word S3's stepOutcome (the judged exit-1 rule for both). No device id for its
  platform: FAIL, nothing run, the `.cases` kept, so the backstop says "asked but never ran". Android gets `--serial`
  alone, iOS `--udid` and `--sources`; `--app` only for an app other than native.
- the config: argv first, the env second, an empty variable unset; the out folder and the repo absolute (RESTORE's hand
  lines name absolute paths); every error at once. A device id not given is left out of the config, and a need for it
  (S6b) fails. The repo defaults to the module's own checkout (MODULE_REPO).
- the `lab` folder is made on every run, wanted or not; a batch's block named `lab` (batch-11's and batch-12's) is that
  folder.

S6 obligations (every line of the T2 amendment, the module's headers and spec T2 that hands work to S6 or the runner),
each with the test that covers it in S6a, or S6b:
- S1, the missing-verdict backstop → runner.test.ts "the backstop: a wanted block with no verdict line …"; runner-lines
  "backstopLine", "hasVerdictOf".
- S1, the per-run steps and details printout → runner.test.ts "the details before the SUMMARY …"; runner-lines
  "stepsOfRun", "detailLines and detailsLines".
- S1, the `lab` folder made on every run → runner.test.ts "the run's folders: … the lab folder on every run".
- S1 and words.ts's header, the ERROR lines from each block's logs and analyze.txt → runner.test.ts "the ERROR lines:
  …"; abort.test.ts "head's errors"; runner-lines "errorLinesIn".
- S2, `gradlew --stop` with the lab build step → S6b.
- S2, the pkill of idb_companion and the lab's WebDriverAgent → the companion: a block's kept groups ended by its own
  `stopKept` and the rest by finish (runner.test.ts "a block's calls are its own"); the WebDriverAgent's kill → S6b.
- S3, a non-live block's own record (batch-12's `{"runs":3}`) → runner.test.ts "a non-live block's record …" and the
  abort's "a non-live record complete is judged by the abort; an incomplete one INTERRUPTED"; runner-lines "recordOf and
  recordGap".
- S3, the catalog's `--check` before the lab build → S6b.
- S3, `live_run` (live.ts with its record, then its rejudge, each a bounded step) → runner.test.ts "liveRun: …".
- S3, the backstop "not run (see the ERROR lines)" with incompleteLine's lines → runner.test.ts "a live run that died".
- S3 and preconditions.ts's header, refuse or INCONCLUSIVE for a failed checkout or ancestry → runner.test.ts
  "preconditions: a failed one makes the block INCONCLUSIVE, never a refusal …".
- S4, the compare's line as one of the D43 block's verdict lines and its hand lines to RESTORE (exit 1, the next run
  refuses) → runner.test.ts "a fake two-block batch …" (verdictAndHand), "RESTORE and the exit code"; abort.test.ts
  "leave".
- S4, the WDA window's orchestration (the `.cases` first, the WDA kill and the 4 s wait before the restore, the port
  8120 free check, the finportal reads at the iOS stretch's start and end, the compare after the end check,
  `d43-backupfail`'s INCONCLUSIVE), the restore line's port part → S6b; the protected-key line's slot is S6a's
  (`protectedLine`, the two-block test).
- S4, the iOS lab install verification (the installed cells.json against main's catalog) → S6b.
- S5, the Android lab check at the batch's start (the pulled APK's cells.json against the catalog, the handler counts as
  a precondition, `ONLY=lab`) → S6b.
- S5, the tri-state reads S6 wires (`readRoleHolders`, `readClipboard` before and after a block, `compareReads`,
  `comparedLine`), `handlers` at the lab check, `sanitizeFixture` over a kept tree → S6b.
- lab-emu.ts's header, the probe's own state put back (`StateRestore`) → S6b; its "the block's steps, its `.cases`, the
  SUMMARY assembly" → S6a (the ctx's steps, liveRun, the SUMMARY: the two-block test).
- ios-domains.ts's header, the WDA kill and the 4 s wait before the restore → S6b; "the steps, the SUMMARY assembly" →
  S6a.
- spec T2 S6, a fake two-block batch (iOS + Android, injected exec) yields the full SUMMARY, and a need's failure →
  INCONCLUSIVE → runner.test.ts "a fake two-block batch …", "needs: …".
- spec T2 S6, the abort mid-block → exit 130 with the abort SUMMARY → runner.test.ts "the abort mid-block …" and
  runner-proc.test.ts (a real Ctrl-C).
- spec T2 S6, backlog T2 → done: not in the branch (the orchestrator's docs commit, after S6b).

What of batch-11's and batch-12's runner S6a does not port, each with the slice that owns it or the reason:
- the lab plumbing above (S6b): the needs' checks, the lab build and its catalog check, the WDA window, the lab install
  checks, the tri-state reads, the finportal reads, idb_companion's and WDA's pkill by name.
- batch-11's `commit.txt` (HEAD, branch, main, the dirty count): the checkout line carries what a reader needs, and the
  details print it.
- batch-11's per-block details greps: a block names its own (`details: [{file, match?, cut?}]`).
- `cd $MAIN`: every call names its cwd or repo (`git -C`, live.ts's cwd).

Where S6a departs, on purpose, from batch-11 and batch-12:
- a failed need or precondition is a SKIP step and the block's INCONCLUSIVE, no ERROR line besides.
- a need is rechecked before each later block (its `alive`, else its check), where batch-11 trusted one check.
- no wanted block run exits 2, where batch-11 and batch-12 exited 0.
- the ERROR lines are counted run-wide (the steps' with the logs'), each distinct one once with its total and where, at
  most 20 shown, each cut at 700; an unreadable log is said.
- a block is judged only when complete, on both paths; batch-11 and batch-12 analyzed whatever a block left.
- the abort SUMMARY lists the ERROR lines of this run's logs as well.
- RESTORE lines from a block mid-run are written at once (`left by <block>`), not at the end.
- the rejudge is bounded (REJUDGE_SECS).
- a verdict written after the interrupt is not kept.
- what the runner keeps of a probe's or an analyzer's text is split at a lone CR too.

### S6b: the lab plumbing (2026-11-05, backlog T2 slice S6, its second part)

S6b adds four files on top of runBatch, nothing in runner.ts learning about a device: lab-lines.ts, pure — what a read
of the lab says (port 8120's listeners, a pkill's exit, the Open-in alert in an idb tree, an installed cells.json
against main's catalog, a JDK), the WDA window's restore line with its port part, the exact patterns the lab's own
processes are ended by, and the shapes the three share (`Opened<T>`, the device need's words) — and three io files over
the injected `Run` and `BatchFs`: ios-lab.ts (the `ios` need and its recheck, the health check with the Open-in alert,
the reset, the WDA window on its normal path and as the abort's dirty window, the iOS stretch's end, the run's last
step), android-lab.ts (the `android` need and its recheck, a need on the handler counts, the tri-state reads around a
block, a tree kept with its fitness as a fixture, the probe's own restore, the chooser's stretch) and lab-build.ts (the
two build needs, main's catalog checked once before either, `gradlew --stop`, the `lab` block). One pure file for the
three, not one each: they share its shapes (the cells compare both devices and both builds make, the patterns the iOS
kit and the run's end use), and each io file's own decisions are few — a file per pair would hold a handful of lines.
Each kit is a function of its options (`iosLab`, `androidLab`, `labBuild`) returning the `Need`s for runBatch (`{ check,
alive }`, S6a) and the block helpers, so a batch spreads them into its `needs` and calls the helpers from its blocks.
The guards are lab-device.ts's, reused through S4's `LabSim` and S5's `LabEmu`, never copied. runner.ts gains three
generic things: `fs` in a block's and a need's ctx; `asksLive` (a live run's `.cases` before a stretch that may never
reach it; its ask compared by records.ts's `canonicalJson`); and `lastly`, the run's last steps — abort.ts's `lastly`,
run on both ends after the kept groups are ended. runner.ts's header now shows how a scratch `batch-N.ts` composes the
needs, the blocks and the WDA window.

The four join the run. Tests: lab-lines.test.ts; ios-lab.test.ts, android-lab.test.ts, lab-build.test.ts over one fake
lab (tests/truth/batch/lab-fakes.ts: a simulator whose domains live in memory, `defaults export` writing the typed map
and plistlib reading it back, its WebDriverAgent's exit flipping com.apple.Accessibility from bool to int as batch-10
measured, port 8120's listeners, the Open-in alert, the app's container; an emulator over batch-10's and batch-9's
committed API 33 reads; the host's pkill, lsof, kill, unzip and builds), every call checked in afterEach for b11-dry's
VIOLATIONs made exact — device-check's simulator or ports named, a write to the schemeapproval domain, a pkill by a
pattern not the lab's, a kill of a pid port 8120 did not list, an adb call for another serial, any `input tap`, an idb
tap anywhere but the alert's Cancel; and lab-batch.test.ts, a fake batch through runBatch over a fake process seam (git
and live.ts answered as runner.test.ts does, every lab call by the fake lab): the lab block, an Android block with the
tri-state reads around its live run, an iOS block whose live run is in the WDA window — the whole SUMMARY, needs not
met, ONLY=lab, a build that fails, the abort inside the WDA window. Each under 2 s; no device. Baselines, cold, after
the code review (the final run; the numbers each round gave before are superseded and kept in scope.json): lab-lines.ts
100 % (272 mutants), ios-lab.ts 100 % (359, 1 timeout), android-lab.ts 100 % (180), lab-build.ts 100 % (266), each floor
98; runner-lines.ts 100 % (341), records.ts 100 % (96, canonicalJson now its), io.ts 96.43 % (84: freshIn now its, none
of its mutants surviving; the same three equivalents), runner.ts 99.32 % (444, the same three without coverage),
abort.ts 98.67 % (451: open's stateFile check, named before, and S6a's judges' budget `left <= 0` turned `< 0`, a
boundary only a left of exactly 0 ms reaches — killed in one cold run on timing — both equivalent), their floors kept.
The final cold run of all thirty-one modules took 313 s (the runs of this slice: 298 to 324 s). Two partial Stryker
rounds on the four first: 93.46 % over them (66 survived, 4 without coverage), then 99.53 % (5 survived), each survivor
killed by a test or designed away — an equivalent `typeof` filter, a release file read whose absence the regex test hid,
a re-read of port 8120 that changed nothing but a call, `?? nodeFs` where LabSim's default parameter already is; the
first cold run left two in runner.ts (the last steps handed only when there are some; an ask's fields in their order),
designed away and pinned. 43 hand mutants, one per decision branch, each run bounded (a timeout counts as killed): 42
killed at once, 1 by a test made stricter (the handlers' need's recheck reading its first answer again).

Decisions S6b pins:
- the builds are needs (`ios-build`, `android-build`): one that fails makes every block that names it INCONCLUSIVE
  naming why, by the runner's need rule; a block that does not name it runs on the app installed. main's catalog is
  `--check`ed once for the run, a bounded child of the checkout under test (`catalog.ts --check`, 120 s, its log in the
  lab folder), before either build: stale, both builds not met, "nothing built". Each build's product is proven too —
  the built app's cells.json, the built APK's assets/cells.json, main's catalog byte for byte. A need's recheck is its
  product still on disk.
- the iOS build: `xcodegen generate` then `xcodebuild -scheme AveriLab -destination id=<udid> -derivedDataPath build
  build`, each bounded (BUILD_SECS 2400 s, batch-11's B_BUILD, unless the batch names one), logged; never device-check's
  simulator as its destination; no pkill: its group ends at its bound (S2). The Android build: `java_home -v 17` and its
  home's release file (read only once there is a home, its own why when it cannot be), then `gradlew --console=plain
  assembleDebug` under that JDK and the SDK the config names (configOf: ANDROID_HOME, else the SDK under the home folder
  — read there, not in lab-build.ts), then `gradlew --stop` after every build, failed or not — the daemon leaves the
  call's group by design; a stop that fails is a WARN.
- the device needs ask their build themselves (review round 1, MAJOR 2: installing this run's build must not depend on
  the order of a block's needs, nor of the blocks): `iosLab({ build: kit.ios })`, `androidLab({ build: kit.android })`;
  each kit's build runs once for the run (`ensure`, shared with the build need's own check), so it is built and
  installed once whoever asks first. Met, the need installs it before its cells check: the iOS need by `simctl install`,
  the Android need by `adb install -r` — batch-11's lab install (its 1b/1c), not batch-12's E5 install -r, which stays
  the batch's own step. Failed, the need goes on to the app already installed, batch-11's way: its lab line `LAB <need>:
  WARN — <the build's why>; the app already installed is used: …` (a NeedResult met may now carry its `warning`, the lab
  line rendering it: review round 1, MINOR 3) — or, with `requireBuild`, it is not met.
- the `ios` need: the udid given and guarded (LabSim), the reset (unless `reset: false`), the finportal key's first read
  (a NOTE step), this run's build installed, the installed app's cells.json — read through `simctl get_app_container`,
  bounded, a copy kept in the lab folder — main's catalog. Its `alive`: the guard and `idb ui describe-all`, a read; no
  swipe, no reset.
- the reset is batch-11's order (the companion and the lab's WebDriverAgent ended, shutdown, boot and bootstatus -b
  under boundFor's 300 s, 3 s, the lab launched, 3 s, the health check), but it starts no idb_companion by hand:
  batch-11 ran `idb_companion --udid <udid> --grpc-port 10971 &` with IDB_COMPANION set, and a daemon cannot run under a
  bound; idb's client starts its own in the call's kept group (KEEPS_GROUP in bounded.ts), ended by stopKept and by the
  run's last step. Residual: batch-13's shakedown shows whether describe-all answers so on a freshly booted simulator.
- the health check before a run (`iosCheck`, batch-11's ios_check) is the batch's to call: the lab's WebDriverAgent
  ended, 2 s, the Open-in alert, then describe-all and a swipe. The alert (open-in-alert.py): Cancel only, at the centre
  of the button labelled so, at most 2 taps each read again after 1 s; a stuck alert or a failed health check resets; a
  reset that fails is an ERROR step and the check's why (the batch then skips the run, whose `.cases` makes the backstop
  say "asked but never ran"). An alert read that fails is a NOTE and the health check decides (open-in-alert.py's exit 2
  was no 1, so batch-11 went on to its health check too).
- the WDA window (`wdaWindow`), batch-11's order: the `.cases` of its runs (asksLive) → the health check → the backup
  (S4) → the window opened as an S2 dirty window (its state file, its block) → the work → the window put back: the lab's
  WebDriverAgent ended (pkill by its two patterns, `kill` to each listener of 8120), 4 s, port 8120 read — listened on,
  its listeners killed and read again after 1.5 s (d43-gate.ts) — then, only with the port proven free, the domains
  restored key by key (S4) → its line, `D43 WDA-window restore: … ; port 8120 free`, one of the block's verdict lines →
  the window closed only when that verified, else left open, so finish writes its hand lines to RESTORE and an abort
  tries it once more → the end check → the compare (S4), only once the state reads clean, by verdictAndHand. The abort's
  restore is the same put-back over its detached runner; its hand lines are the WebDriverAgent's kill first, then S4's
  per domain, then the compare by hand (review round 1, MINOR 4).
- the port (review round 1, BLOCKER): while port 8120 is not proven free — a listener left after its kill, or lsof
  unread — nothing is restored at all: a runner still running undoes a restore at its exit (batch-10's flip), and a
  state then clean would hide it. The line is `NOT VERIFIED — port 8120 still has a listener (pid …): the domains not
  put back …; the state file left dirty`, the window is not put back (the next run refuses), nothing is compared, and
  RESTORE holds the WebDriverAgent's kill, each domain's import, then the compare — pinned whole, on the abort and on
  the normal path (lab-batch.test.ts).
- `d43-backupfail`, and a health check before the window that fails past a reset: the block's own `INCONCLUSIVE — the
  WDA window did not run: <why> — no wda run (nothing changed)` and an ERROR step; nothing backed up or changed; the
  runs' `.cases` stay, asked and never run.
- the finportal key: read first in the `ios` need's check (after the reset, as batch-11 read it after its initial
  reset), last by `endStretch(ctx, sim)` in the batch's last iOS block, into S6a's protected-key slot (`protectedLine`);
  a start never read is unread, an ERROR line, never unchanged. A batch whose last iOS block does not run has no such
  line.
- the run's last step (`ios.lastly`): the lab's WebDriverAgent (its two patterns; port 8120's listeners, read again
  after their kill) and the lab simulator's idb_companion (`idb_companion --udid <udid>`) ended by exact pattern, after
  S2's kept groups — what they cannot own: a runner launchd holds, a companion that left its group — on both ends, only
  for a simulator the guard cleared this run; a NOTE, or a WARN naming what is not proven. abort.ts's `lastly` is
  bounded by LASTLY_SECS (60 s), its calls a scope stopped at the bound, a throw an ERROR line; runner.ts runs the
  batch's `lastly: LastStep[]` in order, a throw an ERROR line and the next still run.
- the Gradle daemon after an abort inside the Android build (review round 1, MINOR 6): the abort stops the build and
  refuses its own `gradlew --stop`; the build kit's `lastly` then runs `gradlew --stop` (bounded, from the build's
  folder, its JDK and SDK) at the run's end, on both ends, whenever a build was started and its own stop did not return
  — a NOTE, or a WARN when the stop fails.
- the patterns: lab-lines.ts throws before it names device-check's simulator, in any case; the WebDriverAgent's is
  anchored on the lab's derived data, `DerivedData/averi-wda-lab([/ ]|$)` (review round 1, NIT 7), so it matches the
  lab's xcodebuild and runner but never device-check's `DerivedData/averi-wda`, a folder named `averi-wda-labx`, this
  node process or a batch's own command line naming a folder `averi-wda-lab-runs` (pinned); lsof asks port 8120 only; a
  kill never names this process.
- the `android` need: the serial given and guarded (LabEmu), this run's build installed `-r`, the lab installed (`adb
  get-state` first, then `pm path`), its APK pulled into the lab folder (a fresh file: a second check never overwrites
  the first pull; `kit.pulled()` is the one a reinstall puts back), its assets/cells.json main's (a copy kept), the
  handler counts read (HANDLER_URLS, batch-11's shared and cell, unless the batch names others; a count that cannot be
  read is said "not read", never a number) and kept in android-handlers.txt. Its `alive`: the guard, `get-state`, `pm
  path`.
- the handler counts as a precondition are a need (`handlersNeed({ url: n })`), read again each time it is asked: S6a's
  preconditions are asked before any block runs, before any device need, so no device read can be one.
- the tri-state reads (`withReads(ctx, emu, { roles, clipboard }, work)`): each asked read before and after the work,
  compared (S5's compareReads), each line one of the block's verdict lines under its own label, never the block's — the
  backstop still asks for the block's own verdict. On API 33 both are unread: a WARN `not compared`, never OK.
- a tree a block keeps (`keepTree`) is always written, a fresh file, as evidence; S5's sanitizeFixture says in a NOTE
  whether it is fit to commit as it is — the run folder is outside the repo, so an unfit tree is never refused.
- the probe's own restore (`probeRestore`, S5's StateRestore): `node --import tsx <probe> --restore <args> --state
  <file>`, from the checkout (its cwd, where `--import tsx` resolves), bounded; put back only when it exits 0 and its
  state file reads clean; its command, every word shell-quoted, for a hand line. The chooser's stretch
  (`chooserStretch`): S5's window opened with its cleanup label and block, the work, cleanUp's line and hand lines by
  verdictAndHand, the window closed.
- the `lab` block (`labBlock(needs, { build })`): batch-11's and batch-12's, its folder the lab folder; it runs only its
  needs and says PASS when they were met — so `ONLY=lab` checks the lab and runs nothing else; a need not met makes it
  INCONCLUSIVE naming why; a build that failed while its device need went on to the installed app makes it a WARN naming
  the build, never "every lab need met" (review round 1, MAJOR 2).
- `asksLive(name, asked)` writes a live run's `.cases` at once; a later `liveRun` of that name asked the same writes
  none again, asked otherwise throws — what a run was asked is never overwritten. The ask is compared as canonical JSON
  (canonicalJson in records.ts, a run's identity asked and done: every object's fields sorted at every depth; review
  round 1, NIT 8).

S6b's checklist (the S6a part's rows marked S6b, the S4 and S5 parts' "not ported → S6"), each with its tests:
- S2, `gradlew --stop` with the lab build → lab-build.test.ts "the Android build … then gradlew --stop — always", "a
  build that fails: --stop still called after it"; lab-batch.test.ts "the whole SUMMARY of a clean run", "the lab build
  failing".
- S2, the pkill of the lab's WebDriverAgent → ios-lab.test.ts "the lab's WebDriverAgent ended by its exact patterns,
  port 8120 only", "the run's last step"; abort.test.ts and runner.test.ts "the run's last steps (lastly)"; lab-batch's
  clean run (its last four calls). idb_companion's: the same, and "the reset in batch-11's order".
- S3, the catalog's `--check` before the lab build → lab-build.test.ts "main's catalog --check before any build, once
  for both", "stale: both builds not met".
- S4, the WDA window's orchestration: the `.cases` first → ios-lab.test.ts "the whole window" (`asks …, state none`),
  runner.test.ts "asksLive"; the kill and the 4 s wait before the restore → "the restore comes after the WDA kill and
  the wait", "the whole window" (the waits); the port 8120 free check → "a listener of 8120 left after the wait"; the
  finportal reads at the stretch's start and end → "the ios need … met", "the finportal key's first read", "the iOS
  stretch's end"; the compare after the end check → "the whole window", "a late writer", lab-batch "a late writer after
  the restore"; `d43-backupfail` → ios-lab "d43-backupfail", lab-batch "d43-backupfail"; the restore line's port part →
  lab-lines.test.ts "the WDA window's restore line"; the abort's put-back → ios-lab "as the abort's dirty window",
  lab-batch "the abort inside the WDA window".
- S4, the iOS lab install verification → ios-lab.test.ts "the ios need … met", "a reset that fails, an install … a
  cells.json not main's, no app", "reset: false … an app with no cells.json keeps no copy".
- S5, the Android lab check at the batch's start (the pulled APK's cells.json, the handler counts as a precondition,
  `ONLY=lab`) → android-lab.test.ts "the android need …", "the handlers' need"; lab-batch "ONLY=lab runs just the lab
  check".
- S5, the tri-state reads, `handlers` at the lab check, `sanitizeFixture` over a kept tree → android-lab.test.ts "the
  tri-state reads around a block", "a tree kept"; lab-batch's clean run.
- lab-emu.ts's header, the probe's own state put back (`StateRestore`) → android-lab.test.ts "the probe's own state put
  back"; the chooser's stretch → "the chooser's stretch".
- ios-domains.ts's header, the WDA kill and the 4 s wait before the restore → as S4's row above.
- spec S6b's tests (a fake batch, need failures, ONLY=lab, the abort inside the WDA window, a lab build failure,
  `gradlew --stop` after the build) → lab-batch.test.ts, each named.

What of batch-11's and batch-12's lab plumbing S6b does not port, each with the reason:
- batch-11's explicit idb_companion start (`--grpc-port 10971`, IDB_COMPANION): above — a daemon cannot run under a
  bound; idb starts its own in a kept group. batch-13 shows whether that holds.
- the `adb devices` presence check before the Android guard (batch-11.sh:426): the guard's `emu avd name` fails for a
  serial adb does not list ("no emulator adb can name"), the same INCONCLUSIVE, one call fewer.
- the `shasum` of the catalog and of main's APK (batch-12.sh:342, 373): evidence a reader never used; the cells.json
  copies kept in the lab folder say what was compared.
- batch-12's APK_OK (main's APK checked without installing it, for E5's install -r): E5's own step; lab-build.ts proves
  its built APK's cells.json the same way.
- batch-12's with_default and `pair` trees, d55-b11.ts's legs and its analyzer: still the probes' (S5's row), batch-13
  captures the trees.
- folding ios-domains.ts's freshPathOf and lab-emu.ts's freshApkOf into io.ts's freshIn: each is pinned by its own tests
  and floor; a refactor for later, not this slice's.

Where S6b departs, on purpose, from batch-11 and batch-12:
- a failed build makes the blocks that name its need INCONCLUSIVE; a block naming only the device need runs on the app
  already installed with batch-11's WARN lab line (unless the batch requires the build).
- the `ios` need's recheck is a read (describe-all), where batch-11 checked the lab once and trusted it.
- while port 8120 is not proven free the domains are not restored at all; d43-gate.ts restored them all the same and
  only kept its state dirty.
- the lab's WebDriverAgent and companion are ended at the run's end only for a simulator the guard cleared this run;
  batch-11 pkilled them by its udid whatever happened.
- a kept tree is written whatever sanitizeFixture says, its fitness said.

Review round 1 (an independent reviewer): a BLOCKER — an abort inside the WDA window with a listener left on 8120 put
the domains back, the state read clean, and the runner's later exit flipped Accessibility again with nothing in RESTORE
to import (now: no restore while the port is not free, above); a MAJOR — this run's build was installed only when the
build need came before the device need (now: the device need asks its build); four MINOR and four NIT findings, each
above. 13 more hand mutants on the fixes, each bounded: all 13 killed at once. Its cold run (superseded by the final run
above): lab-lines.ts 100 % (283 mutants), ios-lab.ts 100 % (382), android-lab.ts 100 % (198), lab-build.ts 100 % (238),
runner-lines.ts 100 % (351), runner.ts 99.33 %, abort.ts 98.67 % (the same two equivalents), in 306 s; three survivors
of its first cold run (an OK restore's empty hand lines, an empty build answer, the lab block's failures joined)
designed away or pinned.

Review round 2: an lsof that fails or passes its bound (the port unread) blocks the restore exactly as a listener does,
now pinned (nothing written back, the state dirty, the hand lines kept); only a `gradlew --stop` that succeeded clears
the build kit's marker, so a stop cut by the abort or failed leaves the daemon to the last step (an abort landing during
`--stop`, pinned); and a block whose WDA window was not put back never ends PASS — `wdaWindow` returns `{ ran, putBack
}` and, not put back, writes the block's own `INCONCLUSIVE — the lab's settings not put back (see RESTORE)` at once, so
no judge's PASS stands for it. 4 more hand mutants, each bounded: all killed at once.

Code review (Standards and Spec): one builder for the WDA window's hand lines (lab-lines.ts's `wdaHandOf`: the
WebDriverAgent's kill first, each domain's import, the compare by hand), used by the blocked put-back, the window's hand
getter and a restore that fails with the port free — so the abort's RESTORE and the normal end's hold the same lines
(MAJOR, pinned whole both ways); the end-of-run Gradle stop says why its marker was kept (`its build was cut short`, or
`its --stop failed: <why>`); the lab's WebDriverAgent is ended through one function (`killLabWda`: the pkills, then
`portFree`), the run's last step too; and, by structure: `freshIn` moved to io.ts, the pure half holding no fs probe;
ANDROID_HOME's default in configOf (`BatchConfig.androidHome`); `isDeviceCheckSimulator` in lab-device.ts, every guard
and pattern asking it; NO_UDID and NO_SERIAL in runner-lines.ts; one device-need shape (lab-build.ts's `checkDevice`:
opened, its build asked, installed, its cells, met — with its warning) and its words; one `gradlew --stop` helper over a
`GradleCall`; `Opened<T>` for a guarded device; NeedResult's warning typed (`warning?: string`, the lab line rendering
`WARN — <warning>: <how>`); `canonicalJson` in records.ts, called directly. 8 more hand mutants, each bounded: all
killed at once.

The mutation run's headroom: the cold run of thirty-one modules takes about 5 minutes (298 to 324 s; 313 s the final)
against its 600 s bound; a slice like this one adds about 60 s. When a cold run nears the bound (say past 480 s), do not
raise it silently: split the run (scope.json's modules in two `--mutate` halves, each held to the same floors, both run
before a merge), or raise the bound by a decision recorded in this ADR.

### batch-13 fixes (2026-11-05, backlog T2, after batch-13's first device run on main 73f5ad0d)

What the live run found. The module ran its iOS blocks on the lab simulator end to end (the reset, a domains window, the
WDA window put back key by key, the finportal reads; RESTORE none) and idb started its own companion on a freshly booted
simulator with no explicit start — but only because idb's local companion list held no entry for the udid. Its rerun met
no iOS need: the run's last step had pkilled the companion, the entry stayed in idb's list, and every later idb call for
that udid trusted it and failed fast ("Failed to connect to companion …"); fb-idb drops a dead entry only when it lists
targets, and spawns a companion only for a udid it has no entry for. The Android need was refused because the lab AVD
was not running, the INCONCLUSIVE path S6b chose over batch-11's `adb devices` check, which held; but the refusal said
"no emulator adb can name", adb's own words thrown away. And the simulator's `defaults` says, byte for byte, what the
host's does for a missing domain and a missing key; its export of a missing domain is the one form that differs: a
binary plist of an empty dictionary, exit 0, where the host writes XML.

The three fixes:
- **The companion's entry dropped after every companion end.** ios-lab.ts's `endCompanion`: pkill by the companion's
  exact pattern, then `idb disconnect <lab udid>` (lab-lines.ts's `disconnectArgv`, bounded by HOST_SECS), which drops
  that simulator's entry alone — in the reset (pkill, disconnect, then the WDA, the shutdown, the boot, the health
  check) and in the run's last step, which both ends of the run (finish and the abort) run after the kept groups. A
  disconnect that fails or passes its bound is a typed warning — "idb's companion entry may be stale — idb disconnect:
  <why>" — on the reset's step (WARN, never OK), what a mid-run check hands back (`iosCheck`'s result, `wdaWindow`'s
  `warnings`, for the block to say), the need's line (the need's warning, before a failed build's: lab-build.ts's
  `checkDevice` joins the readying's and the build's) and the last step's WARN, never a failure by itself: the need is
  judged by its own checks (a stale entry left fails the health check after the reset). When describe-all fails with
  idb's "Failed to connect to companion", the health check's and `alive`'s why add one sentence naming a stale entry as
  the likely cause (`idbFailText`). No kept-group path can end the companion and so leave an entry behind: fb-idb 1.1.7
  spawns its local companion with `preexec_fn=os.setpgrp` (companion.py's `_spawn_server`, called with `reparent=True`
  by management.py's local spawn), so the companion leaves the idb call's process group, and neither `stopKept()` nor
  the abort's kept-group kill reaches it; only the exact-pattern pkill does, and a disconnect follows each one. (No
  production block calls `ctx.stopKept()` today.) This mattered: between blocks the runner rechecks a need by its
  `alive`, for `ios` a bare describe-all with no reset, so a stale entry left mid-run would hold `ios` down for the rest
  of the run.
- **The Android guard keeps adb's words.** lab-device.ts's guard keeps adb's first non-blank stderr line (execFile's
  error, and bounded.ts's `execOf`, which now puts the call's stderr on its throw), else the error's first line:
  "emulator-5554 is no emulator adb can name (adb: error: device 'emulator-5554' not found), not the lab's averi_lab:
  refused". Still a refusal after that one read; nothing is done to the device.
- **The simulator's export of a missing domain** is committed as written (tests/fixtures/batch/
  defaults-sim-export-missing-domain.plist, 42 bytes; it names no device and no path), and ios-domains-plist.test.ts
  pins that the host's plistlib reads it as the host's empty map and that a backup over it asks `defaults read` and
  classifies each domain absent exactly as over the host's export. The code already handled it; the test pins it. The
  d43-b10 README and the comments name both forms.

Decision: `idb disconnect <udid>`, never `idb kill`. `kill` clears every companion idb knows and SIGKILLs each one it
spawned — device-check's simulator's too, which no lab step may touch. `disconnect` takes the udid as its positional
argument (fb-idb 1.1.7 reads it as a udid only when it matches its simulator-udid pattern, upper-case hex, as simctl
lists the lab's) and calls the companion set's `remove_companion`, which, under idb's state lockfile, removes only the
entries of that udid: a no-op, exit 0, when there is none (so a reset on a clean list warns of nothing); a failure exits
1. It touches no process: the pkill before it does the ending. The lab fake now holds idb's list (none, live, stale),
and flags `idb kill` and any disconnect not of the lab udid alone as a violation. S6b's companion residual is answered:
idb starts its own companion only when its list has no entry for the udid; a pkill leaves one; the module disconnects
after each kill. S2's residual (whether idb_companion starts in the idb client's group) is closed by the same fb-idb
fact: it does not, it starts in a group of its own. `KEEPS_GROUP` keeps idb's groups all the same, the safe side at no
cost: a group is kept only while it still exists once its leader ended, and an idb call whose companion left it leaves
none (bounded.ts's comment says so).

Tests: ios-lab.test.ts "batch-13 fixes: idb's companion entry dropped …" (rerun 1's stale entry dropped by the reset,
the last step's disconnect and the next run met, a disconnect that fails or passes its bound on the need line, the last
step's WARN, a block's reset, the stale-companion why), lab-lines.test.ts "batch-13 fixes: idb's companion entry …",
lab-emu.test.ts and lab-device.test.ts "batch-13: …" (adb's words), ios-domains-plist.test.ts "batch-13: …" (the binary
export); lab-batch.test.ts's clean run and abort now end with the disconnect; lab-build.test.ts and bounded.test.ts pin
checkDevice's joined warnings and execOf's stderr in the modules' own tests, which are all the mutation run gives them.
31 hand mutants, each bounded: all killed. The first cold run left two equivalent survivors in ios-lab.ts (an optional
field spread only when defined and read only when defined), designed away (endCompanion returns its whys as a list; the
need spreads the reset's warning as it is). The final cold run, 358 s: ios-lab.ts 100 % (380 mutants, 1 timeout counted
killed), lab-lines.ts 100 % (283), lab-build.ts 100 % (273), bounded.ts 99.13 % (229, the same two equivalents), every
other module as before; floors unchanged (none rises by the achieved − 2 rule).

Code review (Standards and Spec): a mid-run reset's warning reached only the steps, so `iosCheck` now returns the
reset's shape (`{ ok: true, warning? }` or `{ ok: false, why }`, where it returned a why or undefined: a block tests
`.ok` before its live run) and `wdaWindow` returns the warnings of its two checks (`warnings`); the stale-companion
sentence names the likely cause only; the guard reads its AVD line and adb's words through one first-non-blank-line
helper, with no assignment inside its catch. 4 more hand mutants, each bounded: all killed (the end check's warning
only after a test made the end check reset). Its cold run, 368 s: ios-lab.ts 100 % (392 mutants, 1 timeout counted
killed), every other module at or above the run before; floors unchanged.

Live check (batch-13 rerun 2, 2026-11-05, main 51778d00). The reset ran the pkill, then `idb disconnect <lab udid>`
(exit 0, silent), then the WDA kill, the shutdown, the boot and the health check; describe-all spawned a fresh companion
(exit 0, 6.4 s) where rerun 1's stale entry had failed it in 0.25 s, and after the run's last step idb's list was empty.
Every lab need was met on both devices. Over the three runs every block reached its verdict on the module (T6i's one
BROKEN was the batch script's reading of capture's progress lines, not the module's), and no run left anything to
restore. batch-13 is done; the four lazy/recycler carousels wait for T6c (backlog), rn-format-eager for a batch that
builds the RN app.

### T2b-1: the module gaps batch-13 found (2026-11-05, backlog T2b)

Authoring batch-13 found the module short in six places, each worked around in the batch's own script: a changed
finportal key exited 0 unless a block of the batch's own judged it; an out folder the sandbox refused ended in a stack
trace; E5's cleanup line said `D55 cleanup`; D65's domains window said D43 on every line; a need's calls were recorded
nowhere; and runner.ts's example dropped what wdaWindow and iosCheck return. This part closes them, safety first.

- **A changed protected key fails the run (gap 4).** ios-defaults.ts's `protectedLine` says CHANGED as a FAIL step line
  (`FAIL com.apple.launchservices.schemeapproval's -->sk.finportal.myport CHANGED: …`); unread stays an ERROR, unchanged
  OK. NeedSpec gains `end` (and `endSecs`, NEED_END_SECS 60): once the last block is done, before `finish()` puts the
  windows still open to RESTORE, each need met at least once — in the order first met, once, never one never met or
  never asked, never once interrupted — has its end called with a need's ctx and the protected-key slot; a throw, or
  its bound passed, is an ERROR line (`LAB <need>: its end threw: …`, `… did not finish within …`) and its unread line,
  and the run still writes its SUMMARY; a line the end writes after its bound is kept aside (review round 1, below).
  The ios need's end opens the guarded simulator again and reads the key (a simulator refused then is an unread key): a
  batch needs no finportal block and no ONLY= rewrite to add one.
  `endStretch` stays, for a block that reads the key mid-run (each line is judged).
- **An out folder that cannot be made is a refusal (gap 7).** run-dir.ts's `openRun` turns any mkdir error but EEXIST
  into a refusal line in S1's vocabulary — the folder, the error's code (or its first line), the folders made before it
  (kept, empty: nothing is removed) — exit 2, no SUMMARY, no call.
- **cleanUp takes its label (gap 2).** `cleanUp(emu, { …, label })`, CLEANUP_LABEL unless given; chooserStretch passes
  `o.cleanup` to the cleanup and to the window alike, so the normal line and the abort's carry one label.
- **A domains window takes its labels (gap 3).** ios-defaults.ts's `DomainLabels` (the restore's and the compare's
  verdict labels, the backup's step, the RESTORE lines' starts), `D43_LABELS` (today's: the WDA window and lab-lines.ts
  unchanged) and `domainLabels(id)` (`<id> window restore`, `<id> window compare`, `<id> backup`, `<id> (iOS): `, the
  late writer's), as batch-13 relabelled D65's by regex; backup, restore, compare and domainsWindow take them.
- **A need's calls are recorded (gap 6).** The runner wraps the bounded calls of each need's check, alive and end and
  appends each to the lab folder's `<need>-calls.jsonl` through the run's fs (runner-lines.ts's `needCallLine`: one
  canonical JSON line — the need, the phase, the time, the command's base name, its args, its bound, its exit, and for
  a failed call its first line, no more than a step line says; no env), each argument and that line cut at 200 code
  points, at most 500 calls a need, then one line saying the rest were not recorded. A write that fails is one NOTE,
  never the need's failure. A need's name must be a plain path segment (its file is named by it).
- **The batch-level test of the work's own check (test gap)** and **runner.ts's example (gap 8)**: lab-batch.test.ts's
  D43 now checks inside the WDA window first and says a check not fit as its INCONCLUSIVE; with the lab sick and its
  reset unable to boot, the block is INCONCLUSIVE naming the reset's why, no wda run is made, and the window is still put
  back and compared. The header's example keeps wdaWindow's result and says its `warnings` and a failed iosCheck's `why`.

Decision: **a CHANGED protected key exits 1.** No batch writes the schemeapproval domain; a change is a defect or state
some other process left on the lab simulator, and every iOS verdict of the run was taken over it — success is the
wrong exit for that. The line keeps batch-11's step-line form and its domain and key; only its word changes, FAIL in
the step form, which words.ts's exit rule already reads (S1). Unread stays an ERROR and exits 0 alone, as before:
an unread key is not shown changed, and the SUMMARY says it. Batch-11's protected line (`OK / ERROR`, S4's choice above)
is so far superseded: OK, FAIL or ERROR.

The abort does not read the key. It exits 130 whatever a read says, so a CHANGED line could not change its exit; its
SUMMARY reads only what the run kept before the interrupt; and a read there would need an AbortGuard callback with its
own detached call and bound inside the abort's budget, for a line nobody acts on before a rerun — which reads the key at
its own start anyway. Its SUMMARY still says so in the slot (review round 1, below).

Dropped, with reasons:
- **Gap 1, an export of any domain.** Only batch-13's one-off probe of the simulator's binary export needed it, now
  pinned by the committed fixture (defaults-sim-export-missing-domain.plist). An `export` writes a host file at a
  path the caller gives — a simulator's own Preferences plist included — so "a read-only export of any domain" is not a
  read; done safely it needs a path rule, for no recurring caller. The allowlist stays the one argv builder. Reopen with
  a second caller.
- **Gap 5, LastStep given the config and folders; the abort's last steps before its judges.** Its one user was an
  evidence probe of the batch-13 fix, done and seen live. Moving the abort's last steps before its judges would spend
  their bound inside the judges' window and end the companion before a judge that may still need a kept group: a worse
  abort for a probe already done. Gap 6 covers the recurring diagnostic need. Reopen if a recurring last step needs the
  config.

Tests: words and lines in ios-defaults.test.ts, ios-domains-sim.test.ts, runner-lines.test.ts, run-dir.test.ts,
lab-emu.test.ts and android-lab.test.ts; the order in runner.test.ts (a need's end: once per need met, after the last
block, before finish, not for one not met or never asked, not once interrupted, a throw and a bound each an honest line;
a need's calls; the refusal); ios-lab.test.ts (the ios need's end) and lab-batch.test.ts (a CHANGED key exits 1 with no
block of the batch's judging it; ONLY= without an iOS block reads nothing). Every title names T2b batch-13 and its gap.
70 hand mutants, each from a .bak copy and bounded: all killed, two only after a test was added (the abort's own
SUMMARY never followed by the normal end's finish; a D65 restore over an unreadable state file). The first cold run
(331 s) left four equivalent survivors in runner.ts — an interrupted check before the needs' ends that endNeeds makes
again, a bare NeedCheck's typeof (a function has no `end`), and the late line's own oneLine (the step's rule asks it) —
designed away. The slice's cold run before review, 328 s (superseded by the runs below): runner.ts 99.40 % (495 mutants, 0 survived, the same three without coverage),
runner-lines.ts 100 % (359, 2 timeouts counted killed), ios-domains.ts 100 % (327), ios-lab.ts 100 % (396),
android-lab.ts 100 % (181), ios-defaults.ts 99.82 % (539, the same equivalent), lab-emu.ts 99.75 % (393, the same
equivalent), run-dir.ts 99.41 % (169, the same equivalent), every other module as before; floors unchanged (none rises
by the achieved − 2 rule). The run stays under the ~480 s line; the `--group` split is T2b-2's.

Review round 1 (one BLOCKER, one MAJOR, two MINOR): a late end turned a CHANGED key into exit 0 — the ios need's end had
no bound of its own, so it got NEED_END_SECS, 60 s, while its two calls are bounded at 120 s each, and a line it wrote
after the bound was only noted; and a need met once and then down before a later block never got its end. Now:
- the ios need's `endSecs` is IOS_END_SECS, computed from its calls' bounds (boundFor's, the guard's `simctl list` and
  the key's `defaults read`) each with its stop (GRACE_MS and CLOSE_GRACE_MS): 246 s, so with its calls bounded it
  cannot pass its bound before they do;
- an end past its bound keeps the lines it writes after aside; the runner checks once, just before it assembles the
  SUMMARY (no extra wait: after `finish()` and the judges), whether that end has settled, and if it has, with lines,
  they take the place of its unread line — a late FAIL exits 1;
- NeedSpec's `endUnread(why)` gives the protected-key line for a key its end could not say; the ios need's names the key
  unread and why (`… -->sk.finportal.myport unread: <start> at the start, unreadable (its end threw: … | its end did
  not finish within 246 s) at the end — …`), placed beside the LAB ERROR line, never only that;
- an end is asked for every need met at least once in the run, in the order first met, a need down later too (its end
  then opens the guarded simulator again; a refusal or a failed read is its unread line);
- the abort's SUMMARY adds `endUnread`'s line (`not read at its end: the run was interrupted (the abort reads
  nothing)`) for each need met whose end had not had its say before the interrupt.
So the slot says the key on every path: OK, FAIL or unread on the normal end, a need down later, a throw, a bound
passed; unread at the abort. MINOR 1 is the unread line above; MINOR 2 (a need's calls file keeps the host paths its
calls name, the checkout's among them) is accepted and said in needCallLine's comment: the file lives in the run's lab
folder, outside the checkout, beside the run's other files that name them. 26 more hand mutants, each bounded: all
killed, three only after a test was added (an end still running at the SUMMARY, one settled with no line, a line after
the interrupt). Its first cold run (359 s) failed ios-lab.ts's floor (97.37 %: IOS_END_SECS's argv words, equivalent
under xcrun's one bound) and left three equivalents in the late end's placement; both designed away. Its last cold
run, 335 s: runner.ts 99.45 % (543 mutants, 0 survived, the same three without coverage), ios-lab.ts 99.75 % (404, 1
equivalent: boundFor's empty argv given a word), every other module as before; floors unchanged.

Code review (Standards and Spec): runner-lines.ts stays pure — canonicalJson moved to words.ts (records.ts imports
io.ts); the need end's whys and notes are runner-lines.ts's named builders (endLateWhy, endThrewWhy, needEndError,
lateLineNote, callsNotRecordedNote, ABORT_UNREAD); NeedSpec is defined once (NeedCheck | ({ check; alive? } &
NeedEnding)) and read through one specOf, with no cast; `runEnd`. Two facts the round asked said. IOS_END_SECS, 246 s,
is a worst-case bound — both calls wedged to their own bounds and stopped — not the normal path's time, a second or
two. And the residual path: an end past its bound may still be running its read-only calls while `finish()` restores
the windows and the judges run; if it settles only after the SUMMARY is written, the slot keeps its unread line and a
FAIL it then writes reaches only steps.log (a NOTE). For the ios need that takes a call that outlives its own bound and
the SIGKILL after it, which bounded.ts's group kill rules out but for a group the system refuses to signal.
4 more hand mutants, each bounded: all killed. The final cold run of T2b-1, 340 s: runner.ts 99.45 % (545 mutants, 0
survived, the same three without coverage), runner-lines.ts 100 % (370, 2 timeouts counted killed), words.ts 100 %
(166), records.ts 100 % (73), ios-lab.ts 99.75 % (404, the same equivalent), every other module as before; floors
unchanged. It supersedes the cold runs above.

### T2b-2: the run in two groups (2026-11-05, backlog T2b)

The T2b-1 cold runs took 328 to 359 s against the ~480 s line set in the S6b part above, and every batch slice adds
about 60 s. Decision: **split the run, do not raise the bound.** Each scope.json entry names its `group`, `core` or
`lab`, and one Stryker process mutates one group against that group's tests only.

- `core`: the ten src/ modules and the batch's runner core — words, select, run-dir, steps, io, bounded, abort,
  preconditions, cases, live-table, records, runner-lines, runner (23 modules, 6 232 mutants). - `lab`: the lab modules
  — ios-defaults, ios-domains, lab-chooser, lab-emu, lab-lines, ios-lab, android-lab, lab-build (8 modules, 3 296
  mutants).

Groups by family, not by count: every test a module lists is a test of its own group (io's run-dir and steps tests,
runner-lines' and records' runner test in core; lab-chooser's lab-emu test, ios-defaults' ios-domains-sim test in lab).
A group's include is narrower than the single run's, and a narrower include can only lower a score: a test of the other
group no longer runs against its mutants. Lab's tests import core's modules (runner, bounded, io …) as what the lab is
built on; so each mutant's status in the two group runs was compared with main's single run (by file, mutator,
replacement and place): all 9 528 the same, none missing (review round 1's cold run: core 196 s, lab 61 s, 257 s in
all). tests/mutation/group.test.ts guards it from here on: every scoped test that imports a module of a group is in that
group's tests, the one named exception lab's tests importing core. The measured cost, from the last single cold run's
report (main after T2b-1, each mutant's `duration` summed per module, 3 075 worker-seconds in a 340 s run): core 2 217 s
(draw-order 422, geometry 188, abort 160, ios-typing 155, android-chooser 147, ios-liveness 146, bounded 144,
runner-lines 123, preconditions 115, fill-reformat 114, every other module under 100), lab 858 s (lab-chooser 255,
lab-lines 207, ios-defaults 168, every other module under 80). Expected from that: core about 230 s, lab about 100 s,
each under 60 % of the 600 s bound (360 s). Measured, cold, on unchanged code: **core 200 s, lab 62 s**; run one after
the other without `--group` (`npm run mutate -- --force`), 264 s in all (core 203 s, lab 60 s; about 340 s as one run
before). Core holds about three quarters of the cost, so core reaches the ~480 s line first; then split core (src/ from
the runner core, say), not the lab. Balancing now by moving runner-core modules into lab would split a family whose
tests import each other for some 30 s, while core's 200 s is 280 s under the line.

Mechanics. `scripts/mutation/group.mjs` (plain JS, so stryker.config.mjs loads it without tsx) checks the groups — an
entry without one or with an unknown one, or a group no entry names, is an error, and both configs throw on it — and
gives one Stryker process its group from `AVERI_MUTATE_GROUP`: its modules (stryker.config.mjs's `mutate`), their tests
(vitest.mutation.config.ts's `include`, read in Stryker's workers too: core's dry run ran 1 525 tests, lab's 346), and
its own incremental file, reports and temp dir (`reports/mutation/stryker-incremental-<group>.json`,
`mutation-<group>.json`/`.html`, `node_modules/.stryker-tmp-<group>`). No group in the env — Stryker started by hand —
is the whole scope under the old names, as before. `npm run mutate` (mutate.ts) takes `--group core|lab`; without it, it
runs core and then lab, each in a process group of its own bounded at 600 s (SIGTERM, then SIGKILL 10 s later; the group
SIGKILLed once Stryker has ended, so no worker outlives it), lab running whatever core's result, and fails if either
fails — the first failure's exit — with one summary line per group (`npm run mutate: core passed in 200 s`). Floors are
checked per group, exactly as before, against that group's entries. An interrupt goes to the running group and no later
group starts (exit 130). `--force` passes through; `--tempDirName <name>` becomes `<name>-<group>`; `--mutate
<patterns>` without `--group` matches each pattern, a path or a glob (node's `path.matchesGlob`; a Stryker range after a
path kept), against scope.json's modules and gives each group the modules it matched there — a path with its range, a
glob as the paths it matched, never the glob itself, which in the other group would mutate modules whose tests that
group does not run — running only the groups matched; a pattern matching no module is a refusal (exit 2, nothing
started); with `--group` it is passed on as given. `path.matchesGlob` is in node from 20.17 only, and a dev tool does
not raise the published package's `engines` (`>=20`): a pattern is looked up as a scope.json key first, and only one
with glob characters needs it — on an older node that one is refused, naming Node 20.17, while exact paths still work.

So the loop's command, `npm run mutate -- --force --tempDirName .stryker-tmp-<n>`, still runs everything, cold. A merge
may instead run `npm run mutate -- --group core --force` and `-- --group lab --force` as two commands, both required.
Adding a module is still its scope.json entry (now with its group) and, outside src/ and scripts/truth/batch/, its
folder in the sandbox allowlist. The threshold rule from here on: **each group's cold run stays under ~480 s**; when one
nears it, move modules between groups or add a group by an amendment here (the measured times beside it), or raise the
bound by a decision recorded here. A run without `--group` may then take longer than one command's 600 s; the merge then
runs the groups as separate commands.

Tests: tests/mutation/group.test.ts (the group errors, a group's entries, scopeOf's files and its throws, scope.json
itself, vitest.mutation.config.ts's include per group, the imports guard above) and tests/mutation/mutate.test.ts
(planRuns' groups, refusals, tempDirName and --mutate routing; main over a fake spawner: the order, each group's report
removed before its run, its env and bound, its own floors, a failure not stopping the next group, the first failure's
exit, a bound passed, an interrupt (Stryker killed by it, or exiting 130), no report, a refusal and a scope error
starting nothing; spawnBounded over node: the exit and env, a bound killing a grandchild that ignores SIGTERM, SIGINT
and SIGTERM passed on and their listeners removed). 39 hand mutants, each from a .bak copy and bounded: all killed;
review round 1 and the code review (glob routing, one group vocabulary — isGroup, GROUP_WORDS, filesOf, one ScopeEntry
type —, planRuns' option table, an injected signal source, main's rejection a message and exit 1) 25 more: all killed,
one only after a test was added (`-m=<file>`); review round 2 (a glob's matched modules per group; exact keys first, a
glob refused without path.matchesGlob) 9 more: all killed, one only after a test was added (a scope key with glob
characters, looked up as itself). The guard's exception, said exactly: lab's tests may kill core mutants (in main's
single run lab-batch.test.ts was the first killer of some), but core's own tests must suffice for core's floors; a
narrower include can only lower a score, a loud floor failure, never a false pass. Every module's score and mutant count
is the same as in T2b-1's final single run; floors unchanged.

### T2c: the budget tests on fake time (2026-11-05, backlog T2c)

The judging budget's races in abort.test.ts and the late need ends in runner.test.ts run on fake time (setTimeout,
clearTimeout and Date faked, tests/truth/batch/fake-time.ts), no longer on tiny real timers, so a stall of the machine
cannot flip them; the bounds are pinned exactly, a millisecond inside and a millisecond past, and a block left exactly
0 ms is spent.

## Amendment: run-case.ts joins the run (2026-11-06, backlog A11)

scripts/truth/run-case.ts (ADR 0044) is in the `lab` group, against tests/truth/run-case.test.ts: 100 %, 142 mutants, 0 survived; floor 98. It orchestrates
IO, but every device call sits behind its rig and its tests take milliseconds, as with T2's runner.ts.

What changes for the earlier text:

- **The allowlist.** Its cases import their judges, so Stryker's allowlist takes scripts/truth/*.ts rather than
  lab-device.ts and schema.ts alone, plus scripts/is-main.ts. Sources only, none of scripts/truth's outputs or data. The
  reasons the amendments above give for keeping a test out because its scripts were not copied no longer hold; those tests
  stay out because they test something else or run a real child, and none was moved.
- **The path rule.** tests/mutation/mutate.test.ts accepts a scope key under src/ or scripts/truth/batch/ at any depth, and
  a file directly in scripts/truth/. The allowlist copies no other subfolder.
- **The cold rule.** "A module they import", followed transitively, would grow by 64 files through run-case.ts's one value
  import of live-cases.ts (measured over scope.json's modules and tests with value imports: 154 to 218 files, 72 to 122 under
  src/): the cases, their judges and the src they name. None of them can change a run-case mutant's outcome, because its tests
  use synthesized judges and a fake lab. So for run-case.ts the rule stops one step out: itself, its test, tests/helpers/fake-lab.ts,
  and the modules it imports itself (lab-device.ts, live-carousel.ts, live-cases.ts, replies.ts, schema.ts). That adds 6
  files to the rule. The rule is prose, not code, so this sentence is the exemption.

## Amendment: the flush check and its readers join the run (2026-11-10, backlog T13)

`src/interact/flush-check.ts` decides whether a `fully: true` stop may say `fully visible`, and the harness reads its
replies through `scripts/truth/replies.ts` and judges them in `live-carousel.ts` and `live-visibility.ts`; until now no
floor held any of them. Each joins with its own floor, by the floor rule (two points under the whole number):

| Module | Group | Tests | Score | Floor |
| --- | --- | --- | --- | --- |
| src/interact/flush-check.ts | core | flush-check.test.ts | 96.57 % (350 mutants, 12 survived, 0 without coverage) | 94 |
| scripts/truth/replies.ts | lab | replies.test.ts | 97.86 % (374 valid, 7 survived, 1 without coverage) | 95 |
| scripts/truth/live-carousel.ts | lab | live-carousel.test.ts | 98.88 % (800 valid, 8 survived, 1 without coverage) | 96 |
| scripts/truth/live-visibility.ts | lab | live-visibility.test.ts | 72.70 % (1 293 mutants, 334 survived, 19 without coverage) | 70 |

Each entry lists the module's own test only; replies.ts's score, measured with replies.test.ts as the group's only test,
is the same 97.86 %. Every survivor of the first three is argued equivalent in its scope.json baseline.
live-visibility.ts joins at its measured score, low on purpose like draw-order's: 90 % would take some 230 more kills
over thirty judges, backlog row T21. Its T17 LOUD gate is held but for conjuncts that a cut geometry and a hedged lead
already imply: counted survivors (T21), not argued equivalent. T11's doubt sites in flush-check.ts — `!proof.doubted` (a
held reveal doubted once), the held hedge's `checked: false, why: 'held'`, and `doubted || doubtedFirst` (no stop while
a doubt is spent) — are killed by flush-check.test.ts and none is among its survivors: the floor now holds what T11's
hand mutants showed.

- **flush-check.ts's own tests only.** Its header names the round's play tables (scroll-flush-reveal.test.ts,
  scroll-rounds.test.ts) as its wiring's tests; with them in core's include the score was the same and core's cold run
  took 458 s, near the ~480 s line, since they also run against draw-order's and geometry's mutants. Without them:
  core 266 s.
- **The allowlist** takes two data files a scoped test reads, by name and nothing beside them: the one device record
  replies.test.ts's bandSaid test reads (docs/truth/live-records/android-k7-eyes-1.json) and the lab apps' cell catalog
  the live cases are built from (fixtures/apps/cells.json, read by catalogOf in scripts/truth/live-cases.ts).
- **The cost**, measured cold on this branch (`npm run mutate -- --force`): core 266 s, lab 127 s, 393 s in all (core
  200 s and lab 62 s at T2b-2). The lab's three modules add about 65 s; flush-check about 15 s.

## Amendment: the standing lab batch joins the run (2026-11-11, backlog T20b)

scripts/truth/batch/lab-run.ts, the standing lab batch (ADR 0041's T20b amendment), is in the `lab` group against
tests/truth/batch/lab-run.test.ts. It is mostly composition, but it holds logic worth scoring: `--groups` as a
selection beside ONLY=, the before check's own words, the after line for a default the run left, the state file, a
live block's verdict and what its FAIL names, and lab-run's own exit code. In the cold full lab group run after the
code review (279 s, every module at or above its floor) it scored 95.30 %: 512 mutants, 15 survived, 9 without
coverage, 1 runtime error. Its floor is 93.

The 25 not killed, split in its scope.json baseline:

- equivalent (9): `summary ?? ''` seeded, ACCEPTED seeded, the out folder's `meta` branches and `run-` filter (meta is
  undefined only on a refused config), the selection's `[]` on a refusal, leftLine's `at < 0` as `at <= 0`;
- untested (6): the build's bound (`B_BUILD`; no test waits one out), the `io` fallbacks the command line alone takes,
  the held seam's `stderr`, the hand line's placeholder for a serial not given;
- unreachable under the fakes only (2): `!opened.ok`, which a real emulator that goes away between the android need and
  the block can reach;
- unreachable (4): `apk === undefined` and its block (a met android need has pulled the APK);
- the entry guard's line (4).

The sandbox needs no new file: scripts/is-main.ts and scripts/truth/*.ts are already in it.

## Amendment: live-visibility.ts to its floor's rule (2026-11-11, backlog T21)

live-visibility.ts joined at T13's measured score, its floor low on purpose (T13's amendment). T21 brings it to the floor
rule. A second test, tests/truth/live-visibility-words.test.ts, joins its scope.json entry. It pins each judge's
verdicts whole: outcome, rule, reply kind, and the words live.ts prints and a record keeps. It pins them at their edges
(the slack, the region's chrome, the window's), and pins the cases the live run asks of the committed static truth
(tests/fixtures/truth, already in the sandbox).

The rest is code, each change behaviour-identical:

- **(a) T17's gate** loses its two redundant conjuncts. `!holds` goes because a cut geometry never holds a `fully` stop
  (stopHolds, CUT_GEOMETRIES). `lead !== undefined` goes because `hedgesCut` in replies.ts, false without a lead, is now
  the type guard. `g !== undefined` stays for the narrowing, as an equivalent survivor.
- **(b) judgeCarry** reads the table's clip without a guard: it returns before that point when there is no region, and
  showRegion only ever cuts a region from the clip.
- **(c) live-carousel.ts's judgeFully** loses its band block's `clip === undefined` arm and its "no carousel clip at
  launch" words. A band case with no clip at the launch SKIPs NO_CLIP before any premise, so the arm was unreachable.
- rectText takes no `null`: its callers pass only LabState's rects, a Rect or absent.

The committed RunRecords — 699: 696 under docs/truth/live-records and 3 under tests/fixtures — were rejudged in process
(`rejudge` in live-cases.ts) with `--groups forms` and with all six groups. Against a `git archive` of the base
4ffcf635 the output was byte-identical: 1 398 rejudges, the same sha1. That rejudge exercises (c): the D59b band cases
are among the records. It does not reach (a), since no record holds a hedged-stop verdict, nor (b) past its early return,
since every carry result is a MISMATCH. Those two rest on the stopHolds/CUT_GEOMETRIES and showRegion arguments above,
confirmed by a differential fuzz in the review. The golden stays Changed 0.

| Module | Before (cold) | After (cold) | Floor |
| --- | --- | --- | --- |
| scripts/truth/live-visibility.ts | 75.42 % (1 485 mutants, 345 survived, 20 without coverage) | 98.37 % (1 470 mutants, 23 survived, 1 without coverage) | 72 → 96 |
| scripts/truth/live-carousel.ts | 98.87 % (798 mutants, 8 survived, 1 without coverage) | 99.36 % (789 mutants, 5 survived, 0 without coverage) | 96 → 97 |

live-visibility.ts's 24 not killed are all equivalent, each argued in its scope.json baseline: the status trim and
three chrome boundaries of showRegion, judgeScroll's `g !== undefined` twice and its tap/tapped pair,
judgeAndroidTurn's `ok` clause (an ok verdict has no rule), the seeded `?? []`s, the platform words a judged context does
not read, judgeAtRest's view filter (reached only on an ok verdict, which judgeScroll's R-direction already rules
another view's moving stroke out of), touchTurns' halves swapped, and two guards kept for the type. judgeCarry's view
filter, first counted equivalent, is not: another view's still stroke reads as a carry past a narrow window (the
review's counterexample, now a test).

The cold lab group after the change ran in 265 s, every module at or above its floor.

## Amendment: fill-type.ts joins the run (2026-11-11, backlog T9)

`src/interact/fill-type.ts` decides when typed text has landed, how long the poll waits for it and what is sent again
(ADR 0023). It had no floor. At A9's review, hand mutants found three gaps in its switch, each since pinned in
tests/interact/fill-type.test.ts. It joins the `core` group against that one test file.

| Measured (cold, `npm run mutate -- --group core --force --mutate src/interact/fill-type.ts`) | Score | Mutants | Survived | Without coverage | Timeouts |
| --- | --- | --- | --- | --- | --- |
| before T9's tests | 86.32 % | 234 | 20 | 12 | 5 |
| after T9's tests | 93.16 % | 234 | 11 | 5 | 5 |

Its floor is 91, two points under the whole number.

The narrowed command exits 1 by design in a checkout with no earlier core run. checkFloors then fails on every other
core module ("has a floor, but Stryker did not mutate it", 31 lines). It exits 0 only when the group's incremental file
still holds those modules' last results. Read the narrowed module's own line, not the exit code.

**The poll's sleeps cost the run nothing.** `pollValue` sleeps `pollMs` between its reads through src/util/sleep.ts, up
to five reads a poll. fill-type.test.ts mocks that module (`vi.mock`), as read-tree.test.ts and the verify tests do, and
Stryker's vitest runner keeps the mock. The file's 55 tests take 10 ms. With the real sleep at their `pollMs: 1` they
take 443 ms, which would be paid again by each of the 234 mutants' runs. The narrowed run takes 15 s in all, with no src
change: the module needs no sleeper seam of its own.

T9 adds seven tests (one describe block). Each was checked red under its hand mutant. They pin:

- the `unread` arm: a field withheld on two reads running is unread after exactly two reads, and one not found on the
  first read is read again;
- a clear over a field that shows only its placeholder: no deletes sent, and the retype said `wiped: false`;
- a read-back without a tree: `unproven`, so no tail is typed;
- a sibling that gains text while the reading is no prefix: proves nothing, and nothing throws on the missing
  `missing`;
- a non-input that echoes the typing: not another input;
- an input laid over the field's own rect: told from the field by its identifier.

The 16 not killed are argued in its scope.json baseline:

- untested by design (2): the landed arm's `reformatted` and `focusUnread` guards emptied to true, which add an
  undefined key. The tests pin behaviour, not object shape (Consequences above). fill.ts, the one caller, tests both
  values only with `!== undefined`, so it cannot tell an undefined key from an absent one.
- equivalent (12):
  - `whereTyped`'s `unproven` emptied (4): a Whereabouts is read only as `field` or `elsewhere`.
  - `pollValue`'s `steady` on a landing or on an undefined reading (4): `steady` is never read there.
  - the sentinel strings (4): a key compared only with keys, and a gain that is no part of the missing text.
- unreachable (2): the switch's `never` default and its block.

The cold full core group, measured on this branch:

| Run | Wall time | Mutants | Tests in the dry run |
| --- | --- | --- | --- |
| before (main 62af3b2a's scope) | 344 s | 7 201 | 1 811 |
| after | 402 s | 7 435 | 1 866 |

Every module was at or above its floor. Every other module's score was unchanged. Both cold runs were of T9's first
commit, which also held an exact-landing assertion strict (fill-type 94.02 % there). Review round 1 put it back to
`toEqual`, which changes only fill-type's own two key mutants.

Part of the 58 s added is load, not fill-type. Its own mutants take 15 s narrowed. The timeouts outside fill-type rose
from 17 to 34, all of the extra ones in fill-landing.ts (1 to 11) and fill-reformat.ts (1 to 9). Their mutants now also
run against fill-type.test.ts, which reaches them through `landingOf` and `readingOf`, so their tests did change. But a
second cold run of the same commit, in review, did not reproduce the extra timeouts: 1 in fill-landing.ts and 1 in
fill-reformat.ts, 21 in all (16 outside fill-type), in 371 s. Both runs are under T13's ~480 s line.

## Amendment: live-finish.ts joins the run (2026-11-11, backlog D82)

scripts/truth/live-finish.ts (`finishRun`, live.ts's finish: the record written before the closes, every closer tried)
joins the `lab` group against tests/truth/live-finish.test.ts, at 100 % cold (21 mutants, 0 survived; narrowed with
`--mutate`, whose exit 1 is the fill-type amendment's): floor 98.
