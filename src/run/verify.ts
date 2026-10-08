import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DeviceAdapter, Platform, UiNode } from '../adapters/types.js';
import type { AveriConfig } from '../flow/config.js';
import type { EnvValues } from '../flow/credentials.js';
import { refuseUnknownEnvironment } from './preflight.js';
import { formatTrace, FlowEngine, runRequestOf, type EngineContext, type TraceEntry } from '../flow/engine.js';
import { scanForCrashes, Verifier, type AssertResult, type AssertSpec } from '../verify/assert.js';
import { errorMessage } from '../util/error-message.js';
import { captureFrame, captureRefusal, unsettledNote, type Frame, type MeasuredFrame, type TreeFrame } from '../verify/capture.js';
import {
  compareColorParity,
  contractHasColorAnchors,
  formatColorParity,
  validateColorContract,
  type ColorParityOptions,
} from '../verify/color-parity.js';
import { parseLayoutContract, type LayoutContract } from '../verify/layout-contract.js';
import { ocrEngineFor, type OcrEngine } from '../verify/ocr.js';
import {
  compareRectParity,
  formatRectParity,
  validateRectContract,
  type RectLeg,
} from '../verify/rect-parity.js';
import {
  compareTextParity,
  contractHasTextAnchors,
  formatTextParity,
  textMeasurement,
  validateTextContract,
  type TextCapture,
} from '../verify/text-parity.js';
import type { Contribution } from '../verify/contribution.js';

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

/** The engine context (environment, session) is flow/engine.ts#EngineContext, shared with run/commands.ts. */
interface VerificationRequestBase extends EngineContext {
  /** Already normalized: deduped, canonical android-then-ios order. */
  platforms: Platform[];
  cfg: AveriConfig;
  /** The environment the legs' engines resolve `${VAR}` from — the loader's, beside `cfg`. */
  env: EnvValues;
  specs: AssertSpec[];
  state?: string;
  flow?: string;
  baselineDir: string;
  /**
   * Test seam: the OCR recognizer behind every OCR read the run makes itself
   * — the text-parity table AND each leg's `ocr` asserts (2026-10-08; until
   * then only the table's, and the asserts chose the host's engine on their
   * own). A flow's `assert:` steps build their own Verifier in the engine
   * and are outside this choice.
   */
  ocrEngine?: OcrEngine;
}

/**
 * The layout contract, one of two ways — never both, and the types say so
 * rather than a documented precedence:
 *
 * - `contractPath`: the file the user named. The run reads, parses and
 *   validates it itself, all before any adapter is resolved: a typo'd path, a
 *   malformed file and a bad field value are the same class of mistake and
 *   must not cost a device run. The path is also what a refusal quotes — a
 *   message that names the file is the one its author can act on.
 * - `contract`: one already in memory (the run-level tests; a caller that
 *   built it). Validated the same way; a refusal cannot name a file.
 *
 * Until 2026-10-03 the MCP handler read and parsed the file and passed the
 * result in with a separate `contractSource` beside it, while this module
 * owned the validation: the pre-flight lived in two layers, and the name in
 * the refusal was a second field that had to be kept in step with the first.
 */
type ContractInput =
  | { contractPath?: string; contract?: never }
  | { contract?: LayoutContract; contractPath?: never };

export type VerificationRequest = VerificationRequestBase & ContractInput;

export interface VerificationOutput {
  /** Markdown sections, in order; the caller joins them with a blank line. */
  sections: string[];
  /** One PNG per leg that got far enough to produce one, in platform order. */
  screenshots: Buffer[];
}

/**
 * The final capture of a run that has already done its work — a `verify`
 * leg, `ensure_state` — or the one line saying why there is none
 * (2026-10-08). Since the adapters refuse a capture that is not a PNG as a
 * transport error (adapters/screenshot-bytes.ts), `captureFrame` can throw
 * for a device that died AFTER the run, and a throw here would discard the
 * trace, the assert results, the health line and the ⚠ lines of a run that
 * took minutes — the same loss the leg's comment below forbids for a tree or
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

/**
 * What one platform's leg produced. `frame` is the settled frame the leg
 * ended on — the png returned to the caller and, with a contract, the tree
 * and the one scale the parity tables measure against; absent parts carry
 * their reason (verify/capture.ts). Absent altogether, with `failed`, when
 * the capture itself threw (`finalFrame`).
 */
