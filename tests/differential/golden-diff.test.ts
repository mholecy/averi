import { describe, expect, it } from 'vitest';
import { baseOf, diffReport, goldenDiff, type Ratchet } from '../../scripts/differential/golden-diff.js';
import type { GoldenCheck, GoldenResult } from '../../scripts/differential/golden.js';

// golden --against (scripts/differential/golden-diff.ts) over a two-run fixture: a base run, and a run after a "fix"
// that turns one known row green, rewords one reply, drops one row, adds another, skips one for want of OCR and adds a
// capture the base did not replay and no family counts. golden-cli.test.ts runs the command line itself.

const check = (recording: string, target: string, verb: GoldenCheck['verb'], over: Partial<GoldenCheck> = {}): GoldenCheck => ({
  recording,
  target,
  verb,
  says: 'as the truth implies',
  reply: `Tapped ${target}`,
  kind: 'Tapped',
  calls: [],
  ...over,
});
const result = (recording: string, checks: GoldenCheck[]): GoldenResult => ({ recording, checks, broken: [] });

const TAP = 'idb ui tap 1 2';
const BASE: GoldenResult[] = [
  result('r/a.json', [
    check('r/a.json', 'A', 'tap', { mismatch: 'refused without "close it first": ERROR …', reply: 'ERROR …', kind: 'refused' }),
    check('r/a.json', 'B', 'tap', { mismatch: 'not in the tree: ERROR gone', reply: 'ERROR gone', kind: 'not found' }),
    check('r/a.json', 'C', 'scroll_until', { reply: 'Element C fully visible after 0 swipes\nLast rect 1' }),
    check('r/a.json', 'D', 'tap'),
  ]),
  result('r/b.json', [check('r/b.json', 'A', 'ocr', { mismatch: 'read wrong: FAIL', reply: 'FAIL', kind: 'FAIL' })]),
  // Not replayed this time (an --only run): neither its checks nor its KNOWN rows are told.
  result('r/c.json', [check('r/c.json', 'A', 'tap', { mismatch: 'not in the tree: x', reply: 'x', kind: 'not found' })]),
];
const NOW: GoldenResult[] = [
  result('r/a.json', [
    check('r/a.json', 'A', 'tap', { calls: [TAP] }),
    check('r/a.json', 'B', 'tap', { mismatch: 'not in the tree: ERROR gone', reply: 'ERROR gone', kind: 'not found' }),
    check('r/a.json', 'C', 'scroll_until', { reply: 'Element C fully visible after 0 swipes\nLast rect 2\nmore' }),
    check('r/a.json', 'E', 'fully'),
  ]),
  result('r/b.json', [check('r/b.json', 'A', 'ocr', { reply: 'SKIPPED — no OCR on this host: sandbox', kind: 'other', skipped: 'sandbox' })]),
  // Not in the base: not compared, but its KNOWN row still red is held.
  result('r/d.json', [check('r/d.json', 'A', 'tap'), check('r/d.json', 'B', 'tap', { mismatch: 'not in the tree: y', reply: 'y', kind: 'not found' })]),
];
const RATCHET: Ratchet[] = [
  // `r/a.json Z tap`: a row its capture no longer asks — the ratchet fails it as fixed.
  { family: 'forms', known: { 'r/a.json A tap': {}, 'r/a.json B tap': {}, 'r/a.json Z tap': {}, 'r/c.json A tap': {}, 'r/d.json B tap': {} }, counts: { 'r/a.json': 3, 'r/c.json': 1 } },
  { family: 'text', known: { 'r/b.json A ocr': {} }, counts: { 'r/b.json': 1 } },
];

