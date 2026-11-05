import { defineConfig } from 'vitest/config';
import { scopeOf } from './scripts/mutation/group.mjs';

/**
 * The tests `npm run mutate` (stryker.config.mjs) runs against each mutant: exactly the direct tests
 * scripts/mutation/scope.json names for the modules of the group this Stryker process mutates (AVERI_MUTATE_GROUP,
 * inherited by Stryker's workers; none: every module's), so a group's dry run runs its own tests only. Not the whole
 * suite: a full run per mutant takes minutes, and the suite's `process.chdir()` callers fail in Stryker's worker
 * threads. The normal `npx vitest run` never reads this file (vitest picks up only `vitest.config.*`).
 * Why and when: docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md.
 */
export default defineConfig({
  // Its own cache: a mutation run must not overwrite the normal suite's results cache (node_modules/.vite/vitest).
  cacheDir: 'node_modules/.vite-mutation',
  test: { include: scopeOf(process.env).tests },
});
