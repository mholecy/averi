import { usableScreen, type DeviceAdapter, type DeviceScreen, type Rect, type Stroke } from '../adapters/types.js';
import { containsPoint, inferScreenSize, rectIntersection, SCREEN_AGREEMENT_PCT, windowTurnsScreen, type ScreenSize } from '../ui-tree/geometry.js';
import { readTreeOrError, type TreeRead } from '../ui-tree/read-tree.js';

export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * Which thing `direction` names. A `swipe:` step names the FINGER's movement
 * (swipe up = finger travels up, revealing content below), and so does the
 * MCP `swipe` tool's `direction` (since 2026-10-08; its raw from/to
 * coordinates never come through here). A
 * `scroll_until:` names where the CONTENT lies (content below the
 * fold is reached by a finger travelling up). Spelled out at every call site
 * because the two tables read as copies of each other with the rows swapped,
 * and the next person to correct one would have broken the other.
 */
export type SwipeMeaning = 'finger' | 'content';

/**
 * How far a swipe reaches from the box's centre, either side, as a fraction
 * of the box's side along the stroke — 0.3, a stroke over the middle 60%.
 * Exported so the MCP `swipe` tool's description quotes it rather than
 * restating it.
 */
export const SWIPE_REACH_FRACTION = 0.3;

/**
 * The from/to points of a swipe across `box`, `SWIPE_REACH_FRACTION` of the
 * box either side of centre. Pure; `swipeScreen` and the scroll loop both
 * call it.
 */
export function swipeVector(box: Rect, direction: Direction, meaning: SwipeMeaning): Stroke {
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);
  const dx = Math.round(box.width * SWIPE_REACH_FRACTION);
  const dy = Math.round(box.height * SWIPE_REACH_FRACTION);
  const finger = {
    up: { from: { x: cx, y: cy + dy }, to: { x: cx, y: cy - dy } },
    down: { from: { x: cx, y: cy - dy }, to: { x: cx, y: cy + dy } },
    left: { from: { x: cx + dx, y: cy }, to: { x: cx - dx, y: cy } },
    right: { from: { x: cx - dx, y: cy }, to: { x: cx + dx, y: cy } },
  } as const;
  const awayFrom = { up: 'down', down: 'up', left: 'right', right: 'left' } as const;
  return meaning === 'finger' ? finger[direction] : finger[awayFrom[direction]];
}

/**
 * `swipeVector` over `box` with a soft keyboard whose top edge lies at
 * `keyboardTop` — the stroke `scroll_until` draws while a keyboard covers
 * the bottom of the screen (interact/scroll.ts). Two facts, one owner each:
 *
 * (a) THE TOUCH-DOWN — here. A gesture belongs to the view the finger
 *     first touches; where it ends does not matter (the scroll view keeps a
 *     drag that leaves it). So only the touch-down is placed, by two rules:
 *     never inside the keyboard clearance (`keyboardClearance`: the lower
 *     point of `swipeVector`'s vertical stroke over the box the keyboard
 *     leaves — y 458 of the 572 above the WDA pad, 1118 of the 1398 above
 *     the Android IME, the touch-downs both device checks measured landing
 *     on the content), and never higher than the keyboard-less stroke's
 *     touch-down. The second rule is the 2026-10-08 iOS device check
 *     (docs/bugs/2026-10-08-scroll-until-ignores-android-soft-keyboard.md):
 *     the stroke over the box above the pad touched down for a content-UP
 *     scroll at 0.2 of 572 — y 114, in the app's top bar (≈ y 0–116) — and
 *     six swipes moved nothing; by hand `(201,114) → (201,458)` moved
 *     nothing, `(201,160) → (201,458)` moved the row. Keyboard-less it
 *     touches down at 0.2 of 874, y 175, below the bar. The clearance is
 *     also why not "just above the keyboard's edge": the measured form pins
 *     its CONTINUE bar at y 512–556 over the pad's 572, and a touch-down
 *     there drags a button.
 * (b) THE LENGTH — none of this function's business: the stroke is the one
 *     over the uncovered box (`swipeVector`), its touch-down moved by (a).
 *     The first fix's content-down stroke over that box (458 → 114 under
 *     WDA, 344 pt) flung the SwiftUI form ~730–800 pt, past its target; that
 *     is answered where it is seen — scroll-rounds.ts confirms a stop on a settled
 *     read, turns the stroke round after a fling past the target and halves
 *     its reach on every turn (`shortenStroke`) — not by a shorter first
 *     stroke here, which would be one app's fling tuned into every app's
 *     gesture (Android's 838-px stroke moved the Compose form 637 px a
 *     swipe and needed no cut).
 *
 * The strokes this gives (re-measured 2026-10-08 against the tests):
 * content down (finger up) is the uncovered box's own — iOS 458 → 114,
 * Android 1118 → 280, both as the device checks ran them; content up
 * (finger down) touches down where it would without a keyboard — iOS
 * 175 → 458, Android 444 → 1118; left/right run along the keyboard-less
 * centre line (y 437 / 1110) unless that lies inside the clearance (a
 * keyboard over more than ~37 % of the screen, unmeasured), then along the
 * clearance line.
 *
 * Fallback: when (a) leaves a vertical stroke shorter than half the
 * uncovered box's own — a content-up stroke under a keyboard over 60 % of
 * the screen or more (landscape, unmeasured), where the keyboard-less
 * touch-down comes near the clearance — the uncovered box's stroke as it
 * is: a near-zero drag is a tap, and a tap is never what a scroll should
 * send. Only `keyboardTop` — the covered area's top edge — is read, never
 * the covered rect's width or height: a floating panel need not span the
 * screen nor reach its bottom, and everything below its top is treated as
 * covered. A top near the screen's top (a floating panel dragged up,
 * unmeasured) leaves a short uncovered box, and the stroke is then that
 * box's own, as short as the box: a short drag on the content rather than
 * a stroke on the panel. `keyboardTop` must lie inside the box (the caller
 * fails before stroking when a keyboard leaves nothing above it;
 * scroll-rounds.ts#coverOf). Pure.
 */
