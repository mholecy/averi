import type { DeviceScreen, Rect, Stroke, UiNode } from '../adapters/types.js';
import { clippedEdges, sameRectWithinPixel, visibleFractionInViewport } from '../ui-tree/geometry.js';
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
 * the stop verdict (settled / confirm / unsettled, then `ask unlocated` on a
 * `fully: true` stop with no cover under it); stuck; the confirming read
 * that did not read; covered (nothing above the band); the bound (exhausted,
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
export interface RoundRead {
  /** Every match of the target, in tree order (resolve.ts#findTarget). */
  found: readonly UiNode[];
  /** `judgingScreen` over this tree — the tap's screen too; undefined when there is no box at all, and then the round keeps the last frame. */
  screen?: JudgingScreen;
  /** The reading's `cover()`: everything a shown keyboard covers; undefined when hidden or unknown. */
  cover?: KeyboardCover;
  /** The reading's `ofKeyboard`: is this node the keyboard's own UI (judged against the whole screen, never under the band)? */
  ofKeyboard: (node: UiNode) => boolean;
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
   * the next round's `drawn`.
   */
  | { do: 'stroke'; toward: Direction; reach: number; coverTop?: number }
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
export interface Judged {
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
 *   stop judged with no cover under it.
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
  | { kind: 'visible'; swipes: number; judged: Judged; settled: boolean; unlocated: boolean }
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

/** Which bound ended the scroll: the same stroke twice moved nothing (with the direction last swiped), `maxSwipes`, or the deadline. */
export type BoundBy = { of: 'exhausted'; lastStroke: Direction } | { of: 'maxSwipes' } | { of: 'timeout'; timeoutMs: number };

/**
 * What the target was short of at a bound, by the last round:
 * - `readFailed`: the last tree read failed — quoted, whatever came before;
 * - `clipped`: in the frame but clipped (the `fully: true` bar not met);
 * - `absent`: not in the last tree, and never in the frame before it;
 * - `gone`: not in the last tree, in the frame after swipe `inFrameAfter`;
 * - `offFrame`: in the tree, off the frame judged — `inFrameAfter` when an
 *   earlier read had it in the frame; `cover` the one this round applied,
 *   `eitherWayUp` when the whole-screen judgement ran over both boxes.
 */
export type Shortfall =
  | { of: 'readFailed'; error: Error }
  | { of: 'clipped'; judged: Judged }
  | { of: 'absent' }
  | { of: 'gone'; inFrameAfter: number }
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
 * and, on Android, what a round's keyboard reading costs: the window query,
 * the touchable-region query too while the keyboard reads shown, and a
 * witness query when the band matters on that read (1 to 3 adb calls;
 * ui-tree/keyboard-cover.ts has the table); a stop at 0
 * swipes sent no stroke and spends none. A target still
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
 */
export const UNMOVED_STROKES_EXHAUST = 2;

/** The direction the content lies the other way — the stroke that brings back a target a fling carried past the viewport. */
const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** What a read followed: the scroll's start, a stroke, or a settle pause that sent nothing (a confirming read). */
type Since = 'start' | 'stroke' | 'settle';

/** The reducer's state — what the caller holds between rounds. Opaque but for the swipe count; the fields are `State`'s. */
export interface Rounds {
  readonly swipes: number;
}

/**
 * Everything the scroll remembers between rounds, one record with one
 * writer (`round`). Until 2026-10-09 the motion half was the `Motion` class
 * and the rest the loop's `let`s.
 */
interface State extends Rounds {
  readonly rules: RoundRules;
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
   * that does not find the target (a lazy list dropped it: nothing to turn
   * for).
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
  };
  return state;
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
  /** UNMOVED_STROKES_EXHAUST identical strokes in a row left EVERY match where it was, and the target is off the frame. */
  exhausted: boolean;
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
function observe(s: Mutable<State>, current: Since, found: readonly UiNode[], best: Judged | undefined, frames: readonly Rect[]): Observed {
  const rects = found.map((n) => ({ ...n.rect }));
  const bestUnmoved = best !== undefined && s.prevBest !== undefined && sameRectWithinPixel(s.prevBest, best.node.rect);
  if (current === 'stroke') {
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
  s.carriedPast = false;
  if (best !== undefined) {
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
    exhausted: s.allUnmovedStrokes >= UNMOVED_STROKES_EXHAUST && offFrame,
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
 * caller's direction to honour, as it always was. Needs the target to STAY
 * in the tree once off the frame: a lazy list (Android
 * RecyclerView/LazyColumn, iOS List/UITableView under WDA) drops it, and
 * then nothing turns.
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
  const toward = s.carriedPast ? OPPOSITE[s.rules.direction] : s.rules.direction;
  // A turn: drawn the other way from the last stroke sent — the one test the reach and the turn count share.
  const turn = s.strokesSent > 0 && toward !== s.lastStroke;
  return { toward, reach: 0.5 ** (turn ? s.turns + 1 : s.turns), turn };
}

/**
 * One round: what `seen` means for the scroll, and the next step (the
 * module doc has the protocol, the order and the bound). Pure.
 */
export function round(state: Rounds, seen: RoundSeen): { state: Rounds; step: RoundStep } {
  const input = state as State;
  if (input.done) throw new Error('scroll round after the scroll stopped');
  if (input.owesDrawn !== (seen.drawn !== undefined)) {
    throw new Error(input.owesDrawn ? 'scroll round after a stroke without the stroke drawn' : 'scroll round with a stroke drawn but none asked for');
  }
  const s: Mutable<State> = { ...input, owesDrawn: false };
  const ask = (what: 'witness' | 'unlocated') => ({ state: input, step: { do: 'ask', what } as const });
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
  const observed = read === undefined ? undefined : observe(s, current, found, best, judgedFrames);

  if (best !== undefined && best.visible > 0 && observed !== undefined) {
    if (!fully || best.clipped.length === 0) {
      // A stop after a stroke is reported only once a read finds the target
      // where the last one did (SETTLE_CONFIRM_READS): a fling can carry it
      // on, or out of the frame, after the settle read caught it inside. A
      // stop at 0 swipes was not stroked: reported at once.
      const settled = s.swipes === 0 || (current === 'settle' && observed.bestUnmoved);
      if (!settled && mayConfirm(s, seen.elapsedMs)) return confirm(s);
      // The `unlocated` row on a `fully: true` stop only — where the answer
      // changes what the reader does next — and only with no cover under
      // the judgement: a band THIS stop was judged under is what it reports.
      let unlocated = false;
      if (fully && best.under === undefined) {
        if (seen.unlocated === undefined) return ask('unlocated');
        unlocated = seen.unlocated;
      }
      return stop(s, { kind: 'visible', swipes: s.swipes, judged: best, settled, unlocated });
    }
    // fully: true and still clipped — only a swipe that MOVES it can help.
    if (observed.stuck) return stop(s, { kind: 'stuck', swipes: s.swipes, judged: best, lastStroke: s.lastStroke, viewport });
  }
  // A confirming read that did not read: read again, within the same
  // budget, rather than stroke away from a stop the last read saw.
  if (current === 'settle' && read === undefined && mayConfirm(s, seen.elapsedMs)) return confirm(s);
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
  const exhausted = observed?.exhausted === true;
  if (exhausted || s.swipes >= s.rules.maxSwipes || seen.elapsedMs >= s.rules.timeoutMs) {
    // The `unlocated` row, asked of the last round's reading whatever came
    // before — a round whose tree did not read has none.
    let unlocated = false;
    if (read !== undefined) {
      if (seen.unlocated === undefined) return ask('unlocated');
      unlocated = seen.unlocated;
    }
    const by: BoundBy = exhausted
      ? { of: 'exhausted', lastStroke: s.lastStroke }
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
  if (turn) s.turns++;
  s.strokesSent++;
  s.lastStroke = toward;
  s.confirmReads = 0;
  s.since = 'stroke';
  s.swipes++;
  s.owesDrawn = true;
  return { state: s, step: { do: 'stroke', toward, reach, ...(strokeCover !== undefined && { coverTop: strokeCover.topCover.y }) } };
}

/** Spend a confirming read: the next read follows a settle, not a stroke. */
function confirm(s: Mutable<State>): { state: Rounds; step: RoundStep } {
  s.confirmReads++;
  s.since = 'settle';
  return { state: s, step: { do: 'confirm' } };
}

function stop(s: Mutable<State>, outcome: ScrollOutcome): { state: Rounds; step: RoundStep } {
  s.done = true;
  return { state: s, step: { do: 'stop', outcome } };
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
  if (found.length === 0) return left !== undefined ? { of: 'gone', inFrameAfter: left } : { of: 'absent' };
  return {
    of: 'offFrame',
    rect: (best?.node ?? found[0]).rect,
    ...(left !== undefined && { inFrameAfter: left }),
    viewport,
    ...(cover !== undefined && { cover }),
    eitherWayUp: s.frame.boxes.length > 1 && cover?.above === undefined,
  };
}
