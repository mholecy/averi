import { describe, expect, it } from 'vitest';
import type { Difference } from '../../src/interact/fill-facts.js';
import { differenceOf, droppedTail, landingOf, needsHeldCount, readingOf, tailOf, withoutWholeToo, type Expectation, type Reading } from '../../src/interact/fill-landing.js';
import { SEPARATORS } from '../../src/interact/fill-reformat.js';
import { isMaskedValue } from '../../src/ui-tree/masked-value.js';

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
    ['a reading other than the named placeholder lands', 'hello', { value: 'hello', clear: true, placeholder: 'Search' }, { kind: 'landed' }],
    // masked, by length
    ['masked without clear: held bullets plus the typed length', '•••••••', { value: 'abcd', held: 3 }, { kind: 'landed' }],
    ['masked without clear: more than held + typed lands too (the short direction only)', '••••••••', { value: 'abcd', held: 3 }, { kind: 'landed' }],
    ['masked without clear: fewer than held + typed does not land', '••••••', { value: 'abcd', held: 3 }, undefined],
    ['masked with clear: exactly the typed length', '••••', { value: 'abcd', clear: true, held: 3 }, { kind: 'landed' }],
    ['masked with clear: another length does not land', '•••••', { value: 'abcd', clear: true }, undefined],
    // masked, the held count unread (the post-focus re-read skipped, ADR 0028): only the typed length passes
    ['masked, held unread: exactly the typed length lands', '••••', { value: 'abcd', held: 'unread' }, { kind: 'landed' }],
    ['masked, held unread: LONGER is said-plain — final, the poll stops', '•••••••', { value: 'abcd', held: 'unread' }, { kind: 'said-plain', differs: { kind: 'masked-said-plain' } }],
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

/**
 * A9: one answer about one reading. A tail is orthogonal to a Difference (`Jan` for `Jan Novak` after `Jan`, with clear:
 * retypable and `unchanged`), and a `not-taken` carries its Miss too (a retry's last reading goes on from it).
 */
describe('readingOf — the whole answer about one reading', () => {
  const rows: [string, string, Partial<Expectation> & Pick<Expectation, 'value'>, Reading][] = [
    ['a landing is the landing', 'hello', { value: 'hello', clear: true }, { kind: 'landed' }],
    ['reformatted', 'SK31 1200', { value: 'SK311200' }, { kind: 'landed', reformatted: { added: 1, respaced: 0 } }],
    ['the named placeholder', 'Search', { value: 'Search', placeholder: 'Search' }, { kind: 'placeholder' }],
    ['said plain, longer than typed: final, and its difference with it', '•••••••', { value: 'abcd', held: 'unread' }, { kind: 'said-plain', differs: { kind: 'masked-said-plain' } }],
    ['said plain, shorter: no landing, the same difference, not final', '••', { value: 'abcd', held: 'unread' }, { kind: 'missed', differs: { kind: 'masked-said-plain' } }],
    ['a non-input showing its own text: not-taken, no tail', 'Meno', { value: 'e', isInput: false, resolvedValue: 'Meno' }, { kind: 'not-taken', differs: { kind: 'length' } }],
    ['a non-input showing the start of the typing: not-taken, with the tail a retry goes on from', 'Jan', { value: 'Jan Novak', isInput: false, resolvedValue: 'Jan' }, { kind: 'not-taken', tail: { missing: ' Novak', retypable: true }, differs: { kind: 'length' } }],
    ['a non-input that changed but does not show the value: not-taken', 'Jan', { value: 'Jan Novak', isInput: false, resolvedValue: 'Name' }, { kind: 'not-taken', tail: { missing: ' Novak', retypable: true }, differs: { kind: 'length' } }],
    ['a non-input that changed to masked: it took the text, and the length missed', '••', { value: 'abcd', isInput: false, resolvedValue: 'Name', clear: true }, { kind: 'missed', differs: { kind: 'masked', held: undefined } }],
    ['an exact prefix: a tail to type again, its difference a length', 'Jan', { value: 'Jan Novak' }, { kind: 'missed', tail: { missing: ' Novak', retypable: true }, differs: { kind: 'length' } }],
    ['a grouped prefix: a tail to type again, its difference a dropped tail', '1 234 567,', { value: '1234567,89', clear: true }, { kind: 'missed', tail: { missing: '89', retypable: true }, differs: { kind: 'dropped-tail', landed: 8, dropped: 2, grouped: true } }],
    ['the orthogonal case: with clear, unchanged since typing began and a tail to type again', 'Jan', { value: 'Jan Novak', before: 'Jan', clear: true }, { kind: 'missed', tail: { missing: ' Novak', retypable: true }, differs: { kind: 'unchanged' } }],
    ['nothing of the typing in the prefix: a tail to name, none to type again', 'SK31', { value: '12000000', before: 'SK31' }, { kind: 'missed', tail: { missing: '12000000', retypable: false }, differs: { kind: 'unchanged' } }],
    ['a dropped tail that is a whole landing too: never typed again', '11 ', { value: '11', before: '1' }, { kind: 'missed', tail: { missing: '1', retypable: false }, differs: { kind: 'dropped-tail', landed: 1, dropped: 1, grouped: true, wholeToo: true } }],
    ['a length that is a whole landing too: never typed again', 'xaa', { value: 'aa', before: 'xa' }, { kind: 'missed', tail: { missing: 'a', retypable: false }, differs: { kind: 'length', wholeToo: true } }],
    ['the value itself lands, though it is a prefix of what the field should hold too', '55', { value: '55', before: '5' }, { kind: 'landed' }],
    ['the value decorated, inside the earlier text\'s span: never typed again', '-5-', { value: '-5', before: '-5' }, { kind: 'missed', tail: { missing: '5', retypable: false }, differs: { kind: 'length', wholeToo: true } }],
    ['no prefix: no tail', 'the', { value: 'teh' }, { kind: 'missed', differs: { kind: 'same-length', positions: 2 } }],
    ['bullets prove no prefix', '••', { value: '12345' }, { kind: 'missed', differs: { kind: 'masked', held: 0 } }],
  ];
  for (const [shape, observed, f, reading] of rows) it(shape, () => expect(readingOf(observed, expecting(f))).toEqual(reading));

  /** A small alphabet swept whole: what no row can promise, and every answer there is. */
  it('the invariants, over every reading of a small alphabet', () => {
    const CHARS = ['1', '2', 'a', 'A', 'b', ' ', '-', '•'];
    const readings = [''];
    for (let at = 0, n = 0; n < 3; n++) {
      const end = readings.length;
      for (; at < end; at++) for (const c of CHARS) readings.push(readings[at] + c);
    }
    const seen = new Set<string>();
    for (const value of ['1', '11', '12', 'ab', '1 '])
      for (const before of [null, '', '1', '12', 'a'])
        for (const clear of [false, true])
          for (const held of [0, 'unread'] as const)
            for (const placeholder of [undefined, '1'])
              for (const input of [{ isInput: true, resolvedValue: null }, { isInput: false, resolvedValue: '12' }])
                for (const observed of readings) {
                  const e: Expectation = { value, before, clear, held, placeholder, ...input };
                  const r = readingOf(observed, e);
                  const wrong = (why: string) => new Error(`${why}: ${JSON.stringify({ observed, e, r })}`);
                  // what a non-input proves: only by changing, to bullets or to show the value (a landing took it too)
                  const took = input.isInput || (observed !== input.resolvedValue && (isMaskedValue(observed) || observed.includes(value)));
                  if ((r.kind === 'not-taken') !== !took) throw wrong('not-taken iff the text was not taken');
                  if (r.kind === 'said-plain' && !(held === 'unread' && isMaskedValue(observed))) throw wrong('said-plain is a masked reading, the count unread');
                  seen.add(r.kind);
                  if (r.kind !== 'missed' && r.kind !== 'not-taken') continue;
                  const { tail, differs } = r;
                  seen.add(differs.kind);
                  if ('wholeToo' in differs && differs.wholeToo === true) {
                    if (tail === undefined || tail.retypable) throw wrong('wholeToo is a tail never typed again');
                    seen.add('wholeToo');
                  }
                  if (differs.kind === 'dropped-tail' && tail?.missing.length !== differs.dropped) throw wrong('a dropped-tail names the tail');
                  if (tail?.retypable === true && observed.includes('•')) throw wrong('a bullet proves no tail');
                  if (tail?.retypable === true && differs.kind === 'unchanged') seen.add('retypable and unchanged');
                }
    expect([...seen].sort()).toEqual(
      ['case', 'dropped-tail', 'landed', 'length', 'masked', 'masked-said-plain', 'missed', 'not-taken', 'placeholder', 'retypable and unchanged', 'said-plain', 'same-length', 'separated', 'unchanged', 'wholeToo'].sort(),
    );
  });
});

