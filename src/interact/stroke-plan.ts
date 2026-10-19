import { sameRect, type Point, type Rect, type Stroke, type UiNode } from '../adapters/types.js';
import { containsPoint, quoted, rectIntersection, type QuotedNode, type ScrollAxes } from '../ui-tree/geometry.js';
import type { PresentedPress } from '../ui-tree/presentation.js';
import type { KeyboardLine } from '../ui-tree/keyboard-position.js';
import type { TreeFacts } from './scroll-read.js';
import { axisOf, EDGE_TOWARD, shortenStroke, strokeLength, SWIPE_REACH_FRACTION, swipeVector, swipeVectorAbove, TOUCH_SLOP, type Direction } from './swipe.js';

/**
 * `scroll_until`'s STROKE PLAN: of one round, which scroll view the stroke goes over, the box it is drawn in, the
 * cover it keeps clear of, the points the driver sends — and what lies at its touch-down — decided in one place.
 * Until the round-21 architecture pass (A1) that answer was put together in five: scroll-rounds.ts chose the
 * candidates (`strokeCandidates`, `targetScrollers`), decided the step (`plannedStroke`), turned the step into points a
 * second time to ask the scene what lay at the touch-down (`presentedTouchDown`) and asked the draw order again at the
 * fast fail (`touchedOn`); swipe.ts judged the room (`strokeRoom`, `strokeBox`) and made the points
 * (`scrollStroke`); and the driver (interact/scroll.ts) made the same points a third time from the step it was handed.
 * Now the round asks the plan once a round and the driver sends the points the plan made — the points the
 * touch-down question was asked at ARE the points sent, by construction, not by two calls of one pure function that
 * had to be kept in step.
 *
 * The interface, which is also the test surface (tests/interact/stroke-plan.test.ts):
 * - `startStrokes()` — the plan's memory before any read; `seeRead(memory, read)` — what one read that read leaves
 *   for the strokes after it: the keyboard line its strokes stay above, and, when it found the target, the target's
 *   scroll views with what that read draws over each. One call a read that read; the round holds the memory and
 *   reads none of it.
 * - `planStroke(memory, ask)` — the stroke toward the target this round would draw (`toward` and `reach` are the
 *   round's course, `round`'s to decide), over this round's gesture box, with this round's facts or none: the
 *   `PlannedStroke` (its points among it), the presented surface its touch-down lies on (`PresentedTouchDown`, asked
 *   of the scene at the points as sent: ui-tree/standing.ts#Scene.presentedAt), and ONE memory to keep whatever the
 *   round does with the stroke (held for a presented screen's confirming read, held back at a bound, or sent).
 * - `planProbe(memory, ask)` — the `fully: true` flush check's probe (scroll-rounds.ts#PROBE_REACH): over the first of
 *   the given scroll views with room, never the screen box — undefined when none has room.
 * - `strokeSent(memory)` — the plan's stroke (or probe) was sent: the scroll view it chose becomes the one the last
 *   stroke went over (for `touchedOn`). The one thing the round adds to a plan's memory, and only on sending: a plan
 *   held for a confirming read keeps the candidates it judged, never the scroll view it would have gone over.
 * - `touchedOn(memory, facts, drawn)` — the node drawn over the container the last stroke sent went over that its
 *   touch-down hit (ui-tree/draw-order.ts#DrawOrder.drawnOverAt), for the fast fail's sentence.
 *
 * Presentation is asked through its interface — `Scene.presentedAt` and the draw order's `drawnOver` / `drawnOverAt` —
 * whose facts ui-tree/presentation.ts owns (one adapter per tree source); the plan reads no mark, no shape and no
 * window of its own.
 *
 * WHICH SCROLL VIEW, and the axis. The candidates are the target's scroll views, nearest first (`targetScrollers`),
 * once a read has found it; before that the screen's largest scroller; none (the screen box) when the target was found
 * in none. Each is remembered with its AXIS and its nested scroll views' (`ScrollView.axes`, asked of the read's tree:
 * ui-tree/geometry.ts#Clips.axesOf, per source ui-tree/scroll-containers.ts#scrollAxis — Android's class, WDA's
 * `Table`, else on WDA the content's extent past the frame; unknown for a Compose lazy list, a RecyclerView and on idb,
 * which lists no scroll view). The stroke box (`strokeRoom`) takes the first with room for the stroke as drawn
 * (`toward`) above the keyboard and what is drawn over it, among those that scroll ALONG the stroke or whose axis the
 * tree cannot tell — a card of a horizontal carousel nested in a vertical page, scrolled for `down`, is stroked over
 * the page, not vertically inside the carousel; and inside the one taken, the stroke's path keeps off every nested
 * scroll view that scrolls only ACROSS it (`clearLane`: the page's content-down touch-down on a carousel is moved to
 * the longest stretch of the page clear of it — at a cost: the stroke is the stretch's 60 %, not the page's, 312 pt of
 * travel for 416 on the note's geometry, so more rounds against the swipe and time budget). The fallbacks, stated: no
 * candidate along the stroke with room — the pick as before the axis (the nearest with room, whatever its axis: a card
 * of a carousel no vertical list holds, scrolled for `down`, is still stroked inside the carousel, mp-native's Account
 * Detail as captured); no stretch clear of a cross-axis scroll view with room, or none the cut for what is drawn over
 * it leaves room in — the stroke as before, over it (`roomAmong`); the probe (`planProbe`) never goes over a scroll
 * view that scrolls only across it (none sent, rather than a probe that moves nothing and is read as checked; a chain
 * of such scroll views alone is unchecked for its own reason, `probeAcrossOnly`, `flush.why: 'axis'`). Why: a gesture
 * belongs to the view the finger first touches, and a carousel touched down on by a vertical drag hands the outer list
 * part of it at most (~51 pt a stroke on iOS, inferred; the stroke keeps off it, so still unmeasured) —
 * docs/bugs/2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md, its residual. The lab's
 * `carousel-in-list`: on Android the carousel is a `HorizontalScrollView`, its
 * axis known from its class, and the page's strokes for B (below) and U (above) now keep off it — over the stretch
 * below it (B's `540 1899 → 935`, U's the reverse), where U's content-up stroke over the whole page touched down on it
 * on an earlier replay (y 444, inside `66,380 948x234` — inferred from its touch-down at the page's 0.2, not
 * recorded); C, the card past the carousel's right clip, is never stroked there, uiautomator dumping it as a strip at
 * the screen's edge that averi stops on at once (lab finding LE1,
 * docs/bugs/2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md). Captured on iOS
 * (tests/fixtures/wda-capture-lab-carousel-in-list.json): under WDA the stroke for C (`right`) goes
 * INSIDE the carousel (24,138 354x85), along its axis — the full stroke `307 181 → 95 181`, the first one cut by the
 * carry model to `307 181 → 181 181` (UNMEASURED_CARRY). ADR 0010
 * (docs/adr/0010-pixel-assert-keyboard-first.md) records both stroke rules: the candidates — the target's own scroll
 * views, nearest first (round 21's step 0a) — and their axis (round 22). What else this module holds is A1's move of
 * the round's five pieces into one, which changed no stroke.
 *
 * Pure: no adapter, no clock, no I/O.
 */

