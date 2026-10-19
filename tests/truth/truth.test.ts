import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capture } from '../../scripts/truth/capture-run.js';
import type { LabDevice, RawTree } from '../../scripts/truth/lab-device.js';
import type { CatalogCell, CatalogForm, CellTruth, ControlTruth, LabState, ProbeEvent, Rect, TargetTruth } from '../../scripts/truth/schema.js';
import {
  axisOf,
  consistency,
  controlPiece,
  directionOf,
  controlConsistency,
  elementOf,
  imePanels,
  listedIn,
  nodeFramesIn,
  otherControlsFired,
  outOfProcessKeyboard,
  pieceAfterBack,
  probePoint,
  readControlProbe,
  readTargetProbe,
  selectorOf,
  situationOf,
  touchTargetOf,
  touchesAt,
} from '../../scripts/truth/truth.js';

// The truth's arithmetic (scripts/truth/truth.ts) and the one capture (capture-run.ts) behind a fake LabDevice: where a
// form control lies from the app's frames, what a probe's events say, when a cell is broken — no device.

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const SCREEN = rect(0, 0, 402, 874);

/**
 * form-keyboard as captured on the iPhone 17: the keyboard's top at 573, the submit pinned at 516.7..563 above it, in
 * its bar (the app reports `submit.bar`: the safe-area inset's 10-pt padding above and below, the screen's width).
 */
const FORM: CatalogForm = {
  title: 'Transfer details',
  fields: [{ tag: 'phone', kind: 'text', title: 'Phone' }],
  submit: { tag: 'submit', title: 'Continue', pinned: true },
};
const state = (over: Partial<LabState> = {}): LabState => ({
  cell: 'form-keyboard',
  ready: true,
  screen: SCREEN,
  scale: 3,
  frames: { submit: rect(20, 516.7, 362, 46.3), 'submit.bar': rect(0, 506.7, 402, 66.3) },
  events: [],
  keyboard: { frame: rect(0, 573, 402, 301), visible: true, field: 'postcode' },
  ...over,
});
const UNPINNED: CatalogForm = { ...FORM, submit: { tag: 'submit', title: 'Continue' } };
const field = { tag: 'phone', inSheet: false };

describe('elementOf / selectorOf — what a row asks a target by, replayed and live alike', () => {
  it('a text target by its text, a label target by its label, any other by its identifier', () => {
    expect(elementOf({ id: 'lab.c.N', text: 'Payee’s name' })).toEqual({ text: 'Payee’s name' });
    expect(elementOf({ id: 'lab.c.I', label: 'Close' })).toEqual({ label: 'Close' });
    expect(elementOf({ id: 'lab.c.A' })).toEqual({ id: 'lab.c.A' });
    expect(selectorOf({ id: 'lab.c.N', text: 'Payee’s name' })).toBe('text:"Payee’s name"');
    expect(selectorOf({ id: 'lab.c.I', label: 'Close' })).toBe('label:"Close"');
    expect(selectorOf({ id: 'lab.c.A' })).toBe('id:"lab.c.A"');
  });
});

describe('directionOf — toward the target, along its scroll view\'s axis', () => {
  const screen = { width: 402, height: 874 };
  const carousel = rect(24, 138, 354, 85);
  const at = (frame: Rect, scrollView?: string) => directionOf({ frame, visible: null, ...(scrollView !== undefined && { scrollView }) }, { screen, scrollViews: { carousel } });
  it('a card wholly right (left) of its carousel\'s clip, on its rows: `right` (`left`) — along x', () => {
    expect(at(rect(378, 138, 354, 85), 'carousel')).toBe('right');
    expect(at(rect(-330, 138, 354, 85), 'carousel')).toBe('left');
    expect(axisOf('right')).toBe('x');
    expect(axisOf('down')).toBe('y');
  });
  it('anything else up or down by its centre, as before: in no scroll view, or one the state does not report, or beside the clip but off its rows', () => {
    expect(at(rect(378, 138, 354, 85))).toBe('up');
    expect(at(rect(378, 138, 354, 85), 'other')).toBe('up');
    expect(at(rect(378, 900, 354, 85), 'carousel')).toBe('down');
  });
});

