import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type Stroke, type UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { heldBack, lastDrawn, overRegion, regionOf, seeMotion, startLedger, treeMoved, unseenStrokes, type LedgerRead, type MotionLedger, type Moved } from '../../src/interact/motion-ledger.js';
import type { Since } from '../../src/interact/scroll-read.js';
import type { Direction } from '../../src/interact/swipe.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { node } from '../helpers/fake.js';

/**
 * THE MOTION LEDGER through its interface (interact/motion-ledger.ts): a series of reads, as measured, in; what each
 * says about motion out. One row a round: the stroke the driver handed back (`drawn`) and, when the tree read, what it
 * read — every match's rect, which of them was judged and under what name, the tree's fingerprint. What the round
 * makes of the answers (stuck, exhausted, the end proof, the settle confirm) is its own, tested in its play tables.
 */

const PHONE: Rect = { x: 0, y: 0, width: 402, height: 874 };

/** One round as the table gives it: `drawn` and, unless `unread`, a read after `since` of matches at `at`, the `judged`-th judged under `name`. */
interface Row {
  readonly drawn?: Stroke;
  readonly unread?: true;
  readonly since?: Since;
  readonly at?: readonly Rect[];
  readonly judged?: number | null;
  readonly name?: string;
  readonly fingerprint?: string;
  readonly loading?: boolean;
  readonly blank?: LedgerRead['blank'];
  readonly carryToward?: Direction;
}

/** A read's facts for `row`: its matches as buttons on a phone screen (a tree that lists them in no scroll view), its fingerprint as given. */
function readOf(row: Row): LedgerRead {
  const at = row.at ?? [];
  const index = row.judged === null ? undefined : (row.judged ?? (at.length > 0 ? 0 : undefined));
  const found = at.map((rect, i) => node({ role: 'button', label: i === index ? (row.name ?? 'F') : `match ${i}`, rect: { ...rect } }));
  const tree = node({ role: 'container', rect: PHONE, children: found });
  return {
    since: row.since ?? 'stroke',
    found,
    judged: index === undefined ? undefined : found[index],
    facts: { tree, scene: sceneOf(tree), fingerprint: row.fingerprint ?? 'screen', loading: row.loading ?? false },
    ...(row.blank !== undefined && { blank: row.blank }),
    ...(row.carryToward !== undefined && { carryToward: row.carryToward }),
  };
}

/** The ledger after `rows`, and each round's answer (undefined for a round whose tree did not read). */
function play(rows: readonly Row[]): { ledger: MotionLedger; moved: (Moved | undefined)[] } {
  let ledger = startLedger();
  const moved: (Moved | undefined)[] = [];
  for (const row of rows) {
    const seen = seeMotion(ledger, { drawn: row.drawn, ...(row.unread === undefined && { read: readOf(row) }) });
    ledger = seen.ledger;
    moved.push(seen.moved);
  }
  return { ledger, moved };
}

const at = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
/** The content-up stroke over `lower` (the lab app's `scroll-bounded`, WDA), and another. */
const UP: Stroke = { from: { x: 201, y: 416 }, to: { x: 201, y: 524 } };
const OTHER: Stroke = { from: { x: 201, y: 430 }, to: { x: 201, y: 524 } };

