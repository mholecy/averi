import type { UiNode } from '../adapters/types.js';
import { describeElementSpec, type ElementSpec } from '../ui-tree/element-spec.js';
import { findBySpec } from '../ui-tree/selectors.js';
import { absenceVerdict, presenceVerdict, type Verdict } from '../ui-tree/verdict.js';

/**
 * Everything asked OF an averi.yaml `Condition` — a state's `detect:`, a
 * `wait:`, a `branch:` arm's `when:` — in one module (2026-10-08, flow-engine
 * review candidate 2): how it is evaluated against one tree, how it is named
 * in a trace, and which states it refers to. Until then the evaluation was
 * the engine's private `matches`, a boolean, so "a bare tree is not
 * knowledge" could live only in the one caller that asked (the detect
 * probe), and only of a tree that MISSED: an `absent: true` condition on a
 * cold launch's decor answered "yes" to the detect, the wait and the branch
 * alike. The name and the reference walk lived in engine.ts and config.ts.
 *
 * The answer is three-valued (ui-tree/verdict.ts: `yes` / `no` / `unknown`,
 * the last meaning "this tree is bare and cannot decide it"), and each
 * caller picks its own policy — none of them treats `unknown` as `yes`:
 * - the detect probe (FlowEngine `detects`) counts a round that is not `yes`
 *   on a bare tree as bare, as it did before for a miss, so the ladder's
 *   existing unread handling (the second look, the never-wipes-blind refusal,
 *   "could not be checked") now covers an absent detect too;
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
 * for any, `no` for all) — the order the arms are written in, as before, so
 * an arm after the deciding one is still never asked (no viewport read, no
 * nested state). `{ state: x }` is `states.x.detect` on the same tree with
 * the same semantics; parseConfig has already refused a cycle among those
 * (config.ts rejectDetectCycles, over `conditionStateRefs` below).
 */

/**
 * One averi.yaml condition: exactly one of `element`, `state`, `any`, `all`
 * (the schema is flow/config.ts's, which re-exports this type). Here since
 * 2026-10-08 so the module graph is config → condition only.
 */
export interface Condition {
  element?: ElementSpec;
  /**
   * With element: true inverts the check — element gone or off-viewport; on a
   * BARE tree neither, but undecided (flow/condition.ts, since 2026-10-08).
   */
  absent?: boolean;
  state?: string;
  any?: Condition[];
  all?: Condition[];
}

/** What evaluation needs from outside the tree: a state's detect, and the device's viewport for `absent`. */
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
 * Kleene's any (`decisive` = yes) or all (`decisive` = no): the first arm
 * answering `decisive` decides; otherwise any `unknown` arm makes the whole
 * `unknown`; otherwise every arm answered the other definite value, which is
 * the answer. The truth tables are pinned through evaluateCondition on one
 * bare tree holding all three answers (tests/flow/condition.test.ts).
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

/** `element id:"x"`, `state logged_in`, `any(…)`, `all(…)` — a condition as the trace and the timeouts name it. */
export function describeCondition(cond: Condition): string {
  if (cond.element) return `element ${describeElementSpec(cond.element)}`;
  if (cond.state) return `state ${cond.state}`;
  if (cond.any) return `any(${cond.any.map(describeCondition).join(', ')})`;
  if (cond.all) return `all(${cond.all.map(describeCondition).join(', ')})`;
  return '(empty)';
}

/**
 * Every state a condition names, at any depth of `any:`/`all:` — the one walk
 * over Condition's nesting, as `childSteps` is over Step's. config.ts's
 * existence check and cycle check both read it, so a combinator added to
 * Condition later is followed by both or by neither — and, since it lives
 * beside `evaluateCondition`, by the evaluator in the same edit.
 */
export function conditionStateRefs(c: Condition): string[] {
  return [
    ...(c.state !== undefined ? [c.state] : []),
    ...[...(c.any ?? []), ...(c.all ?? [])].flatMap(conditionStateRefs),
  ];
}
