import { rectArea, rectIntersection, rectsOverlap, SCREEN_SIZED_FRACTION, type DeviceScreen, type Point, type Rect, type UiNode } from '../adapters/types.js';
import { drawOrder, listsAncestry, type DrawOrder, type Exposure } from './draw-order.js';
import {
  aboveNavigationBand,
  belowStatusBand,
  clippedEdges,
  clipsOf,
  containsPoint,
  overlapsPastSlack,
  rectCentre,
  visibleFractionInViewport,
  type Clips,
  type Cut,
  type Edge,
} from './geometry.js';
import type { KeyboardLine } from './keyboard-cover.js';
import { tapPoint } from './selectors.js';
import { treeScreen, type UsableScreen } from './usable-screen.js';

/**
 * THE SCENE of one tree: its draw order (draw-order.ts) and its clip facts
 * (geometry.ts#clipsOf), each derived once, on first use — and the
 * STANDING of a node in it: where the node stands on a screen for what a
 * verb means to do with it, one ordered judgement for the tap,
 * `scroll_until`'s stop and the pixel assert. Facts cross this seam; the
 * sentences, remedies and keyboard actions stay with the callers, and the
 * keyboard guard (K1) alone acts on the keyboard.
 *
 * Contract of `standing(node, screen, purpose)`:
 * - The point judged is the node's centre as a tap sends it
 *   (selectors.ts#tapPoint). It is ON the screen when it lies in a box less
 *   the system bands: the status band at a portrait box's top
 *   (geometry.ts#belowStatusBand) and the navigation band at its bottom
 *   (geometry.ts#aboveNavigationBand).
 * - WHICH BOX each purpose judges, picked here: the tap ANY of
 *   `screen.boxes`; both stops `screen.box` alone (a caller judging in
 *   several boxes asks once a box and keeps the best — scroll_until's read,
 *   box by box, interact/scroll-read.ts#judgeRead); the pixel assert the
 *   usable screen's single `oriented` box (`singleBox`, D6), whatever
 *   `box` is. With no screen, every purpose reads ONE definition,
 *   usable-screen.ts#treeScreen: the tree's own screen is the one box; on
 *   a root of no area (its `failsOpen`) a touch — the tap, either stop —
 *   leaves every point on the screen and judges in the node's own rect,
 *   and the pixel assert judges on the largest node (`treeScreen`'s box).
 * - THE ORDER, once for every verb — after what only the stops judge first
 *   (nothing of it in its frame: `underKeyboard` when a keyboard line
 *   applies and the node is in the box, else `offScreen`; the `fully`
 *   purpose: a frame edge it runs past, `clipped`): its centre off the screen —
 *   `offScreen`; its centre in a system band — `systemBar`, the top's
 *   before the bottom's (for `fully`, any of the node in a band past the
 *   slack too: the band as a region, `systemBandOver`, with its rect); cut
 *   to a sliver at its scroll container's edge
 *   (`Clips.cutSliver` by the exposure's minimum piece) — `cut`; drawn over
 *   — `covered`; its centre under a keyboard line no guard acts on
 *   (`witnessed: false`, idb's band) — `underKeyboard`; else `reachable`.
 *   Under a witnessed line (the window's, WDA's) the guard acts, not the
 *   judgement: the tap's guard has already looked at the centre, and the
 *   stop's is the next tap's. Off the screen and in a band are mutually
 *   exclusive — a centre in a band lies inside a box — so their order is
 *   moot. Cut before cover: a covered sliver is reported cut at a named
 *   edge, whose remedy is a scroll toward it.
 *   docs/adr/0005-cut-before-cover.md
 * - THE PIXEL ASSERT (`PixelPurpose`) judges a REGION, not a point, in
 *   one box, the usable screen's `oriented` (verify/pixel-poll.ts hands it
 *   the usable screen) — the same order, its place a region's:
 *   - under the band `keyboardTop` marks (`bandRect`) when the node's rect
 *     meets it at all — `underKeyboard`, before the system bands; its
 *     `keyboardTop` is idb's band only, the reading's frame being the
 *     pixel poll's own question, asked before;
 *     docs/adr/0010-pixel-assert-keyboard-first.md
 *   - what it `reads` overlapping a system band past the slack
 *     (geometry.ts#overlapsPastSlack), the status band's before the
 *     navigation band's — `systemBar`, with the band's rect; never
 *     `offScreen` (it never judged that);
 *     docs/adr/0002-pixel-overlap-slack.md
 *   - cut only at the navigation bar and only for a reader of `glyphs`
 *     (`cutAtNavigationBar`) — `cut`, with the bar;
 *     docs/adr/0009-android-navigation-band.md
 *   - covered by a PIXEL cover (draw-order.ts#DrawOrder.paintsOver)
 *     meeting what it reads below the status band, any of them, not only
 *     one over the centre: the one on top at its centre, else the last
 *     drawn, with its `reach` — and `overRoot` when the node is a flat
 *     list's screen-sized root (draw-order.ts#listsAncestry, read here so
 *     the pixel assert does not).
 *     docs/adr/0001-pixel-assert-fails-closed-on-chrome.md
 *   The keyboard's band is drawn on `oriented`, the box judged (not the
 *   tree's own screen), so a device wider than the tree quotes the device's
 *   band (idb's number pad on a 430x932 device: `0,589 430x343`), and a
 *   node listed between the tree's bottom and the device's (`42,885
 *   318x20`) lies under it.
 * - `facts.screen` is the frame judged, per purpose: the stop's box cut
 *   above its keyboard line; the tap's box less the system bands, cut above
 *   a line no guard acts on; the pixel's box less the status band. The
 *   covers (`facts.covers`, `reaches`, `shows`, `centreCover`) are judged in
 *   it below the status band — the pixel's only where that meets what it
 *   reads, as `exposure`'s touch covers (the kind names the pixel cover).
 *   docs/adr/0008-scroll-until-exposure-box-below-status-band.md
 * - What each verb counts:
 *   - both stops judge in one frame (`inStopFrame`) — the box, cut above
 *     `keyboardTop` when given (the box's width, from its top down to the
 *     line; a line at or above its top leaves nothing: no exposure is
 *     asked, nothing shows) — `underKeyboard` too when nothing of it lies
 *     above any line. The plain stop (`{ of: 'stop' }`): a sliver is cut,
 *     and only a cover over the centre covers. The `fully` stop
 *     (`{ of: 'fully' }`, `scroll_until`'s `fully: true`) is its own
 *     purpose, its rules its judgement (`fullyStanding`): an edge past the
 *     frame first (`clipped`, only this purpose's); no cut — a stop flush
 *     with a clipping container is scroll_until's flush probe's
 *     (interact/scroll-rounds.ts#PROBE_REACH); any cover covers (the one
 *     over the centre, else the last drawn); the system bands judged as a
 *     region (below, Why so; `systemBar.band`, only this purpose's); and,
 *     beside the standing, the far edge's frames cut above the navigation
 *     band when that region refused it at the bottom (`farEdgeFrames`).
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
 * - `farEdgeFrames(screen, best, above?)`: the frames `scroll_until`'s far
 *   edge is judged in, cut here with geometry's band cutters from the
 *   usable screen, the applied keyboard's room above its cover and the best
 *   standing, whose `band` decides the navigation cut — no caller re-cuts
 *   a band or reads `band` for it.
 *
 * Why so:
 * - The plain stop is the next tap's point: its centre on the screen and
 *   under nothing, so `scroll_until X` then `tap X` agree. A stop that was
 *   any intersection reported a row under a pinned CONTINUE bar "fully
 *   visible after 0 swipes"; one with its centre past the screen's edge
 *   ("visible … CLIPPED 40%") handed the tap an off-screen refusal.
 * - On the SCREEN, not the frame cut above a keyboard: a centre under a
 *   witnessed keyboard stops, and the tap's keyboard guard hides the
 *   keyboard. Under idb's band no guard acts, so a centre there is
 *   `underKeyboard` for both verbs, never a key named as a cover.
 *   docs/adr/0006-idb-keyboard-band-is-a-keyboard-line.md
 * - A centre in a system band is off the screen for a tap and for both
 *   stops — measured: one stroke flung `priority_select` to `24,-20` and
 *   the plain stop stopped with its centre at (201,6), where the tap
 *   pressed the status bar. The tap and the plain stop judge only the
 *   centre: the rest of the rect may lie in the band, so full-bleed content
 *   at the top stops plain once its ROUNDED centre lies below the band; one
 *   at y 0 shorter than twice the band less a point (122 pt or less under
 *   62; 123 pt rounds its centre 61.5 to 62 and stops) never stops, and its
 *   failure names the status bar. The navigation band likewise, whatever
 *   the navigation mode.
 * - `fully` judges the bands as a REGION, by the pixel assert's rule and
 *   slack (`systemBandOver`): it stops only with none of the node in a band
 *   past the slack, so a pixel assert after it is not refused for a band.
 *   Judged by the centre alone, the pixel remedy "scroll_until … `fully:
 *   true` first" stopped at once on a row reaching 33 px into the
 *   navigation band (accountDetail's `row_30` `66,2088 948x99`, its centre
 *   clear), and the agent looped. A node pinned in a band ends stuck naming
 *   the bar. Not for content no scroll lifts out of a band
 *   (`pinnedSurface`: in no scroll view, a full-bleed header or footer or a
 *   screen-sized node): the `fully` stop stops on it as before, so a rect
 *   assert after it works — no strokes over a modal sheet — and a pixel
 *   assert on it fails closed with its own advice (assert something in it
 *   clear of the bar). A scroll view's content is lifted, whatever its
 *   shape.
 *   docs/adr/0009-android-navigation-band.md
 * - A sliver: uiautomator cuts every rect to its scroller, so a cut node's
 *   centre is always on the screen; the stop handed back the very strip the
 *   tap refuses, and a tap on it was reported done and did nothing.
 *   Scrolling on reveals it.
 * The owner's decisions for the centre and the covers:
 * docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md
 * docs/bugs/2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md
 *
 * Residuals (D4–D6 are ADR 0012's):
 * - D4: the pixel assert reads the device's size from the memo, never
 *   afresh: after a fold or a `wm size` change it judges the old box, and
 *   draws idb's band on it.
 * - D5: the pixel assert measures a node its scroll container cuts on what
 *   shows of it (the ocr crop at the navigation bar aside).
 * - D6: the pixel assert judges one box, `oriented`: the other orientation
 *   of a turn suggested but not witnessed is never judged; landscape is
 *   unmeasured.
 *   docs/adr/0012-pixel-assert-residuals-d4-d6.md
 * - A `fully` stop on content no scroll lifts out of a band
 *   (`pinnedSurface`) does not promise a pixel assert: what lies under a
 *   bar fails it closed, with the advice to assert something in it clear
 *   of the bar. A scroll view's content taller than the room between the
 *   bands but not screen-sized never stops `fully`: it ends stuck naming
 *   the bar.
 * - The far edge's frames (`farEdgeFrames`) keep the round's shapes: the
 *   status band is cut from each box on its own shape, the navigation band
 *   on the first box's (`screen.box`); the frame above a keyboard cover is
 *   the first box's x, y and width with the cover's top y as its HEIGHT
 *   (not the top less the box's y — the boxes lie at the origin, so the two
 *   agree), and only when the cover leaves something above it: else every
 *   box, uncut by the keyboard. Those two are decided where the cover's
 *   `above` is built (interact/scroll-read.ts#Cover); this module takes the
 *   size it is handed. Its cuts are geometry's band cutters, not
 *   `systemBands`: a change to how `systemBands` composes the two (its fail
 *   open when the navigation band reaches above the status band, say) does
 *   not reach the far edge's frames.
 * - The navigation bar's cut is read by shape: a whole last row resting
 *   flush with it fails an ocr assert closed too.
 * - Both system bands are cut from a PORTRAIT box only; the navigation band
 *   is read on portrait phones only (adapters/android.ts#parseNavigationBand).
 * - Android keeps its status bar at the top in landscape: a point under it
 *   there is judged on the screen.
 * - On a turn suggested but witnessed by no window, the tap accepts a point
 *   that lies only in the other orientation.
 * - Under idb's band a target whose centre lies under it is refused, even
 *   with a large piece of it above the band.
 * - idb's own keys are read by shape (draw-order.ts#sharesRow): a key alone
 *   on its row is refused as content; two app nodes side by side behind the
 *   keyboard read as keys.
 *   docs/adr/0007-idb-keyboard-key-row-tiling.md
 */
