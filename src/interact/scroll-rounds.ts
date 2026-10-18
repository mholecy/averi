import type { ClippedSide, DeviceScreen, Rect, Stroke, UiNode } from '../adapters/types.js';
import { flushEdges, rectIntersection, sameRectWithinPixel, type Cut, type Edge } from '../ui-tree/geometry.js';
import type { MarkedLayer } from '../ui-tree/presentation.js';
import type { SheetDetent } from '../ui-tree/read-tree.js';
import { activeWindowHint, outsideItsScrollView, type SystemBar } from '../ui-tree/standing.js';
import type { UsableScreen } from '../ui-tree/usable-screen.js';
import type { WaitEvidence } from './resolve.js';
import { judgeRead, shortOf, stops, strokeLine, type Cover, type InFrameShort, type Judged, type ReadJudgement, type RoundRead, type TreeFacts } from './scroll-read.js';
import { carried, planProbe, planStroke, probeAcrossOnly, seeRead, startStrokes, strokedEnd, strokeSent, touchedOn, type PlannedStroke, type PresentedTouchDown, type StillNeeds, type StrokeMemory, type TouchedOn } from './stroke-plan.js';
import { OPPOSITE, SIDES, sameStroke, strokeLength, TOUCH_SLOP, type Direction } from './swipe.js';

/**
 * `scroll_until`'s ROUND as one pure function: `round(state, seen) → { state, step }` — what a read of the
 * screen means for the scroll ACROSS reads, and what to do next. Every rule that compares
 * a read with an earlier one, and every fact the loop carried from round to
 * round, lives here and nowhere else: the confirming reads
 * (SETTLE_CONFIRM_READS), the turn after a fling and its halved reach, the
 * stuck and exhausted tests (UNMOVED_STROKES_EXHAUST, the same stroke
 * twice), the cover carried to a round whose tree did not
 * read, the frame kept across such a round, and the deadline — each
 * reachable by a test without a scripted device. What one read means on
 * its own — the cover that applies, the moot band and the witness, the
 * match judged best, the frames — is interact/scroll-read.ts#judgeRead's,
 * which `round` calls once per read that read; where the match stands for
 * the stop (in frame, covered, cut, under a band) is
 * ui-tree/standing.ts#Scene.standing's, which that module asks.
 *
 * Pure: no adapter, no clock, no I/O, no exceptions but the protocol's own
 * (below). Deterministic: the same state and seen give the same step, so a
 * round can be replayed from what was seen. TWO adapters drive it — the
 * production one, interact/scroll.ts#scrollUntilVisible, which gathers a
 * `RoundSeen` from the device and performs the step; and the test one,
 * tests/helpers/rounds.ts#play, which feeds a table of seens — so this is a
 * real seam, not a hypothetical one.
 *
 * THE PROTOCOL, which the driver honours and `round` checks:
 * - Each round the driver reads the tree once and calls `round` with what it
 *   saw. A step `ask` changes nothing — `state` comes back as it went in —
 *   and the driver calls `round` again with the SAME seen plus the answer
 *   (`corroborated` for `witness`, `unlocated` for `unlocated`); a round asks
 *   at most once of each, the witness first. That re-entry is what keeps the
 *   reducer free of async: the two questions cost a device query each on
 *   Android. Which read asks the witness is
 *   interact/scroll-read.ts#judgeRead's rule; the probe's late witness and
 *   `unlocated` are this module's.
 * - `confirm`: settle, read again, send nothing. `stroke`: draw the stroke
 *   the step describes and hand it back, as sent, in the next round's
 *   `drawn` — the "same stroke twice" identity is the points as sent
 *   (the step's `points`, made by the round's stroke plan,
 *   interact/stroke-plan.ts, over the driver's gesture box —
 *   RoundSeen.screen — and sent by the driver as they are). `drawn` is
 *   required on the round after a `stroke` and refused on any other; `round`
 *   throws on either breach, and on any call after `stop`.
 * - `stop`: the scroll is over; `outcome` says how (interact/scroll-text.ts
 *   renders it — the reply or the failure, one switch over its kind).
 *
 * ORDER inside a round, fixed: the read's judgement, its `ask witness`
 * included (interact/scroll-read.ts#judgeRead); motion observed (a read that read only);
 * the stop verdict (settled / confirm / unsettled; then, on a `fully: true`
 * stop flush with a clipping scroll container, the probe — `ask witness`
 * first for a band the moot rule left unasked — PROBE_REACH; then `ask
 * unlocated` on a `fully: true` stop with no cover under it); stuck; the
 * confirming read, or the read after a probe, that did not read; covered
 * (nothing above the band); the end turn (`EndTurn`), which takes an
 * exhaustion it applies to out of the bound; the bound (exhausted, maxSwipes, deadline —
 * and `ask unlocated` of a round that read); the stroke. The witness comes before the deadline is consulted, so a witness
 * that waits out its 2 s counts against the scroll's budget: the driver
 * stamps `elapsedMs` afresh on every call, re-entry included.
 *
 * BOUND: at most 1 + (1 + SETTLE_CONFIRM_READS) × `maxSwipes` non-ask steps
 * (25 at the defaults) — a stroke spends one of `maxSwipes` and earns at most
 * SETTLE_CONFIRM_READS confirming reads, the read after it aside — and fewer
 * at the deadline. Cost: no I/O; one copy of the state record a call.
 */

/** The caller's options, fixed for the scroll (interact/scroll.ts resolves the defaults). */
export interface RoundRules {
  /** Where the CONTENT lies relative to the current view. */
  direction: Direction;
  /** Require the element entirely inside the frame. */
  fully: boolean;
  maxSwipes: number;
  timeoutMs: number;
}

/** One tree read as the round is handed it (scroll-read.ts#RoundRead) — part of this protocol (`RoundSeen.read`), so it is importable from here. */
export type { RoundRead } from './scroll-read.js';

/** What one round saw — the driver's gathering, or a test's table row. */
export interface RoundSeen {
  /** This round's tree read: what it held, or the error that stood in for it (a miss, not a failure — read-tree.ts#readTreeOrError). */
  read: RoundRead | { error: Error };
  /**
   * This round's usable screen (swipe.ts#screenBox's `usable`) — ONE read gives both boxes the round
   * uses, so they can never come from different reads: its `oriented` box,
   * the GESTURE box the stroke is drawn in, over which the round judges a
   * container's room (interact/stroke-plan.ts) and from which a stroke step's
   * `box` is cut; and, on a round whose tree read, its `boxes`, the frame
   * the round judges in (the tap's screen too). On a round
   * whose tree did not read it is the device as built and only its
   * `oriented` box is used: the frame stays the last one. Absent when there is none
   * (screenBox threw): the frame stays, no container has room, and a stroke
   * step carries no box — the driver throws why.
   */
  screen?: UsableScreen;
  /** The stroke the previous `stroke` step drew, as sent. Required after `stroke`, refused otherwise. */
  drawn?: Stroke;
  /** The answer to `ask witness`: the round's keyboard reading's `corroborated()`. */
  corroborated?: boolean;
  /** The answer to `ask unlocated`: the round's keyboard reading's `unlocated()`. */
  unlocated?: boolean;
  /** ms since the scroll began (after the device's screen was read), stamped on every call — re-entry included. */
  elapsedMs: number;
  /**
   * ms this round's tree read took, whether it read or failed — the driver times the read alone. Summed for the
   * timeout's sentence (`ReadTime`): a budget the reads spent is not the content's fault.
   */
  readMs: number;
}

/**
 * One read that read, as the round has gathered it by `observe`: the read,
 * and of its judgement (interact/scroll-read.ts#ReadJudgement) its tree's
 * facts, the frames it was judged in (the screen above an applied
 * keyboard, or each box that counts), the frames short of the far edge is
 * judged in (`uncutFrames`: uncut at the navigation band, so a target a
 * stroke then pushes wholly into the band was seen short, and is turned
 * back) and the line its strokes stay above. One value, so the steps after
 * the judgement read the same facts.
 */
type ThisRead = Pick<ReadJudgement, 'facts' | 'frames' | 'uncutFrames'> & { readonly read: RoundRead };

/** What to do next. */
export type RoundStep =
  /** Answer, then call `round` again with the same seen and the answer; the state is unchanged. */
  | { do: 'ask'; what: 'witness' | 'unlocated' }
  /** Settle, read again, send nothing — a confirming read (SETTLE_CONFIRM_READS), or a confirming read that did not read, read again. */
  | { do: 'confirm' }
  /**
   * Draw the stroke the plan made (interact/stroke-plan.ts#PlannedStroke) — send `points` as they are and hand them
   * back as the next round's `drawn`. The rest is the plan's account of them, which the driver reads none of: toward
   * `toward` (where the content lies), its reach scaled by `reach` (swipe.ts#shortenStroke; 1 until the first turn,
   * halved by each), over `box` — the scroll view the plan chose met with the round's gesture box
   * (`RoundSeen.screen`), so the stroke touches down on the content that scrolls, or the gesture box whole when no
   * scroll view is known or none has room — kept clear of a cover whose top edge is `coverTop` when set (the
   * keyboard's, or a node's drawn over the scroll view's lower part: a floating tab bar). `box` and `points` are
   * absent only when the round had no gesture box (the driver throws why). `probe`: the stroke is the flush check's
   * (PROBE_REACH), not a step toward the target — its `box` always a scroll view's, never the screen's fallback;
   * `maxTravel` caps its finger travel (PROBE_MAX_TRAVEL_FRACTION).
   */
  | ({ do: 'stroke'; probe?: true } & PlannedStroke)
  /** The scroll is over. */
  | { do: 'stop'; outcome: ScrollOutcome };

/**
 * Every way a scroll ends — one member per sentence the reader acts on
 * differently, each carrying exactly the facts its sentence quotes
 * (interact/scroll-text.ts renders them; the error class is decided there
 * too, through resolve.ts#absenceError):
 * - `visible`: the stop. `settled` false when no confirming read found the
 *   target still (the reply says so); `unlocated` only on a `fully: true`
 *   stop judged with no cover under it; `flush` only on a `fully: true`
 *   stop whose edge lies on its clipping container's (PROBE_REACH).
 * - `stuck`: the judged match in the frame but short of the stop (`short`,
 *   `shortOf`: clipped, or under a node of the app) — and
 *   UNMOVED_STROKES_EXHAUST identical strokes left it where it was — the
 *   layout defect, or the keyboard's edge when it is the bottom clip.
 * - `covered`: a corroborated cover leaves nothing above its top edge;
 *   nothing judged, no stroke sent.
 * - `presented`: a screen is presented over the judged match's own (ADR 0018:
 *   a modal's dim, a sheet's form, a popover's `dismiss popup`), on two
 *   reads with no stroke between, or on one when no confirm is left; no
 *   further stroke sent — none moves it out, and one on that screen may
 *   dismiss it (a page sheet's pull-to-dismiss, a popover closed by a touch
 *   on its dim). Either the match lies in the frame under that screen
 *   (its standing's remedy is `presented`, ui-tree/standing.ts#Remedy; `cover`
 *   the one the sentence names and `layer` the marked layer it names, that
 *   remedy's), or — `next` set — it was not judged in the frame (below the
 *   fold, under the soft keyboard, cut or clipped) and the next stroke would
 *   touch down on a surface of that screen (`PresentedTouchDown`,
 *   ui-tree/standing.ts#Scene.presentedAt), carried whole.
 *   `judged` undefined: no target in the tree, and the next stroke would
 *   touch down on a layer the tree marks as presented, off its own scroll
 *   views (an alert, an action sheet, a popover, a `screen` layer: the same
 *   question asked for no target) — no stroke is sent under it.
 * - `bound`: the bound ended it (`by`), and what the target was short of
 *   (`short`), with the turns, the keyboard the rounds applied, and the
 *   `unlocated` row of the last round's reading.
 *
 * Every kind may carry `detent`: the top sheet — the same sheet at both
 * reads — reported another detent at the last read that read than at the
 * first (`DetentMove`).
 */
