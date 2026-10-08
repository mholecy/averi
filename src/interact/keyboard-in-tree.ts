import { rectArea, type Rect, type UiNode } from '../adapters/types.js';
import { containsPoint, shadowing } from '../ui-tree/geometry.js';
import { isInteractive, tapPoint } from '../ui-tree/selectors.js';
import { accessoryDismissButton, cannotHide, keyboardInTree, partOfKeyboard } from '../ui-tree/soft-keyboard.js';
import { sleep } from '../util/sleep.js';
import {
  confirmHidden,
  failedLookMessage,
  frameText,
  KEYBOARD_HIDE_DELAY_MS,
  KeyboardGuardError,
  lookAgain,
  keyboardOver,
  withNote,
  type CoveredLook,
  type DismissOptions,
  type DismissResult,
  type Hiding,
  type KeyboardAdapter,
  type KeyboardDismissal,
  type KeyboardModel,
  type ResolvedClear,
} from './keyboard-model.js';
import { describeTarget, findTarget, type Ambiguity } from './resolve.js';

/**
 * The IN-TREE model (iOS under WDA, 2026-10-07): the soft keyboard is part
 * of the accessibility tree — its keys are nodes — and the tree source marks
 * the band it draws over (`KEYBOARD_ROLE`) and the Windows that are its own
 * UI (`ofKeyboard`; adapters/wda-source.ts#keyboardMarks has the rules and
 * the measurements). Nothing is asked of the device to read it: the band is
 * read off the tree that resolved the target (`ui-tree/soft-keyboard.ts`),
 * and there is no key that hides it without a side effect — the return key
 * and the blind `enter` SUBMIT from the field (K5d, docs/bugs/2026-10-05-ios-
 * tap-lands-on-soft-keyboard.md), so a covered point is refused unless the
 * config names an element to tap first (stage B, the same day). This module
 * owns everything that follows: the second look that confirms the band, the
 * dismissal picker, the one tap, the confirming looks and the words — one
 * adapter at the seam `keyboard-model.ts` describes, beside the window
 * model. Chosen by `keyboard.ts#keyboardModel` for an adapter WITHOUT the
 * oracle; the platform label is never read. An idb tree carries no band, so
 * under `treeSource: idb` every look reads `unknown` and the guard is as it
 * was before this model existed — fail open.
 */

/**
 * How many looks this model takes for the keyboard to be GONE after a
 * dismissal tap (stage B, review round 1): KEYBOARD_HIDE_DELAY_MS was
 * measured on Android as the floor of a hide animation, "not the whole
 * wait" — there the settle poll's own reads sit on top of it — and is
 * unmeasured on iOS (the constant's doc), where a hide animation caught
 * mid-way must not fail a fill the blind `enter` used to pass. So after the tap the guard resolves
 * the target and reads the band up to this many times, KEYBOARD_HIDE_DELAY_MS
 * apart (each look is a settled resolution, two agreeing reads), and
 * `dismissKeyboard` re-reads the tree the same number of times; only the
 * LAST still-covering look refuses. Two, not more: a keyboard still up a
 * second or so after a tap meant to hide it is not animating. Unmeasured on
 * iOS — the animation's length is not in the bug note; the figure is the
 * stage A second look's shape, applied once more.
 */
export const KEYBOARD_HIDE_CONFIRM_LOOKS = 2;

/**
 * The in-tree keyboard covers the tap point on two looks and nothing can
 * hide it — the adapter has no means and no configured dismissal is usable
 * (2026-10-07) — or the second look could not resolve the target after the
 * first found it covered (wrapped here, `cause` kept). NOT an AfterKeyboardDismissal —
 * nothing was pressed — and not a disagreement: one source, the tree that
 * resolved the target, read the keyboard over the point twice. A refusal,
 * because the alternative is the harm: the tap presses the keyboard and is
 * reported done (measured that day on the finportal login, 3 of 3 runs —
 * the bug this guards against, docs/bugs/2026-10-05-ios-tap-lands-on-soft-
 * keyboard.md). WHY the adapter cannot hide it on its own is the adapter's
 * sentence (`DeviceAdapter.keyboardAdvice`), quoted in the message; this layer knows
 * only that it has no dismissal to send. Configured dismissals (stage B)
 * are tried before this is thrown; their reasons for being passed over are
 * in the message.
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
 * (keyboard-window.ts) for this model: there the irreversible side effect
 * is a `back`, here it is ONE tap on an element the config named (or the
 * accessory toolbar's button). The tap cannot be taken back, and whether it
 * hid the keyboard, did something of its own, or both, is only known from
 * the look after it: still covered → this, with the band; the target not
 * coming back → this, wrapping the resolution's error as `cause` (after
 * the post-fill dismissal's tap, a confirming read that throws — the same
 * wrap, `afterTapFailed`). Never a second strategy after a tap: a tap that
 * did not hide the keyboard has changed the screen in a way this layer
 * cannot judge, and a second one would compound it. The message says the
 * screen may have changed; `traceLine` says which strategy was tapped.
 */
