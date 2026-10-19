import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { orderQuestion, type OrderPair, type OrderQuestion } from '../../src/ui-tree/eyes.js';
import { seenOrderOf } from '../../src/ui-tree/seen-order.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { eyesOn, judgeOrder } from '../../src/verify/eyes.js';
import { FakeAdapter, node } from '../helpers/fake.js';
import { Verifier } from '../../src/verify/assert.js';

/**
 * THE EYES TELL THE ORDER (ui-tree/eyes.ts#orderQuestion, verify/eyes.ts#judgeOrder) over the lab's real blur-menu
 * captures — the menu row W drawn over the row C beneath it, both listed in reading order (iOS 27, 402x874 pt, the png
 * 1206x2622) — and synthetic pngs for every way the judge can only answer `untold`.
 * docs/adr/0024-the-eyes-tell-the-order-of-two-controls-listed-in-reading-order.md
 */

const IOS = '../fixtures/truth/ios-iphone17-ios27';
const file = async (name: string): Promise<Buffer> => readFile(new URL(`${IOS}/${name}`, import.meta.url));
const png = async (name: string) => PNG.sync.read(await file(name));
const byId = (tree: UiNode, id: string): UiNode => [...everyNode(tree)].find((n) => n.identifier === id)!;
const USABLE = { box: { x: 0, y: 0, width: 402, height: 874 }, boxes: [{ x: 0, y: 0, width: 402, height: 874 }], oriented: { x: 0, y: 0, width: 402, height: 874 }, from: 'device' as const };

const questionOf = (tree: UiNode, id: string): OrderQuestion | undefined => {
  const target = byId(tree, id);
  return orderQuestion(tree, target, sceneOf(tree).standing(target, USABLE, { of: 'tap' }));
};

describe('the order question — asked of a standing covered by a cover the listing does not order', () => {
  it.each([
    ['blur-menu.idb.json', async () => parseIdbDescribeAll((await file('blur-menu.idb.json')).toString('utf8'))],
    ['blur-menu.wda.json', async () => parseWdaSource((await file('blur-menu.wda.json')).toString('utf8'))],
  ])('%s: W against C — the overlap, W\'s band above it, C\'s below, the screen left and right of both', async (_n, tree) => {
    const t = await tree();
    const q = questionOf(t, 'lab.blur-menu.W');
    expect(q?.pairs.map(({ peer, ...rects }) => ({ peer: peer.identifier, ...rects }))).toEqual([
      {
        peer: 'lab.blur-menu.C',
        overlap: { x: 51, y: 470, width: 300, height: 42 },
        nodeBands: [{ x: 51, y: 448, width: 300, height: 22 }],
        peerBands: [{ x: 51, y: 512, width: 300, height: 22 }],
        beside: [
          { x: 0, y: 470, width: 51, height: 42 },
          { x: 351, y: 470, width: 51, height: 42 },
        ],
      },
    ]);
  });

  it('each band no deeper than the overlap: a tall card over a row, the card read next to the overlap, not at its far top', () => {
    const card = node({ role: 'button', label: 'Card', rect: { x: 51, y: 300, width: 300, height: 212 } });
    const row = node({ role: 'button', label: 'Row', rect: { x: 51, y: 470, width: 300, height: 64 } });
    const t = node({ role: 'other', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [node({ role: 'other', rect: { x: 0, y: 0, width: 402, height: 874 }, readingOrder: true, children: [card, row] })] });
    const q = orderQuestion(t, row, sceneOf(t).standing(row, USABLE, { of: 'tap' }));
    expect(q?.pairs.map(({ nodeBands, peerBands }) => ({ nodeBands, peerBands }))).toEqual([
      { nodeBands: [{ x: 51, y: 512, width: 300, height: 22 }], peerBands: [{ x: 51, y: 428, width: 300, height: 42 }] },
    ]);
  });

  it('a standing judged again on what the eyes saw asks nothing again — untold, said why', async () => {
    const t = parseIdbDescribeAll((await file('blur-menu.idb.json')).toString('utf8'));
    const w = byId(t, 'lab.blur-menu.W');
    const seen = seenOrderOf(w, [{ peer: byId(t, 'lab.blur-menu.C'), seen: 'untold', why: 'the two look alike (ΔE 3.10)' }]);
    const standing = sceneOf(t, seen).standing(w, USABLE, { of: 'tap' });
    expect(standing).toMatchObject({ kind: 'covered', remedy: { of: 'unordered', untold: 'the two look alike (ΔE 3.10)' } });
    expect(orderQuestion(t, w, standing)).toBeUndefined();
  });

  it("mp-native's chooser (ADR 0015's capture): a band another cover of the target meets is not read — Loan repayment's band above SWIFT payment lies on To my account", async () => {
    const MODAL = JSON.parse(await readFile(new URL('../fixtures/idb-modal-listed-before-content.json', import.meta.url), 'utf8')) as { screens: Record<string, unknown[]> };
    const t = parseIdbDescribeAll(JSON.stringify(MODAL.screens.chooser));
    const row = [...everyNode(t)].find((n) => n.label?.startsWith('Loan repayment'))!;
    const q = orderQuestion(t, row, sceneOf(t).standing(row, USABLE, { of: 'tap' }));
    const swift = q?.pairs.find((p) => p.peer.label === 'SWIFT payment');
    expect(swift).toMatchObject({
      overlap: { x: 45, y: 453, width: 312, height: 34 },
      nodeBands: [
        { x: 24, y: 453, width: 21, height: 34 },
        { x: 357, y: 453, width: 21, height: 34 },
      ],
      peerBands: [{ x: 45, y: 487, width: 312, height: 18 }],
    });
  });

  it('a standing not covered by an unordered cover asks nothing: A, beneath the blur, no tree listing anything over it', async () => {
    const t = parseIdbDescribeAll((await file('blur-menu.idb.json')).toString('utf8'));
    expect(questionOf(t, 'lab.blur-menu.A')).toBeUndefined();
  });
});

