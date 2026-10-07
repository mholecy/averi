import { rectArea, type DeviceAdapter, type KeyboardWitness, type Rect, type SoftKeyboard, type UiNode } from '../adapters/types.js';
import { STRUCTURAL_ROLES } from '../ui-tree/bare-tree.js';
import { isInteractive, tapPoint } from '../ui-tree/selectors.js';
import { accessoryDismissButton, keyboardInTree, partOfKeyboard, readSoftKeyboard } from '../ui-tree/soft-keyboard.js';
import { sleep } from '../util/sleep.js';
import { errorMessage } from '../util/error-message.js';
import {
  AmbiguityRefusal,
  describeTarget,
  findTarget,
  resolveSettled,
  type Ambiguity,
  type Resolved,
  type ResolvedSettled,
  type SettleOptions,
  type Target,
} from './resolve.js';

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
 * How many looks the in-tree model takes for the keyboard to be GONE after a
 * dismissal tap (stage B, review round 1): the delay above is an Android
 * floor, "not the whole wait" — on Android the settle poll's own reads sit
 * on top of it, and a hide animation caught mid-way must not fail a fill the
 * blind `enter` used to pass. So after the tap the guard resolves the
 * target and reads the band up to this many times, KEYBOARD_HIDE_DELAY_MS
 * apart (each look is a settled resolution, two agreeing reads), and
 * `dismissKeyboard` re-reads the tree the same number of times; only the
 * LAST still-covering look refuses. Two, not more: a keyboard still up a
 * second or so after a tap meant to hide it is not animating. Unmeasured on
 * iOS — the animation's length is not in the bug note; the figure is the
 * stage A second look's shape, applied once more.
 */
export const KEYBOARD_HIDE_CONFIRM_LOOKS = 2;

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

/**
 * The in-tree keyboard covers the tap point on two looks and the adapter
 * has nothing to hide it with (2026-10-07). NOT an AfterKeyboardDismissal —
 * nothing was pressed — and not a disagreement: one source, the tree that
 * resolved the target, read the keyboard over the point twice. A refusal,
 * because the alternative is the harm: the tap presses the keyboard and is
 * reported done (measured that day on the finportal login, 3 of 3 runs —
 * the bug this guards against, docs/bugs/2026-10-05-ios-tap-lands-on-soft-
 * keyboard.md). WHY the adapter cannot hide it is the adapter's sentence
 * (`DeviceAdapter.keyboardAdvice`), quoted in the message; this layer knows
 * only that it has no dismissal to send. A generic dismissal is stage B's
 * question.
 */
export class KeyboardWithoutDismissal extends KeyboardGuardError {
  constructor(message: string, traceLine: string, options?: ErrorOptions) {
    super(message, traceLine, options);
    this.name = 'KeyboardWithoutDismissal';
  }
}

/**
 * Anything that went wrong AFTER the in-tree guard tapped a configured
 * dismissal (stage B, 2026-10-07) — the sibling of AfterKeyboardDismissal
 * for the in-tree model: there the irreversible side effect is a `back`,
 * here it is ONE tap on an element the config named (or the accessory
 * toolbar's button). The tap cannot be taken back, and whether it hid the
 * keyboard, did something of its own, or both, is only known from the look
 * after it: still covered → this, with the band; the target not coming back
 * → this, wrapping the resolution's error as `cause`. Never a second
 * strategy after a tap: a tap that did not hide the keyboard has changed
 * the screen in a way this layer cannot judge, and a second one would
 * compound it. The message says the screen may have changed; `traceLine`
 * says which strategy was tapped.
 */
export class AfterDismissalTap extends KeyboardGuardError {
  constructor(message: string, traceLine: string, options?: ErrorOptions) {
    super(message, traceLine, options);
    this.name = 'AfterDismissalTap';
  }
}

/**
 * One way to hide the in-tree keyboard without submitting (stage B,
 * 2026-10-07), tried by the guard only where the oracle-less branch would
 * otherwise refuse — never on an adapter with an oracle, whose `back` is the
 * dismissal. The config's vocabulary (`app.ios.keyboardDismiss`,
 * flow/config.ts) is converted to this before it crosses into interact/,
 * which knows neither the YAML nor the platform:
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
   * Read only on the oracle-less branch — an adapter with an oracle never
   * sees them, so an Android run with dismissals configured is the same run.
   */
  dismissals?: readonly KeyboardDismissal[];
}

/** A dismissal as the refusal's list names it: `tap id:"login_title"`, `accessory`. */
const describeDismissal = (d: KeyboardDismissal): string => (d.kind === 'tap' ? `tap ${describeTarget(d.target)}` : 'accessory');

