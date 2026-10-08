import { resolve } from 'node:path';
import type { DeviceAdapter, Platform } from '../adapters/types.js';
import type { AveriConfig } from '../flow/config.js';
import { configDir, projectConfigPath, type ProjectConfig } from '../flow/load.js';
import { refuseUnknownEnvironment } from './preflight.js';
import { FlowEngine, type EngineContext, type RunRequest } from '../flow/engine.js';
import { DEFAULT_BASELINE_DIR, Verifier, type AssertSpec } from '../verify/assert.js';
import { unsettledNote } from '../verify/capture.js';
import { appHealth, assertSummary, finalFrame, formatAsserts, formatTrace, screenshotFailedLine } from './verify.js';

/**
 * The single-platform tool compositions: what one `ensure_state`, `run_flow`
 * or `assert` call DOES, below the MCP layer.
 *
 * 2026-10-03. They are here for the reason run/verify.ts is: each composes
 * the flow engine, the verifier and the config for one tool call, and
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
 * What does NOT come down here: the registry, and — since 2026-10-08 — the
 * config read. The registry is the MCP session's state (which device a
 * platform is pinned to), so each function takes either a resolved adapter
 * or a callback that resolves one — the shape `runVerification` already has
 * with `resolveAdapter`. The config arrives already read, once, by the
 * handler under the tool's declared policy (flow/tool-config.ts#loadForCall):
 * until that date runAsserts and the launch-activity lookup each loaded
 * averi.yaml again under a catch-all of their own, so an iOS `assert` read
 * the file twice under two policies and a broken file was judged by the
 * platform. The order "config before device" is still behaviour, and still
 * holds: the handler reads before it calls in here, and the engine tools
 * resolve their adapter through the callback only after the environment
 * pre-flight.
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

/**
 * The session class, re-exported for the MCP layer: mcp/ makes one session
 * per server and hands it down, and run/ is the layer it delegates to
 * (ARCHITECTURE.md §2) — so mcp/ does not import flow/engine.ts for it.
 */
export { EngineSession } from '../flow/engine.js';

/** An ensure_state / run_flow call: the project its handler loaded (config and environment), and the engine context (environment name, session — flow/engine.ts#EngineContext). */
interface EngineCall extends EngineContext {
  project: ProjectConfig;
}

/**
 * The sequence ensure_state and run_flow share: the loaded config, the environment
 * pre-flight (`refuseUnknownEnvironment`), adapter, ONE engine run, the
 * trace, then the health line — in that order, each step only if the one
 * before it succeeded (a failing flow throws its own trace; there is no
 * health line on a failure, as there never was). The run is handed in as
 * what to run, not as a callback over an engine (2026-10-07): the engine
 * has one entry, and every tool that runs it — these two and verify's legs
 * — names a state, a flow or both.
 */
async function runOnEngine(
  call: EngineCall,
  resolveAdapter: ResolveAdapterFor,
  request: RunRequest,
): Promise<{ adapter: DeviceAdapter; text: string }> {
  const { cfg, env } = call.project;
  refuseUnknownEnvironment(cfg, env, call.environment);
  const adapter = await resolveAdapter(cfg);
  const trace = await FlowEngine.run(cfg, adapter, { env, environment: call.environment, session: call.session }, request);
  return { adapter, text: formatTrace(trace) + (await appHealth(adapter, cfg)) };
}

/**
 * `ensure_state`: the trace and health line, and the frame the state was left
 * in — settled, as `screenshot` settles it. No `shot` when the capture itself
 * failed (2026-10-08, run/verify.ts#finalFrame): the state WAS ensured, so the
 * trace stands, with one `⚠ screenshot:` line where an unsettled frame's note goes.
 */
export async function runEnsureState(
  call: EngineCall & { state: string },
  resolveAdapter: ResolveAdapterFor,
): Promise<{ text: string; shot?: Buffer }> {
  const { adapter, text } = await runOnEngine(call, resolveAdapter, { state: call.state });
  const { frame, failed } = await finalFrame(adapter);
  if (frame === undefined) return { text: `${text}\n${screenshotFailedLine(failed)}` };
  const unsettled = unsettledNote(frame);
  return { text: unsettled === undefined ? text : `${text}\n${unsettled}`, shot: frame.shot };
}

/** `run_flow`: the trace and health line. */
export async function runNamedFlow(
  call: EngineCall & { flow: string },
  resolveAdapter: ResolveAdapterFor,
): Promise<string> {
  return (await runOnEngine(call, resolveAdapter, { flow: call.flow })).text;
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
   * bound, so no config error can reach the guard below.
   */
  cfg: AveriConfig | undefined;
}

/**
 * `assert`: the verdict line, one line per assert, and the health line when
 * averi.yaml says which app to ask about.
 *
 * Until 2026-10-08 this loaded averi.yaml itself (strictly, with .env.averi)
 * inside a catch-all, with a dated note naming the narrowing as a
 * user-visible follow-up. The catch-all dropped the health line for a
 * present-but-invalid file on android (ios never got here: its tree-source
 * lookup failed the call first) and for anything appHealth threw. The first
 * half is gone: the config is the handler's single read, under which a broken
 * file fails the call on BOTH platforms — an android `assert` that passed
 * beside a broken averi.yaml now fails, naming the file. The second half is
 * kept, narrowed to what it was for: the guard wraps the health check ALONE,
 * with the config already in hand, so it can no longer hide a config error.
 * appHealth degrades its own device errors into the line
 * (run/verify.ts#appHealth); a throw outside that guard still costs only the
 * health line, as it always did — whether it should fail the assert instead,
 * as it does ensure_state, run_flow and a verify leg, is a verdict change of
 * its own and was not taken with this one (code review, 2026-10-08).
 */
export async function runAsserts({ adapter, specs, baselineDir, cfg }: AssertCall): Promise<string> {
  const results = await new Verifier(adapter, { baselineDir }).assertAll(specs);
  let health = '';
  if (cfg !== undefined) {
    try {
      health = await appHealth(adapter, cfg);
    } catch {
      // the health line is omitted, as before 2026-10-08; the verdict stands
    }
  }
  return `${assertSummary(results)}\n${formatAsserts(results)}${health}`;
}
