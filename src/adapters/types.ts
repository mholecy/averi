/**
 * Device Adapter — the only layer that knows platform commands.
 * One interface, two implementations (Android/adb, iOS/simctl+idb).
 * Everything above this layer is platform-agnostic. See ARCHITECTURE.md §3.
 */

import type { IosTreeSourceKind } from './ios-node.js';

export type Platform = 'android' | 'ios';

/** One entry of a platform's device list (discovery.ts, behind the registry's DeviceDiscovery). */
export interface Device {
  id: string; // adb serial / simctl UDID
  platform: Platform;
  name: string;
  osVersion: string;
  /**
   * `unauthorized` is Android only: adb lists the device, but it has not
   * accepted this computer's debugging key (discovery.ts#androidUnusable
   * words it). Android's `offline` is a device adb lists but cannot talk to;
   * iOS's is a simulator that is not booted.
   */
  state: 'booted' | 'offline' | 'unauthorized';
}

/**
 * Screen size in the platform's own tree units — see `DeviceAdapter.viewport`,
 * which is the one place that reads it. Named here rather than in verify/ so
 * the reading and every use of it share a definition.
 */
export interface DeviceScreen {
  width: number;
  height: number;
  /**
   * The platform may lay an app window out BESIDE its system bars: on
   * Android a landscape window next to a side navigation bar (3-button
   * navigation) or a display cutout the app does not draw into starts inset,
   * or ends short of the screen, by that bar's width — and uiautomator's
   * root is that window. Set by the Android adapter only. iOS leaves it
   * unset: its app window is the screen and the safe areas lie INSIDE it,
   * so an inset rect in an iOS tree is content, never the window. Read by
   * verify/scale.ts, which measures such a window instead of refusing it as
   * a CONTENT width.
   */
  windowsBesideSystemBars?: boolean;
  /**
   * The height of the band at the top of the screen held upright that is
   * NOT the app's to tap — the system status bar, in the tree's units. Set
   * by both adapters:
   * - iOS: the status bar down to the safe area, by the screen's size
   *   (ios-status-band.ts, the measurement there) — always set;
   * - Android: the VISIBLE status bar's frame out of `dumpsys window
   *   displays` (android.ts#parseStatusBand, 66 px on the measured 1080x2220
   *   emulator) — unset when the bar is hidden (an immersive app) or the
   *   dump does not say (fail open). Its status bar does not lie outside
   *   the app's window for an app that draws edge-to-edge — Google Contacts
   *   dumps its collapsed app bar at y 0 under the bar, and a tap at (256,3)
   *   went to the bar. In an app that keeps clear of the bar no node lies in
   *   the band, so it changes nothing there.
   *   docs/bugs/2026-10-10-android-tap-and-scroll-until-treat-the-system-status-bar-as-app-screen.md
   * Carried to the judgements by ui-tree/usable-screen.ts#UsableScreen, which
   * says how it is cut (ui-tree/standing.ts#Scene).
   */
  statusBand?: number;
  /**
   * The TOP edge of the band at the bottom of the screen held upright that
   * is the system navigation bar's, in the tree's units — Android only
   * (android.ts#parseNavigationBand: the VISIBLE bar's frame out of the same
   * `dumpsys window displays` as `statusBand`, across the bottom of the
   * display that dump describes; 2154 on the measured 1080x2220 emulator).
   * Unset when the bar is hidden, at a side, the display is turned
   * (landscape: a residual) or naturally landscape (a tablet), or the dump
   * does not say.
   * Carried to ui-tree/usable-screen.ts#UsableScreen, where the judgements read
   * it (ui-tree/standing.ts#Scene).
   */
  navigationBand?: number;
}

/**
 * A screen size that can be divided by, or swiped in: finite and positive on
 * both axes. The one spelling of "this size is usable", read wherever a
 * size is: verify/scale.ts's witness, ui-tree/usable-screen.ts#usableScreenOf,
 * ui-tree/geometry.ts#windowTurnsScreen and interact/swipe.ts#screenBox's
 * refusal.
 */
export const usableSize = ({ width, height }: { width: number; height: number }): boolean =>
  Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;

/**
 * A point in the platform's tree units (Android pixels, iOS points) — a tap
 * point, a swipe's end. Named here, beside the screen it lies on, because
 * `DeviceAdapter.swipe` takes it; the adapters, ui-tree's point helpers
 * (`tapPoint`, `containsPoint`, draw order's `drawnOverAt`) and interact/ all
 * name it here.
 */
export interface Point {
  x: number;
  y: number;
}

/** One swipe's from/to points — what interact/swipe.ts#swipeVector returns and `DeviceAdapter.swipe` draws. */
export interface Stroke {
  from: Point;
  to: Point;
}

/** Integer points (iOS) or pixels (Android), as the platform reports them. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The rect of a node that has none: a synthetic root, a dump without bounds,
 * an element without a frame. A factory, never a shared constant — nodes are
 * mutated downstream (field-error pairing, geometry) and two nodes must not
 * share one rect object.
 */
export const zeroRect = (): Rect => ({ x: 0, y: 0, width: 0, height: 0 });

/**
 * The side of its container a node lies wholly past (`UiNode.clippedOut`) —
 * and any rect's side: ui-tree/geometry.ts re-exports it as `Edge` (the side
 * a rect extends past or lies flush with), so `clippedOut` and a cut's edge
 * compare as one type.
 */
export type ClippedSide = 'top' | 'bottom' | 'left' | 'right';

/**
 * width × height, and 0 for anything degenerate — a zero rect (`zeroRect`),
 * a negative or NaN side. The one spelling of "has this rect an area": the
 * visible fraction and the bare-tree rule above this layer (ui-tree/
 * geometry.ts re-exports it), and the idb source's empty-tree check here
 * (ios-tree-source.ts), which may not import ui-tree/.
 */
export function rectArea(rect: Rect): number {
  if (!(rect.width > 0 && rect.height > 0)) return 0;
  const a = rect.width * rect.height;
  return Number.isFinite(a) ? a : 0;
}

