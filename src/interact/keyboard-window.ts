import type { KeyboardOracle, KeyboardWitness } from '../adapters/types.js';
import { tapPoint } from '../ui-tree/selectors.js';
import { sleep } from '../util/sleep.js';
import {
  failedLookMessage,
  frameText,
  KeyboardGuardError,
  keyboardOver,
  withNote,
  type CoveredLook,
  type DismissResult,
  type Hiding,
  type KeyboardAdapter,
  type KeyboardModel,
  type ResolvedClear,
} from './keyboard-model.js';
import { resolveSettled } from './resolve.js';

/**
 * The WINDOW model (Android): the soft keyboard is a window of its own,
 * absent from the uiautomator tree — a node under it resolves, settles and
 * reports a rect like any other, and a tap at its centre presses a key
 * (measured 2026-10-03, finportal login: a stray character in the password
 * field, nothing submitted, the tap reported done). The adapter's oracle
 * (`KeyboardOracle`, adapters/types.ts) answers where it is (`state()`, one
 * `dumpsys window displays`) and, independently, whether the input method
 * says one is shown at all (`witness()`); `back` hides it. This module owns
 * everything that follows from those three facts: the veto the witness
 * holds over the key, the bounded re-check a veto starts, the one look
 * after the key, the blind dismissal after a fill, and the words — one
 * adapter at the seam `keyboard-model.ts` describes, beside the in-tree
 * model. Chosen by `keyboard.ts#keyboardModel` for an adapter WITH the
 * oracle; the platform label is never read.
 */

/**
 * The vetoed path's bounded re-check (2026-10-04, after review): when the
 * window state says a keyboard covers the tap point and the input method
 * says none is shown, NOTHING is sent on that one disagreeing sample. Both
 * sources are asked again every KEYBOARD_DISAGREEMENT_POLL_MS for at most
 * KEYBOARD_DISAGREEMENT_BUDGET_MS.
 *
 * The figures come from the one measurement there is (Pixel_3a AVD, API 33,
 * that day): after a tap that navigated away, the window state went on
 * reporting the keyboard, full frame, for "a few seconds" — it had cleared
 * by the third of three samples taken a second apart — while the input
 * method already said not shown. Three seconds covers that; half a second
 * is the settle poll's cadence (resolve.ts), so a stale state is noticed
 * clearing within one round. Six rounds, twelve cheap queries at worst
 * (their cost: AndroidAdapter's keyboardState / keyboardWitness).
 */
export const KEYBOARD_DISAGREEMENT_POLL_MS = 500;
export const KEYBOARD_DISAGREEMENT_BUDGET_MS = 3_000;

/**
 * Anything that went wrong AFTER `back` was pressed (review 2026-10-03). The
 * key press is a side effect that cannot be taken back and cannot be made
 * conditional — `input keyevent 4` has no "only if the IME is up" form — so
 * between the adapter saying "shown" and the key landing, a keyboard that
 * hid by itself (or a wrong "shown") turns `back` into a NAVIGATION. The
 * race cannot be removed; it can be reported. (Seen for real the same day,
 * by hand: a system search screen that had raised its keyboard on two
 * earlier visits did not on the third, and the `back` meant for the keyboard
 * sent the app beneath it to the background.) Every failure past the key
 * press is therefore this class: its message says back was pressed, and
 * `backPressed` (its `traceLine`) carries the trace-sized sentence for the
 * flow engine. The original error is the `cause`.
 */
export class AfterKeyboardDismissal extends KeyboardGuardError {
  /** `the soft keyboard covered <target>; back pressed` — the trace line, under the name that says what it records. */
  readonly backPressed: string;
  constructor(message: string, backPressed: string, options?: ErrorOptions) {
    super(message, backPressed, options);
    this.name = 'AfterKeyboardDismissal';
    this.backPressed = backPressed;
  }
}

/**
 * The two sources would not agree within the budget (2026-10-04): the window
 * state kept a keyboard over the tap point, the input method kept saying
 * none is shown. NOT an AfterKeyboardDismissal — no `back` was pressed, and
 * no tap was sent either: `back` would navigate if the input method is
 * right, the tap would press a keyboard key if the window state is. A
 * refusal, because acting on either guess is the harm this guard exists to
 * prevent.
 */
export class KeyboardStateDisagreement extends KeyboardGuardError {
  constructor(message: string, traceLine: string) {
    super(message, traceLine);
    this.name = 'KeyboardStateDisagreement';
  }
}

