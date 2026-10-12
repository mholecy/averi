import { rectArea, SCREEN_SIZED_FRACTION, usableScreen, type DeviceAdapter, type Rect, type UiNode } from '../adapters/types.js';
import { drawOrder } from '../ui-tree/draw-order.js';
import type { ElementSpec } from '../ui-tree/element-spec.js';
import { belowStatusBand, containsPoint, inferScreenSize, insideScroller, nodeText, overlapsPastSlack, rectCentre, rectText, rectWithin, sameRect, screenOf, windowTurnsScreen } from '../ui-tree/geometry.js';
import { readKeyboard } from '../ui-tree/keyboard-cover.js';
import { pollTree } from '../ui-tree/read-tree.js';
import { findBySpec } from '../ui-tree/selectors.js';
import { cannotHide, type KeyboardRemedy } from '../ui-tree/soft-keyboard.js';
import { captureFrame, captureRefusal, isMoving, unsettledReason, type Frame, type MeasuredFrame } from './capture.js';
import { failClosed, type Unchecked } from './fail-closed.js';
import { formatSeconds } from '../util/duration.js';
import { notFound, verdictToPoll, type PixelMeasureInput, type PollVerdict } from './poll-verdict.js';

/**
 * The pixel poll: what a polling pixel assert does, owned once.
 *
 * Until 2026-10-06 the color and ocr asserts each hand-wired the same round
 * inside `Verifier.poll`: find the element (first occurrence wins), check
 * there was time left, capture with the round's tree and deadline, gate on
 * stability, gate on decode, and only then measure — with a per-assert
 * `PixelPoll` (now `PixelPollMemory`) remembering across rounds what the
 * timeout should say. Two nested loops, two budgets, a deadline threaded inward, copied once per
 * assert, and the invariants that make the result trustworthy written as
 * comments at both call sites. A pixel assert is now a description (the
 * Verifier's) and a `measure` (the assert's); everything between is here.
 *
 * What this module owns:
 * - the round's ORDER: tree read (the tree poll's) → find → deadline check →
 *   soft-keyboard check (2026-10-06, below) → status band and covers check
 *   (round 8, below) → capture with that tree and the deadline → stability
 *   gate → decode gate → measure. A round that begins
 *   past the deadline takes no screenshot: the overrun of a slow tree read is
 *   never compounded by a stability budget.
 * - the two gates: `measure` sees only a SETTLED, DECODED frame. A moving
 *   frame is a miss with the reason, never a sample — the deadline, not a
 *   moving frame, decides (2026-10-05); one capture (`unjudged`) is no verdict
 *   and says nothing; an undecodable png is a miss that fails closed, and the
 *   poll keeps going because the capture may have raced a transition.
 *   A capture the ADAPTER refuses is not a miss either (2026-10-08): since
 *   the adapters refuse an empty or non-PNG capture as a transport error
 *   (adapters/screenshot-bytes.ts), `captureFrame` throws for a dead device,
 *   and that ends THIS assert at once — no polling to the deadline: a device
 *   that cannot capture will not answer the next round either, and the
 *   timeout would only bury the transport's own words — as a fail-closed
 *   failure quoting the adapter's first line (`screenshot failed: …`).
 *   The assert RESOLVES, it does not reject: `assertAll` goes on to the next
 *   assert (a tree assert on the same dead device fails on its own, "not
 *   found … (last UI tree read failed: …)"), so a `verify` leg keeps its
 *   trace and results and a flow's `assert:` step fails with this reason.
 *   (Until a review the same day the throw went through the tree poll and
 *   rejected the whole batch.) Only a png that came back and does not
 *   decode is a miss, and the poll goes on. The same exit is open to a
 *   `measure` since 2026-10-08: a verdict it marks `final`
 *   (poll-verdict.ts) ends the assert the same way with its own sentence —
 *   the ocr assert's, for a recognizer that will never read (no `swiftc`,
 *   a recognizer that did not compile).
 * - the memory and the wording at the deadline (`PixelPollMemory`, private).
 *
 * Since 2026-10-06 the round hands the capture the first match's rect as its
 * `region`, so "settled" means the ELEMENT'S pixels held still across two
 * captures (verify/capture.ts's header has the rule and its whole-screen
 * fallback). For a pixel assert, then, "the screen did not settle: N
 * captures, each different from the last" USUALLY means the element's region
 * kept changing — a spinner or a fade inside the measured rect — and hiding
 * a status-bar clock or a caret elsewhere will not cure it; until that date
 * it could mean either. The exception is the capture's fallback: when the
 * region cannot be checked — the png scale carries an error, the rect lands
 * nowhere on the png (an element scrolled off-screen), a capture did not
 * decode, two captures differ in size — the verdict is still the WHOLE
 * screen's, and a live clock elsewhere still reads "did not settle". The
 * sentence does not say which; a `ui_snapshot` of the element's rect does.
 * The sentence itself is unchanged: it is the capture's,
 * the baseline assert and the tools' `⚠ frame:` note quote it too, and the
 * captures it counts WERE each different from the last.
 *
 * A frame that settled over the region ONLY (`settledOver: 'region'`) is
 * measured only when the element's rect this round equals — x, y, width,
 * height, exactly — its rect in the previous round that found it. The crop
 * sits at the rect the round's tree read reported, before the captures, so
 * an element sliding in or pushed aside can leave its OLD area static and
 * the region pair matching while the element is elsewhere; region stability
 * alone would have widened that stale-rect window, and two consecutive
 * reads agreeing narrows it to what the tree itself gets wrong — a tree that
 * reports where the element WILL be (an entrance or fade-in at its final
 * rect), and movement after the confirming snapshot (verify/capture.ts's
 * header has both residuals and the cost). A failed tree read between two
 * agreeing ones does not break the confirmation, on purpose — `forgetRect`
 * says why. No previous rect — the first round to find it, or the first
 * after a round that did not — is a silent round that still records
 * "found", and at the deadline says the region held still but there was no
 * time for the confirming read; a different one is a miss that quotes
 * both rects, so a poll in which the element never held still says so,
 * rather than "not found" or "did not settle". A frame that settled over the
 * whole SCREEN is measured as before: two identical captures already say
 * nothing moved, the element included.
 *
 * Since 2026-10-06 (later that day) a round also asks the adapter's soft-
 * keyboard oracle, when it has one, before it captures anything
 * (docs/bugs/2026-10-06-pixel-assert-measures-the-keyboard-over-its-element.md).
 * Measured that day on an API 33 emulator: a tap on a field raised the IME
 * over the bottom ~40% of a payment form, uiautomator went on reporting the
 * pinned CONTINUE button at its at-rest rect (the keyboard is a separate
 * window, not in the tree), and a color assert sampled the key faces
 * (`#FFFFFF`) while an ocr assert read the `?123` key ("123") — each reported
 * as the ELEMENT'S colour and copy. Had the expected value happened to be the
 * keyboard's colour — white or light grey, common for a disabled control —
 * the assert would have PASSED on an element the user cannot see. The rule:
 * the oracle says `shown` and its frame overlaps the element's rect by any
 * positive area (`rectsOverlap`; an edge-touching rect is not covered) → the
 * round is a fail-closed MISS that names both rects and nothing is captured;
 * the poll keeps going, so a keyboard that goes away before the deadline
 * costs a round, not the verdict, and once a later query finds the element
 * clear the covered sentence stops being the timeout's wording. `hidden`, `unknown`, a frame elsewhere, or
 * no oracle at all (iOS, whose keyboard is in the tree) → the round proceeds
 * exactly as before. `witness()` is never asked: the witness exists to veto
 * a `back` key press, and nothing is pressed here (since 2026-10-08 the
 * `touchable()` read that follows a shown `state()` carries `mInputShown`
 * too, but only as the admission rule for a floating panel —
 * ui-tree/keyboard-cover.ts#panelsBeyond — never as a veto over the band;
 * the reading's `overlapping`, which this poll asks, never consults the
 * witness) — a stale
 * `shown` costs covered rounds until the window state catches up (seconds,
 * measured on `KeyboardOracle.witness`), within the 12 s pixel default; under
 * a short explicit timeout it fails closed with the covered wording; never a
 * false pass. "Any overlap" is deliberate: the ocr assert crops the whole
 * rect, so any keyboard inside it is read; the colour sampler insets 12%, so
 * a keyboard under only the bottom edge fails closed where colour could have
 * measured — a cost accepted for one rule, and the sentence quotes both rects
 * so the case is plain to diagnose. Residual — the old behaviour returns,
 * silently, when the oracle cannot see the keyboard: a floating or split IME
 * that supplies no insets frame at all (it reads hidden, or a zero-size frame
 * read as unknown — on API 33 a floating Gboard was measured 2026-10-08 to
 * keep a 132-px band, and its panel is now read beside it, `keyboardOverElement`
 * below; the transient read right after the focus tap was hidden); the API 34+ `type=ime` line is taken from AOSP and has not been
 * captured on a device; a multi-display device reads unknown. The check sits after the deadline check so a round that
 * would capture nothing queries nothing either. Cost: the reading's
 * `overlapping` once per round, on Android only — its adb calls are counted
 * on ui-tree/keyboard-cover.ts (WHAT A READING ASKS), the one place they
 * are — against a round of ~2.6–4.3 s there. The verify legs are untouched: their text table already
 * reports this case as OCCLUDED.
 *
 * Since 2026-10-07 an adapter WITHOUT the oracle (iOS: the keyboard is part
 * of the tree) gets the same rule from the round's own tree: the WDA source
 * marks the band the keyboard draws over with `KEYBOARD_ROLE`
 * (adapters/wda-source.ts#keyboardMarks has the rule and the measurements —
 * the band, not the `Keyboard` element's rect, which stops 17–44 pt short of
 * the drawn area), a reading (`ui-tree/keyboard-cover.ts#readKeyboard` —
 * the one switch between the oracle and the tree, shared with the tap
 * guard) reads it, and a band overlapping the element's rect is the same
 * covered miss.
 * No extra read: the tree is the one the round found the element in. An
 * element that IS the keyboard's UI (a key, the toolbar's Done — `ofKeyboard`
 * on its Window) reads as not covered. The remedy sentence differs: with no
 * dismissal on the adapter the miss names the flow's two ways to hide it
 * first (a `tap:` step the author adds on an element that hides it — such
 * as the one configured for the guard, which taps it only before a covered
 * TAP, never before an assert — or `dismissKeyboard: true` on a fill that
 * leaves it up; flow facts, worded here and not borrowed from the guard's
 * refusal, which has its own tap to offer), says the adapter cannot hide
 * the keyboard on its own (`cannotHide`, the one phrase the guard uses) and
 * quotes the adapter's sentence on why and where the dismissal is
 * configured (`DeviceAdapter.keyboardAdvice`) — never `back`. An idb tree
 * marks no band (iOS 27's idb lists the keys and the band, unmarked) and
 * reads `unknown`: the pre-2026-10-07 behaviour,
 * silently, as the Android residuals above.
 *
 * Since round 8 (2026-10-12; docs/bugs/2026-10-10-ios-pixel-asserts-sample-
 * the-chrome-over-their-element.md, the owner's decision: fail closed) a
 * round that found the element clear of the keyboard also asks what ELSE is
 * drawn over it (`chromeOverElement`), from the same tree and the device's
 * memoized screen — no extra read: the status band (`DeviceScreen.
 * statusBand`: iOS's top safe-area inset, Android's visible status bar; geometry.ts#belowStatusBand, the
 * tap's rule) and the app's own nodes that hide its PIXELS
 * (ui-tree/draw-order.ts#paintsOver: the tap's covers, `exposure`, with
 * every rule they were taught — a Compose text under its own button, idb's
 * modal listed before the content, WDA's cell backgrounds and a text
 * field's scroll bar, a label on its own field, the floating tab bar's
 * strip — less what takes a touch and hides nothing: the element's own
 * content listed beside it and a clickable layer on its own branch, review
 * of fix/r8-pixel round 1). Measured on the iPhone 17 (round-7 device
 * check): a colour assert on `value_date_select` at 24,30, under the 62-pt
 * band, PASSED on the status bar's `#EFF1F4`, its ocr read the bar's
 * "Contacts"; a label under CONTINUE sampled CONTINUE's `#91919A`, reported
 * as the element's colour. An overlap of the band, or of a cover's reach,
 * with the element's rect thicker than 2 units on its thin side
 * (geometry.ts#PIXEL_OVERLAP_SLACK, the owner's decision) is the miss —
 * never a measurement: it names what lies over it (`the status bar …` with
 * the band's rect, or the cover's role, label, rect and — for a pinned bar
 * — reach) and advises `scroll_until … fully: true` first, which stops only
 * once nothing is drawn over any of it, adding "a child of it that lies
 * clear" where a scroll may not cure it. A finding, as the keyboard's: the
 * poll goes on, a later round that finds the element clear withdraws it
 * (`uncovered`), and when every round was covered it is the timeout's
 * wording. The keyboard is asked first — its remedy (hide it) is not a
 * scroll. Stricter than the tap, which asks only for a cover at the centre:
 * the sampler and the recognizer read the region. A screen-sized element is
 * not judged (`chromeOverElement`). Residuals, stated: an element that
 * reaches into the band by design but is short of the screen's size — a
 * full-bleed header, a screen resized above the keyboard (WDA's
 * `login_screen` 0,0 402x566), a sheet's scrim — fails closed whatever it
 * shows; `scroll_until … fully: true` lets the rest of an element lie under
 * the band once its centre is below it, so for such an element only the
 * child advice cures the miss; under idb a keyboard's keys are nodes like
 * any other and are named as the cover; what a tree does not list (a top
 * bar WDA lists before the scroll view) is no cover here, as for the tap;
 * an ocr assert on a screen-sized element reads whatever chrome lies over
 * it. Cost: one `drawOrder` walk of the round's tree and the memoized
 * `viewport()`.
 *
 * What it refuses: the recognizer (closed over by the ocr assert's
 * `measure`, which is text-parity.ts#measureOcrAssert since 2026-10-08, as
 * the colour assert's is color-parity.ts#evaluateColorAssert), the scale
 * policy (`measured.scale` may carry a derivation error; both measurements
 * fail closed on it — the parity modules own that, this gates on decode),
 * the description and the `AssertResult` (the Verifier's), the tree poll's
 * loop (ui-tree/read-tree.ts) and the capture's budget (verify/capture.ts).
 * The before/after figures for threading the deadline in stay where they
 * were measured, on `Verifier.poll` (verify/assert.ts).
 */

