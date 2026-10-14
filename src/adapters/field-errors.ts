import { everyNode, type UiNode } from './types.js';

/**
 * Pair validation messages with their inputs — a measured iOS convention
 * (payment spike 2026-08-05): a field's title AND its error label carry the
 * field's own accessibilityIdentifier, the title above the field and the error
 * below it. So a same-identifier text BELOW an input is its validation
 * message, and the nearest one wins.
 *
 * A design-system component may instead give EVERY field and its title one
 * shared identifier (mp-native's SWIFT form: `TextFieldWithComponentStyle` on
 * each field and its floating title). Then the text below a field is the
 * NEXT field's title. So a same-identifier text that vertically overlaps a
 * same-identifier field (its floating title, or a label reaching into its top,
 * or a placeholder inside it) is a title and never an error, and a field's
 * error lies above the top of the next same-identifier field below it.
 *
 * Not covered: a title stacked wholly above its field, not overlapping it,
 * still reads as the previous same-identifier field's error; and same-identifier
 * fields side by side on one row share the message below them.
 *
 * One owner because BOTH iOS tree sources need it and their trees have
 * different shapes: idb returns a flat AX list, WDA a nested XCUIElement tree
 * where a field and its labels sit in different branches. Only the traversal
 * differs — rects are absolute in both, so the rule itself is identical, and
 * it was previously written out twice.
 */

export function attachFieldErrors(nodes: Iterable<UiNode>): void {
  const fields: UiNode[] = [];
  const texts: UiNode[] = [];
  for (const n of nodes) {
    if (n.role === 'textfield' && n.identifier !== null) fields.push(n);
    else if (n.role === 'text' && n.identifier !== null && n.label !== null) texts.push(n);
  }
  const titles = new Set<UiNode>();
  for (const field of fields) {
    for (const t of texts) if (t.identifier === field.identifier && t.rect.y < bottom(field) && bottom(t) > field.rect.y) titles.add(t);
  }
  for (const field of fields) {
    const next = nearest(
      fields.filter((f) => f !== field && f.identifier === field.identifier && f.rect.y >= bottom(field)),
      (f) => f.rect.y,
    );
    const error = nearest(
      texts.filter(
        (t) =>
          t.identifier === field.identifier &&
          t.rect.y >= bottom(field) &&
          !titles.has(t) &&
          (next === undefined || t.rect.y < next.rect.y),
      ),
      (t) => t.rect.y,
    );
    if (error !== undefined) field.error = error.label!;
  }
}

const bottom = (n: UiNode): number => n.rect.y + n.rect.height;

/** The node with the smallest `distance`; the first such in document order on a tie. */
function nearest(nodes: UiNode[], distance: (n: UiNode) => number): UiNode | undefined {
  let best: UiNode | undefined;
  for (const n of nodes) if (best === undefined || distance(n) < distance(best)) best = n;
  return best;
}
