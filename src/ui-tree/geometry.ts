import { everyNode, rectArea, rectCentre, rectIntersection, rectsOverlap, sameRect, sameRectWithinPixel, sameSizeWithinPixel, usableSize, zeroRect, type ClippedSide as Edge, type DeviceScreen, type Point, type Rect, type ScrollAxis, type UiNode } from '../adapters/types.js';

/**
 * Geometry questions asked of a normalized UI tree, independent of what the
 * answers are used for. Both parity comparators (rect and color) need the same
 * two: how wide is the screen, and where is each identified element.
 *
 * These live here rather than in verify/ because they walk a `UiNode` and know
 * nothing about contracts, tolerances or findings. The viewport predicates
 * (intersectsViewport, absentFromViewport, visibleFractionInViewport,
 * clippedEdges) are here too: they are rect arithmetic, not selection.
 * tapPoint stays in selectors.ts on purpose: it is the tap-target rule (where
 * a resolved node is pressed). The point-in-rect test (`containsPoint`) is
 * here too, one spelling for every caller. What is drawn over what — a walk
 * of the tree read as paint order, not rect arithmetic — is
 * ui-tree/draw-order.ts's, which asks these predicates; where a node is drawn
 * under its scroll views (`Clips`) is ui-tree/scroll-clips.ts's.
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
   * turns it into a refusal, for the png scale and the rect denominator alike.
   */
  reliable: boolean;
}

