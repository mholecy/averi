import { everyNode, KEYBOARD_ROLE, rectArea, rectIntersection, sameRect, SCREEN_SIZED_FRACTION, STRUCTURAL_ROLES, type Point, type Rect, type UiNode } from '../adapters/types.js';
import { containsPoint, largestRect, rectCentre, rectWithin, subtract } from './geometry.js';
import { isInteractive, tapPoint } from './selectors.js';

/**
 * DRAW ORDER: what a tree says is drawn on top of what — and, for a target,
 * what of it still shows and where a tap on it goes (`exposure`). One walk of the
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
 * Four questions, one per caller, read from three columns of `NOT_DRAWN`
 * (`drawnOverAt` reads `drawnOver`'s):
 * - `shadowing(node, point)` — the tap guard's dismissal picker
 *   (interact/keyboard-in-tree.ts#pickDismissal): is a configured dismissal
 *   target drawn over at its tap point?
 * - `drawnOver(container)` — `scroll_until`'s stroke box
 *   (interact/scroll-rounds.ts#TreeFacts, swipe.ts#strokeRoom): what is
 *   drawn over the clipping container a stroke goes over?
 * - `drawnOverAt(container, point)` — the exhausted stop's sentence
 *   (scroll-rounds.ts#touchedOn): which of those a stroke's touch-down hit
 *   (`drawnOver`'s column).
 * - `exposure(node, within)` — a TARGET's chrome (2026-10-09, docs/bugs/
 *   2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md): what is
 *   drawn over a node about to be tapped or scrolled to — a pinned CTA bar,
 *   a floating tab bar, a top bar laid after the form — what of it still
 *   shows, and where a tap on it should go (interact/resolve.ts#
 *   aimClearOfChrome for the tap and the fill's focus tap,
 *   scroll-rounds.ts#judge for `scroll_until`'s stop).
 *
 * The three columns read the rows differently on purpose — each column of
 * `NOT_DRAWN` is what that question has been measured against, and where
 * they differ the row says why. Only nodes of the tree are covers: what a
 * tree does not list (iOS's status bar, the translucent top bar idb gives
 * as its button and title only, a top bar WDA lists BEFORE the scroll view
 * it is drawn over) is not inferred — the bug note's decision 4. Knows no
 * platform commands; the platform shapes are in the rows, each with the
 * device tree it was measured on, and the one mark of a source it reads is
 * on the tree (`UiNode.flatList`). The rect arithmetic it asks — the
 * subtraction of a cover from a target included — is geometry.ts's.
 */
export interface DrawOrder {
  /**
   * The node drawn over `point` on top of `node`, if any: the LAST node
   * after `node`'s subtree in pre-order — its first place in the tree, and
   * none of its own subtree wherever else the same object appears — that
   * draws (`NOT_DRAWN`'s `shadowing` column) and contains the point
   * (`containsPoint`: right and bottom edges exclusive). Undefined when
   * nothing does, or when `node` is not in this tree. The keyboard's own
   * nodes are not exempt: a target
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
  /**
   * What of `node` shows inside `within` — the box the caller judges in,
   * already cut: the screen, and the part of it above a keyboard band the
   * caller has witnessed (the keyboard is never a cover here: Android lists
   * no keyboard node, and its band is read with the input method's word,
   * ui-tree/keyboard-cover.ts — so the caller cuts it out of `within`). The
   * covers are the nodes after `node`'s subtree in pre-order (its first
   * place in the tree, as `shadowing`) that draw for a target
   * (`NOT_DRAWN`'s `target` column) and share area with the part of `node`
   * inside `within`. A node not in this tree has no covers.
   */
  exposure(node: UiNode, within: Rect): Exposure;
}

/**
 * The smallest side a piece of a target that nothing is drawn over may have
 * for a tap to be moved to it (`Exposure.tapAt`), as a fraction of the
 * screen's shorter side: 24 pt on the 402-pt iPhone 17, 65 px on the
 * 1080-px Pixel_3a — about a fingertip, Apple's 44-pt target halved. Chosen
 * against the measured strips (docs/bugs/2026-10-08-tap-and-scroll-until-
 * ignore-pinned-app-chrome.md), each of which must be refused: the 9-pt and
 * 17-pt tops of `priority_select` above the CONTINUE bar (iOS, idb and WDA)
 * and the 38-px bottom border of Contacts' First name below the top app bar
 * (Android) — a tap into a sliver that thin lands on the bar's edge as often
 * as on the row. Scaled by the screen, not fixed, because the tree's units
 * are points on iOS and pixels on Android.
 */
