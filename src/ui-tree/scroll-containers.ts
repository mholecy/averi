import { rectArea, type ScrollAxis, type UiNode } from '../adapters/types.js';

/**
 * SCROLL CONTAINERS: the one place that says whether a node is one. Two
 * facts, not one, and every check in the UI-tree layer that asks either
 * asks here:
 *
 * - `clips` — the tree source cut this node's descendants' rects to its own
 *   (`UiNode.clipsDescendants`). A fact about RECT TRUTHFULNESS: it is what
 *   makes a clip chain, a flush edge and a sliver's evidence
 *   (geometry.ts#clipsOf) and the largest scroller (geometry.ts#largestScroller).
 *   Only Android supplies it; iOS
 *   frames are unclipped, so no iOS node clips and no iOS clip chain is
 *   invented. Not what marks a tree's frames unclipped: the source says
 *   that on the root (UiNode.unclippedFrames, geometry.ts#Clips.drawnIn) —
 *   an Android tree with no scroller flagged is cut all the same.
 * - `scrolls` — this node's content moves under its frame. A fact about
 *   REACHABILITY and DRAW ORDER: whether `scroll_until` can move a node
 *   (geometry.ts#Clips.inScroller), and, for draw order, a node's nearest
 *   scroller (`Placed.scroller`), which three target rows read: scrolled
 *   content (draw-order.ts's `scrolledContent` row), `structural`'s wrapper excuse (`holdsWhole`: a wrapper holding
 *   the target's nearest scroller whole) and the scroll indicator (a child
 *   of a node that scrolls). A node that clips scrolls (Android's
 *   flag means "scrolls now"); so does a node of a `SCROLLING_ROLES` role,
 *   with or without the flag: a scroll view, and a web view, whose page
 *   scrolls under its frame. A classic Android list whose content fits
 *   (`scrollable="false"`) is still a scroll view, and a remedy that says
 *   "scroll_until it first" over it is answered honestly by scroll_until's
 *   exhaustion. And, on a tree of unclipped frames (WDA's), where a node
 *   is DRAWN: its frame cut by every ancestor that scrolls
 *   (geometry.ts#Clips.drawnIn — a scroll view draws none of its content
 *   outside its frame, while the tree lists that content at its laid-out
 *   rect) — and so the scroll views a WDA target's strokes go over
 *   (interact/stroke-plan.ts#targetScrollers). And the container a
 *   drawn-over question names (draw-order.ts#DrawOrder.drawnOver): a
 *   clipping scroller on Android, a scroll view on WDA.
 *
 * And a third, of a node that scrolls: `scrollAxis` — the one axis it scrolls on, when the tree can tell
 * (`scroll_until`'s stroke plan reads it through geometry.ts#Clips.axesOf).
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
const SCROLLING_ROLES: ReadonlySet<string> = new Set(['scrollable', 'webview']);

/** This node's content scrolls under its frame: it clips, or its role is one of `SCROLLING_ROLES`. `clips(n) ⇒ scrolls(n)`. */
export function scrolls(n: UiNode): boolean {
  return clips(n) || SCROLLING_ROLES.has(n.role);
}

/**
 * The ONE axis a scroll view scrolls on, or undefined when the tree cannot tell — per source:
 * - its type, where the source says it (`UiNode.scrollAxis`: Android's class, WDA's `Table`);
 * - else, on a tree of UNCLIPPED frames (`unclipped`: WDA's, adapters/types.ts#UiNode.unclippedFrames), its content's
 *   extent past its frame: WDA lists a scroll view's content at its laid-out rect, so content reaching past the frame
 *   on one axis alone scrolls on that axis. Measured on mp-native's Account Detail
 *   (tests/fixtures/wda-capture-account-detail-bar-shown.json): the card carousel `ScrollView 24,138 354x85` holds
 *   `Other 24,138 1416x85` (horizontal), the transactions list `ScrollView 0,180 402x694` holds `Other 0,180
 *   402x1925` (vertical). Its content is its descendants down to, not into, a nested scroll view (a carousel's cards
 *   past a page's sides are the carousel's extent, not the page's); a node of no area is not read. Content past both
 *   axes (a zoomed or two-way view) or neither (it fits, or the cells past the frame are not listed yet) says
 *   nothing;
 * - nothing on Android's other scrollers (uiautomator cuts every rect to its scroll view: no content shows past it —
 *   a lazy list, a RecyclerView) nor on idb (its flat list lists no scroll view).
 * Undefined for a node that does not scroll (`scrolls`).
 */
export function scrollAxis(n: UiNode, unclipped: boolean): ScrollAxis | undefined {
  if (!scrolls(n)) return undefined;
  if (n.scrollAxis !== undefined) return n.scrollAxis;
  return unclipped ? contentAxis(n) : undefined;
}

/** How far past its frame a scroll view's content must lie to count: a point, against the rounding of a frame. */
const PAST_FRAME = 1;

/** The axis `n`'s content reaches past its frame on, when it reaches past on one alone (`scrollAxis`). */
function contentAxis(n: UiNode): ScrollAxis | undefined {
  const { x, y, width, height } = n.rect;
  let pastX = false;
  let pastY = false;
  const read = (c: UiNode): void => {
    const r = c.rect;
    if (rectArea(r) > 0) {
      pastX ||= r.x < x - PAST_FRAME || r.x + r.width > x + width + PAST_FRAME;
      pastY ||= r.y < y - PAST_FRAME || r.y + r.height > y + height + PAST_FRAME;
    }
    if (!scrolls(c)) c.children.forEach(read);
  };
  n.children.forEach(read);
  return pastX === pastY ? undefined : pastX ? 'horizontal' : 'vertical';
}
