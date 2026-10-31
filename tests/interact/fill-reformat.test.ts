import { describe, expect, it } from 'vitest';
import { landedSome, prefixOf, reformatOf, tailOf } from '../../src/interact/fill-reformat.js';

/**
 * D18: a field that reformats as it is typed (an IBAN grouped in fours, an amount's thousands) shows every typed
 * character, in order, with separators of its own between them — measured on the lab's Compose, React Native and
 * VisualTransformation fields (docs/adr/0034-a-fill-passes-a-field-that-reformats-as-it-is-typed.md). Tight: a field
 * that dropped, reordered or changed a character never passes, nor an added separator that is no grouping (review
 * round 1, MAJOR-1: every pair the reviewer found is pinned below).
 */
describe('reformatOf — the typed characters in order, one separator added between groups', () => {
  it('an IBAN grouped in fours, an amount grouped by thousands (a no-break space), a date and a phone', () => {
    expect(reformatOf('SK31 1200 0000', 'SK3112000000')).toEqual({ added: 2, respaced: 0 });
    expect(reformatOf('SK31 1200 0000 1', 'SK31120000001')).toEqual({ added: 3, respaced: 0 }); // a last group of one
    expect(reformatOf('1\u00A0234\u00A0567,89', '1234567,89')).toEqual({ added: 2, respaced: 0 });
    expect(reformatOf('1\u202F234', '1234')).toEqual({ added: 1, respaced: 0 }); // a first group of one
    expect(reformatOf('31/12/2026', '31122026')).toEqual({ added: 2, respaced: 0 });
    expect(reformatOf('0905-123-456', '0905123456')).toEqual({ added: 2, respaced: 0 });
  });

  it('an added `.` or `,` thousands separator passes, marked as a point (the verdict\'s caveat)', () => {
    expect(reformatOf('1,234,567.89', '1234567.89')).toEqual({ added: 2, respaced: 0, point: ',' });
    expect(reformatOf('1.234,56', '1234,56')).toEqual({ added: 1, respaced: 0, point: '.' });
    expect(reformatOf('1.234', '1234')).toEqual({ added: 1, respaced: 0, point: '.' }); // de-DE, or a 3-decimal mask
    expect(reformatOf('12.345.678', '12345678')).toEqual({ added: 2, respaced: 0, point: '.' });
  });

  it('a typed space shown as a no-break space is respaced, not added', () => {
    expect(reformatOf('1\u00A0234', '1 234')).toEqual({ added: 0, respaced: 1 });
  });

  it('exactly the typed text is no reformat (the exact rule passes it): a Reformat always counts a change', () => {
    expect(reformatOf('SK31 1200', 'SK31 1200')).toBeUndefined();
    expect(reformatOf('', '')).toBeUndefined();
  });

  it('a dropped, reordered, changed or added character never passes', () => {
    expect(reformatOf('SK31 1200 000', 'SK3112000000')).toBeUndefined(); // dropped
    expect(reformatOf('SK13 1200 0000', 'SK3112000000')).toBeUndefined(); // reordered
    expect(reformatOf('sk31 1200 0000', 'SK3112000000')).toBeUndefined(); // case changed
    expect(reformatOf('SK31 1200 0000 0', 'SK3112000000')).toBeUndefined(); // a character added
    expect(reformatOf('1 234 €', '1234')).toBeUndefined(); // a currency the field adds is no separator
    expect(reformatOf('0,25', '25')).toBeUndefined(); // nor a leading zero
  });

  it('a typed separator the field dropped never passes: `12,50` shown `1250` is another amount', () => {
    expect(reformatOf('1250', '12,50')).toBeUndefined();
    expect(reformatOf('SK311200', 'SK31 1200')).toBeUndefined();
    expect(reformatOf('12 50', '12,50')).toBeUndefined(); // changed, not added
  });

  it('a separator leading, trailing, next to another, or after typed punctuation is no grouping — free text included', () => {
    expect(reformatOf('-5', '5')).toBeUndefined(); // a sign
    expect(reformatOf(' 5', '5')).toBeUndefined();
    expect(reformatOf('1234-', '1234')).toBeUndefined();
    expect(reformatOf('SK31 ', 'SK31')).toBeUndefined(); // an eager trailing group mark: a false mismatch, the safe side
    expect(reformatOf('31/', '31')).toBeUndefined();
    expect(reformatOf('1 - - 2', '12')).toBeUndefined();
    expect(reformatOf('Hello, world', 'Hello,world')).toBeUndefined();
    expect(reformatOf('1. 5', '1.5')).toBeUndefined();
    expect(reformatOf('end. Start', 'end.Start')).toBeUndefined();
  });

  // Round 2, MAJOR-A: autocorrect splitting a word reads as a separator between two letters.
  it('a separator between two letters passes only in a code (digits, no typed space): an IBAN, never prose', () => {
    expect(reformatOf('a lot', 'alot')).toBeUndefined();
    expect(reformatOf('in fact is', 'infact is')).toBeUndefined();
    expect(reformatOf('john doe', 'johndoe')).toBeUndefined();
    expect(reformatOf('jo-hn@x.com', 'john@x.com')).toBeUndefined();
    expect(reformatOf('in fact 2', 'infact 2')).toBeUndefined(); // digits, but a typed space: prose
    expect(reformatOf('Flat A 12', 'Flat A12')).toEqual({ added: 1, respaced: 0 }); // a letter and a digit: no word split
    expect(reformatOf('MT84 MALT 0110 0001 2345 MTLC AST0 01S', 'MT84MALT011000012345MTLCAST001S')).toEqual({ added: 7, respaced: 0 });
    expect(reformatOf('GB29 NWBK 6016 1331 9268 19', 'GB29NWBK60161331926819')).toEqual({ added: 5, respaced: 0 });
    expect(reformatOf('FR14 2004 1010 0505 0001 3M02 606', 'FR1420041010050500013M02606')).toEqual({ added: 6, respaced: 0 });
    expect(reformatOf('LC55 HEMM 0001 0001 0012 0001 2', 'LC55HEMM00010001001200012')).toEqual({ added: 6, respaced: 0 });
  });

  // Round 2, MINOR-C: the false mismatches ADR 0034 lists — each fails loudly; the remedy is to type it as shown.
  it('the false mismatches ADR 0034 names stay mismatches', () => {
    expect(reformatOf('31.12.2026', '31122026')).toBeUndefined();
    expect(reformatOf('+421 900-123-456', '+421900123456')).toBeUndefined();
    expect(reformatOf('1 2 3 4', '1234')).toBeUndefined();
    expect(reformatOf('12:30', '1230')).toBeUndefined();
    expect(reformatOf('1 234', '12 34')).toBeUndefined();
  });

  // Round 2, NIT-B: code points on both sides.
  it('an astral letter is one character on both sides', () => {
    expect(reformatOf('𝐀𝐁𝐂𝐃 1234', '𝐀𝐁𝐂𝐃1234')).toEqual({ added: 1, respaced: 0 });
  });

  it('groups of one on both sides, or one inside, are no grouping', () => {
    expect(reformatOf('1-5', '15')).toBeUndefined();
    expect(reformatOf('1/2', '12')).toBeUndefined();
    expect(reformatOf('12 3 45', '12345')).toBeUndefined();
  });

  it('one separator character per reading', () => {
    expect(reformatOf('1,234.567', '1234567')).toBeUndefined();
    expect(reformatOf('31/12-2026', '31122026')).toBeUndefined();
  });

  it('an added `.` or `,` is a thousands separator only: never a cents mask\'s point, a typed point\'s twin, or an uneven grouping', () => {
    expect(reformatOf('1.25', '125')).toBeUndefined();
    expect(reformatOf('12,50', '1250')).toBeUndefined();
    expect(reformatOf('125.00', '12500')).toBeUndefined();
    expect(reformatOf('1.2345', '12345')).toBeUndefined(); // four digits after it
    expect(reformatOf('1234.567', '1234567')).toBeUndefined(); // four before the first
    expect(reformatOf('0.123', '0123')).toBeUndefined(); // a lone 0 before it
    expect(reformatOf('1.23.456', '123456')).toBeUndefined(); // two between two of them
    expect(reformatOf('1.234.5', '12345')).toBeUndefined(); // one digit after the last
    expect(reformatOf('1.234.5', '1234.5')).toBeUndefined(); // the typing's own point
    expect(reformatOf('1,234,5', '1234,5')).toBeUndefined();
    expect(reformatOf('0,12.345', '0,12345')).toBeUndefined(); // round 2, MINOR-B: a fraction is no whole part
  });
});

