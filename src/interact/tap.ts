import type { DeviceAdapter } from '../adapters/types.js';
import { tapPoint } from '../ui-tree/selectors.js';
import { resolveClearOfKeyboard, type GuardOptions } from './keyboard.js';
import type { Target } from './resolve.js';

/**
 * Wait for the target to appear and settle (resolveSettled: one policy for
 * the flow engine's `tap:` step and the MCP `tap` tool), then tap the chosen
 * node's center. Returns the resolution note, if any, for the caller to
 * surface — the engine's trace does not print it, the MCP tool does.
 *
 * Since 2026-10-03 the node comes from resolveClearOfKeyboard (keyboard.ts):
 * on an adapter with a keyboard oracle (Android) a target under the soft
 * keyboard is not tapped where it stands — the keyboard is hidden and the
 * target resolved again first; on one without (iOS, since 2026-10-07) the
 * in-tree keyboard is read, a covered target is refused, or — stage B, the
 * same day — hidden with one of the caller's `dismissals` (GuardOptions)
 * first. This function knows nothing of how that is decided. When that
 * happened the note says so, and `keyboardHidden` carries the sentence alone
 * for the one caller that prints no notes (the flow trace's `⚠ tap`).
 *
 * Moved from ui-tree/tap-element.ts on 2026-10-03, where it read the tree
 * once with the adapter's `settle` retry and threw on ambiguity. The poll is
 * now the retry, so `settle` is not asked for (adapters/types.ts: pollers
 * leave it off). A free function rather than a DeviceAdapter method, for the
 * reason the old file gave: nothing in it is platform-specific, and both
 * adapters once implemented it identically, which forced the platform layer
 * to import the selector layer above it (ARCHITECTURE.md §3).
 */
export async function tapElement(
  adapter: Pick<DeviceAdapter, 'uiTree' | 'tap' | 'keyboard' | 'keyboardAdvice' | 'pressKey'>,
  target: Target,
  opts: GuardOptions,
): Promise<{ note?: string; keyboardHidden?: string }> {
  const { node, note, keyboardHidden } = await resolveClearOfKeyboard(adapter, target, opts);
  const point = tapPoint(node);
  await adapter.tap(point.x, point.y);
  return { note, keyboardHidden };
}
