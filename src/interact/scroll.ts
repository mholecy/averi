import type { DeviceAdapter, Rect, SoftKeyboard, UiNode } from '../adapters/types.js';
import { readTreeOrError, type TreeRead } from '../ui-tree/read-tree.js';
import { clippedEdges, visibleFractionInViewport } from '../ui-tree/geometry.js';
import { cannotHide, keyboardSideNodes, readSoftKeyboard, type KeyboardRemedy, type SoftKeyboardReading } from '../ui-tree/soft-keyboard.js';
import { sleep } from '../util/sleep.js';
import { keyboardCorroborated, keyboardUnlocated, UNLOCATED_KEYBOARD } from './keyboard.js';
import { frameText } from './keyboard-model.js';
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
  clipped: Edge[];
  /**
   * The soft keyboard at the stop, when it changed what the result means
   * (2026-10-08) — absent when none was read, so a run without a keyboard
   * reports what it always did:
   * - `shown`: the stop was judged against the screen ABOVE `frame`, not the
   *   whole screen, and that changed it — the part under it is not visible,
   *   whatever the tree says
   *   (docs/bugs/2026-10-08-scroll-until-ignores-android-soft-keyboard.md).
   *   Only where the band changed the stop: a clip at its edge, or — when
   *   several nodes match — a different match judged (one under the band
   *   loses to one above it), which can be a clean "fully visible" (round 3
   *   of the review, 2026-10-08); a band that changes nothing is not applied;
   * - `unlocated`: the window model's floating-keyboard row — the input
   *   method says one is shown, the window state gives it no area — so
   *   nothing could be judged against it and the report says so
   *   (keyboard.ts#keyboardUnlocated). Only on a clean `fully: true` stop.
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
  // `shown` comes where the band changed the stop — a clip at its edge, or a
  // different match judged, which can be clean; `unlocated` only with a
  // clean `fully: true` stop (scrollUntilVisible).
  const band = r.keyboard?.state === 'shown' ? r.keyboard.frame : undefined;
  if (r.clipped.length === 0) {
    const above = band === undefined ? '' : `, judged above the soft keyboard over ${frameText(band)}`;
    const unlocated = r.keyboard?.state === 'unlocated' ? `; ${UNLOCATED_KEYBOARD} — it was not judged and may cover the element` : '';
    return `fully visible after ${n}${above}${unlocated}`;
  }
  return (
    `visible after ${n} — ${describeClip(r.clipped, r.visible, band)}` +
    '. A rect assert or screenshot on this element will measure the CLIPPED box'
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

type Edge = 'top' | 'bottom' | 'left' | 'right';
type Box = { width: number; height: number };

/**
 * A shown soft keyboard as the round may apply it (2026-10-08): its frame,
 * the part of the screen it leaves — everything above its TOP edge, full
 * width — and what the adapter can do about it. Above the top edge, not
 * around the band: a docked keyboard (the only kind measured, Android IME
 * [0,1398][1080,2220], WDA band from y 539/589 of 874) runs to the bottom,
 * so the two are the same; a band that does not (an iPad split or floating
 * keyboard, unmeasured) costs content below it, which can only make the
 * scroll swipe more or fail naming the keyboard — never report as visible
 * what is under it. `above` undefined: the band starts at or above y 0 and
 * leaves nothing (a full-screen extract-mode IME, unmeasured).
 */
interface Cover {
  band: Rect;
  above: Box | undefined;
  remedy: KeyboardRemedy;
}

/** The cover a reading offers, or none: not shown, or a band whose top lies at or below the screen's bottom (it covers nothing on it). */
function coverOf(reading: SoftKeyboardReading | undefined, viewport: Box): Cover | undefined {
  if (reading?.keyboard.state !== 'shown') return undefined;
  const band = reading.keyboard.frame;
  if (band.y >= viewport.height) return undefined;
  return { band, above: band.y <= 0 ? undefined : { width: viewport.width, height: band.y }, remedy: reading };
}

/** One match as judged: how much of it is in the frame, the frame's edges it extends past, and the cover it was judged under (none for a whole-screen judgement or a keyboard-side node). */
interface Judged {
  node: UiNode;
  visible: number;
  clipped: Edge[];
  under?: Cover;
}

/**
 * The MOST revealed match, not the first: an id can sit on a container and
 * its child, and reporting the clipped one of the two would invent a defect.
 * Under a cover, a keyboard-side node (`keyboardSideNodes`, the set
 * `partOfKeyboard` answers from, built once per round) is judged against
 * the whole screen; every other node against the part above the band, or
 * scores 0 when the band leaves none.
 */
