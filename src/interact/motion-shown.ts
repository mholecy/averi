import { everyNode, rectIntersection, type Rect, type ScrollAxis, type Stroke, type UiNode } from '../adapters/types.js';
import { quoted, type Edge, type QuotedNode } from '../ui-tree/geometry.js';
import { nodeIdentity } from '../ui-tree/read-tree.js';
import { EDGE_TOWARD, OPPOSITE, SIDES, swipeVector, type Direction } from './swipe.js';

/**
 * THE SCROLL VIEW THE MOTION SHOWS, on a tree that tells none — idb's flat list (ui-tree/geometry.ts#DrawnUntold): where
 * the target's content was seen moving between reads (`MotionShown`), which strokes go over it (`goesOver`), and which
 * stops it holds back (`carriedUnder`). Lab note LV3,
 * docs/bugs/2026-10-16-lab-ios-scroll-until-turn-back-stroke-touches-down-above-the-list-and-moves-nothing.md; the rule
 * and its cost, docs/adr/0010-pixel-assert-keyboard-first.md residual 6. THE MOTION LEDGER's internal module
 * (interact/motion-ledger.ts, which alone calls it and keeps its memory; tested through the ledger's interface):
 * - `seeRegion(memory, tree, target, gesture)` — what the ledger keeps of the region after one read that found the
 *   target (`RegionMemory`): the region so far (`MotionShown`), and the read the next is measured against; one walk.
 * - `goesOver(shown, toward)` — whether a stroke toward `toward` goes over the region (else the screen box).
 * - `carriedUnder(shown, target, of, drawn)` — whether the region holds back a stop on `target` (`CarriedUnder`), asked
 *   through interact/motion-ledger.ts#heldBack; what the stuck and bound failures say (interact/scroll-text.ts).
 * Judged per read from the region and the last stroke drawn (the ledger's `lastDrawn`): no device call, no I/O.
 */

/**
 * THE SCROLL VIEW THE MOTION SHOWS (`motionShown`): where on the screen nodes carried with the target were seen at a
 * read — a stroke touching down inside it touches down where content scrolled — and the axis they moved on. It only
 * grows over a scroll, on one axis.
 */
export interface MotionShown {
  readonly rect: Rect;
  readonly axis: ScrollAxis;
  /**
   * The side the content moved toward at the FIRST sample on this axis — the way the stroke that made the region moved
   * it (`goesOver`, `carriedUnder`). Kept, not the latest: a bounce, a rebound or a jitter flips the latest, never this.
   */
  readonly way: Edge;
  /** What held still on the screen while the target moved, at the last sample that formed — of which `chromeOf` takes the chrome (`stillCut`'s; `carriedUnder` asks it whole). */
  readonly still: readonly QuotedNode[];
}

/**
 * A stop the region holds back (`carriedUnder`), of two kinds (`by`): in the band (`HeldBand`), or past the region
 * toward a node that held still (`HeldStill`). There nothing says whether content is drawn (idb lists a row carried
 * under a header where it would lie, LE2): no stop, the strokes go on over the region.
 */
export type CarriedUnder = HeldBand | HeldStill;

/** What every held stop says (`CarriedUnder`). */
interface HeldStop {
  readonly edge: Edge;
  /** The region the motion showed (`MotionShown`). */
  readonly region: Rect;
  /** Only part of the match lies where it is held — a `fully: true` stop, its centre clear — not all of it or its centre. */
  readonly part: boolean;
}

/**
 * THE BAND a stop is held in: from the region's `edge` (and past it) to `line`, where a stroke over the region carrying
 * content away from that edge touches down (swipe.ts#swipeVector). Sound: a stroke touching down at the line lands on
 * chrome and moves nothing, or lands on content — and then no chrome on that side reaches past the line; so a target
 * is never claimed short of it, whatever idb lists under a header. `band`: the region's part between edge and line.
 * A residual of locality, stated: the line is computed here, over the region whole (`carriedUnder`'s `line`, its one
 * place), not asked of the stroke plan, whose real stroke over the region is cut by a keyboard line and kept off nested
 * scroll views (interact/stroke-plan.ts#planStroke); the two agree while neither applies.
 */
