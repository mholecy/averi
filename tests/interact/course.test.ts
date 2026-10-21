import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { courseFacts, nextStroke, probeOf, probeSent, seeTarget, sent, startCourse, stuckTurn, turnAtEnd, turnBack, type Course, type Sighting } from '../../src/interact/course.js';
import type { Since } from '../../src/interact/scroll-read.js';
import { judgeRead } from '../../src/interact/scroll-read.js';
import type { Direction } from '../../src/interact/swipe.js';
import type { Edge } from '../../src/ui-tree/geometry.js';
import type { UsableScreen } from '../../src/ui-tree/usable-screen.js';
import { node } from '../helpers/fake.js';

/**
 * THE COURSE through its interface (interact/course.ts): a series of target standings in, the strokes out — which way,
 * at what reach, whether each is a turn. One row per branch of the direction policy: the caller's way, a fling carried
 * past (and thrown back), a target at the far edge in the frame (across it, under a cover over its far side, held back
 * by the region its motion showed there), a lazy list's drop (after a stroke, and after a probe), the stuck turn, the
 * end turn (its reach kept and not counted, ADR 0021 d1), the probe's way and reach, and what a failure reads. Each
 * read is judged as the round judges it (interact/scroll-read.ts#judgeRead) on a phone-sized screen; whether a turn
 * applies at all — the stuck turn's budget and the outward rule (33605fdd), the end turn's proof — is the round's,
 * pinned in its play tables (tests/interact/scroll-rounds.test.ts, scroll-end-turn.test.ts).
 */

const PHONE: Rect = { x: 0, y: 0, width: 402, height: 874 };
const SCREEN: UsableScreen = { box: PHONE, boxes: [PHONE], oriented: PHONE, from: 'device' };

/** One read of the target at `rect` (or none), with `over` drawn after it, judged as the round judges it. */
function sighting(rect: Rect | undefined, { since = 'stroke', over, heldBackAt }: { since?: Since; over?: Rect; heldBackAt?: Edge } = {}): Sighting {
  const target = rect === undefined ? undefined : node({ role: 'button', label: 'F', rect: { ...rect } });
  const cover = over === undefined ? [] : [node({ role: 'button', label: 'bar', rect: { ...over } })];
  const tree = node({ role: 'container', rect: PHONE, children: [...(target === undefined ? [] : [target]), ...cover] });
  const judged = judgeRead({ tree, found: target === undefined ? [] : [target], ofKeyboard: () => false, remedy: { dismissal: 'none' } }, SCREEN, false);
  if ('ask' in judged) throw new Error('asked the witness');
  return { since, judged: judged.best, frames: judged.frames, uncutFrames: judged.uncutFrames, ...(heldBackAt !== undefined && { heldBackAt }) };
}

/** A row of the table: a step the round takes with the course. */
type Step =
  /** A read that read, the target at this rect — `null`: not in the tree. */
  | { readonly at: Rect | null; readonly since?: Since; readonly over?: Rect; readonly heldBackAt?: Edge }
  /** The next stroke asked and sent: recorded as `toward reach` (plus ` turn`). */
  | 'send'
  /** The flush check's probe toward revealing this edge, sent. */
  | { readonly probe: Edge }
  /** Stuck on the last stroke's way: the stroke back decided. */
  | 'stuck';

const row = (y: number, height = 50): Rect => ({ x: 0, y, width: 402, height });

/** Play `steps` from the caller's `direction`: every stroke sent, as `toward reach[ turn]`, and the course after. */
function play(direction: Direction, steps: readonly Step[]): { strokes: string[]; course: Course } {
  let course = startCourse(direction);
  const strokes: string[] = [];
  for (const step of steps) {
    if (step === 'send') {
      const next = nextStroke(course);
      strokes.push(`${next.toward} ${next.reach}${next.turn ? ' turn' : ''}`);
      course = sent(course, next);
    } else if (step === 'stuck') {
      const stuck = stuckTurn(course, { stuck: true, backUnmoved: false, outward: () => false });
      if (stuck === undefined) throw new Error('not stuck');
      course = turnBack(course, stuck.on);
    } else if ('probe' in step) {
      course = probeSent(course, probeOf(step.probe, PHONE).toward);
    } else {
      course = seeTarget(course, sighting(step.at ?? undefined, step)).course;
    }
  }
  return { strokes, course };
}

