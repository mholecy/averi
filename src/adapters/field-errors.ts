import type { UiNode } from './types.js';

/**
 * Pair validation messages with their inputs — a measured iOS convention
 * (payment spike 2026-08-05): a field's title AND its error label carry the
 * field's own accessibilityIdentifier, the title above the field and the error
 * below it. So a same-identifier text BELOW an input is its validation
 * message, and the nearest one wins.
 *
 * One owner because BOTH iOS tree sources need it and their trees have
 * different shapes: idb returns a flat AX list, WDA a nested XCUIElement tree
 * where a field and its labels sit in different branches. Only the traversal
 * differs — rects are absolute in both, so the rule itself is identical, and
 * it was previously written out twice.
 */

/** Every node under `root`, pre-order — lets a nested tree feed the flat rule. */
export function* everyNode(root: UiNode): Generator<UiNode> {
  yield root;
  for (const child of root.children) yield* everyNode(child);
}

export function attachFieldErrors(nodes: Iterable<UiNode>): void {
  const fields: UiNode[] = [];
  const texts: UiNode[] = [];
  for (const n of nodes) {
    if (n.role === 'textfield' && n.identifier !== null) fields.push(n);
    else if (n.role === 'text' && n.identifier !== null && n.label !== null) texts.push(n);
  }
  for (const field of fields) {
    const fieldBottom = field.rect.y + field.rect.height;
    const below = texts.filter((t) => t.identifier === field.identifier && t.rect.y >= fieldBottom);
    if (below.length === 0) continue;
    below.sort((a, b) => a.rect.y - b.rect.y);
    field.error = below[0].label!;
  }
}
