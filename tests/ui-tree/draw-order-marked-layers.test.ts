import { describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { node } from '../helpers/fake.js';
import { IPHONE, judged, list, popover, rect, sheet } from '../helpers/presented-trees.js';

// A LAYER the tree source marks as presented (`UiNode.presentation`, on a Window's direct child) covers what lies
// OUTSIDE it and is drawn before it, through the whole screen. A layer typed by its element (an alert, an action
// sheet, a popover) has that element as its one cover, named by it; a `screen` layer reaches the whole screen and its
// own nodes stay covers, each a presented surface — so the cover named is what is at the point, the anonymous layer
// only where nothing of it draws. On a tree whose source judged presented layers (`presentationsJudged`) no shape is
// asked. These are draw order's readings of the presentation module's facts (the covers it names, where a tap goes,
// what of a layer it names for no target); the facts themselves — which adapter, the cover, the press, the topmost
// layer — are pinned through the module's interface in tests/ui-tree/presentation.test.ts.

const desc = (n: UiNode | undefined): string | undefined => n && `${n.role} ${n.identifier ?? n.label ?? ''} ${n.rect.x},${n.rect.y} ${n.rect.width}x${n.rect.height}`.replace('  ', ' ');
const exposed = (tree: UiNode, target: UiNode) => {
  const seen = drawOrder(tree).exposure(target, IPHONE);
  return { covers: seen.covers.map((c) => ({ node: desc(c.node), order: c.order.kind, presented: c.presented })), centreCover: desc(seen.centreCover), shows: seen.shows, tapAt: seen.tapAt };
};
/** A cover drawn over the target that is the surface of the screen presented over it (`Cover.presented`) — or, `presented: false`, any other. */
const surface = (node: string, presented = true) => ({ node, order: 'drawn', presented });

const SHEET_PROMPT = 'other Are you sure? 10,78 240x169';
const LAYER = 'container 0,0 402x874';

describe('a layer typed by its element: the element is its one cover, outside the layer only', () => {
  it('a row of the screen beneath is covered by the action sheet alone, reaching the whole screen — the dim before it is drawn on it, no cover of its own', () => {
    const { row, layer: beneath } = list();
    const { layer } = popover();
    expect(exposed(judged(beneath, layer), row)).toEqual({ covers: [surface(SHEET_PROMPT)], centreCover: SHEET_PROMPT, shows: 0, tapAt: undefined });
  });

  it('a node of the typed layer ITSELF is not beneath it: the popover\'s own `dismiss popup` — the way to close it — and its buttons are reached at their centre', () => {
    const { row, layer: beneath } = list();
    const { dim, discard, layer } = popover();
    const tree = judged(beneath, layer);
    // The popover's own button lies on its dim as on any node drawn before it — an ordinary cover, no presented
    // surface.
    expect(exposed(tree, dim)).toMatchObject({ covers: [surface('button Discard Changes 10,160 240x44', false)], tapAt: { point: { x: 201, y: 437 }, moved: false } });
    expect(exposed(tree, discard)).toMatchObject({ covers: [], tapAt: { moved: false } });
    expect(drawOrder(tree).presentedOver(dim)).toBeUndefined();
    expect(desc(drawOrder(tree).presentedOver(row))).toBe(SHEET_PROMPT);
  });

});

describe('a `screen` layer: the whole screen, its own nodes named where they draw', () => {
  it('a row beneath, under the sheet\'s own row at its centre: covered, the sheet\'s row named at the centre — a presented surface — and the layer reaching the whole screen', () => {
    const { row, layer: beneath } = list();
    const { layer } = sheet();
    expect(exposed(judged(beneath, layer), row)).toEqual({
      covers: [surface(LAYER), surface('button add phone 20,690 362x52')],
      centreCover: 'button add phone 20,690 362x52',
      shows: 0,
      tapAt: undefined,
    });
  });

  it('where nothing of the layer draws — the status strip above the sheet — the anonymous layer is the cover named', () => {
    const { title, layer: beneath } = list();
    const { layer } = sheet();
    expect(exposed(judged(beneath, layer), title)).toEqual({ covers: [surface(LAYER)], centreCover: LAYER, shows: 0, tapAt: undefined });
  });

  it('the presented questions agree at every touch-down: `presentedAt` names what of the layer is on top there, else the layer; `presentedOver` the last drawn', () => {
    const { row, title, layer: beneath } = list();
    const { cancel, layer } = sheet();
    const order = drawOrder(judged(beneath, layer));
    expect(desc(order.presentedAt(row, { x: 201, y: 715 }))).toBe('button add phone 20,690 362x52');
    expect(desc(order.presentedAt(row, { x: 300, y: 40 }))).toBe(LAYER);
    expect(desc(order.presentedAt(title, { x: 40, y: 80 }))).toBe(desc(cancel));
    expect(order.presentedOver(row)).toBeDefined();
  });

  it('the sheet\'s own nodes are not beneath it: its field and Cancel are reached at their centre', () => {
    const { layer: beneath } = list();
    const { field, cancel, layer } = sheet();
    const tree = judged(beneath, layer);
    for (const own of [field, cancel]) {
      expect(exposed(tree, own)).toMatchObject({ covers: [], tapAt: { moved: false } });
      expect(drawOrder(tree).presentedOver(own)).toBeUndefined();
    }
  });

  it('a stroke for NO target lands on a `screen` layer (`markedAt`): what of the layer draws at the touch-down, the layer where nothing does', () => {
    const { layer: beneath } = list();
    const { cancel, layer } = sheet();
    const order = drawOrder(judged(beneath, layer));
    expect(desc(order.markedAt({ x: 40, y: 80 }))).toBe(desc(cancel));
    expect(desc(order.markedAt({ x: 300, y: 40 }))).toBe(LAYER);
    expect(order.presentation.press(order.markedAt({ x: 300, y: 40 })!)).toEqual({ surface: layer, reach: IPHONE, layer: { kind: 'screen' } });
  });

  it('a bare full-screen wrapper of the layer is not what is named there: it draws nothing of its own', () => {
    const { layer: beneath } = list();
    const { layer } = sheet();
    const wrapper = node({ role: 'container', rect: IPHONE, children: [...layer.children] });
    layer.children.splice(0, layer.children.length, wrapper);
    const named = drawOrder(judged(beneath, layer)).markedAt({ x: 300, y: 40 });
    expect(named).toBe(layer);
    expect(named).not.toBe(wrapper);
  });

  /** A sheet whose form is no scroll view, holding `extra` over the list's row; the touch-down at (201,699). */
  const formSheet = (extra: UiNode) => {
    const { row, layer: beneath } = list();
    const form = node({ role: 'container', identifier: 'form', rect: rect(0, 118, 402, 756), children: [extra] });
    const layer = node({ role: 'container', rect: IPHONE, presentation: 'screen', children: [form] });
    return { row, form, order: drawOrder(judged(beneath, layer)) };
  };
  const TOUCH_DOWN = { x: 201, y: 699 };

  it('a hidden node of the layer at the touch-down is not named for no target: what of the layer shows there is, as for a target', () => {
    const { row, form, order } = formSheet(node({ role: 'text', label: 'Parked', hidden: true, rect: rect(0, 690, 402, 30) }));
    expect(order.markedAt(TOUCH_DOWN)).toBe(form);
    expect(order.markedAt(TOUCH_DOWN)).toBe(order.presentedAt(row, TOUCH_DOWN));
  });

  it('a HIDDEN scroll view of the layer at the touch-down keeps no stroke going: the stroke lands on the layer, as for a target', () => {
    const scroll = node({ role: 'scrollable', hidden: true, rect: rect(0, 600, 402, 200), children: [node({ role: 'text', label: 'x', hidden: true, rect: rect(0, 610, 402, 30) })] });
    const { row, form, order } = formSheet(scroll);
    expect(order.markedAt(TOUCH_DOWN)).toBe(form);
    expect(order.markedAt(TOUCH_DOWN)).toBe(order.presentedAt(row, TOUCH_DOWN));
  });

  it('a lower layer marked `screen` under a typed one: a row beneath both is covered by the typed element on top, a node of the sheet by the typed element only', () => {
    const { row, layer: beneath } = list();
    const { field, layer: sheetLayer } = sheet();
    const { layer } = popover();
    const tree = judged(beneath, sheetLayer, layer);
    expect(exposed(tree, row).centreCover).toBe(SHEET_PROMPT);
    expect(exposed(tree, field)).toMatchObject({ covers: [surface(SHEET_PROMPT)], centreCover: SHEET_PROMPT, shows: 0 });
  });
});
