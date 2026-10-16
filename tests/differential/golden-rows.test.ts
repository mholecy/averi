import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { configFor, type Outcome } from '../../scripts/differential/differential.js';
import { directionRow, dismissRow, expectations, landed, strokeable, strokesOff, type Expectation } from '../../scripts/differential/golden-spec.js';
import type { CellTruth, Geometry, Rect, TargetTruth } from '../../scripts/truth/schema.js';

// Phase 3's row types (scripts/differential/golden-spec/rows.ts, wired by geometry in edges.ts and bars.ts), each judge
// on the replies that decide it, and the guarantee that they ask nothing of a capture with no measured geometry — the
// whole corpus before phase 3 (tests/differential/golden.test.ts pins its counts).

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const out = (reply: string, device: string[] = []): Outcome => ({ reply, device });
const CELL: CellTruth = {
  cell: 'edges',
  layer: 'none',
  device: 'iPhone 17 simulator, iOS 27.0',
  screen: { width: 402, height: 874 },
  scale: 3,
  targets: [],
  safeArea: { top: 62, left: 0, bottom: 34, right: 0 },
  chrome: { tabBar: rect(0, 790, 402, 84) },
};
const target = (geometry: Geometry | undefined, over: Partial<TargetTruth> = {}): TargetTruth => ({
  tag: 'A',
  id: 'lab.edges.A',
  color: '#43A047',
  declared: 'open',
  frame: rect(51, 670, 300, 64),
  reached: true,
  probe: [{ kind: 'touch', tag: '201,702' }],
  drawn: 1,
  seen: '#43A047',
  ...(geometry !== undefined && { geometry }),
  ...over,
});
const rows = (t: TargetTruth) => expectations('ios', t, CELL, 'wda');
const verdict = (rs: readonly Expectation[], verb: string, o: Outcome) => {
  const r = rs.find((x) => x.verb === verb);
  if (r === undefined) throw new Error(`no ${verb} row`);
  return r.judge(o);
};
const says = (rs: readonly Expectation[]) => rs.map((r) => `${r.verb}: ${r.says}`);

const TAPPED = 'Tapped id:"lab.edges.A"';
const OFF_REFUSAL = 'ERROR: off screen at (201,940) on a 402x874 screen (rect 51,908 300x64) — scroll_until it first';
const FAILED = '1/1 asserts FAILED\n✗ colour: covered';
const PASSED = 'All 1 asserts passed';
const VISIBLE = 'Element id:"lab.edges.A" visible after 0 swipes';
const IDB_STROKE = 'idb ui swipe 201 699 201 175 --duration 0.3';

describe('the rows ask nothing of a capture with no measured geometry', () => {
  it('an open target with no geometry or a whole one: the open rows, as before; one cut but unmeasured: none', () => {
    expect(rows(target(undefined)).map((r) => r.verb)).toEqual(['tap', 'colour', 'scroll_until']);
    expect(says(rows(target('whole')))).toEqual(says(rows(target(undefined))));
    expect(rows(target(undefined, { drawn: 0.5 }))).toEqual([]);
  });
  it('a geometry row needs the capture its bands and chrome are read from', () => {
    expect(expectations('ios', target('off-screen'), undefined, 'wda')).toEqual([]);
  });
  it('a presented-over target keeps the presented rows whatever its geometry (ADR 0018 first)', () => {
    const t = target('sliver', { declared: 'presented-over', reached: false });
    expect(rows(t).map((r) => r.says)).toEqual(rows({ ...t, geometry: undefined }).map((r) => r.says));
  });
});

