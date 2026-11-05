import type { Point } from '../../src/adapters/types.js';
import { pause } from './lab-device.js';
import { short } from './live-forms.js';
import { strokesSince, type LiveVerdict } from './live-visibility.js';
import { carouselReply, inferredAxisSaid, isError, replyKind, snapshotNodes, swipesOf, type CarouselReply } from './replies.js';
import type { Case } from './live-cases.js';
import { labId, labSelector, type LabState, type Rect } from './schema.js';
import { TOUCH_SLACK } from './truth.js';

/**
 * The carousel group (T7a, Android, the native lab app; `live.ts --groups carousel`): what the device batches proved
 * once each with a probe copied from batch to batch, as live cases — D62's drop and its control (lv-d62), D68's stop
 * from a fresh launch, D59b's strokes inside the carousel's band, D52's `unfit` on carousel-in-list (E2), and D37's
 * settled read on the snapping pagers. The app's own state is the oracle: C's frame against the carousel's clip
 * (LabState.frames, .scrollViews), its offsets and `carousel.index`, and the strokes it took (LabState.strokes).
 *
 * The harness additions, each small: a raw pre-drag before the call (`Case.preDrag`: the probes' 440-px, 1-s drag left
 * on the carousel, `preDrag`), a per-case "drop swipe N" hook on the Android adapter the registry builds
 * (`Case.dropSwipe`, `SwipeHook`, `hookSwipes`: the stroke never sent, resolved as drawn — batch-9's untaken reveal on
 * purpose), averi's every stroke logged into the record (RunRecord `swipes`), and the reply's kind
 * (replies.ts#carouselReply). The hard verdict on every `fully: true` case: never "fully visible" while C is still cut.
 */

/**
 * The cut the oracle forgives, in px: truth.ts's TOUCH_SLACK, the lab's one slack — a View's rect and the app's frame
 * may differ by a pixel or two (batch-12's CUT_TOL), far under the cuts the lab's carousels leave (17–44 px short at the
 * bound on carousel-recycler-free, 372 px in batch-9's false pass).
 */
export const CUT_TOLERANCE_PX = TOUCH_SLACK;

/** The lab's carousel clip on averi_lab (1080x2220): every L7 carousel cell's and carousel-in-list's `carousel`. */
export const LAB_CAROUSEL: Rect = { x: 66, y: 380, width: 948, height: 234 };

// --- the drop hook: averi's strokes logged, the Nth dropped ---

/** One stroke averi asked the adapter for during a case's calls — `dropped` when the hook kept it from the device. */
export interface SwipeEntry {
  from: Point;
  to: Point;
  durationMs?: number;
  dropped: boolean;
}

/** How long a dropped stroke takes when its call names no duration: an `input swipe`'s own default, so the loop's timing holds. */
export const DROP_DEFAULT_MS = 300;

/**
 * The per-case hook live.ts arms around a case's calls: every stroke averi draws is logged, and the `dropSwipe`th
 * (1-based, counted from the case's first call) is not sent — resolved after as long as it would have taken, so the
 * scroll loop is handed back the stroke it asked for, as batch-9's app did when it did not take the reveal. Disarmed,
 * it logs nothing and drops nothing.
 */
export class SwipeHook {
  private log: SwipeEntry[] | undefined;
  private drop: number | undefined;

  arm(dropSwipe?: number): void {
    this.log = [];
    this.drop = dropSwipe;
  }

  /** The case's strokes, and the hook disarmed. */
  disarm(): SwipeEntry[] {
    const log = this.log ?? [];
    this.log = undefined;
    this.drop = undefined;
    return log;
  }

  /** The entry for a stroke about to be drawn: logged when armed, `dropped` when it is the one to drop. */
  stroke(from: Point, to: Point, durationMs: number | undefined): SwipeEntry | undefined {
    if (this.log === undefined) return undefined;
    const entry: SwipeEntry = { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, ...(durationMs !== undefined && { durationMs }), dropped: this.log.length + 1 === this.drop };
    this.log.push(entry);
    return entry;
  }
}

/** What the hook wraps: an adapter's swipe (src/adapters/types.ts#DeviceAdapter.swipe). */
export interface Swiper {
  swipe(from: Point, to: Point, durationMs?: number): Promise<void>;
}

