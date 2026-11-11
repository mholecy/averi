import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { LaunchIntent, Platform, Rect } from '../adapters/types.js';
import { DEFAULT_IOS_TREE_SOURCE, IOS_TREE_SOURCE_KINDS, type IosTreeSourceKind } from '../adapters/ios-node.js';
import {
  elementSpecObject,
  elementSpecSchema,
  hasSelector,
  type ElementSpec,
} from '../ui-tree/element-spec.js';
import { INTERACTIVE_ROLES } from '../ui-tree/selectors.js';
import { durationSchema } from '../util/duration.js';
import { elementAssertSchema, type ElementAssert } from '../verify/element-assert.js';
import type { KeyboardDismissal } from '../interact/keyboard.js';
import { conditionStateRefs, type Condition } from './condition.js';

/**
 * Schema for `averi.yaml` flow descriptors (ARCHITECTURE.md §4), the types it
 * infers, and the pure walks over them (reference validation, the container
 * and destructive-flow rules, the launch-activity rule). Nothing here reads a
 * file or the environment: loading is flow/load.ts, credentials are
 * flow/credentials.ts (split 2026-10-04, architecture review C2/C6 — this
 * file had grown from five responsibilities to seven and held the one
 * `process.env` write in the layer).
 */

// Condition — the type and everything asked of it — lives in flow/condition.ts
// since 2026-10-08; re-exported here with the rest of the schema's types.
export type { Condition } from './condition.js';

interface FillSpec extends ElementSpec {
  value: string;
  /** Delete the field's current content before typing (opt-in: pre-filled login fields must survive). */
  clear?: boolean;
  dismissKeyboard?: boolean;
}

/**
 * One entry of `app.ios.keyboardDismiss` (stage B, 2026-10-07): how the
 * guard may hide the iOS soft keyboard when it covers a tap target, and how
 * `fill { dismissKeyboard: true }` hides it after typing. Either a `tap` on
 * an element of the app's that hides the keyboard without a side effect —
 * the screen title was measured to (docs/bugs/2026-10-05-ios-tap-lands-on-
 * soft-keyboard.md, K5b) — or `accessory: true`, the input-accessory
 * toolbar's trailing button (the app's "Done" above a number pad, K4). The
 * list is ordered: the first entry whose element is on screen is used, and
 * — since 2026-10-18 — the next one when that left the keyboard up. Once an
 * entry WAS tapped and left the keyboard up, the guard follows it with
 * averi's own fallback, an upward drag of the target's scroll view
 * (docs/adr/0022-averi-hides-the-keyboard-when-the-configured-dismissal-does-not.md);
 * an entry that is not on screen, or none at all, moves nothing.
 * Opt-in and app-specific on purpose: which element is neutral is the
 * app's business, and the keyboard's own return key SUBMITS (K5d). A `tap`
 * must resolve to a NON-INTERACTIVE element: the guard drops interactive
 * matches (interact/keyboard-dismissal.ts#configuredStrategy — a title and a button sharing
 * a label must never tap the button), and a spec that names an interactive
 * `role:` outright is refused at parse time, where the author reads it.
 */
type KeyboardDismissStrategy = { tap: ElementSpec } | { accessory: true };

/**
 * `app.ios.keyboardDismiss` set where it cannot act (review round 1): the
 * idb tree marks no node as the keyboard — every reader keys on
 * `KEYBOARD_ROLE` (ui-tree/soft-keyboard.ts), which only the WDA parser
 * assigns (wda-source.ts#keyboardMarks) and the idb parser never does — so
 * under `treeSource: idb` — the default — no guard dismisses anything and
 * the list is inert. What the tap does refuse there is a centre under idb's
 * band, read by its shape (ADR 0006, keyboard-position.ts#KeyboardPosition.line);
 * the sentence says so, since "no tap is ever refused" (until 2026-10-13)
 * stopped being true with that decision. NOT "the idb tree carries no keyboard"
 * (the sentence until 2026-10-09): on iOS 27 idb lists the keys, as plain
 * `button`s ('Q' … 'return'), and the band, as an unmapped type read as
 * `other` (0,590 402×284 on Contacts' "New Contact"; docs/bugs/2026-10-09-
 * ios-inert-keyboard-dismiss-note-says-idb-carries-no-keyboard.md), so a
 * reader who checks `ui_snapshot` sees them — the reason is that nothing
 * marks them, not that they are absent. Marking them under idb is a
 * separate step. The sentence the loader prints once per config
 * (flow/load.ts), so a project that set the key and forgot the tree source
 * is told at load time rather than by a tap that went into the keys
 * (measured once, iOS 27, on one form — docs/bugs/2026-10-08-scroll-until-
 * ignores-android-soft-keyboard.md §3: a covered target was absent from the
 * idb tree and the tap timed out waiting for it to appear; a target only
 * partly covered is presumably kept with its rect, and its centre can lie
 * under the keys — inferred, not measured). Pure: config in, sentence or nothing out.
 */
