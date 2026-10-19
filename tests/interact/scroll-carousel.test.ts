import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { SETTLE_CONFIRM_READS, type RoundRules } from '../../src/interact/scroll-rounds.js';
import { UNMEASURED_CARRY } from '../../src/interact/stroke-plan.js';
import { describeScrollResult } from '../../src/interact/scroll-text.js';
import { play, resultOf, strokesToward, type Row } from '../helpers/rounds.js';

/**
 * A card of a carousel a scroll flings past (lab note,
 * docs/bugs/2026-10-18-lab-ios-wda-carousel-stop-claimed-while-the-fling-carries-the-card-past-its-centre.md), over the
 * lab app's real `carousel-in-list` WDA capture at rest: the carousel 24,138 354x85 lists its content 24,138 1062x85, C
 * at 378,138 354x85 wholly right of it — as wide as the carousel, so whole at one offset only (354), its centre inside
 * over offsets 177–531. A read at `offset` is that capture with the carousel's content shifted left by it, as WDA lists
 * a scrolled UIScrollView's content. Measured live (round 7, the lab simulator, `scroll_until` C `right`): one stroke
 * `307 181 → 95 181` flung the carousel 447, 454, 495 and 532 pt by run, and the reads after it, 0.47 s apart, found C
 * at x 7, −47, −68, −76 (at rest −75.7) and −16, −82, −106, −116 (at rest −117) — still moving at the third
 * confirming read, where the stop was claimed "still moving".
 */

const CAPTURE = parseWdaSource(readFileSync(new URL('../fixtures/wda-capture-lab-carousel-in-list.json', import.meta.url), 'utf8'));
const CAROUSEL: Rect = { x: 24, y: 138, width: 354, height: 85 };
const C = 'lab.carousel-in-list.C';
const RULES: RoundRules & { screen: { width: number; height: number } } = { direction: 'right', fully: false, maxSwipes: 6, timeoutMs: 15_000, screen: { width: 402, height: 874 } };

/** The capture with the carousel scrolled to `offset`: every node under it moved left by that much. */
function scrolled(offset: number): UiNode {
  const shift = (n: UiNode): UiNode => ({ ...n, rect: { ...n.rect, x: n.rect.x - offset }, children: n.children.map(shift) });
  const walk = (n: UiNode): UiNode =>
    n.role === 'scrollable' && n.rect.x === CAROUSEL.x && n.rect.width === CAROUSEL.width ? { ...n, children: n.children.map(shift) } : { ...n, children: n.children.map(walk) };
  return walk(CAPTURE);
}

/** One read of the carousel with C at screen x `cx` (the carousel at offset 378 − cx). */
const cAt = (cx: number): Row => {
  const tree = scrolled(378 - cx);
  return { tree, found: [...everyNode(tree)].filter((n) => n.identifier === C) };
};

describe('a carousel card a fling carries: the stop judged on the read the fling comes to rest in', () => {
  it('the capture: C wholly right of the carousel at rest', () => {
    expect(cAt(378).found?.[0]?.rect).toEqual({ x: 378, y: 138, width: 354, height: 85 });
    expect(cAt(-76).found?.[0]?.rect.x).toBe(-76);
  });

  it(`a fling slowing read for read is waited out past SETTLE_CONFIRM_READS (${SETTLE_CONFIRM_READS}): the measured run, stopped settled at rest, not "still moving" at −76`, () => {
    const played = play(RULES, [cAt(378), cAt(7), cAt(-47), cAt(-68), cAt(-76), cAt(-76)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'confirm', 'confirm', 'confirm', 'confirm', 'stop']);
    expect(played.outcome).toMatchObject({ kind: 'visible', swipes: 1, settled: true });
    expect(describeScrollResult(resultOf(played))).not.toMatch(/still moving/);
  });

  it('the run whose fling carried C\'s centre out of the carousel (at rest at −154): no stop claimed on the reads that still had it inside — the strokes turn back once it rests outside', () => {
    // C's centre is inside the carousel (x ≥ 24) down to x −153; the fling slows through −60, −105, −133, −146, −151 and
    // rests at −154, where the stroke turns; the turned stroke brings C to 40.
    const played = play(RULES, [cAt(378), cAt(10), cAt(-60), cAt(-105), cAt(-133), cAt(-146), cAt(-151), cAt(-154), cAt(40), cAt(40)]);
    expect(played.steps.slice(0, 8).map((s) => s.do)).toEqual(['stroke', 'confirm', 'confirm', 'confirm', 'confirm', 'confirm', 'confirm', 'stroke']);
    expect(strokesToward(played)).toEqual(['right', 'left']);
    expect(played.outcome).toMatchObject({ kind: 'visible', swipes: 2, settled: true });
  });

  it('a target moving as much at every read (an animation, not a fling) still spends the budget: reported after SETTLE_CONFIRM_READS reads, "still moving"', () => {
    const played = play(RULES, [cAt(378), cAt(100), cAt(90), cAt(80), cAt(70)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'confirm', 'confirm', 'confirm', 'stop']);
    expect(played.outcome).toMatchObject({ kind: 'visible', settled: false });
  });

  it(`the first stroke is cut to what C needs at UNMEASURED_CARRY (${UNMEASURED_CARRY}) a point — ≈ 126 pt of the full 212 — touching down where the full one does, inside the carousel along its axis`, () => {
    const played = play(RULES, [cAt(378), cAt(100), cAt(100)]);
    const first = played.steps.find((s) => s.do === 'stroke');
    if (first?.do !== 'stroke' || first.points === undefined) throw new Error('no stroke');
    expect(first.box).toEqual(CAROUSEL);
    expect(first.points.from).toEqual({ x: 307, y: 181 });
    const travel = first.points.from.x - first.points.to.x;
    expect(travel).toBeCloseTo(354 / UNMEASURED_CARRY, 0);
    // At the measured spread (2.1–2.5 a point) C's centre lands inside the carousel, short of the window's end (offset 531).
    for (const perPoint of [447 / 212, 532 / 212]) expect(travel * perPoint).toBeGreaterThan(177);
    for (const perPoint of [447 / 212, 532 / 212]) expect(travel * perPoint).toBeLessThan(531);
  });
});
