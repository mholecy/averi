import { isTyped, rectArea, rectIntersection, STRUCTURAL_ROLES, type Point, type PresentationKind, type Rect, type UiNode } from '../adapters/types.js';
import { containsPoint, screenOf } from './geometry.js';
import { CONTENT_FRAMED_ROLES, emptyFrame, FRAME_EXCUSES, fillsScreen, holderOf, itemless, stackedScreens, walkOf, within, type FrameRow, type Placed } from './placed.js';
import { scrolls } from './scroll-containers.js';

/**
 * PRESENTATION: what of a tree is PRESENTED over what — which layer lies over a target (a node of the walk) or a point,
 * what it is (an alert, an action sheet, a popover, a presented `screen`, a dim or a sheet's form inferred from shape),
 * and whether the tree's source judged its presented layers itself. The one module that answers it; draw order
 * (draw-order.ts#drawOrder) asks it beside its rows, as it asks the keyboard band, and hands the answer on to the
 * standing (standing.ts#Scene.presentedAt, #remedied) through `DrawOrder.presentation`.
 *
 * Behind its small interface sit THREE ADAPTERS, one per kind of evidence a tree can carry:
 * - BY MARKS (`byMarks`): the layers the tree SOURCE marks presented (`UiNode.presentation` on the layer,
 *   `UiNode.presentationElement` on a typed layer's element) — the WDA parser's facts (adapters/wda-source.ts#
 *   presentedLayers, by element type and by WDA's own visibility flags) and the uiautomator parser's (adapters/
 *   android.ts#presentedWindow: the one window it dumps, on its root, a `dialog` or a `screen`); read on every tree,
 *   since a flagless WDA payload still types an alert. idb's describe-all marks nothing, so on its trees this adapter
 *   answers nothing.
 * - BY SHAPE (`byShape`): the FALLBACK for a tree whose source did not judge presented layers (no
 *   `UiNode.presentationsJudged` on its root): a later screen-sized layer stacked over the target's own screen inside
 *   one window, carrying content — idb's flat list (where it never holds), a flagless WDA payload, a normalized
 *   snapshot printed without the mark. Never asked of a judged tree: there the marks are the presented layers, and a
 *   layer the source did not mark presents nothing.
 * - BY UIAUTOMATOR (`byUiautomator`): the fallback for a tree whose source lists the ACTIVE WINDOW ONLY (the
 *   uiautomator root's mark, `UiNode.activeWindowOnly`): the shape adapter's answers, and the one question such a
 *   listing adds — whether the window it lists is a presented one, so a target missing from it may lie beneath, unlisted
 *   (`alone`; lab note L1).
 *
 * The interface (`Presentation`):
 * - `over(node)` — what presentation says of the nodes drawn after a TARGET (`PresentedOver`): which of them a
 *   presented layer leaves undrawn for it, which is a presented layer's cover reaching the whole screen, which is the
 *   surface of a screen presented over it (and on what evidence: a source's fact, or an inference), and which frame
 *   excuse gives way over such a screen. Draw order's `exposure`, `coversOf`, `presentedAt`, `presentedOver` and its
 *   frame and `hidden` rows read it.
 * - `topmostAt(point)` — the presented layer on top at a point for NO target (`PresentedTop`), off its own scroll
 *   views: draw order's `markedAt`, `scroll_until`'s stroke for a target not in the tree.
 * - `press(surface)` — a presented surface as a sentence quotes it (`PresentedPress`): where it presses and, when it
 *   is a marked layer's cover, what that layer is (`MarkedLayer`) — the verbs' one view of a source's mark.
 * - `alone` — the presented layer the tree lists ALONE: a source that lists only the active window, and that window
 *   marked presented — the screen beneath it is not in the tree, so a target not found may lie there (the tap's wait,
 *   interact/resolve.ts, says close it first instead of "to appear").
 * - `fallback` — which adapter infers what the source did not judge (`shape`, `uiautomator`), none on a judged tree.
 *
 * The policy is ADR 0018's and unchanged by where it lives: the source's marks first, the shape only as the fallback
 * of a tree whose source did not judge; the target's own visibility is never evidence alone.
 * docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md
 */
