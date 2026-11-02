import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Outcome } from '../../scripts/differential/differential.js';
import { expectations, formExpectations, pairingOf, taps, touchDowns, type Expectation } from '../../scripts/differential/golden-spec.js';
import { replyKind } from '../../scripts/truth/replies.js';
import type { CellTruth, ControlTruth, FieldTruth, Rect, TargetTruth } from '../../scripts/truth/schema.js';
import { missNote } from '../../src/ui-tree/miss.js';
import { IDB_STROKE_ABOVE_KEYBOARD, twice } from './golden/known.js';

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

/**
 * An open target its replayed source does not list (TargetTruth.listed): the lab's UIKit table row under idb, which lists
 * no identifier on any element (docs/bugs/2026-10-16-lab-ios-idb-lists-uikit-table-rows-without-their-identifier.md).
 * The honest answer is not tapped, nothing sent, the source's limit named; under WDA, which lists it, the rows are the
 * open ones. The replies are the captures' own (before the fix, from the golden run; after it, as averi words them).
 */
describe('an open target the replayed source does not list (sheet-long-list R under idb)', () => {
  const IOS = new URL('../fixtures/truth/ios-iphone17-ios27/', import.meta.url);
  const cell = JSON.parse(readFileSync(new URL('sheet-long-list.truth.json', IOS), 'utf8')) as CellTruth;
  const R = cell.targets.find((t) => t.tag === 'R')!;
  const tree = (source: string) => readFileSync(new URL(`sheet-long-list.${source}.json`, IOS), 'utf8');
  const idbRows = expectations('ios', R, cell, 'idb', tree('idb'));
  const wdaRows = expectations('ios', R, cell, 'wda', tree('wda'));
  const NOTE = missNote({ of: 'noIdListed', id: R.id })!;
  const UNLISTED = missNote({ of: 'idUnlisted', id: R.id })!;
  const SWIPES = ['idb ui swipe 201 699 201 175 --duration 0.3', 'idb ui swipe 201 699 201 175 --duration 0.3'];
  const timeout = (note?: string) => `ERROR Timed out after 5000ms waiting for element id:"${R.id}" to appear${note === undefined ? '' : `\n  (${note})`}`;
  const colour = (note?: string) => `1/1 asserts FAILED\nFAIL  element id:"${R.id}" fill within dE00 8 of ${R.color} — not found within 1 s${note === undefined ? '' : ` (${note})`}\nappAlive: true`;
  const stop = (note: string) => `ERROR scroll_until id:"${R.id}" failed after 2 swipes (the last 2, swiping down, did not change the screen) — element never appeared in the tree (${note})`;

  it('tap: a refusal that sent nothing and names the source\'s limit; one that says nothing of it, or sent a tap, is a mismatch', () => {
    const tap = row(idbRows, 'tap');
    expect(tap.judge(out(timeout(NOTE)))).toBeUndefined();
    expect(tap.judge(out(timeout()))).toBeDefined();
    expect(tap.judge(out(timeout(UNLISTED)))).toBeDefined();
    expect(tap.judge(out(timeout(NOTE), ['idb ui tap 201 158']))).toBeDefined();
  });

  it('colour: fails not found naming the source\'s limit; the bare not-found is a mismatch', () => {
    const c = row(idbRows, 'colour');
    expect(c.judge(out(colour(NOTE)))).toBeUndefined();
    expect(c.judge(out(colour()))).toBeDefined();
  });

  it('scroll_until: not reached, any strokes, naming the source\'s limit; the container words alone are a mismatch', () => {
    const s = row(idbRows, 'scroll_until');
    expect(s.judge(out(stop(NOTE), SWIPES))).toBeUndefined();
    expect(s.judge(out(stop(UNLISTED), SWIPES))).toBeDefined();
  });

  it('under WDA, which lists it, the open rows: a refusal is a mismatch whatever it names', () => {
    expect(row(wdaRows, 'tap').judge(out(timeout(NOTE)))).toBeDefined();
    expect(row(wdaRows, 'colour').judge(out(colour(NOTE)))).toBeDefined();
    expect(row(wdaRows, 'scroll_until').judge(out(stop(NOTE), SWIPES))).toBeDefined();
  });
});

