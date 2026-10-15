import { describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { node } from '../helpers/fake.js';

// A LAYER the tree source marks as presented (`UiNode.presentation`, on a Window's direct child) covers what lies
// OUTSIDE it and is drawn before it, through the whole screen. A layer typed by its element (an alert, an action
// sheet, a popover) has that element as its one cover, named by it; a `screen` layer reaches the whole screen and its
// own nodes stay covers, each a presented surface — so the cover named is what is at the point, the anonymous layer
// only where nothing of it draws. On a tree whose source judged presented layers (`presentationsJudged`) no shape is
// asked.

const IPHONE = { x: 0, y: 0, width: 402, height: 874 };
const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const desc = (n: UiNode | undefined): string | undefined => n && `${n.role} ${n.identifier ?? n.label ?? ''} ${n.rect.x},${n.rect.y} ${n.rect.width}x${n.rect.height}`.replace('  ', ' ');
const exposed = (tree: UiNode, target: UiNode) => {
  const seen = drawOrder(tree).exposure(target, IPHONE);
  return { covers: seen.covers.map(desc), centreCover: desc(seen.centreCover), presented: seen.presented.map(desc), shows: seen.shows, tapAt: seen.tapAt };
};

/** The app's Window with `layers`, under a root whose source judged presented layers. */
const judged = (...layers: UiNode[]): UiNode => node({ role: 'container', label: 'Example', rect: IPHONE, presentationsJudged: true, children: [node({ role: 'container', rect: IPHONE, children: layers })] });

/** The list screen beneath: a title in the status strip's height above the sheet, and a row low on the screen. */
const list = () => {
  const title = node({ role: 'text', identifier: 'title', label: 'Contacts', rect: rect(20, 20, 100, 30) });
  const row = node({ role: 'button', identifier: 'row', label: 'Kate Bell', rect: rect(20, 700, 362, 52) });
  return { title, row, layer: node({ role: 'container', rect: IPHONE, children: [title, row] }) };
};

/**
 * A page sheet's layer marked `screen`: its nav bar's Cancel, and its form with a field and a row over the list's row.
 */
const sheet = () => {
  const cancel = node({ role: 'button', label: 'Cancel', rect: rect(16, 72, 70, 36) });
  const field = node({ role: 'textfield', identifier: 'first_name', rect: rect(20, 300, 362, 44) });
  const addPhone = node({ role: 'button', label: 'add phone', rect: rect(20, 690, 362, 52) });
  const form = node({ role: 'scrollable', rect: rect(0, 118, 402, 756), children: [field, addPhone] });
  const layer = node({ role: 'container', rect: IPHONE, presentation: 'screen', children: [node({ role: 'container', rect: rect(0, 62, 402, 56), children: [cancel] }), form] });
  return { cancel, field, addPhone, form, layer };
};

/**
 * A popover's layer typed `actionSheet`: its dim `dismiss popup`, then the popover holding the action sheet, the
 * element.
 */
const popover = () => {
  const dim = node({ role: 'container', identifier: 'PopoverDismissRegion', label: 'dismiss popup', rect: IPHONE });
  const discard = node({ role: 'button', label: 'Discard Changes', rect: rect(10, 160, 240, 44) });
  const element = node({ role: 'other', label: 'Are you sure?', rect: rect(10, 78, 240, 169), presentationElement: true, children: [discard] });
  const layer = node({ role: 'container', rect: IPHONE, presentation: 'actionSheet', children: [dim, node({ role: 'container', rect: rect(10, 78, 240, 169), children: [element] })] });
  return { dim, discard, element, layer };
};
const SHEET_PROMPT = 'other Are you sure? 10,78 240x169';
const LAYER = 'container 0,0 402x874';

describe('a layer typed by its element: the element is its one cover, outside the layer only', () => {
  it('a row of the screen beneath is covered by the action sheet alone, reaching the whole screen — the dim before it is drawn on it, no cover of its own', () => {
    const { row, layer: beneath } = list();
    const { layer } = popover();
    expect(exposed(judged(beneath, layer), row)).toEqual({ covers: [SHEET_PROMPT], centreCover: SHEET_PROMPT, presented: [SHEET_PROMPT], shows: 0, tapAt: undefined });
  });

  it('a node of the typed layer ITSELF is not beneath it: the popover\'s own `dismiss popup` — the way to close it — and its buttons are reached at their centre', () => {
    const { row, layer: beneath } = list();
    const { dim, discard, layer } = popover();
    const tree = judged(beneath, layer);
    // The popover's own button lies on its dim as on any node drawn before it — an ordinary cover, no presented
    // surface.
    expect(exposed(tree, dim)).toMatchObject({ covers: ['button Discard Changes 10,160 240x44'], presented: [], tapAt: { point: { x: 201, y: 437 }, moved: false } });
    expect(exposed(tree, discard)).toMatchObject({ covers: [], presented: [], tapAt: { moved: false } });
    expect(drawOrder(tree).presentedOver(dim)).toBeUndefined();
    expect(desc(drawOrder(tree).presentedOver(row))).toBe(SHEET_PROMPT);
  });

  it('the press a sentence quotes: the element reaches the whole screen, handed on as its layer — the kind from the layer, the label from the element', () => {
    const { row, layer: beneath } = list();
    const { layer } = popover();
    const order = drawOrder(judged(beneath, layer));
    const element = order.presentedOver(row)!;
    expect(order.presentedPress(element)).toEqual({ surface: element, reach: IPHONE, layer: { kind: 'actionSheet', label: 'Are you sure?' } });
  });

  it('a stroke for no target: its touch-down beneath a typed layer lands on the element (`markedAt`) — not on the layer\'s own scroll view', () => {
    const { layer: beneath } = list();
    const { layer } = popover();
    const scrolling = node({ role: 'scrollable', rect: rect(10, 78, 240, 169), children: [node({ role: 'button', label: 'x', rect: rect(10, 78, 240, 44) })] });
    layer.children[1].children.push(scrolling);
    const order = drawOrder(judged(beneath, layer));
    expect(desc(order.markedAt({ x: 201, y: 699 }))).toBe(SHEET_PROMPT);
    expect(order.markedAt({ x: 100, y: 100 })).toBeUndefined();
  });
});

describe('a `screen` layer: the whole screen, its own nodes named where they draw', () => {
  it('a row beneath, under the sheet\'s own row at its centre: covered, the sheet\'s row named at the centre — a presented surface — and the layer reaching the whole screen', () => {
    const { row, layer: beneath } = list();
    const { layer } = sheet();
    expect(exposed(judged(beneath, layer), row)).toEqual({
      covers: [LAYER, 'button add phone 20,690 362x52'],
      centreCover: 'button add phone 20,690 362x52',
      presented: [LAYER, 'button add phone 20,690 362x52'],
      shows: 0,
      tapAt: undefined,
    });
  });

  it('where nothing of the layer draws — the status strip above the sheet — the anonymous layer is the cover named', () => {
    const { title, layer: beneath } = list();
    const { layer } = sheet();
    expect(exposed(judged(beneath, layer), title)).toEqual({ covers: [LAYER], centreCover: LAYER, presented: [LAYER], shows: 0, tapAt: undefined });
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

  it('the press: the layer reaches the whole screen, handed on as kind `screen`; a node of it presses its rect, no layer', () => {
    const { row, title, layer: beneath } = list();
    const { layer, addPhone } = sheet();
    const order = drawOrder(judged(beneath, layer));
    expect(order.presentedPress(order.presentedAt(title, { x: 300, y: 40 })!)).toEqual({ surface: layer, reach: IPHONE, layer: { kind: 'screen' } });
    expect(order.presentedPress(order.presentedAt(row, { x: 201, y: 715 })!)).toEqual({ surface: addPhone, reach: addPhone.rect });
  });

  it('the sheet\'s own nodes are not beneath it: its field and Cancel are reached at their centre', () => {
    const { layer: beneath } = list();
    const { field, cancel, layer } = sheet();
    const tree = judged(beneath, layer);
    for (const own of [field, cancel]) {
      expect(exposed(tree, own)).toMatchObject({ covers: [], presented: [], tapAt: { moved: false } });
      expect(drawOrder(tree).presentedOver(own)).toBeUndefined();
    }
  });

  it('a stroke for NO target lands on a `screen` layer (`markedAt`): what of the layer draws at the touch-down, the layer where nothing does', () => {
    const { layer: beneath } = list();
    const { cancel, layer } = sheet();
    const order = drawOrder(judged(beneath, layer));
    expect(desc(order.markedAt({ x: 40, y: 80 }))).toBe(desc(cancel));
    expect(desc(order.markedAt({ x: 300, y: 40 }))).toBe(LAYER);
    expect(order.presentedPress(order.markedAt({ x: 300, y: 40 })!)).toEqual({ surface: layer, reach: IPHONE, layer: { kind: 'screen' } });
  });

  it('…but not on a scroll view of the layer itself: a search inside the sheet\'s own list keeps stroking', () => {
    const { layer: beneath } = list();
    const { layer } = sheet();
    const order = drawOrder(judged(beneath, layer));
    expect(order.markedAt({ x: 201, y: 699 })).toBeUndefined();
    expect(order.markedAt({ x: 201, y: 320 })).toBeUndefined();
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

  it('a `screen` layer under a typed one: a stroke for no target lands on the typed element on top', () => {
    const { layer: beneath } = list();
    const { layer: sheetLayer } = sheet();
    const { layer } = popover();
    expect(desc(drawOrder(judged(beneath, sheetLayer, layer)).markedAt({ x: 40, y: 80 }))).toBe(SHEET_PROMPT);
  });

  it('a tree whose source judged nothing: a shape presented by its frames alone is not asked of no target', () => {
    const { layer: beneath } = list();
    const { layer } = sheet();
    const { presentation: _, ...unmarked } = layer;
    const tree = node({ role: 'container', label: 'Example', rect: IPHONE, children: [node({ role: 'container', rect: IPHONE, children: [beneath, node(unmarked)] })] });
    expect(drawOrder(tree).markedAt({ x: 40, y: 80 })).toBeUndefined();
  });

  it('a lower layer marked `screen` under a typed one: a row beneath both is covered by the typed element on top, a node of the sheet by the typed element only', () => {
    const { row, layer: beneath } = list();
    const { field, layer: sheetLayer } = sheet();
    const { layer } = popover();
    const tree = judged(beneath, sheetLayer, layer);
    expect(exposed(tree, row).centreCover).toBe(SHEET_PROMPT);
    expect(exposed(tree, field)).toMatchObject({ covers: [SHEET_PROMPT], centreCover: SHEET_PROMPT, shows: 0 });
  });
});

describe('a judged tree asks no shape: a later screen-sized layer the source did not mark presents nothing', () => {
  /** An RN-modal shape — a dimming leaf filling the screen in a later screen-sized layer with a card — over a row. */
  const modalShape = (root: Partial<UiNode>) => {
    const { row, layer: beneath } = list();
    const dim = node({ role: 'container', identifier: 'overlay', rect: IPHONE });
    const card = node({ role: 'container', identifier: 'card', rect: rect(16, 301, 370, 220), children: [node({ role: 'text', label: 'Forgot password?', rect: rect(32, 320, 300, 24) })] });
    const tree = node({ role: 'container', label: 'Example', rect: IPHONE, ...root, children: [node({ role: 'container', rect: IPHONE, children: [beneath, node({ role: 'container', rect: IPHONE, children: [dim, card] })] })] });
    return { tree, row };
  };

  it('unjudged (a source that says nothing of presentation, an old snapshot): the dim covers by its shape, a presented surface', () => {
    const { tree, row } = modalShape({});
    expect(exposed(tree, row)).toMatchObject({ covers: ['container overlay 0,0 402x874'], presented: ['container overlay 0,0 402x874'], shows: 0 });
  });

  it('judged, the same shape unmarked: nothing presented — the row reads as the source says, clear', () => {
    const { tree, row } = modalShape({ presentationsJudged: true });
    expect(exposed(tree, row)).toMatchObject({ covers: [], presented: [], shows: 1, tapAt: { moved: false } });
    expect(drawOrder(tree).presentedOver(row)).toBeUndefined();
  });
});
