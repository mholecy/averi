import { describe, expect, it } from 'vitest';
import type { Difference } from '../../src/interact/fill-facts.js';
import { differenceOf, droppedTail, landingOf, needsHeldCount, tailOf, type Expectation } from '../../src/interact/fill-landing.js';

/**
 * Did the fill land? — interact/fill-landing.ts, the one judge of a field's reading. `landingOf`'s table first, then
 * what of a typing a field's reading proves dropped — the only text fillField ever types again
 * (docs/bugs/2026-10-19-ios-fill-loses-the-tail-of-its-text-in-a-react-native-single-line-field.md; the retype itself
 * is fill-type.test.ts's and fill.test.ts's) — then the mismatch's classification, and the agreement of the two.
 */

/** An input typed into without clear, nothing before, no placeholder, nothing held — `f` says what differs. */
const expecting = (f: Partial<Expectation> & Pick<Expectation, 'value'>): Expectation => ({
  clear: false,
  before: null,
  placeholder: undefined,
  isInput: true,
  resolvedValue: null,
  held: 0,
  ...f,
});

describe('landingOf — did this reading land, and how', () => {
  const rows: [string, string, Partial<Expectation> & Pick<Expectation, 'value'>, ReturnType<typeof landingOf>][] = [
    // exact, with clear: raw equality
    ['with clear the reading must EQUAL the value', 'hello', { value: 'hello', clear: true }, { kind: 'landed' }],
    ['with clear more than the value does not land', 'xhello', { value: 'hello', clear: true }, undefined],
    // exact, without clear: the value inside what the field holds
    ['without clear the value inside the reading lands (an append)', 'Note: hello', { value: 'hello', before: 'Note: ' }, { kind: 'landed' }],
    ['without clear a reading without the value does not land', 'Note: hel', { value: 'hello', before: 'Note: ' }, undefined],
    ['a named placeholder is no content: `Search` holds no `ear`', 'Search', { value: 'ear', placeholder: 'Search' }, undefined],
    // the placeholder kind (probe B)
    ['a reading exactly the named placeholder, which is the value too: placeholder, not verified', 'Search', { value: 'Search', placeholder: 'Search' }, { kind: 'placeholder' }],
    ['the same with clear', 'Search', { value: 'Search', clear: true, placeholder: 'Search' }, { kind: 'placeholder' }],
    // masked, by length
    ['masked without clear: held bullets plus the typed length', '•••••••', { value: 'abcd', held: 3 }, { kind: 'landed' }],
    ['masked without clear: more than held + typed lands too (the short direction only)', '••••••••', { value: 'abcd', held: 3 }, { kind: 'landed' }],
    ['masked without clear: fewer than held + typed does not land', '••••••', { value: 'abcd', held: 3 }, undefined],
    ['masked with clear: exactly the typed length', '••••', { value: 'abcd', clear: true, held: 3 }, { kind: 'landed' }],
    ['masked with clear: another length does not land', '•••••', { value: 'abcd', clear: true }, undefined],
    // masked, the held count unread (the post-focus re-read skipped, ADR 0028): only the typed length passes
    ['masked, held unread: exactly the typed length lands', '••••', { value: 'abcd', held: 'unread' }, { kind: 'landed' }],
    ['masked, held unread: LONGER is said-plain — final, the poll stops', '•••••••', { value: 'abcd', held: 'unread' }, { kind: 'said-plain' }],
    ['masked, held unread: shorter has not landed yet — the poll goes on (keys may be late)', '••', { value: 'abcd', held: 'unread' }, undefined],
    ['held unread, a PLAIN reading: the content rule, as ever', 'xabcd', { value: 'abcd', held: 'unread' }, { kind: 'landed' }],
    // a non-input
    ['a non-input that changed to show the value lands', 'Name: Jan', { value: 'Jan', isInput: false, resolvedValue: 'Name' }, { kind: 'landed' }],
    ['a non-input showing its own resolved text has taken nothing', 'Meno', { value: 'e', isInput: false, resolvedValue: 'Meno' }, undefined],
    ['a non-input never lands reformatted', 'SK31 1200', { value: 'SK311200', isInput: false }, undefined],
    // reformatted (D18)
    ['an IBAN grouped in fours lands reformatted', 'SK31 1200 0000', { value: 'SK3112000000', clear: true }, { kind: 'landed', reformatted: { added: 2, respaced: 0 } }],
    ['without clear the reformat is of the earlier text and the value', 'SK31 1200', { value: '1200', before: 'SK31' }, { kind: 'landed', reformatted: { added: 1, respaced: 0 } }],
    // D29: the unnamed placeholder vanished
    ['an unnamed placeholder that vanished: reformatted from the value alone', 'SK31 1200 0000', { value: 'SK3112000000', before: 'SK00 0000 0000 \u2026' }, { kind: 'landed', reformatted: { added: 2, respaced: 0 } }],
    ['an earlier text the field regrouped is still there: no pass as the value alone', '10,001,000', { value: '10001000', before: '1,000' }, undefined],
  ];
  for (const [shape, observed, f, landing] of rows) it(shape, () => expect(landingOf(observed, expecting(f))).toEqual(landing));
});

