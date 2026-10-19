import { clips, isScrollViewOf, scrollAxis, scrolls } from './scroll-containers.js';
import { everyNode, rectArea, rectIntersection, rectsOverlap, sameRect, sameRectWithinPixel, usableSize, zeroRect, type ClippedSide as Edge, type DeviceScreen, type Point, type Rect, type ScrollAxis, type UiNode } from '../adapters/types.js';

/**
 * Geometry questions asked of a normalized UI tree, independent of what the
 * answers are used for. Both parity comparators (rect and color) need the same
 * two: how wide is the screen, and where is each identified element.
 *
 * These live here rather than in verify/ because they walk a `UiNode` and know
 * nothing about contracts, tolerances or findings. The viewport predicates
 * (intersectsViewport, absentFromViewport, visibleFractionInViewport,
 * clippedEdges) are here too, at the end of the file: they are rect
 * arithmetic, not selection. tapPoint stays in selectors.ts on purpose: it
 * is the tap-target rule (where a resolved node is pressed), and its
 * importers include the interact/keyboard*.ts modules. The point-in-rect
 * test (`containsPoint`) is here too, one spelling for every caller. What is
 * drawn over what — a walk of the tree read as paint order, not rect
 * arithmetic — is ui-tree/draw-order.ts's, which asks these predicates.
 */

interface ScreenWidth {
  width: number;
  /**
   * True when the numbers describe the WINDOW rather than some subset of it —
   * either because a node was trusted to BE the window, or because the widest
   * on-layout rect starts at the origin. False means that rect starts inset:
   * the tree was filtered and the width is a CONTENT width, which silently
   * scales every delta.
   *
   * Note what `true` does NOT promise. A window found in the tree is the best
   * candidate the tree offered, not a measurement of the screen — only
   * `DeviceAdapter.viewport()` is that. Callers that can have both should
   * compare them (verify/scale.ts) rather than read this as certainty.
   *
   * Deciding what a `false` COSTS is not this file's business: verify/scale.ts
   * is the one reader that turns it into a refusal, for the png scale and
   * the rect denominator alike. `inferScreenWidth`, the width-only view the
   * rect table and the `rect` assert read directly — and so kept `false` as a
   * remark — is gone for that reason.
   */
  reliable: boolean;
}

export interface ScreenSize extends ScreenWidth {
  /**
   * Set when the numbers are a WINDOW rect's own sides — the root's (`root`:
   * the window by construction) or a screen-shaped child of a rectless root
   * (`child`: a guessed window, which may be an oversized node crowned as
   * one) — reliable or not; absent when the walk answered, whose height is
   * a content maximum. Read by ui-tree/usable-screen.ts#usableScreenOf: only a
   * window's own sides may suggest that the screen is turned, never a walked
   * extent.
   */
  windowLeg?: 'root' | 'child';
  /**
   * CONTENT height unless `trustworthyHeight` says otherwise: the fallback
   * walk reports the lowest bottom edge in the tree, which a scroll view's
   * off-screen content inflates without limit.
   */
  height: number;
  /**
   * True when `height` is the window's own, not a walked maximum — i.e. it
   * came from a window rect. Callers that divide by the height (the png-scale
   * cross-check) must not run without it.
   */
  trustworthyHeight: boolean;
  /**
   * Set only when no window rect was found (the walk answered): a node in
   * the WINDOW's position — the root when it has a rect, else the widest
   * screen-shaped child of a rectless root — that is screen-shaped but does
   * NOT start at the origin. The measured shape: an Android app window laid
   * out beside a side navigation bar or a display cutout in landscape starts
   * at x ≈ the bar's width, and uiautomator's root IS that window. Whether
   * such a rect may be trusted as the window is not this file's call — the
   * tree cannot tell it from a filtered tree's inset content, so `reliable`
   * stays false; verify/scale.ts decides it, with the device screen as the
   * witness.
   */
  insetWindow?: Rect;
}

/**
 * How far a rect's origin may sit from 0 and still count as anchored there.
 * Shared by the window test and the walk filter so "at the origin" and "not
 * off-screen" cannot drift apart; every parser rounds rects to whole units, so
 * this is about intent, not tolerance.
 */
const ORIGIN_SLACK = 1.0;

/**
 * How far past a candidate window the layout INSIDE it may reach before the
 * two readings are called irreconcilable.
 *
 * Content peeking off the right edge is ordinary — a paged carousel's next
 * card, a row mid-swipe — and runs to a few percent of the width. A node that
 * doubles the candidate is a different claim about what the screen is, and the
 * tree cannot say which claim is right: that is the file's own thesis. So this
 * separates "peeking" from "contradiction", and a contradiction is reported as
 * unreliable rather than resolved by guessing.
 */
const MAX_OVERHANG = 1.1;

/**
 * The flattest a candidate may be and still be a screen. Phones in landscape
 * reach about 2.2:1; a status bar is 13:1. Anything past 3:1 is a BAR, and a
 * bar crowned as the window scales a capture by ~30x down (measured shape: a
 * non-edge-to-edge uiautomator dump whose app window starts below the status
 * bar, leaving the bar as the only origin-anchored child).
 */
const MAX_SCREEN_ASPECT = 3;

/**
 * Screen size from the tree.
 *
 * The WINDOW rect wins when the tree offers one, because it is the only node
 * guaranteed to be the screen: WDA's `Application` and uiautomator's hierarchy
 * root both report exactly that. The widest-rect walk is the FALLBACK.
 *
 * Preferring the window is not a tidy-up. iOS keeps off-viewport nodes in the
 * tree with negative or oversized rects, so with a modal sheet presented the
 * widest rect can be an off-screen sibling at x=screenWidth — which doubles
 * the inferred width, halves every png scale derived from it, and crops the
 * wrong band of the screenshot.
 * docs/bugs/2026-08-26-ios-ocr-crop-scale.md
 *
 * Callers that can read the screen size from the DEVICE should prefer that and
 * use this only as a cross-check: no tree rule can tell an oversized node from
 * a window it has never been told the size of (verify/scale.ts).
 */
export function inferScreenSize(tree: UiNode): ScreenSize {
  const window = windowRect(tree);
  if (window !== undefined) {
    // Only a GUESSED window faces the contradiction test. A root rect is the
    // window by construction — asking whether its own layout overflows it
    // refuses ordinary screens, because horizontally scrollable content
    // straddles the edge (a carousel's next card, a list cell mid-swipe) and
    // iOS reports its full frame: every root-bearing tree with a straddling
    // child would fail closed.
    const settled = window.leg === 'root' || !overhangs(tree, window.rect);
    return {
      width: window.rect.width,
      height: window.rect.height,
      reliable: settled,
      trustworthyHeight: settled,
      windowLeg: window.leg,
    };
  }
  const walked = walkExtent(tree);
  const inset = insetWindowRect(tree);
  return {
    width: walked.width,
    height: walked.height,
    reliable: walked.reliable,
    trustworthyHeight: false,
    ...(inset !== undefined && { insetWindow: inset }),
  };
}

interface Extent {
  width: number;
  height: number;
  /**
   * False when the width cannot be believed: the widest ON-LAYOUT rect starts
   * inset (a CONTENT width), or a screen-shaped rect in the same tree reaches
   * materially less far than a bar-shaped one does (see walkExtent).
   */
  reliable: boolean;
}

/**
 * How far the on-layout content reaches, right and down.
 *
 * Rects starting off-screen are hit-test scrims, not layout: the live WDA
 * sheet dump carries two PopoverDismissRegion nodes at {-402,-874} sized
 * 1206x2622 — a PIXEL-scale rect inside a point-scale tree, whose extent read
 * as an 804pt screen and failed every png scale closed. The rule
 * is geometric rather than by node type because the normalized tree keeps no
 * type: WDA's PopoverDismissRegion arrives here as role `other`.
 * docs/bugs/2026-08-26-png-scale-needs-out-of-tree-screen-size.md
 *
 * The root gets no exemption — a root that is itself off-screen is no more a
 * screen than a scrim is.
 */
