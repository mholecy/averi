import {
  everyNode,
  INPUT_ROLE,
  rectArea,
  rectIntersection,
  type DeviceAdapter,
  type Rect,
  type UiNode,
} from '../adapters/types.js';
import { readTreeOrMiss, screenIdentity } from '../ui-tree/read-tree.js';
import { soleIdOf } from '../ui-tree/selectors.js';
import { errorMessage } from '../util/error-message.js';
import { sleep } from '../util/sleep.js';
import { resolveClearOfKeyboard } from './keyboard.js';
import type { TapOptions } from './tap.js';
import { describeTarget, type Target } from './resolve.js';
import { assertTypeable } from './type-text.js';
import { fillFailureText, focusTapNote } from './fill-text.js';
import { heldText, shownText, type FillFailure, type FillResult, type NearbyInput, type ReadBack } from './fill-facts.js';
import { fieldRefetch } from './fill-refetch.js';
import { clearStep, startClear, type ClearFacts } from './fill-clear.js';
import { heldCountOf, postFocusReadOf } from './fill-landing.js';
import { retypesTail, typeAndConfirm } from './fill-type.js';

/** Measured 2026-08-05: the keyboard needs about this long to come up after the focus tap. */
export const DEFAULT_FOCUS_DELAY_MS = 350;

/**
 * Cadence of the value poll (five rounds) when the caller has none. 400 ms is
 * what the MCP type_text tool has always used; it is NOT the settle poll's
 * cadence — the two were separate before 2026-10-03 and a review the
 * same day caught them quietly merged. The engine passes its own 500 as
 * `valuePollMs` (since 2026-11-02, ADR 0040: its `pollMs` reaches the settle
 * only when pinned, and the settle's cadence is otherwise the adapter's).
 */
export const DEFAULT_VALUE_POLL_MS = 400;

/**
 * A tap's options (the focus tap goes through resolveClearOfKeyboard, dismissals and eyes included) plus the fill's
 * own: the focus tap asks the order question as a tap does.
 */
export interface FillOptions extends TapOptions {
  /** Delete the field's current content before typing — typing otherwise APPENDS. */
  clear?: boolean;
  /**
   * Cadence of the value poll and of a clear's re-read. Default: `pollMs` when given (a test pinning both), else
   * DEFAULT_VALUE_POLL_MS. Separate from the settle's cadence (ADR 0040): the flow engine passes its own here.
   */
  valuePollMs?: number;
}

/**
 * The input a non-input match most likely labels: the one overlapping it
 * most, else the one nearest it (gap between the rects). Zero-area nodes are
 * never candidates, as in resolveNow.
 */
function nearestInput(tree: UiNode, near: UiNode): NearbyInput | 'none' {
  let best: { node: UiNode; overlap: number; gap: number } | undefined;
  for (const n of everyNode(tree)) {
    if (n.role !== INPUT_ROLE || rectArea(n.rect) === 0) continue;
    const met = rectIntersection(n.rect, near.rect);
    const overlap = met === undefined ? 0 : rectArea(met);
    const gap = rectGap(n.rect, near.rect);
    if (best === undefined || overlap > best.overlap || (overlap === best.overlap && gap < best.gap)) best = { node: n, overlap, gap };
  }
  return best === undefined ? 'none' : { identifier: best.node.identifier, rect: { ...best.node.rect }, overlaps: best.overlap > 0 };
}

function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
  return Math.hypot(dx, dy);
}