export type ScrollOutcome = (
  | { kind: 'visible'; swipes: number; judged: Judged; settled: boolean; unlocated: boolean; flush?: Flush }
  | {
      kind: 'stuck';
      swipes: number;
      short: InFrameShort;
      /** The way the strokes no longer move it. */
      lastStroke: Direction;
      viewport: Rect;
      /**
       * The other way (`round`'s stuck turn): `unmoved` — one stroke back moved
       * it neither; `stroked` — swiped earlier in the scroll (a turn), so not
       * tried again; `untried` — no swipe or time was left to try it;
       * `outward` — a sliver stuck on strokes toward its cut edge, which the
       * other way only pushes out through that edge, not tried.
       */
      otherWay: 'unmoved' | 'stroked' | 'untried' | 'outward';
    }
  | { kind: 'covered'; swipes: number; cover: Cover; viewport: Rect; evidence: WaitEvidence }
  | { kind: 'presented'; swipes: number; judged: Judged; viewport: Rect; cover: UiNode; layer?: MarkedLayer; next?: undefined }
  | { kind: 'presented'; swipes: number; judged: Judged | undefined; viewport: Rect; next: PresentedTouchDown }
  | {
      kind: 'bound';
      swipes: number;
      by: BoundBy;
      short: Shortfall;
      /** Direction changes the scroll made (a fling carried the target past the frame). */
      turns: number;
      /** The last cover any round applied, in how many of the rounds that read. */
      keyboard?: { cover: Cover; rounds: number; read: number };
      unlocated: boolean;
      evidence: WaitEvidence;
      /** The swipe the bound held back would have touched down on a screen presented over the target's (interact/stroke-plan.ts#PresentedTouchDown). */
      presented?: PresentedTouchDown;
    }
) & { detent?: DetentMove; endTurn?: EndTurn };

/**
 * THE END TURN (the owner's decision of 2026-10-17, lab note LV4, below; docs/adr/0021-scroll-until-turns-once-at-a-proven-end.md): the strokes went the caller's way first and
 * the read after one of them proved the content exhausted that way — the stroke moved no match, and the tree shows
 * the content of the scroll view it went over ENDING at the edge that way (`Observed.ends`,
 * interact/stroke-plan.ts#strokedEnd) — while the tree places the target wholly past the OPPOSITE (far) edge of that
 * same scroll view, inside it. Then the strokes turn ONCE toward the target, at full reach (no fling carried it past:
 * it was never near), and every reply and failure says so (`from`, `to`, the swipes sent `after` which, the scroll
 * view named). Measured (the lab app's `scroll-bounded`, WDA): `direction: "up"` for F at content y 1380 of `lower`
 * (0,380 402x180) at its top stroked up three times, moved nothing and failed advising `down`.
 *
 * Until then a target never sighted short of the far edge was "the caller's direction to honour" (`beyondFarEdgeIn`,
 * `nextStroke`): nothing is guessed from a screen no stroke changed. The decision refines that rule, it does not drop
 * it: the caller's direction is still stroked first; the turn needs PROOF from the reads — strokes that changed
 * nothing are no proof on their own (they may not have been taken: UNMOVED_STROKES_EXHAUST), the tree's own listing
 * of where the content ends is — and a tree that lists the target past that scroll view's far edge, which is no
 * guess either. Why turn rather than fail with the advice: the reply already knew the way, and a caller who asked the
 * wrong way gets the row at the cost of the one stroke that proved it.
 *
 * Decidable on WDA's trees only (unclipped frames: ui-tree/geometry.ts#Clips.endsAt). Not on uiautomator's: its rects
 * are cut to the scroll container, so where the content ends is not listed — content past the edge reads flush with
 * it, or (Compose) is not listed at all — and the reads can prove the end only by strokes that changed nothing, which
 * a stroke not taken also does; so Android keeps the caller's direction and fails with the advice, as before. Nor on
 * idb's flat list, which lists no scroll view (lab note LE2): the strokes go over the screen, and the failure names the
 * side as before.
 * docs/bugs/2026-10-17-lab-ios-scroll-until-never-turns-toward-a-target-past-the-far-edge-when-no-stroke-moved-the-list.md
 */
export interface EndTurn {
  /** The caller's direction, stroked first. */
  from: Direction;
  /** The way the strokes went after the turn: `from`'s opposite. */
  to: Direction;
  /** The swipes sent before the turn — the caller's way, the last of them the one that proved the end. */
  after: number;
  /** How many of the last of them moved nothing (the proof's one, or more when the one before it proved nothing yet: a read still settling, a stroke the tree could not judge). */
  unmoved: number;
  /** The scroll view whose content ends the caller's way, as a sentence names it. */
  scrollView: Pick<UiNode, 'role' | 'label' | 'identifier' | 'rect'>;
}

/**
 * A sheet that moved to another detent during the call: the detent the top
 * sheet's grabber reported at the scroll's first read that read (`from`)
 * and at its last (`to`) — scroll-read.ts#TreeFacts' `detent`, compared at
 * the stop only. A stroke on a half sheet's list at its top drags the sheet
 * up before it scrolls the list (measured: `Half screen` to `Expanded` under
 * a stroke from (201,699)), which the verdict alone does not say; the note
 * names no cause, as the sheet may also move between two reads with no
 * swipe sent.
 *
 * Set only when both reads hold a grabber with a value, the same NUMBER of
 * grabbers, and the values differ — whatever lay between. The count is the
 * sheet's identity: the top sheet's grabber is the last in tree order, so
 * with as many sheets showing one at both reads the last is the same
 * sheet's — one closed or presented meanwhile changes the count, and the
 * last grabber would be another sheet's. The grabber's frame cannot serve:
 * it moves and resizes with the detent (152,411 98x24 at half, 151,58
 * 100x24 expanded). Not caught: one sheet closed and another presented
 * within the one call. The verdict is the same with or without it.
 */
export interface DetentMove {
  from: string;
  to: string;
}

/**
 * A `fully: true` stop whose edge along the scroll lies on its scroll
 * container's edge (PROBE_REACH): `checked` when a probe toward that edge
 * moved nothing — nothing of it is cut there — and false, so it may be,
 * `why`: no swipe or time was left (`budget`); no clipping ancestor from
 * the flush one outward has room for a stroke (`room`: a probe drawn over
 * the screen instead would touch down off the container and move nothing
 * whatever lies beyond, so none is sent); every one of them scrolls only across the edge (`axis`: a probe along it
 * moves none of them — interact/stroke-plan.ts#probeAcrossOnly); or the
 * probe was drawn under twice TOUCH_SLOP and may have been a tap (`tap`).
 *
 * `fills`: flush with BOTH of its
 * nearest container's `edges` along the scroll, and with ONE edge of no
 * clipping ancestor — a row taller than its list, cut at both ends, reads
 * exactly the list's rect. Never probed (one probe cannot tell which side,
 * if either, is cut), so never checked — and never a plain "fully visible".
 */
export type Flush =
  | ({ edge: Edge; container: Rect } & ({ checked: true } | { checked: false; why: 'budget' | 'room' | 'axis' | 'tap' }))
  | { edges: readonly [Edge, Edge]; container: Rect; checked: false; why: 'fills' };

/**
 * Which bound ended the scroll: the same stroke twice moved nothing (with
 * the direction last swiped, what stayed put — every match of a target
 * off the frame, or the whole tree of one not in it — and, when the last
 * stroke touched down on a node drawn over its container, that node:
 * `touchedOn`), `maxSwipes`, or the deadline. `ends`: the exhaustion was PROVEN by the tree — the scroll view the
 * last stroke went over lists its content ending that way (`Observed.ends`) — after `strokes` unmoved strokes (one,
 * where UNMOVED_STROKES_EXHAUST's two are the proof otherwise).
 */
export type BoundBy =
  | { of: 'exhausted'; lastStroke: Direction; unchanged: 'matches' | 'tree'; touched?: TouchedOn; ends?: { scrollView: Pick<UiNode, 'role' | 'label' | 'identifier' | 'rect'>; strokes: number } }
  | { of: 'maxSwipes' }
  | { of: 'timeout'; timeoutMs: number; elapsedMs: number; reads: ReadTime };

/**
 * The tree reads of a scroll that timed out: how many (every round reads once, a failed read included), how long they
 * took in all and the last one. A WDA restart under the scroll (the Safari case: no swipe sent, one 38 s read against
 * the 15 s budget) shows here, and not as content that never came into view; the restart itself is reported by the
 * tree source on stderr, not in the reply. The bound carries the time spent (`elapsedMs`, what the round that stopped
 * was stamped with) beside the budget: a read that outlasts it ends the scroll well past it.
 */
export interface ReadTime {
  count: number;
  totalMs: number;
  lastMs: number;
}

/**
 * What the target was short of at a bound, by the last round:
 * - `readFailed`: the last tree read failed — quoted, whatever came before;
 * - `clipped`: in the frame but clipped — an edge cut with `fully: true`,
 *   its centre off the screen without (`shortOf`);
 * - `covered`: in the frame, not clipped so, but a node of the
 *   app drawn over it — over any of it with `fully: true`, over its centre
 *   without (`stops`);
 * - `absent`: not in the last tree, and never in the frame before it —
 *   `unsearched` the side the strokes never
 *   read, when there is evidence it is the only one left: a stroke changed
 *   the screen (`State.treeMoved`), then the caller's own strokes no longer
 *   did (`exhausted`, `tree`), and none of them touched down on a node drawn
 *   over the list — the content ran to its end the caller's way, every row
 *   on that side through the tree, so a target this list holds lies on the
 *   side it started from. Without that (maxSwipes, the deadline: more may
 *   lie ahead; a screen no stroke ever changed: the swipes may not have
 *   been taken) nothing is guessed. Every stroke of a scroll that never
 *   found its target goes the caller's way (a turn needs a sighting; the
 *   end turn, `EndTurn`, needs the target in the tree), so the other side
 *   was never stroked. `windowHint` the last tree's active-window hint
 *   (ui-tree/standing.ts#activeWindowHint, the one test of a source that
 *   lists the active window only: a sheet or dialog it does not mark may
 *   hide the target), carried as its words;
 * - `gone`: not in the last tree, in the frame after swipe `inFrameAfter`;
 * - `left`: not in the last tree, never in the frame, but in the tree after
 *   swipe `inTreeAfter` (off the frame, or under the keyboard) — a stroke
 *   carried it out and a lazy list dropped it ("never appeared" would be
 *   false of it);
 * - `offFrame`: in the tree, off the frame judged — `inFrameAfter` when an
 *   earlier read had it in the frame; `cover` the one this round applied,
 *   `eitherWayUp` when the whole-screen judgement ran over both boxes.
 *
 * `past` on `left` and `offFrame`: the read
 * that last found it found it wholly beyond the FAR edge of the caller's
 * direction (`State.lastPast`) — the side the strokes push it out through,
 * so the failure names that side and the direction that brings it back,
 * not "off the viewport, or under the soft keyboard … (a fling?)". Only
 * while no stroke was drawn that way (`strokedToward`): once one was — a
 * turn — that direction was tried, and the turn's own sentence says why.
 * `outside` on `offFrame`: the last read judged it on the screen but outside
 * what its scroll view draws (ui-tree/standing.ts, the drawn frame) — that
 * scroll view, which the failure names in place of the viewport.
 */
export type Shortfall =
  | { of: 'readFailed'; error: Error }
  | InFrameShort
  | { of: 'absent'; unsearched?: Edge; windowHint?: string }
  | { of: 'gone'; inFrameAfter: number }
  | { of: 'left'; inTreeAfter: number; past?: PastSide }
  | { of: 'offFrame'; rect: Rect; inFrameAfter?: number; viewport: Rect; cover?: Cover; eitherWayUp: boolean; past?: PastSide; outside?: UiNode };

/** The side a read found the target wholly beyond, and whether it was dumped clipped out past it (UiNode.clippedOut) rather than read past it on the screen. */
export interface PastSide {
  side: Edge;
  clippedOut: boolean;
}

/**
 * How many reads a stop reached after a stroke may spend waiting for the
 * target to hold still before it is reported unsettled (the iOS device
 * check of the note below). A stop after a stroke is CONFIRMED: one more read after a
 * further settle, in which the target's rect is unchanged and the stop
 * still holds. Measured under WDA: the 400 ms settle read caught a
 * SwiftUI form mid-fling with the row inside the viewport — "fully visible
 * after 1 swipe" — and a read 1 s later had it at y -48 / -121 / -133,
 * behind the top bar, three runs of three. What it costs: each confirming
 * read is a round like any other — one more settle, one more tree read
 * and, on Android, what a round's keyboard reading costs
 * (ui-tree/keyboard-cover.ts has the table); a stop at 0 swipes sent no
 * stroke and spends none. A target still
 * moving inside the viewport is read again, up to this many reads a
 * stroke, then reported with `settled: false` and a note saying so: a
 * fling is over well inside 3 × 400 ms plus the reads, and a target that
 * never holds still (an animated row, a marquee) must not hold the scroll
 * until its timeout. The confirming reads count against `timeoutMs` (a stop
 * reached at the deadline is reported unsettled, unconfirmed), not against
 * `maxSwipes`: they send nothing.
 * docs/bugs/2026-10-08-scroll-until-ignores-android-soft-keyboard.md
 */
