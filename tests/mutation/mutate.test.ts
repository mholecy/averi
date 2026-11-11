import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { GROUP_ENV } from '../../scripts/mutation/group.mjs';
import {
  checkFloors, GROUP_BOUND_MS, main, planRuns, readScope, scoreOf, spawnBounded,
  type MutateDeps, type MutationReport, type Scope, type Spawned,
} from '../../scripts/mutation/mutate.js';

// scripts/mutation/mutate.ts: the floors `npm run mutate` holds each mutated module to (ADR 0038). The run itself
// (Stryker) is not started here; importing the script does nothing. Its entry guard, isMain, has its own tests
// (tests/scripts/is-main.test.ts: a script started through a symlink runs).

const mutants = (statuses: Record<string, number>) => Object.entries(statuses).flatMap(([status, n]) => Array.from({ length: n }, () => ({ status })));
const scope: Scope = { 'src/a.ts': { tests: ['tests/a.test.ts'], floor: 90, baseline: '', group: 'core' } };
const report = (statuses: Record<string, number>): MutationReport => ({ files: { 'src/a.ts': { mutants: mutants(statuses) } } });

describe('scoreOf — Stryker\'s score: detected over valid mutants', () => {
  it('a Timeout is detected; Ignored and errors leave the denominator', () => {
    expect(scoreOf(mutants({ Killed: 2, Timeout: 1, Survived: 1 }))).toBe(75);
    expect(scoreOf(mutants({ Killed: 3, NoCoverage: 1, Ignored: 5, CompileError: 2, RuntimeError: 1 }))).toBe(75);
    expect(scoreOf([])).toBe(100);
  });
});

describe('checkFloors — the failure lines of a run', () => {
  it('a module at its floor passes; one below it fails, naming it', () => {
    expect(checkFloors(report({ Killed: 9, Survived: 1 }), scope)).toEqual([]);
    const failures = checkFloors(report({ Killed: 8, Survived: 1, NoCoverage: 1 }), scope);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^src\/a\.ts: 80\.00 % \(floor 90 %\) — below its floor/);
  });

  it('a Timeout counts as detected: 9 timeouts and 1 survivor reach a 90 floor', () => {
    expect(checkFloors(report({ Timeout: 9, Survived: 1 }), scope)).toEqual([]);
  });

  it('a mutated module without a floor fails', () => {
    const r: MutationReport = { files: { ...report({ Killed: 1 }).files, 'src/b.ts': { mutants: mutants({ Killed: 1 }) } } };
    expect(checkFloors(r, scope)).toEqual(['src/b.ts: mutated, but has no floor in scripts/mutation/scope.json']);
  });

  it('a floor whose module was not mutated fails', () => {
    expect(checkFloors({ files: {} }, scope)).toEqual(['src/a.ts: has a floor, but Stryker did not mutate it']);
  });

  it('scope.json: every module names its tests and a floor between 0 and 100', () => {
    for (const [file, m] of Object.entries(readScope())) {
      // scripts/release/: the release gate's pure modules (T24), in stryker.config.mjs's allowlist too.
      expect(file).toMatch(/^((src|scripts\/truth\/batch)\/[^/]+(\/[^/]+)*|scripts\/(truth|release)\/[^/]+)\.ts$/);
      expect(m.tests.length).toBeGreaterThan(0);
      expect(m.floor).toBeGreaterThan(0);
      expect(m.floor).toBeLessThanOrEqual(100);
    }
  });
});

// T2b-2: the run in groups (ADR 0038, the T2 amendment's T2b-2 part). planRuns and main over a fake spawner; no
// Stryker starts here.

const groups: Scope = {
  'src/a.ts': { tests: ['tests/a.test.ts'], floor: 90, baseline: '', group: 'core' },
  'src/adapters/android-w.ts': { tests: ['tests/w.test.ts'], floor: 90, baseline: '', group: 'android' },
  'src/ui-tree/s.ts': { tests: ['tests/s.test.ts'], floor: 90, baseline: '', group: 'scene' },
  'scripts/truth/batch/lab-x.ts': { tests: ['tests/x.test.ts'], floor: 90, baseline: '', group: 'lab' },
};

/** planRuns, each run its group and Stryker arguments only: its incremental file and force have their own test. */
function plan(...a: Parameters<typeof planRuns>) {
  const planned = planRuns(...a);
  return 'refusal' in planned ? planned : { runs: planned.runs.map(({ group, args }) => ({ group, args })) };
}

