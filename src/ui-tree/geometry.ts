import type { UiNode } from '../adapters/types.js';

/**
 * Geometry questions asked of a normalized UI tree, independent of what the
 * answers are used for. Both parity comparators (rect and color) need the same
 * two: how wide is the screen, and where is each identified element.
 *
 * These live here rather than in verify/ because they walk a `UiNode` and know
 * nothing about contracts, tolerances or findings — the same reason
 * intersectsViewport and tapPoint live in this package.
 */

type Rect = UiNode['rect'];

export interface ScreenWidth {
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
   */
  reliable: boolean;
}

export interface ScreenSize extends ScreenWidth {
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
    // A window contradicted by the layout inside it is not a window we can
    // measure against — say so instead of picking a side. Refusing this way
    // rather than falling back to the walk is deliberate: the walk answers
    // with the same ambiguity minus the axis check that would have caught it
    // (found in review 2026-08-27, where the fallback re-hid hole 1).
    const settled = !overhangs(tree, window);
    return {
      width: window.width,
      height: window.height,
      reliable: settled,
      trustworthyHeight: settled,
    };
  }
  const walked = walkExtent(tree);
  return {
    width: walked.width,
    height: walked.height,
    reliable: walked.startsAtOrigin,
    trustworthyHeight: false,
  };
}

interface Extent {
  width: number;
  height: number;
  /** False when the widest ON-LAYOUT rect starts inset — a CONTENT width. */
  startsAtOrigin: boolean;
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
  let widest: Rect = { x: 0, y: 0, width: 0, height: 0 };
  let tallest: Rect = widest;
  const walk = (n: UiNode): void => {
    if (onLayout(n.rect)) {
      if (n.rect.x + n.rect.width > widest.x + widest.width) widest = n.rect;
      if (n.rect.y + n.rect.height > tallest.y + tallest.height) tallest = n.rect;
    }
    n.children.forEach(walk);
  };
  walk(tree);
  return {
    width: widest.x + widest.width,
    height: tallest.y + tallest.height,
    startsAtOrigin: Math.abs(widest.x) < ORIGIN_SLACK,
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
 * multi-root dump are normalized under a synthetic 0x0 root (adapters/ios.ts,
 * adapters/android.ts), and WDA's live /source roots a sheet tree in a node
 * carrying no `rect` at all, which the parser zero-fills — in all three the
 * real window sits among the children (measured 2026-08-26: the iOS filter
 * sheet's `Application "Skeleton Internal"` at {0,0,402,874}).
 *
 * A child must be SCREEN-SHAPED to qualify, which is what keeps a status bar
 * and a tall scroll container out of the running. Among what is left the
 * WIDEST wins, ties break on height: a too-large candidate stays visible to
 * the axis check in verify/scale.ts, which fails closed on it, where silently
 * preferring a narrower sibling would scale by a content width. The root
 * itself skips both tests — it is the window by construction, and an oversized
 * child inside it is exactly what must NOT be asked about.
 */
function windowRect(tree: UiNode): Rect | undefined {
  if (isWindow(tree.rect)) return tree.rect;
  if (tree.rect.width > 0 && tree.rect.height > 0) return undefined;
  const candidates = tree.children.map((c) => c.rect).filter((r) => isWindow(r) && isScreenShaped(r));
  if (candidates.length === 0) return undefined;
  return candidates.reduce((champion, r) =>
    r.width > champion.width || (r.width === champion.width && r.height > champion.height) ? r : champion,
  );
}

/** Screen width alone, for the callers that never touch a screenshot. */
export function inferScreenWidth(tree: UiNode): ScreenWidth {
  const { width, reliable } = inferScreenSize(tree);
  return { width, reliable };
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