/** A scroll view a stroke may go over, as one value (they move together): its rect, the rects drawn over it at the read that chose it — the stroke box's cut (`strokeRoom`) — and its axes. A later read that still holds a scroll view of that rect gives its own; one that does not (the list moved — measured on Account Detail, 0,825 → 0,401) keeps these, so a remembered scroll view is not stroked as if nothing were over it. */
interface ScrollView {
  rect: Rect;
  over: readonly Rect[];
  /** Its axis and its nested scroll views' (ui-tree/geometry.ts#Clips.axesOf), at the read that chose it — kept and refreshed as `over` is: a later read that lost the rect keeps these. Undefined when no read held it. */
  axes: ScrollAxes | undefined;
}

declare const opaque: unique symbol;

/** What the plan remembers between reads — opaque: only this module reads it (the fields are `Memory`'s). */
export interface StrokeMemory {
  readonly [opaque]: 'stroke-plan';
}

interface Memory {
  /**
   * The target's scroll views (`targetScrollers`), nearest first, each with what is drawn over it, at the last read
   * that found the target — refreshed by every plan with that round's read (`planStroke`: the latest cut, not the
   * oldest, is the one a read that has lost a rect falls back to); undefined until a read finds the target. Kept
   * across reads that do not find it.
   */
  readonly target: readonly ScrollView[] | undefined;
  /** The candidates the last plan judged its stroke's scroll view from, for the stroke of a round whose tree did not read — judged again with that round's gesture box, cut by the rects they carry. */
  readonly last: readonly ScrollView[];
  /** The keyboard line the last read that READ stroked above (scroll-read.ts#strokeLine: the cover it applied — none when it applied none — and idb's band), for the stroke of a round whose tree did not read. */
  readonly line: KeyboardLine | undefined;
  /** The scroll view the last stroke SENT went over, a probe's included — undefined when it went over the gesture box whole — for `touchedOn`. */
  readonly within: Rect | undefined;
  /** The scroll view the last plan chose (undefined: the gesture box whole), which `strokeSent` makes `within`. */
  readonly chosen: Rect | undefined;
  /** The carry model's measure (`carried`): the most a stroke of this scroll over the scroll view `within` (undefined: the gesture box whole) carried its target per point of finger travel; undefined until one did (UNMEASURED_CARRY stands in, `carryOver`). */
  readonly carry: { readonly within: Rect | undefined; readonly perPoint: number } | undefined;
}

const open = (m: StrokeMemory): Memory => m as unknown as Memory;
const close = (m: Memory): StrokeMemory => m as unknown as StrokeMemory;

/** The memory before any read: no scroll view known, no keyboard line, no stroke sent. */
export function startStrokes(): StrokeMemory {
  return close({ target: undefined, last: [], line: undefined, within: undefined, chosen: undefined, carry: undefined });
}

/** One read that read, as the plan keeps it (`seeRead`): its facts, the line its strokes stay above (scroll-read.ts#ReadJudgement.strokeLine), and the target's node when it judged one. */
export interface SeenRead {
  readonly facts: Pick<TreeFacts, 'scene'>;
  readonly line: KeyboardLine | undefined;
  readonly target: UiNode | undefined;
}

/**
 * What a read that read leaves for the strokes after it: its keyboard line, and — when it found the target — every
 * scroll view of the target (`targetScrollers`) with what this read draws over each. Their room is judged by each
 * plan, for the stroke as drawn — `toward`, which a fling past the target or a dropped target turns against the
 * caller's direction — and with that round's cover (judged for the caller's direction alone, a strip whose lower half
 * a bar covers has no room going down, and the turned content-up stroke would go over the screen box, touching down
 * off the strip that has room going up). None with room is the screen box: the last read's scroll view is not kept —
 * it is stale, and may be another list — nor is the screen's largest scroller taken: a largest scroller with room
 * that is not one of the target's ancestors is a list that cannot hold the target.
 */
export function seeRead(memory: StrokeMemory, { facts, line, target }: SeenRead): StrokeMemory {
  const m = open(memory);
  return close({
    ...m,
    line,
    ...(target !== undefined && { target: targetScrollers(facts, target).map((rect) => ({ rect: { ...rect }, over: overIn(facts, rect) ?? [], axes: facts.scene.clips.axesOf(rect) })) }),
  });
}

/** What a round asks of the plan for its stroke toward the target. */
export interface StrokeAsk {
  /** Where the content lies for this stroke — the round's course (scroll-rounds.ts#nextStroke). */
  readonly toward: Direction;
  /** Its reach, 1 until the first turn, halved by each (swipe.ts#shortenStroke). */
  readonly reach: number;
  /** This round's gesture box (scroll-rounds.ts#RoundSeen.screen's `oriented`); undefined when it has none — no box, no points. */
  readonly gesture: Rect | undefined;
  /** This round's read, when its tree read: the facts, and the judged target's node — the presented question is asked on its behalf, or, undefined, on behalf of none. */
  readonly read: { readonly facts: Pick<TreeFacts, 'scene' | 'mainScroller'>; readonly target: UiNode | undefined } | undefined;
  /** What the target still needs of this stroke, when the round knows (scroll-rounds.ts#stillNeeds) — the carry model's to apply (`carried`). */
  readonly still?: StillNeeds;
}

/** What the target still needs of a stroke (scroll-rounds.ts#stillNeeds): the distance to its window's middle, and how far the window lets it travel while whole in it. */
export interface StillNeeds {
  readonly needs: number;
  readonly slack: number;
}

/**
 * A stroke as planned, the driver's to send as `points` — the one field production reads (interact/scroll.ts sends
 * them and hands them back as `drawn`). The others are the plan's ACCOUNT of those points, read by no production code
 * and in no reply: what tests pin of a decision (tests/helpers/rounds.ts#decided) and what a reader of a step sees
 * when debugging it. Toward `toward` (where the content lies), its reach scaled by
 * `reach`, over `box` — the scroll view met with the gesture box, above the keyboard and what is drawn over the
 * scroll view, or the gesture box whole — kept clear of a cover whose top edge is `coverTop`, its finger travel capped
 * at `maxTravel` (a probe's). `box` and `points` are absent only when the round had no gesture box.
 */
export interface PlannedStroke {
  toward: Direction;
  reach: number;
  coverTop?: number;
  box?: Rect;
  maxTravel?: number;
  points?: Stroke;
}

