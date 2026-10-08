import type { DeviceAdapter, DeviceScreen, Rect, SoftKeyboard, Stroke, UiNode } from '../adapters/types.js';
import { readTreeOrError, type TreeRead } from '../ui-tree/read-tree.js';
import { clippedEdges, visibleFractionInViewport } from '../ui-tree/geometry.js';
import { cannotHide, keyboardSideNodes, readSoftKeyboard, type KeyboardRemedy, type SoftKeyboardReading } from '../ui-tree/soft-keyboard.js';
import { sleep } from '../util/sleep.js';
import { keyboardCorroborated, keyboardUnlocated, UNLOCATED_KEYBOARD } from './keyboard.js';
import { frameText } from './keyboard-model.js';
import { absenceError, describeTarget, findTarget, type Target } from './resolve.js';
import { judgingScreen, screenBox, shortenStroke, swipeVector, swipeVectorAbove, type Direction, type JudgingScreen } from './swipe.js';

/** The scroll's budget when the caller has none — the MCP scroll_until tool's documented default is derived from it. */
export const DEFAULT_SCROLL_TIMEOUT_MS = 15_000;

/** The swipe bound when the caller has none — the MCP scroll_until tool's documented default is derived from it too. */
export const DEFAULT_MAX_SWIPES = 6;

export interface ScrollOptions {
  /** Where the CONTENT lies relative to the current view (down = below the fold → finger swipes up). Default down. */
  direction?: Direction;
  /** Default DEFAULT_MAX_SWIPES. */
  maxSwipes?: number;
  /** Require the element ENTIRELY inside the viewport, not merely overlapping it. Default false. */
  fully?: boolean;
  /** Default DEFAULT_SCROLL_TIMEOUT_MS. The flow engine converts its `timeout: 2s` before calling. */
  timeoutMs?: number;
  /** Pause after each swipe before the next read. Default 400. */
  settleMs?: number;
}

/**
 * What the scroll actually achieved — not just how many swipes it took.
 *
 * `swipes` alone was the old return, and it made the tool unable to tell the
 * truth: the stop condition is INTERSECTION, so a row clipped at the viewport
 * edge stops the loop and used to be reported as a bare "visible". The caller's
 * very next step is normally an assert or a screenshot on that rect, i.e. the
 * one operation a clipped rect silently corrupts.
 */
export interface ScrollUntilResult {
  swipes: number;
  /** Fraction of the element's area inside the viewport at the stop (0..1) — the screen above the soft keyboard when `keyboard` is shown. */
  visible: number;
  /** Viewport edges the element still extends past, [] when fully revealed — `bottom` is the keyboard's top edge when `keyboard` is shown. */
  clipped: Edge[];
  /**
   * The soft keyboard at the stop, when it changed what the result means
   * (2026-10-08) — absent when none was read, so a run without a keyboard
   * reports what it always did:
   * - `shown`: the stop was judged against the screen ABOVE `frame`, not the
   *   whole screen, and that changed it — the part under it is not visible,
   *   whatever the tree says
   *   (docs/bugs/2026-10-08-scroll-until-ignores-android-soft-keyboard.md).
   *   Only where the band changed the stop: a clip at its edge, or — when
   *   several nodes match — a different match judged (one under the band
   *   loses to one above it), which can be a clean "fully visible" (round 3
   *   of the review, 2026-10-08); a band that changes nothing is not applied;
   * - `unlocated`: the window model's floating-keyboard row — the input
   *   method says one is shown, the window state gives it no area — so
   *   nothing could be judged against it and the report says so
   *   (keyboard.ts#keyboardUnlocated). Only on a clean `fully: true` stop.
   */
  keyboard?: { state: 'shown'; frame: Rect } | { state: 'unlocated' };
  /**
   * `false` when the stop was reached after a stroke and no read confirmed
   * it held still (2026-10-08, review round 1): the target still moved on
   * each of SETTLE_CONFIRM_READS confirming reads (an animated row? a long
   * fling), or the stop came at the deadline. Absent on a settled stop — a
   * run that settles reports what it always did. The reply says so.
   */
  settled?: false;
}

/**
 * Deliberately NOT on ScrollUntilResult: whether the content is exhausted.
 * It is learnt only by spending swipes and seeing the rects not move — the
 * `fully: true` path at a clipped stop, and (since 2026-10-08) any path
 * whose target is in the tree but off the frame — and wherever it is
 * learnt the answer is "yes, and here is the throw". A returned result
 * would therefore carry a constitutionally `false` field. Establishing it
 * at a stop would cost every caller an extra swipe past a stop they already
 * accepted, which is a worse trade than the clipped fraction already
 * reported here.
 */

/**
 * How much of an element is on screen, in the terms the caller's next call
 * cares about. Takes the already-computed edges rather than a rect and a
 * viewport, so every site that has judged an element once can describe it
 * without judging it again — including `describeScrollResult`, which holds a
 * result and no rect at all.
 */
function describeClip(edges: readonly string[], visible: number, band?: Rect): string {
  // Never round a clipped element up to a reassuring 100%: the whole point of
  // the line is that something is missing.
  const pct = Math.min(Math.round(visible * 100), 99);
  const where = band === undefined ? 'the viewport' : `the viewport above the soft keyboard over ${frameText(band)}`;
  return `CLIPPED at ${edges.join('/')}, ${pct}% of it is in ${where}`;
}

/** `1 swipe`, `3 swipes` — the one spelling of the count every scroll sentence quotes. */
const swipesText = (n: number): string => `${n} swipe${n === 1 ? '' : 's'}`;

