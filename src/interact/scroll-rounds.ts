import type { ClippedSide, DeviceScreen, Point, Rect, Stroke, UiNode } from '../adapters/types.js';
import { drawOrder, type DrawOrder } from '../ui-tree/draw-order.js';
import { clippedEdges, clipsOf, containsPoint, flushEdges, higherTop, largestScroller, rectArea, rectIntersection, sameRectWithinPixel, visibleFractionInViewport, type Clips, type Cut, type Edge } from '../ui-tree/geometry.js';
import type { KeyboardCover } from '../ui-tree/keyboard-cover.js';
import { showsProgress, treeFingerprint } from '../ui-tree/read-tree.js';
import { tapPoint } from '../ui-tree/selectors.js';
import type { KeyboardRemedy } from '../ui-tree/soft-keyboard.js';
import type { WaitEvidence } from './resolve.js';
import { belowStatusBand, inStatusBand, judgingOf, OPPOSITE, REVEALS, sameStroke, strokeLength, strokeRoom, TOUCH_SLOP, type Direction, type JudgingScreen, type ScreenBox, type StrokeRoom } from './swipe.js';

/**
 * `scroll_until`'s ROUND as one pure function (2026-10-09, the scroll-rounds
 * deepening): `round(state, seen) → { state, step }` — what one read of the
 * screen means for the scroll, and what to do next. Every rule that compares
 * a read with an earlier one, and every fact the loop carried from round to
 * round, lives here and nowhere else: the confirming reads
 * (SETTLE_CONFIRM_READS), the turn after a fling and its halved reach, the
 * stuck and exhausted tests (UNMOVED_STROKES_EXHAUST, the same stroke
 * twice), the moot band, the cover carried to a round whose tree did not
 * read, the frame kept across such a round, and the deadline. Until that
 * date they were the `Motion` class and eleven `let`s of the loop in
 * interact/scroll.ts, so a rule could be reached only through a scripted
 * FakeAdapter and a regex over the failure; three review rounds' bugs
 * (an unread round's cover, the witness's ordering, the frame across a
 * failed read) were each a diff against three loose variables.
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
 *   Android, and which rounds pay them is the rule this module owns.
 * - `confirm`: settle, read again, send nothing. `stroke`: draw the stroke
 *   the step describes and hand it back, as sent, in the next round's
 *   `drawn` — the "same stroke twice" identity is the points as sent
 *   (swipe.ts#scrollStroke of the step, whose `box` this module decides
 *   over the driver's gesture box — RoundSeen.screen). `drawn` is
 *   required on the round after a `stroke` and refused on any other; `round`
 *   throws on either breach, and on any call after `stop`.
 * - `stop`: the scroll is over; `outcome` says how (interact/scroll-text.ts
 *   renders it — the reply or the failure, one switch over its kind).
 *
 * ORDER inside a round, fixed: the round's judgement over the whole screen,
 * then — when the reading offers a cover and the band is not moot — the
 * witness (`ask witness`), the covered judgement replacing the whole one
 * only when it stood by the band; motion observed (a read that read only);
 * the stop verdict (settled / confirm / unsettled; then, on a `fully: true`
 * stop flush with a clipping scroll container, the probe — `ask witness`
 * first for a band the moot rule left unasked — PROBE_REACH; then `ask
 * unlocated` on a `fully: true` stop with no cover under it); stuck; the
 * confirming read, or the read after a probe, that did not read; covered
 * (nothing above the band); the bound (exhausted, maxSwipes, deadline —
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

/** What one round saw — the driver's gathering, or a test's table row. */
export interface RoundSeen {
  /** This round's tree read: what it held, or the error that stood in for it (a miss, not a failure — read-tree.ts#readTreeOrError). */
  read: RoundRead | { error: Error };
  /**
   * This round's swipe.ts#screenBox — ONE read gives both boxes the round
   * uses, so they can never come from different reads: its `box`, the
   * GESTURE box the stroke is drawn in, over which the round judges a
   * container's room (swipe.ts#strokeRoom) and from which a stroke step's
   * `box` is cut; and, on a round whose tree read, its `boxes`, the frame
   * the round judges in (`judgingOf` — the tap's screen too). On a round
   * whose tree did not read it is the device as built and only its `box`
   * is used: the frame stays the last one. Absent when there is none
   * (screenBox threw): the frame stays, no container has room, and a stroke
   * step carries no box — the driver throws why.
   */
  screen?: ScreenBox;
  /** The stroke the previous `stroke` step drew, as sent. Required after `stroke`, refused otherwise. */
  drawn?: Stroke;
  /** The answer to `ask witness`: the round's keyboard reading's `corroborated()`. */
  corroborated?: boolean;
  /** The answer to `ask unlocated`: the round's keyboard reading's `unlocated()`. */
  unlocated?: boolean;
  /** ms since the scroll began (after the device's screen was read), stamped on every call — re-entry included. */
  elapsedMs: number;
}

/**
 * A tree that read, as the round needs it: the TREE itself — the round
 * derives what it asks of it (`TreeFacts`) — the matches the driver found
 * in it, the judged screen, and the SYNCHRONOUS facts of the round's
 * keyboard reading (ui-tree/keyboard-cover.ts#readKeyboard), never the
 * reading itself: its two async questions reach the round only as answers
 * to an `ask`, and a reading is never held across rounds (the
 * keyboard-cover.ts doc's rule) — the driver builds one per round.
 *
 * Five fields, since deep/r3-scroll (2026-10-09): until then the driver
 * also handed in four facts derived from the tree — the matches' clipping
 * ancestors, the largest clipping container, the tree's fingerprint and
 * whether it showed progress — the last three optional, and an omitted one
 * silently disabled a rule (no fingerprint: the whole-tree exhaustion never
 * fired; a fingerprint without `loading`: a loading list read as
 * exhausted). They are pure functions of the tree, so the round derives
 * them; there is nothing left to forget.
 */
interface RoundRead {
  /**
   * This round's tree, as read (in-process data: the round stays pure).
   * Never mutated once handed in — by the driver, a test or the round:
   * its facts (`factsOf`) are derived from it on each call, so a tree
   * changed between an `ask` and the re-entry would be judged by two
   * different trees in one round.
   */
  tree: UiNode;
  /** The matches of the target to judge, in tree order (resolve.ts#matchesToJudge: the one the next tap acts on when the preference picks one, else every match) — nodes OF `tree`: their clipping ancestors are looked up by identity. */
  found: readonly UiNode[];
  /** The reading's `cover()`: everything a shown keyboard covers; undefined when hidden or unknown. */
  cover?: KeyboardCover;
  /** The reading's `ofKeyboard`: is this node the keyboard's own UI (judged against the whole screen, never under the band)? */
  ofKeyboard: (node: UiNode) => boolean;
}

/** What the round asks of a tree that read — derived by `factsOf`, never handed in. */
interface TreeFacts {
  /**
   * The tree's clipping (ui-tree/geometry.ts#clipsOf), one walk: a match's
   * ancestors that CLIP it, nearest first (`scrollersOf`) — Android's scroll
   * containers, to whose edges uiautomator has already cut the match's
   * bounds; empty when it has none (every node of an iOS tree) — for the
   * `fully: true` stop's flush check (PROBE_REACH) and the box the strokes
   * are drawn in (swipe.ts#strokeRoom); and the plain stop's sliver rule
   * (`judge`, `cutSliver`), which a match inherits from an ancestor cut to a
   * sliver at the edge it lies flush with (round 8) — each ancestor judged
   * once a round, whatever the number of matches.
   */
  clips: Clips;
  /**
   * The largest clipping container (ui-tree/geometry.ts#largestScroller) —
   * the screen's own scroll view, for a stroke while the target's own
   * container is not known (it has not been read yet). Undefined when the
   * tree has none (iOS).
   */
  mainScroller: Rect | undefined;
  /**
   * The tree's draw order (ui-tree/draw-order.ts), once a round: the
   * judgement's covers and minimum piece (`exposure`, `judge`); what is
   * drawn OVER a clipping container (2026-10-09, the floating tab bar) —
   * `drawnOver`, what a stroke over it keeps clear of (swipe.ts#strokeRoom
   * cuts the box above them), and `drawnOverAt`, the one a stroke that
   * still touched down on it names (`touchedOn`), asked of the rects
   * `clips.scrollersOf` and `mainScroller` give, undefined when this tree has no
   * container with that rect (one remembered from an earlier read: the list
   * has moved since), never any on iOS, which has no clipping container;
   * and idb's keyboard band's top (`keyboardBandTop`), the line the strokes
   * stay above (`strokeTop`).
   */
  drawOrder: Pick<DrawOrder, 'exposure' | 'drawnOver' | 'drawnOverAt' | 'keyboardBandTop'>;
  /**
   * A cheap fingerprint of the WHOLE tree (ui-tree/read-tree.ts
   * #treeFingerprint) — every node's role, text, id and rect — for "the
   * strokes changed nothing at all" when the target is not in the tree
   * (UNMOVED_STROKES_EXHAUST).
   */
  fingerprint: string;
  /**
   * The tree shows a progress indicator (ui-tree/read-tree.ts#showsProgress:
   * a `progress` node with area — Android's ProgressBar, which a Compose
   * progress indicator also dumps as) — the screen may be loading, so an
   * unchanged fingerprint does not say the content is exhausted.
   */
  loading: boolean;
}

