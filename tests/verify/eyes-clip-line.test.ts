import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { describeScrollResult, scrollUntilVisible } from '../../src/interact/scroll.js';
import { CLIP_LINE, eyesQuestion } from '../../src/ui-tree/eyes.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { eyesOn, judgeEyes } from '../../src/verify/eyes.js';
import { FakeAdapter, node } from '../helpers/fake.js';

/**
 * THE EYES LOOK FOR A CLIP LINE (ui-tree/eyes.ts#eyesQuestion, verify/eyes.ts#judgeEyes): a `fully: true` claim on a
 * node whose tree cannot tell where it is drawn (ui-tree/geometry.ts#DrawnUntold: idb's flat list, which lists no
 * scroll view) is looked at once, every edge. Over the lab's real `scroll-bounded` capture (iOS 27, 402x874 pt, the png
 * 1206x2622): P `51,290 300x64` cut at `upper`'s bottom (330), S `51,552 300x64` at `lower`'s (560) — below each line
 * the screen's white runs across the target's columns and beside them alike, while beside its drawn rows the scroll
 * view's grey lies; W `51,130 300x64` lies whole in `upper`.
 * docs/bugs/2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md
 */

const IOS = new URL('../fixtures/truth/ios-iphone17-ios27/', import.meta.url);
const text = async (name: string): Promise<string> => readFile(new URL(name, IOS), 'utf8');
const idb = async (): Promise<UiNode> => parseIdbDescribeAll(await text('scroll-bounded.idb.json'));
const wda = async (): Promise<UiNode> => parseWdaSource(await text('scroll-bounded.wda.json'));
const byId = (tree: UiNode, target: string): UiNode => [...everyNode(tree)].find((n) => n.identifier === `lab.scroll-bounded.${target}`)!;
const EVERY_EDGE = ['top', 'bottom', 'left', 'right'].map((edge) => ({ edge, by: CLIP_LINE }));

describe('the trigger — an untold drawn frame under a `fully: true` claim', () => {
  it('idb P, fully: every edge asked for a clip line, over its region', async () => {
    const tree = await idb();
    const q = eyesQuestion(sceneOf(tree), tree, byId(tree, 'P'), undefined, 'fully');
    expect(q?.region).toEqual({ x: 51, y: 290, width: 300, height: 64 });
    expect(q?.edges).toEqual(EVERY_EDGE);
  });

  it('idb P, the plain stop: no question — its claim stays the tree\'s, unasked (ADR 0010\'s residual 5)', async () => {
    const tree = await idb();
    expect(eyesQuestion(sceneOf(tree), tree, byId(tree, 'P'), undefined, 'stop')).toBeUndefined();
  });

  it("WDA P, fully: no question — its tree lists `upper`, which tells where it is drawn", async () => {
    const tree = await wda();
    expect(eyesQuestion(sceneOf(tree), tree, byId(tree, 'P'), undefined, 'fully')).toBeUndefined();
  });
});

describe('judgeEyes — a clip line: the band that reads as the screen beside it, where beside its drawn rows the screen differs', () => {
  const judged = async (target: string) => {
    const tree = await idb();
    const png = PNG.sync.read(await readFile(new URL('scroll-bounded.png', IOS)));
    return judgeEyes(png, 3, eyesQuestion(sceneOf(tree), tree, byId(tree, target), undefined, 'fully')!);
  };

  it("P: its bottom 24 pt (330–354) the screen's white, its own blue above — cut at the line", async () => {
    expect(await judged('P')).toEqual({ sees: 'surface', edge: 'bottom', by: CLIP_LINE, depth: 24, surface: '#FFFFFF', own: '#1E88E5' });
  });

  it("S: its bottom 56 pt (560–616) the screen's white, 8 pt of its green drawn", async () => {
    expect(await judged('S')).toEqual({ sees: 'surface', edge: 'bottom', by: CLIP_LINE, depth: 56, surface: '#FFFFFF', own: '#43A047' });
  });

  it('W, whole in `upper`: its own colour to every edge', async () => {
    expect(await judged('W')).toEqual({ sees: 'own' });
  });

  it("a band of the page's colour where the page runs on beside the whole target (a label's padding): no line — own", () => {
    // 100x200 white; the target 10,60 80x70, blue on its rows 60–110, white (the page's) on 110–130: the band reads as
    // the screen beside it, but so does the screen beside its blue rows — the screen does not change at a line.
    const png = new PNG({ width: 100, height: 200 });
    png.data.fill(255);
    for (let y = 60; y < 110; y++) for (let x = 10; x < 90; x++) [png.data[(y * 100 + x) * 4], png.data[(y * 100 + x) * 4 + 1]] = [0x1e, 0x88];
    const target = node({ role: 'button', rect: { x: 10, y: 60, width: 80, height: 70 } });
    const tree = node({ role: 'other', rect: { x: 0, y: 0, width: 100, height: 200 }, children: [target] });
    expect(judgeEyes(png, 1, { tree, node: target, region: target.rect, edges: [{ edge: 'bottom', by: CLIP_LINE }] })).toEqual({ sees: 'own' });
  });

  it('no screenshot to judge: the claim stands as the tree\'s, unremarked — a clip line is looked for, not suspected', async () => {
    const tree = await idb();
    const q = eyesQuestion(sceneOf(tree), tree, byId(tree, 'P'), undefined, 'fully')!;
    const fake = new FakeAdapter({ s: tree }, 's');
    fake.screenshot = async () => {
      throw new Error('offline');
    };
    expect(await eyesOn(fake).fully(q)).toEqual({ sees: 'own' });
  });
});

