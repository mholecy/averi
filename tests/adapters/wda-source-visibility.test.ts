import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseWdaSource, parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';

// What the WDA parser reads of WDA's own visibility flags, `isVisible` and `isAccessible` (strings "0"/"1"), beyond the
// keyboard: the HIDDEN SUBTREE (`UiNode.hidden`) and the PARKED content of a cell UIKit has not laid out.
// docs/adr/0019-wda-hidden-subtrees-and-parked-cell-content.md
//
// The captures are real /source bytes (tests/fixtures/wda-capture-*.json, each `_comment` says where from).

const capture = async (name: string): Promise<UiNode> => parseWdaSource(await readFile(new URL(`../fixtures/wda-capture-${name}.json`, import.meta.url), 'utf8'));

const all = (tree: UiNode): UiNode[] => [...everyNode(tree)];
const byId = (tree: UiNode, id: string): UiNode[] => all(tree).filter((n) => n.identifier === id);
const byLabel = (tree: UiNode, label: string): UiNode[] => all(tree).filter((n) => n.label === label);
const at = (n: UiNode): string => `${n.rect.x},${n.rect.y} ${n.rect.width}x${n.rect.height}`;

/** A synthetic WDA element with the measured field shape: visible and accessible unless overridden. */
const el = (type: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type,
  rawIdentifier: null,
  label: null,
  value: null,
  rect: { x: 0, y: 0, width: 100, height: 20 },
  isVisible: '1',
  isAccessible: '1',
  children: [],
  ...over,
});
const app = (...children: Record<string, unknown>[]) => el('Application', { rect: { x: 0, y: 0, width: 402, height: 874 }, children });