interface PixelPollSpec {
  element: ElementSpec;
  timeoutMs: number;
  /**
   * The pause between rounds and NOTHING else — never forwarded as the
   * stability delay, which is capture.ts's constant (the 2026-10-05 "one
   * budget" rule; see the header there for the 300-vs-500 split it closed).
   */
  pollMs: number;
  /** The fail-closed noun for the two sentences this module words itself: a moving frame and an undecodable png. */
  unchecked: Exclude<Unchecked, 'geometry'>;
  /**
   * The assert's own measurement, called only on a settled, decoded frame.
   * A verdict marked `final` ends the assert at once with its detail — a
   * failure no later round can change (poll-verdict.ts; the ocr assert's
   * unavailable engine). A throw propagates out of the poll: it is the
   * measurement's own bug, not a verdict.
   */
  measure: (input: PixelMeasureInput) => Promise<PollVerdict> | PollVerdict;
}

/**
 * What a polling pixel assert remembers across the WHOLE poll — one instance
 * per `pollPixels` call (2026-10-05; private here since 2026-10-06). A round
 * that begins past the deadline, or whose one capture the deadline cut
 * before a second (`stability: 'unjudged'`), has nothing to say about the
 * screen: it returns `undefined` so that an earlier round's finding — a
 * measured drift, a sampled colour — is what the timeout reports, and it
 * remembers that the element WAS found so a poll in which every round was cut
 * can say so, not "not found". A frame seen `moving` is a MISS with the
 * reason, worded fail-closed like every other reason the assert cannot
 * measure past; the capture count it quotes is the most any round took, so a
 * late round the deadline cut short never understates the one that spent the
 * whole budget. Since 2026-10-06 it also remembers where the element was
 * last found, for the rect confirmation a region-only frame needs (header).
 */
