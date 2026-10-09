import { describe, expect, it } from 'vitest';
import { clearStep, startClear, type ClearFacts, type ClearSeen, type ClearStep } from '../../src/interact/fill-clear.js';
import type { FillFailure } from '../../src/interact/fill-facts.js';

/**
 * The TEST adapter of interact/fill-clear.ts#clearStep (the production one
 * is the clear loop of interact/fill.ts#fillField): `play` feeds a table of
 * readings and returns what the clear did — no fake device, no clock. Row
 * 0 is the reading the clear starts from; every later row is what the read
 * after the previous step saw (`LOST` for a read that found no field).
 * `trace` is the steps that went to the device, in order: `delete N` (N
 * deletes sent, then a read) or `reread` (one poll cadence, then a read).
 * Throws when the rows run out before the clear ends, or outlast it — a
 * table with rows nobody reads is a wrong table.
 */
const LOST = { lost: 'unmatched' } as const;
type Row = string | null | { lost: 'unmatched' | 'screen-changed' };

interface Played {
  trace: string[];
  facts?: ClearFacts;
  failure?: Extract<FillFailure, { code: 'clear-twice' }>;
}

function play(rows: readonly Row[], placeholder?: string): Played {
  const seen = (row: Row): ClearSeen => (row !== null && typeof row === 'object' ? row : { value: row });
  const trace: string[] = [];
  let next = clearStep(startClear(placeholder), seen(rows[0]));
  let i = 1;
  const on = (step: ClearStep): step is Extract<ClearStep, { do: 'delete' | 'reread' }> => step.do === 'delete' || step.do === 'reread';
  while (on(next.step)) {
    trace.push(next.step.do === 'delete' ? `delete ${next.step.count}` : 'reread');
    if (i >= rows.length) throw new Error(`play: the clear asked for row ${i}, the table has ${rows.length}`);
    next = clearStep(next.state, seen(rows[i++]));
  }
  if (i !== rows.length) throw new Error(`play: the clear ended at row ${i - 1} of ${rows.length}`);
  return next.step.do === 'done' ? { trace, facts: next.step.facts } : { trace, failure: next.step.failure };
}

const HINT = 'Last name'; // the Contacts editor's hint, 9 characters (the bug note's measured shape)

