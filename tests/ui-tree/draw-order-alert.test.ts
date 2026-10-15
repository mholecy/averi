import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { node } from '../helpers/fake.js';

// A layer the tree source marks as an alert's (`UiNode.presentation` on the layer, its `Alert` the element naming it)
// is presented over every screen drawn before it, the WHOLE screen — whatever the frames of the nodes around it: its
// dim a bare frame, a full-screen toolbar of the form beneath with the dim's exact frame. Its alert is the layer's one
// cover, named; the alert's own buttons and texts are reached as before. (A hand-built layer marked with no element
// marked in it is its own cover.)

const IPHONE = { x: 0, y: 0, width: 402, height: 874 };
const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const desc = (n: UiNode): string => `${n.role} ${n.identifier ?? n.label ?? ''} ${n.rect.x},${n.rect.y} ${n.rect.width}x${n.rect.height}`;

const alertTree = async (): Promise<UiNode> => parseWdaSource(await readFile(new URL('../fixtures/wda-synthetic-alert-over-form.json', import.meta.url), 'utf8'));
const find = (tree: UiNode, test: (n: UiNode) => boolean): UiNode => [...everyNode(tree)].find(test)!;
const byId = (tree: UiNode, id: string): UiNode => find(tree, (n) => n.identifier === id);
const byLabel = (tree: UiNode, label: string): UiNode => find(tree, (n) => n.label === label && n.role !== 'text');
const exposed = (tree: UiNode, target: UiNode) => {
  const seen = drawOrder(tree).exposure(target, IPHONE);
  return { covers: seen.covers.map(desc), reaches: seen.reaches, centreCover: seen.centreCover && desc(seen.centreCover), presented: seen.presented.map(desc), shows: seen.shows, tapAt: seen.tapAt };
};
const ALERT = 'container Leave the form 41,365 320x172';

