import { INPUT_ROLE, type UiNode } from '../adapters/types.js';
import { charactersText } from '../util/count.js';
import { rectText } from './geometry.js';

/**
 * A node's text as a list of OTHER nodes gives it — every verb's ambiguity candidates (interact/resolve.ts), an
 * assert's contains-hint over the whole tree (verify/text-hint.ts): JSON-quoted, unless it is an input's own text. An
 * Android EditText with no content-desc is labelled by its text (android-tree-dialect.ts), and an input with no label
 * is named by its value; that text may be a password typed a moment ago, so it is said by its length, as a fill says
 * it, and the input by its rect, so two without an id are still told apart: `<its text, 8 characters> at 0,40 100x10`.
 * The node a caller asked about is no such list: an assert quotes its own subject. The limit: this covers averi's own
 * derivation only; a label the app built around the text (a content-desc holding it) is quoted — after a fill's focus
 * tap every label is given by its length instead (ResolveOptions.labelsByLength).
 */
export function listedText(n: UiNode, shown: string | null): string {
  const own = n.role === INPUT_ROLE ? n.value?.trim() : undefined;
  return own && shown?.trim() === own ? `<its text, ${charactersText(own.length)}> at ${rectText(n.rect)}` : JSON.stringify(shown);
}