export interface Scene {
  /** The tree's draw order (draw-order.ts#drawOrder). */
  readonly order: DrawOrder;
  /** The tree's clip facts (geometry.ts#clipsOf), their ancestry as draw order reads it (draw-order.ts#listsAncestry). */
  readonly clips: Clips;
  /** The pixel assert's standing: its own union (`PixelStanding`), on the usable screen's `oriented` box, picked here. */
  standing(node: UiNode, screen: UsableScreen | undefined, purpose: PixelPurpose): PixelStanding;
  /** The tap's standing: a `Standing` never `clipped` (`TapStanding`). */
  standing(node: UiNode, screen: StandingScreen | undefined, purpose: TapPurpose): TapStanding;
  /** The stops' standing (and the tap's, asked as a `TouchPurpose`). */
  standing(node: UiNode, screen: StandingScreen | undefined, purpose: TouchPurpose): Standing;
  standing(node: UiNode, screen: UsableScreen | undefined, purpose: Purpose): Standing | PixelStanding;
}

/**
 * What a verb means to do with the node — `scroll_until`'s plain stop
 * (`stop`), its `fully: true` stop (`fully`), a tap, or the pixel assert's
 * read (`PixelPurpose`) — and the soft
 * keyboard's line the caller applies, if any
 * (ui-tree/keyboard-cover.ts#keyboardEdge builds it; `Scene`'s contract
 * says how each verb applies it, and what `witnessed` changes).
 */