export interface Presentation {
  /**
   * The adapter that infers presented screens on this tree (`byShape`, `byUiautomator`): undefined on a tree whose
   * source judged presented layers itself (`UiNode.presentationsJudged`), which no shape is asked of. No production
   * caller reads it: it is the test surface for which adapter a tree gets (tests/ui-tree/presentation.test.ts).
   */
  readonly fallback: 'shape' | 'uiautomator' | undefined;
  /**
   * The presented layer the tree lists ALONE, as a sentence names it (`MarkedLayer`): its source lists the active
   * window only (`UiNode.activeWindowOnly`) and marks that window — the tree's root — presented, so the screen beneath
   * it is not in the tree and a target not found may lie there. Undefined on any other tree: one that lists every
   * window (WDA's), where a target missing beside a marked alert is missing, and one whose window is not presented.
   */
  readonly alone: MarkedLayer | undefined;
  /** What presentation says of the nodes drawn after `node` as a TARGET (`PresentedOver`); a node not in the tree has nothing presented over it. */
  over(node: UiNode): PresentedOver;
  /**
   * The presented layer a touch-down at `point` lands on, for NO target (`PresentedTop`): the topmost layer the source
   * marks (`byMarks`) on the screen — its reach is the whole screen, so it takes every touch — unless the point lies on
   * a scroll view of that layer's own (a stroke scrolling the alert's own content, a search inside a sheet's own list;
   * no layer beneath it is asked). A screen presented by shape alone is not asked here. Undefined when none.
   */
  topmostAt(point: Point): PresentedTop | undefined;
  /**
   * A presented surface as a sentence quotes it (`PresentedPress`): where it presses — the whole screen for a marked
   * layer's cover (a typed layer's element, a `screen` layer itself), else its rect — and that layer, when it is one's
   * cover.
   */
  press(surface: UiNode): PresentedPress;
}

/**
 * A presented layer the tree source marks (`UiNode.presentation`), as a sentence names it: its kind and its label (its
 * element's, for a typed layer). What the remedy words (standing.ts#presentedRemedy, #presentedStop).
 */
export interface MarkedLayer {
  readonly kind: PresentationKind;
  readonly label?: string;
}

/**
 * A presented surface as a sentence quotes it (`Presentation.press`): the `surface` draw order named
 * (draw-order.ts#DrawOrder.presentedAt, #presentedOver, #markedAt, or `Exposure.presented`), where it presses
 * (`reach`: the whole screen for a marked presented layer's cover — a typed layer's element, a `screen` layer itself —
 * else its rect), and that marked `layer` when it is one's cover.
 */
export interface PresentedPress {
  readonly surface: UiNode;
  readonly reach: Rect;
  readonly layer?: MarkedLayer;
}

/**
 * The evidence a presented surface is named on (`PresentedOver.surface`): a source's FACT (a node of a layer the source
 * marks presented) or an INFERENCE (the shape of a screen-sized layer stacked over the target's). Draw order's `hidden`
 * row lets only an inference outvote the source's own hidden flag (`UiNode.hidden`): a sheet layer WDA reports `0/0`
 * whole over a list, on a tree whose source did not judge, still covers by its shape; a hidden node of a marked
 * `screen` layer stays excused, the layer covering through its cover instead (ADR 0019).
 */
export type SurfaceBy = 'fact' | 'inferred';

/**
 * What presentation says of the nodes drawn after one TARGET (`Presentation.over`), each asked of a node of the walk
 * (placed.ts#Placed) drawn after it — draw order picks those, and judges them by its rows.
 */
