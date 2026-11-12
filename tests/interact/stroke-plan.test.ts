import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { everyNode, type Point, type Rect, type UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { MIN_STROKE_BOX, nameScrollView, planProbe, planStroke, seeRead, startStrokes, strokedAcross, strokedBeside, strokeSent, touchedOn, TOUCH_DOWN_CUT_FLOOR, type StrokeMemory } from '../../src/interact/stroke-plan.js';
import { shortenStroke, swipeVector, swipeVectorAbove, type Direction } from '../../src/interact/swipe.js';
import { containsPoint, largestScroller } from '../../src/ui-tree/geometry.js';
import { keyboardSideNodes } from '../../src/ui-tree/soft-keyboard.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { parseDump } from '../helpers/android-dumps.js';
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
const factsOf = (tree: UiNode) => ({ tree, scene: sceneOf(tree), mainScroller: largestScroller(tree), reading: { ofKeyboard: (n: UiNode) => keyboardSideNodes(tree).has(n) } });

/** The memory after one read of `tree`: its keyboard line at `keyboardTop`, and the target when it found one. */
const after = (tree: UiNode, { target, keyboardTop }: { target?: UiNode; keyboardTop?: number } = {}): StrokeMemory =>
  seeRead(startStrokes(), { facts: factsOf(tree), line: keyboardTop === undefined ? undefined : { y: keyboardTop, witnessed: true }, target });

/** The plan of one read of `tree` for a stroke `toward`, at `reach`, over `gesture`: the stroke as sent. */
function planOn(tree: UiNode, toward: Direction, opts: { target?: UiNode; keyboardTop?: number; reach?: number; gesture?: Rect } = {}) {
  return planStroke(after(tree, opts), { kind: 'full', toward, reach: opts.reach ?? 1, gesture: opts.gesture ?? BOX, read: { facts: factsOf(tree), target: opts.target } });
}

/** The list alone, with `over` drawn after it — the screen's largest scroller, the target not read yet. */
const listUnder = (list: Rect, over: Rect[] = []): UiNode => screenOf([scroller(list), ...over.map((r) => cover(r))]);

describe('the points — the stroke the driver sends, made once by the plan', () => {
  it('over the screen box (no scroll view): the box\'s own stroke — swipeVector, swipeVectorAbove under a keyboard, shortenStroke at a reach', () => {
    const bare = screenOf([]);
    expect(planOn(bare, 'down').stroke).toEqual({ kind: 'full', toward: 'down', reach: 1, box: BOX, points: swipeVector(BOX, 'down', 'content') });
    expect(planOn(bare, 'down', { keyboardTop: 1398 }).stroke).toEqual({ kind: 'full', toward: 'down', reach: 1, coverTop: 1398, box: BOX, points: swipeVectorAbove(BOX, 1398, 'down', 'content') });
    expect(planOn(bare, 'down', { reach: 0.5 }).stroke.points).toEqual(shortenStroke(swipeVector(BOX, 'down', 'content'), 0.5, 2220));
  });

  it('over a scroll view\'s box: a content-up stroke touches down inside the list (1021), not on the header above it (444) — its length the list\'s', () => {
    expect(planOn(screenOf([]), 'up').stroke.points?.from.y).toBe(444);
    const settings = listUnder(SETTINGS);
    expect(planOn(settings, 'up').stroke).toEqual({ kind: 'full', toward: 'up', reach: 1, box: SETTINGS, points: { from: { x: 540, y: 1021 }, to: { x: 540, y: 1871 } } });
    expect(planOn(settings, 'up', { reach: 0.25 }).stroke.points).toEqual({ from: { x: 540, y: 1021 }, to: { x: 540, y: 1234 } });
    expect(planOn(settings, 'down', { keyboardTop: 1398 }).stroke.points).toEqual(swipeVectorAbove(SETTINGS, 1398, 'down', 'content'));
  });

  it('no gesture box (swipe.ts#screenBox threw): no box and no points — the driver throws why — and no touch-down to ask about', () => {
    const plan = planStroke(startStrokes(), { kind: 'full', toward: 'down', reach: 1, gesture: undefined, read: { facts: factsOf(listUnder(LIST)), target: undefined } });
    expect(plan.stroke).toEqual({ kind: 'full', toward: 'down', reach: 1 });
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
    expect(cut).toEqual({ kind: 'full', toward: 'down', reach: 1, coverTop: 1840, box: LIST, points: { from: { x: 540, y: 1638 }, to: { x: 540, y: 1028 } } });
    const uncut = planOn(listUnder(LIST), 'down').stroke.points;
    expect(uncut).toEqual({ from: { x: 540, y: 1942 }, to: { x: 540, y: 1104 } });
    expect(uncut !== undefined && containsPoint(BAR, uncut.from)).toBe(true);
    // The second measured shape: the page scrolled, the list 0,401 1080x1753, the bar still shown — the shim's 1857 was on the bar.
    expect(planOn(listUnder({ x: 0, y: 401, width: 1080, height: 1753 }, [BAR]), 'down').stroke.points?.from).toEqual({ x: 540, y: 1553 });
  });

  it('only a CONTENT-DOWN stroke is cut: a content-up one touches down at 0.2 of the list, above the bar, keeping its reach; a sideways one is not cut either', () => {
    expect(planOn(listUnder(LIST, [BAR]), 'up').stroke).toEqual({ kind: 'full', toward: 'up', reach: 1, box: LIST, points: { from: { x: 540, y: 1104 }, to: { x: 540, y: 1942 } } });
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
    expect(planOn(screenOf([scroller(LIST, [row])]), 'down', { target: row }).stroke).toEqual({ kind: 'full', toward: 'down', reach: 1, box: LIST, points: { from: { x: 540, y: 1942 }, to: { x: 540, y: 1104 } } });
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

  it('the LONGEST clear stretch, not the first: a carousel high on the page (300–385) leaves 120 above it and 489 below — the stroke is drawn below', () => {
    const row = ROW();
    const high: Rect = { ...CAROUSEL, y: 300 };
    const tree = wdaScreen([wdaScroll(PAGE, [wdaScroll(high, cards(high)), row])]);
    const { stroke } = planOn(tree, 'down', { target: row, gesture: PHONE });
    expect(stroke.box).toEqual({ ...PAGE, y: 385, height: 874 - 385 });
    expect(on(high, stroke.points?.from) || on(high, stroke.points?.to)).toBe(false);
  });

  it('the stretch ends at the keyboard: a carousel at 400–485 under a keyboard at 700 leaves 220 above it and 215 between it and the keyboard (389 to the page\'s bottom, which the keyboard covers) — the stroke is drawn above it, clear of the keyboard', () => {
    const row = ROW();
    const mid: Rect = { ...CAROUSEL, y: 400 };
    const tree = wdaScreen([wdaScroll(PAGE, [wdaScroll(mid, cards(mid)), row])]);
    const { stroke } = planOn(tree, 'down', { target: row, gesture: PHONE, keyboardTop: 700 });
    expect(stroke).toMatchObject({ box: { ...PAGE, height: 400 - 180 }, coverTop: 700 });
    expect(on(mid, stroke.points?.from) || on(mid, stroke.points?.to)).toBe(false);
    expect(Math.max(stroke.points!.from.y, stroke.points!.to.y)).toBeLessThan(400);
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
    expect(planStroke(strokeSent(first.memory), { kind: 'full', toward: 'down', reach: 1, gesture: PHONE, read: undefined }).stroke).toEqual(first.stroke);
  });

  it('the probe never goes over a scroll view that scrolls only across it: flush with a carousel\'s bottom, over the page outward — the carousel alone is no room (unchecked), never a probe that moves nothing', () => {
    const tree = wdaScreen([wdaScroll(PAGE, [wdaScroll(CAROUSEL, cards(CAROUSEL)), ROW()])]);
    const probe = (scrollViews: Rect[]) => planProbe(startStrokes(), { toward: 'down', reach: 0.25, maxTravel: 177, gesture: PHONE, facts: factsOf(tree), scrollViews, keyboardTop: undefined });
    expect(probe([CAROUSEL])).toBeUndefined();
    expect(probe([CAROUSEL, PAGE])?.stroke.box).toEqual({ ...PAGE, height: 700 - 180 });
  });
});

// D59b (batch-11, the averi_lab emulator): scroll_until right for the card C of a carousel nested in a vertical page,
// from a fresh launch — C not laid out, so no read finds it. Every stroke went over the page's centre row,
// (864,1110)→(216,1110), 496 px below the carousel's band (y 380–614), and moved nothing; a raw stroke in the band moved
// it. The trees are DERIVED from the committed capture (the fixture headers say how; the batches kept no dump).
describe('before a read finds the target, a sideways stroke goes inside a nested scroll view when the page scrolls across it (D59b)', () => {
  const PAGE: Rect = { x: 0, y: 0, width: 1080, height: 2220 };
  const CAROUSEL: Rect = { x: 66, y: 380, width: 948, height: 234 };
  const derived = (name: string): UiNode => parseDump(readFileSync(new URL(`../fixtures/uiautomator-lab-carousel-${name}-launch.xml`, import.meta.url), 'utf8'));
  const lazy = derived('lazy-free');
  const recycler = derived('recycler-free');
  /** batch-11's d59b-measure records, trimmed (tests/fixtures/d59b-b11-strokes.json). */
  const b11 = JSON.parse(readFileSync(new URL('../fixtures/d59b-b11-strokes.json', import.meta.url), 'utf8')) as {
    records: { leg: string; clip: Rect; swipes?: { from: Point; to: Point }[]; stroke?: { from: Point; to: Point } }[];
  };
  const inBand = (p: Point): boolean => p.y >= CAROUSEL.y && p.y < CAROUSEL.y + CAROUSEL.height;
  /** A vertical page (a ScrollView: its class tells the axis) at PAGE holding `children`. */
  const page = (...children: UiNode[]): UiNode => screenOf([node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'vertical', rect: { ...PAGE }, children })]);
  const unknown = (rect: Rect): UiNode => node({ role: 'other', clipsDescendants: true, rect: { ...rect } });

  it('the derived lab trees read as batch-10 read the device: the page told vertical, the carousel nested in it of no told axis — the largest scroller the page', () => {
    for (const tree of [lazy, recycler]) {
      expect(largestScroller(tree)).toEqual(PAGE);
      expect(sceneOf(tree).clips.axesOf(PAGE)).toEqual({ axis: 'vertical', nested: [{ rect: CAROUSEL, axis: undefined }] });
    }
  });

  it('lazy-free, `right`: inside the carousel, (824,497)→(256,497) on its centre row — not the page\'s centre row, (864,1110)→(216,1110), where every batch-11 stroke lay', () => {
    const averi = b11.records.filter((r) => r.leg === 'averi');
    expect(averi).toHaveLength(6);
    for (const r of averi) {
      expect(r.clip).toEqual(CAROUSEL);
      for (const { from, to } of r.swipes!) expect({ from, to }).toEqual(swipeVector(PAGE, 'right', 'content'));
      for (const s of r.swipes!) expect(inBand(s.from) || inBand(s.to)).toBe(false);
    }
    // The control's raw stroke in the band moved the carousel every time.
    for (const r of b11.records.filter((x) => x.leg === 'control')) expect(inBand(r.stroke!.from) && inBand(r.stroke!.to)).toBe(true);
    const { stroke } = planOn(lazy, 'right');
    expect(stroke).toEqual({ kind: 'full', toward: 'right', reach: 1, box: CAROUSEL, points: { from: { x: 824, y: 497 }, to: { x: 256, y: 497 } } });
    expect(inBand(stroke.points!.from) && inBand(stroke.points!.to)).toBe(true);
  });

  it('recycler-free, `right` and `left`: inside the carousel too', () => {
    expect(planOn(recycler, 'right').stroke).toMatchObject({ box: CAROUSEL, points: swipeVector(CAROUSEL, 'right', 'content') });
    expect(planOn(recycler, 'left').stroke).toMatchObject({ box: CAROUSEL, points: swipeVector(CAROUSEL, 'left', 'content') });
  });

  it('unchanged: `down` and `up` over the same trees stroke the page as before — the page first, along its axis', () => {
    for (const tree of [lazy, recycler]) {
      for (const toward of ['down', 'up'] as const) expect(planOn(tree, toward).stroke).toMatchObject({ box: PAGE, points: swipeVector(PAGE, toward, 'content') });
    }
  });

  it('a nested carousel told horizontal (a HorizontalScrollView), C absent: inside it, along its axis', () => {
    const tree = page(node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'horizontal', rect: { ...CAROUSEL } }));
    expect(planOn(tree, 'right').stroke).toMatchObject({ box: CAROUSEL, points: swipeVector(CAROUSEL, 'right', 'content') });
  });

  it('no nested scroll view along the stroke or of unknown axis — only a told-vertical list, or none: the page, the fallback as today', () => {
    const list: Rect = { x: 0, y: 800, width: 1080, height: 900 };
    expect(planOn(page(node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'vertical', rect: { ...list } })), 'right').stroke).toMatchObject({ box: PAGE, points: swipeVector(PAGE, 'right', 'content') });
    expect(planOn(page(), 'right').stroke).toMatchObject({ box: PAGE, points: swipeVector(PAGE, 'right', 'content') });
  });

  it('a page of no told axis is stroked whole, as before — first, and along (unknown is not across)', () => {
    const tree = screenOf([scroller(PAGE, [unknown(CAROUSEL)])]);
    expect(planOn(tree, 'right').stroke).toMatchObject({ box: PAGE, points: swipeVector(PAGE, 'right', 'content') });
  });

  it('a nested one TOLD along the stroke outranks a larger one of unknown axis (review round 1): a chips row (a HorizontalScrollView) above a feed (a RecyclerView) — the chips row', () => {
    const chips: Rect = { x: 0, y: 200, width: 1080, height: 150 };
    const feed: Rect = { x: 0, y: 400, width: 1080, height: 1800 };
    const tree = page(node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'horizontal', rect: { ...chips } }), node({ role: 'scrollable', clipsDescendants: true, rect: { ...feed } }));
    expect(planOn(tree, 'right').stroke.box).toEqual(chips);
  });

  it('two nested of unknown axis: the larger first; one off the gesture box is passed for the next', () => {
    const small: Rect = { x: 66, y: 1200, width: 948, height: 150 };
    expect(planOn(page(unknown(small), unknown(CAROUSEL)), 'right').stroke.box).toEqual(CAROUSEL);
    expect(planOn(page(unknown(CAROUSEL), unknown(small)), 'right').stroke.box).toEqual(CAROUSEL);
    const gesture: Rect = { x: 0, y: 1000, width: 1080, height: 1220 };
    expect(planOn(page(unknown(CAROUSEL), unknown(small)), 'right', { gesture }).stroke.box).toEqual(small);
  });

  it('a form page whose only nested "scroll view" is a Compose text field (role textfield, it clips): never chosen — the page, as today', () => {
    const field = node({ role: 'textfield', identifier: 'username', clipsDescendants: true, rect: { x: 66, y: 600, width: 948, height: 160 } });
    expect(planOn(page(field), 'right').stroke).toMatchObject({ box: PAGE, points: swipeVector(PAGE, 'right', 'content') });
  });

  it('the same rule the other way: a horizontal page (a pager) holding a list of unknown axis, stroked for `down` — inside the list, cut above a bar drawn over it as any stroke', () => {
    const pager = (...children: UiNode[]): UiNode => node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'horizontal', rect: { ...PAGE }, children });
    const list: Rect = { x: 0, y: 400, width: 1080, height: 1500 };
    const bar: Rect = { x: 0, y: 1700, width: 1080, height: 150 };
    expect(planOn(screenOf([pager(unknown(list)), cover(bar)]), 'down').stroke).toMatchObject({ box: list, coverTop: 1700 });
  });

  it('inside the nested scroll view taken, its own nested ones are kept off as in any candidate: a vertical list over the carousel\'s left part — the stroke right of it', () => {
    const inner: Rect = { x: 66, y: 380, width: 334, height: 234 };
    const carousel = node({ role: 'other', clipsDescendants: true, rect: { ...CAROUSEL }, children: [node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'vertical', rect: { ...inner } })] });
    expect(planOn(page(carousel), 'right').stroke.box).toEqual({ ...CAROUSEL, x: 400, width: 614 });
  });

  it('iOS unchanged: WDA marks no node clipping, so no largest scroller — the screen box, as before; idb\'s flat list the same', async () => {
    const wda = parseWdaSource(await readFile(new URL('../fixtures/wda-capture-lab-carousel-in-list.json', import.meta.url), 'utf8'));
    expect(largestScroller(wda)).toBeUndefined();
    expect(planOn(wda, 'right', { gesture: PHONE }).stroke).toMatchObject({ box: PHONE, points: swipeVector(PHONE, 'right', 'content') });
    const flat = node({ role: 'container', flatList: true, rect: { x: 0, y: 0, width: 0, height: 0 }, children: [node({ role: 'other', rect: { ...PHONE } })] });
    expect(planOn(flat, 'right', { gesture: PHONE }).stroke).toMatchObject({ box: PHONE, points: swipeVector(PHONE, 'right', 'content') });
  });

  it('strokedAcross: the page a SENT stroke went over when its told axis is across the stroke; nothing along it, of unknown axis, over the screen box, or not sent', () => {
    const bare = page();
    const sent = strokeSent(planOn(bare, 'right').memory);
    expect(strokedAcross(sent, factsOf(bare), 'right', BOX)).toEqual({ rect: PAGE, axis: 'vertical' });
    expect(strokedAcross(sent, factsOf(bare), 'down', BOX)).toBeUndefined();
    expect(strokedAcross(planOn(bare, 'right').memory, factsOf(bare), 'right', BOX)).toBeUndefined();
    expect(strokedAcross(strokeSent(planOn(lazy, 'right').memory), factsOf(lazy), 'right', BOX)).toBeUndefined();
    const none = screenOf([]);
    expect(strokedAcross(strokeSent(planOn(none, 'right').memory), factsOf(none), 'right', BOX)).toBeUndefined();
  });

  it('strokedAcross asks the WHOLE tree for a scroll view told along the stroke (review round 1): a chips row beside the page, never a candidate, is named — the swipes did not go over it', () => {
    const chips = node({ role: 'scrollable', identifier: 'feed.chips', clipsDescendants: true, scrollAxis: 'horizontal', rect: { x: 0, y: 2000, width: 1080, height: 150 } });
    const small = node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'horizontal', rect: { x: 0, y: 2160, width: 500, height: 60 } });
    const tree = screenOf([node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'vertical', rect: { ...PAGE } }), small, chips]);
    const sent = strokeSent(planOn(tree, 'right').memory);
    expect(strokedAcross(sent, factsOf(tree), 'right', BOX)).toEqual({ rect: PAGE, axis: 'vertical', along: { view: { role: 'scrollable', label: null, identifier: 'feed.chips', rect: chips.rect } } });
  });

  it('…but only one that meets the usable screen (review round 2): a chips row below the screen is not named; on a screen tall enough to show it, it is', () => {
    const below = node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'horizontal', rect: { x: 0, y: 2300, width: 1080, height: 150 } });
    const tree = screenOf([node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'vertical', rect: { ...PAGE } }), below]);
    const sent = strokeSent(planOn(tree, 'right').memory);
    expect(strokedAcross(sent, factsOf(tree), 'right', BOX)).toEqual({ rect: PAGE, axis: 'vertical' });
    expect(strokedAcross(sent, factsOf(tree), 'right', { ...BOX, height: 2400 })?.along?.view.rect).toEqual(below.rect);
  });

  it('…nor the keyboard\'s own scroll view (WDA: its suggestion strip under the keyboard\'s band), as the reading marks the keyboard\'s own (UiNode.ofKeyboard, soft-keyboard.ts#keyboardSideNodes)', () => {
    const row = node({ role: 'button', identifier: 'row', rect: { x: 24, y: 300, width: 354, height: 52 } });
    const page = wdaScroll({ x: 0, y: 100, width: 402, height: 400 }, [row, node({ role: 'other', rect: { x: 24, y: 450, width: 354, height: 400 } })]);
    const strip: Rect = { x: 0, y: 560, width: 402, height: 44 };
    const suggestions = wdaScroll(strip, cards({ x: 0, y: 560, width: 300, height: 44 }));
    const keyboard = node({ role: 'keyboard', ofKeyboard: true, rect: { x: 0, y: 560, width: 402, height: 314 }, children: [suggestions] });
    const tree = wdaScreen([page, keyboard]);
    const sent = strokeSent(planOn(tree, 'right', { target: row, gesture: PHONE }).memory);
    expect(strokedAcross(sent, factsOf(tree), 'right', PHONE)).toEqual({ rect: page.rect, axis: 'vertical' });
    // The same strip outside the keyboard is named.
    const loose = wdaScreen([page, wdaScroll(strip, cards({ x: 0, y: 560, width: 300, height: 44 }))]);
    expect(strokedAcross(strokeSent(planOn(loose, 'right', { target: row, gesture: PHONE }).memory), factsOf(loose), 'right', PHONE)?.along?.view.rect).toEqual(strip);
  });

  it('…said to be named once a read found the target (`targetRead`, D78): its own scroll views were the candidates, so a `within` naming the one along would be ignored', () => {
    const row = node({ role: 'button', identifier: 'row', rect: { x: 0, y: 300, width: 1080, height: 100 } });
    const chips = node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'horizontal', rect: { x: 0, y: 2000, width: 1080, height: 150 } });
    const tree = screenOf([node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'vertical', rect: { ...PAGE }, children: [row] }), chips]);
    const view = { role: 'scrollable', label: null, identifier: null, rect: chips.rect };
    expect(strokedAcross(strokeSent(planOn(tree, 'right', { target: row }).memory), factsOf(tree), 'right', BOX)?.along).toEqual({ view, targetRead: true });
    expect(strokedAcross(strokeSent(planOn(tree, 'right').memory), factsOf(tree), 'right', BOX)?.along).toEqual({ view });
  });

  it('…and one that WAS a candidate along the stroke but had no room (a 60-px-wide strip nested in the page) is named with that', () => {
    const strip = node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'horizontal', rect: { x: 0, y: 900, width: 60, height: 200 } });
    const tree = page(strip);
    const sent = strokeSent(planOn(tree, 'right').memory);
    expect(strokedAcross(sent, factsOf(tree), 'right', BOX)).toEqual({ rect: PAGE, axis: 'vertical', along: { view: { role: 'scrollable', label: null, identifier: null, rect: strip.rect }, noRoom: true } });
  });
});