// ─── The decisions ───────────────────────────────────────────────────────────
//
// 2026-10-05 (verification pass, V1). Until this date the four moments at
// which the guard and the dismissal decide — the first look, a re-check
// round, the look after the one `back`, the post-fill dismissal — were ONE
// table over one union of samples, returning one four-way action. The table
// was honest about the rows but dishonest about the shape: each phase can
// produce only a subset of the four answers (the first look never `refuse`s,
// the look after the back never `back`s again), so every call site switched
// over answers its phase could not get, five `unexpected()` throws guarded
// arms no input could reach (and no test did), a `judge` helper rebuilt the
// sample from loose fields, `hold` meant "wait and ask again" in the guard
// and "do nothing" in the dismissal, and the budget rule lived in the loop
// while the `last` flag it fed lived in the table. The guard read worse than
// before the table existed. So each phase became its own pure, synchronous
// decision with its own result type, and the compiler — not a runtime throw
// — ruled out the impossible arms.
//
// 2026-10-07 (the keyboard-model review): two of the four — `firstLook`
// (witness hidden → hold, else back) and `afterBack` (covering → refuse,
// else proceed) — were one ternary each over one input, and their row
// tests tested the ternary while the bugs that bit lived in the
// orchestration around it; they failed the deletion test. `firstLook` is
// the `if (witness === 'hidden')` in `windowModel.guard` below, its rows
// beside it; `afterBack`'s branch is the skeleton's one shared ternary
// over the confirming look (keyboard.ts#resolveClearOfKeyboard, the same
// for both models), and its rows — the reasons behind proceed and refuse
// on THIS model — sit on the window `Hiding` that supplies the words.
// The two that carry a RULE stay functions: `recheck` holds the budget rule
// beside the answer it shapes, `dismissal` the one `unknown → back` row in
// the codebase. What the table got right stays too: one `pressKey('back')`
// in the codebase (`pressBack`, below), one `unknown → back` rule (the
// dismissal's) and one `unknown → proceed` rule (the guard's, in
// keyboard.ts), each with its reason beside it. Proven unchanged by an
// old-vs-new differential over seeded window/witness/back-effect sequences
// (the same harness that proved the table on 2026-10-04).

/**
 * The dismissal's reading of the window state — it has no point, so shown
 * ANYWHERE is `covering`, hidden is `clear`, and `unknown` is kept apart
 * because it is the one place unknown means back (`dismissal`). The guard
 * reads the state through `CoverReading` (keyboard-model.ts) instead, with
 * the frame.
 */
type WindowReading = 'covering' | 'clear' | 'unknown';

/**
 * What `dismissal` decides for ONE call: press `back`, or press nothing.
 * A decision, not a capability — `DismissalMeans` (ui-tree/soft-keyboard.ts,
 * `'back' | 'none'`) says what the ADAPTER has to hide a keyboard with,
 * fixed per adapter, and an adapter with `back` in hand still decides
 * `nothing` here when the state is hidden or the witness denies the
 * keyboard. Two literal sets on purpose: `none` is "no means", `nothing` is
 * "do nothing this time".
 */
export type DismissalDecision = 'back' | 'nothing';

/**
 * One round of the bounded re-check that a vetoed first look starts, while
 * the window state STILL covers the point (a round in which it stopped
 * covering ends the wait in the guard itself — the same fail-open rule as
 * the first look, resolve again and tap). The budget rule lives HERE,
 * beside the answer it shapes (`waitedMs` is how long the rounds have taken
 * so far).
 *
 *   witness shown                             → back   (even when the budget is spent)
 *     The input method has come round: the normal dismissal, as if it had
 *     said so at first.
 *   witness hidden / unknown                  → hold, or refuse once waitedMs ≥ KEYBOARD_DISAGREEMENT_BUDGET_MS
 *     A witness that said "hidden" half a second ago and cannot be reached
 *     now has confirmed nothing — so unlike the first look, `unknown` presses
 *     nothing here. When the budget ends still disagreeing: a refusal
 *     (KeyboardStateDisagreement) — acting on either guess is the harm.
 */
export function recheck(witness: KeyboardWitness, waitedMs: number): 'back' | 'hold' | 'refuse' {
  if (witness === 'shown') return 'back';
  return waitedMs >= KEYBOARD_DISAGREEMENT_BUDGET_MS ? 'refuse' : 'hold';
}

