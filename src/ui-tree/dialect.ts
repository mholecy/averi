import type { UiNode } from '../adapters/types.js';

/**
 * THE TREE'S DIALECT: what its source's listing means, read off the marks the source put on the tree's ROOT — the one
 * reader of those marks in ui-tree and above. A mark of the source, never of the tree's shape: ui-tree knows no
 * platform, and a shape (a rectless root over leaves) would also match a test's or a future source's tree. A tree no
 * source marked (a hand-built tree, a normalized snapshot) reads as a nested tree that says nothing more.
 *
 * The WRITERS — each mark is set there and nowhere else (adapters/types.ts#UiNode says what each mark means):
 * - adapters/ios-tree-source.ts#markIdbDialect: `flatList` (idb's describe-all; scripts/differential/recorded-source.ts
 *   gives an older idb capture the same marks with it);
 * - adapters/wda-source.ts#markWdaDialect: `unclippedFrames`; adapters/wda-source.ts#parseWdaSourceValue:
 *   `presentationsJudged`, on a payload carrying the visibility flags;
 * - adapters/android-tree-dialect.ts#parseUiautomatorXml: `paddedTouchTargets`, `activeWindowOnly`, `boundsCutAtScreen`;
 * - ui-tree/window-mark.ts#markByWindow: `windowAlone`, after the read, on a miss only, from the window manager's word.
 *
 * The READERS are the callers of `dialectOf` (`grep -rn 'dialectOf(' src`) and the functions they hand a field to by
 * its name here (`ancestry`, for one, through draw order's and presentation's walks); no file keeps a list of them. A
 * field is named for what it says, not after its mark, so a read of a raw mark (`.flatList`, `.unclippedFrames`, …)
 * outside this module and the writers stands out to a grep.
 */
export interface TreeDialect {
  /**
   * The tree's nesting is its nodes' ANCESTRY — false on idb's flat list (`flatList`), whose nodes are all siblings of
   * one synthetic root, so nothing in the tree says what a node belongs to: a flat list is judged by draw order's
   * flat-list rules, names no scroll view, and lists a marked layer ahead of what it covers.
   */
  readonly ancestry: boolean;
  /**
   * The source reports every frame UNCLIPPED (`unclippedFrames`: WDA's) — a scroll view's content at its laid-out rect
   * past the scroll view's frame, so that content says which way it scrolls and where it ends.
   */
  readonly framesUnclipped: boolean;
  /**
   * The source CUTS a node's bounds AT THE SCREEN'S EDGE whatever scroll view it lies past (`boundsCutAtScreen`:
   * uiautomator's), so a side lying on the screen's edge runs on an unknown distance past it.
   */
  readonly cutsAtScreen: boolean;
  /**
   * The source cuts a node's bounds at what is drawn AFTER it (Compose's) — the one field derived from ABSENT marks: a
   * tree with ancestry whose frames are not unclipped. So an unmarked tree reads as one that cuts. An inference: the
   * measured source is uiautomator's, and no mark of its own says it.
   */
  readonly cutsAtLater: boolean;
  /**
   * The source lists a control's minimum TOUCH TARGET as a wrapper of its own around it (`paddedTouchTargets`:
   * uiautomator's, Compose's padding), so a control padded evenly in such a wrapper is the label's own, and a text in
   * a control's touch margin is the eyes' to judge.
   */
  readonly padsTouchTargets: boolean;
  /**
   * The source when it lists only the TOP LAYER (`TopLayerOnlySource`: idb's flat list, `flatList`), else absent: a
   * target missing from it may lie beneath a layer or the keyboard it does not list, and strokes may land on one.
   */
  readonly topLayerOnly?: TopLayerOnlySource;
  /**
   * The source lists the ACTIVE WINDOW only (`activeWindowOnly`: uiautomator's), else absent: `screenAlone` where the
   * window manager said the window is the app's screen alone (`windowAlone`, window-mark.ts), else `mayHide` — the
   * window may be a sheet or a dialog hiding the screen beneath.
   */
  readonly activeWindow?: ActiveWindow;
  /**
   * The source JUDGED presented layers itself (`presentationsJudged`: WDA's, on a payload carrying the visibility
   * flags), so a layer it did not mark presented is none, and no presented screen is inferred from shape.
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
    cutsAtScreen: tree.boundsCutAtScreen === true,
    cutsAtLater: ancestry && !framesUnclipped,
    padsTouchTargets: tree.paddedTouchTargets === true,
    ...(!ancestry && { topLayerOnly: 'idb' as const }),
    ...(tree.activeWindowOnly === true && { activeWindow: tree.windowAlone === true ? ('screenAlone' as const) : ('mayHide' as const) }),
    judgesPresentations: tree.presentationsJudged === true,
  };
}
