import { describe, expect, it } from 'vitest';
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

  it('marks the fallback height untrustworthy — the walk reports CONTENT height', () => {
    const tree = node({ x: 0, y: 0, width: 0, height: 0 }, null, [node({ x: 0, y: 0, width: 402, height: 6000 })]);
    expect(inferScreenSize(tree)).toMatchObject({ height: 6000, trustworthyHeight: false });
  });

  it('falls back to the widest rect when the root is the 0x0 synthetic one (idb, multi-root dumps)', () => {
    const tree = node({ x: 0, y: 0, width: 0, height: 0 }, null, [node(SCREEN), node(APPLY, 'apply')]);
    expect(inferScreenSize(tree)).toEqual({ width: 402, height: 874, reliable: true, trustworthyHeight: false });
  });

  it('flags a filtered tree in the fallback path', () => {
    const tree = node({ x: 0, y: 0, width: 0, height: 0 }, null, [node({ x: 16, y: 0, width: 370, height: 800 })]);
    expect(inferScreenSize(tree).reliable).toBe(false);
  });

  it('inferScreenWidth stays the width half of the same answer', () => {
    expect(inferScreenWidth(treeWith())).toEqual({ width: 402, reliable: true });
  });
});
