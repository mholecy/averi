import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { seenOrderOf } from '../../src/ui-tree/seen-order.js';
import { parseDump } from '../helpers/android-dumps.js';
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

  // Before D84 `drawn` (the draw order's own cover): a run listed by tops cannot tell a sibling listed after the target
  // from one drawn under it (views-drawn-over's A over the later-listed B), so it is an untold peer as T's and U's
  // are — still refused unseen, and the eyes see it over C (the golden's C: "drawn over it as a screenshot shows").
  // ADR 0015's D84 amendment.
  it('C, the same bare View listed AFTER it (its top below C\'s): a cover whose order is not told, over its centre', async () => {
    const t = parseWdaSource(await capture('rn-banner.wda.json'));
    const [target, cover] = at(t, 'C');
    const seen = drawOrder(t).exposure(target, IPHONE);
    expect(tagged(seen.covers)).toEqual([{ node: cover, order: 'untold', presented: false }]);
    expect(seen.tapAt).toBeUndefined();
  });
});

/**
 * The same cell under uiautomator (lab note LR4, docs/bugs/2026-11-09-lab-android-uiautomator-lists-a-react-native-cover-before-its-target-so-it-is-tapped-and-measured.md):
 * AOSP lists a classic ViewGroup's children by location (adapters/android-accessibility-order.ts), every cover (left 73)
 * before its target (left 128) — C's too, whose top (1321) lies below C's (1293). The parser marks the run
 * `readingOrder`, so each cover is a peer whose order the eyes tell; seen over its target, it covers it.
 */
describe('rn-banner under uiautomator: each cover, listed before its target, is a cover the eyes tell', () => {
  const PHONE = { x: 0, y: 0, width: 1080, height: 2220 };
  const android = async () => parseDump(await readFile(new URL('../fixtures/truth/android-rn-averi_lab-api33/rn-banner.xml', import.meta.url), 'utf8'));
  const COLOUR = { T: '#43A047', U: '#8E24AA', C: '#FB8C00' } as const;
  it.each(['T', 'U', 'C'] as const)('%s, its cover seen drawn over it: covered by it at its centre, nothing tapped', async (tag) => {
    const t = await android();
    const [target, cover] = at(t, tag);
    const seen = seenOrderOf(target, [{ peer: cover, seen: 'under', overlap: '#263238', own: COLOUR[tag], other: '#263238' }]);
    const exposure = drawOrder(t, seen).exposure(target, PHONE);
    expect(tagged(exposure.covers)).toEqual([{ node: cover, order: 'seenOver', presented: false }]);
    expect(exposure.centreCover?.node).toBe(cover);
  });
  it.each(['T', 'U', 'C'] as const)('%s with no screenshot: its cover is one whose order is not told — never read as beneath it', async (tag) => {
    const t = await android();
    const [target, cover] = at(t, tag);
    expect(tagged(drawOrder(t).exposure(target, PHONE).covers)).toEqual([{ node: cover, order: 'untold', presented: false }]);
  });
});

describe('rn-banner under idb: what the flat list lists', () => {
  it('nothing covers T, U or C: T\'s toast (31,100, bottom 152) lies above the flat list\'s top-bar line, read as its bar (ADR 0004), and idb lists neither bare cover — the source\'s limits, not the order\'s', async () => {
    const t = parseIdbDescribeAll(await capture('rn-banner.idb.json'));
    for (const tag of ['T', 'U', 'C']) expect(drawOrder(t).exposure(byId(t, `lab.rn-banner.${tag}`), IPHONE).covers).toEqual([]);
  });
});

describe('rn-field under WDA: a field\'s own floating label listed before it is no cover of it', () => {
  it('M\'s label (69,491 175x23, spanning its input\'s height) listed before the field\'s wrapper (69,492 264x20, nothing but the input): the wrapper shows whole', async () => {
    const t = parseWdaSource(await capture('rn-field.wda.json'));
    const label = [...everyNode(t)].find((n) => n.label === 'Message for the recipient')!;
    const wrapper = parentOf(t, byId(t, 'lab.rn-field.M.field'))!;
    expect(wrapper.identifier ?? null).toBeNull();
    const seen = drawOrder(t).exposure(wrapper, IPHONE);
    expect(seen.covers.map((c) => c.node)).not.toContain(label);
    expect(seen.aimedClearOf).not.toContain(label);
  });
});

/**
 * The review's shapes (round 9, MAJOR-1), on the rn-banner capture edited: a cover NARROWER than its target is no
 * target's own content — only a field's own floating label is (ADR 0014's relation) — so it stays a cover.
 */
describe('rn-banner edited: a cover narrower than its target is still its cover', () => {
  const edited = async (edit: (n: UiNode) => UiNode) => {
    const walk = (n: UiNode): UiNode => edit({ ...n, children: n.children.map(walk) });
    return walk(parseWdaSource(await capture('rn-banner.wda.json')));
  };
  it('S1: T a full-width row (0,110 402x64) under its 340-pt toast: untold, over its centre', async () => {
    const t = await edited((n) => (n.identifier === 'lab.rn-banner.T' ? { ...n, rect: { x: 0, y: 110, width: 402, height: 64 } } : n));
    const [target, cover] = at(t, 'T');
    expect(tagged(drawOrder(t).exposure(target, IPHONE).covers)).toEqual([{ node: cover, order: 'untold', presented: false }]);
  });
  it('S2: a 120-pt labelled toast over T\'s centre, its top above T\'s: untold', async () => {
    const t = await edited((n) => (n.identifier === 'lab.rn-banner.T.cover' ? { ...n, rect: { x: 141, y: 100, width: 120, height: 52 } } : n));
    const [target, cover] = at(t, 'T');
    expect(tagged(drawOrder(t).exposure(target, IPHONE).covers)).toEqual([{ node: cover, order: 'untold', presented: false }]);
  });
  it('S5: a text "Copied" 200 pt wide over a full-width T: untold', async () => {
    const t = await edited((n) =>
      n.identifier === 'lab.rn-banner.T' ? { ...n, rect: { x: 0, y: 110, width: 402, height: 64 } } : n.identifier === 'lab.rn-banner.T.cover' ? { ...n, role: 'text', identifier: null, label: 'Copied', rect: { x: 101, y: 100, width: 200, height: 52 } } : n,
    );
    const target = byId(t, 'lab.rn-banner.T');
    const cover = [...everyNode(t)].find((n) => n.label === 'Copied')!;
    expect(tagged(drawOrder(t).exposure(target, IPHONE).covers)).toEqual([{ node: cover, order: 'untold', presented: false }]);
  });
});

const parentOf = (root: UiNode, child: UiNode): UiNode | undefined => [...everyNode(root)].find((n) => n.children.includes(child));
