import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import type { RoundRules } from '../../src/interact/scroll-rounds.js';
import { describeScrollResult } from '../../src/interact/scroll-text.js';
import { planStroke, seeRead, startStrokes, strokedEnd, strokeSent } from '../../src/interact/stroke-plan.js';
import { largestScroller } from '../../src/ui-tree/geometry.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { node } from '../helpers/fake.js';
import { decided, failureOf, play, resultOf, strokesToward, type Row } from '../helpers/rounds.js';

/**
 * The END TURN (interact/scroll-rounds.ts#EndTurn; lab note LV4,
 * docs/bugs/2026-10-17-lab-ios-scroll-until-never-turns-toward-a-target-past-the-far-edge-when-no-stroke-moved-the-list.md)
 * and the end proof it rests on (#Observed.ends, interact/stroke-plan.ts#strokedEnd, ui-tree/geometry.ts#Clips.endsAt),
 * over the real WDA capture of the lab app's `scroll-bounded` at rest: `lower` (0,380 402x180) at its top, its content
 * listed at 0,380 402x1300, F at 51,1380 300x64 — 820 pt below what `lower` shows. A moved read is that capture with
 * `lower`'s content shifted up by the offset, as WDA lists a scrolled UIScrollView's content.
 */

const CAPTURE = parseWdaSource(readFileSync(new URL('../fixtures/wda-capture-lab-scroll-bounded.json', import.meta.url), 'utf8'));
const LOWER: Rect = { x: 0, y: 380, width: 402, height: 180 };
const F = 'lab.scroll-bounded.F';
type Rules = RoundRules & { screen: { width: number; height: number } };
const IPHONE: Rules = { direction: 'up', fully: false, maxSwipes: 6, timeoutMs: 15_000, screen: { width: 402, height: 874 } };

/** The capture with `lower` scrolled to `offset`: every node under it moved up by that much. */
function scrolled(offset: number): UiNode {
  const shift = (n: UiNode, by: number): UiNode => ({ ...n, rect: { ...n.rect, y: n.rect.y - by }, children: n.children.map((c) => shift(c, by)) });
  const walk = (n: UiNode): UiNode =>
    n.role === 'scrollable' && n.rect.y === LOWER.y && n.rect.height === LOWER.height ? { ...n, children: n.children.map((c) => shift(c, offset)) } : { ...n, children: n.children.map(walk) };
  return walk(CAPTURE);
}

/** One read of `lower` at `offset`, finding `id`. */
const at = (offset: number, id = F): Row => {
  const tree = scrolled(offset);
  return { tree, found: [...everyNode(tree)].filter((n) => n.identifier === id) };
};

