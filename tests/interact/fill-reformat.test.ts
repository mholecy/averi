import { describe, expect, it } from 'vitest';
import { maskTemplate, prefixOf, reformatOf, separatedOf, skeleton } from '../../src/interact/fill-reformat.js';

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

  it('respaced and added together count both: one of each is a change, not none', () => {
    expect(reformatOf('1\u00A0234 567', '1 234567')).toEqual({ added: 1, respaced: 1 });
  });

  it('a typed space shown as another character is a change, not a respacing', () => {
    expect(reformatOf('1x2', '1 2')).toBeUndefined();
    expect(reformatOf('1-2', '1 2')).toBeUndefined();
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
    expect(reformatOf('Flat 12 A', 'Flat 12A')).toEqual({ added: 1, respaced: 0 }); // a digit and a letter: no word split either
    expect(reformatOf('MT84 MALT 0110 0001 2345 MTLC AST0 01S', 'MT84MALT011000012345MTLCAST001S')).toEqual({ added: 7, respaced: 0 });
    expect(reformatOf('GB29 NWBK 6016 1331 9268 19', 'GB29NWBK60161331926819')).toEqual({ added: 5, respaced: 0 });
    expect(reformatOf('FR14 2004 1010 0505 0001 3M02 606', 'FR1420041010050500013M02606')).toEqual({ added: 6, respaced: 0 });
    expect(reformatOf('LC55 HEMM 0001 0001 0012 0001 2', 'LC55HEMM00010001001200012')).toEqual({ added: 6, respaced: 0 });
  });

  // Round 2, MINOR-C: the false mismatches ADR 0034 lists — each fails loudly; the remedy is to type it as shown.
  it('the false mismatches ADR 0034 names stay mismatches', () => {
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
    expect(reformatOf('1.234.5', '12345')).toBeUndefined(); // one digit after the last
    expect(reformatOf('1.234.5', '1234.5')).toBeUndefined(); // the typing's own point
    expect(reformatOf('1,234,5', '1234,5')).toBeUndefined();
    expect(reformatOf('0,12.345', '0,12345')).toBeUndefined(); // round 2, MINOR-B: a fraction is no whole part
    expect(reformatOf('.1,234', '.1234')).toBeUndefined(); // a fraction from the reading's first character
    expect(reformatOf('1,23a', '123a')).toBeUndefined(); // a group of three holds digits only
    expect(reformatOf('1,a23', '1a23')).toBeUndefined();
  });

  it('an added `.` or `,` after up to three digits, a word before them included', () => {
    expect(reformatOf('123,456', '123456')).toEqual({ added: 1, respaced: 0, point: ',' });
    expect(reformatOf('EUR 1,234', 'EUR 1234')).toEqual({ added: 1, respaced: 0, point: ',' });
  });
});

/**
 * D51 (ADR 0034's amendment): two or more added `.` or `,` over a digits-only typing, a group between two of them not
 * three long, are a digit grouping — a dotted date, a lakh — not a thousands grouping and never a decimal point (one
 * number holds one). Measured: f11 typed `31122026` into a field that showed `31.12.2026` and averi replied ERROR under
 * idb, WDA and uiautomator. Passed WITHOUT `point`: the verdict's caveat asks whether the mark is a thousands separator
 * rather than a decimal point, and here it is neither.
 */
