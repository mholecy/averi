import { rectArea, type DeviceScreen, type Point, type Rect, type UiNode } from '../adapters/types.js';
import { coverText, drawnOverText, frameText, nodeText, outsideScrollViewText, rectText, type Edge } from '../ui-tree/geometry.js';
import { UNLOCATED_KEYBOARD } from '../ui-tree/keyboard-cover.js';
import { tapPoint } from '../ui-tree/selectors.js';
import { cannotHide, type KeyboardRemedy } from '../ui-tree/soft-keyboard.js';
import { countOf } from '../util/count.js';
import { partlyUnderSystemBar, pinnedUnder, systemBarName, underSystemBar } from '../ui-tree/system-bar.js';
import { absenceError, type WaitEvidence } from './resolve.js';
import { cutRemedy, cutSliverText, pastSideText, revealText, underKeyboardText, untriedSideText } from './target-text.js';
import { shortOf, type Cover, type Judged } from './scroll-read.js';
import { outsideItsScrollView, presentedRemedy, presentedStop, reachOf } from '../ui-tree/standing.js';
import { UNMOVED_STROKES_EXHAUST, type BoundBy, type DetentMove, type Flush, type PastSide, type PresentedTouchDown, type ScrollOutcome, type Shortfall, type TouchedOn } from './scroll-rounds.js';
import { OPPOSITE, type Direction } from './swipe.js';

/**
 * Every sentence `scroll_until` says: the reply for a stop (`describeScrollResult`, over the result
 * `scrollResult` makes of a `visible` outcome) and the failure for every
 * other outcome (`scrollFailure`, one switch over its kind) — rendered here
 * and nowhere else, from interact/scroll-rounds.ts#ScrollOutcome, which
 * carries exactly the facts each sentence quotes. Pure: each sentence is a
 * function of a literal, pinned without a scripted device.
 */

/**
 * What the scroll actually achieved — not just how many swipes it took.
 *
 * `swipes` alone could not tell the truth: a stop can leave a row clipped at
 * the viewport edge, which a bare "visible" would hide. The caller's
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
   * — absent when none was read, so a run without a keyboard
   * reports what it always did:
   * - `shown`: the stop was judged against the screen ABOVE `frame` (the
   *   highest covered rect, `Cover.topCover`: the band, or a floating
   *   panel above it), not the whole screen, and that changed it — the
   *   part under it is not visible, whatever the tree says.
   *   docs/bugs/2026-10-08-scroll-until-ignores-android-soft-keyboard.md
   *   Only where the band changed the stop: a clip at its edge, or — when
   *   several nodes match — a different match judged (one under the band
   *   loses to one above it), which can be a clean "fully visible"; a band that changes nothing is not applied.
   *   The band is a reading's the witness stood by, or — `source:
   *   'idb-band'`, present only then — idb's band, read off the tree by its
   *   shape (ui-tree/keyboard-position.ts#KeyboardPosition.line): a keyboard LINE no
   *   reading says is shown, judged against all the same;
   *   docs/adr/0006-idb-keyboard-band-is-a-keyboard-line.md
   * - `unlocated`: the window model's `unlocated` row — the input method
   *   says a keyboard is shown, the window state gives it no area (one still
   *   coming up? not measured — ui-tree/keyboard-cover.ts#UNLOCATED_KEYBOARD; a
   *   floating Gboard does not read this way, its panel is read from the
   *   window's touchable region and covers as the band does) — so nothing
   *   could be judged against it and the report says so
   *   (the reading's `unlocated`, ui-tree/keyboard-cover.ts). Only on a clean `fully: true` stop.
   */
  keyboard?: { state: 'shown'; frame: Rect; source?: 'idb-band' } | { state: 'unlocated' };
  /**
   * `false` when the stop was reached after a stroke and no read confirmed
   * it held still: the target still moved on
   * each of SETTLE_CONFIRM_READS confirming reads (an animated row? a long
   * fling), or the stop came at the deadline. Absent on a settled stop — a
   * run that settles reports what it always did. The reply says so.
   */
  settled?: false;
  /**
   * Set on a `fully: true` stop whose edge along the scroll lies exactly on
   * its scroll container's edge (Android only:
   * interact/scroll-rounds.ts#PROBE_REACH) — where uiautomator cuts a
   * node's bounds, so the rect cannot say whether more of it lies beyond.
   * `checked`: a probe swipe toward that edge moved nothing, so nothing
   * does (the probe is one of `swipes`). Not checked (`why`, scroll-rounds.ts
   * #Flush): no swipe or time left, no container with room for a probe, a
   * probe short enough to be a tap, or — `fills`, with both `edges` and no
   * one `edge` — it fills its nearest container along the scroll, which no
   * probe can check; the reply says it
   * may be cut. Absent otherwise.
   */
  flush?: Flush;
  /**
   * Set on a stop with something of the app drawn over part of the element
   * — only without `fully: true`, which does not stop so:
   * its CENTRE is clear (the stop's own rule, ui-tree/standing.ts#Scene.standing, so a
   * tap on it lands), but `by` — the one over it drawn on top — hides part
   * of it, and only `shows` of its area is seen. The reply says so, as it
   * says a clip.
   * docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md
   */
  covered?: { by: Pick<UiNode, 'role' | 'label' | 'identifier' | 'rect'>; shows: number };
  /** Set when a sheet moved to another detent during the call — by a swipe or not (scroll-rounds.ts#DetentMove); the reply ends saying so. */
  detent?: DetentMove;
}