describe('the course: target standings in, strokes out', () => {
  it.each<[string, Direction, Step[], string[]]>([
    ['the caller\'s way: a target short of the far edge (below the frame, content down)', 'down', [{ at: row(1000), since: 'start' }, 'send'], ['down 1']],
    ['the caller\'s way, mirrored: content up, the target above the frame', 'up', [{ at: row(-200), since: 'start' }, 'send'], ['up 1']],
    ['sideways: content right, the target past the right edge', 'right', [{ at: { x: 500, y: 300, width: 100, height: 50 }, since: 'start' }, 'send'], ['right 1']],
    ['sideways, a fling carried it past the left (far) edge: back', 'right', [{ at: { x: 500, y: 300, width: 100, height: 50 }, since: 'start' }, 'send', { at: { x: -150, y: 300, width: 100, height: 50 } }, 'send'], ['right 1', 'left 0.5 turn']],
    ['first read wholly beyond the far edge, never seen short: the caller\'s way, honoured', 'down', [{ at: row(-200), since: 'start' }, 'send', { at: row(-400) }, 'send'], ['down 1', 'down 1']],
    ['a fling carried it past (seen short, then beyond): back, a turn at half reach', 'down', [{ at: row(1000), since: 'start' }, 'send', { at: row(-200) }, 'send'], ['down 1', 'up 0.5 turn']],
    ['thrown back past the near edge: the caller\'s way again, another turn, a quarter', 'down', [{ at: row(1000), since: 'start' }, 'send', { at: row(-200) }, 'send', { at: row(1000) }, 'send'], ['down 1', 'up 0.5 turn', 'down 0.25 turn']],
    ['the reach is never restored: on the same way after a turn it stays halved', 'down', [{ at: row(1000), since: 'start' }, 'send', { at: row(-200) }, 'send', { at: row(-100) }, 'send'], ['down 1', 'up 0.5 turn', 'up 0.5']],
    ['across the far edge in the frame on the first read: back at once, the first stroke a turn', 'down', [{ at: row(-20), since: 'start' }, 'send'], ['up 0.5 turn']],
    ['across the NEAR edge in the frame (coming in): the caller\'s way', 'down', [{ at: row(850), since: 'start' }, 'send'], ['down 1']],
    ['under a cover over its far side, in the frame\'s far half: back', 'down', [{ at: row(100), since: 'start', over: { x: 0, y: 80, width: 402, height: 40 } }, 'send'], ['up 0.5 turn']],
    ['a cover over its far side in the NEAR half (a bottom bar over a row coming in): the caller\'s way', 'down', [{ at: row(780), since: 'start', over: { x: 0, y: 760, width: 402, height: 40 } }, 'send'], ['down 1']],
    ['a cover the row shows past only on its far side (Contacts\' toolbar 5 pt below the row\'s top): back', 'down', [{ at: { x: 20, y: 78, width: 362, height: 51 }, since: 'start', over: { x: 0, y: 83, width: 402, height: 48 } }, 'send'], ['up 0.5 turn']],
    ['held back by the region its motion showed at the far edge: back', 'down', [{ at: row(300), since: 'start', heldBackAt: 'top' }, 'send'], ['up 0.5 turn']],
    ['held back at the NEAR edge: the caller\'s way', 'down', [{ at: row(300), since: 'start', heldBackAt: 'bottom' }, 'send'], ['down 1']],
    ['dropped by a lazy list (short of the far edge, then gone): back the way the content came, a turn', 'down', [{ at: row(700), since: 'start' }, 'send', { at: null }, 'send'], ['down 1', 'up 0.5 turn']],
    ['still dropped: back again, no new turn, until a read finds it', 'down', [{ at: row(700), since: 'start' }, 'send', { at: null }, 'send', { at: null }, 'send', { at: row(500) }, 'send'], ['down 1', 'up 0.5 turn', 'up 0.5', 'down 0.25 turn']],
    ['lost wholly beyond the far edge of the last stroke: not dropped — the course goes on', 'down', [{ at: row(-200), since: 'start' }, 'send', { at: row(-400) }, 'send', { at: null }, 'send'], ['down 1', 'down 1', 'down 1']],
    ['carried past, then lost on a read with no stroke between: no longer carried past — the caller\'s way', 'down', [{ at: row(1000), since: 'start' }, 'send', { at: row(-200) }, { at: null, since: 'settle' }, 'send'], ['down 1', 'down 1']],
    ['lost on a read that followed nothing (the scroll\'s start): not dropped', 'down', [{ at: row(700), since: 'start' }, 'send', { at: null, since: 'start' }, 'send'], ['down 1', 'down 1']],
    ['dropped after a probe, no course stroke yet: back at full reach — not a turn', 'down', [{ at: row(700), since: 'start' }, { probe: 'bottom' }, { at: null }, 'send'], ['up 1']],
    ['a probe the other way is no turn: the next course stroke keeps its reach', 'down', [{ at: row(300), since: 'start' }, { probe: 'top' }, { at: row(320) }, 'send'], ['down 1']],
    ['stuck: one stroke back, a turn', 'down', [{ at: row(300), since: 'start' }, 'send', { at: row(300) }, 'stuck', 'send'], ['down 1', 'up 0.5 turn']],
    ['the stroke back held for a read with no stroke between: still back', 'down', [{ at: row(300), since: 'start' }, 'send', { at: row(300) }, 'stuck', { at: row(300), since: 'settle' }, 'send'], ['down 1', 'up 0.5 turn']],
    ['the stroke back answered by the read after it: the caller\'s way again', 'down', [{ at: row(300), since: 'start' }, 'send', { at: row(300) }, 'stuck', 'send', { at: row(300) }, 'send'], ['down 1', 'up 0.5 turn', 'down 0.25 turn']],
    // The ?? chain's order: dropped, then the stroke back, then a fling's turn, then the course.
    ['dropped beats the stroke back (a probe up, then stuck on down, then lost on a read with no stroke between)', 'down', [{ at: row(300), since: 'start' }, 'send', { at: row(300) }, { probe: 'top' }, 'stuck', { at: null, since: 'settle' }, 'send'], ['down 1', 'down 1']],
    ['the stroke back beats a fling\'s turn (stuck on up after a turn, then at the far edge)', 'down', [{ at: row(1000), since: 'start' }, 'send', { at: row(-200) }, 'send', { at: row(300) }, 'stuck', { at: row(-20), since: 'settle' }, 'send'], ['down 1', 'up 0.5 turn', 'down 0.25 turn']],
  ])('%s', (_name, direction, steps, strokes) => {
    expect(play(direction, steps).strokes).toEqual(strokes);
  });
});