type VerificationLeg = {
  trace: TraceEntry[];
  results: AssertResult[];
  health: string;
} & FinalFrame;

/**
 * appAlive check (ARCHITECTURE.md §8): is the app-under-test still running?
 * When it died, include a crash excerpt from recent logs so a run that ended
 * on a blank screen says why. Which results carry it is the callers' call
 * (run/commands.ts, the verify legs below).
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
 * The flags a log grep compiles with — case-insensitive, nothing else. Named
 * so get_logs' schema validates the pattern under the same flags
 * (util/regex.ts) rather than a copy of them. Never `g` or `y`:
 * formatLogExcerpt compiles the pattern once and calls `.test` on every line,
 * and a global or sticky regex carries `lastIndex` from one line into the
 * next, silently dropping matches.
 */
export const LOG_GREP_FLAGS = 'i';

/**
 * How many matching lines a log excerpt keeps when the caller names no
 * budget — the tail, where the failure is. Owned here, where the limit is
 * applied; the MCP get_logs tool's schema default and description quote it.
 * (Until 2026-10-08 this function defaulted to 2000 while the tool's schema
 * said 400, two defaults for one limit.)
 */
export const LOG_MAX_LINES = 400;

/**
 * Device-log excerpt: filter to a regex, keep the tail, and say what that did.
 * Pure — it takes the lines rather than the device — because the COUNTING is
 * the part that misleads when it is wrong: a grep that silently matched
 * nothing reads exactly like a quiet device, and a truncated pull that does
 * not admit it reads like the whole story. Worth a test; untestable inside a
 * tool handler.
 */
export function formatLogExcerpt(all: string[], grep: string | undefined, maxLines = LOG_MAX_LINES): string {
  const re = grep === undefined ? undefined : new RegExp(grep, LOG_GREP_FLAGS);
  const lines = re === undefined ? all : all.filter((l) => re.test(l));
  const tail = lines.slice(-maxLines);
  const header: string[] = [];
  if (grep !== undefined) header.push(`[grep /${grep}/${LOG_GREP_FLAGS} matched ${lines.length} of ${all.length} lines]`);
  if (lines.length > tail.length) {
    header.push(`[truncated: showing last ${maxLines} of ${lines.length} lines]`);
  }
  return [...header, ...tail].join('\n');
}

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
 * ONE place the no-tree note is decided (`measuredOf` below adds the one
 * further note a tree-bearing frame can carry: the png did not decode). A
 * leg is only asked for a frame with a tree when there is a contract, and
 * the tables only exist then; the fallback wording covers the shape the
 * types cannot rule out.
 */
const withTree = (leg: VerificationLeg, p: Platform): Contribution<TreeFrame> => {
  if (leg.frame === undefined) return { note: `(${p}: no screenshot — ${leg.failed} — compared without it)` };
  const m = leg.frame.measured;
  // The frame is spread, not re-spelled, so what it says about itself
  // (`stability`, `captures`, whatever comes next) reaches every table.
  if (m?.tree !== undefined) return { value: { ...leg.frame, measured: m } };
  return { note: noTreeNote(p, m?.error ?? 'no UI tree was read for this leg') };
};

/**
 * What the rect table reads off a leg: the tree and the window width judged
 * for it at capture (verify/scale.ts#windowWidth) — both tree-bearing arms
 * carry them, so a png that did not decode costs this table nothing. Until
 * 2026-10-07 this kept the tree alone and the comparator measured the width
 * itself, dropping the device screen the frame had already read.
 */
const rectLegOf = (leg: VerificationLeg, p: Platform): Contribution<RectLeg> => {
  const got = withTree(leg, p);
  if ('note' in got) return got;
  const { tree, window } = got.value.measured;
  return { value: { tree, window } };
};

