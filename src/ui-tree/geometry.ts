import { everyNode, rectArea, rectIntersection, rectsOverlap, sameRect, sameRectWithinPixel, usableScreen, zeroRect, type ClippedSide as Edge, type DeviceScreen, type Point, type Rect, type UiNode } from '../adapters/types.js';

/**
 * Geometry questions asked of a normalized UI tree, independent of what the
 * answers are used for. Both parity comparators (rect and color) need the same
 * two: how wide is the screen, and where is each identified element.
 *
 * These live here rather than in verify/ because they walk a `UiNode` and know
 * nothing about contracts, tolerances or findings. Since 2026-10-04 the
 * viewport predicates (intersectsViewport, absentFromViewport,
 * visibleFractionInViewport, clippedEdges) are here too, at the end of the
 * file: they were in selectors.ts, but they are rect arithmetic, not
 * selection, and the 2026-08-14 review (E2) had already asked for them to
 * join this module. tapPoint stays in selectors.ts on purpose: it is the
 * tap-target rule (where a resolved node is pressed), its importers include
 * the interact/keyboard*.ts modules, and the move deliberately left it alone. Since
 * 2026-10-07 the point-in-rect test (`containsPoint`) is here too: the tap
 * guard's dismissal picker had spelled it in interact/keyboard.ts. What is
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
   * remark — was deleted on 2026-10-07 for that reason.
   */
  reliable: boolean;
}

