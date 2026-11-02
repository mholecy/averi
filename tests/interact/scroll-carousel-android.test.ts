import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { type RoundRules } from '../../src/interact/scroll-rounds.js';
import { CUT_EDGE_CARRY, CUT_EDGE_MIN_DRAG, UNKNOWN_CENTRE_MIN_GAP, unknownCentreNeeds } from '../../src/interact/course.js';
import type { Judged } from '../../src/interact/scroll-read.js';
import type { Direction } from '../../src/interact/swipe.js';
import type { Edge } from '../../src/ui-tree/geometry.js';
import { describeScrollResult } from '../../src/interact/scroll-text.js';
import { parseDump } from '../helpers/android-dumps.js';
import { containsPoint } from '../../src/ui-tree/geometry.js';
import { node } from '../helpers/fake.js';
import { coverOver, failureOf, play, resultOf, strokesToward, type Row } from '../helpers/rounds.js';

/**
 * D17: uiautomator cuts a carousel's card at the SCREEN's edge, not its carousel's (adapters/types.ts#UiNode.boundsCutAtScreen),
 * so a card running past the carousel's right edge is dumped ending at 1080 whatever its width — its centre unknown.
 * Over the lab app's real `carousel-in-list` dump (API 33): the carousel `[66,380][1014,614]`, C laid 948 wide — as
 * wide as the carousel, whole at one offset only — at rest at x 1014. A read with C laid at `cx` is that dump with C
 * listed as uiautomator lists it: cut at the screen's edges (measured live: C at the app's 586 dumped
 * `[586,380][1080,614]`, its true centre 1060 past the carousel's 1014, its listed centre 833 inside it).
 */

const XML = readFileSync(new URL('../fixtures/truth/android-averi_lab-api33/carousel-in-list.xml', import.meta.url), 'utf8');
const CAROUSEL: Rect = { x: 66, y: 380, width: 948, height: 234 };
const C = 'lab.carousel-in-list.C';
const RULES: RoundRules & { screen: { width: number; height: number } } = { direction: 'right', fully: false, maxSwipes: 6, timeoutMs: 15_000, readSettles: true, screen: { width: 1080, height: 2220 } };

/** One read with C laid at screen x `cx`, `width` wide (948, the carousel's), listed cut at the screen's edges. */
const cAt = (cx: number, width = 948): Row => {
  const tree: UiNode = parseDump(XML);
  const c = [...everyNode(tree)].find((n) => n.identifier === C);
  if (c === undefined) throw new Error('no C');
  const from = Math.max(cx, 0);
  (c as { rect: Rect }).rect = { x: from, y: 380, width: Math.min(cx + width, 1080) - from, height: 234 };
  return { tree, found: [c] };
};

/** The full stroke over the carousel (60 % of its 948 px), and the cut ones: the known side's gap over CUT_EDGE_CARRY, in px. */
const FULL = 568;
const CUT_382 = 285;
const CUT_586 = 468;
const SHORT_60 = 54;
/** form-picker's full stroke down its list. */
const PICKER_STROKE = 1160;

/** The finger's travel of each stroke, along x (content right: the finger moves left). */
const travels = (played: ReturnType<typeof play>): number[] => played.steps.flatMap((s) => (s.do === 'stroke' && s.points !== undefined ? [s.points.from.x - s.points.to.x] : []));

