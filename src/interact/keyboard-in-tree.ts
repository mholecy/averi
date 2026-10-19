import type { Rect, UiNode } from '../adapters/types.js';
import { frameText } from '../ui-tree/geometry.js';
import { lookOn, type Look } from '../ui-tree/look.js';
import { cannotHide } from '../ui-tree/soft-keyboard.js';
import { usableScreen } from '../ui-tree/usable-screen.js';
import { sleep } from '../util/sleep.js';
import {
  AVERIS_OWN,
  configuredStrategies,
  moved,
  movedAt,
  movedNoted,
  movedPassive,
  moving,
  nextMove,
  perform,
  type DismissalGround,
  type DismissalMove,
  type DismissalStrategy,
} from './keyboard-dismissal.js';
import {
  confirmHidden,
  failedLookMessage,
  KEYBOARD_HIDE_DELAY_MS,
  KeyboardGuardError,
  lookAgain,
  withNote,
  type ClearedLook,
  type CoveredLook,
  type DismissOptions,
  type DismissResult,
  type Hiding,
  type KeyboardAdapter,
  type KeyboardDismissal,
  type KeyboardModel,
  type SeenLook,
} from './keyboard-model.js';
import type { RefusedOnPresentElement } from './resolve.js';

/**
 * The IN-TREE model (iOS under WDA): the soft keyboard is part
 * of the accessibility tree — its keys are nodes — and the tree source marks
 * the band it draws over (`KEYBOARD_ROLE`) and the Windows that are its own
 * UI (`ofKeyboard`; adapters/wda-source.ts#keyboardMarks has the rules and
 * the measurements). Nothing is asked of the device to read it: the band is
 * read off the tree that resolved the target (a reading,
 * `ui-tree/keyboard-cover.ts#readKeyboard`, over `ui-tree/soft-keyboard.ts`),
 * and there is no key that hides it without a side effect — the return key
 * and the blind `enter` SUBMIT from the field (K5d), so a covered point is
 * refused unless the config names an element to tap first. This module
 * owns everything that follows: the second look that confirms the band, the
 * dismissal picker, the one tap, the confirming looks and the words — one
 * adapter at the seam `keyboard-model.ts` describes, beside the window
 * model. Chosen by `keyboard.ts#keyboardModel` for an adapter WITHOUT the
 * oracle; the platform label is never read. An idb tree marks no band (on
 * iOS 27 it lists the keys, as plain buttons, and the band, as `other`,
 * but no node as `KEYBOARD_ROLE`), so under `treeSource: idb` every look
 * reads `unknown` and the guard acts on nothing — fail open (idb's band is a
 * line the judgements read, never a reading the guard acts on).
 * docs/bugs/2026-10-05-ios-tap-lands-on-soft-keyboard.md
 * docs/adr/0006-idb-keyboard-band-is-a-keyboard-line.md
 */

/**
 * How many looks this model takes for the keyboard to be GONE after a
 * dismissal tap: KEYBOARD_HIDE_DELAY_MS was
 * measured on Android as the floor of a hide animation, "not the whole
 * wait" — there the settle poll's own reads sit on top of it — and is
 * unmeasured on iOS (the constant's doc), where a hide animation caught
 * mid-way must not fail a fill a blind `enter` would pass. So after the tap the guard resolves
 * the target and reads the band up to this many times, KEYBOARD_HIDE_DELAY_MS
 * apart (each look is a settled resolution, two agreeing reads), and
 * `dismissKeyboard` re-reads the tree the same number of times; only the
 * LAST still-covering look refuses. Two, not more: a keyboard still up a
 * second or so after a tap meant to hide it is not animating. The iOS
 * animation's length is unmeasured — the figure is the second look's shape,
 * applied once more — but the device check (iPhone 17 simulator, WDA
 * source; the bug note below, "Device check of the fix (stage B)", B2 and
 * B4b), after both a title tap and the
 * accessory's Done, three runs of three, observed the band GONE at the
 * first read of the FIRST confirm look (the settled pair, 162/162 in B2) —
 * within the 300 ms pause plus one ~0.55 s read; the second slot was never
 * used, so the figure has headroom there, not a measured margin. The
 * dismissal's one-read looks (`dismiss`) were not reached on the device.
 * docs/bugs/2026-10-05-ios-tap-lands-on-soft-keyboard.md
 */