export class AfterDismissalTap extends KeyboardGuardError {
  constructor(message: string, traceLine: string, options?: ErrorOptions) {
    super(message, traceLine, options);
    this.name = 'AfterDismissalTap';
  }
}

/**
 * What a dismissal tap's refusal says in all four places (the guard's
 * still-up look and its failed look, `dismissKeyboard`'s still-up read and
 * its failed read):
 * the tap cannot be untapped, and the screen is the reader's to look at.
 * Not the window model's sentence after a failed look (keyboard-window.ts,
 * the `hint` its Hiding carries): that one says back may have NAVIGATED if
 * no keyboard was really up, and whether the witness could be asked — a
 * different fact about a different key, so it is written there.
 */
const MAY_HAVE_CHANGED = 'That tap may have changed the screen (the keyboard was raised again, or the element did something of its own) — look at it (ui_snapshot / screenshot)';

/**
 * THE wrap for a look that failed after a dismissal tap — the one owner of
 * "a read after the dismissal tap failed", for both protocols that tap: the
 * guard's confirming looks (`Hiding.failed`, the target not coming back or
 * coming back ambiguous) and the post-fill dismissal's confirming reads (a
 * tree read that throws — WDA or idb gone between the tap and the read).
 * Until 2026-10-08 the second had no wrap at all: the read's own error left
 * `dismiss` raw, not a KeyboardGuardError, so the flow engine's
 * `tracingGuardFailure` logged no `⚠ fill` line and the `✗` line never said
 * a tap had been sent (architecture review 2026-10-07, #1 and small
 * correction 12). `did` is the tap as both sentences name it (`tapping
 * <strategy> at (x,y) to hide the soft keyboard …`); `traceLine` is the
 * caller's, since each protocol's trace sentence starts from its own fact.
 * The message is `failedLookMessage`'s shape with MAY_HAVE_CHANGED after
 * it, as on the still-up refusals: the tap cannot be untapped. The refused
 * sentence ("This was the look after …") is the guard's: a tree read cannot
 * be refused for ambiguity, so the dismissal only ever gets the `failed`
 * one.
 */
const afterTapFailed =
  (did: string, traceLine: string) =>
  (e: unknown): AfterDismissalTap =>
    new AfterDismissalTap(
      failedLookMessage(e, `This was the look after ${did}. ${MAY_HAVE_CHANGED}`, (headline) => `After ${did}: ${headline}. ${MAY_HAVE_CHANGED}`),
      traceLine,
      { cause: e },
    );

