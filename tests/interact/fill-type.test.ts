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
 * A scripted field: `typeText` lands what `keep` lets through of each typing (in order), a read returns the field's
 * text, and the screen is the field and one other input whose value the script may change while typing.
 */
function scripted(opts: { keep?: number[]; elsewhere?: (text: string) => string | null; grows?: boolean; moves?: boolean } = {}) {
  const keeps = [...(opts.keep ?? [])];
  const field = node({ role: 'textfield', identifier: 'f', rect: { x: 0, y: 0, width: 100, height: 20 }, value: null });
  const other = node({ role: 'textfield', identifier: 'o', rect: { x: 0, y: 40, width: 100, height: 20 }, value: null });
  const tree = node({ role: 'container', rect: { x: 0, y: 0, width: 400, height: 800 }, children: [field, other] });
  const typed: string[] = [];
  let pending = ''; // `grows`: one more character of the typing arrives per read
  const snapshot = (): UiNode => structuredClone(tree);
  let last: UiNode | undefined = snapshot();
  const io: FieldIo = {
    type: async (text) => {
      typed.push(text);
      const keep = keeps.shift() ?? text.length;
      if (opts.grows) pending += text;
      else field.value = (field.value ?? '') + text.slice(0, keep);
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
  return { io, intent, typed, field };
}

describe('typeAndConfirm — type, confirm, and send again only what the field provably dropped', () => {
  it('a landed typing sends nothing again', async () => {
    const { io, intent, typed } = scripted();
    expect(await typeAndConfirm(io, intent)).toEqual({ kind: 'landed', observed: 'Jan Novak', again: [] });
    expect(typed).toEqual(['Jan Novak']);
  });

  it('a dropped tail is typed again, and every retype is in `again`, in order', async () => {
    const { io, intent, typed } = scripted({ keep: [3, 3] });
    expect(await typeAndConfirm(io, intent)).toEqual({
      kind: 'landed',
      observed: 'Jan Novak',
      again: [
        { kind: 'tail', length: 6 },
        { kind: 'tail', length: 3 },
      ],
    });
    expect(typed).toEqual(['Jan Novak', ' Novak', 'vak']);
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
});
