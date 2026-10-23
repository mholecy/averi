import type { DeviceAdapter, FocusedWindow, Rect, UiNode } from '../adapters/types.js';

/**
 * THE WINDOW MANAGER'S WORD AS A MARK (ADR 0018, "Android's window by the window manager's word"): the one place that
 * decides what the focused window the window manager types (`DeviceAdapter.focusedWindow`, adapters/android.ts) says of
 * a tree that lists the active window only and whose parser marked no window presented — a full-screen dialog Compose
 * lays between the bars, a Views dialog laid full screen, an expanded sheet with no scrim, or a plain screen; the dump
 * cannot tell them apart (adapters/android.ts#presentedWindow's residuals).
 *
 * The word is tied to the dump by FRAME: the window's frame must be the root's bounds, or nothing is marked (a window
 * opened or closed between the dump and the read). Then:
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
 * #focusedWindow): its askers are the waits that found nothing (interact/resolve.ts#notFound: the tap's, fill's and
 * the presence check's; verify/assert.ts#Verifier.poll and verify/pixel-poll.ts: every assert's not-found; the flow's
 * `wait:`, flow/engine.ts#pollUntil) — after the wait, on its last tree — and `scroll_until` before a stroke for a
 * target its read does not hold (interact/scroll.ts, `CallWindow`). A flow's detect probe does not ask: it words no
 * miss. What a mark changes is asked only for a target the tree does not hold, so a misreading costs a refusal or a
 * stop, never a false `Tapped` (ADR 0018's invariant).
 */

/** A tree whose window the window manager may still type: it lists the active window only, and its parser marked none. */
const unmarkedWindow = (tree: UiNode): boolean => tree.activeWindowOnly === true && tree.presentation === undefined && tree.windowAlone !== true;

const sameRect = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** THE decision: `tree` marked by the window manager's word on its window (the module doc), or `tree` itself. Pure. */
export function markByWindow(tree: UiNode, window: FocusedWindow): UiNode {
  if (window.of === 'unknown' || !unmarkedWindow(tree) || !sameRect(window.frame, tree.rect)) return tree;
  if (window.of === 'screenAlone') return { ...tree, windowAlone: true };
  return { ...tree, presentation: window.frame.width >= window.screen.width ? 'screen' : 'dialog' };
}

/** The last tree of a wait that found nothing, marked by the window manager's word when it may type it — one call, else none. */
export async function markedByWindow(adapter: Pick<DeviceAdapter, 'focusedWindow'>, tree: UiNode | undefined): Promise<UiNode | undefined> {
  if (tree === undefined || !unmarkedWindow(tree) || adapter.focusedWindow === undefined) return tree;
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
    if (this.said === undefined || !sameRect(this.said.rect, tree.rect)) {
      if (holdsTarget()) return tree;
      this.said = { rect: tree.rect, window: await this.adapter.focusedWindow() };
    }
    return markByWindow(tree, this.said.window);
  }
}
