import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `npm run mutate`: Stryker over the modules scope.json names, then each module's score held to its own floor there.
 * Why, when, and the floor rule: docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md.
 *
 *   node --import tsx scripts/mutation/mutate.ts [<stryker run argument> …]   (npm run mutate -- --force: cold)
 */

/** scripts/mutation/scope.json: per mutated module, its direct tests (globs), its floor and its baseline. */
export type Scope = Readonly<Record<string, { tests: readonly string[]; floor: number; baseline: string }>>;

/** What `checkFloors` reads of Stryker's JSON report (mutation-testing-report-schema). */
export interface MutationReport {
  files: Record<string, { mutants: readonly { status: string }[] }>;
}

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCOPE_FILE = join(ROOT, 'scripts', 'mutation', 'scope.json');
/** stryker.config.mjs's `jsonReporter.fileName`. */
const JSON_REPORT = join(ROOT, 'reports', 'mutation', 'mutation.json');
const STRYKER = join(ROOT, 'node_modules', '.bin', 'stryker');
/** Stryker's detected statuses: a test failed, or the mutant ran past the timeout. */
const DETECTED = new Set(['Killed', 'Timeout']);
/** Stryker's valid statuses — the score's denominator: not Ignored, and not a compile or runtime error. */
const VALID = new Set([...DETECTED, 'Survived', 'NoCoverage']);

export const readScope = (): Scope => JSON.parse(readFileSync(SCOPE_FILE, 'utf8')) as Scope;

/** Stryker's mutation score, in %: detected over valid mutants (100 when none is valid). */
export function scoreOf(mutants: readonly { status: string }[]): number {
  const valid = mutants.filter((m) => VALID.has(m.status));
  return valid.length === 0 ? 100 : (100 * valid.filter((m) => DETECTED.has(m.status)).length) / valid.length;
}

const scoreLine = (file: string, report: MutationReport, scope: Scope): string =>
  `${file}: ${scoreOf(report.files[file].mutants).toFixed(2)} % (floor ${scope[file]?.floor ?? 'none'} %)`;

/**
 * The failure lines of a run: a mutated module below its floor, a mutated module without a floor, a floor whose
 * module was not mutated. None when the run passes. Pure.
 */
export function checkFloors(report: MutationReport, scope: Scope): string[] {
  const failures: string[] = [];
  for (const file of Object.keys(report.files).sort()) {
    const floor = scope[file]?.floor;
    if (floor === undefined) failures.push(`${file}: mutated, but has no floor in scripts/mutation/scope.json`);
    else if (scoreOf(report.files[file].mutants) < floor) {
      const below = 'below its floor: a weakened test, or new code no test checks';
      failures.push(`${scoreLine(file, report, scope)} — ${below}`);
    }
  }
  for (const file of Object.keys(scope)) {
    if (!(file in report.files)) failures.push(`${file}: has a floor, but Stryker did not mutate it`);
  }
  return failures;
}

export function main(args: readonly string[]): number {
  // A report left by an earlier run must not be read as this one's.
  rmSync(JSON_REPORT, { force: true });
  const stryker = spawnSync(STRYKER, ['run', ...args], { cwd: ROOT, stdio: 'inherit' });
  if (stryker.error !== undefined || stryker.status === null) {
    const why = stryker.error?.message ?? `killed by ${stryker.signal}`;
    console.error(`npm run mutate: Stryker did not run to an end: ${why}`);
    return 1;
  }
  if (stryker.status !== 0) return stryker.status;
  if (!existsSync(JSON_REPORT)) {
    console.error(`npm run mutate: Stryker wrote no report at ${JSON_REPORT}: did it crash?`);
    return 1;
  }
  const report = JSON.parse(readFileSync(JSON_REPORT, 'utf8')) as MutationReport;
  const scope = readScope();
  for (const file of Object.keys(report.files).sort()) console.log(scoreLine(file, report, scope));
  const failures = checkFloors(report, scope);
  if (failures.length === 0) return 0;
  console.error(`\nnpm run mutate failed:\n${failures.map((f) => `  ${f}`).join('\n')}`);
  return 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
