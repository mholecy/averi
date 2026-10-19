import type { UiNode } from '../adapters/types.js';

/**
 * THE ORDER SEEN: what one screenshot showed of two controls a listing in READING order does not order — which of the
 * two is drawn on top in their overlap (draw-order.ts#Exposure.unordered; docs/adr/0015-flat-list-reading-order-break.md,
 * amended). The eyes' second question answers it (ui-tree/eyes.ts#Eyes.order, judged by verify/eyes.ts#judgeOrder);
 * this module holds the answer as the draw order takes it — an INPUT of the pure draw order
 * (draw-order.ts#drawOrder's `seen`), so the draw order stays synchronous and replayable, and a tree-only caller, which
 * hands in none, keeps the listing's untold order.
 *
 * Why: SwiftUI lists a container's elements in reading order, by their tops — the lab's menu row W (`51,448 300x64`,
 * drawn on top by `zIndex`) listed before the row C (`51,470`) it is drawn over. The tree has no tell of which is on
 * top; the screenshot has: W's colour fills the overlap and W's own clear band, C's band beside it is another colour.
 * docs/bugs/2026-10-16-lab-ios-swiftui-menu-row-listed-in-reading-order-reads-covered-by-the-row-beneath.md
 * docs/adr/0024-the-eyes-tell-the-order-of-two-controls-listed-in-reading-order.md
 */

/**
 * What the screenshot showed of a node against ONE peer it overlaps, from the node's side:
 * - `over`: the node is drawn over the peer — the overlap shows the node's own colour (`own`), not the peer's (`other`);
 * - `under`: the peer is drawn over the node — the overlap shows the peer's colour;
 * - `untold`: the screenshot could not tell (`why`: the two look alike, a band shows the screen's own colour, no
 *   screenshot…) — the listing's untold order stands, and the sentence says why.
 * The colours are hexes, as the sentences and tests quote them.
 */
export type PairSeen =
  | { readonly seen: 'over' | 'under'; readonly overlap: string; readonly own: string; readonly other: string }
  | { readonly seen: 'untold'; readonly why: string };

/** One answer of the eyes' order question: the peer, and what was seen of the node against it (`PairSeen`). */
export type OrderSeen = { readonly peer: UiNode } & PairSeen;

/** The order seen, as the draw order asks it: what was seen of `node` against `other`, from `node`'s side — undefined for a pair not looked at. */
export interface SeenOrder {
  between(node: UiNode, other: UiNode): PairSeen | undefined;
}

/** `seen` (the eyes' answers about `node`, one per peer) as the draw order asks it — either way round, by node identity of ONE tree. */
export function seenOrderOf(node: UiNode, seen: readonly OrderSeen[]): SeenOrder {
  return {
    between(a, b) {
      if (a === node) return withoutPeer(seen.find((s) => s.peer === b));
      if (b === node) return flipped(withoutPeer(seen.find((s) => s.peer === a)));
      return undefined;
    },
  };
}

const withoutPeer = (s: OrderSeen | undefined): PairSeen | undefined => {
  if (s === undefined) return undefined;
  if (s.seen === 'untold') return { seen: 'untold', why: s.why };
  return { seen: s.seen, overlap: s.overlap, own: s.own, other: s.other };
};

/** What was seen of a pair, from the other side. */
const flipped = (s: PairSeen | undefined): PairSeen | undefined =>
  s === undefined || s.seen === 'untold' ? s : { seen: s.seen === 'over' ? 'under' : 'over', overlap: s.overlap, own: s.other, other: s.own };
