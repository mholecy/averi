import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { LaunchIntent } from '../adapters/types.js';
import {
  elementSpecObject,
  elementSpecSchema,
  hasSelector,
  type ElementSpec,
} from '../ui-tree/element-spec.js';
import { elementAssertSchema, type ElementAssert } from '../verify/element-assert.js';

/** Schema for `averi.yaml` flow descriptors (ARCHITECTURE.md §4). */

export interface Condition {
  element?: ElementSpec;
  /** With element: true inverts the check — element gone or off-viewport. */
  absent?: boolean;
  state?: string;
  any?: Condition[];
  all?: Condition[];
}

export interface FillSpec extends ElementSpec {
  value: string;
  /** Delete the field's current content before typing (opt-in: pre-filled login fields must survive). */
  clear?: boolean;
  dismissKeyboard?: boolean;
}

export interface TapSpec extends ElementSpec {
  /**
   * Overrides the engine's tap budget (find + settle; default 5s) — for
   * elements that render slowly enough that a `wait:` step used to have to
   * babysit the tap. Inside `optional:` it overrides the PRESENCE-CHECK
   * window (default 1.5s) instead: how long a maybe-interstitial gets to
   * appear before the step is skipped as not-present. Note the cost: an
   * optional tap burns this full window whenever the element never shows —
   * when the alternative screen is detectable, a state with `any:` over both
   * outcomes plus `branch:` exits immediately either way and stays the better
   * idiom.
   */
  timeout?: string | number;
}

export interface ScrollUntilSpec {
  element: ElementSpec;
  /** Which way the CONTENT moves into view (down = reveal content below). */
  direction?: 'up' | 'down' | 'left' | 'right';
  maxSwipes?: number;
  timeout?: string | number;
}

export type Step =
  | { launch: { clearState?: boolean; activity?: string; intent?: LaunchIntent } }
  | { tap: TapSpec }
  | { type: { value: string } }
  | {
      type_pin: {
        value: string;
        keypad?: { id_pattern?: string; text_pattern?: string };
        twice?: boolean;
      };
    }
  | { swipe: { direction: 'up' | 'down' | 'left' | 'right'; times?: number } }
  | { scroll_until: ScrollUntilSpec }
  | { fill: FillSpec }
  | { assert: ElementAssert[] }
  | { wait: { element?: ElementSpec; state?: string; timeout?: string | number } }
  | { branch: { when: Condition; do: Step[] }[] }
  | { optional: Step[] }
  | { android?: Step; ios?: Step };

const condition: z.ZodType<Condition> = z.lazy(() =>
  z
    .object({
      element: elementSpecSchema.optional(),
      absent: z.boolean().optional(),
      state: z.string().optional(),
      any: z.array(condition).optional(),
      all: z.array(condition).optional(),
    })
    .strict()
    .refine((c) => [c.element, c.state, c.any, c.all].filter((v) => v !== undefined).length === 1, {
      message: 'condition must have exactly one of: element, state, any, all',
    })
    .refine((c) => c.absent === undefined || c.element !== undefined, {
      message: 'absent is only valid together with element',
    }),
);

const timeout = z.union([z.number(), z.string()]);

/** Android-only `am start` parameters — see LaunchIntent in adapters/types.ts. */
const launchIntent: z.ZodType<LaunchIntent> = z
  .object({
    action: z.string().optional(),
    data: z.string().optional(),
    mimeType: z.string().optional(),
    categories: z.array(z.string()).optional(),
    extras: z.record(z.string()).optional(),
  })
  .strict();

