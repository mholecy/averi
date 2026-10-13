import { resolveClearOfKeyboard, type GuardOptions } from './keyboard.js';
import type { KeyboardAdapter } from './keyboard-model.js';
import type { Target } from './resolve.js';

/**
 * What a tap on a resolved node needs of the device: the keyboard guard's
 * surface (keyboard-model.ts#KeyboardAdapter — the tree, the tap, the
 * keyboard, the key, and the screen size the on-screen rule judges by),
 * named for the caller that is not about the keyboard.
 */
export type TapAdapter = KeyboardAdapter;

/**
 * Wait for the target to appear and settle (resolveSettled: one policy for
 * the flow engine's `tap:` step and the MCP `tap` tool), then tap the chosen
 * node at the guard's point. Returns the resolution note, if any, for the caller to
 * surface — the engine's trace does not print it, the MCP tool does.
 *
 * The node comes from resolveClearOfKeyboard (keyboard.ts): on an adapter
 * with a keyboard oracle (Android) a target under the soft keyboard is not
 * tapped where it stands — the keyboard is hidden and the target resolved
 * again first; on one without (iOS) the in-tree keyboard is read, a covered
 * target is refused, or hidden with one of the caller's `dismissals`
 * (GuardOptions) first. This function knows nothing of how that is decided.
 * When that happened the note says so, and `keyboardHidden` carries the
 * sentence alone for the one caller that prints no notes (the flow trace's
 * `⚠ tap`).
 *
 * The same call refuses a node whose centre lies off the screen — an
 * OffScreenRefusal (tap-judgement.ts#judgeTap), nothing tapped: idb lists
 * a scroll view's content below the fold with real rects.
 * docs/bugs/2026-10-08-ios-tap-off-screen-reported-done.md
 *
 * The point is the guard's too (tap-judgement.ts#TapJudge.aim): the centre,
 * unless a node of the app is drawn over it — then an uncovered piece large
 * enough to aim at, said in `moved` (the MCP reply puts it after the
 * selector; the flow traces it as `⚠ tap`), or a CoveredRefusal, nothing
 * tapped ("Tapped" pressed a payment form's pinned CONTINUE). The same check
 * first refuses a target its scroll container cuts to a strip under that
 * piece's minimum — a ClippedRefusal (tap-judgement.ts#TapJudge.aim), nothing
 * tapped. Where the node stands is ui-tree/standing.ts#Scene's.
 * docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md
 *
 * The poll is the retry, so the adapter's `settle` is not asked for
 * (adapters/types.ts: pollers leave it off). A free function rather than a
 * DeviceAdapter method: nothing in it is platform-specific, and as a method
 * both adapters implemented it identically, which forced the platform layer
 * to import the selector layer above it (ARCHITECTURE.md §3).
 */
export async function tapElement(
  adapter: TapAdapter,
  target: Target,
  opts: GuardOptions,
): Promise<{ note?: string; keyboardHidden?: string; moved?: string }> {
  const { note, keyboardHidden, point, moved } = await resolveClearOfKeyboard(adapter, target, opts);
  await adapter.tap(point.x, point.y);
  return { note, keyboardHidden, moved };
}