/**
 * The adapter with its `swipe` routed through `hook`, on the instance (the registry's factory, live.ts): a stroke the
 * hook drops is not sent and resolves after its duration (`wait`); every other one goes to the device as before.
 */
export function hookSwipes<A extends Swiper>(adapter: A, hook: SwipeHook, wait: (ms: number) => Promise<unknown> = pause): A {
  const send = adapter.swipe.bind(adapter);
  adapter.swipe = async (from: Point, to: Point, durationMs?: number) => {
    if (hook.stroke(from, to, durationMs)?.dropped === true) {
      await wait(durationMs ?? DROP_DEFAULT_MS);
      return;
    }
    await send(from, to, durationMs);
  };
  return adapter;
}

// --- the pre-drag ---

/** The raw stroke a case's pre-drag drew (RunRecord `preDrag`), with the state the launch left before it. */
export interface PreDragged {
  from: Point;
  to: Point;
  durationMs: number;
  launch: LabState;
}

/** How long the pre-drag takes (slow: no fling) and how long the carousel is left to settle after it. */
export const PRE_DRAG_MS = 1_000;
export const PRE_DRAG_SETTLE_MS = 1_200;

/** A point on the clip's mid-line, `along` its width (0 its left edge, 1 its right), in whole px: the probes' strokes. */
export const onMidLine = (clip: Rect, along: number): Point => ({ x: Math.round(clip.x + clip.width * along), y: Math.round(clip.y + clip.height / 2) });

/**
 * The probes' pre-drag (D52's E2, D59's, lv-d62's): a slow drag left along the clip's middle, from 85 % of its width,
 * `px` long — C left cut at the clip's right edge.
 */
export function preDragStroke(clip: Rect, px: number): { from: Point; to: Point; durationMs: number } {
  const from = onMidLine(clip, 0.85);
  return { from, to: { x: from.x - px, y: from.y }, durationMs: PRE_DRAG_MS };
}

/** What the pre-drag needs of the lab: a raw stroke (lab-device.ts#AndroidLab.swipe) and the app's state. */
export interface PreDragLab {
  swipe(from: Point, to: Point, durationMs: number): Promise<void>;
  state(): Promise<LabState | undefined>;
}

/**
 * The pre-drag on the carousel the launch reported, then the state the calls start from: read once it settled, and
 * the launch's own cell — else it throws (a pre-drag that left the app is no premise for any case), and
 * preDragOrSkip makes that the case's SKIP.
 */
export async function preDrag(lab: PreDragLab, launch: LabState, px: number, wait: (ms: number) => Promise<unknown> = pause): Promise<{ preDrag: PreDragged; launched: LabState }> {
  const clip = launch.scrollViews?.carousel;
  if (clip === undefined) throw new Error(`cell ${launch.cell}: the launch state reports no carousel scroll view to pre-drag`);
  const stroke = preDragStroke(clip, px);
  await lab.swipe(stroke.from, stroke.to, stroke.durationMs);
  await wait(PRE_DRAG_SETTLE_MS);
  const launched = await lab.state();
  if (launched?.cell !== launch.cell) throw new Error(`cell ${launch.cell}: after the pre-drag the app reports ${launched === undefined ? 'no state' : `cell ${launched.cell}`}`);
  return { preDrag: { ...stroke, launch }, launched };
}

/**
 * preDrag for live.ts: a pre-drag that fails (adb, the lab gone, no carousel) is that case's SKIP with the reason,
 * never the whole run thrown out — on lv-d62's legs `skipFails` then fails the run, honestly.
 */
