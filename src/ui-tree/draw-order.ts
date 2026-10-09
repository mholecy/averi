import { everyNode, rectArea, rectIntersection, sameRect, SCREEN_SIZED_FRACTION, STRUCTURAL_ROLES, type Point, type Rect, type UiNode } from '../adapters/types.js';
import { containsPoint, rectWithin } from './geometry.js';
import { isInteractive } from './selectors.js';

/**
 * DRAW ORDER: what a tree says is drawn on top of what. One walk of the
 * tree in pre-order, read as paint order — a node AFTER another's subtree
 * is drawn later, so over it (later siblings and their descendants over
 * earlier ones, later Windows over earlier: UIKit orders them by level);
 * ancestors and earlier siblings are beneath, and a node's own descendants
 * are the node. A heuristic, not a compositor: the tree gives neither
 * opacity nor touch handling, so what "draws" is judged from role, size and
 * content — one judgement (`NOT_DRAWN`), whose rows each name a kind of node
 * judged to draw nothing of its own, for the questions it applies to. So a
 * transparent overlay smaller than the screen reads as drawn, and a label
 * inside a sheet that does not contain the point does not. "Later in
 * pre-order = drawn later" is measured on WDA trees (Windows by level) and
 * on Compose (the floating tab bar, 2026-10-09); for classic Android Views
 * uiautomator's sibling order is the accessibility child order, which
 * Android may sort by position rather than by Z (not measured) — there a
 * later sibling drawn beneath may read as drawn over, for every question.
 *
 * Three questions, one per caller:
 * - `shadowing(node, point)` — the tap guard's dismissal picker
 *   (interact/keyboard-in-tree.ts#pickDismissal): is a configured dismissal
 *   target drawn over at its tap point?
 * - `drawnOver(container)` — `scroll_until`'s stroke box
 *   (interact/scroll-rounds.ts#TreeFacts, swipe.ts#strokeRoom): what is
 *   drawn over the clipping container a stroke goes over?
 * - `drawnOverAt(container, point)` — the exhausted stop's sentence
 *   (scroll-rounds.ts#touchedOn): which of those a stroke's touch-down hit.
 *
 * The first two read the rows differently on purpose — each column of
 * `NOT_DRAWN` is what that question has been measured against, and where
 * they differ the row says why. Knows no platform commands; the platform
 * shapes are in the rows, each with the device tree it was measured on.
 */
export interface DrawOrder {
  /**
   * The node drawn over `point` on top of `node`, if any: the LAST node
   * after `node`'s subtree in pre-order — its first place in the tree, and
   * none of its own subtree wherever else the same object appears — that draws (`NOT_DRAWN`'s
   * `shadowing` column) and contains the point (`containsPoint`: right and
   * bottom edges exclusive). Undefined when nothing does, or when `node` is
   * not in this tree. The keyboard's own nodes are not exempt: a target
   * under the keyboard is caught first by the band check (with its own
   * reason), and a keyboard-owned node over the point that the band missed
   * is a real cover.
   */
  shadowing(node: UiNode, point: Point): UiNode | undefined;
  /**
   * The nodes drawn over a clipping container, in pre-order: every node
   * after the container's subtree whose rect meets the container's with
   * area and that draws (`NOT_DRAWN`'s `drawnOver` column) — never an
   * ancestor or a descendant: its own rows scroll with it. The container is
   * found by its rect: the outermost clipping node (`clipsDescendants`)
   * with that rect outside the keyboard, since the round carries containers
   * as rects (geometry.ts#scrollersOf, #largestScroller). UNDEFINED when this
   * tree has no such container (a rect of another read — the list has moved
   * since), so the caller can tell "nothing over it" from "not asked of this
   * tree".
   */
  drawnOver(container: Rect): readonly UiNode[] | undefined;
  /**
   * The one of `drawnOver(container)` drawn on top at `point` — the last
   * that contains it — leaving out a node whose rect holds the container's
   * whole (`rectWithin`): a wrapper the list's size or larger is no evidence
   * of a cover at a touch-down. Undefined when none, or when this tree has
   * no such container.
   */
  drawnOverAt(container: Rect, point: Point): UiNode | undefined;
}

/** The questions `NOT_DRAWN` answers, by the `DrawOrder` method that asks each. */
type Question = 'shadowing' | 'drawnOver';

/** One node in pre-order, with what a row may ask of where it is. */
interface Placed {
  readonly node: UiNode;
  /** Its index in the walk's order. */
  readonly at: number;
  /** The index just past its subtree in the walk's order. */
  end: number;
  /** It or an ancestor is the keyboard's own UI (`UiNode.ofKeyboard`). */
  readonly inKeyboard: boolean;
}

