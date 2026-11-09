import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { compareByLocation } from '../../src/adapters/android-accessibility-order.js';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { parseDump } from '../helpers/android-dumps.js';

/**
 * AOSP's accessibility order of a classic ViewGroup's children (ViewGroup.java, ChildListForAccessibility.sort →
 * ViewLocationHolder.compareBoundsOfTree, COMPARISON_STRATEGY_STRIPE), as averi reads it off the dumped bounds.
 * Sign only: < 0 lists `a` first, > 0 lists `b` first, 0 is a tie the dump cannot break.
 */
const r = (left: number, top: number, right: number, bottom: number): Rect => ({ x: left, y: top, width: right - left, height: bottom - top });
const sign = (a: Rect, b: Rect): number => Math.sign(compareByLocation(a, b));

describe('compareByLocation: the stripe comparator of ViewGroup.ViewLocationHolder', () => {
  it('a wholly ABOVE b (its bottom at or above b\'s top) is first, whatever the left edges', () => {
    expect(sign(r(500, 0, 600, 100), r(0, 100, 100, 200))).toBe(-1);
    expect(sign(r(0, 100, 100, 200), r(500, 0, 600, 100))).toBe(1);
  });

  it('in one stripe (vertical extents overlap) the LEFT edge decides, before the top: rn-banner\'s cover (left 73) before its target (left 128), C\'s cover too though it starts lower', () => {
    expect(sign(r(73, 276, 1008, 419), r(128, 303, 953, 479))).toBe(-1);
    expect(sign(r(73, 1321, 1008, 1464), r(128, 1293, 953, 1469))).toBe(-1);
    expect(sign(r(128, 1293, 953, 1469), r(73, 1321, 1008, 1464))).toBe(1);
  });

  it('same stripe, same left: the higher top first', () => {
    expect(sign(r(0, 10, 100, 110), r(0, 20, 100, 120))).toBe(-1);
    expect(sign(r(0, 20, 100, 120), r(0, 10, 100, 110))).toBe(1);
  });

  it('same left and top: the TALLER first, then the WIDER', () => {
    expect(sign(r(0, 0, 100, 200), r(0, 0, 100, 100))).toBe(-1);
    expect(sign(r(0, 0, 100, 100), r(0, 0, 100, 200))).toBe(1);
    expect(sign(r(0, 0, 200, 100), r(0, 0, 100, 100))).toBe(-1);
    expect(sign(r(0, 0, 100, 100), r(0, 0, 200, 100))).toBe(1);
  });

  it('the same rect: a tie (AOSP breaks it by the children\'s bounds and the accessibility id, which the dump does not give)', () => {
    expect(sign(r(0, 0, 100, 100), r(0, 0, 100, 100))).toBe(0);
  });

  it('left-to-right is assumed: the dump names no layout direction, so a right-to-left stripe (the right edge first) reads out of order', () => {
    // Under RTL AOSP lists the larger right edge first: b (right 300) before a (right 200).
    expect(sign(r(200, 0, 300, 100), r(0, 0, 200, 100))).toBe(1);
  });
});

const dump = async (dir: string, name: string): Promise<UiNode> =>
  parseDump(await readFile(new URL(`../fixtures/truth/${dir}/${name}`, import.meta.url), 'utf8'));
const parentOfId = (tree: UiNode, id: string): UiNode => [...everyNode(tree)].find((n) => n.children.some((c) => c.identifier === id))!;

describe('parseUiautomatorXml marks a parent whose children are listed in location order (UiNode.readingOrder)', () => {
  it('rn-banner: React Native\'s screen view, each cover listed before the target it is drawn over, is marked', async () => {
    const t = await dump('android-rn-averi_lab-api33', 'rn-banner.xml');
    expect(parentOfId(t, 'lab.rn-banner.T').readingOrder).toBe(true);
  });

  it('scroll-sticky: Compose\'s run (R, left 128, listed before the header, left 0, in its stripe) is out of location order — Compose supplies its own node provider — and is not marked', async () => {
    const t = await dump('android-averi_lab-api33', 'scroll-sticky.xml');
    expect(parentOfId(t, 'lab.scroll-sticky.R').readingOrder).toBeUndefined();
  });

  it('form-shared-id: a Compose run that happens to be in location order (each field, left 55, before its label drawn over its outline, left 77) is not marked either — Compose lists its own nodes, unsorted', async () => {
    const t = await dump('android-averi_lab-api33', 'form-shared-id.xml');
    const run = [...everyNode(t)].find((n) => n.children.some((c) => c.label === 'Value*'))!;
    expect(run.readingOrder).toBeUndefined();
    expect([...everyNode(t)].filter((n) => n.readingOrder)).toEqual([]);
  });

  it('form-picker: a Compose dialog (no ComposeView in its dump: a plain View with children hosts the nodes Compose lists) is not marked, its country rows in location order or not', async () => {
    const t = await dump('android-averi_lab-api33', 'form-picker.xml');
    expect([...everyNode(t)].filter((n) => n.readingOrder)).toEqual([]);
  });

  it('two children of one rect, either way round, are in order (a tie AOSP breaks by what the dump does not give) — marked', () => {
    const t = parseDump(`<hierarchy rotation="0">
  <node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
    <node class="android.view.View" resource-id="app:id/a" bounds="[0,100][1080,300]"/>
    <node class="android.view.View" resource-id="app:id/b" bounds="[0,100][1080,300]"/>
  </node>
</hierarchy>`);
    expect(t.readingOrder).toBe(true);
  });

  it('a node with one child is not marked: there is no order to read', async () => {
    const t = await dump('android-averi_lab-api33', 'scroll-sticky.xml');
    expect(t.children).toHaveLength(1);
    expect(t.readingOrder).toBeUndefined();
  });
});