describe('scroll_until under idb — a `fully: true` claim the eyes see cut', () => {
  const fakeOf = async (): Promise<FakeAdapter> => {
    const fake = new FakeAdapter({ s: await idb() }, 's');
    fake.viewportSize = { width: 402, height: 874 };
    fake.nextScreenshot = await readFile(new URL('scroll-bounded.png', IOS));
    return fake;
  };
  const FAST = { maxSwipes: 4, timeoutMs: 2_000, settleMs: 1 };

  it('P, fully: true: no "fully visible" — the failure names the clip line and the remedy; one screenshot', async () => {
    const fake = await fakeOf();
    const failure = (await scrollUntilVisible(fake, 'id:"lab.scroll-bounded.P"', { ...FAST, fully: true, eyes: eyesOn(fake) }).catch((e: unknown) => e)) as Error;
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain(
      "element is in the viewport but its bottom 24 pt read as the screen beside them (#FFFFFF), not its own #1E88E5: cut at the edge of a scroll view the tree does not list (a screenshot)",
    );
    expect(failure.message).toContain('treeSource: wda');
    expect(fake.screenshots).toHaveLength(1);
  });

  it('W, fully: true: "fully visible", one screenshot', async () => {
    const fake = await fakeOf();
    expect(describeScrollResult(await scrollUntilVisible(fake, 'id:"lab.scroll-bounded.W"', { ...FAST, fully: true, eyes: eyesOn(fake) }))).toBe('fully visible after 0 swipes');
    expect(fake.screenshots).toHaveLength(1);
  });

  it('P, the plain stop: "fully visible" as before, no screenshot (ADR 0010\'s residual 5)', async () => {
    const fake = await fakeOf();
    expect(describeScrollResult(await scrollUntilVisible(fake, 'id:"lab.scroll-bounded.P"', { ...FAST, eyes: eyesOn(fake) }))).toBe('fully visible after 0 swipes');
    expect(fake.screenshots).toHaveLength(0);
  });

  it('P, fully: true with no eyes handed in: "fully visible", as before the eyes — no clause on a clip line not looked for', async () => {
    const fake = await fakeOf();
    expect(describeScrollResult(await scrollUntilVisible(fake, 'id:"lab.scroll-bounded.P"', { ...FAST, fully: true }))).toBe('fully visible after 0 swipes');
  });

  it('WDA P, fully: true: clipped by its scroll view, the tree tells it — no screenshot', async () => {
    const fake = new FakeAdapter({ s: await wda() }, 's');
    fake.viewportSize = { width: 402, height: 874 };
    const failure = (await scrollUntilVisible(fake, 'id:"lab.scroll-bounded.P"', { ...FAST, fully: true, eyes: eyesOn(fake) }).catch((e: unknown) => e)) as Error;
    expect(failure.message).toContain('CLIPPED at bottom');
    expect(fake.screenshots).toHaveLength(0);
  });
});

/**
 * A no-op where the target is drawn: over every lab capture, every node idb lists, asked as a `fully: true` claim asks
 * (every edge for a clip line), reads its own — but P and S, cut at their scroll views' bottoms. A keyboard's keys (each
 * rect holding the gap below its cap, the keys and gaps beside) and a row of padded neighbours read no line: the screen
 * beside the rows past such a band is no plain colour of its own (verify/eyes.ts#judgeClipLine, step 3).
 */
describe('judgeEyes — no clip line where nothing cuts the target', () => {
  it('over the 32 lab captures, only scroll-bounded P and S read cut', async () => {
    const { readdir } = await import('node:fs/promises');
    const cells = (await readdir(IOS)).filter((f) => f.endsWith('.idb.json')).map((f) => f.replace('.idb.json', '')).sort();
    expect(cells.length).toBeGreaterThanOrEqual(32);
    const cut: string[] = [];
    for (const cell of cells) {
      const tree = parseIdbDescribeAll(await text(`${cell}.idb.json`));
      const png = PNG.sync.read(await readFile(new URL(`${cell}.png`, IOS)));
      const scene = sceneOf(tree);
      for (const n of everyNode(tree)) {
        if (n === tree) continue;
        const q = eyesQuestion(scene, tree, n, undefined, 'fully');
        if (q !== undefined && judgeEyes(png, png.width / 402, q).sees === 'surface') cut.push(n.identifier ?? `${cell}: ${n.label ?? n.role}`);
      }
    }
    expect(cut).toEqual(['lab.scroll-bounded.P', 'lab.scroll-bounded.S']);
  });
});