describe('the stuck turn: the other way as the course knows it', () => {
  const never = (): boolean => false;

  it('untried, outward, stroked, unmoved — in that order — and not stuck', () => {
    const { course } = play('down', [{ at: row(300), since: 'start' }, 'send', { at: row(300) }]);
    expect(stuckTurn(course, { stuck: false, backUnmoved: false, outward: never })).toBeUndefined();
    expect(stuckTurn(course, { stuck: true, backUnmoved: false, outward: never })).toEqual({ on: 'down', otherWay: 'untried' });
    // The outward rule (the round's standing facts) is asked of the way it is stuck on.
    expect(stuckTurn(course, { stuck: true, backUnmoved: false, outward: (on) => on === 'down' })).toEqual({ on: 'down', otherWay: 'outward' });
    expect(stuckTurn(course, { stuck: true, backUnmoved: false, outward: (on) => on === 'up' })).toEqual({ on: 'down', otherWay: 'untried' });
    const turned = play('down', [{ at: row(1000), since: 'start' }, 'send', { at: row(-200) }, 'send', { at: row(-20) }]).course;
    expect(stuckTurn(turned, { stuck: true, backUnmoved: false, outward: never })).toEqual({ on: 'up', otherWay: 'stroked' });
    expect(stuckTurn(turned, { stuck: true, backUnmoved: false, outward: () => true })).toEqual({ on: 'up', otherWay: 'outward' });
    // The stroke back sent; the read after it answers it, and found the target unmoved.
    const back = play('down', [{ at: row(300), since: 'start' }, 'send', { at: row(300) }, 'stuck', 'send']).course;
    const answered = seeTarget(back, sighting(row(300)));
    expect(answered.answersBack).toBe(true);
    expect(stuckTurn(answered.course, { stuck: false, backUnmoved: true, outward: () => true })).toEqual({ on: 'down', otherWay: 'unmoved' });
    // Only a read after a stroke answers it, and only once.
    expect(seeTarget(back, sighting(row(300), { since: 'settle' })).answersBack).toBe(false);
    expect(seeTarget(answered.course, sighting(row(300))).answersBack).toBe(false);
  });
});

