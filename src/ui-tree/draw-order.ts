import { INPUT_ROLE, isTyped, KEYBOARD_ROLE, rectArea, rectIntersection, sameRect, STRUCTURAL_ROLES, type DrawnOverStrip, type Point, type PresentationKind, type Rect, type UiNode } from '../adapters/types.js';
import { containsPoint, flatListBarLine, largestRect, overlapsPastSlack, rectCentre, rectWithin, screenOf, subtract } from './geometry.js';
import { CONTENT_FRAMED_ROLES, fillsScreen, framesOnly, itemless, stackedScreens, within, type Placed } from './placed.js';
import { presentedByShape, type FrameRow, type PresentedByShape } from './presented-by-shape.js';
import { isInteractive, tapPoint } from './selectors.js';
import { clips, scrolls } from './scroll-containers.js';
import { flatListKeyboardBand } from './soft-keyboard.js';

/**
 * A presented layer the tree source marks (`UiNode.presentation`), as a sentence names it: its kind and its label (its
 * element's, for a typed layer).
 */
export interface MarkedLayer {
  readonly kind: PresentationKind;
  readonly label?: string;
}

/**
 * A presented surface as a sentence quotes it (`DrawOrder.presentedPress`): the `surface` `presentedAt`,
 * `presentedOver` or `markedAt` named, where it presses (`reach`: the whole screen for a marked presented layer's
 * cover — a typed layer's element, a `screen` layer itself — else its rect), and that marked `layer` when it is one's
 * cover.
 */
export interface PresentedPress {
  readonly surface: UiNode;
  readonly reach: Rect;
  readonly layer?: MarkedLayer;
}

/**
 * A presented layer the tree source marks, as draw order reads it (`markOf`): the `layer` (a Window's direct child),
 * its `kind`, the `element` naming a typed layer (`UiNode.presentationElement`: the alert, the action sheet, the
 * popover), and the `cover` that reaches the whole screen for it — that element, else the layer itself.
 */
interface PresentedLayer {
  readonly layer: Placed;
  readonly kind: PresentationKind;
  readonly element?: Placed;
  readonly cover: Placed;
  /** The layer as a sentence names it (`MarkedLayer`: its kind, its cover's label). */
  readonly named: MarkedLayer;
}

/**
 * What is drawn after a target as draw order reads it (`laterFor`): the `later` nodes, which of them is a marked
 * presented layer's cover (`markedCover`), and which lies in a marked `screen` layer (`inScreen`).
 */
interface LaterRead {
  readonly later: readonly Placed[];
  readonly markedCover: (p: Placed) => boolean;
  readonly inScreen: (p: Placed) => boolean;
}

/** `LaterRead` with nothing after the node and no marked layer over it. */
const NOTHING_LATER: LaterRead = { later: [], markedCover: () => false, inScreen: () => false };

/**
 * THE reading of the tree source's presented-layer marks (`UiNode.presentation` on the layer,
 * `UiNode.presentationElement` on a typed layer's element): the presented layer `layer` is, among the walk's `order`;
 * undefined for any other node. A typed layer whose element is not marked (a hand-built tree) is its own cover, named
 * by its own label.
 */
