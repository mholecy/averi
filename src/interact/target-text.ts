import type { Point, Rect, UiNode } from '../adapters/types.js';
import { nodeText, outsideScrollViewText, rectText, type Cut, type Edge } from '../ui-tree/geometry.js';
import { cannotHide, type KeyboardRemedy } from '../ui-tree/soft-keyboard.js';
import { SIDES } from './swipe.js';

/**
 * The phrases a target cut to a sliver, lying past a side, or lying under
 * the soft keyboard, is said in —
 * one wording for every verb that says it: the tap's refusal (tap-judgement.ts),
 * the wait's hint (resolve.ts#zeroAreaHint), `scroll_until`'s failures
 * (scroll-text.ts) and the dismissal picker's skip lines
 * (keyboard-in-tree.ts#whyNotTapped) — and the picker's short name for a
 * cover (`coverName`), kept beside geometry.ts#nodeText as a choice, not as
 * the shared wording. Phrases, not policies: what counts as cut is
 * geometry.ts#Clips.cutSliver's, and which phrase a reply says is its
 * caller's switch. The remedy for a target under a screen presented over its
 * own, a case of ui-tree/standing.ts#Remedy, is not here: its words are
 * ui-tree/standing.ts#presentedRemedy's, which every verb calls. Shallow by
 * design, like ui-tree/system-bar.ts: delete it and each shared sentence
 * reappears in its two or three callers.
 *
 * Its words for a side come from one other interact/ module: swipe.ts#SIDES
 * — `past` and `lies` (where a node past a side lies) and `reveals` (the
 * `scroll_until` direction that brings it back, which `cutRemedy` and
 * `revealText` name). The table stays in swipe.ts because the stroke reads
 * `reveals` too, and one table spells the four sides once. Still a leaf:
 * swipe.ts imports nothing from interact/, so this module pulls in no verb.
 */

/**
 * Where a node read wholly past `side` lies — `clipped out above its scroll
 * container` when Android dumped it so (UiNode.clippedOut), `above the
 * viewport` when its rect lies there — or `above its scroll view <node>` when
 * it lies past the edge of what that scroll view draws, on the screen
 * (`scrollView`, a WDA tree's drawn frame) — the one wording of it, for the
 * wait's hint (resolve.ts) and `scroll_until`'s failure (scroll-text.ts).
 */
export function pastSideText(side: Edge, clippedOut: boolean, scrollView?: UiNode): string {
  if (clippedOut) return `clipped out ${SIDES[side].past} its scroll container`;
  // Past the edge of what its scroll view draws, that scroll view on the screen (ui-tree/standing.ts, the drawn frame).
  return scrollView === undefined ? `${SIDES[side].past} the viewport` : outsideScrollViewText(scrollView, SIDES[side].past);
}

/**
 * Where a target whose centre lies under the soft keyboard stands —
 * `under the soft keyboard: its centre (201,661) lies below the keyboard's
 * top edge at y 573` — the one wording of that point, for the tap's
 * refusal (tap-judgement.ts#judgeTap, which goes on to say a tap there
 * presses the keyboard) and `scroll_until`'s presented stop
 * (scroll-text.ts#notInViewportText, which says it of "element"). `centre`
 * is the target's tap point, `lineY` the keyboard line's y
 * (ui-tree/keyboard-position.ts#KeyboardLine).
 */
