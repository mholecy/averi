import type { ClippedSide, Rect } from '../adapters/types.js';
import { drawOrderFound } from '../ui-tree/cover.js';
import { axisOfEdge, rectIntersection, type Edge, type QuotedNode } from '../ui-tree/geometry.js';
import { SIDES } from '../ui-tree/sides.js';
import type { Since } from './motion-ledger.js';
import type { Judged } from './scroll-read.js';
import { axisOf, OPPOSITE, type Direction } from './swipe.js';

/**
 * THE COURSE: which way and how far the next stroke of one `scroll_until` run goes. The round
 * (interact/scroll-rounds.ts#round) holds one, shows it where the target stands on each read that read, asks it for the
 * next stroke, tells it what was sent, and reads what a stop or a failure needs of it — none of its memory else. What
 * the stroke touches down on and the box it is drawn over are the stroke plan's (interact/stroke-plan.ts), and so is
 * the carry model that may cut the reach (stroke-plan.ts#carried: measured per scroll view the plan chose, in points of
 * the stroke it draws there); whether anything moved is the motion ledger's (interact/motion-ledger.ts); the protocol
 * and the order of the stops stay the round's.
 *
 * The interface, which is also the test surface (tests/interact/course.test.ts):
 * - `startCourse(direction)` — the caller's way, nothing seen, nothing sent.
 * - `seeTarget(course, sighting)` — once per read that read: where the target stands (`Sighting`: the judged match,
 *   its frames, the edge the ledger holds its stop at); answers whether the read answers the stuck turn's stroke back.
 * - `nextStroke(course)` — the way (the caller's; back after a fling carried the target past or a lazy list dropped
 *   it; back once when it is stuck; the end turn's after it), the reach (halved by each turn) and what the target still
 *   needs of the stroke (LV5's window, the carry model's to apply).
 * - `sent(course, { toward, turn })`, `probeSent(course, toward)` — a course stroke sent (`nextStroke`'s way and
 *   turn), or the flush check's probe (`probeOf`: its way and reach).
 * - `stuckTurn(course, …)`, `turnBack(course, on)` — the stuck turn's way and its stroke back.
 * - `turnAtEnd(course, …)` — the end turn (`EndTurn`), one transition.
 * - `lastSent`, `courseFacts` — what the motion ledger's read, the stops and the failures read.
 *
 * Its geometry is relative to a direction: the FAR edge a scroll moves content out through and the NEAR one it comes
 * in by (`FAR_EDGE`), whether a target lies beyond the far edge (`beyondFarEdge`, `beyondFarEdgeIn`, of the
 * `FarFacts` a judged match gives, `farFacts`), whether a cover lies over its far side (`overFarSide`), and what it
 * still needs of a stroke to reach its window (`stillNeeds`).
 *
 * Pure: no adapter, no clock, no I/O.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * THE END TURN (the owner's decision of 2026-10-17, lab note LV4, below;
 * docs/adr/0021-scroll-until-turns-once-at-a-proven-end.md): the strokes went the caller's way first and the read after
 * one of them proved the content exhausted that way — the stroke moved no match, and the tree shows the content of the
 * scroll view it went over ENDING at the edge that way (scroll-rounds.ts#Observed.ends, interact/stroke-plan.ts#strokedContent) — while
 * the tree places the target wholly past the OPPOSITE (far) edge of that same scroll view, inside it. Then the strokes
 * turn ONCE toward the target, at full reach (no fling carried it past: it was never near), and every reply and failure
 * says so (the proof — the caller's way, the scroll view named, the strokes that moved nothing — `to`, and the swipes
 * sent `after` which). Measured (the lab app's `scroll-bounded`, WDA): `direction: "up"` for F at content y 1380 of
 * `lower` (0,380 402x180) at its top stroked up three times, moved nothing and failed advising `down`.
 *
 * Until then a target never sighted short of the far edge was "the caller's direction to honour" (`beyondFarEdgeIn`,
 * `nextStroke`): nothing is guessed from a screen no stroke changed. The decision refines that rule, it does not drop
 * it: the caller's direction is still stroked first; the turn needs PROOF from the reads — strokes that changed
 * nothing are no proof on their own (they may not have been taken: scroll-rounds.ts#UNMOVED_STROKES_EXHAUST), the tree's own listing
 * of where the content ends is — and a tree that lists the target past that scroll view's far edge, which is no
 * guess either. Why turn rather than fail with the advice: the reply already knew the way, and a caller who asked the
 * wrong way gets the row at the cost of the one stroke that proved it.
 *
 * Decidable on WDA's trees only (unclipped frames: ui-tree/geometry.ts#Clips.contentToward). Not on uiautomator's: its rects
 * are cut to the scroll container, so where the content ends is not listed — content past the edge reads flush with
 * it, or (Compose) is not listed at all — and the reads can prove the end only by strokes that changed nothing, which
 * a stroke not taken also does; so Android keeps the caller's direction and fails with the advice, as before. Nor on
 * idb's flat list, which lists no scroll view (lab note LE2): the strokes go over the screen, and the failure names the
 * side as before.
 * docs/bugs/2026-10-17-lab-ios-scroll-until-never-turns-toward-a-target-past-the-far-edge-when-no-stroke-moved-the-list.md
 */
