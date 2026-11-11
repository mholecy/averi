import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { z } from 'zod';
import { PersistentReadError, type DeviceAdapter, type UiNode } from '../adapters/types.js';
import { describeElementSpec, elementSpecSchema, type ElementSpec } from '../ui-tree/element-spec.js';
import { pollOnVerdict, pollTree, Undecided, type FirstSample } from '../ui-tree/read-tree.js';
import { ReadHandOff } from '../ui-tree/read-handoff.js';
import { markedForMiss } from '../ui-tree/window-mark.js';
import { durationSchema, formatSeconds, parseDuration } from '../util/duration.js';
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
import { colorSampleRect, DEFAULT_TOLERANCE_DE, evaluateColorAssert, normalizeHex, type ColorExpectation } from './color-parity.js';
import { ocrEngineFor, type OcrEngineChoice } from './ocr.js';
import { decodePng } from './png.js';
import { DEFAULT_TOLERANCE_PCT, evaluateRectAssert, type RectExpectation } from './rect-parity.js';
import { measureOcrAssert, type OcrExpectation } from './text-parity.js';
import { findBySpec } from '../ui-tree/selectors.js';
import { absenceVerdict, bareTimeoutNote } from '../ui-tree/verdict.js';
import { flattenTree, textHint } from './text-hint.js';

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
    timeout: durationSchema.optional(),
  })
  .strict();

/**
 * Single-element fill check (color-parity.ts): sample the element's region
 * from a screenshot and compare CIEDE2000 against `expected`. Hex only —
 * token names resolve in the superrepo layer, before the assert is written.
 * `deltaE` defaults to DEFAULT_TOLERANCE_DE (8) and is compared DIRECTLY —
 * without the 1.5x CONTRACT_TOL_FACTOR slack the contract axis gets (
 * the caller chose the hex); the real bug it was written for measures dE00 10.19,
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
    timeout: durationSchema.optional(),
  })
  .strict();

/**
 * Single-element RENDERED-text check (text-parity.ts): crop the element's rect
 * out of a screenshot and read it back with the OCR recognizer.
 *
 * This is not a slower `{element, text}` — it answers a different question.
 * The element assert reads the accessibility tree, i.e. what assistive
 * technology is TOLD; measured, that is not what the screen shows:
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
    timeout: durationSchema.optional(),
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

/**
 * The default budget of a tree assert (element, absent, rect, text) that names
 * no `timeout`. Exported for the MCP tool descriptions and the bare-tree note
 * (mcp/tools.ts, mcp/tool-text.ts), which quote it rather than restate it.
 */
export const ASSERT_TIMEOUT_MS = 3_000;

/**
 * The default budget of a color or ocr assert that names no `timeout`. A
 * pixel assert's round is a tree read AND a settled pair of captures, and a
 * frame that settled over the element's region only is measured on the NEXT
 * round, once a second read confirms the rect — two rounds on any screen
 * with a clock or a caret. Measured on the Android emulator (the bug note
 * below): one round is a 2.7 s uiautomator read plus two 0.65 s
 * screencaps 300 ms apart, ~4.3 s, so two rounds and the 150 ms floor
 * between them are ~8.75 s (~8.9 s before 2026-10-31, when the whole 300 ms
 * poll was slept after a read that already outlasts it — pollTree, ADR
 * 0029). With the shared 3 s these asserts could not pass on that device
 * even on a still screen: the 3 s only ever "worked" because
 * the capture overran it, which the capture no longer does. 12 s covers two
 * rounds there with a margin for a slower emulator; a poll that passes
 * returns as soon as it does, so the larger budget costs only a failing
 * assert. Exported for the `assert` tool's description, which quotes it.
 * docs/bugs/2026-10-06-pixel-assert-default-timeout-fits-no-round-on-device.md
 */
export const PIXEL_ASSERT_TIMEOUT_MS = 12_000;