/**
 * Exactly the same rect — x, y, width AND height; a resize is a change.
 * The pixel poll's rect confirmation (verify/pixel-poll.ts) asks it of two
 * consecutive tree reads; exact, because tree rects are whole points and
 * "nearly the same place" is the stale-crop case it exists to catch. The
 * WDA parser's text-echo rule (wda-source.ts#isTextEcho) asks it of a
 * StaticText and its one child; here, below ui-tree/geometry.ts (which
 * re-exports it), so adapters/ need no second spelling.
 */
export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * The same rect to within a pixel on every side — under 1 unit of x, y,
 * width and height apart. `sameRect`'s sibling, kept beside it so rect
 * equality has one owner with two honestly named questions.
 * `scroll_until` asks it of one match's rect read for read — "did the
 * stroke move it?", "did the confirming read find it where the stop's read
 * did?" — where a sub-unit difference between reads (fractional
 * coordinates, a rounding in the tree source) is not motion. Exact
 * equality stays the question for `sameRect`'s callers: there a one-unit
 * change IS the finding.
 */
export function sameRectWithinPixel(a: Rect, b: Rect): boolean {
  return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
}

/**
 * Do two rects share any area at all? Positive area only: rects that merely
 * touch along an edge or at a corner — `a` ending at y=1285 where `b` begins —
 * do not overlap, and neither does a zero-area rect with anything. The pixel
 * poll's soft-keyboard check (verify/pixel-poll.ts) asks it:
 * an element any part of which lies under the keyboard is measured as the
 * keyboard, so ANY overlap counts there, and an element sitting flush on top
 * of the keyboard's frame is not under it. Both rects in the same units —
 * the caller's to guarantee. ui-tree/geometry.ts's `intersectsViewport` is the
 * same arithmetic against a viewport anchored at the origin; its
 * `containsPoint` is point-in-rect, a different question. Here, below
 * ui-tree/geometry.ts (which re-exports it): the WDA parser's keyboard band
 * test needs it and may not import that layer.
 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return rectIntersection(a, b) !== undefined;
}

/**
 * The rect two rects share, or undefined when they share no area (an edge
 * or a corner in common is none) — `rectsOverlap`'s question answered with
 * the shared rect itself, and its one arithmetic. Callers: the box a scroll
 * stroke is drawn in, the gesture box met with a clipping container
 * (interact/swipe.ts#strokeBox), and the fill's nearest-input pick
 * (interact/fill.ts, its overlap area). Here beside `rectsOverlap`, below ui-tree/
 * geometry.ts, which re-exports it.
 */
export function rectIntersection(a: Rect, b: Rect): Rect | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}

/**
 * The role of the ONE node per on-screen soft keyboard that a tree source
 * emits when its tree contains the keyboard (the WDA source,
 * adapters/wda-source.ts#keyboardMarks). Its rect is the screen band the
 * keyboard covers — keys, AutoFill bar, accessory toolbar slot and dictation
 * row together — not the `Keyboard` element's own rect, which was measured
 * 17–44 pt short of the drawn area (the bug note below). Read by `ui-tree/soft-keyboard.ts#keyboardInTree`, the
 * in-tree half of the soft-keyboard reading the tap guard and the pixel
 * poll share with the Android oracle. Defined beside UiNode because the
 * adapter writes it and ui-tree reads it, and neither may spell the string.
 * Not in INTERACTIVE_ROLES (a selector never prefers it) and not structural
 * (ui-tree/bare-tree.ts: a screen with its keyboard up has rendered).
 * Absent from a tree means nothing — an idb tree never carries one and a
 * WDA tree without one has no keyboard on screen, and the tree cannot say
 * which source it came from.
 * docs/bugs/2026-10-05-ios-tap-lands-on-soft-keyboard.md
 */
export const KEYBOARD_ROLE = 'keyboard';

/**
 * The normalised role of every text input (adapters/ios-node.ts: TextField,
 * SecureTextField, TextView; adapters/android.ts: EditText,
 * AutoCompleteTextView and the Compose input that dumps as a focusable,
 * long-clickable scroll view). Defined beside UiNode, as KEYBOARD_ROLE is,
 * because the adapters write it and both ui-tree (draw-order.ts: a text
 * input's own scroll indicator and its label) and interaction (fill.ts acts
 * on it, fill-text.ts names it in the not-an-input caveat) read it,
 * imported from here directly.
 */
export const INPUT_ROLE = 'textfield';

/**
 * The roles every source gives its wrappers (Application, Window, Other,
 * Cell; FrameLayout, View). Beside KEYBOARD_ROLE, the one place
 * `ui-tree/bare-tree.ts` and the draw order (`ui-tree/draw-order.ts`'s
 * `structural` row: a later wrapper contains every point and draws
 * nothing) both may read.
 */
export const STRUCTURAL_ROLES: ReadonlySet<string> = new Set(['container', 'other']);
/**
 * A node whose area reaches this fraction of the screen is screen-sized — a
 * window or application, whatever label the framework gave it. 0.9 leaves
 * room for a status-bar inset or a rounding difference between the wrapper and
 * the screen, while a content row (a Cell, a Pressable) sits far below it.
 * `ui-tree/bare-tree.ts` reads it for a wrapper by size and
 * `ui-tree/draw-order.ts` for a screen-sized host — here, for
 * STRUCTURAL_ROLES' reason above: neither ui-tree module imports the other
 * for a constant.
 */
export const SCREEN_SIZED_FRACTION = 0.9;

/**
 * The kinds of PRESENTED LAYER a tree source marks (`UiNode.presentation`) — one closed set: three a source types
 * (`alert`, `actionSheet`, `popover`), and `screen`, a presented screen it shows by its visibility flags.
 */
export type PresentationKind = 'alert' | 'actionSheet' | 'popover' | 'screen';

