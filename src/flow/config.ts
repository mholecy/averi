import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { LaunchIntent, Platform } from '../adapters/types.js';
import { IOS_TREE_SOURCE_KINDS, type IosTreeSourceKind } from '../adapters/ios-node.js';
import {
  elementSpecObject,
  elementSpecSchema,
  hasSelector,
  type ElementSpec,
} from '../ui-tree/element-spec.js';
import { elementAssertSchema, type ElementAssert } from '../verify/element-assert.js';

/**
 * Schema for `averi.yaml` flow descriptors (ARCHITECTURE.md §4), the types it
 * infers, and the pure walks over them (reference validation, the container
 * and destructive-flow rules, the launch-activity rule). Nothing here reads a
 * file or the environment: loading is flow/load.ts, credentials are
 * flow/credentials.ts (split 2026-10-04, architecture review C2/C6 — this
 * file had grown from five responsibilities to seven and held the one
 * `process.env` write in the layer).
 */

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
  /**
   * Require the element ENTIRELY inside the viewport, not merely overlapping
   * it. Default false, which is the historical stop condition — one pixel of
   * overlap satisfies it. Set this whenever the next step measures the element
   * (a rect assert, a screenshot): a clipped rect measures the clipped box.
   */
  fully?: boolean;
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
            fully: z.boolean().optional(),
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
            package: z
              .string()
              .regex(/^[A-Za-z0-9_.]+$/, 'app.android.package must be a package name (letters, digits, dot, underscore)'),
            apk: z.string().optional(),
            /**
             * Entry activity for launches that name neither an activity nor an
             * intent (".MainActivity" or fully-qualified; see resolveLaunchActivity).
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
             * 2026-08-12, docs/plans/ios-wda-tree-source.md §Problem). The
             * same goes for a native SwiftUI identifier on a container
             * (`.accessibilityElement(children: .contain)`, measured
             * 2026-10-05) — a `wait:` on one under idb says so when it
             * times out (flow/engine.ts waitTimeoutHint).
             * No `auto` value — deferred until the Phase 4 latency
             * measurement of /source on deep trees. The kinds are the
             * tree-source seam's (adapters/ios-node.ts), spelled once.
             */
            treeSource: z.enum(IOS_TREE_SOURCE_KINDS).optional(),
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
             * ladder's recovery pass (`flowIsDestructive`, below) and makes the
             * ladder warn before running it (`flowItselfIsDestructive`). It is
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

/** What a launch call says about its entry point — a flow `launch:` step or a `launch_app` call. */
export interface LaunchEntry {
  platform: Platform;
  appId: string;
  activity?: string;
  intent?: LaunchIntent;
}

/**
 * WHEN a launch falls back to averi.yaml's `app.android.activity`: on
 * android, and only when the caller named NEITHER an activity NOR an intent.
 *
 * Exported beside the rule below for the one caller that has to know the
 * answer before it has a config: `launch_app` (run/commands.ts) loads
 * averi.yaml only when the fallback can apply. Everyone else calls
 * `resolveLaunchActivity`, which asks this itself.
 */
export function launchConsultsConfigActivity({ platform, activity, intent }: Omit<LaunchEntry, 'appId'>): boolean {
  return platform === 'android' && activity === undefined && intent === undefined;
}

/**
 * The activity a launch starts: the one the caller names, else — when the
 * caller names neither an activity nor an intent — averi.yaml's
 * `app.android.activity`, and only for the very package the config
 * describes. Not android, no config, another package, no activity
 * configured, or an intent given → `undefined`, and the adapter's own rule
 * applies: `monkey -c LAUNCHER` with nothing named (documented on the schema
 * field above), the intent scoped to the package (`am start -p`) with an
 * intent.
 *
 * One owner since 2026-10-03. The rule was written twice — in the flow
 * engine's `launch` step and in the MCP `launch_app` handler — and the
 * handler's copy sat in a module no test could import (review 2026-08-14,
 * S1). Both now call this. The engine's app id always IS the config's
 * package, so the comparison is vacuous there; it is kept in the one place
 * rather than split into "with check" and "without", because a second
 * variant is how the two copies came to exist.
 *
 * Decided 2026-10-03 (owner): an intent without an activity is delivered
 * WITHIN THE APP'S PACKAGE, and the config activity stays out of it — for
 * the flow step and for `launch_app` alike. Until then WHEN the fallback
 * was consulted stayed with each caller, and the two disagreed:
 *
 * - a flow step consulted it whenever the step named no activity, even
 *   beside an `intent` → `am start -n <package>/<config activity> -a ACTION`:
 *   the intent was forced onto the launcher activity, which defeats the one
 *   reason to write an intent — exercising a NON-launcher entry point;
 * - `launch_app` skipped it beside an intent, and the adapter then sent
 *   `am start -a ACTION` with no package at all: an implicit intent the
 *   system may resolve to another app, or to a chooser.
 *
 * Neither was right. The "when" is now `launchConsultsConfigActivity` above
 * (the tool's old "when", for both), and the Android adapter scopes an
 * activity-less intent to the package, so Android's own intent resolution
 * picks the activity whose filter matches — and fails loudly when none does
 * (adapters/android.ts#launch).
 *
 * Rejected: keeping the flow rule and documenting it. A flow that WANTS the
 * intent on a particular activity says so with `activity:` on the step,
 * which is explicit and survives a change of `app.android.activity`; the
 * silent fallback made "which activity got this intent" depend on a config
 * key written for a different purpose (pinning the launcher against
 * LeakCanary). Rejected too: resolving the activity ourselves (`cmd package
 * query-activities`) and passing `-n` — a second resolver beside Android's.
 *
 * Who is affected: a flow whose `launch:` step has an `intent` and no
 * `activity`, in a project that sets `app.android.activity`. To get the old
 * behaviour back, write `activity:` on that step.
 */
