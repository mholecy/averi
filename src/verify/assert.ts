import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { z } from 'zod';
import type { DeviceAdapter, UiNode } from '../adapters/types.js';
import { describeElementSpec as describe, elementSpecSchema, type ElementSpec } from '../ui-tree/element-spec.js';
import { pollTree } from '../ui-tree/read-tree.js';
import { parseDuration } from '../util/duration.js';
import { errorMessage } from '../util/error-message.js';
import { regexSource } from '../util/regex.js';
import { elementAssertSchema } from './element-assert.js';
import {
  type BaselineFrame,
  captureBaselineFrame,
  captureFrame,
  captureRefusal,
  type Frame,
  ScreenWitness,
  unconfirmedReason,
  unsettledNote,
  unsettledReason,
} from './capture.js';
import { failClosed } from './fail-closed.js';
import { pollPixels, screenshotFailed } from './pixel-poll.js';
import { notFound, verdictToPoll, type PollVerdict } from './poll-verdict.js';
import { DEFAULT_TOLERANCE_DE, evaluateColorAssert, normalizeHex, type ColorExpectation } from './color-parity.js';
import { ocrEngineFor, type OcrEngine } from './ocr.js';
import { DEFAULT_TOLERANCE_PCT, evaluateRectAssert, type RectExpectation } from './rect-parity.js';
import { evaluateOcrAssert, ocrRegionForRect, type OcrExpectation } from './text-parity.js';
import { findBySpec } from '../ui-tree/selectors.js';
import { absentFromViewport } from '../ui-tree/geometry.js';
import { containsTextHint, flattenTree } from './text-hint.js';

/**
 * Declarative checks (ARCHITECTURE.md §5). Three tiers, cheapest first:
 * element asserts (deterministic), agent-vision screenshots (not here — the
 * agent looks at `screenshot` output itself), pixel-diff vs. stored baseline.
 */

const screenshotAssert = z
  .object({
    screenshot: z
      .object({
        baseline: z.string().describe('Baseline name; stored under .averi/baselines/<platform>/'),
        threshold: z.number().min(0).max(1).optional(),
      })
      .strict(),
  })
  .strict();

/**
 * Single-element geometry check against Figma-frame values (rect-parity.ts).
 * Expected values are in FIGMA-FRAME units; `frameWidth` is required because
 * a single anchor offers no anchor-`w` fallback to normalize by. Both sides
 * are normalized to % of screen width before comparing. `y` is measured and
 * reported but never fails the assert: absolute y drifts between devices
 * with different aspect ratios from geometry alone — whole-screen gap rows
 * (verify's `contract`) are the vertical-position check.
 */
const rectAssert = z
  .object({
    element: elementSpecSchema,
    rect: z
      .object({
        x: z.number().optional(),
        y: z.number().optional(),
        w: z.number().optional(),
        h: z.number().optional(),
        frameWidth: z.number().positive(),
        tolerancePct: z.number().positive().optional(),
      })
      .strict()
      // y alone is rejected because it would be a VACUOUS assert: y is
      // measured and reported but never fails (absolute y drifts with device
      // aspect ratio alone — verify-contract gap rows check vertical
      // position), so a y-only rect could never fail once the element exists.
      .refine((r) => [r.x, r.w, r.h].some((v) => v !== undefined), {
        message:
          "rect needs at least one of: x, w, h — y alone can never fail (y is measured but not a failure source; use verify's contract gap rows for vertical position)",
      }),
    timeout: z.union([z.number(), z.string()]).optional(),
  })
  .strict();

/**
 * Single-element fill check (color-parity.ts): sample the element's region
 * from a screenshot and compare CIEDE2000 against `expected`. Hex only —
 * token names resolve in the superrepo layer, before the assert is written.
 * `deltaE` defaults to DEFAULT_TOLERANCE_DE (8) and is compared DIRECTLY —
 * without the 1.5x CONTRACT_TOL_FACTOR slack the contract axis gets (
 * the caller chose the hex); the real 2026-08-13 bug measures dE00 10.19,
 * so the default catches it. `theme` is a declarative annotation naming the
 * theme the hex was authored for — averi does not switch device themes.
 */