/** The honest one-line summary both call sites print. */
export function describeScrollResult(r: ScrollUntilResult): string {
  const n = swipesText(r.swipes);
  // `shown` comes where the band changed the stop — a clip at its edge, or a
  // different match judged, which can be clean; `unlocated` only with a
  // clean `fully: true` stop (scrollUntilVisible).
  const band = r.keyboard?.state === 'shown' ? r.keyboard.frame : undefined;
  const moving = r.settled === false ? `; ${STILL_MOVING}` : '';
  if (r.clipped.length === 0) {
    const above = band === undefined ? '' : `, judged above the soft keyboard over ${frameText(band)}`;
    const unlocated = r.keyboard?.state === 'unlocated' ? `; ${UNLOCATED_KEYBOARD} — it was not judged and may cover the element` : '';
    return `fully visible after ${n}${above}${unlocated}${moving}`;
  }
  return (
    `visible after ${n} — ${describeClip(r.clipped, r.visible, band)}` +
    `. A rect assert or screenshot on this element will measure the CLIPPED box${moving}`
  );
}

/** The `settled: false` note — what the reader should know before measuring the element. */
const STILL_MOVING = 'still moving at the last read (a fling not yet over, or an animated element?) — a rect or screenshot taken now may not match';

/**
 * How to judge the whole screen again — the scroll's own sentence, by what
 * the adapter can hide a keyboard with (`KeyboardRemedy`, the reading's).
 * Its own, not the pixel poll's or the guard's: before a scroll the useful
 * advice is to hide the keyboard and scroll again. Names MCP tools and "a
 * flow", the deliberate exception recorded in keyboard-window.ts.
 */
function hideToJudgeWholeScreen({ dismissal, advice }: KeyboardRemedy): string {
  return dismissal === 'back'
    ? 'to reach it with the keyboard down, hide it first (press_key back from the MCP tools; `dismissKeyboard: true` on the fill before this step in a flow) and scroll again'
    : 'to reach it with the keyboard down, hide it first (tap a neutral element such as the screen title — a tap: step in a flow) and scroll again; ' +
        cannotHide(advice);
}

type Edge = 'top' | 'bottom' | 'left' | 'right';

/**
 * A shown soft keyboard as the round may apply it (2026-10-08): its frame,
 * the part of the screen it leaves — everything above its TOP edge, full
 * width — and what the adapter can do about it. Above the top edge, not
 * around the band: a docked keyboard (the only kind measured, Android IME
 * [0,1398][1080,2220], WDA band from y 539/589 of 874) runs to the bottom,
 * so the two are the same; a band that does not (an iPad split or floating
 * keyboard, unmeasured) costs content below it, which can only make the
 * scroll swipe more or fail naming the keyboard — never report as visible
 * what is under it. `above` undefined: the band starts at or above y 0 and
 * leaves nothing (a full-screen extract-mode IME, unmeasured).
 */
interface Cover {
  band: Rect;
  above: DeviceScreen | undefined;
  remedy: KeyboardRemedy;
}

/** The cover a reading offers, or none: not shown, or a band whose top lies at or below the screen's bottom (it covers nothing on it). */
function coverOf(reading: SoftKeyboardReading | undefined, viewport: DeviceScreen): Cover | undefined {
  if (reading?.keyboard.state !== 'shown') return undefined;
  const band = reading.keyboard.frame;
  if (band.y >= viewport.height) return undefined;
  return { band, above: band.y <= 0 ? undefined : { width: viewport.width, height: band.y }, remedy: reading };
}

/** One match as judged: how much of it is in the frame, the frame's edges it extends past, and the cover it was judged under (none for a whole-screen judgement or a keyboard-side node). */
interface Judged {
  node: UiNode;
  visible: number;
  clipped: Edge[];
  under?: Cover;
}

/**
 * The MOST revealed match, not the first: an id can sit on a container and
 * its child, and reporting the clipped one of the two would invent a defect.
 * Under a cover, a keyboard-side node (`keyboardSideNodes`, the set
 * `partOfKeyboard` answers from, built once per round) is judged against
 * the whole screen; every other node against the part above the band, or
 * scores 0 when the band leaves none.
 */