export type Purpose = TouchPurpose | PixelPurpose;

/**
 * The purposes that judge a point a touch goes to — `scroll_until`'s two
 * stops and the tap — answered by a `Standing`. `fully` is its own purpose,
 * not a flag on the stop: the rules it switches are its judgement
 * (`fullyStanding`), read in one place (`Scene`'s contract).
 */
export type TouchPurpose = { readonly of: 'stop' | 'fully'; readonly keyboardTop?: KeyboardLine } | TapPurpose;

/** The tap's purpose (`TouchPurpose`). */
export type TapPurpose = { readonly of: 'tap'; readonly keyboardTop?: KeyboardLine };

/**
 * The pixel assert's purpose (`Scene`'s contract): `reads`, the part of the
 * node's rect its measurement reads (the colour sampler's inset rect,
 * verify/color-parity.ts#colorSampleRect, or the ocr crop's whole rect);
 * `glyphs`, whether it reads glyphs (the ocr assert), which a cut at the
 * node's edge garbles where a colour sample of what shows stays true.
 */
export type PixelPurpose = { readonly of: 'pixel'; readonly reads: Rect; readonly glyphs: boolean; readonly keyboardTop?: KeyboardLine };

/** The screen a standing is judged on: the usable screen's boxes and its system bands. */
export type StandingScreen = Pick<UsableScreen, 'box' | 'boxes' | 'statusBand' | 'navigationBand'>;

/**
 * A system band a centre lies in, with the line its sentence quotes: the
 * status band's at the screen's TOP is a height (the band's bottom line,
 * `UsableScreen.statusBand`), the navigation band's at its BOTTOM a top
 * line (`UsableScreen.navigationBand`).
 */
export type SystemBar = { readonly edge: 'top'; readonly bottom: number } | { readonly edge: 'bottom'; readonly top: number };

/** The navigation bar: the system bar at the screen's bottom. */
export type NavigationBar = Extract<SystemBar, { readonly edge: 'bottom' }>;

/** The status bar: the system bar at the screen's top. */
type StatusBar = Extract<SystemBar, { readonly edge: 'top' }>;

/** What a standing was judged from — every kind carries them. */
export interface StandingFacts {
  /** The point a tap presses (selectors.ts#tapPoint). */
  readonly centre: Point;
  /**
   * The frame judged in, per purpose: the stop's box, cut above the keyboard line when one applies (no height when it
   * leaves nothing); the tap's box less the system bands, cut above a line no guard acts on; the pixel's box less the
   * status band.
   */
  readonly screen: Rect;
  /** The fraction of the node inside the frame, covers or not. */
  readonly visible: number;
  /** The frame's edges the node extends past (geometry.ts#clippedEdges). */
  readonly clipped: readonly Edge[];
  /** draw-order.ts#Exposure's, inside the frame below the status band (the pixel's: where that meets what it reads): the covers, where each presses, the one over the centre, and what shows. */
  readonly covers: readonly UiNode[];
  readonly reaches: readonly Rect[];
  readonly centreCover?: UiNode;
  /** draw-order.ts#Exposure's: what the `target` column excused at the centre — no cover, but what a tap there may press. */
  readonly centreExcused: readonly UiNode[];
  readonly shows: number;
  /** The least piece a tap may be aimed at (draw-order.ts#Exposure.minPiece); absent when the frame leaves nothing to judge. */
  readonly minPiece?: number;
  /** The node's cut to a sliver by its scroll container under `minPiece` (geometry.ts#Clips.cutSliver), whatever the kind — never judged for the pixel (D5, ADR 0012). */
  readonly sliver?: Cut;
}