export const KEYBOARD_HIDE_CONFIRM_LOOKS = 2;

/**
 * The in-tree keyboard covers the tap point on two looks and nothing can
 * hide it — the adapter has no means and no configured dismissal is usable
 * — or the second look could not resolve the target after the
 * first found it covered (wrapped here, `cause` kept). NOT an AfterKeyboardDismissal —
 * nothing was pressed — and not a disagreement: one source, the tree that
 * resolved the target, read the keyboard over the point twice. A refusal,
 * because the alternative is the harm: the tap presses the keyboard and is
 * reported done (measured on the finportal login, 3 of 3 runs — the bug
 * this guards against, cited on the module's header). WHY the adapter cannot hide it on its own is the adapter's
 * sentence (`DeviceAdapter.keyboardAdvice`), quoted in the message; this layer knows
 * only that it has no dismissal to send. Configured dismissals
 * are tried before this is thrown; their reasons for being passed over are
 * in the message.
 */
export class KeyboardWithoutDismissal extends KeyboardGuardError implements RefusedOnPresentElement {
  /**
   * True when the target resolved on both looks — a refusal on a present
   * element (resolve.ts#RefusedOnPresentElement), which an `optional:` does
   * not skip; false when the second look did not resolve it again (`cause`
   * kept), where whether it is still there is unknown and an `optional:`
   * skips it with its headline.
   */
  readonly refusedOnPresentElement: boolean;
  constructor(message: string, traceLine: string, resolvedTwice: boolean, options?: ErrorOptions) {
    super(message, traceLine, options);
    this.name = 'KeyboardWithoutDismissal';
    this.refusedOnPresentElement = resolvedTwice;
  }
}


/**
 * Anything that went wrong AFTER the in-tree guard moved to hide the keyboard — the sibling of AfterKeyboardDismissal
 * (keyboard-window.ts) for this model: there the irreversible side effect is a `back`, here it is the moves of the
 * dismissal strategies tried (keyboard-dismissal.ts: a tap on an element the config named, the accessory toolbar's
 * button, then — after a configured move left the keyboard up — averi's own upward drag), each confirmed before the next. A move cannot be taken back, and
 * whether it hid the keyboard, did something of its own, or both, is only known from the look after it: still covered
 * once every strategy has had its turn → this, with the band and every move made; the target not coming back → this,
 * at once, wrapping the resolution's error as `cause` (after the post-fill dismissal's move, a confirming read that
 * throws — the same wrap, `afterMoveFailed`): a screen the target has left is one no further strategy is judged on.
 * The message says the screen may have changed; `traceLine` says what was moved.
 */
export class AfterDismissalTap extends KeyboardGuardError {
  constructor(message: string, traceLine: string, options?: ErrorOptions) {
    super(message, traceLine, options);
    this.name = 'AfterDismissalTap';
  }
}

/**
 * What a refusal after the in-tree model's moves says in all four places (the guard's still-up look and its failed
 * look, `dismissKeyboard`'s still-up read and its failed read): a move cannot be undone, and the screen is the
 * reader's to look at. One tap is said as before the fallbacks; several moves, or a drag, say what more they may have
 * done. Not the window model's sentence after a failed look (keyboard-window.ts, the `hint` its Hiding carries): that
 * one says back may have NAVIGATED if no keyboard was really up, and whether the witness could be asked — a different
 * fact about a different key, so it is written there.
 */
const mayHaveChanged = (moves: readonly DismissalMove[]): string =>
  moves.length === 1 && moves[0].kind === 'tap'
    ? 'That tap may have changed the screen (the keyboard was raised again, or the element did something of its own) — look at it (ui_snapshot / screenshot)'
    : 'Those moves may have changed the screen (the keyboard was raised again, an element tapped did something of its own, or a drag scrolled the content) — look at it (ui_snapshot / screenshot)';

/** `tapping id:"login_title" at (201,303)`, `…, then dragging the target's scroll view up from (201,502) to (201,382)` — what was done, as the failed-look sentences say it. */
const movesDoing = (moves: readonly DismissalMove[]): string => moves.map((m) => `${moving(m)} ${movedAt(m)}`).join(', then ');

