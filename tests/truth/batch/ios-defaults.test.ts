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
  shellQuote,
  stateIn,
  TYPED_PY,
  backupPathOf,
  typedMapOf,
  type DomainMap,
  type KeyVal,
  type RestoreInput,
} from '../../../scripts/truth/batch/ios-defaults.js';
import { exitCodeOf, type Summary } from '../../../scripts/truth/batch/words.js';

// scripts/truth/batch/ios-defaults.ts, the pure module: the typed diff, d43-gate.ts's restore rule over batch-10's
// real exports (tests/fixtures/batch/d43-b10/, typed maps), the one `defaults` argv builder and its read-only domain,
// the state file's shape and the protected-key line. ios-domains.ts over a simulator, through a recording fake Run, is
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
    expect(plan).toMatchObject({ verdict: 'act', stage: 'per-key' });
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
    expect(decideRestore(input({ backup: { k: { t: 'int', c: '1' } }, now: { k: int(2) } }))).toMatchObject({ stage: 'import' });
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
    expect(decideRestore(input({ backup: { a: int(1), b: int(2) }, now: {}, done: 'import', importExit: 0 }))).toMatchObject({ why: 'the import did not bring back a, b: it did not merge, so the domain not cleared' });
  });

  it('NOT VERIFIED when the import exited non-zero, extras or not; an unknown exit said as ?', () => {
    expect(decideRestore(input({ backup: { a: int(1) }, now: { a: int(1), x: int(9) }, done: 'import', importExit: 1 }))).toMatchObject({ why: 'defaults import exited 1: the domain not cleared' });
    expect(decideRestore(input({ backup: { a: int(1) }, now: { a: int(2) }, done: 'import' }))).toMatchObject({ why: 'defaults import exited ?: the domain not cleared' });
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

  it("the fallback's two exits each where it ran: its delete's and its import's, told apart (T2 S4 code review: one table of the actions)", async () => {
    const backup = { a: int(1) };
    let imports = 0;
    const r = await restoreDomain(input({ backup, now: { a: int(1), x: int(9) } }), {
      run: async (args) => (args[0] === 'import' ? (imports++ === 0 ? 0 : 3) : args.length === 2 ? 5 : 1),
      read: async () => ({ a: int(1), x: int(9) }),
    });
    expect(r.performed).toMatchObject({ import: 0, fallback: { delete: 5, import: 3 } });
    expect(r.equal).toBe(false);
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
    expect(performedText('d', { ...noPerformed(), deleted: ['x', 'y'] })).toBe('deleted x, y in d');
    expect(performedText('d', { deleted: ['x'], wroteBack: ['a', 'b'], refused: ['write c (exit 1)'], import: 0, fallback: { delete: 0, import: 1 } })).toBe(
      'wrote back a, b in d; deleted x in d; refused in d: write c (exit 1); imported the whole backup into d (exit 0); fell back to defaults delete d (exit 0) + defaults import (exit 1)',
    );
  });
});