export interface EndTurn extends EndProof {
  /** The way the strokes went after the turn: `way`'s opposite (`way` is the caller's direction, stroked first). */
  to: Direction;
  /** The swipes sent before the turn — the caller's way, the last of them the one that proved the end. */
  after: number;
}

/**
 * THE END PROOF as a stop carries it (scroll-rounds.ts#Observed.ends; the end turn it led to, `EndTurn`, or the bound it
 * ended the scroll with, scroll-rounds.ts#BoundBy's `ends`) — one shape, said in one wording (scroll-text.ts#endText): the strokes went `way`,
 * the tree lists the content of `scrollView` ending that way, and `unmoved` of the last strokes moved nothing.
 */
export interface EndProof {
  /** The way the strokes went, and the content is exhausted. */
  way: Direction;
  /** The scroll view whose content the tree lists ending that way, as a sentence names it. */
  scrollView: QuotedNode;
  /** How many of the last strokes moved nothing (the proof's one, or more when the one before it proved nothing yet: a read still settling, a stroke the tree could not judge) — counted by scroll-rounds.ts#endProof, never more than the swipes sent. */
  unmoved: number;
}

/** The side a read found the target wholly beyond, and whether it was dumped clipped out past it (UiNode.clippedOut) rather than read past it on the screen. */
export interface PastSide {
  side: Edge;
  clippedOut: boolean;
}

/**
 * The REACH of the flush check's probe (scroll-rounds.ts#flushCheck has when a stop is probed, and over what): a
 * quarter of the stroke — over the container, 15 % of its side (swipe.ts#SWIPE_REACH_FRACTION, 60 % of the side,
 * × 0.25) — and never more than PROBE_MAX_TRAVEL_FRACTION of the screen's long side: 178 px on the Pixel_3a, more than
 * the 51 px the SWIFT form's Fees row was cut by; a cut larger than that is left flush again and probed again. Short so
 * it cannot carry the row out of a container of any ordinary height.
 * docs/bugs/2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container.md
 */
