import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
      expect(file).toMatch(/^(src|scripts\/truth\/batch)\/[^/]+(\/[^/]+)*\.ts$/);
      expect(m.tests.length).toBeGreaterThan(0);
      expect(m.floor).toBeGreaterThan(0);
      expect(m.floor).toBeLessThanOrEqual(100);
    }
  });
});

// T2b-2: the run in groups (ADR 0038, the T2 amendment's T2b-2 part). planRuns and main over a fake spawner; no
// Stryker starts here.

const two: Scope = {
  'src/a.ts': { tests: ['tests/a.test.ts'], floor: 90, baseline: '', group: 'core' },
  'scripts/truth/batch/lab-x.ts': { tests: ['tests/x.test.ts'], floor: 90, baseline: '', group: 'lab' },
};

describe('planRuns — which groups run, each with its Stryker arguments (T2b-2)', () => {
  it('no --group: core then lab, each given the same arguments', () => {
    expect(planRuns([], two)).toEqual({ runs: [{ group: 'core', args: [] }, { group: 'lab', args: [] }] });
    expect(planRuns(['--force'], two)).toEqual({ runs: [{ group: 'core', args: ['--force'] }, { group: 'lab', args: ['--force'] }] });
  });

  it('--group <name> or --group=<name>: that group alone, the option not passed on to Stryker', () => {
    expect(planRuns(['--group', 'lab', '--force'], two)).toEqual({ runs: [{ group: 'lab', args: ['--force'] }] });
    expect(planRuns(['--force', '--group=core'], two)).toEqual({ runs: [{ group: 'core', args: ['--force'] }] });
  });

  it('an unknown group, a --group without its name, or two of them: a refusal naming it', () => {
    expect(planRuns(['--group', 'all'], two)).toEqual({ refusal: 'npm run mutate: --group all: not a group (core or lab)' });
    expect(planRuns(['--group=Core'], two)).toEqual({ refusal: 'npm run mutate: --group Core: not a group (core or lab)' });
    expect(planRuns(['--group'], two)).toEqual({ refusal: 'npm run mutate: --group needs a group (core or lab)' });
    expect(planRuns(['--group', '--force'], two)).toEqual({ refusal: 'npm run mutate: --group needs a group (core or lab)' });
    expect(planRuns(['--group', 'core', '--group', 'lab'], two)).toEqual({ refusal: 'npm run mutate: --group given twice: give one, or none for both' });
  });

  it('--tempDirName <name>: each group its own, the name suffixed with the group', () => {
    expect(planRuns(['--force', '--tempDirName', '.stryker-tmp-7'], two)).toEqual({
      runs: [
        { group: 'core', args: ['--force', '--tempDirName', '.stryker-tmp-7-core'] },
        { group: 'lab', args: ['--force', '--tempDirName', '.stryker-tmp-7-lab'] },
      ],
    });
    expect(planRuns(['--tempDirName=t', '--group', 'lab'], two)).toEqual({ runs: [{ group: 'lab', args: ['--tempDirName', 't-lab'] }] });
    expect(planRuns(['--tempDirName'], two)).toEqual({ refusal: 'npm run mutate: --tempDirName needs a name' });
  });

  it('--mutate without --group: each file to its own group, a group none names not run', () => {
    expect(planRuns(['--mutate', 'src/a.ts,scripts/truth/batch/lab-x.ts:3-9'], two)).toEqual({
      runs: [
        { group: 'core', args: ['--mutate', 'src/a.ts'] },
        { group: 'lab', args: ['--mutate', 'scripts/truth/batch/lab-x.ts:3-9'] },
      ],
    });
    expect(planRuns(['-m', 'scripts/truth/batch/lab-x.ts', '--force'], two)).toEqual({
      runs: [{ group: 'lab', args: ['--mutate', 'scripts/truth/batch/lab-x.ts', '--force'] }],
    });
    expect(planRuns(['--mutate=src/a.ts:1:2-3:4'], two)).toEqual({ runs: [{ group: 'core', args: ['--mutate', 'src/a.ts:1:2-3:4'] }] });
  });

  it('--mutate without --group: a file no scope entry names, or no file, is a refusal', () => {
    expect(planRuns(['--mutate', 'src/a.ts,src/*.ts'], two)).toEqual({
      refusal: 'npm run mutate: --mutate src/*.ts: not a scripts/mutation/scope.json module (give --group to mutate it)',
    });
    expect(planRuns(['--mutate'], two)).toEqual({ refusal: 'npm run mutate: --mutate needs a file' });
    expect(planRuns(['-m', ''], two)).toEqual({ refusal: 'npm run mutate: --mutate needs a file' });
  });

  it('--mutate with --group: passed on as given, globs too', () => {
    expect(planRuns(['--group', 'core', '--mutate', 'src/*.ts'], two)).toEqual({ runs: [{ group: 'core', args: ['--mutate', 'src/*.ts'] }] });
  });
});

