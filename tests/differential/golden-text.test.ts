import { describe, expect, it } from 'vitest';
import type { Outcome } from '../../scripts/differential/differential.js';
import { expectations, formExpectations, type Expectation } from '../../scripts/differential/golden-spec.js';
import { verdictOf, type CalibrationEntry, type SideRun } from '../../scripts/truth/calibrate.js';
import type { GoldenCheck } from '../../scripts/differential/golden.js';
import type { CellTruth, ControlTruth, FieldTruth, Rect, TargetTruth } from '../../scripts/truth/schema.js';

// Phase 4's text rows (scripts/differential/golden-spec/text.ts) and the OCR half of the under-keyboard form row
// (golden-spec/forms.ts): a text target's string read back from the tree and, by the host's recognizer, from the
// screenshot — a reading of what is drawn over it is the mismatch.

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const out = (reply: string, device: string[] = []): Outcome => ({ reply, device });
const by = (rows: readonly Expectation[], verb: string) => {
  const r = rows.find((x) => x.verb === verb);
  if (r === undefined) throw new Error(`no ${verb} row`);
  return r;
};
const AMOUNT = '1 234,56 €';
const target = (over: Partial<TargetTruth> = {}): TargetTruth => ({
  tag: 'H',
  id: 'lab.text-sample.H',
  text: AMOUNT,
  color: '#E3F2FD',
  declared: 'open',
  frame: rect(11, 584, 380, 64),
  reached: true,
  probe: [{ kind: 'touch', tag: '201.0,616.0' }],
  drawn: 0.97,
  seen: '#E3F2FD',
  ...over,
});
const cell = (over: Partial<CellTruth> = {}): CellTruth => ({ cell: 'text-under-bar', layer: 'none', device: 'test', screen: { width: 402, height: 874 }, scale: 3, targets: [], ...over });
const PASS = (read: string) => out(`All 1 asserts passed\nPASS  element text:"x" renders text "x" — read ${JSON.stringify(read)}; vs expected "x" =`);
const READ_FAIL = (read: string) => out(`1/1 asserts FAILED\nFAIL  element text:"x" renders text "x" — read ${JSON.stringify(read)}; vs expected "x" ≠`);
const CLOSED = out('1/1 asserts FAILED\nFAIL  element text:"x" renders text "x" — button "Continue" (24,746 354x56) is drawn over the element …; failing closed, rendered text unchecked');
const NOTHING = out('1/1 asserts FAILED\nFAIL  element text:"x" renders text "x" — the recognizer read no text in this element rect (…); failing closed, rendered text unchecked');

describe('an open text target (text-sample)', () => {
  const rows = expectations('ios', target(), undefined, 'wda');

  it('asks the tap and the stop by its string, then the tree text and the ocr assert by it', () => {
    expect(rows.map((r) => r.verb)).toEqual(['tap', 'scroll_until', 'text', 'ocr']);
    expect(by(rows, 'text').call.args).toMatchObject({ asserts: [{ element: { text: AMOUNT }, text: AMOUNT }] });
    expect(by(rows, 'ocr').call.args).toMatchObject({ asserts: [{ element: { text: AMOUNT }, ocr: { text: AMOUNT } }] });
  });
  it('ocr: a PASS (exact, or equal under the fold) is right; a FAIL on a reading, or failing closed, is the mismatch', () => {
    const ocr = by(rows, 'ocr');
    expect(ocr.judge(PASS('1 234,56 €'))).toBeUndefined();
    expect(ocr.judge(READ_FAIL('1 234,56 C'))).toMatch(/^failed: FAIL/);
    expect(ocr.judge(NOTHING)).toMatch(/^failed: FAIL/);
    expect(ocr.judge(out('1/1 asserts FAILED\nFAIL  element text:"x" renders text "x" — not found within 1 s'))).toMatch(/^failed: /);
  });
  it('text: the tree reads it, else the mismatch', () => {
    expect(by(rows, 'text').judge(out('All 1 asserts passed\nPASS  element text:"x" with text "x" exists'))).toBeUndefined();
    expect(by(rows, 'text').judge(out('1/1 asserts FAILED\nFAIL  element … — not found within 1 s'))).toMatch(/^failed: /);
  });
  it('a target with no text gets no text rows; one not reached gets none', () => {
    expect(expectations('ios', target({ text: undefined }), undefined, 'wda').map((r) => r.verb)).toEqual(['tap', 'colour', 'scroll_until']);
    expect(expectations('ios', target({ reached: false }), undefined, 'wda')).toEqual([]);
  });
});

