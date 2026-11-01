import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `npm run mutate` (D36, docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md): Stryker over the pure leaves
 * stryker.config.mjs names, then each module's score held to its own FLOOR (why per module: the ADR).
 *
 *   npm run mutate -- --force   every mutant, cold (~45 s): the run a merge needs
 *   npm run mutate              incremental, from this checkout's own last run: a local convenience while working,
 *                               blind to a change in a module the mutated ones import (stryker.config.mjs)
 *
 * Any argument goes to Stryker.
 *
 * A module's score is Stryker's: killed and timed-out mutants over every mutant but the ignored (a `// Stryker
 * disable` comment) and the ones that do not compile. A floor sits about 2 points under the module's recorded
 * baseline (ARCHITECTURE.md §8). Raise it when the baseline rises; lower it only for a reason written beside it.
 */
const FLOORS: Readonly<Record<string, number>> = {
  // module                            floor   baseline (2026-11-01, D36: mutants; survived, no coverage)
  'src/flow/wipes-ahead.ts': 98, //          100    (22; 0)
  'src/interact/fill-reformat.ts': 92, //    94.03  (268; 16)
  'src/interact/fill-verdict.ts': 97, //     99.33  (150; 1)
  'src/interact/fill-landing.ts': 93, //     95.16  (248; 12)
  'src/ui-tree/draw-order.ts': 75, //        77.22  (948; 155, 61)
};

const REPORTS = join(import.meta.dirname, '..', '..', 'reports', 'mutation');
const REPORT = join(REPORTS, 'mutation.json');
const KILLED = new Set(['Killed', 'Timeout']);
const COUNTED = new Set([...KILLED, 'Survived', 'NoCoverage']);

interface Report {
  files: Record<string, { mutants: { status: string }[] }>;
}

// A report left by an earlier run must not be read as this one's.
rmSync(REPORT, { force: true });
const stryker = spawnSync(join('node_modules', '.bin', 'stryker'), ['run', ...process.argv.slice(2)], { stdio: 'inherit' });
if (stryker.error !== undefined || stryker.status === null) {
  console.error(`npm run mutate: Stryker did not run to an end: ${stryker.error?.message ?? `killed by ${stryker.signal}`}`);
  process.exit(1);
}
if (stryker.status !== 0) process.exit(stryker.status);
if (!existsSync(REPORT)) {
  console.error(`npm run mutate: Stryker wrote no report at ${REPORT}: did it crash?`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(REPORT, 'utf8')) as Report;
const failures: string[] = [];
for (const [file, { mutants }] of Object.entries(report.files).sort(([a], [b]) => a.localeCompare(b))) {
  const floor = FLOORS[file];
  if (floor === undefined) {
    failures.push(`${file}: mutated, but has no floor in scripts/mutation/mutate.ts`);
    continue;
  }
  const counted = mutants.filter((m) => COUNTED.has(m.status));
  const score = counted.length === 0 ? 100 : (100 * counted.filter((m) => KILLED.has(m.status)).length) / counted.length;
  const line = `${file}: ${score.toFixed(2)} % (floor ${floor} %)`;
  console.log(line);
  if (score < floor) failures.push(`${line} — below its floor: a weakened test, or new code no test checks`);
}
for (const file of Object.keys(FLOORS)) if (!(file in report.files)) failures.push(`${file}: has a floor, but Stryker did not mutate it`);

if (failures.length > 0) {
  console.error(`\nnpm run mutate failed:\n${failures.map((f) => `  ${f}`).join('\n')}`);
  process.exit(1);
}
