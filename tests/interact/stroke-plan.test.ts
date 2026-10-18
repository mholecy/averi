import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { everyNode, type Point, type Rect, type UiNode } from '../../src/adapters/types.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { MIN_STROKE_BOX, planProbe, planStroke, seeRead, startStrokes, strokeSent, touchedOn, TOUCH_DOWN_CUT_FLOOR, type StrokeMemory } from '../../src/interact/stroke-plan.js';
import { shortenStroke, swipeVector, swipeVectorAbove, type Direction } from '../../src/interact/swipe.js';
import { containsPoint, largestScroller } from '../../src/ui-tree/geometry.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { node } from '../helpers/fake.js';
import { stackedLayers } from '../helpers/stacked-layers.js';

/**
 * `scroll_until`'s stroke plan through its interface (interact/stroke-plan.ts, A1 of the round-21 architecture pass):
 * a read's facts and the course's direction in, the stroke as the driver sends it out — its scroll view, box, cover
 * and points — with the presented surface at its touch-down and the node a sent stroke touched down on. The tests
 * that until A1 drove swipe.ts's `strokeRoom` and `scrollStroke` (now stroke-plan.ts#strokeRoom, #scrollStroke) with
 * hand-made rects, and the single-read stroke decisions tests/interact/scroll-rounds.test.ts asked of a whole round,
 * are asked here of the plan; what spans reads and the course (a turn, a failed read, a remembered scroll view across
 * the round's own reads) stays the round's to test.
 */

/** The Pixel_3a's screen, the gesture box the tests stroke in. */
const BOX: Rect = { x: 0, y: 0, width: 1080, height: 2220 };
/** Settings' list, measured: [0,737][1080,2154]. */
const SETTINGS: Rect = { x: 0, y: 737, width: 1080, height: 1417 };
/** mp-native Account Detail's transaction list, CLIP, running under the floating tab bar to the screen's bottom. */
const LIST: Rect = { x: 0, y: 825, width: 1080, height: 1395 };
/** The bar's host, measured: 66,1840 948x248, drawn after the list. */
const BAR: Rect = { x: 66, y: 1840, width: 948, height: 248 };

/** A clipping scroll container (Android's dialect) at `rect`, holding `children`. */
const scroller = (rect: Rect, children: UiNode[] = []): UiNode => node({ role: 'container', rect: { ...rect }, clipsDescendants: true, children });
/** A node drawn over what lies before it in the tree, at `rect`. */
const cover = (rect: Rect, label = 'cover'): UiNode => node({ role: 'other', label, rect: { ...rect } });
/** A screen of `children` in draw order. */
const screenOf = (children: UiNode[], extra: Partial<UiNode> = {}): UiNode => node({ role: 'container', rect: { ...BOX }, ...extra, children });
/** A tree's facts as the round derives them (scroll-read.ts#TreeFacts): its scene and its largest scroller. */
const factsOf = (tree: UiNode) => ({ scene: sceneOf(tree), mainScroller: largestScroller(tree) });

/** The memory after one read of `tree`: its keyboard line at `keyboardTop`, and the target when it found one. */
const after = (tree: UiNode, { target, keyboardTop }: { target?: UiNode; keyboardTop?: number } = {}): StrokeMemory =>
  seeRead(startStrokes(), { facts: factsOf(tree), line: keyboardTop === undefined ? undefined : { y: keyboardTop, witnessed: true }, target });

/** The plan of one read of `tree` for a stroke `toward`, at `reach`, over `gesture`: the stroke as sent. */
function planOn(tree: UiNode, toward: Direction, opts: { target?: UiNode; keyboardTop?: number; reach?: number; gesture?: Rect } = {}) {
  return planStroke(after(tree, opts), { toward, reach: opts.reach ?? 1, gesture: opts.gesture ?? BOX, read: { facts: factsOf(tree), target: opts.target } });
}

/** The list alone, with `over` drawn after it — the screen's largest scroller, the target not read yet. */
const listUnder = (list: Rect, over: Rect[] = []): UiNode => screenOf([scroller(list), ...over.map((r) => cover(r))]);