describe('the end proof — the tree lists where a scroll view\'s content ends (WDA only)', () => {
  it('the capture: `lower` at rest lists nothing above its top, and 1120 pt below its bottom; scrolled 300 pt it lists content above', () => {
    const { clips } = sceneOf(CAPTURE);
    expect(clips.endsAt(LOWER, 'top')?.rect).toEqual(LOWER);
    expect(clips.endsAt(LOWER, 'bottom')).toBeUndefined();
    expect(sceneOf(scrolled(300)).clips.endsAt(LOWER, 'top')).toBeUndefined();
    // No scroll view of that rect in the tree: nothing to say.
    expect(clips.endsAt({ x: 0, y: 0, width: 10, height: 10 }, 'top')).toBeUndefined();
  });

  it('finds the scroll view by its exact rect, as its axes are found: one remembered half a pixel off proves nothing', () => {
    const { clips } = sceneOf(CAPTURE);
    const off: Rect = { ...LOWER, y: LOWER.y + 0.5 };
    expect(clips.axesOf(off)).toBeUndefined();
    expect(clips.endsAt(off, 'top')).toBeUndefined();
  });

  it('only along the axis the scroll view scrolls on: a horizontal carousel lists nothing below its bottom, and that proves no end for a vertical stroke', () => {
    const carousel: Rect = { x: 24, y: 138, width: 354, height: 85 };
    const tree = node({
      role: 'container',
      unclippedFrames: true,
      rect: { x: 0, y: 0, width: 402, height: 874 },
      children: [node({ role: 'scrollable', rect: carousel, children: [node({ role: 'other', rect: { x: 24, y: 138, width: 1416, height: 85 } })] })],
    });
    const { clips } = sceneOf(tree);
    expect(clips.endsAt(carousel, 'bottom')).toBeUndefined();
    expect(clips.endsAt(carousel, 'top')).toBeUndefined();
    // Along its axis it does: nothing of it left of its left edge.
    expect(clips.endsAt(carousel, 'left')?.rect).toEqual(carousel);
  });

  it('uiautomator\'s dialect (rects cut to their clipping scroll container) never proves an end: content past the edge would read flush with it', () => {
    const list: Rect = { x: 0, y: 303, width: 1080, height: 605 };
    const tree = node({ role: 'container', rect: { x: 0, y: 0, width: 1080, height: 2220 }, children: [node({ role: 'scrollable', rect: list, clipsDescendants: true, children: [node({ role: 'button', rect: { x: 128, y: 303, width: 825, height: 176 } })] })] });
    expect(sceneOf(tree).clips.endsAt(list, 'top')).toBeUndefined();
  });

  it('strokedEnd asks it of the scroll view the last stroke SENT went over, the edge the stroke\'s direction brings content in through', () => {
    const facts = { scene: sceneOf(CAPTURE), mainScroller: largestScroller(CAPTURE) };
    const f = [...everyNode(CAPTURE)].find((n) => n.identifier === F);
    const seen = seeRead(startStrokes(), { facts, line: undefined, target: f });
    const plan = planStroke(seen, { toward: 'up', reach: 1, gesture: { x: 0, y: 0, width: 402, height: 874 }, read: { facts, target: f } });
    expect(plan.stroke.box).toEqual(LOWER);
    // Planned, not sent: no stroke went over anything yet.
    expect(strokedEnd(plan.memory, facts, 'up')).toBeUndefined();
    const sent = strokeSent(plan.memory);
    expect(strokedEnd(sent, facts, 'up')?.rect).toEqual(LOWER);
    expect(strokedEnd(sent, facts, 'down')).toBeUndefined();
  });
});