describe('nodeFramesIn — the target\'s nodes in a raw tree, the harness\'s own reading', () => {
  const T = 'fixtures/truth/';
  const read = (f: string) => readFile(new URL(`../${T}${f}`, import.meta.url), 'utf8');
  it('reads each source of the committed open cell: WDA rect, idb frame, uiautomator bounds', async () => {
    expect(nodeFramesIn(await read('ios-iphone17-ios27/open.wda.json'), 'wda', { id: 'lab.open.A' })).toEqual([rect(51, 110, 300, 64)]);
    expect(nodeFramesIn(await read('ios-iphone17-ios27/open.idb.json'), 'idb', { id: 'lab.open.A' })).toEqual([rect(51, 110, 300, 64)]);
    expect(nodeFramesIn(await read('android-averi_lab-api33/open.xml'), 'uiautomator', { id: 'lab.open.A' })).toEqual([rect(127, 303, 825, 176)]);
    // an id that only starts the same is not it
    expect(nodeFramesIn(await read('ios-iphone17-ios27/open.wda.json'), 'wda', { id: 'lab.open' })).toEqual([]);
  });
  it('a text target by its label (WDA, idb) or its text or content-desc (uiautomator), exactly', () => {
    const wda = JSON.stringify({ value: { label: 'x', rect: rect(0, 0, 9, 9), children: [{ label: 'Email', rect: rect(69, 493, 94, 18) }, { label: 'Email address', rect: rect(1, 1, 1, 1) }] } });
    expect(nodeFramesIn(wda, 'wda', { text: 'Email' })).toEqual([rect(69, 493, 94, 18)]);
    const idb = JSON.stringify([{ AXLabel: 'Email', frame: rect(69, 493, 93.67, 18) }, { AXLabel: 'Other', frame: rect(0, 0, 1, 1) }]);
    expect(nodeFramesIn(idb, 'idb', { text: 'Email' })).toEqual([rect(69, 493, 93.67, 18)]);
    const xml = '<hierarchy><node text="LOGIN" bounds="[10,20][110,60]" /><node text="" content-desc="A &amp; B" bounds="[0,0][5,5]" /></hierarchy>';
    expect(nodeFramesIn(xml, 'uiautomator', { text: 'LOGIN' })).toEqual([rect(10, 20, 100, 40)]);
    expect(nodeFramesIn(xml, 'uiautomator', { text: 'A & B' })).toEqual([rect(0, 0, 5, 5)]);
  });
  it('a label target by its accessibility label exactly, as averi reads it (WDA label, idb AXLabel, uiautomator content-desc, else its text)', async () => {
    const xml = '<hierarchy><node text="Close" content-desc="" bounds="[0,0][9,9]" /><node text="" content-desc="Close" bounds="[507,1843][573,1909]" /><node text="Close" content-desc="Dismiss" bounds="[1,1][2,2]" /></hierarchy>';
    expect(nodeFramesIn(xml, 'uiautomator', { label: 'Close' })).toEqual([rect(0, 0, 9, 9), rect(507, 1843, 66, 66)]);
    expect(nodeFramesIn(await read('android-averi_lab-api33/own-parts.xml'), 'uiautomator', { label: 'Close' })).toEqual([rect(507, 1843, 66, 66)]);
    const wda = JSON.stringify({ value: { children: [{ label: 'Close', rect: rect(179, 660, 44, 44) }, { label: 'Close menu', rect: rect(0, 0, 1, 1) }] } });
    expect(nodeFramesIn(wda, 'wda', { label: 'Close' })).toEqual([rect(179, 660, 44, 44)]);
    expect(nodeFramesIn(JSON.stringify([{ AXLabel: 'Close', frame: rect(179, 660, 44, 44) }]), 'idb', { label: 'Close' })).toEqual([rect(179, 660, 44, 44)]);
  });
  it('a text target found as textListedIn finds it: whitespace collapsed, a wrapped string one node', () => {
    const wda = JSON.stringify({ value: { children: [{ label: 'Payee’s\nname', rect: rect(10, 20, 100, 40) }] } });
    expect(nodeFramesIn(wda, 'wda', { text: 'Payee’s name' })).toEqual([rect(10, 20, 100, 40)]);
    const xml = '<hierarchy><node text="  Jiří  Dvořák " bounds="[1,2][11,22]" /></hierarchy>';
    expect(nodeFramesIn(xml, 'uiautomator', { text: 'Jiří Dvořák' })).toEqual([rect(1, 2, 10, 20)]);
    // an identifier is matched exactly, never collapsed
    expect(nodeFramesIn('[{"AXUniqueId":"lab.c.A ","frame":{"x":0,"y":0,"width":1,"height":1}}]', 'idb', { id: 'lab.c.A' })).toEqual([]);
  });
  it('each frame once; an unreadable payload is an error, not an empty tree', () => {
    const xml = '<hierarchy><node resource-id="a" bounds="[0,0][5,5]"><node resource-id="a" bounds="[0,0][5,5]" /></node><node resource-id="a" bounds="[0,0][5,9]" /></hierarchy>';
    expect(nodeFramesIn(xml, 'uiautomator', { id: 'a' })).toEqual([rect(0, 0, 5, 5), rect(0, 0, 5, 9)]);
    expect(() => nodeFramesIn('not json', 'wda', { id: 'a' })).toThrow(/no JSON/);
    expect(() => nodeFramesIn('{}', 'uiautomator', { id: 'a' })).toThrow(/no XML dump/);
  });
  it('uiautomator attributes decoded as textListedIn decodes them: numeric character references too', () => {
    // uiautomator writes non-ASCII as numeric references (docs/bugs/2026-10-15-android-numeric-character-references-
    // in-uiautomator-attributes-are-not-decoded.md); the text target's node is found by its string.
    const xml = '<hierarchy><node text="&#352;&#357;astn&#xFD;" bounds="[1,2][11,22]" /></hierarchy>';
    expect(nodeFramesIn(xml, 'uiautomator', { text: 'Šťastný' })).toEqual([rect(1, 2, 10, 20)]);
  });
});

describe('imePanels — a floating IME\'s panels, from the touchable region', () => {
  const BAND = rect(0, 2088, 1080, 132);
  const shown = '  mShowRequested=true mShowExplicitlyRequested=true mShowForced=false mInputShown=true\n';
  it('the rects beyond the band, while the input method says shown', () => {
    expect(imePanels(`${shown}    touchable region=SkRegion((71,1092,1008,1884)(0,2088,1080,2220))\n`, BAND)).toEqual([rect(71, 1092, 937, 792)]);
  });
  it('docked (the region is the band), hidden, or unreadable: none', () => {
    expect(imePanels(`${shown}    touchable region=SkRegion((0,1398,1080,2220))\n`, rect(0, 1398, 1080, 822))).toEqual([]);
    expect(imePanels('  mInputShown=false\n    touchable region=SkRegion((71,1092,1008,1884)(0,2088,1080,2220))\n', BAND)).toEqual([]);
    expect(imePanels(`${shown}    no region here\n`, BAND)).toEqual([]);
  });
  it('reads the committed docked capture as none', async () => {
    const ime = JSON.parse(await readFile(new URL('../fixtures/truth/android-averi_lab-api33/form-keyboard.ime.json', import.meta.url), 'utf8'));
    expect(imePanels(ime.shown.touchable, rect(0, 1398, 1080, 822))).toEqual([]);
  });
});

