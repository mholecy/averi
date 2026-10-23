import { describe, expect, it } from 'vitest';
import { seenOrderOf } from '../../src/ui-tree/seen-order.js';
import { node } from '../helpers/fake.js';

// THE ORDER SEEN (ui-tree/seen-order.ts) read either way round: what the eyes saw of a node against a peer, from the
// node's side and from the peer's.
describe('seenOrderOf — either way round', () => {
  const field = node({ role: 'textfield', identifier: 'field' });
  const title = node({ role: 'text', identifier: 'title' });
  const other = node({ role: 'text', identifier: 'other' });

  it('over and under swap sides, their colours with them', () => {
    const seen = seenOrderOf(field, [{ peer: title, seen: 'over', overlap: '#111111', own: '#111111', other: '#222222' }]);
    expect(seen.between(field, title)).toEqual({ seen: 'over', overlap: '#111111', own: '#111111', other: '#222222' });
    expect(seen.between(title, field)).toEqual({ seen: 'under', overlap: '#111111', own: '#222222', other: '#111111' });
  });

  it("clear is the peer's nothing painted over the node — from the peer's side it says nothing (no excuse of the node as the peer's cover)", () => {
    const seen = seenOrderOf(field, [{ peer: title, seen: 'clear', overlap: '#FFFFFF', beside: '#FFFFFF' }]);
    expect(seen.between(field, title)).toEqual({ seen: 'clear', overlap: '#FFFFFF', beside: '#FFFFFF' });
    expect(seen.between(title, field)).toBeUndefined();
  });

  it('a pair not looked at: nothing', () => {
    const seen = seenOrderOf(field, [{ peer: title, seen: 'clear', overlap: '#FFFFFF', beside: '#FFFFFF' }]);
    expect(seen.between(field, other)).toBeUndefined();
    expect(seen.between(title, other)).toBeUndefined();
  });
});
