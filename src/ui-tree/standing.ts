import { isTyped, rectArea, rectIntersection, rectsOverlap, SCREEN_SIZED_FRACTION, type DeviceScreen, type Point, type Rect, type TypedPresentationKind, type UiNode } from '../adapters/types.js';
import {
  drawOrder,
  listsAncestry,
  listsUnclippedFrames,
  type DrawOrder,
  type Exposure,
  type MarkedLayer,
  type PresentedPress,
} from './draw-order.js';
import {
  aboveNavigationBand,
  belowStatusBand,
  clippedEdges,
  clipsOf,
  containsPoint,
  drawnPart,
  overlapsPastSlack,
  PIXEL_OVERLAP_SLACK,
  rectWithin,
  rectCentre,
  sameRect,
  visibleFractionInViewport,
  type Clips,
  type Cut,
  type Drawn,
  type Edge,
} from './geometry.js';
import type { KeyboardLine } from './keyboard-position.js';
import { tapPoint } from './selectors.js';
import { treeScreen, type UsableScreen } from './usable-screen.js';

/**
 * THE SCENE of one tree: its draw order (draw-order.ts) and its clip facts
 * (geometry.ts#clipsOf), each derived once, on first use — and the
 * STANDING of a node in it: where the node stands on a screen for what a
 * verb means to do with it, one ordered judgement for the tap,
 * `scroll_until`'s stop and the pixel assert. Facts cross this seam, and —
 * for a node not reachable — its REMEDY, one closed set of cases decided
 * here with one precedence, presented first (`Remedy`). WHO OWNS A REMEDY'S
 * WORDS: each verb owns its sentences, save one clause — the presented
 * screen's (`presentedRemedy`, and `scroll_until`'s stop on it,
 * `presentedStop`), which lives here because interact/ and verify/ both say
 * it and verify/ may not import interact/; each verb calls it inside its own
 * sentence.
 * The keyboard actions stay with the callers, and the keyboard guard (K1)
 * alone acts on the keyboard.
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
 * - THE DRAWN FRAME, every purpose: on a tree of unclipped frames (WDA's)
 *   a scroll view draws none of its content outside its own frame, while
 *   the content keeps its laid-out rect (geometry.ts#Clips.drawnIn, the
 *   frames of every scrolling ancestor intersected). Every frame a purpose
 *   judges in is cut to it (`drawnFrame`), so `visible`, `shows`, the
 *   covers and the tap's moved piece count only what is drawn; a centre on
 *   the screen outside it is `offScreen` with that scroll view (`scroller`,
 *   `drawnPlace`), its edge judged as the screen's — off the screen first,
 *   then outside the scroll view, then a system band; the pixel assert's
 *   region likewise (below). The tap judges it after its keyboard guard
 *   (interact/tap-judgement.ts#judgeTap): hiding the keyboard may lay the
 *   scroll view out taller; a stop judges it under any line. Android's
 *   trees (rects already cut), idb's flat list (no scroll view listed: a
 *   residual) and a node under nothing that scrolls have none: unchanged.
 *   Measured: the at-rest SWIFT form lists `payee_name_input` at `24,801
 *   354x52`, below its `ScrollView 0,0 402x780`; a tap at its centre was
 *   reported done on the bare background.
 *   docs/adr/0010-pixel-assert-keyboard-first.md
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
 *   - off the screen when nothing of what it `reads` lies on the box —
 *     `offScreen`, first; then nothing of it drawn on the box (the drawn
 *     frame: `offScreen` with its `scroller`); after idb's band (next),
 *     also when the screen's edge, or its scroll view's, leaves of it a
 *     sliver no thicker than the pixel slack (`thinSliver`) — not on a root
 *     of no area (`failsOpen`), nor for a rect of no area: no capture shows
 *     any of it (what it `reads` is asked of its drawn part, the part the
 *     pixel poll samples, verify/pixel-poll.ts#pollPixels; and the colour
 *     sample's region is clipped to the screen before it is inset,
 *     verify/capture.ts#clipThenInset, so a sliver on the screen is read
 *     as the sliver its sampler reads). The bands and the covers below are
 *     judged over that same region: what lies over only the undrawn part
 *     of a node covers nothing the capture shows of it;
 *   - under the band `keyboardTop` marks (`bandRect`) when the node's rect
 *     meets it at all — `underKeyboard`, before the system bands; its
 *     `keyboardTop` is idb's band only, the reading's frame being the
 *     pixel poll's own question, asked before;
 *     docs/adr/0010-pixel-assert-keyboard-first.md
 *   - what it `reads` overlapping a system band past the slack
 *     (geometry.ts#overlapsPastSlack), the status band's before the
 *     navigation band's — `systemBar`, with the band's rect;
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
 * - `facts.screen` is the frame judged, per purpose, cut to the drawn frame:
 *   the stop's box cut above its keyboard line; the tap's box less the
 *   system bands, cut above a line no guard acts on; the pixel's box less
 *   the status band. The
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
 *     (interact/tap-judgement.ts#TapJudge.aim).
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
  /** The tree's clip facts (geometry.ts#clipsOf), its dialect as draw order reads it (draw-order.ts#listsAncestry, #listsUnclippedFrames). */
  readonly clips: Clips;
  /** The pixel assert's standing: its own union (`PixelStanding`), on the usable screen's `oriented` box, picked here. */
  standing(node: UiNode, screen: UsableScreen | undefined, purpose: PixelPurpose): PixelStanding;
  /** The tap's standing: a `Standing` never `clipped` (`TapStanding`). */
  standing(node: UiNode, screen: StandingScreen | undefined, purpose: TapPurpose): TapStanding;
  /** The stops' standing (and the tap's, asked as a `TouchPurpose`). */
  standing(node: UiNode, screen: StandingScreen | undefined, purpose: TouchPurpose): Standing;
  standing(node: UiNode, screen: UsableScreen | undefined, purpose: Purpose): Standing | PixelStanding;
  /**
   * THE region of the node a pixel measurement is asked of, on the screen the pixel purpose is judged on (`screen`,
   * else the tree's own): the part of its rect its scroll views draw (the drawn frame, geometry.ts#drawnPart) — the
   * whole rect where nothing cuts it, and on a root of no area (treeScreen's `failsOpen`: nothing is judged off its
   * box). The pixel standing judges over it and the sampler reads it (verify/pixel-poll.ts#pollPixels): one function,
   * so the two cannot diverge.
   */
  pixelRegion(node: UiNode, screen: UsableScreen | undefined): Rect;
  /**
   * THE presented question a stroke asks at its touch-down (`point`), as a sentence quotes the answer
   * (draw-order.ts#PresentedPress): on behalf of `target`, the surface of a screen presented over the target's own
   * that holds the point (draw-order.ts#DrawOrder.presentedAt) — or, with NO target (one not in the tree), the cover
   * of a layer the tree marks as presented the point lands on, off that layer's own scroll views
   * (draw-order.ts#DrawOrder.markedAt: an alert's, an action sheet's or a popover's element, what of a `screen` layer
   * draws there; a screen presented by shape alone is not asked of no target). Undefined when none. The point is
   * kept: a surface judged by shape only where it lies is not one at every touch-down (a dismissed sheet parked off
   * screen is no stop). One reader: `scroll_until`'s stroke (interact/scroll-rounds.ts#presentedTouchDown).
   */
  presentedAt(point: Point, target?: UiNode): PresentedPress | undefined;
}

