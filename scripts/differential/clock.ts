/**
 * Virtual time for a differential run, so a `scroll_until` that strokes and
 * waits, a pixel assert that polls for 12 s, or a guard's settle runs in
 * milliseconds and the same on both sides: `Date.now` reads a clock that
 * only the code under test's own sleeps move.
 *
 * Which timers are the code's: averi has one sleep owner, `util/sleep.ts`
 * (its doc: "one owner so waits, not sleeps stays a design rule"), and it
 * is the only `setTimeout` in src/ outside the process shutdown. A timer set
 * from that file (read off the stack — the frame right above this function)
 * is virtual: the clock moves by its length and it fires on the next turn.
 * Every other timer — the MCP SDK's request timeout, node's own — stays
 * real, so the transport between the harness and the server is untouched.
 * This is the one place the harness knows a path inside the code it runs;
 * if the sleep owner ever moves, every call's elapsed time reads 0 and the
 * run says so (`virtualSleeps` stays 0 — run.ts reports it).
 */

const realSetTimeout = globalThis.setTimeout;
const realNow = Date.now;
const START = Date.UTC(2026, 0, 1);

let clock = START;
let sleeps = 0;

const SLEEP_OWNER = /[/\\]src[/\\]util[/\\]sleep\.[jt]s/;

function fakeSetTimeout(this: unknown, fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) {
  const stack = new Error().stack ?? '';
  // Frame 0 is the message, 1 this function, 2 the caller.
  const caller = stack.split('\n')[2] ?? '';
  if (!SLEEP_OWNER.test(caller)) return realSetTimeout(fn, ms, ...args);
  sleeps++;
  clock += Math.max(0, ms ?? 0);
  return realSetTimeout(fn, 0, ...args);
}

let installed = false;

/** Swap in the virtual clock for the rest of the process. Idempotent. */
export function installVirtualClock(): void {
  if (installed) return;
  installed = true;
  globalThis.setTimeout = fakeSetTimeout as unknown as typeof setTimeout;
  Date.now = () => clock;
}

/** Back to the same start, before each call, so an elapsed time in a reply is the call's own. */
export function resetClock(): void {
  clock = START;
}

/** How many sleeps of the code under test ran on the virtual clock — a run with none says its clock was never used. */
export function virtualSleeps(): number {
  return sleeps;
}

/** Real wall-clock milliseconds, for the run's own timing. */
export const wallNow = (): number => realNow();