/** Normalized accessibility tree node — identical shape on both platforms. */
export interface UiNode {
  role: string; // normalized: button, text, textfield, image, container, keyboard (KEYBOARD_ROLE), ...
  label: string | null; // visible text / content description
  identifier: string | null; // resource-id / accessibilityIdentifier
  /**
   * Current value (text field contents, toggle state). A `textfield`'s null
   * value means EMPTY: both parsers map an empty or absent value to null
   * (android.ts and ios-node.ts, `emptyToNull` — an empty Compose field
   * dumps no `text` at all), so on an input null is "", never "withheld"
   * (interact/fill.ts reads it so). On any other role null is "no value
   * exposed".
   * docs/bugs/2026-10-09-android-fill-into-a-field-that-drops-everything-reads-exposes-no-value.md
   */
  value: string | null;
  /** Validation message associated with an input, when the platform exposes one. */
  error?: string;
  rect: Rect;
  children: UiNode[];
  /**
   * Set on the ROOT of a subtree that is the soft keyboard's own UI: on iOS through WDA, the Window that holds
   * the `Keyboard` element — keys, AutoFill bar, dictation button — and the
   * input-host Window UIKit pairs with it, which holds the app's
   * `inputAccessoryView` toolbar (the "Done" above a number pad) and the
   * `inputView` placeholder (adapters/wda-source.ts#keyboardMarks). A node
   * under such a root is never COVERED by the keyboard: it is the keyboard,
   * and a tap on it — a digit, Done, the Passwords bar — is what the user
   * does (ui-tree/soft-keyboard.ts#keyboardSideNodes walks the ancestry). On
   * the roots only, not on every descendant: `ui_snapshot` prints the tree
   * as JSON, and one mark per window says it where seventy would be noise.
   * Absent everywhere on Android and on an idb tree.
   */
  ofKeyboard?: true;
  /**
   * The text the field shows while it is EMPTY — its hint or placeholder —
   * when the tree source reports one apart from the value.
   * docs/bugs/2026-10-09-android-clear-reads-edittext-hint-as-content.md
   * Every source reports an empty field's placeholder AS its value (WDA
   * `value`, idb `AXValue`, uiautomator `text` on API 33, all measured that
   * day), so `value` alone cannot tell "empty, showing `Company`" from
   * "holds `Company`". Set only where the source names the placeholder
   * separately: WDA's `placeholderValue` (wda-source.ts) and a uiautomator
   * dump's `hint` attribute on a text input (android.ts — the API 33 dump
   * has none; newer dumps may). idb names none. Absent, never null or "",
   * when there is none, so trees that carry none are unchanged.
   *
   * `value` is NOT rewritten: a selector on `value:"Company"` and the
   * ui_snapshot JSON read what the source reported, as before; the
   * placeholder rides beside it (and ui_snapshot prints it, which is how a
   * reader tells the empty field from the full one). The one reader that
   * acts on it is interact/fill.ts, which counts a value EXACTLY equal to
   * the placeholder as an empty field — so a real value equal to its own
   * placeholder reads as empty there (the accepted cost: the tree cannot
   * tell the two apart).
   */
  placeholder?: string;
  /**
   * Set on a node whose DESCENDANTS' rects the tree source has already
   * intersected with this node's own rect (the bug note below): Android only, on every node uiautomator dumps
   * with `scrollable="true"` — a RecyclerView or ScrollView, and a Compose
   * scroller, which dumps as a plain `android.view.View` (role `container`)
   * and is told apart by this attribute alone. uiautomator reports each
   * node's bounds clipped to its scroll container (and the display), so a
   * row half behind a pinned bar reads shorter, with an edge exactly on the
   * container's edge — measured on the SWIFT form, container
   * `[0,242][1080,1978]`, a 143-px row read `{y:242, height:92}` — and
   * nothing in the rect says the rest exists. Read by
   * ui-tree/geometry.ts#clipsOf, which `scroll_until`'s round asks for
   * each match's such ancestors so a `fully: true` stop flush with one is
   * checked before it is reported (interact/scroll-rounds.ts#PROBE_REACH).
   * docs/bugs/2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container.md
   *
   * A flag, not a role: mapping a Compose scroller to
   * `scrollable` would change three things this fix does not want to touch —
   * ui-tree/bare-tree.ts counts any non-structural role as content, so a
   * Compose screen whose only node is an empty scroller would stop reading
   * bare (the unsafe direction for `absent:`, verdict.ts); `role:container`
   * and `role:scrollable` selectors written against today's trees would
   * change what they match; and ui-tree/draw-order.ts's
   * CONTENT_FRAMED_ROLES would start excusing those frames. Absent on iOS:
   * WDA and idb report a node's frame unclipped — a row under the top bar
   * reads at y -48, past the frame (interact/scroll-rounds.ts#beyondFarEdge
   * is built on that) — so there is nothing to mark. Absent too on an
   * Android node that cannot scroll now (`scrollable="false"`: a list whose
   * content fits), whose children are not cut by it.
   *
   * Residuals, stated: a View's
   * accessibility bounds are cut to EVERY ancestor's visible rect, not only
   * a scroller's, and Compose also subtracts what an overlay sibling covers
   * — a row cut by a pinned bar drawn over the list reads cut at the bar's
   * edge, not flush with any marked node, so the flag cannot reveal it (a
   * node whose own descendants still carry the uncut extent is widened to
   * it in the parser — `cutBounds` — and one whose descendants are cut too
   * stays this residual). A RecyclerView with padding and
   * clipToPadding draws a row cut at its padding edge while the row's rect
   * runs on to the view's edge: not flush, not caught either.
   */
  clipsDescendants?: true;
  /**
   * The bounds the tree source dumped for this node, when they were CUT
   * short of its own descendants by something drawn over it, and `rect` is
   * widened to their extent (the bug note below): Android only, set by the uiautomator parser
   * (adapters/android.ts#uncut, #widenUnderCovers).
   * Compose subtracts what an overlay sibling covers from a node's bounds
   * but not from its descendants': mp-native's Account Detail row under its
   * sticky date header (`0,401 1080x79`) dumped as `66,480 948x66` while its
   * own label and button read `66,403 948x143` — and the cut rect, whole in
   * the list and clear of the header, read "fully visible" with 77 of its
   * 143 px under the header. Widened, the row lies under the header drawn
   * after it: the draw order judges it covered there, `scroll_until`
   * strokes it out from under the header, a tap aims at the part that
   * shows (and is refused when that part is under the minimum tap piece),
   * and a rect assert measures the whole row, not the strip that showed.
   * Widened only along y, on one side, to descendants with the node's
   * exact x and width, cut to the nearest clipping ancestor
   * (`clipsDescendants`), and only where something is drawn over the strip
   * gained, as draw order's target column judges it for this node
   * (DrawnOverStrip; what draws is ui-tree/draw-order.ts's `NOT_DRAWN`); a control
   * padded inside its wrapper (`paddedTouchTargets`), a full-bleed child and
   * a child overflowing both edges never widen it either. Residuals,
   * stated: a node cut at BOTH ends (a tall card between a sticky header and
   * a floating tab bar) is not widened and reads whole; and, permanently, a
   * node whose touch target overflows one edge into the NEXT row of its
   * list is widened as if cut — in one dump the next row and a sticky
   * header are the same shape (siblings in the list, listed after the node,
   * drawing on the strip), and only a second read (did it move with the
   * scroll?) could tell them apart, which is `scroll_until`'s to make, not
   * the parser's. Kept so `ui_snapshot` shows what was dumped beside
   * what is judged: "its rect was cut here; something is drawn over the
   * rest". Absent on iOS (WDA and idb report frames unclipped) and on every
   * node the parser left as dumped.
   * docs/bugs/2026-10-09-android-fully-trusts-row-bounds-cut-at-a-sticky-header.md
   */
  cutBounds?: Rect;
  /**
   * The side of its container this node lies wholly PAST, when the tree
   * source dumped its bounds inverted (the bug note below): Android only, set by the uiautomator parser (adapters/
   * android.ts#nodeBounds). uiautomator cuts a node's bounds to its
   * container, and a node scrolled wholly past it keeps one edge of each —
   * Settings' `Apps` row under the collapsing app bar dumped
   * `[198,297][324,58]`, the list's top and the row's own bottom — which
   * reached every reader as `126x-239`: `ui_snapshot` printed it, the wait
   * called it "0×0", and `scroll_until` read it neither past the far edge
   * nor in the frame. `rect` is clamped to zero size at the container's
   * edge (`y` 297, height 0), so it is never a target, and this says which
   * way it went: `top` — clipped out above its scroll container — and
   * `bottom`, `left`, `right` likewise. Read by the wait's hint
   * (interact/resolve.ts#zeroAreaHint), by `scroll_until`, which reads a
   * node clipped out past its far edge as beyond it
   * (interact/scroll-rounds.ts#observe), and by the cut-sliver rule, to which a descendant
   * clipped out past an edge its ancestor lies flush with is evidence of a
   * cut there (ui-tree/geometry.ts#evidentCut). Absent on iOS and on every
   * node dumped the right way round.
   * docs/bugs/2026-10-09-android-inverted-uiautomator-bounds-pass-through-as-negative-heights.md
   */
  clippedOut?: ClippedSide;
  /**
   * Set on the ROOT of a tree its source gives as a FLAT LIST: idb's `describe-all`, every element
   * a child of a synthetic 0×0 root (adapters/ios-tree-source.ts#idbTree)
   * in the list's order — no node has a parent of its own, so nothing in
   * the tree says what a node belongs to. Read by ui-tree/draw-order.ts,
   * whose `target` question judges such a list by a rule of its own —
   * the top bar listed before the content is no cover's target
   * (`flatListChrome`), later content past a reading-order break is no
   * cover of a content target (`flatListReadingOrder`), and a node pinned
   * at the list's bottom covers down to the screen's bottom
   * (`bottomPinned`) — and asks an on-target text to repeat the target
   * (`onTarget`), the sibling guard being void there. A mark of the source,
   * like `ofKeyboard` and `clipsDescendants`: ui-tree knows no platform,
   * and the shape alone (a rectless root over leaves) would also match a
   * test's or a future source's tree that is not idb's. Absent on WDA and
   * Android trees.
   */
  flatList?: true;
  /**
   * Set on the ROOT of a tree whose source lists a control's minimum TOUCH
   * TARGET as a wrapper of its own around it: uiautomator's (adapters/android.ts#parseUiautomatorXml) —
   * Compose pads a control smaller than 48 dp to a 48-dp touch target, and
   * Google Contacts' Cancel reaches the dump as `container 11,88 132x132` →
   * the label node `other 'Cancel' 44,121 66x66`, `button 22,99 110x110`
   * (a 40-dp IconButton at 2.75 px/dp). Read by ui-tree/draw-order.ts,
   * whose `ownControl` row takes a control PADDED evenly in such a wrapper
   * and centred on the label for the label's own (`paddedOn`) only where
   * the shape was measured. A mark of the source, like `flatList`: ui-tree
   * knows no platform. Absent on WDA and idb trees — no wrapper of that
   * shape was seen there, and an unlabelled button laid with an even margin
   * over a centred text (a card's overlay) stays its cover.
   */
  paddedTouchTargets?: true;
  /**
   * Set on the ROOT of a tree whose source reports every frame UNCLIPPED: WDA's (adapters/wda-source.ts
   * #parseWdaSourceValue). It lists a scroll view's content at its laid-out rect even past the scroll view's frame,
   * where the scroll view draws none of it (UIKit's `UIScrollView` clips to its bounds; so do a table, a collection
   * view and SwiftUI's `ScrollView`) — measured: the at-rest SWIFT form lists `payee_name_input` at `24,801 354x52`,
   * below its `ScrollView 0,0 402x780`, and the capture shows the bare background there. Read by
   * ui-tree/draw-order.ts#listsUnclippedFrames, so geometry.ts#Clips.drawnIn cuts a node's frame by what scrolls
   * above it. A mark of the source, like `flatList`: ui-tree knows no platform. Absent on Android's trees
   * (uiautomator cuts every node's bounds to its ancestors' visible rects: nothing is left to cut) and on idb's flat
   * list (no scroll view listed).
   */
  unclippedFrames?: true;
  /**
   * Set on every node of a HIDDEN SUBTREE of a WDA tree (adapters/wda-source.ts#hiddenRoots): a node of no structural
   * role (`STRUCTURAL_ROLES`: not WDA's `Other`, `Cell`, `Window`, … — a control, an image, a text, a scroll view, a
   * toolbar) that WDA reports `isVisible="0"` AND `isAccessible="0"`, whose every descendant is `isVisible="0"`, roots
   * one, and the subtree goes as one; a descendant's `isAccessible` is not consulted. Measured on mp-native's SWIFT
   * form pushed over the tab host (tests/fixtures/wda-capture-swift-form-pushed.json): the host's tab bar, which the
   * pushed screen hides, is listed AFTER the form at `69…266,711` (the shown bar is at y 755), each `nav.tab_*` button
   * `0/0` and its icon `Image` `isVisible "0" isAccessible "1"` — so the Image goes with its button. A structural
   * wrapper never roots one: WDA reports the form's `payee_name_input` row `0/0` with an invisible subtree too (it
   * lies below its form's ScrollView, undrawn — the standing's drawn frame, not this flag, judges that).
   *
   * Its readers, all of them:
   * - ui-tree/draw-order.ts's `hidden` row, in the `target` column only: such a node is no cover of a target unless it
   *   is the surface of a screen presented over the target's (`presentedSurface`, ADR 0018) — WDA marks the New
   *   Contact sheet's form `Table` `0/0` while the discard popover is up over it, and that Table still covers the list
   *   beneath. Through that column it reaches every caller of `exposure`, `paintsOver` and `coversOf`: the tap's aim
   *   (interact/tap-judgement.ts), `scroll_until`'s standing and the pixel assert's covers (ui-tree/standing.ts), the
   *   in-tree dismissal picker (interact/keyboard-in-tree.ts, which still sees an excused hidden node in
   *   `Exposure.centreExcused`), and the uiautomator parser's strip question (never met: only WDA sets the mark).
   * - `ui_snapshot`, which prints it with the tree's JSON (mcp/tools.ts), so later device trees can be swept for it.
   * Nothing else: a TARGET's own flag is never read (a target under a modal is `isVisible="0"` too), and selectors,
   * asserts and the stroke box's `drawnOver` column are as before.
   *
   * On EVERY node of the subtree, not only its root (unlike `ofKeyboard`): `ui_snapshot` with a filter prints the
   * matched nodes without their ancestors, and a filtered tab button must still say it is hidden. Absent, never false,
   * everywhere else — on an idb or Android tree always.
   * docs/adr/0019-wda-hidden-subtrees-and-parked-cell-content.md
   */
  hidden?: true;
  /**
   * Set on a PRESENTED LAYER — a Window's direct child that the tree source itself says is presented over every
   * screen drawn before it (`PresentationKind`) — by the WDA parser (adapters/wda-source.ts#presentedLayers), one mark
   * per layer:
   * - by the TYPE of an element the layer holds: `alert` (WDA's `Alert`), `actionSheet` (a `Sheet`: UIKit's action
   *   sheet, its message the label), `popover` (a `Popover` holding neither) — that element carries
   *   `presentationElement`, and names the layer;
   * - by WDA's own visibility flags, `screen`: the first screen-sized layer of its Window with visible content on the
   *   screen, laid after a screen-sized layer carrying content every node of which reads `isVisible="0"` (and every
   *   earlier such layer of that Window reads so too). UIKit's modal presentation hides the presenting screen from
   *   accessibility; WDA reports it whole, invisible — measured on page sheets, SwiftUI half sheets and React Native
   *   transparent modals (iPhone 17, iOS 27). The flags of a whole LAYER beneath and of a visible later one, never one
   *   node's, never a target's own.
   * The source's fact, not a shape draw order infers: a marked layer covers what lies OUTSIDE it and is drawn before
   * it, through the whole screen, whatever the frames around it.
   *
   * Its readers, all of them:
   * - ui-tree/draw-order.ts#markOf, the one reading of it in code (with `presentationElement`): a typed layer's
   *   element, when its rect has area on the screen (never judged by `hidden`), is that layer's ONE cover through the
   *   whole screen; a `screen` layer reaches the whole screen and its own nodes stay covers, each a presented surface
   *   (`markedLayers`: `Exposure.presented`, `presentedAt`, `presentedOver`, `markedAt`); draw order hands the mark on
   *   as `MarkedLayer` (its kind and label, `DrawOrder.presentedPress`) — to the standing's remedy
   *   (ui-tree/standing.ts#presentedRemedy: "an alert is presented over it ("Exit confirmation")") and to
   *   `scroll_until`'s stroke (interact/scroll-rounds.ts), never the node itself.
   * - `ui_snapshot`, which prints it with the tree's JSON (mcp/tools.ts), so later device trees carry it.
   * Absent everywhere else — on an idb or Android tree always.
   */
  presentation?: PresentationKind;
  /**
   * Set on the ELEMENT that names a layer marked by type (`presentation` `alert`, `actionSheet` or `popover`): the
   * `Alert`, the `Sheet` or the `Popover` itself — its label is the layer's in the remedy, its rect where the layer is
   * named. Read only with `presentation`, by ui-tree/draw-order.ts#markOf; printed by `ui_snapshot`.
   */
  presentationElement?: true;
  /**
   * Set on the ROOT of a tree whose source JUDGED presented layers from its own evidence: a WDA payload carrying
   * visibility flags (adapters/wda-source.ts#parseWdaSourceValue) — its presented layers are the ones it marks
   * (`presentation`), so draw order asks no shape of it (ui-tree/draw-order.ts#givesWay). Absent on a tree whose source
   * says nothing of presentation (idb, Android, a flagless WDA payload, a snapshot printed before the mark existed):
   * there draw order still infers a presented screen from shape. Printed by `ui_snapshot`.
   */
  presentationsJudged?: true;
}

