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
Amended 2026-11-05 (T2 S6a: runner-lines.ts, runner.ts and records.ts joined the run — see the T2 amendment's S6a part).

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
ends by itself), in the normal suite only, as abort-proc.test.ts. Baselines, cold: runner-lines.ts 100 % (318 mutants, 2
timeouts), floor 98; records.ts 100 % (100 mutants), floor 98; runner.ts 99.20 % after the code review (373 mutants, 0
survived, 3 without coverage, each a `?? ''` turned into "Stryker was here!" — equivalent because that text holds no `#
Live golden:` header (live.ts's log, the rejudge summary) and no run's header (steps.log), so stepOutcome and stepsOfRun
read it as they read '' — not because the file is always there), floor 97; words.ts 100 % (143 mutants); run-dir.ts
99.38 % (161, the same equivalent); abort.ts 98.10 % (421 mutants, the same equivalents and unreachable catch); cases.ts
99.64 % (275 mutants, the same equivalent). The first cold run left runner.ts at 90.44 % (27 survived, 8 without
coverage) and runner-lines.ts at 98.53 % (4 survived): each was killed by a test or designed away, and one of them
showed a real gap — a probe's progress line (a lone CR) in a log would have made the SUMMARY refuse its ERROR line, so
the run would have lost its SUMMARY (below). The cold run of all twenty-seven modules took 3 min 51 s. Review round 1:
26 more hand mutants on its decisions, 25 killed at once, 1 by a test made stricter (a block named `meta` thrown before
a config refusal), and one Stryker survivor (a run counter only compared with 0) designed away as a boolean. 95 hand
mutants, one per decision branch, each run bounded (a timeout counts as killed): 85 killed at once, 9 by tests added for
them (no block starts once the abort began, nor one whose need was being checked; a judge is never run on nothing; a cut
rejudge leaves its run incomplete; complete records with no judge are INTERRUPTED; a block's own verdict is not judged
again; the rejudge's exit-1 rule; a block's stopKept ends its own kept groups only; a block named twice is thrown before
a config refusal), 1 designed away (a list of the blocks that ran: a block not run always holds its own INCONCLUSIVE
line, which the judge's check reads).

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
  PASS): its own `complete()` when it gives one (a throw: not complete); for a block that declares `noRecords` (it asks
  no run and records none — one that asks, records or runs live anyway throws, naming it), its run returned before any
  abort began; else S3's completeness over every live run plus records.ts's gap of every record, complete only when
  incompleteLine has nothing to say. At the normal end it runs after finish — the analyses after the restores, as
  batch-11 and batch-12 ran them — for a complete block with no verdict of its label, through the bounded runner; a
  throw is an ERROR line `<id> analyze: …`; an incomplete block gets the backstop's line (incompleteLine). The abort, by
  the same rule: a block with a verdict of its label keeps its own lines (the judge not run again); an incomplete one is
  INCONCLUSIVE with its gap (incompleteLine: an interrupted run is usually incomplete, and that is the honest line); a
  complete one with a judge is judged; one that asked nothing, or is complete with no judge, INTERRUPTED. abort.ts's
  `AbortBlock.complete` may now be async. A block with complete records and no judge is INTERRUPTED: nothing is
  invented. A block the abort judged whose judge wrote no verdict of its label gets `<label>: INCONCLUSIVE —
  interrupted: its judge wrote no verdict` after its lines (review round 1, MAJOR: such a block was missing from the
  abort SUMMARY): every wanted block has a line in both SUMMARYs, a test asserts it over every state a block can be in
  at the interrupt.
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
