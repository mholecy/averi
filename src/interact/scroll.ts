import type { DeviceAdapter, Rect, SoftKeyboard, UiNode } from '../adapters/types.js';
import { readTreeOrError } from '../ui-tree/read-tree.js';
import { clippedEdges, visibleFractionInViewport } from '../ui-tree/geometry.js';
import { cannotHide, partOfKeyboard, readSoftKeyboard, type KeyboardRemedy } from '../ui-tree/soft-keyboard.js';
import { sleep } from '../util/sleep.js';
import { frameText, keyboardUnlocated, UNLOCATED_KEYBOARD } from './keyboard.js';
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
  /** Fraction of the element's area inside the viewport at the stop (0..1) — the screen above the soft keyboard when `keyboard` is shown. */
  visible: number;
  /** Viewport edges the element still extends past, [] when fully revealed — `bottom` is the keyboard's top edge when `keyboard` is shown. */
  clipped: ('top' | 'bottom' | 'left' | 'right')[];
  /**
   * The soft keyboard at the stop, when it changed what the result means
   * (2026-10-08) — absent when none was read, so a run without a keyboard
   * reports what it always did:
   * - `shown`: the stop was judged against the screen ABOVE `frame`, not the
   *   whole screen — the part under it is not visible, whatever the tree
   *   says (docs/bugs/2026-10-08-scroll-until-ignores-android-soft-keyboard.md);
   * - `unlocated`: the window model's floating-keyboard row — the input
   *   method says one is shown, the window state gives it no area — so
   *   nothing could be judged against it and the report says so
   *   (keyboard.ts#keyboardUnlocated).
   */
  keyboard?: { state: 'shown'; frame: Rect } | { state: 'unlocated' };
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
function describeClip(edges: readonly string[], visible: number, band?: Rect): string {
  // Never round a clipped element up to a reassuring 100%: the whole point of
  // the line is that something is missing.
  const pct = Math.min(Math.round(visible * 100), 99);
  const where = band === undefined ? 'the viewport' : `the viewport above the soft keyboard over ${frameText(band)}`;
  return `CLIPPED at ${edges.join('/')}, ${pct}% of it is in ${where}`;
}

/** The honest one-line summary both call sites print. */
export function describeScrollResult(r: ScrollUntilResult): string {
  const n = `${r.swipes} swipe${r.swipes === 1 ? '' : 's'}`;
  const band = r.keyboard?.state === 'shown' ? r.keyboard.frame : undefined;
  const unlocated = r.keyboard?.state === 'unlocated' ? `; ${UNLOCATED_KEYBOARD} — it was not judged and may cover the element` : '';
  if (r.clipped.length === 0) {
    return `fully visible after ${n}${band === undefined ? '' : `, above the soft keyboard over ${frameText(band)}`}${unlocated}`;
  }
  return (
    `visible after ${n} — ${describeClip(r.clipped, r.visible, band)}` +
    '. A rect assert or screenshot on this element will measure the CLIPPED box' +
    unlocated
  );
}

/**
 * How to judge the whole screen again — the scroll's own sentence, by what
 * the adapter can hide a keyboard with (`KeyboardRemedy`, the reading's).
 * Its own, not the pixel poll's or the guard's: before a scroll the useful
 * advice is to hide the keyboard and scroll again. Names MCP tools and "a
 * flow", the deliberate exception recorded in keyboard-window.ts.
 */
function hideToJudgeWholeScreen({ dismissal, advice }: KeyboardRemedy): string {
  return dismissal === 'back'
    ? 'to reach it with the keyboard down, hide it first (press_key back from the MCP tools; `dismissKeyboard: true` on the fill before this step in a flow) and scroll again'
    : 'to reach it with the keyboard down, hide it first (tap a neutral element such as the screen title — a tap: step in a flow) and scroll again; ' +
        cannotHide(advice);
}

/**
 * The part of the screen a shown soft keyboard leaves — everything above its
 * top edge, full width (2026-10-08). The one frame the stop judges against
 * and the stroke is drawn in while it is up. Above the TOP edge, not around
 * the band: a docked keyboard (the only kind measured, Android IME
 * [0,1398][1080,2220], WDA band from y 539/589 of 874) runs to the bottom,
 * so the two are the same; a band that does not (an iPad split or floating
 * keyboard, unmeasured) costs content below it, which can only make the
 * scroll swipe more or fail naming the keyboard — never report as visible
 * what is under it. A band from the top edge leaves nothing above it:
 * undefined, judged as before (unmeasured; no real keyboard has been read
 * there).
 */
