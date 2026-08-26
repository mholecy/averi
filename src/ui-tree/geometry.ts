import type { UiNode } from '../adapters/types.js';

/**
 * Geometry questions asked of a normalized UI tree, independent of what the
 * answers are used for. Both parity comparators (rect and color) need the same
 * two: how wide is the screen, and where is each identified element.
 *
 * These live here rather than in verify/ because they walk a `UiNode` and know
 * nothing about contracts, tolerances or findings — the same reason
 * intersectsViewport and tapPoint live in this package.
 */

type Rect = UiNode['rect'];

export interface ScreenWidth {
  width: number;
  /**
   * True when the numbers describe the WINDOW rather than some subset of it.
   * False means the widest rect starts inset — the tree was filtered and the
   * width is a CONTENT width, which silently scales every delta.
   */
  reliable: boolean;
}

export interface ScreenSize extends ScreenWidth {
  /**
   * CONTENT height unless `trustworthyHeight` says otherwise: the fallback
   * walk reports the lowest bottom edge in the tree, which a scroll view's
   * off-screen content inflates without limit.
   */
  height: number;
  /**
   * True when `height` is the window's own, not a walked maximum — i.e. it
   * came from the root rect. Callers that divide by the height (the png-scale
   * cross-check) must not run without it.
   */
  trustworthyHeight: boolean;
}

/**
 * Screen size from the tree.
 *
 * The ROOT rect wins when it is a real origin-anchored window, because it is
 * the only node guaranteed to be the screen: WDA's `Application` and
 * uiautomator's hierarchy root both report exactly that. The widest-rect walk
 * is a FALLBACK for the tree sources that have no usable root — idb's flat
 * `describe-all` is normalized under a synthetic 0x0 root (adapters/ios.ts),
 * as is uiautomator's multi-root dump (adapters/android.ts).
 *
 * Preferring the root is not a tidy-up. iOS keeps off-viewport nodes in the
 * tree with negative or oversized rects, so with a modal sheet presented the
 * widest rect can be an off-screen sibling at x=screenWidth — which doubles
 * the inferred width, halves every png scale derived from it, and crops the
 * wrong band of the screenshot (docs/bugs/2026-08-26-ios-ocr-crop-scale.md).
 */
export function inferScreenSize(tree: UiNode): ScreenSize {
  const root = tree.rect;
  if (root.width > 0 && root.height > 0 && Math.abs(root.x) < 1.0 && Math.abs(root.y) < 1.0) {
    return { width: root.width, height: root.height, reliable: true, trustworthyHeight: true };
  }
  let widest = root;
  let tallest = root;
  const walk = (n: UiNode): void => {
    if (n.rect.x + n.rect.width > widest.x + widest.width) widest = n.rect;
    if (n.rect.y + n.rect.height > tallest.y + tallest.height) tallest = n.rect;
    n.children.forEach(walk);
  };
  walk(tree);
  return {
    width: widest.x + widest.width,
    height: tallest.y + tallest.height,
    reliable: Math.abs(widest.x) < 1.0,
    trustworthyHeight: false,
  };
}

/** Screen width alone, for the callers that never touch a screenshot. */
export function inferScreenWidth(tree: UiNode): ScreenWidth {
  const { width, reliable } = inferScreenSize(tree);
  return { width, reliable };
}

/** {id → rect} for the FIRST occurrence of each identifier (pre-order). */
export function collectRects(tree: UiNode): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const walk = (n: UiNode): void => {
    if (n.identifier !== null && n.identifier !== '' && !out.has(n.identifier)) {
      out.set(n.identifier, n.rect);
    }
    n.children.forEach(walk);
  };
  walk(tree);
  return out;
}