export function inertKeyboardDismissNote(cfg: AveriConfig): string | undefined {
  const ios = cfg.app.ios;
  if (ios?.keyboardDismiss === undefined) return undefined;
  const kind = ios.treeSource ?? DEFAULT_IOS_TREE_SOURCE;
  if (kind === 'wda') return undefined;
  return (
    `app.ios.keyboardDismiss is set but app.ios.treeSource is ${kind}${ios.treeSource === undefined ? ' (the default)' : ''}: ` +
    `the ${kind} tree marks no node as the keyboard (on iOS 27 it lists the keys, as plain buttons), so no guard hides it before a tap and the list is inert (a tap whose centre lies under its band, read by shape, is refused instead) — set treeSource: wda for it to apply`
  );
}

export interface TapSpec extends ElementSpec {
  /**
   * Overrides the engine's tap budget (find + settle; default 5s) — for
   * elements that render slowly enough that a `wait:` step used to have to
   * babysit the tap. Inside `optional:` it overrides the PRESENCE-CHECK
   * window (default 1.5s) instead: how long a maybe-interstitial gets to
   * appear before the step is skipped "(not present)" — interact's
   * ElementNotFoundError, the one failure an optional step logs that way. Note
   * the cost: an optional tap burns this full window whenever the element
   * never shows — when the alternative screen is detectable, a state with
   * `any:` over both outcomes plus `branch:` exits immediately either way
   * and stays the better idiom.
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
  /**
   * The scroll view the swipes go over until the element is first read (D81; interact/within.ts): an element spec of
   * it or of an element inside it (the scroll view of its very rect, else its nearest). Resolved and refused as the
   * MCP tool's `within` is. No rect — device-specific (`WITHIN_NO_RECT`). Default: the screen's largest scroller.
   */
  within?: ElementSpec;
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

/**
 * See KeyboardDismissStrategy. One object with both keys optional and
 * exactly one required, rather than a `z.union` of the two shapes (review
 * round 1): a union reports every bad entry as one bare "Invalid input" at
 * `keyboardDismiss.0`, where this form keeps each field's own message and
 * path — `tap` needs a selector, `tap` must not name an interactive role,
 * `accessory` takes only true, and the entry needs one of the two. The
 * transform narrows the parsed object back to the union the type promises.
 */
const keyboardDismissStrategy = z
  .object({
    tap: elementSpecObject
      .refine(hasSelector, { message: 'tap needs at least one of: id, text, role, label' })
      .refine((s) => s.role === undefined || !INTERACTIVE_ROLES.has(s.role), {
        message: `a keyboard dismissal must be a non-interactive element (a title, a label) — role: ${[...INTERACTIVE_ROLES].join('/')} names a control the tap would press`,
      })
      .optional(),
    accessory: z
      .literal(true, { errorMap: () => ({ message: 'accessory takes only true (the entry is opt-in; false reads like an override and would be none)' }) })
      .optional(),
  })
  .strict()
  .refine((e) => (e.tap === undefined) !== (e.accessory === undefined), {
    message: 'each entry is { tap: <element spec> } or { accessory: true }',
  })
  .transform((e): KeyboardDismissStrategy => (e.tap !== undefined ? { tap: e.tap } : { accessory: true }));

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

/** A rect's sides — the MCP `scroll_until`'s other form of `within`, which a flow's refuses (D81). */
const RECT_SIDES = ['x', 'y', 'width', 'height'] as const satisfies readonly (keyof Rect)[];

/**
 * Why a flow's `within` takes no rect, said where one is given: a rect is one device's layout, a flow runs on
 * others.
 */
const WITHIN_NO_RECT = 'within takes an element spec (id, text, role, label) of the scroll view or of an element inside it, not a rect: a rect is device-specific';

/** Why a flow's `within` takes no selector string, the MCP tool's other form: a flow names an element by spec. */
const WITHIN_NO_STRING = 'within takes an element spec ({ id: … }), as the step\'s element does, not a selector string';

/**
 * A flow's `scroll_until` `within` (D81): the step's own `element` vocabulary, an element spec. The MCP tool's two
 * other forms are refused naming why — anything carrying a rect's side (`WITHIN_NO_RECT`), a selector string
 * (`WITHIN_NO_STRING`) — as the issue alone: the pipe stops at it, so the spec's "Unrecognized key(s)" is not said
 * beside it. Anything else is the element spec schema's to judge.
 */
const withinSpec: z.ZodType<ElementSpec> = z
  // `any`, not `unknown`: the step's input type is `Step`, so its `within` must read as a spec on the way in too.
  .any()
  .superRefine((v, ctx) => {
    if (typeof v === 'string') ctx.addIssue({ code: z.ZodIssueCode.custom, message: WITHIN_NO_STRING });
    else if (typeof v === 'object' && v !== null && RECT_SIDES.some((side) => Object.hasOwn(v, side))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: WITHIN_NO_RECT });
    }
  })
  .pipe(elementSpecSchema);

