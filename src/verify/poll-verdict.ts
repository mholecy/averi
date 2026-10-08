import type { Rect } from '../adapters/types.js';
import { PollMiss } from '../ui-tree/read-tree.js';
import type { MeasuredFrame } from './capture.js';

/**
 * The verifier's poll vocabulary, shared by `Verifier.poll` (the tree-only
 * asserts) and `pollPixels` (verify/pixel-poll.ts, the color and ocr asserts).
 * A leaf module since 2026-10-06, for the reason fail-closed.ts is one: both
 * need it and assert.ts imports the other. Until then the verdict-to-poll
 * translation and the not-found sentence lived inside assert.ts, and the
 * pixel asserts reached them only by running through `Verifier.poll`. The
 * tree poll (ui-tree/read-tree.ts) does not learn any of this: it speaks
 * value-or-`PollMiss`, and the translation is the verifier's.
 */

/**
 * What one poll round concluded. `undefined` (not this type) means "nothing to
 * say, keep polling" — the element isn't there yet. `pass: true` stops the
 * poll; `pass: false` carries a detail worth reporting IF the deadline is
 * reached, without ending the poll: mid-animation geometry may legitimately be
 * wrong for a frame, so only the state at timeout is the verdict.
 */
export interface PollVerdict {
  pass: boolean;
  detail?: string;
  /**
   * A miss no later round can change (2026-10-08): the poll ends at once with
   * this verdict instead of polling to the deadline, which would only repeat
   * it and bury it under the timeout wording. Only a failing verdict carries
   * it, and only the pixel poll honours it (verify/pixel-poll.ts, the one
   * place that turns it into control flow) — today for the ocr assert's
   * engine that will never read (text-parity.ts#measureOcrAssert, on an
   * `OcrUnavailableError`). The tree-only asserts never set it.
   */
  final?: true;
}

/**
 * What a pixel assert's `measure` is handed (verify/pixel-poll.ts): the
 * element's rect and the frame captured against the same round's tree.
 * Named here, beside the verdict it returns, so the measurements that take
 * it (text-parity.ts#measureOcrAssert) do not respell it (2026-10-08).
 */
export interface PixelMeasureInput {
  /** The first `findBySpec` match's rect — the same duplicate-id rule as rect-parity — from the tree handed to the capture. */
  rect: Rect;
  /** The settled screenshot bytes. */
  shot: Buffer;
  /** The decoded frame — never undecoded, never treeless. Its `scale` may still carry an error: the measurement's policy. */
  measured: MeasuredFrame;
}

/**
 * A verdict in the tree poll's terms, written once (2026-10-06): a passing
 * verdict is the poll's value and carries its detail; a non-passing one with
 * a detail is a `PollMiss`, which is how "element found but content was: …"
 * survives the element vanishing again before the deadline; one with nothing
 * to say continues the poll without erasing an earlier detail.
 */
export const verdictToPoll = (verdict: PollVerdict | undefined): { detail?: string } | PollMiss | undefined => {
  if (verdict?.pass) return { detail: verdict.detail };
  return verdict?.detail === undefined ? undefined : new PollMiss(verdict.detail);
};

/** "not found within Nms", plus the last tree-read error when there was one. */
export const notFound = (timeoutMs: number, readError?: Error): string =>
  `not found within ${timeoutMs}ms` +
  (readError === undefined ? '' : ` (last UI tree read failed: ${readError.message})`);
