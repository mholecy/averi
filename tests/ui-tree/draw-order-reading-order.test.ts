import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { treeScreen } from '../../src/ui-tree/usable-screen.js';
import { seenOrderOf, type OrderSeen } from '../../src/ui-tree/seen-order.js';
import { coverNodes, tagged } from '../helpers/covers.js';
import { iosTrees } from '../helpers/ios-trees.js';
import { screenOf } from '../../src/ui-tree/geometry.js';
import { node } from '../helpers/fake.js';
import { IPHONE_17 } from '../helpers/pixels.js';

/**
 * A row past its scroll view's clip, in idb's flat list (which lists no scroll view): `scroll-bounded`'s O `51,620 300x64`, a
 * control `Continue` just under the clip listed AFTER it whose top lies ABOVE O's top (a reading-order break, ADR 0015) and
 * which holds O's centre. The break excuses every node from Continue on as a cover, so `tap O` was `reachable` at the
 * centre — on Continue, and `Tapped O` fired it. A control that overlaps the target and holds its centre is a cover
 * whose order is not told whatever the break says: the eyes tell it (ADR 0024).
 * docs/bugs/2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md
 */
describe('a control listed after a target, past a reading-order break, that holds its centre is a cover whose order is not told', () => {
  const raw = async () => JSON.parse(await truth('scroll-bounded.idb.json')) as Record<string, unknown>[];
  const continueAt = (template: Record<string, unknown>, y: number): Record<string, unknown> => ({
    ...template,
    AXUniqueId: 'lab.scroll-bounded.continue',
    AXLabel: 'Continue',
    frame: { x: 16, y, width: 370, height: 56 },
  });
  const tree = async (listed: 'after' | 'before', y: number) => {
    const list = await raw();
    const button = continueAt(list[4]!, y);
    return parseIdbDescribeAll(JSON.stringify(listed === 'after' ? [...list, button] : [list[0], button, ...list.slice(1)]));
  };

  it('Continue 16,600 370x56 listed after O (top 600 above O 620, centre 652 on it): untold, the tap moved clear of it, the plain stop covered', async () => {
    const t = await tree('after', 600);
    const [o, cont] = [byId(t, 'lab.scroll-bounded.O'), byId(t, 'lab.scroll-bounded.continue')];
    const seen = drawOrder(t).exposure(o, IPHONE);
    expect(tagged(seen.covers)).toEqual([{ node: cont, order: 'untold', presented: false }]);
    expect(seen.centreCover?.node).toBe(cont);
    // 656–684 is clear of Continue: 28 pt, a tap's piece.
    expect(seen.tapAt).toEqual({ point: { x: 201, y: 670 }, moved: true, piece: { x: 51, y: 656, width: 300, height: 28 } });
    const stop = sceneOf(t).standing(o, treeScreen(t), { of: 'stop' });
    expect(stop).toMatchObject({ kind: 'covered', remedy: { of: 'unordered' } });
  });

  // A control listed after the target that holds its centre is untold in any listing in reading order, break or none.
  it('Continue 16,640 listed after O: its top is below O\'s, no break — a cover as before', async () => {
    const t = await tree('after', 640);
    const seen = drawOrder(t).exposure(byId(t, 'lab.scroll-bounded.O'), IPHONE);
    expect(tagged(seen.covers)).toEqual([{ node: byId(t, 'lab.scroll-bounded.continue'), order: 'untold', presented: false }]);
  });

  it('Continue listed BEFORE O is the reading-order cover it was: untold, with the same moved tap', async () => {
    const t = await tree('before', 600);
    const seen = drawOrder(t).exposure(byId(t, 'lab.scroll-bounded.O'), IPHONE);
    expect(tagged(seen.covers)).toEqual([{ node: byId(t, 'lab.scroll-bounded.continue'), order: 'untold', presented: false }]);
  });

  it('Continue seen UNDER O is no cover (the screenshot overrides the listing); seen OVER it, a cover named so', async () => {
    const t = await tree('after', 600);
    const [o, cont] = [byId(t, 'lab.scroll-bounded.O'), byId(t, 'lab.scroll-bounded.continue')];
    const HEX = { overlap: '#1E88E5', own: '#1E88E5', other: '#E53935' };
    expect(drawOrder(t, seenOrderOf(o, [{ peer: cont, seen: 'over', ...HEX }])).exposure(o, IPHONE).covers).toEqual([]);
    // …for every question of O, not only the tap's: the break excuses a peer seen under (`coversAfter` keeps none).
    expect(drawOrder(t, seenOrderOf(o, [{ peer: cont, seen: 'over', ...HEX }])).coversOf(o, IPHONE)).toEqual([]);
    const over = drawOrder(t, seenOrderOf(o, [{ peer: cont, seen: 'under', ...HEX }])).exposure(o, IPHONE);
    expect(tagged(over.covers)).toEqual([{ node: cont, order: 'seenOver', presented: false }]);
  });

  it('over the real capture, scroll-bounded-footer (idb lists O, then Continue): Continue an untold cover of O, the tap moved clear of it to (201,670), the plain stop covered', async () => {
    const t = await idb('scroll-bounded-footer.idb.json');
    const [o, cont] = [byId(t, 'lab.scroll-bounded-footer.O'), byId(t, 'lab.scroll-bounded-footer.continue')];
    const seen = drawOrder(t).exposure(o, IPHONE);
    expect(tagged(seen.covers)).toEqual([{ node: cont, order: 'untold', presented: false }]);
    expect(seen.tapAt).toEqual({ point: { x: 201, y: 670 }, moved: true, piece: { x: 51, y: 656, width: 300, height: 28 } });
    expect(sceneOf(t).standing(o, treeScreen(t), { of: 'stop' })).toMatchObject({ kind: 'covered', remedy: { of: 'unordered' } });
  });

  it('a floating tab bar\'s item is no target of it: tabbar-dense\'s items (idb lists them first, `Row 8 24,780` after, over their centres at y 787) are uncovered, tapped at their centres — the bar is drawn over the rows', async () => {
    const t = await idb('tabbar-dense.idb.json');
    for (const tab of ['home', 'transactions', 'cards', 'more']) {
      const item = byId(t, `lab.tabbar-dense.tab.${tab}`);
      const seen = drawOrder(t).exposure(item, IPHONE);
      expect(seen.covers).toEqual([]);
      expect(seen.tapAt).toEqual({ point: { x: item.rect.x + 41, y: 787 }, moved: false });
    }
  });

  it('only the break\'s excuse gives way: a control listed after the target holding its centre that another row excuses (hidden) stays no cover', () => {
    const a = node({ role: 'button', label: 'A', identifier: 'a', rect: { x: 51, y: 448, width: 300, height: 64 } });
    const b = node({ role: 'button', label: 'B', identifier: 'b', rect: { x: 51, y: 470, width: 300, height: 64 }, hidden: true });
    const root = { ...node({ role: 'container', rect: IPHONE, children: [a, b] }), readingOrder: true as const };
    expect(drawOrder(root).exposure(a, IPHONE)).toMatchObject({ covers: [], tapAt: { point: { x: 201, y: 480 }, moved: false } });
  });
});