/**
 * The platform override's keys, the source of PlatformKey (and through it of ContainerKind): a step of one or both of
 * them is the override, `{ android?: Step; ios?: Step }`. A tuple the type is read from, so the two cannot differ.
 */
const PLATFORM_KEYS = ['android', 'ios'] as const;
type PlatformKey = (typeof PLATFORM_KEYS)[number];
const isPlatformKey = (k: string): k is PlatformKey => (PLATFORM_KEYS as readonly string[]).includes(k);

/** A step nested in a container — `branch`'s arms, `optional`, a platform override — judged as any step is. */
const nestedStep: z.ZodType<Step> = z.lazy(() => step);

/**
 * Every step kind but the platform override, by its one key: the schema of the value under that key. `tsc` holds it
 * to Step (the `satisfies`): a key for every kind, and each schema yields what its Step member holds under that key,
 * so a kind added to Step, or one whose schema drifts from its type, fails to compile.
 */
const STEP_KINDS = {
  launch: z
    .object({
      clearState: z.boolean().optional(),
      activity: z.string().optional(),
      intent: launchIntent.optional(),
    })
    .strict(),
  tap: elementSpecObject
    .extend({ timeout: durationSchema.optional() })
    .refine(hasSelector, { message: 'tap needs at least one of: id, text, role, label' }),
  type: z.object({ value: z.string() }).strict(),
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
  swipe: z
    .object({
      direction: z.enum(['up', 'down', 'left', 'right']),
      times: z.number().int().min(1).optional(),
    })
    .strict(),
  scroll_until: z
    .object({
      element: elementSpecSchema,
      direction: z.enum(['up', 'down', 'left', 'right']).optional(),
      maxSwipes: z.number().int().min(1).optional(),
      fully: z.boolean().optional(),
      timeout: durationSchema.optional(),
      within: withinSpec.optional(),
    })
    .strict(),
  fill: elementSpecObject
    .extend({
      value: z.string(),
      clear: z.boolean().optional(),
      dismissKeyboard: z.boolean().optional(),
    })
    .refine(hasSelector, { message: 'fill needs at least one of: id, text, role, label' }),
  assert: z.array(elementAssertSchema).min(1),
  wait: z
    .object({
      element: elementSpecSchema.optional(),
      state: z.string().optional(),
      timeout: durationSchema.optional(),
    })
    .strict()
    .refine((w) => (w.element === undefined) !== (w.state === undefined), {
      message: 'wait needs exactly one of: element, state',
    }),
  branch: z.array(z.object({ when: condition, do: z.array(nestedStep) }).strict()).min(1),
  optional: z.array(nestedStep).min(1),
} satisfies {
  [K in Exclude<StepKind, PlatformKey>]: z.ZodType<Extract<Step, Record<K, unknown>>[K], z.ZodTypeDef, unknown>;
};