/**
 * Deliberately NOT on ScrollUntilResult: whether the content is exhausted.
 * It is learnt only by spending swipes and seeing the rects not move — the
 * `fully: true` path at a clipped stop, and any path
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
 * this round applied — a reading's the witness stood by, or idb's band
 * (`source: 'idb-band'`, said when its line is unwitnessed) — never a band
 * checked on an earlier one.
 */
export function scrollResult(o: Extract<ScrollOutcome, { kind: 'visible' }>): ScrollUntilResult {
  const { judged } = o;
  const { facts } = judged.standing;
  const keyboard: ScrollUntilResult['keyboard'] =
    judged.under !== undefined
      ? { state: 'shown', frame: judged.under.topCover, ...(!judged.under.line.witnessed && { source: 'idb-band' as const }) }
      : o.unlocated
        ? { state: 'unlocated' }
        : undefined;
  const by = facts.covers.at(-1);
  return {
    swipes: o.swipes,
    visible: facts.visible,
    clipped: [...facts.clipped],
    ...(keyboard !== undefined && { keyboard }),
    ...(!o.settled && { settled: false as const }),
    ...(o.flush !== undefined && { flush: o.flush }),
    ...(by !== undefined && { covered: { by: { role: by.role, label: by.label, identifier: by.identifier, rect: { ...by.rect } }, shows: facts.shows } }),
    ...(o.detent !== undefined && { detent: o.detent }),
  };
}

/** A share of an element, as a sentence quotes it: never rounded up to a reassuring 100 % — something is missing. */
const percent = (fraction: number): number => Math.min(Math.round(fraction * 100), 99);

/**
 * What of the app is drawn over a judged match, for a failure: `under
 * <cover> at its centre (x,y), drawn over it — N% of it shows` — the cover
 * the standing names (ui-tree/standing.ts#Scene.standing), at the centre
 * when it is the one over it (the point the next tap presses).
 */
function underText({ judged, cover }: Extract<Shortfall, { of: 'covered' }>): string {
  const { centreCover, shows } = judged.standing.facts;
  return `${drawnOverText(cover, cover === centreCover ? tapPoint(judged.node) : undefined, reachOf(judged.standing.facts, cover))} — ${percent(shows)}% of it shows`;
}