export interface VerifierOptions {
  baselineDir?: string;
  pollMs?: number;
  /**
   * One budget for EVERY assert that does not set its own `timeout`. Unset,
   * each kind takes its own default: 3 s for the tree asserts, 12 s for the
   * color and ocr asserts (see `PIXEL_ASSERT_TIMEOUT_MS`).
   */
  timeoutMs?: number;
  /**
   * The OCR choice every `ocr` assert of this Verifier reads with: the
   * verify run's one decision (run/verify.ts — the same value
   * its text table reads with) or a test's fake (`{ engine }`). Unset, the
   * host's (`ocrEngineFor()`) is chosen on the first `ocr` assert and kept
   * for the Verifier's life.
   */
  ocr?: OcrEngineChoice;
  /**
   * The hand-off of the last read (ui-tree/read-handoff.ts, docs/adr/0030-a-read-is-handed-on-only-as-a-first-sample-
   * or-a-positive-verdict.md) this Verifier shares with whoever ran before it in the same call: the flow engine
   * passes its own to a flow's `assert:` step, the `verify` tool's leg one hand-off to its engine run and its
   * Verifier. Unset, the Verifier has one of its own — so the asserts of one `assert` call hand on to each other, and
   * nothing reaches the next call.
   */
  handOff?: ReadHandOff;
  /**
   * What an assert does on a tree read no wait cures (adapters/types.ts#PersistentReadError, D21 — idb's wedged
   * accessibility service). `throw` (the default, safe): the error propagates as it came, after the assert's one
   * read — so a flow's `assert:` step stops the flow on the named error, which the engine's `isTerminal` holds
   * (`optional:` does not skip it, the ladder neither escalates past it nor salvages it). `fail`: the assert fails,
   * its message the detail, and the next assert runs — asked only by the two callers whose reply is the assert
   * results themselves: a `verify` leg (run/verify.ts — a throw would lose its frame, screenshot and health line) and
   * the MCP `assert` tool (run/commands.ts#runAsserts). D21 review round 2: a failing result everywhere turned a
   * flow's wedged assert into a plain "flow asserts failed" that `optional:` skipped and the ladder escalated past.
   */
  persistentRead?: PersistentReadMode;
}

/** VerifierOptions.persistentRead: whether an assert throws a read no wait cures (`throw`) or fails on it (`fail`). */
export type PersistentReadMode = 'throw' | 'fail';

/**
 * One assert, planned and not yet run (A20): what it checks, and the run — a tree poll, a pixel poll, or the
 * screenshot diff — whose verdict becomes the result. `Verifier.decided` runs every plan, so whatever a run throws
 * meets the persistentRead policy there and nowhere else.
 */
interface PlannedAssert {
  description: string;
  run: () => Promise<PollVerdict>;
}

interface PollSpec {
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
  timeoutDetail: (last: { detail?: string; readError?: Error; undecidedTree?: UiNode; lastTree?: UiNode }) => string;
  /**
   * The element whose not-found `timeoutDetail` words when no evaluation left a detail — what the window manager's word
   * is asked about at the deadline (ui-tree/window-mark.ts#markedForMiss). Absent for an assert that words no
   * not-found (`absent`: "still visible").
   */
  missing?: ElementSpec;
  /** Where this assert may take a handed-on read as its first round — the element assert only (see `assert`). */
  first?: FirstSample;
}

export class Verifier {
  private readonly baselineDir: string;
  private readonly pollMs: number;
  /** The caller's budget for every assert, when it set one; else each kind's default applies. */
  private readonly timeoutMs: number | undefined;
  /**
   * The caller's OCR choice, else the host's, decided on the first `ocr`
   * assert and memoized — one VisionOcr per Verifier, so its compiled binary
   * is reused across asserts. Building it costs nothing: the engine asks for
   * the toolchain on its first read, and that `swiftc --version` probe runs
   * once per process, shared by every Verifier's engine.
   */
  private ocr: OcrEngineChoice | undefined;
  /**
   * The hand-off of the last read (VerifierOptions.handOff, ADR 0030): every assert produces it, the element assert
   * alone takes it (see `assert`).
   */
  private readonly handOff: ReadHandOff;
  /** The device, as `handOff` watches it: what an action through it would invalidate is never handed on. */
  private readonly adapter: DeviceAdapter;
  /** VerifierOptions.persistentRead: whether a read no wait cures fails the assert or is thrown. */
  private readonly persistentRead: PersistentReadMode;

