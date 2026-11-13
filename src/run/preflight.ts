import type { AveriConfig } from '../flow/config.js';
import { resolveCredentials, type EnvValues } from '../flow/credentials.js';

/**
 * The environment pre-flight: refuse an `environment` averi.yaml does not
 * declare BEFORE any adapter is resolved — on iOS that is a WDA connect, or a
 * multi-minute build, spent on a typo. The engine's constructor, which also
 * checks the name, runs AFTER the adapter. The one call here is pure and
 * cheap and its result is discarded: the engine resolves again for itself,
 * before any step, and decides nothing differently — only WHEN the refusal
 * happens. Thrown (a SetupError naming the known environments), like the
 * contract pre-flight in run/verify.ts, because there is nothing yet to throw
 * away.
 */
export function refuseUnknownEnvironment(cfg: AveriConfig, env: EnvValues, requested: string | undefined): void {
  resolveCredentials(cfg, env, requested);
}
