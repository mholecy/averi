import { isMaskedValue } from '../ui-tree/masked-value.js';
import { heldText, type ClearPlaceholder, type FillFailure, type LostWhy } from './fill-facts.js';

/**
 * `fill`'s CLEAR as one pure function (2026-10-09, the fill-clear
 * deepening): `clearStep(state, seen) → { state, step }` — what one reading
 * of the field means for the clear, and what to send next. Every rule that
 * compares a reading with the one before the deletes, and every count the
 * clear carries from round to round, lives here and nowhere else: what the
 * field HOLDS (`heldText`: a named placeholder is no content), the
 * unchanged-reading stop and its masked guard (`deletesChangedNothing`),
 * the late re-read, the clear-twice failure and its non-prefix extra round,
 * the placeholder a clear ends on, `cleared` (0 when the FIRST round changed
 * nothing) and the deletes summed over every round. Until that date they
 * were five mutable variables of the loop in interact/fill.ts#fillField,
 * recombined after it, so a rule could be reached only through a
 * monkeypatched `clearText`/`uiTree` on a FakeAdapter and a regex over the
 * reply; three review rounds of the hint-aware clear (probes A–K) were each
 * a diff against those variables.
 *
 * Pure: no adapter, no clock, no I/O, no exceptions but the protocol's own
 * (below). The same shape as scroll_until's round (interact/scroll-rounds.ts)
 * and the same two adapters: the production one, fill.ts#fillField, which
 * reads the field and performs each step; and the test one,
 * tests/interact/fill-clear.test.ts#play, which feeds a table of readings.
 *
 * THE PROTOCOL, which the driver honours and `clearStep` checks:
 * - `startClear(placeholder)`, then `clearStep` with the reading the clear
 *   starts from (the matched node, or the post-focus read of a clear alone:
 *   fillField says which). That first reading is always of a found field.
 * - `delete`: send `count` deletes (clearText), read the field, hand the
 *   reading back. `reread`: wait one poll cadence, read, hand it back —
 *   nothing is sent. A read that did not find the field is `{ lost }`, and
 *   ends the clear.
 * - `done` and `fail` end it: `clearStep` throws on any call after them.
 *   `fail` carries the clear-twice FillFailure the driver throws (its words
 *   are fill-text.ts's).
 *
 * BOUND: at most three delete rounds, each followed by one read and at most
 * one re-read — six readings after the first (a third round's reading that
 * still changed the field fails; one that did not ends the clear). Cost: no I/O; one copy of the state
 * record a call.
 *
 * What it does NOT decide: whether the fill is verified. `done` carries
 * facts (ClearFacts); with a value the exact read-back decides, and alone
 * interact/fill-verdict.ts#judgeFill does — a clear that stopped on an
 * unchanged reading, or ended on a placeholder its last deletes may not
 * have reached, is not verified there.
 */

/** One reading of the field the clear works on: its value, or why the read found no field. */
export type ClearSeen = { value: string | null } | { lost: LostWhy };

/** What the driver does next. */
export type ClearStep =
  | { do: 'delete'; count: number }
  | { do: 'reread' }
  | { do: 'fail'; failure: Extract<FillFailure, { code: 'clear-twice' }> }
  | { do: 'done'; facts: ClearFacts };

/**
 * What the clear MEASURED, for FillResult — facts, never a verdict:
 * - `cleared`: what the first round was SEEN to delete — what the field
 *   held when the clear began, or 0 when it held nothing or that round
 *   changed nothing (review of the hint-aware clear, probe J: "cleared 9
 *   characters first" of an empty hinted field). FillResult.cleared.
 * - `end`, how it stopped:
 *   - `empty`: the last reading holds nothing. `placeholder` is set when
 *     that reading was EXACTLY the named placeholder — `shown`: before any
 *     delete went out; `prefix`: the last deletes went into a reading that
 *     STARTED with the placeholder's text, so what they left may be held
 *     text (deletes go from the end; review round 2, probe K:
 *     `Companyabc` with 3 of 10 landing leaves `Company`); `other`: they
 *     went into one that did not, so it can only be the field showing
 *     empty.
 *   - `unchanged`: a round's deletes left the reading exactly as it was,
 *     read twice a poll cadence apart — an empty field showing its hint, or
 *     one that ignores deletes. `shows` its held length, `deletes` every
 *     delete sent, all rounds. FillResult.clearUnchanged.
 *   - `lost`: a read after deletes did not find the field (review
 *     2026-10-08, m-1): nothing saw it empty.
 */
