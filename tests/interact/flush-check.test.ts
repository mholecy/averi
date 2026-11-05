import { describe, expect, it } from 'vitest';
import type { Rect, ScrollAxis, Stroke, UiNode } from '../../src/adapters/types.js';
import { probing, seeFlush, startFlush, type FlushCheck, type FlushSeen, type FlushStop, type FlushVerdict } from '../../src/interact/flush-check.js';
import { judgeRead, type AppliedKeyboard } from '../../src/interact/scroll-read.js';
import { startStrokes } from '../../src/interact/stroke-plan.js';
import type { Direction } from '../../src/interact/swipe.js';
import type { Edge } from '../../src/ui-tree/geometry.js';
import type { UsableScreen } from '../../src/ui-tree/usable-screen.js';
import { node } from '../helpers/fake.js';

/**
 * THE FLUSH CHECK through its interface (interact/flush-check.ts): a `fully: true` stop's match in a clipping list, as
 * rects, in; the verdict out — none, the stop's `Flush`, the proven cut (`FlushCut`), the witness to ask first, or the
 * probe or reveal to send — with whether the read settles or may wait. Each read is judged as the round judges it
 * (interact/scroll-read.ts#judgeRead) on an Android-sized screen, the list marked as Android marks a clipping
 * container. When the round shows the check a stop at all, and what it does with the verdict, is pinned in its play
 * tables (tests/interact/scroll-flush-reveal.test.ts, scroll-rounds.test.ts).
 */

const SCREEN_BOX: Rect = { x: 0, y: 0, width: 1080, height: 2220 };
const SCREEN: UsableScreen = { box: SCREEN_BOX, boxes: [SCREEN_BOX], oriented: SCREEN_BOX, from: 'device' };
/** The probe's travel cap: 0.08 of the screen's long side (course.ts#PROBE_MAX_TRAVEL_FRACTION). */
const CAP = 177;
/** A list of the lab's bounded-flush shape: `[0,1046][1080,1541]` — its axis untold, as a lazy list's, so it serves the left and right edges too. */
const LIST: Rect = { x: 0, y: 1046, width: 1080, height: 495 };
const SWIPE: Stroke = { from: { x: 540, y: 1400 }, to: { x: 540, y: 1200 } };
const TAP: Stroke = { from: { x: 540, y: 1443 }, to: { x: 540, y: 1425 } }; // 18 px, under twice the slop

/** How a stop is shown: its list (and that list's axis, untold by default), what is listed after the row in it, the stroke drawn and the probe's means. */
interface StopShown {
  list?: Rect;
  axis?: ScrollAxis;
  after?: UiNode[];
  drawn?: Stroke;
  budget?: boolean;
  gesture?: Rect;
  offered?: AppliedKeyboard;
  corroborated?: boolean;
  /** An outer clipping scroller of this rect, scrolling vertically, the list nested in it (a carousel in a page). */
  within?: Rect;
}

/** The stop the round shows the check: the match at `rect` in a clipping list at `list`, judged `fully`. */
function stopAt(rect: Rect, shown: StopShown = {}): FlushStop {
  const { list = LIST, axis, after = [], budget = true, gesture = SCREEN_BOX, offered, corroborated, within } = shown;
  // `drawn: undefined` given is no stroke handed back; left out, the default swipe.
  const drawn = 'drawn' in shown ? shown.drawn : SWIPE;
  const row = node({ role: 'button', identifier: 'S', rect: { ...rect } });
  const scrollable = node({ role: 'scrollable', clipsDescendants: true, ...(axis !== undefined && { scrollAxis: axis }), rect: { ...list }, children: [row, ...after] });
  const outer = within === undefined ? scrollable : node({ role: 'scrollable', clipsDescendants: true, scrollAxis: 'vertical', rect: { ...within }, children: [scrollable] });
  const tree = node({ role: 'container', rect: SCREEN_BOX, children: [outer] });
  const judged = judgeRead({ tree, found: [row], ofKeyboard: () => false, remedy: { dismissal: 'none' } }, SCREEN, true);
  if ('ask' in judged || judged.best === undefined) throw new Error('no stop judged');
  return {
    judged: judged.best,
    facts: judged.facts,
    drawn,
    means: { screen: SCREEN_BOX, gesture, strokes: startStrokes(), cover: undefined, offered, corroborated, budget },
  };
}