export interface HeldBand extends HeldStop {
  readonly by: 'band';
  readonly line: number;
  readonly band: Rect;
}

/**
 * PAST THE REGION's `edge`, toward `still`, a node that held still facing the rows (`MotionShown.still`, any of them —
 * not only the chrome `stillCut` cuts at, `chromeOf`): the hold only refuses a stop, so the broader set can only refuse
 * more (docs/adr/0010-pixel-assert-keyboard-first.md residual 6).
 */
export interface HeldStill extends HeldStop {
  readonly by: 'still';
  readonly still: QuotedNode;
}

/**
 * Whether a stroke toward `toward` (where the content lies) goes over the region `shown`: when it moves content the
 * other way from `way`, back over where it was seen moving. One that moves it `way` keeps the screen box — the stroke
 * that made the region, so the forward side stays as before. Why (lab note LV3): the turned stroke for
 * `tabbar-floating`'s R touched down at the screen's 0.2, y 175, in the header, and moved nothing; over the region, at
 * 391, it moves the list. Forward over the region too: 94 new false stops on a physics replay (ADR 0010 residual 6).
 */
export const goesOver = (shown: MotionShown, toward: Direction): boolean => EDGE_TOWARD[OPPOSITE[toward]] !== shown.way;

/**
 * Whether the region `moved` holds back the stop on `target` (`of`: the plain stop's centre, a `fully` stop's whole
 * rect) — `CarriedUnder` — or undefined (no region: a tree that tells a scroll view, idb before two reads saw the
 * target carried). Two holds, the band first:
 * - THE BAND (`HeldBand`), on the side `way` names and the side `drawn` — the last stroke drawn
 *   (motion-ledger.ts#lastDrawn), on every read until the next — pushed the content toward. Measured live on the
 *   lab's `tabbar-dense` (rows every 60 pt): rows carried under the header grew the region up to its title (110), and R
 *   carried back to 158 and 143, inside it, was claimed — the tap to the header. The last stroke, not only on the read
 *   right after it: a stop after a stroke is claimed on a confirming read, and a fling carries the target on into the
 *   pushed side's band between the two (a replay at 0.7 of a stroke's travel per read: 88 new false stops without).
 * - PAST THE REGION (`HeldStill`), on any side, toward a still node facing the rows (across the axis, the region's
 *   span — not the target's: a narrow target beside the title faces it all the same): R carried to 114 under
 *   `tabbar-floating`'s header, toward its title; on a short list, a row under the tab bar's buttons, on a side no band
 *   covers.
 */
export function carriedUnder(moved: MotionShown | undefined, target: Rect, of: 'stop' | 'fully', drawn?: Stroke): CarriedUnder | undefined {
  if (moved === undefined) return undefined;
  const { rect: region, axis, way, still } = moved;
  const vertical = axis === 'vertical';
  const span = (r: Rect): [number, number] => alongOf(r, axis);
  const across = (r: Rect): [number, number] => acrossOf(r, axis);
  const [lo, hi] = span(region);
  const [t0, t1] = span(target);
  const centre = (t0 + t1) / 2;
  const [from, to] = of === 'fully' ? [t0, t1] : [centre, centre];
  const [before, after]: [Edge, Edge] = vertical ? ['top', 'bottom'] : ['left', 'right'];
  const banded = (edge: Edge): boolean => edge === way || (drawn !== undefined && pushedBy(drawn) === edge);
  const line = (edge: Edge): number => {
    const touchDown = swipeVector(region, SIDES[edge].reveals, 'content').from;
    return vertical ? touchDown.y : touchDown.x;
  };
  const band = (a: number, b: number): Rect => (vertical ? { ...region, y: a, height: b - a } : { ...region, x: a, width: b - a });
  const l0 = line(before);
  const l1 = line(after);
  if (banded(before) && from < l0) return { by: 'band', edge: before, region: { ...region }, line: l0, band: band(lo, l0), part: centre >= l0 };
  if (banded(after) && to > l1) return { by: 'band', edge: after, region: { ...region }, line: l1, band: band(l1, hi), part: centre <= l1 };
  const facing = still.filter(({ rect: r }) => across(r)[0] < across(region)[1] && across(region)[0] < across(r)[1]);
  const nearBefore = from < lo ? facing.filter(({ rect: r }) => span(r)[1] <= lo + SAME_WITHIN).sort((a, b) => span(b.rect)[1] - span(a.rect)[1])[0] : undefined;
  if (nearBefore !== undefined) return { by: 'still', edge: before, region: { ...region }, still: quoted(nearBefore), part: centre >= lo };
  const nearAfter = to > hi ? facing.filter(({ rect: r }) => span(r)[0] >= hi - SAME_WITHIN).sort((a, b) => span(a.rect)[0] - span(b.rect)[0])[0] : undefined;
  if (nearAfter !== undefined) return { by: 'still', edge: after, region: { ...region }, still: quoted(nearAfter), part: centre <= hi };
  return undefined;
}

