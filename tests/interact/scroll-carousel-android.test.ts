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
        'which no swipe can be aimed at — drop fully: true, or accept what it shows. ' +
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
        '— drop fully: true, or accept what it shows. ' +
        'Last rect {"x":40,"y":380,"width":1000,"height":234} in a 1080x2220 viewport',
    );
  });

  it('the agent-facing references quote the two replies as the code words them (skill/references/tools.md, troubleshooting.md)', () => {
    const tools = readFileSync(new URL('../../skill/references/tools.md', import.meta.url), 'utf8');
    const troubleshooting = readFileSync(new URL('../../skill/references/troubleshooting.md', import.meta.url), 'utf8');
    const asWide = failureOf(replay(FULLY_LEFT, E2_RUN_0), 'C').message;
    const wider = failureOf(play(FULLY_LEFT, [cAt(40, 1000)]), 'C').message;
    const quoted = (message: string, from: string): string => message.slice(message.indexOf(from), message.indexOf('. Last rect'));
    expect(tools).toContain(`'${quoted(asWide, 'element is in the viewport')}'`);
    expect(tools).toContain(`'… ${quoted(wider, 'wider than')}'`);
    expect(troubleshooting).toContain(`…: ${quoted(asWide, 'fully: true holds')}\``);
    expect(troubleshooting).toContain(`…: ${quoted(wider, 'no scroll offset')}\``);
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

/**
 * D59: the same E2 course on a carousel the tree does not say scrolls sideways — the lab's `carousel-lazy-free`, a
 * Compose LazyRow dumped as a plain `android.view.View` (tests/fixtures/uiautomator-lab-carousel-lazy-free-launch.xml,
 * no axis: adapters/android.ts's AXIS_BY_CLASS names none). Its axis is inferred from the call's own evidence
 * (interact/unfit-axis.ts#inferredAlong): the carousel is C's nearest scroll view, the call runs along x, C is cut at
 * the carousel's own edge, and a stroke over the carousel earlier in this call moved C along x. batch-9's record
 * (tests/fixtures/d59-b9-lazy-predrag.json) ran 6 strokes and 3 turns to maxSwipes on it.
 */
describe('`fully: true` on a card as wide as a carousel of untold axis (D59): unfit once a stroke over it has moved the card along it', () => {
  const LAZY = readFileSync(new URL('../fixtures/uiautomator-lab-carousel-lazy-free-launch.xml', import.meta.url), 'utf8');
  const LC = 'lab.carousel-lazy-free.C';
  const B9 = JSON.parse(readFileSync(new URL('../fixtures/d59-b9-lazy-predrag.json', import.meta.url), 'utf8')) as {
    runs: { run: number; kind: string; swipes: number; reply: string; listed: { before: Rect; after: Rect }; roomGiver: { rect: Rect; axis: null; nearest: boolean } }[];
  };
  const FULLY_LEFT = { ...RULES, direction: 'left' as const, fully: true };
  const E2_RUN_0 = [574, 231, -102, 45, 189, 131, 76];
  /** The lazy-free launch tree (or `xml`) with C (or `id`) laid in its LazyRow (or the node at `holder`) at screen x `cx`, `width` wide, listed cut at the screen's edges (as uiautomator lists it; not cut to the carousel: Compose). */
  const lazyAt = (cx: number, width = 948, xml = LAZY, id = LC, holder = '[66,380][1014,614]'): Row => {
    const from = Math.max(cx, 0);
    const to = Math.min(cx + width, 1080);
    const card = `<node index="0" text="" resource-id="${id}" class="android.view.View" package="dev.averi.lab" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[${from},380][${to},614]" />`;
    const laid = xml.replace(`bounds="${holder}" />`, `bounds="${holder}">${card}</node>`);
    if (laid === xml) throw new Error('lazyAt: no LazyRow');
    const tree = parseDump(laid);
    const c = [...everyNode(tree)].find((n) => n.identifier === id);
    if (c === undefined) throw new Error('no C');
    return { tree, found: [c] };
  };
  const replay = (rules: RoundRules & { screen: { width: number; height: number } }, rows: readonly Row[]): ReturnType<typeof play> => {
    for (let i = 1; i <= rows.length; i++) {
      const played = play(rules, rows.slice(0, i));
      if (played.outcome !== undefined) return played;
    }
    throw new Error('replay: no stop');
  };

  it('the record: C as wide as the carousel, which the round saw nearest and of no axis — run 0 maxSwipes after 6 strokes, 3 turns', () => {
    expect(B9.runs.map((r) => [r.kind, r.swipes])).toEqual([['maxSwipes', 6], ['reached', 6], ['reached', 6]]);
    for (const r of B9.runs) expect(r.roomGiver).toEqual({ rect: CAROUSEL, axis: null, nearest: true });
    expect(B9.runs[0].reply).toContain('turned round 3 times');
    expect(lazyAt(45).found?.[0]?.rect).toEqual({ x: 45, y: 380, width: 948, height: 234 });
  });

  it("E2's course on it: unfit on the 4th read after 3 strokes, the axis inferred — and the reply says so", () => {
    const played = replay(FULLY_LEFT, E2_RUN_0.map((x) => lazyAt(x)));
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stroke', 'stroke', 'stop']);
    for (const s of played.steps) if (s.do === 'stroke') expect(s.box).toEqual(CAROUSEL);
    expect(played.outcome).toMatchObject({ kind: 'unfit', swipes: 3, unfit: { along: 'horizontal', size: 948, scrollView: { rect: CAROUSEL }, inferred: true } });
    expect(failureOf(played, `id:"${LC}"`).message).toBe(
      `scroll_until id:"${LC}" failed after 3 swipes — element is in the viewport but CLIPPED at left: 98% of it is drawn, ` +
        'and it is 948 wide (tree units), as wide as its scroll view container (66,380 948x234) (the tree does not say which way it scrolls: the swipes over it moved the element sideways): ' +
        'fully: true holds at one exact scroll offset only, which no swipe can be aimed at — drop fully: true, or accept what it shows. ' +
        'Last rect {"x":45,"y":380,"width":948,"height":234} in a 1080x2220 viewport',
    );
  });

  it("the agent-facing references quote the inferred axis's clause as the code words it (skill/references/tools.md, troubleshooting.md)", () => {
    const message = failureOf(replay(FULLY_LEFT, E2_RUN_0.map((x) => lazyAt(x))), 'C').message;
    const clause = message.slice(message.indexOf('(the tree does not say'), message.indexOf('): fully: true') + 1);
    expect(clause).toBe('(the tree does not say which way it scrolls: the swipes over it moved the element sideways)');
    expect(readFileSync(new URL('../../skill/references/tools.md', import.meta.url), 'utf8')).toContain(`'${clause}'`);
    expect(readFileSync(new URL('../../skill/references/troubleshooting.md', import.meta.url), 'utf8')).toContain(`\`${clause}\``);
  });

  it("batch-9 run 0's own rects: one stroke from the listed 577 (cut at the screen) to the listed 64 — unfit after 1 swipe, not 6 and 3 turns", () => {
    const { before, after } = B9.runs[0].listed;
    const played = replay(FULLY_LEFT, [lazyAt(before.x), lazyAt(after.x)]);
    expect(played.outcome).toMatchObject({ kind: 'unfit', swipes: 1, unfit: { along: 'horizontal', size: after.width, inferred: true } });
  });

  it("runs 1–2 (\"reached\" after 6 strokes, ending at 65): batch-9 kept only their first and last reads, not the course between — the last read alone is the fills hedge as batch-9 replied; on E2's 6-stroke course from the same start they stop unfit after 3 swipes", () => {
    for (const r of B9.runs.slice(1)) {
      expect(r.kind).toBe('reached');
      expect(r.listed.after).toEqual({ x: 65, y: 380, width: 948, height: 234 });
    }
    const { before, after } = B9.runs[1].listed;
    // The recorded reads alone: 65 lies within FIT_ROOM_PX of the carousel's 66 — not clipped, so not unfit; batch-9's own words.
    const ends = replay(FULLY_LEFT, [lazyAt(before.x), ...Array.from({ length: 8 }, () => lazyAt(after.x))]);
    expect(ends.outcome).toMatchObject({ kind: 'visible', swipes: 1 });
    expect(describeScrollResult(resultOf(ends))).toBe(`fully visible after 1 swipe${B9.runs[1].reply.slice(B9.runs[1].reply.indexOf(';'))}`);
    // E2's course (D52's record of this card's shape, from the same 574): its 4th read, C at 45 with both sides known
    // after a stroke that moved it, stops unfit — honest, C being as wide as the carousel: one offset only shows it whole.
    const course = replay(FULLY_LEFT, [before.x, 231, -102, 45, 189, 131, after.x].map((x) => lazyAt(x)));
    expect(course.steps.map((s) => s.do)).toEqual(['stroke', 'stroke', 'stroke', 'stop']);
    expect(course.outcome).toMatchObject({ kind: 'unfit', swipes: 3, unfit: { inferred: true } });
  });

  it('(4) no stroke yet: C at 45 at the first read, both sides known — no unfit, stroked for (a told axis would stop here)', () => {
    expect(play(FULLY_LEFT, [lazyAt(45)]).steps.map((s) => s.do)).toEqual(['stroke']);
  });

  it('(4) the strokes left C where it was (never moved it): no unfit — the course runs on to its own stop', () => {
    const played = replay(FULLY_LEFT, Array.from({ length: 8 }, () => lazyAt(45)));
    expect(played.outcome?.kind).not.toBe('unfit');
  });

  it("(2) a call across the carousel (`down`), C moved sideways by the strokes: no unfit", () => {
    const played = replay({ ...FULLY_LEFT, direction: 'down' }, E2_RUN_0.map((x) => lazyAt(x)));
    expect(played.outcome?.kind).not.toBe('unfit');
  });

  it('(4) the strokes that moved C were drawn off the carousel (as batch-11\'s went over the page, y 1110): no unfit', () => {
    const page = { from: { x: 864, y: 1110 }, to: { x: 216, y: 1110 } };
    const played = replay(FULLY_LEFT, E2_RUN_0.map((x, i) => ({ ...lazyAt(x), ...(i > 0 && { drawn: page }) })));
    expect(played.outcome?.kind).not.toBe('unfit');
  });

  it('(1) the room-giver is not C\'s nearest scroll view (an untold scroller as wide as the screen nested in the carousel): no unfit', () => {
    const inner = `<node index="0" text="" resource-id="" class="android.view.View" package="dev.averi.lab" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="true" long-clickable="false" password="false" selected="false" bounds="[0,380][1080,614]" />`;
    const nested = LAZY.replace(/(bounds="\[66,380\]\[1014,614\]") \/>/, `$1>${inner}</node>`);
    const played = replay(FULLY_LEFT, E2_RUN_0.map((x) => lazyAt(x, 948, nested, LC, '[0,380][1080,614]')));
    expect(played.outcome?.kind).not.toBe('unfit');
  });

  it("(3) C cut at the screen's edge on the read after the stroke (−102: its left side unknown): no unfit yet", () => {
    const played = play(FULLY_LEFT, [lazyAt(231), lazyAt(-102)]);
    expect(played.outcome).toBeUndefined();
  });

  it('a 900-wide card (48 px of room), moved by a stroke: not unfit — stroked for, as before', () => {
    const played = play(FULLY_LEFT, [lazyAt(231, 900), lazyAt(45, 900)]);
    expect(played.outcome).toBeUndefined();
  });

  it('the RecyclerView (View-cut: its card listed cut to the carousel, never clipped past it): no unfit — the flush rule as before (D68\'s slice)', () => {
    const RECYCLER = readFileSync(new URL('../fixtures/uiautomator-lab-carousel-recycler-free-launch.xml', import.meta.url), 'utf8');
    const RC = 'lab.carousel-recycler-free.C';
    /** C at app x `cx`, listed as a View child is: cut to the carousel's 66..1014. */
    const recyclerAt = (cx: number): Row => {
      const from = Math.max(cx, 66);
      return lazyAt(from, Math.min(cx + 948, 1014) - from, RECYCLER, RC);
    };
    expect(recyclerAt(66).found?.[0]?.rect).toEqual(CAROUSEL);
    expect(recyclerAt(45).found?.[0]?.rect).toEqual({ x: 66, y: 380, width: 927, height: 234 });
    // batch-10 run 0's card x after each stroke (batch-10's D62 runs, ADR 0013's D62 amendment): it creeps toward 66, cut flush, never clipped.
    const played = replay(FULLY_LEFT, [576, 433, 241, 174, 141, 117, 90].map(recyclerAt));
    expect(played.outcome?.kind).not.toBe('unfit');
  });

  it("a LazyColumn (form-picker's list, axis untold, here inset to 40..1040) under a sideways call, its row cut at both of the list's sides and never moved sideways: no unfit — never \"as wide as its scroll view\" across the list's axis", () => {
    const PICKER = readFileSync(new URL('../fixtures/uiautomator-lab-form-picker.xml', import.meta.url), 'utf8').replace('bounds="[0,221][1080,2154]"', 'bounds="[40,221][1040,2154]"');
    const LIST: Rect = { x: 40, y: 221, width: 1000, height: 1933 };
    const rowAt = (y: number): Row => {
      const tree = parseDump(PICKER);
      const fo = [...everyNode(tree)].find((n) => n.identifier === 'lab.form-picker.country.FO');
      if (fo === undefined) throw new Error('no FO');
      (fo as { rect: Rect }).rect = { x: 20, y, width: 1040, height: 140 };
      return { tree, found: [fo] };
    };
    const still = replay(FULLY_LEFT, Array.from({ length: 8 }, () => rowAt(900)));
    expect(still.outcome?.kind).not.toBe('unfit');
    for (const s of still.steps) if (s.do === 'stroke') expect(s.box).toEqual(LIST);
    // Moved, but up and down (not along the call): no unfit either.
    const vertical = replay(FULLY_LEFT, [900, 800, 700, 600, 500, 400, 300, 250].map(rowAt));
    expect(vertical.outcome?.kind).not.toBe('unfit');
  });

  it("scroll-sticky-cut (a LazyColumn, axis untold, its merged sticky header — VA1) in the D59 shape: `fully: true` along the list's axis; R growing out from under the header is no move (a size change), and R carried up through the list's bottom, moved along it, is 110 tall in 1238 — no unfit either way, the outcomes as before", () => {
    const STICKY = readFileSync(new URL('../fixtures/truth/android-averi_lab-api33/scroll-sticky-cut.xml', import.meta.url), 'utf8');
    const rAt = (bounds: string): Row => {
      const tree = parseDump(STICKY.replaceAll('bounds="[128,457][953,567]"', `bounds="${bounds}"`));
      const r = [...everyNode(tree)].find((n) => n.identifier === 'lab.scroll-sticky-cut.R');
      if (r === undefined) throw new Error('no R');
      return { tree, found: [r] };
    };
    const FULLY = { ...RULES, fully: true };
    const va1 = play({ ...FULLY, direction: 'down' }, [rAt('[128,457][953,567]'), rAt('[128,457][953,633]'), rAt('[128,457][953,633]')]);
    expect(va1.steps.map((s) => s.do)).toEqual(['stroke', 'stroke', 'stop']);
    expect(describeScrollResult(resultOf(va1))).toMatch(/^fully visible after 2 swipes; its top edge lies on the edge of container id:lab\.scroll-sticky-cut\.header/);
    const carried = replay({ ...FULLY, direction: 'down' }, [rAt('[128,1480][953,1541]'), rAt('[128,1200][953,1310]'), rAt('[128,1200][953,1310]')]);
    expect(carried.outcome).toMatchObject({ kind: 'visible' });
    expect(describeScrollResult(resultOf(carried))).toBe('fully visible after 1 swipe');
  });

  it('D68: the aim floor leaves both `unfit` paths as they were — a clipped card is no flush stop, so the flush check never measures it', () => {
    // Told axis (carousel-in-list's HorizontalScrollView), E2's course: unfit after 3 swipes, as D52.
    const told = replay(FULLY_LEFT, E2_RUN_0.map((x) => cAt(x)));
    expect(told.outcome).toMatchObject({ kind: 'unfit', swipes: 3 });
    expect(told.outcome).not.toHaveProperty('aim');
    // Inferred axis (lazy-free's LazyRow), the same course: unfit after 3 swipes, inferred, as D59.
    const inferred = replay(FULLY_LEFT, E2_RUN_0.map((x) => lazyAt(x)));
    expect(inferred.outcome).toMatchObject({ kind: 'unfit', swipes: 3, unfit: { inferred: true } });
    // No probe was sent on either course: the flush check had no cut to prove, nothing to measure.
    for (const played of [told, inferred]) expect(played.steps.some((s) => s.do === 'stroke' && s.probe === true)).toBe(false);
  });

  it('a told axis is unchanged: carousel-in-list (HorizontalScrollView) stops on its first read with both sides known, no inference said', () => {
    const played = play(FULLY_LEFT, [cAt(40, 1000)]);
    expect(played.outcome).toMatchObject({ kind: 'unfit', swipes: 0 });
    expect(played.outcome !== undefined && 'unfit' in played.outcome && played.outcome.unfit).not.toHaveProperty('inferred');
    expect(failureOf(played, 'C').message).not.toMatch(/does not say which way/);
  });
});

/**
 * D68: `fully: true` on the lab's RecyclerView carousel (carousel-recycler-free: C a View child exactly as wide as the
 * carousel, listed cut flush to it, so never `clipped` and never D52's or D59's `unfit`). The flush check's probe
 * proves the cut, and each reveal travels half the room left (course.ts#probeOf); short drags carry the card less than
 * their length, so batch-10's 10 runs (tests/fixtures/d68-b10-recycler-convergence.json) all ended `maxSwipes`, 15–28
 * px short, saying "raise maxSwipes". Once the room left on C's uncut side is under what a stroke no longer than the
 * next one carried it in this call, no swipe shows it whole (interact/aim-floor.ts): the round stops, sending nothing.
 */
describe('`fully: true` on a View-cut card no swipe can bring whole (D68): the stop once the shortest measured stroke carries it past the room left', () => {
  const RECYCLER = readFileSync(new URL('../fixtures/uiautomator-lab-carousel-recycler-free-launch.xml', import.meta.url), 'utf8');
  const RC = 'lab.carousel-recycler-free.C';
  const B10 = JSON.parse(readFileSync(new URL('../fixtures/d68-b10-recycler-convergence.json', import.meta.url), 'utf8')) as {
    runs: { run: number; clip: Rect; strokes: { from: { x: number }; to: { x: number } }[]; cardX: number[]; listed: { after: Rect }; reply: string }[];
  };
  const FULLY_LEFT = { ...RULES, direction: 'left' as const, fully: true };
  /** The recycler-free launch tree with C laid in its RecyclerView at app x `cx`, listed as a View child is: cut to the carousel's 66..1014. */
  const recyclerAt = (cx: number): Row => {
    const from = Math.max(cx, 66);
    const to = Math.min(cx + 948, 1014);
    const card = `<node index="0" text="" resource-id="${RC}" class="android.view.View" package="dev.averi.lab" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[${from},380][${to},614]" />`;
    const laid = RECYCLER.replace('bounds="[66,380][1014,614]" />', `bounds="[66,380][1014,614]">${card}</node>`);
    if (laid === RECYCLER) throw new Error('recyclerAt: no RecyclerView');
    const tree = parseDump(laid);
    const c = [...everyNode(tree)].find((n) => n.identifier === RC);
    if (c === undefined) throw new Error('no C');
    return { tree, found: [c] };
  };
  const replay = (rules: RoundRules & { screen: { width: number; height: number } }, rows: readonly Row[]): ReturnType<typeof play> => {
    for (let i = 1; i <= rows.length; i++) {
      const played = play(rules, rows.slice(0, i));
      if (played.outcome !== undefined) return played;
    }
    throw new Error('replay: no stop');
  };
  const run = (n: number) => B10.runs[n];
  /** The runs whose last read leaves less room than the least carry of their two 48-px strokes, less a pixel. */
  const STOPPED = [1, 2, 3, 4, 7, 8, 9];

  it('the record: every run maxSwipes after 6 strokes, C listed cut flush to the carousel at the end, "raise maxSwipes"', () => {
    expect(B10.runs).toHaveLength(10);
    for (const r of B10.runs) {
      expect(r.clip).toEqual(CAROUSEL);
      expect(r.reply).toMatch(/failed after 6 swipes \(maxSwipes\) — element reached the viewport but its right edge still lies on its scroll container's \(66,380 948x234\).*raise maxSwipes or timeoutMs$/);
      expect(r.listed.after).toEqual({ x: r.cardX[6], y: 380, width: 1014 - r.cardX[6], height: 234 });
      expect(r.strokes.slice(4).map((s) => s.from.x - s.to.x)).toEqual([48, 48]);
    }
    expect(recyclerAt(81).found?.[0]?.rect).toEqual(run(8).listed.after);
  });

  it("averi's own course on run 8's card: the same six strokes — the probe, then reveals of half the room down to the 48-px floor", () => {
    const played = play(FULLY_LEFT, run(8).cardX.map(recyclerAt));
    expect(travels(played)).toEqual(run(8).strokes.map((s) => s.from.x - s.to.x));
  });

  it('run 8: 15 px left, its 48-px strokes carried C 27 px each — the stop after 6 swipes, no 7th stroke even with swipes left, and the reply never says "raise maxSwipes"', () => {
    for (const maxSwipes of [6, 10]) {
      const played = replay({ ...FULLY_LEFT, maxSwipes }, run(8).cardX.map(recyclerAt));
      expect(played.steps.filter((s) => s.do === 'stroke')).toHaveLength(6);
      expect(played.outcome).toMatchObject({ kind: 'unaimable', swipes: 6, aim: { edge: 'right', container: CAROUSEL, revealed: 27, overshoot: { room: 15, drawn: 48, moved: 27 } } });
      expect(failureOf(played, `id:${RC}`).message).toBe(
        `scroll_until id:${RC} stopped after 6 swipes, without swiping further — element is on screen but its right edge still lies on its scroll container's (66,380 948x234), ` +
          "where Android cuts a node's bounds to the container, and the last swipe toward it showed 27 px more of it — part of it likely lies past that edge still; " +
          'in this call a 48-px swipe, no longer than the next would be, moved it 27 px, and only 15 px of room remain on its left side, ' +
          'so another swipe would most likely push its left side out past its scroll container rather than show it whole — ' +
          'act on the part that shows (a tap, or an assert on a child inside it), or drop fully: true; more swipes are unlikely to help. ' +
          'Last rect {"x":81,"y":380,"width":933,"height":234} in a 1080x2220 viewport',
      );
    }
  });

  it('the agent-facing references quote the reply as the code words it (skill/references/tools.md, troubleshooting.md)', () => {
    const message = failureOf(replay(FULLY_LEFT, run(8).cardX.map(recyclerAt)), 'C').message;
    const said = message.slice(message.indexOf('element is on screen'), message.indexOf('. Last rect'));
    expect(readFileSync(new URL('../../skill/references/tools.md', import.meta.url), 'utf8')).toContain(`'${said}'`);
    const tail = message.slice(message.indexOf(', no longer than the next would be,'), message.indexOf('. Last rect')).replace(/its left side/g, 'its <side> side').replace('moved it 27 px', 'moved it P px').replace('only 15 px', 'only M px');
    expect(readFileSync(new URL('../../skill/references/troubleshooting.md', import.meta.url), 'utf8')).toContain(`K-px swipe${tail}\`**`);
  });

  it.each(B10.runs.map((r) => [r.run, STOPPED.includes(r.run)] as const))('run %d: the stop %s — else maxSwipes and the flush cut as batch-10 replied', (n, stops) => {
    const played = replay(FULLY_LEFT, run(n).cardX.map(recyclerAt));
    const room = run(n).cardX[6] - 66;
    if (stops) {
      expect(played.outcome).toMatchObject({ kind: 'unaimable', swipes: 6, aim: { overshoot: { room } } });
      expect(failureOf(played, `id:${RC}`).message).not.toMatch(/raise maxSwipes/);
    } else {
      expect(played.outcome).toMatchObject({ kind: 'bound', swipes: 6, by: { of: 'maxSwipes' }, short: { of: 'flushCut' } });
      expect(failureOf(played, `id:${RC}`).message).toBe(run(n).reply.replace(/^ERROR /, ''));
    }
  });

  it('room left no smaller than the least measured carry (run 0: 24 px, carried 24 and 27): with swipes left, the next reveal is sent, as before', () => {
    const played = play({ ...FULLY_LEFT, maxSwipes: 10 }, run(0).cardX.map(recyclerAt));
    expect(played.outcome).toBeUndefined();
    expect(travels(played)).toEqual([...run(0).strokes.map((s) => s.from.x - s.to.x), 48]);
  });

  it('no stroke no longer than the next measured yet: no stop — run 8 cut short to 15 px of room after its 89-px reveal (the next a 48-px one) is stroked for', () => {
    const played = play(FULLY_LEFT, [577, 442, 244, 81].map(recyclerAt));
    expect(played.outcome).toBeUndefined();
    expect(travels(played)).toEqual([142, 188, 89, 48]);
  });

  it('no stroke measured at all: at the bound before any probe, the stop unchecked as before — never this one', () => {
    const played = play({ ...FULLY_LEFT, maxSwipes: 0 }, [recyclerAt(81)]);
    expect(played.outcome).toMatchObject({ kind: 'visible', flush: { checked: false, why: 'budget' } });
  });
});