describe("a card cut at the screen's edge (D17): its centre unknown — one more stroke, cut to bring its known side to the carousel's, then the stop", () => {
  it('the dump: C at rest `[1014,380][1080,614]`; laid at 586, `[586,380][1080,614]`', () => {
    expect(cAt(1014).found?.[0]?.rect).toEqual({ x: 1014, y: 380, width: 66, height: 234 });
    expect(cAt(586).found?.[0]?.rect).toEqual({ x: 586, y: 380, width: 494, height: 234 });
  });

  it(`the live run: one full stroke left C at 382 — one more, cut to its left side's 316 px to the carousel's at CUT_EDGE_CARRY (${CUT_EDGE_CARRY}) a px, toward it; then the stop says "at most"`, () => {
    const played = play(RULES, [cAt(1014), cAt(382), cAt(257)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stroke', 'stop']);
    expect(strokesToward(played)).toEqual(['right', 'right']);
    // Pinned in px: 316 / 1.11 — an Android figure, not WDA's UNMEASURED_CARRY.
    expect(travels(played)).toEqual([FULL, CUT_382]);
    const second = played.steps[1];
    expect(second.do === 'stroke' && second.box).toEqual(CAROUSEL);
    expect(played.outcome).toMatchObject({ kind: 'visible', swipes: 2 });
    expect(describeScrollResult(resultOf(played))).toBe(
      "visible after 2 swipes — CLIPPED at right, at most 92% of it is in the viewport — uiautomator does not say how far it runs past the screen's right edge. A rect assert or screenshot on this element will measure the CLIPPED box",
    );
  });

  it("the D17 shape — C at 586, its true centre past the carousel's edge — is not stopped on: one more stroke first", () => {
    const played = play(RULES, [cAt(586), cAt(400)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stop']);
    expect(travels(played)).toEqual([CUT_586]);
  });

  it('bounded — ONE such stroke a scroll: a carousel exactly one card wide, the stroke moving it little or nothing, stops on the next read, "at most"', () => {
    for (const after of [382, 370]) {
      const played = play(RULES, [cAt(1014), cAt(382), cAt(after)]);
      expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stroke', 'stop']);
      expect(describeScrollResult(resultOf(played))).toMatch(/^visible after 2 swipes — CLIPPED at right, at most \d+% of it is in the viewport/);
    }
  });

  it(`no such stroke where even the shortest could push the known side past the carousel: its left side under UNKNOWN_CENTRE_MIN_GAP (${UNKNOWN_CENTRE_MIN_GAP} px) inside the carousel's`, () => {
    // A card wider than the carousel, so its right side still lies past the screen's edge.
    const played = play(RULES, [cAt(66 + UNKNOWN_CENTRE_MIN_GAP - 1, 1000)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stop']);
    expect(describeScrollResult(resultOf(played))).toMatch(/^visible after 0 swipes — CLIPPED at right, at most \d+% of it is in the viewport/);
    expect(play(RULES, [cAt(66 + UNKNOWN_CENTRE_MIN_GAP, 1000), cAt(66)]).steps.map((s) => s.do)).toEqual(['stroke', 'stop']);
  });

  it("never as a turn: content asked LEFT, C's unknown side on the right — a stroke toward it would turn the course: the stop as before, \"at most\"", () => {
    const played = play({ ...RULES, direction: 'left' }, [cAt(382)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stop']);
    expect(describeScrollResult(resultOf(played))).toMatch(/at most 91% of it is in the viewport — uiautomator does not say how far it runs past the screen's right edge/);
  });

  it('nor at the bound: the last swipe spent, or the time — the stop is made', () => {
    const played = play({ ...RULES, maxSwipes: 1 }, [cAt(1014), cAt(382)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stop']);
    expect(played.outcome).toMatchObject({ kind: 'visible', swipes: 1 });
    const late = play(RULES, [cAt(1014), { ...cAt(382), elapsedMs: RULES.timeoutMs }]);
    expect(late.steps.map((s) => s.do)).toEqual(['stroke', 'stop']);
    expect(late.outcome).toMatchObject({ kind: 'visible', swipes: 1 });
  });

  it('nor with no gesture box to draw it in (a round with no usable screen): the stop is made, not a stroke with no points', () => {
    const played = play(RULES, [cAt(1014), { ...cAt(382), screen: null }]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stop']);
    expect(played.outcome).toMatchObject({ kind: 'visible', swipes: 1 });
  });

  it(`a gap just over UNKNOWN_CENTRE_MIN_GAP: a short stroke at an Android drag's figures (${CUT_EDGE_MIN_DRAG} px the shortest), not WDA's 108-px floor`, () => {
    const played = play(RULES, [cAt(66 + 60, 1000), cAt(66, 1000)]);
    expect(travels(played)).toEqual([SHORT_60]);
  });

  it('a card whose right side is known (inside the screen) is stopped on as before: no "at most"', () => {
    const played = play(RULES, [cAt(1014), cAt(40)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stop']);
    expect(describeScrollResult(resultOf(played))).not.toMatch(/at most/);
  });
});

describe("the failures say \"at most\" too — stuck at its scroll view's edge, and the bound", () => {
  const FULLY = { ...RULES, fully: true };
  /** The read before the strokes, and the reads after the strokes that leave it where it was until the stuck turn's stroke back answers. */
  const STUCK_ROWS = 4;
  it('stuck: `fully: true`, the strokes leaving C where it was', () => {
    const played = play(FULLY, Array.from({ length: STUCK_ROWS }, () => cAt(382)));
    expect(failureOf(played, 'C').message).toMatch(/at most \d+% of it is drawn — uiautomator does not say how far it runs past the screen's right edge/);
  });
  it('the bound: `fully: true` at maxSwipes, C clipped', () => {
    const played = play({ ...FULLY, maxSwipes: 1 }, [cAt(1014), cAt(382)]);
    expect(failureOf(played, 'C').message).toMatch(/CLIPPED at right, at most \d+% of it is in the viewport — uiautomator does not say how far it runs past the screen's right edge/);
  });
});

describe('the layout-defect failure says "at most" too', () => {
  it('stuck with its centre past the carousel (C dumped `[960,380][1080,614]`, the strokes leaving it there): the layout-defect sentence', () => {
    const played = play(RULES, Array.from({ length: 4 }, () => cAt(960)));
    expect(failureOf(played, 'C').message).toMatch(/CLIPPED at right, at most \d+% of it is in the viewport — uiautomator does not say how far it runs past the screen's right edge/);
  });
});

/**
 * D52: `fully: true` on C, as wide as the carousel (948 in 948) — fully shown at x 66 exactly, an offset no swipe can be
 * aimed at (the shortest drag CUT_EDGE_MIN_DRAG, the reach halved at each turn). The batch-3 E2 run 0 (C after a 440-px
 * pre-drag, asked LEFT) ran 6 strokes and 3 turns to maxSwipes; it fails on the first read that knows both its sides.
 */
describe('`fully: true` on a card as wide as its carousel (D52): fails at the first read that knows its width, saying why', () => {
  const FULLY_LEFT = { ...RULES, direction: 'left' as const, fully: true };
  /** C's x at each read of E2 run 0 (the carousel's offset 440 → 783 → 1116 → 969 → 825 → 883 → 938: x = 1014 − offset). */
  const E2_RUN_0 = [574, 231, -102, 45, 189, 131, 76];
  /** The rounds over E2's reads in order, until the stop. */
  const replay = (rules: RoundRules & { screen: { width: number; height: number } }, xs: readonly number[], width = 948): ReturnType<typeof play> => {
    const rows: Row[] = [];
    for (const x of xs) {
      rows.push(cAt(x, width));
      const played = play(rules, rows);
      if (played.outcome !== undefined) return played;
    }
    throw new Error('replay: no stop');
  };

  it('E2 run 0: unfit on the 4th read (C at 45, both sides known) after 3 strokes — not 6 strokes and 3 turns to maxSwipes', () => {
    const played = replay(FULLY_LEFT, E2_RUN_0);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stroke', 'stroke', 'stop']);
    expect(played.outcome).toMatchObject({ kind: 'unfit', swipes: 3, unfit: { along: 'horizontal', size: 948, scrollView: { rect: CAROUSEL } } });
    expect(failureOf(played, 'id:"lab.carousel-in-list.C"').message).toBe(
      'scroll_until id:"lab.carousel-in-list.C" failed after 3 swipes — element is in the viewport but CLIPPED at left: 98% of it is drawn, ' +
        'and it is 948 wide (tree units), as wide as its scroll view scrollable (66,380 948x234): fully: true holds at one exact scroll offset only, ' +
        'which no swipe can be aimed at — drop fully: true (the plain stop needs only its centre in view), or accept what it shows (98%). ' +
        'Last rect {"x":45,"y":380,"width":948,"height":234} in a 1080x2220 viewport',
    );
  });

  it('wider than the carousel (1000 in 948), both sides known: unfit before any swipe, "no scroll shows all of it"', () => {
    const played = play(FULLY_LEFT, [cAt(40, 1000)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stop']);
    expect(played.outcome).toMatchObject({ kind: 'unfit', swipes: 0, unfit: { size: 1000, scrollView: { rect: CAROUSEL } } });
    expect(failureOf(played, 'C').message).toBe(
      'scroll_until C failed after 0 swipes — element is in the viewport but CLIPPED at left/right: 95% of it is drawn, ' +
        'and it is 1000 wide (tree units), wider than its scroll view scrollable (66,380 948x234): no scroll offset shows all of it ' +
        '— drop fully: true (the plain stop needs only its centre in view), or accept what it shows (95%). ' +
        'Last rect {"x":40,"y":380,"width":1000,"height":234} in a 1080x2220 viewport',
    );
  });

  it('a still carousel (C at 76, 10 px short, the strokes leaving it there): unfit at once — never "stuck … a layout defect"', () => {
    const played = play(FULLY_LEFT, [cAt(76)]);
    expect(played.outcome).toMatchObject({ kind: 'unfit', swipes: 0 });
    expect(failureOf(played, 'C').message).not.toMatch(/layout defect/);
  });

  it('a 900-wide card (48 px of room) is not unfit: it is stroked for, as before', () => {
    expect(play(FULLY_LEFT, [cAt(45, 900)]).steps.map((s) => s.do)).toEqual(['stroke']);
  });

  it('a card that already fits (900 wide, at 90): the stop, fully visible', () => {
    expect(play(FULLY_LEFT, [cAt(90, 900)]).outcome).toMatchObject({ kind: 'visible', swipes: 0 });
  });

  it('`fully: false`: the plain stop on C at 45, as before (D17)', () => {
    expect(play({ ...FULLY_LEFT, fully: false }, [cAt(45)]).outcome).toMatchObject({ kind: 'visible', swipes: 0 });
  });

  it("a side cut at the screen's edge (C at 231, its right side unknown): never unfit — stroked for", () => {
    expect(play(FULLY_LEFT, [cAt(231)]).steps.map((s) => s.do)).toEqual(['stroke']);
  });
});

describe("a vertical list's row cut at the screen's bottom (D17): the lab's form-picker, \"Faroe Islands\" dumped ending at 2220 below its list's 2154", () => {
  const PICKER = readFileSync(new URL('../fixtures/uiautomator-lab-form-picker.xml', import.meta.url), 'utf8');
  const FO = 'lab.form-picker.country.FO';
  const at = (y: number): Row => {
    const tree = parseDump(PICKER);
    const fo = [...everyNode(tree)].find((n) => n.identifier === FO);
    if (fo === undefined) throw new Error('no FO');
    (fo as { rect: Rect }).rect = { x: 0, y, width: 1080, height: Math.min(140, 2220 - y) };
    return { tree, found: [fo] };
  };
  it('a plain stop down on it takes one more stroke — its top 1859 px inside the list\'s, so the full stroke — and then stops fully visible', () => {
    expect(at(2080).found?.[0]?.rect).toEqual({ x: 0, y: 2080, width: 1080, height: 140 });
    const played = play({ ...RULES, direction: 'down' }, [at(2080), at(900)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stop']);
    expect(strokesToward(played)).toEqual(['down']);
    const first = played.steps[0];
    expect(first.do === 'stroke' && first.points !== undefined && first.points.from.y - first.points.to.y).toBe(PICKER_STROKE);
    expect(describeScrollResult(resultOf(played))).toBe('fully visible after 1 swipe');
  });

  it('`fully: true`, the keyboard up over its bottom, the strokes leaving it there: the keyboard sentence says "at most"', () => {
    const band = { x: 0, y: 2120, width: 1080, height: 100 };
    const played = play({ ...RULES, direction: 'down', fully: true }, Array.from({ length: 4 }, () => ({ ...at(2080), cover: coverOver(band) })));
    expect(failureOf(played, 'FO').message).toMatch(/at most \d+% of it is in the viewport above the soft keyboard over \[0,2120\]\[1080,2220\] — uiautomator does not say how far it runs past the screen's bottom edge/);
  });
});

describe("a sheet presented BY SHAPE (ADR 0018's fallback, on every Android tree) over the list beside the row", () => {
  const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
  /**
   * form-picker's shape — its list ending at 2154, the row dumped ending at the screen's 2220 — and a later screen-sized
   * layer stacked over it, in one window, holding a sheet's scroll view; with `bar`, a bar of the screen beneath drawn
   * over the list's lower half, which the stroke room keeps the touch-down above.
   */
  const shaped = (sheet: Rect, bar?: Rect): Row => {
    const fo = node({ role: 'button', identifier: 'FO', label: 'Faroe Islands', rect: r(0, 2080, 1080, 140) });
    const list = node({ role: 'scrollable', rect: r(0, 221, 1080, 1933), children: [node({ role: 'button', label: 'Row A', rect: r(0, 300, 1080, 140) }), fo] });
    const sheetView = node({ role: 'scrollable', rect: sheet, children: [node({ role: 'text', label: 'Sheet row', rect: r(40, sheet.y + 20, 600, 80) })] });
    const beneath = [list, ...(bar === undefined ? [] : [node({ role: 'button', label: 'Bar', rect: bar })])];
    const holder = node({ role: 'container', rect: r(0, 0, 1080, 2220), children: [node({ role: 'container', rect: r(0, 0, 1080, 2220), children: beneath }), node({ role: 'container', rect: r(0, 0, 1080, 2220), children: [sheetView] })] });
    const tree: UiNode = { ...node({ role: 'container', rect: r(0, 0, 1080, 2220), children: [holder] }), boundsCutAtScreen: true, activeWindowOnly: true, paddedTouchTargets: true };
    return { tree, found: [fo] };
  };

  it.each([r(0, 1200, 1080, 600), r(0, 1600, 1080, 300), r(0, 500, 1080, 700)])('a sheet at %o, clear of the row: the row a plain stop with its bottom unknown — the centre stroke is sent, touching down off the sheet (the stroke room keeps it off what is drawn over the list)', (sheet) => {
    const played = play({ ...RULES, direction: 'down' }, [shaped(sheet)]);
    const [step] = played.steps;
    expect(step.do).toBe('stroke');
    if (step.do !== 'stroke' || step.points === undefined) throw new Error('no stroke');
    expect(containsPoint(sheet, step.points.from)).toBe(false);
  });

  it("with a bar over the list's lower half the touch-down lands on the sheet above it: the centre stroke is not sent — the plain stop is made at once, its share \"at most\"", () => {
    const played = play({ ...RULES, direction: 'down' }, [shaped(r(0, 600, 1080, 700), r(0, 1400, 1080, 300))]);
    expect(played.steps.map((s) => s.do)).toEqual(['stop']);
    expect(describeScrollResult(resultOf(played))).toMatch(/^visible after 0 swipes — CLIPPED at bottom, at most \d+% of it is in the viewport — uiautomator does not say how far it runs past the screen's bottom edge/);
  });

  it('…and `fully: true` there fails as a presented stop whose shortfall says "at most"', () => {
    const row = (): Row => shaped(r(0, 600, 1080, 700), r(0, 1400, 1080, 300));
    const played = play({ ...RULES, direction: 'down', fully: true }, [row(), row()]);
    expect(failureOf(played, 'FO').message).toMatch(/element is in the viewport but CLIPPED at bottom, at most \d+% of it is in the viewport — uiautomator does not say how far it runs past the screen's bottom edge, and the next swipe would touch down at \(540,1165\) on scrollable \(0,600 1080x700\)/);
  });
});

/** `unknownCentreNeeds` of a judged match with `rect`, its unknown sides `unknownPast` and its frame `frame` — the three facts it reads. */
const needsOf = (rect: Rect, unknownPast: readonly Edge[] | undefined, frame: Rect, toward: Direction) =>
  unknownCentreNeeds({ node: { rect }, standing: { facts: { unknownPast, screen: frame } } } as unknown as Pick<Judged, 'node' | 'standing'>, toward);

describe('course.ts#unknownCentreNeeds — what one more stroke needs for a target whose centre is unknown', () => {
  const frame = CAROUSEL;
  const DRAG = { unmeasured: { carry: CUT_EDGE_CARRY, minDrag: CUT_EDGE_MIN_DRAG } };
  it("its near side unknown, its far side known and UNKNOWN_CENTRE_MIN_GAP or more inside the frame's far edge: that distance, no slack, an Android drag's carry — along either axis", () => {
    expect(needsOf({ x: 382, y: 380, width: 698, height: 234 }, ['right'], frame, 'right')).toEqual({ needs: 316, slack: 0, ...DRAG });
    expect(needsOf({ x: 0, y: 380, width: 700, height: 234 }, ['left'], frame, 'left')).toEqual({ needs: 314, slack: 0, ...DRAG });
    expect(needsOf({ x: 0, y: 1200, width: 1080, height: 1020 }, ['bottom'], { x: 0, y: 300, width: 1080, height: 1700 }, 'down')).toEqual({ needs: 900, slack: 0, ...DRAG });
  });
  it(`none with the gap under ${UNKNOWN_CENTRE_MIN_GAP}, with both sides unknown, with the side toward it known (the far one, or one across the axis, unknown), or with none`, () => {
    const rect = { x: 382, y: 380, width: 698, height: 234 };
    expect(needsOf({ ...rect, x: 66 + UNKNOWN_CENTRE_MIN_GAP - 1 }, ['right'], frame, 'right')).toBeUndefined();
    expect(needsOf({ ...rect, x: 66 + UNKNOWN_CENTRE_MIN_GAP }, ['right'], frame, 'right')).toEqual({ needs: UNKNOWN_CENTRE_MIN_GAP, slack: 0, ...DRAG });
    expect(needsOf({ x: 0, y: 380, width: 1080, height: 234 }, ['left', 'right'], frame, 'right')).toBeUndefined();
    expect(needsOf(rect, ['right'], frame, 'left')).toBeUndefined();
    expect(needsOf(rect, ['top'], frame, 'right')).toBeUndefined();
    expect(needsOf(rect, undefined, frame, 'right')).toBeUndefined();
  });
  it(`the Android figures: CUT_EDGE_CARRY ${CUT_EDGE_CARRY} a px, the shortest drag ${CUT_EDGE_MIN_DRAG} px, so the least gap ${UNKNOWN_CENTRE_MIN_GAP} px`, () => {
    expect([CUT_EDGE_CARRY, CUT_EDGE_MIN_DRAG, UNKNOWN_CENTRE_MIN_GAP]).toEqual([1.11, 48, 54]);
  });
});