describe('strokedBeside — the listed scroll views along the stroke the swipes did not go over, before a read found the target (D76)', () => {
  /** android scroll-bounded's two vertical lists, as uiautomator dumps them: `upper` the larger, `lower` below it. */
  const UPPER: Rect = { x: 0, y: 303, width: 1080, height: 605 };
  const LOWER: Rect = { x: 0, y: 1046, width: 1080, height: 495 };
  const list = (rect: Rect, extra: Partial<UiNode> = {}): UiNode => node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'vertical', rect: { ...rect }, ...extra });
  const bounded = (...more: UiNode[]): UiNode => screenOf([list(UPPER), list(LOWER, { identifier: 'lower' }), ...more]);
  /** One stroke `toward` planned and sent over `tree`'s read: its memory and the points as drawn. */
  const sentOn = (tree: UiNode, toward: Direction, target?: UiNode) => {
    const plan = planOn(tree, toward, { target });
    return { memory: strokeSent(plan.memory), drawn: plan.stroke.points };
  };

  it('names the sibling list the strokes never went over: they went over the largest, `upper`', () => {
    const tree = bounded();
    const { memory, drawn } = sentOn(tree, 'down');
    expect(drawn !== undefined && containsPoint(UPPER, drawn.from)).toBe(true);
    expect(strokedBeside(memory, factsOf(tree), 'down', BOX)).toEqual({ axis: 'vertical', strokedOver: UPPER, others: [{ role: 'scrollable', label: null, identifier: 'lower', rect: LOWER }] });
    // No other list along the stroke: nothing to name.
    const alone = screenOf([list(UPPER)]);
    const one = sentOn(alone, 'down');
    expect(strokedBeside(one.memory, factsOf(alone), 'down', BOX)).toBeUndefined();
  });

  it('leaves out the one holding the last touch-down: over the screen box (no list clips: WDA\'s dialect) the list the finger landed in is not named, the other is', () => {
    const loose = (rect: Rect, identifier: string): UiNode => node({ role: 'scrollable', identifier, scrollAxis: 'vertical', rect: { ...rect } });
    const tree = screenOf([loose(UPPER, 'upper'), loose({ x: 0, y: 1300, width: 1080, height: 495 }, 'lower')]);
    const { memory, drawn } = sentOn(tree, 'up');
    expect(drawn !== undefined && containsPoint(UPPER, drawn.from)).toBe(true);
    // Over the screen box the touch-down is said, and the list it lies in (review round 1).
    expect(strokedBeside(memory, factsOf(tree), 'up', BOX)).toEqual({ axis: 'vertical', at: drawn?.from, landed: UPPER, others: [{ role: 'scrollable', label: null, identifier: 'lower', rect: { x: 0, y: 1300, width: 1080, height: 495 } }] });
    // No stroke sent yet (the plan held): no touch-down to leave out or to say.
    const held = planOn(tree, 'up').memory;
    expect(strokedBeside(held, factsOf(tree), 'up', BOX)?.others.map((o) => o.identifier)).toEqual(['upper', 'lower']);
    expect(strokedBeside(held, factsOf(tree), 'up', BOX)).not.toHaveProperty('at');
    // After a turn the touch-down said is the LAST stroke's (the content-down one, low on the screen), each one's list left out.
    const three = screenOf([loose(UPPER, 'upper'), loose({ x: 0, y: 1300, width: 1080, height: 300 }, 'mid'), loose({ x: 0, y: 1850, width: 1080, height: 300 }, 'low')]);
    const up = sentOn(three, 'up');
    const turned = planStroke(up.memory, { kind: 'full', toward: 'down', reach: 1, gesture: BOX, read: { facts: factsOf(three), target: undefined } });
    expect(turned.stroke.points?.from).toEqual({ x: 540, y: 1776 });
    const said = strokedBeside(strokeSent(turned.memory), factsOf(three), 'down', BOX);
    expect(said).toMatchObject({ at: { x: 540, y: 1776 } });
    expect(said?.others.map((o) => o.identifier)).toEqual(['mid', 'low']);
    // A touch-down in no list: the point alone; of two lists holding it, the inner one.
    const apart = screenOf([loose({ x: 0, y: 1300, width: 1080, height: 300 }, 'a'), loose({ x: 0, y: 1700, width: 1080, height: 300 }, 'b')]);
    const off = sentOn(apart, 'up');
    expect(strokedBeside(off.memory, factsOf(apart), 'up', BOX)).toMatchObject({ at: { x: 540, y: 444 }, others: [{ identifier: 'a' }, { identifier: 'b' }] });
    expect(strokedBeside(off.memory, factsOf(apart), 'up', BOX)).not.toHaveProperty('landed');
    const inner: Rect = { x: 0, y: 400, width: 1080, height: 100 };
    const nested = screenOf([loose(UPPER, 'outer'), loose(inner, 'inner'), loose({ x: 0, y: 1300, width: 1080, height: 300 }, 'a')]);
    const into = sentOn(nested, 'up');
    expect(strokedBeside(into.memory, factsOf(nested), 'up', BOX)).toMatchObject({ landed: inner, others: [{ identifier: 'a' }] });
  });

  it('leaves out a list ANY swipe of the call touched down in, not only the last (code review): an earlier swipe inside a nested list, the last over the page holding it', () => {
    const PAGE: Rect = { x: 0, y: 0, width: 1080, height: 1800 };
    const NESTED: Rect = { x: 0, y: 200, width: 1080, height: 400 };
    const SIBLING: Rect = { x: 0, y: 1850, width: 1080, height: 300 };
    // The first read tells the page horizontal (a pager): a `down` stroke goes inside the nested list (D59b).
    const as = (axis: 'horizontal' | 'vertical') => screenOf([node({ role: 'scrollable', clipsDescendants: true, scrollAxis: axis, rect: { ...PAGE }, children: [list(NESTED, { identifier: 'nested' })] }), list(SIBLING, { identifier: 'sibling' })]);
    const first = planOn(as('horizontal'), 'down');
    expect(first.stroke.box).toEqual(NESTED);
    // The next read tells it vertical: the stroke goes over the page, touching down below the nested list.
    const page = as('vertical');
    const second = planStroke(strokeSent(first.memory), { kind: 'full', toward: 'down', reach: 1, gesture: BOX, read: { facts: factsOf(page), target: undefined } });
    expect(second.stroke.box).toEqual(PAGE);
    expect(second.stroke.points !== undefined && containsPoint(NESTED, second.stroke.points.from)).toBe(false);
    expect(strokedBeside(strokeSent(second.memory), factsOf(page), 'down', BOX)?.others.map((o) => o.identifier)).toEqual(['sibling']);
  });

  it('leaves out one across the axis: a carousel beside the lists is no scroll view a vertical stroke could have tried', () => {
    const tree = bounded(node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'horizontal', identifier: 'chips', rect: { x: 0, y: 1600, width: 1080, height: 300 } }));
    const { memory } = sentOn(tree, 'down');
    expect(strokedBeside(memory, factsOf(tree), 'down', BOX)?.others.map((o) => o.identifier)).toEqual(['lower']);
  });

  it('undefined once a read found the target: its own scroll views are the candidates', () => {
    const row = node({ role: 'button', identifier: 'row', rect: { x: 0, y: 1600, width: 1080, height: 100 } });
    const tree = screenOf([list(UPPER), list(LOWER, { identifier: 'lower', children: [row] })]);
    const { memory } = sentOn(tree, 'down', row);
    expect(strokedBeside(memory, factsOf(tree), 'down', BOX)).toBeUndefined();
  });

  it('undefined when the last stroke went ACROSS the scroll view it was drawn over (D59b\'s `across` says that)', () => {
    const tree = screenOf([node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'horizontal', rect: { ...UPPER } }), list(LOWER, { identifier: 'lower' })]);
    const { memory } = sentOn(tree, 'down');
    expect(strokedAcross(memory, factsOf(tree), 'down', BOX)).toMatchObject({ rect: UPPER, axis: 'horizontal' });
    expect(strokedBeside(memory, factsOf(tree), 'down', BOX)).toBeUndefined();
  });

  it('orders several largest first, whatever their order in the tree', () => {
    const tree = bounded(list({ x: 0, y: 1600, width: 1080, height: 100 }, { identifier: 'small' }), list({ x: 0, y: 1750, width: 1080, height: 400 }, { identifier: 'mid' }));
    const { memory } = sentOn(tree, 'down');
    expect(strokedBeside(memory, factsOf(tree), 'down', BOX)?.others.map((o) => o.identifier)).toEqual(['lower', 'mid', 'small']);
  });

  it('leaves out text inputs and the keyboard\'s own scroll views', () => {
    const field = node({ role: 'textfield', clipsDescendants: true, scrollAxis: 'vertical', identifier: 'field', rect: { x: 0, y: 1600, width: 1080, height: 200 } });
    const keyboard = node({ role: 'keyboard', ofKeyboard: true, rect: { x: 0, y: 1850, width: 1080, height: 370 }, children: [list({ x: 0, y: 1850, width: 1080, height: 120 }, { identifier: 'strip', ofKeyboard: true })] });
    const tree = bounded(field, keyboard);
    const { memory } = sentOn(tree, 'down');
    expect(strokedBeside(memory, factsOf(tree), 'down', BOX)?.others.map((o) => o.identifier)).toEqual(['lower']);
  });
});

