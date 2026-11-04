# 38. A mutation run guards the pure leaves' tests, each module held to its own floor

Status: accepted 2026-11-01 (backlog row D36, docs/plans/2026-10-30-performance-backlog.md). Tooling only: no
behaviour changes.
Amended 2026-11-02 (D45: geometry.ts joined the run — see the amendment below).
Amended 2026-11-02 (D33: adapters/ios-liveness.ts joined the run — see the second amendment below).
Amended 2026-11-03 (D43: adapters/typeable.ts and adapters/ios-typing.ts joined the run — see the D43 amendment below).
Amended 2026-11-04 (T2 S1: scripts/truth/batch/ joined the run — see the T2 amendment below).
Amended 2026-11-04 (T2 S2: bounded.ts and abort.ts joined the run — see the T2 amendment's S2 part below).
Amended 2026-11-04 (T2 S3: preconditions.ts and cases.ts joined the run — see the T2 amendment's S3 part below).

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

S4 adds one file, ios-domains.ts: the lab simulator's three settings domains around the WDA window
(com.apple.keyboard.preferences, com.apple.Preferences, com.apple.Accessibility) and the read-only schemeapproval key.
Its pure parts moved from d43-gate.ts almost unchanged: the typed map (per top-level key its plist type, its canonical
JSON and a scalar's write text, so bool false is never int 0), `diffMaps`, `decideRestore` (each changed or missing
scalar written back typed, each extra key deleted — a key, never the domain; still differing, the whole backup imported;
after the import, `defaults delete <domain>` + import only when the import exited 0 and is proven to have merged; else
NOT VERIFIED with its hand commands; a domain absent before gets key deletes only, never a domain delete or an import)
and `restoreDomain`, which drives the rule to its end. Around them, over the injected `Run` and `BatchFs`: `LabSim`
(had only through lab-device.ts's guard), `backup`, `restore`, `compare`, `readProtected`, `protectedLine` and
`domainsWindow` (the window as abort.ts's dirty window, its restore over the abort's detached runner).

One file, not a pure file and an io one: the io is a few calls through the same seams abort.ts and preconditions.ts
take, every line of it tested over a recording fake, so all of it joins the run; a split would put the guard and the
state-file protocol apart from the rule they serve. ios-domains.ts reuses lab-device.ts's guards (spec T2: reuse, not
copy) by a static import, so the sandbox's allowlist names two more files of scripts/truth/: lab-device.ts and the
schema.ts it imports (their other imports are src/, already there, or types only) — the S1 part's "none of the rest of
scripts/truth/" holds but for these two. Its tests: ios-domains.test.ts (the pure parts over batch-10's real exports,
committed as typed maps in tests/fixtures/batch/d43-b10/ with the home folder as `~` and the udid a placeholder) and
ios-domains-sim.test.ts (a fake simulator: its domains in memory, `defaults export` writing the typed map to a real temp
file that the fake plistlib reads back; every call checked, in afterEach, for device-check's udid, ports 8100/8101 and
a non-read `defaults` on the schemeapproval domain — b11-dry's VIOLATION checks made exact). ios-domains-plist.test.ts
runs TYPED_PY on the host's plistlib over XML plists and is in the normal suite only: it starts python3. Baseline
100 % cold (823 mutants, 2 timeouts), floor 98. The first run gave 95.35 %: its survivors were killed by tests or
designed away, all named in scope.json. The cold run of all twenty-one modules took 2 min 39 s to 2 min 41 s. The S1
hygiene test now also refuses a device udid (8-4-4-4-12 hex) in the batch module's directories.

Decisions S4 pins:
- every call goes to the lab simulator: a `LabSim` exists only after `IosLab.guard()` (device-check's udid refused
  before any call; then `simctl list devices -j` must list the udid under `averi-lab …`), its `simctl list` run through
  the `Run` given; `using(run)` keeps the guarded simulator over another runner. Nothing in the module names a port.
- `defaultsArgv` is the module's only `defaults` argv builder. It runs read, export, write, delete and import, nothing
  else (rename, or an option first, throws). Any verb but a read that names the schemeapproval domain anywhere in its
  arguments, in any case, as a domain or inside a path, throws: no batch writes that domain since batch-11, so the
  refusal covers the whole domain, not only the finportal key; a future need is a new decision.
- the state-file protocol: `backup` writes `{dirty: true, udid, port: 8120, domains: [{name, backup}]}` (d43-gate.ts's
  shape, so its --restore can still read it) only after every domain was exported and read typed, or found absent; a
  failure writes none, so the window must not run. `restore` clears `dirty` only when every domain's read-back equals
  its backup, and refuses, doing nothing, a state of another udid, one that cannot be read, or one naming any domain
  but the three. `compare`, after the window's end, marks the state dirty again (abort.ts's markDirty) when a domain
  changed since the restore (a late writer) or could not be read, with LATE_HAND lines for RESTORE.
- a plist plistlib cannot read is unread, never an empty map: a backup that fails, a read-back that throws, a compare
  that says unread. unread is never unchanged, for a domain and for the protected key.
- `readProtected`: exit 0, the value (its trailing line breaks dropped, as `$(…)` did); exit 1 with defaults' "Could
  not find key" or "does not exist" (batch-8's and batch-9's stderr, committed), absent; anything else — another exit,
  a call past its bound whatever its stderr — unreadable, with why. `protectedLine` is OK only when both reads were
  read and hold the same value (or both are absent); else an ERROR saying CHANGED or unread.
- no file is ever overwritten or removed: each read of a domain is a fresh `<state>.<domain>.<after|readback|compare>
  [-n].plist` beside the state file, kept, so a restore run twice (the abort's after the block's own) leaves both; an
  earlier state file or backup at the path refuses the backup.
- python3's plistlib on a host file is bounded by PLIST_SECS (15 s, d43-gate.ts's); xcrun by bounded.ts's own 120 s.

