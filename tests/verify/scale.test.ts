import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { MAX_AXIS_SCALE_RATIO, pngScale } from '../../src/verify/scale.js';
import type { UiNode } from '../../src/adapters/types.js';

/**
 * The points→pixels scale, the number the 2026-08-26 iOS crop bug got wrong
 * (docs/bugs/2026-08-26-ios-ocr-crop-scale.md). Two failure directions are
 * pinned here, and so is what the tree can and cannot see on its own — a check
 * whose blind spots are undocumented is a check nobody can trust.
 *
 * The follow-up (docs/bugs/2026-08-26-png-scale-needs-out-of-tree-screen-size.md)
 * adds the device's own screen size as the first source. The tree paths are
 * kept and still tested: the device read can fail, and a failed read must
 * degrade to the old behavior rather than take an assert down.
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
    expect(pngScale(IOS, PNG_W, PNG_H)).toMatchObject({ scale: 3, width: 402 });
  });

  it('is unmoved by the off-viewport sibling a modal sheet leaves in the tree', () => {
    const sheet = node({ x: 0, y: 0, width: 402, height: 874 }, [
      node({ x: 402, y: 0, width: 402, height: 874 }),
    ]);
    expect(pngScale(sheet, PNG_W, PNG_H)).toMatchObject({ scale: 3, width: 402 });
  });

  it('handles landscape, where both axes swap together', () => {
    const landscape = node({ x: 0, y: 0, width: 874, height: 402 });
    expect(pngScale(landscape, 2622, 1206)).toMatchObject({ scale: 3, width: 874 });
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
    expect(pngScale(inset, 1080, 2400)).toMatchObject({ scale: 1, width: 1080 });
  });

  it('accepts a gesture-bar inset, the tightest real case (1080x2356)', () => {
    expect(pngScale(node({ x: 0, y: 0, width: 1080, height: 2356 }), 1080, 2400).scale).toBe(1);
  });

  it('accepts a png SHORTER than the screen — a band capture, which the clamp handles', () => {
    expect(pngScale(IOS, PNG_W, 180)).toMatchObject({ scale: 3, width: 402 });
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

describe('pngScale — the holes, and what the device screen does to them', () => {
  /** iPhone 17 simulator as `idb describe` reports it: points, portrait. */
  const SCREEN = { width: 402, height: 874 };

  /**
   * Case 3 of the bug doc's table, and hole 1 of the 0.5.0 fix. The tree can
   * no longer tell which origin-anchored child is the window, so it hands the
   * WIDEST to the axis check — which fails closed rather than scaling by it.
   * Loud and wrong-free beats the silent 1.5x this used to return.
   */
  it('a rootless tree with an oversized node at x=0 now fails closed instead of scaling by it', () => {
    const idb = node({ x: 0, y: 0, width: 0, height: 0 }, [
      node({ x: 0, y: 0, width: 402, height: 874 }),
      node({ x: 0, y: 0, width: 804, height: 874 }),
    ]);
    expect(pngScale(idb, PNG_W, PNG_H).error).toMatch(/1\.500 across but 3\.000 down/);
    // …and with the device screen it is simply right.
    expect(pngScale(idb, PNG_W, PNG_H, SCREEN)).toMatchObject({ scale: 3, width: 402 });
  });

  /**
   * Hole 2. From a tree alone a window narrower than the capture is
   * indistinguishable from a correct one — no tree knows the screen. The
   * device does, and the note says which reading was used.
   */
  it('a window narrower than the screenshot still sails through the TREE path', () => {
    const pane = node({ x: 0, y: 0, width: 507, height: 834 });
    expect(pngScale(pane, 2224, 1668).error).toBeUndefined();
  });

  /**
   * A THIRD hole, found in review 2026-08-27 and left open knowingly: a
   * partial capture whose aspect happens to match the device rotated is
   * indistinguishable from an actual rotation. 1206x555 fits the rotated
   * 402x874 screen to within 1.0005, so it is read as landscape and scaled by
   * 1.38 where a full capture would scale by 3.0. Nothing in the png or the
   * device says which it is. It stays open because production captures come
   * from `adapter.screenshot()`, which is always the whole screen — if that
   * ever changes, this is the test that should start failing.
   */
  it('does NOT catch a band crop whose aspect matches the device rotated', () => {
    expect(pngScale(IOS, 1206, 555, { width: 402, height: 874 })).toMatchObject({ width: 874 });
  });

  /**
   * A FOURTH hole, named in review 2026-08-27 and left open with its eyes
   * open. A left|right split screen — two window-sized panes, the second
   * starting exactly at the first's right edge — is BYTE-IDENTICAL in geometry
   * to the iOS sheet class, where the node at x=screenWidth is off-viewport
   * junk that must be ignored. The tree cannot tell them apart, so it reads
   * the measured case: 2208x1840 of two 1104-wide panes scales by 2.0 (a
   * full-screen reading would be 1.0). 0.5.0 refused this shape, which was
   * accidental rather than principled — it refused the sheet class too.
   * The device screen resolves it, and says the tree disagreed.
   */
  it('does NOT catch a left|right split screen on the tree path', () => {
    const split = node({ x: 0, y: 0, width: 0, height: 0 }, [
      node({ x: 0, y: 0, width: 1104, height: 1840 }),
      node({ x: 1104, y: 0, width: 1104, height: 1840 }),
    ]);
    expect(pngScale(split, 2208, 1840)).toMatchObject({ scale: 2, width: 1104 });
    const withDevice = pngScale(split, 2208, 1840, { width: 2208, height: 1840 });
    expect(withDevice).toMatchObject({ scale: 1, width: 2208 });
    expect(withDevice.note).toMatch(/the tree reads 1104 — 50\.0% apart/);
  });

  it('the device screen scales an iPad split-view pane by the SCREEN and says the two disagree', () => {
    const pane = node({ x: 0, y: 0, width: 507, height: 834 });
    const got = pngScale(pane, 2224, 1668, { width: 1112, height: 834 });
    expect(got).toMatchObject({ scale: 2, width: 1112 });
    expect(got.note).toMatch(/DEVICE screen; the tree reads 507 — 54\.4% apart/);
  });
});