// ─── The dismissal picker ────────────────────────────────────────────────────

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
 * (`shadowing`, ui-tree/geometry.ts: an alert, a sheet, a navigation bar's
 * label). An `accessory` is usable when `accessoryDismissButton` answers;
 * that answer is under an `ofKeyboard` root by construction, so no keyboard
 * check is repeated here.
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
    if (keyboardOver(band, at).over === 'covering') {
      skipped.push(`${name}: under the keyboard`);
      continue;
    }
    if (rectArea(tree.rect) > 0 && !containsPoint(tree.rect, at)) {
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
     * Nothing is asked of the device and nothing is pressed, whichever way
     * it goes.
     *
     * The second look first (review round 1): the settle wait proves the
     * TARGET held still across two reads, not the keyboard, and a keyboard
     * still sliding away after the step before (a `tap:` on the title, then
     * at once the submit) reads as covering on one look — so the covering
     * case waits KEYBOARD_HIDE_DELAY_MS, resolves again with the same
     * options (`lookAgain`) and decides on that look; the first look alone
     * never refuses. Its rows:
     *   window clear / unknown                    → proceed
     *     No band in the tree (none on screen, or a source that carries
     *     none — idb), a band elsewhere, or a target that is the keyboard's
     *     own UI (`partOfKeyboard`, read as unknown): the guard's fail-open
     *     rule, as everywhere — the node of that look, with the note that
     *     the keyboard is gone (no band) or still up but no longer over the
     *     target (a band elsewhere: the layout re-flowed).
     *   covering                                  → a dismissal, or refuse (with the band)
     *     Since stage B (2026-10-07, the same day) the configured
     *     dismissals (`GuardOptions.dismissals`, `pickDismissal`) are judged
     *     on this look's tree — the one that just read the keyboard
     *     covering: none usable — KeyboardWithoutDismissal, nothing tapped,
     *     nothing pressed, the message naming the configured list (or that
     *     none is configured) beside `cannotHide` (ui-tree/soft-keyboard.ts:
     *     "this adapter cannot hide it on its own", then the adapter's
     *     `advice` on why and what works); one usable — the `Hiding`: ONE
     *     tap at its centre, then up to KEYBOARD_HIDE_CONFIRM_LOOKS
     *     confirming looks (the first clear one proceeds with the note
     *     `…; hidden by tapping <strategy> before tapping`, or `…; tapped
     *     <strategy>, and the keyboard is still up but no longer over it`
     *     when the band stayed and the target moved; the last still
     *     covering, or the target not coming back on any — AfterDismissalTap,
     *     never a second strategy; its class says why). The same two rows as
     *     the window model's look after `back`, with a different reason
     *     behind `refuse`: there, the one `back` is already spent; here,
     *     there was never a key to press.
     * The dismissal tap is this model's one side effect, as `back` is the
     * window model's: measured non-submitting (a neutral title, the
     * accessory Done), where the keyboard's own return key and the blind
     * `enter` submit (K5d). Before 2026-10-07 the oracle-less adapter
     * returned the node unguarded, and the measured tap went into the
     * AutoFill bar.
     */
    async guard({ target, opts, point: at, what, covered }: CoveredLook): Promise<{ cleared: ResolvedClear } | { hiding: Hiding }> {
      await sleep(KEYBOARD_HIDE_DELAY_MS);
      // The target not coming back for the second look (or coming back
      // ambiguous): nothing was pressed, so the screen is as the step found
      // it — but the trace must still show that the first look found the
      // keyboard over the target (review round 2).
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
            { cause: e },
          ),
      );
      // The two clear rows say different things (review round 1 of the
      // model split): no band in the tree is "gone"; a band still in the
      // tree with the target moved out from under it — the keyboard-avoiding
      // layout re-flowed — is "still up", so the note never claims a keyboard
      // left the screen that is still on it.
      if (second.reading.over !== 'covering') {
        return {
          cleared: withNote(
            second.resolved,
            second.reading.over === 'clear' ? `${covered}; still up on the second look, but no longer over it` : `${covered}; gone on the second look`,
          ),
        };
      }
      const { point } = second;
      const dismissals = opts.dismissals ?? [];
      const { picked, skipped } = pickDismissal(second.resolved.tree, dismissals, opts.ambiguous);
      if (picked === undefined) {
        // Names MCP tools and "a flow" — the deliberate exception recorded at
        // the window model's "back did not close it" error. The platform's
        // facts (why no key hides it, what was measured to, and where a
        // dismissal is configured) are the adapter's sentence, quoted; this
        // layer says only that it has none to tap, and why each configured
        // one was passed over.
        const cannot = cannotHide(adapter.keyboardAdvice);
        throw new KeyboardWithoutDismissal(
          `The soft keyboard covers ${what}: the band it draws over ${frameText(second.reading.frame)} contains the tap point ` +
            `(${point.x},${point.y}) on two looks ${KEYBOARD_HIDE_DELAY_MS}ms apart; ${cannot}, and ${nothingPicked(dismissals, skipped)}. Nothing was tapped: ` +
            `the tap would have pressed the keyboard and been reported done. From the MCP tools: hide the keyboard first, ` +
            `then tap ${what} again. In a flow: hide it with a step before this one (a tap: on an element the keyboard ` +
            `does not cover), configure a dismissal for the guard to tap, or lay the screen out so ${what} is not under the keyboard`,
          `${covered}; no dismissal, nothing sent`,
        );
      }
      const tapped = `${covered}; tapped ${picked.what} to hide it`;
      const dismissalAt = tapPoint(picked.node);
      const did = `tapping ${picked.what} at (${dismissalAt.x},${dismissalAt.y}) to hide the soft keyboard that covered ${what} at (${point.x},${point.y})`;
      return {
        hiding: {
          // ONE tap on the strategy's element — this model's one side
          // effect, and like the window model's one `back` never repeated:
          // whatever the looks after it find, no second strategy is tapped.
          perform: () => adapter.tap(dismissalAt.x, dismissalAt.y),
          // The keyboard-avoiding layout moves things when the keyboard goes
          // (the 2FA screen grows from h 518 back to 874): each look resolves
          // the target again and reads the band off that look.
          looks: KEYBOARD_HIDE_CONFIRM_LOOKS,
          // Something WAS tapped this time, so the wording is the dismissal
          // tap's (MAY_HAVE_CHANGED, as on its still-up look), not the second
          // look's: say what was tapped and that the screen may have changed.
          failed: afterTapFailed(did, `${tapped}, and the look after it failed`),
          // As on the second look: a band still in the tree after the tap, with
          // the target now clear of it, is said as such — the tap moved the
          // layout, or something else did; it did not hide the keyboard.
          hidden: (after) =>
            after.over === 'clear'
              ? `${covered}; tapped ${picked.what}, and the keyboard is still up but no longer over it`
              : `${covered}; hidden by tapping ${picked.what} before tapping`,
          stillCovering: ({ frame, point: targetAt }, looks) =>
            new AfterDismissalTap(
              `Tapped ${picked.what} at (${dismissalAt.x},${dismissalAt.y}) to hide the soft keyboard covering ${what}, but it is still up: the band ` +
                `${frameText(frame)} still contains the tap point (${targetAt.x},${targetAt.y}) on ${looks} looks ${KEYBOARD_HIDE_DELAY_MS}ms apart; ` +
                `nothing else was tapped. ${MAY_HAVE_CHANGED} before retrying. From the MCP tools: hide the keyboard another way, then tap ` +
                `${what} again. In a flow: configure a dismissal that hides the keyboard on THIS screen, or lay the screen out so ${what} is not under it`,
              `${tapped}, still covered`,
            ),
        },
      };
    },

    /**
     * The dismissal after a fill: ONE tree read and no key — since stage B,
     * 2026-10-07. Until then it pressed `enter` blind, asking nothing, which
     * `KeyboardOracle` (adapters/types.ts) recorded as this model's
     * dismissal; that key was then measured to SUBMIT the finportal login
     * from the password field (K5d, the bug note), so a
     * `fill { dismissKeyboard: true }` on iOS was a submit nobody asked for.
     * A DELIBERATE behaviour change, on purpose in both directions: with a
     * band in the tree the guard's configured dismissals are tried
     * (`pickDismissal`, the same rule as the guard's — the first usable one
     * is tapped once, then up to KEYBOARD_HIDE_CONFIRM_LOOKS re-reads,
     * KEYBOARD_HIDE_DELAY_MS before each, confirm the band is gone
     * (`confirmHidden`, shared with the guard), and a band still up on the
     * last is AfterDismissalTap, since the tap had an effect this layer
     * cannot judge); with NO band — none on screen, the keyboard parked by
     * the HID typing the fill just did (the device check: every `fill`
     * parks it), or an idb tree, which never carries one — nothing is
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
     * that WAS tapped and did not hide the keyboard throws
     * (AfterDismissalTap): that is not "nothing done", the screen was touched.
     * So does a confirming read that throws (2026-10-08, `afterTapFailed`,
     * the guard's wrap): the tap was sent whatever the read says next.
     */
    async dismiss({ dismissals = [], ambiguous }: DismissOptions): Promise<DismissResult> {
      const tree = await adapter.uiTree();
      if (keyboardInTree(tree).state !== 'shown') return {};
      const { picked, skipped } = pickDismissal(tree, dismissals, ambiguous);
      if (picked === undefined) {
        return { warning: `the soft keyboard is up and was left up: ${nothingPicked(dismissals, skipped)} — the next tap under it will be refused` };
      }
      const at = tapPoint(picked.node);
      // The one wrap the guard's looks use (`afterTapFailed`): a read that
      // throws after the tap is AfterDismissalTap, so the trace gets its
      // `⚠ fill` line and the message says what was tapped. Only the read is
      // wrapped — the tap itself failing is the tap's own error, nothing
      // having been sent that this layer knows of.
      const failed = afterTapFailed(
        `tapping ${picked.what} at (${at.x},${at.y}) to hide the soft keyboard after the fill`,
        `the soft keyboard was up after the fill; tapped ${picked.what} to hide it, and the read after it failed`,
      );
      await adapter.tap(at.x, at.y);
      // The same confirmation as the guard's, each look one tree read.
      return confirmHidden<DismissResult, Rect>(
        KEYBOARD_HIDE_CONFIRM_LOOKS,
        async () => {
          let reread: UiNode;
          try {
            reread = await adapter.uiTree();
          } catch (e) {
            throw failed(e);
          }
          const after = keyboardInTree(reread);
          return after.state !== 'shown' ? { gone: { hiddenBy: `tapping ${picked.what}` } } : { stillUp: after.frame };
        },
        (frame, reads) =>
          new AfterDismissalTap(
            `Tapped ${picked.what} at (${at.x},${at.y}) to hide the soft keyboard after the fill, but it is still up over ` +
              `${frameText(frame)} on ${reads} reads ${KEYBOARD_HIDE_DELAY_MS}ms apart; nothing else was tapped. ${MAY_HAVE_CHANGED}. ` +
              `In a flow: configure a dismissal that hides the keyboard on THIS screen, or drop dismissKeyboard from this fill`,
            `the soft keyboard was up after the fill; tapped ${picked.what} to hide it, still up`,
          ),
      );
    },
  };
}