describe('over every iOS tree of the committed fixtures: the untold covers listed after their target', () => {
  // Pinned: every target with a control listed after it whose order against it is not told, over the whole corpus — what the
  // eyes are asked of because of a control listed after (a screenshot per plain stop; per tap where no piece is left clear).
  // The rule (`coversAfter`) added the idb ones but blur-menu's: before it the break excused their cover.
  // blur-menu-stacked and blur-menu-unhidden (round 16's probes of ADR 0018 residual 9) list W and C under idb as
  // blur-menu-grouped does.
  it('are scroll-bounded-footer\'s O, the grouped blur menus\' W, mp-native\'s chooser row_swift and its lab rebuild\'s S — and the pair a listing already gave', async () => {
    const untold: string[] = [];
    let judged = 0;

    for (const [file, tree] of await iosTrees()) {
      const nodes = [...everyNode(tree)];
      // A node by its identifier or label, else by its role, rect and place in the walk (a bare wrapper).
      const describeNode = (n: UiNode): string =>
        n.identifier ?? n.label ?? `${n.role} ${n.rect.x},${n.rect.y} ${n.rect.width}x${n.rect.height} #${nodes.indexOf(n)}`;
      const screen = screenOf(tree);
      const seen = drawOrder(tree);
      nodes.forEach((n, i) => {
        judged++;
        for (const c of seen.exposure(n, screen).covers) {
          if (c.order.kind === 'untold' && nodes.indexOf(c.node) > i) untold.push(`${file}: ${describeNode(n)} under ${describeNode(c.node)}`);
        }
      });
    }
    expect(judged).toBeGreaterThan(4000);
    expect(untold).toEqual([
      'idb-modal-listed-before-content.json#0: accounts.detail.payment_type_sheet.row_swift under transactions.list.row_0',
      // D84 (ADR 0015's D84 amendment): a nested run's later-listed sibling drawn over the target is an untold peer of
      // any kind, no longer `drawn` — here the screen-sized wrapper and its child, the form's container listed after
      // them over their bottom (neither is a target anyone taps: the same tap point, only the order's kind moves)…
      'wda-capture-lab-form-keyboard.json: container 0,0 402x874 #14 under container 0,116 402x764 #17',
      'wda-capture-lab-form-keyboard.json: container 0,0 402x874 #16 under container 0,116 402x764 #17',
      'blur-menu-grouped.idb.json#0: lab.blur-menu-grouped.W under lab.blur-menu-grouped.C',
      'blur-menu-stacked.idb.json#0: lab.blur-menu-stacked.W under lab.blur-menu-stacked.C',
      'blur-menu-unhidden.idb.json#0: lab.blur-menu-unhidden.W under lab.blur-menu-unhidden.C',
      // the ungrouped menu: its rows listed between the targets, no break before C — untold before the rule too
      'blur-menu.idb.json#0: lab.blur-menu.W under lab.blur-menu.C',
      'blur-menu.wda.json: lab.blur-menu.W under lab.blur-menu.C',
      'chooser-over-list.idb.json#0: lab.chooser-over-list.S under lab.chooser-over-list.R',
      'form-keyboard.wda.json: container 0,0 402x874 #14 under container 0,116 402x764 #17',
      'form-keyboard.wda.json: container 0,0 402x874 #16 under container 0,116 402x764 #17',
      'scroll-bounded-footer.idb.json#0: lab.scroll-bounded-footer.O under lab.scroll-bounded-footer.continue',
      // …and rn-banner's bare RN Views: each cover asked as a target (T's and U's, listed before their targets by their
      // tops), and C under its cover listed after it — the run cannot tell which is on top; the eyes do (the
      // golden's C).
      'rn-banner.wda.json: lab.rn-banner.T.cover under lab.rn-banner.T',
      'rn-banner.wda.json: lab.rn-banner.U.cover under lab.rn-banner.U',
      'rn-banner.wda.json: lab.rn-banner.C under lab.rn-banner.C.cover',
    ]);
  });
});

