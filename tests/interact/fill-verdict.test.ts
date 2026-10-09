import { describe, expect, it } from 'vitest';
import type { Difference, FillResult } from '../../src/interact/fill-facts.js';
import { differenceOf, judgeFill, type FillVerdict, type Mismatch } from '../../src/interact/fill-verdict.js';

/**
 * The judgement is asserted as CODES — `did`, `sent`, `reasons`, `caveats`
 * — never as wording: a wording change touches the sentence tables' block
 * in fill-text.test.ts and nothing else. Every fact shape the old reply
 * tests built by hand (tool-text.test.ts until 2026-10-09) is judged here,
 * including the two fillField never produces (marked), because the
 * invariants must hold over the whole FillResult type, not only the shapes
 * measured today.
 */
const fact = (f: Partial<FillResult> & Pick<FillResult, 'readBack' | 'typed'>): FillResult => ({ role: 'textfield', ...f });
const landed = { kind: 'landed' } as const;
const nothingTyped = { kind: 'nothing-typed' } as const;

describe('judgeFill — what the facts mean', () => {
  it('a landed read-back is filled, with or without a clear that deleted something', () => {
    expect(judgeFill(fact({ typed: 4, readBack: landed }))).toEqual({ did: 'filled', typed: 4, reasons: [], caveats: [] });
    expect(judgeFill(fact({ typed: 4, readBack: landed, cleared: 7 }))).toMatchObject({ did: 'filled', sent: { what: 'characters', n: 7 }, reasons: [] });
  });

  it('a clear that sent no delete has no `sent`: an empty field (0) says nothing, and neither does an unmeasured node that landed', () => {
    expect(judgeFill(fact({ typed: 4, readBack: landed, cleared: 0 }))).toEqual({ did: 'filled', typed: 4, reasons: [], caveats: [] });
    expect(judgeFill(fact({ typed: 4, role: 'other', readBack: landed, cleared: 'unmeasured' }))).toEqual({ did: 'filled', typed: 4, reasons: [], caveats: [] });
  });

  it('a read-back with nothing to compare is typed, never filled — and the clear reason follows the read-back reason', () => {
    expect(judgeFill(fact({ typed: 6, readBack: { kind: 'no-value' }, cleared: 0 }))).toEqual({
      did: 'typed',
      typed: 6,
      reasons: [{ code: 'no-value', role: 'textfield' }, { code: 'clear-no-length' }],
      caveats: [],
    });
    expect(judgeFill(fact({ typed: 22, role: 'text', readBack: { kind: 'no-value' }, cleared: 'unmeasured' })).reasons).toEqual([
      { code: 'no-value', role: 'text' },
      { code: 'clear-unmeasured', role: 'text' },
    ]);
    expect(judgeFill(fact({ typed: 1, role: 'text', readBack: { kind: 'not-taken' } }))).toMatchObject({
      did: 'typed',
      reasons: [{ code: 'not-taken', role: 'text' }],
    });
  });

  it('clear-no-length only on a no-value read-back: a lost field that held nothing is not blamed for giving no length', () => {
    expect(judgeFill(fact({ typed: 3, readBack: { kind: 'lost', why: 'unmatched' }, cleared: 0 })).reasons).toEqual([{ code: 'lost', why: 'unmatched' }]);
  });

  it('a lost read-back carries its why; with something typed, a clear that deleted is still counted in characters', () => {
    expect(judgeFill(fact({ typed: 22, readBack: { kind: 'lost', why: 'screen-changed' }, cleared: 7 }))).toEqual({
      did: 'typed',
      typed: 22,
      sent: { what: 'characters', n: 7 },
      reasons: [{ code: 'lost', why: 'screen-changed' }],
      caveats: [],
    });
  });

  it('a clear ALONE: verified keeps `filled` and characters; lost after a delete is `cleared` in deletes; no delete is `focused`', () => {
    expect(judgeFill(fact({ typed: 0, readBack: nothingTyped, cleared: 4 }))).toMatchObject({ did: 'filled', sent: { what: 'characters', n: 4 } });
    expect(judgeFill(fact({ typed: 0, readBack: { kind: 'lost', why: 'unmatched' }, cleared: 7 }))).toMatchObject({
      did: 'cleared',
      sent: { what: 'deletes', n: 7 },
      reasons: [{ code: 'lost', why: 'unmatched' }],
    });
    expect(judgeFill(fact({ typed: 0, role: 'text', readBack: nothingTyped, cleared: 'unmeasured' }))).toEqual({
      did: 'focused',
      typed: 0,
      reasons: [{ code: 'clear-unmeasured', role: 'text' }],
      caveats: [],
    });
    // Not produced by fillField (a lost clear has deleted), judged all the same.
    expect(judgeFill(fact({ typed: 0, readBack: { kind: 'lost', why: 'unmatched' }, cleared: 0 }))).toMatchObject({ did: 'focused', reasons: [{ code: 'lost' }] });
  });

  // The one judgement that changed on 2026-10-09: an unverified fill with
  // nothing typed and NO clear asked read `Typed 0 characters into …` (the
  // reply's fall-through). fillField cannot produce it — without clear an
  // empty value is always `nothing-typed`, which is verified — and a fill
  // that typed nothing is not "typed" whatever the facts: it is `focused`.
  it('nothing typed, no clear, unverified (not produced by fillField) is focused, never typed', () => {
    expect(judgeFill(fact({ typed: 0, readBack: { kind: 'lost', why: 'unmatched' } }))).toMatchObject({ did: 'focused' });
    expect(judgeFill(fact({ typed: 0, readBack: { kind: 'no-value' } }))).toMatchObject({ did: 'focused', reasons: [{ code: 'no-value' }] });
  });

  it('caveats: the not-an-input finding first (typed or not), then the masked-append warning; the note rides along', () => {
    const input = { identifier: 'TextFieldWithComponentStyle', rect: { x: 26, y: 343, width: 350, height: 56 }, overlaps: true };
    expect(judgeFill(fact({ typed: 22, role: 'text', readBack: { kind: 'no-value' }, notInput: { input } })).caveats).toEqual([
      { code: 'not-input', role: 'text', typed: true, input },
    ]);
    expect(judgeFill(fact({ typed: 0, role: 'text', readBack: nothingTyped, notInput: { input: 'unread' } }))).toMatchObject({
      did: 'filled',
      caveats: [{ code: 'not-input', role: 'text', typed: false, input: 'unread' }],
    });
    expect(judgeFill(fact({ typed: 16, readBack: landed, maskedAppend: { held: 20 }, note: 'a note' }))).toMatchObject({
      did: 'filled',
      caveats: [{ code: 'masked-append', held: 20 }],
      note: 'a note',
    });
    // Both at once — not produced by fillField; the order is still fixed.
    expect(
      judgeFill(fact({ typed: 1, role: 'text', readBack: { kind: 'not-taken' }, notInput: { input: 'none' }, maskedAppend: { held: 2 } })).caveats.map((c) => c.code),
    ).toEqual(['not-input', 'masked-append']);
  });

  // docs/bugs/2026-10-09-android-clear-reads-edittext-hint-as-content.md: the
  // clear stopped on deletes that changed nothing — a hint, or a deaf field.
  it('clear-unchanged: a reason only when the read-back did not land; a clear alone is then `cleared` in deletes', () => {
    const stuck = { clearUnchanged: { shows: 9, deletes: 9 } };
    // The first round was the unchanged one: nothing seen deleted (cleared 0), 9 deletes sent.
    expect(judgeFill(fact({ typed: 0, readBack: nothingTyped, cleared: 0, ...stuck }))).toEqual({
      did: 'cleared',
      typed: 0,
      sent: { what: 'deletes', n: 9 },
      reasons: [{ code: 'clear-unchanged', shows: 9 }],
      caveats: [],
    });
    // With a value whose exact read-back landed, the field shows the value: the clear did its job.
    expect(judgeFill(fact({ typed: 5, readBack: landed, cleared: 1, ...stuck }))).toMatchObject({ did: 'filled', sent: { what: 'characters', n: 1 }, reasons: [] });
    // Probe J (review of this branch): the unchanged round was the first, so no characters are claimed of a verified fill.
    expect(judgeFill(fact({ typed: 5, readBack: landed, cleared: 0, ...stuck }))).toEqual({ did: 'filled', typed: 5, reasons: [], caveats: [] });
    // A clear alone over several rounds counts every delete sent, not the first round's.
    expect(judgeFill(fact({ typed: 0, readBack: nothingTyped, cleared: 5, clearUnchanged: { shows: 9, deletes: 14 } })).sent).toEqual({ what: 'deletes', n: 14 });
    // An unchanged clear on a no-value read-back is not "gave no length": it gave one, and deleted it.
    expect(judgeFill(fact({ typed: 5, readBack: { kind: 'no-value' }, cleared: 0, ...stuck })).reasons.map((r) => r.code)).toEqual(['no-value', 'clear-unchanged']);
    // After the read-back's own reason, as the other clear reasons.
    expect(judgeFill(fact({ typed: 5, readBack: { kind: 'lost', why: 'unmatched' }, cleared: 1, ...stuck })).reasons).toEqual([
      { code: 'lost', why: 'unmatched' },
      { code: 'clear-unchanged', shows: 9 },
    ]);
  });

  // What `sent` says, case by case — expected values, not the formula
  // (review round 2: the loop below once restated judgeFill's own rule).
  it('sent: characters seen deleted of a fill that typed or was verified; every delete sent of an unverified clear alone; nothing else', () => {
    const lost = { kind: 'lost', why: 'unmatched' } as const;
    const stuck = { shows: 9, deletes: 12 };
    const rows: [Partial<FillResult> & Pick<FillResult, 'readBack' | 'typed'>, FillVerdict['sent']][] = [
      [{ typed: 4, readBack: landed }, undefined],
      [{ typed: 4, readBack: landed, cleared: 0 }, undefined],
      [{ typed: 4, readBack: landed, cleared: 3 }, { what: 'characters', n: 3 }],
      [{ typed: 4, readBack: landed, cleared: 0, clearUnchanged: stuck }, undefined],
      [{ typed: 4, readBack: lost, cleared: 3, clearUnchanged: stuck }, { what: 'characters', n: 3 }],
      [{ typed: 4, readBack: lost, cleared: 0, clearUnchanged: stuck }, undefined],
      [{ typed: 0, readBack: nothingTyped, cleared: 3 }, { what: 'characters', n: 3 }],
      [{ typed: 0, readBack: lost, cleared: 3 }, { what: 'deletes', n: 3 }],
      [{ typed: 0, readBack: nothingTyped, cleared: 0, clearUnchanged: stuck }, { what: 'deletes', n: 12 }],
      [{ typed: 0, readBack: nothingTyped, cleared: 3, clearUnchanged: stuck }, { what: 'deletes', n: 12 }],
      [{ typed: 0, readBack: { kind: 'placeholder' }, cleared: 0 }, undefined],
      [{ typed: 0, readBack: { kind: 'placeholder' }, cleared: 10 }, { what: 'deletes', n: 10 }],
      [{ typed: 0, readBack: nothingTyped, cleared: 'unmeasured' }, undefined],
    ];
    for (const [f, sent] of rows) expect([f, judgeFill(fact(f)).sent]).toEqual([f, sent]);
  });

  // Review of the hint-aware clear, probes C and K: a clear alone that ended
  // on its named placeholder without seeing the field empty. fill.ts reports
  // the fact (clearPlaceholder); the judgement is here since 2026-10-09.
  it('clearPlaceholder: `shown` and `prefix` make a clear alone NOT verified (placeholder); `other`, or anything typed, does not', () => {
    const rows: [Partial<FillResult> & Pick<FillResult, 'readBack' | 'typed'>, Pick<FillVerdict, 'did' | 'sent' | 'reasons'>][] = [
      // C: the field read its placeholder before any delete — nothing sent.
      [{ typed: 0, readBack: nothingTyped, cleared: 0, clearPlaceholder: 'shown' }, { did: 'focused', sent: undefined, reasons: [{ code: 'placeholder' }] }],
      // K: the deletes went into `Companyabc` and left `Company`.
      [{ typed: 0, readBack: nothingTyped, cleared: 10, clearPlaceholder: 'prefix' }, { did: 'cleared', sent: { what: 'deletes', n: 10 }, reasons: [{ code: 'placeholder' }] }],
      // Deleted INTO the placeholder from `Zed`: seen empty.
      [{ typed: 0, readBack: nothingTyped, cleared: 3, clearPlaceholder: 'other' }, { did: 'filled', sent: { what: 'characters', n: 3 }, reasons: [] }],
      // With a value the exact read-back decides, whatever the clear ended on.
      [{ typed: 4, readBack: landed, cleared: 10, clearPlaceholder: 'prefix' }, { did: 'filled', sent: { what: 'characters', n: 10 }, reasons: [] }],
      [{ typed: 0, readBack: { kind: 'lost', why: 'unmatched' }, cleared: 0, clearPlaceholder: 'shown' }, { did: 'focused', sent: undefined, reasons: [{ code: 'lost', why: 'unmatched' }] }],
    ];
    for (const [f, v] of rows) expect([f, judgeFill(fact(f))]).toMatchObject([f, v]);
  });

  it('the invariants hold over every read-back, clear and length combination', () => {
    const readBacks: FillResult['readBack'][] = [landed, { kind: 'no-value' }, { kind: 'not-taken' }, { kind: 'lost', why: 'unmatched' }, nothingTyped, { kind: 'placeholder' }];
    const clears: FillResult['cleared'][] = [undefined, 0, 3, 'unmeasured'];
    for (const readBack of readBacks)
      for (const cleared of clears)
        for (const typed of [0, 1, 5])
          for (const clearUnchanged of typeof cleared === 'number' ? [undefined, { shows: 9, deletes: 12 }] : [undefined]) {
            const v = judgeFill(fact({ typed, readBack, cleared, clearUnchanged }));
            expect(v.did === 'filled').toBe(v.reasons.length === 0);
            if (v.did !== 'filled') expect(v.did === 'typed').toBe(typed > 0);
            if (v.did !== 'filled' && typed === 0) expect(v.did === 'cleared').toBe(v.sent !== undefined);
            if (v.sent !== undefined) expect(v.sent.what === 'deletes').toBe(v.did === 'cleared');
            if (readBack.kind === 'landed') expect(v.reasons).toEqual([]);
            expect(v.reasons.filter((r) => r.code.startsWith('clear-')).length).toBeLessThanOrEqual(1);
            if (clearUnchanged !== undefined && readBack.kind !== 'landed') expect(v.reasons.at(-1)).toEqual({ code: 'clear-unchanged', shows: 9 });
          }
  });
});