/**
 * The frame's measured half, or why there is none — the frame's own one
 * sentence, which names the tree read when that is what failed and the png
 * decode when the tree is here and the pixels are not.
 */
const measuredOf = (leg: VerificationLeg, p: Platform): Contribution<MeasuredFrame> => {
  const got = withTree(leg, p);
  if ('note' in got) return got;
  const m = got.value.measured;
  return m.error === undefined ? { value: m } : { note: `(${p}: ${m.error} — compared without it)` };
};

/**
 * The parity dimensions a contract can add to a run: the table's title, the
 * predicate deciding whether THIS contract produces it, and the comparator's
 * own validator for the fields it will read.
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
 * read. `COLOR_OPTIONS` is the ONE object handed to both the colour `validate`
 * (dimensionProblems) and the compare call below; a dark-mode round that set
 * the theme for the comparator alone would let a bad `bg_dark` through
 * validation and fail it after the legs, which is the cost this whole check
 * exists to remove. Colour is the only dimension with options (2026-10-08):
 * the rect and text comparators, and their validators, read everything from
 * the contract — each comparator used to take a test-only tolerance override
 * production never passed (`{}` here), which the validators had to take too
 * only to mirror it (parity review 2026-10-07 P2; rect-parity.ts#
 * tolerancesOf). Until then this record carried an `options` field per
 * dimension, two of three always `{}`.
 *
 * The table holds FACTS only — title, produced, validate — the three
 * that are asked at two moments (before the legs, after them) and must agree
 * between the two. Everything about HOW one table is built — what a leg
 * contributes, what the section says when no leg could, what the run decided
 * before any leg — is handed to `paritySection` at the one call that builds
 * it. For one day (2026-10-04 → 2026-10-05) those hooks sat in this record
 * too, with a run-context object only the text collector read — one or two
 * users each, so they failed the deletion test and went back to the call
 * sites (ARCHITECTURE §2 has the full account). Comparing and formatting
 * stay hand-written per dimension below, on purpose: the three degrade
 * differently, and the 2026-08-14 review's decision stands — no generic
 * reporting framework. Rejected on 2026-10-05: its opposite, a `report()` in
 * the record and one loop over the three, which would have needed type
 * erasure to iterate a heterogeneous record.
 */
interface ParityDimension {
  title: string;
  produced: (contract: LayoutContract) => boolean;
  validate: (contract: LayoutContract) => string[];
}

/**
 * The colour table's options — validated under and compared under, both
 * through this one object (see ParityDimension).
 *
 * Theme is always 'light' — deliberate: verify exposes no theme input
 * because averi cannot switch device themes, and sampling a light capture
 * against bg_dark hexes would fake dark evidence. The comparator's theme
 * option (and its tests) is the plumbing for the deferred dark-mode round.
 */
const COLOR_OPTIONS: ColorParityOptions = { theme: 'light' };

const DIMENSIONS: { rect: ParityDimension; color: ParityDimension; text: ParityDimension } = {
  // Geometry is what a contract IS: the rect table exists whenever one does.
  rect: {
    title: 'rect parity',
    produced: () => true,
    validate: validateRectContract,
  },
  // Opt-in: any anchor carrying bg / bg_dark / sample. Reuses each leg's
  // frame — the exact pixels already returned to the caller, the tree read
  // beside them and the scale derived once — never a second capture that
  // could race a UI change. Under COLOR_OPTIONS, the one theme verify runs.
  color: {
    title: 'color parity',
    produced: contractHasColorAnchors,
    validate: (contract) => validateColorContract(contract, COLOR_OPTIONS),
  },
  // Opt-in: any anchor carrying text / text_dynamic. The recognizer runs on
  // the bytes each leg already returned; when it cannot run at all the run
  // says so once and every leg stands on its tree (text-parity.ts#textMeasurement).
  text: {
    title: 'text parity',
    produced: contractHasTextAnchors,
    validate: validateTextContract,
  },
};

/** The one sentence two tables share for "no leg had a tree" — rect and text both stand on the tree alone. */
const SKIPPED_NO_TREE = 'SKIPPED: no leg produced a UI tree.';