describe('unmoved, and the identical-stroke streaks', () => {
  // ADR 0021 d2, measured live (round 6's iOS check, round 7's trace): F at 51,1380 300x64 before the stroke up, then
  // 51,1381 300x64 or 51,1380 300x65 after each — WDA rounds a frame's origin and size each on its own.
  it('within a point: WDA\'s one-point rounding is no motion — every match, the judged one and the tree unmoved, the streaks counting the same stroke on', () => {
    const { moved } = play([
      { since: 'start', at: [at(51, 1380, 300, 64)] },
      { drawn: UP, at: [at(51, 1381, 300, 64)] },
      { drawn: UP, at: [at(51, 1380, 300, 65)] },
    ]);
    expect(moved[0]?.unmoved).toEqual({ judged: false, all: false, tree: false });
    expect(moved[1]).toMatchObject({ unmoved: { judged: true, all: true, tree: true }, streaks: { judged: 1, all: 1, tree: 1 } });
    expect(moved[2]).toMatchObject({ unmoved: { judged: true, all: true, tree: true }, streaks: { judged: 2, all: 2, tree: 2 } });
  });

  it('two points is motion: the streaks end', () => {
    const { moved } = play([{ since: 'start', at: [at(51, 1380, 300, 64)] }, { drawn: UP, at: [at(51, 1380, 300, 64)] }, { drawn: UP, at: [at(51, 1382, 300, 64)], fingerprint: 'moved' }]);
    expect(moved[1]?.streaks).toEqual({ judged: 1, all: 1, tree: 1 });
    expect(moved[2]).toMatchObject({ unmoved: { judged: false, all: false, tree: false }, streaks: { judged: 0, all: 0, tree: 0 } });
  });

  it('one rule for the three streaks: unmoved after ANOTHER stroke starts again at one; a settle read counts nothing and keeps them', () => {
    const { moved } = play([
      { since: 'start', at: [at(51, 1380, 300, 64)] },
      { drawn: UP, at: [at(51, 1380, 300, 64)] },
      { drawn: OTHER, at: [at(51, 1380, 300, 64)] },
      { since: 'settle', at: [at(51, 1380, 300, 64)] },
      { drawn: OTHER, at: [at(51, 1380, 300, 64)] },
    ]);
    expect(moved.map((m) => m?.streaks.all)).toEqual([0, 1, 1, 1, 2]);
    expect(moved.map((m) => m?.streaks.judged)).toEqual([0, 1, 1, 1, 2]);
    expect(moved.map((m) => m?.streaks.tree)).toEqual([0, 1, 1, 1, 2]);
    // A settle read says the judged match held still; every match and the tree are asked only after a stroke.
    expect(moved[3]?.unmoved).toEqual({ judged: true, all: false, tree: false });
  });

  it('every match, not the judged one: a static duplicate judged first (another page\'s copy at -500) holds still while the real match moves — the judged match unmoved, every match not', () => {
    const { moved } = play([
      { since: 'start', at: [at(51, -500, 300, 64), at(51, 1380, 300, 64)] },
      { drawn: UP, at: [at(51, -500, 300, 64), at(51, 1100, 300, 64)] },
    ]);
    expect(moved[1]?.unmoved).toMatchObject({ judged: true, all: false });
    expect(moved[1]?.streaks).toMatchObject({ judged: 1, all: 0 });
  });

  it('no matches, read after read, is no evidence that every match held still: empty sets say nothing', () => {
    const { moved } = play([{ since: 'start' }, { drawn: UP }, { drawn: UP }]);
    expect(moved.map((m) => m?.unmoved.all)).toEqual([false, false, false]);
    expect(moved.map((m) => m?.streaks.all)).toEqual([0, 0, 0]);
  });

  it('the tree: a progress node showing is no unmoved read; a fingerprint that changed says the content moved, for the rest of the run', () => {
    const { ledger, moved } = play([
      { since: 'start', fingerprint: 'a' },
      { drawn: UP, fingerprint: 'a', loading: true },
      { drawn: UP, fingerprint: 'b' },
      { drawn: UP, fingerprint: 'b' },
    ]);
    expect(moved.map((m) => m?.unmoved.tree)).toEqual([false, false, false, true]);
    expect(treeMoved(ledger)).toBe(true);
    expect(treeMoved(play([{ since: 'start', fingerprint: 'a' }, { drawn: UP, fingerprint: 'a' }]).ledger)).toBe(false);
  });
});