export function swipeVectorAbove(box: Rect, keyboardTop: number, direction: Direction, meaning: SwipeMeaning): Stroke {
  const uncovered = { ...box, height: Math.min(box.height, keyboardTop - box.y) };
  const inUncovered = swipeVector(uncovered, direction, meaning);
  const keyboardLess = swipeVector(box, direction, meaning);
  const downY = Math.min(Math.max(inUncovered.from.y, keyboardLess.from.y), keyboardClearance(uncovered));
  if (direction === 'left' || direction === 'right') {
    return { from: { x: keyboardLess.from.x, y: downY }, to: { x: keyboardLess.to.x, y: downY } };
  }
  const placed = { from: { x: inUncovered.from.x, y: downY }, to: inUncovered.to };
  const reach = (s: Stroke): number => Math.abs(s.to.y - s.from.y);
  return reach(placed) < reach(inUncovered) / 2 ? inUncovered : placed;
}

/**
 * The distance a finger must travel before a scroll view takes the touch as
 * a drag rather than a tap, in tree units — ASSUMED, not measured on either
 * platform: Android's ViewConfiguration touch slop is 8 dp (22 px at the
 * Pixel_3a's 2.75 density), a UIScrollView's pan starts after ~10 pt. 24
 * covers both units with room. `shortenStroke` never draws a stroke shorter
 * than twice this, so a shortened stroke is still a drag, never a tap.
 */
export const TOUCH_SLOP = 24;

/**
 * The other floor on a shortened stroke, as a fraction of the box's side
 * along it (review round 3): TOUCH_SLOP is a fixed number in tree units,
 * points on iOS and pixels on Android, so on a dense Android panel twice it
 * is a smaller finger travel than on iOS. 3 % of the side scales with the
 * screen whatever its units: 26 pt of an 874-pt iPhone height (below the
 * 48 of the slop floor, which stands), 67 px of a 2220-px Pixel_3a height.
 */
export const MIN_STROKE_FRACTION = 0.03;

/**
 * `stroke` with its reach scaled by `factor` (0 < factor ≤ 1), its
 * touch-down kept: the end moves along the stroke toward the touch-down,
 * so whatever placed the touch-down (`swipeVectorAbove`'s rules: never in
 * the keyboard clearance, never higher than without a keyboard) still
 * holds, and the stroke still runs the same way. Never shorter than twice
 * TOUCH_SLOP nor than MIN_STROKE_FRACTION of `side` — the gesture box's
 * side along the stroke (its height for up/down, its width for
 * left/right) — and never longer than the stroke given. Used by `scroll_until`
 * to shorten the stroke after each turn round a target a fling carried past
 * (interact/scroll-rounds.ts#nextStroke), so the distance left shrinks
 * however far the app flings. Pure.
 */
export function shortenStroke(stroke: Stroke, factor: number, side: number): Stroke {
  const dx = stroke.to.x - stroke.from.x;
  const dy = stroke.to.y - stroke.from.y;
  const reach = Math.hypot(dx, dy);
  if (factor >= 1 || reach === 0) return stroke;
  const floor = Math.max(2 * TOUCH_SLOP, side * MIN_STROKE_FRACTION);
  const k = Math.min(reach, Math.max(reach * factor, floor)) / reach;
  return { from: stroke.from, to: { x: Math.round(stroke.from.x + dx * k), y: Math.round(stroke.from.y + dy * k) } };
}