/**
 * Where a stroke would touch down (`touchDown`, the driver's own point) on the surface of a presented screen, with
 * that surface as a sentence quotes it — its reach and the marked layer it is the element of
 * (ui-tree/presentation.ts#PresentedPress): scroll-rounds.ts's `presented` stop's `next`, a bound's `presented`.
 */
export interface PresentedTouchDown extends PresentedPress {
  readonly touchDown: Point;
}

/** What `planStroke` answers. */
export interface StrokePlan {
  readonly stroke: PlannedStroke;
  /** The presented surface its touch-down lies on (`Scene.presentedAt`), when this round read and the stroke has points. */
  readonly presented: PresentedTouchDown | undefined;
  /** The memory to keep whatever becomes of the stroke — held for a confirming read, held back at a bound, or sent (then through `strokeSent`). */
  readonly memory: StrokeMemory;
}

/**
 * The stroke a round draws next, decided without drawing it — so the bound can ask where the stroke it holds back
 * would have touched down. Over the target's scroll views once a read has placed it in them, else the screen's
 * largest (`candidatesOf`): the stroke touches down on what scrolls, and its length is that scroll view's 60 %,
 * never the screen's — a 1417-px list is not stroked 1332 px. A round whose tree did not read keeps the last plan's
 * candidates and the keyboard line of the last read that DID read rather than stroke through the keyboard it last
 * saw. The scroll view and the box, decided once, for this stroke's `toward` (`strokeRoom`; judged for the stroke
 * drawn over it, not for the caller's direction): the first candidate with room, met with the gesture box above the
 * stroke's cover — the keyboard's, or what is drawn over the scroll view (the floating tab bar) — or the gesture box
 * whole when none has room under the keyboard alone: a stroke toward the target is still worth drawing over the
 * screen. Judged EVERY round, with that round's gesture box and cover, not once at the read that found the target: a
 * strip the IME left no room in at that read is stroked once the IME is gone, the target's nearest scroll view.
 *
 * And where it would touch down, asked of the scene at the points as planned (ui-tree/standing.ts#Scene.presentedAt):
 * on behalf of `read.target`, a surface of a screen presented over the target's own; with no target, the cover of a
 * layer the tree marks as presented, off that layer's own scroll views. Only the touch-down is asked: it is where the
 * gesture is recognised. Undefined when this round did not read or the stroke has no box.
 */
export function planStroke(memory: StrokeMemory, { toward, reach: turnsReach, gesture, read, still }: StrokeAsk): StrokePlan {
  const m = open(memory);
  const candidates = candidatesOf(m, read?.facts);
  const kept = m.line?.y;
  const room = strokeRoom(gesture, candidates, toward, kept, 'any axis');
  const coverTop = room === undefined ? kept : room.coverTop;
  const box = room?.box ?? gesture;
  const reach = box === undefined ? turnsReach : carryReach(carryOver(m.carry, room?.within), still, strokeLength(fullStroke(box, toward, coverTop)), turnsReach);
  const points = box === undefined ? undefined : scrollStroke({ toward, reach, ...(coverTop !== undefined && { coverTop }), box });
  const stroke: PlannedStroke = { toward, reach, ...(coverTop !== undefined && { coverTop }), ...(box !== undefined && { box: { ...box } }), ...(points !== undefined && { points }) };
  const press = read === undefined || points === undefined ? undefined : read.facts.scene.presentedAt(points.from, read.target);
  const presented = press === undefined || points === undefined ? undefined : { ...press, touchDown: points.from };
  // The latest cut read for the target's scroll views is the one a later read that has lost a rect falls back to — not the oldest.
  const planned: Memory = { ...m, last: candidates, ...(m.target !== undefined && read !== undefined && { target: candidates }) };
  return { stroke, presented, memory: close({ ...planned, chosen: room === undefined ? undefined : { ...room.within } }) };
}

/**
 * The memory once the stroke its last plan made (`planStroke` or `planProbe`) is SENT: the scroll view that plan chose
 * is the one the last stroke went over (`touchedOn`), undefined when it went over the gesture box whole. A plan held
 * — for a presented screen's confirming read — is never sent, and the stroke before it stays the last one sent.
 */
export function strokeSent(memory: StrokeMemory): StrokeMemory {
  const m = open(memory);
  return close({ ...m, within: m.chosen === undefined ? undefined : { ...m.chosen } });
}

/** What a round asks of the plan for the `fully: true` flush check's probe. */
export interface ProbeAsk {
  /** The way that reveals the flush edge. */
  readonly toward: Direction;
  readonly reach: number;
  /** The cap on its finger travel (scroll-rounds.ts#PROBE_MAX_TRAVEL_FRACTION). */
  readonly maxTravel: number;
  readonly gesture: Rect | undefined;
  /** This round's facts: what is drawn over each scroll view. */
  readonly facts: Pick<TreeFacts, 'scene'>;
  /** The scroll views the probe may go over, from the one the target is flush with outward. */
  readonly scrollViews: readonly Rect[];
  /** The top edge of the keyboard the probe keeps clear of, when one is up. */
  readonly keyboardTop: number | undefined;
}

/**
 * The flush check's probe (scroll-rounds.ts#PROBE_REACH): over the first of `scrollViews` with room for a stroke
 * toward `toward` above the keyboard and what is drawn over it — never the screen box: undefined is NO ROOM (a stop
 * reported unchecked, not probed; over the screen it would touch down off the scroll view and move nothing whatever
 * is cut). `memory`: the memory with the scroll view it chose, for `strokeSent` once the probe is sent.
 */
export function planProbe(memory: StrokeMemory, { toward, reach, maxTravel, gesture, facts, scrollViews, keyboardTop }: ProbeAsk): { stroke: PlannedStroke; memory: StrokeMemory } | undefined {
  const room = strokeRoom(
    gesture,
    scrollViews.map((rect) => ({ rect, over: overIn(facts, rect) ?? [], axes: facts.scene.clips.axesOf(rect) })),
    toward,
    keyboardTop,
    'none',
  );
  if (room === undefined) return undefined;
  const { box, coverTop } = room;
  const points = scrollStroke({ toward, reach, ...(coverTop !== undefined && { coverTop }), box, maxTravel });
  return {
    stroke: { toward, reach, ...(coverTop !== undefined && { coverTop }), box: { ...box }, maxTravel, points },
    memory: close({ ...open(memory), chosen: { ...room.within } }),
  };
}

