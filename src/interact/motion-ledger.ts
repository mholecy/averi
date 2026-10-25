import type { Rect, Stroke, UiNode } from '../adapters/types.js';
import { isUntold, sameRectWithinPixel, sameSizeWithinPixel } from '../ui-tree/geometry.js';
import { listedOnce, nodeIdentity, sameTreeWithinPixel } from '../ui-tree/read-tree.js';
import { carriedUnder, goesOver, NO_REGION, seeRegion, type CarriedUnder, type MotionShown, type RegionMemory } from './motion-shown.js';
import type { Since, TreeFacts } from './scroll-read.js';
import { sameStroke, type Direction } from './swipe.js';

export type { CarriedUnder, MotionShown } from './motion-shown.js';

/**
 * THE MOTION LEDGER: every answer to "did it move" across one `scroll_until` run, kept in one place. The round
 * (interact/scroll-rounds.ts#round) shows it each round's read and the stroke drawn before it, and asks it; it keeps
 * what the answers are measured against — the last read's rects, fingerprint, tree, judged rect and identity, the
 * streak's stroke, the last stroke drawn, the motion over the last settle, the read before a stroke that may have
 * rebounded (kept for the settled read: `rebounding`), and, on a tree that tells no scroll view, the region the motion
 * showed (interact/motion-shown.ts, its internal module).
 *
 * The interface, which is also the test surface (tests/interact/motion-ledger.test.ts; the region over measured idb
 * captures, with the plan's stroke over it, tests/interact/motion-region.test.ts):
 * - `startLedger()` — nothing read, nothing drawn.
 * - `seeMotion(ledger, { drawn, read })` — one call a round: the stroke the driver handed back (`drawn`, the round's
 *   `RoundSeen.drawn`) and, when the round's tree read, that read (`LedgerRead`). Answers what the read says about
 *   motion (`Moved`) — every question below, at once.
 * - `heldBack(ledger, target, of)` — whether the region the motion showed holds back a stop on `target`
 *   (motion-shown.ts#carriedUnder, after the last stroke drawn).
 * - `regionOf(ledger)` / `overRegion(ledger, toward)` — the region as the target's one scroll view, for the stroke plan,
 *   and whether a stroke toward `toward` goes over it (motion-shown.ts#goesOver).
 * - `lastDrawn`, `unseenStrokes`, `treeMoved` — what the probe, the fast fail and the bound read of the run so far.
 *
 * EACH QUESTION KEEPS ITS OWN "same". Every question here is within a pixel (a unit of the source's frames); the
 * exact-rect side of docs/adr/0021-scroll-until-turns-once-at-a-proven-end.md d2 — the scroll view a proof or a carry
 * was measured over (geometry.ts#Clips.contentToward, stroke-plan.ts#carryOver) — is not the ledger's. What differs
 * here is identity, and one definition of "the same node" for every question is a behaviour change (owner decision
 * D5), not this module's:
 * - the JUDGED match unmoved: its rect within a pixel of the last judged match's — no identity (the stuck test, the
 *   settle confirm);
 * - EVERY match unmoved: the same multiset of rects, each within a pixel (`sameRects`) — "exhausted" must look at every
 *   match, since the judged one can be a static duplicate while the real one moved;
 * - the TREE unmoved: the same fingerprint, nothing loading, and no blank read (`UnseenStrokes`) — where the platform
 *   flings (`StrokePhysics`, iOS, whose sources round a resting list's frames a point either way), the same tree within
 *   a pixel (ui-tree/read-tree.ts#sameTreeWithinPixel); after a stroke that may have rebounded off a list's end
 *   (`rebounding`), the settled read's tree against the read BEFORE the stroke;
 * - the REBOUND (`carriedShort`): a node listed once in both reads (ui-tree/read-tree.ts#listedOnce), at the same size
 *   within a pixel, carried along the stroke's axis by more than a pixel, and none as far as the finger drew;
 * - SLOWING: the same node (ui-tree/read-tree.ts#nodeIdentity) moved less over this settle than over the one before;
 * - the CARRY SAMPLE: the same node at the same size (within a pixel each way) after a course stroke;
 * - the REGION: motion-shown.ts's own rules (a node listed once, its delta within a 20th).
 * Not here: whether a margin text and the target were carried together since the eyes saw them — measured from that
 * sighting, which the margin memo keeps, not from the last read (interact/margin-memo.ts#movedTogether).
 *
 * Pure: no adapter, no clock, no I/O.
 */

