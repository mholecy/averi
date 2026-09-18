import type { DeviceAdapter, Selector } from '../adapters/types.js';
import { resolveOne, tapPoint } from './selectors.js';

/**
 * Resolve a selector against the device's current tree and tap the matched
 * node's center. Returns a disambiguation note when the selector matched
 * several nodes and one of them was preferred.
 *
 * A free function rather than a DeviceAdapter method: nothing in it is
 * platform-specific. Both adapters implemented it identically, which forced
 * the platform layer — the one layer that is supposed to know only platform
 * commands — to import the selector layer above it (ARCHITECTURE.md §3).
 */
export async function tapElement(
  adapter: DeviceAdapter,
  selector: Selector,
  opts: { settle?: boolean } = {},
): Promise<string | undefined> {
  // `settle` is the CALLER's knowledge (one-shot tool vs poller) — passed
  // through, never decided here, so a future poller can reuse this helper.
  const { node, note } = resolveOne(await adapter.uiTree({ settle: opts.settle }), selector);
  const point = tapPoint(node);
  await adapter.tap(point.x, point.y);
  return note;
}
