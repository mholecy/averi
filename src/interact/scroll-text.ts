import type { DeviceScreen, Point, Rect, UiNode } from '../adapters/types.js';
import { axisOfEdge, containsPoint, coverText, frameText, nodeText, outsideScrollViewText, rectText, wholePast, type Edge, type QuotedNode } from '../ui-tree/geometry.js';
import { CLIP_LINE, type EyesFinding, type SurfaceFinding } from '../ui-tree/eyes.js';
import { UNLOCATED_KEYBOARD } from '../ui-tree/keyboard-cover.js';
import { tapPoint } from '../ui-tree/selectors.js';
import { withMissNote } from '../ui-tree/miss.js';
import type { KeyboardRemedy } from '../ui-tree/soft-keyboard.js';
import { coverClause, type Cover } from '../ui-tree/cover.js';
import { outsideItsScrollView, orderRemedyText, presentedRemedy, presentedStop, type ScrollViewCut } from '../ui-tree/standing.js';
import { partlyUnderSystemBar, pinnedUnder, systemBarName, underSystemBar } from '../ui-tree/system-bar.js';
import { revealText, SIDES } from '../ui-tree/sides.js';
import { countOf } from '../util/count.js';
import { absenceError, type WaitEvidence } from './resolve.js';
import { fullyClaimed, shortOf, type AppliedKeyboard, type Judged } from './scroll-read.js';
import { UNMOVED_STROKES_EXHAUST, type BoundBy, type DetentMove, type EndProof, type EndTurn, type Flush, type PastSide, type ScrollOutcome, type Shortfall } from './scroll-rounds.js';
import type { CarriedUnder, UnseenStrokes } from './motion-ledger.js';
import type { PresentedTouchDown, TouchedOn } from './stroke-plan.js';
import { EDGE_TOWARD, OPPOSITE, type Direction } from './swipe.js';
import { cutByRemedy, cutRemedy, cutSliverText, dismissKeyboardFirstText, hideClause, hideKeyboardHow, pastSideText, ridingKeyboard, underKeyboardText, untriedSideText, wholeThinWayPast, type KeyboardUp } from './target-text.js';

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
   *   highest covered rect, `AppliedKeyboard.topCover`: the band, or a floating
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
   * interact/scroll-rounds.ts#flushCheck) — where uiautomator cuts a
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
  covered?: { by: QuotedNode; shows: number };
  /**
   * Set on a stop whose "fully visible" claim the eyes looked at (ui-tree/eyes.ts) and did not confirm: the target lies
   * flush with `neighbour` at `edge`, a node drawn after it outside its scroll view, and the screenshot showed a band
   * of the surface around that node over the target (`surface` — only on a plain stop the band leaves the centre of:
   * `fully: true` does not stop so, nor the plain stop with the band over its centre) or could not tell (`unjudged`).
   * The reply says so; absent when the eyes saw its own colour to every edge, or were not asked.
   */
  eyes?: EyesFinding;
  /** Set when a sheet moved to another detent during the call — by a swipe or not (scroll-rounds.ts#DetentMove); the reply ends saying so. */
  detent?: DetentMove;
  /** Set when the strokes turned once from the caller's direction, the content proven exhausted that way (course.ts#EndTurn); the reply says so. */
  endTurn?: EndTurn;
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
  const by = facts.covers.at(-1)?.node;
  return {
    swipes: o.swipes,
    visible: facts.visible,
    clipped: [...facts.clipped],
    ...(keyboard !== undefined && { keyboard }),
    ...(!o.settled && { settled: false as const }),
    ...(o.flush !== undefined && { flush: o.flush }),
    ...(by !== undefined && { covered: { by: { role: by.role, label: by.label, identifier: by.identifier, rect: { ...by.rect } }, shows: facts.shows } }),
    ...(o.eyes !== undefined && { eyes: o.eyes }),
    ...(o.detent !== undefined && { detent: o.detent }),
    ...(o.endTurn !== undefined && { endTurn: o.endTurn }),
  };
}

/** A share of an element, as a sentence quotes it: never rounded up to a reassuring 100 % — something is missing. */
const percent = (fraction: number): number => Math.min(Math.round(fraction * 100), 99);

