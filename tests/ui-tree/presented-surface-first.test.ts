import { describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { node } from '../helpers/fake.js';
import { judged, list, rect, sheet } from '../helpers/presented-trees.js';

// THE PRESENTED SURFACE OVER A NODE (ui-tree/draw-order.ts#DrawOrder.presentedOver, `presentedAt`): the last node drawn
// after it that draws for it as a target AND is the surface of a screen presented over its own. Both are pure
// questions of the same node, so the cheap one — whether it is such a surface (presentation.ts#PresentedOver.surface,
// on most nodes no) — is asked first, and the `target` column's rows, the costly one, only of a surface.

/**
 * `n`, whose role throws `asked` once `arm` is called: a node the rows must not judge. On a tree whose source judged
 * presented layers the presentation reads no role of a later node, and the rows do (the frame excuses read it).
 */
const unjudgeable = (n: UiNode, asked: string): { readonly node: UiNode; readonly arm: () => void } => {
  let armed = false;
  const role = n.role;
  Object.defineProperty(n, 'role', {
    get: () => {
      if (armed) throw new Error(asked);
      return role;
    },
  });
  return { node: n, arm: () => (armed = true) };
};

describe('presentedOver — the cheap surface test before the rows', () => {
  it('a node drawn after the target that is no presented surface is never judged by the rows', () => {
    const { row, layer } = list();
    const later = unjudgeable(node({ role: 'container', rect: rect(0, 650, 402, 150) }), 'the rows judged a node that is no presented surface');
    const order = drawOrder(judged(layer, later.node));
    later.arm();
    expect(order.presentedOver(row)).toBeUndefined();
    expect(order.presentedAt(row, { x: 201, y: 726 })).toBeUndefined();
  });

  it('a presented surface is still judged by the rows: the sheet’s button over a row is named, its form — a scroll view the rows excuse — is not', () => {
    const { row, layer: beneath } = list();
    const { addPhone, layer } = sheet();
    const order = drawOrder(judged(beneath, layer));
    // the last surface drawing for the row: the form's button, listed after the form
    expect(order.presentedOver(row)).toBe(addPhone);
    // at the form's empty middle the form — a surface, but a scroll view the rows excuse — is not named: the layer is
    expect(order.presentedAt(row, { x: 201, y: 500 })).toBe(layer);
  });
});
