import { rectArea, usableSize, type DeviceAdapter, type DeviceScreen, type Point, type Rect, type UiNode } from '../adapters/types.js';
import { drawOrder, listsAncestry, type DrawOrder, type Exposure } from './draw-order.js';
import {
  aboveNavigationBand,
  belowStatusBand,
  clippedEdges,
  clipsOf,
  containsPoint,
  inferScreenSize,
  inNavigationBand,
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
import type { KeyboardLine } from './keyboard-cover.js';
import type { TreeRead } from './read-tree.js';
import { tapPoint } from './selectors.js';

/**
 * Standing: where a target stands on the screen, for every verb that asks
 * "can this be used where it stands?". It holds THE USABLE SCREEN — the one
 * value every judgement of "on screen" reads, built in one place: the tap's
 * on-screen rule (`onScreen`, which the in-tree keyboard dismissal picker
 * asks too, interact/keyboard-in-tree.ts), `scroll_until`'s stop
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
 *   judgements fail open, as the rest of that path does). The tap and the
 *   stop judge both (`Scene`); the pixel assert the status band only.
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

// ─── The scene and the standing ──────────────────────────────────────────────

/**
 * THE SCENE of one tree: its draw order (draw-order.ts) and its clip facts
 * (geometry.ts#clipsOf), each derived once, on first use — and the
 * STANDING of a node in it: where the node stands on a screen for what a
 * verb means to do with it, one ordered judgement for the tap and for
 * `scroll_until`'s stop.
 *
 * Contract of `standing(node, screen, purpose)`:
 * - The point judged is the node's centre as a tap sends it
 *   (selectors.ts#tapPoint). It is ON the screen when it lies in a box less
 *   the system bands (`onScreen`, the rule the in-tree dismissal picker
 *   asks too): the status band at a portrait box's top
 *   (geometry.ts#belowStatusBand) and the navigation band at its bottom
 *   (geometry.ts#aboveNavigationBand). The tap judges in ANY of
 *   `screen.boxes`; the stop in `screen.box` alone (a caller judging in
 *   several boxes asks once a box and keeps the best). With no screen, the
 *   tree's root rect is the one box, and a root of no area leaves every
 *   point on the screen (fail open).
 * - THE ORDER, once for both verbs — after what only the stop judges first
 *   (nothing of it in its frame: `underKeyboard` when a keyboard line
 *   applies and the node is in the box, else `offScreen`; with `fully`, a
 *   frame edge it runs past: `clipped`): its centre off the screen —
 *   `offScreen`; its centre in a system band — `systemBar`, the top's
 *   before the bottom's; cut to a sliver at its scroll container's edge
 *   (`Clips.cutSliver` by the exposure's minimum piece) — `cut`; drawn over
 *   — `covered`; its centre under a keyboard line no guard acts on
 *   (`witnessed: false`, idb's band) — `underKeyboard`; else `reachable`.
 *   Under a witnessed line (the window's, WDA's) the guard acts, not the
 *   judgement: the tap's guard has already looked at the centre, and the
 *   stop's is the next tap's. Off the screen and in a band are
 *   mutually exclusive — a centre in a band lies inside a box — so their
 *   order is moot. Cut before cover: a covered sliver is reported cut at a
 *   named edge, whose remedy is a scroll toward it.
 * - `facts.screen` is the frame judged: the stop's box cut above its
 *   keyboard line; the tap's box less the system bands, cut above a line no
 *   guard acts on.
 * - What each verb counts:
 *   - the stop (`{ of: 'stop' }`) judges in its frame — the box, cut above
 *     `keyboardTop` when given (the box's width, from its top down to the
 *     line; a line at or above its top leaves nothing: no exposure is
 *     asked, nothing shows) — `underKeyboard` too when nothing of it lies
 *     above any line. Plain: a sliver is cut, and only a cover over
 *     the centre covers. `fully`: no cut — a stop flush with a clipping
 *     container is scroll_until's flush probe's
 *     (interact/scroll-rounds.ts#PROBE_REACH) — and any cover covers (the
 *     one over the centre, else the last drawn).
 *   - the tap (`{ of: 'tap' }`) judges in the box that holds the centre (the
 *     first box when none does), less the system bands, so a moved tap is
 *     never aimed into one. A cover over the centre moves the tap to the
 *     centre of the largest piece of the node nothing is drawn over, when
 *     both its sides reach the minimum (draw-order.ts#Exposure.tapAt) —
 *     `reachable`, `moved`; else `covered`, with the largest piece. The
 *     piece is chosen above `keyboardTop` when given: a moved tap is never
 *     aimed under the keyboard. The tap asks with the tree's own line first
 *     (idb's band, free), and again with a reading's merged in only when the
 *     centre is covered, so the keyboard is read only then
 *     (interact/resolve.ts#aimClearOfChrome).
 * - `facts` are the judgement's inputs, whatever the kind: what a caller's
 *   motion and sentences read (scroll_until's best-so-far, its far-edge
 *   turn and its failure text).
 *
 * Why so:
 * - The plain stop is the next tap's point: its centre on the screen and
 *   under nothing, so `scroll_until X` then `tap X` agree. A stop that was
 *   any intersection reported a row under a pinned CONTINUE bar "fully
 *   visible after 0 swipes"; one with its centre past the screen's edge
 *   ("visible … CLIPPED 40%") handed the tap an off-screen refusal.
 * - On the SCREEN, not the frame cut above a keyboard: a centre under a
 *   witnessed keyboard stops, and the tap's keyboard guard hides the
 *   keyboard. Under idb's band no guard acts (an idb reading is `unknown`,
 *   K5d): a centre there — in the number pad's strip 589–596 between the
 *   band's top and the keys, or under a key — was stopped on and tapped,
 *   pressing the keyboard, so it is `underKeyboard` for both verbs, never a
 *   key named as a cover (owner decision D2).
 * - A centre in a system band is off the screen for a tap and for both
 *   stops — measured: one stroke flung `priority_select` to `24,-20` and
 *   the plain stop stopped with its centre at (201,6), where the tap
 *   pressed the status bar. Only the centre: the rest of the rect is judged
 *   against the box (`fully` judges clipping against the whole box), so
 *   full-bleed content at the top stops once its ROUNDED centre lies below
 *   the band; one at y 0 shorter than twice the band less a point (122 pt
 *   or less under 62; 123 pt rounds its centre 61.5 to 62 and stops) stops
 *   neither way, and its failure names the status bar.
 * - The navigation band likewise, whatever the navigation mode (gesture or
 *   three buttons; the tree cannot tell them apart without one more device
 *   read): measured on mp-native's Account Detail, drawn edge to edge, its
 *   `row_4` lies wholly in 2154–2220 of a 2220-px Pixel_3a, under the
 *   navigation bar, and a tap went to (540,2186) — on three-button
 *   navigation, Back, Home or Recents. A scroll moves it out.
 * - A sliver: uiautomator cuts every rect to its scroller, so a cut node's
 *   centre is always on the screen; the stop handed back the very strip the
 *   tap refuses, and a tap on it was reported done and did nothing.
 *   Scrolling on reveals it.
 * The owner's decisions for the centre and the covers:
 * docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md
 * docs/bugs/2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md
 *
 * Residuals:
 * - The stop's frame is not cut below the status band: a node lying only in
 *   the band counts as a cover for `fully` and lowers `shows`.
 * - Both system bands are cut from a PORTRAIT box only. Android keeps its
 *   status bar at the top in landscape (a point under it there is judged on
 *   the screen), and its navigation bar moves to a side, where nothing
 *   reads it (adapters/android.ts#parseNavigationBand reads no band on a
 *   turned display).
 * - The navigation band fails open — no band, judged as before it was
 *   read — on a `dumpsys window displays` that lists a second display of a
 *   different size, on a display not in its natural rotation (r≠0), and on
 *   one whose natural rotation is landscape (a tablet): portrait phones only.
 * - On a screen whose turn is suggested but witnessed by no window (two
 *   `boxes`), the tap accepts a point that lies only in the other
 *   orientation.
 * - Under idb's band a target whose centre lies under it is refused, even
 *   with a large piece of it above the band: no tap is moved off a centre
 *   the keyboard holds.
 * - Which nodes of idb's band are the keyboard's own, under no line, is
 *   read by shape (draw-order.ts#sharesRow): a key alone on its row (a lone
 *   QuickType suggestion) is refused as content, and two app nodes side by
 *   side behind the keyboard, not overlapping, are judged as keys.
 */
export interface Scene {
  /** The tree's draw order (draw-order.ts#drawOrder). */
  readonly order: DrawOrder;
  /** The tree's clip facts (geometry.ts#clipsOf), their ancestry as draw order reads it (draw-order.ts#listsAncestry). */
  readonly clips: Clips;
  standing(node: UiNode, screen: StandingScreen | undefined, purpose: Purpose): Standing;
}

/**
 * What a verb means to do with the node — `scroll_until`'s stop, `fully` or
 * plain, or a tap — and the soft keyboard's line the caller applies, if any
 * (ui-tree/keyboard-cover.ts#keyboardEdge builds it; `Scene`'s contract
 * says how each verb applies it, and what `witnessed` changes).
 */
export type Purpose = { readonly of: 'stop'; readonly fully: boolean; readonly keyboardTop?: KeyboardLine } | { readonly of: 'tap'; readonly keyboardTop?: KeyboardLine };

/** The screen a standing is judged on: the usable screen's boxes and its system bands. */
export type StandingScreen = Pick<UsableScreen, 'box' | 'boxes' | 'statusBand' | 'navigationBand'>;

/**
 * A system band a centre lies in, with the line its sentence quotes: the
 * status band's at the screen's TOP is a height (the band's bottom line,
 * `UsableScreen.statusBand`), the navigation band's at its BOTTOM a top
 * line (`UsableScreen.navigationBand`).
 */
export type SystemBar = { readonly edge: 'top'; readonly bottom: number } | { readonly edge: 'bottom'; readonly top: number };

/** What a standing was judged from — every kind carries them. */
export interface StandingFacts {
  /** The point a tap presses (selectors.ts#tapPoint). */
  readonly centre: Point;
  /** The frame judged in: the stop's box, cut above the keyboard line when one applies (no height when it leaves nothing); the tap's box less the system bands, cut above a line no guard acts on. */
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
  /** `at`: the point a tap presses — the centre, or (`moved`, the tap's) the centre of the largest uncovered `piece`, `cover` being over the centre, chosen above a keyboard line when one applied. */
  | { readonly kind: 'reachable'; readonly at: Point; readonly moved?: { readonly piece: Rect; readonly cover: UiNode; readonly aboveKeyboard: boolean } }
  /** `visible`: the most of the node inside any box judged. */
  | { readonly kind: 'offScreen'; readonly at: Point; readonly visible: number }
  | { readonly kind: 'systemBar'; readonly at: Point; readonly bar: SystemBar }
  | { readonly kind: 'clipped'; readonly edges: readonly Edge[] }
  | { readonly kind: 'cut'; readonly cut: Cut; readonly minPiece: number }
  /** `largest` (the tap's): the largest piece nothing is drawn over, under the minimum; `aboveKeyboard`: judged above a keyboard line. */
  | { readonly kind: 'covered'; readonly cover: UiNode; readonly largest?: Rect; readonly aboveKeyboard: boolean }
  /** `line`: the keyboard line its centre lies under (`Scene`'s contract says when a verb is stopped by it). */
  | { readonly kind: 'underKeyboard'; readonly line: KeyboardLine }
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
    standing: (node, screen, purpose) => {
      const centre = tapPoint(node);
      const boxes = screen === undefined ? rootBoxes(tree) : purpose.of === 'stop' ? [screen.box] : screen.boxes;
      const judged: Judged = { scene, node, centre, place: placeOf(centre, boxes, screen) };
      return purpose.of === 'stop'
        ? stopStanding(judged, screen?.box ?? tree.rect, purpose.fully, purpose.keyboardTop)
        : tapStanding(judged, chosenBox(centre, screen, tree, node), boxes ?? [], screen, purpose.keyboardTop);
    },
  };
  return scene;
}