/** The side a finger stroke pushes content toward, along its longer axis. */
function pushedBy({ from, to }: Stroke): Edge {
  const [dx, dy] = [to.x - from.x, to.y - from.y];
  return Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? 'bottom' : 'top') : dx > 0 ? 'right' : 'left';
}

/**
 * What the ledger keeps of the region between reads, on a tree that tells no scroll view (`seeRegion`): the region so
 * far (`MotionShown`; undefined until two reads saw the target carried), and the listing of the last read that listed
 * the target once — what the next read that finds it is measured against.
 */
export interface RegionMemory {
  readonly shown: MotionShown | undefined;
  readonly listing: Listing | undefined;
}

/** The region memory before any read: no region, nothing to measure against. */
export const NO_REGION: RegionMemory = { shown: undefined, listing: undefined };

/**
 * The region memory after a read that found `target` on `tree` (idb's), `gesture` what of the screen shows the app to
 * a touch: the region after this read (`motionShown`), and this read's listing kept for the next — unless it lists the
 * target more than once: then it is no read to measure the next against, and the one before stands. A read that found
 * no target is not seen: the next read that finds it is measured against the last that did.
 */
export function seeRegion(memory: RegionMemory, tree: UiNode, target: UiNode, gesture: Rect | undefined): RegionMemory {
  const listing = listingOf(tree, target, gesture);
  return { shown: motionShown(memory.shown, memory.listing, listing), listing: listing.nodes.has(listing.target) ? listing : memory.listing };
}

/** One read's nodes as `motionShown` compares them with the next read's: the target's identity, every identity listed ONCE with its node as a sentence quotes it (ui-tree/read-tree.ts#nodeIdentity: duplicates are no one node), and the read's gesture box. */
interface Listing {
  readonly target: string;
  readonly nodes: ReadonlyMap<string, QuotedNode>;
  readonly gesture: Rect | undefined;
}

/** `tree`'s listing for `motionShown` (`Listing`): the target's identity, each identity listed once, the gesture box. One walk. */
function listingOf(tree: UiNode, target: UiNode, gesture: Rect | undefined): Listing {
  const nodes = new Map<string, QuotedNode>();
  const twice = new Set<string>();
  for (const n of everyNode(tree)) {
    const key = nodeIdentity(n);
    if (nodes.has(key)) twice.add(key);
    else nodes.set(key, quoted(n));
  }
  for (const key of twice) nodes.delete(key);
  return { target: nodeIdentity(target), nodes, gesture: gesture === undefined ? undefined : { ...gesture } };
}

/** Within a point: what two reads of one node may differ by in an edge or a size and still be read as the same place or size (a rounding of the source's frames). */
const SAME_WITHIN = 1;
const near = (a: number, b: number, within = SAME_WITHIN): boolean => Math.abs(a - b) <= within;

/**
 * How far a node carried with the target may have moved off the target's own delta, as a share of that delta (or
 * SAME_WITHIN, the larger): a 20th. idb reads a list moving mid-fling node by node — measured live on `tabbar-floating`,
 * T 8 pt off R's 895 in one read of 16; at a point, that read left T out and the turned stroke went over the screen
 * again. A node moving by another delta (a header animating 10 pt, a parallax layer) lies far outside it.
 */