  constructor(adapter: DeviceAdapter, opts: VerifierOptions = {}) {
    this.persistentRead = opts.persistentRead ?? 'throw';
    ({ handOff: this.handOff, adapter: this.adapter } = ReadHandOff.watching(adapter, opts.handOff));
    this.baselineDir = opts.baselineDir ?? DEFAULT_BASELINE_DIR;
    this.pollMs = opts.pollMs ?? 300;
    this.timeoutMs = opts.timeoutMs;
    this.ocr = opts.ocr;
  }

  async assertAll(specs: AssertSpec[]): Promise<AssertResult[]> {
    const results: AssertResult[] = [];
    for (const spec of specs) results.push(await this.assert(spec));
    return results;
  }

  /**
   * One assert. Every assert is a PRODUCER of the hand-off (ADR 0030): its tree reads are a look at a screen nothing
   * touched, so the last of them may be handed to the next assert, or — in a flow — to the next tap's first sample.
   * Only the element assert (present, with or without text/match/error) TAKES one, and only as a positive verdict: a
   * pass on the handed tree passes; anything else reads fresh (pollTree's handed-round rule). The others never take:
   * an `absent` assert would turn an old tree's absence into a pass, a rect assert measures a position, and the color,
   * ocr and screenshot asserts locate pixels in a frame of their own.
   */
  async assert(spec: AssertSpec): Promise<AssertResult> {
    return this.handOff.producing(() => this.decided(this.plan(spec)));
  }

  /**
   * The one step every assert runs through (A20): run its plan — whichever poll it is — and map the verdict to the
   * AssertResult, applying VerifierOptions.persistentRead once. A PersistentReadError (D21 — a read no wait cures,
   * which every poll throws at once, after its one read) is the assert's failing result under `fail`, its message the
   * detail; under `throw`, and for any other error, it propagates as it came. Until A20 the tree poll caught it and
   * each pixel assert by a hand `.catch`: one forgotten would have rejected a whole verify leg (run/verify.ts),
   * losing its frame, screenshot and health line — what D21 round 2 set `fail` up to keep.
   */
  private async decided({ description, run }: PlannedAssert): Promise<AssertResult> {
    try {
      const { pass, detail } = await run();
      return { description, pass, detail };
    } catch (e) {
      if (this.persistentRead === 'fail' && e instanceof PersistentReadError) {
        return { description, pass: false, detail: e.message };
      }
      throw e;
    }
  }

  private plan(spec: AssertSpec): PlannedAssert {
    if ('screenshot' in spec) {
      return this.planScreenshot(spec.screenshot.baseline, spec.screenshot.threshold ?? 0.01);
    }
    const pixel = 'color' in spec || 'ocr' in spec;
    const timeoutMs =
      spec.timeout !== undefined ? parseDuration(spec.timeout)
      : (this.timeoutMs ?? (pixel ? PIXEL_ASSERT_TIMEOUT_MS : ASSERT_TIMEOUT_MS));
    if ('rect' in spec) return this.planRect(spec.element, spec.rect, timeoutMs);
    if ('color' in spec) return this.planColor(spec.element, spec.color, timeoutMs);
    if ('ocr' in spec) return this.planOcr(spec.element, spec.ocr, timeoutMs);
    if (spec.absent) return this.planAbsent(spec.element, timeoutMs);
    return this.planElement(spec.element, spec.text, spec.match, spec.error, timeoutMs);
  }