/**
 * THE on-screen rule for a point about to be tapped — the target's centre
 * (`Scene.standing`) and a configured keyboard dismissal's
 * (interact/keyboard-in-tree.ts#pickDismissal): inside any of the screen's
 * `boxes` less its system bands. With no screen (no usable device size and
 * no window in the tree), inside the tree's root rect when it has one; with
 * none, on screen — the rule exists to stop a false "Tapped", and must never
 * be why a tap on a device that could not report its size did not happen.
 * The point is the one SENT — `tapPoint` rounds — so a centre at x 401.5 on
 * a 402-wide screen is judged at 402, off it.
 *
 * Measured: idb lists a scroll view's content below the fold with real
 * rects, and a tap at (94,895) on a 402x874 screen landed nowhere and was
 * reported done; a tap at (201,6) went to iOS's status bar, which scrolled the form to its
 * top, and one at (256,3) on Google Contacts' collapsed app bar to
 * Android's; one at (540,2186) on mp-native's Account Detail, drawn edge to
 * edge, to the navigation bar.
 * docs/bugs/2026-10-08-ios-tap-off-screen-reported-done.md
 */
export function onScreen(point: Point, tree: UiNode, screen: StandingScreen | undefined): boolean {
  return placeOf(point, screen?.boxes ?? rootBoxes(tree), screen) === 'on';
}