describe('UiNode.hidden — a WDA node that roots a hidden subtree, and every node under it', () => {
  it('the SWIFT form pushed over the tab host: each of the host\'s four tab buttons (0/0) and its icon Image (isVisible 0, isAccessible 1) are hidden — the Image\'s isAccessible is not consulted', async () => {
    const tree = await capture('swift-form-pushed');
    for (const id of ['nav.tab_home', 'nav.tab_transactions', 'nav.tab_cards', 'nav.tab_more']) {
      const [button] = byId(tree, id);
      expect([id, at(button), button.hidden, button.children.map((c) => [c.role, c.hidden])]).toEqual([id, expect.stringMatching(/,711 /), true, [['image', true]]]);
    }
  });

  it('…and nothing the screen shows is: the form\'s visible rows, the host (0/0, but its content child is isVisible 1), its content', async () => {
    const tree = await capture('swift-form-pushed');
    const [standard] = byLabel(tree, 'Standard');
    expect([at(standard), standard.hidden]).toEqual(['42,704 71x21', undefined]);
    expect(byId(tree, 'swift_payment.form.priority_select')[0].hidden).toBeUndefined();
    // The tab host: the ancestor all four buttons share, a screen-sized `container`, flagged 0/0 by WDA in both states.
    const host = all(tree).find((n) => n.children.some((c) => c.identifier === 'nav.tab_home'))!;
    expect([at(host), host.hidden, host.children[0].hidden]).toEqual(['0,0 402x874', undefined, undefined]);
  });

  it('…nor a row WDA reports 0/0 with an invisible subtree: `payee_name_input`, listed below its form\'s ScrollView (drawn nowhere: the standing\'s drawn frame judges that, not WDA\'s flags), a structural wrapper, roots no hidden subtree — nor are its label and text field (each isAccessible "1")', async () => {
    const tree = await capture('swift-form-pushed');
    const [row] = byId(tree, 'swift_payment.form.payee_name_input');
    expect([at(row), ...[...everyNode(row)].filter((n) => n.rect.width * n.rect.height > 0).map((n) => `${n.role} ${n.hidden === true}`)]).toEqual([
      '24,801 354x52',
      'container false',
      'text false',
      'textfield false',
      'container false',
      'container false',
    ]);
  });

  it('Account Detail with the bar SHOWN: the tab buttons (1/1 at y 755) are not hidden, and neither is their host (0/0 in both states)', async () => {
    const tree = await capture('account-detail-bar-shown');
    for (const id of ['nav.tab_home', 'nav.tab_transactions', 'nav.tab_cards', 'nav.tab_more']) {
      const [button] = byId(tree, id);
      expect([at(button).split(' ')[0].split(',')[1], button.hidden, [...everyNode(button)].some((n) => n.hidden)]).toEqual(['755', undefined, false]);
    }
  });

  it('the rule, on synthetic elements: a root that is no structural wrapper, 0/0, with every node under it isVisible 0 — the subtree goes as one; a visible descendant keeps the whole subtree; an accessible root, one whose flags are missing, or a wrapper (`Other`, `Cell`: a structural role) roots none, though a control inside it may', () => {
    const tree = parseWdaSourceValue(
      app(
        el('Button', { label: 'gone', isVisible: '0', isAccessible: '0', children: [el('Image', { label: 'icon', isVisible: '0', isAccessible: '1', children: [el('Other', { label: 'deep', isVisible: '0', isAccessible: '1' })] })] }),
        el('Other', { label: 'host', isVisible: '0', isAccessible: '0', children: [el('Other', { label: 'content', isVisible: '1', isAccessible: '0' }), el('Button', { label: 'tab', isVisible: '0', isAccessible: '0' })] }),
        el('Cell', { label: 'cell', isVisible: '0', isAccessible: '1', children: [el('StaticText', { label: 'cell text', isVisible: '0', isAccessible: '0' })] }),
        el('Other', { label: 'unflagged', isVisible: undefined, isAccessible: undefined }),
        el('StaticText', { label: 'numbers', isVisible: 0, isAccessible: 0 }),
        el('Other', { label: 'frame', isVisible: '0', isAccessible: '0', children: [el('Button', { label: 'in frame', isVisible: '0', isAccessible: '0' })] }),
        el('Cell', { label: 'hidden cell', isVisible: '0', isAccessible: '0' }),
        el('Button', { label: 'shown inside', isVisible: '0', isAccessible: '0', children: [el('Image', { label: 'visible icon', isVisible: '1', isAccessible: '0' })] }),
        el('Table', { label: 'hidden table', isVisible: '0', isAccessible: '0', children: [el('StaticText', { label: 'table text', isVisible: '0', isAccessible: '1' })] }),
        el('Other', { label: 'invisible only', isVisible: '0', isAccessible: undefined }),
      ),
    );
    const hidden = Object.fromEntries(all(tree).map((n) => [n.label ?? n.role, n.hidden === true]));
    expect(hidden).toEqual({
      container: false,
      gone: true,
      icon: true,
      deep: true,
      host: false,
      content: false,
      tab: true,
      cell: false,
      'cell text': true,
      unflagged: false,
      numbers: true,
      frame: false,
      'in frame': true,
      'hidden cell': false,
      'shown inside': false,
      'visible icon': false,
      'hidden table': true,
      'table text': true,
      'invisible only': false,
    });
  });

  it('idb never sets it: a flat AX list carries no visibility flags (and so it never parks a cell\'s content either)', () => {
    const tree = parseIdbDescribeAll(JSON.stringify([{ type: 'Button', AXLabel: 'Home', AXUniqueId: 'nav.tab_home', frame: { x: 69, y: 711, width: 67, height: 52 } }]));
    expect(all(tree).some((n) => 'hidden' in n)).toBe(false);
  });
});

