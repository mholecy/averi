import type { Point, Rect, UiNode } from '../adapters/types.js';
import { cutAtLaterText } from '../ui-tree/cover.js';
import { rectText, type Cut, type Edge } from '../ui-tree/geometry.js';
import { outsideScrollViewText } from '../ui-tree/node-words.js';
import type { KeyboardLine } from '../ui-tree/keyboard-position.js';
import { cannotHide, type KeyboardRemedy } from '../ui-tree/soft-keyboard.js';
import { clippedOutText, SIDES } from '../ui-tree/sides.js';

/**
 * The phrases a target cut to a sliver, lying past a side, or lying under
 * the soft keyboard, is said in — one wording for every verb that says it;
 * a node's name in them is ui-tree/node-words.ts's. Phrases, not policies:
 * what counts as cut is geometry.ts#Clips.cutSliver's, and which phrase a
 * reply says is its caller's switch. The touch remedy's sentence,
 * which composes these with a standing's remedy (ui-tree/standing.ts#Remedy),
 * is touch-remedy.ts's; the clauses every verb quotes (a presented screen's,
 * a no-scroll cover's) are ui-tree/remedy-text.ts's. Shallow by design, like
 * ui-tree/system-bar.ts: delete it and each shared sentence reappears in its
 * two or three callers.
 *
 * Its words for a side come from ui-tree/sides.ts#SIDES — `past` and `lies`
 * (where a node past a side lies) and `reveals` (the `scroll_until` direction
 * that brings it back, which `cutRemedy` and `revealText` name). The table
 * lives in ui-tree because a miss words a node clipped out past a side too
 * (ui-tree/miss.ts), and one table spells the four sides once; `revealText`
 * and the clipped-out phrase live beside it for the same reason. A leaf: it
 * imports nothing from interact/, so this module pulls in no verb.
 */

/**
 * Where a node read wholly past `side` lies — `clipped out above its scroll
 * container` when Android dumped it so (UiNode.clippedOut), `above the
 * viewport` when its rect lies there — or `above its scroll view <node>` when
 * it lies past the edge of what that scroll view draws, on the screen
 * (`scrollView`, the drawn frame's: a WDA row where it lies, or an Android
 * rect uiautomator dumped past its scroll view) — the one wording of it; its
 * clipped-out phrase is ui-tree/sides.ts#clippedOutText, which a miss's
 * zero-area note says too (ui-tree/miss.ts).
 */
export function pastSideText(side: Edge, clippedOut: boolean, scrollView?: UiNode): string {
  if (clippedOut) return clippedOutText([side]);
  return scrollView === undefined ? `${SIDES[side].past} the viewport` : outsideScrollViewText(scrollView, SIDES[side].past);
}

/**
 * Where a target whose centre lies under the soft keyboard stands — `under
 * the soft keyboard: its centre (201,661) lies below the keyboard's top
 * edge at y 573` — the one wording of that point. `centre` is the target's
 * tap point, `lineY` the keyboard line's y
 * (ui-tree/keyboard-position.ts#KeyboardLine).
 */
export function underKeyboardText(centre: Point, lineY: number): string {
  return `under the soft keyboard: its centre (${centre.x},${centre.y}) lies below the keyboard's top edge at y ${lineY}`;
}

/** The direction to try for a target that may lie past `side` and was never read there: `if it lies above, try direction: "up"`. */
export function untriedSideText(side: Edge): string {
  return `if it lies ${SIDES[side].lies}, try direction: "${SIDES[side].reveals}"`;
}

/**
 * THE sentence for a node cut to a sliver (`Clips.cutSliver`'s answer,
 * `cut`, of a node whose rect is `shown`): `cut at its scroll container's
 * bottom edge (container 0,242 1080x1736); only a 948x55 part of it shows, 55
 * deep across that edge, under the 65 a tap needs`; a cut inherited from what
 * the node lies in (`Cut.within`) says so after the container — `…(container
 * 0,242 1080x1736), as is the 66,1924 948x55 it lies in; only a 948x42
 * part…`. A cut by a node drawn after it (`Cut.by`) is `cutByText`'s.
 */
export function cutSliverText(cut: Cut, shown: Rect, minPiece: number, lineY?: number): string {
  if (cut.by !== undefined) return cutByText(cut.by, cut, shown, minPiece, lineY);
  const within = cut.within === undefined ? '' : `, as is the ${rectText(cut.within)} it lies in`;
  return (
    `cut at its scroll container's ${cut.edge} edge (container ${rectText(cut.container)})${within}; only a ${shown.width}x${shown.height} part of it shows, ` +
    `${cut.depth} deep across that edge, under the ${minPiece} a tap needs`
  );
}

