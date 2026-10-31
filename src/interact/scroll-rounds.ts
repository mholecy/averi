import { type DeviceScreen, type Point, type Rect, type Stroke, type UiNode } from '../adapters/types.js';
import { belowStatusBand, quoted, toldFrame, type Edge, type ListedContent } from '../ui-tree/geometry.js';
import type { MarkedLayer } from '../ui-tree/presentation.js';
import { screenChangedUnder, screenIdentity, type IdentifiedRead, type ScreenChange, type SheetDetent } from '../ui-tree/read-tree.js';
import { drawOrderFound, type Cover } from '../ui-tree/cover.js';
import { askedOf, eyesQuestion, pairQuestion, reachesPoint, sameQuestion, type EyesAnswer, type EyesAsked, type EyesFinding, type EyesQuestion, type PairQuestion } from '../ui-tree/eyes.js';
import { seenOrderOf, type OrderSeen, type PairSeen } from '../ui-tree/seen-order.js';
import { hasArea, tapPoint } from '../ui-tree/selectors.js';
import { missOf, saysTopLayerOnly, topLayerOnlySource, type Miss, type TopLayerOnlySource } from '../ui-tree/miss.js';
import { outsideItsScrollView, type Remedy } from '../ui-tree/standing.js';
import { SIDES } from '../ui-tree/sides.js';
import type { UsableScreen } from '../ui-tree/usable-screen.js';
import type { Target, WaitEvidence } from './resolve.js';
import { fullyClaimed, judgeRead, shortOf, stops, strokeLine, type AppliedKeyboard, type InFrameShort, type Judged, type ReadJudgement, type RoundRead, type Since, type TreeFacts } from './scroll-read.js';
import { heldBack as heldBackBy, lastDrawn, overRegion, regionOf, seeMotion, startLedger, treeMoved, unseenStrokes, type LedgerRead, type MotionLedger, type Moved, type Streaks, type StrokePhysics, type UnseenStrokes } from './motion-ledger.js';
import { carriedCover, seeMargin, startMargin, type MarginMemo, type Offset } from './margin-memo.js';
import { carried, planStroke, seeRead, startStrokes, strokedContent, strokeSent, touchedOn, type PlannedStroke, type PresentedTouchDown, type StrokeKind, type StrokeMemory, type TouchedOn } from './stroke-plan.js';
import { courseFacts, lastSent, nextStroke, probeSent, seeTarget, sent, startCourse, stuckTurn, turnAtEnd, turnBack, unknownCentreNeeds, type Course, type EndProof, type EndTurn, type PastSide, type StillNeeds } from './course.js';
import { probing, seeFlush, startFlush, type Flush, type FlushCheck, type FlushCut, type FlushVerdict, type ProbeMeans } from './flush-check.js';
import type { Direction } from './swipe.js';

/**
 * `scroll_until`'s ROUND as one pure function: `round(state, seen) → { state, step }` — what a read of the
 * screen means for the scroll ACROSS reads, and what to do next. Every rule that compares
 * a read with an earlier one, and every fact the loop carried from round to
 * round, lives here and nowhere else: the confirming reads
 * (SETTLE_CONFIRM_READS), the
 * stuck and exhausted tests (UNMOVED_STROKES_EXHAUST, the same stroke
 * twice), the cover carried to a round whose tree did not
 * read, the frame kept across such a round, and the deadline — each
 * reachable by a test without a scripted device. What one read means on
 * its own — the cover that applies, the moot band and the witness, the
 * match judged best, the frames — is interact/scroll-read.ts#judgeRead's,
 * which `round` calls once per read that read; where the match stands for
 * the stop (in frame, covered, cut, under a band) is
 * ui-tree/standing.ts#Scene.standing's, which that module asks. Whether
 * anything MOVED between reads — the judged match, every match, the tree,
 * the identical-stroke streaks, slowing, the carry sample, the blank
 * strokes, the region the motion showed — is the motion ledger's
 * (interact/motion-ledger.ts), which `round` shows each round once and
 * asks; what the round makes of its answers (stuck, exhausted, the end
 * proof, the settle confirm) stays here. Which way and how far the next
 * stroke goes — the far edge, the turn after a fling or a lazy list's
 * drop and its halved reach, the stuck turn's stroke back, the end turn,
 * the probe's reach — is the course's (interact/course.ts), which `round`
 * shows where the target stood on each read that read, asks for each
 * stroke and tells what was sent; when a turn applies (the stuck turn's
 * budget and the outward rule, the end turn's proof) stays here. Whether a
 * `fully: true` stop flush with a clipping scroll container is cut there —
 * the probe in flight and what it proved, the reveal, the stop's `Flush`
 * and the proven cut's `FlushCut` — is the flush check's
 * (interact/flush-check.ts), which `round` shows each read that read once
 * and whose one verdict it reads: whether that read may settle or wait, and
 * the hedge, the cut, the witness or the probe to send; sending it stays
 * here.
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
 *   (`corroborated` for `witness`, `unlocated` for `unlocated`, `eyes` for
 *   `eyes`, `order` for `order` — each eyes' question carried by the step,
 *   ui-tree/eyes.ts); a round asks at most once of each, the witness first,
 *   the order next, the eyes last. That re-entry is what keeps the
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
 * ORDER inside a round, fixed: the read's judgement, its `ask witness` included (interact/scroll-read.ts#judgeRead),
 * then `ask order` for a best match covered by a control the listing does not order (ADR 0024), or by texts in its
 * touch margin only (ADR 0026: what was seen of those kept, `State.marginKept`), and the judgement again
 * on what the eyes saw; the motion ledger shown the round (`seeMotion`, before the stroke plan sees the read); motion
 * observed (a read that read only); the stop verdict (settled / confirm / unsettled; then, on a `fully: true`
 * stop flush with a clipping scroll container, the probe — `ask witness` first for a band the moot rule left unasked —
 * the flush check's verdict, interact/flush-check.ts#FlushVerdict; then `ask unlocated` on a `fully: true` stop with
 * no cover under it; then `ask eyes` on a stop that would
 * say "fully visible" with a flush neighbour — THE EYES, ui-tree/eyes.ts — whose band under `fully: true` is no stop);
 * stuck; the confirming read, or the
 * read after a probe, that did not read; a rebound's settled read (UNMOVED_STROKES_EXHAUST's rebound); covered (nothing above the band); the end turn (`EndTurn`), which takes an
 * exhaustion it applies to out of the bound; the bound (exhausted; `movesWith`, a margin text seen drawn over it
 * carried with it; maxSwipes; deadline — and `ask unlocated` of a round that read); the stroke. The witness comes
 * before the deadline is consulted, so a witness that waits out its 2 s counts against the scroll's budget: the driver
 * stamps `elapsedMs` afresh on every call, re-entry included.
 *
 * BOUND: at most 1 + (1 + SETTLE_CONFIRM_READS) × `maxSwipes` non-ask steps
 * (25 at the defaults) — a stroke spends one of `maxSwipes` and earns at most
 * SETTLE_CONFIRM_READS confirming reads, the read after it aside — and fewer
 * at the deadline; besides those, the reads of a fling still slowing
 * (SETTLE_CONFIRM_READS), which spend none: each finds the target moving less
 * than the one before, so on a source of whole-unit rects (WDA's points,
 * uiautomator's pixels) there are fewer of them than the first one's motion
 * in units — two on the measured carousel — and the deadline ends them in
 * any case; and the reads before the call's first read that reads, which
 * stroke nothing (`CallEvidence`'s `unread`) and end at the deadline. Cost: no I/O; one copy of the state record a call.
 */

/** The caller's options, fixed for the scroll (interact/scroll.ts resolves the defaults). */
export interface RoundRules {
  /** Where the CONTENT lies relative to the current view. */
  direction: Direction;
  /** Require the element entirely inside the frame. */
  fully: boolean;
  maxSwipes: number;
  timeoutMs: number;
  /** How the platform's scroll views take a stroke (motion-ledger.ts#StrokePhysics: `fling` on iOS, `drag` where the adapter has a drag speed): UNMOVED_STROKES_EXHAUST's rebound and the tree's within-a-pixel test. Default `drag`. */
  strokes?: StrokePhysics;
  /**
   * The tree read waits for the screen at rest (adapters/types.ts#DeviceAdapter.treeReadSettles, ADR 0021 decision 7):
   * the read after a stroke is the settled read, and a stop judged on it is reported at once, settled, with no
   * confirming read (SETTLE_CONFIRM_READS). The read after the flush check's probe is still confirmed when the probe
   * moved the target, and a presented hold (ADR 0018) still takes its own. Default false: every read after a stroke is
   * confirmed, as a read that snapshots at once must be.
   */
  readSettles?: boolean;
  /** What the scroll looks for — asked of only by a miss (ui-tree/miss.ts#missOf); absent in a table of rounds, which hands each read its matches and gets the miss's facts of the tree alone. */
  target?: Target;
}

/** One tree read as the round is handed it (scroll-read.ts#RoundRead) — part of this protocol (`RoundSeen.read`), so it is importable from here. */
export type { RoundRead } from './scroll-read.js';