class PixelPollMemory {
  /**
   * Why the LAST round that found the element said nothing, when one did:
   * `cut` — it began past the deadline or its capture was unjudged, so no
   * settled frame was captured; `unconfirmed` (2026-10-06) — a frame DID
   * settle over the element's region, and no earlier read could confirm the
   * rect. Either outranks not-found; each has its own sentence, because
   * "no time to capture a settled frame" is false once one was captured.
   */
  private foundSilently: 'cut' | 'unconfirmed' | undefined;
  private mostCaptures = 0;
  /**
   * The slowest ROUND of the poll — a tree read and whatever the round then
   * captured; since 2026-10-06 also the round's soft-keyboard query, tens of
   * ms on Android, which the sentence does not name (its wording, "a tree
   * read and its captures", is pinned byte-for-byte across the suite) —
   * quoted when the budget ran out on a found element (2026-10-06): on the
   * Android emulator one round is ~4.3 s against the caller's budget, and
   * "no time was left" alone reads like a flaky screen.
   * The round, not the read, because either half can be the slow one. A read
   * that FAILED never reaches the round, so it is not counted: its error is
   * the not-found sentence's to quote, not this one's.
   */
  private slowestRoundMs = 0;
  private lastRect: Rect | undefined;
  /**
   * The covered sentence the last covered round recorded, and whether an
   * oracle answer SINCE then said the keyboard no longer covers the element
   * (review 2026-10-06). pollTree keeps the last PollMiss detail and is not
   * this module's to change, so a covered miss cannot be withdrawn there;
   * `timeoutDetail` skips it instead when it is still the last detail and a
   * later round saw the element clear — "dismiss the keyboard" is false once
   * the last look found it hidden. A round cut BEFORE the query leaves both
   * alone: it saw nothing, and the last finding still outranks silence.
   */
  private lastCovered: string | undefined;
  private coverCleared = false;

