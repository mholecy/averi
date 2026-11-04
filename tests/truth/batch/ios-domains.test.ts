import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TIMED_OUT } from '../../../scripts/truth/batch/bounded.js';
import {
  actionArgs,
  decideRestore,
  defaultsArgv,
  diffMaps,
  differText,
  DOMAINS,
  noPerformed,
  performedText,
  PROTECTED,
  protectedLine,
  restoreDomain,
  stateIn,
  typedMapOf,
  type DomainMap,
  type KeyVal,
  type RestoreInput,
} from '../../../scripts/truth/batch/ios-domains.js';
import { exitCodeOf, type Summary } from '../../../scripts/truth/batch/words.js';

// scripts/truth/batch/ios-domains.ts, its pure parts: the typed diff, d43-gate.ts's restore rule over batch-10's real
// exports (tests/fixtures/batch/d43-b10/, typed maps), the one `defaults` argv builder and its read-only domain, the
// state file's shape and the protected-key line. The parts over a simulator, through a recording fake Run, are
// tests/truth/batch/ios-domains-sim.test.ts.

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'batch', 'd43-b10');
/** batch-10's export of `domain` at `phase` (backup, after, readback, g4-before, g4-after), as a typed map. */
const exported = (domain: string, phase: string): Record<string, KeyVal> => JSON.parse(readFileSync(join(FIXTURES, `${domain}.${phase}.json`), 'utf8')) as Record<string, KeyVal>;

const A11Y = 'com.apple.Accessibility';
const bool = (b: boolean): KeyVal => ({ t: 'bool', c: String(b), v: String(b) });
const int = (n: number): KeyVal => ({ t: 'int', c: String(n), v: String(n) });
const str = (s: string): KeyVal => ({ t: 'string', c: JSON.stringify(s), v: s });
const dict = (c: string): KeyVal => ({ t: 'dict', c });
const input = (over: Partial<RestoreInput> & Pick<RestoreInput, 'backup' | 'now'>): RestoreInput => ({ domain: A11Y, backupPath: '/b/state.com.apple.Accessibility.backup.plist', ...over });

describe('diffMaps — typed, by key (batch-10: a WDA runner exit flips Accessibility bool → int)', () => {
  it('bool false is not int 0, bool true not int 1: a type change is a change though the value prints the same', () => {
    expect(diffMaps({ k: bool(false) }, { k: int(0) })).toEqual([{ key: 'k', kind: 'changed' }]);
    expect(diffMaps({ k: bool(true) }, { k: { t: 'int', c: 'true' } })).toEqual([{ key: 'k', kind: 'changed' }]);
    expect(diffMaps({ k: int(1) }, { k: int(1) })).toEqual([]);
  });

  it('missing (only before), extra (only now), changed — sorted by key; an absent domain is an empty one', () => {
    expect(diffMaps({ b: int(1), a: int(2), c: int(3) }, { c: int(4), d: int(5), a: int(2) })).toEqual([
      { key: 'b', kind: 'missing' },
      { key: 'c', kind: 'changed' },
      { key: 'd', kind: 'extra' },
    ]);
    expect(diffMaps(null, null)).toEqual([]);
    expect(diffMaps(null, { x: int(1) })).toEqual([{ key: 'x', kind: 'extra' }]);
    expect(diffMaps({ x: int(1) }, null)).toEqual([{ key: 'x', kind: 'missing' }]);
    expect(diffMaps({}, null)).toEqual([]);
  });

  it('a key named like an Object member is a key like any other (own keys only)', () => {
    expect(diffMaps({ toString: int(1) }, {})).toEqual([{ key: 'toString', kind: 'missing' }]);
    expect(diffMaps({}, { constructor: int(1) })).toEqual([{ key: 'constructor', kind: 'extra' }]);
  });

  it('differText names each key with its kind', () => {
    expect(differText([{ key: 'a', kind: 'changed' }, { key: 'b', kind: 'extra' }])).toBe('a changed, b extra');
  });
});

