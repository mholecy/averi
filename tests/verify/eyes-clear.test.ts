import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { orderQuestion, type OrderQuestion } from '../../src/ui-tree/eyes.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { measuredFrameFor, type RgbaImage } from '../../src/verify/capture.js';
import { judgeOrder, orderOfFrame } from '../../src/verify/eyes.js';
import { parseDump } from '../helpers/android-dumps.js';

/**
 * THE OVERLAP SEEN CLEAR (verify/eyes.ts#judgeClear): does a text the tree suspects lies in a control's touch margin
 * (ui-tree/cover.ts#marginText) paint anything over the control where they overlap? Over the lab's real Android captures
 * (averi_lab, 1080x2220, one png pixel per tree unit): the next field's title over a field's dumped bottom, every pixel
 * of the overlap #FFFFFF as the field's own rows beside the title — and the same pngs painted where a text would draw.
 * docs/bugs/2026-10-19-lab-android-fully-true-on-phone-after-back-refused-under-the-next-fields-title-its-touch-target-overlaps.md
 */
const fixtures = new URL('../fixtures/', import.meta.url);
const TRUTH = 'truth/android-averi_lab-api33/';
const BOX = { x: 0, y: 0, width: 1080, height: 2220 };
const SCREEN = { box: BOX, boxes: [BOX], statusBand: 66, oriented: BOX, from: 'device' as const };
const capture = (name: string): { tree: UiNode; png: RgbaImage } => ({
  tree: parseDump(readFileSync(new URL(`${name}.xml`, fixtures), 'utf8')),
  png: PNG.sync.read(readFileSync(new URL(`${name}.png`, fixtures))),
});
/** The clear question `fully: true` on the control `id` asks (ui-tree/eyes.ts#orderQuestion). */
const questionOf = (tree: UiNode, id: string): OrderQuestion => {
  const target = [...everyNode(tree)].find((n) => n.identifier === id && n.role !== 'text')!;
  const q = orderQuestion(tree, target, sceneOf(tree).standing(target, SCREEN, { of: 'fully' }));
  if (q?.asks !== 'clear') throw new Error(`no clear question of ${id}`);
  return q;
};
const seenOf = (png: RgbaImage, q: OrderQuestion) => judgeOrder(png, 1, q).map(({ peer: _peer, ...seen }) => seen);
/** `png` copied, `rect` painted `rgb` — every `step`-th column only when given (a striped strip). */
const painted = (png: RgbaImage, rect: Rect, rgb: readonly [number, number, number], step = 1): RgbaImage => {
  const data = Buffer.from(png.data);
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x += step) data.set([...rgb, 255], (y * png.width + x) * 4);
  }
  return { ...png, data };
};

describe('judgeClear — the overlap against the control\'s own rows beside the text, one png', () => {
  it('form-keyboard, street ← city.title (860–866): clear', () => {
    const { tree, png } = capture(`${TRUTH}form-keyboard`);
    const q = questionOf(tree, 'lab.form-keyboard.street');
    expect(q.pairs.map((p) => p.overlap)).toEqual([{ x: 55, y: 860, width: 175, height: 6 }]);
    expect(seenOf(png, q)).toEqual([{ seen: 'clear', overlap: '#FFFFFF', beside: '#FFFFFF' }]);
  });

  it("k7's stop, the same pair at 693–699: clear", () => {
    const { tree, png } = capture('android-lab-form-keyboard-k7-stop');
    const q = questionOf(tree, 'lab.form-keyboard.street');
    expect(q.pairs.map((p) => p.overlap)).toEqual([{ x: 55, y: 693, width: 175, height: 6 }]);
    expect(seenOf(png, q)).toEqual([{ seen: 'clear', overlap: '#FFFFFF', beside: '#FFFFFF' }]);
  });

  describe('form-errors, name ← its error text, an 11-px band (491–502)', () => {
    const { tree, png } = capture(`${TRUTH}form-errors`);
    const q = questionOf(tree, 'lab.form-errors.name');
    const [overlap] = q.pairs.map((p) => p.overlap) as [Rect];
    const [beside] = q.pairs.flatMap((p) => ('beside' in p ? p.beside : [])) as [Rect];

    it('as captured: clear', () => {
      expect(overlap).toEqual({ x: 55, y: 491, width: 440, height: 11 });
      expect(seenOf(png, q)).toEqual([{ seen: 'clear', overlap: '#FFFFFF', beside: '#FFFFFF' }]);
    });

    it('a 1-px dark line of ink across the band: under — the strict count, not a share of a line', () => {
      expect(seenOf(painted(png, { x: 100, y: 496, width: 300, height: 1 }, [40, 40, 40]), q)).toMatchObject([{ seen: 'under', own: '#FFFFFF' }]);
    });

    it('the band painted #F2F2F7 over the white (a text background): under', () => {
      expect(seenOf(painted(png, overlap, [0xf2, 0xf2, 0xf7]), q)).toEqual([{ seen: 'under', overlap: '#F2F2F7', own: '#FFFFFF', other: '#F2F2F7' }]);
    });

    it('the rows beside it striped: no plain colour to compare with — untold', () => {
      expect(seenOf(painted(png, beside, [0, 0, 0], 2), q)).toMatchObject([{ seen: 'untold', why: expect.stringContaining('not one colour') }]);
    });

    it('a 1-px line the field draws across its rows beside the text, missing from the overlap (what a text background hides): untold — the beside rows held as strictly as the overlap', () => {
      const besides = q.pairs.flatMap((p) => ('beside' in p ? p.beside : []));
      const lined = besides.reduce((at, b) => painted(at, { x: b.x, y: 496, width: b.width, height: 1 }, [40, 40, 40]), png);
      expect(seenOf(lined, q)).toMatchObject([{ seen: 'untold', why: expect.stringContaining('not one colour') }]);
      const grey = besides.reduce((at, b) => painted(at, { x: b.x, y: 501, width: b.width, height: 1 }, [0xbd, 0xbd, 0xbd]), png);
      expect(seenOf(grey, q)).toMatchObject([{ seen: 'untold' }]);
    });

    it('a frame whose scale the tree refuses: untold, said why', () => {
      const half = new PNG({ width: 700, height: 2220 });
      expect(orderOfFrame(measuredFrameFor(tree, half, { width: 1080, height: 2220 }), q).map((s) => s.seen)).toEqual(['untold']);
    });
  });
});
