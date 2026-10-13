import type { Rect, UiNode } from '../adapters/types.js';
import { rectText, type Cut, type Edge } from '../ui-tree/geometry.js';
import { SIDES } from './swipe.js';

/**
 * The phrases a target cut to a sliver, or lying past a side, is said in —
 * one wording for every verb that says it: the tap's refusal (tap-judgement.ts),
 * the wait's hint (resolve.ts#zeroAreaHint), `scroll_until`'s failures
 * (scroll-text.ts) and the dismissal picker's skip lines
 * (keyboard-in-tree.ts#whyNotTapped) — and the picker's short name for a
 * cover (`coverName`), kept beside geometry.ts#nodeText as a choice, not as
 * the shared wording. Phrases, not policies: what counts as cut is
 * geometry.ts#Clips.cutSliver's, and which phrase a reply says is its
 * caller's switch. Shallow by design, like ui-tree/system-bar.ts: delete it
 * and each shared sentence reappears in its two or three callers.
 */

/**
 * Where a node read wholly past `side` lies — `clipped out above its scroll
 * container` when Android dumped it so (UiNode.clippedOut), `above the
 * viewport` when its rect lies there — the one wording of it, for the wait's
 * hint (resolve.ts) and `scroll_until`'s failure (scroll-text.ts).
 */
export function pastSideText(side: Edge, clippedOut: boolean): string {
  return clippedOut ? `clipped out ${SIDES[side].past} its scroll container` : `${SIDES[side].past} the viewport`;
}

/** The scroll that brings back a node lying past `side`: `scroll_until it with direction: "up"` (swipe.ts#SIDES). */
export const revealText = (side: Edge): string => `scroll_until it with direction: "${SIDES[side].reveals}"`;

/** The direction to try for a target that may lie past `side` and was never read there: `if it lies above, try direction: "up"`. */
export function untriedSideText(side: Edge): string {
  return `if it lies ${SIDES[side].lies}, try direction: "${SIDES[side].reveals}"`;
}

/**
 * THE sentence for a node cut to a sliver (`Clips.cutSliver`'s answer, `cut`, of a
 * node whose rect is `shown`): `cut at its scroll container's bottom edge
 * (container 0,242 1080x1736); only a 948x55 part of it shows, 55 deep across
 * that edge, under the 65 a tap needs`; a cut inherited from what the node
 * lies in (`Cut.within`) says so after the container — `…(container
 * 0,242 1080x1736), as is the 66,1924 948x55 it lies in; only a 948x42
 * part…`. Said by the tap's refusal
 * (tap-judgement.ts#judgeTap), by `scroll_until`'s sliver failures
 * (scroll-text.ts) and by the picker's skip line — one wording.
 */
export function cutSliverText(cut: Cut, shown: Rect, minPiece: number): string {
  const within = cut.within === undefined ? '' : `, as is the ${rectText(cut.within)} it lies in`;
  return (
    `cut at its scroll container's ${cut.edge} edge (container ${rectText(cut.container)})${within}; only a ${shown.width}x${shown.height} part of it shows, ` +
    `${cut.depth} deep across that edge, under the ${minPiece} a tap needs`
  );
}

/** The remedy for a target cut at `edge`: a scroll toward where the rest of it lies (swipe.ts#SIDES) — down, `scroll_until`'s default (scroll.ts), needs no word. Quoted by `scroll_until`'s sliver failures too (scroll-text.ts). */
export function cutRemedy(edge: Edge): string {
  const direction = SIDES[edge].reveals;
  return direction === 'down' ? 'scroll_until it first' : `scroll_until it with direction: ${direction} first`;
}

/**
 * A cover as the dismissal picker's skip line names it (keyboard-in-tree.ts
 * #whyNotTapped): `button "Sign in"`, `toolbar` — its role and its label
 * quoted, an empty label as `""`; nothing else.
 *
 * Not geometry.ts#nodeText (`button "Sign in" (24,780 354x44)`, its id when
 * it has no label, an empty label skipped), on purpose: the skip line names a
 * cover in a list of reasons, where a rect adds length and not a decision.
 * The two phrasings are a choice, kept side by side (spec D's OD-6 (a));
 * one phrasing would change the skip lines `KeyboardWithoutDismissal` and the
 * `dismiss()` warning quote.
 */
export const coverName = (cover: UiNode): string => `${cover.role}${cover.label === null ? '' : ` ${JSON.stringify(cover.label)}`}`;
