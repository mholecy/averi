/**
 * What a fill MEASURED — the facts interact/fill.ts#fillField returns, and
 * nothing else: no I/O, no judgement, no sentence. A leaf, so that the
 * three modules that read them each import it and none imports another for
 * its types — fill.ts measures (and imports fill-text.ts for the words of
 * the errors it throws, `fillFailureText` over a `FillFailure` here),
 * fill-verdict.ts judges, fill-text.ts says. Until
 * 2026-10-09 these types lived in fill.ts, which imported fill-verdict.ts
 * by value while fill-verdict.ts imported them back as types: no runtime
 * cycle, but a cycle in the module graph all the same (code review of the
 * deepening series, S8).
 *
 * One function lives here beside the types, `heldText`: not a judgement but
 * the DEFINITION every measurement of a field is taken in — what it holds as
 * opposed to what it shows — so the driver (fill.ts), the clear's rules
 * (fill-clear.ts) and the mismatch's classifier
 * (fill-verdict.ts#differenceOf) count the same characters (2026-10-09, the fill-clear deepening; it was a
 * closure inside fillField until then, and only fillField could ask it).
 */

import type { Rect } from '../adapters/types.js';

/**
 * What a field HOLDS, as opposed to what it SHOWS: a reading exactly equal
 * to the placeholder the tree source names (UiNode.placeholder — WDA's
 * placeholderValue, a dump's hint) is an empty field, and so is no reading.
 * Every source reports an empty field's placeholder as its value (measured
 * 2026-10-09, both platforms: docs/bugs/2026-10-09-android-clear-reads-
 * edittext-hint-as-content.md), and the clear counted it as content to
 * delete. Exact equality, and a known cost: a field that really holds the
 * text of its own placeholder reads as empty — the tree cannot tell the two
 * apart. Where the source names no placeholder (idb, the API 33 dump), the
 * clear's unchanged-reading rule (fill-clear.ts) is what catches a hint.
 */
export const heldText = (shown: string | null | undefined, placeholder: string | undefined): string =>
  shown === undefined || shown === null || shown === placeholder ? '' : shown;

/**
 * An input on the screen near a matched node that is not one — what the
 * caller probably meant. Identifier and rect only: never the label or the
 * value (on Android an EditText's label falls back to its text, and a field
 * may hold a credential).
 */
export interface NearbyInput {
  identifier: string | null;
  rect: Rect;
  /** The input's rect shares area with the matched node's (a label laid over its field). */
  overlaps: boolean;
}

/**
 * What the fill DID, as facts — measured, never worded. What they mean
 * (verified or not, and why; the head verb; what the clear sent) is decided
 * once by interact/fill-verdict.ts#judgeFill, and every sentence about them
 * is interact/fill-text.ts's, the one renderer of the MCP reply and the flow
 * line, and neither restates the request. Until 2026-10-08 both printed the REQUESTED
 * `clear` ("cleared first", "(cleared)") and an unreadable read-back passed
 * as landed: on iOS idb a floating-label `text` node was "Filled … (22
 * characters, cleared first)" with nothing cleared and nothing typed
 * (docs/bugs/2026-10-08-ios-fill-unverified-reports-filled-and-cleared.md).
 * Until 2026-10-09 the masked-append finding was a sentence here
 * (`warning`), and the typed length was glued on by each caller.
 */