describe('an alert covers the whole screen beneath it', () => {
  it('a field of the form beneath — its centre under the alert\'s bare backdrop leaf, which a frame row excuses — is covered by the alert, reaching the whole screen: nothing of it shows, no tap', async () => {
    const tree = await alertTree();
    expect(exposed(tree, byId(tree, 'form.note_input'))).toEqual({ covers: [ALERT], reaches: [IPHONE], centreCover: ALERT, presented: [ALERT], shows: 0, tapAt: undefined });
  });

  it('a node of the form far from the alert\'s card — Back at the top, CONTINUE at the bottom — is covered the same', async () => {
    const tree = await alertTree();
    for (const id of ['BackButton', 'form.continue_button']) expect(exposed(tree, byId(tree, id))).toMatchObject({ covers: [ALERT], centreCover: ALERT, presented: [ALERT], shows: 0, tapAt: undefined });
  });

  it('the form\'s full-screen `Toolbar`, of the dim\'s exact frame (a node of the target\'s own frame is excused), is covered — not moved to the strip above the card', async () => {
    const tree = await alertTree();
    expect(exposed(tree, byId(tree, 'Toolbar'))).toMatchObject({ covers: [ALERT], centreCover: ALERT, shows: 0, tapAt: undefined });
  });

  it('the alert\'s own buttons and texts are reached as before: nothing over them, the tap at their centre', async () => {
    const tree = await alertTree();
    expect(exposed(tree, byLabel(tree, 'Leave'))).toEqual({ covers: [], reaches: [], centreCover: undefined, presented: [], shows: 1, tapAt: { point: { x: 275, y: 497 }, moved: false } });
    expect(exposed(tree, byLabel(tree, 'Stay'))).toMatchObject({ covers: [], tapAt: { point: { x: 127, y: 497 }, moved: false } });
    expect(exposed(tree, find(tree, (n) => n.role === 'text' && n.label === 'Leave the form'))).toMatchObject({ covers: [], tapAt: { moved: false } });
  });

  it('the presented questions agree, geometry-free: `presentedOver` names the alert, and `presentedAt` names it at any touch-down — on the card, above it, below it', async () => {
    const tree = await alertTree();
    const order = drawOrder(tree);
    const field = byId(tree, 'form.note_input');
    expect(desc(order.presentedOver(field)!)).toBe(ALERT);
    for (const point of [{ x: 201, y: 175 }, { x: 201, y: 459 }, { x: 201, y: 699 }]) expect(desc(order.presentedAt(field, point)!)).toBe(ALERT);
    expect(order.presentedOver(byLabel(tree, 'Leave'))).toBeUndefined();
    expect(order.presentedAt(byLabel(tree, 'Leave'), { x: 201, y: 699 })).toBeUndefined();
  });

  it('the press a sentence quotes (`presentedPress`): the alert reaches the whole screen and is handed on as its layer — its kind and label, not the node; any other surface presses its rect, no layer', async () => {
    const tree = await alertTree();
    const order = drawOrder(tree);
    const alert = order.presentedOver(byId(tree, 'form.note_input'))!;
    expect(order.presentedPress(alert)).toEqual({ surface: alert, reach: IPHONE, layer: { kind: 'alert', label: 'Leave the form' } });
    const dim = node({ role: 'other', rect: IPHONE });
    expect(order.presentedPress(dim)).toEqual({ surface: dim, reach: IPHONE });
    const sheet = node({ role: 'container', rect: rect(0, 400, 402, 474) });
    expect(order.presentedPress(sheet)).toEqual({ surface: sheet, reach: rect(0, 400, 402, 474) });
    const unlabelled = node({ role: 'container', rect: rect(41, 365, 320, 172), presentation: 'alert' });
    const withIt = node({ role: 'container', rect: IPHONE, children: [node({ role: 'container', rect: IPHONE }), unlabelled] });
    expect(drawOrder(withIt).presentedPress(unlabelled).layer).toEqual({ kind: 'alert' });
  });

  it('a pixel assert on the field reads the alert over the whole screen', async () => {
    const tree = await alertTree();
    expect(drawOrder(tree).paintsOver(byId(tree, 'form.note_input'), IPHONE).map((c) => [desc(c.node), c.reach])).toEqual([[ALERT, IPHONE]]);
  });

  it('the mark, not the shape: the same tree with the mark stripped reads the field as before — clear, its tap at its centre', async () => {
    const tree = await alertTree();
    const stripped = JSON.parse(JSON.stringify(tree), (k, v) => (k === 'presentation' ? undefined : v)) as UiNode;
    expect(exposed(stripped, byId(stripped, 'form.note_input'))).toMatchObject({ covers: [], presented: [], shows: 1, tapAt: { point: { x: 201, y: 602 }, moved: false } });
  });

  it('whatever the frames: an alert laid straight in a later Window, no layer of the screen\'s size around it, covers a row of the Window before it', () => {
    const row = node({ role: 'button', identifier: 'row', rect: rect(20, 700, 362, 52) });
    const alert = node({ role: 'container', label: 'Session expired', rect: rect(41, 365, 320, 172), presentation: 'alert', children: [node({ role: 'button', label: 'OK', rect: rect(57, 473, 288, 48) })] });
    const tree = node({ role: 'container', rect: IPHONE, children: [node({ role: 'container', rect: IPHONE, children: [row] }), node({ role: 'container', rect: IPHONE, children: [alert] })] });
    expect(exposed(tree, row)).toMatchObject({ covers: ['container Session expired 41,365 320x172'], presented: ['container Session expired 41,365 320x172'], shows: 0, tapAt: undefined });
  });

  it('a node drawn AFTER the alert\'s layer is not beneath it: judged as before', () => {
    const later = node({ role: 'button', identifier: 'later', rect: rect(20, 700, 362, 52) });
    const alert = node({ role: 'container', label: 'Session expired', rect: rect(41, 365, 320, 172), presentation: 'alert' });
    const tree = node({ role: 'container', rect: IPHONE, children: [node({ role: 'container', rect: IPHONE, children: [alert] }), node({ role: 'container', rect: IPHONE, children: [later] })] });
    expect(exposed(tree, later)).toMatchObject({ covers: [], shows: 1 });
    expect(drawOrder(tree).presentedOver(later)).toBeUndefined();
  });

  /** A row of a screen, then a later layer holding an alert at `rect` (hidden or not): the shapes the on-screen guard is asked of. */
  const rowUnder = (alertRect: { x: number; y: number; width: number; height: number }, hidden = false) => {
    const row = node({ role: 'button', identifier: 'row', rect: rect(20, 700, 362, 52) });
    const alert = node({ role: 'container', label: 'Session expired', rect: alertRect, presentation: 'alert', ...(hidden && { hidden: true as const }) });
    const tree = node({ role: 'container', rect: IPHONE, children: [node({ role: 'container', rect: IPHONE, children: [row] }), node({ role: 'container', rect: IPHONE, children: [alert] })] });
    return { tree, row };
  };

  it('only an alert ON the screen: one of no area (0x0) or wholly off the screen covers nothing — the row is reached as before', () => {
    for (const r of [rect(0, 0, 0, 0), rect(41, 900, 320, 172), rect(-400, 365, 320, 172)]) {
      const { tree, row } = rowUnder(r);
      expect(exposed(tree, row)).toMatchObject({ covers: [], presented: [], shows: 1, tapAt: { moved: false } });
      expect(drawOrder(tree).presentedOver(row)).toBeUndefined();
      expect(drawOrder(tree).presentedAt(row, { x: 201, y: 699 })).toBeUndefined();
    }
  });

  it('…but an alert on the screen WDA reports hidden still covers: its flags are not read (an alert mid-animation may read hidden)', () => {
    const { tree, row } = rowUnder(rect(41, 365, 320, 172), true);
    expect(exposed(tree, row)).toMatchObject({ covers: ['container Session expired 41,365 320x172'], shows: 0, tapAt: undefined });
  });

  it('the keyboard is never beneath an alert: a key of a keyboard Window listed BEFORE the alert\'s Window is reached as before (the keyboard is drawn over the app\'s windows)', () => {
    const key = node({ role: 'button', label: 'q', rect: rect(3, 600, 37, 42) });
    const keyboard = node({ role: 'container', rect: IPHONE, ofKeyboard: true, children: [node({ role: 'container', rect: rect(0, 560, 402, 314), children: [key] })] });
    const alert = node({ role: 'container', label: 'Sign in', rect: rect(41, 300, 320, 220), presentation: 'alert' });
    const tree = node({ role: 'container', rect: IPHONE, children: [node({ role: 'container', rect: IPHONE }), keyboard, node({ role: 'container', rect: IPHONE, children: [alert] })] });
    expect(exposed(tree, key)).toMatchObject({ covers: [], presented: [], shows: 1, tapAt: { moved: false } });
    expect(drawOrder(tree).presentedOver(key)).toBeUndefined();
  });
});
