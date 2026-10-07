import { everyNode, KEYBOARD_ROLE, rectArea, type DeviceAdapter, type SoftKeyboard, type UiNode } from '../adapters/types.js';

/**
 * What the TREE says about the soft keyboard (2026-10-07): the in-tree half
 * of the reading that `KeyboardOracle` (adapters/types.ts) gives for the
 * window model. On a platform whose keyboard is part of the accessibility
 * tree (iOS), the tree source marks the node whose rect is the covered band
 * with `KEYBOARD_ROLE` and the roots of the keyboard's own UI with
 * `ofKeyboard` (adapters/wda-source.ts#keyboardMarks has the rules and the
 * measurements), and this module is the one place that reads the marks —
 * the tap guard (interact/keyboard.ts) and the pixel poll (verify/
 * pixel-poll.ts) both ask `readSoftKeyboard` of the tree they already hold,
 * so neither pays a device read for the answer (a WDA `/source` is
 * 0.6–0.98 s, measured that day). Like `read-tree.ts#pollTree`, this module
 * takes the adapter and calls its interface, never a platform command.
 */

/**
 * The band: a `SoftKeyboard`, the oracle's own type, so the callers feed it
 * to the same geometry (`windowOver`, `rectsOverlap`) as the Android
 * reading. Two of its three states can occur:
 * - `shown` with the band as `frame`: the first `KEYBOARD_ROLE` node in
 *   pre-order with a positive-area rect (a copy — nodes are mutated
 *   downstream and the frame is quoted in messages after the fact). A
 *   second such node (an iPad split or floating keyboard, not measured) is
 *   not read; recorded as a residual on keyboardMarks.
 * - `unknown` when there is none. Not `hidden`: an idb tree never carries
 *   the mark whatever the screen shows, a WDA tree without it has no
 *   keyboard on screen, and the tree cannot say which source produced it.
 *   Both callers fail open on `unknown` and on `hidden` alike, so the
 *   distinction costs nothing there; it matters to `dismissKeyboard`'s
 *   `hidden → nothing` row, which this reading therefore never feeds
 *   (stage A leaves the in-tree dismissal blind, as it was).
 */
export function keyboardInTree(tree: UiNode): SoftKeyboard {
  for (const n of everyNode(tree)) {
    if (n.role === KEYBOARD_ROLE && rectArea(n.rect) > 0) return { state: 'shown', frame: { ...n.rect } };
  }
  return { state: 'unknown' };
}

/**
 * Is `node` the keyboard's own UI — a key, the AutoFill bar, the accessory
 * toolbar's Done (review 2026-10-07)? True when it, or an ancestor of it in
 * `tree`, carries `ofKeyboard`. By identity: the node must be one of the
 * tree's own objects (a resolution hands back the node of the tree it
 * resolved from). A node the tree does not hold is not part of its
 * keyboard. Such a node lies INSIDE the band and is never "under" it: a
 * tap on it is the thing the user does, not the thing the guard prevents.
 */
export function partOfKeyboard(tree: UiNode, node: UiNode): boolean {
  const walk = (n: UiNode, inside: boolean): boolean | undefined => {
    const here = inside || n.ofKeyboard === true;
    if (n === node) return here;
    for (const child of n.children) {
      const found = walk(child, here);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(tree, false) ?? false;
}

/** One reading of the soft keyboard for one subject node, and what the adapter can do about a covering one. */
export interface SoftKeyboardReading {
  /** The keyboard's state and frame; `unknown` when the subject is part of the keyboard's own UI, whatever is on screen. */
  keyboard: SoftKeyboard;
  /** `back`: the oracle's window model, a `back` hides it (witness-vetoed, interact/keyboard.ts). `none`: the in-tree model, nothing does. */
  dismissal: 'back' | 'none';
  /** With `none`: the adapter's own sentence on why, and what works instead (`DeviceAdapter.keyboardAdvice`), when it has one. */
  advice?: string;
}

/**
 * THE one place the two models meet (review 2026-10-07): the adapter's
 * oracle when it has one — one `state()` query, the Android cost pinned on
 * `AndroidAdapter.keyboardState` — else the tree the caller already holds.
 * Never both: an adapter with the oracle is not read from the tree (the
 * Android tree carries no marks, and two readings of one keyboard would
 * need a rule for their disagreement), and an adapter without one asks no
 * device. Before this helper the switch was written in interact/keyboard.ts
 * and verify/pixel-poll.ts separately.
 *
 * `subject` is the node the caller is about to act on or measure: when it
 * is the keyboard's own UI (`partOfKeyboard`) the reading is `unknown` —
 * nothing covers a key but the finger — and the oracle is not asked either,
 * which on Android changes nothing (no tree there is ever marked).
 */
export async function readSoftKeyboard(
  adapter: Pick<DeviceAdapter, 'keyboard' | 'keyboardAdvice'>,
  tree: UiNode,
  subject: UiNode,
): Promise<SoftKeyboardReading> {
  const dismissal = adapter.keyboard === undefined ? 'none' : 'back';
  const advice = dismissal === 'none' ? adapter.keyboardAdvice : undefined;
  if (partOfKeyboard(tree, subject)) return { keyboard: { state: 'unknown' }, dismissal, advice };
  const keyboard = adapter.keyboard === undefined ? keyboardInTree(tree) : await adapter.keyboard.state();
  return { keyboard, dismissal, advice };
}
