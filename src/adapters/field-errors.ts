import { everyNode, type UiNode } from './types.js';

/**
 * Pair validation messages with their inputs. Two conventions are measured,
 * and a field takes its message by the first that gives it one.
 *
 * Same identifier (measured on the payment spike): a field's title AND its error
 * label carry the field's own accessibilityIdentifier, the title above the
 * field and the error below it. So a same-identifier text BELOW an input is
 * its validation message, and the nearest one wins.
 *
 * A design-system component may instead give EVERY field and its title one
 * shared identifier (mp-native's SWIFT form: `TextFieldWithComponentStyle` on
 * each field and its floating title). Then the text below a field is the
 * NEXT field's title. So a same-identifier text that vertically overlaps a
 * same-identifier field (its floating title, or a label reaching into its top,
 * or a placeholder inside it) is a title and never an error, and a field's
 * error lies above the top of the next same-identifier field below it.
 *
 * Own error identifier: that same component gives its validation message an
 * identifier of its own, the field wrapper's id plus `_error`
 * (`swift_payment.form.iban_input_error` under the IBAN input, which itself
 * reads `TextFieldWithComponentStyle`). Such a message names no field, so it
 * is placed by geometry: a text whose identifier ends in `_error`, `.error` or
 * `-error` belongs to the nearest field above it in its column (see
 * `fieldAbove`). The wrapper's identifier would name the field more directly,
 * but only WDA lists it, as the field's PARENT with the message its SIBLING;
 * idb lists no container identifiers, so a rule reading the wrapper would
 * serve one source. Geometry serves both. A field that already has a
 * same-identifier message keeps it, and of several such messages under one
 * field the nearest wins, as with the first convention.
 *
 * Not covered: a title stacked wholly above its field, not overlapping it,
 * still reads as the previous same-identifier field's error; same-identifier
 * fields side by side on one row share the message below them; a message whose
 * identifier names it an error some other way (`IbanError`, `error_iban`) is
 * not seen; and an own-identifier message under a field of another column,
 * with no field above it in its own, pairs with nothing.
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
  const messages = new Map<UiNode, UiNode>();
  for (const t of texts) {
    if (!ERROR_IDENTIFIER.test(t.identifier!)) continue;
    const field = fieldAbove(t, fields);
    if (field === undefined || field.error !== undefined) continue;
    const held = messages.get(field);
    if (held === undefined || t.rect.y < held.rect.y) messages.set(field, t);
  }
  for (const [field, t] of messages) field.error = t.label!;
}

/**
 * The field a message with an error identifier belongs to: the nearest field
 * above it in its column, provided no other field of that column lies between.
 *
 * A field is in the message's COLUMN when their horizontal extents overlap;
 * the message is drawn under the field it describes, starting at or near the
 * field's left edge, so a field it does not reach horizontally describes some
 * other column, however near it is. The field is ABOVE the message when its
 * bottom is at or above the message's top, the same "below means below the
 * bottom" the same-identifier rule uses. Of the fields above, the one whose
 * bottom is lowest is nearest. Two fields side by side on one row are equally
 * near; the message belongs to the one it overlaps more, and on a further tie
 * to the first in document order.
 *
 * A field of the column BETWEEN them is one that starts at or below the chosen
 * field's bottom and above the message's top. Any such field ending above the
 * message would itself be nearer, so what remains is a field reaching past the
 * message's top: the message lies inside that field's own span, and it is
 * neither the field above's nor below the one it lies in. It pairs with none.
 */
function fieldAbove(message: UiNode, fields: UiNode[]): UiNode | undefined {
  const column = fields.filter((f) => overlapX(f, message) > 0);
  let field: UiNode | undefined;
  for (const f of column) {
    if (bottom(f) > message.rect.y) continue;
    const nearer = field === undefined || bottom(f) > bottom(field);
    const tiedButOverlapsMore = field !== undefined && bottom(f) === bottom(field) && overlapX(f, message) > overlapX(field, message);
    if (nearer || tiedButOverlapsMore) field = f;
  }
  if (field === undefined) return undefined;
  const above = field;
  return column.some((f) => f !== above && f.rect.y >= bottom(above) && f.rect.y < message.rect.y) ? undefined : above;
}

/** An identifier naming its text an error: `<…>_error`, `<…>.error` or `<…>-error`, in any case. */
const ERROR_IDENTIFIER = /[._-]error$/i;

/** How far two nodes' horizontal extents overlap; zero or less when they do not. */
const overlapX = (a: UiNode, b: UiNode): number =>
  Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width) - Math.max(a.rect.x, b.rect.x);

const bottom = (n: UiNode): number => n.rect.y + n.rect.height;

/** The node with the smallest `distance`; the first such in document order on a tie. */
function nearest(nodes: UiNode[], distance: (n: UiNode) => number): UiNode | undefined {
  let best: UiNode | undefined;
  for (const n of nodes) if (best === undefined || distance(n) < distance(best)) best = n;
  return best;
}