export function resolveLaunchActivity(cfg: AveriConfig | undefined, entry: LaunchEntry): string | undefined {
  if (!launchConsultsConfigActivity(entry)) return entry.activity;
  const android = cfg?.app.android;
  return android?.package === entry.appId ? android.activity : undefined;
}

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
 *
 * That transitive answer is the right one for a re-run and the wrong one for
 * the pre-flight warning the ladder prints before each rung; that line uses
 * `flowItselfIsDestructive` below. The two must not be merged again.
 */
export function flowIsDestructive(
  cfg: AveriConfig,
  name: string,
  stack: Set<string> = new Set(),
): boolean {
  const flow = cfg.flows[name];
  if (flow === undefined || stack.has(`flow:${name}`)) return true;
  if (bodyIsDestructive(flow)) return true;
  const next = new Set(stack).add(`flow:${name}`);
  return flow.requires !== undefined && stateReachIsDestructive(cfg, flow.requires, next);
}

function stateReachIsDestructive(cfg: AveriConfig, name: string, stack: Set<string>): boolean {
  if (stack.has(`state:${name}`)) return true;
  const next = new Set(stack).add(`state:${name}`);
  return (cfg.states[name]?.reach ?? []).some((flow) => flowIsDestructive(cfg, flow, next));
}

/**
 * Is this flow's OWN body unrepeatable — `launch { clearState: true }`
 * anywhere in its steps, or `destructive: true` (which also covers what a
 * static walk cannot see: a logout, a one-shot SMS code, a server-side
 * delete)? `requires` is deliberately NOT followed: that is the whole
 * difference from `flowIsDestructive`.
 *
 * Still conservative in one direction: `stepsAreDestructive` walks BOTH
 * platform-override arms, so a `clearState` under `android:` alone also
 * warns on iOS. Not fixed here — it needs the platform passed in.
 *
 * The two answer different questions. The recovery pass asks "may this rung
 * be re-run", and a rung that might pull a wipe in through `requires` may
 * not, so there the transitive answer is right. The reach ladder's pre-flight
 * line asks "is the rung about to run unrepeatable", and prints it as a
 * fact. For a flow whose `requires` leads to a `clearState` login the
 * transitive answer is only a fact when the required state is NOT already
 * active — a check the engine has not made when the line prints. Measured
 * 2026-10-05: every navigation flow in a config where every flow requires a
 * logged-in state printed the warning on every call, one line before
 * "already active". The sentence that exists to be read on the one call that
 * wipes was on all of them.
 *
 * The escalation case loses nothing: when `requires` is not met, the nested
 * ensureState ladder runs its own rungs through the same pre-flight check,
 * so the warning lands on the rung that actually wipes, immediately before
 * it does.
 *
 * An unknown flow is NOT destructive here — the opposite of the re-run gate,
 * on purpose. "Cannot prove it is safe" lands on "do not re-run" because a
 * skipped recovery is merely slower, but a warning is a statement, and "this
 * rung wipes app state" about a flow that cannot run (`runFlowInner` throws
 * SetupError before any step) would be a false one — the very thing this
 * predicate exists to stop. In practice the case is unreachable from a parsed
 * config: `validateReferences` rejects a `reach` naming an unknown flow.
 */
export function flowItselfIsDestructive(cfg: AveriConfig, name: string): boolean {
  const flow = cfg.flows[name];
  return flow !== undefined && bodyIsDestructive(flow);
}

/** The one definition of "own body" both predicates above share. */
function bodyIsDestructive(flow: AveriConfig['flows'][string]): boolean {
  return flow.destructive === true || stepsAreDestructive(flow.steps);
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
 *
 * Since 2026-10-04 that cost is not paid silently either: `SAFE_LEAVES` must
 * name every kind of Step that is neither `launch` nor a container, or `tsc`
 * fails (the `satisfies` below). A new kind forces the one decision this walk
 * exists to make — safe to repeat, or not — at compile time, where before it
 * was made by omission (architecture review 2026-10-04, C4's one-line residue).
 */
type StepKind = Step extends infer S ? (S extends unknown ? keyof S : never) : never;
/**
 * The kinds `childSteps` descends into — the platform override counts twice,
 * once per key. A NEW CONTAINER GOES HERE AND IN `childSteps`, NEVER IN
 * `SAFE_LEAVES`: the compile error a new kind raises asks for a name in the
 * leaf list, and `repeat: true` there would class a `clearState` nested in a
 * `repeat:` as safe to re-run — the fail-unsafe answer to a check that exists
 * to make the decision explicit. tests/flow/config.test.ts pins that every
 * kind named here is one `childSteps` descends into, so the two lists cannot
 * drift apart.
 */
export type ContainerKind = 'branch' | 'optional' | 'android' | 'ios';
/** Every leaf kind a flow may repeat without consequence; `launch` decides for itself. Containers never belong here (see ContainerKind). */
const SAFE_LEAVES = {
  tap: true,
  type: true,
  type_pin: true,
  swipe: true,
  scroll_until: true,
  fill: true,
  assert: true,
  wait: true,
} as const satisfies Record<Exclude<StepKind, 'launch' | ContainerKind>, true>;

function stepsAreDestructive(steps: Step[]): boolean {
  return steps.some((step) => {
    if ('launch' in step) return step.launch.clearState === true;
    const children = childSteps(step);
    if (children !== undefined) return stepsAreDestructive(children);
    return !Object.keys(step).some((kind) => Object.hasOwn(SAFE_LEAVES, kind));
  });
}

/** Cross-reference checks zod can't express: state/flow names must exist. */
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