/**
 * What of the app is drawn over a judged match, for a failure: `under
 * <cover> at its centre (x,y), drawn over it — N% of it shows` — the cover
 * the standing names (ui-tree/standing.ts#Scene.standing), at the centre
 * when it is the one over it (the point the next tap presses). A cover the
 * tree shows only by the cut (its overlaid edge, ui-tree/cover.ts
 * #CoverOrder's `overlaid`) is said as that cut, with no share: how far the
 * node runs on under it is not told.
 */
function underText({ judged, cover }: { readonly judged: Judged; readonly cover: Cover }): string {
  const { facts } = judged.standing;
  const clause = coverClause(cover, { of: 'touch', ...(cover === facts.centreCover && { centre: tapPoint(judged.node) }) });
  return cover.order.kind === 'overlaid' ? clause : `${clause} — ${percent(facts.shows)}% of it shows`;
}

/** When a stop that sends no swipe came: `before any swipe`, or `after N swipes, without swiping further`. */
const stoppedWhen = (swipes: number): string => (swipes === 0 ? 'before any swipe' : `after ${swipesText(swipes)}, without swiping further`);

/** The soft keyboard a match was judged under (`Judged.under`), as a cut-by remedy names it (target-text.ts#cutByRemedy). */
const keyboardUp = ({ under }: Judged): KeyboardUp | undefined => (under === undefined ? undefined : { lineY: under.line.y, remedy: under.remedy });

/** A plain stop's sliver (InFrameShort's `sliver`), in the tap's refusal's own words (target-text.ts#cutSliverText). */
function sliverText({ judged, cut, minPiece }: Extract<Shortfall, { of: 'sliver' }>): string {
  return cutSliverText(cut, judged.node.rect, minPiece, judged.under?.line.y);
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
  const surface = r.eyes?.sees === 'surface' ? r.eyes : undefined;
  if (fullyClaimed({ clipped: r.clipped, covered: r.covered !== undefined }) && surface === undefined) {
    const above = topCover === undefined ? '' : `, judged above the soft keyboard over ${frameText(topCover)}`;
    const unlocated = r.keyboard?.state === 'unlocated' ? `; ${UNLOCATED_KEYBOARD} — it was not judged and may cover the element` : '';
    // The eyes could not tell (ui-tree/eyes.ts): the claim is the tree's, and what it cannot see is said.
    const unjudged = r.eyes?.sees === 'unjudged' ? r.eyes : undefined;
    const claim = unjudged === undefined ? `fully visible after ${n}` : `fully visible by the tree after ${n}`;
    const eyes = unjudged === undefined ? '' : `; ${unjudgedText(unjudged)}`;
    return `${claim}${above}${flushText(r.flush)}${eyes}${unlocated}${moving}${endTurnText(r.endTurn)}${detentText(r.detent)}`;
  }
  // Partly under something of the app: a plain stop, its centre
  // clear — said like a clip, and with what a measurement would take in.
  const covered =
    r.covered === undefined ? undefined : `PARTLY UNDER ${nodeText(r.covered.by)}, drawn over it — ${percent(r.covered.shows)}% of it shows, its centre clear`;
  // Partly under a surface the tree does not list, the eyes saw (ui-tree/eyes.ts): said as a cover is.
  const unlisted = surface === undefined ? undefined : `${unlistedText(surface)}, its centre clear`;
  const clip = r.clipped.length === 0 ? undefined : describeClip(r.clipped, r.visible, topCover);
  const measures = clip !== undefined ? 'the CLIPPED box' : 'what is drawn over it too';
  return `visible after ${n} — ${[clip, covered, unlisted].filter((t) => t !== undefined).join('; ')}. A rect assert or screenshot on this element will measure ${measures}${moving}${endTurnText(r.endTurn)}${detentText(r.detent)}`;
}