// Lab note LV1 (Android, scroll-bounded's `lower` moving through blank content): a read after a stroke that lists none of
// the stroked scroll view's content says nothing of the tree, and counts a blank stroke.
describe('the blank strokes (UnseenStrokes)', () => {
  const LOWER: Rect = { x: 0, y: 550, width: 1080, height: 1670 };
  const blank = (within: Rect = LOWER, toward: Direction = 'down') => ({ within, toward });

  it('counted on over one scroll view, one way; the tree never unmoved while they last, the same fingerprint or not', () => {
    const { ledger, moved } = play([{ since: 'start' }, { drawn: UP, blank: blank() }, { drawn: UP, blank: blank() }, { drawn: UP, blank: blank() }]);
    expect(unseenStrokes(ledger)).toEqual({ strokes: 3, within: LOWER, toward: 'down' });
    expect(moved.map((m) => m?.unmoved.tree)).toEqual([false, false, false, false]);
    expect(moved.map((m) => m?.streaks.tree)).toEqual([0, 0, 0, 0]);
  });

  it('a point off is the same scroll view; another scroll view, or the other way, starts again; a read that is not blank ends them', () => {
    const off: Rect = { ...LOWER, y: LOWER.y + 1 };
    expect(unseenStrokes(play([{ since: 'start' }, { drawn: UP, blank: blank() }, { drawn: UP, blank: blank(off) }]).ledger)?.strokes).toBe(2);
    expect(unseenStrokes(play([{ since: 'start' }, { drawn: UP, blank: blank() }, { drawn: UP, blank: blank({ ...LOWER, y: 0 }) }]).ledger)).toEqual({ strokes: 1, within: { ...LOWER, y: 0 }, toward: 'down' });
    expect(unseenStrokes(play([{ since: 'start' }, { drawn: UP, blank: blank() }, { drawn: UP, blank: blank(LOWER, 'up') }]).ledger)?.strokes).toBe(1);
    expect(unseenStrokes(play([{ since: 'start' }, { drawn: UP, blank: blank() }, { drawn: UP }]).ledger)).toBeUndefined();
    // A settle read keeps the count: only a read after a stroke is a stroke's.
    expect(unseenStrokes(play([{ since: 'start' }, { drawn: UP, blank: blank() }, { since: 'settle' }]).ledger)?.strokes).toBe(1);
  });
});

// The lab app's `carousel-in-list` under WDA (docs/bugs/2026-10-18-lab-ios-wda-carousel-stop-claimed-while-the-fling-carries-the-card-past-its-centre.md):
// one 212-pt stroke flung the carousel, and the reads after it, 0.47 s apart, found C at x 7, −47, −68, −76, −76.
describe('slowing: a fling read for read', () => {
  const C = (x: number): Rect => at(x, 138, 354, 85);
  const FLING: Stroke = { from: { x: 307, y: 181 }, to: { x: 95, y: 181 } };

  it('measured: C moving 54, 21, 8, 0 pt over the confirming reads — slowing from the second on; the read after the stroke measures the stroke, and gives the next nothing', () => {
    const { moved } = play([{ since: 'start', at: [C(378)] }, { drawn: FLING, at: [C(7)] }, { since: 'settle', at: [C(-47)] }, { since: 'settle', at: [C(-68)] }, { since: 'settle', at: [C(-76)] }, { since: 'settle', at: [C(-76)] }]);
    expect(moved.map((m) => m?.slowing)).toEqual([false, false, false, true, true, true]);
  });

  it('a stroke between gives the settle after it nothing to compare with: moving 30, then 10, then a stroke, then 5 — not slowing against the fling before', () => {
    const { moved } = play([{ since: 'start', at: [C(378)] }, { since: 'settle', at: [C(348)] }, { since: 'settle', at: [C(338)] }, { drawn: FLING, at: [C(100)] }, { since: 'settle', at: [C(95)] }]);
    expect(moved.map((m) => m?.slowing)).toEqual([false, false, true, false, false]);
  });

  it('an animation moving 10 pt every read is not slowing; nor a judged match that is another node than the read before\'s', () => {
    expect(play([{ since: 'start', at: [C(100)] }, { since: 'settle', at: [C(90)] }, { since: 'settle', at: [C(80)] }, { since: 'settle', at: [C(70)] }]).moved.map((m) => m?.slowing)).toEqual([false, false, false, false]);
    const renamed = play([{ since: 'start', at: [C(7)] }, { since: 'settle', at: [C(-47)] }, { since: 'settle', at: [C(-68)], name: 'C (selected)' }]);
    expect(renamed.moved.map((m) => m?.slowing)).toEqual([false, false, false]);
  });
});

