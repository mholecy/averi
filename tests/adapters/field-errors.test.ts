import { describe, expect, it } from 'vitest';
import { attachFieldErrors, everyNode } from '../../src/adapters/field-errors.js';
import type { UiNode } from '../../src/adapters/types.js';
import { node } from '../helpers/fake.js';

/**
 * The field/error pairing rule now has ONE owner shared by both iOS tree
 * sources (idb's flat list, WDA's nested tree). That makes it worth pinning
 * properly: a change here silently changes both platforms at once, and the
 * previous fixtures only ever had one field and one candidate — so most of
 * the rule was passing by coincidence rather than by test.
 */

const field = (id: string, y: number, height = 20): UiNode =>
  node({ role: 'textfield', identifier: id, rect: { x: 0, y, width: 100, height } });

const text = (id: string | null, y: number, label: string | null): UiNode =>
  node({ role: 'text', identifier: id, label, rect: { x: 0, y, width: 100, height: 10 } });

describe('field/error pairing', () => {
  it('pairs the NEAREST error below the field, whatever order they arrive in', () => {
    const target = field('amount', 100);
    // Far candidate FIRST: document order disagrees with distance, so this
    // fails unless the rule genuinely sorts by y.
    attachFieldErrors([text('amount', 500, 'Far away'), target, text('amount', 130, 'Nearest')]);
    expect(target.error).toBe('Nearest');
  });

  it('never borrows an error belonging to a different field', () => {
    const amount = field('amount', 100);
    const iban = field('iban', 300);
    attachFieldErrors([amount, iban, text('iban', 340, 'Invalid IBAN')]);
    expect(amount.error).toBeUndefined();
    expect(iban.error).toBe('Invalid IBAN');
  });

  it('ignores the title ABOVE the field and takes only what is below it', () => {
    const target = field('amount', 100, 20);
    attachFieldErrors([text('amount', 80, 'Amount'), target, text('amount', 125, 'Too large')]);
    expect(target.error).toBe('Too large');
  });

  it('ignores a text overlapping the field itself — below means below the BOTTOM', () => {
    const target = field('amount', 100, 20); // spans y 100..120
    // A same-identifier text inside the field's own span (an inline
    // placeholder) is not an error message; the real one sits under the field.
    attachFieldErrors([target, text('amount', 110, 'Placeholder'), text('amount', 125, 'Too large')]);
    expect(target.error).toBe('Too large');
  });

  it('counts a text starting exactly at the field bottom as below it', () => {
    const target = field('amount', 100, 20); // bottom = 120
    attachFieldErrors([target, text('amount', 120, 'Required')]);
    expect(target.error).toBe('Required');
  });

  it('ignores a same-identifier text that has no label', () => {
    const target = field('amount', 100);
    attachFieldErrors([target, text('amount', 130, null)]);
    expect(target.error).toBeUndefined();
  });

  it('ignores a non-text node below the field', () => {
    const target = field('amount', 100);
    const button = node({
      role: 'button',
      identifier: 'amount',
      label: 'Clear',
      rect: { x: 0, y: 130, width: 40, height: 10 },
    });
    attachFieldErrors([target, button]);
    expect(target.error).toBeUndefined();
  });

  it('leaves a field with no candidate untouched', () => {
    const target = field('amount', 100);
    attachFieldErrors([target, text('other', 130, 'Unrelated')]);
    expect(target.error).toBeUndefined();
  });
});

describe('everyNode', () => {
  it('yields the root and every descendant, pre-order', () => {
    const tree = node({
      identifier: 'root',
      children: [
        node({ identifier: 'a', children: [node({ identifier: 'a1' })] }),
        node({ identifier: 'b' }),
      ],
    });
    expect([...everyNode(tree)].map((n) => n.identifier)).toEqual(['root', 'a', 'a1', 'b']);
  });

  it('reaches a field and its error sitting in DIFFERENT branches', () => {
    const target = field('amount', 100);
    const tree = node({
      children: [node({ children: [target] }), node({ children: [text('amount', 130, 'Too large')] })],
    });
    // Rects are absolute, so a cross-branch pair must still be found — this is
    // the whole reason the nested WDA tree can reuse the flat rule.
    attachFieldErrors(everyNode(tree));
    expect(target.error).toBe('Too large');
  });
});
