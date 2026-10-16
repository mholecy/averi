import { describe, expect, it } from 'vitest';
import type { Outcome } from '../../scripts/differential/differential.js';
import { expectations, formExpectations, pairingOf, replyKind, taps, touchDowns, type Expectation } from '../../scripts/differential/golden-spec.js';
import type { CellTruth, ControlTruth, FieldTruth, Rect, TargetTruth } from '../../scripts/truth/schema.js';

// The golden spec's judges (scripts/differential/golden-spec/*.ts, behind the façade golden-spec.ts), each on the
// replies that decide it — the real ones, as the committed captures produce them (tests/differential/golden.test.ts
// runs those), and the ones a fix must not slip past.

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const out = (reply: string, device: string[] = []): Outcome => ({ reply, device });
const row = (rows: readonly Expectation[], verb: string): Expectation => {
  const r = rows.find((x) => x.verb === verb);
  if (r === undefined) throw new Error(`no ${verb} row`);
  return r;
};

const field = (tag: string, y: number, height = 34): FieldTruth => ({
  tag,
  id: `lab.f.${tag}`,
  kind: 'text',
  title: tag,
  titleId: `lab.f.${tag}.title`,
  frame: rect(20, y, 362, height),
  value: '',
  focused: false,
  error: null,
});

describe('pairingOf — verification.md, Field errors, on the app\'s frames', () => {
  const name = field('name', 160);
  const email = field('email', 256);
  const fields = [name, email];
  it.each([
    ['the same identifier below the field', 'lab.f.name', rect(20, 200, 150, 16), name, 'same identifier below the field'],
    ['the same identifier ABOVE the field is not the first rule; with no _error suffix, neither', 'lab.f.email', rect(20, 236, 150, 16), email, 'named neither way: not seen'],
    ['an own _error identifier 6 pt under its field', 'lab.f.name_error', rect(20, 200, 150, 16), name, 'own error identifier close under the field'],
    ['-error and .error suffixes alike', 'lab.f.name-error', rect(20, 200, 150, 16), name, 'own error identifier close under the field'],
    ['24 pt under: still close', 'lab.f.name.error', rect(20, 218, 150, 16), name, 'own error identifier close under the field'],
    ['34 pt under a 34-pt field: the field\'s height is the limit when it is more than 24', 'lab.f.name_error', rect(20, 228, 150, 16), name, 'own error identifier close under the field'],
    ['35 pt under a 34-pt field: too far', 'lab.f.name_error', rect(20, 229, 150, 16), name, 'too far under the field: pairs with none'],
    ['25 pt under a 20-pt field: too far (24 is the limit)', 'lab.f.name_error', rect(20, 205, 150, 16), field('name', 160, 20), 'too far under the field: pairs with none'],
    ['another field of the column between the message and the field', 'lab.f.name_error', rect(20, 300, 150, 16), name, 'another field between: pairs with none'],
    ['an identifier ending in no error suffix', 'IbanError', rect(20, 200, 150, 16), name, 'named neither way: not seen'],
  ] as const)('%s', (_name, id, frame, f, rule) => {
    const all = f === name || f === email ? fields : [f, email];
    expect(pairingOf(all, f, id, frame)).toBe(rule);
  });
});

describe('the gestures a reply sent, on both platforms', () => {
  it('reads idb\'s and adb\'s taps and swipe touch-downs', () => {
    const o = out('', ['idb ui tap 201 547', 'adb shell input tap 540 391', 'idb ui swipe 201 459 201 115 --duration 0.3', 'adb shell input swipe 540 1776 540 444 1334', 'adb shell wm size']);
    expect(taps(o)).toEqual(['idb ui tap 201 547', 'adb shell input tap 540 391']);
    expect(touchDowns(o)).toEqual([
      { x: 201, y: 459 },
      { x: 540, y: 1776 },
    ]);
  });
});

const target = (over: Partial<TargetTruth>): TargetTruth => ({
  tag: 'A',
  id: 'lab.alert-dim.A',
  color: '#E53935',
  declared: 'presented-over',
  frame: rect(51, 110, 300, 64),
  reached: false,
  probe: [{ kind: 'touch', tag: '201,142' }],
  drawn: 0,
  seen: '#B72E2A',
  ...over,
});

