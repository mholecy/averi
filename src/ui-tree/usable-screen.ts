import { usableSize, type DeviceAdapter, type DeviceScreen, type Rect, type UiNode } from '../adapters/types.js';
import { inferScreenSize, SCREEN_AGREEMENT_PCT, screenOf, windowTurnsScreen, type ScreenSize } from './geometry.js';
import type { TreeRead } from './read-tree.js';

/**
 * THE USABLE SCREEN — the one value every judgement of "on screen" reads,
 * built in one place, for every verb that asks "can this be used where it
 * stands?" (standing.ts#Scene judges on it): the tap (whose standing
 * the in-tree keyboard dismissal picker asks too,
 * interact/keyboard-in-tree.ts), `scroll_until`'s stop
 * (interact/scroll-rounds.ts, over the screen interact/scroll.ts reads each
 * round), the pixel assert (verify/pixel-poll.ts#overElement) and, for
 * its box, the swipe (interact/swipe.ts#screenBox, which keeps its note and
 * its throw over it and judges nothing).
 *
 * Contract:
 * - `oriented` — the device's screen (`DeviceAdapter.viewport()`, memoized
 *   by the adapter, in the tree's units), anchored at the origin and turned
 *   when the tree's window says the screen is held sideways
 *   (geometry.ts#windowTurnsScreen; no tree, no turn); else the tree's
 *   window, only when the tree vouches for it — `reliable` AND a window's
 *   own height (`trustworthyHeight`: a walked height is the lowest content
 *   edge, which a scroll view inflates without limit) — and usable; else no
 *   usable screen (undefined). What that means is the caller's: the gesture
 *   box throws and nothing is swiped, the tap judges by the tree's root rect
 *   and then fails open, the scroll keeps the last round's screen, the
 *   pixel assert takes `treeScreen`.
 * - `boxes` — the boxes a point or a rect is judged ON SCREEN in, so the
 *   scroll and the tap after it agree by construction (the rule is
 *   `judgedBoxes`): the oriented box alone when a window witnessed the
 *   orientation, or the box IS the tree's window; the box either way up
 *   when a turn is suggested but not witnessed (refusing on a guessed turn
 *   would refuse ordinary taps); otherwise the panel as built alone,
 *   whatever box the gesture uses.
 * - `box` — the first of `boxes`, the box a reply quotes: the panel as
 *   built, not `oriented`, when the turn is no evidence.
 * - `statusBand`, `navigationBand` — the device's system bands
 *   (adapters/types.ts#DeviceScreen), carried only when the device's size
 *   is the screen: with the tree's window standing in, no band (the
 *   judgements fail open, as the rest of that path does). The tap, the
 *   stop and the pixel assert judge both (standing.ts#Scene).
 *
 * Residuals:
 * - A landscape tree with NO window at all (idb with no Application node)
 *   whose walk the windowless rules cannot turn is judged on the panel as
 *   built, so a point right of the panel's width is refused.
 * - An iPad split pane (unmeasured) gets the panel as built.
 * - A node crowned as the window that spans the panel's long side within
 *   TURNED_WIDTH_SLACK_PCT and is no taller than its short side counts
 *   either way up (refusals relaxed, never added).
 * - A crowned child window that matches the panel neither way turns
 *   `oriented` (a gesture over it lands off-centre: the swipe's accepted
 *   cost, geometry.ts#windowTurnsScreen) but not `boxes`; the pixel assert
 *   judges its single box over `oriented`.
 */
export interface UsableScreen {
  /** The first of `boxes` — what a reply quotes. */
  readonly box: Rect;
  /** The boxes a point or a rect is judged on screen in: one, or the box either way up when a turn is suggested but not witnessed. */
  readonly boxes: readonly Rect[];
  /** The device's screen turned as the tree's window says (else the window, else the tree's screen): the box a gesture strokes in, and the pixel assert's single box. */
  readonly oriented: Rect;
  /** Where the box came from: the device's size, a window the tree vouches for, or (`treeScreen`, the pixel assert's last resort) the tree's own screen. */
  readonly from: 'device' | 'window' | 'tree';
  /** adapters/types.ts#DeviceScreen.statusBand, when `from` is the device. */
  readonly statusBand?: number;
  /** adapters/types.ts#DeviceScreen.navigationBand (the band's TOP line), when `from` is the device. */
  readonly navigationBand?: number;
}

/**
 * The usable screen for `read` (the tree the caller already read) on
 * `adapter`'s device — `usableScreenOf` over the device's size and the
 * tree's. A device whose size cannot be read is no device; undefined when
 * there is no usable screen at all. FAILS OPEN: a tree that cannot be sized
 * (a throw out of `inferScreenSize`) is no usable screen either, so a
 * judgement behaves as with no box rather than failing the verb.
 *
 * `fresh` reads the device's screen again first (`viewport({ fresh: true
 * })`) — the tap's re-read before it refuses a point as off the screen
 * (interact/resolve.ts#refuseOffScreen): the adapter memoizes the size, and
 * a fold, an unfold or a `wm size` change would otherwise refuse taps for
 * the server's life. A fresh read that FAILS is dropped by the memo
 * (adapters/viewport-memo.ts), so the plain read after it asks the device
 * once more — one extra read on a refusal path, accepted.
 */