/**
 * What a verb means to do with the node — `scroll_until`'s plain stop
 * (`stop`), its `fully: true` stop (`fully`), a tap, or the pixel assert's
 * read (`PixelPurpose`) — and the soft
 * keyboard's line the caller applies, if any
 * (ui-tree/keyboard-position.ts#KeyboardPosition.line builds it; `Scene`'s contract
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
 * node's rect its measurement reads, asked of the box the standing judges
 * (`PixelRegionOf`); `glyphs`, whether it reads glyphs (the ocr assert), which a
 * cut at the node's edge garbles where a colour sample of what shows stays
 * true.
 */
export type PixelPurpose = { readonly of: 'pixel'; readonly reads: PixelRegionOf; readonly glyphs: boolean; readonly keyboardTop?: KeyboardLine };

/**
 * The part of a node's rect (`rect`) a pixel measurement reads, in tree units, given the box the standing judges in
 * (`box`) — the colour sampler's region, the rect clipped to the box and then inset
 * (verify/color-parity.ts#colorSampleRect, the sampler's own function), or the ocr crop's whole rect. The standing
 * asks it once, with ITS box — the usable screen's `oriented` (`singleBox`), or, on a root of no area (`failsOpen`:
 * that box is only the tree's largest node), the node's own rect, so nothing is clipped — and so owns the box what
 * the reader reads is clipped to: no caller picks a box of its own.
 */
export type PixelRegionOf = (rect: Rect, box: Rect) => Rect;

/**
 * A pixel purpose with what it reads asked of the box (`PixelRegionOf`), of the part of the node its scroll views
 * draw (the drawn frame): the ONE region its covers and the system bands are judged over and its sampler reads.
 */
type PixelRead = Omit<PixelPurpose, 'reads'> & { readonly reads: Rect };

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
   * status band — each cut to the drawn frame (`drawn`; no area when nothing of it is drawn).
   */
  readonly screen: Rect;
  /** The fraction of the node inside the frame, covers or not: of what is drawn there. */
  readonly visible: number;
  /** The frame's edges the node extends past (geometry.ts#clippedEdges). */
  readonly clipped: readonly Edge[];
  /** draw-order.ts#Exposure's, inside the frame below the status band (the pixel's: where that meets what it reads): the covers, where each presses, the one over the centre, and what shows. */
  readonly covers: readonly UiNode[];
  readonly reaches: readonly Rect[];
  readonly centreCover?: UiNode;
  /** draw-order.ts#Exposure's: what the `target` column excused at the centre — no cover, but what a tap there may press. */
  readonly centreExcused: readonly UiNode[];
  /** draw-order.ts#Exposure's: the covers that are the surface of a screen presented over the node (a modal's dim, a sheet's form); absent when none. */
  readonly presented?: readonly UiNode[];
  readonly shows: number;
  /** The least piece a tap may be aimed at (draw-order.ts#Exposure.minPiece); absent when the frame leaves nothing to judge. */
  readonly minPiece?: number;
  /** The node's cut to a sliver by its scroll container under `minPiece` (geometry.ts#Clips.cutSliver), whatever the kind — never judged for the pixel (D5, ADR 0012). */
  readonly sliver?: Cut;
  /** The frame its scroll views draw it in (geometry.ts#Clips.drawnIn), when they cut it and share some area: `screen` is cut to it, and `scroll_until`'s far edge is judged at its edges as at the screen's (interact/scroll-rounds.ts#beyondFarEdgeIn). */
  readonly drawn?: Rect;
}

/** A presented layer the source TYPES, as the words name it (`presentedRemedy`): its article and its noun. */
interface TypedWords {
  readonly article: string;
  readonly noun: string;
}
/** The words for each typed kind (`TypedWords`). */
const TYPED_WORDS: Readonly<Record<TypedPresentationKind, TypedWords>> = {
  alert: { article: 'an', noun: 'alert' },
  actionSheet: { article: 'an', noun: 'action sheet' },
  popover: { article: 'a', noun: 'popover' },
};
/** The words for `layer` when the source typed it; undefined for a `screen` layer, or none. */
const typedWords = (layer: MarkedLayer | undefined): TypedWords | undefined => (layer === undefined || !isTyped(layer.kind) ? undefined : TYPED_WORDS[layer.kind]);

/**
 * THE remedy's words for a node beneath a screen presented over its own (`Remedy`'s `presented`), the node named as
 * `what` — `it` in the tap's refusal and `scroll_until`'s stop (and the tap and `scroll_until` descriptions), `the element`
 * in the pixel assert's sentence, whose "it" is already the cover (verify/pixel-poll.ts): close that screen first,
 * since no scroll moves the node out from under it. A layer the tree source types (an alert, an action sheet, a
 * popover: `layer`) is named by its kind and label; a `screen` layer, or none, is "a screen … (a modal or a sheet)".
 * The one clause of a remedy kept here, in the UI-tree layer both verbs and the pixel assert may import, as
 * system-bar.ts's words are (the module's doc: who owns a remedy's words).
 */
export const presentedRemedy = (what: 'it' | 'the element', layer?: MarkedLayer): string => {
  const typed = typedWords(layer);
  return typed !== undefined
    ? `${typed.article} ${typed.noun} is presented over ${what}${layer?.label ? ` (${JSON.stringify(layer.label)})` : ''} — close it first`
    : `a screen is presented over ${what} (a modal or a sheet) — close it first; no scroll moves ${what} out from under that screen`;
};

/**
 * `scroll_until`'s `presented` stop's remedy (interact/scroll-text.ts#scrollFailure): `presentedRemedy`'s, and why no
 * swipe was sent — one on that screen may dismiss it; under a layer the tree source types (an alert, an action sheet,
 * a popover: `layer`) it is named, and a swipe would land on it. With no typed layer, the one sentence the
 * `scroll_until` description quotes (mcp/tools.ts).
 */
export const presentedStop = (layer?: MarkedLayer): string => {
  const typed = typedWords(layer);
  return `${presentedRemedy('it', layer)}, ${typed === undefined ? 'and a swipe on it may dismiss it' : `and a swipe would land on the ${typed.noun}`}`;
};

/** Where `cover`, one of `facts.covers`, presses (draw-order.ts#Exposure.reaches, in the same order); undefined for a node not among them. */
export const reachOf = (facts: Pick<StandingFacts, 'covers' | 'reaches'>, cover: UiNode): Rect | undefined => facts.reaches[facts.covers.indexOf(cover)];