/** A plain stop's sliver (InFrameShort's `sliver`), in the tap's refusal's own words (target-text.ts#cutSliverText). */
function sliverText({ judged, cut, minPiece }: Extract<Shortfall, { of: 'sliver' }>): string {
  return cutSliverText(cut, judged.node.rect, minPiece);
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
    return `fully visible after ${n}${above}${flushText(r.flush)}${unlocated}${moving}${detentText(r.detent)}`;
  }
  // Partly under something of the app: a plain stop, its centre
  // clear — said like a clip, and with what a measurement would take in.
  const covered =
    r.covered === undefined ? undefined : `PARTLY UNDER ${nodeText(r.covered.by)}, drawn over it — ${percent(r.covered.shows)}% of it shows, its centre clear`;
  const clip = r.clipped.length === 0 ? undefined : describeClip(r.clipped, r.visible, topCover);
  const measures = clip !== undefined ? 'the CLIPPED box' : 'what is drawn over it too';
  return `visible after ${n} — ${[clip, covered].filter((t) => t !== undefined).join('; ')}. A rect assert or screenshot on this element will measure ${measures}${moving}${detentText(r.detent)}`;
}

/**
 * The detent clause, last in every reply and failure (scroll-rounds.ts#DetentMove): a sheet moved during the call —
 * a state change of the screen the verdict does not say, worded without a cause (a call that sent no swipe says it
 * too). Empty when it did not.
 */
const detentText = (detent: DetentMove | undefined): string => (detent === undefined ? '' : `; the sheet moved from its ${detent.from} detent to ${detent.to}`);

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
    // carousel.
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

/**
 * `its centre stays under the status bar at (201,53), in the top 62 of the screen (tree units), …` — the tap refusal's
 * clause for the same point (ui-tree/system-bar.ts#underSystemBar), at either system bar; or, for a `fully: true` stop the band's
 * region refused with the centre clear, `it stays partly under the navigation bar, from y 2154 …`
 * (ui-tree/system-bar.ts#partlyUnderSystemBar).
 */
const systemBarText = ({ judged, bar, band }: Extract<Shortfall, { of: 'systemBar' }>): string =>
  band === undefined ? `its centre stays ${underSystemBar(tapPoint(judged.node), bar)}` : `it stays ${partlyUnderSystemBar(bar)}`;

/**
 * What still reaches a node the band's REGION alone keeps a `fully: true` stop off (its centre clear of the bar):
 * the plain stop and the tap — said only when nothing of the app is drawn over its centre, which would stop them
 * too; else only that its centre is clear of the bar.
 */
const centreClear = ({ judged }: Extract<Shortfall, { of: 'systemBar' }>): string =>
  judged.standing.facts.centreCover === undefined ? 'its centre is clear: a plain scroll_until stops on it, and a tap lands' : 'its centre is clear of the bar';

/** "after swipe 2", "before the first swipe" — when the target was last in the frame. */
const whenInFrame = (swipes: number): string => (swipes === 0 ? 'before the first swipe' : `after swipe ${swipes}`);

/**
 * The way back as every stuck sentence words it (`otherWay`, scroll-rounds.ts
 * #round's stuck turn): one stroke `back` moved it neither, none was left to
 * try it with, or it was swiped earlier in the scroll.
 */
const otherWayText = (otherWay: Extract<ScrollOutcome, { kind: 'stuck' }>['otherWay'], back: Direction): string =>
  otherWay === 'unmoved'
    ? `, nor does swiping ${back}`
    : otherWay === 'untried'
      ? `, and swiping ${back} was never tried (no swipe or time was left)`
      : otherWay === 'outward'
        ? `, and swiping ${back} would only push it out through that edge`
        : `, and swiping ${back} was tried earlier in the scroll`;

/** `, and the next swipe would touch down at (x,y) on <the surface>` — where the `presented` stop's held-back stroke would have landed (`next`); empty when it was judged in the frame. */
const touchDownText = (next: PresentedTouchDown | undefined): string => (next === undefined ? '' : `, and the next swipe would touch down at ${pointText(next.touchDown)} on ${coverText(next.surface, next.reach)}`);

const pointText = (p: Point): string => `(${p.x},${p.y})`;

/**
 * The failure for every outcome but `visible`, and its class: `stuck` and
 * `presented` a plain Error (the element was there and seen); `covered` and `bound`
 * through resolve.ts#absenceError — ElementNotFoundError only when no read
 * at any swipe held a match and the last read succeeded, so an `optional:`
 * scroll_until to an element not on this screen is skipped "(not present)"
 * like a tap or a fill would be. `describe` is the target as
 * the caller spelled it (resolve.ts#describeTarget).
 */
