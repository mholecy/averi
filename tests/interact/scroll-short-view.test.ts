import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { round, startRounds, type RoundRules, type RoundSeen, type ScrollOutcome } from '../../src/interact/scroll-rounds.js';
import type { UsableScreen } from '../../src/ui-tree/usable-screen.js';

/**
 * What the target still needs (interact/scroll-rounds.ts#stillNeeds, lab note LV5,
 * docs/bugs/2026-10-17-lab-ios-wda-scroll-until-overshoots-a-row-of-a-short-scroll-view-and-spends-its-budget.md): a
 * stroke's reach no further than the target still needs, at what a stroke of this scroll was measured to carry it. The
 * rounds are driven against a model of the measured physics over the lab app's real `scroll-bounded` WDA capture:
 * each stroke moves `lower` (0,380 402x180) by its drag × a fling factor (measured: a 108-pt drag moved it about 259 pt,
 * ≈ 2.4 ×; the three runs spread 226–263 pt a stroke), clamped to its content (0–1120); F (content y 1380, 64 tall) is
 * whole in `lower` for offsets 884–1000 only. A read finds `lower` where the last stroke left it.
 */

const CAPTURE = parseWdaSource(readFileSync(new URL('../fixtures/wda-capture-lab-scroll-bounded.json', import.meta.url), 'utf8'));
const LOWER: Rect = { x: 0, y: 380, width: 402, height: 180 };
const F = 'lab.scroll-bounded.F';
const BOX: Rect = { x: 0, y: 0, width: 402, height: 874 };
const SCREEN: UsableScreen = { box: BOX, boxes: [BOX], oriented: BOX, from: 'device' };
const RULES: RoundRules = { direction: 'down', fully: false, maxSwipes: 6, timeoutMs: 15_000 };
/** F whole in `lower`: the window of its offsets. */
const WINDOW = { from: 884, to: 1000 };

function scrolled(offset: number): UiNode {
  const shift = (n: UiNode): UiNode => ({ ...n, rect: { ...n.rect, y: n.rect.y - offset }, children: n.children.map(shift) });
  const walk = (n: UiNode): UiNode =>
    n.role === 'scrollable' && n.rect.y === LOWER.y && n.rect.height === LOWER.height ? { ...n, children: n.children.map(shift) } : { ...n, children: n.children.map(walk) };
  return walk(CAPTURE);
}

/** Run the rounds against the model: the k-th stroke carries `lower` its drag × `fling(k)`. */
function drive(fling: (k: number) => number, rules: RoundRules = RULES): { outcome: ScrollOutcome; offset: number; drags: number[] } {
  let state = startRounds(rules, { width: 402, height: 874 });
  let offset = 0;
  const drags: number[] = [];
  let drawn: RoundSeen['drawn'];
  for (let i = 0; i < 40; i++) {
    const tree = scrolled(offset);
    const seen: RoundSeen = {
      read: { tree, found: [...everyNode(tree)].filter((n) => n.identifier === F), ofKeyboard: () => false, remedy: { dismissal: 'none' } },
      screen: SCREEN,
      elapsedMs: 0,
      readMs: 0,
      ...(drawn !== undefined && { drawn }),
    };
    let next = round(state, seen);
    while (next.step.do === 'ask') {
      if (next.step.what === 'witness') seen.corroborated = true;
      else seen.unlocated = false;
      next = round(state, seen);
    }
    state = next.state;
    const { step } = next;
    drawn = undefined;
    if (step.do === 'stop') return { outcome: step.outcome, offset, drags };
    if (step.do === 'stroke') {
      const points = step.points;
      if (points === undefined) throw new Error('no points');
      const drag = points.from.y - points.to.y; // content down: the finger moves up
      drags.push(drag);
      offset = Math.min(1120, Math.max(0, offset + drag * fling(drags.length)));
      drawn = points;
    }
  }
  throw new Error('no stop');
}

describe('a stroke no further than the target still needs — a short scroll view\'s strokes do not carry a target past its window (WDA)', () => {
  it('the run that failed (≈ 263 pt a stroke, 2.44 × the drag): three full strokes, then one at what F still needs — whole in `lower`, no turn', () => {
    const { outcome, offset, drags } = drive(() => 263 / 108);
    expect(drags.slice(0, 3)).toEqual([108, 108, 108]);
    // 789 after three; the window's middle is 942: ≈ 153 pt left, ≈ 0.58 of a stroke.
    expect(drags[3]).toBeGreaterThan(55);
    expect(drags[3]).toBeLessThan(70);
    expect(offset).toBeGreaterThanOrEqual(WINDOW.from);
    expect(offset).toBeLessThanOrEqual(WINDOW.to);
    expect(outcome).toMatchObject({ kind: 'visible', swipes: 4 });
  });

  it('across the spread the runs measured (226–263 pt a stroke, constant or varying stroke to stroke) F lands in its window', () => {
    const spreads: ((k: number) => number)[] = [() => 226 / 108, () => 245 / 108, () => 263 / 108, (k) => (k % 2 === 0 ? 226 : 263) / 108, (k) => (k % 2 === 0 ? 263 : 226) / 108];
    for (const fling of spreads) {
      const { outcome, offset } = drive(fling);
      expect(outcome).toMatchObject({ kind: 'visible' });
      expect(offset).toBeGreaterThanOrEqual(WINDOW.from);
      expect(offset).toBeLessThanOrEqual(WINDOW.to);
      expect(outcome.kind === 'visible' && outcome.swipes).toBeLessThanOrEqual(5);
    }
  });

  it('nothing measured yet, or a target already in its window, keeps the full reach: the first stroke is the plan\'s whole stroke', () => {
    const { drags } = drive(() => 263 / 108);
    expect(drags[0]).toBe(108);
  });

  it('with the end turn (LV4): F asked `up` — one stroke up proves `lower` at its top, the turn down, three full strokes and one short — within the default six swipes', () => {
    const { outcome, offset, drags } = drive(() => 263 / 108, { ...RULES, direction: 'up' });
    expect(drags[0]).toBe(-108);
    expect(offset).toBeGreaterThanOrEqual(WINDOW.from);
    expect(offset).toBeLessThanOrEqual(WINDOW.to);
    expect(outcome).toMatchObject({ kind: 'visible', swipes: 5, endTurn: { from: 'up', to: 'down', after: 1 } });
  });
});
