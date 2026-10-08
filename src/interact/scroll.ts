import type { DeviceAdapter, Rect, UiNode } from '../adapters/types.js';
import { readTreeOrError } from '../ui-tree/read-tree.js';
import { clippedEdges, visibleFractionInViewport } from '../ui-tree/geometry.js';
import { sleep } from '../util/sleep.js';
import { absenceError, describeTarget, findTarget, type Target } from './resolve.js';
import { screenBox, swipeVector, type Direction } from './swipe.js';

/** The scroll's budget when the caller has none — the MCP scroll_until tool's documented default is derived from it. */
export const DEFAULT_SCROLL_TIMEOUT_MS = 15_000;

/** The swipe bound when the caller has none — the MCP scroll_until tool's documented default is derived from it too. */
export const DEFAULT_MAX_SWIPES = 6;

export interface ScrollOptions {
  /** Where the CONTENT lies relative to the current view (down = below the fold → finger swipes up). Default down. */
  direction?: Direction;
  /** Default DEFAULT_MAX_SWIPES. */
  maxSwipes?: number;
  /** Require the element ENTIRELY inside the viewport, not merely overlapping it. Default false. */
  fully?: boolean;
  /** Default DEFAULT_SCROLL_TIMEOUT_MS. The flow engine converts its `timeout: 2s` before calling. */
  timeoutMs?: number;
  /** Pause after each swipe before the next read. Default 400. */
  settleMs?: number;
}

/**
 * What the scroll actually achieved — not just how many swipes it took.
 *
 * `swipes` alone was the old return, and it made the tool unable to tell the
 * truth: the stop condition is INTERSECTION, so a row clipped at the viewport
 * edge stops the loop and used to be reported as a bare "visible". The caller's
 * very next step is normally an assert or a screenshot on that rect, i.e. the
 * one operation a clipped rect silently corrupts.
 */
export interface ScrollUntilResult {
  swipes: number;
  /** Fraction of the element's area inside the viewport at the stop (0..1). */
  visible: number;
  /** Viewport edges the element still extends past, [] when fully revealed. */
  clipped: ('top' | 'bottom' | 'left' | 'right')[];
}

/**
 * Deliberately NOT on ScrollUntilResult: whether the content is exhausted.
 * Only the `fully` path can learn it, by spending a swipe and seeing the rect
 * not move — and on that path the answer is always "yes, and here is the
 * throw". A returned result would therefore carry a constitutionally `false`
 * field. Establishing it on the default path would cost every caller an extra
 * swipe past a stop they already accepted, which is a worse trade than the
 * clipped fraction already reported here.
 */

/**
 * How much of an element is on screen, in the terms the caller's next call
 * cares about. Takes the already-computed edges rather than a rect and a
 * viewport, so every site that has judged an element once can describe it
 * without judging it again — including `describeScrollResult`, which holds a
 * result and no rect at all.
 */
function describeClip(edges: readonly string[], visible: number): string {
  // Never round a clipped element up to a reassuring 100%: the whole point of
  // the line is that something is missing.
  const pct = Math.min(Math.round(visible * 100), 99);
  return `CLIPPED at ${edges.join('/')}, ${pct}% of it is in the viewport`;
}

/** The honest one-line summary both call sites print. */
export function describeScrollResult(r: ScrollUntilResult): string {
  const n = `${r.swipes} swipe${r.swipes === 1 ? '' : 's'}`;
  if (r.clipped.length === 0) return `fully visible after ${n}`;
  return (
    `visible after ${n} — ${describeClip(r.clipped, r.visible)}` +
    '. A rect assert or screenshot on this element will measure the CLIPPED box'
  );
}

/**
 * Swipe until the element is present AND visibly inside the viewport
 * (ARCHITECTURE.md §4, C1). Throws with a diagnosis of the last tree.
 *
 * `fully: true` raises the bar from "intersects" to "entirely inside", and
 * keeps swiping until it is — then fails naming the shortfall when the content
 * runs out first. That failure message IS the app bug in the measured case:
 * a scroll container with no clearance for the floating bottom-nav bar can
 * never fully reveal its last row, however far it scrolls. Default stays
 * `false`: the stop condition is unchanged, only the REPORT gains the truth.
 *
 * Every match is judged, not only the actionable one: an id can sit on a
 * container and its child, and the MOST revealed of the two is the honest
 * report, so this loop does not go through resolveNow. It keeps its own loop
 * on readTreeOrError rather than pollTree because it ACTS between reads (a
 * swipe, then a settle pause) and has a second stop bound (maxSwipes); the
 * read-failure rule is the same — a failed read is a miss, the last error is
 * quoted at the stop.
 *
 * The one stop that is absence — no read, at any swipe, held a match, and
 * the last read succeeded — throws ElementNotFoundError (2026-10-08; the
 * rule's one owner is resolve.ts's absenceError) with the same "element
 * never appeared in the tree" wording,
 * so an `optional:` scroll_until to an element that is not on this screen
 * is skipped "(not present)" like a tap or a fill would be. Every other stop
 * (found but clipped or off the viewport, a failed last read, content that
 * ran out) stays a plain Error: the element was there, or nobody could see.
 */
