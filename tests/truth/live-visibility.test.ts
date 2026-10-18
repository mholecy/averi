import { describe, expect, it } from 'vitest';
import { classStrokes, directionBreaks, distanceAt, judgeDismissal, judgePresentedScroll, unchangedClaimBroken, judgeScroll, judgeTap, showRegion, visibilityCases } from '../../scripts/truth/live-visibility.js';
import { stopHolds } from '../../scripts/truth/target-contract.js';
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
    for (const [k, e] of Object.entries(LIVE_KNOWN)) expect(`${k} ${e.cls}`).toMatch(/^(android|ios) \w+ (tap|scroll|turn):\S+ \S+$/);
  });
});

describe('the turn-back case of a target a source does not list', () => {
  it('is said to ask no turn under that source', () => {
    const t: TargetTruth = { tag: 'F', id: 'lab.scroll-bounded.F', color: '#000000', declared: 'open', frame: { x: 128, y: 3796, width: 825, height: 176 }, reached: false, probe: [], drawn: 0, seen: '#000000', geometry: 'off-screen', scrollView: 'lower', listed: { uiautomator: false } };
    const cell: CellTruth = { cell: 'scroll-bounded', layer: 'none', device: 'd', screen: { width: 1080, height: 2220 }, scale: 1, targets: [t] };
    expect(visibilityCases(cell, 'android').find((c) => c.id === 'turn:scroll-bounded.F')?.says).toMatch(/under uiautomator F is not in the tree, so no turn is asked there/);
    expect(visibilityCases({ ...cell, targets: [{ ...t, listed: { wda: true } }] }, 'ios').find((c) => c.id === 'turn:scroll-bounded.F')?.says).toMatch(/^turn back: /);
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
    expect(judgePresentedScroll(p, ['ERROR'], state({ events: [{ kind: 'dismissed', tag: 'sheet', at }] }), state()).cls).toBe('presented-fired');
    expect(judgePresentedScroll(p, ['ERROR'], state({ strokes: [stroke(200, 0, 'host')] }), state()).cls).toBe('presented-stroke');
    expect(judgeDismissal('vs', 'Tapped', 'wda', state({ focus: null }), state({ focus: 'postcode' })).cls).toBe('dismissal');
    const field = (value: string) => ({ value, focused: false, error: null });
    const was = state({ focus: 'postcode', fields: { vs: field('') }, submits: [] });
    expect(judgeDismissal('vs', 'ERROR', 'wda', state({ focus: 'postcode', fields: { vs: field('x') }, submits: [] }), was).cls).toBe('dismissal');
    expect(judgeDismissal('vs', 'ERROR', 'wda', state({ focus: 'postcode', fields: { vs: field('') }, submits: [{ at, valid: true, values: {} }] }), was).cls).toBe('dismissal');
    expect(judgeDismissal('vs', 'ERROR covered', 'wda', was, was).cls).toBe('dismissal');
  });
});
