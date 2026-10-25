import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Rect, UiNode } from '../../src/adapters/types.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { SETTLE_CONFIRM_READS, type RoundRules } from '../../src/interact/scroll-rounds.js';
import { node } from '../helpers/fake.js';
import { failureOf, play, type Played, type Row } from '../helpers/rounds.js';

/**
 * A LIST'S END THAT REBOUNDS (docs/bugs/2026-10-12-ios-scroll-until-never-reads-a-bouncing-list-end-as-exhausted.md):
 * on iOS every stroke into the end of a list drags the content and rubber-bands it back over ~0.75 s, and the read
 * after the stroke lands inside the bounce — at a different offset each time — so two unchanged reads never came and
 * a target that is not there cost the whole budget. Measured under idb on Settings › General, already at its end:
 * `About` at y 247 at rest; 0.25 s after the stroke 74, 0.5 s 235, from 0.75 s on 247 again — six identical strokes,
 * "failed after 6 swipes (maxSwipes)". Each row is one read of the flat list idb gives, `About` and the rows below it
 * laid from `top`.
 */

type Rules = RoundRules & { screen: { width: number; height: number } };
const PHONE: Rect = { x: 0, y: 0, width: 402, height: 874 };
/** iOS: the platform flings every stroke (no drag speed). */
const IOS: Rules = { direction: 'down', fully: false, maxSwipes: 6, timeoutMs: 15_000, strokes: 'fling', screen: { width: 402, height: 874 } };
/** The same reads, where strokes drag rather than fling (Android). */
const DRAGS: Rules = { ...IOS, strokes: 'drag' };

/** Settings › General as idb lists it, its title fixed, `About` at `top` and the rows below it carried with it, each `height` tall; `title` the navigation title's text. */
function general(top: number, title = 'General', height = 44): Row {
  const row = (label: string, y: number): UiNode => node({ role: 'button', label, rect: { x: 16, y, width: 370, height } });
  const tree = node({
    role: 'container',
    rect: { x: 0, y: 0, width: 0, height: 0 },
    flatList: true,
    children: [node({ role: 'other', rect: PHONE }), node({ role: 'text', label: title, rect: { x: 0, y: 62, width: 402, height: 44 } }), row('About', top), row('Software Update', top + 44), row('Language & Region', top + 382)],
  });
  return { found: [], tree };
}

const steps = (played: Played): string[] => played.steps.map((s) => s.do);