/**
 * What the eyes saw over the target's edge (ui-tree/eyes.ts, `surface`), by a flush neighbour: `its bottom 28 px show
 * #F2F2F7, the colour beside container id:lab.form-keyboard.submit (55,1238 970x132) drawn after it, not its own
 * #FFFFFF (a screenshot)` — in tree units, which on Android (the only source with flush neighbours) are pixels; at a
 * clip line: `its bottom 24 pt read as the screen beside them (#FFFFFF), not its own #1E88E5: cut at the edge of a
 * scroll view the tree does not list (a screenshot)` — in points: only idb's flat list leaves a clip line untold.
 */
function surfaceText({ edge, by, depth, surface, own }: SurfaceFinding): string {
  if (by === CLIP_LINE) return `its ${edge} ${depth} pt read as the screen beside them (${surface}), not its own ${own}: cut at the edge of a scroll view the tree does not list (a screenshot)`;
  return `its ${edge} ${depth} px show ${surface}, the colour beside ${nodeText(by)} drawn after it, not its own ${own} (a screenshot)`;
}

/**
 * A stop the region the motion showed held back (interact/motion-shown.ts#CarriedUnder), as the stuck and bound
 * sentences say it: where the element lay against where its content was seen moving — short of the line a stroke over
 * it touches down on (`band`), or past its edge toward the node that held still (`still`) — and why no stop was claimed.
 */
function carriedUnderText(under: CarriedUnder): string {
  const it = under.part ? 'part of it' : 'it';
  const seen = `where its content was seen moving (${rectText(under.region)})`;
  if (under.by === 'still') {
    return (
      `${it} lay past the ${under.edge} edge of ${seen}, toward ${nodeText(under.still)}, which held still while it moved — ` +
      `the tree lists no scroll view, so whether it is drawn there, or lies under that (a header, a bar), it cannot tell, and no stop was claimed on it`
    );
  }
  const at = `${axisOfEdge(under.edge) === 'vertical' ? 'y' : 'x'} ${under.line}`;
  return (
    `${it} lay ${SIDES[under.edge].past} ${at}, where a stroke over ${seen} touches down carrying content away from its ${under.edge} edge — in the band ${rectText(under.band)} or past it — ` +
    `the tree lists no scroll view and lists a row carried under a header or a bar where it would lie, so whether it is drawn there it cannot tell, and no stop was claimed on it`
  );
}

/** The remedy for a tree that lists no scroll view (idb), as the sentences that need one say it. */
const UNTOLD_SCROLL_VIEW_REMEDY = 'under treeSource: wda the tree lists the scroll view, and scroll_until judges the element in it';

/** What the eyes saw, as a shortfall's head: `PARTLY UNDER a surface the tree does not list: …`, or at a clip line `CUT at a line the tree does not list: …` (`surfaceText`). */
const unlistedText = (finding: SurfaceFinding): string =>
  `${finding.by === CLIP_LINE ? 'CUT at a line' : 'PARTLY UNDER a surface'} the tree does not list: ${surfaceText(finding)}`;

/** The eyes could not tell (`unjudged`): the edge flush with that node, what may lie there, and why no screenshot settled it. */
function unjudgedText({ edge, by, why }: Extract<EyesFinding, { sees: 'unjudged' }>): string {
  return `its ${edge} edge lies flush with ${nodeText(by)}, drawn after it outside its scroll view, whose surface may draw past that node over it — the tree lists none there, and a screenshot could not tell (${why})`;
}

/** `1 swipe up did not move it`, `2 swipes up did not move it`, or — some of them moved it — `3 swipes up, the last of which did not move it` / `…, the last 2 of which did not move it`. */
function unmovedText({ after, unmoved, way }: EndTurn): string {
  if (unmoved >= after) return `${swipesText(after)} ${way} did not move it`;
  return `${swipesText(after)} ${way}, the last ${unmoved === 1 ? '' : `${unmoved} `}of which did not move it`;
}

/**
 * The end proof's one wording (course.ts#EndProof), in the end turn's clause and the bound's failure:
 * `the tree lists the content of scrollable (0,380 402x180) ending at its top`.
 */
const endText = ({ way, scrollView }: EndProof): string => `the tree lists the content of ${nodeText(scrollView)} ending at its ${EDGE_TOWARD[way]}`;