describe('PARKED cell content — a cell UIKit has not laid out lists its content at a parked frame; the parser places it at the cell', () => {
  it('Contacts New Contact, keyboard up: every cell below the fold lists its label, its Insert button and its separator at `0,62 …`, inside the viewport — each now lies at its cell\'s rect, below the screen', async () => {
    const tree = await capture('contacts-new-contact');
    const cell = byLabel(tree, 'add instant message').find((n) => n.role === 'container')!;
    expect(at(cell)).toBe('20,1306 362x52');
    expect(cell.children.map((c) => `${c.role} ${c.label ?? ''} ${at(c)}`)).toEqual([
      'button Insert 20,1306 362x52',
      'container  20,1306 362x52',
      'text add instant message 20,1306 362x52',
    ]);
    // Not one parked frame is left: no cell's label, Insert button or Notes field sits at the sheet's origin any more
    // (what does — the sheet's `Poster` image, a 0x0 frame — is no cell's).
    const cellContent = (n: UiNode) => /^(add |Insert$|Notes$)/.test(n.label ?? '');
    expect(all(tree).filter((n) => cellContent(n) && n.rect.x === 0 && n.rect.y === 62).map((n) => `${n.role} ${n.label}`)).toEqual([]);
    expect(all(tree).filter(cellContent).length).toBeGreaterThan(30);
  });

  it('…while a cell on screen keeps its content where WDA put it: `add phone`\'s Insert button and label, inside their cell', async () => {
    const tree = await capture('contacts-new-contact');
    const cell = byLabel(tree, 'add phone').find((n) => n.role === 'container')!;
    expect([at(cell), ...cell.children.map((c) => `${c.role} ${at(c)}`)]).toEqual(['20,565 362x52', 'container 20,615 362x2', 'button 39,577 26x26', 'text 80,580 286x22']);
  });

  it('the rule, on synthetic elements: an isVisible "0" element of a `Cell`, lying wholly outside that cell and inside the scroll view the cell lies in, while the cell lies wholly outside that scroll view — the measured shape — is placed at the cell, through any wrapper; anything else stays where WDA put it', () => {
    const table = { x: 0, y: 62, width: 402, height: 812 };
    const cellAt = { x: 20, y: 1306, width: 362, height: 52 };
    const parked = { x: 0, y: 62, width: 286, height: 22 };
    const tree = parseWdaSourceValue(
      app(
        el('Table', { rect: table, isVisible: '1', children: [
          el('Cell', { label: 'cell', rect: cellAt, isVisible: '0', children: [
            el('StaticText', { label: 'parked', rect: parked, isVisible: '0' }),
            el('Other', { label: 'wrapper', rect: cellAt, isVisible: '0', children: [el('Button', { label: 'deep', rect: parked, isVisible: '0' })] }),
            el('StaticText', { label: 'visible', rect: parked, isVisible: '1' }),
            el('StaticText', { label: 'overlapping', rect: { x: 0, y: 1300, width: 100, height: 20 }, isVisible: '0' }),
            el('StaticText', { label: 'outside the table too', rect: { x: 0, y: 900, width: 100, height: 20 }, isVisible: '0' }),
            el('StaticText', { label: 'no area', rect: { x: 0, y: 62, width: 0, height: 22 }, isVisible: '0' }),
          ] }),
          el('Other', { label: 'not a cell', rect: cellAt, isVisible: '0', children: [el('StaticText', { label: 'outside other', rect: parked, isVisible: '0' })] }),
        ] }),
        el('Cell', { label: 'no scroll view', rect: cellAt, isVisible: '0', children: [el('StaticText', { label: 'unscrolled', rect: parked, isVisible: '0' })] }),
        // The scroll view that decides is the one the CELL lies in: a below-the-fold cell with a scroller of its own
        // (a row of chips) parks the chip all the same.
        el('Table', { rect: table, isVisible: '1', children: [
          el('Cell', { label: 'row with chips', rect: cellAt, isVisible: '0', children: [
            el('ScrollView', { rect: cellAt, isVisible: '0', children: [el('Button', { label: 'chip', rect: parked, isVisible: '0' })] }),
          ] }),
        ] }),
      ),
    );
    const rects = Object.fromEntries(all(tree).filter((n) => (n.label !== null && n.role !== 'container') || n.label === 'wrapper').map((n) => [n.label, at(n)]));
    expect(rects).toEqual({
      parked: '20,1306 362x52',
      wrapper: '20,1306 362x52',
      deep: '20,1306 362x52',
      visible: '0,62 286x22',
      overlapping: '0,1300 100x20',
      'outside the table too': '0,900 100x20',
      'no area': '0,62 0x22',
      'outside other': '0,62 286x22',
      unscrolled: '0,62 286x22',
      chip: '20,1306 362x52',
    });
  });

  it('…and never content scrolled out sideways, nor a cell that is on screen: a carousel\'s chip past the right edge of its row, a nested collection view\'s card past its edge, an on-screen cell\'s child overflowing it — each keeps its rect', () => {
    const r = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
    const tree = parseWdaSourceValue(
      app(
        el('Table', { rect: r(0, 0, 402, 874), children: [
          // A row holding a horizontal scroller of chips; chip 3 scrolled off to the right (its nearest scroll view does not hold it).
          el('Cell', { rect: r(0, 300, 402, 120), children: [
            el('ScrollView', { rect: r(0, 300, 402, 120), children: [
              el('Button', { label: 'Chip 1', rect: r(16, 320, 180, 80) }),
              el('Button', { label: 'Chip 2', rect: r(206, 320, 180, 80) }),
              el('Button', { label: 'Chip 3', rect: r(410, 320, 180, 80), isVisible: '0' }),
            ] }),
          ] }),
          // A row holding a collection view, its third card (a cell nested in the row's cell) past the right edge.
          el('Cell', { rect: r(0, 420, 402, 200), children: [
            el('CollectionView', { rect: r(0, 420, 402, 200), children: [
              el('Cell', { label: 'Card A', rect: r(16, 430, 300, 180), children: [el('StaticText', { label: 'Card A text', rect: r(30, 500, 100, 20) })] }),
              el('Cell', { label: 'Card C', rect: r(636, 430, 300, 180), isVisible: '0', children: [el('StaticText', { label: 'Card C text', rect: r(650, 500, 100, 20), isVisible: '0' })] }),
            ] }),
          ] }),
          // A row on screen whose invisible child lies outside it (a badge hung off its edge).
          el('Cell', { label: 'row', rect: r(20, 640, 362, 52), children: [el('StaticText', { label: 'badge', rect: r(20, 700, 40, 20), isVisible: '0' })] }),
        ] }),
      ),
    );
    const rects = Object.fromEntries(all(tree).filter((n) => /Chip|Card|badge/.test(n.label ?? '')).map((n) => [n.label, at(n)]));
    expect(rects).toEqual({
      'Chip 1': '16,320 180x80',
      'Chip 2': '206,320 180x80',
      'Chip 3': '410,320 180x80',
      'Card A': '16,430 300x180',
      'Card A text': '30,500 100x20',
      'Card C': '636,430 300x180',
      'Card C text': '650,500 100x20',
      badge: '20,700 40x20',
    });
  });
});