function judge(found: readonly UiNode[], viewport: DeviceScreen, cover?: { cover: Cover; keyboardSide: ReadonlySet<UiNode> }): Judged | undefined {
  const scored = found.map((node): Judged => {
    if (cover === undefined || cover.keyboardSide.has(node)) {
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

/** What the stop judged against, for "never intersected …". */
const frameWords = (viewport: DeviceScreen, cover: Cover | undefined): string =>
  cover?.above === undefined
    ? `${viewport.width}x${viewport.height} viewport`
    : `${cover.above.width}x${cover.above.height} screen above the soft keyboard over ${frameText(cover.band)}`;

/**
 * How many reads a stop reached after a stroke may spend waiting for the
 * target to hold still before it is reported unsettled (2026-10-08, the iOS
 * device check of docs/bugs/2026-10-08-scroll-until-ignores-android-soft-
 * keyboard.md). A stop after a stroke is CONFIRMED: one more read after a
 * further settle, in which the target's rect is unchanged and the stop
 * still holds. Measured under WDA: the 400 ms settle read caught a
 * SwiftUI form mid-fling with the row inside the viewport — "fully visible
 * after 1 swipe" — and a read 1 s later had it at y -48 / -121 / -133,
 * behind the top bar, three runs of three. What it costs: every stop after
 * a stroke spends one more settle, one more tree read and, on Android, one
 * more window query — a witness query only when the band matters on that
 * read; a stop at 0 swipes sent no stroke and spends none. A target still
 * moving inside the viewport is read again, up to this many reads a
 * stroke, then reported with `settled: false` and a note saying so: a
 * fling is over well inside 3 × 400 ms plus the reads, and a target that
 * never holds still (an animated row, a marquee) must not hold the scroll
 * until its timeout. The confirming reads count against `timeoutMs` (a stop
 * reached at the deadline is reported unsettled, unconfirmed), not against
 * `maxSwipes`: they send nothing.
 */
const SETTLE_CONFIRM_READS = 3;

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
 * turned round) is a new attempt.
 */
const UNMOVED_STROKES_EXHAUST = 2;

/** The direction the content lies the other way — the stroke that brings back a target a fling carried past the viewport. */
const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/**
 * The target lies BEYOND the edge of `frame` that a scroll toward
 * `direction` moves content out through — past that far edge, or across
 * it — and not across the near one: for content below (down) the content
 * moves up, so its top above the frame's top and its bottom inside the
 * frame or above it; for content above (up), mirrored at the frame's
 * bottom (the keyboard's top edge, when the frame is the screen above
 * one); likewise sideways. Content comes in through the near edge, so a
 * target that was ever read short of this and is now beyond it was carried
 * across the frame by a fling (`Motion.nextStroke`; measured under
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

/** What a read followed: the scroll's start, a stroke, or a settle pause that sent nothing (a confirming read). Motion's own fact, set by `stroked` and `confirming`. */
type Since = 'start' | 'stroke' | 'settle';

/** What one read says about motion (`Motion.observe`). */
interface Observed {
  /** The judged match is where the previous read's judged match was. */
  bestUnmoved: boolean;
  /**
   * UNMOVED_STROKES_EXHAUST identical strokes in a row left the JUDGED match
   * where it was — the `fully: true` clipped stop's "content exhausted".
   * The judged match alone (review round 2): a visible clipped match that
   * does not move is the defect this reports; two strokes, not one, for
   * the transients the exhausted rule waits out.
   */
  stuck: boolean;
  /** UNMOVED_STROKES_EXHAUST identical strokes in a row left EVERY match where it was, and the target is off the frame. */
  exhausted: boolean;
}

/** What a stop is, by the confirming rule (SETTLE_CONFIRM_READS): settled; worth one more read; or reported unsettled. */
type StopVerdict = 'settled' | 'confirm' | 'unsettled';

/** The next stroke: where the content lies for it, and the factor its reach is scaled by (`shortenStroke`). */
interface NextStroke {
  toward: Direction;
  reach: number;
}

/**
 * The scroll's memory of how the target moved, read for read — the one
 * owner of every rule that compares a read with an earlier one
 * (2026-10-08, review round 1: they were loose variables of the loop):
 * what each read followed, the stuck and exhausted tests, the confirming
 * reads, the turn after a fling and its shortened stroke, and the swipe
 * after which the target was last in the frame.
 *
 * Per round the loop calls `beginRead` once, then — when the tree read —
 * `observe`; at a stop `stopVerdict` (and `confirming` to spend a read);
 * before a stroke `nextStroke`, after it `stroked`.
 */
class Motion {
  private since: Since = 'start';
  /** What the read being judged followed — `since` as `beginRead` found it. */
  private current: Since = 'start';
  /** Every match's rect at the last read that read, and the judged match's at the last read that had one. */
  private prevRects: Rect[] | undefined;
  private prevBest: Rect | undefined;
  /** Identical strokes in a row after which every match, and the judged match, stayed put — and the stroke they were. */
  private allUnmovedStrokes = 0;
  private bestUnmovedStrokes = 0;
  private streakStroke: string | undefined;
  private lastStrokeKey: string | undefined;
  /** Some read saw the target SHORT of the far edge (`beyondFarEdge`) — so a later read beyond it means a fling carried it across. */
  private seenShort = false;
  /**
   * The last read that READ found the target beyond the far edge, after an
   * earlier read saw it short of it: the next stroke turns. Kept across a
   * read that failed — that round strokes as the last read round decided,
   * as it keeps that round's stroke box (`lastReadCover`); cleared by a read
   * that does not find the target (a lazy list dropped it: nothing to turn
   * for).
   */
  private carriedPast = false;
  private confirmReads = 0;
  private strokesSent = 0;
  /** Where the content lay for the last stroke sent: the caller's direction, or its opposite after a fling past the target. For "swiping … no longer moves it". */
  lastStroke: Direction;
  /** Direction changes — a stroke drawn the other way from the one before — for the shortening and the failure text. */
  turns = 0;
  /** The swipe count at the last read that had the target in the frame (any part of it) — for a failure after it left again. */
  inFrameAfter: number | undefined;

  constructor(private readonly direction: Direction) {
    this.lastStroke = direction;
  }

  /** A read is starting: what it follows is fixed for this round. */
  beginRead(): void {
    this.current = this.since;
  }

  /** The read being judged is a confirming read (nothing was sent since the last). */
  get confirmingRead(): boolean {
    return this.current === 'settle';
  }

  /**
   * One read that read: every match found, the one judged, the frames it
   * was judged in (the screen above an applied keyboard, or each box that
   * counts), and the swipe count. Where the target stands against the far
   * edge is recorded HERE, on every read — a stop round strokes nothing,
   * and a target seen short only at a stop the confirming read then lost
   * must still turn the next stroke (review round 2).
   */
  observe(found: readonly UiNode[], best: Judged | undefined, frames: readonly Rect[], swipes: number): Observed {
    const rects = found.map((n) => ({ ...n.rect }));
    const bestUnmoved = best !== undefined && this.prevBest !== undefined && rectsEqual(this.prevBest, best.node.rect);
    if (this.current === 'stroke') {
      // Every match, not only the judged one, for "exhausted" (review round
      // 1): with several matches off the frame the judged one is the first
      // in tree order, which can be a static duplicate (another page, a
      // hidden copy) while the real one moved.
      const allUnmoved = this.prevRects !== undefined && sameRects(this.prevRects, rects);
      const same = this.streakStroke === this.lastStrokeKey;
      this.allUnmovedStrokes = !allUnmoved ? 0 : this.allUnmovedStrokes > 0 && same ? this.allUnmovedStrokes + 1 : 1;
      this.bestUnmovedStrokes = !bestUnmoved ? 0 : this.bestUnmovedStrokes > 0 && same ? this.bestUnmovedStrokes + 1 : 1;
      this.streakStroke = this.lastStrokeKey;
    }
    this.prevRects = rects;
    this.carriedPast = false;
    if (best !== undefined) {
      this.prevBest = { ...best.node.rect };
      // In EVERY frame the round judged in: a target beyond the far edge one
      // way up but across both edges the other is not turned for.
      const beyond = frames.every((f) => beyondFarEdge(best.node.rect, this.direction, f));
      this.carriedPast = beyond && this.seenShort;
      if (!beyond) this.seenShort = true;
      if (best.visible > 0) this.inFrameAfter = swipes;
    }
    const offFrame = best !== undefined && best.visible === 0 && found.some((n) => n.rect.width > 0 && n.rect.height > 0);
    return {
      bestUnmoved,
      stuck: this.current === 'stroke' && this.bestUnmovedStrokes >= UNMOVED_STROKES_EXHAUST,
      exhausted: this.allUnmovedStrokes >= UNMOVED_STROKES_EXHAUST && offFrame,
    };
  }

  /** A stop on this read: settled (0 swipes, or a confirming read found it unmoved), worth another read, or reported unsettled. */
  stopVerdict(o: Observed, swipes: number, deadline: number): StopVerdict {
    if (swipes === 0 || (this.current === 'settle' && o.bestUnmoved)) return 'settled';
    return this.mayConfirm(deadline) ? 'confirm' : 'unsettled';
  }

  /** Another confirming read is within the stroke's budget and the deadline. */
  mayConfirm(deadline: number): boolean {
    return this.confirmReads < SETTLE_CONFIRM_READS && Date.now() < deadline;
  }

  /** A confirming read is being spent: the next read follows a settle, not a stroke. */
  confirming(): void {
    this.confirmReads++;
    this.since = 'settle';
  }

  /**
   * The next stroke (2026-10-08, the WDA device check): toward the caller's
   * direction — unless this read found a fling carried the target across
   * the frame since a read saw it short of the far edge (`observe`;
   * measured 613 → -357 in one swipe, then five more swipes DOWN into
   * exhausted content). Then the other way, to bring it back; a stroke that
   * throws it back past the near edge leaves it short again, and the next
   * stroke goes the caller's way. A target read beyond the far edge before
   * any read saw it short of it — above the screen on round 0 of a scroll
   * down, and every round after while it stays there — is the caller's
   * direction to honour, as it always was. Needs the target to STAY in the
   * tree once off the frame: a lazy list (Android RecyclerView/LazyColumn,
   * iOS List/UITableView under WDA) drops it, and then nothing turns.
   *
   * Converging is deliberate (review round 2): every direction change
   * halves the reach of every stroke after it (`reach`, applied with
   * swipe.ts#shortenStroke — the touch-down kept, never under twice
   * TOUCH_SLOP). A fling is the app's: with the measured content-down fling
   * (−729 to −970 pt for the 344-pt stroke) and a content-up fling of the
   * same size, full strokes both ways ping-pong round the target to
   * `maxSwipes`; with the reach halved per turn the distance left shrinks
   * geometrically whatever the app flings. A turn that overshoots too is
   * turned again, not given up — giving up would swipe on into content the
   * target has passed — and the failure counts the turns.
   */
  nextStroke(): NextStroke {
    const toward = this.carriedPast ? OPPOSITE[this.direction] : this.direction;
    const turns = this.strokesSent > 0 && toward !== this.lastStroke ? this.turns + 1 : this.turns;
    return { toward, reach: 0.5 ** turns };
  }

  /** A stroke was sent: toward `toward`, drawn as `stroke`. */
  stroked(toward: Direction, stroke: Stroke): void {
    if (this.strokesSent > 0 && toward !== this.lastStroke) this.turns++;
    this.strokesSent++;
    this.lastStroke = toward;
    this.lastStrokeKey = JSON.stringify(stroke);
    this.confirmReads = 0;
    this.since = 'stroke';
  }
}

/** The same set of rects, each within a pixel — every match where it was. Empty sets say nothing. */
function sameRects(a: readonly Rect[], b: readonly Rect[]): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  const left = [...a];
  return b.every((r) => {
    const i = left.findIndex((l) => rectsEqual(l, r));
    if (i < 0) return false;
    left.splice(i, 1);
    return true;
  });
}

/** "after swipe 2", "before the first swipe" — when the target was last in the frame. */
const whenInFrame = (swipes: number): string => (swipes === 0 ? 'before the first swipe' : `after swipe ${swipes}`);

/**
 * Swipe until the element is present AND visibly inside the viewport
 * (ARCHITECTURE.md §4, C1). Throws with a diagnosis of the last tree.
 *
 * `fully: true` raises the bar from "intersects" to "entirely inside", and
 * keeps swiping until it is — then fails naming the shortfall when the content
 * runs out first. That failure message IS the app bug in the measured case:
 * a scroll container with no clearance for the floating bottom-nav bar can
 * never fully reveal its last row, however far it scrolls. Default stays
 * `false`: the stop condition is unchanged, only the REPORT gains the truth.
 *
 * Every match is judged, not only the actionable one: an id can sit on a
 * container and its child, and the MOST revealed of the two is the honest
 * report, so this loop does not go through resolveNow. It keeps its own loop
 * on readTreeOrError rather than pollTree because it ACTS between reads (a
 * swipe, then a settle pause) and has a second stop bound (maxSwipes); the
 * read-failure rule is the same — a failed read is a miss, the last error is
 * quoted at the stop.
 *
 * The one stop that is absence — no read, at any swipe, held a match, and
 * the last read succeeded — throws ElementNotFoundError (2026-10-08; the
 * rule's one owner is resolve.ts's absenceError) with the same "element
 * never appeared in the tree" wording,
 * so an `optional:` scroll_until to an element that is not on this screen
 * is skipped "(not present)" like a tap or a fill would be. Every other stop
 * (found but clipped or off the viewport, a failed last read, content that
 * ran out) stays a plain Error: the element was there, or nobody could see.
 *
 * The soft keyboard (2026-10-08,
 * docs/bugs/2026-10-08-scroll-until-ignores-android-soft-keyboard.md):
 * measured on Android, an element wholly under the IME was "fully visible
 * after 0 swipes", and with the IME up a content-down stroke — through the
 * screen centre, its start at y ≈ 1776 of 2220 — began on a key and scrolled
 * nothing for 15 s; the same on iOS 27 with the pad up (y ≈ 699 of 874). So
 * every round reads the keyboard the way the tap guard and the pixel poll do
 * — `readSoftKeyboard` on the round's tree (the oracle's `state()` on
 * Android, one query a round; the WDA band on iOS, no device read) — and
 * judges the round twice, over the whole screen and over the screen ABOVE a
 * shown keyboard (`coverOf`): an element under it scores 0 or is clipped at
 * the keyboard's edge, and the stroke keeps clear of it
 * (`swipeVectorAbove`: the whole screen's stroke, its point on or near the
 * keyboard pulled up — since the iOS device check, below), so it starts on
 * the content. The keyboard's own nodes (a key
 * as the target) are judged against the whole screen, as `readSoftKeyboard`
 * reads them `unknown` for a subject. `hidden`, `unknown`: the whole screen,
 * as before — the guard's fail-open rule; an unread tree strokes in the box
 * the last read round's band left (review 2026-10-08), the stop already
 * quoting the read error. Landscape: since 2026-10-08 the judgement, the
 * band's `above` box and the stroke all use the round's `screenBox` box —
 * turned when the tree's window says so — the screen the tap's on-screen
 * rule judges too (resolve.ts#tapScreen); the band's frame is the oracle's
 * or the tree's, in the tree's coordinates already. The whole-screen
 * judgement runs over `ScreenBox.boxes` through `judgingScreen`, the tap's
 * own reader — both ways up (the better of the two) only when a turn is
 * suggested but not witnessed — so the stop and the tap agree by
 * construction; the band's `above` box stays the chosen one. Unmeasured on
 * a device held sideways.
 *
 * The band is APPLIED only when it changes the round — the two judgements
 * differ, or the round ends in a stroke or a failure rather than a clean
 * stop — and only once the input method has not denied it
 * (`keyboardCorroborated`: the guard's veto, its one owner in
 * keyboard-window.ts). Review 2026-10-08: the window state was measured
 * stale for seconds after a navigating tap, and a phantom band would score
 * an on-screen target 0, send a stroke through the next screen and report
 * a keyboard that is gone. The witness is asked on EVERY round a band
 * matters and its answer is not kept (review 2026-10-08, two rounds): a
 * stale window on round 0 can be followed by a real keyboard — a new
 * screen that auto-focuses a field — and a confirmed keyboard can be hidden
 * by the scroll itself (a list that dismisses it on drag) and leave the
 * window state stale-shown behind it. At most one query a round, the
 * rounds bounded by `maxSwipes` (what one costs: AndroidAdapter's
 * keyboardWitness); none on iOS, whose band is read off the tree being
 * judged. A failed or `fully: true` stop may add one more, the floating
 * row's (below). A band that does not change the round is not reported
 * either: the result carries `keyboard: shown` only when the stop was
 * judged under one this round — a clip at its edge, or another of several
 * matches judged. The witness is no longer remembered, so one that times
 * out costs its timeout (KEYBOARD_WITNESS_TIMEOUT_MS in adapters/android.ts,
 * 2 s) on each round where the band matters; the deadline is checked once
 * a round, after it, so the last round can run past `timeoutMs` by that
 * wait on top of its reads. A band that leaves nothing above
 * it (its top at y ≤ 0 — a full-screen extract-mode IME, unmeasured) scores
 * every non-keyboard node 0 and fails at once, no stroke, naming it.
 *
 * Chosen over hiding the keyboard first (the other direction the note
 * offered): that is a `back` on Android — witness-vetoed, but on its
 * `unknown → back` row a navigation whenever the adapter is wrong — and on
 * iOS a configured tap or a refusal, for a step that sent no key before;
 * the guard rejected the same trade for every tap (keyboard.ts). Scrolling
 * above the keyboard needs no side effect and still reaches the element:
 * the stroke moves it up out from under the band. What it cannot do — the
 * last rows of a container that does not resize for the keyboard stay under
 * it at the end of the content — is a `fully: true` failure that names the
 * keyboard and the way to hide it, not a "fully visible"; a row WHOLLY
 * under it there fails the same way after the two swipes that did not move
 * it (below), not at the timeout.
 *
 * The device check of that fix (2026-10-08, the note's two "Device check"
 * sections, and review round 1) found three more things, each fixed where
 * it lives:
 * - The stroke (`swipeVectorAbove`): drawn over the box above the keyboard,
 *   a content-up stroke touched down in the app's top bar and moved nothing
 *   under WDA. It is still the uncovered box's stroke, its touch-down never
 *   inside the keyboard clearance nor higher than without a keyboard; the
 *   length is not cut. Only the covered area's top edge (`band.y`) is read:
 *   the band need not be full width nor reach the bottom.
 * - The stop is SETTLED (`SETTLE_CONFIRM_READS`, `Motion.stopVerdict`): a
 *   stop reached after a stroke is reported only once a further read, after
 *   another settle, finds the target where the stop's read did and the stop
 *   still holds — under WDA the settle read caught a flung row inside the
 *   viewport, "fully visible after 1 swipe", and it came to rest at y -48 to
 *   -133. A target that moved is judged from the new read like any round;
 *   one that never holds still, or a stop at the deadline, is reported with
 *   `settled: false`. A fling that carried the target across the frame —
 *   beyond its far edge, after a read saw it short of that — turns the next
 *   stroke round (`Motion.nextStroke`), instead of swiping on into
 *   exhausted content (measured: 613 → -357, then five swipes down that
 *   moved nothing), and every turn halves the reach of the strokes after it
 *   (review round 2: equal flings both ways ping-ponged to `maxSwipes`); it
 *   needs the target to stay in the tree, so a lazy list gets no turn. A
 *   failure counts the turns, and one after the target was in the frame
 *   says so rather than "never".
 * - Exhausted off the frame (`UNMOVED_STROKES_EXHAUST`, `Motion.observe`): a
 *   target in the tree, off the frame, with a non-zero rect, that two
 *   identical strokes in a row left — with every other match — where it was,
 *   fails then, with the stop bound's words (they name the keyboard and the
 *   remedy), cause "the last 2 … did not move it: content exhausted, or the
 *   swipes were not taken" — measured on Android, the form's last field
 *   under the IME swiped for the whole 15 s. The `fully: true` clipped
 *   stop's stuck test takes the same two identical strokes (review round 2;
 *   it watches the judged match alone — a visible clipped match that does
 *   not move is the defect it reports). For both, only strokes count: a
 *   confirming read sent none.
 *
 * The floating keyboard (docs/bugs/2026-10-05-android-floating-gboard-
 * keyboard.md, inferred): on a failed stop, and on a `fully: true` stop —
 * where the answer changes what the reader does next — a window reading
 * `hidden` is checked once against the input method (`keyboardUnlocated`);
 * when it says shown, the report says the keyboard could not be placed.
 * Nothing is judged against it — there is no frame — and nothing is
 * pressed. Not on a default clean stop (review 2026-10-08: a witness query
 * on every one buys a sentence nobody acts on).
 */
export async function scrollUntilVisible(
  adapter: DeviceAdapter,
  target: Target,
  opts: ScrollOptions = {},
): Promise<ScrollUntilResult> {
  const direction = opts.direction ?? 'down';
  const maxSwipes = opts.maxSwipes ?? DEFAULT_MAX_SWIPES;
  const fully = opts.fully === true;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SCROLL_TIMEOUT_MS;
  const settleMs = opts.settleMs ?? 400;
  const describe = describeTarget(target);
  // The device's screen, read before the loop, so a device whose screen
  // cannot be read fails here rather than as "never intersected".
  const asBuilt = await adapter.viewport();
  // The visibility reference frame (2026-10-08, review of the off-screen tap
  // refusal, M2): `judgingScreen` over this round's tree — the tap's screen
  // owner too (resolve.ts#tapScreen), so a stop the scroll calls visible is
  // judged on the screen the next tap is judged on, by construction: the
  // box (turned in landscape as the stroke already was; what a failure
  // quotes) and the boxes that count (`ScreenBox.boxes`: either way up only
  // when a turn is suggested but not witnessed — a walked width, an
  // unreliable landscape window; never on a portrait tree that suggests no
  // turn, where a carousel item past the right edge must make the scroll
  // swipe). Until then it was `viewport()` as built: in landscape a button
  // at y 500 of a 874x402 window was "fully visible" on a 402x874 panel and
  // the tap after it refused. A round whose tree did not read, or that has
  // no box at all (a 0×0 device and no window), keeps the last frame — the
  // device as built until a round had one. The keyboard cover is cut from the box as chosen: a
  // band is in the tree's coordinates, and above it is the box's width.
  let frame: JudgingScreen = { box: { x: 0, y: 0, ...asBuilt }, boxes: [{ x: 0, y: 0, ...asBuilt }] };
  const frameOf = async (read: TreeRead): Promise<JudgingScreen> => (await judgingScreen(adapter, read)) ?? frame;

  const deadline = Date.now() + timeoutMs;
  let lastFound: UiNode[] = [];
  let everFound = false;
  let treesRead = 0;
  let lastReadError: Error | undefined;
  // How the target moved, read for read (`Motion`): a swipe that does not
  // move the element is the only honest signal that the container has
  // nothing left to scroll — "give it another swipe" against "this element
  // CANNOT be fully revealed" (a real layout defect) or "it is off the
  // frame for good" — and a stop after a stroke holds only once a read
  // finds it still.
  const motion = new Motion(direction);
  /** The last cover any round applied, and how many rounds applied one — for the failure text. */
  let lastCover: Cover | undefined;
  let coveredRounds = 0;
  /** The cover the last round whose tree READ applied — undefined when that round applied none — for the stroke of a round whose tree did not read. */
  let lastReadCover: Cover | undefined;
  /** On a failed or `fully: true` stop only: the floating row, asked of the stop round's window reading (one witness query, and only when it read hidden). */
  const unlocatedAt = async (round: SoftKeyboard | undefined): Promise<boolean> => round !== undefined && (await keyboardUnlocated(adapter, round));
  /** Spend a confirming read: settle again, send nothing, read again. */
  const settleAgain = async (): Promise<void> => {
    motion.confirming();
    await sleep(settleMs);
  };
  let swipes = 0;
  for (;;) {
    // A failed read is a miss, not a failure — see readTreeOrError.
    const read = await readTreeOrError(adapter);
    const { tree, error } = read;
    lastReadError = error;
    motion.beginRead();
    if (tree !== undefined) {
      treesRead++;
      frame = await frameOf(read);
    }
    lastFound = tree === undefined ? [] : findTarget(tree, target);
    if (lastFound.length > 0) everFound = true;
    // The keyboard this round, off this round's tree (no subject: every match
    // is judged against it, the keyboard's own exempted in `judge`).
    const reading = tree === undefined ? undefined : await readSoftKeyboard(adapter, tree);
    const viewport = frame.box;
    const offered = coverOf(reading, viewport);
    const whole = judgeOver(lastFound, frame.boxes);
    let cover: Cover | undefined;
    let best = whole;
    if (offered !== undefined && tree !== undefined) {
      const covered = judge(lastFound, viewport, { cover: offered, keyboardSide: keyboardSideNodes(tree) });
      // Moot: the round stops cleanly either way, on the same judgement — the
      // band changes nothing, and is neither asked about nor reported.
      // Otherwise the witness is asked THIS round, never remembered: a
      // scroll can hide a keyboard (a list that dismisses it on drag) and
      // leave the window state stale-shown behind it (review 2026-10-08).
      const moot = endsClean(whole, fully) && sameJudgement(whole, covered);
      if (!moot && (await keyboardCorroborated(adapter))) {
        cover = offered;
        best = covered;
      }
    }
    if (cover !== undefined) {
      lastCover = cover;
      coveredRounds++;
    }
    if (tree !== undefined) lastReadCover = cover;
    // The frames this round judged in — the screen above an applied
    // keyboard, else every box that counts — for where the target stands
    // against the far edge (`Motion.observe`, `beyondFarEdge`). A read that
    // did not read says nothing about motion: the comparisons wait for the
    // next one that does.
    const judgedFrames: Rect[] = cover?.above !== undefined ? [{ x: viewport.x, y: viewport.y, ...cover.above }] : frame.boxes;
    const observed: Observed | undefined = tree === undefined ? undefined : motion.observe(lastFound, best, judgedFrames, swipes);
    if (best !== undefined && best.visible > 0 && observed !== undefined) {
      if (!fully || best.clipped.length === 0) {
        // A stop after a stroke is reported only once a read finds the
        // target where the last one did (SETTLE_CONFIRM_READS): a fling can
        // carry it on, or out of the frame, after the settle read caught it
        // inside. A stop at 0 swipes was not stroked: reported at once.
        const verdict = motion.stopVerdict(observed, swipes, deadline);
        if (verdict === 'confirm') {
          await settleAgain();
          continue;
        }
        // Shown only when THIS stop was judged under a band the witness stood
        // by this round — never a band checked on an earlier round.
        const keyboard: ScrollUntilResult['keyboard'] =
          best.under !== undefined
            ? { state: 'shown', frame: best.under.band }
            : fully && (await unlocatedAt(reading?.keyboard))
              ? { state: 'unlocated' }
              : undefined;
        return {
          swipes,
          visible: best.visible,
          clipped: best.clipped,
          ...(keyboard !== undefined && { keyboard }),
          ...(verdict === 'unsettled' && { settled: false as const }),
        };
      }
      // fully: true and still clipped — only a swipe that MOVES it can help.
      if (observed.stuck) {
        const n = swipesText(swipes);
        // Clipped at the keyboard's edge at the end of the content: the
        // keyboard, not the layout, is what hides the rest — a container that
        // does not resize for it keeps its last rows under it. Said as such,
        // with how to hide it; the layout-defect wording only when the
        // keyboard is not the edge in question.
        if (best.under !== undefined && best.clipped.includes('bottom')) {
          throw new Error(
            `scroll_until ${describe} failed after ${n} — element is in the viewport but ` +
              `${describeClip(best.clipped, best.visible, best.under.band)}, and the content is exhausted: swiping ${motion.lastStroke} ` +
              `no longer moves it. The soft keyboard covers the rest — ${hideToJudgeWholeScreen(best.under.remedy)}; only if it ` +
              `stays clipped with the keyboard down is it a layout defect. ` +
              `Last rect ${JSON.stringify(best.node.rect)} in a ${viewport.width}x${viewport.height} viewport`,
          );
        }
        throw new Error(
          `scroll_until ${describe} failed after ${n} — ` +
            `element is in the viewport but ${describeClip(best.clipped, best.visible, best.under?.band)}, ` +
            `and the content is exhausted: swiping ${motion.lastStroke} no longer moves it. ` +
            `The element cannot be fully revealed — that is a layout defect ` +
            `(no clearance for an overlay?), not a scroll that needs more swipes. ` +
            `Last rect ${JSON.stringify(best.node.rect)} in a ${viewport.width}x${viewport.height} viewport`,
        );
      }
    }
    // A confirming read that did not read: read again, within the same
    // budget, rather than stroke away from a stop the last read saw.
    if (motion.confirmingRead && tree === undefined && motion.mayConfirm(deadline)) {
      await settleAgain();
      continue;
    }
    // A keyboard that leaves nothing above it: nothing but its own UI can be
    // judged, and no stroke can start on the content — fail now, naming it,
    // rather than swipe on keys (review 2026-10-08: until then this fell
    // back to the whole screen and reported a bare "fully visible").
    // The absence rule holds here too (review 2026-10-08): a target no read
    // has matched is ElementNotFoundError through `absenceError`, so an
    // `optional:` step is skipped "(not present)" — with the keyboard named,
    // since no swipe could look further.
    if (cover !== undefined && cover.above === undefined) {
      const seenAs = everFound ? 'the element is in the tree but under the soft keyboard' : 'element never appeared in the tree';
      throw absenceError(
        `scroll_until ${describe} failed after ${swipesText(swipes)} — ${seenAs}; the soft keyboard over ` +
          `${frameText(cover.band)} covers the whole screen, so nothing under it can be judged and no swipe was sent — ` +
          hideToJudgeWholeScreen(cover.remedy),
        { sighted: everFound, treesRead, readError: lastReadError },
      );
    }
    // In the tree, off the frame, and the last UNMOVED_STROKES_EXHAUST
    // strokes — the same stroke — moved no match (2026-10-08, the Android
    // device check: the form's last field, wholly under an IME its
    // container does not resize for, swiped for the whole 15 s): fail now
    // with the stop bound's own words — they already name the keyboard and
    // the way to hide it. See `Motion.observe` for what counts.
    const exhausted = observed?.exhausted === true;
    if (exhausted || swipes >= maxSwipes || Date.now() >= deadline) {
      const partial =
        best !== undefined && best.visible > 0
          ? `element reached the viewport but stayed ${describeClip(best.clipped, best.visible, best.under?.band)} ` +
            `(last rect ${JSON.stringify(best.node.rect)})`
          : undefined;
      // In the frame on an earlier read and not on this one: "never" would
      // be false (review round 1) — a fling carried it off, or a lazy list
      // dropped it once it scrolled away.
      const left = motion.inFrameAfter;
      const offFrame = `the ${frameWords(viewport, cover)}${frame.boxes.length > 1 && cover?.above === undefined ? ' either way up' : ''}`;
      const why =
        lastReadError !== undefined
          ? `last UI tree read failed: ${lastReadError.message}`
          : partial !== undefined
            ? partial
            : lastFound.length === 0
              ? left !== undefined
                ? `element was in the viewport ${whenInFrame(left)} but did not stay — it is no longer in the tree (a fling carried it off? a lazy list drops what scrolls away)`
                : 'element never appeared in the tree'
              : left !== undefined
                ? `element was in the viewport ${whenInFrame(left)} but did not stay (a fling?) — in tree, off ${offFrame} at the last read ` +
                  `(last rect ${JSON.stringify((best?.node ?? lastFound[0]).rect)})`
                : `element in tree but never intersected ${offFrame} ` + `(last rect ${JSON.stringify((best?.node ?? lastFound[0]).rect)})`;
      const cause = exhausted
        ? `after ${swipesText(swipes)} (the last ${UNMOVED_STROKES_EXHAUST}, swiping ${motion.lastStroke}, did not move it: content exhausted, or the swipes were not taken)`
        : swipes >= maxSwipes
          ? `after ${swipes} swipes (maxSwipes)`
          : `after ${timeoutMs}ms (timeout)`;
      const turned =
        motion.turns > 0
          ? `. It was turned round ${motion.turns} time${motion.turns === 1 ? '' : 's'}: a swipe carried it past the viewport (a fling), so the next was drawn the other way`
          : '';
      // The keyboard, when any round applied one: the reader must not take a
      // scroll that worked around it — or one it hid the element under — for
      // a wrong selector (the bug note's 15 s "never appeared"). And the
      // floating row, asked of the last round's reading whatever came before.
      const shown =
        lastCover !== undefined
          ? `. The soft keyboard was up over ${frameText(lastCover.band)} in ${coveredRounds} of the ${treesRead} rounds read: ` +
            `in those, visibility was judged, and the swipe drawn, in the screen above it — ${hideToJudgeWholeScreen(lastCover.remedy)}`
          : '';
      const unlocated = (await unlocatedAt(reading?.keyboard))
        ? `; ${UNLOCATED_KEYBOARD} — the swipes may have landed on it; hide or dock it and scroll again`
        : '';
      const message = `scroll_until ${describe} failed ${cause} — ${why}${turned}${shown}${unlocated}`;
      throw absenceError(message, { sighted: everFound, treesRead, readError: lastReadError });
    }
    // Toward the caller's direction, or back after a fling past the target,
    // the reach halved per turn so the scroll converges (`Motion.nextStroke`).
    const { toward, reach } = motion.nextStroke();
    // The gesture's box is swipe.ts#screenBox's — the same owner as a
    // `swipe:` step's, oriented by this round's tree (after a failed read:
    // the device box as built; its note is not reported here, the stop
    // already quotes the read error). Worked out per swipe because the
    // round's tree is the witness; the device size is memoized. A 0×0
    // viewport does not throw above (pre-existing): the stroke then falls
    // back to the tree's window while the stop still judges against 0×0.
    // `toward` names where the CONTENT lies — the finger moves the other
    // way (content below → finger up). See swipeVector. Under an applied
    // cover the stroke is `swipeVectorAbove` (2026-10-08, the iOS device
    // check): the uncovered box's stroke, its touch-down never inside the
    // keyboard clearance nor higher than without a keyboard — the stroke
    // over the box above it alone touched down in the app's top bar for a
    // content-up scroll. A round whose tree did not read has no reading of
    // its own and keeps the cover of the last round that DID read — none if
    // that round applied none — rather than stroke through the keyboard it
    // last saw.
    const { box } = await screenBox(adapter, read);
    const strokeCover = tree === undefined ? lastReadCover : cover;
    const drawn = strokeCover === undefined ? swipeVector(box, toward, 'content') : swipeVectorAbove(box, strokeCover.band.y, toward, 'content');
    const stroke = shortenStroke(drawn, reach);
    await adapter.swipe(stroke.from, stroke.to);
    swipes++;
    motion.stroked(toward, stroke);
    await sleep(settleMs);
  }
}

const rectsEqual = (a: Rect, b: Rect): boolean =>
  Math.abs(a.x - b.x) < 1 &&
  Math.abs(a.y - b.y) < 1 &&
  Math.abs(a.width - b.width) < 1 &&
  Math.abs(a.height - b.height) < 1;