/** The strategy the guard picked: what it will tap, and the words the note and the trace use for it. */
interface PickedDismissal {
  node: UiNode;
  /** `id:"login_title"` for a tap (with `(N matches, the first)` under `first` mode when several did); `the accessory toolbar's "Done"` for the accessory button. */
  what: string;
}

/** What pickDismissal decided: the first usable strategy, if any, and why every strategy before it — or every one — was passed over. */
interface DismissalPick {
  picked?: PickedDismissal;
  /** One line per skipped strategy, `tap id:"x": not found` — the refusal and the warning print them, so "absent" and "unusable" are told apart. */
  skipped: string[];
}

/** Is the point inside the rect — left and top inclusive, right and bottom exclusive, like `covers` and the Android frame test. */
const inside = (rect: Rect, point: { x: number; y: number }): boolean =>
  point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;

/**
 * The node DRAWN OVER `point` on top of `node`, if any (review round 1): the
 * last node in pre-order AFTER `node`'s subtree — later siblings and their
 * descendants are drawn over earlier ones, later Windows over earlier (UIKit
 * orders them by level) — that is content (not a structural wrapper: a
 * full-screen `Other` of a later Window contains every point and draws
 * nothing), has area and contains the point. The keyboard's own nodes are
 * NOT exempt: a strategy under the keyboard is caught first by the band
 * check (with its own reason), and a keyboard-owned node over the point
 * that the band missed is a real cover (review 2026-10-07). `undefined` when
 * nothing shadows the point. Ancestors and earlier siblings never count:
 * they are beneath. A heuristic, not a compositor — a transparent overlay
 * reads as cover, a label inside a sheet that does not contain the point
 * does not — but it refuses the measured kind of false target: an alert's
 * or a sheet's content over the title, a navigation bar's own label.
 */
function shadowing(tree: UiNode, node: UiNode, point: { x: number; y: number }): UiNode | undefined {
  let after = false;
  let over: UiNode | undefined;
  const walk = (n: UiNode): void => {
    if (n === node) {
      after = true; // the node's own subtree is the node
      return;
    }
    if (after && !STRUCTURAL_ROLES.has(n.role) && rectArea(n.rect) > 0 && inside(n.rect, point)) over = n;
    for (const child of n.children) walk(child);
  };
  walk(tree);
  return over;
}

/**
 * The FIRST configured dismissal that is usable, judged on one tree — the
 * one that found the keyboard covering, so no device read is spent on the
 * choice — and no wait: a dismissal that is not there now is not there.
 * Every strategy passed over gets a reason (`DismissalPick.skipped`).
 *
 * A `tap` strategy is usable when its target matches a NON-INTERACTIVE node
 * with area (review round 1: the resolution policy prefers the sole
 * interactive match, so `tap: { text: "Sign in" }` on a screen with a title
 * and a button so labelled would have tapped the BUTTON — the one thing a
 * dismissal must never do; interactive matches are dropped here before any
 * choice, and a spec that matches only controls is reported as such), is
 * unambiguous under the caller's `refuse` mode (the guard must not pick one
 * of two titles; under `first` the first is taken, as a flow step would,
 * and the choice is said in `what`), is not the keyboard's own UI
 * (`partOfKeyboard`: a tap on a key or on Done is what `accessory` is for),
 * has its centre clear of the band (a configured element under the keyboard
 * would be the very tap this guard refuses), inside the screen — the root's
 * rect, when it has one: a title scrolled above the viewport is still in
 * the tree, WDA keeps off-screen nodes — and not drawn over by later content
 * (`shadowing`: an alert, a sheet, a navigation bar's label). An `accessory`
 * is usable when `accessoryDismissButton` answers; that answer is under an
 * `ofKeyboard` root by construction, so no keyboard check is repeated here.
 */
function pickDismissal(tree: UiNode, dismissals: readonly KeyboardDismissal[], ambiguous: Ambiguity): DismissalPick {
  const band = keyboardInTree(tree);
  const skipped: string[] = [];
  for (const d of dismissals) {
    const name = describeDismissal(d);
    if (d.kind === 'accessory') {
      const button = accessoryDismissButton(tree);
      if (button !== undefined) {
        return { picked: { node: button, what: `the accessory toolbar's ${button.label === null ? 'button' : JSON.stringify(button.label)}` }, skipped };
      }
      skipped.push(`${name}: no accessory toolbar on screen`);
      continue;
    }
    const matches = findTarget(tree, d.target).filter((n) => rectArea(n.rect) > 0);
    const neutral = matches.filter((n) => !isInteractive(n));
    if (neutral.length === 0) {
      skipped.push(
        matches.length === 0
          ? `${name}: not found`
          : `${name}: only interactive ${matches.length === 1 ? 'match' : 'matches'} (${matches.map((n) => n.role).join(', ')}) — a dismissal must be a non-interactive element`,
      );
      continue;
    }
    if (neutral.length > 1 && ambiguous === 'refuse') {
      skipped.push(`${name}: ${neutral.length} matches`);
      continue;
    }
    const node = neutral[0];
    const what = neutral.length > 1 ? `${describeTarget(d.target)} (${neutral.length} matches, the first)` : describeTarget(d.target);
    if (partOfKeyboard(tree, node)) {
      skipped.push(`${name}: the keyboard's own control`);
      continue;
    }
    const at = tapPoint(node);
    if (windowOver(band, at).over === 'covering') {
      skipped.push(`${name}: under the keyboard`);
      continue;
    }
    if (rectArea(tree.rect) > 0 && !inside(tree.rect, at)) {
      skipped.push(`${name}: off screen at (${at.x},${at.y})`);
      continue;
    }
    const over = shadowing(tree, node, at);
    if (over !== undefined) {
      skipped.push(`${name}: covered by ${over.role}${over.label === null ? '' : ` ${JSON.stringify(over.label)}`}`);
      continue;
    }
    return { picked: { node, what }, skipped };
  }
  return { skipped };
}