describe("decideRestore over batch-10's real exports (d43-gate.ts:296–338; batch-10-analysis.md:326–345)", () => {
  it('the three domains G4 read around the session are equal before and after it: nothing to do', () => {
    for (const d of DOMAINS) expect(decideRestore(input({ domain: d, backup: exported(d, 'g4-before'), now: exported(d, 'g4-after') })).verdict).toBe('equal');
  });

  it('keyboard.preferences and Preferences right after the run equal their backups (dates, a dict, an array, long ints)', () => {
    for (const d of ['com.apple.keyboard.preferences', 'com.apple.Preferences']) {
      expect(decideRestore(input({ domain: d, backup: exported(d, 'backup'), now: exported(d, 'after') }))).toEqual({ verdict: 'equal', actions: [], differ: [], hand: [] });
    }
  });

  it("the runner exit's flip: Accessibility's bool true read int 0 written back typed, -bool true, key by key, never the domain", () => {
    const plan = decideRestore(input({ backup: exported(A11Y, 'backup'), now: exported(A11Y, 'after') }));
    expect(plan.verdict).toBe('act');
    expect(plan.stage).toBe('per-key');
    expect(plan.differ).toEqual([
      { key: 'AccessibilityEnabled', kind: 'changed' },
      { key: 'ApplicationAccessibilityEnabled', kind: 'changed' },
      { key: 'AutomationEnabled', kind: 'changed' },
    ]);
    expect(plan.actions).toEqual([
      { op: 'write', key: 'AccessibilityEnabled', flag: '-bool', value: 'true' },
      { op: 'write', key: 'ApplicationAccessibilityEnabled', flag: '-bool', value: 'true' },
      { op: 'write', key: 'AutomationEnabled', flag: '-bool', value: 'true' },
    ]);
    expect(plan.actions.flatMap((a) => actionArgs(a, A11Y, null))).toEqual([
      ['write', A11Y, 'AccessibilityEnabled', '-bool', 'true'],
      ['write', A11Y, 'ApplicationAccessibilityEnabled', '-bool', 'true'],
      ['write', A11Y, 'AutomationEnabled', '-bool', 'true'],
    ]);
  });

  it('batch-10 read Accessibility back after those three writes: equal to its backup, the restore done', () => {
    expect(decideRestore(input({ backup: exported(A11Y, 'backup'), now: exported(A11Y, 'readback'), done: 'per-key' })).verdict).toBe('equal');
  });

  it('the flip the other way round: a bool false read int 0 is written back -bool false, and its read-back is equal', async () => {
    const backup = { ...exported(A11Y, 'backup'), AXSSystemUIProcessAppSmartInvertEnabledPreference: bool(false) };
    const now = { ...backup, AXSSystemUIProcessAppSmartInvertEnabledPreference: int(0) };
    const said: string[][] = [];
    const r = await restoreDomain(input({ backup, now }), { run: async (args) => (said.push(args), 0), read: async () => backup });
    expect(said).toEqual([['write', A11Y, 'AXSSystemUIProcessAppSmartInvertEnabledPreference', '-bool', 'false']]);
    expect(r.equal).toBe(true);
    expect(r.performed.wroteBack).toEqual(['AXSSystemUIProcessAppSmartInvertEnabledPreference']);
  });
});

