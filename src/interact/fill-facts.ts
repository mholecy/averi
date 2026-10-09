/**
 * What a fill MEASURED — the facts interact/fill.ts#fillField returns, and
 * nothing else: no I/O, no judgement, no sentence. A leaf, so that the
 * three modules that read them each import it and none imports another for
 * its types — fill.ts measures (and imports fill-text.ts for one sentence,
 * its mismatch error's), fill-verdict.ts judges, fill-text.ts says. Until
 * 2026-10-09 these types lived in fill.ts, which imported fill-verdict.ts
 * by value while fill-verdict.ts imported them back as types: no runtime
 * cycle, but a cycle in the module graph all the same (code review of the
 * deepening series, S8).
 */

import type { Rect } from '../adapters/types.js';

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
   * a reason only when the read-back did not land.
   */
  clearUnchanged?: { shows: number };
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
 */
export type ReadBack =
  | { kind: 'landed' }
  | { kind: 'no-value' }
  | { kind: 'not-taken' }
  | { kind: 'lost'; why: LostWhy }
  | { kind: 'nothing-typed' };