function judge(found: readonly UiNode[], viewport: Box, cover?: { cover: Cover; keyboardSide: ReadonlySet<UiNode> }): Judged | undefined {
  const scored = found.map((node): Judged => {
    if (cover === undefined || cover.keyboardSide.has(node)) {
      return { node, visible: visibleFractionInViewport(node.rect, viewport), clipped: clippedEdges(node.rect, viewport) };
    }
    const { above } = cover.cover;
    if (above === undefined) return { node, visible: 0, clipped: [], under: cover.cover };
    return { node, visible: visibleFractionInViewport(node.rect, above), clipped: clippedEdges(node.rect, above), under: cover.cover };
  });
  return scored.sort((a, b) => b.visible - a.visible)[0];
}

/** Would this judgement end the round cleanly — a stop, no stroke, no failure? */
const endsClean = (j: Judged | undefined, fully: boolean): boolean => j !== undefined && j.visible > 0 && (!fully || j.clipped.length === 0);

/**
 * The two judgements say the same thing about the same node. `clipped` is
 * not compared: the box above a band lies inside the viewport, so the same
 * node scoring the same fraction against both has no area between the
 * band's top and the screen's bottom, and its edges agree (review round 1,
 * 2026-10-08: the comparison was dead — a mutation dropping it survived).
 */
const sameJudgement = (a: Judged | undefined, b: Judged | undefined): boolean =>
  a === undefined || b === undefined ? a === b : a.node === b.node && a.visible === b.visible;