describe('planRuns — which groups run, each with its Stryker arguments (T2b-2)', () => {
  it('no --group: core, android, scene then lab, each given the same arguments', () => {
    expect(plan([], groups)).toEqual({ runs: [{ group: 'core', args: [] }, { group: 'android', args: [] }, { group: 'scene', args: [] }, { group: 'lab', args: [] }] });
    expect(plan(['--force'], groups)).toEqual({
      runs: [{ group: 'core', args: ['--force'] }, { group: 'android', args: ['--force'] }, { group: 'scene', args: ['--force'] }, { group: 'lab', args: ['--force'] }],
    });
  });

  it('--group <name> or --group=<name>: that group alone, the option not passed on to Stryker', () => {
    expect(plan(['--group', 'lab', '--force'], groups)).toEqual({ runs: [{ group: 'lab', args: ['--force'] }] });
    expect(plan(['--force', '--group=core'], groups)).toEqual({ runs: [{ group: 'core', args: ['--force'] }] });
  });

  it('an unknown group, a --group without its name, or two of them: a refusal naming it', () => {
    expect(plan(['--group', 'all'], groups)).toEqual({ refusal: 'npm run mutate: --group all: not a group (core, android, scene or lab)' });
    expect(plan(['--group=Core'], groups)).toEqual({ refusal: 'npm run mutate: --group Core: not a group (core, android, scene or lab)' });
    expect(plan(['--group'], groups)).toEqual({ refusal: 'npm run mutate: --group needs a group (core, android, scene or lab)' });
    expect(plan(['--group', '--force'], groups)).toEqual({ refusal: 'npm run mutate: --group needs a group (core, android, scene or lab)' });
    expect(plan(['--group', 'core', '--group', 'lab'], groups)).toEqual({ refusal: 'npm run mutate: --group given twice: give one, or none for all' });
  });

  it('--tempDirName <name>: each group its own, the name suffixed with the group', () => {
    expect(plan(['--force', '--tempDirName', '.stryker-tmp-7'], groups)).toEqual({
      runs: [
        { group: 'core', args: ['--force', '--tempDirName', '.stryker-tmp-7-core'] },
        { group: 'android', args: ['--force', '--tempDirName', '.stryker-tmp-7-android'] },
        { group: 'scene', args: ['--force', '--tempDirName', '.stryker-tmp-7-scene'] },
        { group: 'lab', args: ['--force', '--tempDirName', '.stryker-tmp-7-lab'] },
      ],
    });
    expect(plan(['--tempDirName=t', '--group', 'lab'], groups)).toEqual({ runs: [{ group: 'lab', args: ['--tempDirName', 't-lab'] }] });
    expect(plan(['--tempDirName'], groups)).toEqual({ refusal: 'npm run mutate: --tempDirName needs a name' });
  });

  it('--incrementalFile <file>: each group its own, the group before the extension (A37)', () => {
    expect(plan(['--incrementalFile', 'reports/inc.json'], groups)).toEqual({
      runs: [
        { group: 'core', args: ['--incrementalFile', 'reports/inc-core.json'] },
        { group: 'android', args: ['--incrementalFile', 'reports/inc-android.json'] },
        { group: 'scene', args: ['--incrementalFile', 'reports/inc-scene.json'] },
        { group: 'lab', args: ['--incrementalFile', 'reports/inc-lab.json'] },
      ],
    });
    expect(plan(['--incrementalFile=inc', '--group', 'lab'], groups)).toEqual({ runs: [{ group: 'lab', args: ['--incrementalFile', 'inc-lab'] }] });
    expect(plan(['--incrementalFile'], groups)).toEqual({ refusal: 'npm run mutate: --incrementalFile needs a file' });
  });

  it('--mutate without --group: each file to its own group, a group none names not run', () => {
    expect(plan(['--mutate', 'src/a.ts,scripts/truth/batch/lab-x.ts:3-9'], groups)).toEqual({
      runs: [
        { group: 'core', args: ['--mutate', 'src/a.ts'] },
        { group: 'lab', args: ['--mutate', 'scripts/truth/batch/lab-x.ts:3-9'] },
      ],
    });
    expect(plan(['-m', 'scripts/truth/batch/lab-x.ts', '--force'], groups)).toEqual({
      runs: [{ group: 'lab', args: ['--mutate', 'scripts/truth/batch/lab-x.ts', '--force'] }],
    });
    expect(plan(['-m=src/a.ts'], groups)).toEqual({ runs: [{ group: 'core', args: ['--mutate', 'src/a.ts'] }] });
    expect(plan(['--mutate=src/a.ts:1:2-3:4'], groups)).toEqual({ runs: [{ group: 'core', args: ['--mutate', 'src/a.ts:1:2-3:4'] }] });
  });

  it('--mutate without --group: a glob gives each group the modules it matches there, never the glob itself', () => {
    expect(plan(['--mutate', 'src/*.ts', '--force'], groups)).toEqual({ runs: [{ group: 'core', args: ['--mutate', 'src/a.ts', '--force'] }] });
    expect(plan(['--mutate', 'scripts/truth/batch/lab-*.ts'], groups)).toEqual({
      runs: [{ group: 'lab', args: ['--mutate', 'scripts/truth/batch/lab-x.ts'] }],
    });
    const more: Scope = { ...groups, 'src/b.ts': { tests: ['tests/b.test.ts'], floor: 90, baseline: '', group: 'core' } };
    expect(plan(['--mutate', '**/*.ts,src/a.ts:2-5'], more)).toEqual({
      runs: [
        { group: 'core', args: ['--mutate', 'src/a.ts,src/b.ts,src/a.ts:2-5'] },
        { group: 'android', args: ['--mutate', 'src/adapters/android-w.ts'] },
        { group: 'scene', args: ['--mutate', 'src/ui-tree/s.ts'] },
        { group: 'lab', args: ['--mutate', 'scripts/truth/batch/lab-x.ts'] },
      ],
    });
  });

  it('--mutate without --group on a node without path.matchesGlob (before 20.17): exact paths work, a glob is refused', () => {
    expect(plan(['--mutate', 'src/a.ts,scripts/truth/batch/lab-x.ts:3-9'], groups, null)).toEqual({
      runs: [
        { group: 'core', args: ['--mutate', 'src/a.ts'] },
        { group: 'lab', args: ['--mutate', 'scripts/truth/batch/lab-x.ts:3-9'] },
      ],
    });
    for (const glob of ['src/*.ts', 'src/a.t?', 'src/[ab].ts', 'src/**']) {
      expect(plan(['--mutate', glob], groups, null)).toEqual({
        refusal: `npm run mutate: --mutate ${glob}: a glob needs Node 20.17 or later (path.matchesGlob); give scripts/mutation/scope.json paths, or --group`,
      });
    }
    // A scope.json key is looked up as itself first, glob characters and all (one a glob would not match).
    const bracketed: Scope = { ...groups, 'src/[id].ts': { tests: ['tests/id.test.ts'], floor: 90, baseline: '', group: 'core' } };
    for (const glob of [null, undefined]) {
      expect(plan(['--mutate', 'src/[id].ts'], bracketed, glob)).toEqual({ runs: [{ group: 'core', args: ['--mutate', 'src/[id].ts'] }] });
    }
    expect(plan(['--mutate', 'src/zz.ts'], groups, null)).toEqual({
      refusal: 'npm run mutate: --mutate src/zz.ts: matches no scripts/mutation/scope.json module (give --group to mutate it)',
    });
  });

  it('--mutate without --group: a pattern matching no scope entry, or no file, is a refusal', () => {
    expect(plan(['--mutate', 'src/a.ts,src/zz/*.ts'], groups)).toEqual({
      refusal: 'npm run mutate: --mutate src/zz/*.ts: matches no scripts/mutation/scope.json module (give --group to mutate it)',
    });
    expect(plan(['--mutate', 'src/a'], groups)).toEqual({
      refusal: 'npm run mutate: --mutate src/a: matches no scripts/mutation/scope.json module (give --group to mutate it)',
    });
    expect(plan(['--mutate'], groups)).toEqual({ refusal: 'npm run mutate: --mutate needs a file' });
    expect(plan(['-m', ''], groups)).toEqual({ refusal: 'npm run mutate: --mutate needs a file' });
  });

  it('each run\'s incremental file (--incrementalFile per group, or the default) and whether it is cold (A37)', () => {
    const fields = (args: string[]) => {
      const planned = planRuns(args, groups);
      return 'refusal' in planned ? planned : planned.runs.map(({ group, incremental, force }) => [group, incremental, force]);
    };
    const core = 'reports/mutation/stryker-incremental-core.json';
    expect(fields(['--group', 'core'])).toEqual([['core', core, false]]);
    expect(fields(['--group', 'lab', '--force'])).toEqual([['lab', 'reports/mutation/stryker-incremental-lab.json', true]]);
    expect(fields(['--force=true', '--incrementalFile', 'inc.json', '--mutate', 'src/a.ts'])).toEqual([['core', 'inc-core.json', true]]);
    expect(fields(['--force=false', '--group', 'core'])).toEqual([['core', core, false]]);
  });

  it('--mutate with --group: passed on as given, globs too', () => {
    expect(plan(['--group', 'core', '--mutate', 'src/*.ts'], groups)).toEqual({ runs: [{ group: 'core', args: ['--mutate', 'src/*.ts'] }] });
  });
});