/**
 * Every node under `root`, pre-order, the root first. The one tree walk:
 * field-error pairing feeds WDA's nested tree to its flat rule with it, the
 * text hint flattens with it, ui_snapshot's note counts with it. It lives
 * beside UiNode rather than in a verify/ or adapters/ sibling because all
 * three layers need it and none owns it. It yields nodes
 * only: a walk that needs each node's subtree end in the order
 * (ui-tree/draw-order.ts) or what its ancestors hand down
 * (ui-tree/geometry.ts#clipsOf) recurses on its own.
 */
export function* everyNode(root: UiNode): Generator<UiNode> {
  yield root;
  for (const child of root.children) yield* everyNode(child);
}

/**
 * Is anything drawn over `strip` of `node`? Asked of one tree, `root`, as
 * the tree source read it, for each node it asks about: the uiautomator
 * parser widens a node cut short of its own content only under something
 * drawn over the strip it would gain (android.ts#parseUiautomatorXml,
 * `UiNode.cutBounds`). What draws is the UI-tree layer's judgement
 * (ui-tree/draw-order.ts#drawnOverStrip), which an adapter may not import;
 * so the parser is handed it, required — the composition root
 * (mcp/registry.ts) and the test helper wire it. Dependency inversion with
 * ONE implementation, not a seam: there is no second judgement to plug in,
 * and a parser-side fallback would be one. The judge sees the rects as
 * dumped, and is discarded before any rect changes.
 */