describe('reformatOf — a digit grouping by `.` or `,` (D51)', () => {
  it('a dotted date, a comma date and a lakh grouping pass, with no point', () => {
    expect(reformatOf('31.12.2026', '31122026')).toEqual({ added: 2, respaced: 0 });
    expect(reformatOf('31.12.26', '311226')).toEqual({ added: 2, respaced: 0 }); // DD.MM.YY
    expect(reformatOf('2026.12.31', '20261231')).toEqual({ added: 2, respaced: 0 }); // YYYY.MM.DD
    expect(reformatOf('1.12.2026', '1122026')).toEqual({ added: 2, respaced: 0 }); // a first group of one
    expect(reformatOf('31,12,2026', '31122026')).toEqual({ added: 2, respaced: 0 });
    expect(reformatOf('12,34,567', '1234567')).toEqual({ added: 2, respaced: 0 }); // Indian lakh
  });

  it('an uneven grouping no known format uses passes too (residual 4): every digit there, no decimal reading', () => {
    expect(reformatOf('1.23.456', '123456')).toEqual({ added: 2, respaced: 0 });
    expect(reformatOf('1,2345,678', '12345678')).toEqual({ added: 2, respaced: 0 });
    expect(reformatOf('1.23.456.789', '123456789')).toEqual({ added: 3, respaced: 0 }); // one inner group not three is enough
    expect(reformatOf('12.34.56', '123456')).toEqual({ added: 2, respaced: 0 }); // a grouping in twos; one mark (`12.34`) still fails
  });

  it('one added mark is never a digit grouping: it may be a decimal point', () => {
    expect(reformatOf('12.34', '1234')).toBeUndefined(); // a cents mask
    expect(reformatOf('123.45', '12345')).toBeUndefined();
  });

  it('inner groups all three digits are a thousands shape, the thousands rule\'s alone to judge', () => {
    expect(reformatOf('1.234.56', '123456')).toBeUndefined(); // a cents-like tail
    expect(reformatOf('12.345.67', '1234567')).toBeUndefined();
    expect(reformatOf('1234.567.890', '1234567890')).toBeUndefined(); // four before the first: no thousands either
  });

  it('a typing that is not digits alone keeps the thousands rule: a mark may be its decimal point or an edit', () => {
    expect(reformatOf('A1.12.2026', 'A1122026')).toBeUndefined();
    expect(reformatOf('12.34.56,7', '123456,7')).toBeUndefined();
    expect(reformatOf('31.12.2026', '31.122026')).toBeUndefined(); // a typed `.`: one added mark
  });

  it('the whole typing decides, for a prefix of it', () => {
    expect(reformatOf('31.12.20', '311220')).toEqual({ added: 2, respaced: 0 });
    expect(reformatOf('31.12.20', '311220', '311220,5')).toBeUndefined();
  });

  it('a thousands grouping is judged first: its caveat kept', () => {
    expect(reformatOf('1.234.567', '1234567')).toEqual({ added: 2, respaced: 0, point: '.' });
  });

  it('every other rule still holds: a changed, added or reordered digit, a stray mark, groups of one', () => {
    expect(reformatOf('31.12.2026', '3112202')).toBeUndefined(); // an added digit
    expect(reformatOf('31.12.2062', '31122026')).toBeUndefined(); // reordered
    expect(reformatOf('31..12.2026', '31122026')).toBeUndefined();
    expect(reformatOf('.31.12.2026', '31122026')).toBeUndefined();
    expect(reformatOf('31.12.2026.', '31122026')).toBeUndefined();
    expect(reformatOf('31.12/2026', '31122026')).toBeUndefined();
    expect(reformatOf('3.1.12.2026', '31122026')).toBeUndefined();
    expect(reformatOf('1.2.3', '123')).toBeUndefined();
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

  it('a dotted date\'s prefix (D51): reformatted; one mark shown is none', () => {
    expect(prefixOf('31.12.20', '31122026')).toEqual({ prefix: '311220', reformatted: { added: 2, respaced: 0 } });
    expect(prefixOf('31.1', '31122026')).toBeUndefined();
  });

  it('the whole typing, more, other text, or a grouping that breaks the rules: none', () => {
    expect(prefixOf('SK31 1200 0000', 'SK3112000000')).toBeUndefined();
    expect(prefixOf('12', '12')).toBeUndefined();
    expect(prefixOf('SK31 1300', 'SK3112000000')).toBeUndefined();
    expect(prefixOf('SK31 1200 0000 ', 'SK3112000000')).toBeUndefined(); // the whole typing with an eager mark: no prefix
  });

  // D60: an eager field adds its mark once a group is complete, so a dropped end leaves a strict prefix AND that mark.
  // The mark is judged as if the next typed character had landed after it — every rule of `reformatOf` unchanged.
  it('a prefix that ends in an eager trailing mark (D60): reformatted, the trailing mark counted', () => {
    expect(prefixOf('SK31 ', 'SK3112000000')).toEqual({ prefix: 'SK31', reformatted: { added: 1, respaced: 0 } });
    expect(prefixOf('SK31 1200 ', 'SK3112000000')).toEqual({ prefix: 'SK311200', reformatted: { added: 2, respaced: 0 } });
    expect(prefixOf('SK31\u00A01200\u00A0', 'SK3112000000')).toEqual({ prefix: 'SK311200', reformatted: { added: 2, respaced: 0 } });
    expect(prefixOf('4111 1111 ', '4111111111111111')).toEqual({ prefix: '41111111', reformatted: { added: 2, respaced: 0 } });
    expect(prefixOf('903 123 ', '903123456')).toEqual({ prefix: '903123', reformatted: { added: 2, respaced: 0 } });
    expect(prefixOf('0903 12 ', '0903123456')).toEqual({ prefix: '090312', reformatted: { added: 2, respaced: 0 } });
    expect(prefixOf('+421 903 ', '+421903123456')).toEqual({ prefix: '+421903', reformatted: { added: 2, respaced: 0 } });
    expect(prefixOf('31.12.', '31122026')).toEqual({ prefix: '3112', reformatted: { added: 2, respaced: 0 } }); // a D51 grouping
    expect(prefixOf('31/12/', '31122026')).toEqual({ prefix: '3112', reformatted: { added: 2, respaced: 0 } });
    // the whole typing's rules: a letter split is a code's when the WHOLE typing is one (digits later in it)
    expect(prefixOf('ab ', 'abcd12')).toEqual({ prefix: 'ab', reformatted: { added: 1, respaced: 0 } });
    // a typing that holds a space of its own: another mark may still be the field's
    expect(prefixOf('+421 903-', '+421 903123456')).toEqual({ prefix: '+421 903', reformatted: { added: 1, respaced: 0 } });
  });

  it('a trailing mark `reformatOf` would refuse before the next typed character (D60): none', () => {
    expect(prefixOf('SK31 1200  ', 'SK3112000000')).toBeUndefined(); // two marks, next to each other
    expect(prefixOf('SK31 1200-', 'SK3112000000')).toBeUndefined(); // two kinds
    expect(prefixOf('31.', '31122026')).toBeUndefined(); // one `.`: neither thousands nor a grouping (D51's residual)
    expect(prefixOf('12.', '1234')).toBeUndefined(); // a cents mask's point waiting for its fraction
    expect(prefixOf('1.234.', '1234567')).toBeUndefined(); // no thousands: `1.234.5`
    expect(prefixOf('1 234 ', '1234567')).toBeUndefined(); // two single-character groups
    expect(prefixOf('1 2 ', '1234')).toBeUndefined(); // groups of one
    expect(prefixOf('1 234 ', '1234,56')).toBeUndefined(); // before typed punctuation
    expect(prefixOf('12 345 ', '12345,67')).toBeUndefined(); // the same, judged by THE next typed character: `,`
    expect(prefixOf('Jan ', 'JanNovak')).toBeUndefined(); // prose: autocorrect splitting a word
    expect(prefixOf(' ', 'SK3112000000')).toBeUndefined(); // a leading mark: an empty prefix
    expect(prefixOf('-', '12')).toBeUndefined();
  });

  // D60's typed-mark guard (as `thousands`' rule): a mark the typing holds itself may be the typing's own, shown after a
  // drop from the middle — the retype of what follows it would misplace characters. All spaces are one kind.
  it('a trailing mark the whole typing holds itself (D60): none', () => {
    expect(prefixOf('12/', '1234/56')).toBeUndefined();
    expect(prefixOf('12 ', '1234 5678')).toBeUndefined();
    expect(prefixOf('12\u00A0', '1234 5678')).toBeUndefined(); // another space for the typing's own
    expect(prefixOf('12 ', '1234\u00A05678')).toBeUndefined();
    // ADR 0034 residual 5: an eager mark of the kind the typing holds elsewhere — a false mismatch, the safe side
    expect(prefixOf('+421 903 ', '+421 903123456')).toBeUndefined();
  });
});

/**
 * D53: a reading that shows every typed character, in order, with only SEPARATORS added — the separators `reformatOf`
 * refuses as grouping (a decimal point, a sign, mixed or trailing marks, groups of one, a word split by autocorrect).
 * Counts every added separator, not groups; says nothing of whether the rules would pass it (the caller asks only of a
 * reading that did not land).
 */
describe('separatedOf — every typed character in order, separators alone added', () => {
  it('the refused shapes: a cents mask, mixed marks, an eager trailing mark, groups of one', () => {
    expect(separatedOf('12.34', '1234')).toBe(1);
    expect(separatedOf('+421 900-123-456', '+421900123456')).toBe(3);
    expect(separatedOf('SK31 ', 'SK31')).toBe(1);
    expect(separatedOf('1 2 3 4', '1234')).toBe(3);
    expect(separatedOf('SK31 1200 0000 ', 'SK3112000000')).toBe(3);
  });

  it('a leading sign, autocorrect splitting a word, a no-break space, two adjacent, an astral pair', () => {
    expect(separatedOf('-1234', '1234')).toBe(1);
    expect(separatedOf('a lot', 'alot')).toBe(1);
    expect(separatedOf('12\u00A034', '1234')).toBe(1);
    expect(separatedOf('12\u202F34', '1234')).toBe(1); // a narrow no-break space
    expect(separatedOf('12  34', '1234')).toBe(2); // every added separator counts, not the groups
    expect(separatedOf('\u{1D400}.\u{1D401}', '\u{1D400}\u{1D401}')).toBe(1); // code points, not UTF-16 units
  });

  it('a substituted, dropped or added letter or digit: none', () => {
    expect(separatedOf('12.35', '1234')).toBeUndefined();
    expect(separatedOf('12.3', '1234')).toBeUndefined(); // a strict prefix: dropped-tail's, not separated
    expect(separatedOf('12.345', '1234')).toBeUndefined();
    expect(separatedOf('1a2.34', '1234')).toBeUndefined();
  });

  it('a mark outside SEPARATORS, a mask\'s blanks, bullets, an empty reading: none', () => {
    expect(separatedOf('12:34', '1234')).toBeUndefined();
    expect(separatedOf('31.12.____', '31122026')).toBeUndefined();
    expect(separatedOf('•••.•', '1234')).toBeUndefined();
    expect(separatedOf('', '1234')).toBeUndefined();
  });

  it('a reading equal to the typing, or only respaced: nothing added, none', () => {
    expect(separatedOf('1234', '1234')).toBeUndefined();
    expect(separatedOf('Jan\u00A0Novak', 'Jan Novak')).toBeUndefined();
  });

  it('a D51 grouping still passes `reformatOf` (it lands, and differenceOf never sees it)', () => {
    expect(reformatOf('31.12.2026', '31122026')).toEqual({ added: 2, respaced: 0 });
    expect(reformatOf('12.34', '1234')).toBeUndefined(); // the cents mask stays refused
  });
});

describe('skeleton — a text\'s letters and digits alone', () => {
  it('drops everything else, keeps the order', () => {
    expect(skeleton('SK31 1200-0000')).toBe('SK3112000000');
    expect(skeleton('1\u00A0234,56 €')).toBe('123456');
    expect(skeleton('—')).toBe('');
  });
});

/** D51: a field's blanks — `_` and separators alone, at least one `_` — a mask template, never content. */
describe('maskTemplate — a mask\'s blanks, never content', () => {
  it('`_` and separators, at least one `_`', () => {
    for (const t of ['__.__.____', '__/__/____', '____ ____', '_', '__-__', '__,__', '__\u00A0__']) expect(maskTemplate(t), t).toBe(true);
  });

  it('no `_`, another character, or a character outside the separators: no template', () => {
    for (const t of ['', '\u2014', '-', '..', '__a_', 'SK00 0000', '+421', '__:__', '31.12.____']) expect(maskTemplate(t), t).toBe(false);
  });
});
