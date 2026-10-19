import { describe, expect, it } from 'vitest';
import type { Outcome } from '../../scripts/differential/differential.js';
import { expectations, formExpectations, type Expectation } from '../../scripts/differential/golden-spec.js';
import { verdictOf, type CalibrationEntry, type SideRun } from '../../scripts/truth/calibrate.js';
import { goldenReport, skippedCheck, type GoldenCheck } from '../../scripts/differential/golden.js';
import { ocrDecision, ocrSkip } from '../../scripts/differential/ocr-probe.js';
import { isRecognizerBinary } from '../../scripts/differential/fake-device.js';
import { textListedIn } from '../../scripts/truth/truth.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    expect(ocr.judge(READ_FAIL('1 234,56 C'))).toMatch(/^read "1 234,56 C", not the string: FAIL/);
    expect(ocr.judge(READ_FAIL('a "quoted" one'))).toMatch(/^read "a \\"quoted\\" one", not the string: /);
    expect(ocr.judge(NOTHING)).toMatch(/^failed: FAIL/);
    expect(ocr.judge(CLOSED)).toMatch(/^failed: FAIL/);
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
    expect(rows.map((r) => `${r.target} ${r.verb}`)).toEqual(['vs snapshot', 'vs colour', 'vs ocr', 'vs scroll_until']);
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

describe('a covered string missing from the tree (TargetTruth.textListed)', () => {
  const S = target({ tag: 'S', text: 'Zostatok', geometry: 'status-band', frame: rect(0, 11, 1080, 44), reached: false, probe: [] });
  const truth = cell({ screen: { width: 1080, height: 2220 }, scale: 1, safeArea: { top: 66, left: 0, bottom: 66, right: 0 } });
  const NOT_FOUND = out('1/1 asserts FAILED\nFAIL  element text:"Zostatok" renders text "Zostatok" — not found within 1 s');

  it('listed by the capture: "not found" is no evidence (vacuous), as anywhere', () => {
    const ocr = by(expectations('android', { ...S, textListed: { uiautomator: true } }, truth, 'uiautomator'), 'ocr');
    expect(ocr.absent).toBeUndefined();
    expect(ocr.judge(NOT_FOUND)).toMatch(/^not in the tree: /);
  });
  it('not listed by that source\'s capture: "not found" is right', () => {
    const ocr = by(expectations('android', { ...S, textListed: { uiautomator: false } }, truth, 'uiautomator'), 'ocr');
    expect(ocr.absent).toMatch(/lists no node carrying the string/);
    expect(ocr.judge(NOT_FOUND)).toBeUndefined();
    expect(ocr.judge(READ_FAIL('Continue'))).toMatch(/^measured the layer/);
  });
  it('no record (a capture before it): no excuse', () => {
    expect(by(expectations('android', S, truth, 'uiautomator'), 'ocr').absent).toBeUndefined();
  });
});

describe('textListedIn: a node carrying the string, per payload', () => {
  it('uiautomator: text or content-desc, entities decoded, whitespace collapsed; not a substring', () => {
    const xml = '<hierarchy><node text="1&#160;234,56&#160;€" content-desc="" /><node text="" content-desc="Payee&apos;s" /></hierarchy>';
    expect(textListedIn(xml, 'uiautomator', '1\u00a0234,56\u00a0€')).toBe(true);
    expect(textListedIn(xml, 'uiautomator', "Payee's")).toBe(true);
    expect(textListedIn(xml, 'uiautomator', '234,56')).toBe(false);
  });
  it('WDA / idb JSON: any string value', () => {
    expect(textListedIn(JSON.stringify([{ AXLabel: 'Pokračovať na súhrn', AXValue: null }]), 'idb', 'Pokračovať na súhrn')).toBe(true);
    expect(textListedIn(JSON.stringify({ value: { label: 'x', children: [{ label: 'Šťastný' }] } }), 'wda', 'Šťastný')).toBe(true);
    expect(textListedIn(JSON.stringify([{ AXLabel: 'Continue' }]), 'idb', 'Pokračovať')).toBe(false);
  });
  it('a uiautomator node by its text or content-desc only, not another attribute', () => {
    const xml = '<hierarchy><node text="" content-desc="" resource-id="Prihlásiť" bounds="[0,0][5,5]" /></hierarchy>';
    expect(textListedIn(xml, 'uiautomator', 'Prihlásiť')).toBe(false);
  });
  it('a payload that is not what its source writes is an error, not an empty tree (truth.ts#rawNodes)', () => {
    expect(() => textListedIn('not json', 'wda', 'x')).toThrow(/no JSON/);
    expect(() => textListedIn('[{"AXLabel":"x"}]', 'uiautomator', 'x')).toThrow(/no XML dump/);
  });
});