export type DrawnOverStrip = (root: UiNode) => (node: UiNode, strip: Rect) => boolean;

/**
 * Selector strings resolved against the normalized tree, e.g.
 *   id:login_pin_field | text:"Continue" | role:button label~"Pay.*"
 */
export type Selector = string;

export type Key = 'back' | 'home' | 'enter';

/** See `KeyboardOracle.witness`: confirmed shown / denied / cannot tell. */
export type KeyboardWitness = 'shown' | 'hidden' | 'unknown';

/**
 * What a platform can say about its on-screen (soft) keyboard — see
 * `KeyboardOracle.state`. Three answers, not "a frame or undefined",
 * because the two callers need different things from the missing frame:
 * the tap guard only asks "does it cover my point" (hidden and
 * unknown both mean "tap as before"), but `dismissKeyboard` must tell "no
 * keyboard — pressing back would NAVIGATE" from "could not tell — keep doing
 * what was always done". One `undefined` would have forced one of them to
 * guess.
 *
 * `frame` is the screen rect the keyboard covers, in the SAME units as uiTree
 * rects (Android: pixels), so a tap point can be tested against it directly.
 */
export type SoftKeyboard =
  | {
      state: 'shown';
      frame: Rect;
      /**
       * Rects the keyboard's WINDOW covers beyond `frame`, the inset band:
       * a floating Gboard on API 33 keeps only a 132-px collapse strip as its
       * IME inset — `frame` — while its panel, mid-screen, is a second rect of
       * the IME window's touchable region. Never set by `KeyboardOracle.state()`
       * (one command, the band only): a reading
       * (`ui-tree/keyboard-cover.ts#readKeyboard`, the one composer of an
       * oracle reading, behind every reader of the keyboard) adds them from
       * `KeyboardOracle.touchable()` when the band is up, by `panelsBeyond`'s
       * rules there. Absent: none, or not read (the in-tree model, a docked
       * keyboard whose region IS the band, a region that could not be
       * trusted). Every question a reading answers about a point or a rect
       * tests `frame` AND these.
       * docs/bugs/2026-10-05-android-floating-gboard-keyboard.md
       */
      panels?: readonly Rect[];
    }
  | { state: 'hidden' }
  /** The platform did not answer, or answered in a shape the adapter does not recognise. Callers behave as before the question existed. */
  | { state: 'unknown' };

