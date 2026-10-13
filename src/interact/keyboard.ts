import type { Point, Rect, UiNode } from '../adapters/types.js';
import { readKeyboard, type KeyboardReading } from '../ui-tree/keyboard-cover.js';
import { keyboardPosition, type KeyboardPosition } from '../ui-tree/keyboard-position.js';
import type { KeyboardRemedy } from '../ui-tree/soft-keyboard.js';
import { sceneOf } from '../ui-tree/standing.js';
import { tapPoint } from '../ui-tree/selectors.js';
import { usableScreen } from '../ui-tree/usable-screen.js';
import { inTreeModel } from './keyboard-in-tree.js';
import {
  confirmHidden,
  lookAgain,
  withNote,
  type ClearedLook,
  type DismissOptions,
  type DismissResult,
  type GuardOptions,
  type KeyboardAdapter,
  type KeyboardModel,
  type ResolvedClear,
} from './keyboard-model.js';
import { windowModel } from './keyboard-window.js';
import { describeTarget, judgeTap, resolveSettled, type Aim, type TapLook, type Target } from './resolve.js';

/**
 * The soft-keyboard guard and the post-fill dismissal, written ONCE over
 * the model seam (keyboard-model.ts): this file holds what every model
 * shares — the first look and its fail-open rule, the one side effect, the
 * confirming looks — and chooses the model; what a model decides, does and
 * says is its own module (keyboard-window.ts, keyboard-in-tree.ts). The
 * callers see only this file: `tapElement` and `fillField` take
 * `resolveClearOfKeyboard`, the flow engine `dismissKeyboard`, and the
 * failures they catch are the classes re-exported below.
 */
export { KeyboardGuardError, type DismissOptions, type DismissResult, type GuardOptions, type KeyboardDismissal, type ResolvedClear } from './keyboard-model.js';
export { AfterKeyboardDismissal, KeyboardStateDisagreement } from './keyboard-window.js';
export { AfterDismissalTap, KeyboardWithoutDismissal } from './keyboard-in-tree.js';

/**
 * THE one choice between the two models for ACTING (the reading half's one switch — every look, round
 * and dismissal, and the pixel poll's and `scroll_until`'s rounds — is
 * `ui-tree/keyboard-cover.ts#readKeyboard`, one layer down, because the
 * pixel poll reads the keyboard too): an adapter WITH the oracle gets the
 * window model, one without the in-tree model. Whether the adapter HAS an
 * oracle carries the platform fact — `KeyboardOracle` (adapters/types.ts)
 * says what providing one asserts — so no platform test is made here
 * (this layer is platform-agnostic, ARCHITECTURE.md §2). Asked nowhere else:
 * neither the guard nor the dismissal asks it again.
 */
function keyboardModel(adapter: KeyboardAdapter): KeyboardModel {
  return adapter.keyboard === undefined ? inTreeModel(adapter) : windowModel(adapter);
}

