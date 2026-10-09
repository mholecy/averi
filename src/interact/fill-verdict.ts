/**
 * What a fill's facts MEAN, decided once, as codes — never as sentences.
 *
 * interact/fill.ts measures (`FillResult`: what the clear deleted, how the
 * read-back went, what the node is, what the masked field held). Two media
 * report it: the MCP type_text reply and the flow's `fill` trace line. Until
 * 2026-10-09 each of them asked the facts its own questions — "is it
 * verified" was `fillUnverifiedText(...) === undefined` in both, "what did
 * the clear send" was `fillClearedText`, whose answer depended on the first
 * question, and the reply alone had a third branch (`clearAloneHead`) for a
 * clear with nothing typed. The two media drifted on exactly that seam: a
 * clear alone that was not verified read `(N deletes sent)` on one and
 * `cleared N characters first` on the other until df8a91a
 * (docs/bugs/2026-10-08-ios-fill-unverified-reports-filled-and-cleared.md).
 *
 * Now the split is three-way, each part with one owner:
 * - facts — interact/fill-facts.ts#FillResult, measured by fill.ts, never
 *   worded (the masked-append warning was a sentence on the result until
 *   2026-10-09; it is `maskedAppend: { held }` now, and its sentence a row
 *   in fill-text.ts);
 * - judgement — `judgeFill` here: the head verb (`did`), what the clear
 *   sent and how to count it (`sent`), WHY the fill is not verified
 *   (`reasons`, codes) and what else the caller must hear (`caveats`,
 *   codes). Pure, total, no I/O; the tests of the judgement assert codes,
 *   never wording;
 * - words — interact/fill-text.ts's, all of them: the sentence tables
 *   (one row per code, exhaustive, so a new code without its sentence does
 *   not compile) and the layout of both media beside them. The same rule as
 *   scroll_until's (interact/scroll-rounds.ts judges into typed outcomes,
 *   interact/scroll-text.ts says every sentence): the judge emits codes, the
 *   renderer owns the words. Until 2026-10-09 (code review S1) the tables
 *   sat here and only the layout was fill-text.ts's.
 *
 * The verdict's invariants (pinned in tests/interact/fill-verdict.test.ts):
 * - `did === 'filled'` ⇔ `reasons.length === 0` — "Filled" is the only
 *   verified head, and an unverified fill always says why.
 * - Unverified: `did` is `'typed'` ⇔ `typed > 0`; with `typed === 0` it is
 *   `'cleared'` ⇔ a delete went out (`sent` present), else `'focused'`.
 * - `sent` is present ⇔ there is something true to say: characters the
 *   clear was seen to delete (`cleared` > 0), or — for a clear alone that
 *   is not verified — deletes that went out (`clearUnchanged.deletes`, all
 *   rounds, else `cleared`); it counts `deletes` ⇔ `did === 'cleared'` (nothing typed
 *   after it and nothing seen empty, so "cleared … first" would claim both a
 *   result and a sequel that never came — code review of round 2,
 *   2026-10-08), `characters` otherwise.
 * - `reasons` order is render order: the read-back's reason (`no-value`,
 *   `not-taken`, `lost`, `placeholder`) first, then the clear's
 *   (`clear-unmeasured`, `clear-unchanged`, `clear-no-length` — at most one), never when the
 *   read-back `landed` — with clear, `landed` is "the field shows exactly
 *   the value", which is what the clear was for. A clear ALONE (nothing
 *   typed, read-back `nothing-typed`) that stopped on unchanged deletes is
 *   therefore unverified: `cleared` in deletes, its reason the only one.
 * - `caveats` order: the not-an-input finding, then the masked-append
 *   warning (fill.ts never produces both: a masked-append needs an input
 *   that took the text, a not-input finding a read-back that did not land).
 *
 * The same module classifies a mismatch (`differenceOf`, below): what a
 * read-back that missed the value can be said to differ by, as a
 * `Difference` code — judged here, worded by fill-text.ts, measured by
 * fill.ts, which hands it the strings and throws what comes back.
 *
 * Its imports are the facts (interact/fill-facts.ts, a leaf: the types and
 * `heldText`) and the mask characters (ui-tree/masked-value.ts): it imports
 * neither fill.ts, which measures, nor fill-text.ts, which reads the verdict
 * — the graph is fill.ts → fill-facts.ts ← fill-verdict.ts ← fill-text.ts,
 * fill.ts → fill-verdict.ts for `differenceOf`, and fill.ts → fill-text.ts
 * for its errors' words.
 */

import { hasBullet, isMaskedValue } from '../ui-tree/masked-value.js';
import { heldText, type Difference, type FillResult, type LostWhy, type NearbyInput } from './fill-facts.js';

