import { describe, expect, it } from 'vitest';
import type { GoldenCheck, GoldenResult } from '../../scripts/differential/golden.js';
import { exitCode, pinOf, ratchet, ratchetLines, repinned, type KnownRow, type Pins } from '../../scripts/differential/ratchet.js';

// The ratchet golden.test.ts and golden.ts share (scripts/differential/ratchet.ts): what a run's checks say against the
// known mismatches (tests/differential/golden/<family>.known.ts) and their pinned replies (golden/pins.json) — the
// new, the drifted, the re-pinned, the fixed, the faults and the broken — and golden's exit code from them.

const check = (target: string, verb: GoldenCheck['verb'], over: Partial<GoldenCheck> = {}): GoldenCheck => ({
  recording: 'r/a.json',
  target,
  verb,
  says: 'as the truth implies',
  reply: `Tapped ${target}`,
  kind: 'Tapped',
  calls: [],
  ...over,
});
const result = (checks: GoldenCheck[], broken: string[] = [], recording = 'r/a.json'): GoldenResult => ({ recording, checks, broken });

const TAP = 'idb ui tap 1 2';
const REFUSED = 'ERROR id:"A" is under the sheet\nclose it first; nothing was tapped';
/** A standing accepted mismatch: refused, as KNOWN notes it, its reply as pinned. */
const standing = (over: Partial<GoldenCheck> = {}) => check('A', 'tap', { mismatch: 'not tapped: ERROR id:"A"', reply: REFUSED, kind: 'refused', calls: [], ...over });
const KNOWN: Record<string, KnownRow> = { 'r/a.json A tap': { cls: 'not tapped', kind: 'refused', calls: [], note: 'under the sheet' } };
const PINS: Pins = { 'r/a.json A tap': pinOf(REFUSED) };

describe('the ratchet: a run against KNOWN and the pins (ratchet, exitCode)', () => {
  it('a standing known mismatch, its class, kind, calls and reply as noted and pinned: counted known, exit 0', () => {
    const v = ratchet([result([standing(), check('B', 'tap')])], KNOWN, PINS);
    expect(v).toEqual({ standing: 1, unknown: [], drifted: [], repin: [], fixed: [], faults: [], broken: [], stalePins: [] });
    expect(exitCode(v)).toBe(0);
  });

  it('an unknown mismatch fails', () => {
    const v = ratchet([result([standing(), check('B', 'tap', { mismatch: 'not tapped: ERROR B', reply: 'ERROR B', kind: 'refused' })])], KNOWN, PINS);
    expect(v.unknown).toEqual(['r/a.json B tap — expected as the truth implies — not tapped: ERROR B']);
    expect(exitCode(v)).toBe(1);
  });

  it('a known row whose reply changed drifts from its pin — same class, kind and calls — and fails', () => {
    const reworded = REFUSED.replace('close it first', 'dismiss it first');
    const v = ratchet([result([standing({ reply: reworded })])], KNOWN, PINS);
    expect(v.drifted).toEqual([]);
    expect(v.repin).toEqual([{ key: 'r/a.json A tap', pin: pinOf(REFUSED), now: pinOf(reworded) }]);
    expect(exitCode(v)).toBe(1);
  });

  it('a known row that ran with no pin fails loudly; one skipped (no OCR here) needs none', () => {
    const v = ratchet([result([standing()])], KNOWN, {});
    expect(v.repin).toEqual([{ key: 'r/a.json A tap', now: pinOf(REFUSED) }]);
    expect(exitCode(v)).toBe(1);
    const ocr = { ...KNOWN, 'r/a.json T ocr': { cls: 'read wrong', kind: 'FAIL', calls: [], note: 'n' } };
    const skipped = ratchet([result([standing(), check('T', 'ocr', { reply: 'SKIPPED — no OCR', kind: 'other', skipped: 'sandbox' })])], ocr, PINS);
    expect(skipped).toMatchObject({ repin: [], fixed: [], standing: 1 });
    expect(exitCode(skipped)).toBe(0);
  });

  it('a known row drifted from its class, its reply kind or its calls fails, each named', () => {
    const v = ratchet([result([standing({ mismatch: 'stroked beneath: x', kind: 'not found', calls: [TAP] })])], KNOWN, PINS);
    expect(v.drifted).toEqual([
      'r/a.json A tap — noted not tapped — judged: stroked beneath: x',
      'r/a.json A tap — noted a refused reply — got not found: ERROR id:"A" is under the sheet',
      `r/a.json A tap — noted [] — sent ["${TAP}"]`,
    ]);
    expect(exitCode(v)).toBe(1);
  });

  it('a fault anywhere fails — on a green row, on a standing known one', () => {
    const FAULT = ['UNMODELLED xcrun foo'];
    const onGreen = ratchet([result([standing(), check('B', 'tap', { faults: FAULT })])], KNOWN, PINS);
    expect(onGreen.faults).toEqual(['r/a.json B tap: UNMODELLED xcrun foo']);
    expect(exitCode(onGreen)).toBe(1);
    const onKnown = ratchet([result([standing({ faults: FAULT })])], KNOWN, PINS);
    expect(onKnown).toMatchObject({ faults: ['r/a.json A tap: UNMODELLED xcrun foo'], unknown: [], drifted: [], repin: [] });
    expect(exitCode(onKnown)).toBe(1);
  });

  it('a broken target fails', () => {
    const v = ratchet([result([standing()], ['C: probe off'])], KNOWN, PINS);
    expect(v.broken).toEqual(['r/a.json C: probe off']);
    expect(exitCode(v)).toBe(1);
  });

  it('a fixed known row — asked green, or no longer asked — is reported for striking, and does not fail the exit code', () => {
    const v = ratchet([result([check('A', 'tap')])], KNOWN, PINS);
    expect(v.fixed).toEqual(['r/a.json A tap']);
    expect(v.standing).toBe(0);
    expect(exitCode(v)).toBe(0);
    expect(ratchet([result([])], KNOWN, PINS).fixed).toEqual(['r/a.json A tap']);
  });

  it("a known row of a capture not replayed (an --only run) is fixed for the whole corpus, held when scoped to what ran", () => {
    const other = [result([check('B', 'tap')], [], 'r/b.json')];
    expect(ratchet(other, KNOWN, PINS).fixed).toEqual(['r/a.json A tap']);
    expect(ratchet(other, KNOWN, PINS, { scope: 'replayed' }).fixed).toEqual([]);
  });

  it('a pin of no known row is stale — reported, not failing', () => {
    const v = ratchet([result([standing()])], KNOWN, { ...PINS, 'r/a.json Z tap': ['x'] });
    expect(v.stalePins).toEqual(['r/a.json Z tap']);
    expect(exitCode(v)).toBe(0);
  });
});

