import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appText, classStrokes, directionBreaks, judgeAbsentAtEnd, judgeAndroidTurn, judgeAtRest, judgeBlankStretch, judgeCarry, judgeDismissal, judgePresentedAssert,
  judgePresentedScroll, judgeScroll, judgeTap, judgeWithin, presentedAssertCase, showRegion, strokesSince, touchesSince, touchTurns, unchangedClaimBroken, visibilityCases,
  type VisibilityCase,
} from '../../scripts/truth/live-visibility.js';
import { selectCases } from '../../scripts/truth/live-cases.js';
import { describeScrollResult } from '../../src/interact/scroll-text.js';
import type { CellTruth, LabState, Stroke, TargetTruth } from '../../scripts/truth/schema.js';

// T21: the live visibility judges' verdicts pinned whole — outcome, rule, reply kind and the words live.ts prints and a
// record keeps — with their boundaries, by judge; and the cases the live run asks of the committed static truth
// (tests/fixtures/truth). The judges' rules are live-visibility.test.ts's; this file holds what each says, and where
// its edges lie. iOS units as there: the iPhone 17's 402x874 pt, its status band 62 pt; Android px: 1080x2220.

const SCREEN = { x: 0, y: 0, width: 402, height: 874 };
const at = 1;

/** An edges-like cell's state: T in `page` (the whole screen), its frame `y`, the page at `offset` (as live-visibility.test.ts's). */
function state(over: Partial<LabState> = {}): LabState {
  return {
    cell: 'c',
    ready: true,
    screen: SCREEN,
    scale: 3,
    frames: { T: { x: 51, y: -2, width: 300, height: 64 } },
    events: [],
    safeArea: { top: 62, left: 0, bottom: 34, right: 0 },
    scrollViews: { page: SCREEN },
    offsets: { page: 382 },
    strokes: [],
    ...over,
  };
}
const stroke = (from: number, to: number, view = 'page'): Stroke => ({ view, from, to, at });
const tap = (tag: string) => ({ kind: 'tap' as const, tag, at });
const touch = (tag: string) => ({ kind: 'touch' as const, tag, at });
/** T whole at y 300, the page at 80 after one stroke closer, the tap fired T: judgeScroll's ok stop (live-visibility.test.ts's `reached`). */
const reached = state({ frames: { T: { x: 51, y: 300, width: 300, height: 64 } }, offsets: { page: 80 }, strokes: [stroke(382, 80)], events: [tap('T')] });
const c = { tag: 'T', view: 'page', fully: false, platform: 'ios' as const };
const STOP = 'Element id:"x" visible after 1 swipe';

describe('what a verdict prints of the app (appText): the target, its scroll view, the strokes, what fired, the touches', () => {
  it('only what the app logged after the launch; focus and touches are not fired, touches are their own line', () => {
    const launched = state({ events: [touch('1,1')] });
    const s = state({
      frames: { T: { x: 51.04, y: 300.26, width: 300, height: 64 } },
      offsets: { page: 80 },
      strokes: [stroke(382, 80.04)],
      events: [touch('1,1'), touch('201,700'), { kind: 'focus', tag: 'vs', at }, tap('T'), touch('201,300'), { kind: 'tab', tag: 'home', at }],
    });
    expect(appText(s, 'ios', 'T', 'page', launched)).toBe('T 51,300.3 300x64 (whole); page clip 0,0 402x874 offset 80 (launched 382); strokes page 382→80; fired tap T, tab home; touches (201,700) (201,300)');
    expect(touchesSince(s, launched)).toEqual(['201,700', '201,300']);
  });
  it('nothing laid out, nothing logged, no scroll view named: each said so', () => {
    expect(appText(state({ frames: {} }), 'ios', 'T', undefined, state())).toBe('T none (no frame); strokes none; fired nothing; touches none');
  });
  it('a scroll view the app reported no clip or offset for, then or at the launch: a dash, not a number', () => {
    const bare = state({ frames: {}, scrollViews: undefined, offsets: undefined });
    expect(appText(bare, 'android', 'T', 'list', bare)).toBe('T none (no frame); list clip none offset — (launched —); strokes none; fired nothing; touches none');
  });
  it('strokesSince: the app\'s strokes after the launch, none where it logged none', () => {
    expect(strokesSince(state({ strokes: undefined }), state({ strokes: undefined }))).toEqual([]);
    expect(strokesSince(state({ strokes: [stroke(0, 400)] }), state({ strokes: undefined }))).toEqual([stroke(0, 400)]);
  });
  it('a reply is quoted by its first line, at most 260 characters', () => {
    const long = `ERROR ${'x'.repeat(300)}\nsecond line`;
    expect(judgeTap('T', false, long, state(), state())).toEqual({ outcome: 'ok', kind: 'refused', why: `refused, nothing fired: ERROR ${'x'.repeat(254)}` });
  });
});

describe('judgeTap\'s verdicts, whole', () => {
  const launched = state();
  const tapped = 'Tapped id:"lab.c.T"';
  it('ok: the target alone fired — said so where its probe did not reach it; a focus change is no event', () => {
    expect(judgeTap('T', true, tapped, state({ events: [touch('201,30'), { kind: 'focus', tag: 'vs', at }, tap('T')] }), launched)).toEqual({ outcome: 'ok', kind: 'Tapped', why: tapped });
    expect(judgeTap('T', false, tapped, state({ events: [tap('T')] }), launched)).toEqual({ outcome: 'ok', kind: 'Tapped', why: `${tapped} (fired, where the probe at its centre did not reach it)` });
  });
  it('tap-claim: another target\'s tap, or another kind of event of the same tag, is not the target firing', () => {
    expect(judgeTap('T', true, tapped, state({ events: [tap('U')] }), launched)).toEqual({ outcome: 'MISMATCH', cls: 'tap-claim', kind: 'Tapped', why: `averi says ${tapped} — the app logged tap U` });
    expect(judgeTap('T', true, tapped, state({ events: [{ kind: 'tab', tag: 'T', at }] }), launched)).toEqual({ outcome: 'MISMATCH', cls: 'tap-claim', kind: 'Tapped', why: `averi says ${tapped} — the app logged tab T` });
    expect(judgeTap('T', true, tapped, state({ events: [tap('T'), tap('U')] }), launched)).toEqual({ outcome: 'MISMATCH', cls: 'tap-claim', kind: 'Tapped', why: `averi says ${tapped} — the app fired tap U besides T` });
    expect(judgeTap('T', true, tapped, state({ events: [tap('T'), { kind: 'tab', tag: 'T', at }] }), launched)).toEqual({ outcome: 'MISMATCH', cls: 'tap-claim', kind: 'Tapped', why: `averi says ${tapped} — the app fired tab T besides T` });
  });
  it('a refusal: with something fired, tap-refused-fired; of a target a tap reaches, LOUD; else ok', () => {
    expect(judgeTap('T', false, 'ERROR covered', state({ events: [{ kind: 'dismissed', tag: 'sheet', at }] }), launched)).toEqual({ outcome: 'MISMATCH', cls: 'tap-refused-fired', kind: 'refused', why: 'averi refused (ERROR covered) — yet the app logged dismissed sheet' });
    expect(judgeTap('T', true, 'ERROR covered', state(), launched)).toEqual({ outcome: 'LOUD', cls: 'tap-refused', kind: 'refused', why: 'refused a target a tap reaches, nothing fired: ERROR covered' });
    expect(judgeTap('T', false, 'ERROR covered', state(), launched)).toEqual({ outcome: 'ok', kind: 'refused', why: 'refused, nothing fired: ERROR covered' });
  });
});

describe('judgeDismissal\'s verdicts, whole', () => {
  const field = (value: string, focused = false) => ({ value, focused, error: null });
  const launched = state({ focus: 'postcode', fields: { postcode: field('811 01', true), vs: field('') }, submits: [] });
  const after = 'ERROR id:"x" was not tapped: after id:"t" was tapped at (201,84) to hide the soft keyboard, it is outside its scroll view';
  it('typed into: every field changed, with its value — a field the launch did not report among them', () => {
    const s = state({ focus: 'postcode', fields: { postcode: field('811 012', true), vs: field('x'), note: field('n') }, submits: [] });
    expect(judgeDismissal('vs', 'ERROR covered', 'wda', s, launched)).toEqual({ outcome: 'MISMATCH', cls: 'dismissal', kind: 'refused', why: 'typed into postcode ("811 012"), vs ("x"), note ("n"): ERROR covered' });
    expect(judgeDismissal('vs', 'ERROR covered', 'wda', state({ fields: { vs: field('x') } }), state())).toMatchObject({ why: 'typed into vs ("x"): ERROR covered' });
  });
  it('submitted; no submit log is no submit', () => {
    expect(judgeDismissal('vs', 'ERROR covered', 'wda', { ...launched, submits: [{ at, valid: false, values: {} }] }, launched)).toEqual({ outcome: 'MISMATCH', cls: 'dismissal', kind: 'refused', why: 'the form was submitted: ERROR covered' });
    expect(judgeDismissal('vs', 'ERROR covered', 'idb', { ...launched, submits: undefined }, launched)).toEqual({ outcome: 'ok', kind: 'refused', why: 'refused (idb: the dismissal inert), focus on postcode: ERROR covered' });
  });
  it('a refusal after the dismissal ended the editing: ok only where a field held the focus at the launch', () => {
    const none = { ...launched, focus: null };
    expect(judgeDismissal('vs', after, 'wda', none, launched)).toEqual({ outcome: 'ok', kind: 'refused', why: `the keyboard dismissed (no field focused), then vs refused: ${after}` });
    expect(judgeDismissal('vs', after, 'wda', none, { ...launched, focus: null })).toEqual({ outcome: 'LOUD', cls: 'dismissal', kind: 'refused', why: `not tapped, the focus on none, though a dismissal is configured: ${after}` });
  });
});

