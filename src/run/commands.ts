import { resolve } from 'node:path';
import type { DeviceAdapter, Platform } from '../adapters/types.js';
import {
  resolveLaunchActivity,
  launchConsultsConfigActivity,
  type AveriConfig,
  type LaunchEntry,
} from '../flow/config.js';
import { configDir, loadProjectConfig, projectConfigPath } from '../flow/load.js';
import { refuseUnknownEnvironment } from './preflight.js';
import { FlowEngine, type TraceEntry } from '../flow/engine.js';
import { DEFAULT_BASELINE_DIR, Verifier, type AssertSpec } from '../verify/assert.js';
import { captureFrame, unsettledNote } from '../verify/capture.js';
import { appHealth, assertSummary, formatAsserts, formatTrace } from './verify.js';

/**
 * The single-platform tool compositions: what one `ensure_state`, `run_flow`,
 * `assert` or `launch_app` call DOES, below the MCP layer.
 *
 * 2026-10-03. They are here for the reason run/verify.ts is: each composes
 * the flow engine, the verifier and the config loader for one tool call, and
 * ARCHITECTURE.md §2 gives the MCP layer schemas, descriptions and one
 * delegation — not sequences. Until this step the sequences were written out
 * in the handlers (mcp/tools.ts): ensure_state and run_flow carried the same
 * four lines twice, the assert handler held the health line's catch, and
 * launch_app held the "when to consult averi.yaml" guard. They could be
 * drained without changing behaviour because tests/mcp/tools.test.ts already
 * pinned each response through the protocol; these functions are now also
 * tested at their own level (tests/run/commands.test.ts), with a FakeAdapter
 * and no server.
 *
 * What does NOT come down here: the registry. It is the MCP session's state
 * (which device a platform is pinned to), so each function takes either a
 * resolved adapter or a callback that resolves one — the shape
 * `runVerification` already has with `resolveAdapter`. A callback where the
 * adapter depends on something this function loads first (the config names
 * the iOS tree source), and where the order "config before device" is
 * behaviour: a broken averi.yaml must fail the call before a device is bound.
 */

/** Resolves the adapter for a call once its config is loaded (the config names the iOS tree source). */
export type ResolveAdapterFor = (cfg: AveriConfig) => Promise<DeviceAdapter>;


/**
 * Baselines belong to the project, so they hang off averi.yaml like every other
 * project-relative path — `.averi/baselines/` beside the config, not beside
 * whatever directory the server happens to run in. Configless callers (assert
 * works without averi.yaml) keep the cwd-relative default.
 */
export const baselineDirFor = (configPath?: string): string =>
  resolve(configDir(projectConfigPath(configPath)), DEFAULT_BASELINE_DIR);

interface EngineCall {
  configPath?: string;
  environment?: string;
}

/**
 * The sequence ensure_state and run_flow share: config, the environment
 * pre-flight (`refuseUnknownEnvironment`), adapter, engine, the trace, then
 * the health line — in that order, each step only if the one before it
 * succeeded (a failing flow throws its own trace; there is no health line on
 * a failure, as there never was).
 */
async function runOnEngine(
  call: EngineCall,
  resolveAdapter: ResolveAdapterFor,
  run: (engine: FlowEngine) => Promise<TraceEntry[]>,
): Promise<{ adapter: DeviceAdapter; text: string }> {
  const { cfg, env } = await loadProjectConfig(call.configPath);
  refuseUnknownEnvironment(cfg, env, call.environment);
  const adapter = await resolveAdapter(cfg);
  const trace = await run(new FlowEngine(cfg, adapter, { env, environment: call.environment }));
  return { adapter, text: formatTrace(trace) + (await appHealth(adapter, cfg)) };
}

/** `ensure_state`: the trace and health line, and the frame the state was left in — settled, as `screenshot` settles it. */
export async function runEnsureState(
  call: EngineCall & { state: string },
  resolveAdapter: ResolveAdapterFor,
): Promise<{ text: string; shot: Buffer }> {
  const { adapter, text } = await runOnEngine(call, resolveAdapter, (engine) => engine.ensureState(call.state));
  const frame = await captureFrame(adapter);
  const unsettled = unsettledNote(frame);
  return { text: unsettled === undefined ? text : `${text}\n${unsettled}`, shot: frame.shot };
}

