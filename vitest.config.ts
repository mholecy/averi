import { configDefaults, defineConfig } from 'vitest/config';

/**
 * `npx vitest run`: vitest's defaults, less reports/, where a killed mutation run's sandbox leaves copies of the tests
 * (ADR 0038, A37). The mutation run's own config is vitest.mutation.config.ts.
 */
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, 'reports/**'] },
});
