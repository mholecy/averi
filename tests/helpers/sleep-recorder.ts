import { vi } from 'vitest';

/**
 * The one sleep owner (util/sleep.ts), recorded and not waited on. A test
 * file installs it with
 *   vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));
 * and pins the DELAY SEQUENCE (`sleeps`) rather than a wall clock — a wall
 * clock is a flake, and the real budgets cost whole seconds. Yields a
 * macrotask so a poll that never leaves the microtask queue cannot starve a
 * fake that reacts on a real timer. Under a faked Date (vi.useFakeTimers
 * with Date ONLY — faking setTimeout would hang the yield) each sleep moves
 * the clock by its own length, so a deadline plays out in virtual time,
 * deterministically. One copy (2026-10-05) for the verify, run, mcp and
 * ui-tree/interact tests that touch the deadline loop; before, the capture,
 * assert and run/verify tests each carried their own and had drifted on the
 * clock rule. fill.test.ts and keyboard.test.ts keep a no-yield recorder of
 * their own on purpose (their fakes never react on a timer).
 */
export const sleeps: number[] = [];

export const sleep = async (ms: number): Promise<void> => {
  sleeps.push(ms);
  if (vi.isFakeTimers()) vi.setSystemTime(Date.now() + ms);
  await new Promise((r) => setTimeout(r, 0));
};

export const resetSleeps = (): void => {
  sleeps.length = 0;
};
