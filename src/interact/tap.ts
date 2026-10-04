import type { DeviceAdapter } from '../adapters/types.js';
import { tapPoint } from '../ui-tree/selectors.js';
import { resolveSettled, type SettleOptions, type Target } from './resolve.js';

/**
 * Wait for the target to appear and settle (resolveSettled: one policy for
 * the flow engine's `tap:` step and the MCP `tap` tool), then tap the chosen
 * node's center. Returns the resolution note, if any, for the caller to
 * surface — the engine's trace does not print it, the MCP tool does.
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
  adapter: Pick<DeviceAdapter, 'uiTree' | 'tap'>,
  target: Target,
  opts: SettleOptions,
): Promise<{ note?: string }> {
  const { node, note } = await resolveSettled(adapter, target, opts);
  const point = tapPoint(node);
  await adapter.tap(point.x, point.y);
  return { note };
}