describe('golden --against: what changed since a base run (goldenDiff)', () => {
  const d = goldenDiff(BASE, NOW, RATCHET);

  it('every check whose verdict, reply or calls changed, and every check one run asks and the other does not — of the captures both runs replayed', () => {
    expect(d.changed.map((c) => [c.key, c.was?.reply, c.now?.reply])).toEqual([
      ['r/a.json A tap', 'ERROR …', 'Tapped A'],
      ['r/a.json C scroll_until', 'Element C fully visible after 0 swipes\nLast rect 1', 'Element C fully visible after 0 swipes\nLast rect 2\nmore'],
      ['r/a.json E fully', undefined, 'Tapped E'],
      ['r/b.json A ocr', 'FAIL', 'SKIPPED — no OCR on this host: sandbox'],
      ['r/a.json D tap', 'Tapped D', undefined],
    ]);
    expect(d.unbased).toEqual(['r/d.json']);
  });

  it('the calls alone, or the faults alone, are a change', () => {
    const calls = goldenDiff([result('r/a.json', [check('r/a.json', 'A', 'tap')])], [result('r/a.json', [check('r/a.json', 'A', 'tap', { calls: [TAP] })])], []);
    expect(calls.changed.map((c) => c.key)).toEqual(['r/a.json A tap']);
    const faults = goldenDiff([result('r/a.json', [check('r/a.json', 'A', 'tap')])], [result('r/a.json', [check('r/a.json', 'A', 'tap', { faults: ['UNMODELLED x'] })])], []);
    expect(faults.changed.map((c) => c.key)).toEqual(['r/a.json A tap']);
    expect(goldenDiff(BASE, BASE, []).changed).toEqual([]);
  });

  it('a key asked twice is matched by its occurrence', () => {
    const twice = (second: string) => [result('r/a.json', [check('r/a.json', 'A', 'tap'), check('r/a.json', 'A', 'tap', { reply: second })])];
    expect(goldenDiff(twice('one'), twice('two'), []).changed.map((c) => [c.key, c.was?.reply, c.now?.reply])).toEqual([['r/a.json A tap #2', 'one', 'two']]);
  });

  it("the KNOWN rows this run finds green or no longer asks, per family file — one still red, skipped or of a capture not run is held, as by golden.test.ts's ratchet", () => {
    expect(d.strike).toEqual([{ family: 'forms', keys: ['r/a.json A tap', 'r/a.json Z tap'] }]);
  });

  it("each capture whose checks differ from the ratchet's COUNTS, a capture no file counts among them", () => {
    expect(d.counts).toEqual([
      { family: 'forms', recording: 'r/a.json', was: 3, now: 4 },
      { family: undefined, recording: 'r/d.json', was: undefined, now: 2 },
    ]);
  });
});

describe('golden --against: the report (diffReport)', () => {
  it('the tallies of both runs over the captures both replayed, then the changed checks, the captures not compared, the rows to strike and the COUNTS to write', () => {
    expect(diffReport('base.json', goldenDiff(BASE, NOW, RATCHET))).toBe(
      [
        '# Golden against base.json: 5 checks (was 5), 1 mismatches (was 3), 0 broken targets (was 0), 1 skipped (was 0)',
        '',
        '## Changed: 5 checks',
        '- r/a.json A tap',
        '  verdict: was MISMATCH refused without "close it first": ERROR …',
        '           now ok',
        '  reply:',
        '    - ERROR …',
        '    + Tapped A',
        '  calls: was []',
        `         now ["${TAP}"]`,
        '- r/a.json C scroll_until',
        '  reply:',
        '    - Last rect 1',
        '    + Last rect 2',
        '    + more',
        '- NEW r/a.json E fully: ok',
        '- r/b.json A ocr',
        '  verdict: was MISMATCH read wrong: FAIL',
        '           now skipped (sandbox)',
        '- GONE r/a.json D tap: was ok',
        '',
        '## Not in the base, not compared: 1 capture',
        '  r/d.json',
        '',
        '## Strike from KNOWN: 2 rows',
        'tests/differential/golden/forms.known.ts',
        '  r/a.json A tap',
        '  r/a.json Z tap',
        '',
        '## COUNTS: 2 captures',
        'tests/differential/golden/forms.known.ts',
        '  r/a.json: 4 (was 3)',
        'no family file counts it',
        '  r/d.json: 2 (was none)',
        '',
      ].join('\n'),
    );
  });

  it('a fault that came or went is told', () => {
    const was = [result('r/a.json', [check('r/a.json', 'A', 'tap')])];
    const now = [result('r/a.json', [check('r/a.json', 'A', 'tap', { faults: ['UNMODELLED x'] })])];
    expect(diffReport('b', goldenDiff(was, now, []))).toContain('- r/a.json A tap\n  faults: was []\n          now ["UNMODELLED x"]\n');
  });
});

describe('golden --against: the base (baseOf)', () => {
  it("a --json run's results; anything else fails, naming the file", () => {
    expect(baseOf(JSON.stringify({ side: '/x', results: BASE }), 'b.json')).toEqual(BASE);
    expect(() => baseOf('{ not json', 'b.json')).toThrow('golden --against: b.json is no JSON');
    for (const bad of [{ checks: [] }, { results: [1, 2] }, { results: [{ recording: 'r/a.json' }] }, { results: [{ recording: 'r/a.json', checks: [] }] }, null]) {
      expect(() => baseOf(JSON.stringify(bad), 'b.json')).toThrow('golden --against: b.json is no golden --json output');
    }
  });
});
