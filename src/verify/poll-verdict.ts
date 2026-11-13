import type { Rect, UiNode } from '../adapters/types.js';
import { PollMiss } from '../ui-tree/read-tree.js';
import { missOf, withMissNote } from '../ui-tree/miss.js';
import type { Target } from '../ui-tree/selectors.js';
import { formatSeconds } from '../util/duration.js';
import type { MeasuredFrame } from './capture.js';
import type { Shot } from './shot.js';

/**
 * The verifier's poll vocabulary, shared by the tree-only asserts' poll and the
 * pixel poll (verify/pixel-poll.ts, the color and ocr asserts). Its own module
 * below assert.ts, importing no assert code, for the reason fail-closed.ts is
 * one: both need it and assert.ts imports the other. The tree poll
 * (ui-tree/read-tree.ts) does not learn any of this: it speaks
 * value-or-`PollMiss`, and the translation is the verifier's.
 */

/**
 * What one poll round concluded. `undefined` (not this type) means "nothing to
 * say, keep polling" — the element isn't there yet. `pass: true` stops the
 * poll; `pass: false` carries a detail worth reporting IF the deadline is
 * reached, without ending the poll: mid-animation geometry may legitimately be
 * wrong for a frame, so only the state at timeout is the verdict.
 */
export type PollVerdict = { pass: boolean; detail?: string; final?: undefined } | FinalVerdict;

/**
 * A miss no later round can change: the poll ends at once with this verdict
 * instead of polling to the deadline, which would only repeat it and bury it
 * under the timeout wording. Only the pixel poll honours it — for the ocr
 * assert's engine that will never read (text-parity.ts#measureOcrAssert, on
 * an `OcrUnavailableError`). The tree-only asserts never set it. Its own
 * member of the union because a final verdict ENDS the assert and its detail
 * IS the failure sentence, so one that does not fail, or fails without its
 * sentence, does not type-check.
 */
export interface FinalVerdict {
  pass: false;
  detail: string;
  final: true;
}

/**
 * What a pixel assert's `measure` is handed (verify/pixel-poll.ts): the
 * element's rect and the frame captured against the same round's tree.
 * Named here, beside the verdict it returns, so the measurements that take
 * it (text-parity.ts#measureOcrAssert) do not respell it.
 */
export interface PixelMeasureInput {
  /**
   * The first `findBySpec` match's rect — the same duplicate-id rule as rect-parity — from the tree handed to the
   * capture, cut to what its scroll views draw (ui-tree/geometry.ts#Clips.drawnIn: the drawn frame) — what
   * the capture shows of it.
   */
  rect: Rect;
  /** The settled screenshot (verify/shot.ts): its PNG for the OCR recognizer. */
  shot: Shot;
  /** The decoded frame — never undecoded, never treeless. Its `scale` may still carry an error: the measurement's policy. */
  measured: MeasuredFrame;
}

/**
 * A verdict in the tree poll's terms, written once: a passing verdict is the
 * poll's value and carries its detail; a non-passing one with a detail is a
 * `PollMiss`, which is how "element found but content was: …" survives the
 * element vanishing again before the deadline; one with nothing to say
 * continues the poll without erasing an earlier detail.
 */
export const verdictToPoll = (verdict: PollVerdict | undefined): { detail?: string } | PollMiss | undefined => {
  if (verdict?.pass) return { detail: verdict.detail };
  return verdict?.detail === undefined ? undefined : new PollMiss(verdict.detail);
};

/**
 * Every assert's "not found within N s" (formatSeconds), of the poll's last round: the last tree-read error when that
 * read failed; else what the last tree read saw of the assert's `target` (ui-tree/miss.ts#missOf — a window it lists
 * alone, presented over the screen beneath, a source that lists the active window only, idb's dialect for an id it
 * does not list), its note in the same place. The target is required, so no assert can ask without it.
 */
export const notFound = (timeoutMs: number, last: { readError?: Error; lastTree?: UiNode }, target: Target): string => {
  const headline = `not found within ${formatSeconds(timeoutMs)}`;
  return last.readError !== undefined ? `${headline} (last UI tree read failed: ${last.readError.message})` : withMissNote(headline, missOf({ tree: last.lastTree, target }));
};
