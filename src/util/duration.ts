import { z } from 'zod';

/**
 * Timeouts are written the way a human would in averi.yaml ("15s") and the way
 * a caller would in a tool argument (a number of ms). One parser for both,
 * owned here because every layer needs it — flow steps, assert specs,
 * scroll_until — and none of them owns the notion of a duration.
 */

/** Why `value` is no duration, in the words parseDuration throws and durationSchema refuses with; undefined when it is one. */
function durationIssue(value: string | number): string | undefined {
  const ok = typeof value === 'number' ? Number.isFinite(value) && value >= 0 : DURATION.test(value);
  return ok ? undefined : `Invalid duration ${typeof value === 'number' ? value : `"${value}"`} — use e.g. 500ms, 15s, 2m`;
}

const DURATION = /^(\d+(?:\.\d+)?)(ms|s|m)$/;

/**
 * "15s" | "500ms" | "2m" | number(ms) → ms. A number is ms as it is, and a negative or non-finite one is no duration
 * (A19). Every value that reaches it from averi.yaml or a tool argument passed durationSchema, so there it cannot throw.
 */
export function parseDuration(value: string | number): number {
  const issue = durationIssue(value);
  if (issue !== undefined) throw new Error(issue);
  if (typeof value === 'number') return value;
  const [, n, unit] = DURATION.exec(value) as RegExpExecArray;
  return unit === 'ms' ? Number(n) : unit === 's' ? Number(n) * 1000 : Number(n) * 60_000;
}

/**
 * The one schema of a duration field — every `timeout` of a flow step (tap, scroll_until, wait) and of an assert spec
 * (the MCP `assert` tool's and an `assert:` step's) (A19). A value parseDuration would refuse is refused here, with its
 * message, so averi.yaml fails at load naming the field (`flows.f.steps.0.wait.timeout: Invalid duration "5 sec" — …`)
 * and a tool call fails before a device is bound — never a plain Error mid-flow, which a reach rung would escalate past
 * and an `optional:` would log as skipped. The value is kept as written, not turned into ms: the spec types stay
 * `string | number` for the code and tests that build specs directly, and each consumer converts with parseDuration,
 * which a value that passed here cannot make throw — util/regex.ts#regexSource's shape.
 */
export const durationSchema = z.union([z.number(), z.string()]).superRefine((value, ctx) => {
  const issue = durationIssue(value);
  if (issue !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
});

/**
 * ms → "N s", the way a tool description or a message quotes a budget
 * ("5 s", "0.4 s"). The inverse direction of parseDuration for the one
 * place a default is SHOWN rather than read: the MCP tool descriptions cite
 * each module's exported default through it, so the number an agent reads
 * has the module's constant as its one owner (architecture review
 * 2026-10-07, mcp-surface candidate 3).
 */
export const formatSeconds = (ms: number): string => `${ms / 1000} s`;
