import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseUiautomatorXml } from '../../src/adapters/android.js';
import { parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import {
  absentFromViewport,
  clipsOf,
  containsPoint,
  evidentCut,
  flushEdges,
  higherTop,
  inferScreenSize,
  insideScroller,
  intersectsViewport,
  rectArea,
  rectIntersection,
  rectsOverlap,
  rectWithin,
  sameRect,
  sameRectWithinPixel,
  largestScroller,
  largestRect,
  rectCentre,
  subtract,
} from '../../src/ui-tree/geometry.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { COMPOSE } from '../helpers/android-dumps.js';
import { node as fakeNode } from '../helpers/fake.js';
import { deviceBox, type ScreenSize } from '../../src/ui-tree/geometry.js';

/**
 * Regression cover for docs/bugs/2026-08-26-ios-ocr-crop-scale.md: with a
 * modal sheet presented, the WDA tree carries off-viewport siblings, and the
 * old widest-rect derivation turned one of them into the screen width —
 * halving every png scale and cropping the wrong band of the screenshot.
 */

const node = (rect: UiNode['rect'], identifier: string | null = null, children: UiNode[] = []): UiNode => ({
  role: 'other',
  label: null,
  identifier,
  value: null,
  rect,
  children,
});

// iPhone 17 simulator: 402x874pt window, 3x screenshot.
const SCREEN = { x: 0, y: 0, width: 402, height: 874 };
const PNG_W = 1206;
const PNG_H = 2622;
/** transactions.filter.apply_button — bottom of the sheet, ~90% down. */
const APPLY = { x: 208, y: 791, width: 176, height: 44 };

/** The sheet's buttons plus whatever else iOS left in the tree. */
const treeWith = (...extra: UiNode[]): UiNode =>
  node(SCREEN, null, [node(APPLY, 'transactions.filter.apply_button'), ...extra]);

describe('inferScreenSize', () => {
  it('takes the root window, not the widest rect in the tree', () => {
    expect(inferScreenSize(treeWith())).toEqual({
      width: 402,
      height: 874,
      reliable: true,
      trustworthyHeight: true,
      windowLeg: 'root',
    });
  });

  // Both of these assert the WHOLE answer on purpose. Asserting `.width` alone
  // let a later change turn "ignored" into "refused" without a test noticing
  // (caught in review 2026-08-27): the width was still 402, but `reliable` had
  // gone false and every png scale on the shape failed closed.
  it('ignores an off-viewport sibling parked at x = screen width', () => {
    const tree = treeWith(node({ x: 402, y: 0, width: 402, height: 874 }));
    expect(inferScreenSize(tree)).toEqual({ width: 402, height: 874, reliable: true, trustworthyHeight: true, windowLeg: 'root' });
  });

  it('ignores an oversized node anchored at x=0 — the variant `reliable` cannot see', () => {
    const tree = treeWith(node({ x: 0, y: 0, width: 804, height: 874 }));
    expect(inferScreenSize(tree)).toEqual({ width: 402, height: 874, reliable: true, trustworthyHeight: true, windowLeg: 'root' });
  });

  /**
   * A ROOT is the window by construction, so its own layout may straddle the
   * edge: horizontally scrollable content does exactly that, and iOS reports
   * the full frame of a partly visible cell. Round 3 briefly applied the
   * child-leg contradiction test here too and refused every such screen.
   */
  it('lets a root keep its window when content straddles the edge (carousel, list cell mid-swipe)', () => {
    const tree = treeWith(node({ x: 364, y: 200, width: 340, height: 300 }));
    expect(inferScreenSize(tree)).toMatchObject({ width: 402, reliable: true });
  });

  /**
   * The shape gate keeps a bar from being CROWNED, but a bar that is never a
   * candidate still reaches the walk — which used to hand `reliable` to any
   * origin-anchored maximum. Pixel-scale junk in a point tree then read as an
   * 804pt screen, in silence: hole 1, third appearance.
   */
  it('refuses a walked width that the tree\'s own screen-shaped rects contradict', () => {
    const tree = node({ x: 0, y: 0, width: 0, height: 0 }, null, [
      node({ x: 0, y: 0, width: 804, height: 150 }),
      node({ x: 16, y: 60, width: 370, height: 800 }),
    ]);
    expect(inferScreenSize(tree)).toMatchObject({ width: 804, reliable: false });
  });

  it('…but a REAL status bar is corroborated by the window below it', () => {
    const tree = node({ x: 0, y: 0, width: 0, height: 0 }, null, [
      node({ x: 0, y: 0, width: 1080, height: 80 }),
      node({ x: 0, y: 80, width: 1080, height: 2200 }),
    ]);
    expect(inferScreenSize(tree)).toMatchObject({ width: 1080, reliable: true });
  });

  it('keeps the weaker answer when NOTHING in the tree is screen-shaped (a flat list of rows)', () => {
    const tree = node({ x: 0, y: 0, width: 0, height: 0 }, null, [
      node({ x: 0, y: 0, width: 402, height: 44 }),
      node({ x: 0, y: 44, width: 402, height: 44 }),
    ]);
    expect(inferScreenSize(tree)).toMatchObject({ width: 402, reliable: true });
  });

  it('ignores tall scroll content when the root supplies the height', () => {
    const tree = treeWith(node({ x: 0, y: 0, width: 402, height: 6000 }));
    expect(inferScreenSize(tree)).toMatchObject({ height: 874, trustworthyHeight: true });
  });

  it('marks a WALKED height untrustworthy — it is the CONTENT height', () => {
    // Nothing here is origin-anchored, so no node can be read as a window and
    // the walk is all that is left.
    const tree = node({ x: 0, y: 0, width: 0, height: 0 }, null, [node({ x: 16, y: 0, width: 370, height: 6000 })]);
    expect(inferScreenSize(tree)).toMatchObject({ height: 6000, trustworthyHeight: false });
  });

  it('takes the window one level down when the root carries no rect (idb, multi-root dumps, WDA sheets)', () => {
    const tree = node({ x: 0, y: 0, width: 0, height: 0 }, null, [node(SCREEN), node(APPLY, 'apply')]);
    expect(inferScreenSize(tree)).toEqual({ width: 402, height: 874, reliable: true, trustworthyHeight: true, windowLeg: 'child' });
  });

  it('keeps a tall scroll container out of the running — a screen is not that shape', () => {
    // It used to win the tie on height and hand back a CONTENT height wearing
    // the trustworthy flag; worse, it made the tree read "portrait" for a
    // landscape run and defeated the rotation rule (review 2026-08-27).
    const tree = node({ x: 0, y: 0, width: 0, height: 0 }, null, [
      node(SCREEN),
      node({ x: 0, y: 0, width: 402, height: 6000 }),
    ]);
    expect(inferScreenSize(tree)).toMatchObject({ width: 402, height: 874, trustworthyHeight: true });
  });

  /**
   * Found in review 2026-08-27. Widest-wins alone crowned a small
   * origin-anchored sub-view whose aspect looked like a screen, and the png
   * scale then read 6.0 in silence — the very failure this file exists to
   * prevent. A child is only the window if it CONTAINS the on-layout content.
   */
  it('refuses to resolve a child the layout inside it contradicts, rather than crowning a sub-view', () => {
    const tree = node({ x: 0, y: 0, width: 0, height: 0 }, null, [
      node({ x: 0, y: 0, width: 201, height: 437 }),
      node({ x: 16, y: 0, width: 370, height: 800 }),
    ]);
    // Unreliable, so the png scale fails closed — the tree cannot say which of
    // the two rects is the screen, and 0.5.0 refused this shape too.
    expect(inferScreenSize(tree)).toMatchObject({ reliable: false, trustworthyHeight: false });
  });

  it('tolerates content PEEKING off the right edge — a carousel card is not a contradiction', () => {
    const tree = node({ x: 0, y: 0, width: 0, height: 0 }, null, [
      node(SCREEN),
      node({ x: 380, y: 200, width: 60, height: 120 }),
    ]);
    expect(inferScreenSize(tree)).toMatchObject({ width: 402, reliable: true });
  });

  it('ignores a sibling parked AT the right edge — the original 2026-08-26 inflator', () => {
    const tree = node({ x: 0, y: 0, width: 0, height: 0 }, null, [
      node(SCREEN),
      node({ x: 402, y: 0, width: 402, height: 874 }),
    ]);
    expect(inferScreenSize(tree)).toMatchObject({ width: 402, reliable: true, trustworthyHeight: true });
  });

  /**
   * The other direction, also from review: a non-edge-to-edge uiautomator dump
   * whose app window starts BELOW the status bar leaves the bar as the only
   * origin-anchored root. Crowning it scaled a 2400px capture by 30x down and
   * failed closed on a capture 0.5.0 read correctly.
   */
  it('refuses a BAR — a candidate the content towers over — and walks instead', () => {
    const tree = node({ x: 0, y: 0, width: 0, height: 0 }, null, [
      node({ x: 0, y: 0, width: 1080, height: 80 }),
      node({ x: 0, y: 80, width: 1080, height: 2200 }),
      node({ x: 0, y: 2280, width: 1080, height: 120 }),
    ]);
    expect(inferScreenSize(tree)).toMatchObject({ width: 1080, height: 2400, trustworthyHeight: false });
  });

  it('takes the child leg for a PARTIAL root rect too — half a rect is no rect', () => {
    const tree = node({ x: 0, y: 0, width: 0, height: 874 }, null, [node(SCREEN)]);
    expect(inferScreenSize(tree)).toMatchObject({ width: 402, height: 874, trustworthyHeight: true });
  });

  it('prefers the WIDEST origin-anchored child, so an oversized one stays visible to the axis check', () => {
    const tree = node({ x: 0, y: 0, width: 0, height: 0 }, null, [
      node(SCREEN),
      node({ x: 0, y: 0, width: 804, height: 874 }),
    ]);
    expect(inferScreenSize(tree)).toMatchObject({ width: 804, trustworthyHeight: true });
  });

  it('skips off-screen scrims in the walk — they are hit regions, not layout', () => {
    // The 2026-08-26 inflators: a pixel-scale rect at a negative origin inside
    // a point-scale tree. Nothing here is origin-anchored, so the walk runs.
    const tree = node({ x: 0, y: 0, width: 0, height: 0 }, null, [
      node({ x: 16, y: 0, width: 370, height: 800 }),
      node({ x: -402, y: -874, width: 1206, height: 2622 }),
    ]);
    expect(inferScreenSize(tree)).toMatchObject({ width: 386, height: 800 });
  });

  it('holds the root to the same rule — an off-screen root is no more a screen than a scrim', () => {
    const tree = node({ x: -402, y: -874, width: 1206, height: 2622 }, null, [
      node({ x: 16, y: 0, width: 370, height: 800 }),
    ]);
    expect(inferScreenSize(tree)).toMatchObject({ width: 386, reliable: false });
  });

  it('flags a filtered tree in the fallback path', () => {
    const tree = node({ x: 0, y: 0, width: 0, height: 0 }, null, [node({ x: 16, y: 0, width: 370, height: 800 })]);
    expect(inferScreenSize(tree).reliable).toBe(false);
  });
});

describe('inferScreenSize on the real iOS filter-sheet shape', () => {
  it('reads the window through a rect-less root and past two off-screen scrims', async () => {
    const payload = JSON.parse(
      await readFile(new URL('../fixtures/wda-source-filter-sheet.json', import.meta.url), 'utf8'),
    ) as unknown;
    expect(inferScreenSize(parseWdaSourceValue(payload))).toEqual({
      width: 402,
      height: 874,
      reliable: true,
      trustworthyHeight: true,
      windowLeg: 'child',
    });
  });
});

// ─── Viewport predicates (moved here from selectors.test.ts, 2026-10-04) ────


describe('absentFromViewport — the one meaning of "gone", shared by state detects and absent asserts', () => {
  const vp = { width: 400, height: 800 };
  it('nothing matched is absent; a match on screen is not; a match pushed off-viewport (iOS keeps it) is', () => {
    expect(absentFromViewport([], vp)).toBe(true);
    expect(absentFromViewport([node({ x: 10, y: 10, width: 50, height: 50 })], vp)).toBe(false);
    expect(absentFromViewport([node({ x: 0, y: -300, width: 100, height: 100 })], vp)).toBe(true);
    // One visible match among off-screen ones is enough to be present.
    expect(
      absentFromViewport(
        [node({ x: 0, y: -300, width: 100, height: 100 }), node({ x: 10, y: 10, width: 50, height: 50 })],
        vp,
      ),
    ).toBe(false);
  });
});

describe('intersectsViewport', () => {
  const vp = { width: 400, height: 800 };
  it('true for on-screen rects, false for off-viewport and zero-area rects', () => {
    expect(intersectsViewport({ x: 10, y: 10, width: 50, height: 50 }, vp)).toBe(true);
    expect(intersectsViewport({ x: 390, y: 790, width: 50, height: 50 }, vp)).toBe(true); // partial
    expect(intersectsViewport({ x: 0, y: 900, width: 50, height: 50 }, vp)).toBe(false); // below
    expect(intersectsViewport({ x: -60, y: 10, width: 50, height: 50 }, vp)).toBe(false); // left
    expect(intersectsViewport({ x: 0, y: -100, width: 400, height: 100 }, vp)).toBe(false); // edge-touching
    expect(intersectsViewport({ x: 10, y: 10, width: 0, height: 0 }, vp)).toBe(false); // zero-area
  });
});

describe('rectArea', () => {
  it('is width × height for a real rect and 0 for anything degenerate — including BOTH sides negative, whose product is positive', () => {
    expect(rectArea({ x: 0, y: 0, width: 10, height: 20 })).toBe(200);
    expect(rectArea({ x: 0, y: 0, width: 0, height: 0 })).toBe(0);
    expect(rectArea({ x: 0, y: 0, width: -10, height: 20 })).toBe(0);
    expect(rectArea({ x: 0, y: 0, width: -10, height: -10 })).toBe(0);
    expect(rectArea({ x: 0, y: 0, width: Number.NaN, height: 10 })).toBe(0);
  });
});

describe('rectsOverlap — positive-area overlap only (the pixel poll\'s soft-keyboard check, 2026-10-06)', () => {
  const card = { x: 66, y: 1979, width: 948, height: 132 };
  it('true for any shared area, in either order, including containment', () => {
    const keyboard = { x: 0, y: 1285, width: 1080, height: 935 }; // the 2026-10-06 device case
    expect(rectsOverlap(card, keyboard)).toBe(true);
    expect(rectsOverlap(keyboard, card)).toBe(true);
    expect(rectsOverlap(card, { x: 1013, y: 2110, width: 10, height: 10 })).toBe(true); // a 1x1 corner
  });
  it('false for disjoint, edge-touching, corner-touching and zero-area rects', () => {
    expect(rectsOverlap(card, { x: 0, y: 2200, width: 1080, height: 20 })).toBe(false); // below
    expect(rectsOverlap(card, { x: 0, y: 2111, width: 1080, height: 109 })).toBe(false); // flush with the bottom edge
    expect(rectsOverlap(card, { x: 1014, y: 1979, width: 66, height: 132 })).toBe(false); // flush with the right edge
    expect(rectsOverlap(card, { x: 1014, y: 2111, width: 10, height: 10 })).toBe(false); // corner only
    expect(rectsOverlap(card, { x: 100, y: 2000, width: 0, height: 50 })).toBe(false); // zero-area, inside
  });
});

describe('rectIntersection — the rect two rects share (moved here from swipe.ts, 2026-10-09)', () => {
  const list = { x: 0, y: 200, width: 1080, height: 1800 };
  it('the shared rect, in either order; containment gives the inner rect', () => {
    const carousel = { x: -100, y: 1900, width: 1300, height: 400 }; // cut by the list's bottom and both sides
    expect(rectIntersection(list, carousel)).toEqual({ x: 0, y: 1900, width: 1080, height: 100 });
    expect(rectIntersection(carousel, list)).toEqual({ x: 0, y: 1900, width: 1080, height: 100 });
    const row = { x: 20, y: 300, width: 500, height: 80 };
    expect(rectIntersection(list, row)).toEqual(row);
  });
  it('undefined for disjoint, edge-touching and corner-touching rects — no area shared', () => {
    expect(rectIntersection(list, { x: 0, y: 2100, width: 1080, height: 50 })).toBeUndefined();
    expect(rectIntersection(list, { x: 0, y: 2000, width: 1080, height: 50 })).toBeUndefined(); // flush with the bottom edge
    expect(rectIntersection(list, { x: 1080, y: 200, width: 10, height: 10 })).toBeUndefined(); // flush with the right edge
    expect(rectIntersection(list, { x: 1080, y: 2000, width: 10, height: 10 })).toBeUndefined(); // corner only
  });
});

describe('rectWithin — rect-in-rect, edges included (touchedOn\'s wrapper rule, here since the code review of fix/r4)', () => {
  const list = { x: 0, y: 825, width: 1080, height: 1395 };
  it('a rect equal to or inside the outer one is within it; one past any edge is not', () => {
    expect(rectWithin(list, list)).toBe(true);
    expect(rectWithin({ x: 66, y: 1840, width: 948, height: 248 }, list)).toBe(true);
    expect(rectWithin(list, { x: 66, y: 1840, width: 948, height: 248 })).toBe(false);
    expect(rectWithin({ ...list, x: -1 }, list)).toBe(false);
    expect(rectWithin({ ...list, y: 824 }, list)).toBe(false);
    expect(rectWithin({ ...list, width: 1081 }, list)).toBe(false);
    expect(rectWithin({ ...list, height: 1396 }, list)).toBe(false);
  });
});

describe('containsPoint — the tap guard\'s point-in-rect, here since 2026-10-07', () => {
  const rect = { x: 10, y: 20, width: 30, height: 40 }; // x 10..39, y 20..59
  it('left and top edges inclusive, right and bottom exclusive', () => {
    expect(containsPoint(rect, { x: 10, y: 20 })).toBe(true); // top-left corner
    expect(containsPoint(rect, { x: 39, y: 59 })).toBe(true); // last point inside
    expect(containsPoint(rect, { x: 25, y: 40 })).toBe(true);
    expect(containsPoint(rect, { x: 40, y: 40 })).toBe(false); // right edge
    expect(containsPoint(rect, { x: 25, y: 60 })).toBe(false); // bottom edge
    expect(containsPoint(rect, { x: 9, y: 40 })).toBe(false); // one left of the left edge
    expect(containsPoint(rect, { x: 25, y: 19 })).toBe(false); // one above the top edge
  });
  it('false for a NaN coordinate or rect side, and for a zero-area rect even at its own origin', () => {
    expect(containsPoint(rect, { x: Number.NaN, y: 40 })).toBe(false);
    expect(containsPoint(rect, { x: 25, y: Number.NaN })).toBe(false);
    expect(containsPoint({ ...rect, x: Number.NaN }, { x: 25, y: 40 })).toBe(false);
    expect(containsPoint({ ...rect, height: Number.NaN }, { x: 25, y: 40 })).toBe(false);
    expect(containsPoint({ x: 10, y: 20, width: 0, height: 0 }, { x: 10, y: 20 })).toBe(false);
  });
});

describe('rect equality — one owner, two questions (code review of round 2, 2026-10-08)', () => {
  const r = { x: 10, y: 20, width: 30, height: 40 };
  it('sameRect is exact: a one-unit or a sub-unit change is a change', () => {
    expect(sameRect(r, { ...r })).toBe(true);
    expect(sameRect(r, { ...r, y: 21 })).toBe(false);
    expect(sameRect(r, { ...r, height: 40.5 })).toBe(false);
  });
  it('sameRectWithinPixel forgives under one unit on every side, and nothing more', () => {
    expect(sameRectWithinPixel(r, { x: 10.9, y: 19.1, width: 30.5, height: 39.5 })).toBe(true);
    expect(sameRectWithinPixel(r, { ...r, x: 11 })).toBe(false);
    expect(sameRectWithinPixel(r, { ...r, y: 19 })).toBe(false);
    expect(sameRectWithinPixel(r, { ...r, width: 31 })).toBe(false);
    expect(sameRectWithinPixel(r, { ...r, height: 39 })).toBe(false);
  });
});

describe('clipsOf(tree).scrollersOf — each node\'s clipping ancestors, nearest first (2026-10-09)', () => {
  const rect = (y: number, height: number) => ({ x: 0, y, width: 1080, height });
  const leaf = (y: number) => ({ role: 'text', label: 'r', identifier: null, value: null, rect: rect(y, 100), children: [] });
  it('the marked ancestors\' rects, the nearest first — an inner list before the page around it; none for the outermost scroller or a node outside', () => {
    const inInner = leaf(600);
    const inOuter = leaf(300);
    const inner = { role: 'scrollable', label: null, identifier: 'inner', value: null, rect: rect(500, 400), children: [inInner], clipsDescendants: true as const };
    const outer = { role: 'container', label: null, identifier: 'page', value: null, rect: rect(242, 1736), children: [inOuter, inner], clipsDescendants: true as const };
    const bare = leaf(2000);
    const root = { role: 'container', label: null, identifier: null, value: null, rect: rect(0, 2220), children: [outer, bare] };
    const of = clipsOf(root).scrollersOf;
    expect(of(inInner)).toEqual([rect(500, 400), rect(242, 1736)]);
    expect(of(inOuter)).toEqual([rect(242, 1736)]);
    expect(of(inner)).toEqual([rect(242, 1736)]);
    expect(of(outer)).toEqual([]);
    expect(of(bare)).toEqual([]);
    expect(of(leaf(600))).toEqual([]); // a node of another read
  });
});

describe('flushEdges — a rect\'s edges on its container\'s, within a pixel (moved here from scroll-rounds.ts, 2026-10-10)', () => {
  const form = { x: 0, y: 242, width: 1080, height: 1736 };
  it('both axes by default, in clippedEdges\' order; one axis when asked; none for a container of no area', () => {
    expect(flushEdges({ x: 66, y: 1924, width: 948, height: 55 }, form)).toEqual(['bottom']); // 1979 against 1978: within a pixel
    expect(flushEdges({ x: 0, y: 242, width: 1080, height: 100 }, form)).toEqual(['top', 'left', 'right']);
    expect(flushEdges({ x: 0, y: 242, width: 1080, height: 100 }, form, 'vertical')).toEqual(['top']);
    expect(flushEdges({ x: 0, y: 242, width: 1080, height: 100 }, form, 'horizontal')).toEqual(['left', 'right']);
    expect(flushEdges({ x: 66, y: 1920, width: 948, height: 56 }, form)).toEqual([]); // 2 px short
    expect(flushEdges({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 0, height: 0 })).toEqual([]);
  });
});

describe('evidentCut — a node cut at a clipping ancestor\'s edge, by what its own content says (2026-10-10)', () => {
  const form = { x: 0, y: 242, width: 1080, height: 1736 };
  const at = (rect: UiNode['rect'], ...children: UiNode[]) => node(rect, null, children);
  /** The measured toggle 66,1924 948x55 on the form's bottom (1978), a child from `top` to `bottom`. */
  const toggleWith = (top: number, bottom: number) => at({ x: 66, y: 1924, width: 948, height: 55 }, at({ x: 66, y: top, width: 948, height: bottom - top }));
  it('the measured toggle: flush with the form\'s bottom, its button running into the cut from 12 px inside — cut there, 55 deep', () => {
    expect(evidentCut(toggleWith(1936, 1978), [form])).toEqual({ edge: 'bottom', container: form, depth: 55 });
  });
  it('Compose\'s shape: a descendant past the edge is evidence whatever its other side', () => {
    const row = at({ x: 132, y: 242, width: 948, height: 33 }, at({ x: 132, y: 115, width: 816, height: 160 }));
    expect(evidentCut(row, [form])).toEqual({ edge: 'top', container: form, depth: 33 });
  });
  it('within a pixel is ON a side: a child starting 1 px inside the node does not run in, 2 px does; one ending 1 px short of the edge reaches it, 2 px short does not', () => {
    expect(evidentCut(toggleWith(1925, 1978), [form])).toBeUndefined();
    expect(evidentCut(toggleWith(1926, 1978), [form])?.edge).toBe('bottom');
    expect(evidentCut(toggleWith(1936, 1977), [form])?.edge).toBe('bottom');
    expect(evidentCut(toggleWith(1936, 1976), [form])).toBeUndefined();
  });
  it('inside evidence needs MIN_INSIDE_EVIDENCE (8) along y (code review round 3): a 7-px divider or focus line at the cut is none, 8 px is; past the edge, any thickness counts', () => {
    expect(evidentCut(toggleWith(1971, 1978), [form])).toBeUndefined();
    expect(evidentCut(toggleWith(1970, 1978), [form])?.edge).toBe('bottom');
    expect(evidentCut(at({ x: 66, y: 1924, width: 948, height: 55 }, at({ x: 66, y: 1977, width: 948, height: 3 })), [form])?.edge).toBe('bottom'); // 2 px past
  });
  it('past the edge by more than a pixel: 1 px past is on it (a fill), 2 px past is evidence', () => {
    expect(evidentCut(toggleWith(1924, 1979), [form])).toBeUndefined();
    expect(evidentCut(toggleWith(1924, 1980), [form])?.edge).toBe('bottom');
  });
  it('nothing cut: a label inside, a background filling the node, a leaf, a node not flush, a zero-area descendant, no clipping ancestor', () => {
    const whole = { x: 66, y: 1930, width: 948, height: 48 };
    expect(evidentCut(at(whole, at({ x: 480, y: 1942, width: 120, height: 24 })), [form])).toBeUndefined();
    expect(evidentCut(at(whole, at(whole)), [form])).toBeUndefined();
    expect(evidentCut(at(whole), [form])).toBeUndefined();
    expect(evidentCut(at({ x: 66, y: 1900, width: 948, height: 48 }, at({ x: 66, y: 1920, width: 948, height: 28 })), [form])).toBeUndefined();
    expect(evidentCut(at(whole, at({ x: 66, y: 1978, width: 948, height: 0 })), [form])).toBeUndefined();
    expect(evidentCut(toggleWith(1936, 1978), [])).toBeUndefined();
  });
  it('at a SIDE only content past the edge counts (code review item 4): a whole 60-px tile flush left with its icon flush left reads whole; a full-bleed row\'s flush content too', () => {
    const list = { x: 0, y: 200, width: 1080, height: 1800 };
    expect(evidentCut(at({ x: 0, y: 500, width: 60, height: 60 }, at({ x: 0, y: 510, width: 40, height: 40 })), [list])).toBeUndefined();
    expect(evidentCut(at({ x: 132, y: 600, width: 948, height: 175 }, at({ x: 948, y: 625, width: 132, height: 132 })), [list])).toBeUndefined();
    expect(evidentCut(at({ x: 1030, y: 900, width: 50, height: 60 }, at({ x: 1030, y: 900, width: 82, height: 60 })), [list])).toEqual({ edge: 'right', container: list, depth: 50 });
  });
  it('the SHALLOWEST evidenced edge over the whole chain (code review item 2): a card cut to 50 px at a carousel\'s right with an image at its top is judged at the right', () => {
    const carousel = { x: 0, y: 600, width: 1080, height: 300 };
    const card = at({ x: 1030, y: 600, width: 50, height: 300 }, at({ x: 1046, y: 600, width: 34, height: 200 }), at({ x: 1040, y: 650, width: 200, height: 40 }));
    expect(evidentCut(card, [carousel])).toEqual({ edge: 'right', container: carousel, depth: 50 });
    // …and a side cut on an OUTER ancestor is found past the nearest one's evidenced top.
    const page = { x: 0, y: 0, width: 1080, height: 2220 };
    const outerCard = at({ x: 1030, y: 600, width: 50, height: 300 }, at({ x: 1046, y: 600, width: 34, height: 200 }), at({ x: 1040, y: 650, width: 200, height: 40 }));
    expect(evidentCut(outerCard, [{ x: 0, y: 600, width: 2000, height: 300 }, page])).toEqual({ edge: 'right', container: page, depth: 50 });
  });
  it('a descendant dumped CLIPPED OUT past the flush edge is evidence there (code review of round 7, P1): Settings\' row cut to 33 px at the list\'s top, its texts clamped to zero area at 297 — cut, 33 deep', () => {
    const list = { x: 0, y: 297, width: 1080, height: 1857 };
    const out = (rect: UiNode['rect'], side: NonNullable<UiNode['clippedOut']>): UiNode => ({ ...node(rect), clippedOut: side });
    const row = (...texts: UiNode[]) => at({ x: 0, y: 297, width: 1080, height: 33 }, at({ x: 66, y: 297, width: 66, height: 33 }), ...texts);
    expect(evidentCut(row(out({ x: 198, y: 297, width: 126, height: 0 }, 'top'), out({ x: 198, y: 297, width: 621, height: 0 }, 'top')), [list])).toEqual({ edge: 'top', container: list, depth: 33 });
    expect(evidentCut(row(out({ x: 198, y: 297, width: 126, height: 0 }, 'top')), [list])).toEqual({ edge: 'top', container: list, depth: 33 });
    // Without them the icon, cut with the row to its own height, says nothing.
    expect(evidentCut(row(), [list])).toBeUndefined();
    // Clipped out the OTHER way, or clamped at an edge that is not this one (an inner clip 13 px down): no evidence of a cut at the top.
    expect(evidentCut(row(out({ x: 198, y: 297, width: 126, height: 0 }, 'bottom')), [list])).toBeUndefined();
    expect(evidentCut(row(out({ x: 198, y: 310, width: 126, height: 0 }, 'top')), [list])).toBeUndefined();
    // A plain zero-area descendant (no mark) stays none, as before.
    expect(evidentCut(row(at({ x: 198, y: 297, width: 126, height: 0 })), [list])).toBeUndefined();
  });
  it('equal depths: the NEAREST ancestor\'s edge wins (the chain is walked nearest first; a later edge must be shallower)', () => {
    const inner = { x: 0, y: 1900, width: 1080, height: 79 };
    const row = at({ x: 66, y: 1924, width: 948, height: 55 }, at({ x: 66, y: 1936, width: 948, height: 42 }));
    expect(evidentCut(row, [inner, form])).toEqual({ edge: 'bottom', container: inner, depth: 55 });
  });
});

/**
 * The clippedOut evidence (code review of round 7, P1) at every edge, through the parser as uiautomator dumps it —
 * the verification's probe shapes — and the two stated residuals it leaves (geometry.ts#evidentCut, "Unknowable").
 */
describe('evidentCut — clippedOut evidence at each edge, parsed (verification of the code review of round 7)', () => {
  const dump = (inner: string, list = '[0,297][1080,2154]') =>
    `<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]"><node class="androidx.recyclerview.widget.RecyclerView" scrollable="true" resource-id="a:id/list" bounds="${list}">${inner}</node></node></hierarchy>`;
  const cutOf = (xml: string, id: string) => {
    const tree = parseUiautomatorXml(xml);
    const find = (n: UiNode): UiNode | undefined => (n.identifier === id ? n : n.children.map(find).find(Boolean));
    const n = find(tree)!;
    return evidentCut(n, clipsOf(tree).scrollersOf(n));
  };
  const text = (bounds: string) => `<node class="android.widget.TextView" resource-id="a:id/title" text="Apps" bounds="${bounds}"/>`;
  const row = (id: string, bounds: string, ...kids: string[]) => `<node class="android.widget.LinearLayout" clickable="true" resource-id="a:id/${id}" bounds="${bounds}">${kids.join('')}</node>`;
  const carousel = '[0,400][1080,700]';

  it('bottom: a row cut to 34 px at the list\'s bottom, its text dumped wholly below — cut there, 34 deep', () => {
    expect(cutOf(dump(row('row', '[0,2120][1080,2154]', text('[198,2200][324,2154]'))), 'row')).toEqual({ edge: 'bottom', container: { x: 0, y: 297, width: 1080, height: 1857 }, depth: 34 });
  });
  it('left and right: a card cut to 40 px at a carousel\'s side, its text dumped wholly past it — cut there, 40 deep', () => {
    expect(cutOf(dump(row('card', '[0,400][40,700]', text('[0,420][-100,460]')), carousel), 'card')).toEqual({ edge: 'left', container: { x: 0, y: 400, width: 1080, height: 300 }, depth: 40 });
    expect(cutOf(dump(row('card', '[1040,400][1080,700]', text('[1200,420][1080,460]')), carousel), 'card')).toEqual({ edge: 'right', container: { x: 0, y: 400, width: 1080, height: 300 }, depth: 40 });
  });
  it('stated residual: a text dumped inverted on BOTH axes is clippedOut \'top\' (the parser\'s `vertical ?? sideways`), so the card\'s left cut is missed', () => {
    const xml = dump(row('card', '[0,400][40,700]', text('[0,450][-100,440]')), carousel);
    expect([...everyNode(parseUiautomatorXml(xml))].find((n) => n.label === 'Apps')?.clippedOut).toBe('top');
    expect(cutOf(xml, 'card')).toBeUndefined();
  });
  it('stated residual: a WHOLE 50-px row at rest at the list\'s top with a child laid out wholly above it (a hidden swipe-action view) reads cut, 50 deep', () => {
    const xml = dump(row('row', '[0,297][1080,347]', text('[40,305][400,340]'), '<node class="android.widget.TextView" resource-id="a:id/hidden" text="x" bounds="[40,297][400,250]"/>'));
    expect(cutOf(xml, 'row')).toEqual({ edge: 'top', container: { x: 0, y: 297, width: 1080, height: 1857 }, depth: 50 });
  });
});

describe('higherTop — the higher of two top edges, either unknown (code review of round 7, S5)', () => {
  it('the smaller y of two; the one known; undefined when neither is', () => {
    expect(higherTop(600, 589)).toBe(589);
    expect(higherTop(589, 600)).toBe(589);
    expect(higherTop(589, undefined)).toBe(589);
    expect(higherTop(undefined, 590)).toBe(590);
    expect(higherTop(undefined, undefined)).toBeUndefined();
  });
});

describe('clipsOf(tree).cutSliver — evidentCut under the minimum piece', () => {
  const form = { x: 0, y: 242, width: 1080, height: 1736 };
  const toggle = (height: number) => node({ x: 66, y: 1979 - height, width: 948, height }, null, [node({ x: 66, y: 1979 - height + 12, width: 948, height: height - 13 })]);
  const sliverOf = (n: UiNode, minPiece: number) => clipsOf(node({ x: 0, y: 0, width: 1080, height: 2220 }, null, [{ ...node(form, 'form', [n]), clipsDescendants: true }])).cutSliver(n, minPiece);
  it('64 deep under a 65 minimum is a sliver; 65 is not; no evidence, none; a node of another read, none', () => {
    expect(sliverOf(toggle(64), 65)).toEqual({ edge: 'bottom', container: form, depth: 64 });
    expect(sliverOf(toggle(65), 65)).toBeUndefined();
    expect(sliverOf(node({ x: 66, y: 1924, width: 948, height: 55 }), 65)).toBeUndefined();
    expect(clipsOf(node(form)).cutSliver(toggle(64), 65)).toBeUndefined();
  });
  it('kept per node and minimum: the same answer for each minimum asked, in any order', () => {
    const t = toggle(64);
    const clips = clipsOf(node({ x: 0, y: 0, width: 1080, height: 2220 }, null, [{ ...node(form, 'form', [t]), clipsDescendants: true }]));
    expect([clips.cutSliver(t, 65)?.depth, clips.cutSliver(t, 64), clips.cutSliver(t, 65)?.depth]).toEqual([64, undefined, 64]);
  });
});

describe('clipsOf — the chain through plain containers to the outermost clip (round 8)', () => {
  const rect = (y: number, height: number) => ({ x: 0, y, width: 1080, height });
  it('a node under plain containers inside the clip has the clip\'s chain; nodes above it and outside have none', () => {
    const label = node(rect(1936, 42), 'label');
    const toggle = node(rect(1924, 55), 'toggle', [label]);
    const form = { ...node(rect(242, 1736), 'form', [toggle]), clipsDescendants: true as const };
    const page = node(rect(0, 2220), 'page', [form]);
    const root = node(rect(0, 2220), null, [page, node(rect(0, 100), 'bar')]);
    const of = clipsOf(root).scrollersOf;
    expect([of(label), of(toggle)]).toEqual([[form.rect], [form.rect]]);
    expect(of(label)).toBe(of(toggle)); // shared along the branch
    expect([of(form), of(page), of(root.children[1]), of(node(rect(1936, 42)))]).toEqual([[], [], [], []]);
  });
});

describe('cutSliver — inherited from an ancestor cut to a sliver at the edge the node lies flush with (round 8)', () => {
  const form = { x: 0, y: 242, width: 1080, height: 1736 };
  /** The node `n` inside `parent` inside the form, as the tree has them; the tree's cutSliver asked of `n`. */
  const sliverOf = (n: UiNode, parent: UiNode, minPiece = 65) => {
    const formNode = { ...node(form, 'form', [parent]), clipsDescendants: true as const };
    return clipsOf(node({ x: 0, y: 0, width: 1080, height: 2220 }, null, [formNode])).cutSliver(n, minPiece);
  };
  // As dumped at 35d5997: details_toggle 66,1924 948x55; children other 'Payment details' 66,1936 948x42, other 926,1955 88x23, button 66,1936 948x42.
  const label = () => node({ x: 66, y: 1936, width: 948, height: 42 }, 'label');
  const chevron = () => node({ x: 926, y: 1955, width: 88, height: 23 }, 'chevron');
  const toggleOf = (...children: UiNode[]) => node({ x: 66, y: 1924, width: 948, height: 55 }, 'toggle', children);

  it('the measured leaf label 66,1936 948x42 and the chevron 926,1955 88x23, flush with the form\'s bottom in the cut toggle: slivers too, within the toggle', () => {
    const l = label();
    const c = chevron();
    const toggle = toggleOf(l, c, node({ x: 66, y: 1936, width: 948, height: 42 }));
    expect(sliverOf(l, toggle)).toEqual({ edge: 'bottom', container: form, depth: 42, within: { x: 66, y: 1924, width: 948, height: 55 } });
    expect(sliverOf(c, toggle)).toEqual({ edge: 'bottom', container: form, depth: 23, within: { x: 66, y: 1924, width: 948, height: 55 } });
    expect(sliverOf(l, toggle, 56)?.depth).toBe(42); // the toggle a sliver by a pixel
    expect(sliverOf(l, toggle, 55)).toBeUndefined(); // the toggle as deep as the minimum: no sliver to inherit
  });

  it('a child of the cut toggle that lies clear of the edge (more than a pixel short of it) shows whole inside the strip: not inherited', () => {
    const clear = node({ x: 100, y: 1936, width: 300, height: 40 }, 'clear'); // bottom 1976, 2 px short of 1978
    expect(sliverOf(clear, toggleOf(clear, node({ x: 66, y: 1936, width: 948, height: 42 })))).toBeUndefined();
    const flush = node({ x: 100, y: 1936, width: 300, height: 41 }, 'flush'); // bottom 1977, within a pixel
    expect(sliverOf(flush, toggleOf(flush, node({ x: 66, y: 1936, width: 948, height: 42 })))?.edge).toBe('bottom');
  });

  it('a child flush with the cut but as deep as the minimum across it (laid out past the toggle\'s top, Compose-style): not a sliver, whatever its toggle', () => {
    const deep = node({ x: 66, y: 1913, width: 948, height: 65 }, 'deep'); // 1913–1978: 65 deep
    expect(sliverOf(deep, toggleOf(deep, node({ x: 66, y: 1936, width: 948, height: 42 })))).toBeUndefined();
    const shallower = node({ x: 66, y: 1914, width: 948, height: 64 }, 'shallower');
    expect(sliverOf(shallower, toggleOf(shallower, node({ x: 66, y: 1936, width: 948, height: 42 })))?.depth).toBe(64);
  });

  it('a child flush with ANOTHER edge of the form (its left) inside the toggle cut at the bottom: not inherited — the edge must be the cut\'s', () => {
    const left = node({ x: 0, y: 1930, width: 200, height: 30 }, 'left'); // flush with the form's left, 18 px short of its bottom
    const toggle = node({ x: 0, y: 1924, width: 1080, height: 55 }, 'toggle', [left, node({ x: 0, y: 1936, width: 1080, height: 42 })]);
    expect(sliverOf(toggle, node({ x: 0, y: 1924, width: 1080, height: 55 }, 'wrap', [toggle]))?.edge).toBe('bottom');
    expect(sliverOf(left, toggle)).toBeUndefined();
  });

  it('a parent at the edge that is not EVIDENTLY cut (a whole button, its background filling it): its flush child is not refused', () => {
    const background = node({ x: 66, y: 1923, width: 400, height: 55 }, 'bg');
    expect(sliverOf(background, node({ x: 66, y: 1923, width: 400, height: 55 }, 'filled', [background]))).toBeUndefined();
  });

  it('A2.4\'s shape — Create contact\'s field cut by the IME-resized form DEEPER than the minimum (132,1307 816x91), its label "Company" 176,1373 190x25 flush with the cut: not inherited', () => {
    const imeForm = { x: 0, y: 242, width: 1080, height: 1156 }; // bottom 1398
    const company = node({ x: 176, y: 1373, width: 190, height: 25 }, 'company');
    const field = node({ x: 132, y: 1307, width: 816, height: 91 }, 'field', [node({ x: 132, y: 1329, width: 816, height: 69 }), company, node({ x: 176, y: 1340, width: 728, height: 58 })]);
    const row = node({ x: 132, y: 1307, width: 948, height: 91 }, 'row', [field]);
    const list = { ...node(imeForm, 'form', [row]), clipsDescendants: true as const };
    const clips = clipsOf(node({ x: 0, y: 0, width: 1080, height: 2220 }, null, [list]));
    expect(evidentCut(field, clips.scrollersOf(field))?.depth).toBe(91); // cut, but deep enough
    expect(clips.cutSliver(company, 65)).toBeUndefined();
  });

  it('the NEAREST sliver ancestor is named — a button in the toggle before the toggle', () => {
    const leaf = node({ x: 80, y: 1960, width: 100, height: 18 }, 'leaf');
    const button = node({ x: 66, y: 1950, width: 948, height: 28 }, 'button', [leaf]); // itself a sliver inside the toggle
    const toggle = toggleOf(node({ x: 66, y: 1936, width: 948, height: 42 }), button);
    expect(sliverOf(leaf, toggle)).toEqual({ edge: 'bottom', container: form, depth: 18, within: { x: 66, y: 1950, width: 948, height: 28 } });
  });
  it('the search goes on past a NEARER sliver cut at another edge: a leaf flush with the bottom in a 50-px block cut at the form\'s left inherits the toggle\'s bottom cut', () => {
    const leaf = node({ x: 10, y: 1960, width: 30, height: 18 }, 'leaf'); // flush with the bottom, not the left
    const block = node({ x: 0, y: 1924, width: 50, height: 55 }, 'block', [leaf, node({ x: -40, y: 1930, width: 100, height: 20 })]); // cut at the left, 50 deep
    const toggle = node({ x: 0, y: 1924, width: 1080, height: 55 }, 'toggle', [block, node({ x: 0, y: 1936, width: 1080, height: 42 })]);
    expect(sliverOf(block, toggle)).toEqual({ edge: 'left', container: form, depth: 50 });
    expect(sliverOf(leaf, toggle)).toEqual({ edge: 'bottom', container: form, depth: 18, within: { x: 0, y: 1924, width: 1080, height: 55 } });
  });

  it('the cut is the edge of ONE container: a leaf flush with the form\'s bottom inside a sliver cut at an inner clip\'s bottom (a synthetic inner clip running past the form) inherits nothing', () => {
    const leaf = node({ x: 0, y: 1960, width: 100, height: 18 }, 'leaf'); // bottom 1978: the form's, not the inner clip's (2000)
    const strip = node({ x: 0, y: 1950, width: 1080, height: 50 }, 'strip', [leaf, node({ x: 200, y: 1960, width: 100, height: 50 })]); // cut at 2000, 50 deep
    const inner = { ...node({ x: 0, y: 1900, width: 1080, height: 100 }, 'inner', [strip]), clipsDescendants: true as const };
    const clips = clipsOf(node({ x: 0, y: 0, width: 1080, height: 2220 }, null, [{ ...node(form, 'form', [inner]), clipsDescendants: true }]));
    expect(clips.cutSliver(strip, 65)).toEqual({ edge: 'bottom', container: inner.rect, depth: 50 });
    expect(clips.cutSliver(leaf, 65)).toBeUndefined();
  });

  it('a wrapper with no evidence of its own, flush in the cut toggle, is a sliver by inheritance — and hands it on: its filling leaf names it', () => {
    const leaf = node({ x: 66, y: 1950, width: 948, height: 28 }, 'leaf');
    const wrapper = node({ x: 66, y: 1950, width: 948, height: 28 }, 'wrapper', [leaf]);
    const toggle = toggleOf(node({ x: 66, y: 1936, width: 948, height: 42 }), wrapper);
    expect(sliverOf(wrapper, toggle)?.within).toEqual({ x: 66, y: 1924, width: 948, height: 55 });
    expect(sliverOf(leaf, toggle)?.within).toEqual({ x: 66, y: 1950, width: 948, height: 28 });
  });
});

describe('largestScroller — the screen\'s own scroll view (2026-10-09)', () => {
  const box = (y: number, height: number, clips: boolean, children: UiNode[] = []): UiNode => ({
    role: 'container', label: null, identifier: null, value: null, rect: { x: 0, y, width: 1080, height }, children, ...(clips && { clipsDescendants: true as const }),
  });
  it('the largest clipping node by area — a carousel above the list is the smaller; none without one', () => {
    const carousel = box(300, 300, true);
    const list = box(737, 1417, true);
    expect(largestScroller(box(0, 2220, false, [carousel, list]))).toEqual(list.rect);
    expect(largestScroller(box(0, 2220, false, [box(300, 300, false)]))).toBeUndefined();
  });
});

describe('insideScroller — some ancestor scrolls (scroll-containers.ts#scrolls); unknown on a flat list', () => {
  const find = (tree: UiNode, keep: (n: UiNode) => boolean): UiNode => [...everyNode(tree)].find(keep)!;

  it('nested WDA: a field in the login ScrollView is inside; the screen wrapper around it is not', async () => {
    const tree = parseWdaSourceValue(JSON.parse(await readFile(new URL('../fixtures/wda-source-myport-login-no-keyboard.json', import.meta.url), 'utf8')));
    expect(insideScroller(tree, find(tree, (n) => n.identifier === 'login_username'))).toBe(true);
    expect(insideScroller(tree, find(tree, (n) => n.identifier === 'login_screen'))).toBe(false);
  });

  it('Android Compose: a row of the flagged list is inside (a Compose scroller has no scrollable role); the tab bar after it is not', () => {
    const tree = parseUiautomatorXml(COMPOSE.accountDetail);
    expect(insideScroller(tree, find(tree, (n) => n.identifier === 'transactions.list.row_2'))).toBe(true);
    expect(insideScroller(tree, find(tree, (n) => n.identifier === 'nav.tab_home'))).toBe(false);
  });

  it('a classic Android list whose content fits (scrollable="false") still counts: it is a scroll view', () => {
    const tree = parseUiautomatorXml(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
      <node class="android.widget.ListView" scrollable="false" bounds="[0,200][1080,900]">
        <node class="android.widget.TextView" resource-id="row" text="Only row" bounds="[0,200][1080,350]" />
      </node></node></hierarchy>`);
    expect(insideScroller(tree, find(tree, (n) => n.identifier === 'row'))).toBe(true);
  });

  it("a link in a web view is inside; the navigation bar's Back beside the web view is not", () => {
    const back = fakeNode({ role: 'button', label: 'Back', rect: { x: 8, y: 70, width: 80, height: 40 } });
    const link = fakeNode({ role: 'link', label: 'Read more', rect: { x: 16, y: 72, width: 200, height: 30 } });
    const tree = fakeNode({
      role: 'container',
      rect: { x: 0, y: 0, width: 402, height: 874 },
      children: [fakeNode({ role: 'other', rect: { x: 0, y: 62, width: 402, height: 54 }, children: [back] }), fakeNode({ role: 'webview', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [link] })],
    });
    expect(insideScroller(tree, link)).toBe(true);
    expect(insideScroller(tree, back)).toBe(false);
  });

  it("undefined where the tree cannot say: idb's flat list, and a node of another tree", async () => {
    const flat = parseIdbDescribeAll(await readFile(new URL('../fixtures/idb-swift-form-continue.json', import.meta.url), 'utf8'));
    expect(flat.flatList).toBe(true);
    expect(insideScroller(flat, flat.children[flat.children.length - 1])).toBeUndefined();
    expect(insideScroller(parseUiautomatorXml(COMPOSE.accountDetail), fakeNode({}))).toBeUndefined();
  });
});

describe('subtract, largestRect, rectCentre — the cover arithmetic draw-order.ts#exposure asks (code review S3, S5)', () => {
  const r = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

  it('a rect less a cut inside it: the bands above and below, full width, and the parts beside it between them', () => {
    expect(subtract(r(0, 0, 100, 100), r(40, 40, 20, 20))).toEqual([r(0, 0, 100, 40), r(0, 60, 100, 40), r(0, 40, 40, 20), r(60, 40, 40, 20)]);
  });

  it('a cut over its lower part leaves the band above; one sharing no area leaves it whole; one holding it whole leaves nothing', () => {
    expect(subtract(r(24, 771, 354, 52), r(24, 780, 354, 44))).toEqual([r(24, 771, 354, 9)]);
    const from = r(0, 0, 10, 10);
    expect(subtract(from, r(20, 20, 5, 5))).toEqual([from]);
    expect(subtract(from, r(-5, -5, 30, 30))).toEqual([]);
  });

  it('largestRect: by area, the first of equals; none for none — rectCentre: rounded as a tap is sent', () => {
    expect(largestRect([r(0, 0, 10, 2), r(0, 0, 4, 5), r(5, 5, 2, 10)])).toEqual(r(0, 0, 10, 2));
    expect(largestRect([])).toBeUndefined();
    expect(rectCentre(r(24, 754, 354, 26))).toEqual({ x: 201, y: 767 });
    expect(rectCentre(r(0, 0, 3, 3))).toEqual({ x: 2, y: 2 });
  });
});

/** Code review of round 8, S3: the one derivation of the device's screen in the tree's units, read by the gesture box and the pixel assert. */
describe('deviceBox — the device, turned as the window says; else a window the tree vouches for; else nothing', () => {
  const size = (width: number, height: number, reliable: boolean, trustworthyHeight: boolean): ScreenSize => ({ width, height, reliable, trustworthyHeight });
  const PORTRAIT = { width: 1080, height: 2220 };
  it.each([
    ['device usable, the window portrait: as built', PORTRAIT, size(1080, 2220, true, true), { from: 'device', box: { x: 0, y: 0, width: 1080, height: 2220 }, sideways: false }],
    ['device usable, the window landscape: turned', PORTRAIT, size(2220, 1080, true, true), { from: 'device', box: { x: 0, y: 0, width: 2220, height: 1080 }, sideways: true }],
    ['device usable, no tree: as built', PORTRAIT, undefined, { from: 'device', box: { x: 0, y: 0, width: 1080, height: 2220 }, sideways: false }],
    ['device unusable (0x0), a window vouched for: the window', { width: 0, height: 0 }, size(402, 874, true, true), { from: 'window', box: { x: 0, y: 0, width: 402, height: 874 } }],
    ['no device, a window vouched for: the window', undefined, size(402, 874, true, true), { from: 'window', box: { x: 0, y: 0, width: 402, height: 874 } }],
    ['no device, a walked height (not a window\'s): nothing', undefined, size(402, 1300, true, false), undefined],
    ['no device, an unreliable window: nothing', undefined, size(402, 874, false, true), undefined],
    ['no device, no geometry: nothing', undefined, size(0, 0, true, true), undefined],
    ['neither device nor tree: nothing', undefined, undefined, undefined],
  ] as const)('%s', (_name, device, tree, expected) => {
    const got = deviceBox(device, tree);
    if (expected === undefined) return expect(got).toBeUndefined();
    expect(got).toMatchObject(expected);
  });
});

