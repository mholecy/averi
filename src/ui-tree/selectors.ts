import type { Selector, UiNode } from '../adapters/types.js';
import type { ElementSpec } from '../flow/config.js';

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
          `(fields: id, text, role, label, value)`,
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
