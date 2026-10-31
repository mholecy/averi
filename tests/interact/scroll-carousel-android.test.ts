import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { type RoundRules } from '../../src/interact/scroll-rounds.js';
import { UNKNOWN_CENTRE_MIN_GAP, unknownCentreNeeds } from '../../src/interact/course.js';
import { UNMEASURED_CARRY } from '../../src/interact/stroke-plan.js';
import { describeScrollResult } from '../../src/interact/scroll-text.js';
import { parseDump } from '../helpers/android-dumps.js';
import { play, resultOf, strokesToward, type Row } from '../helpers/rounds.js';

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

/** One read with C laid at screen x `cx`, 948 wide, listed cut at the screen's edges. */
const cAt = (cx: number): Row => {
  const tree: UiNode = parseDump(XML);
  const c = [...everyNode(tree)].find((n) => n.identifier === C);
  if (c === undefined) throw new Error('no C');
  const from = Math.max(cx, 0);
  (c as { rect: Rect }).rect = { x: from, y: 380, width: Math.min(cx + 948, 1080) - from, height: 234 };
  return { tree, found: [c] };
};

/** The finger's travel of each stroke, along x (content right: the finger moves left). */
const travels = (played: ReturnType<typeof play>): number[] => played.steps.flatMap((s) => (s.do === 'stroke' && s.points !== undefined ? [s.points.from.x - s.points.to.x] : []));

describe("a card cut at the screen's edge (D17): its centre unknown — one more stroke, cut to bring its known side to the carousel's, then the stop", () => {
  it('the dump: C at rest `[1014,380][1080,614]`; laid at 586, `[586,380][1080,614]`', () => {
    expect(cAt(1014).found?.[0]?.rect).toEqual({ x: 1014, y: 380, width: 66, height: 234 });
    expect(cAt(586).found?.[0]?.rect).toEqual({ x: 586, y: 380, width: 494, height: 234 });
  });

  it(`the live run: one full stroke left C at 382 — one more, cut to its left side's 316 px to the carousel's at UNMEASURED_CARRY (${UNMEASURED_CARRY}) a point, toward it; then the stop says "at most"`, () => {
    const played = play(RULES, [cAt(1014), cAt(382), cAt(257)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stroke', 'stop']);
    expect(strokesToward(played)).toEqual(['right', 'right']);
    const [, extra] = travels(played);
    expect(extra).toBeCloseTo(316 / UNMEASURED_CARRY, 0);
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
    expect(travels(played)[0]).toBeCloseTo(520 / UNMEASURED_CARRY, 0);
  });

  it('bounded — ONE such stroke a scroll: a carousel exactly one card wide, the stroke moving it little or nothing, stops on the next read, "at most"', () => {
    for (const after of [382, 370]) {
      const played = play(RULES, [cAt(1014), cAt(382), cAt(after)]);
      expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stroke', 'stop']);
      expect(describeScrollResult(resultOf(played))).toMatch(/^visible after 2 swipes — CLIPPED at right, at most \d+% of it is in the viewport/);
    }
  });

  it('no such stroke where it cannot bring the rest in without pushing the known side past the carousel: its left side within twice the shortest drag of the carousel\'s', () => {
    const played = play(RULES, [cAt(66 + 200)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stop']);
    expect(describeScrollResult(resultOf(played))).toMatch(/^visible after 0 swipes — CLIPPED at right, at most \d+% of it is in the viewport/);
  });

  it("never as a turn: content asked LEFT, C's unknown side on the right — a stroke toward it would turn the course: the stop as before, \"at most\"", () => {
    const played = play({ ...RULES, direction: 'left' }, [cAt(382)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stop']);
    expect(describeScrollResult(resultOf(played))).toMatch(/at most 91% of it is in the viewport — uiautomator does not say how far it runs past the screen's right edge/);
  });

  it('nor at the bound: the last swipe spent, the stop is made', () => {
    const played = play({ ...RULES, maxSwipes: 1 }, [cAt(1014), cAt(382)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stop']);
    expect(played.outcome).toMatchObject({ kind: 'visible', swipes: 1 });
  });

  it('a card whose right side is known (inside the screen) is stopped on as before: no "at most"', () => {
    const played = play(RULES, [cAt(1014), cAt(40)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stop']);
    expect(describeScrollResult(resultOf(played))).not.toMatch(/at most/);
  });
});

describe('course.ts#unknownCentreNeeds — what one more stroke needs for a target whose centre is unknown', () => {
  const frame = CAROUSEL;
  it("its near side unknown, its far side known and UNKNOWN_CENTRE_MIN_GAP or more inside the frame's far edge: that distance, no slack — along either axis", () => {
    expect(unknownCentreNeeds({ x: 382, y: 380, width: 698, height: 234 }, ['right'], frame, 'right')).toEqual({ needs: 316, slack: 0 });
    expect(unknownCentreNeeds({ x: 0, y: 380, width: 700, height: 234 }, ['left'], frame, 'left')).toEqual({ needs: 314, slack: 0 });
    expect(unknownCentreNeeds({ x: 0, y: 1200, width: 1080, height: 1020 }, ['bottom'], { x: 0, y: 300, width: 1080, height: 1700 }, 'down')).toEqual({ needs: 900, slack: 0 });
  });
  it(`none with the gap under ${UNKNOWN_CENTRE_MIN_GAP}, with both sides unknown, with the side toward it known (the far one, or one across the axis, unknown), or with none`, () => {
    const rect = { x: 382, y: 380, width: 698, height: 234 };
    expect(unknownCentreNeeds({ ...rect, x: 66 + UNKNOWN_CENTRE_MIN_GAP - 1 }, ['right'], frame, 'right')).toBeUndefined();
    expect(unknownCentreNeeds({ ...rect, x: 66 + UNKNOWN_CENTRE_MIN_GAP }, ['right'], frame, 'right')).toEqual({ needs: UNKNOWN_CENTRE_MIN_GAP, slack: 0 });
    expect(unknownCentreNeeds({ x: 0, y: 380, width: 1080, height: 234 }, ['left', 'right'], frame, 'right')).toBeUndefined();
    expect(unknownCentreNeeds(rect, ['right'], frame, 'left')).toBeUndefined();
    expect(unknownCentreNeeds(rect, ['top'], frame, 'right')).toBeUndefined();
    expect(unknownCentreNeeds(rect, undefined, frame, 'right')).toBeUndefined();
  });
});