/**
 * The strokes in a row, up to the bound, whose reads listed none of the content of the scroll view they went over
 * (`within`) — `Clips.contentToward`'s `blank`: blank space, or content that dumps no node — so how far they moved it
 * is unknown (scroll-rounds.ts#UNMOVED_STROKES_EXHAUST's blank read; the first may show it moved, by carrying the last
 * content listed off the viewport, but none shows how far). All over one scroll view, one way: a stroke over another,
 * or the other way, starts the count again. `toward`: the way they went, where the content lies. An `absent` failure at
 * maxSwipes or the deadline carries it: without it, "never appeared" at the bound reads as "not there", where the target
 * may lie further on.
 * docs/bugs/2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md
 */
export interface UnseenStrokes {
  readonly strokes: number;
  readonly within: Rect;
  readonly toward: Direction;
}

/** One read that read, as the ledger sees it (`seeMotion`). */
export interface LedgerRead {
  /** What the read followed. */
  readonly since: Since;
  /** Every match the read found, in tree order. */
  readonly found: readonly UiNode[];
  /** The match judged best (scroll-read.ts#judge), when there is one. */
  readonly judged: UiNode | undefined;
  /** The read's facts: its tree and scene (the region's), its fingerprint and whether a progress node shows (the tree's). */
  readonly facts: Pick<TreeFacts, 'scene' | 'tree' | 'fingerprint' | 'loading'>;
  /** What of the screen shows the app to a touch — the round's gesture box below iOS's status band — for the region (motion-shown.ts#seeRegion). */
  readonly gesture?: Rect;
  /** A read after a stroke that listed none of the content of the scroll view that stroke went over (`within`, the round's interact/stroke-plan.ts#strokedContent `blank`), and the way it went: one more blank stroke (`UnseenStrokes`). */
  readonly blank?: { readonly within: Rect; readonly toward: Direction };
  /**
   * The way the course stroke this read follows went, given only where a carry sample may be offered: after a stroke
   * of the course (not the flush check's probe), on a tree that lists the target where it lies
   * (ui-tree/standing.ts's `listedWhereItLies` — WDA's unclipped frames). The ledger adds the rest: the same node, at
   * the same size (`Moved.carry`).
   */
  readonly carryToward?: Direction;
  /** How the platform's scroll views take a stroke (`StrokePhysics`); default `drag`. */
  readonly strokes?: StrokePhysics;
}

/**
 * How a platform's scroll views take a stroke (scroll-rounds.ts#RoundRules `strokes`, from the adapter: interact/scroll.ts):
 * - `fling`: its own scroll physics, no drag speed (iOS: adapters/types.ts#DeviceAdapter's `dragSpeed` absent) — a
 *   stroke into a list's end rubber-bands the content back, so a read after it that finds no match, lists content the
 *   stroke went over (no `blank`) and finds the content carried less far than the finger drew may be read inside the
 *   bounce (`Moved.rebounding`); and iOS's sources round a resting list's frames a point either way, so the tree's
 *   unmoved test is within a pixel;
 * - `drag`: dragged at a speed that does not fling (Android's `dragSpeed`) — the content moves about the finger's
 *   travel, and the tree's unmoved test is the fingerprint's, exact.
 */
export type StrokePhysics = 'fling' | 'drag';

/** Identical strokes in a row (`sameStroke`) after which the judged match, every match, and the whole tree stayed put. */
export interface Streaks {
  readonly judged: number;
  readonly all: number;
  readonly tree: number;
}

