import type { DeviceAdapter, Platform, UiNode } from '../adapters/types.js';
import type { AveriConfig } from '../flow/config.js';
import { formatTrace, FlowEngine, type TraceEntry } from '../flow/engine.js';
import { scanForCrashes, Verifier, type AssertResult, type AssertSpec } from '../verify/assert.js';
import { errorMessage } from '../util/error-message.js';
import { captureFrame, type Frame, type MeasuredFrame, type Undecoded } from '../verify/capture.js';
import {
  compareColorParity,
  contractHasColorAnchors,
  formatColorParity,
  validateColorContract,
  type ColorParityOptions,
} from '../verify/color-parity.js';
import type { LayoutContract } from '../verify/layout-contract.js';
import { ocrUnavailableReason, VisionOcr, type OcrEngine, type OcrRegionResult } from '../verify/ocr.js';
import {
  compareRectParity,
  formatRectParity,
  validateRectContract,
  type RectParityOptions,
} from '../verify/rect-parity.js';
import {
  compareTextParity,
  contractHasTextAnchors,
  formatTextParity,
  ocrRegionsFor,
  validateTextContract,
  type TextCapture,
  type TextParityOptions,
} from '../verify/text-parity.js';

/**
 * The `verify` tool's orchestration: run the same sequence on each requested
 * platform, then compare the legs.
 *
 * It lives in its own layer above flow/ and verify/ because it COMPOSES both —
 * a FlowEngine to get the app where it needs to be, a Verifier to check it —
 * and neither engine may depend on the other. It used to live inline in
 * mcp/server.ts, where a module-scope `server.connect(transport)` made it
 * impossible to import, so the most intricate error containment in the tool
 * was also the only code with no tests.
 */

export interface VerificationRequest {
  /** Already normalized: deduped, canonical android-then-ios order. */
  platforms: Platform[];
  cfg: AveriConfig;
  specs: AssertSpec[];
  state?: string;
  flow?: string;
  /**
   * Parsed up front by the caller: a typo'd path must not cost a device run.
   * Its field VALUES are checked here, before the legs (contractProblems).
   */
  contract?: LayoutContract;
  /**
   * What the user called the contract — the path they passed. Only quoted: a
   * refusal that names the file is the one the author can act on, the way
   * parseLayoutContract's own errors already do.
   */
  contractSource?: string;
  environment?: string;
  baselineDir: string;
  /** Test seam: the OCR recognizer behind the text-parity table. */
  ocrEngine?: OcrEngine;
}

export interface VerificationOutput {
  /** Markdown sections, in order; the caller joins them with a blank line. */
  sections: string[];
  /** One PNG per leg that got far enough to produce one, in platform order. */
  screenshots: Buffer[];
}

/** What one platform's leg produced. */
interface VerificationLeg {
  trace: TraceEntry[];
  results: AssertResult[];
  /**
   * The settled frame the leg ended on — the png returned to the caller and,
   * with a contract, the tree and the one scale the parity tables measure
   * against. Absent parts carry their reason (verify/capture.ts).
   */
  frame: Frame;
  health: string;
}

/**
 * appAlive check (ARCHITECTURE.md §8): is the app-under-test still running?
 * When it died, include a crash excerpt from recent logs so flows fail fast
 * with the reason, not just a blank screen.
 */
export async function appHealth(adapter: DeviceAdapter, cfg: AveriConfig): Promise<string> {
  const app = cfg.app[adapter.platform];
  if (!app) return '';
  const appId = 'package' in app ? app.package : app.bundleId;
  let running: boolean;
  try {
    running = await adapter.isAppRunning(appId);
  } catch (e) {
    // The question could not be ASKED — a device under load or unreachable is
    // not a dead app, and saying `false` here sends the caller after a crash
    // that never happened (measured 2026-09-17, finportal b4).
    const why = errorMessage(e).split('\n')[0];
    const check = adapter.platform === 'android'
      ? 'check `adb devices` and host load'
      : 'check `xcrun simctl list devices booted` and host load (reboot the simulator if it does not answer)';
    return (
      `\nappAlive: unknown — could not ask the device whether ${appId} runs (${why}); ` +
      `the device is unreachable or under load. NOT evidence that the app died — ${check}, then retry.`
    );
  }
  if (running) return '\nappAlive: true';
  const lines = await adapter.logs(Date.now() - 60_000).catch(() => [] as string[]);
  const crashes = scanForCrashes(lines, adapter.platform).slice(0, 24);
  return (
    `\nappAlive: false — ${appId} is not running!` +
    (crashes.length > 0 ? `\nCrash excerpt:\n${crashes.join('\n')}` : '\n(no crash signature in the last 60s of logs)')
  );
}