/**
 * Focus a field (center tap, after resolveClearOfKeyboard — the settled
 * resolution plus, since 2026-10-03, the rule that a field lying under the
 * keyboard the PREVIOUS field raised is not tapped through it) and type into it. With
 * clear, the current value is deleted first via clearText — typing otherwise
 * APPENDS, the measured Android login trap. A right-edge tap is NOT how clear
 * works: measured 2026-08-05, taps in the field's trailing padding do not
 * focus iOS fields.
 *
 * Every phase is VERIFIED against a fresh tree and retried once — synthetic
 * input is droppable end to end (Compose async state, IME queues), so "the
 * call returned" is not "the text landed":
 * - clear: the field must actually be empty; a second pass uses the length
 *   the field still reports. A reading equal to the field's named
 *   placeholder is empty, and a delete round that leaves the reading
 *   UNCHANGED stops the clear (an empty field showing its hint, or one
 *   ignoring deletes — 2026-10-09): the read-back decides when a value
 *   follows, and a clear alone is reported not verified. Every rule of the
 *   clear is interact/fill-clear.ts's (`clearStep`, pure); here it is only
 *   driven.
 * - type with clear: the field must show exactly the value; the retry may
 *   safely wipe and retype (the content is ours).
 * - type without clear: the typed value must appear IN the field (contiguous
 *   insert at the cursor); no destructive retry — clear stays opt-in, so a
 *   mismatch throws instead of corrupting content the field came with.
 * - either way, a field that kept a strict prefix of what it should hold
 *   (React Native's single-line TextInput dropping the end of idb's burst,
 *   2026-10-19) gets the dropped tail typed again, bounded — on an adapter
 *   whose typing has arrived when its call returns, and only while no other
 *   input changed (the focus did not move) — and the result
 *   says so (`retyped`). Typing, the read-back and every retry are
 *   interact/fill-type.ts's (`typeAndConfirm`); this function drives it.
 * A non-input node that never exposes text is NOT verified, and the result
 * says so (`readBack: 'no-value'`) — until 2026-10-08 it passed as landed,
 * and a floating-label `text` node on iOS idb was reported filled with
 * nothing typed. An INPUT with no value is an empty field (UiNode.value):
 * a fill whose text it dropped entirely is a mismatch, `shows 0`
 * (2026-10-09). Fields that expose BULLETS verify by length (fill-landing.ts#landingOf). A
 * matched node that is not an input (INPUT_ROLE) is warned about, with the
 * nearest input named — not refused (see `notInput` below).
 * An EMPTY value is the focus tap and the optional clear alone: nothing is
 * read back, no append warning is raised, and the adapter is still handed
 * the "" — a no-op by its contract (DeviceAdapter.typeText), so the step
 * reads "clear this field" with clear and "focus without typing" without.
 * Errors carry LENGTHS only, never content — values may be credentials.
 * A value holding a control character is refused before anything is sent
 * (interact/type-text.ts — the one statement of what text averi types).
 *
 * The re-read between phases is resolveNow on a fresh tree — the one-shot
 * mode of the same policy that chose the field, so a poller never waits for
 * a rect to settle. A tree that cannot be read mid-fill THROWS: the app has
 * a window by then (the focus tap landed), so an unreadable tree is a dead
 * device, not a screen settling. Before 2026-10-03 the engine's refetch
 * threw and the MCP tool's swallowed it; the stricter one is the honest one,
 * and the error names the fill and how to recover rather than quoting a bare
 * adapter message.
 *
 * Keyboard dismissal is deliberately NOT in here: `dismissKeyboard`
 * (keyboard.ts) is a second call, so a warning this fill produced reaches the
 * caller before the key press can throw (review 2026-10-03: a masked-append
 * warning was lost when `pressKey` failed after the text had landed).
 *
 * Moved from flow/engine.ts (2026-10-03), where it took a pre-resolved node
 * and a caller-built refetch closure that re-stated the resolution filter.
 */
