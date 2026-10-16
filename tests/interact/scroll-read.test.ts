import { describe, expect, it } from 'vitest';
import type { Rect, UiNode } from '../../src/adapters/types.js';
import { judgeRead, strokeLine, type ReadJudgement, type RoundRead } from '../../src/interact/scroll-read.js';
import type { KeyboardCover } from '../../src/ui-tree/keyboard-cover.js';
import type { UsableScreen } from '../../src/ui-tree/usable-screen.js';
import { node } from '../helpers/fake.js';
import { BACK, coverOver, match, NO_BACK, treeOf, type Row } from '../helpers/rounds.js';

/**
 * `scroll_until`'s ONE read, judged (interact/scroll-read.ts#judgeRead): a
 * table of reads, each row a tree, its matches and its keyboard facts, and
 * what the read means — the witness asked, or the judgement: the match
 * judged best, the cover applied and the one offered, the frames the far
 * edge is judged in and the line the strokes stay above. The rounds'
 * sequences stay in tests/interact/scroll-rounds.test.ts; a per-read case
 * is a row here.
 */

const box = (width: number, height: number): Rect => ({ x: 0, y: 0, width, height });
const PHONE = box(1000, 2000);
/** A usable screen of `boxes` (the first the box) and `bands`, from the device. */
const screenOf = (boxes: Rect[], bands: Pick<UsableScreen, 'statusBand' | 'navigationBand'> = {}): UsableScreen => ({ box: boxes[0], boxes, oriented: boxes[0], from: 'device', ...bands });
const AS_BUILT = screenOf([PHONE]);

/** A read of `row`'s tree on `screen`, its reading's facts: no node the keyboard's, the cover's remedy (else the in-tree model's). */
const readOf = (row: Row & { ofKeyboard?: (n: UiNode) => boolean }, screen: Rect = PHONE): RoundRead => ({
  tree: treeOf(row, screen),
  found: row.found ?? [],
  ofKeyboard: row.ofKeyboard ?? (() => false),
  remedy: row.remedy ?? row.cover?.remedy ?? NO_BACK,
  ...(row.cover !== undefined && { cover: row.cover }),
});

/** The judgement, or the test fails naming the ask. */
const judged = (j: ReturnType<typeof judgeRead>): ReadJudgement => {
  if ('ask' in j) throw new Error(`asked ${j.ask}`);
  return j;
};

/** What a judgement says, as one plain value: the best match's id, its standing's kind, whether it was judged under the cover; the cover applied and the one offered (their tops); the frames; the stroke line. */
const said = (j: ReadJudgement) => ({
  best: j.best === undefined ? undefined : { id: j.best.node.identifier, kind: j.best.standing.kind, under: j.best.under !== undefined },
  cover: j.cover?.topCover.y,
  offered: j.offered?.topCover.y,
  frames: j.frames,
  uncutFrames: j.uncutFrames,
  strokeLine: j.strokeLine,
});

/** The Android window model's band over the bottom quarter of the phone. */
const IME = { x: 0, y: 1500, width: 1000, height: 500 };

