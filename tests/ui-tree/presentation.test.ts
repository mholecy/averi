import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { walkOf, type Placed } from '../../src/ui-tree/placed.js';
import { presentationOf } from '../../src/ui-tree/presentation.js';
import { node } from '../helpers/fake.js';
import { IPHONE, judged, list, popover, rect, sheet } from '../helpers/presented-trees.js';

// THE PRESENTATION MODULE (ui-tree/presentation.ts), through its interface: which adapter infers what the source did
// not judge (`fallback`), what is presented over a target (`over`: drawn, wholeScreen, surface, givesWay), the layer
// on top at a point for no target (`topmostAt`), and a surface as a sentence quotes it (`press`). Draw order's reading
// of these facts — the covers it names, the tap it moves — is pinned in draw-order*.test.ts.

/** The presentation of `tree`, and each node's first place in its walk. */
const read = (tree: UiNode) => {
  const order = walkOf(tree);
  const at = (n: UiNode): Placed => order.find((p) => p.node === n)!;
  return { presentation: presentationOf(tree, order), at };
};

/** An RN-modal shape — a dimming leaf filling the screen in a later screen-sized layer with a card — over the list's row; `root` adds marks to the root. */
const modalShape = (root: Partial<UiNode> = {}) => {
  const { row, layer: beneath } = list();
  const dim = node({ role: 'container', identifier: 'overlay', rect: IPHONE });
  const card = node({ role: 'container', identifier: 'card', rect: rect(16, 301, 370, 220), children: [node({ role: 'text', label: 'Forgot password?', rect: rect(32, 320, 300, 24) })] });
  const modal = node({ role: 'container', rect: IPHONE, children: [dim, card] });
  const tree = node({ role: 'container', label: 'Example', rect: IPHONE, ...root, children: [node({ role: 'container', rect: IPHONE, children: [beneath, modal] })] });
  return { tree, row, dim, card, modal };
};

describe('the fallback: which adapter infers presented screens where the source did not judge them', () => {
  it('a judged tree (`presentationsJudged`) has none — only the marks; a uiautomator root (`paddedTouchTargets`) the uiautomator adapter; any other tree the shape', () => {
    expect(presentationOf(modalShape({ presentationsJudged: true }).tree).fallback).toBeUndefined();
    expect(presentationOf(modalShape({ paddedTouchTargets: true }).tree).fallback).toBe('uiautomator');
    expect(presentationOf(modalShape().tree).fallback).toBe('shape');
  });

  it('by shape, unjudged: the dim is the surface of a screen presented over the row (`inferred`), and its frame excuse gives way', () => {
    const { tree, row, dim, card } = modalShape();
    const { presentation, at } = read(tree);
    const over = presentation.over(row);
    expect(over.surface(at(dim))).toBe('inferred');
    expect(over.givesWay('structural', at(dim))).toBe(true);
    // The card is a wrapper with children: it may pass touches through, no surface.
    expect(over.surface(at(card))).toBeUndefined();
    expect(over.wholeScreen(at(dim))).toBe(false);
    expect(over.drawn(at(dim))).toBe(true);
  });

  it('judged, the same shape unmarked: nothing presented — no shape is asked, no excuse gives way', () => {
    const { tree, row, dim } = modalShape({ presentationsJudged: true });
    const { presentation, at } = read(tree);
    expect(presentation.over(row).surface(at(dim))).toBeUndefined();
    expect(presentation.over(row).givesWay('structural', at(dim))).toBe(false);
  });

  // Lab note L1 (docs/bugs/2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md) is this
  // adapter's to fix, not yet: until then it answers as the shape does.
  it('the uiautomator adapter answers as the shape does today: the same surface, the same give-way, no layer at a point', () => {
    const { tree, row, dim } = modalShape({ paddedTouchTargets: true });
    const { presentation, at } = read(tree);
    expect(presentation.over(row).surface(at(dim))).toBe('inferred');
    expect(presentation.over(row).givesWay('structural', at(dim))).toBe(true);
    expect(presentation.topmostAt({ x: 201, y: 699 })).toBeUndefined();
    expect(presentation.press(dim)).toEqual({ surface: dim, reach: IPHONE });
  });

  it('a screen presented by its frames alone is not asked of no target, and named by no layer', () => {
    const { layer: beneath } = list();
    const { layer } = sheet();
    const { presentation: _, ...unmarked } = layer;
    const tree = node({ role: 'container', label: 'Example', rect: IPHONE, children: [node({ role: 'container', rect: IPHONE, children: [beneath, node(unmarked)] })] });
    expect(presentationOf(tree).topmostAt({ x: 40, y: 80 })).toBeUndefined();
  });

  it('where a marked `screen` layer is ALSO a shape (a hand-built tree with no `presentationsJudged`), the inference wins: the source\'s hidden flag gives way only to it', () => {
    const { tree, row, dim, modal } = modalShape();
    modal.presentation = 'screen';
    const { presentation, at } = read(tree);
    expect(presentation.over(row).surface(at(dim))).toBe('inferred');
    // The card's text is the marked layer's own node: a fact, no shape names it.
    expect(presentation.over(row).surface(at(modal.children[1].children[0]))).toBe('fact');
  });
});

