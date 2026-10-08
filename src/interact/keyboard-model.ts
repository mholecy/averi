import type { DeviceAdapter, Point, Rect, SoftKeyboard } from '../adapters/types.js';
import { containsPoint } from '../ui-tree/geometry.js';
import { tapPoint } from '../ui-tree/selectors.js';
import { readSoftKeyboard } from '../ui-tree/soft-keyboard.js';
import { errorMessage } from '../util/error-message.js';
import { sleep } from '../util/sleep.js';
import { AmbiguityRefusal, resolveSettled, type Resolved, type ResolvedSettled, type SettleOptions, type Target } from './resolve.js';

/**
 * The seam between the two keyboard models (2026-10-07, the keyboard-model
 * review): what `keyboard.ts` — the guard and the post-fill dismissal,
 * written once — needs of a model, and what both models share. A soft
 * keyboard is one of two things to a platform, and each is an adapter at
 * this seam:
 * - the WINDOW model (`keyboard-window.ts`): the keyboard is a window of its
 *   own, absent from the tree, read through the adapter's oracle
 *   (`DeviceAdapter.keyboard`) and hidden by `back` — Android;
 * - the IN-TREE model (`keyboard-in-tree.ts`): the keyboard is part of the
 *   tree, read off the band the tree source marks, hidden by one tap on an
 *   element the config names — iOS under WDA.
 * Which one an adapter gets is decided ONCE, from whether it has the oracle
 * (`keyboard.ts#keyboardModel`); until this date the same question was asked
 * again inside the guard and again inside the dismissal, and each branch
 * re-wrote the shape every model shares — one irreversible side effect, the
 * hide delay, the target resolved AGAIN with the same options, a reading
 * against where it is now, a refusal if it still covers — around its own
 * decisions and words. The shape is `keyboard.ts`'s now; the decisions, the
 * side effect and the words are the model's (`KeyboardModel`, `Hiding`).
 *
 * The READING half — the keyboard read for a SUBJECT, the node about to be
 * tapped or measured — has its own switch, one layer down:
 * `ui-tree/soft-keyboard.ts#readSoftKeyboard`, because the pixel poll
 * (verify/, which may not import interact/) reads the keyboard too and
 * must read it the same way. Every look the guard takes goes through it,
 * so the guard and the poll see one keyboard by construction. The
 * dismissal after a fill has no subject and reads its model's own source
 * (`dismiss`: the oracle's `state()`, the tree's band) — routing it through
 * readSoftKeyboard would need a tree the window model never reads and a
 * subject the in-tree model does not have.
 */

/**
 * The pause before every look that follows a covering reading or the one
 * side effect — `confirmHidden` sleeps it before each of its looks, the
 * in-tree model before its second look. Measured 2026-10-03 (API 33
 * emulator): ~0.4 s after `back` the IME insets already read
 * `visible=false` but still carried the keyboard's full frame — the hide
 * animation was running — and ~0.9 s after, the frame was empty. The settle
 * poll that follows adds its own two tree reads on top (a uiautomator dump
 * is about a second each), so this is the floor, not the whole wait: it
 * keeps the FIRST of those reads from seeing the pre-resize layout twice
 * and calling it settled. On iOS, unmeasured — the in-tree model's looks
 * take the same pause for the same reason (a hide animation caught mid-way
 * must not be a refusal), and its KEYBOARD_HIDE_CONFIRM_LOOKS says how many
 * of them it takes.
 */
export const KEYBOARD_HIDE_DELAY_MS = 300;

/** The adapter surface the guard and the dismissal need: the tree and the tap (every model), the oracle and the key (the window model), the advice (the in-tree model's refusal). */
export type KeyboardAdapter = Pick<DeviceAdapter, 'uiTree' | 'tap' | 'keyboard' | 'keyboardAdvice' | 'pressKey'>;

