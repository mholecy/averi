import type { Point, Rect } from '../adapters/types.js';
import { tapPoint } from '../ui-tree/selectors.js';
import { readSoftKeyboard } from '../ui-tree/soft-keyboard.js';
import { inTreeModel } from './keyboard-in-tree.js';
import {
  confirmHidden,
  lookAgain,
  keyboardOver,
  withNote,
  type DismissOptions,
  type DismissResult,
  type GuardOptions,
  type KeyboardAdapter,
  type KeyboardModel,
  type ResolvedClear,
} from './keyboard-model.js';
import { windowModel } from './keyboard-window.js';
import { describeTarget, resolveSettled, type Resolved, type Target } from './resolve.js';

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
 * THE one choice between the two models for ACTING (2026-10-07, the
 * keyboard-model review; the reading half's one switch — the keyboard read
 * for a subject, the guard's looks and the pixel poll's round — is
 * `ui-tree/soft-keyboard.ts#readSoftKeyboard`, one layer down, because the
 * pixel poll reads the keyboard too; each model's `dismiss`, which has no
 * subject, reads its own source): an adapter WITH the oracle gets the
 * window model, one without the in-tree model. Whether the adapter HAS an
 * oracle carries the platform fact — `KeyboardOracle` (adapters/types.ts)
 * says what providing one asserts — so no platform test is made here
 * (dropped 2026-10-03, after review: this layer is platform-agnostic,
 * ARCHITECTURE.md §2). Until this date the same question was asked in two
 * more places, inside the guard and inside the dismissal, and each answer
 * re-implemented the shape below around its own decisions.
 */
function keyboardModel(adapter: KeyboardAdapter): KeyboardModel {
  return adapter.keyboard === undefined ? inTreeModel(adapter) : windowModel(adapter, adapter.keyboard);
}

/** The guard's answer when it had nothing to do: the node and its note, without the tree the resolution rode in on. */
const bare = ({ node, note }: Resolved): ResolvedClear => ({ node, note });

/**
 * resolveSettled, plus the one rule every tap on a resolved node shares
 * (2026-10-03): the point about to be tapped must not lie under the soft
 * keyboard. Used by tapElement (the flow `tap:` step and the MCP `tap` tool)
 * and by fillField's focus tap; there is no third tap on a resolved node.
 *
 * The problem, measured on a device that day (finportal login, Pixel_3a,
 * Android 13): after the password fill the keyboard was up, covering
 * y ≥ 1285; `login_submit` resolved and settled with its centre at
 * (249,1466); the tap pressed a keyboard key — one stray character in the
 * password field, nothing submitted, the tap reported done. On Android the
 * keyboard is another window: the app's tree neither contains it nor moves
 * out of its way unless the activity resizes. A fill has the same exposure
 * when the NEXT field sits under the keyboard the previous one raised. On
 * iOS (2026-10-07) the keyboard is part of the tree and the measured tap
 * went into the AutoFill bar above its keys.
 *
 * The protocol, the same shape on both models:
 *   resolve → read the keyboard (`readSoftKeyboard`: the oracle's `state()`
 *   when the adapter has one, else the band the tree source marked in the
 *   tree that resolved the target — no device asked; `unknown` when the
 *   target is the keyboard's own UI) → tap point outside it (or hidden, or
 *   unknown): done, the node as resolved — the fail-open rule, below.
 *   Inside it: the model's `guard` — its own re-checks before anything is
 *   done (the window model asks the witness and waits out a stale window
 *   state; the in-tree model takes a second look, the hide delay first, and
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
 * Cost on Android: ONE oracle query per tap when nothing covers the target
 * (what one call costs is measured on AndroidAdapter's keyboardState, the one
 * place the figures are kept); the second resolve and the second query
 * happen only in the overlap case, and so does the witness query
 * (AndroidAdapter's keyboardWitness has its cost). A `type_pin` keypad taps
 * once per digit, so it asks once per digit — a 6-digit PIN is 6 dumpsys
 * calls, six times that figure, beside six tree-settle waits of seconds
 * each. On iOS: no device read for the keyboard on any look, ever. A raw
 * coordinate tap does not come through here: the caller chose that point.
 *
 * Rejected: hiding the keyboard before every tap (a `back` per tap, and a
 * navigation whenever the adapter is wrong); scrolling the target into view
 * instead (scrolls a screen the author did not ask to scroll, and a
 * non-scrolling login form has nowhere to go); tapping anyway and reporting
 * it (the stray character is already in the field) — which is also why a
 * tap is not sent on ONE sample in which the input method contradicts the
 * window state (b631792 did that for a day): the input method can be the
 * stale side too (an IME switch or restart, a hide recorded but not yet
 * applied), and then that tap is the stray character. Also rejected, after
 * a day in the tree (2026-10-04 → 2026-10-05): one decision table over all
 * four window-model phases — the dated banner in keyboard-window.ts.
 */
export async function resolveClearOfKeyboard(adapter: KeyboardAdapter, target: Target, opts: GuardOptions): Promise<ResolvedClear> {
  const first = await resolveSettled(adapter, target, opts);
  const at = tapPoint(first.node);
  const opening = keyboardOver((await readSoftKeyboard(adapter, first.tree, first.node)).keyboard, at);
  // THE guard's one fail-open rule, applied here and wherever a model reads
  // the keyboard again: nothing over the point — hidden, a frame elsewhere —
  // or a state that could not be read means the tap goes ahead as before
  // the question existed. The question exists to make a tap safer and must
  // never be the reason a tap did not happen; a device that is really gone
  // fails the tap itself, in the tap's own words. Only a COVERING reading
  // reaches a model.
  if (opening.over !== 'covering') return bare(first);

  // Chosen here, not above: the clear path allocates nothing, and the two
  // reads of `adapter.keyboard` — readSoftKeyboard's and this — sit together.
  const model = keyboardModel(adapter);
  const what = describeTarget(target);
  const ready = await model.guard({ target, opts, point: at, frame: opening.frame, what, covered: `the soft keyboard covered ${what}` });
  if ('cleared' in ready) return ready.cleared;
  const { hiding } = ready;
  await hiding.perform();
  return confirmHidden<ResolvedClear, { frame: Rect; point: Point }>(
    hiding.looks,
    async () => {
      const look = await lookAgain(adapter, target, opts, hiding.failed);
      return look.reading.over === 'covering' ? { stillUp: { frame: look.reading.frame, point: look.point } } : { gone: withNote(look.resolved, hiding.hidden(look.reading)) };
    },
    (seen, looks) => hiding.stillCovering(seen, looks),
  );
}

/**
 * Close the on-screen keyboard after a fill. Called AFTER a fill has
 * returned, never before (dismissing first closes the keyboard the typing
 * needs), and as its own call so the fill's warning is already in the
 * caller's hands if this throws. Moved here from fill.ts on 2026-10-04,
 * because this is where the one `back` lives — fill.ts had kept a second
 * copy of the `unknown → back` rule. The protocol is the model's
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