  private planElement(
    element: ElementSpec,
    text: string | undefined,
    match: string | undefined,
    error: string | undefined,
    timeoutMs: number,
  ): PlannedAssert {
    const wants =
      text !== undefined ? ` with text ${JSON.stringify(text)}`
      : match !== undefined ? ` matching /${match}/`
      : error !== undefined ? ` with error ${JSON.stringify(error)}`
      : '';
    const description = `element ${describeElementSpec(element)}${wants} exists`;
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
    const run = (): Promise<PollVerdict> =>
      this.treePoll(
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
          timeoutMs,
          missing: element,
          first: this.handOff,
          timeoutDetail: ({ detail, readError, lastTree }) => {
            if (readError !== undefined) return notFound(timeoutMs, { readError }, element);
            const base =
              detail !== undefined ?
                `element found but ${error !== undefined ? 'error' : 'content'} was: ${detail}`
              : notFound(timeoutMs, { lastTree }, element);
            const hint =
              exactText === undefined || hintScope === undefined ?
                undefined
              : textHint(hintScope, exactText);
            return hint === undefined ? base : `${base}\n  ${hint}`;
          },
        },
      );
    return { description, run };
  }

  /**
   * Geometry vs Figma-frame values, in % of screen width — the window width
   * `verify/scale.ts#windowWidth` judges for each round's tree, witnessed by
   * the device screen, the same answer the whole-screen comparator reads off
   * its frame. A width it refuses fails the round closed (a CONTENT width
   * passing with a remark would measure the wrong scale).
   * Polls like the other asserts: mid-animation geometry may legitimately be
   * off for a frame, so only the state at timeout is the verdict.
   */
  private planRect(element: ElementSpec, expected: RectExpectation, timeoutMs: number): PlannedAssert {
    const tolerance = expected.tolerancePct ?? DEFAULT_TOLERANCE_PCT;
    const description = `element ${describeElementSpec(element)} rect within ${tolerance}% of screen width (figma frame ${expected.frameWidth})`;
    // The witness, read once (memoized by the adapter), and re-read fresh at
    // most once for the whole assert, before a wider-than-screen refusal
    // (capture.ts#ScreenWitness). A failed read is not a failed assert: the
    // width is then the tree's alone, and windowWidth says so in the detail —
    // the degradation captureFrame applies to the table. So no read of the
    // witness ever reaches `decided`: witnessScreen and `judge`'s re-read
    // swallow every error, a PersistentReadError included — only the tree
    // poll's reads meet the persistentRead policy here.
    const run = async (): Promise<PollVerdict> => {
      const witness = await ScreenWitness.read(this.adapter);
      return this.treePoll(
        async (tree) => {
          // First occurrence wins — the same duplicate-id rule as rect-parity.
          const found = findBySpec(tree, element);
          return found.length === 0 ? undefined : evaluateRectAssert(found[0].rect, expected, await witness.judge(tree));
        },
        {
          timeoutMs,
          missing: element,
          timeoutDetail: ({ detail, ...last }) => detail ?? notFound(timeoutMs, last, element),
        },
      );
    };
    return { description, run };
  }

  /**
   * Rendered text vs what the screen actually shows (text-parity.ts). Needs
   * BOTH the tree (the element's rect) and a screenshot (pixels), scaled
   * together. The round — find, capture against that tree, wait for the png
   * to settle, decode, and only then measure — is the pixel poll's
   * (verify/pixel-poll.ts); the measurement — crop the rect, recognize,
   * compare, and every fail-closed sentence on the way — is
   * text-parity.ts#measureOcrAssert's, as the colour
   * assert's is evaluateColorAssert's. What is here is the description and
   * the engine. The recognizer is closed over, so the poll never learns OCR
   * exists.
   *
   * Unavailable OCR fails the assert with the reason rather than skipping it:
   * a check the caller asked for and did not get must never read as a pass.
   */
  private planOcr(element: ElementSpec, expectation: OcrExpectation, timeoutMs: number): PlannedAssert {
    const wants = [
      expectation.text !== undefined ? `text ${JSON.stringify(expectation.text)}` : undefined,
      expectation.match !== undefined ? `matching /${expectation.match}/` : undefined,
      expectation.heightPct !== undefined ? `ink height ${expectation.heightPct}% of width` : undefined,
    ].filter((v): v is string => v !== undefined);
    const description = `element ${describeElementSpec(element)} renders ${wants.join(' and ')}`;
    const run = async (): Promise<PollVerdict> => {
      const { engine, unavailable } = (this.ocr ??= ocrEngineFor());
      if (unavailable !== undefined) return { pass: false, detail: failClosed(unavailable, 'rendered text') };
      // The rect is the FIRST match's (the pixel poll's rule, the same as
      // rect-parity's). The whole-screen text table deliberately does the
      // opposite; here the caller named ONE element and gets that element's rect.
      return pollPixels(this.adapter, {
        element,
        timeoutMs,
        pollMs: this.pollMs,
        unchecked: 'rendered text',
        glyphs: true,
        measure: (input) => measureOcrAssert(engine, input, expectation),
      });
    };
    return { description, run };
  }

  /**
   * Fill color vs an expected hex (color-parity.ts). Needs BOTH the tree
   * (the element's rect) and a screenshot (pixels), scaled together — the
   * same captured frame the `ocr` assert measures against. The measurement
   * is one sample of that rect; the round around it is the pixel poll's
   * (verify/pixel-poll.ts), which hands it only a SETTLED, decoded frame.
   * A frame that did not settle is a miss, never a sample — measuring the
   * last of six differing captures would call a number a verdict.
   */
  private planColor(element: ElementSpec, expectation: ColorExpectation, timeoutMs: number): PlannedAssert {
    const tol = expectation.deltaE ?? DEFAULT_TOLERANCE_DE;
    const expectedHex = normalizeHex(expectation.expected);
    const description =
      `element ${describeElementSpec(element)} fill within dE00 ${tol} of ${expectedHex}` +
      (expectation.theme !== undefined ? ` (${expectation.theme} theme)` : '');
    const run = (): Promise<PollVerdict> =>
      pollPixels(this.adapter, {
        element,
        timeoutMs,
        pollMs: this.pollMs,
        unchecked: 'color',
        reads: colorSampleRect,
        measure: ({ rect, measured }) => evaluateColorAssert(rect, expectation, measured),
      });
    return { description, run };
  }

  /**
   * The shape the tree-only asserts share (ARCHITECTURE.md §8, "waits, not
   * sleeps"): read the tree, evaluate it, stop on a pass, otherwise remember
   * what it said and retry until the deadline. The color and ocr asserts
   * poll through `pollPixels` (verify/pixel-poll.ts), on the same loop and
   * the same verdict translation (verify/poll-verdict.ts).
   *
   * The loop itself is `pollTree` (ui-tree/read-tree.ts), written once
   * rather than copied per assert. What stays here
   * is the verifier's vocabulary: an evaluator's verdict in, the poll's PollVerdict out, and
   * the per-assert timeout wording. A read no wait cures propagates from here
   * as from the pixel poll: `decided` alone applies the policy (A20).
   *
   * `pollMs` is the cadence of the rounds (reads start at least pollMs
   * apart: pollTree sleeps what the read left of it) and NOTHING else: forwarded to
   * the capture as its stability delay too, it made an assert inside a flow
   * (engine pollMs 500) wait 500 ms between stability captures and the same
   * assert from the MCP tool 300 — the budget capture.ts documents as one.
   * The round's deadline is handed to the capture instead (by the pixel
   * poll), so a capture stops short of it. Measured with a fake-device
   * harness, before that change and after (screencap
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
  private async treePoll(
    evaluate: (tree: UiNode) => PollVerdict | typeof Undecided | undefined | Promise<PollVerdict | typeof Undecided | undefined>,
    spec: PollSpec,
  ): Promise<PollVerdict> {
    const outcome = await pollTree(this.adapter, async (tree) => {
      const verdict = await evaluate(tree);
      return verdict === Undecided ? Undecided : verdictToPoll(verdict);
    }, {
      timeoutMs: spec.timeoutMs,
      pollMs: this.pollMs,
      ...(spec.first !== undefined && { first: spec.first }),
    });
    if (!outcome.timedOut) return { pass: true, detail: outcome.value.detail };
    // The window manager's word on the last tree's window, asked now the poll has given up on a target it never found
    // (ui-tree/window-mark.ts): a detail is the finding, and no not-found is worded beside it.
    const lastTree = await markedForMiss(this.adapter, outcome, outcome.detail === undefined ? spec.missing : undefined);
    return {
      pass: false,
      detail: spec.timeoutDetail({ detail: outcome.detail, readError: outcome.readError, undecidedTree: outcome.undecidedTree, lastTree }),
    };
  }

  /**
   * absent = gone from the tree OR present with a rect outside the visible
   * viewport. The raw trees disagree (Android prunes off-screen nodes, iOS
   * keeps them with off-viewport rects); this is the one portable meaning.
   *
   * And not on a BARE tree (ui-tree/verdict.ts): nothing in a cold launch's
   * Android decor or WDA's splash matches any selector, so without that
   * rule this assert PASSED there before the app had drawn a pixel.
   * The leaf rule is the flow engine's too (flow/condition.ts asks the same
   * `absenceVerdict`), so an absent detect, wait, branch and assert cannot
   * disagree about one tree. An `unknown` round keeps polling like a visible
   * one; a timeout whose last tree was bare fails as "could not verify",
   * the wording an unreadable tree already had — both are "we could not
   * tell", never "still visible".
   */
  private planAbsent(element: ElementSpec, timeoutMs: number): PlannedAssert {
    const description = `element ${describeElementSpec(element)} is absent`;
    const run = async (): Promise<PollVerdict> => {
      // Read before polling: a viewport that cannot be read is an error, not a
      // failed assert — absence is meaningless without a reference frame. A
      // PersistentReadError from it meets the policy in `decided`, as any read's does.
      // (Memoized by the adapter — adapters/types.ts — so this is one device
      // read per adapter, not per assert.)
      const viewport = await this.adapter.viewport();
      return this.treePoll(
        (tree) => {
          const found = findBySpec(tree, element);
          return pollOnVerdict(absenceVerdict(found, viewport, tree), {
            pass: true,
            detail:
              found.length > 0 ? `${found.length} node(s) in tree but none intersect the viewport` : undefined,
          });
        },
        {
          timeoutMs,
          // An unreadable tree is NOT evidence of absence — it is why we could
          // not tell, so it outranks "still visible"; and the last read failing
          // is the fresher fact than the bare tree before it.
          timeoutDetail: ({ readError, undecidedTree }) =>
            readError !== undefined ? `could not verify within ${formatSeconds(timeoutMs)} (last UI tree read failed: ${readError.message})`
            : undecidedTree !== undefined ? `could not verify within ${formatSeconds(timeoutMs)} (${bareTimeoutNote(undecidedTree)})`
            : `still visible after ${formatSeconds(timeoutMs)}`,
        },
      );
    };
    return { description, run };
  }

  private planScreenshot(name: string, threshold: number): PlannedAssert {
    return {
      description: `screenshot matches baseline "${name}" (threshold ${threshold * 100}%)`,
      run: () => this.screenshotVerdict(name, threshold),
    };
  }

  /**
   * The screenshot assert's run: it reads no tree, and a capture the adapter refuses fails it closed — so nothing it
   * does meets the persistentRead policy, though it runs through `decided` like every assert.
   */
  private async screenshotVerdict(name: string, threshold: number): Promise<PollVerdict> {
    const path = join(this.baselineDir, this.adapter.platform, `${name}.png`);
    // The SETTLED frame (verify/capture.ts, png-only arm, the one stability
    // budget). A bare screenshot here would let a baseline diff compare two
    // mid-animation frames — the flakiest assert by construction. It costs
    // the stability budget where a bare one costs one capture (captures,
    // wait and failure chances: capture.ts, STABILITY_*). The capture SAYS
    // whether it settled. CREATION fails closed on a frame seen moving —
    // otherwise a screen that never settled (spinner, caret, live content)
    // would silently store its last frame as the ground truth for every
    // later run. A DIFF against an existing baseline still compares the last frame
    // and keeps its verdict, with the `⚠ frame:` note on the detail: a
    // blinking caret or a clock inside the 1.5 s budget passes the diff
    // under threshold, and the threshold exists for exactly that — a refusal
    // there (tried, and withdrawn) would tighten a passing assert.
    // Re-baseline any screenshot assert that was flaky under a bare read.
    //
    // The baseline file is read BEFORE the capture, because the two paths
    // capture differently. CREATION takes
    // `captureBaselineFrame`: the same settled pair, then a confirmation
    // window of four more captures that must all match it, since a pair
    // ≈0.95 s apart (Android emulator; ≈0.8 s iOS simulator) lands in phase
    // with a ≈1 s caret blink and compared equal — a baseline was created
    // on device from a caret screen, holding one phase of the blink (the
    // schedule, its simulation and its cost are on capture.ts's
    // BASELINE_CONFIRMATION_DELAYS_MS).
    // A refusal there gets its own sentence, because two captures DID match. A DIFF takes plain
    // `captureFrame` exactly as before — same captures, same sleeps, same
    // `⚠ frame:` note — so only the once-per-baseline path pays the window.
    // docs/bugs/2026-10-06-whole-screen-stability-aliases-a-blinking-caret.md
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
      // goes on — pixel-poll.ts's header has the rule.
      let candidate: BaselineFrame;
      try {
        candidate = await captureBaselineFrame(this.adapter);
      } catch (e) {
        return { pass: false, detail: screenshotFailed(captureRefusal(e), 'baseline match') };
      }
      // Fail closed: ONLY a confirmed window creates.
      // The first cut refused on `confirmed === false`, so a frame without
      // the field — `unjudged`, which a deadline on this path would produce —
      // would have been stored unexamined. Each refusal is worded for what
      // was actually seen.
      if (candidate.confirmed !== true) {
        return { pass: false, detail: `baseline not created: ${baselineRefusal(candidate)}` };
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, await candidate.shot.png());
      return { pass: true, detail: `baseline created at ${path}` };
    }
    let frame: Frame;
    try {
      frame = await captureFrame(this.adapter);
    } catch (e) {
      return { pass: false, detail: screenshotFailed(captureRefusal(e), 'baseline match') };
    }
    const note = unsettledNote(frame);
    const withNote = (detail: string): string => (note === undefined ? detail : `${detail}\n${note}`);

    const a = decodePng(baseline);
    const b = frame.shot.decode();
    if (a.width !== b.width || a.height !== b.height) {
      return {
        pass: false,
        detail: withNote(`size mismatch: baseline ${a.width}x${a.height}, current ${b.width}x${b.height}`),
      };
    }
    // D26b: iOS leaves its status band out of both images (iosBandRows); every other row is compared as before.
    const band = this.adapter.platform === 'ios' ? await iosBandRows(this.adapter, a.width, a.height) : 0;
    const from = band * a.width * 4;
    const rows = a.height - band;
    const diffPixels = pixelmatch(a.data.subarray(from), b.data.subarray(from), undefined, a.width, rows, { threshold: 0.1 });
    const ratio = diffPixels / (a.width * rows);
    const pct = (ratio * 100).toFixed(2);
    return {
      pass: ratio <= threshold,
      detail: withNote(`${pct}% of pixels differ${band > 0 ? ` (status band excluded: the top ${band} px rows)` : ''}`),
    };
  }
}