export const SETTLE_CONFIRM_READS = 3;

/**
 * How many strokes in a row — the same stroke each time — must leave every
 * match where it was before a target in the tree but off the frame is
 * called "content exhausted". Measured on Android: the form's
 * last field, wholly under an IME its container does not resize for,
 * swiped for the whole 15 s. Two, not one: a single
 * stroke that moves nothing can be a transient — the first touch
 * dismissing a snackbar, a stale tree read, a stroke drawn whole-screen
 * onto an IME that was still coming up while the witness denied the stale
 * window — after which the next stroke scrolls. ONE suffices where the
 * tree itself proves the end (`Observed.ends`, the owner's decision of
 * 2026-10-17 with the end turn, `EndTurn`): the read after it unmoved, and
 * the scroll view it went over listing its content ending the way it went
 * (WDA's unclipped frames; never Android's or idb's) — a transient can
 * leave a stroke untaken, not make the content end there. Only the same stroke
 * counts twice: a stroke drawn differently (a band applied, the stroke
 * turned round) is a new attempt. The `fully: true` clipped stop's stuck
 * test takes the same two, watching the judged match
 * alone — a visible clipped match that does not move is the defect it
 * reports. For both, only strokes count: a confirming read sent none.
 *
 * And a target NOT in the tree (the note below): the same stroke twice after
 * which the WHOLE tree is unchanged (`TreeFacts.fingerprint`) — content at
 * its end, the target not in it, or no longer: measured, `scroll_until
 * row_40` on a list ending at row_36 swiped 5 times to the 15 s timeout,
 * "never appeared". It fails after the two, in the same words, the
 * cause saying the screen did not change. The whole tree, not "no match
 * moved" — there is no match to watch. A screen whose TREE changes on its
 * own (a ticking label) never reads unchanged and runs to the bound. A spinner does not change the tree — a ProgressBar or a Compose
 * indicator dumps a fixed rect and no text — so a list still loading its
 * next page would read exhausted ("failed after 2 swipes" where the bound
 * should wait): a round whose tree shows a
 * progress node (`TreeFacts.loading`) does not count as unchanged, and the
 * sentence names loading among the causes. So a screen that ALWAYS shows
 * a progress node (a step indicator, a progress header bar) never fails
 * fast and runs to its bound. Residual: content that loads
 * with no indicator in the tree (a shimmer drawn as plain views, a
 * silent fetch) can still be called exhausted after the two strokes.
 * docs/bugs/2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md
 */
export const UNMOVED_STROKES_EXHAUST = 2;

/**
 * The flush check's probe:
 * docs/bugs/2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container.md
 * The reach of
 * the one short stroke a `fully: true` stop is answered with when the
 * judged match's edge along the scroll lies exactly — within a pixel — on
 * its scroll container's edge (`flushEdge`). On Android that is where
 * uiautomator cuts a node's bounds: a row half behind a pinned bar, or half
 * past the fold of a list with no chrome, or half below the display in an
 * edge-to-edge scroller (the display clips too), reads SHORTER, inside the
 * container, with no edge past the viewport — measured: the SWIFT form's
 * Fees row read `{y:242, height:92}` of 143 against a container starting at
 * 242, and was "fully visible after 0 swipes". The cut is not in the tree,
 * so it is asked of the device: a stroke TOWARD revealing that edge (content
 * that lies up, for a top edge — the finger moves down), drawn inside the
 * container. Moves nothing: the content is at its end that way, nothing
 * lies beyond the edge, the stop is accepted as it stood (the first row of
 * a list at rest is flush with its container's top and is not cut). Moves
 * it: the round judges the new read like any other, and a stop flush again
 * after it is a new candidate with a probe of its own.
 *
 * Toward the edge, never the caller's way (verified on the triage repro):
 * a row cut at the top with the default direction down stroked "down" is
 * stroked further out — and a lazy list drops it ("gone"). Along the
 * scroll's axis only (the caller's direction's): a vertical list's cell
 * flush with the left edge of its container is the ordinary grid layout,
 * and a sideways stroke there could turn a page of a pager around it. Not
 * when BOTH edges on the axis are flush — the match fills its container,
 * and one probe cannot tell which side, if either, is cut: unless an outer
 * ancestor gives it a one-edge flush (below), such a stop is reported
 * unchecked, `flush.why` `fills` (`Flush`), and the reply says so. One
 * probe per candidate stop:
 * a probe after which the match is where it was settles it.
 *
 * A quarter of the stroke — over the container, 15 % of its side
 * (swipe.ts#SWIPE_REACH_FRACTION, 60 % of the side, × 0.25) — and never
 * more than PROBE_MAX_TRAVEL_FRACTION of the screen's long side: 178 px on
 * the Pixel_3a, more than the 51 px the SWIFT form's Fees row was cut by; a
 * cut larger than that is left flush again and probed again. Short so it
 * cannot carry the row out of a container of any ordinary height.
 *
 * Every clipping ancestor, not the nearest alone:
 * the match is flush with one of them on one edge — a card that fills a
 * carousel's height is flush with both of the carousel's edges, but the
 * carousel is cut by the list around it, and the card with it, on the
 * list's edge — and the probe answers the nearest ancestor flush on ONE
 * edge. Exempt only when no ancestor is. The probe is drawn over that
 * ancestor, or an outer one, whichever is the first with room for a stroke
 * (interact/stroke-plan.ts#planProbe) — a carousel cut to a 30-px strip has none, and a
 * stroke there is a tap on the card — room ABOVE the keyboard the probe
 * keeps clear of (a list running on under the IME from 58 px above it has
 * room on the screen and none above the keyboard; a probe over the whole
 * screen lands off the list and reports "nothing of it is cut there"). When no ancestor has room (a lone 79-px
 * scroller, that list), no probe is sent — over the screen it would touch
 * down off the container and move nothing whatever is cut — and the stop
 * is reported with `flush.checked` false. A probe drawn shorter than twice
 * TOUCH_SLOP anyway (a tiny screen) never reports `checked`: it may have
 * been a tap that moved nothing.
 *
 * Residuals, stated: Android's View bounds are cut to every
 * ancestor, not only scrollers, and Compose also subtracts what an overlay
 * sibling covers — a row cut by a pinned bar drawn over the list reads cut
 * at the bar's edge, not flush with any scroller, so it is not probed (the
 * bar itself is a cover, ui-tree/standing.ts#Scene's); a RecyclerView with padding
 * and clipToPadding draws a row cut at its padding edge while the row's
 * rect runs to the view's edge — not flush, not probed.
 *
 * Cost, stated: one stroke (it spends one of `maxSwipes` and counts in the
 * reply's swipes), one settle and one tree read — plus, on Android, what a
 * round's keyboard reading costs (ui-tree/keyboard-cover.ts) — on every
 * `fully: true` stop flush with a clipping container, legitimate ones
 * included (a first row at rest). iOS has no clipping container
 * (types.ts#UiNode.clipsDescendants), so it never probes. At the bound —
 * no swipe or time left — the stop is reported with `flush.checked` false
 * and a sentence saying it may be cut.
 */
export const PROBE_REACH = 0.25;

/**
 * The cap on the probe's finger travel, as a fraction of the screen's long
 * side: a probe toward a TOP
 * edge drags the content down, and at the top of a list that is the
 * pull-to-refresh gesture — SwipeRefreshLayout starts a refresh once the
 * finger has pulled 128 dp past the slop (its 64-dp spinner target at a
 * drag rate of 0.5), Compose's pullRefresh at its 80-dp threshold, likewise
 * halved, 160 dp. 15 % of a tablet's 2350-px container is 353 px — 176 dp
 * at density 2, a reload of the app's data for a first row at rest. The
 * density is not read (it would be one more adb call per scroll); a screen's
 * long side runs to about 1400 dp on the largest tablets, so 0.08 of it is
 * at most ≈ 112 dp, under both thresholds, on any density: 178 px (65 dp)
 * on the Pixel_3a, 205 px (102 dp) on a 2560-px tablet at density 2. Cost:
 * a cut deeper than the probe moves the row takes another probe.
 */
export const PROBE_MAX_TRAVEL_FRACTION = 0.08;

/** The axis a scroll along `direction` runs on: `flushEdges`' along it. */
const axisOf = (direction: Direction): 'vertical' | 'horizontal' => (direction === 'up' || direction === 'down' ? 'vertical' : 'horizontal');

/**
 * Where the match lies flush, of `chain` (clipping ancestors, nearest
 * first; `flushEdges`, ui-tree/geometry.ts, along the scroll's axis, within
 * a pixel): the nearest it is flush with on ONE edge along the scroll — that
 * edge and the ancestor's index, the probe's question — else, when it
 * fills the NEAREST along the scroll, both edges (`fills`: reported, never
 * probed); undefined when neither.
 */
function flushWith(
  rect: Rect,
  chain: readonly Rect[],
  direction: Direction,
): { edge: Edge; at: number } | { fills: readonly [Edge, Edge] } | undefined {
  for (const [at, container] of chain.entries()) {
    const edges = flushEdges(rect, container, axisOf(direction));
    if (edges.length === 1) return { edge: edges[0], at };
  }
  const nearest = chain.length === 0 ? [] : flushEdges(rect, chain[0], axisOf(direction));
  return nearest.length === 2 ? { fills: [nearest[0], nearest[1]] } : undefined;
}

/** What a read followed: the scroll's start, a stroke, or a settle pause that sent nothing (a confirming read). */
type Since = 'start' | 'stroke' | 'settle';

declare const opaque: unique symbol;

/** The reducer's state — what the caller holds between rounds and hands back. Opaque: only `round` reads it (the fields are `State`'s). */
export interface Rounds {
  readonly [opaque]: 'scroll-rounds';
}

/** The screen a round judges in: the usable screen (ui-tree/usable-screen.ts#UsableScreen) — the device as built until a round had one (`startRounds`). */
type Frame = UsableScreen;

/**
 * Everything the scroll remembers between rounds, one record with one
 * writer (`round`): the target's motion and the loop's facts alike.
 */
interface State {
  readonly rules: RoundRules;
  /** The end turn, once made (`EndTurn`: at most one a scroll) — carried by the stop, whatever its kind; the course's direction after it (`courseOf`). */
  readonly endTurn: EndTurn | undefined;
  readonly swipes: number;
  /** A `stop` was returned: no further round. */
  readonly done: boolean;
  /** The last step was a `stroke`: the next seen must hand back `drawn`. */
  readonly owesDrawn: boolean;
  /**
   * The visibility reference frame: the usable screen of the round's tree
   * (ui-tree/usable-screen.ts#usableScreen, through swipe.ts#screenBox) — the
   * tap's screen too, so a stop the scroll calls visible is
   * judged on the screen the next tap is judged on, by construction: the
   * box (turned in landscape as the stroke already was; what a failure
   * quotes) and the boxes that count (`UsableScreen.boxes`: either way up only
   * when a turn is suggested but not witnessed). A round whose tree did not
   * read, or that has no box at all (a 0×0 device and no window), keeps the
   * last frame — the device as built until a round had one. The keyboard
   * cover is cut from the box as chosen: a band is in the tree's
   * coordinates, and above it is the box's width.
   */
  readonly frame: Frame;
  /** Some round matched the target — the absence rule's evidence. */
  readonly everFound: boolean;
  /** How many rounds' reads returned a tree — the absence rule's evidence too; not `reads.count`, since a failed read is no evidence of absence. */
  readonly treesRead: number;
  /** Every round's tree read, failed ones included — for the timeout's sentence, where a failed read's time counts. */
  readonly reads: ReadTime;
  /** The last cover any round applied, and how many rounds applied one — for the failure text. */
  readonly lastCover: Cover | undefined;
  readonly coveredRounds: number;
  /** What the strokes remember across reads — the target's scroll views, the last keyboard line, the scroll view the last stroke went over (interact/stroke-plan.ts#StrokeMemory): the plan's, which `round` holds and reads none of. */
  readonly strokes: StrokeMemory;

