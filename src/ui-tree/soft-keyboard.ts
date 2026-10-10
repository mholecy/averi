import { everyNode, KEYBOARD_ROLE, rectArea, STRUCTURAL_ROLES, type Rect, type SoftKeyboard, type UiNode } from '../adapters/types.js';
import { rectWithin } from './geometry.js';

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
 * the lowest layer every sentence that says so imports. Since round 7
 * (2026-10-10) it also reads idb's keyboard band, which carries no mark, by
 * its shape (`flatListKeyboardBand`) — known outside draw-order.ts as a TOP
 * EDGE only (`keyboardBandTop`), never as a keyboard shown.
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
 * idb's SOFT KEYBOARD BAND, read by its shape over a flat list's nodes in
 * the list's order (`nodes`, pre-order: the synthetic root first) — moved
 * here from ui-tree/draw-order.ts (round 7, 2026-10-10), where
 * `keyboardOf` still reads it for `flatListReadingOrder` and `bottomPinned`
 * unchanged. idb marks no keyboard node, so its keys — plain `button`s
 * listed LAST — are the only covers of the rows under it. Its background is
 * a screen-wide, unlabelled structural node ending at the screen's bottom
 * and starting at or below `barLine` (the top bar's band, so never the
 * screen's size), listed right after the keys; the keyboard is that node
 * and the run of nodes listed beside it (before and after, in the list's
 * order) lying wholly inside it — `from` to `to`, the walk indexes of that
 * run (`to` exclusive). Measured on all four keyboard dumps of the round-2
 * to round-8 device checks: run2-ios #250 (the SWIFT form's number pad,
 * `other 0,589 402x285` after `1`…`Delete`), run3-ios #45 and #51 and
 * run8-ios #233 (`other 0,590 402x284` after the QWERTY keys, `Dictate
 * 325,805 68x69` after it). Shape, not labels: key labels follow the
 * language and the layout. The app's own PIN pad (run5-ios #81) has no such
 * background, and is content. Undefined when no node has that shape (the
 * last one listed is taken).
 */
export function flatListKeyboardBand(nodes: readonly UiNode[], screen: Rect, barLine: number): { readonly top: number; readonly from: number; readonly to: number } | undefined {
  const bottom = screen.y + screen.height;
  let back = -1;
  for (let i = nodes.length - 1; i > 0 && back < 0; i--) {
    const node = nodes[i];
    const r = node.rect;
    if (STRUCTURAL_ROLES.has(node.role) && !node.label && r.x === screen.x && r.width === screen.width && r.y + r.height === bottom && r.y >= barLine) back = i;
  }
  if (back < 0) return undefined;
  const band = nodes[back].rect;
  const inside = (n: UiNode | undefined): boolean => n !== undefined && rectWithin(n.rect, band);
  let from = back;
  while (from > 1 && inside(nodes[from - 1])) from--;
  let to = back + 1;
  while (inside(nodes[to])) to++;
  return { top: band.y, from, to };
}

/**
 * The top bar's band of a flat list as `keyboardBandTop` reads it: the
 * fraction of the screen's height the band's background must start below.
 * draw-order.ts#FLAT_LIST_TOP_BAR_FRACTION's value — that module imports
 * this one, so this one may not import it back; a test pins the two equal
 * (tests/ui-tree/soft-keyboard.test.ts).
 */
export const KEYBOARD_BAND_BAR_FRACTION = 0.2;

/**
 * The TOP EDGE of idb's keyboard band (`flatListKeyboardBand`) in `tree`, or
 * undefined — round 7, 2026-10-10 (docs/bugs/2026-10-09-ios-idb-scroll-
 * stroke-starts-on-the-soft-keyboard.md, and M-1.4's "354x7 part shows"
 * inside the band). A LINE, deliberately, and nothing more: not a reading of
 * the keyboard (`keyboardInTree` stays `unknown` on an idb tree, and with it
 * every `shown`/`hidden` question of keyboard-cover.ts#readKeyboard and the
 * in-tree dismissal — a blind key there was measured to submit, K5d). Two
 * readers, and only these: `scroll_until`'s stroke box ends above it (no
 * touch-down on a key — interact/scroll-rounds.ts), and the tap's chrome
 * check cuts its box above it before a piece is chosen (no piece, no "part
 * that shows", inside the band — interact/resolve.ts#aimClearOfChrome).
 * Only a FLAT LIST (`UiNode.flatList`, idb's mark) is read: WDA marks its
 * band itself (`KEYBOARD_ROLE`) and Android's keyboard is never in the tree
 * — both always undefined here. The screen is draw-order's: the root's rect,
 * or the tree's largest when the root has none (idb's synthetic 0×0 root).
 */
export function keyboardBandTop(tree: UiNode): number | undefined {
  if (tree.flatList !== true) return undefined;
  const nodes = [...everyNode(tree)];
  const screen = rectArea(tree.rect) > 0 ? tree.rect : nodes.reduce((best, n) => (rectArea(n.rect) > rectArea(best) ? n.rect : best), tree.rect);
  return flatListKeyboardBand(nodes, screen, screen.y + screen.height * KEYBOARD_BAND_BAR_FRACTION)?.top;
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