describe('the points — the stroke the driver sends, made once by the plan', () => {
  it('over the screen box (no scroll view): the box\'s own stroke — swipeVector, swipeVectorAbove under a keyboard, shortenStroke at a reach', () => {
    const bare = screenOf([]);
    expect(planOn(bare, 'down').stroke).toEqual({ toward: 'down', reach: 1, box: BOX, points: swipeVector(BOX, 'down', 'content') });
    expect(planOn(bare, 'down', { keyboardTop: 1398 }).stroke).toEqual({ toward: 'down', reach: 1, coverTop: 1398, box: BOX, points: swipeVectorAbove(BOX, 1398, 'down', 'content') });
    expect(planOn(bare, 'down', { reach: 0.5 }).stroke.points).toEqual(shortenStroke(swipeVector(BOX, 'down', 'content'), 0.5, 2220));
  });

  it('over a scroll view\'s box: a content-up stroke touches down inside the list (1021), not on the header above it (444) — its length the list\'s', () => {
    expect(planOn(screenOf([]), 'up').stroke.points?.from.y).toBe(444);
    const settings = listUnder(SETTINGS);
    expect(planOn(settings, 'up').stroke).toEqual({ toward: 'up', reach: 1, box: SETTINGS, points: { from: { x: 540, y: 1021 }, to: { x: 540, y: 1871 } } });
    expect(planOn(settings, 'up', { reach: 0.25 }).stroke.points).toEqual({ from: { x: 540, y: 1021 }, to: { x: 540, y: 1234 } });
    expect(planOn(settings, 'down', { keyboardTop: 1398 }).stroke.points).toEqual(swipeVectorAbove(SETTINGS, 1398, 'down', 'content'));
  });

  it('no gesture box (swipe.ts#screenBox threw): no box and no points — the driver throws why — and no touch-down to ask about', () => {
    const plan = planStroke(startStrokes(), { toward: 'down', reach: 1, gesture: undefined, read: { facts: factsOf(listUnder(LIST)), target: undefined } });
    expect(plan.stroke).toEqual({ toward: 'down', reach: 1 });
    expect(plan.presented).toBeUndefined();
  });
});

describe('room — a box under MIN_STROKE_BOX along the stroke is no stroke box: 60 % of it is under twice TOUCH_SLOP', () => {
  it(`a 30-px strip has none (MIN_STROKE_BOX ${MIN_STROKE_BOX}): the stroke goes over the screen box; 80 px is enough; a sideways stroke has the strip's 1080`, () => {
    expect(MIN_STROKE_BOX).toBe(80);
    const strip: Rect = { x: 0, y: 1948, width: 1080, height: 30 };
    expect(planOn(listUnder(strip), 'down').stroke.box).toEqual(BOX);
    expect(planOn(listUnder({ ...strip, y: 1898, height: 80 }), 'down').stroke.box).toEqual({ ...strip, y: 1898, height: 80 });
    expect(planOn(listUnder(strip), 'left').stroke.box).toEqual(strip);
    // Above a keyboard, only the part above it counts: 50 px of this one.
    expect(planOn(listUnder({ x: 0, y: 1300, width: 1080, height: 600 }), 'down', { keyboardTop: 1350 }).stroke).toMatchObject({ box: BOX, coverTop: 1350 });
  });

  it('met with the gesture box: a scroll view reaching past the screen is stroked in what of it the screen shows; one off the screen has no room', () => {
    expect(planOn(listUnder({ x: 0, y: 242, width: 1080, height: 5000 }), 'down').stroke.box).toEqual({ x: 0, y: 242, width: 1080, height: 1978 });
    expect(planOn(listUnder(SETTINGS), 'down', { keyboardTop: 1398 }).stroke).toMatchObject({ box: SETTINGS, coverTop: 1398 }); // the box is the scroll view's; the stroke keeps clear of the cover
    expect(planOn(listUnder({ x: 0, y: 3000, width: 1080, height: 100 }), 'down').stroke.box).toEqual(BOX);
    expect(planOn(listUnder(SETTINGS), 'down', { keyboardTop: 700 }).stroke.box).toEqual(BOX);
  });

  it('the FIRST of the target\'s scroll views with room, nearest first: the list around a 30-px strip; a list running on under the IME from 58 px above it has room on the screen, none above the keyboard', () => {
    const row = node({ role: 'button', identifier: 'row', rect: { x: 66, y: 1950, width: 948, height: 20 } });
    const nested = screenOf([scroller({ x: 0, y: 242, width: 1080, height: 5000 }, [scroller({ x: 0, y: 1948, width: 1080, height: 30 }, [row])])]);
    expect(planOn(nested, 'down', { target: row }).stroke.box).toEqual({ x: 0, y: 242, width: 1080, height: 1978 });
    const under: Rect = { x: 0, y: 1340, width: 1080, height: 800 };
    const inner = node({ role: 'button', identifier: 'inner', rect: { x: 66, y: 1500, width: 948, height: 40 } });
    const underTree = screenOf([scroller(SETTINGS, [scroller(under, [inner])])]);
    expect(planOn(underTree, 'up', { target: inner }).stroke.box).toEqual(under);
    expect(planOn(underTree, 'up', { target: inner, keyboardTop: 1398 }).stroke).toMatchObject({ box: SETTINGS, coverTop: 1398 }); // the cover the stroke keeps clear of, with the box
  });
});