const colorAssert = z
  .object({
    element: elementSpecSchema,
    color: z
      .object({
        expected: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/, {
            message:
              'expected must be #RRGGBB or #RRGGBBAA (alpha is dropped) — token names resolve in the superrepo layer, put the resolved hex here',
          }),
        deltaE: z.number().positive().optional(),
        sample: z.enum(['dominant', 'patches']).optional(),
        theme: z.enum(['light', 'dark']).optional(),
      })
      .strict(),
    timeout: z.union([z.number(), z.string()]).optional(),
  })
  .strict();

/**
 * Single-element RENDERED-text check (text-parity.ts): crop the element's rect
 * out of a screenshot and read it back with the OCR recognizer.
 *
 * This is not a slower `{element, text}` — it answers a different question.
 * The element assert reads the accessibility tree, i.e. what assistive
 * technology is TOLD; measured 2026-08-14, that is not what the screen shows:
 * on iOS the visible 'CONTINUE' is absent from the tree entirely and
 * `credit_select` exposes 'To account' while rendering 'Select credit account'.
 * Use the element assert for a11y-facing copy, this one for what the user sees.
 *
 * `heightPct` additionally pins the rendered ink height in % of screen
 * width — the type-size check. Single-line elements only: multi-line ink runs
 * do not compose into one meaningful height.
 */
const ocrAssert = z
  .object({
    element: elementSpecSchema,
    ocr: z
      .object({
        text: z.string().optional(),
        /** Unanchored, no flags — text-parity.ts compiles it as `new RegExp(match)`; refused at parse when it does not compile. */
        match: regexSource().optional(),
        /** Ink height in % of screen width, e.g. 3.8 — see text-parity.ts. */
        heightPct: z.number().positive().optional(),
        /** Relative tolerance for heightPct, in % (default 10). */
        tolerancePct: z.number().positive().optional(),
      })
      .strict()
      .refine((o) => o.text !== undefined || o.match !== undefined || o.heightPct !== undefined, {
        message: 'ocr needs at least one of: text, match, heightPct — an empty ocr spec could never fail',
      })
      .refine((o) => !(o.text !== undefined && o.match !== undefined), {
        message: 'ocr takes text OR match, not both',
      }),
    timeout: z.union([z.number(), z.string()]).optional(),
  })
  .strict();

// rectAssert, colorAssert and ocrAssert are listed FIRST: zod's union error heuristic
// surfaces one branch's issues, and a `{element, rect}` input that fails the
// rect refine must show "y alone can never fail" (and a bad `{element,
// color}` its hex-format message), not elementAssert's "unrecognized key".
// Verified: the order does not change which inputs parse, nor the error
// surfaced for element-assert mistakes (their refine still wins).
export const assertSpecSchema = z.union([rectAssert, colorAssert, ocrAssert, elementAssertSchema, screenshotAssert]);
export type AssertSpec = z.infer<typeof assertSpecSchema>;

export interface AssertResult {
  description: string;
  pass: boolean;
  detail?: string;
}

/**
 * Where screenshot baselines live, relative to the project root. Kept relative
 * (resolved by the caller) so the value is one string in one place while the
 * cwd-at-access-time behaviour of the default stays exactly as it was.
 */
export const DEFAULT_BASELINE_DIR = '.averi/baselines';

/** The default budget of a tree assert (element, absent, rect, text) that names no `timeout`. */
const ASSERT_TIMEOUT_MS = 3_000;

/**
 * The default budget of a color or ocr assert that names no `timeout`
 * (2026-10-06). A pixel assert's round is a tree read AND a settled pair of
 * captures, and since c444c79 a frame that settled over the element's region
 * only is measured on the NEXT round, once a second read confirms the rect —
 * two rounds on any screen with a clock or a caret. Measured that day on the
 * Android emulator (docs/bugs/2026-10-06-pixel-assert-default-timeout-fits-
 * no-round-on-device.md): one round is a 2.7 s uiautomator read plus two
 * 0.65 s screencaps 300 ms apart, ~4.3 s, so two rounds and the pause
 * between them are ~8.9 s. With the shared 3 s these asserts could not pass
 * on that device even on a still screen: the 3 s only ever "worked" because
 * the capture overran it, which 4954ab4 stopped. 12 s covers two rounds
 * there with a margin for a slower emulator; a poll that passes returns as
 * soon as it does, so the larger budget costs only a failing assert.
 */
const PIXEL_ASSERT_TIMEOUT_MS = 12_000;