  constructor(private readonly unchecked: PixelPollSpec['unchecked']) {}

  /**
   * A round whose tree does not have the element: forget its rect. "Found at
   * A, gone, back at A" is two appearances, not two reads agreeing — a
   * bottom CTA with the same id at the same rect on consecutive wizard
   * screens would otherwise be confirmed by the PREVIOUS screen's read
   * (review 2026-10-06).
   *
   * A round whose tree READ failed never gets here, so "A, read error, A"
   * still confirms A — a deliberate, recorded decision (2026-10-06), not an
   * oversight: the tree poll (ui-tree/read-tree.ts) owns failed reads and
   * never hands them to the predicate, and forgetting on one would need a
   * round counter here or a change to `pollTree` for every caller. The read
   * that failed saw nothing either way; the two reads that agree are real.
   */
  forgetRect(): void {
    this.lastRect = undefined;
  }

  /** Every round that finds the element: record its rect, and return the one the previous round saw — consecutive, since a round without it forgets. */
  foundAt(rect: Rect): Rect | undefined {
    const previous = this.lastRect;
    this.lastRect = { ...rect };
    return previous;
  }

  /**
   * A frame settled over the element's region only, at a rect the previous
   * read did not confirm: silence (still "found") when there was no previous
   * read to confirm it, a miss quoting both rects when it differed.
   */
  unconfirmed(previous: Rect | undefined, rect: Rect): PollVerdict | undefined {
    if (previous === undefined) {
      this.foundSilently = 'unconfirmed';
      return undefined;
    }
    const reason =
      `the element moved between tree reads (${rectText(previous)} → ${rectText(rect)}) while only its own region, ` +
      'not the whole screen, held still — the crop may sit where the element was, not where it is; let it come to rest and re-run';
    return { pass: false, detail: failClosed(reason, this.unchecked) };
  }