describe('the ocr rows\' availability (ocr-probe.ts#ocrSkip): skipped only on the named host conditions', () => {
  it.each([
    ['not macOS', { platform: 'linux' as const }, /this host is linux/],
    ['no swiftc', { platform: 'darwin' as const, compiler: { code: 'ENOENT', message: 'spawn swiftc ENOENT' } }, /no swiftc/],
    ['Vision in a sandbox', { platform: 'darwin' as const, run: { stdout: 'ERROR Error Domain=… Code=… "nilError"' } }, /nilError/],
  ])('%s → skipped', (_, o, why) => {
    expect(ocrSkip(o)).toMatch(why);
  });
  it.each([
    ['it reads', { platform: 'darwin' as const, run: { stdout: 'New payment\n' } }],
    ['it reads nothing', { platform: 'darwin' as const, run: { stdout: '' } }],
    ['a READING that says nilError (only the probe\'s own ERROR line skips)', { platform: 'darwin' as const, run: { stdout: 'nilError\nfound the word nilError here\n' } }],
    ['nilError in a build error, not the probe\'s line', { platform: 'darwin' as const, run: { error: 'ERROR nilError' } }],
    ['the probe does not compile', { platform: 'darwin' as const, run: { error: 'swiftc: error: no such module Vision' } }],
    ['swiftc exits non-zero', { platform: 'darwin' as const, compiler: { code: 1, message: 'exit 1' } }],
  ])('%s → asked (a side whose recognizer fails is red, not skipped)', (_, o) => {
    expect(ocrSkip(o)).toBeUndefined();
  });
});

describe('a skipped row and the report', () => {
  const c = skippedCheck('r/x.json', 'A', 'ocr', 'passes', 'Vision answers nilError');
  it('no call, no mismatch, its reply and reason say so', () => {
    expect(c).toMatchObject({ verb: 'ocr', kind: 'other', calls: [], skipped: 'Vision answers nilError' });
    expect(c.mismatch).toBeUndefined();
    expect(c.reply).toMatch(/^SKIPPED — no OCR on this host: Vision answers nilError/);
  });
  it('the report counts it and lists it as skipped, not ok', () => {
    const report = goldenReport([{ recording: 'r/x.json', checks: [c], broken: [] }]);
    expect(report).toMatch(/1 skipped \(no OCR on this host: Vision answers nilError\)/);
    expect(report).toMatch(/- skipped A ocr: passes/);
    expect(report).not.toMatch(/- ok A ocr/);
  });
});

describe('the fake device takes only averi\'s cached recognizer for the real one', () => {
  it('a path under <tmpdir>/averi-ocr-bin/, nothing that merely names it', () => {
    expect(isRecognizerBinary(join(tmpdir(), 'averi-ocr-bin', 'recognizer-0123'))).toBe(true);
    expect(isRecognizerBinary('/elsewhere/averi-ocr-bin/recognizer-0123')).toBe(false);
    expect(isRecognizerBinary('averi-ocr-bin')).toBe(false);
  });
});

describe('ocrDecision: what golden does with the probe\'s verdict', () => {
  it('no reason: the rows are asked, whatever GOLDEN_OCR says', () => {
    expect(ocrDecision(undefined, {})).toEqual({ ask: true });
    expect(ocrDecision(undefined, { GOLDEN_OCR: 'require' })).toEqual({ ask: true });
  });
  it('a reason: skipped — or thrown under GOLDEN_OCR=require', () => {
    expect(ocrDecision('Vision answers nilError', {})).toEqual({ ask: false, skip: 'Vision answers nilError' });
    expect(ocrDecision('Vision answers nilError', { GOLDEN_OCR: 'other' })).toEqual({ ask: false, skip: 'Vision answers nilError' });
    expect(() => ocrDecision('Vision answers nilError', { GOLDEN_OCR: 'require' })).toThrow(/^GOLDEN_OCR=require, but the ocr rows cannot be asked here: Vision answers nilError$/);
  });
});
