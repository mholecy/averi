import type { Selector, UiNode } from '../adapters/types.js';
import type { ElementSpec } from './element-spec.js';

/**
 * Selector syntax (ARCHITECTURE.md §3): space-separated conditions, all must match.
 *   id:login_pin_field
 *   text:"Continue"
 *   role:button label~"Pay.*"
 *
 * Fields: id, text, role, label, value.
 *   `:` exact match (case-sensitive). `~` regex match (unanchored).
 *   `text` matches against label OR value; the others match their own field.
 * Values with spaces must be double-quoted.
 */

type Field = 'id' | 'text' | 'role' | 'label' | 'value';

interface Condition {
  field: Field;
  op: 'eq' | 're';
  value: string;
}

const CONDITION_RE = /(id|text|role|label|value)([:~])(?:"([^"]*)"|(\S+))/gy;

export function parseSelector(selector: Selector): Condition[] {
  const input = selector.trim();
  if (input === '') throw new Error('Empty selector');

  const conditions: Condition[] = [];
  let pos = 0;
  while (pos < input.length) {
    CONDITION_RE.lastIndex = pos;
    const match = CONDITION_RE.exec(input);
    if (!match) {
      throw new Error(
        `Invalid selector at "${input.slice(pos)}" — expected field:value or field~"regex" ` +
          `(fields: id, text, role, label, value)${unquotedSpaceHint(conditions, input.slice(pos))}`,
      );
    }
    conditions.push({
      field: match[1] as Field,
      op: match[2] === '~' ? 're' : 'eq',
      value: match[3] ?? match[4],
    });
    pos = CONDITION_RE.lastIndex;
    while (input[pos] === ' ') pos++;
  }
  return conditions;
}

/**
 * `text:SIGN IN` parses `text:SIGN` and then fails at `IN` — the error would
 * name the second word, not the rule (measured 2026-09-17: three dead device
 * calls before the caller guessed the quoting). Spell out the rule and the
 * probable fix — but ONLY when spaces are the defect: for `bogus:x` the true
 * diagnosis is the field list, and a lecture about quoting would steer past it.
 */
function unquotedSpaceHint(parsed: Condition[], rest: string): string {
  const last = parsed.at(-1);
  if (!last || /^\S+[:~]/.test(rest)) return ''; // the rest is itself a (mis-spelled?) condition
  const rule = '. A value containing spaces must be double-quoted: text:"Sign in" (exact) or text~"Sign in" (regex)';
  const op = last.op === 're' ? '~' : ':';
  // Take the leftover words up to the next condition, so the suggestion is
  // the whole value and copy-pasteable (JSON.stringify escapes embedded quotes).
  const words: string[] = [];
  for (const w of rest.split(' ')) {
    if (/^\S+[:~]/.test(w)) break;
    words.push(w);
  }
  const whole = `${last.value} ${words.join(' ')}`;
  // The grammar has no escape inside "…" (CONDITION_RE: "([^"]*)"), so a value
  // with a double quote cannot be written at all — say that instead of
  // suggesting a string the parser would reject (review 2026-09-18).
  if (whole.includes('"')) {
    return `${rule} — the value contains a double quote, which this grammar cannot express; match a distinctive part of it with ${last.field}~"…" instead`;
  }
  return `${rule} — did you mean ${last.field}${op}${JSON.stringify(whole)}?`;
}

function fieldValues(node: UiNode, field: Field): (string | null)[] {
  switch (field) {
    case 'id':
      return [node.identifier];
    case 'text':
      return [node.label, node.value];
    case 'role':
      return [node.role];
    case 'label':
      return [node.label];
    case 'value':
      return [node.value];
  }
}

function matches(node: UiNode, conditions: Condition[]): boolean {
  return conditions.every((cond) => {
    const values = fieldValues(node, cond.field).filter((v): v is string => v !== null);
    if (cond.op === 'eq') return values.includes(cond.value);
    const re = new RegExp(cond.value);
    return values.some((v) => re.test(v));
  });
}

export function findAll(root: UiNode, selector: Selector): UiNode[] {
  const conditions = parseSelector(selector);
  const found: UiNode[] = [];
  const walk = (node: UiNode) => {
    if (matches(node, conditions)) found.push(node);
    node.children.forEach(walk);
  };
  walk(root);
  return found;
}

/**
 * Roles a user can operate. Used to disambiguate selectors that also match
 * decorative text (e.g. on iOS a field's title and error label share the
 * field's accessibilityIdentifier).
 */
const INTERACTIVE_ROLES = new Set([
  'button',
  'textfield',
  'switch',
  'checkbox',
  'radiobutton',
  'slider',
]);