describe('showRegion: where a target of the view shows whole — its edges', () => {
  const list = { x: 0, y: 200, width: 402, height: 400 };
  it('no clip for the view, or a clip off the screen (with chrome or not): no region', () => {
    expect(showRegion(state(), 'ios', 'list')).toBeUndefined();
    const off = { x: 0, y: 900, width: 402, height: 300 };
    expect(showRegion(state({ scrollViews: { list: off } }), 'ios', 'list')).toBeUndefined();
    expect(showRegion(state({ scrollViews: { list: off }, chrome: { tabBar: { x: 0, y: 743, width: 402, height: 87 } } }), 'ios', 'list')).toBeUndefined();
  });
  it('no safe area reported: no status band to leave out', () => {
    expect(showRegion(state({ safeArea: undefined }), 'ios', 'page')).toEqual(SCREEN);
  });
  it('a chrome half the region wide counts; one centred on its middle trims its bottom', () => {
    expect(showRegion(state({ chrome: { bar: { x: 0, y: 800, width: 201, height: 74 } } }), 'ios', 'page')).toEqual({ x: 0, y: 62, width: 402, height: 738 });
    // The region 62..874: its middle 468, the chrome's centre there.
    expect(showRegion(state({ chrome: { bar: { x: 0, y: 418, width: 402, height: 100 } } }), 'ios', 'page')).toEqual({ x: 0, y: 62, width: 402, height: 356 });
  });
  it('a tall header whose centre lies above the middle trims the top, however far it reaches down', () => {
    expect(showRegion(state({ chrome: { toolbar: { x: 0, y: 62, width: 402, height: 250 } } }), 'ios', 'page')).toEqual({ x: 0, y: 312, width: 402, height: 562 });
  });
  it('a chrome wholly below or wholly above the region trims nothing, however tall', () => {
    expect(showRegion(state({ scrollViews: { list }, chrome: { tabBar: { x: 0, y: 743, width: 402, height: 87 } } }), 'ios', 'list')).toEqual(list);
    expect(showRegion(state({ scrollViews: { list }, chrome: { sheet: { x: 0, y: 620, width: 402, height: 500 } } }), 'ios', 'list')).toEqual(list);
    expect(showRegion(state({ scrollViews: { list }, chrome: { navBar: { x: 0, y: 62, width: 402, height: 88 } } }), 'ios', 'list')).toEqual(list);
  });
});

describe('classStrokes: each stroke\'s distance before and after it, and its class', () => {
  it('a change of the slack (1) or less is still; the distance from the launch\'s offset', () => {
    const s = state({ strokes: [stroke(382, 381), stroke(381, 382), stroke(382, 300), stroke(0, 50, 'other')] });
    expect(classStrokes(s, state(), 'ios', 'T', 'page')).toEqual([
      { ...stroke(382, 381), d0: 64, d1: 63, cls: 'still' },
      { ...stroke(381, 382), d0: 63, d1: 64, cls: 'still' },
      { ...stroke(382, 300), d0: 64, d1: 0, cls: 'closer' },
    ]);
  });
  it('no frame at the launch, or no clip for the view: none classed', () => {
    expect(classStrokes(state(), state({ frames: {} }), 'ios', 'T', 'page')).toBeUndefined();
    expect(classStrokes(state(), state(), 'ios', 'T', 'list')).toBeUndefined();
  });
});

describe('unchangedClaimBroken and directionBreaks at their edges', () => {
  const unchanged = (swipes: string) => `ERROR scroll_until id:"x" failed${swipes} (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree`;
  it('the claim is judged only where the reply counts its swipes; a stroke of the slack moved nothing', () => {
    expect(unchangedClaimBroken(unchanged(''), [stroke(0, 400), stroke(400, 800)])).toBeUndefined();
    expect(unchangedClaimBroken(unchanged(' after 2 swipes'), [stroke(0, 1), stroke(1, 2)])).toBeUndefined();
    expect(unchangedClaimBroken(unchanged(' after 2 swipes'), [stroke(0, 2), stroke(2, 4)])).toBe('averi says the last 2 swipes did not change the screen — the app logged page 0→2, page 2→4 in them');
  });
  const classed = (strokes: Stroke[], launched = state()) => classStrokes({ ...launched, strokes }, launched, 'ios', 'T', 'page')!;
  it('beside: only strokes of another view that moved it more than the slack, all named', () => {
    const s = [stroke(0, 1, 'upper'), stroke(300, 300, 'upper'), stroke(0, 400, 'upper'), stroke(400, 800, 'upper'), stroke(382, 300)];
    expect(directionBreaks(s, classed(s), 'page', 5, 0)).toEqual(['stroked upper 0→400, upper 400→800, not its own page']);
  });
  it('a stroke beside and the call ended on one away: both said', () => {
    const s = [stroke(0, 400, 'upper'), stroke(382, 900)];
    expect(directionBreaks(s, classed(s), 'page', 2, 582)).toEqual(['stroked upper 0→400, not its own page', 'ended on a stroke that did not bring it closer (382→900, away), 582 from showing whole, not turned back']);
  });
  it('ended within the slack of showing whole: no break', () => {
    const s = [stroke(382, 900)];
    expect(directionBreaks(s, classed(s), 'page', 1, 1)).toEqual([]);
    expect(directionBreaks(s, classed(s), 'page', 1, 0)).toEqual([]);
  });
  it('two swipes are enough to count; within the slack, no break', () => {
    expect(directionBreaks([], [], 'page', 2, 64)).toEqual(['2 swipes, none of them brought it closer (0 stroke(s) logged)']);
    expect(directionBreaks([], [], 'page', 2, 1)).toEqual([]);
  });
  it('a stroke that carried a whole target away, the call ending there: its swipes brought it no closer', () => {
    const whole = state({ frames: { T: { x: 51, y: 300, width: 300, height: 64 } }, offsets: { page: 80 } });
    const s = [stroke(80, 500)];
    expect(classed(s, whole)).toEqual([{ ...stroke(80, 500), d0: 0, d1: 182, cls: 'away' }]);
    expect(directionBreaks(s, classed(s, whole), 'page', 2, 182)).toEqual(['2 swipes, none of them brought it closer (1 stroke(s) logged)']);
  });
});