describe('the rows each geometry asks', () => {
  it.each([
    ['off-screen', { frame: rect(51, 908, 300, 64), reached: false, probe: [], visible: null }, ['tap: R-off', 'colour: fails (R-off', 'scroll_until: R-off, R-stroke: swipes down', 'scroll_until: R-direction: each stroke down']],
    ['outside-scroll-view', { frame: rect(51, 720, 300, 64), reached: false, visible: null }, ['tap: R-outside-sv', 'colour: fails (R-outside-sv', 'scroll_until: R-outside-sv, R-stroke: swipes down', 'scroll_until: R-direction: each stroke down']],
    ['sliver', { visible: rect(51, 670, 300, 20) }, ['tap: R-sliver', 'scroll_until: R-sliver', 'fully: R-fully']],
    ['partly-centre-in', { visible: rect(51, 670, 300, 50) }, ['tap: R-land: Tapped', 'fully: R-fully']],
    ['centre-out', { reached: false, visible: rect(51, 670, 300, 30) }, ['tap: R-land: refused, nothing tapped', 'fully: R-fully']],
    ['status-band', { frame: rect(51, 10, 300, 64), reached: false }, ['tap: R-band', 'colour: fails (R-band: the status band', 'scroll_until: R-band']],
    // In a scroll view a band target is asked `fully` too (target-contract.ts#fullyAsked), as the live golden asks it.
    ['status-band', { frame: rect(51, 10, 300, 64), reached: false, scrollView: 'list' }, ['tap: R-band', 'colour: fails (R-band: the status band', 'scroll_until: R-band', 'fully: R-fully']],
    // iOS's home-indicator band is no band averi judges (target-contract.ts#judgedContext; consistency holds a target
    // centred there reached and drawn): a target there or overlapping it is judged by what else lies around it — here
    // CELL's tab bar over the screen's bottom (a centre under it: R-under-chrome; its edge under it: R-overlap, the
    // chrome's, `fully` asked in a scroll view or not). Android's navigation band: R-band (below); nothing else around
    // it, the open rows (golden-spec.test.ts).
    ['nav-band', { frame: rect(51, 820, 300, 64), reached: false, piece: rect(51, 820, 300, 0), reachedAtPiece: false }, ['tap: R-land: refused, nothing tapped', 'colour: fails (R-under-chrome: tabBar', 'scroll_until: R-under-chrome (tabBar)']],
    ['under-chrome:tabBar', { frame: rect(51, 760, 300, 64), reached: false, piece: rect(51, 760, 300, 30), reachedAtPiece: true }, ['tap: R-land: refused, or Tapped inside its piece', 'colour: fails (R-under-chrome: tabBar', 'scroll_until: R-under-chrome (tabBar)']],
    ['chrome-overlap:tabBar', { frame: rect(51, 600, 300, 200), visible: rect(51, 600, 300, 200) }, ['tap: R-land: Tapped', 'colour: R-overlap: passes', 'scroll_until: R-overlap (chrome-overlap:tabBar): reached', 'fully: R-fully']],
    ['band-overlap:nav', { frame: rect(51, 640, 300, 203), visible: rect(51, 640, 300, 203) }, ['tap: R-land: Tapped', 'colour: fails (R-overlap: tabBar', 'scroll_until: R-overlap (chrome-overlap:tabBar): reached', 'fully: R-fully']],
  ] as const)('%s', (g, over, expected) => {
    const got = says(rows(target(g, over as Partial<TargetTruth>)));
    expect(got).toHaveLength(expected.length);
    got.forEach((s, i) => expect(s.startsWith(expected[i])).toBe(true));
  });
});

describe('R-off, R-outside-sv, R-sliver: the tap refused naming scroll_until, nothing sent', () => {
  const rs = rows(target('off-screen', { frame: rect(51, 908, 300, 64), reached: false, probe: [], visible: null }));
  it.each([
    ['the off-screen refusal', out(OFF_REFUSAL), undefined],
    ['Tapped (the note: reported done)', out(TAPPED, ['idb ui tap 201 940']), 'Tapped: Tapped id:"lab.edges.A"'],
    ['refused, but a tap sent', out('ERROR: refused', ['idb ui tap 201 940']), 'refused, but sent idb ui tap 201 940'],
    ['refused with another remedy', out('ERROR: covered by Button "x" — close it first'), 'refused without scroll_until: ERROR: covered by Button "x" — close it first'],
    ['"not in the tree": the judge accepts the refusal, so it is vacuous', out('ERROR: timed out waiting for element id:"lab.edges.A" to appear — scroll_until it'), 'not in the tree: ERROR: timed out waiting for element id:"lab.edges.A" to appear — scroll_until it'],
  ])('%s', (_n, o, expected) => {
    expect(verdict(rs, 'tap', o)).toBe(expected);
  });
  it('the colour assert must not pass: nothing of it is on the screen', () => {
    expect(verdict(rs, 'colour', out(FAILED))).toBeUndefined();
    expect(verdict(rs, 'colour', out(PASSED))).toBe('passed on #43A047: All 1 asserts passed');
  });
});

