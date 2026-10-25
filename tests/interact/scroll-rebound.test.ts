import { describe, expect, it } from 'vitest';
import type { Rect, UiNode } from '../../src/adapters/types.js';
import type { RoundRules } from '../../src/interact/scroll-rounds.js';
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
const IOS: Rules = { direction: 'down', fully: false, maxSwipes: 6, timeoutMs: 15_000, flings: true, screen: { width: 402, height: 874 } };
/** The same reads, where strokes drag rather than fling (Android). */
const DRAGS: Rules = { ...IOS, flings: false };

/** Settings › General as idb lists it, its title fixed, `About` at `top` and the rows below it carried with it; `title` the navigation title's text. */
function general(top: number, title = 'General'): Row {
  const row = (label: string, y: number): UiNode => node({ role: 'button', label, rect: { x: 16, y, width: 370, height: 44 } });
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

  it('measured live (idb, scroll-top-edge-end at its end, no bounce caught): the first stroke rounds the rest a point off (A -282 → -283) — unmoved within a point, exhausted after the two strokes, with or without flings', () => {
    for (const rules of [IOS, DRAGS]) {
      const played = play(rules, [general(247), general(246), general(246)]);
      expect(steps(played)).toEqual(['stroke', 'stroke', 'stop']);
      expect(played.outcome).toMatchObject({ kind: 'bound', swipes: 2, by: { of: 'exhausted', unchanged: 'tree' } });
      expect(failureOf(played, 'text:"No Such Row"').message).not.toMatch(/lies above/);
    }
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
});
