import type { Point, Rect, UiNode } from '../adapters/types.js';
import { containsPoint, coverText, nodeText, type Edge, type QuotedNode } from './geometry.js';

/**
 * A COVER: one node drawn over a target — as the draw order found it (draw-order.ts#DrawOrder.exposure), or, where it
 * found none, as the tree's source shows it only by the cut it left at the target's edge (`overlaidCover`) — the one
 * record every reader of a target's covers asks, instead of a list per tag joined by membership. draw-order.ts builds
 * the found ones, standing.ts the overlaid one; the standing carries them (standing.ts#StandingFacts.covers) and names
 * the one it judged the target under by its record (standing.ts#Standing's and #PixelStanding's `covered`, the tap's
 * `moved`); the tap, `scroll_until` and the pixel assert read them. This module owns the record, its few queries and
 * how a sentence says it (`coverClause`).
 *
 * - `reach`: where it presses over the target — its rect, a pinned bar's reach run down to the screen's bottom, a
 *   floating tab bar's item raised by its bar's lift, or the whole screen for a presented layer's cover
 *   (draw-order.ts#Exposure.covers). What the target's `shows`, `largest` and `coverAtPoint` are judged against.
 * - `order`: what the tree tells of its order against the target (`CoverOrder`) — what a sentence names it as.
 * - `presented`: it is the SURFACE of a screen presented over the target's own (presentation.ts#PresentedOver: a
 *   dimming leaf, a sheet's form by shape, a marked presented layer's cover or a node of a marked `screen` layer) — no
 *   scroll moves the target out from under it (standing.ts#Remedy's `presented`). A flag beside the order, not an
 *   order of its own: it is asked of every cover, the order of the reading-order peers alone, and nothing keeps one
 *   node from being both; the remedy asks `presented` first, the sentence asks the order.
 */
export interface Cover {
  readonly node: UiNode;
  readonly reach: Rect;
  readonly order: CoverOrder;
  readonly presented: boolean;
}

/**
 * What the tree tells of a cover's order against the target — the sentence's choice (`coverClause`), and the remedy's
 * for an order the listing does not give (standing.ts#Remedy's `unordered` and `seenOver`):
 * - `drawn`: drawn over it by the draw order — listed after it, a floating tab bar's item, a presented layer's cover;
 * - `untold`: one of the two controls of a run listed in READING order (`UiNode.readingOrder`) that overlap it, which
 *   of the two is on top not told (draw-order.ts#readingOrderPeers' `unordered`);
 *   docs/bugs/2026-10-16-lab-ios-swiftui-menu-row-listed-in-reading-order-reads-covered-by-the-row-beneath.md
 * - `seenOver`: such a peer whose order a screenshot told, seen drawn over it (ui-tree/seen-order.ts);
 *   docs/adr/0024-the-eyes-tell-the-order-of-two-controls-listed-in-reading-order.md
 * - `overlaid`: drawn after it, laid flush across its top or bottom `edge`, where the tree's source cut its bounds
 *   (standing.ts#OverlaidEdge, Compose's dialect) — known by that cut alone, so a sentence says how far the target may
 *   run on under it is not told, never how much of it shows. Made only where the draw order found no cover (the
 *   `fully` stop and the pixel assert, `overlaidCover`), so no node is both found and overlaid for one judgement.
 *   docs/bugs/2026-10-16-lab-android-fully-calls-a-row-under-a-pinned-button-fully-visible.md
 */
export type CoverOrder =
  | { readonly kind: 'drawn' }
  | { readonly kind: 'untold' }
  | { readonly kind: 'seenOver' }
  | { readonly kind: 'overlaid'; readonly edge: 'top' | 'bottom' };

/** The cover the tree shows only by the cut at the target's `edge` (`CoverOrder`'s `overlaid`): `by`, pressing where it lies, the surface of no presented screen. */
export const overlaidCover = (by: UiNode, edge: 'top' | 'bottom'): Cover => ({ node: by, reach: { ...by.rect }, order: { kind: 'overlaid', edge }, presented: false });

/** The cover drawn on top at `point` — the last of `covers` whose reach contains it — or undefined. */
export const coverAtPoint = (covers: readonly Cover[], point: Point): Cover | undefined => covers.filter((c) => containsPoint(c.reach, point)).at(-1);

/** The last of `covers` that is the surface of a screen presented over the target (`Cover.presented`), or undefined. */
export const lastPresented = (covers: readonly Cover[]): Cover | undefined => covers.filter((c) => c.presented).at(-1);