describe('pngScale — the device screen', () => {
  const SCREEN = { width: 402, height: 874 };

  it('scales by the device even when the tree is hopeless', () => {
    const filtered = node({ x: 0, y: 0, width: 0, height: 0 }, [node({ x: 16, y: 0, width: 370, height: 800 })]);
    expect(pngScale(filtered, PNG_W, PNG_H, SCREEN)).toMatchObject({ scale: 3, width: 402 });
    expect(pngScale(node({ x: 0, y: 0, width: 0, height: 0 }), PNG_W, PNG_H, SCREEN)).toMatchObject({ scale: 3 });
  });

  it('says nothing when the tree agrees, and says what it did when it does not', () => {
    expect(pngScale(IOS, PNG_W, PNG_H, SCREEN).note).toBeUndefined();
    const inflated = node({ x: 0, y: 0, width: 804, height: 874 });
    expect(pngScale(inflated, PNG_W, PNG_H, SCREEN).note).toMatch(/tree reads 804 — 100\.0% apart/);
  });

  it('rotates with the capture when the tree agrees it is a rotation', () => {
    const landscape = node({ x: 0, y: 0, width: 874, height: 402 });
    expect(pngScale(landscape, 2622, 1206, SCREEN)).toMatchObject({ scale: 3, width: 874 });
  });

  it('does NOT rotate for a band-shaped capture, where only the png looks landscape', () => {
    expect(pngScale(IOS, PNG_W, 180, SCREEN)).toMatchObject({ scale: 3, width: 402 });
  });

  /**
   * Found in review 2026-08-27. An earlier draft let the TREE vote on whether
   * a landscape png was a rotation; a scroll container that won the window
   * tie-break made the tree read "portrait", the swap was refused, and the
   * crop scaled by 6.522 instead of 3.0 — in the across direction, which the
   * one-sided check below cannot see. Supplying the device screen was WORSE
   * than withholding it. Aspect agreement decides it now, with no witness.
   */
  it('rotates on a landscape capture even when the tree reads portrait', () => {
    const landscape = node({ x: 0, y: 0, width: 0, height: 0 }, [
      node({ x: 0, y: 0, width: 874, height: 402 }),
      node({ x: 0, y: 0, width: 874, height: 6000 }), // scroll content: tree reads 874x6000
    ]);
    expect(pngScale(landscape, 2622, 1206, SCREEN)).toMatchObject({ scale: 3, width: 874 });
    // …and the tree-only path, which 0.5.0 also got right, still does.
    expect(pngScale(landscape, 2622, 1206)).toMatchObject({ scale: 3, width: 874 });
  });

  it('leaves a near-square capture alone — neither orientation agrees better', () => {
    const ipad = node({ x: 0, y: 0, width: 1024, height: 1366 });
    expect(pngScale(ipad, 2048, 2732, { width: 1024, height: 1366 })).toMatchObject({ scale: 2, width: 1024 });
  });

  it('fails closed on a png that cannot be this screen', () => {
    expect(pngScale(IOS, PNG_W, PNG_H * 2, SCREEN).error).toMatch(/do not describe the same capture/);
  });

  it('falls back to the tree when the device size is degenerate', () => {
    // …and says so, which keying the note off `screen === undefined` did not:
    // a size that WAS supplied and was unusable is the case worth admitting to.
    const degenerate = pngScale(IOS, PNG_W, PNG_H, { width: 0, height: 874 });
    expect(degenerate).toMatchObject({ scale: 3, width: 402 });
    expect(degenerate.note).toMatch(/no usable device screen size/);
    expect(pngScale(IOS, PNG_W, PNG_H, { width: Number.NaN, height: 874 })).toMatchObject({ scale: 3, width: 402 });
  });
});