export interface PresentedOver {
  /**
   * `p` is drawn for the target at all: false for what a TYPED marked layer over it holds besides its element (its dim,
   * a bare frame or not; the element's backdrop leaves) — drawn on the layer, no cover of its own; true for every other
   * node.
   */
  drawn(p: Placed): boolean;
  /**
   * `p` is the COVER of a marked presented layer over the target (a typed layer's element, a `screen` layer itself):
   * it reaches the whole screen and draws whatever the rows say. A boolean, not a reach: each reader branches on it for
   * more than the rect (it skips the rows, and `exposure` otherwise asks a flat list's pinned reach), so answering a
   * reach here would move no branch out of draw order (review round 1, NIT-1, left as is).
   */
  wholeScreen(p: Placed): boolean;
  /**
   * `p` is the SURFACE of a screen presented over the target's, and on what evidence (`SurfaceBy`): a node of a marked
   * `screen` layer over it (`fact`), or a cover the shape fallback names (`inferred`, which wins where both hold: the
   * `hidden` row asks it). Asked of a node draw order already judged to draw for the target, or of a cover.
   */
  surface(p: Placed): SurfaceBy | undefined;
  /** `row`'s frame excuse of `p` (placed.ts#FRAME_EXCUSES) gives way: `p` lies on a screen presented over the target's, by shape. */
  givesWay(row: FrameRow, p: Placed): boolean;
}

/**
 * The presented layer on top at a point for no target (`Presentation.topmostAt`): its `cover` (a typed layer's
 * element; a `screen` layer itself) and, for a `screen` layer, its own nodes that hold the point and that the source
 * does not report hidden (`UiNode.hidden`), in walk order — draw order names the last of them that draws by the column
 * needing no target, else the cover. Empty for a typed layer, which is named by its element alone.
 */
export interface PresentedTop {
  readonly cover: Placed;
  readonly at: readonly Placed[];
}

/** One adapter's answers (`byMarks`, `byShape`, `byUiautomator`); `presentationOf` composes them. */
interface PresentationAdapter {
  /** `Presentation.alone`: only the uiautomator adapter's to answer. */
  readonly alone?: MarkedLayer;
  over(places: readonly Placed[]): PresentedOver;
  topmostAt(point: Point): PresentedTop | undefined;
  /** The marked layer `surface` is the cover of — its reach the whole screen — or undefined. */
  layerOf(surface: UiNode): MarkedLayer | undefined;
}

/** Nothing presented over a target: every node drawn, none a layer's cover or a presented surface, no excuse given way. */
const NOTHING_OVER: PresentedOver = { drawn: () => true, wholeScreen: () => false, surface: () => undefined, givesWay: () => false };

/**
 * The presentation of `tree`, over its walk (`order`, placed.ts#walkOf — draw order hands its own, so the tree is
 * walked once): the marks adapter on every tree, and the fallback (`Presentation.fallback`) only on a tree whose
 * source did not judge presented layers — the uiautomator adapter on a tree that lists the active window only
 * (`UiNode.activeWindowOnly`, Android's), the shape adapter on any other.
 * The tree must not change while the answer is in use.
 */
export function presentationOf(tree: UiNode, order: readonly Placed[] = walkOf(tree)): Presentation {
  const screen = screenOf(tree);
  const screenArea = rectArea(screen);
  const fallback = tree.presentationsJudged === true ? undefined : tree.activeWindowOnly === true ? ('uiautomator' as const) : ('shape' as const);
  const adapters: readonly PresentationAdapter[] = [
    byMarks(order, screen),
    ...(fallback === 'uiautomator' ? [byUiautomator(order, screenArea)] : fallback === 'shape' ? [byShape(screenArea)] : []),
  ];
  return {
    fallback,
    alone: adapters.reduce<MarkedLayer | undefined>((found, a) => found ?? a.alone, undefined),
    over(node) {
      const places = order.filter((p) => p.node === node);
      if (places.length === 0) return NOTHING_OVER;
      const overs = adapters.map((a) => a.over(places));
      return {
        drawn: (p) => overs.every((o) => o.drawn(p)),
        wholeScreen: (p) => overs.some((o) => o.wholeScreen(p)),
        surface: (p) => {
          const by = overs.map((o) => o.surface(p));
          return by.includes('inferred') ? 'inferred' : by.includes('fact') ? 'fact' : undefined;
        },
        givesWay: (row, p) => overs.some((o) => o.givesWay(row, p)),
      };
    },
    topmostAt: (point) => adapters.reduce<PresentedTop | undefined>((found, a) => found ?? a.topmostAt(point), undefined),
    press(surface) {
      const layer = adapters.reduce<MarkedLayer | undefined>((found, a) => found ?? a.layerOf(surface), undefined);
      return { surface, reach: layer === undefined ? { ...surface.rect } : { ...screen }, ...(layer !== undefined && { layer }) };
    },
  };
}

