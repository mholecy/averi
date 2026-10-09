import { everyNode, rectArea, sameRect, type DeviceAdapter, type Rect, type UiNode } from '../adapters/types.js';
import { isMaskedValue } from '../ui-tree/masked-value.js';
import { tapPoint } from '../ui-tree/selectors.js';
import { errorMessage } from '../util/error-message.js';
import { sleep } from '../util/sleep.js';
import { resolveClearOfKeyboard, type GuardOptions } from './keyboard.js';
import { describeTarget, resolveNow, type Target } from './resolve.js';
import { assertTypeable } from './type-text.js';
import { fillFailureText } from './fill-text.js';
import type { Difference, FillFailure, FillResult, LostWhy, NearbyInput, ReadBack } from './fill-facts.js';
import { INPUT_ROLE } from './input-role.js';

/** Measured 2026-08-05: the keyboard needs about this long to come up after the focus tap. */
export const DEFAULT_FOCUS_DELAY_MS = 350;

/**
 * Cadence of the value poll (five rounds) when the caller has none. 400 ms is
 * what the MCP type_text tool has always used; it is NOT the settle poll's
 * DEFAULT_POLL_MS — the two were separate before 2026-10-03 and a review the
 * same day caught them quietly merged. The engine passes its own pollMs for
 * both, as it always did.
 */
export const DEFAULT_VALUE_POLL_MS = 400;

/** The guard's options (the focus tap goes through resolveClearOfKeyboard, dismissals included) plus the fill's own. */
export interface FillOptions extends GuardOptions {
  /** Delete the field's current content before typing — typing otherwise APPENDS. */
  clear?: boolean;
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
    const overlap = overlapArea(n.rect, near.rect);
    const gap = rectGap(n.rect, near.rect);
    if (best === undefined || overlap > best.overlap || (overlap === best.overlap && gap < best.gap)) best = { node: n, overlap, gap };
  }
  return best === undefined ? 'none' : { identifier: best.node.identifier, rect: { ...best.node.rect }, overlaps: best.overlap > 0 };
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return Math.max(0, w) * Math.max(0, h);
}

function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
  return Math.hypot(dx, dy);
}

/**
 * The node chosen at focus, found again in a fresh tree by identity — same
 * role, identifier and rect, exactly one such node. The read-back's
 * fallback when the selector no longer matches: a `value:"…"` selector
 * stops matching the moment the clear or the typing changes the value, and
 * until 2026-10-08 that read as "nothing there" (a clear counted as done,
 * a read-back as unverifiable). A field that MOVED (the keyboard pushed the
 * form up) is not found this way and stays unverifiable, as before.
 *
 * Identity is not screen identity: RN forms share one id across fields
 * (`TextFieldWithComponentStyle`), so a NEXT screen with a field at the same
 * rect is a twin too (review 2026-10-08: typing that navigated read the next
 * screen's field). After typing, fillField therefore asks it only while
 * `screenSignature` still equals the last pre-typing read's — and not at all
 * when nothing was read before typing. The limit: a next screen with the
 * very same set of identified nodes still passes.
 */
function sameField(tree: UiNode, chosen: UiNode): UiNode | undefined {
  const twins = [...everyNode(tree)].filter(
    (n) => n.role === chosen.role && n.identifier === chosen.identifier && sameRect(n.rect, chosen.rect),
  );
  return twins.length === 1 ? twins[0] : undefined;
}

/**
 * A cheap "same screen" witness for sameField: the set of `role:identifier`
 * pairs of every identified node. Values and rects are left out — typing
 * changes the one and the keyboard the other. A node appearing with an id
 * of its own (an inline error label) changes it: the fallback then refuses,
 * and the read-back is NOT verified rather than wrong.
 */