/** What one read that read says about motion (`seeMotion`). */
export interface Moved {
  /**
   * This read against the one before it: the judged match where the last judged match was (any read); every match
   * where it was, and the whole tree as it was (a read after a stroke only — false otherwise).
   */
  readonly unmoved: { readonly judged: boolean; readonly all: boolean; readonly tree: boolean };
  /** The streaks after this read (`Streaks`): counted on a read after a stroke, kept on any other. */
  readonly streaks: Streaks;
  /**
   * A FLING STILL SLOWING (scroll-rounds.ts#SETTLE_CONFIRM_READS): a confirming read found the judged match — the same
   * node — moved less over its settle pause than the read before found it moved over its own.
   */
  readonly slowing: boolean;
  /** What the stroke just sent carried the target (interact/stroke-plan.ts#carried's sample), when `LedgerRead.carryToward` allowed one and the judged match is the same node at the same size: how far it moved the way the content goes, and the stroke as drawn. */
  readonly carry: { readonly moved: number; readonly drawn: Stroke } | undefined;
  /**
   * A REBOUND MAY BE UNDER WAY (`StrokePhysics` `fling`): this read after a stroke found the content carried less
   * far than the finger drew, the target nowhere — the tree's verdict on that stroke waits for the next read that reads
   * after a settle, which is compared with the read before the stroke. Nothing is counted on this read.
   * docs/bugs/2026-10-12-ios-scroll-until-never-reads-a-bouncing-list-end-as-exhausted.md
   */
  readonly rebounding: boolean;
  /** This read answers for the last stroke: the read after it, or the settled read a rebound waited for — the reads the tree's streak is counted on. */
  readonly strokeRead: boolean;
}

declare const opaque: unique symbol;

/** The ledger — opaque: only this module reads it (the fields are `Memory`'s). */
export interface MotionLedger {
  readonly [opaque]: 'motion-ledger';
}

interface Memory {
  /** Every match's rect at the last read that read. */
  readonly rects: readonly Rect[] | undefined;
  /** The judged match at the last read that had one: its rect and its identity (ui-tree/read-tree.ts#nodeIdentity). */
  readonly judged: { readonly rect: Rect; readonly identity: string } | undefined;
  /** The whole tree's fingerprint at the last read that read. */
  readonly fingerprint: string | undefined;
  /** The whole tree at the last read that read — what a stroke's content is measured against for a rebound (`rebounding`). */
  readonly tree: UiNode | undefined;
  /** The read before a stroke whose read may have caught a rebound (`Moved.rebounding`): what the settled read is compared with; undefined otherwise. */
  readonly rebound: { readonly tree: UiNode; readonly fingerprint: string; readonly rects: readonly Rect[] | undefined } | undefined;
  readonly streaks: Streaks;
  /** The stroke the streaks were last counted for (`sameStroke`). */
  readonly streakDrawn: Stroke | undefined;
  /**
   * The last stroke drawn — a probe's too — as the driver handed it back: set by the round after it, kept through
   * every round until the next one is drawn (a stroke held for a presented screen's confirming read is not drawn, and
   * changes nothing); undefined until the first. The streaks', the probe's, `touchedOn`'s, and the side it pushed the
   * content toward is the one the region's band holds besides `way` (motion-shown.ts#carriedUnder).
   */
  readonly lastDrawn: Stroke | undefined;
  /** How far the judged match moved over the settle pause before the last read that read (`motionOf`), the same node at both reads — undefined when that read followed no settle, or did not find it so. */
  readonly lastMotion: number | undefined;
  /** A read after a stroke found the whole tree changed from the read before — the content moved at least once. */
  readonly treeMoved: boolean;
  /** The blank strokes in a row (`UnseenStrokes`); undefined after any read after a stroke that was not blank. */
  readonly unseen: UnseenStrokes | undefined;
  /** The region the motion showed, on a tree that tells no scroll view, and the listing the next read is measured against (motion-shown.ts#RegionMemory): kept across a read that finds no target, dropped by a read that finds it on a told tree. */
  readonly region: RegionMemory;
}

