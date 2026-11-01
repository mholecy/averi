// @ts-check
/**
 * `npm run mutate`: Stryker mutates the pure leaves below and runs each module's direct tests
 * (vitest.mutation.config.ts) against every mutant. A surviving mutant is a change to the code
 * that no test notices. ARCHITECTURE.md §8 says when it runs, how to add a module and how to
 * accept an equivalent mutant; docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md says why.
 *
 * A merge runs it cold, `npm run mutate -- --force`. A plain `npm run mutate` is incremental, from this
 * checkout's last run (reports/mutation/stryker-incremental.json, never committed): it reruns only the mutants
 * whose module or covering test files changed, and does not see a change in a module they import.
 *
 * The per-module floors live in scripts/mutation/mutate.ts, which runs Stryker and then checks them.
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
  clearTextReporter: { reportMutants: false },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  // Under node_modules: vitest's default exclude keeps a leftover sandbox's copied tests out of `npx vitest run`.
  tempDirName: 'node_modules/.stryker-tmp',
  cleanTempDir: 'always',
};