/** Where the node stands for a touch (the tap, the stop), and why: `facts`, and one kind with what its sentence quotes. */
export type Standing = { readonly facts: StandingFacts } & (
  /** `at`: the point a tap presses — the centre, or (`moved`, the tap's) the centre of the largest uncovered `piece`, `cover` being over the centre, chosen above a keyboard line when one applied. */
  | { readonly kind: 'reachable'; readonly at: Point; readonly moved?: { readonly piece: Rect; readonly cover: UiNode; readonly aboveKeyboard: boolean } }
  /** `visible`: the most of the node inside any box judged. */
  | { readonly kind: 'offScreen'; readonly at: Point; readonly visible: number }
  /** `band`: the band's rect on the box, only when the node's rect (not its centre) lies in it past the slack — a `fully` stop's region rule. */
  | { readonly kind: 'systemBar'; readonly at: Point; readonly bar: SystemBar; readonly band?: Rect }
  | { readonly kind: 'clipped'; readonly edges: readonly Edge[] }
  | { readonly kind: 'cut'; readonly cut: Cut; readonly minPiece: number }
  /** `largest` (the tap's): the largest piece nothing is drawn over, under the minimum; `aboveKeyboard`: judged above a keyboard line. */
  | { readonly kind: 'covered'; readonly cover: UiNode; readonly largest?: Rect; readonly aboveKeyboard: boolean }
  /** `line`: the keyboard line its centre lies under (`Scene`'s contract says when a verb is stopped by it). */
  | { readonly kind: 'underKeyboard'; readonly line: KeyboardLine }
);

/** Where the node stands for the tap: a `Standing` of every kind but `clipped`, which only a `fully` stop judges. */
export type TapStanding = Exclude<Standing, { readonly kind: 'clipped' }>;

/** Where the node stands for the pixel assert (`Scene`'s contract: a region, never off the screen, never clipped), and why. */
export type PixelStanding = { readonly facts: StandingFacts } & (
  | { readonly kind: 'reachable'; readonly at: Point }
  /** `band`: the band's rect on the box, which what it reads overlaps. */
  | { readonly kind: 'systemBar'; readonly at: Point; readonly bar: SystemBar; readonly band: Rect }
  /** Its own cut: at the navigation bar's top, `container` the clipping scroller flush with it. */
  | { readonly kind: 'cut'; readonly bar: NavigationBar; readonly container: Rect }
  /** `reach`: where the cover presses (its rect, or a pinned bar's reach); `overRoot`: the node is a flat list's screen-sized root and the cover the app's content listed on it. */
  | { readonly kind: 'covered'; readonly cover: UiNode; readonly reach: Rect; readonly aboveKeyboard: false; readonly overRoot?: true }
  /** `band`: the band the line marks on the box, which the node's rect meets. */
  | { readonly kind: 'underKeyboard'; readonly line: KeyboardLine; readonly band: Rect }
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
    standing,
  };
  function standing(node: UiNode, screen: UsableScreen | undefined, purpose: PixelPurpose): PixelStanding;
  function standing(node: UiNode, screen: StandingScreen | undefined, purpose: TapPurpose): TapStanding;
  function standing(node: UiNode, screen: StandingScreen | undefined, purpose: TouchPurpose): Standing;
  function standing(node: UiNode, screen: UsableScreen | undefined, purpose: Purpose): Standing | PixelStanding;
  function standing(node: UiNode, screen: StandingScreen | UsableScreen | undefined, purpose: Purpose): Standing | PixelStanding {
    const judged: Judged = { scene, node, centre: tapPoint(node) };
    if (purpose.of === 'pixel') {
      // The overloads hand the pixel purpose a usable screen (one with `oriented`): it picks its own box, `oriented` (`singleBox`).
      const single = singleBox(screen !== undefined && 'oriented' in screen ? screen : treeScreen(tree));
      return pixelStanding(judged, regionPlace(node.rect, purpose, single.box, single), single.box, single, purpose, !listsAncestry(tree));
    }
    const touch = touchScreen(screen, tree);
    if (purpose.of === 'tap') {
      return tapStanding(judged, placeOf(judged.centre, touch?.boxes, touch), touch === undefined ? node.rect : chosenBox(judged.centre, touch), touch?.boxes ?? [], touch, purpose.keyboardTop);
    }
    const place = placeOf(judged.centre, touch === undefined ? undefined : [touch.box], touch);
    const box = touch?.box ?? node.rect;
    return purpose.of === 'fully' ? fullyStanding(judged, place, box, touch, purpose.keyboardTop) : stopStanding(judged, place, box, touch, purpose.keyboardTop);
  }
  return scene;
}

/** A node being judged, and its centre. */
interface Judged {
  readonly scene: Scene;
  readonly node: UiNode;
  readonly centre: Point;
}

/** Where a point lies: on the screen, off it, or in a system band — with the band's rect when a region, not the point, lies in it. */
type PointPlace = 'on' | 'off' | { readonly bar: SystemBar; readonly band?: Rect };

/** A system band on a box: the bar it is, as a sentence quotes it, and its rect on the box. */
interface SystemBand<B extends SystemBar = SystemBar> {
  readonly bar: B;
  readonly band: Rect;
}

/** Where the pixel assert's region lies: on the screen, in a system band (with the band's rect), or under the band a keyboard line marks — never off the screen. */
type RegionPlace = 'on' | { readonly bar: SystemBar; readonly band: Rect } | { readonly keyboard: KeyboardLine; readonly band: Rect };

/**
 * The screen a touch (the tap, either stop) is judged on: the one handed
 * in, else the tree's own (usable-screen.ts#treeScreen, THE "no device
 * screen") — or none when that fails open (a root of no area): every point
 * on the screen, the node judged in its own rect.
 */
function touchScreen(screen: StandingScreen | undefined, tree: UiNode): StandingScreen | undefined {
  if (screen !== undefined) return screen;
  const own = treeScreen(tree);
  return own.failsOpen ? undefined : own;
}