/**
 * The controls listed BEFORE a control target it overlaps, in a listing given in READING order (idb's flat list; a WDA
 * sibling run sorted by top — SwiftUI's), are covers of it when one holds its centre: the order does not say which is
 * drawn on top, and the cover's order is `untold` (ui-tree/cover.ts#CoverOrder) — as is an overlapping control listed after it (a cover by draw
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
    expect(tagged(seen.covers).filter((c) => c.order !== 'drawn')).toEqual([{ node: w, order: 'untold', presented: false }]);
    expect(seen.centreCover?.node).toBe(w);
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
    expect(tagged(seen.covers)).toEqual([{ node: c, order: 'untold', presented: false }]);
  });

  it('a control listed before that only overlaps the edge of a target, clear of its centre, is no cover of it: two cards 4 pt over each other', () => {
    const card = (label: string, y: number): UiNode => node({ role: 'button', label, rect: { x: 16, y, width: 370, height: 120 } });
    const first = card('Card 1', 100);
    const second = card('Card 2', 216);
    const t = node({ role: 'other', rect: { ...IPHONE }, children: [node({ role: 'other', rect: { ...IPHONE }, readingOrder: true, children: [first, second] })] });
    const seen = drawOrder(t).exposure(second, IPHONE);
    expect(seen.covers).toEqual([]);
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
    expect(tagged(seen.covers)).toEqual([{ node: toast, order: 'untold', presented: false }]);
    expect(seen.centreCover?.node).toBe(toast);
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
    expect(tagged(seen.covers)).toEqual([{ node: fab, order: 'drawn', presented: false }]);
    expect(seen.tapAt).toMatchObject({ moved: false });
  });

  it("mp-native's chooser (idb, ADR 0015's capture): the transaction row listed after the card's rows lies under them", () => {
    const t = parseIdbDescribeAll(JSON.stringify(MODAL.screens.chooser));
    const row = [...everyNode(t)].find((n) => n.label?.startsWith('Loan repayment'))!;
    const seen = drawOrder(t).exposure(row, IPHONE);
    // SWIFT payment (45,453 312x52) holds its centre (201,461); To my account (45,397 312x52) its top 14 pt — both covers.
    expect(tagged(seen.covers).map(({ node: n, order }) => [n.label, order])).toEqual([
      ['To my account', 'untold'],
      ['SWIFT payment', 'untold'],
    ]);
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
    expect(drawOrder(t).exposure(byLabel(t, 'Remove photo'), IPHONE).covers.map((c) => c.node.label)).not.toContain('Add photo');
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
 * seen OVER it stays a cover, its order `seenOver` instead of `untold`; an untold pair is today's.
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
    expect(seen.aimedClearOf).toEqual([]);
    expect(seen.shows).toBe(1);
    expect(seen.tapAt).toEqual({ point: { x: 201, y: 480 }, moved: false });
  });

  it.each(trees)('%s: the same answer read from C — W stays its cover, seen over it, no longer one whose order is untold', async (_n, tree) => {
    const t = await tree();
    const w = byId(t, 'lab.blur-menu.W');
    const c = byId(t, 'lab.blur-menu.C');
    const seen = drawOrder(t, seenOrderOf(w, [{ peer: c, seen: 'over', ...HEX }])).exposure(c, IPHONE);
    expect(tagged(seen.covers)).toEqual([{ node: w, order: 'seenOver', presented: false }]);
    expect(seen.centreCover?.node).toBe(w);
    expect(seen.tapAt).toBeUndefined();
  });

  it.each(trees)('%s: the other way round (C seen over W), the seam is honest both ways — W covered, seen; C clear', async (_n, tree) => {
    const t = await tree();
    const w = byId(t, 'lab.blur-menu.W');
    const c = byId(t, 'lab.blur-menu.C');
    const order = drawOrder(t, seenOrderOf(c, [{ peer: w, seen: 'over', ...HEX }]));
    expect(tagged(order.exposure(w, IPHONE).covers)).toEqual([{ node: c, order: 'seenOver', presented: false }]);
    expect(order.exposure(c, IPHONE)).toMatchObject({ covers: [], tapAt: { point: { x: 201, y: 502 }, moved: false } });
  });

  it.each(trees)('%s: an untold pair is the listing\'s untold order, as with no screenshot', async (_n, tree) => {
    const t = await tree();
    const w = byId(t, 'lab.blur-menu.W');
    const c = byId(t, 'lab.blur-menu.C');
    const untold: OrderSeen[] = [{ peer: c, seen: 'untold', why: 'the two look alike (ΔE 3.10)' }];
    const told = drawOrder(t, seenOrderOf(w, untold)).exposure(w, IPHONE);
    const listed = drawOrder(t).exposure(w, IPHONE);
    expect(told).toEqual(listed);
    expect(tagged(listed.covers)).toEqual([{ node: c, order: 'untold', presented: false }]);
  });
});

/**
 * idb's TOP BAR against its content in reading order (reading-order.ts#peersOf, `contentFrom`; ADR 0004, chrome before
 * content): the bar's controls are no peers whose order is untold — of a content row scrolled under them, nor, for a
 * bar control, a content row listed after it, which the draw order judges as before (drawn over it when it reaches past
 * the bar's band).
 */
