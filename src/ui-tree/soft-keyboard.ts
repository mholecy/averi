import { everyNode, KEYBOARD_ROLE, rectArea, type SoftKeyboard, type UiNode } from '../adapters/types.js';

/**
 * What the TREE says about the soft keyboard (2026-10-07): the in-tree half
 * of the reading that `KeyboardOracle` (adapters/types.ts) gives for the
 * window model. On a platform whose keyboard is part of the accessibility
 * tree (iOS), the tree source marks the node whose rect is the covered band
 * with `KEYBOARD_ROLE` and the roots of the keyboard's own UI with
 * `ofKeyboard` (adapters/wda-source.ts#keyboardMarks has the rules and the
 * measurements), and this module is the one place that reads the marks —
 * every reader of the keyboard asks a reading built off the tree it already
 * holds (`keyboard-cover.ts#readKeyboard`, which reads the band and the
 * keyboard's own nodes through here), so none pays a device read for the
 * answer (a WDA `/source` is 0.6–0.98 s, measured that day). Since stage B
 * (the same day) it also answers "which of the keyboard's own controls
 * hides it" — `accessoryDismissButton`, the app's input-accessory toolbar's
 * trailing button — for the in-tree model's configured dismissals
 * (interact/keyboard-in-tree.ts). And it holds the vocabulary of what an
 * adapter can do about a covering keyboard (`KeyboardRemedy`, `cannotHide`),
 * the lowest layer every sentence that says so imports.
 */

/**
 * The band: a `SoftKeyboard`, the oracle's own type, so a reading
 * (`keyboard-cover.ts#readKeyboard`) tests it with the same geometry as the
 * Android reading. Two of its three states can occur:
 * - `shown` with the band as `frame`: the first `KEYBOARD_ROLE` node in
 *   pre-order with a positive-area rect (a copy — nodes are mutated
 *   downstream and the frame is quoted in messages after the fact). A
 *   second such node (an iPad split or floating keyboard, not measured) is
 *   not read; recorded as a residual on keyboardMarks.
 * - `unknown` when there is none. Not `hidden`: an idb tree never carries
 *   the mark whatever the screen shows, a WDA tree without it has no
 *   keyboard on screen, and the tree cannot say which source produced it.
 *   The tap guard and the pixel poll fail open on `unknown` and on `hidden` alike, so the
 *   distinction costs nothing there. Since stage B (2026-10-07) the
 *   in-tree `dismissKeyboard` reads it too, and acts only on `shown`: on
 *   `unknown` it does nothing — an idb tree reads `unknown` whatever the
 *   screen shows, and a blind key there was measured to submit (K5d), so
 *   "cannot see a keyboard" means "press nothing", the opposite of the
 *   oracle's `unknown → back` row (interact/keyboard-window.ts#dismissal and
 *   keyboard-in-tree.ts's `dismiss` have the two reasons).
 */
export function keyboardInTree(tree: UiNode): SoftKeyboard {
  for (const n of everyNode(tree)) {
    if (n.role === KEYBOARD_ROLE && rectArea(n.rect) > 0) return { state: 'shown', frame: { ...n.rect } };
  }
  return { state: 'unknown' };
}

/**
 * Every node of the tree in pre-order with the two marks its ancestry gives
 * it: whether it lies under (or is) an `ofKeyboard` root — the keyboard's
 * own UI, keys and accessory toolbar alike — and whether it lies under (or
 * is) the `KEYBOARD_ROLE` band node. The one walk `keyboardSideNodes` and
 * `accessoryDismissButton` share: until 2026-10-07 (review of the stage B
 * branch) each carried the flags through a recursion of its own.
 */
function* markedNodes(
  tree: UiNode,
  ofKeyboard = false,
  underBand = false,
): Generator<{ node: UiNode; ofKeyboard: boolean; underBand: boolean }> {
  const here = ofKeyboard || tree.ofKeyboard === true;
  const banded = underBand || tree.role === KEYBOARD_ROLE;
  yield { node: tree, ofKeyboard: here, underBand: banded };
  for (const child of tree.children) yield* markedNodes(child, here, banded);
}

/**
 * Every node of `tree` that is the keyboard's own UI — a key, the AutoFill
 * bar, the accessory toolbar's Done (review 2026-10-07): it, or an ancestor
 * of it in `tree`, carries `ofKeyboard`. Such a node lies INSIDE the band
 * and is never "under" it: a tap on it is the thing the user does, not the
 * thing the guard prevents. A set of the tree's own objects, so membership
 * is by identity (a resolution hands back the node of the tree it resolved
 * from); a node the tree does not hold is not part of its keyboard. One
 * walk for every node at once (2026-10-08: `scroll_until` asks it of every
 * match each round; until 2026-10-09 a single-node `partOfKeyboard` walked
 * again per question). Empty for a tree with no mark (every Android tree).
 * Read through a reading's `ofKeyboard` (keyboard-cover.ts#readKeyboard),
 * which builds it once per reading.
 */