/**
 * The png rows of the iOS status band a baseline diff leaves out of both images (D26b), or 0: compare every row.
 *
 * Why: an iOS adapter captures through `idb screenshot` (adapters/ios.ts#screenshotVia), which draws the Dynamic Island
 * (a black pill, 378×112 px at the top centre of the lab simulator's 1206×2622 frame) where `simctl io screenshot` —
 * every baseline stored before D26b (on a wda project, before D44), and every capture under AVERI_IOS_SCREENSHOT=simctl
 * — shows the app's background; nothing else differs but 16 corner pixels (backlog "### D26 diag"). Measured, that is
 * 1.219 % of the frame, over the 1 % default threshold: a stored baseline would fail on the island alone. The band is
 * the top of the screen down to the safe area (adapters/ios-status-band.ts, 62 pt there: 186 px rows at scale 3), the
 * status bar's and the island's, never the app's to assert on — the same band a tap counts as off the screen.
 *
 * This LOOSENS the check, so it is held to exactly that: iOS only (Android's captures have one source), the band's
 * rows only — `ceil(statusBand × scale)`, the scale the png's width over the viewport's. A png that is not the viewport
 * at one scale (both axes within 2 %) is compared whole (defensive; whether a rotated simulator's capture is ever
 * landscape is unmeasured). A viewport that cannot be read is compared whole too, as before D26b — the diff never fails on it.
 */
async function iosBandRows(adapter: DeviceAdapter, width: number, height: number): Promise<number> {
  let viewport;
  try {
    viewport = await adapter.viewport();
  } catch {
    return 0;
  }
  const { statusBand } = viewport;
  if (statusBand === undefined || !(statusBand > 0) || !(viewport.width > 0) || !(viewport.height > 0)) return 0;
  const scale = width / viewport.width;
  if (Math.abs(height / viewport.height - scale) > 0.02 * scale) return 0;
  const rows = Math.ceil(statusBand * scale);
  return rows < height ? rows : 0;
}

/**
 * Why a baseline candidate was not stored, in the words of what the capture
 * saw. `moving` keeps the capture's own sentence verbatim; a pair
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