describe('idb\'s top bar and its content: no reading-order peers of each other', () => {
  const el = (identifier: string, rect: UiNode['rect'], role = 'button'): UiNode => node({ role, identifier, rect });
  const flat = (...children: UiNode[]): UiNode => node({ role: 'application', rect: IPHONE_17.box, flatList: true, readingOrder: true, children });
  const covers = (t: UiNode, target: UiNode) => sceneOf(t).standing(target, IPHONE_17, { of: 'tap' }).facts.covers.map((c) => [c.node.identifier, c.order.kind]);

  it('a content row scrolled under the bar\'s Back, which holds its centre: Back is no cover of it', () => {
    const row = el('row', { x: 0, y: 70, width: 200, height: 60 });
    const t = flat(el('back', { x: 0, y: 62, width: 120, height: 44 }), el('title', { x: 150, y: 62, width: 100, height: 44 }, 'text'), row, el('row2', { x: 0, y: 200, width: 402, height: 60 }));
    expect(covers(t, row)).toEqual([]);
  });

  it('a content row listed after Back that reaches past the bar\'s band and holds its centre: drawn over it, its order told', () => {
    const back = el('back', { x: 0, y: 62, width: 120, height: 44 });
    const t = flat(back, el('row0', { x: 0, y: 300, width: 402, height: 60 }), el('row', { x: 0, y: 66, width: 402, height: 300 }));
    expect(covers(t, back)).toEqual([['row', 'drawn']]);
  });
});