export async function usableScreen(adapter: Pick<DeviceAdapter, 'viewport'>, read: TreeRead, opts?: { fresh?: boolean }): Promise<UsableScreen | undefined> {
  if (opts?.fresh === true) {
    try {
      await adapter.viewport({ fresh: true });
    } catch {
      // An unreadable size is the plain read's to handle, below.
    }
  }
  const device = await adapter.viewport().catch(() => undefined);
  try {
    return usableScreenOf(device, read.tree === undefined ? undefined : inferScreenSize(read.tree));
  } catch {
    return undefined;
  }
}

/** The usable screen of a device size read (or none) and a tree's `inferScreenSize` (or none) — the one derivation, pure. */
export function usableScreenOf(device: DeviceScreen | undefined, size: ScreenSize | undefined): UsableScreen | undefined {
  if (device !== undefined && usableSize(device)) {
    const sideways = size !== undefined && windowTurnsScreen(size, device);
    const oriented = sideways ? { x: 0, y: 0, width: device.height, height: device.width } : { x: 0, y: 0, width: device.width, height: device.height };
    const boxes = judgedBoxes(size, device, oriented, sideways);
    return {
      box: boxes[0],
      boxes,
      oriented,
      from: 'device',
      ...(device.statusBand !== undefined && { statusBand: device.statusBand }),
      ...(device.navigationBand !== undefined && { navigationBand: device.navigationBand }),
    };
  }
  if (size !== undefined && size.reliable && size.trustworthyHeight && usableSize(size)) {
    const window = { x: 0, y: 0, width: size.width, height: size.height };
    return { box: window, boxes: [window], oriented: window, from: 'window' };
  }
  return undefined;
}

/**
 * The tree's own screen (geometry.ts#screenOf, the one draw-order.ts sizes
 * its hosts against) as a usable screen, `from: 'tree'`, with no band — the
 * pixel assert's last resort when `usableScreen` has none.
 */
export function treeScreen(tree: UiNode): UsableScreen {
  const box = screenOf(tree);
  return { box, boxes: [box], oriented: box, from: 'tree' };
}

/**
 * How far a window's width may fall short of (or pass) the panel's long
 * side and still say the screen is turned: a landscape Application window
 * is often a few percent short of the panel — 852 of 874 is 2.5 % — and a
 * side-for-side match within SCREEN_AGREEMENT_PCT judged it a crowned
 * child, refusing right-hand taps. 5 % admits those and none of the crowned
 * shapes pinned (a 500-wide banner, a 1206-wide strip, a 1080x1000 split
 * pane against a 2400-long panel). What it also admits is a residual of
 * the module (`UsableScreen`).
 */
const TURNED_WIDTH_SLACK_PCT = 5;

/** A window's own sides say the panel is turned: width the turned panel's within TURNED_WIDTH_SLACK_PCT, height within its height (SCREEN_AGREEMENT_PCT of slack) — a window may be short, never taller. */
const turnedWindow = (size: { width: number; height: number }, panelTurned: { width: number; height: number }): boolean =>
  Math.abs(size.width - panelTurned.width) <= (panelTurned.width * TURNED_WIDTH_SLACK_PCT) / 100 &&
  size.height <= panelTurned.height * (1 + SCREEN_AGREEMENT_PCT / 100);

/**
 * The boxes a judgement counts (`UsableScreen.boxes`), given the tree's
 * size, the panel as built, the oriented box and whether it was turned:
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
 *   crowned as the window, a banner at the origin: suggested too;
 * - otherwise the panel as built alone. A landscape-shaped window that fits
 *   the panel unturned (a top split-screen pane) or a landscape-shaped walk
 *   suggests nothing; a portrait window a straddling card made unreliable
 *   keeps the carousel item at x 450 of 402 off screen.
 */
function judgedBoxes(size: ScreenSize | undefined, device: DeviceScreen, box: Rect, sideways: boolean): Rect[] {
  if (size !== undefined && size.reliable && size.trustworthyHeight && sameSides(size, box)) return [box];
  const panelTurned = { width: device.height, height: device.width };
  const windowSaysTurned = size?.windowLeg !== undefined && turnedWindow(size, panelTurned);
  const crownedChild = size?.windowLeg === 'child' && !windowSaysTurned;
  if (windowSaysTurned || (sideways && !crownedChild)) return [box, { x: box.x, y: box.y, width: box.height, height: box.width }];
  return [{ x: 0, y: 0, width: device.width, height: device.height }];
}

/** The window and the box agree side for side, within SCREEN_AGREEMENT_PCT — the window IS the screen, held the way the box is. */
const sameSides = (a: { width: number; height: number }, b: { width: number; height: number }): boolean =>
  Math.abs(a.width - b.width) <= (b.width * SCREEN_AGREEMENT_PCT) / 100 && Math.abs(a.height - b.height) <= (b.height * SCREEN_AGREEMENT_PCT) / 100;