export interface VerifierOptions {
  baselineDir?: string;
  pollMs?: number;
  /**
   * One budget for EVERY assert that does not set its own `timeout`. Unset,
   * each kind takes its own default: 3 s for the tree asserts, 12 s for the
   * color and ocr asserts (see `PIXEL_ASSERT_TIMEOUT_MS`).
   */
  timeoutMs?: number;
  /** Test seam: the recognizer behind the `ocr` assert. */
  ocrEngine?: OcrEngine;
}

interface PollSpec {
  description: string;
  timeoutMs: number;
  /**
   * Detail for the failing result at the deadline, from the last non-passing
   * detail an evaluation produced and the last tree-read error. Each assert
   * words this itself, and they deliberately ORDER the two differently: an
   * element assert prefers the read error (a tree it never read explains the
   * miss), a rect assert prefers the measurement (it did read the tree, and
   * the numbers are the finding) — as the pixel poll does for the color and
   * ocr asserts (verify/pixel-poll.ts), which word theirs there.
   */
  timeoutDetail: (last: { detail?: string; readError?: Error }) => string;
}

export class Verifier {
  private readonly baselineDir: string;
  private readonly pollMs: number;
  /** The caller's budget for every assert, when it set one; else each kind's default applies. */
  private readonly timeoutMs: number | undefined;
  /** Built on first `ocr` assert so non-OCR runs never probe for a toolchain. */
  private ocr: OcrEngine | undefined;

  constructor(
    private readonly adapter: DeviceAdapter,
    opts: VerifierOptions = {},
  ) {
    this.baselineDir = opts.baselineDir ?? DEFAULT_BASELINE_DIR;
    this.pollMs = opts.pollMs ?? 300;
    this.timeoutMs = opts.timeoutMs;
    this.ocr = opts.ocrEngine;
  }

  async assertAll(specs: AssertSpec[]): Promise<AssertResult[]> {
    const results: AssertResult[] = [];
    for (const spec of specs) results.push(await this.assert(spec));
    return results;
  }

  async assert(spec: AssertSpec): Promise<AssertResult> {
    if ('screenshot' in spec) {
      return this.assertScreenshot(spec.screenshot.baseline, spec.screenshot.threshold ?? 0.01);
    }
    const pixel = 'color' in spec || 'ocr' in spec;
    const timeoutMs =
      spec.timeout !== undefined ? parseDuration(spec.timeout)
      : (this.timeoutMs ?? (pixel ? PIXEL_ASSERT_TIMEOUT_MS : ASSERT_TIMEOUT_MS));
    if ('rect' in spec) return this.assertRect(spec.element, spec.rect, timeoutMs);
    if ('color' in spec) return this.assertColor(spec.element, spec.color, timeoutMs);
    if ('ocr' in spec) return this.assertOcr(spec.element, spec.ocr, timeoutMs);
    if (spec.absent) return this.assertAbsent(spec.element, timeoutMs);
    return this.assertElement(spec.element, spec.text, spec.match, spec.error, timeoutMs);
  }

  private async assertElement(
    element: ElementSpec,
    text: string | undefined,
    match: string | undefined,
    error: string | undefined,
    timeoutMs: number,
  ): Promise<AssertResult> {
    const wants =
      text !== undefined ? ` with text ${JSON.stringify(text)}`
      : match !== undefined ? ` matching /${match}/`
      : error !== undefined ? ` with error ${JSON.stringify(error)}`
      : '';
    const description = `element ${describe(element)}${wants} exists`;
    const contentMatches = (n: UiNode): boolean => {
      const values = [n.label, n.value].filter((v): v is string => v !== null);
      if (text !== undefined) return values.includes(text);
      if (match !== undefined) return values.some((v) => new RegExp(match).test(v));
      if (error !== undefined) return n.error === error;
      return true;
    };
    // Which literal string was expected to be SOMEONE's whole label — the only
    // kind of miss a containment hint explains. A `match` is already a regex
    // (containment is what it does), and an `error` assert is about a
    // different field entirely: hinting about its selector text there would
    // explain a failure that did not happen.
    const exactText =
      text ?? (match === undefined && error === undefined ? (element.text ?? element.label) : undefined);
    // What the verdict is really about, captured for the deadline where poll
    // no longer has a tree. The hint is scoped to the nodes the SPEC matched
    // whenever it matched any — an id-addressed assert must not be explained
    // by an unrelated node elsewhere on screen — and widens to the whole tree
    // only when the spec found nothing to talk about.
    let hintScope: UiNode[] | undefined;
    return this.poll(
      (tree) => {
        const found = findBySpec(tree, element);
        hintScope = found.length > 0 ? found : flattenTree(tree);
        if (found.some(contentMatches)) return { pass: true };
        if (found.length === 0) return undefined;
        // The element is there but says the wrong thing — worth reporting at
        // the deadline, not worth ending the poll for.
        return {
          pass: false,
          detail: found
            .slice(0, 3)
            .map((n) => JSON.stringify(error !== undefined ? (n.error ?? null) : (n.label ?? n.value)))
            .join(', '),
        };
      },
      {
        description,
        timeoutMs,
        timeoutDetail: ({ detail, readError }) => {
          if (readError !== undefined) return notFound(timeoutMs, readError);
          const base =
            detail !== undefined ?
              `element found but ${error !== undefined ? 'error' : 'content'} was: ${detail}`
            : notFound(timeoutMs);
          const hint =
            exactText === undefined || hintScope === undefined ?
              undefined
            : containsTextHint(hintScope, exactText);
          return hint === undefined ? base : `${base}\n  ${hint}`;
        },
      },
    );
  }

