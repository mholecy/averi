import { rectArea, sameRect, type Rect, type ScrollAxis, type UiNode } from '../adapters/types.js';

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
 * `n` is THE scroll view of rect `container`: it scrolls, with exactly that rect — the one test by which a scroll view
 * remembered as a rect is found again in a tree, first in tree order (draw-order.ts#DrawOrder.drawnOver, which also
 * leaves out the keyboard's own nodes, and geometry.ts#Clips.axesOf).
 */
export function isScrollViewOf(n: UiNode, container: Rect): boolean {
  return scrolls(n) && sameRect(n.rect, container);
}

/**
 * The ONE axis a scroll view scrolls on, or undefined when the tree cannot tell — per source:
 * - its type, where the source says it (`UiNode.scrollAxis`: Android's class, WDA's `Table`);
 * - else, on a tree of UNCLIPPED frames (`unclipped`: WDA's, adapters/types.ts#UiNode.unclippedFrames), its content's
 *   extent past its frame: WDA lists a scroll view's content at its laid-out rect, so content that RUNS ON past the
 *   frame on one axis alone scrolls on that axis — a node straddling the frame's edge by a quarter of its side, or one
 *   wholly past it continuing a same-sized sibling inside it (`contentAxis`), never any node past it. Measured on
 *   mp-native's Account Detail (tests/fixtures/wda-capture-account-detail-bar-shown.json): the card carousel
 *   `ScrollView 24,138 354x85` holds `Other 24,138 1416x85` (horizontal), the transactions list `ScrollView 0,180
 *   402x694` holds `Other 0,180 402x1925` (vertical). Its content is its descendants down to, not into, a nested scroll
 *   view (a carousel's cards past a page's sides are the carousel's extent, not the page's); a node of no area is not
 *   read. Content past both axes (a zoomed or two-way view) or neither (it fits, or runs on past it by less than a
 *   quarter of its side with no same-sized sibling past it, or the cells past the frame are not listed yet) says
 *   nothing. False negatives, each unknown and so stroked as before the axis: a chip carousel of mixed widths, a card
 *   carousel spaced more than a quarter card apart with no card straddling its edge, full-width cells paged exactly
 *   with the next cell unlisted. False readings left, named: a node of a page that fits, straddling its side by a
 *   quarter or more without scrolling (an overflowing row the page clips); a same-sized sibling laid beside a fitting
 *   page's content (a pager's page the tree does not list as a scroll view, a drawer exactly as wide as the content) —
 *   each reads a vertical page horizontal, so its `down` stroke goes over an outer scroll view, or keeps off it as a
 *   nested one;
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

/**
 * How far past its frame a node that STRADDLES the frame's edge must reach to say the content runs on, as a fraction
 * of the frame's side along that axis: a quarter. A scroll view's content wrapper reaches a screenful or more past
 * (Account Detail's carousel content 1416 of 354, its list's 1925 of 694), a card cut at the edge of a peeking
 * carousel half a card or more (177 of 354); a bleed, a shadow or an overhang a few points (an image `-10` wide of a
 * 402 page by 10 each side) — under a quarter, it says nothing.
 */
const STRADDLE_REACH = 1 / 4;

/** The span of `r` along `axis`. */
const spanOf = (r: Rect, axis: ScrollAxis): readonly [number, number] => (axis === 'horizontal' ? [r.x, r.x + r.width] : [r.y, r.y + r.height]);

/** `r` lies, in part, inside `frame`'s span along `axis`. */
const withinSpan = (frame: Rect, r: Rect, axis: ScrollAxis): boolean => {
  const [a0, a1] = spanOf(frame, axis);
  const [b0, b1] = spanOf(r, axis);
  return b0 < a1 - PAST_FRAME && b1 > a0 + PAST_FRAME;
};

/** `r` starts inside `frame` along `axis` and reaches STRADDLE_REACH of the frame's side past one of its edges: a content wrapper, a card the edge cuts. */
function straddles(frame: Rect, r: Rect, axis: ScrollAxis): boolean {
  const [a0, a1] = spanOf(frame, axis);
  const [b0, b1] = spanOf(r, axis);
  const reach = Math.max(PAST_FRAME, (a1 - a0) * STRADDLE_REACH);
  return withinSpan(frame, r, axis) && (b1 > a1 + reach || b0 < a0 - reach);
}

/**
 * Among siblings, a node WHOLLY past `frame` along `axis` that continues one partly inside it: the same size (within
 * PAST_FRAME each way) and starting where it ends, a gap of at most a quarter of its side between them (a card's
 * spacing) — the next card of a carousel with no content wrapper listed (Account Detail's `accounts.detail.header`
 * cards, `24,138` and `378,138`, both 354x85). A drawer, a page or swipe-action buttons beside the frame are not of
 * the size of what lies inside it.
 */
function runsPast(frame: Rect, siblings: readonly UiNode[], axis: ScrollAxis): boolean {
  const [a0, a1] = spanOf(frame, axis);
  const sized = siblings.filter((c) => rectArea(c.rect) > 0);
  return sized.some(({ rect: inner }) => {
    if (!withinSpan(frame, inner, axis)) return false;
    const [i0, i1] = spanOf(inner, axis);
    const gap = (i1 - i0) * STRADDLE_REACH;
    return sized.some(({ rect: outer }) => {
      const [o0, o1] = spanOf(outer, axis);
      const past = o0 >= a1 - PAST_FRAME || o1 <= a0 + PAST_FRAME;
      const sameSize = Math.abs(outer.width - inner.width) <= PAST_FRAME && Math.abs(outer.height - inner.height) <= PAST_FRAME;
      const after = o0 - i1 >= -PAST_FRAME && o0 - i1 <= gap;
      const before = i0 - o1 >= -PAST_FRAME && i0 - o1 <= gap;
      return outer !== inner && past && sameSize && (after || before);
    });
  });
}

/**
 * The axis `n`'s content runs on past its frame on, when it runs on past on one alone (`scrollAxis`): a node of its
 * content that STRADDLES the frame's edge (`straddles`), or one wholly past it that continues a sibling inside it
 * (`runsPast`). Not any node past the frame: a drawer at x −300, swipe-action buttons past a row's end or a page laid
 * beside a page that fits would read a vertical page horizontal.
 */
function contentAxis(n: UiNode): ScrollAxis | undefined {
  const content: UiNode[] = [];
  const families: (readonly UiNode[])[] = [n.children];
  const read = (c: UiNode): void => {
    if (rectArea(c.rect) > 0) content.push(c);
    if (scrolls(c)) return;
    families.push(c.children);
    c.children.forEach(read);
  };
  n.children.forEach(read);
  const runsOn = (axis: ScrollAxis): boolean => content.some((c) => straddles(n.rect, c.rect, axis)) || families.some((f) => runsPast(n.rect, f, axis));
  const pastX = runsOn('horizontal');
  const pastY = runsOn('vertical');
  return pastX === pastY ? undefined : pastX ? 'horizontal' : 'vertical';
}
