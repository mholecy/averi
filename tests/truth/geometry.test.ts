import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capture } from '../../scripts/truth/capture-run.js';
import type { LabDevice, RawTree } from '../../scripts/truth/lab-device.js';
import type { CatalogCell, CellTruth, Geometry, Insets, LabState, ProbeEvent, Rect, TargetTruth } from '../../scripts/truth/schema.js';
import {
  bandsOf,
  consistency,
  geometryOf,
  measuredGeometry,
  minPiece,
  otherControlsFired,
  pieceOf,
  pieceProbePoint,
  subtract,
  visibleOf,
  type GeometryContext,
} from '../../scripts/truth/truth.js';

// Phase 3's measured geometry (scripts/truth/truth.ts#geometryOf): where a target's frame lies against the screen, its
// scroll view's clip, the system bands and the app's chrome — and the capture that measures it only when the app's
// state reports those (a phase-1/1b/2 state does not, and captures as before).

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const ev = (kind: ProbeEvent['kind'], tag: string): ProbeEvent => ({ kind, tag });
/** The iPhone 17 in points: the status band 62 pt, the home indicator 34 pt. */
const SCREEN = rect(0, 0, 402, 874);
const SAFE: Insets = { top: 62, left: 0, bottom: 34, right: 0 };
const LIST = rect(0, 100, 402, 600);
const TAB = rect(0, 790, 402, 84);
const ctx = (over: Partial<GeometryContext> = {}): GeometryContext => ({ screen: SCREEN, safeArea: SAFE, ...over });

describe('geometryOf — in averi\'s judging order (ADR 0005)', () => {
  it.each([
    ['whole: on the screen, in its clip, clear of bands and chrome', rect(51, 200, 300, 64), ctx({ clip: LIST, chrome: { tabBar: TAB } }), 'whole'],
    ['off-screen: below the screen', rect(51, 900, 300, 64), ctx(), 'off-screen'],
    ['off-screen: right of the screen, though its y is on it', rect(410, 200, 300, 64), ctx(), 'off-screen'],
    ['off-screen before outside its scroll view', rect(51, 900, 300, 64), ctx({ clip: LIST }), 'off-screen'],
    ['outside-scroll-view: on the screen, below its clip', rect(51, 720, 300, 64), ctx({ clip: LIST }), 'outside-scroll-view'],
    ['outside-scroll-view: flush under the clip\'s bottom edge', rect(51, 700, 300, 64), ctx({ clip: LIST }), 'outside-scroll-view'],
    ['status-band: its centre in the top inset', rect(51, 10, 300, 64), ctx(), 'status-band'],
    ['nav-band: its centre in the bottom inset', rect(51, 820, 300, 64), ctx(), 'nav-band'],
    ['a band before a cut: centre in the status band, cut by the screen\'s top', rect(51, -20, 300, 64), ctx(), 'status-band'],
    ['no bands without a safe area: the same frame is cut, centre in', rect(51, -20, 300, 64), ctx({ safeArea: undefined }), 'partly-centre-in'],
    ['partly-centre-in: cut by its clip\'s top, centre showing', rect(51, 80, 300, 64), ctx({ clip: LIST }), 'partly-centre-in'],
    ['centre-out: cut by its clip\'s bottom, 30 of 64 showing', rect(51, 670, 300, 64), ctx({ clip: LIST }), 'centre-out'],
    ['sliver: 20 pt showing, under 6 % of 402 (24 pt)', rect(51, 680, 300, 64), ctx({ clip: LIST }), 'sliver'],
    ['not a sliver at exactly the minimum (24 pt showing)', rect(51, 676, 300, 64), ctx({ clip: LIST }), 'centre-out'],
    ['sliver: cut by the screen\'s right edge to 10 pt wide', rect(392, 200, 300, 64), ctx(), 'sliver'],
    ['under-chrome: whole, its centre under the tab bar', rect(51, 780, 300, 64), ctx({ safeArea: undefined, chrome: { tabBar: TAB } }), 'under-chrome:tabBar'],
    ['under-chrome names the first chrome by name where two overlap', rect(51, 780, 300, 64), ctx({ safeArea: undefined, chrome: { toolbar: TAB, fab: TAB } }), 'under-chrome:fab'],
    ['a cut before a cover: cut by its clip, its centre under the tab bar too', rect(51, 670, 300, 64), ctx({ clip: LIST, chrome: { tabBar: rect(0, 690, 402, 84) } }), 'centre-out'],
  ] as const)('%s', (_name, frame, c, expected: Geometry) => {
    expect(geometryOf(frame, c)).toBe(expected);
  });
});

