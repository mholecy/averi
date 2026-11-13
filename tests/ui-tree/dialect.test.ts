import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import type { UiNode } from '../../src/adapters/types.js';
import { dialectOf, type TreeDialect } from '../../src/ui-tree/dialect.js';
import { markByWindow } from '../../src/ui-tree/window-mark.js';
import { parseDump } from '../helpers/android-dumps.js';

// THE TREE'S DIALECT (ui-tree/dialect.ts, backlog A45): the one reader of the root marks the three parsers and the
// window manager's word set. Pinned on one real capture of each source — the lab's `bands` screen, read by idb, by WDA
// and by uiautomator — and on a tree no source marked (a hand-built tree, a normalized snapshot).

const IOS = new URL('../fixtures/truth/ios-iphone17-ios27/', import.meta.url);
const ANDROID = new URL('../fixtures/truth/android-averi_lab-api33/', import.meta.url);
const read = (dir: URL, file: string): string => readFileSync(new URL(file, dir), 'utf8');

const idb = (): UiNode => parseIdbDescribeAll(read(IOS, 'bands.idb.json'));
const wda = (): UiNode => parseWdaSourceValue(JSON.parse(read(IOS, 'bands.wda.json')));
const uiautomator = (): UiNode => parseDump(read(ANDROID, 'bands.xml'));
const unmarked: UiNode = { role: 'container', label: null, identifier: null, value: null, rect: { x: 0, y: 0, width: 402, height: 874 }, children: [] };

/** A nested tree that marks nothing: every fact off, `cutsAtLater` on (the one derived from absent marks). */
const NESTED: TreeDialect = {
  ancestry: true,
  framesUnclipped: false,
  cutAtScreen: false,
  cutsAtLater: true,
  padsTouchTargets: false,
  judgesPresentations: false,
};

describe('dialectOf — the root marks, read once', () => {
  it("idb's flat list: no ancestry, the top layer only, nothing cut at a later node", () => {
    expect(dialectOf(idb())).toEqual({ ...NESTED, ancestry: false, cutsAtLater: false, topLayerOnly: 'idb' });
  });

  it("WDA's tree: frames unclipped, presented layers judged (its payload carries the visibility flags), nothing cut at a later node", () => {
    expect(dialectOf(wda())).toEqual({ ...NESTED, framesUnclipped: true, cutsAtLater: false, judgesPresentations: true });
  });

  it("uiautomator's tree: cut at the screen and at a later node, touch targets padded, the active window only — which may hide the screen", () => {
    expect(dialectOf(uiautomator())).toEqual({ ...NESTED, cutAtScreen: true, padsTouchTargets: true, activeWindow: 'mayHide' });
  });

  it("the window manager's word that the window is the screen alone (window-mark.ts) is read as such", () => {
    const tree = uiautomator();
    const marked = markByWindow(tree, { of: 'screenAlone', frame: tree.rect });
    expect(dialectOf(marked).activeWindow).toBe('screenAlone');
  });

  it('a tree no source marked: nested, and cut at a later node — the absent marks say it', () => {
    expect(dialectOf(unmarked)).toEqual(NESTED);
  });
});