/**
 * THE REMEDY for a node that does not stand `reachable`: what would bring it within reach, as one closed set of cases
 * decided once, here (`remedied`), for every purpose — the verbs only render a case in their own words (the tap's
 * refusal, interact/tap-judgement.ts; the pixel assert's miss, verify/pixel-poll.ts#coverRemedy; `scroll_until`'s
 * `presented` stop, interact/scroll-rounds.ts). Every non-reachable standing carries one (`Standing`'s and
 * `PixelStanding`'s `remedy`).
 *
 * The cases, in THE PRECEDENCE, one for every purpose — the first that holds is the remedy:
 * 1. `presented` — a screen is presented over the node's own (a modal's dimming leaf, a sheet's form), judged of the
 *    NODE, geometry-free: a presented surface among its covers in the frame (`facts.presented`,
 *    draw-order.ts#Exposure.presented), else one drawn over it wherever it lies
 *    (draw-order.ts#DrawOrder.presentedOver — `scroll_until`'s touch-down rule less the point), whatever its kind:
 *    under the status bar (wholly inside the band too), off the screen (wholly too), cut, under the soft keyboard or
 *    under another cover beneath that screen alike. No scroll moves it out from under that screen, and hiding a
 *    keyboard leaves it there: close that screen first. Judged of what of it SHOWS alone, a target wholly below the
 *    fold or wholly inside the status band has no covers, so no presented surface — it would be told to scroll while
 *    `scroll_until` stops on the presented screen: so every non-reachable kind takes it.
 *    docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md
 *    `cover`: the node a sentence names — the one over its centre when it is `covered` (the modal's card over the
 *    dim), else the last presented surface among its covers, else the last drawn over it. `layer`: the presented
 *    layer the tree source marks when that surface is its element (draw-order.ts#DrawOrder.presentedPress), which
 *    `presentedRemedy` names.
 * 2. `keyboard` — its centre (the pixel assert: its rect) under a keyboard line no guard acts on (`underKeyboard`):
 *    hide the keyboard (the tap and the pixel assert each word how, ADR 0017).
 * 3. `fixed` — the pixel assert only, which judges a region: content no scroll moves out from under what is over it
 *    — under a system bar, content no scroll lifts out of a band (`pinnedSurface`: the screen itself, a full-bleed
 *    header or footer); under a cover, idb's flat-list root (`covered.overRoot`, `root`), a screen-sized element
 *    (`screen`) or a full-bleed header (`header`). Act on something in it clear of that.
 * 4. `pinned` — under a system bar or (the pixel assert) a cover, in no scroll view as the tree says
 *    (geometry.ts#Clips.inScroller false): no scroll moves it out.
 * 5. `stuck` — a scroll may not move it out: the tree cannot say whether it lies in a scroll view (idb's flat list,
 *    `inScroller` undefined), or — the pixel assert — it is laid from the screen's top edge under the status bar, or
 *    the cover's reach holds it whole.
 * 6. `scroll` — a scroll moves it into reach: off the screen, clipped (a `fully` stop), cut to a sliver (toward the
 *    standing's `cut.edge`), under a cover over its centre (the touch purposes: the tap may refine it, its
 *    positioner hint, interact/tap-judgement.ts#positionerRemedy), or in a scroll view under a bar.
 *
 * One precedence for every verb: the same target is told the same remedy by the tap, the pixel assert and
 * `scroll_until`'s stop.
 *
 * What comes before any standing, so before this precedence: the pixel assert asks its keyboard READING first
 * (verify/pixel-poll.ts#overElement, `overlapping`: the oracle's band, or WDA's in-tree band), and an element that
 * reading finds under the keyboard is a keyboard miss whatever is presented over it — the standing is never asked
 * (docs/adr/0010-pixel-assert-keyboard-first.md). Only idb's band, a keyboard line of the standing, is judged here,
 * presented first.
 *
 * Cost: the tree's scroll ancestry (geometry.ts#Clips.inScroller, one walk of the tree, kept by the scene) is asked
 * only for a node under a system bar or — the pixel assert's — a cover with no presented surface; a touch purpose's
 * cover asks nothing (its remedy is `scroll`).
 *
 * Each kind carries only the cases it can take (`TouchRemedies`, `PixelRemedies`), so a verb's sentence for a kind
 * words those and the compiler refuses one it cannot (a keyboard remedy under a bar, say).
 */
export type Remedy =
  | { readonly of: 'presented'; readonly cover: UiNode; readonly layer?: MarkedLayer }
  | { readonly of: 'keyboard' }
  | { readonly of: 'fixed'; readonly what: 'screen' | 'header' | 'footer' | 'root' }
  | { readonly of: 'pinned' }
  | { readonly of: 'stuck' }
  | { readonly of: 'scroll' };

/** One case of `Remedy`. */
type RemedyCase<O extends Remedy['of']> = Extract<Remedy, { readonly of: O }>;

/** 4.–6. of THE PRECEDENCE: what a scroll may do for a node under a bar or (the pixel assert's) a cover (`scrollable`). */
export type ScrollableRemedy = RemedyCase<'pinned' | 'stuck' | 'scroll'>;

/** The remedies each touch kind (the tap, the stops) can carry — `fixed` never: only the pixel assert's region judges it. */
interface TouchRemedies {
  readonly offScreen: RemedyCase<'presented' | 'scroll'>;
  readonly systemBar: RemedyCase<'presented'> | ScrollableRemedy;
  readonly clipped: RemedyCase<'presented' | 'scroll'>;
  readonly cut: RemedyCase<'presented' | 'scroll'>;
  readonly covered: RemedyCase<'presented' | 'scroll'>;
  readonly underKeyboard: RemedyCase<'presented' | 'keyboard'>;
}

/** The remedies each pixel kind can carry. */
interface PixelRemedies {
  readonly offScreen: RemedyCase<'presented' | 'scroll'>;
  readonly systemBar: RemedyCase<'presented' | 'fixed'> | ScrollableRemedy;
  readonly cut: RemedyCase<'presented' | 'scroll'>;
  readonly covered: RemedyCase<'presented' | 'fixed'> | ScrollableRemedy;
  readonly underKeyboard: RemedyCase<'presented' | 'keyboard'>;
}

/** A union of kinds with `remedy` added to every kind but `reachable`, the cases `M` lists for its kind — a non-reachable standing carries its remedy. */
type Remedied<K extends { readonly kind: string }, M> = K extends { readonly kind: 'reachable' } ? K : K & { readonly remedy: M[K['kind'] & keyof M] };

/** The touch kinds, before the remedy is decided (`remedied`). */
type TouchKind =
  /** `at`: the point a tap presses — the centre, or (`moved`, the tap's) the centre of the largest uncovered `piece`, `cover` being over the centre, chosen above a keyboard line when one applied. */
  | { readonly kind: 'reachable'; readonly at: Point; readonly moved?: { readonly piece: Rect; readonly cover: UiNode; readonly aboveKeyboard: boolean } }
  /**
   * `visible`: the most of the node inside any box judged, of what is drawn there. `scroller`: its centre lies on the
   * screen but outside what its scroll views draw (`Scene`'s contract, the drawn frame) — the scroll view a sentence
   * names (`scrollerOf`).
   */
  | { readonly kind: 'offScreen'; readonly at: Point; readonly visible: number; readonly scroller?: UiNode }
  /** `band`: the band's rect on the box, only when the node's rect (not its centre) lies in it past the slack — a `fully` stop's region rule. */
  | { readonly kind: 'systemBar'; readonly at: Point; readonly bar: SystemBar; readonly band?: Rect }
  /** `byScrollView`: the edges its scroll view's edge clips, inside the box, not the screen's (`ScrollViewCut`). */
  | { readonly kind: 'clipped'; readonly edges: readonly Edge[]; readonly byScrollView?: ScrollViewCut }
  | { readonly kind: 'cut'; readonly cut: Cut; readonly minPiece: number }
  /** `largest` (the tap's): the largest piece nothing is drawn over, under the minimum; `aboveKeyboard`: judged above a keyboard line. */
  | { readonly kind: 'covered'; readonly cover: UiNode; readonly largest?: Rect; readonly aboveKeyboard: boolean }
  /** `line`: the keyboard line its centre lies under (`Scene`'s contract says when a verb is stopped by it). */
  | { readonly kind: 'underKeyboard'; readonly line: KeyboardLine };