/** One dimension's problems — none when this contract does not produce its table. */
const dimensionProblems = (d: ParityDimension, contract: LayoutContract): string[] =>
  d.produced(contract) ? d.validate(contract) : [];

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
 * Each validator asks what its comparator will ask — the contract, and for
 * colour the same COLOR_OPTIONS the table below hands the comparator — so
 * what is refused here is what would have failed there.
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

/**
 * The contract file the request names, read and parsed.
 *
 * The path resolves against the process cwd, as it always has — NOT against
 * averi.yaml's directory, which is where the baselines and the build paths
 * hang (flow/load.ts). The asymmetry is inherited, and is why the read
 * error prints the resolved path beside the one given: a relative contract
 * path next to a `configPath` in another directory is the likely way to get
 * this wrong.
 *
 * A read failure is wrapped (2026-10-03): the bare `ENOENT: no such file or
 * directory, open '…'` said neither which argument it was about nor that no
 * device had been touched. A file that reads but is not a contract keeps
 * parseLayoutContract's own wording, which already names the source.
 *
 * `contract` beside `contractPath` is a type error, but a caller without the
 * types would silently get the file; refused here instead, naming both.
 *
 * Both errors speak this module's vocabulary — `contractPath`, the request
 * field — not the MCP tool's (`contract` is its argument name, and mcp/ is
 * above run/). The read error still says in words what the field is, so an
 * agent holding only the tool error knows which argument to fix.
 */
/**
 * Why a file read failed, WITHOUT the path: Node's message ends in
 * `, open '<path>'`, and the sentence around it has already named the file —
 * printing it twice made the one line an agent has to act on harder to read.
 * The system's code is kept (it is what a search finds); an error with no
 * code keeps its whole message.
 */
const READ_FAILURES: Record<string, string> = {
  ENOENT: 'no such file',
  EISDIR: 'it is a directory, not a file',
  EACCES: 'permission denied',
};
function readFailure(e: unknown): string {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code !== 'string') return errorMessage(e);
  return READ_FAILURES[code] === undefined ? code : `${code} (${READ_FAILURES[code]})`;
}

async function loadContract(req: VerificationRequest & { contractPath: string }): Promise<LayoutContract> {
  const { contractPath } = req;
  if ((req as { contract?: unknown }).contract !== undefined) {
    throw new Error(
      'verify: both `contract` and `contractPath` were given — pass one: the path of a contract file, ' +
        'or a contract already in memory; nothing was run on a device.',
    );
  }
  const resolved = resolve(contractPath);
  let raw: string;
  try {
    raw = await readFile(resolved, 'utf8');
  } catch (e) {
    throw new Error(
      `verify: layout contract ${contractPath} could not be read` +
        `${resolved === contractPath ? '' : ` (resolved to ${resolved})`}: ${readFailure(e)} — ` +
        'check `contractPath`, the path given for the layout contract (a relative one resolves against the ' +
        'server\'s working directory, not against averi.yaml); nothing was run on a device.',
    );
  }
  return parseLayoutContract(raw, contractPath);
}

