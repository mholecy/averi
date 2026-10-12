import type { UiNode } from '../adapters/types.js';

/**
 * SCROLL CONTAINERS: the one place that says whether a node is one. Two
 * facts, not one, and every check in the UI-tree layer that asks either
 * asks here:
 *
 * - `clips` — the tree source cut this node's descendants' rects to its own
 *   (`UiNode.clipsDescendants`). A fact about RECT TRUTHFULNESS: it is what
 *   makes a clip chain, a flush edge and a sliver's evidence
 *   (geometry.ts#clipsOf), the largest scroller (geometry.ts#largestScroller)
 *   and the container a drawn-over question names
 *   (draw-order.ts#DrawOrder.drawnOver). Only Android supplies it; iOS
 *   frames are unclipped, so no iOS node clips and no iOS clip chain is
 *   invented.
 * - `scrolls` — this node's content moves under its frame. A fact about
 *   REACHABILITY and DRAW ORDER: whether `scroll_until` can move a node
 *   (geometry.ts#insideScroller), and, for draw order, a node's nearest
 *   scroller (`Placed.scroller`), which three target rows read: scrolled
 *   content, `structural`'s wrapper excuse (`holdsWhole`: a wrapper holding
 *   the target's nearest scroller whole) and the scroll indicator (a child
 *   of a node that scrolls). A node that clips scrolls (Android's
 *   flag means "scrolls now"); so does a node of a `SCROLLING_ROLES` role,
 *   with or without the flag: a scroll view, and a web view, whose page
 *   scrolls under its frame. A classic Android list whose content fits
 *   (`scrollable="false"`) is still a scroll view, and a remedy that says
 *   "scroll_until it first" over it is answered honestly by scroll_until's
 *   exhaustion.
 *
 * So `clips(n) ⇒ scrolls(n)`, never the other way. One predicate would
 * either give iOS clip chains that do not exist or take scrolling away from
 * classic Android lists.
 *
 * NOT a scroll predicate: draw-order.ts's CONTENT_FRAMED_ROLES. "Its frame
 * is not a drawing surface" is a draw judgement, measured on iOS and narrow
 * on purpose (a web view scrolls, yet its frame IS its surface); it is kept
 * in draw order and never derived from `scrolls`.
 */

/** The source cut this node's descendants' rects to its own (Android's `scrollable="true"`). */
export function clips(n: UiNode): boolean {
  return n.clipsDescendants === true;
}

/** The roles whose content scrolls under their frame, whatever the source says of clipping. */
export const SCROLLING_ROLES: ReadonlySet<string> = new Set(['scrollable', 'webview']);

/** This node's content scrolls under its frame: it clips, or its role is one of `SCROLLING_ROLES`. `clips(n) ⇒ scrolls(n)`. */
export function scrolls(n: UiNode): boolean {
  return clips(n) || SCROLLING_ROLES.has(n.role);
}