describe('clearStep — what one reading means for the clear', () => {
  it('a field that holds nothing gets no delete: no value, or exactly its named placeholder (shown before any delete)', () => {
    expect(play([null])).toEqual({ trace: [], facts: { cleared: 0, end: { kind: 'empty' } } });
    expect(play(['Company'], 'Company')).toEqual({ trace: [], facts: { cleared: 0, end: { kind: 'empty', placeholder: 'shown' } } });
    // No reading is not the placeholder: empty, and no placeholder fact.
    expect(play([null], 'Company')).toEqual({ trace: [], facts: { cleared: 0, end: { kind: 'empty' } } });
    // The placeholder names the field's own hint only: other text is content.
    expect(play(['Company', null], 'Search').trace).toEqual(['delete 7']);
  });

  it('one round that empties the field: cleared is what it held; no placeholder fact unless the reading IS the placeholder', () => {
    expect(play(['2.50', null])).toEqual({ trace: ['delete 4'], facts: { cleared: 4, end: { kind: 'empty' } } });
    expect(play(['2.50', null], 'Amount')).toEqual({ trace: ['delete 4'], facts: { cleared: 4, end: { kind: 'empty' } } });
  });

  // Review round 2, probe K: deletes go from the end, so what they leave is
  // a prefix of what was there.
  it('deleted INTO the named placeholder: `other` from a reading that did not start with it, `prefix` from one that did (K)', () => {
    expect(play(['Zed', 'Company'], 'Company')).toEqual({ trace: ['delete 3'], facts: { cleared: 3, end: { kind: 'empty', placeholder: 'other' } } });
    // STARTS with, not contains: `ZCompany` cut to `Company` is not a prefix left behind.
    expect(play(['ZCompany', 'Company'], 'Company')).toEqual({ trace: ['delete 8'], facts: { cleared: 8, end: { kind: 'empty', placeholder: 'other' } } });
    expect(play(['Companyabc', 'Company'], 'Company')).toEqual({ trace: ['delete 10'], facts: { cleared: 10, end: { kind: 'empty', placeholder: 'prefix' } } });
  });

  it('a dropped round is re-cleared with what the field still holds; cleared stays what it held when the clear BEGAN', () => {
    expect(play(['2.50', '2.', null])).toEqual({ trace: ['delete 4', 'delete 2'], facts: { cleared: 4, end: { kind: 'empty' } } });
  });

  it('two rounds that each shorten the field without emptying it: clear-twice, with what is left (1 is said singular downstream)', () => {
    expect(play(['2.50', '2.5', '2.'])).toEqual({ trace: ['delete 4', 'delete 3'], failure: { code: 'clear-twice', left: 2, rounds: 2 } });
    expect(play(['xyz', 'xy', 'x'])).toEqual({ trace: ['delete 3', 'delete 2'], failure: { code: 'clear-twice', left: 1, rounds: 2 } });
  });

  // Probe I: one read right after the deletes turned a clear that worked
  // into "the deletes did not change it".
  it('an unchanged reading is read once more after the poll cadence before it is believed (I)', () => {
    expect(play(['abc', 'abc', null])).toEqual({ trace: ['delete 3', 'reread'], facts: { cleared: 3, end: { kind: 'empty' } } });
    // The late reading shortened the field: the round goes on from it, no second re-read of the same round.
    expect(play(['abc', 'abc', 'ab', null])).toEqual({ trace: ['delete 3', 'reread', 'delete 2'], facts: { cleared: 3, end: { kind: 'empty' } } });
    // The late reading is the named placeholder, from a reading that did not start with it: seen empty.
    expect(play(['abc', 'abc', 'Company'], 'Company')).toEqual({ trace: ['delete 3', 'reread'], facts: { cleared: 3, end: { kind: 'empty', placeholder: 'other' } } });
  });

  // docs/bugs/2026-10-09-android-clear-reads-edittext-hint-as-content.md
  it('unchanged after the re-read stops the clear: the FIRST round changed nothing, so nothing is claimed deleted (J); the deletes are counted apart', () => {
    expect(play([HINT, HINT, HINT])).toEqual({ trace: ['delete 9', 'reread'], facts: { cleared: 0, end: { kind: 'unchanged', shows: 9, deletes: 9 } } });
  });

  it('a later unchanged round keeps the first round\'s count, and its deletes add every round\'s', () => {
    expect(play(['Q', HINT, HINT, HINT])).toEqual({ trace: ['delete 1', 'delete 9', 'reread'], facts: { cleared: 1, end: { kind: 'unchanged', shows: 9, deletes: 10 } } });
    expect(play(['Probe', HINT, HINT, HINT])).toEqual({ trace: ['delete 5', 'delete 9', 'reread'], facts: { cleared: 5, end: { kind: 'unchanged', shows: 9, deletes: 14 } } });
  });

  // Probe A: stopping on unchanged bullets let a masked read-back pass with the old password in place.
  it('an unchanged MASKED reading is no hint: no re-read, no stop — clear-twice, as always (A)', () => {
    const pw = '••••••••';
    expect(play([pw, pw, pw])).toEqual({ trace: ['delete 8', 'delete 8'], failure: { code: 'clear-twice', left: 8, rounds: 2 } });
  });

  // Probe E: a field that held `Probe!`, kept `Pro` after a short round, and showed its hint after the next.
  it('a reading that is not a prefix of the one before earns ONE more round, and the unchanged rule decides (E)', () => {
    expect(play(['Probe!', 'Pro', HINT, HINT, HINT])).toEqual({
      trace: ['delete 6', 'delete 3', 'delete 9', 'reread'],
      facts: { cleared: 6, end: { kind: 'unchanged', shows: 9, deletes: 18 } },
    });
  });

  it('a third round that still changes the field without emptying it fails, and says three rounds', () => {
    expect(play(['abc', 'Hint A', 'Hint B', 'Hint C'])).toEqual({ trace: ['delete 3', 'delete 6', 'delete 6'], failure: { code: 'clear-twice', left: 6, rounds: 3 } });
  });

  // m-1 (review 2026-10-08): not found is not empty.
  it('a read that finds no field ends the clear `lost`, after a delete or after the re-read — never empty', () => {
    expect(play(['XX12345', LOST])).toEqual({ trace: ['delete 7'], facts: { cleared: 7, end: { kind: 'lost', why: 'unmatched' } } });
    expect(play(['abc', 'abc', { lost: 'screen-changed' }])).toEqual({ trace: ['delete 3', 'reread'], facts: { cleared: 3, end: { kind: 'lost', why: 'screen-changed' } } });
  });

  it('the protocol: the clear starts from a found field, and nothing follows its end', () => {
    expect(() => clearStep(startClear(undefined), LOST)).toThrow(/starts from a reading/);
    const done = clearStep(startClear(undefined), { value: null });
    expect(done.step.do).toBe('done');
    expect(() => clearStep(done.state, { value: null })).toThrow(/after the clear ended/);
  });
});