const intent = (value: string, before: string | null = null, clear = false, placeholder?: string) => ({ value, before, clear, placeholder });

describe('droppedTail — a strict prefix with some of the typing in it, else nothing', () => {
  it('a prefix of the value: the rest of it', () => {
    expect(droppedTail('Jan', intent('Jan Novak'))).toBe(' Novak');
    expect(droppedTail('SK31 1', intent('SK31 1200'))).toBe('200');
  });

  it('without clear the field should hold its earlier text and the value; with clear the value alone', () => {
    expect(droppedTail('9.9912', intent('12.34', '9.99'))).toBe('.34');
    expect(droppedTail('12', intent('12.34', '9.99', true))).toBe('.34');
  });

  it('nothing of the typing landed, the whole of it, more than it, or other text: nothing', () => {
    expect(droppedTail('9.99', intent('12.34', '9.99'))).toBeUndefined();
    expect(droppedTail('', intent('12.34'))).toBeUndefined();
    expect(droppedTail('12.34', intent('12.34'))).toBeUndefined();
    expect(droppedTail('12.345', intent('12.34'))).toBeUndefined();
    expect(droppedTail('Jan', intent('jan novak'))).toBeUndefined();
    expect(droppedTail('9.812', intent('12.34', '9.99'))).toBeUndefined(); // the earlier text changed
  });

  it('a reading with a bullet (masked) proves no prefix; a placeholder is no content', () => {
    expect(droppedTail('••', intent('12345'))).toBeUndefined();
    expect(droppedTail('•••3', intent('12345'))).toBeUndefined();
    expect(droppedTail('••', intent('••••'))).toBeUndefined(); // even a value of bullets: the reading cannot be told from a mask
    expect(droppedTail('Search', intent('Sea', null, false, 'Search'))).toBeUndefined();
    expect(droppedTail('Se', intent('Sea', 'Search', false, 'Search'))).toBe('a');
  });
});

/**
 * D28 (docs/adr/0034-a-fill-passes-a-field-that-reformats-as-it-is-typed.md, its amendment): a field that groups as it
 * is typed and dropped the end of the typing shows a REFORMATTED strict prefix — iOS React Native's rf2 held
 * `1 234 567,` for `1234567,89`. The prefix must be exact by typed characters, with only grouping added, under
 * `reformatOf`'s rules judged over the WHOLE typing (one separator kind, letters split only in a code, thousands).
 */
