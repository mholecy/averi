import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { everyNode, rectArea, type UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { coverNodes, tagged } from '../helpers/covers.js';
import { node } from '../helpers/fake.js';

// Draw order's `hidden` row (ui-tree/draw-order.ts#NOT_DRAWN): a node of a HIDDEN SUBTREE (`UiNode.hidden`, set by the
// WDA parser) is no cover of a target, unless it is the surface of a screen presented over the target's.
// docs/adr/0019-wda-hidden-subtrees-and-parked-cell-content.md

const capture = async (name: string): Promise<UiNode> => parseWdaSource(await readFile(new URL(`../fixtures/wda-capture-${name}.json`, import.meta.url), 'utf8'));
const IPHONE = { x: 0, y: 0, width: 402, height: 874 };
const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const desc = (n: UiNode): string => `${n.role} ${n.identifier ?? n.label ?? ''} ${n.rect.x},${n.rect.y} ${n.rect.width}x${n.rect.height}`.replace('  ', ' ');

describe('a hidden subtree is no cover of a target', () => {
  it('the SWIFT form pushed over the tab host: the "Standard" value of the Priority row, whose centre lies under the hidden Home tab\'s icon, is clear — its tap is not moved, its whole rect shows', async () => {
    const tree = await capture('swift-form-pushed');
    const standard = [...everyNode(tree)].find((n) => n.label === 'Standard')!;
    const seen = drawOrder(tree).exposure(standard, IPHONE);
    expect({ covers: coverNodes(seen.covers).map(desc), centreCover: seen.centreCover, shows: seen.shows, tapAt: seen.tapAt }).toEqual({
      covers: [],
      centreCover: undefined,
      shows: 1,
      tapAt: { point: { x: 78, y: 715 }, moved: false },
    });
  });

  it('…and no row of the form is covered by a tab button or its icon any more', async () => {
    const tree = await capture('swift-form-pushed');
    const order = drawOrder(tree);
    const underTabs = [...everyNode(tree)]
      .filter((n) => !n.hidden && rectArea(n.rect) > 0)
      .flatMap((n) => order.exposure(n, IPHONE).covers.filter(({ node: c }) => /^nav\.tab_|^Dashboard\//.test(c.identifier ?? c.label ?? '')).map(({ node: c }) => `${desc(n)} under ${desc(c)}`));
    expect(underTabs).toEqual([]);
  });

  it('Account Detail with the bar SHOWN: nothing is dropped — every node\'s covers, presented surfaces and tap are what they are with the flag stripped (98 nodes there are hidden: 94 off screen or of no area — the second account card off to the right, the rows below the fold — and the search icon, the second card\'s 24-pt sliver, the screen\'s full-screen `Toolbar` and its frame)', async () => {
    const tree = await capture('account-detail-bar-shown');
    const stripped = JSON.parse(JSON.stringify(tree), (k, v) => (k === 'hidden' ? undefined : v)) as UiNode;
    const [a, b] = [[...everyNode(tree)], [...everyNode(stripped)]];
    expect([a.length, a.filter((n) => n.hidden).length, b.filter((n) => n.hidden).length]).toEqual([203, 98, 0]);
    const [oa, ob] = [drawOrder(tree), drawOrder(stripped)];
    const said = (order: ReturnType<typeof drawOrder>, n: UiNode) => {
      const seen = order.exposure(n, IPHONE);
      return JSON.stringify({ covers: seen.covers.map((c) => ({ ...c, node: desc(c.node) })), tapAt: seen.tapAt, shows: seen.shows });
    };
    const differ = a.flatMap((n, i) => (said(oa, n) === said(ob, b[i]) ? [] : [desc(n)]));
    expect(differ).toEqual([]);
    // Not vacuous: the tab buttons are covered by nothing, and something on the screen is covered.
    expect(a.some((n) => oa.exposure(n, IPHONE).covers.length > 0)).toBe(true);
  });

  it('only in the `target` column: the stroke box\'s `drawnOver` still counts a hidden node over a clipping container', () => {
    const list = node({ role: 'container', rect: rect(0, 100, 402, 600), clipsDescendants: true, children: [node({ role: 'button', label: 'Row', rect: rect(20, 600, 362, 52) })] });
    const tab = node({ role: 'button', identifier: 'nav.tab_home', rect: rect(69, 611, 67, 52), hidden: true });
    const tree = node({ role: 'container', rect: IPHONE, children: [list, tab] });
    const order = drawOrder(tree);
    expect(order.drawnOver(list.rect)).toEqual([tab]);
    expect(coverNodes(order.exposure(list.children[0], IPHONE).covers)).toEqual([]);
  });

  it('…but a hidden control holding a target\'s centre is still something a tap there may press (`centreExcused`, the dismissal picker\'s refusal): WDA\'s isVisible "0" is no proof a node takes no touch', () => {
    const title = node({ role: 'text', identifier: 'title', label: 'SWIFT PAYMENT', rect: rect(100, 700, 200, 30) });
    const tab = node({ role: 'button', identifier: 'nav.tab_cards', rect: rect(170, 690, 66, 52), hidden: true });
    const tree = node({ role: 'container', rect: IPHONE, children: [node({ role: 'container', rect: IPHONE, children: [title] }), tab] });
    expect(drawOrder(tree).exposure(title, IPHONE)).toMatchObject({ covers: [], centreExcused: [tab], tapAt: { moved: false } });
  });

  it('the SWIFT form: the label "Payee’s name" of `payee_name_input` (listed below its form\'s ScrollView, WDA 0/0) is no dismissal candidate — its own text field, which a tap at its centre would focus, still holds its centre', async () => {
    const tree = await capture('swift-form-pushed');
    const label = [...everyNode(tree)].find((n) => n.role === 'text' && n.label === 'Payee’s name')!;
    const seen = drawOrder(tree).exposure(label, IPHONE);
    expect(seen.centreExcused.filter((n) => n.role === 'textfield').map(desc)).toEqual(['textfield TextFieldWithComponentStyle 42,817 318x20']);
  });
});

describe('…except the surface of a screen presented over the target\'s, which covers as before', () => {
  it('the Contacts New Contact sheet under the discard popover, as WDA judged it: the sheet\'s layer is a marked presented screen over the list, so its hidden form `Table` (scrollable 0,62 402x812) need not cover — the layer reaches the whole screen, its visible controls are named where they lie, and the action sheet is on top', async () => {
    const tree = await capture('contacts-discard-popover');
    const table = [...everyNode(tree)].find((n) => n.role === 'scrollable' && desc(n) === 'scrollable 0,62 402x812')!;
    expect(table.hidden).toBe(true);
    const row = [...everyNode(tree)].find((n) => n.label === 'a' && n.role === 'container')!; // the list's section header `a`, 0,116 402x38
    const seen = drawOrder(tree).exposure(row, IPHONE);
    expect(coverNodes(seen.covers)).not.toContain(table);
    // Every one of them a surface of the presented sheet's layer.
    expect(tagged(seen.covers).map((c) => ({ ...c, node: desc(c.node) }))).toEqual(
      ['container 0,0 402x874', 'container New Contact 0,78 402x54', 'button close 20,82 36x36', 'button Done 346,82 36x36', 'other Are you sure you want to discard this new contact? 10,78 240x169'].map((node) => ({ node, order: 'drawn', presented: true })),
    );
    expect(seen.shows).toBe(0);
  });

  it('a sheet layer over a list, marked hidden, with no other dim: its scroll view still covers the row beneath at its centre — the tap is refused, not sent through the sheet', () => {
    const row = node({ role: 'button', label: 'Kate Bell', rect: rect(20, 300, 362, 52) });
    const screen = node({ role: 'container', rect: IPHONE, children: [node({ role: 'scrollable', rect: IPHONE, children: [row] })] });
    const form = node({ role: 'scrollable', rect: rect(0, 62, 402, 812), hidden: true, children: [node({ role: 'text', label: 'First name', rect: rect(20, 400, 362, 44), hidden: true })] });
    const sheet = node({ role: 'container', rect: IPHONE, hidden: true, children: [form] });
    const window = node({ role: 'container', rect: IPHONE, children: [screen, sheet] });
    const tree = node({ role: 'container', rect: IPHONE, children: [window] });
    const seen = drawOrder(tree).exposure(row, IPHONE);
    expect({ centreCover: seen.centreCover?.node, covers: tagged(seen.covers), tapAt: seen.tapAt }).toEqual({ centreCover: form, covers: [{ node: form, order: 'drawn', presented: true }], tapAt: undefined });
  });
});
