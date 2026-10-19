import type { DeviceAdapter, Point, Rect, UiNode } from '../adapters/types.js';
import type { Covering, FrameVerdict, Uncovered } from '../ui-tree/keyboard-cover.js';
import { lookOn, type Look } from '../ui-tree/look.js';
import { tapPoint } from '../ui-tree/selectors.js';
import type { UsableScreen } from '../ui-tree/usable-screen.js';
import { errorMessage } from '../util/error-message.js';
import { sleep } from '../util/sleep.js';
import { AmbiguityRefusal, resolveSettled, type Resolved, type ResolvedSettled, type SettleOptions, type Target } from './resolve.js';

/**
 * The seam between the two keyboard models: what `keyboard.ts` — the guard and the post-fill dismissal,
 * written once — needs of a model, and what both models share. A soft
 * keyboard is one of two things to a platform, and each is an adapter at
 * this seam:
 * - the WINDOW model (`keyboard-window.ts`): the keyboard is a window of its
 *   own, absent from the tree, read through the adapter's oracle
 *   (`DeviceAdapter.keyboard`) and hidden by `back` — Android;
 * - the IN-TREE model (`keyboard-in-tree.ts`): the keyboard is part of the
 *   tree, read off the band the tree source marks, hidden by a tap on an
 *   element the config names — and, when that leaves it up, by averi's own
 *   fallbacks, one move at a time (`keyboard-dismissal.ts`) — iOS under WDA.
 * Which one an adapter gets is decided ONCE, from whether it has the oracle
 * (`keyboard.ts#keyboardModel`), not again inside the guard and again inside
 * the dismissal, where each branch would re-write the shape every model
 * shares — an irreversible side effect, the hide delay, the target resolved
 * AGAIN with the same options, a reading against where it is now, a refusal
 * (or, in-tree, the next strategy's side effect) if it still covers — around its own decisions and words. The shape is
 * `keyboard.ts`'s; the decisions, the
 * side effect and the words are the model's (`KeyboardModel`, `Hiding`).
 *
 * The READING half — what the keyboard covers, and whether the input
 * method stands by it — has its own switch, one layer down:
 * `ui-tree/keyboard-cover.ts#readKeyboard`, because the pixel poll
 * (verify/, which may not import interact/) reads the keyboard too and
 * must read it the same way. Every look the guard takes, every re-check
 * round and both models' dismissals ask a reading, so the guard and the
 * poll see one keyboard by construction, and neither model calls the
 * oracle itself.
 *
 * A LOOK — the target resolved, its tree read — carries that tree's
 * ui-tree/look.ts#Look (`SeenLook`, built by `seenLook`): the scene, the
 * keyboard reading and the keyboard position of that one read. Every
 * judgement of a look — the tap's and the dismissal picker's — reads the
 * look's and builds none of its own, so one look is at most one draw-order
 * walk and one reading; `scroll_until`'s read builds its own Look, once per
 * read (scroll-read.ts#factsOf). `grep lookOn src/interact` finds only
 * `seenLook` and the post-fill dismissal's tree reads (its first, and each confirming one).
 */

/**
 * The pause before every look that follows a covering reading or the one
 * side effect — `confirmHidden` sleeps it before each of its looks, the
 * in-tree model before its second look. Measured on an API 33
 * emulator: ~0.4 s after `back` the IME insets already read
 * `visible=false` but still carried the keyboard's full frame — the hide
 * animation was running — and ~0.9 s after, the frame was empty. The settle
 * poll that follows adds its own two tree reads on top (a uiautomator dump
 * is about a second each), so this is the floor, not the whole wait: it
 * keeps the FIRST of those reads from seeing the pre-resize layout twice
 * and calling it settled. On iOS the hide animation's length is still
 * unmeasured — the in-tree model's looks take the same
 * pause for the same reason (a hide animation caught mid-way must not be a
 * refusal), and its KEYBOARD_HIDE_CONFIRM_LOOKS says how many of them it
 * takes; what was observed there is that pause plus the first read of a
 * settled look, not the animation (that constant's doc).
 */
export const KEYBOARD_HIDE_DELAY_MS = 300;