/** What the stop judged against, for "never intersected …". */
const frameWords = (viewport: Box, cover: Cover | undefined): string =>
  cover?.above === undefined
    ? `${viewport.width}x${viewport.height} viewport`
    : `${cover.above.width}x${cover.above.height} screen above the soft keyboard over ${frameText(cover.band)}`;

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
 * judges the round twice, over the whole screen and over the screen ABOVE a
 * shown keyboard (`coverOf`): an element under it scores 0 or is clipped at
 * the keyboard's edge, and the stroke is the same `swipeVector` over that
 * smaller box, so it starts on the content. The keyboard's own nodes (a key
 * as the target) are judged against the whole screen, as `readSoftKeyboard`
 * reads them `unknown` for a subject. `hidden`, `unknown`: the whole screen,
 * as before — the guard's fail-open rule; an unread tree strokes in the box
 * the last read round's band left (review 2026-10-08), the stop already
 * quoting the read error. Landscape: since 2026-10-08 the judgement, the
 * band's `above` box and the stroke all use the round's `screenBox` box —
 * turned when the tree's window says so — the screen the tap's on-screen
 * rule judges too (resolve.ts#tapScreen); the band's frame is the oracle's
 * or the tree's, in the tree's coordinates already. Unmeasured on a device
 * held sideways.
 *
 * The band is APPLIED only when it changes the round — the two judgements
 * differ, or the round ends in a stroke or a failure rather than a clean
 * stop — and only once the input method has not denied it
 * (`keyboardCorroborated`: the guard's veto, its one owner in
 * keyboard-window.ts). Review 2026-10-08: the window state was measured
 * stale for seconds after a navigating tap, and a phantom band would score
 * an on-screen target 0, send a stroke through the next screen and report
 * a keyboard that is gone. The witness is asked on EVERY round a band
 * matters and its answer is not kept (review 2026-10-08, two rounds): a
 * stale window on round 0 can be followed by a real keyboard — a new
 * screen that auto-focuses a field — and a confirmed keyboard can be hidden
 * by the scroll itself (a list that dismisses it on drag) and leave the
 * window state stale-shown behind it. At most one query a round, the
 * rounds bounded by `maxSwipes` (what one costs: AndroidAdapter's
 * keyboardWitness); none on iOS, whose band is read off the tree being
 * judged. A failed or `fully: true` stop may add one more, the floating
 * row's (below). A band that does not change the round is not reported
 * either: the result carries `keyboard: shown` only when the stop was
 * judged under one this round — a clip at its edge, or another of several
 * matches judged. The witness is no longer remembered, so one that times
 * out costs its timeout (KEYBOARD_WITNESS_TIMEOUT_MS in adapters/android.ts,
 * 2 s) on each round where the band matters; the deadline is checked once
 * a round, after it, so the last round can run past `timeoutMs` by that
 * wait on top of its reads. A band that leaves nothing above
 * it (its top at y ≤ 0 — a full-screen extract-mode IME, unmeasured) scores
 * every non-keyboard node 0 and fails at once, no stroke, naming it.
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
 * keyboard.md, inferred): on a failed stop, and on a `fully: true` stop —
 * where the answer changes what the reader does next — a window reading
 * `hidden` is checked once against the input method (`keyboardUnlocated`);
 * when it says shown, the report says the keyboard could not be placed.
 * Nothing is judged against it — there is no frame — and nothing is
 * pressed. Not on a default clean stop (review 2026-10-08: a witness query
 * on every one buys a sentence nobody acts on).
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
  // The device's screen, read before the loop, so a device whose screen
  // cannot be read fails here rather than as "never intersected".
  const asBuilt = await adapter.viewport();
  // The visibility reference frame (2026-10-08, review of the off-screen tap
  // refusal, M2): the box `screenBox` gives this round's tree — the tap's
  // screen owner (resolve.ts#tapScreen), so a stop the scroll calls visible
  // is judged on the screen the next tap is judged on, turned in landscape
  // as the stroke already was. Until then it was `viewport()` as built: in
  // landscape a button at y 500 of a 874x402 window was "fully visible" on
  // a 402x874 panel and the tap after it refused. A round whose tree did
  // not read keeps the last frame; a box screenBox cannot give (a 0×0
  // device and no window) is the device as built, as before.
  let viewport: Box = asBuilt;
  const frameOf = async (read: TreeRead): Promise<Box> => {
    try {
      return (await screenBox(adapter, read)).box;
    } catch {
      return asBuilt;
    }
  };

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
  /** The last cover any round applied, and how many rounds applied one — for the failure text. */
  let lastCover: Cover | undefined;
  let coveredRounds = 0;
  /** The cover the last round whose tree READ applied — undefined when that round applied none — for the stroke of a round whose tree did not read. */
  let lastReadCover: Cover | undefined;
  /** On a failed or `fully: true` stop only: the floating row, asked of the stop round's window reading (one witness query, and only when it read hidden). */
  const unlocatedAt = async (round: SoftKeyboard | undefined): Promise<boolean> => round !== undefined && (await keyboardUnlocated(adapter, round));
  for (let swipes = 0; ; swipes++) {
    // A failed read is a miss, not a failure — see readTreeOrError.
    const read = await readTreeOrError(adapter);
    const { tree, error } = read;
    lastReadError = error;
    if (tree !== undefined) {
      treesRead++;
      viewport = await frameOf(read);
    }
    lastFound = tree === undefined ? [] : findTarget(tree, target);
    if (lastFound.length > 0) everFound = true;
    // The keyboard this round, off this round's tree (no subject: every match
    // is judged against it, the keyboard's own exempted in `judge`).
    const reading = tree === undefined ? undefined : await readSoftKeyboard(adapter, tree);
    const offered = coverOf(reading, viewport);
    const whole = judge(lastFound, viewport);
    let cover: Cover | undefined;
    let best = whole;
    if (offered !== undefined && tree !== undefined) {
      const covered = judge(lastFound, viewport, { cover: offered, keyboardSide: keyboardSideNodes(tree) });
      // Moot: the round stops cleanly either way, on the same judgement — the
      // band changes nothing, and is neither asked about nor reported.
      // Otherwise the witness is asked THIS round, never remembered: a
      // scroll can hide a keyboard (a list that dismisses it on drag) and
      // leave the window state stale-shown behind it (review 2026-10-08).
      const moot = endsClean(whole, fully) && sameJudgement(whole, covered);
      if (!moot && (await keyboardCorroborated(adapter))) {
        cover = offered;
        best = covered;
      }
    }
    if (cover !== undefined) {
      lastCover = cover;
      coveredRounds++;
    }
    if (tree !== undefined) lastReadCover = cover;
    if (best !== undefined && best.visible > 0) {
      if (!fully || best.clipped.length === 0) {
        // Shown only when THIS stop was judged under a band the witness stood
        // by this round — never a band checked on an earlier round.
        const keyboard: ScrollUntilResult['keyboard'] =
          best.under !== undefined
            ? { state: 'shown', frame: best.under.band }
            : fully && (await unlocatedAt(reading?.keyboard))
              ? { state: 'unlocated' }
              : undefined;
        return { swipes, visible: best.visible, clipped: best.clipped, ...(keyboard !== undefined && { keyboard }) };
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
        if (best.under !== undefined && best.clipped.includes('bottom')) {
          throw new Error(
            `scroll_until ${describe} failed after ${n} — element is in the viewport but ` +
              `${describeClip(best.clipped, best.visible, best.under.band)}, and the content is exhausted: swiping ${direction} ` +
              `no longer moves it. The soft keyboard covers the rest — ${hideToJudgeWholeScreen(best.under.remedy)}; only if it ` +
              `stays clipped with the keyboard down is it a layout defect. ` +
              `Last rect ${JSON.stringify(best.node.rect)} in a ${viewport.width}x${viewport.height} viewport`,
          );
        }
        throw new Error(
          `scroll_until ${describe} failed after ${n} — ` +
            `element is in the viewport but ${describeClip(best.clipped, best.visible, best.under?.band)}, ` +
            `and the content is exhausted: swiping ${direction} no longer moves it. ` +
            `The element cannot be fully revealed — that is a layout defect ` +
            `(no clearance for an overlay?), not a scroll that needs more swipes. ` +
            `Last rect ${JSON.stringify(best.node.rect)} in a ${viewport.width}x${viewport.height} viewport`,
        );
      }
    }
    // A keyboard that leaves nothing above it: nothing but its own UI can be
    // judged, and no stroke can start on the content — fail now, naming it,
    // rather than swipe on keys (review 2026-10-08: until then this fell
    // back to the whole screen and reported a bare "fully visible").
    // The absence rule holds here too (review 2026-10-08): a target no read
    // has matched is ElementNotFoundError through `absenceError`, so an
    // `optional:` step is skipped "(not present)" — with the keyboard named,
    // since no swipe could look further.
    if (cover !== undefined && cover.above === undefined) {
      const seenAs = everFound ? 'the element is in the tree but under the soft keyboard' : 'element never appeared in the tree';
      throw absenceError(
        `scroll_until ${describe} failed after ${swipes} swipe${swipes === 1 ? '' : 's'} — ${seenAs}; the soft keyboard over ` +
          `${frameText(cover.band)} covers the whole screen, so nothing under it can be judged and no swipe was sent — ` +
          hideToJudgeWholeScreen(cover.remedy),
        { sighted: everFound, treesRead, readError: lastReadError },
      );
    }
    if (swipes >= maxSwipes || Date.now() >= deadline) {
      const partial =
        best !== undefined && best.visible > 0
          ? `element reached the viewport but stayed ${describeClip(best.clipped, best.visible, best.under?.band)} ` +
            `(last rect ${JSON.stringify(best.node.rect)})`
          : undefined;
      const why =
        lastReadError !== undefined
          ? `last UI tree read failed: ${lastReadError.message}`
          : partial !== undefined
            ? partial
            : lastFound.length === 0
              ? 'element never appeared in the tree'
              : `element in tree but never intersected the ${frameWords(viewport, cover)} ` +
                `(last rect ${JSON.stringify(lastFound[0].rect)})`;
      const cause = swipes >= maxSwipes ? `after ${swipes} swipes (maxSwipes)` : `after ${timeoutMs}ms (timeout)`;
      // The keyboard, when any round applied one: the reader must not take a
      // scroll that worked around it — or one it hid the element under — for
      // a wrong selector (the bug note's 15 s "never appeared"). And the
      // floating row, asked of the last round's reading whatever came before.
      const shown =
        lastCover !== undefined
          ? `. The soft keyboard was up over ${frameText(lastCover.band)} in ${coveredRounds} of the ${treesRead} rounds read: ` +
            `in those, visibility was judged, and the swipe drawn, in the screen above it — ${hideToJudgeWholeScreen(lastCover.remedy)}`
          : '';
      const unlocated = (await unlocatedAt(reading?.keyboard))
        ? `; ${UNLOCATED_KEYBOARD} — the swipes may have landed on it; hide or dock it and scroll again`
        : '';
      const message = `scroll_until ${describe} failed ${cause} — ${why}${shown}${unlocated}`;
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
    // other way (content below → finger up). See swipeVector. Under an
    // applied cover (2026-10-08) the box is cut to the part above the band,
    // so the stroke starts on the content, not on a key; a round whose tree
    // did not read has no reading of its own and keeps the cover of the last
    // round that DID read — none if that round applied none — rather than
    // stroke through the keyboard it last saw.
    const { box } = await screenBox(adapter, read);
    const strokeCover = tree === undefined ? lastReadCover : cover;
    const strokeBox = strokeCover === undefined ? box : { ...box, height: Math.min(box.height, strokeCover.band.y) };
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