/**
 * The soft-keyboard oracle: what a platform whose keyboard is a SEPARATE
 * WINDOW — absent from its accessibility tree, hidden by `back` — can tell
 * about it. An optional capability of the adapter (`DeviceAdapter.keyboard`),
 * not two methods every adapter must stub: exactly one platform
 * answers (Android), and an adapter without the oracle is one whose keyboard,
 * if any, is part of the tree — on iOS its keys are nodes, and the
 * covered-target problem has a different shape: the tree that resolved
 * the target is read for a `KEYBOARD_ROLE` node (the WDA source emits one
 * per on-screen keyboard), a covered tap point is REFUSED unless the config
 * names a dismissal to tap first (`app.ios.keyboardDismiss`, a neutral
 * element or the accessory toolbar's button —
 * interact/keyboard.ts#KeyboardDismissal), and no KEY is pressed — there is
 * no non-submitting key to press (the bug note's "Fix (stage A)" and "Fix
 * (stage B)").
 * docs/bugs/2026-10-05-ios-tap-lands-on-soft-keyboard.md
 *
 * Two kinds of keyboard, one fact with two halves — stated in full here,
 * beside the capability; the in-tree dismissal (interact/keyboard-in-tree.ts)
 * points here and ARCHITECTURE §3 repeats the short form. Providing an
 * oracle asserts the WINDOW model: the keyboard it describes is a separate
 * window that `back` hides, and interact/keyboard-window.ts — the model an
 * adapter with the oracle gets (interact/keyboard.ts#keyboardModel chooses,
 * once), the one owner of what to DO about the answers — presses that
 * `back` only through such an adapter, witness-vetoed. Its absence asserts the IN-TREE model (iOS: the keys are
 * nodes): nothing to observe, no `back` to press, and the dismissal after a
 * fill is one tap on a configured element when the tree shows a keyboard
 * band, and NOTHING otherwise — not `enter`, pressed blind, which was
 * measured to SUBMIT the form from the field (K5d in the bug note) — so a
 * NEW adapter that ships without an oracle gets a dismissal that presses nothing unless its
 * tree source marks the band and the config names an element; a platform
 * whose keyboard is a window `back` hides adds the oracle rather than a
 * platform branch in interact/. Not a dismiss-key property on the adapter:
 * the guard's `back` must stay bound to the window
 * model, or an oracle whose key were the in-tree one would submit forms
 * under a covering keyboard, and "back was pressed (it may have
 * navigated)" would be false.
 *
 * Both methods NEVER throw and never guess: a command that fails, times out or
 * prints something unrecognised is `unknown`, and callers behave as before the
 * question existed. Neither is memoized (unlike `viewport`): the answer
 * changes with every focus, and the registry keeps one adapter for a whole
 * session — a cached `hidden` would veto every later dismissal.
 */