/**
 * `TreeFacts` of a tree: five walks — four as the driver made them before
 * deep/r3-scroll, and the draw order's (2026-10-09), which holds idb's
 * keyboard band's top too. Derived ONCE per call of `round`, BEFORE the
 * judgement, and handed to it and along (`ThisRead`) — each fact from one
 * derivation (code review of round 7, S3: the judgement's clipping chains
 * and the band's top were derived beside these, a second clipping walk
 * and a second walk for the band the draw order had already found). A call
 * that re-enters after an `ask witness` (the ask most re-entries are for,
 * which needs only the judgement), an `ask unlocated` (a `fully: true` or
 * bound stop, once a scroll) or an `ask witness` before a probe derives
 * them again: no cache, so the module holds no state between calls (code
 * review of deep/r3-scroll, S6: until then a WeakMap by tree object saved
 * those walks) — the fingerprint, the progress check and the largest
 * scroller are now walked on a round that then asks for the witness too,
 * a pure walk of an in-memory tree beside a device read.
 */
function factsOf(tree: UiNode): TreeFacts {
  return {
    clips: clipsOf(tree),
    mainScroller: largestScroller(tree),
    drawOrder: drawOrder(tree),
    fingerprint: treeFingerprint(tree),
    loading: showsProgress(tree),
  };
}

/**
 * One read that read, as the round has gathered it by `observe`: the read,
 * its tree's facts, the frames the round judged in (the screen above an
 * applied keyboard, or each box that counts), the gesture box (the round's
 * `RoundSeen.screen` box; undefined when there is none) and the cover the
 * round applied. One value, so the steps after the judgement read the same
 * facts (code review of deep/r3-scroll, S6/S7).
 */
interface ThisRead {
  read: RoundRead;
  facts: TreeFacts;
  frames: readonly Rect[];
  /** The ROUND's gesture box (`RoundSeen.screen`), as this read was judged with it — not a fact of the read. */
  gesture: Rect | undefined;
  /** The cover the ROUND applied (after the witness), as this read was judged under it — not a fact of the read. */
  cover: Cover | undefined;
}

/** What to do next. */
export type RoundStep =
  /** Answer, then call `round` again with the same seen and the answer; the state is unchanged. */
  | { do: 'ask'; what: 'witness' | 'unlocated' }
  /** Settle, read again, send nothing — a confirming read (SETTLE_CONFIRM_READS), or a confirming read that did not read, read again. */
  | { do: 'confirm' }
  /**
   * Draw a stroke toward `toward` (where the content lies), its reach scaled
   * by `reach` (swipe.ts#shortenStroke; 1 until the first turn, halved by
   * each), over `box` — kept clear of a cover whose top edge is `coverTop`
   * when set (swipe.ts#swipeVectorAbove): the keyboard's, or, since
   * 2026-10-09, a node's drawn over the container's lower part (a floating
   * tab bar; swipe.ts#strokeRoom decides it with the box) — and hand it
   * back as the next round's `drawn`; swipe.ts#scrollStroke turns the step into points and
   * judges nothing. `box` is DECIDED here (swipe.ts#strokeRoom, over the
   * round's gesture box, `RoundSeen.screen`, the keyboard included): the target's scroll
   * container met with the screen, so the stroke touches down on the
   * content that scrolls — or the gesture box whole when no container is
   * known or none has room; absent only when the round had no gesture box.
   * `probe`: the stroke is the flush check's (PROBE_REACH), not a step
   * toward the target — its `box` always a container's, never the screen's
   * fallback; `maxTravel` caps its finger travel (PROBE_MAX_TRAVEL_FRACTION).
   */
  | { do: 'stroke'; toward: Direction; reach: number; coverTop?: number; box?: Rect; probe?: true; maxTravel?: number }
  /** The scroll is over. */
  | { do: 'stop'; outcome: ScrollOutcome };

/**
 * A shown soft keyboard as the round may apply it (2026-10-08): its frame,
 * the part of the screen it leaves — everything above its TOP edge, full
 * width — and what the adapter can do about it. Above the top edge, not
 * around the band: a docked keyboard (Android IME [0,1398][1080,2220], WDA
 * band from y 539/589 of 874) runs to the bottom, so the two are the same;
 * a band that does not costs content below it, which can only make the
 * scroll swipe more or fail naming the keyboard — never report as visible
 * what is under it. `above` undefined: the band starts at or above y 0 and
 * leaves nothing (a full-screen extract-mode IME, unmeasured).
 *
 * `topCover` is the HIGHEST covered rect (`KeyboardCover.top`) — named so by the
 * code review of round 2 (it was `band`, and callers read `band.y` as the
 * keyboard's top): since 2026-10-08 not always the inset band: with a
 * floating Gboard (measured that day, API 33) it is the panel,
 * [359,1269][1040,1912], 681 px wide and mid-screen. The
 * invariant: only its `.y` is meaningful as a cut — the rect need not be
 * full width nor reach the bottom; the rest of it is quoted in messages.
 * The cost of the full-width cut, accepted (it never certifies a covered
 * target): content beside the panel (x < 359 there) and in the gap between
 * the panel and the strip below it is never judged visible, so a target
 * there that cannot be scrolled above the panel fails `scroll_until` with
 * the keyboard named, though the tap guard — which tests the panel's rect
 * itself — would tap it; and a panel dragged near the top leaves a short
 * stroke box (a residual).
 */
export interface Cover {
  topCover: Rect;
  above: DeviceScreen | undefined;
  remedy: KeyboardRemedy;
}

/**
 * One match as judged: how much of it is in the frame, the frame's edges it
 * extends past, the keyboard cover it was judged under (none for a
 * whole-screen judgement or a keyboard-side node), and — since 2026-10-09
 * (docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md) —
 * what of the app is drawn over it inside that frame
 * (ui-tree/draw-order.ts#exposure): the covers, the one over its centre,
 * and how much of it shows.
 */
export interface Judged {
  node: UiNode;
  /** The fraction of it inside the frame — covers or not (`visibleFractionInViewport`). */
  visible: number;
  clipped: Edge[];
  under?: Cover;
  /** The nodes drawn over it inside the frame, pre-order; empty when none. */
  covers: readonly UiNode[];
  /** Where each of `covers` presses, in the same order (draw-order.ts#Exposure.reaches): a pinned bar's reach, not its frame — what `observe`'s far-side test reads. */
  reaches: readonly Rect[];
  /** The cover drawn over its centre (`tapPoint`, the point a tap presses), when the centre lies in the frame under one. */
  centreCover?: UiNode;
  /**
   * Its centre lies on the SCREEN judged (the whole box, never cut above a
   * keyboard) — what the next tap's on-screen rule asks of the same point
   * (resolve.ts#onScreen). A centre under a keyboard band is on the screen:
   * the tap's keyboard guard deals with that one.
   */
  centreOnScreen: boolean;
  /**
   * The height of iOS's status band (swipe.ts#belowStatusBand, 2026-10-09),
   * set only when its centre lies on the screen but inside that band — so
   * not `centreOnScreen`; the failure quotes it (`shortOf`'s `statusBar`).
   */
  bandOverCentre?: number;
  /** The fraction of it inside the frame and under no cover — `visible` less the covers. */
  shows: number;
  /**
   * Its scroll container cuts it to a sliver the next tap refuses
   * (ui-tree/geometry.ts#Clips.cutSliver, interact/resolve.ts#refuseCutSliver,
   * 2026-10-10) — the cut and the minimum it is under; a plain stop does not
   * stop on it (`stops`).
   */
  sliver?: { cut: Cut; minPiece: number };
}

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
 *   `shortOf`: clipped, or since 2026-10-09 under a node of the app) — and
 *   UNMOVED_STROKES_EXHAUST identical strokes left it where it was — the
 *   layout defect, or the keyboard's edge when it is the bottom clip.
 * - `covered`: a corroborated cover leaves nothing above its top edge;
 *   nothing judged, no stroke sent.
 * - `bound`: the bound ended it (`by`), and what the target was short of
 *   (`short`), with the turns, the keyboard the rounds applied, and the
 *   `unlocated` row of the last round's reading.
 */
export type ScrollOutcome =
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
       * other way only pushes out through that edge (2026-10-10), not tried.
       */
      otherWay: 'unmoved' | 'stroked' | 'untried' | 'outward';
    }
  | { kind: 'covered'; swipes: number; cover: Cover; viewport: Rect; evidence: WaitEvidence }
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
    };

/**
 * A `fully: true` stop whose edge along the scroll lies on its scroll
 * container's edge (PROBE_REACH): `checked` when a probe toward that edge
 * moved nothing — nothing of it is cut there — and false, so it may be,
 * `why`: no swipe or time was left (`budget`); no clipping ancestor from
 * the flush one outward has room for a stroke (`room`: a probe drawn over
 * the screen instead would touch down off the container and move nothing
 * whatever lies beyond — code review round 2, so none is sent); or the
 * probe was drawn under twice TOUCH_SLOP and may have been a tap (`tap`).
 *
 * `fills` (code review of round 3, 2026-10-09): flush with BOTH of its
 * nearest container's `edges` along the scroll, and with ONE edge of no
 * clipping ancestor — a row taller than its list, cut at both ends, reads
 * exactly the list's rect. Never probed (one probe cannot tell which side,
 * if either, is cut), so never checked; until then such a stop was a plain
 * "fully visible", the residual stated only in code.
 */
export type Flush =
  | ({ edge: Edge; container: Rect } & ({ checked: true } | { checked: false; why: 'budget' | 'room' | 'tap' }))
  | { edges: readonly [Edge, Edge]; container: Rect; checked: false; why: 'fills' };

/**
 * Which bound ended the scroll: the same stroke twice moved nothing (with
 * the direction last swiped, what stayed put — every match of a target
 * off the frame, or the whole tree of one not in it — and, when the last
 * stroke touched down on a node drawn over its container, that node:
 * `touchedOn`), `maxSwipes`, or the deadline.
 */