export async function scrollUntilVisible(
  adapter: DeviceAdapter,
  target: Target,
  opts: ScrollOptions = {},
): Promise<ScrollUntilResult> {
  const direction = opts.direction ?? 'down';
  const maxSwipes = opts.maxSwipes ?? DEFAULT_MAX_SWIPES;
  const fully = opts.fully === true;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SCROLL_TIMEOUT_MS;
  const settleMs = opts.settleMs ?? 400;
  const describe = describeTarget(target);
  // The visibility reference frame: read before the loop, so a device whose
  // screen cannot be read fails here rather than as "never intersected".
  const viewport = await adapter.viewport();

  const deadline = Date.now() + timeoutMs;
  let lastFound: UiNode[] = [];
  let everFound = false;
  let treesRead = 0;
  let lastReadError: Error | undefined;
  // The best candidate seen so far, and whether the last swipe moved it. A
  // swipe that does not move the element is the only honest signal that the
  // container has nothing left to scroll — distinguishing "give it another
  // swipe" from "this element CANNOT be fully revealed", which is a real
  // layout defect rather than an impatient loop.
  let prevRect: Rect | undefined;
  for (let swipes = 0; ; swipes++) {
    // A failed read is a miss, not a failure — see readTreeOrError.
    const read = await readTreeOrError(adapter);
    const { tree, error } = read;
    lastReadError = error;
    if (tree !== undefined) treesRead++;
    lastFound = tree === undefined ? [] : findTarget(tree, target);
    if (lastFound.length > 0) everFound = true;
    // Judge the MOST revealed candidate, not the first: an id can sit on a
    // container and its child, and reporting the clipped one of the two would
    // invent a defect.
    const best = lastFound
      .map((node) => ({ node, visible: visibleFractionInViewport(node.rect, viewport) }))
      .sort((a, b) => b.visible - a.visible)[0];
    if (best !== undefined && best.visible > 0) {
      const clipped = clippedEdges(best.node.rect, viewport);
      if (!fully || clipped.length === 0) {
        return { swipes, visible: best.visible, clipped };
      }
      // fully: true and still clipped — only a swipe that MOVES it can help.
      const stuck = prevRect !== undefined && rectsEqual(prevRect, best.node.rect);
      prevRect = { ...best.node.rect };
      if (stuck) {
        throw new Error(
          `scroll_until ${describe} failed after ${swipes} swipe${swipes === 1 ? '' : 's'} — ` +
            `element is in the viewport but ${describeClip(clipped, best.visible)}, ` +
            `and the content is exhausted: swiping ${direction} no longer moves it. ` +
            `The element cannot be fully revealed — that is a layout defect ` +
            `(no clearance for an overlay?), not a scroll that needs more swipes. ` +
            `Last rect ${JSON.stringify(best.node.rect)} in a ${viewport.width}x${viewport.height} viewport`,
        );
      }
    }
    if (swipes >= maxSwipes || Date.now() >= deadline) {
      const partial =
        best !== undefined && best.visible > 0
          ? `element reached the viewport but stayed ` +
            `${describeClip(clippedEdges(best.node.rect, viewport), best.visible)} ` +
            `(last rect ${JSON.stringify(best.node.rect)})`
          : undefined;
      const why =
        lastReadError !== undefined
          ? `last UI tree read failed: ${lastReadError.message}`
          : partial !== undefined
            ? partial
            : lastFound.length === 0
              ? 'element never appeared in the tree'
              : `element in tree but never intersected the ${viewport.width}x${viewport.height} viewport ` +
                `(last rect ${JSON.stringify(lastFound[0].rect)})`;
      const cause = swipes >= maxSwipes ? `after ${swipes} swipes (maxSwipes)` : `after ${timeoutMs}ms (timeout)`;
      const message = `scroll_until ${describe} failed ${cause} — ${why}`;
      throw absenceError(message, { sighted: everFound, treesRead, readError: lastReadError });
    }
    // The gesture's box is swipe.ts#screenBox's — the same owner as a
    // `swipe:` step's, oriented by this round's tree (after a failed read:
    // the device box as built; its note is not reported here, the stop
    // already quotes the read error). Worked out per swipe because the
    // round's tree is the witness; the device size is memoized. A 0×0
    // viewport does not throw above (pre-existing): the stroke then falls
    // back to the tree's window while the stop still judges against 0×0.
    // `direction` here names where the CONTENT lies — the finger moves the
    // other way (content below → finger up). See swipeVector.
    const { from, to } = swipeVector((await screenBox(adapter, read)).box, direction, 'content');
    await adapter.swipe(from, to);
    await sleep(settleMs);
  }
}

const rectsEqual = (a: Rect, b: Rect): boolean =>
  Math.abs(a.x - b.x) < 1 &&
  Math.abs(a.y - b.y) < 1 &&
  Math.abs(a.width - b.width) < 1 &&
  Math.abs(a.height - b.height) < 1;
