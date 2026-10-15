import { everyNode, rectArea, SCREEN_SIZED_FRACTION, type Rect, type UiNode } from '../adapters/types.js';

/**
 * WHERE A NODE LIES in draw order's walk (draw-order.ts#drawOrder, `Placed`), and the predicates asked of it both by
 * draw order's rows (draw-order.ts#NOT_DRAWN) and by the shape fallback for presented screens (presented-by-shape.ts):
 * the frame predicates (`fillsScreen`, `CONTENT_FRAMED_ROLES`, `emptyFrame`, `framesOnly`, `itemless`) and the layer
 * ones (`within`, `holderOf`, `stackedScreens`). Knows no row and no presented layer; one home for both readers, so
 * the fallback imports nothing of draw order.
 */

/** One node in pre-order, with what a row may ask of where it is. */
export interface Placed {
  readonly node: UiNode;
  /** Its index in the walk's order. */
  readonly at: number;
  /** The index just past its subtree in the walk's order. */
  end: number;
  /** It or an ancestor is the keyboard's own UI (`UiNode.ofKeyboard`) or its band (`KEYBOARD_ROLE`, the tree source's mark — inside the keyboard's Window on WDA). */
  readonly inKeyboard: boolean;
  /** Its nearest ancestor that scrolls (scroll-containers.ts#scrolls), if any. */
  readonly scroller: Placed | undefined;
  /** Its parent; undefined for the root. */
  readonly parent: Placed | undefined;
}

/** A rect whose area reaches SCREEN_SIZED_FRACTION of the screen's (`screenOf`) — the one area test; children or none, the caller asks. */
export const fillsScreen = (r: Rect, screenArea: number): boolean => rectArea(r) >= screenArea * SCREEN_SIZED_FRACTION;

/** `inner` lies in `outer`'s subtree (or is it). */
export const within = (inner: Placed, outer: Placed): boolean => inner.at >= outer.at && inner.at < outer.end;

/** Some node from `from` up to, not including, `above` `fillsScreen`: a screen-sized layer around `from` below `above`. */
const screenLayerBelow = (from: Placed | undefined, above: Placed, screenArea: number): boolean => {
  for (let p = from; p !== undefined && p !== above; p = p.parent) if (fillsScreen(p.node.rect, screenArea)) return true;
  return false;
};

/** The nearest node holding both `later` (above it) and `target`; undefined when none does. */
export const holderOf = (later: Placed, target: Placed): Placed | undefined => {
  let both = later.parent;
  while (both !== undefined && !within(target, both)) both = both.parent;
  return both;
};

/**
 * `scroller` and `target` lie in two STACKED SCREENS (draw-order.ts's `scrolledContent` row; the shape fallback,
 * presented-by-shape.ts, asks it of any node, inside one window): below the
 * nearest node holding both, each lies in a screen-sized layer of its own —
 * the later one, the scroller's, drawn over the earlier
 * (an RN transparent Modal presented over the screen, a full-screen sheet)
 * — or that node is a root of no area, the parser's holder of several
 * WINDOWS, each drawn over the ones before it. `both`: the node holding
 * both (`holderOf`), when the caller has already found it.
 */
export const stackedScreens = (scroller: Placed, target: Placed, screenArea: number, both = holderOf(scroller, target)): boolean => {
  if (both === undefined) return false;
  if (both.parent === undefined && rectArea(both.node.rect) === 0) return true;
  return screenLayerBelow(scroller, both, screenArea) && screenLayerBelow(target.parent, both, screenArea);
};

/**
 * The roles whose frame is not a surface: a node of one, non-interactive and
 * with children, covers a point only through its content (draw-order.ts's
 * `contentFramed` row). One role, deliberately — see the rejected ones there.
 * A draw rule, not a scroll predicate (scroll-containers.ts says why).
 */
export const CONTENT_FRAMED_ROLES: ReadonlySet<string> = new Set(['scrollable']);

/**
 * A descendant that cannot be an item: a named wrapper type with nothing of its own (`container` — not `other`, see
 * draw-order.ts's `itemlessToolbar` row).
 */
export const emptyFrame = (n: UiNode): boolean => n.role === 'container' && !n.label && !n.value && !n.identifier;

/** Every descendant of `n` is an empty frame (`emptyFrame`) — true of a leaf. */
export const framesOnly = (n: UiNode): boolean => n.children.every((child) => [...everyNode(child)].every(emptyFrame));

/** A `toolbar` none of whose descendants could be an item (draw-order.ts's `itemlessToolbar` row). */
export const itemless = (n: UiNode): boolean => n.role === 'toolbar' && framesOnly(n);