describe('by marks: a layer typed by its element', () => {
  it('over a row beneath: the element is the one cover, reaching the whole screen; what else the layer holds (its dim) is drawn on it, not for the row', () => {
    const { row, layer: beneath } = list();
    const { dim, element, discard, layer } = popover();
    const { presentation, at } = read(judged(beneath, layer));
    const over = presentation.over(row);
    expect(over.wholeScreen(at(element))).toBe(true);
    expect(over.drawn(at(element))).toBe(true);
    expect(over.drawn(at(dim))).toBe(false);
    expect(over.drawn(at(discard))).toBe(false);
    expect(over.surface(at(element))).toBeUndefined();
    expect(over.givesWay('structural', at(dim))).toBe(false);
  });

  it('a node of the typed layer ITSELF is not beneath it: nothing presented over the popover\'s own `dismiss popup`', () => {
    const { layer: beneath } = list();
    const { dim, element, layer } = popover();
    const { presentation, at } = read(judged(beneath, layer));
    expect(presentation.over(dim).wholeScreen(at(element))).toBe(false);
    expect(presentation.over(dim).drawn(at(element))).toBe(true);
  });

  it('a node listed again INSIDE the layer (one object at two places of the walk) is the layer\'s own, not beneath it', () => {
    const { row, layer: beneath } = list();
    const { element, layer } = popover();
    layer.children.push(row);
    const { presentation, at } = read(judged(beneath, layer));
    expect(presentation.over(row).wholeScreen(at(element))).toBe(false);
  });

  it('the press a sentence quotes: the element reaches the whole screen, handed on as its layer — the kind from the layer, the label from the element; any other node presses its rect, no layer', () => {
    const { layer: beneath } = list();
    const { dim, element, layer } = popover();
    const presentation = presentationOf(judged(beneath, layer));
    expect(presentation.press(element)).toEqual({ surface: element, reach: IPHONE, layer: { kind: 'actionSheet', label: 'Are you sure?' } });
    expect(presentation.press(dim)).toEqual({ surface: dim, reach: IPHONE });
    const elsewhere = node({ role: 'container', rect: rect(0, 400, 402, 474) });
    expect(presentation.press(elsewhere)).toEqual({ surface: elsewhere, reach: rect(0, 400, 402, 474) });
  });

  it('a typed layer whose element is not marked (a hand-built tree) is its own cover, named by its own label — or by its kind alone', () => {
    const unlabelled = node({ role: 'container', rect: rect(41, 365, 320, 172), presentation: 'alert' });
    const withIt = node({ role: 'container', rect: IPHONE, children: [node({ role: 'container', rect: IPHONE }), unlabelled] });
    expect(presentationOf(withIt).press(unlabelled).layer).toEqual({ kind: 'alert' });
  });

  it('measured, the WDA alert over the SWIFT form: the alert, reaching the whole screen, named by its title', async () => {
    const tree = parseWdaSource(await readFile(new URL('../fixtures/wda-synthetic-alert-over-form.json', import.meta.url), 'utf8'));
    const alert = [...everyNode(tree)].find((n) => n.presentationElement === true)!;
    expect(presentationOf(tree).press(alert)).toEqual({ surface: alert, reach: IPHONE, layer: { kind: 'alert', label: 'Leave the form' } });
    expect(presentationOf(tree).topmostAt({ x: 201, y: 699 })?.cover.node).toBe(alert);
  });

  it('only a layer ON the screen: one whose cover has no area or lies wholly off the screen presents nothing (WDA keeps a dismissed alert, parked)', () => {
    for (const r of [rect(0, 0, 0, 0), rect(41, 900, 320, 172), rect(-400, 365, 320, 172)]) {
      const row = node({ role: 'button', identifier: 'row', rect: rect(20, 700, 362, 52) });
      const alert = node({ role: 'container', label: 'Session expired', rect: r, presentation: 'alert' });
      const tree = node({ role: 'container', rect: IPHONE, children: [node({ role: 'container', rect: IPHONE, children: [row] }), node({ role: 'container', rect: IPHONE, children: [alert] })] });
      const { presentation, at } = read(tree);
      expect(presentation.over(row).wholeScreen(at(alert))).toBe(false);
      expect(presentation.topmostAt({ x: 201, y: 699 })).toBeUndefined();
      expect(presentation.press(alert).layer).toBeUndefined();
    }
  });

  it('the keyboard is never beneath a layer: nothing presented over a key, wherever its Window is listed', () => {
    const key = node({ role: 'button', label: 'q', rect: rect(3, 600, 37, 42) });
    const keyboard = node({ role: 'container', rect: IPHONE, ofKeyboard: true, children: [node({ role: 'container', rect: rect(0, 560, 402, 314), children: [key] })] });
    const alert = node({ role: 'container', label: 'Sign in', rect: rect(41, 300, 320, 220), presentation: 'alert' });
    const tree = node({ role: 'container', rect: IPHONE, children: [node({ role: 'container', rect: IPHONE }), keyboard, node({ role: 'container', rect: IPHONE, children: [alert] })] });
    const { presentation, at } = read(tree);
    expect(presentation.over(key).wholeScreen(at(alert))).toBe(false);
  });

  it('a node not in the tree has nothing presented over it', () => {
    const { layer: beneath } = list();
    const { element, layer } = popover();
    const { presentation, at } = read(judged(beneath, layer));
    expect(presentation.over(node({ role: 'button', label: 'elsewhere', rect: rect(0, 1000, 402, 50) })).wholeScreen(at(element))).toBe(false);
  });

  it('for no target: a touch-down beneath a typed layer lands on its element — none on the layer\'s own scroll view', () => {
    const { layer: beneath } = list();
    const { element, layer } = popover();
    layer.children[1].children.push(node({ role: 'scrollable', rect: rect(10, 78, 240, 169), children: [node({ role: 'button', label: 'x', rect: rect(10, 78, 240, 44) })] }));
    const presentation = presentationOf(judged(beneath, layer));
    expect(presentation.topmostAt({ x: 201, y: 699 })).toEqual({ cover: expect.objectContaining({ node: element }), at: [] });
    expect(presentation.topmostAt({ x: 100, y: 100 })).toBeUndefined();
  });
});

