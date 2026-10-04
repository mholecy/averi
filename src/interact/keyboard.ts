import type { DeviceAdapter, KeyboardWitness, SoftKeyboard } from '../adapters/types.js';
import { tapPoint } from '../ui-tree/selectors.js';
import { sleep } from '../util/sleep.js';
import { errorMessage } from '../util/error-message.js';
import { AmbiguityRefusal, describeTarget, resolveSettled, type Resolved, type SettleOptions, type Target } from './resolve.js';

/**
 * Pause between the `back` that hides the keyboard and the re-resolution.
 * Measured 2026-10-03 (API 33 emulator): ~0.4 s after `back` the IME insets
 * already read `visible=false` but still carried the keyboard's full frame —
 * the hide animation was running — and ~0.9 s after, the frame was empty. The
 * settle poll that follows adds its own two tree reads on top (a uiautomator
 * dump is about a second each), so this is the floor, not the whole wait: it
 * keeps the FIRST of those reads from seeing the pre-resize layout twice and
 * calling it settled.
 */
export const KEYBOARD_HIDE_DELAY_MS = 300;

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
 * (their cost: AndroidAdapter.softKeyboard / softKeyboardWitness).
 */
export const KEYBOARD_DISAGREEMENT_POLL_MS = 500;
export const KEYBOARD_DISAGREEMENT_BUDGET_MS = 3_000;

/** A resolved node whose tap point no soft keyboard covers. */
export interface ResolvedClear extends Resolved {
  /**
   * Set when the guard had to do something before the tap — the sentence
   * itself: `back` pressed and the keyboard hidden; pressed and unconfirmed;
   * or, since 2026-10-04, nothing pressed but a wait for a window state the
   * input method contradicted. It is ALSO folded into `note`, so a caller
   * that prints notes (the MCP tools) needs nothing new; a caller that does
   * not (the flow trace) reads this field to say the one thing it must.
   */
  keyboardHidden?: string;
}

/**
 * A failure of the keyboard guard that the caller must be able to SEE in a
 * trace: `traceLine` is the trace-sized sentence the flow engine logs as
 * `⚠ tap` / `⚠ fill` BEFORE the step's `✗` line (one tracing path for both
 * subclasses, flow/engine.ts#tracingDismissal).
 */
