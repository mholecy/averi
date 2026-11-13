import { isTyped, type TypedPresentationKind } from '../adapters/types.js';
import type { MarkedLayer } from './presentation.js';
import type { NoScrollRemedy, Remedy, RemedyCase } from './standing.js';

/**
 * THE CLAUSES OF A REMEDY every verb quotes (A26, UT1): standing.ts decides a node's remedy (`Remedy`, `remedied`) and
 * words nothing; each verb owns its sentence, and the clauses more than one verb says live here — beneath a presented
 * screen (`presentedRemedy`, `presentedOr`, and `scroll_until`'s stop on it, `presentedStop`), under a cover listed in
 * reading order with the node (`orderRemedyText`), and where neither lies in a scroll view (`bothPinnedRemedyText`),
 * the last two said as one (`noScrollRemedyText`; a touch's cut by a node drawn after it, `cutPinnedRemedyText`); and a presented layer's name in a miss's note
 * (`presentedLayerName`, ui-tree/miss.ts). In ui-tree/ because interact/ (the tap, `scroll_until`) and verify/ (the
 * pixel assert) both say them, and verify/ may not import interact/ (tests/architecture/layering.test.ts). The touch
 * verbs' one sentence of a `cut` or `covered` remedy, which composes these with the keyboard's and the cut's words, is
 * interact/touch-remedy.ts's; the pixel verb's is verify/pixel-text.ts's.
 *
 * A leaf: types from standing.ts only, so the decision and its words are two modules, and either changes alone.
 *
 * One `purpose` names whose sentence a clause sits in — `touch` (the tap, `scroll_until`) or `pixel` (the pixel assert)
 * — and the node's pronoun follows from it (`pronoun`): `it` in a touch's sentence, `the element` in the pixel
 * assert's, whose "it" is already the cover.
 */

/** Whose sentence a clause sits in: a touch verb's (the tap, `scroll_until`) or the pixel assert's. */
export type RemedyPurpose = 'touch' | 'pixel';

/** The node as `purpose`'s sentence names it: `it` for a touch, `the element` for the pixel assert. */
const pronoun = (purpose: RemedyPurpose): 'it' | 'the element' => (purpose === 'touch' ? 'it' : 'the element');

/**
 * The advice for a standing's remedy, in any verb: beneath a presented screen, that screen's (`presentedRemedy`, in
 * `purpose`'s words), whatever the kind; else `otherwise`, told
 * the remedy's other case — what each verb and kind words (a scroll, the system bar's three, the keyboard's hiding).
 * The one test of `presented` before a verb's own words: the tap's, `scroll_until`'s and the pixel assert's.
 */
export function presentedOr<R extends Exclude<Remedy, { readonly of: 'presented' }>>(
  remedy: RemedyCase<'presented'> | R,
  purpose: RemedyPurpose,
  otherwise: (remedy: R) => string,
): string {
  return remedy.of === 'presented' ? presentedRemedy(purpose, remedy.layer) : otherwise(remedy);
}

/** A presented layer the source TYPES, as the words name it (`presentedRemedy`): its article and its noun. */
interface TypedWords {
  readonly article: string;
  readonly noun: string;
}
/** The words for each typed kind (`TypedWords`). */
const TYPED_WORDS: Readonly<Record<TypedPresentationKind, TypedWords>> = {
  alert: { article: 'an', noun: 'alert' },
  actionSheet: { article: 'an', noun: 'action sheet' },
  popover: { article: 'a', noun: 'popover' },
  dialog: { article: 'a', noun: 'dialog' },
};
/** The words for `layer` when the source typed it; undefined for a `screen` or `backdrop` layer, or none. */
const typedWords = (layer: MarkedLayer | undefined): TypedWords | undefined => (layer === undefined || !isTyped(layer.kind) ? undefined : TYPED_WORDS[layer.kind]);

/**
 * A presented layer named in one phrase, no parenthesis inside it — for a sentence that already sits in one (a
 * not-found's note, ui-tree/miss.ts#missNote): a layer the source types by its kind and its label (`a dialog`,
 * `an alert "Delete?"`), a `screen` layer, or none, `a sheet or modal`.
 */
export const presentedLayerName = (layer: MarkedLayer | undefined): string => {
  if (layer?.kind === 'backdrop') return BACKDROP;
  const typed = typedWords(layer);
  return typed === undefined ? 'a sheet or modal' : `${typed.article} ${typed.noun}${layer?.label ? ` ${JSON.stringify(layer.label)}` : ''}`;
};

