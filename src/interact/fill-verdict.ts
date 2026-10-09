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
 * - `sent` is present ⇔ the clear sent at least one delete (`cleared` a
 *   number > 0); it counts `deletes` ⇔ `did === 'cleared'` (nothing typed
 *   after it and nothing seen empty, so "cleared … first" would claim both a
 *   result and a sequel that never came — code review of round 2,
 *   2026-10-08), `characters` otherwise.
 * - `reasons` order is render order: the read-back's reason (`no-value`,
 *   `not-taken`, `lost`) first, then the clear's (`clear-unmeasured`,
 *   `clear-no-length`, `clear-unchanged` — at most one), never when the
 *   read-back `landed` — with clear, `landed` is "the field shows exactly
 *   the value", which is what the clear was for. A clear ALONE (nothing
 *   typed, read-back `nothing-typed`) that stopped on unchanged deletes is
 *   therefore unverified: `cleared` in deletes, its reason the only one.
 * - `caveats` order: the not-an-input finding, then the masked-append
 *   warning (fill.ts never produces both: a masked-append needs an input
 *   that took the text, a not-input finding a read-back that did not land).
 *
 * Its only import is the facts' types, from interact/fill-facts.ts (a
 * leaf): it imports neither fill.ts, which measures, nor fill-text.ts, which
 * reads the verdict — the graph is fill.ts → fill-facts.ts ← fill-verdict.ts
 * ← fill-text.ts, and fill.ts → fill-text.ts for its mismatch error's words.
 */

import type { FillResult, LostWhy, NearbyInput } from './fill-facts.js';

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
 * - `clear-unchanged`: the clear's last deletes left the field showing the
 *   same `shows` characters (`clearUnchanged`) — its hint or placeholder
 *   on an empty field, or a field ignoring deletes; nothing saw it empty.
 */
export type Reason =
  | { code: 'no-value'; role: string }
  | { code: 'not-taken'; role: string }
  | { code: 'lost'; why: LostWhy }
  | { code: 'clear-unmeasured'; role: string }
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
  if (readBack.kind !== 'landed') {
    if (cleared === 'unmeasured') reasons.push({ code: 'clear-unmeasured', role });
    else if (cleared === 0 && readBack.kind === 'no-value') reasons.push({ code: 'clear-no-length' });
    else if (r.clearUnchanged !== undefined) reasons.push({ code: 'clear-unchanged', shows: r.clearUnchanged.shows });
  }
  const verified = reasons.length === 0;
  const sent: Sent | undefined =
    typeof cleared === 'number' && cleared > 0 ? { what: typed === 0 && !verified ? 'deletes' : 'characters', n: cleared } : undefined;
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