describe('droppedTail — a reformatted strict prefix (D28)', () => {
  it('an amount grouped by thousands, an IBAN grouped in fours: the rest of the typing', () => {
    expect(droppedTail('1 234 567,', intent('1234567,89', null, true))).toBe('89');
    expect(droppedTail('SK31 1200 0', intent('SK3112000000'))).toBe('000');
    expect(droppedTail('SK31 1200', intent('SK3112000000'))).toBe('0000');
  });

  it('Android-shaped readings: a no-break or narrow no-break space as the grouping', () => {
    expect(droppedTail('1\u00A0234\u00A0567', intent('1234567,89', null, true))).toBe(',89');
    expect(droppedTail('12\u202F345', intent('1234567'))).toBe('67');
  });

  it('without clear: the earlier text first, and some of the typing in the prefix', () => {
    expect(droppedTail('SK31 1200', intent('12000000', 'SK31'))).toBe('0000');
    expect(droppedTail('SK31', intent('12000000', 'SK31'))).toBeUndefined(); // nothing of the typing landed
  });

  it('only grouping added: a trailing mark, a changed character, two separator kinds, a lone grouping — nothing', () => {
    expect(droppedTail('SK31 1200 ', intent('SK3112000000'))).toBeUndefined(); // an eager trailing mark
    expect(droppedTail('SK31 1300', intent('SK3112000000'))).toBeUndefined();
    expect(droppedTail('1 234.567', intent('12345678'))).toBeUndefined();
    expect(droppedTail('1-2', intent('1234'))).toBeUndefined(); // groups of one
    expect(droppedTail('1 2', intent('1234'))).toBeUndefined();
    expect(droppedTail('••• •', intent('12345'))).toBeUndefined(); // bullets
    expect(droppedTail('SK31 1200 0000', intent('SK3112000000'))).toBeUndefined(); // the whole typing: no tail
  });

  it('a typed space the field shows as a no-break space is part of the prefix (respaced)', () => {
    expect(droppedTail('1\u00A0234', intent('1 23456'))).toBe('56');
  });

  it('the rules are the whole typing\'s: a letter split is a code\'s only when the WHOLE typing is one, and a `.`/`,` it holds is never a thousands mark', () => {
    expect(droppedTail('a1bc de', intent('a1bcde f'))).toBeUndefined(); // the prefix is a code, the typing (a typed space) is not
    expect(droppedTail('a1bc de', intent('a1bcdefg'))).toBe('fg');
    expect(droppedTail('1,234', intent('1234,5'))).toBeUndefined(); // the typing's own `,` is its decimal point
    expect(droppedTail('1.234', intent('1234,5'))).toBe(',5');
    expect(droppedTail('a lot', intent('alotmore'))).toBeUndefined(); // prose: autocorrect, not a format
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

  it('some of the typing in the prefix is a dropped tail; none of it, or no prefix, is not', () => {
    expect(droppedTail('Jan', e('Jan Novak'))).toBe(' Novak');
    expect(droppedTail('SK31', e('12000000', 'SK31'))).toBeUndefined();
    expect(droppedTail('XY', e('12000000', 'SK31'))).toBeUndefined();
  });
});

/**
 * D29: idb names no placeholder (adapters/types.ts, UiNode.placeholder), so a UIKit field's placeholder is read as the
 * empty field's value — fill's `before` — and vanishes at the first key. Measured on the owner's iOS run (SwiftUI lab,
 * form-format's iban, placeholder `SK00 0000 0000 …`): f1 and f7 held `SK31 1200 0000`, and the fill failed "typed 12
 * characters but the field shows 14" — the reading was judged after the placeholder. Without clear, a reading that does
 * not start with the earlier text is judged with none as well; one that still shows it is judged after it alone.
 */
describe('an earlier text that vanished — an unnamed placeholder (D29)', () => {
  const PH = 'SK00 0000 0000 \u2026';
  const e = (value: string, before: string | null, clear = false) => ({ value, clear, before, placeholder: undefined });

  it('landingOf: the reading reformatted from the value alone once the earlier text is gone', () => {
    expect(landingOf('SK31 1200 0000', expecting(e('SK3112000000', PH)))).toEqual({ kind: 'landed', reformatted: { added: 2, respaced: 0 } });
    expect(landingOf('CZ65 0800 0000', expecting(e('CZ6508000000', PH)))).toEqual({ kind: 'landed', reformatted: { added: 2, respaced: 0 } });
  });

  it('landingOf: an earlier text still shown is judged after it, never without it', () => {
    expect(landingOf('SK31 1200 0000', expecting(e('000000', 'SK31 12')))).toEqual({ kind: 'landed', reformatted: { added: 1, respaced: 0 } });
    // `1` is still there: `1234 5678` is no reformat of `1` + `12345678`, and not judged as the value alone.
    expect(landingOf('1234 5678', expecting(e('12345678', '1')))).toBeUndefined();
  });

  it('landingOf: with clear the earlier text never counts', () => {
    expect(landingOf('SK31 1200 0000', expecting(e('SK3112000000', PH, true)))).toEqual({ kind: 'landed', reformatted: { added: 2, respaced: 0 } });
    // cleared, the field must hold the value alone: `SK31` shown before it is no earlier text to judge after
    expect(landingOf('SK31 1200 0000', expecting(e('12000000', 'SK31', true)))).toBeUndefined();
    expect(tailOf('SK31 12', e('12000000', 'SK31', true))).toBeUndefined();
  });

  it('tailOf: a prefix of the value alone — the missing tail, all of what landed the typing', () => {
    expect(tailOf('SK31 1200 0', e('SK3112000000', PH))).toEqual({ missing: '000', landed: 9, reformatted: { added: 2, respaced: 0 } });
    expect(tailOf('SK31', e('SK3112000000', PH))).toEqual({ missing: '12000000', landed: 4 });
  });

  it('tailOf: a real earlier text still shown is unchanged — judged after it alone', () => {
    expect(tailOf('SK31 1200', e('12000000', 'SK31'))).toEqual({ missing: '0000', landed: 4, reformatted: { added: 1, respaced: 0 } });
    // starts with the earlier `1`: no prefix of `1` + `12345678`, and not judged as the value alone
    expect(tailOf('1234 5', e('12345678', '1'))).toBeUndefined();
    // an earlier text the field regrouped (`SK3112` shown `SK31 12…`) no longer starts the reading as typed: judged after it first
    expect(tailOf('SK31 1200', e('0000', 'SK3112'))).toEqual({ missing: '00', landed: 2, reformatted: { added: 1, respaced: 0 } });
    expect(landingOf('SK31 1200 00', expecting(e('0000', 'SK3112')))).toEqual({ kind: 'landed', reformatted: { added: 2, respaced: 0 } });
  });

  // D29 review round 1, MAJOR-1: the guard compares letters and digits, not the text as typed — an earlier text the
  // field regrouped (`1,000` shown `10,00…`) is still there, and the reading is judged after it alone.
  it('an earlier text the field regrouped is still there: judged after it, never as the value alone', () => {
    expect(landingOf('10,001,000', expecting(e('10001000', '1,000')))).toBeUndefined();
    expect(tailOf('100,010', e('1000105', '1,000'))).toBeUndefined();
  });

  // D29 review round 2, MINOR-A (the owner's decision): an earlier text with no letters or digits (a dash, a
  // `__/__/____` mask) keeps the pre-D29 judgment — a false mismatch, never a wrong pass; deliberately not loosened.
  it('an earlier text with no letters or digits: judged after it alone, as before D29', () => {
    expect(landingOf('SK31 1200 0000', expecting(e('SK3112000000', '\u2014')))).toBeUndefined();
  });

  // MINOR-3: the earlier text inside the reading, not at its start, did not survive as the earlier text.
  it('the earlier text inside the reading but not at its start: judged as the value alone', () => {
    expect(landingOf('34 12', expecting(e('3412', '12')))).toEqual({ kind: 'landed', reformatted: { added: 1, respaced: 0 } });
  });

  // MINOR-3: the earlier text first — a reading that is a prefix of the earlier text itself (`SK` of `SK00 …`) is no
  // proof that the typing landed: nothing of it counted, nothing typed again.
  it('a reading that is a prefix of the earlier text too: judged after the earlier text first — none of the typing landed', () => {
    expect(tailOf('SK', e('SK3112000000', PH))?.landed).toBeLessThanOrEqual(0); // a prefix of the earlier text alone
    expect(droppedTail('SK', e('SK3112000000', PH))).toBeUndefined();
  });

  it('tailOf: the earlier text vanished but other text took its place — none', () => {
    expect(tailOf('XY12', e('1234', PH))).toBeUndefined();
    expect(tailOf('SK31 1300', e('SK3112000000', PH))).toBeUndefined();
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
  /** A row: the reading, and what it is judged against. */
  type Row = { observed: string } & Partial<Expectation> & Pick<Expectation, 'value'>;
  const differs = ({ observed, ...f }: Row): Difference => differenceOf(observed, expecting(f));
  const rows: [string, Row, Difference][] = [
    // 0. masked-said-plain — before unchanged: the held count was never read, so no reading proves what the field held
    ['bullets, held unread (said plain), longer than typed', { observed: '•••••••', value: 'abcd', held: 'unread' }, { kind: 'masked-said-plain' }],
    ['bullets, held unread, shorter than typed', { observed: '••', value: 'abcd', held: 'unread' }, { kind: 'masked-said-plain' }],
    ['bullets, held unread, the reading what it showed before typing: said-plain, not unchanged', { observed: '••', before: '••', value: 'abcd', held: 'unread' }, { kind: 'masked-said-plain' }],
    ['a plain reading, held unread: compared as text', { observed: 'abcx', value: 'abcd', held: 'unread' }, { kind: 'same-length', positions: 1 }],
    // 1. unchanged — after said-plain, whatever the reading is
    ['typing dropped on held text (D2: it matches but for case)', { observed: 'Hello', before: 'Hello', value: 'hello' }, { kind: 'unchanged' }],
    ['typing dropped on a field showing only its placeholder (D)', { observed: 'Search', before: 'Search', value: 'search', placeholder: 'Search' }, { kind: 'unchanged' }],
    ['typing dropped on held bullets: unchanged, not masked', { observed: '••••', before: '••••', value: 'abcdef' }, { kind: 'unchanged' }],
    // 2. masked
    ['bullets, no clear: the held count rides along', { observed: '•••••', value: '123456', held: 0 }, { kind: 'masked', held: 0 }],
    ['bullets onto held bullets, no clear', { observed: '•'.repeat(32), before: '•'.repeat(20), value: 'x'.repeat(16), held: 20 }, { kind: 'masked', held: 20 }],
    ['bullets with clear: no held count (the clear emptied it)', { observed: '•••••', value: 'secret', clear: true, held: 4 }, { kind: 'masked', held: undefined }],
    // 3. partly masked
    ['show-the-last-character (`•••••t`): lengths only', { observed: '•••••t', value: 'secret' }, { kind: 'length' }],
    // 4. held text compared
    ['auto-capitalised, no clear', { observed: 'Hello', value: 'hello' }, { kind: 'case', positions: 1 }],
    ['auto-capitalised, with clear', { observed: 'Hello world', value: 'hello world', clear: true }, { kind: 'case', positions: 1 }],
    ['no clear onto held text: only the run after it is compared', { observed: 'NOTE: HI THERE', before: 'Note: ', value: 'hi there' }, { kind: 'case', positions: 7 }],
    ['no clear: of several runs that match but for case, the closest counts — not the first', { observed: 'HELLO Hello', value: 'hello' }, { kind: 'case', positions: 1 }],
    ['no clear, the held text changed too: compared whole, closest run', { observed: 'NOTE: HI THERE', before: 'xyz', value: 'hi there' }, { kind: 'case', positions: 7 }],
    ['with clear the earlier text is gone: the whole reading is the typing (`priorText`)', { observed: 'abXY', before: 'ab', value: 'abxy', clear: true }, { kind: 'case', positions: 2 }],
    ['with clear the field must EQUAL the value: longer but for case is a length', { observed: 'Re: Hello', value: 'hello', clear: true }, { kind: 'length' }],
    ['autocorrect `teh` → `the`: same length, how many differ', { observed: 'the', value: 'teh' }, { kind: 'same-length', positions: 2 }],
    ['held `HELLo` is not the typing: only `hxllo` after it is compared', { observed: 'HELLohxllo', before: 'HELLo', value: 'hello' }, { kind: 'same-length', positions: 1 }],
    ['a mask that inserts a space', { observed: '1234 5', value: '12345' }, { kind: 'length' }],
    ['typing onto a field showing only its placeholder: the placeholder is no held text, so nothing is sliced off', { observed: 'Searchx', before: 'Search', value: 'searchx', placeholder: 'Search' }, { kind: 'case', positions: 1 }],
    ['a field that fell back to its named placeholder holds no text: never "but for case"', { observed: 'Company', before: 'Zed', value: 'company', placeholder: 'Company' }, { kind: 'length' }],
    ['a pair equal only upper-cased (dotless `ı`, `i`) is case too', { observed: 'ıd', value: 'id', clear: true }, { kind: 'case', positions: 1 }],
    ['`ß`/`SS` differ in length: a plain difference, never case', { observed: 'SS', value: 'ß', clear: true }, { kind: 'length' }],
    // D28: a reformatted strict prefix is a dropped tail — iOS React Native's rf2 read "transformed the input"
    ['a grouping field that dropped the tail (rf2): a dropped tail, not a transformed input', { observed: '1 234 567,', value: '1234567,89', clear: true }, { kind: 'dropped-tail', landed: 8, dropped: 2, grouped: true }],
    ['the same on Android (no-break spaces), no clear onto held text', { observed: 'SK31\u00A01200\u00A00', before: 'SK31', value: '12000000' }, { kind: 'dropped-tail', landed: 5, dropped: 3, grouped: true }],
    // D28 code review: a prefix only RESPACED (a typed space shown as a no-break space), nothing added, is not grouped
    ['a respaced-only prefix (`Jan\u00A0` for `Jan Novak`): a dropped tail, not grouped', { observed: 'Jan\u00A0', value: 'Jan Novak', clear: true }, { kind: 'dropped-tail', landed: 4, dropped: 5, grouped: false }],
    // D29: idb names no placeholder — `before` was the UIKit field's own `SK00 0000 0000 …`, gone at the first key
    ['a grouping field that dropped the tail after its unnamed placeholder vanished: a dropped tail, not a length', { observed: 'SK31 1200 0', before: 'SK00 0000 0000 \u2026', value: 'SK3112000000' }, { kind: 'dropped-tail', landed: 9, dropped: 3, grouped: true }],
    ['an exact prefix stays a length (the field grouped nothing)', { observed: '12345', value: '1234567', clear: true }, { kind: 'length' }],
    ['a grouped reading with a changed character is no prefix', { observed: '1 235 5', value: '1234567', clear: true }, { kind: 'same-length', positions: 5 }],
    ['a grouped reading that holds nothing of the typing is no dropped tail', { observed: '1 234', before: '1234', value: '5' }, { kind: 'length' }],
  ];
  for (const [shape, f, kind] of rows) it(shape, () => expect(differs(f)).toEqual(kind));
});

/**
 * D28's invariant, swept: the typing and the verdict judge a prefix alike. Every reading that `tailOf` says holds some
 * of the typing, reformatted by the field, is a `dropped-tail` to `differenceOf` — with the same count landed. The
 * readings are every prefix of the expected text grouped as fields group it (fours, thousands from the right, pairs;
 * spaces, no-break spaces and the marks), after an earlier text, a vanished unnamed placeholder or none.
 */
describe('tailOf and differenceOf agree on a dropped tail (D28)', () => {
  const groupLeft = (t: string, n: number, sep: string) => (t.match(new RegExp(`.{1,${n}}`, 'gu')) ?? []).join(sep);
  const groupRight = (t: string, n: number, sep: string) => [...groupLeft([...t].reverse().join(''), n, sep)].reverse().join('');
  const cases: Partial<Expectation>[] = [
    { value: 'SK3112000000', clear: true },
    { value: 'SK3112000000', before: 'SK00 0000 0000 …' },
    { value: '12000000', before: 'SK31' },
    { value: '1234567,89', clear: true },
    { value: '12345678' },
    { value: '0000', before: 'SK3112' },
    { value: 'Jan Novak', clear: true },
    { value: '1 23456' },
  ];
  it('every reformatted prefix with some of the typing in it is a dropped tail, the same count landed', () => {
    let swept = 0;
    for (const c of cases) {
      const e = expecting({ value: '', ...c });
      const whole = (e.clear ? '' : (e.before ?? '')) + e.value;
      const plain = whole.replace(/[\s.,]/gu, '');
      const shapes = [whole, plain];
      for (const sep of [' ', ' ', ' ', ',', '.', '-'])
        for (const n of [2, 3, 4]) shapes.push(groupLeft(plain, n, sep), groupRight(plain, n, sep), groupLeft(whole, n, sep));
      for (const shape of shapes)
        for (let k = 1; k <= [...shape].length; k++) {
          const reading = [...shape].slice(0, k).join('');
          const tail = tailOf(reading, e);
          if (tail === undefined || tail.landed <= 0 || tail.reformatted === undefined) continue; // some of the typing landed
          swept++;
          expect(differenceOf(reading, e), JSON.stringify({ reading, c })).toMatchObject({ kind: 'dropped-tail', landed: tail.landed });
        }
    }
    expect(swept).toBeGreaterThan(50); // the sweep is not vacuous
  });
});

/**
 * Where the post-focus re-read can change the count the masked rule starts from (ADR 0028): everywhere but an EMPTY
 * input its source says is plain. The gate's other clauses (no clear, a sole id, no tail retype) are fill.ts's.
 */
describe('needsHeldCount — whether a field can hold bullets the typing must count from', () => {
  const rows: [string, Parameters<typeof needsHeldCount>[0], boolean][] = [
    ['an empty input said plain: no', { role: 'textfield', secure: false, value: null, placeholder: undefined }, false],
    ['an input said plain showing its named placeholder (empty): no', { role: 'textfield', secure: false, value: '0,00', placeholder: '0,00' }, false],
    ['an input said plain that holds text: yes', { role: 'textfield', secure: false, value: '9.99', placeholder: undefined }, true],
    ['an input said plain showing bullets: yes', { role: 'textfield', secure: false, value: '••••', placeholder: undefined }, true],
    ['a secure input: yes', { role: 'textfield', secure: true, value: null, placeholder: undefined }, true],
    ['an input its source said nothing of: yes', { role: 'textfield', secure: undefined, value: null, placeholder: undefined }, true],
    ['a node of another role said plain (`secure` is an input\'s word): yes', { role: 'other', secure: false, value: null, placeholder: undefined }, true],
  ];
  for (const [shape, f, needs] of rows) it(shape, () => expect(needsHeldCount(f)).toBe(needs));
});