/**
 * The end turn's clause (course.ts#EndTurn), before the detent's in every reply and failure that made one —
 * `; 1 swipe up did not move it — the tree lists the content of scrollable (0,380 402x180) ending at its top — so
 * averi turned down, as the tree places the element below it`: the swipes the caller's way, why they proved the end
 * (`endText`), and that averi, not the caller, chose the way after. Empty when no end turn was made. Exported for the
 * troubleshooting reference, which quotes one rendering (tests/mcp/tool-descriptions.test.ts pins it).
 */
export const endTurnText = (turn: EndTurn | undefined): string =>
  turn === undefined ? '' : `; ${unmovedText(turn)} — ${endText(turn)} — so averi turned ${turn.to}, as the tree places the element ${SIDES[EDGE_TOWARD[turn.to]].past} it`;

/**
 * The detent clause, last in every reply and failure (scroll-rounds.ts#DetentMove): a sheet moved during the call —
 * a state change of the screen the verdict does not say, worded without a cause (a call that sent no swipe says it
 * too). Empty when it did not.
 */
const detentText = (detent: DetentMove | undefined): string => (detent === undefined ? '' : `; the sheet moved from its ${detent.from} detent to ${detent.to}`);

/**
 * The flush clause (scroll-rounds.ts#flushCheck): what the stop's edge on
 * its scroll container means — checked by a probe, or not checked. The
 * container is quoted as a node's rect (`rectText`): it is one. Exported for
 * the troubleshooting reference (tests/mcp/tool-descriptions.test.ts pins
 * its `axis` rendering).
 */
export function flushText(flush: ScrollUntilResult['flush']): string {
  if (flush === undefined) return '';
  const cut = "it may be cut there, a rect assert or screenshot may measure part of it";
  const box = rectText(flush.container);
  if ('edges' in flush) {
    // A node pinned at the content's start (scroll-rounds.ts#Flush: always `edges[0]`): the match spans from that
    // node's inner edge to the container's far edge — cut at either, by Compose at the node or by the container.
    if (flush.pinned !== undefined) {
      const [start, end] = flush.edges;
      return (
        `; but it spans its scroll container (${box}) from the edge of ${nodeText(flush.pinned)}, pinned at the container's ${start} and drawn after it, ` +
        `to the container's ${end} edge — its ${start} edge lies on that node's, its ${end} edge on the container's, where Android cuts a node's bounds ` +
        `at a node drawn over it or to the container, and no probe swipe can tell which side, if either, is cut — ${cut}; check with a screenshot`
      );
    }
    // The usual benign case named, so the reader weighs the warning: a card
    // as tall as its horizontal carousel inside a vertical list fills the
    // carousel.
    return (
      `; but it fills its scroll container (${box}) exactly — its ${flush.edges.join(' and ')} edges lie on ` +
      `the container's, where Android cuts a node's bounds to the container, and no probe swipe can tell which side, if either, is cut — ${cut}; ` +
      'usual for a card as tall as its carousel — check with a screenshot'
    );
  }
  // A pinned node's edge (scroll-rounds.ts#Flush's `pinned`): where the container's content ends as it shows, and the
  // cut it may make is Compose's at a node drawn after the match, not the container's.
  const where =
    flush.pinned === undefined
      ? `its ${flush.edge} edge lies on its scroll container's (${box})`
      : `its ${flush.edge} edge lies on the edge of ${nodeText(flush.pinned)}, pinned at its scroll container's (${box}) ${flush.edge} and drawn after it`;
  const cuts = flush.pinned === undefined ? "where Android cuts a node's bounds to the container" : "where Android cuts a node's bounds at a node drawn over it";
  if (flush.checked) return `; ${where}, and a probe swipe toward it moved nothing — nothing of it is cut there`;
  const unchecked = {
    budget: 'no swipe or time was left to check it',
    room: 'no scroll container around it has room for a probe swipe to check it',
    axis: `every scroll container around it from that one outward scrolls only ${axisOfEdge(flush.edge) === 'vertical' ? 'sideways' : 'up and down'}, so no probe swipe can move its ${flush.edge} edge into view to check it`,
    tap: 'the probe swipe was too short to tell from a tap',
  }[flush.why];
  return `; but ${where}, ${cuts}, and ${unchecked} — ${cut}`;
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
function hideToJudgeWholeScreen(remedy: KeyboardRemedy): string {
  return hideClause(remedy, `to reach it with the keyboard down, hide it first (${hideKeyboardHow(remedy)}) and scroll again`);
}

/** What the stop judged against, for "never intersected …". */
const frameWords = (viewport: DeviceScreen, cover: AppliedKeyboard | undefined): string =>
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

/**
 * `, and the next swipe would touch down at (x,y) on <the surface>` — where the `presented` stop's held-back stroke
 * would have landed (`next`); empty when it was judged in the frame. A touch-down outside where the surface reaches is
 * said to land on the dim outside it: Android's dialog window, listed alone, reaches only its own rect, and a touch
 * beside it lands on the dim the dialog lays around it (which dismisses it) —
 * docs/bugs/2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md. Exported for the
 * troubleshooting reference (tests/mcp/tool-descriptions.test.ts pins the dim's rendering).
 */
export const touchDownText = (next: PresentedTouchDown | undefined): string =>
  next === undefined
    ? ''
    : `, and the next swipe would touch down at ${pointText(next.touchDown)} on ${containsPoint(next.reach, next.touchDown) ? '' : 'the dim outside '}${coverText(next.surface, next.reach)}`;

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
  const full = `${message}${endTurnText(o.endTurn)}${detentText(o.detent)}`;
  return absence === undefined ? new Error(full) : absenceError(full, absence);
}