export async function preDragOrSkip(lab: PreDragLab, launch: LabState, px: number, wait?: (ms: number) => Promise<unknown>): Promise<{ preDrag: PreDragged; launched: LabState } | { skip: string }> {
  try {
    return await preDrag(lab, launch, px, wait);
  } catch (e) {
    return { skip: `the pre-drag failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// --- the oracle ---

/** How far the app's C runs past the carousel's clip on each side (0: not past it), or undefined with no frame or clip. */
export function cutOf(s: LabState): { left: number; right: number } | undefined {
  const c = s.frames.C;
  const clip = s.scrollViews?.carousel;
  if (c === undefined || clip === undefined) return undefined;
  return { left: Math.max(0, clip.x - c.x), right: Math.max(0, c.x + c.width - (clip.x + clip.width)) };
}

/** The lab reported no carousel clip: nothing to judge C against (the judges SKIP, never MISMATCH). */
export const NO_CLIP = 'the lab reported no carousel clip';
const hasClip = (s: LabState) => s.scrollViews?.carousel !== undefined;

/** C is cut in the app (or not laid out at all): more than CUT_TOLERANCE_PX past the clip on a side. Asked only with a clip. */
export function isCut(s: LabState): boolean {
  const cut = cutOf(s);
  return cut === undefined || Math.max(cut.left, cut.right) > CUT_TOLERANCE_PX;
}

const cutText = (s: LabState): string => {
  const cut = cutOf(s);
  return cut === undefined ? 'C not laid out' : `C cut L ${cut.left} R ${cut.right}`;
};

/** The carousel's strokes the app took since `launched`. */
const carouselStrokes = (s: LabState, launched: LabState) => strokesSince(s, launched).filter((x) => x.view === 'carousel');

/** The app's state behind a carousel verdict: C against the clip, the offset, the resting card and the strokes taken. */
const appText = (s: LabState, launched: LabState): string =>
  `${cutText(s)}; offset ${s.offsets?.carousel ?? '?'}, index ${s.offsets?.['carousel.index'] ?? '-'}; ${carouselStrokes(s, launched).length} carousel stroke(s) since the call`;

// --- the judges ---

/** What a carousel judge reads beyond a case's reads: the strokes averi drew (RunRecord `swipes`). */
export interface DeviceLog {
  swipes?: readonly SwipeEntry[];
}

export type CarouselJudge = Case['judge'];

/**
 * A reply kind accepted, not expected: ok, and counted under its residual (live-cases.ts#summarize) — known by its
 * `id` (the hedged ceiling compares ids), said by its `residual` (live-known.ts's wording).
 */
export interface Accepted {
  id: string;
  kind: CarouselReply;
  residual: string;
}

/** The share of D68_SPREAD's runs ADR 0021's D68 amendment measured hedged: 3 of batch-10's 10 (runs 0, 5, 6). */
export const HEDGED_RATE = 0.3;

/** ADR 0021's D68 residual: the room at the bound within a pixel of the least carry keeps `maxSwipes`, hedged (~3 in 10). */
export const D68_SPREAD: Accepted = {
  id: 'D68-spread',
  kind: 'maxSwipes-hedged',
  residual: 'residual:ADR 0021 D68 — the room left at the bound within a pixel of the least carry keeps maxSwipes, hedged: measured ~3 in 10 (batch-10 runs 0, 5, 6)',
};

/** What a `fully: true` carousel case expects. */
export interface FullyExpect {
  /** The reply kinds that are ok. */
  kinds: readonly CarouselReply[];
  /** A kind accepted under a residual: ok, counted. */
  accepted?: Accepted;
  /** An unfit reply says the inferred axis (true: the tree told none, D59) or does not (false: a told axis, D52). */
  inferred?: boolean;
  /** An ok reply took at most this many swipes. */
  atMostSwipes?: number;
  /** Premise: C cut at the clip before the call (a pre-drag case). */
  cutBefore?: true;
  /** Premise: the call's swipe N was dropped, and the app took every stroke sent (the drop held, nothing lost). */
  dropped?: number;
  /** D59b: every stroke drawn inside the carousel's band, and the carousel took one at least. */
  inBand?: true;
}

/** Why the stroke after the `dropped`th is not that stroke sent again (D62's retry), or undefined when it is. */
function noRetry(swipes: readonly SwipeEntry[], dropped: number): string | undefined {
  const [held, next] = [swipes[dropped - 1], swipes[dropped]];
  if (next === undefined) return 'no stroke after the dropped one';
  const near = (p: Point, q: Point) => Math.abs(p.x - q.x) <= CUT_TOLERANCE_PX && Math.abs(p.y - q.y) <= CUT_TOLERANCE_PX;
  if (near(held.from, next.from) && near(held.to, next.to)) return undefined;
  const text = (s: SwipeEntry) => `(${s.from.x},${s.from.y})→(${s.to.x},${s.to.y})`;
  return `stroke ${dropped + 1} is not the dropped reveal sent again (${text(next)}, not ${text(held)})`;
}

/**
 * A carousel `scroll_until … fully: true` judged against the app: "fully visible" while C is cut is the hard MISMATCH
 * (`fully-cut`), checked before any premise — a false claim is false whatever the run's set-up; "fully visible" with C
 * whole is ok. Then the premises (SKIP when not shown), the band (D59b; LOUD `off-band`), and the kind: expected → ok,
 * accepted under a residual → ok and counted, any other → LOUD `carousel-kind` (honest, not what the case was built for).
 */
export function judgeFully(expect: FullyExpect): CarouselJudge {
  return (state, [reply], _source, launched, _after, log) => {
    const kind = carouselReply(reply);
    const app = appText(state, launched);
    const base = { app, kind: replyKind(reply) };
    if (!hasClip(state) || ((expect.cutBefore === true || expect.inBand === true) && !hasClip(launched))) return { ...base, outcome: 'SKIP', why: NO_CLIP };
    if (kind === 'fully-visible') {
      return isCut(state)
        ? { ...base, outcome: 'MISMATCH', cls: 'fully-cut', why: `"fully visible" while ${cutText(state)} (the app 800 ms after): ${short(reply)}` }
        : { ...base, outcome: 'ok', why: `fully visible, and C whole in the app: ${short(reply)}` };
    }
    if (expect.cutBefore === true && !isCut(launched)) return { ...base, outcome: 'SKIP', why: `C not cut before the call (${cutText(launched)}): the pre-drag left no cut to judge` };
    if (expect.dropped !== undefined) {
      const swipes = log?.swipes;
      if (swipes === undefined) return { ...base, outcome: 'SKIP', why: 'no stroke log: the drop unshown' };
      if (swipes[expect.dropped - 1]?.dropped !== true) return { ...base, outcome: 'SKIP', why: `the call drew ${swipes.length} stroke(s): no stroke ${expect.dropped} dropped` };
      const sent = swipes.filter((s) => !s.dropped).length;
      const taken = carouselStrokes(state, launched).length;
      if (taken !== sent) return { ...base, outcome: 'SKIP', why: `the app took ${taken} carousel stroke(s) of the ${sent} sent: the drop not shown to hold` };
      // D62's retry (flush-check.ts: a held reveal after a carried proof is doubted and "the same reveal is sent again"):
      // the stroke after the dropped one is that reveal, its points within CUT_TOLERANCE_PX.
      const retry = noRetry(swipes, expect.dropped);
      if (retry !== undefined) return { ...base, outcome: 'LOUD', cls: 'no-retry', why: `no retry seen: ${retry}: ${short(reply)}` };
    }
    if (expect.inBand === true) {
      const swipes = log?.swipes;
      const clip = launched.scrollViews?.carousel;
      if (swipes === undefined || clip === undefined) return { ...base, outcome: 'SKIP', why: swipes === undefined ? 'no stroke log: the band unjudged' : 'no carousel clip at launch: the band unjudged' };
      const inside = (p: Point) => p.y >= clip.y && p.y <= clip.y + clip.height;
      const off = swipes.filter((s) => !(inside(s.from) && inside(s.to)));
      if (off.length > 0) return { ...base, outcome: 'LOUD', cls: 'off-band', why: `${off.length} of ${swipes.length} stroke(s) drawn outside the carousel's band y ${clip.y}–${clip.y + clip.height} (e.g. (${off[0].from.x},${off[0].from.y})→(${off[0].to.x},${off[0].to.y})): ${short(reply)}` };
      if (carouselStrokes(state, launched).length === 0) return { ...base, outcome: 'LOUD', cls: 'off-band', why: `the carousel took no stroke: ${short(reply)}` };
    }
    if (expect.kinds.includes(kind)) {
      const swipes = swipesOf(reply);
      if (kind === 'unfit' && expect.inferred !== undefined && inferredAxisSaid(reply) !== expect.inferred) {
        return { ...base, outcome: 'LOUD', cls: 'carousel-kind', why: `unfit ${expect.inferred ? 'without' : 'with'} the inferred-axis clause: ${short(reply)}` };
      }
      if (expect.atMostSwipes !== undefined && (swipes === undefined || swipes > expect.atMostSwipes)) {
        return { ...base, outcome: 'LOUD', cls: 'carousel-kind', why: `${kind} after ${swipes ?? '?'} swipes, more than ${expect.atMostSwipes}: ${short(reply)}` };
      }
      return { ...base, outcome: 'ok', why: `${kind}, ${cutText(state)}: ${short(reply)}` };
    }
    if (expect.accepted?.kind === kind) return { ...base, outcome: 'ok', accepted: expect.accepted, why: `${kind}, accepted and counted (${expect.accepted.residual}), ${cutText(state)}: ${short(reply)}` };
    return { ...base, outcome: 'LOUD', cls: 'carousel-kind', why: `${kind}, not ${expect.kinds.join(' or ')}: ${short(reply)}` };
  };
}

