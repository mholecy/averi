import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { seenOrderOf, type OrderSeen } from '../../src/ui-tree/seen-order.js';
import { node } from '../helpers/fake.js';

/**
 * The controls listed BEFORE a control target it overlaps, in a listing given in READING order (idb's flat list; a WDA
 * sibling run sorted by top — SwiftUI's), are covers of it when one holds its centre: the order does not say which is
 * drawn on top, and the cover is named `unordered` — as is an overlapping control listed after it (a cover by draw
 * order). A target pinned at the screen's bottom keeps its place on top; a run not sorted by top
 * keeps its order as draw order.
 * docs/bugs/2026-10-16-lab-ios-swiftui-menu-row-listed-in-reading-order-reads-covered-by-the-row-beneath.md
 * docs/adr/0015-flat-list-reading-order-break.md
 */
const IPHONE = { x: 0, y: 0, width: 402, height: 874 };
const truth = async (name: string) => readFile(new URL(`../fixtures/truth/ios-iphone17-ios27/${name}`, import.meta.url), 'utf8');
const idb = async (name: string) => parseIdbDescribeAll(await truth(name));
const wda = async (name: string) => parseWdaSource(await truth(name));
const byId = (tree: UiNode, id: string) => [...everyNode(tree)].find((n) => n.identifier === id)!;
const byLabel = (tree: UiNode, label: string) => [...everyNode(tree)].find((n) => n.label === label)!;
const MODAL = JSON.parse(await readFile(new URL('../fixtures/idb-modal-listed-before-content.json', import.meta.url), 'utf8')) as { screens: Record<string, unknown[]> };