describe('judgeScroll\'s verdicts, whole', () => {
  const launched = state();
  const app = (s: LabState, cc: { tag: string; view: string } = c) => appText(s, 'ios', cc.tag, cc.view, launched);
  const failed = 'ERROR scroll_until id:"x" failed after 1 swipe — element never appeared in the tree';
  it('ok: the stop and the tap after it, both quoted; a stop with no tap after it, the stop', () => {
    expect(judgeScroll(c, [STOP, 'Tapped id:"x"'], reached, launched)).toEqual({ outcome: 'ok', kind: 'visible', why: `${STOP}; then Tapped id:"x"`, app: app(reached) });
    expect(judgeScroll(c, [STOP], reached, launched)).toEqual({ outcome: 'ok', kind: 'visible', why: STOP, app: app(reached) });
  });
  it('a stop that held, then a refusal of the target the stop showed: the tap\'s LOUD, after the stop', () => {
    const quiet = { ...reached, events: [] };
    expect(judgeScroll(c, [STOP, 'ERROR covered'], quiet, launched)).toEqual({ outcome: 'LOUD', cls: 'tap-refused', kind: 'refused', why: `stopped (${STOP}), then the tap: refused a target a tap reaches, nothing fired: ERROR covered`, app: app(quiet) });
  });
  it('a stop that held, then a Tapped that fired nothing: the tap\'s claim, after the stop', () => {
    const quiet = { ...reached, events: [] };
    expect(judgeScroll(c, [STOP, 'Tapped id:"x"'], quiet, launched)).toEqual({ outcome: 'MISMATCH', cls: 'tap-claim', kind: 'Tapped', why: `after ${STOP}, the tap: averi says Tapped id:"x" — the app logged nothing`, app: app(quiet) });
  });
  it('a stop on a target the app laid out nowhere: the claim says so', () => {
    const nowhere = state({ frames: {} });
    expect(judgeScroll(c, [STOP], nowhere, launched)).toEqual({ outcome: 'MISMATCH', cls: 'stop-claim', kind: 'visible', why: `averi says ${STOP} — the app lays it out nowhere, not visible`, app: app(nowhere) });
  });
  it('no frame at the launch, or no clip for the view: the strokes go unjudged, the failure honest', () => {
    const noFrame = state({ frames: {} });
    const moved = state({ frames: {}, offsets: { page: 900 }, strokes: [stroke(382, 900)] });
    expect(judgeScroll(c, [failed], moved, noFrame)).toMatchObject({ outcome: 'LOUD', cls: 'not-reached', kind: 'not found', why: `not reached (no frame), and averi said so: ${failed}` });
    const noClip = state({ scrollViews: {} });
    expect(judgeScroll(c, [failed], { ...noClip, offsets: { page: 900 }, strokes: [stroke(382, 900)] }, noClip)).toMatchObject({ outcome: 'LOUD', cls: 'not-reached', why: `not reached (status-band), and averi said so: ${failed}` });
  });
  it('the distance it ended at: from the stop\'s offset and the launch\'s — the launch\'s where the stop reported none', () => {
    const away = state({ frames: { T: { x: 51, y: -520, width: 300, height: 64 } }, offsets: { page: 900 }, strokes: [stroke(382, 900)] });
    const ended = 'ended on a stroke that did not bring it closer (382→900, away)';
    expect(judgeScroll(c, [failed], away, launched)).toEqual({ outcome: 'MISMATCH', cls: 'R-direction', kind: 'not found', why: `R-direction: ${ended}, 582 from showing whole, not turned back — averi: ${failed}`, app: app(away) });
    expect(judgeScroll(c, [failed], { ...away, offsets: undefined }, launched)).toMatchObject({ why: `R-direction: ${ended}, 64 from showing whole, not turned back — averi: ${failed}` });
    // …and offset 0 where neither reported one (sheet-long-list's UITableView before its first scroll).
    expect(judgeScroll(c, [failed], { ...away, offsets: undefined }, { ...launched, offsets: undefined })).toMatchObject({ why: `R-direction: ${ended}, 64 from showing whole, not turned back — averi: ${failed}` });
    const beside = { ...away, strokes: [stroke(0, 400, 'upper'), stroke(382, 900)] };
    expect(judgeScroll(c, [failed], beside, launched)).toMatchObject({ why: `R-direction: stroked upper 0→400, not its own page; ${ended}, 582 from showing whole, not turned back — averi: ${failed}` });
    // Not in the tree: the same breaks, reported, not judged.
    expect(judgeScroll({ ...c, unlisted: true }, [failed], beside, launched)).toEqual({ outcome: 'LOUD', cls: 'not-reached', kind: 'not found', why: `not reached (off-screen), and averi said so (not in the tree: its strokes unjudged — stroked upper 0→400, not its own page; ${ended}, 582 from showing whole, not turned back): ${failed}`, app: app(beside) });
    expect(judgeScroll({ ...c, unlisted: true }, [failed], launched, launched)).toMatchObject({ outcome: 'LOUD', why: `not reached (status-band), and averi said so: ${failed}` });
  });
  it('a failure where the app shows the stop: failed-holds, naming the stop asked', () => {
    const reply = 'ERROR scroll_until id:"x" failed after 1 swipe (maxSwipes)';
    expect(judgeScroll(c, [reply, 'Tapped id:"x"'], reached, launched)).toEqual({ outcome: 'MISMATCH', cls: 'failed-holds', kind: 'refused', why: `averi failed (${reply}) — the app shows it whole (visible as the stop needs)`, app: app(reached) });
    expect(judgeScroll({ ...c, fully: true }, [reply, 'Tapped id:"x"'], reached, launched)).toMatchObject({ why: `averi failed (${reply}) — the app shows it whole (fully visible as the stop needs)` });
  });
  it('an unchanged claim the app\'s strokes break: its words, then the reply', () => {
    const reply = 'ERROR scroll_until id:"x" failed after 2 swipes (the last 2, swiping down, did not change the screen: content exhausted)';
    const moved = state({ strokes: [stroke(0, 400, 'upper'), stroke(400, 800, 'upper')] });
    expect(judgeScroll({ ...c, unlisted: true }, [reply], moved, launched)).toEqual({ outcome: 'MISMATCH', cls: 'unchanged-claim', kind: 'refused', why: `averi says the last 2 swipes did not change the screen — the app logged upper 0→400, upper 400→800 in them: ${reply}`, app: app(moved) });
  });
  it('T17\'s gate: a hedged lead is LOUD only on a fully stop that claims the target — a plain stop\'s hedge, or a hedged reply that never found it, is judged as any other', () => {
    const hedged = `Element id:"x" ${describeScrollResult({ swipes: 3, visible: 1, clipped: [], flush: { edge: 'top', container: SCREEN, checked: false, why: 'budget' } })}`;
    const centreOut = state({ frames: { T: { x: 51, y: -40, width: 300, height: 64 } }, offsets: { page: 0 }, strokes: [stroke(382, 0)], events: [tap('T')] });
    expect(judgeScroll({ ...c, fully: true }, [hedged, 'Tapped'], centreOut, launched)).toMatchObject({ outcome: 'LOUD', cls: 'hedged-stop' });
    expect(judgeScroll(c, [hedged, 'Tapped'], centreOut, launched)).toMatchObject({ outcome: 'MISMATCH', cls: 'stop-claim', why: `averi says ${hedged.split('\n')[0].slice(0, 260)} — the app lays it out centre-out, not visible` });
    const lost = `${hedged}; element never appeared in the tree`;
    expect(judgeScroll({ ...c, fully: true }, [lost, 'Tapped'], centreOut, launched)).toMatchObject({ outcome: 'LOUD', cls: 'not-reached', kind: 'not found' });
  });
});

// The live record's figures (live-visibility.test.ts's judgeAndroidTurn block): A scrolled above the list, 4 swipes down.
describe('judgeAndroidTurn at its edges', () => {
  const list = { x: 0, y: 220, width: 1080, height: 2000 };
  const android = (over: Partial<LabState>): LabState => state({ screen: { x: 0, y: 0, width: 1080, height: 2220 }, scale: 1, safeArea: { top: 66, left: 0, bottom: 0, right: 0 }, scrollViews: { list }, ...over });
  const launched = android({ frames: { A: { x: 127, y: -11, width: 825, height: 176 } }, offsets: { list: 715 } });
  const after = (strokes: Stroke[]) => android({ frames: { A: { x: 127, y: -1784, width: 825, height: 176 } }, offsets: { list: 2488 }, strokes });
  const away = [stroke(715, 1984, 'list'), stroke(1984, 2488, 'list')];
  const c = { tag: 'A', view: 'list', fully: false, platform: 'android' as const, turnTo: 'up' as const };
  const failed = (swipes: number, last: number) =>
    `ERROR scroll_until id:"lab.scroll-collapsing.A" failed after ${swipes} swipes (the last ${last}, swiping down, did not change the screen: content exhausted) — element never appeared in the tree — scroll_until it with direction: "up"`;
  it('a target its tree does not list: the honest failure naming the way after the two-stroke stop is ok too', () => {
    const s = after(away);
    expect(judgeScroll({ ...c, unlisted: true }, [failed(4, 2)], s, launched)).toMatchObject({ outcome: 'LOUD', cls: 'not-reached' });
    expect(judgeAndroidTurn({ ...c, unlisted: true }, [failed(4, 2)], s, launched, s)).toEqual({ outcome: 'ok', kind: 'not found', why: `no turn on uiautomator (ADR 0021): 4 swipes, the last 2 unmoved, failed naming direction: "up" — ${failed(4, 2)}`, app: appText(s, 'android', 'A', 'list', launched) });
  });
  it('the unmoved swipes are the swipes less the strokes that moved the list more than the slack: a still stroke, one of the slack, another view\'s, all unmoved', () => {
    for (const extra of [stroke(2488, 2488, 'list'), stroke(2488, 2489, 'list'), stroke(0, 300, 'upper')]) {
      const s = after([...away, extra]);
      expect(judgeAndroidTurn(c, [failed(5, 3)], s, launched, s)).toMatchObject({ outcome: 'MISMATCH', cls: 'R-direction' });
    }
  });
});

describe('the presented layer\'s judges, whole', () => {
  const p = { tag: 'E', view: 'host', platform: 'ios' as const };
  const app = (s: LabState) => appText(s, 'ios', 'E', 'host', state());
  it('ok: strokes that moved nothing (still, or by the slack) are no stroke beneath', () => {
    const s = state({ strokes: [stroke(200, 200, 'host'), stroke(200, 201, 'host')] });
    expect(judgePresentedScroll(p, ['ERROR close it first'], s, state())).toEqual({ outcome: 'ok', kind: 'refused', why: 'refused, nothing moved or fired: ERROR close it first', app: app(s) });
  });
  it('each rule\'s words', () => {
    expect(judgePresentedScroll(p, ['Element id:"x" visible after 2 swipes'], state(), state())).toEqual({ outcome: 'MISMATCH', cls: 'presented-stop', kind: 'visible', why: 'averi says Element id:"x" visible after 2 swipes — the target lies beneath the presented layer', app: app(state()) });
    const changed = 'ERROR scroll_until id:"lab.sheet-background.A" stopped after 1 swipe — the swipe CHANGED THE SCREEN: the one element … is not in the tree after it';
    const touched = state({ events: [touch('201,175')] });
    expect(judgePresentedScroll(p, [changed], touched, state())).toEqual({ outcome: 'LOUD', cls: 'presented-changed', kind: 'refused', why: `nothing logged but the touches, and averi said its swipe changed the screen, claiming nothing — ${changed}`, app: app(touched) });
    const dismissed = state({ events: [{ kind: 'dismissed', tag: 'sheet', at }] });
    expect(judgePresentedScroll(p, ['ERROR'], dismissed, state())).toEqual({ outcome: 'MISMATCH', cls: 'presented-fired', kind: 'refused', why: 'the app logged dismissed sheet — averi: ERROR', app: app(dismissed) });
    const stroked = state({ strokes: [stroke(200, 0, 'host'), stroke(0, -100, 'host')] });
    expect(judgePresentedScroll(p, ['ERROR'], stroked, state())).toEqual({ outcome: 'MISMATCH', cls: 'presented-stroke', kind: 'refused', why: 'stroked beneath the presented layer: host 200→0, host 0→-100 — averi: ERROR', app: app(stroked) });
  });
  it('the colour assert: each verdict whole', () => {
    expect(judgePresentedAssert(['All 1 asserts passed'], state(), state())).toEqual({ outcome: 'MISMATCH', cls: 'presented-pass', kind: 'PASS', why: 'averi says All 1 asserts passed — the target lies beneath the presented layer' });
    expect(judgePresentedAssert(['0/1 asserts FAILED'], state({ events: [{ kind: 'dismissed', tag: 'sheet', at }] }), state())).toEqual({ outcome: 'MISMATCH', cls: 'presented-fired', kind: 'FAIL', why: 'the app logged dismissed sheet — averi: 0/1 asserts FAILED' });
    expect(judgePresentedAssert(['0/1 asserts FAILED'], state(), state())).toEqual({ outcome: 'ok', kind: 'FAIL', why: 'failed, nothing fired: 0/1 asserts FAILED' });
  });
  it('the colour assert case: said, read and judged as judgePresentedAssert', () => {
    const t: TargetTruth = { tag: 'A', id: 'lab.dialog-fullscreen.A', color: '#E53935', declared: 'presented-over', frame: { x: 0, y: 0, width: 100, height: 100 }, reached: false, probe: [], drawn: 0, seen: '#000000' };
    const asked = presentedAssertCase('dialog-fullscreen', t);
    expect(asked).toMatchObject({ says: 'colour assert A (#E53935) beneath the presented layer: fails, nothing fires', reads: { betweenCalls: true, late: false } });
    const s = state({ events: [{ kind: 'dismissed', tag: 'sheet', at }] });
    expect(asked.judge(s, ['0/1 asserts FAILED'], state(), 'uiautomator', [])).toEqual(judgePresentedAssert(['0/1 asserts FAILED'], s, state()));
  });
  it('the run asks it of round 7\'s presented windows alone, on Android (live-cases.ts#selectCases)', async () => {
    const asserts = async (platform: 'ios' | 'android') => (await selectCases({ platform, app: 'native', groups: ['visibility'] })).filter((x) => x.id.startsWith('assert:')).map((x) => x.id);
    expect(await asserts('android')).toEqual(['dialog-fullscreen', 'bottom-sheet-dialog', 'dialog-views-fullscreen'].flatMap((cell) => ['A', 'B', 'C', 'D'].map((tag) => `assert:${cell}.${tag}`)));
    expect(await asserts('ios')).toEqual([]);
  });
});

