/**
 * What a text recognizer cannot tell apart — one notion of "a recognizer
 * difference", shared by the ocr assert, the text parity table's drift check
 * and the element assert's not-found hint.
 *
 * Measured on device: macOS Vision reads Slovak `Prihlásiť sa` as
 * `Prihlásit sa` (combining marks dropped) and a typographic `Payee’s name` as
 * `Payee's name` (curly punctuation read as its ASCII look-alike). Neither is
 * on the screen — the screenshot shows the right glyphs — so an exact compare
 * of a READING against the app's copy fails on text that is correct.
 *
 * The fold is deliberately narrow: punctuation look-alikes and combining
 * marks, nothing else. Case is NOT folded (a case difference renders, and the
 * recognizer reads it); letters and digits are never folded. And it applies to
 * recognizer readings ONLY — the tree carries the app's characters exactly, so
 * a `’` → `'` change there is a copy change the tree can see.
 */

/** Typographic punctuation → the ASCII the recognizer reads it as. */
const PUNCTUATION: Readonly<Record<string, string>> = {
  '’': "'",
  '‘': "'",
  'ʼ': "'",
  '′': "'",
  '‛': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '″': '"',
  '–': '-',
  '—': '-',
  '‒': '-',
  '−': '-',
  '…': '...',
};

/**
 * Strip Latin combining marks only (NFD, drop U+0300–U+036F, recompose):
 * `ť` → `t`, case and spacing untouched. Recomposing keeps every letter that
 * has no such mark as it was — a Hangul syllable, a kana with its voicing
 * mark — rather than leaving it in pieces.
 */
const foldMarks = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');

/** One character's fold: its ASCII look-alike, or itself without combining marks. */
const foldChar = (c: string): string => PUNCTUATION[c] ?? foldMarks(c);

/** Code points of the composed form, so `ť` is one character whether it arrived as one or as `t` + caron. */
const charsOf = (s: string): string[] => [...s.normalize('NFC')];

/** The string as the recognizer could have read it: look-alikes to ASCII, combining marks dropped. */
export const ocrFold = (s: string): string => charsOf(s).map(foldChar).join('');

/** A regex source spelling `s` literally (outside a character class). */
const literal = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/** A character a class can list literally: escaped when the class syntax would read it. */
const classMember = (c: string): string => (/[\]\\^-]/.test(c) ? `\\${c}` : c);

/**
 * The literal character an escape `\c` stands for when it is a fold candidate:
 * every character the fold changes is outside ASCII, and outside ASCII an
 * escape in a pattern without the `u` flag is an identity escape.
 */
const escapedLiteral = (c: string | undefined): string | undefined =>
  c !== undefined && c.charCodeAt(0) > 0x7f && foldChar(c) !== c ? c : undefined;

/**
 * A `match` pattern folded for a folded reading, with the characters it
 * folded — or undefined when there is nothing to fold or it cannot be folded
 * safely.
 *
 * What holds: the folded pattern accepts a folded reading only if the pattern
 * itself accepts some string that folds to it. So:
 * - a literal character outside a class — bare or as an identity escape (`\–`)
 *   — becomes its fold as one unit, `(?:…)`, so a quantifier after it still
 *   binds to the whole fold (`…?` is `(?:\.\.\.)?`, never `\.\.\.?`);
 * - in a class, a character listed on its own (not a range endpoint) whose
 *   fold is one character gains that character as a further member (`[–—]`
 *   also lists `-`); ranges, negated classes and multi-character folds (`[…]`)
 *   stay as written, so no range endpoint ever moves;
 * - other escapes (`\u2019`, `\d`), group names and backreference names stay
 *   as written;
 * - a pattern with a word boundary (`\b`, `\B`) is not folded: a folded
 *   letter is a word character its original is not, so the boundary would move.
 */