describe('the end turn (ADR 0021): one transition', () => {
  const view: Rect = { x: 0, y: 380, width: 402, height: 180 };
  const past = { x: 0, y: 1760, width: 402, height: 64 };
  const proof = { scrollView: { role: 'scrollable', label: 'lower', identifier: null, rect: view }, unmoved: 1 };

  it('turns the course once toward a target past the far edge of the proving scroll view: full reach, not counted', () => {
    // Content up (the caller's way): the far edge is the bottom; the target lies past `view`'s bottom.
    const { course } = play('up', [{ at: past, since: 'start' }, 'send', 'send', 'send', { at: past }]);
    const turned = turnAtEnd(course, { target: past, view, proof, after: 3 });
    expect(turned).toBeDefined();
    if (turned === undefined) return;
    const next = nextStroke(turned);
    expect([next.toward, next.reach, next.turn]).toEqual(['down', 1, false]);
    expect(courseFacts(sent(turned, next))).toMatchObject({ turns: 0, lastStroke: 'down', far: 'top', endTurn: { way: 'up', ...proof, to: 'down', after: 3 } });
    // At most one a scroll: not even for a target past the new far edge (the top of `view`).
    expect(turnAtEnd(turned, { target: { x: 0, y: 100, width: 402, height: 64 }, view, proof, after: 4 })).toBeUndefined();
    expect(turnAtEnd(startCourse('down'), { target: { x: 0, y: 100, width: 402, height: 64 }, view, proof, after: 4 })).toBeDefined();
  });

  it('resets what the reads recorded against the old far edge: carried past nothing, past no side', () => {
    // Content up; seen short, then flung past the screen's bottom (the far edge): carried past it, and last past it.
    const { course } = play('up', [{ at: row(300), since: 'start' }, 'send', { at: row(900) }]);
    expect(nextStroke(course).toward).toBe('down');
    expect(courseFacts(course).past).toEqual({ side: 'bottom', clippedOut: false });
    const turned = turnAtEnd(course, { target: row(900), view, proof, after: 1 });
    if (turned === undefined) throw new Error('no end turn');
    expect(nextStroke(turned)).toMatchObject({ toward: 'down', turn: false });
    expect(courseFacts(turned).past).toBeUndefined();
  });

  it('no turn for a target not past the course\'s far edge of that scroll view', () => {
    const course = startCourse('up');
    expect(turnAtEnd(course, { target: { x: 0, y: 400, width: 402, height: 64 }, view, proof, after: 3 })).toBeUndefined();
    expect(turnAtEnd(course, { target: { x: 0, y: 100, width: 402, height: 64 }, view, proof, after: 3 })).toBeUndefined();
  });

  it('after it, a target past the old far edge reads short of the new one: a later read beyond the new far edge turns back', () => {
    const { course } = play('up', [{ at: past, since: 'start' }, 'send']);
    const turned = turnAtEnd(course, { target: past, view, proof, after: 1 });
    if (turned === undefined) throw new Error('no end turn');
    const flung = seeTarget(sent(turned, nextStroke(turned)), sighting(row(-200))).course;
    expect(nextStroke(flung)).toMatchObject({ toward: 'up', turn: true, reach: 0.5 });
    // Without the end turn's `seenShort`, a course down reads the same target there as never seen short: on.
    const fresh = startCourse('down');
    expect(nextStroke(seeTarget(sent(fresh, nextStroke(fresh)), sighting(row(-200))).course)).toMatchObject({ toward: 'down', turn: false });
  });
});