describe('a control listed before a control it partly overlaps, in a reading-order listing, is a cover of it', () => {
  it.each([
    ['blur-menu.idb.json (one run: A, B, K, W, C, D by their tops)', () => idb('blur-menu.idb.json'), 'lab.blur-menu'],
    ['blur-menu.wda.json (six sibling Buttons, sorted by top)', () => wda('blur-menu.wda.json'), 'lab.blur-menu'],
    ["blur-menu-grouped.idb.json (the card's run K, W listed first)", () => idb('blur-menu-grouped.idb.json'), 'lab.blur-menu-grouped'],
  ])('%s: C (51,470) lies under W (51,448), its centre (201,502) on W — no tap point, the order untold', async (_n, tree, prefix) => {
    const t = await tree();
    const w = byId(t, `${prefix}.W`);
    const seen = drawOrder(t).exposure(byId(t, `${prefix}.C`), IPHONE);
    expect(seen.covers).toContain(w);
    expect(seen.centreCover).toBe(w);
    expect(seen.unordered).toEqual([w]);
    expect(seen.tapAt).toBeUndefined();
    // W is a cover, so what shows is already clear of it: nothing more to say of the part a tap may be aimed at.
    expect(seen.aimedClearOf).toEqual([]);
  });

  it.each([
    ['blur-menu.idb.json', () => idb('blur-menu.idb.json')],
    ['blur-menu.wda.json', () => wda('blur-menu.wda.json')],
  ])("%s: W's cover C, listed after it, is one whose order is not told either — W stays covered (ADR 0015's residual), named so", async (_n, tree) => {
    const t = await tree();
    const c = byId(t, 'lab.blur-menu.C');
    const seen = drawOrder(t).exposure(byId(t, 'lab.blur-menu.W'), IPHONE);
    expect(seen.covers).toEqual([c]);
    expect(seen.unordered).toEqual([c]);
  });

  it('a control listed before that only overlaps the edge of a target, clear of its centre, is no cover of it: two cards 4 pt over each other', () => {
    const card = (label: string, y: number): UiNode => node({ role: 'button', label, rect: { x: 16, y, width: 370, height: 120 } });
    const first = card('Card 1', 100);
    const second = card('Card 2', 216);
    const t = node({ role: 'other', rect: { ...IPHONE }, children: [node({ role: 'other', rect: { ...IPHONE }, readingOrder: true, children: [first, second] })] });
    const seen = drawOrder(t).exposure(second, IPHONE);
    expect(seen.covers).toEqual([]);
    expect(seen.unordered).toEqual([]);
    expect(seen.shows).toBe(1);
  });

  it.each([
    ['idb', 'flat'],
    ['wda', 'nested'],
  ])("%s: a moved tap is never aimed at a control listed before the target that overlaps it, its centre clear of it (W 51,390 over C's top, a toast listed after C over its centre)", (_n, shape) => {
    const w = node({ role: 'button', label: 'W', rect: { x: 51, y: 390, width: 300, height: 40 } });
    const c = node({ role: 'button', label: 'C', rect: { x: 51, y: 400, width: 300, height: 120 } });
    const toast = node({ role: 'button', label: 'Toast', rect: { x: 0, y: 440, width: 402, height: 100 } });
    const t =
      shape === 'flat'
        ? node({ role: 'container', rect: { x: 0, y: 0, width: 0, height: 0 }, flatList: true, readingOrder: true, children: [node({ role: 'other', label: 'Screen', rect: { ...IPHONE } }), w, c, toast] })
        : node({ role: 'other', rect: { ...IPHONE }, children: [node({ role: 'other', rect: { ...IPHONE }, readingOrder: true, children: [w, c, toast] })] });
    const seen = drawOrder(t).exposure(c, IPHONE);
    expect(seen.covers).toEqual([toast]);
    expect(seen.centreCover).toBe(toast);
    // The only piece of C clear of the toast, 400–440, lies on W down to 430: 10 pt left, under the 24 a tap needs.
    expect(seen.tapAt).toBeUndefined();
    // …and says so: the part a sentence quotes (`largest`) is cut clear of W, which `shows` still counts.
    expect(seen.aimedClearOf).toEqual([w]);
    expect(seen.largest).toEqual({ x: 51, y: 430, width: 300, height: 10 });
    expect(seen.shows).toBeCloseTo(40 / 120);
  });

  it("a control listed AFTER the target that only pokes over its edge, clear of its centre, is a cover by draw order, its order told: a FAB over a row's corner in idb's flat list (not pinned: a tab bar's items listed after it)", () => {
    const row = node({ role: 'button', label: 'Row', rect: { x: 51, y: 600, width: 300, height: 120 } });
    const fab = node({ role: 'button', label: 'Add', rect: { x: 300, y: 640, width: 60, height: 60 } });
    const tabs = ['Home', 'Pay', 'Cards', 'More'].map((label, i) => node({ role: 'button', label, rect: { x: 37 + 82 * i, y: 755, width: 82, height: 64 } }));
    const t = node({ role: 'container', rect: { x: 0, y: 0, width: 0, height: 0 }, flatList: true, readingOrder: true, children: [node({ role: 'other', label: 'Screen', rect: { ...IPHONE } }), row, fab, ...tabs] });
    const seen = drawOrder(t).exposure(row, IPHONE);
    expect(seen.covers).toEqual([fab]);
    expect(seen.unordered).toEqual([]);
    expect(seen.tapAt).toMatchObject({ moved: false });
  });

  it("mp-native's chooser (idb, ADR 0015's capture): the transaction row listed after the card's rows lies under them", () => {
    const t = parseIdbDescribeAll(JSON.stringify(MODAL.screens.chooser));
    const row = [...everyNode(t)].find((n) => n.label?.startsWith('Loan repayment'))!;
    const seen = drawOrder(t).exposure(row, IPHONE);
    // SWIFT payment (45,453 312x52) holds its centre (201,461); To my account (45,397 312x52) its top 14 pt — both covers.
    expect(seen.covers.map((n) => n.label)).toEqual(['To my account', 'SWIFT payment']);
    expect(seen.unordered).toEqual(seen.covers);
    expect(seen.tapAt).toBeUndefined();
  });

  it.each([
    ['pinned-bar.idb.json', () => idb('pinned-bar.idb.json')],
    ['pinned-bar.wda.json', () => wda('pinned-bar.wda.json')],
  ])('%s: a control pinned at the bottom stays drawn over — Continue is tapped at its centre, P (listed before) is no cover of it', async (_n, tree) => {
    const t = await tree();
    const seen = drawOrder(t).exposure(byLabel(t, 'Continue'), IPHONE);
    expect(seen.covers).toEqual([]);
    expect(seen.tapAt).toMatchObject({ moved: false });
  });

  it("a WDA sibling run NOT sorted by top keeps its order as draw order: Contacts' Add photo is no cover of Remove photo", async () => {
    const t = parseWdaSource(await readFile(new URL('../fixtures/wda-capture-contacts-new-contact.json', import.meta.url), 'utf8'));
    expect(drawOrder(t).exposure(byLabel(t, 'Remove photo'), IPHONE).covers.map((n) => n.label)).not.toContain('Add photo');
  });
});