/**
 * Where `point` lies against `boxes` (none: on, failing open) and their
 * system bands (`systemBands`): on, in the top band, in the bottom band (in
 * that order), or off. THE on-screen rule for a point about to be tapped —
 * the target's centre, and a configured keyboard dismissal's
 * (interact/keyboard-in-tree.ts#pickDismissal asks the tap's standing,
 * docs/adr/0016-the-dismissal-picker-asks-the-tap-standing.md).
 * With no screen (no usable device size and no window in the tree), the
 * tree's own screen is the one box (`touchScreen`); on a root of no area,
 * none, and every point is on — the rule exists to stop a false "Tapped", and must never be why a
 * tap on a device that could not report its size did not happen. The point
 * is the one SENT — `tapPoint` rounds — so a centre at x 401.5 on a
 * 402-wide screen is judged at 402, off it.
 *
 * Measured: idb lists a scroll view's content below the fold with real
 * rects, and a tap at (94,895) on a 402x874 screen landed nowhere and was
 * reported done; a tap at (201,6) went to iOS's status bar, which scrolled
 * the form to its top, and one at (256,3) on Google Contacts' collapsed app
 * bar to Android's; one at (540,2186) on mp-native's Account Detail, drawn
 * edge to edge, to the navigation bar.
 * docs/bugs/2026-10-08-ios-tap-off-screen-reported-done.md
 */
function placeOf(point: Point, boxes: readonly Rect[] | undefined, bands: Bands): PointPlace {
  if (boxes === undefined) return 'on';
  const judged = boxes.map((box) => systemBands(box, bands));
  if (judged.some(({ clear }) => containsPoint(clear, point))) return 'on';
  const top = judged.find((b) => b.top !== undefined && containsPoint(b.top.band, point))?.top;
  if (top !== undefined) return { bar: top.bar };
  const bottom = judged.find((b) => b.bottom !== undefined && containsPoint(b.bottom.band, point))?.bottom;
  return bottom === undefined ? 'off' : { bar: bottom.bar };
}

/**
 * Where the pixel assert's region lies (`Scene`'s contract): under the band
 * `purpose.keyboardTop` marks on `box` when the node's rect meets it at
 * all; else in the status band, then the navigation band, when what it
 * reads overlaps one past PIXEL_OVERLAP_SLACK (geometry.ts#overlapsPastSlack);
 * else on the screen — never off it (`Scene`'s contract).
 */
function regionPlace(rect: Rect, { reads, keyboardTop }: PixelPurpose, box: Rect, bands: StandingScreen | undefined): RegionPlace {
  if (keyboardTop !== undefined) {
    const band = bandRect(keyboardTop, box);
    if (rectsOverlap(rect, band)) return { keyboard: keyboardTop, band };
  }
  return systemBandOver(reads, box, bands) ?? 'on';
}

/**
 * The system band `rect` overlaps past PIXEL_OVERLAP_SLACK on `box`
 * (geometry.ts#overlapsPastSlack) — the status band's before the
 * navigation band's — or undefined: the bands judged as a region, over
 * what the pixel assert reads (`regionPlace`) and over the node's rect for
 * a `fully` stop, one rule for both.
 * docs/adr/0002-pixel-overlap-slack.md
 */
function systemBandOver(rect: Rect, box: Rect, bands: Bands): SystemBand | undefined {
  const { top, bottom } = systemBands(box, bands);
  if (top !== undefined && overlapsPastSlack(rect, top.band)) return top;
  if (bottom !== undefined && overlapsPastSlack(rect, bottom.band)) return bottom;
  return undefined;
}

/** The screen's system bands, as `StandingScreen` carries them. */
type Bands = Pick<StandingScreen, 'statusBand' | 'navigationBand'> | undefined;

/**
 * THE system bands of `box`, derived once for every judgement: `clear`,
 * the box less both, judged on its own shape (geometry.ts#belowStatusBand,
 * then geometry.ts#aboveNavigationBand — a navigation band reaching above
 * the status band's bottom fails open); and each band only where it has
 * height on the box (portrait, and a band read) — the status band at its
 * top, the navigation band at its bottom, each with its bar.
 */
function systemBands(box: Rect, bands: Bands): { clear: Rect; top?: SystemBand<StatusBar>; bottom?: SystemBand<NavigationBar> } {
  const below = belowStatusBand(box, bands);
  const clear = aboveNavigationBand(below, bands, box);
  const boxBottom = box.y + box.height;
  const bottomTop = clear.y + clear.height;
  return {
    clear,
    ...(below.y > box.y && { top: { bar: { edge: 'top', bottom: bands?.statusBand ?? 0 }, band: { ...box, height: Math.min(below.y, boxBottom) - box.y } } }),
    ...(bottomTop < boxBottom && { bottom: { bar: { edge: 'bottom', top: bands?.navigationBand ?? 0 }, band: { ...box, y: bottomTop, height: boxBottom - bottomTop } } }),
  };
}

/**
 * The band a keyboard line marks on `screen`: the screen's width, from the
 * line to the screen's bottom — idb's band's own shape (soft-keyboard.ts
 * #flatListKeyboardBand: screen-wide, ending at its bottom), the rect a
 * sentence quotes for it (the pixel assert's keyboard miss, through
 * `underKeyboard`; `scroll_until`'s cover, interact/scroll-read.ts
 * #bandCoverOf, on the box its round judges in).
 */
export const bandRect = (line: KeyboardLine, screen: Rect): Rect => ({ x: screen.x, y: line.y, width: screen.width, height: screen.y + screen.height - line.y });

/**
 * The frames `scroll_until`'s far edge is judged in, for one read
 * (interact/scroll-read.ts#judgeRead): `uncutFrames`, the frames short of
 * the far edge is judged in — the screen above an applied keyboard cover
 * when it leaves something (`above`, the size of what it leaves: the
 * first box's x, y and width, the cover's top y as its height), else every
 * box that counts, uncut by the keyboard — each below the status band on
 * its own shape: a target whose centre a fling carried into the band is
 * past the far edge, and the next stroke turns back. `frames`: the same,
 * and above the navigation band when `best` (the best match's standing) is
 * a `fully` stop the band's REGION refused at the bottom (`Standing`'s
 * `band`, which only the `fully` purpose sets) — resting across the band's
 * top with the content above it, it is past the far edge, and the next
 * stroke turns and lifts it. Only then: every other standing judges the far
 * edge in the frames as ever. The cut reads `band` here, beside
 * `fullyStanding`, its only writer, so the region rule and the frame it
 * turns in cannot drift apart; the cuts themselves are geometry's band
 * cutters, the ones `systemBands` composes, not `systemBands` itself. The
 * shapes are kept as the round always cut them, residuals of `Scene`'s
 * contract: the status band on each box's shape, the navigation band on the
 * first box's (`screen.box`).
 */