/**
 * What of a `clipped` node its scroll view clips (`Scene`'s contract, the drawn frame): `edges`, the ones it is clipped
 * at where the frame judged in ends at the drawn frame's edge and the box does not (the rest of `edges` are the
 * screen's, or a keyboard line's); `scroller`, the scroll view a sentence names (`scrollerOf`); `longer`, `taller` or
 * `wider` when the node is longer, on an axis of those edges, than what of the drawn frame is judged in (the screen's
 * part of it, above any keyboard line) — no scroll shows it whole.
 */
export interface ScrollViewCut {
  readonly edges: readonly Edge[];
  readonly scroller: UiNode;
  readonly longer?: 'taller' | 'wider';
}

/** Where the node stands for a touch (the tap, the stop), and why: `facts`, one kind with what its sentence quotes, and — not reachable — its `remedy`. */
export type Standing = { readonly facts: StandingFacts } & Remedied<TouchKind, TouchRemedies>;

/** Where the node stands for the tap: a `Standing` of every kind but `clipped`, which only a `fully` stop judges. */
export type TapStanding = Exclude<Standing, { readonly kind: 'clipped' }>;

/** The pixel assert's kinds, before the remedy is decided (`remedied`). */
type PixelKind =
  | { readonly kind: 'reachable'; readonly at: Point }
  /**
   * Nothing of what it reads lies on the box judged (`box`, the sentence quotes it): no capture shows any of it — or
   * (`sliver`, the element's part on the box) the screen's edge leaves too thin a sliver of it to measure
   * (`thinSliver`). `scroller`: the scroll view it lies outside of — nothing of it drawn on the box (`Scene`'s
   * contract, the drawn frame), or, with `sliver`, that scroll view's edge leaves the sliver (`scrollerOf`).
   */
  | { readonly kind: 'offScreen'; readonly box: Rect; readonly sliver?: Rect; readonly scroller?: UiNode }
  /** `band`: the band's rect on the box, which what it reads overlaps. */
  | { readonly kind: 'systemBar'; readonly at: Point; readonly bar: SystemBar; readonly band: Rect }
  /** Its own cut: at the navigation bar's top, `container` the clipping scroller flush with it. */
  | { readonly kind: 'cut'; readonly bar: NavigationBar; readonly container: Rect }
  /** `reach`: where the cover presses (its rect, or a pinned bar's reach); `overRoot`: the node is a flat list's screen-sized root and the cover the app's content listed on it. */
  | { readonly kind: 'covered'; readonly cover: UiNode; readonly reach: Rect; readonly aboveKeyboard: false; readonly overRoot?: true }
  /** `band`: the band the line marks on the box, which the node's rect meets. */
  | { readonly kind: 'underKeyboard'; readonly line: KeyboardLine; readonly band: Rect };

/** Where the node stands for the pixel assert (`Scene`'s contract: a region, never clipped), and why — and, not reachable, its `remedy`. */
export type PixelStanding = { readonly facts: StandingFacts } & Remedied<PixelKind, PixelRemedies>;

/**
 * Whether the standing is `offScreen` on the screen but outside what its scroll views draw (`Scene`'s contract, the
 * drawn frame): it names the scroll view (`scroller`). THE test every sentence and refusal asks — not the screen's edge.
 */
export const outsideItsScrollView = <S extends Standing | PixelStanding>(s: S): s is Extract<S, { readonly kind: 'offScreen' }> & { readonly scroller: UiNode } =>
  s.kind === 'offScreen' && s.scroller !== undefined;

/** A touch standing before its remedy is decided. */
type TouchJudgement = { readonly facts: StandingFacts } & TouchKind;
/** A tap standing before its remedy is decided. */
type TapJudgement = Exclude<TouchJudgement, { readonly kind: 'clipped' }>;
/** A pixel standing before its remedy is decided. */
type PixelJudgement = { readonly facts: StandingFacts } & PixelKind;
/** A judgement of any kind but `reachable` — the ones a remedy is decided for. */
type Unreached<J> = Exclude<J, { readonly kind: 'reachable' }>;

/** The scene of `tree`: its draw order and clip facts, each derived on first use and kept. */
export function sceneOf(tree: UiNode): Scene {
  let order: DrawOrder | undefined;
  let clips: Clips | undefined;
  const scene: Scene = {
    get order() {
      return (order ??= drawOrder(tree));
    },
    get clips() {
      return (clips ??= clipsOf(tree, { ancestry: listsAncestry(tree), unclipped: listsUnclippedFrames(tree) }));
    },
    standing,
    pixelRegion: (node, screen) => pixelDrawn(node, pixelScreen(screen)).rect,
    presentedAt(point, target) {
      const surface = target === undefined ? scene.order.markedAt(point) : scene.order.presentedAt(target, point);
      return surface === undefined ? undefined : scene.order.presentedPress(surface);
    },
  };
  /** The usable screen the pixel purpose judges on: `screen` when it has `oriented`, else the tree's own. */
  function pixelScreen(screen: StandingScreen | UsableScreen | undefined): UsableScreen & { readonly failsOpen?: boolean } {
    return screen !== undefined && 'oriented' in screen ? screen : treeScreen(tree);
  }
  /** `Scene.pixelRegion`, with the drawn frame it was cut by (undefined on a root of no area: nothing is cut there). */
  function pixelDrawn(node: UiNode, usable: UsableScreen & { readonly failsOpen?: boolean }): { readonly drawn: Drawn | undefined; readonly rect: Rect } {
    const drawn = usable.failsOpen === true ? undefined : scene.clips.drawnIn(node);
    return { drawn, rect: drawnPart(node.rect, drawn) ?? node.rect };
  }
  function standing(node: UiNode, screen: UsableScreen | undefined, purpose: PixelPurpose): PixelStanding;
  function standing(node: UiNode, screen: StandingScreen | undefined, purpose: TapPurpose): TapStanding;
  function standing(node: UiNode, screen: StandingScreen | undefined, purpose: TouchPurpose): Standing;
  function standing(node: UiNode, screen: UsableScreen | undefined, purpose: Purpose): Standing | PixelStanding;
  function standing(node: UiNode, screen: StandingScreen | UsableScreen | undefined, purpose: Purpose): Standing | PixelStanding {
    const judged: Judged = { scene, node, centre: tapPoint(node) };
    if (purpose.of === 'pixel') {
      // The overloads hand the pixel purpose a usable screen (one with `oriented`): it picks its own box, `oriented` (`singleBox`).
      const usable = pixelScreen(screen);
      const single = singleBox(usable);
      // On a root of no area (treeScreen's `failsOpen`) the box is only the largest node: nothing is judged off it.
      const failsOpen = usable.failsOpen === true;
      // What it reads is asked of THE region (`pixelRegion`): what is judged over it is what its sampler reads.
      const { drawn, rect } = pixelDrawn(node, usable);
      const read: PixelRead = { ...purpose, reads: purpose.reads(rect, failsOpen ? rect : single.box) };
      const pixel = pixelStanding(judged, regionPlace(node.rect, read, single.box, single, failsOpen, drawn), single.box, single, read, !listsAncestry(tree));
      return pixel.kind === 'reachable' ? pixel : remedied({ pixel, box: single.box, bands: single }, judged);
    }
    const touch = touchScreen(screen, tree);
    if (purpose.of === 'tap') {
      const tap = tapStanding(judged, drawnPlace(placeOf(judged.centre, touch?.boxes, touch), judged), touch === undefined ? node.rect : chosenBox(judged.centre, touch), touch?.boxes ?? [], touch, purpose.keyboardTop);
      return tap.kind === 'reachable' ? tap : remedied({ touch: tap }, judged);
    }
    const place = drawnPlace(placeOf(judged.centre, touch === undefined ? undefined : [touch.box], touch), judged);
    const box = touch?.box ?? node.rect;
    const stop = purpose.of === 'fully' ? fullyStanding(judged, place, box, touch, purpose.keyboardTop) : stopStanding(judged, place, box, touch, purpose.keyboardTop);
    return stop.kind === 'reachable' ? stop : remedied({ touch: stop }, judged);
  }
  return scene;
}