/**
 * Why a fill is NOT verified — one code per reason, in render order:
 * - `no-value`: the field was found and exposed no value on the last read;
 *   nothing was compared (ReadBack `no-value`).
 * - `not-taken`: the node is not an input and its value never showed the
 *   text — not the field (ReadBack `not-taken`).
 * - `lost`: the field itself was not found again, `why` says how; said as
 *   the field's absence, never as the node's lack of a value — the node may
 *   well hold the text (ReadBack `lost`).
 * - `clear-unmeasured`: the clear sent no delete because the node is not
 *   the input, so its length is not the field's (`cleared: 'unmeasured'`).
 * - `clear-no-length`: the clear sent no delete because the node gave no
 *   length at all (`cleared: 0` on a `no-value` read-back).
 * - `placeholder`: the field shows exactly its named placeholder — empty,
 *   or holding that very text (ReadBack `placeholder`).
 * - `clear-unchanged`: the clear's last deletes left the field showing the
 *   same `shows` characters (`clearUnchanged`) — its hint or placeholder
 *   on an empty field, or a field ignoring deletes; nothing saw it empty.
 */
export type Reason =
  | { code: 'no-value'; role: string }
  | { code: 'not-taken'; role: string }
  | { code: 'lost'; why: LostWhy }
  | { code: 'clear-unmeasured'; role: string }
  | { code: 'placeholder' }
  | { code: 'clear-no-length' }
  | { code: 'clear-unchanged'; shows: number };

/** What the clear SENT — never what was asked (2026-10-08) — and in which unit it is said (see the module header's invariants). */
export interface Sent {
  what: 'characters' | 'deletes';
  n: number;
}

/**
 * What the caller must hear beside the verdict, on lines of their own:
 * - `not-input`: the matched node is not a textfield and the read-back did
 *   not show the text in it; `input` is the nearest input (`none`: the
 *   screen has none; `unread`: the tree to look in could not be read);
 *   `typed`: whether anything was typed (a focus-and-clear alone says what
 *   was NOT deleted instead of where typing went).
 * - `masked-append`: a masked field held `held` characters after focus and
 *   clear was off — the length rule cannot tell the append from a correct
 *   fill (finportal 2026-09-17: backend `invalid_grant`).
 */
export type Caveat =
  | { code: 'not-input'; role: string; typed: boolean; input: NearbyInput | 'none' | 'unread' }
  | { code: 'masked-append'; held: number };

/** A fill, judged. Built only by `judgeFill`; its invariants are the module header's. */
export interface FillVerdict {
  /** The head verb: what the fill can be said to have done. */
  did: 'filled' | 'typed' | 'cleared' | 'focused';
  /** The length of the text typed — a length, never content. */
  typed: number;
  /** Absent when no delete went out (`cleared` undefined, 0 or `'unmeasured'`). */
  sent?: Sent;
  /** `[]` ⇔ `did === 'filled'` — the only way to say "verified". */
  reasons: Reason[];
  caveats: Caveat[];
  /** The resolution note (resolve.ts#resolveNow), carried for the MCP reply; the flow line prints none. */
  note?: string;
}

/**
 * Judge a fill from its facts. Pure, total, O(1): it runs once per fill,
 * after every device read is done. The one place that decides "verified",
 * the head verb and the deletes-vs-characters unit — renderers read the
 * result and decide none of it.
 */
export function judgeFill(r: FillResult): FillVerdict {
  const { readBack, role, cleared, typed } = r;
  const reasons: Reason[] = [];
  if (readBack.kind === 'no-value') reasons.push({ code: 'no-value', role });
  if (readBack.kind === 'not-taken') reasons.push({ code: 'not-taken', role });
  if (readBack.kind === 'lost') reasons.push({ code: 'lost', why: readBack.why });
  if (readBack.kind === 'placeholder') reasons.push({ code: 'placeholder' });
  if (readBack.kind !== 'landed') {
    if (cleared === 'unmeasured') reasons.push({ code: 'clear-unmeasured', role });
    else if (r.clearUnchanged !== undefined) reasons.push({ code: 'clear-unchanged', shows: r.clearUnchanged.shows });
    else if (cleared === 0 && readBack.kind === 'no-value') reasons.push({ code: 'clear-no-length' });
  }
  const verified = reasons.length === 0;
  // Characters: what the clear was SEEN to delete (`cleared`). Deletes:
  // what went out, all rounds — said only of a clear alone nobody saw land,
  // where the deletes are all there is to report.
  const characters = typeof cleared === 'number' ? cleared : 0;
  const deletes = r.clearUnchanged?.deletes ?? characters;
  const sent: Sent | undefined =
    typed === 0 && !verified
      ? deletes > 0
        ? { what: 'deletes', n: deletes }
        : undefined
      : characters > 0
        ? { what: 'characters', n: characters }
        : undefined;
  const caveats: Caveat[] = [];
  if (r.notInput !== undefined) caveats.push({ code: 'not-input', role, typed: readBack.kind !== 'nothing-typed', input: r.notInput.input });
  if (r.maskedAppend !== undefined) caveats.push({ code: 'masked-append', held: r.maskedAppend.held });
  return {
    did: verified ? 'filled' : typed > 0 ? 'typed' : sent !== undefined ? 'cleared' : 'focused',
    typed,
    sent,
    reasons,
    caveats,
    note: r.note,
  };
}

