import { INPUT_ROLE, type Rect, type UiNode } from '../adapters/types.js';
import { charactersText } from '../util/count.js';
import { rectText, sameRect } from './geometry.js';

/**
 * HOW A SENTENCE NAMES A NODE, in every verb's reply: `nodeText`, `coverText`, `outsideScrollViewText`, `coverName`,
 * `listedText` and `labelWords` are forms of one function, `textWords`, so one rule holds in all of them (ADR 0043, the
 * A54 amendment): an input labelled by its own text is said by that text's length, never quoted. An Android EditText
 * with no content-desc is labelled by its text (android-tree-dialect.ts), and that text may be a password typed a
 * moment ago. It covers averi's own derivation only: a label the app built around the text (a content-desc holding it)
 * is quoted, unless the caller's `NamingPolicy` says every label by its length.
 *
 * A leaf of the UI-tree layer: it takes the rect's spelling from geometry.ts#rectText and imports no verb.
 */

/**
 * A node as a sentence names it: its role, label, id and rect — not its subtree, which is no fact of a sentence — and
 * whether its label is its own text (`ownText`), not the text itself: a quoted copy is kept past its read (a stroke's
 * memory, a margin's answer), and the value it was read with stays in that read.
 */
export interface QuotedNode extends Pick<UiNode, 'role' | 'label' | 'identifier' | 'rect'> {
  readonly ownText?: true;
}

/** What a namer takes: a node of a tree (its `value` tells whether its label is its own text) or a quoted copy. */
export type NamedNode = QuotedNode | UiNode;

/**
 * Whose labels a list says by their length: `own-text`, the input's own text only (the rule); `every-label`, every
 * label, for a fill's re-reads after the focus tap (interact/fill-refetch.ts), when any label may hold the field's text
 * in any form an app makes of it (another case, the first keys, digits regrouped).
 */
export type NamingPolicy = 'own-text' | 'every-label';

/** The input's own text, trimmed, when `text` is it; else undefined. A quoted copy says so by its flag. */
function ownTextOf(n: NamedNode, text: string | null): string | undefined {
  if (text === null) return undefined;
  if ('value' in n) {
    const own = n.role === INPUT_ROLE ? n.value?.trim() : undefined;
    return own && text.trim() === own ? own : undefined;
  }
  return n.ownText === true && text === n.label ? text.trim() || undefined : undefined;
}

/** `n` as a sentence names it, kept past its read: a copy of its rect, its own-text flag in place of its value. */
export const quoted = (n: NamedNode): QuotedNode => {
  const { role, label, identifier, rect } = n;
  return { role, label, identifier, rect: { ...rect }, ...(ownTextOf(n, label) !== undefined && { ownText: true as const }) };
};

/**
 * THE one function: a node's `text` as a sentence says it — JSON-quoted, or by its length when it is the input's own
 * text (`<its text, 8 characters>`), or, under `every-label`, any text (`<18 characters>`; `null`, none). `byLength`:
 * said by its length, so the node's rect must follow to tell two such nodes apart.
 */
function textWords(n: NamedNode, text: string | null, policy: NamingPolicy): { readonly words: string; readonly byLength: boolean } {
  if (policy === 'every-label') return { words: text === null ? 'null' : `<${charactersText(text.trim().length)}>`, byLength: true };
  const own = ownTextOf(n, text);
  return own === undefined ? { words: JSON.stringify(text), byLength: false } : { words: `<its text, ${charactersText(own.length)}>`, byLength: true };
}

/**
 * A presented layer's label as a sentence quotes it (ui-tree/remedy-text.ts: `an alert "Delete?"`): the label alone,
 * kept as presentation.ts#MarkedLayer.label without the node it was read off, so always quoted — that node is a typed
 * layer's element or the layer itself, never an input, and only an input's label can be its own text (`textWords`).
 */
export const layerLabelWords = (label: string): string => JSON.stringify(label);

/** A label in a sentence that names the node's rect itself: `"Sign in"`, or `<its text, 8 characters>`. */
export const labelWords = (n: NamedNode): string => textWords(n, n.label, 'own-text').words;

/**
 * A node's text in a list of other nodes (an ambiguity's candidates, an assert's contains-hint): JSON-quoted, or by its
 * length and the node's rect, `<its text, 8 characters> at 0,40 100x10` — the rect tells two inputs without an id apart.
 */
export function listedText(n: NamedNode, text: string | null, policy: NamingPolicy = 'own-text'): string {
  const { words, byLength } = textWords(n, text, policy);
  return byLength ? `${words} at ${rectText(n.rect)}` : words;
}

/**
 * How a sentence names a NODE drawn over another — `button "Continue to summary" (24,780 354x44)`: its role, its label
 * (`labelWords`, else its id), its rect (geometry.ts#rectText). A cover a dismissal skips is named shorter, on purpose
 * (`coverName`).
 */
export const nodeText = (n: NamedNode): string =>
  `${n.role}${n.label ? ` ${labelWords(n)}` : n.identifier ? ` id:${n.identifier}` : ''} (${rectText(n.rect)})`;

/**
 * A cover as a sentence names it, with where it presses when that is not its rect (cover.ts#Cover.reach: a
 * pinned bar run down to the screen's bottom, a tab bar's item raised by its lift, an alert over the whole screen):
 * `container "Exit confirmation" (41,365 320x172, reaching 0,0 402x874)` — so a point the sentence names off the
 * cover's own rect still lies on what it names.
 */
export const coverText = (cover: NamedNode, reach?: Rect): string =>
  reach === undefined || sameRect(reach, cover.rect) ? nodeText(cover) : `${nodeText(cover).slice(0, -1)}, reaching ${rectText(reach)})`;

/**
 * How a sentence names the scroll view a node lies outside of — `outside its scroll view scrollable id:form (0,0
 * 402x780)` — or past one edge of (`where`: `below its scroll view …`, interact/target-text.ts#pastSideText), when
 * nothing of the node, or not its centre, is drawn there (ui-tree/standing.ts, the drawn frame, `Clips.drawnIn`). The
 * pixel assert's miss heads (verify/pixel-text.ts#OUTSIDE_ITS_SCROLL_VIEW, #TOO_THIN_IN_ITS_SCROLL_VIEW) end with the
 * same words.
 */
export const outsideScrollViewText = (scroller: NamedNode, where = 'outside'): string => `${where} its scroll view ${nodeText(scroller)}`;

/**
 * A cover's name in a dismissal's skip line: its role and its label (`listedText`: an input's own text by its length
 * and rect), no rect otherwise — the skip line names a cover in a list of reasons, where a rect adds length and not a
 * decision. Not `nodeText`, on purpose: one phrasing would change the skip lines `KeyboardWithoutDismissal` and the
 * `dismiss()` warning quote, words an agent may match on.
 */
export const coverName = (cover: NamedNode): string => `${cover.role}${cover.label === null ? '' : ` ${listedText(cover, cover.label)}`}`;