/** What a stop carries of the course (interact/course.ts): the end turn, its proof, the side the target was found past — part of `ScrollOutcome`, so importable from here. */
export type { EndProof, EndTurn, PastSide } from './course.js';

/** What a stop or a shortfall carries of the flush check (interact/flush-check.ts): the stop's `Flush`, the proven cut's `FlushCut` — part of `ScrollOutcome`, so importable from here. */
export type { Flush, FlushCut } from './flush-check.js';

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
  /** The answer to `ask eyes`: what the eyes saw of the step's question (ui-tree/eyes.ts). */
  eyes?: EyesAnswer;
  /** The answer to `ask order`: what the eyes saw of the step's question's pairs (ui-tree/eyes.ts#Eyes.order) — none seen when no eyes were wired. */
  order?: readonly OrderSeen[];
  /** ms since the scroll began (after the device's screen was read), stamped on every call — re-entry included. */
  elapsedMs: number;
  /**
   * ms this round's tree read took, whether it read or failed — the driver times the read alone. Summed for the
   * timeout's sentence (`ReadTime`): a budget the reads spent is not the content's fault.
   */
  readMs: number;
}

/**
 * One read that read, as the round has gathered it: the read, and of its judgement
 * (interact/scroll-read.ts#ReadJudgement) its tree's facts. One value, so the steps after the judgement read the same
 * facts. The frames it was judged in are the course's to read (interact/course.ts#seeTarget).
 */
type ThisRead = Pick<ReadJudgement, 'facts'> & { readonly read: RoundRead };

