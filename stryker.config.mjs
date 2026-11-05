// @ts-check
import { scopeOf } from './scripts/mutation/group.mjs';

/** One group's part (AVERI_MUTATE_GROUP, set by mutate.ts; none: the whole scope). Throws on a bad group. */
const { scope, files } = scopeOf(process.env);

/**
 * `npm run mutate` (scripts/mutation/mutate.ts): Stryker mutates the modules of one group of scripts/mutation/scope.json
 * (scripts/mutation/group.mjs), each against its direct tests (vitest.mutation.config.ts); each group has its own
 * incremental file, reports and temp dir. Why, when, the groups, and how to add a module:
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
    // ios-domains.ts, lab-chooser.ts and lab-emu.ts reuse lab-device.ts (T2 S4, S5), a static import: that file and the
    // one it imports, no more.
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
  mutate: Object.keys(scope),
  // Incremental (a plain `npm run mutate`) is a local convenience; a merge runs `-- --force`, cold (ADR 0038).
  incremental: true,
  incrementalFile: files.incremental,
  timeoutMS: 5000,
  reporters: ['clear-text', 'progress', 'json', 'html'],
  clearTextReporter: { reportMutants: false },
  jsonReporter: { fileName: files.json },
  htmlReporter: { fileName: files.html },
  // Under node_modules: vitest's default exclude keeps a leftover sandbox's copied tests out of `npx vitest run`.
  tempDirName: files.tempDir,
  cleanTempDir: 'always',
};