export const MIN_TAP_PIECE_FRACTION = 0.06;

/** What `exposure` found: the target against what is drawn over it inside the judged box. */
export interface Exposure {
  /** The fraction of `node`'s area inside `within` and under no cover (0 for a node of no area) — `visibleFractionInViewport` less the covers. */
  readonly shows: number;
  /** The nodes drawn over it inside `within`, in pre-order; empty when none. */
  readonly covers: readonly UiNode[];
  /** The largest uncovered piece of it inside `within` (a rectangle of the subtraction's pieces, not the largest empty rectangle; the first of equals); undefined when nothing of it shows. What a refusal quotes. */
  readonly largest?: Rect;
  /** The cover drawn on top at its centre (`tapPoint`, the point a tap presses), when the centre lies inside `within` under one — `coverAt` of the centre. What the tap's chrome check and `scroll_until`'s stop ask. */
  readonly centreCover?: UiNode;
  /**
   * Where a tap on it goes: its centre (`tapPoint`) when that lies inside
   * `within` under no cover (no `centreCover`) — `moved: false`; else the
   * centre (`rectCentre`) of the largest uncovered piece whose sides are
   * both at least `minPiece` — `moved: true`, with that `piece`; undefined
   * when no piece is that large.
   */
  readonly tapAt?: { readonly point: Point; readonly moved: false } | { readonly point: Point; readonly moved: true; readonly piece: Rect };
  /** MIN_TAP_PIECE_FRACTION of this tree's screen's shorter side, rounded — the piece size `tapAt` needs. */
  readonly minPiece: number;
  /** The cover drawn on top at `point` — the last of `covers` that contains it — or undefined. */
  coverAt(point: Point): UiNode | undefined;
}

/**
 * The questions of a point and of a container — `NOT_DRAWN`'s columns
 * judged against what is `Seen` (`draws`); `drawnOverAt` reads
 * `drawnOver`'s. The third column, `target`, is judged against a target
 * too (`SeenFor`, `drawsOverTarget`).
 */
type Question = 'shadowing' | 'drawnOver';

/** One node in pre-order, with what a row may ask of where it is. */
interface Placed {
  readonly node: UiNode;
  /** Its index in the walk's order. */
  readonly at: number;
  /** The index just past its subtree in the walk's order. */
  end: number;
  /** It or an ancestor is the keyboard's own UI (`UiNode.ofKeyboard`) or its band (`KEYBOARD_ROLE`, the tree source's mark — inside the keyboard's Window on WDA). */
  readonly inKeyboard: boolean;
  /** Its nearest ancestor that scrolls (`scrolls`), if any. */
  readonly scroller: Placed | undefined;
  /** Its parent; undefined for the root. */
  readonly parent: Placed | undefined;
}

/** What a row is judged against beside the node: the screen's area (`screenOf`). */
interface Seen {
  readonly screen: number;
}

/** What the `target` column is judged against besides: the target, at its first place in the walk, and whether the tree is a flat list (`UiNode.flatList` on its root). */
interface SeenFor extends Seen {
  readonly target: Placed;
  readonly flatList: boolean;
}

/**
 * A kind of node judged to draw nothing of its own, per question: `true`
 * from a question's predicate excuses the node for that question; a
 * question without one counts the node as drawing, as far as this row is
 * concerned.
 */
type Row = { readonly [Q in Question]?: (placed: Placed, seen: Seen) => boolean } & {
  readonly target?: (placed: Placed, seen: SeenFor) => boolean;
};

/**
 * The `structural` row's wrapper excuse for a target: `node` holds the
 * target's whole rect, and is the screen's size or holds the target's
 * nearest scroll view whole.
 */