describe('a target beneath a presented layer', () => {
  const rows = expectations('android', target({}));

  it('tap: refused with "close it first" and nothing sent; a refusal that still sent a tap is a mismatch', () => {
    const tap = row(rows, 'tap');
    expect(tap.judge(out('ERROR … a screen is presented over it (a modal or a sheet) — close it first; nothing was tapped'))).toBeUndefined();
    expect(tap.judge(out('ERROR … close it first', ['adb shell input tap 540 391']))).toMatch(/^refused, but sent adb shell input tap 540 391/);
    expect(tap.judge(out('Tapped id:"lab.alert-dim.A"'))).toMatch(/^Tapped/);
    expect(tap.judge(out('ERROR Timed out after 5000ms waiting for element id:"lab.alert-dim.A" to appear'))).toMatch(/^refused without "close it first": ERROR Timed out/);
  });

  it('colour: a pass measured the cover; a fail because the element is not in the tree is no evidence', () => {
    const colour = row(rows, 'colour');
    expect(colour.judge(out('All 1 asserts passed\nPASS …'))).toMatch(/^passed on #B72E2A/);
    expect(colour.judge(out('1/1 asserts FAILED\nFAIL  element id:"lab.alert-dim.A" fill within dE00 8 of #B72E2A — not found within 1 s'))).toBe(
      'not in the tree: FAIL  element id:"lab.alert-dim.A" fill within dE00 8 of #B72E2A — not found within 1 s',
    );
    expect(colour.judge(out('1/1 asserts FAILED\nFAIL  element … — container (57,463 288x48) is drawn over the element … close it first'))).toBeUndefined();
  });

  it('colour: a target measured wholly off the screen is asked for its own colour (nothing there shows another)', () => {
    const off = row(expectations('ios', target({ geometry: 'off-screen', seen: '#000000', frame: rect(51, 1009, 300, 64) })), 'colour');
    expect(off.call.args).toMatchObject({ asserts: [{ color: { expected: '#E53935' } }] });
    expect(off.says).toMatch(/^fails \(nothing of it is on the screen\), asked for its own colour/);
    expect(row(rows, 'colour').call.args).toMatchObject({ asserts: [{ color: { expected: '#B72E2A' } }] });
  });

  it('colour: a fail with the element in the tree names the presented remedy, not the status bar\'s or the screen edge\'s (ADR 0018)', () => {
    const colour = row(rows, 'colour');
    expect(
      colour.judge(out('1/1 asserts FAILED\nFAIL  element … — the status bar is drawn over the element (element 24,-20 354x52, status bar 0,0 402x62) — scroll_until the element with `fully: true` first and re-run')),
    ).toMatch(/^failed without "close it first": FAIL {2}element … — the status bar/);
  });

  it('scroll_until: an Android stroke beneath the layer is a swipe', () => {
    const scroll = row(rows, 'scroll_until');
    expect(scroll.judge(out('ERROR scroll_until … stopped before any swipe … close it first'))).toBeUndefined();
    expect(scroll.judge(out('ERROR scroll_until … never appeared in the tree', ['adb shell input swipe 540 1776 540 444 1334', 'adb shell input swipe 540 1776 540 444 1334']))).toMatch(
      /^swiped 2× beneath a presented layer/,
    );
  });
});

const control = (over: Partial<ControlTruth>): ControlTruth => ({
  tag: 'vs',
  id: 'lab.form-keyboard.vs',
  kind: 'field',
  frame: rect(20, 604, 362, 34),
  situation: 'under-keyboard',
  reached: false,
  probe: [{ kind: 'touch', tag: '201.0,621.0' }],
  ...over,
});
const formTruth = (controls: ControlTruth[]): CellTruth => ({
  cell: 'form-keyboard',
  layer: 'none',
  device: 'test',
  screen: { width: 402, height: 874 },
  scale: 3,
  targets: [],
  form: { fields: [], controls, keyboard: { frame: rect(0, 573, 402, 301), field: 'postcode' }, screenError: null, submits: [] },
});

describe('a field under the keyboard', () => {
  const rows = formExpectations('ios', formTruth([control({})]));

  it('tap: refused naming the soft keyboard — the word in the echoed selector (form-keyboard) does not count', () => {
    const tap = row(rows, 'tap');
    expect(tap.judge(out('ERROR The soft keyboard covers id:"lab.form-keyboard.vs": the band it draws over [0,573][402,874] contains the tap point (201,621) …'))).toBeUndefined();
    expect(tap.judge(out('ERROR Timed out after 5000ms waiting for element id:"lab.form-keyboard.vs" to appear'))).toBe(
      'refused without naming the keyboard: ERROR Timed out after 5000ms waiting for element id:"lab.form-keyboard.vs" to appear',
    );
    expect(tap.judge(out('ERROR id:"lab.form-keyboard.vs" is under container "keyboard" …'))).toMatch(/^refused without naming the keyboard/);
    expect(tap.judge(out('Tapped id:"lab.form-keyboard.vs"', ['idb ui tap 201 621']))).toMatch(/^Tapped/);
  });
});

describe('a field partly hidden whose probe fired another control (the phone field under the pinned submit)', () => {
  const phone = control({ tag: 'phone', id: 'lab.form-keyboard.phone', frame: rect(20, 530, 362, 34), situation: 'covered', probe: [{ kind: 'touch', tag: '201.0,547.0' }, { kind: 'submit', tag: 'invalid' }] });
  const rows = formExpectations('ios', formTruth([phone]));

  it('has a tap and a scroll_until row', () => {
    expect(rows.map((r) => `${r.target} ${r.verb}`)).toEqual(['phone tap', 'phone scroll_until']);
  });

  it('tap: Tapped, or a tap sent on either platform, is a mismatch; a refusal sending nothing is not', () => {
    const tap = row(rows, 'tap');
    expect(tap.judge(out('Tapped id:"lab.form-keyboard.phone"', ['idb ui tap 201 547']))).toMatch(/^Tapped/);
    expect(tap.judge(out('ERROR … under button "Continue" … nothing was tapped', ['idb ui tap 201 547']))).toMatch(/^refused, but sent idb ui tap 201 547/);
    expect(tap.judge(out('ERROR … under button "Continue" …', ['adb shell input tap 540 1470']))).toMatch(/^refused, but sent adb shell input tap/);
    expect(tap.judge(out('ERROR id:"lab.form-keyboard.phone" is under button "Continue" (20,516 362x47) … nothing was tapped'))).toBeUndefined();
  });

  it('scroll_until: reached with no swipe is a mismatch; a stop, or a reach after swipes, is not', () => {
    const scroll = row(rows, 'scroll_until');
    expect(scroll.judge(out('Element id:"lab.form-keyboard.phone" fully visible after 0 swipes'))).toMatch(/^reached with no swipe where a tap fires submit invalid/);
    expect(scroll.judge(out('ERROR scroll_until … failed after 3 swipes — under button "Continue"', ['idb ui swipe 201 459 201 115 --duration 0.3']))).toBeUndefined();
    expect(scroll.judge(out('Element … visible after 1 swipe', ['idb ui swipe 201 459 201 115 --duration 0.3']))).toBeUndefined();
  });

  it('a covered control whose probe fired nothing else has no row', () => {
    expect(formExpectations('ios', formTruth([{ ...phone, probe: [{ kind: 'touch', tag: '201.0,547.0' }, { kind: 'focus', tag: '' }] }]))).toEqual([]);
  });
});

describe('replyKind: what kind of reply it is, pinned on every known mismatch (golden.test.ts)', () => {
  it.each([
    ['ERROR Timed out after 5000ms waiting for element id:"lab.x" to appear', 'not found'],
    ['ERROR scroll_until id:"lab.x" failed after 2 swipes (…) — element never appeared in the tree', 'not found'],
    ['1/1 asserts FAILED\nFAIL  element id:"lab.x" fill … — not found within 1 s', 'not found'],
    ['Tapped id:"lab.x"', 'Tapped'],
    ['Tapped id:"lab.x" (2 matches; …)', 'Tapped'],
    ['Element id:"lab.x" fully visible after 2 swipes', 'visible'],
    ['Element id:"lab.x" visible after 1 swipe — clipped at the bottom edge …', 'visible'],
    ['All 1 asserts passed\nPASS  element id:"lab.x" …', 'PASS'],
    ['1/1 asserts FAILED\nFAIL  element id:"lab.x" … — expected … got …', 'FAIL'],
    ['ERROR id:"lab.x" is under container (0,0 402x874) — scroll_until it first; nothing was tapped', 'refused'],
    ['ERROR id:"lab.x" is under a presented layer — close it first; nothing was tapped', 'refused'],
    ['ERROR The soft keyboard covers id:"lab.x" …', 'refused'],
    ['ERROR scroll_until id:"lab.x" failed after 2 swipes — under button "Continue"', 'refused'],
    ['something else', 'other'],
  ] as const)('%s → %s', (reply, kind) => {
    expect(replyKind(out(reply))).toBe(kind);
  });
});