const CARRIED_SHARE = 1 / 20;

/**
 * How many nodes carried by one delta the screen must have shown for a sample (`motionShown`): two — one node's travel
 * is that node's, not a scroll view's. Measured live under idb: `carousel-in-list`'s B flung to the page's end left on
 * the screen only its top 16 pt, under the status band, and a 24-pt sliver of a card; their box put the turned strokes
 * at y 45, in the band, three moving nothing, where the screen box's stroke at y 175 brought B back.
 */
const CARRIED_TOGETHER = 2;

/**
 * THE REGION THE MOTION SHOWED (`MotionShown`), with the read `now` against the read before it (`before`): when both
 * list the target once, at the same size, moved more than SAME_WITHIN — on the axis it moved most on — every node
 * listed once in both that moved by the same delta (within CARRIED_SHARE) and kept its size is CARRIED WITH IT. Their
 * rects in both reads, each cut to that read's gesture box (below iOS's status band), are bounded — when the screen
 * showed CARRIED_TOGETHER of them — joined to `shown`'s (a motion on another axis starts again, its `way` too), and cut
 * at what held still (`stillCut`). Else `shown` as it is.
 * Why (lab note LV3): measured live, `tabbar-floating`'s R, T and F moved −1108 pt together under the first stroke while
 * the header and the tab buttons did not: T and R at the first read, cut above the buttons (24,300 354x455), are where
 * the list was seen scrolling, and the turned stroke over them touches down at y 391, inside it — not at 175, in the
 * header, where it moved nothing.
 */
function motionShown(shown: MotionShown | undefined, before: Listing | undefined, now: Listing): MotionShown | undefined {
  if (before === undefined || before.gesture === undefined || now.gesture === undefined || before.target !== now.target) return shown;
  const from = before.nodes.get(before.target)?.rect;
  const to = now.nodes.get(now.target)?.rect;
  if (from === undefined || to === undefined || !near(from.width, to.width) || !near(from.height, to.height)) return shown;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) <= SAME_WITHIN) return shown;
  const axis: ScrollAxis = Math.abs(dy) >= Math.abs(dx) ? 'vertical' : 'horizontal';
  const carriedWithin = Math.max(SAME_WITHIN, Math.hypot(dx, dy) * CARRIED_SHARE);
  const seen: Rect[] = [];
  let shownNodes = 0;
  for (const [key, { rect: a }] of before.nodes) {
    const b = now.nodes.get(key)?.rect;
    if (b === undefined || !near(b.x - a.x, dx, carriedWithin) || !near(b.y - a.y, dy, carriedWithin) || !near(a.width, b.width) || !near(a.height, b.height)) continue;
    const parts = [rectIntersection(a, before.gesture), rectIntersection(b, now.gesture)].filter((r): r is Rect => r !== undefined);
    seen.push(...parts);
    if (parts.length > 0) shownNodes++;
  }
  // One node's own travel is that node's, not its scroll view's (an animated element moves too): the screen must have
  // shown two carried together.
  if (shownNodes < CARRIED_TOGETHER) return shown;
  const same = shown !== undefined && shown.axis === axis ? shown : undefined;
  const kept = same === undefined ? [] : [same.rect];
  // What held still on the screen while the target moved, in both reads at one place — its size may change (a large
  // title collapsing in place is chrome all the same) — and drawn on the gesture box: a node of no area, or off the
  // box, held nothing still. Of these, the chrome cuts the region (`stillCut`), and a stop past one is held back
  // (`carriedUnder`).
  const still: QuotedNode[] = [];
  for (const [key, a] of before.nodes) {
    const b = now.nodes.get(key)?.rect;
    if (b !== undefined && near(a.rect.x, b.x) && near(a.rect.y, b.y) && rectIntersection(a.rect, now.gesture) !== undefined) still.push(a);
  }
  const way: Edge = same?.way ?? (axis === 'vertical' ? (dy < 0 ? 'top' : 'bottom') : dx < 0 ? 'left' : 'right');
  // Only what this sample adds is cut: what an earlier one showed stays (a still node that appears over it later — a
  // "scroll to top" button — cuts nothing it already showed).
  return { rect: boundsOf([...kept, stillCut(boundsOf([...kept, ...seen]), still.map((n) => n.rect), axis)]), axis, way, still };
}