/** `seen`'s verdict with what a test reads of it: a probe's way, reach and travel, its check left out. */
function said(seen: FlushSeen): unknown {
  const { verdict } = seen;
  if (verdict.of !== 'probe') return verdict;
  return { of: 'probe', toward: verdict.toward, reach: verdict.stroke.reach, maxTravel: verdict.stroke.maxTravel };
}

/** The check after `verdict`'s probe was sent (the round keeps the verdict's check). */
function sent(verdict: FlushVerdict): FlushCheck {
  if (verdict.of !== 'probe') throw new Error(`no probe: ${verdict.of}`);
  return verdict.check;
}

/** A row flush on `edge` of `list`, `shows` px of it along the edge's axis — the part of it the list shows. */
function flushOn(edge: Edge, shows: number, list: Rect = LIST): Rect {
  switch (edge) {
    case 'bottom':
      return { x: 128, y: list.y + list.height - shows, width: 825, height: shows };
    case 'top':
      return { x: 128, y: list.y, width: 825, height: shows };
    case 'right':
      return { x: list.x + list.width - shows, y: 1100, width: shows, height: 200 };
    case 'left':
      return { x: list.x, y: 1100, width: shows, height: 200 };
  }
}

/** The verdict on a stop flush on the bottom edge of `LIST` that a probe or reveal which held settled. */
const CHECKED = { of: 'flush', flush: { edge: 'bottom', container: LIST, checked: true } } as const;

/** The direction whose axis an edge lies on and that a probe toward it keeps (any along the axis: the probe goes toward the edge). */
const ALONG: Record<Edge, Direction> = { bottom: 'down', top: 'up', right: 'right', left: 'left' };

