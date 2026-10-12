import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { parseWdaSource, parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { clips, scrolls } from '../../src/ui-tree/scroll-containers.js';
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
