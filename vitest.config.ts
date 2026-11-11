import { configDefaults, defineConfig } from 'vitest/config';

/**
 * `npx vitest run` (`npm test`): vitest's defaults, and never reports/ — a mutation sandbox left there
 * (stryker.config.mjs's temp dir, reports/mutation/stryker-tmp-<group>, after a killed run) holds copies of the tests.
 * The mutation run's own config is vitest.mutation.config.ts. Why: docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md (A37).
 */
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, 'reports/**'] },
});