describe('what shows of it, and where a tap can land', () => {
  it('the bands from the safe area: none for a zero inset or no safe area', () => {
    expect(bandsOf(SCREEN, SAFE)).toEqual({ status: rect(0, 0, 402, 62), nav: rect(0, 840, 402, 34) });
    expect(bandsOf(SCREEN, { top: 66, left: 0, bottom: 0, right: 0 })).toEqual({ status: rect(0, 0, 402, 66) });
    expect(bandsOf(SCREEN, undefined)).toEqual({});
  });

  it('the tap minimum is 6 % of the shorter side, rounded (ADR 0013): 24 pt on the iPhone 17, 65 px on a 1080-px phone', () => {
    expect(minPiece(SCREEN)).toBe(24);
    expect(minPiece(rect(0, 0, 1080, 2220))).toBe(65);
  });

  it('visible: the frame clipped by the screen and its clip; null when none of it', () => {
    expect(visibleOf(rect(51, 670, 300, 64), ctx({ clip: LIST }))).toEqual(rect(51, 670, 300, 30));
    expect(visibleOf(rect(51, 850, 300, 64), ctx())).toEqual(rect(51, 850, 300, 24));
    expect(visibleOf(rect(51, 720, 300, 64), ctx({ clip: LIST }))).toBeNull();
  });

  it('subtract: what of a rect lies outside a cut — above, below, left, right', () => {
    expect(subtract(rect(0, 0, 10, 10), rect(20, 20, 5, 5))).toEqual([rect(0, 0, 10, 10)]);
    expect(subtract(rect(0, 0, 10, 10), rect(0, 6, 10, 10))).toEqual([rect(0, 0, 10, 6)]);
    expect(subtract(rect(0, 0, 10, 10), rect(4, 4, 2, 2))).toEqual([rect(0, 0, 10, 4), rect(0, 6, 10, 4), rect(0, 4, 4, 2), rect(6, 4, 4, 2)]);
  });

  it('piece: the largest part of what shows clear of the bands and the chrome', () => {
    expect(pieceOf(rect(51, 760, 300, 64), ctx({ chrome: { tabBar: TAB } }))).toEqual(rect(51, 760, 300, 30));
    expect(pieceOf(rect(51, 30, 300, 64), ctx())).toEqual(rect(51, 62, 300, 32));
    expect(pieceOf(rect(51, 800, 300, 64), ctx({ chrome: { tabBar: rect(0, 790, 402, 84) } }))).toBeNull();
    expect(pieceOf(rect(51, 200, 300, 64), ctx({ chrome: { tabBar: TAB } }))).toEqual(rect(51, 200, 300, 64));
  });

  it('the second probe: at the piece\'s centre when it is more than 2 units from the frame\'s', () => {
    expect(pieceProbePoint(rect(51, 760, 300, 64), rect(51, 760, 300, 30))).toEqual({ x: 201, y: 775 });
    expect(pieceProbePoint(rect(51, 200, 300, 64), rect(51, 200, 300, 63))).toBeUndefined();
    expect(pieceProbePoint(rect(51, 200, 300, 64), null)).toBeUndefined();
  });

  it('a state that reports no bands, scroll views or chrome measures nothing — every capture before phase 3', () => {
    const s: LabState = { cell: 'open', ready: true, screen: SCREEN, scale: 3, frames: {}, events: [] };
    expect(measuredGeometry(rect(51, 900, 300, 64), s, undefined)).toEqual({});
    expect(measuredGeometry(rect(51, 900, 300, 64), { ...s, safeArea: SAFE }, undefined)).toEqual({ geometry: 'off-screen', visible: null, piece: null });
    expect(() => measuredGeometry(rect(51, 200, 300, 64), { ...s, scrollViews: {} }, 'list')).toThrow('no scroll view list');
  });

  it('a tab bar\'s item firing is another control fired, as a submit is', () => {
    expect(otherControlsFired([ev('touch', '1,1'), ev('tab', 'home'), ev('focus', '')], 'A')).toEqual([ev('tab', 'home')]);
  });
});

