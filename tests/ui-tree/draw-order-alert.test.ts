import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
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
  const covers = seen.covers.map((c) => ({ node: desc(c.node), reach: c.reach, order: c.order.kind, presented: c.presented }));
  return { covers, centreCover: seen.centreCover && desc(seen.centreCover.node), shows: seen.shows, tapAt: seen.tapAt };
};
const ALERT = 'container Leave the form 41,365 320x172';
/** A marked alert as the one cover of what lies beneath it: reaching the whole screen, a presented screen's surface. */
const alertCover = (node: string) => ({ node, reach: IPHONE, order: 'drawn', presented: true });

describe('an alert covers the whole screen beneath it', () => {
  it('a field of the form beneath — its centre under the alert\'s bare backdrop leaf, which a frame row excuses — is covered by the alert, reaching the whole screen: nothing of it shows, no tap', async () => {
    const tree = await alertTree();
    expect(exposed(tree, byId(tree, 'form.note_input'))).toEqual({ covers: [alertCover(ALERT)], centreCover: ALERT, shows: 0, tapAt: undefined });
  });

  it('a node of the form far from the alert\'s card — Back at the top, CONTINUE at the bottom — is covered the same', async () => {
    const tree = await alertTree();
    for (const id of ['BackButton', 'form.continue_button']) expect(exposed(tree, byId(tree, id))).toMatchObject({ covers: [alertCover(ALERT)], centreCover: ALERT, shows: 0, tapAt: undefined });
  });

  it('the form\'s full-screen `Toolbar`, of the dim\'s exact frame (a node of the target\'s own frame is excused), is covered — not moved to the strip above the card', async () => {
    const tree = await alertTree();
    expect(exposed(tree, byId(tree, 'Toolbar'))).toMatchObject({ covers: [alertCover(ALERT)], centreCover: ALERT, shows: 0, tapAt: undefined });
  });

  it('the alert\'s own buttons and texts are reached as before: nothing over them, the tap at their centre', async () => {
    const tree = await alertTree();
    expect(exposed(tree, byLabel(tree, 'Leave'))).toEqual({ covers: [], centreCover: undefined, shows: 1, tapAt: { point: { x: 275, y: 497 }, moved: false } });
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

  it('a pixel assert on the field reads the alert over the whole screen', async () => {
    const tree = await alertTree();
    expect(drawOrder(tree).paintsOver(byId(tree, 'form.note_input'), IPHONE).map((c) => [desc(c.node), c.reach])).toEqual([[ALERT, IPHONE]]);
  });

  it('the mark, not the shape: the same tree with the mark stripped reads the field as before — clear, its tap at its centre', async () => {
    const tree = await alertTree();
    const stripped = JSON.parse(JSON.stringify(tree), (k, v) => (k === 'presentation' ? undefined : v)) as UiNode;
    expect(exposed(stripped, byId(stripped, 'form.note_input'))).toMatchObject({ covers: [], shows: 1, tapAt: { point: { x: 201, y: 602 }, moved: false } });
  });

  it('whatever the frames: an alert laid straight in a later Window, no layer of the screen\'s size around it, covers a row of the Window before it', () => {
    const row = node({ role: 'button', identifier: 'row', rect: rect(20, 700, 362, 52) });
    const alert = node({ role: 'container', label: 'Session expired', rect: rect(41, 365, 320, 172), presentation: 'alert', children: [node({ role: 'button', label: 'OK', rect: rect(57, 473, 288, 48) })] });
    const tree = node({ role: 'container', rect: IPHONE, children: [node({ role: 'container', rect: IPHONE, children: [row] }), node({ role: 'container', rect: IPHONE, children: [alert] })] });
    expect(exposed(tree, row)).toMatchObject({ covers: [alertCover('container Session expired 41,365 320x172')], shows: 0, tapAt: undefined });
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
      expect(exposed(tree, row)).toMatchObject({ covers: [], shows: 1, tapAt: { moved: false } });
      expect(drawOrder(tree).presentedOver(row)).toBeUndefined();
      expect(drawOrder(tree).presentedAt(row, { x: 201, y: 699 })).toBeUndefined();
    }
  });

  it('…but an alert on the screen WDA reports hidden still covers: its flags are not read (an alert mid-animation may read hidden)', () => {
    const { tree, row } = rowUnder(rect(41, 365, 320, 172), true);
    expect(exposed(tree, row)).toMatchObject({ covers: [alertCover('container Session expired 41,365 320x172')], shows: 0, tapAt: undefined });
  });

  it('the keyboard is never beneath an alert: a key of a keyboard Window listed BEFORE the alert\'s Window is reached as before (the keyboard is drawn over the app\'s windows)', () => {
    const key = node({ role: 'button', label: 'q', rect: rect(3, 600, 37, 42) });
    const keyboard = node({ role: 'container', rect: IPHONE, ofKeyboard: true, children: [node({ role: 'container', rect: rect(0, 560, 402, 314), children: [key] })] });
    const alert = node({ role: 'container', label: 'Sign in', rect: rect(41, 300, 320, 220), presentation: 'alert' });
    const tree = node({ role: 'container', rect: IPHONE, children: [node({ role: 'container', rect: IPHONE }), keyboard, node({ role: 'container', rect: IPHONE, children: [alert] })] });
    expect(exposed(tree, key)).toMatchObject({ covers: [], shows: 1, tapAt: { moved: false } });
    expect(drawOrder(tree).presentedOver(key)).toBeUndefined();
  });
});

describe('the scene\'s presented question at a touch-down (`Scene.presentedAt`): the surface a stroke at a point lands on, as a sentence quotes it', () => {
  it('for a target beneath the alert, at any point — on the card, above it, below it: the alert, reaching the whole screen, handed on as its layer', async () => {
    const tree = await alertTree();
    const scene = sceneOf(tree);
    const field = byId(tree, 'form.note_input');
    const alert = drawOrder(tree).presentedOver(field)!;
    for (const point of [{ x: 201, y: 175 }, { x: 201, y: 459 }, { x: 201, y: 699 }]) {
      expect(scene.presentedAt(point, field)).toEqual({ surface: alert, reach: IPHONE, layer: { kind: 'alert', label: 'Leave the form' } });
    }
  });

  it('for a target of the alert itself: none', async () => {
    const tree = await alertTree();
    expect(sceneOf(tree).presentedAt({ x: 201, y: 699 }, byLabel(tree, 'Leave'))).toBeUndefined();
  });

  it('with no target (one not in the tree): the alert, wherever the point lies on the screen', async () => {
    const tree = await alertTree();
    const alert = drawOrder(tree).presentedOver(byId(tree, 'form.note_input'))!;
    for (const point of [{ x: 201, y: 175 }, { x: 201, y: 699 }]) expect(sceneOf(tree).presentedAt(point)).toEqual({ surface: alert, reach: IPHONE, layer: { kind: 'alert', label: 'Leave the form' } });
  });

  it('with no target, at a point on a scroll view of the alert\'s own: none — a stroke scrolling the alert\'s content is sent', () => {
    const list = node({ role: 'scrollable', rect: rect(41, 400, 320, 100) });
    const alert = node({ role: 'container', label: 'Terms', rect: rect(41, 365, 320, 172), presentation: 'alert', children: [list] });
    const tree = node({ role: 'container', rect: IPHONE, children: [node({ role: 'container', rect: IPHONE }), node({ role: 'container', rect: IPHONE, children: [alert] })] });
    expect(sceneOf(tree).presentedAt({ x: 201, y: 450 })).toBeUndefined();
    expect(sceneOf(tree).presentedAt({ x: 201, y: 699 })).toMatchObject({ surface: alert, reach: IPHONE });
  });

  it('none with nothing presented, with a target or without', () => {
    const row = node({ role: 'button', identifier: 'row', rect: rect(20, 700, 362, 52) });
    const tree = node({ role: 'container', rect: IPHONE, children: [node({ role: 'container', rect: IPHONE, children: [row] })] });
    expect(sceneOf(tree).presentedAt({ x: 201, y: 699 }, row)).toBeUndefined();
    expect(sceneOf(tree).presentedAt({ x: 201, y: 699 })).toBeUndefined();
  });
});