/**
 * Every one of the probe's scroll views scrolls only ACROSS a stroke toward `toward`, as `facts`' tree tells
 * (`acrossOnly`): no probe along the flush edge can move any of them, so none is sent — `planProbe` answers no room
 * for them — and scroll-rounds.ts reports the stop unchecked for that reason (`flush.why: 'axis'`), not for want of
 * room. False when there are none. Android only in practice: the probe's scroll views are the CLIPPING chain
 * (ui-tree/geometry.ts#Clips.scrollersOf), empty on every WDA tree, and of Android's scrollers only a class that fixes
 * the axis says it (`HorizontalScrollView`, a Compose `horizontalScroll`; a lazy row's axis is unknown).
 */
export function probeAcrossOnly({ toward, facts, scrollViews }: Pick<ProbeAsk, 'toward' | 'facts' | 'scrollViews'>): boolean {
  return scrollViews.length > 0 && scrollViews.every((rect) => acrossOnly({ rect, over: [], axes: facts.scene.clips.axesOf(rect) }, toward));
}

/** Where a stroke touched down on a node drawn over the scroll view it was drawn in (`touchedOn`): the point, the node, the scroll view. */
export interface TouchedOn {
  at: Point;
  /** What the sentence quotes of the node, not the node (its subtree is no fact of the failure). */
  on: QuotedNode;
  container: Rect;
}

/**
 * The node drawn over its scroll view that the last stroke touched down on, when the strokes ended exhausted (the
 * floating tab bar's note, below): the last of what is drawn over it — the one drawn on top — that contains `drawn`'s
 * touch-down (the stroke as the driver handed it back), in the tree that read unchanged (`facts.scene`'s
 * `order.drawnOverAt`, which leaves out a wrapper holding the scroll view whole). A gesture belongs to the view the
 * finger first touches (swipe.ts#swipeVectorAbove), so such a node took the strokes — MAY have: the tree does not
 * say whether a node takes touches (ui-tree/draw-order.ts), so the sentence names it first and keeps the other causes
 * after it — and "content exhausted" alone would send the reader the wrong way: the measured fast fail said so of a
 * list with 34 more rows. The stroke box is cut above what is drawn over a scroll view's lower half or over a
 * content-down touch-down (`strokeRoom`), so what is left to name is what the cut does not model — a floating header
 * a content-up stroke touches down on, a node beside a sideways stroke's centre, a node over nearly all of the box
 * that a cut would leave no room above. Undefined when the stroke went over the gesture box whole (no scroll view to
 * be drawn over: the screen box), when this tree holds no scroll view of the remembered rect (the list moved; the
 * stroke was still cut by the overlays kept with it, `ScrollView`), or when it touched down on nothing drawn over its
 * scroll view. One scan of the tree, at the stop only.
 * docs/bugs/2026-10-09-android-scroll-stroke-touches-down-on-floating-tab-bar.md
 */
export function touchedOn(memory: StrokeMemory, facts: Pick<TreeFacts, 'scene'>, drawn: Stroke | undefined): TouchedOn | undefined {
  const { within: container } = open(memory);
  if (container === undefined || drawn === undefined) return undefined;
  const on = facts.scene.order.drawnOverAt(container, drawn.from);
  if (on === undefined) return undefined;
  return { at: { ...drawn.from }, on: quoted(on), container };
}

/**
 * The scroll view the last stroke sent went over (`within`), when THIS read's tree shows its content ending at the
 * edge `toward` reveals (ui-tree/geometry.ts#Clips.endsAt: for content that lies up, its top) — nothing of it lies
 * that way, so no stroke toward `toward` over it can move anything in: the content is exhausted that way by what the
 * tree lists, not by strokes that changed nothing (scroll-rounds.ts#UNMOVED_STROKES_EXHAUST, which cannot tell a list
 * at its end from strokes not taken). Undefined when the stroke went over the gesture box whole (no scroll view), when
 * this tree holds no scroll view of that rect, when its content lies past that edge, and on every tree that does not
 * list content past its scroll view's frame (Android's, idb's: `endsAt`). Asked by the round of the read after a
 * stroke that moved nothing; one walk of that scroll view's subtree.
 * docs/bugs/2026-10-17-lab-ios-scroll-until-never-turns-toward-a-target-past-the-far-edge-when-no-stroke-moved-the-list.md
 */
export function strokedEnd(memory: StrokeMemory, facts: Pick<TreeFacts, 'scene'>, toward: Direction): UiNode | undefined {
  const { within } = open(memory);
  return within === undefined ? undefined : facts.scene.clips.endsAt(within, EDGE_TOWARD[toward]);
}

/**
 * THE CARRY MODEL (lab note LV5; docs/adr/0021-scroll-until-turns-once-at-a-proven-end.md): how far a stroke carries
 * its target, measured in this scroll, so a stroke reaches no further than the target still needs. Measured under WDA:
 * one stroke over the lab app's 180-pt `lower` (a 108-pt drag, `201 524 → 416`, its 60 %) moved it about 259 pt —
 * momentum carries a UIScrollView on after the finger lifts, roughly in proportion to the lift speed
 * (adapters/ios.ts#swipe: a 344-pt stroke carried the SwiftUI form 729–970 pt; both ≈ 2.1–2.8 × the drag at the fixed
 * 300 ms) — while F is whole in `lower` only over a 116-pt window of its offsets (884–1000). Four full strokes landed
 * 906, 929 — or 1052, past the window, after which the turn came with the sixth and last swipe and the scroll failed at
 * maxSwipes with F 18 % drawn (one run in three). The strokes' own reach is not the fault (60 % of the scroll view, as
 * anywhere); the fling is, and its size varies by run (226–263 pt).
 *
 * `carried` keeps the sample: what the read right after a stroke of the course found the target moved, the way the
 * content went, per point of the finger's ACTUAL travel (the stroke as drawn — `shortenStroke`'s floors, a box the
 * plan cut: the unit stays a point of travel). It is kept FOR THE SCROLL VIEW the stroke went over (`within`, the
 * gesture box whole as one too): a fling is that scroll view's, so a carry measured over one is never applied to a
 * stroke over another — `strokeRoom` falling back to an outer scroll view, or the target found in another list — and
 * a sample over another scroll view replaces it (`carryOver`). A sample is the round's to offer only of the same
 * node at the same size, on a tree that lists it where it lies (scroll-rounds.ts#observe); here it is dropped when it
 * moved the wrong way, when the stroke was no stroke (under twice TOUCH_SLOP: a tap), or when it lies past
 * CARRY_CEILING × the travel — no fling carries that far: content inserted above, a nested scroll carried by an outer
 * one, a match the tree renamed in place. The LARGEST sample is kept, not the last: a read taken mid-fling understates
 * one, and a stroke shorter than needed costs one more stroke where one longer than needed costs a turn. Residual:
 * the round's identity (role, id, label) cannot tell duplicate matches with the same label apart — a judged match that
 * switches to its twin between reads offers the gap between them as a sample; CARRY_CEILING bounds what such a sample
 * can do (it is dropped past 4 × the travel, and one under it cuts strokes no shorter than a real fling of that size).
 *
 * `carryReach` applies it: when a stroke at the reach the turns left would carry the target further than its window
 * lets it travel whole (`StillNeeds.slack`) — only then can one stroke skip the window, the case the model is for:
 * any window one stroke can skip, not only a short scroll view's (on a long WDA list the final approach is cut too: a
 * carry of ≈ 2.4 × a 420-pt stroke, ~1000 pt, is more than a ~650-pt slack) —
 * the travel is cut to what the target needs to reach the window's middle over the carry, as a reach of the full
 * stroke over this box; never above the turns' reach, never under `shortenStroke`'s floors. Proportional because the
 * drag keeps its 300 ms whatever its length: a shorter drag is a slower one, and its fling shrinks with it (the linear
 * model; unmeasured under 108 pt — a residual). On the measured case: three full strokes leave F ~150 pt short of the
 * window's middle, and the fourth travels ~63 pt, landing it mid-window whatever the spread of the runs. Before any
 * stroke over that scroll view was measured the carry is taken as UNMEASURED_CARRY, so a FIRST stroke that would skip
 * the window is cut too (the carousel's card,
 * docs/bugs/2026-10-18-lab-ios-wda-carousel-stop-claimed-while-the-fling-carries-the-card-past-its-centre.md).
 * docs/bugs/2026-10-17-lab-ios-wda-scroll-until-overshoots-a-row-of-a-short-scroll-view-and-spends-its-budget.md
 */
