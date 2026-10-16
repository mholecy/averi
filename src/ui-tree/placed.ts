import { everyNode, KEYBOARD_ROLE, rectArea, SCREEN_SIZED_FRACTION, STRUCTURAL_ROLES, type Rect, type UiNode } from '../adapters/types.js';
import { rectWithin } from './geometry.js';
import { scrolls } from './scroll-containers.js';
import { isInteractive } from './selectors.js';

/**
 * WHERE A NODE LIES in the one pre-order walk of a tree (`walkOf`, `Placed`), and the predicates asked of it both by
 * draw order's rows (draw-order.ts#NOT_DRAWN) and by the presentation module's shape adapter (presentation.ts#byShape):
 * the frame predicates (`fillsScreen`, `screenSized`, `CONTENT_FRAMED_ROLES`, `emptyFrame`, `framesOnly`, `itemless`,
 * and the three frame excuses of draw order's `target` column, `FRAME_EXCUSES`) and the layer ones (`within`,
 * `holderOf`, `stackedScreens`). It owns the frame excuses both readers share, but no row table (draw order's
 * `NOT_DRAWN`) and no presented layer; one home for both readers, so neither imports the other for a node's place — and the shape adapter asks the frame excuses here, not through a callback draw order
 * hands it.
 */

/** One node in pre-order, with what a row may ask of where it is. */
export interface Placed {
  readonly node: UiNode;
  /** Its index in the walk's order. */
  readonly at: number;
  /** The index just past its subtree in the walk's order. */
  end: number;
  /**
   * It or an ancestor is the keyboard's own UI (`UiNode.ofKeyboard`) or its band (`KEYBOARD_ROLE`, the tree source's
   * mark — inside the keyboard's Window on WDA).
   */
  readonly inKeyboard: boolean;
  /** Its nearest ancestor that scrolls (scroll-containers.ts#scrolls), if any. */
  readonly scroller: Placed | undefined;
  /** Its parent; undefined for the root. */
  readonly parent: Placed | undefined;
}

/**
 * THE walk of `tree`, in pre-order, read as paint order (draw-order.ts#DrawOrder's doc says why): each node once per
 * place it holds, with its index, the end of its subtree, its nearest scrolling ancestor (scroll-containers.ts#scrolls),
 * its parent, and whether it or an ancestor is the keyboard's own (`UiNode.ofKeyboard`, `KEYBOARD_ROLE`). Draw order
 * walks once and hands its walk to the presentation module (presentation.ts#presentationOf), which asks of the same
 * places.
 */
export function walkOf(tree: UiNode): Placed[] {
  const order: Placed[] = [];
  const walk = (node: UiNode, parent: Placed | undefined, scroller: Placed | undefined): void => {
    const inKeyboard = parent?.inKeyboard === true || node.ofKeyboard === true || node.role === KEYBOARD_ROLE;
    const placed: Placed = { node, at: order.length, end: 0, inKeyboard, scroller, parent };
    order.push(placed);
    for (const child of node.children) walk(child, placed, scrolls(node) ? placed : scroller);
    placed.end = order.length;
  };
  walk(tree, undefined, undefined);
  return order;
}

/**
 * A rect whose area reaches SCREEN_SIZED_FRACTION of the screen's (`screenOf`) — the one area test; children or none,
 * the caller asks.
 */
export const fillsScreen = (r: Rect, screenArea: number): boolean => rectArea(r) >= screenArea * SCREEN_SIZED_FRACTION;

/** `inner` lies in `outer`'s subtree (or is it). */
export const within = (inner: Placed, outer: Placed): boolean => inner.at >= outer.at && inner.at < outer.end;

/**
 * Some node from `from` up to, not including, `above` `fillsScreen`: a screen-sized layer around `from` below
 * `above`.
 */
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
 * presentation.ts#byShape, asks it of any node, inside one window): below the nearest node holding both, each lies in a
 * screen-sized layer of its own — the later one, the scroller's, drawn over the earlier (an RN transparent Modal
 * presented over the screen, a full-screen sheet) — or that node is a root of no area, the parser's holder of several
 * WINDOWS, each drawn over the ones before it. `both`: the node holding both (`holderOf`), when the caller has already
 * found it.
 */
export const stackedScreens = (scroller: Placed, target: Placed, screenArea: number, both = holderOf(scroller, target)): boolean => {
  if (both === undefined) return false;
  if (both.parent === undefined && rectArea(both.node.rect) === 0) return true;
  return screenLayerBelow(scroller, both, screenArea) && screenLayerBelow(target.parent, both, screenArea);
};

/**
 * The roles whose frame is not a surface: a node of one, non-interactive and with children, covers a point only
 * through its content (draw-order.ts's `contentFramed` row). One role, deliberately — see the rejected ones there. A
 * draw rule, not a scroll predicate (scroll-containers.ts says why).
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

/** A node with children that `fillsScreen`: it draws through its content, which is walked. */
export const screenSized = (n: UiNode, screenArea: number): boolean => n.children.length > 0 && fillsScreen(n.rect, screenArea);

/**
 * The `structural` frame excuse's wrapper rule for a target: `node` holds the target's whole rect, and is the screen's
 * size or holds the target's nearest scroll view whole.
 */
const holdsWhole = (node: UiNode, target: Placed, screenArea: number): boolean =>
  rectWithin(target.node.rect, node.rect) &&
  (fillsScreen(node.rect, screenArea) || (target.scroller !== undefined && rectWithin(target.scroller.node.rect, node.rect)));

/** The three frame rows of draw order's `target` column (`FRAME_EXCUSES`) the shape adapter may take back. */
export type FrameRow = 'structural' | 'screenSizedHost' | 'contentFramed';

/**
 * The `target` column's three FRAME excuses — a node judged to draw nothing by its frame, for a target. Draw order's
 * rows of the same names (draw-order.ts#NOT_DRAWN: `structural`, `screenSizedHost`, `contentFramed`, whose docs have
 * the rules and their measurements) ask them, less what the presentation module takes back over a screen presented
 * over the target's (presentation.ts#PresentedOver.givesWay); the shape adapter (presentation.ts#byShape) asks them
 * too, to name such a screen's surface from the same rows (`presentedSurface`).
 */
export const FRAME_EXCUSES = {
  structural: ({ node }: Placed, target: Placed, screenArea: number): boolean =>
    STRUCTURAL_ROLES.has(node.role) && !node.label && !node.value && (node.children.length === 0 || holdsWhole(node, target, screenArea) || (!node.identifier && framesOnly(node))),
  screenSizedHost: ({ node }: Placed, _target: Placed, screenArea: number): boolean => !isInteractive(node) && screenSized(node, screenArea),
  // `!isInteractive` is moot while `scrollable` is no interactive role (selectors.ts); it guards CONTENT_FRAMED_ROLES
  // growing one.
  contentFramed: ({ node }: Placed, _target: Placed, _screenArea: number): boolean => !isInteractive(node) && node.children.length > 0 && CONTENT_FRAMED_ROLES.has(node.role),
} as const satisfies Record<FrameRow, (placed: Placed, target: Placed, screenArea: number) => boolean>;