describe('consistency with a measured geometry', () => {
  const T = (over: Partial<TargetTruth>): TargetTruth => ({
    tag: 'A',
    id: 'lab.c.A',
    color: '#43A047',
    declared: 'open',
    frame: rect(51, 200, 300, 64),
    reached: true,
    probe: [ev('touch', '201,232')],
    drawn: 1,
    seen: '#43A047',
    ...over,
  });
  it('whole or absent: the phase-1 rule — delivered, reached and drawn', () => {
    expect(consistency(T({}))).toBeUndefined();
    expect(consistency(T({ geometry: 'whole' }))).toBeUndefined();
    expect(consistency(T({ geometry: 'whole', drawn: 0.5 }))).toBe('declared open, but reached true, drawn 50%');
    expect(consistency(T({ probe: [] }), 'ios')).toMatch(/left no touch/);
  });
  it('off-screen: never probed', () => {
    expect(consistency(T({ geometry: 'off-screen', reached: false, probe: [] }))).toBeUndefined();
    expect(consistency(T({ geometry: 'off-screen', reached: false, probe: [ev('touch', '201,900')] }))).toMatch(/never probed/);
  });
  it('a system band on Android swallows the probe (no touch, not reached); on iOS the touch is the app\'s', () => {
    const band = T({ frame: rect(51, 10, 300, 64), geometry: 'status-band', reached: false, probe: [] });
    expect(consistency(band, 'android')).toBeUndefined();
    expect(consistency({ ...band, reached: true }, 'android')).toMatch(/through the system bar/);
    expect(consistency(band, 'ios')).toMatch(/left no touch/);
    expect(consistency({ ...band, probe: [ev('touch', '201,42')] }, 'ios')).toBeUndefined();
  });
  it('cut with its centre showing must be reached; with its centre out, or outside its clip, must not; a sliver either', () => {
    expect(consistency(T({ geometry: 'partly-centre-in', drawn: 0.6 }))).toBeUndefined();
    expect(consistency(T({ geometry: 'partly-centre-in', reached: false }))).toMatch(/did not reach it/);
    expect(consistency(T({ geometry: 'centre-out', reached: false, drawn: 0.4 }))).toBeUndefined();
    expect(consistency(T({ geometry: 'centre-out', drawn: 0.4 }))).toMatch(/centre-out, but/);
    expect(consistency(T({ geometry: 'outside-scroll-view', drawn: 0 }))).toMatch(/outside-scroll-view, but/);
    expect(consistency(T({ geometry: 'sliver', reached: false, drawn: 0.2 }))).toBeUndefined();
    expect(consistency(T({ geometry: 'sliver', drawn: 0.2 }))).toBeUndefined();
  });
});

// --- the capture, measuring the geometry when the state reports it ---

