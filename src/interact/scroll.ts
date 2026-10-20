import type { DeviceAdapter, Stroke } from '../adapters/types.js';
import { orderSeenBy, unseen, type Eyes } from '../ui-tree/eyes.js';
import { readTreeOrError } from '../ui-tree/read-tree.js';
import { readKeyboard, type KeyboardReading } from '../ui-tree/keyboard-cover.js';
import { sleep } from '../util/sleep.js';
import { describeTarget, matchesToJudge, type Target } from './resolve.js';
import { round, startRounds, type RoundSeen, type Rounds, type RoundStep } from './scroll-rounds.js';
import { scrollFailure, scrollResult, type ScrollUntilResult } from './scroll-text.js';
import { dragMs, screenBox, type Direction, type ScreenBox } from './swipe.js';

export { describeScrollResult, type ScrollUntilResult } from './scroll-text.js';

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
  /**
   * The eyes a `fully visible` claim is confirmed with (ui-tree/eyes.ts; verify/eyes.ts#eyesOn, which the composition
   * root hands in — mcp/tools.ts, flow/engine.ts). Absent: a claim the eyes would be asked of is said as the tree's,
   * unchecked ("fully visible by the tree … a screenshot could not tell (no screenshot was taken)").
   */
  eyes?: Eyes;
}

/**
 * What a scroll needs of a device: the tree, the screen's size,
 * the stroke and how fast it may be drawn (`dragSpeed`), and the keyboard's oracle and advice for the round's reading
 * (`readKeyboard`) — nothing it does not use, so a caller with a narrower
 * adapter can scroll, and a reader sees what a scroll can touch. Every
 * reader the driver hands it to takes a `Pick` of its own
 * (`readTreeOrError`, `screenBox`, `readKeyboard`).
 */
export type ScrollAdapter = Pick<DeviceAdapter, 'uiTree' | 'viewport' | 'swipe' | 'keyboard' | 'keyboardAdvice' | 'dragSpeed'>;

