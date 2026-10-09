import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseWdaSource, parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import {
  absentFromViewport,
  containsPoint,
  inferScreenSize,
  intersectsViewport,
  rectArea,
  rectsOverlap,
  sameRect,
  sameRectWithinPixel,
  shadowing,
} from '../../src/ui-tree/geometry.js';
import { everyNode, KEYBOARD_ROLE, type UiNode } from '../../src/adapters/types.js';
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

  it('a later screen-sized HOST is not a cover by itself — the WDA SwiftUI toolbar host (docs/bugs/2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md)', () => {
    // The measured tree, abridged: the title in the top bar, then (pre-order) a 402×874 `toolbar 'Toolbar'`
    // holding a 402×874 container, then the host's hidden tab bar elsewhere.
    const full = { x: 0, y: 0, width: 402, height: 874 };
    const at = { x: 200, y: 84 };
    const title = uiNode({ role: 'text', label: 'SWIFT PAYMENT', identifier: 'swift_payment.form.title', rect: { x: 135, y: 73, width: 131, height: 22 } });
    const form = uiNode({ role: 'container', rect: full, children: [uiNode({ role: 'button', label: 'Continue to summary', rect: { x: 24, y: 512, width: 354, height: 44 } })] });
    const toolbar = (rect = full) => uiNode({ role: 'toolbar', label: 'Toolbar', identifier: 'Toolbar', rect, children: [uiNode({ role: 'container', rect })] });
    const home = uiNode({ role: 'button', label: 'Home', rect: { x: 69, y: 711, width: 67, height: 52 } });
    const app = (...children: UiNode[]) => uiNode({ role: 'application', rect: full, children });
    expect(shadowing(app(uiNode({ role: 'other', rect: full, children: [title, form, toolbar(), home] })), title, at)).toBeUndefined();
    // The screen is the ROOT's rect, not the largest: a tall scroll content (WDA keeps off-screen nodes) earlier in the tree does not shrink the host below it.
    const tall = uiNode({ role: 'scrollable', rect: { x: 0, y: 0, width: 402, height: 3000 } });
    expect(shadowing(app(tall, title, toolbar()), title, at)).toBeUndefined();
    // An inset host (402×820, 94 % of the screen: a status-bar inset) is still a host.
    expect(shadowing(app(title, toolbar({ x: 0, y: 54, width: 402, height: 820 })), title, { x: 200, y: 84 })).toBeUndefined();
    // Just under SCREEN_SIZED_FRACTION (0.9) it covers as itself: 402×786 is 89.9 %.
    const under = toolbar({ x: 0, y: 0, width: 402, height: 786 });
    expect(shadowing(app(title, under), title, at)).toBe(under);
  });

  it('the host rule\'s edge: exactly SCREEN_SIZED_FRACTION of the root is a host; a root with no rect falls back to the largest rect', () => {
    const target = text({ label: 'title' });
    const host = (height: number) => uiNode({ role: 'toolbar', rect: { x: 0, y: 0, width: 400, height }, children: [uiNode({ role: 'container', rect: { x: 0, y: 0, width: 400, height } })] });
    expect(shadowing(screen(target, host(720)), target, P)).toBeUndefined(); // 288000 = 0.9 × 320000
    const below = host(719);
    expect(shadowing(screen(target, below), target, P)).toBe(below);
    const rootless = (h: UiNode) => uiNode({ role: 'container', rect: { x: 0, y: 0, width: 0, height: 0 }, children: [fullScreen(), target, h] });
    expect(shadowing(rootless(host(800)), target, P)).toBeUndefined();
    const small = host(700);
    expect(shadowing(rootless(small), target, P)).toBe(small);
  });

  it('a screen-sized node that is interactive or childless still covers: a full-screen backdrop button (an RN transparent Modal\'s Pressable), an image, a text — but no longer a leaf toolbar (2026-10-09)', () => {
    const target = text({ label: 'title' });
    const rect = { x: 0, y: 0, width: 400, height: 800 };
    const backdrop = uiNode({ role: 'button', label: 'Close', rect, children: [text({ label: 'elsewhere', rect: { x: 0, y: 600, width: 400, height: 100 } })] });
    const image = uiNode({ role: 'image', rect });
    const leafText = text({ label: 'Terms', rect });
    expect(shadowing(screen(target, backdrop), target, P)).toBe(backdrop);
    expect(shadowing(screen(target, image), target, P)).toBe(image);
    expect(shadowing(screen(target, leafText), target, P)).toBe(leafText);
    // FLIPPED 2026-10-09 (docs/bugs/2026-10-09-ios-wda-childless-toolbar-refuses-keyboard-dismissal.md): this pin said a
    // childless screen-sized `toolbar` covers. It was the generic childless-node rule written with a toolbar, never a
    // measured toolbar that covered; the one device shape of it — UIKit's Contacts sheet under WDA — draws nothing over the
    // title, and refused every dismissal there. A toolbar with no items is not a cover (the itemless-toolbar rule below).
    expect(shadowing(screen(target, uiNode({ role: 'toolbar', rect })), target, P)).toBeUndefined();
  });

  /**
   * The Contacts "New Contact" sheet under WDA (UIKit, iPhone 17, iOS 27, 2026-10-09 05:30 UTC,
   * docs/bugs/2026-10-09-ios-wda-childless-toolbar-refuses-keyboard-dismissal.md), in pre-order after the title
   * `text 'New Contact' 149 89 104 22` (inside `container id:"New Contact" 0 78 402 54`): the form's `scrollable 0 62 402 812`
   * WITH children, then two CHILDLESS `toolbar 'Toolbar'`s, `0 83 402 48` and `0 62 402 812`; then the keyboard's band
   * `0 573 402 301`. Each toolbar alone contained the title's point (201,100) and refused the dismissal as covered.
   */
  describe('an itemless toolbar covers nothing, whatever its size (the Contacts sheet, 2026-10-09)', () => {
    const full = { x: 0, y: 0, width: 402, height: 874 };
    const at = { x: 201, y: 100 };
    const BAR = { x: 0, y: 83, width: 402, height: 48 };
    const SHEET = { x: 0, y: 62, width: 402, height: 812 };
    const title = uiNode({ role: 'text', label: 'New Contact', rect: { x: 149, y: 89, width: 104, height: 22 } });
    const titleBox = uiNode({ role: 'container', identifier: 'New Contact', rect: { x: 0, y: 78, width: 402, height: 54 }, children: [title] });
    const form = uiNode({ role: 'scrollable', rect: SHEET, children: [uiNode({ role: 'textfield', identifier: 'First name', rect: { x: 20, y: 300, width: 360, height: 44 } })] });
    const toolbar = (rect: UiNode['rect'], children: UiNode[] = []) => uiNode({ role: 'toolbar', label: 'Toolbar', rect, children });
    const band = uiNode({ role: KEYBOARD_ROLE, ofKeyboard: true, rect: { x: 0, y: 573, width: 402, height: 301 } });
    const app = (...after: UiNode[]) => uiNode({ role: 'application', rect: full, children: [uiNode({ role: 'other', rect: full, children: [titleBox, form, ...after] }), band] });

    it('the measured shape — both toolbars — and each alone: nothing covers the title', () => {
      expect(shadowing(app(toolbar(BAR), toolbar(SHEET)), title, at)).toBeUndefined();
      expect(shadowing(app(toolbar(BAR)), title, at)).toBeUndefined(); // the 48-pt one: a bar's size, which no screen-sized host rule would excuse
      expect(shadowing(app(toolbar(SHEET)), title, at)).toBeUndefined();
    });

    it('a toolbar with ANY item still covers as itself, at the bar\'s size — its item elsewhere, as the input-accessory bar\'s Done', () => {
      const withItem = toolbar(BAR, [uiNode({ role: 'button', label: 'Cancel', rect: { x: 16, y: 90, width: 60, height: 34 } })]);
      expect(shadowing(app(withItem), title, at)).toBe(withItem);
      const item = uiNode({ role: 'text', label: 'Draft', rect: { x: 150, y: 90, width: 100, height: 20 } });
      expect(shadowing(app(toolbar(SHEET, [item])), title, at)).toBe(item); // a screen-sized one: through its item at the point
    });

    it('the excuse is the toolbar\'s alone: a childless image or text of the same rect, and an interactive node, still cover', () => {
      const image = uiNode({ role: 'image', rect: BAR });
      const label = uiNode({ role: 'text', label: 'Toolbar', rect: BAR });
      const button = uiNode({ role: 'button', rect: BAR });
      for (const cover of [image, label, button]) expect(shadowing(app(toolbar(BAR), cover), title, at)).toBe(cover);
    });

    it('the measured input-accessory toolbar (wda-source-myport-2fa-keyboard-toolbar.json: Toolbar → Other → Button "Done") still covers what it is drawn over', async () => {
      const tree = parseWdaSource(await readFile(new URL('../fixtures/wda-source-myport-2fa-keyboard-toolbar.json', import.meta.url), 'utf8'));
      const nodes = [...everyNode(tree)];
      const accessory = nodes.find((n) => n.role === 'toolbar')!;
      expect(accessory.rect).toEqual({ x: 0, y: 518, width: 402, height: 48 });
      expect(accessory.children.length).toBeGreaterThan(0);
      // The app's support text {16,547,370,40} runs under the bar's slot (518–566). With the keyboard's band (its Window,
      // after the accessory's) taken out, so that only the bar can answer: the bar is what is drawn over the text.
      const text = nodes.find((n) => n.label?.startsWith('Pri probléme'))!;
      const withoutBand = { ...tree, children: tree.children.filter((w) => ![...everyNode(w)].some((n) => n.role === KEYBOARD_ROLE)) };
      expect(shadowing(withoutBand, text, { x: 200, y: 550 })).toBe(accessory);
    });
  });

  it('a screen-sized host with content over the point still covers, through that content', () => {
    const target = text({ label: 'title' });
    const message = text({ label: 'Session expired' });
    const host = (...children: UiNode[]) => uiNode({ role: 'toolbar', rect: { x: 0, y: 0, width: 400, height: 800 }, children });
    expect(shadowing(screen(target, host(message)), target, P)).toBe(message);
    expect(shadowing(screen(target, host(fullScreen({ children: [message] }))), target, P)).toBe(message);
    // WDA's alert shape (Alert → container, structural) over the point: its text covers, as before.
    expect(shadowing(screen(target, host(uiNode({ role: 'container', rect: { x: 60, y: 60, width: 280, height: 160 }, children: [message] }))), target, P)).toBe(message);
    // The accepted trade-off: the same host with nothing of its own at the point reads as not covering.
    expect(shadowing(screen(target, host(text({ label: 'elsewhere', rect: { x: 0, y: 600, width: 400, height: 100 } }))), target, P)).toBeUndefined();
  });

  /**
   * The device check at e9e6509 (the same bug note, "Device check"): with the toolbar host excused, the form's
   * `scrollable 0 0 402 512` — after the title in pre-order, 58 % of the screen, its frame under the translucent top
   * bar, its first row at y 150 — covered the title at (201,84). The measured tree, in its full shape.
   */
  describe('a scroll view with content covers only through that content, whatever its size (device check 2026-10-08)', () => {
    const full = { x: 0, y: 0, width: 402, height: 874 };
    const at = { x: 201, y: 84 };
    const title = uiNode({ role: 'text', label: 'SWIFT PAYMENT', identifier: 'swift_payment.form.title', rect: { x: 135, y: 73, width: 131, height: 22 } });
    const row = (identifier: string, y: number) => uiNode({ role: 'button', identifier, rect: { x: 16, y, width: 370, height: 52 } });
    const form = (...extra: UiNode[]) =>
      uiNode({ role: 'scrollable', rect: { x: 0, y: 0, width: 402, height: 512 }, children: [row('swift_payment.form.debit_select', 150), row('swift_payment.form.priority_select', 681), ...extra] });
    const toolbar = () => uiNode({ role: 'toolbar', label: 'Toolbar', identifier: 'Toolbar', rect: full, children: [uiNode({ role: 'container', rect: full })] });
    const keyboard = uiNode({ role: KEYBOARD_ROLE, ofKeyboard: true, rect: { x: 0, y: 572, width: 402, height: 302 } });
    const app = (...screenChildren: UiNode[]) => uiNode({ role: 'application', rect: full, children: [uiNode({ role: 'other', rect: full, children: screenChildren }), keyboard] });

    it('the full measured shape — title, container, the form\'s scrollable, the screen-sized toolbar, the keyboard: nothing covers the title', () => {
      expect(shadowing(app(title, uiNode({ role: 'container', rect: full, children: [form()] }), toolbar()), title, at)).toBeUndefined();
    });

    it('the scrollable alone after the title (no toolbar to shadow it — the case the first test missed): not a cover', () => {
      expect(shadowing(app(title, form()), title, at)).toBeUndefined();
    });

    it('its content at the point still covers — a row scrolled under the title, a sheet\'s list text — and is what is named', () => {
      const under = uiNode({ role: 'text', label: 'Debit account', rect: { x: 16, y: 70, width: 370, height: 30 } });
      expect(shadowing(app(title, form(under)), title, at)).toBe(under);
      expect(shadowing(app(title, form(under), toolbar()), title, at)).toBe(under);
    });

    it('a childless scrollable, an interactive node of the same size, a same-sized webview with content and a smaller card still cover as themselves', () => {
      const rect = { x: 0, y: 0, width: 402, height: 512 };
      const elsewhere = () => [row('elsewhere', 400)];
      const empty = uiNode({ role: 'scrollable', rect });
      const backdrop = uiNode({ role: 'button', rect, children: elsewhere() });
      const web = uiNode({ role: 'webview', rect, children: elsewhere() });
      const card = uiNode({ role: 'toolbar', rect: { x: 20, y: 60, width: 362, height: 200 }, children: elsewhere() });
      for (const cover of [empty, backdrop, web, card]) expect(shadowing(app(title, cover), title, at)).toBe(cover);
    });
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
