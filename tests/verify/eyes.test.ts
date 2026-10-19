import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { eyesQuestion, type EyesQuestion } from '../../src/ui-tree/eyes.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { eyesOn, judgeEyes } from '../../src/verify/eyes.js';
import { parseDump } from '../helpers/android-dumps.js';
import { FakeAdapter, node } from '../helpers/fake.js';

/**
 * THE EYES (ui-tree/eyes.ts, verify/eyes.ts) over the lab's real k7 stop — `form-keyboard` on averi_lab after the one
 * stroke `scroll_until phone` drew (captured 2026-10-19, emulator-5554, the IME up): `phone` dumped `55,1113 970x125`,
 * flush with the submit bar's `55,1238 970x132` drawn after it, while the bar's padding (no node) covers 1210–1237 —
 * and synthetic pngs for the answers the capture does not show.
 */

const fixture = (name: string): URL => new URL(`../fixtures/${name}`, import.meta.url);
const K7_XML = readFileSync(fixture('android-lab-form-keyboard-k7-stop.xml'), 'utf8');
const k7Tree = async (): Promise<UiNode> => parseDump(K7_XML);
const k7Png = async (): Promise<Buffer> => readFile(fixture('android-lab-form-keyboard-k7-stop.png'));
const byId = (tree: UiNode, id: string): UiNode => {
  const found = [...everyNode(tree)].find((n) => n.identifier === id);
  if (found === undefined) throw new Error(`no ${id}`);
  return found;
};

describe('the trigger — a flush neighbour (Scene.flushNeighbours), the only shape the eyes are asked of', () => {
  it('k7: phone flush with the submit bar drawn after it, outside its scroll view — asked at its bottom edge, over its pixel region', async () => {
    const tree = await k7Tree();
    const q = eyesQuestion(sceneOf(tree), tree, byId(tree, 'lab.form-keyboard.phone'), undefined);
    expect(q?.region).toEqual({ x: 55, y: 1113, width: 970, height: 125 });
    expect(q?.flush.map((f) => [f.edge, f.by.identifier, f.by.rect])).toEqual([['bottom', 'lab.form-keyboard.submit', { x: 55, y: 1238, width: 970, height: 132 }]]);
  });

  it('k7: postcode, clear of the bar — no question', async () => {
    const tree = await k7Tree();
    expect(eyesQuestion(sceneOf(tree), tree, byId(tree, 'lab.form-keyboard.postcode'), undefined)).toBeUndefined();
  });

  const list = (rows: UiNode[], extra: UiNode[] = []): UiNode =>
    node({
      role: 'container',
      rect: { x: 0, y: 0, width: 1080, height: 2220 },
      children: [node({ role: 'container', clipsDescendants: true, rect: { x: 0, y: 0, width: 1080, height: 2000 }, children: rows }), ...extra],
    });

  it('two rows of one list laid flush — the list\'s own neighbours, no bar: no question', () => {
    const a = node({ role: 'button', identifier: 'a', rect: { x: 0, y: 100, width: 1080, height: 132 } });
    const b = node({ role: 'button', identifier: 'b', rect: { x: 0, y: 232, width: 1080, height: 132 } });
    const tree = list([a, b]);
    expect(eyesQuestion(sceneOf(tree), tree, a, undefined)).toBeUndefined();
  });

  it('a pinned bar flush with a row, outside the list — asked; the same tree from a source of unclipped frames (WDA\'s) — not', () => {
    const row = node({ role: 'button', identifier: 'row', rect: { x: 40, y: 1700, width: 1000, height: 132 } });
    const bar = node({ role: 'button', identifier: 'bar', rect: { x: 20, y: 1832, width: 1040, height: 168 } });
    const tree = list([row], [bar]);
    expect(eyesQuestion(sceneOf(tree), tree, row, undefined)?.flush.map((f) => [f.edge, f.by.identifier])).toEqual([['bottom', 'bar']]);
    const wda = { ...tree, unclippedFrames: true as const };
    expect(eyesQuestion(sceneOf(wda), wda, row, undefined)).toBeUndefined();
  });
});