export interface FillResult {
  /** How the field was chosen when several nodes matched (see resolveNow). */
  note?: string;
  /** The soft keyboard covered the field and was hidden before the focus tap (keyboard.ts: `back`, or a configured dismissal tapped) — the sentence, also in `note`. */
  keyboardHidden?: string;
  /**
   * The fill was legal but suspicious: a masked field already held `held`
   * characters after focus and `clear` is off — typing APPENDS, and the
   * length rule cannot tell that from a correct fill (see `landed`).
   */
  maskedAppend?: { held: number };
  /** The matched node's role (the one tapped, typed into and read back). */
  role: string;
  /** The length of the value typed — a length, never content (values may be credentials). 0 for a focus or a clear alone. */
  typed: number;
  /**
   * With `clear` only (absent otherwise): how many characters the input held
   * when the clear began — what clearText deleted, the field verified empty
   * after unless `readBack` is `lost` (the read after a delete did not find
   * the field: nothing then says the field is empty — review 2026-10-08,
   * m-1, a field the keyboard moved still held `XX` behind "cleared 7
   * characters first"); 0 when it held none (an input's null value is an empty one: the
   * adapters turn "" into null). `unmeasured` when the matched node is not
   * an input: its length is not the field's — a label's text, or no value
   * at all — so no delete was sent (review 2026-10-08: deletes counted off a
   * WDA label's text went into whatever had focus, and a label with no value
   * read as an empty field).
   */
  cleared?: number | 'unmeasured';
  /**
   * With `clear` only: the clear STOPPED because a round of deletes left the
   * field's reading exactly as it was, `shows` characters long — the field
   * was not seen empty. Either the field IS empty and shows its hint or
   * placeholder as its value (every tree source does, measured 2026-10-09:
   * docs/bugs/2026-10-09-android-clear-reads-edittext-hint-as-content.md),
   * or it ignores deletes (read-only, an IME that drops them); the tree
   * cannot tell the two apart. Until 2026-10-09 the loop threw `field still
   * shows N characters after clearing twice` here — on every hinted stock
   * EditText and every iOS field reporting a placeholder, after the field
   * had in fact emptied. With a value typed after it, the exact read-back
   * decides (a field that ignores deletes fails there); judgeFill makes it
   * a reason only when the read-back did not land. `deletes`: every delete
   * the clear sent, all rounds — the unchanged one included, which deleted
   * nothing anyone saw (so when it was the FIRST round, `cleared` is 0:
   * review of this branch, probe J — "cleared 9 characters first" of an
   * empty hinted field). Never set on a MASKED reading: bullets are no
   * hint, and an unchanged masked field fails as clear-twice (fill.ts,
   * `deletesChangedNothing`).
   */
  clearUnchanged?: { shows: number; deletes: number };
  /** How the typed text was checked (`ReadBack`). */
  readBack: ReadBack;
  /**
   * Set when the matched node is not an input (role ≠ INPUT_ROLE) AND the
   * read-back did not show the text in it — a node whose value took the
   * text is an input whatever its role (an iOS search field reads `other`).
   * `input` is the nearest input on the screen; `none` when the screen has
   * no input; `unread` when the tree to look in could not be read (a hint,
   * not a verdict: the fill does not fail for it).
   */
  notInput?: { input: NearbyInput | 'none' | 'unread' };
}

/**
 * Why a `lost` read-back did not find the field:
 * - `screen-changed`: after typing, the screen's set of identified nodes
 *   (screenSignature) was no longer the one read before typing, so the
 *   identity fallback refused — the measured case (an inline error label
 *   going away, a notice or the keyboard's own ids arriving).
 * - `unmatched`: the selector no longer matches and no single node of the
 *   field's role, id and rect is on the screen (the field moved, or has a
 *   twin), or nothing was read before typing to compare the screen with.
 */
export type LostWhy = 'screen-changed' | 'unmatched';

/**
 * How the typed text was checked — one fact per kind, the reason carried
 * by the one kind that has one (code review of round 2, 2026-10-08: `lost`
 * was a separate optional field beside `readBack: 'lost'`, so the two could
 * be set apart — a `lost` without its reason was rendered, and pinned, as
 * a sentence with none):
 * - `landed`: a fresh tree showed it in the field (see `landed` in fillField).
 * - `no-value`: the field WAS found (by the selector or by identity) and
 *   exposed no value on the last read (the poll stops on the second
 *   read that shows none, whether or not a read before it missed the
 *   field) — the text may or may not be there; nothing was compared. Not to
 *   be confused with `lost` (the last read found no field at all) or with a
 *   read that showed a value (`landed`, `not-taken`, or the mismatch error).
 * - `not-taken`: the node is not an input and its value does not show the
 *   text — it never moved from what it showed before the tap (a WDA
 *   StaticText echoing its label), or it moved without taking the typing
 *   (a label `Name` turning `Name*` on focus). Not the field; nothing it
 *   shows proves anything, and its length is never deleted.
 * - `lost`: the field itself was not found again — the selector stopped
 *   matching (a `value:"…"` one, once the value changed) and the identity
 *   fallback (sameField) found no single twin or was not asked; `why` says
 *   which (`LostWhy`). Also set when the clear's own read after a delete
 *   did not find the field and nothing was typed (a clear alone, value
 *   ""): the delete went out, nothing saw the field empty (review
 *   2026-10-08, m-1). Nothing was read, so nothing is known about the
 *   node's value either way. Until 2026-10-08 (iOS device check of the bug
 *   note below) this read as `no-value`, and a textfield that had just had
 *   7 characters deleted and then held the typed text was said to "expose
 *   no value": the refusal was right, the reason blamed the node.
 * - `nothing-typed`: the value was empty — a focus (and clear) alone.
 * - `placeholder` (2026-10-09): the field's last reading is EXACTLY its
 *   named placeholder (UiNode.placeholder) and nothing shows more — the
 *   value typed was that very text, or a clear alone found the field
 *   showing it and deleted nothing. Empty, or holding the text: the tree
 *   cannot tell (review of this branch, probes B and C), so it is not
 *   verified. A clear that deleted INTO the placeholder saw the field
 *   empty, and is `nothing-typed`.
 */
