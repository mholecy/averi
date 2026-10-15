import { type DeviceAdapter, type Rect, type UiNode } from '../adapters/types.js';
import type { ElementSpec } from '../ui-tree/element-spec.js';
import { drawnPart, nodeText, rectText, sameRect } from '../ui-tree/geometry.js';
import { readKeyboard } from '../ui-tree/keyboard-cover.js';
import { keyboardPosition, type KeyboardLine } from '../ui-tree/keyboard-position.js';
import { pollTree } from '../ui-tree/read-tree.js';
import { findBySpec } from '../ui-tree/selectors.js';
import { cannotHide, type KeyboardRemedy } from '../ui-tree/soft-keyboard.js';
import { presentedRemedy, sceneOf, type PixelRegionOf, type PixelStanding, type Remedy, type Scene } from '../ui-tree/standing.js';
import { systemBarName } from '../ui-tree/system-bar.js';
import { treeScreen, usableScreen } from '../ui-tree/usable-screen.js';
import { captureFrame, captureRefusal, isMoving, unsettledReason, type Frame, type MeasuredFrame } from './capture.js';
import { failClosed, type Unchecked } from './fail-closed.js';
import { formatSeconds } from '../util/duration.js';
import { notFound, verdictToPoll, type PixelMeasureInput, type PollVerdict } from './poll-verdict.js';