/**
 * A judgement with THE remedy decided (`Remedy`, whose doc has the cases and THE PRECEDENCE) — once for every purpose,
 * for every kind but `reachable` (the type says so: every non-reachable standing carries one, of the cases its kind
 * can take). The pixel assert's judgement comes with its box and bands — the region's purpose, which alone decides
 * `fixed`, and `stuck` for a node laid from the box's top edge under the status bar or held whole by its cover's reach.
 */
function remedied(judging: { readonly pixel: Unreached<PixelJudgement>; readonly box: Rect; readonly bands: Bands }, judged: Judged): Unreached<PixelStanding>;
function remedied(judging: { readonly touch: Unreached<TapJudgement> }, judged: Judged): Unreached<TapStanding>;
function remedied(judging: { readonly touch: Unreached<TouchJudgement> }, judged: Judged): Unreached<Standing>;
function remedied(
  judging: { readonly touch: Unreached<TouchJudgement> } | { readonly pixel: Unreached<PixelJudgement>; readonly box: Rect; readonly bands: Bands },
  { scene, node }: Judged,
): Unreached<Standing> | Unreached<PixelStanding> {
  const judgement = 'touch' in judging ? judging.touch : judging.pixel;
  // 1. Beneath a screen presented over its own, whatever its kind and wherever it lies: a presented surface among its
  // covers in the frame, else one judged of the node itself (draw-order.ts#DrawOrder.presentedOver) — a node with
  // nothing in the frame (below the fold, inside the status band) has no covers there.
  const surface = judgement.facts.presented?.at(-1) ?? scene.order.presentedOver(node);
  if (surface !== undefined) {
    const { layer } = scene.order.presentedPress(surface);
    return { ...judgement, remedy: { of: 'presented', cover: judgement.kind === 'covered' ? judgement.cover : surface, ...(layer !== undefined && { layer }) } };
  }
  if ('touch' in judging) {
    const touch = judging.touch;
    switch (touch.kind) {
      // 2. The keyboard.
      case 'underKeyboard':
        return { ...touch, remedy: { of: 'keyboard' } };
      // 6. What a scroll brings within reach whatever lies around it — and a touch's cover over the centre: scroll it
      // clear (the stop's stuck sentence names a cover no scroll clears).
      case 'offScreen':
      case 'clipped':
      case 'cut':
      case 'covered':
        return { ...touch, remedy: { of: 'scroll' } };
      case 'systemBar':
        return { ...touch, remedy: scrollable(scene.clips.inScroller(node), false) };
      default: {
        const unhandled: never = touch;
        return unhandled;
      }
    }
  }
  const { pixel, box, bands } = judging;
  switch (pixel.kind) {
    // 2. The keyboard.
    case 'underKeyboard':
      return { ...pixel, remedy: { of: 'keyboard' } };
    // 6. What a scroll brings within reach whatever lies around it.
    case 'offScreen':
    case 'cut':
      return { ...pixel, remedy: { of: 'scroll' } };
    case 'systemBar': {
      // 3. Content no scroll lifts out of a band — the pixel assert's region only.
      const fixed = pinnedSurface(node, box, bands, scene.clips);
      if (fixed !== undefined) return { ...pixel, remedy: { of: 'fixed', what: fixed } };
      // Laid from the box's top edge under the status bar: a scroll may not move it (a pinned header's place).
      return { ...pixel, remedy: scrollable(scene.clips.inScroller(node), pixel.bar.edge === 'top' && node.rect.y <= box.y) };
    }
    case 'covered':
      // 3. No scroll ever moves the screen itself out from under anything — idb's flat-list root, a screen-sized
      // element — nor an element laid from the screen's top edge at full width (a full-bleed header: iOS's, or
      // Android 15+'s edge-to-edge app bar).
      if (pixel.overRoot === true) return { ...pixel, remedy: { of: 'fixed', what: 'root' } };
      if (screenSized(node.rect, box)) return { ...pixel, remedy: { of: 'fixed', what: 'screen' } };
      if (fullBleedHeader(node.rect, box)) return { ...pixel, remedy: { of: 'fixed', what: 'header' } };
      return { ...pixel, remedy: scrollable(scene.clips.inScroller(node), rectWithin(node.rect, pixel.reach)) };
    default: {
      const unhandled: never = pixel;
      return unhandled;
    }
  }
}

/**
 * 4.–6. of THE PRECEDENCE for a node under a bar or a cover: `pinned` in no scroll view; `stuck` where the tree
 * cannot say (idb's flat list), or where `stuckInPlace` — the pixel assert's node laid from the box's top edge under
 * the status bar, or held whole by its cover's reach — a scroll in a scroll view may still not move it out; else
 * `scroll`.
 */
const scrollable = (inScroller: boolean | undefined, stuckInPlace: boolean): ScrollableRemedy =>
  inScroller === false ? { of: 'pinned' } : inScroller === undefined || stuckInPlace ? { of: 'stuck' } : { of: 'scroll' };

/** A node being judged, and its centre. */
interface Judged {
  readonly scene: Scene;
  readonly node: UiNode;
  readonly centre: Point;
}

/**
 * Where a point lies: on the screen, off it, in a system band — with the band's rect when a region, not the point,
 * lies in it — or (`outside`, `drawnPlace`) on the screen outside what the node's scroll views draw, that scroll view
 * named.
 */
type PointPlace = 'on' | 'off' | { readonly bar: SystemBar; readonly band?: Rect } | { readonly outside: UiNode };

/** A system band on a box: the bar it is, as a sentence quotes it, and its rect on the box. */
interface SystemBand<B extends SystemBar = SystemBar> {
  readonly bar: B;
  readonly band: Rect;
}

/**
 * Where the pixel assert's region lies: on the screen, off it (`wholly`: nothing of what it reads on the box;
 * `outside`: on the box, but nothing of it drawn there — the scroll view named; `sliver`: the element's drawn part on
 * the screen, `on`, too thin to measure — `scroller` when that scroll view's edge leaves it), in a system band (with
 * the band's rect), or under the band a keyboard line marks.
 */