/**
 * The CHROME among `still`, as `region` is cut at it: a node in a band across the rows — the still nodes beside it
 * along the axis reach the rows' middle line (a header's title), or cover more than half the region's width across (a
 * tab bar's buttons, even with none on that line) — lying wholly on one side of the region's middle along the axis (a
 * section index as long as the rows bounds no end). A node beside the rows alone in its band (a floating button, a
 * "scroll to top" button off to the side) is none: on `tabbar-floating`'s capture with a still button added at 330,480
 * beside the rows, cut at, it would hold R back while drawn at 317; a section index as long as the rows would leave the
 * region 25 pt tall.
 */
function chromeOf(still: readonly Rect[], region: Rect, axis: ScrollAxis): Rect[] {
  const across = (r: Rect): [number, number] => acrossOf(r, axis);
  const along = (r: Rect): [number, number] => alongOf(r, axis);
  const [c0, c1] = across(region);
  const line = (c0 + c1) / 2;
  // Only a node wholly on one side of the region's middle along the axis: one reaching across it (a window, a
  // background, a section index the rows' length) bounds no end of the region.
  const [m0, m1] = along(region);
  const mid = (m0 + m1) / 2;
  const nodes = still.filter((r) => !(along(r)[0] <= mid && mid < along(r)[1]));
  // How much of the region's width across the nodes of a band cover, overlaps counted once.
  const covered = (band: readonly Rect[]): number => {
    let total = 0;
    let reach = c0;
    for (const [a, b] of band.map(across).sort((p, q) => p[0] - q[0])) {
      const from = Math.max(a, reach);
      const to = Math.min(b, c1);
      if (to > from) total += to - from;
      reach = Math.max(reach, to);
    }
    return total;
  };
  return nodes.filter((r) => {
    const band = nodes.filter((o) => along(o)[0] < along(r)[1] && along(r)[0] < along(o)[1]);
    return band.some((o) => across(o)[0] <= line && line <= across(o)[1]) || covered(band) * 2 > c1 - c0;
  });
}

/**
 * `region` cut along `axis` at the chrome among what held STILL while the content moved (`chromeOf`): one in its first
 * half cuts it below the node, one in its second half above it; the cuts never cross. Why: idb lists a row carried under
 * a header where it would lie (lab note LE2) — measured live, R carried back to y 31 under `tabbar-floating`'s header
 * widened the region to 31 and the next touch-down landed at 179, in the header; cut below the title (110) and above
 * the tab buttons (755), it lands at 239, inside the list. A header with no node across the rows cuts nothing (ADR 0010
 * residual 6).
 */
function stillCut(region: Rect, still: readonly Rect[], axis: ScrollAxis): Rect {
  const [start, end] = alongOf(region, axis);
  let lo = start;
  let hi = end;
  // A chrome node past the region cuts nothing: max and min keep the region's own edge.
  for (const r of chromeOf(still, region, axis)) {
    const [from, to] = alongOf(r, axis);
    if ((from + to) / 2 < (start + end) / 2) lo = Math.max(lo, to);
    else hi = Math.min(hi, from);
  }
  return axis === 'vertical' ? { ...region, y: lo, height: hi - lo } : { ...region, x: lo, width: hi - lo };
}

/** A rect's extent along `axis` (where it lies on the scroll's line), and across it. */
const alongOf = (r: Rect, axis: ScrollAxis): [number, number] => (axis === 'vertical' ? [r.y, r.y + r.height] : [r.x, r.x + r.width]);
const acrossOf = (r: Rect, axis: ScrollAxis): [number, number] => (axis === 'vertical' ? [r.x, r.x + r.width] : [r.y, r.y + r.height]);

/** The least rect holding every one of `rects` (at least one). */
function boundsOf(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y };
}
