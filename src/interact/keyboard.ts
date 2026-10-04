import { zeroRect, type DeviceAdapter, type KeyboardOracle, type KeyboardWitness, type Rect, type SoftKeyboard } from '../adapters/types.js';
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
 * (their cost: AndroidAdapter's keyboardState / keyboardWitness).
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

// ─── The decision table ──────────────────────────────────────────────────────

/**
 * What the guard (and the dismissal) does on ONE sample of the two sources.
 * - `proceed`: nothing stands in the way — tap the point / there is nothing to
 *   dismiss. No key is pressed.
 * - `back`: press `back`; the window state's keyboard is confirmed, or at least
 *   not denied, by the input method.
 * - `hold`: send NOTHING on this sample — neither back nor the tap. The guard
 *   asks both sources again after a pause; the dismissal, which has nothing
 *   to wait for, simply stops.
 * - `refuse`: throw — the budget for disagreeing samples is spent, or the one
 *   `back` the guard allows itself did not close the keyboard.
 */
export type KeyboardAction = 'proceed' | 'back' | 'hold' | 'refuse';

/**
 * The window state, read for the question at hand. For the guard, which has
 * a point: its frame contains the point (`covering`), does not — hidden, or a
 * frame elsewhere — (`clear`), or the state could not be read (`unknown`).
 * For the dismissal, which has no point: shown anywhere is `covering`,
 * hidden is `clear`. `unknown` is kept apart rather than folded into either,
 * because the two callers need opposite things from it (the table's rows).
 */
export type WindowReading = 'covering' | 'clear' | 'unknown';

/**
 * One reading of the two sources, as the table judges it. The input method's
 * word (`witness`) is REQUIRED by the type exactly when the window is
 * `covering`, and absent otherwise: a caller cannot forget to ask it where it
 * decides, nor ask it where it does not — an ordinary tap costs what it did,
 * and the look after the key press never asks (the key is already pressed;
 * the frame decides).
 *
 * The phases:
 * - `first`: the guard's look before anything was sent;
 * - `recheck`: a round of the bounded wait that a vetoed `first` starts;
 *   `last` marks the round the budget ends on;
 * - `afterBack`: the guard's look after the one `back`, to confirm the
 *   keyboard went;
 * - `dismiss`: the dismissal after a fill — no point, no second look.
 */
export type KeyboardSample =
  | { phase: 'first'; window: 'clear' | 'unknown' }
  | { phase: 'first'; window: 'covering'; witness: KeyboardWitness }
  | { phase: 'recheck'; window: 'clear' | 'unknown' }
  | { phase: 'recheck'; window: 'covering'; witness: KeyboardWitness; last: boolean }
  | { phase: 'afterBack'; window: WindowReading }
  | { phase: 'dismiss'; window: 'clear' | 'unknown' }
  | { phase: 'dismiss'; window: 'covering'; witness: KeyboardWitness };

/**
 * THE table — window state × input method × phase → action — written once,
 * as a pure function, for every sample the guard and the dismissal take: the
 * guard's first look, each round of its bounded re-check, its look after the
 * one `back` (resolveClearOfKeyboard), and the dismissal after a fill
 * (dismissKeyboard). Until 2026-10-04 it lived twice: as the loop in the
 * guard and as a second copy of the `unknown → back` rule in fill.ts. A first
 * cut the same day squashed the window state to a boolean before the table
 * saw it, so `unknown` was still decided twice OUTSIDE it (review, round 1);
 * now the reading reaches the table and both of its `unknown` rows are here.
 *
 * The rows, with their reasons:
 *
 *   first / recheck / afterBack · window clear     → proceed
 *   first / recheck / afterBack · window unknown   → proceed
 *     Hidden or a frame elsewhere: nothing over the point — tap. Unknown
 *     over a tap point FAILS OPEN, as everywhere: the question exists to make
 *     a tap safer and must never be the reason a tap did not happen (a device
 *     that is really gone fails the tap itself, in the tap's own words).
 *
 *   first   · covering · witness shown             → back
 *   first   · covering · witness unknown           → back
 *     The decision the window state alone made before the veto existed
 *     (2026-10-04): a witness that cannot be asked — adb failure, an Android
 *     version that does not print `mInputShown` (unverified outside API 33;
 *     the stale-window hazard REMAINS there) — leaves it standing.
 *   first   · covering · witness hidden            → hold
 *     The veto. The window state can be stale for seconds after a navigation
 *     (measured that day: full frame reported, input method already said
 *     not shown); `back` then navigates, a tap then presses a key. Nothing
 *     is sent on one disagreeing sample.
 *
 *   recheck · covering · witness shown             → back   (even when last)
 *     The input method has come round: the normal dismissal, as if it had
 *     said so at first.
 *   recheck · covering · witness hidden            → hold, or refuse when last
 *   recheck · covering · witness unknown           → hold, or refuse when last
 *     A witness that said "hidden" half a second ago and cannot be reached
 *     now has confirmed nothing — so unlike `first`, `unknown` presses
 *     nothing here. When the budget ends still disagreeing: a refusal
 *     (KeyboardStateDisagreement) — acting on either guess is the harm.
 *
 *   afterBack · covering                           → refuse
 *     Still covered after the one dismissal: THROW, tap nothing. Never a
 *     loop — a keyboard `back` does not hide (a field that re-requests it,
 *     an IME that ignores back) would be a `back` per round, and the second
 *     one navigates.
 *
 *   dismiss · window clear                         → proceed
 *     Hidden: nothing to dismiss — back with no keyboard up NAVIGATES (the
 *     2026-10-03 finding: a custom PIN pad, a hardware keyboard, a picker).
 *   dismiss · window unknown                       → back
 *     The ONE place unknown means back, exactly as before 2026-10-03: the
 *     adapter could not tell (the command failed, or printed a format it does
 *     not recognise), and after a fill a keyboard left up over the next tap
 *     is the likelier harm. No witness is asked: there is no window state
 *     for it to contradict.
 *   dismiss · covering · witness shown             → back
 *   dismiss · covering · witness unknown           → back
 *   dismiss · covering · witness hidden            → hold
 *     As `first`: the veto applies to the dismissal too (the stale window
 *     state after a navigation is where it was measured), and with nothing
 *     to wait for, `hold` simply presses nothing.
 *
 * Rejected: a `whenUnknown` option on the back press (the same rule in two
 * shapes, 2026-10-04 → this table); a `covering: boolean` sample (the window
 * reading decided outside the table, review round 1 → the union above);
 * trusting the window state alone (the measurement above); asking the
 * witness on every tap instead of the window state (it has no frame).
 */
export function keyboardAction(sample: KeyboardSample): KeyboardAction {
  switch (sample.phase) {
    case 'first':
      if (sample.window !== 'covering') return 'proceed';
      return sample.witness === 'hidden' ? 'hold' : 'back';
    case 'recheck':
      if (sample.window !== 'covering') return 'proceed';
      if (sample.witness === 'shown') return 'back';
      return sample.last ? 'refuse' : 'hold';
    case 'afterBack':
      return sample.window === 'covering' ? 'refuse' : 'proceed';
    case 'dismiss':
      if (sample.window !== 'covering') return sample.window === 'unknown' ? 'back' : 'proceed';
      return sample.witness === 'hidden' ? 'hold' : 'back';
  }
}

// ─── Reading the window state ────────────────────────────────────────────────

const covers = (keyboard: SoftKeyboard, point: { x: number; y: number }): keyboard is SoftKeyboard & { state: 'shown' } =>
  keyboard.state === 'shown' &&
  point.x >= keyboard.frame.x &&
  point.x < keyboard.frame.x + keyboard.frame.width &&
  point.y >= keyboard.frame.y &&
  point.y < keyboard.frame.y + keyboard.frame.height;

/** The guard's reading: does the frame contain the point about to be tapped? Geometry only; the table decides. */
export const windowOver = (keyboard: SoftKeyboard, point: { x: number; y: number }): WindowReading =>
  keyboard.state === 'unknown' ? 'unknown' : covers(keyboard, point) ? 'covering' : 'clear';

/** The dismissal's reading: a keyboard shown ANYWHERE is in the way — there is no point to test. */
export const windowAnywhere = (keyboard: SoftKeyboard): WindowReading =>
  keyboard.state === 'shown' ? 'covering' : keyboard.state === 'hidden' ? 'clear' : 'unknown';

/**
 * The frame behind a `covering` reading. Read only after the table has said
 * the window covers the point — which it says exactly when the state is
 * `shown` — so the zero rect is the type's fallback, never a printed one.
 */
const shownFrame = (keyboard: SoftKeyboard): Rect => (keyboard.state === 'shown' ? keyboard.frame : zeroRect());

/** `[x,y][x2,y2]`, the frame as dumpsys prints it — the one spelling in every message that quotes one. */
const frameText = ({ x, y, width, height }: Rect): string => `[${x},${y}][${x + width},${y + height}]`;

/** The guard's answer: the node, with the keyboard sentence folded into the resolution note and kept alone beside it. */
const withNote = (resolved: Resolved, keyboardHidden: string): ResolvedClear => ({
  node: resolved.node,
  note: resolved.note === undefined ? keyboardHidden : `${resolved.note}; ${keyboardHidden}`,
  keyboardHidden,
});

// ─── The callers ─────────────────────────────────────────────────────────────

/** The adapter surface the guard and the dismissal need: the oracle, when there is one, and the key. */
type KeyboardAdapter = Pick<DeviceAdapter, 'keyboard' | 'pressKey'>;

/** A sample before the input method has been asked: what the caller knows on its own. */
type Unjudged =
  | { phase: 'first' | 'dismiss'; window: WindowReading }
  | { phase: 'recheck'; window: WindowReading; last: boolean };

/**
 * Take one sample in a phase that may press — and send THE ONE `back` averi
 * sends for keyboard reasons (2026-10-04): the tap guard's dismissal and
 * `dismissKeyboard` both come through here. The witness is read when, and
 * only when, the window reading demands it (the type of `KeyboardSample`
 * says when: never on an ordinary tap, never after the key); the table
 * judges; `back` goes out only when it says so. The witness's answer is
 * handed back beside the action for the wording of a later failure.
 */
async function judge(
  adapter: KeyboardAdapter,
  oracle: KeyboardOracle,
  unjudged: Unjudged,
): Promise<{ action: KeyboardAction; witness: KeyboardWitness | undefined }> {
  let sample: KeyboardSample;
  let witness: KeyboardWitness | undefined;
  if (unjudged.window !== 'covering') {
    sample = unjudged.phase === 'recheck' ? { phase: 'recheck', window: unjudged.window } : { phase: unjudged.phase, window: unjudged.window };
  } else {
    witness = await oracle.witness();
    sample =
      unjudged.phase === 'recheck'
        ? { phase: 'recheck', window: 'covering', witness, last: unjudged.last }
        : { phase: unjudged.phase, window: 'covering', witness };
  }
  const action = keyboardAction(sample);
  if (action === 'back') await adapter.pressKey('back');
  return { action, witness };
}

/**
 * A table outcome this call site has no move for. Every site switches over
 * all four actions and sends the ones it cannot act on here, so a wrong edit
 * to the table fails LOUDLY instead of quietly tapping over a keyboard or
 * pressing a second `back` (review 2026-10-04). `sample` is what the site
 * knew — a witness it never asked is simply absent from the message, never
 * invented. After the key press (`backPressed` given) the failure is an
 * AfterKeyboardDismissal, as every failure past the key must be (§8).
 */
function unexpected(
  action: KeyboardAction,
  sample: { phase: KeyboardSample['phase']; window: WindowReading; witness?: KeyboardWitness; last?: boolean },
  backPressed?: string,
): never {
  const message = `keyboard guard: the decision table answered "${action}" for ${JSON.stringify(sample)}, which this step cannot act on`;
  if (backPressed !== undefined) throw new AfterKeyboardDismissal(`${message} (back had been pressed)`, backPressed);
  throw new Error(message);
}

/** Exhaustiveness at compile time: a fifth action must be handled at every site before this builds. */
function assertNever(action: never): never {
  throw new Error(`keyboard guard: unhandled action ${String(action)}`);
}

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
 * The protocol — each decision is a row of `keyboardAction`:
 *   no oracle on the adapter: done, the node as resolved. Nothing is asked
 *   and nothing is pressed (iOS: the keyboard is part of the tree).
 *   resolve → ask the oracle where the keyboard is → tap point outside it
 *   (or hidden, or unknown): done, the node as resolved.
 *   Inside it (`first`): ask the witness, press `back` unless it DENIES the
 *   keyboard — the "shown" just read can be stale and `back` with no keyboard
 *   up navigates away. Denied: nothing is sent, neither back nor the tap;
 *   both sources are asked again for a bounded time (`recheck`, the
 *   constants above).
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
 *   After a pressed back: wait out the hide animation, resolve AGAIN with
 *   the same options (an adjustResize activity re-lays-out when the keyboard
 *   goes: the node the first read chose is no longer where it was), ask the
 *   oracle again (`afterBack`), and only then hand back the node. Anything
 *   that fails from the key press on — the target not coming back, a
 *   refusal, the keyboard staying — is an AfterKeyboardDismissal: the
 *   message says `back` was pressed (see the class).
 *
 * No platform test here (dropped 2026-10-03, after review: this layer is
 * platform-agnostic, ARCHITECTURE.md §2): whether the adapter HAS an oracle
 * already carries it. The remedy (`back`) is an Android key, and only an
 * adapter with an oracle that says `shown` ever reaches it.
 *
 * Cost on Android: ONE oracle query per tap when nothing covers the target
 * (what one call costs is measured on AndroidAdapter's keyboardState, the one
 * place the figures are kept); the second resolve and the second query
 * happen only in the overlap case, and so does the witness query
 * (AndroidAdapter's keyboardWitness has its cost). A `type_pin` keypad taps
 * once per digit, so it asks once per digit — a 6-digit PIN is 6 dumpsys
 * calls, six times that figure, beside six tree-settle waits of seconds
 * each. A raw coordinate tap does not come through here: the caller chose
 * that point.
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
  adapter: Pick<DeviceAdapter, 'uiTree' | 'keyboard' | 'pressKey'>,
  target: Target,
  opts: SettleOptions,
): Promise<ResolvedClear> {
  const first = await resolveSettled(adapter, target, opts);
  const oracle = adapter.keyboard;
  if (oracle === undefined) return first;
  const at = tapPoint(first.node);
  const initial = await oracle.state();
  const what = describeTarget(target);
  /** The fact every sentence below starts from; each outcome appends its own ending. */
  const covered = `the soft keyboard covered ${what}`;
  const backPressed = `${covered}; back pressed`;
  const opening = windowOver(initial, at);
  let verdict = await judge(adapter, oracle, { phase: 'first', window: opening });
  /** The point being judged: the first resolution's, until a look during the wait finds the target elsewhere. */
  let judged = at;
  /** How long the input method took to confirm the keyboard, when it denied it at first. */
  let confirmedAfterMs: number | undefined;
  switch (verdict.action) {
    case 'proceed':
      return first; // nothing over the point (or nothing readable): the node as resolved
    case 'back':
      break; // the dismissal: the second look below
    case 'refuse':
      return unexpected(verdict.action, { phase: 'first', window: opening, witness: verdict.witness });
    case 'hold': {
      // Vetoed: the window state says covered, the input method says no
      // keyboard. Send nothing on this one sample; ask both again, bounded.
      const disagreement = `the window state reported a soft keyboard over ${what} that the input method denied`;
      let stillCovering = shownFrame(initial);
      recheck: for (let waited = KEYBOARD_DISAGREEMENT_POLL_MS; ; waited += KEYBOARD_DISAGREEMENT_POLL_MS) {
        await sleep(KEYBOARD_DISAGREEMENT_POLL_MS);
        const now = await oracle.state();
        let reading = windowOver(now, judged);
        if (reading !== 'covering') {
          const settled = await resolveSettled(adapter, target, opts);
          // The frame just read is tested against where the target is NOW —
          // free, `now` is in hand: a frame that left the old point but lies
          // over the new one (the layout moved while averi waited) is still a
          // keyboard over the target, and the wait goes on with that point.
          const moved = tapPoint(settled.node);
          reading = windowOver(now, moved);
          if (reading !== 'covering') {
            const sample: KeyboardSample = { phase: 'recheck', window: reading };
            // The pure table, not `judge`: nothing on this path may press a
            // key, so a row that says `back` must be refused BEFORE the key,
            // not discovered after it.
            const action = keyboardAction(sample);
            switch (action) {
              case 'proceed':
                return withNote(
                  settled,
                  reading === 'unknown'
                    ? `${disagreement}; waited ${waited}ms, then the window state could not be read`
                    : `${disagreement}; waited ${waited}ms for it to clear`,
                );
              case 'back':
              case 'hold':
              case 'refuse':
                return unexpected(action, sample);
              default:
                return assertNever(action);
            }
          }
          judged = moved;
        }
        stillCovering = shownFrame(now);
        const last = waited >= KEYBOARD_DISAGREEMENT_BUDGET_MS;
        verdict = await judge(adapter, oracle, { phase: 'recheck', window: 'covering', last });
        switch (verdict.action) {
          case 'back':
            confirmedAfterMs = waited;
            break recheck; // confirmed: the normal dismissal below
          case 'hold':
            continue recheck; // one more round
          case 'proceed':
            return unexpected(verdict.action, { phase: 'recheck', window: 'covering', witness: verdict.witness, last });
          case 'refuse': {
            // The last answer decides the wording: a witness that could not be
            // asked in the later rounds ends here too, and "says no keyboard is
            // shown" would then claim an answer nobody gave.
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
          default:
            return assertNever(verdict.action);
        }
      }
      break;
    }
    default:
      return assertNever(verdict.action);
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
  const after = await oracle.state();
  // The pure table, not `judge`: it never answers `back` after the one back,
  // and a table that did must not be obeyed — it is sent to `unexpected`.
  const afterSample: KeyboardSample = { phase: 'afterBack', window: windowOver(after, point) };
  const afterAction = keyboardAction(afterSample);
  switch (afterAction) {
    case 'proceed':
      break;
    case 'back':
    case 'hold':
      return unexpected(afterAction, afterSample, backPressed);
    case 'refuse':
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
          `${frameText(shownFrame(after))} still contains the tap point (${point.x},${point.y}); nothing was tapped. ` +
          `From the MCP tools: inspect the screen with ui_snapshot, then press_key back once more or tap a control above ` +
          `the keyboard. In a flow: no step can recover this — the screen keeps a keyboard that back does not close ` +
          `over ${what} — fix the screen (or the test data) so the target is not under the keyboard`,
        backPressed,
      );
    default:
      return assertNever(afterAction);
  }
  // `unknown` after the dismissal fails open like everywhere else — the tap
  // goes ahead — but the note must not claim what was not seen.
  return withNote(
    second,
    after.state === 'unknown'
      ? `${backPressed}; the keyboard's state afterwards could not be read`
      : confirmedAfterMs === undefined
        ? `${covered}; hidden before tapping`
        : `${covered}; hidden before tapping (after waiting ${confirmedAfterMs}ms for the input method to confirm it)`,
  );
}

/**
 * Close the on-screen keyboard after a fill. Called AFTER a fill has
 * returned, never before (dismissing first closes the keyboard the typing
 * needs), and as its own call so the fill's warning is already in the
 * caller's hands if this throws. Moved here from fill.ts on 2026-10-04: its
 * samples are `keyboardAction`'s `dismiss` rows, and this file is where the
 * one `back` lives — fill.ts had kept a second copy of the `unknown → back`
 * rule.
 *
 * An adapter WITHOUT the oracle (iOS) has no back key and takes `enter`,
 * blind, asking nothing — what the platform branch this replaces did. The
 * absence of the oracle carries that (KeyboardOracle, adapters/types.ts): an
 * adapter that cannot see its keyboard as a window has no `back` to hide it
 * with. The same applies to a NEW adapter that ships without an oracle: its
 * blind dismissal is `enter`, and `enter` may SUBMIT a form — a platform
 * where that is wrong adds the oracle (or extends it with its dismiss key),
 * it does not branch here.
 *
 * With the oracle (Android), since 2026-10-03: `back` is pressed only if the
 * window state does not say the keyboard is HIDDEN. Before that date it was
 * pressed blindly, and `back` with no keyboard up NAVIGATES BACK — a field
 * that raises no keyboard (a custom PIN pad, a hardware keyboard, a picker)
 * turned `dismissKeyboard: true` into leaving the screen. The table's
 * `dismiss` rows (keyboardAction, where the reasons are):
 * - shown   → back — unless, since 2026-10-04, the independent witness denies
 *   the keyboard: then nothing is pressed, and nothing is waited for;
 * - hidden  → nothing: there is nothing to dismiss;
 * - unknown → back, exactly as before, the witness not asked.
 * One oracle query per dismissal (its cost: AndroidAdapter's keyboardState),
 * and the witness query when that query says shown.
 */
export async function dismissKeyboard(adapter: KeyboardAdapter): Promise<void> {
  const oracle = adapter.keyboard;
  if (oracle === undefined) return adapter.pressKey('enter');
  const reading = windowAnywhere(await oracle.state());
  const { action, witness } = await judge(adapter, oracle, { phase: 'dismiss', window: reading });
  switch (action) {
    case 'proceed':
    case 'back':
    case 'hold':
      return; // nothing to dismiss / back went out / the witness denied it — all done
    case 'refuse':
      return unexpected(action, { phase: 'dismiss', window: reading, witness });
    default:
      return assertNever(action);
  }
}
