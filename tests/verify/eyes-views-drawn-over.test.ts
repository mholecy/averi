import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { pairQuestion, type OrderPair, type PairQuestion } from '../../src/ui-tree/eyes.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { seenOrderOf, type OrderSeen } from '../../src/ui-tree/seen-order.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { judgeOrder } from '../../src/verify/eyes.js';
import { tagged } from '../helpers/covers.js';
import { parseDump } from '../helpers/android-dumps.js';

/**
 * D84 — views-drawn-over FROM A's SIDE (backlog D77's cell, captured 2026-11-11 on averi_lab, API 33): A
 * `127,303 825x176` and A2 are drawn OVER the later-listed B `182,331 825x121` and B2 (child order; translationZ 8 dp),
 * the frame showing A's own #1E88E5 (A2's #00897B) over the whole overlap. B, a clickable FrameLayout with no text, is
 * no control (role `other`), so before D84 it was a peer of A only when listed BEFORE it: listed after, the draw order
 * made it a cover `drawn` over A, which the eyes are never asked about — A refused as under B, while from B's side A
 * was the untold peer the eyes saw on top: each the other's cover. Now a nested run's later-listed sibling that draws
 * over the target is an untold peer too, of any kind (ui-tree/reading-order.ts#peersOf), and the eyes decide with every
 * guard they had (verify/eyes.ts#judgeOrder) — no screenshot, still refused. ADR 0015's D84 amendment.
 */

const ANDROID = '../fixtures/truth/android-averi_lab-api33';
const file = async (name: string): Promise<Buffer> => readFile(new URL(`${ANDROID}/${name}`, import.meta.url));
const dump = async (): Promise<UiNode> => parseDump((await file('views-drawn-over.xml')).toString('utf8'));
const byId = (t: UiNode, id: string): UiNode => [...everyNode(t)].find((n) => n.identifier === id)!;
const PHONE = { x: 0, y: 0, width: 1080, height: 2220 };
const USABLE = { box: PHONE, boxes: [PHONE], oriented: PHONE, from: 'device' as const };
const cell = (tag: string) => `lab.views-drawn-over.${tag}`;

const questionOf = (t: UiNode, target: UiNode, seen?: readonly OrderSeen[]): PairQuestion | undefined =>
  pairQuestion(t, target, sceneOf(t, seen === undefined ? undefined : seenOrderOf(target, seen)).standing(target, USABLE, { of: 'tap' }));
const pairsOf = (q: PairQuestion | undefined): readonly OrderPair[] => (q?.asks === 'order' ? q.pairs : []);
/** A's exposure on the eyes' answers (none: no screenshot). */
const exposureOf = (t: UiNode, target: UiNode, seen?: readonly OrderSeen[]) =>
  drawOrder(t, seen === undefined ? undefined : seenOrderOf(target, seen)).exposure(target, PHONE);

describe('D84: A and A2, drawn over the later-listed B and B2 — refused unseen, tapped where the eyes see them on top', () => {
  it.each([['A', 'B'], ['A2', 'B2']])('%s, no screenshot: %s, listed later, a cover whose order is untold — refused, no tap point', async (a, b) => {
    const t = await dump();
    const e = exposureOf(t, byId(t, cell(a)));
    expect(tagged(e.covers)).toEqual([{ node: byId(t, cell(b)), order: 'untold', presented: false }]);
    expect(e.tapAt).toBeUndefined();
  });

  it('the eyes are asked about A against B: the overlap 182,331 770x121, A\'s bands left, above and below it, B\'s right of it', async () => {
    const t = await dump();
    const q = questionOf(t, byId(t, cell('A')));
    expect(pairsOf(q).map(({ peer, overlap, nodeBands, peerBands, beside }) => ({ peer: peer.identifier, overlap, nodeBands, peerBands, beside }))).toEqual([
      {
        peer: cell('B'),
        overlap: { x: 182, y: 331, width: 770, height: 121 },
        nodeBands: expect.arrayContaining([{ x: 127, y: 331, width: 55, height: 121 }]),
        peerBands: [{ x: 952, y: 331, width: 55, height: 121 }],
        beside: [
          { x: 0, y: 331, width: 127, height: 121 },
          { x: 1007, y: 331, width: 73, height: 121 },
        ],
      },
    ]);
  });

  it.each([
    ['A', 'B', '#1E88E5', 540, 391],
    ['A2', 'B2', '#00897B', 540, 886],
  ] as const)('the captured frame: %s seen over %s (%s over the whole overlap) — no cover, tapped at its centre', async (a, b, own, x, y) => {
    const t = await dump();
    const target = byId(t, cell(a));
    const answer = judgeOrder(PNG.sync.read(await file('views-drawn-over.png')), 1, questionOf(t, target)!);
    expect(answer).toEqual([{ peer: byId(t, cell(b)), seen: 'over', overlap: own, own, other: expect.any(String) }]);
    const e = exposureOf(t, target, answer);
    expect(e.covers).toEqual([]);
    expect(e.tapAt).toEqual({ point: { x, y }, moved: false });
  });

  it.each([
    ['untold', { seen: 'untold', why: 'the two look alike' }, 'untold'],
    ['under', { seen: 'under', overlap: '#E53935', own: '#1E88E5', other: '#E53935' }, 'seenOver'],
  ] as const)('the eyes answering %s: B stays a cover — refused', async (_n, seen, order) => {
    const t = await dump();
    const [a, b] = [byId(t, cell('A')), byId(t, cell('B'))];
    const e = exposureOf(t, a, [{ peer: b, ...seen } as OrderSeen]);
    expect(tagged(e.covers)).toEqual([{ node: b, order, presented: false }]);
    expect(e.tapAt).toBeUndefined();
  });
});