/** Where a scroll view's content stops short of the element it cuts (ui-tree/standing.ts#ScrollViewCut's `stopsShort`), as the stuck sentence says it. */
const CONTENT_STOPS_SHORT: Record<ScrollViewCut['stopsShort'], string> = {
  after: 'its content ends before the element does (no room after it — a layout defect)',
  before: 'its content begins after the element does (no room before it — a layout defect)',
  both: 'its content stops short of the element at those edges (no room past them — a layout defect)',
};

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
      // Cut by a node drawn after it (geometry.ts#Cut.by): the rest stays under that node — with the keyboard up and that node riding on it (target-text.ts#ridingKeyboard), dismiss it first.
      if (short.of === 'sliver' && short.cut.by !== undefined) {
        const keyboard = ridingKeyboard(short.cut.by, keyboardUp(judged), short.minPiece);
        return {
          message:
            `scroll_until ${describe} failed after ${n} — element is in the viewport but ${sliverText(short)} — and the content is exhausted: ` +
              `swiping ${o.lastStroke} no longer moves it${neither}. The rest of it may stay under that ${short.cut.by.role} at the end of the content — ` +
              `${keyboard === undefined ? 'a layout defect (no clearance for a pinned bar?)' : `${dismissKeyboardFirstText(keyboard)}, and scroll again`} — ` +
              `or it is only that thin, laid flush against it; a tap refuses it so cut (${wholeThinWayPast(short.cut.by)}). ${last}`,
        };
      }
      if (short.of === 'sliver') {
        return {
          message:
            `scroll_until ${describe} failed after ${n} — element is in the viewport but ${sliverText(short)} — and the content is exhausted: ` +
              `swiping ${o.lastStroke} no longer moves it${neither}. The rest of it stays past its container's edge at the end of the content — a layout ` +
              `defect (no room beyond it?), or its own content runs to its edge, which reads as cut; a tap refuses it so cut (${cutRemedy(short.cut.edge)}). ${last}`,
        };
      }
      // A band of a surface the tree does not list, the eyes saw (ui-tree/eyes.ts), at the end of the content: the rest
      // of it stays under that surface — with the keyboard up and the node riding on it, dismiss it first.
      if (short.of === 'unlisted') {
        const neighbour = short.finding.by;
        // At a clip line the tree does not list (idb's flat list): the strokes went over the screen, which may not be
        // over the scroll view that holds it — the remedy is the tree source that lists it.
        if (neighbour === CLIP_LINE) {
          return {
            message:
              `scroll_until ${describe} failed after ${n} — element is in the viewport but ${surfaceText(short.finding)} — and swiping ${o.lastStroke} no longer moves it${neither}. ` +
                `The tree lists no scroll view, so the strokes went over the screen, perhaps not over the one that holds it — under treeSource: wda the tree lists it, ` +
                `and scroll_until strokes over it. ${last}`,
          };
        }
        // The keyboard as the round's reading offered it, unwitnessed (the band was moot: the match lies above it) — so an "if".
        const keyboard = ridingKeyboard(neighbour, short.offered, judged.standing.facts.minPiece ?? 0);
        const away = o.otherWay === 'outward' ? `, and swiping ${back} would only push it further under that surface` : neither;
        const why =
          keyboard === undefined
            ? 'a layout defect (no clearance for a pinned bar?)'
            : `if the soft keyboard is still up (the window state reads its top edge at y ${keyboard.lineY}, that node riding on it), dismiss it first (${hideClause(keyboard.remedy)}) — a bar riding on it goes down with it — and scroll again; else a layout defect (no clearance for a pinned bar?)`;
        return {
          message:
            `scroll_until ${describe} failed after ${n} — element is in the viewport but ${surfaceText(short.finding)} — and the content is exhausted: ` +
              `swiping ${o.lastStroke} no longer moves it${away}. That surface stays over it at the end of the content — ${why}. ${last}`,
        };
      }
      if (short.of === 'carriedUnder') {
        return {
          message:
            `scroll_until ${describe} failed after ${n} — element is on the screen but ${carriedUnderText(short.under)} — and swiping ${o.lastStroke} no longer moves it${neither}; ` +
              `${UNTOLD_SCROLL_VIEW_REMEDY}. ${last}`,
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
      // Clipped at the end of the content, worded by what cuts it (scroll-read.ts#ClipCause).
      const { clipped, visible } = judged.standing.facts;
      switch (short.cause.of) {
        // The keyboard's edge: the keyboard, not the layout, is what hides the rest — a container that does not resize
        // for it keeps its last rows under it. Said as such, with how to hide it; the layout-defect wording only when
        // the keyboard is not the edge in question.
        case 'keyboard': {
          const { keyboard } = short.cause;
          return {
            message:
              `scroll_until ${describe} failed after ${n} — element is in the viewport but ` +
                `${describeClip(clipped, visible, keyboard.topCover)}, and the content is exhausted: swiping ${o.lastStroke} ` +
                `no longer moves it${neither}. The soft keyboard covers the rest — ${hideToJudgeWholeScreen(keyboard.remedy)}; only if it ` +
                `stays clipped with the keyboard down is it a layout defect. ${last}`,
          };
        }
        // Its scroll view's edge inside the screen, at an edge or more: each edge named with what cuts it, the part
        // drawn quoted, and why the rest may stay past that scroll view — no overlay diagnosed for its edge.
        case 'scrollView': {
          const { edges, scroller, longer, stopsShort } = short.cause.cut;
          const byScreen = clipped.filter((edge) => !edges.includes(edge));
          const at = `${edges.join('/')} ${outsideScrollViewText(scroller, 'by')}${byScreen.length === 0 ? '' : ` and at ${byScreen.join('/')} by the viewport`}`;
          const past = byScreen.length > 0 ? 'those edges' : edges.length > 1 ? "that scroll view's edges" : "that scroll view's edge";
          const rest =
            longer !== undefined
              ? `It is ${longer} than what of its scroll view the screen shows: no scroll shows it whole.`
              : `The rest lies past ${past}: either the swipes do not scroll that scroll view (swipe inside it), or ${CONTENT_STOPS_SHORT[stopsShort]}.`;
          return {
            message:
              `scroll_until ${describe} failed after ${n} — element is in the viewport but CLIPPED at ${at}: ${percent(visible)}% of it is drawn, and the content is exhausted: ` +
                `swiping ${o.lastStroke} no longer moves it${neither}. ${rest} ${last}`,
          };
        }
        // The viewport's edge. A cover clipping only the top still words the frame (`judged.under`): that is the
        // frame the element is clipped in, not what cuts it — the cut is the viewport's.
        case 'viewport':
          return {
            message:
              `scroll_until ${describe} failed after ${n} — ` +
                `element is in the viewport but ${describeClip(clipped, visible, judged.under?.topCover)}, ` +
                `and the content is exhausted: swiping ${o.lastStroke} no longer moves it${neither}. ` +
                `The element cannot be fully revealed — that is a layout defect ` +
                `(no clearance for an overlay?), not a scroll that needs more swipes. ${last}`,
          };
        default: {
          const unworded: never = short.cause;
          return unworded;
        }
      }
    }
    case 'covered': {
      // The absence rule holds here too: a target no
      // read has matched is ElementNotFoundError, so an `optional:` step is
      // skipped "(not present)" — with the keyboard named, since no swipe
      // could look further.
      const { cover, viewport } = o;
      const seenAs = o.evidence.sighted ? 'the element is in the tree but under the soft keyboard' : withMissNote('element never appeared in the tree', o.evidence.miss);
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
      const when = stoppedWhen(o.swipes);
      const layer = next === undefined ? o.layer : next.layer;
      if (judged === undefined) {
        // No target in the tree: the next swipe would have landed on a layer the tree marks as presented
        // (`Scene.presentedAt`, asked for no target).
        return { message: `scroll_until ${describe} stopped ${when} — element is not in the tree${touchDownText(next)} — ${presentedStop(layer)}, so ${o.swipes === 0 ? 'none' : 'no further swipe'} was sent.` };
      }
      const where =
        next === undefined
          ? `element is in the viewport but ${underText({ judged, cover: o.cover })}`
          : `${notInViewportText(judged, viewport)}${touchDownText(next)}`;
      return {
        message:
          `scroll_until ${describe} stopped ${when} — ${where} — ${presentedStop(layer)}, so ${o.swipes === 0 ? 'none' : 'no further swipe'} was sent. ` +
            `Last rect ${JSON.stringify(judged.node.rect)} in a ${viewport.width}x${viewport.height} viewport`,
      };
    }
    case 'overlapped': {
      // Under a cover listed in reading order with it (ui-tree/standing.ts#Remedy's `unordered` or `seenOver`): stopped
      // without a swipe, as under a presented screen. A plain Error, as `stuck`: the element was there and seen.
      const { judged, viewport, remedy } = o;
      return {
        message:
          `scroll_until ${describe} stopped ${stoppedWhen(o.swipes)} — element is in the viewport but ${underText({ judged, cover: o.cover })}; ` +
            `${o.swipes === 0 ? 'no swipe' : 'no further swipe'} was sent — ${orderRemedyText(remedy, 'touch')}. ` +
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
    case 'changed':
      return { message: changedText(o, describe) };
  }
}

/**
 * The `changed` stop (ui-tree/read-tree.ts#ScreenChange): the swipe CHANGED THE SCREEN — said loud, with its evidence (the
 * ids gone, where it touched down), what it likely was, and that nothing found after it is claimed. A plain Error,
 * never absence: the scroll did not look and miss, its own stroke replaced the screen, and an `optional:` step must
 * not skip it as "(not present)".
 */
function changedText(o: Extract<ScrollOutcome, { kind: 'changed' }>, describe: string): string {
  const { touchDowns, gone } = o.change;
  const shown = `${gone.slice(0, CHANGED_IDS_QUOTED).map((id) => `id:${JSON.stringify(id)}`).join(', ')}${gone.length > CHANGED_IDS_QUOTED ? ', …' : ''}`;
  const ids =
    gone.length === 1
      ? `the one element the read before it listed by id (${shown}) is not in the tree after it`
      : `none of the ${gone.length} elements the read before it listed by id (${shown}) is in the tree after it`;
  const at = touchDowns.map(pointText).join(', ');
  const target = o.found
    ? 'The element is in the tree only after that change, on the new screen: not judged, not claimed visible'
    : 'The element is not in the tree after it either';
  return (
    `scroll_until ${describe} stopped after ${swipesText(o.swipes)} — the swipe CHANGED THE SCREEN: ${ids}, ` +
    `and nothing it touched down on at ${at} is still listed — it most likely dismissed a sheet or a modal presented over the screen, ` +
    `or the app left the screen. ${target}, and no further swipe was sent. ` +
    'If a sheet or a modal was open, it is gone: reopen it if the flow needs it — a target beneath one is reached by closing it first, never by scroll_until'
  );
}

/** How many of the ids gone the `changed` stop quotes. */
const CHANGED_IDS_QUOTED = 3;

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

/** Which bound ended it, as the failure's cause. Exported for the troubleshooting reference (tests/mcp/tool-descriptions.test.ts pins the proven end's rendering). */
export function boundText(by: BoundBy, swipes: number): string {
  switch (by.of) {
    case 'exhausted': {
      // `tree`: there is no match to watch, so the sentence
      // says what was watched — the whole screen. `touched` (the
      // floating tab bar): the strokes touched down on a node drawn over the
      // list, so THAT is named first — not led by "content exhausted", which
      // a flow reads as "the list ends" — and the other causes after it: the
      // tree cannot say the node takes touches.
      const verb = by.unchanged === 'tree' ? 'did not change the screen' : 'did not move it';
      // Proven by the tree (scroll-rounds.ts#BoundBy's `ends`): where the content ends is listed — no other cause to keep.
      if (by.ends !== undefined) {
        const which = by.ends.unmoved === 1 ? `swiping ${by.ends.way}` : `the last ${by.ends.unmoved}, swiping ${by.ends.way},`;
        return `after ${swipesText(swipes)} (${which} ${verb}: ${endText(by.ends)} — content exhausted)`;
      }
      const others = by.unchanged === 'tree' ? 'content exhausted, still loading' : 'content exhausted';
      const why = by.touched !== undefined ? `${touchedText(by.touched)} (else: ${others})` : `${others}, or the swipes were not taken`;
      return `after ${swipesText(swipes)} (the last ${UNMOVED_STROKES_EXHAUST}, swiping ${by.lastStroke}, ${verb}: ${why})`;
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

/**
 * Strokes over a scroll view whose reads listed none of its content where their motion would show
 * (motion-ledger.ts#UnseenStrokes), at a bound: `after the last 5 swipes over the scroll container 0,550 1080x1670 the
 * tree listed none of its content where a swipe's motion would show (blank space, content with no node, or a node cut
 * at both of the container's edges), so how far they moved it is unknown — the element may lie further down: raise
 * maxSwipes or timeoutMs`. "How far", not "whether": the first of them may have carried the last content shown off
 * the viewport, which shows it moved — but not how far.
 */
function unseenText({ strokes, within, toward }: UnseenStrokes): string {
  const which = strokes === 1 ? 'the last swipe' : `the last ${strokes} swipes`;
  return (
    `after ${which} over the scroll container ${rectText(within)} the tree listed none of its content where a swipe's motion would show ` +
    `(blank space, content with no node, or a node cut at both of the container's edges), so how far ${strokes === 1 ? 'it' : 'they'} moved it is unknown — ` +
    `the element may lie further ${toward}: raise maxSwipes or timeoutMs`
  );
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
    case 'unlisted':
      return `element reached the viewport but stayed ${unlistedText(short.finding)} (last rect ${JSON.stringify(short.judged.node.rect)})`;
    case 'carriedUnder':
      return `element reached the screen but ${carriedUnderText(short.under)} (last rect ${JSON.stringify(short.judged.node.rect)}); ${UNTOLD_SCROLL_VIEW_REMEDY}`;
    case 'systemBar': {
      const { judged } = short;
      const region = short.band === undefined ? '' : ` — fully: true stops only with none of it under the bar (${centreClear(short)})`;
      return `element reached the viewport but ${systemBarText(short)}${region} (last rect ${JSON.stringify(judged.node.rect)})`;
    }
    case 'sliver': {
      const { by } = short.cut;
      const remedy = by === undefined ? cutRemedy(short.cut.edge) : cutByRemedy(by, keyboardUp(short.judged), short.minPiece);
      return `element reached the viewport but stayed ${sliverText(short)} (last rect ${JSON.stringify(short.judged.node.rect)}) — a tap refuses it so cut (${remedy})`;
    }
    case 'absent':
      return `${withMissNote('element never appeared in the tree', short.miss)}${short.unsearched !== undefined ? ` — ${untriedSideText(short.unsearched)}` : ''}${short.unseen !== undefined ? `; ${unseenText(short.unseen)}` : ''}`;
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
