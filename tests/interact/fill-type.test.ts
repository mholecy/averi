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
 * D18: a field that reformats as it is typed (an IBAN grouped in fours, an amount's thousands) shows every typed
 * character, in order, with separators of its own between them — measured on the lab's Compose, React Native and
 * VisualTransformation fields (docs/adr/0034-a-fill-passes-a-field-that-reformats-as-it-is-typed.md). Tight: a field
 * that dropped, reordered or changed a character never passes, nor one whose added `.`/`,` is no thousands separator.
 */
describe('reformatOf — the typed characters in order, only separators added', () => {
  it('an IBAN grouped in fours, an amount grouped by thousands (a no-break space), a date and a phone', () => {
    expect(reformatOf('SK31 1200 0000', 'SK3112000000')).toEqual({ added: 2, respaced: 0 });
    expect(reformatOf('1 234 567,89', '1234567,89')).toEqual({ added: 2, respaced: 0 });
    expect(reformatOf('1 234', '1234')).toEqual({ added: 1, respaced: 0 });
    expect(reformatOf('1,234,567.89', '1234567.89')).toEqual({ added: 2, respaced: 0 });
    expect(reformatOf('1.234,56', '1234,56')).toEqual({ added: 1, respaced: 0 });
    expect(reformatOf('31/12/2026', '31122026')).toEqual({ added: 2, respaced: 0 });
    expect(reformatOf('0905-123-456', '0905123456')).toEqual({ added: 2, respaced: 0 });
  });

  it('a typed space shown as a no-break space is respaced, not added; a trailing group separator is the field\'s', () => {
    expect(reformatOf('1 234', '1 234')).toEqual({ added: 0, respaced: 1 });
    expect(reformatOf('SK31 ', 'SK31')).toEqual({ added: 1, respaced: 0 });
    expect(reformatOf('31/', '31')).toEqual({ added: 1, respaced: 0 });
  });

  it('exactly the typed text is no reformat (the exact rule passes it)', () => {
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

  it('nothing added before the first typed character: a leading `-` is a sign', () => {
    expect(reformatOf('-5', '5')).toBeUndefined();
    expect(reformatOf(' 5', '5')).toBeUndefined();
  });

  it('an added `.` or `,` must be a thousands separator — three digits after it — never a decimal point a cents mask put in', () => {
    expect(reformatOf('1.25', '125')).toBeUndefined();
    expect(reformatOf('12,50', '1250')).toBeUndefined();
    expect(reformatOf('125.00', '12500')).toBeUndefined();
    expect(reformatOf('1.2345', '12345')).toBeUndefined(); // four digits after it
    expect(reformatOf('12.', '12')).toBeUndefined(); // none after it
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

  it('a grouping field that dropped a character is no reformat: missed, and with clear wiped and typed again once', async () => {
    const { io, intent, typed } = scripted({ format: group4, keep: [11, 11] });
    expect(await typeAndConfirm(io, { ...intent, value: 'SK3112000000', clear: true })).toEqual({
      kind: 'missed',
      observed: 'SK31 1200 000',
      again: [{ kind: 'whole', wiped: true }],
    });
    expect(typed).toEqual(['SK3112000000', 'SK3112000000']);
  });

  it('a non-input proves it took the text only by showing it exactly: no reformat there', async () => {
    const { io, intent } = scripted({ format: group4 });
    expect((await typeAndConfirm(io, { ...intent, value: 'SK3112000000', isInput: false })).kind).toBe('not-taken');
  });
});