const open = (l: MotionLedger): Memory => l as unknown as Memory;
const close = (m: Memory): MotionLedger => m as unknown as MotionLedger;

/** The ledger before round 0: nothing read, nothing drawn. */
export function startLedger(): MotionLedger {
  return close({
    rects: undefined,
    judged: undefined,
    fingerprint: undefined,
    tree: undefined,
    rebound: undefined,
    streaks: { judged: 0, all: 0, tree: 0 },
    streakDrawn: undefined,
    lastDrawn: undefined,
    lastMotion: undefined,
    treeMoved: false,
    unseen: undefined,
    region: NO_REGION,
  });
}

/**
 * One round, as the ledger sees it: `drawn`, the stroke the driver handed back (the round after a stroke), and `read`,
 * when the round's tree read. A round whose tree did not read says nothing about motion — the comparisons wait for the
 * next that does — and keeps the stroke. Answers `Moved` for a read, undefined for none.
 */
export function seeMotion(ledger: MotionLedger, { drawn, read }: { readonly drawn: Stroke | undefined; readonly read?: LedgerRead }): { ledger: MotionLedger; moved: Moved | undefined } {
  const m = open(ledger);
  const lastDrawn = drawn ?? m.lastDrawn;
  if (read === undefined) return { ledger: close({ ...m, lastDrawn }), moved: undefined };
  const { since, found, judged, facts, gesture, blank, carryToward, strokes = 'drag' } = read;
  const rects = found.map((n) => ({ ...n.rect }));
  const before = m.judged;
  // This read's judged match as the ledger keeps it: kept until a read judges another.
  const now = judged === undefined ? undefined : { rect: { ...judged.rect }, identity: nodeIdentity(judged) };
  const sameNode = before !== undefined && before.identity === now?.identity;
  const judgedUnmoved = judged !== undefined && before !== undefined && sameRectWithinPixel(before.rect, judged.rect);
  // The same node's motion over the settle pause before this read (`motionOf`) — a read after a stroke measures the
  // stroke too, and keeps none — and whether it moved less than over the pause before: a fling slowing.
  const motion = since === 'settle' && judged !== undefined && before !== undefined && sameNode ? motionOf(before.rect, judged.rect) : undefined;
  const slowing = motion !== undefined && m.lastMotion !== undefined && motion < m.lastMotion;
  let { streaks, streakDrawn, treeMoved, unseen } = m;
  let allUnmoved = false;
  let treeUnmoved = false;
  // A rebound that may be under way (`Moved.rebounding`): this read after a stroke counts nothing, the read before the
  // stroke kept for the settled read to be compared with.
  const rebounding =
    since === 'stroke' && strokes === 'fling' && blank === undefined && found.length === 0 && m.tree !== undefined && m.fingerprint !== undefined && m.fingerprint !== facts.fingerprint && lastDrawn !== undefined && carriedShort(m.tree, facts.tree, lastDrawn);
  const rebound = rebounding && m.tree !== undefined && m.fingerprint !== undefined ? { tree: m.tree, fingerprint: m.fingerprint, rects: m.rects } : undefined;
  // The settled read a rebound waited for answers for that stroke, against the read before it.
  const settled = since === 'settle' ? m.rebound : undefined;
  const strokeRead = (since === 'stroke' && !rebounding) || settled !== undefined;
  // The whole tree, for a target not in it: a read that lists none of the stroked scroll view's content (`blank`) is
  // no evidence either way — no unmoved read, so the tree's streak starts again.
  if (since === 'stroke') unseen = blank === undefined ? undefined : unseenAfter(unseen, blank.within, blank.toward);
  if (strokeRead) {
    const was = settled ?? { tree: m.tree, fingerprint: m.fingerprint, rects: m.rects };
    // Within a pixel where the platform flings: iOS's whole-point frames round a list resting a fraction of a point off a
    // point either way — measured under idb, scroll-top-edge-end's page at its end read A at -282 before the first
    // stroke into it and -283 after, which the exact fingerprint read as motion: a third stroke, and a side never
    // stroked named. Exact where strokes drag (Android): no source of it was measured rounding so.
    const sameTree = was.fingerprint === facts.fingerprint || (strokes === 'fling' && was.tree !== undefined && sameTreeWithinPixel(was.tree, facts.tree));
    treeUnmoved = sameTree && !facts.loading && unseen === undefined;
    if (was.fingerprint !== undefined && !sameTree) treeMoved = true;
    // Every match, not only the judged one: with several matches off the frame the judged one is the first in tree
    // order, which can be a static duplicate (another page, a hidden copy) while the real one moved.
    allUnmoved = was.rects !== undefined && sameRects(was.rects, rects);
    // ONE streak rule for the three: unmoved after the same stroke as the streak's counts on, unmoved after another
    // starts again at one, moved is none.
    const again = streakDrawn !== undefined && lastDrawn !== undefined && sameStroke(streakDrawn, lastDrawn);
    const after = (n: number, unmoved: boolean): number => (!unmoved ? 0 : n > 0 && again ? n + 1 : 1);
    streaks = { judged: after(streaks.judged, judgedUnmoved), all: after(streaks.all, allUnmoved), tree: after(streaks.tree, treeUnmoved) };
    streakDrawn = lastDrawn;
  }
  // The carry sample: only where the round allows one (`carryToward`), and only of the SAME node at the same size — a
  // judged match that switched to another node, or one that changed size, moved by no stroke.
  const carry =
    since === 'stroke' && carryToward !== undefined && judged !== undefined && before !== undefined && sameNode && sameSizeWithinPixel(before.rect, judged.rect) && lastDrawn !== undefined
      ? { moved: motionToward(before.rect, judged.rect, carryToward), drawn: lastDrawn }
      : undefined;
  // The region (motion-shown.ts): seen only on a read that found the target, and only where its tree tells no scroll
  // view of it; a read that finds it where the tree tells its scroll views drops the region and its listing.
  const region = judged === undefined ? m.region : isUntold(facts.scene.clips.drawnIn(judged)) ? seeRegion(m.region, facts.tree, judged, gesture) : NO_REGION;
  const next: Memory = {
    rects,
    judged: now ?? before,
    fingerprint: facts.fingerprint,
    tree: facts.tree,
    rebound,
    streaks,
    streakDrawn,
    lastDrawn,
    lastMotion: motion,
    treeMoved,
    unseen,
    region,
  };
  return { ledger: close(next), moved: { unmoved: { judged: judgedUnmoved, all: allUnmoved, tree: treeUnmoved }, streaks, slowing, carry, rebounding, strokeRead } };
}

