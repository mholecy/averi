import type { Platform } from '../adapters/types.js';
import { launchConsultsConfigActivity, type LaunchEntry } from '../flow/config.js';
import { NO_CONFIG, OPTIONAL_CONFIG, REQUIRED_CONFIG, REQUIRED_CONFIG_AND_ENV } from '../flow/tool-config.js';

/**
 * THE policy table (2026-10-08) — every MCP tool that takes a `configPath`,
 * and what one call of it reads of averi.yaml: none / optional / required,
 * per platform, with `.env.averi` only for the engine tools. The vocabulary,
 * the rule behind it and the one read it drives are flow/tool-config.ts's;
 * this file is only the mapping, and it is here, beside the registrations,
 * because it is keyed by MCP tool names (review round 1: in flow/ it put the
 * MCP vocabulary below the layer that owns it). Every config-reading handler
 * in mcp/tools.ts starts with `loadForCall(TOOL_CONFIG.<tool>(…), cp)`.
 *
 * ARCHITECTURE.md §5 ("Which tools read averi.yaml") carries the same table
 * in prose; tests/mcp/config-policy.test.ts pins each entry,
 * tests/mcp/tools.test.ts the behaviour through the protocol and that the
 * table's tools are exactly the ones whose schema takes a `configPath`.
 *
 * Each entry takes only what its decision reads. One depends on the call:
 * `launch_app` reads averi.yaml only when the `app.android.activity`
 * fallback can apply (flow/config.ts's own `launchConsultsConfigActivity`).
 * `install_app` does NOT take the call, by design: its entry is plain
 * `required`, and a call that names a path never asks it — the handler's
 * `path ?? appBuildPath(…)` short-circuits before the read. Folding the path
 * into the entry would make it `required | none`, and `cfg` would lose its
 * non-optional type exactly where `appBuildPath` needs it.
 */

/** The tree tools' entry: the iOS tree source and keyboard dismissals are iOS-only values, so android reads nothing. */
const onIos = (p: Platform) => (p === 'ios' ? OPTIONAL_CONFIG : NO_CONFIG);

export const TOOL_CONFIG = {
  // `required` for a call without a path; one with a path never asks (above).
  install_app: () => REQUIRED_CONFIG,
  launch_app: (call: Omit<LaunchEntry, 'appId'>) => (launchConsultsConfigActivity(call) ? OPTIONAL_CONFIG : NO_CONFIG),
  ui_snapshot: onIos,
  tap: onIos,
  type_text: onIos,
  scroll_until: onIos,
  // Both platforms: the health line asks about the app averi.yaml names for
  // the platform, and iOS also reads its tree source from it.
  assert: () => OPTIONAL_CONFIG,
  ensure_state: () => REQUIRED_CONFIG_AND_ENV,
  run_flow: () => REQUIRED_CONFIG_AND_ENV,
  verify: () => REQUIRED_CONFIG_AND_ENV,
} as const;