export function carried(memory: StrokeMemory, { moved, drawn }: { moved: number; drawn: Stroke }): StrokeMemory {
  const travel = strokeLength(drawn);
  if (moved <= 0 || travel < 2 * TOUCH_SLOP || moved > CARRY_CEILING * travel) return memory;
  const m = open(memory);
  const kept = carryOver(m.carry, m.within) ?? 0;
  return close({ ...m, carry: { within: m.within === undefined ? undefined : { ...m.within }, perPoint: Math.max(kept, moved / travel) } });
}

/** The carry measured over the scroll view `within` (undefined: the gesture box whole), or undefined: none measured, or measured over another (`carried`). Found by the exact rect, as the plan remembers its scroll views. */
function carryOver(carry: Memory['carry'], within: Rect | undefined): number | undefined {
  if (carry === undefined) return undefined;
  const same = carry.within === undefined || within === undefined ? carry.within === within : sameRect(carry.within, within);
  return same ? carry.perPoint : undefined;
}

/**
 * The most a stroke's fling is taken to carry its target, per point of finger travel: 4. Measured 2.1–2.8 (`lower`:
 * 226–263 pt for 108; the SwiftUI form: 729–970 for 344) — the ceiling leaves room for a faster fling than those, and a
 * sample past it is not a stroke's (`carried`).
 */
export const CARRY_CEILING = 4;

/**
 * What a stroke is taken to carry its target, per point of finger travel, before a stroke of this scroll was measured
 * to (`carryReach`): 2.8, the most any measured WDA fling carried. Measured, at the fixed 300 ms: `lower` 226–263 pt
 * for a 108-pt drag (2.1–2.4); the SwiftUI form 729–970 for 344 (2.1–2.8); sheet-long-list ≈ 1040 for 487 (2.1); and
 * `carousel-in-list`'s carousel (24,138 354x85), C as wide as it and whole at one offset only, its centre inside over
 * offsets 177–531, 447, 454, 495, 532 pt for the 212-pt stroke `307 181 → 95 181` (2.1–2.5) — one run in four past
 * that window, by a point, the next tap refused (lab note,
 * docs/bugs/2026-10-18-lab-ios-wda-carousel-stop-claimed-while-the-fling-carries-the-card-past-its-centre.md). The
 * first stroke there is cut to ≈ 126 pt (C's 354 still needed over 2.8 a point), which carries it 266–318 pt at the
 * measured spread: C's centre inside, 75–90 % of it drawn, in one stroke. The most, not a mean: a stroke shorter than
 * needed costs one more stroke, one longer than needed a turn (`carried`'s rule). Used only where the model is (a tree
 * that lists the target where it lies, the target short of its window, a full stroke able to skip that window), never
 * cutting a drag under UNMEASURED_MIN_DRAG; the first measured sample replaces it, whatever its size. The carry is
 * kept per scroll view (`carryOver`), so this stands in for the first stroke over EACH scroll view no sample was
 * measured over — the scroll's first stroke, and the first after the plan moves to another scroll view.
 */
export const UNMEASURED_CARRY = 2.8;

/**
 * The shortest drag UNMEASURED_CARRY may cut a first stroke to: 108 pt, the shortest drag any fling was measured at
 * (`lower`'s full stroke). Below it the fling is not proportional to the drag: measured live
 * (docs/adr/0021-scroll-until-turns-once-at-a-proven-end.md; `scroll-bounded` S, `fully: true`, the window 116 pt and
 * S 56 pt past it) a first stroke cut to 41 pt carried `lower` 36 pt — 0.9 a
 * point, not 2.1–2.5 — and the 0.9 then measured cut the next stroke too long, past the window and back: 4 swipes
 * where the full first stroke took 2. A first stroke cut no shorter than this keeps to the measured range; the
 * carousel's, 126 pt, is above it.
 */
export const UNMEASURED_MIN_DRAG = 108;

/** The reach of the full stroke (`full` points of travel) that carries the target what it still needs (the carry model, `carried`; UNMEASURED_CARRY until a stroke was measured), never above `reach`; `reach` itself while nothing is needed or one stroke cannot skip the window. */
function carryReach(measured: number | undefined, still: StillNeeds | undefined, full: number, reach: number): number {
  if (still === undefined || full <= 0) return reach;
  const carry = measured ?? UNMEASURED_CARRY;
  if (carry * full * reach <= still.slack) return reach;
  const cut = still.needs / carry / full;
  // Unmeasured, never under the shortest drag the carry was measured at (UNMEASURED_CARRY's floor).
  return Math.min(reach, measured === undefined ? Math.max(cut, UNMEASURED_MIN_DRAG / full) : cut);
}

/** The rects drawn over `rect` in this read, when it holds that scroll view (`TreeFacts.scene`'s draw order). */
const overIn = (facts: Pick<TreeFacts, 'scene'>, rect: Rect): Rect[] | undefined => facts.scene.order.drawnOver(rect)?.map((n) => ({ ...n.rect }));