// Synthetic frames at the cell's geometry (1080x2220, scale 1): the screen white, A blue, B red — and each shape where
// the eyes must NOT lift B.
type Rgb = readonly [number, number, number];
const SCREEN: Rgb = [255, 255, 255];
const BLUE: Rgb = [30, 136, 229];
const RED: Rgb = [229, 57, 53];
const A_RECT: Rect = { x: 127, y: 303, width: 825, height: 176 };
const B_RECT: Rect = { x: 182, y: 331, width: 825, height: 121 };
const OVERLAP: Rect = { x: 182, y: 331, width: 770, height: 121 };
function paint(fills: readonly [Rect, Rgb][]): PNG {
  const img = new PNG({ width: 1080, height: 2220 });
  const put = (r: Rect, [red, g, b]: Rgb) => {
    for (let y = r.y; y < r.y + r.height; y++)
      for (let x = r.x; x < r.x + r.width; x++) {
        const o = (y * 1080 + x) * 4;
        img.data[o] = red;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
  };
  put(PHONE, SCREEN);
  for (const [r, c] of fills) put(r, c);
  return img;
}

describe('D84 negatives at the cell\'s geometry: the later-listed B is lifted only on a frame that tells', () => {
  const judged = async (img: PNG) => {
    const t = await dump();
    const [a, b] = [byId(t, cell('A')), byId(t, cell('B'))];
    const answer = judgeOrder(img, 1, questionOf(t, a)!);
    return { answer, covers: tagged(exposureOf(t, a, answer).covers), b, tapAt: exposureOf(t, a, answer).tapAt };
  };

  it('the painted shape of the capture (A over B): seen over, lifted — the control for every negative below', async () => {
    const { answer, covers } = await judged(paint([[B_RECT, RED], [A_RECT, BLUE]]));
    expect(answer[0]).toMatchObject({ seen: 'over' });
    expect(covers).toEqual([]);
  });

  it('B translucent or drawing nothing (A\'s colour through it, the screen\'s around B past A): untold — B stays a cover', async () => {
    const { answer, covers, b, tapAt } = await judged(paint([[A_RECT, BLUE]]));
    expect(answer).toEqual([{ peer: b, seen: 'untold', why: 'the other shows the colour around it #FFFFFF beside the overlap: it may draw nothing there' }]);
    expect(covers).toEqual([{ node: b, order: 'untold', presented: false }]);
    expect(tapAt).toBeUndefined();
  });

  it('B the same colour as A: untold — B stays a cover', async () => {
    const { answer, covers, b } = await judged(paint([[B_RECT, BLUE], [A_RECT, BLUE]]));
    expect(answer).toEqual([{ peer: b, seen: 'untold', why: expect.stringMatching(/^the two look alike/) }]);
    expect(covers).toEqual([{ node: b, order: 'untold', presented: false }]);
  });

  it('the overlap a blend of the two (B half transparent over A): untold — B stays a cover', async () => {
    const blend: Rgb = [130, 97, 141];
    const { answer, covers, b } = await judged(paint([[B_RECT, RED], [A_RECT, BLUE], [OVERLAP, blend]]));
    expect(answer).toEqual([{ peer: b, seen: 'untold', why: expect.stringMatching(/^the overlap shows neither/) }]);
    expect(covers).toEqual([{ node: b, order: 'untold', presented: false }]);
  });

  // A FrameLayout listed after B (location order kept: the run stays marked), not clickable, holding A's centre
  // (540,391) and reaching below A's bottom (a sibling narrower than A ending above its bottom is A's own content,
  // draw-order.ts#NOT_DRAWN's `onTarget`, excused before and after D84) — what the listing cannot tell from B.
  const withLayer = async (): Promise<UiNode> =>
    parseDump(
      (await file('views-drawn-over.xml'))
        .toString('utf8')
        .replace(
          '<node NAF="true" index="2"',
          '<node index="2" text="" resource-id="lab.layer" class="android.widget.FrameLayout" package="dev.averi.lab" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[400,340][1040,500]" /><node NAF="true" index="2"',
        ),
    );

  it('a later-listed sibling that draws nothing (a touch layer) over A\'s centre, no screenshot: a cover, its order untold — refused', async () => {
    const t = await withLayer();
    expect(byId(t, 'lab.views-drawn-over.run').readingOrder).toBe(true);
    const e = exposureOf(t, byId(t, cell('A')));
    expect(tagged(e.covers)).toEqual([
      { node: byId(t, cell('B')), order: 'untold', presented: false },
      { node: byId(t, 'lab.layer'), order: 'untold', presented: false },
    ]);
    expect(e.tapAt).toBeUndefined();
  });

  it('the same touch layer on the captured shape (A over B, the layer drawing nothing): neither told — each one\'s bands meet the other cover; refused', async () => {
    const t = await withLayer();
    const [a, b, layer] = [byId(t, cell('A')), byId(t, cell('B')), byId(t, 'lab.layer')];
    const answer = judgeOrder(paint([[B_RECT, RED], [A_RECT, BLUE]]), 1, questionOf(t, a)!);
    expect(answer).toEqual([
      { peer: b, seen: 'untold', why: 'no part of the other shows beside the overlap' },
      { peer: layer, seen: 'untold', why: 'no part of it shows beside the overlap' },
    ]);
    const e = exposureOf(t, a, answer);
    expect(tagged(e.covers)).toEqual([
      { node: b, order: 'untold', presented: false },
      { node: layer, order: 'untold', presented: false },
    ]);
    expect(e.tapAt).toBeUndefined();
  });
});