// ── By marks: the tree source's facts ────────────────────────────────────────────────────────────────────────────

/**
 * A presented layer the tree source marks, as this module reads it (`markOf`): the `layer` (a Window's direct child),
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
 * THE reading of the tree source's presented-layer marks (`UiNode.presentation` on the layer,
 * `UiNode.presentationElement` on a typed layer's element) — the one reader in code (ADR 0018): the presented layer
 * `layer` is, among the walk's `order`; undefined for any other node. A typed layer whose element is not marked (a
 * hand-built tree) is its own cover, named by its own label.
 */
const markOf = (layer: Placed, order: readonly Placed[]): PresentedLayer | undefined => {
  const kind = layer.node.presentation;
  if (kind === undefined) return undefined;
  const element = isTyped(kind) ? order.slice(layer.at, layer.end).find((p) => p.node.presentationElement === true) : undefined;
  const cover = element ?? layer;
  return { layer, kind, ...(element !== undefined && { element }), cover, named: { kind, ...(cover.node.label ? { label: cover.node.label } : {}) } };
};

/**
 * THE MARKS ADAPTER: the layers the tree source marks presented (`markOf`), read on every tree. A LAYER it marks covers
 * every node drawn before it and outside it through the whole screen — a typed layer (WDA's alert, action sheet or
 * popover) through its element alone, its one cover; a `screen` layer (one WDA's visibility flags show presented)
 * reaching the whole screen with its own nodes covering where they draw — each that screen's surface. No
 * stacked-screens, window or bare-frame condition: those are the shape fallback's inferences (`byShape`), which the
 * mark makes moot.
 */
function byMarks(order: readonly Placed[], screen: Rect): PresentationAdapter {
  /**
   * The marked layers whose cover lies ON the screen, in the walk's order: one whose rect shares no area with the
   * screen (0x0, or wholly off it — WDA keeps a dismissed alert in its tree) presents nothing. Judged by the rect alone,
   * never by WDA's visibility flags (`UiNode.hidden`): an alert mid-animation may read hidden while it already takes
   * every touch.
   */
  const marked = order.flatMap((p) => {
    const layer = markOf(p, order);
    if (layer === undefined) return [];
    const on = rectIntersection(layer.cover.node.rect, screen);
    return on !== undefined && rectArea(on) > 0 ? [layer] : [];
  });
  return {
    /**
     * The marked layers over the target at `places`: each drawn after it and OUTSIDE it — never one holding it (a
     * layer's own nodes are not beneath it: the popover's `dismiss popup` is the way to close it), nor one in its
     * subtree; never over the keyboard's own nodes (`Placed.inKeyboard`): the keyboard is drawn over the app's windows,
     * wherever WDA lists its Window. A typed layer's element is its cover and what else it holds is drawn on it; a
     * `screen` layer's own nodes stay covers, judged by the rows, and each one is a presented surface, so the cover named
     * at a point is what of the layer is on top there, the layer itself only where nothing of it draws.
     */
    over(places) {
      const layers = places[0].inKeyboard ? [] : marked.filter(({ layer }) => layer.at >= places[0].end && !places.some((place) => within(layer, place) || within(place, layer)));
      if (layers.length === 0) return NOTHING_OVER;
      const covers = new Set(layers.map(({ cover }) => cover));
      const typed = layers.filter(({ kind }) => isTyped(kind));
      const screens = layers.filter(({ kind }) => !isTyped(kind));
      return {
        drawn: (p) => covers.has(p) || !typed.some(({ layer }) => within(p, layer)),
        wholeScreen: (p) => covers.has(p),
        surface: (p) => (screens.some(({ layer }) => within(p, layer)) ? 'fact' : undefined),
        givesWay: () => false,
      };
    },
    topmostAt(point) {
      // A node the source says is not shown (`UiNode.hidden`) neither scrolls nor is named here, as draw order's
      // `hidden` row judges it for a target: the stroke for no target and the one for a target agree.
      const own = (layer: Placed): readonly Placed[] => order.slice(layer.at + 1, layer.end).filter((p) => p.node.hidden !== true);
      // The last marked layer takes the touch (its reach is the whole screen): on a scroll view of its own the stroke
      // scrolls it, and no layer beneath is asked.
      const on = marked.at(-1);
      if (on === undefined || own(on.layer).some((p) => scrolls(p.node) && containsPoint(p.node.rect, point))) return undefined;
      return { cover: on.cover, at: isTyped(on.kind) ? [] : own(on.layer).filter((p) => containsPoint(p.node.rect, point)) };
    },
    layerOf: (surface) => marked.find(({ cover }) => cover.node === surface)?.named,
  };
}

