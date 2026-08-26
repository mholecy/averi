import type { UiNode } from '../adapters/types.js';

/**
 * Why an exact-text expectation missed when the string is nonetheless ON the
 * screen.
 *
 * Measured 2026-08-26: `{"element":{"text":"1 of 13 selected"}}` passed on
 * Android and failed on iOS — and it was not an app defect. The iOS tile uses
 * `.accessibilityElement(children: .combine)`, so its two `Text`s collapse
 * into ONE node labelled "Select transaction type, 1 of 13 selected"; no node
 * EQUALS the expected string, and both `findBySpec` and the element assert
 * compare for equality. The failure reads as a missing feature until someone
 * dumps the tree, which is the expensive part.
 *
 * `match` (regex, unanchored) is the portable form, so the hint names it.
 */

/**
 * Characters that JOIN clauses in a combined accessibility label — iOS uses
 * ", ", other sources use whitespace or a dash. Deliberately narrow: anything
 * else touching the match means the expected string is a FRAGMENT of a longer
 * token, not one of the parts that got glued together. `"$9.99"` and
 * `"9.99%"` are the cases this excludes, and both matter — recommending an
 * unanchored `match` there would wave a currency or format regression
 * through. A missed hint costs nothing but the status quo; a wrong one
 * converts a failing assert into a passing one.
 */
const SEPARATOR = /[\s,;:|/·–—-]/u;

/**
 * Does `needle` occur in `haystack` as a whole SEGMENT — bounded by
 * punctuation, whitespace, or the ends of the string?
 *
 * This is the entire difference between a useful hint and a confidently wrong
 * one. Plain containment also fires on `"9.99"` inside `"19.99"` — a genuine
 * price bug — where it would blame iOS element combining and then recommend an
 * unanchored `match: "9\.99"` that PASSES against `"19.99"`, converting a
 * correctly failing assert into a wrongly passing one. Combined a11y labels
 * join their children at separators, so the real case always lands on one and
 * the fragment cases (`"19.99"`, `"$9.99"`, `"9.99%"`) never do.
 */
function occursAsSegment(haystack: string, needle: string): boolean {
  for (let from = 0; ; ) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? undefined : haystack[at - 1];
    const afterAt = at + needle.length;
    const after = afterAt >= haystack.length ? undefined : haystack[afterAt];
    // undefined = the end of the string, which is a boundary by definition.
    if (
      (before === undefined || SEPARATOR.test(before)) &&
      (after === undefined || SEPARATOR.test(after))
    ) {
      return true;
    }
    from = at + 1;
  }
}

/** Every node under `root`, for the unscoped case (the spec matched nothing). */
export function flattenTree(root: UiNode): UiNode[] {
  const all: UiNode[] = [];
  const walk = (n: UiNode) => {
    all.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return all;
}

/**
 * The hint, or undefined when there is nothing honest to say.
 *
 * `candidates` is scoped by the caller: the nodes the element spec actually
 * matched when it matched any, so an id-addressed assert cannot be explained
 * by an unrelated node elsewhere on screen — and the whole tree only when the
 * spec found nothing at all.
 */
export function containsTextHint(candidates: UiNode[], expected: string): string | undefined {
  if (expected === '') return undefined;
  const hits = candidates.filter((n) =>
    [n.label, n.value]
      .filter((v): v is string => v !== null)
      // Strictly CONTAINS: an exact match is not a hint, it is a pass, and
      // reporting it would describe a failure that cannot have happened.
      .some((v) => v !== expected && occursAsSegment(v, expected)),
  );
  if (hits.length === 0) return undefined;
  const shown = hits
    .slice(0, 3)
    .map((n) => `    id=${n.identifier ?? '(none)'} label=${JSON.stringify(n.label ?? n.value)}`)
    .join('\n');
  return (
    `no node has this exact text, but ${hits.length} node(s) CONTAIN it as a whole segment:\n${shown}\n` +
    `    (iOS combines a container's children into one accessibility element — ` +
    `use match: ${JSON.stringify(escapeRegExp(expected))} for a cross-platform assert)`
  );
}

/** The expected string is literal text; as a regex its punctuation is not. */
export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