/**
 * The target's scroll views, nearest first, as rects — what its strokes may go over (`seeRead`). Each tree names
 * them in its own dialect, and only one of the two readers answers on a tree: its clipping ancestors
 * (ui-tree/geometry.ts#Clips.scrollersOf — Android's, whose rects uiautomator has cut to them), else the ancestors
 * that scroll on a tree of unclipped frames (`Clips.drawnIn`'s `scrollers` — WDA's, which marks no node as clipping,
 * so its `scrollersOf` is empty for every node). Both empty — idb's flat list, which lists no scroll view, or a target
 * under none — is the screen box. Measured (the lab app's `scroll-bounded`, WDA): with the chain alone the stroke for
 * a row of the bounded `lower` (0,380 402x180) was drawn over the screen, touching down at (201,699) below it on the
 * bare background — nothing moved, and the reply called the content exhausted while naming `lower`; the turned stroke
 * for `tabbar-floating`'s R touched down at y 175, in the header above its list.
 * docs/bugs/2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md
 * docs/bugs/2026-10-16-lab-ios-scroll-until-turn-back-stroke-touches-down-above-the-list-and-moves-nothing.md
 */
function targetScrollers(facts: Pick<TreeFacts, 'scene'>, node: UiNode): readonly Rect[] {
  const { clips } = facts.scene;
  const chain = clips.scrollersOf(node);
  return chain.length > 0 ? chain : (clips.drawnIn(node)?.scrollers.map((n) => n.rect) ?? []);
}

/**
 * The scroll views a round's stroke toward the target may go over, nearest first (`planStroke` judges their room):
 * with no read this round (`facts` undefined), the last plan's; once a read found the target, its scroll views — each
 * cut by what this read draws over it, or by what it carried, when this read has lost its rect — none when it was
 * found in none (the screen box); else the screen's largest scroller, or none.
 */
function candidatesOf(m: Memory, facts: Pick<TreeFacts, 'scene' | 'mainScroller'> | undefined): readonly ScrollView[] {
  if (facts === undefined) return m.last;
  if (m.target !== undefined) return m.target.map(({ rect, over, axes }) => ({ rect, over: overIn(facts, rect) ?? over, axes: facts.scene.clips.axesOf(rect) ?? axes }));
  const main = facts.mainScroller;
  return main === undefined ? [] : [{ rect: main, over: overIn(facts, main) ?? [], axes: facts.scene.clips.axesOf(main) }];
}

/**
 * The stroke for a planned step: over `box` — the box the plan DECIDED (`strokeRoom`: the scroll view met with the
 * screen, above a keyboard, or the screen whole) — toward `toward` (where the content lies), clear of a cover whose
 * top edge is `coverTop` (swipe.ts#swipeVectorAbove: a keyboard's, or a node's drawn over the scroll view,
 * `strokeRoom` — the same rule for both, everything below the top covered), its reach scaled by `reach`
 * (swipe.ts#shortenStroke, along the box's side along the stroke). Why a scroll view (measured, the triage of the
 * note below): Settings' list is [0,737][1080,2154]; the screen box's content-up stroke touches down at y 444, in the
 * header above the list, and a probe drawn there moves nothing — which the flush check would take for "nothing beyond
 * the edge"; over the list it touches down at 1021 and its length is the list's, not the screen's. `maxTravel`, when
 * set, caps the finger's travel (the probe's), never below `shortenStroke`'s floors.
 * docs/bugs/2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container.md
 *
 * It judges nothing: the box is decided, so a probe the plan believed had room is drawn where it was judged — never
 * off its scroll view under the IME. Computed once a plan: the points the touch-down was asked at are the points sent.
 */
function scrollStroke(step: { toward: Direction; reach: number; coverTop?: number; box: Rect; maxTravel?: number }): Stroke {
  const { toward, reach, coverTop, box, maxTravel } = step;
  const side = axisOf(toward) === 'vertical' ? box.height : box.width;
  const stroke = shortenStroke(fullStroke(box, toward, coverTop), reach, side);
  const travel = strokeLength(stroke);
  return maxTravel === undefined || travel <= maxTravel ? stroke : shortenStroke(stroke, maxTravel / travel, side);
}

/**
 * `scrollStroke`'s stroke at full reach: over `box` toward `toward` (where the content lies), clear of a cover whose
 * top edge is `coverTop`. Its touch-down is `scrollStroke`'s whatever the reach or travel cap — `shortenStroke` keeps
 * `from` — so `overlayTop` asks it where the finger would land.
 */
function fullStroke(box: Rect, toward: Direction, coverTop?: number): Stroke {
  return coverTop === undefined ? swipeVector(box, toward, 'content') : swipeVectorAbove(box, coverTop, toward, 'content');
}

/**
 * The smallest side, along the stroke, of a box a scroll stroke may be drawn in: swipe.ts#swipeVector strokes over
 * SWIPE_REACH_FRACTION of the side either way of the centre (60 % of it), so under this the full stroke is shorter
 * than twice TOUCH_SLOP — and `shortenStroke` never lengthens, so its floor would not hold: the "stroke" is a tap (a
 * carousel cut by the list's bottom to a 30-px strip gave a probe (540,1972)→(540,1954), 18 px, a tap on the card,
 * and "moved nothing" was then reported as checked). 80.
 */
export const MIN_STROKE_BOX = Math.ceil((2 * TOUCH_SLOP) / (2 * SWIPE_REACH_FRACTION));

/** `met` — a scroll view already met with the gesture box — when it is at least MIN_STROKE_BOX along the stroke above `coverTop`: the one judgement of room. */
function roomIn(met: Rect, toward: Direction, coverTop?: number): Rect | undefined {
  const side = axisOf(toward) === 'vertical' ? Math.min(met.y + met.height, coverTop ?? Number.POSITIVE_INFINITY) - met.y : met.width;
  return side >= MIN_STROKE_BOX ? met : undefined;
}

/**
 * The least of a box (its part above the keyboard) a cut for a node over the stroke's TOUCH-DOWN may leave,
 * `overlayTop`: a third. The floating bar it is for is a strip over the box's bottom — the measured case leaves 290 of
 * 670 (43 %); a node that covers the line from higher than a third of the box down past its 0.8 touch-down covers
 * most of it, and is a wrapper the tree cannot say is transparent (ui-tree/draw-order.ts's `structural` row: a
 * structural node with children counts as drawn over a list) or a sheet over the content — a cut for it would turn an
 * 838-px stroke into a 70-px one (a wrapper `0,940 1080x1280` over the list `0,825 1080x1395`), a dozen strokes for
 * one against the 15 s budget, where the uncut stroke may well scroll.
 */
export const TOUCH_DOWN_CUT_FLOOR = 1 / 3;

/** What `strokeRoom` decides: the candidate scroll view (`within`, as the tree gives it), the box the stroke is drawn in, and the top edge of what covers that box's lower part, when something does. */
interface StrokeRoom {
  within: Rect;
  box: Rect;
  coverTop?: number;
}

