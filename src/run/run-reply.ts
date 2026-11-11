import type { DeviceAdapter } from '../adapters/types.js';
import type { AssertResult } from '../verify/assert.js';
import { captureFrame, captureRefusal, type Frame } from '../verify/capture.js';

/**
 * The pieces a run's reply is built from, shared by the `verify` legs (run/verify.ts) and the single-platform tools
 * (run/commands.ts): the final frame or the one line saying why there is none, and the asserts' verdict and lines.
 * Its own module since A29 (docs/plans/2026-10-30-performance-backlog.md): until then they sat in run/verify.ts, so
 * `ensure_state`, `run_flow` and `assert` imported the `verify` tool's orchestration for four words-and-frame helpers.
 * The step trace is the engine's (flow/engine.ts#formatTrace), imported from there; the health line is
 * run/app-health.ts's.
 */

/**
 * The final capture of a run that has already done its work — a `verify`
 * leg, `ensure_state` — or the one line saying why there is none
 * (2026-10-08). Since the adapters refuse a capture that is not a PNG as a
 * transport error (adapters/screenshot-bytes.ts), `captureFrame` can throw
 * for a device that died AFTER the run, and a throw here would discard the
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
export const screenshotFailedLine = (failed: string): string => `⚠ screenshot: ${failed} — no image is returned`;

export const formatAsserts = (results: AssertResult[]): string =>
  results
    .map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.description}${r.detail ? ` — ${r.detail}` : ''}`)
    .join('\n');

/**
 * The one-line verdict over a set of asserts. It lives beside formatAsserts
 * for the reason describeElementSpec has one owner: this is user-facing
 * wording that appears in BOTH the single-platform `assert` tool and every leg
 * of a `verify` report, and two tools describing the same failure differently
 * is the drift this prevents.
 */
export const assertSummary = (results: AssertResult[]): string => {
  const failed = results.filter((r) => !r.pass).length;
  return failed === 0
    ? `All ${results.length} asserts passed`
    : `${failed}/${results.length} asserts FAILED`;
};