/** The sentence a refusal or a warning ends with when nothing was picked: which strategies there were and why each was passed over. */
const nothingPicked = (dismissals: readonly KeyboardDismissal[], skipped: readonly string[]): string =>
  dismissals.length === 0 ? 'no dismissal is configured' : `none of the configured dismissals is usable on this screen (${skipped.join('; ')})`;

// ─── The decisions, one per phase ────────────────────────────────────────────
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
// before the table existed.
//
// Now each phase is its own pure, synchronous decision with its own result
// type, so the compiler — not a runtime throw — rules out the impossible
// arms, and `resolveClearOfKeyboard` reads top to bottom as the protocol its
// doc describes. The guard's decisions take the input method's word and
// nothing else, because they are reached only once the window state covers
// the point — the one fail-open rule for every other reading is the guard's
// own, stated where it is applied, not a row. What the table got
// right stays: one `pressKey('back')` in the codebase (`pressBack`, below),
// one `unknown → back` rule (the dismissal's) and one `unknown → proceed`
// rule (the guard's), each with its reason beside it. Proven unchanged by an
// old-vs-new differential over seeded window/witness/back-effect sequences
// (the same harness that proved the table on 2026-10-04).

/**
 * The dismissal's reading of the window state — it has no point, so shown
 * ANYWHERE is `covering`, hidden is `clear`, and `unknown` is kept apart
 * because it is the one place unknown means back (`dismissal`). The guard
 * reads the state through `CoverReading` instead, with the frame.
 */
type WindowReading = 'covering' | 'clear' | 'unknown';

/** The guard's reading of one window state against the tap point, with the frame when it covers — so a message can quote it without a second look. */
type CoverReading = { over: 'covering'; frame: Rect } | { over: 'clear' } | { over: 'unknown' };

const covers = (keyboard: SoftKeyboard & { state: 'shown' }, point: { x: number; y: number }): boolean => inside(keyboard.frame, point);

/**
 * The dismissal's reading: a keyboard shown ANYWHERE is in the way — there is
 * no point to test — hidden is clear, and an unreadable state stays apart.
 * One owner of the SoftKeyboard → reading mapping for the dismissal, kept as
 * a function rather than inlined at its one call so the mapping and
 * `dismissal`'s rows read in the same vocabulary.
 */
const windowAnywhere = (keyboard: SoftKeyboard): WindowReading =>
  keyboard.state === 'shown' ? 'covering' : keyboard.state === 'hidden' ? 'clear' : 'unknown';

/** The guard's reading: does the frame contain the point about to be tapped? Geometry only; the decisions below judge. */
export const windowOver = (keyboard: SoftKeyboard, point: { x: number; y: number }): CoverReading =>
  keyboard.state === 'unknown'
    ? { over: 'unknown' }
    : keyboard.state === 'shown' && covers(keyboard, point)
      ? { over: 'covering', frame: keyboard.frame }
      : { over: 'clear' };

/**
 * The guard's FIRST look, once the window state has put a keyboard over the
 * tap point (the not-covering case — hidden, a frame elsewhere, or a state
 * that could not be read — never reaches a decision: it is the guard's own
 * one fail-open rule, stated where it is applied in resolveClearOfKeyboard).
 *
 *   witness shown / unknown                   → back
 *     The decision the window state alone made before the veto existed
 *     (2026-10-04): a witness that cannot be asked — adb failure, an Android
 *     version that does not print `mInputShown` (unverified outside API 33;
 *     the stale-window hazard REMAINS there) — leaves it standing.
 *   witness hidden                            → hold
 *     The veto. The window state can be stale for seconds after a navigation
 *     (measured that day: full frame reported, input method already said
 *     not shown); `back` then navigates, a tap then presses a key. Nothing
 *     is sent on one disagreeing sample; the re-check rounds follow.
 */