export class KeyboardGuardError extends Error {
  constructor(
    message: string,
    readonly traceLine: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

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

/**
 * THE ONE `back` averi sends for keyboard reasons (2026-10-04) — the tap
 * guard's dismissal and `dismissKeyboard` both come through here — with an
 * independent veto immediately before the key press.
 *
 * Why: the window state that says "shown" can be stale. Measured that day
 * (Pixel_3a, API 33; the figures and the dumps are on
 * AndroidAdapter.softKeyboardWitness): for a few seconds after a tap that
 * navigated away, `dumpsys window displays` still reported the keyboard with
 * its full frame while the input method itself already said it was not
 * shown. `back` pressed then, with no keyboard up, NAVIGATES.
 *
 * Call it only when the window state has just said `shown`. The witness:
 * - `shown`   → back is pressed;
 * - `hidden`  → NOTHING is pressed. What then is the caller's: dismissKeyboard
 *   stops there; the tap guard re-checks both sources for a bounded time
 *   (resolveClearOfKeyboard) — it does not tap on one disagreeing sample;
 * - `unknown` → by default back is pressed, i.e. the decision the window
 *   state alone made before this veto existed. That is the fallback for an
 *   adb failure and for an Android version that does not print
 *   `mInputShown` — unverified outside API 33, and on such a version the
 *   stale-window hazard REMAINS. `whenUnknown: 'hold'` presses nothing
 *   instead: the guard's re-check uses it, because a witness that said
 *   "hidden" half a second ago and cannot be reached now has not confirmed
 *   anything.
 * The witness is asked BEFORE the key, never after, and never on a path
 * that presses nothing: an ordinary tap costs what it did. The answer is
 * returned beside `pressed`, so a later failure can say when the input
 * method could not be asked.
 *
 * Rejected: trusting the window state alone (the measurement above); asking
 * the witness on every tap instead of the window state (it has no frame).
 */
export async function pressBackUnlessKeyboardDenied(
  adapter: Pick<DeviceAdapter, 'softKeyboardWitness' | 'pressKey'>,
  opts: { whenUnknown: 'press' | 'hold' } = { whenUnknown: 'press' },
): Promise<{ pressed: boolean; witness: KeyboardWitness }> {
  const witness = await adapter.softKeyboardWitness();
  if (witness === 'hidden' || (witness === 'unknown' && opts.whenUnknown === 'hold')) return { pressed: false, witness };
  await adapter.pressKey('back');
  return { pressed: true, witness };
}

const covers = (keyboard: SoftKeyboard, point: { x: number; y: number }): keyboard is SoftKeyboard & { state: 'shown' } =>
  keyboard.state === 'shown' &&
  point.x >= keyboard.frame.x &&
  point.x < keyboard.frame.x + keyboard.frame.width &&
  point.y >= keyboard.frame.y &&
  point.y < keyboard.frame.y + keyboard.frame.height;

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
 * when the NEXT field sits under the keyboard the previous one raised.
 *
 * The rule:
 *   resolve → ask the adapter where the keyboard is → tap point outside it
 *   (or hidden, or unknown): done, the node as resolved.
 *   Inside it: press `back` — through pressBackUnlessKeyboardDenied, which
 *   first asks an independent witness, because the "shown" just read can be
 *   stale and `back` with no keyboard up navigates away. If the witness
 *   DENIES the keyboard nothing is sent, neither back nor the tap: both
 *   sources are asked again for a bounded time (the constants above).
 *   · the window state stops covering the point (hidden, a frame elsewhere,
 *     or unknown — fail open as everywhere): resolve AGAIN (time has passed)
 *     and hand back that node, with a note that says the wait happened —
 *     kept rather than dropped as noise, because up to three seconds of a
 *     step's time need an explanation in the trace, and a later surprise on
 *     this screen should point here;
 *   · the witness turns to `shown`: the normal dismissal below, as if it had
 *     said so at first;
 *   · still disagreeing when the budget ends: KeyboardStateDisagreement —
 *     nothing was sent.
 *   After a pressed back: wait out the hide
 *   animation, resolve AGAIN with the same options (an adjustResize activity
 *   re-lays-out when the keyboard goes: the node the first read chose is no
 *   longer where it was), ask again, and only then hand back the node.
 *   Anything that fails from the key press on — the target not coming
 *   back, a refusal, the keyboard staying — is an AfterKeyboardDismissal:
 *   the message says `back` was pressed (see the class).
 *   Still covered after that one dismissal: THROW, tap nothing. Never a
 *   loop — a keyboard `back` does not hide (a field that re-requests it, an
 *   IME that ignores back) would be a `back` per round, and the second one
 *   navigates.
 *
 * No platform test here (dropped 2026-10-03, after review: this layer is
 * platform-agnostic, ARCHITECTURE.md §2): the adapter's answer already
 * carries it. iOS answers `unknown` without running anything
 * (IosAdapter.softKeyboard), and `unknown` means "tap as before" — so on
 * iOS the adapter is asked, no device is queried and no key is pressed. The
 * remedy (`back`) is an Android key, and only an adapter that says `shown`
 * ever reaches it.
 *
 * Cost on Android: ONE softKeyboard call per tap when nothing covers the
 * target (what one call costs is measured on AndroidAdapter.softKeyboard,
 * the one place the figures are kept); the second resolve and the second
 * call happen only in the overlap case, and so does the witness query
 * (AndroidAdapter.softKeyboardWitness has its cost). A `type_pin` keypad taps once per
 * digit, so it asks once per digit — a 6-digit PIN is 6 dumpsys calls, six
 * times that figure, beside six tree-settle waits of seconds each. A raw
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
 * applied), and then that tap is the stray character.
 */
export async function resolveClearOfKeyboard(
  adapter: Pick<DeviceAdapter, 'uiTree' | 'softKeyboard' | 'softKeyboardWitness' | 'pressKey'>,
  target: Target,
  opts: SettleOptions,
): Promise<ResolvedClear> {
  const first = await resolveSettled(adapter, target, opts);
  const at = tapPoint(first.node);
  const initial = await adapter.softKeyboard();
  if (!covers(initial, at)) return first;

  const what = describeTarget(target);
  /** The fact every sentence below starts from; each outcome appends its own ending. */
  const covered = `the soft keyboard covered ${what}`;
  const backPressed = `${covered}; back pressed`;
  let verdict = await pressBackUnlessKeyboardDenied(adapter);
  /** The point being judged: the first resolution's, until a look during the wait finds the target elsewhere. */
  let judged = at;
  /** How long the input method took to confirm the keyboard, when it denied it at first. */
  let confirmedAfterMs: number | undefined;
  if (!verdict.pressed) {
    // Vetoed: the window state says covered, the input method says no
    // keyboard. Send nothing on this one sample; ask both again, bounded.
    const disagreement = `the window state reported a soft keyboard over ${what} that the input method denied`;
    let stillCovering = initial;
    for (let waited = KEYBOARD_DISAGREEMENT_POLL_MS; !verdict.pressed; waited += KEYBOARD_DISAGREEMENT_POLL_MS) {
      await sleep(KEYBOARD_DISAGREEMENT_POLL_MS);
      const now = await adapter.softKeyboard();
      if (!covers(now, judged)) {
        const settled = await resolveSettled(adapter, target, opts);
        // The frame just read is tested against where the target is NOW —
        // free, `now` is in hand: a frame that left the old point but lies
        // over the new one (the layout moved while averi waited) is still a
        // keyboard over the target, and the wait goes on with that point.
        const moved = tapPoint(settled.node);
        if (!covers(now, moved)) {
          const keyboardHidden =
            now.state === 'unknown'
              ? `${disagreement}; waited ${waited}ms, then the window state could not be read`
              : `${disagreement}; waited ${waited}ms for it to clear`;
          return {
            node: settled.node,
            note: settled.note === undefined ? keyboardHidden : `${settled.note}; ${keyboardHidden}`,
            keyboardHidden,
          };
        }
        judged = moved;
      }
      if (covers(now, judged)) stillCovering = now;
      verdict = await pressBackUnlessKeyboardDenied(adapter, { whenUnknown: 'hold' });
      if (verdict.pressed) confirmedAfterMs = waited;
      else if (waited >= KEYBOARD_DISAGREEMENT_BUDGET_MS) {
        const { x, y, width, height } = stillCovering.frame;
        // The last answer decides the wording: with `hold`, a witness that
        // could not be asked in the later rounds ends here too, and "says no
        // keyboard is shown" would then claim an answer nobody gave.
        const inputMethod =
          verdict.witness === 'unknown'
            ? `the input method said none was shown at first, then could not be asked, and nothing had confirmed a ` +
              `keyboard after ${KEYBOARD_DISAGREEMENT_BUDGET_MS}ms`
            : `the input method says no keyboard is shown, and the two still disagreed after ${KEYBOARD_DISAGREEMENT_BUDGET_MS}ms`;
        // Names MCP tools and "a flow" — the deliberate exception recorded
        // at the "back did not close it" error below. The flow half names
        // only what a flow can do: `wait:` takes an element or a state,
        // never a duration, and nothing in a flow waits on the keyboard.
        throw new KeyboardStateDisagreement(
          `The window state reports a soft keyboard over ${what} — its frame [${x},${y}][${x + width},${y + height}] ` +
            `contains the tap point (${judged.x},${judged.y}) — but ${inputMethod}. Neither back nor the tap was sent: ` +
            `back would navigate away if no keyboard is up, and the tap would press a key if one is. From the MCP tools: ` +
            `look at the screen (ui_snapshot / screenshot), then tap again, or press_key back yourself if a keyboard is ` +
            `visibly up. In a flow: wait for an element or state that only holds once the screen has settled after the ` +
            `previous step (wait: { element: … } / wait: { state: … }), or fix the screen so the target is not under a ` +
            `keyboard — no flow step waits on the keyboard itself`,
          `${disagreement}; nothing sent`,
        );
      }
    }
  }
  await sleep(KEYBOARD_HIDE_DELAY_MS);

  let second: Resolved;
  try {
    second = await resolveSettled(adapter, target, opts);
  } catch (e) {
    // The target did not come back (or came back ambiguous). Say what averi
    // did to the screen first: without it the caller reads a bare timeout on
    // a screen that `back` may have left.
    const did = `pressing back to hide the soft keyboard that covered ${what} at (${judged.x},${judged.y})`;
    // When the witness could not be asked, back went out on the window state
    // alone — the fallback — and the reader must know the veto did not run.
    const hint =
      (verdict.witness === 'unknown'
        ? 'If no keyboard was really up at that moment (the input method could not be asked whether a keyboard was shown), '
        : 'If no keyboard was really up at that moment, ') +
      'back may have navigated away — check the screen (ui_snapshot / screenshot)';
    const [headline, ...rest] = errorMessage(e).split('\n');
    const message =
      e instanceof AmbiguityRefusal
        ? // A refusal's first line is the finding (and the trace's ✗ headline): kept as is, the context below it.
          `${errorMessage(e)}\n(This was the second look, after ${did}. ${hint})`
        : [`After ${did}: ${headline}. ${hint}`, ...rest].join('\n');
    throw new AfterKeyboardDismissal(message, backPressed, { cause: e });
  }
  const point = tapPoint(second.node);
  const after = await adapter.softKeyboard();
  if (covers(after, point)) {
    const { x, y, width, height } = after.frame;
    // Honest advice only (review 2026-10-03): scroll_until stops as soon as
    // the target intersects the viewport, which a node under the keyboard
    // already does; tapping outside a field does not close the Android IME;
    // `enter` may submit the form; and a flow has neither a key step nor a
    // coordinate tap.
    //
    // A deliberate exception, 2026-10-03, of the kind amStart's comment
    // records in adapters/android.ts: this string names MCP tools
    // (ui_snapshot, press_key) and speaks of "a flow", vocabulary of the two
    // layers ABOVE interact. Kept, as in verify/capture.ts and
    // interact/scroll.ts: the reader's next move differs per surface, and
    // one message with two honest halves beats two translation sites that
    // must agree. Only words cross the layer, no import.
    throw new AfterKeyboardDismissal(
      `Pressed back to hide the soft keyboard covering ${what}, but back did not close it: the keyboard frame ` +
        `[${x},${y}][${x + width},${y + height}] still contains the tap point (${point.x},${point.y}); nothing was tapped. ` +
        `From the MCP tools: inspect the screen with ui_snapshot, then press_key back once more or tap a control above ` +
        `the keyboard. In a flow: no step can recover this — the screen keeps a keyboard that back does not close ` +
        `over ${what} — fix the screen (or the test data) so the target is not under the keyboard`,
      backPressed,
    );
  }
  // `unknown` after the dismissal fails open like everywhere else — the tap
  // goes ahead — but the note must not claim what was not seen.
  const keyboardHidden =
    after.state === 'unknown'
      ? `${backPressed}; the keyboard's state afterwards could not be read`
      : confirmedAfterMs === undefined
        ? `${covered}; hidden before tapping`
        : `${covered}; hidden before tapping (after waiting ${confirmedAfterMs}ms for the input method to confirm it)`;
  return {
    node: second.node,
    note: second.note === undefined ? keyboardHidden : `${second.note}; ${keyboardHidden}`,
    keyboardHidden,
  };
}
