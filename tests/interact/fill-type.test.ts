import { describe, expect, it, vi } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { droppedTail, MAX_TAIL_RETYPES, reformatOf, typeAndConfirm, type FieldIo, type TypingIntent } from '../../src/interact/fill-type.js';
import { node } from '../helpers/fake.js';

vi.mock('../../src/util/sleep.js', () => ({ sleep: async () => undefined }));

/**
 * What of a typing a field's reading proves dropped — the only text fillField ever types again
 * (docs/bugs/2026-10-19-ios-fill-loses-the-tail-of-its-text-in-a-react-native-single-line-field.md). The retype
 * itself is pinned through fillField (fill.test.ts), the module's one caller, and here through `typeAndConfirm`'s
 * own interface with a scripted field.
 */
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
 * A scripted field: `typeText` lands what `keep` lets through of each typing (in order), a read returns the field's
 * text, and the screen is the field and one other input whose value the script may change while typing.
 */
function scripted(opts: { keep?: number[]; elsewhere?: (text: string) => string | null; grows?: boolean; moves?: boolean; otherHeld?: string; format?: (text: string) => string } = {}) {
  const keeps = [...(opts.keep ?? [])];
  const field = node({ role: 'textfield', identifier: 'f', rect: { x: 0, y: 0, width: 100, height: 20 }, value: null });
  const other = node({ role: 'textfield', identifier: 'o', rect: { x: 0, y: 40, width: 100, height: 20 }, value: opts.otherHeld ?? null });
  const tree = node({ role: 'container', rect: { x: 0, y: 0, width: 400, height: 800 }, children: [field, other] });
  const typed: string[] = [];
  /** Each `reportDroppedTail`, as the count of typings sent before it (D24). */
  const dropped: number[] = [];
  let pending = ''; // `grows`: one more character of the typing arrives per read
  const snapshot = (): UiNode => structuredClone(tree);
  let last: UiNode | undefined = snapshot();
  const io: FieldIo = {
    type: async (text) => {
      typed.push(text);
      const keep = keeps.shift() ?? text.length;
      if (opts.grows) pending += text;
      else field.value = (field.value ?? '') + text.slice(0, keep);
      if (opts.format) field.value = opts.format(field.value ?? '');
      if (opts.elsewhere) other.value = opts.elsewhere(text);
      if (opts.moves) other.rect = { ...other.rect, y: other.rect.y + 10 };
    },
    wipe: async (count) => {
      field.value = (field.value ?? '').slice(0, Math.max(0, (field.value ?? '').length - count)) || null;
    },
    read: async () => {
      if (opts.grows && pending.length > 1) {
        field.value = (field.value ?? '') + pending[0];
        pending = pending.slice(1);
      }
      last = snapshot();
      return field.value ?? '';
    },
    screen: () => last,
    reportDroppedTail: () => dropped.push(typed.length),
  };
  const intent: TypingIntent = {
    value: 'Jan Novak',
    clear: false,
    isInput: true,
    resolvedValue: null,
    before: null,
    placeholder: undefined,
    maskedHeld: 0,
    pollMs: 1,
    field,
    delivery: 'on-return',
  };
  return { io, intent, typed, field, dropped };
}