function aboveKeyboard<T extends { width: number; height: number }>(box: T, band: Rect): T | undefined {
  if (band.y <= 0) return undefined;
  return { ...box, height: Math.min(box.height, band.y) };
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
 *
 * The soft keyboard (2026-10-08,
 * docs/bugs/2026-10-08-scroll-until-ignores-android-soft-keyboard.md):
 * measured on Android, an element wholly under the IME was "fully visible
 * after 0 swipes", and with the IME up a content-down stroke — through the
 * screen centre, its start at y ≈ 1776 of 2220 — began on a key and scrolled
 * nothing for 15 s; the same on iOS 27 with the pad up (y ≈ 699 of 874). So
 * every round reads the keyboard the way the tap guard and the pixel poll do
 * — `readSoftKeyboard` on the round's tree (the oracle's `state()` on
 * Android, one query a round; the WDA band on iOS, no device read) — and
 * while one is shown, both the judgement and the stroke use the screen
 * ABOVE it (`aboveKeyboard`): an element under it scores 0 or is clipped at
 * the keyboard's edge, and the stroke is the same `swipeVector` over that
 * smaller box, so it starts on the content. The keyboard's own nodes (a key
 * as the target) are judged against the whole screen, as `readSoftKeyboard`
 * reads them `unknown` for a subject. `hidden`, `unknown`, an unread tree:
 * the whole screen, as before — the guard's fail-open rule. What the stop
 * saw is on the result (`keyboard`), and every failure after a round that
 * saw one says so, with how to hide it.
 *
 * Chosen over hiding the keyboard first (the other direction the note
 * offered): that is a `back` on Android — witness-vetoed, but on its
 * `unknown → back` row a navigation whenever the adapter is wrong — and on
 * iOS a configured tap or a refusal, for a step that sent no key before;
 * the guard rejected the same trade for every tap (keyboard.ts). Scrolling
 * above the keyboard needs no side effect and still reaches the element:
 * the stroke moves it up out from under the band. What it cannot do — the
 * last rows of a container that does not resize for the keyboard stay under
 * it at the end of the content — is a `fully: true` failure that names the
 * keyboard and the way to hide it, not a "fully visible".
 *
 * The floating keyboard (docs/bugs/2026-10-05-android-floating-gboard-
 * keyboard.md, inferred): a window reading `hidden` at the stop is checked
 * once against the input method (`keyboardUnlocated`, one witness query per
 * call, never per round); when it says shown, the report says the keyboard
 * could not be placed, success or failure. Nothing is judged against it —
 * there is no frame — and nothing is pressed.
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
  /** The last keyboard frame any round saw shown, and what the adapter can do about it — for the failure text. */
  let seen: { band: Rect; remedy: KeyboardRemedy } | undefined;
  /** At the stop only: the floating row, asked of the stop round's window reading (one witness query, and only when it read hidden). */
  const unlocatedAt = async (round: SoftKeyboard | undefined): Promise<boolean> => round !== undefined && (await keyboardUnlocated(adapter, round));
  for (let swipes = 0; ; swipes++) {
    // A failed read is a miss, not a failure — see readTreeOrError.
    const read = await readTreeOrError(adapter);
    const { tree, error } = read;
    lastReadError = error;
    if (tree !== undefined) treesRead++;
    lastFound = tree === undefined ? [] : findTarget(tree, target);
    if (lastFound.length > 0) everFound = true;
    // The keyboard this round, off this round's tree (no subject: every match
    // is judged against it, the keyboard's own exempted below). An unread
    // tree reads no keyboard — the round is a miss anyway, and its stroke
    // uses the whole screen, as every stroke did before.
    const reading = tree === undefined ? undefined : await readSoftKeyboard(adapter, tree);
    const band = reading?.keyboard.state === 'shown' ? reading.keyboard.frame : undefined;
    const uncovered = band === undefined ? undefined : aboveKeyboard(viewport, band);
    if (reading !== undefined && band !== undefined && uncovered !== undefined) seen = { band, remedy: reading };
    /** The frame this match is judged against: above the keyboard, unless it IS the keyboard's. */
    const frameFor = (node: UiNode) => (uncovered === undefined || (tree !== undefined && partOfKeyboard(tree, node)) ? viewport : uncovered);
    /** The band the match was judged under, for the wording — none for a keyboard-side node or a whole-screen judgement. */
    const bandFor = (node: UiNode) => (frameFor(node) === viewport ? undefined : band);
    // Judge the MOST revealed candidate, not the first: an id can sit on a
    // container and its child, and reporting the clipped one of the two would
    // invent a defect.
    const best = lastFound
      .map((node) => ({ node, visible: visibleFractionInViewport(node.rect, frameFor(node)) }))
      .sort((a, b) => b.visible - a.visible)[0];
    if (best !== undefined && best.visible > 0) {
      const frame = frameFor(best.node);
      const judgedUnder = bandFor(best.node);
      const clipped = clippedEdges(best.node.rect, frame);
      if (!fully || clipped.length === 0) {
        const keyboard: ScrollUntilResult['keyboard'] =
          judgedUnder !== undefined
            ? { state: 'shown', frame: judgedUnder }
            : (await unlocatedAt(reading?.keyboard))
              ? { state: 'unlocated' }
              : undefined;
        return { swipes, visible: best.visible, clipped, ...(keyboard !== undefined && { keyboard }) };
      }
      // fully: true and still clipped — only a swipe that MOVES it can help.
      const stuck = prevRect !== undefined && rectsEqual(prevRect, best.node.rect);
      prevRect = { ...best.node.rect };
      if (stuck) {
        const n = `${swipes} swipe${swipes === 1 ? '' : 's'}`;
        // Clipped at the keyboard's edge at the end of the content: the
        // keyboard, not the layout, is what hides the rest — a container that
        // does not resize for it keeps its last rows under it. Said as such,
        // with how to hide it; the layout-defect wording only when the
        // keyboard is not the edge in question.
        if (judgedUnder !== undefined && reading !== undefined && clipped.includes('bottom')) {
          throw new Error(
            `scroll_until ${describe} failed after ${n} — element is in the viewport but ` +
              `${describeClip(clipped, best.visible, judgedUnder)}, and the content is exhausted: swiping ${direction} ` +
              `no longer moves it. The soft keyboard covers the rest — ${hideToJudgeWholeScreen(reading)}; only if it ` +
              `stays clipped with the keyboard down is it a layout defect. ` +
              `Last rect ${JSON.stringify(best.node.rect)} in a ${viewport.width}x${viewport.height} viewport`,
          );
        }
        throw new Error(
          `scroll_until ${describe} failed after ${n} — ` +
            `element is in the viewport but ${describeClip(clipped, best.visible, judgedUnder)}, ` +
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
            `${describeClip(clippedEdges(best.node.rect, frameFor(best.node)), best.visible, bandFor(best.node))} ` +
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
      // The keyboard, when any round saw one: the reader must not take a
      // scroll that worked around it — or one it hid the element under — for
      // a wrong selector (the bug note's 15 s "never appeared"). And the
      // floating row, asked once, when the last round's window read hidden.
      const keyboard =
        seen !== undefined
          ? `. The soft keyboard was up over ${frameText(seen.band)}: visibility was judged, and the swipes drawn, ` +
            `in the screen above it — ${hideToJudgeWholeScreen(seen.remedy)}`
          : (await unlocatedAt(reading?.keyboard))
            ? `; ${UNLOCATED_KEYBOARD} — the swipes may have landed on it; hide or dock it and scroll again`
            : '';
      const message = `scroll_until ${describe} failed ${cause} — ${why}${keyboard}`;
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
    // other way (content below → finger up). See swipeVector. With a
    // keyboard shown (2026-10-08) the box is cut to the part above it, so
    // the stroke starts on the content, not on a key.
    const { box } = await screenBox(adapter, read);
    const strokeBox = band === undefined ? box : (aboveKeyboard(box, band) ?? box);
    const { from, to } = swipeVector(strokeBox, direction, 'content');
    await adapter.swipe(from, to);
    await sleep(settleMs);
  }
}

const rectsEqual = (a: Rect, b: Rect): boolean =>
  Math.abs(a.x - b.x) < 1 &&
  Math.abs(a.y - b.y) < 1 &&
  Math.abs(a.width - b.width) < 1 &&
  Math.abs(a.height - b.height) < 1;