/**
 * D28 (ADR 0034's amendment): `reformatOf`'s `typing` — the whole typing whose classes decide the code rule and the
 * thousands rule when the reading is judged as a prefix of it.
 */
describe('reformatOf with `typing` — the rules of the whole typing, for a prefix of it', () => {
  it('a letter split passes in a prefix only when the whole typing is a code', () => {
    expect(reformatOf('a1bc de', 'a1bcde')).toEqual({ added: 1, respaced: 0 });
    expect(reformatOf('a1bc de', 'a1bcde', 'a1bcde f')).toBeUndefined(); // the typing holds a typed space: prose
    expect(reformatOf('ab cd', 'abcd', 'abcd12')).toEqual({ added: 1, respaced: 0 }); // the prefix has no digit, the typing does
  });

  it('an added `.`/`,` is no thousands mark when the whole typing holds it', () => {
    expect(reformatOf('1,234', '1234')).toEqual({ added: 1, respaced: 0, point: ',' });
    expect(reformatOf('1,234', '1234', '1234,5')).toBeUndefined();
  });
});

describe('prefixOf — a strict prefix of the typing, exactly or reformatted', () => {
  it('exactly: the reading itself, no reformat', () => {
    expect(prefixOf('SK31', 'SK3112000000')).toEqual({ prefix: 'SK31' });
    expect(prefixOf('', '12')).toEqual({ prefix: '' });
  });

  it('reformatted: the typed characters shown, and how', () => {
    expect(prefixOf('SK31 1200 0', 'SK3112000000')).toEqual({ prefix: 'SK3112000', reformatted: { added: 2, respaced: 0 } });
    expect(prefixOf('Jan\u00A0', 'Jan Novak')).toEqual({ prefix: 'Jan ', reformatted: { added: 0, respaced: 1 } });
  });

  it('the whole typing, more, other text, or a grouping that breaks the rules: none', () => {
    expect(prefixOf('SK31 1200 0000', 'SK3112000000')).toBeUndefined();
    expect(prefixOf('12', '12')).toBeUndefined();
    expect(prefixOf('SK31 1300', 'SK3112000000')).toBeUndefined();
    expect(prefixOf('SK31 ', 'SK3112000000')).toBeUndefined(); // a trailing mark (ADR 0034: a false mismatch, the safe side)
  });
});