describe('the trigger — every flush edge, and none of a neighbour spanning the screen', () => {
  const list = (rows: UiNode[], extra: UiNode[]): UiNode =>
    node({
      role: 'container',
      rect: { x: 0, y: 0, width: 1080, height: 2220 },
      children: [node({ role: 'container', clipsDescendants: true, rect: { x: 0, y: 0, width: 1080, height: 2000 }, children: rows }), ...extra],
    });
  const row = node({ role: 'button', identifier: 'row', rect: { x: 40, y: 300, width: 1000, height: 132 } });

  it('a row between a pinned header and a bar: both edges in one question', () => {
    const header = node({ role: 'button', identifier: 'header', rect: { x: 20, y: 200, width: 1040, height: 100 } });
    const bar = node({ role: 'button', identifier: 'bar', rect: { x: 20, y: 432, width: 1040, height: 168 } });
    const tree = list([row], [header, bar]);
    expect(eyesQuestion(sceneOf(tree), tree, row, undefined)?.flush.map((f) => [f.edge, f.by.identifier])).toEqual([
      ['top', 'header'],
      ['bottom', 'bar'],
    ]);
  });

  it('a Scaffold bar as wide as the screen flush with the row — nothing beside it to read a surface from: not asked', () => {
    const bar = node({ role: 'button', identifier: 'bar', rect: { x: 0, y: 432, width: 1080, height: 168 } });
    const tree = list([row], [bar]);
    expect(eyesQuestion(sceneOf(tree), tree, row, undefined)).toBeUndefined();
  });
});

