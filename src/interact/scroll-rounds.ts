import type { DeviceScreen, Rect, Stroke, UiNode } from '../adapters/types.js';
import { clippedEdges, rectArea, sameRectWithinPixel, visibleFractionInViewport } from '../ui-tree/geometry.js';
import type { KeyboardCover } from '../ui-tree/keyboard-cover.js';
import type { KeyboardRemedy } from '../ui-tree/soft-keyboard.js';
import type { WaitEvidence } from './resolve.js';
import { sameStroke, type Direction, type JudgingScreen } from './swipe.js';

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
 *   `drawn` — the "same stroke twice" identity is the drawn points, which
 *   only the driver can compute (the box is the device's). `drawn` is
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
 * stop flush with its clipping scroll container, the probe — `ask witness`
 * first for a band the moot rule left unasked — PROBE_REACH; then `ask
 * unlocated` on a `fully: true` stop with no cover under it); stuck; the
 * confirming read, or the read after a probe, that did not read; covered (nothing above the band); the bound (exhausted,
 * maxSwipes, deadline — and `ask unlocated` of a round that read); the
 * stroke. The witness comes before the deadline is consulted, so a witness
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
 * A tree that read, as the round needs it — the SYNCHRONOUS facts of the
 * round's keyboard reading (ui-tree/keyboard-cover.ts#readKeyboard) among
 * them, never the reading itself: its two async questions reach the round
 * only as answers to an `ask`, and a reading is never held across rounds
 * (the keyboard-cover.ts doc's rule) — the driver builds one per round.
 */
interface RoundRead {
  /** Every match of the target, in tree order (resolve.ts#findTarget). */
  found: readonly UiNode[];
  /** `judgingScreen` over this tree — the tap's screen too; undefined when there is no box at all, and then the round keeps the last frame. */
  screen?: JudgingScreen;
  /** The reading's `cover()`: everything a shown keyboard covers; undefined when hidden or unknown. */
  cover?: KeyboardCover;
  /** The reading's `ofKeyboard`: is this node the keyboard's own UI (judged against the whole screen, never under the band)? */
  ofKeyboard: (node: UiNode) => boolean;
  /**
   * The rect of the match's nearest ancestor that CLIPS it
   * (ui-tree/geometry.ts#scrollerOf over this round's tree) — Android's
   * scroll container, to whose edge uiautomator has already cut the
   * match's bounds; undefined when it has none (every node of an iOS
   * tree). For the `fully: true` stop's flush check (PROBE_REACH).
   */
  scrollerOf: (node: UiNode) => Rect | undefined;
  /**
   * The largest clipping container in this round's tree
   * (ui-tree/geometry.ts#largestScroller) — the screen's own scroll view,
   * for a stroke while the target's own container is not known (it has not
   * been read yet). Undefined when the tree has none (iOS).
   */
  mainScroller?: Rect;
  /**
   * A cheap fingerprint of the WHOLE tree (ui-tree/read-tree.ts
   * #treeFingerprint) — every node's role, text, id and rect — for "the
   * strokes changed nothing at all" when the target is not in the tree
   * (UNMOVED_STROKES_EXHAUST). Undefined: that rule never fires.
   */
  fingerprint?: string;
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
   * each), over the round's box — kept clear of a cover whose top edge is
   * `coverTop` when set (swipe.ts#swipeVectorAbove) — and hand it back as
   * the next round's `drawn`. `within`, when set: draw it over that rect
   * (the target's scroll container, met with the box — swipe.ts
   * #scrollStroke) rather than the whole box, so it touches down on the
   * content that scrolls. `probe`: the stroke is the flush check's
   * (PROBE_REACH), not a step toward the target.
   */
  | { do: 'stroke'; toward: Direction; reach: number; coverTop?: number; within?: Rect; probe?: true }
  /** The scroll is over. */
  | { do: 'stop'; outcome: ScrollOutcome };

/** A viewport edge an element extends past. */
export type Edge = 'top' | 'bottom' | 'left' | 'right';

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

/** One match as judged: how much of it is in the frame, the frame's edges it extends past, and the cover it was judged under (none for a whole-screen judgement or a keyboard-side node). */
interface Judged {
  node: UiNode;
  visible: number;
  clipped: Edge[];
  under?: Cover;
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
 * - `stuck`: `fully: true`, the judged match in the frame but clipped, and
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
  | { kind: 'stuck'; swipes: number; judged: Judged; lastStroke: Direction; viewport: Rect }
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
 * moved nothing — nothing of it is cut there — and false when no swipe or
 * time was left to probe, so it may be.
 */
export interface Flush {
  edge: Edge;
  container: Rect;
  checked: boolean;
}

/**
 * Which bound ended the scroll: the same stroke twice moved nothing (with
 * the direction last swiped, and what stayed put — every match of a target
 * off the frame, or the whole tree of one not in it), `maxSwipes`, or the
 * deadline.
 */
export type BoundBy = { of: 'exhausted'; lastStroke: Direction; unchanged: 'matches' | 'tree' } | { of: 'maxSwipes' } | { of: 'timeout'; timeoutMs: number };

/**
 * What the target was short of at a bound, by the last round:
 * - `readFailed`: the last tree read failed — quoted, whatever came before;
 * - `clipped`: in the frame but clipped (the `fully: true` bar not met);
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
  | { of: 'clipped'; judged: Judged }
  | { of: 'absent' }
  | { of: 'gone'; inFrameAfter: number }
  | { of: 'left'; inTreeAfter: number }
  | { of: 'offFrame'; rect: Rect; inFrameAfter?: number; viewport: Rect; cover?: Cover; eitherWayUp: boolean };

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
 * which the WHOLE tree is unchanged (`RoundRead.fingerprint`) — content at
 * its end, the target not in it, or no longer: measured, `scroll_until
 * row_40` on a list ending at row_36 swiped 5 times to the 15 s timeout,
 * "never appeared". Now it fails after the two, in the same words, the
 * cause saying the screen did not change. The whole tree, not "no match
 * moved" — there is no match to watch; a screen that changes on its own (a
 * clock, an animation) never reads unchanged and runs to the bound as
 * before, the safe way.
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
 * and one probe cannot tell which side, if either, is cut (accepted,
 * stated: such a match is reported as before). One probe per candidate stop:
 * a probe after which the match is where it was settles it.
 *
 * A quarter of the stroke — over the container, 15 % of its side
 * (swipe.ts#SWIPE_REACH_FRACTION, 60 % of the side, × 0.25): 260 px of the
 * SWIFT form's 1736-px container, more than the 51 px its Fees row was cut
 * by and than a 143-px row; a cut larger than that is left flush again and
 * probed again. Short so it cannot carry the row out of a container of any
 * ordinary height.
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

/** The direction a probe strokes toward to reveal a flush edge: content beyond the top lies up, and so on. */
const REVEALS: Record<Edge, Direction> = { top: 'up', bottom: 'down', left: 'left', right: 'right' };

/**
 * The judged match's edge that lies on its container's edge, along the
 * scroll's axis (`direction`'s), within a pixel — undefined when none does,
 * when both do (it fills the container: PROBE_REACH), or when the
 * container has no area.
 */
function flushEdge(rect: Rect, container: Rect, direction: Direction): Edge | undefined {
  if (rectArea(container) === 0) return undefined;
  const on = (a: number, b: number) => Math.abs(a - b) <= 1;
  const [low, high]: [Edge, Edge] = direction === 'up' || direction === 'down' ? ['top', 'bottom'] : ['left', 'right'];
  const atLow = low === 'top' ? on(rect.y, container.y) : on(rect.x, container.x);
  const atHigh =
    high === 'bottom' ? on(rect.y + rect.height, container.y + container.height) : on(rect.x + rect.width, container.x + container.width);
  return atLow === atHigh ? undefined : atLow ? low : high;
}

/** The direction the content lies the other way — the stroke that brings back a target a fling carried past the viewport. */
const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

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
   * earlier read saw it short of it: the next stroke turns. Kept across a
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
  readonly lastFound: { rect: Rect; frames: readonly Rect[] } | undefined;
  /**
   * The target was dropped from the tree by the content's motion — the
   * last read had it short of the far edge of that motion, this one has no
   * match — so the strokes go this way, back, until a read finds it again
   * (`nextStroke`). Not cleared by a read without the target: it is still
   * beyond the edge it left through.
   */
  readonly dropped: Direction | undefined;
  /** The stroke box: the target's clipping container at the last read that found it in one (`RoundRead.scrollerOf`). */
  readonly targetScroller: Rect | undefined;
  /** The stroke box the last read that read chose (`within`), for the stroke of a round whose tree did not read. */
  readonly lastWithin: Rect | undefined;
  /** The whole tree's fingerprint at the last read that read, and identical strokes in a row after which it was unchanged. */
  readonly prevFingerprint: string | undefined;
  readonly treeUnmovedStrokes: number;
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
    targetScroller: undefined,
    lastWithin: undefined,
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
 * The MOST revealed match, not the first: an id can sit on a container and
 * its child, and reporting the clipped one of the two would invent a defect.
 * Under a cover, a keyboard-side node (the round's reading's `ofKeyboard`,
 * one walk per round) is judged against
 * the whole screen; every other node against the part above the band, or
 * scores 0 when the band leaves none.
 */
function judge(found: readonly UiNode[], viewport: DeviceScreen, cover?: { cover: Cover; keyboardSide: (node: UiNode) => boolean }): Judged | undefined {
  const scored = found.map((node): Judged => {
    if (cover === undefined || cover.keyboardSide(node)) {
      return { node, visible: visibleFractionInViewport(node.rect, viewport), clipped: clippedEdges(node.rect, viewport) };
    }
    const { above } = cover.cover;
    if (above === undefined) return { node, visible: 0, clipped: [], under: cover.cover };
    return { node, visible: visibleFractionInViewport(node.rect, above), clipped: clippedEdges(node.rect, above), under: cover.cover };
  });
  return scored.sort((a, b) => b.visible - a.visible)[0];
}

/** The whole-screen judgement over every box that counts (`ScreenBox.boxes`): the best-revealed match in any — "either way up" when there are two. */
function judgeOver(found: readonly UiNode[], boxes: readonly DeviceScreen[]): Judged | undefined {
  return boxes
    .map((box) => judge(found, box))
    .reduce<Judged | undefined>((best, j) => (j !== undefined && (best === undefined || j.visible > best.visible) ? j : best), undefined);
}

/** Would this judgement end the round cleanly — a stop, no stroke, no failure? */
const endsClean = (j: Judged | undefined, fully: boolean): boolean => j !== undefined && j.visible > 0 && (!fully || j.clipped.length === 0);

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
  const top = rect.y < frame.y;
  const bottom = rect.y + rect.height > frame.y + frame.height;
  const left = rect.x < frame.x;
  const right = rect.x + rect.width > frame.x + frame.width;
  switch (direction) {
    case 'down':
      return top && !bottom;
    case 'up':
      return bottom && !top;
    case 'right':
      return left && !right;
    case 'left':
      return right && !left;
  }
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
 * One read that read: every match found, the one judged, the frames it was
 * judged in (the screen above an applied keyboard, or each box that
 * counts), and the swipe count — recorded into `s`. `current` is what the
 * read followed. Where the target stands against the far edge is recorded
 * HERE, on every read — a stop round strokes nothing, and a target seen
 * short only at a stop the confirming read then lost must still turn the
 * next stroke (review round 2).
 */
function observe(s: Mutable<State>, current: Since, read: RoundRead, best: Judged | undefined, frames: readonly Rect[]): Observed {
  const { found, fingerprint } = read;
  const rects = found.map((n) => ({ ...n.rect }));
  const bestUnmoved = best !== undefined && s.prevBest !== undefined && sameRectWithinPixel(s.prevBest, best.node.rect);
  if (current === 'stroke') {
    // The whole tree, for a target not in it (UNMOVED_STROKES_EXHAUST,
    // 2026-10-09): the same streak rule, over the fingerprint.
    const treeUnmoved = fingerprint !== undefined && s.prevFingerprint === fingerprint;
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
    const { rect, frames: lastFrames } = s.lastFound;
    if (!lastFrames.every((f) => beyondFarEdge(rect, s.lastSent as Direction, f))) s.dropped = OPPOSITE[s.lastSent];
  }
  s.lastFound = best === undefined ? undefined : { rect: { ...best.node.rect }, frames };
  if (best !== undefined) {
    s.dropped = undefined;
    s.inTreeAfter = s.swipes;
    const scroller = read.scrollerOf(best.node);
    if (scroller !== undefined) s.targetScroller = { ...scroller };
    s.prevBest = { ...best.node.rect };
    // In EVERY frame the round judged in: a target beyond the far edge one
    // way up but across both edges the other is not turned for.
    const beyond = frames.every((f) => beyondFarEdge(best.node.rect, s.rules.direction, f));
    s.carriedPast = beyond && s.seenShort;
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
 * next stroke goes the caller's way. A target read beyond the far edge
 * before any read saw it short of it — above the screen on round 0 of a
 * scroll down, and every round after while it stays there — is the
 * caller's direction to honour, as it always was. That needs the target to
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
 */
function nextStroke(s: State): { toward: Direction; reach: number; turn: boolean } {
  const toward = s.dropped ?? (s.carriedPast ? OPPOSITE[s.rules.direction] : s.rules.direction);
  // A turn: drawn the other way from the last stroke sent — the one test the reach and the turn count share.
  const turn = s.strokesSent > 0 && toward !== s.lastStroke;
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
    s.frame = read.screen ?? s.frame;
  }
  const found = read?.found ?? [];
  if (found.length > 0) s.everFound = true;
  const viewport = s.frame.box;

  // The round judged twice when a keyboard is up: over the whole screen,
  // and over the screen ABOVE the cover (`coverOf`) — the covered judgement
  // stands only when the band changes the round and the witness stood by it.
  const offered = read === undefined ? undefined : coverOf(read.cover, viewport);
  const whole = judgeOver(found, s.frame.boxes);
  let cover: Cover | undefined;
  let best = whole;
  if (offered !== undefined && read !== undefined) {
    const covered = judge(found, viewport, { cover: offered, keyboardSide: read.ofKeyboard });
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
  // The frames this round judged in — the screen above an applied keyboard,
  // else every box that counts — for where the target stands against the
  // far edge (`observe`, `beyondFarEdge`). A read that did not read says
  // nothing about motion: the comparisons wait for the next one that does.
  const judgedFrames: Rect[] = cover?.above !== undefined ? [{ x: viewport.x, y: viewport.y, ...cover.above }] : s.frame.boxes;
  const observed = read === undefined ? undefined : observe(s, current, read, best, judgedFrames);
  // The probe this read answers (PROBE_REACH) — kept across a read that did
  // not read, which is read again below rather than stroked away from.
  const probed = s.probe;
  if (read !== undefined) s.probe = undefined;

  if (best !== undefined && best.visible > 0 && observed !== undefined && read !== undefined) {
    if (!fully || best.clipped.length === 0) {
      // The probe moved nothing: the match is where it was sent from — the
      // stop holds (it held still through a stroke), and nothing lies
      // beyond its flush edge.
      const probeHeld = probed !== undefined && sameRectWithinPixel(probed.rect, best.node.rect);
      // A stop after a stroke is reported only once a read finds the target
      // where the last one did (SETTLE_CONFIRM_READS): a fling can carry it
      // on, or out of the frame, after the settle read caught it inside. A
      // stop at 0 swipes was not stroked: reported at once.
      const settled = s.swipes === 0 || probeHeld || (current === 'settle' && observed.bestUnmoved);
      if (!settled && mayConfirm(s, seen.elapsedMs)) return confirm(s);
      // `fully: true`, an edge flush with the clipping container: possibly
      // cut there — probe once toward it, or say it could not be checked.
      let flush: Flush | undefined;
      const container = fully ? read.scrollerOf(best.node) : undefined;
      const edge = container === undefined ? undefined : flushEdge(best.node.rect, container, s.rules.direction);
      if (container !== undefined && edge !== undefined) {
        if (probeHeld) flush = { edge, container, checked: true };
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
          return probe(s, edge, best.node.rect, container, probeCover);
        } else flush = { edge, container, checked: false };
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
    // fully: true and still clipped — only a swipe that MOVES it can help.
    if (observed.stuck) return stop(s, { kind: 'stuck', swipes: s.swipes, judged: best, lastStroke: s.lastStroke, viewport });
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
    const by: BoundBy =
      exhausted !== undefined
      ? { of: 'exhausted', lastStroke: s.lastStroke, unchanged: exhausted }
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
  // Over the target's scroll container once a read has placed it in one,
  // else the screen's largest (2026-10-09; swipe.ts#scrollStroke): the
  // stroke touches down on what scrolls, and its length is that
  // container's 60 %, never the screen's — a 1417-px list is not stroked
  // 1332 px. A round whose tree did not read keeps the last read round's.
  const within = read === undefined ? s.lastWithin : (s.targetScroller ?? read.mainScroller);
  s.lastWithin = within;
  if (turn) s.turns++;
  s.strokesSent++;
  s.lastStroke = toward;
  s.lastSent = toward;
  s.confirmReads = 0;
  s.since = 'stroke';
  s.swipes++;
  s.owesDrawn = true;
  return {
    state: s as unknown as Rounds,
    step: { do: 'stroke', toward, reach, ...(strokeCover !== undefined && { coverTop: strokeCover.topCover.y }), ...(within !== undefined && { within: { ...within } }) },
  };
}

/**
 * Send the flush check's probe (PROBE_REACH): toward revealing `edge`, over
 * the container, clear of this round's cover. A swipe like any other for
 * the count and the bound, but not a step of the scroll's course: the turn
 * (`lastStroke`, `turns`, `strokesSent`) is left as it was, so a probe the
 * other way from the caller's direction is not a turn and halves no reach.
 */
function probe(s: Mutable<State>, edge: Edge, rect: Rect, container: Rect, cover: Cover | undefined): { state: Rounds; step: RoundStep } {
  s.probe = { rect: { ...rect }, edge };
  s.lastSent = REVEALS[edge];
  s.confirmReads = 0;
  s.since = 'stroke';
  s.swipes++;
  s.owesDrawn = true;
  return {
    state: s as unknown as Rounds,
    step: { do: 'stroke', toward: REVEALS[edge], reach: PROBE_REACH, ...(cover !== undefined && { coverTop: cover.topCover.y }), within: { ...container }, probe: true },
  };
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
  if (best !== undefined && best.visible > 0) return { of: 'clipped', judged: best };
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
