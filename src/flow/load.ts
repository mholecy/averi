import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Platform } from '../adapters/types.js';
import { inertKeyboardDismissNote, parseConfig, type AveriConfig } from './config.js';
import type { EnvValues } from './credentials.js';

/**
 * Loading: everything that touches the file system to turn a project into a
 * config — which file, where its paths point, what the sibling `.env.averi`
 * contributes — plus the pure lookups that read the loaded result for a tool
 * (`appBuildPath`). Split out of flow/config.ts on 2026-10-04 (architecture
 * review, C6, folded into C2): config.ts keeps the schema, the types and the
 * pure walks over them, so parsing a payload loads no I/O, and the
 * `.env.averi` reading that used to keep module-level state and write
 * `process.env` is one function here that returns a value instead
 * (`envBeside`, below). Which of these loaders a TOOL CALL runs, and when a
 * missing or invalid file is tolerated, is flow/tool-config.ts's (since
 * 2026-10-08; until then `iosToolSettingsFor` sat here and each MCP handler
 * chose a loader by hand); only the mapping of each tool name to its policy
 * is the MCP layer's (mcp/config-policy.ts).
 */

/** What a config-requiring tool starts from: the parsed descriptor and the environment its values resolve in. */
export interface ProjectConfig {
  cfg: AveriConfig;
  /** See flow/credentials.ts — real environment over `.env.averi`, assembled once per load. */
  env: EnvValues;
}

/**
 * Build paths in averi.yaml are written relative to the CONFIG FILE, not to the
 * process working directory, and are returned absolute.
 *
 * The two coincide when the session runs from the app repo and diverge the
 * moment it does not — nested repos, monorepos, a `configPath:` pointing into a
 * subdirectory. Resolving against cwd turned `apk: android/app/build/...` into
 * `<outer-root>/android/app/build/...` and install_app failed, while passing
 * `configPath` fixed only the lookup of the file itself, never the paths inside
 * it. Config-relative keeps averi.yaml portable: it stays correct in the app
 * repo standing alone and when that repo is nested inside another.
 *
 * Absolute paths pass through untouched.
 */
function resolveBuildPaths(cfg: AveriConfig, configPath: string): AveriConfig {
  const dir = configDir(configPath);
  const app = { ...cfg.app };
  if (app.android?.apk !== undefined) {
    app.android = { ...app.android, apk: resolve(dir, app.android.apk) };
  }
  if (app.ios?.app !== undefined) {
    app.ios = { ...app.ios, app: resolve(dir, app.ios.app) };
  }
  return { ...cfg, app };
}

/** The directory averi.yaml lives in — the project root every other project-relative path hangs off. */
export function configDir(configPath: string): string {
  return dirname(resolve(configPath));
}

export async function loadConfig(path: string): Promise<AveriConfig> {
  return loaded(path, parseConfig(await readFile(path, 'utf8'), path));
}

/**
 * Every successful load of a config file comes through here — the strict
 * loader and the lenient one alike: the build paths resolved against the
 * file, and the one load-time NOTE a parsed config can carry
 * (`inertKeyboardDismissNote`, review round 1) said on stderr, once per
 * file and sentence, like the `.env.averi` announcement below. A note, not a
 * parse error: the config is valid, it merely cannot act as written.
 */
function loaded(path: string, cfg: AveriConfig): AveriConfig {
  const note = inertKeyboardDismissNote(cfg);
  if (note !== undefined && !noted.has(`${path}\n${note}`)) {
    noted.add(`${path}\n${note}`);
    console.error(`averi: ${path}: ${note}`);
  }
  return resolveBuildPaths(cfg, path);
}

/** The load-time notes already said, per file — log-only state, as `announced` is. */
const noted = new Set<string>();

/**
 * All project configuration lives with the project, not with averi: averi.yaml
 * is looked up against the process cwd (the project root when the server is
 * launched from .mcp.json) unless the caller points elsewhere. Here since
 * 2026-10-03, with the two loaders below — it was mcp/tools.ts's, and the
 * tool compositions in run/ need the same default.
 */
export const projectConfigPath = (configPath?: string): string => resolve(configPath ?? 'averi.yaml');

/**
 * The strict load every tool that resolves credentials starts with (the
 * `required` + `env` policy of flow/tool-config.ts: ensure_state, run_flow,
 * verify): the environment is assembled from the real one and a sibling
 * .env.averi (said on stderr, since stdout is the MCP transport), then
 * averi.yaml must exist and parse. A tool that needs the config but no
 * credentials (install_app) runs `loadConfig` alone and reads no .env.averi.
 *
 * The ONE place under src/flow/ that reads `process.env`. Everything below it
 * takes the environment as a value (ProjectConfig.env), so nothing else in
 * the flow layer can depend on when, or whether, the file was read.
 */
