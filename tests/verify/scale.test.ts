import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { MAX_AXIS_SCALE_RATIO, pngScale, windowWidth } from '../../src/verify/scale.js';
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

/**
 * The rect denominator (2026-10-07, the parity review's P1): the window's
 * width, judged under the png scale's policy. Until then the rect table and
 * the `rect` assert read geometry.ts directly and kept a CONTENT width as a
 * remark — so a width `pngScale` refused on the same tree still divided
 * every rect delta, and a real defect could read WITHIN TOLERANCE.
 */
describe('windowWidth — the rect denominator, one trust policy with the scale', () => {
  /**
   * The false pass. idb's flat source under its 0x0 root, content inset 16pt
   * on a 402pt screen: the walk reads 384. A card drawn 368 wide against a
   * contract asking 385 of a 402 frame is -4.2 % of width; divided by 384 it
   * is +0.06 %, inside every tolerance.
   */
  const contentOnly = node({ x: 0, y: 0, width: 0, height: 0 }, [
    node({ x: 16, y: 100, width: 368, height: 600 }, [node({ x: 16, y: 120, width: 368, height: 100 })]),
  ]);

  it('refuses a CONTENT width — the width that turned a -4.2 % delta into +0.06 %', () => {
    const got = windowWidth(contentOnly, { width: 402, height: 874 });
    expect(got.width).toBeUndefined();
    expect(got.error).toMatch(/^screen width 384 is a CONTENT width, not the window width/);
    expect(got.error).toContain('app.ios.treeSource: wda');
  });

  it('refuses it in the png scale\'s exact words: one wording, two answers', () => {
    expect(windowWidth(contentOnly).error).toBe(pngScale(contentOnly, PNG_W, PNG_H).error);
    const flat = node({ x: 0, y: 0, width: 0, height: 0 }, [node({ x: 0, y: 0, width: 0, height: 0 })]);
    expect(windowWidth(flat).error).toBe(pngScale(flat, PNG_W, PNG_H).error);
    expect(windowWidth(flat).error).toMatch(/^screen width could not be inferred/);
  });

  it('a device screen cannot rescue a content width, even one that reaches the screen\'s right edge', () => {
    // Inset start, right edge at 402: a full-width screen and a right-hand
    // split-view window both look like this, and only one has 402 as its canvas.
    const rightEdge = node({ x: 0, y: 0, width: 0, height: 0 }, [node({ x: 16, y: 100, width: 386, height: 600 })]);
    expect(windowWidth(rightEdge, { width: 402, height: 874 }).error).toMatch(/CONTENT width/);
  });

  it('a window the device agrees with is measured with nothing to say', () => {
    expect(windowWidth(IOS, { width: 402, height: 874 })).toEqual({ width: 402 });
  });

  it('agreement holds in either orientation — there is no png here to orient the panel by', () => {
    const landscape = node({ x: 0, y: 0, width: 874, height: 402 });
    expect(windowWidth(landscape, { width: 402, height: 874 })).toEqual({ width: 874 });
  });

  it('stays the TREE\'s window when the device is wider: a split view is the canvas, the device only witnesses', () => {
    const half = node({ x: 0, y: 0, width: 402, height: 874 });
    const got = windowWidth(half, { width: 804, height: 1748 });
    expect(got.width).toBe(402);
    expect(got.note).toMatch(
      /^window 402 wide on a 804x1748 DEVICE screen — narrower than the short side a portrait window faces \(804\)/,
    );
  });

  it('refuses a window wider than the side it faces — hole 1, which a denominator cannot survive', () => {
    const pixelScale = node({ x: 0, y: 0, width: 1206, height: 2622 });
    expect(windowWidth(pixelScale, { width: 402, height: 874 }).error).toMatch(
      /^the tree's window is 1206 wide but the 402x874 device screen is 402 on the short side a portrait window faces/,
    );
  });

  /**
   * Review round 1: bounding by the LONGER side alone let a pixel-scale
   * window on an @2x 2:1 phone through — 828 < 896 — measured at half scale
   * under a "narrower than either side" note that was false on its face.
   */
  it('a portrait window is bounded by the SHORT side: 828 on a 414x896 @2x phone is refused, not noted', () => {
    const got = windowWidth(node({ x: 0, y: 0, width: 828, height: 1792 }), { width: 414, height: 896 });
    expect(got.width).toBeUndefined();
    expect(got.error).toMatch(/^the tree's window is 828 wide but the 414x896 device screen is 414 on the short side/);
  });

  // Code review 2026-10-07: landscape-SHAPED, yet exactly the short side wide.
  it('a top split pane that spans the short side is measured silently, not "narrower than the long side"', () => {
    expect(windowWidth(node({ x: 0, y: 0, width: 1080, height: 700 }), { width: 1080, height: 2400 })).toEqual({
      width: 1080,
    });
  });

  it('…but agreeing with the OTHER side never rescues a window wider than the side it faces', () => {
    // Portrait-shaped and exactly the long side wide: not a window on this panel.
    expect(windowWidth(node({ x: 0, y: 0, width: 874, height: 1000 }), { width: 402, height: 874 }).error).toMatch(
      /is 402 on the short side a portrait window faces/,
    );
  });

  // A foldable unfolded after the memoized read. The refusal no longer names
  // a remedy of its own: it is marked as the screen's, and its caller re-reads
  // the screen once and says what that found (capture.ts#ScreenWitness, A3).
  it('marks a wider-than-screen refusal as the screen\'s, so the caller can re-read it — and names no restart', () => {
    const got = windowWidth(node({ x: 0, y: 0, width: 1840, height: 2208 }), { width: 1080, height: 2340 });
    expect(got.widerThanScreen).toBe(true);
    expect(got.error).toMatch(/so every delta divided by it would be scaled wrong$/);
    expect(got.error).not.toMatch(/restart/);
    // A content-width refusal is the tree's: no fresh screen can lift it.
    expect(windowWidth(node({ x: 0, y: 0, width: 0, height: 0 }, [node({ x: 16, y: 100, width: 368, height: 600 })]), { width: 402, height: 874 }).widerThanScreen).toBeUndefined();
  });

  it('the bound is the agreement allowance over the side faced, pinned at its edge, in both orientations', () => {
    const at = (width: number, height: number) => windowWidth(node({ x: 0, y: 0, width, height }), { width: 300, height: 400 });
    expect(at(306, 400).error).toBeUndefined(); // portrait, 2 % over the short side: rounding
    expect(at(307, 400).error).toMatch(/is 300 on the short side a portrait window faces/);
    expect(at(408, 300).error).toBeUndefined(); // landscape, 2 % over the long side
    expect(at(409, 300).error).toMatch(/is 400 on the long side a landscape window faces/);
  });

  describe('the walked fallback — no window rect, so no orientation', () => {
    // A bar is never a window candidate, so these trees reach the walk, and an
    // origin-anchored maximum with nothing screen-shaped beside it is trusted.
    const walked = (width: number) => node({ x: 0, y: 0, width: 0, height: 0 }, [node({ x: 0, y: 0, width, height: 50 })]);
    const SCREEN = { width: 402, height: 874 };

    it('keeps the longer side as its bound', () => {
      expect(windowWidth(walked(900), SCREEN).error).toMatch(/is at most 874 in either orientation/);
      expect(windowWidth(walked(874), SCREEN)).toEqual({ width: 874 });
      expect(windowWidth(walked(402), SCREEN)).toEqual({ width: 402 });
    });

    it('says a width between the two sides is between them, not narrower than either', () => {
      const got = windowWidth(walked(600), SCREEN);
      expect(got.width).toBe(600);
      expect(got.note).toMatch(/— wider than its short side \(402\) and narrower than its long side \(874\), and the tree has no window rect/);
    });

    it('calls a width under both sides narrower than either', () => {
      expect(windowWidth(walked(300), SCREEN).note).toMatch(/— narrower than either side, so the deltas/);
    });
  });

  /**
   * Review round 1: a single-root uiautomator dump of a letterboxed app,
   * [135,0][945,1800] on a 1080-wide panel, starts inset by design. It is
   * refused like any content width — and the remedy must not send an
   * Android run to an iOS tree-source setting.
   */
  it('refuses an Android letterboxed window with an Android remedy beside the iOS one', () => {
    const letterbox = node({ x: 135, y: 0, width: 810, height: 1800 });
    const got = windowWidth(letterbox, { width: 1080, height: 1800 });
    expect(got.error).toMatch(/^screen width 945 is a CONTENT width/);
    expect(got.error).toMatch(/On Android an inset start is usually the app's own window, letterboxed or freeform/);
    expect(got.error).toMatch(/On iOS the default idb source/);
  });

  it('says so when nothing witnessed it: no screen, or one that cannot be divided by', () => {
    for (const screen of [undefined, { width: 0, height: 874 }, { width: Number.NaN, height: 874 }]) {
      expect(windowWidth(IOS, screen)).toEqual({
        width: 402,
        note: expect.stringMatching(/^window width from the UI tree alone — no usable device screen size/),
      });
    }
  });
});

/**
 * The parity code review's A1/A2 (2026-10-07): an Android app window laid
 * out BESIDE a side navigation bar or a display cutout in landscape. Numbers
 * of a 2400x1080 phone (`wm size` reports it portrait, as built): a 3-button
 * nav bar 126–168 px, a cutout 80–130 px. uiautomator's root is the app
 * window, so a window beside a left-hand bar starts inset — which the walk
 * alone calls a CONTENT width — and one beside a right-hand bar ends short
 * of the long side, which read as "split view?".
 */
describe('windowWidth — an Android window beside its system bars (A1, A2)', () => {
  const ANDROID = { width: 1080, height: 2400, windowsBesideSystemBars: true };
  const IOS_SCREEN = { width: 402, height: 874 };
  /** uiautomator's single root — the app window — over a little content inside it. */
  const appWindow = (x: number, width: number, height = 1080, y = 0) =>
    node({ x, y, width, height }, [node({ x: x + 40, y: y + 100, width: width - 80, height: 200 })]);

  it('notch on the left (ROTATION_90, no cutout drawing): measured at its own width, its left edge carried', () => {
    expect(windowWidth(appWindow(110, 2290), ANDROID)).toEqual({ width: 2290, left: 110 });
  });

  it('3-button nav on the left (seascape): measured, left edge carried', () => {
    expect(windowWidth(appWindow(168, 2232), ANDROID)).toEqual({ width: 2232, left: 168 });
  });

  it('notch left AND nav right — the common 3-button landscape: measured', () => {
    expect(windowWidth(appWindow(110, 2164), ANDROID)).toEqual({ width: 2164, left: 110 });
  });

  it('3-button nav on the right: measured silently, not "narrower … (split view?)" (A2)', () => {
    expect(windowWidth(appWindow(0, 2274), ANDROID)).toEqual({ width: 2274 });
    expect(windowWidth(appWindow(0, 2232), ANDROID)).toEqual({ width: 2232 });
  });

  it('a multi-window dump (a rectless root): the inset app window beside the nav bar\'s own window is measured', () => {
    const dump = node({ x: 0, y: 0, width: 0, height: 0 }, [node({ x: 0, y: 0, width: 126, height: 1080 }), appWindow(126, 2274)]);
    expect(windowWidth(dump, ANDROID)).toEqual({ width: 2274, left: 126 });
  });

  it('needs the device witness: with no screen, or an iOS one, the inset window is a CONTENT width as before', () => {
    expect(windowWidth(appWindow(110, 2290)).error).toMatch(/^screen width 2400 is a CONTENT width/);
    expect(windowWidth(appWindow(110, 2290), { width: 1080, height: 2400 }).error).toMatch(/CONTENT width/);
  });

  it('the P1 false pass stays refused: 0x0 root over content 16→384 on a 402-pt screen, iOS or flagged', () => {
    const contentOnly = node({ x: 0, y: 0, width: 0, height: 0 }, [
      node({ x: 16, y: 100, width: 368, height: 600 }, [node({ x: 16, y: 120, width: 368, height: 100 })]),
    ]);
    expect(windowWidth(contentOnly, IOS_SCREEN).error).toMatch(/^screen width 384 is a CONTENT width/);
    // Even a screen that says windows may sit beside bars: the shape is portrait, and only landscape windows do.
    expect(windowWidth(contentOnly, { ...IOS_SCREEN, windowsBesideSystemBars: true }).error).toMatch(/CONTENT width/);
    // A full-height portrait column inset 16 is still content.
    const column = node({ x: 0, y: 0, width: 0, height: 0 }, [node({ x: 16, y: 0, width: 368, height: 874 })]);
    expect(windowWidth(column, { ...IOS_SCREEN, windowsBesideSystemBars: true }).error).toMatch(/CONTENT width/);
  });

  it('iOS landscape content inside the safe area (59 pt each side, full height) is never the window', () => {
    const idbFlat = node({ x: 0, y: 0, width: 0, height: 0 }, [node({ x: 59, y: 0, width: 756, height: 402 })]);
    expect(windowWidth(idbFlat, IOS_SCREEN).error).toMatch(/CONTENT width/);
  });

  it('a window that does not span the full short side is not beside bars: refused (inset) or noted (at the origin)', () => {
    expect(windowWidth(appWindow(126, 2274, 1017, 63), ANDROID).error).toMatch(/CONTENT width/);
    expect(windowWidth(appWindow(126, 2274, 540), ANDROID).error).toMatch(/CONTENT width/);
  });

  it('a genuine split-screen pane is still noted, and a letterboxed portrait app still refused', () => {
    const leftPane = windowWidth(appWindow(0, 1190), ANDROID);
    expect(leftPane.width).toBe(1190);
    expect(leftPane.note).toMatch(/narrower than the long side a landscape window faces \(2400\).*split view\?/);
    expect(windowWidth(appWindow(1210, 1190), ANDROID).error).toMatch(/CONTENT width/);
    expect(windowWidth(appWindow(660, 1080, 1080), ANDROID).error).toMatch(/CONTENT width/); // square, not landscape
  });

  it('only a LANDSCAPE-shaped window can sit beside bars: on a near-square foldable a portrait-shaped inset rect stays refused', () => {
    // 1840x2208 inner screen: gaps of 200/208 are under 10 % of 2208, and the
    // rect spans the short side — only its shape says it is not a window beside bars.
    const foldable = { width: 1840, height: 2208, windowsBesideSystemBars: true };
    expect(windowWidth(appWindow(200, 1800, 1840), foldable).error).toMatch(/CONTENT width/);
    expect(windowWidth(appWindow(126, 2082, 1840), foldable)).toEqual({ width: 2082, left: 126 });
  });

  it('the bar bound is 10 % of the long side, pinned at its edge on both sides', () => {
    expect(windowWidth(appWindow(240, 2160), ANDROID)).toEqual({ width: 2160, left: 240 });
    expect(windowWidth(appWindow(241, 2159), ANDROID).error).toMatch(/CONTENT width/);
    expect(windowWidth(appWindow(0, 2160), ANDROID)).toEqual({ width: 2160 });
    expect(windowWidth(appWindow(0, 2159), ANDROID).note).toMatch(/split view\?/);
  });

  it('the png scale\'s cross-check says nothing about a bar-narrowed window either', () => {
    expect(pngScale(appWindow(0, 2274), 2400, 1080, ANDROID)).toEqual({ scale: 1, width: 2400 });
    expect(pngScale(appWindow(0, 2274), 2400, 1080, { width: 1080, height: 2400 }).note).toMatch(/split view\?/);
  });
});

describe('pngScale — the plausibility note (moved from color-parity.ts, 2026-10-07)', () => {
  it('notes a scale outside [0.5, 4] beside the derivation\'s own note, never refusing it', () => {
    const tiny = node({ x: 0, y: 0, width: 100, height: 200 });
    const got = pngScale(tiny, 800, 1600);
    expect(got.scale).toBe(8);
    expect(got.note).toBe(
      'scaled from the UI tree — no usable device screen size, so a node that is not the window could still inflate it; ' +
        'scale 8.000 outside [0.5, 4] — wrong png/tree pairing?',
    );
  });

  it('stands alone when the derivation had nothing to say', () => {
    const got = pngScale(node({ x: 0, y: 0, width: 100, height: 200 }), 800, 1600, { width: 100, height: 200 });
    expect(got.note).toBe('scale 8.000 outside [0.5, 4] — wrong png/tree pairing?');
  });

  it('says nothing more inside the range, at either edge', () => {
    expect(pngScale(IOS, 201, 437).note).toMatch(/^scaled from the UI tree[^;]*$/); // 0.5
    expect(pngScale(IOS, 1608, 3496).note).toMatch(/^scaled from the UI tree[^;]*$/); // 4.0
    expect(pngScale(IOS, PNG_W, PNG_H, { width: 402, height: 874 }).note).toBeUndefined();
  });
});