/** What a row is judged against beside the node: the screen's area (`screenAreaOf`). */
interface Seen {
  readonly screen: number;
}

/**
 * A kind of node judged to draw nothing of its own, per question: `true`
 * from a question's predicate excuses the node for that question; a
 * question without one counts the node as drawing, as far as this row is
 * concerned.
 */
type Row = { readonly [Q in Question]?: (placed: Placed, seen: Seen) => boolean };

/**
 * The roles whose frame is not a surface: a node of one, non-interactive and
 * with children, covers a point only through its content (the
 * `contentFramed` row). One role, deliberately — see the rejected ones there.
 */
const CONTENT_FRAMED_ROLES: ReadonlySet<string> = new Set(['scrollable']);

/** A node with children whose area reaches SCREEN_SIZED_FRACTION of the screen (`screenAreaOf`): it draws through its content, which is walked. */
const screenSized = (n: UiNode, screen: number): boolean => n.children.length > 0 && rectArea(n.rect) >= screen * SCREEN_SIZED_FRACTION;

/** A descendant that cannot be an item: a named wrapper type with nothing of its own (`container` — not `other`, see `itemlessToolbar`). */
const emptyFrame = (n: UiNode): boolean => n.role === 'container' && !n.label && !n.value && !n.identifier;

/**
 * THE judgement of what draws, one row per kind of node that does not. A
 * node draws for a question when no row excuses it there. Where the two
 * columns differ, both answers are kept as each caller has been measured
 * against; unifying them is a behaviour change, to be judged per row.
 */