/**
 * D37's settled read on a snapping pager (D10, ADR 0021 decision 7): one stroke through averi's `swipe`, then a filtered
 * `ui_snapshot` — the first read after it must list C where the app comes to rest: at the clip (± CUT_TOLERANCE_PX) when
 * the pager rests on C (`carousel.index` 1), else absent or wholly outside the clip. A read that disagrees is a
 * MISMATCH (`unsettled-read`: averi read the pager mid-motion as settled). SKIP when the premises fail: the clip not
 * the one the stroke was drawn for, no resting index, an offset that is no whole card (still moving at the read), or
 * no stroke taken.
 */
export function judgeSettledRead(cell: string): CarouselJudge {
  return (state, [swiped, snapshot], _source, launched) => {
    const app = appText(state, launched);
    const clip = launched.scrollViews?.carousel;
    const base = { app, kind: replyKind(snapshot ?? '') };
    if (isError(swiped)) return { ...base, outcome: 'LOUD', cls: 'carousel-kind', why: `the swipe failed: ${short(swiped)}` };
    if (clip === undefined || JSON.stringify(clip) !== JSON.stringify(LAB_CAROUSEL)) return { ...base, outcome: 'SKIP', why: `the clip is ${JSON.stringify(clip)}, not the lab's ${JSON.stringify(LAB_CAROUSEL)} the stroke was drawn for` };
    const index = state.offsets?.['carousel.index'];
    const offset = state.offsets?.carousel;
    if (index === undefined || offset === undefined) return { ...base, outcome: 'SKIP', why: 'the app wrote no carousel.index or offset' };
    const off = offset % clip.width;
    if (Math.min(off, clip.width - off) > CUT_TOLERANCE_PX) return { ...base, outcome: 'SKIP', why: `the resting offset ${offset} is no whole card (${clip.width}): still moving at the read` };
    if (carouselStrokes(state, launched).length === 0) return { ...base, outcome: 'SKIP', why: 'the pager took no stroke' };
    const nodes = snapshotNodes(snapshot ?? '');
    if (nodes === undefined) return { ...base, outcome: 'LOUD', cls: 'carousel-kind', why: `no snapshot: ${short(snapshot ?? '')}` };
    const c = nodes.find((n) => n.identifier === labId(cell, 'C'))?.rect;
    const where = c === undefined ? 'C absent' : `C at x ${c.x} w ${c.width}`;
    if (index === 1) {
      const atClip = c !== undefined && Math.abs(c.x - clip.x) <= CUT_TOLERANCE_PX && Math.abs(c.width - clip.width) <= CUT_TOLERANCE_PX;
      return atClip ? { ...base, outcome: 'ok', why: `at rest on C (index 1), the first read lists ${where}` } : { ...base, outcome: 'MISMATCH', cls: 'unsettled-read', why: `at rest on C (index 1), but the first read lists ${where}, not at the clip x ${clip.x} w ${clip.width}` };
    }
    const outside = c === undefined || (index === 0 ? c.x >= clip.x + clip.width - CUT_TOLERANCE_PX : c.x + c.width <= clip.x + CUT_TOLERANCE_PX);
    return outside ? { ...base, outcome: 'ok', why: `at rest on card ${index}, the first read lists ${where}` } : { ...base, outcome: 'MISMATCH', cls: 'unsettled-read', why: `at rest on card ${index}, but the first read lists ${where}, inside the clip` };
  };
}

