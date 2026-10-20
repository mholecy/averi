import { sameRectWithinPixel, type UiNode } from '../adapters/types.js';
import { containsPoint, overlapsPastSlack, rectWithin } from './geometry.js';
import type { Placed } from './placed.js';
import { isInteractive, tapPoint } from './selectors.js';
import type { SeenOrder } from './seen-order.js';

/**
 * READING ORDER: what a listing given in reading order — not in draw order — says of a target's order against its
 * siblings (`readingOrderOf`). iOS's accessibility lists a SwiftUI container's elements by their tops
 * (`UiNode.readingOrder`: idb's flat list, a WDA run sorted by top), so a node drawn on top may be listed BEFORE the
 * node it is drawn over, and the draw order's rule "listed later = drawn later" (draw-order.ts#DrawOrder's doc) does
 * not hold there. This module is the one owner of "listed before, but drawn over" in such a listing: which siblings
 * listed before a target cover it — a heading (`headingsOver`: drawn over it, SwiftUI's pinned section header) or a
 * control whose order against it the listing does not tell (`peersOf`) — which covers' order is not told, and which
 * siblings a moved tap must keep clear of. draw-order.ts#DrawOrder.exposure asks it once per target and joins its answer to the draw order's own
 * covers; it knows nothing of rows, presented layers or reaches.
 * docs/adr/0015-flat-list-reading-order-break.md (its amendments, "covers listed before the target" and "a heading
 * listed before")
 * docs/adr/0024-the-eyes-tell-the-order-of-two-controls-listed-in-reading-order.md
 */

/**
 * What a target's reading order is judged against: the target at its first place in the walk, whether the tree is a
 * flat list (`UiNode.flatList` on its root), where a flat list's content starts (`contentFrom`: the nodes before it
 * are its top bar, ADR 0004) and its bottom chrome (`bottomChrome`: the nodes pinned at its bottom, idb's keyboard and
 * a floating tab bar's items) — draw-order.ts's facts of the tree, handed in.
 */
export interface ReadingOrderAbout {
  readonly target: Placed;
  readonly flatList: boolean;
  readonly contentFrom: number;
  readonly bottomChrome: ReadonlySet<Placed>;
}

/**
 * Whether the tree's source lists `parent`'s children in READING order (`UiNode.readingOrder`: idb's flat list, a WDA
 * run sorted by top), not in draw order — the third reader of the tree's dialect (draw-order.ts#listsAncestry's doc), and the one outside draw order, asked by
 * `readingOrderOf` alone.
 */
function listsInReadingOrder(parent: UiNode): boolean {
  return parent.readingOrder === true;
}

/**
 * What a listing given in reading order says of a target's order against its siblings (`readingOrderOf`):
 * - `before`: the siblings listed BEFORE it that are drawn over it — covers the draw order alone would not give: the
 *   headings over it (`headingsOver`, their order `drawn`) and the controls whose order is not told (`peersOf`'s
 *   `before`); in the walk's order;
 * - `unordered`, `seenOver`, `seenUnder`, `listedBefore`: of the controls whose order is not told (`peersOf`, its doc
 *   says each) — a heading is none of them.
 */
export interface ReadingOrder {
  readonly before: readonly Placed[];
  readonly unordered: ReadonlySet<Placed>;
  readonly seenOver: ReadonlySet<Placed>;
  /** The peers a screenshot saw drawn UNDER the target: no covers of it, wherever listed (`seen`). */
  readonly seenUnder: ReadonlySet<Placed>;
  readonly listedBefore: readonly Placed[];
}

const NONE: ReadingOrder = { before: [], unordered: new Set<Placed>(), seenOver: new Set<Placed>(), seenUnder: new Set<Placed>(), listedBefore: [] };