describe('defaultsArgv — the only `defaults` builder; only the three domains written, the schemeapproval domain read only (batch-11, b11-dry shims/xcrun:21, :26; T2 S4 review round 1: an allowlist)', () => {
  const UDID = 'LAB-SIMULATOR-UDID';
  const refused = (verb: string, domain: string) => `defaults ${verb} ${JSON.stringify(domain)}: refused — only ${DOMAINS.join(', ')} are exported or written, each by its exact name; ${PROTECTED.domain} is read only`;

  it('builds `simctl spawn <udid> defaults <args>` for every verb the module runs, on each of the three domains', () => {
    expect(defaultsArgv(UDID, ['export', A11Y, '/o/x.plist'])).toEqual(['simctl', 'spawn', UDID, 'defaults', 'export', A11Y, '/o/x.plist']);
    for (const d of DOMAINS) for (const verb of ['read', 'export', 'write', 'delete', 'import']) expect(defaultsArgv(UDID, [verb, d, 'k'])[4]).toBe(verb);
    expect(defaultsArgv(UDID, ['delete', A11Y])).toEqual(['simctl', 'spawn', UDID, 'defaults', 'delete', A11Y]);
  });

  it('a read of the finportal key is allowed — a read of any domain is: it is how the key is watched', () => {
    expect(defaultsArgv(UDID, ['read', PROTECTED.domain, PROTECTED.key])).toEqual(['simctl', 'spawn', UDID, 'defaults', 'read', PROTECTED.domain, PROTECTED.key]);
  });

  it("write, delete, import and export on the schemeapproval domain all throw — any key, not only finportal's; rename throws always", () => {
    for (const args of [
      ['write', PROTECTED.domain, PROTECTED.key, '-string', 'x'],
      ['write', PROTECTED.domain, 'another-key', '-bool', 'true'],
      ['delete', PROTECTED.domain, PROTECTED.key],
      ['delete', PROTECTED.domain],
      ['import', PROTECTED.domain, '/o/x.plist'],
      ['export', PROTECTED.domain, '/o/x.plist'],
    ]) {
      expect(() => defaultsArgv(UDID, args), args.join(' ')).toThrow(refused(args[0], PROTECTED.domain));
    }
    expect(() => defaultsArgv(UDID, ['rename', PROTECTED.domain, 'a', 'b'])).toThrow('not a verb this module runs');
    expect(() => defaultsArgv(UDID, ['rename', A11Y, 'a', 'b'])).toThrow('defaults "rename": not a verb this module runs');
  });

  it('nor sneaked in: another case, a long s, a plist path, a domain a prefix of another, no domain — only the exact names pass', () => {
    for (const domain of ['com.apple.LaunchServices.SchemeApproval', 'com.apple.launch\u017fervices.schemeapproval', `/Library/Preferences/${PROTECTED.domain}.plist`, `/Library/Preferences/${A11Y}.plist`, 'com.apple.accessibility', `${A11Y}.extra`, ' com.apple.Accessibility', '']) {
      expect(() => defaultsArgv(UDID, ['write', domain, 'k', '-int', '1']), domain).toThrow(refused('write', domain));
    }
    expect(() => defaultsArgv(UDID, ['import'])).toThrow(refused('import', ''));
  });

  it('a backup path is no domain: an import into one of the three may read any file', () => {
    expect(defaultsArgv(UDID, ['import', A11Y, `/o/${PROTECTED.domain}.plist`])[5]).toBe(A11Y);
  });

  it('a verb it does not run, an option first, or no verb: thrown', () => {
    expect(() => defaultsArgv(UDID, ['-currentHost', 'write', A11Y, 'k', '-int', '1'])).toThrow('defaults "-currentHost": not a verb this module runs (read, export, write, delete, import)');
    expect(() => defaultsArgv(UDID, [])).toThrow('defaults "": not a verb');
  });
});

