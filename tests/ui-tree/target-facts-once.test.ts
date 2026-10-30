import { describe, expect, it, vi } from 'vitest';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { IPHONE, judged, list, sheet } from '../helpers/presented-trees.js';

// WHAT DRAW ORDER KNOWS OF A TARGET (ui-tree/draw-order.ts#drawOrder's `asTarget`): what is presented over it, where its
// reading order breaks, what its listing says — the same for every question about the node, so built once per node of
// one draw order and kept, however many questions a verb asks of it (a tap's exposure, its covers, the presented surface
// over it, a pixel assert's own).

describe('a target’s facts are built once per node and draw order', () => {
  it('every question about one node asks the presentation over it once; another node is asked its own', () => {
    const { row, title, layer: beneath } = list();
    const { layer } = sheet();
    const order = drawOrder(judged(beneath, layer));
    const over = vi.spyOn(order.presentation, 'over');
    order.exposure(row, IPHONE);
    order.coversOf(row, row.rect);
    order.presentedOver(row);
    order.presentedAt(row, { x: 201, y: 726 });
    order.paintsOver(row, row.rect);
    expect(over.mock.calls.map(([n]) => n)).toEqual([row]);
    order.exposure(title, IPHONE);
    expect(over.mock.calls.map(([n]) => n)).toEqual([row, title]);
  });
});
