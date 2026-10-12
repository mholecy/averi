import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { everyNode, type DeviceScreen, type UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { nodeText } from '../../src/ui-tree/geometry.js';
import { chromeOverElement } from '../../src/verify/pixel-poll.js';

const FIXTURES = new URL('../fixtures/', import.meta.url);
const json = async (file: string) => JSON.parse(await readFile(new URL(file, FIXTURES), 'utf8'));
const IPHONE: DeviceScreen = { width: 402, height: 874, statusBand: 62 };
const PIXEL_3A: DeviceScreen = { width: 1080, height: 2220 };

/** Every real tree the suite holds, with the screen its device reported. */
async function fixtureTrees(androidBand?: number): Promise<[string, UiNode, DeviceScreen][]> {
  const trees: [string, UiNode, DeviceScreen][] = [];
  for (const file of (await readdir(FIXTURES)).filter((f) => f.startsWith('wda-source')).sort()) {
    trees.push([file, parseWdaSource(await readFile(new URL(file, FIXTURES), 'utf8')), IPHONE]);
  }
  trees.push(['idb-swift-form-continue', parseIdbDescribeAll(await readFile(new URL('idb-swift-form-continue.json', FIXTURES), 'utf8')), IPHONE]);
  trees.push(['idb-swift-form-number-pad', parseIdbDescribeAll(JSON.stringify((await json('idb-swift-form-number-pad.json')).elements)), IPHONE]);
  for (const [k, v] of Object.entries((await json('idb-modal-listed-before-content.json')).screens)) trees.push([`idb-modal ${k}`, parseIdbDescribeAll(JSON.stringify(v)), IPHONE]);
  for (const [k, v] of Object.entries((await json('idb-swift-form-scrolled-under-top-bar.json')).positions)) trees.push([`idb-top-bar ${k}`, parseIdbDescribeAll(JSON.stringify(v)), IPHONE]);
  for (const [k, v] of Object.entries((await json('android-ui-snapshot-compose.json')).screens)) trees.push([`android ${k}`, { ...(v as UiNode), paddedTouchTargets: true }, { ...PIXEL_3A, ...(androidBand !== undefined && { statusBand: androidBand }) }]);
  return trees;
}

/**
 * Every node of area — not only the labelled or interactive ones (review of fix/r8-pixel, round 1) — judged by
 * chromeOverElement: the misses, one line each, `<fixture>: <element> — <what is drawn over it>`.
 */
async function sweep(androidBand?: number): Promise<{ judged: number; misses: string[] }> {
  const misses: string[] = [];
  let judged = 0;
  for (const [name, tree, screen] of await fixtureTrees(androidBand)) {
    const adapter = { viewport: async () => screen };
    for (const n of everyNode(tree)) {
      if (n === tree || n.ofKeyboard === true || !(n.rect.width * n.rect.height > 0)) continue;
      judged++;
      const over = await chromeOverElement(adapter, tree, n);
      if (over !== undefined) misses.push(`${name}: ${nodeText(n)} — ${over.slice(0, over.indexOf(' — '))}`);
    }
  }
  return { judged, misses };
}

/** The covers the misses name, with how many elements each was named over. */
const coversNamed = (misses: readonly string[]): Record<string, number> => {
  const named: Record<string, number> = {};
  for (const m of misses) {
    const what = m.slice(m.indexOf(' — ') + 3).replace(/ is drawn over the element .*/, '');
    if (!what.startsWith('the status bar')) named[what] = (named[what] ?? 0) + 1;
  }
  return named;
};

/**
 * Round 8 (review of fix/r8-pixel, round 1): the pixel assert's chrome over every node of every real tree the
 * suite holds. The first cut asked the tap's cover question (`exposure`) and failed ~30 nodes on things that take
 * a touch and hide no pixel — the element's own content listed beside it, a clickable layer, a 2-pt edge. What is
 * left is chrome: CONTINUE, the floating tab bar, Compose's top bar over a scrolled field, the RN debugger banner.
 */
describe('chromeOverElement over every fixture node (round 8)', () => {
  it('the covers named are chrome only — nothing that takes a touch and hides no pixel', async () => {
    const { judged, misses } = await sweep();
    expect(judged).toBe(1820);
    expect(coversNamed(misses)).toEqual({
      'button "Continue to summary" (24,512 354x44, reaching 24,512 354x77)': 1,
      'button "Continue to summary" (24,780 354x44, reaching 24,780 354x94)': 20,
      'container "!, Open debugger to view warnings." (10,787 382x49)': 4,
      'container (154,88 407x132)': 2,
      'container (66,1840 948x248)': 6,
      'container id:nav.tab_cards (540,1876 219x176)': 1,
      'container id:nav.tab_more (759,1876 219x176)': 2,
      'other "More" (830,1926 77x77)': 6,
      'text "Create contact" (154,115 407x77)': 2,
      'text "Phone (Mobile)" (176,1871 233x44)': 1,
      'text "Phone (Mobile)" (176,725 233x44)': 1,
    });
    expect(misses.filter((m) => m.includes('the status bar is drawn over'))).toHaveLength(30);
  });

  it('the reviewer\'s false covers are gone: own content beside the element, a clickable layer, a 2-pt edge', async () => {
    const { misses } = await sweep();
    const over = (element: string) => misses.filter((m) => m.includes(`: ${element} — `));
    // WDA React Native: the field's own input box, the switcher's own flag.
    expect(over('container id:login_username_field (36,339 330x80)')).toEqual([]);
    expect(over('container id:login_language_switcher (36,235 330x32)')).toEqual([]);
    // idb: the account card and its own "Accounting Balance" text.
    expect(misses.filter((m) => m.startsWith('idb-modal chooser'))).toEqual([]);
    // Compose: the card's and the rows' clickable layers over "1,121" and every "LR" avatar.
    expect(over('text "1,121" (385,290 145x69)')).toEqual([]);
    expect(misses.filter((m) => m.includes(': text "LR" '))).toEqual([]);
    // 2 pt: "Amount*" under "Value*", `Payee’s country` ending 2 pt into CONTINUE.
    expect(over('text "Amount*" (42,283 51x15)')).toEqual([]);
    expect(over('button "Payee’s country" (24,730 354x52)')).toEqual([]);
    // …and what is chrome still is: CONTINUE's frame inside a 52-pt row it hangs over, its reach not.
    expect(over('button "Payee’s country" (24,776 354x52)')).toEqual([
      expect.stringContaining('button "Continue to summary" (24,780 354x44, reaching 24,780 354x94) is drawn over the element'),
    ]);
  });

  it('with a 66-px Android status band (fix/r8-band): no screen-sized root fails — only a scrim and a top bar laid under the bar', async () => {
    const { misses } = await sweep(66);
    expect(misses.filter((m) => m.startsWith('android') && m.includes('the status bar is drawn over')).map((m) => m.slice(0, m.indexOf(' — ')))).toEqual([
      'android contactsSyncPromo: other "Close sheet" (0,0 1080x1087)',
      'android contactsCreateStaged: container (0,0 1080x242)',
      'android contactsCreate: container (0,0 1080x242)',
    ]);
  });
});

/** The owner's 2-unit edge (geometry.ts#PIXEL_OVERLAP_SLACK): ≤ 2 on the thin side is no cover, 3 is — for a cover and for the band alike. */
describe('the 2-unit edge (round 8, the owner\'s decision)', async () => {
  const pos4 = (await json('idb-swift-form-scrolled-under-top-bar.json')).positions.pos4 as { AXLabel?: string; frame: { y: number } }[];
  const formWith = (label: string, y: number) => parseIdbDescribeAll(JSON.stringify(pos4.map((e) => (e.AXLabel === label ? { ...e, frame: { ...e.frame, y } } : e))));
  const judge = (tree: UiNode, label: string) => chromeOverElement({ viewport: async () => IPHONE }, tree, [...everyNode(tree)].find((n) => n.label === label)!);

  it('`Payee’s country` 2 pt into CONTINUE is clear; 3 pt in, CONTINUE is named', async () => {
    expect(await judge(formWith('Payee’s country', 730), 'Payee’s country')).toBeUndefined();
    expect(await judge(formWith('Payee’s country', 731), 'Payee’s country')).toMatch(/^button "Continue to summary" \(24,780 354x44, reaching 24,780 354x94\) is drawn over the element \(element 24,731 354x52\)/);
  });

  it('an element 2 pt into the 62-pt status band is clear; 3 pt in, the band is named', async () => {
    expect(await judge(formWith('Payee’s country', 60), 'Payee’s country')).toBeUndefined();
    expect(await judge(formWith('Payee’s country', 59), 'Payee’s country')).toMatch(/^the status bar is drawn over the element \(element 24,59 354x52, status bar 0,0 402x62\)/);
  });
});

/** draw-order.ts#paintsOver's two exemptions hold only on the element's own branch (`ownBranch`): met at a screen-sized ancestor, the same shapes are another layer of the screen. */
describe('own content and clickable layers count only on the element\'s own branch', () => {
  const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const n = (role: string, r: ReturnType<typeof rect>, extra: Partial<UiNode> = {}): UiNode => ({ role, label: null, identifier: null, value: null, rect: r, children: [], ...extra });
  const FULL = rect(0, 0, 1080, 2220);
  const judge = (tree: UiNode, element: UiNode) => chromeOverElement({ viewport: async () => PIXEL_3A }, tree, element);

  it('a clickable layer on the row\'s branch is no cover; a dialog\'s clickable scrim over the screen is', async () => {
    const text = n('text', rect(136, 532, 48, 49), { label: 'LR' });
    const row = n('container', rect(66, 484, 948, 143), { children: [n('container', rect(116, 512, 88, 88), { children: [text] }), n('button', rect(66, 484, 948, 143))] });
    const list = n('container', FULL, { children: [n('container', rect(0, 400, 1080, 1800), { children: [row] })] });
    expect(await judge(list, text)).toBeUndefined();
    const scrim = n('button', FULL);
    const withDialog = n('container', FULL, { children: [n('container', rect(0, 400, 1080, 1800), { children: [n('container', rect(66, 484, 948, 143), { children: [text] })] }), n('container', FULL, { children: [scrim] })] });
    expect(await judge(withDialog, text)).toMatch(/^button \(0,0 1080x2220\) is drawn over the element \(element 136,532 48x49\)/);
  });

  it('a text inside the row on its own branch is its content; the same text in a bar laid over the screen is chrome', async () => {
    const row = n('container', rect(24, 60, 1000, 200), { identifier: 'row' });
    const own = n('text', rect(300, 100, 200, 40), { label: 'Title' });
    const card = n('container', rect(0, 0, 1080, 400), { children: [row, own] });
    expect(await judge(n('container', FULL, { children: [card] }), row)).toBeUndefined();
    const bar = n('container', rect(0, 66, 1080, 160), { children: [own] });
    expect(await judge(n('container', FULL, { children: [n('container', FULL, { children: [row] }), bar] }), row)).toMatch(/^container \(0,66 1080x160\) is drawn over the element \(element 24,60 1000x200\)/); // the bar, on top at the row's centre
  });
});
