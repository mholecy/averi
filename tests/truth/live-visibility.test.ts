import { describe, expect, it } from 'vitest';
import { touchTurns, classStrokes, directionBreaks, distanceAt, judgeAndroidTurn, judgeCarry, judgeDismissal, judgePresentedAssert, judgePresentedScroll, presentedAssertCase, unchangedClaimBroken, judgeScroll, judgeTap, showRegion, visibilityCases } from '../../scripts/truth/live-visibility.js';
import { stopHolds } from '../../scripts/truth/target-contract.js';
import { turnsSaid } from '../../scripts/truth/replies.js';
import type { CellTruth, LabState, Stroke, TargetTruth } from '../../scripts/truth/schema.js';
import { knownLive, LIVE_KNOWN } from '../../scripts/truth/live-known.js';

// The live golden's visibility judges (scripts/truth/live-visibility.ts): pure over the lab app's state — its tap log,
// its scroll offsets and strokes, its frames — so they are pinned here without a device. iOS units: the iPhone 17's
// 402x874 pt, its status band 62 pt.

const SCREEN = { x: 0, y: 0, width: 402, height: 874 };
const at = 1;

/** A state of an edges-like cell: T in `page` (the whole screen), its frame `y`, the page at `offset`. */
function state(over: Partial<LabState> = {}): LabState {
  return {
    cell: 'c',
    ready: true,
    screen: SCREEN,
    scale: 3,
    frames: { T: { x: 51, y: -2, width: 300, height: 64 } },
    events: [],
    safeArea: { top: 62, left: 0, bottom: 34, right: 0 },
    scrollViews: { page: SCREEN },
    offsets: { page: 382 },
    strokes: [],
    ...over,
  };
}
const stroke = (from: number, to: number, view = 'page'): Stroke => ({ view, from, to, at });

describe('judgeTap: the app\'s tap log is the oracle', () => {
  const launched = state();
  it('Tapped and the target alone fired: ok', () => {
    expect(judgeTap('T', true, 'Tapped id:"x"', state({ events: [{ kind: 'touch', tag: '1,1', at }, { kind: 'tap', tag: 'T', at }] }), launched).outcome).toBe('ok');
  });
  it('Tapped with nothing fired, or another control fired besides: MISMATCH', () => {
    expect(judgeTap('T', true, 'Tapped id:"x"', state({ events: [{ kind: 'touch', tag: '1,1', at }] }), launched).outcome).toBe('MISMATCH');
    expect(judgeTap('T', true, 'Tapped id:"x"', state({ events: [{ kind: 'tap', tag: 'T', at }, { kind: 'tab', tag: 'home', at }] }), launched).outcome).toBe('MISMATCH');
  });
  it('refused while the layer was dismissed: MISMATCH; refused with nothing fired: ok where the probe did not reach it, LOUD where it did', () => {
    expect(judgeTap('T', false, 'ERROR covered', state({ events: [{ kind: 'dismissed', tag: 'sheet', at }] }), launched).outcome).toBe('MISMATCH');
    expect(judgeTap('T', false, 'ERROR covered', state(), launched).outcome).toBe('ok');
    expect(judgeTap('T', true, 'ERROR covered', state(), launched).outcome).toBe('LOUD');
  });
  it('only what happened after the launch counts', () => {
    const before = state({ events: [{ kind: 'tap', tag: 'T', at }] });
    expect(judgeTap('T', true, 'Tapped id:"x"', before, before).outcome).toBe('MISMATCH');
  });
});

describe('the distance a stroke changes (R-direction)', () => {
  it('the region: the clip below the status band, less a full-width chrome at its edge', () => {
    expect(showRegion(state(), 'ios', 'page')).toEqual({ x: 0, y: 62, width: 402, height: 812 });
    const sticky = state({ scrollViews: { list: { x: 0, y: 110, width: 402, height: 450 } }, chrome: { stickyHeader: { x: 0, y: 110, width: 402, height: 56 } } });
    expect(showRegion(sticky, 'ios', 'list')).toEqual({ x: 0, y: 166, width: 402, height: 394 });
    const tabBar = state({ scrollViews: { list: { x: 0, y: 200, width: 402, height: 640 } }, chrome: { tabBar: { x: 24, y: 743, width: 354, height: 87 } } });
    expect(showRegion(tabBar, 'ios', 'list')).toEqual({ x: 0, y: 200, width: 402, height: 543 });
    const fab = state({ scrollViews: { list: { x: 0, y: 62, width: 402, height: 778 } }, chrome: { fab: { x: 153, y: 700, width: 96, height: 96 } } });
    expect(showRegion(fab, 'ios', 'list')).toEqual({ x: 0, y: 62, width: 402, height: 778 });
  });
  it('how far the target lies from showing whole at an offset: T at -2 with the page at 382 is 64 above the band; 64 less offset shows it', () => {
    const region = { x: 0, y: 62, width: 402, height: 812 };
    const f0 = { x: 51, y: -2, width: 300, height: 64 };
    expect(distanceAt(382, f0, 382, region)).toBe(64);
    expect(distanceAt(318, f0, 382, region)).toBe(0);
    expect(distanceAt(900, f0, 382, region)).toBe(582);
  });
  it('along a horizontal scroll view\'s axis (a carousel\'s card, asked `right`): its x moved by the offset across', () => {
    const carousel = { x: 66, y: 380, width: 948, height: 234 };
    const card = { x: 1014, y: 380, width: 948, height: 234 };
    expect(distanceAt(0, card, 0, carousel, 'x')).toBe(948);
    expect(distanceAt(948, card, 0, carousel, 'x')).toBe(0);
    expect(distanceAt(0, card, 0, carousel)).toBe(0); // along y it already shows: the axis decides
    const s = state({ scrollViews: { carousel }, frames: { C: card }, offsets: { carousel: 0 }, strokes: [stroke(0, 400, 'carousel'), stroke(400, 0, 'carousel')] });
    expect(classStrokes(s, state({ scrollViews: { carousel }, frames: { C: card }, offsets: { carousel: 0 } }), 'android', 'C', 'carousel', 'x')?.map((c) => c.cls)).toEqual(['closer', 'away']);
  });
  it('classes each stroke of its own scroll view: away, still, closer', () => {
    const s = state({ strokes: [stroke(382, 900), stroke(900, 900), stroke(900, 200), stroke(0, 50, 'other')] });
    expect(classStrokes(s, state(), 'ios', 'T', 'page')?.map((c) => c.cls)).toEqual(['away', 'still', 'closer']);
  });
});

