import { defineConfig } from 'vitest/config';

/**
 * The test files `npm run mutate` (stryker.config.mjs) runs against each mutant: exactly the
 * direct tests of the mutated modules. Not the whole suite: a full run per mutant is minutes, and
 * the suite's `process.chdir()` callers fail in Stryker's worker threads. The normal
 * `npx vitest run` does not read this file (vitest picks up only `vitest.config.*`).
 */
export default defineConfig({
  test: {
    include: [
      'tests/flow/wipes-ahead.test.ts',
      'tests/interact/fill-reformat.test.ts',
      'tests/interact/fill-verdict.test.ts',
      'tests/interact/fill-landing.test.ts',
      'tests/ui-tree/draw-order*.test.ts',
    ],
  },
});
