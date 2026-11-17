import { SetupError, unknownName } from '../flow/config.js';
import { resolveCredentials } from '../flow/credentials.js';
import { runRequestOf, type RunRequest } from '../flow/engine.js';
import type { ProjectConfig } from '../flow/load.js';

/** The names an engine tool call asks for: a state, a flow, both or neither (verify may name neither). */
type Names = { state?: string; flow?: string };

/**
 * The run layer's pre-flight: refuse what averi.yaml does not declare BEFORE any adapter is resolved — on iOS that is
 * a WDA connect, or a multi-minute build, and on a verify one device per leg, spent on a typo. It checks the request's
 * top-level state and flow names, then the `environment`, and returns the RunRequest the engine is handed (undefined
 * when the request names neither state nor flow: nothing for the engine to do).
 *
 * Every unknown name is in ONE refusal, one line each with the names averi.yaml does define (or that it defines none),
 * so a verify answers once rather than with a FAILED section per leg. Thrown — a SetupError, like the contract
 * pre-flight in run/verify.ts — because there is nothing yet to throw away.
 *
 * The engine checks the same things again (flow/engine.ts#FlowEngine: the names when it reaches them, the environment
 * in its constructor) as invariants for any caller that is not this layer; it runs after the adapter, where a missing
 * device's error would mask the typo, so it cannot give this guarantee itself. The environment's resolution here is
 * pure and cheap and its result is discarded: the engine resolves again for itself, before any step.
 */
export function preflight(project: ProjectConfig, request: RunRequest, environment: string | undefined): RunRequest;
export function preflight(project: ProjectConfig, request: Names, environment: string | undefined): RunRequest | undefined;
export function preflight(project: ProjectConfig, request: Names, environment: string | undefined): RunRequest | undefined {
  const { cfg, env } = project;
  const run = runRequestOf(request.state, request.flow);
  const unknown = [
    ...(run?.state !== undefined && !Object.hasOwn(cfg.states, run.state) ? [unknownName('state', run.state, cfg)] : []),
    ...(run?.flow !== undefined && !Object.hasOwn(cfg.flows, run.flow) ? [unknownName('flow', run.flow, cfg)] : []),
  ];
  if (unknown.length > 0) throw new SetupError(`${unknown.join('\n')}\nNothing was run on a device.`);
  resolveCredentials(cfg, env, environment);
  return run;
}