describe('situationOf', () => {
  it.each([
    ['open: centre on the screen, clear of the keyboard and the bar', rect(20, 456, 362, 34), state(), 'open'],
    ['under-keyboard: all of it at or below the keyboard top', rect(20, 604, 362, 34), state(), 'under-keyboard'],
    ['under-keyboard from the keyboard top exactly', rect(20, 573, 362, 34), state(), 'under-keyboard'],
    ['covered: straddling the keyboard top', rect(20, 560, 362, 34), state(), 'covered'],
    ['covered: centre in the pinned bar band (the phone field under Continue)', rect(20, 530, 362, 34), state(), 'covered'],
    ['covered: centre just inside the bar\'s 10 pt padding above the submit', rect(20, 489.8, 362, 34), state(), 'covered'],
    ['open: centre just above the bar', rect(20, 488.6, 362, 34), state(), 'open'],
    ['open: centre beside a bar narrower than the screen (Android reports its own)', rect(0, 530, 60, 34), state({ frames: { submit: rect(20, 516.7, 362, 46.3), 'submit.bar': rect(100, 506.7, 302, 66.3) } }), 'open'],
    ['open: a pinned submit whose state reports no bar covers nothing', rect(20, 530, 362, 34), state({ frames: { submit: rect(20, 516.7, 362, 46.3) } }), 'open'],
    ['open: the same field when the submit is not pinned', rect(20, 530, 362, 34), state(), 'open', UNPINNED],
    ['off-screen: centre below the screen', rect(20, 900, 362, 34), state(), 'off-screen'],
    ['off-screen: centre above the screen', rect(20, -60, 362, 34), state(), 'off-screen'],
    ['not-rendered: no frame', undefined, state(), 'not-rendered'],
    ['open: a hidden keyboard (its frame off the screen) covers nothing', rect(20, 604, 362, 34), state({ keyboard: { frame: rect(0, 874, 402, 301), visible: false, field: null } }), 'open'],
  ] as const)('%s', (_name, frame, s, expected, form: CatalogForm = FORM) => {
    expect(situationOf(frame, s, form, field)).toBe(expected);
  });

  it('the pinned submit itself is not covered by its own bar', () => {
    expect(situationOf(rect(20, 516.7, 362, 46.3), state(), FORM, { tag: 'submit', inSheet: false })).toBe('open');
  });

  it("a floating IME's panel: a centre under it is under the keyboard, a part of it only covered; the band as before", () => {
    // averi_lab under a floating Gboard: the app hears of the 132-px strip only; the panel 71,1092 937x792 above it.
    const s = state({ screen: rect(0, 0, 1080, 2220), frames: {}, keyboard: { frame: rect(0, 2088, 1080, 132), visible: true, field: 'postcode' } });
    const panel = [rect(71, 1092, 937, 792)];
    const form = UNPINNED;
    expect(situationOf(rect(55, 1462, 970, 120), s, form, field, panel)).toBe('under-keyboard');
    expect(situationOf(rect(55, 1000, 970, 120), s, form, field, panel)).toBe('covered');
    expect(situationOf(rect(55, 900, 970, 120), s, form, field, panel)).toBe('open');
    expect(situationOf(rect(55, 1462, 970, 120), s, form, field)).toBe('open');
    expect(situationOf(rect(55, 2100, 970, 100), s, form, field, panel)).toBe('under-keyboard');
  });

  it("controlPiece clears a floating IME's panel too: ss's piece below the panel (form-keyboard-floating)", () => {
    const s = state({ screen: rect(0, 0, 1080, 2220), frames: {}, keyboard: { frame: rect(0, 2088, 1080, 132), visible: true, field: 'postcode' } });
    expect(controlPiece(rect(55, 1842, 970, 99), s, UNPINNED, field, [rect(71, 1092, 937, 792)])).toEqual(rect(55, 1884, 970, 57));
    expect(controlPiece(rect(55, 1842, 970, 99), s, UNPINNED, field)).toEqual(rect(55, 1842, 970, 99));
  });

  it('presented-over: under an open picker sheet, unless it is in the sheet', () => {
    const picker: CatalogForm = { ...FORM, submit: { tag: 'submit', title: 'Save' }, picker: { field: 'country', title: 'Country', open: true, rows: [] } };
    const s = state({ keyboard: null, frames: { sheet: rect(0, 120, 402, 754) } });
    expect(situationOf(rect(20, 160, 362, 34), s, picker, field)).toBe('presented-over');
    expect(situationOf(rect(20, 160, 362, 34), s, picker, { tag: 'country.AL', inSheet: true })).toBe('open');
    expect(situationOf(rect(20, 60, 362, 34), s, picker, field)).toBe('open');
  });
});

const ev = (kind: ProbeEvent['kind'], tag: string): ProbeEvent => ({ kind, tag });

describe('the probe', () => {
  it('taps the rounded centre', () => {
    expect(probePoint(rect(20, 516.7, 362, 46.3))).toEqual({ x: 201, y: 540 });
  });

  it('a touch counts as the tap\'s within 2 units of the point', () => {
    const events = [ev('touch', '201.0,540.0'), ev('touch', '203.1,540'), ev('submit', 'valid')];
    expect(touchesAt(events, { x: 201, y: 540 })).toEqual([ev('touch', '201.0,540.0')]);
    expect(touchesAt(events, { x: 203, y: 542 })).toEqual([ev('touch', '201.0,540.0'), ev('touch', '203.1,540')]);
  });

  it('a target is reached by its own tap; everything else is its probe', () => {
    expect(readTargetProbe([ev('touch', '201,502'), ev('tap', 'S')], 'C')).toEqual({ reached: false, probe: [ev('touch', '201,502'), ev('tap', 'S')] });
    expect(readTargetProbe([ev('touch', '201,142'), ev('tap', 'A')], 'A')).toEqual({ reached: true, probe: [ev('touch', '201,142')] });
  });

  it('a field is reached by its focus, or by keeping the focus it had; a button by a submit; a row by its select; a country field by its tap', () => {
    const touch = ev('touch', '1,1');
    expect(readControlProbe([touch, ev('focus', 'phone')], { tag: 'phone', kind: 'field' }, { tag: 'phone', kind: 'text', title: '' }, 'phone').reached).toBe(true);
    expect(readControlProbe([touch], { tag: 'postcode', kind: 'field' }, { tag: 'postcode', kind: 'text', title: '' }, 'postcode').reached).toBe(true);
    // a floating IME's panel took the tap (no touch logged): the focus stays where the cell put it, no reach
    expect(readControlProbe([], { tag: 'postcode', kind: 'field' }, { tag: 'postcode', kind: 'text', title: '' }, 'postcode').reached).toBe(false);
    expect(readControlProbe([touch, ev('submit', 'invalid')], { tag: 'phone', kind: 'field' }, { tag: 'phone', kind: 'text', title: '' }, 'postcode')).toEqual({
      reached: false,
      probe: [touch, ev('submit', 'invalid')],
    });
    expect(readControlProbe([touch, ev('submit', 'invalid')], { tag: 'submit', kind: 'button' }, undefined, null)).toEqual({ reached: true, probe: [touch] });
    expect(readControlProbe([touch, ev('select', 'AL'), ev('dismissed', 'sheet')], { tag: 'country.AL', kind: 'row' }, undefined, null).reached).toBe(true);
    expect(readControlProbe([touch, ev('tap', 'country')], { tag: 'country', kind: 'field' }, { tag: 'country', kind: 'country', title: '' }, null).reached).toBe(true);
  });

  it('another control fired: a submit, a select, a button, another tap — not a focus, a dismissal or a touch', () => {
    const probe = [ev('touch', '1,1'), ev('focus', ''), ev('dismissed', 'sheet'), ev('submit', 'invalid'), ev('select', 'AL'), ev('button', 'Keep'), ev('tap', 'S'), ev('tap', 'C')];
    expect(otherControlsFired(probe, 'C')).toEqual([ev('submit', 'invalid'), ev('select', 'AL'), ev('button', 'Keep'), ev('tap', 'S')]);
  });
});