export function underKeyboardText(centre: Point, lineY: number): string {
  return `under the soft keyboard: its centre (${centre.x},${centre.y}) lies below the keyboard's top edge at y ${lineY}`;
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
 * (scroll-text.ts) and by the picker's skip line — one wording. A cut by a
 * node drawn after it (`Cut.by`) is `cutByText`'s.
 */
export function cutSliverText(cut: Cut, shown: Rect, minPiece: number): string {
  if (cut.by !== undefined) return cutByText(cut.by, cut, shown, minPiece);
  const within = cut.within === undefined ? '' : `, as is the ${rectText(cut.within)} it lies in`;
  return (
    `cut at its scroll container's ${cut.edge} edge (container ${rectText(cut.container)})${within}; only a ${shown.width}x${shown.height} part of it shows, ` +
    `${cut.depth} deep across that edge, under the ${minPiece} a tap needs`
  );
}

/**
 * `cutSliverText`'s sentence for a node cut by a node drawn after it (`Cut.by`): `cut at its top edge by container
 * id:lab.form-keyboard.submit (55,1238 970x132), drawn after it — Android leaves out of a node's bounds what a later
 * node covers, so the rest of it may lie under that container; only a 970x42 part of it shows, at 55,1370, 42 deep
 * across that edge, under the 65 a tap needs` — where the part that shows lies, which the rect it was dumped with is.
 * "May": the dump cannot tell a cut from a WHOLE control that thin laid flush against that node (standing.ts
 * #cutByLater's residual), so the remedy carries that case's way past (`cutByRemedy`, `WHOLE_THIN_WAY_PAST`).
 */
function cutByText(by: UiNode, cut: Cut, shown: Rect, minPiece: number): string {
  return (
    `cut at its ${cut.edge} edge by ${nodeText(by)}, drawn after it — Android leaves out of a node's bounds what a later node covers, ` +
    `so the rest of it may lie under that ${by.role}; only a ${shown.width}x${shown.height} part of it shows, at ${shown.x},${shown.y}, ` +
    `${cut.depth} deep across that edge, under the ${minPiece} a tap needs`
  );
}

/** The soft keyboard a remedy names: up, its top edge (a keyboard line's `y`), and what the adapter can hide it with. */
export interface KeyboardUp {
  readonly lineY: number;
  readonly remedy: KeyboardRemedy;
}

/**
 * The first half of the remedy for a node cut by a node drawn after it while the soft keyboard is up (`Cut.by`, the
 * owner's decision for lab note F2A1): `the soft keyboard is up (its top edge at y 1398): dismiss it first (press_key
 * back from the MCP tools; …) — a bar riding on it goes down with it` — a submit bar laid on the IME's inset moves off
 * the field when the keyboard goes. How to hide it is the adapter's (`KeyboardRemedy`), as `scroll_until`'s own
 * sentence says it (scroll-text.ts#hideToJudgeWholeScreen).
 */
export function dismissKeyboardFirstText({ lineY, remedy }: KeyboardUp): string {
  const how =
    remedy.dismissal === 'back'
      ? 'press_key back from the MCP tools; `dismissKeyboard: true` on the fill before this step in a flow'
      : `tap a neutral element such as the screen title — a tap: step in a flow; ${cannotHide(remedy.advice)}`;
  return `the soft keyboard is up (its top edge at y ${lineY}): dismiss it first (${how}) — a bar riding on it goes down with it`;
}

/**
 * The soft keyboard as a cut-by remedy may name it: `keyboard` when the node that cut the target (`Cut.by`) RIDES on
 * it — its bottom edge at or above the keyboard's top edge and within `minPiece` of it, as a submit bar laid on the
 * IME's inset is (the lab's Continue ends at 1370, the line at 1398) — else undefined: hiding the keyboard does not move
 * a top app bar or a sticky header that cut a control, and saying so would send the reader the wrong way.
 */
export function ridingKeyboard(by: UiNode, keyboard: KeyboardUp | undefined, minPiece: number): KeyboardUp | undefined {
  if (keyboard === undefined) return undefined;
  const gap = keyboard.lineY - (by.rect.y + by.rect.height);
  return gap >= 0 && gap <= minPiece ? keyboard : undefined;
}

/**
 * The remedy for a node cut by a node drawn after it (`Cut.by`), as the tap's refusal and `scroll_until`'s bound
 * failure say it: with the soft keyboard up and that node riding on it (`ridingKeyboard`), dismiss it first, or scroll
 * the list (`dismissKeyboardFirstText`); else scroll the list — `scroll_until it out from under that container first`.
 * Not `cutRemedy`'s scroll toward the edge: the rest lies under the node, not past the edge of anything that scrolls.
 */
export function cutByRemedy(by: UiNode, up: KeyboardUp | undefined, minPiece: number): string {
  const keyboard = ridingKeyboard(by, up, minPiece);
  const scroll = `scroll_until it out from under that ${by.role} first (${wholeThinWayPast(by)})`;
  return keyboard === undefined ? scroll : `${dismissKeyboardFirstText(keyboard)} — or ${scroll}`;
}

/**
 * The way past a node cut by a node drawn after it should it only READ cut (standing.ts#cutByLater's residual: a
 * whole control that thin, laid flush against that node) — as `OWN_CUT_WAY_PAST` is for a container's cut
 * (tap-judgement.ts): no scroll shows more of it, so a coordinate tap.
 */
export const wholeThinWayPast = (by: UiNode): string => `if it is whole — a control that thin laid flush against that ${by.role} — no scroll shows more: tap by coordinates`;

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
 * The two phrasings are a choice, kept side by side: one phrasing would
 * change the skip lines `KeyboardWithoutDismissal` and the `dismiss()`
 * warning quote, words an agent may match on.
 */
export const coverName = (cover: UiNode): string => `${cover.role}${cover.label === null ? '' : ` ${JSON.stringify(cover.label)}`}`;