/**
 * The pixel poll: what a polling pixel assert does, owned once. A pixel
 * assert is a description (the Verifier's) and a `measure` (the assert's);
 * everything between is here — the color and ocr asserts share one round,
 * one budget and one deadline, and the invariants that make the result
 * trustworthy are written here once.
 *
 * What this module owns:
 * - the round's ORDER: tree read (the tree poll's) → find → deadline check →
 *   what lies over the element (`overElement`: the soft keyboard first, then
 *   the system bands, a cut and the app's covers) → capture with that tree
 *   and the deadline → stability gate → decode gate → measure. A round that
 *   begins past the deadline takes no screenshot and queries nothing: the
 *   overrun of a slow tree read is never compounded by a stability budget.
 * - the two gates: `measure` sees only a SETTLED, DECODED frame. A moving
 *   frame is a miss with the reason, never a sample — the deadline, not a
 *   moving frame, decides; one capture (`unjudged`) is no verdict and says
 *   nothing; an undecodable png is a miss that fails closed, and the poll
 *   keeps going because the capture may have raced a transition.
 * - the final misses. A capture the ADAPTER refuses is not a miss: the
 *   adapters refuse an empty or non-PNG capture as a transport error
 *   (adapters/screenshot-bytes.ts), `captureFrame` throws for a dead device,
 *   and that ends THIS assert at once — no polling to the deadline: a device
 *   that cannot capture will not answer the next round either, and the
 *   timeout would only bury the transport's own words — as a fail-closed
 *   failure quoting the adapter's first line (`screenshot failed: …`). The
 *   assert RESOLVES, it does not reject: `assertAll` goes on to the next
 *   assert (a tree assert on the same dead device fails on its own, "not
 *   found … (last UI tree read failed: …)"), so a `verify` leg keeps its
 *   trace and results and a flow's `assert:` step fails with this reason.
 *   Only a png that came back and does not decode is a miss, and the poll
 *   goes on. A `measure` verdict marked `final` (poll-verdict.ts) ends the
 *   assert the same way with its own sentence — the ocr assert's, for a
 *   recognizer that will never read (no `swiftc`, a recognizer that did not
 *   compile).
 * - the memory and the wording at the deadline (`PixelPollMemory`, private).
 *
 * The round hands the capture the first match's rect as its `region`, so
 * "settled" means the ELEMENT'S pixels held still across two captures
 * (verify/capture.ts's header has the rule and its whole-screen fallback).
 * For a pixel assert, then, "the screen did not settle: N captures, each
 * different from the last" USUALLY means the element's region kept
 * changing — a spinner or a fade inside the measured rect — and hiding a
 * status-bar clock or a caret elsewhere will not cure it. The exception is
 * the capture's fallback: when the region cannot be checked — the png
 * scale carries an error, the rect lands nowhere on the png (an element
 * scrolled off-screen), a capture did not decode, two captures differ in
 * size — the verdict is still the WHOLE screen's, and a live clock
 * elsewhere still reads "did not settle". The sentence does not say which;
 * a `ui_snapshot` of the element's rect does. The sentence itself is the
 * capture's: the baseline assert and the tools' `⚠ frame:` note quote it
 * too, and the captures it counts WERE each different from the last.
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
 * WHAT LIES OVER THE ELEMENT (`overElement`), before anything is captured —
 * a miss naming it, never a measurement, and a finding like any other: the
 * poll goes on, a later round that finds the element clear withdraws it
 * (`PixelPollMemory.uncovered`), and when every round was covered it is the
 * timeout's wording.
 * - The soft keyboard, first: the round's reading
 *   (ui-tree/keyboard-cover.ts#readKeyboard — the adapter's oracle when it
 *   has one, else the round's own tree, shared with the tap guard) asked
 *   `overlapping`, any positive overlap with the element's rect, never the
 *   witness; then idb's band, a keyboard line of the element's standing
 *   (ui-tree/keyboard-position.ts#KeyboardPosition.line). An element that IS the
 *   keyboard's UI (a key, the toolbar's Done) reads as not covered. The
 *   remedy is the adapter's (`keyboardOver`).
 *   docs/adr/0010-pixel-assert-keyboard-first.md
 *   docs/adr/0006-idb-keyboard-band-is-a-keyboard-line.md
 * - Then the element's standing for the pixel assert
 *   (ui-tree/standing.ts#Scene.standing, which owns the rule), judged over
 *   what the measurement reads (`PixelPollSpec.reads`), from the same tree
 *   and the device's memoized screen — no extra read: a system band past
 *   the slack, an ocr element's possible cut at the navigation bar, and the
 *   app's own nodes that hide its PIXELS (ui-tree/draw-order.ts#DrawOrder.paintsOver),
 *   worded with a remedy (`judgeOver`).
 *   docs/adr/0001-pixel-assert-fails-closed-on-chrome.md
 *   docs/adr/0002-pixel-overlap-slack.md
 *   docs/adr/0003-pixel-cover-exemptions.md
 *   docs/adr/0009-android-navigation-band.md
 *   docs/bugs/2026-10-06-pixel-assert-measures-the-keyboard-over-its-element.md
 *   docs/bugs/2026-10-10-ios-pixel-asserts-sample-the-chrome-over-their-element.md
 *
 * Residuals (one line each; the ADRs above have the rest):
 * - A keyboard the reading cannot see (a floating or split IME with no insets frame) is measured, as before the check.
 * - A stale `shown` costs covered rounds until the window state catches up; under a short timeout it fails closed.
 * - A colour assert fails closed on a keyboard under only its element's bottom edge, which its 12 % inset would skip.
 * - An element reaching into a band by design (a full-bleed header or footer in no scroll view) fails closed whatever it shows; its advice leads with its title or its content above the bar.
 * - A screen resized above the keyboard, a window under an ocr assert and idb's Application under a colour assert fail closed.
 * - A whole last row resting flush with the navigation bar in its list fails an ocr assert closed as possibly cut.
 * - What a tree does not list is no cover; what the pixel-cover exemptions drop is measured as the element (ADR 0003).
 *
 * Cost: on Android the reading's `overlapping` once per round — its adb
 * calls are counted on ui-tree/keyboard-cover.ts (WHAT A READING ASKS), the
 * one place they are — against a round of ~2.6–4.3 s there; on iOS no
 * extra read, the tree is the one the round found the element in. Then the
 * memoized `viewport()`, and walks of the round's tree: `inferScreenSize`'s
 * (the screen's shape, ui-tree/usable-screen.ts#usableScreen), `screenOf`'s when
 * neither the device nor a window vouches for the screen (the last
 * fallback), one `drawOrder` walk (the keyboard edge's, every round that
 * reaches the check), and — on every round the reading leaves clear — the
 * element's `exposure` (the standing's facts) and the clip facts' walks of
 * the whole tree (ui-tree/geometry.ts#clipsOf's own, for an ocr element
 * ending on the navigation bar's top, or a miss's, and on a miss
 * `Clips.inScroller`'s: whether a scroll may cure it), and, unless a band
 * already failed the round, `exposure` once more (`paintsOver`). The verify
 * legs are untouched: their text table already reports a keyboard over an
 * element as OCCLUDED.
 *
 * What it refuses: the recognizer (closed over by the ocr assert's
 * `measure`, which is text-parity.ts#measureOcrAssert, as the colour
 * assert's is color-parity.ts#evaluateColorAssert), the scale policy
 * (`measured.scale` may carry a derivation error; both measurements fail
 * closed on it — the parity modules own that, this gates on decode), the
 * description and the `AssertResult` (the Verifier's), the tree poll's loop
 * (ui-tree/read-tree.ts) and the capture's budget (verify/capture.ts). The
 * before/after figures for threading the deadline in stay where they were
 * measured, on `Verifier.poll` (verify/assert.ts).
 */

