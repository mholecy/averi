import { sameRectWithinPixel, type UiNode } from '../adapters/types.js';
import { containsPoint, overlapsPastSlack, rectWithin } from './geometry.js';
import type { Placed } from './placed.js';
import { isInteractive, tapPoint } from './selectors.js';
import type { SeenOrder } from './seen-order.js';

/**
 * READING ORDER: what a listing given in reading order — not in draw order — says of a target's order against its
 * siblings (`readingOrderOf`). iOS's accessibility lists a SwiftUI container's elements by their tops
 * (`UiNode.readingOrder`: idb's flat list, a WDA run sorted by top) — and AOSP lists a classic Android ViewGroup's
 * children by location (a uiautomator run so ordered, lab note LR4) — so a node drawn on top may be listed BEFORE the
 * node it is drawn over, and the draw order's rule "listed later = drawn later" (draw-order.ts#DrawOrder's doc) does
 * not hold there. This module is the one owner of "listed before or after, but drawn over or under" in such a
 * listing: which siblings cover a target — a heading listed before it (`headingsOver`: drawn over it, SwiftUI's
 * pinned section header), a control whose order against it the listing does not tell (`peersOf`), or, in a nested run
 * (`listsNestedReadingOrder`: WDA's, uiautomator's classic run), any sibling listed before or after it that draws
 * there, whose order is not told either (React Native's covers, lab note LR3; a sibling listed after, D84) — which
 * covers' order is not told, which siblings a moved tap must keep clear of, and which controls listed AFTER it stay
 * covers past the draw order's reading-order break (`coversAfter`). draw-order.ts#drawOrder's `asTarget` asks it once
 * for every question of a target (`SeenFor.readingOrder`): `exposure` joins its covers to the draw order's own, the
 * break's row (`NOT_DRAWN.flatListReadingOrder`) reads `coversAfter`; it knows nothing of rows, presented layers or
 * reaches.
 * docs/adr/0015-flat-list-reading-order-break.md (its amendments, "covers listed before the target", "a heading
 * listed before", "a control past the break that holds the centre", "React Native's covers listed before the
 * target" and "D84 — a sibling listed after the target, of any kind")
 * docs/adr/0024-the-eyes-tell-the-order-of-two-controls-listed-in-reading-order.md
 */

/**
 * What a target's reading order is judged against: the target at its first place in the walk, whether the tree is a
 * flat list (`ancestry`, dialect.ts#TreeDialect: false on one), where a flat list's content starts (`contentFrom`: the nodes before it
 * are its top bar, ADR 0004) and its bottom chrome (`bottomChrome`: the nodes pinned at its bottom, idb's keyboard and
 * a floating tab bar's items) — draw-order.ts's facts of the tree, handed in.
 */
export interface ReadingOrderAbout {
  readonly target: Placed;
  readonly ancestry: boolean;
  readonly contentFrom: number;
  readonly bottomChrome: ReadonlySet<Placed>;
  /**
   * Whether a sibling, listed before or after the target, draws over it — the draw order's `target` column
   * (draw-order.ts#NOT_DRAWN) but its own-content row, the field's own floating label excused (ADR 0014's relation,
   * draw-order.ts#ownLabelOf) — asked of the siblings `peersOf` takes past the controls, in a nested run in reading
   * order only.
   */
  readonly drawn: (p: Placed) => boolean;
}

/**
 * Whether the tree's source lists `parent`'s children in READING order (`UiNode.readingOrder`: idb's flat list, a WDA
 * run sorted by top), not in draw order — a mark of the node, not of the tree's root (those are ui-tree/dialect.ts's),
 * asked in this module alone.
 */
function listsInReadingOrder(parent: UiNode): boolean {
  return parent.readingOrder === true;
}

/**
 * Whether `parent` lists its children in reading order in a NESTED tree (`listsInReadingOrder`, and no flat list): WDA's
 * run sorted by top, or uiautomator's classic run in AOSP's location order (lab note LR4) — where a sibling listed before a target may be drawn over it whatever it is (`peersOf`), and a
 * childless node the app named is drawn unless it wraps a sibling (placed.ts#FRAME_EXCUSES `structural`: React
 * Native's flattened views). Only on a tree with `ancestry` (the caller's, dialect.ts#TreeDialect): not idb's flat
 * list, whose listing is its own (ADR 0015).
 */
export function listsNestedReadingOrder(parent: Placed, ancestry: boolean): boolean {
  return ancestry && listsInReadingOrder(parent.node);
}