export function keyboardSideNodes(tree: UiNode): ReadonlySet<UiNode> {
  const out = new Set<UiNode>();
  for (const marked of markedNodes(tree)) if (marked.ofKeyboard) out.add(marked.node);
  return out;
}

/**
 * The input-accessory toolbar's trailing button — the app's own "Done" above
 * a number pad — when the keyboard's UI on screen has one (stage B,
 * 2026-10-07). Measured on the 2FA screen (docs/bugs/2026-10-05-ios-tap-
 * lands-on-soft-keyboard.md, K4 and the device check): a tap on that
 * Button {317,523,64,38} hid the pad without submitting, both by hand and
 * through the `tap` tool; it is the one GENERIC non-submitting dismissal
 * seen, the keyboard's own return key having submitted (K5d) and WDA's
 * keyboard/dismiss having failed (K5a).
 *
 * The rule, over the normalized tree: a node of role `toolbar` (the WDA
 * source's `Toolbar` type, adapters/wda-source.ts) that lies under an
 * `ofKeyboard` root — the input-host Window, where UIKit puts an
 * `inputAccessoryView` beside its `inputView` placeholder — with positive
 * area, and NOT under the `KEYBOARD_ROLE` band node: the band holds the
 * keys, the Passwords bar and the `done` RETURN key (a Button inside the
 * `Keyboard` element, y 752 in the login fixtures), none of which is an
 * accessory and one of which submits. In the 2FA fixture the Toolbar sits
 * in a different Window than the band, so the exclusion costs nothing
 * there and protects against a layout that nests one. Of the toolbar's
 * buttons the LAST in pre-order: a UIToolbar lays its items leading to
 * trailing, and the dismiss item is the trailing one by convention (the
 * measured toolbar has a flexible space then "Done"). The button must have
 * area too, or its centre is no tap point. Nothing in the login fixtures
 * (no Toolbar at all) and nothing in the parked 2FA fixture: its Toolbar
 * Window holds no `inputView` and is not marked `ofKeyboard` (the stage A
 * residual on keyboardMarks) — with no band on screen there is nothing to
 * dismiss there either, so the two residuals agree.
 */
export function accessoryDismissButton(tree: UiNode): UiNode | undefined {
  for (const { node, ofKeyboard, underBand } of markedNodes(tree)) {
    if (node.role !== 'toolbar' || !ofKeyboard || underBand || !(rectArea(node.rect) > 0)) continue;
    let last: UiNode | undefined;
    for (const d of everyNode(node)) if (d.role === 'button' && rectArea(d.rect) > 0) last = d;
    if (last !== undefined) return last;
  }
  return undefined;
}

/**
 * What the adapter has to hide a keyboard WITH — a capability, fixed per
 * adapter, not a decision: `back` on the oracle's window model (a `back`
 * hides it, witness-vetoed, interact/keyboard-window.ts), `none` on the in-tree
 * model, where no key does and the configured dismissals are tried instead.
 * The pixel poll words its remedy by it. What one call then DOES —
 * interact/keyboard-window.ts#dismissal's `'back' | 'nothing' | 'unlocated'` — is a different
 * question with its own literals, kept apart on purpose: with `back` in
 * hand the decision is still `nothing` when the state is hidden or the
 * witness denies the keyboard.
 */
export type DismissalMeans = 'back' | 'none';

/** What the adapter can do about a covering keyboard, for the sentence that says so (the pixel poll's miss, the guard's refusal). */
export interface KeyboardRemedy {
  dismissal: DismissalMeans;
  /** With `none`: the adapter's own sentence on why, and what works instead (`DeviceAdapter.keyboardAdvice`), when it has one. */
  advice?: string;
}

/**
 * The generic half of the in-tree model's sentence, written once for the
 * guard's refusal (interact/keyboard-in-tree.ts, KeyboardWithoutDismissal) and the
 * pixel poll's covered miss (verify/pixel-poll.ts) — here, the lowest layer
 * both import, as the review of 2026-10-07 asked, so "one phrase" holds by
 * construction and not by two matching literals. "On its own", because the
 * `advice` that follows it is what DOES work.
 */
export const CANNOT_HIDE = 'this adapter cannot hide it on its own';

/** `CANNOT_HIDE`, then the adapter's `advice` in parentheses when it has one — the one composition both sentences use. */
export function cannotHide(advice: string | undefined): string {
  return advice === undefined ? CANNOT_HIDE : `${CANNOT_HIDE} (${advice})`;
}
