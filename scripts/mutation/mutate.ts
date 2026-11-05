import { spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../is-main.js';
import { GROUP_ENV, GROUPS, groupScope, readScopeFile, scopeErrors, scopeOf, type Group } from './group.mjs';

/**
 * `npm run mutate`: Stryker over the modules scope.json names, one group at a time (core, then lab: one Stryker
 * process each, bounded at GROUP_BOUND_MS), then each module's score held to its own floor there. Fails if either
 * group fails. Why, when, the groups and the floor rule: docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md.
 *
 *   node --import tsx scripts/mutation/mutate.ts [--group core|lab] [<stryker run argument> …]
 *   (npm run mutate -- --force: both groups, cold; npm run mutate -- --group lab --force: lab alone, cold)
 */

/** scripts/mutation/scope.json: per mutated module, its direct tests (globs), its floor, its baseline and its group. */
export type Scope = Readonly<Record<string, { tests: readonly string[]; floor: number; baseline: string; group: string }>>;

/** What `checkFloors` reads of Stryker's JSON report (mutation-testing-report-schema). */
export interface MutationReport {
  files: Record<string, { mutants: readonly { status: string }[] }>;
}

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const STRYKER = join(ROOT, 'node_modules', '.bin', 'stryker');
/** Each group's Stryker process is stopped past this (ADR 0038, T2b-2: one command's bound, per group). */
export const GROUP_BOUND_MS = 600_000;
/** After a bound's SIGTERM, how long the group has before SIGKILL. */
export const KILL_GRACE_MS = 10_000;
/** Stryker's detected statuses: a test failed, or the mutant ran past the timeout. */
const DETECTED = new Set(['Killed', 'Timeout']);
/** Stryker's valid statuses — the score's denominator: not Ignored, and not a compile or runtime error. */
const VALID = new Set([...DETECTED, 'Survived', 'NoCoverage']);

export const readScope = (): Scope => readScopeFile();

/** Stryker's mutation score, in %: detected over valid mutants (100 when none is valid). */
export function scoreOf(mutants: readonly { status: string }[]): number {
  const valid = mutants.filter((m) => VALID.has(m.status));
  return valid.length === 0 ? 100 : (100 * valid.filter((m) => DETECTED.has(m.status)).length) / valid.length;
}

const floorText = (floor: number | undefined): string => (floor === undefined ? 'no floor' : `floor ${floor} %`);

const scoreLine = (file: string, report: MutationReport, scope: Scope): string =>
  `${file}: ${scoreOf(report.files[file].mutants).toFixed(2)} % (${floorText(scope[file]?.floor)})`;

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

/** One Stryker process: its group and the arguments after `stryker run`. */
export interface GroupRun {
  group: Group;
  args: string[];
}

const GROUP_WORDS = GROUPS.join(' or ');
const isGroup = (name: string): name is Group => (GROUPS as readonly string[]).includes(name);

/**
 * The groups a run starts, in order, each with its Stryker arguments; or a refusal. `--group <name>` picks one group
 * (none: all, in GROUPS' order) and is not passed on. `--tempDirName <name>` becomes `<name>-<group>`, each group its
 * own sandbox. Without `--group`, `--mutate <files>` sends each file to the group whose scope.json entry it is (a
 * Stryker range after it kept) and starts only the groups named; a file no entry names is a refusal. With `--group`,
 * `--mutate` is passed on as given. Pure.
 */
export function planRuns(args: readonly string[], scope: Scope): { runs: GroupRun[] } | { refusal: string } {
  const refuse = (why: string) => ({ refusal: `npm run mutate: ${why}` });
  let group: Group | undefined;
  let tempDir: string | undefined;
  let mutate: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const [option, inline] = args[i].startsWith('--') && args[i].includes('=') ? args[i].split(/=(.*)/s, 2) : [args[i], undefined];
    if (option !== '--group' && option !== '--tempDirName' && option !== '--mutate' && option !== '-m') {
      rest.push(args[i]);
      continue;
    }
    const value = inline ?? (args[i + 1]?.startsWith('-') === false ? args[++i] : undefined);
    if (option === '--group') {
      if (group !== undefined) return refuse('--group given twice: give one, or none for both');
      if (value === undefined || value === '') return refuse(`--group needs a group (${GROUP_WORDS})`);
      if (!isGroup(value)) return refuse(`--group ${value}: not a group (${GROUP_WORDS})`);
      group = value;
    } else if (option === '--tempDirName') {
      if (value === undefined || value === '') return refuse('--tempDirName needs a name');
      tempDir = value;
    } else {
      if (value === undefined || value === '') return refuse('--mutate needs a file');
      mutate = value;
    }
  }
  const argsOf = (g: Group, files: string | undefined): string[] => [
    ...(files === undefined ? [] : ['--mutate', files]),
    ...rest,
    ...(tempDir === undefined ? [] : ['--tempDirName', `${tempDir}-${g}`]),
  ];
  if (group !== undefined) return { runs: [{ group, args: argsOf(group, mutate) }] };
  if (mutate === undefined) return { runs: GROUPS.map((g) => ({ group: g, args: argsOf(g, undefined) })) };
  const byGroup = new Map<Group, string[]>();
  for (const pattern of mutate.split(',')) {
    const owner = scope[pattern.replace(/:\d.*$/s, '')]?.group;
    if (owner === undefined || !isGroup(owner)) {
      return refuse(`--mutate ${pattern}: not a scripts/mutation/scope.json module (give --group to mutate it)`);
    }
    byGroup.set(owner, [...(byGroup.get(owner) ?? []), pattern]);
  }
  return { runs: GROUPS.filter((g) => byGroup.has(g)).map((g) => ({ group: g, args: argsOf(g, byGroup.get(g)?.join(',')) })) };
}

