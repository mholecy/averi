import type { UiNode } from '../adapters/types.js';

/**
 * THE TREE'S DIALECT: what its source's listing means, read off the marks the source put on the tree's ROOT — the one
 * reader of those marks in ui-tree and above (backlog A45). A mark of the source, never of the tree's shape: ui-tree
 * knows no platform, and a shape (a rectless root over leaves) would also match a test's or a future source's tree. A
 * tree no source marked (a hand-built tree, a normalized snapshot) reads as a nested tree that says nothing more.
 *
 * The WRITERS — each mark is set there and nowhere else (adapters/types.ts#UiNode documents each mark):
 * - adapters/ios-tree-source.ts#markIdbDialect: `flatList` (idb's describe-all; scripts/differential/recorded-source.ts
 *   gives an older idb capture the same marks with it);
 * - adapters/wda-source.ts#markWdaDialect: `unclippedFrames`; adapters/wda-source.ts#parseWdaSourceValue:
 *   `presentationsJudged`, on a payload carrying the visibility flags;
 * - adapters/android-tree-dialect.ts#parseUiautomatorXml: `paddedTouchTargets`, `activeWindowOnly`, `boundsCutAtScreen`;
 * - ui-tree/window-mark.ts#markByWindow: `windowAlone`, after the read, on a miss only, from the window manager's word.
 *
 * The READERS — each field's doc below names them; nothing else in src/ lists them. A field is named for what it says,
 * not after its mark, so a read of a raw mark (`.flatList`, `.unclippedFrames`, …) outside this module and the writers
 * stands out to a grep.
 */
export interface TreeDialect {
  /**
   * The tree's nesting is its nodes' ANCESTRY — false on idb's flat list (`flatList`), whose nodes are all siblings of
   * one synthetic root, so nothing in the tree says what a node belongs to. Read by draw-order.ts#drawOrder (a flat
   * list's own rules: its top bar, reading-order break, bottom chrome, keyboard and the sibling guard; handed on to
   * reading-order.ts#readingOrderOf and placed.ts#FRAME_EXCUSES as `flatList`), presentation.ts#presentationOf (a
   * marked layer of a flat list is listed ahead of what it covers; the shape adapter's frame rows), standing.ts#sceneOf
   * (geometry.ts#clipsOf's `ancestry`, the pixel standing's flat-list root) and interact/within.ts#resolveWithin (no
   * scroll view can be named on a flat list).
   */
  readonly ancestry: boolean;
  /**
   * The source reports every frame UNCLIPPED (`unclippedFrames`: WDA's) — a scroll view's content at its laid-out rect
   * past the scroll view's frame, so that content says which way it scrolls and where it ends. Read by
   * standing.ts#sceneOf (geometry.ts#clipsOf's `unclipped`) and interact/keyboard-dismissal.ts (the drag's scroll axis,
   * scroll-containers.ts#scrollAxis).
   */
  readonly framesUnclipped: boolean;
  /**
   * The source CUTS a node's bounds AT THE SCREEN'S EDGE whatever scroll view it lies past (`boundsCutAtScreen`:
   * uiautomator's), so a side lying on the screen's edge runs on an unknown distance past it. Read by
   * standing.ts#sceneOf (geometry.ts#clipsOf's `cutAtScreen`).
   */
  readonly cutAtScreen: boolean;
  /**
   * The source cuts a node's bounds at what is drawn AFTER it (Compose's) — the one field derived from ABSENT marks:
   * a tree with ancestry whose frames are not unclipped. So an unmarked tree reads as one that cuts, as it did before
   * this module (an inference, kept as it was; the measured source is uiautomator's, which no mark of its own names
   * here). Read by later-edges.ts#laterEdgesIn.
   */
  readonly cutsAtLater: boolean;
  /**
   * The source lists a control's minimum TOUCH TARGET as a wrapper of its own around it (`paddedTouchTargets`:
   * uiautomator's, Compose's padding). Read by draw-order.ts#drawOrder (`ownControl`'s padded shape) and
   * cover.ts#marginText (a text in a control's touch margin).
   */
  readonly padsTouchTargets: boolean;
  /**
   * The source when it lists only the TOP LAYER (`TopLayerOnlySource`: idb's flat list, `flatList`), else absent. Read
   * by miss.ts#missOf (`noIdListed`, `idUnlisted`), interact/resolve.ts (what lies unlisted under the keyboard) and
   * interact/scroll-rounds.ts (the strokes for a target never seen, `CallEvidence`).
   */
  readonly topLayerOnly?: TopLayerOnlySource;
  /**
   * The source lists the ACTIVE WINDOW only (`activeWindowOnly`: uiautomator's), else absent: `screenAlone` where the
   * window manager said the window is the app's screen alone (`windowAlone`, window-mark.ts), else `mayHide` — the
   * window may be a sheet or a dialog hiding the screen beneath. Read by miss.ts#missOf (`ListedAs`, the active-window
   * hint) and window-mark.ts (a tree the window manager's word may still mark).
   */
  readonly activeWindow?: ActiveWindow;
  /**
   * The source JUDGED presented layers itself (`presentationsJudged`: WDA's, on a payload carrying the visibility
   * flags), so a layer it did not mark presented is none. Read by presentation.ts#presentationOf (no shape fallback).
   */
  readonly judgesPresentations: boolean;
}

/**
 * A tree source that lists only what a presented layer leaves to accessibility and shows no sign of a layer it does
 * not mark: idb's flat list — a large-detent sheet, an alert, a transparent cover over the screen leave only their own
 * controls listed, or none (ADR 0018, "idb's presented layer", residuals).
 */
export type TopLayerOnlySource = 'idb';

/** What a tree that lists the active window only says of that window (`TreeDialect.activeWindow`). */
export type ActiveWindow = 'screenAlone' | 'mayHide';

/** The dialect of `tree`, read off its root's marks (`TreeDialect`). Pure; `tree` is the ROOT the source gave. */
export function dialectOf(tree: UiNode): TreeDialect {
  const ancestry = tree.flatList !== true;
  const framesUnclipped = tree.unclippedFrames === true;
  return {
    ancestry,
    framesUnclipped,
    cutAtScreen: tree.boundsCutAtScreen === true,
    cutsAtLater: ancestry && !framesUnclipped,
    padsTouchTargets: tree.paddedTouchTargets === true,
    ...(!ancestry && { topLayerOnly: 'idb' as const }),
    ...(tree.activeWindowOnly === true && { activeWindow: tree.windowAlone === true ? ('screenAlone' as const) : ('mayHide' as const) }),
    judgesPresentations: tree.presentationsJudged === true,
  };
}
