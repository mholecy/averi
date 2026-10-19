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
const k7Tree = async (): Promise<UiNode> => parseDump(await readFile(fixture('android-lab-form-keyboard-k7-stop.xml'), 'utf8'));
const k7Png = async (): Promise<Buffer> => readFile(fixture('android-lab-form-keyboard-k7-stop.png'));
const byId = (tree: UiNode, id: string): UiNode => {
  const found = [...everyNode(tree)].find((n) => n.identifier === id);
  if (found === undefined) throw new Error(`no ${id}`);
  return found;
};

describe('the trigger — a flush neighbour (Scene.flushNeighbour), the only shape the eyes are asked of', () => {
  it('k7: phone flush with the submit bar drawn after it, outside its scroll view — asked at its bottom edge, over its pixel region', async () => {
    const tree = await k7Tree();
    const q = eyesQuestion(sceneOf(tree), tree, byId(tree, 'lab.form-keyboard.phone'), undefined);
    expect(q).toMatchObject({ edge: 'bottom', region: { x: 55, y: 1113, width: 970, height: 125 } });
    expect(q?.neighbour.identifier).toBe('lab.form-keyboard.submit');
    expect(q?.neighbour.rect).toEqual({ x: 55, y: 1238, width: 970, height: 132 });
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
    const bar = node({ role: 'button', identifier: 'bar', rect: { x: 0, y: 1832, width: 1080, height: 168 } });
    const tree = list([row], [bar]);
    expect(eyesQuestion(sceneOf(tree), tree, row, undefined)).toMatchObject({ edge: 'bottom', neighbour: { identifier: 'bar' } });
    const wda = { ...tree, unclippedFrames: true as const };
    expect(eyesQuestion(sceneOf(wda), wda, row, undefined)).toBeUndefined();
  });
});

describe('judgeEyes — the band of the surface around the neighbour, read row by row', () => {
  it('k7: 28 px of phone\'s bottom show the bar\'s #F2F2F7, not its own #FFFFFF', async () => {
    const tree = await k7Tree();
    const q = eyesQuestion(sceneOf(tree), tree, byId(tree, 'lab.form-keyboard.phone'), undefined) as EyesQuestion;
    expect(judgeEyes(PNG.sync.read(await k7Png()), 1, q)).toEqual({ sees: 'surface', depth: 28, surface: '#F2F2F7', own: '#FFFFFF' });
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
    const q: EyesQuestion = { tree, node: target, region: target.rect, edge: 'bottom', neighbour: node({ role: 'button', rect: opts.byRect ?? { x: 10, y: 130, width: 80, height: 40 } }) };
    return { png, q };
  };

  it('a 10-px band of the bar\'s grey over its bottom — surface, 10 deep', () => {
    const { png, q } = scene({ bar: [0xf2, 0xf2, 0xf7], barTop: 120 });
    expect(judgeEyes(png, 1, q)).toEqual({ sees: 'surface', depth: 10, surface: '#F2F2F7', own: '#FFFFFF' });
  });

  it('…at scale 2 (a png of twice the tree\'s units): 5 units deep', () => {
    const { png, q } = scene({ bar: [0xf2, 0xf2, 0xf7], barTop: 120 });
    const half = { ...q, region: { x: 5, y: 30, width: 40, height: 35 }, neighbour: { ...q.neighbour, rect: { x: 5, y: 65, width: 40, height: 20 } } };
    expect(judgeEyes(png, 2, half)).toEqual({ sees: 'surface', depth: 5, surface: '#F2F2F7', own: '#FFFFFF' });
  });

  it('a band no deeper than the pixel slack (2) — its own colour to the edge', () => {
    const { png, q } = scene({ bar: [0xf2, 0xf2, 0xf7], barTop: 128 });
    expect(judgeEyes(png, 1, q)).toEqual({ sees: 'own' });
  });

  it('no band at all — its own colour to the edge', () => {
    const { png, q } = scene({ bar: [0xf2, 0xf2, 0xf7], barTop: 130 });
    expect(judgeEyes(png, 1, q)).toEqual({ sees: 'own' });
  });

  it('a bar too close to the target\'s own colour (#FDFDFD on #FFFFFF, ΔE under 2) — unjudged, the two named', () => {
    const { png, q } = scene({ bar: [0xfd, 0xfd, 0xfd], barTop: 120 });
    const answer = judgeEyes(png, 1, q);
    expect(answer).toMatchObject({ sees: 'unjudged' });
    expect(answer.sees === 'unjudged' && answer.why).toMatch(/^its own colour #FFFFFF and that surface's #FDFDFD are too close to tell apart \(ΔE \d\.\d\d\)$/);
  });

  it('a neighbour as wide as the screen — nothing beside it to read the surface from: unjudged', () => {
    const { png, q } = scene({ bar: [0xf2, 0xf2, 0xf7], barTop: 120, byRect: { x: 0, y: 130, width: 100, height: 40 } });
    expect(judgeEyes(png, 1, q)).toEqual({ sees: 'unjudged', why: 'no plain surface beside that node to read its colour from' });
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
    expect(await eyesOn(fake)(q)).toEqual({ sees: 'unjudged', why: 'the screenshot failed: adb: device offline' });
  });
});