describe('decideRestore — the rule, stage by stage (d43-gate.ts, batch-10 review)', () => {
  it('an extra key is deleted, a key — `defaults delete <domain> <key>` — never the domain', () => {
    const plan = decideRestore(input({ backup: { a: int(1) }, now: { a: int(1), x: str('late') } }));
    expect(plan.actions).toEqual([{ op: 'delete-key', key: 'x' }]);
    expect(actionArgs(plan.actions[0], A11Y, null)).toEqual([['delete', A11Y, 'x']]);
    expect(plan.hand).toEqual([`defaults delete ${A11Y} x`]);
  });

  it('every scalar type is written with its own flag; a missing key is written back as a changed one', () => {
    const backup = { b: bool(true), i: int(7), f: { t: 'float', c: '1.5', v: '1.5' }, s: str('a b') } as Record<string, KeyVal>;
    const plan = decideRestore(input({ backup, now: {} }));
    expect(plan.actions).toEqual([
      { op: 'write', key: 'b', flag: '-bool', value: 'true' },
      { op: 'write', key: 'f', flag: '-float', value: '1.5' },
      { op: 'write', key: 'i', flag: '-int', value: '7' },
      { op: 'write', key: 's', flag: '-string', value: 'a b' },
    ]);
    expect(plan.hand).toEqual([`defaults write ${A11Y} b -bool true`, `defaults write ${A11Y} f -float 1.5`, `defaults write ${A11Y} i -int 7`, `defaults write ${A11Y} s -string 'a b'`]);
  });

  it("a dict, an array, a date or data cannot be written per key: straight to the import, the hand line the import's once", () => {
    const backup = { d: dict('{"a": 1}'), e: { t: 'array', c: '[1]' }, t: { t: 'date', c: '{"$date": "x"}' }, z: { t: 'data', c: '{"$data": "AA=="}' } } as Record<string, KeyVal>;
    const plan = decideRestore(input({ backup, now: { d: dict('{"a": 2}') } }));
    expect(plan).toMatchObject({ verdict: 'act', stage: 'import', actions: [{ op: 'import' }] });
    expect(plan.hand).toEqual([`defaults import ${A11Y} /b/state.com.apple.Accessibility.backup.plist`]);
    expect(actionArgs(plan.actions[0], A11Y, '/b/x.plist')).toEqual([['import', A11Y, '/b/x.plist']]);
  });

  it('a scalar with no write text (none recorded) goes to the import too', () => {
    expect(decideRestore(input({ backup: { k: { t: 'int', c: '1' } }, now: { k: int(2) } })).stage).toBe('import');
  });

  it('still differing after the per-key writes (a write refused): the whole backup imported', () => {
    expect(decideRestore(input({ backup: { a: int(1) }, now: { a: int(2) }, done: 'per-key' }))).toMatchObject({ verdict: 'act', stage: 'import', actions: [{ op: 'import' }] });
  });

  it('the proven-merge fallback: after an import that exited 0 and brought every key back, extras left → delete the domain + import', () => {
    const plan = decideRestore(input({ backup: { a: int(1) }, now: { a: int(1), x: int(9) }, done: 'import', importExit: 0 }));
    expect(plan).toMatchObject({ verdict: 'act', stage: 'fallback', actions: [{ op: 'delete-domain-then-import' }] });
    expect(actionArgs(plan.actions[0], A11Y, '/b/x.plist')).toEqual([['delete', A11Y], ['import', A11Y, '/b/x.plist']]);
  });

  it('NOT VERIFIED when the import did not merge (a backup key still differs): the domain is never cleared then', () => {
    expect(decideRestore(input({ backup: { a: int(1), b: int(2) }, now: { a: int(3), b: int(2), x: int(9) }, done: 'import', importExit: 0 }))).toMatchObject({
      verdict: 'NOT VERIFIED',
      actions: [],
      why: 'the import did not bring back a: it did not merge, so the domain not cleared',
    });
  });

  it('NOT VERIFIED when the import exited non-zero, extras or not; an unknown exit said as ?', () => {
    expect(decideRestore(input({ backup: { a: int(1) }, now: { a: int(1), x: int(9) }, done: 'import', importExit: 1 })).why).toBe('defaults import exited 1: the domain not cleared');
    expect(decideRestore(input({ backup: { a: int(1) }, now: { a: int(2) }, done: 'import' })).why).toBe('defaults import exited ?: the domain not cleared');
  });

  it('NOT VERIFIED when it still differs after the fallback: nothing more is tried', () => {
    expect(decideRestore(input({ backup: { a: int(1) }, now: { a: int(2) }, done: 'fallback', importExit: 0 }))).toMatchObject({ verdict: 'NOT VERIFIED', why: 'it still differs after defaults delete + defaults import' });
  });

  it('a domain absent before the run: its keys deleted one by one, then NOT VERIFIED — never a domain delete, never an import', () => {
    const first = decideRestore(input({ backupPath: null, backup: null, now: { x: int(1), y: dict('{}') } }));
    expect(first.actions).toEqual([
      { op: 'delete-key', key: 'x' },
      { op: 'delete-key', key: 'y' },
    ]);
    const after = decideRestore(input({ backupPath: null, backup: null, now: { y: dict('{}') }, done: 'per-key' }));
    expect(after).toMatchObject({ verdict: 'NOT VERIFIED', actions: [], why: 'absent before the run: its keys deleted one by one, the domain itself never deleted, and it still holds keys' });
    expect(after.hand).toEqual([`defaults delete ${A11Y} y`]);
    expect(decideRestore(input({ backupPath: null, backup: null, now: { y: int(1) } })).actions.every((a) => a.op === 'delete-key')).toBe(true);
  });

  it('a key or value the shell would split is single-quoted in the hand line, a quote in it escaped', () => {
    const plan = decideRestore(input({ backupPath: "/b/it's.plist", backup: { "a'b": str("x'y"), d: dict('{}') }, now: { "a'b": str('z'), d: dict('[]') } }));
    expect(plan.hand).toEqual([`defaults write ${A11Y} 'a'\\''b' -string 'x'\\''y'`, `defaults import ${A11Y} '/b/it'\\''s.plist'`]);
  });
});

