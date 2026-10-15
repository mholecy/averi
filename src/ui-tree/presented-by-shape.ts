import { STRUCTURAL_ROLES, type UiNode } from '../adapters/types.js';
import { CONTENT_FRAMED_ROLES, emptyFrame, fillsScreen, holderOf, itemless, stackedScreens, type Placed } from './placed.js';
import { scrolls } from './scroll-containers.js';

/**
 * A PRESENTED SCREEN INFERRED FROM SHAPE: the fallback draw order asks (draw-order.ts#drawOrder) only of a tree whose
 * source did not judge presented layers itself — no `UiNode.presentationsJudged` on its root: Android's uiautomator
 * tree, idb's flat list, a WDA payload carrying no visibility flags, and a tree printed before the source marked its
 * presented layers (the normalized snapshots kept as fixtures and in the differential corpus). A tree whose source
 * judged never reaches it: there the marked layers are the presented ones (draw-order.ts#markOf), and a later
 * screen-sized layer the source did not mark presents nothing.
 *
 * Why it still exists: those trees carry no presented-layer fact, and without the shape a screen presented over
 * the target's — an RN transparent Modal's dimming leaf, a sheet's form — reads as not covering it: its dim and its
 * scroll view are what the frame rows excuse. On idb's flat list it never holds (every node's holder is the root, no
 * window of its own). On Android a dialog's or a bottom sheet's window is dumped alone, so the screen beneath is
 * absent, not covered; the rule fires on SystemUI's notification shade, where it misreads the shade's notification
 * stack as a screen presented over its own quick settings.
 *
 * Two questions, one rule (`givesWay`): does a frame row's excuse of a node give way because the node lies on a
 * screen presented over the target's (`givesWay`, asked by draw-order.ts's `structural`, `screenSizedHost` and
 * `contentFramed` rows), and is a node a cover of the target that is such a screen's SURFACE
 * (`presentedSurface`: what `Exposure.presented`, the presented questions and the `hidden` row's guard read on such a
 * tree).
 * The decision and its residuals: docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md
 */
export interface PresentedByShape {
  /**
   * `row`'s excuse of `placed` for `target` gives way: it lies on a screen presented over the target's (`givesWay`).
   */
  givesWay(row: FrameRow, placed: Placed, target: Placed): boolean;
  /** `placed` is the SURFACE of a screen presented over `target`'s. */
  presentedSurface(placed: Placed, target: Placed): boolean;
}

/** The three frame rows of draw order's `target` column (draw-order.ts#FRAME_EXCUSES) the shape rule may take back. */
export type FrameRow = 'structural' | 'screenSizedHost' | 'contentFramed';

/** Whether draw order's frame row `row` excuses `placed` for `target` — the row's own rule, handed in by draw order. */
export type FrameExcuse = (row: FrameRow, placed: Placed, target: Placed) => boolean;

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
 * `placed` lies on a screen PRESENTED over `target`'s: a later screen-sized layer stacked over the target's own, inside
 * one window and outside scrolled content, carrying content. Each condition:
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
 * The shape fallback for a tree of `screenArea` (`screenOf`'s), with draw order's frame rows' own excuses
 * (`excuses`).
 *
 * `givesWay` — A SURFACE OVER THE SCREEN BENEATH: the exception to the frame rows — a node a frame row excuses, or one
 * a row would name as a presented surface (`presentedSurface`, through the row's `surfaceCandidate`: for `structural`
 * any structural node, excused or not), whose own `overPresented` holds (`structural`: a LEAF that FILLS THE SCREEN,
 * `fillsScreen`; `screenSizedHost` and `contentFramed`: a scroll view, drawing only through its rows), covers a target
 * (or, asked by `presentedSurface`, is named a presented surface) when it lies on a screen presented over the target's
 * (`presentedOver`) and is no bare frame (`emptyFrame` with nothing drawable in it — a spacer of the layer stays
 * excused, so a leaf the app named, the RN Modal's dimming root `forgot_overlay`, covers and an anonymous one does
 * not). Only surfaces that draw their whole rect: a dimming leaf, a sheet's scroll view. A smaller leaf stays excused:
 * every unmapped Android leaf is an `other`, every RN View leaf under WDA too, so an icon's parts or a field's wrapper
 * would read as a screen's surface. A wrapper or a host WITH children stays excused over another screen too — it may
 * be a pass-through layer drawing only its content: measured, Safari's `CapsuleViewController 0,0 402x874` (its bottom
 * bar, Back and Tabs) laid in the app's Window after the web view, whose links were measured tapped.
 * Measured: Finportal's RN transparent Modal (its dimming leaf, its card) and Contacts' New Contact page sheet (its
 * form `scrollable 0,62 402x812`, 0.929 of the screen), each laid in the app's Window after the screen beneath, which a
 * tap was sent to through the layer.
 *
 * `presentedSurface` — a cover of `target` that is the SURFACE of a screen presented over it: a node some
 * frame row names as a candidate (`surfaceCandidate`) and whose exception over a presented screen holds (that row's
 * `givesWay`). For `structural`, a STRUCTURAL leaf that fills the screen on a presented layer, whether that row
 * excuses it or not — labelled or valued, it covers anyway, so only what the sentences say of it is the exception's:
 * UIKit's `container 'dismiss popup' id=PopoverDismissRegion`, the dim of a half-height SwiftUI sheet
 * (`-402,-874 1206x2622`) and of Contacts' discard popover (`0,0 402x874`), each a leaf beside what it dims, whose
 * swipe "out from under" moved the sheet to another detent and closed the popover; for the other two rows, a scroll
 * view they excuse and that gives way.
 */
export function presentedByShape(screenArea: number, excuses: FrameExcuse): PresentedByShape {
  const givesWay = (row: FrameRow, placed: Placed, target: Placed): boolean =>
    OVER_PRESENTED[row].overPresented(placed.node, screenArea) && !(emptyFrame(placed.node) && !carriesContent(placed.node)) && presentedOver(placed, target, screenArea);
  const presentedSurface = (placed: Placed, target: Placed): boolean =>
    (Object.keys(OVER_PRESENTED) as FrameRow[]).some((row) => OVER_PRESENTED[row].surfaceCandidate(placed.node, () => excuses(row, placed, target)) && givesWay(row, placed, target));
  return { givesWay, presentedSurface };
}