// docs/bugs/2026-10-18-lab-ios-wda-scrolled-tables-parked-row-text-reads-above-the-screen.md: once a UIKit table has
// scrolled, WDA parks a below-the-fold row's content at the table's CONTENT ORIGIN — its top-left moved up by the
// offset (62 − offset) — which lies above the screen, outside the table.
describe('PARKED cell content of a SCROLLED table — the parked frame lies above the scroll view, at its left edge', () => {
  /** Every text of a row (`Row N`, `Target X`) with its cell's rect: the parsed cell is its text's nearest container ancestor holding it. */
  const rowTexts = (tree: UiNode): string[] => {
    const out: string[] = [];
    const walk = (n: UiNode, cell: UiNode | undefined): void => {
      if (n.role === 'text' && /^(Row \d+|Target \w)$/.test(n.label ?? '')) out.push(`${n.label} ${at(n)} cell ${cell === undefined ? '-' : at(cell)}`);
      n.children.forEach((c) => walk(c, n.role === 'container' && n.children.some((k) => k.role === 'text') ? n : cell));
    };
    walk(tree, undefined);
    return out;
  };

  it('the lab\'s sheet-long-list after 273 pt: Row 30\'s text lies at its cell, 0,1708 below the screen — not at the parked 0,-212 above it — and so does every row\'s, above the fold and below it', async () => {
    const tree = await capture('lab-sheet-long-list-scrolled-273');
    const rows = rowTexts(tree);
    expect(rows.find((r) => r.startsWith('Row 30 '))).toBe('Row 30 0,1708 402x65 cell 0,1708 402x65');
    expect(rows.find((r) => r.startsWith('Target F '))).toBe('Target F 0,1068 402x65 cell 0,1068 402x65');
    // Scrolled past the top too: Row 2's cell lies at 0,-84, its text parked at 0,-212 (Row 0's own place). The one
    // left parked is Target R, whose cell at 0,-148 meets the parked frame by a point (65-pt rects 64 apart: the
    // residual of a parked element that meets its cell) — above the screen either way.
    expect(rows.find((r) => r.startsWith('Row 2 '))).toBe('Row 2 0,-84 402x65 cell 0,-84 402x65');
    expect(rows.length).toBe(40);
    expect(rows.filter((r) => { const [own, cell] = r.replace(/^\S+ \S+ /, '').split(' cell '); return own !== cell; })).toEqual(['Target R 0,-212 402x65 cell 0,-148 402x65']);
  });

  it('…after 522 pt: Row 30 at its cell 0,1460; Target F, laid out on screen at 0,820, stays where WDA put it; no text is left at the parked 0,-460 but Row 0, whose cell lies there', async () => {
    const tree = await capture('lab-sheet-long-list-scrolled-522');
    const rows = rowTexts(tree);
    expect(rows.find((r) => r.startsWith('Row 30 '))).toBe('Row 30 0,1460 402x64 cell 0,1460 402x64');
    expect(rows.find((r) => r.startsWith('Target F '))).toBe('Target F 0,820 402x64 cell 0,820 402x64');
    expect(rows.filter((r) => r.includes(' 0,-460 402x64 cell'))).toEqual(['Row 0 0,-460 402x64 cell 0,-460 402x64']);
  });

  it('the rule, on synthetic elements: above the scroll view it is parked only at its left edge, in a cell wholly outside that scroll view; an element above it elsewhere, or of a cell on screen, stays where WDA put it', () => {
    const r = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
    const cellAt = r(0, 1708, 402, 65);
    const tree = parseWdaSourceValue(
      app(
        el('Table', { rect: r(0, 62, 402, 812), children: [
          el('Cell', { rect: cellAt, isVisible: '0', children: [
            el('StaticText', { label: 'at the left edge, above', rect: r(0, -212, 402, 65), isVisible: '0' }),
            el('StaticText', { label: 'its bottom on the top edge', rect: r(0, -3, 402, 65), isVisible: '0' }),
            el('StaticText', { label: 'above, off the left edge', rect: r(16, -212, 300, 65), isVisible: '0' }),
            el('StaticText', { label: 'visible, above', rect: r(0, -212, 402, 65), isVisible: '1' }),
          ] }),
          el('Cell', { rect: r(0, 300, 402, 65), children: [el('StaticText', { label: 'of a cell on screen', rect: r(0, -212, 402, 65), isVisible: '0' })] }),
        ] }),
      ),
    );
    const rects = Object.fromEntries(all(tree).filter((n) => n.role === 'text').map((n) => [n.label, at(n)]));
    expect(rects).toEqual({
      'at the left edge, above': '0,1708 402x65',
      'its bottom on the top edge': '0,1708 402x65',
      'above, off the left edge': '16,-212 300x65',
      'visible, above': '0,-212 402x65',
      'of a cell on screen': '0,-212 402x65',
    });
  });

  it('the sweep: over every raw /source payload in tests/fixtures (wda-*.json), the parser moves exactly the parked elements — the Contacts sheet\'s and the long list\'s at rest, the long list\'s scrolled — and nothing else; of the payloads moving nothing only the lab\'s form-picker holds cells (15, all on screen), so the rest guard only that no content outside a cell moves (the scroll-view shape and the above-the-view clause are pinned by the synthetic trees above)', async () => {
    const dir = new URL('../fixtures/', import.meta.url);
    const counts: Record<string, number> = {};
    for (const file of (await readdir(dir)).filter((f) => /^wda-.*\.json$/.test(f)).sort()) {
      const raw = JSON.parse(await readFile(new URL(file, dir), 'utf8')) as RawEl & { value?: unknown };
      const root = (typeof raw.type === 'string' ? raw : raw.value) as RawEl | undefined;
      if (typeof root?.type !== 'string') continue; // a ui_snapshot capture, not a /source payload
      let count = 0;
      const zip = (e: RawEl, n: UiNode): void => {
        if (e.rect !== undefined && at(n) !== `${e.rect.x},${e.rect.y} ${e.rect.width}x${e.rect.height}`) count++;
        (e.children ?? []).forEach((c, i) => { if (n.children[i] !== undefined) zip(c, n.children[i]); });
      };
      zip(root, parseWdaSourceValue(raw));
      counts[file.replace(/\.json$/, '')] = count;
    }
    const moved = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
    expect(moved).toEqual({
      'wda-capture-contacts-discard-popover': 41,
      'wda-capture-contacts-new-contact': 41,
      'wda-capture-lab-sheet-long-list': 81,
      'wda-capture-lab-sheet-long-list-scrolled-273': 72,
      'wda-capture-lab-sheet-long-list-scrolled-522': 75,
    });
    // Swept, moving nothing: the lab's form-picker (cells on screen), carousel and bounded scroll views and
    // form-keyboard, Account Detail, the SWIFT form, the MyPort and skeleton logins, the filter sheet, the synthetic alert.
    expect(Object.keys(counts).length).toBe(20);
    expect(counts['wda-capture-lab-form-picker']).toBe(0);
  });
});

interface RawEl {
  type?: unknown;
  rect?: { x: number; y: number; width: number; height: number };
  children?: RawEl[] | null;
}
