import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, matchesGlob, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { filesOf, GROUPS, GROUP_ENV, groupScope, isGroup, readScopeFile, scopeErrors, scopeOf } from '../../scripts/mutation/group.mjs';

// scripts/mutation/group.mjs: the mutation run's groups (ADR 0038, the T2 amendment's T2b-2 part), read by
// stryker.config.mjs, vitest.mutation.config.ts and mutate.ts alike.

const entry = (group: unknown, tests = ['tests/a.test.ts']) => ({ tests, floor: 90, baseline: '', group });
const scope = { 'src/a.ts': entry('core'), 'src/ui-tree/s.ts': entry('scene', ['tests/s.test.ts']), 'scripts/truth/batch/lab-x.ts': entry('lab', ['tests/x.test.ts']) };

describe('scopeErrors — every scope.json entry names exactly one known group (T2b-2)', () => {
  it('a scope where every entry names core, scene or lab has no error', () => {
    expect(GROUPS).toEqual(['core', 'scene', 'lab']);
    expect(scopeErrors(scope)).toEqual([]);
  });

  it('a missing group, an unknown one or a list of groups is an error naming the entry', () => {
    const bad = { 'src/a.ts': entry(undefined), 'src/b.ts': entry('Core'), 'src/c.ts': entry(['core', 'lab']), 'src/d.ts': entry('lab'), 'src/e.ts': entry('core'), 'src/f.ts': entry('scene') };
    expect(scopeErrors(bad)).toEqual([
      'src/a.ts: has no group in scripts/mutation/scope.json (core, scene or lab)',
      'src/b.ts: group "Core" in scripts/mutation/scope.json is not core, scene or lab',
      'src/c.ts: group ["core","lab"] in scripts/mutation/scope.json is not core, scene or lab',
    ]);
  });

  it('a group no entry names is an error: its run would mutate nothing', () => {
    expect(scopeErrors({ 'src/a.ts': entry('core') })).toEqual(['group scene: no module in scripts/mutation/scope.json', 'group lab: no module in scripts/mutation/scope.json']);
  });

  it('scope.json itself: every entry in a known group, and every group used', () => {
    expect(scopeErrors(readScopeFile())).toEqual([]);
  });
});

describe('groupScope — a group\'s own entries', () => {
  it('keeps only the entries of the group asked', () => {
    expect(Object.keys(groupScope(scope, 'core'))).toEqual(['src/a.ts']);
    expect(Object.keys(groupScope(scope, 'scene'))).toEqual(['src/ui-tree/s.ts']);
    expect(Object.keys(groupScope(scope, 'lab'))).toEqual(['scripts/truth/batch/lab-x.ts']);
  });
});

describe('scopeOf — what stryker.config.mjs and vitest.mutation.config.ts read for one Stryker process', () => {
  it('a group from the env: its entries, its tests and its own incremental file, reports and temp dir', () => {
    const of = scopeOf({ [GROUP_ENV]: 'lab' }, scope);
    expect(of.group).toBe('lab');
    expect(Object.keys(of.scope)).toEqual(['scripts/truth/batch/lab-x.ts']);
    expect(of.tests).toEqual(['tests/x.test.ts']);
    expect(of.files).toEqual({
      incremental: 'reports/mutation/stryker-incremental-lab.json',
      json: 'reports/mutation/mutation-lab.json',
      html: 'reports/mutation/mutation-lab.html',
      tempDir: 'node_modules/.stryker-tmp-lab',
    });
  });

  it('no group in the env (Stryker started by hand): the whole scope, under the unsuffixed names', () => {
    const of = scopeOf({}, scope);
    expect(of.group).toBeUndefined();
    expect(Object.keys(of.scope)).toEqual(Object.keys(scope));
    expect(of.tests).toEqual(['tests/a.test.ts', 'tests/s.test.ts', 'tests/x.test.ts']);
    expect(of.files).toEqual({
      incremental: 'reports/mutation/stryker-incremental.json',
      json: 'reports/mutation/mutation.json',
      html: 'reports/mutation/mutation.html',
      tempDir: 'node_modules/.stryker-tmp',
    });
  });

  it('a test two entries of one group list is included once', () => {
    const shared = { 'src/a.ts': entry('core', ['tests/s.test.ts']), 'src/b.ts': entry('core', ['tests/s.test.ts', 'tests/b.test.ts']), 'src/c.ts': entry('lab'), 'src/d.ts': entry('scene') };
    expect(scopeOf({ [GROUP_ENV]: 'core' }, shared).tests).toEqual(['tests/s.test.ts', 'tests/b.test.ts']);
  });

  it('an unknown group in the env, or a scope with an error, throws: no Stryker run over the wrong modules', () => {
    expect(() => scopeOf({ [GROUP_ENV]: 'all' }, scope)).toThrow(`${GROUP_ENV}=all: not a mutation group (core, scene or lab)`);
    expect(() => scopeOf({ [GROUP_ENV]: '' }, scope)).toThrow(`${GROUP_ENV}=: not a mutation group (core, scene or lab)`);
    expect(() => scopeOf({ [GROUP_ENV]: 'core' }, { 'src/a.ts': entry('x'), 'src/b.ts': entry('lab') })).toThrow(
      'scripts/mutation/scope.json: src/a.ts: group "x" in scripts/mutation/scope.json is not core, scene or lab',
    );
  });

  it('reads scope.json when no scope is given', () => {
    expect(Object.keys(scopeOf({}).scope)).toEqual(Object.keys(readScopeFile()));
  });
});

