# 38. A mutation run guards the pure leaves' tests, each module held to its own floor

Status: accepted 2026-11-01 (backlog row D36, docs/plans/2026-10-30-performance-backlog.md). Tooling only: no
behaviour changes.
Amended 2026-11-02 (D45: geometry.ts joined the run — see the amendment below).
Amended 2026-11-02 (D33: adapters/ios-liveness.ts joined the run — see the second amendment below).

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