export function scrollFailure(o: Exclude<ScrollOutcome, { kind: 'visible' }>, describe: string): Error {
  const { message, absence } = failureText(o, describe);
  const full = `${message}${detentText(o.detent)}`;
  return absence === undefined ? new Error(full) : absenceError(full, absence);
}

/** `scrollFailure`'s sentence, one case per kind, and the evidence of absence for the kinds judged by it (`covered`, `bound`). */
function failureText(o: Exclude<ScrollOutcome, { kind: 'visible' }>, describe: string): { message: string; absence?: WaitEvidence } {
  switch (o.kind) {
    case 'stuck': {
      const { short, viewport } = o;
      const { judged } = short;
      const n = swipesText(o.swipes);
      const last = `Last rect ${JSON.stringify(judged.node.rect)} in a ${viewport.width}x${viewport.height} viewport`;
      const back = OPPOSITE[o.lastStroke];
      // The way back (`otherWayText`); one swiped earlier is said only in the status bar's sentence, which would else advise it.
      const neither = o.otherWay === 'stroked' ? '' : otherWayText(o.otherWay, back);
      // What it is short of, in the standing's order (ui-tree/standing.ts#Scene).
      // A centre under a system bar at the end of the content (for `fully`, any of the node there past the slack):
      // no defect of the app's — the point a tap presses, or what a pixel assert reads, is the bar's, and no swipe
      // that way moves it out. The other way may; a target pinned there
      // moves neither way, which is said rather than promised away. "try direction" only for a way the
      // scroll never swiped.
      if (short.of === 'systemBar') {
        const pinned = pinnedUnder(short.bar.edge);
        // A `fully` stop refused by the band's region: its centre is clear of the bar (`centreClear`).
        const reach = short.band === undefined ? 'no step taps it' : `fully: true never stops on it (${centreClear(short)})`;
        const other =
          o.otherWay === 'untried'
            ? ` — try direction: "${back}"; if no direction moves it, ${pinned}, and ${reach}. `
            : `${otherWayText(o.otherWay, back)} — ${pinned}, and ${reach}. `;
        return {
          message:
            `scroll_until ${describe} failed after ${n} — ${systemBarText(short)}, and the content is exhausted: ` +
              `swiping ${o.lastStroke} no longer moves it out from under the ${systemBarName(short.bar.edge)}${other}${last}`,
        };
      }
      // Cut to a sliver by its scroll container at the end of the content (ui-tree/standing.ts#Scene.standing):
      // the rest stays past the container's edge however it is swiped — or the node only reads cut (geometry.ts#evidentCut's residual).
      if (short.of === 'sliver') {
        return {
          message:
            `scroll_until ${describe} failed after ${n} — element is in the viewport but ${sliverText(short)} — and the content is exhausted: ` +
              `swiping ${o.lastStroke} no longer moves it${neither}. The rest of it stays past its container's edge at the end of the content — a layout ` +
              `defect (no room beyond it?), or its own content runs to its edge, which reads as cut; a tap refuses it so cut (${cutRemedy(short.cut.edge)}). ${last}`,
        };
      }
      if (short.of === 'covered') {
        return {
          message:
            `scroll_until ${describe} failed after ${n} — element is in the viewport but ${underText(short)} — and the content is exhausted: ` +
              `swiping ${o.lastStroke} no longer moves it${neither}. The app draws that over it at the end of the content — a layout defect ` +
              `(no clearance for a pinned bar?), not a scroll that needs more swipes. ${last}`,
        };
      }
      // Clipped at the keyboard's edge at the end of the content: the
      // keyboard, not the layout, is what hides the rest — a container that
      // does not resize for it keeps its last rows under it. Said as such,
      // with how to hide it; the layout-defect wording only when the
      // keyboard is not the edge in question.
      const { clipped, visible } = judged.standing.facts;
      if (judged.under !== undefined && clipped.includes('bottom')) {
        return {
          message:
            `scroll_until ${describe} failed after ${n} — element is in the viewport but ` +
              `${describeClip(clipped, visible, judged.under.topCover)}, and the content is exhausted: swiping ${o.lastStroke} ` +
              `no longer moves it${neither}. The soft keyboard covers the rest — ${hideToJudgeWholeScreen(judged.under.remedy)}; only if it ` +
              `stays clipped with the keyboard down is it a layout defect. ${last}`,
        };
      }
      // Clipped, at an edge or more, by its scroll view's edge inside the screen: each edge named with what cuts it, the
      // part drawn quoted, and why the rest may stay past that scroll view — no overlay diagnosed for its edge.
      const { standing } = judged;
      if (standing.kind === 'clipped' && standing.byScrollView !== undefined) {
        const { edges, scroller, longer } = standing.byScrollView;
        const byScreen = clipped.filter((edge) => !edges.includes(edge));
        const at = `${edges.join('/')} ${outsideScrollViewText(scroller, 'by')}${byScreen.length === 0 ? '' : ` and at ${byScreen.join('/')} by the viewport`}`;
        // Where its content stops short of the element: past its end (bottom, right), before its start (top, left), or both.
        const after = edges.every((e) => e === 'bottom' || e === 'right');
        const before = edges.every((e) => e === 'top' || e === 'left');
        const short = after
          ? 'its content ends before the element does (no room after it — a layout defect)'
          : before
            ? 'its content begins after the element does (no room before it — a layout defect)'
            : 'its content stops short of the element at those edges (no room past them — a layout defect)';
        const past = byScreen.length > 0 ? 'those edges' : edges.length > 1 ? "that scroll view's edges" : "that scroll view's edge";
        const rest =
          longer !== undefined
            ? `It is ${longer} than what of its scroll view the screen shows: no scroll shows it whole.`
            : `The rest lies past ${past}: either the swipes do not scroll that scroll view (swipe inside it), or ${short}.`;
        return {
          message:
            `scroll_until ${describe} failed after ${n} — element is in the viewport but CLIPPED at ${at}: ${percent(visible)}% of it is drawn, and the content is exhausted: ` +
              `swiping ${o.lastStroke} no longer moves it${neither}. ${rest} ${last}`,
        };
      }
      return {
        message:
          `scroll_until ${describe} failed after ${n} — ` +
            `element is in the viewport but ${describeClip(clipped, visible, judged.under?.topCover)}, ` +
            `and the content is exhausted: swiping ${o.lastStroke} no longer moves it${neither}. ` +
            `The element cannot be fully revealed — that is a layout defect ` +
            `(no clearance for an overlay?), not a scroll that needs more swipes. ${last}`,
      };
    }
    case 'covered': {
      // The absence rule holds here too: a target no
      // read has matched is ElementNotFoundError, so an `optional:` step is
      // skipped "(not present)" — with the keyboard named, since no swipe
      // could look further.
      const { cover, viewport } = o;
      const seenAs = o.evidence.sighted ? 'the element is in the tree but under the soft keyboard' : 'element never appeared in the tree';
      return {
        message:
          `scroll_until ${describe} failed after ${swipesText(o.swipes)} — ${seenAs}; the soft keyboard over ` +
            `${frameText(cover.topCover)} ${cover.topCover.y + cover.topCover.height >= viewport.height ? 'covers the whole screen' : 'leaves nothing of the screen above its top edge'}, so nothing under it can be judged and no swipe was sent — ` +
            hideToJudgeWholeScreen(cover.remedy),
        absence: o.evidence,
      };
    }
    case 'presented': {
      // Under a screen presented over it (ADR 0018): stopped without a swipe — none moves it out, and one on
      // that screen may dismiss it. A plain Error, as `stuck`: the element was there and seen. Judged in the
      // viewport under that screen, the sentence says what is over it; not judged there (`touchDown`), why not
      // and where the next swipe would have landed — on that screen (`notInViewportText`). "The next swipe", not
      // "the swipe toward it": a turn, or a caller's direction away from the target, strokes the other way.
      const { judged, viewport, next } = o;
      const when = o.swipes === 0 ? 'before any swipe' : `after ${swipesText(o.swipes)}, without swiping further`;
      const layer = next === undefined ? o.layer : next.layer;
      if (judged === undefined) {
        // No target in the tree: the next swipe would have landed on an alert the tree marks (`Scene.presentedAt`, asked for no target).
        return { message: `scroll_until ${describe} stopped ${when} — element is not in the tree${touchDownText(next)} — ${presentedStop(layer)}, so ${o.swipes === 0 ? 'none' : 'no further swipe'} was sent.` };
      }
      const where =
        next === undefined
          ? `element is in the viewport but ${drawnOverText(o.cover, o.cover === judged.standing.facts.centreCover ? tapPoint(judged.node) : undefined, reachOf(judged.standing.facts, o.cover))} — ${percent(judged.standing.facts.shows)}% of it shows`
          : `${notInViewportText(judged, viewport)}${touchDownText(next)}`;
      return {
        message:
          `scroll_until ${describe} stopped ${when} — ${where} — ${presentedStop(layer)}, so ${o.swipes === 0 ? 'none' : 'no further swipe'} was sent. ` +
            `Last rect ${JSON.stringify(judged.node.rect)} in a ${viewport.width}x${viewport.height} viewport`,
      };
    }
    case 'bound': {
      const turned =
        o.turns > 0 ? `. It was turned round ${countOf(o.turns, 'time')}: a swipe carried it past the viewport (a fling), or it lay at the edge the swipes push it out through, so the next was drawn the other way` : '';
      // The keyboard, when any round applied one: the reader must not take a
      // scroll that worked around it — or one it hid the element under — for
      // a wrong selector (the bug note's 15 s "never appeared").
      const shown =
        o.keyboard !== undefined
          ? `. The soft keyboard was up over ${frameText(o.keyboard.cover.topCover)} in ${o.keyboard.rounds} of the ${o.keyboard.read} rounds read: ` +
            `in those, visibility was judged, and the swipe drawn, in the screen above it — ${hideToJudgeWholeScreen(o.keyboard.cover.remedy)}`
          : '';
      const unlocated = o.unlocated ? `; ${UNLOCATED_KEYBOARD} — the swipes may have landed on it; hide or dock it and scroll again` : '';
      // The swipe the bound held back would have touched down on a presented screen: said once, with its remedy —
      // the reader's next step would otherwise be another scroll that lands there.
      const presented =
        o.presented === undefined
          ? ''
          : `. The next swipe would have touched down at ${pointText(o.presented.touchDown)} on ${coverText(o.presented.surface, o.presented.reach)} — ${presentedRemedy('it', o.presented.layer)}`;
      return { message: `scroll_until ${describe} failed ${boundText(o.by, o.swipes)} — ${shortText(o.short)}${turned}${shown}${unlocated}${presented}`, absence: o.evidence };
    }
  }
}