function walkExtent(tree: UiNode): Extent {
  let widest: Rect = zeroRect();
  let tallest: Rect = widest;
  /** The widest extent reached by anything SHAPED like a screen, if anything is. */
  let screenShaped = 0;
  let sawScreenShaped = false;
  const walk = (n: UiNode): void => {
    if (onLayout(n.rect)) {
      if (n.rect.x + n.rect.width > widest.x + widest.width) widest = n.rect;
      if (n.rect.y + n.rect.height > tallest.y + tallest.height) tallest = n.rect;
      if (isScreenShaped(n.rect) && n.rect.width > 0) {
        sawScreenShaped = true;
        screenShaped = Math.max(screenShaped, n.rect.x + n.rect.width);
      }
    }
    n.children.forEach(walk);
  };
  walk(tree);
  const width = widest.x + widest.width;
  // The shape gate above keeps a BAR from being crowned as a window — but a
  // bar that is never a candidate still lands here, and this path grants
  // `reliable` to any origin-anchored maximum with no cross-check. Measured:
  // pixel-scale junk {0,0,804,150} in a point tree read as an 804pt screen at scale 1.5, in
  // silence. So a screen-shaped rect must corroborate the maximum when the
  // tree has one at all — a real status bar is corroborated by the window
  // below it, junk is not. A tree with nothing screen-shaped in it (a filtered
  // list of rows) keeps the old, weaker answer rather than losing the width.
  const corroborated = !sawScreenShaped || screenShaped * MAX_OVERHANG >= width;
  return {
    width,
    height: tallest.y + tallest.height,
    reliable: Math.abs(widest.x) < ORIGIN_SLACK && corroborated,
  };
}

const onLayout = (rect: Rect): boolean => rect.x > -ORIGIN_SLACK && rect.y > -ORIGIN_SLACK;

/** Origin-anchored with a real size — the shape a window rect has. */
const isWindow = (rect: Rect): boolean =>
  rect.width > 0 && rect.height > 0 && Math.abs(rect.x) < ORIGIN_SLACK && Math.abs(rect.y) < ORIGIN_SLACK;

/** …and shaped like a screen rather than like a bar (see MAX_SCREEN_ASPECT). */
const isScreenShaped = (rect: Rect): boolean =>
  Math.max(rect.width, rect.height) <= Math.min(rect.width, rect.height) * MAX_SCREEN_ASPECT;

/**
 * Does anything on-layout that STARTS INSIDE the window reach materially past
 * its right edge? Nodes beginning at or past that edge are excluded on
 * purpose: an off-viewport sibling parked at x=screenWidth is the inflator
 * `inferScreenSize`'s doc measures, and counting it would refuse the very screens this
 * promotion exists to read.
 */
function overhangs(tree: UiNode, window: Rect): boolean {
  const limit = window.width * MAX_OVERHANG;
  let found = false;
  const walk = (n: UiNode): void => {
    if (found) return;
    if (onLayout(n.rect) && n.rect.x < window.width && n.rect.x + n.rect.width > limit) {
      found = true;
      return;
    }
    n.children.forEach(walk);
  };
  walk(tree);
  return found;
}

/**
 * The window rect, or undefined when no node is even a candidate.
 *
 * The root is it when the root has one. When the root has NO usable rect the
 * window is one level down: idb's flat `describe-all` and uiautomator's
 * multi-root dump are normalized under a synthetic 0x0 root (adapters/ios-tree-source.ts,
 * adapters/android.ts), and WDA's live /source roots a sheet tree in a node
 * carrying no `rect` at all, which the parser zero-fills — in all three the
 * real window sits among the children (measured: the iOS filter
 * sheet's `Application "Skeleton Internal"` at {0,0,402,874}).
 *
 * A child must be SCREEN-SHAPED to qualify, which is what keeps a status bar
 * and a tall scroll container out of the running. Among what is left the
 * WIDEST wins, ties break on height: a too-large candidate stays visible to
 * the axis check in verify/scale.ts, which fails closed on it, where silently
 * preferring a narrower sibling would scale by a content width. The root skips
 * the shape test — it is the window by construction — and the caller skips the
 * contradiction test for it too, which is why the leg is reported.
 */
function windowRect(tree: UiNode): { rect: Rect; leg: 'root' | 'child' } | undefined {
  if (isWindow(tree.rect)) return { rect: tree.rect, leg: 'root' };
  if (tree.rect.width > 0 && tree.rect.height > 0) return undefined;
  const candidates = tree.children.map((c) => c.rect).filter((r) => isWindow(r) && isScreenShaped(r));
  if (candidates.length === 0) return undefined;
  const best = candidates.reduce((champion, r) =>
    r.width > champion.width || (r.width === champion.width && r.height > champion.height) ? r : champion,
  );
  return { rect: best, leg: 'child' };
}

/**
 * The rect in the window's position that starts inset — see
 * `ScreenSize.insetWindow`. Only called when `windowRect` found nothing, so
 * no candidate here is origin-anchored. The root leg is the window by
 * construction (uiautomator's single root is the app window's decor); a
 * child of a rectless root (a multi-window dump, or idb's flat list) faces
 * the same contradiction test a guessed window does: content starting
 * inside it that reaches materially past its right edge rules it out.
 */
function insetWindowRect(tree: UiNode): Rect | undefined {
  const shaped = (r: Rect): boolean => r.width > 0 && r.height > 0 && onLayout(r) && isScreenShaped(r);
  if (tree.rect.width > 0 && tree.rect.height > 0) return shaped(tree.rect) ? tree.rect : undefined;
  const candidates = tree.children.map((c) => c.rect).filter(shaped);
  if (candidates.length === 0) return undefined;
  const best = candidates.reduce((champion, r) =>
    r.width > champion.width || (r.width === champion.width && r.height > champion.height) ? r : champion,
  );
  const right = best.x + best.width;
  let contradicted = false;
  const walk = (n: UiNode): void => {
    if (contradicted) return;
    if (onLayout(n.rect) && n.rect.x < right && n.rect.x + n.rect.width > best.x + best.width * MAX_OVERHANG) {
      contradicted = true;
      return;
    }
    n.children.forEach(walk);
  };
  walk(tree);
  return contradicted ? undefined : best;
}

/** {id → rect} for the FIRST occurrence of each identifier (pre-order). */
export function collectRects(tree: UiNode): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const walk = (n: UiNode): void => {
    if (n.identifier !== null && n.identifier !== '' && !out.has(n.identifier)) {
      out.set(n.identifier, n.rect);
    }
    n.children.forEach(walk);
  };
  walk(tree);
  return out;
}

// ─── Orientation ─────────────────────────────────────────────────────────────

/**
 * How far two readings of one screen side — the tree's and the device's —
 * may sit apart and still be the same side. Whole-point rects and a rounded
 * screen size move it by well under a percent; 2% is comfortably above that
 * and well below the signatures that matter (a system-bar inset, a
 * half-width split view). verify/scale.ts reads it for when a tree width's
 * mismatch with the device is worth saying out loud; `FIT_SLACK` below is
 * the same allowance for a window's reach. Here beside `windowTurnsScreen`,
 * which reads it.
 */
export const SCREEN_AGREEMENT_PCT = 2;

/**
 * How far a window may reach past a screen side and still be said to fit it.
 * Every parser rounds rects to whole units and `wm size` / `idb describe`
 * report the panel exactly, so this is slack for rounding, not a tolerance
 * for a different screen. The same allowance as `SCREEN_AGREEMENT_PCT`.
 */
const FIT_SLACK = 1 + SCREEN_AGREEMENT_PCT / 100;