describe('the flush check', () => {
  it('a stop flush on no edge of its list, or no stop shown: nothing to say', () => {
    const seen = seeFlush(startFlush('down'), stopAt({ x: 128, y: 1200, width: 825, height: 100 }));
    expect(said(seen)).toEqual({ of: 'none' });
    expect(seen).toMatchObject({ settles: false, waits: true });
    expect(seeFlush(startFlush('down'), undefined)).toMatchObject({ settles: false, waits: true, verdict: { of: 'none' } });
  });

  it('a stop that fills its list along the scroll: unchecked `fills`, never probed', () => {
    expect(said(seeFlush(startFlush('down'), stopAt(LIST)))).toEqual({ of: 'flush', flush: { edges: ['top', 'bottom'], container: LIST, checked: false, why: 'fills' } });
  });

  it('a stop flush on one edge: the first probe toward it, a quarter stroke under the cap; then a probe in flight until a read that read', () => {
    const first = seeFlush(startFlush('down'), stopAt(flushOn('bottom', 22)));
    expect(said(first)).toEqual({ of: 'probe', toward: 'down', reach: 0.25, maxTravel: CAP });
    expect(probing(first.check)).toBe(false);
    const inFlight = sent(first.verdict);
    expect(probing(inFlight)).toBe(true);
    expect(probing(seeFlush(inFlight, undefined).check)).toBe(false);
  });

  it('a probe that came back with the match where it was: settled and checked — or, drawn too short to tell from a tap, unchecked `tap`', () => {
    const inFlight = sent(seeFlush(startFlush('down'), stopAt(flushOn('bottom', 22))).verdict);
    const held = seeFlush(inFlight, stopAt(flushOn('bottom', 22)));
    expect(held).toMatchObject({ settles: true, waits: true });
    expect(said(held)).toEqual(CHECKED);
    expect(said(seeFlush(inFlight, stopAt(flushOn('bottom', 22), { drawn: TAP })))).toEqual({ of: 'flush', flush: { edge: 'bottom', container: LIST, checked: false, why: 'tap' } });
  });

  // The proof on every edge: the probe moved the row, which lies flush on the same edge with 60 px more of it showing,
  // its uncut edge carried those 60 px. The reveal's travel: half the room from the uncut edge to the list's far side
  // (`roomPast`) — 413 px for a row showing 82 of a 495-px list — and, toward a top or left edge, the probe's cap kept.
  it.each([
    ['bottom', 206],
    ['top', CAP],
    ['right', Math.floor((1080 - 82) / 2)],
    ['left', CAP],
  ] as const)('the probe proved a cut at its %s edge: no wait, no confirm — the next stroke a reveal of travel %i', (edge, travel) => {
    const direction = ALONG[edge];
    const inFlight = sent(seeFlush(startFlush(direction), stopAt(flushOn(edge, 22))).verdict);
    const proved = seeFlush(inFlight, stopAt(flushOn(edge, 82)));
    expect(proved).toMatchObject({ settles: false, waits: false });
    expect(said(proved)).toEqual({ of: 'probe', toward: direction, reach: 1, maxTravel: travel });
  });

  it.each([
    ['moved, flush on the same edge with less of it showing', flushOn('bottom', 12), LIST, { of: 'probe', toward: 'down', reach: 0.25, maxTravel: CAP }],
    // The list grows 40 px at its bottom and the row's cut bounds with it; its top stays at 1519 — nothing scrolled.
    ['grown with its uncut edge where it was', { x: 128, y: 1519, width: 825, height: 62 }, { ...LIST, height: LIST.height + 40 }, { of: 'probe', toward: 'down', reach: 0.25, maxTravel: CAP }],
    ['no longer flush', { x: 128, y: 1300, width: 825, height: 176 }, LIST, { of: 'none' }],
  ])('a probe after which the match is %s proved nothing: it may wait, and no reveal is sent', (_, now, list, verdict) => {
    const inFlight = sent(seeFlush(startFlush('down'), stopAt(flushOn('bottom', 22))).verdict);
    const seen = seeFlush(inFlight, stopAt(now, { list }));
    expect(seen).toMatchObject({ settles: false, waits: true });
    expect(said(seen)).toEqual(verdict);
  });

  it('a proven cut is kept while the match lies flush on that edge of that list — reads that judge no stop leave it — and let go once it lies anywhere else', () => {
    const inFlight = sent(seeFlush(startFlush('down'), stopAt(flushOn('bottom', 22))).verdict);
    const proved = seeFlush(inFlight, stopAt(flushOn('bottom', 82))).check;
    // A read with no stop, then the row flush there again after a stroke that was no reveal: still proven, a reveal at once.
    const kept = seeFlush(seeFlush(proved, undefined).check, stopAt(flushOn('bottom', 120)));
    expect(kept).toMatchObject({ settles: false, waits: false });
    expect(said(kept)).toEqual({ of: 'probe', toward: 'down', reach: 1, maxTravel: Math.floor((1541 - 120 - 1046) / 2) });
    // Flush with another list (its container moved): let go — the read judged like any other, a quarter probe again.
    const moved = seeFlush(proved, stopAt(flushOn('bottom', 82, { ...LIST, y: 1000 }), { list: { ...LIST, y: 1000 } }));
    expect(moved).toMatchObject({ waits: true });
    expect(said(moved)).toMatchObject({ of: 'probe', reach: 0.25 });
    // Flush on another edge of that list: let go — a quarter probe toward that edge.
    const across = seeFlush(proved, stopAt(flushOn('top', 22)));
    expect(across).toMatchObject({ waits: true });
    expect(said(across)).toEqual({ of: 'probe', toward: 'up', reach: 0.25, maxTravel: CAP });
    // Off the edge: let go, and gone for the reads after it.
    const off = seeFlush(proved, stopAt({ x: 128, y: 1200, width: 825, height: 176 }));
    expect(off).toMatchObject({ waits: true, verdict: { of: 'none' } });
    expect(seeFlush(off.check, stopAt(flushOn('bottom', 82)))).toMatchObject({ waits: true });
  });

  it('a proven cut with no reveal to send: no stop, the read short of the cut (`FlushCut`) — where an unproven stop is only unchecked', () => {
    const inFlight = sent(seeFlush(startFlush('down'), stopAt(flushOn('bottom', 22))).verdict);
    const now = flushOn('bottom', 82);
    const spent = seeFlush(inFlight, stopAt(now, { budget: false }));
    expect(spent.verdict).toMatchObject({ of: 'cut', cut: { of: 'flushCut', edge: 'bottom', container: LIST, revealed: 60, why: 'budget', judged: { node: { rect: now } } } });
    expect(said(seeFlush(startFlush('down'), stopAt(now, { budget: false })))).toEqual({ of: 'flush', flush: { edge: 'bottom', container: LIST, checked: false, why: 'budget' } });
    // A reveal that moved nothing, drawn too short to tell from a tap: the cut, `tap`.
    const reveal = sent(seeFlush(seeFlush(inFlight, stopAt(now)).check, stopAt(now)).verdict);
    expect(seeFlush(reveal, stopAt(now, { drawn: TAP })).verdict).toMatchObject({ of: 'cut', cut: { why: 'tap', revealed: 60 } });
    // No room for a reveal (the gesture box off the list): the cut, `room` — where an unproven stop is only unchecked.
    const away: Rect = { x: 0, y: 100, width: 1080, height: 200 };
    expect(seeFlush(inFlight, stopAt(now, { gesture: away })).verdict).toMatchObject({ of: 'cut', cut: { why: 'room', revealed: 60 } });
    expect(said(seeFlush(startFlush('down'), stopAt(now, { gesture: away })))).toEqual({ of: 'flush', flush: { edge: 'bottom', container: LIST, checked: false, why: 'room' } });
  });

  it('a list that scrolls only across the edge: no probe — unchecked `axis`', () => {
    expect(said(seeFlush(startFlush('down'), stopAt(flushOn('bottom', 22), { axis: 'horizontal' })))).toEqual({
      of: 'flush',
      flush: { edge: 'bottom', container: LIST, checked: false, why: 'axis' },
    });
  });

  it('a stop flush under a node pinned at its list\'s top: the probe asks that edge, and the `Flush` names the node', () => {
    const header = node({ role: 'container', identifier: 'H', rect: { x: 0, y: 1046, width: 1080, height: 100 }, children: [node({ role: 'text', label: 'Section', rect: { x: 400, y: 1070, width: 281, height: 52 } })] });
    const row: Rect = { x: 128, y: 1146, width: 825, height: 110 };
    const first = seeFlush(startFlush('up'), stopAt(row, { after: [header] }));
    expect(said(first)).toEqual({ of: 'probe', toward: 'up', reach: 0.25, maxTravel: CAP });
    expect(said(seeFlush(sent(first.verdict), stopAt(row, { after: [header] })))).toEqual({
      of: 'flush',
      flush: { edge: 'top', container: LIST, pinned: expect.objectContaining({ identifier: 'H' }), checked: true },
    });
  });

  it('a keyboard the moot rule offered and never asked about: the witness first — then the probe over the screen, or above the keyboard it stood by', () => {
    // A keyboard whose line lies above the whole list: stood by, no probe has room above it.
    const offered: AppliedKeyboard = { topCover: { x: 0, y: 1000, width: 1080, height: 1220 }, above: undefined, remedy: { dismissal: 'none' }, line: { y: 1000, witnessed: true } };
    const at = flushOn('bottom', 22);
    expect(said(seeFlush(startFlush('down'), stopAt(at, { offered })))).toEqual({ of: 'witness' });
    expect(said(seeFlush(startFlush('down'), stopAt(at, { offered, corroborated: false })))).toEqual({ of: 'probe', toward: 'down', reach: 0.25, maxTravel: CAP });
    expect(said(seeFlush(startFlush('down'), stopAt(at, { offered, corroborated: true })))).toEqual({ of: 'flush', flush: { edge: 'bottom', container: LIST, checked: false, why: 'room' } });
  });

  it('a list with no room for a stroke: no probe — unchecked `room`', () => {
    const strip: Rect = { x: 0, y: 1046, width: 1080, height: 30 };
    expect(said(seeFlush(startFlush('down'), stopAt({ x: 128, y: 1046, width: 825, height: 20 }, { list: strip })))).toEqual({
      of: 'flush',
      flush: { edge: 'top', container: strip, checked: false, why: 'room' },
    });
  });
});