describe('a target beneath a presented layer', () => {
  const rows = expectations('android', target({}), undefined, 'uiautomator');

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
    expect(colour.judge(out('1/1 asserts FAILED\nFAIL  element … — container (57,463 288x48) is drawn over the element … — a dialog is presented over the element — close it first'))).toBeUndefined();
  });

  it('colour: a target measured wholly off the screen is asked for its own colour (nothing there shows another)', () => {
    const off = row(expectations('ios', target({ geometry: 'off-screen', seen: '#000000', frame: rect(51, 1009, 300, 64) }), undefined, 'wda'), 'colour');
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
    expect(scroll.judge(out('ERROR scroll_until … stopped before any swipe — … — a dialog is presented over it — close it first, and a swipe would land on the dialog, so none was sent'))).toBeUndefined();
    expect(scroll.judge(out('ERROR scroll_until … never appeared in the tree', ['adb shell input swipe 540 1776 540 444 1334', 'adb shell input swipe 540 1776 540 444 1334']))).toMatch(
      /^swiped 2× beneath a presented layer/,
    );
  });
});

/**
 * A target beneath a presented layer that the replayed tree does not list (D32 slice 1): uiautomator dumps the active
 * window only, idb lists only the presented layer. The colour assert's "not found" is then the honest answer — judged
 * (`absent`, from the payload: truth.ts#listedIn), not vacuous — but only one that names the way out its row asks: the
 * presented remedy (as the tap row, never the active-window hint) — or, under idb, idb's reasons. The replies are the
 * captures' own.
 */
