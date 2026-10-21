import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { everyNode, type Point, type Rect, type Stroke, type UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { heldBack, overRegion, regionOf, seeMotion, startLedger, type MotionLedger } from '../../src/interact/motion-ledger.js';
import { planStroke, seeRead, startStrokes, type StrokeMemory } from '../../src/interact/stroke-plan.js';
import type { Direction } from '../../src/interact/swipe.js';
import { containsPoint, largestScroller, rectIntersection } from '../../src/ui-tree/geometry.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { node } from '../helpers/fake.js';

/**
 * THE REGION THE MOTION SHOWED, end to end over measured idb captures: the motion ledger sees each read and keeps the
 * region its carried rows were seen moving in, and the holds it puts on a stop there (interact/motion-ledger.ts
 * #regionOf, #heldBack, its geometry interact/motion-shown.ts); the stroke plan, told the region, strokes over it
 * (interact/stroke-plan.ts#planStroke, `screenBox` when the stroke's way is not over it — the round's ask,
 * scroll-rounds.ts#round). Moved here from tests/interact/stroke-plan.test.ts when the region became the ledger's
 * (round 15, the motion ledger): the cases are the ledger's and the plan's together, as one feature (lab note LV3).
 */

/** The iPhone 17's screen, the gesture box of the captures below. */
const PHONE: Rect = { x: 0, y: 0, width: 402, height: 874 };
/** A tree's facts as the round derives them (scroll-read.ts#TreeFacts): its scene and its largest scroller. */
const factsOf = (tree: UiNode) => ({ tree, scene: sceneOf(tree), mainScroller: largestScroller(tree) });
/** A WDA tree of `children` on the phone's screen. */
const wdaScreen = (children: UiNode[]): UiNode => node({ role: 'container', unclippedFrames: true, rect: { ...PHONE }, children });
/** Is `p` inside `r`, its edges included as the driver's points are whole units. */
const on = (r: Rect, p: Point | undefined): boolean => p !== undefined && containsPoint(r, p);

// Lab note LV3 under idb (docs/bugs/2026-10-16-lab-ios-scroll-until-turn-back-stroke-touches-down-above-the-list-and-moves-nothing.md):
// idb's flat list lists no scroll view, so the target's is untold — the capture of `tabbar-floating` (402x874; its
// `list` 0,200 402x640 under the 200-pt header, state.json), T, R and F shifted as the live run measured the list
// carried by the first stroke: 1108 pt.
describe('the region the motion showed — a target whose tree tells no scroll view (idb), stroked over where its carried rows were seen moving', () => {
  const ROWS = new Set(['lab.tabbar-floating.T', 'lab.tabbar-floating.R', 'lab.tabbar-floating.F']);
  /** The list as state.json measured it: what a stroke must touch down in to move it. */
  const IDB_LIST: Rect = { x: 0, y: 200, width: 402, height: 640 };
  const load = async (file: string): Promise<string> => readFile(new URL(`../fixtures/truth/ios-iphone17-ios27/${file}`, import.meta.url), 'utf8');
  /** `tree` with every node `moves` picks shifted up by `dy` (the content scrolled `dy` toward its end). */
  const shifted = (n: UiNode, dy: number, moves: (n: UiNode) => boolean = (x) => ROWS.has(x.identifier ?? '')): UiNode => ({
    ...n,
    ...(moves(n) && { rect: { ...n.rect, y: n.rect.y - dy } }),
    children: n.children.map((c) => shifted(c, dy, moves)),
  });
  const r = (tree: UiNode): UiNode | undefined => [...everyNode(tree)].find((n) => n.identifier === 'lab.tabbar-floating.R');
  /** The round's motion ledger and stroke memory after the reads of `trees`, in order, each with its R as the target and `shows` the gesture box: the ledger sees each read first, and tells the plan its region (scroll-rounds.ts#round). */
  interface Seen {
    readonly ledger: MotionLedger;
    readonly memory: StrokeMemory;
  }
  const seen = (trees: UiNode[], shows: Rect, target = r): Seen =>
    trees.reduce<Seen>(
      ({ ledger, memory }, tree) => {
        const t = target(tree);
        const next = seeMotion(ledger, { drawn: undefined, read: { since: 'start', found: t === undefined ? [] : [t], judged: t, facts: { ...factsOf(tree), fingerprint: '', loading: false }, gesture: shows } }).ledger;
        const region = regionOf(next);
        return { ledger: next, memory: seeRead(memory, { facts: factsOf(tree), line: undefined, target: t, ...(region !== undefined && { region }) }) };
      },
      { ledger: startLedger(), memory: startStrokes() },
    );
  /** The region the reads in `s` showed (motion-ledger.ts#regionOf). */
  const regionAfter = (s: Seen) => regionOf(s.ledger);
  /** Whether the region the reads in `s` showed holds back a stop on `target`, as the round asks the ledger (motion-ledger.ts#heldBack) — after `drawn`, the last stroke drawn before the read, shown to the ledger as the round shows it. */
  const heldBackAfter = (s: Seen, target: Rect, of: 'stop' | 'fully', drawn?: Stroke) => heldBack(drawn === undefined ? s.ledger : seeMotion(s.ledger, { drawn }).ledger, target, of);
  /** R at `y`. */
  const rAt = (y: number): Rect => ({ x: 24, y, width: 354, height: 52 });
  /** The turned stroke over SHOWN (finger down: it pushes the content toward the bottom), and the first, flinging stroke over the screen (it pushes it toward the top). */
  const TURNED: Stroke = { from: { x: 201, y: 391 }, to: { x: 201, y: 528 } };
  const FLUNG: Stroke = { from: { x: 201, y: 699 }, to: { x: 201, y: 175 } };
  /** The plan after the reads of `trees`, for a stroke `toward` at `reach`, this round's read the last; `shows` what of the screen shows the app (the phone, or below its status band). */
  const planAfter = (trees: UiNode[], toward: Direction, reach: number, shows: Rect = PHONE, target = r) => {
    const last = trees.at(-1)!;
    const { ledger, memory } = seen(trees, shows, target);
    return planStroke(memory, { toward, reach, gesture: PHONE, read: { facts: factsOf(last), target: target(last) }, ...(!overRegion(ledger, toward) && { screenBox: true }) }).stroke;
  };
  /** The rows carried with R at the first read, on the screen: T 24,300 and R 24,721 (F lies at 2200, below it) — cut above the tab bar's buttons (y 755), which held still. */
  const SHOWN: Rect = { x: 24, y: 300, width: 354, height: 455 };

  it('measured: R flung past the top — the turned stroke goes over where T and R were seen moving and touches down inside the list (201,391), not in the header (201,175)', async () => {
    const at = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const stroke = planAfter([at, shifted(at, 1108)], 'up', 0.5);
    expect(stroke.box).toEqual(SHOWN);
    expect(stroke.points).toEqual({ from: { x: 201, y: 391 }, to: { x: 201, y: 528 } });
    expect(on(IDB_LIST, stroke.points?.from)).toBe(true);
  });

  it('one read — nothing seen moving yet: the screen box, the first stroke as today (201,699 → 201,175); two reads of R unmoved: the screen box too', async () => {
    const at = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const first = planAfter([at], 'down', 1);
    expect(first.box).toEqual(PHONE);
    expect(first.points).toEqual({ from: { x: 201, y: 699 }, to: { x: 201, y: 175 } });
    expect(planAfter([at, at], 'up', 0.5).box).toEqual(PHONE);
  });

  it('only what moved WITH the target, by its delta: the header and a tab moved by +10 (an animation) are left out', async () => {
    const at = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const animated = (n: UiNode): boolean => n.label === 'Header' || n.identifier === 'lab.tabbar-floating.tab.home';
    const next = shifted(shifted(at, 1108), -10, animated);
    expect(planAfter([at, next], 'up', 0.5).box).toEqual(SHOWN);
  });

  it('a read taken mid-fling lists the carried rows a few points apart (idb reads node by node — measured, T 8 pt off R\'s 895): still carried; the header animating 10 pt against R\'s 1108 is not', async () => {
    const at = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const lagging = shifted(shifted(at, 1108, (n) => ROWS.has(n.identifier ?? '') && !n.identifier!.endsWith('.T')), 1100, (n) => n.identifier === 'lab.tabbar-floating.T');
    expect(planAfter([at, lagging], 'up', 0.5).box).toEqual(SHOWN);
  });

  it('one node per identity: two rows labelled alike, carried with R, are left out; R renamed between the reads is no sample — the screen box', async () => {
    const at = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const twin = (y: number): UiNode => node({ role: 'button', label: 'Row', rect: { x: 0, y, width: 402, height: 40 } });
    const withTwins = { ...at, children: [...at.children, twin(220), twin(240)] };
    const twins = (n: UiNode): boolean => ROWS.has(n.identifier ?? '') || n.label === 'Row';
    expect(planAfter([withTwins, shifted(withTwins, 1108, twins)], 'up', 0.5).box).toEqual(SHOWN);
    // A row carried with the list (an id of its own), so that the rows alone would leave room for a stroke.
    const withRow = { ...at, children: [...at.children, node({ role: 'button', identifier: 'lab.tabbar-floating.S', rect: { x: 24, y: 400, width: 354, height: 52 } })] };
    const rows = (n: UiNode): boolean => ROWS.has(n.identifier ?? '') || n.identifier === 'lab.tabbar-floating.S';
    const renamed = (n: UiNode): UiNode => ({ ...n, ...(n.identifier === 'lab.tabbar-floating.R' && { label: 'Target R (selected)' }), children: n.children.map(renamed) });
    expect(planAfter([withRow, renamed(shifted(withRow, 1108, rows))], 'up', 0.5).box).toEqual(PHONE);
  });

  it('the region only grows: a third read with T carried to y 250 widens it up to 250; a fourth back past the top keeps it', async () => {
    const at = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const wider: Rect = { x: 24, y: 250, width: 354, height: 505 };
    expect(planAfter([at, shifted(at, 1108), shifted(at, 50)], 'up', 0.5).box).toEqual(wider);
    expect(planAfter([at, shifted(at, 1108), shifted(at, 50), shifted(at, 1108)], 'up', 0.5).box).toEqual(wider);
  });

  it('what held still while the target moved is chrome, not content: R and a row 60 pt below it carried back under the header (R at y 31, as measured live; idb lists them past the list\'s clip) widen the region only to below the header\'s title (110), which held still; the tab bar\'s buttons (755) bound it below', async () => {
    const capture = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const at = { ...capture, children: [...capture.children, node({ role: 'button', identifier: 'lab.tabbar-floating.Q', rect: { x: 24, y: 781, width: 354, height: 52 } })] };
    const rows = (n: UiNode): boolean => ROWS.has(n.identifier ?? '') || n.identifier === 'lab.tabbar-floating.Q';
    // Live: R at -225 after the first stroke, then carried back by the turned one to y 31 (offset 690).
    const stroke = planAfter([at, shifted(at, 946, rows), shifted(at, 690, rows)], 'up', 0.25);
    expect(stroke.box).toEqual({ x: 24, y: 110, width: 354, height: 645 });
    expect(stroke.points!.from.y).toBeGreaterThan(IDB_LIST.y);
    // A title that moved with the rows (no chrome) cuts nothing: the region reaches up to R's 31.
    const header = (n: UiNode): boolean => rows(n) || n.label === 'Header';
    expect(planAfter([at, shifted(at, 946, header), shifted(at, 690, header)], 'up', 0.25).box?.y).toBe(31);
  });

  it('one node\'s own travel is no scroll view: carousel-in-list\'s B flung by the first stroke from 1060 to -48 (the page\'s end, measured live) leaves on the screen below the status band only a 24-pt sliver of the carousel\'s card — the screen box, not a box reaching up into the band', async () => {
    const page = parseIdbDescribeAll(await load('carousel-in-list.idb.json'));
    const moves = (n: UiNode): boolean => /^lab\.carousel-in-list\./.test(n.identifier ?? '');
    const b = (tree: UiNode): UiNode | undefined => [...everyNode(tree)].find((n) => n.identifier === 'lab.carousel-in-list.B');
    const belowBand: Rect = { x: 0, y: 62, width: 402, height: 812 };
    const stroke = planAfter([page, shifted(page, 1108, moves)], 'up', 0.5, belowBand, b);
    expect(stroke.box).toEqual(PHONE);
    expect(stroke.points?.from).toEqual({ x: 201, y: 175 });
    // Measured live, the band not cut: B's top 16 pt under it and the card's sliver made a box from y 0, its touch-down at y 45 — in the band.
    const uncut = planAfter([page, shifted(page, 1108, moves)], 'up', 0.5, PHONE, b);
    expect(uncut.box).toEqual({ x: 51, y: 0, width: 351, height: 223 });
    expect(uncut.points?.from.y).toBe(45);
  });

  it('the band (`HeldBand`): R carried back toward the top, the way the first sample saw the content move, is held until its centre lies past the line a stroke over the region touches down on (391 of SHOWN 300–755), whatever held still — R at 114 (the measured group run), 280 and 317 held, 400 claimed; `fully: true` until all of it lies past', async () => {
    const at = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const region = seen([at, shifted(at, 1108), shifted(at, 607)], PHONE);
    expect(regionAfter(region)).toMatchObject({ rect: SHOWN, way: 'top' });
    expect(heldBackAfter(region, rAt(114), 'stop')).toEqual({ by: 'band', edge: 'top', region: SHOWN, line: 391, band: { x: 24, y: 300, width: 354, height: 91 }, part: false });
    expect(heldBackAfter(region, rAt(280), 'stop')).toMatchObject({ by: 'band', edge: 'top' });
    expect(heldBackAfter(region, rAt(317), 'stop')).toMatchObject({ by: 'band', edge: 'top' });
    expect(heldBackAfter(region, rAt(364), 'stop')).toMatchObject({ by: 'band', edge: 'top' });
    expect(heldBackAfter(region, rAt(366), 'stop')).toBeUndefined();
    // `fully: true` asks all of it: R at 380 has its top 11 pt short of the line, its centre past it.
    expect(heldBackAfter(region, rAt(380), 'fully')).toMatchObject({ by: 'band', edge: 'top', part: true });
    expect(heldBackAfter(region, rAt(391), 'fully')).toBeUndefined();
    // Not the other side's band: the first sample carried the content toward the top, and no stroke was drawn before.
    expect(heldBackAfter(region, rAt(690), 'stop')).toBeUndefined();
    // Whatever held still: with the header's title gone, the band holds all the same.
    const untitled = { ...at, children: at.children.filter((c) => c.label !== 'Header') };
    expect(heldBackAfter(seen([untitled, shifted(untitled, 1108), shifted(untitled, 607)], PHONE), rAt(114), 'stop')).toMatchObject({ by: 'band', edge: 'top', line: 391 });
  });

  it('the band on the side the last stroke drawn before the read pushed the content toward, too: after the turned stroke over the region (391 → 528, pushing it down), R short of the bottom line (665) is held; with no stroke before, or the flinging one (pushing it up), the bottom is as before — claimed', async () => {
    const at = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const region = seen([at, shifted(at, 1108), shifted(at, 607)], PHONE);
    expect(heldBackAfter(region, rAt(650), 'stop', TURNED)).toEqual({ by: 'band', edge: 'bottom', region: SHOWN, line: 665, band: { x: 24, y: 665, width: 354, height: 90 }, part: false });
    expect(heldBackAfter(region, rAt(650), 'stop')).toBeUndefined();
    expect(heldBackAfter(region, rAt(650), 'stop', FLUNG)).toBeUndefined();
    // Its centre (646) short of the line: claimed; `fully: true`, its bottom (672) past it: held, in part.
    expect(heldBackAfter(region, rAt(620), 'stop', TURNED)).toBeUndefined();
    expect(heldBackAfter(region, rAt(620), 'fully', TURNED)).toMatchObject({ by: 'band', edge: 'bottom', part: true });
    // A stroke across the axis pushes the content toward neither end: no band on either side but the first motion's.
    expect(heldBackAfter(region, rAt(650), 'stop', { from: { x: 300, y: 500 }, to: { x: 100, y: 510 } })).toBeUndefined();
  });

  it('`way` is the side the content moved toward at the FIRST sample, kept: an `up` call whose first stroke moved nothing, whose turned one carried the rows up (top), then back down — top still; a stroke moving the content that way keeps the screen box (699), one moving it the other way goes over the region (391)', async () => {
    const at = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const reads = [at, at, shifted(at, 400), shifted(at, 200)];
    expect(regionAfter(seen(reads.slice(0, 3), PHONE))).toMatchObject({ rect: SHOWN, way: 'top' });
    // The second sample (T carried down to 100, under the header: the region grows to the title, 110) keeps it.
    const grown: Rect = { x: 24, y: 110, width: 354, height: 645 };
    expect(regionAfter(seen(reads, PHONE))).toMatchObject({ rect: grown, way: 'top' });
    const back = planAfter(reads, 'up', 1);
    expect(back.box).toEqual(grown);
    expect(back.points?.from).toEqual({ x: 201, y: 239 });
    const forward = planAfter(reads, 'down', 1);
    expect(forward.box).toEqual(PHONE);
    expect(forward.points?.from).toEqual({ x: 201, y: 699 });
    // Seen first moving down: the other way round.
    const down = [shifted(at, 400), shifted(at, 400), at];
    expect(regionAfter(seen(down, PHONE))).toMatchObject({ rect: SHOWN, way: 'bottom' });
    expect(planAfter(down, 'up', 1).box).toEqual(PHONE);
    expect(planAfter(down, 'down', 1).box).toEqual(SHOWN);
  });

  it('the still-facing hold: past the region\'s edge on a side no band covers, toward a node that held still facing the rows — the nearest, a fraction of a point inside the edge counted as at it (idb\'s frames are fractional): a pill at 754.5 over the tab bar below; a bar at 280–300.5 above, the content first seen moving down', async () => {
    const capture = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const at = { ...capture, children: [...capture.children, node({ role: 'button', identifier: 'lab.tabbar-floating.Q', rect: { x: 24, y: 781, width: 354, height: 52 } })] };
    const rows = (n: UiNode): boolean => ROWS.has(n.identifier ?? '') || n.identifier === 'lab.tabbar-floating.Q';
    const plus = (t: UiNode, rect: Rect): UiNode => ({ ...t, children: [...t.children, node({ role: 'other', label: 'Late', rect })] });
    // The region forms (24,300 354x455) before the late node shows; the read after carries the rows past the edge, the node held still across both.
    const pill: Rect = { x: 150, y: 754.5, width: 100, height: 16 };
    const down = seen([at, plus(shifted(at, 946, rows), pill), plus(shifted(at, -79, rows), pill)], PHONE);
    expect(regionAfter(down)).toMatchObject({ rect: SHOWN, way: 'top' });
    expect(heldBackAfter(down, rAt(800), 'stop')).toEqual({ by: 'still', edge: 'bottom', region: SHOWN, still: { role: 'other', label: 'Late', identifier: null, rect: pill }, part: false });
    expect(heldBackAfter(down, rAt(720), 'fully')).toMatchObject({ by: 'still', edge: 'bottom', part: true });
    const bar: Rect = { x: 150, y: 280, width: 100, height: 20.5 };
    const up = seen([shifted(at, 400, rows), plus(at, bar), plus(shifted(at, 690, rows), bar)], PHONE);
    expect(regionAfter(up)).toMatchObject({ rect: SHOWN, way: 'bottom' });
    expect(heldBackAfter(up, rAt(114), 'stop')).toMatchObject({ by: 'still', edge: 'top', still: { label: 'Late', rect: bar }, part: false });
    // A title collapsing in place (its origin kept, its height shrinking as the list scrolls) held still all the same.
    const collapsing = (t: UiNode, height: number): UiNode => ({ ...t, children: t.children.map((c) => (c.label === 'Header' ? { ...c, rect: { ...c.rect, height } } : c)) });
    const shrunk = seen([shifted(at, 400, rows), collapsing(at, 12)], PHONE);
    expect(heldBackAfter(shrunk, rAt(30), 'stop')).toMatchObject({ by: 'still', edge: 'top', still: { label: 'Header', rect: { x: 173 } } });
  });

  it('the still-facing hold faces the ROWS, not the target: a badge 40 pt wide at x 330 — beside the header\'s centred title (173–229) — carried past the region\'s top is held toward the title all the same; with nothing still facing the rows there, not held', async () => {
    const at = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const title = [...everyNode(at)].find((n) => n.label === 'Header')!;
    const memory = seen([shifted(at, 400), at], PHONE);
    expect(regionAfter(memory)).toMatchObject({ rect: SHOWN, way: 'bottom' });
    const badge: Rect = { x: 330, y: 200, width: 40, height: 20 };
    expect(heldBackAfter(memory, badge, 'stop')).toEqual({ by: 'still', edge: 'top', region: SHOWN, still: { role: title.role, label: 'Header', identifier: title.identifier, rect: title.rect }, part: false });
    // The title moved to the screen's right edge, beside the region's 24–378: nothing past its top faces the rows.
    const aside = (n: UiNode): UiNode => ({ ...n, ...(n.label === 'Header' && { rect: { ...n.rect, x: 382, width: 20 } }), children: n.children.map(aside) });
    expect(heldBackAfter(seen([aside(shifted(at, 400)), aside(at)], PHONE), badge, 'stop')).toBeUndefined();
  });

  it('a short list — the target under the tab bar: the first motion carried the content up, and the last stroke pushed it up again (the list at its end, flung back), R carried past the region\'s bottom under the tab bar, on a side neither covers, is held by the tab bar\'s buttons, which held still; with no tab bar, claimed as before', async () => {
    const at = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const region = seen([at, shifted(at, 1108), shifted(at, 607)], PHONE);
    expect(heldBackAfter(region, rAt(790), 'stop', FLUNG)).toMatchObject({ by: 'still', edge: 'bottom', still: { identifier: 'lab.tabbar-floating.tab.home', rect: { y: 755 } }, part: false });
    const noBar = { ...at, children: at.children.filter((c) => !(c.identifier ?? '').includes('.tab.')) };
    expect(heldBackAfter(seen([noBar, shifted(noBar, 1108), shifted(noBar, 607)], PHONE), rAt(790), 'stop', FLUNG)).toBeUndefined();
  });

  it('what held still BESIDE the rows is no chrome: a floating button (330,480) or a section index (370,210 30x520) cuts nothing, and R drawn at 400, past the band\'s line (391), is not held back', async () => {
    const capture = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    for (const beside of [{ x: 330, y: 480, width: 56, height: 56 }, { x: 370, y: 210, width: 30, height: 520 }]) {
      const at = { ...capture, children: [...capture.children, node({ role: 'button', label: 'Beside', rect: beside })] };
      expect(planAfter([at, shifted(at, 1108)], 'up', 0.5).box).toEqual(SHOWN);
      expect(heldBackAfter(seen([at, shifted(at, 1108), shifted(at, 607)], PHONE), rAt(400), 'stop', TURNED)).toBeUndefined();
    }
  });

  it('a tab bar whose buttons leave the rows\' middle line open (two tabs, 40–180 and 222–362) is chrome all the same: the region stops above it; two buttons overlapping at one side are not', async () => {
    const capture = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const at = { ...capture, children: [...capture.children.filter((c) => !(c.identifier ?? '').includes('.tab.')), node({ role: 'button', label: 'home', rect: { x: 40, y: 755, width: 140, height: 64 } }), node({ role: 'button', label: 'more', rect: { x: 222, y: 755, width: 140, height: 64 } })] };
    expect(planAfter([at, shifted(at, 1108)], 'up', 0.5).box).toEqual(SHOWN);
    // Two still buttons overlapping each other at one side (24–120 and 60–150: 126 pt of 354, counted once) are no band across the rows.
    const pair = { ...capture, children: [...capture.children, node({ role: 'button', label: 'One', rect: { x: 24, y: 480, width: 96, height: 40 } }), node({ role: 'button', label: 'Two', rect: { x: 60, y: 480, width: 90, height: 40 } })] };
    expect(planAfter([pair, shifted(pair, 1108)], 'up', 0.5).box).toEqual(SHOWN);
  });

  it('a node reaching across the region\'s middle along the axis is no chrome, whatever shares its band: a section index as long as the rows (370,210 30x520) beside a centred floating button (171,690) — the button cuts the region\'s bottom, the index nothing, and R drawn at 400, past the band\'s line (378), is not held back', async () => {
    const capture = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const at = { ...capture, children: [...capture.children, node({ role: 'other', label: 'Index', rect: { x: 370, y: 210, width: 30, height: 520 } }), node({ role: 'button', label: 'Compose', rect: { x: 171, y: 690, width: 60, height: 56 } })] };
    expect(planAfter([at, shifted(at, 1108)], 'up', 0.5).box).toEqual({ x: 24, y: 300, width: 354, height: 390 });
    const memory = seen([at, shifted(at, 1108), shifted(at, 607)], PHONE);
    expect(heldBackAfter(memory, rAt(400), 'stop', TURNED)).toBeUndefined();
    expect(heldBackAfter(memory, rAt(340), 'stop', TURNED)).toMatchObject({ by: 'band', line: 378 });
  });

  it('the band\'s edges as measured: a node ending exactly on the rows\' middle line reaches it; a node past the region\'s side covers only what of it lies across the region', async () => {
    const capture = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    // A pill at 250–450, 128 pt of the region's 354 across (not 200): beside the rows, no chrome.
    const wide = { ...capture, children: [...capture.children, node({ role: 'button', label: 'Pill', rect: { x: 250, y: 480, width: 200, height: 40 } })] };
    expect(planAfter([wide, shifted(wide, 1108)], 'up', 0.5).box).toEqual(SHOWN);
    // The header's title moved to end on x 201, the rows' middle line: chrome still — R and a row carried under the header widen the region only to below it.
    const ending = (t: UiNode): UiNode => ({ ...t, children: [...t.children.map((c) => (c.label === 'Header' ? { ...c, rect: { ...c.rect, x: 101, width: 100 } } : c)), node({ role: 'button', identifier: 'lab.tabbar-floating.Q', rect: { x: 24, y: 781, width: 354, height: 52 } })] });
    const rows = (n: UiNode): boolean => ROWS.has(n.identifier ?? '') || n.identifier === 'lab.tabbar-floating.Q';
    const at = ending(capture);
    expect(planAfter([at, shifted(at, 946, rows), shifted(at, 690, rows)], 'up', 0.25).box?.y).toBe(110);
  });

  it('the region never shrinks: a "scroll to top" button that appears across the rows and holds still for two reads cuts nothing the earlier reads showed', async () => {
    const at = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const withTop = (t: UiNode): UiNode => ({ ...t, children: [...t.children, node({ role: 'button', label: 'Scroll to top', rect: { x: 150, y: 600, width: 100, height: 40 } })] });
    const reads = [at, shifted(at, 300), withTop(shifted(at, 200)), withTop(shifted(at, 100))];
    const before = planAfter(reads.slice(0, 3), 'up', 0.5).box!;
    const after = planAfter(reads, 'up', 0.5).box!;
    expect(after.y).toBeLessThanOrEqual(before.y);
    expect(after.y + after.height).toBeGreaterThanOrEqual(before.y + before.height);
  });

  it('only what held still on the screen the app shows: a status-bar clock (in the band, above the gesture box) is no chrome — with no header title, the content first seen moving down (no band at the top), R at 114 is not held back', async () => {
    const capture = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const at = { ...capture, children: [...capture.children.filter((c) => c.label !== 'Header'), node({ role: 'text', label: '9:41', rect: { x: 180, y: 20, width: 42, height: 20 } })] };
    const belowBand: Rect = { x: 0, y: 62, width: 402, height: 812 };
    expect(heldBackAfter(seen([shifted(at, 400), at], belowBand), rAt(114), 'stop')).toBeUndefined();
    // On the whole screen, the clock held still in it: it faces the rows.
    expect(heldBackAfter(seen([shifted(at, 400), at], PHONE), rAt(114), 'stop')).toMatchObject({ by: 'still', still: { label: '9:41' } });
  });

  it('no sample from a target that changed size between the reads, or moved a point at most: the screen box', async () => {
    const capture = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    // A row carried with the list (an id of its own), so that the rows alone would make a sample.
    const at = { ...capture, children: [...capture.children, node({ role: 'button', identifier: 'lab.tabbar-floating.S', rect: { x: 24, y: 400, width: 354, height: 52 } })] };
    const rows = (n: UiNode): boolean => ROWS.has(n.identifier ?? '') || n.identifier === 'lab.tabbar-floating.S';
    const taller = (n: UiNode): UiNode => ({ ...n, ...(n.identifier === 'lab.tabbar-floating.R' && { rect: { ...n.rect, height: 60 } }), children: n.children.map(taller) });
    expect(planAfter([at, shifted(at, 300, rows)], 'up', 0.5).box).not.toEqual(PHONE);
    expect(planAfter([at, taller(shifted(at, 300, rows))], 'up', 0.5).box).toEqual(PHONE);
    expect(planAfter([at, shifted(at, 0.5)], 'up', 0.5).box).toEqual(PHONE);
  });

  it('carried means kept its size and moved by the target\'s delta within a 20th: a row that grew, and a parallax layer at half the speed, are left out', async () => {
    const capture = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const at = { ...capture, children: [...capture.children, node({ role: 'other', label: 'Side', rect: { x: 0, y: 400, width: 20, height: 52 } }), node({ role: 'other', label: 'Parallax', rect: { x: 0, y: 250, width: 402, height: 20 } })] };
    const rowsAndSide = (n: UiNode): boolean => ROWS.has(n.identifier ?? '') || n.label === 'Side';
    const grown = (n: UiNode): UiNode => ({ ...n, ...(n.label === 'Side' && { rect: { ...n.rect, height: 60 } }), children: n.children.map(grown) });
    const next = shifted(grown(shifted(at, 1108, rowsAndSide)), 554, (n) => n.label === 'Parallax');
    expect(planAfter([at, next], 'up', 0.5).box).toEqual(SHOWN);
  });

  it('a sideways motion makes a sideways region, and a motion on the other axis after it starts the region again', () => {
    // A carousel under idb: three 100-pt cards 300 pt apart, carried 250 pt left, then the page 200 pt down.
    const page = (dx: number, dy: number): UiNode =>
      parseIdbDescribeAll(
        JSON.stringify([
          { type: 'Application', AXLabel: 'Lab', frame: { x: 0, y: 0, width: 402, height: 874 } },
          ...[0, 1, 2].map((k) => ({ type: 'Button', AXLabel: `Card ${k}`, AXUniqueId: `card.${k}`, frame: { x: 24 + 300 * k - dx, y: 300 + dy, width: 100, height: 200 } })),
        ]),
      );
    const card1 = (tree: UiNode): UiNode | undefined => [...everyNode(tree)].find((n) => n.identifier === 'card.1');
    const sideways = seen([page(0, 0), page(250, 0)], PHONE, card1);
    expect(regionAfter(sideways)).toMatchObject({ axis: 'horizontal', rect: { x: 24, y: 300, width: 378, height: 200 } });
    const thenDown = seen([page(0, 0), page(250, 0), page(250, 200)], PHONE, card1);
    expect(regionAfter(thenDown)).toMatchObject({ axis: 'vertical', rect: { x: 74, y: 300, width: 328, height: 400 } });
  });

  // The hold's limit, a residual (docs/adr/0010-pixel-assert-keyboard-first.md, residual 6): idb lists rows carried
  // under the header where they would lie, so in a list whose rows lie close the screen shows two of them at least
  // there, and the region grows up to the header's title — not to the header's edge (200), which no node tells. A row
  // carried under the header then lies IN the region, and nothing holds its stop back.
  it('rows lying close (one every 60 pt) listed under the header widen the region up to the title (110): a row carried back to 160, under the header — base\'s false stop, the tap to the header (measured live on tabbar-dense, R at 143 and 158) — is held by the band (line 239); its centre at 240, claimed', async () => {
    const capture = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const dense = { ...capture, children: [...capture.children.filter((c) => !ROWS.has(c.identifier ?? '')), ...Array.from({ length: 40 }, (_, k) => node({ role: 'button', identifier: `row.${k}`, label: `Row ${k}`, rect: { x: 24, y: 300 + 60 * k, width: 354, height: 52 } }))] };
    const rows = (n: UiNode): boolean => (n.identifier ?? '').startsWith('row.');
    const row7 = (tree: UiNode): UiNode | undefined => [...everyNode(tree)].find((n) => n.identifier === 'row.7');
    const belowBand: Rect = { x: 0, y: 62, width: 402, height: 812 };
    const memory = seen([dense, shifted(dense, 1108, rows), shifted(dense, 560, rows)], belowBand, row7);
    expect(regionAfter(memory)).toMatchObject({ rect: { y: 110, height: 645 }, way: 'top' });
    expect(heldBackAfter(memory, { x: 24, y: 160, width: 354, height: 52 }, 'stop')).toMatchObject({ by: 'band', edge: 'top', line: 239 });
    expect(heldBackAfter(memory, { x: 24, y: 214, width: 354, height: 52 }, 'stop')).toBeUndefined();
  });

  it('no region, no hold: one read (idb before any motion), and WDA\'s twin, which tells its list', async () => {
    const at = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    expect(heldBackAfter(seen([at], PHONE), { x: 24, y: 114, width: 354, height: 52 }, 'stop')).toBeUndefined();
    const wda = parseWdaSource(await load('tabbar-floating.wda.json'));
    expect(heldBackAfter(seen([wda, shifted(wda, 1108), shifted(wda, 607)], PHONE), { x: 24, y: 114, width: 354, height: 52 }, 'stop')).toBeUndefined();
  });

  it('a read between that does not find the target, or lists it twice, keeps the read before: the motion is measured across it', async () => {
    const at = parseIdbDescribeAll(await load('tabbar-floating.idb.json'));
    const gone = (n: UiNode): UiNode => ({ ...n, children: n.children.filter((c) => c.identifier !== 'lab.tabbar-floating.R').map(gone) });
    expect(planAfter([at, gone(shifted(at, 500)), shifted(at, 1108)], 'up', 0.5).box).toEqual(SHOWN);
    const twice = (t: UiNode): UiNode => ({ ...t, children: [...t.children, ...t.children.filter((c) => c.identifier === 'lab.tabbar-floating.R')] });
    expect(planAfter([at, twice(shifted(at, 500)), shifted(at, 1108)], 'up', 0.5).box).toEqual(SHOWN);
  });

  it('only where the tree tells no scroll view: WDA\'s twin strokes over its list as before; a told tree with the target in no scroll view, moved, keeps the screen box', async () => {
    const wda = parseWdaSource(await load('tabbar-floating.wda.json'));
    const list = [...everyNode(wda)].find((n) => n.role === 'scrollable')!.rect;
    expect(planAfter([wda, shifted(wda, 1108)], 'up', 0.5).box).toEqual(rectIntersection(list, PHONE));
    const loose = (y: number): UiNode =>
      wdaScreen([
        node({ role: 'other', label: 'Header', rect: { x: 0, y: 0, width: 402, height: 200 } }),
        node({ role: 'button', identifier: 'lab.tabbar-floating.T', rect: { x: 24, y: y - 421, width: 354, height: 52 } }),
        node({ role: 'button', identifier: 'lab.tabbar-floating.R', rect: { x: 24, y, width: 354, height: 52 } }),
      ]);
    expect(planAfter([loose(721), loose(-387)], 'up', 0.5).box).toEqual(PHONE);
  });
});