// --- the cases ---

/** A carousel case as live-cases.ts takes it (its Case, less the group): its pre-drag and drop are data, recorded. */
export interface CarouselCase {
  id: string;
  cell: string;
  says: string;
  platforms: readonly ['android'];
  /** A raw pre-drag of this many px before the calls (`preDrag`). */
  preDrag?: number;
  /** The call's Nth stroke dropped (SwipeHook). */
  dropSwipe?: number;
  /** A SKIP fails the run (live-cases.ts#summarize): lv-d62's premises are the harness's own — a SKIP there means it broke. */
  skipFails?: true;
  calls: { tool: 'scroll_until' | 'swipe' | 'ui_snapshot'; args: Record<string, unknown> }[];
  judge: CarouselJudge;
}

const RECYCLER_FREE = 'carousel-recycler-free';
const LAZY_FREE = 'carousel-lazy-free';
const fullyC = (cell: string, direction: 'left' | 'right') => ({ tool: 'scroll_until' as const, args: { selector: `id:${labId(cell, 'C')}`, direction, fully: true } });
/** The probes' pre-drag length, px. */
export const PRE_DRAG_PX = 440;
/** D37's stroke: across 60 % of the lab's clip at its middle, forward (the finger left), 300 ms — d37-snap's short one. */
const snapStroke = (() => {
  const [from, to] = [onMidLine(LAB_CAROUSEL, 0.8), onMidLine(LAB_CAROUSEL, 0.2)];
  return { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, durationMs: 300 };
})();