/** The adapter surface the guard and the dismissal need: the tree and the tap (every model), the oracle and the key (the window model), the advice and the drag (the in-tree model's refusal, and its fallback drag — interact/keyboard-dismissal.ts), the screen size (the on-screen rule of the tap's standing, ui-tree/standing.ts#Scene — the tap's and a dismissal's). */
export type KeyboardAdapter = Pick<DeviceAdapter, 'uiTree' | 'tap' | 'swipe' | 'keyboard' | 'keyboardAdvice' | 'pressKey' | 'viewport'>;

/**
 * A resolved node whose tap point no soft keyboard covers, and the point a
 * tap on it goes to — its centre, or an uncovered piece of
 * it when a node of the app is drawn over the centre
 * (tap-judgement.ts#TapJudge.aim).
 */
export interface ResolvedClear extends Resolved {
  /** Where to tap: the centre (`tapPoint`), or the moved point `moved` describes. */
  point: Point;
  /**
   * The tree the node was resolved in, before the tap — the fill's proof of
   * what the screen's other inputs held before it typed
   * (interact/fill-type.ts#whereTyped) when it reads nothing after the tap.
   */
  tree: UiNode;
  /**
   * Set when the tap goes elsewhere than the centre — the clause, `at
   * (201,767) — its centre (201,780) is under button "Continue to summary"
   * (24,780 354x44), drawn over it; tapped the uncovered part 354x26`.
   * NOT folded into `note`: the tap's reply puts it after the selector
   * (mcp/tool-text.ts#tapText), the fill's note says it of its focus tap,
   * and the flow traces it as a `⚠` line (flow/engine.ts#tracingDismissal).
   */
  moved?: string;
  /**
   * Set when the guard had to do something before the tap — the sentence
   * itself: `back` pressed and the keyboard hidden; pressed and unconfirmed;
   * a configured dismissal tapped; or nothing pressed but
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
 * One way to hide the in-tree keyboard without submitting, tried by the in-tree model only where it would otherwise
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
   * or empty: the guard refuses a covered target.
   * Read by the in-tree model only — the window model never sees them, so
   * an Android run with dismissals configured is the same run.
   */
  dismissals?: readonly KeyboardDismissal[];
}

/** What `dismissKeyboard` takes of the guard's options: the dismissals it may tap and the ambiguity policy they are judged under — no default policy is written here. The settle options are not among them: it resolves nothing. */
export type DismissOptions = Pick<GuardOptions, 'dismissals' | 'ambiguous'>;

/** What `dismissKeyboard` did, for the caller's trace: at most one of the two — on the window model never `hiddenBy`, and `warning` only on its `unlocated` row. */
export interface DismissResult {
  /** The in-tree keyboard was up and this hid it: `tapping id:"login_title"`, the fragment the flow's fill line appends after `; keyboard hidden by ` — not a `keyboardHidden` sentence, so the engine's `⚠` tracing cannot take this result by mistake. */
  hiddenBy?: string;
  /** A keyboard was left up, said so — the flow logs it as a `⚠ fill` line: on the in-tree model, up with nothing usable configured; on the window model, reported by the input method with no area in the window state, nothing pressed (keyboard-window.ts#dismissal, `unlocated`). */
  warning?: string;
}

/**
 * A settled resolution as one LOOK: the node, and the look of the tree read
 * that holds it (ui-tree/look.ts#Look: its scene, its keyboard reading and
 * position) — read by every judgement of the look: the tap's
 * (tap-judgement.ts#judgeTap, a TapLook as it stands) and the dismissal
 * picker's (keyboard-dismissal.ts#configuredStrategy). None derives a scene or a
 * position of its own, so a look is at most one draw-order walk; the scroll
 * read builds its own look once per read (scroll-read.ts#factsOf).
 */
export interface SeenLook extends Resolved {
  readonly look: Look;
}

/** `resolved` as a look (SeenLook): its node and note, and the look of its tree on `adapter` (ui-tree/look.ts#lookOn — building it derives and asks nothing). */
export function seenLook(adapter: Pick<DeviceAdapter, 'keyboard' | 'keyboardAdvice'>, resolved: ResolvedSettled): SeenLook {
  return { node: resolved.node, ...(resolved.note !== undefined && { note: resolved.note }), look: lookOn(adapter, resolved.tree) };
}