describe('tailOf — what the field is missing, and how much of the typing it holds', () => {
  const e = (value: string, before: string | null = null, clear = false) => ({ value, clear, before, placeholder: undefined });

  it('the rest, the typed characters landed, and the reformat', () => {
    expect(tailOf('1 234 567,', e('1234567,89', null, true))).toEqual({ missing: '89', landed: 8, reformatted: { added: 2, respaced: 0 } });
    expect(tailOf('Jan', e('Jan Novak'))).toEqual({ missing: ' Novak', landed: 3 });
  });

  it('without clear the earlier text is no landed typing', () => {
    expect(tailOf('SK31 1200', e('12000000', 'SK31'))).toEqual({ missing: '0000', landed: 4, reformatted: { added: 1, respaced: 0 } });
    expect(tailOf('SK31', e('12000000', 'SK31'))).toEqual({ missing: '12000000', landed: 0 });
  });

  it('a bullet in the reading or in the earlier text: none', () => {
    expect(tailOf('••', e('12345'))).toBeUndefined();
    expect(tailOf('••1', e('2', '••'))).toBeUndefined();
  });

  it('landedSome: some of the typing is in the prefix', () => {
    expect(landedSome(tailOf('Jan', e('Jan Novak')))).toBe(true);
    expect(landedSome(tailOf('SK31', e('12000000', 'SK31')))).toBe(false);
    expect(landedSome(undefined)).toBe(false);
  });
});
