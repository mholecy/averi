import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import {
  absentFromViewport,
  containsPoint,
  inferScreenSize,
  intersectsViewport,
  rectArea,
  rectIntersection,
  rectsOverlap,
  rectWithin,
  sameRect,
  sameRectWithinPixel,
  scrollersOf,
  largestScroller,
} from '../../src/ui-tree/geometry.js';
import { type UiNode } from '../../src/adapters/types.js';

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

describe('scrollersOf — each node\'s clipping ancestors, nearest first (2026-10-09)', () => {
  const rect = (y: number, height: number) => ({ x: 0, y, width: 1080, height });
  const leaf = (y: number) => ({ role: 'text', label: 'r', identifier: null, value: null, rect: rect(y, 100), children: [] });
  it('the marked ancestors\' rects, the nearest first — an inner list before the page around it; none for the outermost scroller or a node outside', () => {
    const inInner = leaf(600);
    const inOuter = leaf(300);
    const inner = { role: 'scrollable', label: null, identifier: 'inner', value: null, rect: rect(500, 400), children: [inInner], clipsDescendants: true as const };
    const outer = { role: 'container', label: null, identifier: 'page', value: null, rect: rect(242, 1736), children: [inOuter, inner], clipsDescendants: true as const };
    const bare = leaf(2000);
    const root = { role: 'container', label: null, identifier: null, value: null, rect: rect(0, 2220), children: [outer, bare] };
    const of = scrollersOf(root);
    expect(of(inInner)).toEqual([rect(500, 400), rect(242, 1736)]);
    expect(of(inOuter)).toEqual([rect(242, 1736)]);
    expect(of(inner)).toEqual([rect(242, 1736)]);
    expect(of(outer)).toEqual([]);
    expect(of(bare)).toEqual([]);
    expect(of(leaf(600))).toEqual([]); // a node of another read
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