/**
 * resolveSettled, plus the three rules every tap on a resolved node shares,
 * in this order: the point about to be tapped must lie on the screen
 * (resolve.ts#judgeTap; an OffScreenRefusal, nothing sent, when it does
 * not), not under the soft keyboard, and — last, on the node and tree the
 * guard hands back — not under a node of the app drawn over it
 * (resolve.ts#TapJudge.aim: the tap moves to an uncovered piece large
 * enough, said in `moved`, or a CoveredRefusal; first a ClippedRefusal for
 * a target cut to a sliver at its scroll container's edge). Where the node
 * stands is ui-tree/standing.ts#Scene's; the tap's judgement of one look is
 * ONE `judgeTap` — asked of the first look, and of the look a guard that
 * acted hands back.
 * The answer carries the point to tap (`ResolvedClear.point`). Used by
 * tapElement (the flow `tap:` step and the MCP `tap` tool) and by
 * fillField's focus tap; there is no third tap on a resolved node.
 *
 * The problem, measured on a device (finportal login, Pixel_3a,
 * Android 13): after the password fill the keyboard was up, covering
 * y ≥ 1285; `login_submit` resolved and settled with its centre at
 * (249,1466); the tap pressed a keyboard key — one stray character in the
 * password field, nothing submitted, the tap reported done. On Android the
 * keyboard is another window: the app's tree neither contains it nor moves
 * out of its way unless the activity resizes. A fill has the same exposure
 * when the NEXT field sits under the keyboard the previous one raised. On
 * iOS the keyboard is part of the tree and the measured tap
 * went into the AutoFill bar above its keys.
 *
 * The protocol, the same shape on both models:
 *   resolve → read the keyboard (`readKeyboard(…).over`: the oracle when the
 *   adapter has one, else the band the tree source marked in the tree that
 *   resolved the target — no device asked; `unknown` when the target is the
 *   keyboard's own UI; covered, the input method's word over it) → tap
 *   point outside it (or hidden, or unknown): done, the node as resolved —
 *   the fail-open rule, below. Inside it: the model's `guard` — its own
 *   re-checks before anything is done (the window model, on a witness that
 *   DENIED the keyboard, waits out a stale window state; the in-tree model
 *   takes a second look, the hide delay first, and
 *   picks a configured dismissal), which may hand the node back clear with
 *   a note, refuse with nothing sent, or name the `Hiding`. Then ONE side
 *   effect (`back`, or a tap on the picked element — the model's; never
 *   repeated) and the confirming looks (`confirmHidden`): the hide delay,
 *   the target resolved AGAIN with the same options (an adjustResize
 *   activity re-lays-out when the keyboard goes, and so does the iOS
 *   keyboard-avoiding layout: the node the first read chose is no longer
 *   where it was), the keyboard read against where it is now — clear, or
 *   unreadable (fail open, the note saying so): that node, with the model's
 *   `keyboardHidden` sentence; still covering on the last look, or the
 *   target not coming back on any: the model's failure, which says what
 *   was done to the screen first (`back` was pressed; that tap cannot be
 *   untapped). One look after `back`, KEYBOARD_HIDE_CONFIRM_LOOKS after a
 *   dismissal tap — the model's number, its reason beside it.
 *
 * Cost on Android: what the reading's `over` asks on the first look, and
 * what the look after a dismissal and the re-check rounds add — every
 * figure is on ui-tree/keyboard-cover.ts (WHAT A READING ASKS), the one
 * place they are counted. A `type_pin` keypad taps once per digit, so it
 * pays a tap's first look per digit — a 6-digit PIN is 6 dumpsys calls (12
 * with a keyboard up), beside six tree-settle waits of seconds each. On iOS: no device read for the
 * keyboard on any look, ever. The on-screen rule adds `viewport()` per tap,
 * which the adapter memoizes: one `wm size` / `idb describe` per adapter,
 * re-asked only after a failed read. In memory, the on-screen rule asks the
 * node's whole standing (ui-tree/standing.ts#Scene: the tree's draw order
 * and clip facts, one exposure) before the guard; the clear path reuses it,
 * and a guard that acted asks it once more, of the tree it hands back. A
 * raw coordinate tap does not come through here: the caller chose that
 * point.
 *
 * Rejected: hiding the keyboard before every tap (a `back` per tap, and a
 * navigation whenever the adapter is wrong); scrolling the target into view
 * instead (scrolls a screen the author did not ask to scroll, and a
 * non-scrolling login form has nowhere to go); tapping anyway and reporting
 * it (the stray character is already in the field) — which is also why a
 * tap is not sent on ONE sample in which the input method contradicts the
 * window state: the input method can be the
 * stale side too (an IME switch or restart, a hide recorded but not yet
 * applied), and then that tap is the stray character. Also rejected: one
 * decision table over all four window-model phases (keyboard-window.ts says
 * why).
 */