export type BoundBy =
  | { of: 'exhausted'; lastStroke: Direction; unchanged: 'matches' | 'tree'; touched?: TouchedOn }
  | { of: 'maxSwipes' }
  | { of: 'timeout'; timeoutMs: number };

/** Where a stroke touched down on a node drawn over the container it was drawn in (`touchedOn`): the point, the node, the container. */
export interface TouchedOn {
  at: Point;
  /** What the sentence quotes of the node, not the node (its subtree is no fact of the failure). */
  on: Pick<UiNode, 'role' | 'label' | 'identifier' | 'rect'>;
  container: Rect;
}

/**
 * What the target was short of at a bound, by the last round:
 * - `readFailed`: the last tree read failed — quoted, whatever came before;
 * - `clipped`: in the frame but clipped — an edge cut with `fully: true`,
 *   its centre off the screen without (`shortOf`);
 * - `covered` (2026-10-09): in the frame, not clipped so, but a node of the
 *   app drawn over it — over any of it with `fully: true`, over its centre
 *   without (`stops`);
 * - `absent`: not in the last tree, and never in the frame before it;
 * - `gone`: not in the last tree, in the frame after swipe `inFrameAfter`;
 * - `left`: not in the last tree, never in the frame, but in the tree after
 *   swipe `inTreeAfter` (off the frame, or under the keyboard) — a stroke
 *   carried it out and a lazy list dropped it (2026-10-09: "never appeared"
 *   was said of it, with a plain Error, which contradicted itself);
 * - `offFrame`: in the tree, off the frame judged — `inFrameAfter` when an
 *   earlier read had it in the frame; `cover` the one this round applied,
 *   `eitherWayUp` when the whole-screen judgement ran over both boxes.
 */
export type Shortfall =
  | { of: 'readFailed'; error: Error }
  | InFrameShort
  | { of: 'absent' }
  | { of: 'gone'; inFrameAfter: number }
  | { of: 'left'; inTreeAfter: number }
  | { of: 'offFrame'; rect: Rect; inFrameAfter?: number; viewport: Rect; cover?: Cover; eitherWayUp: boolean };

/** What a match in the frame is short of a stop (`shortOf`): cut (`clipped`), or something of the app drawn over it (`covered`). */
export type InFrameShort =
  | { of: 'clipped'; judged: Judged }
  | { of: 'covered'; judged: Judged }
  | { of: 'statusBar'; judged: Judged; band: number }
  | { of: 'sliver'; judged: Judged & Required<Pick<Judged, 'sliver'>> };

/**
 * How many reads a stop reached after a stroke may spend waiting for the
 * target to hold still before it is reported unsettled (2026-10-08, the iOS
 * device check of docs/bugs/2026-10-08-scroll-until-ignores-android-soft-
 * keyboard.md). A stop after a stroke is CONFIRMED: one more read after a
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
 */
export const SETTLE_CONFIRM_READS = 3;

/**
 * How many strokes in a row — the same stroke each time — must leave every
 * match where it was before a target in the tree but off the frame is
 * called "content exhausted" (2026-10-08). Measured on Android: the form's
 * last field, wholly under an IME its container does not resize for,
 * swiped for the whole 15 s. Two, not one (review round 1): a single
 * stroke that moves nothing can be a transient — the first touch
 * dismissing a snackbar, a stale tree read, a stroke drawn whole-screen
 * onto an IME that was still coming up while the witness denied the stale
 * window — after which the next stroke scrolls. Only the same stroke
 * counts twice: a stroke drawn differently (a band applied, the stroke
 * turned round) is a new attempt. The `fully: true` clipped stop's stuck
 * test takes the same two (review round 2), watching the judged match
 * alone — a visible clipped match that does not move is the defect it
 * reports. For both, only strokes count: a confirming read sent none.
 *
 * And a target NOT in the tree (2026-10-09, docs/bugs/2026-10-09-scroll-
 * until-fling-skips-target-in-lazy-list.md): the same stroke twice after
 * which the WHOLE tree is unchanged (`TreeFacts.fingerprint`) — content at
 * its end, the target not in it, or no longer: measured, `scroll_until
 * row_40` on a list ending at row_36 swiped 5 times to the 15 s timeout,
 * "never appeared". Now it fails after the two, in the same words, the
 * cause saying the screen did not change. The whole tree, not "no match
 * moved" — there is no match to watch. A screen whose TREE changes on its
 * own (a ticking label) never reads unchanged and runs to the bound as
 * before. A spinner does not change the tree — a ProgressBar or a Compose
 * indicator dumps a fixed rect and no text — so a list still loading its
 * next page would read exhausted (code review of fix/r3-scroll: "failed
 * after 2 swipes" where the bound used to wait): a round whose tree shows a
 * progress node (`TreeFacts.loading`) does not count as unchanged, and the
 * sentence names loading among the causes. So a screen that ALWAYS shows
 * a progress node (a step indicator, a progress header bar) never fails
 * fast and runs to its bound, as before. Residual: content that loads
 * with no indicator in the tree (a shimmer drawn as plain views, a
 * silent fetch) can still be called exhausted after the two strokes.
 */
export const UNMOVED_STROKES_EXHAUST = 2;

/**
 * The flush check's probe (2026-10-09, docs/bugs/2026-10-09-android-scroll-
 * until-fully-trusts-bounds-clipped-to-scroll-container.md): the reach of
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
 * unchecked, `flush.why` `fills` (`Flush`), and the reply says so — it was
 * a plain "fully visible" until the code review of round 3. One probe per candidate stop:
 * a probe after which the match is where it was settles it.
 *
 * A quarter of the stroke — over the container, 15 % of its side
 * (swipe.ts#SWIPE_REACH_FRACTION, 60 % of the side, × 0.25) — and never
 * more than PROBE_MAX_TRAVEL_FRACTION of the screen's long side: 178 px on
 * the Pixel_3a, more than the 51 px the SWIFT form's Fees row was cut by; a
 * cut larger than that is left flush again and probed again. Short so it
 * cannot carry the row out of a container of any ordinary height.
 *
 * Every clipping ancestor, not the nearest alone (code review, 2026-10-09):
 * the match is flush with one of them on one edge — a card that fills a
 * carousel's height is flush with both of the carousel's edges, but the
 * carousel is cut by the list around it, and the card with it, on the
 * list's edge — and the probe answers the nearest ancestor flush on ONE
 * edge. Exempt only when no ancestor is. The probe is drawn over that
 * ancestor, or an outer one, whichever is the first with room for a stroke
 * (swipe.ts#strokeRoom) — a carousel cut to a 30-px strip has none, and a
 * stroke there is a tap on the card — room ABOVE the keyboard the probe
 * keeps clear of (deep/r3-scroll: a list running on under the IME from 58
 * px above it had room on the screen and none above the keyboard; the
 * driver drew the probe over the whole screen, off the list, and reported
 * "nothing of it is cut there"). When no ancestor has room (a lone 79-px
 * scroller, that list), no probe is sent — over the screen it would touch
 * down off the container and move nothing whatever is cut — and the stop
 * is reported with `flush.checked` false (code review round 2). A probe drawn shorter than twice
 * TOUCH_SLOP anyway (a tiny screen) never reports `checked`: it may have
 * been a tap that moved nothing.
 *
 * Residuals, stated (code review): Android's View bounds are cut to every
 * ancestor, not only scrollers, and Compose also subtracts what an overlay
 * sibling covers — a row cut by a pinned bar drawn over the list reads cut
 * at the bar's edge, not flush with any scroller, so it is not probed (that
 * is the pinned-chrome bug, docs/bugs/2026-10-08-tap-and-scroll-until-
 * ignore-pinned-app-chrome.md, out of scope); a RecyclerView with padding
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
 * side (code review of fix/r3-scroll, 2026-10-09): a probe toward a TOP
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

/**
 * Everything the scroll remembers between rounds, one record with one
 * writer (`round`). Until 2026-10-09 the motion half was the `Motion` class
 * and the rest the loop's `let`s.
 */
interface State {
  readonly rules: RoundRules;
  readonly swipes: number;
  /** A `stop` was returned: no further round. */
  readonly done: boolean;
  /** The last step was a `stroke`: the next seen must hand back `drawn`. */
  readonly owesDrawn: boolean;
  /**
   * The visibility reference frame (2026-10-08, review of the off-screen tap
   * refusal, M2): `judgingScreen` over the round's tree — the tap's screen
   * owner too (resolve.ts#tapScreen), so a stop the scroll calls visible is
   * judged on the screen the next tap is judged on, by construction: the
   * box (turned in landscape as the stroke already was; what a failure
   * quotes) and the boxes that count (`ScreenBox.boxes`: either way up only
   * when a turn is suggested but not witnessed). A round whose tree did not
   * read, or that has no box at all (a 0×0 device and no window), keeps the
   * last frame — the device as built until a round had one. The keyboard
   * cover is cut from the box as chosen: a band is in the tree's
   * coordinates, and above it is the box's width.
   */
  readonly frame: JudgingScreen;
  /** Some round matched the target, and how many rounds read a tree — the absence rule's evidence. */
  readonly everFound: boolean;
  readonly treesRead: number;
  /** The last cover any round applied, and how many rounds applied one — for the failure text. */
  readonly lastCover: Cover | undefined;
  readonly coveredRounds: number;
  /** The cover the last round whose tree READ applied — undefined when that round applied none — for the stroke of a round whose tree did not read. */
  readonly lastReadCover: Cover | undefined;
  /** idb's keyboard band's top in the last tree that READ (`strokeTop`), for the stroke of a round whose tree did not read — kept as `lastReadCover` is. */
  readonly lastReadBandTop: number | undefined;

