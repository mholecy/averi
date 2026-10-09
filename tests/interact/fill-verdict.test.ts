import { describe, expect, it } from 'vitest';
import type { FillResult } from '../../src/interact/fill.js';
import { charactersText } from '../../src/util/count.js';
import { caveatText, judgeFill, wordingOf, type Caveat, type FillVerdict, type Reason } from '../../src/interact/fill-verdict.js';

/**
 * The judgement is asserted as CODES — `did`, `sent`, `reasons`, `caveats`
 * — never as wording: a wording change touches the sentence tables' block
 * below and nothing else. Every fact shape the old reply tests built by
 * hand (tool-text.test.ts until 2026-10-09) is judged here, including the
 * two fillField never produces (marked), because the invariants must hold
 * over the whole FillResult type, not only the shapes measured today.
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

/**
 * Every row of the three sentence tables, byte for byte — the wording of
 * the MCP reply and the flow line alike (their layout is pinned in
 * fill-text.test.ts). Built from literal verdicts: the tables are total over
 * the codes, so each code is one case.
 */
describe('wordingOf — every sentence', () => {
  const verdict = (v: Partial<FillVerdict>): FillVerdict => ({ did: 'typed', typed: 3, reasons: [], caveats: [], ...v });
  const unverified = (...reasons: Reason[]) => wordingOf(verdict({ reasons })).unverified;

  it('the reasons, joined in order under one `NOT verified:`; none is undefined', () => {
    expect(unverified()).toBeUndefined();
    expect(unverified({ code: 'no-value', role: 'textfield' })).toBe('NOT verified: the matched node exposes no value (role textfield)');
    expect(unverified({ code: 'not-taken', role: 'text' })).toBe(
      "NOT verified: the matched node's value does not show the typed text (role text) — it is not the field",
    );
    expect(unverified({ code: 'lost', why: 'unmatched' })).toBe('NOT verified: the field could not be found again (the selector no longer matches it)');
    expect(unverified({ code: 'lost', why: 'screen-changed' })).toBe('NOT verified: the field could not be found again (the screen changed while typing)');
    expect(unverified({ code: 'no-value', role: 'text' }, { code: 'clear-unmeasured', role: 'text' })).toBe(
      "NOT verified: the matched node exposes no value (role text); clear sent no delete — a role text node's length is not the field's",
    );
    expect(unverified({ code: 'no-value', role: 'textfield' }, { code: 'clear-no-length' })).toBe(
      'NOT verified: the matched node exposes no value (role textfield); clear sent no delete — the node gave no length to delete',
    );
  });

  it('what was sent, and the typed length — singular for one', () => {
    expect(wordingOf(verdict({ sent: { what: 'characters', n: 7 } })).sent).toBe('cleared 7 characters first');
    expect(wordingOf(verdict({ sent: { what: 'characters', n: 1 } })).sent).toBe('cleared 1 character first');
    expect(wordingOf(verdict({ sent: { what: 'deletes', n: 7 } })).sent).toBe('7 deletes sent');
    expect(wordingOf(verdict({ sent: { what: 'deletes', n: 1 } })).sent).toBe('1 delete sent');
    expect(wordingOf(verdict({})).sent).toBeUndefined();
    expect([0, 1, 2].map((typed) => wordingOf(verdict({ typed })).typed)).toEqual(['0 characters', '1 character', '2 characters']);
    expect([0, 1, 2].map(charactersText)).toEqual(['0 characters', '1 character', '2 characters']);
  });

  it('the caveats: the three not-an-input inputs, typed or not, and the masked append', () => {
    const notInput = (input: Extract<Caveat, { code: 'not-input' }>['input'], typed = true) => caveatText({ code: 'not-input', role: 'text', typed, input });
    expect(notInput({ identifier: 'TextFieldWithComponentStyle', rect: { x: 26, y: 343, width: 350, height: 56 }, overlaps: true })).toBe(
      'the matched node is role text, not a textfield — typing goes wherever the focus tap left the focus; ' +
        'the input overlapping it is textfield id:"TextFieldWithComponentStyle" at 26,343 350x56 — ' +
        'select the input itself (role:textfield with its id:, or its current value: when inputs share an id)',
    );
    expect(notInput({ identifier: null, rect: { x: 0, y: 20, width: 100, height: 10 }, overlaps: false })).toBe(
      'the matched node is role text, not a textfield — typing goes wherever the focus tap left the focus; ' +
        'the nearest input is textfield at 0,20 100x10 — select the input itself (role:textfield with its id:, or its current value: when inputs share an id)',
    );
    expect(notInput('none')).toBe('the matched node is role text, not a textfield — typing goes wherever the focus tap left the focus; no textfield is on the screen');
    expect(notInput('unread', false)).toBe(
      'the matched node is role text, not a textfield — nothing was deleted, and the focus is wherever the tap left it; the screen could not be read again to name the input',
    );
    expect(caveatText({ code: 'masked-append', held: 20 })).toBe(
      'masked field already held 20 characters and clear is not set — typing APPENDS; pass clear: true to replace',
    );
    expect(caveatText({ code: 'masked-append', held: 1 })).toBe('masked field already held 1 character and clear is not set — typing APPENDS; pass clear: true to replace');
    expect(wordingOf(verdict({ caveats: [{ code: 'not-input', role: 'text', typed: true, input: 'none' }, { code: 'masked-append', held: 2 }] })).caveats).toEqual([
      notInput('none'),
      'masked field already held 2 characters and clear is not set — typing APPENDS; pass clear: true to replace',
    ]);
  });
});