export interface ScreenSize extends ScreenWidth {
  /**
   * Set when the numbers are a WINDOW rect's own sides — the root's (`root`:
   * the window by construction) or a screen-shaped child of a rectless root
   * (`child`: a guessed window, which may be an oversized node crowned as
   * one) — reliable or not; absent when the walk answered, whose height is
   * a content maximum. Read by interact/swipe.ts#screenBox (2026-10-08, code
   * review of the off-screen judgement): only a window's own sides may
   * suggest that the screen is turned, never a walked extent.
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
   * witness (2026-10-07, the parity code review's A1).
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
 * wrong band of the screenshot (docs/bugs/2026-08-26-ios-ocr-crop-scale.md).
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
    // iOS reports its full frame. Review 2026-08-27 caught exactly that: every
    // root-bearing tree with a straddling child had started failing closed.
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
 * as an 804pt screen and failed every png scale closed
 * (docs/bugs/2026-08-26-png-scale-needs-out-of-tree-screen-size.md). The rule
 * is geometric rather than by node type because the normalized tree keeps no
 * type: WDA's PopoverDismissRegion arrives here as role `other`.
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
  // `reliable` to any origin-anchored maximum with no cross-check. That is how
  // hole 1 kept coming back (review 2026-08-27, third round): pixel-scale junk
  // {0,0,804,150} in a point tree read as an 804pt screen at scale 1.5, in
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
 * purpose: an off-viewport sibling parked at x=screenWidth is the original
 * 2026-08-26 inflator, and counting it would refuse the very screens this
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
 * real window sits among the children (measured 2026-08-26: the iOS filter
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
 * the same allowance for a window's reach. Owned by verify/scale.ts until
 * 2026-10-08, when `windowTurnsScreen` moved here with it.
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
 * faces" (2026-10-08, for interact/swipe.ts#screenBox, the box a gesture
 * swipes in). Here rather than in verify/scale.ts, where it was written:
 * `interact/` may not import `verify/` (ARCHITECTURE.md §2), and the
 * question is rect arithmetic over a tree's size and the device's — the
 * reason the absent-in-viewport rule both engines need lives in this file
 * (code review of the swipe commit, 2026-10-08).
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
 * position: the A1 shapes (126,0 2274x1080 beside a left nav bar) and the non-edge-to-edge
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
 * A WALKED height never votes (review round 2, 2026-10-08). It is the
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
 * walked width the same way (the 2026-08-26 inflator, which `walkExtent`'s
 * corroboration catches only when something screen-shaped is in the tree)
 * and turns the box — the tree cannot tell that width from a landscape one,
 * as verify/scale.ts#windowWidth's walked-width note says.
 *
 * Accepted cost (review 2026-10-08): a rectless root whose only
 * screen-shaped child is wider than the panel as built but fits it turned —
 * an oversized node crowned as the window, the sheet class geometry.ts
 * describes — turns the box. A gesture over a turned box on an unturned
 * screen lands off-centre, not off-screen in the short axis; the tree
 * offers nothing to tell the two apart. That cost is a SWIPE's only: a tap
 * refusal (interact/resolve.ts#onScreen) does not take this answer alone —
 * swipe.ts#screenBox says which boxes count (`ScreenBox.boxes`), and a
 * child window that matches the panel neither way — this crowned node —
 * is no evidence there: the judgement uses the panel as built. A window
 * whose own sides say the panel is turned (its width the long side within
 * 5 %, its height within the short side), or a turn on a walked width,
 * counts the box either way up (the off-screen reviews, 2026-10-08).
 */
export function windowTurnsScreen(size: ScreenSize, screen: DeviceScreen): boolean {
  if (!usableScreen(screen)) return false;
  // Only the tree's trustworthy parts vote. A walked height is a content
  // maximum (scale.ts#orient lost the tree's vote to exactly that), so a
  // reliable tree without a window's own height is judged by its WIDTH:
  // wider than the panel as built, within it turned (the split-pane guard is
  // the first half).
  if (size.reliable && usableScreen(size) && !size.trustworthyHeight) {
    return size.width > screen.width * FIT_SLACK && size.width <= screen.height * FIT_SLACK;
  }
  const window: Rect | undefined =
    size.reliable && usableScreen(size)
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
 * checks it. Since 2026-10-03 this is the one owner; the engine and
 * verify/assert.ts each spelled it out before, and the two layers cannot
 * share it anywhere higher (verify sits below the interaction module).
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
 * WRONG thing to report: measured 2026-08-27, a row clipped by the floating
 * bottom-nav bar intersected by 87% of its height, `scroll_until` reported a
 * bare "visible", and the next assert measured the CLIPPED rect — reading
 * h 143 against a pinned 60 and pointing the investigation at the app's
 * row-height logic, which was correct. A caller who is told the fraction can
 * see the clipping; a caller told "visible" cannot.
 *
 * The viewport is anchored at the origin unless it says otherwise (`x`,
 * `y`: a box that starts lower — iOS's screen below its status band,
 * interact/swipe.ts#belowStatusBand).
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
 * `rectArea` lives beside `Rect` in adapters/types.ts since 2026-10-06 — the
 * idb tree source needs it too and may not import this layer — and is
 * re-exported here, where the rect arithmetic's callers look for it.
 * `rectsOverlap` joined it on 2026-10-07 for the same reason: the WDA
 * parser's keyboard band test (wda-source.ts) had a copy of its arithmetic.
 * `sameRect` joined them on 2026-10-08 (round 4): the WDA parser's text-echo
 * rule (wda-source.ts#isTextEcho) asks the same question. Its tolerant
 * sibling `sameRectWithinPixel` (scroll_until's motion test) joined it the
 * same day, so rect equality has one owner. `rectIntersection` joined
 * `rectsOverlap` on 2026-10-09 (verification round of fix/r3-cr): the
 * overlap test is its `!== undefined`, one arithmetic for both.
 */
export { rectArea, rectIntersection, rectsOverlap, sameRect, sameRectWithinPixel };

/**
 * Is the point inside the rect — left and top inclusive, right and bottom
 * exclusive, like the Android frame test. The point-in-rect companion of
 * `rectsOverlap` (two rects sharing area: a different question), and the
 * ONE spelling of it: the tap guard asks it of the keyboard's frame and the
 * tap point (ui-tree/keyboard-cover.ts#readKeyboard, its `over` and `frameOver`), the dismissal picker of the
 * root's rect, and ui-tree/draw-order.ts of every candidate. Until 2026-10-07 it
 * was interact/keyboard.ts's `inside`, with a `covers` wrapper beside it.
 */
export function containsPoint(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

/**
 * Does `inner` lie wholly inside `outer` — edges included. The rect-in-rect
 * companion of `containsPoint`; draw-order.ts#drawnOverAt asks it so that a
 * wrapper whose rect holds the whole stroke container is not named as what
 * the stroke touched down on (review round 1 of fix/r4-stroke, 2026-10-09).
 */
export function rectWithin(inner: Rect, outer: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/**
 * `from` less `cut`: the pieces of `from` outside `cut`, at most four and
 * disjoint — the band above the cut and the band below it, full width, and
 * the parts left and right of it between them. `from` whole when they share
 * no area. ui-tree/draw-order.ts#exposure cuts a target by its covers with
 * it (moved here from there by code review S3, 2026-10-09: rect arithmetic,
 * beside `rectIntersection`, which it is built on).
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
 * rect; draw-order.ts#exposure of the piece a moved tap aims at (code
 * review S5).
 */
export const rectCentre = (r: Rect): Point => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });

/**
 * The HIGHER of two top edges a box is cut above (the smaller y), either of
 * which may be unknown — undefined only when both are. The one spelling
 * (code review of round 7, S5) of what the tap's chrome check
 * (interact/resolve.ts#aimClearOfChrome) and `scroll_until`'s stroke box
 * (interact/scroll-rounds.ts#strokeTop) each wrote out: a keyboard cover's
 * top and idb's keyboard band's.
 */
export const higherTop = (a: number | undefined, b: number | undefined): number | undefined => (a === undefined ? b : b === undefined ? a : Math.min(a, b));

/**
 * A rect's side: one a rect extends past (`clippedEdges`), or lies flush with
 * (`flushEdges`) — adapters/types.ts#ClippedSide, the side a node dumped
 * inverted lies past, re-exported under the name ui-tree asks it by (code
 * review of round 7, S1: the two were the same union spelled twice). One
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
 * Each node's ancestors that CLIP it — every node marked `clipsDescendants`
 * above it (adapters/types.ts#UiNode.clipsDescendants: Android's
 * `scrollable="true"`, whose descendants' bounds uiautomator has already
 * cut to it), NEAREST FIRST, as their rects; empty for a node with none,
 * which is every node of an iOS tree (2026-10-09). One walk of the tree
 * when called; the answer is a lookup by node identity, so it is asked of
 * nodes of THIS tree (a node of another read answers empty). `scroll_until`'s
 * round asks it of each match (interact/scroll-rounds.ts#TreeFacts), to tell a `fully:
 * true` stop whose edge sits exactly on a clipping ancestor's — possibly
 * cut there — from one inside them all (interact/scroll-rounds.ts
 * #PROBE_REACH), and to pick the box its strokes are drawn in. The whole
 * chain, not the nearest alone (code review of fix/r3-scroll, 2026-10-09):
 * a card that fills a horizontal carousel's height is flush with BOTH of
 * the carousel's edges — one probe cannot tell — while the carousel itself
 * is cut by the vertical list around it, and the card's rect with it; the
 * cut is on the outer edge, and the outer list is the one to stroke. Cost:
 * one pre-order walk and an array per clipped node, shared along a branch.
 */
export function scrollersOf(tree: UiNode): (node: UiNode) => readonly Rect[] {
  const chains = new Map<UiNode, readonly Rect[]>();
  const walk = (n: UiNode, chain: readonly Rect[]): void => {
    if (chain.length > 0) chains.set(n, chain);
    const below = n.clipsDescendants === true ? [n.rect, ...chain] : chain;
    for (const child of n.children) walk(child, below);
  };
  walk(tree, []);
  return (node) => chains.get(node) ?? [];
}

/**
 * The edges of `rect` that lie on `container`'s, within a pixel — along
 * `axis` only when given (top and bottom are the vertical's), else both —
 * in `clippedEdges`' order; none when the container has no area. Moved here
 * from interact/scroll-rounds.ts on 2026-10-10, where `scroll_until`'s
 * `fully: true` stop asks it along the scroll (scroll-rounds.ts
 * #PROBE_REACH), so the tap's cut-sliver rule (`evidentCut`) asks the same
 * question, not a copy of it.
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
}

/**
 * Where `node` is EVIDENTLY cut by its clipping ancestors (`chain`,
 * `scrollersOf`'s): of every edge, over the WHOLE chain, that the node lies
 * flush with (`flushEdges`) while a descendant of it says the node runs on
 * past it, the shallowest (`Cut.depth`; the first of equals, nearest
 * ancestor first); undefined when none (2026-10-10, docs/bugs/2026-10-09-
 * android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-
 * nothing.md). The shallowest, not the first found (code review of
 * fix/r7-sliver, item 2): a card cut to 50 px at a carousel's right edge is
 * a 50-px sliver whatever its top says. The tap's cut-sliver rule
 * (interact/resolve.ts#refuseCutSliver) and `scroll_until`'s plain stop
 * (interact/scroll-rounds.ts#stops) ask it, against the same minimum.
 *
 * What a descendant must show, along the edge's axis:
 * - At ANY edge: it lies more than a pixel PAST the edge. Compose's nodes
 *   are cut to the scroller while their children may not be (the round-5
 *   snapshot `contactsCreateStaged`: a row `132,242 948x33` at the list's
 *   top, its First name field `132,115 816x160` running on above it).
 * - At ANY edge, with no area: it was dumped wholly past THIS edge
 *   (`UiNode.clippedOut` equal to it) and clamped onto it, within a pixel
 *   (code review of round 7, P1). The parser clamps every node uiautomator
 *   dumped inverted to zero size at the clip (adapters/android.ts
 *   #nodeBounds), so the content past the edge reaches here with no rect to
 *   lie past it with: a classic-View Settings row cut to `0,297 1080x33` at
 *   its list's top, its icon cut with it to the row's own height, its title
 *   and summary dumped `[198,297][324,58]` and `[198,297][819,111]` — whole
 *   above the cut — read whole and was tapped until then. Clamped onto
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
 *   into the edge from inside. Not at a side (code review item 4): every
 *   full-bleed row touches a vertical list's sides with content flush there,
 *   and a whole tile flush with a list's left edge has its icon flush left
 *   — the tree does not say which way a scroller scrolls, and screens are
 *   mostly vertical lists, so the inside evidence is believed along y only.
 *   Nor from a descendant thinner than MIN_INSIDE_EVIDENCE along y (code
 *   review round 3): a divider or a focus line at a whole last row's bottom
 *   reaches the edge from inside too, and on a tablet, where the minimum
 *   piece grows (≈ 96 px at 1600 px), a dense 40-dp row is under it.
 *
 * Why evidence, not flushness alone: a node whose edge lies on a scroller's
 * may be cut there or whole and touching it — a first row at rest, a last
 * one scrolled to the end — and the tree does not say which.
 *
 * Unknowable, stated: a cut node with no descendants (a leaf, or a Compose
 * node whose text is merged into it) shows no evidence and reads whole; so
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
 * row `0,297 1080x50` (verification of the code review of round 7: a
 * synthetic shape, no dump has it) — refused, its remedy naming a child or
 * a coordinate tap. Not tightened (to "a descendant WITH area is also cut
 * to that line"): a real cut row may show only its padding across the
 * edge, no child of it on the line, and then the cut would be missed — a
 * refusal that names its way past is the safer error. The tree carries no
 * natural size of a node to settle any of these. Cost: a walk of the node's subtree per flush
 * edge, for a node with a clipping ancestor only.
 */
export function evidentCut(node: UiNode, chain: readonly Rect[]): Cut | undefined {
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
    const fromInside = (edge === 'top' || edge === 'bottom') && far - near >= MIN_INSIDE_EVIDENCE && near <= 1 && far < nodeFar - 1;
    return near < -1 || fromInside;
  };
  let shallowest: Cut | undefined;
  for (const container of chain) {
    for (const edge of flushEdges(n, container)) {
      const depth = edge === 'top' || edge === 'bottom' ? n.height : n.width;
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
 * `evidentCut` when what shows of the node across that edge is under
 * `minPiece` (draw-order.ts#MIN_TAP_PIECE_FRACTION, `Exposure.minPiece`) —
 * a sliver a tap is refused on (interact/resolve.ts#refuseCutSliver) and
 * `scroll_until`'s plain stop does not stop on (scroll-rounds.ts#stops);
 * undefined otherwise. The one spelling of the rule both ask.
 */
export function cutSliver(node: UiNode, chain: readonly Rect[], minPiece: number): Cut | undefined {
  const cut = evidentCut(node, chain);
  return cut !== undefined && cut.depth < minPiece ? cut : undefined;
}

/**
 * Whether `node` lies inside something that scrolls — an ancestor of role
 * `scrollable` (a ScrollView, Table or CollectionView) or `webview` (a
 * WKWebView's page scrolls) — or undefined when the tree cannot say: a flat list (`UiNode.flatList`, idb)
 * has no ancestry, and a node of another tree has none here. The tap's
 * status-bar refusal asks it to say whether `scroll_until` can move the
 * target out from under the bar (interact/resolve.ts#statusBarRemedy, code
 * review of round 6, P1). One walk, stopping at the node. Android's band
 * too since 2026-10-12, so Android's mark of a node that scrolls now
 * (`clipsDescendants`: a Compose list has no `scrollable` role) counts.
 */
export function insideScroller(tree: UiNode, node: UiNode): boolean | undefined {
  if (tree.flatList === true) return undefined;
  const walk = (n: UiNode, scrolled: boolean): boolean | undefined => {
    if (n === node) return scrolled;
    const below = scrolled || n.role === 'scrollable' || n.role === 'webview' || n.clipsDescendants === true;
    for (const child of n.children) {
      const found = walk(child, below);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(tree, false);
}

/**
 * The largest node of the tree that clips its descendants
 * (`clipsDescendants`, by area), as its rect — the screen's own scroll
 * view, which `scroll_until` strokes over while the target's own container
 * is not known yet (2026-10-09; interact/scroll-rounds.ts#TreeFacts
 * .mainScroller). Largest, not first: a carousel above a page's list is
 * the smaller of the two. Undefined when none (every iOS tree). One walk.
 */
export function largestScroller(tree: UiNode): Rect | undefined {
  let best: Rect | undefined;
  for (const n of everyNode(tree)) {
    if (n.clipsDescendants === true && rectArea(n.rect) > (best === undefined ? 0 : rectArea(best))) best = n.rect;
  }
  return best === undefined ? undefined : { ...best };
}

// ─── Rect identity and wording ───────────────────────────────────────────────

/**
 * THE TWO RECT SPELLINGS, both byte-stable (tests pin sentences through
 * them), here side by side since 2026-10-09 (code review S5: `frameText`
 * sat in interact/keyboard-model.ts, so scroll-text.ts imported the tap
 * guard's model seam to quote a rect). The layer and the subject pick one,
 * never the caller's taste:
 * - `rectText`, `x,y wxh` — a NODE's rect as the tree gives it, and any
 *   rect a ui-tree/ or verify/ sentence quotes, the keyboard's included:
 *   verify/'s
 *   sentences (the text table's off-screen region, the pixel poll's
 *   position change and its soft-keyboard miss, which quotes the keyboard
 *   beside the element this way), resolve.ts's off-screen tap, the fill's
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
 * pixels on Android). Owned here since 2026-10-06, when two failure
 * sentences in verify/ spelled it inline.
 */
export function rectText(r: Rect): string {
  return `${r.x},${r.y} ${r.width}x${r.height}`;
}

/**
 * How a sentence names a NODE drawn over another — `button "Continue to
 * summary" (24,780 354x44)`: its role, its label quoted (else its id), its
 * rect (`rectText`). The tap's chrome refusal and move
 * (interact/resolve.ts#aimClearOfChrome) and `scroll_until`'s covered
 * sentences (interact/scroll-text.ts) share it (2026-10-09).
 */
export const nodeText = (n: Pick<UiNode, 'role' | 'label' | 'identifier' | 'rect'>): string =>
  `${n.role}${n.label ? ` ${JSON.stringify(n.label)}` : n.identifier ? ` id:${n.identifier}` : ''} (${rectText(n.rect)})`;

/**
 * How a sentence says a node is drawn over a target: `under button
 * "Continue to summary" (24,780 354x44) at its centre (201,797), drawn over
 * it` — the `at its centre` clause when the cover is the one at the
 * target's centre. One spelling (code review S6, 2026-10-09) for the tap's
 * chrome refusal and move (interact/resolve.ts#aimClearOfChrome) and
 * `scroll_until`'s covered sentences (interact/scroll-text.ts).
 */
export const drawnOverText = (cover: Pick<UiNode, 'role' | 'label' | 'identifier' | 'rect'>, centre?: Point): string =>
  `under ${nodeText(cover)}${centre === undefined ? '' : ` at its centre (${centre.x},${centre.y})`}, drawn over it`;

/**
 * How a sentence quotes the KEYBOARD's frame: `[x,y][x2,y2]`, as dumpsys
 * prints it. Not `rectText` for the keyboard in interact/ (2026-10-08: the
 * two docs each claimed to be the one way) — see the pair's note above.
 */
export const frameText = ({ x, y, width, height }: Rect): string => `[${x},${y}][${x + width},${y + height}]`;

/**
 * The top of the screen a flat list's top bar lies in (ui-tree/draw-order.ts#firstContent), as
 * a fraction of the screen's height: 20 %, 175 pt of the 874-pt iPhone 17.
 * Measured: idb lists the SWIFT form's Back at y 70–98 and its title at
 * 74–94, under a bar that ends at y 116 (13 %); a large-title bar ends
 * near 158 pt of 874 (18 %, inferred). A content row lying wholly inside
 * this band at the head of the content is read as the bar's
 * (`firstContent`'s misses, stated there). Here since round 7 (2026-10-10),
 * moved from ui-tree/draw-order.ts: idb's keyboard band starts below it too
 * (ui-tree/soft-keyboard.ts#flatListKeyboardBand's `barLine`, which
 * draw-order.ts passes it as, `flatListBarLine` — since the code review of
 * round 7, S3, draw-order.ts is again its one reader: the band's top is
 * `DrawOrder.keyboardBandTop`).
 */
export const FLAT_LIST_TOP_BAR_FRACTION = 0.2;

/** The top bar's line on `screen` (geometry.ts#screenOf's): the bottom of its band, FLAT_LIST_TOP_BAR_FRACTION of the screen down — the one spelling (code review of round 7, S6: draw-order.ts and soft-keyboard.ts each wrote the product out). */
export const flatListBarLine = (screen: Rect): number => screen.y + screen.height * FLAT_LIST_TOP_BAR_FRACTION;

/** The screen as a host is sized against it: the root's rect, or the tree's largest rect when the root has none (bare-tree.ts's `wrapperBySize` notion; idb's synthetic 0×0 root). Moved from ui-tree/draw-order.ts in round 7 (2026-10-10), when soft-keyboard.ts sized idb's keyboard band against the same screen (its top is `DrawOrder.keyboardBandTop` since the code review of round 7, S3). */
export function screenOf(tree: UiNode): Rect {
  if (rectArea(tree.rect) > 0) return tree.rect;
  return [...everyNode(tree)].reduce((best, n) => (rectArea(n.rect) > rectArea(best) ? n.rect : best), tree.rect);
}