const step: z.ZodType<Step> = z.lazy(() =>
  z.union([
    z
      .object({
        launch: z
          .object({
            clearState: z.boolean().optional(),
            activity: z.string().optional(),
            intent: launchIntent.optional(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        tap: elementSpecObject
          .extend({ timeout: timeout.optional() })
          .refine(hasSelector, { message: 'tap needs at least one of: id, text, role, label' }),
      })
      .strict(),
    z.object({ type: z.object({ value: z.string() }).strict() }).strict(),
    z
      .object({
        type_pin: z
          .object({
            value: z.string(),
            keypad: z
              .object({
                id_pattern: z.string().optional(),
                text_pattern: z.string().optional(),
              })
              .strict()
              .refine((k) => (k.id_pattern === undefined) !== (k.text_pattern === undefined), {
                message: 'keypad needs exactly one of: id_pattern, text_pattern',
              })
              .optional(),
            twice: z.boolean().optional(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        swipe: z
          .object({
            direction: z.enum(['up', 'down', 'left', 'right']),
            times: z.number().int().min(1).optional(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        scroll_until: z
          .object({
            element: elementSpecSchema,
            direction: z.enum(['up', 'down', 'left', 'right']).optional(),
            maxSwipes: z.number().int().min(1).optional(),
            timeout: timeout.optional(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        fill: elementSpecObject
          .extend({
            value: z.string(),
            clear: z.boolean().optional(),
            dismissKeyboard: z.boolean().optional(),
          })
          .refine(hasSelector, { message: 'fill needs at least one of: id, text, role, label' }),
      })
      .strict(),
    z.object({ assert: z.array(elementAssertSchema).min(1) }).strict(),
    z
      .object({
        wait: z
          .object({
            element: elementSpecSchema.optional(),
            state: z.string().optional(),
            timeout: timeout.optional(),
          })
          .strict()
          .refine((w) => (w.element === undefined) !== (w.state === undefined), {
            message: 'wait needs exactly one of: element, state',
          }),
      })
      .strict(),
    z
      .object({ branch: z.array(z.object({ when: condition, do: z.array(step) }).strict()).min(1) })
      .strict(),
    z.object({ optional: z.array(step).min(1) }).strict(),
    z
      .object({ android: step.optional(), ios: step.optional() })
      .strict()
      .refine((s) => s.android !== undefined || s.ios !== undefined, {
        message: 'platform override needs android and/or ios',
      }),
  ]),
);

const configSchema = z
  .object({
    app: z
      .object({
        android: z
          .object({
            package: z.string(),
            apk: z.string().optional(),
            /**
             * Entry activity for launches (".MainActivity" or fully-qualified).
             * Without it launch uses `monkey -c LAUNCHER`, which picks
             * arbitrarily among the package's launcher activities — debug
             * builds bundling LeakCanary have two, so set this to pin the app.
             */
            activity: z.string().optional(),
          })
          .strict()
          .optional(),
        ios: z
          .object({
            bundleId: z.string(),
            app: z.string().optional(),
            /**
             * Which backend reads the accessibility tree. Default idb —
             * native projects see zero change. React Native projects opt in
             * with `treeSource: wda`: RN puts testID on the HOST view whose
             * AX child carries no identifier, so idb sees nothing (measured
             * 2026-08-12, docs/plans/ios-wda-tree-source.md §Problem).
             * No `auto` value — deferred until the Phase 4 latency
             * measurement of /source on deep trees.
             */
            treeSource: z.enum(['idb', 'wda']).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    credentials: z.record(z.string()).optional(),
    /**
     * Per-environment credential overrides, layered ON TOP of `credentials:`.
     * Only the keys that actually differ per backend need repeating — in
     * practice that is the username, while password/sms/pin are shared.
     */
    environments: z.record(z.object({ credentials: z.record(z.string()) }).strict()).optional(),
    /** Used when neither the tool call nor `AVERI_ENV` names one. */
    defaultEnvironment: z.string().optional(),
    states: z
      .record(
        z.object({ detect: condition, reach: z.array(z.string()).optional() }).strict(),
      )
      .default({}),
    flows: z
      .record(
        z
          .object({
            requires: z.string().optional(),
            /**
             * Marks a flow as unrepeatable, which keeps it out of the reach
             * ladder's recovery pass (`flowIsDestructive`, below). It is
             * already inferred from `launch { clearState: true }`;
             * the flag is for the kinds a static walk cannot see — a flow that
             * taps through "log out", consumes a one-shot SMS code, or deletes
             * something server-side is just as unrepeatable as a wipe.
             *
             * `true` is the only accepted value: the flag can only ADD to what
             * the engine infers, never subtract. `destructive: false` on a
             * flow that wipes would read like an override and silently be
             * none, so it is rejected at parse time instead.
             */
            destructive: z.literal(true).optional(),
            steps: z.array(step).min(1),
          })
          .strict(),
      )
      .default({}),
  })
  .strict();

export type AveriConfig = z.infer<typeof configSchema>;

export function parseConfig(yamlText: string, source = 'averi.yaml'): AveriConfig {
  const raw = parseYaml(yamlText);
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid ${source}:\n${issues}`);
  }
  validateReferences(result.data, source);
  return result.data;
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
export function resolveBuildPaths(cfg: AveriConfig, configPath: string): AveriConfig {
  const dir = dirname(resolve(configPath));
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
  return resolveBuildPaths(parseConfig(await readFile(path, 'utf8'), path), path);
}

/**
 * loadConfig for tools that predate averi.yaml and must keep working without
 * one (ui_snapshot, tap, ...): a MISSING file is `undefined`, but a
 * present-and-invalid file still throws — silently ignoring a broken config
 * would mask the very setting (e.g. app.ios.treeSource) the caller came for.
 */
export async function loadConfigIfPresent(path: string): Promise<AveriConfig | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  return resolveBuildPaths(parseConfig(raw, path), path);
}

export interface ResolvedCredentials {
  /** `$name` → template, base overlaid with the chosen environment. */
  credentials: Record<string, string>;
  /** The environment actually applied, or undefined when running on base only. */
  environment?: string;
}

/**
 * Pick the credential set for a run: base `credentials:` overlaid per-key with
 * `environments.<name>.credentials`.
 *
 * Precedence, most specific first: explicit `requested` (tool argument) →
 * `AVERI_ENV` (settable from `.env.averi`, so switching backend is one line in
 * an already-gitignored file) → `defaultEnvironment:` → base only.
 *
 * Why this exists: one username for two backends caused an hour's misdiagnosis
 * on 2026-08-06 — the wrong login name is rejected by the bank one screen AFTER
 * it is typed, so an environment mix-up presents as a credentials problem.
 */
/**
 * A mistake in the config or the environment, as opposed to the app not being
 * on the screen a flow expected: an undeclared credential, an unset `${VAR}`,
 * a name that does not resolve.
 *
 * The distinction is load-bearing for `ensure_state`'s reach ladder, which
 * escalates past a rung that fails. Escalation is right when the cheap flow
 * simply did not fit the screen — and wrong for these, which the next flow
 * cannot fix and will usually hit too: escalating a typo'd credential into a
 * `launch { clearState: true }` login wipes app state to re-run a step that
 * was never going to work. These abort the ladder instead.
 */
export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupError';
  }
}

export function resolveCredentials(cfg: AveriConfig, requested?: string): ResolvedCredentials {
  const name = requested ?? process.env.AVERI_ENV ?? cfg.defaultEnvironment;
  const base = cfg.credentials ?? {};
  if (name === undefined) return { credentials: base };

  const known = Object.keys(cfg.environments ?? {});
  const env = cfg.environments?.[name];
  if (!env) {
    const source =
      requested !== undefined ? 'requested'
      : process.env.AVERI_ENV !== undefined ? 'AVERI_ENV'
      : 'defaultEnvironment';
    throw new SetupError(
      `Unknown environment "${name}" (from ${source}) — known: ${known.join(', ') || '(none declared)'}`,
    );
  }
  return { credentials: { ...base, ...env.credentials }, environment: name };
}

/**
 * Load `.env.averi` sitting next to averi.yaml into process.env — the
 * project-local home for credential values (gitignored). Shell/CI exports
 * win over the file; values the FILE itself supplied earlier are refreshed
 * on every load, so editing .env.averi mid-session takes effect on the next
 * tool call (measured 2026-08-05: the old first-load-wins behavior silently
 * kept typing stale credentials for the server's whole lifetime). Returns
 * the names applied or refreshed.
 *
 * Format: `KEY=value` per line; `export KEY=value`, blank lines, `#` comments
 * and single/double quotes around the value are tolerated.
 */
const envVarsFromFile = new Set<string>();

export async function loadEnvBeside(configPath: string): Promise<string[]> {
  const envPath = join(dirname(configPath), '.env.averi');
  let raw: string;
  try {
    raw = await readFile(envPath, 'utf8');
  } catch {
    return [];
  }
  const applied: string[] = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    const [, name, rawValue] = m;
    const value = rawValue.replace(/^(['"])(.*)\1$/, '$2');
    const fresh = process.env[name] === undefined;
    const refreshed = envVarsFromFile.has(name) && process.env[name] !== value;
    if (fresh || refreshed) {
      process.env[name] = value;
      envVarsFromFile.add(name);
      applied.push(name);
    }
  }
  return applied;
}

/** Cross-reference checks zod can't express: state/flow names must exist. */
/**
 * The steps nested inside a step, or `undefined` if this kind holds none.
 *
 * The single place that knows which kinds are containers. Three walks over
 * Step depend on that: the engine's dispatcher, the reference check below, and
 * `stepsAreDestructive`. The dispatcher must stay hand-written — it is a
 * discriminated switch with a different return per kind, and it throws on an
 * unhandled one — but the two recursive walks are pure structure, and having
 * them re-derive the nesting independently is how a container kind added later
 * gets covered in one of them and silently skipped in the other.
 */
export function childSteps(step: Step): Step[] | undefined {
  if ('android' in step || 'ios' in step) {
    const o = step as { android?: Step; ios?: Step };
    return [o.android, o.ios].filter((v): v is Step => v !== undefined);
  }
  if ('branch' in step) return step.branch.flatMap((arm) => arm.do);
  if ('optional' in step) return step.optional;
  return undefined;
}

/**
 * Does this flow do something a second run cannot undo? The mechanical answer
 * is `launch { clearState: true }` anywhere in its steps — the wipe that burns
 * a device registration — and `destructive: true` covers what a static walk
 * cannot see.
 *
 * It lives here rather than in the engine because it is a property of the
 * DESCRIPTOR, not of a run: a pure function of AveriConfig, in the same class
 * as `validateReferences` and reading the same schema. The engine owns the
 * mechanism (re-run a rung, re-check detect); this owns the policy (which
 * rungs may be re-run at all).
 *
 * It is deliberately conservative: an unknown flow, or a `requires` cycle,
 * counts as destructive. The only thing it gates is whether a rung may be
 * re-run in the recovery pass, so "cannot prove it is safe" must land on the
 * side of not re-running it — that is exactly the pre-recovery behaviour,
 * which is merely slower, not more expensive.
 *
 * `requires` is followed because it pulls in a whole other reach ladder: a
 * one-step prelude that requires a state whose only way in is a `clearState`
 * login is not a cheap flow, however cheap its own steps read.
 */
export function flowIsDestructive(
  cfg: AveriConfig,
  name: string,
  stack: Set<string> = new Set(),
): boolean {
  const flow = cfg.flows[name];
  if (flow === undefined || stack.has(`flow:${name}`)) return true;
  if (flow.destructive === true) return true;
  const next = new Set(stack).add(`flow:${name}`);
  if (flow.requires !== undefined && stateReachIsDestructive(cfg, flow.requires, next)) return true;
  return stepsAreDestructive(flow.steps);
}

function stateReachIsDestructive(cfg: AveriConfig, name: string, stack: Set<string>): boolean {
  if (stack.has(`state:${name}`)) return true;
  const next = new Set(stack).add(`state:${name}`);
  return (cfg.states[name]?.reach ?? []).some((flow) => flowIsDestructive(cfg, flow, next));
}

/**
 * A wipe hidden in a branch arm still wipes. Note which way the fallthrough
 * points: containers recurse through `childSteps`, every SAFE leaf is named,
 * and anything left over is destructive. This is the one walk over Step whose
 * default is load-bearing — the dispatcher throws on an unhandled kind (loud)
 * and `checkSteps` merely skips one (a missed reference check), but a silent
 * skip HERE would call a `clearState` nested inside a later step kind safe to
 * repeat, and the recovery pass would run the wipe twice. So a kind added to
 * Step without a case here costs a skipped recovery — slower, exactly the
 * pre-2026-08-26 behaviour — never a wipe.
 */
function stepsAreDestructive(steps: Step[]): boolean {
  return steps.some((step) => {
    if ('launch' in step) return step.launch.clearState === true;
    const children = childSteps(step);
    if (children !== undefined) return stepsAreDestructive(children);
    return !(
      'tap' in step ||
      'type' in step ||
      'type_pin' in step ||
      'swipe' in step ||
      'scroll_until' in step ||
      'fill' in step ||
      'assert' in step ||
      'wait' in step
    );
  });
}

function validateReferences(cfg: AveriConfig, source: string): void {
  const fail = (msg: string) => {
    throw new Error(`Invalid ${source}: ${msg}`);
  };
  const checkCondition = (c: Condition, where: string): void => {
    if (c.state !== undefined && !(c.state in cfg.states)) {
      fail(`${where} references unknown state "${c.state}"`);
    }
    [...(c.any ?? []), ...(c.all ?? [])].forEach((sub) => checkCondition(sub, where));
  };
  const checkSteps = (steps: Step[], where: string): void => {
    for (const s of steps) {
      if ('wait' in s && s.wait.state !== undefined && !(s.wait.state in cfg.states)) {
        fail(`${where} waits for unknown state "${s.wait.state}"`);
      }
      // Branch arms carry a condition of their own; the nested STEPS of every
      // container kind come from the shared walker, so this cannot drift from
      // `stepsAreDestructive`.
      if ('branch' in s) s.branch.forEach((arm) => checkCondition(arm.when, where));
      const children = childSteps(s);
      if (children !== undefined) checkSteps(children, where);
    }
  };
  if (cfg.defaultEnvironment !== undefined && !(cfg.defaultEnvironment in (cfg.environments ?? {}))) {
    fail(
      `defaultEnvironment "${cfg.defaultEnvironment}" is not declared under environments: ` +
        `(known: ${Object.keys(cfg.environments ?? {}).join(', ') || 'none'})`,
    );
  }
  for (const [name, state] of Object.entries(cfg.states)) {
    checkCondition(state.detect, `states.${name}.detect`);
    for (const flow of state.reach ?? []) {
      if (!(flow in cfg.flows)) fail(`states.${name}.reach references unknown flow "${flow}"`);
    }
  }
  for (const [name, flow] of Object.entries(cfg.flows)) {
    if (flow.requires !== undefined && !(flow.requires in cfg.states)) {
      fail(`flows.${name}.requires references unknown state "${flow.requires}"`);
    }
    checkSteps(flow.steps, `flows.${name}`);
  }
}
