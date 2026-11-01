import { flowIsDestructive, type AveriConfig } from './config.js';

/**
 * "Is a wipe ahead?" for the reach ladder (docs/adr/0033-a-held-rendered-no-ends-the-second-look-before-a-cheap-rung.md).
 * The second look before a cheap rung may end on a held rendered "no" only when no wipe lies ahead: a loading screen
 * that happens to hold still must not lead to a wipe, and a wipe AFTER the cheap rung is led to as surely as one before
 * it (D2 round-1 review, 2026-10-31: `[dismiss_prompts, fresh_launch]` on a cold launch onto a "Loading" label — the
 * hold ended the look, the cheap rung's re-check read the same screen as a rendered "no" and fresh_launch wiped).
 *
 * "Ahead" is two things:
 * - in the rest of this ladder, the running rung included — TRANSITIVE (flow/config.ts#flowIsDestructive, which follows
 *   `requires:` into other ladders and calls a cycle or an unknown flow destructive), so a `requires:` into a
 *   `clearState` ladder counts. Not `flowItselfIsDestructive`: that one answers the pre-flight warning's narrower
 *   question about the rung's own steps; do not unify the two;
 * - after the running rung of every enclosing ladder: a cheap ladder entered through a rung's `requires:` (`outer:
 *   [via_inner, fresh_launch]`) would otherwise hold, fail its cheap rung on a loading screen, and hand the outer ladder
 *   the same immediate wipe. `running` keeps that count.
 *
 * One per engine run, like the run's other state.
 */
export class WipesAhead {
  /** How many enclosing ladders have a wipe after their running rung. */
  private enclosing = 0;

  constructor(private readonly cfg: AveriConfig) {}

  /** No wipe in rungs[i..] (transitive) and none ahead in any enclosing ladder. */
  noneFrom(rungs: readonly string[], i: number): boolean {
    return this.enclosing === 0 && !this.wipeAmong(rungs.slice(i));
  }

  /** Runs rung i through fn; every ladder entered inside fn sees rungs[i+1..]'s wipes as ahead. Restores on throw. */
  async running<T>(rungs: readonly string[], i: number, fn: () => Promise<T>): Promise<T> {
    const wipeAfter = this.wipeAmong(rungs.slice(i + 1));
    if (wipeAfter) this.enclosing++;
    try {
      return await fn();
    } finally {
      if (wipeAfter) this.enclosing--;
    }
  }

  private wipeAmong(rungs: readonly string[]): boolean {
    return rungs.some((r) => flowIsDestructive(this.cfg, r));
  }
}