describe('R-outside-sv colour: asked for the colour the screen shows there, so a pass measured the background (#29)', () => {
  const rs = rows(target('outside-scroll-view', { frame: rect(51, 620, 300, 64), reached: false, visible: null, seen: '#FFFFFF' }));
  it('the assert asks for the seen colour, and a pass on it is the defect', () => {
    const colour = rs.find((r) => r.verb === 'colour')!;
    expect(colour.call.args).toMatchObject({ asserts: [{ color: { expected: '#FFFFFF' } }] });
    expect(colour.says).toMatch(/asked for the colour the screen shows there \(#FFFFFF\)$/);
    expect(colour.judge(out(PASSED))).toBe('passed on #FFFFFF: All 1 asserts passed');
    expect(colour.judge(out(FAILED))).toBeUndefined();
  });
  it('R-off still asks for the target\'s own colour', () => {
    const off = rows(target('off-screen', { frame: rect(51, 908, 300, 64), reached: false, probe: [], visible: null, seen: '#000000' }));
    expect(off.find((r) => r.verb === 'colour')!.call.args).toMatchObject({ asserts: [{ color: { expected: '#43A047' } }] });
  });
});

describe('a target off the screen or outside its scroll view that its capture\'s tree did not list may be missing (target-contract.ts#unlistedBy)', () => {
  const NOT_FOUND = 'ERROR Timed out after 5000ms waiting for element id:"lab.edges.A" to appear';
  // On CELL's 402x874 screen, beside the scroll view `list` (380–560): accepted, as averi never saw which holds it.
  const ADB_STROKE = 'adb shell input swipe 201 699 201 175 300';
  const unlisted = { frame: rect(51, 908, 300, 64), reached: false, probe: [], visible: null, scrollView: 'list', listed: { uiautomator: false } };
  const android = (g: Geometry) => expectations('android', target(g, unlisted), { ...CELL, scrollViews: { list: rect(0, 380, 402, 180) } }, 'uiautomator');
  it.each(['off-screen', 'outside-scroll-view'] as const)('%s: the tap that waited and sent nothing, the colour not found, the swipes for it — all accepted', (g) => {
    const rs = android(g);
    expect(verdict(rs, 'tap', out(NOT_FOUND))).toBeUndefined();
    expect(verdict(rs, 'colour', out('1/1 asserts FAILED\nFAIL  element id:"lab.edges.A" … — not found within 1 s'))).toBeUndefined();
    // Not listed, no scroll view to hold its strokes to: averi never saw which one holds it.
    expect(verdict(rs, 'scroll_until', out(`ERROR scroll_until failed after 2 swipes — element never appeared in the tree`, [ADB_STROKE, ADB_STROKE]))).toBeUndefined();
    expect(verdict(rs, 'tap', out(TAPPED, ['adb shell input tap 201 940']))).toBe(`Tapped: ${TAPPED}`);
  });
  it('listed by the replayed source (or not recorded, or another source unlisted): the same replies are no answer', () => {
    for (const rs of [
      expectations('android', target('off-screen', { ...unlisted, listed: { uiautomator: true } }), CELL, 'uiautomator'),
      expectations('ios', target('off-screen', { ...unlisted, listed: { wda: true, idb: false } }), CELL, 'wda'),
      rows(target('off-screen', { frame: rect(51, 908, 300, 64), reached: false, probe: [], visible: null })),
    ]) {
      expect(verdict(rs, 'tap', out(NOT_FOUND))).toBe(`refused without scroll_until: ${NOT_FOUND}`);
      expect(verdict(rs, 'colour', out('1/1 asserts FAILED\nFAIL  element id:"lab.edges.A" … — not found within 1 s'))).toMatch(/^not in the tree: /);
    }
  });
});

describe('R-stroke inside the target\'s own scroll view (where the truth names it and the capture its clip)', () => {
  const cell: CellTruth = { ...CELL, scrollViews: { list: rect(0, 380, 402, 180) } };
  const rs = expectations('ios', target('outside-scroll-view', { frame: rect(51, 620, 300, 64), reached: false, visible: null, scrollView: 'list' }), cell, 'wda');
  it.each([
    ['inside the scroll view', ['idb ui swipe 201 520 201 400 --duration 0.3'], undefined],
    ['beside it, on the background (WDA on scroll-bounded)', [IDB_STROKE], 'touched down outside its scroll view list at (201,699): x'],
  ])('%s', (_n, device, expected) => {
    expect(verdict(rs, 'scroll_until', out('x', device))).toBe(expected);
  });
  it('a target in no scroll view, or one the state did not report: the screen\'s region only', () => {
    const none = expectations('ios', target('outside-scroll-view', { frame: rect(51, 620, 300, 64), reached: false, visible: null, scrollView: 'other' }), cell, 'wda');
    expect(verdict(none, 'scroll_until', out('x', [IDB_STROKE]))).toBeUndefined();
  });
});

describe('R-stroke: every touch-down on the screen, clear of the bands and the chrome', () => {
  const rs = rows(target('off-screen', { frame: rect(51, 908, 300, 64), reached: false, probe: [], visible: null }));
  it.each([
    ['above the tab bar and under the status band', ['idb ui swipe 201 699 201 175 --duration 0.3'], undefined],
    ['on the tab bar (the note: #11)', ['idb ui swipe 201 800 201 175 --duration 0.3'], 'touched down off the strokeable region at (201,800): x'],
    ['in the status band', ['idb ui swipe 201 40 201 600 --duration 0.3'], 'touched down off the strokeable region at (201,40): x'],
    ['in the home indicator\'s band', ['adb shell input swipe 201 850 201 300 300'], 'touched down off the strokeable region at (201,850): x'],
    ['no swipe at all', [], 'no swipe: x'],
  ])('%s', (_n, device, expected) => {
    expect(verdict(rs, 'scroll_until', out('x', device))).toBe(expected);
  });
  it('judges the strokes even when the target is in no tree where its capture\'s tree did not list it (uiautomator lists no off-screen row); where it did, that reply is vacuous', () => {
    const never = 'ERROR scroll_until id:"lab.edges.A" failed after 2 swipes — element never appeared in the tree';
    const off = target('off-screen', { frame: rect(51, 908, 300, 64), reached: false, probe: [], visible: null, listed: { uiautomator: false } });
    const android = expectations('android', off, CELL, 'uiautomator');
    expect(verdict(android, 'scroll_until', out(never, [IDB_STROKE, IDB_STROKE]))).toBeUndefined();
    expect(verdict(android, 'scroll_until', out(never, ['idb ui swipe 201 800 201 175 --duration 0.3']))).toMatch(/^touched down off the strokeable region at \(201,800\)/);
    expect(verdict(rs, 'scroll_until', out(never, [IDB_STROKE, IDB_STROKE]))).toMatch(/^not in the tree: /);
  });
  it('the region itself: the screen less the bands and the chrome; with neither, the whole screen', () => {
    const ok = strokeable(CELL);
    expect([ok({ x: 201, y: 61 }), ok({ x: 201, y: 62 }), ok({ x: 201, y: 789 }), ok({ x: 201, y: 790 }), ok({ x: 402, y: 400 })]).toEqual([false, true, true, false, false]);
    expect(strokesOff(out('x', ['idb ui swipe 201 870 201 10 --duration 0.3']), { screen: CELL.screen })).toBeUndefined();
  });
});

describe('R-sliver, R-band, R-under-chrome: scroll_until does not call it reached where it is, whatever it swiped', () => {
  const rs = rows(target('sliver', { visible: rect(51, 670, 300, 20) }));
  it.each([
    ['stops at once, "visible after 0 swipes" (the note: Tapped and does nothing)', out(VISIBLE), 'reached where it is sliver, after 0 swipe(s) that move nothing: Element id:"lab.edges.A" visible after 0 swipes'],
    ['"visible after 1 swipe": a replayed tree never moves, so it stopped where it is', out('Element id:"lab.edges.A" visible after 1 swipe', [IDB_STROKE]), 'reached where it is sliver, after 1 swipe(s) that move nothing: Element id:"lab.edges.A" visible after 1 swipe'],
    ['refuses (stuck)', out('ERROR: stuck'), undefined],
  ])('%s', (_n, o, expected) => {
    expect(verdict(rs, 'scroll_until', o)).toBe(expected);
  });
});

// scroll-bounded-flush's P as captured: cut flush by `upper`'s bottom (908); averi's real probe at 9c7885e drags up from
// inside `upper` (788 → 697), toward the bottom edge.
const UP_PROBE = 'adb shell input swipe 540 788 540 697 300';
const FLUSH = 'Element id:"lab.edges.A" fully visible after 1 swipe; its bottom edge lies on its scroll container\'s (0,303 1080x605), and a probe swipe toward it moved nothing — nothing of it is cut there';

describe('R-fully on a flush edge: the stop\'s probe is the device\'s to answer, but the truth must bear out the edge and the swipe', () => {
  const flushCell: CellTruth = { ...CELL, screen: { width: 1080, height: 2220 }, scrollViews: { upper: rect(0, 303, 1080, 605) } };
  const flush = (visible: Rect) => expectations('android', target('partly-centre-in', { frame: rect(128, 798, 825, 176), visible, scrollView: 'upper' }), flushCell, 'uiautomator');
  const P = flush(rect(128, 798, 825, 110));
  it('probed from inside its scroll view toward the flush edge (#12 at 9c7885e): accepted', () => {
    expect(verdict(P, 'fully', out(FLUSH, [UP_PROBE]))).toBeUndefined();
  });
  it('no swipe sent, a swipe dragging away from the edge, or one touching down outside its scroll view: red', () => {
    expect(verdict(P, 'fully', out(FLUSH))).toMatch(/^fully visible where it is partly-centre-in, after 0 swipe\(s\) that move nothing \(no swipe from inside its scroll view upper toward its bottom edge\)/);
    expect(verdict(P, 'fully', out(FLUSH, ['adb shell input swipe 540 697 540 788 300']))).toMatch(/\(no swipe from inside its scroll view upper toward its bottom edge\)/);
    expect(verdict(P, 'fully', out(FLUSH, ['adb shell input swipe 540 1200 540 1100 300']))).toMatch(/\(no swipe from inside its scroll view upper toward its bottom edge\)/);
  });
  it('an edge the truth does not show flush with its scroll view (the lab\'s scroll-bounded P runs past it): red', () => {
    expect(verdict(flush(rect(128, 798, 825, 90)), 'fully', out(FLUSH, [UP_PROBE]))).toMatch(/\(its bottom edge is not flush with its scroll view upper in the truth \(888 vs 908\)\)/);
    expect(verdict(P, 'fully', out(FLUSH.replace('its bottom edge', 'its top edge'), ['adb shell input swipe 540 400 540 500 300']))).toMatch(/its top edge is not flush/);
  });
});

describe('R-fully: fully: true never calls a cut target "visible" where it is, whatever it swiped', () => {
  const rs = rows(target('partly-centre-in', { visible: rect(51, 670, 300, 50) }));
  it.each([
    ['fully visible after 0 swipes (the notes #9, #12)', out(VISIBLE), 'fully visible where it is partly-centre-in, after 0 swipe(s) that move nothing: Element id:"lab.edges.A" visible after 0 swipes'],
    ['"visible after 1 swipe": a replayed tree never moves, so it stopped where it is', out('Element id:"lab.edges.A" visible after 1 swipe', [IDB_STROKE]), 'fully visible where it is partly-centre-in, after 1 swipe(s) that move nothing: Element id:"lab.edges.A" visible after 1 swipe'],
    ['stuck', out('ERROR: stuck'), undefined],
    // A stop claiming a flush probe, on a truth with no scroll view to bear it out: red.
    ['a flush probe claimed where the truth names no scroll view', out(FLUSH, [UP_PROBE]), /^fully visible where it is partly-centre-in, after 1 swipe\(s\) that move nothing \(no scroll view or visible part/],
  ])('%s', (_n, o, expected) => {
    if (expected instanceof RegExp) expect(verdict(rs, 'fully', o)).toMatch(expected);
    else expect(verdict(rs, 'fully', o)).toBe(expected);
  });
  it('asks toward the cut: down when its centre is below what shows, up when above', () => {
    const call = (t: TargetTruth) => rows(t).find((r) => r.verb === 'fully')!.call.args as { direction: string; fully: boolean };
    expect(call(target('partly-centre-in', { visible: rect(51, 670, 300, 30) }))).toMatchObject({ direction: 'down', fully: true });
    expect(call(target('partly-centre-in', { frame: rect(51, 80, 300, 64), visible: rect(51, 100, 300, 44) }))).toMatchObject({ direction: 'up', fully: true });
  });
});

describe('R-land: a Tapped point inside what shows, where a probe fired', () => {
  const visible = rect(51, 670, 300, 30);
  it.each([
    ['reached at its centre: Tapped inside', true, true, out(TAPPED, ['idb ui tap 201 685']), undefined],
    ['reached at its centre: Tapped outside what shows', true, true, out(TAPPED, ['idb ui tap 201 702']), 'Tapped outside what shows of it at (201,702): Tapped id:"lab.edges.A"'],
    ['reached at its centre: refused', true, true, out('ERROR: cut'), 'not tapped: ERROR: cut'],
    ['centre out, its piece fired: refused with nothing sent', true, false, out('ERROR: cut'), undefined],
    ['centre out, its piece fired: Tapped inside', true, false, out(TAPPED, ['idb ui tap 201 685']), undefined],
    ['centre out, its piece never fired: Tapped', false, false, out(TAPPED, ['idb ui tap 201 685']), 'Tapped where no probe fired it: Tapped id:"lab.edges.A"'],
    ['centre out: refused, but a tap sent', false, false, out('ERROR: cut', ['idb ui tap 201 685']), 'refused, but sent idb ui tap 201 685'],
    ['reached at its centre: Tapped with no tap sent', true, true, out(TAPPED), 'Tapped with no tap sent: Tapped id:"lab.edges.A"'],
    ['centre out, its piece fired: Tapped with no tap sent', true, false, out(TAPPED), 'Tapped with no tap sent: Tapped id:"lab.edges.A"'],
  ])('%s', (_n, fired, mustTap, o, expected) => {
    expect(landed(o, visible, fired, mustTap)).toBe(expected);
  });
  it('under chrome: R-land on its piece, by the second probe', () => {
    const t = target('under-chrome:tabBar', { frame: rect(51, 760, 300, 64), reached: false, piece: rect(51, 760, 300, 30), reachedAtPiece: true });
    expect(verdict(rows(t), 'tap', out(TAPPED, ['idb ui tap 201 775']))).toBeUndefined();
    expect(verdict(rows(t), 'tap', out(TAPPED, ['idb ui tap 201 792']))).toMatch(/^Tapped outside what shows of it at \(201,792\)/);
    expect(verdict(rows({ ...t, reachedAtPiece: false }), 'tap', out(TAPPED, ['idb ui tap 201 775']))).toMatch(/^Tapped where no probe fired it/);
  });
});

describe('R-band: refused, never measured, never reached where it is', () => {
  const band = target('nav-band', { frame: rect(51, 820, 300, 64), reached: false });
  const rs = expectations('android', band, CELL, 'uiautomator');
  it('Android\'s navigation band asks R-band whatever the probe did (ADR 0009 N-a)', () => {
    expect(says(expectations('android', { ...band, reached: true }, CELL, 'uiautomator')).map((x) => x.split(':')[1].trim())).toEqual(says(rs).map((x) => x.split(':')[1].trim()));
    expect(says(rs).map((x) => x.split(':')[1].trim())).toEqual(['R-band', 'fails (R-band', 'R-band']);
  });
  it('the tap refused with nothing sent, whatever its remedy', () => {
    expect(verdict(rs, 'tap', out('ERROR: under the navigation bar — scroll_until it first'))).toBeUndefined();
    expect(verdict(rs, 'tap', out('ERROR: pinned under the navigation bar'))).toBeUndefined();
    expect(verdict(rs, 'tap', out(TAPPED, ['adb shell input tap 201 852']))).toBe('Tapped: Tapped id:"lab.edges.A"');
  });
  it('where its probe fired the target (gesture navigation: the band is the app\'s), Tapped inside what shows of it, or refused with nothing sent', () => {
    const fired = expectations('android', { ...band, reached: true }, CELL, 'uiautomator');
    expect(verdict(fired, 'tap', out(TAPPED, ['adb shell input tap 201 852']))).toBeUndefined();
    expect(verdict(fired, 'tap', out('ERROR: under the navigation bar — scroll_until it first'))).toBeUndefined();
    expect(verdict(fired, 'tap', out(TAPPED, ['adb shell input tap 201 700']))).toMatch(/^Tapped outside what shows of it at \(201,700\)/);
  });
  it('the colour assert fails closed on the band (ADR 0001)', () => {
    expect(verdict(rs, 'colour', out(PASSED))).toMatch(/^passed on/);
  });
  it('the navigation band\'s colour by the mode recorded: under three buttons (the bar\'s) it fails closed; under gesture navigation (the app\'s: bands N seen in its own colour) a PASS on its own colour or a FAIL (ADR 0020)', () => {
    const three = expectations('android', band, { ...CELL, navigation: 'three-button' }, 'uiautomator');
    expect(verdict(three, 'colour', out(PASSED))).toMatch(/^passed on #43A047/);
    expect(verdict(three, 'colour', out(FAILED))).toBeUndefined();
    // Asked for the colour the screen shows there — the bar's — so that a pass means it measured the bar (#23).
    const bar = expectations('android', { ...band, seen: '#F4EAF7' }, { ...CELL, navigation: 'three-button' }, 'uiautomator').find((r) => r.verb === 'colour')!;
    expect(bar.call.args).toMatchObject({ asserts: [{ color: { expected: '#F4EAF7' } }] });
    expect(bar.says).toBe('fails (R-band: the navigation bar over it), asked for the colour the screen shows there (#F4EAF7)');
    const gesture = expectations('android', { ...band, reached: true }, { ...CELL, navigation: 'gesture' }, 'uiautomator');
    expect(gesture.find((r) => r.verb === 'colour')!.says).toBe('R-band (the navigation band under gesture navigation, the app\'s): passes on its own colour #43A047, or fails closed');
    expect(verdict(gesture, 'colour', out(PASSED))).toBeUndefined();
    expect(verdict(gesture, 'colour', out(FAILED))).toBeUndefined();
    expect(verdict(gesture, 'colour', out('ERROR: stuck'))).toBe('neither passed nor failed: ERROR: stuck');
    expect(verdict(gesture, 'colour', out('1/1 asserts FAILED\n✗ element id:"lab.edges.A" not found within 1000ms'))).toMatch(/^not in the tree: /);
    // The status band is the bar's in either mode: it fails closed.
    const status = expectations('android', target('status-band', { frame: rect(51, 10, 300, 64), reached: false }), { ...CELL, navigation: 'gesture' }, 'uiautomator');
    expect(verdict(status, 'colour', out(PASSED))).toMatch(/^passed on/);
  });
  it('a band target whose probe fired (iOS, below the bar\'s touch area) is not expected refused: Tapped inside it, or nothing sent', () => {
    const fired = rows(target('status-band', { frame: rect(51, 22, 300, 64), visible: rect(51, 22, 300, 64), reached: true }));
    expect(verdict(fired, 'tap', out(TAPPED, ['idb ui tap 201 54']))).toBeUndefined();
    expect(verdict(fired, 'tap', out('ERROR: under the status bar — scroll_until it first'))).toBeUndefined();
    expect(verdict(fired, 'tap', out(TAPPED, ['idb ui tap 201 100']))).toBe(`Tapped outside what shows of it at (201,100): ${TAPPED}`);
    expect(verdict(fired, 'tap', out('ERROR: refused', ['idb ui tap 201 54']))).toBe('refused, but sent idb ui tap 201 54');
  });
});

describe('R-dismiss and R-direction', () => {
  const r = dismissRow('ios', { tag: 'vs', id: 'lab.f.vs' }, { label: 'Transfer details', frame: rect(120, 60, 162, 22) });
  it('R-dismiss: the configured dismissal is tapped, inside its element', () => {
    expect(r.judge(out(TAPPED, ['idb ui tap 201 71', 'idb ui tap 201 700']))).toBeUndefined();
    // What covered the dismissal is read from the guard's own clause (replies.ts#dismissalCover), as the replies at
    // 5cff2ad (#7's toolbar) and 7542021 (#7's scroll view) say it — never from the advice, which names the
    // input-accessory toolbar whatever covered the dismissal.
    const refused = (cover: string) => `ERROR The soft keyboard covers id:"lab.f.vs": … and so was the input-accessory toolbar's Done … and none of the configured dismissals is usable on this screen (tap id:"lab.f.title": covered by ${cover}). Nothing was tapped`;
    expect(r.judge(out(refused('toolbar "Toolbar"')))).toMatch(/^no tap on the dismissal Transfer details \(refused for a toolbar\): ERROR The soft keyboard/);
    expect(r.judge(out(refused('scrollable')))).toMatch(/^no tap on the dismissal Transfer details \(refused for a scrollable\): ERROR The soft keyboard/);
    expect(r.judge(out('ERROR … the input-accessory toolbar\'s Done … nothing was tapped'))).toBe("no tap on the dismissal Transfer details: ERROR … the input-accessory toolbar's Done … nothing was tapped");
    expect(r.judge(out(TAPPED, ['idb ui tap 201 700']))).toBe('no tap on the dismissal Transfer details: Tapped id:"lab.edges.A"');
  });
  it('R-direction is live only: declared — asked of a target off what shows, never by the golden mode (golden-wiring.test.ts)', () => {
    const d = directionRow('ios', target('off-screen', { frame: rect(51, 908, 300, 64) }), CELL);
    expect(d.live).toMatch(/phase 5/);
    expect(d.call.args).toMatchObject({ direction: 'down' });
    for (const g of ['off-screen', 'outside-scroll-view'] as const) {
      expect(rows(target(g, { visible: null })).filter((x) => x.live !== undefined).map((x) => x.says)).toEqual(['R-direction: each stroke down brings it closer, and a stroke that does not turns back']);
    }
    for (const g of ['sliver', 'partly-centre-in', 'centre-out', 'status-band', 'nav-band', 'under-chrome:x', 'band-overlap:nav', 'chrome-overlap:x'] as const) {
      expect(rows(target(g, { visible: rect(51, 670, 300, 30) })).filter((x) => x.live !== undefined)).toEqual([]);
    }
  });
});

describe('a cell\'s averi.yaml variant (CellTruth.config)', () => {
  const rec = { id: 'r/x.wda.json', run: 'r', file: 'x.wda.json', platform: 'ios' as const, source: 'wda' as const, form: 'raw' as const, payload: '/dev/null' };
  it('without one, the config is what it always was', async () => {
    expect(JSON.parse(await readFile(await configFor(rec, undefined), 'utf8'))).toEqual({ app: { android: { package: 'differential.app' }, ios: { bundleId: 'differential.app', treeSource: 'wda' } } });
  });
  it('with one, merged over the platform\'s settings — a keyboardDismiss variant (#7, #19)', async () => {
    const c = JSON.parse(await readFile(await configFor(rec, undefined, { ios: { keyboardDismiss: [{ tap: 'text:"Transfer details"' }] }, android: { x: 1 } }), 'utf8'));
    expect(c).toEqual({ app: { android: { package: 'differential.app', x: 1 }, ios: { bundleId: 'differential.app', treeSource: 'wda', keyboardDismiss: [{ tap: 'text:"Transfer details"' }] } } });
  });
  it('the cell\'s variant wins over the differential\'s own dismissal variant: it is what the truth was captured under', async () => {
    const c = JSON.parse(await readFile(await configFor(rec, ['escape'], { ios: { keyboardDismiss: ['accessory'] } }), 'utf8'));
    expect(c.app.ios.keyboardDismiss).toEqual(['accessory']);
    expect(JSON.parse(await readFile(await configFor(rec, ['escape']), 'utf8')).app.ios.keyboardDismiss).toEqual(['escape']);
  });
});

describe('R-overlap: a whole target, its centre clear, its edge under a band or the chrome past the slack', () => {
  // 51,600 300x200: the colour sampler reads its 12 %-inset rect, 87,624 228x152 — down to y 776.
  const overlapped = (tabTop: number) =>
    expectations('ios', target('chrome-overlap:tabBar', { frame: rect(51, 600, 300, 200), visible: rect(51, 600, 300, 200) }), { ...CELL, safeArea: undefined, chrome: { tabBar: rect(0, tabTop, 402, 874 - tabTop) } }, 'wda');
  it('the colour fails closed when what it samples is overlapped past the slack (ADR 0001, 0002); else passes on its own colour', () => {
    const colour = (tabTop: number) => overlapped(tabTop).find((r) => r.verb === 'colour')!;
    expect(colour(774).says).toMatch(/^R-overlap: passes/);
    expect(colour(774).judge(out(PASSED))).toBeUndefined();
    expect(colour(774).judge(out(FAILED))).toBe('failed: ✗ colour: covered');
    expect(colour(773).says).toBe('fails (R-overlap: tabBar over what it samples)');
    expect(colour(773).judge(out(PASSED))).toBe('passed on #43A047: All 1 asserts passed');
    expect(colour(773).judge(out(FAILED))).toBeUndefined();
  });
  it('the tap lands at its centre; the plain stop stops at once; fully: true does not', () => {
    const rs = overlapped(790);
    expect(verdict(rs, 'tap', out(TAPPED, ['idb ui tap 201 700']))).toBeUndefined();
    expect(verdict(rs, 'tap', out('ERROR: covered by tab bar'))).toBe('not tapped: ERROR: covered by tab bar');
    expect(verdict(rs, 'scroll_until', out(VISIBLE))).toBeUndefined();
    expect(verdict(rs, 'scroll_until', out('Element id:"lab.edges.A" visible after 1 swipe', [IDB_STROKE]))).toMatch(/^swiped 1×/);
    expect(verdict(rs, 'scroll_until', out('ERROR: stuck'))).toBe('stopped: ERROR: stuck');
    expect(verdict(rs, 'fully', out(VISIBLE))).toMatch(/^fully visible/);
    expect(verdict(rs, 'fully', out('ERROR: stuck under the tab bar'))).toBeUndefined();
  });
});