/**
 * Why a judged match was NOT judged in the viewport, for the `presented` stop whose next swipe would have touched
 * down on the presented screen (scroll-rounds.ts#ScrollOutcome's `touchDown`) — one clause per reason, by where it
 * stands (ui-tree/standing.ts#Standing):
 * - wholly outside the frame: `element lies below the viewport` (target-text.ts#pastSideText, the side it lies past);
 * - under the soft keyboard: `element lies under the soft keyboard: its centre (201,661) lies below the keyboard's top
 *   edge at y 573` — the tap's refusal's words for the same point (target-text.ts#underKeyboardText);
 * - in the frame but short of the stop: `element is in the viewport but …`, in the words the stuck and bound
 *   sentences give that shortfall (scroll-read.ts#shortOf: clipped at an edge, cut to a sliver by its scroll
 *   container, its centre under a system bar, or under something of its own screen).
 */
function notInViewportText(judged: Judged, viewport: Rect): string {
  const { standing, node } = judged;
  if (standing.kind === 'underKeyboard') return `element lies ${underKeyboardText(tapPoint(node), standing.line.y)}`;
  if (standing.facts.visible === 0) {
    // On the screen, but nothing of it drawn: its scroll view's frame, not the viewport's, is what it lies outside of.
    if (outsideItsScrollView(standing)) return `element lies ${outsideScrollViewText(standing.scroller)}: nothing of it is drawn`;
    const side = wholePast(node.rect, viewport);
    return `element lies ${side === undefined ? 'outside the viewport' : pastSideText(side, node.clippedOut === side)}`;
  }
  return `element is in the viewport but ${shortClause(judged)}`;
}