function screenSignature(tree: UiNode): string {
  const ids = new Set<string>();
  for (const n of everyNode(tree)) if (n.identifier !== null) ids.add(`${n.role}:${n.identifier}`);
  return [...ids].sort().join('\n');
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
 *   ignoring deletes — 2026-10-09, see the loop): the read-back decides
 *   when a value follows, and a clear alone is reported not verified.
 * - type with clear: the field must show exactly the value; the retry may
 *   safely wipe and retype (the content is ours).
 * - type without clear: the typed value must appear IN the field (contiguous
 *   insert at the cursor); no destructive retry — clear stays opt-in, so a
 *   mismatch throws instead of corrupting content the field came with.
 * A node that never exposes text is NOT verified, and the result says so
 * (`readBack: 'no-value'`) — until 2026-10-08 it passed as landed, and a
 * floating-label `text` node on iOS idb was reported filled with nothing
 * typed. Fields that expose BULLETS verify by length (see `landed`). A
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
  // Before the field is resolved: a refused value must cost no keyboard
  // dismissal, no focus tap and no clear (type-text.ts).
  assertTypeable(value);
  const { clear } = opts;
  const pollMs = opts.pollMs ?? DEFAULT_VALUE_POLL_MS;
  const { node, note, keyboardHidden } = await resolveClearOfKeyboard(adapter, target, opts);
  let lastTree: UiNode | undefined; // the newest tree refetch read — the not-input finding looks for the input in it
  // sameField's guard (see there): before typing, the identity fallback is
  // asked freely (a clear's deletes do not navigate); after it, only on the
  // screen the last pre-typing read saw. `null`: typing started with no read.
  let screenBeforeTyping: string | null | undefined;
  // Why the newest refetch found nothing (undefined: it found the field) —
  // the read-back's `lost` when the poll ends on such a read (2026-10-08).
  let lostOnLastRead: LostWhy | undefined;
  const isInput = node.role === INPUT_ROLE;
  const refetch = async (): Promise<UiNode | undefined> => {
    // Only the READ is wrapped: a refusal from resolveNow (a second match
    // appearing mid-fill — a suggestion row, a duplicated field) is a
    // selector finding with its own wording, not a device that went away.
    let tree: UiNode;
    try {
      tree = await adapter.uiTree();
    } catch (e) {
      throw failure({ code: 'reread-failed', target: describeTarget(target), cause: errorMessage(e) });
    }
    lastTree = tree;
    lostOnLastRead = undefined;
    const bySelector = resolveNow(tree, target, opts)?.node;
    if (bySelector !== undefined) return bySelector;
    const screenChanged = typeof screenBeforeTyping === 'string' && screenSignature(tree) !== screenBeforeTyping;
    const twin = screenBeforeTyping === undefined || (screenBeforeTyping !== null && !screenChanged) ? sameField(tree, node) : undefined;
    if (twin === undefined) lostOnLastRead = screenChanged ? 'screen-changed' : 'unmatched';
    return twin;
  };
  const startTyping = async (text: string): Promise<void> => {
    screenBeforeTyping ??= lastTree === undefined ? null : screenSignature(lastTree);
    await adapter.typeText(text);
  };
  const point = tapPoint(node);
  await adapter.tap(point.x, point.y);
  await sleep(DEFAULT_FOCUS_DELAY_MS); // focus + keyboard — a constant, not an option: tests mock util/sleep

  // What the field HOLDS, as opposed to what it SHOWS: a reading exactly
  // equal to the placeholder the tree source names (UiNode.placeholder — WDA's
  // placeholderValue, a dump's hint) is an empty field. Every source reports
  // an empty field's placeholder as its value (measured 2026-10-09, both
  // platforms: docs/bugs/2026-10-09-android-clear-reads-edittext-hint-as-
  // content.md), and the clear below counted it as content to delete. The
  // node's own placeholder is the field's: refetch finds the same field.
  // Exact equality, and a known cost: a field that really holds the text of
  // its own placeholder reads as empty here — the tree cannot tell the two
  // apart. Where the source names no placeholder (idb, the API 33 dump), the
  // clear's unchanged-reading rule below is what catches a hint.
  const placeholder = node.placeholder;
  const held = (shown: string | null | undefined): string => (shown === undefined || shown === null || shown === placeholder ? '' : shown);
  // A delete round left the reading exactly as it was, and it is text a hint
  // could be. BULLETS never are: an unchanged masked reading is a field the
  // deletes did not reach (a focus tap that missed), and stopping there let
  // the typing go nowhere too and a masked read-back — compared by length —
  // pass with the old password still in place (review of this branch,
  // probe A: the finportal `invalid_grant` class). Such a field fails as
  // clear-twice, as it always did.
  const isHint = (before: string | null | undefined, after: string | null): boolean =>
    held(after) !== '' && after === before && !isMaskedValue(after ?? '');

  let current: UiNode | undefined = node;
  let preText = held(node.value); // what the field holds when typing starts (see `landed`)
  let maskedAppend: FillResult['maskedAppend'];
  if (value !== '' && !clear && (preText === '' || isMaskedValue(preText))) {
    // The pre-tap read is stale for exactly the fields the length rule cares
    // about: Android autofill POPULATES a password field on focus, and a
    // re-entry screen CLEARS one on focus (review 2026-09-18 measured both as
    // false failures against a pre-tap `preLen`). Re-read after focus. Plain
    // fields with content skip this — `includes` never uses preLen. So does
    // an empty value (2026-10-07): it is a focus without typing, which has no
    // read-back to feed and nothing that could append, so the masked-append
    // finding below would name a typing that never happened.
    const focused = await refetch();
    if (focused !== undefined) {
      current = focused;
      preText = held(focused.value);
    }
    if (isMaskedValue(preText)) {
      // The length rule cannot see content: a password typed onto an
      // autofilled one reads as a perfect append (finportal 2026-09-17:
      // backend `invalid_grant`). Say so where the trace is read.
      maskedAppend = { held: preText.length };
    }
  }
  // What a MASKED read-back must add the typed length to (see `landed`): the
  // bullets the field held before typing — and only bullets. A masked
  // field's content reads as bullets on both platforms (2026-09-17), so a
  // plain reading before typing was not its content: an Android password
  // EditText that dumps its hint as `text` while empty (the API 33 rule
  // measured 2026-10-09 on plain EditTexts; on a password field it is
  // inferred, not yet seen on a device). Counted as held, that hint made
  // `typed 6 but the field shows 6 (masked field — compared by length; it
  // held 8 after focus)` of a fill that landed. The cost: a field showing
  // its password in plain text before typing (a "show password" toggle)
  // and masked after is checked against the typed length alone. Not fixed
  // by this: a hinted password field that the source names no placeholder
  // for reads non-empty before the tap, so the post-focus re-read above is
  // skipped and an autofill on focus goes unseen (no masked-append warning).
  const maskedHeld = isMaskedValue(preText) ? preText.length : 0;
  let cleared: FillResult['cleared'];
  let clearUnchanged: FillResult['clearUnchanged'];
  // The clear ended on the placeholder, which may be held text (see the loop).
  let placeholderLeft = false;
  // Why the clear's read after a delete found no field (review 2026-10-08,
  // m-1): the loop then stops without calling the field empty, and a clear
  // alone (nothing typed, so no read-back) reports it as `lost`.
  let clearLost: LostWhy | undefined;
  if (clear && !isInput) {
    // Not an input: what it shows is not the field's length — a label's own
    // text (deletes counted off it went into whatever had focus) or nothing
    // at all (which read as an empty field). No delete is sent; the result
    // says so (review 2026-10-08). An input-like node of another role (an
    // iOS search field reads `other`) still ends as the value: the read-back
    // sees its value move, and the mismatch retry below wipes and retypes.
    cleared = 'unmeasured';
  } else if (clear) {
    if (value === '') {
      // A clear ALONE has no read-back behind it, so what the loop counts
      // must be what the field holds AFTER focus, not before the tap: a
      // field that autofills on focus (Android, measured 2026-09-18) would
      // otherwise read as empty from the pre-tap tree, be skipped, and keep
      // the autofilled text — the one fill shape whose whole point is an
      // empty field. A clear WITH a value needs no such read: its read-back
      // compares the field to the value and wipes a mismatch before the
      // retry. Same re-read as the `!clear` branch above (2026-10-07).
      const focused = await refetch();
      if (focused !== undefined) current = focused;
    }
    let deletes = 0; // every delete the loop sent, all rounds — clearUnchanged.deletes
    for (let attempt = 0; ; attempt++) {
      const before = current?.value;
      const existing = held(before).length;
      cleared ??= existing; // the first pass's count: what the field held when the clear began
      if (existing === 0) break;
      await adapter.clearText(existing);
      deletes += existing;
      current = await refetch();
      if (current === undefined) {
        // Not found is not empty: until 2026-10-08 this read as `left = 0`,
        // and a clear alone was "Filled … (cleared 7 characters first)" on a
        // field that the keyboard had moved and that still held `XX`. With a
        // value, the read-back below (exact, with clear) is what decides.
        clearLost = lostOnLastRead;
        break;
      }
      // An unchanged reading may be a LATE one: synthetic input is droppable
      // and slow end to end (Compose async state, an IME queue — 3 of 11
      // characters landed at first, measured 2026-08-05), and one read right
      // after the deletes turned a clear that worked into "the deletes did
      // not change it" (review of this branch, probe I). One more read after
      // the poll cadence before believing it. The cost: one pollMs and one
      // tree read on every clear that ends on an unchanged reading — every
      // clear of a hinted field whose source names no placeholder.
      if (isHint(before, current.value)) {
        await sleep(pollMs);
        current = await refetch();
        if (current === undefined) {
          clearLost = lostOnLastRead;
          break;
        }
      }
      const left = held(current.value).length;
      if (left === 0) {
        // Deleted INTO the placeholder: proof of an empty field only when
        // the reading before the deletes did not START with the placeholder's
        // text. Deletes go from the end, so what they leave is a prefix of
        // what was there; a placeholder that is not a prefix of it can only
        // be the field showing empty. One that is (`Companyabc` with 3 of 10
        // deletes landing leaves `Company`) may be text the deletes did not
        // reach (review round 2, probe K: "Filled … cleared 10 characters
        // first" of a field still holding `Company`). Then a clear alone is
        // the `placeholder` read-back, not verified; with a value, the exact
        // read-back decides (typing onto held text shows more than the value).
        placeholderLeft = placeholder !== undefined && current.value === placeholder && (before ?? '').startsWith(placeholder);
        break;
      }
      if (isHint(before, current.value)) {
        // The deletes changed NOTHING: the field shows what it showed before
        // them. An empty field showing its hint or placeholder reads exactly
        // so — the stock Android EditText (API 33 dumps the hint as `text`)
        // and iOS fields (idb AXValue, WDA value) whose source names no
        // placeholder, measured 2026-10-09 (bug note above): the loop sent
        // up to twice the hint's length in deletes into an EMPTY field and
        // threw `field still shows 9 characters after clearing twice`, so
        // `clear: true` never typed its value and a clear alone failed after
        // it had succeeded. A field that IGNORES deletes (read-only, an IME
        // that drops them) reads exactly the same; the tree cannot tell the
        // two apart, so the loop stops here and leaves the verdict to what
        // follows:
        // - with a value, the typing and its EXACT read-back: on an empty
        //   field it lands; a field that ignores deletes shows its old text
        //   plus the value, the retry's wipe is ignored too, and the fill
        //   fails — after the value was typed (twice) into it, where it used
        //   to fail before typing. That is the price of this rule.
        // - alone, `clearUnchanged`: the clear is reported NOT verified (it
        //   was a failure until now, and a verified "Filled" would claim an
        //   empty field nobody saw), the reason naming both causes.
        // A FIRST round that changed nothing deleted nothing that anyone saw:
        // `cleared` is then 0, so no reply claims "cleared 9 characters
        // first" of an empty hinted field (review of this branch, probe J;
        // the say-what-was-done rule of 2026-10-08). The deletes that went
        // out are still counted, in `clearUnchanged.deletes`.
        // The usual cost on a field that held text: one round deletes it,
        // the hint appears (a CHANGED reading), a second round sends the
        // hint's length in deletes into the empty field and finds it
        // unchanged — measured as 1 + 9 deletes on the Contacts editor.
        // Where the source names the placeholder, `held` stops after the
        // first round.
        if (attempt === 0) cleared = 0;
        clearUnchanged = { shows: left, deletes };
        break;
      }
      // Two rounds that each SHORTENED the field and did not empty it: the
      // deletes are landing short — the clear-twice failure, as always. A
      // reading that is not a prefix of the one before the deletes was not
      // produced by deleting from the end (where clearText deletes from): a
      // field that held `Probe`, kept `Pro` after a short round, and showed
      // its hint after the next (probe E). It gets ONE more round, and the
      // unchanged rule above decides; a third round that still changes the
      // field fails.
      const shortened = (before ?? '').startsWith(current.value ?? '');
      if (attempt >= 2 || (attempt >= 1 && shortened)) {
        throw failure({ code: 'clear-twice', left, rounds: attempt + 1 });
      }
    }
  }

  // What the field showed when typing began — the read-back's mismatch error
  // says "did not change" when it still shows exactly this.
  const shownBeforeTyping = current?.value ?? null;
  await startTyping(value);
  // A clear alone that found the field showing exactly its named
  // placeholder and so deleted nothing, or whose deletes ended on it from a
  // reading that started with it (`placeholderLeft`): empty, or holding
  // that very text — the tree cannot tell (review of this branch, probes C
  // and K). Not verified. A field cleared INTO its placeholder from a
  // reading that did not start with it was seen to empty, and is.
  const showsOnlyPlaceholder =
    value === '' &&
    clear === true &&
    isInput &&
    (cleared === 0 || placeholderLeft) &&
    clearUnchanged === undefined &&
    placeholder !== undefined &&
    current?.value === placeholder;
  let readBack: ReadBack =
    value === '' && clearLost !== undefined
      ? { kind: 'lost', why: clearLost }
      : showsOnlyPlaceholder
        ? { kind: 'placeholder' }
        : { kind: 'nothing-typed' };
  // Not an input, and nothing shows the text landed in it: name the input
  // the caller probably meant. Warned, NOT refused (2026-10-08): on iOS idb a
  // floating label is a separate `text` node over its field, and a tap on it
  // focuses the field when the two still overlap (measured: that fill did
  // land) — a refusal would break flows that work, and the label is the only
  // selector idb leaves for inputs that share an identifier. A read-back
  // that SHOWS the text proves the node took it, whatever its role.
  const notInput = async (): Promise<FillResult['notInput']> => {
    if (isInput) return undefined;
    let tree = lastTree;
    if (tree === undefined) {
      try {
        tree = await adapter.uiTree();
      } catch {
        return { input: 'unread' }; // a hint, not a verdict: the fill does not fail for it
      }
    }
    return { input: nearestInput(tree, node) };
  };
  if (value !== '') {
    // A masked (secure) field shows one bullet per character to uiautomator
    // and WDA alike, so its content can never EQUAL the value — measured
    // 2026-09-17 (finportal login): `typed 16 characters but the field shows
    // 16` on both platforms, for a fill that had landed. Its LENGTH still says
    // whether every keystroke arrived, which is the check that matters on a
    // loaded emulator (dropped characters there surfaced as a backend
    // `invalid_grant`), so a bullets-only read-back is compared by count,
    // never by content. The rule detects the SHORT direction only — dropped
    // keystrokes; without `clear` the field must show at least what it held
    // after focus plus what was typed. It cannot tell a correct append from
    // typing onto an autofilled password (both read `held + typed`); that
    // case is `maskedAppend` above, not a failure.
    // A non-input proves it took the text only by CHANGING to show it: a WDA
    // StaticText exposes its label as its value, and "Meno".includes("e") is
    // no fill; a label that changes on focus (`Name` → `Name*`) is no fill
    // either, and the mismatch retry below would delete ITS length into the
    // focused field (review 2026-10-08, rounds 1 and 2). An input-like node
    // of another role (an iOS search field reads `other`) shows the typed
    // text, so it still gets the retry. Masked values cannot show it: for
    // them the change alone is the proof, as their length is for inputs.
    const tookText = (observed: string) =>
      isInput || (observed !== node.value && (isMaskedValue(observed) || observed.includes(value)));
    const landed = (observed: string) =>
      tookText(observed) &&
      (isMaskedValue(observed)
        ? clear
          ? observed.length === value.length
          : observed.length >= maskedHeld + value.length
        : clear
          ? observed === value
          : // A placeholder is not content: on an empty field showing
            // `Search`, nothing typed must not pass for a typed `ear`.
            // Raw equality first: a value equal to the placeholder is the
            // one reading that cannot be told from it (see `held`).
            observed === value || held(observed).includes(value));
    let observed = await pollValue(refetch, landed, pollMs);
    // undefined: the node withholds its text — nothing to compare. Since
    // 2026-10-08 that is SAID (readBack 'no-value'), never passed as landed;
    // and when the last read did not find the field at all, that is said
    // as such (readBack 'lost', iOS device check the same day) — the node
    // was not seen, so it is not blamed for showing nothing.
    // A non-input that never changed is not the field: said too, never
    // wiped (its length is not the field's) and never a failure — the text
    // may well have reached the field the tap focused.
    if (observed !== undefined && !tookText(observed)) {
      readBack = { kind: 'not-taken' };
    } else if (observed !== undefined && !landed(observed)) {
      if (clear) {
        // What the field holds: a field showing only its placeholder (the
        // typing never landed) gets no deletes.
        const wipe = held(observed).length;
        if (wipe > 0) await adapter.clearText(wipe);
        await adapter.typeText(value);
        observed = await pollValue(refetch, landed, pollMs);
      }
      if (observed !== undefined && !landed(observed)) {
        const wrong = await notInput();
        throw failure({
          code: 'mismatch',
          typed: value.length,
          shows: observed.length,
          differs:
            observed === shownBeforeTyping
              ? { kind: 'unchanged' }
              : isMaskedValue(observed)
                ? { kind: 'masked', held: clear ? undefined : maskedHeld }
                : // Partly masked (Android's show-the-last-character password
                  // field, `•••••t`): its content is not comparable either;
                  // the lengths are all that may be said. • and ● only — `*`
                  // and `·` are ordinary text too.
                  /[\u2022\u25CF]/.test(observed)
                  ? { kind: 'length' }
                  : differenceOf(held(observed), value, clear === true, clear ? '' : held(shownBeforeTyping)),
          notInput: wrong === undefined ? undefined : { role: node.role, input: wrong.input },
        });
      }
    }
    if (readBack.kind !== 'not-taken') {
      readBack =
        observed !== undefined
          ? // The value IS the named placeholder's text, and the field shows
            // it: typed, or empty with the typing dropped — the tree cannot
            // tell (review of this branch, probe B). Not verified.
            placeholder !== undefined && observed === placeholder
            ? { kind: 'placeholder' }
            : { kind: 'landed' }
          : lostOnLastRead !== undefined
            ? { kind: 'lost', why: lostOnLastRead }
            : { kind: 'no-value' };
    }
  }
  return {
    note,
    keyboardHidden,
    maskedAppend,
    role: node.role,
    typed: value.length,
    cleared,
    clearUnchanged,
    readBack,
    notInput: readBack.kind === 'landed' ? undefined : await notInput(),
  };
}