§1a and §1b rows S4 ports, each to its tests:
- "D43 keys restored one by one": decideRestore over the real exports (the G4 pair and two domains equal; the flip
  bool true → int 0 written back `-bool true`; batch-10's read-back equal; the reverse flip bool false → int 0 put
  back and read equal), the rule stage by stage (extra key, every write flag, the import for a dict, the proven-merge
  fallback, NOT VERIFIED after an import that did not merge or exited non-zero and after the fallback, absent before),
  restoreDomain, and over the fake: backup, and restore (batch-10's run end to end and its line, a refused write and
  import, an unreadable read-back, a domain that fails beside two that are put back, a key already gone with batch-9's
  stderr, an absent-before domain, a state that cannot be cleared); domainsWindow for the abort path (batch-11.sh:158–
  164).
- "schemeapproval key read-only": defaultsArgv (every non-read verb, any key, another case, a path, a later argument),
  a forged state naming the domain, the recorder's invariants in every simulator test, readProtected (value, batch-8's
  and batch-9's stderr as absent, other failures and 142 as unreadable) and protectedLine.
- "`sim-domains --compare`": compare (unchanged; the runner flipping a key after the restore; an unreadable plist; a
  backup gone and an export past its bound; no state).
- §1b "Read-supported vs unchanged" (the tri-state) and "Mark a state file dirty / the state-file protocol": compare's
  and protectedLine's unread, backup/restore/compare's state file.
- check.sh 43–44 (`d43-latediff` WARN, `full-pass` compare OK) and `d43-restorefail`'s hand lines: compare and restore.

What of batch-11's and batch-12's iOS settings S4 does not port, each with the slice that owns it or the reason:
- the WDA window's orchestration (the `.cases` first, the kill of the lab's WebDriverAgent and the 4 s wait before the
  restore, the port 8120 free check d43-gate.ts's restore made, the finportal reads at the iOS stretch's start and
  end, `d43-backupfail`'s INCONCLUSIVE): S6, the runner. S4 gives the pieces.
- the lab install verification for iOS (the installed cells.json byte-equal to main's catalog): it reads the app's
  container, no read this module does — S6.
- d43-gate.ts's gate (G1–G5), its `--analyze` and its CLI modes: the probe's, out of the repo; the module's functions
  replace its `--restore`.
- `sim-domains --compare`'s own code: the scratch copies of sim-domains.ts and batch-11.sh predate the review round
  that added it, so compare is built from the analysis's description (typed, bool ≠ int, an unreadable plist a
  difference, a WARN and LATE_HAND in RESTORE); its words are S4's.

Where S4 departs from d43-gate.ts, sim-domains.ts and batch-11, on purpose:
- nothing stale is removed before an export (io.ts removes nothing): each read is a fresh file, and a state or backup
  already there is refused, where both scripts removed and rewrote theirs.
- absent needs a non-zero exit that is not a timeout, for an export and for the protected read (exit 1 there):
  batch-11 took any non-zero exit with the words, d43-gate.ts any exit.
- the restore line has no port part (S6 owns the WDA), its label is batch-11's `D43 WDA-window restore`, and its words
  are words.ts's: `OK — …` or `ERROR — NOT VERIFIED — …` (NOT VERIFIED is no verdict word). Its hand commands go to
  RESTORE, one line each, `D43 (iOS): xcrun simctl spawn <udid> defaults …`, a path shell-quoted, where d43-gate.ts
  put them inline after `by hand:`; restoreDomain keeps no separate log (what it did is its `performed`).
- the protected-key line keeps batch-11's step-line form and its OK / ERROR, and says unchanged, CHANGED or unread; an
  unread end is unread, never only "differs". It says "no batch writes it", not "this batch".
- the spec's "a key absent before is never deleted" is read as d43-gate.ts's rule, ported exactly: a key the run added
  is deleted, one by one; what is never deleted is a domain absent before (no domain delete, no import). The why: with
  no backup there is nothing to bring back, so a domain delete could only take keys a system process wrote meanwhile.
- the typed map's real is `float`, as d43-gate.ts and `defaults write -float` name it.