describe('the ratchet in the report (ratchetLines)', () => {
  it('nothing beyond the tally when every mismatch stands as known and pinned', () => {
    expect(ratchetLines(ratchet([result([standing()])], KNOWN, PINS))).toEqual([]);
  });

  it('each failure, the rows to strike, the replies to re-pin line by line and the stale pins', () => {
    const v = ratchet([result([standing({ reply: 'ERROR id:"A" is under the sheet\nhide it' }), check('B', 'tap', { mismatch: 'm: x', faults: ['UNMODELLED y'] })])], { ...KNOWN, 'r/a.json Z tap': KNOWN['r/a.json A tap'] }, { ...PINS, 'r/a.json Q tap': ['q'] });
    expect(ratchetLines(v).join('\n')).toBe(
      [
        '## Ratchet: exit 1 — 1 new, 0 drifted, 1 to re-pin, 1 with a fault, 0 broken; 1 to strike, 1 stale pin',
        '### New: not in KNOWN',
        '- r/a.json B tap — expected as the truth implies — m: x',
        '### Re-pin: the reply is not tests/differential/golden/pins.json\'s (golden.ts --pin)',
        '- r/a.json A tap',
        '    - close it first; nothing was tapped',
        '    + hide it',
        '### Faults',
        '- r/a.json B tap: UNMODELLED y',
        '### Strike from KNOWN: fixed',
        '- r/a.json Z tap',
        '### Stale pins: no KNOWN row',
        '- r/a.json Q tap',
        '',
      ].join('\n'),
    );
  });

  it("without the re-pins' diffs (--against shows them itself): still counted", () => {
    const v = ratchet([result([standing({ reply: 'other' })])], KNOWN, PINS);
    expect(ratchetLines(v, { repin: false })).toEqual(['## Ratchet: exit 1 — 0 new, 0 drifted, 1 to re-pin, 0 with a fault, 0 broken; 0 to strike, 0 stale pins', '']);
  });

  it('a missing pin says so', () => {
    expect(ratchetLines(ratchet([result([standing()])], KNOWN, {}))).toContain('- r/a.json A tap: no pin');
  });
});

describe('golden --pin: the pins written from a run (repinned)', () => {
  it("each known mismatch's reply by line, keys sorted; a skipped row's or an unreplayed capture's pin held; a fixed row's and a stale one dropped", () => {
    const known = { ...KNOWN, 'r/a.json T ocr': KNOWN['r/a.json A tap'], 'r/b.json A tap': KNOWN['r/a.json A tap'], 'r/a.json F tap': KNOWN['r/a.json A tap'] };
    const old: Pins = { 'r/a.json A tap': ['old'], 'r/a.json T ocr': ['read'], 'r/b.json A tap': ['b'], 'r/a.json F tap': ['f'], 'r/z.json A tap': ['z'] };
    const pins = repinned([result([standing(), check('T', 'ocr', { kind: 'other', skipped: 'sandbox' }), check('F', 'tap')])], known, old);
    expect(pins).toEqual({ 'r/a.json A tap': pinOf(REFUSED), 'r/a.json T ocr': ['read'], 'r/b.json A tap': ['b'] });
    expect(Object.keys(pins)).toEqual(['r/a.json A tap', 'r/a.json T ocr', 'r/b.json A tap']);
  });
});