/**
 * The stroke `scroll_until` draws for one of its `stroke` steps
 * (interact/scroll-rounds.ts#RoundStep): over `box` — the box the round
 * DECIDED (`strokeRoom`: the target's scroll container met with the
 * screen, above a keyboard, or the screen whole) — toward `toward` (where
 * the content lies), clear of a cover whose top edge is `coverTop`
 * (`swipeVectorAbove`: a keyboard's, or a node's drawn over the container,
 * `strokeRoom` — the same rule for both, everything below the top covered), its reach scaled by `reach` (`shortenStroke`, along
 * the box's side along the stroke). Why a container (2026-10-09, measured,
 * docs/bugs/2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-
 * scroll-container.md, the triage of it): Settings' list is
 * [0,737][1080,2154]; the screen box's content-up stroke touches down at y
 * 444, in the header above the list, and a probe drawn there moves nothing —
 * which the flush check would take for "nothing beyond the edge"; over the
 * list it touches down at 1021 and its length is the list's, not the
 * screen's. `maxTravel`, when set, caps the finger's travel (the probe's,
 * scroll-rounds.ts#PROBE_MAX_TRAVEL_FRACTION), never below `shortenStroke`'s
 * floors.
 *
 * It judges nothing (deep/r3-scroll, 2026-10-09): until then it took the
 * container and met it with the screen itself, above the keyboard, and fell
 * back to the screen when that left no room — while the round had judged
 * the room over the screen with no keyboard, so a probe the round believed
 * had room was drawn off its container under the IME, moved nothing, and was
 * reported checked. Pure; the driver's one call (interact/scroll.ts) and
 * the test adapter's (tests/helpers/rounds.ts#drawnFor).
 */
export function scrollStroke(step: { toward: Direction; reach: number; coverTop?: number; box: Rect; maxTravel?: number }): Stroke {
  const { toward, reach, coverTop, box, maxTravel } = step;
  const side = toward === 'up' || toward === 'down' ? box.height : box.width;
  const vector = coverTop === undefined ? swipeVector(box, toward, 'content') : swipeVectorAbove(box, coverTop, toward, 'content');
  const stroke = shortenStroke(vector, reach, side);
  const travel = strokeLength(stroke);
  return maxTravel === undefined || travel <= maxTravel ? stroke : shortenStroke(stroke, maxTravel / travel, side);
}

/** How far a stroke's finger travels, touch-down to lift-off. */
export const strokeLength = ({ from, to }: Stroke): number => Math.hypot(to.x - from.x, to.y - from.y);

/**
 * The smallest side, along the stroke, of a box a scroll stroke may be
 * drawn in: `swipeVector` strokes over SWIPE_REACH_FRACTION of the side
 * either way of the centre (60 % of it), so under this the full stroke is
 * shorter than twice TOUCH_SLOP — and `shortenStroke` never lengthens, so
 * its floor would not hold: the "stroke" is a tap (code review of
 * fix/r3-scroll, 2026-10-09: a carousel cut by the list's bottom to a 30-px
 * strip gave a probe (540,1972)→(540,1954), 18 px, a tap on the card, and
 * "moved nothing" was then reported as checked). 80.
 */
export const MIN_STROKE_BOX = Math.ceil((2 * TOUCH_SLOP) / (2 * SWIPE_REACH_FRACTION));

/**
 * The box a scroll stroke toward `toward` is drawn in over `within` (a
 * clipping container): `within` met with the gesture `box`, when what they
 * share — above `coverTop`, for a vertical stroke under a cover — is at
 * least MIN_STROKE_BOX along the stroke; undefined otherwise. Pure; the one
 * judgement of room, asked through `strokeRoom`.
 */
export function strokeBox(box: Rect, within: Rect, toward: Direction, coverTop?: number): Rect | undefined {
  const met = rectIntersection(box, within);
  return met === undefined ? undefined : roomIn(met, toward, coverTop);
}

/** `met` — a container already met with the gesture box — when it is at least MIN_STROKE_BOX along the stroke above `coverTop`; `strokeBox`'s rule, for `strokeRoom`, which has met them once already. */
function roomIn(met: Rect, toward: Direction, coverTop?: number): Rect | undefined {
  const side = toward === 'up' || toward === 'down' ? Math.min(met.y + met.height, coverTop ?? Number.POSITIVE_INFINITY) - met.y : met.width;
  return side >= MIN_STROKE_BOX ? met : undefined;
}

/**
 * What `strokeRoom` decides: the candidate container (`within`, as the tree
 * gives it), the box the stroke is drawn in, and the top edge of what
 * covers that box's lower part, when something does.
 */
export interface StrokeRoom {
  within: Rect;
  box: Rect;
  coverTop?: number;
}