/**
 * Is the screen turned sideways from how the device reports it, by the tree's
 * window? `wm size` and `idb describe` report the panel as built — portrait
 * on a phone — whichever way it is held; the tree's window is laid out as the
 * screen is now. The one owner of "which way does this window say the screen
 * faces", for ui-tree/usable-screen.ts#usableScreenOf (the box a gesture swipes
 * in and every judgement's usable screen). Here rather than in
 * verify/scale.ts: `interact/` may not import `verify/` (ARCHITECTURE.md
 * §2), and the question is rect arithmetic over a tree's size and the
 * device's.
 *
 * The witness is the window's REACH — its right and bottom edges, so a window
 * laid out beside a left-hand nav bar or a cutout counts with the bar it
 * starts after — and it says "turned" only when that reach fits the panel
 * turned sideways AND does not fit it as built. "Does not fit as built" is
 * the guard: a top split-screen pane (1080x1000 on 1080x2400) is
 * landscape-SHAPED yet fits the panel unturned, and turning for it would put
 * a gesture's centre past the right edge; a square-ish window that fits
 * either says nothing.
 *
 * Which window: the tree's own when it is `reliable`, else — on a platform
 * whose windows sit beside system bars at all (`windowsBesideSystemBars`,
 * Android) — the `insetWindow` geometry.ts surfaces for the window's
 * position: the measured shapes (126,0 2274x1080 beside a left nav bar) and the non-edge-to-edge
 * one below a status bar as well (126,63 2274x1017), which
 * verify/scale.ts#besideSystemBars does not admit because it MEASURES a width and
 * needs the full short side; turning a box needs only the reach. An inset
 * rect in an iOS tree is content, never a window, and witnesses nothing.
 *
 * verify/scale.ts#windowWidth does not read this: it bounds a WIDTH by the side the
 * window's own aspect faces and accepts a split pane against either side —
 * a different question from which way the panel is held, which a split pane
 * cannot answer.
 *
 * A WALKED height never votes. It is the
 * lowest content edge, which a scroll view inflates without limit — the same
 * incident verify/scale.ts#orient records as why the tree lost its vote on a png's
 * orientation: a landscape iPhone whose scroll container made the tree read
 * "portrait". `orient` has the capture to decide by instead; a gesture has
 * no png, so the tree is its only witness, and only its trustworthy parts
 * vote: with no window's own height (`trustworthyHeight`), a reliable width
 * decides alone — turned when it is wider than the panel's side as built
 * and fits the other (an 852-wide walk over rows down to y=3000 on a
 * 393x852 panel is a landscape screen, 852x393). Residual: an onLayout
 * sibling parked one screen to the right of a portrait window inflates a
 * walked width the same way (the measured inflator, which `walkExtent`'s
 * corroboration catches only when something screen-shaped is in the tree)
 * and turns the box — the tree cannot tell that width from a landscape one,
 * as verify/scale.ts#windowWidth's walked-width note says.
 *
 * Accepted cost: a rectless root whose only
 * screen-shaped child is wider than the panel as built but fits it turned —
 * an oversized node crowned as the window, the sheet class geometry.ts
 * describes — turns the box. A gesture over a turned box on an unturned
 * screen lands off-centre, not off-screen in the short axis; the tree
 * offers nothing to tell the two apart. That cost is a SWIPE's only: a tap
 * refusal (ui-tree/standing.ts#Scene, the tap's standing) does not take this answer alone —
 * ui-tree/usable-screen.ts#UsableScreen says which boxes count (`boxes`), and a
 * child window that matches the panel neither way — this crowned node —
 * is no evidence there: the judgement uses the panel as built. A window
 * whose own sides say the panel is turned, or a turn on a walked width,
 * counts the box either way up (ui-tree/usable-screen.ts#UsableScreen owns which).
 */
export function windowTurnsScreen(size: ScreenSize, screen: DeviceScreen): boolean {
  if (!usableSize(screen)) return false;
  // Only the tree's trustworthy parts vote. A walked height is a content
  // maximum (scale.ts#orient lost the tree's vote to exactly that), so a
  // reliable tree without a window's own height is judged by its WIDTH:
  // wider than the panel as built, within it turned (the split-pane guard is
  // the first half).
  if (size.reliable && usableSize(size) && !size.trustworthyHeight) {
    return size.width > screen.width * FIT_SLACK && size.width <= screen.height * FIT_SLACK;
  }
  const window: Rect | undefined =
    size.reliable && usableSize(size)
      ? { x: 0, y: 0, width: size.width, height: size.height }
      : screen.windowsBesideSystemBars === true
        ? size.insetWindow
        : undefined;
  if (window === undefined) return false;
  const reach = { width: window.x + window.width, height: window.y + window.height };
  const fits = (s: { width: number; height: number }): boolean =>
    reach.width <= s.width * FIT_SLACK && reach.height <= s.height * FIT_SLACK;
  return fits({ width: screen.height, height: screen.width }) && !fits(screen);
}

// ─── Viewport predicates ─────────────────────────────────────────────────────

/**
 * Does the node's rect visibly intersect the screen? The shared meaning of
 * "gone": Android prunes off-screen nodes from its tree, iOS keeps them with
 * off-viewport rects — this check makes both read the same.
 */
export function intersectsViewport(
  rect: Rect,
  viewport: { width: number; height: number },
): boolean {
  const w = Math.min(rect.x + rect.width, viewport.width) - Math.max(rect.x, 0);
  const h = Math.min(rect.y + rect.height, viewport.height) - Math.max(rect.y, 0);
  return w > 0 && h > 0;
}

/**
 * The one portable meaning of "absent": no node matched, or none of the
 * matches intersects the viewport. The raw trees disagree — Android prunes
 * off-screen nodes, iOS keeps them with off-viewport rects — and a state
 * detect (`absent: true`) and an absent assert must read the same tree the
 * same way, or a state the flow says it reached could fail the assert that
 * checks it. The one owner, for the engine and verify/assert.ts: the two
 * layers cannot share it anywhere higher (verify sits below the interaction
 * module).
 */
export function absentFromViewport(
  found: readonly UiNode[],
  viewport: { width: number; height: number },
): boolean {
  return !found.some((n) => intersectsViewport(n.rect, viewport));
}

/**
 * How much of the rect actually lies inside the viewport, as a fraction of its
 * own area (0 = fully outside, 1 = fully inside).
 *
 * The companion to `intersectsViewport`, which answers only "any overlap at
 * all". That predicate is the right stop condition for a scroll, but it is the
 * WRONG thing to report: measured, a row clipped by the floating
 * bottom-nav bar intersected by 87% of its height, `scroll_until` reported a
 * bare "visible", and the next assert measured the CLIPPED rect — reading
 * h 143 against a pinned 60 and pointing the investigation at the app's
 * row-height logic, which was correct. A caller who is told the fraction can
 * see the clipping; a caller told "visible" cannot.
 *
 * The viewport is anchored at the origin unless it says otherwise (`x`,
 * `y`: a box that starts lower — iOS's screen below its status band,
 * belowStatusBand, below).
 */