describe('directionBreaks', () => {
  const classed = (strokes: Stroke[]) => classStrokes(state({ strokes }), state(), 'ios', 'T', 'page')!;
  it('a stroke away turned back at once: no break', () => {
    const s = [stroke(382, 900), stroke(900, 200)];
    expect(directionBreaks(s, classed(s), 'page', 2, 0)).toEqual([]);
  });
  it('two strokes in a row that do not bring it closer: no turn back (#17)', () => {
    const s = [stroke(382, 382), stroke(382, 382), stroke(382, 382)];
    expect(directionBreaks(s, classed(s), 'page', 3, 64)).toEqual([expect.stringMatching(/^no turn back: stroke 1 .* and stroke 2 .* neither brought it closer/)]);
  });
  it('the call ended on a stroke away, the target still not whole', () => {
    const s = [stroke(382, 900)];
    expect(directionBreaks(s, classed(s), 'page', 1, 582)).toEqual([expect.stringMatching(/^ended on a stroke that did not bring it closer/)]);
  });
  it('swipes that logged no stroke at all and left it where it was', () => {
    expect(directionBreaks([], [], 'page', 4, 64)).toEqual(['4 swipes, none of them brought it closer (0 stroke(s) logged)']);
    expect(directionBreaks([], [], 'page', 0, 0)).toEqual([]);
  });
  it('a stroke that moved another scroll view', () => {
    const s = [stroke(0, 300, 'upper'), stroke(382, 300)];
    expect(directionBreaks(s, classed(s), 'page', 2, 0)).toEqual(['stroked upper 0→300, not its own page']);
  });
});

describe('judgeScroll', () => {
  const c = { tag: 'T', view: 'page', fully: false, platform: 'ios' as const };
  const launched = state();
  const reached = state({ frames: { T: { x: 51, y: 300, width: 300, height: 64 } }, offsets: { page: 80 }, strokes: [stroke(382, 80)], events: [{ kind: 'tap', tag: 'T', at }] });
  it('a stop the app bears out, one stroke closer, the tap firing it: ok', () => {
    expect(judgeScroll(c, ['Element id:"x" visible after 1 swipe', 'Tapped id:"x"'], reached, launched).outcome).toBe('ok');
  });
  it('"visible" where the app lays it out in the status band: MISMATCH', () => {
    expect(judgeScroll(c, ['Element id:"x" visible after 0 swipes', 'ERROR …'], launched, launched)).toMatchObject({ outcome: 'MISMATCH', why: expect.stringMatching(/status-band, not visible/) });
  });
  it('fully: true on a row the app shows cut: MISMATCH; the plain stop there (its centre in): ok', () => {
    const cut = state({ frames: { T: { x: 51, y: 840, width: 300, height: 64 } }, offsets: { page: 0 }, strokes: [stroke(382, 0)], events: [{ kind: 'tap', tag: 'T', at }] });
    expect(judgeScroll({ ...c, fully: true }, ['Element id:"x" fully visible after 1 swipe', 'Tapped'], cut, launched).outcome).toBe('MISMATCH');
    expect(stopHolds('partly-centre-in', false)).toBe(true);
    expect(stopHolds('partly-centre-in', true)).toBe(false);
  });
  it('failed where the app shows it as the stop needs: MISMATCH; failed where it does not: LOUD', () => {
    expect(judgeScroll(c, ['ERROR failed after 1 swipe', 'Tapped'], reached, launched).outcome).toBe('MISMATCH');
    const away = state({ frames: { T: { x: 51, y: -2, width: 300, height: 64 } } });
    expect(judgeScroll(c, ['ERROR failed', 'ERROR not found'], away, launched).outcome).toBe('LOUD');
  });
  it('a stop that kept the row but never turned back: MISMATCH on R-direction', () => {
    const stuck = state({ strokes: [stroke(382, 382), stroke(382, 382)] });
    expect(judgeScroll(c, ['ERROR failed after 2 swipes — content exhausted', 'ERROR'], stuck, launched)).toMatchObject({ outcome: 'MISMATCH', why: expect.stringMatching(/^R-direction: no turn back/) });
  });
  it('a target its tree does not list (uiautomator dumps no node off the screen): its strokes reported, not judged — an honest failure is LOUD', () => {
    const beside = state({ strokes: [stroke(0, 400, 'upper'), stroke(400, 800, 'upper')] });
    const reply = 'ERROR scroll_until failed after 2 swipes — element never appeared in the tree';
    expect(judgeScroll(c, [reply, 'ERROR'], beside, launched).outcome).toBe('MISMATCH');
    expect(judgeScroll({ ...c, unlisted: true }, [reply, 'ERROR'], beside, launched)).toMatchObject({ outcome: 'LOUD', why: expect.stringMatching(/not in the tree: its strokes unjudged — stroked upper/) });
  });
  it('the stop held but the tap after it fired something else: MISMATCH', () => {
    const other = state({ ...reached, events: [{ kind: 'tab', tag: 'home', at }] });
    expect(judgeScroll(c, ['Element id:"x" visible after 1 swipe', 'Tapped id:"x"'], other, launched).outcome).toBe('MISMATCH');
  });
});