/**
 * What the listing of `about.target`'s parent says of the target's order against its siblings (`ReadingOrder`) —
 * nothing unless that listing is given in reading order (`listsInReadingOrder`), and nothing for a target PINNED at the
 * screen's bottom (`pinnedTargets`): a pinned bar is drawn over what scrolls under it, listed before it or not (the
 * pinned-bar cell's Continue, idb and WDA). Two kinds of sibling listed before it are drawn over it: a heading
 * (`headingsOver`), and a control whose order is not told (`peersOf`). The order SEEN (`seen`, ui-tree/seen-order.ts)
 * tells the second kind only.
 */
export function readingOrderOf(
  order: readonly Placed[],
  about: ReadingOrderAbout,
  pinnedTargets: () => ReadonlyMap<Placed, number>,
  seen: SeenOrder | undefined,
): ReadingOrder {
  const { target } = about;
  if (target.parent === undefined || !listsInReadingOrder(target.parent.node)) return NONE;
  const headings = headingsOver(order, target);
  const peers = peersOf(order, about, pinnedTargets, seen, new Set(headings));
  if ((headings.length === 0 && peers === NONE) || pinnedTargets().has(target)) return NONE;
  return { ...peers, before: [...headings, ...peers.before].sort((a, b) => a.at - b.at) };
}

/** Whether `p` overlaps `target` past geometry.ts#PIXEL_OVERLAP_SLACK, neither holding the other whole nor of its frame (a node's own wrapper, its own title, its own content). */
function overlapsApart(p: Placed, target: Placed): boolean {
  const [a, t] = [p.node.rect, target.node.rect];
  return overlapsPastSlack(a, t) && !rectWithin(t, a) && !rectWithin(a, t) && !sameRectWithinPixel(a, t);
}

/**
 * A HEADING LISTED BEFORE: the target's siblings the source marks a heading (`UiNode.heading`, the Header trait)
 * listed BEFORE it that overlap it apart (`overlapsApart`) — drawn over it, their order told (cover.ts#CoverOrder's
 * `drawn`). SwiftUI lists a section's header first and pins it (`LazyVStack(pinnedViews: [.sectionHeaders])`) over
 * the rows scrolled under it, drawn on top: the lab's scroll-sticky, header `0,110 402x56` listed before R
 * `51,142 300x64`, whose top 24 pt it hides (62.5 % of R drawn), in idb's flat list and in WDA's run alike. A row is
 * never drawn over its section's header, so no order is left untold and no screenshot is asked. Unlike a control
 * peer, no gate on what it overlaps: not only over the target's centre (a pinned header hides a row's top, the centre
 * still clear — what the colour assert samples and `fully` claims), not only a control (a heading is text), and in
 * idb's flat list before its content too (idb reads the header at the list's top as top-bar chrome, ADR 0004).
 * A heading listed AFTER the target is drawn over it by the draw order already.
 * docs/bugs/2026-10-16-lab-ios-pinned-section-header-is-no-cover-of-the-row-beneath.md
 */
function headingsOver(order: readonly Placed[], target: Placed): Placed[] {
  return order.slice(0, target.at).filter((p) => p.parent === target.parent && p.node.heading === true && overlapsApart(p, target));
}

