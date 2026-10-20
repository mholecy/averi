/**
 * What a text recognizer may read the app's copy as — one notion of "a
 * recognizer difference", shared by the ocr assert, the text parity table's
 * drift check and the element assert's not-found hint (`readingDifference`).
 * docs/adr/0025-what-the-recognizer-may-read-the-apps-copy-as.md
 *
 * Measured on device: macOS Vision reads Slovak `Prihlásiť sa` as
 * `Prihlásit sa` (combining marks dropped), a typographic `Payee’s name` as
 * `Payee's name` (curly punctuation read as its ASCII look-alike), `Ľubomír`
 * as `L'ubomír`, `dĺžeň` as `dížeň`, and on iOS `1 234,56 €` as `1234,56 €`.
 * None is on the screen — the screenshot shows the right glyphs — so an exact
 * compare of a READING against the app's copy fails on text that is correct.
 *
 * Two parts, deliberately narrow:
 * - the FOLD — punctuation look-alikes and combining marks, nothing else. Case
 *   is NOT folded (a case difference renders, and the recognizer reads it); a
 *   letter keeps its base letter, digits never change. The fold runs either
 *   way round: a typographic expectation read as ASCII and an ASCII one read
 *   typographic are alike, and a `match` pattern either has its own characters
 *   folded (`ocrFoldPattern`) or, naming none (`foldFree`), meets the folded
 *   reading.
 * - the copy's MISREADINGS and dropped SEPARATORS run copy → reading only: a
 *   letter of the copy read as other characters (`MISREADINGS`), a space
 *   between a grouped number's groups read as nothing (`GROUPED_NUMBER`) —
 *   never the reverse, since an apostrophe, an `í` or a space the expectation
 *   has is the copy's own. Not for `match` patterns.
 * And it applies to recognizer readings ONLY — the tree carries the app's
 * characters exactly, so a `’` → `'` change there is a copy change the tree
 * can see.
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
 * itself accepts some string that folds to it. Only the pattern's own
 * typographic and accented characters are folded here; a pattern with none
 * (`foldFree`) is run as written on the folded reading instead
 * (verify/text-parity.ts#evaluateOcrAssert), which holds the same. So:
 * - a literal character outside a class — bare or as an identity escape (`\–`)
 *   — becomes its fold as one unit, `(?:…)`, so a quantifier after it still
 *   binds to the whole fold (`…?` is `(?:\.\.\.)?`, never `\.\.\.?`);
 * - in a class, a character listed on its own (not a range endpoint) whose
 *   fold is one character and not already listed adds that fold as a class of
 *   its own beside the class as written — `[’ -]` is `(?:[’ -]|['])`, so no
 *   trailing `-` becomes a range — and a negated class refuses it too:
 *   `[^’]` is `(?:(?![\'])[^’])`; range endpoints and multi-character folds
 *   (`[…]`) stay as written;
 * - other escapes (`\u2019`, `\d`), group names and backreference names stay
 *   as written;
 * - a pattern with a lookaround is not folded: the lookaround would see the
 *   characters a folded literal stands for (`’(?<=')` accepts nothing, its
 *   fold `'(?<=')` would accept `'`);
 * - a pattern with a word boundary (`\b`, `\B`) is not folded when the fold
 *   turns a letter into a word character (`é` → `e`), which would move the
 *   boundary; a punctuation fold keeps a non-word character non-word.
 */
