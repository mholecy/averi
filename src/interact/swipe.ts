import { usableSize, type DeviceAdapter, type DeviceScreen, type Point, type Rect, type ScrollAxis, type Stroke } from '../adapters/types.js';
import { axisOfEdge, inferScreenSize, type Edge } from '../ui-tree/geometry.js';
import { readTreeOrError, type TreeRead } from '../ui-tree/read-tree.js';
import { usableScreenOf, type UsableScreen } from '../ui-tree/usable-screen.js';

export type Direction = 'up' | 'down' | 'left' | 'right';

/** Each direction's opposite — the finger's way for a content-meaning swipe, the stroke that brings back a target a fling carried past, the status-bar failure's hint. One map, read by every module that turns a direction round. */
export const OPPOSITE: Readonly<Record<Direction, Direction>> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** What one side of a rect means to a scroll and to a sentence (`SIDES`). */
export interface SideWords {
  /**
   * The `scroll_until` direction (where the content lies) that reveals what
   * lies past this edge: content beyond the top lies up, and so on — read by
   * `scroll_until`'s probe and its stroke toward a cut edge
   * (scroll-rounds.ts), by the tap's cut-sliver remedy (target-text.ts#cutRemedy,
   * which `scroll_until`'s sliver failures quote) and by the hints for a node
   * past a side (target-text.ts#revealText, #untriedSideText).
   */
  readonly reveals: Direction;
  /** Where a node past this edge lies, before what it lies past: `clipped out above its scroll container`, `left of the viewport` (target-text.ts#pastSideText, resolve.ts#zeroAreaHint). */
  readonly past: string;
  /** The same side standing alone: `if it lies to the left` (target-text.ts#untriedSideText). */
  readonly lies: string;
}

/**
 * Each EDGE of a rect's words — one table, a field per use, so the four
 * sides are spelled once (target-text.ts's sentences and resolve.ts's hint read it too).
 */
export const SIDES: Readonly<Record<Edge, SideWords>> = {
  top: { reveals: 'up', past: 'above', lies: 'above' },
  bottom: { reveals: 'down', past: 'below', lies: 'below' },
  left: { reveals: 'left', past: 'left of', lies: 'to the left' },
  right: { reveals: 'right', past: 'right of', lies: 'to the right' },
};

/**
 * The edge past which lies the content a scroll toward `direction` (where the content lies) brings in — its top for
 * `up`: `SIDES[…].reveals` read the other way (pinned against it in tests/interact/swipe.test.ts). Read by the end
 * proof (stroke-plan.ts#strokedEnd) and its sentences (scroll-text.ts).
 */
export const EDGE_TOWARD: Readonly<Record<Direction, Edge>> = { up: 'top', down: 'bottom', left: 'left', right: 'right' };

/** The axis a scroll toward `direction` moves the content along — the axis of the edge it brings content in through (ui-tree/geometry.ts#axisOfEdge). */
export const axisOf = (direction: Direction): ScrollAxis => axisOfEdge(EDGE_TOWARD[direction]);

/**
 * Which thing `direction` names. A `swipe:` step names the FINGER's movement
 * (swipe up = finger travels up, revealing content below), and so does the
 * MCP `swipe` tool's `direction` (its raw from/to
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
  return meaning === 'finger' ? finger[direction] : finger[OPPOSITE[direction]];
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
 *     touch-down. The second rule is the iOS device check of the note below:
 *     docs/bugs/2026-10-08-scroll-until-ignores-android-soft-keyboard.md
 *     The stroke over the box above the pad touched down for a content-UP
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
 * The strokes this gives (as the tests measure them):
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
 * scroll-read.ts#offeredKeyboard). Pure.
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
 * along it: TOUCH_SLOP is a fixed number in tree units,
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

/** How far a stroke's finger travels, touch-down to lift-off. */
export const strokeLength = ({ from, to }: Stroke): number => Math.hypot(to.x - from.x, to.y - from.y);

/**
 * The floor on a `dragMs` duration: Android's own `input swipe` default
 * (adapters/android.ts#swipe), so a short stroke — a probe, a halved one —
 * is never sent faster than an undragged stroke.
 */
export const MIN_DRAG_MS = 300;

/**
 * How long `stroke` must take for the finger to move at `speed` screens a
 * second (the adapter's `dragSpeed`, adapters/types.ts) over `screen`'s
 * long side — never under MIN_DRAG_MS; whole ms, rounded up. `scroll_until`
 * hands it to every stroke on an adapter that has a `dragSpeed` (1332 px in
 * 300 ms flung a RecyclerView past the row between two reads). Pure.
 * docs/bugs/2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md
 */
export function dragMs(stroke: Stroke, speed: number, screen: { width: number; height: number }): number {
  const pxPerSecond = speed * Math.max(screen.width, screen.height);
  return Math.max(MIN_DRAG_MS, Math.ceil((strokeLength(stroke) / pxPerSecond) * 1000));
}