/**
 * The two GRAMMARS a cover is said in (`coverClause`):
 * - `touch` — the target the subject, the clause what it lies under: the tap's refusal and move
 *   (interact/tap-judgement.ts) and `scroll_until`'s covered sentences (interact/scroll-text.ts); `centre` given, the
 *   cover is said to lie over the target's centre there (the point a tap presses).
 * - `pixel` — the cover the subject (`<cover> <clause>`), the pixel assert's covered miss (verify/pixel-poll.ts): `at`
 *   the element's parenthetical as that sentence quotes it (`(element 51,470 300x64)`).
 */
export type CoverGrammar = { readonly of: 'touch'; readonly centre?: Point } | { readonly of: 'pixel'; readonly at: string };

/**
 * THE one choice of how a sentence says `cover` lies over the target — one case per order (`CoverOrder`), in each
 * grammar (`CoverGrammar`):
 * - `overlaid`: cut at that edge by it, which may run on under it (`cutAtLaterText`) — `meets the element's bottom
 *   edge (…), drawn after it — …` in the pixel's;
 * - `untold`: overlapping it, which is drawn on top not told (`ORDER_UNTOLD`);
 * - `seenOver`: drawn over it, as a screenshot shows (`SEEN_OVER`);
 * - `drawn`: drawn over it — `under <cover> at its centre (x,y), drawn over it` in the touch's.
 * A cover has one order, so the precedence the separate lists once needed (overlaid, then untold, then seen over,
 * then drawn) is the record's: the overlaid cover is made only where no other was found.
 */
export function coverClause(cover: Cover, grammar: CoverGrammar): string {
  const { node, reach, order } = cover;
  const atCentre = grammar.of === 'touch' && grammar.centre !== undefined ? ` at its centre (${grammar.centre.x},${grammar.centre.y})` : '';
  const element = grammar.of === 'pixel' ? `the element ${grammar.at}` : 'it';
  switch (order.kind) {
    case 'overlaid':
      return grammar.of === 'touch'
        ? cutAtLaterText(order.edge, node)
        : `meets the element's ${order.edge} edge ${grammar.at}, drawn after it — ${mayRunOnUnderText(node, 'the element')}`;
    case 'untold':
      return grammar.of === 'touch' ? `overlapped by ${coverText(node, reach)}${atCentre}, ${ORDER_UNTOLD}` : `overlaps ${element}, ${ORDER_UNTOLD}`;
    case 'seenOver':
      return grammar.of === 'touch' ? `under ${coverText(node, reach)}${atCentre}, drawn over it ${SEEN_OVER}` : `is drawn over ${element} ${SEEN_OVER}`;
    case 'drawn':
      return grammar.of === 'touch' ? `under ${coverText(node, reach)}${atCentre}, drawn over it` : `is drawn over ${element}`;
    default: {
      const unhandled: never = order;
      return unhandled;
    }
  }
}

/**
 * How a sentence says a node was cut at `edge` by `by`, drawn after it (`mayRunOnUnderText`): `cut at its bottom edge by
 * button id:lab.pinned-bar.continue (66,1956 948x154), drawn after it — the dump (Compose's, on Android) leaves out of a
 * node's bounds what a later node covers, so the rest of it may lie under that button`. The head of the sliver's
 * sentence (interact/target-text.ts#cutSliverText) and the touch grammar's clause for an overlaid cover (`coverClause`).
 */
export const cutAtLaterText = (edge: Edge, by: QuotedNode): string => `cut at its ${edge} edge by ${nodeText(by)}, drawn after it — ${mayRunOnUnderText(by, 'it')}`;

/**
 * THE one clause for a node the tree's source cut at a node drawn after it (Compose's dialect): `the dump (Compose's,
 * on Android) leaves out of a node's bounds what a later node covers, so the rest of it may lie under that button` —
 * `what` the node as its sentence names it (`it`, or `the element` in the pixel grammar, whose subject is the cover).
 * "May": the dump cannot say how far, nor tell a cut from a node that ends there. Said wherever that cut is the
 * evidence: a sliver cut by a later node (`cutAtLaterText`), and an overlaid cover (`coverClause`).
 */
const mayRunOnUnderText = (by: QuotedNode, what: 'it' | 'the element'): string =>
  `the dump (Compose's, on Android) leaves out of a node's bounds what a later node covers, so the rest of ${what} may lie under that ${by.role}`;

/** Why a cover whose order is `seenOver` is said to be drawn over the target though the tree does not order the two. */
const SEEN_OVER = 'as a screenshot shows (the two are listed in reading order)';

/** Why a cover whose order is `untold` is not said to be drawn over the target. */
const ORDER_UNTOLD = 'the two listed in reading order: which is drawn on top is not told';