export function ocrFoldPattern(source: string): { source: string; folded: [string, string][] } | undefined {
  const cps = [...source];
  const folded: [string, string][] = [];
  let out = '';
  let boundary = false;
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i];
    if (c === '\\') {
      const next = cps[i + 1];
      if (next === 'b' || next === 'B') boundary = true;
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
    if (c === '(' && cps[i + 1] === '?' && (cps[i + 2] === '=' || cps[i + 2] === '!')) return undefined;
    if (c === '(' && cps[i + 1] === '?' && cps[i + 2] === '<' && (cps[i + 3] === '=' || cps[i + 3] === '!')) {
      return undefined;
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
  if (folded.length === 0) return undefined;
  // Without the `u` flag a word character is ASCII: a folded punctuation mark
  // stays a non-word character, but a folded letter (`é` → `e`) becomes a word
  // character, which would move a word boundary.
  if (boundary && folded.some(([, f]) => /\w/.test(f))) return undefined;
  return { source: out, folded };
}

/**
 * Whether `source` names no character the fold changes — neither literally nor
 * by an escape (`\u2019`, `\xe9`; a doubled backslash before one counts too,
 * erring safe). Such a pattern is also tried, as written, on the folded
 * reading, so what it accepts of a typographic or accented character it
 * accepts of that character's ASCII form too: a literal `'` matches a `’`
 * read, and so does a class or escape that leaves typographic and accented
 * characters out — `^[a-z]+$` passes on `résumé`, `^\w+$` on `café`, with a
 * note. A pattern that names one is written as the screen reads
 * (`ocrFoldPattern` folds it instead): `(?<!’)s$` must still see the `’` a
 * reading has.
 */
export function foldFree(source: string): boolean {
  if (ocrFold(source) !== source) return false;
  for (const m of source.matchAll(/\\(?:u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2}))/g)) {
    if (parseInt(m[1] ?? m[2], 16) > 0x7f) return false;
  }
  return true;
}

/**
 * The characters of `read` the fold changed, as `[read, fold]` pairs, where
 * their folds lie in `[start, end)` of `ocrFold(read)` (a dropped mark: where
 * it stood) — what a match found there in the folded reading took on trust.
 */
export function readingFolds(read: string, start: number, end: number): [string, string][] {
  const pairs: [string, string][] = [];
  let at = 0;
  for (const c of charsOf(read)) {
    const f = foldChar(c);
    const next = at + f.length;
    const inside = f.length === 0 ? at >= start && at <= end : next > start && at < end;
    if (f !== c && inside) pairs.push([c, f]);
    at = next;
  }
  return pairs;
}

/** The character a class member lists: `\-` lists `-`; a letter escape (`\d`) lists no one character. */
const memberChar = (m: string): string | undefined =>
  m.startsWith('\\') ? (m.length === 2 && !/[A-Za-z0-9]/.test(m[1]) ? m[1] : undefined) : m;

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
  if (i >= cps.length) return { text, end, added: [] };
  const added: [string, string][] = [];
  // Every character the class lists, or a fold already added lists: one set, so each member is asked once.
  const listed = new Set(members.map(memberChar).filter((c) => c !== undefined));
  for (let k = 0; k < members.length; k++) {
    if (members[k + 1] === '-' && k + 2 < members.length) {
      k += 2; // a range: both endpoints stay as written
      continue;
    }
    const m = members[k];
    const c = m.length > 1 && m.startsWith('\\') ? escapedLiteral(m.slice(1)) : m;
    if (c === undefined) continue;
    const f = foldChar(c);
    if (f !== c && [...f].length === 1 && !listed.has(f)) {
      added.push([c, f]);
      listed.add(f);
    }
  }
  if (added.length === 0) return { text, end, added };
  // The added members form a class of their own beside the class as written —
  // appended inside it, a member after a trailing `-` would turn that `-` into
  // a range. A listed character's fold is one more character the class
  // accepts, or, negated, one more it refuses.
  const extra = `[${added.map(([, f]) => classMember(f)).join('')}]`;
  return { text: negated ? `(?:(?!${extra})${text})` : `(?:${text}|${extra})`, end, added };
}

/**
 * A letter of the app's copy the recognizer reads as other characters, beyond
 * dropping its marks — measured, and ONE WAY: the copy's letter may be read as
 * these, never the reverse (an apostrophe or an `í` in the copy is the copy's
 * own). Each is a misreading of a glyph, not of a language:
 * - `Ľ ľ ď ť` — the caron drawn as an apostrophe beside the letter (Unicode's
 *   "caron with vertical comma form"); Vision reads `Ľubomír` as `L'ubomír` on
 *   both platforms. `Ď` and `Ť` take a normal caron above and are not listed.
 * - `Ĺ ĺ` — the l with acute read as an i with acute (`dĺžeň` as `dížeň`; with
 *   the í's mark dropped as well, `dižeň`).
 * docs/bugs/2026-10-16-lab-ocr-assert-fails-on-slovak-l-caron-and-l-acute-the-recognizer-reads-as-other-letters.md
 */