export type ReadBack =
  | { kind: 'landed' }
  | { kind: 'no-value' }
  | { kind: 'not-taken' }
  | { kind: 'lost'; why: LostWhy }
  | { kind: 'nothing-typed' }
  | { kind: 'placeholder' };


/**
 * Why a fill THREW, as facts — the three failures fillField raises, worded
 * by interact/fill-text.ts#fillFailureText like every other fill sentence
 * (until 2026-10-09 they were template strings inline in fill.ts, the last
 * fill sentences outside fill-text.ts). Lengths and counts only, never
 * content: a value may be a credential.
 * - `reread-failed`: the tree could not be read mid-fill — a dead device,
 *   not a screen settling (fill.ts, `refetch`); `target` is the selector as
 *   the caller wrote it, `cause` the adapter's message.
 * - `clear-twice`: the delete rounds each CHANGED the field and none emptied
 *   it — deletes landing short — or a MASKED field the deletes did not
 *   change; `left` what it still shows, `rounds` how many were sent (2, or
 *   3 when a round's reading was not a shortening of the one before). An
 *   unchanged non-masked round is not this: FillResult.clearUnchanged.
 * - `mismatch`: the read-back showed text that is not the typed value
 *   (`typed`, `shows`: the two lengths), after the clear-fill's one retry;
 *   `differs` says what can be said of the difference without content;
 *   `notInput` when the matched node is not an input (the nearest input,
 *   as FillResult.notInput).
 */
export type FillFailure =
  | { code: 'reread-failed'; target: string; cause: string }
  | { code: 'clear-twice'; left: number; rounds: number }
  | { code: 'mismatch'; typed: number; shows: number; differs: Difference; notInput?: { role: string; input: NearbyInput | 'none' | 'unread' } };

/**
 * What differs between the typed value and a read-back that did not match
 * it, without carrying either string — classified by ONE function,
 * interact/fill-verdict.ts#differenceOf, all five kinds (until 2026-10-09
 * fill.ts chose `unchanged`, `masked` and a partly masked `length` in a
 * ternary at the throw, and a helper of its own the rest):
 * - `masked`: the field shows bullets, compared by length only; `held` the
 *   bullets it held after focus, without `clear` (undefined with it).
 * - `case`: the typed text IS there but for letter case — at `positions`
 *   characters (with clear the whole field; without, the best-matching run
 *   of it). UIKit's sentence auto-capitalisation turning `hello` into
 *   `Hello` is the measured case (2026-10-09, iOS Contacts Notes:
 *   docs/bugs/2026-10-09-fill-mismatch-error-says-equal-counts-when-app-
 *   transforms-text.md), which read `typed 5 characters but the field shows
 *   5` and nothing else.
 * - `same-length`: the field shows as many characters as were typed, and
 *   `positions` of them differ by more than case — autocorrect, smart
 *   punctuation, a mask.
 * - `unchanged`: the field shows exactly what it showed when typing began
 *   — the typing did not reach it (a focus tap that missed, a field that
 *   ignores input), or the field refused it (already at its maxLength).
 *   Review of this branch: probes D and D2 were told "the app transformed
 *   the input".
 * - `length`: none of these — the lengths are all that can be said (also
 *   a partly masked reading, `•••••t`, whose content is not comparable).
 * Still a FAILURE in every case: a field that shows `Hello` for `hello` does
 * not hold the value asked for (a case-sensitive login, a code), and a
 * case-insensitive pass would hide exactly that.
 */
export type Difference =
  | { kind: 'masked'; held?: number }
  | { kind: 'case'; positions: number }
  | { kind: 'same-length'; positions: number }
  | { kind: 'unchanged' }
  | { kind: 'length' };