/**
 * What a listing given in reading order says of a target's order against its siblings (`readingOrderOf`):
 * - `before`: the siblings listed BEFORE it that are drawn over it — covers the draw order alone would not give: the
 *   headings over it (`headingsOver`, their order `drawn`) and the controls whose order is not told (`peersOf`'s
 *   `before`); in the walk's order;
 * - `unordered`, `seenOver`, `seenUnder`, `listedBefore`, `coversAfter`: of the controls whose order is not told
 *   (`peersOf`, its doc says each) — a heading is none of them.
 */
export interface ReadingOrder {
  readonly before: readonly Placed[];
  readonly unordered: ReadonlySet<Placed>;
  readonly seenOver: ReadonlySet<Placed>;
  /** The peers a screenshot saw drawn UNDER the target: no covers of it, wherever listed (`seen`). */
  readonly seenUnder: ReadonlySet<Placed>;
  readonly listedBefore: readonly Placed[];
  /**
   * The controls listed AFTER the target that hold its centre and are not seen under it — the part of `unordered` ∪
   * `seenOver` listed after it, named for the one reader that needs them apart: covers whatever the draw order's reading-order break says of them (draw-order.ts#NOT_DRAWN's `flatListReadingOrder`
   * excuses none of these).
   */
  readonly coversAfter: ReadonlySet<Placed>;
}