const MISREADINGS: Readonly<Record<string, readonly string[]>> = {
  Ľ: ["L'"],
  ľ: ["l'"],
  ď: ["d'"],
  ť: ["t'"],
  Ĺ: ['Í'],
  ĺ: ['í'],
};

/**
 * A grouped number of the copy — 1 to 3 digits, then one or more groups of
 * exactly 3, each after one space, and no digit (nor a space and a digit)
 * either side, nor a decimal mark after a digit before it (`1,234 567` is a
 * fraction's digits and another number): `1 234`, `12 345,00`, `1 234 567`. A space between its groups
 * the recognizer may read as nothing — Vision reads iOS's NBSP and narrow-NBSP
 * separators so (`1 234,56 €` as `1234,56 €`) — and leaving one out changes no
 * digit nor its place. Any other space stays: `12 34`, `1 2345`, `12 34 567`
 * and an IBAN's groups of four are two numbers, or no grouped one. Matched on
 * the copy as compared, whitespace collapsed (verify/text-parity.ts
 * `normalizeText`), so a typed ASCII space counts like the app's NBSP: the
 * shape is the guard, not the code point. A fixed pattern, never built from
 * the text. docs/bugs/2026-10-16-lab-ios-ocr-assert-fails-on-an-amount-whose-nbsp-thousands-separator-the-recognizer-reads-as-nothing.md
 */
const GROUPED_NUMBER = /(?<!\d)(?<!\d )(?<!\d[.,])\d{1,3}(?: \d{3})+(?!\d)(?! \d)/g;

/**
 * A way the recognizer may read a unit of the copy beyond the unit's own fold
 * — copy → reading only: a misreading, or a separator read as nothing.
 */
type Way = 'letters' | 'separator';

/** A kind of difference the recognizer makes between the app's copy and its reading: the fold's own, or a way beyond it. */
type Kind = 'punctuation' | 'diacritics' | Way;

/** What the recognizer cannot tell apart, per kind, in the order a note names them — said of neither side. */
const CANNOT_TELL: Readonly<Record<Kind, string>> = {
  punctuation: 'typographic punctuation from its ASCII look-alike',
  letters: 'a letter from the look-alike it is read as',
  diacritics: 'a letter with diacritics from one without',
  separator: 'a thousands separator between digit groups from no space',
};

/** The fold's kinds the characters of `s` show: a punctuation look-alike, a letter with marks. */
function foldKinds(s: string): Kind[] {
  return charsOf(s).flatMap((c): Kind[] =>
    PUNCTUATION[c] !== undefined ? ['punctuation']
    : foldMarks(c) !== c ? ['diacritics']
    : [],
  );
}

/** `the recognizer does not tell …, nor …` for the kinds present, in CANNOT_TELL's order. */
const reasonFor = (kinds: ReadonlySet<Kind>): string =>
  `the recognizer does not tell ${(Object.keys(CANNOT_TELL) as Kind[])
    .filter((kind) => kinds.has(kind))
    .map((kind) => CANNOT_TELL[kind])
    .join(', nor ')}`;

/**
 * Why folded pairs are forgiven, naming only the kinds present: a punctuation
 * look-alike (`’ vs '`, either way round), a letter's diacritics (`ť vs t`), or
 * both — `the recognizer does not tell typographic punctuation from its ASCII
 * look-alike, nor a letter with diacritics from one without`.
 */
export const foldReason = (pairs: readonly (readonly [string, string])[]): string =>
  reasonFor(new Set(pairs.flatMap(([a, b]) => foldKinds(a + b))));

/**
 * One way a unit of the copy may come out of the recognizer: as `raw`, which
 * the fold makes `folded`; `kind` names a way beyond the unit's own fold — a
 * misreading (`letters`) or a separator read as nothing (`separator`).
 */