/** A fake run: each group's Stryker result and report, and what main did, in order. */
function fakeDeps(o: { spawned?: Partial<Record<string, Partial<Spawned>>>; reports?: Record<string, MutationReport | undefined>; scope?: Scope } = {}) {
  const events: string[] = [];
  const out: string[] = [];
  let clock = 0;
  const deps: MutateDeps = {
    readScope: () => o.scope ?? two,
    spawn: (args, env, boundMs) => {
      const group = env.AVERI_MUTATE_GROUP;
      events.push(`spawn ${group} ${args.join(' ')} ${boundMs}`);
      clock += group === 'core' ? 212_400 : 98_600;
      return Promise.resolve({ status: 0, signal: null, timedOut: false, interrupted: false, ...o.spawned?.[group] });
    },
    readReport: (path) => {
      events.push(`read ${path}`);
      const group = /mutation-(\w+)\.json$/.exec(path)?.[1] ?? '';
      if (o.reports !== undefined && group in o.reports) return o.reports[group];
      const file = group === 'core' ? 'src/a.ts' : 'scripts/truth/batch/lab-x.ts';
      return { files: { [file]: { mutants: mutants({ Killed: 9, Survived: 1 }) } } };
    },
    removeReport: (path) => events.push(`remove ${path}`),
    now: () => clock,
    log: (line) => out.push(line),
    error: (line) => out.push(`E ${line}`),
  };
  return { deps, events, out };
}

describe('main — the groups one after the other, the run failing if either fails (T2b-2)', () => {
  it('no --group: core then lab, each its report removed first, its own env and 600 s bound; both pass: 0', async () => {
    const { deps, events, out } = fakeDeps();
    expect(GROUP_BOUND_MS).toBe(600_000);
    expect(await main(['--force'], deps)).toBe(0);
    expect(events).toEqual([
      'remove reports/mutation/mutation-core.json',
      'spawn core run --force 600000',
      'read reports/mutation/mutation-core.json',
      'remove reports/mutation/mutation-lab.json',
      'spawn lab run --force 600000',
      'read reports/mutation/mutation-lab.json',
    ]);
    expect(out).toEqual([
      'src/a.ts: 90.00 % (floor 90 %)',
      'scripts/truth/batch/lab-x.ts: 90.00 % (floor 90 %)',
      'npm run mutate: core passed in 212 s',
      'npm run mutate: lab passed in 99 s',
    ]);
  });

  it('each group\'s floors only: a group\'s report without the other group\'s modules passes', async () => {
    const { deps } = fakeDeps();
    expect(await main(['--group', 'core'], deps)).toBe(0);
  });

  it('core below its floor: lab still runs, and the run fails (exit 1) naming core', async () => {
    const { deps, events, out } = fakeDeps({ reports: { core: { files: { 'src/a.ts': { mutants: mutants({ Killed: 8, Survived: 2 }) } } } } });
    expect(await main([], deps)).toBe(1);
    expect(events).toContain('spawn lab run 600000');
    expect(out).toContain('E \nnpm run mutate (core) failed:\n  src/a.ts: 80.00 % (floor 90 %) — below its floor: a weakened test, or new code no test checks');
    expect(out.slice(-2)).toEqual(['npm run mutate: core failed (exit 1) in 212 s', 'npm run mutate: lab passed in 99 s']);
  });

  it('lab\'s Stryker exits 3: the run exits 3, core\'s pass kept in the summary', async () => {
    const { deps, out } = fakeDeps({ spawned: { lab: { status: 3 } } });
    expect(await main([], deps)).toBe(3);
    expect(out.slice(-2)).toEqual(['npm run mutate: core passed in 212 s', 'npm run mutate: lab failed (exit 3) in 99 s']);
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
    expect(out.slice(-2)).toEqual(['npm run mutate: core failed (exit 130) in 212 s', 'npm run mutate: lab not run: the run was interrupted']);
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
    expect(refused.out).toEqual(['E npm run mutate: --group all: not a group (core or lab)']);
    const bad = fakeDeps({ scope: { ...two, 'src/b.ts': { tests: ['tests/b.test.ts'], floor: 90, baseline: '', group: 'x' } } });
    expect(await main([], bad.deps)).toBe(2);
    expect(bad.events).toEqual([]);
    expect(bad.out).toEqual(['E npm run mutate: src/b.ts: group "x" in scripts/mutation/scope.json is not core or lab']);
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
    rmSync(dir, { recursive: true, force: true });
  });

  it('an interrupt of mutate.ts goes to the group, and the run says it was interrupted', async () => {
    const listeners = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const running = node(['-e', 'setInterval(() => {}, 1000)'], quiet, 5000);
    await new Promise((r) => setTimeout(r, 200));
    process.emit('SIGINT', 'SIGINT'); // as node calls a signal's listener
    expect(await running).toEqual({ status: null, signal: 'SIGINT', timedOut: false, interrupted: true });
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(listeners);
  });
});