  /** One round — its tree read and its captures — took this long. */
  roundTook(ms: number): void {
    this.slowestRoundMs = Math.max(this.slowestRoundMs, ms);
  }

  /** Nothing to capture: the deadline has passed. */
  outOfTime(deadline: number): boolean {
    if (Date.now() < deadline) return false;
    this.foundSilently = 'cut';
    return true;
  }

  /**
   * The soft keyboard covers the element (2026-10-06): a miss that quotes
   * both rects, never a measurement — what would be sampled is the keyboard.
   * A finding like any other, so when every round was covered it is the
   * timeout's wording (`timeoutDetail`: the last finding outranks the silent
   * rounds and not-found), and a later round cut by the deadline before its
   * query does not erase it. A later round whose query found the element
   * clear does (`uncovered`). The remedy, when the adapter has a `back`
   * (`dismissal: 'back'`, the oracle's window model), names the fill option
   * (`dismissKeyboard`, flow/config.ts) and `back` — not "tap a field above",
   * which keeps the keyboard up (review 2026-10-06). When it has none
   * (`'none'`, the in-tree model, 2026-10-07) it names the flow's two ways:
   * a `tap:` step the AUTHOR adds on an element that hides the keyboard
   * (such as the one configured for the guard to tap — configuring it is
   * not enough here: the guard taps it only before a covered tap, and before
   * an assert nothing does), or `dismissKeyboard: true` on a fill that
   * LEAVES it up. Not the fill option alone: it taps only on a band read
   * right after the fill, and HID typing usually parks the keyboard (no
   * band, a no-op — the 2026-10-05 bug note's device check), while a
   * covered miss here means a tap or an autofocus raised it, with or
   * without a fill before. Flow facts, not platform ones; the sentence is
   * this module's, not the guard's (whose refusal can offer its own tap and
   * a re-layout, and names no fill option). It then adds `cannotHide`
   * (ui-tree/soft-keyboard.ts): the one phrase the guard uses too, then the
   * adapter's sentence on why and where that dismissal is configured
   * (`advice`, `DeviceAdapter.keyboardAdvice`) — no platform fact of this
   * module's. Both come as the reading's `KeyboardRemedy`
   * (ui-tree/soft-keyboard.ts).
   */
  covered(rect: Rect, keyboard: Rect, { dismissal, advice }: KeyboardRemedy): PollVerdict {
    const reason =
      `the soft keyboard covers the element (element ${rectText(rect)}, keyboard ${rectText(keyboard)}) — ` +
      (dismissal === 'back'
        ? 'dismiss it (e.g. `dismissKeyboard: true` on the fill, or press back) and re-run'
        : 'hide it first and re-run (in a flow: a tap: step on an element that hides it, such as the one configured for the guard to tap, ' +
          `before this assert, or \`dismissKeyboard: true\` on a fill that leaves it up); ${cannotHide(advice)}`);
    return this.coveredMiss(reason);
  }

  /**
   * Something of the app, or the status band, is drawn over the element
   * (round 8, 2026-10-12; `chromeOverElement`): a miss naming it, never a
   * measurement — what would be sampled is the cover. Remembered as the
   * keyboard's covered miss is, so a later round that finds the element
   * clear withdraws it (`uncovered`). `reason` is `chromeOverElement`'s,
   * remedy included: `scroll_until` with `fully: true`, which stops only
   * once nothing is drawn over any of it, and a child clear of it when no
   * scroll may cure it.
   */
  drawnOver(reason: string): PollVerdict {
    return this.coveredMiss(reason);
  }