  // How the target moved, read for read (until 2026-10-09 the `Motion`
  // class): a swipe that does not move the element is the only honest
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
   * edge (`observe`'s `atFarEdge`, 2026-10-09): the next stroke turns. Kept across a
   * read that failed — that round strokes as the last read round decided,
   * as it keeps that round's stroke box (`lastReadCover`); cleared by a read
   * that does not find the target — whether to turn then is `dropped`'s
   * question (2026-10-09; until then such a read meant "a lazy list dropped
   * it: nothing to turn for", and the strokes went on the caller's way).
   */
  readonly carriedPast: boolean;
  /** Confirming reads spent since the last stroke (SETTLE_CONFIRM_READS is per stroke). */
  readonly confirmReads: number;
  readonly strokesSent: number;
  /** Where the content lay for the last stroke sent: the caller's direction, or its opposite after a fling past the target. For "swiping … no longer moves it". */
  readonly lastStroke: Direction;
  /** Direction changes — a stroke drawn the other way from the one before — for the shortening and the failure text. */
  readonly turns: number;
  /** The swipe count at the last read that had the target in the frame (any part of it) — for a failure after it left again. */
  readonly inFrameAfter: number | undefined;
  /** The probe in flight (PROBE_REACH): the judged match's rect and edge when it was sent. Cleared by the next read that reads. */
  readonly probe: { rect: Rect; edge: Edge } | undefined;
  /** The swipe count at the last read that had the target in the tree at all — for "was in the tree … then left it". */
  readonly inTreeAfter: number | undefined;
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
   * The stuck turn (2026-10-09, review of the at-the-far-edge turn): the
   * direction the target was stuck in when, the other way never stroked,
   * ONE stroke was drawn back instead of failing — set once, never cleared;
   * once only, as after it both ways were stroked (`strokedToward`). `backPending`: that stroke is the last sent and
   * no read that read has answered it yet.
   */
  readonly stuckOn: Direction | undefined;
  readonly backPending: boolean;
  /**
   * The target's clipping containers, nearest first, each with what is
   * drawn over it, at the last read that found the target — the candidates
   * the round's stroke picks its container from (swipe.ts#strokeRoom), judged
   * for the stroke as drawn, `toward` (D1); none of them with room, or none
   * at all, is the screen box (P5); undefined until a read finds the
   * target. Kept across reads that do not find it.
   */
  readonly targetContainers: readonly StrokeContainer[] | undefined;
  /** The candidates the last read that read judged its stroke's container from, for the stroke of a round whose tree did not read — judged again with that round's gesture box, cut by the rects they carry (kept as the keyboard's cover is, `lastReadCover`). */
  readonly lastCandidates: readonly StrokeContainer[];
  /** The container the last stroke SENT was drawn in, a probe's included — undefined when it went over the gesture box whole — for `touchedOn`. */
  readonly strokeWithin: Rect | undefined;
  /** The whole tree's fingerprint at the last read that read, and identical strokes in a row after which it was unchanged. */
  readonly prevFingerprint: string | undefined;
  readonly treeUnmovedStrokes: number;
}

/**
 * A container strokes go over, as one value (review round 1 of
 * fix/r4-stroke: the two were separate fields that had to move together):
 * its rect, and the rects drawn over it (`TreeFacts.drawOrder`) at the read
 * that chose it — the stroke box's cut (swipe.ts#strokeRoom). A later read
 * that still holds a container of that rect gives its own; one that does
 * not (the list moved — measured on Account Detail, 0,825 → 0,401) keeps
 * these, so a remembered container is not stroked as if nothing were over
 * it.
 */
interface StrokeContainer {
  rect: Rect;
  over: readonly Rect[];
}

/** The rects drawn over `rect` in this read, when it holds that container (`TreeFacts.drawOrder`). */
const overIn = (facts: TreeFacts, rect: Rect): Rect[] | undefined => facts.drawOrder.drawnOver(rect)?.map((n) => ({ ...n.rect }));

/**
 * The containers a round's stroke toward the target may go over, nearest
 * first (`round` judges their room): with no read this round (`facts`
 * undefined), the last read round's; once a read found the target, its
 * containers — each cut by what this read draws over it, or by what it
 * carried, when this read has lost its rect — none when it was found in
 * none (the screen box, P5); else the screen's largest scroller, or none.
 */
function strokeCandidates(s: State, facts: TreeFacts | undefined): readonly StrokeContainer[] {
  if (facts === undefined) return s.lastCandidates;
  const target = s.targetContainers;
  if (target !== undefined) return target.map(({ rect, over }) => ({ rect, over: overIn(facts, rect) ?? over }));
  const main = facts.mainScroller;
  return main === undefined ? [] : [{ rect: main, over: overIn(facts, main) ?? [] }];
}

/** The state before round 0: nothing read, the frame the device as built (`asBuilt`, read before the loop so a device whose screen cannot be read fails there). */
export function startRounds(rules: RoundRules, asBuilt: DeviceScreen): Rounds {
  const box: Rect = { x: 0, y: 0, ...asBuilt };
  const state: State = {
    rules,
    done: false,
    owesDrawn: false,
    swipes: 0,
    frame: { box, boxes: [box] },
    everFound: false,
    treesRead: 0,
    lastCover: undefined,
    coveredRounds: 0,
    lastReadCover: undefined,
    lastReadBandTop: undefined,
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
    strokesSent: 0,
    lastStroke: rules.direction,
    turns: 0,
    inFrameAfter: undefined,
    probe: undefined,
    inTreeAfter: undefined,
    lastSent: undefined,
    lastFound: undefined,
    dropped: undefined,
    strokedToward: [],
    stuckOn: undefined,
    backPending: false,
    targetContainers: undefined,
    lastCandidates: [],
    strokeWithin: undefined,
    prevFingerprint: undefined,
    treeUnmovedStrokes: 0,
  };
  return state as unknown as Rounds;
}

/** The cover a reading offers, or none: not shown, or a band whose top lies at or below the screen's bottom (it covers nothing on it). */
function coverOf(shown: KeyboardCover | undefined, viewport: DeviceScreen): Cover | undefined {
  if (shown === undefined) return undefined;
  // The highest covered rect, not always the inset band (2026-10-08): a
  // floating Gboard's panel mid-screen above its 132-px strip
  // (docs/bugs/2026-10-05-android-floating-gboard-keyboard.md) — so a target
  // behind it is judged under the cover and the stroke starts above it. Full
  // width above its top, as for any band that does not reach the sides.
  const topCover = shown.top;
  if (topCover.y >= viewport.height) return undefined;
  return { topCover, above: topCover.y <= 0 ? undefined : { width: viewport.width, height: topCover.y }, remedy: shown.remedy };
}

/**
 * The top edge a stroke is kept above (swipe.ts#strokeRoom's `coverTop`):
 * the applied keyboard cover's, and idb's keyboard band's
 * (ui-tree/draw-order.ts#DrawOrder.keyboardBandTop, `TreeFacts.drawOrder`;
 * round 7, 2026-10-10 — the
 * Contacts form and the SWIFT form's number pad were stroked from y 699, a
 * touch-down on the keys, docs/bugs/2026-10-09-ios-idb-scroll-stroke-starts-
 * on-the-soft-keyboard.md), the higher of the two. The band is a LINE, not a
 * cover: idb's tree cannot say the keyboard is shown (the in-tree reading
 * stays `unknown`), so nothing is judged under it, no witness is asked for
 * it and no failure names it — only the touch-down keeps off the keys, as
 * under WDA, whose band is a cover. Never on a tree that is not idb's flat
 * list (WDA, Android: undefined) — so today the two never both read and the
 * "higher of the two" never runs: idb's reading has no cover, and a tree
 * with a cover has no band; kept for a source that one day gives both. No
 * guard on where the band lies in the gesture box (code review of round 7,
 * MINOR 3): a top at or below the box's bottom changes no stroke
 * (swipe.ts#strokeRoom and swipeVectorAbove keep the whole box — pinned in
 * tests/interact/scroll.test.ts), and one at or above its top cannot occur:
 * the band starts below the top bar's line, a fifth of the screen down.
 */
function strokeTop(cover: Cover | undefined, bandTop: number | undefined): number | undefined {
  return higherTop(cover?.topCover.y, bandTop);
}

/**
 * The MOST revealed match, not the first: an id can sit on a container and
 * its child, and reporting the clipped one of the two would invent a defect
 * (since code review P2 the driver hands in only the match the next tap
 * acts on when the preference picks one — resolve.ts#matchesToJudge — so
 * this chooses only among matches the tap could not tell apart either).
 * Most revealed by what SHOWS — in the frame and under nothing of the app
 * (`TreeFacts.drawOrder`'s `exposure`, 2026-10-09) — which is what is in the frame when
 * nothing is drawn over it; a match that stops the round first (`better`). Under a cover, a keyboard-side node (the round's
 * reading's `ofKeyboard`, one walk per round) is judged against the whole
 * screen; every other node against the part above the band, or scores 0
 * when the band leaves none — and what is drawn over a node is counted only
 * inside the box it is judged in: a bar under the keyboard covers nothing
 * the round can see. The box comes with its status band, as one judging
 * screen (`JudgingScreen`'s `box` and `statusBand`).
 */
function judge(
  found: readonly UiNode[],
  { box: viewport, statusBand }: Pick<JudgingScreen, 'box' | 'statusBand'>,
  facts: Pick<TreeFacts, 'drawOrder' | 'clips'> | undefined,
  fully: boolean,
  cover?: { cover: Cover; keyboardSide: (node: UiNode) => boolean },
): Judged | undefined {
  // The screen below iOS's status band (swipe.ts#belowStatusBand, 2026-10-09): the point a tap presses is off the screen there.
  const band = { boxes: [viewport], statusBand };
  const screen: Rect = belowStatusBand(viewport, band);
  const centreFacts = (node: UiNode): Pick<Judged, 'centreOnScreen' | 'bandOverCentre'> => {
    const centre = tapPoint(node);
    return { centreOnScreen: containsPoint(screen, centre), ...(inStatusBand(centre, band) && { bandOverCentre: screen.y - viewport.y }) };
  };
  const inFrame = (node: UiNode, frame: DeviceScreen, under?: Cover): Judged => {
    const box: Rect = { x: 0, y: 0, ...frame };
    const seen = facts?.drawOrder.exposure(node, box);
    // The draw order's answer, as the tap's chrome check reads it (resolve.ts#aimClearOfChrome): the cover at the centre inside the frame.
    const centreCover = seen?.centreCover;
    const visible = visibleFractionInViewport(node.rect, frame);
    // The tap's cut-sliver rule, by the same minimum (resolve.ts#refuseCutSliver): what `stops` asks of a plain stop.
    const cut = seen === undefined || facts === undefined ? undefined : facts.clips.cutSliver(node, seen.minPiece);
    return {
      node,
      visible,
      clipped: clippedEdges(node.rect, frame),
      ...(cut !== undefined && seen !== undefined && { sliver: { cut, minPiece: seen.minPiece } }),
      ...(under !== undefined && { under }),
      covers: seen?.covers ?? [],
      reaches: seen?.reaches ?? [],
      ...(centreCover !== undefined && { centreCover }),
      ...centreFacts(node),
      shows: seen?.shows ?? visible,
    };
  };
  const scored = found.map((node): Judged => {
    if (cover === undefined || cover.keyboardSide(node)) return inFrame(node, viewport);
    const { above } = cover.cover;
    if (above === undefined) return { node, visible: 0, clipped: [], under: cover.cover, covers: [], reaches: [], ...centreFacts(node), shows: 0 };
    return inFrame(node, above, cover.cover);
  });
  return scored.sort((a, b) => better(a, b, fully))[0];
}

/** The whole-screen judgement over every box that counts (`ScreenBox.boxes`): the best-revealed match in any — "either way up" when there are two. */
function judgeOver(found: readonly UiNode[], frame: JudgingScreen, facts: Pick<TreeFacts, 'drawOrder' | 'clips'> | undefined, fully: boolean): Judged | undefined {
  return frame.boxes
    .map((box) => judge(found, { ...frame, box }, facts, fully))
    .reduce<Judged | undefined>((best, j) => (j !== undefined && (best === undefined || better(j, best, fully) < 0) ? j : best), undefined);
}

/**
 * The order of two judgements, best first (a comparator): a match that
 * STOPS the round (`stops`) before one that does not — a match showing
 * more but with its centre covered must not hide one the next tap would hit
 * (review round 1) — then the one more of which shows.
 */
function better(a: Judged, b: Judged, fully: boolean): number {
  return Number(stops(b, fully)) - Number(stops(a, fully)) || b.shows - a.shows;
}

/**
 * THE stop condition: the judged match is in the frame, and — `fully: true`
 * — clipped at no edge with nothing of the app drawn over any of it; or —
 * without — its centre, the point the next tap presses, on the screen and
 * under nothing (2026-10-09, the bug note's decisions 2 and 3: keep
 * scrolling until the tap point is uncovered, so the next tap agrees).
 * Until that date a plain stop was any intersection and a `fully: true` one
 * any unclipped rect, and a row under a pinned CONTINUE bar was "fully
 * visible after 0 swipes". On the SCREEN (`Judged.centreOnScreen`, code
 * review P3): a plain stop with its centre past the screen's edge was a
 * stop, "visible … CLIPPED 40%", and the next tap was refused off screen
 * (resolve.ts#refuseOffScreen); the screen, not the frame cut above a
 * keyboard — a centre under the band stops as before, and the tap's
 * keyboard guard hides the keyboard. On iOS a centre inside the status
 * band is off the screen (`Judged.bandOverCentre`, adapters/ios-status-
 * band.ts, 2026-10-09) — measured, one stroke flung `priority_select` to
 * `24,-20` and the plain stop stopped with its centre at (201,6), where the
 * tap pressed the status bar — for both stops: `fully: true` asks the
 * centre to be on the screen too (an unclipped rect's centre always is,
 * but in the band). Only the centre: what of the rect lies in the band is
 * judged against the screen as before — `fully` judges clipping against the
 * whole screen — so full-bleed content at the top (a hero image at y 0)
 * stops once its centre — ROUNDED, the point a tap sends (`tapPoint`) —
 * lies below the band; one whose rounded centre lies in it (at y 0, shorter
 * than twice the band less a point: 122 pt or less under 62, while 123 pt
 * rounds its centre 61.5 to 62 and stops) stops neither way, and fails
 * naming the status bar (`shortOf`'s `statusBar`; code review of round 6, P2).
 *
 * A plain stop is also not one on a SLIVER its scroll container cuts it to
 * (`Judged.sliver`, 2026-10-10, code review of fix/r7-sliver, item 1):
 * uiautomator cuts every rect to its scroller, so a cut node's centre is
 * always on the screen, and the stop handed back the very strip the next
 * tap refuses (resolve.ts#refuseCutSliver) — `scroll_until X` then `tap X`
 * failed. Scrolling on reveals it. `fully: true` keeps its own rule: a stop
 * flush with a clipping container is probed (PROBE_REACH).
 */
function stops(j: Judged, fully: boolean): boolean {
  return (
    j.visible > 0 &&
    j.centreOnScreen &&
    (fully ? j.clipped.length === 0 && j.covers.length === 0 : j.centreCover === undefined && j.sliver === undefined)
  );
}

/**
 * What a judged match in the frame is short of a stop (`stops`) — the one
 * rule the stuck and the bound sentences read: `clipped` — an edge cut
 * with `fully: true`, or without it the centre off the screen; else
 * `covered` — something of the app drawn over it (over its centre, without
 * `fully`). With `fully: true` a cut edge leads, as it always has. A centre
 * on the screen but in iOS's status band is `statusBar` (2026-10-09): the
 * sentence names the status bar, never a clip or a layout defect. Without
 * `fully`, a centre under nothing on a sliver its scroll container cuts it
 * to is `sliver` (2026-10-10, `stops`).
 */
function shortOf(j: Judged, fully: boolean): InFrameShort {
  if (fully && j.clipped.length > 0) return { of: 'clipped', judged: j };
  if (j.bandOverCentre !== undefined) return { of: 'statusBar', judged: j, band: j.bandOverCentre };
  if (!j.centreOnScreen) return { of: 'clipped', judged: j };
  // Without `fully`, a centre under nothing yet no stop: the sliver (`stops`).
  if (!fully && j.centreCover === undefined && j.sliver !== undefined) return { of: 'sliver', judged: { ...j, sliver: j.sliver } };
  return { of: 'covered', judged: j };
}

/** Would this judgement end the round cleanly — a stop, no stroke, no failure? */
const endsClean = (j: Judged | undefined, fully: boolean): boolean => j !== undefined && stops(j, fully);

/**
 * The two judgements say the same thing about the same node. `clipped` is
 * not compared: the box above a band lies inside the viewport, so the same
 * node scoring the same fraction against both has no area between the
 * band's top and the screen's bottom, and its edges agree (review round 1,
 * 2026-10-08: the comparison was dead — a mutation dropping it survived).
 */
const sameJudgement = (a: Judged | undefined, b: Judged | undefined): boolean =>
  a === undefined || b === undefined ? a === b : a.node === b.node && a.visible === b.visible;

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
 * OUT past that edge of its scroll container (UiNode.clippedOut, 2026-10-09,
 * docs/bugs/2026-10-09-android-inverted-uiautomator-bounds-pass-through-as-
 * negative-heights.md): uiautomator inverts the bounds of a node scrolled
 * wholly past its container, the parser clamps it to zero size AT the
 * container's edge — inside the frame, past neither of its edges — and the
 * mark is all that says which way it went. Settings' `Apps` under the
 * collapsing app bar read `126x-132` and was neither beyond the far edge
 * nor in the frame. Beyond, a target a read saw short of the far edge
 * turns the next stroke (`carriedPast`), and one lost after it was there
 * is not `dropped`. Not a stroke turned on the FIRST read (the owner's
 * call, 2026-10-09: iOS parity — a target read wholly beyond the far edge
 * before any read saw it short is the caller's direction to honour, as
 * `nextStroke` says; a node clipped out has nothing in the frame, so
 * `atFarEdge`, which needs some, never fires for it).
 *
 * Or CUT to a sliver at that edge of its scroll container (`FarFacts
 * .slicedAt`, `Judged.sliver`, 2026-10-10, code review round 2 of
 * fix/r7-sliver): the rest of it lies past the far edge as surely as a
 * clipped-out node's does, while its rect, cut to the container, lies
 * inside the frame. A plain stop does not stop on it (`stops`), so without
 * this a 132-px row showing its bottom 40 px at a form's top under a
 * default (down) scroll was pushed out and back until "turned round 3
 * times"; now `atFarEdge` turns the next stroke at once. A sliver at the
 * NEAR edge is coming in, and the strokes go on.
 */
function beyondFarEdgeIn(found: FarFacts, direction: Direction, frames: readonly Rect[]): boolean {
  const { far } = FAR_EDGE[direction];
  return found.clippedOut === far || found.slicedAt === far || frames.every((f) => beyondFarEdge(found.rect, direction, f));
}

/** What `beyondFarEdgeIn` reads of a match: its rect, the side it was dumped clipped out past, and the edge its scroll container cuts it to a sliver at. */
interface FarFacts {
  readonly rect: Rect;
  readonly clippedOut?: ClippedSide;
  readonly slicedAt?: Edge;
}

/** A judged match's `FarFacts`, its rect copied. */
const farFacts = ({ node, sliver }: Judged): FarFacts => ({
  rect: { ...node.rect },
  ...(node.clippedOut !== undefined && { clippedOut: node.clippedOut }),
  ...(sliver !== undefined && { slicedAt: sliver.cut.edge }),
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
 * strokes where one stopped it (review of the first cut, 2026-10-09). A
 * pinned bar sits at the edge it is pinned to, so the half it lies in is
 * that edge's. A cover centred exactly on the middle lies in neither far
 * half: not turned for, either way. Or, in that half, a cover the target
 * shows past only on its far side (`showsOnlyPast`, 2026-10-09): a bar a
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
 * The second way `overFarSide` reads a cover over the far side (2026-10-09,
 * the round-6b device check's S-1 residual): Contacts' New Contact under
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
}

/**
 * One read that read (`ThisRead`): every match found, the one judged, the
 * frames it was judged in, and the swipe count — recorded into `s`. `current` is what the
 * read followed. Where the target stands against the far edge is recorded
 * HERE, on every read — a stop round strokes nothing, and a target seen
 * short only at a stop the confirming read then lost must still turn the
 * next stroke (review round 2).
 */
function observe(s: Mutable<State>, current: Since, now: ThisRead, best: Judged | undefined): Observed {
  const { read, facts, frames } = now;
  const { found } = read;
  const { fingerprint, loading } = facts;
  const rects = found.map((n) => ({ ...n.rect }));
  const bestUnmoved = best !== undefined && s.prevBest !== undefined && sameRectWithinPixel(s.prevBest, best.node.rect);
  if (current === 'stroke') {
    // The whole tree, for a target not in it (UNMOVED_STROKES_EXHAUST,
    // 2026-10-09): the same streak rule, over the fingerprint.
    const treeUnmoved = s.prevFingerprint === fingerprint && !loading;
    const sameAsStreak = s.streakDrawn !== undefined && s.lastDrawn !== undefined && sameStroke(s.streakDrawn, s.lastDrawn);
    s.treeUnmovedStrokes = !treeUnmoved ? 0 : s.treeUnmovedStrokes > 0 && sameAsStreak ? s.treeUnmovedStrokes + 1 : 1;
    // Every match, not only the judged one, for "exhausted" (review round
    // 1): with several matches off the frame the judged one is the first
    // in tree order, which can be a static duplicate (another page, a
    // hidden copy) while the real one moved.
    const allUnmoved = s.prevRects !== undefined && sameRects(s.prevRects, rects);
    const same = s.streakDrawn !== undefined && s.lastDrawn !== undefined && sameStroke(s.streakDrawn, s.lastDrawn);
    s.allUnmovedStrokes = !allUnmoved ? 0 : s.allUnmovedStrokes > 0 && same ? s.allUnmovedStrokes + 1 : 1;
    s.bestUnmovedStrokes = !bestUnmoved ? 0 : s.bestUnmovedStrokes > 0 && same ? s.bestUnmovedStrokes + 1 : 1;
    s.streakDrawn = s.lastDrawn;
  }
  s.prevRects = rects;
  s.prevFingerprint = fingerprint;
  s.carriedPast = false;
  // Dropped (2026-10-09, docs/bugs/2026-10-09-scroll-until-fling-skips-
  // target-in-lazy-list.md): the last read had the target SHORT of the far
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
  // The strokes now go back (`dropped`, `nextStroke`) — a turn, halving
  // the reach like any — until a read finds it.
  if (best === undefined && current !== 'start' && s.lastFound !== undefined && s.lastSent !== undefined) {
    if (!beyondFarEdgeIn(s.lastFound, s.lastSent, s.lastFound.frames)) s.dropped = OPPOSITE[s.lastSent];
  }
  s.lastFound = best === undefined ? undefined : { ...farFacts(best), frames };
  if (best !== undefined) {
    s.dropped = undefined;
    s.inTreeAfter = s.swipes;
    // The containers the strokes may go over: every clipping ancestor of
    // the target, with what this read draws over each. Their room is judged
    // in `round`, for the stroke as drawn — `toward`, which a fling past the
    // target or a dropped target turns against the caller's direction, and
    // with that round's cover (D1, 2026-10-09: judged here for `rules.direction`, a strip whose lower
    // half a bar covers had no room going down, and the turned content-up
    // stroke went over the screen box, touching down off the strip that had
    // room going up). None with room is the screen box (code review of
    // deep/r3-scroll, P5): the last read's container is not kept — it is
    // stale, and may be another list — and the screen's largest scroller is
    // not taken either: a largest scroller with room that is not one of the
    // target's ancestors is a list that cannot hold the target.
    s.targetContainers = facts.clips.scrollersOf(best.node).map((rect) => ({ rect: { ...rect }, over: overIn(facts, rect) ?? [] }));
    s.prevBest = { ...best.node.rect };
    // In EVERY frame the round judged in: a target beyond the far edge one
    // way up but across both edges the other is not turned for. Or dumped
    // clipped out past it, or cut to a sliver at it (`beyondFarEdgeIn`).
    const beyond = beyondFarEdgeIn(farFacts(best), s.rules.direction, frames);
    // Or IN the frame at that edge (2026-10-09, docs/bugs/2026-10-09-ios-
    // scroll-until-never-turns-back-when-target-stays-clipped-or-in-status-
    // band.md): across it — clipped there, or its centre in iOS's status
    // band, which the frames are cut below — or under something of the app
    // drawn over its far side. Read so before any read saw it short, it
    // was never carried past, so `seenShort` alone never turned it: the
    // strokes pushed it on out through that edge — and at the end of the
    // content no stroke moves it, so they never did: measured, a row
    // resting at y 20 swiped down six times to maxSwipes, one at -20
    // "content exhausted … a layout defect" after two, and from -20
    // `direction: "up"` flung it to 771 under CONTINUE and swiped up six
    // times more. The target is right there: the strokes turn at once.
    // Where a cover presses, as exposure judged it (`Judged.reaches`, code
    // review of round 6b P1): CONTINUE pinned at idb's flat list reaches the
    // screen's bottom, so the row flung to 776–828 has it over its far
    // (bottom) side — its frame, 780–824, is over neither edge.
    const overFar = (cover: Rect) => frames.every((f) => overFarSide(best.node.rect, s.rules.direction, cover, f));
    const atFarEdge = best.visible > 0 && (beyond || best.reaches.some(overFar));
    s.carriedPast = (beyond && s.seenShort) || atFarEdge;
    if (!beyond) s.seenShort = true;
    if (best.visible > 0) s.inFrameAfter = s.swipes;
  }
  const offFrame = best !== undefined && best.visible === 0 && found.some((n) => n.rect.width > 0 && n.rect.height > 0);
  return {
    bestUnmoved,
    stuck: current === 'stroke' && s.bestUnmovedStrokes >= UNMOVED_STROKES_EXHAUST,
    exhausted:
      s.allUnmovedStrokes >= UNMOVED_STROKES_EXHAUST && offFrame
        ? 'matches'
        : current === 'stroke' && s.treeUnmovedStrokes >= UNMOVED_STROKES_EXHAUST && found.length === 0
          ? 'tree'
          : undefined,
  };
}

/** Another confirming read is within the stroke's budget and the deadline. */
const mayConfirm = (s: State, elapsedMs: number): boolean => s.confirmReads < SETTLE_CONFIRM_READS && elapsedMs < s.rules.timeoutMs;

/**
 * The next stroke (2026-10-08, the WDA device check): toward the caller's
 * direction — unless the last read that read found a fling carried the
 * target across the frame since a read saw it short of the far edge
 * (`observe`; measured 613 → -357 in one swipe, then five more swipes DOWN
 * into exhausted content). Then the other way, to bring it back; a stroke
 * that throws it back past the near edge leaves it short again, and the
 * next stroke goes the caller's way. A target read wholly beyond the far
 * edge before any read saw it short of it — above the screen on round 0 of
 * a scroll down, and every round after while it stays there — is the
 * caller's direction to honour, as it always was; one any of which lies in
 * the frame is not (`atFarEdge`, below). That needs the target to
 * STAY in the tree once off the frame; a lazy list (Android
 * RecyclerView/LazyColumn, iOS List/UITableView under WDA) drops it, and
 * on Android its bounds never pass the list's edge anyway. Since
 * 2026-10-09 a read that LOSES the target it last read short of the far
 * edge of the content's last motion turns the strokes too (`dropped`,
 * recorded in `observe`): back the way the content came, until a read
 * finds it — a turn like this one, the reach halved. What is left: a
 * target no read ever had (the stroke must not carry it across the list
 * between two reads — the drag speed, adapters/android.ts#dragSpeed, is
 * what keeps that from happening on Android; iOS strokes at its default).
 *
 * Converging is deliberate (review round 2): every direction change
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
 * strokes back toward the caller's direction (review round 3): a turn
 * means the target was within one move of the frame and a full stroke
 * just carried it past — the distance left is less than what that stroke
 * moves. Restoring the reach would draw that stroke again and bring the
 * oscillation back. The cost: a scroll that turned once early keeps the
 * shorter strokes (and spends more of `maxSwipes`) if the target then
 * turns out to be further away than one move.
 *
 * A target IN the frame at the far edge turns the strokes too (2026-10-09,
 * `observe`'s `atFarEdge`): across that edge, its centre in iOS's status
 * band past it, or under a cover over its far side — on the first read as
 * on any. Until that date such a target was stroked on the caller's way,
 * and the comment here called it "a known cost, accepted (code review P7)
 * … extra strokes, never a wrong stop": the strokes were to carry it past
 * the edge, and the turn to follow. At the end of the content no stroke
 * carries it anywhere, so the turn never came — measured, `maxSwipes`, or
 * "content exhausted … a layout defect" for a row one stroke back would
 * have revealed. A target short at the NEAR edge (a pinned bar over a row
 * coming in from below) is stroked on the caller's way. A cover counts
 * only in the frame's far half (`overFarSide`). One stuck in the frame,
 * the other way never stroked, gets one stroke back before the layout
 * defect is declared (`round`'s stuck turn).
 */
function nextStroke(s: State): { toward: Direction; reach: number; turn: boolean } {
  const back = s.backPending && s.stuckOn !== undefined ? OPPOSITE[s.stuckOn] : undefined;
  const toward = s.dropped ?? back ?? (s.carriedPast ? OPPOSITE[s.rules.direction] : s.rules.direction);
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
  const ask = (what: 'witness' | 'unlocated') => ({ state, step: { do: 'ask', what } as const });
  const { fully } = s.rules;
  const current = s.since;
  if (seen.drawn !== undefined) s.lastDrawn = seen.drawn;

  const read = 'error' in seen.read ? undefined : seen.read;
  const readError = 'error' in seen.read ? seen.read.error : undefined;
  if (read !== undefined) {
    s.treesRead++;
    if (seen.screen !== undefined) s.frame = judgingOf(seen.screen);
  }
  const found = read?.found ?? [];
  if (found.length > 0) s.everFound = true;
  const viewport = s.frame.box;

  // The round judged twice when a keyboard is up: over the whole screen,
  // and over the screen ABOVE the cover (`coverOf`) — the covered judgement
  // stands only when the band changes the round and the witness stood by it.
  const offered = read === undefined ? undefined : coverOf(read.cover, viewport);
  // The tree's facts, once a round (`factsOf`): what is drawn over what
  // (ui-tree/draw-order.ts) — the judgement's covers, and the stroke's —
  // each match's clipping ancestors, for the plain stop's sliver rule
  // (`stops`), and the rest the steps after the judgement read.
  const facts = read === undefined ? undefined : factsOf(read.tree);
  const whole = judgeOver(found, s.frame, facts, fully);
  let cover: Cover | undefined;
  let best = whole;
  if (offered !== undefined && read !== undefined) {
    const covered = judge(found, s.frame, facts, fully, { cover: offered, keyboardSide: read.ofKeyboard });
    // Moot: the round stops cleanly either way, on the same judgement — the
    // band changes nothing, and is neither asked about nor reported.
    // Otherwise the witness is asked THIS round, never remembered: a
    // scroll can hide a keyboard (a list that dismisses it on drag) and
    // leave the window state stale-shown behind it (review 2026-10-08).
    const moot = endsClean(whole, fully) && sameJudgement(whole, covered);
    if (!moot) {
      if (seen.corroborated === undefined) return ask('witness');
      if (seen.corroborated) {
        cover = offered;
        best = covered;
      }
    }
  }
  if (cover !== undefined) {
    s.lastCover = cover;
    s.coveredRounds++;
  }
  if (read !== undefined) s.lastReadCover = cover;
  // idb's keyboard band, read off this round's tree — a line the strokes
  // stay above, never a cover (`strokeTop`); a round whose tree did not
  // read keeps the last read round's, as its cover.
  if (facts !== undefined) s.lastReadBandTop = facts.drawOrder.keyboardBandTop;
  // The frames this round judged in — the screen above an applied keyboard,
  // else every box that counts — for where the target stands against the
  // far edge (`observe`, `beyondFarEdge`). A read that did not read says
  // nothing about motion: the comparisons wait for the next one that does.
  // Below iOS's status band: a target whose centre a fling carried into it
  // is past the far edge, and the next stroke turns back.
  const judgedFrames: Rect[] =
    cover?.above !== undefined ? [belowStatusBand({ x: viewport.x, y: viewport.y, ...cover.above }, s.frame, viewport)] : s.frame.boxes.map((b) => belowStatusBand(b, s.frame));
  const gesture = seen.screen?.box;
  const now: ThisRead | undefined =
    read === undefined || facts === undefined ? undefined : { read, facts, frames: judgedFrames, gesture, cover };
  const observed = now === undefined ? undefined : observe(s, current, now, best);
  // The probe this read answers (PROBE_REACH) — kept across a read that did
  // not read, which is read again below rather than stroked away from.
  const probed = s.probe;
  if (read !== undefined) s.probe = undefined;

  // The stroke back (`stuckOn`) is answered by the first read that reads
  // after it; a round whose tree did not read strokes as the last read
  // round decided — back.
  const answersBack = now !== undefined && s.backPending;
  if (now !== undefined) s.backPending = false;
  if (best !== undefined && best.visible > 0 && observed !== undefined && now !== undefined) {
    if (stops(best, fully)) {
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
      // `fully: true`, an edge flush with the clipping container: possibly
      // cut there — probe once toward it, or say it could not be checked.
      let flush: Flush | undefined;
      const chain = fully ? now.facts.clips.scrollersOf(best.node) : [];
      const flushed = flushWith(best.node.rect, chain, s.rules.direction);
      if (flushed !== undefined && 'fills' in flushed) flush = { edges: flushed.fills, container: chain[0], checked: false, why: 'fills' };
      else if (flushed !== undefined) {
        const { edge, at } = flushed;
        const container = chain[at];
        const noRoom = { checked: false, why: 'room' } as const;
        // With no gesture box (`RoundSeen.screen` absent) nothing has room
        // and the stop says `room` — the wrong reason (it is "no screen
        // box"), accepted as unreachable in practice: screenBox throws only
        // when the device's size is unusable AND the tree has no window, and
        // adapters/viewport-memo.ts keeps a successful size for the session
        // — so it takes a device reporting 0×0 throughout, and a tree whose
        // window stood in on an earlier round (else the frame is 0×0 and no
        // stop is ever visible) but not on this one.
        const roomOver = (coverTop?: number) => strokeRoom(gesture, chain.slice(at), REVEALS[edge], coverTop, (w) => overIn(now.facts, w));
        if (probeHeld) flush = probeStroked ? { edge, container, checked: true } : { edge, container, checked: false, why: 'tap' };
        else if (roomOver() === undefined) flush = { edge, container, ...noRoom };
        else if (s.swipes < s.rules.maxSwipes && seen.elapsedMs < s.rules.timeoutMs) {
          // Clear of a keyboard as any stroke is — and one the moot rule
          // never asked about (the stop was clean either way) is asked
          // about now: the probe touches down on the container's lower
          // part for a bottom edge, which may be under the band.
          let probeCover = cover;
          if (probeCover === undefined && offered !== undefined) {
            if (seen.corroborated === undefined) return ask('witness');
            if (seen.corroborated) probeCover = offered;
          }
          // Room judged again ABOVE that keyboard (deep/r3-scroll): a list
          // running on under the IME may have room on the screen and none
          // above it — the probe would touch down off it and move nothing.
          // Twice only to keep the ask order: no room even over the whole
          // screen is `room` with no witness asked, as it was.
          const over = roomOver(strokeTop(probeCover, s.lastReadBandTop));
          if (over === undefined) flush = { edge, container, ...noRoom };
          else {
            const maxTravel = Math.floor(PROBE_MAX_TRAVEL_FRACTION * Math.max(s.frame.box.width, s.frame.box.height));
            return probe(s, edge, best.node.rect, over, maxTravel);
          }
        } else flush = { edge, container, checked: false, why: 'budget' };
      }
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
    // Still clipped (`fully: true`) or under something of the app — only a
    // swipe that MOVES it can help.
    // The stuck turn (2026-10-09, review of the at-the-far-edge turn): the
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
    // stuck is declared as before. Not when that stroke would pass the
    // bound: the stuck sentence beats "maxSwipes".
    // Not for a sliver stuck on strokes toward its cut edge (2026-10-10,
    // code review round 2 of fix/r7-sliver): the content is exhausted where
    // the rest of it lies, and a stroke the other way only pushes it out
    // through that edge — measured on the fake, a whole 50-px row at a
    // list's top, its image flush with that top (geometry.ts#evidentCut's
    // residual), swung out and lost after 5 swipes. `outward`, said so.
    const backUnmoved = answersBack && observed.bestUnmoved;
    const stuckOn = backUnmoved ? s.stuckOn : observed.stuck ? s.lastStroke : undefined;
    if (stuckOn !== undefined) {
      const outward = !fully && best.sliver !== undefined && REVEALS[best.sliver.cut.edge] === stuckOn;
      const otherWay = backUnmoved ? 'unmoved' : outward ? 'outward' : s.strokedToward.includes(OPPOSITE[stuckOn]) ? 'stroked' : 'untried';
      const turnBack = otherWay === 'untried' && s.swipes < s.rules.maxSwipes && seen.elapsedMs < s.rules.timeoutMs;
      if (!turnBack) return stop(s, { kind: 'stuck', swipes: s.swipes, short: shortOf(best, fully), lastStroke: stuckOn, viewport, otherWay });
      s.stuckOn = stuckOn;
      s.backPending = true;
    }
  }
  // A confirming read that did not read, or the read after a probe: read
  // again, within the same budget, rather than stroke away from a stop the
  // last read saw.
  if ((current === 'settle' || s.probe !== undefined) && read === undefined && mayConfirm(s, seen.elapsedMs)) return confirm(s);
  const evidence: WaitEvidence = { sighted: s.everFound, treesRead: s.treesRead, readError };
  // A keyboard that leaves nothing above it: nothing but its own UI can be
  // judged, and no stroke can start on the content — fail now, naming it,
  // rather than swipe on keys (review 2026-10-08: until then this fell
  // back to the whole screen and reported a bare "fully visible").
  if (cover !== undefined && cover.above === undefined) return stop(s, { kind: 'covered', swipes: s.swipes, cover, viewport, evidence });
  // In the tree, off the frame, and the last UNMOVED_STROKES_EXHAUST
  // strokes — the same stroke — moved no match (2026-10-08, the Android
  // device check: the form's last field, wholly under an IME its
  // container does not resize for, swiped for the whole 15 s): fail now
  // with the stop bound's own words — they already name the keyboard and
  // the way to hide it. See `observe` for what counts.
  const exhausted = observed?.exhausted;
  if (exhausted !== undefined || s.swipes >= s.rules.maxSwipes || seen.elapsedMs >= s.rules.timeoutMs) {
    // The `unlocated` row, asked of the last round's reading whatever came
    // before — a round whose tree did not read has none.
    let unlocated = false;
    if (read !== undefined) {
      if (seen.unlocated === undefined) return ask('unlocated');
      unlocated = seen.unlocated;
    }
    const touched = exhausted === undefined || now === undefined ? undefined : touchedOn(s, now.facts);
    const by: BoundBy =
      exhausted !== undefined
      ? { of: 'exhausted', lastStroke: s.lastStroke, unchanged: exhausted, ...(touched !== undefined && { touched }) }
      : s.swipes >= s.rules.maxSwipes
        ? { of: 'maxSwipes' }
        : { of: 'timeout', timeoutMs: s.rules.timeoutMs };
    return stop(s, {
      kind: 'bound',
      swipes: s.swipes,
      by,
      short: shortfall(s, readError, found, best, viewport, cover),
      turns: s.turns,
      ...(s.lastCover !== undefined && { keyboard: { cover: s.lastCover, rounds: s.coveredRounds, read: s.treesRead } }),
      unlocated,
      evidence,
    });
  }
  // Toward the caller's direction, or back after a fling past the target,
  // the reach halved per turn so the scroll converges (`nextStroke`). A
  // round whose tree did not read has no reading of its own and keeps the
  // cover of the last round that DID read — none if that round applied
  // none — rather than stroke through the keyboard it last saw.
  const { toward, reach, turn } = nextStroke(s);
  const strokeCover = read === undefined ? s.lastReadCover : cover;
  // Over the target's scroll containers once a read has placed it in
  // them, else the screen's largest (2026-10-09; swipe.ts#strokeRoom): the
  // stroke touches down on what scrolls, and its length is that
  // container's 60 %, never the screen's — a 1417-px list is not stroked
  // 1332 px. A round whose tree did not read keeps the last read round's
  // candidates.
  const candidates = strokeCandidates(s, now?.facts);
  s.lastCandidates = candidates;
  // The latest cut read for the target's containers is the one a later read
  // that has lost a rect falls back to — not the oldest (review round 2).
  if (s.targetContainers !== undefined && now !== undefined) s.targetContainers = candidates;
  // The container and the box, decided once, for this stroke's `toward`
  // (swipe.ts#strokeRoom; D1, 2026-10-09: the container is judged for the
  // stroke drawn over it, not for the caller's direction): the first
  // candidate with room, met with the gesture box above the stroke's cover
  // — the keyboard's, or what is drawn over the container (2026-10-09, the
  // floating tab bar; a round whose tree did not read keeps the last read
  // round's, as its keyboard) — or the gesture box whole when none has room
  // (P5), under the keyboard alone — a stroke toward the target is still
  // worth drawing over the screen; a probe never comes here. Judged EVERY
  // round, with that round's gesture box and cover, not once at the read
  // that found the target: a strip the IME left no room in at that read is
  // stroked once the IME is gone, the target's nearest container (code
  // review of fix/r5-stroke). `over` is looked up by the candidate's own
  // rect object — strokeRoom hands back the one it was given — so nested
  // containers of equal rects keep their own.
  const kept = strokeTop(strokeCover, s.lastReadBandTop);
  const room = strokeRoom(gesture, candidates.map((c) => c.rect), toward, kept, (w) => candidates.find((c) => c.rect === w)?.over);
  const coverTop = room === undefined ? kept : room.coverTop;
  const box = room?.box ?? gesture;
  s.strokeWithin = room === undefined ? undefined : { ...room.within };
  if (turn) s.turns++;
  if (!s.strokedToward.includes(toward)) s.strokedToward = [...s.strokedToward, toward];
  s.strokesSent++;
  s.lastStroke = toward;
  s.lastSent = toward;
  s.confirmReads = 0;
  s.since = 'stroke';
  s.swipes++;
  s.owesDrawn = true;
  return {
    state: s as unknown as Rounds,
    step: { do: 'stroke', toward, reach, ...(coverTop !== undefined && { coverTop }), ...(box !== undefined && { box: { ...box } }) },
  };
}

/**
 * Send the flush check's probe (PROBE_REACH): toward revealing `edge`, over
 * `room`'s box (swipe.ts#strokeRoom's, above the probe's keyboard and what
 * is drawn over the container: never the screen box — a
 * stop with no ancestor that has room is reported unchecked, not probed), its travel capped at
 * `maxTravel` (PROBE_MAX_TRAVEL_FRACTION), clear of `room`'s cover. A swipe like any other for
 * the count and the bound, but not a step of the scroll's course: the turn
 * (`lastStroke`, `turns`, `strokesSent`) is left as it was, so a probe the
 * other way from the caller's direction is not a turn and halves no reach.
 */
function probe(s: Mutable<State>, edge: Edge, rect: Rect, room: StrokeRoom, maxTravel: number): { state: Rounds; step: RoundStep } {
  const { box, coverTop } = room;
  s.probe = { rect: { ...rect }, edge };
  s.strokeWithin = { ...room.within };
  s.lastSent = REVEALS[edge];
  s.confirmReads = 0;
  s.since = 'stroke';
  s.swipes++;
  s.owesDrawn = true;
  return {
    state: s as unknown as Rounds,
    step: {
      do: 'stroke',
      toward: REVEALS[edge],
      reach: PROBE_REACH,
      ...(coverTop !== undefined && { coverTop }),
      box: { ...box },
      probe: true,
      maxTravel,
    },
  };
}

/**
 * The node drawn over its container that the last stroke touched down on,
 * when the strokes ended exhausted (2026-10-09, docs/bugs/2026-10-09-
 * android-scroll-stroke-touches-down-on-floating-tab-bar.md): the last of
 * what is drawn over it — the one drawn on top — that contains the stroke's
 * touch-down, in the tree that read unchanged (`TreeFacts.drawOrder
 * .drawnOverAt`, which leaves out a wrapper holding the container whole).
 * A gesture belongs to the view the finger first touches (swipe.ts#swipeVectorAbove), so such a node took
 * the strokes — MAY have: the tree does not say whether a node takes touches
 * (ui-tree/draw-order.ts), so the sentence names it first and keeps the
 * other causes after it (review round 1) — and "content exhausted" alone
 * would send the reader the wrong way: the measured fast fail said so of a
 * list with 34 more rows. The stroke
 * box is cut above what is drawn over a container's lower half or over
 * a content-down touch-down (swipe.ts#strokeRoom), so what is left to name is what the cut does not
 * model — a floating header a content-up stroke touches down on, a node
 * beside a sideways stroke's centre, a node over nearly all of the box that
 * a cut would leave no room above. Undefined when the stroke went over
 * the gesture box whole (no container to be drawn over: the screen box,
 * P5), when this tree holds no container of the remembered rect (the list
 * moved; the stroke was still cut by the overlays kept with it,
 * `StrokeContainer`), or when it touched down on nothing drawn over its
 * container. One scan of the tree, at the stop only.
 */
function touchedOn(s: State, facts: TreeFacts): TouchedOn | undefined {
  const { strokeWithin: container, lastDrawn } = s;
  if (container === undefined || lastDrawn === undefined) return undefined;
  const on = facts.drawOrder.drawnOverAt(container, lastDrawn.from);
  if (on === undefined) return undefined;
  const { role, label, identifier, rect } = on;
  return { at: { ...lastDrawn.from }, on: { role, label, identifier, rect: { ...rect } }, container };
}

/** Spend a confirming read: the next read follows a settle, not a stroke. */
function confirm(s: Mutable<State>): { state: Rounds; step: RoundStep } {
  s.confirmReads++;
  s.since = 'settle';
  return { state: s as unknown as Rounds, step: { do: 'confirm' } };
}

function stop(s: Mutable<State>, outcome: ScrollOutcome): { state: Rounds; step: RoundStep } {
  s.done = true;
  return { state: s as unknown as Rounds, step: { do: 'stop', outcome } };
}

/**
 * What the target was short of at a bound. In the frame on an earlier read
 * and not on this one: "never" would be false (review round 1) — a fling
 * carried it off, or a lazy list dropped it once it scrolled away.
 */
function shortfall(s: State, readError: Error | undefined, found: readonly UiNode[], best: Judged | undefined, viewport: Rect, cover: Cover | undefined): Shortfall {
  if (readError !== undefined) return { of: 'readFailed', error: readError };
  if (best !== undefined && best.visible > 0) return shortOf(best, s.rules.fully);
  const left = s.inFrameAfter;
  if (found.length === 0) {
    if (left !== undefined) return { of: 'gone', inFrameAfter: left };
    return s.inTreeAfter !== undefined ? { of: 'left', inTreeAfter: s.inTreeAfter } : { of: 'absent' };
  }
  return {
    of: 'offFrame',
    rect: (best?.node ?? found[0]).rect,
    ...(left !== undefined && { inFrameAfter: left }),
    viewport,
    ...(cover !== undefined && { cover }),
    eitherWayUp: s.frame.boxes.length > 1 && cover?.above === undefined,
  };
}