/**
 * THE STROKE BOX's one owner (deep/r3-scroll, 2026-10-09): the first of
 * `candidates` — clipping containers, nearest first — that leaves room for a
 * stroke toward `toward` over the gesture `box` (`screenBox`'s, the box the
 * driver draws in), above a keyboard whose top edge is `coverTop`
 * (`strokeBox`: the container ∩ the screen ∩ above the keyboard, at least
 * MIN_STROKE_BOX along the stroke): `within`, the candidate as the tree
 * gives it, `box`, what the stroke is drawn in, and `coverTop`, the top
 * edge of what covers that box's lower part — the keyboard's, or a node's
 * drawn over the container (`overlayTop`), the higher of the two — for the
 * stroke to keep clear of (`scrollStroke`); absent when nothing does.
 * Undefined is NO ROOM:
 * what the caller does then is its own — scroll-rounds.ts reports a probe
 * `flush.why: 'room'` and sends none, and draws a stroke toward the target
 * over the screen whole, the stroke as it was before 2026-10-09. Until
 * deep/r3-scroll the round judged room over the screen and the driver again
 * above the keyboard, falling back to the screen; one judgement now, the
 * keyboard in it. No gesture `box` at all (screenBox threw): no room.
 *
 * `over` gives the rects drawn over a candidate (ui-tree/draw-order.ts
 * #drawnOver, through scroll-rounds.ts#TreeFacts, or as a remembered
 * container carries them, scroll-rounds.ts#StrokeContainer) — the floating tab bar
 * of 2026-10-09 (docs/bugs/2026-10-09-android-scroll-stroke-touches-down-
 * on-floating-tab-bar.md): the list `0,825 1080x1395` ran under the bar's
 * host `66,1840 948x248`, the content-down stroke over it touched down at
 * 0.8 of the list, y 1942, on the bar, and the list never moved. Cut above
 * the host it touches down at 1638 (measured: ≤ ~1800 scrolls the list).
 * One judgement for every stroke: the room, the strokes toward the target
 * and the `fully: true` probe all come here. Pure.
 */
export function strokeRoom(
  box: Rect | undefined,
  candidates: readonly Rect[],
  toward: Direction,
  coverTop?: number,
  over?: (within: Rect) => readonly Rect[] | undefined,
): StrokeRoom | undefined {
  if (box === undefined) return undefined;
  for (const within of candidates) {
    const met = rectIntersection(box, within);
    if (met === undefined) continue;
    const drawn = overlayTop(met, over?.(within) ?? [], toward, coverTop);
    const top = drawn === undefined ? coverTop : Math.min(drawn, coverTop ?? drawn);
    const room = roomIn(met, toward, top);
    if (room !== undefined) return { within, box: room, ...(top !== undefined && { coverTop: top }) };
  }
  return undefined;
}

/**
 * The top edge of the highest of `over` — nodes drawn over a stroke
 * container — that the container's stroke box `box` must be cut above
 * for a stroke toward `toward` (2026-10-09, the floating tab bar:
 * `strokeRoom`), or undefined. `box` is judged as the stroke is drawn:
 * above a keyboard whose top edge is `coverTop`, when one is up (code
 * review of fix/r4, P3 — the list `0,825 1080x1395` under a keyboard at
 * 1300 with a bar `0,1150 1080x150` sitting on it: the bar's top is above
 * the LIST's centre, 1522, so the cut stayed 1300 and the touch-down, 1206,
 * landed on the bar; above the keyboard the box is 825–1300 and the bar
 * lies in its lower half). Only a CONTENT-DOWN stroke is cut: it
 * touches down at 0.8 of the box, in its lower half, and the touch-down is
 * all that matters (a gesture belongs to the view the finger first
 * touches, `swipeVectorAbove`); a content-up stroke touches down at 0.2
 * and only lifts off down there, so a cut would only take a third of its
 * reach (1104 → 1942 would become 1104 → 1638 under the measured bar, more
 * strokes against the 15 s budget) for nothing — review round 1. A
 * sideways stroke is not cut either: its touch-down lies off the centre
 * line on the box's middle row, which this rule does not model (a
 * carousel under a bar: unmeasured).
 *
 * The node cut for is one that the STROKE'S LINE crosses (its rect spans
 * x = the box's centre, where `swipeVector` draws a vertical stroke — a
 * FAB in the corner takes no touch-down, and cutting for it would only
 * shorten the stroke) and whose TOP lies in the box's LOWER HALF, below
 * its centre and above its bottom (the keyboard's top, when one is up),
 * where the touch-down is. Everything
 * below that top is then treated as covered, the keyboard's rule
 * (`swipeVectorAbove`): its width and height are not read — the measured
 * bar's host is 948 of 1080 wide and stops 132 px above the screen's
 * bottom, so "spans the box" or "reaches its bottom" would both have
 * missed it. The lower half and no higher: a cut there leaves at least
 * half the box, so the stroke keeps a list's length, never a sliver's.
 *
 * And then a node over the TOUCH-DOWN, wherever its top lies (2026-10-09,
 * D3): the stroke's would-be touch-down under the cut so far
 * (`swipeVector`, or `swipeVectorAbove` under a cut — `scrollStroke`'s
 * own) inside a node of `over` is cut above the highest such node, and the
 * touch-down placed again, until it lies on none: a short list `0,1550
 * 1080x670` under the measured bar's host `66,1840 948x248` — the host's
 * top above the list's centre, 1885 — touched down at 2086, on the host,
 * and is cut to 1840, touching down at 1782. Only while the cut leaves at
 * least MIN_STROKE_BOX above it: a node over nearly all of the box (a sheet
 * risen over the list) is left uncut and the stroke drawn as before — a cut
 * would leave no room, and the stroke would go to an outer container or the
 * screen box (`strokeRoom`'s none), as covered there as here, with the fast
 * fail's sentence naming the node lost (`touchedOn` names only a node over
 * the stroked container). The lower-half rule stays first, so every cut it
 * made is made as it was; this one only cuts higher, and only when the
 * finger would land on a node.
 *
 * Not cut, stated: a node drawn over the box's UPPER half (a floating
 * header) clear of the touch-down, where a content-up stroke touches down at 0.2 of the box — the
 * cut models a cover from below only, as the keyboard's does; that fast
 * fail names the node (scroll-rounds.ts#touchedOn), but a `fully: true`
 * probe toward a top edge that touched down on one and moved nothing is
 * still reported checked (a residual: the probe's stop is not the fast
 * fail). Pure.
 */
