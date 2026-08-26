import { describe, expect, it } from 'vitest';
import { MAX_AXIS_SCALE_RATIO, pngScale } from '../../src/verify/scale.js';
import type { UiNode } from '../../src/adapters/types.js';

/**
 * The points→pixels scale, the number the 2026-08-26 iOS crop bug got wrong
 * (docs/bugs/2026-08-26-ios-ocr-crop-scale.md). Two failure directions are
 * pinned here, and so are the two the guard deliberately does NOT catch —
 * a check whose blind spots are undocumented is a check nobody can trust.
 */

const node = (rect: UiNode['rect'], children: UiNode[] = []): UiNode => ({
  role: 'other',
  label: null,
  identifier: null,
  value: null,
  rect,
  children,
});

/** iPhone 17 simulator: 402x874pt window, 3x screenshot. */
const IOS = node({ x: 0, y: 0, width: 402, height: 874 });
const PNG_W = 1206;
const PNG_H = 2622;

describe('pngScale — the happy path', () => {
  it('derives 3x from an iPhone window and its screenshot', () => {
    expect(pngScale(IOS, PNG_W, PNG_H)).toEqual({ scale: 3, width: 402 });
  });

  it('is unmoved by the off-viewport sibling a modal sheet leaves in the tree', () => {
    const sheet = node({ x: 0, y: 0, width: 402, height: 874 }, [
      node({ x: 402, y: 0, width: 402, height: 874 }),
    ]);
    expect(pngScale(sheet, PNG_W, PNG_H)).toEqual({ scale: 3, width: 402 });
  });

  it('handles landscape, where both axes swap together', () => {
    const landscape = node({ x: 0, y: 0, width: 874, height: 402 });
    expect(pngScale(landscape, 2622, 1206)).toEqual({ scale: 3, width: 874 });
  });
});

describe('pngScale — what it must NOT reject', () => {
  /**
   * The regression the axis check nearly introduced: uiautomator returns a
   * single-window dump's root directly, and a non-edge-to-edge app window
   * excludes the status and navigation bars. Width-only scaling was CORRECT
   * for these; a tight aspect tolerance would have failed them closed.
   */
  it('accepts an Android window inset by the system bars (1080x2274 of a 1080x2400 capture)', () => {
    const inset = node({ x: 0, y: 0, width: 1080, height: 2274 });
    expect(pngScale(inset, 1080, 2400)).toEqual({ scale: 1, width: 1080 });
  });

  it('accepts a gesture-bar inset, the tightest real case (1080x2356)', () => {
    expect(pngScale(node({ x: 0, y: 0, width: 1080, height: 2356 }), 1080, 2400).scale).toBe(1);
  });

  it('accepts a png SHORTER than the screen — a band capture, which the clamp handles', () => {
    expect(pngScale(IOS, PNG_W, 180)).toEqual({ scale: 3, width: 402 });
  });

  it('passes AT the ratio and fails just past it', () => {
    // scaleX is 3 (1206/402), so a png this tall makes scaleY exactly 3 x the limit.
    const atLimit = Math.round(874 * 3 * MAX_AXIS_SCALE_RATIO);
    expect(pngScale(IOS, PNG_W, atLimit).scale).toBe(3);
    expect(pngScale(IOS, PNG_W, atLimit + 30).error).toMatch(/do not describe the same screen/);
  });
});

describe('pngScale — failing closed', () => {
  it('rejects an inflated width: the same 1.5x the [0.5, 4.0] range check waved through', () => {
    const inflated = node({ x: 0, y: 0, width: 804, height: 874 });
    const got = pngScale(inflated, PNG_W, PNG_H);
    expect(got.scale).toBeUndefined();
    expect(got.error).toMatch(/1\.500 across but 3\.000 down/);
    expect(got.error).toMatch(/off-viewport node counted as the screen/);
  });

  it('names both readings, because the aspect alone cannot tell them apart', () => {
    const half = node({ x: 0, y: 0, width: 1080, height: 1200 });
    expect(pngScale(half, 1080, 2400).error).toMatch(/width is inflated.*or the window covers only part/s);
  });

  it('rejects a filtered tree rather than scaling by a content width', () => {
    const filtered = node({ x: 0, y: 0, width: 0, height: 0 }, [node({ x: 16, y: 0, width: 370, height: 800 })]);
    expect(pngScale(filtered, PNG_W, PNG_H).error).toMatch(/CONTENT width/);
  });

  it('rejects a 0-wide tree and a degenerate png', () => {
    expect(pngScale(node({ x: 0, y: 0, width: 0, height: 0 }), PNG_W, PNG_H).error).toMatch(/could not be inferred/);
    expect(pngScale(IOS, 0, PNG_H).error).toMatch(/degenerate dimensions/);
    expect(pngScale(IOS, PNG_W, Number.NaN).error).toMatch(/degenerate dimensions/);
  });
});

describe('pngScale — the holes, pinned so they stay known', () => {
  /**
   * Case 3 of the bug doc's table. With no usable root there is no
   * trustworthy height, so the axis check cannot run and an oversized node at
   * x=0 still halves the scale. Shutting this needs a screen size from
   * outside the tree; until then it is documented, not fixed.
   */
  it('does NOT catch an oversized node at x=0 on a rootless (idb) tree', () => {
    const idb = node({ x: 0, y: 0, width: 0, height: 0 }, [
      node({ x: 0, y: 0, width: 402, height: 874 }),
      node({ x: 0, y: 0, width: 804, height: 874 }),
    ]);
    expect(pngScale(idb, PNG_W, PNG_H)).toEqual({ scale: 1.5, width: 804 });
  });

  /** The mirror image: a window narrower than the capture reads as too large. */
  it('does NOT catch a window narrower than the screenshot (iPad split view)', () => {
    const pane = node({ x: 0, y: 0, width: 507, height: 834 });
    expect(pngScale(pane, 2224, 1668).error).toBeUndefined();
  });
});