export async function fillField(
  adapter: DeviceAdapter,
  target: Target,
  value: string,
  opts: FillOptions,
): Promise<FillResult> {
  // Before the field is resolved: a refused value — a control character, or
  // one the adapter cannot type (ADR 0037) — must cost no keyboard dismissal,
  // no focus tap and no clear (type-text.ts). A dropped tail typed again
  // (fill-type.ts, ADR 0023) is a suffix of this value: checked here too.
  // Marked 'refused' (FillValueFailure) — the message is type-text.ts's.
  try {
    assertTypeable(value, adapter.typeable);
  } catch (e) {
    throw new FillValueFailure(errorMessage(e), 'refused', { cause: e });
  }
  const { clear } = opts;
  const pollMs = opts.valuePollMs ?? opts.pollMs ?? DEFAULT_VALUE_POLL_MS;
  const { node, note: resolutionNote, keyboardHidden, point, moved, tree: resolvedIn } = await resolveClearOfKeyboard(adapter, target, opts);
  // A focus tap moved off a covered centre (tap-judgement.ts#TapJudge.aim) is said in the note, after what the
  // resolution said.
  const note = focusTapNote(resolutionNote, moved);
  const isInput = node.role === INPUT_ROLE;
  // The one read after the focus tap, and what it is for, is fill-landing.ts#postFocusReadOf's table. It is SKIPPED
  // where nothing it feeds can change the verdict
  // (docs/adr/0028-a-fill-re-reads-after-focus-only-where-focus-can-change-the-count.md): a value typed without
  // `clear` into a field whose held count the masked rule does not need (fill-landing.ts#needsHeldCount), named by a
  // sole `id` selector, on an adapter that never types a dropped tail again (fill-type.ts#retypesTail). What the
  // re-read feeds, and why none of it matters there:
  // - the count the masked length rule starts from: the typing is told it is `'unread'` (fill-landing.ts#Expectation),
  //   and a field that shows bullets after all fails `masked-said-plain` there.
  // - the newest tree read, whose screen becomes the guard of the twin fallback (fill-refetch.ts#sameField) when typing
  //   starts (fill-refetch.ts#TwinGuard). The fallback is asked only when the selector stops matching; an `id` keeps
  //   matching through typing, while a label, hint or value selector may stop (the field's text changed), and without
  //   a pre-typing read the fallback is off (`typing-unread`). Hence the sole-id gate. NOT seeded from the pre-tap
  //   tree: a field's own clear button appearing on focus changed that screen's identity
  //   (docs/bugs/2026-10-09-ios-fill-screen-changed-from-fields-own-clear-button.md). That tree only words a `lost`
  //   (fill-refetch.ts#findAgain).
  // - the other inputs `whereTyped` compares (fill-type.ts), keyed by rect: read off the resolution's tree instead,
  //   so a layout that moves on focus (keyboard avoidance) reads `unproven` there. That proof gates only the dropped
  //   tail's retype — hence the delivery gate: iOS keeps the re-read, Android (never retyping a tail) skips it.
  // - what the field showed before typing (`shownBeforeTyping`): empty before the tap, and taken as empty. The cost:
  //   a plain field that inserts text on focus (a `+421 ` prefix) and takes none of the typing PASSES when the inserted
  //   text holds the value (`421` typed), and otherwise is worded as a length mismatch (or same-length), not as "did not
  //   change". The pass says so where the reading is not exactly the value (`focusUnread`: fill-landing.ts#Landing, from
  //   the `'unread'` below; ADR 0028's D64b-3 amendment and residual 3).
  const delivery = adapter.typingDelivery ?? 'may-arrive-late';
  const focus = postFocusReadOf({ value, clear: clear === true, field: node, soleId: soleIdOf(target) !== undefined, retypesTail: retypesTail(delivery) });
  // Every read of the field from here on, and why it was lost when it was (fill-refetch.ts). Skipped: the screen the
  // field was resolved on words a `lost` alone.
  const field = fieldRefetch({
    adapter,
    target,
    resolve: opts,
    chosen: node,
    ...(focus.count === 'unread' && { resolvedOn: screenIdentity(resolvedIn) }),
    unreadable: (e) => failure({ code: 'reread-failed', target: describeTarget(target), cause: e.message }),
  });
  const startTyping = async (text: string): Promise<void> => {
    field.typingStarts();
    await adapter.typeText(text);
  };
  await adapter.tap(point.x, point.y);
  await sleep(DEFAULT_FOCUS_DELAY_MS); // focus + keyboard — a constant, not an option: tests mock util/sleep

  // What the field HOLDS, as opposed to what it SHOWS, is heldText's
  // (fill-facts.ts: a reading equal to the named placeholder is an empty
  // field). The node's own placeholder is the field's: every read finds the
  // same field.
  const placeholder = node.placeholder;

  // The read after focus, when the table says so (fill-landing.ts#postFocusReadOf: for the masked count — the pre-tap
  // read is stale for exactly the fields the length rule cares about, Android autofill POPULATING a password field on
  // focus and a re-entry screen CLEARING one, review 2026-09-18; or for what a clear ALONE deletes, 2026-10-07). A
  // field lost on that read keeps its pre-tap node.
  let current: UiNode | undefined = node;
  if (focus.reads) current = (await field.read()).node ?? node;
  // What the field HOLDS by now, not what it SHOWS (fill-facts.ts#heldText: a reading equal to the named placeholder is
  // empty) — what the masked count is taken of (fill-landing.ts#heldCountOf), before any clear.
  const heldAfterFocus = heldText(current.value, placeholder);
  let maskedAppend: FillResult['maskedAppend'];
  let cleared: FillResult['cleared'];
  let clearUnchanged: FillResult['clearUnchanged'];
  // How the clear ended (fill-clear.ts#ClearFacts) — undefined without one.
  let clearEnd: ClearFacts['end'] | undefined;
  if (clear && !isInput) {
    // Not an input: what it shows is not the field's length — a label's own
    // text (deletes counted off it went into whatever had focus) or nothing
    // at all (which read as an empty field). No delete is sent; the result
    // says so (review 2026-10-08). An input-like node of another role (an
    // iOS search field reads `other`) still ends as the value: the read-back
    // sees its value move, and the mismatch retry below wipes and retypes.
    cleared = 'unmeasured';
  } else if (clear) {
    // Every rule of the clear is fill-clear.ts's (clearStep): this loop only
    // performs the step it is given — the deletes, or the poll cadence's
    // wait — and hands back what the next read saw, in that order.
    let next = clearStep(startClear(placeholder), { value: current?.value ?? null });
    while (next.step.do === 'delete' || next.step.do === 'reread') {
      if (next.step.do === 'delete') await adapter.clearText(next.step.count);
      else await sleep(pollMs);
      const read = await field.read();
      current = read.node;
      next = clearStep(next.state, read.node === undefined ? { lost: read.lost } : { value: read.node.value });
    }
    if (next.step.do === 'fail') throw failure(next.step.failure);
    const { facts } = next.step;
    cleared = facts.cleared;
    clearEnd = facts.end;
    if (clearEnd.kind === 'unchanged') clearUnchanged = { shows: clearEnd.shows, deletes: clearEnd.deletes };
  }

  // What the field showed when typing began — the read-back's mismatch error
  // says "did not change" when it still shows exactly this.
  // An input's null is "" here too (fill-facts.ts#shownText), so a field that
  // stays empty reads "did not change". None: the clear's last read lost it.
  const shownBeforeTyping = (current === undefined ? undefined : shownText(current, isInput)) ?? null;
  // Nothing typed: the clear's lost field is the read-back's (nothing saw it
  // empty); a clear that ended on its placeholder is reported as a fact
  // (`clearPlaceholder`) and judged by judgeFill.
  let readBack: ReadBack = value === '' && clearEnd?.kind === 'lost' ? { kind: 'lost', why: clearEnd.why } : { kind: 'nothing-typed' };
  let retyped: number[] = [];
  let reformatted: FillResult['reformatted'];
  let focusUnread: FillResult['focusUnread'];
  // Not an input, and nothing shows the text landed in it: name the input
  // the caller probably meant. Warned, NOT refused (2026-10-08): on iOS idb a
  // floating label is a separate `text` node over its field, and a tap on it
  // focuses the field when the two still overlap (measured: that fill did
  // land) — a refusal would break flows that work, and the label is the only
  // selector idb leaves for inputs that share an identifier. A read-back
  // that SHOWS the text proves the node took it, whatever its role.
  const notInput = async (): Promise<FillResult['notInput']> => {
    if (isInput) return undefined;
    let tree = field.lastTree();
    if (tree === undefined) {
      // Through the seam (D39, ADR 0036): a miss stays a hint, a read no wait cures stops the fill as it came.
      const read = await readTreeOrMiss(adapter);
      if (read.tree === undefined) return { input: 'unread' };
      tree = read.tree;
    }
    return { input: nearestInput(tree, node) };
  };
  if (focus.count === undefined) {
    // Nothing typed (the table gives no count): the focus tap and the clear alone.
    await startTyping(value);
  } else {
    // What the masked read-back adds the typed length to, and the masked-append warning.
    const counted = heldCountOf(focus.count, heldAfterFocus);
    maskedAppend = counted.maskedAppend;
    // Typing, the read-back and what is sent again are interact/fill-type.ts's
    // (typeAndConfirm): a masked field compared by length, a non-input proven
    // only by changing to show the text, a dropped tail typed again, the
    // clear's one wipe and retype. Here the outcome becomes the read-back fact
    // or the mismatch error.
    const typed = await typeAndConfirm(
      {
        type: startTyping,
        wipe: (count) => adapter.clearText(count),
        read: field.read,
        screen: () => field.lastTree() ?? resolvedIn,
        // What the field showed is the adapter's to act on (iOS: the first key alone into this app from now on, D24);
        // an adapter without the method learns nothing.
        reportDroppedTail: () => adapter.noteDroppedTail?.(),
      },
      {
        value,
        clear: clear === true,
        isInput,
        resolvedValue: node.value,
        before: shownBeforeTyping,
        placeholder,
        held: counted.held,
        pollMs,
        field: current ?? node,
        delivery,
      },
    );
    if (typed.kind === 'missed') {
      const wrong = await notInput();
      throw failure({
        code: 'mismatch',
        typed: value.length,
        shows: typed.observed.length,
        differs: typed.differs,
        notInput: wrong === undefined ? undefined : { role: node.role, input: wrong.input },
        ...(typed.again.length > 0 && { again: typed.again }),
        ...(typed.elsewhere !== undefined && { elsewhere: typed.elsewhere }),
      });
    }
    if (typed.kind === 'landed') {
      retyped = typed.again.flatMap((a) => (a.kind === 'tail' ? [a.length] : []));
      reformatted = typed.reformatted;
      focusUnread = typed.focusUnread;
    }
    readBack =
      typed.kind === 'not-taken'
        ? { kind: 'not-taken' }
        : typed.kind === 'landed'
          ? typed.placeholder === true // fill-landing.ts#Landing: not verified
            ? { kind: 'placeholder' }
            : { kind: 'landed' }
          : // No reading: when the last read did not find the field at all,
            // that is said as such (iOS device check 2026-10-08) — the node
            // was not seen, so it is not blamed for showing nothing.
            typed.lost !== undefined
            ? { kind: 'lost', why: typed.lost }
            : { kind: 'no-value' };
  }
  return {
    note,
    keyboardHidden,
    moved,
    maskedAppend,
    role: node.role,
    typed: value.length,
    cleared,
    clearUnchanged,
    clearPlaceholder: clearEnd?.kind === 'empty' ? clearEnd.placeholder : undefined,
    readBack,
    ...(retyped.length > 0 && { retyped }),
    ...(reformatted !== undefined && { reformatted }),
    ...(focusUnread !== undefined && { focusUnread }),
    notInput: readBack.kind === 'landed' ? undefined : await notInput(),
  };
}