// ── By shape: the fallback for a tree whose source did not judge ─────────────────────────────────────────────────

/**
 * `n` carries something DRAWABLE: a descendant that is neither an empty frame (`emptyFrame`) nor an itemless toolbar
 * (`itemless`, whose frames are not looked into). False of a leaf, of a node of empty frames only, and of one whose
 * content is only itemless toolbars (WDA's `toolbar 'Toolbar'` hosts, the parked accessory's Window).
 */
const carriesContent = (n: UiNode): boolean => n.children.some((child) => !itemless(child) && (!emptyFrame(child) || carriesContent(child)));

/**
 * The child of `both` on `placed`'s branch — or `placed` itself when it is one: the layer `placed` lies in below
 * `both`.
 */
const layerOf = (placed: Placed, both: Placed): Placed => {
  let layer = placed;
  while (layer.parent !== undefined && layer.parent !== both) layer = layer.parent;
  return layer;
};

/**
 * `placed` lies on a screen PRESENTED over `target`'s, by shape: a later screen-sized layer stacked over the target's
 * own, inside one window and outside scrolled content, carrying content. Each condition:
 * - two STACKED SCREENS (placed.ts#stackedScreens, asked of the node as of a scroller: below the node holding both,
 *   each lies in a screen-sized layer of its own) INSIDE ONE WINDOW — the node holding both is not the tree's root,
 *   whose children are WDA's Windows (the parser's 0×0 holder of Android's, idb's flat list): a later Window may be a
 *   pass-through one, the parked input-accessory Window over every screen (wda-source-myport-2fa-keyboard-parked.json),
 *   so across Windows only content covers, as before;
 * - NOT IN SCROLLED CONTENT: the node holding both neither scrolls nor lies in anything that scrolls — layers of a
 *   scroll view's content are one screen's (Finportal's RN ScrollView lays a full-screen background container and
 *   then its `0,0 402x877` content container, which would read as a screen stacked over the background's frames);
 * - its layer — the child of the node holding both on its branch (`layerOf`) — carries something drawable
 *   (`carriesContent`): not only empty frames and itemless toolbars (WDA's `toolbar 'Toolbar'` hosts).
 * Asked through `givesWay`: of a node a frame row would excuse, and of a node a row would name as a presented surface
 * (`presentedSurface`, through the row's `surfaceCandidate`).
 */
const presentedOver = (placed: Placed, target: Placed, screenArea: number): boolean => {
  const both = holderOf(placed, target);
  if (both?.parent === undefined || scrolls(both.node) || both.scroller !== undefined) return false;
  return carriesContent(layerOf(placed, both).node) && stackedScreens(placed, target, screenArea, both);
};

/**
 * Each frame row's part of the exception over a presented screen: the nodes of it that give way (`overPresented`; the
 * rest of the exception is `givesWay`'s, one for the three) and the nodes it would name as a presented screen's
 * surface (`surfaceCandidate`: `structural`'s is any structural node, excused or not, since a labelled dim covers
 * anyway; the other two rows' is the node they excuse, `excused`).
 */