describe('the judge over the lab captures — W is drawn over C', () => {
  it.each([
    ['blur-menu', 'blur-menu.idb.json', 'lab.blur-menu'],
    ['blur-menu-grouped', 'blur-menu-grouped.idb.json', 'lab.blur-menu-grouped'],
  ])('%s.png: asked of C, C is seen under W', async (cell, json, prefix) => {
    const t = parseIdbDescribeAll((await file(json)).toString('utf8'));
    const q = questionOf(t, `${prefix}.C`)!;
    expect(judgeOrder(await png(`${cell}.png`), 3, q)).toEqual([{ peer: byId(t, `${prefix}.W`), seen: 'under', overlap: '#00897B', own: '#347937', other: '#00897B' }]);
  });

  it('blur-menu.png: asked of W, W is seen over C', async () => {
    const t = parseIdbDescribeAll((await file('blur-menu.idb.json')).toString('utf8'));
    const q = questionOf(t, 'lab.blur-menu.W')!;
    expect(judgeOrder(await png('blur-menu.png'), 3, q)).toEqual([{ peer: byId(t, 'lab.blur-menu.C'), seen: 'over', overlap: '#00897B', own: '#00897B', other: '#347937' }]);
  });

  it('eyesOn: one screenshot, scaled against the tree, the same answer', async () => {
    const t = parseIdbDescribeAll((await file('blur-menu.idb.json')).toString('utf8'));
    const q = questionOf(t, 'lab.blur-menu.W')!;
    let shots = 0;
    const shot = await file('blur-menu.png');
    const eyes = eyesOn({ screenshot: async () => (shots++, shot), viewport: async () => ({ width: 402, height: 874 }) });
    expect((await eyes.order(q)).map((s) => s.seen)).toEqual(['over']);
    expect(shots).toBe(1);
  });

  it('eyesOn never throws: a screenshot that fails is every pair untold, said why', async () => {
    const t = parseIdbDescribeAll((await file('blur-menu.idb.json')).toString('utf8'));
    const q = questionOf(t, 'lab.blur-menu.W')!;
    const eyes = eyesOn({ screenshot: async () => { throw new Error('device offline\nmore'); }, viewport: async () => ({ width: 402, height: 874 }) });
    expect(await eyes.order(q)).toEqual([{ peer: byId(t, 'lab.blur-menu.C'), seen: 'untold', why: 'the screenshot failed: device offline' }]);
    const garbage = eyesOn({ screenshot: async () => Buffer.from('not a png'), viewport: async () => ({ width: 402, height: 874 }) });
    expect((await garbage.order(q))[0]).toMatchObject({ seen: 'untold', why: expect.stringMatching(/^the screenshot did not decode: /) });
  });
});