// Re-exported, not defined: a failing flow now renders its own trace into the
// error message, so the formatter moved to the engine (flow/engine.ts) to stay
// importable from there. This name is the one the MCP layer and the tests use.
export { formatTrace };

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

/**
 * Device-log excerpt: filter to a regex, keep the tail, and say what that did.
 * Pure — it takes the lines rather than the device — because the COUNTING is
 * the part that misleads when it is wrong: a grep that silently matched
 * nothing reads exactly like a quiet device, and a truncated pull that does
 * not admit it reads like the whole story. Worth a test; untestable inside a
 * tool handler.
 */
export function formatLogExcerpt(all: string[], grep: string | undefined, maxLines = 2000): string {
  const lines = grep === undefined ? all : all.filter((l) => new RegExp(grep, 'i').test(l));
  const tail = lines.slice(-maxLines);
  const header: string[] = [];
  if (grep !== undefined) header.push(`[grep /${grep}/i matched ${lines.length} of ${all.length} lines]`);
  if (lines.length > tail.length) {
    header.push(`[truncated: showing last ${maxLines} of ${lines.length} lines]`);
  }
  return [...header, ...tail].join('\n');
}

/**
 * The parity dimensions a contract can add to a run: the table's title, the
 * predicate deciding whether THIS contract produces it, the options its
 * comparator runs under, and the comparator's own validator for the fields it
 * will read.
 *
 * One owner for "is this table produced", on purpose: the same `produced` is
 * asked twice per run — before the legs, to decide whose fields are validated,
 * and after them, to decide which sections are appended. Two copies of the
 * predicate could drift into the one bug this must not have: refusing a run
 * over a field no table would ever have read (the geometry-only caller of
 * layout-contract.ts's header), or running one whose table can only fail.
 *
 * One owner for the OPTIONS for the same reason (review 2026-10-03): the
 * validator answers "what would the comparator raise" only if both are asked
 * under the same options — the colour theme picks the contract key that is
 * read. `options` is the ONE object handed to both `validate` (dimensionProblems)
 * and the compare call below; a dark-mode round that set the theme for the
 * comparator alone would let a bad `bg_dark` through validation and fail it
 * after the legs, which is the cost this whole check exists to remove.
 *
 * The table holds FACTS only — title, produced, options, validate. Comparing
 * and formatting stay hand-written per dimension below, on purpose: the three
 * collect different artifacts and degrade differently, and the 2026-08-14
 * review's decision stands — no generic reporting framework.
 */
interface ParityDimension<Options> {
  title: string;
  produced: (contract: LayoutContract) => boolean;
  options: Options;
  validate: (contract: LayoutContract, options: Options) => string[];
}

const DIMENSIONS: {
  rect: ParityDimension<RectParityOptions>;
  color: ParityDimension<ColorParityOptions>;
  text: ParityDimension<TextParityOptions>;
} = {
  // Geometry is what a contract IS: the rect table exists whenever one does.
  rect: {
    title: 'rect parity',
    produced: () => true,
    options: {},
    validate: validateRectContract,
  },
  // Opt-in: any anchor carrying bg / bg_dark / sample.
  //
  // Theme is always 'light' — deliberate: verify exposes no theme input
  // because averi cannot switch device themes, and sampling a light capture
  // against bg_dark hexes would fake dark evidence. The comparator's theme
  // option (and its tests) is the plumbing for the deferred dark-mode round.
  color: {
    title: 'color parity',
    produced: contractHasColorAnchors,
    options: { theme: 'light' },
    validate: validateColorContract,
  },
  // Opt-in: any anchor carrying text / text_dynamic.
  text: {
    title: 'text parity',
    produced: contractHasTextAnchors,
    options: {},
    validate: validateTextContract,
  },
};

/** One dimension's problems — none when this contract does not produce its table. */
const dimensionProblems = <Options>(d: ParityDimension<Options>, contract: LayoutContract): string[] =>
  d.produced(contract) ? d.validate(contract, d.options) : [];

