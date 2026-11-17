import { resolve } from 'node:path';
import type { DeviceAdapter, Platform } from '../adapters/types.js';
import type { AveriConfig } from '../flow/config.js';
import { configDir, projectConfigPath, type ProjectConfig } from '../flow/load.js';
import { preflight } from './preflight.js';
import { FlowEngine, formatTrace, type EngineContext, type RunRequest } from '../flow/engine.js';
import { DEFAULT_BASELINE_DIR, Verifier, type AssertSpec } from '../verify/assert.js';
import { appHealth } from './app-health.js';
import { finalFrame, legText } from './run-reply.js';
import { claimed, claimedError } from './claims.js';

/**
 * The single-platform tool compositions: what one `ensure_state`, `run_flow`
 * or `assert` call DOES, below the MCP layer.
 *
 * They are here for the reason run/verify.ts is: each composes the flow
 * engine, the verifier and the config for one tool call, and ARCHITECTURE.md
 * §2 gives the MCP layer schemas, descriptions and one delegation — not
 * sequences.
 *
 * What does NOT come down here: the registry, and the config read. The
 * registry is the MCP session's state (which device a platform is pinned
 * to), so each function takes either a resolved adapter or a callback that
 * resolves one — the shape `runVerification` already has with
 * `resolveAdapter`. The config arrives already read, once, by the handler
 * under the tool's declared policy (flow/tool-config.ts#loadForCall), so a
 * file is never read twice under two policies. The order "config before
 * device" is behaviour: the handler reads before it calls in here, and the
 * engine tools resolve their adapter through the callback only after the
 * pre-flight of the names and the environment.
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

/** An ensure_state / run_flow call: the project its handler loaded (config and environment), and the engine context (environment name, session — flow/engine.ts#EngineContext). */
interface EngineCall extends EngineContext {
  project: ProjectConfig;
}

/**
 * The sequence ensure_state and run_flow share: the loaded config, the
 * pre-flight of the names and the environment (run/preflight.ts#preflight), adapter, ONE engine run, the
 * trace — in that order, each step only if the one before it succeeded (a
 * failing flow throws its own trace; there is no health line on a failure).
 * The run is handed in as what to run, not as a callback over an engine: the
 * engine has one entry, and every tool that runs it — these two and verify's
 * legs — names a state, a flow or both.
 *
 * The health line is the callers' (D13): computed here, ensure_state would
 * ask the app's health and only THEN take its final frame. Neither is an
 * action and neither reads the other — `appHealth` asks `isAppRunning` (and,
 * for a dead app, the logs); `finalFrame` reads the raw adapter, outside the
 * engine's read hand-off
 * (docs/adr/0030-a-read-is-handed-on-only-as-a-first-sample-or-a-positive-verdict.md),
 * which dies with the run — so ensure_state runs them side by side, and the
 * pidof (44–48 ms in D3's run, 32–60 ms in D13's;
 * docs/plans/2026-10-30-performance-backlog.md, D13 note (2026-10-31,
 * averi_lab API 33)) hides under the frame's settle sleep and
 * screencaps. run_flow takes no frame and asks the health alone. A verify leg
 * keeps them in sequence (run/verify.ts).
 */
async function runOnEngine(
  call: EngineCall,
  resolveAdapter: ResolveAdapterFor,
  request: RunRequest,
): Promise<{ adapter: DeviceAdapter; trace: string }> {
  const { cfg, env } = call.project;
  preflight(call.project, request, call.environment);
  const adapter = await resolveAdapter(cfg);
  try {
    const context = { env, environment: call.environment, session: call.session };
    const trace = await FlowEngine.run(cfg, adapter, context, request);
    return { adapter, trace: formatTrace(trace) };
  } catch (e) {
    // A failed run's error lists the steps it claimed before the failure: it carries the claim note too (claims.ts).
    throw claimedError(adapter, e);
  }
}

/**
 * `ensure_state`: the trace and health line, and the frame the state was left
 * in — settled, as `screenshot` settles it. No `shot` when the capture itself
 * failed (run/run-reply.ts#finalFrame): the state WAS ensured, so the trace
 * stands, with one `⚠ screenshot:` line where an unsettled frame's note goes.
 *
 * The health check and the capture run together (D13, see runOnEngine); the
 * reply is laid out as every run's is (run/run-reply.ts#legText): the trace,
 * the frame's one note line if any, then the health line. Neither rejects for
 * the device: appHealth words its failures into the line (run/app-health.ts,
 * the one policy) and finalFrame catches its own capture failure.
 */
export async function runEnsureState(
  call: EngineCall & { state: string },
  resolveAdapter: ResolveAdapterFor,
): Promise<{ text: string; shot?: Buffer }> {
  const { adapter, trace } = await runOnEngine(call, resolveAdapter, { state: call.state });
  const { cfg } = call.project;
  // A broken adapter's throw from appHealth fails the call; the frame's reads then finish unawaited — reads only.
  const [health, final] = await Promise.all([appHealth(adapter, cfg), finalFrame(adapter)]);
  // The claim note (claims.ts) closes the reply, after the health line.
  const text = claimed([adapter], legText({ trace, final, health }));
  return final.frame === undefined ? { text } : { text, shot: await final.frame.shot.png() };
}

/** `run_flow`: the trace and health line. */
export async function runNamedFlow(
  call: EngineCall & { flow: string },
  resolveAdapter: ResolveAdapterFor,
): Promise<string> {
  const { adapter, trace } = await runOnEngine(call, resolveAdapter, { flow: call.flow });
  return claimed([adapter], legText({ trace, health: await appHealth(adapter, call.project.cfg) }));
}

export interface AssertCall {
  adapter: DeviceAdapter;
  specs: AssertSpec[];
  baselineDir: string;
  /**
   * Only for the health line — the asserts themselves need no averi.yaml.
   * Read by the handler under `assert`'s `optional` policy: `undefined` when
   * there is no file (no app to health-check; the asserts stand on their
   * own), and never a broken one — that failed the call before a device was
   * bound, so no config error reaches the health check.
   */
  cfg: AveriConfig | undefined;
}

/**
 * `assert`: the verdict line, one line per assert, and the health line when
 * averi.yaml says which app to ask about.
 *
 * The config is the handler's single read, under which a broken file fails
 * the call on both platforms. appHealth is awaited bare (A29): it words
 * every device failure into the line itself (run/app-health.ts, one policy),
 * so only an adapter that breaks its contract — a `platform` that throws, or
 * `logs` resolving to no array; both real adapters hold `platform` in a
 * readonly field and return `logs` from a `split` — throws here, and that
 * fails the call, as it fails ensure_state, run_flow and a verify leg.
 */
export async function runAsserts({ adapter, specs, baselineDir, cfg }: AssertCall): Promise<string> {
  // persistentRead: 'fail' — the reply IS the assert results: a read no wait cures (D21) is each assert's FAIL line,
  // its message the detail, rather than an error result that drops the asserts and the health line (VerifierOptions).
  const results = await new Verifier(adapter, { baselineDir, persistentRead: 'fail' }).assertAll(specs);
  const health = cfg === undefined ? '' : await appHealth(adapter, cfg);
  return claimed([adapter], legText({ asserts: results, health }));
}