export function firstLook(witness: KeyboardWitness): 'back' | 'hold' {
  return witness === 'hidden' ? 'hold' : 'back';
}

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
 * The look after the one `back`, to confirm the keyboard went. No witness:
 * the key is already pressed, the frame decides — and comes back with the
 * refusal, so the message can quote it without a second look.
 *
 *   window clear / unknown                    → proceed
 *     Gone, or unreadable — fail open; the note says when the state could
 *     not be read.
 *   covering                                  → refuse (with the frame)
 *     Still covered after the one dismissal: THROW, tap nothing. Never a
 *     loop — a keyboard `back` does not hide (a field that re-requests it,
 *     an IME that ignores back) would be a `back` per round, and the second
 *     one navigates.
 */
export function afterBack(window: CoverReading): { action: 'proceed' } | { action: 'refuse'; frame: Rect } {
  return window.over === 'covering' ? { action: 'refuse', frame: window.frame } : { action: 'proceed' };
}

/**
 * The in-tree keyboard's decision (2026-10-07): the adapter has no oracle,
 * the reading is the tree's (`readSoftKeyboard`, off the tree that resolved
 * the target — no device read), and there is no dismissal to decide about,
 * so the phase has no witness and presses nothing. Taken TWICE when the
 * first look covers (review round 1): the settle wait proves the TARGET
 * held still across two reads, not the keyboard, and a keyboard still
 * sliding away after the step before (a `tap:` on the title, then at once
 * the submit) reads as covering on one look — so the covering case waits
 * KEYBOARD_HIDE_DELAY_MS, resolves again and decides on that look; only a
 * second `refuse` refuses. The same two rows as `afterBack`, kept as its
 * own decision because the reason behind `refuse` differs: there, the one
 * `back` is already spent; here, there was never a key to press.
 *
 *   window clear / unknown                    → proceed
 *     No band in the tree (none on screen, or a source that carries none —
 *     idb), a band elsewhere, or a target that is the keyboard's own UI
 *     (`partOfKeyboard`, read as unknown): the guard's fail-open rule, as
 *     everywhere.
 *   covering                                  → refuse (with the band)
 *     First look: the second look. Second look: a configured dismissal
 *     (stage B) when one is usable, else tap nothing, press nothing —
 *     KeyboardWithoutDismissal. Third look (after the dismissal tap): tap
 *     nothing more — AfterDismissalTap.
 */