/**
 * D62: a reveal that moved nothing right after a stroke that CARRIED the match its whole drawn length (less twice the
 * slop) is doubted once — the same reveal sent again — and accepted only when that one holds too. A held reveal after
 * a stroke that ran short (the content ended under it) is accepted at once, as is every first probe that held.
 */
describe('the flush check doubts a reveal that held right after a stroke that carried the match its whole length (D62)', () => {
  /** A 74-px probe: the lab's bounded list's (tests/interact/scroll-flush-reveal.test.ts). Carried past 74 − 2·24 = 26 px. */
  const PROBE: Stroke = { from: { x: 540, y: 1480 }, to: { x: 540, y: 1406 } };
  /** The check with the cut proved by `PROBE`, which showed `grown` px more of a row showing 22 at the list's bottom. */
  function provedBy(grown: number, { drawn }: { drawn: Stroke | undefined } = { drawn: PROBE }): FlushSeen {
    const inFlight = sent(seeFlush(startFlush('down'), stopAt(flushOn('bottom', 22))).verdict);
    return seeFlush(inFlight, stopAt(flushOn('bottom', 22 + grown), { drawn }));
  }
  const reveal = (shows: number): unknown => ({ of: 'probe', toward: 'down', reach: 1, maxTravel: Math.floor((LIST.height - shows) / 2) });

  it('the carry rule\'s boundary: 26 px of a 74-px probe ran short — the held reveal is checked; 27 px carried — it is sent again, no wait', () => {
    // 26/27 px is how far the row GREW under the 74-px stroke: a loss of 48/47 px against CARRY_LOSS (48).
    const short = provedBy(26);
    expect(said(seeFlush(sent(short.verdict), stopAt(flushOn('bottom', 48))))).toEqual(CHECKED);
    const carried = provedBy(27);
    const doubted = seeFlush(sent(carried.verdict), stopAt(flushOn('bottom', 49)));
    expect(doubted).toMatchObject({ settles: true, waits: false });
    expect(said(doubted)).toEqual(reveal(49));
  });

  it('a proving read with no stroke handed back: not carried — the held reveal is checked, as before', () => {
    const proved = provedBy(60, { drawn: undefined });
    expect(said(seeFlush(sent(proved.verdict), stopAt(flushOn('bottom', 82))))).toEqual(CHECKED);
  });

  it('doubted once: the retry held again — checked; no swipe left for the retry — the cut (`FlushCut` budget)', () => {
    const doubted = seeFlush(sent(provedBy(60).verdict), stopAt(flushOn('bottom', 82)));
    expect(said(doubted)).toEqual(reveal(82));
    expect(said(seeFlush(sent(doubted.verdict), stopAt(flushOn('bottom', 82))))).toEqual(CHECKED);
    expect(seeFlush(sent(provedBy(60).verdict), stopAt(flushOn('bottom', 82), { budget: false })).verdict).toMatchObject({
      of: 'cut',
      cut: { of: 'flushCut', edge: 'bottom', container: LIST, revealed: 60, why: 'budget' },
    });
  });

  it('a retry that moved and grew it is a fresh proof: a reveal that holds after it, carried, is doubted again', () => {
    const doubted = seeFlush(sent(provedBy(60).verdict), stopAt(flushOn('bottom', 82)));
    // 100 px drawn, 68 px more of it showing: carried (68 > 52).
    const retry: Stroke = { from: { x: 540, y: 1480 }, to: { x: 540, y: 1380 } };
    const fresh = seeFlush(sent(doubted.verdict), stopAt(flushOn('bottom', 150), { drawn: retry }));
    expect(said(fresh)).toEqual(reveal(150));
    const again = seeFlush(sent(fresh.verdict), stopAt(flushOn('bottom', 150)));
    expect(said(again)).toEqual(reveal(150));
    expect(said(seeFlush(sent(again.verdict), stopAt(flushOn('bottom', 150))))).toEqual(CHECKED);
  });

  // ADR 0013 LV2 point 3's row cut by 40 px, which the 74-px probe brings whole at the list's end: 40 > 26, carried —
  // the legitimate case D62 pays for: one retry before `checked`.
  it('LV2\'s row cut by 40 px, revealed whole by the 74-px probe: carried — the held reveal is sent again, and checked when that one holds', () => {
    const doubted = seeFlush(sent(provedBy(40).verdict), stopAt(flushOn('bottom', 62)));
    expect(said(doubted)).toEqual(reveal(62));
    expect(said(seeFlush(sent(doubted.verdict), stopAt(flushOn('bottom', 62))))).toEqual(CHECKED);
  });

  it('a doubted reveal with a keyboard the moot rule offered and never asked about: the witness first, then the reveal — the read shown again with the check from before the witness doubts it again', () => {
    // A keyboard whose line lies across the list's lower band: stood by, the reveal is drawn above it.
    const offered: AppliedKeyboard = { topCover: { x: 0, y: 1400, width: 1080, height: 820 }, above: undefined, remedy: { dismissal: 'none' }, line: { y: 1400, witnessed: true } };
    const inFlight = sent(provedBy(60).verdict);
    const ask = seeFlush(inFlight, stopAt(flushOn('bottom', 82), { offered }));
    expect(said(ask)).toEqual({ of: 'witness' });
    const answered = seeFlush(inFlight, stopAt(flushOn('bottom', 82), { offered, corroborated: true }));
    expect(answered).toMatchObject({ settles: true, waits: false });
    expect(said(answered)).toEqual(reveal(82));
    // Clear of the keyboard it stood by: it touches down above the keyboard's line — over the list alone it would
    // touch down under it.
    expect(answered.verdict).toMatchObject({ of: 'probe', stroke: { coverTop: 1400, points: { from: { y: 1329 } } } });
    expect(seeFlush(inFlight, stopAt(flushOn('bottom', 82))).verdict).toMatchObject({ of: 'probe', stroke: { points: { from: { y: 1443 } } } });
    // That reveal held too: checked.
    expect(said(seeFlush(sent(answered.verdict), stopAt(flushOn('bottom', 82))))).toEqual(CHECKED);
  });

  it('a reveal drawn too short to tell from a tap after a carried proof: the cut (`tap`), not a retry', () => {
    expect(seeFlush(sent(provedBy(60).verdict), stopAt(flushOn('bottom', 82), { drawn: TAP })).verdict).toMatchObject({ of: 'cut', cut: { why: 'tap', revealed: 60 } });
  });

  it('a first probe that held is checked whatever came before it: no proof, nothing to doubt', () => {
    const inFlight = sent(seeFlush(startFlush('down'), stopAt(flushOn('bottom', 22))).verdict);
    expect(said(seeFlush(inFlight, stopAt(flushOn('bottom', 22), { drawn: PROBE })))).toEqual(CHECKED);
  });

  // batch-9 run 0 (carousel-recycler-free, the 440-px pre-drag, then `left fully: true`): C flush with its carousel's
  // right edge; the probe (batch-10's points at that geometry, 142 px) moved it 135 px and proved the cut; the reveal
  // (half the 372-px room) was never taken by the app, and the read after it — C where the reveal left from — passed.
  it('batch-9: the reveal the app never took after a probe that carried C 135 of 142 px is no pass — the reveal again, or the cut at the bound', () => {
    const CLIP: Rect = { x: 66, y: 380, width: 948, height: 234 };
    const carouselStop = (rect: Rect, drawn: Stroke | undefined, budget = true): FlushStop => stopAt(rect, { list: CLIP, within: SCREEN_BOX, drawn, budget });
    const probe: Stroke = { from: { x: 824, y: 497 }, to: { x: 682, y: 497 } };
    const untaken: Stroke = { from: { x: 824, y: 497 }, to: { x: 638, y: 497 } };
    const before: Rect = { x: 573, y: 380, width: 441, height: 234 };
    const after: Rect = { x: 438, y: 380, width: 576, height: 234 };
    const first = seeFlush(startFlush('left'), carouselStop(before, undefined));
    expect(first.verdict).toMatchObject({ of: 'probe', toward: 'right' });
    const proved = seeFlush(sent(first.verdict), carouselStop(after, probe));
    expect(proved.verdict).toMatchObject({ of: 'probe', toward: 'right' });
    const held = seeFlush(sent(proved.verdict), carouselStop(after, untaken));
    expect(held).toMatchObject({ waits: false, verdict: { of: 'probe', toward: 'right' } });
    expect(seeFlush(sent(proved.verdict), carouselStop(after, untaken, false)).verdict).toMatchObject({ of: 'cut', cut: { revealed: 135, why: 'budget', edge: 'right', container: CLIP } });
    expect(seeFlush(sent(held.verdict), carouselStop(after, untaken)).verdict).toEqual({ of: 'flush', flush: { edge: 'right', container: CLIP, checked: true } });
  });
});

