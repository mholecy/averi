import { INPUT_ROLE, type UiNode } from '../adapters/types.js';
import { charactersText } from '../util/count.js';
import { rectText } from './geometry.js';

/**
 * A node's text in a list of other nodes: JSON-quoted, unless it is an input's own text, then by its length and the
 * node's rect, `<its text, 8 characters> at 0,40 100x10`. An Android EditText with no content-desc is labelled by its
 * text (android-tree-dialect.ts), and that text may be a password typed a moment ago; the rect tells two inputs without
 * an id apart. Covers averi's own derivation only: a label the app built around the text (a content-desc holding it)
 * is quoted.
 */
export function listedText(n: UiNode, text: string | null): string {
  const own = n.role === INPUT_ROLE ? n.value?.trim() : undefined;
  return own && text?.trim() === own ? `<its text, ${charactersText(own.length)}> at ${rectText(n.rect)}` : JSON.stringify(text);
}
