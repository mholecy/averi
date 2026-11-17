import type { DeviceAdapter } from '../adapters/types.js';
import { resultText, type AssertResult } from '../verify/assert.js';
import { captureFrame, captureRefusal, unsettledNote, type Frame } from '../verify/capture.js';

/**
 * A run's reply: the final frame or the one line saying why there is none, the asserts' verdict and lines, and the
 * order every run lays them out in (legText). The step trace is the engine's (flow/engine.ts#formatTrace), handed in
 * by the callers; the health line is run/app-health.ts's.
 */

/**
 * The final capture of a run that has already done its work — a `verify`
 * leg, `ensure_state` — or the one line saying why there is none. Since the
 * adapters refuse a capture that is not a PNG as a transport error
 * (adapters/screenshot-bytes.ts), `captureFrame` can throw for a device that
 * died AFTER the run, and a throw here would discard the
 * trace, the assert results, the health line and the ⚠ lines of a run that
 * took minutes — the same loss run/verify.ts's leg forbids for a tree or
 * screen read. So it is caught here, for this one capture, and the run
 * returns no image and says so. Only `captureFrame` is inside: its own doc
 * says nothing past the screenshot itself throws.
 */
export type FinalFrame = { frame: Frame; failed?: undefined } | { frame?: undefined; failed: string };

export async function finalFrame(
  adapter: Pick<DeviceAdapter, 'screenshot' | 'uiTree' | 'viewport'>,
  opts: { readTree?: boolean } = {},
): Promise<FinalFrame> {
  try {
    return { frame: await captureFrame(adapter, { readTree: opts.readTree === true }) };
  } catch (e) {
    return { failed: captureRefusal(e) };
  }
}

/** The line a run prints when its final capture failed — where the `⚠ frame:` note of an unsettled one goes. */
const screenshotFailedLine = (failed: string): string => `⚠ screenshot: ${failed} — no image is returned`;

/** The frame's one note line: why there is no image, or that the image may be mid-animation; none for a settled frame. */
const frameNote = (final: FinalFrame): string | undefined =>
  final.frame === undefined ? screenshotFailedLine(final.failed) : unsettledNote(final.frame);

const formatAsserts = (results: AssertResult[]): string =>
  results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${resultText(r)}`).join('\n');

/**
 * The one-line verdict over a set of asserts — the same words in the `assert` tool and in every leg of a `verify`
 * report, so two tools never describe the same failure differently.
 */
const assertSummary = (results: AssertResult[]): string => {
  const failed = results.filter((r) => !r.pass).length;
  return failed === 0
    ? `All ${results.length} asserts passed`
    : `${failed}/${results.length} asserts FAILED`;
};

/** What one run's reply is made of; a part a caller has nothing for is left out. */
interface Leg {
  /** A verify leg's `## <platform>` line. */
  head?: string;
  /** The engine's trace, as flow/engine.ts#formatTrace prints it. */
  trace?: string;
  /**
   * The asserts' lines, and whether the verdict over them heads them: the `assert` tool always prints it, a verify leg
   * only when the call named asserts.
   */
  asserts?: { results: AssertResult[]; verdict: boolean };
  /** The final frame, for its one note line. */
  frame?: FinalFrame;
  /** run/app-health.ts#appHealth's line with its leading newline, or '' when there is no app to ask about. */
  health: string;
}

/**
 * The reply of ensure_state, run_flow, assert and each verify leg, in the one order they share: the head, the trace,
 * the verdict, the assert lines, the frame's note, and the health line last (ARCHITECTURE.md §8). A verdict keeps its
 * line break even over no assert lines, so the `assert` tool's reply to an empty list ends `passed\n` before the
 * health line.
 */
export function legText({ head, trace, asserts, frame, health }: Leg): string {
  const assertBlock =
    asserts === undefined ? undefined
    : asserts.verdict ? `${assertSummary(asserts.results)}\n${formatAsserts(asserts.results)}`
    : formatAsserts(asserts.results);
  const note = frame === undefined ? undefined : frameNote(frame);
  const parts = [head, trace, assertBlock, note].filter((p): p is string => p !== undefined);
  return parts.join('\n') + health;
}