/** Each group's module in `groups`. */
const moduleOf: Record<string, string> = {
  core: 'src/a.ts', android: 'src/adapters/android-w.ts', scene: 'src/ui-tree/s.ts', lab: 'scripts/truth/batch/lab-x.ts',
};

/** A file on the fake disk: a report, or what JSON.parse throws on it (a truncated file). */
type OnDisk = MutationReport | Error;

/**
 * A fake run: each group's Stryker result and report, and what main did, in order. With `disk` (A37), the files are
 * there, and Stryker writes the group's report as its IncrementalDiffer does: the group's own module plus every module
 * its incremental file still names; the incremental file then holds that report.
 */
function fakeDeps(o: {
  spawned?: Partial<Record<string, Partial<Spawned>>>;
  reports?: Record<string, MutationReport | undefined>;
  scope?: Scope;
  disk?: Map<string, OnDisk>;
} = {}) {
  const events: string[] = [];
  const out: string[] = [];
  let clock = 0;
  const reportOf = (group: string): MutationReport => ({
    files: { [moduleOf[group]]: { mutants: mutants({ Killed: 9, Survived: 1 }) } },
  });
  const deps: MutateDeps = {
    readScope: () => o.scope ?? groups,
    spawn: (args, env, boundMs) => {
      const group = env[GROUP_ENV] ?? '';
      events.push(`spawn ${group} ${args.join(' ')} ${boundMs}`);
      clock += group === 'core' ? 212_400 : group === 'android' ? 180_300 : group === 'scene' ? 150_200 : 98_600;
      if (o.disk !== undefined) {
        const at = args.indexOf('--incrementalFile');
        const incremental = at === -1 ? `reports/mutation/stryker-incremental-${group}.json` : args[at + 1];
        const left = o.disk.get(incremental);
        const report = { files: { ...(left instanceof Error ? {} : left?.files), ...reportOf(group).files } };
        o.disk.set(`reports/mutation/mutation-${group}.json`, report);
        o.disk.set(incremental, report);
      }
      return Promise.resolve({ status: 0, signal: null, timedOut: false, interrupted: false, ...o.spawned?.[group] });
    },
    readJson: (path) => {
      events.push(`read ${path}`);
      if (o.disk !== undefined) {
        const file = o.disk.get(path);
        if (file instanceof Error) throw file;
        return file;
      }
      // No incremental file left from an earlier run.
      if (path.includes('stryker-incremental')) return undefined;
      const group = /mutation-(\w+)\.json$/.exec(path)?.[1] ?? '';
      if (o.reports !== undefined && group in o.reports) return o.reports[group];
      return reportOf(group);
    },
    removeFile: (path) => {
      events.push(`remove ${path}`);
      o.disk?.delete(path);
    },
    now: () => clock,
    log: (line) => out.push(line),
    error: (line) => out.push(`E ${line}`),
  };
  return { deps, events, out };
}