  /**
   * Geometry vs Figma-frame values, in % of screen width — the window width
   * `verify/scale.ts#windowWidth` judges for each round's tree, witnessed by
   * the device screen, the same answer the whole-screen comparator reads off
   * its frame. A width it refuses fails the round closed (2026-10-07; a
   * CONTENT width used to pass with a remark).
   * Polls like the other asserts: mid-animation geometry may legitimately be
   * off for a frame, so only the state at timeout is the verdict.
   */
  private async assertRect(
    element: ElementSpec,
    expected: RectExpectation,
    timeoutMs: number,
  ): Promise<AssertResult> {
    const tolerance = expected.tolerancePct ?? DEFAULT_TOLERANCE_PCT;
    const description = `element ${describe(element)} rect within ${tolerance}% of screen width (figma frame ${expected.frameWidth})`;
    // The witness, read once (memoized by the adapter), and re-read fresh at
    // most once for the whole assert, before a wider-than-screen refusal
    // (capture.ts#ScreenWitness). A failed read is not a failed assert: the
    // width is then the tree's alone, and windowWidth says so in the detail —
    // the degradation captureFrame applies to the table.
    const witness = await ScreenWitness.read(this.adapter);
    return this.poll(
      async (tree) => {
        // First occurrence wins — the same duplicate-id rule as rect-parity.
        const found = findBySpec(tree, element);
        return found.length === 0 ? undefined : evaluateRectAssert(found[0].rect, expected, await witness.judge(tree));
      },
      {
        description,
        timeoutMs,
        timeoutDetail: ({ detail, readError }) => detail ?? notFound(timeoutMs, readError),
      },
    );
  }

  /**
   * Rendered text vs what the screen actually shows (text-parity.ts). Needs
   * BOTH the tree (the element's rect) and a screenshot (pixels), scaled
   * together. The round — find, capture against that tree, wait for the png
   * to settle, decode, and only then measure — is the pixel poll's
   * (verify/pixel-poll.ts); what is here is the measurement: crop the rect,
   * recognize, compare. The recognizer is closed over, so the poll never
   * learns OCR exists.
   *
   * Unavailable OCR fails the assert with the reason rather than skipping it:
   * a check the caller asked for and did not get must never read as a pass.
   */
  private async assertOcr(
    element: ElementSpec,
    expectation: OcrExpectation,
    timeoutMs: number,
  ): Promise<AssertResult> {
    const wants = [
      expectation.text !== undefined ? `text ${JSON.stringify(expectation.text)}` : undefined,
      expectation.match !== undefined ? `matching /${expectation.match}/` : undefined,
      expectation.heightPct !== undefined ? `ink height ${expectation.heightPct}% of width` : undefined,
    ].filter((v): v is string => v !== undefined);
    const description = `element ${describe(element)} renders ${wants.join(' and ')}`;
    const choice = ocrEngineFor(this.ocr);
    if (choice.unavailable !== undefined) {
      return { description, pass: false, detail: failClosed(choice.unavailable, 'rendered text') };
    }
    // Memoized: one VisionOcr per Verifier, so its compiled binary is reused across asserts.
    const engine = (this.ocr ??= choice.engine);
    // The rect is the FIRST match's (the pixel poll's rule, the same as
    // rect-parity's). The whole-screen text table deliberately does the
    // opposite; here the caller named ONE element and gets that element's rect.
    const result = await pollPixels(this.adapter, {
      element,
      timeoutMs,
      pollMs: this.pollMs,
      unchecked: 'rendered text',
      measure: async ({ rect, shot, measured }) => {
        try {
          const { region, note, error } = ocrRegionForRect('element', rect, measured);
          if (region === undefined) {
            return { pass: false, detail: failClosed(error, 'rendered text') };
          }
          const [read] = await engine.recognize(shot, [region]);
          if (read?.error !== undefined) return { pass: false, detail: read.error };
          const verdict = evaluateOcrAssert(expectation, read?.lines ?? [], measured.png.width);
          return note === undefined ? verdict : { ...verdict, detail: `${verdict.detail}; ${note}` };
        } catch (e) {
          // Keep polling — the capture may have raced a transition — but stay
          // failed so a deadline reached this way reports the reason.
          return { pass: false, detail: `OCR failed: ${errorMessage(e)}` };
        }
      },
    });
    return { description, ...result };
  }

