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
import { compareRectParity, formatRectParity } from '../verify/rect-parity.js';

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
    const failed = results.filter((r) => !r.pass).length;
    const verdict =
      specs.length === 0 ? ''
      : failed === 0 ? `\nAll ${results.length} asserts passed`
      : `\n${failed}/${results.length} asserts FAILED`;
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
  }

  return { sections, screenshots };
}

/** Either the artifact this leg contributes, or why it cannot contribute one. */
type Contribution<T> = { value: T } | { note: string };

const treeOf = (leg: VerificationLeg, p: Platform): Contribution<UiNode> =>
  leg.tree !== undefined
    ? { value: leg.tree }
    : { note: `(${p}: UI tree read failed — ${leg.treeError ?? 'unknown'} — compared without it)` };

const captureOf = (leg: VerificationLeg, p: Platform): Contribution<ColorCapture> => {
  if (leg.tree === undefined) {
    return { note: `(${p}: UI tree read failed — ${leg.treeError ?? 'unknown'} — compared without it)` };
  }
  try {
    return { value: { tree: leg.tree, png: PNG.sync.read(leg.shot) } };
  } catch (e) {
    return {
      note: `(${p}: screenshot PNG decode failed — ${e instanceof Error ? e.message : String(e)} — compared without it)`,
    };
  }
};

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
): string {
  const collected: Partial<Record<Platform, T>> = {};
  const notes: string[] = [];
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