describe('judgePresentedScroll', () => {
  const c = { tag: 'E', view: 'host', platform: 'ios' as const };
  it('refused with nothing moved or fired: ok; a stroke on the host beneath, or the layer dismissed: MISMATCH', () => {
    expect(judgePresentedScroll(c, ['ERROR close it first'], state(), state()).outcome).toBe('ok');
    expect(judgePresentedScroll(c, ['ERROR failed'], state({ strokes: [stroke(200, 600, 'host')] }), state()).outcome).toBe('MISMATCH');
    expect(judgePresentedScroll(c, ['ERROR failed'], state({ events: [{ kind: 'dismissed', tag: 'sheet', at }] }), state()).outcome).toBe('MISMATCH');
  });
});

describe('visibilityCases', () => {
  const target = (over: Partial<TargetTruth>): TargetTruth => ({ tag: 'T', id: 'lab.c.T', color: '#000000', declared: 'open', frame: { x: 51, y: -2, width: 300, height: 64 }, reached: false, probe: [], drawn: 1, seen: '#000000', ...over });
  const truth = (cell: string, targets: TargetTruth[]): CellTruth => ({ cell, layer: 'none', device: 'd', screen: { width: 402, height: 874 }, scale: 3, targets });
  it('a tap per target, a scroll toward each one not whole (fully too where it is cut or in a band), the turn-back cases', () => {
    const ids = visibilityCases(truth('scroll-top-edge-end', [target({ geometry: 'status-band', scrollView: 'page', visible: { x: 51, y: 0, width: 300, height: 62 } }), target({ tag: 'W', id: 'lab.c.W', geometry: 'whole', scrollView: 'page', reached: true })]), 'ios').map((c) => c.id);
    expect(ids).toEqual(['tap:scroll-top-edge-end.T', 'scroll:scroll-top-edge-end.T', 'scroll:scroll-top-edge-end.T.fully', 'tap:scroll-top-edge-end.W', 'turn:scroll-top-edge-end.T', 'turn:scroll-top-edge-end.T.fully']);
  });
  it('toward it: up for a target above what shows, its turn-back case the wrong way', () => {
    const cs = visibilityCases(truth('scroll-top-edge-end', [target({ geometry: 'status-band', scrollView: 'page', visible: { x: 51, y: 0, width: 300, height: 62 } })]), 'ios');
    expect(cs.find((c) => c.id === 'scroll:scroll-top-edge-end.T')?.calls[0].args.direction).toBe('up');
    expect(cs.find((c) => c.id === 'turn:scroll-top-edge-end.T')?.calls[0].args.direction).toBe('down');
  });
  it('toward a carousel\'s card: `right`, its case judged along x', () => {
    const cs = visibilityCases({ ...truth('carousel-in-list', [target({ tag: 'C', id: 'lab.c.C', geometry: 'outside-scroll-view', scrollView: 'carousel', visible: null, frame: { x: 378, y: 138, width: 354, height: 85 } })]), scrollViews: { carousel: { x: 24, y: 138, width: 354, height: 85 } } }, 'ios');
    expect(cs.find((c) => c.id === 'scroll:carousel-in-list.C')?.calls[0].args.direction).toBe('right');
  });
  it('beneath a presented layer: the refusal case', () => {
    const cs = visibilityCases(truth('sheet-medium-edges', [target({ declared: 'presented-over', geometry: 'off-screen', scrollView: 'host' })]), 'ios');
    expect(cs.map((c) => c.id)).toEqual(['tap:sheet-medium-edges.T', 'scroll:sheet-medium-edges.T']);
    expect(cs[1].says).toMatch(/beneath the presented layer/);
    // in no scroll view too (alert-dim, sheet-medium): the stroke would land on the layer
    const none = visibilityCases(truth('alert-dim', [target({ declared: 'presented-over', geometry: 'whole', scrollView: undefined })]), 'android');
    expect(none.map((c) => c.id)).toEqual(['tap:alert-dim.T', 'scroll:alert-dim.T']);
    // the colour assert case of a presented window (live.ts asks it of round 7's cells alone)
    const asked = presentedAssertCase('dialog-fullscreen', target({ tag: 'A', declared: 'presented-over', id: 'lab.dialog-fullscreen.A', color: '#E53935' }));
    expect(asked.id).toBe('assert:dialog-fullscreen.A');
    expect(asked.calls).toEqual([{ tool: 'assert', args: { asserts: [{ element: { id: 'lab.dialog-fullscreen.A' }, color: { expected: '#E53935' }, timeout: 3_000 }] } }]);
  });
});