/**
 * The dismissal after a fill — no point, no second look; `covering` here
 * means shown anywhere.
 *
 *   window clear (hidden)                     → nothing
 *     Nothing to dismiss — back with no keyboard up NAVIGATES (the
 *     2026-10-03 finding: a custom PIN pad, a hardware keyboard, a picker).
 *   window unknown                            → back
 *     The ONE place unknown means back, exactly as before 2026-10-03: the
 *     adapter could not tell (the command failed, or printed a format it does
 *     not recognise), and after a fill a keyboard left up over the next tap
 *     is the likelier harm. No witness is asked: there is no window state
 *     for it to contradict.
 *   covering · witness shown / unknown        → back
 *   covering · witness hidden                 → nothing
 *     As the guard's first look: the veto applies to the dismissal too (the
 *     stale window state after a navigation is where it was measured), and
 *     with nothing to wait for, a denied keyboard is simply left alone.
 */
export function dismissal(window: 'clear' | 'unknown'): DismissalDecision;
export function dismissal(window: 'covering', witness: KeyboardWitness): DismissalDecision;
export function dismissal(window: WindowReading, witness?: KeyboardWitness): DismissalDecision {
  if (window !== 'covering') return window === 'unknown' ? 'back' : 'nothing';
  return witness === 'hidden' ? 'nothing' : 'back';
}

// ─── The model ───────────────────────────────────────────────────────────────

/**
 * THE ONE `back` averi sends for keyboard reasons (2026-10-04): the guard's
 * dismissal and `dismissKeyboard` both come through here, and only after a
 * decision has said `back` — on a witness asked immediately before, or on
 * `dismissal`'s one `unknown → back` row (no witness: there is no window
 * state for it to contradict) — never after the key, never on a path that
 * presses nothing.
 */
const pressBack = (adapter: KeyboardAdapter): Promise<void> => adapter.pressKey('back');

/**
 * The window model over one adapter and its oracle. `guard` and `dismiss`
 * are the protocols ARCHITECTURE.md §8 describes; the facts behind each
 * row are at the row.
 */
