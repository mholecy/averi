import type { UiNode } from '../adapters/types.js';
import { describeElementSpec, type ElementSpec } from '../ui-tree/element-spec.js';
import { findBySpec } from '../ui-tree/selectors.js';
import { absenceVerdict, presenceVerdict, type Verdict } from '../ui-tree/verdict.js';

/**
 * Everything asked OF an averi.yaml `Condition` — a state's `detect:`, a
 * `wait:`, a `branch:` arm's `when:` — in one module: how it is evaluated
 * against one tree, how it is named in a trace, and which states it refers
 * to. One evaluator, so "a bare tree is not knowledge" holds for every caller
 * and for a tree that matches as well as one that misses: an `absent: true`
 * condition on a cold launch's decor must not answer "yes" to the detect,
 * the wait or the branch.
 *
 * The answer is three-valued (ui-tree/verdict.ts: `yes` / `no` / `unknown`,
 * the last meaning "this tree is bare and cannot decide it"), and each
 * caller picks its own policy — none of them treats `unknown` as `yes`:
 * - the detect probe (FlowEngine `detects`) counts a round that is not `yes`
 *   on a bare tree as bare, so the ladder's unread handling (the second
 *   look, the never-wipes-blind refusal, "could not be checked") covers an
 *   absent detect as it covers a miss;
 * - `wait:` and `branch:` keep polling on `unknown` as on `no` (a `branch:`
 *   takes an arm only when every arm before it is `no` — an earlier
 *   `unknown` might win once the screen renders), and a timeout whose last
 *   tree was bare says so (ui-tree/verdict.ts `bareTimeoutNote`);
 * - the absent assert (verify/assert.ts) asks the leaf rule directly — it
 *   cannot import this module (`verify/` is below `flow/`) and has no
 *   combinators to share.
 *
 * `any:` and `all:` combine in Kleene's three-valued logic: `any` is `yes`
 * if some arm is `yes`, else `unknown` if some arm is `unknown`, else `no`;
 * `all` is `no` if some arm is `no`, else `unknown` if some arm is
 * `unknown`, else `yes`. Each stops at the first arm that settles it (`yes`
 * for any, `no` for all) — the order the arms are written in, so an arm
 * after the deciding one is never asked (no viewport read, no nested
 * state). `{ state: x }` is `states.x.detect` on the same tree with the same
 * semantics; parseConfig has already refused a cycle among those (config.ts
 * rejectDetectCycles, over `conditionStateRefs` below).
 */

/**
 * One averi.yaml condition: exactly one of `element`, `state`, `any`, `all`
 * (the schema is flow/config.ts's, which re-exports this type). Here so the
 * module graph is config → condition only.
 */
export interface Condition {
  element?: ElementSpec;
  /**
   * `absent: true` beside `element` inverts the check — element gone or
   * off-viewport; on a BARE tree neither, but undecided.
   */
  absent?: boolean;
  state?: string;
  any?: Condition[];
  all?: Condition[];
}

export interface ConditionContext {
  /**
   * The detect of a state a `{ state }` condition names. The engine's lookup
   * throws its SetupError for an unknown name — a config parseConfig did not
   * validate — so this module imports nothing from config.ts (which
   * imports `conditionStateRefs` from here).
   */
  detectOf(state: string): Condition;
  /** Asked only when an `absent` leaf is reached. The adapter memoizes it (adapters/types.ts): one device read per adapter. */
  viewport(): Promise<{ width: number; height: number }>;
}

/** Evaluate `cond` against one tree. Never reads the device but for the viewport, and only for an `absent` leaf. */
export async function evaluateCondition(cond: Condition, tree: UiNode, ctx: ConditionContext): Promise<Verdict> {
  if (cond.element) {
    const found = findBySpec(tree, cond.element);
    return cond.absent ? absenceVerdict(found, await ctx.viewport(), tree) : presenceVerdict(found, tree);
  }
  if (cond.state !== undefined) return evaluateCondition(ctx.detectOf(cond.state), tree, ctx);
  if (cond.any) return combine(cond.any, 'yes', tree, ctx);
  if (cond.all) return combine(cond.all, 'no', tree, ctx);
  // The schema requires exactly one of the four; an empty object cannot parse.
  return 'no';
}

/**
 * Kleene's any (`decisive` = yes) or all (`decisive` = no). The truth tables
 * are pinned through evaluateCondition on one bare tree holding all three
 * answers (tests/flow/condition.test.ts).
 */
async function combine(arms: Condition[], decisive: 'yes' | 'no', tree: UiNode, ctx: ConditionContext): Promise<Verdict> {
  let unknown = false;
  for (const arm of arms) {
    const v = await evaluateCondition(arm, tree, ctx);
    if (v === decisive) return decisive;
    if (v === 'unknown') unknown = true;
  }
  return unknown ? 'unknown' : decisive === 'yes' ? 'no' : 'yes';
}

export function describeCondition(cond: Condition): string {
  if (cond.element) return `element ${describeElementSpec(cond.element)}`;
  if (cond.state) return `state ${cond.state}`;
  if (cond.any) return `any(${cond.any.map(describeCondition).join(', ')})`;
  if (cond.all) return `all(${cond.all.map(describeCondition).join(', ')})`;
  return '(empty)';
}

/**
 * Every state a condition names, at any depth of `any:`/`all:` — the one walk
 * over Condition's nesting, as `childSteps` is over Step's, so a combinator
 * added to Condition later is followed by every check that walks it or by
 * none — and, since it lives beside `evaluateCondition`, by the evaluator in
 * the same edit.
 */
export function conditionStateRefs(c: Condition): string[] {
  return [
    ...(c.state !== undefined ? [c.state] : []),
    ...[...(c.any ?? []), ...(c.all ?? [])].flatMap(conditionStateRefs),
  ];
}

/**
 * Does judging `c` ask whether something is ABSENT — an `absent: true` leaf at any depth, through the states it
 * names (`detectOf`, the evaluator's own lookup)? The flow engine hands a read on to a detect only when it does not
 * (docs/adr/0030-a-read-is-handed-on-only-as-a-first-sample-or-a-positive-verdict.md): a `yes` that rests on an
 * absence in a tree read earlier says the element was gone THEN, and a late prompt is exactly what a fresh read is
 * for. Static, so a leaf that would not decide this tree still counts: the rule is about what the condition may rest
 * on. Terminates: config.ts rejects detect cycles before any engine runs.
 */
export function asksAbsence(c: Condition, detectOf: (state: string) => Condition): boolean {
  if (c.element !== undefined) return c.absent === true;
  if (c.state !== undefined) return asksAbsence(detectOf(c.state), detectOf);
  return [...(c.any ?? []), ...(c.all ?? [])].some((arm) => asksAbsence(arm, detectOf));
}