interface Reading {
  raw: string;
  folded: string;
  kind?: Way;
}

/**
 * One character of the app's copy, with every way the recognizer may read it
 * — its own fold first — and, inside a grouped number, which one (its start).
 */
interface Unit {
  text: string;
  readings: readonly Reading[];
  group?: number;
}

/** Per code point of the copy, the start of the grouped number (`GROUPED_NUMBER`) it lies in, if any. */
function groupsOf(chars: readonly string[]): (number | undefined)[] {
  const group: (number | undefined)[] = [];
  // A match's UTF-16 offset as the index of its code point.
  const charAt: number[] = [];
  chars.forEach((c, k) => {
    for (let u = 0; u < c.length; u++) charAt.push(k);
  });
  for (const m of chars.join('').matchAll(GROUPED_NUMBER)) {
    // The pattern is ASCII, so its match is as many code points as UTF-16 units.
    const start = charAt[m.index];
    for (let k = start; k < start + m[0].length; k++) group[k] = start;
  }
  return group;
}

/**
 * The copy as units, one per composed code point: each read as itself folded,
 * or as one of its misreadings folded (a misread `ĺ` as `í` may lose the
 * `í`'s mark as well), and a space between a grouped number's groups as
 * nothing too.
 */
function unitsOf(copy: string): Unit[] {
  const chars = charsOf(copy);
  const group = groupsOf(chars);
  return chars.map((c, k) => ({
    text: c,
    readings: [
      { raw: c, folded: foldChar(c) },
      ...(MISREADINGS[c] ?? []).map((raw): Reading => ({ raw, folded: ocrFold(raw), kind: 'letters' })),
      ...(c === ' ' && group[k] !== undefined ? [{ raw: '', folded: '', kind: 'separator' } as const] : []),
    ],
    group: group[k],
  }));
}

/** A unit of the copy with the reading the alignment chose for it. */
type ReadUnit = Reading & { text: string };

/**
 * Each unit as the alignment read it — except a grouped number with a
 * separator read as nothing, which is read as one whole (`12 345` read as
 * `12345`), so a note names the number rather than an invisible space.
 */
function asRead(units: readonly Unit[], picks: readonly number[]): ReadUnit[] {
  const dropped = new Set(units.flatMap((unit, u) => (unit.readings[picks[u]].kind === 'separator' ? [unit.group] : [])));
  const out: (ReadUnit & { group?: number })[] = [];
  units.forEach((unit, u) => {
    const reading = unit.readings[picks[u]];
    const last = out[out.length - 1];
    if (unit.group !== undefined && dropped.has(unit.group) && last?.group === unit.group) {
      last.text += unit.text;
      last.raw += reading.raw;
      last.folded += reading.folded;
    } else {
      const whole = unit.group !== undefined && dropped.has(unit.group);
      out.push({ text: unit.text, ...reading, ...(whole ? { kind: 'separator' as const, group: unit.group } : {}) });
    }
  });
  return out;
}

/** How the alignment first reached a position of the folded reading: from which position, by which reading of the unit. */
interface Step {
  from: number;
  pick: number;
}

/**
 * Which reading of each unit spells `folded` (the folded reading) left to
 * right, or undefined when none does. A set of reachable positions per unit,
 * each remembering how it was first reached: linear in the units times the
 * positions reachable (a handful), no backtracking, no pattern built from the
 * text.
 */
function align(units: readonly Unit[], folded: string): number[] | undefined {
  const reached: Map<number, Step>[] = [new Map([[0, { from: 0, pick: -1 }]])];
  for (const unit of units) {
    const next = new Map<number, Step>();
    for (const at of reached[reached.length - 1].keys()) {
      unit.readings.forEach((r, pick) => {
        const to = at + r.folded.length;
        if (!next.has(to) && folded.startsWith(r.folded, at)) next.set(to, { from: at, pick });
      });
    }
    if (next.size === 0) return undefined;
    reached.push(next);
  }
  if (!reached[units.length].has(folded.length)) return undefined;
  const picks: number[] = [];
  let at = folded.length;
  for (let u = units.length; u > 0; u--) {
    const step = reached[u].get(at) as Step;
    picks[u - 1] = step.pick;
    at = step.from;
  }
  return picks;
}