describe('by marks: a `screen` layer', () => {
  it('over a row beneath: the layer reaches the whole screen, and each of its own nodes is a presented surface (`fact`); the list\'s own nodes are none', () => {
    const { row, title, layer: beneath } = list();
    const { addPhone, cancel, form, layer } = sheet();
    const { presentation, at } = read(judged(beneath, layer));
    const over = presentation.over(row);
    expect(over.wholeScreen(at(layer))).toBe(true);
    expect(over.wholeScreen(at(addPhone))).toBe(false);
    for (const own of [addPhone, cancel, form]) {
      expect(over.surface(at(own))).toBe('fact');
      expect(over.drawn(at(own))).toBe(true);
    }
    expect(over.surface(at(title))).toBeUndefined();
  });

  it('the sheet\'s own nodes are not beneath it', () => {
    const { layer: beneath } = list();
    const { field, layer } = sheet();
    const { presentation, at } = read(judged(beneath, layer));
    expect(presentation.over(field).wholeScreen(at(layer))).toBe(false);
  });

  it('the press: the layer reaches the whole screen, handed on as kind `screen`; a node of it presses its rect, no layer', () => {
    const { layer: beneath } = list();
    const { layer, addPhone } = sheet();
    const presentation = presentationOf(judged(beneath, layer));
    expect(presentation.press(layer)).toEqual({ surface: layer, reach: IPHONE, layer: { kind: 'screen' } });
    expect(presentation.press(addPhone)).toEqual({ surface: addPhone, reach: addPhone.rect });
  });

  it('for no target: the layer is on top, with its own nodes at the point — none on a scroll view of the layer itself (a search inside the sheet\'s own list keeps stroking)', () => {
    const { layer: beneath } = list();
    const { cancel, layer } = sheet();
    const presentation = presentationOf(judged(beneath, layer));
    const top = presentation.topmostAt({ x: 40, y: 80 })!;
    expect(top.cover.node).toBe(layer);
    expect(top.at.map((p) => p.node)).toEqual([layer.children[0], cancel]);
    expect(presentation.topmostAt({ x: 300, y: 40 })?.at).toEqual([]);
    expect(presentation.topmostAt({ x: 201, y: 699 })).toBeUndefined();
    expect(presentation.topmostAt({ x: 201, y: 320 })).toBeUndefined();
  });

  it('a node the source reports hidden neither holds a stroke as the layer\'s scroll view nor is listed at the point', () => {
    const { layer: beneath } = list();
    const parked = node({ role: 'text', label: 'Parked', hidden: true, rect: rect(0, 690, 402, 30) });
    const scroll = node({ role: 'scrollable', hidden: true, rect: rect(0, 600, 402, 200), children: [node({ role: 'text', label: 'x', hidden: true, rect: rect(0, 610, 402, 30) })] });
    const form = node({ role: 'container', identifier: 'form', rect: rect(0, 118, 402, 756), children: [parked, scroll] });
    const layer = node({ role: 'container', rect: IPHONE, presentation: 'screen', children: [form] });
    expect(presentationOf(judged(beneath, layer)).topmostAt({ x: 201, y: 699 })?.at.map((p) => p.node)).toEqual([form]);
  });

  it('a typed layer over a `screen` one: the topmost takes the touch — its element, or, on its own scroll view, nothing (the sheet beneath, its list hidden under the popover, is not asked)', () => {
    const { layer: beneath } = list();
    const { layer: sheetLayer, form } = sheet();
    form.hidden = true;
    const { element, layer } = popover();
    layer.children[1].children.push(node({ role: 'scrollable', rect: rect(10, 166, 240, 81), children: [node({ role: 'button', label: 'Keep Editing', rect: rect(10, 166, 240, 44) })] }));
    const presentation = presentationOf(judged(beneath, sheetLayer, layer));
    expect(presentation.topmostAt({ x: 100, y: 175 })).toBeUndefined();
    expect(presentation.topmostAt({ x: 40, y: 80 })?.cover.node).toBe(element);
  });
});