/**
 * `cutSliverText`'s sentence for a node cut by a node drawn after it (`Cut.by`): `cut at its top edge by container
 * id:lab.form-keyboard.submit (55,1238 970x132), drawn after it — the dump (Compose's, on Android) leaves out of a
 * node's bounds what a later node covers, so the rest of it may lie under that container; only a 970x28 part of it
 * shows above the soft keyboard, at 55,1370, 42 deep across that edge, under the 65 a tap needs` — where the part that
 * shows lies, the rect it was dumped with, cut above the keyboard's top edge when one is known (`lineY`: the lab's
 * phone, dumped to 1412, shows 28 of its 42 px above the line at 1398); the depth stays the dump's.
 * "May": the dump cannot tell a cut from a WHOLE control that thin laid flush against that node (standing.ts
 * #cutByLater's residual), so the remedy carries that case's way past (touch-remedy.ts#cutWayPast, `wholeThinWayPast`).
 */
function cutByText(by: UiNode, cut: Cut, rect: Rect, minPiece: number, lineY: number | undefined): string {
  const above = lineY !== undefined && lineY < rect.y + rect.height;
  const height = above ? Math.max(0, lineY - rect.y) : rect.height;
  const shows =
    height === 0
      ? `nothing of it shows above the soft keyboard (its strip lies at ${rectText(rect)})`
      : `only a ${rect.width}x${height} part of it shows${above ? ' above the soft keyboard' : ''}, at ${rect.x},${rect.y}`;
  return `${cutAtLaterText(cut.edge, by)}; ${shows}, ${cut.depth} deep across that edge, under the ${minPiece} a tap needs`;
}

/** The soft keyboard a remedy names: up, its top edge (a keyboard line's `y`), and what the adapter can hide it with. */
export interface KeyboardUp {
  readonly lineY: number;
  readonly remedy: KeyboardRemedy;
}

/**
 * The soft keyboard up at `line` (its `y`), hidden with `remedy`; none when there is no line. The one place a
 * `KeyboardUp` is built: a tap's or a miss's reading line with the reading's remedy, and scroll-read.ts#upOf for the
 * cover `scroll_until`'s round applies.
 */
export function keyboardUp(line: KeyboardLine, remedy: KeyboardRemedy): KeyboardUp;
export function keyboardUp(line: KeyboardLine | undefined, remedy: KeyboardRemedy): KeyboardUp | undefined;
export function keyboardUp(line: KeyboardLine | undefined, remedy: KeyboardRemedy): KeyboardUp | undefined {
  return line === undefined ? undefined : { lineY: line.y, remedy };
}

/** What hides the soft keyboard where no key does (`KeyboardRemedy.dismissal` `none`): every wording below says it. */
const NEUTRAL_TAP = 'tap a neutral element such as the screen title';

/** The flow step a neutral tap is, after `NEUTRAL_TAP`: `— a tap: step in a flow` (`hideKeyboardHow`), `… before this one` (`hideKeyboardInFlow`). */
const A_TAP_STEP = ' — a tap: step';

/**
 * HOW to hide the soft keyboard, by what the adapter hides it with (`KeyboardRemedy.dismissal`): `press_key back from
 * the MCP tools; \`dismissKeyboard: true\` on the fill before this step in a flow`, or `tap a neutral element such as
 * the screen title — a tap: step in a flow`. The one wording of the clause; each caller says the adapter's `cannotHide`
 * where its sentence puts it. Names MCP tools and "a flow", the exception keyboard-window.ts records. Its short form,
 * with no flow clause, is `hideKeyboardBriefly`.
 */
export const hideKeyboardHow = (remedy: KeyboardRemedy): string =>
  remedy.dismissal === 'back' ? `${hideKeyboardBriefly(remedy)} from the MCP tools; ${hideKeyboardInFlow(remedy)} in a flow` : `${NEUTRAL_TAP}${A_TAP_STEP} in a flow`;

/**
 * `hideKeyboardHow`'s SHORT form, for a reply that must stay one actionable line (`keyboardMayCoverText`): the action
 * alone — `press_key back`, or `tap a neutral element such as the screen title` — no flow clause, no adapter advice.
 */
