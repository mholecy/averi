import type { AveriConfig } from '../flow/config.js';
import { resolveCredentials, type EnvValues } from '../flow/credentials.js';

/**
 * The environment pre-flight (2026-10-05): refuse an `environment` averi.yaml
 * does not declare BEFORE any adapter is resolved — on iOS that is a WDA
 * connect, or a multi-minute build, spent on a typo. Until then the name was
 * first checked by the engine's constructor, which runs AFTER the adapter;
 * `verify` reported it as a contained `FAILED:` section per leg (masked by
 * "No booted …" when the adapter failed first), ensure_state/run_flow threw
 * it after the device was bound. The one call here is pure and cheap and its
 * result is discarded: the engine resolves again for itself, before any step,
 * and decides nothing differently — only WHEN the refusal happens moved.
 * Thrown (a SetupError naming the known environments), like the contract
 * pre-flight in run/verify.ts, because there is nothing yet to throw away.
 */
export function refuseUnknownEnvironment(cfg: AveriConfig, env: EnvValues, requested: string | undefined): void {
  resolveCredentials(cfg, env, requested);
}