/** What keeps a judged match in the frame short of the stop, in the stuck and bound sentences' words (scroll-read.ts#shortOf). */
function shortClause(judged: Judged): string {
  const short = shortOf(judged);
  switch (short.of) {
    case 'clipped':
      return describeClip(judged.standing.facts.clipped, judged.standing.facts.visible, judged.under?.topCover);
    case 'sliver':
      return sliverText(short);
    case 'systemBar':
      return systemBarText(short);
    case 'covered':
      return underText(short);
  }
}

/**
 * The side of `viewport` a rect lies wholly past — below before above, as a scroll down finds it — or undefined when it
 * lies past none wholly. A rect with no area lies past none: it has no extent to lie past a side with, and where a tree
 * gives one it is most often a placeholder origin, not a place (the SWIFT form's `TextFieldWithComponentStyle` texts,
 * read at 0,0 0x0 under their fields) — its bottom edge on the viewport's top would read "above the viewport", so it
 * reads "outside the viewport" instead.
 */
function wholePast(rect: Rect, viewport: Rect): Edge | undefined {
  if (rectArea(rect) === 0) return undefined;
  if (rect.y >= viewport.y + viewport.height) return 'bottom';
  if (rect.y + rect.height <= viewport.y) return 'top';
  if (rect.x >= viewport.x + viewport.width) return 'right';
  if (rect.x + rect.width <= viewport.x) return 'left';
  return undefined;
}