describe('typeAndConfirm — type, confirm, and send again only what the field provably dropped', () => {
  it('a landed typing sends nothing again', async () => {
    const { io, intent, typed, dropped } = scripted();
    expect(await typeAndConfirm(io, intent)).toEqual({ kind: 'landed', observed: 'Jan Novak', again: [] });
    expect(typed).toEqual(['Jan Novak']);
    expect(dropped).toEqual([]);
  });

  it('a dropped tail is typed again, and every retype is in `again`, in order', async () => {
    const { io, intent, typed, dropped } = scripted({ keep: [3, 3] });
    expect(await typeAndConfirm(io, intent)).toEqual({
      kind: 'landed',
      observed: 'Jan Novak',
      again: [
        { kind: 'tail', length: 6 },
        { kind: 'tail', length: 3 },
      ],
    });
    expect(typed).toEqual(['Jan Novak', ' Novak', 'vak']);
    // D24: the drop is reported once, after the typing landed whole through a tail typed again — the adapter's to act on
    // in later typings.
    expect(dropped).toEqual([3]);
  });

  // D24 review: a capped or trimming field (maxLength, an IBAN or phone mask) keeps a strict prefix for good. Its one
  // retype changes nothing, the fill fails (ADR 0023), and that is no drop: the app must not be marked for it.
  it('a capped field (its retype moves nothing) is not reported as a drop', async () => {
    const { io, intent, typed, dropped } = scripted({ keep: [5, 0] });
    expect((await typeAndConfirm(io, intent)).kind).toBe('missed');
    expect(typed).toEqual(['Jan Novak', 'ovak']);
    expect(dropped).toEqual([]);
  });

  it('a tail retype that moved the field but never landed it whole is not reported either', async () => {
    const { io, intent, dropped } = scripted({ keep: [3, 3, 0] });
    expect((await typeAndConfirm(io, intent)).kind).toBe('missed');
    expect(dropped).toEqual([]);
  });

  it(`at most ${MAX_TAIL_RETYPES} tails; then, with clear, the one wipe and retype — still in the order sent`, async () => {
    const { io, intent, typed } = scripted({ keep: [3, 1, 1, 2] });
    const out = await typeAndConfirm(io, { ...intent, clear: true });
    expect(out).toEqual({
      kind: 'missed',
      observed: 'Ja',
      again: [
        { kind: 'tail', length: 6 },
        { kind: 'tail', length: 5 },
        { kind: 'whole', wiped: true },
      ],
    });
    expect(typed).toEqual(['Jan Novak', ' Novak', 'Novak', 'Jan Novak']);
  });

  it('a reading still growing at the end of the poll is not typed into again', async () => {
    const { io, intent, typed } = scripted({ grows: true });
    const out = await typeAndConfirm(io, intent);
    expect(out.kind).toBe('missed');
    expect(typed).toEqual(['Jan Novak']);
  });

  it('another input that changed while typing stops every send-again, and is named', async () => {
    const { io, intent, typed } = scripted({ keep: [3], elsewhere: (t) => t.slice(3) });
    expect(await typeAndConfirm(io, { ...intent, clear: true })).toEqual({
      kind: 'missed',
      observed: 'Jan',
      again: [],
      elsewhere: { role: 'textfield', identifier: 'o', rect: { x: 0, y: 40, width: 100, height: 20 } },
    });
    expect(typed).toEqual(['Jan Novak']);
  });

  it('a sibling the app replaced or recomputed proves nothing: no tail, and the clear\'s wipe and retype still runs', async () => {
    const recomputed = scripted({ keep: [3], elsewhere: () => 'EUR 18' });
    expect(await typeAndConfirm(recomputed.io, recomputed.intent)).toEqual({ kind: 'missed', observed: 'Jan', again: [] });
    expect(recomputed.typed).toEqual(['Jan Novak']);
    const cleared = scripted({ keep: [3], elsewhere: () => 'EUR 18' });
    expect(await typeAndConfirm(cleared.io, { ...cleared.intent, clear: true })).toEqual({
      kind: 'landed',
      observed: 'Jan Novak',
      again: [{ kind: 'whole', wiped: true }],
    });
  });

  it('only an APPENDED part of the missing text is proof: a sibling shortened to such a part, or one that gained it after other text, is not', async () => {
    const shrunk = scripted({ keep: [3], otherHeld: 'Novak!', elsewhere: () => 'Nov' });
    expect((await typeAndConfirm(shrunk.io, { ...shrunk.intent, clear: true })).kind).toBe('landed'); // the wipe and retype ran
    const appended = scripted({ keep: [3], otherHeld: 'x', elsewhere: () => 'x Nov' });
    expect(await typeAndConfirm(appended.io, { ...appended.intent, clear: true })).toMatchObject({ kind: 'missed', again: [], elsewhere: { identifier: 'o' } });
  });

  it('an input of then that the read-back cannot find again (moved, gone) proves nothing: no tail typed again', async () => {
    const { io, intent, typed } = scripted({ keep: [3], moves: true });
    expect(await typeAndConfirm(io, intent)).toEqual({ kind: 'missed', observed: 'Jan', again: [] });
    expect(typed).toEqual(['Jan Novak']);
  });

  it('nothing read before typing proves nothing: no tail typed again', async () => {
    const { io, intent, typed } = scripted({ keep: [3] });
    let reads = 0;
    const blind: FieldIo = { ...io, screen: () => (reads++ === 0 ? undefined : io.screen()) };
    expect((await typeAndConfirm(blind, intent)).kind).toBe('missed');
    expect(typed).toEqual(['Jan Novak']);
  });

  it('an adapter whose keys may arrive late gets no tail typed again', async () => {
    const { io, intent, typed } = scripted({ keep: [3] });
    expect((await typeAndConfirm(io, { ...intent, delivery: 'may-arrive-late' })).kind).toBe('missed');
    expect(typed).toEqual(['Jan Novak']);
  });

  // D18: the field groups what it is handed in fours, as the lab's IBAN fields do.
  const group4 = (t: string) => (t.replace(/ /g, '').match(/.{1,4}/g) ?? []).join(' ');

  it('a field that groups the typing in fours lands, said reformatted — nothing typed again, with clear or without', async () => {
    for (const clear of [false, true]) {
      const { io, intent, typed } = scripted({ format: group4 });
      expect(await typeAndConfirm(io, { ...intent, value: 'SK3112000000', clear })).toEqual({
        kind: 'landed',
        observed: 'SK31 1200 0000',
        again: [],
        reformatted: { added: 2, respaced: 0 },
      });
      expect(typed).toEqual(['SK3112000000']);
    }
  });

  it('without clear the field\'s earlier text comes first: the reformat is of it and the typing appended', async () => {
    const { io, intent, field } = scripted({ format: group4 });
    field.value = 'SK31 12';
    expect(await typeAndConfirm(io, { ...intent, value: '000000', before: 'SK31 12' })).toMatchObject({ kind: 'landed', observed: 'SK31 1200 0000', reformatted: { added: 1 } });
  });

  // D28: iOS React Native's rf2 held `1 234 567,` for `1234567,89` — a dropped tail on a grouping field. Only the tail
  // is typed (no wipe), the drop is reported (D24's first-key-alone split), and the read-back lands reformatted.
  it('a grouping field that dropped the tail gets the tail alone, reported, and lands reformatted — with clear or without', async () => {
    for (const clear of [false, true]) {
      const { io, intent, typed, dropped } = scripted({ format: group4, keep: [11] });
      expect(await typeAndConfirm(io, { ...intent, value: 'SK3112000000', clear })).toEqual({
        kind: 'landed',
        observed: 'SK31 1200 0000',
        again: [{ kind: 'tail', length: 1 }],
        reformatted: { added: 2, respaced: 0 },
      });
      expect(typed).toEqual(['SK3112000000', '0']);
      expect(dropped).toEqual([2]);
    }
  });

  it('a reformatted prefix whose missing part another input gained: the typing left the field — nothing sent again', async () => {
    for (const clear of [false, true]) {
      const { io, intent, typed } = scripted({ format: group4, keep: [10], elsewhere: () => '00' });
      expect(await typeAndConfirm(io, { ...intent, value: 'SK3112000000', clear })).toMatchObject({ kind: 'missed', observed: 'SK31 1200 00', again: [], elsewhere: { identifier: 'o' } });
      expect(typed).toEqual(['SK3112000000']);
    }
  });

  // An Android-shaped amount (a no-break space between thousands, ADR 0034's f3), dropped from its `,`.
  const thousandsNbsp = (t: string) => {
    const [whole, ...fraction] = t.replace(/\u00A0/g, '').split(',');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
    return fraction.length === 0 ? grouped : `${grouped},${fraction.join(',')}`;
  };

  it('an amount grouped by thousands that dropped `89` gets `89` typed again, nothing wiped', async () => {
    const { io, intent, typed, dropped } = scripted({ format: thousandsNbsp, keep: [8] });
    expect(await typeAndConfirm(io, { ...intent, value: '1234567,89', clear: true })).toEqual({
      kind: 'landed',
      observed: '1\u00A0234\u00A0567,89',
      again: [{ kind: 'tail', length: 2 }],
      reformatted: { added: 2, respaced: 0 },
    });
    expect(typed).toEqual(['1234567,89', '89']);
    expect(dropped).toEqual([2]);
  });

  it('a grouping field that keeps its prefix for good (capped): the tail once, then with clear the wipe and retype — missed, not reported', async () => {
    const capped = (t: string) => group4(t.replace(/ /g, '').slice(0, 11));
    const { io, intent, typed, dropped } = scripted({ format: capped });
    expect(await typeAndConfirm(io, { ...intent, value: 'SK3112000000', clear: true })).toEqual({
      kind: 'missed',
      observed: 'SK31 1200 000',
      again: [
        { kind: 'tail', length: 1 },
        { kind: 'whole', wiped: true },
      ],
    });
    expect(typed).toEqual(['SK3112000000', '0', 'SK3112000000']);
    expect(dropped).toEqual([]);
  });

  it('a grouping field that changed a character is no prefix: no tail, with clear wiped and typed again once', async () => {
    const swapped = (t: string) => group4(t.replace(/ /g, '').replace('SK31', 'SK13'));
    const { io, intent, typed } = scripted({ format: swapped });
    expect(await typeAndConfirm(io, { ...intent, value: 'SK3112000000', clear: true })).toEqual({
      kind: 'missed',
      observed: 'SK13 1200 0000',
      again: [{ kind: 'whole', wiped: true }],
    });
    expect(typed).toEqual(['SK3112000000', 'SK3112000000']);
  });

  // Review round 1: the landing is computed once (`landing`), and `tookText` gates it — after a retry too, where the
  // loop's own not-taken check is no longer asked.
  it('a non-input that ends on its own resolved text after the wipe and retype has not landed', async () => {
    const { io, intent, field } = scripted();
    field.value = 'X';
    expect(await typeAndConfirm(io, { ...intent, value: 'SK31', isInput: false, resolvedValue: 'SK31', clear: true })).toMatchObject({
      kind: 'missed',
      observed: 'SK31',
      again: [{ kind: 'whole', wiped: true }],
    });
  });

  it('a non-input proves it took the text only by showing it exactly: no reformat there', async () => {
    const { io, intent } = scripted({ format: group4 });
    expect((await typeAndConfirm(io, { ...intent, value: 'SK3112000000', isInput: false })).kind).toBe('not-taken');
  });
});