export interface ClearFacts {
  cleared: number;
  end:
    | { kind: 'empty'; placeholder?: ClearPlaceholder }
    | { kind: 'unchanged'; shows: number; deletes: number }
    | { kind: 'lost'; why: LostWhy };
}

/** The clear between two calls. Built only by `startClear` and `clearStep`. */
export interface ClearState {
  readonly placeholder: string | undefined;
  /** Delete rounds sent so far. */
  readonly rounds: number;
  /** Every delete sent, all rounds. */
  readonly deletes: number;
  /** What the field held when the clear began — `cleared` unless the first round changed nothing. */
  readonly held: number;
  /** The reading the last round's deletes went into. */
  readonly before: string | null;
  /** This round's re-read was asked for: the next reading answers it. */
  readonly waited: boolean;
  /** `done` or `fail` was returned: nothing may follow. */
  readonly over: boolean;
}

/** The clear before its first reading. */
export function startClear(placeholder: string | undefined): ClearState {
  return { placeholder, rounds: 0, deletes: 0, held: 0, before: null, waited: false, over: false };
}

/**
 * One reading → the next step. The rules, in the order they are asked:
 *
 * 1. Before any delete, a reading that holds nothing ends the clear: no
 *    delete at all (a named placeholder is no content, `heldText`).
 * 2. A read that found no field ends it `lost` — not empty: until
 *    2026-10-08 it read as `left = 0`, and a clear alone was "Filled …
 *    (cleared 7 characters first)" on a field the keyboard had moved and
 *    that still held `XX`.
 * 3. An UNCHANGED reading may be a LATE one: synthetic input is droppable
 *    and slow end to end (Compose async state, an IME queue — 3 of 11
 *    characters landed at first, measured 2026-08-05), and one read right
 *    after the deletes turned a clear that worked into "the deletes did not
 *    change it" (review of the hint-aware clear, probe I). So it is read
 *    once more after the poll cadence (`reread`), and only that second
 *    reading is asked again; otherwise the first answer stands. The cost:
 *    one pollMs and one tree read on every clear that ends on an unchanged
 *    reading — every clear of a hinted field whose source names no
 *    placeholder.
 * 4. A reading that holds nothing ends the clear `empty`. Deleted INTO the
 *    named placeholder, it is proof of an empty field only when the reading
 *    before the deletes did not START with the placeholder's text — the
 *    `placeholder` fact says which (ClearFacts); the verdict is judgeFill's.
 * 5. Unchanged (still, after the re-read): stop, `unchanged`. An empty
 *    field showing its hint or placeholder reads exactly so — the stock
 *    Android EditText (API 33 dumps the hint as `text`) and iOS fields
 *    (idb AXValue, WDA value) whose source names no placeholder, measured
 *    2026-10-09 (docs/bugs/2026-10-09-android-clear-reads-edittext-hint-as-
 *    content.md): the loop sent up to twice the hint's length in deletes
 *    into an EMPTY field and threw `field still shows 9 characters after
 *    clearing twice`. A field that IGNORES deletes (read-only, an IME that
 *    drops them) reads exactly the same; the tree cannot tell the two
 *    apart, so the clear stops and leaves the verdict to what follows —
 *    with a value, the exact read-back (a deaf field fails there, after the
 *    value was typed into it twice: the price of this rule); alone,
 *    judgeFill (`clear-unchanged`, not verified). The usual cost on a field
 *    that held text: one round deletes it, the hint appears (a CHANGED
 *    reading), a second round sends the hint's length into the empty field
 *    and finds it unchanged — measured as 1 + 9 deletes on the Contacts
 *    editor. Where the source names the placeholder, rule 4 stops after the
 *    first round.
 * 6. Two rounds that each SHORTENED the field and did not empty it: the
 *    deletes are landing short — the clear-twice failure, as always. A
 *    reading that is not a prefix of the one before the deletes was not
 *    produced by deleting from the end (where clearText deletes from): a
 *    field that held `Probe`, kept `Pro` after a short round, and showed its
 *    hint after the next (probe E). It gets ONE more round, and rule 5
 *    decides; a third round that still changes the field fails.
 * 7. Otherwise: delete what the field still holds.
 */