describe('judgeEyes — the band of the surface around the neighbour, read row by row', () => {
  it('k7: 28 px of phone\'s bottom show the bar\'s #F2F2F7, not its own #FFFFFF', async () => {
    const tree = await k7Tree();
    const q = eyesQuestion(sceneOf(tree), tree, byId(tree, 'lab.form-keyboard.phone'), undefined) as EyesQuestion;
    expect(judgeEyes(PNG.sync.read(await k7Png()), 1, q)).toMatchObject({ sees: 'surface', depth: 28, surface: '#F2F2F7', own: '#FFFFFF' });
  });

  /** A 100x200 png: `own` everywhere, `bar` from row `barTop` down, full width; the target 10,60 80x70 ends at 130, flush with the neighbour 10,130 80x40 (or `byRect`). */
  const scene = (opts: { own?: number[]; bar: number[]; barTop: number; byRect?: Rect }) => {
    const png = new PNG({ width: 100, height: 200 });
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 100; x++) {
        const c = y >= opts.barTop ? opts.bar : (opts.own ?? [255, 255, 255]);
        png.data.set([c[0]!, c[1]!, c[2]!, 255], (y * 100 + x) * 4);
      }
    }
    const tree = node({ role: 'container', rect: { x: 0, y: 0, width: 100, height: 200 } });
    const target = node({ role: 'textfield', rect: { x: 10, y: 60, width: 80, height: 70 } });
    const q: EyesQuestion = { tree, node: target, region: target.rect, flush: [{ edge: 'bottom', by: node({ role: 'button', rect: opts.byRect ?? { x: 10, y: 130, width: 80, height: 40 } }) }] };
    return { png, q };
  };

  it('a 10-px band of the bar\'s grey over its bottom — surface, 10 deep', () => {
    const { png, q } = scene({ bar: [0xf2, 0xf2, 0xf7], barTop: 120 });
    expect(judgeEyes(png, 1, q)).toMatchObject({ sees: 'surface', depth: 10, surface: '#F2F2F7', own: '#FFFFFF' });
  });

  it('…at scale 2 (a png of twice the tree\'s units): 5 units deep', () => {
    const { png, q } = scene({ bar: [0xf2, 0xf2, 0xf7], barTop: 120 });
    const half: EyesQuestion = { ...q, region: { x: 5, y: 30, width: 40, height: 35 }, flush: [{ edge: 'bottom', by: { ...q.flush[0]!.by, rect: { x: 5, y: 65, width: 40, height: 20 } } }] };
    expect(judgeEyes(png, 2, half)).toMatchObject({ sees: 'surface', depth: 5, surface: '#F2F2F7', own: '#FFFFFF' });
  });

  it('a band no deeper than the pixel slack (2) — its own colour to the edge', () => {
    const { png, q } = scene({ bar: [0xf2, 0xf2, 0xf7], barTop: 128 });
    expect(judgeEyes(png, 1, q)).toEqual({ sees: 'own' });
  });

  it('no band at all — its own colour to the edge', () => {
    const { png, q } = scene({ bar: [0xf2, 0xf2, 0xf7], barTop: 130 });
    expect(judgeEyes(png, 1, q)).toEqual({ sees: 'own' });
  });

  it('a bar too close to the target\'s own colour (#F8F8F8 on #FFFFFF, ΔE 1.40: apart from it as a line, under 2 as a pair) — unjudged, the two named', () => {
    const { png, q } = scene({ bar: [0xf8, 0xf8, 0xf8], barTop: 120 });
    const answer = judgeEyes(png, 1, q);
    expect(answer).toMatchObject({ sees: 'unjudged' });
    expect(answer.sees === 'unjudged' && answer.why).toMatch(/^its own colour #FFFFFF and that surface's #F8F8F8 are too close to tell apart \(ΔE \d\.\d\d\)$/);
  });

  it('a neighbour as wide as the screen — nothing beside it to read the surface from: unjudged', () => {
    const { png, q } = scene({ bar: [0xf2, 0xf2, 0xf7], barTop: 120, byRect: { x: 0, y: 130, width: 100, height: 40 } });
    expect(judgeEyes(png, 1, q)).toMatchObject({ sees: 'unjudged', why: 'no plain surface beside that node to read its colour from' });
  });

  it('the two strips beside the neighbour of two colours — no one surface: unjudged', () => {
    const { png, q } = scene({ bar: [0xf2, 0xf2, 0xf7], barTop: 120 });
    // The right strip (x 90–100) on the neighbour's rows another grey.
    for (let y = 130; y < 170; y++) for (let x = 90; x < 100; x++) png.data.set([0xd0, 0xd0, 0xd0, 255], (y * 100 + x) * 4);
    expect(judgeEyes(png, 1, q)).toMatchObject({ sees: 'unjudged', why: 'the surface beside that node is not one colour' });
  });

  it('lines half #FFFFFF, half #F2F2F7 (one 4-bit bucket) — no line of the surface: own', () => {
    const { png, q } = scene({ bar: [0xf2, 0xf2, 0xf7], barTop: 130 });
    for (let y = 120; y < 130; y++) for (let x = 0; x < 100; x += 2) png.data.set([0xf2, 0xf2, 0xf7, 255], (y * 100 + x) * 4);
    expect(judgeEyes(png, 1, q)).toEqual({ sees: 'own' });
  });

  it('the screen beside the target the surface\'s colour too (a grouped background, the target\'s own touch margin over it) — unjudged, never a band', () => {
    // The reviewer's shape over the real k7 tree: #F2F2F7 everywhere, phone's field white 1129–1228, no bar padding —
    // Continue drawn on the background; the dumped node's 10-px margin below the field reads the background's grey.
    const tree = parseDump(K7_XML);
    const q = eyesQuestion(sceneOf(tree), tree, byId(tree, 'lab.form-keyboard.phone'), undefined) as EyesQuestion;
    const png = new PNG({ width: 1080, height: 2220 });
    const fill = (x0: number, y0: number, x1: number, y1: number, c: number[]) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) png.data.set([c[0]!, c[1]!, c[2]!, 255], (y * 1080 + x) * 4);
    };
    fill(0, 0, 1080, 2220, [0xf2, 0xf2, 0xf7]);
    fill(55, 1129, 1025, 1228, [255, 255, 255]);
    fill(55, 1238, 1025, 1370, [0x67, 0x50, 0xa4]);
    expect(judgeEyes(png, 1, q)).toMatchObject({
      sees: 'unjudged',
      why: "the screen beside it shows that surface's colour #F2F2F7 too: the band may be its own margin over that background",
    });
  });

  it('a target as wide as the screen — nothing beside it to tell its own margin from the surface: unjudged', () => {
    const { png, q } = scene({ bar: [0xf2, 0xf2, 0xf7], barTop: 120 });
    const wide: EyesQuestion = { ...q, region: { x: 0, y: 60, width: 100, height: 70 } };
    expect(judgeEyes(png, 1, wide)).toMatchObject({ sees: 'unjudged', why: 'nothing of the screen beside it to tell its own margin from that surface' });
  });

  it('two flush edges, one screenshot: the deeper band of the two is said', () => {
    const { png, q } = scene({ bar: [0xf2, 0xf2, 0xf7], barTop: 120 });
    for (let y = 0; y < 66; y++) for (let x = 0; x < 100; x++) png.data.set([0xe0, 0xe0, 0xf0, 255], (y * 100 + x) * 4);
    const top = node({ role: 'button', rect: { x: 10, y: 20, width: 80, height: 40 } });
    const both: EyesQuestion = { ...q, flush: [{ edge: 'top', by: top }, ...q.flush] };
    expect(judgeEyes(png, 1, both)).toMatchObject({ sees: 'surface', edge: 'bottom', depth: 10 });
    const deeperTop: EyesQuestion = { ...both, flush: [{ edge: 'top', by: top }, { edge: 'bottom', by: q.flush[0]!.by }] };
    for (let y = 60; y < 75; y++) for (let x = 0; x < 100; x++) png.data.set([0xe0, 0xe0, 0xf0, 255], (y * 100 + x) * 4);
    expect(judgeEyes(png, 1, deeperTop)).toMatchObject({ sees: 'surface', edge: 'top', depth: 15, surface: '#E0E0F0' });
  });
});