/**
 * Every problem the run's own tables would raise about the contract's field
 * values, one line each, named by dimension — empty when there is none.
 *
 * Why it exists (2026-10-03): the schema leaves bg / bg_dark / sample / text /
 * text_dynamic and three tolerances `unknown` so the comparator that knows a
 * field words its diagnosis. Until now that diagnosis was only reachable at
 * READ time — after both legs — so `bg: "#white"` or `tolerance_de: "6"` cost
 * minutes of device work to surface as a `FAILED:` section. The contract is in
 * hand before any leg starts; so is the answer.
 *
 * A dimension is asked only if this contract would produce its table, so a
 * contract with no colour anchors is never refused over `tolerance_de`.
 *
 * Each validator is handed its dimension's `options` — the same object the
 * table below hands the comparator — so what is refused here is what would
 * have failed there.
 *
 * The lines are the comparators' messages UNTOUCHED: each already opens with
 * its dimension's title, which is what names the dimension per line (pinned
 * in tests/run/verify.test.ts). Nothing is prefixed here, so a refusal line
 * and the read-time `FAILED:` text for the same field cannot differ.
 *
 * Rejected alternatives: typing the fields in the schema (a generic zod
 * message, and it rejects for callers that never read the field — see the
 * layout-contract.ts header); validating in the MCP handler (orchestration
 * owns "before the legs", and the handler stays a delegation); and dropping
 * the read-time checks now that this runs first (they remain the comparators'
 * own guard for every caller that is not this run, and paritySection's
 * containment is unchanged).
 */
export function contractProblems(contract: LayoutContract): string[] {
  return [
    ...dimensionProblems(DIMENSIONS.rect, contract),
    ...dimensionProblems(DIMENSIONS.color, contract),
    ...dimensionProblems(DIMENSIONS.text, contract),
  ];
}

/**
 * The refusal for an invalid contract: ALL problems in one message, so the
 * contract is fixed in one edit rather than one device run per typo, and the
 * one thing the caller most needs to know about what it cost — nothing. It
 * names the file when the caller said which one, as parseLayoutContract's
 * errors do: "the layout contract" is no help to someone holding several.
 */
const contractRefusal = (problems: string[], source?: string): string =>
  `verify: the layout contract${source === undefined ? '' : ` ${source}`} has ` +
  `${problems.length} invalid field${problems.length === 1 ? '' : 's'} ` +
  'in the tables this run would produce — refused before the run:\n' +
  problems.map((problem) => `- ${problem}`).join('\n') +
  '\nFix the contract and re-run; nothing was run on a device.';