export const hideKeyboardBriefly = ({ dismissal }: KeyboardRemedy): string => (dismissal === 'back' ? 'press_key back' : NEUTRAL_TAP);

/**
 * `hideKeyboardHow`'s FLOW form alone, for a reply only a flow reads (D80): `` `dismissKeyboard: true` on the fill
 * before this step ``, or `tap a neutral element such as the screen title — a tap: step before this one` — keyed on the
 * same `dismissal` as the MCP tools' `hideKeyboardBriefly`.
 */
export const hideKeyboardInFlow = ({ dismissal }: KeyboardRemedy): string =>
  dismissal === 'back' ? '`dismissKeyboard: true` on the fill before this step' : `${NEUTRAL_TAP}${A_TAP_STEP} before this one`;

export const keyboardUpText = (lineY: number): string => `the soft keyboard is up (its top edge at y ${lineY})`;

/**
 * `clause` — the sentence that says how to hide the soft keyboard, `hideKeyboardHow`'s words alone by default — then,
 * unless the adapter hides it with `back`, the adapter's `cannotHide` with its advice. Both branches are reached:
 * `back` on Android, the other on iOS (WDA's and idb's remedy is `none`).
 */
export function hideClause(remedy: KeyboardRemedy, clause: string = hideKeyboardHow(remedy)): string {
  return remedy.dismissal === 'back' ? clause : `${clause}; ${cannotHide(remedy.advice)}`;
}

/**
 * The first half of the remedy for a node cut by a node drawn after it while the soft keyboard is up (`Cut.by`, the
 * owner's decision for lab note F2A1): `the soft keyboard is up (its top edge at y 1398): dismiss it first (press_key
 * back from the MCP tools; …) — a bar riding on it goes down with it` — a submit bar laid on the IME's inset moves off
 * the field when the keyboard goes. How to hide it is `hideClause`'s. The cut-by rule holds on Android's trees only
 * (standing.ts#cutByLater), whose adapter hides the keyboard with `back`, so here `hideClause`'s other branch —
 * `cannotHide` with the adapter's advice — is unreachable today; it is the composition's, which other sentences reach.
 */
export function dismissKeyboardFirstText({ lineY, remedy }: KeyboardUp): string {
  return `${keyboardUpText(lineY)}: dismiss it first (${hideClause(remedy)}) — a bar riding on it goes down with it`;
}

/**
 * The note of a tap's or fill's wait that never found its target while the soft keyboard band of a tree that lists
 * nothing beneath it was read up by shape (interact/resolve.ts#notFound, D32 K1): `the soft keyboard is up (its top
 * edge at y 590) and idb lists nothing beneath it, so the element may lie there — tap a neutral element such as the
 * screen title to hide it, then try again`. `keyboardUpText`; `unlisted` the source's words
 * (ui-tree/miss.ts#KEYBOARD_UNLISTED); how to hide it `hideKeyboardBriefly`'s. "May": the read cannot say the target
 * lies there — only that it could.
 */
export function keyboardMayCoverText({ lineY, remedy }: KeyboardUp, unlisted: string): string {
  return `${keyboardUpText(lineY)} and ${unlisted}, so the element may lie there — ${hideKeyboardBriefly(remedy)} to hide it, then try again`;
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
 * The way past a node cut by a node drawn after it should it only READ cut (standing.ts#cutByLater's residual: a
 * whole control that thin, laid flush against that node) — touch-remedy.ts#cutWayPast's for such a cut, as it has its
 * own for a container's: no scroll shows more of it, so a coordinate tap. Conditioned on what a screenshot shows, so the
 * way past is not read as the remedy: in the owner's own case (the lab's phone under the riding bar) the field is NOT
 * whole, and a coordinate tap on the strip is the very tap the refusal exists to prevent.
 */
export const wholeThinWayPast = (by: UiNode): string => `only if a screenshot shows it whole — a control that thin laid flush against that ${by.role} — no scroll shows more: tap by coordinates`;

/** The remedy for a target cut at `edge`: a scroll toward where the rest of it lies (ui-tree/sides.ts#SIDES) — down, `scroll_until`'s default (scroll.ts), needs no word. */
export function cutRemedy(edge: Edge): string {
  const direction = SIDES[edge].reveals;
  return direction === 'down' ? 'scroll_until it first' : `scroll_until it with direction: ${direction} first`;
}