export function clearStep(state: ClearState, seen: ClearSeen): { state: ClearState; step: ClearStep } {
  if (state.over) throw new Error('clearStep: called after the clear ended');
  const end = (step: ClearStep): { state: ClearState; step: ClearStep } => ({ state: { ...state, over: true }, step });
  const deleteRound = (from: string | null, count: number, held = state.held): { state: ClearState; step: ClearStep } => ({
    state: { ...state, rounds: state.rounds + 1, deletes: state.deletes + count, held, before: from, waited: false },
    step: { do: 'delete', count },
  });
  const { placeholder } = state;

  if (state.rounds === 0) {
    if ('lost' in seen) throw new Error('clearStep: the clear starts from a reading of the field');
    const existing = heldText(seen.value, placeholder).length;
    if (existing === 0) {
      return end({ do: 'done', facts: { cleared: 0, end: { kind: 'empty', ...(placeholder !== undefined && seen.value === placeholder && { placeholder: 'shown' as const }) } } });
    }
    return deleteRound(seen.value, existing, existing);
  }

  if ('lost' in seen) return end({ do: 'done', facts: { cleared: state.held, end: { kind: 'lost', why: seen.lost } } });
  const { before } = state;
  const now = seen.value;
  const unchanged = deletesChangedNothing(before, now, placeholder);
  if (unchanged && !state.waited) return { state: { ...state, waited: true }, step: { do: 'reread' } };

  const left = heldText(now, placeholder).length;
  if (left === 0) {
    const onPlaceholder = placeholder !== undefined && now === placeholder;
    const placeholderEnd = onPlaceholder ? { placeholder: (before ?? '').startsWith(placeholder) ? ('prefix' as const) : ('other' as const) } : {};
    return end({ do: 'done', facts: { cleared: state.held, end: { kind: 'empty', ...placeholderEnd } } });
  }
  if (unchanged) {
    return end({ do: 'done', facts: { cleared: state.rounds === 1 ? 0 : state.held, end: { kind: 'unchanged', shows: left, deletes: state.deletes } } });
  }
  const shortened = (before ?? '').startsWith(now ?? '');
  const attempt = state.rounds - 1;
  if (attempt >= 2 || (attempt >= 1 && shortened)) {
    return end({ do: 'fail', failure: { code: 'clear-twice', left, rounds: state.rounds } });
  }
  return deleteRound(now, left);
}

/**
 * A delete round left the reading exactly as it was, and it is text a hint
 * could be — named for what it tests, not for the hint it may be (review
 * 2026-10-09: it was `isHint`; a field that ignores deletes reads the same,
 * rule 5). BULLETS never are: an unchanged masked reading is a field the
 * deletes did not reach (a focus tap that missed), and stopping there let
 * the typing go nowhere too and a masked read-back — compared by length —
 * pass with the old password still in place (review of the hint-aware
 * clear, probe A: the finportal `invalid_grant` class). Such a field fails
 * as clear-twice, as it always did.
 */
function deletesChangedNothing(before: string | null, after: string | null, placeholder: string | undefined): boolean {
  return heldText(after, placeholder) !== '' && after === before && !isMaskedValue(after ?? '');
}