describe('restoreDomain — decideRestore driven to its end (d43-gate.ts:722)', () => {
  it('a write refused: recorded as refused, then the import, read back equal; each stage once', async () => {
    const backup = { a: int(1) };
    const reads: DomainMap[] = [{ a: int(2) }, backup];
    const said: string[][] = [];
    const r = await restoreDomain(input({ backup, now: { a: int(2) } }), { run: async (args) => (said.push(args), args[0] === 'write' ? 1 : 0), read: async () => reads.shift() ?? null });
    expect(said).toEqual([
      ['write', A11Y, 'a', '-int', '1'],
      ['import', A11Y, '/b/state.com.apple.Accessibility.backup.plist'],
    ]);
    expect(r.equal).toBe(true);
    expect(r.performed).toEqual({ deleted: [], wroteBack: [], refused: ['write a (exit 1)'], import: 0 });
  });

  it('the fallback recorded with both exits; a delete refused recorded as a delete', async () => {
    const backup = { a: int(1) };
    const reads: DomainMap[] = [{ a: int(1), x: int(9) }, { a: int(1), x: int(9) }, backup];
    const r = await restoreDomain(input({ backup, now: { a: int(1), x: int(9) } }), { run: async (args) => (args[0] === 'delete' && args.length === 3 ? 4 : 0), read: async () => reads.shift() ?? null });
    expect(r.performed).toEqual({ deleted: [], wroteBack: [], refused: ['delete x (exit 4)'], import: 0, fallback: { delete: 0, import: 0 } });
    expect(r.equal).toBe(true);
  });

  it('NOT VERIFIED ends it with the plan: nothing runs after', async () => {
    let calls = 0;
    const r = await restoreDomain(input({ backup: { a: int(1) }, now: { a: int(2) }, done: 'fallback' }), { run: async () => (calls++, 0), read: async () => null });
    expect([r.equal, r.plan.verdict, calls]).toEqual([false, 'NOT VERIFIED', 0]);
  });

  it('a read-back that throws (a plist plistlib cannot read) is thrown, never taken as an empty domain', async () => {
    await expect(restoreDomain(input({ backup: { a: int(1) }, now: { a: int(2) } }), { run: async () => 0, read: async () => Promise.reject(new Error('plistlib: no')) })).rejects.toThrow('plistlib: no');
  });

  it('performedText names each kind, in order, each with its domain; nothing done is empty', () => {
    expect(performedText('d', noPerformed())).toBe('');
    expect(performedText('d', { deleted: ['x'], wroteBack: ['a', 'b'], refused: ['write c (exit 1)'], import: 0, fallback: { delete: 0, import: 1 } })).toBe(
      'wrote back a, b in d; deleted x in d; refused in d: write c (exit 1); imported the whole backup into d (exit 0); fell back to defaults delete d (exit 0) + defaults import (exit 1)',
    );
  });
});