// Lab note LV5 (docs/bugs/2026-10-17-lab-ios-wda-scroll-until-overshoots-a-row-of-a-short-scroll-view-and-spends-its-budget.md):
// one stroke over the lab app's 180-pt `lower` (a 108-pt drag, 201 524 → 416) moved it about 259 pt.
describe('the carry sample', () => {
  const DRAG: Stroke = { from: { x: 201, y: 524 }, to: { x: 201, y: 416 } };
  const before: Row = { since: 'start', at: [at(51, 900, 300, 64)] };

  it('measured: F carried 259 pt up by the 108-pt drag — the sample is that, with the stroke as drawn, where the round allows one', () => {
    expect(play([before, { drawn: DRAG, at: [at(51, 641, 300, 64)], carryToward: 'down' }]).moved[1]?.carry).toEqual({ moved: 259, drawn: DRAG });
    // Carried the other way: the sample says so (negative); the carry model drops it (stroke-plan.ts#carried).
    expect(play([before, { drawn: DRAG, at: [at(51, 1000, 300, 64)], carryToward: 'down' }]).moved[1]?.carry?.moved).toBe(-100);
  });

  it('none where the round allows none (the probe, a tree that does not list the target where it lies), after a settle, of another node, or of one that changed size (a header collapsing) — a point of size is rounding', () => {
    expect(play([before, { drawn: DRAG, at: [at(51, 641, 300, 64)] }]).moved[1]?.carry).toBeUndefined();
    expect(play([before, { since: 'settle', at: [at(51, 641, 300, 64)], carryToward: 'down' }]).moved[1]?.carry).toBeUndefined();
    expect(play([before, { drawn: DRAG, at: [at(51, 641, 300, 64)], carryToward: 'down', name: 'G' }]).moved[1]?.carry).toBeUndefined();
    expect(play([before, { drawn: DRAG, at: [at(51, 641, 300, 40)], carryToward: 'down' }]).moved[1]?.carry).toBeUndefined();
    expect(play([before, { drawn: DRAG, at: [at(51, 641, 300, 65)], carryToward: 'down' }]).moved[1]?.carry?.moved).toBe(259);
  });

  it('measured against the last read that judged a match: a read between with none keeps it', () => {
    const { moved } = play([before, { drawn: DRAG, at: [] }, { drawn: DRAG, at: [at(51, 641, 300, 64)], carryToward: 'down' }]);
    expect(moved[2]?.carry?.moved).toBe(259);
  });
});