describe('a node drawn over the scroll view (docs/bugs/2026-10-09-android-scroll-stroke-touches-down-on-floating-tab-bar.md)', () => {
  it('measured: the list under the floating tab bar — a content-down stroke is cut above the bar\'s host and touches down at 1638, not at 1942 on the bar; the uncut stroke is the list\'s own', () => {
    const cut = planOn(listUnder(LIST, [BAR]), 'down').stroke;
    expect(cut).toEqual({ toward: 'down', reach: 1, coverTop: 1840, box: LIST, points: { from: { x: 540, y: 1638 }, to: { x: 540, y: 1028 } } });
    const uncut = planOn(listUnder(LIST), 'down').stroke.points;
    expect(uncut).toEqual({ from: { x: 540, y: 1942 }, to: { x: 540, y: 1104 } });
    expect(uncut !== undefined && containsPoint(BAR, uncut.from)).toBe(true);
    // The second measured shape: the page scrolled, the list 0,401 1080x1753, the bar still shown — the shim's 1857 was on the bar.
    expect(planOn(listUnder({ x: 0, y: 401, width: 1080, height: 1753 }, [BAR]), 'down').stroke.points?.from).toEqual({ x: 540, y: 1553 });
  });

  it('only a CONTENT-DOWN stroke is cut: a content-up one touches down at 0.2 of the list, above the bar, keeping its reach; a sideways one is not cut either', () => {
    expect(planOn(listUnder(LIST, [BAR]), 'up').stroke).toEqual({ toward: 'up', reach: 1, box: LIST, points: { from: { x: 540, y: 1104 }, to: { x: 540, y: 1942 } } });
    expect(planOn(listUnder(LIST, [BAR]), 'left').stroke.coverTop).toBeUndefined();
  });

  it('with a keyboard the higher of the two tops; a node off the stroke\'s line (a FAB) or in the upper half (a header) is not cut for; one below the gesture box cuts nothing; of several, the highest', () => {
    expect(planOn(listUnder(LIST, [BAR]), 'down', { keyboardTop: 1398 }).stroke.coverTop).toBe(1398);
    expect(planOn(listUnder(LIST, [BAR]), 'down', { keyboardTop: 2000 }).stroke.coverTop).toBe(1840);
    expect(planOn(listUnder(LIST, [{ x: 880, y: 1900, width: 160, height: 160 }]), 'down').stroke.coverTop).toBeUndefined();
    expect(planOn(listUnder(LIST, [{ x: 0, y: 825, width: 1080, height: 200 }]), 'down').stroke.coverTop).toBeUndefined();
    const low = planOn(listUnder(LIST, [BAR]), 'down', { gesture: { x: 0, y: 0, width: 1080, height: 1800 } }).stroke;
    expect([low.box, low.coverTop]).toEqual([{ ...LIST, height: 975 }, undefined]);
    expect(planOn(listUnder(LIST, [BAR, { x: 0, y: 1700, width: 1080, height: 100 }]), 'down').stroke.coverTop).toBe(1700);
  });

  it('the lower half the cut looks in is the box\'s ABOVE the keyboard (code review of fix/r4, P3): a bar sitting on the keyboard is cut for — until then the touch-down, 1206, was on the bar', () => {
    const onKeyboard = listUnder(LIST, [{ x: 0, y: 1150, width: 1080, height: 150 }]);
    const cut = planOn(onKeyboard, 'down', { keyboardTop: 1300 }).stroke;
    expect(cut).toMatchObject({ box: LIST, coverTop: 1150 });
    expect(cut.points?.from.y).toBeLessThan(1150);
    expect(planOn(listUnder(LIST), 'down', { keyboardTop: 1300 }).stroke.points?.from).toEqual({ x: 540, y: 1206 });
    // Without the keyboard the same bar lies in the list's upper half: not cut.
    expect(planOn(onKeyboard, 'down').stroke.coverTop).toBeUndefined();
  });

  it('a node over the TOUCH-DOWN is cut for wherever its top lies (D3): a short list under the measured bar — 1782, not 2086 on the host; all or nothing, never under a third of the box', () => {
    const SHORT: Rect = { x: 0, y: 1550, width: 1080, height: 670 };
    expect(planOn(listUnder(SHORT), 'down').stroke.points?.from).toEqual({ x: 540, y: 2086 });
    expect(planOn(listUnder(SHORT, [BAR]), 'down').stroke).toMatchObject({ box: SHORT, coverTop: 1840, points: { from: { x: 540, y: 1782 } } });
    // The cut moves the touch-down onto another node drawn over the list: cut above that one too, while a third of the box is left.
    expect(planOn(listUnder(SHORT, [BAR, { x: 0, y: 1780, width: 1080, height: 20 }]), 'down').stroke).toMatchObject({ coverTop: 1780, points: { from: { x: 540, y: 1734 } } });
    // All or nothing: the next cut would leave under a third — none is made, not the bar's alone, which still lands on the node.
    expect(planOn(listUnder(SHORT, [BAR, { x: 0, y: 1600, width: 1080, height: 200 }]), 'down').stroke.coverTop).toBeUndefined();
    // A node over most of the box (a sheet) is not cut for; nor a wrapper over the measured list from near its top (TOUCH_DOWN_CUT_FLOOR).
    expect(planOn(listUnder(SHORT, [{ x: 0, y: 1600, width: 1080, height: 620 }]), 'down').stroke.coverTop).toBeUndefined();
    expect(TOUCH_DOWN_CUT_FLOOR).toBe(1 / 3);
    expect(planOn(listUnder(LIST, [{ x: 0, y: 940, width: 1080, height: 1280 }]), 'down').stroke.coverTop).toBeUndefined();
    // …while the lower-half rule's cut stands under it.
    expect(planOn(listUnder(LIST, [BAR, { x: 0, y: 940, width: 1080, height: 1280 }]), 'down').stroke.coverTop).toBe(1840);
    // The floor is a third of the box ABOVE the keyboard: 215 of 573 is enough, though not of the whole 1395.
    expect(planOn(listUnder(LIST, [{ x: 0, y: 1040, width: 1080, height: 300 }]), 'down', { keyboardTop: 1398 }).stroke.coverTop).toBe(1040);
    // The HIGHEST node over the touch-down is judged: one from 300 over a 670-px box leaves 200, under the floor — uncut.
    expect(planOn(listUnder({ x: 0, y: 100, width: 1080, height: 670 }, [{ x: 0, y: 300, width: 1080, height: 600 }, { x: 0, y: 340, width: 1080, height: 400 }]), 'down').stroke.coverTop).toBeUndefined();
    // Off the touch-down (beside the line, or below the touch-down): no cut; and a content-up stroke never.
    expect(planOn(listUnder(SHORT, [{ x: 600, y: 1840, width: 480, height: 248 }]), 'down').stroke.coverTop).toBeUndefined();
    expect(planOn(listUnder(SHORT, [{ x: 0, y: 1600, width: 1080, height: 100 }]), 'down').stroke.coverTop).toBeUndefined();
    expect(planOn(listUnder(SHORT, [BAR]), 'up').stroke.coverTop).toBeUndefined();
  });

  it('the list\'s own rows are not drawn over it: a row in its lower half cuts nothing', () => {
    const row = node({ role: 'button', identifier: 'row', rect: { x: 66, y: 2150, width: 948, height: 73 } });
    expect(planOn(screenOf([scroller(LIST, [row])]), 'down', { target: row }).stroke).toEqual({ toward: 'down', reach: 1, box: LIST, points: { from: { x: 540, y: 1942 }, to: { x: 540, y: 1104 } } });
  });
});