describe('shellQuote — a hand line a person pastes (d43-gate.ts\'s shq, renamed in the T2 S4 code review)', () => {
  it('a plain word as given; anything else single-quoted, a quote in it as \'\\\'\'', () => {
    expect(shellQuote('com.apple.Accessibility')).toBe('com.apple.Accessibility');
    expect(shellQuote('a@b%c+d=e:f,g./h-i_9')).toBe('a@b%c+d=e:f,g./h-i_9');
    expect(shellQuote('a b')).toBe("'a b'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote('')).toBe("''");
    expect(shellQuote('x\ny')).toBe("'x\ny'");
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

describe('TYPED_PY and the file names, as d43-gate.ts read and named them', () => {
  it("plistlib's bool is asked before its int (a Python bool is an int): bool true is never int 1; the top level must be a dictionary", () => {
    expect(TYPED_PY.indexOf('if isinstance(v,bool): return "bool"')).toBeGreaterThan(0);
    expect(TYPED_PY.indexOf('if isinstance(v,bool): return "bool"')).toBeLessThan(TYPED_PY.indexOf('if isinstance(v,int): return "int"'));
    expect(TYPED_PY).toContain('d=plistlib.load(f)');
    expect(TYPED_PY).toContain('if not isinstance(d,dict): sys.exit(');
    expect(TYPED_PY).toContain('print(json.dumps(out,sort_keys=True))');
  });

  it("a backup lies beside its state file as d43-gate.ts names it, the state's .json dropped from its end only", () => {
    expect(backupPathOf('/o/D43/state.json', A11Y)).toBe(`/o/D43/state.${A11Y}.backup.plist`);
    expect(backupPathOf('/o/a.json.x.json', A11Y)).toBe(`/o/a.json.x.${A11Y}.backup.plist`);
    expect(backupPathOf('/o/a.jsonl', A11Y)).toBe(`/o/a.jsonl.${A11Y}.backup.plist`);
  });
});

describe('the typed read and the state file, read strictly (sim-domains.ts review round 2: unreadable is no empty map)', () => {
  it('typedMapOf: a map of typed values, or why it is none', () => {
    expect(typedMapOf('{"a": {"t": "int", "c": "1", "v": "1"}, "d": {"t": "dict", "c": "{}"}}')).toEqual({ a: int(1), d: dict('{}') });
    const every = ['bool', 'int', 'float', 'string', 'data', 'date', 'dict', 'array'].map((t) => [t, { t, c: '0' }]);
    expect(typedMapOf(JSON.stringify(Object.fromEntries(every)))).toEqual(Object.fromEntries(every));
    expect(typedMapOf('{}')).toEqual({});
    expect(typedMapOf('not json')).toBe('its typed read is no JSON');
    for (const t of ['null', '[]', '1']) expect(typedMapOf(t)).toBe('its typed read is no map');
    for (const bad of ['{"a": null}', '{"a": 1}', '{"a": {"t": "real", "c": "1"}}', '{"a": {"t": "int"}}', '{"a": {"t": "int", "c": "1", "v": 1}}']) {
      expect(typedMapOf(bad), bad).toBe('its typed read holds no typed value for a');
    }
  });

  it("stateIn: d43-gate.ts's state shape, its domains the window's three, each once (T2 S4 review round 1: none, one missing, a duplicate or another refused whole), or why not", () => {
    const three = [{ name: A11Y, backup: '/b' }, { name: 'com.apple.Preferences', backup: null }, { name: 'com.apple.keyboard.preferences', backup: '/k' }];
    const ok = { dirty: true, udid: 'U', port: 8120, domains: three };
    expect(stateIn(JSON.stringify(ok))).toEqual(ok);
    expect(stateIn(undefined)).toBe('it cannot be read');
    expect(stateIn('{')).toBe('it is no JSON');
    for (const bad of [null, [], { udid: 'U', domains: [] }, { dirty: 'yes', udid: 'U', domains: [] }, { dirty: true, domains: [] }, { dirty: true, udid: 'U' }]) {
      expect(stateIn(JSON.stringify(bad)), JSON.stringify(bad)).toBe('it is no state of the simulator domains');
    }
    for (const d of [null, { backup: null }, { name: 'x' }, { name: 'x', backup: 1 }]) {
      expect(stateIn(JSON.stringify({ dirty: true, udid: 'U', domains: [d] })), JSON.stringify(d)).toBe('a domain in it has no name or backup');
    }
    const names = (domains: { name: string; backup: string | null }[]) => stateIn(JSON.stringify({ dirty: true, udid: 'U', domains }));
    const want = `not the window's ${DOMAINS.join(', ')}, each once`;
    expect(names([])).toBe(`it names no domain, ${want}`);
    expect(names(three.slice(0, 2))).toBe(`it names ${A11Y}, com.apple.Preferences, ${want}`);
    expect(names([...three, three[0]])).toBe(`it names ${A11Y}, com.apple.Preferences, com.apple.keyboard.preferences, ${A11Y}, ${want}`);
    expect(names([three[0], three[1], three[0]])).toBe(`it names ${A11Y}, com.apple.Preferences, ${A11Y}, ${want}`);
    expect(names([three[0], three[1], { name: PROTECTED.domain, backup: null }])).toBe(`it names ${A11Y}, com.apple.Preferences, ${PROTECTED.domain}, ${want}`);
    expect(names([three[0], three[1], { name: 'a\nb', backup: null }])).toBe(`it names ${A11Y}, com.apple.Preferences, "a\\nb", ${want}`);
  });
});