  private coveredMiss(reason: string): PollVerdict {
    const detail = failClosed(reason, this.unchecked);
    this.lastCovered = detail;
    this.coverCleared = false;
    return { pass: false, detail };
  }

  /**
   * The round found nothing over the element — no keyboard (or no oracle),
   * no cover, no status band: an earlier covered miss is no longer the truth.
   */
  uncovered(): void {
    if (this.lastCovered !== undefined) this.coverCleared = true;
  }

  /** The frame is not a verdict: a miss with the reason when it was seen moving, silence when nothing could be judged. */
  unsettled(frame: Pick<Frame, 'stability' | 'captures'>): PollVerdict | undefined {
    if (!isMoving(frame)) {
      this.foundSilently = 'cut';
      return undefined;
    }
    this.mostCaptures = Math.max(this.mostCaptures, frame.captures);
    return { pass: false, detail: failClosed(unsettledReason({ captures: this.mostCaptures }), this.unchecked) };
  }

  /**
   * The timeout wording: the last finding, else found-but-no-time (cut or
   * unconfirmed, whichever silenced the last such round), which outranks
   * not-found. A covered miss that a later query contradicted is not a
   * finding any more (`lastCovered`): the silent round after it speaks.
   */
  timeoutDetail(timeoutMs: number, last: { detail?: string; readError?: Error }): string {
    const stale = this.coverCleared && last.detail === this.lastCovered;
    if (last.detail !== undefined && !stale) return last.detail;
    const roundCost = `the slowest round — a tree read and its captures — took ${formatSeconds(this.slowestRoundMs)} here`;
    if (this.foundSilently === 'cut') {
      return `element found, but no time was left within ${formatSeconds(timeoutMs)} to capture a settled frame (${roundCost}) — raise this assert timeout`;
    }
    if (this.foundSilently === 'unconfirmed') {
      return (
        `element found and its region held still, but no time was left within ${formatSeconds(timeoutMs)} to confirm its position ` +
        `with a second tree read (${roundCost}) — raise this assert timeout or let the screen come to rest`
      );
    }
    return notFound(timeoutMs, last.readError);
  }
}

/**
 * The soft keyboard's frame when the round's reading says one is shown over
 * the element's rect — any positive-area overlap — else undefined: `hidden`,
 * `unknown`, or a frame elsewhere (header, 2026-10-06). The reading is
 * `readKeyboard`'s (ui-tree/keyboard-cover.ts), asked `overlapping` — the
 * fail-closed geometric question, which never asks the witness: the
 * adapter's oracle when it has one, else (2026-10-07) the round's own tree,
 * with the element itself as the subject; the reading's `KeyboardRemedy`
 * (`dismissal` and `advice`) rides along for the remedy sentence. The two rects are in the same
 * units: on Android both are device pixels, read from the same `[l,t][r,b]`
 * notation by the same `parseBounds` (adapters/android.ts — a uiautomator
 * node's `bounds` and the IME `InsetsSource` entry's `frame=`); on iOS both
 * are points of one WDA tree; and the tree rect reaches this poll unscaled.
 * `state()` never throws (KeyboardOracle's contract), so no catch. Since
 * 2026-10-08 a floating keyboard's panel counts as the band does: the
 * reading reads it (`panels`, only when the band is up — one more adb call
 * per such round, the figures on AndroidAdapter's keyboardTouchable), and an
 * element under it is the same covered miss, quoting the panel's rect —
 * the band first, then the panels: the first that overlaps is the frame the
 * miss quotes.
 */
async function keyboardOverElement(
  adapter: Pick<DeviceAdapter, 'keyboard' | 'keyboardAdvice'>,
  tree: UiNode,
  element: UiNode,
): Promise<{ frame: Rect; remedy: KeyboardRemedy } | undefined> {
  const keyboard = readKeyboard(adapter, tree);
  const frame = await keyboard.overlapping(element.rect, element);
  return frame === undefined ? undefined : { frame, remedy: keyboard.remedy };
}

