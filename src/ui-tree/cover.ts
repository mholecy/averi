import type { Point, Rect, UiNode } from '../adapters/types.js';
import { containsPoint } from './geometry.js';

/**
 * A COVER: one node drawn over a target, as the draw order found it (draw-order.ts#DrawOrder.exposure) — the one record
 * every reader of a target's covers asks, instead of a list per tag joined by membership. draw-order.ts builds them;
 * the standing carries them (standing.ts#StandingFacts.covers); the tap, `scroll_until` and the pixel assert read them.
 * This module owns the record and its few queries.
 *
 * - `reach`: where it presses over the target — its rect, a pinned bar's reach run down to the screen's bottom, a
 *   floating tab bar's item raised by its bar's lift, or the whole screen for a presented layer's cover
 *   (draw-order.ts#Exposure.covers). What the target's `shows`, `largest` and `coverAt` are judged against.
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
 * What the tree tells of a cover's order against the target — the sentence's choice (standing.ts#coverClause,
 * #coverOverClause), and the remedy's for an order the listing does not give (standing.ts#Remedy's `unordered` and
 * `seenOver`):
 * - `drawn`: drawn over it by the draw order — listed after it, a floating tab bar's item, a presented layer's cover;
 * - `untold`: one of the two controls of a run listed in READING order (`UiNode.readingOrder`) that overlap it, which
 *   of the two is on top not told (draw-order.ts#readingOrderPeers' `unordered`);
 *   docs/bugs/2026-10-16-lab-ios-swiftui-menu-row-listed-in-reading-order-reads-covered-by-the-row-beneath.md
 * - `seenOver`: such a peer whose order a screenshot told, seen drawn over it (ui-tree/seen-order.ts).
 *   docs/adr/0024-the-eyes-tell-the-order-of-two-controls-listed-in-reading-order.md
 * An object, so a kind that carries more (the edge a cover is known by alone) adds a variant, and every reader's
 * switch over `kind` stays exhaustive.
 */
export type CoverOrder = { readonly kind: 'drawn' } | { readonly kind: 'untold' } | { readonly kind: 'seenOver' };

/** The record of `node` among `covers` (the first, as covers are listed in draw order), or undefined when it is none of them. */
export const coverOf = (covers: readonly Cover[], node: UiNode): Cover | undefined => covers.find((c) => c.node === node);

/** The cover drawn on top at `point` — the last of `covers` whose reach contains it — or undefined. */
export const coverAtPoint = (covers: readonly Cover[], point: Point): Cover | undefined => covers.filter((c) => containsPoint(c.reach, point)).at(-1);

/** The last of `covers` that is the surface of a screen presented over the target (`Cover.presented`), or undefined. */
export const lastPresented = (covers: readonly Cover[]): Cover | undefined => covers.filter((c) => c.presented).at(-1);
