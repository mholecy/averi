import type { Point, Rect, Stroke, UiNode } from '../adapters/types.js';
import { containsPoint, rectIntersection } from '../ui-tree/geometry.js';
import type { PresentedPress } from '../ui-tree/presentation.js';
import type { KeyboardLine } from '../ui-tree/keyboard-position.js';
import type { TreeFacts } from './scroll-read.js';
import { shortenStroke, strokeLength, SWIPE_REACH_FRACTION, swipeVector, swipeVectorAbove, TOUCH_SLOP, type Direction } from './swipe.js';

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
 * Presentation is asked through its existing interface — `Scene.presentedAt` and the draw order's `drawnOver` /
 * `drawnOverAt` — so the module that will own what is presented (the architecture review's A2) can replace what sits
 * behind those without touching the plan.
 *
 * WHICH SCROLL VIEW, and the axis. The candidates are the target's scroll views, nearest first (`targetScrollers`),
 * once a read has found it; before that the screen's largest scroller; none (the screen box) when the target was
 * found in none. The first with room for the stroke as drawn (`toward`) above the keyboard and what is drawn over it
 * is taken — WHATEVER ITS AXIS: a card of a horizontal carousel scrolled for `down` is stroked vertically inside the
 * carousel (docs/bugs/2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md, its residual).
 * The interface makes an axis-aware choice a change inside this module alone: a `ScrollView` is remembered by
 * `seeRead`, which has the tree (the scroller's node: `Clips.drawnIn`'s `scrollers` on WDA, the clipping chain's on
 * Android), so it can record the axis each one scrolls on once the tree can tell it (WDA's scroll view has no axis
 * attribute; its content's extent beyond its frame would have to say) — and the pick (`strokeRoom`) would skip a
 * candidate whose axis is not `toward`'s before judging its room, falling through to the outer one (the page's list).
 * The probe's candidates come in as bare rects (`ProbeAsk.scrollViews`, the clipping chain from the flush ancestor
 * outward), and its axis would be looked up from `ProbeAsk.facts` — the read's scene, which knows each scroller's node
 * — inside `planProbe`, so that question too stays here. Neither `round` nor the driver would change: they hand in
 * `toward` and take the plan. Not done here: it changes
 * where strokes land (a behaviour change for its own note and device check), and this module was a pure refactor.
 *
 * Pure: no adapter, no clock, no I/O.
 */

/** A scroll view a stroke may go over, as one value (the two move together): its rect, and the rects drawn over it at the read that chose it — the stroke box's cut (`strokeRoom`). A later read that still holds a scroll view of that rect gives its own; one that does not (the list moved — measured on Account Detail, 0,825 → 0,401) keeps these, so a remembered scroll view is not stroked as if nothing were over it. */
interface ScrollView {
  rect: Rect;
  over: readonly Rect[];
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
}

const open = (m: StrokeMemory): Memory => m as unknown as Memory;
const close = (m: Memory): StrokeMemory => m as unknown as StrokeMemory;

/** The memory before any read: no scroll view known, no keyboard line, no stroke sent. */
export function startStrokes(): StrokeMemory {
  return close({ target: undefined, last: [], line: undefined, within: undefined, chosen: undefined });
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
    ...(target !== undefined && { target: targetScrollers(facts, target).map((rect) => ({ rect: { ...rect }, over: overIn(facts, rect) ?? [] })) }),
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
export function planStroke(memory: StrokeMemory, { toward, reach, gesture, read }: StrokeAsk): StrokePlan {
  const m = open(memory);
  const candidates = candidatesOf(m, read?.facts);
  const kept = m.line?.y;
  const room = strokeRoom(gesture, candidates, toward, kept);
  const coverTop = room === undefined ? kept : room.coverTop;
  const box = room?.box ?? gesture;
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
    scrollViews.map((rect) => ({ rect, over: overIn(facts, rect) ?? [] })),
    toward,
    keyboardTop,
  );
  if (room === undefined) return undefined;
  const { box, coverTop } = room;
  const points = scrollStroke({ toward, reach, ...(coverTop !== undefined && { coverTop }), box, maxTravel });
  return {
    stroke: { toward, reach, ...(coverTop !== undefined && { coverTop }), box: { ...box }, maxTravel, points },
    memory: close({ ...open(memory), chosen: { ...room.within } }),
  };
}

/** Where a stroke touched down on a node drawn over the scroll view it was drawn in (`touchedOn`): the point, the node, the scroll view. */
export interface TouchedOn {
  at: Point;
  /** What the sentence quotes of the node, not the node (its subtree is no fact of the failure). */
  on: Pick<UiNode, 'role' | 'label' | 'identifier' | 'rect'>;
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
  const { role, label, identifier, rect } = on;
  return { at: { ...drawn.from }, on: { role, label, identifier, rect: { ...rect } }, container };
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
  if (m.target !== undefined) return m.target.map(({ rect, over }) => ({ rect, over: overIn(facts, rect) ?? over }));
  const main = facts.mainScroller;
  return main === undefined ? [] : [{ rect: main, over: overIn(facts, main) ?? [] }];
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
  const side = toward === 'up' || toward === 'down' ? box.height : box.width;
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
  const side = toward === 'up' || toward === 'down' ? Math.min(met.y + met.height, coverTop ?? Number.POSITIVE_INFINITY) - met.y : met.width;
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
 * Each candidate's `over` are the rects drawn over it (ui-tree/draw-order.ts#drawnOver, or as a remembered scroll
 * view carries them, `ScrollView`) — the floating tab bar of the note below: the list `0,825 1080x1395` ran under the
 * bar's host `66,1840 948x248`, the content-down stroke over it touched down at 0.8 of the list, y 1942, on the bar,
 * and the list never moved. Cut above the host it touches down at 1638 (measured: ≤ ~1800 scrolls the list). One
 * judgement for every stroke: the strokes toward the target and the `fully: true` probe both come here.
 * docs/bugs/2026-10-09-android-scroll-stroke-touches-down-on-floating-tab-bar.md
 */
function strokeRoom(box: Rect | undefined, candidates: readonly ScrollView[], toward: Direction, coverTop?: number): StrokeRoom | undefined {
  if (box === undefined) return undefined;
  for (const { rect: within, over } of candidates) {
    const met = rectIntersection(box, within);
    if (met === undefined) continue;
    const drawn = overlayTop(met, over, toward, coverTop);
    const top = drawn === undefined ? coverTop : Math.min(drawn, coverTop ?? drawn);
    const room = roomIn(met, toward, top);
    if (room !== undefined) return { within, box: room, ...(top !== undefined && { coverTop: top }) };
  }
  return undefined;
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
