/**
 * What a fill MEASURED — the facts interact/fill.ts#fillField returns, and
 * nothing else: no I/O, no judgement, no sentence. A leaf, so that the
 * modules that read them each import it and none imports another for
 * its types — fill.ts measures (and imports fill-text.ts for the words of
 * the errors it throws, `fillFailureText` over a `FillFailure` here),
 * fill-landing.ts judges a reading, fill-verdict.ts judges the result,
 * fill-text.ts says.
 *
 * Beside the types live `heldText` and `shownText` (and the small `isPoint`
 * and `hasPoint` guards): not judgements but the DEFINITIONS every
 * measurement of a field is taken in — what it shows of a node (`shownText`,
 * A28), and what it holds as opposed to what it shows (`heldText`) — so
 * every module that measures a field counts the same characters.
 */

import type { Rect, UiNode } from '../adapters/types.js';

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
 * line, and neither restates the request: a reply that printed the REQUESTED
 * `clear` ("cleared first", "(cleared)") and passed an unreadable read-back
 * as landed said "Filled … (22 characters, cleared first)" of a
 * floating-label `text` node on iOS idb, with nothing cleared and nothing
 * typed (docs/bugs/2026-10-08-ios-fill-unverified-reports-filled-and-cleared.md).
 */
export interface FillResult {
  /** How the field was chosen when several nodes matched (see resolveNow). */
  note?: string;
  /** The soft keyboard covered the field and was hidden before the focus tap (keyboard.ts: `back`, or a configured dismissal tapped) — the sentence, also in `note`. */
  keyboardHidden?: string;
  /** The focus tap went elsewhere than the field's centre, a node of the app being drawn over it (tap-judgement.ts#TapJudge.aim) — the clause, also in `note` as `focus tap <moved>`. */
  moved?: string;
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
   * the field: nothing then says the field is empty — a field the keyboard
   * moved still held `XX` behind "cleared 7 characters first"); 0 when it
   * held none (an input's null value is an empty one: the adapters turn ""
   * into null), or when the first round of deletes changed nothing
   * (fill-clear.ts#ClearFacts, `clearUnchanged`). `unmeasured` when the
   * matched node is not an input: its length is not the field's — a label's
   * text, or no value at all — so no delete was sent (deletes counted off a
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
   * cannot tell the two apart. Throwing `field still shows N characters after
   * clearing twice` here would fail every hinted stock EditText and every iOS
   * field reporting a placeholder, after the field had in fact emptied. With
   * a value typed after it, the exact read-back decides (a field that ignores
   * deletes fails there); judgeFill makes it a reason only when the read-back
   * did not land. `deletes`: every delete the clear sent, all rounds — the
   * unchanged one included, which deleted nothing anyone saw (so when it was
   * the FIRST round, `cleared` is 0 — else "cleared 9 characters first"
   * would be said of an empty hinted field). Never set on a MASKED reading:
   * bullets are no hint, and an unchanged masked field fails as clear-twice
   * (fill-clear.ts, `deletesChangedNothing`).
   */
  clearUnchanged?: { shows: number; deletes: number };
  /**
   * With `clear` on an input only: the clear ended with the field reading
   * EXACTLY its named placeholder (UiNode.placeholder) — empty by
   * `heldText`, or text the deletes did not reach; the tree cannot tell.
   * Which reading led there (fill-clear.ts#ClearFacts):
   * - `shown`: the field read the placeholder before any delete — none was
   *   sent;
   * - `prefix`: the last deletes went into a reading that STARTED with the
   *   placeholder's text, so what they left may be held;
   * - `other`: they went into one that did not — only an empty field
   *   shows the placeholder then.
   * A fact, not a verdict: judgeFill makes `shown` and `prefix` the
   * `placeholder` reason of a clear alone.
   */
  clearPlaceholder?: ClearPlaceholder;
  /** How the typed text was checked (`ReadBack`). */
  readBack: ReadBack;
  /**
   * The read-back landed only after the field's DROPPED TAIL was typed again
   * (interact/fill-type.ts): each retyped tail by its length, in order;
   * absent when nothing was typed again. A field that keeps a strict prefix
   * of the typing — React Native's controlled single-line TextInput under
   * `idb ui text`, docs/bugs/2026-10-19-ios-fill-loses-the-tail-of-its-
   * text-in-a-react-native-single-line-field.md. A length, never content.
   */
  retyped?: number[];
  /**
   * The read-back landed REFORMATTED (D18, docs/adr/0034-a-fill-passes-a-field-that-reformats-as-it-is-typed.md): the
   * field shows every typed character in order with separators of its own between them (an IBAN grouped in fours, an
   * amount's thousands) — interact/fill-reformat.ts#reformatOf; absent when it shows the text exactly. Counts only.
   */
  reformatted?: Reformat;
  /**
   * The read-back landed on text around the value in a field whose text after focus was not read (`FocusUnread`, D64b-3);
   * absent when the re-read ran or the reading is exactly the value.
   */
  focusUnread?: FocusUnread;
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
 * A reading landed holding the value among other text, and the post-focus re-read was skipped
 * (docs/adr/0028-a-fill-re-reads-after-focus-only-where-focus-can-change-the-count.md, its D64b-3 amendment), so that
 * text may not all come from the keys: a field can insert text on focus (`+421 ` for a typed `421`, no key landed).
 * `shows` the reading's length. A length, never content, as everywhere here.
 */
export interface FocusUnread {
  shows: number;
}

/**
 * How a field reformatted what was typed (FillResult.reformatted, measured by interact/fill-reformat.ts#reformatOf):
 * `added` the separators it put between the typed characters, `respaced` the typed spaces it shows as another space
 * (a no-break or narrow no-break space) — never both 0: reformatOf returns no Reformat for an exact reading. `point`:
 * the added `.`/`,` is a thousands mark, which the reading cannot tell from a decimal point — FillVerdict's caveat
 * applies; absent for every other separator, a digit grouping by `.`/`,` included (D51: two or more marks cannot be a
 * decimal point; fill-reformat.ts#markKind). Counts only, never content: on a secret, `respaced` can only be measured
 * in a field that shows it unmasked (a masked reading is never a reformat).
 */
export interface Reformat {
  added: number;
  respaced: number;
  point?: Point;
}

/** An added separator the reading cannot tell from a decimal point (Reformat.point). */
export type Point = '.' | ',';
export const isPoint = (c: string | undefined): c is Point => c === '.' || c === ',';
/** A Reformat whose added separator is a Point — FillVerdict's `reformatted-point` caveat. */
export type PointedReformat = Reformat & { point: Point };
export const hasPoint = (r: Reformat): r is PointedReformat => r.point !== undefined;

/**
 * Which reading a clear that ended on EXACTLY the named placeholder came
 * from — FillResult.clearPlaceholder, measured by fill-clear.ts (ClearFacts)
 * and spelled once, here: `shown` (before any delete), `prefix` (deletes
 * into a reading that started with the placeholder's text), `other` (into
 * one that did not).
 */
export type ClearPlaceholder = 'shown' | 'prefix' | 'other';

/**
 * Why a `lost` read-back did not find the field:
 * - `screen-changed`: after typing, the screen's set of identified nodes
 *   (ui-tree/read-tree.ts#ScreenIdentity) was no longer the one read before typing, so the
 *   identity fallback refused — the measured case (an inline error label
 *   going away, a notice or the keyboard's own ids arriving); or, with
 *   nothing read before typing, no longer the one the field was resolved on.
 * - `unmatched`: the selector no longer matches and no single node of the
 *   field's role, id and rect is on the screen (the field moved, or has a
 *   twin), or nothing was read before typing and the screen is not shown to
 *   differ from the one the field was resolved on.
 */
export type LostWhy = 'screen-changed' | 'unmatched';

/**
 * One read of the field after the focus tap (interact/fill-refetch.ts): the node, found by the selector or by
 * identity, or why it was not found (`LostWhy`) — one answer, read by the clear and by the typing alike (A28).
 */
export type FieldRead = { node: UiNode; lost?: undefined } | { node?: undefined; lost: LostWhy };

/**
 * The text a field's node shows, as the fill compares it. An input's null value is EMPTY (types.ts#UiNode.value —
 * both parsers map "" to null), so a field that dropped every typed character reads "" and fails as a mismatch
 * (`shows 0`), never as `no-value` (docs/bugs/2026-10-09-android-fill-into-a-field-that-drops-everything-
 * reads-exposes-no-value.md: an Android digits-only field fed `abc` passed `optional:`). On any other role null is
 * withheld text: undefined. `isInput`: the matched node's role, as resolved before the tap, is INPUT_ROLE — the
 * field's, whichever read found it.
 */
export const shownText = (n: Pick<UiNode, 'value'>, isInput: boolean): string | undefined => n.value ?? (isInput ? '' : undefined);

/**
 * How the typed text was checked — one fact per kind, the reason carried
 * by the one kind that has one (a separate `lost` field beside
 * `readBack: 'lost'` could be set apart from it, and a `lost` without its
 * reason rendered as a sentence with none):
 * - `landed`: a fresh tree showed it in the field (see `landed` in fillField).
 * - `no-value`: the node WAS found (by the selector or by identity), is not
 *   an input, and exposed no value on the last read (the poll stops on the
 *   second read that shows none, whether or not a read before it missed the
 *   field) — the text may or may not be there; nothing was compared. An
 *   input with no value is EMPTY (UiNode.value) and compared as "" — never
 *   this kind. Not to be confused with `lost` (the last read found no field
 *   at all) or with a read that showed a value (`landed`, `not-taken`, or the
 *   mismatch error).
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
 *   ""): the delete went out, nothing saw the field empty. Nothing was read,
 *   so nothing is known about the node's value either way. Not `no-value`:
 *   on the iOS device check of 2026-10-08, a textfield that had just had 7
 *   characters deleted and then held the typed text was said to "expose no
 *   value" — the refusal was right, the reason blamed the node.
 * - `nothing-typed`: the value was empty — a focus (and clear) alone.
 * - `placeholder`: the read-back's reading is EXACTLY the field's named
 *   placeholder (UiNode.placeholder) and nothing shows more — the value
 *   typed was that very text. Empty, or holding the text: the tree cannot
 *   tell, so it is not verified.
 *   Typed fills only: a clear alone that ends on the placeholder is
 *   `nothing-typed` with the fact `clearPlaceholder`, and judgeFill decides
 *   whether that is the `placeholder` reason.
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
 * by interact/fill-text.ts#fillFailureText like every other fill sentence.
 * Lengths and counts only, never the typed value or the field's text: a
 * value may be a credential.
 * - `reread-failed`: the tree could not be read mid-fill — a dead device,
 *   not a screen settling (fill-refetch.ts); `target` is the selector as
 *   the caller wrote it, `cause` the adapter's message. Never a
 *   PersistentReadError: see ui-tree/read-tree.ts#readTreeOrThrow.
 * - `clear-twice`: the delete rounds each CHANGED the field and none emptied
 *   it — deletes landing short — or a MASKED field the deletes did not
 *   change; `left` what it still shows, `rounds` how many were sent (2, or
 *   3 when a round's reading was not a shortening of the one before). An
 *   unchanged non-masked round is not this: FillResult.clearUnchanged.
 * - `mismatch`: the read-back showed text that is not the typed value
 *   (`typed`, `shows`: the two lengths), after the clear-fill's one retry;
 *   `differs` says what can be said of the difference without content;
 *   `notInput` when the matched node is not an input (the nearest input,
 *   as FillResult.notInput); `again` what was sent again before that
 *   read-back, in order (`SentAgain`: a dropped tail, the clear's retype —
 *   `wiped` when it deleted what the field held first, else it only typed
 *   again, the field showing nothing or its placeholder), so the error says
 *   the read-back is not the first (D3); `elsewhere` another input that
 *   changed while typing — the focus left the field, and nothing was sent
 *   again into it.
 */
export type FillFailure =
  | { code: 'reread-failed'; target: string; cause: string }
  | { code: 'clear-twice'; left: number; rounds: number }
  | {
      code: 'mismatch';
      typed: number;
      shows: number;
      differs: Difference;
      notInput?: { role: string; input: NearbyInput | 'none' | 'unread' };
      again?: SentAgain[];
      elsewhere?: OtherInput;
    };

/**
 * What a fill sent again after its first typing, in the order sent
 * (interact/fill-type.ts): `tail` — the `length` characters a field dropped
 * from the end of the typing; `whole` — the clear's retype of the whole
 * value, `wiped` when it deleted what the field held first.
 */
export type SentAgain = { kind: 'tail'; length: number } | { kind: 'whole'; wiped: boolean };

/**
 * Another input on the screen whose value changed while the fill typed —
 * the typing left the field (an auto-advancing code box moved the focus).
 * Role, identifier and rect only: never its value.
 */
export interface OtherInput {
  role: string;
  identifier: string | null;
  rect: Rect;
}

/**
 * What differs between the typed value and a read-back that did not match
 * it, without carrying either string — classified in ONE module,
 * interact/fill-landing.ts (`readingOf`: all eight kinds of a reading that did
 * not land; `landingOf`'s final `said-plain` carries its `masked-said-plain`
 * itself):
 * - `masked`: the field shows bullets, compared by length only; `held` the
 *   bullets it held after focus, without `clear` (undefined with it).
 * - `masked-said-plain`: the field shows bullets, though its source said it
 *   is plain, so what it held after focus was never read and only the typed
 *   length passes (interact/fill.ts, the skipped re-read: docs/adr/
 *   0028-a-fill-re-reads-after-focus-only-where-focus-can-change-the-count.md;
 *   the held count `'unread'`, fill-landing.ts#Landing `said-plain`).
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
 *   ignores input), or the field refused it (already at its maxLength) —
 *   not "the app transformed the input".
 * - `dropped-tail` (D28): the field holds the first `landed` characters of
 *   the typing, reformatted (interact/fill-landing.ts#NotLanded): `grouped`
 *   when the field added separators of its own, else it only showed its typed
 *   spaces as another kind of space (`Jan\u00A0` for `Jan Novak`) — and not the last
 *   `dropped` — a tail the
 *   field dropped or refused (a length cap, a character it does not take:
 *   the reading cannot tell which), not an input it transformed. iOS React Native's rf2 held
 *   `1 234 567,` for `1234567,89` and was told "as many characters as were
 *   typed, 9 differing: the app transformed the input" (2026-10-31). An
 *   EXACT prefix stays `length`. `wholeToo` (D64): the reading is a whole
 *   landing as well — a select-all field's value with a mark of its own, a
 *   caret inside the text (interact/fill-landing.ts#wholeLandingToo) — so
 *   nothing was typed again, and the reply names that reading and its
 *   remedy. A `length` carries it too: an exact strict prefix that is a
 *   whole landing as well (`-5-` for `-5` after `-5`, `xaa` for `aa` after
 *   `xa`). `equal` (D79): the field's count is the typed one, and why the two
 *   equal numbers are no match (`EqualCount`; docs/bugs/2026-10-09-fill-mismatch-error-says-
 *   equal-counts-when-app-transforms-text.md's class).
 * - `separated` (D53): every typed character is there, in order, with
 *   `added` separators (interact/fill-reformat.ts#SEPARATORS) and nothing
 *   else — separators ADR 0034's rules refuse as the field's grouping (a
 *   cents mask's `12.34` for `1234`, a sign, mixed or trailing marks, groups
 *   of one, autocorrect's `a lot` for `alot`), which would otherwise read
 *   `typed 4 characters but the field shows 5` and no remedy (D53).
 * - `length`: none of these — the lengths are all that can be said (also
 *   a partly masked reading, `•••••t`, whose content is not comparable).
 * Still a FAILURE in every case: a field that shows `Hello` for `hello` does
 * not hold the value asked for (a case-sensitive login, a code), and a
 * case-insensitive pass would hide exactly that.
 */
export type Difference =
  | { kind: 'masked'; held?: number }
  | { kind: 'masked-said-plain' }
  | { kind: 'case'; positions: number }
  | { kind: 'same-length'; positions: number }
  | { kind: 'unchanged' }
  | { kind: 'dropped-tail'; landed: number; dropped: number; grouped: boolean; wholeToo?: true }
  | { kind: 'separated'; added: number }
  | { kind: 'length'; wholeToo?: true; equal?: EqualCount };

/**
 * Why a `length` whose field count is the typed one is no match (D79), one
 * reason, set only there (interact/fill-landing.ts#differenceOf):
 * - `value-itself`: the reading is the value, refused without clear (D71:
 *   `55` after `5`); `appendWouldShow`, the earlier text's count plus the
 *   typed.
 * - `padded`: the earlier text pads a short typing up to the typed count
 *   (`12` after `1` read `11`); `typedPart`, how many characters are past
 *   it — at least 1, fewer than typed.
 * - `placeholder`: the reading is exactly the named placeholder — an empty
 *   field, or typing the app turned into that text; the tree cannot tell
 *   which.
 * - `partly-masked`: bullets among the characters (`•••••t` for `secret`),
 *   whose content cannot be compared.
 */
export type EqualCount =
  | { why: 'value-itself'; appendWouldShow: number }
  | { why: 'padded'; typedPart: number }
  | { why: 'placeholder' }
  | { why: 'partly-masked' };