/** A resolved node whose tap point no soft keyboard covers. */
export interface ResolvedClear extends Resolved {
  /**
   * Set when the guard had to do something before the tap — the sentence
   * itself: `back` pressed and the keyboard hidden; pressed and unconfirmed;
   * a configured dismissal tapped; or, since 2026-10-04, nothing pressed but
   * a wait for a window state the input method contradicted. It is ALSO
   * folded into `note`, so a caller that prints notes (the MCP tools) needs
   * nothing new; a caller that does not (the flow trace) reads this field to
   * say the one thing it must.
   */
  keyboardHidden?: string;
}

/**
 * A failure of the keyboard guard that the caller must be able to SEE in a
 * trace: `traceLine` is the trace-sized sentence the flow engine logs as
 * `⚠ tap` / `⚠ fill` BEFORE the step's `✗` line (one catch for every
 * subclass, flow/engine.ts#tracingGuardFailure). Each model's failures are
 * its own subclasses, beside the protocol that throws them.
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
 * One way to hide the in-tree keyboard without submitting (stage B,
 * 2026-10-07), tried by the in-tree model only where it would otherwise
 * refuse — never by the window model, whose `back` is the dismissal. The
 * config's vocabulary (`app.ios.keyboardDismiss`, flow/config.ts) is
 * converted to this before it crosses into interact/, which knows neither
 * the YAML nor the platform:
 * - `tap`: a target of the app's own — a neutral, non-interactive element
 *   such as the screen's title, which was measured to hide the keyboard
 *   without a side effect (K5b: `idb ui tap` on the "Prihlásenie" title,
 *   empty form and filled form alike; the device check's `title_then_submit`
 *   reached 2FA). What is neutral is the app's business, hence config.
 * - `accessory`: the input-accessory toolbar's trailing button — the app's
 *   "Done" above a number pad (ui-tree/soft-keyboard.ts#accessoryDismissButton),
 *   measured to hide the 2FA pad (K4). Generic in shape, so it needs no
 *   selector, but opt-in like the rest: a toolbar button is the app's, and
 *   only the author knows it is a dismissal.
 */
export type KeyboardDismissal = { kind: 'tap'; target: Target } | { kind: 'accessory' };

/** The guard's options: the settle options every resolution takes, plus the dismissals it may tap, in order of preference. */
export interface GuardOptions extends SettleOptions {
  /**
   * Tried in order on the tree of the look that found the keyboard covering;
   * the FIRST whose element is on screen and usable is tapped, once. Absent
   * or empty: the guard refuses a covered target as it did before stage B.
   * Read by the in-tree model only — the window model never sees them, so
   * an Android run with dismissals configured is the same run.
   */
  dismissals?: readonly KeyboardDismissal[];
}

/** What `dismissKeyboard` takes of the guard's options: the dismissals it may tap and the ambiguity policy they are judged under — no default policy is written here. The settle options are not among them: it resolves nothing. */
export type DismissOptions = Pick<GuardOptions, 'dismissals' | 'ambiguous'>;

/** What `dismissKeyboard` did, for the caller's trace: at most one of the two, and neither on the window model. */
export interface DismissResult {
  /** The in-tree keyboard was up and this hid it: `tapping id:"login_title"`, the fragment the flow's fill line appends after `; keyboard hidden by ` — not a `keyboardHidden` sentence, so the engine's `⚠` tracing cannot take this result by mistake. */
  hiddenBy?: string;
  /** The in-tree keyboard was up and nothing usable was configured: left up, said so — the flow logs it as a `⚠ fill` line. */
  warning?: string;
}

/** The guard's reading of one keyboard state against the tap point, with the frame when it covers — so a message can quote it without a second look. */
export type CoverReading = { over: 'covering'; frame: Rect } | ClearReading;

/** A reading that lets the tap go ahead: nothing over the point, or a state that could not be read (fail open — the guard's one rule, stated in `keyboard.ts`). */
export type ClearReading = { over: 'clear' } | { over: 'unknown' };

/** Is the keyboard over the point about to be tapped? Geometry only (`containsPoint`, ui-tree/geometry.ts); the models judge. One reading for both models: the oracle's frame and the tree's band are both a `SoftKeyboard` (named `windowOver` until the review of the model split, which was the window model's word). */
export const keyboardOver = (keyboard: SoftKeyboard, point: Point): CoverReading =>
  keyboard.state === 'unknown'
    ? { over: 'unknown' }
    : keyboard.state === 'shown' && containsPoint(keyboard.frame, point)
      ? { over: 'covering', frame: keyboard.frame }
      : { over: 'clear' };

