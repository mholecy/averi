import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';

/**
 * A control listed BEFORE a control target it overlaps, in a listing given in READING order (idb's flat list; a WDA
 * sibling run sorted by top — SwiftUI's), is a cover of it: the order does not say which is drawn on top, and the
 * cover is named `unordered`. A target pinned at the screen's bottom keeps its place on top; a run not sorted by top
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
  });

  it("blur-menu: W's covers (C, listed after it, as draw order) are no unordered ones — W stays refused under C (ADR 0015's residual)", async () => {
    const t = await idb('blur-menu.idb.json');
    const seen = drawOrder(t).exposure(byId(t, 'lab.blur-menu.W'), IPHONE);
    expect(seen.covers).toEqual([byId(t, 'lab.blur-menu.C')]);
    expect(seen.unordered).toEqual([]);
  });

  it("mp-native's chooser (idb, ADR 0015's capture): the transaction row listed after the card's rows lies under them", () => {
    const t = parseIdbDescribeAll(JSON.stringify(MODAL.screens.chooser));
    const row = [...everyNode(t)].find((n) => n.label?.startsWith('Loan repayment'))!;
    const seen = drawOrder(t).exposure(row, IPHONE);
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
