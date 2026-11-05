import { describe, expect, it, vi } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { MAX_TAIL_RETYPES, retypesTail, typeAndConfirm, type FieldIo, type TypingIntent } from '../../src/interact/fill-type.js';
import { node } from '../helpers/fake.js';

vi.mock('../../src/util/sleep.js', () => ({ sleep: async () => undefined }));

/**
 * The typing, its poll and what it sends again, through `typeAndConfirm`'s own interface with a scripted field; its
 * one caller, fillField, pins it end to end (fill.test.ts). Whether a reading landed, and what tail it proves dropped,
 * is fill-landing.test.ts's.
 */

/**
 * A scripted field: `typeText` lands what `keep` lets through of each typing (in order), a read returns the field's
 * text, and the screen is the field and one other input whose value the script may change while typing. `unnamed`: the
 * placeholder an empty field reads as its value, not named as one (idb, D29). `prefilled`: what the field holds before.
 */
function scripted(opts: { keep?: number[]; elsewhere?: (text: string) => string | null; grows?: boolean; moves?: boolean; otherHeld?: string; format?: (text: string) => string; unnamed?: string; prefilled?: string } = {}) {
  const keeps = [...(opts.keep ?? [])];
  const field = node({ role: 'textfield', identifier: 'f', rect: { x: 0, y: 0, width: 100, height: 20 }, value: opts.prefilled ?? null });
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
    held: 0,
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
      differs: { kind: 'length' },
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
      differs: { kind: 'length' },
      elsewhere: { role: 'textfield', identifier: 'o', rect: { x: 0, y: 40, width: 100, height: 20 } },
    });
    expect(typed).toEqual(['Jan Novak']);
  });

  it('a sibling the app replaced or recomputed proves nothing: no tail, and the clear\'s wipe and retype still runs', async () => {
    const recomputed = scripted({ keep: [3], elsewhere: () => 'EUR 18' });
    expect(await typeAndConfirm(recomputed.io, recomputed.intent)).toEqual({ kind: 'missed', observed: 'Jan', again: [], differs: { kind: 'length' } });
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
    expect(await typeAndConfirm(io, intent)).toEqual({ kind: 'missed', observed: 'Jan', again: [], differs: { kind: 'length' } });
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
      differs: { kind: 'dropped-tail', landed: 11, dropped: 1, grouped: true },
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
      differs: { kind: 'length' },
    });
    expect(typed).toEqual(['SK3112000000', 'SK3112000000']);
  });

  // D60: an EAGER field adds its mark once a group of four is complete (none at the IBAN's full length here), so a
  // dropped end shows `SK31 1200 ` — a strict prefix and a trailing mark, retyped as any dropped tail (ADR 0034).
  const IBAN = 'SK3112000000';
  const eager4 = (atEnd = false) => (t: string) => {
    const plain = t.replace(/ /g, '');
    const groups = plain.match(/.{1,4}/g) ?? [];
    const marked = (k: number) => k < groups.length - 1 || (groups[k].length === 4 && (atEnd || plain.length < IBAN.length));
    return groups.map((g, k) => (marked(k) ? `${g} ` : g)).join('');
  };

  it('an eager field that dropped the tail after its mark (iOS): the tail alone, reported, landed — with clear or without', async () => {
    for (const clear of [false, true]) {
      const { io, intent, typed, dropped } = scripted({ format: eager4(), keep: [8] });
      expect(await typeAndConfirm(io, { ...intent, value: IBAN, clear })).toEqual({
        kind: 'landed',
        observed: 'SK31 1200 0000',
        again: [{ kind: 'tail', length: 4 }],
        reformatted: { added: 2, respaced: 0 },
      });
      expect(typed).toEqual([IBAN, '0000']); // with clear too: no wipe, no whole retype
      expect(dropped).toEqual([2]);
    }
  });

  it('an eager field that keeps its prefix for good (capped): the tail once, then missed as a dropped tail — not reported', async () => {
    const capped = (t: string) => eager4()(t.replace(/ /g, '').slice(0, 8));
    const { io, intent, typed, dropped } = scripted({ format: capped });
    expect(await typeAndConfirm(io, { ...intent, value: IBAN })).toEqual({
      kind: 'missed',
      observed: 'SK31 1200 ',
      differs: { kind: 'dropped-tail', landed: 8, dropped: 4, grouped: true },
      again: [{ kind: 'tail', length: 4 }],
    });
    expect(typed).toEqual([IBAN, '0000']);
    expect(dropped).toEqual([]);
  });

  it('an eager field that adds its mark at the end too: the tail once, then missed as separated — no loop', async () => {
    const { io, intent, typed, dropped } = scripted({ format: eager4(true), keep: [8] });
    expect(await typeAndConfirm(io, { ...intent, value: IBAN })).toEqual({
      kind: 'missed',
      observed: 'SK31 1200 0000 ',
      differs: { kind: 'separated', added: 3 },
      again: [{ kind: 'tail', length: 4 }],
    });
    expect(typed).toEqual([IBAN, '0000']);
    expect(dropped).toEqual([]);
  });

  it('on Android an eager field\'s dropped tail is named, never typed; a sibling that gained part of it stops the clear', async () => {
    const plain = scripted({ format: eager4(), keep: [8] });
    expect(await typeAndConfirm(plain.io, { ...plain.intent, value: IBAN, delivery: 'may-arrive-late' })).toEqual({
      kind: 'missed',
      observed: 'SK31 1200 ',
      differs: { kind: 'dropped-tail', landed: 8, dropped: 4, grouped: true },
      again: [],
    });
    expect(plain.typed).toEqual([IBAN]);
    const moved = scripted({ format: eager4(), keep: [8], elsewhere: () => '00' });
    expect(await typeAndConfirm(moved.io, { ...moved.intent, value: IBAN, clear: true, delivery: 'may-arrive-late' })).toMatchObject({
      kind: 'missed',
      again: [],
      elsewhere: { identifier: 'o' },
    });
    expect(moved.typed).toEqual(['SK3112000000']); // no wipe: the deletes would go where the typing went
  });

  // Review round 1: fill-landing.ts#tookText gates the landing — after a retry too, where the loop's own not-taken check
  // no longer returns.
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