/** A fill's error: its words are fill-text.ts's, like every fill sentence. */
function failure(f: FillFailure): Error {
  return new Error(fillFailureText(f));
}

/**
 * What can be said of a non-masked read-back that missed the value, without
 * carrying either string (fill-facts.ts#Difference): with `clear` the field
 * must EQUAL the value, so the two are compared whole; without, it must
 * CONTAIN it, so every run of the new text (`prior`: what the field held
 * before typing) as long as the value is compared and the closest one
 * counts. `shown` is what the field HOLDS (a named placeholder is no text). Only position-for-position: an inserted or
 * dropped character is a length difference (`length`), as before.
 * Letter case by toLowerCase/toUpperCase of each UTF-16 unit — enough for
 * the measured auto-capitalisation; a case pair whose forms differ in length
 * (`ß`/`SS`) reads as a plain difference, never as a pass.
 */
function differenceOf(shown: string, value: string, clear: boolean, prior: string): Difference {
  // Without clear the field may hold text from before the typing; only what
  // came AFTER it is compared, when the field still starts with it (typing
  // appends at the cursor, which the focus tap leaves at the end). A field
  // whose earlier text changed too is compared whole — the limit: a run of
  // the old text can then be named as the "transformed" typing.
  const observed = prior !== '' && shown.startsWith(prior) ? shown.slice(prior.length) : shown;
  let caseOnly: number | undefined; // fewest case-only differing characters over the runs compared
  const starts = clear ? (observed.length === value.length ? [0] : []) : Array.from({ length: Math.max(0, observed.length - value.length + 1) }, (_, i) => i);
  for (const at of starts) {
    let differ = 0;
    let caseAlone = true;
    for (let i = 0; i < value.length && caseAlone; i++) {
      const a = observed[at + i];
      const b = value[i];
      if (a === b) continue;
      differ++;
      caseAlone = a.toLowerCase() === b.toLowerCase() || a.toUpperCase() === b.toUpperCase();
    }
    if (caseAlone && differ > 0 && (caseOnly === undefined || differ < caseOnly)) caseOnly = differ;
  }
  if (caseOnly !== undefined) return { kind: 'case', positions: caseOnly };
  if (observed.length !== value.length) return { kind: 'length' };
  let differ = 0;
  for (let i = 0; i < value.length; i++) if (observed[i] !== value[i]) differ++;
  return { kind: 'same-length', positions: differ };
}