/**
 * What is drawn over the element's rect in this round, worded for the miss
 * with its remedy — the status band first, then the app's own covers — or
 * undefined when nothing is (round 8, 2026-10-12, the owner's decision on
 * docs/bugs/2026-10-10-ios-pixel-asserts-sample-the-chrome-over-their-
 * element.md: fail closed). Header, "Since round 8". Exported for the
 * fixture sweeps (tests/verify/pixel-chrome.test.ts).
 *
 * The screen is the device's (`viewport()`, memoized by the adapter, in the
 * tree's units), turned when the tree's window says it is held sideways
 * (geometry.ts#windowTurnsScreen, the gesture box's rule); the tree's
 * screen (`screenOf`) when the device size cannot be read or is unusable —
 * and then no band. The band is `DeviceScreen.statusBand` at the top of a
 * portrait screen (geometry.ts#belowStatusBand — the tap's and
 * `scroll_until`'s rule; iOS's, and Android's visible status bar since fix/r8-band). The covers
 * are the PIXEL covers (ui-tree/draw-order.ts#paintsOver, judged in the
 * screen below the band): `exposure`'s — the tap's — less what takes a
 * touch and hides nothing (the element's own content listed beside it, a
 * clickable layer), and every one that meets the element's rect counts,
 * not only one over its centre as for a tap: the sampler and the
 * recognizer read the region, not a point. Either meets the element only
 * past an edge's thickness (geometry.ts#overlapsPastSlack, 2 units, the
 * owner's decision — for the band too: a row whose top lies 2 pt into it
 * is antialiasing, not the bar). Named: the one on top at the element's
 * centre, else the last listed (drawn on top), with its reach when that is
 * not its frame (a pinned bar's, run down to the screen's bottom). Its own
 * descendants are never covers (`exposure` leaves a node's subtree out).
 *
 * A SCREEN-SIZED element (its area at least `SCREEN_SIZED_FRACTION` of the
 * screen's — a window, `android:id/content`, an app's root view) is judged
 * clear of both: the status bar and the app's bars lie over part of every
 * such node by design (all seven round-5 Compose snapshots' root
 * containers under a 66-px Android band, the tab bar over them; every WDA
 * window under iOS's band), the colour sampler's 12 % inset keeps the
 * sample well inside it, and failing them would only say "the screen has
 * chrome". Residual: an ocr assert on one crops the whole rect and reads
 * the chrome's text with the element's. A large node short of that share
 * still fails closed — a sheet's scrim (0,0 1080x1087 under an Android
 * band), a top app bar laid edge to edge under the status bar (0,0
 * 1080x242), RN's `placeholder_screen` (0,116 402x758) under the debugger
 * banner — and the remedy names a child clear of it.
 *
 * The remedy is `scroll_until … fully: true`; it adds "assert a child of
 * it that lies clear of it" when a scroll may not cure it (review of
 * fix/r8-pixel, round 1): the element lies in no scroll view as far as the
 * tree says (`insideScroller` false — or undefined, idb), it starts at the
 * screen's top edge under the band (a full-bleed header), or the cover
 * holds the element whole.
 */
export async function chromeOverElement(adapter: Pick<DeviceAdapter, 'viewport'>, tree: UiNode, element: UiNode): Promise<string | undefined> {
  const read = await adapter.viewport().catch(() => undefined);
  const device = read !== undefined && usableScreen(read) ? read : undefined;
  const turned = device !== undefined && windowTurnsScreen(inferScreenSize(tree), device);
  const screen: Rect =
    device === undefined ? screenOf(tree) : { x: 0, y: 0, width: turned ? device.height : device.width, height: turned ? device.width : device.height };
  // A screen-sized element is the screen's own background: chrome lies over part of it by design (doc above).
  if (rectArea(element.rect) >= rectArea(screen) * SCREEN_SIZED_FRACTION) return undefined;
  const below = belowStatusBand(screen, device);
  const band: Rect = { ...screen, height: below.y - screen.y };
  const at = `(element ${rectText(element.rect)}`;
  const pinned = insideScroller(tree, element) !== true;
  if (band.height > 0 && overlapsPastSlack(element.rect, band)) {
    return `the status bar is drawn over the element ${at}, status bar ${rectText(band)}) — ${coverRemedy(pinned || element.rect.y <= screen.y)}`;
  }
  const covers = drawOrder(tree).paintsOver(element, below);
  const centre = rectCentre(element.rect);
  const cover = covers.filter((c) => containsPoint(c.reach, centre)).at(-1) ?? covers.at(-1);
  if (cover === undefined) return undefined;
  const reach = sameRect(cover.reach, cover.node.rect) ? '' : `, reaching ${rectText(cover.reach)}`;
  const named = `${nodeText(cover.node).slice(0, -1)}${reach})`;
  return `${named} is drawn over the element ${at}) — ${coverRemedy(pinned || rectWithin(element.rect, cover.reach))}`;
}

/** What to do about a pixel assert's element under chrome (`chromeOverElement`): scroll it clear — and, when a scroll may not cure it, `stuck`, assert a child of it that lies clear. */
const coverRemedy = (stuck: boolean): string =>
  'the capture would show it, not the element; scroll_until the element with `fully: true` first and re-run' +
  (stuck ? ' — or, if no scroll moves it out from under that, assert a child of it that lies clear of it' : '');