  /**
   * Fill color vs an expected hex (color-parity.ts). Needs BOTH the tree
   * (the element's rect) and a screenshot (pixels), scaled together — the
   * same captured frame the `ocr` assert measures against. The measurement
   * is one sample of that rect; the round around it is the pixel poll's
   * (verify/pixel-poll.ts), which hands it only a SETTLED, decoded frame.
   * Since 2026-10-05 a frame that did not settle is a miss, never a sample —
   * before, the last of six differing captures was measured and the number
   * called a verdict.
   */
  private async assertColor(
    element: ElementSpec,
    expectation: ColorExpectation,
    timeoutMs: number,
  ): Promise<AssertResult> {
    const tol = expectation.deltaE ?? DEFAULT_TOLERANCE_DE;
    const expectedHex = normalizeHex(expectation.expected);
    const description =
      `element ${describe(element)} fill within dE00 ${tol} of ${expectedHex}` +
      (expectation.theme !== undefined ? ` (${expectation.theme} theme)` : '');
    const result = await pollPixels(this.adapter, {
      element,
      timeoutMs,
      pollMs: this.pollMs,
      unchecked: 'color',
      measure: ({ rect, measured }) => evaluateColorAssert(rect, expectation, measured),
    });
    return { description, ...result };
  }

  /**
   * The shape the tree-only asserts share (ARCHITECTURE.md §8, "waits, not
   * sleeps"): read the tree, evaluate it, stop on a pass, otherwise remember
   * what it said and retry until the deadline. The color and ocr asserts
   * poll through `pollPixels` (verify/pixel-poll.ts) since 2026-10-06, on
   * the same loop and the same verdict translation (verify/poll-verdict.ts).
   *
   * The loop itself is `pollTree` (ui-tree/read-tree.ts) since 2026-10-03 —
   * before that this method was one of three copies of it. What stays here
   * is the verifier's vocabulary: a PollVerdict in, an AssertResult out, and
   * the per-assert timeout wording.
   *
   * `pollMs` is the interval between rounds and NOTHING else (2026-10-05):
   * until then it was also forwarded to the capture as its stability delay,
   * so an assert inside a flow (engine pollMs 500) waited 500 ms between
   * stability captures and the same assert from the MCP tool 300 — the
   * budget capture.ts documents as one. The round's deadline is handed to
   * the capture instead (by the pixel poll since 2026-10-06; by the color and
   * ocr evaluators through this method until then), so a capture stops short
   * of it. Measured with the same fake-device harness as before (screencap
   * 300 ms, uiautomator dump 1.5 s, timeoutMs 3000, pollMs 300):
   *
   *   screen               before                        after
   *   never settles        4.86 s · 6 shots · 1 round,   4.24 s · 2 shots · 2 rounds · the failure
   *                        a "verdict" from a frame      says the frame never settled; the 2nd
   *                        nobody knew was moving        round's read ends past the deadline and
   *                                                      captures nothing
   *   settled, failing     5.13 s · 4 shots · 2 rounds   4.23 s · 2 shots · 2 rounds · the measured
   *                                                      finding is the verdict
   *   fast fake 50/100 ms  4.23 s · 12 shots · 2 rounds  3.19 s · 8 shots · 3 rounds
   *
   * A "round" is one tree read (one `pollTree` iteration), whether or not it
   * went on to capture; a round that captured nothing measured nothing —
   * with a 1.5 s dump and a 3 s budget exactly one evaluation fits.
   * The overrun that remains is one tree read past the deadline — the slack
   * every poll has (ui-tree/read-tree.ts), kept so a late element is found;
   * what is gone is the capture budget spent on top of it, and the verdict
   * from a frame that was still moving.
   */
  private async poll(
    evaluate: (tree: UiNode) => PollVerdict | undefined | Promise<PollVerdict | undefined>,
    spec: PollSpec,
  ): Promise<AssertResult> {
    const { description, timeoutMs } = spec;
    const outcome = await pollTree(this.adapter, async (tree) => verdictToPoll(await evaluate(tree)), {
      timeoutMs,
      pollMs: this.pollMs,
    });
    if (!outcome.timedOut) return { description, pass: true, detail: outcome.value.detail };
    return {
      description,
      pass: false,
      detail: spec.timeoutDetail({ detail: outcome.detail, readError: outcome.readError }),
    };
  }

