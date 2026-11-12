import { everyNode, type Rect, type UiNode } from './types.js';

/**
 * AOSP's ACCESSIBILITY ORDER of a classic ViewGroup's children, read off the dumped bounds: the stripe comparator of
 * `ViewGroup.ViewLocationHolder.compareBoundsOfTree` (COMPARISON_STRATEGY_STRIPE), which `ChildListForAccessibility`
 * sorts the children by before they are handed to accessibility (`ViewGroup.addChildrenForAccessibility`,
 * `onInitializeAccessibilityNodeInfoInternal`; android-36 sources, ViewGroup.java ~2477, ~9195–9227, ~9308–9355) —
 * so uiautomator lists them by LOCATION, not in the order they are drawn. Negative: `a` is listed first; positive: `b`;
 * 0: a tie the dump cannot break.
 * - `a` wholly above `b` (its bottom at or above `b`'s top) is first, and wholly below it last;
 * - in one STRIPE (their vertical extents overlap) the left edge decides — before the top: rn-banner's C.cover
 *   (left 73, top 1321) is listed before C (left 128, top 1293), though it starts lower;
 * - then the higher top, then the TALLER, then the WIDER;
 * - AOSP breaks what is left by the children's bounds and the accessibility id, which the dump does not give: a tie.
 * LEFT-TO-RIGHT is assumed: AOSP compares right edges (the larger first) under a right-to-left layout direction, which
 * the dump does not name — a right-to-left run sorted so reads out of order here.
 * docs/bugs/2026-11-09-lab-android-uiautomator-lists-a-react-native-cover-before-its-target-so-it-is-tapped-and-measured.md
 */
export function compareByLocation(a: Rect, b: Rect): number {
  if (a.y + a.height - b.y <= 0) return -1;
  if (a.y - (b.y + b.height) >= 0) return 1;
  return a.x - b.x || a.y - b.y || b.height - a.height || b.width - a.width;
}

/**
 * Marks every node whose two or more children are listed in LOCATION order — each child compares at or before the
 * next (`compareByLocation`) — as listed in reading order (UiNode.readingOrder), so the reading-order rules
 * (ui-tree/reading-order.ts: a sibling listed before a target that draws there is a cover whose order the eyes tell;
 * placed.ts's named leaf drawn) judge its overlapping children, not "listed later is drawn over". A SORT CHECK, as the
 * WDA parser's (wda-source.ts#markWdaDialect): a run of classic Views passes it, AOSP having sorted it so — unless the
 * dump cut a child's bounds (a scroll view's clip, the screen's edge) where AOSP sorted on its whole drawing rect; such a
 * run, and any run listed so by chance, is judged as the dump lists it. Never a node in `provided` — the nodes whose
 * children a node provider lists (android-tree-dialect.ts#providesNodes: Compose's, under a plain View with no
 * ViewGroup child), in its own order, not AOSP's sort (AOSP sorts only a ViewGroup with no provider,
 * `addChildrenForAccessibility`): Compose lists
 * its semantics children in composition order — scroll-sticky's R before the header drawn over it, form-shared-id's
 * field before the label drawn over its outline, which happens to be location order — so its order is kept as draw
 * order. Returns `tree`. docs/adr/0015-flat-list-reading-order-break.md (its amendment "Android Views list children by
 * location")
 */
export function markLocationSorted<T extends UiNode>(tree: T, provided: ReadonlySet<UiNode>): T {
  for (const node of everyNode(tree)) {
    if (provided.has(node)) continue;
    const kids = node.children;
    if (kids.length >= 2 && kids.every((child, i) => i === 0 || compareByLocation(kids[i - 1].rect, child.rect) <= 0)) node.readingOrder = true;
  }
  return tree;
}
