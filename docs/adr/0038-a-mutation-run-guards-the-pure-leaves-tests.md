# 38. A mutation run guards the pure leaves' tests, each module held to its own floor

Status: accepted 2026-11-01 (backlog row D36, docs/plans/2026-10-30-performance-backlog.md). Tooling only: no
behaviour changes.

## Context

- Mutation checks were manual: each implementation loop's implementer and reviewer mutated by hand. Nothing ran them
  again, so a later change could weaken a test and nobody would notice.
- An evaluation on 2026-11-01 ran Stryker 10.1.1 with its vitest runner over the pure leaves, each against its own
  tests. The cold runs took 3 to 47 s per module. An incremental run with nothing changed took 2 s.
- geometry.ts reached 49.5 % from its own tests. Its broad suite takes over 12 minutes per run.
- vitest's `related` mode pulled in the whole suite, and the suite's `process.chdir()` callers fail inside Stryker's
  worker threads.

## Decision

**`npm run mutate` runs Stryker over five pure leaves, each against its direct tests only, and fails when any module's
score drops below its own floor.**

- Scope: `stryker.config.mjs`. The modules are flow/wipes-ahead.ts, interact/fill-reformat.ts, fill-verdict.ts and
  fill-landing.ts, and ui-tree/draw-order.ts. The test files are listed in `vitest.mutation.config.ts`, with
  `related: false`. The normal `npx vitest run` never reads that file.
- Incremental: `reports/mutation/stryker-incremental.json` is committed. A run repeats only the mutants whose code or
  covering tests changed. `scripts/mutation/mutate.ts` rewrites the file in a canonical form, so a run with nothing
  changed leaves it byte-identical.
- The ratchet: Stryker's `thresholds.break` is a single global score, and the baselines here lie 20 points apart
  (draw-order 77 %, the fill modules 99 to 100 %). One global break low enough for draw-order would let a fill module
  lose a fifth of its kills unnoticed. So one table in `scripts/mutation/mutate.ts` holds a floor per module, about
  2 points below its baseline. The script fails on a module below its floor, on a mutated module without a floor, and
  on a floor for a module Stryker did not mutate.
- Equivalent mutants are accepted one line at a time with `// Stryker disable next-line <mutator>: <reason>`. Such a
  mutant is Ignored and leaves the score.

## Consequences

- A branch that touches one of the five modules or its tests runs `npm run mutate` before merging. A full cold run
  (`npm run mutate -- --force`) once a month rebuilds the incremental file.
- A module joins the run only with direct tests of its own. Its floor is added to the table the same day.
- geometry.ts stays out until its direct tests exist. That is a backlog row of its own.
- draw-order's floor is low on purpose. Its 61 uncovered mutants (`paintsOver`'s own-content and clickable-layer
  exemptions, `drawnOver`, `drawnOverStrip`) and its idb keyboard band survivors are exercised by other suites
  (tests/verify/pixel-chrome.test.ts, tests/ui-tree/keyboard-position.test.ts, the adapters'), not by
  draw-order*.test.ts.
- The incremental file is about 3.5 MB of JSON. Two branches that both change a mutated module will conflict in it.
  Resolve such a conflict by taking either side and running `npm run mutate` again.