  /**
   * absent = gone from the tree OR present with a rect outside the visible
   * viewport. The raw trees disagree (Android prunes off-screen nodes, iOS
   * keeps them with off-viewport rects); this is the one portable meaning.
   */
  private async assertAbsent(element: ElementSpec, timeoutMs: number): Promise<AssertResult> {
    const description = `element ${describe(element)} is absent`;
    // Read before polling: a viewport that cannot be read is an error, not a
    // failed assert — absence is meaningless without a reference frame.
    // (Memoized by the adapter — adapters/types.ts — so this is one device
    // read per adapter, not per assert.)
    const viewport = await this.adapter.viewport();
    return this.poll(
      (tree) => {
        const found = findBySpec(tree, element);
        if (!absentFromViewport(found, viewport)) return undefined;
        return {
          pass: true,
          detail:
            found.length > 0 ? `${found.length} node(s) in tree but none intersect the viewport` : undefined,
        };
      },
      {
        description,
        timeoutMs,
        // An unreadable tree is NOT evidence of absence — it is why we could
        // not tell, so it outranks "still visible".
        timeoutDetail: ({ readError }) =>
          readError !== undefined
            ? `could not verify within ${timeoutMs}ms (last UI tree read failed: ${readError.message})`
            : `still visible after ${timeoutMs}ms`,
      },
    );
  }