describe("the parsers mark a listing given in reading order (UiNode.readingOrder): the source's dialect", () => {
  it("idb's flat list: its root", async () => {
    expect((await idb('blur-menu.idb.json')).readingOrder).toBe(true);
  });

  it("WDA: a run of siblings sorted by top (blur-menu's six Buttons in one Other), not one that is not (Contacts' new-contact)", async () => {
    const t = await wda('blur-menu.wda.json');
    const parent = [...everyNode(t)].find((n) => n.children.includes(byId(t, 'lab.blur-menu.W')))!;
    expect(parent.readingOrder).toBe(true);
    const contacts = parseWdaSource(await readFile(new URL('../fixtures/wda-capture-contacts-new-contact.json', import.meta.url), 'utf8'));
    const run = [...everyNode(contacts)].find((n) => n.children.includes(byLabel(contacts, 'Remove photo')))!;
    expect(run.readingOrder).toBeUndefined();
  });
});

/**
 * THE ORDER SEEN (ui-tree/seen-order.ts): what a screenshot showed of two controls the listing does not order enters the
 * draw order as an input — a peer seen UNDER the target is no cover of it (nor a part a moved tap keeps clear of), a peer
 * seen OVER it stays a cover, named `seenOver` instead of `unordered`; an untold pair is today's.
 * docs/adr/0024-the-eyes-tell-the-order-of-two-controls-listed-in-reading-order.md
 */
describe('the order a screenshot saw, handed to the draw order', () => {
  const HEX = { overlap: '#00897B', own: '#00897B', other: '#347937' };
  const trees = [
    ['blur-menu.idb.json', () => idb('blur-menu.idb.json')],
    ['blur-menu.wda.json', () => wda('blur-menu.wda.json')],
  ] as const;

  it.each(trees)('%s: W seen over C — C is no cover of W: W is tapped at its centre, nothing it keeps clear of', async (_n, tree) => {
    const t = await tree();
    const w = byId(t, 'lab.blur-menu.W');
    const c = byId(t, 'lab.blur-menu.C');
    const seen = drawOrder(t, seenOrderOf(w, [{ peer: c, seen: 'over', ...HEX }])).exposure(w, IPHONE);
    expect(seen.covers).toEqual([]);
    expect(seen.unordered).toEqual([]);
    expect(seen.seenOver).toEqual([]);
    expect(seen.aimedClearOf).toEqual([]);
    expect(seen.shows).toBe(1);
    expect(seen.tapAt).toEqual({ point: { x: 201, y: 480 }, moved: false });
  });

  it.each(trees)('%s: the same answer read from C — W stays its cover, seen over it, no longer one whose order is untold', async (_n, tree) => {
    const t = await tree();
    const w = byId(t, 'lab.blur-menu.W');
    const c = byId(t, 'lab.blur-menu.C');
    const seen = drawOrder(t, seenOrderOf(w, [{ peer: c, seen: 'over', ...HEX }])).exposure(c, IPHONE);
    expect(seen.covers).toEqual([w]);
    expect(seen.centreCover).toBe(w);
    expect(seen.seenOver).toEqual([w]);
    expect(seen.unordered).toEqual([]);
    expect(seen.tapAt).toBeUndefined();
  });

  it.each(trees)('%s: the other way round (C seen over W), the seam is honest both ways — W covered, seen; C clear', async (_n, tree) => {
    const t = await tree();
    const w = byId(t, 'lab.blur-menu.W');
    const c = byId(t, 'lab.blur-menu.C');
    const order = drawOrder(t, seenOrderOf(c, [{ peer: w, seen: 'over', ...HEX }]));
    expect(order.exposure(w, IPHONE)).toMatchObject({ covers: [c], seenOver: [c], unordered: [] });
    expect(order.exposure(c, IPHONE)).toMatchObject({ covers: [], seenOver: [], unordered: [], tapAt: { point: { x: 201, y: 502 }, moved: false } });
  });

  it.each(trees)('%s: an untold pair is the listing\'s untold order, as with no screenshot', async (_n, tree) => {
    const t = await tree();
    const w = byId(t, 'lab.blur-menu.W');
    const c = byId(t, 'lab.blur-menu.C');
    const untold: OrderSeen[] = [{ peer: c, seen: 'untold', why: 'the two look alike (ΔE 3.10)' }];
    const { coverAt: _a, ...told } = drawOrder(t, seenOrderOf(w, untold)).exposure(w, IPHONE);
    const { coverAt: _b, ...listed } = drawOrder(t).exposure(w, IPHONE);
    expect(told).toEqual(listed);
    expect(listed.unordered).toEqual([c]);
  });
});