export interface KeyboardOracle {
  /**
   * Is a soft keyboard on screen, and which rect does it cover?
   *
   * Platform knowledge, hence behind the adapter: on Android the keyboard is a
   * separate window that is NOT in the uiautomator tree, so a node under it
   * resolves, settles and reports a rect like any other — and a tap at its
   * centre presses a keyboard key (measured on the finportal login: the
   * submit button at (249,1466) under an IME frame starting at y=1285; one
   * stray character went into the password field, nothing was submitted, the
   * tap was reported done). What to DO about it is interact/keyboard-window.ts's
   * policy; this method only answers.
   */
  state(): Promise<SoftKeyboard>;
  /**
   * An INDEPENDENT second opinion on "is a soft keyboard shown" — no frame,
   * a different source than `state()`. It exists because the
   * first answer can be stale: measured on Android 13, right after
   * a tap that navigated away the window state still read "shown" with the
   * full frame for a few seconds, while the input method itself already said
   * it was not. It is asked (a reading's `over`, once the frame covers the
   * tap point) immediately before interact/keyboard-window.ts presses
   * `back` for keyboard reasons — never on an ordinary tap. Also in two
   * places that press nothing: where `state()` read HIDDEN and
   * the caller has no tap point — the post-fill dismissal, and
   * `scroll_until` on a failed or `fully: true` stop (a reading's
   * `unlocated`, the `unlocated` row: window hidden, input method shown,
   * only reported) — and in `scroll_until` before a `shown` band may change
   * its judgement or its stroke (a reading's `corroborated`, the same veto;
   * at most once a round, on every round a band matters — the answer is
   * never kept). Every one of them asks through a reading
   * (ui-tree/keyboard-cover.ts#readKeyboard), the one caller of this method,
   * which asks it at most once per reading, relies on the never-throws
   * contract above and has no catch.
   *
   * A method of its own rather than an option on `state()`: the caller needs
   * it at a different moment (after the frame has been tested against the
   * tap point), and one call that sometimes runs two commands would hide the
   * cost the policy is pinned to.
   */
  witness(): Promise<KeyboardWitness>;
  /**
   * The keyboard WINDOW's touchable region and the input method's word,
   * read together in ONE call (the floating-Gboard device check, the bug
   * note on `SoftKeyboard.panels`). Raw facts, no
   * policy: what of the region counts as covered — only beside a `shown`
   * band, only with the input method saying shown, only rects that fit the
   * band's screen, never the band itself — is
   * `ui-tree/keyboard-cover.ts#panelsBeyond`'s, and its one caller, a
   * reading there (`readKeyboard`), asks this only after `state()` read
   * `shown`, and only for a question about area (the region alone was measured
   * non-empty while hidden and stale after a rotation, so it is never
   * evidence on its own). A method of its own, not part of `state()`, for
   * the reason `witness` gives: one call that sometimes runs two commands
   * would hide the cost. Never throws: a failed call is
   * `{ witness: 'unknown', region: undefined }`.
   */
  touchable(): Promise<KeyboardTouchable>;
}

/**
 * What `KeyboardOracle.touchable()` read: the input method's own "shown"
 * (the same fact as `witness()`, from the same call as the region, so the
 * two are of one moment) and the keyboard window's touchable region as
 * rects in screen units — `undefined` when the call failed, printed no
 * region, or printed one the adapter could not read whole.
 */
export interface KeyboardTouchable {
  witness: KeyboardWitness;
  region: readonly Rect[] | undefined;
}

/**
 * Android-only intent parameters for `am start` — how a flow exercises entry
 * points other than the launcher (share sheet, custom actions). String extras
 * only: they cover the share/deep-entry cases; typed extras can come later.
 */
export interface LaunchIntent {
  action?: string; // e.g. android.intent.action.SEND
  data?: string; // intent data URI
  mimeType?: string;
  categories?: string[];
  extras?: Record<string, string>; // --es key value
}

export interface LaunchOptions {
  clearState?: boolean;
  /**
   * Android-only: exact activity to start (`.MainActivity`, fully-qualified,
   * or full `pkg/Activity` component). Without it launch falls back to
   * `monkey -c LAUNCHER`, which picks ARBITRARILY among a package's launcher
   * activities — debug builds bundling LeakCanary have two, so monkey may
   * open LeakCanary instead of the app. iOS rejects it (single entry point).
   */
  activity?: string;
  /**
   * Android-only, see LaunchIntent. With `activity` it is sent to that
   * component; without, it is scoped to the app's package (`am start -p`)
   * and Android resolves the activity — a launch nothing in the package
   * handles throws. iOS rejects it — use openDeepLink.
   */
  intent?: LaunchIntent;
}

/**
 * What a launch has to say beyond "launched". `note` is a
 * caveat the caller shows as a `⚠` line — the launch_app reply's second line
 * (mcp/tool-text.ts#launchText), a flow's `⚠ launch` trace line — and is set
 * today by one rule: iOS's foreground wait, when the tree was not seen to be
 * the launched app's within its bound (adapters/ios-foreground.ts). A launch
 * never FAILS for that: the app was launched, the caveat is about the next read.
 */
export interface LaunchOutcome {
  note?: string;
}

export interface DeviceAdapter {
  readonly platform: Platform;
  /**
   * Which backend `uiTree()` actually reads with, when the adapter has one
   * and the distinction exists — the iOS adapter reports its tree source's
   * kind (idb or wda; always one — discovery.ts); Android has one tree and
   * says nothing. The adapter is the source of truth here, not averi.yaml:
   * a layer above that re-derived the kind from the config would agree
   * with the registry only as long as nobody paired a FlowEngine with an
   * adapter built elsewhere.
   * Diagnostic only — nothing above dispatches on it. Required, not
   * optional, so an implementation or a wrapper that forgets it fails to
   * compile instead of silently losing the hint; `undefined` is the
   * declared answer for "none".
   */
  readonly treeSourceKind: IosTreeSourceKind | undefined;

  /** Reinstall triggers the app's login requirement — intentional. */
  install(appPath: string): Promise<void>;
  /**
   * Returns when the platform has started the app — on iOS (the idb source)
   * not before the tree is the launched app's, or a bounded wait says it was
   * not (LaunchOutcome.note; adapters/ios-foreground.ts). Android returns at
   * once: the stale-tree window after a switch is unmeasured there.
   */
  launch(bundleId: string, opts?: LaunchOptions): Promise<LaunchOutcome>;
  terminate(bundleId: string): Promise<void>;
  /**
   * Throws when the platform says nothing was opened — on Android an
   * `am start` refusal (no app's intent filter matches the url, or the
   * activity refused it; android-start.ts).
   */
  openDeepLink(url: string): Promise<void>;