export async function runVerification(
  req: VerificationRequest,
  resolveAdapter: (platform: Platform) => Promise<DeviceAdapter>,
): Promise<VerificationOutput> {
  const { platforms, cfg, env, specs } = req;
  // Read and parsed here, first: nothing below may touch a device before the
  // contract is known to exist, to parse, and (next) to carry usable values.
  const contract = req.contractPath === undefined ? req.contract : await loadContract({ ...req, contractPath: req.contractPath });

  // Before any leg starts and before any adapter is resolved: a contract the
  // tables can only answer with FAILED must not cost the device run first.
  // It THROWS — unlike everything after the legs, which is contained — because
  // there is nothing yet to throw away.
  if (contract !== undefined) {
    const problems = contractProblems(contract);
    if (problems.length > 0) throw new Error(contractRefusal(problems, req.contractPath));
  }
  // Same rule for the environment — run/preflight.ts#refuseUnknownEnvironment
  // has the why (2026-10-05): a thrown refusal here, before any leg, where it
  // used to be a contained per-leg FAILED section after resolveAdapter.
  refuseUnknownEnvironment(cfg, env, req.environment);

  // The run's ONE OCR decision (2026-10-08, review 2026-10-07 assert-capture-
  // ocr C1): the text table and every leg's Verifier read with the same
  // engine, or fail closed on the same reason. Until then only the table
  // got `req.ocrEngine`; each leg's Verifier called `ocrEngineFor` itself,
  // so a run-level fake never reached the ocr asserts (on a host without
  // Vision they failed closed with the fake unused) and a two-platform run
  // built up to three VisionOcr instances, each probing `swiftc --version`
  // (0.1–0.5 s) before its binary cache. Deciding costs nothing — the
  // engine probes its toolchain on its first read — so a run with no OCR in
  // it still never asks for a compiler.
  const ocr = ocrEngineFor(req.ocrEngine);

  const runOne = async (p: Platform): Promise<VerificationLeg> => {
    const adapter = await resolveAdapter(p);
    // ONE engine run per leg (2026-10-07): the state and the flow share its
    // trace, environment line and recovery budget, so a flow that fails after
    // the state was ensured fails with the state's lines too. Until then the
    // leg called the engine's two entries in turn and concatenated their
    // traces — and a failing flow's error carried only its own half.
    // Neither named (or both empty, as `if (req.state)` always read them):
    // no run, an empty trace.
    const request = runRequestOf(req.state, req.flow);
    const trace: TraceEntry[] =
      request === undefined ?
        []
      : await FlowEngine.run(cfg, adapter, { env, environment: req.environment, session: req.session }, request);
    const results = await new Verifier(adapter, { baselineDir: req.baselineDir, ocr }).assertAll(specs);
    // The frame the leg ended on, captured SETTLED — until 2026-10-02 this was
    // a bare screenshot, so the color and text tables could be fed the one
    // frame the color assert's own doc rules out: a mid-animation one. With a
    // contract the tree is read beside it (bounded retry, the transient "null
    // root node" the polling asserts absorb) and the png scale derived once;
    // a failed tree read or device-screen read must NOT reject the leg — that
    // would discard the trace, assert results and screenshot of a minutes-long
    // device run over an optional extra read — so both land on the frame as
    // reasons the tables quote.
    // The capture itself throwing (a dead device's refused screenshot) is
    // caught the same way, by finalFrame: no image, one ⚠ line, the rest kept.
    const final = await finalFrame(adapter, { readTree: contract !== undefined });
    const health = await appHealth(adapter, cfg);
    return { trace, results, health, ...final };
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
    const { trace, results, frame, failed, health } = run.value;
    const verdict = specs.length === 0 ? '' : `\n${assertSummary(results)}`;
    // One line when the leg's frame did not settle (2026-10-05): the picture
    // below may be mid-animation, and the tables that read it say nothing.
    // In the same place, one line when there is no frame at all (2026-10-08).
    const note = frame === undefined ? screenshotFailedLine(failed) : unsettledNote(frame);
    const frameLine = note === undefined ? '' : `\n${note}`;
    sections.push(`## ${p}\n${formatTrace(trace)}${verdict}\n${formatAsserts(results)}${frameLine}${health}`);
    if (frame !== undefined) screenshots.push(frame.shot);
  });

  if (contract !== undefined) {
    // The colour options are COLOR_OPTIONS, shared with the validation that
    // ran before the legs (see ParityDimension). The three sections are produced
    // the same way — one `paritySection` call each, handed what one leg
    // contributes and what the section says when none could; only the
    // comparator differs.
    if (DIMENSIONS.rect.produced(contract)) {
      sections.push(
        await paritySection(DIMENSIONS.rect.title, platforms, runs, {
          collect: rectLegOf,
          empty: SKIPPED_NO_TREE,
          format: (trees) => formatRectParity(compareRectParity(contract, trees)),
        }),
      );
    }
    if (DIMENSIONS.color.produced(contract)) {
      sections.push(
        await paritySection(DIMENSIONS.color.title, platforms, runs, {
          collect: measuredOf,
          empty: 'SKIPPED: no leg produced both a UI tree and a decodable screenshot.',
          format: (captures) => formatColorParity(compareColorParity(contract, captures, COLOR_OPTIONS)),
        }),
      );
    }
    if (DIMENSIONS.text.produced(contract)) {
      // Inside the guard: a host without OCR prints its one caveat once
      // rather than per leg, and a rect-only contract prints none. The
      // engine is the run's one choice, the one its asserts read with.
      const text = textMeasurement(contract, ocr);
      sections.push(
        await paritySection(DIMENSIONS.text.title, platforms, runs, {
          collect: (leg, p) => {
            const got = withTree(leg, p);
            return 'note' in got ? got : text.measure(p, got.value);
          },
          empty: SKIPPED_NO_TREE,
          runNotes: text.runNotes,
          format: (captures) => formatTextParity(compareTextParity(contract, captures)),
        }),
      );
    }
  }

  return { sections, screenshots };
}