/** `Tapped id:"login_title" at (201,303)`, `…, then dragged the target's scroll view up from (201,502) to (201,382)` — a still-up refusal's opening. */
const movesDone = (moves: readonly DismissalMove[]): string => {
  const text = moves.map((m) => `${moved(m)} ${movedAt(m)}`).join(', then ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** `tapped id:"login_title"`, `tapped id:"login_title", dragged the target's scroll view up` — the trace's. */
const movesTrace = (moves: readonly DismissalMove[]): string => moves.map(moved).join(', ');

/** `nothing else was tapped`, or `done` once a drag was among the moves. */
const nothingElse = (moves: readonly DismissalMove[]): string => `nothing else was ${moves.some((m) => m.kind === 'drag') ? 'done' : 'tapped'}`;

/** ` (passed over: <skip lines>)` — why each strategy judged after the first move was passed over — or nothing when none was. */
const passedOver = (skipped: readonly string[]): string => (skipped.length === 0 ? '' : ` (passed over: ${skipped.join('; ')})`);

/**
 * THE wrap for a look that failed after a dismissal move — the one owner of "a read after the dismissal failed", for
 * both protocols that move: the guard's confirming looks (`Hiding.failed`, the target not coming back or coming back
 * ambiguous) and the post-fill dismissal's confirming reads (a tree read that throws — WDA or idb gone between the move
 * and the read). Both are wrapped: a read's own error left raw is not a KeyboardGuardError, so the flow engine's
 * `tracingGuardFailure` would log no `⚠ fill` line and the `✗` line would never say a move had been sent. `did` is the
 * moves as both sentences name them (`tapping <strategy> at (x,y) to hide the soft keyboard …`); `traceLine` is the
 * caller's, since each protocol's trace sentence starts from its own fact. The message is `failedLookMessage`'s shape
 * with `mayHaveChanged` after it, as on the still-up refusals. The refused sentence ("This was the look after …") is
 * the guard's: a tree read cannot be refused for ambiguity, so the dismissal only ever gets the `failed` one.
 */
const afterMoveFailed =
  (did: string, moves: readonly DismissalMove[], traceLine: string) =>
  (e: unknown): AfterDismissalTap =>
    new AfterDismissalTap(
      failedLookMessage(e, `This was the look after ${did}. ${mayHaveChanged(moves)}`, (headline) => `After ${did}: ${headline}. ${mayHaveChanged(moves)}`),
      traceLine,
      { cause: e },
    );

/** The sentence a refusal or a warning ends with when nothing was moved: which strategies there were and why each was passed over. */
const nothingPicked = (dismissals: readonly KeyboardDismissal[], skipped: readonly string[]): string =>
  dismissals.length === 0 ? 'no dismissal is configured' : `none of the configured dismissals is usable on this screen (${skipped.join('; ')})`;

// ─── The model ───────────────────────────────────────────────────────────────

/**
 * The in-tree model over one adapter. `guard` and `dismiss` are the
 * protocols ARCHITECTURE.md §8 describes; the facts behind each row are at
 * the row.
 */
export function inTreeModel(adapter: KeyboardAdapter): KeyboardModel {
  return {
    /**
     * The guard's protocol once the band in the tree covers the tap point.
     *
     * The second look first: the settle wait proves the
     * TARGET held still across two reads, not the keyboard, and a keyboard
     * still sliding away after the step before (a `tap:` on the title, then
     * at once the submit) reads as covering on one look — so the covering
     * case waits KEYBOARD_HIDE_DELAY_MS, resolves again with the same
     * options (`lookAgain`) and decides on that look; the first look alone
     * never refuses. Its rows:
     *   window clear / unknown                    → proceed
     *     No band in the tree (none on screen, or a source that marks
     *     none — idb), a band elsewhere, or a target that is the keyboard's
     *     own UI (`ofKeyboard`, read as unknown): the guard's fail-open
     *     rule, as everywhere — the node of that look, with the note that
     *     the keyboard is gone (no band) or still up but no longer over the
     *     target (a band elsewhere: the layout re-flowed).
     *   covering                                  → the dismissal strategies, or refuse (with the band)
     *     The configured strategies (keyboard-dismissal.ts#configuredStrategies,
     *     `GuardOptions.dismissals`) are judged on this look's tree, the one
     *     that just read the keyboard covering: none chooses a move —
     *     KeyboardWithoutDismissal, nothing
     *     moved, the message naming the configured list (or that none is
     *     configured) beside `cannotHide` (ui-tree/soft-keyboard.ts: "this
     *     adapter cannot hide it on its own", then the adapter's `advice` on
     *     why and what works); one does — the `Hiding`: its ONE move, then up
     *     to KEYBOARD_HIDE_CONFIRM_LOOKS confirming looks (the first clear one
     *     proceeds with the note `…; hidden by tapping <strategy> before
     *     tapping`, or `…; tapped <strategy>, and the keyboard is still up but
     *     no longer over it` when the band stayed and the target moved). Still
     *     covering on the last look, the strategies after it — the configured
     *     ones left, then averi's own (keyboard-dismissal.ts#AVERIS_OWN, the
     *     drag anchored on the guarded target), which follow only a configured
     *     move that left the keyboard up — are judged on THAT look and the
     *     next move is the next Hiding (`stillCovering`),
     *     its note saying which moves left the keyboard up; every strategy
     *     spent — AfterDismissalTap, naming every move; the target not coming
     *     back on any look — AfterDismissalTap at once.
     * Each move is irreversible and none is repeated; a strategy is judged
     * only once the move before it is confirmed to have left the keyboard
     * up, on the screen as that move left it. What a move may be, and why
     * the return key is never one (it submits, K5d), is keyboard-dismissal.ts's.
     * Unguarded, the measured tap went into the AutoFill bar.
     */
    async guard({ target, opts, point: at, screen, what, covered }: CoveredLook): Promise<{ cleared: ClearedLook } | { hiding: Hiding }> {
      await sleep(KEYBOARD_HIDE_DELAY_MS);
      // The target not coming back for the second look (or coming back
      // ambiguous): nothing was pressed, so the screen is as the step found
      // it — but the trace must still show that the first look found the
      // keyboard over the target.
      const saw = `${covered} at (${at.x},${at.y}) on a first look`;
      const second = await lookAgain(
        adapter,
        target,
        opts,
        (e) =>
          new KeyboardWithoutDismissal(
            failedLookMessage(
              e,
              `This was the second look, after ${saw}. Nothing was pressed`,
              (headline) => `After ${saw}, the second look failed: ${headline}. Nothing was pressed; the screen is as the step found it`,
            ),
            `${covered}; nothing sent, and the second look failed`,
            false,
            { cause: e },
          ),
      );
      // The two clear rows say different things: no band in the tree is "gone"; a band still in the
      // tree with the target moved out from under it — the keyboard-avoiding
      // layout re-flowed — is "still up", so the note never claims a keyboard
      // left the screen that is still on it.
      if (second.verdict.kind !== 'covered') {
        return {
          cleared: withNote(
            second.resolved,
            second.verdict.kind === 'clear' ? `${covered}; still up on the second look, but no longer over it` : `${covered}; gone on the second look`,
          ),
        };
      }
      const { point } = second;
      const dismissals = opts.dismissals ?? [];
      const groundOf = (resolved: SeenLook): DismissalGround => ({ look: resolved.look, screen, ambiguous: opts.ambiguous, target: resolved.node });
      const first = await nextMove(configuredStrategies(dismissals), groundOf(second.resolved));
      if (first.move === undefined) {
        // Names MCP tools and "a flow" — the deliberate exception recorded at
        // the window model's "back did not close it" error. The platform's
        // facts (why no key hides it, what was measured to, and where a
        // dismissal is configured) are the adapter's sentence, quoted; this
        // layer says only that it has none to tap, and why each configured
        // one was passed over.
        const cannot = cannotHide(adapter.keyboardAdvice);
        throw new KeyboardWithoutDismissal(
          `The soft keyboard covers ${what}: the band it draws over ${frameText(second.verdict.frame)} contains the tap point ` +
            `(${point.x},${point.y}) on two looks ${KEYBOARD_HIDE_DELAY_MS}ms apart; ${cannot}, and ${nothingPicked(dismissals, first.skipped)}. Nothing was tapped: ` +
            `the tap would have pressed the keyboard and been reported done. From the MCP tools: hide the keyboard first, ` +
            `then tap ${what} again. In a flow: hide it with a step before this one (a tap: on an element the keyboard ` +
            `does not cover), configure a dismissal for the guard to tap, or lay the screen out so ${what} is not under the keyboard`,
          `${covered}; no dismissal, nothing sent`,
          true,
        );
      }
      // One Hiding per move: `before` the moves already made (each confirmed to have left the keyboard up), `skipped`
      // every skip line so far.
      const hidingOf = (before: readonly DismissalMove[], { move, rest }: { move: DismissalMove; rest: readonly DismissalStrategy[] }, skipped: readonly string[]): Hiding => {
        const moves = [...before, move];
        const left = before.length === 0 ? '' : `${movesTrace(before)}, the keyboard stayed up; `;
        return {
          // ONE move — this model's side effect, never repeated; the next strategy's move is the next Hiding's.
          perform: () => perform(adapter, move),
          sent: `${moves.map(movedPassive).join(', then ')} to hide the soft keyboard`,
          // The keyboard-avoiding layout moves things when the keyboard goes
          // (the 2FA screen grows from h 518 back to 874): each look resolves
          // the target again and reads the band off that look.
          looks: KEYBOARD_HIDE_CONFIRM_LOOKS,
          // Something WAS moved, so the wording is the move's (mayHaveChanged,
          // as on its still-up look), not the second look's.
          failed: afterMoveFailed(
            `${movesDoing(moves)} to hide the soft keyboard that covered ${what} at (${point.x},${point.y})`,
            moves,
            `${covered}; ${movesTrace(moves)} to hide it, and the look after it failed`,
          ),
          // As on the second look: a band still in the tree after the move, with
          // the target now clear of it, is said as such — the move moved the
          // layout, or something else did; it did not hide the keyboard.
          hidden: (after) =>
            after.kind === 'clear'
              ? `${covered}; ${left}${movedNoted(move)}, and the keyboard is still up but no longer over it`
              : `${covered}; ${left}hidden by ${moving(move)}${move.kind === 'drag' ? ` ${movedAt(move)}` : ''} before tapping`,
          async stillCovering(seen, looks) {
            const next = await nextMove(rest, groundOf(seen.resolved));
            const passed = [...skipped, ...next.skipped];
            if (next.move !== undefined) return hidingOf(moves, next.move, passed);
            return new AfterDismissalTap(
              `${movesDone(moves)} to hide the soft keyboard covering ${what}, but it is still up: the band ` +
                `${frameText(seen.frame)} still contains the tap point (${seen.point.x},${seen.point.y}) on ${looks} looks ${KEYBOARD_HIDE_DELAY_MS}ms apart` +
                `${moves.length > 1 ? ' after each' : ''}; ${nothingElse(moves)}${passedOver(passed)}. ${mayHaveChanged(moves)} before retrying. From the MCP tools: hide the keyboard another way, then tap ` +
                `${what} again. In a flow: configure a dismissal that hides the keyboard on THIS screen, or lay the screen out so ${what} is not under it`,
              `${covered}; ${movesTrace(moves)} to hide it, still covered`,
            );
          },
        };
      };
      // Averi's own follow a configured move, never stand in for one (ADR 0022): they join the list only behind it.
      return { hiding: hidingOf([], { move: first.move.move, rest: [...first.move.rest, ...AVERIS_OWN] }, []) };
    },

    /**
     * The dismissal after a fill: ONE tree read and no key. Never a blind
     * `enter`: that key was measured to SUBMIT the finportal login from the
     * password field (K5d, the bug note), so a `fill { dismissKeyboard: true }`
     * on iOS would be a submit nobody asked for. Both directions: with a
     * band in the tree the configured dismissals are tried in order
     * (keyboard-dismissal.ts#configuredStrategies; never averi's own drag:
     * it is anchored on a target, and a fill's dismissal has none) — the
     * first usable one is moved, then up to KEYBOARD_HIDE_CONFIRM_LOOKS
     * re-reads, KEYBOARD_HIDE_DELAY_MS before each, confirm the band is gone
     * (`confirmHidden`, shared with the guard); a band still up on the last
     * has the next usable one judged on that read and moved, and a band up
     * once none is left is AfterDismissalTap, since a move had an effect this
     * layer cannot judge; with NO band — none on screen, the keyboard parked by
     * the HID typing the fill just did (the device check: every `fill`
     * parks it), or an idb tree, which never marks one — nothing is
     * pressed and nothing is tapped. Under `treeSource: idb` the step is
     * therefore a no-op: the tree cannot see the keyboard, and the only
     * blind key submits. Better a keyboard left up, which the NEXT step's
     * guard refuses to tap through (and the pixel asserts fail closed on),
     * than a form submitted.
     *
     * A band with no usable dismissal — none configured, or none on this
     * screen — is a WARNING returned, not a throw: the window model's
     * dismissal is best effort too (the witness's veto leaves a keyboard up
     * silently, and no read after the `back` confirms it went), the flow
     * author who wrote `dismissKeyboard: true` for Android's sake must not
     * lose the iOS leg over it, and what the keyboard would harm — the next
     * tap, the next pixel assert — is guarded in its own place and refuses
     * there with the full message. The warning makes the trace say the
     * keyboard was left up, so that refusal is not a surprise. A dismissal
     * that WAS moved and did not hide the keyboard throws
     * (AfterDismissalTap): that is not "nothing done", the screen was touched.
     * So does a confirming read that throws (`afterMoveFailed`,
     * the guard's wrap): the move was sent whatever the read says next.
     */
    async dismiss({ dismissals = [], ambiguous }: DismissOptions): Promise<DismissResult> {
      let look = lookOn(adapter, await adapter.uiTree());
      if ((await look.reading.anywhere()) !== 'shown') return {};
      const groundOf = async (on: Look): Promise<DismissalGround> => ({ look: on, screen: await usableScreen(adapter, on), ambiguous });
      let next = await nextMove(configuredStrategies(dismissals), await groundOf(look));
      if (next.move === undefined) {
        return { warning: `the soft keyboard is up and was left up: ${nothingPicked(dismissals, next.skipped)} — the next tap under it will be refused` };
      }
      const moves: DismissalMove[] = [];
      const skipped: string[] = [];
      for (;;) {
        const { move, rest } = next.move;
        moves.push(move);
        // The one wrap the guard's looks use (`afterMoveFailed`): a read that
        // throws after the move is AfterDismissalTap, so the trace gets its
        // `⚠ fill` line and the message says what was moved. Only the read is
        // wrapped — the move itself failing is the move's own error, nothing
        // having been sent that this layer knows of.
        const failed = afterMoveFailed(
          `${movesDoing(moves)} to hide the soft keyboard after the fill`,
          [...moves],
          `the soft keyboard was up after the fill; ${movesTrace(moves)} to hide it, and the read after it failed`,
        );
        await perform(adapter, move);
        // The same confirmation as the guard's, each look one tree read.
        const seen = await confirmHidden<DismissResult, { frame: Rect; look: Look }>(KEYBOARD_HIDE_CONFIRM_LOOKS, async () => {
          let reread: UiNode;
          try {
            reread = await adapter.uiTree();
          } catch (e) {
            throw failed(e);
          }
          const after = lookOn(adapter, reread);
          const cover = await after.reading.cover();
          return cover === undefined
            ? { gone: { hiddenBy: moves.length === 1 ? moving(move) : `${moving(move)}, after ${moves.slice(0, -1).map(moving).join(', ')} left it up` } }
            : { stillUp: { frame: cover.band, look: after } };
        });
        if ('gone' in seen) return seen.gone;
        look = seen.stillUp.look;
        next = await nextMove(rest, await groundOf(look));
        skipped.push(...next.skipped);
        if (next.move !== undefined) continue;
        throw new AfterDismissalTap(
          `${movesDone(moves)} to hide the soft keyboard after the fill, but it is still up over ` +
            `${frameText(seen.stillUp.frame)} on ${seen.looks} reads ${KEYBOARD_HIDE_DELAY_MS}ms apart${moves.length > 1 ? ' after each' : ''}; ${nothingElse(moves)}${passedOver(skipped)}. ${mayHaveChanged(moves)}. ` +
            `In a flow: configure a dismissal that hides the keyboard on THIS screen, or drop dismissKeyboard from this fill`,
          `the soft keyboard was up after the fill; ${movesTrace(moves)} to hide it, still up`,
        );
      }
    },
  };
}
