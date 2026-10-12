import { usableSize, type DeviceAdapter, type DeviceScreen, type Point, type Rect, type UiNode } from '../adapters/types.js';
import { drawOrder, listsAncestry, type DrawOrder } from './draw-order.js';
import {
  belowStatusBand,
  clippedEdges,
  clipsOf,
  containsPoint,
  inferScreenSize,
  inStatusBand,
  SCREEN_AGREEMENT_PCT,
  screenOf,
  visibleFractionInViewport,
  windowTurnsScreen,
  type Clips,
  type Cut,
  type Edge,
  type ScreenSize,
} from './geometry.js';
import type { TreeRead } from './read-tree.js';
import { tapPoint } from './selectors.js';

/**
 * Standing: where a target stands on the screen, for every verb that asks
 * "can this be used where it stands?". It holds THE USABLE SCREEN — the one
 * value every judgement of "on screen" reads, built in one place: the tap's
 * on-screen rule (interact/resolve.ts#onScreen, which the in-tree keyboard
 * dismissal picker asks too, interact/keyboard-in-tree.ts), `scroll_until`'s stop
 * (interact/scroll-rounds.ts, over the screen interact/scroll.ts reads each
 * round), the pixel assert (verify/pixel-poll.ts#chromeOverElement) and, for
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
 *   judgements fail open, as the rest of that path does). Nothing judges
 *   `navigationBand` yet.
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
  /** adapters/types.ts#DeviceScreen.navigationBand, when `from` is the device. Data only: nothing judges it yet. */
  readonly navigationBand?: number;
}

/**
 * The usable screen for `read` (the tree the caller already read) on
 * `adapter`'s device — `usableScreenOf` over the device's size and the
 * tree's. A device whose size cannot be read is no device; undefined when
 * there is no usable screen at all. FAILS OPEN: a tree that cannot be sized
 * (a throw out of `inferScreenSize`) is no usable screen either, so a
 * judgement behaves as with no box rather than failing the verb.
 */