describe('main — the groups one after the other, the run failing if any fails (T2b-2)', () => {
  it('no --group: core, android, scene then lab, each its files removed first, its own env and 600 s bound; all pass: 0', async () => {
    const { deps, events, out } = fakeDeps();
    expect(GROUP_BOUND_MS).toBe(600_000);
    expect(await main(['--force'], deps)).toBe(0);
    expect(events).toEqual([
      'remove reports/mutation/mutation-core.json',
      'remove reports/mutation/stryker-incremental-core.json',
      'spawn core run --force 600000',
      'read reports/mutation/mutation-core.json',
      'remove reports/mutation/mutation-android.json',
      'remove reports/mutation/stryker-incremental-android.json',
      'spawn android run --force 600000',
      'read reports/mutation/mutation-android.json',
      'remove reports/mutation/mutation-scene.json',
      'remove reports/mutation/stryker-incremental-scene.json',
      'spawn scene run --force 600000',
      'read reports/mutation/mutation-scene.json',
      'remove reports/mutation/mutation-lab.json',
      'remove reports/mutation/stryker-incremental-lab.json',
      'spawn lab run --force 600000',
      'read reports/mutation/mutation-lab.json',
    ]);
    expect(out).toEqual([
      'src/a.ts: 90.00 % (floor 90 %)',
      'src/adapters/android-w.ts: 90.00 % (floor 90 %)',
      'src/ui-tree/s.ts: 90.00 % (floor 90 %)',
      'scripts/truth/batch/lab-x.ts: 90.00 % (floor 90 %)',
      'npm run mutate: core passed in 212 s',
      'npm run mutate: android passed in 180 s',
      'npm run mutate: scene passed in 150 s',
      'npm run mutate: lab passed in 99 s',
    ]);
  });

  it('each group\'s floors only: a group\'s report without the other group\'s modules passes', async () => {
    const { deps } = fakeDeps();
    expect(await main(['--group', 'core'], deps)).toBe(0);
  });

  it('core below its floor: android, scene and lab still run, and the run fails (exit 1) naming core', async () => {
    const { deps, events, out } = fakeDeps({ reports: { core: { files: { 'src/a.ts': { mutants: mutants({ Killed: 8, Survived: 2 }) } } } } });
    expect(await main([], deps)).toBe(1);
    expect(events).toContain('spawn lab run 600000');
    expect(out).toContain('E \nnpm run mutate (core) failed:\n  src/a.ts: 80.00 % (floor 90 %) — below its floor: a weakened test, or new code no test checks');
    expect(out.slice(-4)).toEqual(['npm run mutate: core failed (exit 1) in 212 s', 'npm run mutate: android passed in 180 s', 'npm run mutate: scene passed in 150 s', 'npm run mutate: lab passed in 99 s']);
  });

  it('lab\'s Stryker exits 3: the run exits 3, core\'s pass kept in the summary', async () => {
    const { deps, out } = fakeDeps({ spawned: { lab: { status: 3 } } });
    expect(await main([], deps)).toBe(3);
    expect(out.slice(-4)).toEqual(['npm run mutate: core passed in 212 s', 'npm run mutate: android passed in 180 s', 'npm run mutate: scene passed in 150 s', 'npm run mutate: lab failed (exit 3) in 99 s']);
  });

  it('both fail: the first failure\'s exit', async () => {
    const { deps } = fakeDeps({ spawned: { core: { status: 2 }, lab: { status: 3 } } });
    expect(await main([], deps)).toBe(2);
  });

  it('a group past its bound: stopped, a failure naming the bound; the next group still runs', async () => {
    const { deps, events, out } = fakeDeps({ spawned: { core: { status: null, signal: 'SIGTERM', timedOut: true } } });
    expect(await main([], deps)).toBe(1);
    expect(out).toContain('E npm run mutate: core: Stryker passed its 600 s bound and was stopped');
    expect(events).toContain('spawn lab run 600000');
    expect(events).not.toContain('read reports/mutation/mutation-core.json');
  });

  it('an interrupt: no later group runs, exit 130, the summary says it', async () => {
    const { deps, events, out } = fakeDeps({ spawned: { core: { status: null, signal: 'SIGINT', interrupted: true } } });
    expect(await main([], deps)).toBe(130);
    expect(events.filter((e) => e.startsWith('spawn'))).toEqual(['spawn core run 600000']);
    expect(out).toContain('E npm run mutate: core: Stryker did not run to an end: interrupted (SIGINT)');
    expect(out.slice(-4)).toEqual(['npm run mutate: core failed (exit 130) in 212 s', 'npm run mutate: android not run: the run was interrupted', 'npm run mutate: scene not run: the run was interrupted', 'npm run mutate: lab not run: the run was interrupted']);
  });

  it('an interrupt Stryker handles itself (it exits, with 130): its exit, and no later group runs', async () => {
    const { deps, events, out } = fakeDeps({ spawned: { core: { status: 130, interrupted: true } } });
    expect(await main([], deps)).toBe(130);
    expect(events.filter((e) => e.startsWith('spawn'))).toEqual(['spawn core run 600000']);
    expect(out.slice(-4)).toEqual(['npm run mutate: core failed (exit 130) in 212 s', 'npm run mutate: android not run: the run was interrupted', 'npm run mutate: scene not run: the run was interrupted', 'npm run mutate: lab not run: the run was interrupted']);
  });

  it('Stryker not started, or killed by a signal: a failure saying why', async () => {
    const started = fakeDeps({ spawned: { core: { status: null, error: 'spawn stryker ENOENT' } } });
    expect(await main(['--group', 'core'], started.deps)).toBe(1);
    expect(started.out).toContain('E npm run mutate: core: Stryker did not run to an end: spawn stryker ENOENT');
    const killed = fakeDeps({ spawned: { lab: { status: null, signal: 'SIGKILL' } } });
    expect(await main(['--group=lab'], killed.deps)).toBe(1);
    expect(killed.out).toContain('E npm run mutate: lab: Stryker did not run to an end: killed by SIGKILL');
  });

  it('no report from a group\'s Stryker: a failure naming the file', async () => {
    const { deps, out } = fakeDeps({ reports: { lab: undefined } });
    expect(await main(['--group', 'lab'], deps)).toBe(1);
    expect(out).toContain('E npm run mutate: lab: Stryker wrote no report at reports/mutation/mutation-lab.json: did it crash?');
  });

  it('a refusal, or a scope.json group error: exit 2, no Stryker started', async () => {
    const refused = fakeDeps();
    expect(await main(['--group', 'all'], refused.deps)).toBe(2);
    expect(refused.events).toEqual([]);
    expect(refused.out).toEqual(['E npm run mutate: --group all: not a group (core, android, scene or lab)']);
    // scope.json as read: its group not yet checked.
    const unchecked: Scope = JSON.parse(JSON.stringify({ ...groups, 'src/b.ts': { tests: ['tests/b.test.ts'], floor: 90, baseline: '', group: 'x' } }));
    const bad = fakeDeps({ scope: unchecked });
    expect(await main([], bad.deps)).toBe(2);
    expect(bad.events).toEqual([]);
    expect(bad.out).toEqual(['E npm run mutate: src/b.ts: group "x" in scripts/mutation/scope.json is not core, android, scene or lab']);
  });
});