describe('judgeRead — what one read means, row by row', () => {
  it('no keyboard: the match judged over the whole screen, nothing asked, no cover, no line; the frames the box', () => {
    const j = judged(judgeRead(readOf({ found: [match({ x: 0, y: 500, width: 100, height: 100 })] }), AS_BUILT, false));
    expect(said(j)).toEqual({ best: { id: 't', kind: 'reachable', under: false }, cover: undefined, offered: undefined, frames: [PHONE], uncutFrames: [PHONE], strokeLine: undefined });
  });

  it('no match: no best, the frames still the box', () => {
    const j = judged(judgeRead(readOf({ found: [] }), AS_BUILT, false));
    expect(said(j)).toMatchObject({ best: undefined, cover: undefined, frames: [PHONE] });
  });

  it('a reading cover that is moot — the match stops the round either way, on the same judgement: no witness asked, no cover applied, the cover still offered', () => {
    const j = judgeRead(readOf({ found: [match({ x: 0, y: 500, width: 100, height: 100 })], cover: coverOver(IME) }), AS_BUILT, false);
    expect(said(judged(j))).toEqual({ best: { id: 't', kind: 'reachable', under: false }, cover: undefined, offered: 1500, frames: [PHONE], uncutFrames: [PHONE], strokeLine: undefined });
  });

  describe('a reading cover that is not moot — the match\'s centre under it', () => {
    const read = readOf({ found: [match({ x: 0, y: 1480, width: 100, height: 100 })], cover: coverOver(IME) });
    it('asks the witness, and judges nothing until it answers', () => {
      expect(judgeRead(read, AS_BUILT, false)).toEqual({ ask: 'witness' });
    });
    it('corroborated: the cover applied, the match judged under it (its 20 px above the line still stop the plain round), the frame the screen above it, the strokes above its line', () => {
      expect(said(judged(judgeRead(read, AS_BUILT, false, true)))).toEqual({
        best: { id: 't', kind: 'reachable', under: true },
        cover: 1500,
        offered: 1500,
        frames: [box(1000, 1500)],
        uncutFrames: [box(1000, 1500)],
        strokeLine: { y: 1500, witnessed: true },
      });
    });
    it('denied: the whole-screen judgement stands, no cover applied, offered still, no line', () => {
      expect(said(judged(judgeRead(read, AS_BUILT, false, false)))).toEqual({
        best: { id: 't', kind: 'reachable', under: false },
        cover: undefined,
        offered: 1500,
        frames: [PHONE],
        uncutFrames: [PHONE],
        strokeLine: undefined,
      });
    });
  });

  it('a keyboard-side node under the cover (the reading\'s ofKeyboard) is judged against the whole screen: moot, nothing asked', () => {
    const key = match({ x: 0, y: 1600, width: 100, height: 100 }, 'key');
    const j = judgeRead(readOf({ found: [key], cover: coverOver(IME, NO_BACK), ofKeyboard: (n) => n === key }), AS_BUILT, false);
    expect(said(judged(j))).toMatchObject({ best: { id: 'key', kind: 'reachable', under: false }, cover: undefined, offered: 1500 });
  });

  it('a corroborated cover leaving nothing above it: applied, `above` none, the frames every box uncut by it', () => {
    const all = { x: 0, y: 0, width: 1000, height: 2000 };
    const j = judged(judgeRead(readOf({ found: [match({ x: 0, y: 500, width: 100, height: 100 })], cover: coverOver(all) }), AS_BUILT, false, true));
    expect(j.cover?.above).toBeUndefined();
    expect(said(j)).toMatchObject({ cover: 0, frames: [PHONE], strokeLine: { y: 0, witnessed: true } });
  });

  it('a reading cover whose top lies at or below the screen\'s bottom offers nothing', () => {
    const j = judged(judgeRead(readOf({ found: [match({ x: 0, y: 500, width: 100, height: 100 })], cover: coverOver({ x: 0, y: 2000, width: 1000, height: 100 }) }), AS_BUILT, false));
    expect(said(j)).toMatchObject({ cover: undefined, offered: undefined });
  });

  describe('idb\'s band (the flat list\'s keyboard background and keys): applied with no witness, the strokes above it whether applied or not', () => {
    const PAD = { x: 0, y: 590, width: 402, height: 284 };
    const keys = ['Q', 'W', 'E'].map((k, i) => node({ role: 'button', label: k, rect: { x: 2 + 40 * i, y: 780, width: 38, height: 46 } }));
    const bandRow = (row: Rect): Row => ({ flatList: true, found: [match(row)], over: [...keys, node({ role: 'other', rect: { ...PAD } })] });
    const IDB = screenOf([box(402, 874)]);
    it('a row under it: no ask, the band applied as the cover, the row judged under it, the line unwitnessed', () => {
      const j = judgeRead(readOf(bandRow({ x: 20, y: 700, width: 362, height: 50 }), box(402, 874)), IDB, false);
      expect(said(judged(j))).toEqual({
        best: { id: 't', kind: 'underKeyboard', under: true },
        cover: 590,
        offered: undefined,
        frames: [box(402, 590)],
        uncutFrames: [box(402, 590)],
        strokeLine: { y: 590, witnessed: false },
      });
    });
    it('a row above it: the band moot and not applied, but the strokes still stay above it', () => {
      const j = judgeRead(readOf(bandRow({ x: 20, y: 200, width: 362, height: 50 }), box(402, 874)), IDB, false);
      expect(said(judged(j))).toMatchObject({ best: { kind: 'reachable', under: false }, cover: undefined, frames: [box(402, 874)], strokeLine: { y: 590, witnessed: false } });
    });
  });

  describe('the frames the far edge is judged in (ui-tree/standing.ts#farEdgeFrames, asked by the read)', () => {
    const IPHONE = box(402, 874);
    it('below the status band, on each box\'s own shape: the upright box cut, the turned one (landscape) not', () => {
      const turned = box(874, 402);
      const j = judged(judgeRead(readOf({ found: [match({ x: 0, y: 300, width: 100, height: 50 })] }, IPHONE), screenOf([IPHONE, turned], { statusBand: 62 }), false));
      expect(j.frames).toEqual([{ x: 0, y: 62, width: 402, height: 812 }, turned]);
      expect(j.uncutFrames).toEqual(j.frames);
    });
    it('above a corroborated cover, below the status band', () => {
      const band = { x: 0, y: 500, width: 402, height: 374 };
      const read = readOf({ found: [match({ x: 0, y: 480, width: 100, height: 50 })], cover: coverOver(band) }, IPHONE);
      const j = judged(judgeRead(read, screenOf([IPHONE], { statusBand: 62 }), false, true));
      expect(j.frames).toEqual([{ x: 0, y: 62, width: 402, height: 438 }]);
    });
    describe('a match across the navigation band\'s top (Android, 66-px bands on 1080x2220)', () => {
      const PIXEL = box(1080, 2220);
      const SCREEN = screenOf([PIXEL], { statusBand: 66, navigationBand: 2154 });
      const read = readOf({ found: [match({ x: 0, y: 2100, width: 1080, height: 100 })], remedy: BACK }, PIXEL);
      const belowStatus = { x: 0, y: 66, width: 1080, height: 2154 };
      it('a `fully` stop the band\'s region refused: the frames cut above the navigation band too, the short-of frames not', () => {
        const j = judged(judgeRead(read, SCREEN, true));
        expect(j.best?.standing.kind).toBe('systemBar');
        expect(j.frames).toEqual([{ x: 0, y: 66, width: 1080, height: 2088 }]);
        expect(j.uncutFrames).toEqual([belowStatus]);
      });
      it('the plain stop: the frames uncut at the navigation band', () => {
        const j = judged(judgeRead(read, SCREEN, false));
        expect(j.frames).toEqual([belowStatus]);
      });
    });
  });

  it('of two matches that both stop the round, the one more of which shows — not the first in tree order', () => {
    const cut = match({ x: 0, y: -20, width: 100, height: 100 }, 'cut'); // its centre on the screen, its top 20 px above it
    const whole = match({ x: 0, y: 500, width: 100, height: 100 }, 'whole');
    const j = judged(judgeRead(readOf({ found: [cut, whole] }), AS_BUILT, false));
    expect(j.best?.node.identifier).toBe('whole');
  });

  it('two boxes, box-major: of two matches each reachable in one box only, the FIRST box\'s wins the tie', () => {
    const IPHONE = box(402, 874);
    // A only inside the turned box (874 wide), B only inside the upright one (874 high).
    const a = match({ x: 500, y: 100, width: 100, height: 50 }, 'A');
    const b = match({ x: 10, y: 600, width: 100, height: 50 }, 'B');
    const j = judged(judgeRead(readOf({ found: [a, b] }, IPHONE), screenOf([IPHONE, box(874, 402)]), false));
    expect(j.best?.node.identifier).toBe('B');
    expect(j.best?.standing.kind).toBe('reachable');
  });
});

describe('strokeLine — the line a read\'s strokes stay above', () => {
  const facts = (row: Row, screen: Rect) => judged(judgeRead(readOf(row, screen), screenOf([screen]), false)).facts;
  it('no cover, no band: none', () => {
    expect(strokeLine(undefined, facts({ found: [] }, PHONE))).toBeUndefined();
  });
  it('a cover, no band: the cover\'s line', () => {
    const cover: KeyboardCover = coverOver(IME);
    const j = judged(judgeRead(readOf({ found: [match({ x: 0, y: 1480, width: 100, height: 100 })], cover }), AS_BUILT, false, true));
    expect(strokeLine(j.cover, j.facts)).toEqual({ y: 1500, witnessed: true });
  });
  it('no cover, idb\'s band: the band\'s line', () => {
    const over = [node({ role: 'button', label: 'Q', rect: { x: 2, y: 780, width: 38, height: 46 } }), node({ role: 'other', rect: { x: 0, y: 590, width: 402, height: 284 } })];
    expect(strokeLine(undefined, facts({ flatList: true, found: [], over }, box(402, 874)))).toEqual({ y: 590, witnessed: false });
  });
});
