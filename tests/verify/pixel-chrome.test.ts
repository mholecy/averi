import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { everyNode, type DeviceScreen, type Rect, type UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { nodeText } from '../../src/ui-tree/geometry.js';
import { chromeOverElement } from '../../src/verify/pixel-poll.js';
import { colorSampleRect } from '../../src/verify/color-parity.js';

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
async function sweep(androidBand?: number, reads: (r: Rect) => Rect = (r) => r): Promise<{ judged: number; misses: string[] }> {
  const misses: string[] = [];
  let judged = 0;
  for (const [name, tree, screen] of await fixtureTrees(androidBand)) {
    const adapter = { viewport: async () => screen };
    for (const n of everyNode(tree)) {
      if (n === tree || n.ofKeyboard === true || !(n.rect.width * n.rect.height > 0)) continue;
      judged++;
      const over = await chromeOverElement(adapter, tree, n, reads(n.rect));
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
const OCR = (r: Rect): Rect => r; // the ocr assert reads the whole rect

describe('chromeOverElement over every fixture node (round 8)', () => {
  it('the ocr reader (the whole rect): the covers named are chrome only — nothing that takes a touch and hides no pixel', async () => {
    const { judged, misses } = await sweep(undefined, OCR);
    expect(judged).toBe(1820);
    expect(coversNamed(misses)).toEqual({
      'button "Continue to summary" (24,512 354x44, reaching 24,512 354x77)': 1,
      'button "Continue to summary" (24,780 354x44, reaching 24,780 354x94)': 20,
      'button (948,99 110x110)': 2, // Compose's top-bar button over the screen-sized root
      'container "!, Open debugger to view warnings." (10,787 382x49)': 4,
      'container (154,88 407x132)': 2,
      'container (66,1840 948x248)': 6,
      'container id:nav.tab_cards (540,1876 219x176)': 1,
      'container id:nav.tab_more (759,1876 219x176)': 2,
      'other "More" (830,1926 77x77)': 9,
      'text "Create contact" (154,115 407x77)': 2,
      'text "Phone (Mobile)" (176,1871 233x44)': 1,
      'text "Phone (Mobile)" (176,725 233x44)': 1,
    });
    // Every iOS window and screen-sized root reaches into the band: an ocr crop of it would read the clock.
    expect(misses.filter((m) => m.includes('the status bar is drawn over'))).toHaveLength(190);
  });

  it('the colour reader (the rect inset 12 % a side): the same chrome, and a screen-sized root under the content listed over it', async () => {
    const { misses } = await sweep(undefined, colorSampleRect);
    expect(coversNamed(misses)).toEqual({
      'button "Continue to summary" (24,512 354x44, reaching 24,512 354x77)': 1,
      'button "Continue to summary" (24,780 354x44, reaching 24,780 354x94)': 19,
      // idb's Application node, judged as an element: every node of the flat list after it lies over its sample.
      'button "Loan repayment, 17.07.2026, +602,00 EUR" (24,435 354x52)': 1,
      'button "Priority*, Standard" (24,390 354x52)': 1,
      'button "Priority*, Standard" (24,399 354x52)': 1,
      'button "Priority*, Standard" (24,406 354x52)': 1,
      'button "Priority*, Standard" (24,414 354x52)': 1,
      'text "Payee’s bank street & no.*" (42,759 192x20)': 1,
      'text "Payee’s city" (42,724 87x20)': 1,
      'text "The IBAN belongs to a country outside the SEPA area" (24,640 354x40)': 1,
      'textfield id:TextFieldWithComponentStyle (42,425 318x20)': 2,
      'container (154,88 407x132)': 2,
      'container (66,1840 948x248)': 8,
      'container id:nav.tab_cards (540,1876 219x176)': 1,
      'other "More" (830,1926 77x77)': 9,
      'text "Create contact" (154,115 407x77)': 2,
    });
    expect(misses.filter((m) => m.includes('the status bar is drawn over'))).toHaveLength(24);
  });

  it('the reviewer\'s false covers stay gone for both readers: own content beside the element, a clickable layer, a 2-pt edge', async () => {
    for (const reads of [OCR, colorSampleRect]) {
      const { misses } = await sweep(undefined, reads);
      const over = (element: string) => misses.filter((m) => m.includes(`: ${element} — `));
      // WDA React Native: the field's own input box and label, the switcher's own flag and button.
      expect(misses.filter((m) => /login_username_field|login_password_field|language_switcher|twofactor_code_field/.test(m))).toEqual([]);
      // idb: the account card and its own "Accounting Balance" text.
      expect(misses.filter((m) => m.startsWith('idb-modal chooser: button "My Account'))).toEqual([]);
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
    }
  });

  it('with a 66-px Android status band (fix/r8-band): an ocr crop of a root reads the bar and fails; a colour sample of one starts 12 % down and only the two top bars laid under the bar fail', async () => {
    const androidBand = (misses: readonly string[]) => misses.filter((m) => m.startsWith('android') && m.includes('the status bar is drawn over')).map((m) => m.slice(0, m.indexOf(' — ')));
    const ocr = androidBand((await sweep(66, OCR)).misses);
    expect(ocr).toHaveLength(61);
    expect(ocr).toContain('android contactsSyncPromo: other "Close sheet" (0,0 1080x1087)');
    expect(ocr.filter((m) => m.endsWith('container id:content (0,0 1080x2220)'))).toHaveLength(7);
    expect(androidBand((await sweep(66, colorSampleRect)).misses)).toEqual(['android contactsCreateStaged: container (0,0 1080x242)', 'android contactsCreate: container (0,0 1080x242)']);
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


/**
 * Review of fix/r8-pixel, round 2: three loosenings of round 1 reopened the note's false PASS. Each probe is a shape
 * that must fail closed — a sheet or a FAB is chrome even where it lies inside the element's rect, and a screen-sized
 * element is judged over what its reader reads.
 */
describe('the round-2 probes: chrome inside the element\'s rect still counts', () => {
  const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const n = (role: string, r: Rect, extra: Partial<UiNode> = {}): UiNode => ({ role, label: null, identifier: null, value: null, rect: r, children: [], ...extra });
  const idb = (rows: [string, string | null, string | null, number, number, number, number][]) =>
    parseIdbDescribeAll(JSON.stringify(rows.map(([type, label, id, x, y, width, height]) => ({ type, AXLabel: label, AXUniqueId: id, AXValue: null, frame: { x, y, width, height } }))));
  const byId = (tree: UiNode, id: string) => [...everyNode(tree)].find((x) => x.identifier === id)!;
  const ANDROID_66: DeviceScreen = { ...PIXEL_3A, statusBand: 66 };
  const judge = (screen: DeviceScreen, tree: UiNode, element: UiNode, reads?: (r: Rect) => Rect) =>
    chromeOverElement({ viewport: async () => screen }, tree, element, reads?.(element.rect));

  it('A — idb: a sheet listed after a card, lying inside its rect, is no content of the card (it says nothing the card says)', async () => {
    const tree = idb([
      ['Application', 'app', null, 0, 0, 402, 874],
      ['Other', 'Accounts', 'card', 0, 100, 402, 600],
      ['Button', 'Row 1', null, 24, 120, 354, 52],
      ['Other', 'Sheet', 'sheet', 0, 300, 402, 380],
      ['Button', 'Confirm', null, 24, 600, 354, 44],
    ]);
    expect(await judge(IPHONE, tree, byId(tree, 'card'), colorSampleRect)).toMatch(/^container "Sheet" \(0,300 402x380\) is drawn over the element \(element 0,100 402x600\)/);
  });

  it('idb: an unlabelled button over the whole card — a scrim — is no clickable layer of it (a flat list has no branches to say whose layer it is)', async () => {
    const tree = idb([
      ['Application', 'app', null, 0, 0, 402, 874],
      ['Other', 'Accounts', 'card', 24, 100, 354, 300],
      ['Button', null, null, 0, 0, 402, 874],
    ]);
    expect(await judge(IPHONE, tree, byId(tree, 'card'), colorSampleRect)).toMatch(/^button \(0,0 402x874\) is drawn over the element \(element 24,100 354x300\)/);
  });

  it('B2 — Compose: a FAB in the 90 % content container, its reach inside a row of the list, is chrome over the row', async () => {
    const row = n('container', rect(0, 1690, 1080, 200), { identifier: 'row' });
    const fab = n('button', rect(830, 1700, 180, 180), { label: 'New payment' });
    const tree = n('container', rect(0, 0, 1080, 2220), { children: [n('container', rect(0, 225, 1080, 1995), { children: [n('container', rect(0, 401, 1080, 1819), { identifier: 'list', children: [row] }), fab] })] });
    expect(await judge(PIXEL_3A, tree, row, colorSampleRect)).toMatch(/^button "New payment" \(830,1700 180x180\) is drawn over the element \(element 0,1690 1080x200\)/);
  });

  it('C — a screen-sized root under a near-fullscreen dialog fails a colour assert (its scrim, on top at the centre, named)', async () => {
    const root = n('container', rect(0, 0, 1080, 2220), { identifier: 'root', children: [n('text', rect(66, 300, 900, 100), { label: 'Content' })] });
    const dialog = n('container', rect(0, 0, 1080, 2220), {
      children: [n('button', rect(0, 0, 1080, 2220)), n('container', rect(90, 200, 900, 1800), { label: 'Dialog', children: [n('button', rect(100, 1800, 880, 120), { label: 'OK' })] })],
    });
    const tree = n('container', rect(0, 0, 1080, 2220), { children: [root, dialog] });
    expect(await judge(ANDROID_66, tree, root, colorSampleRect)).toMatch(/is drawn over the element \(element 0,0 1080x2220\)/);
  });

  it('C2 — a 90 % element under a sheet covering 80 % of it fails; C3 — an iOS window-sized element under an 89 % sheet fails', async () => {
    const big = n('container', rect(0, 0, 1080, 2000), { identifier: 'big' });
    const c2 = n('container', rect(0, 0, 1080, 2220), { children: [big, n('container', rect(0, 0, 1080, 2220), { children: [n('container', rect(0, 400, 1080, 1820), { label: 'Sheet' })] })] });
    expect(await judge(ANDROID_66, c2, big, colorSampleRect)).toMatch(/^container "Sheet" \(0,400 1080x1820\) is drawn over the element/);
    const win = n('container', rect(0, 0, 402, 874), { identifier: 'screen' });
    const c3 = n('application', rect(0, 0, 402, 874), { children: [win, n('other', rect(0, 100, 402, 774), { label: 'Sheet' })] });
    expect(await judge(IPHONE, c3, win, colorSampleRect)).toMatch(/^other "Sheet" \(0,100 402x774\) is drawn over the element/);
  });

  it('a screen-sized root with nothing over it: the ocr reader (the whole rect) meets the band, the colour reader (12 % down) does not', async () => {
    const root = n('container', rect(0, 0, 402, 874), { identifier: 'root' });
    const tree = n('application', rect(0, 0, 402, 874), { children: [root] });
    expect(await judge(IPHONE, tree, root)).toMatch(/^the status bar is drawn over the element \(element 0,0 402x874, status bar 0,0 402x62\)/);
    expect(await judge(IPHONE, tree, root, colorSampleRect)).toBeUndefined();
  });

  it('judged over what the reader reads: a bar 14 units into the bottom of a 100-unit row is over the ocr crop, and only 2 units into the colour sample — clear', async () => {
    const row = n('container', rect(0, 600, 1080, 100), { identifier: 'row' });
    const bar = n('container', rect(0, 686, 1080, 200), { label: 'Bar' });
    const tree = n('container', rect(0, 0, 1080, 2220), { children: [n('container', rect(0, 0, 1080, 2220), { children: [row] }), bar] });
    expect(await judge(PIXEL_3A, tree, row)).toMatch(/^container "Bar" \(0,686 1080x200\) is drawn over the element/);
    expect(await judge(PIXEL_3A, tree, row, colorSampleRect)).toBeUndefined();
  });

  it('neither the screen itself (screen-sized) nor a full-bleed header (laid from the top edge at full width) is cured by a scroll: each remedy leads with something in it, the header\'s naming its title; idb\'s root says the cover is content on its background', async () => {
    const NEVER = 'the capture would show it, not the element — assert something in it that lies clear of that; no scroll moves the screen itself out from under it';
    const HEADER = 'the capture would show it, not the element — assert something in it that lies clear of that (its title, say); no scroll moves an element laid from the screen\'s top edge out from under it';
    const win = n('container', rect(0, 0, 402, 874), { identifier: 'screen' });
    expect(await judge(IPHONE, n('application', rect(0, 0, 402, 874), { children: [win] }), win)).toBe(
      `the status bar is drawn over the element (element 0,0 402x874, status bar 0,0 402x62) — ${NEVER}`,
    );
    const header = n('container', rect(0, 0, 402, 116), { identifier: 'header' });
    const scrolled = n('application', rect(0, 0, 402, 874), { children: [n('scrollable', rect(0, 0, 402, 874), { children: [header] })] });
    expect(await judge(IPHONE, scrolled, header, colorSampleRect)).toBe(`the status bar is drawn over the element (element 0,0 402x116, status bar 0,0 402x62) — ${HEADER}`);
    // Screen-sized below the bar (Android's content view, 97 % of the screen) under a dialog: the screen too.
    // (The dialog's panel covers through its content, its button here — the tap's `contentFramed` row; a childless, non-interactive sibling laid on the element is read as on it — both stated residuals.)
    const content = n('container', rect(0, 66, 1080, 2154), { identifier: 'content', children: [n('text', rect(66, 300, 900, 100), { label: 'Body' })] });
    const dialog = n('container', rect(90, 400, 900, 1200), { label: 'Dialog', children: [n('button', rect(100, 1450, 880, 120), { label: 'OK' })] });
    const withDialog = n('container', rect(0, 0, 1080, 2220), { children: [content, dialog] });
    expect(await judge(PIXEL_3A, withDialog, content, colorSampleRect)).toBe(`button "OK" (100,1450 880x120) is drawn over the element (element 0,66 1080x2154) — ${NEVER}`);
    // …a row in the same scroll view is scrolled clear as before.
    const row = n('container', rect(24, 30, 354, 52), { identifier: 'row' });
    const rowTree = n('application', rect(0, 0, 402, 874), { children: [n('scrollable', rect(0, 0, 402, 874), { children: [row] })] });
    expect(await judge(IPHONE, rowTree, row, colorSampleRect)).toBe(
      'the status bar is drawn over the element (element 24,30 354x52, status bar 0,0 402x62) — the capture would show it, not the element; scroll_until the element with `fully: true` first and re-run',
    );
    const tree = idb([
      ['Application', 'app', null, 0, 0, 402, 874],
      ['Button', 'Pay', null, 24, 400, 354, 52],
    ]);
    const app = [...everyNode(tree)].find((x) => x.label === 'app')!;
    expect(await judge(IPHONE, tree, app, colorSampleRect)).toBe(
      'button "Pay" (24,400 354x52) is drawn over the element (element 0,0 402x874) — that is content drawn over the root\'s background, which the capture would show, not the root; no scroll moves it — assert something in it that lies clear of that',
    );
  });
});

/**
 * Code review of round 8, S3: the screen a pixel assert judges in is ui-tree/standing.ts#usableScreen's — the gesture
 * box's derivation. With the device silent, a window the tree vouches for is the screen, not the tree's largest node.
 */
describe('the screen without the device: the window the tree vouches for (ui-tree/standing.ts#usableScreenOf)', () => {
  const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const n = (role: string, r: Rect, extra: Partial<UiNode> = {}): UiNode => ({ role, label: null, identifier: null, value: null, rect: r, children: [], ...extra });
  const silent = { viewport: async (): Promise<DeviceScreen> => Promise.reject(new Error('idb describe: no screen_dimensions')) };

  it('a rectless root whose largest node is a 402x1300 scroll content: the 402x874 window is the screen, so a window-sized element is the screen itself', async () => {
    const element = n('container', rect(0, 40, 402, 834), { identifier: 'page' });
    const pay = n('button', rect(24, 600, 354, 52), { label: 'Pay' });
    const window = n('application', rect(0, 0, 402, 874), { children: [n('scrollable', rect(0, 0, 402, 1300)), element, pay] });
    const tree = n('container', rect(0, 0, 0, 0), { children: [window] });
    // Until S3 the tree's screen (screenOf: the 402x1300 content) — the page was no screen-sized element and was offered a scroll.
    expect(await chromeOverElement(silent, tree, element)).toMatch(
      /^button "Pay" \(24,600 354x52\) is drawn over the element \(element 0,40 402x834\) — the capture would show it, not the element — assert something in it that lies clear of that; no scroll moves the screen itself/,
    );
  });

  it('a tree that vouches for no window (no screen-shaped child: a walked height) still judges on its own screen, with no band', async () => {
    const element = n('container', rect(0, 0, 402, 200), { identifier: 'row' });
    const tree = n('container', rect(0, 0, 0, 0), { children: [n('other', rect(0, 0, 402, 1300), { children: [element] }), n('other', rect(0, 150, 402, 100), { label: 'Bar' })] });
    expect(await chromeOverElement(silent, tree, element)).toMatch(/^other "Bar" \(0,150 402x100\) is drawn over the element \(element 0,0 402x200\)/);
  });

  it('a banner crowned as the window turns the screen the pixel assert judges its single box over (`oriented`, D6), not the judged panel as built: a landscape box, no band — measured', async () => {
    const banner = n('image', rect(0, 0, 500, 300), { identifier: 'banner' });
    const tree = n('container', rect(0, 0, 0, 0), { children: [banner, n('button', rect(425, 400, 50, 40), { identifier: 'next' })] });
    expect(await chromeOverElement({ viewport: async () => IPHONE }, tree, banner)).toBeUndefined();
  });
});


/**
 * The owner's decision (code review of round 8, P2): Android's status band reaches the pixel asserts. An
 * edge-to-edge app bar (Android 15+) laid from the screen's top under the 66-px band fails a colour assert closed —
 * kept — and the advice leads with what to assert instead: its title, which lies clear of the band and is judged on
 * its own.
 */
describe('a full-bleed Android app bar under the 66-px band (round 8, P2)', () => {
  const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const n = (role: string, r: Rect, extra: Partial<UiNode> = {}): UiNode => ({ role, label: null, identifier: null, value: null, rect: r, children: [], ...extra });
  const adapter = { viewport: async (): Promise<DeviceScreen> => ({ ...PIXEL_3A, statusBand: 66 }) };
  const title = n('text', rect(48, 120, 400, 70), { label: 'Contacts' });
  const bar = n('container', rect(0, 0, 1080, 220), { identifier: 'app_bar', children: [title] });
  const list = n('container', rect(0, 220, 1080, 2000), { identifier: 'list', clipsDescendants: true, children: [n('text', rect(48, 260, 600, 60), { label: 'All contacts' })] });
  const tree = n('container', rect(0, 0, 1080, 2220), { children: [n('container', rect(0, 0, 1080, 2220), { children: [bar, list] })] });

  it('a colour assert on the bar (0,0 1080x220) fails closed on the band, its advice leading with something in it clear of the band', async () => {
    expect(await chromeOverElement(adapter, tree, bar, colorSampleRect(bar.rect))).toBe(
      'the status bar is drawn over the element (element 0,0 1080x220, status bar 0,0 1080x66) — the capture would show it, not the element — ' +
        'assert something in it that lies clear of that (its title, say); no scroll moves an element laid from the screen\'s top edge out from under it',
    );
    expect(await chromeOverElement(adapter, tree, bar)).toMatch(/^the status bar is drawn over the element \(element 0,0 1080x220, status bar 0,0 1080x66\) — the capture would show it, not the element — assert something in it/);
  });

  it('its title, inside the bar and clear of the band, is judged correctly — nothing over it, for colour and ocr alike', async () => {
    expect(await chromeOverElement(adapter, tree, title, colorSampleRect(title.rect))).toBeUndefined();
    expect(await chromeOverElement(adapter, tree, title)).toBeUndefined();
  });

  it('a title laid into the band is named under it, and offered the child too (the bar is in no scroll view)', async () => {
    const high = n('text', rect(48, 30, 400, 70), { label: 'Contacts' });
    const highTree = n('container', rect(0, 0, 1080, 2220), { children: [n('container', rect(0, 0, 1080, 220), { children: [high] })] });
    expect(await chromeOverElement(adapter, highTree, high)).toMatch(/^the status bar is drawn over the element \(element 48,30 400x70, status bar 0,0 1080x66\) — .* — or, if no scroll moves it out from under that, assert something in it that lies clear of that$/);
  });

  it('in idb\'s flat list a full-bleed header is a header, not the root: the cover over it is not called content on the root\'s background', async () => {
    const tree = parseIdbDescribeAll(JSON.stringify([
      ['Application', 'app', null, 0, 0, 402, 874],
      ['Other', 'Header', 'header', 0, 0, 402, 200],
      ['Button', 'Close', null, 300, 120, 80, 44],
    ].map(([type, label, id, x, y, width, height]) => ({ type, AXLabel: label, AXUniqueId: id, AXValue: null, frame: { x, y, width, height } }))));
    const header = [...everyNode(tree)].find((x) => x.identifier === 'header')!;
    // No band here (an app that hides the status bar): the cover alone is judged.
    expect(await chromeOverElement({ viewport: async () => ({ width: 402, height: 874 }) }, tree, header, colorSampleRect(header.rect))).toBe(
      'button "Close" (300,120 80x44) is drawn over the element (element 0,0 402x200) — the capture would show it, not the element — ' +
        'assert something in it that lies clear of that (its title, say); no scroll moves an element laid from the screen\'s top edge out from under it',
    );
  });
});