/**
 * The mismatch's classification, as `Difference` codes — the wording is
 * fill-text.test.ts's, and fill.test.ts pins a few end to end. One row per
 * rule of differenceOf, in its order, each row naming the shape it stands
 * for; `before` defaults to null (nothing shown when typing began), `clear`
 * to false.
 */
describe('differenceOf — what a missed read-back differs by, without content', () => {
  const m = (f: Partial<Mismatch> & Pick<Mismatch, 'observed' | 'value'>): Mismatch => ({ before: null, clear: false, maskedHeld: 0, placeholder: undefined, ...f });
  const rows: [string, Partial<Mismatch> & Pick<Mismatch, 'observed' | 'value'>, Difference][] = [
    // 1. unchanged — first, whatever the reading is
    ['typing dropped on held text (D2: it matches but for case)', { observed: 'Hello', before: 'Hello', value: 'hello' }, { kind: 'unchanged' }],
    ['typing dropped on a field showing only its placeholder (D)', { observed: 'Search', before: 'Search', value: 'search', placeholder: 'Search' }, { kind: 'unchanged' }],
    ['typing dropped on held bullets: unchanged, not masked', { observed: '••••', before: '••••', value: 'abcdef' }, { kind: 'unchanged' }],
    // 2. masked
    ['bullets, no clear: the held count rides along', { observed: '•••••', value: '123456', maskedHeld: 0 }, { kind: 'masked', held: 0 }],
    ['bullets onto held bullets, no clear', { observed: '•'.repeat(32), before: '•'.repeat(20), value: 'x'.repeat(16), maskedHeld: 20 }, { kind: 'masked', held: 20 }],
    ['bullets with clear: no held count (the clear emptied it)', { observed: '•••••', value: 'secret', clear: true, maskedHeld: 4 }, { kind: 'masked', held: undefined }],
    // 3. partly masked
    ['show-the-last-character (`•••••t`): lengths only', { observed: '•••••t', value: 'secret' }, { kind: 'length' }],
    // 4. held text compared
    ['auto-capitalised, no clear', { observed: 'Hello', value: 'hello' }, { kind: 'case', positions: 1 }],
    ['auto-capitalised, with clear', { observed: 'Hello world', value: 'hello world', clear: true }, { kind: 'case', positions: 1 }],
    ['no clear onto held text: only the run after it is compared', { observed: 'NOTE: HI THERE', before: 'Note: ', value: 'hi there' }, { kind: 'case', positions: 7 }],
    ['no clear: of several runs that match but for case, the closest counts — not the first', { observed: 'HELLO Hello', value: 'hello' }, { kind: 'case', positions: 1 }],
    ['no clear, the held text changed too: compared whole, closest run', { observed: 'NOTE: HI THERE', before: 'xyz', value: 'hi there' }, { kind: 'case', positions: 7 }],
    ['with clear the field must EQUAL the value: longer but for case is a length', { observed: 'Re: Hello', value: 'hello', clear: true }, { kind: 'length' }],
    ['autocorrect `teh` → `the`: same length, how many differ', { observed: 'the', value: 'teh' }, { kind: 'same-length', positions: 2 }],
    ['held `HELLo` is not the typing: only `hxllo` after it is compared', { observed: 'HELLohxllo', before: 'HELLo', value: 'hello' }, { kind: 'same-length', positions: 1 }],
    ['a mask that inserts a space', { observed: '1234 5', value: '12345' }, { kind: 'length' }],
    ['a field that fell back to its named placeholder holds no text: never "but for case"', { observed: 'Company', before: 'Zed', value: 'company', placeholder: 'Company' }, { kind: 'length' }],
    ['a pair equal only upper-cased (dotless `ı`, `i`) is case too', { observed: 'ıd', value: 'id', clear: true }, { kind: 'case', positions: 1 }],
    ['`ß`/`SS` differ in length: a plain difference, never case', { observed: 'SS', value: 'ß', clear: true }, { kind: 'length' }],
  ];
  for (const [shape, f, kind] of rows) it(shape, () => expect(differenceOf(m(f))).toEqual(kind));
});
