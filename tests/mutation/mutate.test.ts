import { describe, expect, it } from 'vitest';
import { checkFloors, readScope, scoreOf, type MutationReport, type Scope } from '../../scripts/mutation/mutate.js';

// scripts/mutation/mutate.ts: the floors `npm run mutate` holds each mutated module to (ADR 0038). The run itself
// (Stryker) is not started here; importing the script does nothing.

const mutants = (statuses: Record<string, number>) => Object.entries(statuses).flatMap(([status, n]) => Array.from({ length: n }, () => ({ status })));
const scope: Scope = { 'src/a.ts': { tests: ['tests/a.test.ts'], floor: 90, baseline: '' } };
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
      expect(file).toMatch(/^src\/.*\.ts$/);
      expect(m.tests.length).toBeGreaterThan(0);
      expect(m.floor).toBeGreaterThan(0);
      expect(m.floor).toBeLessThanOrEqual(100);
    }
  });
});