/**
 * THE STROKE BOX's one owner: the first of `candidates` — scroll views, nearest first — that leaves room for a stroke
 * toward `toward` over the gesture `box` (swipe.ts#screenBox's, the box the driver draws in), above a keyboard whose
 * top edge is `coverTop` (`roomIn`: the scroll view ∩ the screen ∩ above the keyboard, at least MIN_STROKE_BOX along
 * the stroke): `within`, the candidate as the tree gives it, `box`, what the stroke is drawn in, and `coverTop`, the
 * top edge of what covers that box's lower part — the keyboard's, or a node's drawn over the scroll view
 * (`overlayTop`), the higher of the two — for the stroke to keep clear of (`scrollStroke`); absent when nothing does.
 * Undefined is NO ROOM: a probe is then not sent (scroll-rounds.ts reports `flush.why: 'room'`), and a stroke toward
 * the target goes over the screen whole. One judgement of room, the keyboard in it. No gesture `box` at all
 * (screenBox threw): no room.
 *
 * THE AXIS (the module doc's): a candidate that scrolls only ACROSS the stroke (`acrossOnly`) is judged only when no
 * other has room, and then only for a stroke toward the target (`otherwise: 'any axis'`, the pick as before the axis
 * — the probe's is `'none'`: no room); in the candidate taken the stroke is drawn in its clear lane (`clearLane`),
 * off the nested scroll views that scroll only across it, before the cut for what is drawn over it.
 *
 * Each candidate's `over` are the rects drawn over it (ui-tree/draw-order.ts#drawnOver, or as a remembered scroll
 * view carries them, `ScrollView`) — the floating tab bar of the note below: the list `0,825 1080x1395` ran under the
 * bar's host `66,1840 948x248`, the content-down stroke over it touched down at 0.8 of the list, y 1942, on the bar,
 * and the list never moved. Cut above the host it touches down at 1638 (measured: ≤ ~1800 scrolls the list). One
 * judgement for every stroke: the strokes toward the target and the `fully: true` probe both come here.
 * docs/bugs/2026-10-09-android-scroll-stroke-touches-down-on-floating-tab-bar.md
 */
function strokeRoom(box: Rect | undefined, candidates: readonly ScrollView[], toward: Direction, coverTop: number | undefined, otherwise: 'any axis' | 'none'): StrokeRoom | undefined {
  if (box === undefined) return undefined;
  const along = candidates.filter((c) => !acrossOnly(c, toward));
  return roomAmong(box, along, toward, coverTop) ?? (otherwise === 'any axis' && along.length < candidates.length ? roomAmong(box, candidates, toward, coverTop) : undefined);
}

/**
 * `strokeRoom`'s judgement over `candidates`, nearest first: the first with room, in its clear lane (`clearLane`),
 * above the keyboard and what is drawn over it. A lane the cut for what is drawn over it leaves without room is the
 * fallback's as much as no lane at all: the candidate is then judged whole, as before the rule (`met`) — never
 * dropped for a lane, which would hand the stroke to an outer scroll view or the screen box (a bar over the stretch
 * above a carousel filling the page below: the lane 180–280 cut at the bar's 240 to 60).
 */
function roomAmong(box: Rect, candidates: readonly ScrollView[], toward: Direction, coverTop: number | undefined): StrokeRoom | undefined {
  for (const { rect: within, over, axes } of candidates) {
    const met = rectIntersection(box, within);
    if (met === undefined) continue;
    const lane = clearLane(met, axes, toward, coverTop);
    const room = roomOver(lane, over, toward, coverTop) ?? (lane === met ? undefined : roomOver(met, over, toward, coverTop));
    if (room !== undefined) return { within, ...room };
  }
  return undefined;
}

/** The room in `box` — a candidate's part, or its lane — above the keyboard and what is drawn over it (`overlayTop`, `roomIn`): the box the stroke is drawn in and the cover's top edge, or undefined. */
function roomOver(box: Rect, over: readonly Rect[], toward: Direction, coverTop: number | undefined): Omit<StrokeRoom, 'within'> | undefined {
  const drawn = overlayTop(box, over, toward, coverTop);
  const top = drawn === undefined ? coverTop : Math.min(drawn, coverTop ?? drawn);
  const room = roomIn(box, toward, top);
  return room === undefined ? undefined : { box: room, ...(top !== undefined && { coverTop: top }) };
}

/** The scroll view scrolls on the other axis than the stroke's ALONE, as its tree says (`ScrollView.axes`): a stroke along it would move nothing of it. Unknown is not across. */
const acrossOnly = ({ axes }: ScrollView, toward: Direction): boolean => axes?.axis !== undefined && axes.axis !== axisOf(toward);

/**
 * The part of `met` — a candidate scroll view met with the gesture box — the stroke is drawn in so that its path,
 * touch-down to lift-off, keeps off every scroll view NESTED in the candidate that scrolls only on the other axis (a
 * card carousel in a vertical list, for a `down` stroke; a vertical list in a pager, for a `right` one): `met` itself
 * when the stroke as drawn over it (`fullStroke`, above a keyboard whose top edge is `coverTop`) crosses none, else
 * the longest stretch of it along the stroke, on the stroke's line (a vertical stroke's x, a sideways stroke's y),
 * clear of every such scroll view on that line and above the keyboard — when that stretch has room (MIN_STROKE_BOX).
 * The stroke over the stretch keeps the line (its centre across is `met`'s, the box is cut along the stroke only), so
 * its whole path lies in the stretch — and is the STRETCH's 60 %, shorter than `met`'s: a carousel `24,700 354x85` in
 * the page `0,180 402x694` gives 596 → 284 (312 pt of travel) for the page's 735 → 319 (416), more rounds for one
 * scroll — the price of a touch-down the page takes whole rather than one the carousel may keep. When no stretch has
 * room, `met`: the stroke is drawn as before the rule, its touch-down perhaps on the nested scroll view — the fallback,
 * stated (the round still strokes the target's scroll view; what a cross-axis scroll view hands its outer one of such a
 * drag is unmeasured).
 *
 * Why: a gesture belongs to the view the finger first touches (swipe.ts#swipeVectorAbove), and a horizontal carousel
 * touched down on by a vertical drag hands the outer list only part of it, if any — on iOS ~51 pt a stroke inferred,
 * unmeasured (the note below, its residual; the module doc says what the Android capture showed). A nested scroll
 * view of unknown axis (`Clips.axesOf`: a Compose lazy row, a RecyclerView, a WDA scroll view whose content fits its
 * frame) is not kept off, nor one on the stroke's own axis (a bounded list inside a page: the plan's candidates already
 * hold the target's own).
 * docs/bugs/2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md
 */