/** A node being judged, and where its centre lies. */
interface Judged {
  readonly scene: Scene;
  readonly node: UiNode;
  readonly centre: Point;
  readonly place: Place;
}

/** Where a point lies: on the screen, in a system band, or off it. */
type Place = 'on' | 'off' | SystemBar;

/** The no-screen boxes: the tree's root rect, or none (undefined) when it has no area — every point on the screen. */
const rootBoxes = (tree: UiNode): Rect[] | undefined => (rectArea(tree.rect) > 0 ? [tree.rect] : undefined);

/** `box` less both system bands, judged on its own shape. */
const lessSystemBands = (box: Rect, bands: Pick<StandingScreen, 'statusBand' | 'navigationBand'> | undefined): Rect =>
  aboveNavigationBand(belowStatusBand(box, bands), bands, box);

/** Where `point` lies against `boxes` (none: on, failing open) and their system bands: on, in the top band, in the bottom band (in that order), or off. */
function placeOf(point: Point, boxes: readonly Rect[] | undefined, bands: Pick<StandingScreen, 'statusBand' | 'navigationBand'> | undefined): Place {
  if (boxes === undefined || boxes.some((box) => containsPoint(lessSystemBands(box, bands), point))) return 'on';
  // The bands only: `bands` may be a whole screen, whose own `boxes` must not stand in for the ones judged (the stop's box alone).
  const judged = { boxes, statusBand: bands?.statusBand, navigationBand: bands?.navigationBand };
  if (inStatusBand(point, judged)) return { edge: 'top', bottom: bands?.statusBand ?? 0 };
  if (inNavigationBand(point, judged)) return { edge: 'bottom', top: bands?.navigationBand ?? 0 };
  return 'off';
}