describe('eyesOn — one screenshot, never a throw', () => {
  it('k7: the fake serves the captured png — surface, and exactly one screenshot', async () => {
    const tree = await k7Tree();
    const fake = new FakeAdapter({ s: tree }, 's');
    fake.viewportSize = { width: 1080, height: 2220 };
    fake.nextScreenshot = await k7Png();
    const q = eyesQuestion(sceneOf(tree), tree, byId(tree, 'lab.form-keyboard.phone'), undefined) as EyesQuestion;
    expect(await eyesOn(fake)(q)).toMatchObject({ sees: 'surface', depth: 28 });
    expect(fake.screenshots).toHaveLength(1);
  });

  it('bytes that are no png — unjudged, said so', async () => {
    const tree = await k7Tree();
    const fake = new FakeAdapter({ s: tree }, 's');
    const q = eyesQuestion(sceneOf(tree), tree, byId(tree, 'lab.form-keyboard.phone'), undefined) as EyesQuestion;
    expect(await eyesOn(fake)(q)).toMatchObject({ sees: 'unjudged', why: expect.stringMatching(/^the screenshot did not decode: /) });
  });

  it('a screenshot that fails — unjudged, its first line quoted', async () => {
    const tree = await k7Tree();
    const fake = new FakeAdapter({ s: tree }, 's');
    fake.screenshot = () => Promise.reject(new Error('adb: device offline\nmore'));
    const q = eyesQuestion(sceneOf(tree), tree, byId(tree, 'lab.form-keyboard.phone'), undefined) as EyesQuestion;
    expect(await eyesOn(fake)(q)).toMatchObject({ sees: 'unjudged', edge: 'bottom', why: 'the screenshot failed: adb: device offline' });
  });
});