/** How one Stryker process ended: its code or signal, and whether its bound or an interrupt of ours stopped it. */
export interface Spawned {
  status: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  interrupted: boolean;
  /** It could not be started. */
  error?: string;
}

/** Starts `args` with `env` added to ours, stopped past `boundMs`. */
export type Spawner = (args: readonly string[], env: Readonly<Record<string, string>>, boundMs: number) => Promise<Spawned>;

/**
 * `command` in a process group of its own, its output ours. Past `boundMs` the group gets SIGTERM, and SIGKILL
 * KILL_GRACE_MS later; an interrupt of this process (SIGINT, SIGTERM) is passed to the group, which no longer gets the
 * terminal's; once the command has ended, its group gets SIGKILL: no Stryker worker outlives its run.
 */
export function spawnBounded(command: string, cwd: string): Spawner {
  return (args, env, boundMs) =>
    new Promise((resolve) => {
      let timedOut = false;
      let interrupted = false;
      let kill: NodeJS.Timeout | undefined;
      const child = spawn(command, args, { cwd, stdio: 'inherit', detached: true, env: { ...process.env, ...env } });
      const signalGroup = (signal: NodeJS.Signals): void => {
        if (child.pid === undefined) return;
        try {
          process.kill(-child.pid, signal);
        } catch {
          // The group has gone.
        }
      };
      const onInterrupt = (signal: NodeJS.Signals): void => {
        interrupted = true;
        signalGroup(signal);
      };
      process.on('SIGINT', onInterrupt);
      process.on('SIGTERM', onInterrupt);
      const bound = setTimeout(() => {
        timedOut = true;
        signalGroup('SIGTERM');
        kill = setTimeout(() => signalGroup('SIGKILL'), KILL_GRACE_MS);
      }, boundMs);
      const end = (ended: Omit<Spawned, 'timedOut' | 'interrupted'>): void => {
        clearTimeout(bound);
        clearTimeout(kill);
        process.off('SIGINT', onInterrupt);
        process.off('SIGTERM', onInterrupt);
        signalGroup('SIGKILL');
        resolve({ ...ended, timedOut, interrupted });
      };
      child.on('error', (e) => end({ status: null, signal: null, error: e.message }));
      child.on('exit', (status, signal) => end({ status, signal }));
    });
}