function overlayTop(box: Rect, over: readonly Rect[], toward: Direction, coverTop?: number): number | undefined {
  if (toward !== 'down') return undefined;
  const cx = Math.round(box.x + box.width / 2);
  const bottom = Math.min(box.y + box.height, coverTop ?? Number.POSITIVE_INFINITY);
  const tops = over
    .filter((r) => r.x <= cx && cx < r.x + r.width && r.y > (box.y + bottom) / 2 && r.y < bottom)
    .map((r) => r.y);
  let drawn = tops.length === 0 ? undefined : Math.min(...tops);
  // Then the touch-down as it would be drawn under that cut: a node over it is cut above, while that leaves room.
  for (;;) {
    const top = drawn ?? coverTop;
    const at = (top === undefined ? swipeVector(box, toward, 'content') : swipeVectorAbove(box, top, toward, 'content')).from;
    const under = over.filter((r) => containsPoint(r, at)).map((r) => r.y);
    const cut = under.length === 0 ? undefined : Math.min(...under);
    if (cut === undefined || cut >= (top ?? Number.POSITIVE_INFINITY) || cut - box.y < MIN_STROKE_BOX) return drawn;
    drawn = cut;
  }
}

/**
 * The floor on a `dragMs` duration: Android's own `input swipe` default
 * (adapters/android.ts#swipe), so a short stroke — a probe, a halved one —
 * is never sent faster than the stroke was before 2026-10-09.
 */
export const MIN_DRAG_MS = 300;

/**
 * How long `stroke` must take for the finger to move at `speed` screens a
 * second (the adapter's `dragSpeed`, adapters/types.ts) over `screen`'s
 * long side — never under MIN_DRAG_MS; whole ms, rounded up. `scroll_until`
 * hands it to every stroke on an adapter that has a `dragSpeed` (2026-10-09,
 * docs/bugs/2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md:
 * 1332 px in 300 ms flung a RecyclerView past the row between two reads).
 * Pure.
 */
export function dragMs(stroke: Stroke, speed: number, screen: { width: number; height: number }): number {
  const pxPerSecond = speed * Math.max(screen.width, screen.height);
  return Math.max(MIN_DRAG_MS, Math.ceil((strokeLength(stroke) / pxPerSecond) * 1000));
}

/**
 * The same stroke: the same touch-down and the same lift-off, point for
 * point. For `scroll_until`'s "the same stroke twice" (interact/scroll-rounds.ts#
 * UNMOVED_STROKES_EXHAUST) — until the code review of round 2
 * (2026-10-08) a comparison of `JSON.stringify`ed strokes, which compared
 * their spelling (key order included) rather than their points.
 */
export const sameStroke = (a: Stroke, b: Stroke): boolean =>
  a.from.x === b.from.x && a.from.y === b.from.y && a.to.x === b.to.x && a.to.y === b.to.y;

/** The lowest y a touch-down over a keyboard may take (`swipeVectorAbove` (a)): the lower point of `swipeVector`'s vertical stroke over the box the keyboard leaves — read off it, so a change to SWIPE_REACH_FRACTION moves both together. */
function keyboardClearance(uncovered: Rect): number {
  const { from, to } = swipeVector(uncovered, 'up', 'finger');
  return Math.max(from.y, to.y);
}