const PROBE_REACH = 0.25;

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
const PROBE_MAX_TRAVEL_FRACTION = 0.08;

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
 * inside the frame. A plain stop does not stop on it (scroll-read.ts#stops), so without
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

/**
 * What `beyondFarEdgeIn` reads of a match: its rect, the side it was dumped clipped out past, the edge its scroll
 * container cuts it to a sliver at, and the frame its scroll views draw it in (ui-tree/standing.ts#StandingFacts.drawn,
 * on every tree that lists ancestry). And what `stillNeeds` reads: whether that frame is the WINDOW a row moves through
 * as the content does (`listedWhereItLies`, ui-tree/standing.ts#StandingFacts.listedWhereItLies: on a tree that lists
 * the match where it lies, WDA's) — the one dialect on which a stroke's carry can be measured. Not on Android's: its
 * rects are cut to the scroll container where uiautomator cuts them (most rows; lab note LE1's are the exception, not
 * the rule), so a row's motion as it comes in reads short, and its strokes drag at `dragSpeed`, no fling, with
 * nothing to carry.
 * docs/bugs/2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md
 */
interface FarFacts {
  readonly rect: Rect;
  readonly clippedOut?: ClippedSide;
  readonly slicedAt?: Edge;
  readonly drawn?: Rect;
  readonly listedWhereItLies?: true;
}

/** A judged match's `FarFacts`, its rect copied. */
const farFacts = ({ node, standing: { facts } }: Judged): FarFacts => ({
  rect: { ...node.rect },
  ...(node.clippedOut !== undefined && { clippedOut: node.clippedOut }),
  // A container's cut only: the rest of a node cut by a node drawn after it lies under that node, not past the far edge (geometry.ts#Cut.by).
  ...(facts.sliver !== undefined && facts.sliver.by === undefined && { slicedAt: facts.sliver.edge }),
  ...(facts.drawn !== undefined && { drawn: { ...facts.drawn } }),
  ...(facts.listedWhereItLies === true && { listedWhereItLies: true as const }),
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
  const vertical = axisOfEdge(far) === 'vertical';
  // Along the scroll: [lo, hi) of the target in the frame and of the cover; across it, the target's span must lie in the cover's.
  const [lo, hi] = vertical ? [inFrame.y, inFrame.y + inFrame.height] : [inFrame.x, inFrame.x + inFrame.width];
  const [from, to] = vertical ? [cover.y, cover.y + cover.height] : [cover.x, cover.x + cover.width];
  const across = vertical
    ? cover.x <= inFrame.x && cover.x + cover.width >= inFrame.x + inFrame.width
    : cover.y <= inFrame.y && cover.y + cover.height >= inFrame.y + inFrame.height;
  // Some of it past the cover's far edge, the rest under the cover through to its near end.
  return across && (far === 'top' || far === 'left' ? lo < from && hi > from && hi <= to : hi > to && lo < to && lo >= from);
}

/** What the target still needs of a stroke (`stillNeeds`): the distance to its window's middle, and how far the window lets it travel while whole in it — the carry model's to apply (stroke-plan.ts#carried). */
export interface StillNeeds {
  readonly needs: number;
  readonly slack: number;
}

/**
 * What the target STILL NEEDS of a stroke toward `toward` (lab note LV5; the carry model that turns it into a stroke is
 * interact/stroke-plan.ts#carried's): once it lies in the tree short of its window — past the window's near edge, the
 * side content comes in through — `needs`, the distance that brings it to the window's middle, and `slack`, how far
 * the window lets it travel while whole in it (the window's side less its own). The window is what the target's
 * scroll views draw met with every frame judged (`FarFacts.drawn`, when `listedWhereItLies`): known on WDA's trees
 * only, where an off-screen row is listed where it lies — not on Android's (its strokes drag at `dragSpeed`, no fling, and its rects are cut to the
 * scroll container, so a row's motion as it comes in reads short) nor on idb's flat list. Undefined otherwise.
 * docs/bugs/2026-10-17-lab-ios-wda-scroll-until-overshoots-a-row-of-a-short-scroll-view-and-spends-its-budget.md
 */
function stillNeeds(found: FarFacts & { frames: readonly Rect[] }, toward: Direction): StillNeeds | undefined {
  if (found.drawn === undefined || found.listedWhereItLies !== true) return undefined;
  const window = found.frames.reduce<Rect | undefined>((w, f) => (w === undefined ? undefined : rectIntersection(w, f)), found.drawn);
  if (window === undefined) return undefined;
  const { rect } = found;
  const vertical = axisOf(toward) === 'vertical';
  // Along the scroll: how far past the window's near edge the target's far end lies, and the room the window leaves it.
  const [lo, len, wLo, wLen] = vertical ? [rect.y, rect.height, window.y, window.height] : [rect.x, rect.width, window.x, window.width];
  const need = toward === 'down' || toward === 'right' ? lo + len - (wLo + wLen) : wLo - lo;
  const slack = Math.max(0, wLen - len);
  return need <= 0 ? undefined : { needs: need + slack / 2, slack };
}

declare const opaque: unique symbol;

/** The course — opaque: only this module reads it (the fields are `Memory`'s). */
export interface Course {
  readonly [opaque]: 'course';
}

/** Everything the course remembers between reads, one record with one writer (this module). */
interface Memory {
  /** The caller's direction: where the content lies, stroked first. */
  readonly direction: Direction;
  /** The end turn, once made (`EndTurn`: at most one a scroll) — the course's direction after it (`courseOf`). */
  readonly endTurn: EndTurn | undefined;
  /** Some read saw the target SHORT of the far edge (`beyondFarEdge`) — so a later read beyond it means a fling carried it across. */
  readonly seenShort: boolean;
  /**
   * The last read that READ found the target beyond the far edge, after an
   * earlier read saw it short of it — or, on any read, in the frame at that
   * edge (`seeTarget`'s `atFarEdge`): the next stroke turns. Kept across a
   * read that failed — that round strokes as the last read round decided,
   * as it keeps that round's keyboard line (stroke-plan.ts#seeRead); cleared by a read
   * that does not find the target — whether to turn then is `dropped`'s
   * question.
   */
  readonly carriedPast: boolean;
  /**
   * The far edge of the caller's direction when the last read that found
   * the target found it wholly beyond it — dumped clipped out past it, or
   * past it in every frame, nothing of it in the frame (Settings' `Apps`
   * clipped out above the list, four strokes down, read "off the viewport,
   * or under the soft keyboard … (a fling?)" without it) —
   * undefined when that read had it anywhere else. Kept across reads that
   * do not find it: the failure's `past` (`courseFacts`, scroll-rounds.ts#shortfall).
   */
  readonly lastPast: PastSide | undefined;
  /** The last read that read: the judged match's far facts and the frames it was judged in — undefined when it found no match. */
  readonly lastFound: (FarFacts & { frames: readonly Rect[] }) | undefined;
  /**
   * The target was dropped from the tree by the content's motion — the
   * last read had it short of the far edge of that motion, this one has no
   * match — so the strokes go this way, back, until a read finds it again
   * (`nextStroke`). Not cleared by a read without the target: it is still
   * beyond the edge it left through.
   */
  readonly dropped: Direction | undefined;
  /**
   * The stuck turn (`stuckTurn`, scroll-rounds.ts#round's): the
   * direction the target was stuck in when, the other way never stroked,
   * ONE stroke was drawn back instead of failing — set once, never cleared;
   * once only, as after it both ways were stroked (`strokedToward`). `backPending`: that stroke is decided — sent, or
   * held for a presented screen's confirming read at its touch-down (scroll-rounds.ts#round) — and no read that read after it was
   * sent has answered it yet.
   */
  readonly stuckOn: Direction | undefined;
  readonly backPending: boolean;
  /** The directions the scroll's course strokes were drawn toward (a probe's aside) — whether the other way was ever tried, for the stuck turn and the failure's `past`. */
  readonly strokedToward: readonly Direction[];
  /**
   * Where the content lay for the last stroke sent: the caller's direction, or its opposite after a fling past the target.
   * For "swiping … no longer moves it". The end turn sets it too, with no stroke sent (`turnAtEnd`): the stroke after it
   * is then no turn, so it keeps its reach and is not counted (ADR 0021 d1).
   */
  readonly lastStroke: Direction;
  /** The direction of the last stroke SENT, a probe included — the way the content last moved, for `dropped`. */
  readonly lastSent: Direction | undefined;
  /** Direction changes — a stroke drawn the other way from the one before — for the shortening and the failure text. */
  readonly turns: number;
  readonly strokesSent: number;
}

const open = (course: Course): Memory => course as unknown as Memory;
const close = (m: Memory): Course => m as unknown as Course;

/**
 * The COURSE's direction — where the content lies for the scroll: the caller's (`Memory.direction`) until the end turn,
 * its opposite after (`EndTurn.to`). What the far edge, the fling's turn and the strokes are judged against.
 */
const courseOf = (m: Memory): Direction => m.endTurn?.to ?? m.direction;

/** The course before the first read: the caller's way, nothing seen, nothing sent. */
export function startCourse(direction: Direction): Course {
  return close({
    direction,
    endTurn: undefined,
    seenShort: false,
    carriedPast: false,
    lastPast: undefined,
    lastFound: undefined,
    dropped: undefined,
    stuckOn: undefined,
    backPending: false,
    strokedToward: [],
    lastStroke: direction,
    lastSent: undefined,
    turns: 0,
    strokesSent: 0,
  });
}

/** Where the target stands on one read that read, as the course is shown it (`seeTarget`). */
export interface Sighting {
  /** What the read followed. */
  readonly since: Since;
  /** The match the read judged best, when it found one. */
  readonly judged: Judged | undefined;
  /** The frames it was judged in (scroll-read.ts#ReadJudgement.frames). */
  readonly frames: readonly Rect[];
  /**
   * The frames short of the far edge is judged in (scroll-read.ts#ReadJudgement.uncutFrames): uncut at the navigation
   * band, so a target a stroke then pushes wholly into the band was seen short, and is turned back.
   */
  readonly uncutFrames: readonly Rect[];
  /** The edge at which the region its motion showed holds back its stop (interact/motion-ledger.ts#heldBack), if it does. */
  readonly heldBackAt?: Edge;
}

/**
 * Show the course where the target stands on a read that read (`Sighting`) — once a round, where the round records
 * motion — and answer whether this read answers the stroke back of the stuck turn (`answersBack`: a read after a
 * stroke, that stroke back pending; it is then answered). Where the target stands against the far edge is recorded
 * HERE, on every read — a stop round strokes nothing, and a target seen short only at a stop the confirming read then
 * lost must still turn the next stroke.
 */
export function seeTarget(course: Course, { since, judged, frames, uncutFrames, heldBackAt }: Sighting): { course: Course; answersBack: boolean } {
  const m: Mutable<Memory> = { ...open(course), carriedPast: false };
  // Dropped (the lazy-list note, scroll-rounds.ts#UNMOVED_STROKES_EXHAUST's): the last read had the target SHORT of the far
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
  if (judged === undefined && since !== 'start' && m.lastFound !== undefined && m.lastSent !== undefined) {
    if (!beyondFarEdgeIn(m.lastFound, m.lastSent, m.lastFound.frames)) m.dropped = OPPOSITE[m.lastSent];
  }
  m.lastFound = judged === undefined ? undefined : { ...farFacts(judged), frames };
  if (judged !== undefined) {
    const farRead = farFacts(judged);
    m.dropped = undefined;
    const way = courseOf(m);
    // In EVERY frame the round judged in: a target beyond the far edge one
    // way up but across both edges the other is not turned for. Or dumped
    // clipped out past it, or cut to a sliver at it (`beyondFarEdgeIn`).
    const beyond = beyondFarEdgeIn(farRead, way, frames);
    // Kept whatever the target showed: only a read with none of it in the
    // frame reaches the failure's `past` (`left` needs it never in the
    // frame, `offFrame` this read's match at visible 0).
    const { far } = FAR_EDGE[way];
    m.lastPast = beyond ? { side: far, clippedOut: judged.node.clippedOut === far } : undefined;
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
    // `facts.covers`, ui-tree/cover.ts#Cover.reach): CONTINUE pinned at idb's flat list reaches the
    // screen's bottom, so the row flung to 776–828 has it over its far
    // (bottom) side — its frame, 780–824, is over neither edge.
    const overFar = (cover: Rect) => frames.every((f) => overFarSide(judged.node.rect, way, cover, f));
    // Only the covers the draw order found (cover.ts#drawOrderFound), as before the overlaid edge was a cover: the overlaid
    // one (`overlaid`, known by the cut alone) lies over a target in no scroll view, and does not turn the strokes.
    // Or held back by the region its motion showed at that edge (`Sighting.heldBackAt`: in its band, or past it toward
    // chrome): under a header there, the strokes turn to bring it in, as for a target across the edge.
    const { facts } = judged.standing;
    const atFarEdge = facts.visible > 0 && (beyond || heldBackAt === far || facts.covers.some((c) => drawOrderFound(c) && overFar(c.reach)));
    m.carriedPast = (beyond && m.seenShort) || atFarEdge;
    if (!beyondFarEdgeIn(farRead, way, uncutFrames)) m.seenShort = true;
  }
  // The stroke back (`stuckOn`) is answered by the first read that reads
  // after it; a round whose tree did not read strokes as the last read
  // round decided — back. Only a read after the stroke was SENT answers it:
  // one held for a presented screen's confirming read (the touch-down stop,
  // scroll-rounds.ts#round) is still to be sent, and that read — no stroke between — would
  // otherwise read "unmoved" and say swiping back moved nothing.
  const answersBack = since === 'stroke' && m.backPending;
  if (answersBack) m.backPending = false;
  return { course: close(m), answersBack };
}

/** The next stroke of the course (`nextStroke`): where the content lies, its reach, whether it is a turn, and what the target still needs of it (`stillNeeds`). */
export interface NextStroke {
  readonly toward: Direction;
  /** 1 until the first turn, halved by each (swipe.ts#shortenStroke) — the turns' reach, which the plan's carry model may cut (stroke-plan.ts#carried). */
  readonly reach: number;
  readonly turn: boolean;
  readonly still?: StillNeeds;
}

/**
 * The next stroke (the WDA device check): toward the caller's
 * direction — unless the last read that read found a fling carried the
 * target across the frame since a read saw it short of the far edge
 * (`seeTarget`; measured 613 → -357 in one swipe, then five more swipes DOWN
 * into exhausted content). Then the other way, to bring it back; a stroke
 * that throws it back past the near edge leaves it short again, and the
 * next stroke goes the caller's way. A target read wholly beyond the far
 * edge before any read saw it short of it — above the screen on round 0 of
 * a scroll down, and every round after while it stays there — is the
 * caller's direction to honour — until a stroke that way proves the
 * content exhausted: the end turn (`EndTurn`) turns the course itself,
 * which this reads in place of the caller's direction, at full reach; one
 * any of which lies in the frame is not (`seeTarget`'s `atFarEdge`, below). That needs the target to
 * STAY in the tree once off the frame; a lazy list (Android
 * RecyclerView/LazyColumn, iOS List/UITableView under WDA) drops it, and
 * on Android its bounds never pass the list's edge anyway. A read that LOSES the target it last read short of the far
 * edge of the content's last motion turns the strokes too (`dropped`,
 * recorded by `seeTarget`): back the way the content came, until a read
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
 * (`seeTarget`'s `atFarEdge`): across that edge, its centre in the status
 * band past it, or under a cover over its far side — on the first read as
 * on any. Stroked on the caller's way, at the end of the content no stroke
 * carries it anywhere and the turn never comes — measured, `maxSwipes`, or
 * "content exhausted … a layout defect" for a row one stroke back would
 * have revealed. A target short at the NEAR edge (a pinned bar over a row
 * coming in from below) is stroked on the caller's way. A cover counts
 * only in the frame's far half (`overFarSide`). One stuck in the frame,
 * the other way never stroked, gets one stroke back before the layout
 * defect is declared (`stuckTurn`).
 */
export function nextStroke(course: Course): NextStroke {
  const m = open(course);
  const back = m.backPending && m.stuckOn !== undefined ? OPPOSITE[m.stuckOn] : undefined;
  const toward = m.dropped ?? back ?? (m.carriedPast ? OPPOSITE[courseOf(m)] : courseOf(m));
  // A turn: drawn the other way from the last stroke sent — the one test the
  // reach and the turn count share. The FIRST stroke is one too when it is
  // drawn back from a target read at the far edge in the frame (`seeTarget`):
  // the target is within one move, so it gets a turn's reach — the measured
  // 262-pt stroke that brings a row at y 20 to 563. Not one drawn back after
  // a probe dropped the target (`dropped`): no stroke of the scroll's course
  // went the other way.
  const turn = toward !== m.lastStroke && (m.strokesSent > 0 || m.dropped === undefined);
  const still = m.lastFound === undefined ? undefined : stillNeeds(m.lastFound, toward);
  return { toward, reach: 0.5 ** (turn ? m.turns + 1 : m.turns), turn, ...(still !== undefined && { still }) };
}

/** The course after `stroke` (its `nextStroke`) was sent: a turn counted, the way stroked, the last stroke's and the last sent's way. */
export function sent(course: Course, { toward, turn }: Pick<NextStroke, 'toward' | 'turn'>): Course {
  const m = open(course);
  return close({
    ...m,
    turns: turn ? m.turns + 1 : m.turns,
    strokedToward: m.strokedToward.includes(toward) ? m.strokedToward : [...m.strokedToward, toward],
    strokesSent: m.strokesSent + 1,
    lastStroke: toward,
    lastSent: toward,
  });
}

/**
 * The flush check's probe (scroll-rounds.ts#flushCheck) toward revealing `edge` of the judged match, on a screen of
 * box `screen`: its way, its reach (PROBE_REACH) and the cap on its finger travel (PROBE_MAX_TRAVEL_FRACTION of the
 * screen's long side).
 *
 * Toward the edge, never the caller's way (verified on the triage repro):
 * a row cut at the top with the default direction down stroked "down" is
 * stroked further out — and a lazy list drops it ("gone").
 */
export function probeOf(edge: Edge, screen: Rect): { toward: Direction; reach: number; maxTravel: number } {
  return { toward: SIDES[edge].reveals, reach: PROBE_REACH, maxTravel: Math.floor(PROBE_MAX_TRAVEL_FRACTION * Math.max(screen.width, screen.height)) };
}

/**
 * The course after the flush check's probe toward `toward` was sent: the way the content last moved (`dropped`'s), and
 * nothing else — not a step of the scroll's course, so the turn (`lastStroke`, `turns`, `strokesSent`) is left as it
 * was, and a probe the other way from the caller's direction is not a turn and halves no reach.
 */
export function probeSent(course: Course, toward: Direction): Course {
  return close({ ...open(course), lastSent: toward });
}

/**
 * THE STUCK TURN's course (scroll-rounds.ts#round has when it applies and what stops it): the way the target is stuck
 * on, when it is — the stroke back (`answersBack` of `seeTarget`) moved it neither (`backUnmoved`: that way, the one it
 * was stuck on before), or identical strokes left it where it was (`stuck`: the last stroke's way) — and the other way,
 * in this order: `unmoved` (the stroke back moved it neither), `outward` (the round's standing facts say a stroke the
 * other way only pushes it out through its cut edge, or further under a surface the eyes saw: `outward(on)`),
 * `stroked` (swiped earlier in the scroll, a turn), else `untried` — the one a stroke back is for. Undefined: not stuck.
 */
export function stuckTurn(
  course: Course,
  { stuck, backUnmoved, outward }: { stuck: boolean; backUnmoved: boolean; outward: (on: Direction) => boolean },
): { on: Direction; otherWay: 'unmoved' | 'outward' | 'stroked' | 'untried' } | undefined {
  const m = open(course);
  const on = backUnmoved ? m.stuckOn : stuck ? m.lastStroke : undefined;
  if (on === undefined) return undefined;
  return { on, otherWay: backUnmoved ? 'unmoved' : outward(on) ? 'outward' : m.strokedToward.includes(OPPOSITE[on]) ? 'stroked' : 'untried' };
}

/** The course after the stuck turn was decided for a target stuck `on` that way: ONE stroke back, pending until a read after it is sent answers it (`nextStroke`, `seeTarget`). */
export function turnBack(course: Course, on: Direction): Course {
  return close({ ...open(course), stuckOn: on, backPending: true });
}

/**
 * Make the end turn (`EndTurn`), when it applies: the content proven exhausted the course's way over `view` (the
 * caller's to judge: `proof`, the scroll view quoted and the strokes that moved nothing), no end turn made yet, and the
 * judged match, inside `view` (the caller's to tell), lies BEYOND its far edge for the course (`beyondFarEdge`, against
 * `view`'s frame, not the screen's) — the way no stroke the course's way can bring it, and the way the tree says it
 * lies. Then the course becomes the caller's direction's opposite for the rest of the scroll, and what the reads
 * recorded against the old far edge is read against the new one — the target, past the old far edge, lies short of
 * the new one (`seenShort`), past no far edge (`lastPast`), and carried past nothing (`carriedPast`). Not a fling's
 * turn (docs/adr/0021-scroll-until-turns-once-at-a-proven-end.md d1): `lastStroke` is set to the new course, so the
 * next stroke keeps its reach (`nextStroke`) and `turns` — the failure's "turned round N times: a fling" — does not
 * count it. Undefined: no end turn.
 */
export function turnAtEnd(course: Course, { target, view, proof, after }: { target: Rect; view: Rect; proof: Omit<EndProof, 'way'>; after: number }): Course | undefined {
  const m = open(course);
  if (m.endTurn !== undefined || !beyondFarEdge(target, courseOf(m), view)) return undefined;
  const from = courseOf(m);
  return close({
    ...m,
    endTurn: { way: from, ...proof, to: OPPOSITE[from], after },
    lastStroke: OPPOSITE[from],
    seenShort: true,
    carriedPast: false,
    lastPast: undefined,
  });
}

/** The direction of the last stroke sent, a probe included — the way the content last moved; undefined before the first. */
export const lastSent = (course: Course): Direction | undefined => open(course).lastSent;

/**
 * What a stop and a failure read of the course: the turns made (`turns`, a fling's — the end turn not counted), the way
 * of the last stroke of the course (`lastStroke`), the far edge of the course (`far`: the side a scroll that ran to the
 * end of the content never read), the side the target was last found wholly beyond (`past` — only while no stroke was
 * drawn toward revealing it: once one was — a turn — that direction was tried, and the turn's own sentence says why),
 * and the end turn, once made.
 */
export function courseFacts(course: Course): { turns: number; lastStroke: Direction; far: Edge; past: PastSide | undefined; endTurn: EndTurn | undefined } {
  const m = open(course);
  const past = m.lastPast !== undefined && !m.strokedToward.includes(SIDES[m.lastPast.side].reveals) ? m.lastPast : undefined;
  return { turns: m.turns, lastStroke: m.lastStroke, far: FAR_EDGE[courseOf(m)].far, past, endTurn: m.endTurn };
}