describe('which scroll view — the target\'s own, nearest first; the screen\'s largest before the target is read; never a stranger', () => {
  it('before a read finds the target: the screen\'s largest scroller; a target found in NO scroll view: the screen box, not the largest scroller beside it (P5)', () => {
    expect(planOn(listUnder(LIST), 'down').stroke.box).toEqual(LIST);
    const loose = node({ role: 'button', identifier: 'row', rect: { x: 66, y: 2300, width: 948, height: 40 } });
    expect(planOn(screenOf([scroller(LIST), loose]), 'down', { target: loose }).stroke.box).toEqual(BOX);
  });

  it('WDA (no node clips; the scroll views are its scrolling ancestors): scroll-bounded\'s O below the bounded `lower` is stroked inside `lower`, not over the screen below it', () => {
    // Lab note LE4.
    const LOWER: Rect = { x: 0, y: 380, width: 402, height: 180 };
    const PHONE: Rect = { x: 0, y: 0, width: 402, height: 874 };
    const o = node({ role: 'button', identifier: 'O', rect: { x: 51, y: 620, width: 300, height: 64 } });
    const tree = node({
      role: 'container',
      unclippedFrames: true,
      rect: PHONE,
      children: [
        node({ role: 'scrollable', identifier: 'upper', rect: { x: 0, y: 110, width: 402, height: 220 }, children: [node({ role: 'button', identifier: 'W', rect: { x: 51, y: 130, width: 300, height: 64 } })] }),
        node({ role: 'scrollable', identifier: 'lower', rect: LOWER, children: [node({ role: 'button', identifier: 'S', rect: { x: 51, y: 400, width: 300, height: 64 } }), o] }),
      ],
    });
    const { stroke } = planOn(tree, 'down', { target: o, gesture: PHONE });
    expect(stroke.box).toEqual(LOWER);
    expect(stroke.points !== undefined && containsPoint(LOWER, stroke.points.from)).toBe(true);
  });

  it('WDA: a floating bar drawn over the scroll view cuts the stroke above it, as on Android', () => {
    const LIST_WDA: Rect = { x: 0, y: 300, width: 402, height: 574 };
    const TABS: Rect = { x: 37, y: 743, width: 328, height: 87 };
    const r = node({ role: 'button', identifier: 'R', rect: { x: 24, y: 1400, width: 354, height: 52 } });
    const tree = node({
      role: 'container',
      unclippedFrames: true,
      rect: { x: 0, y: 0, width: 402, height: 874 },
      children: [node({ role: 'scrollable', identifier: 'list', rect: LIST_WDA, children: [r] }), node({ role: 'tabbar', label: 'Tab Bar', rect: TABS, children: [node({ role: 'button', label: 'home', rect: { x: 37, y: 755, width: 82, height: 64 } })] })],
    });
    const { stroke } = planOn(tree, 'down', { target: r, gesture: { x: 0, y: 0, width: 402, height: 874 } });
    expect(stroke).toMatchObject({ box: LIST_WDA, coverTop: TABS.y });
    expect(stroke.points !== undefined && containsPoint(LIST_WDA, stroke.points.from) && !containsPoint(TABS, stroke.points.from)).toBe(true);
  });

});

