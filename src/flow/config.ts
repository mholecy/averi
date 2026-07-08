import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/** Schema for `averi.yaml` flow descriptors (ARCHITECTURE.md §4). */

export interface ElementSpec {
  id?: string;
  text?: string;
  role?: string;
  label?: string;
}

export interface Condition {
  element?: ElementSpec;
  state?: string;
  any?: Condition[];
  all?: Condition[];
}

export type Step =
  | { launch: { clearState?: boolean } }
  | { tap: ElementSpec }
  | { type: { value: string } }
  | { type_pin: { value: string; keypad?: { id_pattern: string }; twice?: boolean } }
  | { wait: { element?: ElementSpec; state?: string; timeout?: string | number } }
  | { branch: { when: Condition; do: Step[] }[] }
  | { optional: Step[] }
  | { android?: Step; ios?: Step };

export const elementSpecSchema: z.ZodType<ElementSpec> = z
  .object({
    id: z.string().optional(),
    text: z.string().optional(),
    role: z.string().optional(),
    label: z.string().optional(),
  })
  .strict()
  .refine((s) => Object.values(s).some((v) => v !== undefined), {
    message: 'element spec needs at least one of: id, text, role, label',
  });

const condition: z.ZodType<Condition> = z.lazy(() =>
  z
    .object({
      element: elementSpecSchema.optional(),
      state: z.string().optional(),
      any: z.array(condition).optional(),
      all: z.array(condition).optional(),
    })
    .strict()
    .refine((c) => [c.element, c.state, c.any, c.all].filter((v) => v !== undefined).length === 1, {
      message: 'condition must have exactly one of: element, state, any, all',
    }),
);

const timeout = z.union([z.number(), z.string()]);

const step: z.ZodType<Step> = z.lazy(() =>
  z.union([
    z.object({ launch: z.object({ clearState: z.boolean().optional() }).strict() }).strict(),
    z.object({ tap: elementSpecSchema }).strict(),
    z.object({ type: z.object({ value: z.string() }).strict() }).strict(),
    z
      .object({
        type_pin: z
          .object({
            value: z.string(),
            keypad: z.object({ id_pattern: z.string() }).strict().optional(),
            twice: z.boolean().optional(),
          })
          .strict(),
      })
      .strict(),
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
        android: z.object({ package: z.string(), apk: z.string().optional() }).strict().optional(),
        ios: z.object({ bundleId: z.string(), app: z.string().optional() }).strict().optional(),
      })
      .strict(),
    credentials: z.record(z.string()).optional(),
    states: z
      .record(
        z.object({ detect: condition, reach: z.array(z.string()).optional() }).strict(),
      )
      .default({}),
    flows: z
      .record(
        z.object({ requires: z.string().optional(), steps: z.array(step).min(1) }).strict(),
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

export async function loadConfig(path: string): Promise<AveriConfig> {
  return parseConfig(await readFile(path, 'utf8'), path);
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
      if ('branch' in s) {
        s.branch.forEach((arm) => {
          checkCondition(arm.when, where);
          checkSteps(arm.do, where);
        });
      }
      if ('optional' in s) checkSteps(s.optional, where);
      if ('android' in s || 'ios' in s) {
        const o = s as { android?: Step; ios?: Step };
        checkSteps([o.android, o.ios].filter((v): v is Step => v !== undefined), where);
      }
    }
  };
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

/** "15s" | "500ms" | "2m" | number(ms) → ms */
export function parseDuration(value: string | number): number {
  if (typeof value === 'number') return value;
  const m = value.match(/^(\d+(?:\.\d+)?)(ms|s|m)$/);
  if (!m) throw new Error(`Invalid duration "${value}" — use e.g. 500ms, 15s, 2m`);
  const n = Number(m[1]);
  return m[2] === 'ms' ? n : m[2] === 's' ? n * 1000 : n * 60_000;
}