export const isInteractive = (node: UiNode): boolean => INTERACTIVE_ROLES.has(node.role);

/**
 * Pick a single target from multiple matches: when exactly one is interactive,
 * that is the one the author meant. Returns undefined when still ambiguous.
 */
export function preferInteractive(nodes: UiNode[]): { node: UiNode; note: string } | undefined {
  const interactive = nodes.filter(isInteractive);
  if (interactive.length !== 1) return undefined;
  const chosen = interactive[0];
  return {
    node: chosen,
    note: `${nodes.length} matches; picked the only interactive one (${chosen.role})`,
  };
}

/** Resolve a selector to one node, with a note when disambiguation kicked in. */
export function resolveOne(
  root: UiNode,
  selector: Selector,
): { node: UiNode; note?: string } {
  const found = findAll(root, selector);
  if (found.length === 0) throw new Error(`No element matches selector: ${selector}`);
  if (found.length === 1) return { node: found[0] };
  const preferred = preferInteractive(found);
  if (preferred) return preferred;
  const summary = found
    .slice(0, 5)
    .map((n) => `  ${n.role} id=${n.identifier} label=${JSON.stringify(n.label)}`)
    .join('\n');
  throw new Error(`Selector matches ${found.length} elements: ${selector}\n${summary}`);
}

/** Resolve a selector to exactly one node; throws with a helpful message otherwise. */
export function findOne(root: UiNode, selector: Selector): UiNode {
  return resolveOne(root, selector).node;
}

/**
 * Does the node's rect visibly intersect the screen? The shared meaning of
 * "gone": Android prunes off-screen nodes from its tree, iOS keeps them with
 * off-viewport rects — this check makes both read the same.
 */
export function intersectsViewport(
  rect: UiNode['rect'],
  viewport: { width: number; height: number },
): boolean {
  const w = Math.min(rect.x + rect.width, viewport.width) - Math.max(rect.x, 0);
  const h = Math.min(rect.y + rect.height, viewport.height) - Math.max(rect.y, 0);
  return w > 0 && h > 0;
}

/**
 * How much of the rect actually lies inside the viewport, as a fraction of its
 * own area (0 = fully outside, 1 = fully inside).
 *
 * The companion to `intersectsViewport`, which answers only "any overlap at
 * all". That predicate is the right stop condition for a scroll, but it is the
 * WRONG thing to report: measured 2026-08-27, a row clipped by the floating
 * bottom-nav bar intersected by 87% of its height, `scroll_until` reported a
 * bare "visible", and the next assert measured the CLIPPED rect — reading
 * h 143 against a pinned 60 and pointing the investigation at the app's
 * row-height logic, which was correct. A caller who is told the fraction can
 * see the clipping; a caller told "visible" cannot.
 */
export function visibleFractionInViewport(
  rect: UiNode['rect'],
  viewport: { width: number; height: number },
): number {
  if (rect.width <= 0 || rect.height <= 0) return 0;
  const w = Math.min(rect.x + rect.width, viewport.width) - Math.max(rect.x, 0);
  const h = Math.min(rect.y + rect.height, viewport.height) - Math.max(rect.y, 0);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (rect.width * rect.height);
}

/**
 * Which viewport edges the rect extends past, in the order a reader scans.
 * Named rather than counted because the edge IS the diagnosis: 'bottom' with
 * the content exhausted is a missing-clearance bug, 'top' is a sticky header
 * overlapping, and the two want different fixes.
 */
export function clippedEdges(
  rect: UiNode['rect'],
  viewport: { width: number; height: number },
): ('top' | 'bottom' | 'left' | 'right')[] {
  const out: ('top' | 'bottom' | 'left' | 'right')[] = [];
  if (rect.y < 0) out.push('top');
  if (rect.y + rect.height > viewport.height) out.push('bottom');
  if (rect.x < 0) out.push('left');
  if (rect.x + rect.width > viewport.width) out.push('right');
  return out;
}

/** Center of the node's rect — where taps land. */
export function tapPoint(node: UiNode): { x: number; y: number } {
  return {
    x: Math.round(node.rect.x + node.rect.width / 2),
    y: Math.round(node.rect.y + node.rect.height / 2),
  };
}

/** Exact-match element lookup; `text` matches label or value (selector semantics). */
export function findBySpec(root: UiNode, spec: ElementSpec): UiNode[] {
  const found: UiNode[] = [];
  const walk = (n: UiNode) => {
    const ok =
      (spec.id === undefined || n.identifier === spec.id) &&
      (spec.role === undefined || n.role === spec.role) &&
      (spec.label === undefined || n.label === spec.label) &&
      (spec.text === undefined || n.label === spec.text || n.value === spec.text);
    if (ok) found.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return found;
}
