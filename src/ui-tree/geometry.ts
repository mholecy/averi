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
   * True when the widest rect starts at the left screen edge — that is the
   * root/window node. When it starts inset, the tree was filtered and the
   * width is a CONTENT width, which silently scales every delta.
   */
  reliable: boolean;
}

/** Screen width = widest rect in the whole tree (id-less root/window included). */
export function inferScreenWidth(tree: UiNode): ScreenWidth {
  let widest = tree.rect;
  const walk = (n: UiNode): void => {
    if (n.rect.x + n.rect.width > widest.x + widest.width) widest = n.rect;
    n.children.forEach(walk);
  };
  walk(tree);
  return { width: widest.x + widest.width, reliable: Math.abs(widest.x) < 1.0 };
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
