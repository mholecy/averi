import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { z } from 'zod';
import type { DeviceAdapter, UiNode } from '../adapters/types.js';
import { describeElementSpec as describe, elementSpecSchema, type ElementSpec } from '../ui-tree/element-spec.js';
import { readTreeOrError } from '../ui-tree/read-tree.js';
import { parseDuration } from '../util/duration.js';
import { sleep } from '../util/sleep.js';
import { elementAssertSchema } from './element-assert.js';
import { DEFAULT_TOLERANCE_DE, evaluateColorAssert, normalizeHex, type ColorExpectation } from './color-parity.js';
import { ocrUnavailableReason, VisionOcr, type OcrEngine } from './ocr.js';
import { DEFAULT_TOLERANCE_PCT, evaluateRectAssert, type RectExpectation } from './rect-parity.js';
import { evaluateOcrAssert, ocrRegionForRect, type OcrExpectation } from './text-parity.js';
import { findBySpec, intersectsViewport } from '../ui-tree/selectors.js';

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
        match: z.string().optional(),
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

export interface VerifierOptions {
  baselineDir?: string;
  pollMs?: number;
  timeoutMs?: number;
  /** Test seam: the recognizer behind the `ocr` assert. */
  ocrEngine?: OcrEngine;
}

/**
 * What one poll round concluded. `undefined` (not this type) means "nothing to
 * say, keep polling" — the element isn't there yet. `pass: true` stops the
 * poll; `pass: false` carries a detail worth reporting IF the deadline is
 * reached, without ending the poll: mid-animation geometry may legitimately be
 * wrong for a frame, so only the state at timeout is the verdict.
 */
interface PollVerdict {
  pass: boolean;
  detail?: string;
}

interface PollSpec {
  description: string;
  timeoutMs: number;
  /**
   * Detail for the failing result at the deadline, from the last non-passing
   * detail an evaluation produced and the last tree-read error. Each assert
   * words this itself, and they deliberately ORDER the two differently: an
   * element assert prefers the read error (a tree it never read explains the
   * miss), a rect/color assert prefers the measurement (it did read the tree,
   * and the numbers are the finding).
   */
  timeoutDetail: (last: { detail?: string; readError?: Error }) => string;
}

/** "not found within Nms", plus the last tree-read error when there was one. */
const notFound = (timeoutMs: number, readError?: Error): string =>
  `not found within ${timeoutMs}ms` +
  (readError === undefined ? '' : ` (last UI tree read failed: ${readError.message})`);

export class Verifier {
  private readonly baselineDir: string;
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  /** Built on first `ocr` assert so non-OCR runs never probe for a toolchain. */
  private ocr: OcrEngine | undefined;

  constructor(
    private readonly adapter: DeviceAdapter,
    opts: VerifierOptions = {},
  ) {
    this.baselineDir = opts.baselineDir ?? DEFAULT_BASELINE_DIR;
    this.pollMs = opts.pollMs ?? 300;
    this.timeoutMs = opts.timeoutMs ?? 3_000;
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
    const timeoutMs = spec.timeout !== undefined ? parseDuration(spec.timeout) : this.timeoutMs;
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
    return this.poll(
      (tree) => {
        const found = findBySpec(tree, element);
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
        timeoutDetail: ({ detail, readError }) =>
          readError !== undefined ? notFound(timeoutMs, readError)
          : detail !== undefined ? `element found but ${error !== undefined ? 'error' : 'content'} was: ${detail}`
          : notFound(timeoutMs),
      },
    );
  }