export async function usableScreen(adapter: Pick<DeviceAdapter, 'viewport'>, read: TreeRead): Promise<UsableScreen | undefined> {
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

// ─── The scene and the standing ──────────────────────────────────────────────

/**
 * THE SCENE of one tree: its draw order (draw-order.ts) and its clip facts
 * (geometry.ts#clipsOf), each derived once, on first use — and the
 * STANDING of a node in it: where the node stands on a screen for what a
 * verb means to do with it, one ordered judgement.
 *
 * Contract of `standing(node, screen, purpose)`:
 * - Judged in `screen.box` alone (a caller judging in several boxes asks
 *   once a box and keeps the best), cut above `screen.keyboardTop` when
 *   given — full width, from the box's origin; a line at or above the top
 *   leaves nothing: no exposure is asked, nothing shows.
 * - `facts` are the judgement's inputs, whatever the kind: what a caller's
 *   motion and sentences read (scroll_until's best-so-far, its far-edge
 *   turn and its failure text).
 * - The kind, for the stop (`{ of: 'stop' }`) — `reachable` when the node
 *   is in the frame, its centre (the point the next tap presses) on the box
 *   below the status band, and — `fully` — clipped at no edge with nothing
 *   drawn over any of it, or — plain — nothing over its centre and not cut
 *   to a sliver (`Clips.cutSliver` by the exposure's minimum piece; the
 *   `fully` stop leaves a cut to scroll_until's flush probe). Otherwise, in
 *   this order: nothing in the frame — `underKeyboard` when a keyboard line
 *   applies and the node is in the box, else `offScreen`; `clipped`
 *   (`fully` only); `statusBand` (its centre in the band); `offScreen`
 *   (its centre off the box); `cut` (plain, its centre under nothing);
 *   else `covered`.
 *
 * Why the stop is judged so:
 * - The plain stop is the next tap's point: its centre on the screen and
 *   under nothing, so `scroll_until X` then `tap X` agree. A stop that was
 *   any intersection reported a row under a pinned CONTINUE bar "fully
 *   visible after 0 swipes"; one with its centre past the screen's edge
 *   ("visible … CLIPPED 40%") handed the tap an off-screen refusal
 *   (interact/resolve.ts#refuseOffScreen).
 * - On the SCREEN, not the frame cut above a keyboard: a centre under the
 *   keyboard stops, and the tap's keyboard guard hides the keyboard.
 * - A centre in the status band is off the screen, for both stops —
 *   measured: one stroke flung `priority_select` to `24,-20` and the plain
 *   stop stopped with its centre at (201,6), where the tap pressed the
 *   status bar. Only the centre: the rest of the rect is judged against
 *   the box (`fully` judges clipping against the whole box), so full-bleed
 *   content at the top stops once its ROUNDED centre (`tapPoint`) lies below
 *   the band; one at y 0 shorter than twice the band less a point (122 pt
 *   or less under 62; 123 pt rounds its centre 61.5 to 62 and stops) stops
 *   neither way, and its failure names the status bar.
 * - A sliver: uiautomator cuts every rect to its scroller, so a cut node's
 *   centre is always on the screen, and the stop handed back the very strip
 *   the next tap refuses (interact/resolve.ts#refuseCutSliver). Scrolling on
 *   reveals it. `fully: true` keeps its own rule: a stop flush with a
 *   clipping container is probed (interact/scroll-rounds.ts#PROBE_REACH).
 * - With `fully: true` a cut edge leads the shortfall, as it always has.
 * The owner's decisions for the stop's centre and covers:
 * docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md
 *
 * TODO: one precedence for the stop and the tap, cut before cover
 * (the stop judges the cover first today).
 *
 * Residuals:
 * - The frame is not cut below the status band: a node lying only in the
 *   band counts as a cover for `fully` and lowers `shows`.
 */
export interface Scene {
  /** The tree's draw order (draw-order.ts#drawOrder). */
  readonly order: DrawOrder;
  /** The tree's clip facts (geometry.ts#clipsOf), their ancestry as draw order reads it (draw-order.ts#listsAncestry). */
  readonly clips: Clips;
  standing(node: UiNode, screen: StandingScreen, purpose: Purpose): Standing;
}

/** What a verb means to do with the node: `scroll_until`'s stop, `fully` or plain. */
export type Purpose = { readonly of: 'stop'; readonly fully: boolean };

/** The screen a standing is judged on: one box of the usable screen, its status band, and the top of a keyboard the caller applies. */
export type StandingScreen = Pick<UsableScreen, 'box' | 'statusBand'> & { readonly keyboardTop?: number };

/** What a standing was judged from — every kind carries them. */
export interface StandingFacts {
  /** The point a tap presses (selectors.ts#tapPoint). */
  readonly centre: Point;
  /** The frame judged in: the box, cut above the keyboard line when one applies (no height when it leaves nothing). */
  readonly screen: Rect;
  /** The fraction of the node inside the frame, covers or not. */
  readonly visible: number;
  /** The frame's edges the node extends past (geometry.ts#clippedEdges). */
  readonly clipped: readonly Edge[];
  /** draw-order.ts#Exposure's, inside the frame: the covers, where each presses, the one over the centre, and what shows. */
  readonly covers: readonly UiNode[];
  readonly reaches: readonly Rect[];
  readonly centreCover?: UiNode;
  readonly shows: number;
  /** The least piece a tap may be aimed at (draw-order.ts#Exposure.minPiece); absent when the frame leaves nothing to judge. */
  readonly minPiece?: number;
  /** The node's cut to a sliver by its scroll container under `minPiece` (geometry.ts#Clips.cutSliver), whatever the kind. */
  readonly sliver?: Cut;
}

/** Where the node stands, and why: `facts`, and one kind with what its sentence quotes. */
export type Standing = { readonly facts: StandingFacts } & (
  | { readonly kind: 'reachable'; readonly at: Point }
  | { readonly kind: 'offScreen'; readonly at: Point; readonly visible: number }
  | { readonly kind: 'statusBand'; readonly at: Point; readonly band: number }
  | { readonly kind: 'clipped'; readonly edges: readonly Edge[] }
  | { readonly kind: 'cut'; readonly cut: Cut; readonly minPiece: number }
  | { readonly kind: 'covered'; readonly cover: UiNode }
  | { readonly kind: 'underKeyboard'; readonly top: number }
);

/** The scene of `tree`: its draw order and clip facts, each derived on first use and kept. */
export function sceneOf(tree: UiNode): Scene {
  let order: DrawOrder | undefined;
  let clips: Clips | undefined;
  const scene: Scene = {
    get order() {
      return (order ??= drawOrder(tree));
    },
    get clips() {
      return (clips ??= clipsOf(tree, { ancestry: listsAncestry(tree) }));
    },
    standing: (node, screen, purpose) => stopStanding(scene, node, screen, purpose.fully),
  };
  return scene;
}

/** The stop's standing (`Scene`'s contract). */
function stopStanding(scene: Scene, node: UiNode, { box, statusBand, keyboardTop }: StandingScreen, fully: boolean): Standing {
  const centre = tapPoint(node);
  const band = { boxes: [box], statusBand };
  const below = belowStatusBand(box, band);
  const onScreen = containsPoint(below, centre);
  const inBand = inStatusBand(centre, band);
  if (keyboardTop !== undefined && keyboardTop <= 0) {
    const facts: StandingFacts = { centre, screen: { x: 0, y: 0, width: box.width, height: 0 }, visible: 0, clipped: [], covers: [], reaches: [], shows: 0 };
    return { facts, kind: 'underKeyboard', top: keyboardTop };
  }
  const frame: Rect = keyboardTop === undefined ? { ...box } : { x: 0, y: 0, width: box.width, height: keyboardTop };
  const seen = scene.order.exposure(node, frame);
  const visible = visibleFractionInViewport(node.rect, frame);
  const sliver = scene.clips.cutSliver(node, seen.minPiece);
  const facts: StandingFacts = {
    centre,
    screen: frame,
    visible,
    clipped: clippedEdges(node.rect, frame),
    covers: seen.covers,
    reaches: seen.reaches,
    ...(seen.centreCover !== undefined && { centreCover: seen.centreCover }),
    shows: seen.shows,
    minPiece: seen.minPiece,
    ...(sliver !== undefined && { sliver }),
  };
  if (visible === 0) {
    if (keyboardTop !== undefined && visibleFractionInViewport(node.rect, box) > 0) return { facts, kind: 'underKeyboard', top: keyboardTop };
    return { facts, kind: 'offScreen', at: centre, visible };
  }
  const clear = fully ? facts.clipped.length === 0 && facts.covers.length === 0 : facts.centreCover === undefined && sliver === undefined;
  if (onScreen && clear) return { facts, kind: 'reachable', at: centre };
  if (fully && facts.clipped.length > 0) return { facts, kind: 'clipped', edges: facts.clipped };
  if (inBand) return { facts, kind: 'statusBand', at: centre, band: below.y - box.y };
  if (!onScreen) return { facts, kind: 'offScreen', at: centre, visible };
  if (!fully && facts.centreCover === undefined && sliver !== undefined) return { facts, kind: 'cut', cut: sliver, minPiece: seen.minPiece };
  return { facts, kind: 'covered', cover: facts.centreCover ?? facts.covers[facts.covers.length - 1] };
}