const platformOverride: z.ZodType<{ android?: Step; ios?: Step }, z.ZodTypeDef, unknown> = z
  .object({ android: nestedStep.optional(), ios: nestedStep.optional() })
  .strict();

/** What a step may be, said wherever one is not. */
const STEP_ONE_OF = `one of: ${Object.keys(STEP_KINDS).join(', ')}, or a platform override (android and/or ios)`;

/**
 * How a step is judged: the schema, what it parses (the step itself, or the value under its key), where its issues sit
 * under the step (`[]`, or `[key]`), and how its result becomes the step again — or why no schema judges it.
 */
type StepRoute =
  | { schema: z.ZodTypeAny; input: unknown; path: string[]; wrap: (data: unknown) => Step }
  | { refused: string };

/** The platform override's route: the step parsed whole, its issues at the step, its result the step. */
const overrideRoute = (v: unknown): StepRoute => ({
  schema: platformOverride,
  input: v,
  path: [],
  wrap: (data) => data as Step,
});

/**
 * Which schema judges this step, picked by its one key — or why none does. A step is a mapping of exactly one key
 * that names its kind, or of `android` and/or `ios` (the platform override).
 */
function routeStep(v: unknown): StepRoute {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return { refused: `a step is a mapping of one key, ${STEP_ONE_OF} — received ${z.getParsedType(v)}` };
  }
  const keys = Object.keys(v);
  const others = keys.filter((k) => !isPlatformKey(k));
  if (keys.length > 0 && others.length === 0) return overrideRoute(v);
  // Beside a platform key, the one other key that is no kind either: a misspelt platform (`iOS`) or a misspelt step.
  if (others.length === 1 && keys.length > 1 && !Object.hasOwn(STEP_KINDS, others[0])) {
    const odd = others[0];
    return { refused: `unknown key '${odd}' beside a platform override: a platform override takes android and/or ios` };
  }
  if (keys.length !== 1) {
    const has = keys.length === 0 ? 'none' : `${keys.length}: ${keys.join(', ')}`;
    return { refused: `a step has exactly one key, ${STEP_ONE_OF}; this one has ${has}` };
  }
  const [key] = keys;
  if (!Object.hasOwn(STEP_KINDS, key)) return { refused: `unknown step '${key}': a step is ${STEP_ONE_OF}` };
  return {
    schema: STEP_KINDS[key as keyof typeof STEP_KINDS],
    input: (v as Record<string, unknown>)[key],
    path: [key],
    wrap: (data) => ({ [key]: data }) as Step,
  };
}

/**
 * A step, judged by its one key (D86): the kind it names parses the value under that key, and the kind's own issues
 * are said with their path — `steps.3.scroll_until.within.id: Expected string, received number`. Until D86 the step
 * was a `z.union` of every kind, and a wrong type inside a step's object collapsed to the union's bare
 * "Unrecognized key(s) in object: 'scroll_until'" at the step: when every member fails, zod's union reports the first
 * member that failed only softly, and that was the platform override, the last member — its fields all optional, it
 * failed on the unknown key alone — never the member the step's key named. A discriminated union needs a literal
 * field to pick by, which a one-key step lacks — so the key is found here, and the step's shape (no key, several, an
 * unknown one, no mapping at all) is refused in words of its own.
 *
 * A check over a whole step belongs in validateReferences, never as a refine over this schema or a container of it: a
 * refused step's value here is z.NEVER, and a refine further up would still be handed it.
 */