  /**
   * Geometry vs Figma-frame values, in % of screen width (screen width =
   * widest rect in the tree, same rule as the whole-screen comparator).
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
    return this.poll(
      (tree) => {
        // First occurrence wins — the same duplicate-id rule as rect-parity.
        const found = findBySpec(tree, element);
        return found.length === 0 ? undefined : evaluateRectAssert(found[0].rect, expected, tree);
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
   * BOTH the tree (element rect + root width for the png scale) and a
   * screenshot (pixels), and polls on a freshly captured STABLE screenshot for
   * the same reason the color assert does.
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
    const unavailable = this.ocr === undefined ? ocrUnavailableReason() : undefined;
    if (unavailable !== undefined) {
      return { description, pass: false, detail: `${unavailable}; failing closed, rendered text unchecked` };
    }
    const engine = (this.ocr ??= new VisionOcr());
    return this.poll(
      async (tree) => {
        // First occurrence wins — the same duplicate-id rule as rect-parity.
        // (The whole-screen text table deliberately does the opposite; here
        // the caller named ONE element and gets that element's rect.)
        const found = findBySpec(tree, element);
        if (found.length === 0) return undefined;
        const shot = await captureStableScreenshot(this.adapter, 5, this.pollMs);
        try {
          const png = PNG.sync.read(shot);
          const region = ocrRegionForRect('element', found[0].rect, tree, png.width, png.height);
          if (region === undefined) {
            return { pass: false, detail: 'element rect or screen width is degenerate — cannot crop; failing closed' };
          }
          const [result] = await engine.recognize(shot, [region]);
          if (result?.error !== undefined) return { pass: false, detail: result.error };
          return evaluateOcrAssert(expectation, result?.lines ?? [], png.width);
        } catch (e) {
          // Keep polling — the capture may have raced a transition — but stay
          // failed so a deadline reached this way reports the reason.
          return { pass: false, detail: `OCR failed: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
      {
        description,
        timeoutMs,
        timeoutDetail: ({ detail, readError }) => detail ?? notFound(timeoutMs, readError),
      },
    );
  }

  /**
   * Fill color vs an expected hex (color-parity.ts). Needs BOTH the tree
   * (element rect + root width for the png scale) and a screenshot (pixels).
   * Polls like the other asserts; each evaluation samples a freshly captured
   * STABLE screenshot — the same two-identical-consecutive-captures wait the
   * `screenshot` tool applies — so mid-animation frames are not the verdict,
   * and the tree is re-read alongside so both come from the same state.
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
    return this.poll(
      async (tree) => {
        // First occurrence wins — the same duplicate-id rule as rect-parity.
        const found = findBySpec(tree, element);
        if (found.length === 0) return undefined;
        const shot = await captureStableScreenshot(this.adapter, 5, this.pollMs);
        try {
          const png = PNG.sync.read(shot);
          return evaluateColorAssert(found[0].rect, expectation, tree, png);
        } catch (e) {
          // Fail closed on an undecodable screenshot, but keep polling —
          // the capture may have raced a transition.
          return { pass: false, detail: `screenshot PNG decode failed: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
      {
        description,
        timeoutMs,
        timeoutDetail: ({ detail, readError }) => detail ?? notFound(timeoutMs, readError),
      },
    );
  }

  /**
   * The shape every polling assert shares (ARCHITECTURE.md §8, "waits, not
   * sleeps"): read the tree, evaluate it, stop on a pass, otherwise remember
   * what it said and retry until the deadline.
   *
   * A FAILED tree read is a miss, not a failure — right after launch the
   * device can be momentarily unable to produce one (uiautomator "null root
   * node") — so it never ends the poll and never counts as evidence; it is
   * kept only to explain a timeout. Owning that rule in one place is the point
   * of this method: it was written out four times, once per assert.
   */
  private async poll(
    evaluate: (tree: UiNode) => Promise<PollVerdict | undefined> | PollVerdict | undefined,
    spec: PollSpec,
  ): Promise<AssertResult> {
    const { description, timeoutMs } = spec;
    const deadline = Date.now() + timeoutMs;
    let detail: string | undefined;
    let readError: Error | undefined;
    for (;;) {
      const read = await readTreeOrError(this.adapter);
      readError = read.error;
      if (read.tree !== undefined) {
        const verdict = await evaluate(read.tree);
        if (verdict?.pass) return { description, pass: true, detail: verdict.detail };
        // Only overwrite with something to say. An evaluation with nothing to
        // report (element not present this round) must not ERASE what an
        // earlier round saw — that is what makes "element found but content
        // was: …" survive the element vanishing again before the deadline.
        if (verdict?.detail !== undefined) detail = verdict.detail;
      }
      if (Date.now() >= deadline) {
        return { description, pass: false, detail: spec.timeoutDetail({ detail, readError }) };
      }
      await sleep(this.pollMs);
    }
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
    const viewport = await this.adapter.viewport();
    return this.poll(
      (tree) => {
        const found = findBySpec(tree, element);
        const visible = found.filter((n) => intersectsViewport(n.rect, viewport));
        if (visible.length > 0) return undefined;
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
    const current = await this.adapter.screenshot();

    let baseline: Buffer;
    try {
      baseline = await readFile(path);
    } catch {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, current);
      return { description, pass: true, detail: `baseline created at ${path}` };
    }

    const a = PNG.sync.read(baseline);
    const b = PNG.sync.read(current);
    if (a.width !== b.width || a.height !== b.height) {
      return {
        description,
        pass: false,
        detail: `size mismatch: baseline ${a.width}x${a.height}, current ${b.width}x${b.height}`,
      };
    }
    const diffPixels = pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: 0.1 });
    const ratio = diffPixels / (a.width * a.height);
    const pct = (ratio * 100).toFixed(2);
    return {
      description,
      pass: ratio <= threshold,
      detail: `${pct}% of pixels differ`,
    };
  }
}

/**
 * THE stability wait for screenshots — two identical consecutive captures,
 * bounded attempts — shared by the `screenshot` MCP tool (5 attempts, 300ms)
 * and the color assert (5 attempts, the verifier's pollMs, so tests stay
 * fast). Keep it single: each call costs 2 to attempts+1 device captures,
 * and the color assert already pays that PER POLL ITERATION — do not add
 * more callers casually, and never inside a tight loop.
 */
export async function captureStableScreenshot(
  adapter: Pick<DeviceAdapter, 'screenshot'>,
  attempts = 5,
  delayMs = 300,
): Promise<Buffer> {
  let previous = await adapter.screenshot();
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    const current = await adapter.screenshot();
    if (current.equals(previous)) return current;
    previous = current;
  }
  return previous;
}

/**
 * Bounded-retry tree read for one-shot consumers (verify's rect-parity leg):
 * right after a flow settles, a device can transiently fail to produce a
 * tree (uiautomator "null root node") — the same transient the polling
 * asserts absorb via readTreeOrError. Throws after the last attempt with the
 * underlying error in the message.
 */
export async function readTreeWithRetry(
  adapter: DeviceAdapter,
  attempts = 5,
  delayMs = 300,
): Promise<UiNode> {
  let lastError: Error | undefined;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(delayMs);
    try {
      return await adapter.uiTree();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw new Error(`UI tree read failed after ${attempts} attempts: ${lastError?.message ?? 'unknown error'}`);
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