export async function runVerification(
  req: VerificationRequest,
  resolveAdapter: (platform: Platform) => Promise<DeviceAdapter>,
): Promise<VerificationOutput> {
  const { platforms, cfg, specs, contract } = req;

  // Before any leg starts and before any adapter is resolved: a contract the
  // tables can only answer with FAILED must not cost the device run first.
  // It THROWS — unlike everything after the legs, which is contained — because
  // there is nothing yet to throw away.
  if (contract !== undefined) {
    const problems = contractProblems(contract);
    if (problems.length > 0) throw new Error(contractRefusal(problems, req.contractSource));
  }

  const runOne = async (p: Platform): Promise<VerificationLeg> => {
    const adapter = await resolveAdapter(p);
    const engine = new FlowEngine(cfg, adapter, { environment: req.environment });
    const trace: TraceEntry[] = [];
    if (req.state) trace.push(...(await engine.ensureState(req.state)));
    if (req.flow) trace.push(...(await engine.runFlow(req.flow)));
    const results = await new Verifier(adapter, { baselineDir: req.baselineDir }).assertAll(specs);
    // The frame the leg ended on, captured SETTLED — until 2026-10-02 this was
    // a bare screenshot, so the color and text tables could be fed the one
    // frame the color assert's own doc rules out: a mid-animation one. With a
    // contract the tree is read beside it (bounded retry, the transient "null
    // root node" the polling asserts absorb) and the png scale derived once;
    // a failed tree read or device-screen read must NOT reject the leg — that
    // would discard the trace, assert results and screenshot of a minutes-long
    // device run over an optional extra read — so both land on the frame as
    // reasons the tables quote.
    const frame = await captureFrame(adapter, { readTree: contract !== undefined });
    const health = await appHealth(adapter, cfg);
    return { trace, results, frame, health };
  };

  const runs = await Promise.allSettled(platforms.map(runOne));

  const sections: string[] = [];
  const screenshots: Buffer[] = [];
  platforms.forEach((p, i) => {
    const run = runs[i];
    if (run.status === 'rejected') {
      sections.push(`## ${p}\nFAILED: ${errorMessage(run.reason)}`);
      return;
    }
    const { trace, results, frame, health } = run.value;
    const verdict = specs.length === 0 ? '' : `\n${assertSummary(results)}`;
    sections.push(`## ${p}\n${formatTrace(trace)}${verdict}\n${formatAsserts(results)}${health}`);
    screenshots.push(frame.shot);
  });

  if (contract !== undefined) {
    if (DIMENSIONS.rect.produced(contract)) {
      sections.push(
        paritySection(DIMENSIONS.rect.title, platforms, runs, treeOf, 'SKIPPED: no leg produced a UI tree.', (trees) =>
          formatRectParity(compareRectParity(contract, trees, DIMENSIONS.rect.options)),
        ),
      );
    }

    // Color parity, only when the contract opts in (any anchor carrying
    // bg / bg_dark / sample). Reuses each leg's frame — the exact pixels
    // already returned to the caller, the tree read beside them and the
    // scale derived once — never a second capture that could race a UI change.
    // The theme is the dimension's (DIMENSIONS.color.options), shared with the
    // validation that ran before the legs.
    if (DIMENSIONS.color.produced(contract)) {
      sections.push(
        paritySection(
          DIMENSIONS.color.title,
          platforms,
          runs,
          measuredOf,
          'SKIPPED: no leg produced both a UI tree and a decodable screenshot.',
          (captures) => formatColorParity(compareColorParity(contract, captures, DIMENSIONS.color.options)),
        ),
      );
    }

    // Text parity, only when the contract opts in (any anchor carrying
    // text / text_dynamic). Runs the recognizer FIRST, on the bytes each leg
    // already returned, then compares — OCR touches no device, so it costs no
    // extra capture and cannot race a UI change.
    //
    // OCR is macOS-only and needs a Swift toolchain. When it cannot run, the
    // comparison falls back to the accessibility tree and SAYS SO: on iOS the
    // tree carries authored a11y summaries rather than rendered copy, so a
    // silent fallback would quietly weaken the check it claims to perform.
    if (DIMENSIONS.text.produced(contract)) {
      const { ocrByPlatform, notes: ocrNotes } = await runOcr(
        contract,
        platforms,
        runs,
        req.ocrEngine,
      );
      sections.push(
        paritySection(
          DIMENSIONS.text.title,
          platforms,
          runs,
          (leg, p): Contribution<TextCapture> => {
            const tree = treeOf(leg, p);
            if ('note' in tree) return tree;
            const got = ocrByPlatform.get(p);
            return { value: { tree: tree.value, ocr: got?.ocr, pngWidth: got?.pngWidth } };
          },
          'SKIPPED: no leg produced a UI tree.',
          (captures) => formatTextParity(compareTextParity(contract, captures, DIMENSIONS.text.options)),
          ocrNotes,
        ),
      );
    }
  }

  return { sections, screenshots };
}

/** Either the artifact this leg contributes, or why it cannot contribute one. */
type Contribution<T> = { value: T } | { note: string };

/**
 * Every parity dimension opens the same way — no tree, no contribution — and
 * all three said so in the same words. One owner, because the words are the
 * point: a dimension that dropped a leg SILENTLY would print a one-platform
 * table that looks like a completed comparison.
 */
const noTreeNote = (p: Platform, reason: string): string =>
  `(${p}: UI tree read failed — ${reason} — compared without it)`;

/**
 * The leg's frame when it carries a tree — where every table starts, and the
 * ONE place the no-tree note is decided. A leg is only asked for a frame
 * with a tree when there is a contract, and the tables only exist then; the
 * fallback wording covers the shape the types cannot rule out.
 */
const withTree = (leg: VerificationLeg, p: Platform): Contribution<MeasuredFrame | Undecoded> => {
  const m = leg.frame.measured;
  if (m?.tree !== undefined) return { value: m };
  return { note: noTreeNote(p, m?.error ?? 'no UI tree was read for this leg') };
};

const treeOf = (leg: VerificationLeg, p: Platform): Contribution<UiNode> => {
  const got = withTree(leg, p);
  return 'note' in got ? got : { value: got.value.tree };
};

/**
 * The frame's measured half, or why there is none — the frame's own one
 * sentence, which names the tree read when that is what failed and the png
 * decode when the tree is here and the pixels are not.
 */