function clearLane(met: Rect, axes: ScrollAxes | undefined, toward: Direction, coverTop: number | undefined): Rect {
  const vertical = axisOf(toward) === 'vertical';
  const across = vertical ? 'horizontal' : 'vertical';
  const path = fullStroke(met, toward, coverTop);
  // The line the stroke runs on, and the stretch of it the stroke may use: `met` along the stroke, above the keyboard.
  const line = vertical ? path.from.x : path.from.y;
  const start = vertical ? met.y : met.x;
  const end = vertical ? Math.min(met.y + met.height, coverTop ?? Number.POSITIVE_INFINITY) : met.x + met.width;
  const on = (axes?.nested ?? [])
    .filter((n) => n.axis === across)
    .flatMap((n) => rectIntersection(n.rect, met) ?? [])
    .filter((r) => (vertical ? r.x <= line && line < r.x + r.width : r.y <= line && line < r.y + r.height))
    .map((r) => (vertical ? { from: r.y, to: r.y + r.height } : { from: r.x, to: r.x + r.width }));
  const [lo, hi] = vertical ? [Math.min(path.from.y, path.to.y), Math.max(path.from.y, path.to.y)] : [Math.min(path.from.x, path.to.x), Math.max(path.from.x, path.to.x)];
  if (!on.some((r) => r.from <= hi && lo < r.to)) return met;
  // The stretches of [start, end) between them, the longest first among those with room.
  let best: { from: number; to: number } | undefined;
  let at = start;
  for (const to of [...on.map((r) => r.from).sort((a, b) => a - b), end]) {
    const stop = Math.min(to, end);
    if (stop - at > (best === undefined ? 0 : best.to - best.from)) best = { from: at, to: stop };
    at = Math.max(at, ...on.filter((r) => r.from <= to).map((r) => r.to));
  }
  if (best === undefined || best.to - best.from < MIN_STROKE_BOX) return met;
  return vertical ? { ...met, y: best.from, height: best.to - best.from } : { ...met, x: best.from, width: best.to - best.from };
}

/**
 * The top edge of the highest of `over` — nodes drawn over a scroll view — that the scroll view's stroke box `box`
 * must be cut above for a stroke toward `toward` (the floating tab bar: `strokeRoom`), or undefined. `box` is judged as
 * the stroke is drawn: above a keyboard whose top edge is `coverTop`, when one is up (the list `0,825 1080x1395`
 * under a keyboard at 1300 with a bar `0,1150 1080x150` sitting on it: the bar's top is above the LIST's centre,
 * 1522, so the cut stayed 1300 and the touch-down, 1206, landed on the bar; above the keyboard the box is 825–1300
 * and the bar lies in its lower half). Only a CONTENT-DOWN stroke is cut: it touches down at 0.8 of the box, in its
 * lower half, and the touch-down is all that matters (a gesture belongs to the view the finger first touches,
 * swipe.ts#swipeVectorAbove); a content-up stroke touches down at 0.2 and only lifts off down there, so a cut would
 * only take a third of its reach (1104 → 1942 would become 1104 → 1638 under the measured bar, more strokes against
 * the 15 s budget) for nothing. A sideways stroke is not cut either: its touch-down lies off the centre line on the
 * box's middle row, which this rule does not model (a carousel under a bar: unmeasured).
 *
 * The node cut for is one that the STROKE'S LINE crosses (its rect spans x = the box's centre, where `swipeVector`
 * draws a vertical stroke — a FAB in the corner takes no touch-down, and cutting for it would only shorten the stroke)
 * and whose TOP lies in the box's LOWER HALF, below its centre and above its bottom (the keyboard's top, when one is
 * up), where the touch-down is. Everything below that top is then treated as covered, the keyboard's rule
 * (`swipeVectorAbove`): its width and height are not read — the measured bar's host is 948 of 1080 wide and stops 132
 * px above the screen's bottom, so "spans the box" or "reaches its bottom" would both have missed it. The lower half
 * and no higher: a cut there leaves at least half the box, so the stroke keeps a list's length, never a sliver's —
 * the rule below cuts higher only for a node the finger would land on, and never below a third of the box.
 *
 * And then a node over the TOUCH-DOWN, wherever its top lies: the stroke's would-be touch-down under the cut so far
 * (`fullStroke`, `scrollStroke`'s own) inside a node of `over` is cut above the highest such node, and the touch-down
 * placed again, until it lies on none: a short list `0,1550 1080x670` under the measured bar's host `66,1840
 * 948x248` — the host's top above the list's centre, 1885 — touched down at 2086, on the host, and is cut to 1840,
 * touching down at 1782. All or nothing: when a cut would leave less than TOUCH_DOWN_CUT_FLOOR of the box (part
 * above the keyboard) or MIN_STROKE_BOX, none of this rule's cuts is made and the lower-half rule's stands — a partial
 * cut would only shorten a stroke that still lands on a node. Such a node covers most of the box: a transparent
 * wrapper, where the uncut stroke scrolls, or a sheet over the content, where the target the stroke is for lies under
 * it anyway; the stroke is drawn uncut, and a fast fail names the node (`touchedOn` names a node over the stroked
 * scroll view — a cut to no room would hand the stroke to an outer scroll view or the screen box and lose that
 * sentence). The lower-half rule stays first, so every cut it made is made as it was; this one only cuts higher, and
 * only when the finger would land on a node. The loop ends: the touch-down lies above the cut so far
 * (`swipeVectorAbove`'s clearance), so each cut is a node's top strictly higher than the last.
 *
 * Not cut, stated: a node drawn over the box's UPPER half (a floating header) clear of the touch-down, where a
 * content-up stroke touches down at 0.2 of the box — the cut models a cover from below only, as the keyboard's does;
 * that fast fail names the node (`touchedOn`), but a `fully: true` probe toward a top edge that touched down on one
 * and moved nothing is still reported checked (a residual: the probe's stop is not the fast fail).
 */
function overlayTop(box: Rect, over: readonly Rect[], toward: Direction, coverTop?: number): number | undefined {
  if (toward !== 'down') return undefined;
  const cx = Math.round(box.x + box.width / 2);
  const bottom = Math.min(box.y + box.height, coverTop ?? Number.POSITIVE_INFINITY);
  const tops = over.filter((r) => r.x <= cx && cx < r.x + r.width && r.y > (box.y + bottom) / 2 && r.y < bottom).map((r) => r.y);
  const lowerHalf = tops.length === 0 ? undefined : Math.min(...tops);
  // Then the touch-down as it would be drawn under that cut: a node over it is cut above — all of them, or none.
  const floor = Math.max(MIN_STROKE_BOX, (bottom - box.y) * TOUCH_DOWN_CUT_FLOOR);
  let drawn = lowerHalf;
  for (;;) {
    const at = fullStroke(box, toward, drawn ?? coverTop).from;
    const under = over.filter((r) => containsPoint(r, at)).map((r) => r.y);
    if (under.length === 0) return drawn;
    const cut = Math.min(...under);
    if (cut - box.y < floor) return lowerHalf;
    drawn = cut;
  }
}
