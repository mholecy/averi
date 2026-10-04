import type { DeviceAdapter, UiNode } from '../adapters/types.js';
import { sleep } from '../util/sleep.js';

/**
 * Reading the UI tree, and waiting on it.
 *
 * Two primitives live here: `readTreeOrError`, the one-shot read that reports
 * a failure as a value, and `pollTree`, the deadline loop over it that every
 * "wait for the screen to say X" in the codebase is built on. They are one
 * module because the second exists to apply the first's rule, and a caller
 * that needs one usually needs the other.
 *
 * Two ONE-SHOT read policies exist beside these and are deliberately left
 * where they are (assessed 2026-10-03, not changed):
 *
 * - `verify/capture.ts#readTreeWithRetry` — five attempts 300 ms apart, for
 *   the tree half of a captured frame. It is a bounded retry around
 *   `uiTree()`, not a poll: there is no predicate to evaluate, only a tree to
 *   obtain, and its failure wording ("UI tree read failed after N attempts")
 *   is the frame's. Expressing it as `pollTree` with an always-true predicate
 *   would read as a trick. The residual png-then-tree race recorded in
 *   capture.ts (the screen changes between the stable pair and the tree
 *   read) belongs to THIS module if it is ever closed: the cheap mitigation
 *   is one confirming capture after the read, and which capture confirms what
 *   is a tree-read/poll concern, not a frame concern. Not done here — it is a
 *   behaviour change with no measured incident behind it.
 * - Android's `uiTree({ settle: true })` — one bounded retry inside the
 *   adapter when uiautomator says "null root node", opted into by the
 *   one-shot MCP tools only. Pollers leave it off because their interval
 *   already is the retry (adapters/android.ts). It is below this layer and
 *   stays there: the adapter is the only thing that can tell "no window yet"
 *   from "no XML at all".
 *
 * Three read policies is one more than the ideal, but each has a different
 * caller shape (poll, bounded one-shot, adapter-internal) and folding them
 * would move a decision away from the layer that can make it.
 */

/**
 * Read the UI tree, reporting a failure as a value instead of throwing.
 *
 * A failed tree read is a POLL MISS, not a failure — the rule every waiting
 * loop in this codebase depends on. Right after launch (`clearState`
 * especially, wider still on RN debug builds) the app has no window yet and
 * uiautomator legitimately reports a null root node for a few seconds; mid
 * animation the tree can be momentarily unproducible too. Ending a poll there
 * would turn "the screen has not settled yet" into "your flow is broken".
 *
 * The error is returned rather than swallowed because the other half of the
 * rule matters just as much: a genuinely broken device (adb gone, emulator
 * offline) must stay diagnosable, so every caller quotes the LAST read error
 * in its timeout message. `error` is set only when `tree` is not, so callers
 * can assign both each round and get the "clear on success" behaviour free.
 *
 * A free function rather than a method on each poller: the rule was written
 * out three times (pollUntil, scrollUntilVisible, Verifier.tryReadTree), which
 * is one owner too few for the behaviour the tool's reliability rests on.
 * `Pick<…, 'uiTree'>` keeps it callable from anything that can read a tree,
 * fakes included, without dragging in the rest of the adapter surface.
 */
export async function readTreeOrError(
  adapter: Pick<DeviceAdapter, 'uiTree'>,
): Promise<{ tree?: UiNode; error?: Error }> {
  try {
    return { tree: await adapter.uiTree() };
  } catch (e) {
    return { error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/**
 * A poll round that has NOT concluded but has something to say. Returned by a
 * predicate in place of `undefined` to keep polling while remembering a
 * detail for the timeout report ("element found but content was: …" must
 * survive the element vanishing again before the deadline). A class rather
 * than a tagged union so the predicate's success value needs no wrapping: a
 * poller that only ever hits or misses returns `T | undefined`, exactly as it
 * did before this primitive existed.
 */
export class PollMiss {
  constructor(readonly detail: string) {}
}

export interface PollOptions {
  timeoutMs: number;
  /** Pause between rounds. Owned by the caller: the engine and the verifier each have their own cadence. */
  pollMs: number;
}

/** How a poll ended: the predicate's value, or the deadline with what the last rounds knew. */
export type PollOutcome<T> =
  | { timedOut: false; value: T }
  | {
      timedOut: true;
      /** The last PollMiss detail a round produced, if any. A round with nothing to say never erases it. */
      detail?: string;
      /** The LAST read's error — set when the final round could not read a tree, cleared by any successful read. */
      readError?: Error;
    };

/**
 * The wording a THROWN poll timeout shares — what was waited for, for how
 * long, and the last read error beneath it when there was one. One owner
 * because two layers throw it: the flow engine for its waits, and the
 * interaction module for an element that never appeared or never held still.
 * The verifier does not use it: its timeouts are failing results, worded per
 * assert.
 */
export const pollTimeoutMessage = (what: string, timeoutMs: number, readError?: Error): string =>
  `Timed out after ${timeoutMs}ms waiting for ${what}` +
  (readError === undefined ? '' : `\n  (last UI tree read failed: ${readError.message})`);

/**
 * Poll the UI tree until the predicate returns a value, or the deadline
 * passes. The one owner of the deadline loop (ARCHITECTURE.md §8, "waits,
 * not sleeps"): before 2026-10-03 it was written out in `Verifier.poll`,
 * `FlowEngine.pollUntil` and `FlowEngine.detects`, and the third copy had
 * quietly dropped the read error — an adb that was gone showed up as
 * "not in state" with no trace of why.
 *
 * The loop's shape is load-bearing and pinned by tests:
 * - Every round reads the tree ONCE, through readTreeOrError: a failed read
 *   is a miss that keeps polling, and its error is remembered so a timeout
 *   can quote it. Any later successful read clears it.
 * - The predicate runs only on a tree it could read. A value ends the poll;
 *   `undefined` continues it; a `PollMiss` continues it and records a detail
 *   that a later silent round does not overwrite.
 * - At least one read happens BEFORE the deadline is checked, so a
 *   `timeoutMs` of 0 is a single probe, and a budget shorter than one device
 *   read still gets one honest look (the optional-tap finding of 2026-08-19).
 * - Errors thrown by the predicate itself (an unknown state name, a viewport
 *   that cannot be read) propagate at once: they are the caller's bug or the
 *   device's, never a miss.
 *
 * Returns an outcome rather than throwing on timeout because the callers
 * disagree about what a timeout IS: a flow wait throws, an assert returns a
 * failing result, a detect probe answers false. Each words it; this decides
 * nothing about wording.
 */
export async function pollTree<T>(
  adapter: Pick<DeviceAdapter, 'uiTree'>,
  predicate: (tree: UiNode) => Promise<T | PollMiss | undefined> | T | PollMiss | undefined,
  opts: PollOptions,
): Promise<PollOutcome<T>> {
  const deadline = Date.now() + opts.timeoutMs;
  let detail: string | undefined;
  let readError: Error | undefined;
  for (;;) {
    const read = await readTreeOrError(adapter);
    readError = read.error;
    if (read.tree !== undefined) {
      const verdict = await predicate(read.tree);
      if (verdict instanceof PollMiss) detail = verdict.detail;
      else if (verdict !== undefined) return { timedOut: false, value: verdict };
    }
    if (Date.now() >= deadline) return { timedOut: true, detail, readError };
    await sleep(opts.pollMs);
  }
}
