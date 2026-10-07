import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import {
  absentFromViewport,
  containsPoint,
  inferScreenSize,
  inferScreenWidth,
  intersectsViewport,
  rectArea,
  rectsOverlap,
  shadowing,
} from '../../src/ui-tree/geometry.js';
import { KEYBOARD_ROLE, type UiNode } from '../../src/adapters/types.js';
import { node as uiNode } from '../helpers/fake.js';

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
    });
  });

  // Both of these assert the WHOLE answer on purpose. Asserting `.width` alone
  // let a later change turn "ignored" into "refused" without a test noticing
  // (caught in review 2026-08-27): the width was still 402, but `reliable` had
  // gone false and every png scale on the shape failed closed.
  it('ignores an off-viewport sibling parked at x = screen width', () => {
    const tree = treeWith(node({ x: 402, y: 0, width: 402, height: 874 }));
    expect(inferScreenSize(tree)).toEqual({ width: 402, height: 874, reliable: true, trustworthyHeight: true });
  });

  it('ignores an oversized node anchored at x=0 — the variant `reliable` cannot see', () => {
    const tree = treeWith(node({ x: 0, y: 0, width: 804, height: 874 }));
    expect(inferScreenSize(tree)).toEqual({ width: 402, height: 874, reliable: true, trustworthyHeight: true });
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
    expect(inferScreenSize(tree)).toEqual({ width: 402, height: 874, reliable: true, trustworthyHeight: true });
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

  it('inferScreenWidth stays the width half of the same answer', () => {
    expect(inferScreenWidth(treeWith())).toEqual({ width: 402, reliable: true });
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

describe('shadowing — the later content node drawn over a point (the dismissal picker\'s cover test, here since 2026-10-07)', () => {
  const P = { x: 100, y: 100 };
  /** A text node whose rect contains P, unless overridden. */
  const text = (partial: Partial<UiNode> = {}): UiNode => uiNode({ role: 'text', rect: { x: 50, y: 50, width: 100, height: 100 }, ...partial });
  const screen = (...children: UiNode[]): UiNode => uiNode({ role: 'container', rect: { x: 0, y: 0, width: 400, height: 800 }, children });
  const fullScreen = (partial: Partial<UiNode> = {}): UiNode => uiNode({ role: 'other', rect: { x: 0, y: 0, width: 400, height: 800 }, ...partial });

  it('nothing after the node: undefined — the ancestor, an earlier sibling and the node\'s own descendant all contain the point and none counts', () => {
    const target = text({ label: 'title', children: [text({ label: 'inner' })] });
    expect(shadowing(screen(text({ label: 'earlier' }), target), target, P)).toBeUndefined();
  });

  it('a later structural wrapper containing the point is not a cover (container or other), nor is a later zero-area node', () => {
    const target = text({ label: 'title' });
    const tree = screen(target, fullScreen(), fullScreen({ role: 'container' }), text({ rect: { x: 50, y: 50, width: 0, height: 100 } }));
    expect(shadowing(tree, target, P)).toBeUndefined();
  });

  it('a later non-structural node containing the point is the cover; with several, the LAST in pre-order — a later Window\'s content included', () => {
    const target = text({ label: 'title' });
    const alert = text({ label: 'Session expired' });
    const ok = uiNode({ role: 'button', label: 'OK', rect: { x: 90, y: 90, width: 20, height: 20 } });
    expect(shadowing(screen(target, alert), target, P)).toBe(alert);
    const tree = screen(target, alert, fullScreen({ children: [ok] }), text({ rect: { x: 200, y: 200, width: 10, height: 10 } }));
    expect(shadowing(tree, target, P)).toBe(ok);
  });

  it('a later node that reaches the point only on its exclusive right/bottom edge is not a cover', () => {
    const target = text({ label: 'title' });
    expect(shadowing(screen(target, text({ rect: { x: 0, y: 0, width: 100, height: 100 } })), target, P)).toBeUndefined();
  });

  it('keyboard-owned later nodes are NOT exempt: the band, and a key over the point, are covers (review 2026-10-07)', () => {
    const target = text({ label: 'title' });
    const band = uiNode({ role: KEYBOARD_ROLE, ofKeyboard: true, rect: { x: 0, y: 50, width: 400, height: 335 } });
    const key = uiNode({ role: 'button', label: 'q', ofKeyboard: true, rect: { x: 90, y: 90, width: 20, height: 20 } });
    expect(shadowing(screen(target, fullScreen({ ofKeyboard: true, children: [band] })), target, P)).toBe(band);
    expect(shadowing(screen(target, fullScreen({ ofKeyboard: true, children: [band, key] })), target, P)).toBe(key);
  });
});
