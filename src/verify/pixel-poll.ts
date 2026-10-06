import type { DeviceAdapter, Rect, UiNode } from '../adapters/types.js';
import type { ElementSpec } from '../ui-tree/element-spec.js';
import { rectsOverlap, rectText, sameRect } from '../ui-tree/geometry.js';
import { pollTree } from '../ui-tree/read-tree.js';
import { findBySpec } from '../ui-tree/selectors.js';
import { captureFrame, isMoving, unsettledReason, type Frame, type MeasuredFrame } from './capture.js';
import { failClosed, type Unchecked } from './fail-closed.js';
import { notFound, verdictToPoll, type PollVerdict } from './poll-verdict.js';

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
 *   soft-keyboard check (2026-10-06, below) → capture with that tree and the
 *   deadline → stability gate → decode gate → measure. A round that begins
 *   past the deadline takes no screenshot: the overrun of a slow tree read is
 *   never compounded by a stability budget.
 * - the two gates: `measure` sees only a SETTLED, DECODED frame. A moving
 *   frame is a miss with the reason, never a sample — the deadline, not a
 *   moving frame, decides (2026-10-05); one capture (`unjudged`) is no verdict
 *   and says nothing; an undecodable png is a miss that fails closed, and the
 *   poll keeps going because the capture may have raced a transition.
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
 * exactly as before. Only `state()` is asked, never `witness()`: the witness
 * exists to veto a `back` key press, and nothing is pressed here — a stale
 * `shown` costs covered rounds until the window state catches up (seconds,
 * measured on `KeyboardOracle.witness`), within the 12 s pixel default; under
 * a short explicit timeout it fails closed with the covered wording; never a
 * false pass. "Any overlap" is deliberate: the ocr assert crops the whole
 * rect, so any keyboard inside it is read; the colour sampler insets 12%, so
 * a keyboard under only the bottom edge fails closed where colour could have
 * measured — a cost accepted for one rule, and the sentence quotes both rects
 * so the case is plain to diagnose. Residual — the old behaviour returns,
 * silently, when the oracle cannot see the keyboard: a floating or split IME
 * supplies no insets frame (it reads hidden, or a zero-size frame read as
 * unknown); the API 34+ `type=ime` line is taken from AOSP and has not been
 * captured on a device; a multi-display device reads unknown. The check sits after the deadline check so a round that
 * would capture nothing queries nothing either. Cost: one `dumpsys window
 * displays` per round, tens of ms (the measured figures are on
 * AndroidAdapter's `keyboardState`), on Android only, against a round of
 * ~2.6–4.3 s there. The verify legs are untouched: their text table already
 * reports this case as OCCLUDED.
 *
 * What it refuses: the recognizer (closed over by the ocr assert's
 * `measure`), the scale policy (`measured.scale` may carry a derivation error;
 * the colour sampler fails closed on it, the OCR region builder returns an
 * error its assert words — the parity modules own that, this gates on decode),
 * the description and the `AssertResult` (the Verifier's), the tree poll's
 * loop (ui-tree/read-tree.ts) and the capture's budget (verify/capture.ts).
 * The before/after figures for threading the deadline in stay where they
 * were measured, on `Verifier.poll` (verify/assert.ts).
 */

/** What `measure` is handed: the element's rect and the frame captured against the same round's tree. */
export interface PixelMeasureInput {
  /** The first `findBySpec` match's rect — the same duplicate-id rule as rect-parity — from the tree handed to the capture. */
  rect: Rect;
  /** The settled screenshot bytes. */
  shot: Buffer;
  /** The decoded frame — never undecoded, never treeless. Its `scale` may still carry an error: the measurement's policy. */
  measured: MeasuredFrame;
}

export interface PixelPollSpec {
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
  /** The assert's own measurement, called only on a settled, decoded frame. A throw propagates out of the poll. */
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
   * clear does (`uncovered`). The remedy names the fill option
   * (`dismissKeyboard`, flow/config.ts) and `back` — not "tap a field above",
   * which keeps the keyboard up (review 2026-10-06).
   */
  covered(rect: Rect, keyboard: Rect): PollVerdict {
    const reason =
      `the soft keyboard covers the element (element ${rectText(rect)}, keyboard ${rectText(keyboard)}) — ` +
      'dismiss it (e.g. `dismissKeyboard: true` on the fill, or press back) and re-run';
    const detail = failClosed(reason, this.unchecked);
    this.lastCovered = detail;
    this.coverCleared = false;
    return { pass: false, detail };
  }

  /**
   * The round's oracle query found nothing over the element (or there is no
   * oracle): an earlier covered miss is no longer the truth.
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
    const roundCost = `the slowest round — a tree read and its captures — took ${this.slowestRoundMs}ms here`;
    if (this.foundSilently === 'cut') {
      return `element found, but no time was left within ${timeoutMs}ms to capture a settled frame (${roundCost}) — raise this assert timeout`;
    }
    if (this.foundSilently === 'unconfirmed') {
      return (
        `element found and its region held still, but no time was left within ${timeoutMs}ms to confirm its position ` +
        `with a second tree read (${roundCost}) — raise this assert timeout or let the screen come to rest`
      );
    }
    return notFound(timeoutMs, last.readError);
  }
}

/**
 * The soft keyboard's frame when the adapter's oracle says one is shown over
 * `rect` — any positive-area overlap — else undefined: no oracle (iOS),
 * `hidden`, `unknown`, or a frame elsewhere (header, 2026-10-06). The two
 * rects are in the same units: on Android both are device pixels, read from
 * the same `[l,t][r,b]` notation by the same `parseBounds`
 * (adapters/android.ts — a uiautomator node's `bounds` and the IME
 * `InsetsSource` entry's `frame=`), and the tree rect reaches this poll
 * unscaled. `state()` never throws (KeyboardOracle's contract), so no catch.
 */
async function keyboardOver(adapter: Pick<DeviceAdapter, 'keyboard'>, rect: Rect): Promise<Rect | undefined> {
  if (adapter.keyboard === undefined) return undefined;
  const keyboard = await adapter.keyboard.state();
  return keyboard.state === 'shown' && rectsOverlap(rect, keyboard.frame) ? keyboard.frame : undefined;
}

/**
 * Poll until `measure` passes on a settled, decoded frame of the element, or
 * the deadline passes. `{ pass: true }` carries the passing verdict's
 * detail; `{ pass: false }` the timeout wording — the last measured finding
 * or fail-closed reason, else "element found, but no time was left…" (to
 * capture a settled frame, or — after a region-only round with nothing to
 * confirm it — to confirm the element's position), else "not found within
 * Nms" with the last tree-read error.
 */
export async function pollPixels(
  adapter: Pick<DeviceAdapter, 'screenshot' | 'uiTree' | 'viewport' | 'keyboard'>,
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
    const keyboard = await keyboardOver(adapter, rect);
    if (keyboard !== undefined) return memory.covered(rect, keyboard);
    memory.uncovered();
    const frame = await captureFrame(adapter, { tree, deadline, region: rect });
    if (frame.stability !== 'settled') return memory.unsettled(frame);
    // Only the element's region held still: measure only at a rect two consecutive reads agree on (header).
    if (frame.settledOver === 'region' && (previous === undefined || !sameRect(previous, rect))) return memory.unconfirmed(previous, rect);
    const { shot, measured } = frame;
    // The supplied-tree arm is never treeless: an error here is a png that did not decode.
    if (measured.error !== undefined) return { pass: false, detail: failClosed(measured.error, unchecked) };
    return measure({ rect, shot, measured });
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
  );
  if (!outcome.timedOut) return { pass: true, detail: outcome.value.detail };
  return { pass: false, detail: memory.timeoutDetail(timeoutMs, outcome) };
}