/** Which bound ended it, as the failure's cause. */
function boundText(by: BoundBy, swipes: number): string {
  switch (by.of) {
    case 'exhausted': {
      // `tree`: there is no match to watch, so the sentence
      // says what was watched — the whole screen. `touched` (the
      // floating tab bar): the strokes touched down on a node drawn over the
      // list, so THAT is named first — not led by "content exhausted", which
      // a flow reads as "the list ends" — and the other causes after it: the
      // tree cannot say the node takes touches.
      const others = by.unchanged === 'tree' ? 'content exhausted, still loading' : 'content exhausted';
      const why = by.touched !== undefined ? `${touchedText(by.touched)} (else: ${others})` : `${others}, or the swipes were not taken`;
      return `after ${swipesText(swipes)} (the last ${UNMOVED_STROKES_EXHAUST}, swiping ${by.lastStroke}, ${by.unchanged === 'tree' ? 'did not change the screen' : 'did not move it'}: ${why})`;
    }
    case 'maxSwipes':
      return `after ${swipesText(swipes)} (maxSwipes)`;
    case 'timeout':
      return timeoutText(by, swipes);
  }
}

/**
 * The timeout bound's words: the time spent, then the budget it ran past, the swipes sent and what the tree reads took
 * — `after 38204ms (timeout 15000ms; no swipe was sent; 1 tree read took 38204ms)`, `after 18000ms (timeout 15000ms;
 * 2 swipes sent; 3 tree reads took 18000ms, the last 6000ms)` — so a budget the reads spent (a tree source slow or
 * restarting under the scroll) does not read as content that never came into view. Exported for the troubleshooting
 * reference, which quotes one rendering (tests/mcp/tool-descriptions.test.ts pins it).
 */
export function timeoutText(by: Extract<BoundBy, { of: 'timeout' }>, swipes: number): string {
  const sent = swipes === 0 ? 'no swipe was sent' : `${swipesText(swipes)} sent`;
  const { count, totalMs, lastMs } = by.reads;
  const reads = `${countOf(count, 'tree read')} took ${totalMs}ms${count > 1 ? `, the last ${lastMs}ms` : ''}`;
  return `after ${by.elapsedMs}ms (timeout ${by.timeoutMs}ms; ${sent}; ${reads})`;
}

