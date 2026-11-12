import type { Platform } from '../adapters/types.js';
import { launchConsultsConfigActivity, type LaunchEntry } from '../flow/launch.js';
import { NO_CONFIG, OPTIONAL_CONFIG, REQUIRED_CONFIG, REQUIRED_CONFIG_AND_ENV } from '../flow/tool-config.js';

/**
 * THE policy table (2026-10-08) — every MCP tool that takes a `configPath`,
 * and what one call of it reads of averi.yaml: none / optional / required,
 * per platform, with `.env.averi` only for the engine tools. The vocabulary,
 * the rule behind it and the one read it drives are flow/tool-config.ts's;
 * this file is only the mapping, and it is here, beside the registrations,
 * because it is keyed by MCP tool names (review round 1: in flow/ it put the
 * MCP vocabulary below the layer that owns it). Every config-reading handler
 * in mcp/tools.ts starts with one read under its entry — `serve(p, TOOL_CONFIG.<tool>(…), cp)`
 * (config, device and eyes together, A30), or `loadForCall(TOOL_CONFIG.<tool>(…), cp)` where the device waits.
 *
 * ARCHITECTURE.md §5 ("Which tools read averi.yaml") carries the same table
 * in prose; tests/mcp/config-policy.test.ts pins each entry,
 * tests/mcp/tools.test.ts the behaviour through the protocol and that the
 * table's tools are exactly the ones whose schema takes a `configPath`.
 *
 * Each entry takes only what its decision reads. Since D41 (2026-11-01) every
 * tool that resolves a device is here: on iOS each reads averi.yaml for the
 * tree source, because the registry keeps one adapter per (simulator, tree
 * source) and a tool that asked without the project's kind was served by a
 * second, idb-kind adapter (ADR 0032, amendment D41). Two entries depend on
 * the call: `launch_app` reads averi.yaml on Android only when the
 * `app.android.activity` fallback can apply (flow/config.ts's own
 * `launchConsultsConfigActivity`), and `install_app`
 * requires it only when the call names no path — the config is then the
 * only source of the build; a call with a path reads it as any device tool
 * does. (Until D41 the path case read nothing, by the handler's
 * `path ?? appBuildPath(…)` short-circuit.)
 */

/**
 * The device tools' entry: the iOS tree source (and, for tap and type_text, the keyboard dismissals) are iOS-only
 * values, so android reads nothing. `optional`: without a file the kind is undefined — the registry's default, auto (A41a).
 */
const onIos = (p: Platform) => (p === 'ios' ? OPTIONAL_CONFIG : NO_CONFIG);

export const TOOL_CONFIG = {
  // Without a path the build comes from averi.yaml, so the file is required; with one, only the tree source is read.
  install_app: (call: { platform: Platform; path: string | undefined }) => (call.path === undefined ? REQUIRED_CONFIG : onIos(call.platform)),
  launch_app: (call: Omit<LaunchEntry, 'appId'>) => (launchConsultsConfigActivity(call) ? OPTIONAL_CONFIG : onIos(call.platform)),
  terminate_app: onIos,
  open_deep_link: onIos,
  screenshot: onIos,
  ui_snapshot: onIos,
  tap: onIos,
  type_text: onIos,
  scroll_until: onIos,
  // A direction or coordinates alike (until D41 coordinates read nothing):
  // on iOS the stroke goes through the project's adapter, and a direction
  // also reads its tree (the orientation witness, the fallback box).
  swipe: onIos,
  press_key: onIos,
  get_logs: onIos,
  // Both platforms: the health line asks about the app averi.yaml names for
  // the platform, and iOS also reads its tree source from it.
  assert: () => OPTIONAL_CONFIG,
  ensure_state: () => REQUIRED_CONFIG_AND_ENV,
  run_flow: () => REQUIRED_CONFIG_AND_ENV,
  verify: () => REQUIRED_CONFIG_AND_ENV,
} as const;