/**
 * A9 review round 1: arms of the switch only a script of reads reaches, each pinned against a hand mutant (`again` lost,
 * the tail gate's `tails() === 0`, the report skipped). `rounds`: per typing sent, the poll's reads; the last repeats.
 */
describe('typeAndConfirm — the arms after a retry', () => {
  function byRounds(rounds: string[][], siblingAfter: (string | null)[] = []) {
    const typed: string[] = [];
    const sibling = (): UiNode =>
      node({ role: 'textfield', identifier: 'o', rect: { x: 0, y: 40, width: 100, height: 20 }, value: typed.length === 0 ? null : (siblingAfter[typed.length - 1] ?? null) });
    let reads = 0;
    let dropped = 0;
    const field = node({ role: 'textfield', identifier: 'f', rect: { x: 0, y: 0, width: 100, height: 20 }, value: null });
    const io: FieldIo = {
      type: async (text) => {
        typed.push(text);
        reads = 0;
      },
      wipe: async () => undefined,
      read: async () => {
        const round = rounds[Math.min(typed.length - 1, rounds.length - 1)];
        return round[Math.min(reads++, round.length - 1)];
      },
      screen: () => node({ role: 'container', rect: { x: 0, y: 0, width: 400, height: 800 }, children: [field, sibling()] }),
      reportDroppedTail: () => {
        dropped++;
      },
    };
    const intent: TypingIntent = { value: 'abcd', clear: false, isInput: true, resolvedValue: null, before: null, placeholder: undefined, held: 0, pollMs: 1, field, delivery: 'on-return' };
    return { io, intent, typed, reported: () => dropped };
  }

  // Said-plain needs no clear (with clear a masked reading of another length has not landed), so a retype before it is a
  // tail. A held count 'unread' with `on-return` is reachable only at this module's interface: fill.ts never builds it,
  // which is why the arm's own comment can say that no tail was retyped there.
  it('said-plain after a tail typed again keeps what was sent, and reports no drop', async () => {
    const { io, intent, typed, reported } = byRounds([['ab'], ['•••••••']]);
    expect(await typeAndConfirm(io, { ...intent, held: 'unread' })).toEqual({
      kind: 'missed',
      observed: '•••••••',
      again: [{ kind: 'tail', length: 2 }],
      differs: { kind: 'masked-said-plain' },
    });
    expect(typed).toEqual(['abcd', 'cd']);
    expect(reported()).toBe(0);
  });

  it('a first tail on a reading unchanged by the whole retype is still typed: no tail was sent to have moved nothing', async () => {
    // the first poll ends still moving, so no tail: the wipe and retype; the second holds still on the same reading
    const { io, intent, typed, reported } = byRounds([['a', 'a', 'a', 'a', 'ab'], ['ab'], ['abcd']]);
    expect(await typeAndConfirm(io, { ...intent, clear: true })).toEqual({
      kind: 'landed',
      observed: 'abcd',
      again: [
        { kind: 'whole', wiped: true },
        { kind: 'tail', length: 2 },
      ],
    });
    expect(typed).toEqual(['abcd', 'abcd', 'cd']);
    expect(reported()).toBe(1);
  });

  // After a retry `not-taken` goes on to what is sent again: here to `whereTyped`, which names the other input.
  it('a non-input not-taken after the whole retype, a sibling gaining the missing part: missed, elsewhere', async () => {
    const { io, intent, typed } = byRounds([['xabcd'], ['ab']], [null, 'cd']);
    expect(await typeAndConfirm(io, { ...intent, clear: true, isInput: false, resolvedValue: 'Name' })).toEqual({
      kind: 'missed',
      observed: 'ab',
      again: [{ kind: 'whole', wiped: true }],
      differs: { kind: 'length' },
      elsewhere: { role: 'textfield', identifier: 'o', rect: { x: 0, y: 40, width: 100, height: 20 } },
    });
    expect(typed).toEqual(['abcd', 'abcd']);
  });

  it('a placeholder landing through a tail typed again reports the drop', async () => {
    const { io, intent, typed, reported } = byRounds([['Sea'], ['Search']]);
    expect(await typeAndConfirm(io, { ...intent, value: 'Search', placeholder: 'Search' })).toEqual({
      kind: 'landed',
      observed: 'Search',
      again: [{ kind: 'tail', length: 3 }],
      placeholder: true,
    });
    expect(typed).toEqual(['Search', 'rch']);
    expect(reported()).toBe(1);
  });
});