describe('pngScale — the thresholds, pinned at their edges', () => {
  const SCREEN = { width: 402, height: 874 };

  it('rotates at the rotation bound and refuses just past it, by name', () => {
    // 2753x1206 fits the rotated screen to 1.0499; 2760x1206 to 1.0526.
    expect(pngScale(IOS, 2753, 1206, SCREEN)).toMatchObject({ width: 874 });
    expect(pngScale(IOS, 2760, 1206, SCREEN).error).toMatch(/only when rotated/);
  });

  it('lets a band capture through, which is what keeps the refusal narrow', () => {
    // Wide and short like a rotation, but fitting NEITHER orientation — the
    // shape this package's own test captures have.
    expect(pngScale(IOS, PNG_W, 180, SCREEN)).toMatchObject({ scale: 3, width: 402 });
  });

  it('tolerates content peeking 10% past the window and refuses 11%', () => {
    const peeking = node({ x: 0, y: 0, width: 0, height: 0 }, [
      node({ x: 0, y: 0, width: 402, height: 874 }),
      node({ x: 380, y: 0, width: 62, height: 100 }), // 442 = 402 x 1.099
    ]);
    expect(pngScale(peeking, PNG_W, PNG_H)).toMatchObject({ scale: 3, width: 402 });
    const contradicting = node({ x: 0, y: 0, width: 0, height: 0 }, [
      node({ x: 0, y: 0, width: 402, height: 874 }),
      node({ x: 380, y: 0, width: 65, height: 100 }), // 445 = 402 x 1.107
    ]);
    expect(pngScale(contradicting, PNG_W, PNG_H).error).toMatch(/CONTENT width/);
  });

  it('keeps a 3:1 candidate and drops a flatter one — the bar bound', () => {
    const flat = (height: number) =>
      node({ x: 0, y: 0, width: 0, height: 0 }, [
        node({ x: 0, y: 0, width: 1080, height }),
        node({ x: 0, y: height, width: 1080, height: 2400 - height }),
      ]);
    // 360 tall is exactly 3:1 — still a candidate, and being wrong about the
    // screen it fails closed on the axis check rather than scaling by it.
    expect(pngScale(flat(360), 1080, 2400).error).toMatch(/do not describe the same screen/);
    // 359 is a bar: ignored, and the walk answers correctly.
    expect(pngScale(flat(359), 1080, 2400)).toMatchObject({ scale: 1, width: 1080 });
  });
});

describe('pngScale on the real iOS filter-sheet dump', () => {
  it('yields 3.0 — the assert that fails closed in 0.5.0 — from the tree and from the device alike', async () => {
    const payload = JSON.parse(
      await readFile(new URL('../fixtures/wda-source-filter-sheet.json', import.meta.url), 'utf8'),
    ) as unknown;
    const tree = parseWdaSourceValue(payload);
    expect(pngScale(tree, PNG_W, PNG_H)).toMatchObject({ scale: 3, width: 402 });
    expect(pngScale(tree, PNG_W, PNG_H, { width: 402, height: 874 })).toMatchObject({ scale: 3, width: 402 });
  });
});