interface PixelPollSpec {
  element: ElementSpec;
  timeoutMs: number;
  /**
   * The pause between rounds and NOTHING else — never forwarded as the
   * stability delay, which is capture.ts's constant (the "one budget"
   * rule; see the header there for the 300-vs-500 split it closed).
   */
  pollMs: number;
  /** The fail-closed noun for the two sentences this module words itself: a moving frame and an undecodable png. */
  unchecked: Exclude<Unchecked, 'geometry'>;
  /** The part of the element's rect the measurement reads (ui-tree/standing.ts#PixelRegionOf); the whole rect when omitted, as the ocr assert crops it. */
  reads?: PixelRegionOf;
  /**
   * The measurement reads glyphs (the ocr assert): an element that may be
   * cut at the navigation bar fails closed, where a colour sample of what
   * shows stays a true measurement (ui-tree/standing.ts#Scene's contract).
   * docs/adr/0009-android-navigation-band.md
   */
  glyphs?: boolean;
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
 * per `pollPixels` call, private to this module. A round
 * that begins past the deadline, or whose one capture the deadline cut
 * before a second (`stability: 'unjudged'`), has nothing to say about the
 * screen: it returns `undefined` so that an earlier round's finding — a
 * measured drift, a sampled colour — is what the timeout reports, and it
 * remembers that the element WAS found so a poll in which every round was cut
 * can say so, not "not found". A frame seen `moving` is a MISS with the
 * reason, worded fail-closed like every other reason the assert cannot
 * measure past; the capture count it quotes is the most any round took, so a
 * late round the deadline cut short never understates the one that spent the
 * whole budget. It also remembers where the element was
 * last found, for the rect confirmation a region-only frame needs (header).
 */
class PixelPollMemory {
  /**
   * Why the LAST round that found the element said nothing, when one did:
   * `cut` — it began past the deadline or its capture was unjudged, so no
   * settled frame was captured; `unconfirmed` — a frame DID
   * settle over the element's region, and no earlier read could confirm the
   * rect. Either outranks not-found; each has its own sentence, because
   * "no time to capture a settled frame" is false once one was captured.
   */
  private foundSilently: 'cut' | 'unconfirmed' | undefined;
  private mostCaptures = 0;
  /**
   * The slowest ROUND of the poll — a tree read and whatever the round then
   * captured, and the round's soft-keyboard query, tens of
   * ms on Android, which the sentence does not name (its wording, "a tree
   * read and its captures", is pinned byte-for-byte across the suite) —
   * quoted when the budget ran out on a found element: on the
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
   * oracle answer SINCE then said the keyboard no longer covers the element.
   * pollTree keeps the last PollMiss detail and is not
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
   * screens would otherwise be confirmed by the PREVIOUS screen's read.
   *
   * A round whose tree READ failed never gets here, so "A, read error, A"
   * still confirms A — a deliberate, recorded decision, not an
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
   * Something is over the element, worded with its remedy (`overElement`'s
   * sentence, which the round hands in whole): the soft keyboard, or a
   * system band or something of the app (`scroll_until` with `fully: true`, which stops only once
   * nothing is drawn over any of it, and something in it clear of that
   * when no scroll may cure it). A miss naming it, never a measurement —
   * what would be sampled is the cover — and a finding like any other, so
   * when every round was covered it is the timeout's wording
   * (`timeoutDetail`: the last finding outranks the silent rounds and
   * not-found), and a later round cut by the deadline before its query
   * does not erase it; a later round that finds the element clear
   * withdraws it (`uncovered`).
   */
  coveredMiss(reason: string): PollVerdict {
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
 * What lies over the element in this round, worded for the miss with its
 * remedy — or undefined when nothing does and the round may capture. The
 * keyboard first, its remedy (hide it) being no scroll: the round's reading
 * (`readKeyboard`, ui-tree/keyboard-cover.ts — the adapter's oracle when it
 * has one, else the round's own tree, the element itself the subject),
 * asked `overlapping`, the fail-closed geometric question that never asks
 * the witness (the header says why); then the element's standing for the
 * pixel assert (ui-tree/standing.ts#Scene.standing, `{ of: 'pixel' }`) on
 * the usable screen (`judgeOver`), given idb's band as its keyboard line
 * (ui-tree/keyboard-position.ts#KeyboardPosition.line — no reading stands by it:
 * idb's reading is `unknown`), so an element its band meets is the same
 * keyboard miss, quoting the band, and its keys are no covers named
 * instead. `reads`: what the measurement reads (`PixelPollSpec.reads`; the
 * whole rect when omitted); `glyphs`: it reads glyphs (the ocr assert).
 * docs/adr/0006-idb-keyboard-band-is-a-keyboard-line.md
 *
 * The reading's two rects are in the same units: on Android both are device
 * pixels, read from the same `[l,t][r,b]` notation by the same
 * `parseBounds` (adapters/android.ts — a uiautomator node's `bounds` and
 * the IME `InsetsSource` entry's `frame=`); on iOS both are points of one
 * WDA tree; and the tree rect reaches this poll unscaled. `state()` never
 * throws (KeyboardOracle's contract), so no catch. A floating keyboard's
 * panel counts as the band does: the reading reads it
 * (`panels`, only when the band is up — one more adb call per such round,
 * the figures on AndroidAdapter's keyboardTouchable), the band first, then
 * the panels: the first that overlaps is the frame the miss quotes. A node
 * of idb's band itself (a key) is the keyboard's own UI, measured.
 */
export async function overElement(
  adapter: Pick<DeviceAdapter, 'viewport' | 'keyboard' | 'keyboardAdvice'>,
  tree: UiNode,
  element: UiNode,
  { reads = (rect) => rect, glyphs = false, scene = sceneOf(tree) }: { reads?: PixelRegionOf; glyphs?: boolean; scene?: Scene } = {},
): Promise<string | undefined> {
  const keyboard = readKeyboard(adapter, tree);
  const frame = await keyboard.overlapping(element.rect, element);
  if (frame !== undefined) return keyboardOver(element.rect, frame, keyboard.remedy);
  return judgeOver(adapter, tree, element, { reads, glyphs, scene, keyboard: { line: keyboardPosition(scene.order).line(element), remedy: keyboard.remedy } });
}

/**
 * The soft keyboard covers the element: the miss's reason,
 * quoting both rects — never a measurement, what would be sampled is the
 * keyboard. The remedy, when the adapter has a `back` (`dismissal:
 * 'back'`, the oracle's window model), names the fill option
 * (`dismissKeyboard`, flow/config.ts) and `back` — not "tap a field above",
 * which keeps the keyboard up. When it has none (`'none'`, the in-tree
 * model) it names the flow's two ways:
 * a `tap:` step the AUTHOR adds on an element that hides the keyboard
 * (such as the screen title — not "the one configured for the guard":
 * under idb no guard acts, and under WDA configuring it is not enough here
 * either: the guard taps it only before a covered tap, and before an
 * assert nothing does; where it is configured, if anywhere, is the
 * adapter's `advice`, which says so per tree source), or `dismissKeyboard: true` on a fill that
 * LEAVES it up. Not the fill option alone: it taps only on a band read
 * right after the fill, and HID typing usually parks the keyboard (no
 * band, a no-op, measured on device), while a
 * covered miss here means a tap or an autofocus raised it, with or
 * without a fill before. Flow facts, not platform ones; the sentence is
 * this module's, not the guard's (whose refusal can offer its own tap and
 * a re-layout, and names no fill option). It then adds `cannotHide`
 * (ui-tree/soft-keyboard.ts): the one phrase the guard uses too, then the
 * adapter's sentence on why and where that dismissal is configured
 * (`advice`, `DeviceAdapter.keyboardAdvice`) — no platform fact of this
 * module's. Both come as the reading's `KeyboardRemedy`
 * (ui-tree/soft-keyboard.ts). The sentence's head is `keyboardCovers`, its
 * advice `hideKeyboard`.
 */
const keyboardOver = (rect: Rect, keyboard: Rect, remedy: KeyboardRemedy): string => `${keyboardCovers(rect, keyboard)} — ${hideKeyboard(remedy)}`;

/** The head of every miss under the soft keyboard, quoting both rects (`keyboardOver`; idb's band, `judgeOver`). */
const keyboardCovers = (rect: Rect, keyboard: Rect): string => `the soft keyboard covers the element (element ${rectText(rect)}, keyboard ${rectText(keyboard)})`;

/** How to hide the keyboard over the element, by the adapter's dismissal (`keyboardOver`'s doc). */
const hideKeyboard = ({ dismissal, advice }: KeyboardRemedy): string =>
  dismissal === 'back'
    ? 'dismiss it (e.g. `dismissKeyboard: true` on the fill, or press back) and re-run'
    : 'hide it first and re-run (in a flow: a tap: step on an element that hides it, such as the screen title, ' +
      `before this assert, or \`dismissKeyboard: true\` on a fill that leaves it up); ${cannotHide(advice)}`;

/**
 * The element's standing for the pixel assert (ui-tree/standing.ts
 * #Scene.standing, which owns the rule: what counts as over what it reads,
 * in which order), worded — a system band (the status bar's, then the
 * navigation bar's), the navigation bar's possible cut, then the app's own
 * covers, or undefined when nothing is over it (it fails closed, ADR
 * 0001). The screen is the usable screen's single `oriented` box
 * (ui-tree/usable-screen.ts#usableScreen, which owns the derivation; the
 * pixel purpose picks it, ui-tree/standing.ts#Scene; D6, ADR 0012), with
 * the device's system bands — else the tree's own screen (ui-tree/usable-screen.ts#treeScreen), with no
 * band: a window the tree vouches for is the screen, as it is for the
 * gesture, so under a rectless root whose largest node is a scroll view's
 * tall content (402x2000 under a 402x874 window) a window-sized element is
 * the screen itself, not a row offered a scroll. `keyboard`: a line to judge
 * under (idb's band) and the reading's remedy to word it with.
 *
 * The sentence names what lies over it: `the status bar …` or `the
 * navigation bar …` with the band's rect; the cover's role, label, rect
 * and — for a pinned bar — its reach (`covered.reach`, when not its
 * frame); or, at the navigation bar's top edge, that it may be cut there
 * (`cut`: the ocr crop would read only what shows — scroll it up). Or that
 * nothing of it lies on the screen, or nothing of it is drawn there — it lies
 * outside the scroll view named (`OUTSIDE_ITS_SCROLL_VIEW`) — or only a
 * sliver too thin to measure, at the screen's edge or the scroll view's.
 *
 * The remedy after " — " is the standing's (ui-tree/standing.ts#Remedy:
 * the case and its precedence are decided there, once for the tap,
 * `scroll_until`'s stop and this assert), worded here (`coverRemedy`).
 * `scroll_until … fully: true` (`scroll`); it adds "assert something in it
 * that lies clear of that" when a scroll may not cure it (`pinned`,
 * `stuck`): the element lies in no scroll view as far as the tree says
 * (`Clips.inScroller` false — or undefined: idb's flat list has no
 * ancestry, so EVERY idb miss carries the clause), it is laid from the
 * screen's top edge under the status bar, or the cover holds the element
 * whole. Not for an element reaching the screen's bottom under the
 * navigation bar (ADR 0011). Where no scroll moves it out (`fixed`) the
 * remedy leads with the child: under a system bar, content no scroll lifts
 * out of the band (in no scroll view, or screen-sized scroll content taller
 * than the room between the bars) — the screen ITSELF (screen-sized); a
 * full-bleed header — iOS's, or Android 15+'s edge-to-edge app bar
 * (`0,0 1080x220` under the 66-px band fails a colour assert closed, ADR
 * 0001) — with "assert something in it that lies clear of that (its
 * title, say)": the title, below the band, is judged on its own and
 * passes; a full-bleed footer (a bottom sheet) with "(its content above
 * the bar, say)". The same shapes in a scroll view get the scroll advice:
 * `scroll_until … fully: true` lifts them. Under a COVER, a screen-sized
 * element or a full-bleed header keeps that advice wherever it lies. For idb's
 * flat-list root (`covered.overRoot`: its Application node, screen-sized,
 * and never a full-bleed header in a flat list) it says the node named is
 * content drawn over the root's background.
 *
 * Beneath a screen PRESENTED over the element (a modal's dim, a sheet — ADR 0018), first of every case: no scroll
 * moves it out from under that screen, and the remedy is `presentedRemedy('the element')` in place of every other,
 * whatever lies over it — a cover, a system bar, the navigation bar's cut, idb's keyboard band — the sentence still
 * naming what is drawn over the element, and only the advice after " — " the presented screen's.
 * docs/adr/0001-pixel-assert-fails-closed-on-chrome.md
 * docs/adr/0011-no-stuck-clause-at-the-bottom-edge.md
 * docs/adr/0012-pixel-assert-residuals-d4-d6.md
 */
async function judgeOver(
  adapter: Pick<DeviceAdapter, 'viewport'>,
  tree: UiNode,
  element: UiNode,
  { reads, glyphs, scene, keyboard }: { reads: PixelRegionOf; glyphs: boolean; scene: Scene; keyboard: { line: KeyboardLine | undefined; remedy: KeyboardRemedy } },
): Promise<string | undefined> {
  const usable = (await usableScreen(adapter, { tree })) ?? treeScreen(tree);
  // What the measurement reads is asked of the box the standing judges (ui-tree/standing.ts#PixelRegionOf).
  const purpose = { of: 'pixel', reads, glyphs, ...(keyboard.line !== undefined && { keyboardTop: keyboard.line }) } as const;
  // The usable screen whole: the pixel purpose judges its single `oriented` box (ui-tree/standing.ts#Scene, D6).
  const standing = scene.standing(element, usable, purpose);
  if (standing.kind === 'reachable') return undefined;
  const at = `(element ${rectText(element.rect)}`;
  switch (standing.kind) {
    case 'offScreen': {
      if (standing.scroller !== undefined) {
        // On the screen, but outside what its scroll view draws: what lies there is not the element.
        const view = nodeText(standing.scroller);
        const where = standing.sliver === undefined ? `${OUTSIDE_ITS_SCROLL_VIEW} ${view} ${at}` : `${TOO_THIN_IN_ITS_SCROLL_VIEW} ${view} ${at}, drawn ${rectText(standing.sliver)}`;
        return `${where}, screen ${rectText(standing.box)}) — ${advice(standing.remedy, () => 'scroll it into view: scroll_until the element first and re-run')}`;
      }
      const where = standing.sliver === undefined ? `${OFF_THE_SCREEN} ${at}` : `${TOO_THIN_ON_THE_SCREEN} ${at}, on the screen ${rectText(standing.sliver)}`;
      return `${where}, screen ${rectText(standing.box)}) — ${advice(standing.remedy, () => 'scroll it on-screen: scroll_until the element first and re-run')}`;
    }
    case 'underKeyboard':
      // Its presented remedy is unreachable while idb's band is found only in a flat list, which holds no presented
      // screen (ui-tree/draw-order.ts#holderOf's `parent`); the type still lets this kind carry it, and the agreement
      // rows (tests/interact/remedy-agreement.test.ts) pin its rendering.
      return `${keyboardCovers(element.rect, standing.band)} — ${advice(standing.remedy, () => hideKeyboard(keyboard.remedy))}`;
    case 'systemBar': {
      const bar = systemBarName(standing.bar.edge);
      return `the ${bar} is drawn over the element ${at}, ${bar} ${rectText(standing.band)}) — ${coverRemedy(standing.remedy)}`;
    }
    case 'cut': {
      const cut = `the element may be cut at the navigation bar ${at}, navigation bar from y ${standing.bar.top}): it ends on the bar's top edge, as its scroll container ${rectText(standing.container)} does, so the crop may read only what shows of it`;
      return `${cut} — ${advice(standing.remedy, () => 'scroll it up: scroll_until the element with `fully: true` first and re-run')}`;
    }
    case 'covered': {
      const reach = sameRect(standing.reach, standing.cover.rect) ? '' : `, reaching ${rectText(standing.reach)}`;
      const named = `${nodeText(standing.cover).slice(0, -1)}${reach})`;
      return `${named} is drawn over the element ${at}) — ${coverRemedy(standing.remedy)}`;
    }
    default: {
      // Exhaustive by type: a kind left unworded must not read as "nothing over it" (that would measure the cover).
      const unworded: never = standing;
      throw new Error(`pixel assert: a standing ${(unworded as { kind: string }).kind} with no sentence`);
    }
  }
}

/**
 * The head of the miss for an element NOTHING of which — of what the assert reads — lies on the screen judged
 * (ui-tree/standing.ts's pixel `offScreen`: below the fold, above the screen's top, past a side): no capture shows any
 * of it. Its remedy is the standing's: beneath a presented screen, close it first (`PRESENTED_OVER_THE_ELEMENT`); else
 * scroll it on-screen. The one sentence head the `assert` tool's description and the troubleshooting reference quote
 * (mcp/tools.ts).
 */
export const OFF_THE_SCREEN = 'nothing of the element lies on the screen';

/**
 * The head of the same miss when the screen's edge leaves only a sliver of the element no thicker than the pixel
 * slack (ui-tree/standing.ts#thinSliver): the sliver is quoted, and its remedy is the off-screen one. The one sentence
 * head the `assert` tool's description and the troubleshooting reference quote for it (mcp/tools.ts).
 */
export const TOO_THIN_ON_THE_SCREEN = 'only a sliver of the element lies on the screen, too thin to measure';

/**
 * The head of the miss for an element on the screen NOTHING of which is drawn there: it lies outside the scroll view
 * it is listed in, which draws none of it (ui-tree/standing.ts's pixel `offScreen` with its `scroller`, the drawn
 * frame — a WDA tree's): what the capture shows there is not the element. The words end as
 * ui-tree/geometry.ts#outsideScrollViewText's begin, the tap's and `scroll_until`'s. Measured: the at-rest SWIFT form's
 * `payee_street_input` `24,869 354x52`, 5 pt of it on the screen below its form's `0,0 402x780`, passed a colour assert
 * on the bare background. A sentence names the scroll view after these words; its remedy is the off-screen one. The
 * one sentence head the `assert` tool's description and the troubleshooting reference quote (mcp/tools.ts).
 */
export const OUTSIDE_ITS_SCROLL_VIEW = 'nothing of the element is drawn: it lies outside its scroll view';

/**
 * The head of the same miss when the scroll view's edge leaves only a sliver of the element drawn, no thicker than the
 * pixel slack (ui-tree/standing.ts#thinSliver, at the scroll view's edge as at the screen's): the drawn sliver is
 * quoted. The one sentence head the `assert` tool's description and the troubleshooting reference quote.
 */
export const TOO_THIN_IN_ITS_SCROLL_VIEW = 'only a sliver of the element is drawn, too thin to measure: the rest lies outside its scroll view';

/**
 * The presented screen's remedy, said of "the element" — the pixel assert's "it" is already what is drawn over it
 * (ui-tree/standing.ts#presentedRemedy owns the words). The one sentence the `assert` tool's description quotes
 * (mcp/tools.ts).
 */
export const PRESENTED_OVER_THE_ELEMENT = presentedRemedy('the element');

/**
 * The pixel assert's advice for a standing's remedy (ui-tree/standing.ts#Remedy) where the sentence names the keyboard
 * or the navigation bar's cut: beneath a presented screen, that screen's (`PRESENTED_OVER_THE_ELEMENT`); else
 * `otherwise`, told the remedy's other case. A bar or a cover words its own (`coverRemedy`).
 */
function advice<R extends Exclude<Remedy, { readonly of: 'presented' }>>(remedy: Extract<Remedy, { readonly of: 'presented' }> | R, otherwise: (remedy: R) => string): string {
  return remedy.of === 'presented' ? PRESENTED_OVER_THE_ELEMENT : otherwise(remedy);
}

/**
 * What to do about a pixel assert's element under chrome (`judgeOver`) — its standing's remedy
 * (ui-tree/standing.ts#Remedy, which decides the case and its precedence), in this verb's words: `scroll` — scroll it
 * clear; `pinned` and `stuck` — that, or, when a scroll may not cure it, assert something in it that lies clear (in
 * no scroll view, or where the tree cannot say, or laid from the screen's top edge, or held whole by the cover's
 * reach: one sentence for all, which never promises the scroll away); `fixed` — no scroll moves it, so the advice
 * LEADS with the child, then says why: the element is the screen itself (`screen`, screen-sized); laid from the
 * screen's top edge at full width (`header`, a full-bleed header, whose title, clear of the band, is what to assert);
 * a full-width surface laid to the screen's bottom edge (`footer`, a bottom sheet, whose content above the bar is what
 * to assert); idb's flat-list root (`root`), whose cover is the app's own content laid on its background;
 * `presented` — a screen is presented over the element, which no scroll moves it out from under: close that screen
 * first. `keyboard` is never worded here: a standing under a bar or a cover cannot carry it (`CoverRemedy`).
 * docs/adr/0001-pixel-assert-fails-closed-on-chrome.md
 */
const coverRemedy = (remedy: CoverRemedy): string => {
  const scroll = 'the capture would show it, not the element; scroll_until the element with `fully: true` first and re-run';
  switch (remedy.of) {
    case 'presented':
      return `the capture would show it, not the element; ${PRESENTED_OVER_THE_ELEMENT}`;
    case 'fixed':
      return FIXED_REMEDY[remedy.what];
    case 'pinned':
    case 'stuck':
      return `${scroll} — or, if no scroll moves it out from under that, ${CLEAR_CHILD}`;
    case 'scroll':
      return scroll;
  }
};

/** The remedies of an element under a system bar or a cover — what `coverRemedy` words: every case but `keyboard`. */
type CoverRemedy = Extract<PixelStanding, { readonly kind: 'systemBar' | 'covered' }>['remedy'];

/** The child to assert instead, when a scroll may not cure the element (`coverRemedy`). */
const CLEAR_CHILD = 'assert something in it that lies clear of that';

/** `coverRemedy`'s `fixed` sentences: the advice leads with the child, then says why no scroll moves it. */
const FIXED_REMEDY: Record<Extract<Remedy, { of: 'fixed' }>['what'], string> = {
  root: `that is content drawn over the root's background, which the capture would show, not the root; no scroll moves it — ${CLEAR_CHILD}`,
  screen: `the capture would show it, not the element — ${CLEAR_CHILD}; no scroll moves the screen itself out from under it`,
  header: `the capture would show it, not the element — ${CLEAR_CHILD} (its title, say); no scroll moves an element laid from the screen's top edge out from under it`,
  footer: `the capture would show it, not the element — ${CLEAR_CHILD} (its content above the bar, say); no scroll moves an element laid to the screen's bottom edge out from under it`,
};

/**
 * A miss no later round can change, carried out of the tree poll to end it
 * at once — a capture the adapter refused (header, "A capture the ADAPTER
 * refuses"), or a `measure` verdict marked `final` (poll-verdict.ts). Private:
 * this module is the one place that turns "final" into control flow; a
 * measurement says it with a value. `detail` is already the whole
 * fail-closed sentence.
 */
class FinalMiss {
  constructor(readonly detail: string) {}
}

/**
 * The fail-closed sentence of a refused capture — the pixel asserts' and the baseline diff's. The adapter's
 * sentence ends with a full stop; failClosed drops it (fail-closed.ts) rather than printing
 * `attention.; failing closed` (seen on device).
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
    // The keyboard, then the system bands and what of the app is drawn over it — never a measurement.
    const scene = sceneOf(tree);
    const over = await overElement(adapter, tree, found[0], { ...(spec.reads !== undefined && { reads: spec.reads }), glyphs: spec.glyphs === true, scene });
    if (over !== undefined) return memory.coveredMiss(over);
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
    // Measured on the part its scroll views draw (the drawn frame) — the part the standing judged over (one region).
    const verdict = await measure({ rect: drawnPart(rect, scene.clips.drawnIn(found[0])) ?? rect, shot, measured });
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