/** The iPhone 17's screen, the gesture box of the WDA trees below. */
const PHONE: Rect = { x: 0, y: 0, width: 402, height: 874 };
/** A WDA scroll view (unclipped frames: its axis read from its content's extent past its frame) at `rect`. */
const wdaScroll = (rect: Rect, children: UiNode[], identifier: string | null = null): UiNode => node({ role: 'scrollable', identifier, rect: { ...rect }, children });
/** A WDA tree of `children` on the phone's screen. */
const wdaScreen = (children: UiNode[]): UiNode => node({ role: 'container', unclippedFrames: true, rect: { ...PHONE }, children });
/** A card of a carousel at `rect`, the next one laid out past its right edge (the carousel's content reaches past its frame across). */
const cards = (rect: Rect): UiNode[] => [node({ role: 'button', label: 'Card 1', rect: { ...rect } }), node({ role: 'button', label: 'Card 2', rect: { ...rect, x: rect.x + rect.width } })];
/** A vertical page holding `children`, its last row laid out below the screen (its content reaches past its frame down). */
const PAGE: Rect = { x: 0, y: 180, width: 402, height: 694 };
const ROW = (): UiNode => node({ role: 'button', identifier: 'row', rect: { x: 24, y: 1400, width: 354, height: 52 } });
/** Is `p` inside `r`, its edges included as the driver's points are whole units. */
const on = (r: Rect, p: Point | undefined): boolean => p !== undefined && containsPoint(r, p);

