// @ts-check
/**
 * `npm run mutate`: Stryker mutates the pure leaves below and runs each module's direct tests
 * (vitest.mutation.config.ts) against every mutant. A surviving mutant is a change to the code
 * that no test notices. ARCHITECTURE.md §8 says when it runs, how to add a module and how to
 * accept an equivalent mutant; docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md says why.
 *
 * The run is incremental: reports/mutation/stryker-incremental.json (committed) remembers each
 * mutant's result, and only mutants whose code or covering tests changed run again. A full cold
 * run that also rebuilds the file: `npm run mutate -- --force`.
 *
 * Stryker's own `thresholds.break` is one global score, so it is left unset: the per-module floors
 * live in scripts/mutation/mutate.ts, which runs Stryker and then checks them (`npm run mutate`).
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.mutation.config.ts', related: false },
  coverageAnalysis: 'perTest',
  mutate: [
    'src/flow/wipes-ahead.ts',
    'src/interact/fill-reformat.ts',
    'src/interact/fill-verdict.ts',
    'src/interact/fill-landing.ts',
    'src/ui-tree/draw-order.ts',
  ],
  incremental: true,
  incrementalFile: 'reports/mutation/stryker-incremental.json',
  timeoutMS: 5000,
  reporters: ['clear-text', 'progress', 'json', 'html'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