export function farEdgeFrames(screen: StandingScreen, best: Standing | undefined, above?: DeviceScreen): { frames: Rect[]; uncutFrames: Rect[] } {
  const box = screen.box;
  const uncutFrames = above !== undefined ? [belowStatusBand({ x: box.x, y: box.y, width: above.width, height: above.height }, screen, box)] : screen.boxes.map((b) => belowStatusBand(b, screen));
  const regionAtBottom = best?.kind === 'systemBar' && best.band !== undefined && best.bar.edge === 'bottom';
  return { frames: regionAtBottom ? uncutFrames.map((f) => aboveNavigationBand(f, screen, box)) : uncutFrames, uncutFrames };
}

/** The tap's box: the box that holds the centre, else the first (`touchScreen`'s; the node's own rect when it fails open). */
const chosenBox = (centre: Point, screen: StandingScreen): Rect => screen.boxes.find((b) => containsPoint(b, centre)) ?? screen.box;

/**
 * THE ORDER (`Scene`'s contract), once for every verb, after what only the
 * stop judges first: where it lies (`placed`: off the screen, under a
 * keyboard's band — a region's place only — or in a system band), cut,
 * covered (`cover`: the verb's answer when something is drawn over it,
 * else undefined; asked only past the cut), the centre under a line no
 * guard acts on (`underLine`) — else `reachable`. Each argument is the
 * verb's own answer of that kind, or undefined.
 */
function ordered<S>(placed: S | undefined, cut: S | undefined, cover: () => S | undefined, underLine: S | undefined, reachable: S): S {
  return placed ?? cut ?? cover() ?? underLine ?? reachable;
}

/** A touch's place as its answer: off the screen, or its centre in a system band; undefined when on the screen. */
function pointPlaced(facts: StandingFacts, place: PointPlace, offScreenVisible: number): TapStanding | undefined {
  if (place === 'off') return { facts, kind: 'offScreen', at: facts.centre, visible: offScreenVisible };
  return place === 'on' ? undefined : { facts, kind: 'systemBar', at: facts.centre, bar: place.bar, ...(place.band !== undefined && { band: place.band }) };
}

/** A touch's cut to a sliver as its answer, when the frame left a minimum to judge it by. */
const sliverCut = (facts: StandingFacts, cut: Cut | undefined): TapStanding | undefined =>
  cut !== undefined && facts.minPiece !== undefined ? { facts, kind: 'cut', cut, minPiece: facts.minPiece } : undefined;

/** The centre under `line` (one no guard acts on) as its answer, else undefined. */
const underLine = (facts: StandingFacts, line: KeyboardLine | undefined): TapStanding | undefined =>
  line !== undefined && facts.centre.y >= line.y ? { facts, kind: 'underKeyboard', line } : undefined;

/** `box` cut above a keyboard line — the box's width, from its top down to the line (no height for a line at or above its top); `box` itself with no line or one at or below its bottom. */
const aboveLine = (box: Rect, line: KeyboardLine | undefined): Rect =>
  line === undefined || line.y >= box.y + box.height ? box : { ...box, height: Math.max(0, line.y - box.y) };

/** The facts of a node judged in `frame`, from its exposure there. */
function factsIn({ scene, node, centre }: Judged, frame: Rect, exposed: Rect = frame, { sliver: judgeSliver = true } = {}): { facts: StandingFacts; seen: Exposure } {
  const seen = scene.order.exposure(node, exposed);
  const sliver = judgeSliver ? scene.clips.cutSliver(node, seen.minPiece) : undefined;
  const facts: StandingFacts = {
    centre,
    screen: frame,
    visible: visibleFractionInViewport(node.rect, frame),
    clipped: clippedEdges(node.rect, frame),
    covers: seen.covers,
    reaches: seen.reaches,
    ...(seen.centreCover !== undefined && { centreCover: seen.centreCover }),
    centreExcused: seen.centreExcused,
    shows: seen.shows,
    minPiece: seen.minPiece,
    ...(sliver !== undefined && { sliver }),
  };
  return { facts, seen };
}

/**
 * What both stops judge first, in their frame (`Scene`'s contract): `box`
 * cut above the keyboard line when one applies, its covers judged below the
 * status band on the box's own shape. `outside` is the answer when nothing
 * of the node lies in that frame — the line at or above the box's top
 * leaves no frame at all; else `underKeyboard` when some of it lies in the
 * box under the line, `offScreen` when none does — and undefined otherwise,
 * the facts then being the frame's for the purpose's own judgement.
 */
function inStopFrame(judged: Judged, box: Rect, bands: StandingScreen | undefined, line: KeyboardLine | undefined): { facts: StandingFacts; outside?: Standing } {
  const { node, centre } = judged;
  if (line !== undefined && line.y <= box.y) {
    const facts: StandingFacts = { centre, screen: { ...box, height: 0 }, visible: 0, clipped: [], covers: [], reaches: [], centreExcused: [], shows: 0 };
    return { facts, outside: { facts, kind: 'underKeyboard', line } };
  }
  const frame = line === undefined ? { ...box } : { ...box, height: line.y - box.y };
  // Its covers below the status band; what shows keeps the node's own part in the band (`bandShows`).
  // docs/adr/0008-scroll-until-exposure-box-below-status-band.md
  const exposed = belowStatusBand(frame, bands, box);
  const facts = bandShows(judged, frame, exposed, factsIn(judged, frame, exposed).facts);
  if (facts.visible > 0) return { facts };
  if (line !== undefined && visibleFractionInViewport(node.rect, box) > 0) return { facts, outside: { facts, kind: 'underKeyboard', line } };
  return { facts, outside: { facts, kind: 'offScreen', at: centre, visible: 0 } };
}

