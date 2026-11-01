import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { drawOrder, drawnOverStrip } from '../../src/ui-tree/draw-order.js';
import { coverNodes } from '../helpers/covers.js';

/**
 * draw-order.ts asked directly (backlog D45) where only other suites reached it before: `paintsOver`'s own-content and
 * clickable-layer exemptions (ADR 0003; tests/verify/pixel-chrome.test.ts judges the same shapes through the pixel
 * assert), `drawnOverAt`, the parser's port `drawnOverStrip`, and `ofKeyboardBand`.
 * The paintsOver shapes mirror pixel-chrome.test.ts's (its "own content and clickable layers" and round-2 probes):
 * a change to one set must be made in step with the other.
 */

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const node = (role: string, frame: Rect, extra: Partial<UiNode> = {}): UiNode => ({ role, label: null, identifier: null, value: null, rect: frame, children: [], ...extra });
/** The Pixel 3a's screen, 1080x2220 px. */
const FULL = rect(0, 0, 1080, 2220);
/** idb's flat list, as `describe-all` gives it: [type, label, id, x, y, width, height]. */
const idb = (rows: [string, string | null, string | null, number, number, number, number][]) =>
  parseIdbDescribeAll(JSON.stringify(rows.map(([type, label, id, x, y, width, height]) => ({ type, AXLabel: label, AXUniqueId: id, AXValue: null, frame: { x, y, width, height } }))));
const byId = (tree: UiNode, id: string): UiNode => [...everyNode(tree)].find((x) => x.identifier === id)!;

describe('paintsOver — a clickable layer: unlabelled, unvalued, interactive, holding the node whole, on its own branch', () => {
  /** Compose's row: its "LR" avatar text, and the row's button (the ripple's touch target) listed after it over the whole row. */
  const row = (layer: UiNode) => {
    const text = node('text', rect(136, 532, 48, 49), { label: 'LR' });
    const tree = node('container', FULL, { children: [node('container', rect(0, 400, 1080, 1800), { children: [node('container', rect(66, 484, 948, 143), { children: [node('container', rect(116, 512, 88, 88), { children: [text] }), layer] })] })] });
    return { tree, text };
  };

  it("the row's transparent button is no cover of its text; a node of another tree has none", () => {
    const { tree, text } = row(node('button', rect(66, 484, 948, 143)));
    expect(coverNodes(drawOrder(tree).paintsOver(text, FULL))).toEqual([]);
    expect(coverNodes(drawOrder(tree).paintsOver(node('text', rect(136, 532, 48, 49), { label: 'LR' }), FULL))).toEqual([]);
  });

  it('…but a labelled one, a valued one, or one that does not hold the text whole draws over it', () => {
    const labelled = node('button', rect(66, 484, 948, 143), { label: 'Open' });
    const l = row(labelled);
    expect(coverNodes(drawOrder(l.tree).paintsOver(l.text, FULL))).toEqual([labelled]);
    const valued = node('button', rect(66, 484, 948, 143), { value: 'on' });
    const v = row(valued);
    expect(coverNodes(drawOrder(v.tree).paintsOver(v.text, FULL))).toEqual([valued]);
    const partial = node('button', rect(150, 484, 864, 143));
    const p = row(partial);
    expect(coverNodes(drawOrder(p.tree).paintsOver(p.text, FULL))).toEqual([partial]);
  });

  it("a dialog's clickable scrim over the screen is met only at the root — another layer: it counts", () => {
    const text = node('text', rect(136, 532, 48, 49), { label: 'LR' });
    const scrim = node('button', FULL);
    const tree = node('container', FULL, { children: [node('container', rect(0, 400, 1080, 1800), { children: [node('container', rect(66, 484, 948, 143), { children: [text] })] }), node('container', FULL, { children: [scrim] })] });
    expect(coverNodes(drawOrder(tree).paintsOver(text, FULL))).toEqual([scrim]);
  });

  it('a flat list has no branches to say whose layer it is: an unlabelled button over the whole card is a cover', () => {
    const tree = idb([
      ['Application', 'app', null, 0, 0, 402, 874],
      ['Other', 'Accounts', 'card', 24, 100, 354, 300],
      ['Button', null, null, 0, 0, 402, 874],
    ]);
    expect(coverNodes(drawOrder(tree).paintsOver(byId(tree, 'card'), rect(0, 0, 402, 874))).map((c) => c.rect)).toEqual([rect(0, 0, 402, 874)]);
  });
});

describe("paintsOver — the node's own content: a cover whose reach lies inside its rect, on its own branch (at most half the screen)", () => {
  /** A row 24,60 1000x200 and a control listed after it inside its rect (what `exposure` counts over a row), both in a card of `cardHeight`. */
  const card = (cardHeight: number) => {
    const row = node('container', rect(24, 60, 1000, 200), { identifier: 'row' });
    const own = node('button', rect(300, 100, 200, 40), { label: 'Edit' });
    return { tree: node('container', FULL, { children: [node('container', rect(0, 0, 1080, cardHeight), { children: [row, own] })] }), row, own };
  };

  it('in a card of a fifth of the screen: content, no cover; in one of exactly half: still; past half, a layer of the screen — it counts', () => {
    const fifth = card(400);
    expect(coverNodes(drawOrder(fifth.tree).paintsOver(fifth.row, FULL))).toEqual([]);
    const half = card(1110);
    expect(coverNodes(drawOrder(half.tree).paintsOver(half.row, FULL))).toEqual([]);
    const more = card(1111);
    expect(coverNodes(drawOrder(more.tree).paintsOver(more.row, FULL))).toEqual([more.own]);
  });

  it('a cover reaching past the node\'s rect is never its content, on its own branch or not', () => {
    const row = node('container', rect(24, 60, 1000, 200), { identifier: 'row' });
    const badge = node('button', rect(900, 40, 120, 40), { label: 'New' });
    const tree = node('container', FULL, { children: [node('container', rect(0, 0, 1080, 400), { children: [row, badge] })] });
    expect(coverNodes(drawOrder(tree).paintsOver(row, FULL))).toEqual([badge]);
  });

  it("the same text in a bar laid over the screen is chrome: met at the root, it counts", () => {
    const row = node('container', rect(24, 60, 1000, 200), { identifier: 'row' });
    const own = node('text', rect(300, 100, 200, 40), { label: 'Title' });
    const bar = node('container', rect(0, 66, 1080, 160), { children: [own] });
    const tree = node('container', FULL, { children: [node('container', FULL, { children: [row] }), bar] });
    expect(coverNodes(drawOrder(tree).paintsOver(row, FULL))).toEqual([bar, own]);
  });
});