// LE4's residual, the cross-axis stroke (docs/bugs/2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md):
// the geometry is mp-native Account Detail's — its card carousel 24,138 354x85 (cards 354 wide, the next laid out past
// its right edge) and its transactions list 0,180 402x694 — the carousel moved into the list, as the note's `down`
// stroke would meet it on a page that scrolls under the cards (no lab cell holds one yet).
describe('the axis — a stroke goes over a scroll view that scrolls along it, and its path keeps off a nested one that scrolls only across it', () => {
  /** The carousel nested in the page, across the page's centre line, its top above the page's content-down touch-down (735). */
  const CAROUSEL: Rect = { x: 24, y: 700, width: 354, height: 85 };

  it('a row of a page holding a horizontal carousel, stroked for `down`: the page\'s stroke would touch down ON the carousel (201,735); drawn over the longest stretch of the page clear of it, above it — touch-down and lift-off both off the carousel', () => {
    const row = ROW();
    const tree = wdaScreen([wdaScroll(PAGE, [wdaScroll(CAROUSEL, cards(CAROUSEL)), row], 'page')]);
    expect(swipeVector(PAGE, 'down', 'content').from).toEqual({ x: 201, y: 735 });
    const { stroke } = planOn(tree, 'down', { target: row, gesture: PHONE });
    expect(stroke.box).toEqual({ ...PAGE, height: 700 - 180 });
    expect(stroke.points).toEqual({ from: { x: 201, y: 596 }, to: { x: 201, y: 284 } });
    expect(on(CAROUSEL, stroke.points?.from) || on(CAROUSEL, stroke.points?.to)).toBe(false);
  });

  it('a nested scroll view whose axis the tree cannot tell (its cards fit its frame: no content past it) is not kept off — the stroke is the page\'s as before', () => {
    const row = ROW();
    const tree = wdaScreen([wdaScroll(PAGE, [wdaScroll(CAROUSEL, [node({ role: 'button', rect: { ...CAROUSEL } })]), row])]);
    expect(planOn(tree, 'down', { target: row, gesture: PHONE }).stroke).toMatchObject({ box: PAGE, points: swipeVector(PAGE, 'down', 'content') });
  });

  it('a carousel the path does not cross is no cut: one at the page\'s top, above the content-down lift-off (319), leaves the page\'s whole stroke', () => {
    const row = ROW();
    const top: Rect = { ...CAROUSEL, y: 190 };
    const tree = wdaScreen([wdaScroll(PAGE, [wdaScroll(top, cards(top)), row])]);
    expect(planOn(tree, 'down', { target: row, gesture: PHONE }).stroke).toMatchObject({ box: PAGE, points: swipeVector(PAGE, 'down', 'content') });
  });

  it('no stretch clear of it with room (a full-width carousel across a short page, 50 px either side): the fallback — the stroke as before the rule, over the carousel', () => {
    const short: Rect = { x: 0, y: 180, width: 402, height: 200 };
    const wide: Rect = { x: 0, y: 230, width: 402, height: 100 };
    const row = node({ role: 'button', identifier: 'row', rect: { x: 24, y: 900, width: 354, height: 52 } });
    const tree = wdaScreen([wdaScroll(short, [wdaScroll(wide, cards(wide)), row])]);
    expect(planOn(tree, 'down', { target: row, gesture: PHONE }).stroke).toMatchObject({ box: short, points: swipeVector(short, 'down', 'content') });
  });

  it('a clear stretch the cut for what is drawn over it leaves without room (a bar over the stretch above a carousel filling the page below): judged as before the rule — the page\'s stroke, over the carousel — never the screen box', () => {
    const row = ROW();
    const low: Rect = { x: 0, y: 280, width: 402, height: 594 };
    const bar = node({ role: 'other', label: 'bar', rect: { x: 0, y: 240, width: 402, height: 30 } });
    const tree = wdaScreen([wdaScroll(PAGE, [wdaScroll(low, cards(low)), row]), bar]);
    const { stroke, memory } = planOn(tree, 'down', { target: row, gesture: PHONE });
    expect(stroke).toMatchObject({ box: PAGE, points: swipeVector(PAGE, 'down', 'content') });
    // The page is the scroll view the stroke went over: a touch-down on a node drawn over it is named.
    expect(touchedOn(strokeSent(memory), factsOf(tree), { from: { x: 201, y: 250 }, to: { x: 201, y: 200 } })?.container).toEqual(PAGE);
  });

  it('a card of that carousel, stroked for `down`: the carousel scrolls only across, so the stroke goes over the page — the outer scroll view — clear of the carousel', () => {
    const [first, card] = cards(CAROUSEL);
    const tree = wdaScreen([wdaScroll(PAGE, [wdaScroll(CAROUSEL, [first, card]), ROW()])]);
    const { stroke } = planOn(tree, 'down', { target: card, gesture: PHONE });
    expect(stroke.box).toEqual({ ...PAGE, height: 700 - 180 });
    expect(on(CAROUSEL, stroke.points?.from) || on(CAROUSEL, stroke.points?.to)).toBe(false);
  });

  it('the same card stroked for `right` (a card off the carousel\'s right edge): over the carousel, its own axis, along its centre row', () => {
    const [first, card] = cards(CAROUSEL);
    const tree = wdaScreen([wdaScroll(PAGE, [wdaScroll(CAROUSEL, [first, card]), ROW()])]);
    expect(planOn(tree, 'right', { target: card, gesture: PHONE }).stroke).toMatchObject({ box: CAROUSEL, points: swipeVector(CAROUSEL, 'right', 'content') });
  });

  it('a sideways stroke keeps off a nested VERTICAL list its line crosses: a pager\'s page holding a list over its left 250 — drawn over the stretch right of the list', () => {
    const PAGER: Rect = { x: 0, y: 100, width: 402, height: 700 };
    const list: Rect = { x: 0, y: 300, width: 250, height: 300 };
    const next = node({ role: 'other', label: 'Page 2', rect: { ...PAGER, x: 402 } });
    const tree = wdaScreen([wdaScroll(PAGER, [wdaScroll(list, [node({ role: 'button', rect: { x: 0, y: 300, width: 250, height: 900 } })]), next])]);
    const { stroke } = planOn(tree, 'right', { target: next, gesture: PHONE });
    expect(stroke.box).toEqual({ ...PAGER, x: 250, width: 152 });
    expect(stroke.points).toEqual({ from: { x: 372, y: 450 }, to: { x: 280, y: 450 } });
  });

  it('mp-native Account Detail as captured: the carousel is no child of the list — a card right of it, stroked for `down`, has no scroll view along the stroke, and the plan falls back to the nearest, the carousel, as before (the stated fallback); for `right`, the carousel', async () => {
    const tree = parseWdaSource(await readFile(new URL('../fixtures/wda-capture-account-detail-bar-shown.json', import.meta.url), 'utf8'));
    const card = [...everyNode(tree)].find((x) => x.identifier === 'accounts.detail.header' && x.rect.x === 378)!;
    const carousel: Rect = { x: 24, y: 138, width: 354, height: 85 };
    expect(planOn(tree, 'down', { target: card, gesture: PHONE }).stroke).toMatchObject({ box: carousel, points: { from: { x: 201, y: 207 } } });
    expect(planOn(tree, 'right', { target: card, gesture: PHONE }).stroke).toMatchObject({ box: carousel, points: swipeVector(carousel, 'right', 'content') });
  });

  it('Android: the class says the axis — a HorizontalScrollView under the list\'s touch-down is kept off; a lazy row (a View with the flag) is not', () => {
    const r = node({ role: 'button', identifier: 'row', rect: { x: 66, y: 2400, width: 948, height: 73 } });
    const strip: Rect = { x: 0, y: 1800, width: 1080, height: 300 };
    const list = (carousel: UiNode) => screenOf([node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'vertical', rect: { ...LIST }, children: [carousel, r] })]);
    const known = list(node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'horizontal', rect: { ...strip } }));
    expect(swipeVector(LIST, 'down', 'content').from.y).toBe(1942);
    expect(planOn(known, 'down', { target: r }).stroke.box).toEqual({ ...LIST, height: 1800 - 825 });
    const lazy = list(node({ role: 'container', clipsDescendants: true, rect: { ...strip } }));
    expect(planOn(lazy, 'down', { target: r }).stroke.box).toEqual(LIST);
  });

  it('a round whose tree did not read strokes in the lane the last plan judged', () => {
    const row = ROW();
    const tree = wdaScreen([wdaScroll(PAGE, [wdaScroll(CAROUSEL, cards(CAROUSEL)), row])]);
    const first = planOn(tree, 'down', { target: row, gesture: PHONE });
    expect(planStroke(strokeSent(first.memory), { toward: 'down', reach: 1, gesture: PHONE, read: undefined }).stroke).toEqual(first.stroke);
  });

  it('the probe never goes over a scroll view that scrolls only across it: flush with a carousel\'s bottom, over the page outward — the carousel alone is no room (unchecked), never a probe that moves nothing', () => {
    const tree = wdaScreen([wdaScroll(PAGE, [wdaScroll(CAROUSEL, cards(CAROUSEL)), ROW()])]);
    const probe = (scrollViews: Rect[]) => planProbe(startStrokes(), { toward: 'down', reach: 0.25, maxTravel: 177, gesture: PHONE, facts: factsOf(tree), scrollViews, keyboardTop: undefined });
    expect(probe([CAROUSEL])).toBeUndefined();
    expect(probe([CAROUSEL, PAGE])?.stroke.box).toEqual({ ...PAGE, height: 700 - 180 });
  });
});