export function windowModel(adapter: KeyboardAdapter, oracle: KeyboardOracle): KeyboardModel {
  return {
    /**
     * The guard's protocol once the window state has put a keyboard over
     * the tap point: ask the witness, press `back` unless it DENIES the
     * keyboard — the "shown" just read can be stale and `back` with no
     * keyboard up navigates away. Denied: nothing is sent, neither back nor
     * the tap; both sources are asked again for a bounded time (`recheck`,
     * the constants above):
     *   · the window state stops covering the point (hidden, a frame
     *     elsewhere, or unknown — fail open as everywhere): resolve AGAIN
     *     (time has passed) and hand back that node, with a note that says
     *     the wait happened — kept rather than dropped as noise, because up
     *     to three seconds of a step's time need an explanation in the
     *     trace, and a later surprise on this screen should point here;
     *   · the witness turns to `shown`: the normal dismissal, as if it had
     *     said so at first;
     *   · still disagreeing when the budget ends: KeyboardStateDisagreement —
     *     nothing was sent.
     * Then the `Hiding`: the one `back`, and ONE look after it — the frame
     * decides, never a loop: a keyboard `back` does not hide (a field that
     * re-requests it, an IME that ignores back) would be a `back` per round,
     * and the second one navigates. Anything that fails from the key press
     * on — the target not coming back, a refusal, the keyboard staying — is
     * an AfterKeyboardDismissal: the message says `back` was pressed (see
     * the class).
     *
     * Cost: the witness query (AndroidAdapter's keyboardWitness has its
     * cost), the second resolve and the second `state()` query happen only
     * here, in the overlap case; a clear first look pays one query, in
     * keyboard.ts.
     */
    async guard({ target, opts, point: at, frame, what, covered }: CoveredLook): Promise<{ cleared: ResolvedClear } | { hiding: Hiding }> {
      const backPressed = `${covered}; back pressed`;
      /** The input method's last word — the wording of a later failure depends on whether it could be asked. */
      let witness = await oracle.witness();
      /** The point being judged: the first resolution's, until a look during the wait finds the target elsewhere. */
      let judged = at;
      /** How long the input method took to confirm the keyboard, when it denied it at first. */
      let confirmedAfterMs: number | undefined;

      // The FIRST look, once the window state covers the point (the
      // not-covering case never reaches this model — keyboard.ts's one
      // fail-open rule):
      //   witness shown / unknown                   → back
      //     The decision the window state alone made before the veto existed
      //     (2026-10-04): a witness that cannot be asked — adb failure, an
      //     Android version that does not print `mInputShown` (unverified
      //     outside API 33; the stale-window hazard REMAINS there) — leaves
      //     it standing.
      //   witness hidden                            → hold
      //     The veto. The window state can be stale for seconds after a
      //     navigation (measured that day: full frame reported, input method
      //     already said not shown); `back` then navigates, a tap then
      //     presses a key. Nothing is sent on one disagreeing sample; the
      //     re-check rounds follow.
      if (witness === 'hidden') {
        const disagreement = `the window state reported a soft keyboard over ${what} that the input method denied`;
        let stillCovering = frame;
        for (let waited = KEYBOARD_DISAGREEMENT_POLL_MS; ; waited += KEYBOARD_DISAGREEMENT_POLL_MS) {
          await sleep(KEYBOARD_DISAGREEMENT_POLL_MS);
          const now = await oracle.state();
          let window = keyboardOver(now, judged);
          if (window.over !== 'covering') {
            const settled = await resolveSettled(adapter, target, opts);
            // The frame just read is tested against where the target is NOW —
            // free, `now` is in hand: a frame that left the old point but lies
            // over the new one (the layout moved while averi waited) is still a
            // keyboard over the target, and the wait goes on with that point.
            const moved = tapPoint(settled.node);
            window = keyboardOver(now, moved);
            if (window.over !== 'covering') {
              // The keyboard left the point (or the state could not be read): the
              // fail-open rule — proceed, saying how long the wait took.
              return {
                cleared: withNote(
                  settled,
                  window.over === 'unknown'
                    ? `${disagreement}; waited ${waited}ms, then the window state could not be read`
                    : `${disagreement}; waited ${waited}ms for it to clear`,
                ),
              };
            }
            judged = moved;
          }
          stillCovering = window.frame;
          witness = await oracle.witness();
          const round = recheck(witness, waited);
          if (round === 'back') {
            confirmedAfterMs = waited; // confirmed: the normal dismissal below
            break;
          }
          if (round === 'refuse') {
            // The last answer decides the wording: a witness that could not be
            // asked in the later rounds ends here too, and "says no keyboard is
            // shown" would then claim an answer nobody gave.
            const inputMethod =
              witness === 'unknown'
                ? `the input method said none was shown at first, then could not be asked, and nothing had confirmed a ` +
                  `keyboard after ${KEYBOARD_DISAGREEMENT_BUDGET_MS}ms`
                : `the input method says no keyboard is shown, and the two still disagreed after ${KEYBOARD_DISAGREEMENT_BUDGET_MS}ms`;
            // Names MCP tools and "a flow" — the deliberate exception recorded
            // at the "back did not close it" error below. The flow half names
            // only what a flow can do: `wait:` takes an element or a state,
            // never a duration, and nothing in a flow waits on the keyboard.
            throw new KeyboardStateDisagreement(
              `The window state reports a soft keyboard over ${what} — its frame ${frameText(stillCovering)} ` +
                `contains the tap point (${judged.x},${judged.y}) — but ${inputMethod}. Neither back nor the tap was sent: ` +
                `back would navigate away if no keyboard is up, and the tap would press a key if one is. From the MCP tools: ` +
                `look at the screen (ui_snapshot / screenshot), then tap again, or press_key back yourself if a keyboard is ` +
                `visibly up. In a flow: wait for an element or state that only holds once the screen has settled after the ` +
                `previous step (wait: { element: … } / wait: { state: … }), or fix the screen so the target is not under a ` +
                `keyboard — no flow step waits on the keyboard itself`,
              `${disagreement}; nothing sent`,
            );
          }
          // hold: one more round
        }
      }

      const did = `pressing back to hide the soft keyboard that covered ${what} at (${judged.x},${judged.y})`;
      // When the witness could not be asked, back went out on the window state
      // alone — the fallback — and the reader must know the veto did not run.
      const hint =
        (witness === 'unknown'
          ? 'If no keyboard was really up at that moment (the input method could not be asked whether a keyboard was shown), '
          : 'If no keyboard was really up at that moment, ') +
        'back may have navigated away — check the screen (ui_snapshot / screenshot)';
      return {
        hiding: {
          perform: () => pressBack(adapter),
          // The look after the one `back`, to confirm the keyboard went: the
          // skeleton's one confirming look (`lookAgain` — the first look's
          // reading rule, the oracle asked once more), the branch its shared
          // ternary. No witness: the key is already pressed, the frame decides
          // — and comes back with the refusal, so the message can quote it
          // without a second look.
          //   window clear / unknown                    → proceed (`hidden`)
          //     Gone, unreadable, or a frame still shown but elsewhere — fail
          //     open; the note says when the state could not be read, and says
          //     "hidden" for the frame elsewhere too: after `back` that is a
          //     floating or split IME that moved, unmeasured, and the wording
          //     is not changed without a measurement (the in-tree model's
          //     `clear` row, measured on the keyboard-avoiding layout, has its
          //     own sentence).
          //   covering                                  → refuse (`stillCovering`)
          //     Still covered after the one dismissal: THROW, tap nothing.
          looks: 1,
          // The target did not come back (or came back ambiguous). Say what
          // averi did to the screen first: without it the caller reads a bare
          // timeout on a screen that `back` may have left.
          failed: (e) =>
            new AfterKeyboardDismissal(
              failedLookMessage(e, `This was the second look, after ${did}. ${hint}`, (headline) => `After ${did}: ${headline}. ${hint}`),
              backPressed,
              { cause: e },
            ),
          // `unknown` after the dismissal fails open like everywhere else — the
          // tap goes ahead — but the note must not claim what was not seen.
          hidden: (after) =>
            after.over === 'unknown'
              ? `${backPressed}; the keyboard's state afterwards could not be read`
              : confirmedAfterMs === undefined
                ? `${covered}; hidden before tapping`
                : `${covered}; hidden before tapping (after waiting ${confirmedAfterMs}ms for the input method to confirm it)`,
          // Honest advice only (review 2026-10-03): scroll_until stops as soon
          // as the target intersects the viewport, which a node under the
          // keyboard already does; tapping outside a field does not close the
          // Android IME; `enter` may submit the form; and a flow has neither a
          // key step nor a coordinate tap.
          //
          // A deliberate exception, 2026-10-03, of the kind launchRefused's comment
          // records in adapters/android.ts: this string names MCP tools
          // (ui_snapshot, press_key) and speaks of "a flow", vocabulary of the
          // two layers ABOVE interact. Kept, as in verify/capture.ts and
          // interact/scroll.ts: the reader's next move differs per surface, and
          // one message with two honest halves beats two translation sites that
          // must agree. Only words cross the layer, no import.
          stillCovering: ({ frame: still, point }) =>
            new AfterKeyboardDismissal(
              `Pressed back to hide the soft keyboard covering ${what}, but back did not close it: the keyboard frame ` +
                `${frameText(still)} still contains the tap point (${point.x},${point.y}); nothing was tapped. ` +
                `From the MCP tools: inspect the screen with ui_snapshot, then press_key back once more or tap a control above ` +
                `the keyboard. In a flow: no step can recover this — the screen keeps a keyboard that back does not close ` +
                `over ${what} — fix the screen (or the test data) so the target is not under the keyboard`,
              backPressed,
            ),
        },
      };
    },

    /**
     * The dismissal after a fill, since 2026-10-03: `back` is pressed only
     * if the window state does not say the keyboard is HIDDEN. Before that
     * date it was pressed blindly, and `back` with no keyboard up NAVIGATES
     * BACK — a field that raises no keyboard (a custom PIN pad, a hardware
     * keyboard, a picker) turned `dismissKeyboard: true` into leaving the
     * screen. The rows (and their reasons) are `dismissal`'s:
     * - shown   → back — unless, since 2026-10-04, the independent witness
     *   denies the keyboard: then nothing is pressed, and nothing is waited for;
     * - hidden  → nothing: there is nothing to dismiss;
     * - unknown → back, exactly as before, the witness not asked.
     * One oracle query per dismissal (its cost: AndroidAdapter's
     * keyboardState), and the witness query when that query says shown. No
     * read after the `back` confirms it went: best effort, as the warning
     * the in-tree model returns instead of a throw relies on. Reads none of
     * the options and returns an empty result — a run with dismissals
     * configured is byte-identical to one without.
     */
    async dismiss(): Promise<DismissResult> {
      const state = await oracle.state();
      // Shown ANYWHERE is in the way — there is no point to test.
      const reading: WindowReading = state.state === 'shown' ? 'covering' : state.state === 'hidden' ? 'clear' : 'unknown';
      const decision = reading === 'covering' ? dismissal(reading, await oracle.witness()) : dismissal(reading);
      if (decision === 'back') await pressBack(adapter);
      return {};
    },
  };
}