  /**
   * PNG bytes. Throws rather than returning anything else: a capture command
   * that exits 0 with no bytes, or with text (`Killed` on a dying emulator), is
   * a transport error naming the device and command — screenshot-bytes.ts.
   * verify/capture.ts relies on it (an empty buffer equals
   * an empty buffer, which its stability wait would read as settled).
   */
  screenshot(): Promise<Buffer>;
  /**
   * `settle`: a one-shot caller (an MCP tool, not a poller) may ask for one
   * bounded retry when the device answers "no window yet" right after a launch.
   * Pollers leave it off — their interval already is the retry.
   */
  uiTree(opts?: { settle?: boolean }): Promise<UiNode>;

  /**
   * Visible screen size in the SAME units as uiTree rects (Android: pixels,
   * iOS: points) — the reference frame for viewport-visibility checks, and the
   * only measurement of the screen that does not come from the tree, which is
   * what the png scale is derived from (verify/scale.ts). Those units are
   * load-bearing: verify/ divides png pixels by this width, so a platform that
   * started reporting the other unit would move every crop.
   *
   * MEMOIZED per adapter — a SUCCESSFUL read; the panel rarely changes
   * under a session — and that is part of the contract, not a detail: the
   * layers above read it freely (per captured frame, per absent check)
   * instead of caching it themselves (the Verifier and the FlowEngine keep
   * no memo of their own). An adapter that re-read the device on every call
   * would make every pixel assert poll pay a shell-out.
   *
   * Two exceptions. A FAILED read is not kept: one transient `idb describe`
   * or `wm size` failure must not take the witness away for the life of the
   * server; the next call asks again (concurrent callers still share one
   * read in flight).
   * And `{ fresh: true }` reads the device again and replaces the memo: the
   * screen DOES change under a session — a fold or unfold, `wm size` — and
   * the window-width check (verify/capture.ts#ScreenWitness.judge) re-reads once
   * before refusing a window as wider than the screen, instead of refusing
   * until the server restarts.
   */
  viewport(opts?: { fresh?: boolean }): Promise<DeviceScreen>;

  tap(x: number, y: number): Promise<void>;
  longPress(x: number, y: number, durationMs?: number): Promise<void>;
  swipe(from: Point, to: Point, durationMs?: number): Promise<void>;
  /**
   * Type `text` into whatever is focused. An EMPTY string types nothing and
   * does not fail: it is what a `fill` with `value: ""` hands over (a clear
   * alone, or a focus without typing — interact/fill.ts skips the read-back
   * for it), and the `type` step and the type_text tool pass their text
   * through unexamined. Both adapters return before any device command:
   * iOS before calling idb, which refuses `ui text ''` (else the step
   * throws idb's bare error after the focus tap, and after the clear);
   * Android before its per-character loop, whose composing-commit nudge (two
   * DPAD key events and a sleep) would otherwise go out for nothing.
   * docs/bugs/2026-10-07-ios-fill-empty-value-fails-in-idb.md
   */
  typeText(text: string): Promise<void>;
  /**
   * Clear up to `count` characters on EACH side of the cursor in the focused
   * field (backspaces then forward-deletes). Position-independent: a tap may
   * leave the cursor anywhere in the text, and neither platform offers a
   * reliable move-to-end (measured: iOS taps land the cursor at
   * the glyph, Android MOVE_END left one char behind on the amount field).
   */
  clearText(count: number): Promise<void>;
  pressKey(key: Key): Promise<void>;
  /**
   * The soft-keyboard oracle (see `KeyboardOracle`) — present on a platform
   * whose keyboard is a separate window that `back` hides (Android), absent
   * where it is part of the tree (iOS). Absent means: no device is queried,
   * the tap guard reads the keyboard from the tree that resolved the target
   * (`KEYBOARD_ROLE`; a covered point is hidden first by a configured
   * dismissal tap or refused, nothing is pressed), and the post-fill
   * dismissal taps a configured element when the tree shows a band, else
   * nothing (never a blind `enter`, which submitted).
   */
  readonly keyboard?: KeyboardOracle;
  /**
   * The in-tree model's sentence: why THIS adapter cannot
   * hide a soft keyboard that covers a target, and what was measured to work
   * instead — phrased for the adapter's configuration, which may change what
   * works (`IosAdapter` says it per tree source: under WDA the guard taps the
   * configured `app.ios.keyboardDismiss`, under idb no guard acts and the
   * user taps it). Set only by an adapter WITHOUT the oracle,
   * quoted verbatim — in parentheses, after "this adapter cannot hide it on
   * its own" (`ui-tree/soft-keyboard.ts#cannotHide`, the one phrase: the
   * advice is what DOES work) — by the refusals in interact/keyboard-in-tree.ts,
   * interact/tap-judgement.ts, interact/scroll-text.ts and
   * verify/pixel-poll.ts, which own the generic halves of their sentences
   * and no platform fact. The adapter owns it because its facts are the
   * platform's — which key submits, which endpoint fails, which config key
   * names the measured dismissal — and the layers above are
   * platform-agnostic (ARCHITECTURE.md §2). Absent, the refusal says only
   * that the adapter cannot hide it on its own.
   */
  readonly keyboardAdvice?: string;
  /**
   * How fast a finger may move — in screens per second, the screen's LONG
   * side — for a stroke to DRAG this platform's scroll views about its own
   * length rather than fling them on. `scroll_until` sizes
   * each stroke's duration from it (interact/swipe.ts#dragMs); absent, the
   * adapter's own default duration is used, as before. A platform fact, so
   * the adapter's: the fling is the platform's scroll physics, and the
   * scroll is platform-agnostic. Set by Android only — the reasons for iOS
   * are on `IosAdapter`'s absence of it (adapters/ios.ts#swipe).
   * docs/bugs/2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md
   */
  readonly dragSpeed?: number;

  /** logcat / os_log excerpt for crash detection. */
  logs(sinceMs: number): Promise<string[]>;

  /** Is the app process currently running? Used for appAlive crash detection. */
  isAppRunning(appId: string): Promise<boolean>;

  /**
   * Release device-bound resources the adapter lazily started (today: the
   * WdaServer behind the iOS wda tree source). Optional and idempotent. Two callers: the registry when it
   * evicts an adapter (a rebind must not leak a server driving the old
   * device), and the process shutdown, which AWAITS it — so a returned promise
   * must resolve when the resource is actually released, not when the release
   * was queued. It may reject; both callers swallow the rejection, since the
   * adapter is gone either way.
   */
  dispose?(): void | Promise<void>;
}