const markOf = (layer: Placed, order: readonly Placed[]): PresentedLayer | undefined => {
  const kind = layer.node.presentation;
  if (kind === undefined) return undefined;
  const element = isTyped(kind) ? order.slice(layer.at, layer.end).find((p) => p.node.presentationElement === true) : undefined;
  const cover = element ?? layer;
  return { layer, kind, ...(element !== undefined && { element }), cover, named: { kind, ...(cover.node.label ? { label: cover.node.label } : {}) } };
};

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
 * on Compose (the floating tab bar); for classic Android Views
 * uiautomator's sibling order is the accessibility child order, which
 * Android may sort by position rather than by Z (not measured) — there a
 * later sibling drawn beneath may read as drawn over, for every question.
 *
 * Seven questions, one per caller, read from two columns of `NOT_DRAWN`
 * (`drawnOverAt` reads `drawnOver`'s, `paintsOver` filters `exposure`'s,
 * `coversOf`, `presentedAt` and `presentedOver` read `exposure`'s):
 * - `drawnOver(container)` — `scroll_until`'s stroke box
 *   (interact/scroll-read.ts#TreeFacts, swipe.ts#strokeRoom): what is
 *   drawn over the clipping container a stroke goes over?
 * - `drawnOverAt(container, point)` — the exhausted stop's sentence
 *   (scroll-rounds.ts#touchedOn): which of those a stroke's touch-down hit
 *   (`drawnOver`'s column).
 * - `exposure(node, within)` — a TARGET's chrome: what is
 *   drawn over a node about to be tapped or scrolled to — a pinned CTA bar,
 *   a floating tab bar, a top bar laid after the form — what of it still
 *   shows, and where a tap on it should go (interact/tap-judgement.ts#
 *   TapJudge.aim for the tap and the fill's focus tap,
 *   standing.ts#Scene.standing for `scroll_until`'s stop, and the tap's
 *   standing again for the in-tree keyboard dismissal picker,
 *   interact/keyboard-in-tree.ts#pickDismissal).
 *   docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md
 * - `paintsOver(node, within)` — a pixel assert's chrome
 *   (ui-tree/standing.ts#Scene.standing's pixel purpose): which of
 *   `exposure`'s covers hide PIXELS of the node, not only the touch —
 *   `exposure` less the node's own content listed beside it, a clickable
 *   layer with nothing drawn, and an overlap no thicker than an edge
 *   (`PixelCover`'s doc has the rules and the measured shapes).
 * - `coversOf(node, region)` — the uiautomator parser's widening, through
 *   the port it is handed (adapters/types.ts#DrawnOverStrip): is anything
 *   drawn over the strip a node cut short of its own content would gain?
 * - `presentedAt(node, point)` — `scroll_until`'s stroke
 *   (standing.ts#Scene.presentedAt): is the touch-down of a
 *   stroke for a target not judged in the viewport on a surface of a screen
 *   presented over the target's own (`exposure`'s column, then a marked
 *   layer, or the shape fallback's surface: presented-by-shape.ts)?
 * - `presentedOver(node)` — the standing's remedy
 *   (ui-tree/standing.ts#remedied): is a screen presented over the
 *   target's own at all, wherever the target lies — `presentedAt` less the
 *   point?
 *
 * One fact is the tree source's, not a shape's: a LAYER it MARKS as presented (`UiNode.presentation`: WDA's typed
 * alert, action sheet or popover, or a screen its visibility flags show presented) covers every node drawn before it
 * and outside it through the whole screen — a typed layer through its element alone, its one cover; a `screen` layer
 * reaching the whole screen with its own nodes covers where they draw — each that screen's surface (`markedLayers`) —
 * for `exposure`, `paintsOver`, `coversOf`, `presentedAt` and `presentedOver` alike; the `drawnOver` column (the
 * stroke box) does not read it. The mark is read here and nowhere else (`markOf`): a verb learns of it from
 * `presentedPress` (`MarkedLayer`: its kind and label), never from the node. On a tree whose source judged presented
 * layers (`UiNode.presentationsJudged`) its marks are the presented layers, and no shape is asked; on any other tree
 * (Android, idb, a flagless WDA payload, a snapshot without `presentationsJudged`) a presented screen is still
 * inferred from shape by ONE fallback, asked from here only then (`Seen.byShape`, presented-by-shape.ts: a frame
 * row's excuse giving way over a presented screen, and that screen's surface).
 *
 * The two columns read the rows differently on purpose — each column of
 * `NOT_DRAWN` is what that question has been measured against, and where
 * they differ the row says why. Only nodes of the tree are covers: what a
 * tree does not list (the translucent top bar idb gives as its button and
 * title only, a top bar WDA lists BEFORE the scroll view it is drawn over)
 * is not inferred — the bug note's decision 4; the status bar (iOS's and
 * Android's) is no cover but a system band, cut out of `within` by
 * ui-tree/standing.ts#Scene. Knows no
 * platform commands; the platform shapes are in the rows, each with the
 * device tree it was measured on, and the marks of a source it reads are
 * on the tree's root (`UiNode.flatList`, `UiNode.paddedTouchTargets`). The
 * rect arithmetic it asks — the
 * subtraction of a cover from a target included — is geometry.ts's.
 */
export interface DrawOrder {
  /**
   * The nodes drawn over a clipping container, in pre-order: every node
   * after the container's subtree whose rect meets the container's with
   * area and that draws (`NOT_DRAWN`'s `drawnOver` column) — never an
   * ancestor or a descendant: its own rows scroll with it. The container is
   * found by its rect: the outermost node that clips (scroll-containers.ts#clips)
   * with that rect outside the keyboard, since the round carries containers
   * as rects (geometry.ts#clipsOf's `scrollersOf`, #largestScroller). UNDEFINED when this
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
   * place in the tree, and none of its own subtree wherever else the same
   * object appears) — and, in idb's flat list, a
   * floating tab bar's items listed before it, when it lies outside the bar
   * (`tabBarsOf`: idb lists the bar first; a nested tree's order is its draw
   * order) — that draw for a
   * target (`NOT_DRAWN`'s `target` column) and share area with the part of
   * `node` inside `within` — a cover's rect, or, for a node pinned at the
   * bottom of idb's flat list, that rect run down to the screen's bottom
   * edge (`bottomPinned`, `pinnedReach`: the pinned bar's background and hit
   * area, which idb lists as no node), and, for a tab bar's item, raised
   * above it by the bar's lift (its surface, no node of any tree). A node
   * not in this tree has no covers.
   */
  exposure(node: UiNode, within: Rect): Exposure;
  /**
   * The SURFACE of a screen presented over `node`'s own (a marked layer's, `markedLayers`, or by shape on a tree whose
   * source did not judge, presented-by-shape.ts: a modal's dimming leaf, a popover's or a half sheet's `dismiss
   * popup`, a sheet's scroll view) that holds `point`, wherever `node` lies — the last such drawn after it (the one on
   * top there), and one that draws for it as a target (`NOT_DRAWN`'s `target` column, as `exposure` asks before it
   * asks for a surface); undefined when none, or for a node not in this tree.
   * `exposure` cannot answer it for a node outside the box: it judges only what of the node shows, so a target below
   * the fold has no covers and no presented surface (`presentedOver` asks the same less the point). One reader:
   * `scroll_until`'s stroke (interact/scroll-rounds.ts#round, through standing.ts#Scene.presentedAt), which asks it at
   * the stroke's touch-down for a target it has not judged in the viewport — a stroke that would touch down on such a
   * screen is not sent (it may dismiss the screen, as one closed
   * Contacts' discard popover and then read the cell beneath "fully visible"). A surface of the node's OWN screen is
   * not one: a row of a sheet below the sheet's fold is stroked for on the sheet's form, as before. A layer the tree
   * source marks as presented (`markedLayers`) holds every point of the screen: with one up, every touch-down for a
   * target beneath it lies on it — so `scroll_until` stops wherever `presentedOver` names it.
   */
  presentedAt(node: UiNode, point: Point): UiNode | undefined;
  /**
   * The SURFACE of a screen presented over `node`'s own, judged of the NODE, geometry-free: `presentedAt`'s rule less
   * its point — the last node drawn after `node` that draws for it as a target (`NOT_DRAWN`'s `target` column) and is a
   * presented screen's surface (`markedLayers`, or presented-by-shape.ts) — wherever `node` lies: below the fold,
   * wholly inside the status band, cut, covered. Undefined when none, or for a node not in this tree. Being presented
   * over is a fact of the two layers (a mark, or the shape fallback's stacked screens), not of where the
   * node shows, so `exposure`'s `presented`, which judges only what of it shows inside the box, is its in-frame part:
   * a node with nothing in the box has none there. One reader: the standing's remedy (ui-tree/standing.ts#remedied),
   * which asks it when the frame named no presented surface — so the tap and the pixel assert tell a target wholly
   * off screen, or wholly under the status bar, beneath a sheet "close that screen first". `scroll_until` stops on it
   * only where `presentedAt` holds at its stroke's touch-down (or the surface lies over the target in its read's
   * frame): beneath a dim filling the screen it does, as the others say — and beneath a marked presented layer
   * (`markedLayers`), which reaches the whole screen; beneath an UNDIMMED partial sheet the touch-down misses, on a
   * tree whose source did not judge presented layers, it strokes while they say close it first.
   * docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md
   */
  presentedOver(node: UiNode): UiNode | undefined;
  /**
   * A presented surface `presentedAt`, `presentedOver` or `markedAt` named, as a sentence quotes it (`PresentedPress`):
   * where it presses — the reach `presentedAt` holds its point against: the whole screen for a marked presented layer's
   * cover (`markedLayers`: a typed layer's element, a `screen` layer itself), else its rect (geometry.ts#coverText
   * quotes it) — and that marked layer, which the remedy names (ui-tree/standing.ts#presentedRemedy). The verbs' one
   * view of the tree source's mark.
   */
  presentedPress(surface: UiNode): PresentedPress;
  /**
   * The presented layer the tree source marks (`markedLayers`, on the screen) a touch-down at `point` lands on, asked
   * for a stroke on behalf of NO target — one not in the tree, which `presentedAt` cannot ask for: the last such
   * layer, whose reach is the whole screen — none when the point lies on a scroll view of that layer's own (a stroke
   * scrolling the alert's own content, a search inside a sheet's own list; no layer beneath it is asked). Named by
   * its cover: a typed layer's element (an alert, an action sheet, a popover); for a `screen` layer, the last node of
   * it at the point that draws by the column that needs no target (`drawnOver`'s), else the layer itself. A node the
   * source says is not shown (`UiNode.hidden`) is neither such a scroll view nor named, as the `target` column's
   * `hidden` row judges it. A screen presented by shape alone is not asked here. Undefined when none. One reader:
   * `scroll_until`'s stroke (interact/scroll-rounds.ts#round, through standing.ts#Scene.presentedAt), which sends no
   * stroke that would land on it.
   */
  markedAt(point: Point): UiNode | undefined;
  /**
   * The nodes drawn over `region` of `node` as a TARGET, in pre-order: every
   * node after `node`'s subtree (its first place in the tree, as
   * `exposure`) whose rect meets `region` with area and that draws for a
   * target (`NOT_DRAWN`'s `target` column, judged with `node` as the
   * target). Unlike `exposure`, `region` may lie anywhere — outside `node`'s
   * own rect too: the uiautomator parser asks it of the strip a node cut
   * short of its own content would gain (adapters/android.ts#widenUnderCovers,
   * through types.ts#DrawnOverStrip). Rects as the tree gives them — no
   * flat-list reach, no tab-bar item listed before the node: a nested tree's
   * order is its draw order. Empty for a node not in this tree. The parser
   * asks only whether it is empty; the list is for diagnosis and tests.
   */
  coversOf(node: UiNode, region: Rect): readonly UiNode[];
  /**
   * The TOP EDGE of idb's soft keyboard band (`keyboardOf`, over
   * soft-keyboard.ts#flatListKeyboardBand), or undefined (a stroke started
   * on the keys, and a "354x7 part shows" was read inside the band). A
   * LINE, deliberately, and nothing more: not a reading of the keyboard
   * (soft-keyboard.ts#keyboardInTree stays `unknown` on an idb tree, and
   * with it every `shown`/`hidden` question of keyboard-cover.ts#readKeyboard
   * and the in-tree dismissal — a blind key there was measured to submit,
   * K5d). One reader: ui-tree/keyboard-position.ts#KeyboardPosition.line, the one
   * merge of every keyboard source into the line the tap, `scroll_until` and
   * the pixel assert judge and stroke against. Only a FLAT LIST
   * (`UiNode.flatList`, idb's mark) is read: WDA marks its band itself
   * (`KEYBOARD_ROLE`) and Android's keyboard is never in the tree — both
   * always undefined here. Read off the band this draw order already found
   * for its own rows, not by a second walk of the tree.
   * docs/bugs/2026-10-09-ios-idb-scroll-stroke-starts-on-the-soft-keyboard.md
   */
  readonly keyboardBandTop: number | undefined;
  /**
   * Is `node` idb's keyboard's OWN — its band's background, a key
   * (`sharesRow`), or a node listed after the background (Dictate)? The
   * keyboard's own UI on a flat list, as `UiNode.ofKeyboard` marks it on
   * WDA's tree: under no band line (ui-tree/keyboard-position.ts#KeyboardPosition.line's
   * `subject`). Always false on a tree with no band.
   */
  ofKeyboardBand(node: UiNode): boolean;
  /**
   * The covers of `exposure(node, within)` that hide PIXELS of `node` —
   * what a colour sample or an ocr crop of its rect would read instead of
   * it (ui-tree/standing.ts#Scene.standing's pixel purpose) — in
   * `exposure`'s order, each with its reach. `exposure` answers where a
   * TOUCH goes, so it counts what takes the touch and draws nothing; three
   * of its covers are left out here (found by a sweep of every node of
   * every fixture):
   * - the node's OWN CONTENT listed beside it: a cover whose reach lies
   *   wholly inside the node's rect, when it hangs off one of the node's
   *   own branches (`ownBranch`) — WDA's React Native `login_username_field`
   *   and the input box (36,367 330x52) and "Meno" field listed after it,
   *   `login_language_switcher` and its `lang_en_flag` and "English"
   *   button. A flat list has no branches, so there the cover must SAY
   *   something and nothing the node does not (`wordsOf`: idb lists a
   *   container with its children's text) — idb's account card and its
   *   "Accounting Balance, 2 000, ,00, CZK" text; a sheet listed after a
   *   card and inside its rect says other words and still counts (the rect
   *   alone would let a colour assert on the card PASS on the sheet). The
   *   words rule's residual is the ADR's (below).
   *   The REACH, not the frame: CONTINUE's frame lies inside a
   *   52-pt row it hangs over (`Payee's country` at 24,776,
   *   idb-swift-form-scrolled-under-top-bar pos6), and its reach, run down
   *   to the screen's bottom, does not;
   * - a CLICKABLE LAYER: an unlabelled, unvalued interactive node that
   *   holds the node's rect whole, on one of its own branches
   *   (`ownBranch`; never in a flat list, which gives no branches to tell
   *   a row's layer from a sheet's scrim) — Compose's card `button (66,275
   *   948x330)` listed after `text "1,121"` and the row buttons after
   *   every "LR" avatar (snapshot accountDetail*): the ripple's
   *   touch target, drawn transparent;
   * - an overlap no thicker than `PIXEL_OVERLAP_SLACK` on its thin side
   *   (geometry.ts#overlapsPastSlack; the owner's decision): idb's `text
   *   "Amount*"` (42,283 51x15) and `text "Value*"` at y 296, 2 pt; a
   *   `Payee's country` row ending 2 pt into CONTINUE.
   * `ownBranch`: the nearest ancestor of the node whose subtree holds the
   * cover is one component — at most OWN_BRANCH_SCREEN_FRACTION (half) of
   * the screen: a row, a card, a form's card. A cover met only at a larger
   * ancestor (a title in the navigation bar over a row of the form, a
   * dialog's scrim, a FAB in Compose's 90 % content container over a row
   * of its list: "not screen-sized", 90 %, would let that FAB through) is
   * another layer of the screen, and still counts.
   * What stays: CONTINUE over a row, the floating tab bar and its strip, a
   * title laid over a scrolled row, a sheet or a dialog over anything.
   * Judged over `within` as `exposure` is: the caller passes the part of
   * the screen its measurement reads (pixel-poll.ts, the colour sampler's
   * inset rect), and the 2-unit edge is measured against the node's rect
   * inside it.
   *
   * The three exemptions and their residuals (each a cover read as none,
   * so a colour or ocr assert measures the cover's pixels as the element's)
   * are the owner's decision:
   * docs/adr/0003-pixel-cover-exemptions.md
   */
  paintsOver(node: UiNode, within: Rect): readonly PixelCover[];
}

/** A cover of a pixel assert's element (`DrawOrder.paintsOver`): the node, and where it presses — its rect, or a pinned bar's reach (`Exposure.reaches`). */
export interface PixelCover {
  readonly node: UiNode;
  readonly reach: Rect;
}

/**
 * The smallest side a piece of a target that nothing is drawn over may have
 * for a tap to be moved to it (`Exposure.tapAt`), as a fraction of the
 * screen's shorter side: 24 pt on the 402-pt iPhone 17, 65 px on the
 * 1080-px Pixel_3a — about a fingertip, Apple's 44-pt target halved. Chosen
 * against the measured strips, each of which must be refused: the 9-pt and
 * 17-pt tops of `priority_select` above the CONTINUE bar (iOS, idb and WDA)
 * and the 38-px bottom border of Contacts' First name below the top app bar
 * (Android) — a tap into a sliver that thin lands on the bar's edge as often
 * as on the row. Scaled by the screen, not fixed, because the tree's units
 * are points on iOS and pixels on Android.
 * docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md
 */
export const MIN_TAP_PIECE_FRACTION = 0.06;

/** What `exposure` found: the target against what is drawn over it inside the judged box. */
export interface Exposure {
  /** The fraction of `node`'s area inside `within` and under no cover (0 for a node of no area) — `visibleFractionInViewport` less the covers. */
  readonly shows: number;
  /** The nodes drawn over it inside `within`, in pre-order (in idb's flat list, a floating tab bar's items listed before it among them, `tabBarsOf`); empty when none. */
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
   * The nodes listed after it that hold its centre (inside `within`, at
   * their reach, as `coverAt` asks) and that the `target` column EXCUSED —
   * drawn there, by the table, as no cover of it — in pre-order; empty when
   * none, or when the centre lies outside `within` — a node of a hidden
   * subtree (`UiNode.hidden`, the `hidden` row) included: WDA's
   * `isVisible="0"` is no proof that a node takes no touch. Not a cover: a tap at
   * the centre is still `tapAt`'s, unmoved. What a tap there may still
   * PRESS: a labelled control of exactly the node's frame (`sameFrame`), its
   * own unlabelled control (`ownControl`), a row of a scroll view it is not
   * in (`scrolledContent`) are excused for where a touch lands on the node,
   * not for what else the touch triggers. One reader: the in-tree dismissal
   * picker (interact/keyboard-in-tree.ts#pickDismissal), which refuses a
   * candidate whose centre an interactive one of them holds (ADR 0016).
   * Judged in the same pass as `covers`, no second walk.
   */
  readonly centreExcused: readonly UiNode[];
  /**
   * The covers that are the SURFACE of a screen presented over the node (presented-by-shape.ts: a dimming leaf,
   * labelled or not, a sheet's scroll view, on a later screen-sized layer stacked over its own, on a tree whose source
   * did not judge presented layers; or a marked presented layer's cover, reaching the whole screen, or a node of a
   * marked `screen` layer, `markedLayers`), in `covers`' order; empty when none — never a control, a bar the layer
   * carries or any other labelled node, which cover anyway (Safari's capsule bar). What the sentences read: a target
   * under one lies under a presented screen no scroll moves it out from under — close it first
   * (ui-tree/standing.ts#presentedRemedy; docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md).
   */
  readonly presented: readonly UiNode[];
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
 * What a row is judged against beside the node: the screen's area (`screenOf`), and the shape fallback for presented
 * screens (presented-by-shape.ts) — only on a tree whose source did not judge presented layers itself (no
 * `UiNode.presentationsJudged` on its root); absent on one whose source did, which never reaches it.
 */
interface Seen {
  readonly screenArea: number;
  readonly byShape?: PresentedByShape;
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
 * A kind of node judged to draw nothing of its own, per column: `true`
 * from a column's predicate excuses the node for that column; a column
 * without one counts the node as drawing, as far as this row is concerned.
 * `drawnOver` — a container's column, judged against what is `Seen`
 * (`draws`; `drawnOverAt` reads it too); `target` — judged against a
 * target as well (`SeenFor`, `drawsOverTarget`).
 */
interface Row {
  readonly drawnOver?: (placed: Placed, seen: Seen) => boolean;
  readonly target?: (placed: Placed, seen: SeenFor) => boolean;
}

/**
 * The `structural` row's wrapper excuse for a target: `node` holds the
 * target's whole rect, and is the screen's size or holds the target's
 * nearest scroll view whole.
 */
const holdsWhole = (node: UiNode, target: Placed, screenArea: number): boolean =>
  rectWithin(target.node.rect, node.rect) &&
  (fillsScreen(node.rect, screenArea) || (target.scroller !== undefined && rectWithin(target.scroller.node.rect, node.rect)));

/** A node with children that `fillsScreen`: it draws through its content, which is walked. */
const screenSized = (n: UiNode, screenArea: number): boolean => n.children.length > 0 && fillsScreen(n.rect, screenArea);

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
 * tree's units: 2, "up to 1–2 pt";
 * measured, the SWIFT form's `Payee’s name` `42,446 103x22` over its
 * `textfield 42,447 318x20`, 1 pt above and below. In pixels on Android, so
 * there a third of that — stricter, the safe direction.
 * docs/adr/0014-a-text-input-is-no-cover-of-its-own-label.md
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

/**
 * The `target` column's three FRAME excuses — a node judged to draw nothing by its frame, for a target. The rows
 * (`structural`, `screenSizedHost`, `contentFramed`, whose docs have the rules and their measurements) ask
 * `frameExcused`. On a tree whose source did not judge presented layers, the shape fallback (`Seen.byShape`,
 * presented-by-shape.ts) may take an excuse back over a screen presented over the target's, and names that screen's
 * surface from the same rows (`surfaceOf`).
 */
const FRAME_EXCUSES = {
  structural: ({ node }: Placed, target: Placed, screenArea: number): boolean =>
    STRUCTURAL_ROLES.has(node.role) && !node.label && !node.value && (node.children.length === 0 || holdsWhole(node, target, screenArea) || (!node.identifier && framesOnly(node))),
  screenSizedHost: ({ node }: Placed, _target: Placed, screenArea: number): boolean => !isInteractive(node) && screenSized(node, screenArea),
  // `!isInteractive` is moot while `scrollable` is no interactive role (selectors.ts); it guards CONTENT_FRAMED_ROLES
  // growing one.
  contentFramed: ({ node }: Placed, _target: Placed, _screenArea: number): boolean => !isInteractive(node) && node.children.length > 0 && CONTENT_FRAMED_ROLES.has(node.role),
} as const satisfies Record<FrameRow, (placed: Placed, target: Placed, screenArea: number) => boolean>;

/** `row` excuses `placed` for `target`, and the shape fallback, where it is asked, does not take the excuse back. */
const frameExcused = (row: FrameRow, placed: Placed, target: Placed, seen: Seen): boolean =>
  FRAME_EXCUSES[row](placed, target, seen.screenArea) && seen.byShape?.givesWay(row, placed, target) !== true;

/**
 * A cover of `target` that the shape fallback names the SURFACE of a screen presented over it (presented-by-shape.ts),
 * on a tree whose source did not judge presented layers; never on one whose source did (no `Seen.byShape`).
 */
const surfaceOf = (placed: Placed, target: Placed, seen: Seen): boolean => seen.byShape?.presentedSurface(placed, target) === true;

/**
 * THE judgement of what draws, one row per kind of node that does not. A
 * node draws for a question when no row excuses it there. Where the
 * columns differ, each answer is kept as its caller has been measured
 * against; unifying them is a behaviour change, to be judged per row.
 */
const NOT_DRAWN = {
  /**
   * No area: nothing to draw (a zero-width text, a collapsed view). Every
   * question.
   */
  noArea: {
    drawnOver: ({ node }) => !(rectArea(node.rect) > 0),
    target: ({ node }) => !(rectArea(node.rect) > 0),
  },

  /**
   * STRUCTURAL ROLES (`container`, `other` — every source's wrappers).
   *
   * `drawnOver`: only a structural LEAF with no label and no value is
   * excused (a spacer, an empty Box — empty area). A Compose tree is all
   * `container`/`other` (adapters/android.ts maps `android.view.View` so),
   * so a structural role is no evidence of nothing drawn: measured on
   * mp-native's Account Detail (the floating-tab-bar stroke note below), the floating tab
   * bar's host — an unlabelled `container` `66,1840 948x248` after the
   * list `0,825 1080x1395` — took the touch-down at y 1857 above its tabs
   * (a Material Surface swallows touches through its whole rect). The tree
   * does not say whether a node takes touches, so a transparent wrapper
   * reaching over a list counts too: its cost is a shorter stroke box —
   * never under half of it, or a third for one over the touch-down
   * (interact/swipe.ts#overlayTop, TOUCH_DOWN_CUT_FLOOR) — never a stroke
   * off the list.
   * docs/bugs/2026-10-09-android-scroll-stroke-touches-down-on-floating-tab-bar.md
   *
   * `target`: `drawnOver`'s rule — the Compose tab-bar host is the measured
   * cover of the rows beneath it (Account Detail, the same note; the bars
   * of the pinned-chrome note are wrapped the same way) — and ALSO excused: an unlabelled, unvalued
   * structural node whose rect holds the target's WHOLE rect. Such a
   * wrapper after the target in pre-order — WDA lays a screen's content in
   * `Other` frames the screen's size or the form's, Windows after Windows —
   * says nothing about the target's surface; what it carries is walked and
   * judged by itself (an alert's text inside WDA's Alert → container).
   * Not every structural node: a wrapper only PARTLY over the
   * target is a bar's frame, the case the tab-bar host measured. And not
   * every wrapper holding the target: the measured host
   * `66,1840 948x248` holds a small target in a row at y 1845–1875 whole,
   * above its tabs — the band where the touch-down at 1857 was swallowed.
   * So the wrapper must also be the screen's size (`SCREEN_SIZED_FRACTION`,
   * a Window's `Other`) or hold the target's scroll view whole (the form's
   * frame) — a bar holds neither (`holdsWhole`).
   * And an unlabelled, unvalued one with no identifier, whose every descendant is an EMPTY FRAME
   * (`framesOnly`), as `itemlessToolbar` judges a toolbar: it carries
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
   * Except over ANOTHER SCREEN (presented-by-shape.ts#givesWay, ADR 0018): a structural
   * LEAF on a screen presented over the target's covers — the React Native
   * transparent Modal's dimming root `forgot_overlay 0,0 402x874` (a leaf the
   * app named) was excused here, and a tap on the login screen beneath was
   * sent onto it. A wrapper with children stays excused there too: it may be
   * a pass-through layer (Safari's `CapsuleViewController`, its bar only).
   * docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md
   * docs/bugs/2026-10-09-ios-wda-cell-background-and-textfield-scroll-bar-read-as-covers.md
   */
  structural: {
    drawnOver: ({ node }) => STRUCTURAL_ROLES.has(node.role) && node.children.length === 0 && !node.label && !node.value,
    target: (placed, about) => frameExcused('structural', placed, about.target, about),
  },

  /**
   * A SCREEN-SIZED HOST: a node with children whose area reaches
   * `SCREEN_SIZED_FRACTION` of the screen — a full-screen overlay layer
   * draws through its content, which is walked. A childless one draws
   * itself (a full-screen image or text).
   *
   * `target`: a NON-INTERACTIVE one only (the bug note below): WDA gives a
   * SwiftUI pushed screen's toolbar host as `toolbar 'Toolbar'` with the
   * screen's full frame AFTER the title in pre-order — and after every row
   * of its screen; it draws nothing over them, yet every `keyboardDismiss`
   * tap on that screen was refused as "covered by toolbar". An interactive
   * one still covers: a full-screen `button` backdrop (an RN transparent
   * Modal's Pressable) takes the tap. And so does a screen-sized SCROLL VIEW
   * on a screen presented over the target's (presented-by-shape.ts#givesWay, ADR 0018):
   * a sheet's form, measured to swallow the tap. Any other host stays
   * excused, over another screen too — ADR 0018 keeps the trade-off this
   * row accepted for hosts that may pass touches through (Safari's
   * `CapsuleViewController`, measured): a full-screen non-interactive host
   * with nothing of its own at the point (an RN transparent modal whose
   * dimming view is a wrapper holding its card, an RN ScrollView in it
   * whose rows are below the title) reads as not covering, and the tap
   * lands on it; for the
   * in-tree keyboard dismissal (interact/keyboard-in-tree.ts#pickDismissal),
   * on the guard's path a keyboard that stays, or a target gone, ends in
   * `AfterDismissalTap`; a tap that hides the keyboard AND does something
   * of its own passes silently (`hidden by tapping <title> before
   * tapping`), and on the post-fill `dismiss()` path is reported as
   * `hiddenBy: tapping <title>`. "Has children" is a weak signal: the
   * measured toolbar's only child is an empty container.
   * docs/bugs/2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md
   *
   * `drawnOver`: whatever its interactivity — `target`'s rule without the
   * interactive exception; no measurement has asked it either way (the
   * tree keeps no `clickable`).
   */
  screenSizedHost: {
    drawnOver: ({ node }, { screenArea }) => screenSized(node, screenArea),
    target: (placed, about) => frameExcused('screenSizedHost', placed, about.target, about),
  },

  /**
   * A SCROLL VIEW WITH CONTENT (`CONTENT_FRAMED_ROLES`), non-interactive,
   * whatever its size, covers a point only through its descendants, never
   * through its own frame — the screen-sized host rule without the size.
   *
   * `target` (measured on the device with the toolbar host's rule above,
   * for the in-tree keyboard dismissal's title): with the toolbar host
   * excused, the next node after the title
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
   * (the input-accessory bar draws an opaque 48-pt bar, measured), and any non-interactive parent ("judge only by leaves",
   * which would drop a smaller card or sheet whose background is the
   * cover). What still covers: its content at the point, a childless
   * scrollable, an interactive node of any role — and a scroll view that is,
   * or lies in, a later screen-sized layer stacked over the target's own
   * screen, carrying content (presented-by-shape.ts#givesWay, ADR 0018): Contacts' New
   * Contact page sheet's form `scrollable 0,62 402x812`, whose bare
   * background took a tap sent to the list beneath. Accepted trade-off, this
   * row LOOSENS the guard: a scroll view really drawn over the point with
   * nothing non-structural there (a sheet's table whose row at the title is
   * a bare `Cell`) reads as not covering — the outcomes are the
   * screen-sized host's above. A row scrolled UNDER a translucent bar is
   * the `scrolledContent` row's. The scroll view itself also lies under the
   * bar's buttons, which WDA lists before it, and the SWIFT form's measured
   * WDA tree has it after the title.
   *
   * `drawnOver`: not excused — no measurement asked it (no iOS tree has a
   * clipping container, and a Compose scroller is `container`, not
   * `scrollable`: adapters/types.ts#UiNode.clipsDescendants).
   */
  contentFramed: {
    target: (placed, about) => frameExcused('contentFramed', placed, about.target, about),
  },

  /**
   * SCROLLED CONTENT: a node inside something that scrolls
   * (scroll-containers.ts#scrolls) that does not hold the target, in the
   * target's own screen — scroller and target are not two stacked screens
   * (`stackedScreens`). `target` only: an iOS form scrolls UNDER its
   * translucent top bar, and WDA lists the bar's BackButton and Save
   * BEFORE the scroll view (the `contentFramed` row's measurement), so
   * every row scrolled up under the bar follows the bar's buttons in
   * pre-order and would read as drawn over them — a false refusal of the
   * one tap that leaves the screen. Content cannot be drawn over what lies
   * outside its scroll view's frame on top of it; the scroll view itself
   * is judged by `contentFramed`. A row of the SAME scroll view as the
   * target (a sticky section header over a row) still covers, and so does
   * the content of a scroller in a LATER screen (and, inside one window, that
   * screen's scroll view or dimming leaf: presented-by-shape.ts#givesWay, ADR 0018) — an RN transparent Modal
   * presented over the screen (a later screen-sized layer, in the same
   * window or another), a full-screen sheet's list, a later window under
   * the parser's 0×0 root (an assumption: uiautomator's z-order across
   * several windows is not measured, no fixture has one) — over a target of
   * the screen beneath. Two
   * stacked screens, not a bar over its screen's content: below the node
   * holding both, the scroller lies in a screen-sized layer AND the target
   * does. The logged WDA form (the bar, then a full-screen content
   * container holding the scroll view, its sibling) has the bar's branch
   * no screen, so Back stays tapped. Residuals, stated: a bar nested in a
   * full-screen host of its own, beside the content's full-screen layer,
   * reads as two screens and its button is covered by rows scrolled under
   * it (whether real bars nest so is unmeasured); a later layer under 90 %
   * of the screen with no screen-sized wrapper — a medium sheet, a
   * popover's table — reads as the same screen, its rows excused; so does a
   * target that is itself a direct child of the node holding both (no
   * layer of its own below it); Compose flattens layout-only Boxes, so an
   * in-window overlay often has no layer node at all; a scroller nested
   * inside the target's own scroller (a sticky chip row) is "another"
   * scroller, so its content is excused where a row of the same scroll
   * view would cover; a web view whose frame is under
   * the screen's size (above a tab bar, beside a toolbar) under a
   * translucent bar covers the bar's buttons through its own FRAME,
   * whatever this row says of its content — `contentFramed` rejects a web
   * view on purpose. And a scroll view drawn over another part of the SAME
   * screen (a bottom sheet's list laid in the screen's own layer, over a
   * form) hides nothing through its rows — only its frame, or a
   * non-scrolling node of the sheet, can cover. The
   * container question never asks it. The in-tree keyboard dismissal's
   * title IS such a target: the picker asks the tap's standing, so a row
   * scrolled under the title no longer refuses it — unless the row is
   * interactive and holds the title's centre, which the picker refuses on
   * its own (`Exposure.centreExcused`): the tap would press the row.
   * docs/adr/0016-the-dismissal-picker-asks-the-tap-standing.md
   *
   * Under idb this row never fires: its list is FLAT, so no node has a
   * scroll-view ancestor — `flatListChrome` stands in for it over the top
   * bar.
   */
  scrolledContent: {
    target: ({ scroller }, { target, screenArea }) => {
      if (scroller === undefined || within(target, scroller)) return false;
      return !stackedScreens(scroller, target, screenArea);
    },
  },

  /**
   * CONTENT OVER THE TOP BAR, IN A FLAT LIST: under idb (`UiNode.flatList`
   * on the root), a node at or after the list's first CONTENT node that
   * ends inside the top bar's band (`barLine`), over a target listed before
   * that node — the top bar's (`firstContent`, `contentFrom`).
   * `target` only: chrome before content, the owner's decision — the bar's
   * items are listed before the content, and content listed after them that
   * ENDS inside the bar's band (`barLine`, `FLAT_LIST_TOP_BAR_FRACTION`) is
   * no cover of them; between content nodes this row changes nothing (the
   * pinned CONTINUE still covers `priority_select`: content over content is
   * `flatListReadingOrder`'s). The measured shapes, the rule it replaced and
   * its residuals are the ADR's.
   * docs/adr/0004-flat-list-chrome-before-content.md
   *
   * Measured besides (tests/fixtures/idb-swift-form-scrolled-under-top-bar.json):
   * a row scrolled under the bar lies in the band (IBAN at 75–95,
   * `will_remain` at 80–95); on a screen with no bar the first rows inside
   * the band are read as the bar's, and a menu `150,70 240x130` listed last
   * over Row1 `0,62 402x44` covers only because it reaches past the band.
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
   * floating tab bar's item (`tabBarsOf`). `target`
   * only: the fix of a regression of `flatListChrome` (ADR 0015).
   * docs/adr/0015-flat-list-reading-order-break.md
   * docs/bugs/2026-10-09-ios-idb-modal-listed-before-content-reads-covered-by-the-content-behind-it.md
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
   * debit row at 150 breaks it. A top-at-or-below rule (a later node
   * covers only when its top lies at or below the target's) is not
   * enough: `date_header_0`'s top 399 lies below `row_own`'s 397. Between
   * the target and the break nothing changes: the pinned CONTINUE, listed
   * last after `priority_select`, still covers it, as a node listed after
   * a row and starting at or below it covers it (a footer's text in a
   * row). Nodes of no area never break (idb lists a 0×0 field).
   *
   * The bottom chrome is no break and never past one: CONTINUE starts above a label lying under it
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
   * inside the top bar's band (`barLine`: Contacts' New
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
   * equal to the target's label, placeholder or value. `target` only:
   * idb's list is FLAT
   * (adapters/ios-tree-source.ts#parseIdbDescribeAll), so a field's own
   * floating label comes after the field as its sibling, never as its
   * descendant — measured on mp-native's SWIFT form
   * (tests/helpers/fake.ts#idbFloatingLabelFake, the fill-unverified note below): the label `42,372
   * 120x18` lies on the empty input `26,366 350x30`, both carrying the
   * identifier `TextFieldWithComponentStyle` (iOS gives a field's title and
   * error labels the field's identifier — interact/resolve.ts#resolveNow);
   * a tap there focuses the field. Without this row `scroll_until … fully:
   * true` would never stop on such a field.
   * docs/bugs/2026-10-08-ios-fill-unverified-reports-filled-and-cleared.md
   *
   * A sibling, not any node: the label of a bar drawn over a large row (the
   * Compose tab's `Home` text inside the row's rect) is part of a cover,
   * not of the target — a bar's text has the bar for its parent. Its centre
   * on the target, not its whole rect: an outlined field's
   * floating label straddles the field's top border — and only that
   * border: its bottom may not pass the target's (a pinned
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
   * sibling of every other — so there the repetition is the evidence: without it a pinned footer's text
   * `16,785 200x30` inside a row `0,760 402x60` read "fully visible", and
   * the tap pressed the footer. idb's floating label repeats the field's
   * identifier; text that names something else — a total, a section title
   * — covers. Only there: asked of every tree, it would make
   * the RN screen's own text a cover of `placeholder_screen`, and
   * `scroll_until` to it would never stop. In a nested tree a pinned footer's
   * text has the footer, or the screen outside the row's scroll view, for
   * its parent, so the sibling guard already rejects it. Residual, stated:
   * a text laid on a target in the target's own parent with no wrapper of
   * its own — absolutely positioned, or a layout-only view flattened away —
   * is excused there, as an outlined field's floating label is. So is a
   * bare footer text beside a CONTAINER target (a FrameLayout holding a
   * RecyclerView and a TextView, a Scaffold whose bottom bar is a bare
   * Text, `fully` asked of the list): same shape, same answer as before.
   *
   * And what such a sibling holds (`ownContent`; the bug note below): a
   * NON-INTERACTIVE node lying WHOLLY inside a CHILDLESS target, whose
   * parent is a sibling drawn on it — one wrapper down, the
   * measured depth; deeper still covers.
   * Childless: a leaf whose content is listed beside it (Compose's merged
   * label node, an RN view under WDA) has no other; a target with children
   * has its content as them, and a sibling's subtree beside it is the
   * stated residual above at one remove — the Compose tab-bar host drawn on
   * its list (a fixture sweep finds the host already excused there) is
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
   * docs/bugs/2026-10-09-android-compose-button-text-refused-as-under-its-own-button.md
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
   * (`screenSized`), nor the control. `target` only (the bug note above,
   * `onTarget`'s, a regression of this column's first form):
   * a Compose `Button` reaches uiautomator as a wrapper holding its label
   * text and, AFTER it, an unlabelled clickable `button` — mp-native's
   * `container 44,1397 992x132` → `text 'LOGIN' 481,1438 118x49`, `button
   * 44,1402 992x121`. That button read as drawn over the text: `tap
   * text:"LOGIN"` was refused, `scroll_until` called the screen a layout
   * defect, and an `optional:` tap skipped. A tap at the label's centre lands
   * on the button — what the caller means.
   *
   * The two shapes are the ui_snapshots' (tests/fixtures/android-ui-snapshot-compose.json;
   * every node there under a later unlabelled
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
   * not held to lie within its parent, nor to any height. An ICON button:
   * Contacts' Cancel, More options and Delete —
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
   * 22,99 110x80` in its 132×132 wrapper: 11, 11, 11, 41) — refused, the
   * safe direction; nor one spanning its wrapper's height
   * only (a tall narrow one). And only on a tree whose source lists a
   * control's touch target as its wrapper (`UiNode.paddedTouchTargets`,
   * uiautomator's root): the shape was
   * measured there alone. No other mark tells uiautomator's tree from
   * WDA's — `clipsDescendants` is a node's, absent on an Android screen with
   * no scroller, and `ofKeyboard` comes only with a keyboard — so the source
   * marks its root, as idb's does `flatList`. Under WDA and idb an
   * unlabelled button padded evenly over a centred text stays a cover (a
   * false refusal, the safe direction). The width shape (`spansWidth`) is
   * asked of every tree.
   *
   * What still covers: a pinned CTA in the SAME parent as a text (a classic View's `Button "LOG IN" 40,1150 1000x130` over "Forgot
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
   * And a THIRD shape, the text input over its own label (ADR 0014): an
   * unlabelled, unvalued text
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
   * docs/adr/0014-a-text-input-is-no-cover-of-its-own-label.md
   * docs/bugs/2026-10-09-ios-wda-cell-background-and-textfield-scroll-bar-read-as-covers.md
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
   * child of a node that scrolls (scroll-containers.ts#scrolls) or of a text input
   * (`INPUT_ROLE`) and holds nothing but empty frames
   * (`emptyFrame`). `target` only: WDA lists
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
   * A text input's too (the bug note below): a UITextField
   * scrolls its text, and WDA lists its indicator as its child — the SWIFT
   * form's `textfield 42,447 318x20` → `Other 'Horizontal scroll bar, 1
   * page' 42,454 318x10` → a bare thumb `45,461 309x3` — which refused `tap
   * text:"Payee’s name"`, the field's placeholder label beside it, and
   * named the bar over every such label of the form. Matched by its shape
   * and its parent's role, never by its label: WDA's label follows the
   * device's language. A labelled `container` of that shape under any other
   * interactive parent (a button) still covers.
   * docs/bugs/2026-10-09-ios-wda-cell-background-and-textfield-scroll-bar-read-as-covers.md
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
   * only: a node laid exactly over another, edge for edge, is
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
   * `target` (the bug note below): measured under WDA on the stock Contacts "New
   * Contact" sheet (UIKit, iPhone 17, iOS 27): after the title `text 'New
   * Contact' 149 89 104 22` come the form's `scrollable 0 62 402 812`
   * (the `contentFramed` row) and two `toolbar 'Toolbar'`s, `0 83 402 48`
   * and `0 62 402 812`, each holding ONE empty `Other` (→ `container`) of
   * its own rect; EACH alone contained the title's point (201,100) and
   * refused the keyboard dismissal on the title as "covered by toolbar",
   * while the screenshot
   * shows nothing over the title. So "itemless" is judged by content, not
   * by child count; the 48-pt one is a bar's size, which no host rule
   * excuses. A toolbar's surface is its ITEMS (WDA lists a bar button, a
   * title, a Done as its descendants), so one listing none is judged to
   * draw nothing. Narrow on purpose: only `toolbar`; any descendant with a
   * label, value or identifier, or of any other role, at any depth, is an
   * item, and the toolbar then covers as itself (the input-accessory bar's
   * Done: Toolbar → Other → Button). The two toolbars also lie after every
   * field of the form and over the nav bar's Cancel. Accepted residual,
   * this row LOOSENS the guard: an opaque itemless bar drawn over the
   * dismissal reads as not covering, and the tap lands on a bar with no
   * item — likely a keyboard that stays, ending in `AfterDismissalTap`. The one silent wrong action:
   * a bar whose item WDA does not list as content (not an accessibility
   * element, or listed only as an empty frame) reads as itemless, and the
   * dismissal tap can trigger that item. Platform scope: only the WDA
   * parser assigns `toolbar` (adapters/wda-source.ts); a future mapping to
   * it inherits this row and must be judged against it. A keyboard-owned
   * itemless toolbar (none measured) is excused by the `keyboard` row as
   * well, and the band — which contains the accessory slot — still catches
   * a point there for the dismissal picker.
   * docs/bugs/2026-10-09-ios-wda-childless-toolbar-refuses-keyboard-dismissal.md
   *
   * `drawnOver`: not excused — no measurement asked it (no WDA tree has a
   * clipping container).
   */
  itemlessToolbar: {
    target: ({ node }) => itemless(node),
  },

  /**
   * THE KEYBOARD'S OWN SUBTREES (`UiNode.ofKeyboard` on the node or an
   * ancestor, or the band `KEYBOARD_ROLE` marks — the same nodes on WDA,
   * where the band lies in the keyboard's Window).
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
   * keyboard from its tree: a band there is no cover either). The in-tree
   * keyboard dismissal picker judges the keyboard first, by the reading's
   * band (interact/keyboard-in-tree.ts#pickDismissal); a keyboard-owned
   * node outside the band does not refuse a dismissal (ADR 0016's
   * residual) unless it is a control holding the dismissal's centre
   * (`Exposure.centreExcused`).
   */
  keyboard: {
    drawnOver: ({ inKeyboard }) => inKeyboard,
    target: ({ inKeyboard }) => inKeyboard,
  },

  /**
   * A HIDDEN SUBTREE (`UiNode.hidden`, the WDA parser's mark: a node of no structural role that WDA reports
   * `isVisible="0"` and `isAccessible="0"`, whose every descendant is `isVisible="0"`, and every node under it).
   * `target` only: no cover of a target — the tap, `scroll_until`'s standing, the pixel assert's covers and the
   * dismissal picker. Excused, it is still listed in `Exposure.centreExcused` when it holds the target's centre, as
   * every excused node is: WDA's `isVisible="0"` is no proof a node takes no touch, and the dismissal picker refuses
   * a candidate whose centre an interactive one of them holds (on the SWIFT form, the label "Payee’s name" whose own
   * text field, drawn but reported invisible, would be focused by the tap). Measured on
   * mp-native's SWIFT form pushed over the tab host (tests/fixtures/wda-capture-swift-form-pushed.json): WDA lists the
   * host's hidden tab bar after the form at y 711, and its buttons' icons covered the rows beneath — a tap on
   * `payee_country_select` was moved off its centre, a colour assert failed closed naming `Dashboard/icon-browsers`,
   * and `fully` spent a stroke moving a row off a phantom.
   * docs/bugs/2026-10-13-ios-wda-hidden-host-tab-bar-covers-a-pushed-screens-rows.md
   *
   * Except, on a tree whose source did not judge presented layers, the SURFACE of a screen presented over the target's
   * by shape (presented-by-shape.ts#PresentedByShape.presentedSurface, the mirror of `givesWay`), which covers as
   * before and stays in `Exposure.presented`: a sheet layer WDA reports `0/0` whole, over a list with no second dim,
   * would otherwise let a tap through to the list. On a tree whose source judged, no shape is asked and the guard holds
   * of no node: a layer it marks covers through its cover, which no row excuses, and a hidden node of a marked `screen`
   * layer stays excused (Contacts' discard popover over the New Contact sheet, whose form `Table 0,62 402x812` and
   * photo buttons WDA reads `0/0`: tests/fixtures/wda-capture-contacts-discard-popover.json). The TARGET's own flag is
   * never read: a target under a modal is `isVisible="0"` too.
   *
   * `drawnOver`: not excused — no measurement asked it (no iOS tree has a clipping container, and only WDA sets the
   * mark). Residuals and the decision: docs/adr/0019-wda-hidden-subtrees-and-parked-cell-content.md
   */
  hidden: {
    target: (placed, about) => placed.node.hidden === true && !surfaceOf(placed, about.target, about),
  },
} as const satisfies Record<string, Row>;

const ROWS: readonly Row[] = Object.values(NOT_DRAWN);

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
 * Measured: the SWIFT form's pinned CONTINUE
 * `24,780 354x44` ends at 824, 50 pt above the screen's bottom — the home
 * indicator's safe area and the bar's margin; the floating tab bar idb lists
 * on Account Detail (`37,755 82x64`, bottom 819, 55 pt) lies outside it.
 */
export const FLAT_LIST_BOTTOM_BAR_FRACTION = 0.06;

/**
 * idb's SOFT KEYBOARD, read by its shape (`flatListReadingOrder`): the band
 * soft-keyboard.ts#flatListKeyboardBand finds in the walk's order (the
 * rule and its measurements there), with its top
 * for the keyboard edge (`DrawOrder.keyboardBandTop`), with the run of
 * nodes it holds as `keys` (bottom chrome, drawn over what lies under
 * them) and of those the keyboard's `own` (`sharesRow`,
 * `DrawOrder.ofKeyboardBand`).
 */
function keyboardOf(
  order: readonly Placed[],
  screen: Rect,
  barLine: number,
): { readonly top: number; readonly keys: ReadonlySet<Placed>; readonly own: ReadonlySet<UiNode> } | undefined {
  const band = flatListKeyboardBand(order.map((p) => p.node), screen, barLine);
  if (band === undefined) return undefined;
  const run = order.slice(band.from, band.to).map((p) => p.node);
  const background = order[band.at].node;
  return { top: band.top, keys: new Set(order.slice(band.from, band.to)), own: new Set(run.filter((n, i) => n === background || band.from + i > band.at || sharesRow(n, run))) };
}

/**
 * A node of idb's keyboard run that shares its ROW — its top and height —
 * with another node of the run it does not overlap (past
 * geometry.ts#PIXEL_OVERLAP_SLACK): keys TILE the band in rows, side by
 * side (the number pad's `1 2 3` at 596, `4 5 6` at 650…; QWERTY's
 * letters), while an app node listed right before the keys, wholly inside
 * the band, stands alone on its row (a Sign in button behind the keyboard)
 * or shares it only with a node laid OVER it (a field and its placeholder
 * label, a button and its title: idb lists both with one top and height).
 * With the background and what is listed after it (Dictate), the
 * keyboard's OWN nodes (`DrawOrder.ofKeyboardBand`). Why tiling, and its
 * residuals (a lone key read as content, two app nodes side by side read
 * as keys), are the owner's decision:
 * docs/adr/0007-idb-keyboard-key-row-tiling.md
 */
const sharesRow = (node: UiNode, run: readonly UiNode[]): boolean =>
  run.some((other) => other !== node && other.rect.y === node.rect.y && other.rect.height === node.rect.height && !overlapsPastSlack(other.rect, node.rect));

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
 * top is INFERRED, not measured by a tap (kept by the owner): checked on the screenshot `run2-ios/img-253-0.png`, the
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
 * (`tabBarsOf`, `exposure`): 0.2 — the owner's decision, unit-free, so
 * the same in points and in pixels. Measured on mp-native's Account Detail
 * (iPhone 17, idb and WDA alike): the bar's pill starts ≈12 pt above its
 * 64-pt items (`run9-ios/img-374-0.png`, 743 against 755) and is no node of
 * either tree; 0.2 × 64, rounded, is 13.
 * docs/bugs/2026-10-09-ios-floating-tab-bar-surface-above-its-buttons-takes-a-rows-tap.md
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
 * (the owner's decision): at least `TAB_BAR_MIN_ITEMS` INTERACTIVE
 * siblings of one rect's y and height, no two overlapping, together
 * spanning `TAB_BAR_WIDTH_FRACTION` of the screen's width, ending on the
 * screen and inside its bottom `TAB_BAR_BOTTOM_FRACTION`; the keyboard's
 * nodes (`Placed.inKeyboard`, and idb's keys, `keyboardOf`) are none — a
 * row of keys has the same shape. Such a bar floats over what lies outside
 * it, and its surface reaches `TAB_BAR_REACH_FRACTION` of its items' height
 * above them (`exposure`) — in idb's flat list whatever the bar's place in
 * the list, since idb lists it in reading order, FIRST; in a nested tree
 * (WDA, uiautomator) only over what is listed before it, since that order
 * IS the draw order: an action sheet listed after the bar is drawn over it,
 * and its Cancel `8,782 386x57` is tapped at its centre (order-blind, the
 * bar would move it to a 29x37 piece).
 * Measured (the bug note on TAB_BAR_REACH_FRACTION): idb lists mp-native's four tab items
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
 * direction; the centre of a key of the row above lies clear of it), and so
 * does a row of three equal content buttons scrolled into the bottom 10 %
 * over what lies just above it; a classic, non-floating UITabBar, its items
 * filling the bar, has the shape too — a row at `0,770 402x30` just above it
 * is refused (both the safe direction); in idb's flat list, a sheet
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

/**
 * The draw order of `tree`: one pre-order walk when called; each answer a
 * scan of it. The tree must not change while the answer is in use.
 */
/**
 * The largest share of the screen's area the branch a node and a cover of
 * it share may have for the cover to be the node's own content or layer
 * (`DrawOrder.paintsOver`, `ownBranch`): one component — a row, a card, a
 * form's card (RN's `login_card`, 370x400 of 402x874, 0.42 of the screen)
 * — and not a screen's content area (Compose's `accounts.detail.container`,
 * 0,225 1080x1995, 0.899, where a FAB over a row is chrome). The measured margin: 0.42 below the
 * line, 0.899 above it; nothing measured lies between.
 */
const OWN_BRANCH_SCREEN_FRACTION = 0.5;

/** The words a node says — its label's and value's, lower-cased, split at anything not a letter or a digit (`paintsOver`'s own content: idb's "Accounting Balance, 2 000, ,00, CZK" says only words of its card's label). */
const wordsOf = (n: UiNode): ReadonlySet<string> =>
  new Set([n.label ?? '', n.value ?? ''].flatMap((t) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u)).filter((w) => w.length > 0));

/**
 * Whether the tree's nesting is its nodes' ancestry: false for idb's flat
 * list (`UiNode.flatList`), whose nodes are all siblings of one root. The
 * tree's dialect is read here and nowhere else outside draw order — this
 * and `listsUnclippedFrames` — what geometry.ts#clipsOf's `inScroller` and
 * `drawnIn` ask, through ui-tree/standing.ts#sceneOf, and the pixel
 * standing's flat-list root (ui-tree/standing.ts#Standing,
 * `covered.overRoot`).
 */
export function listsAncestry(tree: UiNode): boolean {
  return tree.flatList !== true;
}

/**
 * Whether the tree's source reports every frame unclipped (`UiNode.unclippedFrames`: WDA's) — a scroll view's
 * content at its laid-out rect past the scroll view's frame — so what a scroll view draws of a node is asked of its
 * frames (geometry.ts#Clips.drawnIn). The second half of the tree's dialect (`listsAncestry`'s doc).
 */
export function listsUnclippedFrames(tree: UiNode): boolean {
  return tree.unclippedFrames === true;
}

export function drawOrder(tree: UiNode): DrawOrder {
  const screen = screenOf(tree);
  const screenArea = rectArea(screen);
  const seen: Seen = {
    screenArea,
    ...(tree.presentationsJudged !== true && { byShape: presentedByShape(screenArea, (row, placed, target) => FRAME_EXCUSES[row](placed, target, screenArea)) }),
  };
  const flatList = !listsAncestry(tree);
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
  const barLine = flatListBarLine(screen);
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
   * keyboard's top (inferred from the measurement below and checked on the
   * screenshot `run2-ios/img-253-0.png` — the lifted bar's background between
   * it and the keys — not measured by a tap; kept by the owner) — across its
   * own x-range. Measured (`run8-ios/img-147-0.png`): with the SWIFT form's `Payee’s bank street &
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

  const draws = (placed: Placed): boolean => !ROWS.some((row) => row.drawnOver?.(placed, seen) === true);
  const drawsOverTarget = (placed: Placed, about: SeenFor): boolean => !ROWS.some((row) => row.target?.(placed, about) === true);
  /** What the `target` column knows of `target`: the tree's facts, and where its reading order breaks. */
  const asTarget = (target: Placed): SeenFor => ({ ...seen, target, flatList, contentFrom, barLine, readingBreak: readingBreak(order, target, contentFrom, bottomChrome, barLine), bottomChrome, paddedTouchTargets });
  /** Every place of `node` in the walk — the same object may sit at several (`laterThan` reads after the first, outside them all). */
  const placesOf = (node: UiNode): Placed[] => order.filter((p) => p.node === node);
  /** What is drawn after `node` — after its first place, outside every one of its places' subtrees — that `keep` keeps. */
  const laterThan = (places: readonly Placed[], keep: (p: Placed) => boolean): Placed[] =>
    after(places[0]).filter((p) => !places.some((place) => within(p, place)) && keep(p));
  /** Everything drawn after `placed`'s subtree. */
  const after = (placed: Placed): readonly Placed[] => order.slice(placed.end);

  /** The keyboard row read as SCOPE, not as a cover: the container is never one of the keyboard's own nodes. */
  const outOfDrawnOver = NOT_DRAWN.keyboard.drawnOver;
  const drawnOver = (container: Rect): readonly UiNode[] | undefined => {
    const found = order.find((p) => clips(p.node) && sameRect(p.node.rect, container) && !outOfDrawnOver(p));
    if (found === undefined) return undefined;
    return after(found).flatMap((p) => (rectIntersection(p.node.rect, container) !== undefined && draws(p) ? [p.node] : []));
  };

  /** `paintsOver`'s two exemptions (`DrawOrder.paintsOver`): the cover hangs off one of `target`'s own branches — the nearest ancestor of it holding the cover is not screen-sized. */
  const ownBranch = (target: Placed, cover: Placed): boolean => {
    let shared = target.parent;
    while (shared !== undefined && !within(cover, shared)) shared = shared.parent;
    return shared !== undefined && rectArea(shared.node.rect) <= seen.screenArea * OWN_BRANCH_SCREEN_FRACTION;
  };
  /** `paintsOver`'s own content (`DrawOrder.paintsOver`): inside the node's rect and on its own branch — or, in a flat list, which has no branches, saying something and all of it the node's. */
  const ownContentOf = (target: Placed, cover: Placed, reach: Rect): boolean => {
    if (!rectWithin(reach, target.node.rect)) return false;
    if (!flatList) return ownBranch(target, cover);
    const said = wordsOf(cover.node);
    const says = wordsOf(target.node);
    return said.size > 0 && [...said].every((w) => says.has(w));
  };
  /** `paintsOver`'s clickable layer: unlabelled, unvalued, interactive, holding the node whole, on its own branch — never in a flat list. */
  const clickableLayer = (target: Placed, cover: Placed): boolean => {
    const n = cover.node;
    return !flatList && isInteractive(n) && !n.label && !n.value && rectWithin(target.node.rect, n.rect) && ownBranch(target, cover);
  };

  /**
   * The presented layers a tree source marks (`markOf`) whose cover lies ON the screen, in the walk's order: one whose
   * rect shares no area with the screen (0x0, or wholly off it — WDA keeps a dismissed alert in its tree) presents
   * nothing. Judged by the rect alone, never by WDA's visibility flags (`UiNode.hidden`): an alert mid-animation may
   * read hidden while it already takes every touch.
   */
  const markedOnScreen = order.flatMap((p) => {
    const layer = markOf(p, order);
    if (layer === undefined) return [];
    const on = rectIntersection(layer.cover.node.rect, screen);
    return on !== undefined && rectArea(on) > 0 ? [layer] : [];
  });
  /**
   * The PRESENTED LAYERS over the node at `places` that the tree source marks (`UiNode.presentation`) — the source's
   * fact, read here and nowhere else: each marked layer drawn after the node and OUTSIDE it — never one holding the
   * node (a layer's own nodes are not beneath it: the popover's `dismiss popup` is the way to close it), nor one in its
   * subtree; never over the keyboard's own nodes (`Placed.inKeyboard`). Such a layer is presented over the node
   * whatever the frames around it, its cover reaching the WHOLE screen (`laterFor`). No stacked-screens, window or
   * bare-frame condition: those are the shape fallback's inferences (presented-by-shape.ts), which the mark makes moot.
   */
  const markedLayers = (places: readonly Placed[]): readonly PresentedLayer[] =>
    // The keyboard's own nodes are never beneath: the keyboard is drawn over the app's windows, wherever WDA lists its
    // Window.
    places[0].inKeyboard ? [] : markedOnScreen.filter(({ layer }) => layer.at >= places[0].end && !places.some((place) => within(layer, place) || within(place, layer)));
  /**
   * What is drawn after the node at `places` (`laterThan`) as a TARGET meets it, read with the marked presented layers
   * over it (`markedLayers`): `markedCover` — a layer's cover, reaching the whole screen and drawn whatever the rows
   * say, that screen's surface; a TYPED layer (an alert, an action sheet, a popover) is its element alone — what else
   * it holds (its dim, a bare frame or not; the element's backdrop leaves) is drawn on it, no cover of its own; a
   * `screen` layer's own nodes stay covers, judged by the rows, and each one is a presented surface (`inScreen`), so
   * the cover named at a point is what of the layer is on top there, the layer itself only where nothing of it draws. A
   * node not in the walk (no `places`) has nothing after it (`NOTHING_LATER`).
   */
  const laterFor = (places: readonly Placed[]): LaterRead => {
    if (places.length === 0) return NOTHING_LATER;
    const layers = markedLayers(places);
    if (layers.length === 0) return { ...NOTHING_LATER, later: laterThan(places, () => true) };
    const covers = new Set(layers.map(({ cover }) => cover));
    const typed = layers.filter(({ kind }) => isTyped(kind));
    const screens = layers.filter(({ kind }) => !isTyped(kind));
    return {
      later: laterThan(places, (p) => covers.has(p) || !typed.some(({ layer }) => within(p, layer))),
      markedCover: (p) => covers.has(p),
      inScreen: (p) => screens.some(({ layer }) => within(p, layer)),
    };
  };

  /**
   * The last node drawn after `node` whose reach `where` keeps (a marked presented layer's cover reaches the whole
   * screen, `laterFor`), that draws for it as a target and is the surface of a screen presented over its own — a node
   * of a marked `screen` layer, or by shape on a tree whose source did not judge (`surfaceOf`) — or that cover:
   * `presentedAt` keeps those holding its point, `presentedOver` every one.
   */
  const lastPresentedSurface = (node: UiNode, where: (reach: Rect) => boolean = () => true): UiNode | undefined => {
    const places = placesOf(node);
    if (places.length === 0) return undefined;
    const about = asTarget(places[0]);
    const { later, markedCover, inScreen } = laterFor(places);
    return later.filter((p) => (markedCover(p) ? where(screen) : where(p.node.rect) && drawsOverTarget(p, about) && (inScreen(p) || surfaceOf(p, places[0], seen)))).at(-1)?.node;
  };

  const api: DrawOrder = {
    keyboardBandTop: keyboard?.top,
    ofKeyboardBand: (node) => keyboard?.own.has(node) === true,
    paintsOver(node, box) {
      const target = placesOf(node)[0];
      if (target === undefined) return [];
      const { covers, reaches } = api.exposure(node, box);
      const read = rectIntersection(node.rect, box);
      return covers.flatMap((cover, i) => {
        const placed = placesOf(cover)[0];
        const reach = reaches[i];
        const hides = read !== undefined && overlapsPastSlack(reach, read);
        return !hides || ownContentOf(target, placed, reach) || clickableLayer(target, placed) ? [] : [{ node: cover, reach: { ...reach } }];
      });
    },
    drawnOver,
    drawnOverAt(container, point) {
      return (drawnOver(container) ?? []).filter((n) => containsPoint(n.rect, point) && !rectWithin(container, n.rect)).at(-1);
    },
    coversOf(node, region) {
      const places = placesOf(node);
      if (places.length === 0) return [];
      const about = asTarget(places[0]);
      const { later, markedCover } = laterFor(places);
      return later.filter((p) => (markedCover(p) ? rectIntersection(screen, region) !== undefined : rectIntersection(p.node.rect, region) !== undefined && drawsOverTarget(p, about))).map((p) => p.node);
    },
    presentedAt: (node, point) => lastPresentedSurface(node, (reach) => containsPoint(reach, point)),
    presentedOver: (node) => lastPresentedSurface(node),
    markedAt(point) {
      // A node the source says is not shown (`UiNode.hidden`) neither scrolls nor is named here, as the target column's
      // `hidden` row judges it for a target: the stroke for no target and the one for a target agree.
      const own = (layer: Placed): readonly Placed[] =>
        order.slice(layer.at + 1, layer.end).filter((p) => p.node.hidden !== true);
      const scrolledAt = (layer: Placed): boolean =>
        own(layer).some((p) => scrolls(p.node) && containsPoint(p.node.rect, point));
      // The last marked layer takes the touch (its reach is the whole screen): on a scroll view of its own the stroke
      // scrolls it, and no layer beneath is asked.
      const on = markedOnScreen.at(-1);
      if (on === undefined || scrolledAt(on.layer)) return undefined;
      if (isTyped(on.kind)) return on.cover.node;
      // No target to judge a cover for: what of the layer draws at the point by the column that needs none
      // (`drawnOver`'s), the layer itself where nothing of it does.
      return own(on.layer).filter((p) => containsPoint(p.node.rect, point) && draws(p)).at(-1)?.node ?? on.cover.node;
    },
    presentedPress(surface) {
      const layer = markedOnScreen.find(({ cover }) => cover.node === surface)?.named;
      return { surface, reach: layer === undefined ? { ...surface.rect } : { ...screen }, ...(layer !== undefined && { layer }) };
    },
    exposure(node, box) {
      const shown = rectIntersection(node.rect, box);
      const places = placesOf(node);
      const about: SeenFor | undefined = places.length === 0 ? undefined : asTarget(places[0]);
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
      // In idb's flat list a floating tab bar's items cover what lies outside the bar whatever their place in the list (idb lists them first); a nested
      // tree's order IS its draw order (an action sheet listed after the bar is drawn over it), so there only the items listed after the target count.
      // A flat list has no nesting, so no item listed before the target is its ancestor.
      const before = places.length === 0 || !flatList ? [] : order.slice(0, places[0].at).filter((p) => floatsOver(p) !== undefined);
      // Everything listed after it that meets what shows, each judged once by the `target` column: a cover, or excused.
      // A marked presented layer's cover reaches the whole screen and draws whatever the rows say (`laterFor`).
      const { later, markedCover, inScreen } = laterFor(places);
      const reachOf = (p: Placed): Rect => (markedCover(p) ? { ...screen } : reach(p));
      const met =
        shown === undefined || about === undefined
          ? []
          : [...before, ...later]
              .filter((p) => rectIntersection(reachOf(p), shown) !== undefined)
              .map((p) => ({ placed: p, node: p.node, reach: reachOf(p), draws: markedCover(p) || drawsOverTarget(p, about), markedCover: markedCover(p) }));
      const over = met.filter((c) => c.draws);
      const covers = over.map((c) => c.node);
      const pieces = over.reduce<Rect[]>((left, cover) => left.flatMap((piece) => subtract(piece, cover.reach)), shown === undefined ? [] : [shown]);
      const area = rectArea(node.rect);
      const largest = largestRect(pieces);
      const coverAt = (point: Point): UiNode | undefined => over.filter((c) => containsPoint(c.reach, point)).at(-1)?.node;
      const centre = tapPoint(node);
      const onCentre = shown !== undefined && containsPoint(shown, centre);
      const centreCover = onCentre ? coverAt(centre) : undefined;
      const centreExcused = onCentre ? met.filter((c) => !c.draws && containsPoint(c.reach, centre)).map((c) => c.node) : [];
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
        centreExcused,
        presented: over.filter((c) => c.markedCover || inScreen(c.placed) || surfaceOf(c.placed, places[0], seen)).map((c) => c.node),
        ...(tapAt !== undefined && { tapAt }),
        minPiece,
        coverAt,
      };
    },
  };
  return api;
}

/**
 * The one implementation of the uiautomator parser's port
 * (adapters/types.ts#DrawnOverStrip): one draw order of the tree as read,
 * asked `coversOf` the strip for each node — a strip is drawn over when any
 * node draws there for that node as a target.
 */
export const drawnOverStrip: DrawnOverStrip = (root) => {
  const order = drawOrder(root);
  return (node, strip) => order.coversOf(node, strip).length > 0;
};