/**
 * Poll the field until its exposed value satisfies `ok`; returns the last observation.
 *
 * It does NOT stop early on a stable mismatch (considered 2026-10-09: the
 * auto-capitalised fill in docs/bugs/2026-10-09-fill-mismatch-error-says-
 * equal-counts-when-app-transforms-text.md ran its whole budget, 36 s on a
 * WDA tree that reads in ~4 s). Two equal reads 400 ms apart are what a field
 * still waiting on its input looks like too: the reason this poll exists is
 * synthetic input arriving late (Compose async state, an IME queue on a
 * loaded emulator — 3 of 11 characters measured landed at first, 2026-08-05),
 * and a stop on "unchanged" would fail exactly those fills, or with clear
 * wipe and retype them. The cost of a transformed value is paid on a fill
 * that fails anyway; the price of stopping early would be paid by ones
 * that pass.
 */
async function pollValue(
  refetch: () => Promise<UiNode | undefined>,
  ok: (observed: string) => boolean,
  pollMs: number,
): Promise<string | undefined> {
  let observed: string | undefined;
  for (let i = 0; i < 5; i++) {
    observed = (await refetch())?.value ?? undefined;
    if (observed !== undefined && ok(observed)) return observed;
    if (observed === undefined && i >= 1) return undefined; // field exposes no text — stop waiting
    await sleep(pollMs);
  }
  return observed;
}
