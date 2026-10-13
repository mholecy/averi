import { rectArea, type Rect, type UiNode } from '../adapters/types.js';
import { frameText } from '../ui-tree/geometry.js';
import { keyboardEdge, readingLine, readKeyboard, type KeyboardLine, type KeyboardReading } from '../ui-tree/keyboard-cover.js';
import { isInteractive, tapPoint } from '../ui-tree/selectors.js';
import { accessoryDismissButton, cannotHide } from '../ui-tree/soft-keyboard.js';
import { sceneOf, type Scene, type Standing } from '../ui-tree/standing.js';
import { usableScreen, type UsableScreen } from '../ui-tree/usable-screen.js';
import { sleep } from '../util/sleep.js';
import {
  confirmHidden,
  failedLookMessage,
  KEYBOARD_HIDE_DELAY_MS,
  KeyboardGuardError,
  lookAgain,
  withNote,
  type CoveredLook,
  type DismissOptions,
  type DismissResult,
  type Hiding,
  type KeyboardAdapter,
  type KeyboardDismissal,
  type KeyboardModel,
  type ClearedLook,
} from './keyboard-model.js';
import { cutSliverText, describeTarget, findTarget, type Ambiguity, type RefusedOnPresentElement } from './resolve.js';

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
 * Anything that went wrong AFTER the in-tree guard tapped a configured
 * dismissal — the sibling of AfterKeyboardDismissal
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
 * Both are wrapped: a read's own error left raw is not a KeyboardGuardError,
 * so the flow engine's `tracingGuardFailure` would log no `⚠ fill` line and
 * the `✗` line would never say a tap had been sent. `did` is the tap as both sentences name it (`tapping
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
 * choice; `keyboard` is the reading off that same tree — and no wait: a
 * dismissal that is not there now is not there.
 * Every strategy passed over gets a reason (`DismissalPick.skipped`).
 *
 * A `tap` strategy is usable when its target matches a NON-INTERACTIVE node
 * with area (the resolution policy prefers the sole
 * interactive match, so `tap: { text: "Sign in" }` on a screen with a title
 * and a button so labelled would have tapped the BUTTON — the one thing a
 * dismissal must never do; interactive matches are dropped here before any
 * choice, and a spec that matches only controls is reported as such), is
 * unambiguous under the caller's `refuse` mode (the guard must not pick one
 * of two titles; under `first` the first is taken, as a flow step would,
 * and the choice is said in `what`), is not the keyboard's own UI
 * (the reading's `ofKeyboard`: a tap on a key or on Done is what `accessory`
 * is for),
 * has its centre clear of the band (a configured element under the keyboard
 * would be the very tap this guard refuses), and a tap on it would land on
 * its centre, unmoved — THE TAP'S STANDING (ui-tree/standing.ts#Scene,
 * `{ of: 'tap' }`) over `screen` (the guard's first-look screen; the
 * dismissal's own read), one scene per call, derived on first use, its
 * keyboard line the tap's (keyboard-cover.ts#readingLine merged by
 * #keyboardEdge), asked once per call, by the first strategy that gets this
 * far — under WDA a witnessed line, which refuses nothing the band check
 * above has not:
 * - `reachable` at the centre, with no interactive node there it would
 *   press — usable;
 * - off the screen or in a system band — `off screen at (x,y)`: a title
 *   scrolled above the viewport is still in the tree, WDA keeps off-screen
 *   nodes;
 * - drawn over (an alert, a sheet, a navigation bar's label) — `covered by
 *   <role> "<label>"`, naming the cover; so is a centre covered with a
 *   piece of it free, where a tap would MOVE: the configured element's
 *   centre is what was configured, so the dismissal is never aimed off it;
 * - cut to a sliver at its scroll container's edge — the tap's own clause
 *   (resolve.ts#cutSliverText); under a line no guard acts on (idb's band)
 *   — `under the keyboard`. Neither is reached under WDA today: iOS has no
 *   clipping container and no idb band.
 * What `tap` counts as a cover is a cover here: a title's own content
 * listed beside it, its own unlabelled control, a node of its frame,
 * content of a scroll view it is not in and a keyboard-owned node outside
 * the band are not; a structural wrapper partly over it is.
 * One more refusal is the picker's own: a centre an excused node listed
 * after the title holds, when that node is INTERACTIVE — `covered by
 * <role> "<label>"`, naming it (`whyNotTapped`). The excuses above say
 * where a touch lands on the title, not what else it presses: a `button
 * "Delete account"` of exactly the title's rect reads as the title listed
 * again, an interactive row of a scroll view the title is not in is
 * excused whether or not the title lies in a bar, a text field is no cover
 * of its own label — and a tap at the centre would press each. On the
 * post-fill `dismiss()` path that would be reported as `hiddenBy: tapping
 * <title>`, a wrong action said as the dismissal; a silently pressed
 * control is worse than a skipped title. Which node holds the centre is
 * read off the standing's facts (`StandingFacts.centreExcused`), judged in
 * the same draw-order pass as the covers.
 * docs/adr/0016-the-dismissal-picker-asks-the-tap-standing.md
 * An `accessory` is usable when `accessoryDismissButton` answers;
 * that answer is under an `ofKeyboard` root by construction, so no keyboard
 * check is repeated here. `keyboard` must be a reading OF `tree`: its band
 * and its `ofKeyboard` set are that tree's, and a node of another tree is
 * never the keyboard's by identity.
 */
async function pickDismissal(
  tree: UiNode,
  keyboard: KeyboardReading,
  dismissals: readonly KeyboardDismissal[],
  ambiguous: Ambiguity,
  screen: UsableScreen | undefined,
): Promise<DismissalPick> {
  const skipped: string[] = [];
  let scene: Scene | undefined; // derived once, by the first strategy that gets as far as asking the tap's standing
  let line: Promise<KeyboardLine | undefined> | undefined; // the reading's line, asked once and only then
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
    if (keyboard.ofKeyboard(node)) {
      skipped.push(`${name}: the keyboard's own control`);
      continue;
    }
    if ((await keyboard.frameOver(tapPoint(node))).kind === 'covered') {
      skipped.push(`${name}: under the keyboard`);
      continue;
    }
    scene ??= sceneOf(tree);
    const keyboardTop = keyboardEdge(await (line ??= readingLine(keyboard)), scene.order, node);
    const unusable = whyNotTapped(scene.standing(node, screen, { of: 'tap', ...(keyboardTop !== undefined && { keyboardTop }) }), node);
    if (unusable !== undefined) {
      skipped.push(`${name}: ${unusable}`);
      continue;
    }
    return { picked: { node, what }, skipped };
  }
  return { skipped };
}