/** `[x,y][x2,y2]`, the frame as dumpsys prints it — the one spelling in every message that quotes one, on either model. */
export const frameText = ({ x, y, width, height }: Rect): string => `[${x},${y}][${x + width},${y + height}]`;

/** The guard's answer: the node, with the keyboard sentence folded into the resolution note and kept alone beside it. */
export const withNote = (resolved: Resolved, keyboardHidden: string): ResolvedClear => ({
  node: resolved.node,
  note: resolved.note === undefined ? keyboardHidden : `${resolved.note}; ${keyboardHidden}`,
  keyboardHidden,
});

/**
 * The message of a look that could not resolve the target after the guard
 * had acted, or found the keyboard, on an earlier one — the one shape every
 * such failure wraps into its model's KeyboardGuardError: a refusal's first
 * line is the finding (and the trace's ✗ headline), so it is kept as is
 * with `refused` in parentheses under it; any other error gets `failed`'s
 * sentence over its headline and its further lines after it. The two
 * sentences are the model's, verbatim — the window model's end with
 * whether `back` may have NAVIGATED and whether the witness could be asked,
 * the in-tree model's with the tap that cannot be untapped — and the catch
 * that wraps them is written once, in `lookAgain`.
 */
export function failedLookMessage(e: unknown, refused: string, failed: (headline: string) => string): string {
  const message = errorMessage(e);
  if (e instanceof AmbiguityRefusal) return `${message}\n(${refused})`;
  const [headline, ...rest] = message.split('\n');
  return [failed(headline), ...rest].join('\n');
}

/** What one look found: the target resolved again, where it is now, and the keyboard read against that point. */
export interface Look {
  resolved: ResolvedSettled;
  point: Point;
  reading: CoverReading;
}

/**
 * One look, the same on every model: the target resolved AGAIN with the
 * SAME options — so it proves it holds still again, and so an
 * adjustResize activity's re-layout (or the iOS keyboard-avoiding layout's)
 * is followed to where the node is now — and the keyboard read against
 * that point through `readSoftKeyboard`, off the tree that resolved it (the
 * in-tree model pays no device read; the window model asks its oracle
 * once). The reading is the first look's rule on every look, the window
 * model's look after `back` included: a target that is the keyboard's own
 * UI reads `unknown` and the oracle is not asked — until 2026-10-07 that
 * look called `oracle.state()` directly, so an oracle adapter handed an
 * `ofKeyboard`-marked tree would now skip that read and proceed as unknown;
 * no real adapter produces one (the Android tree is never marked), so the
 * difference is unreachable, and the event-log pins hold. A resolution that
 * fails — the target not coming back, or coming back ambiguous — is the
 * caller's error over `failedLookMessage`: the trace must still show what
 * the guard found or did before, or a timeout here reads as a plain slow
 * screen. No pause of its own: the caller sleeps KEYBOARD_HIDE_DELAY_MS
 * first (`confirmHidden` does for its looks).
 */
export async function lookAgain(adapter: KeyboardAdapter, target: Target, opts: GuardOptions, failed: (e: unknown) => KeyboardGuardError): Promise<Look> {
  let resolved: ResolvedSettled;
  try {
    resolved = await resolveSettled(adapter, target, opts);
  } catch (e) {
    throw failed(e);
  }
  const point = tapPoint(resolved.node);
  const reading = keyboardOver((await readSoftKeyboard(adapter, resolved.tree, resolved.node)).keyboard, point);
  return { resolved, point, reading };
}

/** One confirming look after the side effect: the keyboard gone, with what the caller returns, or still up, with what its refusal needs to say. */
export type ConfirmLook<T, S> = { gone: T } | { stillUp: S };