describe('the memory — what a plan keeps for a round whose tree did not read, and for a read that lost the target', () => {
  const row = (y: number) => node({ role: 'button', identifier: 'row', rect: { x: 66, y, width: 948, height: 73 } });

  it('a round whose tree did not read strokes as the last plan did: its scroll views and the last read\'s keyboard line, judged again over that round\'s gesture box', () => {
    const r = row(2400);
    const tree = screenOf([scroller(LIST, [r]), cover(BAR)]);
    const first = planOn(tree, 'down', { target: r, keyboardTop: 1700 });
    expect(first.stroke).toMatchObject({ box: LIST, coverTop: 1700 });
    const blind = planStroke(strokeSent(first.memory), { toward: 'down', reach: 1, gesture: BOX, read: undefined });
    expect(blind.stroke).toEqual(first.stroke);
    expect(blind.presented).toBeUndefined();
  });

  it('a scroll view remembered from the read that found the target keeps its cut when a later read no longer holds a list of that rect (the page moved it, 0,825 → 0,401); the cut it keeps is the LATEST read that held the list', () => {
    const r = row(-300);
    const found = after(screenOf([scroller(LIST, [r]), cover(BAR)]), { target: r });
    const moved = factsOf(listUnder({ x: 0, y: 401, width: 1080, height: 1753 }, [BAR]));
    expect(planStroke(found, { toward: 'down', reach: 1, gesture: BOX, read: { facts: moved, target: undefined } }).stroke).toMatchObject({ box: LIST, coverTop: 1840 });
    const banner = planStroke(found, { toward: 'down', reach: 1, gesture: BOX, read: { facts: factsOf(listUnder(LIST, [{ x: 0, y: 1700, width: 1080, height: 100 }])), target: undefined } });
    expect(banner.stroke.coverTop).toBe(1700);
    for (const kept of [banner.memory, strokeSent(banner.memory)]) {
      expect(planStroke(kept, { toward: 'down', reach: 1, gesture: BOX, read: { facts: moved, target: undefined } }).stroke.coverTop).toBe(1700);
    }
  });
});

describe('touchedOn — the node drawn over the scroll view a SENT stroke touched down on', () => {
  const TITLE = node({ role: 'text', label: 'Account', identifier: 'account.title', rect: { x: 0, y: 1050, width: 1080, height: 100 } });
  const HEADER = node({ role: 'container', rect: { x: 0, y: 825, width: 1080, height: 400 }, children: [TITLE] });
  const tree = screenOf([scroller(LIST), HEADER]);

  it('a content-up stroke over the list touches down in a floating header (which the cut does not model): its node drawn on top is named, with the point and the list', () => {
    const plan = planOn(tree, 'up');
    expect(plan.stroke.points?.from).toEqual({ x: 540, y: 1104 });
    expect(touchedOn(strokeSent(plan.memory), factsOf(tree), plan.stroke.points)).toEqual({
      at: { x: 540, y: 1104 },
      on: { role: 'text', label: 'Account', identifier: 'account.title', rect: TITLE.rect },
      container: LIST,
    });
  });

  it('nothing for a stroke not sent (held — the memory as planned), for one over the screen box, or for no stroke drawn', () => {
    const plan = planOn(tree, 'up');
    expect(touchedOn(plan.memory, factsOf(tree), plan.stroke.points)).toBeUndefined();
    const bare = planOn(screenOf([HEADER]), 'up');
    expect(touchedOn(strokeSent(bare.memory), factsOf(screenOf([HEADER])), bare.stroke.points)).toBeUndefined();
    expect(touchedOn(strokeSent(plan.memory), factsOf(tree), undefined)).toBeUndefined();
  });
});

