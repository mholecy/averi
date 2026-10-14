import { readFile } from 'node:fs/promises';
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

  it('Account Detail with the bar SHOWN: the tab buttons (1/1 at y 755) are not hidden, and neither is their host (0/0 in both states)', async () => {
    const tree = await capture('account-detail-bar-shown');
    for (const id of ['nav.tab_home', 'nav.tab_transactions', 'nav.tab_cards', 'nav.tab_more']) {
      const [button] = byId(tree, id);
      expect([at(button).split(' ')[0].split(',')[1], button.hidden, [...everyNode(button)].some((n) => n.hidden)]).toEqual(['755', undefined, false]);
    }
  });

  it('the rule, on synthetic elements: the root 0/0 and every node under it isVisible 0 — the subtree goes as one; a visible descendant keeps the whole subtree; an accessible root, or one whose flags are missing, roots none', () => {
    const tree = parseWdaSourceValue(
      app(
        el('Button', { label: 'gone', isVisible: '0', isAccessible: '0', children: [el('Image', { label: 'icon', isVisible: '0', isAccessible: '1', children: [el('Other', { label: 'deep', isVisible: '0', isAccessible: '1' })] })] }),
        el('Other', { label: 'host', isVisible: '0', isAccessible: '0', children: [el('Other', { label: 'content', isVisible: '1', isAccessible: '0' }), el('Button', { label: 'tab', isVisible: '0', isAccessible: '0' })] }),
        el('Cell', { label: 'cell', isVisible: '0', isAccessible: '1', children: [el('StaticText', { label: 'cell text', isVisible: '0', isAccessible: '0' })] }),
        el('Other', { label: 'unflagged', isVisible: undefined, isAccessible: undefined }),
        el('Other', { label: 'numbers', isVisible: 0, isAccessible: 0 }),
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

  it('the rule, on synthetic elements: only content of a `Cell`, only isVisible "0", only wholly outside the cell (no shared area); the nearest Cell decides, through any wrapper', () => {
    const cellAt = { x: 20, y: 1306, width: 362, height: 52 };
    const parked = { x: 0, y: 62, width: 286, height: 22 };
    const tree = parseWdaSourceValue(
      app(
        el('Cell', { label: 'cell', rect: cellAt, isVisible: '0', children: [
          el('StaticText', { label: 'parked', rect: parked, isVisible: '0' }),
          el('Other', { label: 'wrapper', rect: cellAt, isVisible: '0', children: [el('Button', { label: 'deep', rect: parked, isVisible: '0' })] }),
          el('StaticText', { label: 'visible', rect: parked, isVisible: '1' }),
          el('StaticText', { label: 'overlapping', rect: { x: 0, y: 1300, width: 100, height: 20 }, isVisible: '0' }),
          el('StaticText', { label: 'edge only', rect: { x: 0, y: 1286, width: 100, height: 20 }, isVisible: '0' }),
          el('StaticText', { label: 'no area', rect: { x: 0, y: 62, width: 0, height: 22 }, isVisible: '0' }),
        ] }),
        el('Other', { label: 'not a cell', rect: cellAt, isVisible: '0', children: [el('StaticText', { label: 'outside other', rect: parked, isVisible: '0' })] }),
      ),
    );
    const rects = Object.fromEntries(all(tree).filter((n) => n.label !== null && n.role !== 'container' || n.label === 'wrapper').map((n) => [n.label, at(n)]));
    expect(rects).toEqual({
      parked: '20,1306 362x52',
      wrapper: '20,1306 362x52',
      deep: '20,1306 362x52',
      visible: '0,62 286x22',
      overlapping: '0,1300 100x20',
      'edge only': '20,1306 362x52',
      'no area': '0,62 0x22',
      'outside other': '0,62 286x22',
    });
  });
});