describe("paintsOver — own content in a flat list: the cover says something, and nothing the node does not (`wordsOf`)", () => {
  const card = (label: string | null) =>
    idb([
      ['Application', 'app', null, 0, 0, 402, 874],
      ['Other', 'Accounting Balance 2 000,00 CZK', 'card', 0, 100, 402, 600],
      ['StaticText', label, 'inside', 24, 120, 354, 52],
    ]);
  const IPHONE = rect(0, 0, 402, 874);

  it("idb's account card and its \"Accounting Balance, 2 000, ,00, CZK\" text: the same words, split at anything not a letter or a digit, any case — content", () => {
    const tree = card('Accounting Balance, 2 000, ,00, CZK');
    expect(coverNodes(drawOrder(tree).paintsOver(byId(tree, 'card'), IPHONE))).toEqual([]);
    const shouting = card('ACCOUNTING balance');
    expect(coverNodes(drawOrder(shouting).paintsOver(byId(shouting, 'card'), IPHONE))).toEqual([]);
  });

  it('a word the card does not say makes it a cover (a sheet listed after a card says other words); so does a cover that says nothing', () => {
    const sheet = card('Accounting Sheet');
    expect(coverNodes(drawOrder(sheet).paintsOver(byId(sheet, 'card'), IPHONE))).toEqual([byId(sheet, 'inside')]);
    const mute = card(null);
    expect(coverNodes(drawOrder(mute).paintsOver(byId(mute, 'card'), IPHONE))).toEqual([byId(mute, 'inside')]);
  });
});

describe('drawnOverAt — the one of drawnOver(container) on top at a point', () => {
  const LIST = rect(0, 825, 1080, 1395);
  const tree = (...after: UiNode[]) => node('container', FULL, { children: [node('scrollable', LIST, { children: [node('button', rect(0, 900, 1080, 200), { label: 'Row' })] }), ...after] });

  it('the last node drawn over the list holding the point; none where nothing is drawn over it', () => {
    const bar = node('container', rect(0, 2010, 1080, 210), { label: 'Tabs' });
    const tab = node('button', rect(0, 2010, 270, 210), { label: 'Home' });
    const order = drawOrder(tree(bar, tab));
    expect(order.drawnOverAt(LIST, { x: 100, y: 2100 })).toBe(tab);
    expect(order.drawnOverAt(LIST, { x: 800, y: 2100 })).toBe(bar);
    expect(order.drawnOverAt(LIST, { x: 100, y: 1000 })).toBeUndefined();
  });

  it("a wrapper holding the list's rect whole is no evidence of a cover at a touch-down; undefined for a list this tree does not hold", () => {
    const overlay = node('container', FULL, { label: 'Overlay' });
    const order = drawOrder(tree(overlay));
    expect(order.drawnOver(LIST)).toEqual([overlay]);
    expect(order.drawnOverAt(LIST, { x: 100, y: 1000 })).toBeUndefined();
    expect(order.drawnOverAt(rect(0, 826, 1080, 1395), { x: 100, y: 1000 })).toBeUndefined();
  });
});

describe("drawnOverStrip — the uiautomator parser's port: is a strip drawn over for a node", () => {
  it('true where a node drawn after it meets the strip, false where nothing does', () => {
    const row = node('button', rect(0, 1900, 1080, 200), { label: 'Row' });
    const bar = node('container', rect(0, 2010, 1080, 210), { label: 'Tabs' });
    const over = drawnOverStrip(node('container', FULL, { children: [node('scrollable', rect(0, 825, 1080, 1395), { children: [row] }), bar] }));
    expect(over(row, rect(0, 2050, 1080, 50))).toBe(true);
    expect(over(row, rect(0, 1900, 1080, 50))).toBe(false);
  });
});

describe("ofKeyboardBand — idb's keyboard's own nodes", () => {
  it("the number pad's keys and its background are the keyboard's; the form's CONTINUE above it is not; a tree with no band has none", async () => {
    const pad = JSON.parse(await readFile(new URL('../fixtures/idb-swift-form-number-pad.json', import.meta.url), 'utf8')) as { elements: unknown[] };
    const tree = parseIdbDescribeAll(JSON.stringify(pad.elements));
    const order = drawOrder(tree);
    const byLabel = (label: string | null, role?: string) => tree.children.find((c) => c.label === label && (role === undefined || c.role === role))!;
    expect(order.ofKeyboardBand(byLabel('5'))).toBe(true);
    expect(order.ofKeyboardBand(byLabel('Delete'))).toBe(true);
    expect(order.ofKeyboardBand(byLabel('Continue to summary'))).toBe(false);
    const flat = idb([['Application', 'app', null, 0, 0, 402, 874], ['Button', 'Continue', null, 24, 780, 354, 44]]);
    expect(drawOrder(flat).ofKeyboardBand(flat.children[0])).toBe(false);
  });
});