const target = (over: Partial<TargetTruth>): TargetTruth => ({
  tag: 'A',
  id: 'lab.open.A',
  color: '#E53935',
  declared: 'open',
  frame: rect(51, 110, 300, 64),
  reached: true,
  probe: [ev('touch', '201.0,142.0')],
  drawn: 1,
  seen: '#E53935',
  ...over,
});

describe('consistency', () => {
  it('an open target, reached and drawn, with its touch: consistent', () => {
    expect(consistency(target({}))).toBeUndefined();
  });

  it('a probe tap that left no touch is broken, whatever else it says (the positive control)', () => {
    expect(consistency(target({ probe: [] }))).toMatch(/no touch/);
    expect(consistency(target({ declared: 'presented-over', reached: false, drawn: 0, probe: [] }))).toMatch(/no touch/);
    // A touch elsewhere is not this tap's.
    expect(consistency(target({ probe: [ev('touch', '20,20')] }))).toMatch(/no touch/);
  });

  it('declared open but not reached or not drawn; declared presented-over but reached', () => {
    expect(consistency(target({ reached: false }))).toMatch(/declared open/);
    expect(consistency(target({ drawn: 0.94 }))).toMatch(/drawn 94%/);
    expect(consistency(target({ declared: 'presented-over', drawn: 0 }))).toMatch(/presented-over, but the probe tap reached it/);
  });
});

const control = (over: Partial<ControlTruth>): ControlTruth => ({
  tag: 'vs',
  id: 'lab.form-keyboard.vs',
  kind: 'field',
  frame: rect(20, 604, 362, 34),
  situation: 'under-keyboard',
  reached: false,
  probe: [ev('touch', '201.0,621.0')],
  ...over,
});
const KEYBOARD = rect(0, 573, 402, 301);

describe('controlConsistency', () => {
  it('a probe tap with no touch is broken — but on an out-of-process keyboard (Android\'s IME: its touches are not the app\'s)', () => {
    expect(controlConsistency(control({ probe: [] }), [KEYBOARD])).toBeUndefined();
    expect(controlConsistency(control({ probe: [] }), [])).toMatch(/no touch/);
    expect(controlConsistency(control({ situation: 'open', reached: true, frame: rect(20, 456, 362, 34), probe: [] }), [KEYBOARD])).toMatch(/no touch/);
  });

  it('only Android\'s keyboard is out of process; iOS\'s touches are the app\'s', () => {
    expect(outOfProcessKeyboard('android', KEYBOARD)).toEqual([KEYBOARD]);
    expect(outOfProcessKeyboard('android', KEYBOARD, [rect(71, 1092, 937, 792)])).toEqual([KEYBOARD, rect(71, 1092, 937, 792)]);
    expect(outOfProcessKeyboard('android', undefined, [rect(71, 1092, 937, 792)])).toEqual([]);
    expect(outOfProcessKeyboard('ios', KEYBOARD)).toEqual([]);
    expect(controlConsistency(control({ probe: [] }), outOfProcessKeyboard('ios', KEYBOARD))).toMatch(/no touch/);
  });

  it('a control never probed (off the screen, not laid out) holds no probe', () => {
    expect(controlConsistency(control({ situation: 'not-rendered', frame: undefined, probe: [] }), [])).toBeUndefined();
    expect(controlConsistency(control({ situation: 'off-screen', frame: rect(0, 900, 402, 52), probe: [] }), [])).toBeUndefined();
    expect(controlConsistency(control({ situation: 'off-screen', frame: rect(0, 900, 402, 52), reached: true, probe: [] }), [])).toMatch(/never probed/);
  });

  it('open but not reached, hidden but reached: broken; covered: either', () => {
    expect(controlConsistency(control({ situation: 'open', frame: rect(20, 456, 362, 34), probe: [ev('touch', '201,473')] }), [KEYBOARD])).toMatch(/open, but/);
    expect(controlConsistency(control({ reached: true }), [KEYBOARD])).toMatch(/under-keyboard, but the probe tap reached it/);
    const phone = { situation: 'covered' as const, frame: rect(20, 530, 362, 34), probe: [ev('touch', '201,547'), ev('submit', 'invalid')] };
    expect(controlConsistency(control({ ...phone }), [KEYBOARD])).toBeUndefined();
    expect(controlConsistency(control({ ...phone, reached: true }), [KEYBOARD])).toBeUndefined();
  });
});

// --- the one capture, behind a fake device ---

const GREEN = '#43A047';
const OPEN: CatalogCell = { id: 'open', layer: 'none', targets: [{ tag: 'A', color: GREEN, slot: 0, declared: 'open' }] };
const FORM_CELL: CatalogCell = { id: 'form-x', layer: 'none', targets: [], form: { title: 'T', fields: [], submit: { tag: 'submit', title: 'Go' } } };