/**
 * A read-back that missed the value, as fillField saw it — the strings
 * stay here and in fill.ts; only the `Difference` they make leaves (into
 * the FillFailure, lengths and counts only: a value may be a credential).
 */
export interface Mismatch {
  /** The last reading of the field. */
  observed: string;
  /** What it showed when typing began (null: no value, or not found). */
  before: string | null;
  /** The value typed. */
  value: string;
  /** The fill cleared first: the field must EQUAL the value, not contain it. */
  clear: boolean;
  /** The bullets a masked field held after focus (fill.ts, `maskedHeld`); said only without clear. */
  maskedHeld: number;
  /** The field's named placeholder (UiNode.placeholder): no text, so never compared (fill-facts.ts#heldText). */
  placeholder: string | undefined;
}

/**
 * What can be said of the difference — ONE classification of all five
 * kinds (fill-facts.ts#Difference), first match wins (2026-10-09, the
 * fill-clear deepening; until then fill.ts chose `unchanged`, `masked` and
 * the partly masked `length` in a ternary at the throw, and a helper of its
 * own the rest):
 * 1. `unchanged`: the reading is exactly what the field showed when typing
 *    began — whatever it is, bullets included (probes D and D2 were told
 *    "the app transformed the input").
 * 2. `masked`: bullets only, compared by length; `held` without clear.
 * 3. `length` of a PARTLY masked reading (Android's show-the-last-character
 *    password field, `•••••t`): its content is not comparable either
 *    (hasBullet: • and ● only — `*` and `·` are ordinary text too).
 * 4. Otherwise the HELD text is compared (a named placeholder is no text):
 *    with clear the field must EQUAL the value, so the two are compared
 *    whole; without, it must CONTAIN it, so every run of the new text (what
 *    came after `before`'s held text, when the field still starts with it)
 *    as long as the value is compared and the closest one counts — `case`
 *    when one differs only in letter case, else `same-length` when the
 *    lengths match, else `length`. Only position-for-position: an inserted
 *    or dropped character is a length difference. Letter case by
 *    toLowerCase/toUpperCase of each UTF-16 unit — enough for the measured
 *    auto-capitalisation; a case pair whose forms differ in length
 *    (`ß`/`SS`) reads as a plain difference, never as a pass.
 * Pure, O(observed × value) — run once, at the throw.
 */
export function differenceOf(m: Mismatch): Difference {
  const { observed, value, clear } = m;
  if (observed === m.before) return { kind: 'unchanged' };
  if (isMaskedValue(observed)) return { kind: 'masked', held: clear ? undefined : m.maskedHeld };
  if (hasBullet(observed)) return { kind: 'length' };
  const shown = heldText(observed, m.placeholder);
  const prior = clear ? '' : heldText(m.before, m.placeholder);
  // Without clear the field may hold text from before the typing; only what
  // came AFTER it is compared, when the field still starts with it (typing
  // appends at the cursor, which the focus tap leaves at the end). A field
  // whose earlier text changed too is compared whole — the limit: a run of
  // the old text can then be named as the "transformed" typing.
  const typed = prior !== '' && shown.startsWith(prior) ? shown.slice(prior.length) : shown;
  let caseOnly: number | undefined; // fewest case-only differing characters over the runs compared
  const starts = clear ? (typed.length === value.length ? [0] : []) : Array.from({ length: Math.max(0, typed.length - value.length + 1) }, (_, i) => i);
  for (const at of starts) {
    let differ = 0;
    let caseAlone = true;
    for (let i = 0; i < value.length && caseAlone; i++) {
      const a = typed[at + i];
      const b = value[i];
      if (a === b) continue;
      differ++;
      caseAlone = a.toLowerCase() === b.toLowerCase() || a.toUpperCase() === b.toUpperCase();
    }
    if (caseAlone && differ > 0 && (caseOnly === undefined || differ < caseOnly)) caseOnly = differ;
  }
  if (caseOnly !== undefined) return { kind: 'case', positions: caseOnly };
  if (typed.length !== value.length) return { kind: 'length' };
  let differ = 0;
  for (let i = 0; i < value.length; i++) if (typed[i] !== value[i]) differ++;
  return { kind: 'same-length', positions: differ };
}