describe('a text target something is drawn over (#22: the pinned button, the status band)', () => {
  const pinned = rect(24, 746, 354, 56);
  const under = expectations('ios', target({ tag: 'P', text: 'Pokračovať na súhrn', geometry: 'under-chrome:pinned', frame: rect(51, 738, 300, 64), visible: rect(51, 738, 300, 64), piece: rect(51, 738, 300, 8) }), cell({ chrome: { pinned } }), 'wda');

  it.each([
    ['under the pinned button', under],
    ['in the status band', expectations('ios', target({ tag: 'S', text: 'Zostatok', geometry: 'status-band', frame: rect(0, 21, 402, 20), reached: false, probe: [] }), cell({ safeArea: { top: 62, left: 0, bottom: 34, right: 0 } }), 'wda')],
  ])('%s: ocr fails closed — a PASS or a reading measured what is over it', (_, rows) => {
    const ocr = by(rows, 'ocr');
    expect(ocr.judge(CLOSED)).toBeUndefined();
    expect(ocr.judge(NOTHING)).toBeUndefined();
    expect(ocr.judge(READ_FAIL('Continue'))).toMatch(/^measured the layer over the target as the target: FAIL/);
    expect(ocr.judge(PASS('Continue'))).toMatch(/^passed on what is drawn over it: PASS/);
    expect(rows.filter((r) => r.verb === 'text')).toEqual([]);
  });
});

describe('a text target across Android\'s navigation band (#23)', () => {
  const t = target({ tag: 'T', text: 'Zvuk a vibrácie', geometry: 'band-overlap:nav', frame: rect(108, 2105, 864, 74) });
  const gesture = cell({ cell: 'text-nav-cut', screen: { width: 1080, height: 2220 }, scale: 1, navigation: 'gesture', safeArea: { top: 66, left: 0, bottom: 66, right: 0 } });

  it('gesture navigation (the band the app\'s): a PASS or failing closed; a FAIL on a reading read what the band left of it', () => {
    const ocr = by(expectations('android', t, gesture, 'uiautomator'), 'ocr');
    expect(ocr.judge(PASS('Zvuk a vibrácie'))).toBeUndefined();
    expect(ocr.judge(CLOSED)).toBeUndefined();
    expect(ocr.judge(READ_FAIL('Zvuk a vibracic'))).toMatch(/^read what the band leaves of it as its text: FAIL/);
    expect(ocr.judge(out('ERROR boom'))).toMatch(/^neither passed nor failed closed/);
  });
  it('three-button navigation (the bar\'s): fails closed', () => {
    const ocr = by(expectations('android', { ...t, geometry: 'nav-band' }, { ...gesture, navigation: 'three-button' }, 'uiautomator'), 'ocr');
    expect(ocr.judge(CLOSED)).toBeUndefined();
    expect(ocr.judge(PASS('Zvuk a vibrácie'))).toMatch(/^passed on what is drawn over it/);
  });
});

describe('a field under the keyboard: the ocr half of #3', () => {
  const field: FieldTruth = { tag: 'vs', id: 'lab.form-keyboard.vs', kind: 'text', title: 'Variable symbol', titleId: 'lab.form-keyboard.vs.title', frame: rect(20, 1700, 1040, 120), value: '', focused: false, error: null };
  const control: ControlTruth = { tag: 'vs', id: 'lab.form-keyboard.vs', kind: 'field', frame: rect(20, 1700, 1040, 120), situation: 'under-keyboard', reached: false, probe: [{ kind: 'touch', tag: '540,1760' }], seen: '#F0F0F3' };
  const truth = cell({ cell: 'form-keyboard', screen: { width: 1080, height: 2220 }, scale: 1, form: { fields: [field], controls: [control], keyboard: { frame: rect(0, 1398, 1080, 822), field: 'postcode' }, screenError: null, submits: [] } });
  const rows = formExpectations('android', truth, 'uiautomator');

  it('asks the ocr assert by its identifier, for its own copy (its title, its value empty), beside the colour row', () => {
    expect(rows.map((r) => `${r.target} ${r.verb}`)).toEqual(['vs colour', 'vs ocr', 'vs scroll_until']);
    expect(by(rows, 'ocr').call.args).toMatchObject({ asserts: [{ element: { id: 'lab.form-keyboard.vs' }, ocr: { text: 'Variable symbol' } }] });
  });
  it('a reading measured the keyboard (the note: `read "123"`); failing closed naming it is right', () => {
    const ocr = by(rows, 'ocr');
    expect(ocr.judge(READ_FAIL('123'))).toMatch(/^measured the layer over the target as the target/);
    expect(ocr.judge(out('1/1 asserts FAILED\nFAIL  … the soft keyboard covers the element (…) — dismiss it …; failing closed, rendered text unchecked'))).toBeUndefined();
  });
});

describe('calibrate: a skipped row (no recognizer on the host) is not asked', () => {
  const K = 'android-averi_lab-api33/text-nav-cut.xml T ocr';
  const check = (more: Partial<GoldenCheck>): GoldenCheck => ({ recording: 'r', target: 'T', verb: 'ocr', says: '', reply: '', kind: 'other', calls: [], ...more });
  const side = (c: GoldenCheck): SideRun => ({ checks: new Map([[K, c]]) });
  const e: CalibrationEntry = { n: '23', note: 'x.md', status: 'calibrate', before: 'a', after: 'b', checks: [K] };
  it('NOT-ASKED, never DOES-NOT-FAIL for a row that was never measured', () => {
    expect(verdictOf(e, side(check({ skipped: 'no Vision' })), side(check({ skipped: 'no Vision' })))).toBe('NOT-ASKED');
    expect(verdictOf(e, side(check({ mismatch: 'read what the band leaves of it as its text: x' })), side(check({})))).toBe('CALIBRATED');
  });
});