/** The node the strokes touched down on, drawn over their list: `they touched down at x,y on <role> "<label>" (id <id>) at <rect>, drawn over the list <rect>, which may have taken them`. */
function touchedText({ at, on, container }: TouchedOn): string {
  const label = on.label !== null && on.label !== '' ? ` ${JSON.stringify(on.label)}` : '';
  const id = on.identifier !== null ? ` (id ${on.identifier})` : '';
  return `they touched down at ${at.x},${at.y} on ${on.role}${label}${id} at ${rectText(on.rect)}, drawn over the list ${rectText(container)}, which may have taken them`;
}

/** What the target was short of at the bound — one switch over the shortfall. */
function shortText(short: Shortfall): string {
  switch (short.of) {
    case 'readFailed':
      return `last UI tree read failed: ${short.error.message}`;
    case 'clipped': {
      const { judged } = short;
      const { clipped, visible } = judged.standing.facts;
      return `element reached the viewport but stayed ${describeClip(clipped, visible, judged.under?.topCover)} (last rect ${JSON.stringify(judged.node.rect)})`;
    }
    case 'covered': {
      const { judged } = short;
      return `element reached the viewport but stayed ${underText(short)} (last rect ${JSON.stringify(judged.node.rect)})`;
    }
    case 'systemBar': {
      const { judged } = short;
      const region = short.band === undefined ? '' : ` — fully: true stops only with none of it under the bar (${centreClear(short)})`;
      return `element reached the viewport but ${systemBarText(short)}${region} (last rect ${JSON.stringify(judged.node.rect)})`;
    }
    case 'sliver': {
      return `element reached the viewport but stayed ${sliverText(short)} (last rect ${JSON.stringify(short.judged.node.rect)}) — a tap refuses it so cut (${cutRemedy(short.cut.edge)})`;
    }
    case 'absent':
      return `element never appeared in the tree${short.unsearched !== undefined ? ` — ${untriedSideText(short.unsearched)}` : ''}`;
    case 'gone':
      return `element was in the viewport ${whenInFrame(short.inFrameAfter)} but did not stay — it is no longer in the tree (a fling carried it off? a lazy list drops what scrolls away)`;
    case 'left':
      // It WAS in the tree — "never appeared" would be false, and its class
      // (a plain Error, the element was sighted) says so. Last seen past the
      // far edge: where, not a guess.
      if (short.past !== undefined) {
        return `element was in the tree ${whenInFrame(short.inTreeAfter)}, ${pastText(short.past)}, never in the viewport, and is no longer in the tree (a lazy list drops what scrolls away) — ${revealText(short.past.side)}`;
      }
      return `element was in the tree ${whenInFrame(short.inTreeAfter)} (off the viewport, or under the soft keyboard), never in the viewport, and is no longer in the tree — a swipe carried it out (a fling?) and a lazy list drops what scrolls away`;
    case 'offFrame': {
      const offFrame = short.outside !== undefined ? outsideScrollViewText(short.outside) : `the ${frameWords(short.viewport, short.cover)}${short.eitherWayUp ? ' either way up' : ''}`;
      const rect = `(last rect ${JSON.stringify(short.rect)})`;
      const past = short.past !== undefined ? ` — it lay ${pastText(short.past, short.outside)}: ${revealText(short.past.side)}` : '';
      return short.inFrameAfter !== undefined
        ? `element was in the viewport ${whenInFrame(short.inFrameAfter)} but did not stay (a fling?) — in tree, ${short.outside !== undefined ? '' : 'off '}${offFrame} at the last read ${rect}${past}`
        : short.outside !== undefined
          ? `element in tree but never drawn: it lies ${offFrame} ${rect}${past}`
          : `element in tree but never intersected ${offFrame} ${rect}${past}`;
    }
  }
}

/** Where a target last read past the far edge lay: `clipped out above its scroll container, past the edge the swipes push it out through`. */
const pastText = ({ side, clippedOut }: PastSide, scrollView?: UiNode): string => `${pastSideText(side, clippedOut, scrollView)}, past the edge the swipes push it out through`;