describe('judgeAbsentAtEnd\'s verdicts, whole', () => {
  const launched = state();
  const said = (swipes: number, cause: string) => `ERROR scroll_until id:"lab.scroll-top-edge-end.absent" failed after ${swipes} swipes (${cause}) — element never appeared in the tree`;
  const unchanged = 'the last 2, swiping down, did not change the screen: content exhausted';
  const still = state({ strokes: [stroke(1200, 1200), stroke(1200, 1200)] });
  it('ok after two unmoved swipes said so, nothing fired', () => {
    expect(judgeAbsentAtEnd([said(2, unchanged)], still, launched)).toEqual({ outcome: 'ok', kind: 'not found', why: `exhausted after 2 swipes, nothing fired — ${said(2, unchanged)}` });
  });
  it('each rule\'s words', () => {
    expect(judgeAbsentAtEnd([STOP], launched, launched)).toEqual({ outcome: 'MISMATCH', cls: 'stop-claim', kind: 'visible', why: `averi says ${STOP} — the row does not exist` });
    expect(judgeAbsentAtEnd([said(2, unchanged)], state({ events: [tap('T')] }), launched)).toEqual({ outcome: 'MISMATCH', cls: 'tap-claim', kind: 'not found', why: `the app logged tap T — averi: ${said(2, unchanged)}` });
    expect(judgeAbsentAtEnd([said(2, unchanged)], state({ strokes: [stroke(1200, 900), stroke(900, 600)] }), launched)).toEqual({ outcome: 'MISMATCH', cls: 'unchanged-claim', kind: 'not found', why: 'averi says the last 2 swipes did not change the screen — the app logged page 1200→900, page 900→600 in them' });
    const untried = `${said(2, unchanged)} — if it lies above, try direction: "up"`;
    expect(judgeAbsentAtEnd([untried], still, launched)).toEqual({ outcome: 'MISMATCH', cls: 'end-unread', kind: 'not found', why: `a list that never moved names a side never stroked — averi: ${untried}` });
  });
  it('more swipes than the two-stroke stop, or two without the unchanged claim: the end read as more to come', () => {
    const three = said(3, unchanged);
    expect(judgeAbsentAtEnd([three], state({ strokes: [stroke(1200, 1200), stroke(1200, 1200), stroke(1200, 1200)] }), launched)).toEqual({ outcome: 'MISMATCH', cls: 'end-unread', kind: 'not found', why: `the list's end read as more to come — averi: ${three}` });
    expect(judgeAbsentAtEnd([said(2, 'maxSwipes')], still, launched)).toMatchObject({ outcome: 'MISMATCH', cls: 'end-unread' });
  });
});

describe('the special cases\' judges at their edges', () => {
  const ANDROID = { screen: { x: 0, y: 0, width: 1080, height: 2220 }, scale: 1, safeArea: { top: 66, left: 0, bottom: 66, right: 0 } };

  describe('judgeBlankStretch: a plain stop, its loud failure the case\'s MISMATCH', () => {
    // tabbar-floating's list, here ending at 2050 so F can stop cut with its centre in; F at content y 5500.
    const list = { x: 0, y: 550, width: 1080, height: 1500 };
    const at = (offset: number, over: Partial<LabState> = {}): LabState => state({ ...ANDROID, frames: { F: { x: 66, y: 6050 - offset, width: 948, height: 143 } }, scrollViews: { list }, offsets: { list: offset }, ...over });
    const launched = at(0);
    const strokes = [stroke(0, 858, 'list'), stroke(858, 1714, 'list'), stroke(1714, 2578, 'list'), stroke(2578, 3437, 'list'), stroke(3437, 4100, 'list')];
    it('F cut at the list\'s edge with its centre in: the plain stop holds', () => {
      const s = at(4100, { strokes, events: [tap('F')] });
      expect(judgeBlankStretch('F', 'list', ['Element id:"lab.tabbar-floating.F" visible after 5 swipes', 'Tapped id:"lab.tabbar-floating.F"'], s, launched)).toMatchObject({ outcome: 'ok' });
    });
    it('not reached, said so: failed-holds, its words', () => {
      const reply = 'ERROR scroll_until id:"lab.tabbar-floating.F" failed after 4 swipes (maxSwipes) — element never appeared in the tree';
      const s = at(3437, { strokes: strokes.slice(0, 4) });
      expect(judgeBlankStretch('F', 'list', [reply], s, launched)).toMatchObject({ outcome: 'MISMATCH', cls: 'failed-holds', kind: 'not found', why: `past a blank stretch with the time to reach it, yet not reached (off-screen), and averi said so: ${reply}` });
    });
  });

  it('judgeWithin: the loud failure\'s words', () => {
    const LOWER = { x: 0, y: 1046, width: 1080, height: 495 };
    const at = (offset: number, over: Partial<LabState> = {}): LabState => state({ ...ANDROID, frames: { O: { x: 128, y: 1706 - offset, width: 825, height: 176 } }, scrollViews: { lower: LOWER }, offsets: { lower: offset }, ...over });
    const reply = 'ERROR scroll_until id:"lab.scroll-bounded.O" failed after 2 swipes (maxSwipes) — element never appeared in the tree';
    expect(judgeWithin('O', 'lower', [reply], at(200, { strokes: [stroke(0, 100, 'lower'), stroke(100, 200, 'lower')] }), at(0))).toMatchObject({ outcome: 'MISMATCH', cls: 'failed-holds', why: `within named lower, with the swipes and the time to reach it, yet not reached (sliver), and averi said so: ${reply}` });
  });

  describe('judgeAtRest: a fully stop, its loud failure the case\'s MISMATCH, its strokes after', () => {
    const rest = (over: Partial<LabState> = {}): LabState =>
      state({ ...ANDROID, frames: { R: { x: 128, y: 457, width: 825, height: 176 } }, scrollViews: { list: { x: 0, y: 303, width: 1080, height: 1238 } }, offsets: { list: 0 }, chrome: { stickyHeader: { x: 0, y: 303, width: 1080, height: 154 } }, ...over });
    const launched = rest();
    const VISIBLE = 'Element id:"lab.scroll-sticky-rest.R" fully visible after 1 swipe; a probe swipe toward it moved nothing';
    it('R under the header at the stop: the fully stop\'s claim stands as it is — not a loud failure, not the strokes\'', () => {
      const under = rest({ frames: { R: { x: 128, y: 400, width: 825, height: 176 } }, strokes: [stroke(0, 0, 'list')], events: [tap('R')] });
      const bare = 'Element id:"lab.scroll-sticky-rest.R" fully visible after 2 swipes';
      expect(judgeAtRest('R', 'list', [bare, 'Tapped id:"lab.scroll-sticky-rest.R"'], under, launched)).toMatchObject({ outcome: 'MISMATCH', cls: 'stop-claim' });
    });
    it('not reached, said so: failed-holds, its words', () => {
      const reply = 'ERROR scroll_until id:"lab.scroll-sticky-rest.R" failed after 2 swipes (maxSwipes)';
      const gone = rest({ frames: { R: { x: 128, y: -300, width: 825, height: 176 } } });
      expect(judgeAtRest('R', 'list', [reply], gone, launched)).toMatchObject({ outcome: 'MISMATCH', cls: 'failed-holds', kind: 'refused', why: `whole at rest, yet not reached (off-screen), and averi said so: ${reply}` });
    });
    it('the strokes that moved the list more than the slack, each named; a still one at another offset is none', () => {
      const s = rest({ strokes: [stroke(0, 1, 'list'), stroke(1, 0, 'list'), stroke(0, 66, 'list'), stroke(66, 66, 'list'), stroke(66, 0, 'list')], events: [tap('R')] });
      expect(judgeAtRest('R', 'list', [VISIBLE, 'Tapped id:"lab.scroll-sticky-rest.R"'], s, launched)).toMatchObject({ outcome: 'MISMATCH', cls: 'R-direction', kind: 'visible', why: `R-direction (at rest): a stroke moved list 0→66; a stroke moved list 66→0 — averi: ${VISIBLE}` });
    });
  });

  describe('judgeCarry at its edges', () => {
    const table = (over: Partial<LabState> = {}) => {
      const offset = over.offsets?.list ?? 0;
      return state({ frames: { L: { x: 0, y: 62 + 1920 - offset, width: 402, height: 64 } }, scrollViews: { list: { x: 0, y: 62, width: 402, height: 812 } }, offsets: undefined, ...over });
    };
    const launched = table();
    const reply = 'Element id:"lab.sheet-long-list.L" visible after 2 swipes';
    const carried = (offset: number, strokes: Leg[], over: Partial<LabState> = {}) => table({ offsets: { list: offset }, strokes: strokes.map(([from, to]) => stroke(from, to, 'list')), ...over }) as LabState;
    type Leg = [number, number];
    it('L cut at the table\'s bottom with its centre in: the plain stop holds', () => {
      expect(judgeCarry(reply, carried(1152, [[0, 1048], [1048, 1152]]), launched)).toMatchObject({ outcome: 'ok' });
    });
    it('a stop claim stands as judgeScroll\'s, whatever the strokes did', () => {
      expect(judgeCarry(reply, carried(2500, [[0, 1000], [1000, 2500]]), launched)).toMatchObject({ outcome: 'MISMATCH', cls: 'stop-claim' });
    });
    it('no frame of L or no clip at the start: judgeScroll\'s verdict, the carry unjudged', () => {
      const back: Leg[] = [[0, 1048], [1048, 1460], [1460, 1300], [1300, 1460]];
      expect(judgeCarry(reply, carried(1460, back), table({ frames: {} }))).toMatchObject({ outcome: 'ok' });
      expect(judgeCarry(reply, carried(1460, back, { scrollViews: {} }), table({ scrollViews: {} }))).toMatchObject({ outcome: 'ok' });
    });
    it('from a start not at the top: the window by the start\'s offset; a turn the strokes show is not said twice', () => {
      const start = table({ offsets: { list: 1100 } });
      const s = carried(1500, [[1100, 1990], [1990, 1500]], { events: [touch('201.0,712.0'), touch('201.0,224.0')] });
      expect(judgeCarry(reply, s, start)).toMatchObject({ outcome: 'MISMATCH', cls: 'R-direction', kind: 'visible', why: `R-direction (carry): a stroke back up (1990→1500): averi turned; a stroke carried it past its window (1100→1990: from below to above it) — averi: ${reply}` });
    });
    it('past its window is from below its bottom to above its top: a stroke from its bottom edge, or onto its top edge, is not', () => {
      expect(judgeCarry(reply, carried(1500, [[0, 1172], [1172, 2000], [2000, 1500]]), launched)).toMatchObject({ why: `R-direction (carry): a stroke back up (2000→1500): averi turned — averi: ${reply}` });
      expect(judgeCarry(reply, carried(1920, [[0, 1000], [1000, 1920]]), launched)).toMatchObject({ outcome: 'ok' });
    });
    it('a stroke back by the slack, or one that moved nothing, is no turn', () => {
      expect(judgeCarry(reply, carried(1459, [[0, 1048], [1048, 1460], [1460, 1459], [1459, 1459]]), launched)).toMatchObject({ outcome: 'ok' });
    });
    it('touchTurns: a touch-down on the clip\'s middle is in its lower half', () => {
      expect(touchTurns(state({ events: [touch('201.0,468.0'), touch('201.0,224.0')] }), state(), { x: 0, y: 62, width: 402, height: 812 })).toBe(1);
    });
  });
});