// Lab note LV3 under idb (docs/bugs/2026-10-16-lab-ios-scroll-until-turn-back-stroke-touches-down-above-the-list-and-moves-nothing.md):
// tabbar-floating's capture, T, R and F shifted as the live run measured the list carried: 1108 pt, then back to 607.
describe('the region the motion showed, and the last stroke drawn', () => {
  const ROWS = new Set(['lab.tabbar-floating.T', 'lab.tabbar-floating.R', 'lab.tabbar-floating.F']);
  const load = async (): Promise<UiNode> => parseIdbDescribeAll(await readFile(new URL('../fixtures/truth/ios-iphone17-ios27/tabbar-floating.idb.json', import.meta.url), 'utf8'));
  const shifted = (n: UiNode, dy: number): UiNode => ({ ...n, ...(ROWS.has(n.identifier ?? '') && { rect: { ...n.rect, y: n.rect.y - dy } }), children: n.children.map((c) => shifted(c, dy)) });
  const idbRead = (tree: UiNode): LedgerRead => {
    const r = [...everyNode(tree)].find((n) => n.identifier === 'lab.tabbar-floating.R');
    return { since: 'settle', found: r === undefined ? [] : [r], judged: r, facts: { tree, scene: sceneOf(tree), fingerprint: '', loading: false }, gesture: PHONE };
  };
  const SHOWN: Rect = { x: 24, y: 300, width: 354, height: 455 };
  /** The turned stroke over SHOWN, pushing the content toward the bottom. */
  const TURNED: Stroke = { from: { x: 201, y: 391 }, to: { x: 201, y: 528 } };
  const rAt = (y: number): Rect => ({ x: 24, y, width: 354, height: 52 });

  it('the band on the side the last stroke drawn pushed the content toward holds through a round that did not read: the stroke is the last drawn until the next', async () => {
    const tree = await load();
    let ledger = [tree, shifted(tree, 1108), shifted(tree, 607)].reduce((l, t) => seeMotion(l, { drawn: undefined, read: idbRead(t) }).ledger, startLedger());
    expect(regionOf(ledger)).toMatchObject({ rect: SHOWN, way: 'top' });
    expect(heldBack(ledger, rAt(650), 'stop')).toBeUndefined();
    ledger = seeMotion(ledger, { drawn: TURNED }).ledger;
    expect(lastDrawn(ledger)).toEqual(TURNED);
    // A round that did not read, then a confirming read: the stroke drawn before both still bands the bottom.
    ledger = seeMotion(ledger, { drawn: undefined }).ledger;
    ledger = seeMotion(ledger, { drawn: undefined, read: idbRead(shifted(tree, 607)) }).ledger;
    expect(lastDrawn(ledger)).toEqual(TURNED);
    expect(heldBack(ledger, rAt(650), 'stop')).toMatchObject({ by: 'band', edge: 'bottom', line: 665 });
  });

  it('strokes over the region carry content back the other way from how it was first seen moving; with no region every stroke keeps the plan\'s scroll views', async () => {
    const tree = await load();
    const ledger = [tree, shifted(tree, 1108)].reduce((l, t) => seeMotion(l, { drawn: undefined, read: idbRead(t) }).ledger, startLedger());
    expect(overRegion(ledger, 'up')).toBe(true);
    expect(overRegion(ledger, 'down')).toBe(false);
    expect(overRegion(startLedger(), 'down')).toBe(true);
  });

  it('a read that finds the target where its tree tells its scroll views drops the region; one that finds no target keeps it', async () => {
    const tree = await load();
    const ledger = [tree, shifted(tree, 1108)].reduce((l, t) => seeMotion(l, { drawn: undefined, read: idbRead(t) }).ledger, startLedger());
    const none = seeMotion(ledger, { drawn: undefined, read: { ...idbRead(tree), found: [], judged: undefined } }).ledger;
    expect(regionOf(none)).toMatchObject({ rect: SHOWN });
    // The same R inside a list a tree tells (WDA's dialect: a scroll view listing its content past its frame).
    const r = [...everyNode(tree)].find((n) => n.identifier === 'lab.tabbar-floating.R')!;
    const list = node({ role: 'scrollable', rect: at(0, 200, 402, 640), children: [r] });
    const told = node({ role: 'container', rect: PHONE, children: [list] });
    const dropped = seeMotion(ledger, { drawn: undefined, read: { ...idbRead(told), facts: { tree: told, scene: sceneOf(told), fingerprint: '', loading: false } } }).ledger;
    expect(regionOf(dropped)).toBeUndefined();
  });
});