export function visibleFractionInViewport(
  rect: Rect,
  viewport: { x?: number; y?: number; width: number; height: number },
): number {
  if (rectArea(rect) === 0) return 0;
  const { x = 0, y = 0 } = viewport;
  const w = Math.min(rect.x + rect.width, x + viewport.width) - Math.max(rect.x, x);
  const h = Math.min(rect.y + rect.height, y + viewport.height) - Math.max(rect.y, y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / rectArea(rect);
}

/**
 * `rectArea`, `rectsOverlap`, `rectIntersection`, `sameRect` and
 * `sameRectWithinPixel` live beside `Rect` in adapters/types.ts — the idb
 * tree source and the WDA parser (its keyboard band test,
 * wda-source.ts#isTextEcho) need them and may not import this layer — and
 * are re-exported here, where the rect arithmetic's callers look for them.
 */
export { rectArea, rectIntersection, rectsOverlap, sameRect, sameRectWithinPixel };

/**
 * Is the point inside the rect — left and top inclusive, right and bottom
 * exclusive, like the Android frame test. The point-in-rect companion of
 * `rectsOverlap` (two rects sharing area: a different question), and the
 * ONE spelling of it: the tap guard asks it of the keyboard's frame and the
 * tap point (ui-tree/keyboard-cover.ts#readKeyboard, its `over` and `frameOver`), the dismissal picker of the
 * root's rect, and ui-tree/draw-order.ts of every candidate.
 */
export function containsPoint(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

/**
 * Does `inner` lie wholly inside `outer` — edges included. The rect-in-rect
 * companion of `containsPoint`; draw-order.ts#drawnOverAt asks it so that a
 * wrapper whose rect holds the whole stroke container is not named as what
 * the stroke touched down on.
 */
export function rectWithin(inner: Rect, outer: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/**
 * `from` less `cut`: the pieces of `from` outside `cut`, at most four and
 * disjoint — the band above the cut and the band below it, full width, and
 * the parts left and right of it between them. `from` whole when they share
 * no area. ui-tree/draw-order.ts#exposure cuts a target by its covers with
 * it; here as rect arithmetic, beside `rectIntersection`, which it is built
 * on.
 */
export function subtract(from: Rect, cut: Rect): Rect[] {
  const shared = rectIntersection(from, cut);
  if (shared === undefined) return [from];
  const right = from.x + from.width;
  const bottom = from.y + from.height;
  const sharedRight = shared.x + shared.width;
  const sharedBottom = shared.y + shared.height;
  const pieces: Rect[] = [
    { x: from.x, y: from.y, width: from.width, height: shared.y - from.y },
    { x: from.x, y: sharedBottom, width: from.width, height: bottom - sharedBottom },
    { x: from.x, y: shared.y, width: shared.x - from.x, height: shared.height },
    { x: sharedRight, y: shared.y, width: right - sharedRight, height: shared.height },
  ];
  return pieces.filter((r) => rectArea(r) > 0);
}

/** The largest of `rects` by area — the first of equals; undefined for none. */
export const largestRect = (rects: readonly Rect[]): Rect | undefined =>
  rects.reduce<Rect | undefined>((best, r) => (best === undefined || rectArea(r) > rectArea(best) ? r : best), undefined);

/**
 * The centre of a rect as a tap presses it: each coordinate rounded to a
 * whole unit, as every tap is sent. selectors.ts#tapPoint is it of a node's
 * rect; draw-order.ts#exposure of the piece a moved tap aims at.
 */
export const rectCentre = (r: Rect): Point => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });

/**
 * `box` less the screen's status band (`DeviceScreen.statusBand`, carried as
 * ui-tree/usable-screen.ts#UsableScreen's) at its top when `box` is portrait — the
 * part of it a point or a rect is judged on screen in; `box` itself with no
 * band, in landscape, or with no screen. `shape` is the screen box the band
 * belongs to when `box` was cut from it (the screen above a keyboard): its
 * shape, not the cut's, says portrait.
 *
 * Portrait only is iOS's rule (an iPhone hides its status bar in
 * landscape); Android's landscape status bar is the standing's residual
 * (ui-tree/standing.ts#Scene). Here as rect arithmetic, below interact/,
 * so ui-tree/standing.ts reads it for every verb.
 */
export function belowStatusBand(box: Rect, screen: { statusBand?: number } | undefined, shape: { width: number; height: number } = box): Rect {
  const band = screen?.statusBand ?? 0;
  if (band <= 0 || shape.height <= shape.width) return box;
  const top = Math.max(box.y, band);
  return { ...box, y: top, height: Math.max(0, box.y + box.height - top) };
}

/**
 * `box` less the screen's navigation band (`DeviceScreen.navigationBand`,
 * the band's TOP line, carried as ui-tree/usable-screen.ts#UsableScreen's) at its
 * bottom when `box` is portrait — `belowStatusBand`'s twin at the other
 * edge, `shape` as there. Portrait only: Android moves the bar to a side
 * in landscape, and the band, read while the screen was upright, may
 * outlive a rotation in the adapter's memo (the residual is the standing's).
 * A reading that leaves nothing above it — its top at or above the box's
 * — is no band (fails open): `box` itself.
 */
export function aboveNavigationBand(box: Rect, screen: { navigationBand?: number } | undefined, shape: { width: number; height: number } = box): Rect {
  const top = screen?.navigationBand;
  if (top === undefined || top <= box.y || shape.height <= shape.width) return box;
  return { ...box, height: Math.max(0, Math.min(box.y + box.height, top) - box.y) };
}

/**
 * How thick, in tree units (points on iOS, pixels on Android), an overlap
 * may be on its thin side and still say nothing about a pixel assert's
 * element: tree frames are whole units, so a neighbour laid flush can
 * share an edge's antialiasing and no more (the measured shapes are the
 * ADR's).
 * docs/adr/0002-pixel-overlap-slack.md
 */
export const PIXEL_OVERLAP_SLACK = 2;

/** `a` and `b` share area thicker than PIXEL_OVERLAP_SLACK on its thin side — what a pixel assert counts as one hiding the other (ui-tree/draw-order.ts#paintsOver, and the system bands, ui-tree/standing.ts#Scene). */
export const overlapsPastSlack = (a: Rect, b: Rect): boolean => {
  const shared = rectIntersection(a, b);
  return shared !== undefined && Math.min(shared.width, shared.height) > PIXEL_OVERLAP_SLACK;
};

/**
 * A rect's side: one a rect extends past (`clippedEdges`), or lies flush with
 * (`flushEdges`) — adapters/types.ts#ClippedSide, the side a node dumped
 * inverted lies past, re-exported under the name ui-tree asks it by. One
 * definition, the adapter's: adapters/ may not import ui-tree.
 */
export type { Edge };

/**
 * Which viewport edges the rect extends past, in the order a reader scans.
 * Named rather than counted because the edge IS the diagnosis: 'bottom' with
 * the content exhausted is a missing-clearance bug, 'top' is a sticky header
 * overlapping, and the two want different fixes. The viewport is anchored
 * as `visibleFractionInViewport`'s.
 */
export function clippedEdges(
  rect: Rect,
  viewport: { x?: number; y?: number; width: number; height: number },
): Edge[] {
  const { x = 0, y = 0 } = viewport;
  const out: Edge[] = [];
  if (rect.y < y) out.push('top');
  if (rect.y + rect.height > y + viewport.height) out.push('bottom');
  if (rect.x < x) out.push('left');
  if (rect.x + rect.width > x + viewport.width) out.push('right');
  return out;
}

/**
 * What a tree's CLIPPING says of its nodes (`clipsOf`), from one walk: each
 * node's clipping chain (`scrollersOf`) and its sliver cut (`cutSliver`).
 * Asked of nodes of THIS tree (a node of another read has no clipping
 * ancestor here: an empty chain, no cut).
 */
export interface Clips {
  /**
   * The node's ancestors that CLIP it — every node marked
   * `clipsDescendants` above it (adapters/types.ts#UiNode.clipsDescendants:
   * Android's `scrollable="true"`, whose descendants' bounds uiautomator has
   * already cut to it), NEAREST FIRST, as their rects; empty for a node with
   * none, which is every node of an iOS tree. `scroll_until`'s
   * round asks it of each match (interact/scroll-read.ts#TreeFacts), to
   * tell a `fully: true` stop whose edge sits exactly on a clipping
   * ancestor's — possibly cut there — from one inside them all
   * (interact/scroll-rounds.ts#PROBE_REACH), and to pick the box its strokes
   * are drawn in. The whole chain, not the nearest alone: a card that fills a horizontal carousel's
   * height is flush with BOTH of the carousel's edges — one probe cannot
   * tell — while the carousel itself is cut by the vertical list around it,
   * and the card's rect with it; the cut is on the outer edge, and the outer
   * list is the one to stroke. The array is shared along a branch.
   */
  scrollersOf(node: UiNode): readonly Rect[];
  /**
   * `evidentCut` when what shows of the node across that edge is under
   * `minPiece` (draw-order.ts#MIN_TAP_PIECE_FRACTION, `Exposure.minPiece`)
   * — a sliver a tap is refused on and `scroll_until`'s plain stop does
   * not stop on; undefined otherwise. Asked only by
   * ui-tree/standing.ts#Scene.standing, which orders it against the rest,
   * and asks the rule's other evidence after it — a cut by a node drawn
   * after it (standing.ts#cutByLater, `Cut.by`), which needs the draw order.
   *
   * Or INHERITED (the owner's decision, the bug note below): a node flush within a pixel with an
   * edge whose ancestor — below the container of that edge — is itself a
   * sliver cut at that edge of that container, nearest such ancestor first
   * (past a nearer sliver cut at another edge), and the node's own depth
   * across it under the minimum too (`Cut.within`, the ancestor's rect).
   * Measured: the toggle `66,1924 948x55` is refused at the form's bottom,
   * and its leaf label "Payment details" `66,1936 948x42`, which has no
   * content of its own to evidence the cut (`evidentCut`'s "Unknowable"),
   * was tapped at (540,1957) and nothing expanded — the toggle's refusal had
   * pointed at it ("tap a child of it"). A child that lies clear of the edge
   * is not refused: it shows whole inside the strip. Nor is a node flush
   * with the edge of an ancestor cut there DEEPER than the minimum (Create
   * contact's IME-cut field `132,1307 816x91`, its label "Company" `176,1373
   * 190x25` on the cut: tapped, and it focused the field) or one that is not
   * evidently cut at all (a whole button at a form's end, its background
   * flush with it).
   *
   * Cost: each node's answer is kept, per minimum, for the life of the
   * `Clips` — derived once a round for every match (the round's scene,
   * interact/scroll-read.ts#factsOf), once a tap — so an ancestor shared by the matches is judged
   * once. An ancestor is judged at all only when the node is flush with an
   * edge it is shallower than the minimum across: a wrapper filling its
   * scroller (flush with all four edges, its subtree the whole list) is
   * deeper than any sliver, and never walked for it; its own `evidentCut`
   * walks its subtree per flush edge.
   * docs/bugs/2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md
   */
  cutSliver(node: UiNode, minPiece: number): Cut | undefined;
  /**
   * Whether the node lies inside something that scrolls — an ancestor that
   * scroll-containers.ts#scrolls — or undefined when the tree cannot say:
   * a listing without ancestry (`ancestry` false: idb's flat list), and a
   * node of another tree. Whether `scroll_until` can move the target out
   * from under a system bar (interact/tap-judgement.ts#systemBarRemedy, the
   * pixel assert's remedy). Cost: one walk of the tree, on the first ask.
   */
  inScroller(node: UiNode): boolean | undefined;
  /**
   * Where the node can be DRAWN as far as what scrolls above it says (`Drawn`): the frames of every ancestor that
   * scroll-containers.ts#scrolls, intersected — on a tree of UNCLIPPED frames only, as its source says
   * (adapters/types.ts#UiNode.unclippedFrames, WDA's; `clipsOf`'s `unclipped`). An ancestor of no area cuts nothing
   * (it fails open, as a root of no area does). There a scroll view's content keeps its laid-out rect wherever it lies, and the
   * scroll view draws none of it outside its own frame (UIKit's `UIScrollView` clips to its bounds, so do a table, a
   * collection view and SwiftUI's `ScrollView`). Measured: the at-rest SWIFT form lists `payee_name_input` at
   * `24,801 354x52`, below its `ScrollView 0,0 402x780`; the capture shows the bare background from CONTINUE's bottom
   * (824) down, and a tap at its centre was reported done on it. Undefined for a node under nothing that scrolls, a
   * node of another tree, on Android's trees (uiautomator has cut every rect to its ancestors already: nothing is
   * left to cut) and on idb's flat list, which lists no scroll view (a residual: its rows below a short scroll view
   * are judged on the screen alone). Rects stay unclipped (`scroll_until`'s far edge, interact/scroll-rounds.ts
   * #beyondFarEdge, reads a row's rect past the frame); the standing cuts what it judges by this frame
   * (ui-tree/standing.ts#Scene). Cost: one walk of the tree, on the first ask; the answer is shared along a branch.
   */
  drawnIn(node: UiNode): Drawn | undefined;
  /**
   * The axis facts of the scroll view of rect `container` — the first node in tree order that scrolls with exactly
   * that rect, as `DrawOrder.drawnOver` finds its container — for `scroll_until`'s stroke plan
   * (interact/stroke-plan.ts#strokeRoom): the axis it scrolls on, and every scroll view nested in it (its descendants
   * that scroll, at any depth; one of its own rect left out) with theirs, each as scroll-containers.ts#scrollAxis says
   * on this tree's dialect (`unclipped`), undefined where it cannot tell. Undefined when the tree holds no scroll
   * view of that rect (the list moved). Found as draw order finds its container (scroll-containers.ts#isScrollViewOf).
   * Cost: a walk of the tree to find it on each ask; its facts kept for the life of the `Clips`.
   */
  axesOf(container: Rect): ScrollAxes | undefined;
  /**
   * The scroll view of rect `scroller` (found as `axesOf` finds its scroll view: scroll-containers.ts#isScrollViewOf,
   * that exact rect — the one the stroke plan remembered and drew over, whose cut and axes the same read finds by it
   * exactly; one moved by a pixel is found by none of them, and no proof is the safe answer), when the tree shows its
   * CONTENT ENDING at its `edge`: no node under it of some area lies past that edge by more than a pixel — so nothing
   * of its content lies that way, and no stroke can bring any in. On a tree of UNCLIPPED frames only (`drawnIn`'s
   * dialect, WDA's): there a scroll view's content keeps its laid-out rect wherever it lies, so content above a list's
   * top is listed above it (the lab app's `scroll-bounded`: `lower` 0,380 402x180 at rest lists its content container
   * at 0,380 402x1300 — nothing above its top, 1120 pt below its bottom). Undefined when it does not end there, when no
   * scroll view of that rect is in this tree, and on every other tree: uiautomator cuts every rect to its scroll
   * container, so content past an edge reads flush with it (or is not listed at all), and idb's flat list lists no
   * scroll view. What a node past the edge may be — a row, a parked cell's content (ADR 0019), a pinned header — is not
   * asked: any of them says "not provably the end", the safe answer. And only for a scroll view that scrolls ALONG that
   * edge's axis (scroll-containers.ts#scrollAxis: its content listed running on past its frame on that axis —
   * `lower`'s, 1120 pt below its bottom): a horizontal carousel lists nothing below its bottom because nothing of it
   * ever lies there, which says nothing of whether a vertical stroke over it could move anything (code review of
   * arch/r22-lv4, MAJOR-1: Account Detail's carousel under its list "proved" the end after one stroke, and the failure
   * lost the list drawn over the touch-down it had named). An axis the tree cannot tell proves nothing. Residual,
   * stated as it is: a lazy list (a table) lists only the rows it has laid out, so one resting EXACTLY on a row
   * boundary with its earlier rows dropped (a sticky section header pinned at its top reads the same) lists nothing
   * past its top and reads as ending there. Nothing in the reads rules that out: interact/scroll-rounds.ts asks this
   * only of a read a stroke left unmoved, but a stroke not taken leaves it unmoved too — so a stroke not taken over a
   * lazy list resting on a boundary is a false proof (one stroke, then a turn or a failure that calls the content
   * exhausted). What makes it rare, not impossible: a list at rest lies on a boundary by chance (a flung list stops
   * anywhere along a row), and the stroke must also go untaken, with nothing drawn over its touch-down (that withholds
   * the proof). Cost: one walk of that scroll view's subtree, per ask (asked at most once a round, after a stroke).
   */
  endsAt(scroller: Rect, edge: Edge): UiNode | undefined;
}

/** A scroll view's axis and those of the scroll views nested in it (`Clips.axesOf`). */
export interface ScrollAxes {
  readonly axis: ScrollAxis | undefined;
  readonly nested: readonly NestedScrollView[];
}

/** A scroll view nested in another, as `Clips.axesOf` gives it: its rect and its axis, undefined where the tree cannot tell. */
export interface NestedScrollView {
  readonly rect: Rect;
  readonly axis: ScrollAxis | undefined;
}

/** What of `rect` the drawn frame `drawn` holds (`Clips.drawnIn`): `rect` itself when nothing cuts it; undefined when nothing of it can be drawn. */
export function drawnPart(rect: Rect, drawn: Drawn | undefined): Rect | undefined {
  if (drawn === undefined) return rect;
  return drawn.frame === undefined ? undefined : rectIntersection(rect, drawn.frame);
}

/** Where a node can be drawn, as its scrolling ancestors cut it (`Clips.drawnIn`). */
export interface Drawn {
  /** The ancestors' frames intersected; undefined when they share no area — nothing of the node can be drawn. */
  readonly frame: Rect | undefined;
  /** The ancestors that scroll, nearest first: the scroll view a sentence names is one of them. */
  readonly scrollers: readonly UiNode[];
}

/**
 * A tree's `Clips`: one pre-order walk recording each node's parent and its
 * clipping chain (shared along a branch), for nodes under a clip only;
 * the sliver cuts are judged when asked, and kept. `ancestry`: whether the
 * tree's nesting is its nodes' ancestry (draw-order.ts#listsAncestry);
 * `unclipped`: whether its source reports frames unclipped, which `drawnIn`
 * asks (draw-order.ts#listsUnclippedFrames) — the two readers of the tree's
 * dialect, both in draw order.
 */
export function clipsOf(tree: UiNode, { ancestry, unclipped = false }: { readonly ancestry: boolean; readonly unclipped?: boolean }): Clips {
  const chains = new Map<UiNode, readonly Rect[]>();
  const parents = new Map<UiNode, UiNode>();
  const walk = (n: UiNode, chain: readonly Rect[]): void => {
    if (chain.length > 0) chains.set(n, chain);
    const below = clips(n) ? [n.rect, ...chain] : chain;
    for (const child of n.children) {
      if (below.length > 0) parents.set(child, n);
      walk(child, below);
    }
  };
  walk(tree, []);
  const scrollersOf = (node: UiNode): readonly Rect[] => chains.get(node) ?? [];
  const kept = new Map<number, Map<UiNode, Cut | undefined>>();
  const cutSliver = (node: UiNode, minPiece: number): Cut | undefined => {
    const byNode = kept.get(minPiece) ?? new Map<UiNode, Cut | undefined>();
    kept.set(minPiece, byNode);
    if (byNode.has(node)) return byNode.get(node);
    const cut = judged(node, minPiece);
    byNode.set(node, cut);
    return cut;
  };
  const judged = (node: UiNode, minPiece: number): Cut | undefined => {
    const chain = scrollersOf(node);
    const own = evidentCut(node, chain);
    if (own !== undefined && own.depth < minPiece) return own;
    // The edges the node lies flush with, of each container above it, where it is itself under the minimum across.
    const flush = chain.flatMap((container) => flushEdges(node.rect, container).map((edge) => ({ container, edge }))).filter(({ edge }) => across(node.rect, edge) < minPiece);
    if (flush.length === 0) return undefined;
    for (let a = parents.get(node); a !== undefined && scrollersOf(a).length > 0; a = parents.get(a)) {
      const ancestor = a;
      // Only an ancestor shallower than the minimum across one of those edges can be a sliver there.
      if (!flush.some(({ edge }) => across(ancestor.rect, edge) < minPiece)) continue;
      const cut = cutSliver(ancestor, minPiece);
      const on = cut === undefined ? undefined : flush.find(({ container, edge }) => edge === cut.edge && sameRect(container, cut.container));
      if (cut !== undefined && on !== undefined) return { edge: cut.edge, container: { ...cut.container }, depth: across(node.rect, cut.edge), within: { ...ancestor.rect } };
    }
    return undefined;
  };
  let scrolled: Map<UiNode, boolean> | undefined;
  const inScroller = (node: UiNode): boolean | undefined => {
    if (!ancestry) return undefined;
    if (scrolled === undefined) {
      const found = new Map<UiNode, boolean>();
      const mark = (n: UiNode, under: boolean): void => {
        if (!found.has(n)) found.set(n, under);
        const below = under || scrolls(n);
        for (const child of n.children) mark(child, below);
      };
      mark(tree, false);
      scrolled = found;
    }
    return scrolled.get(node);
  };
  let drawn: Map<UiNode, Drawn> | undefined;
  const drawnIn = (node: UiNode): Drawn | undefined => {
    if (drawn === undefined) {
      const found = new Map<UiNode, Drawn>();
      if (ancestry && unclipped) {
        const mark = (n: UiNode, within: Drawn | undefined): void => {
          if (within !== undefined) found.set(n, within);
          // An ancestor of no area cuts nothing: it fails open, as a root of no area does.
          const below = !scrolls(n) || rectArea(n.rect) === 0
            ? within
            : within === undefined
              ? { frame: { ...n.rect }, scrollers: [n] }
              : { frame: within.frame === undefined ? undefined : rectIntersection(within.frame, n.rect), scrollers: [n, ...within.scrollers] };
          for (const child of n.children) mark(child, below);
        };
        mark(tree, undefined);
      }
      drawn = found;
    }
    return drawn.get(node);
  };
  const axes = new Map<UiNode, ScrollAxes>();
  const axesOf = (container: Rect): ScrollAxes | undefined => {
    const found = [...everyNode(tree)].find((n) => isScrollViewOf(n, container));
    if (found === undefined) return undefined;
    const kept = axes.get(found);
    if (kept !== undefined) return kept;
    const facts: ScrollAxes = {
      axis: scrollAxis(found, unclipped),
      nested: [...everyNode(found)].filter((n) => n !== found && scrolls(n) && !sameRect(n.rect, container)).map((n) => ({ rect: { ...n.rect }, axis: scrollAxis(n, unclipped) })),
    };
    axes.set(found, facts);
    return facts;
  };
  const endsAt = (scroller: Rect, edge: Edge): UiNode | undefined => {
    if (!ancestry || !unclipped) return undefined;
    const view = [...everyNode(tree)].find((n) => isScrollViewOf(n, scroller));
    if (view === undefined) return undefined;
    // Only along the axis it scrolls on: a carousel lists nothing below its bottom because it scrolls sideways.
    if (scrollAxis(view, unclipped) !== axisOfEdge(edge)) return undefined;
    const r = view.rect;
    const past: Record<Edge, (d: Rect) => boolean> = {
      top: (d) => d.y < r.y - 1,
      bottom: (d) => d.y + d.height > r.y + r.height + 1,
      left: (d) => d.x < r.x - 1,
      right: (d) => d.x + d.width > r.x + r.width + 1,
    };
    const under = [...everyNode(view)].filter((d) => d !== view && rectArea(d.rect) > 0);
    return under.some((d) => past[edge](d.rect)) ? undefined : view;
  };
  return { scrollersOf, cutSliver, inScroller, drawnIn, axesOf, endsAt };
}

/** A rect's extent across `edge` — its height at the top or bottom, its width at a side (`Cut.depth`). */
export function across(rect: Rect, edge: Edge): number {
  return axisOfEdge(edge) === 'vertical' ? rect.height : rect.width;
}

/**
 * The axis along which content comes in through `edge`: `vertical` for the top or bottom, `horizontal` for a side —
 * the one edge → axis mapping, read by `Clips.endsAt` and scroll_until's sentences (interact/scroll-text.ts), and by
 * interact/swipe.ts#axisOf for a direction (through its EDGE_TOWARD), so ui-tree imports nothing of interact.
 */
export function axisOfEdge(edge: Edge): ScrollAxis {
  return edge === 'top' || edge === 'bottom' ? 'vertical' : 'horizontal';
}

/**
 * The edges of `rect` that lie on `container`'s, within a pixel — along
 * `axis` only when given (top and bottom are the vertical's), else both —
 * in `clippedEdges`' order; none when the container has no area.
 * `scroll_until`'s `fully: true` stop asks it along the scroll
 * (scroll-rounds.ts#PROBE_REACH), and the cut-sliver rule (`evidentCut`)
 * asks the same question, not a copy of it.
 */
export function flushEdges(rect: Rect, container: Rect, axis?: 'vertical' | 'horizontal'): Edge[] {
  if (rectArea(container) === 0) return [];
  const on = (a: number, b: number) => Math.abs(a - b) <= 1;
  const flush: Record<Edge, boolean> = {
    top: axis !== 'horizontal' && on(rect.y, container.y),
    bottom: axis !== 'horizontal' && on(rect.y + rect.height, container.y + container.height),
    left: axis !== 'vertical' && on(rect.x, container.x),
    right: axis !== 'vertical' && on(rect.x + rect.width, container.x + container.width),
  };
  return (['top', 'bottom', 'left', 'right'] as const).filter((e) => flush[e]);
}

/**
 * The least extent along y a descendant reaching the top or bottom edge from
 * inside the node needs to count as `evidentCut`'s inside evidence, in the
 * tree's units (px on Android, where alone the rule applies): 8 px — a 1-dp
 * divider or a 2-dp focus line is at most 7 px at density 3.5, while the
 * measured toggle's button showed 42 px. Content past the edge counts at any
 * thickness.
 */
export const MIN_INSIDE_EVIDENCE = 8;

/** An evidenced cut of a node at a clipping ancestor's edge (`evidentCut`): the edge, that ancestor's rect, and how deep the node shows across the edge. */
export interface Cut {
  readonly edge: Edge;
  readonly container: Rect;
  /** The node's extent across `edge` — its height at the top or bottom, its width at a side: what of it shows that way. */
  readonly depth: number;
  /**
   * The rect of the nearest ancestor whose cut the node inherits
   * (`Clips.cutSliver`): the node lies flush with `edge` inside it, and
   * IT is a sliver cut there — `66,1924 948x55`, the toggle the label `66,1936 948x42`
   * lies in. Absent for a cut the node's own content evidences.
   */
  readonly within?: Rect;
  /**
   * The node DRAWN AFTER it whose edge the node's rect was cut at (ui-tree/standing.ts#cutByLater): Compose leaves out
   * of a node's bounds what a node drawn after it covers, and the rest of the node lies under THAT node, not past a
   * scroll container's edge — `container` is its rect. Absent for a cut at a clipping container's edge (`cutSliver`'s).
   * docs/bugs/2026-10-16-lab-android-scroll-until-calls-a-field-under-the-ime-riding-bar-visible.md
   */
  readonly by?: UiNode;
}

/**
 * Where `node` is EVIDENTLY cut by its clipping ancestors (`chain`,
 * `Clips.scrollersOf`'s): of every edge, over the WHOLE chain, that the node lies
 * flush with (`flushEdges`) while a descendant of it says the node runs on
 * past it, the shallowest (`Cut.depth`; the first of equals, nearest
 * ancestor first); undefined when none (the bug note is `Clips.cutSliver`'s).
 * The shallowest, not the first found: a card cut to 50 px at a carousel's right edge is
 * a 50-px sliver whatever its top says. Asked through `Clips.cutSliver`
 * only (ui-tree/standing.ts#Scene.standing, for the tap and `scroll_until`'s
 * plain stop).
 *
 * What a descendant must show, along the edge's axis:
 * - At ANY edge: it lies more than a pixel PAST the edge. Compose's nodes
 *   are cut to the scroller while their children may not be (the
 *   snapshot `contactsCreateStaged`: a row `132,242 948x33` at the list's
 *   top, its First name field `132,115 816x160` running on above it).
 * - At ANY edge, with no area: it was dumped wholly past THIS edge
 *   (`UiNode.clippedOut` equal to it) and clamped onto it, within a pixel.
 *   The parser clamps every node uiautomator
 *   dumped inverted to zero size at the clip (adapters/android.ts
 *   #nodeBounds), so the content past the edge reaches here with no rect to
 *   lie past it with: a classic-View Settings row cut to `0,297 1080x33` at
 *   its list's top, its icon cut with it to the row's own height, its title
 *   and summary dumped `[198,297][324,58]` and `[198,297][819,111]` — whole
 *   above the cut — would otherwise read whole and be tapped. Clamped onto
 *   another line (an inner clip's), or past another edge, it says nothing
 *   of this one; any other zero-area descendant says nothing at all.
 * - At the TOP or BOTTOM only: it reaches the edge (within a pixel) from
 *   more than a pixel inside the node's opposite side — content laid out
 *   across the edge and cut with it. uiautomator cuts a View's children
 *   with it, so on classic Views this is the only evidence there is: the
 *   measured toggle `66,1924 948x55` (132 px whole) on a form ending at
 *   1978, its button `66,1936 948x42` starting 12 px inside it and ending
 *   on the cut. A whole element's content keeps inside it (a label centred
 *   in a button) or fills it (a background of the same rect): neither runs
 *   into the edge from inside. Not at a side: every
 *   full-bleed row touches a vertical list's sides with content flush there,
 *   and a whole tile flush with a list's left edge has its icon flush left
 *   — the tree does not say which way a scroller scrolls, and screens are
 *   mostly vertical lists, so the inside evidence is believed along y only.
 *   Nor from a descendant thinner than MIN_INSIDE_EVIDENCE along y: a divider or a focus line at a whole last row's bottom
 *   reaches the edge from inside too, and on a tablet, where the minimum
 *   piece grows (≈ 96 px at 1600 px), a dense 40-dp row is under it.
 *
 * Why evidence, not flushness alone: a node whose edge lies on a scroller's
 * may be cut there or whole and touching it — a first row at rest, a last
 * one scrolled to the end — and the tree does not say which.
 *
 * Unknowable, stated: a cut node with no descendants (a leaf, or a Compose
 * node whose text is merged into it) shows no evidence and reads whole —
 * unless what it lies in is a sliver cut at the edge it is flush with
 * (`Clips.cutSliver`'s inherited cut); so
 * does a classic View cut at a horizontal scroller's side (its children cut
 * with it, never past — unless one lies wholly past it, dumped inverted:
 * then its `clippedOut` is the evidence), and so does a node whose
 * descendant was dumped inverted on BOTH axes and is cut at a side: the
 * parser names the vertical side (android.ts#nodeBounds, `vertical ??
 * sideways`), so a card cut to 40 px at a carousel's left edge, its title
 * dumped `[0,450][-100,440]`, carries `clippedOut: 'top'` and its left cut
 * is missed. The other way, a whole node whose content runs to its top or
 * bottom edge without padding (a divider at a last row's bottom, an image
 * flush with a first row's top) reads cut; so does a WHOLE thin row at rest
 * flush with its list's top with a child laid out wholly above it — a
 * translated or hidden swipe-action view dumped `[40,297][400,250]` over a
 * row `0,297 1080x50` (a synthetic shape, no dump has it) — refused, its remedy naming a child or
 * a coordinate tap. Not tightened (to "a descendant WITH area is also cut
 * to that line"): a real cut row may show only its padding across the
 * edge, no child of it on the line, and then the cut would be missed — a
 * refusal that names its way past is the safer error. The tree carries no
 * natural size of a node to settle any of these. Cost: a walk of the node's subtree per flush
 * edge, for a node with a clipping ancestor only.
 */
function evidentCut(node: UiNode, chain: readonly Rect[]): Cut | undefined {
  const n = node.rect;
  // Along the edge's axis, as offsets INTO the container from that edge: where the descendant's near and far sides lie, and the node's far side.
  const runsOnPast = ({ rect: d, clippedOut }: UiNode, c: Rect, edge: Edge): boolean => {
    const [near, far, nodeFar] = {
      top: [d.y - c.y, d.y + d.height - c.y, n.y + n.height - c.y],
      bottom: [c.y + c.height - (d.y + d.height), c.y + c.height - d.y, c.y + c.height - n.y],
      left: [d.x - c.x, d.x + d.width - c.x, n.x + n.width - c.x],
      right: [c.x + c.width - (d.x + d.width), c.x + c.width - d.x, c.x + c.width - n.x],
    }[edge];
    // Dumped wholly past this edge and clamped onto it (UiNode.clippedOut): past-the-edge evidence with no area left to show it.
    if (rectArea(d) === 0) return clippedOut === edge && Math.abs(near) <= 1;
    const fromInside = axisOfEdge(edge) === 'vertical' && far - near >= MIN_INSIDE_EVIDENCE && near <= 1 && far < nodeFar - 1;
    return near < -1 || fromInside;
  };
  let shallowest: Cut | undefined;
  for (const container of chain) {
    for (const edge of flushEdges(n, container)) {
      const depth = across(n, edge);
      if (shallowest !== undefined && depth >= shallowest.depth) continue;
      for (const d of everyNode(node)) {
        if (d !== node && runsOnPast(d, container, edge)) {
          shallowest = { edge, container: { ...container }, depth };
          break;
        }
      }
    }
  }
  return shallowest;
}

/**
 * The largest node of the tree that clips its descendants
 * (scroll-containers.ts#clips, by area), as its rect — the screen's own scroll
 * view, which `scroll_until` strokes over while the target's own container
 * is not known yet (interact/scroll-read.ts#TreeFacts.mainScroller). Largest, not first: a carousel above a page's list is
 * the smaller of the two. Undefined when none (every iOS tree). One walk.
 */
export function largestScroller(tree: UiNode): Rect | undefined {
  let best: Rect | undefined;
  for (const n of everyNode(tree)) {
    if (clips(n) && rectArea(n.rect) > (best === undefined ? 0 : rectArea(best))) best = n.rect;
  }
  return best === undefined ? undefined : { ...best };
}

// ─── Rect identity and wording ───────────────────────────────────────────────

/**
 * THE TWO RECT SPELLINGS, both byte-stable (tests pin sentences through
 * them), side by side here. The layer and the subject pick one,
 * never the caller's taste:
 * - `rectText`, `x,y wxh` — a NODE's rect as the tree gives it, and any
 *   rect a ui-tree/ or verify/ sentence quotes, the keyboard's included:
 *   verify/'s
 *   sentences (the text table's off-screen region, the pixel poll's
 *   position change and its soft-keyboard miss, which quotes the keyboard
 *   beside the element this way), tap-judgement.ts's off-screen tap, the fill's
 *   not-an-input caveat, and keyboard-cover.ts's stderr diagnostic for a
 *   refused floating panel (the touchable region and the band beside it,
 *   both quoted as rects).
 * - `frameText`, `[x,y][x2,y2]` — the soft KEYBOARD's frame as dumpsys
 *   prints it (the oracle's, or the in-tree band): the tap guard's and the
 *   dismissal's messages on either model, and `scroll_until`'s keyboard
 *   clauses — so a guard sentence reads like the window state it is checked
 *   against.
 */

/**
 * How a sentence quotes a NODE's rect: `x,y wxh`, in tree units (device
 * pixels on Android). One spelling for every sentence.
 */
export function rectText(r: Rect): string {
  return `${r.x},${r.y} ${r.width}x${r.height}`;
}

/** A node as a sentence quotes it (`nodeText`): its role, label, id and rect — not its subtree, which is no fact of a sentence. */
export type QuotedNode = Pick<UiNode, 'role' | 'label' | 'identifier' | 'rect'>;

/** What a sentence keeps of `n` (`QuotedNode`), its rect copied. */
export const quoted = ({ role, label, identifier, rect }: QuotedNode): QuotedNode => ({ role, label, identifier, rect: { ...rect } });

/**
 * How a sentence names the scroll view a node lies outside of — `outside its scroll view scrollable id:form (0,0
 * 402x780)` — or past one edge of (`where`: `below its scroll view …`, interact/target-text.ts#pastSideText), when
 * nothing of the node, or not its centre, is drawn there (ui-tree/standing.ts, the drawn frame, `Clips.drawnIn`). One
 * spelling for the tap's refusal, `scroll_until`'s sentences and the dismissal picker's skip line; the pixel assert's
 * miss heads (verify/pixel-poll.ts#OUTSIDE_ITS_SCROLL_VIEW, #TOO_THIN_IN_ITS_SCROLL_VIEW), quoted whole by the tool
 * description, end with the same words.
 */
export const outsideScrollViewText = (scroller: QuotedNode, where = 'outside'): string =>
  `${where} its scroll view ${nodeText(scroller)}`;

/**
 * How a sentence names a NODE drawn over another — `button "Continue to
 * summary" (24,780 354x44)`: its role, its label quoted (else its id), its
 * rect (`rectText`). The tap's chrome refusal and move
 * (interact/tap-judgement.ts#TapJudge.aim) and `scroll_until`'s covered
 * sentences (interact/scroll-text.ts) share it. The dismissal picker's skip
 * line names a cover shorter, on purpose (interact/target-text.ts#coverName).
 */
export const nodeText = (n: QuotedNode): string =>
  `${n.role}${n.label ? ` ${JSON.stringify(n.label)}` : n.identifier ? ` id:${n.identifier}` : ''} (${rectText(n.rect)})`;

/**
 * How a sentence says a node is drawn over a target: `under button
 * "Continue to summary" (24,780 354x44) at its centre (201,797), drawn over
 * it` — the `at its centre` clause when the cover is the one at the
 * target's centre. One spelling for the tap's
 * chrome refusal and move (interact/tap-judgement.ts#TapJudge.aim) and
 * `scroll_until`'s covered sentences (interact/scroll-text.ts).
 */
export const drawnOverText = (cover: QuotedNode, centre?: Point, reach?: Rect): string =>
  `under ${coverText(cover, reach)}${centre === undefined ? '' : ` at its centre (${centre.x},${centre.y})`}, drawn over it`;

/**
 * How a sentence says a cover whose ORDER against the target the tree does not tell lies over it
 * (draw-order.ts#Exposure.unordered — the two listed in reading order): `overlapped by button "Target W" (51,448
 * 300x64) at its centre (201,502), the two listed in reading order: which is drawn on top is not told` — the place
 * `drawnOverText` takes in the same sentences (ui-tree/standing.ts#coverClause chooses).
 */
export const orderUntoldText = (cover: QuotedNode, centre?: Point, reach?: Rect): string =>
  `overlapped by ${coverText(cover, reach)}${centre === undefined ? '' : ` at its centre (${centre.x},${centre.y})`}, ${ORDER_UNTOLD}`;

/**
 * How the pixel assert's covered sentence says a cover whose order against the element the tree does not tell lies
 * over it (`<cover> overlaps <element>, the two listed in reading order: …`) — `orderUntoldText`'s words for a sentence
 * whose subject is the cover.
 */
export const overlapsUntoldText = (element: string): string => `overlaps ${element}, ${ORDER_UNTOLD}`;

/** Why a cover named by `orderUntoldText` or `overlapsUntoldText` is not said to be drawn over the target. */
const ORDER_UNTOLD = 'the two listed in reading order: which is drawn on top is not told';

/**
 * A cover as a sentence names it, with where it presses when that is not its rect (draw-order.ts#Exposure.reaches: a
 * pinned bar run down to the screen's bottom, a tab bar's item raised by its lift, an alert over the whole screen):
 * `container "Exit confirmation" (41,365 320x172, reaching 0,0 402x874)` — so a point the sentence names off the
 * cover's own rect still lies on what it names. One spelling for the tap, `scroll_until` and the pixel assert.
 */
export const coverText = (cover: QuotedNode, reach?: Rect): string =>
  reach === undefined || sameRect(reach, cover.rect) ? nodeText(cover) : `${nodeText(cover).slice(0, -1)}, reaching ${rectText(reach)})`;

/**
 * How a sentence quotes the KEYBOARD's frame: `[x,y][x2,y2]`, as dumpsys
 * prints it. Not `rectText` for the keyboard in interact/ — see the pair's note above.
 */
export const frameText = ({ x, y, width, height }: Rect): string => `[${x},${y}][${x + width},${y + height}]`;

/**
 * The top of the screen a flat list's top bar lies in (ui-tree/draw-order.ts#firstContent), as
 * a fraction of the screen's height: 20 %, 175 pt of the 874-pt iPhone 17.
 * Measured: idb lists the SWIFT form's Back at y 70–98 and its title at
 * 74–94, under a bar that ends at y 116 (13 %); a large-title bar ends
 * near 158 pt of 874 (18 %, inferred). A content row lying wholly inside
 * this band at the head of the content is read as the bar's
 * (`firstContent`'s misses, stated there). Here, not in draw-order.ts:
 * idb's keyboard band starts below it too
 * (ui-tree/soft-keyboard.ts#flatListKeyboardBand's `barLine`, which
 * draw-order.ts passes it as, `flatListBarLine`; draw-order.ts is its one
 * reader, and the band's top is `DrawOrder.keyboardBandTop`).
 */
export const FLAT_LIST_TOP_BAR_FRACTION = 0.2;

/** The top bar's line on `screen` (geometry.ts#screenOf's): the bottom of its band, FLAT_LIST_TOP_BAR_FRACTION of the screen down — the one spelling, for draw-order.ts and soft-keyboard.ts. */
export const flatListBarLine = (screen: Rect): number => screen.y + screen.height * FLAT_LIST_TOP_BAR_FRACTION;

/** The screen as a host is sized against it: the root's rect, or the tree's largest rect when the root has none (bare-tree.ts's `wrapperBySize` notion; idb's synthetic 0×0 root). Here, not in draw-order.ts: soft-keyboard.ts sizes idb's keyboard band against the same screen. */
export function screenOf(tree: UiNode): Rect {
  if (rectArea(tree.rect) > 0) return tree.rect;
  return [...everyNode(tree)].reduce((best, n) => (rectArea(n.rect) > rectArea(best) ? n.rect : best), tree.rect);
}
