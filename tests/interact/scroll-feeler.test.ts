import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DeviceScreen, UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import type { RoundStep } from '../../src/interact/scroll-rounds.js';
import { parseDump } from '../helpers/android-dumps.js';
import { failureOf, play, type Played } from '../helpers/rounds.js';

// THE FEELER (ADR 0018, "idb's presented layer", its 2026-10-22 addition; open-bugs #9, residual 6): beneath the lab's
// large sheet idb lists the sheet's button alone, no sign of the sheet, so scroll_until for the host's A (content
// above: the finger dragged DOWN from (201,175)) stroked — and live the full stroke (201,175) → (201,699) in 300 ms
// DISMISSED the sheet. On idb's flat list, for a target never seen and before any stroke of the call moved the tree, a
// content-up stroke is sent short and slow: measured on the lab simulator, the large sheet springs back from a drag of
// up to 350 pt at 600–900 ms and of up to 300 pt in 300 ms, and is dismissed by 400 pt in 900 ms and 200 pt in 150 ms.

const TRUTH = new URL('../fixtures/truth/ios-iphone17-ios27/', import.meta.url);
const sheet = (): UiNode => parseIdbDescribeAll(readFileSync(new URL('sheet-background.idb.json', TRUTH), 'utf8'));
const IPHONE: DeviceScreen = { width: 402, height: 874, statusBand: 62 };
const UP = { direction: 'up', fully: false, maxSwipes: 5, timeoutMs: 30_000, screen: IPHONE } as const;
const DOWN = { ...UP, direction: 'down' } as const;

type StrokeStep = Extract<RoundStep, { do: 'stroke' }>;
const strokes = (played: Played): StrokeStep[] => played.steps.filter((s): s is StrokeStep => s.do === 'stroke');
const travel = (s: StrokeStep): number => Math.abs(s.points!.to.y - s.points!.from.y) + Math.abs(s.points!.to.x - s.points!.from.x);

/** An idb list of rows `row_<from>`…, the first at `top`: a list that moves when stroked. */
const rows = (from: number, top: number): UiNode =>
  parseIdbDescribeAll(
    JSON.stringify([
      { type: 'Application', AXLabel: 'App', AXUniqueId: null, frame: { x: 0, y: 0, width: 402, height: 874 } },
      ...Array.from({ length: 12 }, (_, i) => ({ type: 'Button', AXLabel: `Row ${from + i}`, AXUniqueId: `row_${from + i}`, frame: { x: 0, y: top + 64 * i, width: 402, height: 64 } })),
    ]),
  );

describe('scroll_until on idb, a content-up stroke for a target never seen: a feeler until a stroke has moved the tree', () => {
  it('beneath the large sheet, which springs back: two feelers from (201,175), 160 pt in 600 ms, then the unmoved stop', () => {
    const played = play(UP, [{ tree: sheet(), found: [] }, { tree: sheet(), found: [] }, { tree: sheet(), found: [] }]);
    const sent = strokes(played);
    expect(sent.map((s) => [s.kind, s.points?.from, travel(s), s.durationMs])).toEqual([
      ['feeler', { x: 201, y: 175 }, 160, 600],
      ['feeler', { x: 201, y: 175 }, 160, 600],
    ]);
    expect(played.outcome).toMatchObject({ kind: 'bound', by: { of: 'exhausted', unchanged: 'tree' } });
  });

  it('a list that moves on the feeler: the next stroke is a full one, paced as idb\'s full strokes are (D20)', () => {
    const played = play(UP, [{ tree: rows(20, 62) }, { tree: rows(20, 222) }, { tree: rows(20, 222) }, { tree: rows(20, 222) }]);
    const sent = strokes(played);
    expect(sent[0]).toMatchObject({ kind: 'feeler', durationMs: 600 });
    expect(travel(sent[0])).toBe(160);
    // 524 pt at 349 pt/s: 1501.4 ms, rounded up (D20).
    expect(sent.slice(1).map((s) => [s.kind, travel(s), s.durationMs])).toEqual([
      ['paced', 524, 1502],
      ['paced', 524, 1502],
    ]);
  });

  it('a target the call has seen is no feeler\'s: its strokes are full, paced on idb (D20)', () => {
    // A, listed above the screen (idb lists every node of the hierarchy, on the screen or not) and never moving.
    const tree = parseIdbDescribeAll(
      JSON.stringify([
        { type: 'Application', AXLabel: 'App', AXUniqueId: null, frame: { x: 0, y: 0, width: 402, height: 874 } },
        { type: 'Button', AXLabel: 'A', AXUniqueId: 'a', frame: { x: 0, y: -400, width: 402, height: 44 } },
      ]),
    );
    const seenA = { tree, found: tree.children.filter((n) => n.label === 'A') };
    const sent = strokes(play(UP, [seenA, seenA, seenA]));
    expect(sent.length).toBeGreaterThan(0);
    for (const s of sent) expect([s.kind, travel(s), s.durationMs]).toEqual(['paced', 524, 1502]);
  });

  it('a push-up (content below) is never a feeler: the finger moving up dismisses no sheet — full strokes, paced on idb (D20)', () => {
    const played = play(DOWN, [{ tree: sheet(), found: [] }, { tree: sheet(), found: [] }, { tree: sheet(), found: [] }]);
    const sent = strokes(played);
    expect(sent.map((s) => [s.kind, travel(s), s.durationMs])).toEqual([
      ['paced', 524, 1502],
      ['paced', 524, 1502],
    ]);
  });

  it('a tree that lists its scroll views (not idb\'s flat list) is never felt: full strokes', () => {
    const played = play(UP, [{ found: [], mainScroller: { x: 0, y: 100, width: 402, height: 700 } }, { found: [], mainScroller: { x: 0, y: 100, width: 402, height: 700 } }, { found: [], mainScroller: { x: 0, y: 100, width: 402, height: 700 } }]);
    expect(strokes(played).every((s) => s.kind === 'full' && s.durationMs === undefined)).toBe(true);
  });
});