/**
 * Swipe until the element is present AND visibly inside the viewport
 * (ARCHITECTURE.md §4, C1). Throws with a diagnosis of the last tree.
 *
 * THE DRIVER: the production
 * adapter of interact/scroll-rounds.ts#round. It owns every I/O of the
 * scroll — the tree read, the judging screen, the round's keyboard reading
 * and its two questions, the stroke's box and points, the swipe, the
 * settle — and none of its rules: each round it gathers what it saw into a
 * `RoundSeen`, asks `round` what that means, and does the step. What the
 * rounds decide, in what order, and how many there can be, is
 * scroll-rounds.ts's doc; what the scroll says, scroll-text.ts's. The
 * device behaviour that shaped those rules is recorded below.
 *
 * `fully: true` raises the bar from "intersects" to "entirely inside", and
 * keeps swiping until it is — then fails naming the shortfall when the content
 * runs out first. That failure message IS the app bug in the measured case:
 * a scroll container with no clearance for the floating bottom-nav bar can
 * never fully reveal its last row, however far it scrolls. Default stays
 * `false`: the stop condition is unchanged, only the REPORT gains the truth.
 * Both bars also count what the app draws over the element
 * (ui-tree/standing.ts#Scene.standing owns the rule): `fully: true` with
 * nothing drawn over any of it, the default with nothing drawn over its
 * centre — the point the next tap presses.
 * docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md
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
 * the last read succeeded — throws ElementNotFoundError (the
 * rule's one owner is resolve.ts's absenceError) with the same "element
 * never appeared in the tree" wording,
 * so an `optional:` scroll_until to an element that is not on this screen
 * is skipped "(not present)" like a tap or a fill would be. Every other stop
 * (found but clipped or off the viewport, a failed last read, content that
 * ran out) stays a plain Error: the element was there, or nobody could see.
 *
 * The soft keyboard:
 * docs/bugs/2026-10-08-scroll-until-ignores-android-soft-keyboard.md
 * Measured on Android, an element wholly under the IME was "fully visible
 * after 0 swipes", and with the IME up a content-down stroke — through the
 * screen centre, its start at y ≈ 1776 of 2220 — began on a key and scrolled
 * nothing for 15 s; the same on iOS 27 with the pad up (y ≈ 699 of 874). So
 * every round reads the keyboard the way the tap guard and the pixel poll do
 * — a reading off the round's tree (`readKeyboard`: the oracle on Android,
 * the WDA band on iOS; what it asks the device is counted on
 * ui-tree/keyboard-cover.ts, WHAT A READING ASKS) — and
 * judges the round twice, over the whole screen and over the screen ABOVE a
 * shown keyboard (scroll-read.ts#offeredKeyboard): an element under it scores 0 or is clipped at
 * the keyboard's edge, and the stroke keeps clear of it
 * (`swipeVectorAbove`: the whole screen's stroke, its point on or near the
 * keyboard pulled up — the iOS device check, below), so it starts on
 * the content. The keyboard's own nodes (a key
 * as the target) are judged against the whole screen, as a reading reads
 * them `unknown` for a subject. `hidden`, `unknown`: the whole screen,
 * the guard's fail-open rule; an unread tree strokes in the box
 * the last read round's band left, the stop already
 * quoting the read error. Landscape: the judgement, the
 * band's `above` box and the stroke all use the round's `screenBox` box —
 * turned when the tree's window says so — the screen the tap's on-screen
 * rule judges too (ui-tree/usable-screen.ts#usableScreen owns it); the band's frame is
 * the oracle's or the tree's, in the tree's coordinates already. The
 * whole-screen judgement runs over the usable screen's `boxes`, the tap's
 * own — both ways up (the better of the two) only when a turn is
 * suggested but not witnessed — so the stop and the tap agree by
 * construction; the band's `above` box stays the chosen one. Unmeasured on
 * a device held sideways.
 *
 * The band is APPLIED only when it changes the round — the two judgements
 * differ, or the round ends in a stroke or a failure rather than a clean
 * stop — and only once the input method has not denied it
 * (the reading's `corroborated`: the guard's veto, its one owner
 * `witnessDenies` in ui-tree/keyboard-cover.ts). The window state was measured
 * stale for seconds after a navigating tap, and a phantom band would score
 * an on-screen target 0, send a stroke through the next screen and report
 * a keyboard that is gone. The witness is asked on EVERY round a band
 * matters and its answer is not kept: a
 * stale window on round 0 can be followed by a real keyboard — a new
 * screen that auto-focuses a field — and a confirmed keyboard can be hidden
 * by the scroll itself (a list that dismisses it on drag) and leave the
 * window state stale-shown behind it. What a round asks the device is
 * counted on ui-tree/keyboard-cover.ts (WHAT A READING ASKS), the one place
 * it is. The rounds — strokes and confirming reads alike — number at most
 * 1 + (1 + SETTLE_CONFIRM_READS) × `maxSwipes`, 25 at the defaults, besides a
 * slowing fling's reads (scroll-rounds.ts#SETTLE_CONFIRM_READS), bounded by the
 * deadline — and stop at the deadline whichever comes first. A failed or `fully: true`
 * stop may add one more query, the `unlocated` row's (below). A band that does not change the round is not reported
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
 * keyboard and the way to hide it, not a "fully visible"; a row WHOLLY
 * under it there fails the same way after the two swipes that did not move
 * it (below), not at the timeout.
 *
 * The device check of that fix (the note's two "Device check" sections)
 * found three more things, each fixed where it lives:
 * - The stroke (`swipeVectorAbove`): drawn over the box above the keyboard,
 *   a content-up stroke touched down in the app's top bar and moved nothing
 *   under WDA. It is still the uncovered box's stroke, its touch-down never
 *   inside the keyboard clearance nor higher than without a keyboard; the
 *   length is not cut. Only the covered area's top edge (`topCover.y`) is read:
 *   the band need not be full width nor reach the bottom.
 * - The stop is SETTLED (scroll-rounds.ts#SETTLE_CONFIRM_READS): a
 *   stop reached after a stroke is reported only once a further read, after
 *   another settle, finds the target where the stop's read did and the stop
 *   still holds — under WDA the settle read caught a flung row inside the
 *   viewport, "fully visible after 1 swipe", and it came to rest at y -48 to
 *   -133. A target that moved is judged from the new read like any round;
 *   one that never holds still, or a stop at the deadline, is reported with
 *   `settled: false`. A fling that carried the target across the frame —
 *   beyond its far edge, after a read saw it short of that — turns the next
 *   stroke round (scroll-rounds.ts#nextStroke), instead of swiping on into
 *   exhausted content (measured: 613 → -357, then five swipes down that
 *   moved nothing), and every turn halves the reach of the strokes after it
 *   (equal flings both ways ping-ponged to `maxSwipes`).
 *   A target a lazy list dropped right after a read had it
 *   short of the far edge turns the strokes back too
 *   (scroll-rounds.ts#observe, `dropped`). A failure counts the turns, and
 *   one after the target was in the frame — or only in the tree — says so
 *   rather than "never".
 * - The fling itself:
 *   docs/bugs/2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md
 *   A 1332-px Android stroke in 300 ms moved
 *   Settings' 1417-px list ≈ 2190 px, so a row could pass from below it to
 *   above it between two reads, in none — `Display` two rows below the fold
 *   was never reached. Each stroke is drawn over the target's scroll
 *   container (the screen's largest before the target is read in one;
 *   the round decides the box through its stroke plan, interact/stroke-plan.ts, above the keyboard
 *   and, for content below, above a node drawn over the
 *   container's lower part — a floating tab bar took the touch-down),
 *   its length the container's, and on an adapter
 *   with a `dragSpeed` (Android) at that speed (swipe.ts#dragMs) — the
 *   time it costs against the 15 s default is on adapters/android.ts
 *   #dragSpeed; the default is unchanged.
 * - Exhausted (scroll-rounds.ts#UNMOVED_STROKES_EXHAUST): a
 *   target in the tree, off the frame, with a non-zero rect, that two
 *   identical strokes in a row left — with every other match — where it was,
 *   fails then, with the stop bound's words (they name the keyboard and the
 *   remedy), cause "the last 2 … did not move it: content exhausted, or the
 *   swipes were not taken" — measured on Android, the form's last field
 *   under the IME swiped for the whole 15 s. The `fully: true` clipped
 *   stop's stuck test takes the same two identical strokes (it watches the judged match alone — a visible clipped match that does
 *   not move is the defect it reports). For both, only strokes count: a
 *   confirming read sent none.
 *
 * Android's clipped bounds:
 * docs/bugs/2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container.md
 * uiautomator cuts each node's bounds to its scroll container, so a row
 * half behind a pinned bar read whole and `fully: true` said "fully visible
 * after 0 swipes". Each round hands the reducer its tree, from which it
 * reads every match's nearest clipping ancestors (ui-tree/geometry.ts
 * #clipsOf, `Clips.scrollersOf`, over the `clipsDescendants` the parser sets), and a `fully: true` stop flush with
 * one of them is answered with one short probe toward that edge, drawn over
 * a container with room for it above the keyboard (scroll-rounds.ts
 * #PROBE_REACH has the rule and its cost; interact/stroke-plan.ts the box).
 * Only the screen box comes from here — the round decides the stroke's.
 *
 * The unlocated keyboard (ui-tree/keyboard-cover.ts#UNLOCATED_KEYBOARD — the input
 * method says shown, the window state gives it no area: one still coming
 * up? not measured. Not the floating keyboard any more: measured on API 33,
 * a floating Gboard keeps a band and its panel is read from the window's
 * touchable region, `offeredKeyboard`): on a failed stop, and on a
 * `fully: true` stop — where the answer changes what the reader does next —
 * a window reading `hidden` is checked once against the input method
 * (the reading's `unlocated`); when it says shown, the report says the keyboard
 * could not be placed.
 * Nothing is judged against it — there is no frame — and nothing is
 * pressed. Not on a default clean stop: a witness query on every one buys a
 * sentence nobody acts on.
 *
 * The eyes (ui-tree/eyes.ts; live case k7, ADR 0013): a stop about to say
 * "fully visible" on a target laid flush with a node drawn after it outside
 * its scroll view asks `ScrollOptions.eyes` once — one screenshot — whether
 * a surface of that node the tree does not list lies over the target's edge;
 * the round decides what the answer means (scroll-rounds.ts#round). Every
 * other stop takes none.
 */