  private async assertScreenshot(name: string, threshold: number): Promise<AssertResult> {
    const description = `screenshot matches baseline "${name}" (threshold ${threshold * 100}%)`;
    const path = join(this.baselineDir, this.adapter.platform, `${name}.png`);
    // The SETTLED frame (verify/capture.ts, png-only arm, the one stability
    // budget). Until 2026-10-04 this was the one pixel reading that took a
    // bare screenshot, so a baseline diff could compare two mid-animation
    // frames — the flakiest assert by construction. It now costs the
    // stability budget where it cost one capture (captures, wait and failure
    // chances: capture.ts, STABILITY_*). Since 2026-10-05 the capture SAYS
    // whether it settled. CREATION fails closed on a frame seen moving —
    // before, a screen that never settled (spinner, caret, live content)
    // silently stored its last frame as the ground truth for every later
    // run. A DIFF against an existing baseline still compares the last frame
    // and keeps its verdict, with the `⚠ frame:` note on the detail: a
    // blinking caret or a clock inside the 1.5 s budget used to pass the
    // diff under threshold, and the threshold exists for exactly that — a
    // refusal there (tried the same day, withdrawn in review) would have
    // tightened a passing assert. Re-baseline any screenshot assert that
    // was flaky under the bare read.
    //
    // Since 2026-10-06 the baseline file is read BEFORE the capture, because
    // the two paths now capture differently. CREATION takes
    // `captureBaselineFrame`: the same settled pair, then a confirmation
    // window of four more captures that must all match it, since a pair
    // ≈0.95 s apart (Android emulator; ≈0.8 s iOS simulator) lands in phase
    // with a ≈1 s caret blink and compared equal — a baseline was created
    // on device from a caret screen, holding one phase of the blink
    // (docs/bugs/2026-10-06-whole-screen-stability-aliases-a-blinking-caret
    // .md; the schedule, its simulation and its cost are on capture.ts's
    // BASELINE_CONFIRMATION_DELAYS_MS). A refusal there gets its own
    // sentence, because two captures DID match. A DIFF takes plain
    // `captureFrame` exactly as before — same captures, same sleeps, same
    // `⚠ frame:` note — so only the once-per-baseline path pays the window.
    // A read that fails for any reason means "create", as it did when the
    // read came second; reading first changes nothing but the order — except
    // that the read-to-write window is now the whole creation capture, ≈3 s
    // on the Android emulator where it was a file read: two concurrent first
    // runs of the same baseline can both find no file and both write, the
    // later write winning. Each wrote a confirmed still frame, so nothing
    // unexamined is stored; no lock is taken.
    let baseline: Buffer;
    try {
      baseline = await readFile(path);
    } catch {
      // A capture the adapter refuses fails THIS assert, closed, and assertAll
      // goes on (2026-10-08) — pixel-poll.ts's header has the rule.
      let candidate: BaselineFrame;
      try {
        candidate = await captureBaselineFrame(this.adapter);
      } catch (e) {
        return { description, pass: false, detail: screenshotFailed(captureRefusal(e), 'baseline match') };
      }
      // Fail closed (review 2026-10-06): ONLY a confirmed window creates.
      // The first cut refused on `confirmed === false`, so a frame without
      // the field — `unjudged`, which a deadline on this path would produce —
      // would have been stored unexamined. Each refusal is worded for what
      // was actually seen.
      if (candidate.confirmed !== true) {
        return { description, pass: false, detail: `baseline not created: ${baselineRefusal(candidate)}` };
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, candidate.shot);
      return { description, pass: true, detail: `baseline created at ${path}` };
    }
    let frame: Frame;
    try {
      frame = await captureFrame(this.adapter);
    } catch (e) {
      return { description, pass: false, detail: screenshotFailed(captureRefusal(e), 'baseline match') };
    }
    const current = frame.shot;
    const note = unsettledNote(frame);
    const withNote = (detail: string): string => (note === undefined ? detail : `${detail}\n${note}`);

    const a = PNG.sync.read(baseline);
    const b = PNG.sync.read(current);
    if (a.width !== b.width || a.height !== b.height) {
      return {
        description,
        pass: false,
        detail: withNote(`size mismatch: baseline ${a.width}x${a.height}, current ${b.width}x${b.height}`),
      };
    }
    const diffPixels = pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: 0.1 });
    const ratio = diffPixels / (a.width * a.height);
    const pct = (ratio * 100).toFixed(2);
    return {
      description,
      pass: ratio <= threshold,
      detail: withNote(`${pct}% of pixels differ`),
    };
  }
}

/**
 * Why a baseline candidate was not stored, in the words of what the capture
 * saw (2026-10-06). `moving` keeps its 2026-10-05 sentence verbatim; a pair
 * that settled and then changed in the confirmation window says so (two
 * captures DID match, so "each different from the last" would be false);
 * `unjudged` cannot happen today — baseline creation passes no deadline, so
 * the pair always gets its second capture — and is worded rather than
 * stored, so the day a deadline arrives it fails closed and truthfully.
 */
function baselineRefusal(frame: BaselineFrame): string {
  switch (frame.stability) {
    case 'moving':
      return `${unsettledReason(frame)} (a baseline of a moving screen would fail every later run)`;
    case 'settled':
      return `${unconfirmedReason(frame)} (a baseline holding one phase of it would pass or fail every later run by that phase)`;
    case 'unjudged':
      return `the screen was not judged: ${frame.captures} capture before the deadline, too few to say whether it was still (a baseline needs a settled pair and its confirmation window); re-run with more time`;
  }
}

/** Crash signatures per platform, scanned over recent device logs. */
const CRASH_PATTERNS: Record<'android' | 'ios', RegExp[]> = {
  android: [/FATAL EXCEPTION/, /ANR in /, /Force finishing activity/, /native crash/i, /SIGSEGV|SIGABRT/],
  ios: [
    /Terminating app due to uncaught exception/,
    /NSInvalidArgumentException|NSRangeException/,
    /EXC_BAD_ACCESS|EXC_CRASH/,
    /abort\(\) called/,
    /Fatal error:/,
  ],
};

/** Returns crash-related log lines (with a little trailing context for stack traces). */
export function scanForCrashes(lines: string[], platform: 'android' | 'ios'): string[] {
  const patterns = CRASH_PATTERNS[platform];
  const excerpt: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((p) => p.test(lines[i]))) {
      excerpt.push(...lines.slice(i, i + 8));
      i += 7;
    }
  }
  return excerpt;
}