/** What a listing that tells the order says: nothing (`readingOrderOf` of a target whose parent lists in draw order). */
export const NO_READING_ORDER: ReadingOrder = {
  before: [],
  unordered: new Set<Placed>(),
  seenOver: new Set<Placed>(),
  seenUnder: new Set<Placed>(),
  listedBefore: [],
  coversAfter: new Set<Placed>(),
};

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
  if (target.parent === undefined || !listsInReadingOrder(target.parent.node)) return NO_READING_ORDER;
  const headings = headingsOver(order, target);
  const peers = peersOf(order, about, pinnedTargets, seen, new Set(headings));
  if ((headings.length === 0 && peers === NO_READING_ORDER) || pinnedTargets().has(target)) return NO_READING_ORDER;
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
 * The siblings whose ORDER against a target a listing given in reading order does not tell — two controls, as below;
 * and, in a nested run (`listsNestedReadingOrder`), any sibling listed before OR AFTER a target of any kind that draws
 * there (`ReadingOrderAbout.drawn`: the draw order's rows but its own-content one, a field's own floating label
 * excused), which then follows the same `before` / `unordered` / `seenOver` / `listedBefore` rules (lab note LR3;
 * listed after, backlog D84: the lab's views-drawn-over, ADR 0015's D84 amendment). The rest of this doc is the
 * controls'. The controls whose ORDER against a control target a listing given in reading order does not tell
 * (`listsInReadingOrder` of the target's parent, `about.target`): its siblings that are interactive and overlap it past
 * geometry.ts#PIXEL_OVERLAP_SLACK, neither holding the other whole nor of its frame (a control's own wrapper, its own
 * title) — in idb's flat list from its content on (`contentFrom`: the top bar's are chrome before content, ADR 0004)
 * and none of its bottom chrome (`bottomChrome`: a tab bar's items are covers by their own rule), nor, on a nested
 * tree, a control pinned at the screen's bottom (`pinnedTargets`); a target that is itself a flat list's bottom chrome
 * has none (a floating tab bar's items are drawn over what lies under them, tabbar-dense's `Row 8` under `cards`). Such a listing does not tell which of two
 * overlapping controls is drawn on top, so each is a cover of the other whose order is not told (cover.ts#CoverOrder's `untold`):
 * - `before`: the ones listed BEFORE the target, when one of them holds its centre (`tapPoint`) — covers the draw
 *   order alone would not give. Measured: the lab's in-screen menu, idb and WDA (`A 110, B 290, K 380, W 448, C 470, D 650`): W, drawn
 *   on top by `zIndex`, is listed before C, whose centre (201,502) lies on W — read clear, C was `Tapped` there and the
 *   tap fired W; mp-native's payment-type chooser (ADR 0015's capture), `Loan repayment` listed after the card's
 *   `To my account` and `SWIFT payment` rows it lies under (SWIFT payment over its centre). Only when one holds the
 *   centre: siblings that only overlap the target's edges by a few points (a card's shadow, an avatar stack, a badge)
 *   would else fail its colour assert and every `fully` stop on a cover that may lie beneath it.
 * - `unordered`: those, and the ones listed AFTER it that hold its centre: W, under C listed after it, is refused
 *   naming C as overlapping it, its order not told — not as drawn over it, with a scroll advised. Only over the
 *   centre: a floating control listed after a row that only pokes over its edge (a FAB in idb's flat list, not pinned
 *   by shape) keeps its draw order's remedy, a scroll.
 * - `coversAfter`: the ones listed AFTER it that hold its centre, `unordered` or `seenOver` — covers even past the draw
 *   order's reading-order break (draw-order.ts#NOT_DRAWN's `flatListReadingOrder`), which would else excuse them: idb
 *   lists no scroll view, so a row past its scroll view's clip is listed before the control just under the clip whose
 *   top lies above the row's (scroll-bounded-footer: O `51,620 300x64` listed before `Continue 16,600 370x56`, which
 *   holds its centre) — the break read O as drawn over Continue, and `tap O` pressed Continue. The listing cannot tell
 *   that shape from a modal's row listed before the list row it is drawn over (mp-native's chooser: `SWIFT payment`
 *   before `Loan repayment`, which holds its centre), so both are untold and the eyes tell them (ADR 0024).
 *   docs/bugs/2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md
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
 * screenshot overrides the listing for exactly that pair; only a peer in play as a cover — one listed after it that
 * holds no part of its centre stays the draw order's, D84): the lab's W, seen over C. A peer seen OVER it stays the
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
  const { target, ancestry, contentFrom, bottomChrome, drawn } = about;
  const t = target.node;
  if (!ancestry && (target.at < contentFrom || bottomChrome.has(target))) return NO_READING_ORDER;
  // A control's peers are controls, either side of it. In a NESTED run in reading order (`listsNestedReadingOrder`:
  // WDA's run sorted by top, SwiftUI's, UIKit's and React Native's alike, uiautomator's classic run in location order —
  // not idb's flat list) a sibling that draws over the target (`drawn`: the draw order's `target` column but its
  // own-content row, a field's own floating label excused) is a peer too, control or not, of any target, LISTED EITHER
  // SIDE of it: such a run lists by place, not by drawing. Listed before: React Native's covers (lab note LR3: WDA
  // lists a later sibling drawn over the target by its top, above the target's). Listed after (D84): it may lie UNDER
  // the target (the lab's views-drawn-over). Either way untold: held to `after`'s centre gate below, refused with no
  // screenshot, lifted only where the eyes see the target on top (verify/eyes.ts#judgeOrder). Its own-content excuse
  // still holds in the draw order's covers (draw-order.ts#NOT_DRAWN's `onTarget`). The capture, the guards and the
  // residual (a non-drawing touch layer lifted: ADR 0024's residual 2 widened): ADR 0015's D84 amendment.
  // Not idb's flat list: there a modal is listed before the screen beneath it and its frame (mp-native's value date
  // picker `Value date 56,291 298x375`) over form rows measured clear (tests/verify/assert.test.ts).
  const nested = target.parent !== undefined && listsNestedReadingOrder(target.parent, ancestry);
  const peerOf = (p: Placed): boolean => (isInteractive(t) && isInteractive(p.node)) || (nested && drawn(p));
  const peers = order.filter(
    (p) =>
      p !== target &&
      p.parent === target.parent &&
      !headings.has(p) &&
      (ancestry ? !pinnedTargets().has(p) : p.at >= contentFrom && !bottomChrome.has(p)) &&
      overlapsApart(p, target) &&
      peerOf(p),
  );
  if (peers.length === 0) return NO_READING_ORDER;
  const centre = tapPoint(t);
  const holdsCentre = (p: Placed): boolean => containsPoint(p.node.rect, centre);
  // What a screenshot saw of the PEER against the target: drawn over it (`over`), or under it — no peer then.
  const peerSeen = (p: Placed): 'over' | 'under' | undefined => {
    const pair = seen?.between(p.node, t);
    return pair === undefined || pair.seen === 'untold' || pair.seen === 'clear' ? undefined : pair.seen;
  };
  const overIt = (p: Placed): boolean => peerSeen(p) === 'over';
  const kept = peers.filter((p) => peerSeen(p) !== 'under');
  const listedBefore = kept.filter((p) => p.at < target.at);
  const before = listedBefore.some(holdsCentre) ? listedBefore : [];
  const after = kept.filter((p) => p.at > target.at && holdsCentre(p));
  const overlapping = [...before, ...after];
  // Dropped by what was seen: only a peer in play as a cover — listed before when one listed before holds the centre,
  // listed after when it holds it itself (D84's review: a peer clear of the centre stays the draw order's to judge,
  // whatever a seen order says of it; no question of the target asks about it).
  const listedBeforeAll = peers.filter((p) => p.at < target.at);
  const beforeInPlay = listedBeforeAll.some(holdsCentre) ? listedBeforeAll : [];
  const inPlay = [...beforeInPlay, ...peers.filter((p) => p.at > target.at && holdsCentre(p))];
  return {
    before,
    unordered: new Set(overlapping.filter((p) => !overIt(p))),
    seenOver: new Set(overlapping.filter(overIt)),
    seenUnder: new Set(inPlay.filter((p) => peerSeen(p) === 'under')),
    listedBefore,
    coversAfter: new Set(after),
  };
}