describe('a named scroll view (`within`, D78) — the one the strokes go over until the target is read', () => {
  /** android scroll-bounded's real dump (API 33): `upper` [0,303][1080,908] the larger, `lower` [0,1046][1080,1541] beside it. */
  const bounded = parseDump(readFileSync(new URL('../fixtures/truth/android-averi_lab-api33/scroll-bounded.xml', import.meta.url), 'utf8'));
  const UPPER: Rect = { x: 0, y: 303, width: 1080, height: 605 };
  const LOWER: Rect = { x: 0, y: 1046, width: 1080, height: 495 };
  const ask = (tree: UiNode, target?: UiNode) => ({ kind: 'full' as const, toward: 'down' as const, reach: 1, gesture: BOX, read: { facts: factsOf(tree), target } });

  it('in place of the largest scroller: the stroke touches down inside `lower`, not at `upper`\'s centre row (540,788)', () => {
    expect(planStroke(startStrokes(), ask(bounded)).stroke.points?.from).toEqual({ x: 540, y: 788 });
    const { stroke } = planStroke(nameScrollView(startStrokes(), factsOf(bounded), LOWER), ask(bounded));
    expect(stroke.box).toEqual(LOWER);
    expect(stroke.points !== undefined && containsPoint(LOWER, stroke.points.from)).toBe(true);
  });

  it('the scroll views nested in it stay candidates after it (D59b): a horizontal page named, a `down` stroke goes inside its vertical list', () => {
    const PAGE: Rect = { x: 0, y: 0, width: 1080, height: 1800 };
    const INNER: Rect = { x: 0, y: 400, width: 1080, height: 800 };
    const tree = screenOf([
      node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'vertical', rect: { x: 0, y: 0, width: 1080, height: 2220 }, identifier: 'largest' }),
      node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'horizontal', rect: { ...PAGE }, children: [node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'vertical', rect: { ...INNER } })] }),
    ]);
    expect(planStroke(nameScrollView(startStrokes(), factsOf(tree), PAGE), ask(tree)).stroke.box).toEqual(INNER);
  });

  it('kept by a read that lost it (the list moved), with what was drawn over it then; a read that did not read keeps the last candidates', () => {
    const named = nameScrollView(startStrokes(), factsOf(bounded), LOWER);
    const moved = screenOf([scroller(UPPER)]);
    expect(planStroke(named, ask(moved)).stroke.box).toEqual(LOWER);
    const planned = planStroke(named, ask(bounded)).memory;
    expect(planStroke(planned, { ...ask(bounded), read: undefined }).stroke.box).toEqual(LOWER);
  });

  it('a read that lost it keeps its axes as named — its nested scroll views still candidates — and the latest cut drawn over it, not the first', () => {
    const PAGE: Rect = { x: 0, y: 0, width: 1080, height: 1800 };
    const INNER: Rect = { x: 0, y: 400, width: 1080, height: 800 };
    const paged = screenOf([node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'horizontal', rect: { ...PAGE }, children: [node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'vertical', rect: { ...INNER } })] })]);
    const gone = screenOf([]);
    expect(planStroke(nameScrollView(startStrokes(), factsOf(paged), PAGE), ask(gone)).stroke.box).toEqual(INNER);
    // Named on a read with nothing over `lower`; the next read draws a bar over its lower part; the one after lost it.
    const named = nameScrollView(startStrokes(), factsOf(bounded), LOWER);
    const BAR: Rect = { x: 0, y: 1400, width: 1080, height: 141 };
    const barred = screenOf([scroller(UPPER), scroller(LOWER), cover(BAR)]);
    const cut = planStroke(named, ask(barred));
    expect(cut.stroke.coverTop).toBe(BAR.y);
    expect(planStroke(cut.memory, ask(gone)).stroke.coverTop).toBe(BAR.y);
  });

  it('once a read finds the target, its own scroll views: `within` no longer counts', () => {
    const p = [...everyNode(bounded)].find((n) => n.identifier === 'lab.scroll-bounded.P')!;
    const named = nameScrollView(startStrokes(), factsOf(bounded), LOWER);
    const found = seeRead(named, { facts: factsOf(bounded), line: undefined, target: p });
    expect(planStroke(found, ask(bounded, p)).stroke.box).toEqual(UPPER);
  });

  it('strokedBeside names `upper`, the list the named strokes did not go over', () => {
    const plan = planStroke(nameScrollView(startStrokes(), factsOf(bounded), LOWER), ask(bounded));
    expect(strokedBeside(strokeSent(plan.memory), factsOf(bounded), 'down', BOX)).toEqual({ axis: 'vertical', strokedOver: LOWER, others: [{ role: 'scrollable', label: null, identifier: null, rect: UPPER }] });
  });

  // D80: a named scroll view with no room for a stroke — the keyboard over all of `lower` but 54 px of it (a keyboard
  // whose top lies at 1100, `lower` 1046–1541) — is NO stroke: the plan says so (`noRoom`) rather than fall back to the
  // gesture box whole, whose stroke would touch down on `upper` or anything else (ADR 0010's D78 residual 1).
  const keyboardAt = (y: number, memory: StrokeMemory): StrokeMemory => seeRead(memory, { facts: factsOf(bounded), line: { y, witnessed: true }, target: undefined });

  it('no room in the named one under the keyboard: `noRoom` names it, the room left and the keyboard\'s top — no fallback to the gesture box decided', () => {
    const plan = planStroke(keyboardAt(1100, nameScrollView(startStrokes(), factsOf(bounded), LOWER)), ask(bounded));
    expect(plan.noRoom).toEqual({ rect: LOWER, toward: 'down', room: 54, keyboardTop: 1100 });
    // 80 above the keyboard is room: the stroke goes inside `lower`, above it.
    const roomy = planStroke(keyboardAt(1046 + MIN_STROKE_BOX, nameScrollView(startStrokes(), factsOf(bounded), LOWER)), ask(bounded));
    expect(roomy.noRoom).toBeUndefined();
    expect(roomy.stroke).toMatchObject({ box: LOWER, coverTop: 1126 });
  });

  it('…and none named, the same keyboard over the largest scroller leaves the fallback as it was: the gesture box whole, no `noRoom`', () => {
    const plan = planStroke(keyboardAt(305, startStrokes()), ask(bounded));
    expect(plan.noRoom).toBeUndefined();
    expect(plan.stroke).toMatchObject({ box: BOX, coverTop: 305 });
  });

  it('…a keyboard above the named one\'s top leaves it no room at all (0), not a negative one', () => {
    expect(planStroke(keyboardAt(900, nameScrollView(startStrokes(), factsOf(bounded), LOWER)), ask(bounded)).noRoom).toEqual({ rect: LOWER, toward: 'down', room: 0, keyboardTop: 900 });
  });

  it('…a round whose tree did not read judges it as the last plan did: still no room (the round holds for a read before it stops on it, scroll-rounds.ts)', () => {
    const first = planStroke(keyboardAt(1100, nameScrollView(startStrokes(), factsOf(bounded), LOWER)), ask(bounded));
    expect(planStroke(first.memory, { ...ask(bounded), read: undefined }).noRoom).toEqual({ rect: LOWER, toward: 'down', room: 54, keyboardTop: 1100 });
  });

  it('…once a read has found the target, `within` counts no more, nor its room: the target\'s own scroll views, their fallback as before', () => {
    const p = [...everyNode(bounded)].find((n) => n.identifier === 'lab.scroll-bounded.P')!;
    const named = nameScrollView(startStrokes(), factsOf(bounded), LOWER);
    const found = seeRead(named, { facts: factsOf(bounded), line: { y: 305, witnessed: true }, target: p });
    const plan = planStroke(found, ask(bounded, p));
    expect(plan.noRoom).toBeUndefined();
    expect(plan.stroke.box).toEqual(BOX);
  });

  it('…no room off the screen: one the gesture box does not meet has 0; no keyboard cutting it, none said; a screen-box stroke and no gesture box ask nothing of it', () => {
    const named = nameScrollView(startStrokes(), factsOf(bounded), LOWER);
    const above: Rect = { x: 0, y: 0, width: 1080, height: 1000 };
    expect(planStroke(named, { ...ask(bounded), gesture: above }).noRoom).toEqual({ rect: LOWER, toward: 'down', room: 0 });
    // The gesture box cut at 1100 (a system band, say): 54 of it on screen, no keyboard said.
    expect(planStroke(named, { ...ask(bounded), gesture: { x: 0, y: 0, width: 1080, height: 1100 } }).noRoom).toEqual({ rect: LOWER, toward: 'down', room: 54 });
    // A keyboard below the part on screen, or at its very bottom, does not cut it: not said.
    expect(planStroke(keyboardAt(1100, named), { ...ask(bounded), gesture: { x: 0, y: 0, width: 1080, height: 1100 } }).noRoom).toEqual({ rect: LOWER, toward: 'down', room: 54 });
    expect(planStroke(keyboardAt(1300, named), { ...ask(bounded), gesture: { x: 0, y: 0, width: 1080, height: 1100 } }).noRoom).toEqual({ rect: LOWER, toward: 'down', room: 54 });
    expect(planStroke(keyboardAt(1100, named), { ...ask(bounded), screenBox: true }).noRoom).toBeUndefined();
    expect(planStroke(keyboardAt(1100, named), { ...ask(bounded), gesture: undefined }).noRoom).toBeUndefined();
  });

  it('…a sideways stroke is judged on the width, whatever the keyboard: a 60-wide named strip has 60', () => {
    const STRIP: Rect = { x: 500, y: 400, width: 60, height: 600 };
    const tree = screenOf([node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'horizontal', rect: { ...STRIP } })]);
    const named = seeRead(nameScrollView(startStrokes(), factsOf(tree), STRIP), { facts: factsOf(tree), line: { y: 700, witnessed: true }, target: undefined });
    expect(planStroke(named, { kind: 'full', toward: 'right', reach: 1, gesture: BOX, read: { facts: factsOf(tree), target: undefined } }).noRoom).toEqual({ rect: STRIP, toward: 'right', room: 60 });
    // Review round 1, MINOR-2: one running past the gesture box is judged on its part on it — 30 of its 200.
    const PAST: Rect = { x: 1050, y: 400, width: 200, height: 600 };
    const past = screenOf([node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'horizontal', rect: { ...PAST } })]);
    expect(planStroke(nameScrollView(startStrokes(), factsOf(past), PAST), { kind: 'full', toward: 'right', reach: 1, gesture: BOX, read: { facts: factsOf(past), target: undefined } }).noRoom).toEqual({ rect: PAST, toward: 'right', room: 30 });
  });

  it('…room cut by what is drawn over it: the named one\'s 120 above the keyboard is enough by itself, a bar over its lower half leaves too little — `noRoom` with the 120', () => {
    const SHORT: Rect = { x: 0, y: 1000, width: 1080, height: 120 };
    const tree = screenOf([scroller(SHORT), cover({ x: 0, y: 1070, width: 1080, height: 50 })]);
    const plan = planStroke(nameScrollView(startStrokes(), factsOf(tree), SHORT), { kind: 'full', toward: 'down', reach: 1, gesture: BOX, read: { facts: factsOf(tree), target: undefined } });
    expect(plan.noRoom).toEqual({ rect: SHORT, toward: 'down', room: 120 });
  });
});