/** A screen 40×40 at scale 1, target A at (10,10 20×20) painted green; a tap at its centre logs what `onTap` says. */
class FakeLab implements LabDevice {
  readonly platform = 'android';
  readonly app = 'native';
  taps: [number, number][] = [];
  private events: LabState['events'] = [];
  constructor(
    private readonly onTap: (x: number, y: number) => ProbeEvent[],
    private readonly device = 'fake emulator, Android 13 (API 33)',
  ) {}
  async describe() {
    return this.device;
  }
  unsupported(cell: CatalogCell) {
    return cell.form !== undefined ? 'a form cell' : undefined;
  }
  async launch(cell: string): Promise<LabState> {
    this.events = [];
    return (await this.state(cell))!;
  }
  async state(cell = 'open'): Promise<LabState | undefined> {
    return { cell, ready: true, screen: rect(0, 0, 40, 40), scale: 1, frames: { A: rect(10, 10, 20, 20) }, events: [...this.events] };
  }
  async tap(x: number, y: number) {
    this.taps.push([x, y]);
    this.events.push(...this.onTap(x, y).map((e) => ({ ...e, at: 0 })));
  }
  async screenshot() {
    const png = new PNG({ width: 40, height: 40 });
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) png.data.set(x >= 10 && x < 30 && y >= 10 && y < 30 ? [0x43, 0xa0, 0x47, 0xff] : [0xff, 0xff, 0xff, 0xff], (y * 40 + x) * 4);
    return PNG.sync.write(png);
  }
  async trees(): Promise<RawTree[]> {
    return [{ source: 'uiautomator', suffix: '.xml', payload: '<hierarchy/>' }];
  }
  async close() {}
}

let out: string;
beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'averi-truth-'));
});
afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

const run = (lab: LabDevice, cells: CatalogCell[]) => capture(lab, cells, { out, note: 'test', catalog: [OPEN, FORM_CELL], log: () => undefined });

