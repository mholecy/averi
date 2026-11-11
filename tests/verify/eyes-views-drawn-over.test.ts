import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { Rect, UiNode } from '../../src/adapters/types.js';
import { describeScrollResult, scrollUntilVisible } from '../../src/interact/scroll.js';
import { pairQuestion, type OrderPair, type PairQuestion } from '../../src/ui-tree/eyes.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { seenOrderOf, type OrderSeen } from '../../src/ui-tree/seen-order.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { eyesOn, judgeOrder } from '../../src/verify/eyes.js';
import { byId, tagged } from '../helpers/covers.js';
import { parseDump } from '../helpers/android-dumps.js';
import { FakeAdapter } from '../helpers/fake.js';
import { paint, usableOf, type Rgb } from '../helpers/pixels.js';

/**
 * A nested run's sibling listed AFTER the target that draws over it is an untold peer of any kind
 * (ui-tree/reading-order.ts#peersOf): refused with no screenshot, lifted only where the eyes see the target on top
 * (verify/eyes.ts#judgeOrder, every guard it had). Pinned from A's side of the lab's views-drawn-over capture
 * (averi_lab, API 33) at the cell's geometry. The capture and the decision: ADR 0015's D84 amendment.
 */

const ANDROID = '../fixtures/truth/android-averi_lab-api33';
const file = async (name: string): Promise<Buffer> => readFile(new URL(`${ANDROID}/${name}`, import.meta.url));
const xml = async (): Promise<string> => (await file('views-drawn-over.xml')).toString('utf8');
const dump = async (): Promise<UiNode> => parseDump(await xml());
const PHONE = { x: 0, y: 0, width: 1080, height: 2220 };
const USABLE = usableOf(PHONE);
const cell = (tag: string) => `lab.views-drawn-over.${tag}`;

/** The capture with one more FrameLayout listed after B (location order kept: the run stays marked), not clickable. */
const withSibling = async (id: string, bounds: string): Promise<UiNode> =>
  parseDump(
    (await xml()).replace(
      '<node NAF="true" index="2"',
      `<node index="2" text="" resource-id="${id}" class="android.widget.FrameLayout" package="dev.averi.lab" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="${bounds}" /><node NAF="true" index="2"`,
    ),
  );

const questionOf = (t: UiNode, target: UiNode, seen?: readonly OrderSeen[]): PairQuestion | undefined =>
  pairQuestion(t, target, sceneOf(t, seen === undefined ? undefined : seenOrderOf(target, seen)).standing(target, USABLE, { of: 'tap' }));
const pairsOf = (q: PairQuestion | undefined): readonly OrderPair[] => (q?.asks === 'order' ? q.pairs : []);
/** The target's exposure on the eyes' answers (none: no screenshot). */
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

describe('D84 through scroll_until on the capture: A stops where it stands', () => {
  const A = `id:"${cell('A')}"`;
  const FAST = { maxSwipes: 4, timeoutMs: 2_000, settleMs: 1 };
  const fake = async (): Promise<FakeAdapter> => {
    const f = new FakeAdapter({ s: await dump() }, 's');
    f.viewportSize = { width: 1080, height: 2220 };
    f.nextScreenshot = await file('views-drawn-over.png');
    return f;
  };

  it('with the eyes: fully visible after 0 swipes — one screenshot, no stroke', async () => {
    const f = await fake();
    expect(describeScrollResult(await scrollUntilVisible(f, A, { ...FAST, eyes: eyesOn(f) }))).toBe('fully visible after 0 swipes');
    expect(f.swipes).toEqual([]);
    expect(f.screenshots).toHaveLength(1);
  });

  it('without the eyes: stopped before any swipe, B named as overlapping it, its order not told', async () => {
    const f = await fake();
    const failure = (await scrollUntilVisible(f, A, FAST).catch((e: unknown) => e)) as Error;
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toMatch(new RegExp(`^scroll_until ${A.replace(/[.]/g, '\\.')} stopped before any swipe — element is in the viewport but overlapped by other id:${cell('B').replace(/[.]/g, '\\.')} `));
    expect(f.swipes).toEqual([]);
    expect(f.screenshots).toEqual([]);
  });
});

// Synthetic frames at the cell's geometry (1080x2220, scale 1): the screen white, A blue, B red — and each shape where
// the eyes must NOT lift B.
const WHITE: Rgb = [255, 255, 255];
const BLUE: Rgb = [30, 136, 229];
const RED: Rgb = [229, 57, 53];
const A_RECT: Rect = { x: 127, y: 303, width: 825, height: 176 };
const B_RECT: Rect = { x: 182, y: 331, width: 825, height: 121 };
const OVERLAP: Rect = { x: 182, y: 331, width: 770, height: 121 };
const frame = (fills: readonly (readonly [Rect, Rgb])[]): PNG => paint(PHONE, WHITE, fills);