const OVER_PRESENTED: Record<FrameRow, { readonly overPresented: (node: UiNode, screenArea: number) => boolean; readonly surfaceCandidate: (node: UiNode, excused: () => boolean) => boolean }> = {
  structural: {
    // A leaf that fills the screen: a dimming view. A wrapper with children may be a pass-through layer.
    overPresented: (node, screenArea) => node.children.length === 0 && fillsScreen(node.rect, screenArea),
    // Any structural node, labelled or valued too: a dim the app or UIKit labelled is still a presented screen's
    // surface.
    surfaceCandidate: (node) => STRUCTURAL_ROLES.has(node.role),
  },
  screenSizedHost: {
    // A scroll view only (a sheet's form); any other host may pass touches through.
    overPresented: (node) => CONTENT_FRAMED_ROLES.has(node.role),
    surfaceCandidate: (_node, excused) => excused(),
  },
  contentFramed: {
    // Every scroll view this row excuses.
    overPresented: () => true,
    surfaceCandidate: (_node, excused) => excused(),
  },
};

/**
 * THE SHAPE ADAPTER: a PRESENTED SCREEN INFERRED FROM SHAPE, the fallback asked only of a tree whose source did not
 * judge presented layers itself (no `UiNode.presentationsJudged` on its root): idb's flat list, a WDA payload carrying
 * no visibility flags, and a normalized snapshot whose root carries no such mark (as the snapshots kept as fixtures and
 * in the differential corpus do not) — and, through the uiautomator adapter (`byUiautomator`), Android's tree. A tree
 * whose source judged never reaches it: there the marked layers are the presented ones (`byMarks`), and a later
 * screen-sized layer the source did not mark presents nothing.
 *
 * Why it still exists: those trees carry no presented-layer fact, and without the shape a screen presented over
 * the target's — an RN transparent Modal's dimming leaf, a sheet's form — reads as not covering it: its dim and its
 * scroll view are what the frame rows excuse. On idb's flat list it never holds (every node's holder is the root, no
 * window of its own). On Android a dialog's or a bottom sheet's window is dumped alone, so the screen beneath is
 * absent, not covered; the rule fires on SystemUI's notification shade, where it misreads the shade's notification
 * stack as a screen presented over its own quick settings.
 *
 * Two questions, one rule (`givesWay`), both asked per target (`PresentedOver`):
 *
 * `givesWay` — A SURFACE OVER THE SCREEN BENEATH: the exception to the frame rows (placed.ts#FRAME_EXCUSES) — a node a
 * frame row excuses, or one a row would name as a presented surface (`presentedSurface`, through the row's
 * `surfaceCandidate`: for `structural` any structural node, excused or not), whose own `overPresented` holds
 * (`structural`: a LEAF that FILLS THE SCREEN, `fillsScreen`; `screenSizedHost` and `contentFramed`: a scroll view,
 * drawing only through its rows), covers a target (or, asked by `presentedSurface`, is named a presented surface) when
 * it lies on a screen presented over the target's (`presentedOver`) and is no bare frame (`emptyFrame` with nothing
 * drawable in it — a spacer of the layer stays excused, so a leaf the app named, the RN Modal's dimming root
 * `forgot_overlay`, covers and an anonymous one does not). Only surfaces that draw their whole rect: a dimming leaf, a
 * sheet's scroll view. A smaller leaf stays excused: every unmapped Android leaf is an `other`, every RN View leaf
 * under WDA too, so an icon's parts or a field's wrapper would read as a screen's surface. A wrapper or a host WITH
 * children stays excused over another screen too — it may be a pass-through layer drawing only its content: measured,
 * Safari's `CapsuleViewController 0,0 402x874` (its bottom bar, Back and Tabs) laid in the app's Window after the web
 * view, whose links were measured tapped. Measured: Finportal's RN transparent Modal (its dimming leaf, its card) and
 * Contacts' New Contact page sheet (its form `scrollable 0,62 402x812`, 0.929 of the screen), each laid in the app's
 * Window after the screen beneath, which a tap was sent to through the layer.
 *
 * `presentedSurface` — a cover of `target` that is the SURFACE of a screen presented over it (`PresentedOver.surface`,
 * `inferred`): a node some frame row names as a candidate (`surfaceCandidate`) and whose exception over a presented
 * screen holds (that row's `givesWay`). For `structural`, a STRUCTURAL leaf that fills the screen on a presented layer,
 * whether that row excuses it or not — labelled or valued, it covers anyway, so only what the sentences say of it is
 * the exception's: UIKit's `container 'dismiss popup' id=PopoverDismissRegion`, the dim of a half-height SwiftUI sheet
 * (`-402,-874 1206x2622`) and of Contacts' discard popover (`0,0 402x874`), each a leaf beside what it dims, whose
 * swipe "out from under" moved the sheet to another detent and closed the popover; for the other two rows, a scroll
 * view they excuse and that gives way.
 *
 * Asks nothing of a point and names no layer (`topmostAt`, `layerOf`): a screen presented by shape alone is no
 * stroke's stop for a target not in the tree. The decision and its residuals:
 * docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md
 */
