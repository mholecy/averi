import type { DeviceAdapter, Rect, UiNode } from '../adapters/types.js';
import type { ElementSpec } from '../ui-tree/element-spec.js';
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
 *   capture with that tree and the deadline → stability gate → decode gate →
 *   measure. A round that begins past the deadline takes no screenshot: the
 *   overrun of a slow tree read is never compounded by a stability budget.
 * - the two gates: `measure` sees only a SETTLED, DECODED frame. A moving
 *   frame is a miss with the reason, never a sample — the deadline, not a
 *   moving frame, decides (2026-10-05); one capture (`unjudged`) is no verdict
 *   and says nothing; an undecodable png is a miss that fails closed, and the
 *   poll keeps going because the capture may have raced a transition.
 * - the memory and the wording at the deadline (`PixelPollMemory`, private).
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
 * whole budget.
 */
class PixelPollMemory {
  private foundNoTime = false;
  private mostCaptures = 0;

  constructor(private readonly unchecked: PixelPollSpec['unchecked']) {}

  /** Nothing to capture: the deadline has passed. */
  outOfTime(deadline: number): boolean {
    if (Date.now() < deadline) return false;
    this.foundNoTime = true;
    return true;
  }

  /** The frame is not a verdict: a miss with the reason when it was seen moving, silence when nothing could be judged. */
  unsettled(frame: Pick<Frame, 'stability' | 'captures'>): PollVerdict | undefined {
    if (!isMoving(frame)) {
      this.foundNoTime = true;
      return undefined;
    }
    this.mostCaptures = Math.max(this.mostCaptures, frame.captures);
    return { pass: false, detail: failClosed(unsettledReason({ captures: this.mostCaptures }), this.unchecked) };
  }

  /** The timeout wording: the last finding, else found-but-no-time, which outranks not-found. */
  timeoutDetail(timeoutMs: number, last: { detail?: string; readError?: Error }): string {
    if (last.detail !== undefined) return last.detail;
    if (this.foundNoTime) return `element found, but no time was left within ${timeoutMs}ms to capture a settled frame`;
    return notFound(timeoutMs, last.readError);
  }
}

/**
 * Poll until `measure` passes on a settled, decoded frame of the element, or
 * the deadline passes. `{ pass: true }` carries the passing verdict's
 * detail; `{ pass: false }` the timeout wording — the last measured finding
 * or fail-closed reason, else "element found, but no time was left…", else
 * "not found within Nms" with the last tree-read error.
 */
export async function pollPixels(
  adapter: Pick<DeviceAdapter, 'screenshot' | 'uiTree' | 'viewport'>,
  spec: PixelPollSpec,
): Promise<PollVerdict> {
  const { element, timeoutMs, pollMs, unchecked, measure } = spec;
  const memory = new PixelPollMemory(unchecked);
  const round = async (tree: UiNode, deadline: number): Promise<PollVerdict | undefined> => {
    const found = findBySpec(tree, element);
    if (found.length === 0) return undefined;
    if (memory.outOfTime(deadline)) return undefined;
    const frame = await captureFrame(adapter, { tree, deadline });
    if (frame.stability !== 'settled') return memory.unsettled(frame);
    const { shot, measured } = frame;
    // The supplied-tree arm is never treeless: an error here is a png that did not decode.
    if (measured.error !== undefined) return { pass: false, detail: failClosed(measured.error, unchecked) };
    return measure({ rect: found[0].rect, shot, measured });
  };
  const outcome = await pollTree(
    adapter,
    async (tree, { deadline }) => verdictToPoll(await round(tree, deadline)),
    { timeoutMs, pollMs },
  );
  if (!outcome.timedOut) return { pass: true, detail: outcome.value.detail };
  return { pass: false, detail: memory.timeoutDetail(timeoutMs, outcome) };
}