/** What to do next. */
export type RoundStep =
  /** Answer, then call `round` again with the same seen and the answer; the state is unchanged. */
  | { do: 'ask'; what: 'witness' | 'unlocated' }
  /** Look (ui-tree/eyes.ts): ask the eyes `question` — one screenshot — and call `round` again with the same seen and the answer (`eyes`); the state is unchanged. */
  | { do: 'ask'; what: 'eyes'; question: EyesQuestion }
  /** Look (ui-tree/eyes.ts#Eyes.order): ask the eyes which of the target and a control the listing does not order is drawn on top, or whether a text in its touch margin paints over it — one screenshot — and call `round` again with the same seen and the answer (`order`); the state is unchanged. */
  | { do: 'ask'; what: 'order'; question: PairQuestion }
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
   * (interact/flush-check.ts; its reach course.ts#PROBE_REACH, or a reveal's, course.ts#Revealing), not a step toward the target — its `box` always a scroll view's, never the screen's fallback;
   * `maxTravel` caps its finger travel (course.ts#PROBE_MAX_TRAVEL_FRACTION; a reveal's, half its room).
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
 *   stop whose edge lies on its clipping container's (interact/flush-check.ts#Flush).
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
 * - `changed`: the screen changed under the strokes (ui-tree/read-tree.ts#ScreenChange) — the
 *   first read after them is another screen than the read before them; no
 *   stop is judged on it and no further stroke sent, whether the target is
 *   in it (`found`) or not.
 *
 * Every kind may carry `detent`: the top sheet — the same sheet at both
 * reads — reported another detent at the last read that read than at the
 * first (`DetentMove`).
 */
export type ScrollOutcome = (
  | { kind: 'visible'; swipes: number; judged: Judged; settled: boolean; unlocated: boolean; flush?: Flush; eyes?: EyesFinding }
  | {
      kind: 'stuck';
      swipes: number;
      short: InFrameShort | FlushCut;
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
  | { kind: 'covered'; swipes: number; cover: AppliedKeyboard; viewport: Rect; evidence: WaitEvidence }
  | { kind: 'presented'; swipes: number; judged: Judged; viewport: Rect; cover: Cover; layer?: MarkedLayer; next?: undefined }
  | { kind: 'presented'; swipes: number; judged: Judged | undefined; viewport: Rect; next: PresentedTouchDown }
  /**
   * Under a cover the tree lists in reading order with it (ui-tree/standing.ts#Remedy's `unordered`, the order not
   * told — `remedy.untold` when a screenshot could not tell either —, or `seenOver`, a screenshot saw it drawn over the
   * target): stopped without a swipe — no scroll tells which is drawn on top or moves the target out from under it, and
   * a stroke beside an in-screen menu lands on its backdrop.
   * docs/bugs/2026-10-16-lab-ios-swiftui-menu-row-listed-in-reading-order-reads-covered-by-the-row-beneath.md
   * docs/adr/0024-the-eyes-tell-the-order-of-two-controls-listed-in-reading-order.md
   */
  | { kind: 'overlapped'; swipes: number; judged: Judged; viewport: Rect; cover: Cover; remedy: Extract<Remedy, { of: 'unordered' | 'seenOver' }> }
  | {
      kind: 'bound';
      swipes: number;
      by: BoundBy;
      short: Shortfall;
      /** Direction changes the scroll made (a fling carried the target past the frame). */
      turns: number;
      /** The last cover any round applied, in how many of the rounds that read. */
      keyboard?: { cover: AppliedKeyboard; rounds: number; read: number };
      unlocated: boolean;
      evidence: WaitEvidence;
      /** The swipe the bound held back would have touched down on a screen presented over the target's (interact/stroke-plan.ts#PresentedTouchDown). */
      presented?: PresentedTouchDown;
    }
  | { kind: 'changed'; swipes: number; change: ScreenChange; found: boolean }
) & { detent?: DetentMove; endTurn?: EndTurn };

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
 * Which bound ended the scroll: the same stroke twice moved nothing (with
 * the direction last swiped, what stayed put — every match of a target
 * off the frame, or the whole tree of one not in it — and, when the last
 * stroke touched down on a node drawn over its container, that node:
 * `touchedOn`), a margin text seen drawn over it carried with it (`movesWith`), `maxSwipes`, or the deadline.
 * `ends`: the exhaustion was PROVEN by the tree — the scroll view the last stroke went over lists its content ending
 * that way (`EndProof`, its `way` the `lastStroke`) — after its
 * `unmoved` strokes (one, where UNMOVED_STROKES_EXHAUST's two are the proof otherwise). `unlisted`: why strokes for a
 * target never seen may have moved nothing, beside the content's end — the tree source lists only the top layer
 * (ui-tree/miss.ts#TopLayerOnlySource), so they may have landed on a sheet, alert or cover it does not list; carried by
 * the unmoved stop of a call whose strokes are `unfelt` (`CallEvidence`) and said where that stop names no other cause
 * (scroll-text.ts#boundText: no end proven, nothing named under the touch-down) — a possibility, never the cause
 * (ui-tree/miss.ts#TOP_LAYER_ONLY_HINT); not carried when the call's miss says it already (ui-tree/miss.ts
 * #saysTopLayerOnly: idb's id notes), so the reply says it once; no device call.
 * `movesWith`: a `fully: true` match covered by a text in its touch margin that a screenshot saw drawn over it
 * (`State.marginKept`'s `under`), the two moved since by the same `offset` in a scroll view that stayed where it was
 * (margin-memo.ts#carriedCover) — the text scrolls with it, so no stroke brings it out from under the text; the
 * shortfall the `covered` one.
 * docs/bugs/2026-10-23-lab-android-scroll-until-fully-strokes-to-its-timeout-under-a-margin-text-seen-drawn-over-it.md
 */
export type BoundBy =
  | { of: 'exhausted'; lastStroke: Direction; unchanged: 'matches' | 'tree'; touched?: TouchedOn; ends?: EndProof; unlisted?: TopLayerOnlySource }
  | { of: 'movesWith'; offset: Offset }
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
 * - `neverRead`: no tree read of the call read — the last one's error quoted, and why no swipe was sent: none is
 *   drawn before a read has read (`round`, the call's evidence `unread`);
 * - `clipped`: in the frame but clipped — an edge cut with `fully: true`,
 *   its centre off the screen without (`shortOf`);
 * - `covered`: in the frame, not clipped so, but a node of the
 *   app drawn over it — over any of it with `fully: true`, over its centre
 *   without (`stops`);
 * - `flushCut`: a `fully: true` match a probe proved cut at its flush edge (`FlushCut`), with no reveal of the rest
 *   sent (no swipe or time left, or no room or axis for one);
 * - `absent`: not in the last tree, and never in the frame before it —
 *   `unsearched` the side the strokes never
 *   read, when there is evidence it is the only one left: a stroke changed
 *   the screen (motion-ledger.ts#treeMoved), then the caller's own strokes no longer
 *   did (`exhausted`, `tree`), and none of them touched down on a node drawn
 *   over the list — the content ran to its end the caller's way, every row
 *   on that side through the tree, so a target this list holds lies on the
 *   side it started from. Without that (maxSwipes, the deadline: more may
 *   lie ahead; a screen no stroke ever changed: the swipes may not have
 *   been taken) nothing is guessed. Every stroke of a scroll that never
 *   found its target goes the caller's way (a turn needs a sighting; the
 *   end turn, `EndTurn`, needs the target in the tree), so the other side
 *   was never stroked. `miss` what the last read saw (ui-tree/miss.ts
 *   #missOf: a source that lists the active window only, a window it lists
 *   alone), whose note the failure says;
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
 * direction (the course's `lastPast`, interact/course.ts) — the side the strokes push it out through,
 * so the failure names that side and the direction that brings it back,
 * not "off the viewport, or under the soft keyboard … (a fling?)". Only
 * while no stroke was drawn that way (interact/course.ts#courseFacts): once one was — a
 * turn — that direction was tried, and the turn's own sentence says why.
 * `outside` on `offFrame`: the last read judged it on the screen but outside
 * what its scroll view draws (ui-tree/standing.ts, the drawn frame) — that
 * scroll view, which the failure names in place of the viewport.
 */
export type Shortfall =
  | { of: 'readFailed'; error: Error }
  | { of: 'neverRead'; error: Error }
  | InFrameShort
  | FlushCut
  | { of: 'absent'; unsearched?: Edge; miss?: Miss; unseen?: UnseenStrokes }
  | { of: 'gone'; inFrameAfter: number }
  | { of: 'left'; inTreeAfter: number; past?: PastSide }
  | { of: 'offFrame'; rect: Rect; inFrameAfter?: number; viewport: Rect; cover?: AppliedKeyboard; eitherWayUp: boolean; past?: PastSide; outside?: UiNode };

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
 *
 * WHERE THE TREE READ WAITS FOR THE SCREEN AT REST (`RoundRules.readSettles`, adapters/types.ts#DeviceAdapter
 * .treeReadSettles — Android) the read after a stroke is the settled read and spends none of them: the read a
 * confirming read would compare it with is the same tree (the source, the measurements and the residual:
 * adapters/android.ts#treeReadSettles, ADR 0021 decision 7). What still confirms there: a presented hold (ADR 0018,
 * awaiting the presented screen, not the stroke's motion), a confirming read that failed, and the read after the
 * flush check's probe when the probe moved the target (flush-check.ts keeps its own evidence); a flush row found on
 * the read after a stroke is probed at once, no confirming read before the probe.
 *
 * A REBOUND's settled read (UNMOVED_STROKES_EXHAUST) is the stroke's first confirming read, spent like any other.
 *
 * A FLING STILL SLOWING spends none of them (`Observed.slowing`): a confirming read that found the target — the
 * same node — moved less over its settle pause than the read before found it moved over its own is read again
 * free, until the deadline. A fling slows read for read; an animation moves as much at every read and spends the
 * budget as before. Measured under WDA (the lab app's `carousel-in-list`, C a card as wide as its
 * carousel): one 212-pt stroke flung the carousel 447–532 pt over ~2.5 s, and the reads after it, 0.47 s apart,
 * found C moving 54, 21, 8 pt (66, 24, 10 in another run) — the third confirming read still 8–10 pt from rest, so
 * the stop was claimed "still moving"; in the run that flung 532 pt it was claimed on a read with C's centre inside
 * the carousel, and the fling then carried the centre a point out of it, the next tap refused
 * (docs/bugs/2026-10-18-lab-ios-wda-carousel-stop-claimed-while-the-fling-carries-the-card-past-its-centre.md). A
 * stop is judged on the read the fling comes to rest in. The first confirming read always spends one: a read after
 * a stroke measures the stroke too, and gives the next nothing to compare with.
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
 * reports. For both, only strokes count: a confirming read sent none — but a rebound's settled read (below) answers for
 * the stroke it followed, in that stroke's place.
 *
 * And a target NOT in the tree (the note below): the same stroke twice after
 * which the WHOLE tree is unchanged (`TreeFacts.fingerprint`; where strokes fling, within a pixel: below) — content at
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
 *
 * A BLANK read is no evidence either way (lab note LV1, ADR 0021's 2026-10-21 refinement): the read after a stroke,
 * the target not in it, whose tree lists none of the content of the scroll view the stroke went over where its
 * motion would show (interact/stroke-plan.ts#strokedContent, geometry.ts#Clips.contentToward's `blank`: an empty
 * viewport, or only nodes cut at both of its edges). uiautomator dumps no scroll offset, and Compose no content
 * container, so blank space — a spacer, an image or a chart with no node — dumps the same tree at every offset:
 * measured, the lab app's `tabbar-floating` read "the last 2 … did not change the screen" after 4 strokes while each
 * moved the list ~860 px, F one stroke away. Such a read is no unmoved read — the streak starts again, a reset, not a
 * freeze, the conservative side; nor a moved one: only a tree changed (the fingerprint; where strokes fling, past a
 * pixel, and after a rebound on the settled read) sets the motion ledger's
 * motion-ledger.ts#treeMoved — and the strokes run on to the bound, where an `absent` failure says the last of them
 * went over blank content (motion-ledger.ts#UnseenStrokes: raise maxSwipes or timeoutMs). The streak keeps its
 * meaning — the same stroke twice left a tree that WOULD show motion unchanged — so "did not change the screen" stays true. Cost: none wherever the list shows content along the stroke's
 * axis (every committed capture's largest scroll view does, down and up, and sideways too:
 * tests/ui-tree/listed-content.test.ts); over a blank viewport, strokes up to the bound (2.8–4.1 s each on the lab
 * AVD), a true end with a blank viewport included. Residual: a node inside the scroll view that does not move with its
 * content (a sticky header child) reads as content shown, so a blank stretch under it still reads exhausted after the
 * two.
 *
 * A REBOUND is read settled (ADR 0021 decision 6): where the platform flings every stroke
 * (`RoundRules.strokes` `fling`, iOS), a stroke into a list's end rubber-bands the content back over ~0.75 s, and the read after
 * it lands inside the bounce at another offset each time — measured under idb on Settings › General, a target not there
 * cost all six strokes, "failed after 6 swipes (maxSwipes)". A read after a stroke with the target nowhere that found
 * the content carried less far than the finger drew (motion-ledger.ts#Moved `rebounding`) counts nothing; one more
 * read after a settle answers for the stroke against the read before it (every node
 * within a pixel). Now "the last 2 … did not change the screen" after the two strokes. The settled read is the stroke's
 * first confirming read (SETTLE_CONFIRM_READS), so the round's BOUND holds. And where strokes fling the whole tree
 * unchanged is within a pixel, as every match's is: measured under idb, a page at its end read a point off after the
 * first stroke (its rest rounded the other way), and the exact fingerprint called it motion — a third stroke, and a
 * side never stroked named (ui-tree/read-tree.ts#sameTreeWithinPixel); where strokes drag (Android) it stays exact.
 * Residuals: a settled read still inside the bounce (400 ms and a read are not always past it) reads the list moved —
 * the strokes run on as before, and a list that never moved may name the side never stroked; a screen whose content
 * moves on its own by less than a stroke between reads takes the extra read too.
 * docs/bugs/2026-10-12-ios-scroll-until-never-reads-a-bouncing-list-end-as-exhausted.md
 */
export const UNMOVED_STROKES_EXHAUST = 2;

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
  readonly swipes: number;
  /** A `stop` was returned: no further round. */
  readonly done: boolean;
  /**
   * The last `fully: true` claim the eyes refused (THE EYES, `round`): the question as asked (ui-tree/eyes.ts#EyesAsked:
   * its region and its neighbours' rects), and the shortfall it left. A read after the next stroke that finds both where they were is refused again at once — no
   * confirming read, no second screenshot: nothing moved, so the pixels did not — and is that stroke's read, which
   * the stuck test counts. Undefined until a refusal.
   */
  readonly eyesRefused: { readonly asked: EyesAsked; readonly short: Extract<InFrameShort, { of: 'unlisted' }> } | undefined;
  /**
   * What the eyes saw of the texts in the target's touch margin this call, kept while it holds (interact/margin-memo.ts,
   * ADR 0026 rules 6 and 8): a later read is told it instead of looking again (`seeMargin`); an `under` carried with the
   * target ends the call (`carriedCover`).
   */
  readonly marginKept: MarginMemo;
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
  readonly lastCover: AppliedKeyboard | undefined;
  readonly coveredRounds: number;
  /** What the strokes remember across reads — the target's scroll views, the last keyboard line, the scroll view the last stroke went over (interact/stroke-plan.ts#StrokeMemory): the plan's, which `round` holds and reads none of. */
  readonly strokes: StrokeMemory;

  // How the target moved, read for read: a swipe that does not move the element is the only honest
  // signal that the container has nothing left to scroll — "give it another
  // swipe" against "this element CANNOT be fully revealed" (a real layout
  // defect) or "it is off the frame for good" — and a stop after a stroke
  // holds only once a read finds it still.
  readonly since: Since;
  /**
   * THE MOTION LEDGER (interact/motion-ledger.ts): every "did it move" across the run — what each read is compared
   * with (the last read's rects, fingerprint, judged rect and identity), the identical-stroke streaks, the last stroke
   * drawn, the motion over the last settle, the blank strokes, and the region the motion showed on a tree that tells no
   * scroll view. Shown each round's read and stroke once (`seeMotion`), asked through its queries.
   */
  readonly motion: MotionLedger;
  /**
   * THE COURSE (interact/course.ts): which way and how far the next stroke goes — where the target stood against the far
   * edge, the fling's and the lazy list's turns, the stuck turn's stroke back, the end turn, the turns and the ways
   * stroked. Shown each read that read once (`seeTarget`), asked for each stroke (`nextStroke`), told each one sent.
   */
  readonly course: Course;
  /** Confirming reads spent since the last stroke (SETTLE_CONFIRM_READS is per stroke) — a slowing fling's spend none (`Observed.slowing`). */
  readonly confirmReads: number;
  /**
   * The `presented` stop the last read that read would have made — its judged match under a presented screen, or its
   * next stroke touching down on one — held for one more read with no stroke between (`round`): the next read that
   * reads decides; a read that does not read is confirmed again while the budget allows, then this stop is made, as
   * the last read that read left it. Never a stroke in between: one drawn blind would land on that screen.
   */
  readonly presentedHold: Extract<ScrollOutcome, { kind: 'presented' }> | undefined;
  /** The swipe count at the last read that had the target in the frame (any part of it) — for a failure after it left again. */
  readonly inFrameAfter: number | undefined;
  /**
   * THE FLUSH CHECK (interact/flush-check.ts): a `fully: true` stop flush with a clipping container — the probe in
   * flight and the cut a probe proved. Shown each read that read once (`seeFlush`), its verdict read once.
   */
  readonly flush: FlushCheck;
  /** The swipe count at the last read that had the target in the tree at all — for "was in the tree … then left it". */
  readonly inTreeAfter: number | undefined;
  /** The top sheet's grabber at the first read that read and at the last (`TreeFacts.detent`); undefined until a read reads. */
  readonly detents: { readonly first: SheetDetent | undefined; readonly last: SheetDetent | undefined } | undefined;
  /** The last read that read, its tree and the screen's identity — what ui-tree/read-tree.ts#screenChangedUnder compares the next one with; undefined until a read reads. */
  readonly screenBefore: IdentifiedRead | undefined;
  /** Where each stroke drawn since that read touched down (`RoundSeen.drawn`'s `from`), in order. */
  readonly touchDowns: readonly Point[];
  /** The one stroke a scroll takes for a plain stop's match whose centre is unknown (`unknownCentreStroke`) was sent. */
  readonly centreStroked: boolean;
}

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
    motion: startLedger(),
    course: startCourse(rules.direction),
    confirmReads: 0,
    presentedHold: undefined,
    inFrameAfter: undefined,
    flush: startFlush(rules.direction),
    eyesRefused: undefined,
    marginKept: startMargin(),
    inTreeAfter: undefined,
    detents: undefined,
    screenBefore: undefined,
    touchDowns: [],
    centreStroked: false,
  };
  return state as unknown as Rounds;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** What one read that read says about motion (`observe`): the motion ledger's answer (interact/motion-ledger.ts#Moved), and what the round makes of it. */
interface Observed {
  /** The judged match is where the previous read's judged match was. */
  bestUnmoved: boolean;
  /**
   * A FLING STILL SLOWING (SETTLE_CONFIRM_READS): a confirming read found the judged match — the same node — moved
   * less than the read before it found it moved. Such a read spends none of the confirming budget.
   */
  slowing: boolean;
  /** The ledger's streaks after this read: the end proof counts the unmoved strokes from them (`endProof`). */
  streaks: Streaks;
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
   * (interact/stroke-plan.ts#strokedContent, its `ends`) — set only with `exhausted`, on the read right after a stroke toward the
   * target (not the flush check's probe) that moved nothing: every match where it was, or, with no target in the tree,
   * the whole tree unchanged; never while a progress node shows, nor of a stroke that touched down on a node drawn over
   * its scroll view (`touchedOn`: that node may have taken it, and the fast fail names it first); and only of a scroll
   * view that scrolls along the stroke's axis (geometry.ts#Clips.contentToward's `ends`; a `blank` read is no proof,
   * nor evidence of an unmoved tree at all: UNMOVED_STROKES_EXHAUST). What counts as proof, stated: the tree's
   * listing of the content, not the strokes — a stroke not taken moves nothing too, but cannot make a list's content
   * end where the tree shows it ending; and the read unmoved besides, so a list still settling (a bounce at its end,
   * momentum from an earlier stroke) reads moved and proves nothing until a read finds it still.
   */
  ends: UiNode | undefined;
}

/**
 * One read that read (`ThisRead`): every match found, the one judged, and the swipe count — recorded into `s`.
 * `current` is what the read followed; `moved`, what the motion ledger made of it (interact/motion-ledger.ts#seeMotion,
 * asked by `round` before the stroke plan saw the read); `listed`, what it lists of the content of the scroll view the
 * last stroke went over (`round`'s memo of stroke-plan.ts#strokedContent). Where the target stands against the far
 * edge is the course's (interact/course.ts#seeTarget), shown the same read by `round` just before.
 */
function observe(s: Mutable<State>, current: Since, now: ThisRead, best: Judged | undefined, moved: Moved, listed: () => ListedContent | undefined): Observed {
  const { read, facts } = now;
  const { found } = read;
  const { loading } = facts;
  const { unmoved, streaks, slowing, carry, strokeRead } = moved;
  if (best !== undefined) {
    s.inTreeAfter = s.swipes;
    // What the stroke just sent carried the target (interact/stroke-plan.ts#carried, the carry model): the ledger's
    // sample (`Moved.carry`), offered only where `round` allowed one (`ledgerRead`).
    if (carry !== undefined) s.strokes = carried(s.strokes, carry);
    if (best.standing.facts.visible > 0) s.inFrameAfter = s.swipes;
  }
  const offFrame = best !== undefined && best.standing.facts.visible === 0 && found.some(hasArea);
  // The tree's proof (`Observed.ends`): asked only of a read a stroke toward the target left unmoved, and never while a
  // progress node shows (content may yet load there). The flush probe (interact/flush-check.ts) never meets it, by the trees'
  // dialects: a probe is planned only over CLIPPING ancestors (`scrollersOf`), which only Android's tree marks, and the
  // proof needs `Clips.contentToward`'s `ends`, which only a tree of unclipped frames (WDA's) answers — no real source gives both. The
  // probe's own answer is the stop it checks (pinned, on a synthetic tree carrying both marks, in
  // tests/interact/scroll-end-turn.test.ts).
  const unmovedNow = (offFrame && unmoved.all && !loading) || (found.length === 0 && unmoved.tree);
  // Nor of a stroke that touched down on a node drawn over its scroll view (`touchedOn`): that node may have taken it,
  // and the fast fail names it first — the two-stroke rule's sentence, as before the proof.
  const proof =
    strokeRead && unmovedNow && lastSent(s.course) !== undefined && touchedOn(s.strokes, facts, lastDrawn(s.motion)) === undefined
      ? listed()
      : undefined;
  const ends = proof?.kind === 'ends' ? proof.view : undefined;
  const exhausted =
    offFrame && (streaks.all >= UNMOVED_STROKES_EXHAUST || ends !== undefined)
      ? 'matches'
      : strokeRead && found.length === 0 && (streaks.tree >= UNMOVED_STROKES_EXHAUST || ends !== undefined)
        ? 'tree'
        : undefined;
  return {
    bestUnmoved: unmoved.judged,
    slowing,
    streaks,
    stuck: current === 'stroke' && streaks.judged >= UNMOVED_STROKES_EXHAUST,
    exhausted,
    ends: exhausted === undefined ? undefined : ends,
  };
}

/**
 * What the motion ledger is shown of a read that read (interact/motion-ledger.ts#LedgerRead): every match, the judged
 * one, the facts — and what only the round knows. Of a read after a stroke that found no target, whether it listed none
 * of the stroked scroll view's content (`listed`'s `blank`, UnseenStrokes). Where a carry sample may be offered: after
 * a stroke of the course (not the flush check's probe), on a tree that lists the target where it lies
 * (`listedWhereItLies` — WDA's unclipped frames, as course.ts#stillNeeds asks). For the region the motion showed on a tree that
 * tells no scroll view (idb's): the gesture box below iOS's status band, where a touch goes to the status bar, not the
 * app.
 */
function ledgerRead(s: State, current: Since, afterProbe: boolean, facts: TreeFacts, found: readonly UiNode[], best: Judged | undefined, screen: UsableScreen | undefined, listed: () => ListedContent | undefined): LedgerRead {
  const sentToward = lastSent(s.course);
  const blank = current === 'stroke' && found.length === 0 ? listed() : undefined;
  const carryToward = current === 'stroke' && !afterProbe && best?.standing.facts.listedWhereItLies === true ? sentToward : undefined;
  const shows = screen === undefined ? undefined : belowStatusBand(screen.oriented, screen);
  return {
    since: current,
    found,
    judged: best?.node,
    facts,
    ...(shows !== undefined && { gesture: shows }),
    ...(blank?.kind === 'blank' && sentToward !== undefined && { blank: { within: blank.view.rect, toward: sentToward } }),
    ...(carryToward !== undefined && { carryToward }),
    ...(s.rules.strokes !== undefined && { strokes: s.rules.strokes }),
  };
}

/**
 * What the flush check's probe would be sent with this round (interact/flush-check.ts#ProbeMeans): the frame's box, the
 * gesture box, the stroke plan's memory, the read's cover and the one it offered the witness, the witness's answer, and
 * whether a swipe and time are left.
 */
function probeMeans(s: State, seen: RoundSeen, cover: AppliedKeyboard | undefined, offered: AppliedKeyboard | undefined): ProbeMeans {
  const budget = s.swipes < s.rules.maxSwipes && seen.elapsedMs < s.rules.timeoutMs;
  return { screen: s.frame.box, gesture: seen.screen?.oriented, strokes: s.strokes, cover, offered, corroborated: seen.corroborated, budget };
}

/** Another confirming read is within the stroke's budget and the deadline. */
const mayConfirm = (s: State, elapsedMs: number): boolean => s.confirmReads < SETTLE_CONFIRM_READS && elapsedMs < s.rules.timeoutMs;

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
  // An ask step (`RoundStep`'s `ask`): the witness, the unlocated row, or the eyes' question; the state as it came in.
  const ask = (asked: 'witness' | 'unlocated' | EyesQuestion): Next => ({ state, step: typeof asked === 'string' ? { do: 'ask', what: asked } : { do: 'ask', what: 'eyes', question: asked } });
  const { fully } = s.rules;
  const current = s.since;
  // The read after the flush check's probe (flush-check.ts#probing) — taken before this round's flush check closes it,
  // and the one answer every step of the round asks (the carry sample, a failed read, the settled read).
  const afterProbe = probing(s.flush);
  if (seen.drawn !== undefined) s.touchDowns = [...s.touchDowns, seen.drawn.from];

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

  // The screen changed under the strokes since the last read that read (ui-tree/read-tree.ts#ScreenChange): nothing of this read is judged
  // — a target in it lies on another screen than the one stroked — and nothing more is stroked onto it. Asked before
  // the judgement, so no witness is asked of a read that is not judged.
  if (read !== undefined) {
    const identity = screenIdentity(read.tree);
    const change = s.screenBefore === undefined ? undefined : screenChangedUnder(s.screenBefore, { tree: read.tree, identity }, s.touchDowns);
    s.screenBefore = { tree: read.tree, identity };
    s.touchDowns = [];
    if (change !== undefined) return stop(s, { kind: 'changed', swipes: s.swipes, change, found: found.length > 0 });
  }

  // What this read means (interact/scroll-read.ts#judgeRead): the tree's
  // facts, the cover that applies and the one offered, the best match
  // judged and the frames — or the witness to ask first, which changes
  // nothing (the state comes back as it went in). A round whose tree did
  // not read judges nothing.
  let judged = read === undefined ? undefined : judgeRead(read, s.frame, fully, seen.corroborated);
  if (judged !== undefined && 'ask' in judged) return ask(judged.ask);
  // THE ORDER SEEN (ui-tree/eyes.ts): the best match covered by a control the listing does not order (ADR 0024) — the
  // eyes are asked once which is drawn on top; such a stop never strokes (`overlapped`, below), so one screenshot ends
  // the scroll's question, asked whole and told what the eyes answered — or covered by texts in its touch margin only
  // (ADR 0026), each asked once where it lies (interact/margin-memo.ts#seeMargin: the texts to ask, or what to tell the
  // read, and the call's memo, `State.marginKept`). The read is judged again, told what was seen (`RoundSeen.order`).
  const ordering = judged?.best === undefined || read === undefined ? undefined : pairQuestion(read.tree, judged.best.node, judged.best.standing);
  if (ordering !== undefined && read !== undefined && judged !== undefined) {
    const said = ordering.asks === 'order' ? (seen.order === undefined ? { ask: ordering } : { told: seen.order, memo: s.marginKept }) : seeMargin(s.marginKept, ordering, seen.order, judged.facts);
    if ('ask' in said) return { state, step: { do: 'ask', what: 'order', question: said.ask } };
    s.marginKept = said.memo;
    if (said.told.length > 0) judged = judgeRead({ ...read, seen: seenOrderOf(ordering.node, said.told) }, s.frame, fully, seen.corroborated);
    if (judged !== undefined && 'ask' in judged) return ask(judged.ask);
  }
  const best = judged?.best;
  const cover = judged?.cover;
  const offered = judged?.offered;
  if (cover !== undefined) {
    s.lastCover = cover;
    s.coveredRounds++;
  }
  const gesture = seen.screen?.oriented;
  // What this read lists of the content of the scroll view the last stroke went over (stroke-plan.ts#strokedContent):
  // asked at most once a read — a walk of the tree and of its subtree, no device call — for the blank read and the
  // tree's end proof (`observe`). Boxed so that an answer of undefined (no scroll view stroked) is told from "not asked
  // yet".
  let content: { readonly of: ListedContent | undefined } | undefined;
  const listed = (): ListedContent | undefined => {
    const toward = lastSent(s.course);
    return (content ??= { of: toward === undefined || judged === undefined ? undefined : strokedContent(s.strokes, judged.facts, toward) }).of;
  };
  // THE MOTION LEDGER (interact/motion-ledger.ts) sees the stroke drawn and, when the tree read, the read — once, before
  // anything asks it: a read that did not read says nothing about motion, and the comparisons wait for the next one
  // that does.
  const motion = seeMotion(s.motion, { drawn: seen.drawn, ...(judged !== undefined && { read: ledgerRead(s, current, afterProbe, judged.facts, found, best, seen.screen, listed) }) });
  s.motion = motion.ledger;
  // What the strokes after this read keep of it (interact/stroke-plan.ts#seeRead): the line its strokes stay above
  // (`ReadJudgement.strokeLine`) — a round whose tree did not read keeps the last read round's, as its cover — and,
  // when it found the target, the target's scroll views with what this read draws over each — on a tree that tells none
  // (idb's), the region the ledger saw its content moving through (interact/motion-ledger.ts#regionOf).
  const region = regionOf(s.motion);
  if (judged !== undefined) s.strokes = seeRead(s.strokes, { facts: judged.facts, line: judged.strokeLine, target: best?.node, ...(region !== undefined && { region }) });
  // A stop the region its content was seen moving through holds back (interact/motion-ledger.ts#heldBack): no stop,
  // the strokes go on — turned toward it at the far edge (course.ts#seeTarget) — and the stuck and bound failures name it
  // (`under`). After the last stroke drawn, not this read's `seen.drawn`: a stop is claimed only on a confirming read,
  // where `seen.drawn` is undefined, and a fling carries the target on into the pushed side's band between the two.
  const heldBack = best !== undefined && stops(best) ? heldBackBy(s.motion, best.node.rect, fully ? 'fully' : 'stop') : undefined;
  const under: Extract<InFrameShort, { of: 'carriedUnder' }> | undefined = best !== undefined && heldBack !== undefined ? { of: 'carriedUnder', judged: best, under: heldBack } : undefined;
  const now: ThisRead | undefined = read === undefined || judged === undefined ? undefined : { read, facts: judged.facts };
  // THE COURSE (interact/course.ts) is shown where the target stands — on every read that read, a stop's too — and says
  // whether this read answers the stuck turn's stroke back (below).
  const sighted = now === undefined || judged === undefined ? undefined : seeTarget(s.course, { since: current, judged: best, frames: judged.frames, uncutFrames: judged.uncutFrames, ...(heldBack !== undefined && { heldBackAt: heldBack.edge }) });
  if (sighted !== undefined) s.course = sighted.course;
  const observed = now === undefined || motion.moved === undefined ? undefined : observe(s, current, now, best, motion.moved, listed);
  if (now !== undefined) s.detents = { first: s.detents === undefined ? now.facts.detent : s.detents.first, last: now.facts.detent };
  // `presentedHold` is this read's to set again (below).
  const presentedBefore = s.presentedHold !== undefined;
  if (now !== undefined) s.presentedHold = undefined;
  // The stroke back of the stuck turn is answered by the first read that reads after it is sent (course.ts#seeTarget).
  const answersBack = sighted?.answersBack === true;
  // A band the eyes saw that refuses the stop (THE EYES, below): no stop, the shortfall the stuck and bound failures name.
  let unlisted: Extract<InFrameShort, { of: 'unlisted' }> | undefined;
  // A cut the flush check's probe proved with no reveal to send this read (`FlushCut`): no stop, the shortfall the
  // stuck and bound failures name.
  let flushCut: FlushCut | undefined;
  // What the stroke after a plain stop whose match's centre is unknown needs (`unknownCentreStroke`): set, that stroke
  // is drawn instead of the stop.
  let centreStill: StillNeeds | undefined;
  // The judged match in the frame, on a read that read: what a stop is judged on.
  const inFrame = best !== undefined && best.standing.facts.visible > 0 && observed !== undefined && now !== undefined;
  // The question a `fully visible` claim on it would ask the eyes (THE EYES, below), when the trigger applies.
  // Covered: by a cover the draw order found (cover.ts#drawOrderFound), as before the overlaid edge was a cover —
  // neutral either way today: an overlaid cover lies over a node in no scroll view, which has no flush neighbour to ask of.
  const question = inFrame && fullyClaimed({ clipped: best.standing.facts.clipped, covered: best.standing.facts.covers.some(drawOrderFound) }) ? eyesQuestion(now.facts.scene, now.read.tree, best.node, s.frame, fully ? 'fully' : 'stop') : undefined;
  // Refused again (`State.eyesRefused`): the read after a stroke finds the target and its neighbours where the eyes
  // last refused them — no confirm, no screenshot; this stroke's read, short as before.
  const refused = s.eyesRefused;
  const refusedAgain = current === 'stroke' && refused !== undefined && question !== undefined && sameQuestion(refused.asked, question);
  // A stop is judged on this read: the match a stop by its standing, not refused again, not held back by its motion.
  const judgesStop = inFrame && stops(best) && !refusedAgain && under === undefined;
  // THE FLUSH CHECK (interact/flush-check.ts) is shown every read that read once — a `fully: true` stop's match, or
  // none — and answers the probe in flight; a read that did not read keeps it, and is read again below rather than
  // stroked away from.
  const flush = read === undefined ? undefined : seeFlush(s.flush, judgesStop && fully ? { judged: best, facts: now.facts, drawn: lastDrawn(s.motion), means: probeMeans(s, seen, cover, offered) } : undefined);
  if (flush !== undefined) s.flush = flush.check;
  if (inFrame) {
    if (refusedAgain) unlisted = { ...refused.short, judged: best };
    if (judgesStop && flush !== undefined) {
      // A stop after a stroke is reported only once a read finds the target
      // where the last one did (SETTLE_CONFIRM_READS): a fling can carry it
      // on, or out of the frame, after the settle read caught it inside. A
      // stop at 0 swipes was not stroked, nor one a probe came back from
      // unmoved (`FlushSeen.settles`): reported at once. Nor one on the read
      // after a scroll stroke where that read waits for the screen at rest
      // (`RoundRules.readSettles`): it is the settled read — but not the
      // read after a probe, which keeps the flush check's own rule.
      const settled =
        s.swipes === 0 ||
        flush.settles ||
        (current === 'settle' && observed.bestUnmoved) ||
        (s.rules.readSettles === true && current === 'stroke' && !afterProbe);
      // A fling still slowing is waited out, spending none of the budget (SETTLE_CONFIRM_READS): the stop is judged on
      // the read it comes to rest in, not on one it is still carrying the target through. Neither on a cut a probe
      // proved (`FlushSeen.waits`): the next stroke reveals the rest, at once.
      if (!settled && flush.waits && observed.slowing && seen.elapsedMs < s.rules.timeoutMs) return waitOut(s);
      if (!settled && flush.waits && mayConfirm(s, seen.elapsedMs)) return confirm(s);
      // `fully: true`, an edge flush with the clipping container: possibly cut there — probe once toward it, reveal
      // what a probe proved cut, or say it could not be checked (`FlushVerdict`).
      const { verdict } = flush;
      if (verdict.of === 'witness') return ask('witness');
      if (verdict.of === 'probe') return probe(s, verdict);
      if (verdict.of === 'cut') flushCut = verdict.cut;
      else {
        // The `unlocated` row on a `fully: true` stop only — where the answer
        // changes what the reader does next — and only with no cover under
        // the judgement: a band THIS stop was judged under is what it reports.
        let unlocated = false;
        if (fully && best.under === undefined) {
          if (seen.unlocated === undefined) return ask('unlocated');
          unlocated = seen.unlocated;
        }
        // THE EYES CONFIRM A FULLY CLAIM (ui-tree/eyes.ts), last: a stop that would say "fully visible" — nothing of it
        // clipped, nothing listed over it — on a target with a flush neighbour narrower than the screen
        // (ui-tree/eyes.ts#eyesQuestion) is looked at once, one screenshot, before it is claimed; every other stop asks
        // nothing. A band of a surface the tree does not list is no stop under `fully: true`, nor — as a cover over its
        // centre is not (ui-tree/standing.ts#Scene.standing) — for the plain stop when it reaches the centre the next tap
        // presses: the strokes go on as for a cover (bounded as every round is), and the stuck or bound failure names it
        // (`unlisted`). A band short of the centre: the plain stop stops and says what lies over it. What the eyes could
        // not judge is said with the tree's claim.
        const eyes = question === undefined ? undefined : seen.eyes;
        if (question !== undefined && eyes === undefined) return ask(question);
        const finding: EyesFinding | undefined = eyes === undefined || eyes.sees === 'own' ? undefined : eyes;
        if (finding?.sees !== 'surface' || !(fully || reachesPoint(finding, question?.region ?? best.node.rect, tapPoint(best.node)))) {
          // ITS CENTRE UNKNOWN (D17): the plain stop's match cut at the screen's edge on the side the content lies
          // toward — one more stroke first, cut to bring its known side up to the frame's (`unknownCentreStroke`).
          // Never under `fully: true`, which does not stop on a match past its frame (`clipped`) — as one cut at the screen's edge is.
          centreStill = unknownCentreStroke(s, best, seen.elapsedMs);
          if (centreStill === undefined) {
            return stop(s, { kind: 'visible', swipes: s.swipes, judged: best, settled, unlocated, ...(verdict.of === 'flush' && { flush: verdict.flush }), ...(finding !== undefined && { eyes: finding }) });
          }
        } else {
          unlisted = { of: 'unlisted', judged: best, finding, ...(offered !== undefined && { offered: { lineY: offered.line.y, remedy: offered.remedy } }) };
          if (question !== undefined) s.eyesRefused = { asked: askedOf(question), short: unlisted };
        }
      }
    }
    // Under a screen presented over it (ADR 0018) no swipe moves it out, and a swipe on that screen may
    // dismiss it: one more read with no stroke between, then stop — or, should the screen be gone by
    // then, the read above stops as any other. Without a confirm left, stop on this read.
    // The standing's own remedy decides it (ui-tree/standing.ts#Remedy, presented first, whatever the kind) — when the
    // presented surface lies over it IN this read's frame: the remedy then carries the cover its sentence names, as its
    // record (the one the standing judged it under, else that surface). One the standing judged of the node alone
    // (draw-order.ts#DrawOrder.presentedOver: nothing of that surface over what shows of it) carries none, and is the
    // stroke's to ask, at its touch-down (the stroke plan's `presented`): a stroke that misses that screen is sent.
    const remedy = best.standing.kind === 'reachable' ? undefined : best.standing.remedy;
    if (remedy?.of === 'presented' && remedy.cover !== undefined) return holdPresented(s, { kind: 'presented', swipes: s.swipes, judged: best, cover: remedy.cover, viewport, ...(remedy.layer !== undefined && { layer: remedy.layer }) }, current === 'settle' && presentedBefore, seen.elapsedMs);
    // Under a cover listed in reading order with it — the order untold, or seen by a screenshot — no swipe tells which is
    // on top or moves it out from under the other: stop.
    if (best.standing.kind === 'covered' && (best.standing.remedy.of === 'unordered' || best.standing.remedy.of === 'seenOver')) {
      return stop(s, { kind: 'overlapped', swipes: s.swipes, judged: best, viewport, cover: best.standing.cover, remedy: best.standing.remedy });
    }
    // Still clipped (`fully: true`) or under something of the app — only a
    // swipe that MOVES it can help.
    // The stuck turn: the
    // far-edge reading (course.ts#seeTarget's `atFarEdge`) turns a target short at the
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
    const { sliver } = best.standing.facts;
    // Nor for a band of a surface the eyes saw (THE EYES) stuck on strokes that lift it out from under that surface:
    // the other way only pushes it further under — measured live on k7 with `fully: true`, the stroke back up laid
    // phone under the bar again, a 42-px strip.
    const outward = (on: Direction): boolean => (!fully && sliver !== undefined && SIDES[sliver.edge].reveals === on) || (unlisted !== undefined && SIDES[unlisted.finding.edge].reveals === on);
    const stuck = stuckTurn(s.course, { stuck: observed.stuck, backUnmoved, outward });
    if (stuck !== undefined) {
      const { on: stuckOn, otherWay } = stuck;
      const strokeBack = otherWay === 'untried' && s.swipes < s.rules.maxSwipes && seen.elapsedMs < s.rules.timeoutMs;
      if (!strokeBack) return stop(s, { kind: 'stuck', swipes: s.swipes, short: unlisted ?? flushCut ?? under ?? shortOf(best), lastStroke: stuckOn, viewport, otherWay });
      s.course = turnBack(s.course, stuckOn);
    }
  }
  // No read of this call has read (`CallEvidence`'s `unread`): no stroke — one drawn with no tree read is a side effect
  // on a screen nothing has shown, and no read before it is there to tell the next one changed (`screenBefore`). Live
  // (idb, the lab's large sheet): every read of a call failed, and six full strokes drawn blind dismissed the sheet. Read
  // again after a settle while the budget allows, spending no confirming read (there is no stop to confirm: a target
  // the first read that reads finds under a presented screen still gets its own); at the deadline the bound below says
  // no read succeeded (`neverRead`).
  if (callEvidence(s).of === 'unread' && seen.elapsedMs < s.rules.timeoutMs) return waitOut(s);
  // A rebound that may be under way (UNMOVED_STROKES_EXHAUST's rebound, motion-ledger.ts#Moved `rebounding`): read again
  // after a settle, the stroke's first confirming read (the stroke left none spent) — the settled read answers for the
  // stroke. Only while time is left: at the deadline the bound, as before. At maxSwipes too: the last stroke is answered.
  if (motion.moved?.rebounding === true && mayConfirm(s, seen.elapsedMs)) return confirm(s);
  // A confirming read that did not read, or the read after a probe: read
  // again, within the same budget, rather than stroke away from a stop the
  // last read saw.
  if ((current === 'settle' || afterProbe) && read === undefined && mayConfirm(s, seen.elapsedMs)) return confirm(s);
  // A presented stop held for its confirming read (`presentedHold`) and no read left to confirm it with: stop as the
  // last read that read left it — never a stroke drawn blind, which would land on the screen that read saw presented
  // (a read failing three times after the popover's hold had stroked onto its dim). Not a wait to the deadline: the
  // reads are failing, and the last one that read is the evidence there is.
  if (read === undefined && s.presentedHold !== undefined) return stop(s, s.presentedHold);
  // What this round's read saw, for a target no round matched (ui-tree/miss.ts — the not-found's note; asked only at a
  // stop that may say "never appeared", so a round that goes on pays no presentation walk). A call that has stroked has
  // searched a presented window's own scroll view (ADR 0018 decision 3: the strokes go there), so its note sends no one
  // back to it.
  const missed = (): Miss | undefined => (s.everFound ? undefined : missOf({ tree: read?.tree, readError, target: s.rules.target, scrolled: s.swipes > 0 }));
  const evidence: WaitEvidence = { sighted: s.everFound, treesRead: s.treesRead, readError };
  // A keyboard that leaves nothing above it: nothing but its own UI can be
  // judged, and no stroke can start on the content — fail now, naming it,
  // rather than swipe on keys or fall back to the whole screen and report a
  // bare "fully visible".
  if (cover !== undefined && cover.above === undefined) return stop(s, { kind: 'covered', swipes: s.swipes, cover, viewport, evidence: { ...evidence, miss: missed() } });
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
  const turned =
    exhausted === 'matches' && ends !== undefined && best !== undefined && now !== undefined && observed !== undefined && s.swipes < s.rules.maxSwipes && seen.elapsedMs < s.rules.timeoutMs && insideScrollView(best, ends, now.facts)
      ? turnAtEnd(s.course, { target: best.node.rect, view: ends.rect, proof: endProof(s, ends, 'matches', observed.streaks), after: s.swipes })
      : undefined;
  if (turned !== undefined) {
    s.course = turned;
    exhausted = undefined;
  }
  // A text a screenshot saw drawn over a `fully: true` match, carried with it since (margin-memo.ts#carriedCover): no
  // stroke brings it out from under the text — the bound, now. One read is enough — one dump is one frame, the pair's
  // relation in it a fact mid-fling or not — so no confirming read and no screenshot. Exclusive with `exhausted`, which
  // needs every match unmoved.
  const movesWith = fully && exhausted === undefined && best !== undefined && now !== undefined ? carriedCover(s.marginKept, best, now.facts) : undefined;
  // The stroke this round would draw, asked of the plan once (interact/stroke-plan.ts#planStroke): toward the course's
  // direction, at its reach (course.ts#nextStroke), over this round's gesture box, with this read's facts — its scroll view,
  // box and cover, the points the driver sends, and the presented surface those points touch down on. A bound quotes
  // that surface; the course holds for it or sends the stroke.
  const next = nextStroke(s.course);
  const { toward, reach } = next;
  const still = centreStill ?? next.still;
  const learnt = callEvidence(s);
  const kind = strokeKind(learnt, toward);
  const plan = planStroke(s.strokes, {
    toward,
    reach,
    gesture,
    read: now === undefined ? undefined : { facts: now.facts, target: best?.node },
    ...(still !== undefined && { still }),
    ...(!overRegion(s.motion, toward) && { screenBox: true }),
    kind,
  });
  // The plan's memory, kept at once whatever becomes of the stroke — the candidates it judged, the latest cut of the
  // target's scroll views, and the scroll view it chose, which only sending makes the last stroke's (`strokeSent`,
  // below). Kept here, before any branch, so a presented hold cannot leave it behind; a bound is a stop, whose state
  // no round reads again.
  s.strokes = plan.memory;
  if (exhausted !== undefined || movesWith !== undefined || s.swipes >= s.rules.maxSwipes || seen.elapsedMs >= s.rules.timeoutMs) {
    // The `unlocated` row, asked of the last round's reading whatever came
    // before — a round whose tree did not read has none.
    let unlocated = false;
    if (read !== undefined) {
      if (seen.unlocated === undefined) return ask('unlocated');
      unlocated = seen.unlocated;
    }
    const touched = exhausted === undefined || now === undefined ? undefined : touchedOn(s.strokes, now.facts, lastDrawn(s.motion));
    // Where the swipe the bound held back would have touched down, when that is a presented screen's surface: said,
    // since the reader's next step would otherwise be another scroll that lands there (the plan's `presented`).
    // Quoted only on behalf of a target: with none in the tree the bound says nothing of where its held-back swipe
    // would land.
    const onPresented = best === undefined ? undefined : plan.presented;
    const course = courseFacts(s.course);
    const miss = missed();
    const by: BoundBy =
      exhausted !== undefined
      ? {
          of: 'exhausted',
          lastStroke: course.lastStroke,
          unchanged: exhausted,
          ...(touched !== undefined && { touched }),
          ...(ends !== undefined && observed !== undefined && { ends: { way: course.lastStroke, ...endProof(s, ends, exhausted, observed.streaks) } }),
          ...(learnt.of === 'unfelt' && (miss === undefined || !saysTopLayerOnly(miss)) && { unlisted: learnt.source }),
        }
      : movesWith !== undefined
        ? { of: 'movesWith', offset: movesWith }
        : s.swipes >= s.rules.maxSwipes
        ? { of: 'maxSwipes' }
        : { of: 'timeout', timeoutMs: s.rules.timeoutMs, elapsedMs: seen.elapsedMs, reads: s.reads };
    return stop(s, {
      kind: 'bound',
      swipes: s.swipes,
      by,
      short: shortfall(s, { readError, found, best, viewport, cover, miss, held: unlisted ?? flushCut ?? under }, by),
      turns: course.turns,
      ...(s.lastCover !== undefined && { keyboard: { cover: s.lastCover, rounds: s.coveredRounds, read: s.treesRead } }),
      unlocated,
      evidence: { ...evidence, miss },
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
  s.course = sent(s.course, next);
  if (centreStill !== undefined) s.centreStroked = true;
  s.confirmReads = 0;
  s.since = 'stroke';
  s.swipes++;
  s.owesDrawn = true;
  return { state: s as unknown as Rounds, step: { do: 'stroke', ...plan.stroke } };
}

/** One round's step, as `round` returns it. */
type Next = { state: Rounds; step: RoundStep };

/**
 * THE UNKNOWN CENTRE (D17): what one more stroke needs before a plain stop on `best` — undefined, no such stroke, the
 * stop made. uiautomator cuts a node's bounds at the screen's edge whatever scroll view it lies past
 * (adapters/types.ts#UiNode.boundsCutAtScreen), so a carousel's card running past its carousel's edge is listed ending
 * at the screen's: its centre, which the stop judges, is unknown — measured, C laid at x 586 948 wide was dumped
 * `[586,380][1080,614]`, its listed centre 833 inside the carousel ending at 1014, its true one 1060 past it, and the stop
 * said "visible". So the stop strokes ONCE more toward that side, cut to what its known side still needs to reach its
 * frame's far edge (course.ts#unknownCentreNeeds) — the content the way the course already goes (the course's next
 * stroke toward that side; a stroke against the caller's direction is none of this rule's), never a turn — and the
 * next read's stop is made as it stands, its share "at most" (interact/scroll-text.ts). Once a scroll (`centreStroked`):
 * a carousel exactly one card wide shows such a card whole at one offset only, and a rule that stroked until the
 * centre were known could swing it to and fro. Not at the bound (no swipe or time left: the stop is made).
 */
function unknownCentreStroke(s: State, best: Judged, elapsedMs: number): StillNeeds | undefined {
  if (s.centreStroked || s.swipes >= s.rules.maxSwipes || elapsedMs >= s.rules.timeoutMs) return undefined;
  const next = nextStroke(s.course);
  if (next.turn) return undefined;
  const { facts } = best.standing;
  return unknownCentreNeeds(best.node.rect, facts.unknownPast, facts.screen, next.toward);
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
 * Send the flush check's probe (interact/flush-check.ts#FlushVerdict's `probe`) as the plan made it
 * (interact/stroke-plan.ts#planProbe): toward revealing its edge (`toward`), over a scroll view with room above the
 * probe's keyboard and what is drawn over it — never the screen box: a stop with no ancestor that has room is reported
 * unchecked, not probed — its reach and travel the course's (interact/course.ts#probeOf); the check kept with it in
 * flight. A swipe like any other for the count and the bound, but not a step of the scroll's course
 * (interact/course.ts#probeSent: a probe the other way from the caller's direction is not a turn and halves no reach).
 */
function probe(s: Mutable<State>, { toward, stroke, memory, check }: Extract<FlushVerdict, { of: 'probe' }>): { state: Rounds; step: RoundStep } {
  s.flush = check;
  s.strokes = strokeSent(memory);
  s.course = probeSent(s.course, toward);
  s.confirmReads = 0;
  s.since = 'stroke';
  s.swipes++;
  s.owesDrawn = true;
  return { state: s as unknown as Rounds, step: { do: 'stroke', ...stroke, probe: true } };
}

/** Spend a confirming read: the next read follows a settle, not a stroke. */
function confirm(s: Mutable<State>): { state: Rounds; step: RoundStep } {
  s.confirmReads++;
  return waitOut(s);
}

/** Read again after a settle, spending no confirming read: a fling still slowing (`Observed.slowing`) — and `confirm`'s step. */
function waitOut(s: Mutable<State>): { state: Rounds; step: RoundStep } {
  s.since = 'settle';
  return { state: s as unknown as Rounds, step: { do: 'confirm' } };
}

function stop(s: Mutable<State>, outcome: ScrollOutcome): { state: Rounds; step: RoundStep } {
  s.done = true;
  const detent = detentMove(s);
  const { endTurn } = courseFacts(s.course);
  return { state: s as unknown as Rounds, step: { do: 'stop', outcome: { ...outcome, ...(detent !== undefined && { detent }), ...(endTurn !== undefined && { endTurn }) } } };
}

/**
 * The end proof over `view` as the stop carries it (`EndProof`), but for its way (the course's to add): the scroll view
 * quoted, and the one count of the strokes that moved nothing — every match's (`matches`) or the whole tree's (`tree`, a
 * target not in it), from the motion ledger's `streaks` of this read — never more than the swipes sent.
 */
function endProof(s: State, view: UiNode, unchanged: 'matches' | 'tree', streaks: Streaks): Omit<EndProof, 'way'> {
  return { scrollView: quoted(view), unmoved: Math.min(unchanged === 'tree' ? streaks.tree : streaks.all, s.swipes) };
}

/**
 * The end turn's condition the tree answers (`EndTurn`, interact/course.ts#turnAtEnd has the rest): the judged match
 * lies INSIDE `view` — one of the scroll views it is drawn in (ui-tree/geometry.ts#Clips.drawnIn).
 */
function insideScrollView(best: Judged, view: UiNode, facts: TreeFacts): boolean {
  return toldFrame(facts.scene.clips.drawnIn(best.node))?.scrollers.includes(view) === true;
}

/** The top sheet's detent at the first read that read against the last (`DetentMove`): both read, as many grabbers, values differing. */
function detentMove({ detents }: State): DetentMove | undefined {
  if (detents === undefined) return undefined;
  const { first, last } = detents;
  if (first === undefined || last === undefined || first.grabbers !== last.grabbers || first.detent === last.detent) return undefined;
  return { from: first.detent, to: last.detent };
}

/**
 * WHAT THE CALL HAS LEARNT ABOUT WHERE ITS STROKES LAND — the one question behind the stroke's kind (`strokeKind`), the
 * unmoved stop's note (BoundBy's `unlisted`), the rule that no stroke is drawn blind (`round`) and a bound's `neverRead`:
 * - `unread`: no tree read of the call has read — nothing shows what the screen is, and nothing is there to tell a
 *   stroke changed it (`screenBefore`): no stroke;
 * - `unfelt`: the last read that read is of a source that lists only the top layer (ui-tree/miss.ts#topLayerOnlySource:
 *   idb's flat list, which shows no sign of a large sheet, an alert or a cover over the screen — ADR 0018, "idb's
 *   presented layer"), the target never seen and no stroke of the call has moved the tree (motion-ledger.ts#treeMoved):
 *   the strokes may land on such a layer — `source`, the tree source the stop's note speaks of. THE FEELER's trigger:
 *   its content-up strokes are feelers (`strokeKind`; interact/stroke-plan.ts#StrokeKind, how a feeler is drawn);
 * - `felt`: anything else — a tree that lists its presented layers or its scroll views (WDA, uiautomator; a layer it
 *   marks is no stroke's, the plan's `presented`), a target the call has seen, a tree a stroke has moved. Its `source`,
 *   when the last read that read is still of a source that lists only the top layer (the strokes after the first on
 *   idb, a target seen there): THE PACE's trigger — idb's full strokes are paced (`strokeKind`; D20).
 */
type CallEvidence = { of: 'unread' } | { of: 'unfelt'; source: TopLayerOnlySource } | { of: 'felt'; source?: TopLayerOnlySource };

function callEvidence(s: State): CallEvidence {
  const last = s.screenBefore?.tree;
  if (last === undefined) return { of: 'unread' };
  const source = topLayerOnlySource(last);
  if (source === undefined) return { of: 'felt' };
  return !s.everFound && !treeMoved(s.motion) ? { of: 'unfelt', source } : { of: 'felt', source };
}

/**
 * The kind of stroke this round sends toward `toward` (interact/stroke-plan.ts#StrokeKind): a FEELER while the call's
 * strokes are `unfelt`, toward content ABOVE (`up`: the finger dragged down — the one stroke that dismisses a
 * swipe-dismissable sheet; measured, ADR 0018 residual 6); else a full stroke — every push-up, and every stroke the
 * call's evidence has `felt`. A list that moves on the feeler gets full strokes after it. A full stroke is PACED
 * (stroke-plan.ts#PACED) when the evidence's `source` is idb — `unfelt` or `felt` alike: a stroke after the first is
 * `felt` and still idb's, and a full stroke on idb flings a SwiftUI List about twice its length, past every row the
 * read before listed (D20). Only idb: the pace is idb's measured one, not a top-layer-only source's whatever it is.
 * The feeler keeps precedence.
 */
function strokeKind(evidence: CallEvidence, toward: Direction): StrokeKind {
  if (toward === 'up' && evidence.of === 'unfelt') return 'feeler';
  return evidence.of !== 'unread' && evidence.source === 'idb' ? 'paced' : 'full';
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
  readonly cover: AppliedKeyboard | undefined;
  /** What this round's read saw of a target no round matched (ui-tree/miss.ts#missOf) — an `absent` failure carries it. */
  readonly miss: Miss | undefined;
  /** What alone kept a stop on the best match from being claimed this round: what the eyes saw over it (`fully: true`), the cut a probe proved (`FlushCut`), or the region its motion showed (`carriedUnder`). */
  readonly held: Extract<InFrameShort, { of: 'unlisted' | 'carriedUnder' }> | FlushCut | undefined;
}

/**
 * What the target was short of at a bound (`by`). In the frame on an
 * earlier read and not on this one: "never" would be false — a fling carried it off, or a lazy list dropped it once it scrolled
 * away. Last found beyond the far edge, the side (`Shortfall.past`); never
 * found, the side left unread when the strokes ran to the end of the
 * content without a turn (`Shortfall.absent`'s `unsearched`).
 */
function shortfall(s: State, { readError, found, best, viewport, cover, miss, held }: BoundRound, by: BoundBy): Shortfall {
  if (readError !== undefined) return callEvidence(s).of === 'unread' ? { of: 'neverRead', error: readError } : { of: 'readFailed', error: readError };
  if (held !== undefined) return held;
  if (best !== undefined && best.standing.facts.visible > 0) return shortOf(best);
  const left = s.inFrameAfter;
  const { past, far } = courseFacts(s.course);
  if (found.length === 0) {
    if (left !== undefined) return { of: 'gone', inFrameAfter: left };
    if (s.inTreeAfter !== undefined) return { of: 'left', inTreeAfter: s.inTreeAfter, ...(past !== undefined && { past }) };
    // Never found: no turn was drawn (each needs a sighting), so the far side is unstroked.
    const ranToEnd = treeMoved(s.motion) && by.of === 'exhausted' && by.unchanged === 'tree' && by.touched === undefined;
    // Strokes over blank content up to a bound that is not the content's end: they may have moved it (UnseenStrokes).
    const unseen = by.of === 'exhausted' ? undefined : unseenStrokes(s.motion);
    return { of: 'absent', ...(ranToEnd && { unsearched: far }), ...(miss !== undefined && { miss }), ...(unseen !== undefined && { unseen }) };
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