/**
 * The confirmation after the one side effect, shared by the guard (both
 * models) and the in-tree dismissal: up to `looks` looks, KEYBOARD_HIDE_DELAY_MS
 * before each — the first that finds the keyboard gone answers, and only
 * the LAST still-up look refuses, with the caller's error over what that
 * look saw and how many looks there were. A look that throws (the target
 * not coming back, or the tree not reading) ends it there. Never a second side effect between the
 * looks: that is the invariant both models' failure classes rest on —
 * "back was pressed", "that tap cannot be untapped" — and the loop has no
 * way to act.
 */
export async function confirmHidden<T, S>(looks: number, look: () => Promise<ConfirmLook<T, S>>, stillUp: (seen: S, looks: number) => KeyboardGuardError): Promise<T> {
  for (let n = 1; ; n++) {
    await sleep(KEYBOARD_HIDE_DELAY_MS);
    const seen = await look();
    if ('gone' in seen) return seen.gone;
    if (n < looks) continue;
    throw stillUp(seen.stillUp, n);
  }
}

/** The first look that found the point covered — what a model's guard protocol starts from. */
export interface CoveredLook {
  target: Target;
  opts: GuardOptions;
  /** Where the target was on that look. */
  point: Point;
  /** The frame (or band) that covered it. */
  frame: Rect;
  /** The target as the messages name it: `id:login_submit`, `id:"login_submit"` for an ElementSpec. */
  what: string;
  /** `the soft keyboard covered <what>` — the fact every sentence starts from; each outcome appends its own ending. */
  covered: string;
}

/**
 * What a model decided to do about a covered point, handed to `keyboard.ts`
 * to carry out: the ONE irreversible side effect, how many looks confirm it,
 * and the words for what those looks find. The model builds it after its own
 * pre-checks and never performs it — the skeleton does, once, and then only
 * looks (`confirmHidden`).
 */
export interface Hiding {
  /** The side effect: the window model's `back`, the in-tree model's tap on the picked element. */
  perform(): Promise<void>;
  /** How many looks after it before the last still-covering one refuses: one for `back` (the frame decides), KEYBOARD_HIDE_CONFIRM_LOOKS for a dismissal tap (a hide animation caught mid-way is not a refusal). */
  looks: number;
  /** The look could not resolve the target: the model's error over `failedLookMessage`, saying what it did to the screen first, with `e` as the cause. */
  failed(e: unknown): KeyboardGuardError;
  /** A look found the point clear (or the state unreadable — fail open, but the note must not claim what was not seen): the `keyboardHidden` sentence. */
  hidden(after: ClearReading): string;
  /** The last look still found it covering: the model's refusal — nothing more is done. */
  stillCovering(seen: { frame: Rect; point: Point }, looks: number): KeyboardGuardError;
}

/**
 * A keyboard model: the two questions `keyboard.ts` asks once it has read
 * the keyboard and found it in the way. Two adapters at this seam — the
 * window model and the in-tree model — so it is a real one: what varies
 * across it is how a covering keyboard is confirmed, what may be done about
 * it, and what every outcome is called; what does not vary (the first
 * look, the fail-open rule, the one side effect, the confirming looks) is
 * written once above it.
 */
export interface KeyboardModel {
  /**
   * The guard from a first look that found the point covered up to — not
   * including — the one side effect: the model's own re-checks (the window
   * model asks the witness and waits out a stale window state; the in-tree
   * model takes a second look and picks a dismissal). Three endings: the
   * keyboard left on its own and the target is handed back clear, with a
   * note that says what was waited for; a refusal is thrown, nothing sent;
   * or the hiding to perform, with its words.
   */
  guard(covered: CoveredLook): Promise<{ cleared: ResolvedClear } | { hiding: Hiding }>;
  /**
   * The dismissal after a fill, whole: no point to judge, so the model reads
   * the keyboard anywhere, decides, acts at most once and — where it
   * confirms at all — confirms with `confirmHidden`. Not split into
   * "prepare" and "perform" as the guard is: the window model's dismissal is
   * blind by design (its doc says why no read follows the `back`), so there
   * is no confirmation shape the two share.
   */
  dismiss(opts: DismissOptions): Promise<DismissResult>;
}