describe('defaultsArgv — the only `defaults` builder; the schemeapproval domain read only (batch-11, b11-dry shims/xcrun:21, :26)', () => {
  const UDID = 'LAB-SIMULATOR-UDID';

  it('builds `simctl spawn <udid> defaults <args>` for every verb the module runs', () => {
    expect(defaultsArgv(UDID, ['export', A11Y, '/o/x.plist'])).toEqual(['simctl', 'spawn', UDID, 'defaults', 'export', A11Y, '/o/x.plist']);
    for (const verb of ['read', 'write', 'delete', 'import']) expect(defaultsArgv(UDID, [verb, A11Y, 'k'])[4]).toBe(verb);
  });

  it('a read of the finportal key is allowed: it is how the key is watched', () => {
    expect(defaultsArgv(UDID, ['read', PROTECTED.domain, PROTECTED.key])).toEqual(['simctl', 'spawn', UDID, 'defaults', 'read', PROTECTED.domain, PROTECTED.key]);
  });

  it('write, delete, import and rename on the schemeapproval domain all throw — any key, not only finportal\'s (batch-11: the domain never written)', () => {
    for (const args of [
      ['write', PROTECTED.domain, PROTECTED.key, '-string', 'x'],
      ['write', PROTECTED.domain, 'another-key', '-bool', 'true'],
      ['delete', PROTECTED.domain, PROTECTED.key],
      ['delete', PROTECTED.domain],
      ['import', PROTECTED.domain, '/o/x.plist'],
      ['export', PROTECTED.domain, '/o/x.plist'],
    ]) {
      expect(() => defaultsArgv(UDID, args), args.join(' ')).toThrow(`on ${PROTECTED.domain}: refused — no batch writes that domain (read only)`);
    }
    expect(() => defaultsArgv(UDID, ['rename', PROTECTED.domain, 'a', 'b'])).toThrow('not a verb this module runs');
  });

  it('nor sneaked in: another case, a plist path for the domain, the domain as a later argument', () => {
    expect(() => defaultsArgv(UDID, ['write', 'com.apple.LaunchServices.SchemeApproval', 'k', '-int', '1'])).toThrow('refused');
    expect(() => defaultsArgv(UDID, ['import', `/Library/Preferences/${PROTECTED.domain}.plist`, '/o/x'])).toThrow('refused');
    expect(() => defaultsArgv(UDID, ['import', A11Y, `/o/${PROTECTED.domain}.plist`])).toThrow('refused');
  });

  it('a verb it does not run, an option first, or no verb: thrown', () => {
    expect(() => defaultsArgv(UDID, ['-currentHost', 'write', A11Y, 'k', '-int', '1'])).toThrow('defaults "-currentHost": not a verb this module runs (read, export, write, delete, import)');
    expect(() => defaultsArgv(UDID, ['rename', A11Y, 'a', 'b'])).toThrow('defaults "rename"');
    expect(() => defaultsArgv(UDID, [])).toThrow('defaults "": not a verb');
  });
});