describe('a target beneath a presented layer its replayed tree does not list', () => {
  const capture = (run: string, cell: string, source: 'uiautomator' | 'idb' | 'wda') => {
    const dir = new URL(`../fixtures/truth/${run}/`, import.meta.url);
    const truth = JSON.parse(readFileSync(new URL(`${cell}.truth.json`, dir), 'utf8')) as CellTruth;
    const tree = readFileSync(new URL(source === 'uiautomator' ? `${cell}.xml` : `${cell}.${source}.json`, dir), 'utf8');
    const A = truth.targets.find((t) => t.tag === 'A')!;
    return { A, colour: row(expectations(source === 'uiautomator' ? 'android' : 'ios', A, truth, source, tree), 'colour') };
  };
  const notFound = (id: string, note?: string) => `1/1 asserts FAILED\nFAIL  element id:"${id}" fill within dE00 8 of #5C1715 — not found within 1 s${note === undefined ? '' : ` (${note})`}\nappAlive: true`;

  it('uiautomator: the presented remedy is green; the active-window hint, idb\'s reasons or a bare not-found is red', () => {
    const { A, colour } = capture('android-averi_lab-api33', 'alert-dim', 'uiautomator');
    expect(colour.absent).toBeDefined();
    expect(colour.judge(out(notFound(A.id, 'a dialog is presented over it, and the tree lists only that window — close it first')))).toBeUndefined();
    expect(colour.judge(out(notFound(A.id, missNote({ of: 'activeWindow' })!)))).toMatch(/^not found, without naming the presented remedy: FAIL/);
    expect(colour.judge(out(notFound(A.id, missNote({ of: 'idUnlisted', id: A.id })!)))).toMatch(/^not found, without naming the presented remedy: FAIL/);
    expect(colour.judge(out(notFound(A.id)))).toMatch(/^not found, without naming the presented remedy: FAIL/);
    expect(colour.judge(out('All 1 asserts passed\nPASS …'))).toMatch(/^passed on /);
  });

  it("idb: idb's reasons (either note) or the presented remedy are green; the active-window hint or a bare not-found is red", () => {
    const { A, colour } = capture('ios-iphone17-ios27', 'dim-cover', 'idb');
    expect(colour.absent).toBeDefined();
    expect(colour.judge(out(notFound(A.id, missNote({ of: 'idUnlisted', id: A.id })!)))).toBeUndefined();
    expect(colour.judge(out(notFound(A.id, missNote({ of: 'noIdListed', id: A.id })!)))).toBeUndefined();
    expect(colour.judge(out(notFound(A.id, 'a sheet or modal is presented over it, and the tree lists only that layer — close it first')))).toBeUndefined();
    expect(colour.judge(out(notFound(A.id, missNote({ of: 'activeWindow' })!)))).toMatch(/^not found, without naming the presented remedy or idb's reasons: /);
    expect(colour.judge(out(notFound(A.id)))).toMatch(/^not found, without naming the presented remedy or idb's reasons: /);
  });

  it('a tree that lists the target (WDA marks the layer and lists what is beneath it): the bare not-found stays vacuous', () => {
    const { A, colour } = capture('ios-iphone17-ios27', 'alert-dim', 'wda');
    expect(colour.absent).toBeUndefined();
    expect(colour.judge(out(notFound(A.id, 'a dialog is presented over it, and the tree lists only that window — close it first')))).toMatch(/^not in the tree: /);
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
  const rows = formExpectations('ios', formTruth([control({})]), 'wda');

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

/**
 * A field under the keyboard that idb's tree does not list (form-keyboard.idb: idb lists nothing beneath the keyboard).
 * Its colour, ocr and scroll_until rows judge the "not found" (`absent`, from the payload), as the presented colour
 * row: green only where it names idb's reasons — and, for scroll_until, the soft keyboard too; the presented remedy is
 * not this row's way out. The tap
 * (K1) is not changed: it asks the keyboard named, which the timeout does not. The replies are the capture's own.
 */
describe('a field under the keyboard its replayed tree does not list (form-keyboard under idb)', () => {
  const IOS = new URL('../fixtures/truth/ios-iphone17-ios27/', import.meta.url);
  const truth = JSON.parse(readFileSync(new URL('form-keyboard.truth.json', IOS), 'utf8')) as CellTruth;
  const tree = (source: string) => readFileSync(new URL(`form-keyboard.${source}.json`, IOS), 'utf8');
  const idbRows = formExpectations('ios', truth, 'idb', tree('idb')).filter((r) => r.target === 'vs');
  const wdaRows = formExpectations('ios', truth, 'wda', tree('wda')).filter((r) => r.target === 'vs');
  const ID = 'lab.form-keyboard.vs';
  const REASONS = missNote({ of: 'idUnlisted', id: ID })!;
  const ABOVE = twice(IDB_STROKE_ABOVE_KEYBOARD);
  const PRESENTED = 'a sheet or modal is presented over it, and the tree lists only that layer — close it first';
  const KEYBOARD = 'The soft keyboard was up over [0,590][402,874] in 3 of the 3 rounds read: in those, visibility was judged, and the swipe drawn, in the screen above it — to reach it with the keyboard down, hide it first';
  const assertNotFound = (note?: string) => `1/1 asserts FAILED\nFAIL  element id:"${ID}" fill within dE00 8 of #FFFFFF — not found within 1 s${note === undefined ? '' : ` (${note})`}\nappAlive: true`;
  const stop = (note?: string, keyboard?: string) =>
    `ERROR scroll_until id:"${ID}" failed after 2 swipes (the last 2, swiping down, did not change the screen) — element never appeared in the tree${note === undefined ? '' : ` (${note})`}.${keyboard === undefined ? '' : ` ${keyboard}`}`;

  it('colour: idb\'s reasons are green; the presented remedy or a bare not-found is red', () => {
    const c = row(idbRows, 'colour');
    expect(c.absent).toBeDefined();
    expect(c.judge(out(assertNotFound(REASONS)))).toBeUndefined();
    expect(c.judge(out(assertNotFound(PRESENTED)))).toMatch(/^not found, without naming idb's reasons: /);
    expect(c.judge(out(assertNotFound()))).toMatch(/^not found, without naming idb's reasons: /);
    expect(c.judge(out('All 1 asserts passed\nPASS …'))).toMatch(/^passed on #FFFFFF/);
  });

  it('ocr: idb\'s reasons are green; the presented remedy or a bare not-found is red', () => {
    const o = row(idbRows, 'ocr');
    expect(o.absent).toBeDefined();
    expect(o.judge(out(assertNotFound(REASONS)))).toBeUndefined();
    expect(o.judge(out(assertNotFound(PRESENTED)))).toMatch(/^not found, without naming idb's reasons: /);
    expect(o.judge(out(assertNotFound()))).toMatch(/^not found, without naming idb's reasons: /);
  });

  it('scroll_until: idb\'s reasons AND the soft keyboard are green; either alone, the presented remedy with the keyboard, or a bare not-found, is red; a stroke under the keyboard is red whatever it says', () => {
    const s = row(idbRows, 'scroll_until');
    expect(s.absent).toBeDefined();
    expect(s.judge(out(stop(REASONS, KEYBOARD), ABOVE))).toBeUndefined();
    expect(s.judge(out(stop(REASONS), ABOVE))).toMatch(/^not found, without naming idb's reasons and the soft keyboard: /);
    expect(s.judge(out(stop(undefined, KEYBOARD), ABOVE))).toMatch(/^not found, without naming idb's reasons and the soft keyboard: /);
    expect(s.judge(out(stop(PRESENTED, KEYBOARD), ABOVE))).toMatch(/^not found, without naming idb's reasons and the soft keyboard: /);
    expect(s.judge(out(stop(), ABOVE))).toMatch(/^not found, without naming idb's reasons and the soft keyboard: /);
    expect(s.judge(out(stop(REASONS, KEYBOARD), ['idb ui swipe 201 699 201 175 --duration 1.502']))).toMatch(/^touched down under the keyboard at \(201,699\)/);
  });

  it('the tap (K1) is not judged unlisted: it still asks the keyboard named', () => {
    expect(row(idbRows, 'tap').absent).toBeUndefined();
  });

  it('under WDA, which lists the field: no row is judged unlisted, and the bare not-found stays vacuous', () => {
    expect(wdaRows.filter((r) => r.absent !== undefined)).toEqual([]);
    expect(row(wdaRows, 'colour').judge(out(assertNotFound(REASONS)))).toMatch(/^not in the tree: /);
  });
});

describe('a field partly hidden whose probe fired another control (the phone field under the pinned submit)', () => {
  const phone = control({ tag: 'phone', id: 'lab.form-keyboard.phone', frame: rect(20, 530, 362, 34), situation: 'covered', probe: [{ kind: 'touch', tag: '201.0,547.0' }, { kind: 'submit', tag: 'invalid' }] });
  const rows = formExpectations('ios', formTruth([phone]), 'wda');

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
    expect(formExpectations('ios', formTruth([{ ...phone, probe: [{ kind: 'touch', tag: '201.0,547.0' }, { kind: 'focus', tag: '' }] }]), 'wda')).toEqual([]);
  });
});

describe('replyKind: what kind of reply it is, pinned on every known mismatch (golden.test.ts)', () => {
  it.each([
    ['ERROR Timed out after 5000ms waiting for element id:"lab.x" to appear', 'not found'],
    // the wait that MATCHED nodes, none usable (clipped out, 0×0): the target is in the tree — a refusal (#10's A)
    ['ERROR Timed out after 5000ms waiting for element id:"lab.x" to appear\n  (it matched only nodes clipped out above its scroll container (scrolled past it) — scroll_until it with direction: "up" first)', 'refused'],
    ['ERROR Timed out after 5000ms waiting for element id:"lab.x" to appear\n  (it matched only 0×0 nodes (scrolled off screen, or collapsed) — if it is in a scroll view, scroll_until it first)', 'refused'],
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
    expect(replyKind(reply)).toBe(kind);
  });
});
