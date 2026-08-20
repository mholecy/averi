import type { DeviceAdapter, UiNode } from '../adapters/types.js';

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