/** The box a screen gesture swipes in, and what the caller should say about where it came from. */
export interface ScreenBox {
  box: Rect;
  /**
   * Set when the box is not WITNESSED as the screen held the way it is now:
   * the tree's window stood in for a device size that could not be read, or
   * the tree could not be read and the device's size is used as built (no
   * orientation witness). One sentence, for the flow trace and the MCP
   * reply; absent on the ordinary path — a device size and a read tree.
   */
  note?: string;
  /**
   * The boxes a point or a rect is judged ON SCREEN in (2026-10-08, the
   * off-screen tap refusal and its reviews) — read through `judgingScreen`,
   * the one owner both judges share: the tap's on-screen rule
   * (interact/resolve.ts#onScreen) and `scroll_until`'s stop
   * (interact/scroll-rounds.ts#judgeOver, over the frame interact/scroll.ts
   * reads each round), so the scroll and the tap after it agree on the
   * screen by construction. A swipe does not read it: a stroke over the
   * wrong box lands off-centre, a judgement over it is a false refusal or a
   * false "visible".
   *
   * - `[box]` when a window WITNESSED the orientation — the tree has a
   *   window with its own height (`reliable`, `trustworthyHeight`) matching
   *   the box side for side, as built or turned, within
   *   SCREEN_AGREEMENT_PCT — or the box IS the tree's window (the fallback).
   * - `[box, box turned]` when a turn is SUGGESTED but not witnessed: a
   *   window's own sides (`ScreenSize.windowLeg`, reliable or not) say the
   *   panel is turned (its width the long side within 5 %, its height
   *   within the short side; `judgedBoxes`) — an idb landscape window a straddling card made
   *   unreliable (probe A), an iPad landscape window (A2) — or the box was
   *   turned on other evidence: a walked width (the 852-wide walk over a
   *   393x852 panel that is really portrait, probes E/J), an Android inset
   *   window beside a nav bar. Inside either counts: refusing on a guessed
   *   turn would refuse ordinary taps (review B1).
   * - Otherwise the panel AS BUILT alone, whatever box the gesture uses:
   *   a portrait window a straddling card made unreliable (the carousel
   *   case: an item at x 450 of 402 is off screen, scroll_until swipes, the
   *   tap refuses); a walked extent of any shape (code review round 2: a
   *   walk is content, and its height never votes — geometry.ts
   *   #windowTurnsScreen; a carousel walked to x 1500 made the shape vote
   *   "turned" and brought the carousel case back); a landscape-shaped
   *   window that fits the panel unturned (a top split-screen pane); a
   *   child window that matches the panel neither way — an oversized node
   *   or a banner at the origin crowned as the window, whose turn of the
   *   gesture box is a swipe's accepted cost and no evidence here.
   *
   * Lost, stated: a landscape tree with NO window at all (idb with no
   * Application node) whose walk the windowless rules cannot turn is judged
   * on the panel as built, so a point right of x 402 is refused (code review
   * round 2, P5). An iPad split pane (unmeasured) gets the panel as built.
   * `judgingScreen`'s `box` is the first of these — what a reply quotes.
   */
  boxes: Rect[];
}

/** The box, its side lengths swapped — the same screen held the other way. */
export const turnedBox = (b: Rect): Rect => ({ x: b.x, y: b.y, width: b.height, height: b.width });

/** The screen a judgement of "on screen" uses: `ScreenBox.box` (what a reply quotes) and `ScreenBox.boxes` (what counts). */
export interface JudgingScreen {
  box: Rect;
  boxes: Rect[];
}

/**
 * `screenBox` for a JUDGEMENT rather than a gesture — the one try/catch the
 * tap's on-screen rule and `scroll_until`'s stop share (review 2026-10-08,
 * item 2: each had its own, with its own turn policy). `undefined` when
 * there is no box at all (no usable device size and no window in the tree);
 * what that means is the caller's: the tap goes ahead (resolve.ts#onScreen
 * falls back to the root rect, then fails open), the scroll keeps the last
 * round's frame (the device as built only when no round had a box).
 * `box` is the first of `boxes` — the box judged first and quoted — which
 * is the panel as built, not the gesture's turned box, when the turn is no
 * evidence (`judgedBoxes`).
 */
export async function judgingScreen(adapter: Pick<DeviceAdapter, 'viewport'>, read: TreeRead): Promise<JudgingScreen | undefined> {
  try {
    return judgingOf(await screenBox(adapter, read));
  } catch {
    return undefined;
  }
}

/** The judging screen of a `screenBox` already read — `judgingScreen` without the read, for a caller that also strokes in the box (interact/scroll.ts reads one a round). */
export const judgingOf = ({ boxes }: ScreenBox): JudgingScreen => ({ box: boxes[0], boxes });

