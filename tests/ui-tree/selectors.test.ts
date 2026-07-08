import { describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { findAll, findOne, parseSelector, tapPoint } from '../../src/ui-tree/selectors.js';

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
});

describe('tapPoint', () => {
  it('returns the rect center', () => {
    const target = findOne(tree, 'label:"Pay now"');
    expect(tapPoint(target)).toEqual({ x: 50, y: 220 });
  });
});