const GREEN = '#43A047';
/** A 40×40 screen at scale 1: A at 10,10 20×20; B half off the bottom (30..50); C below it (50..70); a 4-unit status band. */
class GeometryLab implements LabDevice {
  readonly platform = 'android';
  taps: [number, number][] = [];
  private events: LabState['events'] = [];
  constructor(private readonly extra: Partial<LabState>) {}
  async describe() {
    return 'fake emulator';
  }
  unsupported() {
    return undefined;
  }
  async launch(cell: string): Promise<LabState> {
    this.events = [];
    return (await this.state(cell))!;
  }
  async state(cell = 'edges'): Promise<LabState | undefined> {
    const frames = { A: rect(10, 10, 20, 20), B: rect(10, 30, 20, 20), C: rect(10, 50, 20, 20) };
    return { cell, ready: true, screen: rect(0, 0, 40, 40), scale: 1, frames, events: [...this.events], ...this.extra };
  }
  async tap(x: number, y: number) {
    this.taps.push([x, y]);
    this.events.push({ kind: 'touch', tag: `${x},${y}`, at: 0 }, ...(x >= 10 && x < 30 && y >= 10 && y < 40 ? [{ kind: 'tap' as const, tag: y < 30 ? 'A' : 'B', at: 0 }] : []));
  }
  async screenshot() {
    const png = new PNG({ width: 40, height: 40 });
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) png.data.set(x >= 10 && x < 30 && y >= 10 ? [0x43, 0xa0, 0x47, 0xff] : [0xff, 0xff, 0xff, 0xff], (y * 40 + x) * 4);
    return PNG.sync.write(png);
  }
  async trees(): Promise<RawTree[]> {
    return [{ source: 'uiautomator', suffix: '.xml', payload: '<hierarchy/>' }];
  }
  async close() {}
}

describe('capture with a measured geometry', () => {
  let out: string;
  beforeEach(async () => {
    out = await mkdtemp(join(tmpdir(), 'averi-geometry-'));
  });
  afterEach(async () => {
    await rm(out, { recursive: true, force: true });
  });
  const CELL: CatalogCell = {
    id: 'edges',
    layer: 'none',
    targets: ['A', 'B', 'C'].map((tag, slot) => ({ tag, color: GREEN, slot, declared: 'open' as const })),
    config: { ios: { keyboardDismiss: ['accessory'] } },
  };
  const truthOf = async () => JSON.parse(await readFile(join(out, 'edges.truth.json'), 'utf8')) as CellTruth;

  it('measures each target, probes an off-screen one never, and a cut one again at its piece', async () => {
    const lab = new GeometryLab({ safeArea: { top: 4, left: 0, bottom: 0, right: 0 }, chrome: { bar: rect(0, 34, 40, 6) } });
    const { broken } = await capture(lab, [CELL], { out, note: 't', catalog: [CELL], log: () => undefined });
    expect(broken).toEqual([]);
    // A at its centre; B at its centre (40: off the 40-unit screen's last row — the fake still logs it) and its piece's
    // (30..34: clear of the bar, centred at 32); C never.
    expect(lab.taps).toEqual([
      [20, 20],
      [20, 40],
      [20, 32],
    ]);
    const t = await truthOf();
    expect(t.safeArea).toEqual({ top: 4, left: 0, bottom: 0, right: 0 });
    expect(t.chrome).toEqual({ bar: rect(0, 34, 40, 6) });
    expect(t.config).toEqual({ ios: { keyboardDismiss: ['accessory'] } });
    expect(t.targets.map((x) => [x.tag, x.geometry, x.visible, x.piece, x.reached, x.reachedAtPiece])).toEqual([
      ['A', 'whole', rect(10, 10, 20, 20), rect(10, 10, 20, 20), true, undefined],
      ['B', 'centre-out', rect(10, 30, 20, 10), rect(10, 30, 20, 4), false, true],
      ['C', 'off-screen', null, null, false, undefined],
    ]);
    expect(t.targets[2].probe).toEqual([]);
  });

  it('a state reporting none of it captures as before: no geometry, no second probe', async () => {
    const lab = new GeometryLab({});
    const cell = { ...CELL, targets: CELL.targets.slice(0, 1), config: undefined };
    await capture(lab, [cell], { out, note: 't', catalog: [cell], log: () => undefined });
    expect(lab.taps).toEqual([[20, 20]]);
    const t = await truthOf();
    expect(Object.keys(t)).toEqual(['cell', 'layer', 'device', 'screen', 'scale', 'targets']);
    expect(Object.keys(t.targets[0])).toEqual(['tag', 'id', 'color', 'declared', 'frame', 'reached', 'probe', 'drawn', 'seen']);
  });
});