describe('the memory — what a plan keeps for a round whose tree did not read, and for a read that lost the target', () => {
  const row = (y: number) => node({ role: 'button', identifier: 'row', rect: { x: 66, y, width: 948, height: 73 } });

  it('a round whose tree did not read strokes as the last plan did: its scroll views and the last read\'s keyboard line, judged again over that round\'s gesture box', () => {
    const r = row(2400);
    const tree = screenOf([scroller(LIST, [r]), cover(BAR)]);
    const first = planOn(tree, 'down', { target: r, keyboardTop: 1700 });
    expect(first.stroke).toMatchObject({ box: LIST, coverTop: 1700 });
    const blind = planStroke(strokeSent(first.memory), { kind: 'full', toward: 'down', reach: 1, gesture: BOX, read: undefined });
    expect(blind.stroke).toEqual(first.stroke);
    expect(blind.presented).toBeUndefined();
  });

  it('a scroll view remembered from the read that found the target keeps its cut when a later read no longer holds a list of that rect (the page moved it, 0,825 → 0,401); the cut it keeps is the LATEST read that held the list', () => {
    const r = row(-300);
    const found = after(screenOf([scroller(LIST, [r]), cover(BAR)]), { target: r });
    const moved = factsOf(listUnder({ x: 0, y: 401, width: 1080, height: 1753 }, [BAR]));
    expect(planStroke(found, { kind: 'full', toward: 'down', reach: 1, gesture: BOX, read: { facts: moved, target: undefined } }).stroke).toMatchObject({ box: LIST, coverTop: 1840 });
    const banner = planStroke(found, { kind: 'full', toward: 'down', reach: 1, gesture: BOX, read: { facts: factsOf(listUnder(LIST, [{ x: 0, y: 1700, width: 1080, height: 100 }])), target: undefined } });
    expect(banner.stroke.coverTop).toBe(1700);
    for (const kept of [banner.memory, strokeSent(banner.memory)]) {
      expect(planStroke(kept, { kind: 'full', toward: 'down', reach: 1, gesture: BOX, read: { facts: moved, target: undefined } }).stroke.coverTop).toBe(1700);
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
    const facts = { tree, scene: recording, mainScroller: largestScroller(tree) };
    const recorded = planStroke(seeRead(startStrokes(), { facts, line: undefined, target: field }), { kind: 'full', toward: 'down', reach: 1, gesture: { x: 0, y: 0, width: 402, height: 874 }, read: { facts, target: field } });
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

// A38b: idb lists no scroll view, so before its motion is seen a sideways stroke for a target it lists went over the
// screen box — on the lab's carousel-in-list, C (378,138 354x85, past the carousel's right clip) was stroked at y 437,
// 256 pt below the carousel, and nothing moved. Any horizontal scroller holding C spans C's band: the stroke goes there.
describe('the band — on a tree that tells no scroll view, a sideways stroke for a listed target goes over its own row', () => {
  const idb = (): UiNode => parseIdbDescribeAll(readFileSync(new URL('../fixtures/truth/ios-iphone17-ios27/carousel-in-list.idb.json', import.meta.url), 'utf8'));
  const byId = (tree: UiNode, id: string): UiNode => {
    const found = [...everyNode(tree)].find((n) => n.identifier === id);
    if (found === undefined) throw new Error(`no ${id}`);
    return found;
  };
  const BAND: Rect = { x: 0, y: 138, width: 402, height: 85 };

  it('carousel-in-list under idb, C stroked `right`: over the screen box cut to C\'s band — 322,181 → 80,181, not 322,437', () => {
    const tree = idb();
    const plan = planOn(tree, 'right', { target: byId(tree, 'lab.carousel-in-list.C'), gesture: PHONE });
    expect(plan.stroke).toMatchObject({ box: BAND, points: { from: { x: 322, y: 181 }, to: { x: 80, y: 181 } } });
    expect(planOn(tree, 'left', { target: byId(tree, 'lab.carousel-in-list.C'), gesture: PHONE }).stroke).toMatchObject({ box: BAND, points: swipeVector(BAND, 'left', 'content') });
  });

  it('only sideways, only with the target read, only on the screen: a vertical stroke, no target, or a target off the screen keeps the screen box', () => {
    const tree = idb();
    const c = byId(tree, 'lab.carousel-in-list.C');
    expect(planOn(tree, 'down', { target: c, gesture: PHONE }).stroke).toMatchObject({ box: PHONE, points: swipeVector(PHONE, 'down', 'content') });
    expect(planOn(tree, 'right', { gesture: PHONE }).stroke).toMatchObject({ box: PHONE, points: swipeVector(PHONE, 'right', 'content') });
    expect(planOn(tree, 'right', { target: byId(tree, 'lab.carousel-in-list.U'), gesture: PHONE }).stroke).toMatchObject({ box: PHONE, points: swipeVector(PHONE, 'right', 'content') });
  });

  it('the keyboard line (review round 1): a band at or below it is no band — the screen box above the keyboard, as before; one it cuts is stroked above it; one it leaves under TOUCH_SLOP is none', () => {
    const tree = idb();
    const c = byId(tree, 'lab.carousel-in-list.C');
    const right = (keyboardTop: number) => planOn(tree, 'right', { target: c, gesture: PHONE, keyboardTop }).stroke;
    // Above the band (138): the old screen box's stroke, above the keys — never on them (y 130 before the fix).
    expect(right(100)).toMatchObject({ box: PHONE, points: swipeVectorAbove(PHONE, 100, 'right', 'content') });
    expect(right(138)).toMatchObject({ box: PHONE, points: swipeVectorAbove(PHONE, 138, 'right', 'content') });
    // Inside it: the band cut at the line, 138..180, its stroke at 159, above the keys.
    expect(right(180)).toMatchObject({ box: { ...BAND, height: 42 }, points: { from: { x: 322, y: 159 }, to: { x: 80, y: 159 } } });
    // Inside it, 12 pt left (under TOUCH_SLOP 24): too thin for the stroke's line — the screen box above the keys.
    expect(right(150)).toMatchObject({ box: PHONE, points: swipeVectorAbove(PHONE, 150, 'right', 'content') });
    // Below it: the band whole, as with no keyboard.
    expect(right(400)).toMatchObject({ box: BAND, points: { from: { x: 322, y: 181 }, to: { x: 80, y: 181 } } });
  });

  it('a later read that does not find the target keeps the band, as it keeps the target\'s scroll views', () => {
    const tree = idb();
    const memory = seeRead(after(tree, { target: byId(tree, 'lab.carousel-in-list.C') }), { facts: factsOf(tree), line: undefined, target: undefined });
    expect(planStroke(memory, { kind: 'full', toward: 'right', reach: 1, gesture: PHONE, read: undefined }).stroke.box).toEqual(BAND);
  });

  it('once the motion shows a region: a stroke carrying content back goes over the region; one the region does not take (`screenBox`) over the band, not the screen box', () => {
    const tree = idb();
    const c = byId(tree, 'lab.carousel-in-list.C');
    const region: Rect = { x: 24, y: 140, width: 354, height: 80 };
    const memory = seeRead(startStrokes(), { facts: factsOf(tree), line: undefined, target: c, region: { rect: region, axis: 'horizontal' } });
    const ask = { kind: 'full', toward: 'left', reach: 1, gesture: PHONE, read: { facts: factsOf(tree), target: c } } as const;
    expect(planStroke(memory, ask).stroke.box).toEqual(region);
    expect(planStroke(memory, { ...ask, toward: 'right', screenBox: true }).stroke.box).toEqual(BAND);
  });

  it('a tree that tells the target\'s scroll view is untouched: WDA\'s carousel-in-list strokes inside the carousel, as before', async () => {
    const wda = parseWdaSource(await readFile(new URL('../fixtures/wda-capture-lab-carousel-in-list.json', import.meta.url), 'utf8'));
    const c = [...everyNode(wda)].find((n) => n.identifier === 'lab.carousel-in-list.C');
    expect(c).toBeDefined();
    expect(planOn(wda, 'right', { target: c, gesture: PHONE }).stroke.box).toEqual({ x: 24, y: 138, width: 354, height: 85 });
  });
});