describe('round — a list\'s end that rebounds under a fling (iOS)', () => {
  it('measured: a read after each stroke inside the bounce, the settled read back where the list rested before it — content exhausted after the two strokes, not the whole budget; the list never moved, so no "try up"', () => {
    const played = play(IOS, [general(247), general(74), general(247), general(235), general(247)]);
    expect(steps(played)).toEqual(['stroke', 'confirm', 'stroke', 'confirm', 'stop']);
    expect(played.outcome).toMatchObject({ kind: 'bound', swipes: 2, by: { of: 'exhausted', unchanged: 'tree' } });
    const { message } = failureOf(played, 'text:"No Such Row"');
    expect(message).toMatch(/^scroll_until text:"No Such Row" failed after 2 swipes \(the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken — idb lists only what a presented sheet, alert or cover leaves to accessibility: if the element lies beneath one, close it first\) — element never appeared in the tree$/);
    expect(message).not.toMatch(/lies above/);
  });

  it('the bug as it was: where strokes drag (no settled read), every read inside the bounce is a change — the strokes run to maxSwipes', () => {
    const played = play(DRAGS, [general(247), general(74), general(235), general(120), general(200), general(60), general(150)]);
    expect(steps(played)).not.toContain('confirm');
    expect(played.outcome).toMatchObject({ kind: 'bound', by: { of: 'maxSwipes' } });
  });

  it('a settled read within a point of the rest is the list where it was (whole-point frames)', () => {
    const played = play(IOS, [general(247), general(74), general(248), general(235), general(247)]);
    expect(played.outcome).toMatchObject({ kind: 'bound', swipes: 2, by: { of: 'exhausted', unchanged: 'tree' } });
  });

  it('measured live (idb, scroll-top-edge-end at its end, no bounce caught): the first stroke rounds the rest a point off (A -282 → -283) — unmoved within a point where the platform flings, exhausted after the two strokes, no side never stroked named', () => {
    const played = play(IOS, [general(247), general(246), general(246)]);
    expect(steps(played)).toEqual(['stroke', 'stroke', 'stop']);
    expect(played.outcome).toMatchObject({ kind: 'bound', swipes: 2, by: { of: 'exhausted', unchanged: 'tree' } });
    expect(failureOf(played, 'text:"No Such Row"').message).not.toMatch(/lies above/);
  });

  it('where strokes drag (Android) the tree\'s test stays exact: a point is a change, as before', () => {
    const played = play({ ...DRAGS, maxSwipes: 3 }, [general(247), general(246), general(246), general(246)]);
    expect(played.outcome).toMatchObject({ kind: 'bound', swipes: 3, by: { of: 'exhausted', unchanged: 'tree' } });
    expect(failureOf(played, 'text:"No Such Row"').message).toMatch(/lies above/);
  });

  it('a fling that carried the content further than the finger drew is no rebound: no settled read, the next stroke at once', () => {
    const played = play({ ...IOS, maxSwipes: 2 }, [general(247), general(-700), general(-1700)]);
    expect(steps(played)).toEqual(['stroke', 'stroke', 'stop']);
    expect(played.outcome).toMatchObject({ kind: 'bound', by: { of: 'maxSwipes' } });
  });

  it('a list near its end that came to rest elsewhere moved: the strokes go on, and once it rebounds there twice it is exhausted — it moved, so the side never stroked is named', () => {
    const played = play(IOS, [general(247), general(100), general(130), general(50), general(130), general(60), general(130)]);
    expect(steps(played)).toEqual(['stroke', 'confirm', 'stroke', 'confirm', 'stroke', 'confirm', 'stop']);
    expect(played.outcome).toMatchObject({ kind: 'bound', swipes: 3, by: { of: 'exhausted', unchanged: 'tree' } });
    expect(failureOf(played, 'text:"No Such Row"').message).toMatch(/if it lies above, try direction: "up"/);
  });

  it('a screen that changed with no node moved (a ticking title) is no rebound: no settled read', () => {
    const played = play({ ...IOS, maxSwipes: 2 }, [general(247, '10:41'), general(247, '10:42'), general(247, '10:43')]);
    expect(steps(played)).toEqual(['stroke', 'stroke', 'stop']);
  });

  it('no settled read past the deadline: the bound, as before', () => {
    const played = play(IOS, [general(247), { ...general(74), elapsedMs: 15_000 }]);
    expect(steps(played)).toEqual(['stroke', 'stop']);
    expect(played.outcome).toMatchObject({ kind: 'bound', by: { of: 'timeout' } });
  });

  it('the last stroke the budget allows is answered too: a rebound at maxSwipes is read settled — exhausted, not maxSwipes', () => {
    const played = play({ ...IOS, maxSwipes: 2 }, [general(247), general(74), general(247), general(235), general(247)]);
    expect(steps(played)).toEqual(['stroke', 'confirm', 'stroke', 'confirm', 'stop']);
    expect(played.outcome).toMatchObject({ kind: 'bound', swipes: 2, by: { of: 'exhausted', unchanged: 'tree' } });
  });

  it('the round\'s BOUND holds (1 + (1 + SETTLE_CONFIRM_READS) × maxSwipes): the settled read is the stroke\'s first confirming read — each stroke caught in the bounce, every read after it failing', () => {
    const failed: Row = { error: 'idb describe-all failed' };
    const rows: Row[] = [general(247)];
    for (const caught of [74, 160]) rows.push(general(caught), failed, failed, failed);
    const played = play({ ...IOS, maxSwipes: 2 }, rows);
    expect(played.steps.length).toBeLessThanOrEqual(1 + (1 + SETTLE_CONFIRM_READS) * 2);
    expect(steps(played).filter((s) => s === 'confirm')).toHaveLength(2 * SETTLE_CONFIRM_READS);
  });

  it('content that changed size as it moved is no rebound (no node carried at its size): no settled read', () => {
    const played = play({ ...IOS, maxSwipes: 1 }, [general(247), general(74, 'General', 52)]);
    expect(steps(played)).toEqual(['stroke', 'stop']);
  });

  it('a read that lists none of the stroked scroll view\'s content (a blank read, UnseenStrokes) is no rebound: no settled read', () => {
    const list: Rect = { x: 0, y: 120, width: 402, height: 700 };
    const header = (y: number): UiNode => node({ role: 'text', label: 'Header', rect: { x: 0, y, width: 402, height: 40 } });
    const rows: Row[] = [
      { found: [], mainScroller: list, mainContent: [], over: [header(60)] },
      { found: [], mainScroller: list, mainContent: [], over: [header(20)] },
    ];
    expect(steps(play({ ...IOS, maxSwipes: 1 }, rows))).toEqual(['stroke', 'stop']);
  });
});

/**
 * WDA (a nested tree of unclipped frames): the lab's scroll-bounded capture, `lower` at rest at its top, asked `up` for
 * a row it does not have — each stroke's read catches `lower`'s content dragged down, each settled read finds it back at
 * rest. No end proof here (a target not in the tree is stroked over the screen, no scroll view of it: ADR 0021 decision
 * 2's `ends` is never asked), so the two-stroke rule decides, on the settled reads.
 */
describe('round — a rebound under WDA', () => {
  const CAPTURE = parseWdaSource(readFileSync(new URL('../fixtures/wda-capture-lab-scroll-bounded.json', import.meta.url), 'utf8'));
  const LOWER: Rect = { x: 0, y: 380, width: 402, height: 180 };
  const scrolled = (offset: number): Row => {
    const shift = (n: UiNode, by: number): UiNode => ({ ...n, rect: { ...n.rect, y: n.rect.y - by }, children: n.children.map((c) => shift(c, by)) });
    const walk = (n: UiNode): UiNode =>
      n.role === 'scrollable' && n.rect.y === LOWER.y && n.rect.height === LOWER.height ? { ...n, children: n.children.map((c) => shift(c, offset)) } : { ...n, children: n.children.map(walk) };
    return { tree: walk(CAPTURE), found: [] };
  };
  it('each stroke\'s read inside the bounce, each settled read at rest: exhausted after the two strokes', () => {
    const played = play({ ...IOS, direction: 'up' }, [scrolled(0), scrolled(-60), scrolled(0), scrolled(-25), scrolled(0)]);
    expect(steps(played)).toEqual(['stroke', 'confirm', 'stroke', 'confirm', 'stop']);
    expect(played.outcome).toMatchObject({ kind: 'bound', swipes: 2, by: { of: 'exhausted', unchanged: 'tree' } });
  });
});