/** The tap's box: the box that holds the centre, else the first; with no screen the tree's root rect, or the node's own when the root has no area. */
const chosenBox = (centre: Point, screen: StandingScreen | undefined, tree: UiNode, node: UiNode): Rect =>
  screen?.boxes.find((b) => containsPoint(b, centre)) ?? screen?.box ?? (rectArea(tree.rect) > 0 ? tree.rect : node.rect);

/**
 * THE ORDER (`Scene`'s contract), once for both verbs, after what only the
 * stop judges first: off the screen, a system band, cut, covered (`cover`:
 * the verb's answer when something is drawn over it, else undefined), the
 * centre under `keyboard` (a line no guard acts on) — else reachable at the
 * centre.
 */
function ordered(
  facts: StandingFacts,
  place: Place,
  offScreenVisible: number,
  cut: Cut | undefined,
  cover: () => Standing | undefined,
  keyboard: KeyboardLine | undefined,
): Standing {
  if (place === 'off') return { facts, kind: 'offScreen', at: facts.centre, visible: offScreenVisible };
  if (place !== 'on') return { facts, kind: 'systemBar', at: facts.centre, bar: place };
  if (cut !== undefined && facts.minPiece !== undefined) return { facts, kind: 'cut', cut, minPiece: facts.minPiece };
  return cover() ?? (keyboard !== undefined && facts.centre.y >= keyboard.y ? { facts, kind: 'underKeyboard', line: keyboard } : { facts, kind: 'reachable', at: facts.centre });
}