const NOT_DRAWN = {
  /**
   * No area: nothing to draw (a zero-width text, a collapsed view). Both
   * questions; for `shadowing` it is belt and braces — `containsPoint`
   * already rejects a rect of no area.
   */
  noArea: {
    shadowing: ({ node }) => !(rectArea(node.rect) > 0),
    drawnOver: ({ node }) => !(rectArea(node.rect) > 0),
  },

  /**
   * STRUCTURAL ROLES (`container`, `other` — every source's wrappers).
   *
   * `shadowing`: any node of one is excused, with or without children or a
   * label — a full-screen `Other` of a later Window contains every point
   * and draws nothing; what it carries is walked and judged by itself (an
   * alert's text inside WDA's Alert → container). iOS dimming views come
   * through as `other`, so they never cover.
   *
   * `drawnOver`: only a structural LEAF with no label and no value is
   * excused (a spacer, an empty Box — empty area). A Compose tree is all
   * `container`/`other` (adapters/android.ts maps `android.view.View` so),
   * so a structural role is no evidence of nothing drawn: measured on
   * mp-native's Account Detail (2026-10-09, docs/bugs/2026-10-09-android-
   * scroll-stroke-touches-down-on-floating-tab-bar.md) the floating tab
   * bar's host — an unlabelled `container` `66,1840 948x248` after the
   * list `0,825 1080x1395` — took the touch-down at y 1857 above its tabs
   * (a Material Surface swallows touches through its whole rect). The tree
   * does not say whether a node takes touches, so a transparent wrapper
   * reaching over a list counts too: its cost is a shorter stroke box,
   * never a stroke off the list.
   */
  structural: {
    shadowing: ({ node }) => STRUCTURAL_ROLES.has(node.role),
    drawnOver: ({ node }) => STRUCTURAL_ROLES.has(node.role) && node.children.length === 0 && !node.label && !node.value,
  },

  /**
   * A SCREEN-SIZED HOST: a node with children whose area reaches
   * `SCREEN_SIZED_FRACTION` of the screen — a full-screen overlay layer
   * draws through its content, which is walked. A childless one draws
   * itself (a full-screen image or text).
   *
   * `shadowing`: a NON-INTERACTIVE one only (docs/bugs/2026-10-08-wda-
   * dismissal-shadowed-by-fullscreen-swiftui-toolbar.md): WDA gives a
   * SwiftUI pushed screen's toolbar host as `toolbar 'Toolbar'` with the
   * screen's full frame AFTER the title in pre-order; it draws nothing over
   * the title, yet every `keyboardDismiss` tap on that screen was refused
   * as "covered by toolbar". An interactive one still covers: a
   * full-screen `button` backdrop (an RN transparent Modal's Pressable)
   * takes the tap. Accepted trade-off: a full-screen non-interactive host
   * with nothing of its own at the point (an RN ScrollView in a
   * transparent modal whose rows are below the title) reads as not
   * covering, and the dismissal tap lands on it — on the guard's path a
   * keyboard that stays, or a target gone, ends in `AfterDismissalTap`; a
   * tap that hides the keyboard AND does something of its own passes
   * silently (`hidden by tapping <title> before tapping`), and on the
   * post-fill `dismiss()` path is reported as `hiddenBy: tapping <title>`.
   * "Has children" is a weak signal: the measured toolbar's only child is
   * an empty container.
   *
   * `drawnOver`: whatever its interactivity — the row was taken over from
   * `shadowing`'s without the interactive exception, and no measurement
   * has asked it either way (the tree keeps no `clickable`).
   */
  screenSizedHost: {
    shadowing: ({ node }, { screen }) => !isInteractive(node) && screenSized(node, screen),
    drawnOver: ({ node }, { screen }) => screenSized(node, screen),
  },

  /**
   * A SCROLL VIEW WITH CONTENT (`CONTENT_FRAMED_ROLES`), non-interactive,
   * whatever its size, covers a point only through its descendants, never
   * through its own frame — the screen-sized host rule without the size.
   *
   * `shadowing` (2026-10-08, the device check at e9e6509 of the toolbar
   * host bug): with the toolbar host excused, the next node after the title
   * in pre-order — the form's `scrollable 0 0 402 512`, 58 % of the screen,
   * so no host by size — covered the title at (201,84) and the dismissal
   * was refused "covered by scrollable"; its frame runs under the
   * translucent top bar, as an iOS scroll view's does by default (the
   * content inset, not the frame, keeps the rows below the bar), and its
   * first row started at y 150. Why a scroll view and not every container
   * with children — DRAW ORDER, not paint (a scroll view may well paint: a
   * SwiftUI List's grouped background, an RN ScrollView's
   * `backgroundColor`): an iOS scroll view routinely extends under the bars
   * around it, and WDA lists those bars' content (the navigation title)
   * EARLIER in pre-order although they draw OVER the scroll view; pre-order
   * cannot tell that point from one where the scroll view is on top, and
   * its content is the only part of it that can be judged. Rejected:
   * `webview` (it paints its page itself and its accessibility children are
   * sparse, so its frame IS its surface), `toolbar` under the screen size
   * (the input-accessory bar draws an opaque 48-pt bar, measured
   * 2026-10-07), and any non-interactive parent ("judge only by leaves",
   * which would drop a smaller card or sheet whose background is the
   * cover). What still covers: its content at the point, a childless
   * scrollable, an interactive node of any role. Accepted trade-off, this
   * row LOOSENS the guard: a scroll view really drawn over the point with
   * nothing non-structural there (a sheet's table whose row at the title is
   * a bare `Cell`) reads as not covering — the outcomes are the
   * screen-sized host's above. Residual the other way: a row scrolled UNDER
   * a translucent bar is after the bar's title in WDA's pre-order, so it
   * still reads as cover — a false refusal, the safe direction. Android's
   * scroll containers never meet this question: the guard there has an
   * oracle.
   *
   * `drawnOver`: not excused — no measurement asked it (no iOS tree has a
   * clipping container, and a Compose scroller is `container`, not
   * `scrollable`: adapters/types.ts#UiNode.clipsDescendants).
   */
  contentFramed: {
    // `!isInteractive` is moot while `scrollable` is no interactive role (selectors.ts); it guards CONTENT_FRAMED_ROLES growing one.
    shadowing: ({ node }) => !isInteractive(node) && node.children.length > 0 && CONTENT_FRAMED_ROLES.has(node.role),
  },

  /**
   * AN ITEMLESS TOOLBAR, whatever its size: a `toolbar` none of whose
   * descendants could be an item — every one an EMPTY FRAME, a `container`
   * with no label, value or identifier; it may have none at all.
   * `container` only, not `other`: the iOS parsers give `container` to the
   * wrapper types they name (WDA's `Other`, `Cell`, `Window`, the bars) and
   * `other` to every type they do NOT map — a SegmentedControl, Stepper,
   * SearchField — so an unlabelled `other` may be a control and is an item.
   *
   * `shadowing` (docs/bugs/2026-10-09-ios-wda-childless-toolbar-refuses-
   * keyboard-dismissal.md): measured under WDA on the stock Contacts "New
   * Contact" sheet (UIKit, iPhone 17, iOS 27): after the title `text 'New
   * Contact' 149 89 104 22` come the form's `scrollable 0 62 402 812`
   * (the `contentFramed` row) and two `toolbar 'Toolbar'`s, `0 83 402 48`
   * and `0 62 402 812`, each holding ONE empty `Other` (→ `container`) of
   * its own rect; EACH alone contained the title's point (201,100) and
   * refused the dismissal as "covered by toolbar", while the screenshot
   * shows nothing over the title. So "itemless" is judged by content, not
   * by child count; the 48-pt one is a bar's size, which no host rule
   * excuses. A toolbar's surface is its ITEMS (WDA lists a bar button, a
   * title, a Done as its descendants), so one listing none is judged to
   * draw nothing. Narrow on purpose: only `toolbar`; any descendant with a
   * label, value or identifier, or of any other role, at any depth, is an
   * item, and the toolbar then covers as itself (the input-accessory bar's
   * Done: Toolbar → Other → Button). Accepted residual, this row LOOSENS
   * the guard: an opaque itemless bar drawn over the dismissal reads as not
   * covering, and the tap lands on a bar with no item — likely a keyboard
   * that stays, ending in `AfterDismissalTap`. The one silent wrong action:
   * a bar whose item WDA does not list as content (not an accessibility
   * element, or listed only as an empty frame) reads as itemless, and the
   * dismissal tap can trigger that item. Platform scope: only the WDA
   * parser assigns `toolbar` (adapters/wda-source.ts); a future mapping to
   * it inherits this row and must be judged against it. A keyboard-owned
   * itemless toolbar (none measured) is excused like any other: the
   * `keyboard` row counts for this question, and the band — which contains
   * the accessory slot — still catches a point there.
   *
   * `drawnOver`: not excused — no measurement asked it (no WDA tree has a
   * clipping container).
   */
  itemlessToolbar: {
    shadowing: ({ node }) => node.role === 'toolbar' && node.children.every((child) => [...everyNode(child)].every(emptyFrame)),
  },

  /**
   * THE KEYBOARD'S OWN SUBTREES (`UiNode.ofKeyboard` on the node or an
   * ancestor).
   *
   * `shadowing`: counted — the keyboard is one more thing drawn over a
   * point (see `DrawOrder.shadowing`).
   *
   * `drawnOver`: left out, as covers and as the container itself: the
   * keyboard is `scroll_until`'s round's cover, read with its witness
   * (ui-tree/keyboard-cover.ts) — never second-guessed here. Only a WDA tree
   * marks them, and an iOS tree has no clipping container, so today this
   * never runs; it keeps a future Android mark from cutting twice.
   */
  keyboard: {
    drawnOver: ({ inKeyboard }) => inKeyboard,
  },
} as const satisfies Record<string, Row>;

