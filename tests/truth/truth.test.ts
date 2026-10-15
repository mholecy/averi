import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capture } from '../../scripts/truth/capture-run.js';
import type { LabDevice, RawTree } from '../../scripts/truth/lab-device.js';
import type { CatalogCell, CatalogForm, CellTruth, ControlTruth, LabState, ProbeEvent, Rect, TargetTruth } from '../../scripts/truth/schema.js';
import {
  consistency,
  controlConsistency,
  otherControlsFired,
  probePoint,
  readControlProbe,
  readTargetProbe,
  situationOf,
  touchesAt,
} from '../../scripts/truth/truth.js';

// The truth's arithmetic (scripts/truth/truth.ts) and the one capture (capture-run.ts) behind a fake LabDevice: where a
// form control lies from the app's frames, what a probe's events say, when a cell is broken — no device.

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const SCREEN = rect(0, 0, 402, 874);

/** form-keyboard as captured on the iPhone 17: the keyboard's top at 573, the submit pinned at 516.7..563 above it. */
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
  frames: { submit: rect(20, 516.7, 362, 46.3) },
  events: [],
  keyboard: { frame: rect(0, 573, 402, 301), visible: true, field: 'postcode' },
  ...over,
});
const UNPINNED: CatalogForm = { ...FORM, submit: { tag: 'submit', title: 'Continue' } };
const field = { tag: 'phone', inSheet: false };

describe('situationOf', () => {
  it.each([
    ['open: centre on the screen, clear of the keyboard and the bar', rect(20, 456, 362, 34), state(), 'open'],
    ['under-keyboard: all of it at or below the keyboard top', rect(20, 604, 362, 34), state(), 'under-keyboard'],
    ['under-keyboard from the keyboard top exactly', rect(20, 573, 362, 34), state(), 'under-keyboard'],
    ['covered: straddling the keyboard top', rect(20, 560, 362, 34), state(), 'covered'],
    ['covered: centre in the pinned bar band (the phone field under Continue)', rect(20, 530, 362, 34), state(), 'covered'],
    ['covered: centre just inside the 10 pt inset padding above the submit', rect(20, 489.8, 362, 34), state(), 'covered'],
    ['open: centre just past the padding', rect(20, 488.6, 362, 34), state(), 'open'],
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
  it('a probe tap with no touch is broken — but where the keyboard lies (its window is not the app\'s)', () => {
    expect(controlConsistency(control({ probe: [] }), KEYBOARD)).toBeUndefined();
    expect(controlConsistency(control({ probe: [] }), undefined)).toMatch(/no touch/);
    expect(controlConsistency(control({ situation: 'open', reached: true, frame: rect(20, 456, 362, 34), probe: [] }), KEYBOARD)).toMatch(/no touch/);
  });

  it('a control never probed (off the screen, not laid out) holds no probe', () => {
    expect(controlConsistency(control({ situation: 'not-rendered', frame: undefined, probe: [] }), undefined)).toBeUndefined();
    expect(controlConsistency(control({ situation: 'off-screen', frame: rect(0, 900, 402, 52), probe: [] }), undefined)).toBeUndefined();
    expect(controlConsistency(control({ situation: 'off-screen', frame: rect(0, 900, 402, 52), reached: true, probe: [] }), undefined)).toMatch(/never probed/);
  });

  it('open but not reached, hidden but reached: broken; covered: either', () => {
    expect(controlConsistency(control({ situation: 'open', frame: rect(20, 456, 362, 34), probe: [ev('touch', '201,473')] }), KEYBOARD)).toMatch(/open, but/);
    expect(controlConsistency(control({ reached: true }), KEYBOARD)).toMatch(/under-keyboard, but the probe tap reached it/);
    const phone = { situation: 'covered' as const, frame: rect(20, 530, 362, 34), probe: [ev('touch', '201,547'), ev('submit', 'invalid')] };
    expect(controlConsistency(control({ ...phone }), KEYBOARD)).toBeUndefined();
    expect(controlConsistency(control({ ...phone, reached: true }), KEYBOARD)).toBeUndefined();
  });
});

// --- the one capture, behind a fake device ---

const GREEN = '#43A047';
const OPEN: CatalogCell = { id: 'open', layer: 'none', targets: [{ tag: 'A', color: GREEN, slot: 0, declared: 'open' }] };
const FORM_CELL: CatalogCell = { id: 'form-x', layer: 'none', targets: [], form: { title: 'T', fields: [], submit: { tag: 'submit', title: 'Go' } } };

/** A screen 40×40 at scale 1, target A at (10,10 20×20) painted green; a tap at its centre logs what `onTap` says. */
class FakeLab implements LabDevice {
  readonly platform = 'android';
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

  it('a probe tap that reached nothing of the app is a broken cell, not "not reached"', async () => {
    const { broken } = await run(new FakeLab(() => []), [OPEN]);
    expect(broken).toEqual([expect.stringMatching(/^open\/A: the probe tap left no touch/)]);
  });

  it('a run of some cells keeps the others — from the same device only', async () => {
    await writeFile(join(out, 'manifest.json'), JSON.stringify({ platform: 'android', device: 'fake emulator, Android 13 (API 33)', captures: [{ file: 'form-x.xml', source: 'uiautomator', form: 'raw' }] }));
    const { manifest } = await run(new FakeLab((x, y) => [ev('touch', `${x},${y}`), ev('tap', 'A')]), [OPEN]);
    expect(manifest.captures.map((c) => c.file)).toEqual(['open.xml', 'form-x.xml']);

    await expect(run(new FakeLab(() => [], 'another emulator, Android 14 (API 34)'), [OPEN])).rejects.toThrow(/holds captures of android "fake emulator, Android 13 \(API 33\)", not android "another emulator/);
  });
});
