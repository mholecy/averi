import { vi } from 'vitest';

// The batch tests' fake time (abort.test.ts, runner.test.ts; T2c): a budget or a bound raced against a wait is decided
// by the times the test gives, never by a stall of the machine. setTimeout, clearTimeout and Date are faked — the
// abort's judging budget reads Date.now — and time is advanced 1 ms at a time, so no timer fires out of its order.
// Each test file restores real timers in an afterEach too: a test hung past vitest's timeout leaves none faked.

/** An abort's longest fake wait in these tests: a 300 ms budget, a 400 ms restore or end, kill graces — under 1 s. */
export const ABORT_FAKE_MS = 1000;
/** A whole fake batch's longest: a 400 ms late end beside a 120 ms judge, and its steps — under 2 s. */
export const BATCH_FAKE_MS = 2000;

/** `body` with setTimeout, clearTimeout and Date faked; real timers back when it returns. */
export async function onFakeTime<T>(body: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const value = await body();
  vi.useRealTimers();
  return value;
}

/** Fake time advanced 1 ms at a time until `done()`; still not done after `capMs`: throws `what` and the cap. */
export async function advanceUntil(done: () => boolean, capMs: number, what: string): Promise<void> {
  for (let ms = 0; ms < capMs && !done(); ms++) await vi.advanceTimersByTimeAsync(1);
  if (!done()) throw new Error(`${what} within ${capMs} ms of fake time`);
}