// A37: a cold run is cold. Stryker (its IncrementalDiffer) keeps every mutant of its incremental file that this run
// did not produce, --force or not: a module the file names but the group no longer mutates comes back in the report.

describe('main — a leftover incremental file cannot fail a run (A37)', () => {
  const moved = 'src/adapters/android-chooser.ts';
  const inc = 'reports/mutation/stryker-incremental-core.json';
  // An incremental file from before the module moved to android (A27): it names a module core no longer has.
  const stale = (): MutationReport => ({
    files: { 'src/a.ts': { mutants: mutants({ Killed: 10 }) }, [moved]: { mutants: mutants({ Killed: 3 }) } },
  });
  const current = (): MutationReport => ({ files: { 'src/a.ts': { mutants: mutants({ Killed: 10 }) } } });
  const mutatedIn = (disk: Map<string, OnDisk>) =>
    Object.keys((disk.get('reports/mutation/mutation-core.json') as MutationReport).files);

  it('--force: the group\'s incremental file is removed before Stryker starts, so the run is cold', async () => {
    const disk = new Map<string, OnDisk>([[inc, stale()]]);
    const { deps, events, out } = fakeDeps({ disk });
    expect(await main(['--group', 'core', '--force'], deps)).toBe(0);
    expect(out.filter((line) => line.includes('no floor'))).toEqual([]);
    expect(mutatedIn(disk)).toEqual(['src/a.ts']);
    expect(events.slice(0, 3)).toEqual([
      'remove reports/mutation/mutation-core.json',
      `remove ${inc}`,
      'spawn core run --force 600000',
    ]);
  });

  it('--force or --force=true: even an incremental file of the group\'s own modules goes, unread', async () => {
    for (const force of ['--force', '--force=true']) {
      const disk = new Map<string, OnDisk>([[inc, current()]]);
      const { deps, events } = fakeDeps({ disk });
      expect(await main(['--group', 'core', force], deps)).toBe(0);
      expect(events).toContain(`remove ${inc}`);
      expect(events).not.toContain(`read ${inc}`);
    }
  });

  it('no --force: an incremental file naming a module outside the group is removed, saying so', async () => {
    const disk = new Map<string, OnDisk>([[inc, stale()]]);
    const { deps, out } = fakeDeps({ disk });
    expect(await main(['--group', 'core'], deps)).toBe(0);
    expect(out).toContain(`npm run mutate: core: ${inc} names ${moved}, not in the group: removed, the run is cold`);
    expect(mutatedIn(disk)).toEqual(['src/a.ts']);
  });

  it('no --force: an unreadable incremental file (a run killed while writing it) is removed, saying why', async () => {
    const disk = new Map<string, OnDisk>([[inc, new SyntaxError('Unexpected end of JSON input')]]);
    const { deps, out } = fakeDeps({ disk });
    expect(await main(['--group', 'core'], deps)).toBe(0);
    const why = 'is unreadable (Unexpected end of JSON input)';
    expect(out).toContain(`npm run mutate: core: ${inc} ${why}: removed, the run is cold`);
  });

  it('no --force: an incremental file of the group\'s own modules is kept: a plain run stays incremental', async () => {
    const disk = new Map<string, OnDisk>([[inc, current()]]);
    const { deps, events, out } = fakeDeps({ disk });
    expect(await main(['--group', 'core'], deps)).toBe(0);
    expect(events.filter((e) => e.startsWith('remove'))).toEqual(['remove reports/mutation/mutation-core.json']);
    expect(out.filter((line) => line.includes('incremental'))).toEqual([]);
  });

  it('--incrementalFile: --force removes, and a plain run checks, the file Stryker will use', async () => {
    const given = 'reports/inc-core.json';
    const cold = new Map<string, OnDisk>([[given, stale()], [inc, stale()]]);
    const forced = fakeDeps({ disk: cold }).deps;
    expect(await main(['--group', 'core', '--force', '--incrementalFile', 'reports/inc.json'], forced)).toBe(0);
    expect(mutatedIn(cold)).toEqual(['src/a.ts']);
    const { deps, out } = fakeDeps({ disk: new Map<string, OnDisk>([[given, stale()]]) });
    expect(await main(['--group', 'core', '--incrementalFile', 'reports/inc.json'], deps)).toBe(0);
    expect(out).toContain(`npm run mutate: core: ${given} names ${moved}, not in the group: removed, the run is cold`);
  });
});