/** Keys proven typed elsewhere are no select-all (fill-type.ts's `elsewhere`): the hedge goes, the rest of the Difference stays. */
describe('withoutWholeToo — a Difference without its whole-landing hedge', () => {
  it('a dropped tail keeps its counts, a length its kind: the key itself is gone', () => {
    expect(withoutWholeToo({ kind: 'dropped-tail', landed: 1, dropped: 2, grouped: true, wholeToo: true })).toStrictEqual({ kind: 'dropped-tail', landed: 1, dropped: 2, grouped: true });
    expect(withoutWholeToo({ kind: 'length', wholeToo: true })).toStrictEqual({ kind: 'length' });
  });

  it('a Difference without the hedge is as it was', () => {
    const rows: Difference[] = [
      { kind: 'length' },
      { kind: 'dropped-tail', landed: 1, dropped: 2, grouped: false },
      { kind: 'unchanged' },
      { kind: 'masked', held: 3 },
      { kind: 'masked-said-plain' },
      { kind: 'case', positions: 1 },
      { kind: 'same-length', positions: 2 },
      { kind: 'separated', added: 2 },
    ];
    for (const d of rows) expect(withoutWholeToo(d)).toStrictEqual(d);
  });
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
    expect(droppedTail('SK31 1300', intent('SK3112000000'))).toBeUndefined();
    expect(droppedTail('1 234.567', intent('12345678'))).toBeUndefined();
    expect(droppedTail('1-2', intent('1234'))).toBeUndefined(); // groups of one
    expect(droppedTail('1 2', intent('1234'))).toBeUndefined();
    expect(droppedTail('••• •', intent('12345'))).toBeUndefined(); // bullets
    expect(droppedTail('SK31 1200 0000', intent('SK3112000000'))).toBeUndefined(); // the whole typing: no tail
  });

  it('the whole typing with an eager trailing mark is no prefix: no tail', () => {
    expect(droppedTail('SK31 1200 0000 ', intent('SK3112000000'))).toBeUndefined();
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

/**
 * D60 (ADR 0034's amendment): an EAGER field adds its mark once a group is complete, so a dropped end shows a strict
 * prefix and that mark (`SK31 1200 ` for `SK3112000000`). The mark is judged as if the next typed character had landed
 * after it, under every rule of `reformatOf` — so the tail is retyped, and the verdict names it, as any dropped tail.
 */
describe('droppedTail — a prefix that ends in an eager trailing mark (D60)', () => {
  it('an IBAN, a card, a phone, a dotted date: the rest of the typing', () => {
    expect(droppedTail('SK31 1200 ', intent('SK3112000000', null, true))).toBe('0000');
    expect(droppedTail('SK31 ', intent('SK3112000000', null, true))).toBe('12000000');
    expect(droppedTail('4111 1111 ', intent('4111111111111111', null, true))).toBe('11111111');
    expect(droppedTail('903 123 ', intent('903123456', null, true))).toBe('456');
    expect(droppedTail('31.12.', intent('31122026', null, true))).toBe('2026');
  });

  it('without clear: after a vanished placeholder, a vanished mask template, or the earlier text', () => {
    expect(droppedTail('SK31 1200 ', intent('SK3112000000', 'SK00 0000 0000 \u2026'))).toBe('0000'); // D29
    expect(droppedTail('31.12.', intent('31122026', '__.__.____'))).toBe('2026'); // D51
    expect(droppedTail('SK31 1200 ', intent('12000000', 'SK31'))).toBe('0000');
  });

  it('the earlier text and a mark alone: nothing of the typing landed, no tail', () => {
    expect(droppedTail('SK31 ', intent('12000000', 'SK31'))).toBeUndefined();
    expect(tailOf('SK31 ', intent('12000000', 'SK31'))).toEqual({ missing: '12000000', landed: 0, reformatted: { added: 1, respaced: 0 } });
  });

  it('a mark the typing holds itself, or one the rules refuse: no tail', () => {
    expect(droppedTail('12/', intent('1234/56', null, true))).toBeUndefined(); // the typed-mark guard
    expect(droppedTail('+421 903 ', intent('+421 903123456', null, true))).toBeUndefined(); // ADR 0034 residual 5
    expect(droppedTail('SK31 1200-', intent('SK3112000000', null, true))).toBeUndefined();
    expect(droppedTail('12.', intent('1234', null, true))).toBeUndefined();
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
    // the earlier text still there, its letters and digits a prefix of the value's: judged after it, not the fallback
    expect(landingOf('421 421 903 123 456', expecting(e('421903123456', '421')))).toEqual({ kind: 'landed', reformatted: { added: 4, respaced: 0 } });
  });

  // D61: the reading's letters and digits are the value's exactly, and no start of the earlier text's plus the value's:
  // the earlier text is not in it. Pinned refused by D29 (`1` still there), it lands as the value alone — as the exact
  // rule already passes the ungrouped `12345678` after the same `1` (ADR 0034's D61 amendment).
  it('landingOf: the value grouped, its letters and digits exactly the value\'s, after an earlier text that starts them (D61)', () => {
    expect(landingOf('1234 5678', expecting(e('12345678', '1')))).toEqual({ kind: 'landed', reformatted: { added: 1, respaced: 0 } });
  });

  // D61 review round 1, MINOR: accepted, not a guard — with repeated characters a dropped key other than the head
  // leaves the same reading (`1` held, `1100` typed, the second key lost: `1` + `100`, shown `1,100`). It now passes,
  // with the point line (main: same-length), as the exact rule already passes the ungrouped `1100` after the same `1`.
  it('landingOf: `1,100` after `1`, typed `1100` — an accepted pass, as the exact rule accepts it ungrouped (D61)', () => {
    expect(landingOf('1,100', expecting(e('1100', '1')))).toEqual({ kind: 'landed', reformatted: { added: 1, respaced: 0, point: ',' } });
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

  // D29 review round 2, MINOR-A (the owner's decision): an earlier text with no letters or digits (a dash) keeps the
  // pre-D29 judgment — a false mismatch, never a wrong pass; deliberately not loosened. A `_` mask template since D51,
  // below.
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
 * D61: idb names no placeholder, so the form-grouped cell's phoneGrouped (format phone3, placeholder `+421`) read `+421`
 * as the empty field's value — fill's `before`. batch-9 g3: typed `421903123456` without clear, the field held `421 903
 * 123 456`, and the fill failed "typed 12 characters but the field shows 15": the reading's letters and digits START
 * with the placeholder's, so D29's fallback never ran. Since D61 a reading whose letters and digits are exactly the
 * value's, and no start of the earlier text's plus the value's, is judged as the value alone as well.
 */
describe('an unnamed placeholder whose letters and digits start the value\'s (D61)', () => {
  const e = (value: string, before: string | null, clear = false) => ({ value, clear, before, placeholder: undefined });

  it('landingOf: g3 — `421 903 123 456` after the unnamed `+421` lands reformatted', () => {
    expect(landingOf('421 903 123 456', expecting(e('421903123456', '+421')))).toEqual({ kind: 'landed', reformatted: { added: 3, respaced: 0 } });
  });

  it('landingOf: g4 without clear — `+421 903 123 456` for `+421903123456` after `+421` lands reformatted', () => {
    expect(landingOf('+421 903 123 456', expecting(e('+421903123456', '+421')))).toEqual({ kind: 'landed', reformatted: { added: 3, respaced: 0 } });
  });

  it('landingOf: with clear unchanged — the earlier text never counts', () => {
    expect(landingOf('421 903 123 456', expecting(e('421903123456', '+421', true)))).toEqual({ kind: 'landed', reformatted: { added: 3, respaced: 0 } });
  });

  // the second conjunct: a reading that is only the earlier text, regrouped, is a start of the earlier text plus the
  // value — none of the typing is shown, and it is never judged as the value alone. (`+421` read for a typed `421` after
  // `+421` passed the exact rule's `includes`, not this one: outside D61; since D63 it is no landing — D63's group.)
  it('landingOf: a reading that is still the earlier text alone, regrouped, is no landing', () => {
    expect(landingOf('1 234', expecting(e('1234', '1234')))).toBeUndefined();
  });

  it('differenceOf: mixed marks after the unnamed `+421` are separated, not a length', () => {
    expect(differenceOf('421 903-123-456', { value: '421903123456', clear: false, before: '+421', placeholder: undefined, held: 0 })).toEqual({ kind: 'separated', added: 3 });
  });

  // the wording only, never a pass: a full reading with an eager trailing mark (D60's `separated`) under the unnamed `+421`
  it('differenceOf: a full reading with an eager trailing mark after the unnamed `+421` is separated, not a length', () => {
    expect(differenceOf('421 903 123 456 ', { value: '421903123456', clear: false, before: '+421', placeholder: undefined, held: 0 })).toEqual({ kind: 'separated', added: 4 });
    expect(landingOf('421 903 123 456 ', expecting(e('421903123456', '+421')))).toBeUndefined();
  });

  // residual 6: the equality form — a dropped tail under the unnamed placeholder is not typed again; clear: true is the remedy
  it('tailOf: a dropped tail under the unnamed `+421` is no tail — not typed again (ADR 0034 residual 6)', () => {
    expect(tailOf('421 903 123', e('421903123456', '+421'))).toBeUndefined();
    expect(droppedTail('421 903 123', e('421903123456', '+421'))).toBeUndefined();
    expect(differenceOf('421 903 123', { value: '421903123456', clear: false, before: '+421', placeholder: undefined, held: 0 })).toEqual({ kind: 'length' });
  });
});

/**
 * D51: an earlier text of `_` and separators alone, at least one `_` (`fill-reformat.ts#maskTemplate`), is tried as no
 * earlier text as well, second — idb reads the date field's unnamed `__.__.____` as its text before (D29). Why, and how
 * it narrows D29's MINOR-A: ADR 0034's D51 amendment.
 */
describe('a mask template is no earlier text (D51)', () => {
  const MASK = '__.__.____';
  const e = (value: string, before: string | null, clear = false) => ({ value, clear, before, placeholder: undefined });

  it('landingOf: a dotted date after its vanished template lands reformatted', () => {
    expect(landingOf('31.12.2026', expecting(e('31122026', MASK)))).toEqual({ kind: 'landed', reformatted: { added: 2, respaced: 0 } });
    expect(landingOf('31/12/2026', expecting(e('31122026', '__/__/____')))).toEqual({ kind: 'landed', reformatted: { added: 2, respaced: 0 } });
  });

  it('landingOf: a dotted date with nothing before, or cleared, lands by the digit grouping alone', () => {
    expect(landingOf('31.12.2026', expecting(e('31122026', null)))).toEqual({ kind: 'landed', reformatted: { added: 2, respaced: 0 } });
    expect(landingOf('31.12.2026', expecting(e('31122026', MASK, true)))).toEqual({ kind: 'landed', reformatted: { added: 2, respaced: 0 } });
  });

  it('landingOf: a mask still showing blanks, a lost sign, a dash: none', () => {
    expect(landingOf('31.12.____', expecting(e('31122026', MASK)))).toBeUndefined(); // `_` is no separator
    expect(landingOf('1.234.567', expecting(e('1234567', '-')))).toBeUndefined(); // `-` is no template: a sign lost
    expect(landingOf('SK31 1200 0000', expecting(e('SK3112000000', '\u2014')))).toBeUndefined(); // MINOR-A's own case
  });

  it('landingOf: an earlier date the field kept, or replaced on focus', () => {
    expect(landingOf('01.01.2000', expecting(e('31122026', '01.01.2000')))).toBeUndefined();
    expect(differenceOf('01.01.2000', expecting(e('31122026', '01.01.2000')))).toEqual({ kind: 'unchanged' });
    expect(landingOf('31.12.2026', expecting(e('31122026', '01.01.2000')))).toEqual({ kind: 'landed', reformatted: { added: 2, respaced: 0 } });
  });

  it('tailOf: a dotted date\'s prefix after the template is a dropped tail, the template itself none of the typing', () => {
    expect(tailOf('31.12.20', e('31122026', MASK))).toEqual({ missing: '26', landed: 6, reformatted: { added: 2, respaced: 0 } });
    expect(droppedTail('31.12.20', e('31122026', MASK))).toBe('26');
    expect(tailOf(MASK, e('31122026', MASK))?.landed).toBe(0); // the template tried first: nothing of the typing landed
    expect(droppedTail(MASK, e('31122026', MASK))).toBeUndefined();
  });

  it('differenceOf: a typing longer than the date field takes is a dropped tail, grouped', () => {
    expect(differenceOf('31.12.2026', expecting(e('311220261', null)))).toEqual({ kind: 'dropped-tail', landed: 8, dropped: 1, grouped: true });
  });
});

/**
 * D63: without clear, the exact rule asked only that the reading CONTAIN the value, so a reading still exactly what the
 * field showed when typing began passed whenever that earlier text held the value — a field that refused the keys (the
 * lab's date at its 8-digit cap: `31.12.2026` typed `2026`), keys that went into another input, idb's unnamed
 * placeholder holding the value (`+421` typed `421`). Such a reading has not landed — unless it is the value itself —
 * and the poll ends on `differenceOf`'s `unchanged`.
 */
describe('a reading unchanged since typing began has not landed (D63)', () => {
  const e = (value: string, before: string | null, clear = false) => ({ value, clear, before, placeholder: undefined });

  it.each([
    ['Hello world', 'world', 'an earlier text that holds the value'],
    ['+421', '421', "idb's unnamed placeholder (D61 left this guard to D63)"],
    ['SK00 0000 0000 …', '0000', "idb's unnamed iban placeholder"],
    ['Jan Šťastný', 'Jan', 'a form-prefilled name'],
    ['31.12.2026', '2026', 'the date field at its 8-digit cap'],
  ])('landingOf: `%s` typed `%s` (%s), nothing landed: none, and the difference is unchanged', (shown, value) => {
    expect(landingOf(shown, expecting(e(value, shown)))).toBeUndefined();
    expect(differenceOf(shown, expecting(e(value, shown)))).toEqual({ kind: 'unchanged' });
  });

  // residual: a reading that is both the earlier text and the value cannot be told from a select-all field that retyped
  // it, or a placeholder equal to the value — it lands as before
  it('landingOf: the reading is the value itself — landed, and a named placeholder equal to it stays `placeholder`', () => {
    expect(landingOf('421', expecting(e('421', '421')))).toEqual({ kind: 'landed' });
    expect(landingOf('Search', expecting({ value: 'Search', before: 'Search', placeholder: 'Search' }))).toEqual({ kind: 'placeholder' });
  });

  it('landingOf: a reading that moved still lands by containment', () => {
    expect(landingOf('Hello worldworld', expecting(e('world', 'Hello world')))).toEqual({ kind: 'landed' });
    expect(landingOf('Hello world', expecting(e('world', 'Hello')))).toEqual({ kind: 'landed' });
  });

  // equality, not trimmed: a typed space after the earlier text moves the reading
  it('landingOf: a typed space after `Hello world` lands — the reading moved, though only by whitespace', () => {
    expect(landingOf('Hello world ', expecting(e(' ', 'Hello world')))).toEqual({ kind: 'landed' });
  });

  // ADR 0034 residual 8 (A), pinned here as D63 left it (landed: the value found inside the earlier text), flipped on
  // purpose by D64: without clear the value must be in what was typed past the earlier text, and `w` is all of it here
  it('D64 (A): a reading that moved but holds none of the typing past the earlier text has not landed; its tail is dropped', () => {
    // `w` landed, `orld` went elsewhere: the value is only inside the earlier text `Hello world`
    expect(landingOf('Hello worldw', expecting(e('world', 'Hello world')))).toBeUndefined();
    expect(droppedTail('Hello worldw', e('world', 'Hello world'))).toBe('orld');
  });

  // a `before` of `''` is taken at its word (an eager formatter can turn a typed `421` into `+421 ` from a truly empty
  // field): the focus-inserted case is fill.ts's skipped re-read, ADR 0028's residual 3 since D64 (follow-up D64b)
  it('residual 8 (B): Android\'s skipped post-focus re-read takes `before` as empty; a `+421 ` inserted on focus, no key landed, lands', () => {
    expect(landingOf('+421 ', expecting(e('421', '')))).toEqual({ kind: 'landed' });
  });

  it('landingOf: with clear the rule is the value alone, unchanged by D63', () => {
    expect(landingOf('1 234', expecting(e('1234', '1 234', true)))).toEqual({ kind: 'landed', reformatted: { added: 1, respaced: 0 } });
  });

  it('landingOf: a masked reading unchanged since typing began is judged by its length, as before', () => {
    expect(landingOf('•••••', expecting({ value: '•••', before: '•••••', held: 5 }))).toBeUndefined();
    expect(differenceOf('•••••', expecting({ value: '•••', before: '•••••', held: 5 }))).toEqual({ kind: 'unchanged' });
  });
});

/**
 * The mismatch's classification, as `Difference` codes — the wording is
 * fill-text.test.ts's, and fill.test.ts pins a few end to end. One row per
 * rule of differenceOf, in its order, each row naming the shape it stands
 * for; `before` defaults to null (nothing shown when typing began), `clear`
 * to false.
 */
/**
 * D64 (A): without clear, the exact rule searched the WHOLE reading, earlier text included, for the value — so a reading
 * that moved but held none of the typing passed whenever the earlier text held the value: a length cap (the lab's date
 * `31.12.202` typed `12` keeps `31.12.2021`), an iOS React Native burst that kept a prefix (`Note: hellohe`), keys that
 * went into another input. The value must now be in what was typed past the earlier text — `differenceOf`'s own notion
 * of the typing (`typedPartOf`): what follows the earlier text when the reading still starts with it literally, else the
 * whole reading. Such a reading is a dropped tail, which iOS types again.
 */
describe('without clear, the value must be in the typing past the earlier text (D64)', () => {
  const e = (value: string, before: string | null, f: Partial<Expectation> = {}) => expecting({ value, before, ...f });

  it.each([
    ['Hello worldwor', 'world', 'Hello world', 'ld', 'a 14-character cap'],
    ['31.12.2021', '12', '31.12.202', '2', "the lab's date at its 8-digit cap (f16)"],
    ['Note: hellohe', 'hello', 'Note: hello', 'llo', 'an iOS React Native burst that kept a prefix'],
  ])('`%s` typed `%s` after `%s`: no landing, the tail `%s` dropped, the difference a length (%s)', (shown, value, before, tail) => {
    expect(landingOf(shown, e(value, before))).toBeUndefined();
    expect(droppedTail(shown, e(value, before))).toBe(tail);
    expect(differenceOf(shown, e(value, before))).toEqual({ kind: 'length' });
  });

  // the overlap form (an occurrence that only ENDS past the earlier text) would pass this: only `ld` landed
  it('a typing whose value is found only across the seam is no landing (`Hello wor` typed `world` reads `Hello world`)', () => {
    expect(landingOf('Hello world', e('world', 'Hello wor'))).toBeUndefined();
  });

  it.each([
    ['Hello worldworld', 'world', 'Hello world', 'the whole typing after the earlier text'],
    ['Hello world', 'world', 'Hello', 'an earlier text that does not hold the value'],
    ['Jan ŠťastnýJan', 'Jan', 'Jan Šťastný', 'a prefilled name that holds the value'],
    ['world', 'world', 'Hello world', 'a select-all field that replaced its text with the value'],
    ['421903123456', '421903123456', '+421', "idb's unnamed placeholder replaced (f13)"],
    ['+421421903123456', '421903123456', '+421', "idb's unnamed placeholder kept"],
    ['Hello woworldrld', 'world', 'Hello world', 'the caret inside the text: the reading no longer starts with it, judged whole'],
    ['Hello world', 'world', 'hello ', 'an earlier text autocorrected: judged whole'],
    ['SK31 1200 ', 'SK31 1200', '', 'an eager trailing mark, nothing before'],
    ['Note SK31 1200 ', 'SK31 1200', 'Note ', 'an eager trailing mark after an earlier text'],
    ['ear', 'ear', 'Search', "idb's unnamed placeholder vanished"],
    ['Searchear', 'ear', 'Search', "idb's unnamed placeholder kept"],
    ['+421 421', '421', '+421 ', 'an earlier text that holds the value, the typing after it'],
  ])('`%s` typed `%s` after `%s` lands as before (%s)', (shown, value, before) => {
    expect(landingOf(shown, e(value, before))).toEqual({ kind: 'landed' });
  });

  it('a named placeholder is no earlier text: `Searchear` and `Search ear` for `ear` land', () => {
    expect(landingOf('Searchear', e('ear', 'Search', { placeholder: 'Search' }))).toEqual({ kind: 'landed' });
    expect(landingOf('Search ear', e('ear', null, { placeholder: 'Search' }))).toEqual({ kind: 'landed' });
  });

  // the earlier text must START the reading to be cut off: one found later is part of the typing
  it('the caret at the start: `Hello ` typed before `world` reads `Hello world`, which lands', () => {
    expect(landingOf('Hello world', e('Hello ', 'world'))).toEqual({ kind: 'landed' });
  });

  // the same where the reading's letters and digits still start with the earlier text's, so no prior but it is tried
  // (`priorsOf`): a sign typed at the caret before the number
  it('the caret at the start: `-` typed before `5` reads `-5`, which lands', () => {
    expect(landingOf('-5', e('-', '5'))).toEqual({ kind: 'landed' });
  });

  it('with clear the rule is equality, untouched', () => {
    expect(landingOf('Hello worldw', e('Hello worldw', 'Hello world', { clear: true }))).toEqual({ kind: 'landed' });
  });

  // review round 1, M-1: the earlier text is judged over D61's priors — a reading whose letters and digits are exactly
  // the value's, and no start of the earlier text's plus the value's, is judged as the value alone too (`valueAlone`)
  it.each([
    ['+421903123456', '421903123456', '+421', "a leading `+` the field adds, under idb's unnamed `+421`"],
    ['SK31 ', 'SK31', 'SK3', 'a select-all field and an eager trailing mark'],
    ['abc ', 'abc', 'ab', 'a select-all field and a trailing space'],
    ['50%', '50', '5', 'a select-all field and a decoration'],
  ])('`%s` typed `%s` after `%s` lands (%s): the value alone (D61)', (shown, value, before) => {
    expect(landingOf(shown, e(value, before))).toEqual({ kind: 'landed' });
  });

  // review round 1, m-2: a reading that holds the value across the seam (an occurrence that ends past the earlier
  // text) is also explained as a full landing — a select-all field with an eager mark, a caret not at the end — so its
  // "tail" is not typed again: retyped, the field could end Filled over content the retype made wrong
  it.each([
    ['11 ', '11', '1', 'a select-all field and an eager trailing mark, or `1` landed with a mark'],
    ['a1 1', '1 ', 'a1', 'the caret inside the text'],
    ['Hello world', 'world', 'Hello wor', 'only `ld` landed, the value across the seam'],
  ])('`%s` typed `%s` after `%s` (%s): no landing, and no tail to type again', (shown, value, before) => {
    expect(landingOf(shown, e(value, before))).toBeUndefined();
    expect(droppedTail(shown, e(value, before))).toBeUndefined();
  });

  // the value typed again over itself (residual 7's shape) into a select-all field that adds a mark: the reading is the
  // value, decorated, wholly inside the earlier text's span — a whole landing as much as a dropped tail
  it.each([
    ['-5-', '-5', '-5'],
    [' 42 ', ' 42', ' 42'],
  ])('`%s` typed `%s` after `%s`: the value alone, decorated — no tail to type again', (shown, value, before) => {
    expect(landingOf(shown, e(value, before))).toBeUndefined();
    expect(droppedTail(shown, e(value, before))).toBeUndefined();
  });

  // the decorated-value clause asks that the reading hold the value: a dropped trailing mark has the value's letters
  // and digits but not the value, and is typed again
  it('a typed `12/` that kept `12` (with or without an earlier text) still has its `/` typed again', () => {
    expect(droppedTail('12', e('12/', null))).toBe('/');
    expect(droppedTail('Note: 12', e('12/', 'Note: '))).toBe('/');
  });

  // review round 2, NIT-2: the miss keeps its kind, and says it is a whole landing too, for the wording
  it('differenceOf: `11 ` after `1` and `a1 1` after `a1` are dropped tails that are whole landings too', () => {
    expect(differenceOf('11 ', e('11', '1'))).toEqual({ kind: 'dropped-tail', landed: 1, dropped: 1, grouped: true, wholeToo: true });
    expect(differenceOf('a1 1', e('1 ', 'a1'))).toEqual({ kind: 'dropped-tail', landed: 1, dropped: 1, grouped: true, wholeToo: true });
  });

  // D64 code review: every shape whose tail is not typed again is marked, whatever its kind — an exact prefix reads
  // `length`
  it.each([
    ['-5-', '-5', '-5'],
    [' 42 ', ' 42', ' 42'],
    ['55', '55', '5'],
  ])('differenceOf: `%s` for `%s` after `%s`, no tail typed again, is a length that is a whole landing too', (shown, value, before) => {
    expect(differenceOf(shown, e(value, before))).toEqual({ kind: 'length', wholeToo: true });
  });

  it('differenceOf: a length whose tail is typed again is not marked (`Hello worldwor`, the seam `Hello world`)', () => {
    expect(differenceOf('Hello worldwor', e('world', 'Hello world'))).toEqual({ kind: 'length' });
    expect(differenceOf('Hello world', e('world', 'Hello wor'))).toEqual({ kind: 'length' });
  });

  it('a value only inside the earlier text is no full landing: the tail is still typed again (`Note: hellohe`, f16)', () => {
    expect(droppedTail('Note: hellohe', e('hello', 'Note: hello'))).toBe('llo');
    expect(droppedTail('31.12.2021', e('12', '31.12.202'))).toBe('2');
  });

  // ADR 0034's D64 amendment, residual R-a: on the safe side
  it.each([
    ['aba', 'ab', 'a', 'the caret at the start'],
    ['aaba', 'ab', 'aa', 'the caret inside the text'],
    ['abab', 'ba', 'ab', 'the caret inside the text'],
  ])('residual 9: `%s` for `%s` after `%s` (%s), the reading still starting with the earlier text, is refused', (shown, value, before) => {
    expect(landingOf(shown, e(value, before))).toBeUndefined();
  });
});

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
    ['no clear: of several runs that match but for case, the closest counts — not the last', { observed: 'Hello HELLO', value: 'hello' }, { kind: 'case', positions: 1 }],
    ['no clear, the held text changed too: compared whole, closest run', { observed: 'NOTE: HI THERE', before: 'xyz', value: 'hi there' }, { kind: 'case', positions: 7 }],
    ['with clear the earlier text is gone: the whole reading is the typing (`priorText`)', { observed: 'abXY', before: 'ab', value: 'abxy', clear: true }, { kind: 'case', positions: 2 }],
    ['with clear the field must EQUAL the value: longer but for case is a length', { observed: 'Re: Hello', value: 'hello', clear: true }, { kind: 'length' }],
    ['autocorrect `teh` → `the`: same length, how many differ', { observed: 'the', value: 'teh' }, { kind: 'same-length', positions: 2 }],
    ['held `HELLo` is not the typing: only `hxllo` after it is compared', { observed: 'HELLohxllo', before: 'HELLo', value: 'hello' }, { kind: 'same-length', positions: 1 }],
    // D53: `1234 5` stood here until D53 — a reformat that passes since D18, which differenceOf never sees (it reads
    // `separated` called directly); a mark outside SEPARATORS keeps the row a length
    ['a mask that inserts marks the fill does not take (`(`, `)`)', { observed: '(12) 345', value: '12345' }, { kind: 'length' }],
    ['typing onto a field showing only its placeholder: the placeholder is no held text, so nothing is sliced off', { observed: 'Searchx', before: 'Search', value: 'searchx', placeholder: 'Search' }, { kind: 'case', positions: 1 }],
    ['a field that fell back to its named placeholder holds no text: never "but for case"', { observed: 'Company', before: 'Zed', value: 'company', placeholder: 'Company' }, { kind: 'length' }],
    ['a pair equal only upper-cased (dotless `ı`, `i`) is case too', { observed: 'ıd', value: 'id', clear: true }, { kind: 'case', positions: 1 }],
    ['a pair equal only lower-cased (the Kelvin sign `\u212A`, `k`) is case too', { observed: '\u212Ad', value: 'kd', clear: true }, { kind: 'case', positions: 1 }],
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
    // D53: every typed character, in order, with separators ADR 0034's rules refuse as grouping — after dropped-tail
    ['a cents mask (`12.34` for `1234`): separated, not a length', { observed: '12.34', value: '1234', clear: true }, { kind: 'separated', added: 1 }],
    ['mixed marks (`+421 900-123-456`)', { observed: '+421 900-123-456', value: '+421900123456', clear: true }, { kind: 'separated', added: 3 }],
    ['an eager trailing mark (`SK31 `)', { observed: 'SK31 ', value: 'SK31', clear: true }, { kind: 'separated', added: 1 }],
    ['groups of one (`1 2 3 4`)', { observed: '1 2 3 4', value: '1234', clear: true }, { kind: 'separated', added: 3 }],
    ['no clear, the field empty before', { observed: '12.34', before: '', value: '1234' }, { kind: 'separated', added: 1 }],
    ['no clear onto held text: judged after it (`priorsOf`, the earlier text first)', { observed: 'ab12.34', before: 'ab', value: '1234' }, { kind: 'separated', added: 1 }],
    ['no clear: a mark added inside the earlier text counts too', { observed: 'a-b1234', before: 'ab', value: '1234' }, { kind: 'separated', added: 1 }],
    ['an unnamed placeholder that vanished (D29): judged as no earlier text', { observed: '12.34', before: 'SK00 0000 0000 \u2026', value: '1234' }, { kind: 'separated', added: 1 }],
    ['after a vanished mask template (D51)', { observed: '12.34', before: '__.__', value: '1234' }, { kind: 'separated', added: 1 }],
    ['a field showing its named placeholder holds no text: a length, never separated', { observed: '0.00', value: '000', placeholder: '0.00' }, { kind: 'length' }],
    ['a reading equal to the text before the typing: unchanged first', { observed: '12.34', before: '12.34', value: '1234', clear: true }, { kind: 'unchanged' }],
    ['bullets with a mark: a partly masked length, never separated', { observed: '•••.•', value: '1234' }, { kind: 'length' }],
    ['a reformatted strict prefix stays a dropped tail', { observed: '12 3', value: '1234', clear: true }, { kind: 'dropped-tail', landed: 3, dropped: 1, grouped: true }],
    // D60: a dropped tail ending in an eager trailing mark is a dropped tail (it was a length, the trailing mark refused)
    ['a dropped tail ending in an eager trailing mark', { observed: 'SK31 1200 ', value: 'SK3112000000', clear: true }, { kind: 'dropped-tail', landed: 8, dropped: 4, grouped: true }],
    ['the same without clear onto the earlier text', { observed: 'SK31 1200 ', before: 'SK31', value: '12000000' }, { kind: 'dropped-tail', landed: 4, dropped: 4, grouped: true }],
    ['the earlier text and an eager mark alone: no dropped tail', { observed: 'SK31 ', before: 'SK31', value: '12000000' }, { kind: 'length' }],
    ['the whole typing with an eager trailing mark stays separated', { observed: 'SK31 1200 0000 ', value: 'SK3112000000', clear: true }, { kind: 'separated', added: 3 }],
    ['a changed separator stays same-length', { observed: '12,34', value: '12.34', clear: true }, { kind: 'same-length', positions: 1 }],
    ['before case: the held text matches but for case only in a run of the earlier text — the typing is all there', { observed: 'x,ABa-b', before: 'xAB', value: 'ab' }, { kind: 'separated', added: 2 }],
  ];
  for (const [shape, f, kind] of rows) it(shape, () => expect(differs(f)).toEqual(kind));
});

/**
 * D28's invariant, swept: the typing and the verdict judge a prefix alike. Every reading that `tailOf` says holds some
 * of the typing, reformatted by the field, is a `dropped-tail` to `differenceOf` — with the same count landed. The
 * readings are every prefix of the expected text grouped as fields group it (fours, thousands from the right, pairs;
 * spaces, no-break spaces and the marks), after an earlier text, a vanished unnamed placeholder or none. D60: a prefix
 * that ends in a mark is what an eager field (a mark once a group is complete) shows after a drop, so the same prefixes
 * sweep it — an eager grouping adds no prefix of its own (only the full reading with its mark, which is no prefix).
 */
describe('tailOf and differenceOf agree on a dropped tail (D28)', () => {
  const groupLeft = (t: string, n: number, sep: string) => (t.match(new RegExp(`.{1,${n}}`, 'gu')) ?? []).join(sep);
  const groupRight = (t: string, n: number, sep: string) => [...groupLeft([...t].reverse().join(''), n, sep)].reverse().join('');
  // A mark's kind, all spaces one (as fill-reformat.ts#holdsMark): an added mark is one the typing holds no kind of.
  const kindOf = (c: string) => (/\s/u.test(c) ? ' ' : c);
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
    let trailing = 0;
    for (const c of cases) {
      const e = expecting({ value: '', ...c });
      const whole = (e.clear ? '' : (e.before ?? '')) + e.value;
      const plain = whole.replace(/[\s.,]/gu, '');
      const shapes = [whole, plain];
      for (const sep of [' ', ' ', ' ', ',', '.', '-', '/'])
        for (const n of [2, 3, 4]) shapes.push(groupLeft(plain, n, sep), groupRight(plain, n, sep), groupLeft(whole, n, sep));
      for (const shape of shapes)
        for (let k = 1; k <= [...shape].length; k++) {
          const reading = [...shape].slice(0, k).join('');
          const tail = tailOf(reading, e);
          if (tail === undefined || tail.landed <= 0 || tail.reformatted === undefined) continue; // some of the typing landed
          swept++;
          const last = [...reading].at(-1) ?? '';
          if (SEPARATORS.has(last) && ![...whole].some((c) => kindOf(c) === kindOf(last))) trailing++; // an added mark last: D60's
          expect(differenceOf(reading, e), JSON.stringify({ reading, c })).toMatchObject({ kind: 'dropped-tail', landed: tail.landed });
        }
    }
    expect(swept).toBeGreaterThan(50); // the sweep is not vacuous
    expect(trailing).toBeGreaterThan(200); // nor its D60 part: prefixes that end in an added (eager) trailing mark
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
