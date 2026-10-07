import type { Selector, UiNode } from '../adapters/types.js';
import { SELECTOR_FIELDS, type ElementSpec } from './element-spec.js';

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

/** Every node under `root` (pre-order) that satisfies all `conditions`. The one walk both lookups share. */
function findMatching(root: UiNode, conditions: Condition[]): UiNode[] {
  const found: UiNode[] = [];
  const walk = (node: UiNode) => {
    if (matches(node, conditions)) found.push(node);
    node.children.forEach(walk);
  };
  walk(root);
  return found;
}

export function findAll(root: UiNode, selector: Selector): UiNode[] {
  return findMatching(root, parseSelector(selector));
}

/**
 * The structured spec as conditions — the SAME matcher the selector grammar
 * uses, so `text` means label-or-value in both forms by construction rather
 * than by two bodies agreeing. Every field is an exact match (`eq`): the spec
 * has no regex form, and `text: "Pay.*"` is the literal string. Built as
 * conditions directly, never by serializing the spec into a selector string —
 * the grammar has no escape inside `"…"`, so a value containing a double
 * quote could not be written at all (a 2026-10-04 probe: 120 of 512 specs).
 * Iterating SELECTOR_FIELDS means a payload carrying non-selector keys
 * (`value`, `timeout` on a fill/tap step) is ignored, as before, and a field
 * added to the spec schema is matched here with no edit.
 */
function conditionsOf(spec: ElementSpec): Condition[] {
  const conditions: Condition[] = [];
  for (const field of SELECTOR_FIELDS) {
    const value = spec[field];
    if (value !== undefined) conditions.push({ field, op: 'eq', value });
  }
  return conditions;
}

/**
 * Exact-match element lookup; `text` matches label or value (selector
 * semantics). Since 2026-10-04 this IS the selector matcher over
 * `conditionsOf(spec)`; before it was a second, hand-written matcher over the
 * same fields — identical on every probed input, and one edit away from not
 * being. Proved by a frozen copy of that matcher run as an oracle (zero
 * differences over 864 specs × 217 nodes); since 2026-10-05 pinned against
 * the definition itself in tests/ui-tree/selectors.test.ts — the oracle
 * hard-coded four fields and could not pin "a new field needs no edit".
 * One difference at the type's edge: a runtime `null` field now matches
 * nothing (the old `===` matched nodes whose field was null); the zod string
 * schemas make such a spec unreachable, so no behaviour changes.
 */
export function findBySpec(root: UiNode, spec: ElementSpec): UiNode[] {
  return findMatching(root, conditionsOf(spec));
}

/**
 * Roles a user can operate. Used to disambiguate selectors that also match
 * decorative text (e.g. on iOS a field's title and error label share the
 * field's accessibilityIdentifier).
 */
export const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
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

// `resolveOne` / `findOne` lived here until 2026-10-03: a second resolution
// policy (no zero-area filter, throw on ambiguity) used only by the MCP tap
// and type_text tools. The one policy is interact/resolve.ts#resolveNow.

// The viewport predicates (intersectsViewport, absentFromViewport,
// visibleFractionInViewport, clippedEdges) lived here until 2026-10-04; they
// are geometry, not selection, and sit in geometry.ts with the rest of it.

/** Center of the node's rect — where taps land. */
export function tapPoint(node: UiNode): { x: number; y: number } {
  return {
    x: Math.round(node.rect.x + node.rect.width / 2),
    y: Math.round(node.rect.y + node.rect.height / 2),
  };
}