export async function resolveClearOfKeyboard(adapter: KeyboardAdapter, target: Target, opts: GuardOptions): Promise<ResolvedClear> {
  const first = await resolveSettled(adapter, target, opts);
  // The keyboard read off the first look's tree — building it asks nothing;
  // its questions are put below, in the module doc's order.
  const reading = readKeyboard(adapter, first.tree);
  const opened = judging(first, reading);
  // The other rule every tap on a resolved node shares: its point must lie
  // ON the screen (resolve.ts#judgeTap, the reasons there). Asked before the
  // keyboard is, so a target below the fold costs no `back` and no
  // dismissal tap; asked again of the node a guard that acted hands back,
  // since the layout moves when the keyboard goes (an iOS keyboard-avoiding
  // scroll view scrolls back down). The screen comes from the first read's
  // tree — the orientation does not turn inside one tap — or from the
  // re-read a refusal makes first.
  const judge = await judgeTap(adapter, target, opened.look, await usableScreen(adapter, { tree: first.tree }), opened.keyboard);
  const { screen } = judge;
  const at = tapPoint(first.node);
  const opening = await reading.over(at, first.node);
  // THE guard's one fail-open rule, applied here and wherever a model reads
  // the keyboard again: nothing over the point — hidden, a frame elsewhere —
  // or a state that could not be read means the tap goes ahead as before
  // the question existed. The question exists to make a tap safer and must
  // never be the reason a tap did not happen; a device that is really gone
  // fails the tap itself, in the tap's own words. Only a COVERING reading —
  // the input method standing by it or denying it — reaches a model.
  // The LAST rule — nothing of the app drawn over the point, else an
  // uncovered piece of the target or a CoveredRefusal, and first no target
  // cut to a sliver (a ClippedRefusal) — is the judgement's `aim()`
  // (resolve.ts#TapJudge.aim, the reasons there), on the look the tap goes
  // to: the keyboard is read for it only when the centre is covered, off
  // that look's own reading, so what it already asked is not asked again.
  if (opening.kind === 'clear' || opening.kind === 'unknown') return clearOf(first, await judge.aim());

  // Chosen here, not above: the clear path allocates nothing, and the two
  // reads of `adapter.keyboard` — readKeyboard's and this — sit together.
  const model = keyboardModel(adapter);
  const what = describeTarget(target);
  const ready = await model.guard({ target, opts, point: at, screen, verdict: opening, what, covered: `the soft keyboard covered ${what}` });
  if ('cleared' in ready) {
    // Handed back clear, nothing sent: judged again on the tree that holds the node, off a reading of it.
    const back = judging(ready.cleared, readKeyboard(adapter, ready.cleared.tree));
    return clearOf(ready.cleared, await (await judgeTap(adapter, target, back.look, screen, back.keyboard)).aim());
  }
  const { hiding } = ready;
  await hiding.perform();
  const cleared = await confirmHidden<{ look: ClearedLook; reading: KeyboardReading }, { frame: Rect; point: Point }>(
    hiding.looks,
    async () => {
      const look = await lookAgain(adapter, target, opts, hiding.failed);
      return look.verdict.kind === 'covered'
        ? { stillUp: { frame: look.verdict.frame, point: look.point } }
        : { gone: { look: withNote(look.resolved, hiding.hidden(look.verdict)), reading: look.reading } };
    },
    (seen, looks) => hiding.stillCovering(seen, looks),
  );
  // After the side effect: judged again with `sent`, the headline of any refusal.
  const after = judging(cleared.look, cleared.reading);
  return clearOf(cleared.look, await (await judgeTap(adapter, target, after.look, screen, after.keyboard, hiding.sent)).aim());
}

/** A look as the tap judges it (resolve.ts#judgeTap): its node and tree with the tree's scene, and where the keyboard lies on it — a position over that scene and the look's `reading`, whose remedy the refusals say. */
function judging(r: { readonly node: UiNode; readonly tree: UiNode }, reading: KeyboardReading): { look: TapLook; keyboard: { position: KeyboardPosition; remedy: KeyboardRemedy } } {
  const look: TapLook = { node: r.node, tree: r.tree, scene: sceneOf(r.tree) };
  return { look, keyboard: { position: keyboardPosition(look.scene.order, reading), remedy: reading.remedy } };
}

/** The guard's answer: the look the tap goes to, with what its judgement aimed at. */
function clearOf(r: ClearedLook, { point, moved }: Aim): ResolvedClear {
  return { node: r.node, note: r.note, ...(r.keyboardHidden !== undefined && { keyboardHidden: r.keyboardHidden }), point, ...(moved !== undefined && { moved }) };
}

/**
 * Close the on-screen keyboard after a fill. Called AFTER a fill has
 * returned, never before (dismissing first closes the keyboard the typing
 * needs), and as its own call so the fill's warning is already in the
 * caller's hands if this throws. Here because this is where the one `back`
 * lives: the `unknown → back` rule has one copy. The protocol is the model's
 * (`KeyboardModel.dismiss`, with the reasons): the window model presses
 * `back` unless the state is hidden or the witness denies the keyboard, and
 * confirms nothing; the in-tree model reads one tree, taps the first
 * usable configured dismissal when a band is up, confirms with up to
 * KEYBOARD_HIDE_CONFIRM_LOOKS re-reads, and returns a warning — not a
 * throw — when nothing usable is configured.
 */
export function dismissKeyboard(adapter: KeyboardAdapter, opts: DismissOptions): Promise<DismissResult> {
  return keyboardModel(adapter).dismiss(opts);
}