const step: z.ZodType<Step> = z
  // `any`, not `unknown`: a container's schema (`optional`, `branch`'s `do`) must read as Step[] on the way in too.
  .any()
  .transform((v: unknown, ctx): Step => {
    const route = routeStep(v);
    if ('refused' in route) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: route.refused });
      return z.NEVER;
    }
    const parsed = route.schema.safeParse(route.input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: [...route.path, ...issue.path] });
      return z.NEVER;
    }
    return route.wrap(parsed.data);
  });

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
             * intent (".MainActivity" or fully-qualified; see flow/launch.ts#resolveLaunchActivity).
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
             * 2026-10-05) — a `wait:` or a `scroll_until` on one under idb
             * says so when it gives up (ui-tree/miss.ts, `idUnlisted`).
             * No `auto` value — deferred until the Phase 4 latency
             * measurement of /source on deep trees. The kinds are the
             * tree-source seam's (adapters/ios-node.ts), spelled once.
             */
            treeSource: z.enum(IOS_TREE_SOURCE_KINDS).optional(),
            /**
             * How to hide the soft keyboard when it covers a tap target, in
             * order of preference (stage B, 2026-10-07; see
             * KeyboardDismissStrategy). Without it a covered target is
             * refused (stage A) and `fill { dismissKeyboard: true }` leaves
             * the keyboard up with a warning. Read under every tree source,
             * but inert under `treeSource: idb` — idb's tree marks no node
             * as the keyboard (on iOS 27 it lists the keys, as plain
             * buttons, and the band, as `other`), so nothing is ever
             * covered or dismissed there (the loader says so on stderr:
             * inertKeyboardDismissNote).
             */
            keyboardDismiss: z.array(keyboardDismissStrategy).min(1).optional(),
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

/**
 * The app averi.yaml names for a platform — `app.android.package` or `app.ios.bundleId` — or undefined when it names
 * none. One owner (A29) for the flow's `launch:` step (flow/engine.ts) and the health line (run/app-health.ts).
 */
export const appIdOf = (cfg: AveriConfig, platform: Platform): string | undefined => {
  const app = cfg.app[platform];
  if (app === undefined) return undefined;
  return 'package' in app ? app.package : app.bundleId;
};

/**
 * `app.ios.keyboardDismiss` in the interaction module's vocabulary
 * (interact/keyboard.ts#KeyboardDismissal) — the one conversion, done once
 * per engine (FlowEngine's constructor) and once per config-optional tool
 * call (flow/tool-config.ts#iosToolSettings), so no config type crosses into
 * interact/ and no interact type is spelled in YAML. `undefined` when the
 * config, its iOS section or the key is absent: the guard then has nothing
 * to tap, exactly stage A. Not platform-gated here: the engine passes it to
 * every tap and fill, and interact/ reads it only on the oracle-less
 * branch, which Android never takes — the same shape as `treeSource`, which
 * the registry reads for the iOS adapter only.
 */
export function keyboardDismissals(cfg: AveriConfig | undefined): readonly KeyboardDismissal[] | undefined {
  const configured = cfg?.app.ios?.keyboardDismiss;
  if (configured === undefined) return undefined;
  return configured.map((s): KeyboardDismissal => ('tap' in s ? { kind: 'tap', target: s.tap } : { kind: 'accessory' }));
}

/**
 * The one parse of an averi.yaml text — every loader (flow/load.ts's
 * loadConfig and loadConfigIfPresent, and through them loadProjectConfig and
 * flow/tool-config.ts#loadForCall) comes through here, so every way a file
 * can be broken is said in one shape, `Invalid <source>: …`, naming the file.
 *
 * Until 2026-10-08 only a SCHEMA failure was: a YAML syntax error escaped as
 * the bare library message ("Block collections are not allowed within flow
 * collections at line 99, column 5: …") with no file in it. That mattered
 * more once the config-policy table made a broken file fail every call that
 * reads it — an Android assert or launch_app, an iOS tree tool — and promised
 * the failure names the file (found by the device check). The library's
 * message is kept whole (line, column, the excerpt), and the error itself is
 * the `cause`.
 */
