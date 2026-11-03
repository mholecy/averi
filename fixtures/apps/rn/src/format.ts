// How a field reformats its text as it is typed (scripts/truth/schema.ts#FieldFormat, D18) — the same rules as the
// native lab apps' (Forms.kt#formatted, Forms.swift#formatted): `group4` drops every whitespace and joins groups of four
// by a space (an IBAN); `thousands` groups the whole part before the first `,` or `.` in threes from the right by a
// no-break space and keeps the rest (an amount); `group4eager` (L7, D60) is `group4` on the first 24 characters with a
// space after a complete group while under 24 (`SK31` → `SK31 `), an eager trailing mark; `phone3` (L7, D37) keeps a
// leading `+` and the digits alone, in threes from the left (`+421903123456` → `+421 903 123 456`).
// tests/truth/lab-format.test.ts pins the table.

export type FieldFormat = 'group4' | 'thousands' | 'group4eager' | 'phone3';

/** group4eager's longest text, its spaces aside (an IBAN's 24 characters). */
const EAGER_MAX = 24;

const GAP = /[   ]/g;

const chunks = (s: string, n: number): string[] => s.match(new RegExp(`.{1,${n}}`, 'gu')) ?? [];

export function formatted(format: FieldFormat | undefined, text: string): string {
  if (format === 'group4') return chunks(text.replace(GAP, ''), 4).join(' ');
  if (format === 'thousands') {
    const cut = text.search(/[,.]/);
    const whole = (cut < 0 ? text : text.slice(0, cut)).replace(GAP, '');
    const rest = cut < 0 ? '' : text.slice(cut);
    return chunks([...whole].reverse().join(''), 3).map((g) => [...g].reverse().join('')).reverse().join(' ') + rest;
  }
  if (format === 'group4eager') {
    const kept = text.replace(GAP, '').slice(0, EAGER_MAX);
    const eager = kept.length > 0 && kept.length % 4 === 0 && kept.length < EAGER_MAX;
    return chunks(kept, 4).join(' ') + (eager ? ' ' : '');
  }
  if (format === 'phone3') {
    const plus = text.replace(GAP, '').startsWith('+');
    return (plus ? '+' : '') + chunks(text.replace(/[^0-9]/g, ''), 3).join(' ');
  }
  return text;
}