/**
 * Whether the region the motion showed holds back a stop on `target` (`of`: the plain stop's centre, a `fully` stop's
 * whole rect), after the last stroke drawn — motion-shown.ts#carriedUnder, `CarriedUnder` — or undefined (no region).
 * After the last stroke drawn, not only on the read right after it: a stop is claimed only on a confirming read, and a
 * fling carries the target on into the pushed side's band between the two.
 */
export function heldBack(ledger: MotionLedger, target: Rect, of: 'stop' | 'fully'): CarriedUnder | undefined {
  const { region, lastDrawn } = open(ledger);
  return carriedUnder(region.shown, target, of, lastDrawn);
}

/** The region the target's motion showed, on a tree that tells no scroll view (`MotionShown`) — its one scroll view for the stroke plan (interact/stroke-plan.ts#SeenRead.region); undefined on any other, and until two reads saw the target carried. */
export const regionOf = (ledger: MotionLedger): MotionShown | undefined => open(ledger).region.shown;

/** Whether a stroke toward `toward` goes over the region (motion-shown.ts#goesOver) — true with no region: then the plan's own scroll views stand. False: the gesture box whole (interact/stroke-plan.ts#StrokeAsk.screenBox). */
export function overRegion(ledger: MotionLedger, toward: Direction): boolean {
  const { shown } = open(ledger).region;
  return shown === undefined || goesOver(shown, toward);
}

