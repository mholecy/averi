import { describe, expect, it } from 'vitest';
import { GROUPS, GROUP_ENV, groupScope, readScopeFile, scopeErrors, scopeOf } from '../../scripts/mutation/group.mjs';

// scripts/mutation/group.mjs: the mutation run's groups (ADR 0038, the T2 amendment's T2b-2 part), read by
// stryker.config.mjs, vitest.mutation.config.ts and mutate.ts alike.

const entry = (group: unknown, tests = ['tests/a.test.ts']) => ({ tests, floor: 90, baseline: '', group });
const scope = { 'src/a.ts': entry('core'), 'scripts/truth/batch/lab-x.ts': entry('lab', ['tests/x.test.ts']) };

describe('scopeErrors — every scope.json entry names exactly one known group (T2b-2)', () => {
  it('a scope where every entry names core or lab has no error', () => {
    expect(GROUPS).toEqual(['core', 'lab']);
    expect(scopeErrors(scope)).toEqual([]);
  });

  it('a missing group, an unknown one or a list of groups is an error naming the entry', () => {
    const bad = { 'src/a.ts': entry(undefined), 'src/b.ts': entry('Core'), 'src/c.ts': entry(['core', 'lab']), 'src/d.ts': entry('lab'), 'src/e.ts': entry('core') };
    expect(scopeErrors(bad)).toEqual([
      'src/a.ts: has no group in scripts/mutation/scope.json (core or lab)',
      'src/b.ts: group "Core" in scripts/mutation/scope.json is not core or lab',
      'src/c.ts: group ["core","lab"] in scripts/mutation/scope.json is not core or lab',
    ]);
  });

  it('a group no entry names is an error: its run would mutate nothing', () => {
    expect(scopeErrors({ 'src/a.ts': entry('core') })).toEqual(['group lab: no module in scripts/mutation/scope.json']);
  });

  it('scope.json itself: every entry in a known group, and both groups used', () => {
    expect(scopeErrors(readScopeFile())).toEqual([]);
  });
});

describe('groupScope — a group\'s own entries', () => {
  it('keeps only the entries of the group asked', () => {
    expect(Object.keys(groupScope(scope, 'core'))).toEqual(['src/a.ts']);
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
    expect(of.tests).toEqual(['tests/a.test.ts', 'tests/x.test.ts']);
    expect(of.files).toEqual({
      incremental: 'reports/mutation/stryker-incremental.json',
      json: 'reports/mutation/mutation.json',
      html: 'reports/mutation/mutation.html',
      tempDir: 'node_modules/.stryker-tmp',
    });
  });

  it('a test two entries of one group list is included once', () => {
    const shared = { 'src/a.ts': entry('core', ['tests/s.test.ts']), 'src/b.ts': entry('core', ['tests/s.test.ts', 'tests/b.test.ts']), 'src/c.ts': entry('lab') };
    expect(scopeOf({ [GROUP_ENV]: 'core' }, shared).tests).toEqual(['tests/s.test.ts', 'tests/b.test.ts']);
  });

  it('an unknown group in the env, or a scope with an error, throws: no Stryker run over the wrong modules', () => {
    expect(() => scopeOf({ [GROUP_ENV]: 'all' }, scope)).toThrow(`${GROUP_ENV}=all: not a mutation group (core or lab)`);
    expect(() => scopeOf({ [GROUP_ENV]: '' }, scope)).toThrow(`${GROUP_ENV}=: not a mutation group (core or lab)`);
    expect(() => scopeOf({ [GROUP_ENV]: 'core' }, { 'src/a.ts': entry('x'), 'src/b.ts': entry('lab') })).toThrow(
      'scripts/mutation/scope.json: src/a.ts: group "x" in scripts/mutation/scope.json is not core or lab',
    );
  });

  it('reads scope.json when no scope is given', () => {
    expect(Object.keys(scopeOf({}).scope)).toEqual(Object.keys(readScopeFile()));
  });
});
