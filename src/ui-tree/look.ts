import type { DeviceAdapter, UiNode } from '../adapters/types.js';
import { readKeyboard, type KeyboardReading } from './keyboard-cover.js';
import { keyboardPosition, type KeyboardPosition } from './keyboard-position.js';
import { sceneOf, type Scene } from './standing.js';

/**
 * ONE LOOK — one tree read as every verb judges it: the tree, its scene (draw order and clip facts,
 * ui-tree/standing.ts#Scene), the keyboard reading taken off it (ui-tree/keyboard-cover.ts#readKeyboard) and where the
 * soft keyboard lies on it (ui-tree/keyboard-position.ts#KeyboardPosition: the line for a subject, `owns`, the
 * reading's line). Built ONCE per read, by `lookAt` (`lookOn` with the adapter's reading), and handed whole to the
 * verbs that judge the read: the tap (interact/tap-judgement.ts#judgeTap, through the guard's looks,
 * interact/keyboard-model.ts#SeenLook), the dismissal picker (interact/keyboard-in-tree.ts#pickDismissal), the pixel
 * poll (verify/pixel-poll.ts#overElement, one look a round) and `scroll_until`'s read (interact/scroll-read.ts
 * #TreeFacts, over a look with the round's synchronous reading facts). None of them derives a scene or builds a
 * keyboard position of its own.
 *
 * Contract:
 * - `scene` is derived on first use and kept: a look is at most one draw-order walk, whoever asks (the walk is
 *   `sceneOf`'s, lazy itself). Not cached by tree: a memo keyed by the tree would rest on trees never being mutated
 *   after their scene is built; a look is threaded to whoever judges it instead.
 * - `keyboard` is THE position of this look — over the scene's draw order and the look's reading — built on first use;
 *   asks nothing until a member is asked, and `readingLine` asks the reading once. ADR 0017's asymmetry is the
 *   position's members, not who built it: `line(subject)` exempts only a node of idb's band (the tap, the picker, the
 *   pixel poll and the scroll read's band all ask it), `owns` — the reading's `ofKeyboard` or idb's band — is asked by
 *   the scroll read alone. The line never depends on the reading (tests/ui-tree/keyboard-position.test.ts), so a verb
 *   that asks only `line` reads the same line whatever reading its look holds.
 * - `reading` is the reading this look was built with, never one of another tree's: its band and its `ofKeyboard` set
 *   are this tree's. `lookOn` takes the adapter's whole reading (the tap, the picker, the pixel poll ask it `over`,
 *   `frameOver`, `overlapping` and its `remedy`); `scroll_until`'s pure read holds only the synchronous facts its round
 *   hands in (`ofKeyboard`), its two async questions asked by the round's protocol (interact/scroll-read.ts#Cover).
 *
 * The screen is not a look's — BY DECISION, where the architecture review's candidate (A3) put it in the Look: a verb
 * asks ui-tree/usable-screen.ts#usableScreen of the look's tree (a Look is a TreeRead) and falls back to its
 * `treeScreen` itself, because which look's screen it judges on is the verb's — the tap judges every look of one tap
 * on its FIRST look's screen (the orientation does not turn inside one tap) and reads it again `fresh` before
 * refusing, the pixel poll each round on that round's, `scroll_until` on a frame and gesture box
 * interact/swipe.ts#screenBox reads and keeps across rounds. A screen held by each look would hand the tap a later
 * look's screen and `scroll_until` a frame that moves between its rounds, so the three lifetimes stay with their verbs.
 *
 * Pinned twice, on purpose: tests/ui-tree/look.test.ts holds the contract above, and tests/interact/look-scene.test.ts
 * keeps its walk-counting mocks (`sceneOf`, `readKeyboard`) as the one-walk-per-read pin — no type can say that a
 * verb did not derive a second scene of a look's tree, only a count of the walks can.
 */
export interface Look<R extends LookReading = KeyboardReading> {
  /** The tree read. */
  readonly tree: UiNode;
  /** The reading taken off `tree` (the contract's `reading`). */
  readonly reading: R;
  /** The tree's scene, derived on first use, once. */
  readonly scene: Scene;
  /** Where the soft keyboard lies on this look: over the scene's draw order and `reading`, built on first use, once. */
  readonly keyboard: KeyboardPosition;
}

/** What of a keyboard reading a look needs: which nodes are the keyboard's own, and — for the reading's line — its cover and witness (ui-tree/keyboard-position.ts#keyboardPosition's). */
export type LookReading = Pick<KeyboardReading, 'ofKeyboard'> & Partial<Pick<KeyboardReading, 'cover' | 'corroborated'>>;

/** The look of `tree` with `reading` (taken off that tree): every member derived on first use, once; nothing asked of the device. */
export function lookAt<R extends LookReading>(tree: UiNode, reading: R): Look<R> {
  let scene: Scene | undefined;
  let keyboard: KeyboardPosition | undefined;
  const look: Look<R> = {
    tree,
    reading,
    get scene() {
      return (scene ??= sceneOf(tree));
    },
    get keyboard() {
      return (keyboard ??= keyboardPosition(look.scene.order, reading));
    },
  };
  return look;
}

/** The look of `tree` on `adapter`: with the adapter's keyboard reading off that tree (ui-tree/keyboard-cover.ts#readKeyboard — building it asks nothing). */
export function lookOn(adapter: Pick<DeviceAdapter, 'keyboard' | 'keyboardAdvice'>, tree: UiNode): Look {
  return lookAt(tree, readKeyboard(adapter, tree));
}