describe('the probe: its way and reach', () => {
  it('toward revealing the edge, a quarter of the stroke, its travel capped at 0.08 of the long side', () => {
    expect(probeOf('top', PHONE)).toEqual({ toward: 'up', reach: 0.25, maxTravel: 69 });
    expect(probeOf('bottom', { x: 0, y: 0, width: 1600, height: 2560 })).toEqual({ toward: 'down', reach: 0.25, maxTravel: 204 });
    expect(probeOf('left', PHONE).toward).toBe('left');
  });
});

describe('what a failure reads of the course', () => {
  it('the side last found past — until a stroke went toward revealing it — and the far edge', () => {
    const { course } = play('down', [{ at: row(-200), since: 'start' }, 'send', { at: row(-400) }]);
    expect(courseFacts(course)).toMatchObject({ turns: 0, lastStroke: 'down', far: 'top', past: { side: 'top', clippedOut: false } });
    const turned = play('down', [{ at: row(1000), since: 'start' }, 'send', { at: row(-200) }, 'send', { at: row(-400) }]).course;
    expect(courseFacts(turned)).toMatchObject({ turns: 1, lastStroke: 'up', past: undefined });
    // A read that finds it anywhere else clears it; one that does not find it keeps it.
    expect(courseFacts(seeTarget(course, sighting(row(300))).course).past).toBeUndefined();
    expect(courseFacts(seeTarget(course, sighting(undefined)).course).past).toEqual({ side: 'top', clippedOut: false });
  });
});

describe('what the target still needs (LV5), on a tree that lists it where it lies', () => {
  // The lab app's `scroll-bounded` under WDA: F (64 tall) at content y 1380 of `lower` (0,380 402x180), at offset 0.
  const capture = parseWdaSource(readFileSync(new URL('../fixtures/wda-capture-lab-scroll-bounded.json', import.meta.url), 'utf8'));
  const found = [...everyNode(capture)].filter((n: UiNode) => n.identifier === 'lab.scroll-bounded.F');

  it('the distance to the window\'s middle and the window\'s slack; none on a tree that does not list it so', () => {
    const judged = judgeRead({ tree: capture, found, ofKeyboard: () => false, remedy: { dismissal: 'none' } }, SCREEN, false);
    if ('ask' in judged) throw new Error('asked the witness');
    const course = seeTarget(startCourse('down'), { since: 'start', judged: judged.best, frames: judged.frames, uncutFrames: judged.uncutFrames }).course;
    const rect = judged.best?.node.rect;
    if (rect === undefined) throw new Error('F not judged');
    // Past the window's bottom by its far end, less the window; then half the slack (180 − 64) to the middle.
    expect(nextStroke(course).still).toEqual({ needs: rect.y + rect.height - (380 + 180) + 58, slack: 116 });
    expect(nextStroke(play('down', [{ at: row(1000), since: 'start' }]).course).still).toBeUndefined();
    // Asked of the stroke's own way, not the course's: a stroke back down from a course up (stuck on up) needs the same.
    const up = seeTarget(startCourse('up'), { since: 'start', judged: judged.best, frames: judged.frames, uncutFrames: judged.uncutFrames }).course;
    expect(nextStroke(up).still).toBeUndefined();
    const back = turnBack(up, 'up');
    expect(nextStroke(back)).toMatchObject({ toward: 'down', still: nextStroke(course).still });
  });
});