/**
 * The screen box a gesture swipes in — the ONE owner, read by `swipeScreen`
 * (the flow's `swipe:` step and the MCP `swipe` tool's `direction`) and by
 * the scroll loop (interact/scroll.ts), so a `swipe: up` and a
 * `scroll_until` to content below draw the same vector on the same screen.
 *
 * The box is the DEVICE's screen, `DeviceAdapter.viewport()` — the only
 * measurement of the screen that does not come from the tree, memoized by
 * the adapter, in the tree's units (types.ts#viewport) — anchored at the
 * origin. Until 2026-10-08 `swipeScreen` took it from the tree
 * (`inferScreenSize`) and ignored its `reliable` flag, while the scroll loop
 * took the device's for the same `swipeVector`: two owners of one box, and
 * the tree one had already been wrong once (the union-of-children rule read
 * the 2026-08-26 WDA sheet as 804x1748; geometry.ts says a device-aware
 * caller should prefer the device), and a tree with no geometry gave a 0×0
 * box — a swipe from (0,0) to (0,0) that every caller reported as done.
 *
 * The tree is read for two things only:
 *
 * - ORIENTATION. The device reports the panel as built; the box is turned
 *   when the tree's window says the screen is held sideways —
 *   ui-tree/geometry.ts#windowTurnsScreen, the one owner of that question (the
 *   window's reach, a left-nav-bar Android window included; never a split
 *   pane that fits the panel unturned). Whatever coordinate space the
 *   platform's tree uses, its input uses the same one (taps land on tree
 *   rects), so a box oriented like the window is in the gesture's space.
 *   Not measured on a device in landscape — and the visibility judgements
 *   that compare rects with `viewport()` (the scroll loop's stop, the
 *   `absent` assert) are not turned; that gap is theirs. A tree that could
 *   not be read leaves the box as built, with a note saying so.
 * - FALLBACK, when the device size cannot be read or is unusable (a 0 or
 *   NaN side): the tree's window, when it is one — `reliable` AND a
 *   window's own height (`trustworthyHeight`; a walked height is the lowest
 *   content edge, which a scroll view inflates without limit). The note
 *   says so. It is kept, rather than refusing whenever the device is
 *   silent, because the gesture's own input path (`adb shell input`,
 *   `idb ui`) can be healthy when the size read is not — `wm size` output
 *   that does not parse, `idb describe` with no screen_dimensions — and on
 *   a root-bearing tree (Android, the WDA/idb Application window) the
 *   window is the screen this function used to swipe in. A tree that is
 *   not reliable is never a box: that is the 0×0 swipe this replaces.
 *
 * With neither, it THROWS, naming both causes; nothing is swiped. `read` is
 * the read the caller already made: `swipeScreen` makes one, the scroll loop
 * hands in its round's.
 */
export async function screenBox(adapter: Pick<DeviceAdapter, 'viewport'>, read: TreeRead): Promise<ScreenBox> {
  let device: DeviceScreen | undefined;
  let deviceProblem: string;
  try {
    device = await adapter.viewport();
    deviceProblem = `the device reported ${device.width}x${device.height}`;
  } catch (e) {
    deviceProblem = `the device screen size could not be read (${e instanceof Error ? e.message : String(e)})`;
  }
  const { tree } = read;
  const unread = `the UI tree could not be read${read.error !== undefined ? ` (${read.error.message})` : ''}`;
  const size = tree === undefined ? undefined : inferScreenSize(tree);

  if (device !== undefined && usableScreen(device)) {
    const sideways = size !== undefined && windowTurnsScreen(size, device);
    const { width, height } = sideways ? { width: device.height, height: device.width } : device;
    const box = { x: 0, y: 0, width, height };
    return {
      box,
      ...(tree === undefined && { note: `${unread}; swiped over the device screen as built, ${width}x${height}` }),
      boxes: judgedBoxes(size, device, box, sideways),
    };
  }
  if (size !== undefined && size.reliable && size.trustworthyHeight && usableScreen(size)) {
    const box = { x: 0, y: 0, width: size.width, height: size.height };
    return { box, note: `${deviceProblem}; swiped over the UI tree's window, ${size.width}x${size.height}`, boxes: [box] };
  }
  const treeProblem =
    size === undefined
      ? unread
      : !usableScreen(size)
        ? 'the UI tree has no geometry'
        : !size.reliable
          ? `the UI tree's ${size.width}x${size.height} is not a window it can vouch for`
          : `the UI tree's height ${size.height} is a content extent, not a window's`;
  throw new Error(
    `No screen box to swipe in: ${deviceProblem}, and ${treeProblem} — nothing was swiped. ` +
      'Check the device answers (`adb shell wm size` / `idb describe`) and retry.',
  );
}