/**
 * The same stroke: the same touch-down and the same lift-off, point for
 * point. For `scroll_until`'s "the same stroke twice" (interact/scroll-rounds.ts#
 * UNMOVED_STROKES_EXHAUST) — points, not the strokes' spelling (a
 * `JSON.stringify` comparison would read key order too).
 */
export const sameStroke = (a: Stroke, b: Stroke): boolean =>
  a.from.x === b.from.x && a.from.y === b.from.y && a.to.x === b.to.x && a.to.y === b.to.y;

/** The lowest y a touch-down over a keyboard may take (`swipeVectorAbove` (a)): the lower point of `swipeVector`'s vertical stroke over the box the keyboard leaves — read off it, so a change to SWIPE_REACH_FRACTION moves both together. */
function keyboardClearance(uncovered: Rect): number {
  const { from, to } = swipeVector(uncovered, 'up', 'finger');
  return Math.max(from.y, to.y);
}

/**
 * The box a screen gesture swipes in: the usable screen
 * (ui-tree/usable-screen.ts#UsableScreen), whose `oriented` box is the one
 * stroked in, and what the caller should say about where it came from.
 * The screen is a member, not the gesture's own shape: its `box` is the
 * box a JUDGEMENT quotes (the panel as built when a turn is no evidence),
 * and a gesture that read it would stroke over the wrong box.
 */
export interface ScreenBox {
  /** The usable screen the gesture was worked out over: `usable.oriented` is the box stroked in. */
  usable: UsableScreen;
  /**
   * Set when the box is not WITNESSED as the screen held the way it is now:
   * the tree's window stood in for a device size that could not be read, or
   * the tree could not be read and the device's size is used as built (no
   * orientation witness). One sentence, for the flow trace and the MCP
   * reply; absent on the ordinary path — a device size and a read tree.
   */
  note?: string;
}

/**
 * The screen box a gesture swipes in — the ONE owner, read by `swipeScreen`
 * (the flow's `swipe:` step and the MCP `swipe` tool's `direction`) and by
 * the scroll loop (interact/scroll.ts), so a `swipe: up` and a
 * `scroll_until` to content below draw the same vector on the same screen.
 * It judges nothing: the box is ui-tree/usable-screen.ts#usableScreenOf's
 * (`oriented` — the device's screen turned as the tree's window says, else
 * a window the tree vouches for; the rules are there), and what this adds
 * is the gesture's own: the note and the throw.
 *
 * Why the device's size and not the tree's: a box taken from the tree
 * (`inferScreenSize`, its `reliable` flag ignored) beside the scroll loop's
 * device box made two owners of one box; the tree's had been wrong (the
 * union-of-children rule read a WDA sheet as 804x1748), and a tree with no
 * geometry gave a 0×0 box — a swipe from (0,0) to (0,0) reported as done. The window fallback is kept, rather than
 * refusing whenever the device is silent, because the gesture's own input
 * path (`adb shell input`, `idb ui`) can be healthy when the size read is
 * not — `wm size` output that does not parse, `idb describe` with no
 * screen_dimensions. Whatever coordinate space the platform's tree uses,
 * its input uses the same one (taps land on tree rects), so a box oriented
 * like the window is in the gesture's space. Not measured on a device in
 * landscape. A tree that could not be read leaves the box as built, with a
 * note saying so.
 *
 * With no usable screen it THROWS, naming both causes; nothing is swiped.
 * `read` is the read the caller already made: `swipeScreen` makes one, the
 * scroll loop hands in its round's.
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

  const usable = usableScreenOf(device, size);
  if (usable?.from === 'device') {
    const { oriented } = usable;
    return { usable, ...(tree === undefined && { note: `${unread}; swiped over the device screen as built, ${oriented.width}x${oriented.height}` }) };
  }
  if (usable !== undefined) {
    const { oriented } = usable;
    return { usable, note: `${deviceProblem}; swiped over the UI tree's window, ${oriented.width}x${oriented.height}` };
  }
  const treeProblem =
    size === undefined
      ? unread
      : !usableSize(size)
        ? 'the UI tree has no geometry'
        : !size.reliable
          ? `the UI tree's ${size.width}x${size.height} is not a window it can vouch for`
          : `the UI tree's height ${size.height} is a content extent, not a window's`;
  throw new Error(
    `No screen box to swipe in: ${deviceProblem}, and ${treeProblem} — nothing was swiped. ` +
      'Check the device answers (`adb shell wm size` / `idb describe`) and retry.',
  );
}

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
  const { usable, note } = await screenBox(adapter, await readTreeOrError(adapter));
  const { from, to } = swipeVector(usable.oriented, opts.direction, opts.meaning);
  const times = opts.times ?? 1;
  for (let i = 0; i < times; i++) await adapter.swipe(from, to, opts.durationMs);
  return { from, to, ...(note !== undefined && { note }) };
}
