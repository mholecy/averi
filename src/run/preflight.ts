import { defines, SetupError, unknownName } from '../flow/config.js';
import { unknownEnvironment } from '../flow/credentials.js';
import type { RunRequest } from '../flow/engine.js';
import type { ProjectConfig } from '../flow/load.js';

/**
 * The run layer's pre-flight: refuse what averi.yaml does not declare BEFORE any adapter is resolved — on iOS that is
 * a WDA connect, or a multi-minute build, and on a verify one device per leg, spent on a typo. It refuses every name
 * the request carries that averi.yaml does not define, exactly as given, and the environment the run would select;
 * `undefined` names neither state nor flow, leaving only the environment. What counts as named is decided before:
 * an empty state or flow given to verify means that one is not named (both empty: asserts only), not an unknown name
 * (run/verify.ts#runVerification), while ensure_state's and run_flow's name is refused as given, `""` included.
 *
 * Everything wrong is in ONE refusal, one line each with what averi.yaml does declare (or that it declares none of
 * that kind), so a verify answers once rather than with a FAILED section per leg. Thrown — a SetupError, like the
 * contract pre-flight in run/verify.ts — because there is nothing yet to throw away.
 *
 * The engine checks the same things again (flow/engine.ts#FlowEngine: the names when it reaches them, the environment
 * in its constructor) as invariants for any caller that is not this layer; it runs after the adapter, where a missing
 * device's error would mask the typo, so it cannot give this guarantee itself.
 */
export function preflight(
  project: ProjectConfig,
  request: RunRequest | undefined,
  environment: string | undefined,
): void {
  const { cfg, env } = project;
  const envLine = unknownEnvironment(cfg, env, environment);
  const unknown = [
    ...(['state', 'flow'] as const).flatMap((kind) => {
      const name = request?.[kind];
      return name !== undefined && !defines(kind, name, cfg) ? [unknownName(kind, name, cfg)] : [];
    }),
    ...(envLine !== undefined ? [envLine] : []),
  ];
  if (unknown.length > 0) throw new SetupError(`${unknown.join('\n')}\nNothing was run on a device.`);
}
