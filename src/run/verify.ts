import { PNG } from 'pngjs';
import type { DeviceAdapter, Platform, UiNode } from '../adapters/types.js';
import type { AveriConfig } from '../flow/config.js';
import { FlowEngine, type TraceEntry } from '../flow/engine.js';
import {
  readTreeWithRetry,
  scanForCrashes,
  Verifier,
  type AssertResult,
  type AssertSpec,
} from '../verify/assert.js';
import {
  compareColorParity,
  contractHasColorAnchors,
  formatColorParity,
  type ColorCapture,
} from '../verify/color-parity.js';
import type { LayoutContract } from '../verify/layout-contract.js';
import { ocrUnavailableReason, VisionOcr, type OcrEngine, type OcrRegionResult } from '../verify/ocr.js';
import { compareRectParity, formatRectParity } from '../verify/rect-parity.js';
import {
  compareTextParity,
  contractHasTextAnchors,
  formatTextParity,
  ocrRegionsFor,
  type TextCapture,
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
  /** Parsed up front by the caller: a typo'd path must not cost a device run. */
  contract?: LayoutContract;
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

/** What one platform's leg produced. Absent fields mean that part failed. */
interface VerificationLeg {
  trace: TraceEntry[];
  results: AssertResult[];
  shot: Buffer;
  health: string;
  tree?: UiNode;
  treeError?: string;
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
  if (await adapter.isAppRunning(appId)) return '\nappAlive: true';
  const lines = await adapter.logs(Date.now() - 60_000).catch(() => [] as string[]);
  const crashes = scanForCrashes(lines, adapter.platform).slice(0, 24);
  return (
    `\nappAlive: false — ${appId} is not running!` +
    (crashes.length > 0 ? `\nCrash excerpt:\n${crashes.join('\n')}` : '\n(no crash signature in the last 60s of logs)')
  );
}

export const formatTrace = (trace: TraceEntry[]): string =>
  trace.map((t) => (t.detail === undefined ? t.action : `${t.action}: ${t.detail}`)).join('\n');

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

export async function runVerification(
  req: VerificationRequest,
  resolveAdapter: (platform: Platform) => Promise<DeviceAdapter>,
): Promise<VerificationOutput> {
  const { platforms, cfg, specs, contract } = req;

  const runOne = async (p: Platform): Promise<VerificationLeg> => {
    const adapter = await resolveAdapter(p);
    const engine = new FlowEngine(cfg, adapter, { environment: req.environment });
    const trace: TraceEntry[] = [];
    if (req.state) trace.push(...(await engine.ensureState(req.state)));
    if (req.flow) trace.push(...(await engine.runFlow(req.flow)));
    const results = await new Verifier(adapter, { baselineDir: req.baselineDir }).assertAll(specs);
    // Grab the tree inside the leg, right at the screen the leg ended on —
    // no extra device round-trip ordering issues after the legs settle.
    // Bounded retry (the transient "null root node" read the polling
    // asserts absorb), and a final failure must NOT reject the leg: that
    // would discard the trace, assert results and screenshot of a
    // minutes-long device run over the one optional extra read.
    let tree: UiNode | undefined;
    let treeError: string | undefined;
    if (contract !== undefined) {
      try {
        tree = await readTreeWithRetry(adapter);
      } catch (e) {
        treeError = e instanceof Error ? e.message : String(e);
      }
    }
    const shot = await adapter.screenshot();
    const health = await appHealth(adapter, cfg);
    return { trace, results, shot, health, tree, treeError };
  };

  const runs = await Promise.allSettled(platforms.map(runOne));

  const sections: string[] = [];
  const screenshots: Buffer[] = [];
  platforms.forEach((p, i) => {
    const run = runs[i];
    if (run.status === 'rejected') {
      sections.push(`## ${p}\nFAILED: ${run.reason instanceof Error ? run.reason.message : String(run.reason)}`);
      return;
    }
    const { trace, results, shot, health } = run.value;
    const verdict = specs.length === 0 ? '' : `\n${assertSummary(results)}`;
    sections.push(`## ${p}\n${formatTrace(trace)}${verdict}\n${formatAsserts(results)}${health}`);
    screenshots.push(shot);
  });

  if (contract !== undefined) {
    sections.push(
      paritySection('rect parity', platforms, runs, treeOf, 'SKIPPED: no leg produced a UI tree.', (trees) =>
        formatRectParity(compareRectParity(contract, trees)),
      ),
    );

    // Color parity, only when the contract opts in (any anchor carrying
    // bg / bg_dark / sample). Reuses each leg's tree AND its final
    // screenshot bytes — the exact pixels already returned to the caller,
    // never a second capture that could race a UI change.
    //
    // No opts → theme is always 'light' — deliberate: verify exposes no
    // theme input because averi cannot switch device themes, and sampling a
    // light capture against bg_dark hexes would fake dark evidence. The
    // comparator's theme option (and its tests) is the plumbing for the
    // deferred dark-mode round.
    if (contractHasColorAnchors(contract)) {
      sections.push(
        paritySection(
          'color parity',
          platforms,
          runs,
          captureOf,
          'SKIPPED: no leg produced both a UI tree and a decodable screenshot.',
          (captures) => formatColorParity(compareColorParity(contract, captures)),
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
    if (contractHasTextAnchors(contract)) {
      const { ocrByPlatform, notes: ocrNotes } = await runOcr(
        contract,
        platforms,
        runs,
        req.ocrEngine,
      );
      sections.push(
        paritySection(
          'text parity',
          platforms,
          runs,
          (leg, p): Contribution<TextCapture> => {
            if (leg.tree === undefined) return { note: noTreeNote(leg, p) };
            const got = ocrByPlatform.get(p);
            return { value: { tree: leg.tree, ocr: got?.ocr, pngWidth: got?.pngWidth } };
          },
          'SKIPPED: no leg produced a UI tree.',
          (captures) => formatTextParity(compareTextParity(contract, captures)),
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
const noTreeNote = (leg: VerificationLeg, p: Platform): string =>
  `(${p}: UI tree read failed — ${leg.treeError ?? 'unknown'} — compared without it)`;

const treeOf = (leg: VerificationLeg, p: Platform): Contribution<UiNode> =>
  leg.tree !== undefined ? { value: leg.tree } : { note: noTreeNote(leg, p) };

const captureOf = (leg: VerificationLeg, p: Platform): Contribution<ColorCapture> => {
  if (leg.tree === undefined) return { note: noTreeNote(leg, p) };
  try {
    return { value: { tree: leg.tree, png: PNG.sync.read(leg.shot) } };
  } catch (e) {
    return {
      note: `(${p}: screenshot PNG decode failed — ${e instanceof Error ? e.message : String(e)} — compared without it)`,
    };
  }
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
      if (run.status === 'rejected' || run.value.tree === undefined) return;
      const { tree, shot } = run.value;
      try {
        const png = PNG.sync.read(shot);
        const regions = ocrRegionsFor(contract, tree, png.width, png.height);
        if (regions.length === 0) return;
        const results = await engine.recognize(shot, regions);
        ocrByPlatform.set(p, {
          ocr: new Map(results.map((r) => [r.id, r])),
          pngWidth: png.width,
        });
      } catch (e) {
        notes.push(
          `(${p}: OCR failed — ${e instanceof Error ? e.message : String(e)} — that platform compared from the tree.)`,
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
    body = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
  }
  return `## ${title}\n${note}${body}`;
}