type RegionPlace =
  | 'on'
  | { readonly off: 'wholly' }
  | { readonly off: 'outside'; readonly scroller: UiNode }
  | { readonly off: 'sliver'; readonly on: Rect; readonly scroller?: UiNode }
  | { readonly bar: SystemBar; readonly band: Rect }
  | { readonly keyboard: KeyboardLine; readonly band: Rect };

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
 * `place` judged against the node's DRAWN frame (`Scene`'s contract; geometry.ts#Clips.drawnIn): a centre on the
 * screen, or in a system band, that lies outside what the node's scroll views draw is `outside` the scroll view
 * `scrollerOf` names — off the screen as a touch judges it, its edge the scroll view's: nothing a tap there presses is
 * the node. Off the screen stays off the screen, judged first. A tree whose frames are already cut (Android's), idb's
 * flat list and a node under nothing that scrolls have no drawn frame: `place` as it is. Under a witnessed keyboard
 * line too: a stop never stops on a centre its scroll view does not draw — a stroke brings it up into the scroll view
 * laid out above the keyboard. Only the TAP defers it past its keyboard guard
 * (interact/tap-judgement.ts#judgeTap): hiding the keyboard may lay that scroll view out taller (React Native's
 * keyboard-avoiding view, MyPort's login `ScrollView` ending at the band's top, 566).
 */
function drawnPlace(place: PointPlace, { scene, node, centre }: Judged): PointPlace {
  if (place === 'off') return place;
  const drawn = scene.clips.drawnIn(node);
  if (drawn === undefined || (drawn.frame !== undefined && containsPoint(drawn.frame, centre))) return place;
  return { outside: scrollerOf(drawn, (frame) => !containsPoint(frame, centre)) };
}

/** The scroll view a sentence names for a node outside what its scroll views draw (`Drawn`): the nearest whose frame `leaves` it, else the nearest. */
const scrollerOf = (drawn: Drawn, leaves: (frame: Rect) => boolean): UiNode => drawn.scrollers.find((s) => leaves(s.rect)) ?? drawn.scrollers[0];

/**
 * `frame` cut by the node's drawn frame (geometry.ts#drawnPart): `frame` itself when nothing cuts it (the same
 * object); of no area, at `frame`'s origin, when nothing of `frame` is drawn.
 */
function drawnFrame({ scene, node }: Judged, frame: Rect): Rect {
  return drawnPart(frame, scene.clips.drawnIn(node)) ?? { ...frame, width: 0, height: 0 };
}

/**
 * Where the pixel assert's region lies (`Scene`'s contract): off the screen
 * when what it reads has area and none of it lies on `box`; under the band
 * `purpose.keyboardTop` marks (below); off the screen again when the
 * screen's edge leaves of it a sliver no thicker than PIXEL_OVERLAP_SLACK
 * (`thinSliver`, with the element's part on the screen) — never on a box
 * that `failsOpen` (a root of no area: the box is only the tree's largest
 * node, as a touch judges every point on the screen there), and never for a
 * rect of no area (a 926x0 row on the navigation bar's top edge is judged
 * by its place); under the band
 * `purpose.keyboardTop` marks on `box` when the node's rect meets it at
 * all; else in the status band, then the navigation band, when what it
 * reads overlaps one past PIXEL_OVERLAP_SLACK (geometry.ts#overlapsPastSlack);
 * else on the screen.
 */
function regionPlace(rect: Rect, { reads, keyboardTop }: PixelRead, box: Rect, bands: StandingScreen | undefined, failsOpen: boolean, drawn: Drawn | undefined): RegionPlace {
  const on = !failsOpen && rectArea(reads) > 0 ? rectIntersection(reads, box) : box;
  if (on === undefined) return { off: 'wholly' };
  // Outside its scroll view next: on the box, but nothing of it drawn there — what lies there is not the element.
  const onBox = rectIntersection(rect, box) ?? rect;
  const part = drawnPart(rect, drawn);
  const shown = part === undefined ? undefined : rectIntersection(part, box);
  if (on !== box && drawn !== undefined && shown === undefined) return { off: 'outside', scroller: scrollerOf(drawn, (frame) => !rectsOverlap(frame, onBox)) };
  // idb's keyboard band before a thin sliver, as it comes before the system bands (ADR 0010): the element under the band is a
  // keyboard miss, worded as WDA's and Android's reading words it. Nothing wholly off the box meets the band.
  // docs/adr/0010-pixel-assert-keyboard-first.md
  if (keyboardTop !== undefined) {
    const band = bandRect(keyboardTop, box);
    if (rectsOverlap(rect, band)) return { keyboard: keyboardTop, band };
  }
  const sliver = on === box ? undefined : thinSliver(rect, shown ?? on, on);
  // The sliver its scroll view's edge leaves, that scroll view named; the screen's edge's, none.
  const cutBy = drawn === undefined || shown === undefined || sameRect(shown, onBox) ? undefined : scrollerOf(drawn, (frame) => !rectWithin(onBox, frame));
  if (sliver !== undefined) return { off: 'sliver', on: sliver, ...(cutBy !== undefined && { scroller: cutBy }) };
  return systemBandOver(reads, box, bands) ?? 'on';
}

/**
 * The element's part on the box (`shown`: its drawn part there) when the screen's EDGE — or its scroll view's, the
 * drawn frame's (`Scene`'s contract), as at the screen's — leaves what the pixel assert reads (`on`, its part on the
 * box) no thicker than PIXEL_OVERLAP_SLACK on a side the edge cuts — too thin to measure: what a neighbour laid flush may
 * share with the element without counting as over it (geometry.ts#overlapsPastSlack) is the most such a sliver
 * holds, so a cover reaching over it is never judged, and the sampler reads its few rows — measured:
 * `payee_street_input` moved to y 872–873.7 beneath the Fees sheet's dim passed on ~6 px rows of the dim, "clipped
 * 96% off-png". The same at the top edge, under the status band, which a sliver no thicker
 * than the slack does not overlap past it. Only a side an edge cuts: a whole element thinner than the slack
 * on the screen (a 402x1 divider) is measured. Undefined when the sliver is thicker, or nothing is cut.
 */
function thinSliver(rect: Rect, shown: Rect, on: Rect): Rect | undefined {
  const cutHigh = shown.height < rect.height;
  const cutWide = shown.width < rect.width;
  return (cutHigh && on.height <= PIXEL_OVERLAP_SLACK) || (cutWide && on.width <= PIXEL_OVERLAP_SLACK) ? shown : undefined;
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

/** A touch's place as its answer: off the screen — or outside what its scroll views draw, that scroll view named — or its centre in a system band; undefined when on the screen. */
function pointPlaced(facts: StandingFacts, place: PointPlace, offScreenVisible: number): TapJudgement | undefined {
  if (place === 'off') return { facts, kind: 'offScreen', at: facts.centre, visible: offScreenVisible };
  if (place === 'on') return undefined;
  if ('outside' in place) return { facts, kind: 'offScreen', at: facts.centre, visible: offScreenVisible, scroller: place.outside };
  return { facts, kind: 'systemBar', at: facts.centre, bar: place.bar, ...(place.band !== undefined && { band: place.band }) };
}

/** A touch's cut to a sliver as its answer, when the frame left a minimum to judge it by. */
const sliverCut = (facts: StandingFacts, cut: Cut | undefined): TapJudgement | undefined =>
  cut !== undefined && facts.minPiece !== undefined ? { facts, kind: 'cut', cut, minPiece: facts.minPiece } : undefined;

/** The centre under `line` (one no guard acts on) as its answer, else undefined. */
const underLine = (facts: StandingFacts, line: KeyboardLine | undefined): TapJudgement | undefined =>
  line !== undefined && facts.centre.y >= line.y ? { facts, kind: 'underKeyboard', line } : undefined;

/** `box` cut above a keyboard line — the box's width, from its top down to the line (no height for a line at or above its top); `box` itself with no line or one at or below its bottom. */
const aboveLine = (box: Rect, line: KeyboardLine | undefined): Rect =>
  line === undefined || line.y >= box.y + box.height ? box : { ...box, height: Math.max(0, line.y - box.y) };

/** The facts of a node judged in `frame`, from its exposure there. */
function factsIn({ scene, node, centre }: Judged, frame: Rect, exposed: Rect = frame, { sliver: judgeSliver = true } = {}): { facts: StandingFacts; seen: Exposure } {
  const seen = scene.order.exposure(node, exposed);
  const sliver = judgeSliver ? scene.clips.cutSliver(node, seen.minPiece) : undefined;
  const drawn = scene.clips.drawnIn(node)?.frame;
  const facts: StandingFacts = {
    centre,
    screen: frame,
    visible: visibleFractionInViewport(node.rect, frame),
    clipped: clippedEdges(node.rect, frame),
    covers: seen.covers,
    reaches: seen.reaches,
    ...(seen.centreCover !== undefined && { centreCover: seen.centreCover }),
    centreExcused: seen.centreExcused,
    ...(seen.presented.length > 0 && { presented: seen.presented }),
    shows: seen.shows,
    minPiece: seen.minPiece,
    ...(sliver !== undefined && { sliver }),
    ...(drawn !== undefined && { drawn: { ...drawn } }),
  };
  return { facts, seen };
}

/**
 * What both stops judge first, in their frame (`Scene`'s contract): `box`
 * cut above the keyboard line when one applies and to the drawn frame, its
 * covers judged below the status band on the box's own shape. `outside` is
 * the answer when nothing of the node lies in that frame — the line at or
 * above the box's top leaves no frame at all; else `offScreen` naming its
 * scroll view when some of it lies above the line but none is drawn there,
 * `underKeyboard` when some of it lies in the box under the line,
 * `offScreen` when none does — and undefined otherwise, the facts then
 * being the frame's for the purpose's own judgement.
 */
function inStopFrame(judged: Judged, box: Rect, bands: StandingScreen | undefined, line: KeyboardLine | undefined): { facts: StandingFacts; outside?: TouchJudgement } {
  const { scene, node, centre } = judged;
  if (line !== undefined && line.y <= box.y) {
    const facts: StandingFacts = { centre, screen: { ...box, height: 0 }, visible: 0, clipped: [], covers: [], reaches: [], centreExcused: [], shows: 0 };
    return { facts, outside: { facts, kind: 'underKeyboard', line } };
  }
  const above = line === undefined ? { ...box } : { ...box, height: line.y - box.y };
  // Only what its scroll views draw (the drawn frame).
  const frame = drawnFrame(judged, above);
  // Its covers below the status band; what shows keeps the node's own part in the band (`bandShows`).
  // docs/adr/0008-scroll-until-exposure-box-below-status-band.md
  const exposed = belowStatusBand(frame, bands, box);
  const facts = bandShows(judged, frame, exposed, factsIn(judged, frame, exposed).facts);
  if (facts.visible > 0) return { facts };
  // Above the line but nothing of it drawn there: outside its scroll view, which a scroll moves it into.
  const shown = rectIntersection(node.rect, above);
  const drawn = scene.clips.drawnIn(node);
  if (shown !== undefined && drawn !== undefined) return { facts, outside: { facts, kind: 'offScreen', at: centre, visible: 0, scroller: scrollerOf(drawn, (f) => !rectsOverlap(f, shown)) } };
  if (line !== undefined && visibleFractionInViewport(node.rect, box) > 0) return { facts, outside: { facts, kind: 'underKeyboard', line } };
  return { facts, outside: { facts, kind: 'offScreen', at: centre, visible: 0 } };
}

/** THE ORDER past the frame, for both stops: where it lies, cut, covered by `cover`, its centre under a line no guard acts on — else `reachable` at its centre. */
function stopOrdered(facts: StandingFacts, placed: PointPlace, cut: TouchJudgement | undefined, cover: UiNode | undefined, line: KeyboardLine | undefined): TouchJudgement {
  return ordered<TouchJudgement>(
    pointPlaced(facts, placed, facts.visible),
    cut,
    () => (cover === undefined ? undefined : { facts, kind: 'covered', cover, aboveKeyboard: line !== undefined }),
    underLine(facts, line?.witnessed === false ? line : undefined),
    { facts, kind: 'reachable', at: facts.centre },
  );
}

/** The plain stop's standing (`Scene`'s contract): its centre placed, a sliver cut, a cover over its centre alone. */
function stopStanding(judged: Judged, place: PointPlace, box: Rect, bands: StandingScreen | undefined, line: KeyboardLine | undefined): TouchJudgement {
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
function fullyStanding(judged: Judged, place: PointPlace, box: Rect, bands: StandingScreen | undefined, line: KeyboardLine | undefined): TouchJudgement {
  const { facts, outside } = inStopFrame(judged, box, bands, line);
  if (outside !== undefined) return outside;
  if (facts.clipped.length > 0) {
    const byScrollView = clippedByScrollView(judged, box, facts);
    return { facts, kind: 'clipped', edges: facts.clipped, ...(byScrollView !== undefined && { byScrollView }) };
  }
  // The system bands as a region, as the pixel assert judges them — any of the node past the slack.
  // docs/adr/0009-android-navigation-band.md
  // Not for content no scroll lifts out of a band (`pinnedSurface`): it stops as before.
  const placed = place === 'on' && pinnedSurface(judged.node, box, bands, judged.scene.clips) === undefined ? (systemBandOver(judged.node.rect, box, bands) ?? place) : place;
  return stopOrdered(facts, placed, undefined, facts.centreCover ?? facts.covers.at(-1), line);
}

/**
 * What of the node's clip (`facts.clipped`) its scroll view's edge makes (`ScrollViewCut`), or undefined when none of
 * it: an edge where the frame judged in ends at the drawn frame's edge (geometry.ts#Clips.drawnIn) and the box does
 * not — a scroll view ending at the screen's edge, or a keyboard line above its edge, leaves the screen's or the
 * keyboard's cut.
 */
function clippedByScrollView({ scene, node }: Judged, box: Rect, facts: StandingFacts): ScrollViewCut | undefined {
  const drawn = scene.clips.drawnIn(node);
  const frame = drawn?.frame;
  if (drawn === undefined || frame === undefined) return undefined;
  const line = (r: Rect, edge: Edge): number => (edge === 'top' ? r.y : edge === 'bottom' ? r.y + r.height : edge === 'left' ? r.x : r.x + r.width);
  const edges = facts.clipped.filter((edge) => line(facts.screen, edge) === line(frame, edge) && line(box, edge) !== line(frame, edge));
  if (edges.length === 0) return undefined;
  const across = (edge: Edge): boolean => edge === 'top' || edge === 'bottom';
  // Longer than what of the drawn frame is judged in (`facts.screen`: the box's part of it, above any keyboard line).
  const shown = facts.screen;
  const longer =
    edges.some(across) && node.rect.height > shown.height ? 'taller' : edges.some((e) => !across(e)) && node.rect.width > shown.width ? 'wider' : undefined;
  return { edges, scroller: scrollerOf(drawn, (f) => !rectWithin(node.rect, f)), ...(longer !== undefined && { longer }) };
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
function tapStanding(judged: Judged, place: PointPlace, chosen: Rect, boxes: readonly Rect[], bands: StandingScreen | undefined, line: KeyboardLine | undefined): TapJudgement {
  const { scene, node } = judged;
  // Less the system bands, and only what its scroll views draw (the drawn frame).
  const clear = systemBands(chosen, bands).clear;
  const box = drawnFrame(judged, clear);
  const within = aboveLine(box, line);
  // Whether the line cuts the screen, not the drawn frame: a scroll view laid out above the keyboard ends at its line.
  const aboveKeyboard = aboveLine(clear, line) !== clear;
  const unwitnessed = line?.witnessed === false ? line : undefined;
  const frame = unwitnessed === undefined ? box : within;
  const { facts, seen } = factsIn(judged, frame);
  const offScreenVisible = boxes.length === 0 ? 0 : Math.max(...boxes.map((b) => visibleFractionInViewport(node.rect, drawnFrame(judged, b))));
  const cover = (): TapJudgement | undefined => {
    const over = seen.centreCover;
    if (over === undefined) return undefined;
    const piece = within === frame ? seen : scene.order.exposure(node, within);
    if (piece.tapAt === undefined) return { facts, kind: 'covered', cover: over, ...(piece.largest !== undefined && { largest: piece.largest }), aboveKeyboard };
    if (!piece.tapAt.moved) return { facts, kind: 'reachable', at: piece.tapAt.point };
    return { facts, kind: 'reachable', at: piece.tapAt.point, moved: { piece: piece.tapAt.piece, cover: over, aboveKeyboard } };
  };
  return ordered<TapJudgement>(pointPlaced(facts, place, offScreenVisible), sliverCut(facts, facts.sliver), cover, underLine(facts, unwitnessed), { facts, kind: 'reachable', at: facts.centre });
}

/**
 * The pixel assert's standing (`Scene`'s contract): judged in `box` less the
 * status band, its covers where that meets what it reads; its place a
 * region's (`regionPlace`); cut only at the navigation bar, flush, for a
 * reader of glyphs (`cutAtNavigationBar`); covered by a PIXEL cover
 * (draw-order.ts#paintsOver) — the one on top at its centre, else the last
 * drawn. `flat`: the tree lists no ancestry (draw-order.ts#listsAncestry).
 */
function pixelStanding(judged: Judged, place: RegionPlace, box: Rect, bands: StandingScreen | undefined, purpose: PixelRead, flat: boolean): PixelJudgement {
  const { scene, node } = judged;
  const below = belowStatusBand(box, bands);
  // Only the part of the box below the band that the measurement reads: what lies over the rest of the node is never sampled.
  const read = rectIntersection(below, purpose.reads) ?? { ...purpose.reads, width: 0, height: 0 };
  // No sliver: the pixel assert measures a container-cut node on what shows (D5).
  // docs/adr/0012-pixel-assert-residuals-d4-d6.md
  const { facts } = factsIn(judged, drawnFrame(judged, below), read, { sliver: false });
  const flush = purpose.glyphs ? cutAtNavigationBar(node, box, bands, scene) : undefined;
  const cover = (): PixelJudgement | undefined => {
    const covers = scene.order.paintsOver(node, read);
    const centre = rectCentre(node.rect);
    const over = covers.filter((c) => containsPoint(c.reach, centre)).at(-1) ?? covers.at(-1);
    if (over === undefined) return undefined;
    const overRoot = flat && screenSized(node.rect, box);
    return { facts, kind: 'covered', cover: over.node, aboveKeyboard: false, reach: over.reach, ...(overRoot && { overRoot: true as const }) };
  };
  const placed = ((): PixelJudgement | undefined => {
    if (place === 'on') return undefined;
    if ('off' in place) {
      const sliver = place.off === 'sliver' && { sliver: { ...place.on } };
      const scroller = place.off !== 'wholly' && place.scroller !== undefined && { scroller: place.scroller };
      return { facts, kind: 'offScreen', box: { ...box }, ...sliver, ...scroller };
    }
    if ('keyboard' in place) return { facts, kind: 'underKeyboard', line: place.keyboard, band: place.band };
    return { facts, kind: 'systemBar', at: facts.centre, bar: place.bar, band: place.band };
  })();
  const cut: PixelJudgement | undefined = flush === undefined ? undefined : { facts, kind: 'cut', ...flush };
  return ordered<PixelJudgement>(placed, cut, cover, undefined, { facts, kind: 'reachable', at: facts.centre });
}

/**
 * `rect` is the screen itself for the pixel assert: at least
 * SCREEN_SIZED_FRACTION of `box`'s area (adapters/types.ts). No scroll
 * moves it out from under anything — the pixel assert's `fixed` remedy
 * (`remedied`), and a flat list's root (`covered.overRoot`).
 */
const screenSized = (rect: Rect, box: Rect): boolean => rectArea(rect) >= rectArea(box) * SCREEN_SIZED_FRACTION;

/**
 * `rect` is a full-bleed header on `box`: laid from the box's top edge at its
 * full width (iOS's, or Android 15+'s edge-to-edge app bar under the status
 * band). No scroll moves it out from under the status bar — a pinned
 * header's place, the pixel assert's `fixed` remedy (`remedied`).
 */
const fullBleedHeader = (rect: Rect, box: Rect): boolean => rect.y <= box.y && rect.x <= box.x && rect.x + rect.width >= box.x + box.width;

/**
 * `rect` is a full-bleed footer on `box`: laid to the box's bottom edge at
 * its full width (a bottom sheet, an edge-to-edge bottom bar under the
 * navigation band) — `fullBleedHeader`'s twin at the bottom edge.
 */
const fullBleedFooter = (rect: Rect, box: Rect): boolean =>
  rect.y + rect.height >= box.y + box.height && rect.x <= box.x && rect.x + rect.width >= box.x + box.width;

/**
 * Content NO scroll lifts out of a system band, and which: a node in no
 * scroll view (`Clips.inScroller` not true — idb's flat list, which cannot
 * tell, counts as none, as the pixel assert's `pinned` and `stuck` do) that is the
 * screen itself (`screenSized`), a full-bleed header (`fullBleedHeader`)
 * or a full-bleed footer (`fullBleedFooter`); and, in a scroll view, the
 * screen itself only when it is taller than the room between the bands
 * (`box` less both, `systemBands`), which no scroll can clear it into.
 * Undefined for anything else, a scroll view's content above all — a list
 * row at the screen's top edge, a 1080x2000 page that fits between the
 * bands — which a scroll does lift. A `fully`
 * stop judges no band's region over it (`Scene`'s contract), and the pixel
 * assert's remedy for it under a bar is `fixed` (`remedied`): its advice
 * leads with something in it clear of the bar.
 * docs/adr/0009-android-navigation-band.md
 */
function pinnedSurface(node: UiNode, box: Rect, bands: Bands, clips: Pick<Clips, 'inScroller'>): 'screen' | 'header' | 'footer' | undefined {
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