/** THE ORDER past the frame, for both stops: where it lies, cut, covered by `cover`, its centre under a line no guard acts on — else `reachable` at its centre. */
function stopOrdered(facts: StandingFacts, placed: PointPlace, cut: Standing | undefined, cover: UiNode | undefined, line: KeyboardLine | undefined): Standing {
  return ordered<Standing>(
    pointPlaced(facts, placed, facts.visible),
    cut,
    () => (cover === undefined ? undefined : { facts, kind: 'covered', cover, aboveKeyboard: line !== undefined }),
    underLine(facts, line?.witnessed === false ? line : undefined),
    { facts, kind: 'reachable', at: facts.centre },
  );
}

/** The plain stop's standing (`Scene`'s contract): its centre placed, a sliver cut, a cover over its centre alone. */
function stopStanding(judged: Judged, place: PointPlace, box: Rect, bands: StandingScreen | undefined, line: KeyboardLine | undefined): Standing {
  const { facts, outside } = inStopFrame(judged, box, bands, line);
  if (outside !== undefined) return outside;
  return stopOrdered(facts, place, sliverCut(facts, facts.sliver), facts.centreCover, line);
}

/**
 * The `fully` stop's standing (`Scene`'s contract) — the plain stop's frame
 * and order, with its own rules: an edge past the frame first (`clipped`);
 * no sliver (a stop flush with a clipping container is scroll_until's flush
 * probe's, interact/scroll-rounds.ts#PROBE_REACH); any cover covers (the
 * one over the centre, else the last drawn); and the system bands judged as
 * a REGION past the slack (`systemBandOver`), the band's rect carried —
 * except for content no scroll lifts out of a band (`pinnedSurface`).
 */
function fullyStanding(judged: Judged, place: PointPlace, box: Rect, bands: StandingScreen | undefined, line: KeyboardLine | undefined): Standing {
  const { facts, outside } = inStopFrame(judged, box, bands, line);
  if (outside !== undefined) return outside;
  if (facts.clipped.length > 0) return { facts, kind: 'clipped', edges: facts.clipped };
  // The system bands as a region, as the pixel assert judges them — any of the node past the slack.
  // docs/adr/0009-android-navigation-band.md
  // Not for content no scroll lifts out of a band (`pinnedSurface`): it stops as before.
  const placed = place === 'on' && pinnedSurface(judged.node, box, bands, judged.scene.clips) === undefined ? (systemBandOver(judged.node.rect, box, bands) ?? place) : place;
  return stopOrdered(facts, placed, undefined, facts.centreCover ?? facts.covers.at(-1), line);
}

/**
 * The stop's facts with what shows judged in the whole frame wherever the
 * band cut dropped no cover, so a node clear of the band, or one the cut
 * dropped nothing over, shows exactly what it would uncut. Where it dropped
 * one (a cover lying only in the band), the node's own part in the band
 * counts as showing. One more `exposure`, for a node reaching into the band
 * only. The edge discontinuity this leaves is kept:
 * docs/adr/0008-scroll-until-exposure-box-below-status-band.md
 */
function bandShows(judged: Judged, frame: Rect, exposed: Rect, cut: StandingFacts): StandingFacts {
  const inBand = cut.visible - visibleFractionInViewport(judged.node.rect, exposed);
  if (inBand <= 0) return cut;
  const whole = factsIn(judged, frame).facts;
  const dropped = whole.covers.length !== cut.covers.length || whole.covers.some((c, i) => c !== cut.covers[i]);
  return { ...cut, shows: dropped ? cut.shows + inBand : whole.shows };
}

/** The tap's standing (`Scene`'s contract): judged in `chosen` less the system bands — cut above a line no guard acts on — the piece above any line. */
function tapStanding(judged: Judged, place: PointPlace, chosen: Rect, boxes: readonly Rect[], bands: StandingScreen | undefined, line: KeyboardLine | undefined): TapStanding {
  const { scene, node } = judged;
  const box = systemBands(chosen, bands).clear;
  const within = aboveLine(box, line);
  const unwitnessed = line?.witnessed === false ? line : undefined;
  const frame = unwitnessed === undefined ? box : within;
  const { facts, seen } = factsIn(judged, frame);
  const offScreenVisible = boxes.length === 0 ? 0 : Math.max(...boxes.map((b) => visibleFractionInViewport(node.rect, b)));
  const cover = (): TapStanding | undefined => {
    const over = seen.centreCover;
    if (over === undefined) return undefined;
    const aboveKeyboard = within !== box;
    const piece = within === frame ? seen : scene.order.exposure(node, within);
    if (piece.tapAt === undefined) return { facts, kind: 'covered', cover: over, ...(piece.largest !== undefined && { largest: piece.largest }), aboveKeyboard };
    if (!piece.tapAt.moved) return { facts, kind: 'reachable', at: piece.tapAt.point };
    return { facts, kind: 'reachable', at: piece.tapAt.point, moved: { piece: piece.tapAt.piece, cover: over, aboveKeyboard } };
  };
  return ordered<TapStanding>(pointPlaced(facts, place, offScreenVisible), sliverCut(facts, facts.sliver), cover, underLine(facts, unwitnessed), { facts, kind: 'reachable', at: facts.centre });
}

/**
 * The pixel assert's standing (`Scene`'s contract): judged in `box` less the
 * status band, its covers where that meets what it reads; its place a
 * region's (`regionPlace`); cut only at the navigation bar, flush, for a
 * reader of glyphs (`cutAtNavigationBar`); covered by a PIXEL cover
 * (draw-order.ts#paintsOver) — the one on top at its centre, else the last
 * drawn. `flat`: the tree lists no ancestry (draw-order.ts#listsAncestry).
 */