export function ocrFoldPattern(source: string): { source: string; folded: [string, string][] } | undefined {
  const cps = [...source];
  const folded: [string, string][] = [];
  let out = '';
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i];
    if (c === '\\') {
      const next = cps[i + 1];
      if (next === 'b' || next === 'B') return undefined;
      const lit = escapedLiteral(next);
      if (lit !== undefined) {
        out += `(?:${literal(foldChar(lit))})`;
        folded.push([lit, foldChar(lit)]);
      } else if (next === 'k' && cps[i + 2] === '<') {
        const end = cps.indexOf('>', i + 2);
        const stop = end === -1 ? cps.length - 1 : end;
        out += cps.slice(i, stop + 1).join('');
        i = stop;
        continue;
      } else {
        out += c + (next ?? '');
      }
      i++;
      continue;
    }
    if (c === '(' && cps[i + 1] === '?' && cps[i + 2] === '<' && cps[i + 3] !== '=' && cps[i + 3] !== '!') {
      const end = cps.indexOf('>', i + 3);
      const stop = end === -1 ? cps.length - 1 : end;
      out += cps.slice(i, stop + 1).join('');
      i = stop;
      continue;
    }
    if (c === '[') {
      const { text, end, added } = foldClass(cps, i);
      out += text;
      folded.push(...added);
      i = end;
      continue;
    }
    const f = foldChar(c);
    if (f === c) {
      out += c;
    } else {
      out += `(?:${literal(f)})`;
      folded.push([c, f]);
    }
  }
  return folded.length === 0 ? undefined : { source: out, folded };
}

/**
 * The class opening at `cps[start]`, with the fold of each lone member added.
 * Members are read the way the pattern's class syntax reads them: an escape is
 * one member, and `x-y` is a range unless the `-` closes the class.
 */
function foldClass(cps: string[], start: number): { text: string; end: number; added: [string, string][] } {
  const members: string[] = [];
  let i = start + 1;
  const negated = cps[i] === '^';
  if (negated) i++;
  for (; i < cps.length && cps[i] !== ']'; i++) {
    if (cps[i] === '\\') {
      members.push(cps[i] + (cps[i + 1] ?? ''));
      i++;
    } else {
      members.push(cps[i]);
    }
  }
  const end = Math.min(i, cps.length - 1);
  const text = cps.slice(start, end + 1).join('');
  if (negated || i >= cps.length) return { text, end, added: [] };
  const added: [string, string][] = [];
  for (let k = 0; k < members.length; k++) {
    if (members[k + 1] === '-' && k + 2 < members.length) {
      k += 2; // a range: both endpoints stay as written
      continue;
    }
    const m = members[k];
    const c = m.length > 1 && m.startsWith('\\') ? escapedLiteral(m.slice(1)) : m;
    if (c === undefined) continue;
    const f = foldChar(c);
    const listed = members.includes(f) || added.some(([, g]) => g === f);
    if (f !== c && [...f].length === 1 && !listed) added.push([c, f]);
  }
  if (added.length === 0) return { text, end, added };
  return { text: text.slice(0, -1) + added.map(([, f]) => classMember(f)).join('') + ']', end, added };
}

/**
 * Equal under the fold but not exactly: the two differ ONLY in what the
 * recognizer cannot tell apart.
 */
export const differsOnlyByOcrFold = (a: string, b: string): boolean => a !== b && ocrFold(a) === ocrFold(b);

/**
 * The folded characters that make `want` and `read` differ, as `’ vs '` pairs
 * (the assert's side first): every character the fold changes that occurs on
 * one side only. A character on both sides is not a difference between them.
 */
function foldedPairs(want: string, read: string): string[] {
  const w = new Set(charsOf(want));
  const r = new Set(charsOf(read));
  const pairs: string[] = [];
  for (const c of w) if (!r.has(c) && foldChar(c) !== c) pairs.push(`${c} vs ${foldChar(c)}`);
  for (const c of r) if (!w.has(c) && foldChar(c) !== c) pairs.push(`${foldChar(c)} vs ${c}`);
  return [...new Set(pairs)];
}

/** Why a folded difference is forgiven, said once wherever it is. */
export const RECOGNIZER_DIFFERENCE =
  'the recognizer reads typographic punctuation as ASCII and drops diacritics';

/**
 * `’ vs '` — the folded characters a fold-equal pair differs in, for a note
 * to name. Two strings that differ only in how a letter is encoded (`é` as one
 * code point or as `e` + a combining acute) have no such character; that is
 * said instead of naming nothing.
 */
export const foldedCharacters = (want: string, read: string): string => {
  const pairs = foldedPairs(want, read);
  return pairs.length > 0 ? pairs.join(', ') : 'composed vs decomposed characters';
};

/** A combining mark shown on a dotted circle, so a note can print it on its own. */
const shown = (c: string): string => (c === '' ? 'nothing' : /^\p{M}/u.test(c) ? `◌${c}` : c);

/** `’ vs ', … vs ...` — folded characters as a note names them, each pair once. */
export const namePairs = (pairs: readonly (readonly [string, string])[]): string =>
  [...new Set(pairs.map(([a, b]) => `${shown(a)} vs ${shown(b)}`))].join(', ');