export function parseConfig(yamlText: string, source = 'averi.yaml'): AveriConfig {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    throw new Error(`Invalid ${source}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
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
 * counts as destructive (an unknown flow cannot survive `parseConfig`, but
 * this takes any AveriConfig; a `requires` cycle can, and the engine refuses
 * it at run time only when no state on it is on screen). The only thing
 * it gates is whether a rung may be re-run in the recovery pass, so "cannot
 * prove it is safe" must land on the side of not re-running it — that is
 * exactly the pre-recovery behaviour,
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
 * The escalation case loses nothing: when `requires` is not met, the required
 * state's ladder runs its own rungs through the same pre-flight check,
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
 * drift apart. Its schema goes in `STEP_KINDS` (the step's key routes to it);
 * the platform keys come from `PLATFORM_KEYS`, so a new container is never a
 * platform by accident.
 */
export type ContainerKind = 'branch' | 'optional' | PlatformKey;
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

/**
 * Cross-reference checks zod can't express: state/flow names must exist, and
 * no state's detect may lead back to itself (rejectDetectCycles).
 */
function validateReferences(cfg: AveriConfig, source: string): void {
  const fail = (msg: string): never => {
    throw new Error(`Invalid ${source}: ${msg}`);
  };
  const checkCondition = (c: Condition, where: string): void => {
    const unknown = conditionStateRefs(c).find((ref) => !(ref in cfg.states));
    if (unknown !== undefined) fail(`${where} references unknown state "${unknown}"`);
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
  rejectDetectCycles(cfg, fail);
}

/**
 * A detect cycle is a config error, caught here rather than at run time.
 * Run after the existence checks, so every name below resolves.
 *
 * flow/condition.ts `evaluateCondition` evaluates a `{ state: x }` condition
 * by evaluating `states.x.detect` on the same tree, at any depth of `any:`/`all:`. Nodes
 * are states; `a → b` when `b` appears anywhere in `a`'s detect. A cycle
 * never finishes — it overflows the stack when the cyclic arm is reached
 * synchronously (a pure `{ state }` chain: measured 2026-10-07,
 * `a.detect: { state: b }` ↔ `b.detect: { state: a }` parsed and
 * `ensure_state a` failed with `FlowError: Maximum call stack size
 * exceeded`, and inside a rung's `requires:` that RangeError is not terminal
 * (`isTerminal`), so the outer ladder escalated past it into its next rung),
 * and loops in microtasks until the heap is gone when an element arm is
 * awaited first. An `any:` that would short-circuit before the cyclic arm on
 * some screens is no defence: on every screen where it does not, it never
 * finishes. A flow's `wait: { state }` and `branch: when:` are ROOTS of this
 * graph, never members — a flow is not evaluated by a condition — so a cycle
 * can only lie among states, and checking every state's detect covers those
 * too. Shared references (two states' detects naming one third state) are a
 * DAG: evaluated twice, finished twice.
 *
 * The engine's other recursion — a reach rung ensuring its `requires:`, which
 * may lead back to the state being ensured — is NOT rejected here: the mutual
 * login/logout shape (`logged_in.reach: [login]`, `login.requires:
 * login_screen`, `login_screen.reach: [logout]`, `logout.requires:
 * logged_in`) works from either state on the loop and only loops from a
 * third screen, so it is a runtime condition, and the engine refuses it when
 * it happens (FlowEngine's `ensuring` stack). A path that mixes the two
 * kinds — `a`'s detect naming `b`, `b`'s rung requiring `a` — is no
 * recursion at all.
 */
function rejectDetectCycles(cfg: AveriConfig, fail: (msg: string) => never): void {
  const cycle = findCycle(Object.keys(cfg.states), (state) => conditionStateRefs(cfg.states[state].detect));
  if (cycle !== undefined) {
    fail(
      `states.${cycle[0]}.detect refers back to itself: ${cycle.map((s) => `states.${s}`).join(' → ')} ` +
        "(a { state: … } condition is evaluated through that state's detect, so this one would never finish)",
    );
  }
}

/**
 * The first cycle a depth-first walk from `roots` (in order) meets, as the
 * path from the node it re-enters back to that node — `[a, b, a]`, `[a, a]`
 * for a self-reference — or undefined for a DAG. A node already fully
 * explored is not walked again, so shared references cost one visit.
 */
function findCycle(roots: string[], next: (node: string) => string[]): string[] | undefined {
  const done = new Set<string>();
  const path: string[] = [];
  const visit = (node: string): string[] | undefined => {
    const at = path.indexOf(node);
    if (at !== -1) return [...path.slice(at), node];
    if (done.has(node)) return undefined;
    path.push(node);
    for (const n of next(node)) {
      const cycle = visit(n);
      if (cycle !== undefined) return cycle;
    }
    path.pop();
    done.add(node);
    return undefined;
  };
  for (const root of roots) {
    const cycle = visit(root);
    if (cycle !== undefined) return cycle;
  }
  return undefined;
}