/** A cover as a skip line names it: `button "Sign in"`, `toolbar`. */
const coverName = (cover: UiNode): string => `${cover.role}${cover.label === null ? '' : ` ${JSON.stringify(cover.label)}`}`;

/**
 * Why a tap standing rules a dismissal out, as its skip line says it, or
 * undefined when it lands on the dismissal's centre, unmoved, with nothing
 * there it would press. A tap that would move to an uncovered piece is no
 * dismissal: the configured element's centre is what was configured, so it
 * is skipped naming the cover over the centre. A centre the tap reaches but
 * an INTERACTIVE node listed after the candidate holds — one the `target`
 * column excused as no cover (`StandingFacts.centreExcused`: a labelled
 * control of exactly its frame, its own unlabelled control or a field over
 * its label, a row of a scroll view it is not in, a keyboard-owned control
 * outside the band) — is skipped naming that node, the last such (drawn on
 * top): the tap would press it, and on the post-fill `dismiss()` path a
 * pressed control would be reported as the dismissal. A silently pressed
 * control is worse than a skipped title (ADR 0016, the owner's decision).
 */
function whyNotTapped(standing: Standing, node: UiNode): string | undefined {
  switch (standing.kind) {
    case 'reachable': {
      if (standing.moved !== undefined) return `covered by ${coverName(standing.moved.cover)}`;
      const presses = standing.facts.centreExcused.filter(isInteractive).at(-1);
      return presses === undefined ? undefined : `covered by ${coverName(presses)}`;
    }
    case 'offScreen':
    case 'systemBar':
      return `off screen at (${standing.at.x},${standing.at.y})`;
    case 'covered':
      return `covered by ${coverName(standing.cover)}`;
    case 'cut':
      return cutSliverText(standing.cut, node.rect, standing.minPiece);
    case 'underKeyboard':
      return 'under the keyboard';
    case 'clipped':
      throw new Error(`keyboard dismissal: a tap standing ${standing.kind}`);
  }
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
     *   covering                                  → a dismissal, or refuse (with the band)
     *     The configured
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
     * `enter` submit (K5d). Unguarded, the measured tap went into the
     * AutoFill bar.
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
      const { picked, skipped } = await pickDismissal(second.resolved.tree, second.reading, dismissals, opts.ambiguous, screen);
      if (picked === undefined) {
        // Names MCP tools and "a flow" — the deliberate exception recorded at
        // the window model's "back did not close it" error. The platform's
        // facts (why no key hides it, what was measured to, and where a
        // dismissal is configured) are the adapter's sentence, quoted; this
        // layer says only that it has none to tap, and why each configured
        // one was passed over.
        const cannot = cannotHide(adapter.keyboardAdvice);
        throw new KeyboardWithoutDismissal(
          `The soft keyboard covers ${what}: the band it draws over ${frameText(second.verdict.frame)} contains the tap point ` +
            `(${point.x},${point.y}) on two looks ${KEYBOARD_HIDE_DELAY_MS}ms apart; ${cannot}, and ${nothingPicked(dismissals, skipped)}. Nothing was tapped: ` +
            `the tap would have pressed the keyboard and been reported done. From the MCP tools: hide the keyboard first, ` +
            `then tap ${what} again. In a flow: hide it with a step before this one (a tap: on an element the keyboard ` +
            `does not cover), configure a dismissal for the guard to tap, or lay the screen out so ${what} is not under the keyboard`,
          `${covered}; no dismissal, nothing sent`,
          true,
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
          sent: `${picked.what} was tapped at (${dismissalAt.x},${dismissalAt.y}) to hide the soft keyboard`,
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
            after.kind === 'clear'
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
     * The dismissal after a fill: ONE tree read and no key. Never a blind
     * `enter`: that key was measured to SUBMIT the finportal login from the
     * password field (K5d, the bug note), so a `fill { dismissKeyboard: true }`
     * on iOS would be a submit nobody asked for. Both directions: with a
     * band in the tree the guard's configured dismissals are tried
     * (`pickDismissal`, which the guard asks too — the first usable one
     * is tapped once, then up to KEYBOARD_HIDE_CONFIRM_LOOKS re-reads,
     * KEYBOARD_HIDE_DELAY_MS before each, confirm the band is gone
     * (`confirmHidden`, shared with the guard), and a band still up on the
     * last is AfterDismissalTap, since the tap had an effect this layer
     * cannot judge); with NO band — none on screen, the keyboard parked by
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
     * that WAS tapped and did not hide the keyboard throws
     * (AfterDismissalTap): that is not "nothing done", the screen was touched.
     * So does a confirming read that throws (`afterTapFailed`,
     * the guard's wrap): the tap was sent whatever the read says next.
     */
    async dismiss({ dismissals = [], ambiguous }: DismissOptions): Promise<DismissResult> {
      const tree = await adapter.uiTree();
      const keyboard = readKeyboard(adapter, tree);
      if ((await keyboard.anywhere()) !== 'shown') return {};
      const { picked, skipped } = await pickDismissal(tree, keyboard, dismissals, ambiguous, await usableScreen(adapter, { tree }));
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
          const after = await readKeyboard(adapter, reread).cover();
          return after === undefined ? { gone: { hiddenBy: `tapping ${picked.what}` } } : { stillUp: after.band };
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