/**
 * The controls whose ORDER against a control target a listing given in reading order does not tell
 * (`listsInReadingOrder` of the target's parent, `about.target`): its siblings that are interactive and overlap it past
 * geometry.ts#PIXEL_OVERLAP_SLACK, neither holding the other whole nor of its frame (a control's own wrapper, its own
 * title) — in idb's flat list from its content on (`contentFrom`: the top bar's are chrome before content, ADR 0004)
 * and none of its bottom chrome (`bottomChrome`: a tab bar's items are covers by their own rule), nor, on a nested
 * tree, a control pinned at the screen's bottom (`pinnedTargets`). Such a listing does not tell which of two
 * overlapping controls is drawn on top, so each is a cover of the other whose order is not told (cover.ts#CoverOrder's `untold`):
 * - `before`: the ones listed BEFORE the target, when one of them holds its centre (`tapPoint`) — covers the draw
 *   order alone would not give. Measured: the lab's in-screen menu, idb and WDA (`A 110, B 290, K 380, W 448, C 470, D 650`): W, drawn
 *   on top by `zIndex`, is listed before C, whose centre (201,502) lies on W — read clear, C was `Tapped` there and the
 *   tap fired W; mp-native's payment-type chooser (ADR 0015's capture), `Loan repayment` listed after the card's
 *   `To my account` and `SWIFT payment` rows it lies under (SWIFT payment over its centre). Only when one holds the
 *   centre: siblings that only overlap the target's edges by a few points (a card's shadow, an avatar stack, a badge)
 *   would else fail its colour assert and every `fully` stop on a cover that may lie beneath it.
 * - `unordered`: those, and the ones listed AFTER it that hold its centre (which the draw order already gives as covers):
 *   W, under C listed after it, is refused naming C as overlapping it, its order not told — not as drawn over it, with
 *   a scroll advised. Only over the centre: a floating control listed after a row that only pokes over its edge (a FAB
 *   in idb's flat list, not pinned by shape) keeps its draw order's remedy, a scroll.
 * - `listedBefore`: every one listed before it, cover or not — where a tap moved off a covered centre may not be aimed
 *   (`exposure`'s `tapAt`): W `51,690 300x40` listed before C `51,700 300x120` under a pinned
 *   Continue `0,740`, had C's tap moved to (201,720), on W.
 * A peer held whole by the target, or holding it whole, is no peer: before or after, it is the control's own wrapper or
 * its own content (the draw order's own-content rule excuses the latter listed after it, `ownContentOf`).
 * A heading listed before it is none (`headings`): it is drawn over it (`headingsOver`).
 * docs/bugs/2026-10-16-lab-ios-swiftui-menu-row-listed-in-reading-order-reads-covered-by-the-row-beneath.md
 *
 * …and THE ORDER SEEN (`seen`, ui-tree/seen-order.ts): a peer a screenshot saw drawn UNDER the target is no peer — not
 * in `before`, `unordered` or `listedBefore`, and, listed after it, no cover by the draw order either (`seenUnder`: the
 * screenshot overrides the listing for exactly that pair): the lab's W, seen over C. A peer seen OVER it stays the
 * cover the listing made it, named `seenOver` instead of `unordered`: C, under W. An untold pair is as with no
 * screenshot.
 */
function peersOf(
  order: readonly Placed[],
  about: ReadingOrderAbout,
  pinnedTargets: () => ReadonlyMap<Placed, number>,
  seen: SeenOrder | undefined,
  headings: ReadonlySet<Placed>,
): ReadingOrder {
  const { target, flatList, contentFrom, bottomChrome } = about;
  const t = target.node;
  if (!isInteractive(t) || (flatList && target.at < contentFrom)) return NONE;
  const peers = order.filter(
    (p) =>
      p !== target &&
      p.parent === target.parent &&
      !headings.has(p) &&
      (flatList ? p.at >= contentFrom && !bottomChrome.has(p) : !pinnedTargets().has(p)) &&
      isInteractive(p.node) &&
      overlapsApart(p, target),
  );
  if (peers.length === 0) return NONE;
  const centre = tapPoint(t);
  const holdsCentre = (p: Placed): boolean => containsPoint(p.node.rect, centre);
  // What a screenshot saw of the PEER against the target: drawn over it (`over`), or under it — no peer then.
  const peerSeen = (p: Placed): 'over' | 'under' | undefined => {
    const pair = seen?.between(p.node, t);
    return pair === undefined || pair.seen === 'untold' ? undefined : pair.seen;
  };
  const overIt = (p: Placed): boolean => peerSeen(p) === 'over';
  const kept = peers.filter((p) => peerSeen(p) !== 'under');
  const listedBefore = kept.filter((p) => p.at < target.at);
  const before = listedBefore.some(holdsCentre) ? listedBefore : [];
  const overlapping = [...before, ...kept.filter((p) => p.at > target.at && holdsCentre(p))];
  return {
    before,
    unordered: new Set(overlapping.filter((p) => !overIt(p))),
    seenOver: new Set(overlapping.filter(overIt)),
    seenUnder: new Set(peers.filter((p) => peerSeen(p) === 'under')),
    listedBefore,
  };
}