  // How the target moved, read for read: a swipe that does not move the element is the only honest
  // signal that the container has nothing left to scroll — "give it another
  // swipe" against "this element CANNOT be fully revealed" (a real layout
  // defect) or "it is off the frame for good" — and a stop after a stroke
  // holds only once a read finds it still.
  readonly since: Since;
  /** Every match's rect at the last read that read, and the judged match's at the last read that had one. */
  readonly prevRects: readonly Rect[] | undefined;
  readonly prevBest: Rect | undefined;
  /** Identical strokes in a row after which every match, and the judged match, stayed put — the stroke the streak was counted for, and the last one drawn (`sameStroke`). */
  readonly allUnmovedStrokes: number;
  readonly bestUnmovedStrokes: number;
  readonly streakDrawn: Stroke | undefined;
  readonly lastDrawn: Stroke | undefined;
  /** Some read saw the target SHORT of the far edge (`beyondFarEdge`) — so a later read beyond it means a fling carried it across. */
  readonly seenShort: boolean;
  /**
   * The last read that READ found the target beyond the far edge, after an
   * earlier read saw it short of it — or, on any read, in the frame at that
   * edge (`observe`'s `atFarEdge`): the next stroke turns. Kept across a
   * read that failed — that round strokes as the last read round decided,
   * as it keeps that round's keyboard line (stroke-plan.ts#seeRead); cleared by a read
   * that does not find the target — whether to turn then is `dropped`'s
   * question.
   */
  readonly carriedPast: boolean;
  /** Confirming reads spent since the last stroke (SETTLE_CONFIRM_READS is per stroke). */
  readonly confirmReads: number;
  /**
   * The `presented` stop the last read that read would have made — its judged match under a presented screen, or its
   * next stroke touching down on one — held for one more read with no stroke between (`round`): the next read that
   * reads decides; a read that does not read is confirmed again while the budget allows, then this stop is made, as
   * the last read that read left it. Never a stroke in between: one drawn blind would land on that screen.
   */
  readonly presentedHold: Extract<ScrollOutcome, { kind: 'presented' }> | undefined;
  readonly strokesSent: number;
  /** Where the content lay for the last stroke sent: the caller's direction, or its opposite after a fling past the target. For "swiping … no longer moves it". */
  readonly lastStroke: Direction;
  /** Direction changes — a stroke drawn the other way from the one before — for the shortening and the failure text. */
  readonly turns: number;
  /** The judged match's identity at the last read that had one (`identityOf`): a motion is measured only of the same node (`carried`). */
  readonly prevKey: string | undefined;
  /** The swipe count at the last read that had the target in the frame (any part of it) — for a failure after it left again. */
  readonly inFrameAfter: number | undefined;
  /** The probe in flight (PROBE_REACH): the judged match's rect and edge when it was sent. Cleared by the next read that reads. */
  readonly probe: { rect: Rect; edge: Edge } | undefined;
  /** The swipe count at the last read that had the target in the tree at all — for "was in the tree … then left it". */
  readonly inTreeAfter: number | undefined;
  /**
   * The far edge of the caller's direction when the last read that found
   * the target found it wholly beyond it — dumped clipped out past it, or
   * past it in every frame, nothing of it in the frame (Settings' `Apps`
   * clipped out above the list, four strokes down, read "off the viewport,
   * or under the soft keyboard … (a fling?)" without it) —
   * undefined when that read had it anywhere else. Kept across reads that
   * do not find it: the failure's `past` (`shortfall`).
   */
  readonly lastPast: PastSide | undefined;
  /** The direction of the last stroke SENT, a probe included — the way the content last moved, for `dropped`. */
  readonly lastSent: Direction | undefined;
  /** The last read that read: the judged match's rect and the frames it was judged in — undefined when it found no match. */
  readonly lastFound: (FarFacts & { frames: readonly Rect[] }) | undefined;
  /**
   * The target was dropped from the tree by the content's motion — the
   * last read had it short of the far edge of that motion, this one has no
   * match — so the strokes go this way, back, until a read finds it again
   * (`nextStroke`). Not cleared by a read without the target: it is still
   * beyond the edge it left through.
   */
  readonly dropped: Direction | undefined;
  /** The directions the scroll's course strokes were drawn toward (a probe's aside) — whether the other way was ever tried, for the stuck turn. */
  readonly strokedToward: readonly Direction[];
  /**
   * The stuck turn: the
   * direction the target was stuck in when, the other way never stroked,
   * ONE stroke was drawn back instead of failing — set once, never cleared;
   * once only, as after it both ways were stroked (`strokedToward`). `backPending`: that stroke is decided — sent, or
   * held for a presented screen's confirming read at its touch-down (`round`) — and no read that read after it was
   * sent has answered it yet.
   */
  readonly stuckOn: Direction | undefined;
  readonly backPending: boolean;
  /** The whole tree's fingerprint at the last read that read, and identical strokes in a row after which it was unchanged. */
  readonly prevFingerprint: string | undefined;
  /** A read after a stroke found the whole tree changed from the read before — the content moved at least once (`Shortfall.absent`'s `unsearched`: not a screen no stroke ever changed). */
  readonly treeMoved: boolean;
  readonly treeUnmovedStrokes: number;
  /** The top sheet's grabber at the first read that read and at the last (`TreeFacts.detent`); undefined until a read reads. */
  readonly detents: { readonly first: SheetDetent | undefined; readonly last: SheetDetent | undefined } | undefined;
}

/**
 * The COURSE's direction — where the content lies for the scroll: the caller's (`rules.direction`) until the end turn,
 * its opposite after (`EndTurn.to`). What the far edge, the fling's turn and the strokes are judged against.
 */
const courseOf = (s: State): Direction => s.endTurn?.to ?? s.rules.direction;

/** The state before round 0: nothing read, the frame the device as built (`asBuilt`, read before the loop so a device whose screen cannot be read fails there). */
export function startRounds(rules: RoundRules, asBuilt: DeviceScreen): Rounds {
  const box: Rect = { x: 0, y: 0, ...asBuilt };
  const state: State = {
    rules,
    done: false,
    owesDrawn: false,
    swipes: 0,
    // The device as built, as a usable screen of one box and no band — what the rounds judged in before a round read
    // one (the bands come with the first usable screen a round reads; nothing reads `oriented` or `from` of a frame).
    frame: { box, boxes: [box], oriented: box, from: 'device' },
    everFound: false,
    treesRead: 0,
    reads: { count: 0, totalMs: 0, lastMs: 0 },
    lastCover: undefined,
    coveredRounds: 0,
    strokes: startStrokes(),
    since: 'start',
    prevRects: undefined,
    prevBest: undefined,
    allUnmovedStrokes: 0,
    bestUnmovedStrokes: 0,
    streakDrawn: undefined,
    lastDrawn: undefined,
    seenShort: false,
    carriedPast: false,
    confirmReads: 0,
    presentedHold: undefined,
    strokesSent: 0,
    endTurn: undefined,
    lastStroke: rules.direction,
    turns: 0,
    prevKey: undefined,
    inFrameAfter: undefined,
    probe: undefined,
    inTreeAfter: undefined,
    lastPast: undefined,
    lastSent: undefined,
    lastFound: undefined,
    dropped: undefined,
    strokedToward: [],
    stuckOn: undefined,
    backPending: false,
    prevFingerprint: undefined,
    treeUnmovedStrokes: 0,
    treeMoved: false,
    detents: undefined,
  };
  return state as unknown as Rounds;
}

/**
 * The FAR edge of a scroll toward `direction` — the edge of the frame its
 * strokes move content out through (for content below, `down`, the top) —
 * and the NEAR one content comes in through: what `beyondFarEdge` reads of
 * the target and `overFarSide` of a cover over it.
 */
const FAR_EDGE: Readonly<Record<Direction, { readonly far: Edge; readonly near: Edge }>> = {
  down: { far: 'top', near: 'bottom' },
  up: { far: 'bottom', near: 'top' },
  right: { far: 'left', near: 'right' },
  left: { far: 'right', near: 'left' },
};

/**
 * The target lies BEYOND the edge of `frame` that a scroll toward
 * `direction` moves content out through — past that far edge, or across
 * it — and not across the near one: for content below (down) the content
 * moves up, so its top above the frame's top and its bottom inside the
 * frame or above it; for content above (up), mirrored at the frame's
 * bottom (the keyboard's top edge, when the frame is the screen above
 * one); likewise sideways. Content comes in through the near edge, so a
 * target that was ever read short of this and is now beyond it was carried
 * across the frame by a fling (`nextStroke`; measured under
 * WDA: 613 → -357 in one swipe; 681 → -48 for a 52-pt row whose last 4 pt
 * stay on screen behind the top bar) — and swiping the same way again only
 * pushes it further out. A target clipped at BOTH edges (taller than the
 * frame) is not beyond either: turning back could not help it.
 */
function beyondFarEdge(rect: Rect, direction: Direction, frame: Rect): boolean {
  const past: Record<Edge, boolean> = {
    top: rect.y < frame.y,
    bottom: rect.y + rect.height > frame.y + frame.height,
    left: rect.x < frame.x,
    right: rect.x + rect.width > frame.x + frame.width,
  };
  const { far, near } = FAR_EDGE[direction];
  return past[far] && !past[near];
}

/**
 * `beyondFarEdge` in every frame judged — or the target was dumped CLIPPED
 * OUT past that edge of its scroll container (UiNode.clippedOut, the note
 * below): uiautomator inverts the bounds of a node scrolled
 * wholly past its container, the parser clamps it to zero size AT the
 * container's edge — inside the frame, past neither of its edges — and the
 * mark is all that says which way it went. Settings' `Apps` under the
 * collapsing app bar read `126x-132` and was neither beyond the far edge
 * nor in the frame. Beyond, a target a read saw short of the far edge
 * turns the next stroke (`carriedPast`), and one lost after it was there
 * is not `dropped`. Not a stroke turned on the FIRST read (the owner's
 * call, iOS parity — a target read wholly beyond the far edge
 * before any read saw it short is the caller's direction to honour, as
 * `nextStroke` says; a node clipped out has nothing in the frame, so
 * `atFarEdge`, which needs some, never fires for it), nor on any read
 * after until a stroke the caller's way proves the content exhausted
 * that way — the end turn (`EndTurn`, the owner's decision of 2026-10-17,
 * which refines this call).
 * docs/bugs/2026-10-09-android-inverted-uiautomator-bounds-pass-through-as-negative-heights.md
 *
 * Or CUT to a sliver at that edge of its scroll container (`FarFacts
 * .slicedAt`, the standing's `facts.sliver`): the rest of it lies past the far edge as surely as a
 * clipped-out node's does, while its rect, cut to the container, lies
 * inside the frame. A plain stop does not stop on it (`stops`), so without
 * this a 132-px row showing its bottom 40 px at a form's top under a
 * default (down) scroll was pushed out and back until "turned round 3
 * times"; `atFarEdge` turns the next stroke at once. A sliver at the
 * NEAR edge is coming in, and the strokes go on.
 */
function beyondFarEdgeIn(found: FarFacts, direction: Direction, frames: readonly Rect[]): boolean {
  const { far } = FAR_EDGE[direction];
  // Each frame cut to what the target's scroll views draw: their edge is the far edge as the screen's is.
  const cut = (f: Rect): Rect => (found.drawn === undefined ? f : (rectIntersection(f, found.drawn) ?? f));
  return found.clippedOut === far || found.slicedAt === far || frames.every((f) => beyondFarEdge(found.rect, direction, cut(f)));
}

/** What `beyondFarEdgeIn` reads of a match: its rect, the side it was dumped clipped out past, the edge its scroll container cuts it to a sliver at, and the frame its scroll views draw it in (ui-tree/standing.ts#StandingFacts.drawn). */
interface FarFacts {
  readonly rect: Rect;
  readonly clippedOut?: ClippedSide;
  readonly slicedAt?: Edge;
  readonly drawn?: Rect;
}

/** A judged match's `FarFacts`, its rect copied. */
const farFacts = ({ node, standing: { facts } }: Judged): FarFacts => ({
  rect: { ...node.rect },
  ...(node.clippedOut !== undefined && { clippedOut: node.clippedOut }),
  // A container's cut only: the rest of a node cut by a node drawn after it lies under that node, not past the far edge (geometry.ts#Cut.by).
  ...(facts.sliver !== undefined && facts.sliver.by === undefined && { slicedAt: facts.sliver.edge }),
  ...(facts.drawn !== undefined && { drawn: { ...facts.drawn } }),
});