export interface ScreenSize extends ScreenWidth {
  /**
   * Set when the numbers are a WINDOW rect's own sides — the root's (`root`:
   * the window by construction) or a screen-shaped child of a rectless root
   * (`child`: a guessed window, which may be an oversized node crowned as
   * one) — reliable or not; absent when the walk answered, whose height is
   * a content maximum. Only a window's own sides may suggest that the screen
   * is turned, never a walked extent.
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
   * inset (a CONTENT width; walkExtent says which rect wins a tie in reach), or
   * a screen-shaped rect in the same tree reaches materially less far than a
   * bar-shaped one does (see walkExtent).
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
  // A tie in reach is broken toward the origin only under a root of NO area: a
  // multi-window dump lists its windows in no meaningful order, so first-wins
  // would let listing order decide `reliable`. A root WITH area is the
  // window by design (uiautomator's inset app window, A1 in verify/scale.ts),
  // is visited first and keeps the tie: an origin child reaching only as far
  // must not turn its inset into a reliable screen width. Residual: under a
  // root with area, a tie between two descendants that both reach past the root
  // is still decided by tree order; no source produces one today.
  const tieGoesToOrigin = !hasArea(tree.rect);
  const walk = (n: UiNode): void => {
    if (onLayout(n.rect)) {
      const reach = n.rect.x + n.rect.width;
      const widestReach = widest.x + widest.width;
      const winsTie = tieGoesToOrigin && reach === widestReach && Math.abs(n.rect.x) < ORIGIN_SLACK;
      if (reach > widestReach || winsTie) widest = n.rect;
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
  // list of rows) keeps the weaker answer rather than losing the width.
  const corroborated = !sawScreenShaped || screenShaped * MAX_OVERHANG >= width;
  return {
    width,
    height: tallest.y + tallest.height,
    reliable: Math.abs(widest.x) < ORIGIN_SLACK && corroborated,
  };
}

/** A rect of real size on both axes; a root without one is no window (idb's 0x0 root, a multi-window dump). */
const hasArea = (rect: Rect): boolean => rect.width > 0 && rect.height > 0;

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
 * The root is it when the root is origin-anchored with area; a root with area
 * elsewhere yields undefined here (`insetWindowRect` reads it). When the root
 * has NO usable rect the window is one level down: idb's flat
 * `describe-all` and uiautomator's multi-root dump are normalized under a
 * synthetic 0x0 root (adapters/ios-tree-source.ts,
 * adapters/android-tree-dialect.ts), and WDA's live /source roots a sheet
 * tree in a node carrying no `rect` at all, which the parser zero-fills — in
 * all three the real window sits among the children (measured: the iOS
 * filter sheet's `Application "Skeleton Internal"` at {0,0,402,874}).
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
  if (hasArea(tree.rect)) return undefined;
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
  if (hasArea(tree.rect)) return shaped(tree.rect) ? tree.rect : undefined;
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
 * half-width split view). `FIT_SLACK` below is the same allowance for a
 * window's reach.
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
 * faces" — for the box a gesture swipes in and every judgement's usable
 * screen. Here rather than in verify/scale.ts: `interact/` may not import
 * `verify/` (ARCHITECTURE.md §2), and the question is rect arithmetic over
 * a tree's size and the device's.
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
 * checks it. Here, below both, because verify/ sits below flow/ and
 * interact/ and may import neither: the two read one rule.
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
 * `rectArea`, `rectCentre`, `rectsOverlap`, `rectIntersection`, `sameRect`, `sameRectWithinPixel` and
 * `sameSizeWithinPixel` live beside `Rect` in adapters/types.ts — the idb tree source, the WDA parser (its keyboard
 * band test, wda-source.ts#isTextEcho) and the system-alert and chooser judges (a button's centre) need them and may
 * not import this layer — and are re-exported here, where the rect arithmetic's callers look for them.
 */
export { rectArea, rectCentre, rectIntersection, rectsOverlap, sameRect, sameRectWithinPixel, sameSizeWithinPixel };

/**
 * Is the point inside the rect — left and top inclusive, right and bottom
 * exclusive, like the Android frame test. The point-in-rect companion of
 * `rectsOverlap` (two rects sharing area: a different question), and the
 * ONE spelling of it.
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
 * no area. Here as rect arithmetic, beside `rectIntersection`, which it is
 * built on.
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

export const largestRect = (rects: readonly Rect[]): Rect | undefined =>
  rects.reduce<Rect | undefined>((best, r) => (best === undefined || rectArea(r) > rectArea(best) ? r : best), undefined);

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
 * (ui-tree/standing.ts#Scene). Here as rect arithmetic, below interact/.
 */
export function belowStatusBand(box: Rect, screen: { statusBand?: number } | undefined, shape: { width: number; height: number } = box): Rect {
  const band = screen?.statusBand ?? 0;
  if (band <= 0 || shape.height <= shape.width) return box;
  const top = Math.max(box.y, band);
  return { ...box, y: top, height: Math.max(0, box.y + box.height - top) };
}

/**
 * `box` less both system bands — `belowStatusBand`, then `aboveNavigationBand`, `shape` as there: the part of the
 * screen a swipe can reach and a reader sees. A navigation band reaching above the status band's bottom fails open, as
 * `aboveNavigationBand` says.
 */
export function clearOfSystemBands(box: Rect, screen: { statusBand?: number; navigationBand?: number } | undefined, shape: { width: number; height: number } = box): Rect {
  return aboveNavigationBand(belowStatusBand(box, screen, shape), screen, shape);
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

/** `a` and `b` share area thicker than PIXEL_OVERLAP_SLACK on its thin side — what a pixel assert counts as one hiding the other. */
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

/** A rect's four sides, in the order every reader asks them: top, bottom, left, right. */
export const EDGES: readonly Edge[] = ['top', 'bottom', 'left', 'right'];

/** The side across a rect from each edge: a cut edge's uncut side. */
export const OPPOSITE_EDGE: Readonly<Record<Edge, Edge>> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

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
 * The side of `viewport` a rect lies wholly past — below before above, as a scroll down finds it — or undefined when it
 * lies past none wholly. A rect with no area lies past none: it has no extent to lie past a side with, and where a tree
 * gives one it is most often a placeholder origin, not a place (the SWIFT form's `TextFieldWithComponentStyle` texts,
 * read at 0,0 0x0 under their fields) — its bottom edge on the viewport's top would read "above the viewport", so it
 * reads "outside the viewport" instead (interact/scroll-text.ts#notInViewportText).
 */
export function wholePast(rect: Rect, viewport: Rect): Edge | undefined {
  if (rectArea(rect) === 0) return undefined;
  if (rect.y >= viewport.y + viewport.height) return 'bottom';
  if (rect.y + rect.height <= viewport.y) return 'top';
  if (rect.x >= viewport.x + viewport.width) return 'right';
  if (rect.x + rect.width <= viewport.x) return 'left';
  return undefined;
}

/**
 * How far `rect`'s `edge` side lies INSIDE `outer`'s same side, toward `outer`'s middle: positive inside, 0 on it,
 * negative past it.
 */
export function distanceInside(rect: Rect, outer: Rect, edge: Edge): number {
  switch (edge) {
    case 'top':
      return rect.y - outer.y;
    case 'bottom':
      return outer.y + outer.height - (rect.y + rect.height);
    case 'left':
      return rect.x - outer.x;
    case 'right':
      return outer.x + outer.width - (rect.x + rect.width);
  }
}

/** A rect's extent across `edge` — its height at the top or bottom, its width at a side (scroll-clips.ts#Cut.depth). */
export function across(rect: Rect, edge: Edge): number {
  return axisOfEdge(edge) === 'vertical' ? rect.height : rect.width;
}

/**
 * The axis along which content comes in through `edge`: `vertical` for the top or bottom, `horizontal` for a side —
 * the one edge → axis mapping, here so that ui-tree imports nothing of interact.
 */
export function axisOfEdge(edge: Edge): ScrollAxis {
  return edge === 'top' || edge === 'bottom' ? 'vertical' : 'horizontal';
}

/**
 * The edges of `rect` that lie on `container`'s, within a pixel — along
 * `axis` only when given (top and bottom are the vertical's), else both —
 * in `clippedEdges`' order; none when the container has no area.
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
  return EDGES.filter((e) => flush[e]);
}

// ─── Rect identity and wording ───────────────────────────────────────────────

/**
 * THE TWO RECT SPELLINGS, both byte-stable (tests pin sentences through
 * them), side by side here. The layer and the subject pick one,
 * never the caller's taste:
 * - `rectText`, `x,y wxh` — a NODE's rect as the tree gives it, and any
 *   rect a ui-tree/, verify/ or interact/ sentence quotes, the keyboard's
 *   included (the pixel poll's soft-keyboard miss quotes it beside the
 *   element this way).
 * - `frameText`, `[x,y][x2,y2]` — the soft KEYBOARD's frame as dumpsys
 *   prints it (the oracle's, or the in-tree band): the tap guard's and the
 *   dismissal's messages on either model, and `scroll_until`'s keyboard
 *   clauses — so a guard sentence reads like the window state it is checked
 *   against.
 * A node's name around its rect (its role and its label) is ui-tree/node-words.ts's.
 */

/**
 * How a sentence quotes a NODE's rect: `x,y wxh`, in tree units (device
 * pixels on Android). One spelling for every sentence.
 */
export function rectText(r: Rect): string {
  return `${r.x},${r.y} ${r.width}x${r.height}`;
}

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
 * (ui-tree/soft-keyboard.ts#flatListKeyboardBand's `barLine`; the band's
 * top is `DrawOrder.keyboardBandTop`).
 */
export const FLAT_LIST_TOP_BAR_FRACTION = 0.2;

/** The top bar's line on `screen` (geometry.ts#screenOf's): the bottom of its band, FLAT_LIST_TOP_BAR_FRACTION of the screen down — the one spelling. */
export const flatListBarLine = (screen: Rect): number => screen.y + screen.height * FLAT_LIST_TOP_BAR_FRACTION;

/** The screen as a host is sized against it: the root's rect, or the tree's largest rect when the root has none (bare-tree.ts's `wrapperBySize` notion; idb's synthetic 0×0 root). */
export function screenOf(tree: UiNode): Rect {
  if (rectArea(tree.rect) > 0) return tree.rect;
  return [...everyNode(tree)].reduce((best, n) => (rectArea(n.rect) > rectArea(best) ? n.rect : best), tree.rect);
}
