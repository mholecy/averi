import type { Edge } from './geometry.js';

/**
 * The words of a rect's four sides, spelled once: where a node past a side lies, and the `scroll_until` direction that
 * brings it back. Here, in ui-tree, because a miss words them (miss.ts: a target matched only by nodes clipped out of
 * their scroll container) and ui-tree imports no verb; interact/'s stroke and sentences read the same table
 * (interact/swipe.ts re-exports it with `Direction`, interact/target-text.ts says its phrases with it).
 */

/** A `scroll_until` direction (where the content lies), a swipe's (where the finger travels): the four ways. */
export type Direction = 'up' | 'down' | 'left' | 'right';

/** What one side of a rect means to a scroll and to a sentence (`SIDES`). */
export interface SideWords {
  /**
   * The `scroll_until` direction (where the content lies) that reveals what
   * lies past this edge: content beyond the top lies up, and so on — read by
   * `scroll_until`'s probe and its stroke toward a cut edge
   * (interact/scroll-rounds.ts), by the tap's cut-sliver remedy (interact/target-text.ts#cutRemedy,
   * which `scroll_until`'s sliver failures quote) and by the hints for a node
   * past a side (`revealText`, interact/target-text.ts#untriedSideText).
   */
  readonly reveals: Direction;
  /** Where a node past this edge lies, before what it lies past: `clipped out above its scroll container` (`clippedOutText`), `left of the viewport` (interact/target-text.ts#pastSideText). */
  readonly past: string;
  /** The same side standing alone: `if it lies to the left` (interact/target-text.ts#untriedSideText). */
  readonly lies: string;
}

/**
 * Each EDGE of a rect's words — one table, a field per use, so the four
 * sides are spelled once (interact/target-text.ts's sentences and miss.ts's zero-area note read it too).
 */
export const SIDES: Readonly<Record<Edge, SideWords>> = {
  top: { reveals: 'up', past: 'above', lies: 'above' },
  bottom: { reveals: 'down', past: 'below', lies: 'below' },
  left: { reveals: 'left', past: 'left of', lies: 'to the left' },
  right: { reveals: 'right', past: 'right of', lies: 'to the right' },
};

/** Where nodes Android dumped clipped out of their scroll container lie (UiNode.clippedOut): `clipped out above its scroll container`, `… above or below …` for several sides. */
export const clippedOutText = (sides: readonly Edge[]): string => `clipped out ${sides.map((side) => SIDES[side].past).join(' or ')} its scroll container`;

/** The scroll that brings back a node lying past `side`: `scroll_until it with direction: "up"`. */
export const revealText = (side: Edge): string => `scroll_until it with direction: "${SIDES[side].reveals}"`;