/**
 * `cover`, drawn over the target, lies over its FAR side for a scroll
 * toward `direction` — the side `beyondFarEdge` reads against the frame:
 * over its far edge and short of its near one (for content below, a bar
 * over its top and not its bottom), so the strokes push it further under;
 * a cover over both edges (a sheet over the whole row), or over neither (a
 * badge inside it), is no side's — turning back could not uncover it. And
 * only a cover in `frame`'s FAR HALF (its centre past the frame's middle
 * toward the far edge — above it, for content below): the edge test alone
 * does not say where the cover sits, and a row coming in from below whose
 * top is under a bottom bar (CONTINUE at 780, the row at 785; a snackbar;
 * a floating tab bar or a FAB) has the bar over its far edge too — it was
 * turned away from the bar it was about to clear, and bounced for five
 * strokes where one stopped it. A
 * pinned bar sits at the edge it is pinned to, so the half it lies in is
 * that edge's. A cover centred exactly on the middle lies in neither far
 * half: not turned for, either way. Or, in that half, a cover the target
 * shows past only on its far side (`showsOnlyPast`): a bar a
 * few points short of the row's far edge and over the rest of it.
 */
function overFarSide(rect: Rect, direction: Direction, cover: Rect, frame: Rect): boolean {
  const over: Record<Edge, boolean> = {
    top: cover.y <= rect.y,
    bottom: cover.y + cover.height >= rect.y + rect.height,
    left: cover.x <= rect.x,
    right: cover.x + cover.width >= rect.x + rect.width,
  };
  // Twice the centre against twice the middle: whole numbers, no rounding at the boundary.
  const vertical = 2 * cover.y + cover.height - (2 * frame.y + frame.height);
  const sideways = 2 * cover.x + cover.width - (2 * frame.x + frame.width);
  const inHalfOf: Record<Edge, boolean> = { top: vertical < 0, bottom: vertical > 0, left: sideways < 0, right: sideways > 0 };
  const { far, near } = FAR_EDGE[direction];
  return inHalfOf[far] && ((over[far] && !over[near]) || showsOnlyPast(rect, far, cover, frame));
}

/**
 * Everything of the target that shows past `cover` lies between the
 * frame's `far` edge and the cover's — and some does: the target, cut to
 * the frame, sticks out past the cover's far edge, and the rest of it lies
 * under the cover, across the whole of its width (its height, sideways).
 * The second way `overFarSide` reads a cover over the far side (a device
 * check's residual): Contacts' New Contact under
 * idb, `add url` at `20,78 362x51` under the sheet's `Toolbar` `0,83
 * 402x48` — the bar starts 5 pt BELOW the row's top, so it is not over the
 * row's far edge, and it reaches past its near one; it was stroked the
 * wrong way once or twice before the turn. The strip that shows is at the
 * far edge's side of the bar: strokes push it further under, a stroke back
 * brings the row out below the bar. No pixel slack: a bar starting any
 * distance below the row's top counts, as long as nothing of the row shows
 * on the bar's other side or beside it — a badge inside a row, or a bar
 * narrower than it, leaves some showing there and is no side's.
 */