function pixelStanding(judged: Judged, place: RegionPlace, box: Rect, bands: StandingScreen | undefined, purpose: PixelPurpose, flat: boolean): PixelStanding {
  const { scene, node } = judged;
  const below = belowStatusBand(box, bands);
  // Only the part of the box below the band that the measurement reads: what lies over the rest of the node is never sampled.
  const read = rectIntersection(below, purpose.reads) ?? { ...purpose.reads, width: 0, height: 0 };
  // No sliver: the pixel assert measures a container-cut node on what shows (D5).
  // docs/adr/0012-pixel-assert-residuals-d4-d6.md
  const { facts } = factsIn(judged, below, read, { sliver: false });
  const flush = purpose.glyphs ? cutAtNavigationBar(node, box, bands, scene) : undefined;
  const cover = (): PixelStanding | undefined => {
    const covers = scene.order.paintsOver(node, read);
    const centre = rectCentre(node.rect);
    const over = covers.filter((c) => containsPoint(c.reach, centre)).at(-1) ?? covers.at(-1);
    if (over === undefined) return undefined;
    const overRoot = flat && screenSized(node.rect, box);
    return { facts, kind: 'covered', cover: over.node, aboveKeyboard: false, reach: over.reach, ...(overRoot && { overRoot: true as const }) };
  };
  const placed = ((): PixelStanding | undefined => {
    if (place === 'on') return undefined;
    if ('keyboard' in place) return { facts, kind: 'underKeyboard', line: place.keyboard, band: place.band };
    return { facts, kind: 'systemBar', at: facts.centre, bar: place.bar, band: place.band };
  })();
  const cut: PixelStanding | undefined = flush === undefined ? undefined : { facts, kind: 'cut', ...flush };
  return ordered<PixelStanding>(placed, cut, cover, undefined, { facts, kind: 'reachable', at: facts.centre });
}

/**
 * `rect` is the screen itself for the pixel assert: at least
 * SCREEN_SIZED_FRACTION of `box`'s area (adapters/types.ts). No scroll
 * moves it out from under anything — verify/pixel-poll.ts's remedy, and a
 * flat list's root (`covered.overRoot`).
 */
export const screenSized = (rect: Rect, box: Rect): boolean => rectArea(rect) >= rectArea(box) * SCREEN_SIZED_FRACTION;

/**
 * `rect` is a full-bleed header on `box`: laid from the box's top edge at its
 * full width (iOS's, or Android 15+'s edge-to-edge app bar under the status
 * band). No scroll moves it out from under the status bar — a pinned
 * header's place, verify/pixel-poll.ts's remedy.
 */
export const fullBleedHeader = (rect: Rect, box: Rect): boolean => rect.y <= box.y && rect.x <= box.x && rect.x + rect.width >= box.x + box.width;

/**
 * `rect` is a full-bleed footer on `box`: laid to the box's bottom edge at
 * its full width (a bottom sheet, an edge-to-edge bottom bar under the
 * navigation band) — `fullBleedHeader`'s twin at the bottom edge.
 */
export const fullBleedFooter = (rect: Rect, box: Rect): boolean =>
  rect.y + rect.height >= box.y + box.height && rect.x <= box.x && rect.x + rect.width >= box.x + box.width;

/**
 * Content NO scroll lifts out of a system band, and which: a node in no
 * scroll view (`Clips.inScroller` not true — idb's flat list, which cannot
 * tell, counts as none, as the pixel assert's `pinned` does) that is the
 * screen itself (`screenSized`), a full-bleed header (`fullBleedHeader`)
 * or a full-bleed footer (`fullBleedFooter`); and, in a scroll view, the
 * screen itself only when it is taller than the room between the bands
 * (`box` less both, `systemBands`), which no scroll can clear it into.
 * Undefined for anything else, a scroll view's content above all — a list
 * row at the screen's top edge, a 1080x2000 page that fits between the
 * bands — which a scroll does lift. A `fully`
 * stop judges no band's region over it (`Scene`'s contract), and the pixel
 * assert's advice for it leads with something in it clear of the bar.
 * docs/adr/0009-android-navigation-band.md
 */
export function pinnedSurface(node: UiNode, box: Rect, bands: Bands, clips: Pick<Clips, 'inScroller'>): 'screen' | 'header' | 'footer' | undefined {
  if (clips.inScroller(node) === true) return screenSized(node.rect, box) && node.rect.height > systemBands(box, bands).clear.height ? 'screen' : undefined;
  if (screenSized(node.rect, box)) return 'screen';
  if (fullBleedHeader(node.rect, box)) return 'header';
  return fullBleedFooter(node.rect, box) ? 'footer' : undefined;
}

/**
 * The pixel assert's screen (D6): ONE box, the usable screen's `oriented`
 * — the gesture's box — never `boxes`, with the device's system bands. The
 * other orientation of a turn suggested but not witnessed is never judged.
 * docs/adr/0012-pixel-assert-residuals-d4-d6.md
 */
const singleBox = (usable: UsableScreen): StandingScreen => ({
  box: usable.oriented,
  boxes: [usable.oriented],
  statusBand: usable.statusBand,
  navigationBand: usable.navigationBand,
});

/**
 * The node's cut at the navigation bar, as the tree can tell it (N-b,
 * ADR 0009): its bottom flush, within a unit, with the band's top
 * (geometry.ts#flushEdges' unit), inside a clipping scroller
 * (`Clips.scrollersOf`) whose bottom is flush with it too — uiautomator cut
 * it at the window's visible frame and left no evidence (no `cutBounds`,
 * no content past the edge). A node in no such scroller (a non-edge-to-edge
 * app's pinned bottom bar, ending at the band's top) is whole. Only on a
 * portrait box with a band (`systemBands`). The bar and the scroller's
 * rect, or undefined.
 * docs/adr/0009-android-navigation-band.md
 */
function cutAtNavigationBar(node: UiNode, box: Rect, bands: Bands, scene: Pick<Scene, 'clips'>): { bar: NavigationBar; container: Rect } | undefined {
  const { bottom } = systemBands(box, bands);
  if (bottom === undefined) return undefined;
  const on = (y: number) => Math.abs(y - bottom.band.y) <= 1;
  if (!on(node.rect.y + node.rect.height)) return undefined;
  const container = scene.clips.scrollersOf(node).find((c) => on(c.y + c.height));
  return container === undefined ? undefined : { bar: bottom.bar, container: { ...container } };
}
