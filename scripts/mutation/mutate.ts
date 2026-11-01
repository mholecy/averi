import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `npm run mutate` (D36, docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md): Stryker over the pure leaves
 * stryker.config.mjs names, then each module's score held to its own FLOOR. Stryker's `thresholds.break` is one global
 * score, and the modules' baselines lie 20 points apart: a global floor low enough for draw-order would let a fill
 * module lose a fifth of its kills unnoticed.
 *
 *   npm run mutate                          incremental: only mutants whose code or covering tests changed run
 *   npm run mutate -- --force               a full cold run (monthly): every mutant, the incremental file rebuilt;
 *                                           any argument goes to Stryker
 *
 * A module's score is Stryker's: killed and timed-out mutants over every mutant but the ignored (a `// Stryker
 * disable` comment) and the ones that do not compile. A floor sits about 2 points under the module's recorded
 * baseline (ARCHITECTURE.md §8). Raise it when the baseline rises; lower it only for a reason written beside it.
 */
const FLOORS: Readonly<Record<string, number>> = {
  // module                            floor   baseline (2026-11-01, D36: mutants, survived)
  'src/flow/wipes-ahead.ts': 98, //          100    (22, 0)
  'src/interact/fill-reformat.ts': 96, //    98.78  (268, 3 — equivalent)
  'src/interact/fill-verdict.ts': 98, //     100    (150, 0)
  'src/interact/fill-landing.ts': 97, //     99.13  (248, 2 — equivalent)
  'src/ui-tree/draw-order.ts': 75, //        77.22  (948, 155 + 61 no coverage)
};

const REPORTS = join(import.meta.dirname, '..', '..', 'reports', 'mutation');
const REPORT = join(REPORTS, 'mutation.json');
/** Committed (stryker.config.mjs#incrementalFile): kept in one canonical form, `canonical`. */
const INCREMENTAL = join(REPORTS, 'stryker-incremental.json');
const KILLED = new Set(['Killed', 'Timeout']);
const COUNTED = new Set([...KILLED, 'Survived', 'NoCoverage']);

interface Report {
  files: Record<string, { mutants: { status: string }[] }>;
}

interface Test {
  id: string;
  name: string;
  location?: { start: { line: number; column: number } };
}
interface Incremental {
  projectRoot?: string;
  files: Record<string, { mutants: { id: string; killedBy?: string[]; coveredBy?: string[] }[] }>;
  testFiles: Record<string, { tests: Test[] }>;
}

/**
 * The incremental file as a run with nothing changed leaves it: Stryker numbers the tests in the order its worker
 * threads report them, lists a rerun mutant after the reused ones and writes the checkout's absolute path, so two such
 * runs differ in every id. Here the tests are numbered in file, then line order, the mutants point at them by those
 * numbers and are listed by id, and the root is `.`. Stryker matches a test by its file and name, never its id or the
 * root (a run from another checkout reuses every result). What a rerun mutant was killed by may still change.
 */
function canonical(report: Incremental): Incremental {
  const at = (t: Test): number => (t.location?.start.line ?? 0) * 1e4 + (t.location?.start.column ?? 0);
  const ids = new Map<string, string>();
  const testFiles = Object.fromEntries(
    Object.keys(report.testFiles)
      .sort()
      .map((file) => {
        const entry = report.testFiles[file];
        const tests = [...entry.tests].sort((a, b) => at(a) - at(b) || a.name.localeCompare(b.name)).map((t) => {
          ids.set(t.id, String(ids.size));
          return { ...t, id: ids.get(t.id) as string };
        });
        return [file, { ...entry, tests }];
      }),
  );
  const renumber = (list?: string[]): string[] | undefined => list?.map((id) => ids.get(id) ?? id).sort((a, b) => Number(a) - Number(b));
  const files = Object.fromEntries(
    Object.keys(report.files)
      .sort()
      .map((file) => {
        const mutants = [...report.files[file].mutants].sort((a, b) => Number(a.id) - Number(b.id));
        return [file, { ...report.files[file], mutants: mutants.map((m) => ({ ...m, killedBy: renumber(m.killedBy), coveredBy: renumber(m.coveredBy) })) }];
      }),
  );
  return { ...report, projectRoot: '.', files, testFiles };
}

const stryker = spawnSync(join('node_modules', '.bin', 'stryker'), ['run', ...process.argv.slice(2)], { stdio: 'inherit' });
if (stryker.status !== 0) process.exit(stryker.status ?? 1);

writeFileSync(INCREMENTAL, `${JSON.stringify(canonical(JSON.parse(readFileSync(INCREMENTAL, 'utf8')) as Incremental), null, 2)}\n`);

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
