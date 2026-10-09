import type { DeviceScreen, Rect, UiNode } from '../adapters/types.js';
import { drawnOverText, frameText, nodeText, rectText } from '../ui-tree/geometry.js';
import { UNLOCATED_KEYBOARD } from '../ui-tree/keyboard-cover.js';
import { tapPoint } from '../ui-tree/selectors.js';
import { cannotHide, type KeyboardRemedy } from '../ui-tree/soft-keyboard.js';
import { countOf } from '../util/count.js';
import { absenceError } from './resolve.js';
import { UNMOVED_STROKES_EXHAUST, type BoundBy, type Cover, type Edge, type Flush, type Judged, type ScrollOutcome, type Shortfall, type TouchedOn } from './scroll-rounds.js';

/**
 * Every sentence `scroll_until` says (2026-10-09, the scroll-rounds
 * deepening): the reply for a stop (`describeScrollResult`, over the result
 * `scrollResult` makes of a `visible` outcome) and the failure for every
 * other outcome (`scrollFailure`, one switch over its kind) — rendered here
 * and nowhere else, from interact/scroll-rounds.ts#ScrollOutcome, which
 * carries exactly the facts each sentence quotes. Pure. Until that date the
 * failures were spelled inline in the loop of interact/scroll.ts, the bound's
 * as a chain of nested ternaries, so a sentence could be pinned only through
 * a scripted device; now each is a function of a literal.
 */

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
   * - `shown`: the stop was judged against the screen ABOVE `frame` (the
   *   highest covered rect, `Cover.topCover`: the band, or a floating
   *   panel above it), not the whole screen, and that changed it — the
   *   part under it is not visible, whatever the tree says
   *   (docs/bugs/2026-10-08-scroll-until-ignores-android-soft-keyboard.md).
   *   Only where the band changed the stop: a clip at its edge, or — when
   *   several nodes match — a different match judged (one under the band
   *   loses to one above it), which can be a clean "fully visible" (round 3
   *   of the review, 2026-10-08); a band that changes nothing is not applied;
   * - `unlocated`: the window model's `unlocated` row — the input method
   *   says a keyboard is shown, the window state gives it no area (one still
   *   coming up? not measured — ui-tree/keyboard-cover.ts#UNLOCATED_KEYBOARD; a
   *   floating Gboard does not read this way, its panel is read from the
   *   window's touchable region and covers as the band does) — so nothing
   *   could be judged against it and the report says so
   *   (the reading's `unlocated`, ui-tree/keyboard-cover.ts). Only on a clean `fully: true` stop.
   */
  keyboard?: { state: 'shown'; frame: Rect } | { state: 'unlocated' };
  /**
   * `false` when the stop was reached after a stroke and no read confirmed
   * it held still (2026-10-08, review round 1): the target still moved on
   * each of SETTLE_CONFIRM_READS confirming reads (an animated row? a long
   * fling), or the stop came at the deadline. Absent on a settled stop — a
   * run that settles reports what it always did. The reply says so.
   */
  settled?: false;
  /**
   * Set on a `fully: true` stop whose edge along the scroll lies exactly on
   * its scroll container's edge (2026-10-09, Android only:
   * interact/scroll-rounds.ts#PROBE_REACH) — where uiautomator cuts a
   * node's bounds, so the rect cannot say whether more of it lies beyond.
   * `checked`: a probe swipe toward that edge moved nothing, so nothing
   * does (the probe is one of `swipes`). Not checked (`why`, scroll-rounds.ts
   * #Flush): no swipe or time left, no container with room for a probe, a
   * probe short enough to be a tap, or — `fills`, with both `edges` and no
   * one `edge` — it fills its nearest container along the scroll, which no
   * probe can check (code review of round 3, 2026-10-09); the reply says it
   * may be cut. Absent otherwise.
   */
  flush?: Flush;
  /**
   * Set on a stop with something of the app drawn over part of the element
   * (2026-10-09, docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-
   * app-chrome.md) — only without `fully: true`, which does not stop so:
   * its CENTRE is clear (the stop's own rule, scroll-rounds.ts#stops, so a
   * tap on it lands), but `by` — the one over it drawn on top — hides part
   * of it, and only `shows` of its area is seen. The reply says so, as it
   * says a clip.
   */
  covered?: { by: Pick<UiNode, 'role' | 'label' | 'identifier' | 'rect'>; shows: number };
}

/**
 * Deliberately NOT on ScrollUntilResult: whether the content is exhausted.
 * It is learnt only by spending swipes and seeing the rects not move — the
 * `fully: true` path at a clipped stop, and (since 2026-10-08) any path
 * whose target is in the tree but off the frame — and wherever it is
 * learnt the answer is "yes, and here is the throw". A returned result
 * would therefore carry a constitutionally `false` field. Establishing it
 * at a stop would cost every caller an extra swipe past a stop they already
 * accepted, which is a worse trade than the clipped fraction already
 * reported here.
 */

/**
 * The result a `visible` outcome reports — `keyboard` and `settled` present
 * only when set, so a run without a keyboard, or one that settled, reports
 * what it always did. `shown` only when THIS stop was judged under a band
 * the witness stood by this round — never a band checked on an earlier one.
 */
export function scrollResult(o: Extract<ScrollOutcome, { kind: 'visible' }>): ScrollUntilResult {
  const { judged } = o;
  const keyboard: ScrollUntilResult['keyboard'] =
    judged.under !== undefined ? { state: 'shown', frame: judged.under.topCover } : o.unlocated ? { state: 'unlocated' } : undefined;
  const by = judged.covers.at(-1);
  return {
    swipes: o.swipes,
    visible: judged.visible,
    clipped: judged.clipped,
    ...(keyboard !== undefined && { keyboard }),
    ...(!o.settled && { settled: false as const }),
    ...(o.flush !== undefined && { flush: o.flush }),
    ...(by !== undefined && { covered: { by: { role: by.role, label: by.label, identifier: by.identifier, rect: { ...by.rect } }, shows: judged.shows } }),
  };
}

/** A share of an element, as a sentence quotes it: never rounded up to a reassuring 100 % — something is missing. */
const percent = (fraction: number): number => Math.min(Math.round(fraction * 100), 99);

/**
 * What of the app is drawn over a judged match, for a failure: `under
 * <cover> at its centre (x,y), drawn over it — N% of it shows` — the cover
 * over its centre when there is one (the point the next tap presses), else
 * the topmost of its covers.
 */
function underText(j: Judged): string {
  const by = j.centreCover ?? j.covers.at(-1);
  const under = by === undefined ? 'under something, drawn over it' : drawnOverText(by, j.centreCover === undefined ? undefined : tapPoint(j.node));
  return `${under} — ${percent(j.shows)}% of it shows`;
}

/**
 * How much of an element is on screen, in the terms the caller's next call
 * cares about. Takes the already-computed edges rather than a rect and a
 * viewport, so every site that has judged an element once can describe it
 * without judging it again — including `describeScrollResult`, which holds a
 * result and no rect at all.
 */
function describeClip(edges: readonly string[], visible: number, topCover?: Rect): string {
  // Never round a clipped element up to a reassuring 100%: the whole point of
  // the line is that something is missing.
  const pct = percent(visible);
  const where = topCover === undefined ? 'the viewport' : `the viewport above the soft keyboard over ${frameText(topCover)}`;
  return `CLIPPED at ${edges.join('/')}, ${pct}% of it is in ${where}`;
}

/** `1 swipe`, `3 swipes` — the one spelling of the count every scroll sentence quotes. */
const swipesText = (n: number): string => countOf(n, 'swipe');

/** The honest one-line summary both call sites print. */
export function describeScrollResult(r: ScrollUntilResult): string {
  const n = swipesText(r.swipes);
  // `shown` comes where the band changed the stop — a clip at its edge, or a
  // different match judged, which can be clean; `unlocated` only with a
  // clean `fully: true` stop (scroll-rounds.ts#round).
  const topCover = r.keyboard?.state === 'shown' ? r.keyboard.frame : undefined;
  const moving = r.settled === false ? `; ${STILL_MOVING}` : '';
  if (r.clipped.length === 0 && r.covered === undefined) {
    const above = topCover === undefined ? '' : `, judged above the soft keyboard over ${frameText(topCover)}`;
    const unlocated = r.keyboard?.state === 'unlocated' ? `; ${UNLOCATED_KEYBOARD} — it was not judged and may cover the element` : '';
    return `fully visible after ${n}${above}${flushText(r.flush)}${unlocated}${moving}`;
  }
  // Partly under something of the app (2026-10-09): a plain stop, its centre
  // clear — said like a clip, and with what a measurement would take in.
  const covered =
    r.covered === undefined ? undefined : `PARTLY UNDER ${nodeText(r.covered.by)}, drawn over it — ${percent(r.covered.shows)}% of it shows, its centre clear`;
  const clip = r.clipped.length === 0 ? undefined : describeClip(r.clipped, r.visible, topCover);
  const measures = clip !== undefined ? 'the CLIPPED box' : 'what is drawn over it too';
  return `visible after ${n} — ${[clip, covered].filter((t) => t !== undefined).join('; ')}. A rect assert or screenshot on this element will measure ${measures}${moving}`;
}

/**
 * The flush clause (scroll-rounds.ts#PROBE_REACH): what the stop's edge on
 * its scroll container means — checked by a probe, or not checked. The
 * container is quoted as a node's rect (`rectText`): it is one.
 */
function flushText(flush: ScrollUntilResult['flush']): string {
  if (flush === undefined) return '';
  const cut = "it may be cut there, a rect assert or screenshot may measure part of it";
  if ('edges' in flush) {
    // The usual benign case named, so the reader weighs the warning: a card
    // as tall as its horizontal carousel inside a vertical list fills the
    // carousel (verification round of fix/r3-cr, 2026-10-09).
    return (
      `; but it fills its scroll container (${rectText(flush.container)}) exactly — its ${flush.edges.join(' and ')} edges lie on ` +
      `the container's, where Android cuts a node's bounds to the container, and no probe swipe can tell which side, if either, is cut — ${cut}; ` +
      'usual for a card as tall as its carousel — check with a screenshot'
    );
  }
  const where = `its ${flush.edge} edge lies on its scroll container's (${rectText(flush.container)})`;
  if (flush.checked) return `; ${where}, and a probe swipe toward it moved nothing — nothing of it is cut there`;
  const unchecked = {
    budget: 'no swipe or time was left to check it',
    room: 'no scroll container around it has room for a probe swipe to check it',
    tap: 'the probe swipe was too short to tell from a tap',
  }[flush.why];
  return `; but ${where}, where Android cuts a node's bounds to the container, and ${unchecked} — ${cut}`;
}

/** The `settled: false` note — what the reader should know before measuring the element. */
const STILL_MOVING = 'still moving at the last read (a fling not yet over, or an animated element?) — a rect or screenshot taken now may not match';

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

/** What the stop judged against, for "never intersected …". */
const frameWords = (viewport: DeviceScreen, cover: Cover | undefined): string =>
  cover?.above === undefined
    ? `${viewport.width}x${viewport.height} viewport`
    : `${cover.above.width}x${cover.above.height} screen above the soft keyboard over ${frameText(cover.topCover)}`;

/** "after swipe 2", "before the first swipe" — when the target was last in the frame. */
const whenInFrame = (swipes: number): string => (swipes === 0 ? 'before the first swipe' : `after swipe ${swipes}`);

/**
 * The failure for every outcome but `visible`, and its class: `stuck` a
 * plain Error (the element was there and seen); `covered` and `bound`
 * through resolve.ts#absenceError — ElementNotFoundError only when no read
 * at any swipe held a match and the last read succeeded, so an `optional:`
 * scroll_until to an element not on this screen is skipped "(not present)"
 * like a tap or a fill would be (2026-10-08). `describe` is the target as
 * the caller spelled it (resolve.ts#describeTarget).
 */
export function scrollFailure(o: Exclude<ScrollOutcome, { kind: 'visible' }>, describe: string): Error {
  switch (o.kind) {
    case 'stuck': {
      const { short, viewport } = o;
      const { judged } = short;
      const n = swipesText(o.swipes);
      const last = `Last rect ${JSON.stringify(judged.node.rect)} in a ${viewport.width}x${viewport.height} viewport`;
      // Under something of the app (2026-10-09, scroll-rounds.ts#shortOf) that
      // stays over it at the end of the content: no clearance for a pinned
      // bar. Led by the cover whenever that is what it is short of — a plain
      // stop's centre under a bar, however clipped (code review S1).
      if (short.of === 'covered') {
        return new Error(
          `scroll_until ${describe} failed after ${n} — element is in the viewport but ${underText(judged)} — and the content is exhausted: ` +
            `swiping ${o.lastStroke} no longer moves it. The app draws that over it at the end of the content — a layout defect ` +
            `(no clearance for a pinned bar?), not a scroll that needs more swipes. ${last}`,
        );
      }
      // Clipped at the keyboard's edge at the end of the content: the
      // keyboard, not the layout, is what hides the rest — a container that
      // does not resize for it keeps its last rows under it. Said as such,
      // with how to hide it; the layout-defect wording only when the
      // keyboard is not the edge in question.
      if (judged.under !== undefined && judged.clipped.includes('bottom')) {
        return new Error(
          `scroll_until ${describe} failed after ${n} — element is in the viewport but ` +
            `${describeClip(judged.clipped, judged.visible, judged.under.topCover)}, and the content is exhausted: swiping ${o.lastStroke} ` +
            `no longer moves it. The soft keyboard covers the rest — ${hideToJudgeWholeScreen(judged.under.remedy)}; only if it ` +
            `stays clipped with the keyboard down is it a layout defect. ${last}`,
        );
      }
      return new Error(
        `scroll_until ${describe} failed after ${n} — ` +
          `element is in the viewport but ${describeClip(judged.clipped, judged.visible, judged.under?.topCover)}, ` +
          `and the content is exhausted: swiping ${o.lastStroke} no longer moves it. ` +
          `The element cannot be fully revealed — that is a layout defect ` +
          `(no clearance for an overlay?), not a scroll that needs more swipes. ${last}`,
      );
    }
    case 'covered': {
      // The absence rule holds here too (review 2026-10-08): a target no
      // read has matched is ElementNotFoundError, so an `optional:` step is
      // skipped "(not present)" — with the keyboard named, since no swipe
      // could look further.
      const { cover, viewport } = o;
      const seenAs = o.evidence.sighted ? 'the element is in the tree but under the soft keyboard' : 'element never appeared in the tree';
      return absenceError(
        `scroll_until ${describe} failed after ${swipesText(o.swipes)} — ${seenAs}; the soft keyboard over ` +
          `${frameText(cover.topCover)} ${cover.topCover.y + cover.topCover.height >= viewport.height ? 'covers the whole screen' : 'leaves nothing of the screen above its top edge'}, so nothing under it can be judged and no swipe was sent — ` +
          hideToJudgeWholeScreen(cover.remedy),
        o.evidence,
      );
    }
    case 'bound': {
      const turned =
        o.turns > 0 ? `. It was turned round ${countOf(o.turns, 'time')}: a swipe carried it past the viewport (a fling), so the next was drawn the other way` : '';
      // The keyboard, when any round applied one: the reader must not take a
      // scroll that worked around it — or one it hid the element under — for
      // a wrong selector (the bug note's 15 s "never appeared").
      const shown =
        o.keyboard !== undefined
          ? `. The soft keyboard was up over ${frameText(o.keyboard.cover.topCover)} in ${o.keyboard.rounds} of the ${o.keyboard.read} rounds read: ` +
            `in those, visibility was judged, and the swipe drawn, in the screen above it — ${hideToJudgeWholeScreen(o.keyboard.cover.remedy)}`
          : '';
      const unlocated = o.unlocated ? `; ${UNLOCATED_KEYBOARD} — the swipes may have landed on it; hide or dock it and scroll again` : '';
      return absenceError(`scroll_until ${describe} failed ${boundText(o.by, o.swipes)} — ${shortText(o.short)}${turned}${shown}${unlocated}`, o.evidence);
    }
  }
}

/** Which bound ended it, as the failure's cause. */
function boundText(by: BoundBy, swipes: number): string {
  switch (by.of) {
    case 'exhausted': {
      // `tree` (2026-10-09): there is no match to watch, so the sentence
      // says what was watched — the whole screen. `touched` (2026-10-09, the
      // floating tab bar): the strokes touched down on a node drawn over the
      // list, so THAT is named first — not led by "content exhausted", which
      // a flow reads as "the list ends" — and the other causes after it: the
      // tree cannot say the node takes touches (review round 1).
      const others = by.unchanged === 'tree' ? 'content exhausted, still loading' : 'content exhausted';
      const why = by.touched !== undefined ? `${touchedText(by.touched)} (else: ${others})` : `${others}, or the swipes were not taken`;
      return `after ${swipesText(swipes)} (the last ${UNMOVED_STROKES_EXHAUST}, swiping ${by.lastStroke}, ${by.unchanged === 'tree' ? 'did not change the screen' : 'did not move it'}: ${why})`;
    }
    case 'maxSwipes':
      return `after ${swipesText(swipes)} (maxSwipes)`;
    case 'timeout':
      return `after ${by.timeoutMs}ms (timeout)`;
  }
}

/** The node the strokes touched down on, drawn over their list: `they touched down at x,y on <role> "<label>" (id <id>) at <rect>, drawn over the list <rect>, which may have taken them`. */
function touchedText({ at, on, container }: TouchedOn): string {
  const label = on.label !== null && on.label !== '' ? ` ${JSON.stringify(on.label)}` : '';
  const id = on.identifier !== null ? ` (id ${on.identifier})` : '';
  return `they touched down at ${at.x},${at.y} on ${on.role}${label}${id} at ${rectText(on.rect)}, drawn over the list ${rectText(container)}, which may have taken them`;
}

/** What the target was short of at the bound — the one switch that was a chain of nested ternaries in the loop until 2026-10-09. */
function shortText(short: Shortfall): string {
  switch (short.of) {
    case 'readFailed':
      return `last UI tree read failed: ${short.error.message}`;
    case 'clipped': {
      const { judged } = short;
      return `element reached the viewport but stayed ${describeClip(judged.clipped, judged.visible, judged.under?.topCover)} (last rect ${JSON.stringify(judged.node.rect)})`;
    }
    case 'covered': {
      const { judged } = short;
      return `element reached the viewport but stayed ${underText(judged)} (last rect ${JSON.stringify(judged.node.rect)})`;
    }
    case 'absent':
      return 'element never appeared in the tree';
    case 'gone':
      return `element was in the viewport ${whenInFrame(short.inFrameAfter)} but did not stay — it is no longer in the tree (a fling carried it off? a lazy list drops what scrolls away)`;
    case 'left':
      // 2026-10-09: it WAS in the tree — "never appeared" (the bug note's
      // third observation) was false, and its class (a plain Error, the
      // element was sighted) already said so.
      return `element was in the tree ${whenInFrame(short.inTreeAfter)} (off the viewport, or under the soft keyboard), never in the viewport, and is no longer in the tree — a swipe carried it out (a fling?) and a lazy list drops what scrolls away`;
    case 'offFrame': {
      const offFrame = `the ${frameWords(short.viewport, short.cover)}${short.eitherWayUp ? ' either way up' : ''}`;
      const rect = `(last rect ${JSON.stringify(short.rect)})`;
      return short.inFrameAfter !== undefined
        ? `element was in the viewport ${whenInFrame(short.inFrameAfter)} but did not stay (a fling?) — in tree, off ${offFrame} at the last read ${rect}`
        : `element in tree but never intersected ${offFrame} ${rect}`;
    }
  }
}