/**
 * How far a window's width may fall short of (or pass) the panel's long
 * side and still say the screen is turned (review 2026-10-08, round 3): a
 * landscape Application window is often a few percent short of the panel —
 * 852 of 874 is 2.5 % — and the 2 % side-for-side match judged it a
 * crowned child, refusing the right-hand taps B1 had restored. 5 % admits
 * those and none of the crowned shapes pinned (a 500-wide banner, a
 * 1206-wide strip, a 1080x1000 split pane against a 2400-long panel). What
 * it also admits: a node crowned as the window that happens to span the
 * panel's long side within 5 % and no taller than its short side — its
 * judgement counts both ways up (refusals relaxed, never added).
 */
const TURNED_WIDTH_SLACK_PCT = 5;

/** A window's own sides say the panel is turned: width the turned panel's within TURNED_WIDTH_SLACK_PCT, height within its height (SCREEN_AGREEMENT_PCT of slack) — a window may be short, never taller. */
const turnedWindow = (size: { width: number; height: number }, panelTurned: { width: number; height: number }): boolean =>
  Math.abs(size.width - panelTurned.width) <= (panelTurned.width * TURNED_WIDTH_SLACK_PCT) / 100 &&
  size.height <= panelTurned.height * (1 + SCREEN_AGREEMENT_PCT / 100);

/**
 * The boxes a judgement counts (`ScreenBox.boxes`; the rule is there),
 * given the tree's size, the panel as built, the gesture's box and whether
 * that box was turned:
 * - witnessed — a window with its own height matching `box` side for side:
 *   `[box]`;
 * - a window's own sides (`windowLeg`, reliable or not — never a walked
 *   extent, whose height is a content maximum) saying TURNED: its width
 *   the panel's long side within TURNED_WIDTH_SLACK_PCT, its height within
 *   the panel's short side (`turnedWindow`) — a turn suggested,
 *   `[box, box turned]` (an idb landscape window a straddling card made
 *   unreliable, an iPad landscape window, either a few percent short of
 *   the panel: 874x380 and 852x402 on 402x874, 1180x800 on 820x1180);
 * - the box turned on other evidence (a walked width, an inset window) and
 *   NOT by a child window that matches neither way — an oversized node
 *   crowned as the window, a banner at the origin, whose turn is a swipe's
 *   accepted cost and no evidence for a judgement: suggested too;
 * - otherwise the panel as built alone — whatever box the gesture uses. A
 *   landscape-shaped window that fits the panel unturned (a top split-screen
 *   pane) or a landscape-shaped walk suggests nothing.
 */
function judgedBoxes(size: ScreenSize | undefined, device: DeviceScreen, box: Rect, sideways: boolean): Rect[] {
  if (size !== undefined && size.reliable && size.trustworthyHeight && sameSides(size, box)) return [box];
  const panelTurned = { width: device.height, height: device.width };
  const windowSaysTurned = size?.windowLeg !== undefined && turnedWindow(size, panelTurned);
  const crownedChild = size?.windowLeg === 'child' && !windowSaysTurned;
  if (windowSaysTurned || (sideways && !crownedChild)) return [box, turnedBox(box)];
  return [{ x: 0, y: 0, width: device.width, height: device.height }];
}

/** The window and the box agree side for side, within SCREEN_AGREEMENT_PCT — the window IS the screen, held the way the box is. */
const sameSides = (a: { width: number; height: number }, b: { width: number; height: number }): boolean =>
  Math.abs(a.width - b.width) <= (b.width * SCREEN_AGREEMENT_PCT) / 100 && Math.abs(a.height - b.height) <= (b.height * SCREEN_AGREEMENT_PCT) / 100;

export interface SwipeOptions {
  direction: Direction;
  meaning: SwipeMeaning;
  /** Repeat the same gesture. Default 1. */
  times?: number;
  /** Handed to the adapter's swipe; its own default when absent. */
  durationMs?: number;
}

/** What `swipeScreen` drew, for the caller's report. */
export interface ScreenSwipe extends Stroke {
  /** `ScreenBox.note` — set only when the box was not witnessed as the screen. */
  note?: string;
}

/**
 * Swipe across the screen, `times` times, over `screenBox` — the device's
 * screen, oriented by one tree read (a failed read only loses the
 * orientation witness and the fallback, and the note says so; the device box
 * still stands). The gesture does not care what moved, so the box is worked
 * out once and the same vector repeated. Throws, swiping nothing, when there
 * is no usable box.
 */
export async function swipeScreen(
  adapter: Pick<DeviceAdapter, 'uiTree' | 'viewport' | 'swipe'>,
  opts: SwipeOptions,
): Promise<ScreenSwipe> {
  const { box, note } = await screenBox(adapter, await readTreeOrError(adapter));
  const { from, to } = swipeVector(box, opts.direction, opts.meaning);
  const times = opts.times ?? 1;
  for (let i = 0; i < times; i++) await adapter.swipe(from, to, opts.durationMs);
  return { from, to, ...(note !== undefined && { note }) };
}