// LV5.
describe('the long-list carry case: target L, row 30 of sheet-long-list, under WDA', () => {
  // The table: 0,62 402x812, 56 rows of 64 pt; L at content y 1920, whole over offsets 1172–1920 — its frame the app's,
  // the clip moved by its place and the table's offset.
  const table = (over: Partial<LabState> = {}) => {
    const offset = over.offsets?.list ?? 0;
    return state({ frames: { L: { x: 0, y: 62 + 1920 - offset, width: 402, height: 64 } }, scrollViews: { list: { x: 0, y: 62, width: 402, height: 812 } }, offsets: undefined, ...over });
  };
  const launched = table();
  const reply = 'Element id:"lab.sheet-long-list.L" visible after 2 swipes';
  it('a full stroke short of the window, then one cut to it: ok', () => {
    const cut = table({ offsets: { list: 1460 }, strokes: [stroke(0, 1048, 'list'), stroke(1048, 1460, 'list')] });
    expect(judgeCarry(reply, cut, launched)).toMatchObject({ outcome: 'ok', app: expect.stringMatching(/strokes list 0→1048, list 1048→1460/) });
  });
  it('a stroke that carried it past its window, then a turn back to it: MISMATCH on R-direction, both named', () => {
    const overshot = table({ offsets: { list: 1500 }, strokes: [stroke(0, 1000, 'list'), stroke(1000, 1990, 'list'), stroke(1990, 1500, 'list')] });
    expect(judgeCarry('Element id:"lab.sheet-long-list.L" visible after 3 swipes', overshot, launched)).toMatchObject({
      outcome: 'MISMATCH',
      cls: 'R-direction',
      why: expect.stringMatching(/^R-direction \(carry\): a stroke back up \(1990→1500\): averi turned; a stroke carried it past its window \(1000→1990/),
    });
  });
  it('a stop the table does not bear out: judgeScroll\'s stop claim', () => {
    expect(judgeCarry(reply, table({ offsets: { list: 1048 }, strokes: [stroke(0, 1048, 'list')] }), launched)).toMatchObject({ outcome: 'MISMATCH', cls: 'stop-claim' });
  });
  it('a turn the app\'s strokes do not show (merged into one fling) is read from the touch-downs and from the reply', () => {
    const touch = (y: number) => ({ kind: 'touch' as const, tag: `201.0,${y}.0`, at });
    const turned = table({ offsets: { list: 1460 }, strokes: [stroke(0, 1460, 'list')], events: [touch(712), touch(224), touch(712)] });
    expect(touchTurns(turned, launched, { x: 0, y: 62, width: 402, height: 812 })).toBe(2);
    expect(judgeCarry(reply, turned, launched)).toMatchObject({ outcome: 'MISMATCH', cls: 'R-direction', why: expect.stringMatching(/turned 2× \(touch-downs 2, the reply 0\)/) });
    const said = table({ offsets: { list: 1460 }, strokes: [stroke(0, 1460, 'list')], events: [touch(712), touch(712)] });
    expect(judgeCarry(`${reply}. It was turned round 1 time: …`, said, launched)).toMatchObject({ outcome: 'MISMATCH', why: expect.stringMatching(/the reply 1/) });
    expect(judgeCarry(reply, said, launched).outcome).toBe('ok');
  });
  it('the turns a reply says: the fling\'s count, and the end turn as one', () => {
    expect(turnsSaid('ERROR … It was turned round 3 times: a swipe carried it past')).toBe(3);
    expect(turnsSaid('ERROR … It was turned round 1 time: a swipe')).toBe(1);
    expect(turnsSaid('Element … fully visible after 6 swipes; 2 swipes up, the last of which did not move it — … so averi turned down, as the tree places')).toBe(1);
    expect(turnsSaid('Element … visible after 1 swipe')).toBe(0);
  });
  it('asked on iOS alone, under WDA alone, by its identifier', () => {
    const t: CellTruth = { cell: 'sheet-long-list', layer: 'sheet-list', device: 'd', screen: { width: 402, height: 874 }, scale: 3, targets: [] };
    const ios = visibilityCases(t, 'ios').find((c) => c.id === 'carry:sheet-long-list.L');
    expect(ios).toMatchObject({ sources: ['wda'], calls: [{ tool: 'scroll_until', args: { selector: 'id:"lab.sheet-long-list.L"', direction: 'down' } }] });
    expect(visibilityCases(t, 'android').some((c) => c.id.startsWith('carry:'))).toBe(false);
  });
});

describe('judgeDismissal (#7, #19)', () => {
  const field = (value: string, focused = false) => ({ value, focused, error: null });
  const form = (focus: string | null, over: Partial<LabState> = {}) => state({ focus, fields: { postcode: field('811 01', focus === 'postcode'), vs: field('') }, submits: [], ...over });
  const launched = form('postcode');
  it('Tapped with the field focused, nothing typed: ok; Tapped with nothing focused: MISMATCH', () => {
    expect(judgeDismissal('vs', 'Tapped id:"x" (hidden by tapping …)', 'wda', form('vs'), launched).outcome).toBe('ok');
    expect(judgeDismissal('vs', 'Tapped id:"x"', 'wda', form(null), launched)).toMatchObject({ outcome: 'MISMATCH', why: expect.stringMatching(/the focus is on none/) });
  });
  it('a key pressed (a field changed) or a submit: MISMATCH', () => {
    expect(judgeDismissal('vs', 'ERROR covered', 'wda', form('postcode', { fields: { postcode: field('811 012', true), vs: field('') } }), launched).outcome).toBe('MISMATCH');
    expect(judgeDismissal('vs', 'ERROR covered', 'wda', form('postcode', { submits: [{ at, valid: false, values: {} }] }), launched).outcome).toBe('MISMATCH');
  });
  it('refused: idb ok; WDA ok once the dismissal ended the editing and the field was refused for where it lies; else LOUD', () => {
    expect(judgeDismissal('vs', 'ERROR covered', 'idb', launched, launched).outcome).toBe('ok');
    const after = 'ERROR id:"x" was not tapped: after id:"t" was tapped at (201,84) to hide the soft keyboard, it is outside its scroll view';
    expect(judgeDismissal('vs', after, 'wda', form(null), launched).outcome).toBe('ok');
    expect(judgeDismissal('vs', after, 'wda', launched, launched).outcome).toBe('LOUD');
    expect(judgeDismissal('vs', 'ERROR The soft keyboard covers id:"x"', 'wda', launched, launched).outcome).toBe('LOUD');
  });
});

describe('the visibility cases\' expectations from the static truth', () => {
  const target = (over: Partial<TargetTruth>): TargetTruth => ({ tag: 'N', id: 'lab.c.N', color: '#000000', declared: 'open', frame: { x: 0, y: 2121, width: 825, height: 99 }, reached: true, probe: [], drawn: 1, seen: '#000000', ...over });
  const truth = (cell: string, targets: TargetTruth[]): CellTruth => ({ cell, layer: 'none', device: 'd', screen: { width: 1080, height: 2220 }, scale: 1, targets });
  const launched = state({ events: [] });
  it('a target in a system band its probe reached: a refusal is ok (R-band), not LOUD; one reached in the open: LOUD', () => {
    const [band] = visibilityCases(truth('bands', [target({ geometry: 'nav-band' })]), 'android');
    expect(band.judge(launched, ['ERROR under the navigation bar'], launched, 'uiautomator', []).outcome).toBe('ok');
    const [open] = visibilityCases(truth('bands', [target({ geometry: 'whole' })]), 'android');
    expect(open.judge(launched, ['ERROR covered'], launched, 'uiautomator', []).outcome).toBe('LOUD');
  });
  it('iOS\'s home-indicator band is no band (target-contract.ts#judgedContext): its target\'s tap must fire, a refusal LOUD, as the replayed open row asks', () => {
    const iosBands: CellTruth = { ...truth('bands', [target({ geometry: 'nav-band', frame: { x: 51, y: 847, width: 300, height: 20 } })]), screen: { width: 402, height: 874 }, safeArea: { top: 62, left: 0, bottom: 34, right: 0 } };
    const [n] = visibilityCases(iosBands, 'ios');
    expect(n.asks).toEqual({ must: 'fire', inside: 'node' });
    expect(n.judge(launched, ['ERROR under the home indicator'], launched, 'wda', [])).toMatchObject({ outcome: 'LOUD', cls: 'tap-refused', kind: 'refused' });
    const fired = state({ events: [{ kind: 'tap', tag: 'N', at }] });
    expect(n.judge(fired, ['Tapped id:"lab.c.N"'], launched, 'wda', [])).toMatchObject({ outcome: 'ok', kind: 'Tapped' });
  });
  it('a target its capture\'s tree of that source did not list: its strokes reported, not judged — listed, judged', () => {
    const t = target({ tag: 'T', id: 'lab.c.T', geometry: 'off-screen', scrollView: 'page', frame: { x: 51, y: -2, width: 300, height: 64 }, listed: { uiautomator: false, wda: true } });
    const scroll = visibilityCases(truth('c', [t]), 'ios').find((c) => c.id === 'scroll:c.T')!;
    const beside = state({ strokes: [stroke(0, 400, 'upper'), stroke(400, 800, 'upper')] });
    const reply = ['ERROR scroll_until failed after 2 swipes — element never appeared in the tree', 'ERROR'];
    expect(scroll.judge(beside, reply, launched, 'uiautomator', [beside]).outcome).toBe('LOUD');
    expect(scroll.judge(beside, reply, launched, 'wda', [beside]).outcome).toBe('MISMATCH');
  });
  it('a text target is asked by its text, another by its id', () => {
    const [byText] = visibilityCases(truth('own-parts', [target({ text: 'LOGIN', geometry: 'whole' })]), 'ios');
    expect(byText.calls[0].args.selector).toBe('text:"LOGIN"');
    const [byId] = visibilityCases(truth('own-parts', [target({ geometry: 'whole' })]), 'ios');
    expect(byId.calls[0].args.selector).toBe('id:"lab.c.N"');
  });
});

describe('unchangedClaimBroken: "the last N swipes did not change the screen" against the app\'s strokes', () => {
  const reply = (n: number, swipes: number) => `ERROR scroll_until id:"x" failed after ${swipes} swipes (the last ${n}, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree`;
  it('a stroke among the last N moved a scroll view — any one: the claim is about the screen', () => {
    expect(unchangedClaimBroken(reply(2, 4), [stroke(0, 400, 'upper'), stroke(400, 800, 'upper'), stroke(800, 1100, 'upper'), stroke(1100, 1320, 'upper')])).toMatch(/the last 2 swipes did not change the screen — the app logged upper 800→1100, upper 1100→1320/);
  });
  it('the last N moved nothing: the claim stands; fewer strokes than swipes: not judged; "did not move it": not this claim', () => {
    expect(unchangedClaimBroken(reply(2, 4), [stroke(0, 400), stroke(400, 900), stroke(900, 900), stroke(900, 900)])).toBeUndefined();
    expect(unchangedClaimBroken(reply(2, 4), [stroke(0, 400), stroke(400, 900)])).toBeUndefined();
    expect(unchangedClaimBroken('ERROR failed after 2 swipes (the last 2, swiping down, did not move it: content exhausted)', [stroke(0, 400), stroke(400, 900)])).toBeUndefined();
  });
  it('in judgeScroll: a MISMATCH even for a target the tree did not list', () => {
    const moved = state({ strokes: [stroke(0, 400, 'upper'), stroke(400, 800, 'upper')] });
    expect(judgeScroll({ tag: 'T', view: 'page', fully: false, platform: 'android', unlisted: true }, [reply(2, 2), 'ERROR'], moved, state()).outcome).toBe('MISMATCH');
  });
});

describe('judgeScroll judges the stop where scroll_until left it', () => {
  it('a target visible only after the tap ran (a fling finishing): the stop read at return is what counts', () => {
    const c = { tag: 'T', view: 'page', fully: false, platform: 'ios' as const };
    const atStop = state({ frames: { T: { x: 51, y: -2, width: 300, height: 64 } }, offsets: { page: 382 } });
    const later = state({ frames: { T: { x: 51, y: 300, width: 300, height: 64 } }, offsets: { page: 80 }, strokes: [stroke(382, 80)], events: [{ kind: 'tap', tag: 'T', at }] });
    expect(judgeScroll(c, ['Element id:"x" visible after 1 swipe', 'Tapped'], later, state(), atStop).outcome).toBe('MISMATCH');
    expect(judgeScroll(c, ['Element id:"x" visible after 1 swipe', 'Tapped'], later, state(), later).outcome).toBe('ok');
  });
  it('the cases hand the state read between the calls to the stop (scroll) and to the refusal beneath a layer', () => {
    const t: TargetTruth = { tag: 'T', id: 'lab.c.T', color: '#000000', declared: 'open', frame: { x: 51, y: -2, width: 300, height: 64 }, reached: false, probe: [], drawn: 0, seen: '#000000', geometry: 'status-band', scrollView: 'page', visible: { x: 51, y: 0, width: 300, height: 62 } };
    const cell: CellTruth = { cell: 'c', layer: 'none', device: 'd', screen: { width: 402, height: 874 }, scale: 3, targets: [t] };
    const scroll = visibilityCases(cell, 'ios').find((x) => x.id === 'scroll:c.T')!;
    const atStop = state({ frames: { T: { x: 51, y: -2, width: 300, height: 64 } } });
    const later = state({ frames: { T: { x: 51, y: 300, width: 300, height: 64 } }, offsets: { page: 80 }, strokes: [stroke(382, 80)], events: [{ kind: 'tap', tag: 'T', at }] });
    expect(scroll.judge(later, ['Element id:"x" visible after 1 swipe', 'Tapped'], state(), 'wda', [atStop]).outcome).toBe('MISMATCH');
    const beneath = visibilityCases({ ...cell, targets: [{ ...t, declared: 'presented-over' }] }, 'ios').find((x) => x.id === 'scroll:c.T')!;
    const moved = state({ strokes: [stroke(200, 0, 'page')] });
    expect(beneath.judge(state(), ['ERROR close it first'], state(), 'wda', [moved]).outcome).toBe('MISMATCH');
  });
});

describe('the tap after a stop is judged on the state after the tap', () => {
  it('the target fires only in the final state: ok — judged on the stop\'s state it would read as nothing fired', () => {
    const c = { tag: 'T', view: 'page', fully: false, platform: 'ios' as const };
    const atStop = state({ frames: { T: { x: 51, y: 300, width: 300, height: 64 } }, offsets: { page: 80 }, strokes: [stroke(382, 80)] });
    const final = state({ ...atStop, events: [{ kind: 'tap', tag: 'T', at }] });
    expect(judgeScroll(c, ['Element id:"x" visible after 1 swipe', 'Tapped id:"x"'], final, state(), atStop).outcome).toBe('ok');
  });
});

describe('the live KNOWN pins the rule a case fails by and the kind of reply it rests on', () => {
  it('a known case failing by its entry\'s rule on its entry\'s kind is known; by another rule, or another kind, it is not', () => {
    expect(knownLive('android', 'uiautomator', 'scroll:tabbar-floating.F', 'unchanged-claim', 'not found')).toMatch(/LV1|blank-content/);
    expect(knownLive('android', 'uiautomator', 'scroll:tabbar-floating.F', 'stop-claim', 'not found')).toBeUndefined();
    expect(knownLive('android', 'uiautomator', 'scroll:tabbar-floating.F', 'unchanged-claim', 'refused')).toBeUndefined();
    expect(knownLive('android', 'uiautomator', 'scroll:tabbar-floating.F', 'unchanged-claim', undefined)).toBeUndefined();
    expect(knownLive('android', 'uiautomator', 'tap:scroll-bounded.S', 'tap-refused-fired', 'refused')).toBeUndefined();
    expect(knownLive('ios', 'wda', 'scroll:no-such.case', 'stop-claim', 'visible')).toBeUndefined();
  });
  // A consistency check of the data, not a second judge: live-visibility.ts produces `tap-claim` only on a `Tapped`
  // reply and `stop-claim` only on a `visible` one, so an entry pinning either rule on another kind could never match.
  it('a claim pins the kind it claims on: a stop claimed on `visible`, a tap claimed on `Tapped`', () => {
    const bad = Object.entries(LIVE_KNOWN).filter(([, e]) => (e.cls === 'stop-claim' && e.kind !== 'visible') || (e.cls === 'tap-claim' && e.kind !== 'Tapped'));
    expect(bad).toEqual([]);
  });
  // Its notes (a bug note of docs/bugs, a residual of a decision) are checked in tests/truth/lab-notes.test.ts.
  it('every entry is keyed `<platform> <source> <case id>` and names a rule', () => {
    for (const [k, e] of Object.entries(LIVE_KNOWN)) expect(`${k} ${e.cls}`).toMatch(/^(android|ios) \w+ (tap|scroll|turn|carry):\S+ \S+$/);
  });
});

describe('the turn-back case of a target a source does not list', () => {
  it('is said to ask no turn under that source', () => {
    const t: TargetTruth = { tag: 'F', id: 'lab.scroll-bounded.F', color: '#000000', declared: 'open', frame: { x: 128, y: 3796, width: 825, height: 176 }, reached: false, probe: [], drawn: 0, seen: '#000000', geometry: 'off-screen', scrollView: 'lower', listed: { uiautomator: false } };
    const cell: CellTruth = { cell: 'scroll-bounded', layer: 'none', device: 'd', screen: { width: 1080, height: 2220 }, scale: 1, targets: [t] };
    expect(visibilityCases({ ...cell, targets: [{ ...t, listed: { idb: false, wda: true } }] }, 'ios').find((c) => c.id === 'turn:scroll-bounded.F')?.says).toMatch(/under idb F is not in the tree, so no turn is asked there/);
    expect(visibilityCases({ ...cell, targets: [{ ...t, listed: { wda: true } }] }, 'ios').find((c) => c.id === 'turn:scroll-bounded.F')?.says).toMatch(/^turn back: /);
    // On Android no turn is asked of any turn-back case (ADR 0021, 2026-10-18): judgeAndroidTurn, below.
    expect(visibilityCases(cell, 'android').find((c) => c.id === 'turn:scroll-bounded.F')?.says).toMatch(/^no turn on uiautomator \(ADR 0021\): .* fails loudly naming down after at most 2 unmoved strokes; under uiautomator F is not in the tree, so no turn is asked there, only an honest reply$/);
  });
});

describe('each rule names its class (what the live KNOWN pins)', () => {
  const launched = state();
  const c = { tag: 'T', view: 'page', fully: false, platform: 'ios' as const };
  it('the tap', () => {
    expect(judgeTap('T', true, 'Tapped', state({ events: [] }), launched).cls).toBe('tap-claim');
    expect(judgeTap('T', true, 'Tapped', state({ events: [{ kind: 'tap', tag: 'T', at }, { kind: 'tab', tag: 'x', at }] }), launched).cls).toBe('tap-claim');
    expect(judgeTap('T', false, 'ERROR', state({ events: [{ kind: 'dismissed', tag: 'x', at }] }), launched).cls).toBe('tap-refused-fired');
    expect(judgeTap('T', true, 'ERROR', state(), launched).cls).toBe('tap-refused');
  });
  it('the scroll', () => {
    expect(judgeScroll(c, ['Element id:"x" visible after 0 swipes', 'ERROR'], launched, launched).cls).toBe('stop-claim');
    expect(judgeScroll(c, ['ERROR failed after 2 swipes', 'ERROR'], state({ strokes: [stroke(382, 382), stroke(382, 382)] }), launched).cls).toBe('R-direction');
    const unchanged = 'ERROR failed after 2 swipes (the last 2, swiping down, did not change the screen: content exhausted)';
    expect(judgeScroll({ ...c, unlisted: true }, [unchanged, 'ERROR'], state({ strokes: [stroke(0, 400, 'upper'), stroke(400, 800, 'upper')] }), launched).cls).toBe('unchanged-claim');
    const shown = state({ frames: { T: { x: 51, y: 300, width: 300, height: 64 } }, offsets: { page: 80 }, strokes: [stroke(382, 80)] });
    expect(judgeScroll(c, ['ERROR failed after 1 swipe', 'ERROR'], shown, launched).cls).toBe('failed-holds');
    expect(judgeScroll(c, ['ERROR failed', 'ERROR'], launched, launched).cls).toBe('not-reached');
  });
  it('beneath a presented layer, and the dismissal', () => {
    const p = { tag: 'E', view: 'host', platform: 'ios' as const };
    expect(judgePresentedScroll(p, ['Element id:"x" visible after 2 swipes'], state(), state()).cls).toBe('presented-stop');
    // … and a stop claimed after the stroke dismissed the layer says so (LW1), still a presented-stop
    const closed = judgePresentedScroll(p, ['Element id:"x" fully visible after 1 swipe'], state({ events: [{ kind: 'dismissed', tag: 'sheet', at }] }), state());
    expect(closed).toMatchObject({ cls: 'presented-stop', why: expect.stringMatching(/ — the app logged dismissed sheet: averi closed the presented layer and claimed the stop$/) });
    expect(judgePresentedScroll(p, ['ERROR'], state({ events: [{ kind: 'dismissed', tag: 'sheet', at }] }), state()).cls).toBe('presented-fired');
    // … unless averi said its swipe changed the screen and claimed nothing (idb's sheet-background A, B since A5):
    // honest — LOUD, its own class, the dismissal named; neither a mismatch nor a stop
    const changed = 'ERROR scroll_until id:"lab.sheet-background.A" stopped after 1 swipe — the swipe CHANGED THE SCREEN: the one element … is not in the tree after it';
    expect(judgePresentedScroll(p, [changed], state({ events: [{ kind: 'dismissed', tag: 'sheet', at }] }), state())).toMatchObject({
      outcome: 'LOUD',
      cls: 'presented-changed',
      kind: 'refused',
      why: expect.stringMatching(/^the app logged dismissed sheet, and averi said its swipe changed the screen, claiming nothing — /),
    });
    expect(judgePresentedScroll({ tag: 'A', view: undefined, platform: 'ios' as const }, [changed], state({ events: [{ kind: 'touch', tag: '201,175', at }] }), state())).toMatchObject({ outcome: 'LOUD', cls: 'presented-changed' });
    // the words alone, not echoed in a selector, are the stop's
    expect(judgePresentedScroll(p, ['ERROR scroll_until id:"stopped after 1 swipe — the swipe CHANGED THE SCREEN: x" failed'], state({ events: [{ kind: 'dismissed', tag: 'sheet', at }] }), state()).cls).toBe('presented-fired');
    expect(judgePresentedScroll(p, ['ERROR'], state({ strokes: [stroke(200, 0, 'host')] }), state()).cls).toBe('presented-stroke');
    // a touch on the layer is no evidence against a target in a scroll view (the stroke may move the layer's own list) …
    const touch = state({ events: [{ kind: 'touch', tag: '540,1776', at }] });
    expect(judgePresentedScroll(p, ['ERROR'], touch, state()).outcome).toBe('ok');
    // … but over a target in none (L1's alert, its half sheet) any touch is a stroke on the layer
    const none = { tag: 'A', view: undefined, platform: 'android' as const };
    expect(judgePresentedScroll(none, ['ERROR'], touch, state())).toMatchObject({ outcome: 'MISMATCH', cls: 'presented-stroke', why: expect.stringMatching(/: 1 touch\(es\) at \(540,1776\) — averi: ERROR$/) });
    expect(judgePresentedScroll(none, ['ERROR close it first'], state(), state()).outcome).toBe('ok');
    // a colour assert beneath it: a pass measured the layer; a failure of any wording is ok unless something fired
    expect(judgePresentedAssert(['All 1 asserts passed'], state(), state())).toMatchObject({ outcome: 'MISMATCH', cls: 'presented-pass', kind: 'PASS' });
    expect(judgePresentedAssert(['0/1 asserts FAILED'], state({ events: [{ kind: 'dismissed', tag: 'sheet', at }] }), state()).cls).toBe('presented-fired');
    expect(judgePresentedAssert(['0/1 asserts FAILED'], state(), state())).toMatchObject({ outcome: 'ok', kind: 'FAIL' });
    expect(judgeDismissal('vs', 'Tapped', 'wda', state({ focus: null }), state({ focus: 'postcode' })).cls).toBe('dismissal');
    const field = (value: string) => ({ value, focused: false, error: null });
    const was = state({ focus: 'postcode', fields: { vs: field('') }, submits: [] });
    expect(judgeDismissal('vs', 'ERROR', 'wda', state({ focus: 'postcode', fields: { vs: field('x') }, submits: [] }), was).cls).toBe('dismissal');
    expect(judgeDismissal('vs', 'ERROR', 'wda', state({ focus: 'postcode', fields: { vs: field('') }, submits: [{ at, valid: true, values: {} }] }), was).cls).toBe('dismissal');
    expect(judgeDismissal('vs', 'ERROR covered', 'wda', was, was).cls).toBe('dismissal');
  });
});

// ADR 0021, the owner's decision of 2026-10-18: on uiautomator no turn — unmoved strokes there are no proof — and the
// two-stroke stop kept; the tool reports the direction, the agent turns. An Android turn-back case is ok when averi
// fails loudly naming the target's direction after at most UNMOVED_STROKES_EXHAUST (2) unmoved strokes, with no turn.
// The figures are the live record's (android-vis.json, turn:scroll-collapsing.A at e98b87e): A scrolled above the list
// (frame 127,-11, the list 0,220 1080x2000 at offset 715), 4 swipes down at 540,1820, the list 715 → 1984 → 2488.
describe('judgeAndroidTurn: no turn on uiautomator, a loud failure naming the way after the two-stroke stop', () => {
  const list = { x: 0, y: 220, width: 1080, height: 2000 };
  const android = (over: Partial<LabState>): LabState =>
    state({ screen: { x: 0, y: 0, width: 1080, height: 2220 }, scale: 1, safeArea: { top: 66, left: 0, bottom: 0, right: 0 }, scrollViews: { list }, ...over });
  const launched = android({ frames: { A: { x: 127, y: -11, width: 825, height: 176 } }, offsets: { list: 715 } });
  const touches = (n: number) => Array.from({ length: n }, () => ({ kind: 'touch' as const, tag: '540,1820', at }));
  const after = (strokes: Stroke[], n: number) =>
    android({ frames: { A: { x: 127, y: -1784, width: 825, height: 176 } }, offsets: { list: strokes.at(-1)?.to ?? 715 }, strokes, events: touches(n) });
  const away = [stroke(715, 1984, 'list'), stroke(1984, 2488, 'list')];
  const c = { tag: 'A', view: 'list', fully: false, platform: 'android' as const, turnTo: 'up' as const };
  const failed = (swipes: number, last: number, way = 'up') =>
    `ERROR scroll_until id:"lab.scroll-collapsing.A" failed after ${swipes} swipes (the last ${last}, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element was in the tree before the first swipe, clipped out above its scroll container, past the edge the swipes push it out through, never in the viewport, and is no longer in the tree (a lazy list drops what scrolls away) — scroll_until it with direction: "${way}"`;
  const TAP = 'ERROR Timed out after 5000ms waiting for element id:"lab.scroll-collapsing.A" to appear';

  it('the live measure: 4 swipes, the last 2 unmoved, no turn, `up` named — ok (judgeScroll alone: R-direction)', () => {
    const s = after(away, 4);
    expect(judgeScroll(c, [failed(4, 2), TAP], s, launched)).toMatchObject({ outcome: 'MISMATCH', cls: 'R-direction' });
    expect(judgeAndroidTurn(c, [failed(4, 2), TAP], s, launched, s)).toMatchObject({ outcome: 'ok', kind: 'refused', why: expect.stringMatching(/^no turn on uiautomator \(ADR 0021\): 4 swipes, the last 2 unmoved, failed naming direction: "up"/) });
  });

  it('more unmoved strokes than the two-stroke stop: not ok', () => {
    expect(judgeAndroidTurn(c, [failed(5, 3), TAP], after(away, 5), launched, after(away, 5)).outcome).toBe('MISMATCH');
  });

  it('the wrong direction named, or none: not ok', () => {
    expect(judgeAndroidTurn(c, [failed(4, 2, 'down'), TAP], after(away, 4), launched, after(away, 4)).outcome).toBe('MISMATCH');
    expect(judgeAndroidTurn(c, ['ERROR scroll_until failed after 4 swipes (the last 2, swiping down, did not change the screen) — element never appeared in the tree', TAP], after(away, 4), launched, after(away, 4)).outcome).not.toBe('ok');
  });

  it('a turn — a stroke that brought it closer — then a loud failure naming the way: not ok (no turn is the rule on uiautomator)', () => {
    const turned = [...away, stroke(2488, 1984, 'list')];
    const v = judgeAndroidTurn(c, [failed(4, 1), TAP], after(turned, 4), launched, after(turned, 4));
    expect(v.outcome).not.toBe('ok');
  });

  it('a claim the app\'s strokes contradict stays its own mismatch', () => {
    const moved = [...away, stroke(2488, 2600, 'list')];
    expect(judgeAndroidTurn(c, [failed(3, 2), TAP], after(moved, 3), launched, after(moved, 3))).toMatchObject({ outcome: 'MISMATCH', cls: 'unchanged-claim' });
  });

  it('the case on Android is judged so; on iOS it keeps the turn judge', () => {
    const t: TargetTruth = { tag: 'A', id: 'lab.scroll-collapsing.A', color: '#000000', declared: 'open', frame: { x: 127, y: -11, width: 825, height: 176 }, reached: false, probe: [], drawn: 0, seen: '#000000', geometry: 'outside-scroll-view', scrollView: 'list' };
    const cell: CellTruth = { cell: 'scroll-collapsing', layer: 'none', device: 'd', screen: { width: 1080, height: 2220 }, scale: 1, targets: [t] };
    const turn = visibilityCases(cell, 'android').find((x) => x.id === 'turn:scroll-collapsing.A')!;
    expect(turn.says).toMatch(/no turn on uiautomator/);
    expect(turn.judge(after(away, 4), [failed(4, 2), TAP], launched, 'uiautomator', [after(away, 4)])).toMatchObject({ outcome: 'ok' });
    const ios = visibilityCases(cell, 'ios').find((x) => x.id === 'turn:scroll-collapsing.A')!;
    expect(ios.says).toMatch(/^turn back: /);
    expect(ios.judge(after(away, 4), [failed(4, 2), TAP], launched, 'wda', [after(away, 4)])).toMatchObject({ outcome: 'MISMATCH', cls: 'R-direction' });
  });
});