const measuredOf = (leg: VerificationLeg, p: Platform): Contribution<MeasuredFrame> => {
  const got = withTree(leg, p);
  if ('note' in got) return got;
  const m = got.value;
  return m.error === undefined ? { value: m } : { note: `(${p}: ${m.error} — compared without it)` };
};

/** What one platform's OCR pass produced, plus the reasons any of it is absent. */
interface OcrPass {
  ocrByPlatform: Map<Platform, { ocr: Map<string, OcrRegionResult>; pngWidth: number }>;
  notes: string[];
}

/**
 * Recognize the contract's text anchors on each leg's own screenshot bytes.
 *
 * Every failure here degrades to a NOTE rather than an exception: an
 * unavailable toolchain, an undecodable png or a recognizer crash must leave
 * the text table standing on tree evidence, clearly labelled as such, instead
 * of taking down a device run that took minutes.
 */
async function runOcr(
  contract: LayoutContract,
  platforms: Platform[],
  runs: PromiseSettledResult<VerificationLeg>[],
  engineOverride: OcrEngine | undefined,
): Promise<OcrPass> {
  const ocrByPlatform: OcrPass['ocrByPlatform'] = new Map();
  const notes: string[] = [];
  const unavailable = engineOverride === undefined ? ocrUnavailableReason() : undefined;
  if (unavailable !== undefined) {
    notes.push(
      `(OCR unavailable — ${unavailable}. Compared from the accessibility tree only, which on iOS ` +
        'reads authored a11y labels rather than rendered copy.)',
    );
    return { ocrByPlatform, notes };
  }
  const engine = engineOverride ?? new VisionOcr();
  await Promise.all(
    platforms.map(async (p, i) => {
      const run = runs[i];
      if (run.status === 'rejected') return;
      const { frame } = run.value;
      // No tree: the text table says so itself (treeOf's note). A tree without
      // pixels: that is an OCR failure in this table's terms, worded here.
      const got = withTree(run.value, p);
      if ('note' in got) return;
      const m = got.value;
      if (m.error !== undefined) {
        notes.push(`(${p}: OCR failed — ${m.error} — that platform compared from the tree.)`);
        return;
      }
      try {
        const { regions, note } = ocrRegionsFor(contract, m);
        // Nothing scaled, nothing to caveat.
        if (regions.length === 0) return;
        const results = await engine.recognize(frame.shot, regions);
        ocrByPlatform.set(p, {
          ocr: new Map(results.map((r) => [r.id, r])),
          pngWidth: m.png.width,
        });
        // After the recognizer, so a leg that ends up compared from the tree
        // carries THAT reason alone rather than a caveat about regions it
        // never used.
        if (note !== undefined) notes.push(`(${p}: ${note})`);
      } catch (e) {
        notes.push(
          `(${p}: OCR failed — ${errorMessage(e)} — that platform compared from the tree.)`,
        );
      }
    }),
  );
  return { ocrByPlatform, notes };
}

/**
 * Every parity table has the same shape: collect one artifact per leg, note
 * the legs that cannot contribute, skip when none can, and CONTAIN any
 * comparator error. That containment is the point — a contract that cannot be
 * normalized must not reject the tool call and throw away the traces, assert
 * results and screenshots of a device run that took minutes.
 */
function paritySection<T>(
  title: string,
  platforms: Platform[],
  runs: PromiseSettledResult<VerificationLeg>[],
  collect: (leg: VerificationLeg, platform: Platform) => Contribution<T>,
  emptyMessage: string,
  format: (collected: Partial<Record<Platform, T>>) => string,
  /** Notes gathered before collection — e.g. why OCR could not run. */
  extraNotes: string[] = [],
): string {
  const collected: Partial<Record<Platform, T>> = {};
  const notes: string[] = [...extraNotes];
  platforms.forEach((p, i) => {
    const run = runs[i];
    if (run.status === 'rejected') {
      notes.push(`(${p} leg failed — compared without it)`);
      return;
    }
    const contribution = collect(run.value, p);
    if ('note' in contribution) notes.push(contribution.note);
    else collected[p] = contribution.value;
  });
  const note = notes.length > 0 ? notes.join('\n') + '\n' : '';
  if (Object.keys(collected).length === 0) return `## ${title}\n${note}${emptyMessage}`;
  let body: string;
  try {
    body = format(collected);
  } catch (e) {
    body = `FAILED: ${errorMessage(e)}`;
  }
  return `## ${title}\n${note}${body}`;
}
