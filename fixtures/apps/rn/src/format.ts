// How a field reformats its text as it is typed (scripts/truth/schema.ts#FieldFormat, D18) — the same two rules as the
// native lab apps' (Forms.kt#formatted, Forms.swift#formatted): `group4` drops every whitespace and joins groups of four
// by a space (an IBAN); `thousands` groups the whole part before the first `,` or `.` in threes from the right by a
// no-break space and keeps the rest (an amount).

export type FieldFormat = 'group4' | 'thousands';

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
  return text;
}