/**
 * A `backdrop` layer's words (adapters/types.ts#PresentationKind): what it is taken for, the evidence it rests on —
 * one empty element WDA lists over the whole screen, which a hidden overlay that lets touches through (a decorative
 * tint, `.allowsHitTesting(false)`, RN `pointerEvents="none"`) matches too (ADR 0018, the amendment "an in-window
 * backdrop", its residual) — and the way out then: a screenshot shows whether a menu is up; with none, what is beneath
 * the overlay takes a touch by coordinates (the tap and swipe tools' x/y, which judge nothing), or is judged on that
 * screenshot. The refusal stands: only the agent's look at the screen moves past it.
 * docs/bugs/2026-10-14-ios-swiftui-blur-overlay-has-no-node-tap-beneath-reported-done.md
 */
const BACKDROP = "a menu's backdrop";
/**
 * The evidence a `backdrop` rests on, as its source lists it: WDA's in-window backdrop is listed AFTER the screen's
 * content (adapters/wda-source.ts#inWindowBackdrops); idb's, in its flat list, BEFORE it, after the menu's card
 * (`MarkedLayer.listedAhead`, adapters/ios-tree-source.ts#backdropOf). The flag names idb because only idb's tree is a
 * flat list (dialect.ts#TreeDialect.ancestry false: the mark adapters/ios-tree-source.ts#markIdbDialect alone sets), so a backdrop listed ahead
 * is idb's.
 */
const backdropEvidence = (layer: MarkedLayer): string =>
  layer.listedAhead === true ? "an empty element idb lists over the whole screen, before the screen's content" : "an empty element WDA lists over the whole screen, after the screen's content";

/**
 * The `backdrop` remedy over the node (`purpose`'s pronoun), its way out (`wayOut`: what to do by coordinates or on the screenshot) in a
 * parenthesis right after "close it first" — so what a caller appends ("; nothing was tapped", ", so none was sent")
 * follows the refusal's own clause, never the way out.
 */
const backdropRemedy = (purpose: RemedyPurpose, wayOut: string, layer: MarkedLayer): string => {
  const what = pronoun(purpose);
  return (
    `${BACKDROP} is presented over ${what} (${backdropEvidence(layer)}) — close it first ` +
  `(if a screenshot shows no menu up, the backdrop is an overlay that lets touches through: ${wayOut}); no scroll moves ${what} out from under that backdrop`
  );
};

/**
 * THE remedy's words for a node beneath a screen presented over its own (standing.ts#Remedy's `presented`), the node named
 * by `purpose` (`pronoun`) — `it` in the tap's refusal and `scroll_until`'s stop (and the tap and `scroll_until`
 * descriptions), `the element` in the pixel assert's sentence (verify/pixel-text.ts): close that screen first,
 * since no scroll moves the node out from under it. A layer the tree source types (an alert, an action sheet, a
 * popover; Android's floating window, a dialog: `layer`) is named by its kind and label; a `backdrop` by its evidence,
 * with the way out when a screenshot shows no menu (`backdropRemedy`); a `screen` layer, or none, is "a screen … (a
 * modal or a sheet)".
 * One clause of a remedy kept here, in the UI-tree layer both verbs and the pixel assert may import (the module's doc).
 */
export const presentedRemedy = (purpose: RemedyPurpose, layer?: MarkedLayer): string => {
  // A touch's sentence (tap, scroll_until) and the pixel assert's: each its own way out.
  if (layer?.kind === 'backdrop') return backdropRemedy(purpose, purpose === 'touch' ? 'tap the target by its coordinates (its centre from ui_snapshot)' : 'judge the element on that screenshot', layer);
  const what = pronoun(purpose);
  const typed = typedWords(layer);
  return typed !== undefined
    ? `${typed.article} ${typed.noun} is presented over ${what}${layer?.label ? ` (${JSON.stringify(layer.label)})` : ''} — close it first`
    : `a screen is presented over ${what} (a modal or a sheet) — close it first; no scroll moves ${what} out from under that screen`;
};

/**
 * `scroll_until`'s `presented` stop's remedy (interact/scroll-text.ts#scrollFailure): `presentedRemedy`'s, and why no
 * swipe was sent — one on that screen may dismiss it; under a layer the tree source types (an alert, an action sheet,
 * a popover, a dialog: `layer`) it is named, and a swipe would land on it. With no typed layer, the one sentence the
 * `scroll_until` description quotes (mcp/tools.ts).
 */
export const presentedStop = (layer?: MarkedLayer): string => {
  if (layer?.kind === 'backdrop') return `${backdropRemedy('touch', 'swipe, then tap the target, by coordinates', layer)}, and a swipe on it may close the menu`;
  const typed = typedWords(layer);
  return `${presentedRemedy('touch', layer)}, ${typed === undefined ? 'and a swipe on it may dismiss it' : `and a swipe would land on the ${typed.noun}`}`;
};

