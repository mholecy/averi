import { everyNode, rectArea, rectIntersection, rectsOverlap, sameRect, sameRectWithinPixel, SCREEN_SIZED_FRACTION, STRUCTURAL_ROLES, usableScreen, zeroRect, type DeviceScreen, type Point, type Rect, type UiNode } from '../adapters/types.js';
import { isInteractive } from './selectors.js';

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
 * 2026-10-07 the point-in-rect test (`containsPoint`) and the draw-order
 * question (`shadowing`, at the end) are here too: the tap guard's
 * dismissal picker had spelled both in interact/keyboard.ts, and the review
 * of that branch sent them where the rect arithmetic is — a layer that may
 * ask the tree anything, below the one that acts on it (ARCHITECTURE.md §2).
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
 */
export function visibleFractionInViewport(
  rect: Rect,
  viewport: { width: number; height: number },
): number {
  if (rectArea(rect) === 0) return 0;
  const w = Math.min(rect.x + rect.width, viewport.width) - Math.max(rect.x, 0);
  const h = Math.min(rect.y + rect.height, viewport.height) - Math.max(rect.y, 0);
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
 * root's rect, and `shadowing` below of every candidate. Until 2026-10-07 it
 * was interact/keyboard.ts's `inside`, with a `covers` wrapper beside it.
 */
export function containsPoint(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

/**
 * Which viewport edges the rect extends past, in the order a reader scans.
 * Named rather than counted because the edge IS the diagnosis: 'bottom' with
 * the content exhausted is a missing-clearance bug, 'top' is a sticky header
 * overlapping, and the two want different fixes.
 */
export function clippedEdges(
  rect: Rect,
  viewport: { width: number; height: number },
): ('top' | 'bottom' | 'left' | 'right')[] {
  const out: ('top' | 'bottom' | 'left' | 'right')[] = [];
  if (rect.y < 0) out.push('top');
  if (rect.y + rect.height > viewport.height) out.push('bottom');
  if (rect.x < 0) out.push('left');
  if (rect.x + rect.width > viewport.width) out.push('right');
  return out;
}

/**
 * Each node's ancestors that CLIP it — every node marked `clipsDescendants`
 * above it (adapters/types.ts#UiNode.clipsDescendants: Android's
 * `scrollable="true"`, whose descendants' bounds uiautomator has already
 * cut to it), NEAREST FIRST, as their rects; empty for a node with none,
 * which is every node of an iOS tree (2026-10-09). One walk of the tree
 * when called; the answer is a lookup by node identity, so it is asked of
 * nodes of THIS tree (a node of another read answers empty). `scroll_until`
 * hands the round each match's (interact/scroll.ts), to tell a `fully:
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
 * The largest node of the tree that clips its descendants
 * (`clipsDescendants`, by area), as its rect — the screen's own scroll
 * view, which `scroll_until` strokes over while the target's own container
 * is not known yet (2026-10-09; interact/scroll-rounds.ts#RoundRead
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
 * How a sentence quotes the KEYBOARD's frame: `[x,y][x2,y2]`, as dumpsys
 * prints it. Not `rectText` for the keyboard in interact/ (2026-10-08: the
 * two docs each claimed to be the one way) — see the pair's note above.
 */
export const frameText = ({ x, y, width, height }: Rect): string => `[${x},${y}][${x + width},${y + height}]`;

// ─── Draw order ──────────────────────────────────────────────────────────────

/**
 * The roles whose frame is not a surface: a node of one, non-interactive and
 * with children, covers a point only through its content (`shadowing`
 * below, 2026-10-08). One role, deliberately — see the rejected ones there.
 */
const CONTENT_FRAMED_ROLES: ReadonlySet<string> = new Set(['scrollable']);

/**
 * The node DRAWN OVER `point` on top of `node`, if any (review round 1): the
 * last node in pre-order AFTER `node`'s subtree — later siblings and their
 * descendants are drawn over earlier ones, later Windows over earlier (UIKit
 * orders them by level) — that is content (not a structural wrapper: a
 * full-screen `Other` of a later Window contains every point and draws
 * nothing), has area and contains the point. The keyboard's own nodes are
 * NOT exempt: a strategy under the keyboard is caught first by the band
 * check (with its own reason), and a keyboard-owned node over the point
 * that the band missed is a real cover (review 2026-10-07). `undefined` when
 * nothing shadows the point. Ancestors and earlier siblings never count:
 * they are beneath. A heuristic, not a compositor — a transparent overlay
 * smaller than the screen reads as cover, a label inside a sheet that does
 * not contain the point does not — but it refuses the measured kind of
 * false target: an alert's or a sheet's content over the title, a
 * navigation bar's own label.
 *
 * Asked by the tap guard's dismissal picker (interact/keyboard-in-tree.ts
 * #pickDismissal). Here, not in soft-keyboard.ts, since 2026-10-07: it is
 * a draw-order question over rects asked of any tree — the keyboard is one
 * more thing that can be drawn over a point, not what the question is about.
 *
 * A screen-sized HOST is not a cover by itself either (2026-10-08,
 * docs/bugs/2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md):
 * a non-structural, non-interactive node WITH children whose area reaches
 * `SCREEN_SIZED_FRACTION` of the screen — the root's rect, the screen the
 * dismissal picker's on-screen check uses, or the tree's largest rect when
 * the root has none (bare-tree.ts's `wrapperBySize` notion). WDA gives a
 * SwiftUI pushed screen's toolbar host as `toolbar 'Toolbar'` with the
 * screen's full frame AFTER the title in pre-order; it draws nothing over
 * the title, yet every `keyboardDismiss` tap on that screen was refused as
 * "covered by toolbar". Its descendants are still walked, so a full-screen
 * host over the point covers through the CONTENT it carries there (a text,
 * a button, a card smaller than the screen). Not exempt, whatever their
 * size: an interactive node (a full-screen `button` backdrop — an RN
 * transparent Modal's Pressable — takes the tap) and a childless one (a
 * full-screen image or text draws itself; a childless `toolbar` is the one
 * exception since 2026-10-09 — ITEMLESS TOOLBAR below). The measured
 * refusals above are kept. Accepted trade-off: a full-screen non-interactive host with nothing
 * of its own at the point (a host whose content sits elsewhere — a
 * full-screen `scrollable` or `webview`, such as an RN ScrollView in a
 * transparent modal whose rows are below the title) reads as not covering,
 * and the dismissal tap lands on it. "Has children" is a weak signal: the
 * measured toolbar's only child is an empty container. What a tap on it
 * then does (corrected in review 2026-10-08): on the guard's path a keyboard
 * that stays, or a target gone after the tap, ends in `AfterDismissalTap`;
 * but a tap that DOES hide the keyboard and also did something of its own
 * (an RN ScrollView with `keyboardShouldPersistTaps="never"` resigning on
 * any touch, a row selection that resigns the keyboard) passes the guard
 * silently — the note says `hidden by tapping <title> before tapping` and
 * the target is tapped after it (interact/keyboard-in-tree.ts, the
 * `hidden` wording). On the post-fill `dismiss()` path a tap that changed
 * the screen and took the keyboard with it is reported as `hiddenBy:
 * tapping <title>` — the same as any dismissal tap whose side effect the
 * band cannot see. iOS dimming views come through as `other` (structural), never a
 * cover before this change, so they are not a new cost.
 *
 * A SCROLL VIEW with content is not a cover by itself either, whatever its
 * size (2026-10-08, the device check of that fix in the same bug note, at
 * e9e6509): with the toolbar host excused, the next node after the title
 * in pre-order — the form's `scrollable 0 0 402 512`, 58 % of the screen,
 * so no host by size — covered the title at (201,84) and the dismissal was
 * refused "covered by scrollable". Its frame runs under the translucent
 * top bar, as an iOS scroll view's does by default (the content inset, not
 * the frame, keeps the rows below the bar); nothing of its content was at
 * the point — the first row started at y 150. The first test was built
 * from an abridged tree in which the later toolbar shadowed the
 * scrollable, so it never asked. The rule: a non-interactive node in
 * `CONTENT_FRAMED_ROLES` (`scrollable` alone — UIScrollView, Table and
 * CollectionView; Android's scroll containers, whose guard has an oracle
 * and never asks this) WITH children covers a point only through its
 * descendants, never through its own frame — the screen-sized-host rule
 * without the size. Why a scroll view and not every container with
 * children — DRAW ORDER, not paint (a scroll view may well paint: the
 * UITableView / UICollectionView behind a SwiftUI List or Form draws the
 * grouped background, an RN ScrollView its `backgroundColor`): an iOS
 * scroll view routinely extends under the bars around it, and WDA lists
 * those bars' content (the navigation title) EARLIER in pre-order although
 * they draw OVER the scroll view, so at such a point the scroll view's own
 * frame is not what the user sees; pre-order alone cannot tell that point
 * from one where the scroll view really is on top, and the scroll view's
 * content is the only part of it that can be judged. Considered and rejected: `webview` under the
 * screen size (a screen-sized one with children is a host already) — it paints
 * its page itself (backgrounds, canvas, images without an accessibility
 * node), its accessibility children are sparse, so its frame IS its
 * surface; `toolbar` under the screen size — the input-accessory bar
 * (48 pt) draws an opaque bar, measured 2026-10-07 (it HAS items:
 * Toolbar → Other → Button "Done", so the itemless-toolbar rule below
 * leaves it covering); and a rule over any
 * non-interactive parent ("judge only by leaves"), which would also drop
 * a smaller card or sheet whose own background is the cover. What still
 * covers: a scrollable's own content at the point (a row's text, a
 * button), so an alert's or a sheet's list whose row text sits over the
 * title is refused as before; a childless scrollable (nothing to judge
 * it by); an interactive node of any role. Accepted trade-off, this rule
 * LOOSENS the guard: a scroll view that really is drawn over the point,
 * with its opaque background and nothing non-structural there — a sheet's
 * table whose row at the title is a bare `Cell` (container, structural:
 * the tap would select that row) or an empty band — reads as not
 * covering, and the dismissal tap lands on it. What then happens is the
 * toolbar trade-off's above: on the guard's path a keyboard that stays (or
 * a target gone) ends in `AfterDismissalTap` (the screen was touched, said
 * so; never a second strategy), while a tap that hides the keyboard AND
 * does something of its own (a row selected, an RN ScrollView with
 * `keyboardShouldPersistTaps="never"`) passes silently: `hidden by tapping
 * <title> before tapping`, then the target is tapped; on the post-fill
 * `dismiss()` path a tap that changed the screen and took the keyboard
 * with it is reported as `hiddenBy: tapping <title>`. Follow-up, deferred
 * (review 2026-10-08) until a device re-run gives the full WDA tree:
 * inside a scroll view any descendant with area at the point — a
 * structural `Cell` included — could count as cover; not done now
 * because a full-frame `Other` wrapper inside the form's collection view
 * that reaches y 84 would re-break the measured case. A residual the
 * other way (unchanged): content scrolled UNDER a translucent bar is
 * after the bar's title in WDA's pre-order, so a row's text that has
 * scrolled up under the title still reads as cover — a false refusal, the
 * safe direction; telling it apart needs the bar's draw order, which the
 * tree does not give.
 *
 * An ITEMLESS TOOLBAR is not a cover, whatever its size (2026-10-09,
 * docs/bugs/2026-10-09-ios-wda-childless-toolbar-refuses-keyboard-
 * dismissal.md): a `toolbar` with NO children. Measured
 * under WDA on the stock Contacts "New Contact" sheet (UIKit, iPhone 17,
 * iOS 27): after the title `text 'New Contact' 149 89 104 22` in
 * pre-order come the form's `scrollable 0 62 402 812` (with children,
 * excused above) and two childless `toolbar 'Toolbar'`s, `0 83 402 48`
 * and `0 62 402 812`; EACH alone contained the title's point (201,100) and
 * refused the configured title dismissal as "covered by toolbar", while
 * the screenshot shows the title with nothing over it — every
 * keyboard-covered tap on that sheet failed. Extending the host rule to
 * childless screen-sized frames would not have fixed it: the 48-pt one is
 * a bar's size, not a host's. The rule is the role's: a toolbar's surface
 * is its ITEMS (WDA lists a bar button, a title, a Done as its
 * descendants, as the accessory bar's), so one listing none is judged to
 * draw nothing at the point (on the measured sheet nothing of either was
 * visible over the title). Narrow on purpose: only
 * `toolbar` (a childless `image`, `text`, `scrollable` or `webview` still
 * draws itself, and a childless screen-sized one still covers), only
 * childless (a toolbar with any child, at any size under the screen,
 * covers as itself — the input-accessory bar measured 2026-10-07 has its
 * Done, and the keyboard's band contains that slot anyway); `toolbar` is
 * not an interactive role (ui-tree/selectors.ts), so no control is
 * excused; a keyboard-owned itemless toolbar (none measured) is excused
 * like any other, the band — which contains the accessory slot — still
 * catching a point there. Earlier passes it cannot reopen: the measured covers
 * this function exists for — an alert's or a sheet's text, a navigation
 * bar's label, a keyboard-owned key or band, a full-screen backdrop
 * `button` — are none of them an itemless toolbar, and the round-2 pin "a
 * childless screen-sized toolbar still covers" was the generic
 * childless-node rule written with a toolbar, not a measured toolbar that
 * covered (no device has shown one). Accepted residual, this rule LOOSENS
 * the guard: a UIToolbar draws its bar background even with no items, so a
 * genuinely opaque itemless toolbar drawn over the dismissal (an app's
 * empty bar laid over the title) reads as not covering and the dismissal
 * tap lands on the bar — it then has no item to trigger, so the likely
 * outcome is a keyboard that stays, on which both paths (the guard's and the
 * post-fill `dismiss()`) end in `AfterDismissalTap` — the screen was
 * touched, and said so; the silent pass of the trade-offs above needs a
 * tap that hides the keyboard, which a bar with no items is not known to
 * do. The one SILENT WRONG ACTION this loosening opens (review 2026-10-09):
 * a bar whose item WDA does not list — a custom view that is not an
 * accessibility element, or one hidden from accessibility — reads as
 * childless, and "childless" is then false evidence: the dismissal tap can
 * TRIGGER that item (Save, Cancel, a sheet's close), and if the keyboard
 * goes with it the guard reports `hidden by tapping <title>` and taps the
 * target on a screen it did not mean to change. Rare — the unlisted item
 * must sit exactly at the dismissal target's centre — but not caught.
 * Platform scope: the `toolbar` role is assigned only by the WDA parser
 * (adapters/wda-source.ts, `Toolbar: 'toolbar'`); a future idb or Android
 * mapping to `toolbar` would inherit this excuse and must be judged
 * against it.
 */
export function shadowing(tree: UiNode, node: UiNode, point: Point): UiNode | undefined {
  const screen = rectArea(tree.rect) > 0 ? rectArea(tree.rect) : Math.max(0, ...[...everyNode(tree)].map((n) => rectArea(n.rect)));
  const coversOnlyThroughContent = (n: UiNode) =>
    n.children.length > 0 && !isInteractive(n) && (CONTENT_FRAMED_ROLES.has(n.role) || rectArea(n.rect) >= screen * SCREEN_SIZED_FRACTION);
  /** A toolbar with no items: nothing of it is what is seen at the point (the UIKit sheet's two, 2026-10-09 — see above). */
  const itemlessToolbar = (n: UiNode) => n.role === 'toolbar' && n.children.length === 0;
  let after = false;
  let over: UiNode | undefined;
  const walk = (n: UiNode): void => {
    if (n === node) {
      after = true; // the node's own subtree is the node
      return;
    }
    if (after && !STRUCTURAL_ROLES.has(n.role) && rectArea(n.rect) > 0 && !coversOnlyThroughContent(n) && !itemlessToolbar(n) && containsPoint(n.rect, point)) over = n;
    for (const child of n.children) walk(child);
  };
  walk(tree);
  return over;
}