/**
 * A fill that failed on its VALUE — the marker the flow engine's `optional:`
 * reads (flow/engine.ts, OptionalNotSkipped; 2026-10-09, owner's decision):
 * - `did-not-land`: the three FillFailures (a read-back mismatch, a clear
 *   that left text twice, a re-read that failed mid-fill). The field was
 *   tapped and may hold partial text, so the step after it would run on a
 *   half-typed form.
 * - `refused`: a value holding a control character, or a character the
 *   adapter cannot type (type-text.ts, ADR 0037), refused before anything is
 *   sent. A broken value, not an absent field.
 * Neither is skipped by `optional:` — it fails the flow, as a tap refused on
 * a present element does (resolve.ts#RefusedOnPresentElement). The `type:`
 * step's own refusal (typeIntoFocused) is not marked.
 * Errors from the resolution and the keyboard guard before the focus tap
 * (absent field, refusals on a present one) keep their own classes. NOT
 * marked either, so an `optional:` still skips them — the owner approved
 * exactly the three `did-not-land` failures and the `refused` one: an error
 * thrown by the focus tap's `adapter.tap`, or by `adapter.typeText` or
 * `adapter.clearText` (a device error while typing — the known gap: the
 * field may hold partial text), and an AmbiguityRefusal from a re-read's
 * resolveNow mid-fill (fill-refetch.ts: a second match appearing).
 */
export class FillValueFailure extends Error {
  readonly fillValue: 'did-not-land' | 'refused';

  constructor(message: string, fillValue: 'did-not-land' | 'refused', options?: ErrorOptions) {
    super(message, options);
    this.name = 'FillValueFailure';
    this.fillValue = fillValue;
  }
}

/** A fill's error: its words are fill-text.ts's, like every fill sentence. */
function failure(f: FillFailure): Error {
  return new FillValueFailure(fillFailureText(f), 'did-not-land');
}