function byShape(screenArea: number): PresentationAdapter {
  const givesWay = (row: FrameRow, placed: Placed, target: Placed): boolean =>
    OVER_PRESENTED[row].overPresented(placed.node, screenArea) && !(emptyFrame(placed.node) && !carriesContent(placed.node)) && presentedOver(placed, target, screenArea);
  const presentedSurface = (placed: Placed, target: Placed): boolean =>
    (Object.keys(OVER_PRESENTED) as FrameRow[]).some((row) => OVER_PRESENTED[row].surfaceCandidate(placed.node, () => FRAME_EXCUSES[row](placed, target, screenArea)) && givesWay(row, placed, target));
  return {
    over([target]) {
      return { drawn: () => true, wholeScreen: () => false, surface: (p) => (presentedSurface(p, target) ? 'inferred' : undefined), givesWay: (row, p) => givesWay(row, p, target) };
    },
    topmostAt: () => undefined,
    layerOf: () => undefined,
  };
}

// ── By uiautomator: a tree that lists the active window only ─────────────────────────────────────────────────

/**
 * THE UIAUTOMATOR ADAPTER: the fallback for a tree whose source lists the ACTIVE WINDOW ONLY (`UiNode.activeWindowOnly`
 * on its root, set by the uiautomator parser — adapters/android.ts#parseUiautomatorXml). `uiautomator dump` lists the
 * window that has focus: with a Compose `AlertDialog` up the dump IS the dialog's window (`[155,851][925,1368]` of
 * 1080x2220), with a `ModalBottomSheet` up the sheet's full-screen window, its scrim first — and the screen beneath is
 * not in the tree at all, so no target of it is ever found and "covered" is not the question; "the tree IS a presented
 * window" is (lab note L1, docs/bugs/2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md).
 *
 * Whether it is, the PARSER decides, from the raw dump (adapters/android.ts#presentedWindow: a window floating off the
 * screen's origin is a `dialog`; a full-screen one whose clickable scrim lies above its sheet, a `screen`) and marks on
 * the root (`UiNode.presentation`) — as the WDA parser marks WDA's layers, since the scrim's `clickable` never reaches
 * the tree. The marks adapter (`byMarks`) reads that mark as any other: the window, the tree's first layer, is over no
 * target in it (every node of the tree is the window's own), and for NO target its cover takes every touch-down — the
 * dim outside the dialog, which dismisses it on a touch; the sheet, which a stroke drags to full height — unless the
 * point lies on a scroll view of the window's own (a search inside the sheet's list): `scroll_until` for a target not
 * in the tree stops before any stroke, "close it first" (standing.ts#Scene.presentedAt, through draw order's
 * `markedAt`), as under a WDA-marked layer.
 *
 * What this adapter adds is the one question such a listing raises (`alone`): the root's mark, when it has one — the
 * presented layer listed alone, the screen beneath unlisted — so the tap's wait for a target "to appear" says close it
 * first (interact/resolve.ts). Otherwise it answers as the shape adapter (`byShape`) — what Android got before: a
 * screen-sized layer stacked over the target's own inside one window read as presented by shape (on the corpus it
 * fires only on SystemUI's notification shade, a misreading).
 */
function byUiautomator(order: readonly Placed[], screenArea: number): PresentationAdapter {
  const window = order.at(0);
  const alone = window === undefined || window.parent !== undefined ? undefined : markOf(window, order)?.named;
  return { ...byShape(screenArea), ...(alone !== undefined && { alone }) };
}