describe('protectedLine — the finportal key, unchanged | CHANGED | unread (batch-11.sh:584–585; batch-8 run 1 VOID)', () => {
  const v = (value: string) => ({ state: 'value' as const, value });
  const absent = { state: 'absent' as const };
  const unreadable = { state: 'unreadable' as const, why: `past its bound (exit ${TIMED_OUT})` };
  const what = "com.apple.launchservices.schemeapproval's -->sk.finportal.myport";

  it('the same value at both ends: OK, unchanged, read only', () => {
    expect(protectedLine(v('1'), v('1'))).toBe(`OK   ${what} unchanged (1; read only)`);
  });

  it('absent at both ends is unchanged too — an absent key is a read, not a failure (batch-8.sh:356–361)', () => {
    expect(protectedLine(absent, absent)).toBe(`OK   ${what} unchanged (absent; read only)`);
  });

  it('a value that changed, appeared or went: an ERROR saying CHANGED; a value "absent" is no absent key', () => {
    const tail = "— no batch writes it: read it by hand (batch-5's backup stays read only)";
    expect(protectedLine(v('1'), v('2'))).toBe(`ERROR ${what} CHANGED: 1 at the start, 2 at the end ${tail}`);
    expect(protectedLine(absent, v('1'))).toBe(`ERROR ${what} CHANGED: absent at the start, 1 at the end ${tail}`);
    expect(protectedLine(v('absent'), absent)).toContain('CHANGED');
    expect(protectedLine(absent, v('absent'))).toContain('CHANGED');
  });

  it('unread at either end, or both: an ERROR saying unread — never unchanged, even when both reads failed alike', () => {
    expect(protectedLine(unreadable, unreadable)).toBe(`ERROR ${what} unread: unreadable (past its bound (exit 142)) at the start, unreadable (past its bound (exit 142)) at the end — no batch writes it: read it by hand (batch-5's backup stays read only)`);
    expect(protectedLine(v('1'), unreadable)).toContain(' unread: 1 at the start');
    expect(protectedLine(unreadable, absent)).toContain(' unread: unreadable');
  });

  it('a value with a line break is quoted, so the SUMMARY line stays one line', () => {
    expect(protectedLine(v('a\nb'), v('a\nb'))).toBe(`OK   ${what} unchanged ("a\\nb"; read only)`);
  });

  it('the line is a step line: an unchanged key exits 0, a CHANGED or unread one is an ERROR the SUMMARY shows (exit 0 alone)', () => {
    const summary = (line: string): Summary => ({ name: 'b', runId: 'r', checkout: 'OK   checkout', labs: [], blocks: [], protectedLines: [line], restore: { file: 'R', written: [] }, errors: [] });
    expect(exitCodeOf(summary(protectedLine(v('1'), v('1'))))).toBe(0);
    expect(exitCodeOf(summary(protectedLine(v('1'), v('2'))))).toBe(0);
  });
});

describe('the typed read and the state file, read strictly (sim-domains.ts review round 2: unreadable is no empty map)', () => {
  it('typedMapOf: a map of typed values, or why it is none', () => {
    expect(typedMapOf('{"a": {"t": "int", "c": "1", "v": "1"}, "d": {"t": "dict", "c": "{}"}}')).toEqual({ a: int(1), d: dict('{}') });
    expect(typedMapOf('{}')).toEqual({});
    expect(typedMapOf('not json')).toBe('its typed read is no JSON');
    for (const t of ['null', '[]', '1']) expect(typedMapOf(t)).toBe('its typed read is no map');
    for (const bad of ['{"a": null}', '{"a": 1}', '{"a": {"t": "real", "c": "1"}}', '{"a": {"t": "int"}}', '{"a": {"t": "int", "c": "1", "v": 1}}']) {
      expect(typedMapOf(bad), bad).toBe('its typed read holds no typed value for a');
    }
  });

  it('stateIn: d43-gate.ts\'s state shape, its domains the window\'s three only (T2 S4: a forged state names no other), or why not', () => {
    const ok = { dirty: true, udid: 'U', port: 8120, domains: [{ name: A11Y, backup: '/b' }, { name: 'com.apple.Preferences', backup: null }] };
    expect(stateIn(JSON.stringify(ok))).toEqual(ok);
    expect(stateIn(undefined)).toBe('it cannot be read');
    expect(stateIn('{')).toBe('it is no JSON');
    for (const bad of [null, [], { udid: 'U', domains: [] }, { dirty: 'yes', udid: 'U', domains: [] }, { dirty: true, domains: [] }, { dirty: true, udid: 'U' }]) {
      expect(stateIn(JSON.stringify(bad)), JSON.stringify(bad)).toBe('it is no state of the simulator domains');
    }
    for (const d of [null, { backup: null }, { name: 'x' }, { name: 'x', backup: 1 }]) {
      expect(stateIn(JSON.stringify({ dirty: true, udid: 'U', domains: [d] })), JSON.stringify(d)).toBe('a domain in it has no name or backup');
    }
    expect(stateIn(JSON.stringify({ dirty: true, udid: 'U', domains: [{ name: PROTECTED.domain, backup: null }] }))).toBe(`it names ${PROTECTED.domain}, not one of ${DOMAINS.join(', ')}`);
  });
});