/** `run_flow`: the trace and health line. */
export async function runNamedFlow(
  call: EngineCall & { flow: string },
  resolveAdapter: ResolveAdapterFor,
): Promise<string> {
  return (await runOnEngine(call, resolveAdapter, (engine) => engine.runFlow(call.flow))).text;
}

export interface AssertCall {
  adapter: DeviceAdapter;
  specs: AssertSpec[];
  baselineDir: string;
  /** Only for the health line — the asserts themselves need no averi.yaml. */
  configPath?: string;
}

/** `assert`: the verdict line, one line per assert, and the health line when averi.yaml says which app to ask about. */
export async function runAsserts({ adapter, specs, baselineDir, configPath }: AssertCall): Promise<string> {
  const results = await new Verifier(adapter, { baselineDir }).assertAll(specs);
  let health = '';
  try {
    health = await appHealth(adapter, (await loadProjectConfig(configPath)).cfg);
  } catch {
    // no averi.yaml → no app to health-check; asserts stand on their own
    //
    // 2026-10-03: this catch is BROADER than that sentence. It also drops
    // the health line for a present-but-invalid averi.yaml on android
    // (ios never gets here: the tree-source lookup already failed the call
    // before an adapter existed), and for anything appHealth itself throws.
    // Pinned as it behaves today (tests/run/commands.test.ts,
    // tests/mcp/tools.test.ts), not changed: the steps that made this code
    // testable and then moved it here changed no behaviour. The narrower
    // alternative — silent only for a MISSING file (loadConfigIfPresent),
    // loud for an invalid one — is the follow-up, and it is a user-visible
    // change: an android `assert` that passes today beside a broken
    // averi.yaml would start to fail.
  }
  return `${assertSummary(results)}\n${formatAsserts(results)}${health}`;
}

export interface LaunchCall extends LaunchEntry {
  configPath?: string;
}

/**
 * The activity a `launch_app` call starts — flow/config.ts#resolveLaunchActivity,
 * the rule the flow engine's launch step shares, WHEN included (2026-10-03:
 * the named activity, else averi.yaml's, and that only when the call names
 * neither an activity nor an intent; an intent alone goes to the adapter
 * without an activity and is delivered within the app's package). What this
 * function adds is where the tool's config comes from.
 *
 * Two things here are kept exactly as they were in the handler:
 *
 * - averi.yaml and .env.averi are loaded — with the stderr line that says so
 *   — only when the fallback can apply (`launchConsultsConfigActivity`, the
 *   rule's own "when", asked before there is a config to hand it). So an ios
 *   launch, or one that names an activity or an intent, loads nothing.
 *   Pinned in tests/run/commands.test.ts only, through the one observable
 *   the load has left since 2026-10-04 (the env file is read into a value,
 *   not into process.env): an ios call beside a .env.averi prints no
 *   "loaded … from .env.averi" line.
 * - The catch is a catch-ALL: a missing averi.yaml and a present-but-invalid
 *   one both mean "no activity", and the launch goes ahead on the adapter's
 *   own fallback (pinned at both levels: tests/run/commands.test.ts and
 *   tests/mcp/tools.test.ts). 2026-10-03, follow-up, NOT done here: narrow it to the
 *   missing file (loadConfigIfPresent) so a broken config fails the launch
 *   loudly instead of silently opening whatever the launcher picks. That is
 *   a user-visible change — a `launch_app` that works today beside a broken
 *   averi.yaml would start to fail — and belongs with the same narrowing in
 *   runAsserts above.
 */
export async function launchActivityFor(call: LaunchCall): Promise<string | undefined> {
  const project = launchConsultsConfigActivity(call)
    ? await loadProjectConfig(call.configPath).catch(() => undefined)
    : undefined;
  return resolveLaunchActivity(project?.cfg, call);
}