const holdsWhole = (node: UiNode, target: Placed, screen: number): boolean =>
  rectWithin(target.node.rect, node.rect) &&
  (rectArea(node.rect) >= screen * SCREEN_SIZED_FRACTION || (target.scroller !== undefined && rectWithin(target.scroller.node.rect, node.rect)));

/** `inner` lies in `outer`'s subtree (or is it). */
const within = (inner: Placed, outer: Placed): boolean => inner.at >= outer.at && inner.at < outer.end;

/**
 * A node whose content scrolls under what is around it: a scroll view
 * (`CONTENT_FRAMED_ROLES` — iOS) or a clipping container
 * (`UiNode.clipsDescendants` — Android's scrollers, Compose's included).
 */
const scrolls = (n: UiNode): boolean => CONTENT_FRAMED_ROLES.has(n.role) || n.clipsDescendants === true;

/**
 * The roles whose frame is not a surface: a node of one, non-interactive and
 * with children, covers a point only through its content (the
 * `contentFramed` row). One role, deliberately — see the rejected ones there.
 */
const CONTENT_FRAMED_ROLES: ReadonlySet<string> = new Set(['scrollable']);

/** A node with children whose area reaches SCREEN_SIZED_FRACTION of the screen (`screenOf`): it draws through its content, which is walked. */
const screenSized = (n: UiNode, screen: number): boolean => n.children.length > 0 && rectArea(n.rect) >= screen * SCREEN_SIZED_FRACTION;

/** A descendant that cannot be an item: a named wrapper type with nothing of its own (`container` — not `other`, see `itemlessToolbar`). */
const emptyFrame = (n: UiNode): boolean => n.role === 'container' && !n.label && !n.value && !n.identifier;

/**
 * `node` repeats `target` (the `onTarget` row, in a flat list): it carries
 * the target's identifier, or its label or value is the target's label,
 * placeholder or value — none of them empty.
 */
const repeats = (node: UiNode, target: UiNode): boolean => {
  if (node.identifier !== null && node.identifier !== '' && node.identifier === target.identifier) return true;
  const own = [target.label, target.placeholder, target.value].filter((t): t is string => typeof t === 'string' && t !== '');
  return [node.label, node.value].some((t) => t !== null && own.includes(t));
};

/** A `toolbar` none of whose descendants could be an item (`itemlessToolbar`). */
const itemless = (n: UiNode): boolean => n.role === 'toolbar' && n.children.every((child) => [...everyNode(child)].every(emptyFrame));

/**
 * THE judgement of what draws, one row per kind of node that does not. A
 * node draws for a question when no row excuses it there. Where the
 * columns differ, each answer is kept as its caller has been measured
 * against; unifying them is a behaviour change, to be judged per row.
 */