describe('the cases the live run asks of the committed static truth (tests/fixtures/truth): each case\'s id, calls and words', () => {
  const DIRS = { ios: 'ios-iphone17-ios27', android: 'android-averi_lab-api33' } as const;
  const truthOf = (platform: 'ios' | 'android', cell: string): CellTruth => JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'truth', DIRS[platform], `${cell}.truth.json`), 'utf8')) as CellTruth;
  const arg = ([k, v]: [string, unknown]) => `${k} ${typeof v === 'string' ? v : JSON.stringify(v)}`;
  const line = (x: VisibilityCase) => `${x.id} ${x.calls.map((k) => `${k.tool}(${Object.entries(k.args).map(arg).join(', ')})`).join(' ')} | ${x.says}`;
  const ASKED: Record<string, string[]> = {
    'ios scroll-top-edge': [
      `tap:scroll-top-edge.A tap(selector id:"lab.scroll-top-edge.A") | tap A (off-screen): refused, nothing fires — or fires it alone`,
      `scroll:scroll-top-edge.A scroll_until(selector id:"lab.scroll-top-edge.A", direction up) tap(selector id:"lab.scroll-top-edge.A") | scroll_until A (off-screen) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it`,
      `tap:scroll-top-edge.T tap(selector id:"lab.scroll-top-edge.T") | tap T (status-band): refused, nothing fires — or fires it alone`,
      `scroll:scroll-top-edge.T scroll_until(selector id:"lab.scroll-top-edge.T", direction up) tap(selector id:"lab.scroll-top-edge.T") | scroll_until T (status-band) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it`,
      `scroll:scroll-top-edge.T.fully scroll_until(selector id:"lab.scroll-top-edge.T", direction up, fully true) tap(selector id:"lab.scroll-top-edge.T") | scroll_until T (status-band) up, fully: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it`,
      `turn:scroll-top-edge.T scroll_until(selector id:"lab.scroll-top-edge.T", direction down) tap(selector id:"lab.scroll-top-edge.T") | turn back: T in the status band, more content below: a stroke down carries it off the top — turn back`,
    ],
    'ios scroll-top-edge-end': [
      `tap:scroll-top-edge-end.A tap(selector id:"lab.scroll-top-edge-end.A") | tap A (off-screen): refused, nothing fires — or fires it alone`,
      `scroll:scroll-top-edge-end.A scroll_until(selector id:"lab.scroll-top-edge-end.A", direction up) tap(selector id:"lab.scroll-top-edge-end.A") | scroll_until A (off-screen) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it`,
      `tap:scroll-top-edge-end.T tap(selector id:"lab.scroll-top-edge-end.T") | tap T (status-band): refused, nothing fires — or fires it alone`,
      `scroll:scroll-top-edge-end.T scroll_until(selector id:"lab.scroll-top-edge-end.T", direction up) tap(selector id:"lab.scroll-top-edge-end.T") | scroll_until T (status-band) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it`,
      `scroll:scroll-top-edge-end.T.fully scroll_until(selector id:"lab.scroll-top-edge-end.T", direction up, fully true) tap(selector id:"lab.scroll-top-edge-end.T") | scroll_until T (status-band) up, fully: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it`,
      `turn:scroll-top-edge-end.T scroll_until(selector id:"lab.scroll-top-edge-end.T", direction down) tap(selector id:"lab.scroll-top-edge-end.T") | turn back: the content at its end downward, T in the status band: the strokes down move nothing — turn back up (#17)`,
      `turn:scroll-top-edge-end.T.fully scroll_until(selector id:"lab.scroll-top-edge-end.T", direction down, fully true) tap(selector id:"lab.scroll-top-edge-end.T") | turn back: as the plain one, fully: turn back up (#17)`,
      `absent:scroll-top-edge-end scroll_until(selector id:"lab.scroll-top-edge-end.absent", direction down) | scroll_until a row scroll-top-edge-end does not have, down into page's end: fails after at most 2 swipes saying the last did not change the screen, nothing fired — not the whole budget (ADR 0021 decision 6)`,
    ],
    'ios scroll-bounded': [
      `tap:scroll-bounded.W tap(selector id:"lab.scroll-bounded.W") | tap W (whole): fires it alone`,
      `tap:scroll-bounded.P tap(selector id:"lab.scroll-bounded.P") | tap P (partly-centre-in): fires it alone`,
      `scroll:scroll-bounded.P scroll_until(selector id:"lab.scroll-bounded.P", direction down) tap(selector id:"lab.scroll-bounded.P") | scroll_until P (partly-centre-in) down: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it`,
      `scroll:scroll-bounded.P.fully scroll_until(selector id:"lab.scroll-bounded.P", direction down, fully true) tap(selector id:"lab.scroll-bounded.P") | scroll_until P (partly-centre-in) down, fully: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it`,
      `tap:scroll-bounded.S tap(selector id:"lab.scroll-bounded.S") | tap S (sliver): refused, nothing fires — or fires it alone`,
      `scroll:scroll-bounded.S scroll_until(selector id:"lab.scroll-bounded.S", direction down) tap(selector id:"lab.scroll-bounded.S") | scroll_until S (sliver) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it`,
      `scroll:scroll-bounded.S.fully scroll_until(selector id:"lab.scroll-bounded.S", direction down, fully true) tap(selector id:"lab.scroll-bounded.S") | scroll_until S (sliver) down, fully: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it`,
      `tap:scroll-bounded.O tap(selector id:"lab.scroll-bounded.O") | tap O (outside-scroll-view): refused, nothing fires — or fires it alone`,
      `scroll:scroll-bounded.O scroll_until(selector id:"lab.scroll-bounded.O", direction down) tap(selector id:"lab.scroll-bounded.O") | scroll_until O (outside-scroll-view) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it`,
      `tap:scroll-bounded.F tap(selector id:"lab.scroll-bounded.F") | tap F (off-screen): refused, nothing fires — or fires it alone`,
      `scroll:scroll-bounded.F scroll_until(selector id:"lab.scroll-bounded.F", direction down) tap(selector id:"lab.scroll-bounded.F") | scroll_until F (off-screen) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it`,
      `turn:scroll-bounded.F scroll_until(selector id:"lab.scroll-bounded.F", direction up) tap(selector id:"lab.scroll-bounded.F") | turn back: lower at its top, F below: a stroke up moves nothing — turn back down`,
    ],
    'ios sheet-long-list': [
      `tap:sheet-long-list.R tap(selector id:"lab.sheet-long-list.R") | tap R (whole): fires it alone`,
      `tap:sheet-long-list.F tap(selector id:"lab.sheet-long-list.F") | tap F (off-screen): refused, nothing fires — or fires it alone`,
      `scroll:sheet-long-list.F scroll_until(selector id:"lab.sheet-long-list.F", direction down) tap(selector id:"lab.sheet-long-list.F") | scroll_until F (off-screen) down: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it`,
      `tap:sheet-long-list.L tap(selector id:"lab.sheet-long-list.L") | tap L (off-screen): refused, nothing fires — or fires it alone`,
      `scroll:sheet-long-list.L scroll_until(selector id:"lab.sheet-long-list.L", direction down) tap(selector id:"lab.sheet-long-list.L") | scroll_until L (off-screen) down: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it`,
      `carry:sheet-long-list.L scroll_until(selector id:"lab.sheet-long-list.L", direction down) | scroll_until L (row 30 of the table, whole over offsets 1172–1920, past one stroke's carry from the top and before the table's end) down: stops on it, every stroke on list bringing it closer, none carrying it past its window, no turn (LV5's carry on a long list)`,
    ],
    'ios bands': [
      `tap:bands.S tap(selector id:"lab.bands.S") | tap S (status-band): refused, nothing fires — or fires it alone`,
      `tap:bands.O tap(selector id:"lab.bands.O") | tap O (band-overlap:status): fires it alone`,
      `tap:bands.W tap(selector id:"lab.bands.W") | tap W (whole): fires it alone`,
      `tap:bands.Q tap(selector id:"lab.bands.Q") | tap Q (whole): fires it alone`,
      `tap:bands.N tap(selector id:"lab.bands.N") | tap N (whole): fires it alone`,
    ],
    'android scroll-top-edge': [
      `tap:scroll-top-edge.A tap(selector id:"lab.scroll-top-edge.A") | tap A (off-screen): refused, nothing fires — or fires it alone`,
      `scroll:scroll-top-edge.A scroll_until(selector id:"lab.scroll-top-edge.A", direction up) tap(selector id:"lab.scroll-top-edge.A") | scroll_until A (off-screen) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it`,
      `tap:scroll-top-edge.T tap(selector id:"lab.scroll-top-edge.T") | tap T (status-band): refused, nothing fires — or fires it alone`,
      `scroll:scroll-top-edge.T scroll_until(selector id:"lab.scroll-top-edge.T", direction up) tap(selector id:"lab.scroll-top-edge.T") | scroll_until T (status-band) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it`,
      `scroll:scroll-top-edge.T.fully scroll_until(selector id:"lab.scroll-top-edge.T", direction up, fully true) tap(selector id:"lab.scroll-top-edge.T") | scroll_until T (status-band) up, fully: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it`,
      `turn:scroll-top-edge.T scroll_until(selector id:"lab.scroll-top-edge.T", direction down) tap(selector id:"lab.scroll-top-edge.T") | no turn on uiautomator (ADR 0021): T in the status band, more content below: a stroke down carries it off the top — turn back — averi keeps down and fails loudly naming up after at most 2 unmoved strokes`,
    ],
    'android scroll-top-edge-end': [
      `tap:scroll-top-edge-end.A tap(selector id:"lab.scroll-top-edge-end.A") | tap A (off-screen): refused, nothing fires — or fires it alone`,
      `scroll:scroll-top-edge-end.A scroll_until(selector id:"lab.scroll-top-edge-end.A", direction up) tap(selector id:"lab.scroll-top-edge-end.A") | scroll_until A (off-screen) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it`,
      `tap:scroll-top-edge-end.T tap(selector id:"lab.scroll-top-edge-end.T") | tap T (status-band): refused, nothing fires — or fires it alone`,
      `scroll:scroll-top-edge-end.T scroll_until(selector id:"lab.scroll-top-edge-end.T", direction up) tap(selector id:"lab.scroll-top-edge-end.T") | scroll_until T (status-band) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it`,
      `scroll:scroll-top-edge-end.T.fully scroll_until(selector id:"lab.scroll-top-edge-end.T", direction up, fully true) tap(selector id:"lab.scroll-top-edge-end.T") | scroll_until T (status-band) up, fully: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it`,
      `turn:scroll-top-edge-end.T scroll_until(selector id:"lab.scroll-top-edge-end.T", direction down) tap(selector id:"lab.scroll-top-edge-end.T") | no turn on uiautomator (ADR 0021): the content at its end downward, T in the status band: the strokes down move nothing — turn back up (#17) — averi keeps down and fails loudly naming up after at most 2 unmoved strokes`,
      `turn:scroll-top-edge-end.T.fully scroll_until(selector id:"lab.scroll-top-edge-end.T", direction down, fully true) tap(selector id:"lab.scroll-top-edge-end.T") | no turn on uiautomator (ADR 0021): as the plain one, fully: turn back up (#17) — averi keeps down and fails loudly naming up after at most 2 unmoved strokes`,
    ],
    'android scroll-bounded': [
      `tap:scroll-bounded.W tap(selector id:"lab.scroll-bounded.W") | tap W (whole): fires it alone`,
      `tap:scroll-bounded.P tap(selector id:"lab.scroll-bounded.P") | tap P (partly-centre-in): fires it alone`,
      `scroll:scroll-bounded.P scroll_until(selector id:"lab.scroll-bounded.P", direction down) tap(selector id:"lab.scroll-bounded.P") | scroll_until P (partly-centre-in) down: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it`,
      `scroll:scroll-bounded.P.fully scroll_until(selector id:"lab.scroll-bounded.P", direction down, fully true) tap(selector id:"lab.scroll-bounded.P") | scroll_until P (partly-centre-in) down, fully: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it`,
      `tap:scroll-bounded.S tap(selector id:"lab.scroll-bounded.S") | tap S (sliver): refused, nothing fires — or fires it alone`,
      `scroll:scroll-bounded.S scroll_until(selector id:"lab.scroll-bounded.S", direction down) tap(selector id:"lab.scroll-bounded.S") | scroll_until S (sliver) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it`,
      `scroll:scroll-bounded.S.fully scroll_until(selector id:"lab.scroll-bounded.S", direction down, fully true) tap(selector id:"lab.scroll-bounded.S") | scroll_until S (sliver) down, fully: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it`,
      `tap:scroll-bounded.O tap(selector id:"lab.scroll-bounded.O") | tap O (outside-scroll-view): refused, nothing fires — or fires it alone`,
      `scroll:scroll-bounded.O scroll_until(selector id:"lab.scroll-bounded.O", direction down) tap(selector id:"lab.scroll-bounded.O") | scroll_until O (outside-scroll-view) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it`,
      `tap:scroll-bounded.F tap(selector id:"lab.scroll-bounded.F") | tap F (off-screen): refused, nothing fires — or fires it alone`,
      `scroll:scroll-bounded.F scroll_until(selector id:"lab.scroll-bounded.F", direction down) tap(selector id:"lab.scroll-bounded.F") | scroll_until F (off-screen) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it`,
      `turn:scroll-bounded.F scroll_until(selector id:"lab.scroll-bounded.F", direction up) tap(selector id:"lab.scroll-bounded.F") | no turn on uiautomator (ADR 0021): lower at its top, F below: a stroke up moves nothing — turn back down — averi keeps up and fails loudly naming down after at most 2 unmoved strokes; under uiautomator F is not in the tree, so no turn is asked there, only an honest reply`,
      `within:scroll-bounded.O scroll_until(selector id:"lab.scroll-bounded.O", direction down, within {"x":0,"y":1046,"width":1080,"height":495}, maxSwipes 12, timeoutMs 30000) tap(selector id:"lab.scroll-bounded.O") | scroll_until O down with within naming lower (its rect), maxSwipes 12, timeoutMs 30000: every stroke on lower bringing it closer, it stops on O, then the tap fires it (D78)`,
      `within:scroll-bounded.F scroll_until(selector id:"lab.scroll-bounded.F", direction down, within id:"lab.scroll-bounded.S", maxSwipes 12, timeoutMs 30000) tap(selector id:"lab.scroll-bounded.F") | scroll_until F down with within naming lower (a row of it, id:"lab.scroll-bounded.S"), maxSwipes 12, timeoutMs 30000: every stroke on lower bringing it closer, it stops on F, then the tap fires it (D78)`,
    ],
    'android scroll-collapsing': [
      `tap:scroll-collapsing.A tap(selector id:"lab.scroll-collapsing.A") | tap A (outside-scroll-view): refused, nothing fires — or fires it alone`,
      `scroll:scroll-collapsing.A scroll_until(selector id:"lab.scroll-collapsing.A", direction up) tap(selector id:"lab.scroll-collapsing.A") | scroll_until A (outside-scroll-view) up: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it`,
      `tap:scroll-collapsing.D tap(selector id:"lab.scroll-collapsing.D") | tap D (partly-centre-in): fires it alone`,
      `scroll:scroll-collapsing.D scroll_until(selector id:"lab.scroll-collapsing.D", direction up) tap(selector id:"lab.scroll-collapsing.D") | scroll_until D (partly-centre-in) up: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it`,
      `scroll:scroll-collapsing.D.fully scroll_until(selector id:"lab.scroll-collapsing.D", direction up, fully true) tap(selector id:"lab.scroll-collapsing.D") | scroll_until D (partly-centre-in) up, fully: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it`,
      `turn:scroll-collapsing.A scroll_until(selector id:"lab.scroll-collapsing.A", direction down) tap(selector id:"lab.scroll-collapsing.A") | no turn on uiautomator (ADR 0021): A scrolled above the list, its uiautomator bounds inverted: a stroke down carries it further — turn back up (#10) — averi keeps down and fails loudly naming up after at most 2 unmoved strokes`,
    ],
    'android scroll-sticky-rest': [
      `tap:scroll-sticky-rest.R tap(selector id:"lab.scroll-sticky-rest.R") | tap R (whole): fires it alone`,
      `rest:scroll-sticky-rest.R.fully scroll_until(selector id:"lab.scroll-sticky-rest.R", direction down, fully true) tap(selector id:"lab.scroll-sticky-rest.R") | scroll_until R (whole, flush under the sticky header pinned in list) down, fully: stops on it after at most the probes that move nothing (two since T12), then the tap fires it (VA1's at-rest twin)`,
    ],
    'android tabbar-floating': [
      `tap:tabbar-floating.T tap(selector id:"lab.tabbar-floating.T") | tap T (whole): fires it alone`,
      `tap:tabbar-floating.R tap(selector id:"lab.tabbar-floating.R") | tap R (under-chrome:tabBar): refused, nothing fires — or fires it alone`,
      `scroll:tabbar-floating.R scroll_until(selector id:"lab.tabbar-floating.R", direction down) tap(selector id:"lab.tabbar-floating.R") | scroll_until R (under-chrome:tabBar) down: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it`,
      `tap:tabbar-floating.F tap(selector id:"lab.tabbar-floating.F") | tap F (off-screen): refused, nothing fires — or fires it alone`,
      `scroll:tabbar-floating.F scroll_until(selector id:"lab.tabbar-floating.F", direction down) tap(selector id:"lab.tabbar-floating.F") | scroll_until F (off-screen) down: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it`,
      `blank:tabbar-floating.F scroll_until(selector id:"lab.tabbar-floating.F", direction down, timeoutMs 30000) tap(selector id:"lab.tabbar-floating.F") | scroll_until F down past the blank stretch of list (no node between R and F), timeoutMs 30000: the blank reads end nothing — it stops on F, every stroke on list bringing it closer, then the tap fires it (LV1)`,
    ],
    'android dialog-fullscreen': [
      `tap:dialog-fullscreen.A tap(selector id:"lab.dialog-fullscreen.A") | tap A (presented-over): refused, nothing fires — or fires it alone`,
      `scroll:dialog-fullscreen.A scroll_until(selector id:"lab.dialog-fullscreen.A", direction up) | scroll_until A beneath the presented layer: refused, nothing stroked, nothing dismissed`,
      `tap:dialog-fullscreen.B tap(selector id:"lab.dialog-fullscreen.B") | tap B (presented-over): refused, nothing fires — or fires it alone`,
      `scroll:dialog-fullscreen.B scroll_until(selector id:"lab.dialog-fullscreen.B", direction up) | scroll_until B beneath the presented layer: refused, nothing stroked, nothing dismissed`,
      `tap:dialog-fullscreen.C tap(selector id:"lab.dialog-fullscreen.C") | tap C (presented-over): refused, nothing fires — or fires it alone`,
      `scroll:dialog-fullscreen.C scroll_until(selector id:"lab.dialog-fullscreen.C", direction down) | scroll_until C beneath the presented layer: refused, nothing stroked, nothing dismissed`,
      `tap:dialog-fullscreen.D tap(selector id:"lab.dialog-fullscreen.D") | tap D (presented-over): refused, nothing fires — or fires it alone`,
      `scroll:dialog-fullscreen.D scroll_until(selector id:"lab.dialog-fullscreen.D", direction down) | scroll_until D beneath the presented layer: refused, nothing stroked, nothing dismissed`,
      `tap:dialog-fullscreen.S tap(selector id:"lab.dialog-fullscreen.S") | tap S (open): fires it alone`,
    ],
    'android bands': [
      `tap:bands.S tap(selector id:"lab.bands.S") | tap S (status-band): refused, nothing fires — or fires it alone`,
      `tap:bands.O tap(selector id:"lab.bands.O") | tap O (band-overlap:status): fires it alone`,
      `tap:bands.W tap(selector id:"lab.bands.W") | tap W (whole): fires it alone`,
      `tap:bands.Q tap(selector id:"lab.bands.Q") | tap Q (band-overlap:nav): fires it alone`,
      `tap:bands.N tap(selector id:"lab.bands.N") | tap N (nav-band): refused, nothing fires — or fires it alone`,
    ],
  };
  it.each(Object.keys(ASKED))('%s', (key) => {
    const [platform, cell] = key.split(' ') as ['ios' | 'android', string];
    const cases = visibilityCases(truthOf(platform, cell), platform);
    expect(cases.map(line)).toEqual(ASKED[key]);
    // Every one judged on the state read when scroll_until returned (run-case.ts reads it between the calls).
    for (const x of cases) expect(x.reads).toEqual({ betweenCalls: true, late: false });
  });

  describe('each case judges by its own judge, on the state read between the calls — the final one where none was read', () => {
    const judged = (platform: 'ios' | 'android', cell: string, id: string) => visibilityCases(truthOf(platform, cell), platform).find((x) => x.id === id)!;
    const ANDROID = { screen: { x: 0, y: 0, width: 1080, height: 2220 }, scale: 1, safeArea: { top: 66, left: 0, bottom: 0, right: 0 } };
    it('the at-rest, blank-stretch and within cases', () => {
      const rest = state({ ...ANDROID, frames: { R: { x: 128, y: 457, width: 825, height: 176 } }, scrollViews: { list: { x: 0, y: 303, width: 1080, height: 1238 } }, offsets: { list: 0 }, strokes: [stroke(0, 0, 'list')], events: [tap('R')] });
      const restReplies = ['Element id:"lab.scroll-sticky-rest.R" fully visible after 1 swipe', 'Tapped id:"lab.scroll-sticky-rest.R"'];
      expect(judged('android', 'scroll-sticky-rest', 'rest:scroll-sticky-rest.R.fully').judge(rest, restReplies, rest, 'uiautomator', [])).toEqual(judgeAtRest('R', 'list', restReplies, rest, rest, rest));
      const lost = ['ERROR scroll_until id:"x" failed after 2 swipes (maxSwipes)'];
      const blank = judged('android', 'tabbar-floating', 'blank:tabbar-floating.F');
      const list = state({ ...ANDROID, frames: { F: { x: 66, y: 6050, width: 948, height: 143 } }, scrollViews: { list: { x: 0, y: 550, width: 1080, height: 1670 } }, offsets: { list: 0 } });
      expect(blank.judge(list, lost, list, 'uiautomator', [])).toEqual(judgeBlankStretch('F', 'list', lost, list, list, list));
      const lower = state({ ...ANDROID, frames: { O: { x: 128, y: 1706, width: 825, height: 176 } }, scrollViews: { lower: { x: 0, y: 1046, width: 1080, height: 495 } }, offsets: { lower: 0 } });
      expect(judged('android', 'scroll-bounded', 'within:scroll-bounded.O').judge(lower, lost, lower, 'uiautomator', [])).toEqual(judgeWithin('O', 'lower', lost, lower, lower, lower));
    });
    it('a stop read between the calls: the at-rest, blank-stretch and within cases judge their stop on it, the tap on the final state', () => {
      const list = { x: 0, y: 550, width: 1080, height: 1670 };
      const f = (y: number, over: Partial<LabState> = {}) => state({ ...ANDROID, frames: { F: { x: 66, y, width: 948, height: 143 } }, scrollViews: { list }, offsets: { list: 0 }, ...over });
      const replies = ['Element id:"lab.tabbar-floating.F" visible after 1 swipe', 'Tapped id:"lab.tabbar-floating.F"'];
      const [launched, atStop, final] = [f(6050), f(1200, { strokes: [stroke(0, 400, 'list')] }), f(-500, { strokes: [stroke(0, 400, 'list')], events: [tap('F')] })];
      expect(judged('android', 'tabbar-floating', 'blank:tabbar-floating.F').judge(final, replies, launched, 'uiautomator', [atStop])).toEqual(judgeBlankStretch('F', 'list', replies, final, launched, atStop));
      const o = (y: number, over: Partial<LabState> = {}) => state({ ...ANDROID, frames: { O: { x: 128, y, width: 825, height: 176 } }, scrollViews: { lower: { x: 0, y: 1046, width: 1080, height: 495 } }, offsets: { lower: 0 }, ...over });
      const within = ['Element id:"lab.scroll-bounded.O" visible after 1 swipe', 'Tapped id:"lab.scroll-bounded.O"'];
      expect(judged('android', 'scroll-bounded', 'within:scroll-bounded.O').judge(o(-500, { events: [tap('O')] }), within, o(1706), 'uiautomator', [o(1200)])).toEqual(judgeWithin('O', 'lower', within, o(-500, { events: [tap('O')] }), o(1706), o(1200)));
      const r = (y: number, over: Partial<LabState> = {}) => state({ ...ANDROID, frames: { R: { x: 128, y, width: 825, height: 176 } }, scrollViews: { list: { x: 0, y: 303, width: 1080, height: 1238 } }, offsets: { list: 0 }, ...over });
      const rest = ['Element id:"lab.scroll-sticky-rest.R" fully visible after 1 swipe', 'Tapped id:"lab.scroll-sticky-rest.R"'];
      expect(judged('android', 'scroll-sticky-rest', 'rest:scroll-sticky-rest.R.fully').judge(r(-500, { events: [tap('R')] }), rest, r(457), 'uiautomator', [r(457)])).toEqual(judgeAtRest('R', 'list', rest, r(-500, { events: [tap('R')] }), r(457), r(457)));
      expect(judgeAtRest('R', 'list', rest, r(-500, { events: [tap('R')] }), r(457), r(457)).outcome).toBe('ok');
    });
    it('the absent and carry cases (iOS)', () => {
      const end = state({ strokes: [stroke(1200, 1200), stroke(1200, 1200)] });
      const reply = ['ERROR scroll_until id:"lab.scroll-top-edge-end.absent" failed after 2 swipes (the last 2, swiping down, did not change the screen: content exhausted) — element never appeared in the tree'];
      expect(judged('ios', 'scroll-top-edge-end', 'absent:scroll-top-edge-end').judge(end, reply, state(), 'wda', [])).toEqual(judgeAbsentAtEnd(reply, end, state()));
      const table = state({ frames: { L: { x: 0, y: 522, width: 402, height: 64 } }, scrollViews: { list: { x: 0, y: 62, width: 402, height: 812 } }, offsets: { list: 1460 }, strokes: [stroke(0, 1460, 'list')] });
      const start = { ...table, frames: { L: { x: 0, y: 1982, width: 402, height: 64 } }, offsets: { list: 0 }, strokes: [] };
      const stop = 'Element id:"lab.sheet-long-list.L" visible after 1 swipe';
      expect(judged('ios', 'sheet-long-list', 'carry:sheet-long-list.L').judge(table, [stop], start, 'wda', [])).toEqual(judgeCarry(stop, table, start));
    });
    it('the scroll beneath a presented layer, with its target in no scroll view', () => {
      const s = state({ ...ANDROID, events: [touch('540,1776')] });
      const refused = ['ERROR close it first'];
      expect(judged('android', 'dialog-fullscreen', 'scroll:dialog-fullscreen.A').judge(s, refused, state(), 'uiautomator', [])).toEqual(judgePresentedScroll({ tag: 'A', view: undefined, platform: 'android' }, refused, s, state()));
    });
    it('a tap on a target a source does not list: a refusal ok under that source, LOUD under one that lists it', () => {
      const tapR = judged('ios', 'sheet-long-list', 'tap:sheet-long-list.R');
      expect(tapR.judge(state(), ['ERROR not found'], state(), 'idb', [])).toMatchObject({ outcome: 'ok' });
      expect(tapR.judge(state(), ['ERROR not found'], state(), 'wda', [])).toMatchObject({ outcome: 'LOUD', cls: 'tap-refused' });
    });
    it('the Android turn-back cases: judgeAndroidTurn, fully where the case is, unlisted where its source does not list it', () => {
      const page = { x: 0, y: 0, width: 1080, height: 2220 };
      const at = (y: number, offset: number, over: Partial<LabState> = {}) => state({ ...ANDROID, frames: { T: { x: 128, y, width: 825, height: 176 } }, scrollViews: { page }, offsets: { page: offset }, ...over });
      const launched = at(2000, 500);
      // T cut at the screen's bottom with its centre in: the plain stop holds, the fully one does not.
      const cut = at(2100, 400, { strokes: [stroke(500, 400)], events: [tap('T')] });
      const stop = ['Element id:"lab.scroll-top-edge-end.T" visible after 1 swipe', 'Tapped id:"lab.scroll-top-edge-end.T"'];
      const turn = { tag: 'T', view: 'page', platform: 'android' as const, unlisted: false, axis: 'y' as const, turnTo: 'up' as const };
      const plain = judged('android', 'scroll-top-edge-end', 'turn:scroll-top-edge-end.T');
      const fully = judged('android', 'scroll-top-edge-end', 'turn:scroll-top-edge-end.T.fully');
      expect(plain.judge(cut, stop, launched, 'uiautomator', [])).toEqual(judgeAndroidTurn({ ...turn, fully: false }, stop, cut, launched, cut));
      expect(plain.judge(cut, stop, launched, 'uiautomator', []).outcome).toBe('ok');
      expect(fully.judge(cut, stop, launched, 'uiautomator', [])).toEqual(judgeAndroidTurn({ ...turn, fully: true }, stop, cut, launched, cut));
      expect(fully.judge(cut, stop, launched, 'uiautomator', [])).toMatchObject({ outcome: 'MISMATCH', cls: 'stop-claim' });
      // Two strokes that moved nothing, T not whole: no turn back — judged where T is listed, reported where it is not.
      const stuck = at(2100, 500, { strokes: [stroke(500, 500), stroke(500, 500)] });
      const failed = ['ERROR scroll_until id:"x" failed after 2 swipes (maxSwipes)'];
      expect(plain.judge(stuck, failed, at(2100, 500), 'uiautomator', [])).toMatchObject({ outcome: 'MISMATCH', cls: 'R-direction' });
      const f = state({ ...ANDROID, frames: { F: { x: 128, y: 3796, width: 825, height: 176 } }, scrollViews: { lower: { x: 0, y: 1046, width: 1080, height: 495 } }, offsets: { lower: 0 } });
      const fStuck = { ...f, strokes: [stroke(0, 0, 'lower'), stroke(0, 0, 'lower')] };
      expect(judged('android', 'scroll-bounded', 'turn:scroll-bounded.F').judge(fStuck, failed, f, 'uiautomator', [])).toMatchObject({ outcome: 'LOUD', cls: 'not-reached' });
    });
  });
});