export async function loadProjectConfig(configPath?: string): Promise<ProjectConfig> {
  const path = projectConfigPath(configPath);
  const { env, contributed } = await envBeside(path, process.env);
  const changed = announce(path, contributed);
  if (changed.length > 0) console.error(`averi: loaded ${changed.join(', ')} from .env.averi`);
  return { cfg: await loadConfig(path), env };
}

/**
 * What the stderr line says: the names `.env.averi` contributed on this load
 * (not shadowed by the real environment) that differ from what was last
 * announced for THIS config — first sight lists them all, an edit lists the
 * changed ones, an unchanged file says nothing. For one config per session
 * that is the line the writing version printed; across several configs it is
 * now per file (A → B → A used to re-announce A's names, since B's load had
 * overwritten them in `process.env`). The memo (`announced`) is log-only and
 * lives beside the one impure function: it decides what is SAID, never what
 * any value IS — `envBeside` itself is pure.
 */
function announce(configPath: string, contributed: Readonly<Record<string, string>>): string[] {
  const last = announced.get(configPath) ?? {};
  const changed = Object.keys(contributed).filter((name) => last[name] !== contributed[name]);
  if (changed.length > 0) announced.set(configPath, { ...contributed });
  return changed;
}

/** What each config's .env.averi was last announced as (name → value) — see `announce`; log-only. */
const announced = new Map<string, Record<string, string>>();

/**
 * The build to install when the caller names none: averi.yaml's, for the
 * platform asked about (already resolved against the config's directory by
 * loadConfig). The error is the `install_app` tool's wording, kept
 * byte-identical when the lookup moved here from its handler (2026-10-03).
 */
export function appBuildPath(cfg: AveriConfig, platform: Platform): string {
  const path = platform === 'android' ? cfg.app.android?.apk : cfg.app.ios?.app;
  if (path === undefined) throw new Error(`No path given and averi.yaml has no app.${platform} build path`);
  return path;
}

/**
 * loadConfig for tools that predate averi.yaml and must keep working without
 * one (ui_snapshot, tap, assert, launch_app, ... — the `optional` policy of
 * flow/tool-config.ts): a MISSING file is `undefined`, but a
 * present-and-invalid file still throws — silently ignoring a broken config
 * would mask the very setting (app.ios.treeSource, app.android.activity, the
 * app the health line asks about) the caller came for. Any other read error
 * (a directory, no permission) throws as it came.
 */
export async function loadConfigIfPresent(path: string): Promise<AveriConfig | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  return loaded(path, parseConfig(raw, path));
}

/**
 * The environment a project runs in: `processEnv` (the shell's, CI's) over
 * the `.env.averi` sitting next to averi.yaml — the project-local home for
 * credential values (gitignored). Shell/CI exports win over the file, so a
 * variable the user set is never overridden; the file is re-read on EVERY
 * load, so editing .env.averi mid-session takes effect on the next tool call
 * (measured 2026-08-05: the old first-load-wins behaviour silently kept typing
 * stale credentials for the server's whole lifetime). Returned, not written:
 * until 2026-10-04 this wrote the file's values into `process.env` and kept a
 * set of the names it had written so it could refresh them; with the merge a
 * value there is nothing to refresh, and no state that decides a value. A
 * missing file contributes nothing.
 *
 * Two VALUES changed with that move, both fixes (2026-10-04): a name REMOVED
 * from .env.averi is gone on the next load — the writing version kept it in
 * `process.env` for the server's life, so a removed `AVERI_ENV` kept every
 * later run on the old backend, the 2026-08-05 bug in another coat — and one
 * project's file values no longer leak into another project loaded by the
 * same server (B with no file used to see A's values). The file also no
 * longer reaches child processes: adb, xcrun and xcodebuild used to inherit
 * the credentials through `process.env`; now they inherit the shell's
 * environment only.
 *
 * Pure: a function of the file's text and `processEnv`, nothing remembered
 * between calls. `contributed` is the file's names that made it into `env`
 * (not shadowed by the real environment), for the caller's stderr line
 * (`announce`, above).
 *
 * Format: `KEY=value` per line; `export KEY=value`, blank lines, `#` comments
 * and single/double quotes around the value are tolerated.
 */
export async function envBeside(
  configPath: string,
  processEnv: EnvValues,
): Promise<{ env: EnvValues; contributed: Readonly<Record<string, string>> }> {
  const envPath = join(configDir(configPath), '.env.averi');
  const fromFile = parseEnvFile(await readFile(envPath, 'utf8').catch(() => ''));
  const contributed: Record<string, string> = {};
  for (const [name, value] of Object.entries(fromFile)) {
    if (processEnv[name] === undefined) contributed[name] = value;
  }
  return { env: Object.freeze({ ...processEnv, ...contributed }), contributed: Object.freeze(contributed) };
}

function parseEnvFile(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    const [, name, rawValue] = m;
    out[name] = rawValue.replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}