describe('spawnBounded — a group\'s Stryker in a process group of its own, bounded (T2b-2)', () => {
  const node = spawnBounded(process.execPath, process.cwd());
  const quiet = { AVERI_TEST_QUIET: '1' };

  it('its exit code, and the env it was given', async () => {
    expect(await node(['-e', 'process.exit(process.env.AVERI_TEST_QUIET === "1" ? 3 : 4)'], quiet, 5000)).toEqual({
      status: 3, signal: null, timedOut: false, interrupted: false,
    });
  });

  it('past its bound: its whole group goes, a grandchild too', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mutate-bound-'));
    try {
      const pidFile = join(dir, 'grandchild');
      // The grandchild ignores SIGTERM: only the SIGKILL to the group once its leader has gone ends it.
      const grandchild = JSON.stringify("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)");
      const script = `const c = require('node:child_process').spawn(process.execPath, ['-e', ${grandchild}], { stdio: 'ignore' });
        require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setInterval(() => {}, 1000);`;
      const run = await node(['-e', script], quiet, 400);
      expect(run).toMatchObject({ status: null, timedOut: true, interrupted: false });
      const pid = Number(readFileSync(pidFile, 'utf8'));
      await new Promise((r) => setTimeout(r, 100));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    it(`${signal} to mutate.ts goes to the group, the run says it was interrupted, and its listeners go`, async () => {
      const signals = new EventEmitter();
      const running = spawnBounded(process.execPath, process.cwd(), signals)(['-e', 'setInterval(() => {}, 1000)'], quiet, 5000);
      await new Promise((r) => setTimeout(r, 200));
      signals.emit(signal, signal); // as node calls a signal's listener
      expect(await running).toEqual({ status: null, signal, timedOut: false, interrupted: true });
      expect([signals.listenerCount('SIGINT'), signals.listenerCount('SIGTERM')]).toEqual([0, 0]);
    });
  }
});