/** How ONE parity table is built from the legs — handed to `paritySection` at the call that builds it. */
interface SectionBuild<T> {
  /** One leg's artifact with its caveats, or why it cannot contribute one. May be async (the text table runs a recognizer per leg). */
  collect: (leg: VerificationLeg, platform: Platform) => Contribution<T> | Promise<Contribution<T>>;
  /** The section body when NO leg contributed. */
  empty: string;
  /** What the run decided before any leg — why the whole table is degraded (text: no recognizer on this host). */
  runNotes?: string[];
  /** The comparator and its renderer, over the legs that contributed. */
  format: (collected: Partial<Record<Platform, T>>) => string;
}

/**
 * Every parity table has the same shape: collect one artifact per leg, note
 * the legs that cannot contribute, skip when none can, and CONTAIN any
 * collector or comparator error. That containment is the point — a contract
 * that cannot be normalized, or a measurement that throws, must not reject
 * the tool call and throw away the traces, assert results and screenshots of
 * a device run that took minutes. Today's collectors cannot throw (each
 * degrades to a note itself); the catch is for the next one, since `collect`
 * is where a new dimension's measurement lands.
 *
 * The legs are collected in parallel (the text dimension's collector runs a
 * recognizer per leg) and their notes printed in platform order: the run's
 * own notes first (why the whole table is degraded), then each leg's — the
 * leg that could not contribute, or the caveats of the one that did.
 * (2026-10-04: per-leg notes in platform order after the run-level note;
 * previously the per-leg OCR notes came first, in Promise.all completion
 * order — nondeterministic.)
 *
 * Exported for its containment test only; runVerification is the caller.
 */
export async function paritySection<T>(
  title: string,
  platforms: Platform[],
  runs: PromiseSettledResult<VerificationLeg>[],
  build: SectionBuild<T>,
): Promise<string> {
  const collected: Partial<Record<Platform, T>> = {};
  const notes: string[] = [...(build.runNotes ?? [])];
  const contributions = await Promise.all(
    platforms.map(async (p, i): Promise<Contribution<T>> => {
      const leg = runs[i];
      if (leg.status === 'rejected') return { note: `(${p} leg failed — compared without it)` };
      try {
        return await build.collect(leg.value, p);
      } catch (e) {
        return { note: `(${p}: ${title} could not be measured — ${errorMessage(e)} — compared without it)` };
      }
    }),
  );
  platforms.forEach((p, i) => {
    const contribution = contributions[i];
    if ('note' in contribution) {
      notes.push(contribution.note);
    } else {
      collected[p] = contribution.value;
      notes.push(...(contribution.notes ?? []));
    }
  });
  const note = notes.length > 0 ? notes.join('\n') + '\n' : '';
  if (Object.keys(collected).length === 0) return `## ${title}\n${note}${build.empty}`;
  let body: string;
  try {
    body = build.format(collected);
  } catch (e) {
    body = `FAILED: ${errorMessage(e)}`;
  }
  return `## ${title}\n${note}${body}`;
}
