import { INPUT_ROLE, type UiNode } from '../adapters/types.js';
import { charactersText } from '../util/count.js';
import { rectText } from './geometry.js';

/**
 * A node's text as a list of candidates quotes it: JSON-quoted, unless it is an input's own text — an Android EditText
 * with no content-desc is labelled by its text (android-tree-dialect.ts), and an input with no label is named by its
 * value. That text may be a password typed a moment ago, so it is said by its length, as a fill says it, and the input
 * by its rect, so two without an id are still told apart: `<its text, 8 characters> at 0,40 100x10`. The limit: this
 * covers averi's own derivation only; a label the app built around the text (a content-desc holding it) is quoted.
 * Read by every verb's ambiguity list (interact/resolve.ts) and an assert's contains-hint (verify/text-hint.ts).
 */
export function quotedText(n: UiNode, shown: string | null): string {
  const own = n.role === INPUT_ROLE ? n.value?.trim() : undefined;
  return own && shown?.trim() === own ? `<its text, ${charactersText(own.length)}> at ${rectText(n.rect)}` : JSON.stringify(shown);
}
