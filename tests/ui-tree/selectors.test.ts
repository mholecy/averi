import { describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import type { ElementSpec } from '../../src/ui-tree/element-spec.js';
import { findAll, findBySpec, preferInteractive, parseSelector, tapPoint } from '../../src/ui-tree/selectors.js';

const node = (partial: Partial<UiNode>): UiNode => ({
  role: 'container',
  label: null,
  identifier: null,
  value: null,
  rect: { x: 0, y: 0, width: 100, height: 50 },
  children: [],
  ...partial,
});

const tree: UiNode = node({
  role: 'container',
  children: [
    node({ role: 'textfield', identifier: 'username_field', value: 'alice' }),
    node({ role: 'button', identifier: 'login_button', label: 'Log in' }),
    node({
      role: 'container',
      children: [
        node({ role: 'button', label: 'Pay now', rect: { x: 20, y: 200, width: 60, height: 40 } }),
        node({ role: 'button', label: 'Pay later' }),
        node({ role: 'text', label: 'Continue' }),
      ],
    }),
  ],
});

describe('parseSelector', () => {
  it('parses a single id condition', () => {
    expect(parseSelector('id:login_button')).toEqual([
      { field: 'id', op: 'eq', value: 'login_button' },
    ]);
  });

  it('parses quoted values with spaces', () => {
    expect(parseSelector('text:"Log in"')).toEqual([{ field: 'text', op: 'eq', value: 'Log in' }]);
  });

  it('parses multiple conditions including regex', () => {
    expect(parseSelector('role:button label~"Pay.*"')).toEqual([
      { field: 'role', op: 'eq', value: 'button' },
      { field: 'label', op: 're', value: 'Pay.*' },
    ]);
  });

  it('rejects unknown fields and garbage', () => {
    expect(() => parseSelector('bogus:x')).toThrow(/Invalid selector/);
    // The quoting rule is prescribed ONLY when spaces are the defect — an unknown
    // field or garbage gets the field list, not a lecture about quoting.
    expect(() => parseSelector('bogus:x')).not.toThrow(/double-quoted/);
    expect(() => parseSelector('@@@')).not.toThrow(/double-quoted/);
    expect(() => parseSelector('text:a bogus:x')).not.toThrow(/double-quoted/);
    // Measured 2026-09-17: `text:SIGN IN` failed at "IN" and the caller read the
    // second word, not the rule — the error must state the quoting rule and the fix.
    expect(() => parseSelector('text:SIGN IN')).toThrow(
      /Invalid selector at "IN".*must be double-quoted.*did you mean text:"SIGN IN"\?/s,
    );
    expect(() => parseSelector('label~Pay now please')).toThrow(/did you mean label~"Pay now please"\?/);
    expect(() => parseSelector('role:button text:Sign in now')).toThrow(/did you mean text:"Sign in now"\?/);
    expect(() => parseSelector('text:Sign in role:button')).toThrow(/did you mean text:"Sign in"\?/); // stops at the next condition
    // The grammar has no escape inside "…": say so instead of suggesting a string it would reject.
    expect(() => parseSelector('text:a" b')).toThrow(/cannot express; match a distinctive part of it with text~/);
    expect(() => parseSelector('text:a" b')).not.toThrow(/did you mean/);
    expect(() => parseSelector('text:a bogus:x')).not.toThrow(/did you mean/);
    // The quoted exact form was always valid — a3's "correct form is the regex" was wrong.
    expect(parseSelector('text:"SIGN IN"')).toEqual([{ field: 'text', op: 'eq', value: 'SIGN IN' }]);
    expect(() => parseSelector('')).toThrow(/Empty selector/);
  });
});

describe('findAll / findOne', () => {
  it('finds by id anywhere in the tree', () => {
    const found = findAll(tree, 'id:login_button');
    expect(found).toHaveLength(1);
    expect(found[0].label).toBe('Log in');
  });

  it('text: matches label or value', () => {
    expect(findAll(tree, 'text:"Log in"')).toHaveLength(1);
    expect(findAll(tree, 'text:alice')[0].identifier).toBe('username_field');
  });

  it('combines role and regex label conditions', () => {
    const found = findAll(tree, 'role:button label~"Pay.*"');
    expect(found.map((n) => n.label)).toEqual(['Pay now', 'Pay later']);
  });

  it('preferInteractive picks the sole interactive node when labels share the id (iOS field convention)', () => {
    // Measured on the payment form: textfield + title label + error label all
    // carry the field's accessibilityIdentifier.
    const shared: UiNode = node({
      children: [
        node({ role: 'textfield', identifier: 'payment.form.amount_input' }),
        node({ role: 'text', identifier: 'payment.form.amount_input', label: 'Amount' }),
        node({ role: 'text', identifier: 'payment.form.amount_input', label: 'Value is too small' }),
      ],
    });
    const preferred = preferInteractive(findAll(shared, 'id:payment.form.amount_input'));
    expect(preferred?.node.role).toBe('textfield');
    expect(preferred?.note).toMatch(/3 matches.*interactive/);
  });

  it('preferInteractive stays undecided when several interactive nodes match', () => {
    const twoButtons: UiNode = node({
      children: [
        node({ role: 'button', identifier: 'dup', label: 'A' }),
        node({ role: 'button', identifier: 'dup', label: 'B' }),
      ],
    });
    expect(preferInteractive(findAll(twoButtons, 'id:dup'))).toBeUndefined();
  });
});

describe('tapPoint', () => {
  it('returns the rect center', () => {
    const target = findAll(tree, 'label:"Pay now"')[0];
    expect(tapPoint(target)).toEqual({ x: 50, y: 220 });
  });
});

/**
 * findBySpec is derived from the selector matcher since 2026-10-04
 * (`findMatching(root, conditionsOf(spec))`, eq-only). Before, it was a second
 * matcher over the spec's four fields, written by hand — and a second place
 * where "what does `text` mean" could drift. This is the frozen body it
 * replaced, kept here as the oracle: a 2026-10-04 probe over 512 specs × 513
 * nodes found zero differences, and this test keeps it that way. The two
 * traps the probe surfaced are pinned below: the spec must NEVER be
 * serialized into a selector string (the grammar has no escape for `"`, so
 * 120 of those 512 specs would throw), and `text: 'Pay.*'` is a literal, not
 * a regex.
 *
 * DO NOT EDIT — frozen copy of the 2026-10-04 HEAD body; delete once trusted.
 */
function legacyFindBySpec(root: UiNode, spec: ElementSpec): UiNode[] {
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

describe('findBySpec — derived from the selector matcher, behaviour-identical to the hand-written one it replaced', () => {
  // Every combination of identifier × label × value over values that exercise
  // null, the empty string, regex metacharacters, spaces and a double quote.
  // Every sixth node hangs under the one before it, so an ancestor and its
  // descendant can both match one spec — that is what makes the pre-order
  // half of the assertion below mean something beyond the `{}` case.
  const VALUES = [null, '', 'Pay', 'Pay.*', 'a b', 'say "hi"'] as const;
  const ROLES = ['button', 'text', 'other'] as const;
  const leaves: UiNode[] = [];
  let count = 0;
  for (const identifier of VALUES) {
    for (const label of VALUES) {
      for (const value of VALUES) {
        const n = node({ identifier, label, value, role: ROLES[count % ROLES.length] });
        if (count % 6 === 5) leaves[leaves.length - 1].children.push(n);
        else leaves.push(n);
        count++;
      }
    }
  }
  const combinatorial: UiNode = node({ role: 'container', children: leaves });
  const nested = leaves.filter((l) => l.children.length > 0).length;

  const specValues = [undefined, ...VALUES.filter((v): v is Exclude<typeof v, null> => v !== null)];
  const specs: ElementSpec[] = [];
  for (const id of specValues) {
    for (const text of specValues) {
      for (const role of [undefined, 'button', 'text', ''] as const) {
        for (const label of [undefined, 'Pay', 'Pay.*', 'a b', '', 'say "hi"'] as const) {
          const spec: ElementSpec = {};
          if (id !== undefined) spec.id = id;
          if (text !== undefined) spec.text = text;
          if (role !== undefined) spec.role = role;
          if (label !== undefined) spec.label = label;
          specs.push(spec);
        }
      }
    }
  }

  it(`returns the same nodes, by identity and in pre-order, as the legacy matcher for ${specs.length} specs over ${count + 1} nodes`, () => {
    expect(specs.length).toBeGreaterThan(500);
    expect(nested).toBeGreaterThan(30);
    let nonEmpty = 0;
    let nestedMatches = 0;
    for (const spec of specs) {
      const expected = legacyFindBySpec(combinatorial, spec);
      const actual = findBySpec(combinatorial, spec);
      if (expected.length > 0) nonEmpty++;
      // A parent and its child both in the result is the order-sensitive case.
      if (expected.some((n, i) => i > 0 && expected[i - 1].children.includes(n))) nestedMatches++;
      expect(actual.length, JSON.stringify(spec)).toBe(expected.length);
      actual.forEach((n, i) => expect(n, JSON.stringify(spec)).toBe(expected[i]));
    }
    // The oracle is only worth something if it actually matched things — and
    // matched ancestor+descendant pairs, or pre-order would go unexercised.
    expect(nonEmpty).toBeGreaterThan(100);
    expect(nestedMatches).toBeGreaterThan(10);
  });

  it('a value containing a double quote resolves — the spec is never serialized into the selector grammar', () => {
    expect(() => findBySpec(combinatorial, { text: 'say "hi"' })).not.toThrow();
    expect(findBySpec(combinatorial, { text: 'say "hi"' })).toEqual(legacyFindBySpec(combinatorial, { text: 'say "hi"' }));
    expect(findBySpec(combinatorial, { text: 'say "hi"' }).length).toBeGreaterThan(0);
  });

  it('text is a literal, never a regex: `Pay.*` matches the node whose label IS "Pay.*", not every "Pay…"', () => {
    const literal = findBySpec(combinatorial, { text: 'Pay.*' });
    expect(literal.length).toBeGreaterThan(0);
    expect(literal.every((n) => n.label === 'Pay.*' || n.value === 'Pay.*')).toBe(true);
    expect(literal.length).toBeLessThan(findAll(combinatorial, 'text~"Pay.*"').length);
  });

  it('text matches label OR value, exactly as the selector grammar says', () => {
    expect(findBySpec(tree, { text: 'Log in' })).toHaveLength(1);
    expect(findBySpec(tree, { text: 'alice' })[0].identifier).toBe('username_field');
  });

  it('extra, non-selector keys on the payload are ignored (a fill step carries `value`, a tap step `timeout`)', () => {
    const payload = { id: 'username_field', value: 'zzz', timeout: '2s' } as ElementSpec;
    expect(findBySpec(tree, payload)).toEqual(legacyFindBySpec(tree, { id: 'username_field' }));
    expect(findBySpec(tree, payload)).toHaveLength(1);
  });

  it('DOCUMENTED DEVIATION: a runtime null field matches nothing (the legacy `===` matched null-fielded nodes); the zod string schemas make it unreachable', () => {
    const nullId = { id: null } as unknown as ElementSpec;
    expect(legacyFindBySpec(combinatorial, nullId).length).toBeGreaterThan(0);
    expect(findBySpec(combinatorial, nullId)).toEqual([]);
    const nullText = { text: null } as unknown as ElementSpec;
    expect(legacyFindBySpec(combinatorial, nullText).length).toBeGreaterThan(0);
    expect(findBySpec(combinatorial, nullText)).toEqual([]);
  });

  it('an empty spec matches every node, in pre-order', () => {
    expect(findBySpec(tree, {})).toEqual(legacyFindBySpec(tree, {}));
    expect(findBySpec(tree, {})[0]).toBe(tree);
  });
});
