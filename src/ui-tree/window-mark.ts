import { sameRectWithinPixel, type DeviceAdapter, type FocusedWindow, type Rect, type UiNode } from '../adapters/types.js';
import { findTarget, type Target } from './selectors.js';

/**
 * THE WINDOW MANAGER'S WORD AS A MARK (ADR 0018, "Android's window by the window manager's word"): the one place that
 * decides what the focused window the window manager types (`DeviceAdapter.focusedWindow`, adapters/android.ts) says of
 * a tree that lists the active window only and whose parser marked no window presented — a full-screen dialog Compose
 * lays between the bars, a Views dialog laid full screen, an expanded sheet with no scrim, or a plain screen; the dump
 * cannot tell them apart (adapters/android.ts#presentedWindow's residuals).
 *
 * The word is tied to the dump by FRAME: the window's frame, clipped to the screen (adapters/android.ts
 * #parseFocusedWindow: the dump clips the root, the window manager may lay a window a pixel past the screen's edge,
 * `1081` of a 1080 screen), must be the root's bounds, x, y, width and height each within a pixel
 * (types.ts#sameRectWithinPixel, rounding between two readers of one layout), or nothing is marked (a window opened or
 * closed between the dump and the read).
 * Then:
 * - `stacked` marks the root presented, as the parser marks a window it recognizes (`UiNode.presentation`): `screen`
 *   when the window spans the screen's width ("a sheet or modal"), `dialog` when it is narrower (a popup against an
 *   edge — one floating off both edges the parser has marked already). Decisions 3 and 4 then read it as they read the
 *   parser's: the wait names the layer, `scroll_until` sends no stroke but on the window's own scroll view;
 * - `screenAlone` marks the root `windowAlone`: the active-window hint is not said (ui-tree/miss.ts#missOf);
 * - `unknown` leaves the tree as it was — today's reply, the hint.
 * The parser's own mark comes first: a marked tree is never asked. A departure from "the parser reads what ui-tree
 * never sees": this mark is set after the read, from a second call, because the dump holds no such fact.
 *
 * Asked on a MISS only, never per poll — the call is one adb round trip, about 26 ms (adapters/android.ts
 * #focusedWindow) — and the rule of when is here, in its two doors: `markedForMiss`, the last read of a wait that gave
 * up with its target in no read it can still type (interact/resolve.ts#notFound: the tap's, fill's and the presence
 * check's; verify/assert.ts#Verifier.poll and verify/pixel-poll.ts: every assert's not-found; the flow's `wait:`,
 * flow/engine.ts#pollUntil) — never for a wait whose reply words no not-found (an `absent` check still visible, an
 * element found with the wrong content, a condition of no element: those callers hand no target), a failed read, or a
 * read that matched the target; and `CallWindow`, `scroll_until`'s before a stroke for a target its read does not hold
 * (interact/scroll.ts). A flow's detect probe does not ask: it words no miss. What a mark changes is asked only for a
 * target the tree does not hold, so a misreading costs a refusal or a stop, never a false `Tapped` (ADR 0018's
 * invariant).
 */

/** A tree whose window the window manager may still type: it lists the active window only, and its parser marked none. */
const unmarkedWindow = (tree: UiNode): boolean => tree.activeWindowOnly === true && tree.presentation === undefined && tree.windowAlone !== true;

/** THE decision: `tree` marked by the window manager's word on its window (the module doc), or `tree` itself. Pure. */
export function markByWindow(tree: UiNode, window: FocusedWindow): UiNode {
  if (window.of === 'unknown' || !unmarkedWindow(tree) || !sameRectWithinPixel(window.frame, tree.rect)) return tree;
  if (window.of === 'screenAlone') return { ...tree, windowAlone: true };
  // Screen-wide within the frame's own pixel of tolerance: a window 1079 wide of a 1080 screen spans it.
  return { ...tree, presentation: window.screen.width - window.frame.width <= 1 ? 'screen' : 'dialog' };
}

/**
 * The last read of a wait that gave up, as its miss judges it (ui-tree/miss.ts#missOf): marked by the window manager's
 * word — one call — when the read did not fail, holds no match of `missing` (the target whose not-found the reply
 * words) and is one the word may type; else the read as it was, and nothing asked. No `missing`, no ask: the reply words
 * no not-found.
 */
export async function markedForMiss(
  adapter: Pick<DeviceAdapter, 'focusedWindow'>,
  last: { readonly readError?: Error; readonly lastTree?: UiNode },
  missing: Target | undefined,
): Promise<UiNode | undefined> {
  const tree = last.lastTree;
  if (tree === undefined || last.readError !== undefined || missing === undefined || !unmarkedWindow(tree) || adapter.focusedWindow === undefined) return tree;
  if (findTarget(tree, missing).length > 0) return tree;
  return markByWindow(tree, await adapter.focusedWindow());
}

/**
 * One `scroll_until` call's word from the window manager: asked once per window — a read whose root bounds the last
 * word was not asked for, which holds no match of the target — and every later read of that window marked by it. A
 * read of other bounds is a window the word is not about: it is asked again, or (holding a match) left as it is.
 */
export class CallWindow {
  private said: { rect: Rect; window: FocusedWindow } | undefined;

  constructor(private readonly adapter: Pick<DeviceAdapter, 'focusedWindow'>) {}

  /** `tree` marked by the word on its window; `holdsTarget` — the call has matched the target, so no miss's word is asked for this read (asked only of a tree the word may type). */
  async mark(tree: UiNode, holdsTarget: () => boolean): Promise<UiNode> {
    if (!unmarkedWindow(tree) || this.adapter.focusedWindow === undefined) return tree;
    if (this.said === undefined || !sameRectWithinPixel(this.said.rect, tree.rect)) {
      if (holdsTarget()) return tree;
      this.said = { rect: tree.rect, window: await this.adapter.focusedWindow() };
    }
    return markByWindow(tree, this.said.window);
  }
}