describe('planProbe — the fully: true flush check\'s probe, over a scroll view with room or not at all', () => {
  const STRIP: Rect = { x: 0, y: 1948, width: 1080, height: 30 };
  const probeOver = (tree: UiNode, scrollViews: Rect[], toward: Direction, keyboardTop?: number, maxTravel = 177) =>
    planProbe(startStrokes(), { toward, reach: 0.25, maxTravel, gesture: BOX, facts: factsOf(tree), scrollViews, keyboardTop });

  it('no scroll view with room (a lone 30-px strip): no probe — never the screen box; from the strip outward, the first with room', () => {
    const tree = screenOf([scroller(LIST, [scroller(STRIP)])]);
    expect(probeOver(tree, [STRIP], 'down')).toBeUndefined();
    expect(probeOver(tree, [STRIP, LIST], 'down')?.stroke).toMatchObject({ box: LIST, reach: 0.25, maxTravel: 177 });
  });

  it('room judged ABOVE the keyboard the probe keeps clear of: a list running on under the IME has room on the screen, none above it', () => {
    const under: Rect = { x: 0, y: 1340, width: 1080, height: 800 };
    const tree = screenOf([scroller(under)]);
    expect(probeOver(tree, [under], 'up')?.stroke.box).toEqual(under);
    expect(probeOver(tree, [under], 'up', 1398)).toBeUndefined();
  });

  it('the probe toward a bottom edge keeps clear of what is drawn over the list, by the same rule as every stroke', () => {
    const planned = probeOver(listUnder(LIST, [BAR]), [LIST], 'down');
    expect(planned?.stroke).toMatchObject({ toward: 'down', coverTop: 1840, box: LIST });
    expect(planned?.stroke.points?.from.y).toBeLessThan(1840);
  });

  it('maxTravel caps the finger\'s travel, the touch-down kept, never under the 3 %-of-side floor', () => {
    const list: Rect = { x: 0, y: 242, width: 1080, height: 1736 };
    expect(probeOver(listUnder(list), [list], 'up')?.stroke.points).toEqual({ from: { x: 540, y: 589 }, to: { x: 540, y: 766 } });
    expect(probeOver(listUnder(list), [list], 'up', undefined, 10)?.stroke.points?.to.y).toBe(589 + 52);
  });

  it('a sent probe is remembered as a stroke over its scroll view: a touch-down it made on a node drawn over the list is named', () => {
    const TITLE = node({ role: 'text', label: 'Account', rect: { x: 0, y: 1050, width: 1080, height: 100 } });
    const tree = screenOf([scroller(LIST), TITLE]);
    const planned = probeOver(tree, [LIST], 'up');
    expect(planned).toBeDefined();
    expect(touchedOn(strokeSent(planned!.memory), factsOf(tree), { from: { x: 540, y: 1100 }, to: { x: 540, y: 1300 } })?.on.label).toBe('Account');
  });
});

describe('the presented touch-down — asked of the scene at the points as sent', () => {
  it('Contacts\' discard popover, keyboard down: the stroke for the sheet\'s cell "add instant message" would touch down on the action sheet WDA types in the popover\'s layer — at the very point the driver would send', async () => {
    const tree = parseWdaSource(await readFile(new URL('../fixtures/wda-capture-contacts-discard-popover.json', import.meta.url), 'utf8'));
    const cell = [...everyNode(tree)].find((x) => x.role === 'container' && x.label === 'add instant message')!;
    const plan = planOn(tree, 'down', { target: cell, gesture: { x: 0, y: 0, width: 402, height: 874 } });
    expect(plan.presented?.touchDown).toEqual({ x: 201, y: 712 });
    expect(plan.presented?.touchDown).toEqual(plan.stroke.points?.from);
  });

  it('the SWIFT form under the Fees half sheet: the stroke for `payee_city_input` below the fold goes over the form\'s own scroll view and touches down at (201,329), on the sheet\'s dim — not at the screen box\'s (201,699)', async () => {
    const tree = (await stackedLayers()).swiftFeesSheet;
    const field = [...everyNode(tree)].find((x) => x.identifier === 'swift_payment.form.payee_city_input')!;
    const plan = planOn(tree, 'down', { target: field, gesture: { x: 0, y: 0, width: 402, height: 874 } });
    expect(plan.stroke.points?.from).toEqual({ x: 201, y: 329 });
    expect(plan.presented).toMatchObject({ touchDown: { x: 201, y: 329 } });
    // The scene is asked ONCE, at exactly the point the driver sends — not a point near it, not the screen box's.
    const scene = sceneOf(tree);
    const asked: Point[] = [];
    const recording = new Proxy(scene, {
      get: (target, key, receiver) =>
        key === 'presentedAt' ? (point: Point, on?: UiNode) => (asked.push({ ...point }), target.presentedAt(point, on)) : Reflect.get(target, key, receiver),
    });
    const facts = { scene: recording, mainScroller: largestScroller(tree) };
    const recorded = planStroke(seeRead(startStrokes(), { facts, line: undefined, target: field }), { toward: 'down', reach: 1, gesture: { x: 0, y: 0, width: 402, height: 874 }, read: { facts, target: field } });
    expect(asked).toEqual([recorded.stroke.points?.from]);
    expect(asked).toEqual([{ x: 201, y: 329 }]);
  });

  it('a row of the presented sheet itself, below the sheet\'s fold (the New Contact sheet\'s "add url"): its stroke touches down on its own screen\'s form — nothing presented there', async () => {
    const tree = (await stackedLayers()).contactsSheet;
    const cell = [...everyNode(tree)].find((x) => x.role === 'container' && x.label === 'add url')!;
    const plan = planOn(tree, 'down', { target: cell, gesture: { x: 0, y: 0, width: 402, height: 874 } });
    expect(plan.stroke.points).toBeDefined();
    expect(plan.presented).toBeUndefined();
  });
});
