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

/** Strip combining marks only (NFD, then U+0300–U+036F): `ť` → `t`, case and spacing untouched. */
export const foldMarks = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** One character's fold: its ASCII look-alike, or itself without combining marks. */
const foldChar = (c: string): string => PUNCTUATION[c] ?? foldMarks(c);

/** Code points of the composed form, so `ť` is one character whether it arrived as one or as `t` + caron. */
const charsOf = (s: string): string[] => [...s.normalize('NFC')];

/** The string as the recognizer could have read it: look-alikes to ASCII, combining marks dropped. */
export const ocrFold = (s: string): string => charsOf(s).map(foldChar).join('');

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
export function foldedPairs(want: string, read: string): string[] {
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

/** `differs only in ’ vs '` — the note a fold-equal pair carries. */
export const differsOnlyIn = (want: string, read: string): string =>
  `differs only in ${foldedPairs(want, read).join(', ')}`;
