import { describe, expect, it, vi } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { droppedTail, MAX_TAIL_RETYPES, typeAndConfirm, type FieldIo, type TypingIntent } from '../../src/interact/fill-type.js';
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
 * A scripted field: `typeText` lands what `keep` lets through of each typing (in order), a read returns the field's
 * text, and the screen is the field and one other input whose value the script may change while typing. `unnamed`: the
 * placeholder an empty field reads as its value, not named as one (idb, D29).
 */
function scripted(opts: { keep?: number[]; elsewhere?: (text: string) => string | null; grows?: boolean; moves?: boolean; otherHeld?: string; format?: (text: string) => string; unnamed?: string } = {}) {
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
      return field.value || (opts.unnamed ?? '');
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

  // D29: idb names no placeholder, so the UIKit iban field's `SK00 0000 0000 …` was read as the empty field's value —
  // `before` — and vanished at the first key (the owner's iOS run, f1 and f7: "typed 12 characters but the field shows
  // 14" for a field holding `SK31 1200 0000`).
  it('a grouping field whose unnamed placeholder vanished lands reformatted without clear — and its dropped tail is typed again', async () => {
    const PH = 'SK00 0000 0000 \u2026';
    const landed = scripted({ format: group4, unnamed: PH });
    expect(await typeAndConfirm(landed.io, { ...landed.intent, value: 'SK3112000000', before: PH })).toEqual({
      kind: 'landed',
      observed: 'SK31 1200 0000',
      again: [],
      reformatted: { added: 2, respaced: 0 },
    });
    expect(landed.typed).toEqual(['SK3112000000']);
    const dropping = scripted({ format: group4, unnamed: PH, keep: [9] });
    expect(await typeAndConfirm(dropping.io, { ...dropping.intent, value: 'SK3112000000', before: PH })).toEqual({
      kind: 'landed',
      observed: 'SK31 1200 0000',
      again: [{ kind: 'tail', length: 3 }],
      reformatted: { added: 2, respaced: 0 },
    });
    expect(dropping.typed).toEqual(['SK3112000000', '000']);
    expect(dropping.dropped).toEqual([2]);
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

