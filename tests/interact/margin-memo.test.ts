import { describe, expect, it } from 'vitest';
import type { Rect } from '../../src/adapters/types.js';
import { carriedCover, recall, remember } from '../../src/interact/margin-memo.js';
import type { OrderSeen } from '../../src/ui-tree/seen-order.js';
import { node } from '../helpers/fake.js';

/**
 * THE MARGIN MEMO: how long what the eyes saw of a margin text holds — `under` while the pair keeps its relation (where
 * it was, or carried together in a scroll view that stayed put), `clear` and `untold` only where they were seen; a text
 * asked again replaces its entry. The lab form's phone field and the title below it (the after-back capture).
 */
describe('the margin memo', () => {
  const list: Rect = { x: 0, y: 200, width: 1080, height: 1800 };
  const field: Rect = { x: 55, y: 1280, width: 970, height: 132 };
  const title = node({ role: 'TextView', label: 'Variable symbol', rect: { x: 55, y: 1406, width: 258, height: 56 } });
  const by = (r: Rect, dx: number, dy: number): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });
  const at = (dy: number, peerDy = dy, scrollView: Rect | undefined = list) => ({ target: by(field, 0, dy), peer: by(title.rect, 0, peerDy), scrollView });
  const under: OrderSeen = { peer: title, seen: 'under', overlap: '#202020', own: '#ffffff', other: '#202020' };
  const clear: OrderSeen = { peer: title, seen: 'clear', overlap: '#ffffff', beside: '#ffffff' };
  const seenUnder = remember([], [under], field, list);
  const seenClear = remember([], [clear], field, list);

  it('an under where it was seen, and carried together: told; its carry the offset', () => {
    expect(recall(seenUnder, title, at(0))?.seen).toBe('under');
    expect(recall(seenUnder, title, at(-300))?.seen).toBe('under');
    expect(carriedCover(seenUnder, title, at(-300))).toEqual({ dx: 0, dy: -300 });
    expect(carriedCover(seenUnder, title, at(0))).toBeUndefined();
  });

  it('an under whose text stayed put while the field moved (a pinned text), or whose scroll view moved too: asked again, no carry', () => {
    expect(recall(seenUnder, title, at(-300, 0))).toBeUndefined();
    expect(carriedCover(seenUnder, title, at(-300, 0))).toBeUndefined();
    expect(recall(seenUnder, title, at(-300, -300, by(list, 0, -300)))).toBeUndefined();
    expect(recall(seenUnder, title, { ...at(-300), scrollView: undefined })).toBeUndefined();
  });

  it('a clear: told where it was seen only, never a carry', () => {
    expect(recall(seenClear, title, at(0))?.seen).toBe('clear');
    expect(recall(seenClear, title, at(-300))).toBeUndefined();
    expect(carriedCover(seenClear, title, at(-300))).toBeUndefined();
  });

  it('a text asked again replaces its entry', () => {
    const again = remember(seenUnder, [{ ...clear, peer: { ...title, rect: by(title.rect, 0, -300) } }], by(field, 0, -300), list);
    expect(again).toHaveLength(1);
    expect(recall(again, title, at(-300))?.seen).toBe('clear');
  });
});
