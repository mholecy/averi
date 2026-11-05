// @ts-check
import { readFileSync } from 'node:fs';

/**
 * `npm run mutate` (scripts/mutation/mutate.ts): Stryker mutates the modules scripts/mutation/scope.json names, each
 * against its direct tests (vitest.mutation.config.ts). Why, when, and how to add a module:
 * docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  testRunner: 'vitest',
  // The sandbox is an allowlist: what the covered tests load, never the whole tree — an untracked build (the RN lab's
  // ios/Pods) holds files Stryker cannot copy, and failed the run in 1 s (D36b).
  ignorePatterns: [
    '/*',
    '!/src/',
    '!/tests/',
    // Only scripts/mutation/ (scope.json): un-ignoring it alone brings all of scripts/ back in Stryker's walk.
    '!/scripts/',
    '/scripts/*',
    '!/scripts/mutation/',
    // The device batches' core (scripts/truth/batch/, backlog T2): its own folder only, never the rest of scripts/truth/.
    '!/scripts/truth/',
    '/scripts/truth/*',
    '!/scripts/truth/batch/',
    // ios-domains.ts reuses lab-device.ts's guards (T2 S4), a static import: that file and the one it imports, no more.
    '!/scripts/truth/lab-device.ts',
    '!/scripts/truth/schema.ts',
    '!/package.json',
    '!/tsconfig.json',
    '!/tsconfig.test.json',
    '!/stryker.config.mjs',
    '!/vitest.mutation.config.ts',
  ],
  vitest: { configFile: 'vitest.mutation.config.ts', related: false },
  coverageAnalysis: 'perTest',
  mutate: Object.keys(JSON.parse(readFileSync(new URL('./scripts/mutation/scope.json', import.meta.url), 'utf8'))),
  // Incremental (a plain `npm run mutate`) is a local convenience; a merge runs `-- --force`, cold (ADR 0038).
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
