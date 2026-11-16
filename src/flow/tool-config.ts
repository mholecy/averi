import type { Platform } from '../adapters/types.js';
import type { IosTreeSourceSetting } from '../adapters/ios-node.js';
import type { KeyboardDismissal } from '../interact/keyboard.js';
import { keyboardDismissals, type AveriConfig } from './config.js';
import type { EnvValues } from './credentials.js';
import { loadConfig, loadConfigIfPresent, loadProjectConfig, projectConfigPath, type ProjectConfig } from './load.js';

/**
 * What one MCP tool call reads of averi.yaml — declared once per tool, and
 * carried out by one function, at most once per call. With a loader picked
 * per handler, two reads could meet in one call (an iOS `assert` reading the
 * file for its tree source and again, strictly and with `.env.averi`, for its
 * health line — which needs no credentials), and one broken file would be
 * judged differently from tool to tool and platform to platform: one call
 * would fail on it while another would silently drop what it came for (a
 * `launch_app` losing `app.android.activity` — the LeakCanary case the
 * tool's description warns about).
 *
 * The rule, for every tool and both platforms:
 *
 * - A tool reads averi.yaml only when this call USES a value from it — the
 *   iOS tree source and keyboard dismissals, the Android entry activity, the
 *   app the health line asks about, the build to install, the states and
 *   flows. A call that would use nothing reads nothing, so a broken file
 *   beside it is not its business (`tap` on Android, `launch_app` with an
 *   activity named on Android, `install_app` with a path on Android). On iOS
 *   every tool that touches the device uses the tree source (D41; see
 *   mcp/config-policy.ts).
 * - Whatever a call reads, a present-but-invalid file FAILS it, naming the
 *   file — under `optional` as under `required`. Silently ignoring a broken
 *   config would lose the very setting the call came for.
 * - `optional` (the tools that predate averi.yaml, so must keep working
 *   without one): a MISSING file is no config, and the call proceeds on the
 *   defaults. `required`: a missing file fails the call too.
 * - `.env.averi` is read only by the tools that resolve credentials —
 *   `env: true`, only with `required`, since credentials without a config
 *   have nothing to fill.
 *
 * Android and iOS differ only where the tool uses different values on them —
 * the tree tools read the tree source and dismissals, which exist on iOS
 * alone; `launch_app` reads the activity, which exists on Android alone —
 * never in how a broken file is judged.
 *
 * Where each half lives: the policy VOCABULARY (`ConfigPolicy` and its four
 * values), the one read it drives (`loadForCall`) and the pure settings over
 * what was read (`iosToolSettings`) are here, because which file is read and
 * when its absence is tolerated is config policy. The MAPPING from tool to
 * policy is keyed by MCP tool names, so it lives beside the registrations, in
 * mcp/config-policy.ts#TOOL_CONFIG; a tool that is not in that table never
 * reads averi.yaml, and tests/mcp/tools.test.ts pins that the table's tools
 * are exactly the ones whose schema takes a `configPath`.
 */

/**
 * How much of the project a call needs. `none` reads nothing; `optional`
 * tolerates a missing averi.yaml; `required` does not; `env` adds the
 * `.env.averi` environment, and exists only beside `required`.
 */
export type ConfigPolicy =
  | { readonly config: 'none' }
  | { readonly config: 'optional' }
  | { readonly config: 'required'; readonly env: boolean };

export const NO_CONFIG = { config: 'none' } as const satisfies ConfigPolicy;
export const OPTIONAL_CONFIG = { config: 'optional' } as const satisfies ConfigPolicy;
export const REQUIRED_CONFIG = { config: 'required', env: false } as const satisfies ConfigPolicy;
export const REQUIRED_CONFIG_AND_ENV = { config: 'required', env: true } as const satisfies ConfigPolicy;

/** What a call under `optional` or `none` starts from: a config only if one was read and found. */
interface MaybeConfig {
  cfg: AveriConfig | undefined;
  env: EnvValues | undefined;
}

/**
 * The one read of a tool call: averi.yaml (and `.env.averi` when the policy
 * asks) at most once, judged by the policy above. A missing file is
 * `undefined` under `optional` and an error under `required`; an invalid one
 * is an error under both (loadConfigIfPresent / loadConfig, which name the
 * file); `none` touches no file.
 *
 * Typed by the policy, so a `required` caller gets a config it need not
 * check and an `env: true` caller an environment. The result is handed down
 * as a value, not a path, so nothing below the handler reads the file a
 * second time.
 */
export function loadForCall(policy: typeof REQUIRED_CONFIG_AND_ENV, configPath?: string): Promise<ProjectConfig>;
export function loadForCall(policy: typeof REQUIRED_CONFIG, configPath?: string): Promise<{ cfg: AveriConfig; env: undefined }>;
export function loadForCall(policy: ConfigPolicy, configPath?: string): Promise<MaybeConfig>;
export async function loadForCall(policy: ConfigPolicy, configPath?: string): Promise<MaybeConfig> {
  switch (policy.config) {
    case 'none':
      return { cfg: undefined, env: undefined };
    case 'optional':
      return { cfg: await loadConfigIfPresent(projectConfigPath(configPath)), env: undefined };
    case 'required':
      return policy.env ? loadProjectConfig(configPath) : { cfg: await loadConfig(projectConfigPath(configPath)), env: undefined };
  }
}

/**
 * What averi.yaml gives the iOS side of a tool call: the tree-source kind
 * (every tree-reading tool) and the keyboard guard's dismissals (`tap` and
 * `type_text`, whose taps go through the guard). Both `undefined` for
 * android, and for a call that read no config.
 */
export interface IosToolSettings {
  /** `app.ios.treeSource` — the registry's default (`auto`) when undefined. */
  treeSource: IosTreeSourceSetting | undefined;
  /**
   * `app.ios.keyboardDismiss` in the guard's vocabulary (flow/config.ts#keyboardDismissals) — a covered target is
   * refused when it is undefined.
   */
  dismissals: readonly KeyboardDismissal[] | undefined;
}

/**
 * The iOS settings of a config the call has already read — pure, so the read
 * stays the policy's (`loadForCall`) and happens once.
 *
 * Android gets neither field even from a config that names them: it has no
 * tree source, and its keyboard guard is the oracle's and never looks at a
 * dismissal. The conversion of the dismissals is
 * flow/config.ts#keyboardDismissals, the one owner.
 */
export function iosToolSettings(cfg: AveriConfig | undefined, platform: Platform): IosToolSettings {
  if (platform === 'android') return { treeSource: undefined, dismissals: undefined };
  return { treeSource: cfg?.app.ios?.treeSource, dismissals: keyboardDismissals(cfg) };
}