/**
 * THE remedy's words for a node under a cover the tree lists in reading order with it (standing.ts#Remedy's `unordered` and
 * `seenOver`), for a touch (the tap, `scroll_until`) or the pixel assert — the one wording every verb quotes:
 * - `unordered`, the order not told — as `presentedRemedy`'s: no scroll tells which of the two is drawn on top, so none
 *   is advised (a stroke beside an in-screen menu may close it); a screenshot shows it — a menu or popover drawn over
 *   the node is closed first; and, the node on top (the listing does not tell, so a cover may lie beneath it), the way
 *   out: a tap by coordinates, or an assert on a part of it clear of the other. A screenshot already looked at (`why`:
 *   why it could not tell) is not advised again.
 *   docs/bugs/2026-10-16-lab-ios-swiftui-menu-row-listed-in-reading-order-reads-covered-by-the-row-beneath.md
 * - `seenOver`, a screenshot saw the cover drawn over it, in the node's own screen — a menu or popover over it is
 *   closed first; no scroll moves it out from under it (a stroke beside an in-screen menu lands on its backdrop); the
 *   pixel assert, something of the element clear of it.
 *   docs/adr/0024-the-eyes-tell-the-order-of-two-controls-listed-in-reading-order.md
 */
export const orderRemedyText = (remedy: RemedyCase<'unordered' | 'seenOver'>, purpose: RemedyPurpose): string => {
  if (remedy.of === 'seenOver')
    return purpose === 'touch'
      ? 'if it is a menu or a popover, close it first; no scroll moves it out from under it'
      : 'if it is a menu or a popover, close it first; else assert something in the element that lies clear of it';
  const look = remedy.why === undefined ? 'see a screenshot' : `a screenshot could not tell either (${remedy.why})`;
  return purpose === 'touch'
    ? `no scroll tells which is on top: ${look} — if the other is drawn over it (a menu, a popover), close it first; if it is the one on top, tap it by coordinates`
    : `no scroll tells which is on top: ${look} — if the other is drawn over the element (a menu, a popover), close it first; if the element is the one on top, assert something in it that lies clear of the other`;
};

/** The head every touch's `bothPinned` clause shares, a cover's or a cut's: no scroll, and a menu or popover closed first. */
const PINNED_TOUCH = 'no scroll moves it out from under that: neither lies in a scroll view — if it is a menu or a popover, close it first;';

/**
 * THE remedy's words for a node under a cover where neither lies in a scroll view (standing.ts#Remedy's `bothPinned`
 * of a `covered` node), for a touch (the tap, `scroll_until`) or the pixel assert — the one wording every verb quotes:
 * no scroll moves either, so none is advised; a menu or popover drawn over it is closed first; the way out where the
 * tree's order is not the frame's (a sibling raised by elevation or `zIndex`, which the listing does not tell): a tap
 * by coordinates when a screenshot shows the target on top — the pixel assert, something of the element clear of the
 * cover. No "layout defect": with no stroke sent, nothing proved one. A touch's CUT by a node drawn after it words its
 * own way out (`cutPinnedRemedyText`).
 */
export const bothPinnedRemedyText = (purpose: RemedyPurpose): string =>
  purpose === 'pixel'
    ? 'no scroll moves the element out from under that: neither lies in a scroll view — if it is a menu or a popover, close it first; else assert something in the element that lies clear of it'
    : `${PINNED_TOUCH} if a screenshot shows this element on top, tap it by coordinates`;

/**
 * `bothPinnedRemedyText`'s for a touch's target CUT by a node drawn after it (geometry.ts#Cut.by, D88) — the node the
 * remedy is pinned under (`under`), whose way out is the cut's own: the dump cannot tell a cut from a whole control
 * that thin laid flush against that node (standing.ts#cutByLater's residual), and a coordinate tap on the strip of a
 * cut one is the tap its refusal prevents — so a tap by coordinates only if a screenshot shows it whole. Thin or cut,
 * no scroll changes it. Only a touch says it: the pixel assert judges that target `covered` (`bothPinnedRemedyText`).
 */
export const cutPinnedRemedyText = ({ under }: RemedyCase<'bothPinned'>): string =>
  `${PINNED_TOUCH} only if a screenshot shows it whole — a control that thin laid flush against that ${under.role} — tap it by coordinates`;

/** THE words for a `NoScrollRemedy` of a `covered` node, for a touch or the pixel assert: `orderRemedyText`'s, or `bothPinnedRemedyText`'s. */
export const noScrollRemedyText = (remedy: NoScrollRemedy, purpose: RemedyPurpose): string =>
  remedy.of === 'bothPinned' ? bothPinnedRemedyText(purpose) : orderRemedyText(remedy, purpose);