describe('retypesTail — ADR 0023\'s retype condition, asked by the typing and by fill.ts\'s re-read gate', () => {
  it('only an adapter whose typing has arrived when its call returns types a dropped tail again', () => {
    expect(retypesTail('on-return')).toBe(true);
    expect(retypesTail('may-arrive-late')).toBe(false);
  });
});

/**
 * D63: a reading still exactly what the field showed when typing began has not landed, however much of the value that
 * earlier text holds (fill-landing.ts#landingOf) — so the poll goes on reading, and a typing that never reached the
 * field ends on `unchanged` instead of passing at the first read.
 */
describe('typeAndConfirm — a reading unchanged since typing began is no landing (D63)', () => {
  /** A field holding `before` whose typing appears in it from read `arrives` on (1: the first), or never. */
  function arriving(before: string, value: string, arrives: number | 'never') {
    let reads = 0;
    const typed: string[] = [];
    const wipes: number[] = [];
    const field = node({ role: 'textfield', identifier: 'f', rect: { x: 0, y: 0, width: 100, height: 20 }, value: before });
    const io: FieldIo = {
      type: async (text) => {
        typed.push(text);
      },
      wipe: async (count) => {
        wipes.push(count);
      },
      read: async () => {
        reads++;
        return arrives !== 'never' && reads >= arrives ? before + value : before;
      },
      screen: () => undefined,
      reportDroppedTail: () => {},
    };
    const intent: TypingIntent = { value, clear: false, isInput: true, resolvedValue: null, before, placeholder: undefined, held: 0, pollMs: 1, field, delivery: 'may-arrive-late' };
    return { io, intent, typed, wipes, reads: () => reads };
  }

  it('keys that arrive on the second read land there, not on the first, unchanged reading', async () => {
    const late = arriving('Hello world', 'world', 2);
    expect(await typeAndConfirm(late.io, late.intent)).toEqual({ kind: 'landed', observed: 'Hello worldworld', again: [] });
    expect(late.reads()).toBe(2);
  });

  it('keys that never arrive: the whole poll, then missed as unchanged — nothing wiped or sent again', async () => {
    const lost = arriving('Hello world', 'world', 'never');
    expect(await typeAndConfirm(lost.io, lost.intent)).toEqual({ kind: 'missed', observed: 'Hello world', again: [], differs: { kind: 'unchanged' } });
    expect(lost.typed).toEqual(['world']);
    expect(lost.wipes).toEqual([]);
    expect(lost.reads()).toBe(5);
  });

  it('keys that went into another input: missed as unchanged, and the other input is named', async () => {
    const { io, intent, typed } = scripted({ prefilled: 'Hello world', keep: [0], elsewhere: (t) => t });
    expect(await typeAndConfirm(io, { ...intent, value: 'world', before: 'Hello world' })).toEqual({
      kind: 'missed',
      observed: 'Hello world',
      again: [],
      differs: { kind: 'unchanged' },
      elsewhere: { role: 'textfield', identifier: 'o', rect: { x: 0, y: 40, width: 100, height: 20 } },
    });
    expect(typed).toEqual(['world']);
  });
});