describe('visibilityCases on truths the corpus does not hold', () => {
  const target = (over: Partial<TargetTruth>): TargetTruth => ({ tag: 'T', id: 'lab.c.T', color: '#000000', declared: 'open', frame: { x: 51, y: -2, width: 300, height: 64 }, reached: false, probe: [], drawn: 1, seen: '#000000', ...over });
  const truth = (cell: string, targets: TargetTruth[], over: Partial<CellTruth> = {}): CellTruth => ({ cell, layer: 'none', device: 'd', screen: { width: 1080, height: 2220 }, scale: 1, targets, ...over });
  const ids = (t: CellTruth, platform: 'ios' | 'android' = 'android') => visibilityCases(t, platform).map((x) => x.id);
  it('a whole target its probe did not reach is asked nothing; one with no measured geometry, its tap alone', () => {
    expect(ids(truth('c', [target({ geometry: 'whole', scrollView: 'page' })]))).toEqual([]);
    expect(ids(truth('c', [target({ reached: true, scrollView: 'page' })]))).toEqual(['tap:c.T']);
  });
  it('the at-rest, within and blank cases: only on Android, only for their own target in a scroll view, `within` only where the truth names the list', () => {
    const R = target({ tag: 'R', id: 'lab.scroll-sticky-rest.R', geometry: 'whole', reached: true, scrollView: 'list' });
    expect(ids(truth('scroll-sticky-rest', [R]), 'ios')).toEqual(['tap:scroll-sticky-rest.R']);
    expect(ids(truth('scroll-sticky-rest', [target({ tag: 'X', id: 'lab.x.X', geometry: 'whole', reached: true }), R]))).toEqual(['tap:scroll-sticky-rest.X', 'tap:scroll-sticky-rest.R', 'rest:scroll-sticky-rest.R.fully']);
    expect(ids(truth('scroll-sticky-rest', []))).toEqual([]);
    expect(ids(truth('tabbar-floating', []))).toEqual([]);
    const O = target({ tag: 'O', id: 'lab.scroll-bounded.O', geometry: 'off-screen', scrollView: 'lower' });
    expect(ids(truth('scroll-bounded', [O]))).toEqual(['tap:scroll-bounded.O', 'scroll:scroll-bounded.O']);
    expect(ids(truth('scroll-bounded', [O], { scrollViews: { lower: { x: 0, y: 1046, width: 1080, height: 495 } } }))).toEqual(['tap:scroll-bounded.O', 'scroll:scroll-bounded.O', 'within:scroll-bounded.O']);
  });
  it('a turn-back target no source of its capture lists: every such source named', () => {
    const T = target({ geometry: 'status-band', scrollView: 'page', visible: { x: 51, y: 0, width: 300, height: 62 }, listed: { idb: false, wda: false } });
    const says = visibilityCases(truth('scroll-top-edge', [T], { screen: { width: 402, height: 874 }, scale: 3 }), 'ios').find((x) => x.id === 'turn:scroll-top-edge.T')?.says;
    expect(says).toBe('the wrong direction: T in the status band, more content below: a stroke down carries it off the top — turn back — under idb, wda T is not in the tree, so no turn is asked there, only an honest reply');
  });
});
