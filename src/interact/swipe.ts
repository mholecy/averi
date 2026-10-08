import { usableScreen, type DeviceAdapter, type DeviceScreen, type Rect, type Stroke } from '../adapters/types.js';
import { inferScreenSize, SCREEN_AGREEMENT_PCT, windowTurnsScreen, type ScreenSize } from '../ui-tree/geometry.js';
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
   * (interact/scroll.ts), so the scroll and the tap after it agree on the
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
    const { boxes } = await screenBox(adapter, read);
    return { box: boxes[0], boxes };
  } catch {
    return undefined;
  }
}

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