describe('isGroup and filesOf', () => {
  it('isGroup: core, scene and lab only', () => {
    expect(GROUPS.every(isGroup)).toBe(true);
    for (const name of ['Core', 'all', '', undefined, 1]) expect(isGroup(name)).toBe(false);
  });

  it('filesOf: a group\'s files suffixed, none: the unsuffixed names', () => {
    expect(filesOf('core').json).toBe('reports/mutation/mutation-core.json');
    expect(filesOf(undefined).json).toBe('reports/mutation/mutation.json');
  });
});

describe('vitest.mutation.config.ts — a group\'s Stryker runs that group\'s tests (T2b-2)', () => {
  it('its include is scopeOf\'s tests for the group in the env, or every module\'s with none', async () => {
    try {
      for (const group of [...GROUPS, undefined]) {
        vi.resetModules();
        vi.unstubAllEnvs();
        if (group !== undefined) vi.stubEnv(GROUP_ENV, group);
        const config = (await import('../../vitest.mutation.config.js')).default;
        expect(config.test?.include).toEqual(scopeOf(group === undefined ? {} : { [GROUP_ENV]: group }).tests);
      }
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
    expect(scopeOf({ [GROUP_ENV]: 'core' }).tests).not.toEqual(scopeOf({ [GROUP_ENV]: 'lab' }).tests);
  });
});

describe('a group\'s tests: every scoped test that imports a module of a group is in that group (T2b-2)', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const scope = readScopeFile();
  const inGroup = (test: string, group?: string) =>
    Object.values(scope).some((m) => (group === undefined || m.group === group) && m.tests.some((glob) => matchesGlob(test, glob)));
  const testFiles = readdirSync(join(root, 'tests'), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => `tests/${f.split('\\').join('/')}`);

  it('a scoped test importing a module of another group is in a group above it: core, then scene, then lab', () => {
    // Narrowing a group's include can only lower a score (fewer tests to kill a mutant): a loud floor failure, never a
    // false pass. So a scoped test that imports a module of a group runs in that group — unless the test's group builds
    // on the module's (GROUPS' order: core, scene, lab). Lab's tests import core's modules, what the lab is built on
    // (runner, bounded, io …), and may kill core mutants too (in main's single run lab-batch.test.ts was the first
    // killer of some); core's own tests must suffice for core's floors, and T2b-2's per-mutant compare with the single
    // run found every status unchanged (ADR 0038, T2b-2). The same for scene's (A25): its tests build scenes on core's
    // draw order and geometry, and core's own tests hold core's floors.
    const misplaced: string[] = [];
    for (const test of testFiles.filter((t) => inGroup(t))) {
      const source = readFileSync(join(root, test), 'utf8');
      for (const [, a, b] of source.matchAll(/from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]/g)) {
        const spec = a ?? b;
        if (!spec.startsWith('.')) continue;
        const module = relative(root, join(root, dirname(test), spec)).split('\\').join('/').replace(/\.js$/, '.ts');
        const group = scope[module]?.group;
        if (group === undefined || inGroup(test, group)) continue;
        if (GROUPS.some((above) => GROUPS.indexOf(above) > GROUPS.indexOf(group) && inGroup(test, above))) continue;
        misplaced.push(`${test} imports ${module} (${group}) but is not in ${group}'s tests`);
      }
    }
    expect(misplaced).toEqual([]);
    expect(testFiles.length).toBeGreaterThan(100);
  });
});
