# 38. A mutation run guards the pure leaves' tests, each module held to its own floor

Status: accepted 2026-11-01 (backlog row D36, docs/plans/2026-10-30-performance-backlog.md). Tooling only: no
behaviour changes.

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