export const CAROUSEL_CASES: readonly CarouselCase[] = [
  {
    id: 'lv-d62-control',
    cell: RECYCLER_FREE,
    platforms: ['android'],
    preDrag: PRE_DRAG_PX,
    skipFails: true,
    says: 'D62/D68 control: after the 440-px pre-drag, fully: true left on the RecyclerView card: `unaimable` (hedged maxSwipes accepted, counted: ADR 0021 D68), never "fully visible" with C cut',
    calls: [fullyC(RECYCLER_FREE, 'left')],
    judge: judgeFully({ kinds: ['unaimable'], accepted: D68_SPREAD, cutBefore: true }),
  },
  {
    id: 'lv-d62-drop',
    cell: RECYCLER_FREE,
    platforms: ['android'],
    preDrag: PRE_DRAG_PX,
    dropSwipe: 2,
    skipFails: true,
    says: "D62: the same with the call's second stroke (its first reveal) dropped, resolved as drawn: maxSwipes hedged (\"may still be cut\"), never \"fully visible\" with C cut",
    calls: [fullyC(RECYCLER_FREE, 'left')],
    judge: judgeFully({ kinds: ['maxSwipes-hedged'], cutBefore: true, dropped: 2 }),
  },
  {
    id: 'lv-d68-launch',
    cell: RECYCLER_FREE,
    platforms: ['android'],
    says: 'D68: from a fresh launch, fully: true right on the RecyclerView card: `unaimable` (hedged maxSwipes accepted, counted), never "fully visible" with C cut',
    calls: [fullyC(RECYCLER_FREE, 'right')],
    judge: judgeFully({ kinds: ['unaimable'], accepted: D68_SPREAD }),
  },
  {
    id: 'lv-d59b-lazy',
    cell: LAZY_FREE,
    platforms: ['android'],
    says: "D59b/D59: from a fresh launch (C not in the tree), fully: true right on the LazyRow card: every stroke inside the carousel's band, which takes them; `unfit` with the inferred-axis clause",
    calls: [fullyC(LAZY_FREE, 'right')],
    judge: judgeFully({ kinds: ['unfit'], inferred: true, inBand: true }),
  },
  // The same call as lv-d68-launch, kept as its own case: the second sample of the hedged ceiling (UNAIMABLE_LEGS).
  {
    id: 'lv-d59b-recycler',
    cell: RECYCLER_FREE,
    platforms: ['android'],
    says: "D59b/D68: the same on the RecyclerView card: every stroke inside the band, which takes them; `unaimable` (hedged maxSwipes accepted, counted)",
    calls: [fullyC(RECYCLER_FREE, 'right')],
    judge: judgeFully({ kinds: ['unaimable'], accepted: D68_SPREAD, inBand: true }),
  },
  {
    id: 'd52-e2',
    cell: 'carousel-in-list',
    platforms: ['android'],
    preDrag: PRE_DRAG_PX,
    says: 'D52 E2: after the 440-px pre-drag, fully: true left on carousel-in-list\'s card (a told axis): `unfit` within 3 swipes, no inferred-axis clause',
    calls: [fullyC('carousel-in-list', 'left')],
    judge: judgeFully({ kinds: ['unfit'], inferred: false, atMostSwipes: 3, cutBefore: true }),
  },
  ...(['carousel-lazy', 'carousel-recycler'] as const).map((cell) => ({
    id: `d37-snap-${cell.slice('carousel-'.length)}`,
    cell,
    platforms: ['android'] as const,
    says: `D37: one 300-ms stroke forward on the snapping ${cell === 'carousel-lazy' ? 'LazyRow' : 'RecyclerView'} pager, then ui_snapshot C: the first read lists C where the pager comes to rest (carousel.index)`,
    calls: [
      { tool: 'swipe' as const, args: snapStroke },
      { tool: 'ui_snapshot' as const, args: { filter: labSelector(cell, 'C') } },
    ],
    judge: judgeSettledRead(cell),
  })),
];