describe('capture', () => {
  it('writes the tree, the screenshot, the state and the truth of each cell; probes each target at its centre', async () => {
    const lab = new FakeLab((x, y) => [ev('touch', `${x},${y}`), ev('tap', 'A')]);
    const { broken, skipped, manifest } = await run(lab, [OPEN, FORM_CELL]);
    expect(broken).toEqual([]);
    expect(skipped).toEqual(['form-x: a form cell']);
    expect(lab.taps).toEqual([[20, 20]]);
    const truth = JSON.parse(await readFile(join(out, 'open.truth.json'), 'utf8')) as CellTruth;
    expect(truth.targets).toEqual([
      { tag: 'A', id: 'lab.open.A', color: GREEN, declared: 'open', frame: rect(10, 10, 20, 20), reached: true, probe: [ev('touch', '20,20')], drawn: 1, seen: GREEN },
    ]);
    expect(await readFile(join(out, 'open.xml'), 'utf8')).toBe('<hierarchy/>');
    expect(manifest).toEqual({
      platform: 'android',
      app: 'AveriLab',
      device: 'fake emulator, Android 13 (API 33)',
      note: 'test',
      captures: [{ file: 'open.xml', source: 'uiautomator', form: 'raw', screen: { width: 40, height: 40 }, screenshot: 'open.png', truth: 'open.truth.json' }],
    });
  });

  it("the IME-down system bands are read before the probes: a probe that focuses a field leaves the IME up (rn-field's M)", async () => {
    // Its probe tap focuses a field: the IME comes up, and stays up through the relaunch-free end of the capture.
    class FocusingLab extends FakeLab {
      imeUp = false;
      override async tap(x: number, y: number) {
        await super.tap(x, y);
        this.imeUp = true;
      }
      async displays() {
        return `displays ime ${this.imeUp}`;
      }
    }
    const lab = new FocusingLab((x, y) => [ev('touch', `${x},${y}`), ev('tap', 'A')]);
    await run(lab, [OPEN]);
    expect(lab.taps).toEqual([[20, 20]]);
    expect(await readFile(join(out, 'open.displays.txt'), 'utf8')).toBe('displays ime false');
  });

  it('a probe tap that reached nothing of the app is a broken cell, not "not reached"', async () => {
    const { broken } = await run(new FakeLab(() => []), [OPEN]);
    expect(broken).toEqual([expect.stringMatching(/^open\/A: the probe tap left no touch/)]);
  });

  it('a run of some cells keeps the others — from the same device only', async () => {
    await writeFile(join(out, 'manifest.json'), JSON.stringify({ platform: 'android', app: 'AveriLab', device: 'fake emulator, Android 13 (API 33)', captures: [{ file: 'form-x.xml', source: 'uiautomator', form: 'raw' }] }));
    const { manifest } = await run(new FakeLab((x, y) => [ev('touch', `${x},${y}`), ev('tap', 'A')]), [OPEN]);
    expect(manifest.captures.map((c) => c.file)).toEqual(['open.xml', 'form-x.xml']);

    await expect(run(new FakeLab(() => [], 'another emulator, Android 14 (API 34)'), [OPEN])).rejects.toThrow(/holds captures of AveriLab on android "fake emulator, Android 13 \(API 33\)", not AveriLab on android "another emulator/);
  });
});

// --- the form path of the capture, behind a fake iOS lab ---

const FORM_KEYBOARD: CatalogCell = {
  id: 'form-k',
  layer: 'none',
  targets: [],
  form: {
    title: 'Transfer',
    fields: [
      { tag: 'name', kind: 'text', title: 'Name', error: { text: 'Required', id: 'lab.form-k.name_error' } },
      { tag: 'phone', kind: 'text', title: 'Phone' },
      { tag: 'vs', kind: 'text', title: 'Variable symbol', titleId: 'lab.form-k.vs.label' },
    ],
    submit: { tag: 'submit', title: 'Continue', pinned: true },
    screenError: { text: 'Fix the errors', id: 'lab.form-k.screen' },
    focus: 'name',
  },
};
const FORM_PICKER: CatalogCell = {
  id: 'form-p',
  layer: 'sheet-large',
  targets: [],
  form: {
    title: 'Bank',
    fields: [
      { tag: 'bank', kind: 'text', title: 'Bank name' },
      { tag: 'country', kind: 'country', title: 'Country' },
    ],
    submit: { tag: 'submit', title: 'Save' },
    picker: { field: 'country', title: 'Country', open: true, rows: [{ code: 'AL', name: 'Albania' }, { code: 'CZ', name: 'Czechia' }, { code: 'ST', name: 'São Tomé' }], probe: ['AL', 'CZ', 'ST'] },
  },
};
const empty = { value: '', focused: false, error: null };

/**
 * The two form cells as the iOS app would report them. form-k: `name` open and focused (an error under it), `phone`
 * under the pinned submit's bar, `vs` under the keyboard (0,573 402x301), a screen-level error; a dirty submit made.
 * form-p: the picker sheet from y 300 over `country` and the submit, row AL on the sheet, row CZ laid out below the
 * screen, row ST not laid out.
 */
function formState(cell: string): Omit<LabState, 'events'> {
  if (cell === 'form-k') {
    return {
      cell,
      ready: true,
      screen: SCREEN,
      scale: 3,
      frames: { name: rect(20, 160, 362, 34), 'name.error': rect(20, 200, 150, 16), phone: rect(20, 530, 362, 34), vs: rect(20, 604, 362, 34), submit: rect(20, 516.7, 362, 46.3), 'submit.bar': rect(0, 506.7, 402, 66.3), screenError: rect(20, 300, 362, 20) },
      fields: { name: { value: 'Ann', focused: true, error: { text: 'Required', id: 'lab.form-k.name_error' } }, phone: empty, vs: empty },
      focus: 'name',
      keyboard: { frame: rect(0, 573, 402, 301), visible: true, field: 'name' },
      submits: [{ at: 0, valid: false, values: {} }],
    };
  }
  return {
    cell,
    ready: true,
    screen: SCREEN,
    scale: 3,
    frames: { bank: rect(20, 160, 362, 34), country: rect(20, 330, 362, 34), submit: rect(20, 420, 362, 46), sheet: rect(0, 300, 402, 574), 'row.AL': rect(0, 400, 402, 52), 'row.CZ': rect(0, 900, 402, 52) },
    fields: { bank: empty, country: empty },
    focus: null,
    keyboard: null,
    submits: [],
  };
}

/** What a raw tap at a point does in the fake app: every tap logs its touch (the keyboard's too, as on iOS), then the control under it acts. */
const FORM_TAPS: Record<string, (s: { focus: string | null }) => ProbeEvent[]> = {
  'form-k 201,177': () => [], // the field focused on appear: the focus stays, no focus event — reached by the focus after
  'form-k 201,547': () => [ev('submit', 'invalid')], // the pinned bar over the phone field
  'form-k 201,621': () => [], // a key of the keyboard
  'form-k 201,540': () => [ev('submit', 'invalid')],
  'form-p 201,177': (s) => ((s.focus = 'bank'), [ev('focus', 'bank')]),
  'form-p 201,347': () => [], // the sheet over the country field
  'form-p 201,443': () => [],
  'form-p 201,426': () => [ev('select', 'AL')],
};

class FakeIosFormLab implements LabDevice {
  readonly platform: 'ios' | 'android' = 'ios';
  readonly app = 'native';
  taps: string[] = [];
  protected cell = '';
  protected focus: string | null = null;
  protected events: LabState['events'] = [];
  constructor(private readonly touches = true) {}
  async describe() {
    return 'averi-lab iPhone 17 simulator, iOS 27.0';
  }
  unsupported() {
    return undefined;
  }
  async launch(cell: string): Promise<LabState> {
    this.cell = cell;
    this.events = [];
    this.focus = formState(cell).focus ?? null;
    return (await this.state())!;
  }
  async state(): Promise<LabState | undefined> {
    const base = formState(this.cell);
    return { ...base, focus: this.focus, events: [...this.events] };
  }
  async tap(x: number, y: number) {
    const key = `${this.cell} ${x},${y}`;
    this.taps.push(key);
    const s = { focus: this.focus };
    const acted = FORM_TAPS[key]?.(s) ?? [];
    this.focus = s.focus;
    this.events.push(...[...(this.touches ? [ev('touch', `${x}.0,${y}.0`)] : []), ...acted].map((e) => ({ ...e, at: 0 })));
  }
  async screenshot() {
    return PNG.sync.write(new PNG({ width: 4, height: 4 }));
  }
  async trees(): Promise<RawTree[]> {
    return [
      { source: 'wda', suffix: '.wda.json', payload: '{}' },
      { source: 'idb', suffix: '.idb.json', payload: '[]' },
    ];
  }
  async close() {}
}

describe('capture of a form cell (iOS)', () => {
  const runForm = (lab: LabDevice, cells: CatalogCell[]) => capture(lab, cells, { out, note: 'test', catalog: [FORM_KEYBOARD, FORM_PICKER], log: () => undefined });
  const truthOf = async (cell: string) => JSON.parse(await readFile(join(out, `${cell}.truth.json`), 'utf8')) as CellTruth;

  it('the keyboard cell: the model\'s fields, each control where its frame lies and what its probe did, the keyboard, the screen error, the submits', async () => {
    const lab = new FakeIosFormLab();
    const { broken, manifest } = await runForm(lab, [FORM_KEYBOARD]);
    expect(broken).toEqual([]);
    expect(lab.taps).toEqual(['form-k 201,177', 'form-k 201,547', 'form-k 201,564', 'form-k 201,621', 'form-k 201,540']);
    const truth = await truthOf('form-k');
    expect(truth.targets).toEqual([]);
    expect(truth.form!.fields).toEqual([
      { tag: 'name', id: 'lab.form-k.name', kind: 'text', title: 'Name', titleId: 'lab.form-k.name.title', frame: rect(20, 160, 362, 34), value: 'Ann', focused: true, error: { text: 'Required', id: 'lab.form-k.name_error' }, errorFrame: rect(20, 200, 150, 16) },
      { tag: 'phone', id: 'lab.form-k.phone', kind: 'text', title: 'Phone', titleId: 'lab.form-k.phone.title', frame: rect(20, 530, 362, 34), ...empty },
      { tag: 'vs', id: 'lab.form-k.vs', kind: 'text', title: 'Variable symbol', titleId: 'lab.form-k.vs.label', frame: rect(20, 604, 362, 34), ...empty },
    ]);
    expect(truth.form!.controls).toEqual([
      { tag: 'name', id: 'lab.form-k.name', kind: 'field', frame: rect(20, 160, 362, 34), situation: 'open', reached: true, probe: [ev('touch', '201.0,177.0')] },
      { tag: 'phone', id: 'lab.form-k.phone', kind: 'field', frame: rect(20, 530, 362, 34), situation: 'covered', reached: false, probe: [ev('touch', '201.0,547.0'), ev('submit', 'invalid')], atPiece: { piece: { x: 20, y: 563, width: 362, height: 1 }, reached: false } },
      { tag: 'vs', id: 'lab.form-k.vs', kind: 'field', frame: rect(20, 604, 362, 34), situation: 'under-keyboard', reached: false, probe: [ev('touch', '201.0,621.0')], seen: '#000000' },
      { tag: 'submit', id: 'lab.form-k.submit', kind: 'button', frame: rect(20, 516.7, 362, 46.3), situation: 'open', reached: true, probe: [ev('touch', '201.0,540.0')] },
    ]);
    expect(truth.form!.keyboard).toEqual({ frame: rect(0, 573, 402, 301), field: 'name' });
    expect(truth.form!.screenError).toEqual({ text: 'Fix the errors', id: 'lab.form-k.screen', frame: rect(20, 300, 362, 20) });
    expect(truth.form!.submits).toEqual([{ valid: false }]);
    expect(truth.form!.sheet).toBeUndefined();
    expect(manifest.captures.map((c) => c.file)).toEqual(['form-k.wda.json', 'form-k.idb.json']);
  }, 15_000);

  it('the picker cell: what the sheet covers, its rows mapped from `row.<code>`, a row off the screen or not laid out never probed', async () => {
    const lab = new FakeIosFormLab();
    const { broken } = await runForm(lab, [FORM_PICKER]);
    expect(broken).toEqual([]);
    expect(lab.taps).toEqual(['form-p 201,177', 'form-p 201,347', 'form-p 201,443', 'form-p 201,426']);
    const truth = await truthOf('form-p');
    expect(truth.form!.controls).toEqual([
      { tag: 'bank', id: 'lab.form-p.bank', kind: 'field', frame: rect(20, 160, 362, 34), situation: 'open', reached: true, probe: [ev('touch', '201.0,177.0')] },
      { tag: 'country', id: 'lab.form-p.country', kind: 'field', frame: rect(20, 330, 362, 34), situation: 'presented-over', reached: false, probe: [ev('touch', '201.0,347.0')] },
      { tag: 'submit', id: 'lab.form-p.submit', kind: 'button', frame: rect(20, 420, 362, 46), situation: 'presented-over', reached: false, probe: [ev('touch', '201.0,443.0')] },
      { tag: 'country.AL', id: 'lab.form-p.country.AL', kind: 'row', frame: rect(0, 400, 402, 52), situation: 'open', reached: true, probe: [ev('touch', '201.0,426.0')] },
      { tag: 'country.CZ', id: 'lab.form-p.country.CZ', kind: 'row', frame: rect(0, 900, 402, 52), situation: 'off-screen', reached: false, probe: [] },
      { tag: 'country.ST', id: 'lab.form-p.country.ST', kind: 'row', situation: 'not-rendered', reached: false, probe: [] },
    ]);
    expect(truth.form!.keyboard).toBeNull();
    expect(truth.form!.screenError).toBeNull();
    expect(truth.form!.sheet).toEqual(rect(0, 300, 402, 574));
  }, 15_000);

  it('a control whose probe left no touch is broken — on iOS under the keyboard too, where its touches are logged', async () => {
    const { broken } = await runForm(new FakeIosFormLab(false), [FORM_KEYBOARD]);
    expect(broken).toEqual([
      expect.stringMatching(/^form-k\/name: the probe tap left no touch/),
      expect.stringMatching(/^form-k\/phone: the probe tap left no touch/),
      expect.stringMatching(/^form-k\/vs: the probe tap left no touch/),
      expect.stringMatching(/^form-k\/submit: the probe tap left no touch/),
    ]);
  }, 15_000);
});

/**
 * The keyboard cell on Android: the IME out of the app's process (a key's touch is never logged), its readings captured
 * (ime), and a tap after `back` (hideKeyboard) reaching the field under it, as the app's layout keeps its place.
 */
class FakeAndroidFormLab extends FakeIosFormLab {
  override readonly platform = 'android';
  hidden = false;
  imeReads = 0;
  override async launch(cell: string): Promise<LabState> {
    this.hidden = false;
    return super.launch(cell);
  }
  override async tap(x: number, y: number) {
    if (this.hidden && `${x},${y}` === '201,621') {
      this.taps.push(`form-k ${x},${y} after back`);
      await super.tap(x, y);
      this.focus = 'vs';
      this.events.push({ kind: 'focus', tag: 'vs', at: 0 });
      return;
    }
    if (!this.hidden && `${x},${y}` === '201,621') {
      this.taps.push(`form-k ${x},${y}`); // on the IME: no touch logged in the app
      return;
    }
    await super.tap(x, y);
  }
  async ime() {
    this.imeReads++;
    this.hidden = true;
    const r = (shown: boolean) => ({ inputShown: `mInputShown=${shown}`, touchable: `touchable ${shown}` });
    return { shown: { displays: 'displays true', ...r(true) }, hidden: r(false) };
  }
  async displays() {
    return `displays ${!this.hidden}`;
  }
  async hideKeyboard() {
    this.hidden = true;
  }
}

describe('capture of a form cell (Android)', () => {
  const runForm = (lab: LabDevice, cells: CatalogCell[]) => capture(lab, cells, { out, note: 'test', catalog: [FORM_KEYBOARD], log: () => undefined });

  it('the IME\'s readings beside the truth; under it: no touch needed, the colour shown over it, the tap after back', async () => {
    const lab = new FakeAndroidFormLab();
    const { broken } = await runForm(lab, [FORM_KEYBOARD]);
    expect(broken).toEqual([]);
    expect(lab.imeReads).toBe(1);
    const truth = JSON.parse(await readFile(join(out, 'form-k.truth.json'), 'utf8')) as CellTruth;
    expect(truth.ime).toBe('form-k.ime.json');
    // The screen after ime()'s back, beside the truth: each tree and the state.
    expect(truth.afterBack).toEqual({ state: 'form-k.after-back.state.json', trees: { wda: 'form-k.after-back.wda.json', idb: 'form-k.after-back.idb.json' } });
    expect(JSON.parse(await readFile(join(out, 'form-k.after-back.state.json'), 'utf8')).cell).toBe('form-k');
    expect(JSON.parse(await readFile(join(out, 'form-k.ime.json'), 'utf8')).hidden).toEqual({ inputShown: 'mInputShown=false', touchable: 'touchable false' });
    // The dump with the IME down is CellTruth.displays, read after ime()'s back — not a second copy in the ime file.
    expect(truth.displays).toBe('form-k.displays.txt');
    expect(await readFile(join(out, 'form-k.displays.txt'), 'utf8')).toBe('displays false');
    const vs = truth.form!.controls.find((c) => c.tag === 'vs')!;
    expect(vs).toMatchObject({ situation: 'under-keyboard', reached: false, probe: [], seen: '#000000', afterBack: { reached: true, probe: [ev('touch', '201.0,621.0')] } });
    expect(truth.form!.controls.filter((c) => c.afterBack !== undefined).map((c) => c.tag)).toEqual(['vs']);
  }, 15_000);

  // A floating IME (CatalogCell.ime): the panel read from the shown touchable region; the capture refuses a floating
  // cell without one and any other form cell with one.
  const floatingIme = (lab: FakeAndroidFormLab, band: string) => {
    const ime = lab.ime.bind(lab);
    lab.ime = async () => {
      const r = await ime();
      return { ...r, shown: { ...r.shown, touchable: `mInputShown=true\n    touchable region=SkRegion((20,300,380,500)${band})` } };
    };
  };
  it('a form cell captured with the IME floating is refused unless the cell is marked so', async () => {
    const lab = new FakeAndroidFormLab();
    floatingIme(lab, '');
    await expect(runForm(lab, [FORM_KEYBOARD])).rejects.toThrow(/the IME is floating \(a panel beyond its band: 20,300 360x200\) — dock it first/);
  }, 15_000);
  it('a cell marked ime: floating is refused docked (no panel beyond the band)', async () => {
    await expect(runForm(new FakeAndroidFormLab(), [{ ...FORM_KEYBOARD, ime: 'floating' }])).rejects.toThrow(/captured with the IME floating only, but its touchable region holds no panel/);
  }, 15_000);
  it('a cell marked ime: floating, floating: the panel in its truth', async () => {
    const lab = new FakeAndroidFormLab();
    floatingIme(lab, '');
    const { broken } = await runForm(lab, [{ ...FORM_KEYBOARD, ime: 'floating' }]);
    const truth = JSON.parse(await readFile(join(out, 'form-k.truth.json'), 'utf8')) as CellTruth;
    expect(truth.form!.keyboard!.panels).toEqual([rect(20, 300, 360, 200)]);
    expect(broken.every((b) => !/no panel/.test(b))).toBe(true);
  }, 15_000);

  it('a pinned submit whose state reports no bar is refused: every control under it would read open', async () => {
    const lab = new FakeAndroidFormLab();
    const state = lab.state.bind(lab);
    lab.state = async () => {
      const s = await state();
      if (s !== undefined) delete s.frames['submit.bar'];
      return s;
    };
    await expect(runForm(lab, [FORM_KEYBOARD])).rejects.toThrow(/no frame for submit\.bar/);
  }, 15_000);
});

describe('touchTargetOf: a Compose control\'s 48-dp touch target', () => {
  it('grows a frame shorter than 48 dp about its centre (averi_lab: a 99-px field dumped 132 px tall), keeps a larger one, and is the frame without a density', () => {
    expect(touchTargetOf(rect(55, 2024, 970, 99), 2.75)).toEqual(rect(55, 2008, 970, 132));
    expect(touchTargetOf(rect(55, 1238, 970, 160), 2.75)).toEqual(rect(55, 1238, 970, 160));
    expect(touchTargetOf(rect(55, 2024, 970, 99), undefined)).toEqual(rect(55, 2024, 970, 99));
  });
});

describe('pieceAfterBack: a control\'s piece in the layout after back', () => {
  // averi_lab's form-keyboard after one back: note at 2024 (99 px, 2.75 dp/px), Continue pinned at 1994..2126.
  const after = state({ screen: rect(0, 0, 1080, 2220), density: 2.75, frames: { submit: rect(55, 1994, 970, 132) }, keyboard: undefined });
  it('is its touch target clear of the pinned submit\'s own frame — as controlPiece clears it — null when nothing is clear', () => {
    expect(pieceAfterBack(rect(55, 2024, 970, 99), after, FORM, { tag: 'note' })).toEqual(rect(55, 2126, 970, 14));
    expect(pieceAfterBack(rect(55, 1994, 970, 132), after, FORM, { tag: 'note' })).toBeNull();
    expect(pieceAfterBack(rect(55, 2300, 970, 99), after, FORM, { tag: 'note' })).toBeNull();
  });
  it('clears no submit the form does not pin, nor the submit from itself', () => {
    expect(pieceAfterBack(rect(55, 2024, 970, 99), after, UNPINNED, { tag: 'note' })).toEqual(rect(55, 2008, 970, 132));
    expect(pieceAfterBack(rect(55, 1994, 970, 132), after, FORM, { tag: 'submit' })).toEqual(rect(55, 1994, 970, 132));
  });
});

describe('listedIn: whether a raw tree lists a node identified as the target', () => {
  it('the id between quotes, as WDA, idb and uiautomator write it — not a longer id that starts with it', () => {
    expect(listedIn('{"rawIdentifier": "lab.c.A", "rect": {}}', 'wda', 'lab.c.A')).toBe(true);
    expect(listedIn('[{"AXUniqueId":"lab.c.A"}]', 'idb', 'lab.c.A')).toBe(true);
    expect(listedIn('<node resource-id="lab.c.A" bounds="[0,0][1,1]"/>', 'uiautomator', 'lab.c.A')).toBe(true);
    expect(listedIn('<node resource-id="lab.c.A.box"/>', 'uiautomator', 'lab.c.A')).toBe(false);
    expect(listedIn('<node resource-id="lab.c.B"/>', 'uiautomator', 'lab.c.A')).toBe(false);
  });
  it("by the source's identifier field only: the id quoted in a label, a value or a text is not the node", () => {
    expect(listedIn('[{"AXUniqueId":null,"AXLabel":"lab.c.A"}]', 'idb', 'lab.c.A')).toBe(false);
    expect(listedIn('{"value":{"rawIdentifier":null,"label":"lab.c.A","value":"lab.c.A"}}', 'wda', 'lab.c.A')).toBe(false);
    expect(listedIn('{"value":{"children":[{"name":"lab.c.A"}]}}', 'wda', 'lab.c.A')).toBe(true);
    expect(listedIn('<hierarchy><node resource-id="" text="lab.c.A" content-desc="lab.c.A"/></hierarchy>', 'uiautomator', 'lab.c.A')).toBe(false);
  });
});