// D20 (docs/plans/2026-10-30-performance-backlog.md): on idb a full stroke, 524 pt in 300 ms, flung the lab's 45-row
// picker sheet ~1 040 pt — past every row the read before it listed — and scroll_until stopped "the swipe CHANGED THE
// SCREEN" in all 5 D0 repeats; 524 pt in 1.5 s carried it ~570 pt and kept two rows. So a full stroke on idb's flat
// list is paced at 349 pt/s, never quicker than the 300 ms it had; a feeler keeps its own time, other trees none.
const picker = (): UiNode => parseIdbDescribeAll(readFileSync(new URL('form-picker.idb.json', TRUTH), 'utf8'));
const DOWN_TO_GB = { ...DOWN, target: 'id:lab.form-picker.country.GB' } as const;

describe('scroll_until on idb: a full stroke is paced, so a list does not fling past every row it listed (D20)', () => {
  it('on the form picker\'s sheet, scrolled down: the first stroke, 524 pt, is sent over 1502 ms', () => {
    const sent = strokes(play(DOWN_TO_GB, [{ tree: picker(), found: [] }, { tree: picker(), found: [] }, { tree: picker(), found: [] }]));
    expect(sent[0]).toMatchObject({ kind: 'paced', durationMs: 1502 });
    expect(travel(sent[0])).toBe(524);
  });

  it('a shorter full stroke takes proportionally less time, never under 300 ms', () => {
    // The same list on screens of half and of a sixth the height: half the stroke (262 pt) in half the time; 90 pt at
    // 349 pt/s would be 258 ms — sent over the 300 ms idb's full stroke had.
    const on = (height: number) => strokes(play({ ...DOWN_TO_GB, screen: { width: 402, height, statusBand: 20 } }, [{ tree: picker(), found: [] }, { tree: picker(), found: [] }, { tree: picker(), found: [] }]));
    expect(on(437).map((s) => [s.kind, travel(s), s.durationMs])).toEqual([
      ['paced', 262, 751],
      ['paced', 262, 751],
    ]);
    expect(on(150).map((s) => [s.kind, travel(s), s.durationMs])).toEqual([
      ['paced', 90, 300],
      ['paced', 90, 300],
    ]);
  });

  it('the same picker read by WDA: full strokes at the adapter\'s own speed, unchanged', () => {
    const wda = parseWdaSource(readFileSync(new URL('form-picker.wda.json', TRUTH), 'utf8'));
    const sent = strokes(play(DOWN_TO_GB, [{ tree: wda, found: [] }, { tree: wda, found: [] }, { tree: wda, found: [] }]));
    expect(sent.length).toBeGreaterThan(0);
    for (const s of sent) expect([s.kind, s.durationMs]).toEqual(['full', undefined]);
  });

  it('the picker on Android: full strokes, at the adapter\'s drag speed, unchanged', () => {
    const tree = parseDump(readFileSync(new URL('../fixtures/truth/android-averi_lab-api33/form-picker.xml', import.meta.url), 'utf8'));
    const ANDROID: DeviceScreen = { width: 1080, height: 2400, statusBand: 63 };
    const down = { ...DOWN_TO_GB, screen: ANDROID } as const;
    const sent = strokes(play(down, [{ tree, found: [] }, { tree, found: [] }, { tree, found: [] }]));
    expect(sent.length).toBeGreaterThan(0);
    for (const s of sent) expect([s.kind, s.durationMs]).toEqual(['full', undefined]);
  });
});

describe('the unmoved stop for a target never seen under idb says what idb does not list', () => {
  it('beneath the large sheet: "did not change the screen" names a presented sheet, alert or cover idb would not list — close it first if one is up', () => {
    const played = play(UP, [{ tree: sheet(), found: [] }, { tree: sheet(), found: [] }, { tree: sheet(), found: [] }]);
    expect(failureOf(played, 'label:"A"').message).toBe(
      'scroll_until label:"A" failed after 2 swipes (the last 2, swiping up, did not change the screen: content exhausted, still loading, or the swipes were not taken — ' +
        'idb lists only what a presented sheet, alert or cover leaves to accessibility: if the element lies beneath one, close it first) — element never appeared in the tree',
    );
  });

  it('by an id alone: the miss\'s note says what idb does not list, and the stop says it no second time', () => {
    const message = failureOf(play({ ...UP, target: 'id:A' }, [{ tree: sheet(), found: [] }, { tree: sheet(), found: [] }, { tree: sheet(), found: [] }]), 'id:A').message;
    expect(message).toContain('content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree (no tree read contained id:"A"');
    expect(message).not.toContain('idb lists only');
    expect(message).not.toContain('close it first');
    expect(message.split('close that first')).toHaveLength(2);
  });

  it('not once a stroke has moved the tree: the list ran to its end, the cause as before', () => {
    const played = play(UP, [{ tree: rows(20, 62) }, { tree: rows(20, 222) }, { tree: rows(20, 222) }, { tree: rows(20, 222) }]);
    expect(failureOf(played, 'label:"Z"').message).not.toContain('idb lists only');
  });

  it('not on a tree that lists its scroll views', () => {
    const played = play(UP, [{ found: [], mainScroller: { x: 0, y: 100, width: 402, height: 700 } }, { found: [], mainScroller: { x: 0, y: 100, width: 402, height: 700 } }, { found: [], mainScroller: { x: 0, y: 100, width: 402, height: 700 } }]);
    expect(failureOf(played, 'label:"Z"').message).not.toContain('idb lists only');
  });
});
