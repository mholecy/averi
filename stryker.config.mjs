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
    // catalog.ts's entry guard; run-case.ts's cases import catalog.ts.
    '!/scripts/is-main.ts',
    // The device batches' core (scripts/truth/batch/, backlog T2) and scripts/truth's own modules: run-case.ts (A11)
    // imports the live cases, which import their judges. Sources only: never its batch outputs or calibration data.
    '!/scripts/truth/',
    '/scripts/truth/*',
    '!/scripts/truth/batch/',
    '!/scripts/truth/*.ts',
    // The device records a scoped test reads (replies.test.ts's bandSaid, k7, backlog T13; its hedgeWhy, T15). Those
    // records only: the other records are outputs, as above.
    '!/docs/',
    '/docs/*',
    '!/docs/truth/',
    '/docs/truth/*',
    '!/docs/truth/live-records/',
    '/docs/truth/live-records/*',
    '!/docs/truth/live-records/android-k7-eyes-1.json',
    // T15: the pre-T17 hedged reply replies.test.ts's hedgeWhy reads (t11's final A/B, scroll-sticky-cut.R.fully).
    '!/docs/truth/live-records/t11-carousel-visible/',
    '/docs/truth/live-records/t11-carousel-visible/*',
    '!/docs/truth/live-records/t11-carousel-visible/final-ab/',
    '/docs/truth/live-records/t11-carousel-visible/final-ab/*',
    '!/docs/truth/live-records/t11-carousel-visible/final-ab/harm-visibility-fix-1.json',
    // The lab apps' cell catalog the live cases are built from (live-cases.ts#catalogOf; live-carousel.test.ts, T13).
    '!/fixtures/',
    '/fixtures/*',
    '!/fixtures/apps/',
    '/fixtures/apps/*',
    '!/fixtures/apps/cells.json',
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