/** How a reading differs from the app's copy only in what the recognizer may read it as. */
export interface RecognizerDifference {
  /**
   * The spans that differ, as `[copy, read]` — the copy's side first, each the
   * smallest stretch of both whose folds line up. None: the two differ only in
   * how their letters are encoded (`namePairs` says so).
   */
  pairs: readonly (readonly [string, string])[];
  /** Why that is forgiven — the recognizer's reason for the kinds of difference named. */
  reason: string;
}

/**
 * How `read` differs from the app's `copy` ONLY in what the recognizer may
 * read it as — undefined when the two are equal, or differ in more.
 *
 * The copy is split into units, one per character, each offering what the
 * recognizer may read it as; the units are matched left to right against the
 * folded reading (`align`). Then copy and reading are walked side by side
 * along those folds, and wherever two stretches that fold alike are spelled
 * differently, that pair is named. So `it’s Bob’s` read as `it's Bob’s` names
 * `’ vs '` once — the second `’` was read as written.
 */
export function readingDifference(copy: string, read: string): RecognizerDifference | undefined {
  if (copy === read) return undefined;
  const units = unitsOf(copy);
  const picks = align(units, ocrFold(read));
  if (picks === undefined) return undefined;
  const { pairs, kinds } = differingSpans(asRead(units, picks), charsOf(read));
  return { pairs, reason: pairs.length > 0 ? reasonFor(kinds) : 'the same letters, encoded differently' };
}

/**
 * The copy as the alignment read it (`a`) and the reading's characters (`b`),
 * walked side by side along their folds into the smallest aligned spans: each
 * span spelled differently on the two sides is a pair, `[copy, read]`, and the
 * kinds of difference it shows are gathered for the reason.
 */
function differingSpans(a: readonly ReadUnit[], b: readonly string[]): { pairs: [string, string][]; kinds: Set<Kind> } {
  const pairs: [string, string][] = [];
  const kinds = new Set<Kind>();
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    // One aligned span: grow the side whose fold is shorter until both folds
    // have the same length (equal, since the alignment spelled the reading).
    let spanA = '';
    let rawA = '';
    let spanB = '';
    const ways = new Set<Way>();
    let lengthA = 0;
    let lengthB = 0;
    do {
      if (i < a.length && (lengthA <= lengthB || j >= b.length)) {
        const unit = a[i++];
        spanA += unit.text;
        rawA += unit.raw;
        lengthA += unit.folded.length;
        if (unit.kind !== undefined) ways.add(unit.kind);
      } else if (j < b.length) {
        spanB += b[j];
        lengthB += foldChar(b[j++]).length;
      }
    } while ((lengthA !== lengthB || spanA === '' || spanB === '') && (i < a.length || j < b.length));
    if (spanA === spanB) continue;
    pairs.push([spanA, spanB]);
    // The span's ways beyond the fold (a misreading, a dropped separator), and the fold's own kinds where the
    // reading is not the copy as those ways would write it.
    for (const kind of ways) kinds.add(kind);
    if (rawA !== spanB) for (const kind of foldKinds(rawA + spanB)) kinds.add(kind);
  }
  return { pairs, kinds };
}

/** A combining mark shown on a dotted circle, so a note can print it on its own. */
const shown = (c: string): string => (c === '' ? 'nothing' : /^\p{M}/u.test(c) ? `◌${c}` : c);

/**
 * `’ vs ', … vs ...` — folded characters as a note names them, each pair once;
 * no pair at all is two strings that differ only in how letters are encoded.
 */
export const namePairs = (pairs: readonly (readonly [string, string])[]): string =>
  pairs.length === 0 ?
    'composed vs decomposed characters'
  : [...new Set(pairs.map(([a, b]) => `${shown(a)} vs ${shown(b)}`))].join(', ');