function showsOnlyPast(rect: Rect, far: Edge, cover: Rect, frame: Rect): boolean {
  const inFrame = rectIntersection(rect, frame);
  if (inFrame === undefined) return false;
  const vertical = far === 'top' || far === 'bottom';
  // Along the scroll: [lo, hi) of the target in the frame and of the cover; across it, the target's span must lie in the cover's.
  const [lo, hi] = vertical ? [inFrame.y, inFrame.y + inFrame.height] : [inFrame.x, inFrame.x + inFrame.width];
  const [from, to] = vertical ? [cover.y, cover.y + cover.height] : [cover.x, cover.x + cover.width];
  const across = vertical
    ? cover.x <= inFrame.x && cover.x + cover.width >= inFrame.x + inFrame.width
    : cover.y <= inFrame.y && cover.y + cover.height >= inFrame.y + inFrame.height;
  // Some of it past the cover's far edge, the rest under the cover through to its near end.
  return across && (far === 'top' || far === 'left' ? lo < from && hi > from && hi <= to : hi > to && lo < to && lo >= from);
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

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** What one read that read says about motion (`observe`). */
interface Observed {
  /** The judged match is where the previous read's judged match was. */
  bestUnmoved: boolean;
  /**
   * UNMOVED_STROKES_EXHAUST identical strokes in a row left the JUDGED match
   * where it was — the `fully: true` clipped stop's "content exhausted".
   */
  stuck: boolean;
  /**
   * UNMOVED_STROKES_EXHAUST identical strokes in a row left EVERY match
   * where it was, and the target is off the frame (`matches`); or left the
   * whole tree as it was, and the target is not in it (`tree`).
   */
  exhausted: 'matches' | 'tree' | undefined;
  /**
   * The exhaustion PROVEN by the tree, after one unmoved stroke (UNMOVED_STROKES_EXHAUST says why one alone is no proof
   * otherwise): the scroll view the stroke went over, whose content this read lists ending the way that stroke went
   * (interact/stroke-plan.ts#strokedEnd) — set only with `exhausted`, on the read right after a stroke toward the
   * target (not the flush check's probe) that moved nothing: every match where it was, or, with no target in the tree,
   * the whole tree unchanged; never while a progress node shows, nor of a stroke that touched down on a node drawn over
   * its scroll view (`touchedOn`: that node may have taken it, and the fast fail names it first); and only of a scroll
   * view that scrolls along the stroke's axis (geometry.ts#Clips.endsAt). What counts as proof, stated: the tree's listing of
   * the content, not the strokes — a stroke not taken moves nothing too, but cannot make a list's content end where
   * the tree shows it ending; and the read unmoved besides, so a list still settling (a bounce at its end, momentum
   * from an earlier stroke) reads moved and proves nothing until a read finds it still.
   */
  ends: UiNode | undefined;
}

/**
 * One read that read (`ThisRead`): every match found, the one judged, the
 * frames it was judged in, and the swipe count — recorded into `s`. `current` is what the
 * read followed. Where the target stands against the far edge is recorded
 * HERE, on every read — a stop round strokes nothing, and a target seen
 * short only at a stop the confirming read then lost must still turn the
 * next stroke.
 */
function observe(s: Mutable<State>, current: Since, now: ThisRead, best: Judged | undefined): Observed {
  const { read, facts, frames, uncutFrames } = now;
  const { found } = read;
  const { fingerprint, loading } = facts;
  const rects = found.map((n) => ({ ...n.rect }));
  const bestUnmoved = best !== undefined && s.prevBest !== undefined && sameRectWithinPixel(s.prevBest, best.node.rect);
  // This read against the one before it, after a stroke: every match where it was, the whole tree as it was.
  let allUnmoved = false;
  let treeUnmoved = false;
  if (current === 'stroke') {
    // The whole tree, for a target not in it (UNMOVED_STROKES_EXHAUST):
    // the same streak rule, over the fingerprint.
    treeUnmoved = s.prevFingerprint === fingerprint && !loading;
    if (s.prevFingerprint !== undefined && s.prevFingerprint !== fingerprint) s.treeMoved = true;
    const sameAsStreak = s.streakDrawn !== undefined && s.lastDrawn !== undefined && sameStroke(s.streakDrawn, s.lastDrawn);
    s.treeUnmovedStrokes = !treeUnmoved ? 0 : s.treeUnmovedStrokes > 0 && sameAsStreak ? s.treeUnmovedStrokes + 1 : 1;
    // Every match, not only the judged one, for "exhausted": with several matches off the frame the judged one is the first
    // in tree order, which can be a static duplicate (another page, a
    // hidden copy) while the real one moved.
    allUnmoved = s.prevRects !== undefined && sameRects(s.prevRects, rects);
    const same = s.streakDrawn !== undefined && s.lastDrawn !== undefined && sameStroke(s.streakDrawn, s.lastDrawn);
    s.allUnmovedStrokes = !allUnmoved ? 0 : s.allUnmovedStrokes > 0 && same ? s.allUnmovedStrokes + 1 : 1;
    s.bestUnmovedStrokes = !bestUnmoved ? 0 : s.bestUnmovedStrokes > 0 && same ? s.bestUnmovedStrokes + 1 : 1;
    s.streakDrawn = s.lastDrawn;
  }
  s.prevRects = rects;
  s.prevFingerprint = fingerprint;
  s.carriedPast = false;
  // Dropped (the lazy-list note, UNMOVED_STROKES_EXHAUST's): the last read had the target SHORT of the far
  // edge of the content's last motion — inside the frame, under the
  // keyboard, or not yet in — and this read, after a stroke or a settle
  // since one, has no match. A lazy list (RecyclerView, LazyColumn) keeps a
  // row in the tree only while it intersects the list, and on Android a
  // row's bounds never pass the list's edge (they are cut to it), so
  // `carriedPast` — which needs a read to FIND the target beyond the far
  // edge — can never fire there: the row is in one read and absent from
  // the next. It can only have left through the edge the content moved
  // toward: measured, Contacts' `Last name` clipped by the IME, one stroke
  // down, gone, and four more strokes down into the end of the editor.
  // The strokes go back (`dropped`, `nextStroke`) — a turn, halving
  // the reach like any — until a read finds it.
  if (best === undefined && current !== 'start' && s.lastFound !== undefined && s.lastSent !== undefined) {
    if (!beyondFarEdgeIn(s.lastFound, s.lastSent, s.lastFound.frames)) s.dropped = OPPOSITE[s.lastSent];
  }
  s.lastFound = best === undefined ? undefined : { ...farFacts(best), frames };
  if (best !== undefined) {
    s.dropped = undefined;
    s.inTreeAfter = s.swipes;
    // What the stroke just sent carried the target (interact/stroke-plan.ts#carried, the carry model): only on a tree
    // that lists it where it lies (its drawn frame known — WDA's unclipped frames), only after a stroke of the course
    // (not the probe), and only of the SAME node at the same size — a judged match that switched to another node, or
    // one that changed size, moved by no stroke.
    const key = identityOf(best.node);
    const same = s.prevBest !== undefined && s.prevKey === key && sameSize(s.prevBest, best.node.rect);
    if (current === 'stroke' && s.probe === undefined && same && s.prevBest !== undefined && s.lastSent !== undefined && s.lastDrawn !== undefined && best.standing.facts.drawn !== undefined) {
      s.strokes = carried(s.strokes, { moved: motionToward(s.prevBest, best.node.rect, s.lastSent), drawn: s.lastDrawn });
    }
    s.prevKey = key;
    s.prevBest = { ...best.node.rect };
    // In EVERY frame the round judged in: a target beyond the far edge one
    // way up but across both edges the other is not turned for. Or dumped
    // clipped out past it, or cut to a sliver at it (`beyondFarEdgeIn`).
    const beyond = beyondFarEdgeIn(farFacts(best), courseOf(s), frames);
    // Kept whatever the target showed: only a read with none of it in the
    // frame reaches the failure's `past` (`left` needs it never in the
    // frame, `offFrame` this read's match at visible 0).
    const { far } = FAR_EDGE[courseOf(s)];
    s.lastPast = beyond ? { side: far, clippedOut: best.node.clippedOut === far } : undefined;
    // docs/bugs/2026-10-09-ios-scroll-until-never-turns-back-when-target-stays-clipped-or-in-status-band.md
    // Or IN the frame at that edge: across it — clipped there, or into a system
    // band, which the frames are cut clear of — or under something of the app
    // drawn over its far side. Read so before any read saw it short, it
    // was never carried past, so `seenShort` alone never turned it: the
    // strokes pushed it on out through that edge — and at the end of the
    // content no stroke moves it, so they never did: measured, a row
    // resting at y 20 swiped down six times to maxSwipes, one at -20
    // "content exhausted … a layout defect" after two, and from -20
    // `direction: "up"` flung it to 771 under CONTINUE and swiped up six
    // times more. The target is right there: the strokes turn at once.
    // Where a cover presses, as exposure judged it (the standing's
    // `facts.reaches`): CONTINUE pinned at idb's flat list reaches the
    // screen's bottom, so the row flung to 776–828 has it over its far
    // (bottom) side — its frame, 780–824, is over neither edge.
    const overFar = (cover: Rect) => frames.every((f) => overFarSide(best.node.rect, courseOf(s), cover, f));
    const atFarEdge = best.standing.facts.visible > 0 && (beyond || best.standing.facts.reaches.some(overFar));
    s.carriedPast = (beyond && s.seenShort) || atFarEdge;
    if (!beyondFarEdgeIn(farFacts(best), courseOf(s), uncutFrames)) s.seenShort = true;
    if (best.standing.facts.visible > 0) s.inFrameAfter = s.swipes;
  }
  const offFrame = best !== undefined && best.standing.facts.visible === 0 && found.some((n) => n.rect.width > 0 && n.rect.height > 0);
  // The tree's proof (`Observed.ends`): asked only of a read a stroke toward the target left unmoved, and never while a
  // progress node shows (content may yet load there). The flush probe (PROBE_REACH) never meets it, by the trees'
  // dialects: a probe is planned only over CLIPPING ancestors (`scrollersOf`), which only Android's tree marks, and the
  // proof needs `Clips.endsAt`, which only a tree of unclipped frames (WDA's) answers — no real source gives both. The
  // probe's own answer is the stop it checks (pinned, on a synthetic tree carrying both marks, in
  // tests/interact/scroll-end-turn.test.ts).
  const unmovedNow = (offFrame && allUnmoved && !loading) || (found.length === 0 && treeUnmoved);
  // Nor of a stroke that touched down on a node drawn over its scroll view (`touchedOn`): that node may have taken it,
  // and the fast fail names it first — the two-stroke rule's sentence, as before the proof.
  const ends =
    current === 'stroke' && unmovedNow && s.lastSent !== undefined && touchedOn(s.strokes, facts, s.lastDrawn) === undefined
      ? strokedEnd(s.strokes, facts, s.lastSent)
      : undefined;
  const exhausted =
    offFrame && (s.allUnmovedStrokes >= UNMOVED_STROKES_EXHAUST || ends !== undefined)
      ? 'matches'
      : current === 'stroke' && found.length === 0 && (s.treeUnmovedStrokes >= UNMOVED_STROKES_EXHAUST || ends !== undefined)
        ? 'tree'
        : undefined;
  return {
    bestUnmoved,
    stuck: current === 'stroke' && s.bestUnmovedStrokes >= UNMOVED_STROKES_EXHAUST,
    exhausted,
    ends: exhausted === undefined ? undefined : ends,
  };
}

/** Another confirming read is within the stroke's budget and the deadline. */
const mayConfirm = (s: State, elapsedMs: number): boolean => s.confirmReads < SETTLE_CONFIRM_READS && elapsedMs < s.rules.timeoutMs;

/**
 * The next stroke (the WDA device check): toward the caller's
 * direction — unless the last read that read found a fling carried the
 * target across the frame since a read saw it short of the far edge
 * (`observe`; measured 613 → -357 in one swipe, then five more swipes DOWN
 * into exhausted content). Then the other way, to bring it back; a stroke
 * that throws it back past the near edge leaves it short again, and the
 * next stroke goes the caller's way. A target read wholly beyond the far
 * edge before any read saw it short of it — above the screen on round 0 of
 * a scroll down, and every round after while it stays there — is the
 * caller's direction to honour — until a stroke that way proves the
 * content exhausted: the end turn (`EndTurn`) turns the course itself,
 * which this reads in place of the caller's direction, at full reach; one
 * any of which lies in the frame is not (`atFarEdge`, below). That needs the target to
 * STAY in the tree once off the frame; a lazy list (Android
 * RecyclerView/LazyColumn, iOS List/UITableView under WDA) drops it, and
 * on Android its bounds never pass the list's edge anyway. A read that LOSES the target it last read short of the far
 * edge of the content's last motion turns the strokes too (`dropped`,
 * recorded in `observe`): back the way the content came, until a read
 * finds it — a turn like this one, the reach halved. What is left: a
 * target no read ever had (the stroke must not carry it across the list
 * between two reads — the drag speed, adapters/android.ts#dragSpeed, is
 * what keeps that from happening on Android; iOS strokes at its default).
 *
 * Converging is deliberate: every direction change
 * halves the reach of every stroke after it (`reach`, applied with
 * swipe.ts#shortenStroke — the touch-down kept, never under twice
 * TOUCH_SLOP nor 3 % of the box's side along it). A fling is the app's: with the measured content-down fling
 * (−729 to −970 pt for the 344-pt stroke) and a content-up fling of the
 * same size, full strokes both ways ping-pong round the target to
 * `maxSwipes`; with the reach halved per turn the distance left shrinks
 * geometrically whatever the app flings. A turn that overshoots too is
 * turned again, not given up — giving up would swipe on into content the
 * target has passed — and the failure counts the turns.
 *
 * The reach is deliberately NEVER restored after a turn, not even on
 * strokes back toward the caller's direction: a turn
 * means the target was within one move of the frame and a full stroke
 * just carried it past — the distance left is less than what that stroke
 * moves. Restoring the reach would draw that stroke again and bring the
 * oscillation back. The cost: a scroll that turned once early keeps the
 * shorter strokes (and spends more of `maxSwipes`) if the target then
 * turns out to be further away than one move.
 *
 * And, on a tree that lists the target where it lies (WDA's), no stroke
 * reaches further than the target still needs at what a stroke of this
 * scroll was measured to carry it (`stillNeeds`, interact/stroke-plan.ts#carried): a short scroll view's
 * fling carried a row past its window between two reads (lab note LV5) —
 * and any window one stroke can skip, a long list's final approach too.
 *
 * A target IN the frame at the far edge turns the strokes too
 * (`observe`'s `atFarEdge`): across that edge, its centre in the status
 * band past it, or under a cover over its far side — on the first read as
 * on any. Stroked on the caller's way, at the end of the content no stroke
 * carries it anywhere and the turn never comes — measured, `maxSwipes`, or
 * "content exhausted … a layout defect" for a row one stroke back would
 * have revealed. A target short at the NEAR edge (a pinned bar over a row
 * coming in from below) is stroked on the caller's way. A cover counts
 * only in the frame's far half (`overFarSide`). One stuck in the frame,
 * the other way never stroked, gets one stroke back before the layout
 * defect is declared (`round`'s stuck turn).
 */
function nextStroke(s: State): { toward: Direction; reach: number; turn: boolean } {
  const back = s.backPending && s.stuckOn !== undefined ? OPPOSITE[s.stuckOn] : undefined;
  const toward = s.dropped ?? back ?? (s.carriedPast ? OPPOSITE[courseOf(s)] : courseOf(s));
  // A turn: drawn the other way from the last stroke sent — the one test the
  // reach and the turn count share. The FIRST stroke is one too when it is
  // drawn back from a target read at the far edge in the frame (`observe`):
  // the target is within one move, so it gets a turn's reach — the measured
  // 262-pt stroke that brings a row at y 20 to 563. Not one drawn back after
  // a probe dropped the target (`dropped`): no stroke of the scroll's course
  // went the other way.
  const turn = toward !== s.lastStroke && (s.strokesSent > 0 || s.dropped === undefined);
  return { toward, reach: 0.5 ** (turn ? s.turns + 1 : s.turns), turn };
}

/**
 * What the target STILL NEEDS of a stroke toward `toward` (lab note LV5; the carry model that turns it into a stroke is
 * interact/stroke-plan.ts#carried's): once it lies in the tree short of its window — past the window's near edge, the
 * side content comes in through — `needs`, the distance that brings it to the window's middle, and `slack`, how far
 * the window lets it travel while whole in it (the window's side less its own). The window is what the target's
 * scroll views draw met with every frame judged (`FarFacts.drawn`): known on WDA's trees only, where an off-screen row
 * is listed where it lies — not on Android's (its strokes drag at `dragSpeed`, no fling, and its rects are cut to the
 * scroll container, so a row's motion as it comes in reads short) nor on idb's flat list. Undefined otherwise.
 * docs/bugs/2026-10-17-lab-ios-wda-scroll-until-overshoots-a-row-of-a-short-scroll-view-and-spends-its-budget.md
 */
function stillNeeds(found: FarFacts & { frames: readonly Rect[] }, toward: Direction): StillNeeds | undefined {
  if (found.drawn === undefined) return undefined;
  const window = found.frames.reduce<Rect | undefined>((w, f) => (w === undefined ? undefined : rectIntersection(w, f)), found.drawn);
  if (window === undefined) return undefined;
  const { rect } = found;
  const vertical = toward === 'up' || toward === 'down';
  // Along the scroll: how far past the window's near edge the target's far end lies, and the room the window leaves it.
  const [lo, len, wLo, wLen] = vertical ? [rect.y, rect.height, window.y, window.height] : [rect.x, rect.width, window.x, window.width];
  const need = toward === 'down' || toward === 'right' ? lo + len - (wLo + wLen) : wLo - lo;
  const slack = Math.max(0, wLen - len);
  return need <= 0 ? undefined : { needs: need + slack / 2, slack };
}

/** A judged match's identity across reads, for the carry model's samples: its role, id and label — a node's rect is what moves. */
const identityOf = (n: UiNode): string => JSON.stringify([n.role, n.identifier, n.label]);

/** The same size within a pixel each way: a node that grew or shrank (a header collapsing) did not just move. */
const sameSize = (a: Rect, b: Rect): boolean => Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;

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

/**
 * One round: what `seen` means for the scroll, and the next step (the
 * module doc has the protocol, the order and the bound). Pure.
 */
export function round(state: Rounds, seen: RoundSeen): { state: Rounds; step: RoundStep } {
  const input = state as unknown as State;
  if (input.done) throw new Error('scroll round after the scroll stopped');
  if (input.owesDrawn !== (seen.drawn !== undefined)) {
    throw new Error(input.owesDrawn ? 'scroll round after a stroke without the stroke drawn' : 'scroll round with a stroke drawn but none asked for');
  }
  const s: Mutable<State> = { ...input, owesDrawn: false };
  const ask = (what: 'witness' | 'unlocated'): Next => ({ state, step: { do: 'ask', what } });
  const { fully } = s.rules;
  const current = s.since;
  if (seen.drawn !== undefined) s.lastDrawn = seen.drawn;

  const read = 'error' in seen.read ? undefined : seen.read;
  const readError = 'error' in seen.read ? seen.read.error : undefined;
  s.reads = { count: s.reads.count + 1, totalMs: s.reads.totalMs + seen.readMs, lastMs: seen.readMs };
  if (read !== undefined) {
    s.treesRead++;
    if (seen.screen !== undefined) s.frame = seen.screen;
  }
  const found = read?.found ?? [];
  if (found.length > 0) s.everFound = true;
  const viewport = s.frame.box;

  // What this read means (interact/scroll-read.ts#judgeRead): the tree's
  // facts, the cover that applies and the one offered, the best match
  // judged and the frames — or the witness to ask first, which changes
  // nothing (the state comes back as it went in). A round whose tree did
  // not read judges nothing.
  const judged = read === undefined ? undefined : judgeRead(read, s.frame, fully, seen.corroborated);
  if (judged !== undefined && 'ask' in judged) return ask(judged.ask);
  const best = judged?.best;
  const cover = judged?.cover;
  const offered = judged?.offered;
  if (cover !== undefined) {
    s.lastCover = cover;
    s.coveredRounds++;
  }
  // What the strokes after this read keep of it (interact/stroke-plan.ts#seeRead): the line its strokes stay above
  // (`ReadJudgement.strokeLine`) — a round whose tree did not read keeps the last read round's, as its cover — and,
  // when it found the target, the target's scroll views with what this read draws over each.
  if (judged !== undefined) s.strokes = seeRead(s.strokes, { facts: judged.facts, line: judged.strokeLine, target: best?.node });
  // A read that did not read says nothing about motion: the comparisons
  // wait for the next one that does.
  const gesture = seen.screen?.oriented;
  const now: ThisRead | undefined = read === undefined || judged === undefined ? undefined : { read, facts: judged.facts, frames: judged.frames, uncutFrames: judged.uncutFrames };
  const observed = now === undefined ? undefined : observe(s, current, now, best);
  if (now !== undefined) s.detents = { first: s.detents === undefined ? now.facts.detent : s.detents.first, last: now.facts.detent };
  // The probe this read answers (PROBE_REACH) — kept across a read that did
  // not read, which is read again below rather than stroked away from.
  const probed = s.probe;
  if (read !== undefined) s.probe = undefined;

  // The stroke back (`stuckOn`) is answered by the first read that reads
  // after it; a round whose tree did not read strokes as the last read
  // round decided — back. Only a read after the stroke was SENT answers it:
  // one held for a presented screen's confirming read (the touch-down stop,
  // below) is still to be sent, and that read — no stroke between — would
  // otherwise read "unmoved" and say swiping back moved nothing.
  // `presentedHold` is this read's to set again (below).
  const presentedBefore = s.presentedHold !== undefined;
  if (now !== undefined) s.presentedHold = undefined;
  const answersBack = now !== undefined && current === 'stroke' && s.backPending;
  if (answersBack) s.backPending = false;
  if (best !== undefined && best.standing.facts.visible > 0 && observed !== undefined && now !== undefined) {
    if (stops(best)) {
      // The probe moved nothing: the match is where it was sent from — the
      // stop holds (it held still through a stroke), and nothing lies
      // beyond its flush edge.
      const probeHeld = probed !== undefined && sameRectWithinPixel(probed.rect, best.node.rect);
      // …and was a stroke: one drawn shorter than twice the slop may have
      // been a tap, and a tap moves nothing whatever lies beyond the edge.
      const probeStroked = probeHeld && s.lastDrawn !== undefined && strokeLength(s.lastDrawn) >= 2 * TOUCH_SLOP;
      // A stop after a stroke is reported only once a read finds the target
      // where the last one did (SETTLE_CONFIRM_READS): a fling can carry it
      // on, or out of the frame, after the settle read caught it inside. A
      // stop at 0 swipes was not stroked: reported at once.
      const settled = s.swipes === 0 || probeHeld || (current === 'settle' && observed.bestUnmoved);
      if (!settled && mayConfirm(s, seen.elapsedMs)) return confirm(s);
      // `fully: true`, an edge flush with the clipping container: possibly cut there — probe once toward it
      // (`flushCheck`), or say it could not be checked.
      const checked = fully ? flushCheck(s, { best, facts: now.facts, probeHeld, probeStroked, gesture, cover, offered, seen, ask }) : undefined;
      if (checked !== undefined && 'step' in checked) return checked;
      const flush = checked;
      // The `unlocated` row on a `fully: true` stop only — where the answer
      // changes what the reader does next — and only with no cover under
      // the judgement: a band THIS stop was judged under is what it reports.
      let unlocated = false;
      if (fully && best.under === undefined) {
        if (seen.unlocated === undefined) return ask('unlocated');
        unlocated = seen.unlocated;
      }
      return stop(s, { kind: 'visible', swipes: s.swipes, judged: best, settled, unlocated, ...(flush !== undefined && { flush }) });
    }
    // Under a screen presented over it (ADR 0018) no swipe moves it out, and a swipe on that screen may
    // dismiss it: one more read with no stroke between, then stop — or, should the screen be gone by
    // then, the read above stops as any other. Without a confirm left, stop on this read.
    // The standing's own remedy decides it (ui-tree/standing.ts#Remedy, presented first, whatever the kind) — when the
    // presented surface lies over it IN this read's frame (`facts.presented`). One the standing judged of the node
    // alone (draw-order.ts#DrawOrder.presentedOver: nothing of that surface over what shows of it) is the stroke's to
    // ask, at its touch-down (the stroke plan's `presented`): a stroke that misses that screen is sent.
    const remedy = best.standing.kind === 'reachable' ? undefined : best.standing.remedy;
    if (remedy?.of === 'presented' && best.standing.facts.presented !== undefined) return holdPresented(s, { kind: 'presented', swipes: s.swipes, judged: best, cover: remedy.cover, viewport, ...(remedy.layer !== undefined && { layer: remedy.layer }) }, current === 'settle' && presentedBefore, seen.elapsedMs);
    // Still clipped (`fully: true`) or under something of the app — only a
    // swipe that MOVES it can help.
    // The stuck turn: the
    // far-edge reading (`observe`'s `atFarEdge`) turns a target short at the
    // edge the strokes push it out through, but not one whose shortfall no
    // edge test sees — measured shape: from -20, `direction: "up"` flung the
    // row to 776, its top under CONTINUE (24,780 354x44) and its bottom
    // (828) below the bar's (824), so no side of it was the bar's, and two
    // unmoved strokes up read "content exhausted … a layout defect" where
    // one stroke back revealed it. So a target stuck IN the frame, the other
    // way never stroked, gets ONE stroke the other way (a turn, the reach
    // halved) before the defect is declared; when that stroke moves it
    // neither, the defect stands at once — the content was already
    // exhausted the stuck way, and one unmoved stroke back says the rest.
    // Cost: one stroke on every real defect (a row under a pinned bar at
    // the end of the content), and the stroke may move the row the wrong
    // way — after which the strokes go the caller's way again, and a second
    // stuck is declared. Not when that stroke would pass the
    // bound: the stuck sentence beats "maxSwipes".
    // Not for a sliver stuck on strokes toward its cut edge: the content is exhausted where
    // the rest of it lies, and a stroke the other way only pushes it out
    // through that edge — measured on the fake, a whole 50-px row at a
    // list's top, its image flush with that top (geometry.ts#evidentCut's
    // residual), swung out and lost after 5 swipes. `outward`, said so.
    const backUnmoved = answersBack && observed.bestUnmoved;
    const stuckOn = backUnmoved ? s.stuckOn : observed.stuck ? s.lastStroke : undefined;
    if (stuckOn !== undefined) {
      const { sliver } = best.standing.facts;
      const outward = !fully && sliver !== undefined && SIDES[sliver.edge].reveals === stuckOn;
      const otherWay = backUnmoved ? 'unmoved' : outward ? 'outward' : s.strokedToward.includes(OPPOSITE[stuckOn]) ? 'stroked' : 'untried';
      const turnBack = otherWay === 'untried' && s.swipes < s.rules.maxSwipes && seen.elapsedMs < s.rules.timeoutMs;
      if (!turnBack) return stop(s, { kind: 'stuck', swipes: s.swipes, short: shortOf(best), lastStroke: stuckOn, viewport, otherWay });
      s.stuckOn = stuckOn;
      s.backPending = true;
    }
  }
  // A confirming read that did not read, or the read after a probe: read
  // again, within the same budget, rather than stroke away from a stop the
  // last read saw.
  if ((current === 'settle' || s.probe !== undefined) && read === undefined && mayConfirm(s, seen.elapsedMs)) return confirm(s);
  // A presented stop held for its confirming read (`presentedHold`) and no read left to confirm it with: stop as the
  // last read that read left it — never a stroke drawn blind, which would land on the screen that read saw presented
  // (a read failing three times after the popover's hold had stroked onto its dim). Not a wait to the deadline: the
  // reads are failing, and the last one that read is the evidence there is.
  if (read === undefined && s.presentedHold !== undefined) return stop(s, s.presentedHold);
  const evidence: WaitEvidence = { sighted: s.everFound, treesRead: s.treesRead, readError };
  // A keyboard that leaves nothing above it: nothing but its own UI can be
  // judged, and no stroke can start on the content — fail now, naming it,
  // rather than swipe on keys or fall back to the whole screen and report a
  // bare "fully visible".
  if (cover !== undefined && cover.above === undefined) return stop(s, { kind: 'covered', swipes: s.swipes, cover, viewport, evidence });
  // In the tree, off the frame, and the last UNMOVED_STROKES_EXHAUST
  // strokes — the same stroke — moved no match (the Android device check:
  // the form's last field, wholly under an IME its
  // container does not resize for, swiped for the whole 15 s): fail now
  // with the stop bound's own words — they already name the keyboard and
  // the way to hide it. See `observe` for what counts.
  let exhausted = observed?.exhausted;
  // The end turn (`EndTurn`): the content proven exhausted the caller's way, and the target past the far edge of the
  // very scroll view that proved it — turn once toward it, rather than fail with that direction as advice. Only while a
  // swipe and time are left for it: at the bound the failure names the side, as before.
  const ends = observed?.ends;
  if (exhausted === 'matches' && ends !== undefined && best !== undefined && now !== undefined && s.swipes < s.rules.maxSwipes && seen.elapsedMs < s.rules.timeoutMs && turnsAtEnd(s, best, ends, now.facts)) {
    turnAtEnd(s, ends);
    exhausted = undefined;
  }
  // The stroke this round would draw, asked of the plan once (interact/stroke-plan.ts#planStroke): toward the course's
  // direction, at its reach (`nextStroke`), over this round's gesture box, with this read's facts — its scroll view,
  // box and cover, the points the driver sends, and the presented surface those points touch down on. A bound quotes
  // that surface; the course holds for it or sends the stroke.
  const { toward, reach, turn } = nextStroke(s);
  const still = s.lastFound === undefined ? undefined : stillNeeds(s.lastFound, toward);
  const plan = planStroke(s.strokes, { toward, reach, gesture, read: now === undefined ? undefined : { facts: now.facts, target: best?.node }, ...(still !== undefined && { still }) });
  // The plan's memory, kept at once whatever becomes of the stroke — the candidates it judged, the latest cut of the
  // target's scroll views, and the scroll view it chose, which only sending makes the last stroke's (`strokeSent`,
  // below). Kept here, before any branch, so a presented hold cannot leave it behind; a bound is a stop, whose state
  // no round reads again.
  s.strokes = plan.memory;
  if (exhausted !== undefined || s.swipes >= s.rules.maxSwipes || seen.elapsedMs >= s.rules.timeoutMs) {
    // The `unlocated` row, asked of the last round's reading whatever came
    // before — a round whose tree did not read has none.
    let unlocated = false;
    if (read !== undefined) {
      if (seen.unlocated === undefined) return ask('unlocated');
      unlocated = seen.unlocated;
    }
    const touched = exhausted === undefined || now === undefined ? undefined : touchedOn(s.strokes, now.facts, s.lastDrawn);
    // Where the swipe the bound held back would have touched down, when that is a presented screen's surface: said,
    // since the reader's next step would otherwise be another scroll that lands there (the plan's `presented`).
    // Quoted only on behalf of a target: with none in the tree the bound says nothing of where its held-back swipe
    // would land.
    const onPresented = best === undefined ? undefined : plan.presented;
    const by: BoundBy =
      exhausted !== undefined
      ? {
          of: 'exhausted',
          lastStroke: s.lastStroke,
          unchanged: exhausted,
          ...(touched !== undefined && { touched }),
          ...(ends !== undefined && { ends: { scrollView: named(ends), strokes: exhausted === 'tree' ? s.treeUnmovedStrokes : s.allUnmovedStrokes } }),
        }
      : s.swipes >= s.rules.maxSwipes
        ? { of: 'maxSwipes' }
        : { of: 'timeout', timeoutMs: s.rules.timeoutMs, elapsedMs: seen.elapsedMs, reads: s.reads };
    return stop(s, {
      kind: 'bound',
      swipes: s.swipes,
      by,
      short: shortfall(s, { readError, found, best, viewport, cover, windowHint: read === undefined ? undefined : activeWindowHint(read.tree) }, by),
      turns: s.turns,
      ...(s.lastCover !== undefined && { keyboard: { cover: s.lastCover, rounds: s.coveredRounds, read: s.treesRead } }),
      unlocated,
      evidence,
      ...(onPresented !== undefined && { presented: onPresented }),
    });
  }
  // Where this stroke would touch down, asked on behalf of a target this read holds but did not judge in the frame
  // (off it, under the soft keyboard, cut or clipped, or short of the stop under something of its own screen): a
  // surface of a screen PRESENTED over the target's there (the plan's `presented`) means the stroke lands on that
  // screen, not on the target's — it moves nothing toward the target and may dismiss the screen: the device check
  // stroked from (201,699) for a cell below the fold of Contacts' New Contact sheet, closed the "Discard Changes"
  // popover over it, and read the cell "fully visible after 1 swipe"; under the SWIFT form's Fees half sheet two
  // strokes moved the sheet to another detent and read "content exhausted". So, as for a target judged under such a
  // screen (above): one more read with no stroke between, then stop `presented` — or, should the screen be gone from
  // the touch-down by then, stroke as before. And on behalf of NO target (none in the tree): a stroke that would touch
  // down on a layer the tree marks as presented — an alert, an action sheet, a popover, a `screen` layer (its reach is
  // the whole screen) — lands on it, not on any screen beneath it — the same hold and stop, it named; one on a scroll
  // view of that layer's own (a search inside a sheet's list) is sent. A screen presented by shape alone is still
  // stroked over for a target not in the tree: it has nothing to ask on behalf of. One question of the scene, at the
  // touch-down of the points as sent (the plan's `presented`, ui-tree/standing.ts#Scene.presentedAt).
  if (plan.presented !== undefined) {
    return holdPresented(s, { kind: 'presented', swipes: s.swipes, judged: best, viewport, next: plan.presented }, current === 'settle' && presentedBefore, seen.elapsedMs);
  }
  s.strokes = strokeSent(s.strokes);
  if (turn) s.turns++;
  if (!s.strokedToward.includes(toward)) s.strokedToward = [...s.strokedToward, toward];
  s.strokesSent++;
  s.lastStroke = toward;
  s.lastSent = toward;
  s.confirmReads = 0;
  s.since = 'stroke';
  s.swipes++;
  s.owesDrawn = true;
  return { state: s as unknown as Rounds, step: { do: 'stroke', ...plan.stroke } };
}

/** One round's step, as `round` returns it. */
type Next = { state: Rounds; step: RoundStep };

/** What the flush check reads of the round (`flushCheck`). */
interface FlushRound {
  /** The judged match, a stop in the frame. */
  readonly best: Judged;
  readonly facts: TreeFacts;
  /** The probe in flight came back with the match where it was sent from (`round`), and was drawn as a stroke, not a tap. */
  readonly probeHeld: boolean;
  readonly probeStroked: boolean;
  /** The round's gesture box (`RoundSeen.screen`'s `oriented`). */
  readonly gesture: Rect | undefined;
  /** The keyboard cover the read applied, and the one it offered the witness (scroll-read.ts#ReadJudgement). */
  readonly cover: Cover | undefined;
  readonly offered: Cover | undefined;
  readonly seen: RoundSeen;
  /** `round`'s ask: the state as it came in, the question asked. */
  readonly ask: (what: 'witness') => Next;
}

/**
 * The flush check of a `fully: true` stop (PROBE_REACH): where the match lies flush with its clipping ancestors
 * (`flushWith`), and either the stop's `Flush` — `fills`, `checked` by the probe that came back, or unchecked for
 * `tap`, `room` or `budget` — or the step that answers it first: the witness asked about a band the moot rule left
 * unasked, or the probe sent, as the stroke plan makes it (interact/stroke-plan.ts#planProbe: over the first of the
 * ancestors from the flush one outward with room above the keyboard — none, and no probe is sent). Undefined: not
 * flush with any.
 */
function flushCheck(s: Mutable<State>, { best, facts, probeHeld, probeStroked, gesture, cover, offered, seen, ask }: FlushRound): Flush | Next | undefined {
  const chain = facts.scene.clips.scrollersOf(best.node);
  const flushed = flushWith(best.node.rect, chain, s.rules.direction);
  if (flushed === undefined) return undefined;
  if ('fills' in flushed) return { edges: flushed.fills, container: chain[0], checked: false, why: 'fills' };
  const { edge, at } = flushed;
  const container = chain[at];
  if (probeHeld) return probeStroked ? { edge, container, checked: true } : { edge, container, checked: false, why: 'tap' };
  // With no gesture box (`RoundSeen.screen` absent) nothing has room and the stop says `room` — the wrong reason (it
  // is "no screen box"), accepted as unreachable in practice: screenBox throws only when the device's size is
  // unusable AND the tree has no window, and adapters/viewport-memo.ts keeps a successful size for the session — so it
  // takes a device reporting 0×0 throughout, and a tree whose window stood in on an earlier round (else the frame is
  // 0×0 and no stop is ever visible) but not on this one.
  const noRoom = { edge, container, checked: false, why: 'room' } as const;
  if (probeAcrossOnly({ toward: SIDES[edge].reveals, facts, scrollViews: chain.slice(at) })) return { edge, container, checked: false, why: 'axis' };
  const maxTravel = Math.floor(PROBE_MAX_TRAVEL_FRACTION * Math.max(s.frame.box.width, s.frame.box.height));
  const probeOver = (keyboardTop: number | undefined) =>
    planProbe(s.strokes, { toward: SIDES[edge].reveals, reach: PROBE_REACH, maxTravel, gesture, facts, scrollViews: chain.slice(at), keyboardTop });
  if (probeOver(undefined) === undefined) return noRoom;
  if (s.swipes >= s.rules.maxSwipes || seen.elapsedMs >= s.rules.timeoutMs) return { edge, container, checked: false, why: 'budget' };
  // Clear of a keyboard as any stroke is — and one the moot rule never asked about (the stop was clean either way) is
  // asked about now: the probe touches down on the container's lower part for a bottom edge, which may be under the
  // band.
  let probeCover = cover;
  if (probeCover === undefined && offered !== undefined) {
    if (seen.corroborated === undefined) return ask('witness');
    if (seen.corroborated) probeCover = offered;
  }
  // Room judged again ABOVE that keyboard: a list running on under the IME may have room on the screen and none above
  // it — the probe would touch down off it and move nothing. Twice only to keep the ask order: no room even over the
  // whole screen is `room` with no witness asked.
  const planned = probeOver(strokeLine(probeCover, facts)?.y);
  return planned === undefined ? noRoom : probe(s, edge, best.node.rect, planned);
}

/**
 * A `presented` stop (`outcome`) on this read: made at once when this read confirms the last one's hold
 * (`confirming`) or no confirming read is left; else held (`presentedHold`) for one more read with no stroke between.
 */
function holdPresented(s: Mutable<State>, outcome: Extract<ScrollOutcome, { kind: 'presented' }>, confirming: boolean, elapsedMs: number): { state: Rounds; step: RoundStep } {
  if (confirming || !mayConfirm(s, elapsedMs)) return stop(s, outcome);
  s.presentedHold = outcome;
  return confirm(s);
}

/**
 * Send the flush check's probe (PROBE_REACH) as the plan made it (interact/stroke-plan.ts#planProbe): toward
 * revealing `edge`, over a scroll view with room above the probe's keyboard and what is drawn over it — never the
 * screen box: a stop with no ancestor that has room is reported unchecked, not probed — its travel capped
 * (PROBE_MAX_TRAVEL_FRACTION). A swipe like any other for the count and the bound, but not a step of the scroll's
 * course: the turn (`lastStroke`, `turns`, `strokesSent`) is left as it was, so a probe the other way from the
 * caller's direction is not a turn and halves no reach.
 */
function probe(s: Mutable<State>, edge: Edge, rect: Rect, planned: { stroke: PlannedStroke; memory: StrokeMemory }): { state: Rounds; step: RoundStep } {
  s.probe = { rect: { ...rect }, edge };
  s.strokes = strokeSent(planned.memory);
  s.lastSent = SIDES[edge].reveals;
  s.confirmReads = 0;
  s.since = 'stroke';
  s.swipes++;
  s.owesDrawn = true;
  return { state: s as unknown as Rounds, step: { do: 'stroke', ...planned.stroke, probe: true } };
}

/** Spend a confirming read: the next read follows a settle, not a stroke. */
function confirm(s: Mutable<State>): { state: Rounds; step: RoundStep } {
  s.confirmReads++;
  s.since = 'settle';
  return { state: s as unknown as Rounds, step: { do: 'confirm' } };
}

function stop(s: Mutable<State>, outcome: ScrollOutcome): { state: Rounds; step: RoundStep } {
  s.done = true;
  const detent = detentMove(s);
  const { endTurn } = s;
  return { state: s as unknown as Rounds, step: { do: 'stop', outcome: { ...outcome, ...(detent !== undefined && { detent }), ...(endTurn !== undefined && { endTurn }) } } };
}

/** A node as a sentence quotes it (geometry.ts#nodeText): its role, label, id and rect — not its subtree. */
const named = ({ role, label, identifier, rect }: UiNode): EndTurn['scrollView'] => ({ role, label, identifier, rect: { ...rect } });

/**
 * The end turn's second condition (`EndTurn`), the first — the content proven exhausted the course's way over `view`
 * — being the caller's: no end turn yet, and the judged match lies INSIDE `view` (one of the scroll views it is drawn
 * in, ui-tree/geometry.ts#Clips.drawnIn) and BEYOND its far edge for the course (`beyondFarEdge`, against `view`'s
 * frame, not the screen's) — the way no stroke the course's way can bring it, and the way the tree says it lies.
 */
function turnsAtEnd(s: State, best: Judged, view: UiNode, facts: TreeFacts): boolean {
  if (s.endTurn !== undefined) return false;
  const inside = facts.scene.clips.drawnIn(best.node)?.scrollers.includes(view) === true;
  return inside && beyondFarEdge(best.node.rect, courseOf(s), view.rect);
}

/**
 * Make the end turn (`EndTurn`): the course becomes the caller's direction's opposite for the rest of the scroll, and
 * what the reads recorded against the old far edge is read against the new one — the target, past the old far edge,
 * lies short of the new one (`seenShort`), past no far edge (`lastPast`), and carried past nothing (`carriedPast`).
 * Not a fling's turn: `lastStroke` is set to the new course, so the next stroke keeps its reach (`nextStroke`) and
 * `turns` — the failure's "turned round N times: a fling" — does not count it.
 */
function turnAtEnd(s: Mutable<State>, view: UiNode): void {
  const from = courseOf(s);
  s.endTurn = { from, to: OPPOSITE[from], after: s.swipes, unmoved: Math.min(s.allUnmovedStrokes, s.swipes), scrollView: named(view) };
  s.lastStroke = OPPOSITE[from];
  s.seenShort = true;
  s.carriedPast = false;
  s.lastPast = undefined;
}

/** The top sheet's detent at the first read that read against the last (`DetentMove`): both read, as many grabbers, values differing. */
function detentMove({ detents }: State): DetentMove | undefined {
  if (detents === undefined) return undefined;
  const { first, last } = detents;
  if (first === undefined || last === undefined || first.grabbers !== last.grabbers || first.detent === last.detent) return undefined;
  return { from: first.detent, to: last.detent };
}

/**
 * What the round at a bound read and judged, as `shortfall` reads it — one
 * value.
 */
interface BoundRound {
  /** Why this round's tree did not read, if it did not. */
  readonly readError: Error | undefined;
  /** The target's matches in this round's tree. */
  readonly found: readonly UiNode[];
  /** The best of them as judged (scroll-read.ts#judge), if any. */
  readonly best: Judged | undefined;
  /** The frame it was judged in — the screen box (`State.frame`) — which an `offFrame` failure quotes. */
  readonly viewport: Rect;
  /** The keyboard cover applied to that frame, if any — quoted with it. */
  readonly cover: Cover | undefined;
  /** This round's tree's active-window hint (ui-tree/standing.ts#activeWindowHint) — an `absent` failure carries it. */
  readonly windowHint: string | undefined;
}

/**
 * What the target was short of at a bound (`by`). In the frame on an
 * earlier read and not on this one: "never" would be false — a fling carried it off, or a lazy list dropped it once it scrolled
 * away. Last found beyond the far edge, the side (`Shortfall.past`); never
 * found, the side left unread when the strokes ran to the end of the
 * content without a turn (`Shortfall.absent`'s `unsearched`).
 */
function shortfall(s: State, { readError, found, best, viewport, cover, windowHint }: BoundRound, by: BoundBy): Shortfall {
  if (readError !== undefined) return { of: 'readFailed', error: readError };
  if (best !== undefined && best.standing.facts.visible > 0) return shortOf(best);
  const left = s.inFrameAfter;
  const past = s.lastPast !== undefined && !s.strokedToward.includes(SIDES[s.lastPast.side].reveals) ? s.lastPast : undefined;
  if (found.length === 0) {
    if (left !== undefined) return { of: 'gone', inFrameAfter: left };
    if (s.inTreeAfter !== undefined) return { of: 'left', inTreeAfter: s.inTreeAfter, ...(past !== undefined && { past }) };
    // Never found: no turn was drawn (each needs a sighting), so the far side is unstroked.
    const ranToEnd = s.treeMoved && by.of === 'exhausted' && by.unchanged === 'tree' && by.touched === undefined;
    return { of: 'absent', ...(ranToEnd && { unsearched: FAR_EDGE[courseOf(s)].far }), ...(windowHint !== undefined && { windowHint }) };
  }
  // In the tree: scroll-read.ts#judge scores every match, so this read judged one and `past` is this read's.
  return {
    of: 'offFrame',
    rect: (best?.node ?? found[0]).rect,
    ...(left !== undefined && { inFrameAfter: left }),
    viewport,
    ...(cover !== undefined && { cover }),
    eitherWayUp: s.frame.boxes.length > 1 && cover?.above === undefined,
    ...(past !== undefined && { past }),
    ...(best !== undefined && outsideItsScrollView(best.standing) && { outside: best.standing.scroller }),
  };
}