/**
 * A model's answer when the keyboard left the point: the node as resolved
 * again, the look it was resolved in (the chrome check, the last rule of a
 * tap, judges it there — tap-judgement.ts#TapJudge.aim), and the keyboard
 * sentence.
 */
export interface ClearedLook extends SeenLook {
  keyboardHidden?: string;
}

/** The guard's answer: the node and its look — the same look — with the keyboard sentence folded into the resolution note and kept alone beside it. */
export const withNote = (resolved: SeenLook, keyboardHidden: string): ClearedLook => ({
  node: resolved.node,
  look: resolved.look,
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

/** What one look found: the target resolved again (SeenLook: its look carries the reading off its tree, which the in-tree model's picker asks again), where it is now, and the keyboard read against that point. */
export interface LookedAgain {
  resolved: SeenLook;
  point: Point;
  verdict: FrameVerdict;
}

/**
 * One look, the same on every model: the target resolved AGAIN with the
 * SAME options — so it proves it holds still again, and so an
 * adjustResize activity's re-layout (or the iOS keyboard-avoiding layout's)
 * is followed to where the node is now — and the keyboard read against
 * that point by the look's reading, off the tree that resolved it
 * (`Look.reading.frameOver`: the in-tree model pays no device read; the
 * window model asks its oracle once, twice with the keyboard up). The frame
 * decides, never the witness: on the window model this is the look after
 * `back`, and the key is already pressed. The reading is the first look's
 * rule on every look: a target that is the keyboard's own UI reads
 * `unknown` and the oracle is not asked — rather than calling
 * `oracle.state()` directly, so an oracle adapter handed an
 * `ofKeyboard`-marked tree skips that read and proceeds as unknown;
 * no real adapter produces one (the Android tree is never marked), so the
 * difference is unreachable, and the event-log pins hold. A resolution that
 * fails — the target not coming back, or coming back ambiguous — is the
 * caller's error over `failedLookMessage`: the trace must still show what
 * the guard found or did before, or a timeout here reads as a plain slow
 * screen. No pause of its own: the caller sleeps KEYBOARD_HIDE_DELAY_MS
 * first (`confirmHidden` does for its looks).
 */
export async function lookAgain(adapter: KeyboardAdapter, target: Target, opts: GuardOptions, failed: (e: unknown) => KeyboardGuardError): Promise<LookedAgain> {
  let resolved: SeenLook;
  try {
    resolved = seenLook(adapter, await resolveSettled(adapter, target, opts));
  } catch (e) {
    throw failed(e);
  }
  const point = tapPoint(resolved.node);
  return { resolved, point, verdict: await resolved.look.reading.frameOver(point, resolved.node) };
}

/** One confirming look after the side effect: the keyboard gone, with what the caller returns, or still up, with what its refusal needs to say. */
export type ConfirmLook<T, S> = { gone: T } | { stillUp: S };

/**
 * The confirmation after a side effect, shared by the guard (both models) and the in-tree dismissal: up to `looks`
 * looks, KEYBOARD_HIDE_DELAY_MS before each — the first that finds the keyboard gone answers, and only the LAST still-up
 * look is handed back, with how many looks there were, for the caller to refuse over or (the in-tree model) to judge
 * its next strategy on. A look that throws (the target not coming back, or the tree not reading) ends it there. Never a
 * side effect between the looks: the loop has no way to act, so what a refusal says was done — "back was pressed",
 * "that tap cannot be untapped" — is what was done.
 */
export async function confirmHidden<T, S>(looks: number, look: () => Promise<ConfirmLook<T, S>>): Promise<ConfirmLook<T, S> & { looks: number }> {
  for (let n = 1; ; n++) {
    await sleep(KEYBOARD_HIDE_DELAY_MS);
    const seen = await look();
    if ('gone' in seen || n >= looks) return { ...seen, looks: n };
  }
}

/** The first look that found the point covered — what a model's guard protocol starts from. */
export interface CoveredLook {
  target: Target;
  opts: GuardOptions;
  /** Where the target was on that look. */
  point: Point;
  /** The screen the first look was judged on (ui-tree/usable-screen.ts#usableScreen, of its look's tree), for a model that judges a point of its own — the in-tree model's dismissal (the tap's standing, ui-tree/standing.ts#Scene). */
  screen: UsableScreen | undefined;
  /**
   * What the first look's reading said (`Look.reading.over`): the frame
   * (or band, or panel) that covered it, and the input method's word over
   * it — `covered` (confirmed, or the witness could not be asked) or
   * `denied`, the veto. Read by the window model only; the in-tree model
   * ignores it and takes a second look of its own (its reading is always
   * `covered`, confirmed, here).
   */
  verdict: Covering;
  /** The target as the messages name it: `id:login_submit`, `id:"login_submit"` for an ElementSpec. */
  what: string;
  /** `the soft keyboard covered <what>` — the fact every sentence starts from; each outcome appends its own ending. */
  covered: string;
}

/**
 * What a model decided to do about a covered point, handed to `keyboard.ts`
 * to carry out: ONE irreversible side effect, how many looks confirm it,
 * and the words for what those looks find. The model builds it after its own
 * pre-checks and never performs it — the skeleton does, once, and then only
 * looks (`confirmHidden`); a hiding the model hands back from
 * `stillCovering` (in-tree only) is the next one, performed and confirmed
 * the same way.
 */
export interface Hiding {
  /** The side effect: the window model's `back`, the in-tree model's move of the strategy it chose (a tap, or its fallback's drag). */
  perform(): Promise<void>;
  /** What `perform` sent, as a clause — `back was pressed to hide the soft keyboard`, `id:"login_title" was tapped at (201,303) to hide the soft keyboard` — for a refusal after it that must say something was (the off-screen rule, tap-judgement.ts#judgeTap). */
  sent: string;
  /** How many looks after it before the last still-covering one refuses: one for `back` (the frame decides), KEYBOARD_HIDE_CONFIRM_LOOKS for a dismissal tap (a hide animation caught mid-way is not a refusal). */
  looks: number;
  /** The look could not resolve the target: the model's error over `failedLookMessage`, saying what it did to the screen first, with `e` as the cause. */
  failed(e: unknown): KeyboardGuardError;
  /** A look found the point clear (or the state unreadable — fail open, but the note must not claim what was not seen): the `keyboardHidden` sentence. */
  hidden(after: Uncovered): string;
  /**
   * The last look still found it covering: the model's refusal — nothing more is done — or, on the in-tree model
   * only, the NEXT hiding, chosen on that look (its next dismissal strategy, interact/keyboard-dismissal.ts), which
   * the skeleton performs and confirms as it did this one. The window model never answers a hiding: its one `back` is
   * the only key it has.
   */
  stillCovering(seen: StillCovering, looks: number): Promise<Hiding | KeyboardGuardError>;
}

/** The last confirming look that still found the point covered: the band, where the target is now, and the look it was resolved in. */
export interface StillCovering {
  frame: Rect;
  point: Point;
  resolved: SeenLook;
}

/**
 * A keyboard model: the two questions `keyboard.ts` asks once it has read
 * the keyboard and found it in the way. Two adapters at this seam — the
 * window model and the in-tree model — so it is a real one: what varies
 * across it is how a covering keyboard is confirmed, what may be done about
 * it, and what every outcome is called; what does not vary (the first
 * look, the fail-open rule, performing a side effect, the confirming looks)
 * is written once above it.
 */
export interface KeyboardModel {
  /**
   * The guard from a first look that found the point covered up to — not
   * including — the first side effect: the model's own re-checks (the window
   * model, on a first look the input method DENIED, waits out a stale
   * window state; the in-tree model takes a second look and picks a
   * dismissal). Three endings: the keyboard left on its own and the target
   * is handed back clear, with a note that says what was waited for; a
   * refusal is thrown, nothing sent; or the hiding to perform, with its
   * words.
   */
  guard(covered: CoveredLook): Promise<{ cleared: ClearedLook } | { hiding: Hiding }>;
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