const ROWS: readonly Row[] = Object.values(NOT_DRAWN);

/** The screen's area as a host is sized against it: the root's rect, or the tree's largest rect when the root has none (bare-tree.ts's `wrapperBySize` notion). */
function screenAreaOf(tree: UiNode): number {
  return rectArea(tree.rect) > 0 ? rectArea(tree.rect) : Math.max(0, ...[...everyNode(tree)].map((n) => rectArea(n.rect)));
}

/**
 * The draw order of `tree`: one pre-order walk when called; each answer a
 * scan of it. The tree must not change while the answer is in use.
 */
export function drawOrder(tree: UiNode): DrawOrder {
  const seen: Seen = { screen: screenAreaOf(tree) };
  const order: Placed[] = [];
  const walk = (node: UiNode, inKeyboard: boolean): void => {
    const placed: Placed = { node, at: order.length, end: 0, inKeyboard: inKeyboard || node.ofKeyboard === true };
    order.push(placed);
    for (const child of node.children) walk(child, placed.inKeyboard);
    placed.end = order.length;
  };
  walk(tree, false);

  const draws = (placed: Placed, question: Question): boolean => !ROWS.some((row) => row[question]?.(placed, seen) === true);
  /** Everything drawn after `placed`'s subtree. */
  const after = (placed: Placed): readonly Placed[] => order.slice(placed.end);

  /** The keyboard row read as SCOPE, not as a cover: the container is never one of the keyboard's own nodes. */
  const outOfDrawnOver = NOT_DRAWN.keyboard.drawnOver;
  const drawnOver = (container: Rect): readonly UiNode[] | undefined => {
    const found = order.find((p) => p.node.clipsDescendants === true && sameRect(p.node.rect, container) && !outOfDrawnOver(p));
    if (found === undefined) return undefined;
    return after(found).flatMap((p) => (rectIntersection(p.node.rect, container) !== undefined && draws(p, 'drawnOver') ? [p.node] : []));
  };

  return {
    shadowing(node, point) {
      const places = order.filter((p) => p.node === node);
      if (places.length === 0) return undefined;
      const ofNode = (p: Placed) => places.some((place) => p.at >= place.at && p.at < place.end);
      return after(places[0]).filter((p) => !ofNode(p) && draws(p, 'shadowing') && containsPoint(p.node.rect, point)).at(-1)?.node;
    },
    drawnOver,
    drawnOverAt(container, point) {
      return (drawnOver(container) ?? []).filter((n) => containsPoint(n.rect, point) && !rectWithin(container, n.rect)).at(-1);
    },
  };
}