/** `box` cut above a keyboard line — the box's width, from its top down to the line (no height for a line at or above its top); `box` itself with no line or one at or below its bottom. */
const aboveLine = (box: Rect, line: KeyboardLine | undefined): Rect =>
  line === undefined || line.y >= box.y + box.height ? box : { ...box, height: Math.max(0, line.y - box.y) };

/** The facts of a node judged in `frame`, from its exposure there. */
function factsIn({ scene, node, centre }: Judged, frame: Rect): { facts: StandingFacts; seen: Exposure } {
  const seen = scene.order.exposure(node, frame);
  const sliver = scene.clips.cutSliver(node, seen.minPiece);
  const facts: StandingFacts = {
    centre,
    screen: frame,
    visible: visibleFractionInViewport(node.rect, frame),
    clipped: clippedEdges(node.rect, frame),
    covers: seen.covers,
    reaches: seen.reaches,
    ...(seen.centreCover !== undefined && { centreCover: seen.centreCover }),
    shows: seen.shows,
    minPiece: seen.minPiece,
    ...(sliver !== undefined && { sliver }),
  };
  return { facts, seen };
}

/** The stop's standing (`Scene`'s contract). */
function stopStanding(judged: Judged, box: Rect, fully: boolean, line: KeyboardLine | undefined): Standing {
  const { node, centre, place } = judged;
  if (line !== undefined && line.y <= box.y) {
    const facts: StandingFacts = { centre, screen: { ...box, height: 0 }, visible: 0, clipped: [], covers: [], reaches: [], shows: 0 };
    return { facts, kind: 'underKeyboard', line };
  }
  const { facts } = factsIn(judged, line === undefined ? { ...box } : { ...box, height: line.y - box.y });
  if (facts.visible === 0) {
    if (line !== undefined && visibleFractionInViewport(node.rect, box) > 0) return { facts, kind: 'underKeyboard', line };
    return { facts, kind: 'offScreen', at: centre, visible: 0 };
  }
  if (fully && facts.clipped.length > 0) return { facts, kind: 'clipped', edges: facts.clipped };
  const cover = fully && facts.covers.length > 0 ? (facts.centreCover ?? facts.covers[facts.covers.length - 1]) : facts.centreCover;
  return ordered(
    facts,
    place,
    facts.visible,
    fully ? undefined : facts.sliver,
    () => (cover === undefined ? undefined : { facts, kind: 'covered', cover, aboveKeyboard: line !== undefined }),
    line?.witnessed === false ? line : undefined,
  );
}

/** The tap's standing (`Scene`'s contract): judged in `chosen` less the system bands — cut above a line no guard acts on — the piece above any line. */
function tapStanding(judged: Judged, chosen: Rect, boxes: readonly Rect[], bands: StandingScreen | undefined, line: KeyboardLine | undefined): Standing {
  const { scene, node, place } = judged;
  const box = lessSystemBands(chosen, bands);
  const within = aboveLine(box, line);
  const unwitnessed = line?.witnessed === false ? line : undefined;
  const frame = unwitnessed === undefined ? box : within;
  const { facts, seen } = factsIn(judged, frame);
  const offScreenVisible = boxes.length === 0 ? 0 : Math.max(...boxes.map((b) => visibleFractionInViewport(node.rect, b)));
  const cover = (): Standing | undefined => {
    const over = seen.centreCover;
    if (over === undefined) return undefined;
    const aboveKeyboard = within !== box;
    const piece = within === frame ? seen : scene.order.exposure(node, within);
    if (piece.tapAt === undefined) return { facts, kind: 'covered', cover: over, ...(piece.largest !== undefined && { largest: piece.largest }), aboveKeyboard };
    if (!piece.tapAt.moved) return { facts, kind: 'reachable', at: piece.tapAt.point };
    return { facts, kind: 'reachable', at: piece.tapAt.point, moved: { piece: piece.tapAt.piece, cover: over, aboveKeyboard } };
  };
  return ordered(facts, place, offScreenVisible, facts.sliver, cover, unwitnessed);
}
