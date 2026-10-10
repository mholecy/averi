import { everyNode, INPUT_ROLE, KEYBOARD_ROLE, rectArea, rectIntersection, sameRect, SCREEN_SIZED_FRACTION, STRUCTURAL_ROLES, type Point, type Rect, type UiNode } from '../adapters/types.js';
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
 * tree does not list (the translucent top bar idb gives as its button and
 * title only, a top bar WDA lists BEFORE the scroll view it is drawn over)
 * is not inferred — the bug note's decision 4; iOS's status bar is no
 * cover but off the screen, cut out of `within` by the caller
 * (interact/swipe.ts#belowStatusBand). Knows no
 * platform commands; the platform shapes are in the rows, each with the
 * device tree it was measured on, and the marks of a source it reads are
 * on the tree's root (`UiNode.flatList`, `UiNode.paddedTouchTargets`). The
 * rect arithmetic it asks — the
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
   * place in the tree, as `shadowing`) — and a floating tab bar's items
   * listed before it, when it lies outside the bar (`tabBarsOf`: the bar
   * floats over the content whatever its source's order) — that draw for a
   * target (`NOT_DRAWN`'s `target` column) and share area with the part of
   * `node` inside `within` — a cover's rect, or, for a node pinned at the
   * bottom of idb's flat list, that rect run down to the screen's bottom
   * edge (`bottomPinned`, `pinnedReach`: the pinned bar's background and hit
   * area, which idb lists as no node), and, for a tab bar's item, raised
   * above it by the bar's lift (its surface, no node of any tree). A node
   * not in this tree has no covers.
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
  /** The nodes drawn over it inside `within`, in pre-order (a floating tab bar's items listed before it among them, `tabBarsOf`); empty when none. */
  readonly covers: readonly UiNode[];
  /**
   * Where each of `covers` presses, in the same order: its rect, or — for a
   * node pinned at a flat list's bottom (`bottomPinned`) — its reach
   * (`pinnedReach`), raised by its bar's lift for a floating tab bar's item
   * (`tabBarsOf`, `TAB_BAR_REACH_FRACTION`). The rects `shows`, `largest` and `coverAt` are judged
   * against, so a caller asking where a cover lies over the target (scroll-
   * rounds.ts#overFarSide) asks of the same rect.
   */
  readonly reaches: readonly Rect[];
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
  /** The cover drawn on top at `point` — the last of `covers` whose rect (a pinned node's reach, `exposure`) contains it — or undefined. */
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
  readonly screenArea: number;
}

/**
 * What the `target` column is judged against besides: the target, at its
 * first place in the walk, whether the tree is a flat list (`UiNode.flatList`
 * on its root), and — in one — where its content starts (`contentFrom`).
 */
interface SeenFor extends Seen {
  readonly target: Placed;
  readonly flatList: boolean;
  /** The walk index of a flat list's first content node (`firstContent`): the nodes before it are its top bar. The walk's length when there is none, or the tree is not a flat list. */
  readonly contentFrom: number;
  /** The bottom of the top bar's band (`FLAT_LIST_TOP_BAR_FRACTION` of the screen): content ending above it may lie under the bar. */
  readonly barLine: number;
  /** The walk index of the reading-order break after a flat list's CONTENT target (`readingBreak`): the later nodes from it on are no cover of it. The walk's length when there is none, the target is the top bar's, or the tree is not a flat list. */
  readonly readingBreak: number;
  /** A flat list's bottom chrome — the nodes pinned at its bottom (`bottomPinned`), idb's keyboard (`keyboardOf`) and a floating tab bar's items (`tabBarsOf`): never past the break. */
  readonly bottomChrome: ReadonlySet<Placed>;
  /** The tree's source lists a control's touch target as its wrapper (`UiNode.paddedTouchTargets` on its root): `ownControl`'s padded shape is asked only then. */
  readonly paddedTouchTargets: boolean;
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

/** A rect whose area reaches SCREEN_SIZED_FRACTION of the screen's (`screenOf`) — the one area test; children or none, the caller asks. */
const fillsScreen = (r: Rect, screenArea: number): boolean => rectArea(r) >= screenArea * SCREEN_SIZED_FRACTION;

/**
 * The `structural` row's wrapper excuse for a target: `node` holds the
 * target's whole rect, and is the screen's size or holds the target's
 * nearest scroll view whole.
 */
const holdsWhole = (node: UiNode, target: Placed, screenArea: number): boolean =>
  rectWithin(target.node.rect, node.rect) &&
  (fillsScreen(node.rect, screenArea) || (target.scroller !== undefined && rectWithin(target.scroller.node.rect, node.rect)));

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

/** A node with children that `fillsScreen`: it draws through its content, which is walked. */
const screenSized = (n: UiNode, screenArea: number): boolean => n.children.length > 0 && fillsScreen(n.rect, screenArea);

/** A descendant that cannot be an item: a named wrapper type with nothing of its own (`container` — not `other`, see `itemlessToolbar`). */
const emptyFrame = (n: UiNode): boolean => n.role === 'container' && !n.label && !n.value && !n.identifier;

/** Every descendant of `n` is an empty frame (`emptyFrame`) — true of a leaf. */
const framesOnly = (n: UiNode): boolean => n.children.every((child) => [...everyNode(child)].every(emptyFrame));

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

/** `placed` is a sibling of `target`: both have the same parent. */
const siblingOf = (placed: Placed, target: Placed): placed is Placed & { readonly parent: Placed } => placed.parent !== undefined && placed.parent === target.parent;

/** The `onTarget` row's sibling: see the row. */
const drawnOn = (placed: Placed, { target, flatList }: SeenFor): boolean => {
  const { node } = placed;
  return (
    siblingOf(placed, target) &&
    !isInteractive(node) &&
    (!flatList || repeats(node, target.node)) &&
    node.rect.width < target.node.rect.width &&
    node.rect.y + node.rect.height <= target.node.rect.y + target.node.rect.height &&
    containsPoint(target.node.rect, tapPoint(node))
  );
};

/**
 * The `onTarget` row's nested content: a non-interactive node lying wholly
 * inside a CHILDLESS target, whose parent is a sibling drawn on it
 * (`drawnOn`) — one wrapper down, as measured; deeper is not excused.
 */
const ownContent = ({ node, parent }: Placed, about: SeenFor): boolean =>
  parent !== undefined &&
  about.target.node.children.length === 0 &&
  !isInteractive(node) &&
  rectWithin(node.rect, about.target.node.rect) &&
  drawnOn(parent, about);

/** The `ownControl` row's text button or row: `control` has `parent`'s x and width exactly, at any height. */
const spansWidth = (control: Rect, parent: Rect): boolean => control.x === parent.x && control.width === parent.width;

/**
 * The `ownControl` row's icon button: `control` lies in `parent` PADDED
 * evenly on all four sides — every inset at least a pixel, the four within
 * a pixel of each other (a centred placement's rounding), none more than
 * half the control's shorter side, to a pixel (Compose pads a control of at
 * least 24 dp to its 48-dp touch target: 63 px in 126 at 2.625 px/dp,
 * insets 32 and 31) — and centred on the target, to a pixel.
 */
const paddedOn = (control: Rect, parent: Rect, target: Rect): boolean => {
  const insets = [control.x - parent.x, parent.x + parent.width - control.x - control.width, control.y - parent.y, parent.y + parent.height - control.y - control.height];
  const least = Math.min(...insets);
  const most = Math.max(...insets);
  const [c, t] = [rectCentre(control), rectCentre(target)];
  return least >= 1 && most - least <= 1 && 2 * most <= Math.min(control.width, control.height) + 1 && Math.abs(c.x - t.x) <= 1 && Math.abs(c.y - t.y) <= 1;
};

/**
 * How far a label may overhang the text input it lies in and still be read
 * as that field's (`fieldOf`, the `ownControl` row), on every side, in the
 * tree's units: 2 — the owner's decision of round 7, "up to 1–2 pt";
 * measured, the SWIFT form's `Payee’s name` `42,446 103x22` over its
 * `textfield 42,447 318x20`, 1 pt above and below. In pixels on Android, so
 * there a third of that — stricter, the safe direction.
 */
export const LABEL_OVERHANG = 2;

/**
 * The `ownControl` row's text input: `control` is one (`INPUT_ROLE`),
 * holds `target`'s centre, and holds its rect whole once grown by
 * `LABEL_OVERHANG` on every side.
 */
const fieldOf = (control: UiNode, target: Rect): boolean =>
  control.role === INPUT_ROLE &&
  containsPoint(control.rect, rectCentre(target)) &&
  rectWithin(target, { x: control.rect.x - LABEL_OVERHANG, y: control.rect.y - LABEL_OVERHANG, width: control.rect.width + 2 * LABEL_OVERHANG, height: control.rect.height + 2 * LABEL_OVERHANG });

/** A `toolbar` none of whose descendants could be an item (`itemlessToolbar`). */
const itemless = (n: UiNode): boolean => n.role === 'toolbar' && framesOnly(n);

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
   * And, since round 7 (docs/bugs/2026-10-09-ios-wda-cell-background-and-
   * textfield-scroll-bar-read-as-covers.md), an unlabelled, unvalued one
   * whose every descendant is an EMPTY FRAME (`framesOnly`; a leaf is the
   * case of none), as `itemlessToolbar` judges a toolbar: it carries
   * nothing drawable. Measured under WDA on Settings › General › Language &
   * Region (iOS 27): a grouped cell `container LOCALE 'Region, Slovakia'
   * 20,411 362x54` lists its button's wrapper, then its background —
   * `container 20,411 362x54` → `container 20,411 362x54`, nothing else —
   * then a separator and the chevron; the background, the cell's size and
   * neither the screen's nor holding its scroll view, refused `tap
   * text:"Region"` and `id:LOCALE`, and `scroll_until` swiped to maxSwipes
   * with the row on screen. The Compose tab-bar host still covers: its
   * tabs carry identifiers and labels. Residual, stated: an opaque wrapper
   * whose only content is empty frames (a card's background drawn by a
   * bare `Other` over a row it was laid after), or an icon WDA gives as
   * nested empty frames (an RN SVG: the myport login's flag icons, whose
   * unlabelled frames no longer cover the switcher they lie in), reads as
   * drawing nothing — a false "clear"; WDA gives such a node no trait that
   * tells it from the cell's background.
   */
  structural: {
    shadowing: ({ node }) => STRUCTURAL_ROLES.has(node.role),
    drawnOver: ({ node }) => STRUCTURAL_ROLES.has(node.role) && node.children.length === 0 && !node.label && !node.value,
    target: ({ node }, { target, screenArea }) => STRUCTURAL_ROLES.has(node.role) && !node.label && !node.value && (framesOnly(node) || holdsWhole(node, target, screenArea)),
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
    shadowing: ({ node }, { screenArea }) => !isInteractive(node) && screenSized(node, screenArea),
    drawnOver: ({ node }, { screenArea }) => screenSized(node, screenArea),
    target: ({ node }, { screenArea }) => !isInteractive(node) && screenSized(node, screenArea),
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
   * scroll-view ancestor — `flatListChrome` stands in for it over the top
   * bar.
   */
  scrolledContent: {
    target: ({ scroller }, { target }) => scroller !== undefined && !within(target, scroller),
  },

  /**
   * CONTENT OVER THE TOP BAR, IN A FLAT LIST: under idb (`UiNode.flatList`
   * on the root), a node at or after the list's first CONTENT node that
   * ends inside the top bar's band (`barLine`), over a target listed before
   * that node — the top bar's (`firstContent`, `contentFrom`).
   * `target` only: chrome before content, the owner's decision of 2026-10-09
   * on device check C3-3 (docs/bugs/2026-10-08-tap-and-scroll-until-
   * ignore-pinned-app-chrome.md), replacing the interim `flatListAbove`.
   *
   * Measured (tests/fixtures/idb-swift-form-scrolled-under-top-bar.json,
   * six scroll positions of mp-native's SWIFT form): idb lists the
   * Application `0,0 402x874`, then the top bar — `button 'Back'` `30,70
   * 28x28`, the title `136,74 130x20` — then every form row in reading
   * order, then the pinned CONTINUE; a screenshot shows the bar opaque, Back
   * and the title drawn in full and the rows scrolled under it hidden. idb's
   * list is flat, so `scrolledContent` cannot tell a row of the form from
   * the bar over it, and every row follows the bar's items in the list. The
   * interim rule (a later node covers only when its top lies at or below
   * the target's) refused Back and the title at 3 of 6 positions — a
   * floating label, a textfield, a helper line with its top at 75, 80 or 82,
   * inside Back's 70–98 — all three false. Here the bar's items are listed
   * before the content, and content listed after them is no cover of them,
   * wherever its top lies; between content nodes this row changes nothing —
   * the pinned CONTINUE, listed after the rows, still covers
   * `priority_select` (content over content is `flatListReadingOrder`'s).
   * Only content that ENDS inside the bar's band (`barLine`,
   * `FLAT_LIST_TOP_BAR_FRACTION`) is excused — a row scrolled under the bar
   * lies in it (the measured IBAN at 75–95, `will_remain` at 80–95), while a
   * menu, a sheet or a dialog listed after the content reaches past it and
   * covers what it lies on, the bar's items too (review of fix/r6-ios-top,
   * MAJOR 1: on a screen with no bar the first rows inside the band are read
   * as the bar's, and a menu `150,70 240x130` listed last over Row1 `0,62
   * 402x44` read "clear" until the menu had to reach past the band).
   *
   * Residuals, stated: content listed after the bar that really is drawn
   * over it and ends inside the band — a small popover or tooltip over a
   * bar item, or over a first row read as the bar's — is not seen (a false
   * "clear": the tap may press it). A node of the bar listed after
   * the first content node (`firstContent`'s misses) still meets content as
   * content: a row scrolled under it reads as cover — a false refusal, the
   * safe direction. Improved on the interim rule: a sheet laid over a bar
   * item it starts above is a cover again whenever it reaches past the band
   * (over a CONTENT target listed before it, it is not — the reading-order
   * break, `flatListReadingOrder`). WDA's nested tree and Android's never
   * meet this row: neither is marked.
   */
  flatListChrome: {
    target: ({ node, at }, { target, contentFrom, barLine }) => target.at < contentFrom && at >= contentFrom && node.rect.y + node.rect.height <= barLine,
  },

  /**
   * CONTENT LISTED PAST A READING-ORDER BREAK, IN A FLAT LIST: under idb
   * (`UiNode.flatList`), a node at or after the first node listed after a
   * CONTENT target (`contentFrom`) whose top lies ABOVE the target's top —
   * where idb resumes listing another container in reading order
   * (`readingBreak`) — unless it is the list's bottom chrome: pinned at
   * its bottom (`bottomPinned`), idb's keyboard (`keyboardOf`) or a
   * floating tab bar's item (`tabBarsOf`, round 7). `target`
   * only: the owner's decision of 2026-10-09 on docs/bugs/2026-10-09-ios-
   * idb-modal-listed-before-content-reads-covered-by-the-content-behind-
   * it.md, a regression of `flatListChrome`.
   *
   * Measured (tests/fixtures/idb-modal-listed-before-content.json): idb
   * lists mp-native's payment-type chooser — a card drawn over the dimmed
   * Account Detail, with no node of its own for the card or the backdrop —
   * in the MIDDLE of the screen's content: after the action buttons, its
   * rows `row_own 45,397 312x52` and `row_swift 45,453 312x52`, then the
   * transaction list it is drawn over (`filter_icon 348,358`,
   * `date_header_0 0,399`, `row_0 24,435`, …). Read as draw order, the list
   * behind covered the chooser, and `tap` refused `row_swift` "under button
   * 'Loan repayment…'". idb lists in reading order WITHIN a container, so
   * a node starting above the target is the next container's: for
   * `row_own` the break is `filter_icon` (358 < 397), for `row_swift` it
   * comes at once, for the SWIFT form's value-date picker
   * (`56,291 298x375`, listed after the title, before every row) the
   * debit row at 150 breaks it. Round 5's interim rule (a later node
   * covers only when its top lies at or below the target's) was not
   * enough: `date_header_0`'s top 399 lies below `row_own`'s 397. Between
   * the target and the break nothing changes: the pinned CONTINUE, listed
   * last after `priority_select`, still covers it, as a node listed after
   * a row and starting at or below it covers it (a footer's text in a
   * row). Nodes of no area never break (idb lists a 0×0 field).
   *
   * The bottom chrome is no break and never past one (review of
   * fix/r6b-idb, HIGH 1): CONTINUE starts above a label lying under it
   * (`42,807`) and covers it down to the screen's bottom; idb marks no
   * keyboard node, so its keys, listed last, are the only covers of the
   * rows under it, and a bar between the form and the keys (CONTINUE lifted
   * onto the number pad, run2-ios #250, `24,512` above a row at 545) must
   * neither excuse them nor be excused. Nor does a node that holds the
   * target whole break (pinned on a SYNTHETIC tree, no device dump:
   * r6b-icon's padded control `22,1099 110x110` round its icon at 1121, an
   * Android shape put in a flat list — tests/ui-tree/draw-order.test.ts; in
   * the 69 device dumps only a pinned CONTINUE and the keyboard's background
   * enclose a later-listed target), nor one ending
   * inside the top bar's band (`barLine`; review MEDIUM: Contacts' New
   * Contact lists `Toolbar 0,83 402x48` last, over `add birthday 20,109`
   * scrolled under it) — each a cover candidate in its own right. Bar items
   * are `flatListChrome`'s and never break: a menu listed after the content
   * that reaches past the band still covers them.
   *
   * Residuals, stated (accepted by the owner): a menu, sheet or popover
   * listed after the content that starts ABOVE a content target is no
   * cover of it — nor is anything listed after such a node (a false
   * "clear": the tap may press the menu). So is what follows a node that
   * starts above the target for another reason: a floating label listed
   * after its field and above it (`IBAN 42,359` after the field at
   * `42,380`) ends the field's covers — only a pinned bottom bar still
   * counts after it. Conversely a pinned bottom bar of the content behind
   * a modal still covers the modal's rows where it reaches them (a false
   * refusal, the safe direction). idb's keyboard is read by its background
   * (`keyboardOf`): keys listed with no such background — none in the
   * device dumps — are content, and a node starting above the target
   * before them excuses them. WDA's nested tree and Android's never meet
   * this row: neither is marked.
   */
  flatListReadingOrder: {
    target: (placed, { readingBreak, bottomChrome }) => placed.at >= readingBreak && !bottomChrome.has(placed),
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
   *
   * And what such a sibling holds (`ownContent`; 2026-10-09, docs/bugs/
   * 2026-10-09-android-compose-button-text-refused-as-under-its-own-
   * button.md): a
   * NON-INTERACTIVE node lying WHOLLY inside a CHILDLESS target, whose
   * parent is a sibling drawn on it — one wrapper down, the
   * measured depth; deeper still covers.
   * Childless: a leaf whose content is listed beside it (Compose's merged
   * label node, an RN view under WDA) has no other; a target with children
   * has its content as them, and a sibling's subtree beside it is the
   * stated residual above at one remove — the Compose tab-bar host drawn on
   * its list (a sweep at dd50327 found the host already excused there) is
   * not extended to its tabs. Measured on
   * mp-native's Account Detail (Compose): `container row_N` → the label
   * node `other 'Loan repayment, 17.12.2025, +493.00 EUR' 66,951 948x143`,
   * the avatar `container 116,980 88x88` → `text 'LR' 136,999 48x49`, the
   * amount texts, the row's `button` (`sameFrame`). The avatar was drawn on
   * the label node, its text — one wrapper down — read as a cover, and
   * `scroll_until … fully: true` never stopped on a row wholly on screen.
   * Under WDA the same reach: `login_support` (a childless RN view) and
   * its sibling `other login_support_email` drawn on it, whose text
   * `podpora@finportal.sk` no longer covers it (wda-source-myport-login-
   * keyboard.json). Still covers: an interactive descendant, one reaching
   * outside the target, anything under a sibling that is not drawn on it
   * (a full-width header's text). A flat list has no nesting, so idb never
   * meets it.
   */
  onTarget: {
    target: (placed, about) => drawnOn(placed, about) || ownContent(placed, about),
  },

  /**
   * THE TARGET'S OWN CONTROL: an INTERACTIVE node with no label and no value,
   * a sibling of a NON-INTERACTIVE target, that holds the target's rect whole
   * and either SPANS ITS PARENT'S FULL WIDTH — the parent's x and width
   * exactly (`spansWidth`) — or is PADDED in it on all four sides, evenly and
   * centred on the target (`paddedOn`); or a TEXT INPUT holding the target's
   * centre, the target overhanging it by at most `LABEL_OVERHANG`
   * (`fieldOf`, below); the parent not the screen's size
   * (`screenSized`), nor the control. `target` only (2026-10-09,
   * docs/bugs/2026-10-09-android-compose-button-text-refused-
   * as-under-its-own-button.md — a regression of this column's first round):
   * a Compose `Button` reaches uiautomator as a wrapper holding its label
   * text and, AFTER it, an unlabelled clickable `button` — mp-native's
   * `container 44,1397 992x132` → `text 'LOGIN' 481,1438 118x49`, `button
   * 44,1402 992x121`. That button read as drawn over the text: `tap
   * text:"LOGIN"` was refused, `scroll_until` called the screen a layout
   * defect, and an `optional:` tap skipped. A tap at the label's centre lands
   * on the button — what the caller means.
   *
   * The two shapes are the round-5 ui_snapshots' (tests/fixtures/android-
   * ui-snapshot-compose.json; every node there under a later unlabelled
   * interactive sibling is one of them). A TEXT button or a list row: the
   * control has its wrapper's x and width, and is inset only vertically —
   * Compose's minimum-touch-target padding, by a share that varies: LOGIN
   * and PAY 121 of 132 px, PAY ME and SCAN QR 113, Google Contacts' "No
   * thanks", "Sync device and SIM contacts", "Save", "Add phone" 110, "Add
   * phone" cut by the screen's bottom 96, "Add fields" 76 (an area share
   * from 0.58 to 0.92, so no area threshold fits; the vertical insets 5/6,
   * 9/10, 11/11, 11/25, 11/45 — uneven where the control is cut). A list
   * row's `button` IS the row, and stays whole where uiautomator cuts the
   * row's container at the list's edge or the floating tab bar's (`66,1784
   * 948x56` holding a `button 66,1784 948x143`), so this shape's control is
   * not held to lie within its parent, nor to any height. An ICON button
   * (2026-10-09, round 6b): Contacts' Cancel, More options and Delete —
   * `container 11,88 132x132` → the label node `other 'Cancel' 44,121
   * 66x66`, `button 22,99 110x110` — the control is inset 11 px on ALL
   * four sides (a 40-dp IconButton padded to its 48-dp touch target at
   * 2.75 px/dp) and its centre is the label's, so 0 % of the label showed
   * and `tap label:"Cancel"` was refused. `paddedOn` asks that shape and no
   * more: every inset at least a pixel, the four within a pixel of each
   * other — a centred placement rounds an odd margin (105 px in 126 at
   * 2.625 px/dp: 11 and 10) — none over half the control's shorter side,
   * to a pixel (Compose pads a control of at least 24 dp: 63 px in 126,
   * insets 32 and 31), and the label's centre within a pixel of the
   * control's. Not excused: a control padded differently per axis (a
   * 40×24-dp one: 4 dp and 12 dp; not measured); an icon button CUT by a
   * list's or scroll view's edge, whose insets are then uneven (`button
   * 22,99 110x80` in its 132×132 wrapper: 11, 11, 11, 41) — refused, as
   * at round 6, the safe direction; nor one spanning its wrapper's height
   * only (a tall narrow one). And only on a tree whose source lists a
   * control's touch target as its wrapper (`UiNode.paddedTouchTargets`,
   * uiautomator's root; code review of round 6b, P2): the shape was
   * measured there alone. No other mark tells uiautomator's tree from
   * WDA's — `clipsDescendants` is a node's, absent on an Android screen with
   * no scroller, and `ofKeyboard` comes only with a keyboard — so the source
   * marks its root, as idb's does `flatList`. Under WDA and idb an
   * unlabelled button padded evenly over a centred text stays a cover (a
   * false refusal, the safe direction). The width shape (`spansWidth`) is
   * asked of every tree, as at round 6.
   *
   * What still covers: a pinned CTA in the SAME parent as a text (review of
   * fix/r6: a classic View's `Button "LOG IN" 40,1150 1000x130` over "Forgot
   * password?" in its 1080-wide ConstraintLayout with the keyboard up,
   * `Button "CONTINUE"` over the terms text, a sheet's `Button "PAY"` over
   * its fee) — labelled, inset from its layout's sides and not evenly on all
   * four (LOG IN: 40, 40, 940, 20); a non-interactive node holding the label
   * (an opaque card, a loading view); an interactive TARGET under a later
   * control (a button over a button); a control in a screen-sized parent, or
   * screen-sized itself (`screenSized`: at least SCREEN_SIZED_FRACTION, 0.9,
   * of the screen) — a scrim, an RN transparent Modal's backdrop, a dismiss
   * region, ONLY when it or its parent is that large (see the residual); one
   * that does not hold the label whole (a field's clear button); one in
   * another parent. idb's flat list meets only the text-input shape: every
   * node's parent is its 0×0 root, which no control spans or lies in. Residual, stated: an
   * unlabelled interactive node spanning the width of a wrapper it shares
   * with a label, or padded evenly in it and centred on the label, is read as
   * the label's control, and the tap is sent to it — geometry cannot tell it
   * from a Compose Button. So: a Compose `clickable(role = Role.Button)`
   * overlay laid over a text in a Box of its width (a card's tap target, a
   * disabled-state scrim cut to the card), an unlabelled `ImageButton`
   * filling a thumbnail's FrameLayout over its caption text, an unlabelled
   * full-width bar button pinned over a text in the bar's own layout, and —
   * under WDA — a React Native in-tree dismiss backdrop (a `Pressable` with
   * `absoluteFill` and `accessibilityRole="button"`, no label) inside a
   * safe-area container `0,59 402x781`, 0.894 of the screen and so not
   * screen-sized: the backdrop spans the container's width and holds the
   * sheet's texts — all excused; and, on uiautomator's tree, an unlabelled
   * clickable overlay laid with an even margin over a centred text in its
   * card (the margin at most half the overlay's side).
   *
   * And a THIRD shape, the text input over its own label (round 7, the
   * owner's decision; docs/bugs/2026-10-09-ios-wda-cell-background-and-
   * textfield-scroll-bar-read-as-covers.md): an unlabelled, unvalued text
   * input that holds the label's centre, the label overhanging it by at
   * most `LABEL_OVERHANG` on any side (`fieldOf`) — neither spanning its
   * parent nor padded in it. Measured under WDA on the SWIFT form: `container
   * swift_payment.form.payee_name_input 24,431 354x52` → `text 'Payee’s
   * name' 42,446 103x22`, then `textfield 42,447 318x20` — the label 1 pt
   * taller than the field above and below, so not held whole, and the field
   * inset 18 pt from its wrapper; it refused `tap text:"Payee’s name"`, the
   * natural selector for an unlabelled field, on every such row of the form,
   * while a tap at the label's centre lands in the field. A row of this
   * table, not one of its own: it is the same judgement — the label's
   * control laid after it, taking the tap the caller means — whose
   * geometry is per shape. Still covers: a label overhanging further, or
   * whose centre lies off the field (a floating label above its outline); a
   * labelled or valued field (one holding typed text: the label it lies on
   * is then not its placeholder — a residual, stated: a placeholder label
   * WDA keeps listing over a filled field is refused); any other control
   * of that shape (a button).
   */
  ownControl: {
    target: (placed, { target, screenArea, paddedTouchTargets }) =>
      siblingOf(placed, target) &&
      isInteractive(placed.node) &&
      !placed.node.label &&
      !placed.node.value &&
      !isInteractive(target.node) &&
      ((rectWithin(target.node.rect, placed.node.rect) &&
        (spansWidth(placed.node.rect, placed.parent.node.rect) || (paddedTouchTargets && paddedOn(placed.node.rect, placed.parent.node.rect, target.node.rect)))) ||
        fieldOf(placed.node, target.node.rect)) &&
      !screenSized(placed.parent.node, screenArea) &&
      !fillsScreen(placed.node.rect, screenArea),
  },

  /**
   * A SCROLL INDICATOR: a `container` (WDA's `Other`) that is a direct
   * child of a scroll view (`scrolls`) or of a text input
   * (`INPUT_ROLE`) and holds nothing but empty frames
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
   *
   * A text input's too (round 7, docs/bugs/2026-10-09-ios-wda-cell-
   * background-and-textfield-scroll-bar-read-as-covers.md): a UITextField
   * scrolls its text, and WDA lists its indicator as its child — the SWIFT
   * form's `textfield 42,447 318x20` → `Other 'Horizontal scroll bar, 1
   * page' 42,454 318x10` → a bare thumb `45,461 309x3` — which refused `tap
   * text:"Payee’s name"`, the field's placeholder label beside it, and
   * named the bar over every such label of the form. Matched by its shape
   * and its parent's role, never by its label: WDA's label follows the
   * device's language. A labelled `container` of that shape under any other
   * interactive parent (a button) still covers.
   */
  scrollIndicator: {
    target: ({ node, parent }) =>
      parent !== undefined &&
      (scrolls(parent.node) || parent.node.role === INPUT_ROLE) &&
      node.role === 'container' &&
      !node.identifier &&
      node.children.length > 0 &&
      framesOnly(node),
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

/**
 * The top of the screen a flat list's top bar lies in (`firstContent`), as
 * a fraction of the screen's height: 20 %, 175 pt of the 874-pt iPhone 17.
 * Measured: idb lists the SWIFT form's Back at y 70–98 and its title at
 * 74–94, under a bar that ends at y 116 (13 %); a large-title bar ends
 * near 158 pt of 874 (18 %, inferred). A content row lying wholly inside
 * this band at the head of the content is read as the bar's
 * (`firstContent`'s misses, stated there).
 */
export const FLAT_LIST_TOP_BAR_FRACTION = 0.2;

/**
 * Where a flat list's CONTENT starts (`flatListChrome`): the walk index of
 * the first node, after the root and the screen-sized structural hosts
 * (idb's Application, `other`), that lies
 * outside the top bar's band (`FLAT_LIST_TOP_BAR_FRACTION`: not wholly
 * between the screen's top and that line — a row scrolled above the screen
 * is outside it) or that overlaps a node of the bar before it (a row
 * scrolled up under the bar is listed after the bar's items and lies on
 * them; the bar's own items lie side by side). The nodes before it are the
 * top bar's. Nodes with no area are skipped. `order.length` when the list
 * has no such node.
 *
 * Measured on the SWIFT form's six positions: the first content node is
 * always the form's first row, `debit_select`, at y -180…-117 — above the
 * screen. Misses, stated: a form whose first row lies wholly inside the
 * band and clear of the bar's items (at rest just below a short bar, or
 * scrolled to sit between it and the band's line) is read as the bar's —
 * harmless while nothing listed after it lies on it; and a node of the bar
 * that overlaps another (a badge on a bar button) starts the content, so
 * the bar's items after it meet the rows as content do.
 */
function firstContent(order: readonly Placed[], screen: Rect, screenArea: number, line: number): number {
  const bar: Rect[] = [];
  for (const { node, at } of order.slice(1)) {
    const r = node.rect;
    if (!(rectArea(r) > 0) || (STRUCTURAL_ROLES.has(node.role) && fillsScreen(r, screenArea))) continue;
    if (r.y < screen.y || r.y + r.height > line || bar.some((b) => rectIntersection(b, r) !== undefined)) return at;
    bar.push(r);
  }
  return order.length;
}

/**
 * The bottom of the screen a flat list's pinned bar lies in (`bottomPinned`),
 * as a fraction of the screen's height: 6 %, 52 pt of the 874-pt iPhone 17.
 * Measured (round-6 device check, H-1): the SWIFT form's pinned CONTINUE
 * `24,780 354x44` ends at 824, 50 pt above the screen's bottom — the home
 * indicator's safe area and the bar's margin; the floating tab bar idb lists
 * on Account Detail (`37,755 82x64`, bottom 819, 55 pt) lies outside it.
 */
export const FLAT_LIST_BOTTOM_BAR_FRACTION = 0.06;

/**
 * idb's SOFT KEYBOARD, read by its shape (`flatListReadingOrder`): idb marks
 * no keyboard node, so its keys — plain `button`s listed LAST — are the only
 * covers of the rows under it. Its background is a screen-wide, unlabelled
 * structural node ending at the screen's bottom and starting below the top
 * bar's band (so never the screen's size), listed right after the keys; the
 * keyboard is that node and the run of nodes listed beside it (before and
 * after, in the list's order) lying wholly inside it. Measured on all four
 * keyboard dumps of the round-2 to round-8 device checks: run2-ios #250 (the
 * SWIFT form's number pad, `other 0,589 402x285` after `1`…`Delete`),
 * run3-ios #45 and #51 and run8-ios #233 (`other 0,590 402x284` after the
 * QWERTY keys, `Dictate 325,805 68x69` after it). Shape, not labels: key
 * labels follow the language and the layout. The app's own PIN pad (run5-ios
 * #81) has no such background, and is content. Undefined when no node has
 * that shape (the last one listed is taken).
 */
function keyboardOf(order: readonly Placed[], screen: Rect, barLine: number): { readonly top: number; readonly keys: ReadonlySet<Placed> } | undefined {
  const bottom = screen.y + screen.height;
  let back: Placed | undefined;
  for (let i = order.length - 1; i > 0 && back === undefined; i--) {
    const { node } = order[i];
    const r = node.rect;
    if (STRUCTURAL_ROLES.has(node.role) && !node.label && r.x === screen.x && r.width === screen.width && r.y + r.height === bottom && r.y >= barLine) back = order[i];
  }
  if (back === undefined) return undefined;
  const inside = (p: Placed | undefined): boolean => p !== undefined && rectWithin(p.node.rect, back.node.rect);
  let from = back.at;
  while (from > 1 && inside(order[from - 1])) from--;
  let to = back.at + 1;
  while (inside(order[to])) to++;
  return { top: back.node.rect.y, keys: new Set(order.slice(from, to)) };
}

/**
 * The nodes of a flat list PINNED AT ITS BOTTOM, each with the line its
 * reach runs down to (the `exposure` question's reach, `pinnedReach`): an
 * interactive node whose bottom lies on the screen and inside
 * its bottom band (`FLAT_LIST_BOTTOM_BAR_FRACTION`) — so content: a node of
 * the top bar (`firstContent`) lies wholly in the top 20 % — and below
 * which nothing listed after it starts (at or below its bottom) — not a row
 * in the middle of a list that runs on past the screen (Account Detail's
 * `row_4 24,817 354x52` under the payment-type chooser, followed by
 * `date_header_5` at 876); it reaches the screen's bottom. Measured: the
 * SWIFT form's CONTINUE, listed last at every position. And a bar LIFTED
 * onto idb's keyboard (`keyboardOf`): the same, with the keyboard's top for
 * the screen's bottom and its keys left out of "listed after it"; it
 * reaches the keyboard's top. Measured: run2-ios #250, CONTINUE `24,512
 * 354x44` (bottom 556, 33 pt above the keyboard at 589), listed after the
 * form and before the keys — the SHAPE; its reach down to the keyboard's
 * top is INFERRED, not measured by a tap (kept by the owner, code review of
 * round 6b P4): checked on the screenshot `run2-ios/img-253-0.png`, the
 * lifted bar's background between it and the keys; no tap below a lifted
 * bar's frame has been sent. Residual, stated (as before this rule): the
 * last row of a list that ends inside the band, with nothing listed after
 * it, reads as pinned — it reaches down over what lies below it in its
 * column (on screen, only content listed before it: a false refusal, the
 * safe direction). Empty on a tree that is not a flat list.
 */
function bottomPinned(order: readonly Placed[], screen: Rect, keyboard: ReturnType<typeof keyboardOf>): ReadonlyMap<Placed, number> {
  const band = screen.height * FLAT_LIST_BOTTOM_BAR_FRACTION;
  const pinned = new Map<Placed, number>();
  const floors = [{ floor: screen.y + screen.height, keys: new Set<Placed>() }, ...(keyboard === undefined ? [] : [{ floor: keyboard.top, keys: keyboard.keys }])];
  for (const placed of order) {
    if (!isInteractive(placed.node)) continue;
    const r = placed.node.rect;
    const end = r.y + r.height;
    const later = order.slice(placed.end).filter(({ node }) => rectArea(node.rect) > 0);
    const on = floors.find(({ floor, keys }) => end <= floor && end >= floor - band && !later.some((p) => !keys.has(p) && p.node.rect.y >= end));
    if (on !== undefined) pinned.set(placed, on.floor);
  }
  return pinned;
}

/**
 * A FLOATING TAB BAR's reach ABOVE its items, as a fraction of their height
 * (`tabBarsOf`, `exposure`): 0.2 — the owner's decision (round 7, docs/bugs/
 * 2026-10-09-ios-floating-tab-bar-surface-above-its-buttons-takes-a-rows-
 * tap.md), unit-free, so the same in points and in pixels. Measured on
 * mp-native's Account Detail (iPhone 17, idb and WDA alike): the bar's pill
 * starts ≈12 pt above its 64-pt items (`run9-ios/img-374-0.png`, 743 against
 * 755) and is no node of either tree; 0.2 × 64, rounded, is 13.
 */
export const TAB_BAR_REACH_FRACTION = 0.2;

/** The share of the screen's width a tab bar's items together span (`tabBarsOf`): 60 % — mp-native's four 82-pt items, 328 of 402 pt (82 %). */
export const TAB_BAR_WIDTH_FRACTION = 0.6;

/**
 * The bottom of the screen a tab bar's items end in (`tabBarsOf`), as a
 * fraction of its height: 10 %, 87 pt of the 874-pt iPhone 17 — mp-native's
 * items end at 819, 55 pt above the bottom, outside the pinned bar's
 * `FLAT_LIST_BOTTOM_BAR_FRACTION`.
 */
export const TAB_BAR_BOTTOM_FRACTION = 0.1;

/** The fewest items a tab bar has (`tabBarsOf`). */
const TAB_BAR_MIN_ITEMS = 3;

/** A floating tab bar (`tabBarsOf`): its items, the box they span, and how far above them it reaches. */
interface TabBar {
  readonly items: ReadonlySet<Placed>;
  /** The items' bounding box: a target lying wholly in it is the bar's own (a tab, its label), and the bar is no cover of it. */
  readonly rect: Rect;
  /** `TAB_BAR_REACH_FRACTION` of the items' height, rounded: how far above them its surface reaches. */
  readonly lift: number;
}

/**
 * The FLOATING TAB BARS of a tree, read by their shape, asked of every tree
 * (the owner's decision, round 7): at least `TAB_BAR_MIN_ITEMS` INTERACTIVE
 * siblings of one rect's y and height, no two overlapping, together
 * spanning `TAB_BAR_WIDTH_FRACTION` of the screen's width, ending on the
 * screen and inside its bottom `TAB_BAR_BOTTOM_FRACTION`; the keyboard's
 * nodes (`Placed.inKeyboard`, and idb's keys, `keyboardOf`) are none — a
 * row of keys has the same shape. Such a bar floats over what lies outside
 * it, whatever the order its source lists it in (`exposure`), and its
 * surface reaches `TAB_BAR_REACH_FRACTION` of its items' height above them.
 * Measured (docs/bugs/2026-10-09-ios-floating-tab-bar-surface-above-its-
 * buttons-takes-a-rows-tap.md): idb lists mp-native's four tab items
 * `37,755 82x64` … `283,755 82x64` FIRST, then the content; WDA the row,
 * then the four buttons; neither lists the pill the bar draws from ≈743
 * down, over `transactions.list.row_3 24,721 354x52` — its centre (201,747)
 * read clear, and the tap pressed the Cards item. Not on Android's Compose
 * bar: its items reach uiautomator as `container`s, no interactive role, and
 * its host covers the rows beneath it as a structural node with children
 * (`NOT_DRAWN.structural`), listed after the list. Residuals, stated: a
 * bottom row of an app's own grid of buttons (a PIN pad's last row) that
 * has the shape reads as a bar — what lies within the reach above it, the
 * row of keys above included, reads as under it (a false refusal, the safe
 * direction; the centre of a key of the row above lies clear of it); a sheet
 * drawn over the bar has the bar's items over its rows where they reach them
 * (a false refusal); a tab bar of two items, or of items of unequal height,
 * is not seen.
 */
function tabBarsOf(order: readonly Placed[], screen: Rect, keys: ReadonlySet<Placed>): readonly TabBar[] {
  const bottom = screen.y + screen.height;
  const rows = new Map<string, Placed[]>();
  for (const placed of order) {
    const r = placed.node.rect;
    if (placed.parent === undefined || !isInteractive(placed.node) || !(rectArea(r) > 0) || placed.inKeyboard || keys.has(placed)) continue;
    const key = `${placed.parent.at} ${r.y} ${r.height}`;
    rows.set(key, [...(rows.get(key) ?? []), placed]);
  }
  return [...rows.values()].flatMap((items) => {
    const rects = items.map(({ node }) => node.rect);
    const { y, height } = rects[0];
    const end = y + height;
    const shaped =
      items.length >= TAB_BAR_MIN_ITEMS &&
      end <= bottom &&
      end >= bottom - screen.height * TAB_BAR_BOTTOM_FRACTION &&
      rects.reduce((sum, r) => sum + r.width, 0) >= screen.width * TAB_BAR_WIDTH_FRACTION &&
      rects.every((a, i) => rects.slice(i + 1).every((b) => rectIntersection(a, b) === undefined));
    if (!shaped) return [];
    const left = Math.min(...rects.map((r) => r.x));
    const right = Math.max(...rects.map((r) => r.x + r.width));
    return [{ items: new Set(items), rect: { x: left, y, width: right - left, height }, lift: Math.round(height * TAB_BAR_REACH_FRACTION) }];
  });
}

/**
 * The reading-order break after a flat list's CONTENT target
 * (`flatListReadingOrder`): the walk index of the first node after it with
 * area whose top lies above the target's — but never a node of the bottom
 * chrome (`bottomChrome`: pinned at the bottom, idb's keyboard, or a
 * floating tab bar's item), one that
 * holds the target whole (a later node enclosing it is a cover in its own
 * right — r6b-icon's padded control, on a synthetic tree, not a device
 * dump; in the 69 device dumps only a pinned CONTINUE and the keyboard's
 * background), or one ending inside the top bar's band (`barLine`: a bar
 * listed last — Contacts' `Toolbar 0,83 402x48`, run3-ios #102 — lies over
 * the rows scrolled under it).
 * `order.length` when there is none, or when the target is the top bar's
 * (`contentFrom`; never on a tree that is not a flat list, whose
 * `contentFrom` is the walk's length).
 */
function readingBreak(order: readonly Placed[], target: Placed, contentFrom: number, bottomChrome: ReadonlySet<Placed>, barLine: number): number {
  if (target.at < contentFrom) return order.length;
  const t = target.node.rect;
  return (
    order
      .slice(target.end)
      .find(({ node }, i, later) => rectArea(node.rect) > 0 && !bottomChrome.has(later[i]) && node.rect.y < t.y && node.rect.y + node.rect.height > barLine && !rectWithin(t, node.rect))?.at ??
    order.length
  );
}

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
  const seen: Seen = { screenArea: rectArea(screen) };
  const flatList = tree.flatList === true;
  const paddedTouchTargets = tree.paddedTouchTargets === true;
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
  const barLine = screen.y + screen.height * FLAT_LIST_TOP_BAR_FRACTION;
  const contentFrom = flatList ? firstContent(order, screen, seen.screenArea, barLine) : order.length;
  const keyboard = flatList ? keyboardOf(order, screen, barLine) : undefined;
  const pinned = flatList ? bottomPinned(order, screen, keyboard) : new Map<Placed, number>();
  /** Each floating tab bar's item, with its bar (`tabBarsOf`). */
  const tabItems = new Map(tabBarsOf(order, screen, keyboard?.keys ?? new Set()).flatMap((bar) => [...bar.items].map((item) => [item, bar] as const)));
  /** The bottom chrome of a flat list: never a reading-order break, never past one (`flatListReadingOrder`) — a floating tab bar's items included. */
  const bottomChrome: ReadonlySet<Placed> = new Set([...pinned.keys(), ...(keyboard?.keys ?? []), ...tabItems.keys()]);
  /**
   * Where a cover of a target presses (`exposure`): its rect — or, for a node
   * pinned at a flat list's bottom (`bottomPinned`), its rect run down to the
   * screen's bottom edge — or a bar lifted onto idb's keyboard down to the
   * keyboard's top (inferred from H-1 and checked on the screenshot
   * `run2-ios/img-253-0.png` — the lifted bar's background between it and the
   * keys — not measured by a tap; code review of round 6b P4) — across its
   * own x-range. Measured (round-6 device check, H-1,
   * `run8-ios/img-147-0.png`): with the SWIFT form's `Payee’s bank street &
   * no.` label at `42,817 186x20`, 3 pt below CONTINUE's frame `24,780
   * 354x44`, a tap at (135,827) opened SUMMARY — CONTINUE's hit area reaches
   * below its accessibility frame, and the bar's opaque background, which idb
   * lists as no node, hides the form from CONTINUE's top down to the screen's
   * bottom. Its x-range, not the screen's width: the tap that pressed it lay
   * inside it, and the screenshot cannot say more (the form's rows span
   * CONTINUE's 24–378 exactly); a narrow button at the bottom (a floating
   * action button) run across the screen would hide its neighbours.
   */
  const pinnedReach = (placed: Placed): Rect => {
    const r = placed.node.rect;
    const floor = pinned.get(placed);
    return floor === undefined ? r : { ...r, height: Math.max(r.height, floor - r.y) };
  };

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
      const about: SeenFor | undefined = places.length === 0 ? undefined : { ...seen, target: places[0], flatList, contentFrom, barLine, readingBreak: readingBreak(order, places[0], contentFrom, bottomChrome, barLine), bottomChrome, paddedTouchTargets };
      /** The tab bar `p` is an item of, when `node` lies outside it (`tabBarsOf`): a target wholly in the items' box is the bar's own. */
      const floatsOver = (p: Placed): TabBar | undefined => {
        const bar = tabItems.get(p);
        return bar === undefined || rectWithin(node.rect, bar.rect) ? undefined : bar;
      };
      /** Where `p` presses over this target: `pinnedReach`, raised by its tab bar's lift when it floats over the target. */
      const reach = (p: Placed): Rect => {
        const r = pinnedReach(p);
        const bar = floatsOver(p);
        return bar === undefined ? r : { ...r, y: r.y - bar.lift, height: r.height + bar.lift };
      };
      // A floating tab bar's items cover what lies outside the bar whatever the order its source lists them in (idb: first), never the target's ancestors.
      const before = places.length === 0 ? [] : order.slice(0, places[0].at).filter((p) => floatsOver(p) !== undefined && !places.some((place) => within(place, p)));
      const over =
        shown === undefined || about === undefined
          ? []
          : [...before, ...laterThan(places, () => true)].filter((p) => rectIntersection(reach(p), shown) !== undefined && drawsOverTarget(p, about)).map((p) => ({ node: p.node, reach: reach(p) }));
      const covers = over.map((c) => c.node);
      const pieces = over.reduce<Rect[]>((left, cover) => left.flatMap((piece) => subtract(piece, cover.reach)), shown === undefined ? [] : [shown]);
      const area = rectArea(node.rect);
      const largest = largestRect(pieces);
      const coverAt = (point: Point): UiNode | undefined => over.filter((c) => containsPoint(c.reach, point)).at(-1)?.node;
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
        reaches: over.map((c) => ({ ...c.reach })),
        ...(largest !== undefined && { largest: { ...largest } }),
        ...(centreCover !== undefined && { centreCover }),
        ...(tapAt !== undefined && { tapAt }),
        minPiece,
        coverAt,
      };
    },
  };
}
