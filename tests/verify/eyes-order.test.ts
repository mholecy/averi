import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { orderQuestion, type AroundStrip, type OrderPair, type OrderQuestion } from '../../src/ui-tree/eyes.js';
import type { Edge } from '../../src/ui-tree/geometry.js';
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
/** A strip around a control (ui-tree/eyes.ts#AroundStrip): its rect and the edge of it against the control. */
const strip = (x: number, y: number, width: number, height: number, against: Edge): AroundStrip => ({ rect: { x, y, width, height }, against });
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
        nodeAround: [strip(51, 426, 300, 22, 'bottom'), strip(29, 448, 22, 22, 'right'), strip(351, 448, 22, 22, 'left')],
        peerAround: [strip(51, 534, 300, 22, 'top'), strip(29, 512, 22, 22, 'right'), strip(351, 512, 22, 22, 'left')],
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
    expect(q?.pairs.map(({ nodeBands, peerBands, nodeAround, peerAround }) => ({ nodeBands, peerBands, nodeAround, peerAround }))).toEqual([
      {
        nodeBands: [{ x: 51, y: 512, width: 300, height: 22 }],
        peerBands: [{ x: 51, y: 428, width: 300, height: 42 }],
        // Around each control, as deep as its band: past the edge the band faces (below the row, above the card's top),
        // and sideways on the band's rows past its left and right edges.
        nodeAround: [strip(51, 534, 300, 22, 'top'), strip(29, 512, 22, 22, 'right'), strip(351, 512, 22, 22, 'left')],
        peerAround: [strip(51, 258, 300, 42, 'bottom'), strip(9, 428, 42, 42, 'right'), strip(351, 428, 42, 42, 'left')],
      },
    ]);
  });

  it('a standing judged again on what the eyes saw asks nothing again — untold, said why', async () => {
    const t = parseIdbDescribeAll((await file('blur-menu.idb.json')).toString('utf8'));
    const w = byId(t, 'lab.blur-menu.W');
    const seen = seenOrderOf(w, [{ peer: byId(t, 'lab.blur-menu.C'), seen: 'untold', why: 'the two look alike (ΔE 3.10)' }]);
    const standing = sceneOf(t, seen).standing(w, USABLE, { of: 'tap' });
    expect(standing).toMatchObject({ kind: 'covered', remedy: { of: 'unordered', why: 'the two look alike (ΔE 3.10)' } });
    expect(orderQuestion(t, w, standing)).toBeUndefined();
  });

  it('a horizontal overlap: bands left and right of it, each with the strip ahead past its control\'s side edge and the two above and below it on the band\'s columns', () => {
    const left = node({ role: 'button', label: 'Left', rect: { x: 51, y: 470, width: 200, height: 64 } });
    const right = node({ role: 'button', label: 'Right', rect: { x: 121, y: 470, width: 230, height: 64 } });
    const t = node({ role: 'other', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [node({ role: 'other', rect: { x: 0, y: 0, width: 402, height: 874 }, readingOrder: true, children: [left, right] })] });
    // Judged for the colour assert, over its whole rect: a tap would move to Left's clear 70-pt part.
    const q = orderQuestion(t, left, sceneOf(t).standing(left, USABLE, { of: 'pixel', reads: (r) => r, glyphs: false }));
    expect(q?.pairs.map(({ overlap, nodeBands, peerBands, nodeAround, peerAround }) => ({ overlap, nodeBands, peerBands, nodeAround, peerAround }))).toEqual([
      {
        overlap: { x: 121, y: 470, width: 130, height: 64 },
        nodeBands: [{ x: 51, y: 470, width: 70, height: 64 }],
        peerBands: [{ x: 251, y: 470, width: 100, height: 64 }],
        nodeAround: [strip(0, 470, 51, 64, 'right'), strip(51, 400, 70, 70, 'bottom'), strip(51, 534, 70, 70, 'top')],
        peerAround: [strip(351, 470, 51, 64, 'left'), strip(251, 370, 100, 100, 'bottom'), strip(251, 534, 100, 100, 'top')],
      },
    ]);
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
  nodeAround: [strip(51, 426, 300, 22, 'bottom'), strip(29, 448, 22, 22, 'right'), strip(351, 448, 22, 22, 'left')],
  peerAround: [strip(51, 534, 300, 22, 'top'), strip(29, 512, 22, 22, 'right'), strip(351, 512, 22, 22, 'left')],
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

describe('the judge — each rule answers untold where its evidence is missing', () => {
  it('W over C, painted: told', () => {
    expect(seenOf(paint([[C, GREEN], [W, TEAL]]))).toEqual({ seen: 'over' });
    expect(seenOf(paint([[W, TEAL], [C, GREEN]]))).toEqual({ seen: 'under' });
  });

  it('the two look alike (a white menu row over a white row, no dim): untold', () => {
    expect(seenOf(paint([[C, [250, 250, 250]], [W, [255, 255, 255]]]))).toEqual({ untold: expect.stringMatching(/^the two look alike \(ΔE \d+\.\d\d\)$/) });
  });

  it('the peer shows the screen\'s own colour beside the overlap (a text-only button over the row: it may draw nothing there): untold — the unsafe direction guarded', () => {
    // The row W is the target, a background-less button C over it: the overlap shows W's colour through C.
    expect(seenOf(paint([[W, TEAL]]))).toEqual({ untold: 'the other shows the colour around it #BEBEBE beside the overlap: it may draw nothing there' });
  });

  it('the peer is a text-only button whose band lies over an inset card (not the screen\'s colour): untold — the card runs on past its edge', () => {
    // W, the target, drawn under a background-less C: the overlap shows W's teal through C, C's band the white card
    // (x 40..362, inset: the screen beside the two stays grey). Read only against the screen, W would read on top.
    const card: [Rect, Rgb] = [{ x: 40, y: 500, width: 322, height: 120 }, [255, 255, 255]];
    expect(seenOf(paint([card, [W, TEAL]]))).toEqual({ untold: 'the other shows the colour around it #FFFFFF beside the overlap: it may draw nothing there' });
    // A card that ends 6 pt past C's edge: a quarter of the strip around C is enough.
    expect(seenOf(paint([[{ x: 40, y: 500, width: 322, height: 40 }, [255, 255, 255]], [W, TEAL]]))).toEqual({ untold: 'the other shows the colour around it #FFFFFF beside the overlap: it may draw nothing there' });
    // A card flush with C's far edge that runs on 11 pt sideways past C, both sides or one: the strips beside C's band.
    for (const card of [{ x: 40, y: 500, width: 322, height: 34 }, { x: 51, y: 500, width: 311, height: 34 }]) {
      expect(seenOf(paint([[card, [255, 255, 255]], [W, TEAL]]))).toEqual({ untold: 'the other shows the colour around it #FFFFFF beside the overlap: it may draw nothing there' });
    }
    // The same card under an opaque C of its own colour: told, C's band its own green, the card around it white.
    expect(seenOf(paint([card, [C, GREEN], [W, TEAL]]))).toEqual({ seen: 'over' });
  });

  it('the target is a text-only button over a row the other draws: untold — its band shows the surface around it', () => {
    // C, the peer, drawn opaque; W draws nothing — its band and the strip above it are both the card's white.
    const card: [Rect, Rgb] = [{ x: 40, y: 380, width: 322, height: 100 }, [255, 255, 255]];
    expect(seenOf(paint([card, [C, GREEN]]))).toEqual({ untold: 'it shows the colour around it #FFFFFF beside the overlap: it may draw nothing there' });
  });

  it('nothing around a control past its edge on the screen: untold', () => {
    expect(seenOf(paint([[C, GREEN], [W, TEAL]]), ask({ peerAround: [] }))).toEqual({ untold: 'nothing around the other past its edge to tell a drawn surface from' });
  });

  it('RESIDUAL: a peer on top drawn in two tones split exactly at the target\'s edge, its part over the overlap the target\'s own colour, reads as the target on top — pixel for pixel the same frame', () => {
    expect(seenOf(paint([[W, TEAL], [C, GREEN], [PAIR.overlap, TEAL]]))).toEqual({ seen: 'over' });
  });

  it('RESIDUAL: a text-only peer over a surface its own frame or a pixel more reads as the target on top — that pixel is the antialiasing every strip skips', () => {
    expect(seenOf(paint([[C, [255, 255, 255]], [W, TEAL]]))).toEqual({ seen: 'over' });
    expect(seenOf(paint([[{ x: 50, y: 470, width: 302, height: 65 }, [255, 255, 255]], [W, TEAL]]))).toEqual({ seen: 'over' });
  });

  it.each([
    ['3 pt on both sides', { x: 48, y: 500, width: 306, height: 34 }],
    ['2 pt on the left only', { x: 49, y: 500, width: 302, height: 34 }],
    ['2 pt past its far edge only', { x: 51, y: 500, width: 300, height: 36 }],
  ] as const)('a card under a text-only peer running on %s: untold — the thin slice against the peer\'s edge reads it', (_n, card) => {
    expect(seenOf(paint([[card, [255, 255, 255]], [W, TEAL]]))).toEqual({ untold: 'the other shows the colour around it #FFFFFF beside the overlap: it may draw nothing there' });
  });

  it('a band half one colour, half text (no dominant of half of it): untold', () => {
    // W's band above the overlap striped teal / white / black, a line each: no colour holds half of it.
    const stripes: [Rect, Rgb][] = Array.from({ length: 22 }, (_, i): [Rect, Rgb] => [{ x: 51, y: 448 + i, width: 300, height: 1 }, i % 3 === 0 ? TEAL : i % 3 === 1 ? [255, 255, 255] : [20, 20, 20]]);
    expect(seenOf(paint([[C, GREEN], [W, TEAL], ...stripes]))).toEqual({ untold: 'it is not one colour beside the overlap' });
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

  it('two sides only just apart, the overlap near one and within the tolerance of the other too: untold', () => {
    // W (0,137,123) and C (0,156,123) 8.55 apart; the overlap (0,141,123) 1.95 from W, 6.60 from C — a blend.
    expect(seenOf(paint([[W, TEAL], [C, [0, 156, 123]], [PAIR.overlap, [0, 141, 123]]]))).toEqual({ untold: 'the overlap shows neither (ΔE 1.95 to it, 6.60 to the other)' });
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
  /** The png with one pixel changed at (x, y), to `k`: two captures that differ there. */
  const touched = (base: PNG, x: number, y: number, k: number): Buffer => {
    const img = new PNG({ width: base.width, height: base.height });
    base.data.copy(img.data);
    img.data[(y * base.width + x) * 4] = k;
    return PNG.sync.write(img);
  };
  const assertOn = async (id: string, { shots, trees, timeoutMs = 2_000, expected = '#00897B' }: { shots?: (n: number, base: PNG) => Buffer; trees?: (n: number, t: UiNode) => UiNode; timeoutMs?: number; expected?: string } = {}) => {
    const t = parseIdbDescribeAll((await file('blur-menu.idb.json')).toString('utf8'));
    const fake = new FakeAdapter({ menu: t }, 'menu');
    fake.viewportSize = { width: 402, height: 874 };
    fake.nextScreenshot = await file('blur-menu.png');
    let reads = 0;
    fake.uiTree = async () => (trees ?? ((_n: number, same: UiNode) => same))(reads++, structuredClone(t));
    if (shots !== undefined) {
      const base = await png('blur-menu.png');
      let n = 0;
      fake.screenshot = async () => {
        const shot = shots(n++, base);
        fake.screenshots.push(shot);
        return shot;
      };
    }
    const result = await new Verifier(fake, { pollMs: 5, timeoutMs }).assert({ element: { id }, color: { expected } });
    return { result, captures: fake.screenshots.length, reads };
  };

  it('W passes on its own teal in one round: the settled pair, two captures', async () => {
    const w = await assertOn('lab.blur-menu.W');
    expect(w.result).toMatchObject({ pass: true, detail: expect.stringContaining('sampled #00897B') });
    expect(w.captures).toBe(2);
  });

  it('C, seen under W, asks once per distinct tree: every later round of the same tree reuses the answer, no capture', async () => {
    const c = await assertOn('lab.blur-menu.C', { timeoutMs: 1_000 });
    expect(c.result).toMatchObject({ pass: false, detail: expect.stringContaining('drawn over the element (element 51,470 300x64) as a screenshot shows') });
    expect(c.reads).toBeGreaterThan(3);
    expect(c.captures).toBe(2);
  });

  it('C on a tree that changes every read (a label elsewhere): asked again each round — the answer is kept only while the tree reads the same', async () => {
    const c = await assertOn('lab.blur-menu.C', {
      timeoutMs: 1_000,
      trees: (n, t) => {
        const a = [...everyNode(t)].find((x) => x.label === 'Target A')!;
        (a as { label?: string }).label = `Target A ${n}`;
        return t;
      },
    });
    expect(c.result).toMatchObject({ pass: false, detail: expect.stringContaining('as a screenshot shows') });
    expect(c.reads).toBeGreaterThan(1);
    // Every round that found C captured its settled pair (a round the deadline cut may have read and taken none).
    expect(c.captures).toBeGreaterThanOrEqual(2 * (c.reads - 1));
  });

  it('an answer that unlocks is never kept: W seen on top in round 1 (measured, the colour off), C on top from round 2 — looked at again, W a covered miss', async () => {
    // From the third capture on, C's blurred green fills the overlap: C drawn over W.
    let cOnTop: Buffer | undefined;
    const w = await assertOn('lab.blur-menu.W', {
      timeoutMs: 1_200,
      expected: '#FF0000',
      shots: (n, base) => {
        if (n < 2) return PNG.sync.write(base);
        if (cOnTop === undefined) {
          const img = new PNG({ width: base.width, height: base.height });
          base.data.copy(img.data);
          for (let y = 470 * 3; y < 512 * 3; y++)
            for (let x = 51 * 3; x < 351 * 3; x++) {
              const o = (y * base.width + x) * 4;
              img.data[o] = 0x34;
              img.data[o + 1] = 0x79;
              img.data[o + 2] = 0x37;
            }
          cOnTop = PNG.sync.write(img);
        }
        return cOnTop;
      },
    });
    expect(w.reads).toBeGreaterThan(1);
    expect(w.result).toMatchObject({ pass: false, detail: expect.stringContaining('button "Target C" (51,470 300x64) is drawn over the element (element 51,448 300x64) as a screenshot shows') });
  });

  it('W on frames that never settle: the order untold, W refused as overlapped — never measured on a blend', async () => {
    const w = await assertOn('lab.blur-menu.W', { timeoutMs: 300, shots: (n, base) => touched(base, 600, 1450, n % 256) });
    expect(w.result).toMatchObject({ pass: false, detail: expect.stringContaining('a screenshot could not tell either (the screen did not settle)') });
  });

  it('W on frames settled over its own region only (the screen elsewhere changing): untold — the bands and the strips around the two lie outside that region', async () => {
    const w = await assertOn('lab.blur-menu.W', { timeoutMs: 300, shots: (n, base) => touched(base, 5, 5, n % 256) });
    expect(w.result).toMatchObject({ pass: false, detail: expect.stringContaining('a screenshot could not tell either (only the element held still, not the screen around it)') });
  });

  it('W when the screenshot fails: untold, said why, and the poll goes on — the order question never throws', async () => {
    const w = await assertOn('lab.blur-menu.W', {
      timeoutMs: 300,
      shots: () => {
        throw new Error('device offline');
      },
    });
    expect(w.result).toMatchObject({ pass: false, detail: expect.stringContaining('a screenshot could not tell either (the screenshot failed: device offline)') });
    expect(w.reads).toBeGreaterThan(1);
  });
});