export function inTreeLook(window: CoverReading): { action: 'proceed' } | { action: 'refuse'; frame: Rect } {
  return window.over === 'covering' ? { action: 'refuse', frame: window.frame } : { action: 'proceed' };
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
 *     As the first look: the veto applies to the dismissal too (the stale
 *     window state after a navigation is where it was measured), and with
 *     nothing to wait for, a denied keyboard is simply left alone.
 */
export function dismissal(window: 'clear' | 'unknown'): 'back' | 'nothing';
export function dismissal(window: 'covering', witness: KeyboardWitness): 'back' | 'nothing';
export function dismissal(window: WindowReading, witness?: KeyboardWitness): 'back' | 'nothing' {
  if (window !== 'covering') return window === 'unknown' ? 'back' : 'nothing';
  return witness === 'hidden' ? 'nothing' : 'back';
}

// ─── The callers ─────────────────────────────────────────────────────────────

/** The adapter surface the dismissal needs: the oracle and the key (the window model), or the tree and the tap (the in-tree model, stage B). */
type KeyboardAdapter = Pick<DeviceAdapter, 'keyboard' | 'pressKey' | 'uiTree' | 'tap'>;

/**
 * THE ONE `back` averi sends for keyboard reasons (2026-10-04): the tap
 * guard's dismissal and `dismissKeyboard` both come through here, and only
 * after a decision above has said `back` — on a witness asked immediately
 * before, or on `dismissal`'s one `unknown → back` row (no witness: there is
 * no window state for it to contradict) — never after the key, never on a
 * path that presses nothing.
 */
const pressBack = (adapter: KeyboardAdapter): Promise<void> => adapter.pressKey('back');

/** `[x,y][x2,y2]`, the frame as dumpsys prints it — the one spelling in every message that quotes one. */
const frameText = ({ x, y, width, height }: Rect): string => `[${x},${y}][${x + width},${y + height}]`;

/** The guard's answer when it had nothing to do: the node and its note, without the tree the resolution rode in on. */
const bare = ({ node, note }: Resolved): ResolvedClear => ({ node, note });

/** The guard's answer: the node, with the keyboard sentence folded into the resolution note and kept alone beside it. */
const withNote = (resolved: Resolved, keyboardHidden: string): ResolvedClear => ({
  node: resolved.node,
  note: resolved.note === undefined ? keyboardHidden : `${resolved.note}; ${keyboardHidden}`,
  keyboardHidden,
});

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
 * The protocol — each step is one of the decisions above, in order:
 *   resolve → read the keyboard (`readSoftKeyboard`: the oracle's `state()`
 *   when the adapter has one, else the band the tree source marked in the
 *   tree that resolved the target — no device asked; `unknown` when the
 *   target is the keyboard's own UI) → tap point outside it (or hidden, or
 *   unknown): done, the node as resolved (the fail-open rule, below).
 *   Inside it, no oracle (iOS: the keyboard is part of the tree): wait out
 *   a hide animation (KEYBOARD_HIDE_DELAY_MS), resolve AGAIN and read again
 *   (`inTreeLook`): clear now — the node of that look, with a note that
 *   the keyboard left; still covering — since stage B (2026-10-07, the same
 *   day) the configured dismissals (`GuardOptions.dismissals`,
 *   `pickDismissal`) are judged on that second look's tree: none usable —
 *   KeyboardWithoutDismissal, nothing tapped, nothing pressed, the message
 *   naming the configured list (or that none is configured) beside the
 *   adapter's own sentence on why it cannot hide the keyboard itself; one
 *   usable — ONE tap at its centre, the hide delay, a THIRD look resolved
 *   with the same options, and the band read off it: clear — the node of
 *   that look with the note `…; hidden by tapping <strategy> before
 *   tapping`; still covering, or the target not coming back —
 *   AfterDismissalTap, never a second strategy (its class says why). The
 *   dismissal tap is the in-tree model's one side effect, as `back` is the
 *   window model's: measured non-submitting (a neutral title, the
 *   accessory Done), where the keyboard's own return key and the blind
 *   `enter` submit (K5d). Before 2026-10-07 the oracle-less adapter
 *   returned the node unguarded, and the measured tap went into the
 *   AutoFill bar.
 *   Inside it, with the oracle:
 *   (or hidden, or unknown): done, the node as resolved (the fail-open
 *   rule, below).
 *   Inside it: ask the witness, press `back` unless it DENIES the keyboard —
 *   the "shown" just read can be stale and `back` with no keyboard up
 *   navigates away (`firstLook`). Denied: nothing is sent, neither back nor
 *   the tap; both sources are asked again for a bounded time (`recheck`, the
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
 * already carries it — the window model reads the oracle and may press
 * `back`, the in-tree model reads the tree and presses nothing. The remedy
 * (`back`) is an Android key, and only an adapter with an oracle that says
 * `shown` ever reaches it; an adapter WITH an oracle never reads the tree
 * for the keyboard (the Android tree carries no band, and two readings of
 * one keyboard would need a rule for their disagreement).
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
 * applied), and then that tap is the stray character. Also rejected, after
 * a day in the tree (2026-10-04 → 2026-10-05): one decision table over all
 * four phases — see the note above the decisions.
 */