// --- the hedged ceiling (review round 1, the owner's) ---

/** The legs that expect `unaimable` and accept the hedged bound (D68_SPREAD): the ceiling's samples, one a run each. */
export const UNAIMABLE_LEGS: readonly string[] = ['lv-d62-control', 'lv-d68-launch', 'lv-d59b-recycler'];

/** The fewest judged legs the ceiling is judged on: at HEDGED_RATE a leg, all three hedged by chance is 0.3³ ≈ 2.7 %. */
export const CEILING_MIN_LEGS = 3;

/** A run's result as the ceiling reads it (live-cases.ts#Result: its case's id, its verdict). */
export interface CeilingResult {
  c: { id: string };
  verdict: Pick<LiveVerdict, 'outcome' | 'accepted'>;
}

/** `p` as a percentage, two significant digits: 2.7, 0.81. */
const percent = (p: number) => `${Number((p * 100).toPrecision(2))} %`;

/**
 * The ceiling on D68_SPREAD's acceptance (live-cases.ts#summarize hands it the run's results): ADR 0021's D68
 * amendment measured the hedged bound on ~3 in 10 of the unaimable legs (HEDGED_RATE), so a run whose every judged leg
 * (not SKIP) ended hedged — CEILING_MIN_LEGS or more — reads as D68's stop reverted, not as chance (about 2.7 % with
 * three; the 3 planned runs, 9 legs, make it negligible): MISMATCH-class, the run fails (`fails`; held only in a run of
 * this checkout — a `--side` one is a calibration). Fewer judged — any leg selected, even every one SKIPped: LOUD
 * (`loud`, counted in the summary's tally), no pass claimed, the exit untouched. "hedged N of M" whenever a leg was in
 * the run; no line when none was.
 */
export function hedgedCeiling(results: readonly CeilingResult[], ofThisCheckout: boolean): { lines: string[]; fails: boolean; loud: boolean; hedged: number; judged: number } {
  const legs = results.filter((r) => UNAIMABLE_LEGS.includes(r.c.id));
  const judgedLegs = legs.filter((r) => r.verdict.outcome !== 'SKIP');
  const hedged = judgedLegs.filter((r) => r.verdict.accepted?.id === D68_SPREAD.id).length;
  const judged = judgedLegs.length;
  const said = (line: string, more: { fails?: true; loud?: true } = {}) => ({ lines: [line], fails: more.fails === true, loud: more.loud === true, hedged, judged });
  const count = `hedged ${hedged} of ${judged} judged unaimable leg(s)`;
  if (legs.length === 0) return { lines: [], fails: false, loud: false, hedged, judged };
  if (!ofThisCheckout) return said(`Hedged ceiling: ${count} — a --side run, a calibration: not held`);
  if (judged < CEILING_MIN_LEGS) return said(`LOUD (hedged ceiling): ${count} — fewer than ${CEILING_MIN_LEGS} judged, the ceiling unjudged (no pass claimed)`, { loud: true });
  if (hedged === judged) {
    return said(
      `MISMATCH (hedged ceiling): ${count} — ADR 0021's D68 amendment measured the hedged bound on ~3 in 10 (batch-10 runs 0, 5, 6), ` +
        `and all ${judged} hedged by chance is about ${percent(HEDGED_RATE ** judged)} (the 3 planned runs (9 legs) make chance negligible): D68's unaimable stop looks reverted — the run fails`,
      { fails: true },
    );
  }
  return said(`Hedged ceiling: ${count} — within ADR 0021's measured ~3 in 10`);
}