const NOT_DRAWN = {
  /**
   * No area: nothing to draw (a zero-width text, a collapsed view). Every
   * question; for `shadowing` it is belt and braces — `containsPoint`
   * already rejects a rect of no area.
   */
  noArea: {
    shadowing: ({ node }) => !(rectArea(node.rect) > 0),
    drawnOver: ({ node }) => !(rectArea(node.rect) > 0),
    target: ({ node }) => !(rectArea(node.rect) > 0),
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
   * reaching over a list counts too: its cost is a shorter stroke box —
   * never under half of it, or a third for one over the touch-down
   * (interact/swipe.ts#overlayTop, TOUCH_DOWN_CUT_FLOOR) — never a stroke
   * off the list.
   *
   * `target`: `drawnOver`'s rule — the Compose tab-bar host is the measured
   * cover of the rows beneath it (Account Detail, the same note; the bars
   * in docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md
   * are wrapped the same way) — and ALSO excused: an unlabelled, unvalued
   * structural node whose rect holds the target's WHOLE rect. Such a
   * wrapper after the target in pre-order — WDA lays a screen's content in
   * `Other` frames the screen's size or the form's, Windows after Windows —
   * says nothing about the target's surface; what it carries is walked and
   * judged by itself, as the point question judges every structural node.
   * Not the point question's blanket excuse: a wrapper only PARTLY over the
   * target is a bar's frame, the case the tab-bar host measured. And not
   * every wrapper holding the target (review round 1): the measured host
   * `66,1840 948x248` holds a small target in a row at y 1845–1875 whole,
   * above its tabs — the band where the touch-down at 1857 was swallowed.
   * So the wrapper must also be the screen's size (`SCREEN_SIZED_FRACTION`,
   * a Window's `Other`) or hold the target's scroll view whole (the form's
   * frame) — a bar holds neither (`holdsWhole`).
   */
  structural: {
    shadowing: ({ node }) => STRUCTURAL_ROLES.has(node.role),
    drawnOver: ({ node }) => STRUCTURAL_ROLES.has(node.role) && node.children.length === 0 && !node.label && !node.value,
    target: ({ node }, { target, screen }) =>
      STRUCTURAL_ROLES.has(node.role) && !node.label && !node.value && (node.children.length === 0 || holdsWhole(node, target, screen)),
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
   *
   * `target`: `shadowing`'s — the SwiftUI toolbar host lies after every
   * row of its screen, and a full-screen backdrop button takes the tap.
   */
  screenSizedHost: {
    shadowing: ({ node }, { screen }) => !isInteractive(node) && screenSized(node, screen),
    drawnOver: ({ node }, { screen }) => screenSized(node, screen),
    target: ({ node }, { screen }) => !isInteractive(node) && screenSized(node, screen),
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
   *
   * `target`: `shadowing`'s, for its reason — the form's scroll view runs
   * under the translucent top bar whose buttons WDA lists before it, and
   * the SWIFT form's measured WDA tree has it after the title.
   */
  contentFramed: {
    // `!isInteractive` is moot while `scrollable` is no interactive role (selectors.ts); it guards CONTENT_FRAMED_ROLES growing one.
    shadowing: ({ node }) => !isInteractive(node) && node.children.length > 0 && CONTENT_FRAMED_ROLES.has(node.role),
    target: ({ node }) => !isInteractive(node) && node.children.length > 0 && CONTENT_FRAMED_ROLES.has(node.role),
  },

  /**
   * SCROLLED CONTENT: a node inside a scroll view (`scrolls`: a
   * `scrollable`, or a clipping container — Android's) that does not hold
   * the target. `target` only (2026-10-09): an iOS form scrolls UNDER its
   * translucent top bar, and WDA lists the bar's BackButton and Save
   * BEFORE the scroll view (the `contentFramed` row's measurement), so
   * every row scrolled up under the bar follows the bar's buttons in
   * pre-order and would read as drawn over them — a false refusal of the
   * one tap that leaves the screen. Content cannot be drawn over what lies
   * outside its scroll view's frame on top of it; the scroll view itself
   * is judged by `contentFramed`. A row of the SAME scroll view as the
   * target (a sticky section header over a row) still covers. Residual,
   * stated: a scroll view really drawn over another part of the screen (a
   * bottom sheet's list over a form) hides nothing through its rows here —
   * only its frame, or a non-scrolling node of the sheet, can cover. The
   * point and the container questions never ask it: the dismissal picker's
   * title IS such a target, and its `contentFramed` row was measured with
   * a row under the title still covering (accepted there as a false
   * refusal, the safe direction for a keyboard dismissal; for a tap target
   * it is not: it refuses BackButton).
   *
   * Under idb this row never fires: its list is FLAT, so no node has a
   * scroll-view ancestor — `flatListAbove` stands in for it there.
   */
  scrolledContent: {
    target: ({ scroller }, { target }) => scroller !== undefined && !within(target, scroller),
  },

  /**
   * ABOVE THE TARGET IN A FLAT LIST: under idb (`UiNode.flatList` on the
   * root), a node whose TOP lies above the target's top. `target` only —
   * an INTERIM rule, the owner's decision of 2026-10-09 (code review of
   * deep/r5-covers, P1), to be measured on device; NOT measured: whether
   * idb's list order is paint order at all is unknown.
   *
   * Why: idb's list is flat, so `scrolledContent` cannot tell a row of the
   * form from the bar over it, and a row scrolled up under the translucent
   * top bar — idb keeps its real rect, the bug note measured the IBAN input
   * at y 27 — comes AFTER BackButton and the title in the list and read as
   * drawn over them: `tap BackButton` and `scroll_until` to it were refused
   * (`… under button "Debit account" … nothing of it shows`), the one tap
   * that leaves the screen. The cases the rule is held to: the row at y
   * 27–40 is no cover of BackButton (y 70) or the title (y 74) — its top
   * is above theirs; the pinned CONTINUE bar (y 780) over `priority_select`
   * (y 771) still is — its top at or below the target's, the bug's own
   * shape (tests/fixtures/idb-swift-form-continue.json). A pinned bar
   * covers what scrolls up to it from above, and content scrolled under a
   * top bar lies above what the bar holds.
   *
   * Residuals, stated: a cover whose top lies above the target's — a
   * bottom sheet or a dialog laid over a row it starts above, a bar taller
   * than a row it reaches over — is not seen under idb (a false "clear":
   * the tap may press the cover); a row scrolled under a top bar whose top
   * lies at or below a bar item's — a short row under a tall bar — still
   * reads as cover (a false refusal, the safe direction). WDA's nested tree
   * and Android's never meet this row: neither is marked.
   */
  flatListAbove: {
    target: ({ node }, { target, flatList }) => flatList && node.rect.y < target.node.rect.y,
  },

  /**
   * ON THE TARGET: a NON-INTERACTIVE SIBLING of the target, narrower than
   * it, whose centre lies on it — and, in idb's flat list (`UiNode.flatList`),
   * which REPEATS the target: its identifier, or its text (label or value)
   * equal to the target's label, placeholder or value. `target` only
   * (2026-10-09): idb's list is FLAT
   * (adapters/ios-tree-source.ts#parseIdbDescribeAll), so a field's own
   * floating label comes after the field as its sibling, never as its
   * descendant — measured on mp-native's SWIFT form
   * (tests/helpers/fake.ts#idbFloatingLabelFake, docs/bugs/2026-10-08-ios-
   * fill-unverified-reports-filled-and-cleared.md): the label `42,372
   * 120x18` lies on the empty input `26,366 350x30`, both carrying the
   * identifier `TextFieldWithComponentStyle` (iOS gives a field's title and
   * error labels the field's identifier — interact/resolve.ts#resolveNow);
   * a tap there focuses the field. Without this row `scroll_until … fully:
   * true` would never stop on such a field.
   *
   * A sibling, not any node: the label of a bar drawn over a large row (the
   * Compose tab's `Home` text inside the row's rect) is part of a cover,
   * not of the target — a bar's text has the bar for its parent. Its centre
   * on the target, not its whole rect (review round 1): an outlined field's
   * floating label straddles the field's top border — and only that
   * border: its bottom may not pass the target's (review round 2: a pinned
   * footer's text straddling a row's BOTTOM edge is the bug's own shape).
   * Narrower: a full-width sibling over a row is a sticky section header.
   * An interactive one (a clear button) still covers, at its own rect.
   * WDA also lists an unaccessible React Native view's texts as SIBLINGS of
   * the view, not its children (wda-source-rn-myport.json: the screen's
   * four texts after `placeholder_screen` 0,116 402x758, "Scaffold is
   * running." `138,479 126x18` on its centre) — the target's own content,
   * excused here whatever it says.
   *
   * Under idb the sibling guard is void — its list makes every node a
   * sibling of every other — so there the repetition is the evidence
   * (code review of deep/r5-covers, P4): without it a pinned footer's text
   * `16,785 200x30` inside a row `0,760 402x60` read "fully visible", and
   * the tap pressed the footer. idb's floating label repeats the field's
   * identifier; text that names something else — a total, a section title
   * — covers. Only there (verification of P4): asked of every tree, it made
   * the RN screen's own text a cover of `placeholder_screen`, and
   * `scroll_until` to it never stopped. In a nested tree a pinned footer's
   * text has the footer, or the screen outside the row's scroll view, for
   * its parent, so the sibling guard already rejects it. Residual, stated:
   * a text laid on a target in the target's own parent with no wrapper of
   * its own — absolutely positioned, or a layout-only view flattened away —
   * is excused there, as an outlined field's floating label is. So is a
   * bare footer text beside a CONTAINER target (a FrameLayout holding a
   * RecyclerView and a TextView, a Scaffold whose bottom bar is a bare
   * Text, `fully` asked of the list): same shape, same answer as before.
   */
  onTarget: {
    target: ({ node, parent }, { target, flatList }) =>
      parent !== undefined &&
      parent === target.parent &&
      !isInteractive(node) &&
      (!flatList || repeats(node, target.node)) &&
      node.rect.width < target.node.rect.width &&
      node.rect.y + node.rect.height <= target.node.rect.y + target.node.rect.height &&
      containsPoint(target.node.rect, tapPoint(node)),
  },

  /**
   * A SCROLL INDICATOR: a `container` (WDA's `Other`) that is a direct
   * child of a scroll view (`scrolls`) and holds nothing but empty frames
   * (`emptyFrame`). `target` only (review round 1, 2026-10-09): WDA lists
   * a UIScrollView's two indicators LAST among its children, after every
   * row — `Other 'Vertical scroll bar, 2 pages' 369,62 30x456` and
   * `Other 'Horizontal scroll bar, 1 page' 0,485 402x30`, each labelled and
   * valued (`0 %`) and holding one bare thumb `Other` (every
   * wda-source-myport-*.json fixture). As covers they moved or refused taps
   * on the buttons above the horizontal one and kept `fully: true` from
   * ever stopping on a full-width row (x 369–399 under the vertical one).
   * The indicator draws a 3-pt thumb, briefly, while scrolling; its frame is
   * an accessibility region. Narrow on purpose: a `container` — not
   * `other`, an unmapped type that may be a control — with no identifier
   * and no content but frames; a sticky header carries its text.
   */
  scrollIndicator: {
    target: ({ node, parent }) =>
      parent !== undefined && scrolls(parent.node) && node.role === 'container' && !node.identifier && node.children.length > 0 && node.children.every((c) => [...everyNode(c)].every(emptyFrame)),
  },

  /**
   * THE TARGET'S OWN FRAME: a node whose rect IS the target's. `target`
   * only (2026-10-09): a node laid exactly over another, edge for edge, is
   * the same element listed again — idb's flat list repeats an element and
   * its accessibility twin at one frame (the fill's `sameField` twins,
   * tests/interact/fill.test.ts) — or a wrapper of the target's size, not a
   * bar drawn over part of it. Residual, stated: an overlay of exactly the
   * target's frame (a disabled-state scrim cut to a button) is not seen.
   */
  sameFrame: {
    target: ({ node }, { target }) => sameRect(node.rect, target.node.rect),
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
   *
   * `target`: `shadowing`'s — the measured sheet's two itemless toolbars
   * lie after every field of the form and over the nav bar's Cancel.
   */
  itemlessToolbar: {
    shadowing: ({ node }) => itemless(node),
    target: ({ node }) => itemless(node),
  },

  /**
   * THE KEYBOARD'S OWN SUBTREES (`UiNode.ofKeyboard` on the node or an
   * ancestor, or the band `KEYBOARD_ROLE` marks — the same nodes on WDA,
   * where the band lies in the keyboard's Window).
   *
   * `shadowing`: counted — the keyboard is one more thing drawn over a
   * point (see `DrawOrder.shadowing`).
   *
   * `drawnOver`: left out, as covers and as the container itself: the
   * keyboard is `scroll_until`'s round's cover, read with its witness
   * (ui-tree/keyboard-cover.ts) — never second-guessed here. Only a WDA tree
   * marks them, and an iOS tree has no clipping container, so today this
   * never runs; it keeps a future Android mark from cutting twice.
   *
   * `target`: left out, for `drawnOver`'s reason — the keyboard is the
   * caller's, cut out of `within` with its witness; Android has no
   * keyboard node at all, so a cover read here would judge the two
   * platforms differently (and an adapter with the oracle never reads the
   * keyboard from its tree: a band there is no cover either).
   */
  keyboard: {
    drawnOver: ({ inKeyboard }) => inKeyboard,
    target: ({ inKeyboard }) => inKeyboard,
  },
} as const satisfies Record<string, Row>;

const ROWS: readonly Row[] = Object.values(NOT_DRAWN);

/** The screen as a host is sized against it: the root's rect, or the tree's largest rect when the root has none (bare-tree.ts's `wrapperBySize` notion; idb's synthetic 0×0 root). */
function screenOf(tree: UiNode): Rect {
  if (rectArea(tree.rect) > 0) return tree.rect;
  return [...everyNode(tree)].reduce((best, n) => (rectArea(n.rect) > rectArea(best) ? n.rect : best), tree.rect);
}

/**
 * The draw order of `tree`: one pre-order walk when called; each answer a
 * scan of it. The tree must not change while the answer is in use.
 */
export function drawOrder(tree: UiNode): DrawOrder {
  const screen = screenOf(tree);
  const seen: Seen = { screen: rectArea(screen) };
  const flatList = tree.flatList === true;
  const minPiece = Math.round(MIN_TAP_PIECE_FRACTION * Math.min(screen.width, screen.height));
  const order: Placed[] = [];
  const walk = (node: UiNode, parent: Placed | undefined, scroller: Placed | undefined): void => {
    const inKeyboard = parent?.inKeyboard === true || node.ofKeyboard === true || node.role === KEYBOARD_ROLE;
    const placed: Placed = { node, at: order.length, end: 0, inKeyboard, scroller, parent };
    order.push(placed);
    for (const child of node.children) walk(child, placed, scrolls(node) ? placed : scroller);
    placed.end = order.length;
  };
  walk(tree, undefined, undefined);

  const draws = (placed: Placed, question: Question): boolean => !ROWS.some((row) => row[question]?.(placed, seen) === true);
  const drawsOverTarget = (placed: Placed, about: SeenFor): boolean => !ROWS.some((row) => row.target?.(placed, about) === true);
  /** Every place of `node` in the walk — the same object may sit at several (`shadowing`'s rule). */
  const placesOf = (node: UiNode): Placed[] => order.filter((p) => p.node === node);
  /** What is drawn after `node` — after its first place, outside every one of its places' subtrees — that `keep` keeps. */
  const laterThan = (places: readonly Placed[], keep: (p: Placed) => boolean): Placed[] =>
    after(places[0]).filter((p) => !places.some((place) => within(p, place)) && keep(p));
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
      const places = placesOf(node);
      if (places.length === 0) return undefined;
      return laterThan(places, (p) => draws(p, 'shadowing') && containsPoint(p.node.rect, point)).at(-1)?.node;
    },
    drawnOver,
    drawnOverAt(container, point) {
      return (drawnOver(container) ?? []).filter((n) => containsPoint(n.rect, point) && !rectWithin(container, n.rect)).at(-1);
    },
    exposure(node, box) {
      const shown = rectIntersection(node.rect, box);
      const places = placesOf(node);
      const about: SeenFor | undefined = places.length === 0 ? undefined : { ...seen, target: places[0], flatList };
      const covers =
        shown === undefined || about === undefined
          ? []
          : laterThan(places, (p) => rectIntersection(p.node.rect, shown) !== undefined && drawsOverTarget(p, about)).map((p) => p.node);
      const pieces = covers.reduce<Rect[]>((left, cover) => left.flatMap((piece) => subtract(piece, cover.rect)), shown === undefined ? [] : [shown]);
      const area = rectArea(node.rect);
      const largest = largestRect(pieces);
      const coverAt = (point: Point): UiNode | undefined => covers.filter((c) => containsPoint(c.rect, point)).at(-1);
      const centre = tapPoint(node);
      const onCentre = shown !== undefined && containsPoint(shown, centre);
      const centreCover = onCentre ? coverAt(centre) : undefined;
      const tappable = largestRect(pieces.filter((r) => r.width >= minPiece && r.height >= minPiece));
      const tapAt: Exposure['tapAt'] =
        onCentre && centreCover === undefined
          ? { point: centre, moved: false }
          : tappable === undefined
            ? undefined
            : { point: rectCentre(tappable), moved: true, piece: { ...tappable } };
      return {
        shows: area > 0 ? pieces.reduce((sum, r) => sum + rectArea(r), 0) / area : 0,
        covers,
        ...(largest !== undefined && { largest: { ...largest } }),
        ...(centreCover !== undefined && { centreCover }),
        ...(tapAt !== undefined && { tapAt }),
        minPiece,
        coverAt,
      };
    },
  };
}