/**
 * D64 (A): without clear, the value must be in what was typed past the earlier text (fill-landing.ts#landingOf), not
 * anywhere in the reading. A field whose earlier text holds the value no longer passes at the first read when only part
 * of the typing landed: on iOS the dropped tail is typed again, as for any other field; a capped field and keys that
 * went into another input end in a miss.
 */
describe('typeAndConfirm — an earlier text that holds the value is no landing for a typing that did not land past it (D64)', () => {
  const counted = (io: FieldIo) => {
    let reads = 0;
    const read = io.read;
    return { io: { ...io, read: async () => (reads++, read()) }, reads: () => reads };
  };

  it('on-return: an iOS React Native burst kept `he` of `hello` after `Note: hello` — the tail typed again, landed', async () => {
    const { io, intent, typed, dropped } = scripted({ prefilled: 'Note: hello', keep: [2] });
    expect(await typeAndConfirm(io, { ...intent, value: 'hello', before: 'Note: hello' })).toEqual({ kind: 'landed', observed: 'Note: hellohello', again: [{ kind: 'tail', length: 3 }] });
    expect(typed).toEqual(['hello', 'llo']);
    expect(dropped).toEqual([2]);
  });

  it('on-return: a 12-character cap kept `w` of `world` after `Hello world` — one tail retype that moved nothing, missed', async () => {
    const { io, intent, typed } = scripted({ prefilled: 'Hello world', keep: [1, 0] });
    expect(await typeAndConfirm(io, { ...intent, value: 'world', before: 'Hello world' })).toEqual({ kind: 'missed', observed: 'Hello worldw', again: [{ kind: 'tail', length: 4 }], differs: { kind: 'length' } });
    expect(typed).toEqual(['world', 'orld']);
  });

  it.each(['on-return', 'may-arrive-late'] as const)('%s: `w` landed and `orld` went into another input — missed, the other input named, nothing typed again', async (delivery) => {
    const { io, intent, typed } = scripted({ prefilled: 'Hello world', keep: [1], elsewhere: (t) => t.slice(1) });
    expect(await typeAndConfirm(io, { ...intent, value: 'world', before: 'Hello world', delivery })).toEqual({
      kind: 'missed',
      observed: 'Hello worldw',
      again: [],
      differs: { kind: 'length' },
      elsewhere: { role: 'textfield', identifier: 'o', rect: { x: 0, y: 40, width: 100, height: 20 } },
    });
    expect(typed).toEqual(['world']);
  });

  it('may-arrive-late: the lab date at its cap kept `1` of `12` after `31.12.202` — the whole poll, missed, nothing typed again', async () => {
    const s = scripted({ prefilled: '31.12.202', keep: [1] });
    const { io, reads } = counted(s.io);
    expect(await typeAndConfirm(io, { ...s.intent, value: '12', before: '31.12.202', delivery: 'may-arrive-late' })).toEqual({ kind: 'missed', observed: '31.12.2021', again: [], differs: { kind: 'length' } });
    expect(s.typed).toEqual(['12']);
    expect(reads()).toBe(5);
  });

  // review round 1, m-2: `11 ` for `11` after `1` is a select-all field's whole value with an eager mark as much as a
  // dropped `1` — typing `1` again could leave `111`, said Filled; refused honestly instead, nothing typed again
  it('on-return: a reading that holds the value across the seam is not typed into again — missed', async () => {
    const { io, intent, typed } = scripted({ prefilled: '1', format: () => '11 ' });
    expect(await typeAndConfirm(io, { ...intent, value: '11', before: '1' })).toMatchObject({ kind: 'missed', differs: { kind: 'dropped-tail', wholeToo: true } });
    expect(typed).toEqual(['11']);
  });

  // D64 round 3: keys proven typed elsewhere are no select-all, so the reading's whole-landing hedge goes with them
  // (fill-landing.ts#withoutWholeToo) — the reply must not say both.
  it.each([
    ['11 ', '11', '1', '1', { kind: 'dropped-tail', landed: 1, dropped: 1, grouped: true }],
    ['-5-', '-5', '-5', '5', { kind: 'length' }],
  ])('`%s` for `%s` after `%s`, a sibling gaining the missing `%s`: missed, elsewhere, no hedge', async (shown, value, before, gained, differs) => {
    const { io, intent, typed } = scripted({ prefilled: before, format: () => shown, elsewhere: () => gained });
    const missed = await typeAndConfirm(io, { ...intent, value, before });
    expect(missed).toEqual({ kind: 'missed', observed: shown, again: [], differs, elsewhere: { role: 'textfield', identifier: 'o', rect: { x: 0, y: 40, width: 100, height: 20 } } });
    expect(missed.kind === 'missed' && missed.differs).toStrictEqual(differs);
    expect(typed).toEqual([value]);
  });
});