/** What main does outside itself; paths are relative to the checkout. */
export interface MutateDeps {
  readScope(): Scope;
  spawn: Spawner;
  readReport(path: string): MutationReport | undefined;
  removeReport(path: string): void;
  now(): number;
  log(line: string): void;
  error(line: string): void;
}

const realDeps: MutateDeps = {
  readScope,
  spawn: spawnBounded(STRYKER, ROOT),
  readReport: (path) => {
    try {
      return JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as MutationReport;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
  },
  removeReport: (path) => rmSync(join(ROOT, path), { force: true }),
  now: () => Date.now(),
  log: (line) => console.log(line),
  error: (line) => console.error(line),
};

/** One group's Stryker and its floors: its exit code, and whether an interrupt stopped it. */
async function runGroup(run: GroupRun, scope: Scope, deps: MutateDeps): Promise<{ code: number; interrupted: boolean }> {
  const { group } = run;
  const fail = (why: string, code = 1) => {
    deps.error(`npm run mutate: ${group}: ${why}`);
    return code;
  };
  const report = scopeOf({ [GROUP_ENV]: group }, scope).files.json;
  // A report left by an earlier run must not be read as this one's.
  deps.removeReport(report);
  const stryker = await deps.spawn(['run', ...run.args], { [GROUP_ENV]: group }, GROUP_BOUND_MS);
  const { interrupted } = stryker;
  if (stryker.timedOut) return { code: fail(`Stryker passed its ${GROUP_BOUND_MS / 1000} s bound and was stopped`), interrupted };
  if (stryker.error !== undefined || stryker.status === null) {
    const why = stryker.error ?? (interrupted ? `interrupted (${stryker.signal})` : `killed by ${stryker.signal}`);
    return { code: fail(`Stryker did not run to an end: ${why}`, interrupted ? 130 : 1), interrupted };
  }
  if (stryker.status !== 0) return { code: stryker.status, interrupted };
  const read = deps.readReport(report);
  if (read === undefined) return { code: fail(`Stryker wrote no report at ${report}: did it crash?`), interrupted };
  const own = groupScope(scope, group);
  for (const file of Object.keys(read.files).sort()) deps.log(scoreLine(file, read, own));
  const failures = checkFloors(read, own);
  if (failures.length === 0) return { code: 0, interrupted };
  deps.error(`\nnpm run mutate (${group}) failed:\n${failures.map((f) => `  ${f}`).join('\n')}`);
  return { code: 1, interrupted };
}

/**
 * The run: scope.json's groups checked (an error: exit 2, nothing started), the plan (a refusal: exit 2), then each
 * group in turn — the next one runs whatever the last one's result, unless an interrupt stopped it — and one summary
 * line per group. Its exit: 0 when every group passed, else the first failure's.
 */
export async function main(args: readonly string[], deps: MutateDeps = realDeps): Promise<number> {
  const scope = deps.readScope();
  const errors = scopeErrors(scope);
  if (errors.length > 0) {
    for (const e of errors) deps.error(`npm run mutate: ${e}`);
    return 2;
  }
  const plan = planRuns(args, scope);
  if ('refusal' in plan) {
    deps.error(plan.refusal);
    return 2;
  }
  const summary: string[] = [];
  let exit = 0;
  let stopped = false;
  for (const run of plan.runs) {
    if (stopped) {
      summary.push(`npm run mutate: ${run.group} not run: the run was interrupted`);
      continue;
    }
    const started = deps.now();
    const { code, interrupted } = await runGroup(run, scope, deps);
    const secs = Math.round((deps.now() - started) / 1000);
    summary.push(`npm run mutate: ${run.group} ${code === 0 ? 'passed' : `failed (exit ${code})`} in ${secs} s`);
    if (exit === 0) exit = code;
    stopped = interrupted;
  }
  for (const line of summary) deps.log(line);
  return exit;
}

if (isMain(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
