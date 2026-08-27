import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { inferScreenSize, inferScreenWidth } from '../../src/ui-tree/geometry.js';
import type { UiNode } from '../../src/adapters/types.js';

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

  it('ignores an off-viewport sibling parked at x = screen width', () => {
    const tree = treeWith(node({ x: 402, y: 0, width: 402, height: 874 }));
    expect(inferScreenSize(tree).width).toBe(402);
  });

  it('ignores an oversized node anchored at x=0 — the variant `reliable` cannot see', () => {
    const tree = treeWith(node({ x: 0, y: 0, width: 804, height: 874 }));
    expect(inferScreenSize(tree).width).toBe(402);
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