// D68 (interact/aim-floor.ts): on a proven cut, the room left on the match's uncut side under what a stroke of this
// call no longer than the next reveal carried it over that cut — no reveal, the round stops (`aim`). The carousel of
// batch-10's recycler record: C flush with its right edge, the reveal's floor 48 px.
describe('the flush check stops a proven cut no swipe can bring whole (D68)', () => {
  const CLIP: Rect = { x: 66, y: 380, width: 948, height: 234 };
  /** Another carousel the card could lie flush in: wider, its right edge at 1040. */
  const WIDE: Rect = { x: 40, y: 380, width: 1000, height: 234 };
  const right = (x: number, list: Rect = CLIP): Rect => ({ x, y: 380, width: list.x + list.width - x, height: 234 });
  const left = (width: number): Rect => ({ x: 66, y: 380, width, height: 234 });
  const stroke = (px: number): Stroke => ({ from: { x: 824, y: 497 }, to: { x: 824 - px, y: 497 } });
  const shown = (rect: Rect, drawn: Stroke | undefined, more: StopShown = {}): FlushStop => stopAt(rect, { list: CLIP, within: SCREEN_BOX, drawn, ...more });
  /** The check after the first probe on C at `from` and a read after a `px`-px stroke left it at `to` (flush on CLIP's right). */
  const provedAt = (from: number, to: number, px: number): FlushSeen => seeFlush(sent(seeFlush(startFlush('left'), shown(right(from), undefined)).verdict), shown(right(to), stroke(px)));

  it('the probe proved the cut, a 48-px reveal carried C 20 px, 14 px are left: no reveal — the stop, its facts; budget left or not', () => {
    const proved = provedAt(200, 100, 142);
    expect(said(proved)).toEqual({ of: 'probe', toward: 'right', reach: 1, maxTravel: 17 });
    expect(proved.verdict).toMatchObject({ stroke: { points: { from: { x: 824 }, to: { x: 776 } } } });
    for (const budget of [true, false]) {
      const seen = seeFlush(sent(proved.verdict), shown(right(80), stroke(48), { budget }));
      expect(seen).toMatchObject({ settles: false, waits: false });
      expect(seen.verdict).toEqual({ of: 'aim', aim: { of: 'flushAim', judged: expect.objectContaining({ node: expect.objectContaining({ rect: right(80) }) }), edge: 'right', container: CLIP, revealed: 20, overshoot: { room: 14, drawn: 48, moved: 20 } } });
    }
  });

  it('the same read after a 100-px stroke (longer than the next, 48): no measured stroke as short — the reveal, or the cut at the bound, as before', () => {
    const proved = provedAt(200, 100, 142);
    expect(said(seeFlush(sent(proved.verdict), shown(right(80), stroke(100))))).toEqual({ of: 'probe', toward: 'right', reach: 1, maxTravel: 7 });
    expect(seeFlush(sent(proved.verdict), shown(right(80), stroke(100), { budget: false })).verdict).toMatchObject({ of: 'cut', cut: { why: 'budget', revealed: 20 } });
  });

  it('room enough for the least carry: 19 px left after a 48-px stroke carried 20 — the reveal, as before', () => {
    expect(said(seeFlush(sent(provedAt(200, 105, 142).verdict), shown(right(85), stroke(48))))).toEqual({ of: 'probe', toward: 'right', reach: 1, maxTravel: 9 });
  });

  it('a proving read with no stroke handed back measures nothing', () => {
    const proved = provedAt(200, 100, 142);
    expect(said(seeFlush(sent(proved.verdict), shown(right(80), undefined)))).toEqual({ of: 'probe', toward: 'right', reach: 1, maxTravel: 7 });
  });

  it('a stroke measured on another edge of the carousel says nothing of this one', () => {
    const onLeft = seeFlush(sent(seeFlush(startFlush('left'), shown(left(400), undefined)).verdict), shown(left(420), stroke(48)));
    expect(onLeft.verdict).toMatchObject({ of: 'probe', toward: 'left' });
    const onRight = seeFlush(sent(onLeft.verdict), shown(right(200), stroke(142)));
    const proved = seeFlush(sent(onRight.verdict), shown(right(80), stroke(142)));
    expect(proved.verdict).toMatchObject({ of: 'probe', toward: 'right' });
  });

  it('a stroke measured over another scroll container says nothing of this one', () => {
    const wide = (rect: Rect, drawn: Stroke | undefined): FlushStop => shown(rect, drawn, { list: WIDE });
    const onWide = seeFlush(sent(seeFlush(startFlush('left'), wide(right(400, WIDE), undefined)).verdict), wide(right(380, WIDE), stroke(48)));
    expect(onWide.verdict).toMatchObject({ of: 'probe', toward: 'right' });
    const onClip = seeFlush(sent(onWide.verdict), shown(right(200), stroke(142)));
    const proved = seeFlush(sent(onClip.verdict), shown(right(80), stroke(142)));
    expect(proved.verdict).toMatchObject({ of: 'probe', toward: 'right' });
  });

  it('every measured stroke of the call is kept, a read between that proved nothing included (a held reveal D62 doubts)', () => {
    // The probe carried C 140 px; a 48-px reveal 20 more (74 px left: sent on); the next reveal held — doubted, sent
    // again; that one (drawn 100) carried it 60, leaving 14: the 48-px stroke's 20 px decide.
    const proved = provedAt(300, 160, 142);
    const measured = seeFlush(sent(proved.verdict), shown(right(140), stroke(48)));
    expect(measured.verdict).toMatchObject({ of: 'probe' });
    const held = seeFlush(sent(measured.verdict), shown(right(140), stroke(48)));
    expect(held).toMatchObject({ settles: true, verdict: { of: 'probe' } });
    expect(seeFlush(sent(held.verdict), shown(right(80), stroke(100))).verdict).toMatchObject({ of: 'aim', aim: { overshoot: { room: 14, drawn: 48, moved: 20 } } });
  });

  it('judged on the reveal the plan would send above the keyboard: a keyboard line 64 px into the list leaves no room for it — the cut (`room`), not the stop; the line stood by only once the witness was asked; at the bound alike', () => {
    // The lab's bounded-list shape, bottom edge: a 74-px probe grew S 53 px, a 48-px reveal 27 more; 15 px left.
    const PROBE74: Stroke = { from: { x: 540, y: 1480 }, to: { x: 540, y: 1406 } };
    const R48: Stroke = { from: { x: 540, y: 1480 }, to: { x: 540, y: 1432 } };
    const offered: AppliedKeyboard = { topCover: { x: 0, y: 1110, width: 1080, height: 1110 }, above: undefined, remedy: { dismissal: 'none' }, line: { y: 1110, witnessed: true } };
    const proved = seeFlush(sent(seeFlush(startFlush('down'), stopAt(flushOn('bottom', 400))).verdict), stopAt(flushOn('bottom', 453), { drawn: PROBE74 }));
    const read = (more: StopShown) => seeFlush(sent(proved.verdict), stopAt(flushOn('bottom', 480), { drawn: R48, ...more })).verdict;
    expect(read({})).toMatchObject({ of: 'aim', aim: { overshoot: { room: 15, drawn: 48, moved: 27 } } });
    expect(read({ offered })).toEqual({ of: 'witness' });
    expect(read({ offered, corroborated: true })).toMatchObject({ of: 'cut', cut: { why: 'room', revealed: 27 } });
    expect(read({ offered, corroborated: false })).toMatchObject({ of: 'aim' });
    expect(read({ offered, corroborated: true, budget: false })).toMatchObject({ of: 'cut', cut: { why: 'budget', revealed: 27 } });
    expect(read({ offered, budget: false })).toMatchObject({ of: 'aim' });
    expect(read({ offered: { ...offered, line: { y: 1300, witnessed: true }, topCover: { x: 0, y: 1300, width: 1080, height: 920 } }, corroborated: true, budget: false })).toMatchObject({ of: 'aim' });
  });
});
