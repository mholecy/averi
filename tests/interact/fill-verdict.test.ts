import { describe, expect, it } from 'vitest';
import type { FillResult } from '../../src/interact/fill-facts.js';
import { judgeFill } from '../../src/interact/fill-verdict.js';

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

  it('the invariants hold over every read-back, clear and length combination', () => {
    const readBacks: FillResult['readBack'][] = [landed, { kind: 'no-value' }, { kind: 'not-taken' }, { kind: 'lost', why: 'unmatched' }, nothingTyped];
    const clears: FillResult['cleared'][] = [undefined, 0, 3, 'unmeasured'];
    for (const readBack of readBacks)
      for (const cleared of clears)
        for (const typed of [0, 1, 5]) {
          const v = judgeFill(fact({ typed, readBack, cleared }));
          expect(v.did === 'filled').toBe(v.reasons.length === 0);
          if (v.did !== 'filled') expect(v.did === 'typed').toBe(typed > 0);
          if (v.did !== 'filled' && typed === 0) expect(v.did === 'cleared').toBe(v.sent !== undefined);
          expect(v.sent !== undefined).toBe(typeof cleared === 'number' && cleared > 0);
          if (v.sent !== undefined) expect(v.sent.what === 'deletes').toBe(v.did === 'cleared');
          if (readBack.kind === 'landed') expect(v.reasons).toEqual([]);
        }
  });
});