describe('round — the end turn: the caller\'s way first, proven exhausted, then once toward a target past the far edge of that scroll view', () => {
  it('F asked `up` from `lower` at its top (the live case): one stroke up moves nothing and the tree lists nothing above — turned down at full reach, and the reply says averi turned', () => {
    const rows = [at(0), at(0), at(260), at(520), at(780), at(930), at(930)];
    const played = play(IPHONE, rows);
    expect(strokesToward(played)).toEqual(['up', 'down', 'down', 'down', 'down']);
    // The turned strokes keep the full reach: no fling carried F past — it was never near.
    // (The last is shortened to what F still needs once a stroke was measured to carry it: scroll-rounds.ts#stillNeeds, LV5.)
    expect(played.steps.flatMap((s) => (s.do === 'stroke' ? [decided(s)] : [])).slice(0, 4)).toMatchObject([{ reach: 1 }, { reach: 1 }, { reach: 1 }, { reach: 1 }]);
    expect(played.outcome).toMatchObject({ kind: 'visible', swipes: 5, endTurn: { from: 'up', to: 'down', after: 1, unmoved: 1 } });
    expect(describeScrollResult(resultOf(played))).toBe(
      'fully visible after 5 swipes; 1 swipe up did not move scrollable (0,380 402x180) — the tree lists its content ending at its top — so averi turned down, as the tree places the element below it',
    );
  });

  it('a failure after the turn says so too, and counts no fling\'s turn', () => {
    const played = play({ ...IPHONE, maxSwipes: 3 }, [at(0), at(0), at(260), at(520)]);
    expect(strokesToward(played)).toEqual(['up', 'down', 'down']);
    expect(played.outcome).toMatchObject({ kind: 'bound', by: { of: 'maxSwipes' }, turns: 0 });
    const message = failureOf(played, `id:"${F}"`).message;
    expect(message).toMatch(/failed after 3 swipes \(maxSwipes\)/);
    expect(message).not.toMatch(/turned round/);
    expect(message).toMatch(/; 1 swipe up did not move scrollable \(0,380 402x180\) — the tree lists its content ending at its top — so averi turned down, as the tree places the element below it$/);
  });

  it('a stroke that moved nothing over a scroll view whose content runs on that way is no proof (a stroke not taken): the caller\'s way twice, no turn, the failure advising the other way as before', () => {
    // `lower` scrolled 300: 300 pt of its content lies above its top; F (now at 1080) still below.
    const played = play(IPHONE, [at(300), at(300), at(300)]);
    expect(strokesToward(played)).toEqual(['up', 'up']);
    expect(played.outcome).not.toHaveProperty('endTurn');
    expect(failureOf(played, `id:"${F}"`).message).toMatch(
      /failed after 2 swipes \(the last 2, swiping up, did not move it: content exhausted, or the swipes were not taken\) — .*it lay below the viewport, past the edge the swipes push it out through: scroll_until it with direction: "down"$/,
    );
  });

  it('a stroke that touched down on a node drawn over its scroll view proves nothing in one: that node may have taken it — two strokes, the failure naming it first, as before', () => {
    const bar = node({ role: 'other', label: 'bar', rect: { x: 0, y: 400, width: 402, height: 40 } });
    const covered = (row: Row): Row => {
      const tree = row.tree as UiNode;
      return { ...row, tree: { ...tree, children: [...tree.children, bar] } };
    };
    const played = play(IPHONE, [covered(at(0)), covered(at(0)), covered(at(0))]);
    expect(strokesToward(played)).toEqual(['up', 'up']);
    expect(played.outcome).not.toHaveProperty('endTurn');
    expect(failureOf(played, `id:"${F}"`).message).toMatch(/the last 2, swiping up, did not move it: they touched down at 201,416 on other "bar"/);
  });

  it('no swipe left for the turn: the failure is the proof\'s, after the one stroke, and names the side the tree places it on', () => {
    const played = play({ ...IPHONE, maxSwipes: 1 }, [at(0), at(0)]);
    expect(strokesToward(played)).toEqual(['up']);
    expect(failureOf(played, `id:"${F}"`).message).toMatch(
      /failed after 1 swipe \(swiping up did not move it: the tree lists the content of scrollable \(0,380 402x180\) ending at its top — content exhausted\) — .*scroll_until it with direction: "down"$/,
    );
  });

  it('once only: strokes the other way that the tree then shows at that end too stop on the proof, not turn back again', () => {
    // A replayed tree never moves: down is not at its end, so the old two-stroke rule ends it — no second turn.
    const played = play(IPHONE, [at(0), at(0), at(0), at(0)]);
    expect(strokesToward(played)).toEqual(['up', 'down', 'down']);
    expect(played.outcome).toMatchObject({ kind: 'bound', by: { of: 'exhausted', lastStroke: 'down' }, endTurn: { from: 'up', to: 'down' } });
  });

  it('a target not in the tree: no scroll view of its own is known — on WDA no node clips, so no largest scroller either — and a stroke over the screen box proves no end: two unmoved strokes, as before', () => {
    const played = play(IPHONE, [at(0, 'nope'), at(0, 'nope'), at(0, 'nope')]);
    expect(strokesToward(played)).toEqual(['up', 'up']);
    expect(failureOf(played, 'id:"nope"').message).toMatch(/failed after 2 swipes \(the last 2, swiping up, did not change the screen: content exhausted, still loading, or the swipes were not taken\)/);
  });

  it('a list still settling proves nothing: a read the stroke left moving (a bounce at its top) is no proof; the next read that finds it still is', () => {
    // At(-20): the content pulled 20 pt down past its top — it still lists nothing above `lower`, but it moved.
    const played = play({ ...IPHONE, maxSwipes: 8 }, [at(0), at(-20), at(0), at(0), at(260), at(520), at(780), at(930), at(930)]);
    expect(strokesToward(played)).toEqual(['up', 'up', 'up', 'down', 'down', 'down', 'down']);
    expect(played.outcome).toMatchObject({ kind: 'visible', endTurn: { from: 'up', to: 'down', after: 3, unmoved: 1 } });
    // Not "3 swipes up did not move": the first two did (the bounce).
    expect(describeScrollResult(resultOf(played))).toMatch(/; 3 swipes up, the last of which did not move scrollable \(0,380 402x180\) — the tree lists its content ending at its top — so averi turned down/);
  });

  it('uiautomator (Android): a target dumped clipped out past the far edge of a list the strokes do not move — no turn, the tree cannot list where the content ends; the strokes go the caller\'s way to the bound and the failure names the side, as before', () => {
    const list: Rect = { x: 0, y: 297, width: 1080, height: 1923 };
    const out: Row = { found: [{ ...node({ role: 'button', identifier: 'apps', rect: { x: 198, y: 2220, width: 126, height: 0 } }), clippedOut: 'bottom' }], scroller: list };
    const played = play({ ...IPHONE, maxSwipes: 3, screen: { width: 1080, height: 2220 } }, [out, out, out, out]);
    expect(strokesToward(played)).toEqual(['up', 'up', 'up']);
    expect(played.outcome).not.toHaveProperty('endTurn');
    expect(failureOf(played, 'id:apps').message).toMatch(/clipped out below its scroll container.*direction: "down"/);
  });

  it('the target past the far edge of ANOTHER scroll view than the one proven at its end: no turn — the proof ends the scroll, naming the side', () => {
    // The second read lists F at the same rect, but under `upper` (0,110 402x220), past ITS bottom; `lower`, the one
    // the stroke went over, still lists its content ending at its top.
    const moved = (): Row => {
      const tree = scrolled(0);
      let f: UiNode | undefined;
      const strip = (n: UiNode): UiNode => ({ ...n, children: n.children.filter((c) => c.identifier !== F).map(strip) });
      const withF = (n: UiNode): UiNode => {
        if (n.role === 'scrollable' && n.rect.y === 110) {
          f = node({ role: 'button', identifier: F, label: 'Target F', rect: { x: 51, y: 1380, width: 300, height: 64 } });
          return { ...n, children: [...n.children, f] };
        }
        return { ...n, children: n.children.map(withF) };
      };
      const t = withF(strip(tree));
      return { tree: t, found: f === undefined ? [] : [f] };
    };
    const played = play(IPHONE, [at(0), moved()]);
    expect(strokesToward(played)).toEqual(['up']);
    expect(played.outcome).not.toHaveProperty('endTurn');
    expect(played.outcome).toMatchObject({ kind: 'bound', by: { of: 'exhausted', ends: { strokes: 1 } } });
  });

  it('a flush probe that moves nothing is no proof of an end: the stop it checks is reported checked, never "content exhausted"', () => {
    // A clipping list (Android's mark, on a tree of unclipped frames, so both questions can be asked of one tree): its
    // first row flush with its top, the list listing nothing above it — `fully: true` probes up once.
    const list: Rect = { x: 0, y: 300, width: 402, height: 400 };
    const row = node({ role: 'button', identifier: 'first', rect: { x: 0, y: 300, width: 402, height: 64 } });
    const tree = node({
      role: 'container',
      unclippedFrames: true,
      rect: { x: 0, y: 0, width: 402, height: 874 },
      children: [node({ role: 'scrollable', rect: list, clipsDescendants: true, children: [node({ role: 'other', rect: { x: 0, y: 300, width: 402, height: 1200 } }), row] })],
    });
    const r: Row = { tree, found: [row] };
    const played = play({ ...IPHONE, direction: 'down', fully: true }, [r, r]);
    expect(played.steps[0]).toMatchObject({ do: 'stroke', probe: true, toward: 'up' });
    expect(played.outcome).toMatchObject({ kind: 'visible', swipes: 1, flush: { edge: 'top', checked: true } });
  });
});
