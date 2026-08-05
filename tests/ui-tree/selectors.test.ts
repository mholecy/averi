import { describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import {
  findAll,
  findOne,
  intersectsViewport,
  parseSelector,
  resolveOne,
  tapPoint,
} from '../../src/ui-tree/selectors.js';

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

  it('findOne throws on zero and on multiple matches', () => {
    expect(() => findOne(tree, 'id:nope')).toThrow(/No element matches/);
    expect(() => findOne(tree, 'role:button label~"Pay.*"')).toThrow(/matches 2 elements/);
    expect(findOne(tree, 'id:login_button').role).toBe('button');
  });

  it('disambiguates to the sole interactive node when labels share the id (iOS field convention)', () => {
    // Measured on the payment form: textfield + title label + error label all
    // carry the field's accessibilityIdentifier.
    const shared: UiNode = node({
      children: [
        node({ role: 'textfield', identifier: 'payment.form.amount_input' }),
        node({ role: 'text', identifier: 'payment.form.amount_input', label: 'Amount' }),
        node({ role: 'text', identifier: 'payment.form.amount_input', label: 'Value is too small' }),
      ],
    });
    const { node: chosen, note } = resolveOne(shared, 'id:payment.form.amount_input');
    expect(chosen.role).toBe('textfield');
    expect(note).toMatch(/3 matches.*interactive/);
    expect(findOne(shared, 'id:payment.form.amount_input').role).toBe('textfield');
  });

  it('still errors when multiple interactive nodes match', () => {
    const twoButtons: UiNode = node({
      children: [
        node({ role: 'button', identifier: 'dup', label: 'A' }),
        node({ role: 'button', identifier: 'dup', label: 'B' }),
      ],
    });
    expect(() => resolveOne(twoButtons, 'id:dup')).toThrow(/matches 2 elements/);
  });
});

describe('intersectsViewport', () => {
  const vp = { width: 400, height: 800 };
  it('true for on-screen rects, false for off-viewport and zero-area rects', () => {
    expect(intersectsViewport({ x: 10, y: 10, width: 50, height: 50 }, vp)).toBe(true);
    expect(intersectsViewport({ x: 390, y: 790, width: 50, height: 50 }, vp)).toBe(true); // partial
    expect(intersectsViewport({ x: 0, y: 900, width: 50, height: 50 }, vp)).toBe(false); // below
    expect(intersectsViewport({ x: -60, y: 10, width: 50, height: 50 }, vp)).toBe(false); // left
    expect(intersectsViewport({ x: 0, y: -100, width: 400, height: 100 }, vp)).toBe(false); // edge-touching
    expect(intersectsViewport({ x: 10, y: 10, width: 0, height: 0 }, vp)).toBe(false); // zero-area
  });
});

describe('tapPoint', () => {
  it('returns the rect center', () => {
    const target = findOne(tree, 'label:"Pay now"');
    expect(tapPoint(target)).toEqual({ x: 50, y: 220 });
  });
});