/** The last stroke drawn, a probe's too, kept until the next (`Memory.lastDrawn`); undefined until the first. */
export const lastDrawn = (ledger: MotionLedger): Stroke | undefined => open(ledger).lastDrawn;

/** The blank strokes in a row (`UnseenStrokes`) — what an `absent` failure at a bound that is not the content's end carries. */
export const unseenStrokes = (ledger: MotionLedger): UnseenStrokes | undefined => open(ledger).unseen;

/** Some read after a stroke found the whole tree changed from the read before: the content moved at least once (scroll-rounds.ts#Shortfall `absent`'s `unsearched`: not a screen no stroke ever changed). */
export const treeMoved = (ledger: MotionLedger): boolean => open(ledger).treeMoved;

/**
 * `unseen` with one more blank read over `within`, toward `toward` — counted on only over the same scroll view, the same
 * way. (No absent target's call turns today — a turn needs a sighting, and a read that finds the target ends the count
 * — so the way is a guard ahead of one that does.)
 */
function unseenAfter(unseen: UnseenStrokes | undefined, within: Rect, toward: Direction): UnseenStrokes {
  const goesOn = unseen !== undefined && unseen.toward === toward && sameRectWithinPixel(unseen.within, within);
  return { strokes: goesOn ? unseen.strokes + 1 : 1, within: { ...within }, toward };
}

/**
 * A REBOUND'S READ (`Moved.rebounding`): some node listed once in both reads, at the same size, moved along the stroke's
 * axis by more than a pixel, and none as far as the finger drew. A list's end rubber-bands its content less far than the
 * drag and back (measured under idb on Settings › General, a 524-pt stroke: 173 pt 0.25 s after it, 12 pt at 0.5 s); a
 * fling carries it 2–3 times the drag (ADR 0021's measured flings), and a screen that changed with nothing carried (a
 * ticking label) is no motion of the content at all.
 */
function carriedShort(before: UiNode, after: UiNode, drawn: Stroke): boolean {
  const dx = Math.abs(drawn.to.x - drawn.from.x);
  const dy = Math.abs(drawn.to.y - drawn.from.y);
  const along = (r: Rect): number => (dy >= dx ? r.y : r.x);
  const was = listedOnce(before);
  let most = 0;
  for (const [identity, n] of listedOnce(after)) {
    const then = was.get(identity);
    if (then !== undefined && sameSizeWithinPixel(then.rect, n.rect)) most = Math.max(most, Math.abs(along(n.rect) - along(then.rect)));
  }
  return most > 1 && most < Math.max(dx, dy);
}

/** The same set of rects, each within a pixel — every match where it was. Empty sets say nothing. */
function sameRects(a: readonly Rect[], b: readonly Rect[]): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  const left = [...a];
  return b.every((r) => {
    const i = left.findIndex((l) => sameRectWithinPixel(l, r));
    if (i < 0) return false;
    left.splice(i, 1);
    return true;
  });
}

/**
 * How far `to` lies from `from`: the largest of the differences in x, y, width and height — what a read finds a node
 * moved since the read before, for `Moved.slowing`. A fling's motion shrinks read for read; an animation's does not.
 */
const motionOf = (from: Rect, to: Rect): number => Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), Math.abs(to.width - from.width), Math.abs(to.height - from.height));

/** How far `to` lies from `from` the way content moves for a stroke toward `toward` (for `down`, up the screen): negative when the other way. */
function motionToward(from: Rect, to: Rect, toward: Direction): number {
  switch (toward) {
    case 'down':
      return from.y - to.y;
    case 'up':
      return to.y - from.y;
    case 'right':
      return from.x - to.x;
    case 'left':
      return to.x - from.x;
  }
}