/**
 * A miss no later round can change, carried out of the tree poll to end it
 * at once — a capture the adapter refused (header, "A capture the ADAPTER
 * refuses"), or a `measure` verdict marked `final` (poll-verdict.ts). Private:
 * this module is the one place that turns "final" into control flow; a
 * measurement says it with a value (2026-10-08; until then the refusal had
 * its own `CaptureRefused`). `detail` is already the whole fail-closed
 * sentence.
 */
class FinalMiss {
  constructor(readonly detail: string) {}
}

/**
 * The fail-closed sentence of a refused capture — the pixel asserts' and the baseline diff's. The adapter's
 * sentence ends with a full stop; failClosed drops it (fail-closed.ts) rather than printing
 * `attention.; failing closed` (seen on device, 2026-10-08).
 */
export const screenshotFailed = (reason: string, unchecked: Unchecked): string =>
  failClosed(`screenshot failed: ${reason}`, unchecked);

/**
 * Poll until `measure` passes on a settled, decoded frame of the element, or
 * the deadline passes. `{ pass: true }` carries the passing verdict's
 * detail; `{ pass: false }` the timeout wording — the last measured finding
 * or fail-closed reason, else "element found, but no time was left…" (to
 * capture a settled frame, or — after a region-only round with nothing to
 * confirm it — to confirm the element's position), else "not found within
 * N s" with the last tree-read error.
 */
export async function pollPixels(
  adapter: Pick<DeviceAdapter, 'screenshot' | 'uiTree' | 'viewport' | 'keyboard' | 'keyboardAdvice'>,
  spec: PixelPollSpec,
): Promise<PollVerdict> {
  const { element, timeoutMs, pollMs, unchecked, measure } = spec;
  const memory = new PixelPollMemory(unchecked);
  const round = async (tree: UiNode, deadline: number): Promise<PollVerdict | undefined> => {
    const found = findBySpec(tree, element);
    if (found.length === 0) {
      memory.forgetRect();
      return undefined;
    }
    const { rect } = found[0];
    const previous = memory.foundAt(rect);
    if (memory.outOfTime(deadline)) return undefined;
    const keyboard = await keyboardOverElement(adapter, tree, found[0]);
    if (keyboard !== undefined) return memory.covered(rect, keyboard.frame, keyboard.remedy);
    // After the keyboard, which has its own remedy: the status band, then what of the app is drawn over it (round 8).
    const over = await chromeOverElement(adapter, tree, found[0]);
    if (over !== undefined) return memory.drawnOver(over);
    memory.uncovered();
    // A refused capture leaves the poll at once — header, "A capture the ADAPTER refuses".
    const frame = await captureFrame(adapter, { tree, deadline, region: rect }).catch((e: unknown) => {
      throw new FinalMiss(screenshotFailed(captureRefusal(e), unchecked));
    });
    if (frame.stability !== 'settled') return memory.unsettled(frame);
    // Only the element's region held still: measure only at a rect two consecutive reads agree on (header).
    if (frame.settledOver === 'region' && (previous === undefined || !sameRect(previous, rect))) return memory.unconfirmed(previous, rect);
    const { shot, measured } = frame;
    // The supplied-tree arm is never treeless: an error here is a png that did not decode.
    if (measured.error !== undefined) return { pass: false, detail: failClosed(measured.error, unchecked) };
    const verdict = await measure({ rect, shot, measured });
    // A failure no later round can change leaves the poll at once, as a refused capture does.
    if (verdict.final) throw new FinalMiss(verdict.detail);
    return verdict;
  };
  // Each round is timed from the start of its read, for the timeout wording;
  // pollTree's loop and what it reads are unchanged.
  let readStarted = Date.now();
  const timedReads: Pick<DeviceAdapter, 'uiTree'> = {
    uiTree: () => {
      readStarted = Date.now();
      return adapter.uiTree();
    },
  };
  const outcome = await pollTree(
    timedReads,
    async (tree, { deadline }) => {
      try {
        return verdictToPoll(await round(tree, deadline));
      } finally {
        memory.roundTook(Date.now() - readStarted);
      }
    },
    { timeoutMs, pollMs },
  ).catch((e: unknown) => {
    // pollTree propagates the predicate's own errors; only a final miss — a
    // refused capture, or a verdict `measure` marked final — is ours to turn into the verdict.
    if (e instanceof FinalMiss) return e;
    throw e;
  });
  if (outcome instanceof FinalMiss) return { pass: false, detail: outcome.detail };
  if (!outcome.timedOut) return { pass: true, detail: outcome.value.detail };
  return { pass: false, detail: memory.timeoutDetail(timeoutMs, outcome) };
}