export async function resolveClearOfKeyboard(
  adapter: Pick<DeviceAdapter, 'uiTree' | 'tap' | 'keyboard' | 'keyboardAdvice' | 'pressKey'>,
  target: Target,
  opts: GuardOptions,
): Promise<ResolvedClear> {
  const first = await resolveSettled(adapter, target, opts);
  const at = tapPoint(first.node);
  const reading = await readSoftKeyboard(adapter, first.tree, first.node);
  const opening = windowOver(reading.keyboard, at);
  // THE guard's one fail-open rule, applied here and at each re-check round
  // below: nothing over the point — hidden, a frame elsewhere — or a state
  // that could not be read means the tap goes ahead as before the question
  // existed. The question exists to make a tap safer and must never be the
  // reason a tap did not happen; a device that is really gone fails the tap
  // itself, in the tap's own words. Only a COVERING reading reaches
  // firstLook/recheck; after the back, afterBack has its own fail-open row
  // (its reason there).
  if (opening.over !== 'covering') return bare(first);

  const what = describeTarget(target);
  /** The fact every sentence below starts from; each outcome appends its own ending. */
  const covered = `the soft keyboard covered ${what}`;
  const oracle = adapter.keyboard;
  if (oracle === undefined) {
    // The in-tree model (KeyboardOracle, adapters/types.ts): nothing is
    // asked of the device and nothing is pressed, whichever way it goes.
    // The second look — same options, so the target proves it holds still
    // again — decides (inTreeLook's doc has why one look is not enough).
    await sleep(KEYBOARD_HIDE_DELAY_MS);
    let second: ResolvedSettled;
    try {
      second = await resolveSettled(adapter, target, opts);
    } catch (e) {
      // The target did not come back for the second look (or came back
      // ambiguous). Nothing was pressed, so the screen is as the step found
      // it — but the trace must still show that the first look found the
      // keyboard over the target, or a timeout here reads as a plain slow
      // screen (review round 2; the Android path's AfterKeyboardDismissal
      // does the same for its second look, with the key press to report).
      const saw = `the soft keyboard covered ${what} at (${at.x},${at.y}) on a first look`;
      const [headline, ...rest] = errorMessage(e).split('\n');
      const message =
        e instanceof AmbiguityRefusal
          ? `${errorMessage(e)}\n(This was the second look, after ${saw}. Nothing was pressed)`
          : [`After ${saw}, the second look failed: ${headline}. Nothing was pressed; the screen is as the step found it`, ...rest].join('\n');
      throw new KeyboardWithoutDismissal(message, `${covered}; nothing sent, and the second look failed`, { cause: e });
    }
    const point = tapPoint(second.node);
    const look = inTreeLook(windowOver((await readSoftKeyboard(adapter, second.tree, second.node)).keyboard, point));
    if (look.action === 'proceed') return withNote(second, `${covered}; gone on the second look`);
    // Stage B (2026-10-07): the configured dismissals, judged on the second
    // look's tree — the one that just read the keyboard covering. None
    // configured, or none usable on this screen: the refusal, as stage A.
    const dismissals = opts.dismissals ?? [];
    const { picked, skipped } = dismissals.length === 0 ? { picked: undefined, skipped: [] } : pickDismissal(second.tree, dismissals, opts.ambiguous);
    if (picked === undefined) {
      // Names MCP tools and "a flow" — the deliberate exception recorded at
      // the "back did not close it" error below. The platform's facts (why
      // no key hides it, what was measured to, and where a dismissal is
      // configured) are the adapter's sentence, quoted; this layer says only
      // that it has none to tap, and why each configured one was passed over.
      const cannot = reading.advice === undefined ? 'this adapter cannot hide it' : `this adapter cannot hide it (${reading.advice})`;
      throw new KeyboardWithoutDismissal(
        `The soft keyboard covers ${what}: the band it draws over ${frameText(look.frame)} contains the tap point ` +
          `(${point.x},${point.y}) on two looks ${KEYBOARD_HIDE_DELAY_MS}ms apart; ${cannot}, and ${nothingPicked(dismissals, skipped)}. Nothing was tapped: ` +
          `the tap would have pressed the keyboard and been reported done. From the MCP tools: hide the keyboard first, ` +
          `then tap ${what} again. In a flow: hide it with a step before this one (a tap: on an element the keyboard ` +
          `does not cover), configure a dismissal for the guard to tap, or lay the screen out so ${what} is not under the keyboard`,
        `${covered}; no dismissal, nothing sent`,
      );
    }
    // ONE tap on the strategy's element — the in-tree model's one side
    // effect, and like the oracle's one `back` never repeated: whatever the
    // looks after it find, no second strategy is tapped. Then the same wait
    // and the same look as after a `back`: the hide animation, the target
    // resolved AGAIN with the same options (the keyboard-avoiding layout
    // moves things when the keyboard goes — the 2FA screen grows from h 518
    // back to 874), and the band read off that look — up to
    // KEYBOARD_HIDE_CONFIRM_LOOKS times, so an animation caught mid-way is
    // not a refusal (its doc has the reason).
    const tapped = `${covered}; tapped ${picked.what} to hide it`;
    const at2 = tapPoint(picked.node);
    await adapter.tap(at2.x, at2.y);
    for (let look = 1; ; look++) {
      await sleep(KEYBOARD_HIDE_DELAY_MS);
      let next: ResolvedSettled;
      try {
        next = await resolveSettled(adapter, target, opts);
      } catch (e) {
        // The target did not come back after the dismissal tap (or came back
        // ambiguous). Something WAS tapped this time, so the wording is the
        // Android path's, not the second look's: say what was tapped and that
        // the screen may have changed.
        const did = `tapping ${picked.what} at (${at2.x},${at2.y}) to hide the soft keyboard that covered ${what} at (${point.x},${point.y})`;
        const hint = 'That tap may have changed the screen — check it (ui_snapshot / screenshot)';
        const [headline, ...rest] = errorMessage(e).split('\n');
        const message =
          e instanceof AmbiguityRefusal
            ? `${errorMessage(e)}\n(This was the look after ${did}. ${hint})`
            : [`After ${did}: ${headline}. ${hint}`, ...rest].join('\n');
        throw new AfterDismissalTap(message, `${tapped}, and the look after it failed`, { cause: e });
      }
      const pointNext = tapPoint(next.node);
      const after = inTreeLook(windowOver((await readSoftKeyboard(adapter, next.tree, next.node)).keyboard, pointNext));
      if (after.action === 'proceed') return withNote(next, `${covered}; hidden by tapping ${picked.what} before tapping`);
      if (look < KEYBOARD_HIDE_CONFIRM_LOOKS) continue;
      throw new AfterDismissalTap(
        `Tapped ${picked.what} at (${at2.x},${at2.y}) to hide the soft keyboard covering ${what}, but it is still up: the band ` +
          `${frameText(after.frame)} still contains the tap point (${pointNext.x},${pointNext.y}) on ${look} looks ${KEYBOARD_HIDE_DELAY_MS}ms apart; ` +
          `nothing else was tapped. That tap may have changed the screen (the keyboard was raised again, or the element did something ` +
          `of its own) — look at it (ui_snapshot / screenshot) before retrying. From the MCP tools: hide the keyboard another way, then tap ` +
          `${what} again. In a flow: configure a dismissal that hides the keyboard on THIS screen, or lay the screen out so ${what} is not under it`,
        `${tapped}, still covered`,
      );
    }
  }
  const backPressed = `${covered}; back pressed`;
  /** The input method's last word — the wording of a later failure depends on whether it could be asked. */
  let witness = await oracle.witness();
  /** The point being judged: the first resolution's, until a look during the wait finds the target elsewhere. */
  let judged = at;
  /** How long the input method took to confirm the keyboard, when it denied it at first. */
  let confirmedAfterMs: number | undefined;

  if (firstLook(witness) === 'hold') {
    // Vetoed: the window state says covered, the input method says no
    // keyboard. Send nothing on this one sample; ask both again, bounded.
    const disagreement = `the window state reported a soft keyboard over ${what} that the input method denied`;
    let stillCovering = opening.frame;
    for (let waited = KEYBOARD_DISAGREEMENT_POLL_MS; ; waited += KEYBOARD_DISAGREEMENT_POLL_MS) {
      await sleep(KEYBOARD_DISAGREEMENT_POLL_MS);
      const now = await oracle.state();
      let window = windowOver(now, judged);
      if (window.over !== 'covering') {
        const settled = await resolveSettled(adapter, target, opts);
        // The frame just read is tested against where the target is NOW —
        // free, `now` is in hand: a frame that left the old point but lies
        // over the new one (the layout moved while averi waited) is still a
        // keyboard over the target, and the wait goes on with that point.
        const moved = tapPoint(settled.node);
        window = windowOver(now, moved);
        if (window.over !== 'covering') {
          // The keyboard left the point (or the state could not be read): the
          // fail-open rule above — proceed, saying how long the wait took.
          return withNote(
            settled,
            window.over === 'unknown'
              ? `${disagreement}; waited ${waited}ms, then the window state could not be read`
              : `${disagreement}; waited ${waited}ms for it to clear`,
          );
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

  await pressBack(adapter);
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
      (witness === 'unknown'
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
  const after = windowOver(await oracle.state(), point);
  const confirmation = afterBack(after);
  if (confirmation.action === 'refuse') {
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
        `${frameText(confirmation.frame)} still contains the tap point (${point.x},${point.y}); nothing was tapped. ` +
        `From the MCP tools: inspect the screen with ui_snapshot, then press_key back once more or tap a control above ` +
        `the keyboard. In a flow: no step can recover this — the screen keeps a keyboard that back does not close ` +
        `over ${what} — fix the screen (or the test data) so the target is not under the keyboard`,
      backPressed,
    );
  }
  // `unknown` after the dismissal fails open like everywhere else — the tap
  // goes ahead — but the note must not claim what was not seen.
  return withNote(
    second,
    after.over === 'unknown'
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
 * decision is `dismissal` above, and this file is where the one `back`
 * lives — fill.ts had kept a second copy of the `unknown → back` rule.
 *
 * An adapter WITHOUT the oracle (iOS) reads the keyboard from ONE tree read
 * and presses no key — since stage B, 2026-10-07. Until then it pressed
 * `enter` blind, asking nothing, which `KeyboardOracle` (adapters/types.ts)
 * recorded as the in-tree model's dismissal; that key was then measured to
 * SUBMIT the finportal login from the password field (K5d, the bug note),
 * so a `fill { dismissKeyboard: true }` on iOS was a submit nobody asked
 * for. A DELIBERATE behaviour change, on purpose in both directions: with
 * a band in the tree the guard's configured dismissals are tried
 * (`pickDismissal`, the same rule as the tap guard's — the first usable one
 * is tapped once, then one re-read confirms the band is gone, and a band
 * still up is AfterDismissalTap, since the tap had an effect this layer
 * cannot judge); with NO band — none on screen, the keyboard parked by the
 * HID typing the fill just did (the device check: every `fill` parks it),
 * or an idb tree, which never carries one — nothing is pressed and nothing
 * is tapped. Under `treeSource: idb` the step is therefore a no-op: the
 * tree cannot see the keyboard, and the only blind key submits. Better a
 * keyboard left up, which the NEXT step's guard refuses to tap through
 * (and the pixel asserts fail closed on), than a form submitted.
 *
 * A band with no usable dismissal — none configured, or none on this screen
 * — is a WARNING returned, not a throw: on Android this function is best
 * effort too (the witness's veto leaves a keyboard up silently, and no
 * read after the `back` confirms it went), the flow author who wrote
 * `dismissKeyboard: true` for Android's sake must not lose the iOS leg
 * over it, and what the keyboard would harm — the next tap, the next pixel
 * assert — is guarded in its own place and refuses there with the full
 * message. The warning makes the trace say the keyboard was left up, so
 * that refusal is not a surprise. A dismissal that WAS tapped and did not
 * hide the keyboard throws (AfterDismissalTap): that is not "nothing
 * done", the screen was touched.
 *
 * With the oracle (Android), since 2026-10-03: `back` is pressed only if the
 * window state does not say the keyboard is HIDDEN. Before that date it was
 * pressed blindly, and `back` with no keyboard up NAVIGATES BACK — a field
 * that raises no keyboard (a custom PIN pad, a hardware keyboard, a picker)
 * turned `dismissKeyboard: true` into leaving the screen. The rows (and
 * their reasons) are `dismissal`'s:
 * - shown   → back — unless, since 2026-10-04, the independent witness denies
 *   the keyboard: then nothing is pressed, and nothing is waited for;
 * - hidden  → nothing: there is nothing to dismiss;
 * - unknown → back, exactly as before, the witness not asked.
 * One oracle query per dismissal (its cost: AndroidAdapter's keyboardState),
 * and the witness query when that query says shown. The oracle path reads
 * none of `opts` and returns an empty result: Android is byte-identical.
 */
export async function dismissKeyboard(
  adapter: KeyboardAdapter,
  opts?: { dismissals?: readonly KeyboardDismissal[]; ambiguous: Ambiguity },
): Promise<DismissResult> {
  const oracle = adapter.keyboard;
  if (oracle !== undefined) {
    const reading = windowAnywhere(await oracle.state());
    const decision = reading === 'covering' ? dismissal(reading, await oracle.witness()) : dismissal(reading);
    if (decision === 'back') await pressBack(adapter);
    return {};
  }
  const tree = await adapter.uiTree();
  if (keyboardInTree(tree).state !== 'shown') return {};
  const dismissals = opts?.dismissals ?? [];
  // `opts` is defined whenever there is a dismissal to pick, and its
  // `ambiguous` is required there: no default policy is written here.
  const { picked, skipped } = opts !== undefined && dismissals.length > 0 ? pickDismissal(tree, dismissals, opts.ambiguous) : { picked: undefined, skipped: [] };
  if (picked === undefined) {
    return { warning: `the soft keyboard is up and was left up: ${nothingPicked(dismissals, skipped)} — the next tap under it will be refused` };
  }
  const at = tapPoint(picked.node);
  await adapter.tap(at.x, at.y);
  // The same confirmation as the guard's: up to KEYBOARD_HIDE_CONFIRM_LOOKS
  // reads, KEYBOARD_HIDE_DELAY_MS apart, and only the last still-up read
  // refuses.
  for (let read = 1; ; read++) {
    await sleep(KEYBOARD_HIDE_DELAY_MS);
    const after = keyboardInTree(await adapter.uiTree());
    if (after.state !== 'shown') return { hidden: `tapping ${picked.what}` };
    if (read < KEYBOARD_HIDE_CONFIRM_LOOKS) continue;
    throw new AfterDismissalTap(
      `Tapped ${picked.what} at (${at.x},${at.y}) to hide the soft keyboard after the fill, but it is still up over ` +
        `${frameText(after.frame)} on ${read} reads ${KEYBOARD_HIDE_DELAY_MS}ms apart; nothing else was tapped. That tap may have changed ` +
        `the screen (the keyboard was raised again, or the element did something of its own) — look at it (ui_snapshot / screenshot). ` +
        `In a flow: configure a dismissal that hides the keyboard on THIS screen, or drop dismissKeyboard from this fill`,
      `the soft keyboard was up after the fill; tapped ${picked.what} to hide it, still up`,
    );
  }
}

/** What `dismissKeyboard` did, for the caller's trace: at most one of the two, and neither on the oracle path. */
export interface DismissResult {
  /** The in-tree keyboard was up and this hid it: `tapping id:"login_title"` — the flow's fill line appends `; keyboard hidden by ${hidden}`. */
  hidden?: string;
  /** The in-tree keyboard was up and nothing usable was configured: left up, said so — the flow logs it as a `⚠ fill` line. */
  warning?: string;
}