// Synthetic: a 402x874 png at scale 1, the screen grey, W over C as on the lab's menu — then each untold shape.
const SCREEN = [190, 190, 190] as const;
const TEAL = [0, 137, 123] as const;
const GREEN = [52, 121, 55] as const;
type Rgb = readonly [number, number, number];
function paint(fills: readonly [Rect, Rgb][]): PNG {
  const img = new PNG({ width: 402, height: 874 });
  const put = (r: Rect, [red, g, b]: Rgb) => {
    for (let y = r.y; y < r.y + r.height; y++)
      for (let x = r.x; x < r.x + r.width; x++) {
        const o = (y * 402 + x) * 4;
        img.data[o] = red;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
  };
  put({ x: 0, y: 0, width: 402, height: 874 }, SCREEN);
  for (const [r, c] of fills) put(r, c);
  return img;
}
const W = { x: 51, y: 448, width: 300, height: 64 };
const C = { x: 51, y: 470, width: 300, height: 64 };
const peer = node({ role: 'button', label: 'C', rect: C });
const target = node({ role: 'button', label: 'W', rect: W });
const PAIR: OrderPair = {
  peer,
  overlap: { x: 51, y: 470, width: 300, height: 42 },
  nodeBands: [{ x: 51, y: 448, width: 300, height: 22 }],
  peerBands: [{ x: 51, y: 512, width: 300, height: 22 }],
  beside: [
    { x: 0, y: 470, width: 51, height: 42 },
    { x: 351, y: 470, width: 51, height: 42 },
  ],
};
const ask = (pair: Partial<OrderPair> = {}): OrderQuestion => ({ tree: node({ role: 'other', rect: { x: 0, y: 0, width: 402, height: 874 } }), node: target, pairs: [{ ...PAIR, ...pair }] });
const seenOf = (img: PNG, q: OrderQuestion = ask()) => {
  const [answer] = judgeOrder(img, 1, q);
  return answer!.seen === 'untold' ? { untold: answer!.why } : { seen: answer!.seen };
};

describe('the judge — every rule can only answer untold', () => {
  it('W over C, painted: told', () => {
    expect(seenOf(paint([[C, GREEN], [W, TEAL]]))).toEqual({ seen: 'over' });
    expect(seenOf(paint([[W, TEAL], [C, GREEN]]))).toEqual({ seen: 'under' });
  });

  it('the two look alike (a white menu row over a white row, no dim): untold', () => {
    expect(seenOf(paint([[C, [250, 250, 250]], [W, [255, 255, 255]]]))).toEqual({ untold: expect.stringMatching(/^the two look alike \(ΔE \d+\.\d\d\)$/) });
  });

  it('the peer shows the screen\'s own colour beside the overlap (a text-only button over the row: it may draw nothing there): untold — the unsafe direction guarded', () => {
    // The row W is the target, a background-less button C over it: the overlap shows W's colour through C.
    expect(seenOf(paint([[W, TEAL]]))).toEqual({ untold: "the other shows the screen's own colour #BEBEBE beside the overlap: it may draw nothing there" });
  });

  it('its bands disagree (the chooser\'s shape: a gap band of another surface, side bands its own): untold', () => {
    const q = ask({ nodeBands: [{ x: 51, y: 448, width: 300, height: 22 }, { x: 20, y: 470, width: 31, height: 42 }] });
    const img = paint([[{ x: 20, y: 448, width: 331, height: 64 }, [255, 255, 255]], [C, GREEN], [W, TEAL]]);
    expect(seenOf(img, q)).toEqual({ untold: 'it is not one colour beside the overlap' });
  });

  it.each([
    ['half way', [26, 129, 89]],
    ['nearer W', [13, 133, 106]],
    ['nearer C', [39, 125, 72]],
  ] as const)('the overlap shows a blend of the two (a frame mid-fade, %s): untold', (_n, blend) => {
    const img = paint([[W, TEAL], [C, GREEN], [PAIR.overlap, blend]]);
    expect(seenOf(img)).toEqual({ untold: expect.stringMatching(/^the overlap shows neither \(ΔE \d+\.\d\d to it, \d+\.\d\d to the other\)$/) });
  });

  it('no band of it thicker than an antialiased edge: untold', () => {
    const q = ask({ nodeBands: [{ x: 51, y: 467, width: 300, height: 3 }] });
    expect(seenOf(paint([[C, GREEN], [W, TEAL]]), q)).toEqual({ untold: 'no part of it shows beside the overlap' });
    expect(seenOf(paint([[C, GREEN], [W, TEAL]]), ask({ peerBands: [] }))).toEqual({ untold: 'no part of the other shows beside the overlap' });
  });

  it('an overlap of no one colour (a row of text and icons over it): untold', () => {
    const stripes: [Rect, Rgb][] = [0, 1, 2].flatMap((k) =>
      Array.from({ length: 14 }, (_, i): [Rect, Rgb] => [{ x: 51, y: 470 + i * 3 + k, width: 300, height: 1 }, k === 0 ? TEAL : k === 1 ? [255, 255, 255] : [20, 20, 20]]),
    );
    expect(seenOf(paint([[C, GREEN], [W, TEAL], ...stripes]))).toEqual({ untold: 'the overlap is not one colour' });
  });

  it('no screen beside the two (rows as wide as the screen): untold', () => {
    expect(seenOf(paint([[C, GREEN], [W, TEAL]]), ask({ beside: [] }))).toEqual({ untold: 'no screen beside the two to tell a drawn surface from' });
  });
});

// The colour assert answers the order question from the frame it captures anyway (verify/pixel-poll.ts#pollPixels):
// W, covered by C in the listing and seen on top, costs one round's settled pair — what any measured element costs.
describe('the colour assert — the order seen on the frame it measures, no capture added', () => {
  const assertOn = async (id: string) => {
    const t = parseIdbDescribeAll((await file('blur-menu.idb.json')).toString('utf8'));
    const fake = new FakeAdapter({ menu: t }, 'menu');
    fake.viewportSize = { width: 402, height: 874 };
    fake.nextScreenshot = await file('blur-menu.png');
    const result = await new Verifier(fake, { pollMs: 5, timeoutMs: 2_000 }).assert({ element: { id }, color: { expected: '#00897B' } });
    return { result, captures: fake.screenshots.length };
  };

  it('W passes on its own teal in one round: the settled pair, two captures', async () => {
    const w = await assertOn('lab.blur-menu.W');
    expect(w.result).toMatchObject({ pass: true, detail: expect.stringContaining('sampled #00897B') });
    expect(w.captures).toBe(2);
  });
});