describe('D84 negatives at the cell\'s geometry: the later-listed B is lifted only on a frame that tells', () => {
  const judged = async (img: PNG) => {
    const t = await dump();
    const [a, b] = [byId(t, cell('A')), byId(t, cell('B'))];
    const answer = judgeOrder(img, 1, questionOf(t, a)!);
    const e = exposureOf(t, a, answer);
    return { answer, covers: tagged(e.covers), b, tapAt: e.tapAt };
  };

  it('the painted shape of the capture (A over B): seen over, lifted — the control for every negative below', async () => {
    const { answer, covers } = await judged(frame([[B_RECT, RED], [A_RECT, BLUE]]));
    expect(answer[0]).toMatchObject({ seen: 'over' });
    expect(covers).toEqual([]);
  });

  it('B translucent or drawing nothing (A\'s colour through it, the screen\'s around B past A): untold — B stays a cover', async () => {
    const { answer, covers, b, tapAt } = await judged(frame([[A_RECT, BLUE]]));
    expect(answer).toEqual([{ peer: b, seen: 'untold', why: 'the other shows the colour around it #FFFFFF beside the overlap: it may draw nothing there' }]);
    expect(covers).toEqual([{ node: b, order: 'untold', presented: false }]);
    expect(tapAt).toBeUndefined();
  });

  it('B the same colour as A: untold — B stays a cover', async () => {
    const { answer, covers, b } = await judged(frame([[B_RECT, BLUE], [A_RECT, BLUE]]));
    expect(answer).toEqual([{ peer: b, seen: 'untold', why: expect.stringMatching(/^the two look alike/) }]);
    expect(covers).toEqual([{ node: b, order: 'untold', presented: false }]);
  });

  it('the overlap a blend of the two (B half transparent over A): untold — B stays a cover', async () => {
    const blend: Rgb = [130, 97, 141];
    const { answer, covers, b } = await judged(frame([[B_RECT, RED], [A_RECT, BLUE], [OVERLAP, blend]]));
    expect(answer).toEqual([{ peer: b, seen: 'untold', why: expect.stringMatching(/^the overlap shows neither/) }]);
    expect(covers).toEqual([{ node: b, order: 'untold', presented: false }]);
  });

  // A touch layer holding A's centre (540,391) and reaching below A's bottom (a sibling narrower than A ending above
  // its bottom is A's own content, draw-order.ts#NOT_DRAWN's `onTarget`, excused before and after D84) — what the
  // listing cannot tell from B.
  const withLayer = (): Promise<UiNode> => withSibling('lab.layer', '[400,340][1040,500]');

  it('a later-listed sibling that draws nothing (a touch layer) over A\'s centre, no screenshot: a cover, its order untold — refused', async () => {
    const t = await withLayer();
    expect(byId(t, cell('run')).readingOrder).toBe(true);
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
    const answer = judgeOrder(frame([[B_RECT, RED], [A_RECT, BLUE]]), 1, questionOf(t, a)!);
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

// A later-listed sibling over A's bottom-right corner, below B, clear of A's centre (540,391): the listing's peer, but
// not `after`'s (it holds no centre), so no untold cover — the draw order's own `drawn` cover, which the eyes are never
// asked about.
describe('D84: a later-listed sibling clear of the target\'s centre stays the draw order\'s `drawn` cover, the eyes not asked', () => {
  const withCorner = (): Promise<UiNode> => withSibling('lab.corner', '[900,455][1040,500]');

  it('no screenshot: B untold, the corner drawn', async () => {
    const t = await withCorner();
    expect(byId(t, cell('run')).readingOrder).toBe(true);
    expect(tagged(exposureOf(t, byId(t, cell('A'))).covers)).toEqual([
      { node: byId(t, cell('B')), order: 'untold', presented: false },
      { node: byId(t, 'lab.corner'), order: 'drawn', presented: false },
    ]);
  });

  it('the eyes are asked about B alone; on the captured frame B is lifted and the corner stays drawn — A tapped at its centre, clear of it', async () => {
    const t = await withCorner();
    const a = byId(t, cell('A'));
    const q = questionOf(t, a)!;
    expect(pairsOf(q).map((p) => p.peer.identifier)).toEqual([cell('B')]);
    const answer = judgeOrder(PNG.sync.read(await file('views-drawn-over.png')), 1, q);
    expect(answer.map((s) => [s.peer.identifier, s.seen])).toEqual([[cell('B'), 'over']]);
    const e = exposureOf(t, a, answer);
    expect(tagged(e.covers)).toEqual([{ node: byId(t, 'lab.corner'), order: 'drawn', presented: false }]);
    expect(e.tapAt).toEqual({ point: { x: 540, y: 391 }, moved: false });
  });
});