export async function scrollUntilVisible(
  adapter: ScrollAdapter,
  target: Target,
  opts: ScrollOptions = {},
): Promise<ScrollUntilResult> {
  const settleMs = opts.settleMs ?? 400;
  const describe = describeTarget(target);
  // The device's screen, read before the loop, so a device whose screen
  // cannot be read fails here rather than as "never intersected" — and the
  // frame the rounds judge in until a round reads one of its own.
  const asBuilt = await adapter.viewport();
  const started = Date.now();
  const rules = {
    direction: opts.direction ?? 'down',
    maxSwipes: opts.maxSwipes ?? DEFAULT_MAX_SWIPES,
    fully: opts.fully === true,
    timeoutMs: opts.timeoutMs ?? DEFAULT_SCROLL_TIMEOUT_MS,
  };
  let state: Rounds = startRounds(rules, asBuilt);
  let drawn: Stroke | undefined;
  for (;;) {
    // A failed read is a miss, not a failure — see readTreeOrError. Timed
    // alone (`readMs`), failed or not: a timeout says how long the reads took,
    // so one spent by a tree source restarting under the scroll does not read
    // as the content's fault.
    const readStarted = Date.now();
    const read = await readTreeOrError(adapter);
    const readMs = Date.now() - readStarted;
    const { tree } = read;
    // The round's screen box (swipe.ts#screenBox), read once and handed to
    // the round whole (`RoundSeen.screen`): the frame it judges in and the
    // gesture box it decides the stroke's box over.
    // Oriented by this round's tree; after a failed read, the device box
    // as built (its note is not reported here, the stop already quotes the
    // read error); the device size is memoized. When there is none it does
    // not throw here: the round judges on, and only a stroke — which needs
    // a box — throws its error.
    let screen: ScreenBox | undefined;
    let noBox: unknown;
    try {
      screen = await screenBox(adapter, read);
    } catch (e) {
      noBox = e;
    }
    // The keyboard this round, off this round's tree (no subject: every
    // match is judged against it, the keyboard's own exempted). ONE reading
    // a round, never held across rounds (ui-tree/keyboard-cover.ts): the
    // round gets its synchronous facts — the cover, which nodes are the
    // keyboard's own — and its two questions only as answers to an `ask`.
    // Asked in the reading's order: the screen, then `cover()` (the state,
    // and the region while it reads shown).
    let reading: KeyboardReading | undefined;
    let seen: RoundSeen;
    if (tree === undefined) {
      // `?? new Error(…)` is unreachable: readTreeOrError sets `error` whenever
      // `tree` is not, but TreeRead's type cannot say so. Its wording is a
      // plain Error's, not the absence one's (ElementNotFoundError): a read
      // that returned nothing is a miss, as every failed read is.
      seen = { read: { error: read.error ?? new Error('the UI tree read returned nothing') }, elapsedMs: 0, readMs };
    } else {
      // The matches the round judges: the one the next tap would act on, when the preference picks one (resolve.ts#matchesToJudge).
      const found = matchesToJudge(tree, target);
      reading = readKeyboard(adapter, tree);
      const cover = await reading.cover();
      // The tree itself: what the round asks of it — the matches' clipping
      // ancestors, the largest scroller, the fingerprint, progress — it
      // derives (scroll-read.ts#TreeFacts); nothing to hand in or forget.
      seen = {
        read: {
          tree,
          found,
          ofKeyboard: reading.ofKeyboard,
          remedy: reading.remedy,
          ...(cover !== undefined && { cover }),
        },
        elapsedMs: 0,
        readMs,
      };
    }
    if (screen !== undefined) seen.screen = screen.usable;
    if (drawn !== undefined) seen.drawn = drawn;
    drawn = undefined;
    // The clock is stamped on every call, re-entry included: a witness that
    // waits out its timeout counts against the deadline the round consults
    // after it.
    let next = round(state, { ...seen, elapsedMs: Date.now() - started });
    while (next.step.do === 'ask') {
      if (next.step.what === 'witness') seen.corroborated = reading !== undefined && (await reading.corroborated());
      else if (next.step.what === 'eyes') seen.eyes = opts.eyes === undefined ? unseen(next.step.question, 'no screenshot was taken') : await opts.eyes.fully(next.step.question);
      else if (next.step.what === 'order') seen.order = await orderSeenBy(opts.eyes, next.step.question);
      else seen.unlocated = reading !== undefined && (await reading.unlocated());
      next = round(state, { ...seen, elapsedMs: Date.now() - started });
    }
    state = next.state;
    const step: Exclude<RoundStep, { do: 'ask' }> = next.step;
    if (step.do === 'stop') {
      const { outcome } = step;
      if (outcome.kind === 'visible') return scrollResult(outcome);
      throw scrollFailure(outcome, describe);
    }
    if (step.do === 'stroke') {
      // The stroke is the round's, made by its plan (`step.points`, interact/stroke-plan.ts#planStroke, or
      // #planProbe for the flush check): over the target's scroll view met with this round's screen box and kept
      // above the keyboard and what is drawn over that scroll view, or the screen box whole — decided once, there,
      // with the points the plan asked the scene about at their touch-down; here they are only sent, as they are, and
      // handed back as the next round's `drawn`. No points: this round had no screen box to stroke in. `toward`
      // names where the CONTENT lies — the finger moves the other way (content below → finger up; swipe.ts#swipeVector).
      // Under a cover the stroke is swipe.ts#swipeVectorAbove's (the iOS device check): the uncovered box's stroke,
      // its touch-down never inside the keyboard clearance nor higher than without a keyboard — the stroke over the
      // box above it alone touched down in the app's top bar for a content-up scroll. A 0×0 viewport does not throw
      // above (pre-existing): the stroke then falls back to the tree's window while the stop still judges against
      // 0×0.
      // Drawn at the adapter's drag speed when it has one (Android:
      // adapters/android.ts#dragSpeed has the measured fling and
      // the time it costs), so one stroke moves the content about its own
      // length and a row cannot cross the list between two reads; else at
      // the adapter's default duration (iOS).
      const { points } = step;
      if (points === undefined || screen === undefined) throw noBox;
      drawn = points;
      if (adapter.dragSpeed === undefined) await adapter.swipe(drawn.from, drawn.to);
      else await adapter.swipe(drawn.from, drawn.to, dragMs(drawn, adapter.dragSpeed, screen.usable.oriented));
    }
    await sleep(settleMs);
  }
}
