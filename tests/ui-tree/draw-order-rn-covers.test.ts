import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { tagged } from '../helpers/covers.js';

/**
 * React Native's covers (lab note LR3, docs/bugs/2026-10-19-lab-ios-wda-lists-react-native-views-by-their-frames-top-not-in-draw-order.md),
 * over the lab's rn-banner capture: each coloured target a Pressable (WDA's `Other`, no trait) and, as its LATER JSX
 * sibling, an opaque cover over its centre. WDA lists RN's views by their tops, in one run marked `readingOrder`:
 * T.cover "Saved" 31,100 and U.cover 31,280 (each 340x52, 10 pt above its target) BEFORE T 51,110 and U 51,290 (300x64);
 * C.cover 31,480 AFTER C 51,470. idb lists T.cover before T and neither bare cover.
 */
const IPHONE = { x: 0, y: 0, width: 402, height: 874 };
const capture = async (name: string) => readFile(new URL(`../fixtures/truth/ios-rn-iphone17-ios27/${name}`, import.meta.url), 'utf8');
const byId = (tree: UiNode, id: string) => [...everyNode(tree)].find((n) => n.identifier === id)!;
const at = (tree: UiNode, tag: string) => [byId(tree, `lab.rn-banner.${tag}`), byId(tree, `lab.rn-banner.${tag}.cover`)] as const;

describe('rn-banner under WDA: a later sibling drawn over the target is its cover, wherever the run lists it', () => {
  it('T, its labelled toast listed before it (its top above T\'s): a cover whose order is not told, over its centre', async () => {
    const t = parseWdaSource(await capture('rn-banner.wda.json'));
    const [target, cover] = at(t, 'T');
    const seen = drawOrder(t).exposure(target, IPHONE);
    expect(tagged(seen.covers)).toEqual([{ node: cover, order: 'untold', presented: false }]);
    expect(seen.centreCover?.node).toBe(cover);
  });

  it('U, a bare View with an identifier only, listed before it: drawn (the app named it), untold, over its centre', async () => {
    const t = parseWdaSource(await capture('rn-banner.wda.json'));
    const [target, cover] = at(t, 'U');
    expect(tagged(drawOrder(t).exposure(target, IPHONE).covers)).toEqual([{ node: cover, order: 'untold', presented: false }]);
  });

  it('C, the same bare View listed AFTER it (its top below C\'s): the draw order\'s own cover, drawn', async () => {
    const t = parseWdaSource(await capture('rn-banner.wda.json'));
    const [target, cover] = at(t, 'C');
    expect(tagged(drawOrder(t).exposure(target, IPHONE).covers)).toEqual([{ node: cover, order: 'drawn', presented: false }]);
  });
});

describe('rn-banner under idb: what the flat list lists', () => {
  it('nothing covers T, U or C: T\'s toast (31,100, bottom 152) lies above the flat list\'s top-bar line, read as its bar (ADR 0004), and idb lists neither bare cover — the source\'s limits, not the order\'s', async () => {
    const t = parseIdbDescribeAll(await capture('rn-banner.idb.json'));
    for (const tag of ['T', 'U', 'C']) expect(drawOrder(t).exposure(byId(t, `lab.rn-banner.${tag}`), IPHONE).covers).toEqual([]);
  });
});

describe('rn-field under WDA: a field\'s own floating label listed before it is no cover of it', () => {
  it('M\'s label (69,491 175x23, narrower than its field, its centre on it) listed before the field wrapper: the field shows whole', async () => {
    const t = parseWdaSource(await capture('rn-field.wda.json'));
    const field = byId(t, 'lab.rn-field.M.field');
    expect(drawOrder(t).exposure(field, IPHONE).covers.map((c) => c.node.identifier ?? c.node.label)).not.toContain('lab.rn-field.M');
  });
});
