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
  systemBarSwallows,
  unprobedBand,
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
/** A horizontal carousel's clip: 300 pt wide, ending inside the screen. */
const CAROUSEL = rect(0, 250, 300, 100);
/** A carousel's clip inset 100 pt from the left: what cuts a target at its left is the clip, not the screen. */
const INSET = rect(100, 250, 300, 100);
const ctx = (over: Partial<GeometryContext> = {}): GeometryContext => ({ screen: SCREEN, safeArea: SAFE, ...over });

describe('geometryOf — in averi\'s judging order (ADR 0005)', () => {
  it.each([
    ['whole: on the screen, in its clip, clear of bands and chrome', rect(51, 200, 300, 64), ctx({ clip: LIST, chrome: { tabBar: TAB } }), 'whole'],
    ['off-screen: below the screen', rect(51, 900, 300, 64), ctx(), 'off-screen'],
    ['off-screen: right of the screen, though its y is on it', rect(410, 200, 300, 64), ctx(), 'off-screen'],
    ['off-screen: a frame of no area, though it lies on the screen — nothing of it can be drawn, never probed', rect(51, 200, 0, 64), ctx(), 'off-screen'],
    ['off-screen before outside its scroll view', rect(51, 900, 300, 64), ctx({ clip: LIST }), 'off-screen'],
    ['outside-scroll-view: on the screen, below its clip', rect(51, 720, 300, 64), ctx({ clip: LIST }), 'outside-scroll-view'],
    ['outside-scroll-view: flush under the clip\'s bottom edge', rect(51, 700, 300, 64), ctx({ clip: LIST }), 'outside-scroll-view'],
    ['status-band: its centre in the top inset', rect(51, 10, 300, 64), ctx(), 'status-band'],
    ['nav-band: its centre in the bottom inset', rect(51, 820, 300, 64), ctx(), 'nav-band'],
    ['the rounded centre the probe taps: 0..123 has its centre at 61.5, tapped at 62 — below the 62-pt band', rect(51, 0, 300, 123), ctx(), 'band-overlap:status'],
    ['the rounded centre the probe taps: 0..121 has its centre at 60.5, tapped at 61 — in the band', rect(51, 0, 300, 121), ctx(), 'status-band'],
    ['the rounded centre the probe taps: 700..823 is tapped at 762, on a tab bar from 762', rect(51, 700, 300, 123), ctx({ safeArea: undefined, chrome: { tabBar: rect(0, 762, 402, 84) } }), 'under-chrome:tabBar'],
    ['the rounded centre the probe taps: a cut target\'s centre at 99.5 is tapped at 100, inside its clip from 100', rect(51, 60, 300, 79), ctx({ safeArea: undefined, clip: LIST }), 'partly-centre-in'],
    ['a band before a cut: centre in the status band, cut by the screen\'s top', rect(51, -20, 300, 64), ctx(), 'status-band'],
    ['no bands without a safe area: the same frame is cut, centre in', rect(51, -20, 300, 64), ctx({ safeArea: undefined }), 'partly-centre-in'],
    ['partly-centre-in: cut by its clip\'s top, centre showing', rect(51, 80, 300, 64), ctx({ clip: LIST }), 'partly-centre-in'],
    ['centre-out: cut by its clip\'s bottom, 30 of 64 showing', rect(51, 670, 300, 64), ctx({ clip: LIST }), 'centre-out'],
    ['sliver: 20 pt showing, under 6 % of 402 (24 pt)', rect(51, 680, 300, 64), ctx({ clip: LIST }), 'sliver'],
    ['not a sliver at exactly the minimum (24 pt showing)', rect(51, 676, 300, 64), ctx({ clip: LIST }), 'centre-out'],
    ['not a sliver: cut by the screen\'s right edge alone to 10 pt wide — its centre off it', rect(392, 200, 300, 64), ctx(), 'centre-out'],
    ['not a sliver: cut by the screen\'s left edge alone to 20 pt wide, its centre on it', rect(-10, 200, 30, 64), ctx(), 'partly-centre-in'],
    ['not a sliver: cut sideways by a carousel\'s clip, 100 pt across the cut though 20 pt tall', rect(200, 300, 302, 20), ctx({ clip: CAROUSEL }), 'centre-out'],
    ['not a sliver: cut sideways by the screen, 202 pt across the cut though 20 pt tall', rect(200, 300, 302, 20), ctx(), 'partly-centre-in'],
    ['sliver: a tall target cut across its width by a carousel\'s clip, 10 pt across the cut', rect(290, 260, 40, 80), ctx({ clip: CAROUSEL }), 'sliver'],
    ['sliver: a tall row cut at its clip\'s bottom, 20 pt across the cut', rect(51, 680, 300, 200), ctx({ clip: LIST }), 'sliver'],
    ['sliver: a 20-pt icon cut by 1 pt at its clip\'s top — what shows across the cut, 19 pt, is under the minimum', rect(51, 99, 20, 20), ctx({ clip: LIST }), 'sliver'],
    ['sliver: cut at its clip\'s top, 4 pt of 64 showing (100..104)', rect(51, 40, 300, 64), ctx({ clip: LIST }), 'sliver'],
    ['centre-out: cut at its clip\'s top, 30 pt of 64 showing (100..130), its centre at 98 above them', rect(51, 66, 300, 64), ctx({ clip: LIST }), 'centre-out'],
    ['sliver: cut at its clip\'s left edge, 20 pt across the cut (100..120)', rect(80, 260, 40, 80), ctx({ clip: INSET }), 'sliver'],
    ['not a sliver: cut at its clip\'s left edge, 30 pt across the cut (100..130), its centre at 100 showing', rect(70, 260, 60, 80), ctx({ clip: INSET }), 'partly-centre-in'],
    ['under-chrome: whole, its centre under the tab bar', rect(51, 780, 300, 64), ctx({ safeArea: undefined, chrome: { tabBar: TAB } }), 'under-chrome:tabBar'],
    ['under-chrome names the first chrome by name where two overlap', rect(51, 780, 300, 64), ctx({ safeArea: undefined, chrome: { toolbar: TAB, fab: TAB } }), 'under-chrome:fab'],
    ['a cut before a cover: cut by its clip, its centre under the tab bar too', rect(51, 670, 300, 64), ctx({ clip: LIST, chrome: { tabBar: rect(0, 690, 402, 84) } }), 'centre-out'],
    ['under-chrome: cut by its clip with its centre showing, under a FAB — the probe lands on the FAB', rect(51, 650, 300, 64), ctx({ clip: LIST, chrome: { fab: rect(150, 660, 120, 60) } }), 'under-chrome:fab'],
    ['partly-centre-in: the same cut target, the FAB clear of its centre', rect(51, 650, 300, 64), ctx({ clip: LIST, chrome: { fab: rect(300, 660, 60, 60) } }), 'partly-centre-in'],
    ['a sliver before a cover: cut to 20 pt by its clip, its centre under a FAB', rect(51, 680, 300, 64), ctx({ clip: LIST, chrome: { fab: rect(150, 660, 120, 60) } }), 'sliver'],
    // A whole target, its centre clear, whose edge a band or the chrome overlaps past ADR 0002's 2-unit slack.
    ['whole: a tab bar from 798 overlaps 51,600 300x200 by 2 — within the slack', rect(51, 600, 300, 200), ctx({ chrome: { tabBar: rect(0, 798, 402, 76) } }), 'whole'],
    ['chrome-overlap: a tab bar from 797 overlaps it by 3 — past the slack', rect(51, 600, 300, 200), ctx({ chrome: { tabBar: rect(0, 797, 402, 77) } }), 'chrome-overlap:tabBar'],
    ['chrome-overlap: the reviewer\'s 51,600 300x200 over a tab bar from 790', rect(51, 600, 300, 200), ctx({ chrome: { tabBar: TAB } }), 'chrome-overlap:tabBar'],
    ['whole: 2 pt into the navigation band (840)', rect(51, 640, 300, 202), ctx(), 'whole'],
    ['band-overlap:nav: 3 pt into the navigation band', rect(51, 640, 300, 203), ctx(), 'band-overlap:nav'],
    ['band-overlap:status: 3 pt into the status band, its centre clear', rect(51, 59, 300, 64), ctx(), 'band-overlap:status'],
    ['chrome-overlap names the first chrome by name where two overlap it', rect(51, 600, 300, 200), ctx({ safeArea: undefined, chrome: { tabBar: TAB, fab: rect(300, 600, 60, 60) } }), 'chrome-overlap:fab'],
    ['the status band before the navigation band before the chrome', rect(51, 59, 300, 784), ctx({ chrome: { a: rect(0, 300, 402, 10) } }), 'band-overlap:status'],
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
    // Any one of the three is enough: a state reporting only its chrome, or only its scroll views, is measured.
    expect(measuredGeometry(rect(51, 760, 300, 64), { ...s, chrome: { tabBar: TAB } }, undefined)).toEqual({ geometry: 'under-chrome:tabBar', visible: rect(51, 760, 300, 64), piece: rect(51, 760, 300, 30) });
    expect(measuredGeometry(rect(51, 720, 300, 64), { ...s, scrollViews: { list: LIST } }, 'list')).toEqual({ geometry: 'outside-scroll-view', visible: null, piece: null });
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
  it('a centre the screen\'s edge leaves off it: never probed (the capture taps only its piece), given the screen', () => {
    const cut = T({ frame: rect(51, 850, 300, 64), geometry: 'centre-out', reached: false, probe: [], reachedAtPiece: true });
    expect(consistency(cut, 'ios', { width: 402, height: 874 })).toBeUndefined();
    expect(consistency(cut, 'ios')).toMatch(/left no touch/);
    expect(consistency({ ...cut, probe: [ev('touch', '201,882')] }, 'ios', { width: 402, height: 874 })).toBe('its centre (201,882) off the screen, never probed, but the truth holds a probe');
    // Its rounded centre on the screen's last row is on it: probed as ever.
    expect(consistency(T({ frame: rect(51, 810, 300, 127), geometry: 'partly-centre-in', reached: true, probe: [ev('touch', '201,874')] }), 'ios', { width: 402, height: 875 })).toBeUndefined();
  });
  it('unmeasured, a declared-open target whose centre lies off the screen is broken (the phase-1 rule); presented-over is not', () => {
    const off = T({ frame: rect(51, 850, 300, 64), reached: false, probe: [], drawn: 0.4 });
    expect(consistency(off, 'ios', { width: 402, height: 874 })).toBe('declared open, but its centre (201,882) lies off the screen: never probed');
    expect(consistency({ ...off, declared: 'presented-over' }, 'ios', { width: 402, height: 874 })).toBeUndefined();
    // Measured, the same frame's geometry says what holds: its centre cut off by the screen's edge, never probed.
    expect(consistency({ ...off, geometry: 'centre-out' }, 'ios', { width: 402, height: 874 })).toBeUndefined();
  });
  it('the status bar on Android swallows the probe (no touch, not reached); on iOS the touch is the app\'s, reached or not', () => {
    const band = T({ frame: rect(51, 10, 300, 64), geometry: 'status-band', reached: false, probe: [] });
    expect(consistency(band, 'android')).toBeUndefined();
    expect(consistency({ ...band, reached: true }, 'android')).toMatch(/through the system bar/);
    expect(consistency(band, 'ios')).toMatch(/left no touch/);
    expect(consistency({ ...band, probe: [ev('touch', '201,42')] }, 'ios')).toBeUndefined();
    expect(consistency({ ...band, reached: true, probe: [ev('touch', '201,42')] }, 'ios')).toBeUndefined();
  });
  it('the navigation band on Android is unmeasured (gesture or three buttons): never probed; on iOS probed as the status band', () => {
    const nav = T({ frame: rect(51, 820, 300, 64), geometry: 'nav-band', reached: false, probe: [] });
    expect(consistency(nav, 'android')).toBeUndefined();
    expect(consistency({ ...nav, probe: [ev('touch', '201,852')] }, 'android')).toBe('nav-band on Android, never probed (unmeasured: unprobedBand), but the truth holds a probe');
    expect(consistency(nav, 'ios')).toMatch(/left no touch/);
    // What is measured swallows; what is not is unprobed — the two never both claim a band.
    expect([systemBarSwallows('android', 'status-band'), systemBarSwallows('android', 'nav-band'), systemBarSwallows('ios', 'status-band')]).toEqual([true, false, false]);
    expect([unprobedBand('android', 'nav-band'), unprobedBand('android', 'status-band'), unprobedBand('ios', 'nav-band')]).toEqual([true, false, false]);
  });
  it('cut with its centre showing must be reached; with its centre out, or outside its clip, must not; a sliver either', () => {
    expect(consistency(T({ geometry: 'partly-centre-in', drawn: 0.6 }))).toBeUndefined();
    expect(consistency(T({ geometry: 'partly-centre-in', reached: false }))).toMatch(/did not reach it/);
    expect(consistency(T({ geometry: 'centre-out', reached: false, drawn: 0.4 }))).toBeUndefined();
    expect(consistency(T({ geometry: 'centre-out', drawn: 0.4 }))).toMatch(/centre-out, but/);
    expect(consistency(T({ geometry: 'outside-scroll-view', drawn: 0 }))).toMatch(/outside-scroll-view, but/);
    expect(consistency(T({ geometry: 'sliver', reached: false, drawn: 0.2 }))).toBeUndefined();
    expect(consistency(T({ geometry: 'sliver', drawn: 0.2 }))).toBeUndefined();
    // Cut with its centre showing under chrome: the probe lands on the chrome — not held to reached.
    expect(consistency(T({ geometry: 'under-chrome:fab', reached: false, drawn: 0.6 }))).toBeUndefined();
    // Overlapped at its edge, its centre clear: reached, whatever of it is drawn.
    expect(consistency(T({ geometry: 'chrome-overlap:tabBar', drawn: 0.9 }))).toBeUndefined();
    expect(consistency(T({ geometry: 'band-overlap:nav', reached: false }))).toBe('band-overlap:nav, its centre clear, but the probe tap did not reach it');
  });
});

// --- the capture, measuring the geometry when the state reports it ---

const GREEN = '#43A047';
/**
 * A 40×40 screen at scale 1: A at 10,10 20×20; B half off the bottom (30..50); C below it (50..70); a 4-unit status
 * band.
 */
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
    // A raw tap off the screen reaches no window of the app: nothing logged.
    if (x < 0 || x >= 40 || y < 0 || y >= 40) return;
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
    // A at its centre; B never at its centre ((20,40): off the 40-unit screen, where a raw tap reaches no window of the
    // app), only at its piece's (30..34: clear of the bar, centred at 32); C never.
    expect(lab.taps).toEqual([
      [20, 20],
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
    expect(t.targets.map((x) => x.unprobed)).toEqual([undefined, 'its centre (20,40) lies off the 40x40 screen', 'its centre (20,60) lies off the 40x40 screen']);
    expect(t.targets[1].probe).toEqual([]);
  });

  it('on Android never taps a centre in the navigation band (unmeasured), only its piece above the band', async () => {
    const lab = new GeometryLab({ safeArea: { top: 4, left: 0, bottom: 21, right: 0 } });
    const cell = { ...CELL, targets: CELL.targets.slice(0, 1), config: undefined };
    const { broken } = await capture(lab, [cell], { out, note: 't', catalog: [cell], log: () => undefined });
    expect(broken).toEqual([]);
    expect(lab.taps).toEqual([[20, 15]]);
    const [a] = (await truthOf()).targets;
    expect([a.geometry, a.reached, a.probe, a.piece, a.reachedAtPiece]).toEqual(['nav-band', false, [], rect(10, 10, 20, 9), true]);
    expect(a.unprobed).toMatch(/^its centre lies in the navigation band: .* unmeasured$/);
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

  it('a state reporting none of it: an open target with its centre off the screen is never tapped there, and broken', async () => {
    const lab = new GeometryLab({});
    const cell = { ...CELL, targets: CELL.targets.slice(1, 2), config: undefined };
    const { broken } = await capture(lab, [cell], { out, note: 't', catalog: [cell], log: () => undefined });
    expect(lab.taps).toEqual([]);
    expect(broken).toEqual(['edges/B: declared open, but its centre (20,40) lies off the screen: never probed']);
    const [b] = (await truthOf()).targets;
    expect([b.geometry, b.reached, b.probe, b.unprobed]).toEqual([undefined, false, [], 'its centre (20,40) lies off the 40x40 screen']);
  });
});
