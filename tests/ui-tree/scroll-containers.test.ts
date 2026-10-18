import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { parseWdaSource, parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { clips, scrollAxis, scrolls } from '../../src/ui-tree/scroll-containers.js';
import { clipsOf } from '../../src/ui-tree/geometry.js';
import { COMPOSE, parseDump } from '../helpers/android-dumps.js';
import { node } from '../helpers/fake.js';
import { CLASSIC_VIEWS, SETTINGS_ROW_SLIVER } from '../helpers/synthetic-android-trees.js';

const FIXTURES = new URL('../fixtures/', import.meta.url);
const text = (file: string) => readFile(new URL(file, FIXTURES), 'utf8');

/** The one node a uiautomator dump of `inner` (under a screen-sized frame) makes of it. */
const parsedAndroid = (inner: string): UiNode => {
  const root = parseDump(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">${inner}</node></hierarchy>`);
  return root.children[0];
};

/** The node WDA's /source makes of an element of `type`. */
const parsedWda = (type: string): UiNode => parseWdaSourceValue({ type, rect: { x: 0, y: 100, width: 402, height: 700 }, children: [] });

describe('clips and scrolls — the two scroll-container facts, by node shape', () => {
  const ROWS: [string, UiNode, { clips: boolean; scrolls: boolean }][] = [
    ['iOS ScrollView (frames unclipped: never the flag)', parsedWda('ScrollView'), { clips: false, scrolls: true }],
    ['iOS Table', parsedWda('Table'), { clips: false, scrolls: true }],
    ['iOS CollectionView', parsedWda('CollectionView'), { clips: false, scrolls: true }],
    ['iOS WebView', parsedWda('WebView'), { clips: false, scrolls: true }],
    ['Android RecyclerView, scrollable="true"', parsedAndroid('<node class="androidx.recyclerview.widget.RecyclerView" scrollable="true" bounds="[0,200][1080,2000]" />'), { clips: true, scrolls: true }],
    ['Android RecyclerView, scrollable="false" (content fits)', parsedAndroid('<node class="androidx.recyclerview.widget.RecyclerView" scrollable="false" bounds="[0,200][1080,2000]" />'), { clips: false, scrolls: true }],
    ['Compose scroller (a View, the flag alone)', parsedAndroid('<node class="android.view.View" scrollable="true" bounds="[0,200][1080,2000]"><node class="android.widget.TextView" text="Row" bounds="[0,200][1080,300]" /></node>'), { clips: true, scrolls: true }],
    ['Android WebView, no flag', parsedAndroid('<node class="android.webkit.WebView" scrollable="false" bounds="[0,200][1080,2000]" />'), { clips: false, scrolls: true }],
    ['a text field carrying the flag (a Compose text input dumped as a ScrollView)', node({ role: 'textfield', clipsDescendants: true }), { clips: true, scrolls: true }],
    [
      'a Compose text input dumped as a ScrollView (focusable, long-clickable, scrollable="true"), as the parser reads it',
      parsedAndroid('<node class="android.widget.ScrollView" focusable="true" long-clickable="true" scrollable="true" text="user" bounds="[40,260][1040,400]" />'),
      { clips: true, scrolls: true },
    ],
    ['a plain container', node({ role: 'container' }), { clips: false, scrolls: false }],
  ];

  it.each(ROWS)('%s', (_, n, expected) => {
    expect({ clips: clips(n), scrolls: scrolls(n) }).toEqual(expected);
  });

  it('the shapes are what the parsers make of them: roles and flag as the table assumes', () => {
    const roles = ROWS.map(([, n]) => [n.role, n.clipsDescendants === true]);
    expect(roles.slice(0, 8)).toEqual([
      ['scrollable', false],
      ['scrollable', false],
      ['scrollable', false],
      ['webview', false],
      ['scrollable', true],
      ['scrollable', false],
      ['container', true],
      ['webview', false],
    ]);
    expect([ROWS[9][1].role, ROWS[9][1].clipsDescendants]).toEqual(['textfield', true]);
  });
});

/** Every real or synthetic tree the suite holds. */
async function everyFixtureTree(): Promise<[string, UiNode][]> {
  const trees: [string, UiNode][] = [];
  for (const file of (await readdir(FIXTURES)).filter((f) => f.startsWith('wda-source')).sort()) trees.push([file, parseWdaSource(await text(file))]);
  trees.push(['idb-swift-form-continue', parseIdbDescribeAll(await text('idb-swift-form-continue.json'))]);
  trees.push(['idb-swift-form-number-pad', parseIdbDescribeAll(JSON.stringify(JSON.parse(await text('idb-swift-form-number-pad.json')).elements))]);
  for (const [k, v] of Object.entries(JSON.parse(await text('idb-modal-listed-before-content.json')).screens)) trees.push([`idb-modal ${k}`, parseIdbDescribeAll(JSON.stringify(v))]);
  for (const [k, v] of Object.entries(JSON.parse(await text('idb-swift-form-scrolled-under-top-bar.json')).positions)) trees.push([`idb-top-bar ${k}`, parseIdbDescribeAll(JSON.stringify(v))]);
  for (const [k, v] of Object.entries(JSON.parse(await text('android-ui-snapshot-compose.json')).screens)) trees.push([`android ${k}`, v as UiNode]);
  for (const [k, xml] of Object.entries({ ...COMPOSE, ...CLASSIC_VIEWS, SETTINGS_ROW_SLIVER })) trees.push([`uiautomator ${k}`, parseDump(xml)]);
  return trees;
}

describe('clips ⇒ scrolls over every node of every fixture', () => {
  it('no node clips without scrolling, and the sweep met both kinds', async () => {
    const trees = await everyFixtureTree();
    const nodes = trees.flatMap(([name, tree]) => [...everyNode(tree)].map((n) => [name, n] as const));
    expect(nodes.filter(([, n]) => clips(n) && !scrolls(n)).map(([name, n]) => `${name}: ${n.role} ${JSON.stringify(n.rect)}`)).toEqual([]);
    // Not vacuous: the sweep holds nodes that clip, and nodes that scroll without clipping (iOS).
    expect(nodes.some(([, n]) => clips(n))).toBe(true);
    expect(nodes.some(([, n]) => scrolls(n) && !clips(n))).toBe(true);
  });
});

describe('scrollAxis — the one axis a scroll view scrolls on, as each source can tell it', () => {
  it('by its type where the source names it: Android\'s class (a Compose verticalScroll is a ScrollView, horizontalScroll a HorizontalScrollView), WDA\'s Table', () => {
    const axis = (n: UiNode) => scrollAxis(n, false);
    expect(axis(parsedAndroid('<node class="android.widget.ScrollView" scrollable="true" bounds="[0,200][1080,2000]" />'))).toBe('vertical');
    expect(axis(parsedAndroid('<node class="android.widget.HorizontalScrollView" scrollable="true" bounds="[0,700][1080,900]" />'))).toBe('horizontal');
    expect(axis(parsedAndroid('<node class="android.widget.ListView" scrollable="true" bounds="[0,200][1080,2000]" />'))).toBe('vertical');
    expect(axis(parsedAndroid('<node class="androidx.viewpager.widget.ViewPager" scrollable="true" bounds="[0,200][1080,2000]" />'))).toBe('horizontal');
    expect(scrollAxis(parsedWda('Table'), true)).toBe('vertical');
  });

  it('unknown where the tree cannot tell: a lazy list (a View with the flag), a RecyclerView, a text input dumped as a scroll view, idb, a node that does not scroll', () => {
    expect(scrollAxis(parsedAndroid('<node class="android.view.View" scrollable="true" bounds="[0,200][1080,2000]"><node class="android.widget.TextView" text="Row" bounds="[0,200][1080,300]" /></node>'), false)).toBeUndefined();
    expect(scrollAxis(parsedAndroid('<node class="androidx.recyclerview.widget.RecyclerView" scrollable="true" bounds="[0,200][1080,2000]" />'), false)).toBeUndefined();
    const input = parsedAndroid('<node class="android.widget.HorizontalScrollView" focusable="true" long-clickable="true" scrollable="true" text="user" bounds="[40,260][1040,400]" />');
    expect([input.role, input.scrollAxis, scrollAxis(input, false)]).toEqual(['textfield', undefined, undefined]);
    expect(scrollAxis(node({ role: 'container', scrollAxis: 'vertical' }), false)).toBeUndefined();
  });

  it('WDA (unclipped frames): by its content\'s extent past its frame on one axis — mp-native Account Detail\'s card carousel horizontal, its transactions list vertical', async () => {
    const tree = parseWdaSource(await text('wda-capture-account-detail-bar-shown.json'));
    const views = [...everyNode(tree)].filter(scrolls).map((n) => [n.identifier ?? '', n.rect, scrollAxis(n, true)]);
    expect(views).toEqual([
      ['', { x: 24, y: 138, width: 354, height: 85 }, 'horizontal'],
      ['transactions.list.container', { x: 0, y: 180, width: 402, height: 694 }, 'vertical'],
    ]);
    // On a tree of clipped frames the extent says nothing (Android's: uiautomator cut it already).
    expect(scrollAxis([...everyNode(tree)].filter(scrolls)[0], false)).toBeUndefined();
  });

  it('the extent is the scroll view\'s OWN content: a nested scroll view counts by its frame, not by its cards; past both axes, or neither, says nothing', () => {
    const page = { x: 0, y: 0, width: 402, height: 874 };
    const carousel = node({ role: 'scrollable', rect: { x: 24, y: 300, width: 354, height: 85 }, children: [node({ role: 'button', rect: { x: 24, y: 300, width: 354, height: 85 } }), node({ role: 'button', rect: { x: 378, y: 300, width: 354, height: 85 } })] });
    const fits = node({ role: 'scrollable', rect: page, children: [carousel] });
    expect([scrollAxis(fits, true), scrollAxis(carousel, true)]).toEqual([undefined, 'horizontal']);
    const long = node({ role: 'scrollable', rect: page, children: [node({ role: 'other', rect: { x: 0, y: 0, width: 402, height: 1500 }, children: [carousel, node({ role: 'button', rect: { x: 24, y: 1400, width: 354, height: 52 } })] })] });
    // A row wholly past the frame alone does not say it runs on (it may be laid out off it): unknown.
    expect(scrollAxis(node({ role: 'scrollable', rect: page, children: [node({ role: 'button', rect: { x: 24, y: 1400, width: 354, height: 52 } })] }), true)).toBeUndefined();
    expect(scrollAxis(long, true)).toBe('vertical');
    const twoWay = node({ role: 'scrollable', rect: page, children: [node({ role: 'image', rect: { x: -100, y: -100, width: 800, height: 1200 } })] });
    expect(scrollAxis(twoWay, true)).toBeUndefined();
  });

  it('content laid out WHOLLY off the frame\'s side is no horizontal extent — a drawer at x −300, swipe-action buttons past a row\'s end, a page beside it; nor is a bleed a few points past both sides — a page whose content fits reads unknown, not horizontal', () => {
    const page = { x: 0, y: 0, width: 402, height: 874 };
    const row = node({ role: 'button', rect: { x: 0, y: 200, width: 402, height: 60 } });
    const fitting = (...off: UiNode[]) => scrollAxis(node({ role: 'scrollable', rect: page, children: [row, ...off] }), true);
    const drawer = node({ role: 'other', rect: { x: -300, y: 0, width: 300, height: 874 }, children: [node({ role: 'button', rect: { x: -280, y: 100, width: 260, height: 44 } }), node({ role: 'button', rect: { x: -280, y: 150, width: 260, height: 44 } })] });
    expect(fitting(drawer)).toBeUndefined();
    const actions = [node({ role: 'button', label: 'Delete', rect: { x: 402, y: 200, width: 80, height: 60 } }), node({ role: 'button', label: 'More', rect: { x: 482, y: 200, width: 80, height: 60 } })];
    expect(fitting(...actions)).toBeUndefined();
    expect(fitting(node({ role: 'other', rect: { x: 402, y: 0, width: 402, height: 874 }, children: [node({ role: 'button', rect: { x: 430, y: 300, width: 100, height: 44 } }), node({ role: 'button', rect: { x: 540, y: 300, width: 100, height: 44 } })] }))).toBeUndefined();
    expect(fitting(node({ role: 'image', rect: { x: -10, y: 100, width: 422, height: 200 } }))).toBeUndefined();
    // A drawer beside a page whose content runs on down: vertical, the drawer no veto.
    expect(scrollAxis(node({ role: 'scrollable', rect: page, children: [node({ role: 'other', rect: { x: 0, y: 0, width: 402, height: 2000 } }), drawer] }), true)).toBe('vertical');
  });

  it('Clips.axesOf: the scroll view of a rect, its axis and its nested scroll views\' — undefined for a rect the tree holds none of', async () => {
    const tree = parseWdaSource(await text('wda-capture-account-detail-bar-shown.json'));
    const facts = clipsOf(tree, { ancestry: true, unclipped: true });
    expect(facts.axesOf({ x: 24, y: 138, width: 354, height: 85 })).toEqual({ axis: 'horizontal', nested: [] });
    expect(facts.axesOf({ x: 0, y: 180, width: 402, height: 694 })).toEqual({ axis: 'vertical', nested: [] });
    expect(facts.axesOf({ x: 0, y: 181, width: 402, height: 694 })).toBeUndefined();
    const carousel = node({ role: 'scrollable', rect: { x: 24, y: 600, width: 354, height: 85 }, children: [node({ role: 'button', rect: { x: 24, y: 600, width: 354, height: 85 } }), node({ role: 'button', rect: { x: 378, y: 600, width: 354, height: 85 } })] });
    const page = node({ role: 'scrollable', scrollAxis: 'vertical', rect: { x: 0, y: 180, width: 402, height: 694 }, children: [carousel] });
    expect(clipsOf(node({ role: 'container', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [page] }), { ancestry: true, unclipped: true }).axesOf(page.rect)).toEqual({
      axis: 'vertical',
      nested: [{ rect: carousel.rect, axis: 'horizontal' }],
    });
  });

  it('over every real capture the suite holds, no scroll view reads horizontal but the one carousel (no false axis from the extent rule)', async () => {
    const trees = await everyFixtureTree();
    for (const file of ['wda-capture-account-detail-bar-shown.json', 'wda-capture-contacts-discard-popover.json', 'wda-capture-contacts-new-contact.json', 'wda-capture-swift-form-pushed.json']) trees.push([file, parseWdaSource(await text(file))]);
    const horizontal = trees.flatMap(([name, tree]) => [...everyNode(tree)].filter((n) => scrollAxis(n, tree.unclippedFrames === true) === 'horizontal').map((n) => `${name} ${JSON.stringify(n.rect)}`));
    expect(horizontal).toEqual(['wda-capture-account-detail-bar-shown.json {"x":24,"y":138,"width":354,"height":85}']);
  });
});
