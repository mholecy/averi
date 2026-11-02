/**
 * The character rules of a field that reformats as it is typed — a pure leaf (D28 review, MINOR-2): whether a reading
 * is a typing with separators of the field's own added (`reformatOf`; D18,
 * docs/adr/0034-a-fill-passes-a-field-that-reformats-as-it-is-typed.md), whether it is a strict prefix of a typing,
 * exact or reformatted (`prefixOf`; D28 and D60, that ADR's amendments), whether it is a typing with separators added
 * that those rules refuse (`separatedOf`; D53), and a text's letters and digits (`skeleton`). It knows texts, not
 * fields: which text a reading is judged against — the earlier text, the placeholder, clear — is
 * interact/fill-landing.ts's, its one caller. It imports only the facts (fill-facts.ts); nothing here types, reads a
 * device or words a sentence.
 */

import { isPoint, type Point, type Reformat } from './fill-facts.js';

/** The spaces a field may show for one another: a space, a no-break (U+00A0) and a narrow no-break (U+202F) space. */
const SPACES = new Set([' ', '\u00A0', '\u202F']);
/**
 * What a formatting field may add between typed characters: the spaces, and `.` `,` `-` `/`. Exported for one test:
 * fill-text.ts's `separated` sentence lists them, and the test pins that the two agree (D53).
 */
export const SEPARATORS: ReadonlySet<string> = new Set([...SPACES, '.', ',', '-', '/']);
const ALNUM = /^[\p{L}\p{N}]$/u;
const DIGIT = /\d/;
const LETTER = /^\p{L}$/u;
const DIGITS = /^\d+$/;

/**
 * The reading is `expected` — every character of it, in order — with ONE separator character the field added between
 * them (an IBAN grouped in fours, an amount's thousands, a date's slashes) and nothing else: `Reformat`, else undefined
 * (also for an exact reading, which the exact rule passes — a Reformat always counts at least one change). D18,
 * docs/adr/0034-a-fill-passes-a-field-that-reformats-as-it-is-typed.md. Tight, since a wrong pass is worse than a false
 * mismatch:
 * - every expected character is shown, in order and unchanged — a typed space may be shown as another space
 *   (`respaced`), nothing else may differ (letter case included); a separator that was typed must be shown: a field
 *   that dropped one (`12,50` → `1250`) changed the value;
 * - the added separators are all one character of SEPARATORS, each between two typed letters or digits: none
 *   leading (a `-` there is a sign), trailing, next to another, or after typed punctuation (`Hello, world` for
 *   `Hello,world` is an edit, not a format); between two LETTERS only when the typing is a code — digits in it and
 *   no typed space (an IBAN's `MALT MTLC`): in prose that is autocorrect splitting a word (`a lot` for `alot`);
 * - they cut the typing into groups of two or more characters, but for ONE single-character group at either end
 *   (`1 234`, an IBAN's last `1`): `1-5` for `15` is no grouping;
 * - an added `.` or `,` is a thousands separator: never a character the typing itself holds as `.` or `,`, the digits
 *   before the first one 1–3, not a lone `0` and not after a typed `.` or `,` (a fraction), exactly three between two
 *   of them and after the last (then no digit). That rules out a cents mask's `1.25` for `125` and `0.123` for `0123`, but not every decimal point: `1.234`
 *   for `1234` is de-DE's thousands or a three-decimal mask, which the reading cannot tell — so the verdict passes it
 *   with a caveat (`point`), not silently. Or (D51) two or more of them over a digits-only typing, a group between two
 *   of them not three long: a digit grouping (a dotted date `31.12.2026`, a lakh `12,34,567`), passed without `point`
 *   — one number holds at most one decimal point, so two marks are none, and they are no thousands either
 *   (`digitGrouping`).
 * Greedy: a reading character equal to the next expected one is taken as that character. Taken as an added separator
 * instead, the expected one would have to match a later, equal character — so matching first never rejects what
 * skipping would pass but under the grouping rules, where the miss is a false mismatch (the safe side). Pure,
 * O(reading).
 *
 * `typing` (D28): the whole typing whose character classes decide the code rule and the thousands rule — `expected`
 * itself, unless the reading is judged as a PREFIX of a typing (`prefixOf`): the prefix of a typing that holds a space
 * or a `,` must not pass what the whole typing would refuse.
 */
export function reformatOf(observed: string, expected: string, typing: string = expected): Reformat | undefined {
  // Code points on both sides (an astral letter is one character, not two UTF-16 units).
  const expectedChars = [...expected];
  const typingChars = [...typing];
  // A code: digits in it and no typed space (an IBAN, a card number) — the one typing whose letters a field may split.
  const code = typingChars.some((c) => DIGIT.test(c)) && !typingChars.some((c) => SPACES.has(c));
  const walked = walkWhole(observed, expectedChars);
  if (walked === undefined) return undefined;
  const { tokens, respaced } = walked;
  const chars = [...observed];
  const added = new Set(chars.filter((_, k) => tokens[k] === -1));
  if (added.size > 1) return undefined;
  const sep = [...added][0];
  // Each added separator between two typed letters or digits; the groups between them.
  const groups: number[] = [0];
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k] !== -1) {
      groups[groups.length - 1]++;
      continue;
    }
    // Both neighbours typed letters or digits: none leading or trailing (no neighbour), none next to another added
    // one (-1), none after typed punctuation.
    const typedAlnum = (t: number | undefined) => t !== undefined && t !== -1 && ALNUM.test(expectedChars[t]);
    if (!typedAlnum(tokens[k - 1]) || !typedAlnum(tokens[k + 1])) return undefined;
    // Between two LETTERS only in a code (round 2, MAJOR-A): in prose a space or `-` added there is autocorrect
    // splitting a word (`a lot` for `alot`, `jo-hn@x.com`), not a format; an IBAN's `MALT MTLC` is.
    const letter = (t: number) => LETTER.test(expectedChars[t]);
    if (!code && letter(tokens[k - 1]) && letter(tokens[k + 1])) return undefined;
    groups.push(0);
  }
  const singles = groups.map((n, k) => (n < 2 ? k : -1)).filter((k) => k !== -1);
  const atAnEnd = (k: number) => k === 0 || k === groups.length - 1;
  if (singles.length > 1 || (singles.length === 1 && !atAnEnd(singles[0]))) return undefined;
  const kind = markKind(sep, { chars, tokens, groups, typing });
  if (kind === undefined) return undefined;
  const count = groups.length - 1;
  if (count + respaced === 0) return undefined;
  return { added: count, respaced, ...(kind === 'thousands' && { point: sep as Point }) };
}

/**
 * What the added separator `sep` is, for the `.`/`,` rule: `'none'` — no `.` or `,` (or nothing) added, the rule says
 * nothing; `'thousands'` — a thousands mark (`thousands`), which the reading cannot tell from a decimal point
 * (`Reformat.point`, the caveat); `'grouping'` — a digit grouping (D51, `digitGrouping`), no caveat; undefined — a
 * `.`/`,` that is neither, and the reading fails. The two kinds are disjoint (every inner group three long, or one not).
 */
function markKind(
  sep: string | undefined,
  r: { chars: string[]; tokens: number[]; groups: readonly number[]; typing: string },
): 'none' | 'thousands' | 'grouping' | undefined {
  if (!isPoint(sep)) return 'none';
  if (thousands(r.chars, r.tokens, r.typing, sep)) return 'thousands';
  return digitGrouping(r.groups, r.typing) ? 'grouping' : undefined;
}

/**
 * The reading walked against `expectedChars`, greedily (see `reformatOf`): each reading character the next expected one
 * (or a space shown for a typed space — `respaced`), else an added separator (-1 in `tokens`, an expected character's
 * index otherwise); undefined at the first character that is neither. `matched`: how many expected characters it
 * showed — all of them for `reformatOf` and `separatedOf` (`walkWhole`), fewer for a prefix (`prefixOf`, which also
 * reads whether the last token is an added separator: an eager trailing mark, D60). The one walk all three ask.
 */
function walk(observed: string, expectedChars: readonly string[]): { tokens: number[]; matched: number; respaced: number } | undefined {
  const tokens: number[] = [];
  let j = 0;
  let respaced = 0;
  for (const c of observed) {
    const next = expectedChars[j];
    if (c === next) tokens.push(j++);
    else if (next !== undefined && SPACES.has(c) && SPACES.has(next)) {
      tokens.push(j++);
      respaced++;
    } else if (SEPARATORS.has(c)) tokens.push(-1);
    else return undefined;
  }
  return { tokens, matched: j, respaced };
}

/**
 * D53: the reading is `expected` — every character of it, in order and unchanged (a typed space may be shown as another
 * space) — with at least one SEPARATORS character added and nothing else: how many were added (every one, not the
 * groups), else undefined. `reformatOf`'s walk, without its grouping rules: what those rules refuse (a cents mask's
 * `12.34` for `1234`, a sign, mixed or trailing marks, groups of one, autocorrect's `a lot` for `alot`) is a separated
 * reading — and so is what they pass, so ask only of a reading that did not land (fill-landing.ts#differenceOf, its
 * one caller). Pure, O(reading).
 */
export function separatedOf(observed: string, expected: string): number | undefined {
  const walked = walkWhole(observed, [...expected]);
  if (walked === undefined) return undefined;
  const added = walked.tokens.filter((t) => t === -1).length;
  return added > 0 ? added : undefined;
}

/** `walk`, when it showed every expected character (`reformatOf`, `separatedOf`); else undefined. */
function walkWhole(observed: string, expectedChars: readonly string[]): ReturnType<typeof walk> {
  const walked = walk(observed, expectedChars);
  return walked !== undefined && walked.matched === expectedChars.length ? walked : undefined;
}

/** An added `.` or `,` groups digits by thousands (see `reformatOf`); `typing` the whole typing. */
function thousands(chars: string[], tokens: number[], typing: string, point: string): boolean {
  // The typing holds this character itself (its decimal point, or its own grouping): an added one is no thousands mark.
  if (typing.includes(point)) return false;
  const marks = tokens.flatMap((t, k) => (t === -1 ? [k] : []));
  let start = marks[0] - 1;
  while (start >= 0 && DIGIT.test(chars[start])) start--;
  // The digits before the first mark are a whole part, not a fraction after a typed point (`0,12.345`; round 2).
  if (start >= 0 && isPoint(chars[start])) return false;
  const lead = chars.slice(start + 1, marks[0]).join('');
  if (!DIGITS.test(lead) || lead.length > 3 || lead === '0') return false;
  for (let n = 0; n < marks.length; n++) {
    const end = n + 1 < marks.length ? marks[n + 1] : marks[n] + 4;
    const run = chars.slice(marks[n] + 1, end).join('');
    if (run.length !== 3 || !DIGITS.test(run)) return false;
    if (n + 1 === marks.length && chars[end] !== undefined && DIGIT.test(chars[end])) return false;
  }
  return true;
}

/**
 * D51: the added `.`/`,` group digits, not thousands — a group between two of them (so two or more marks: one number
 * holds at most one decimal point, so two marks of one kind are none) that is not three long (all three is a thousands
 * shape — `1.234.56` for `123456` — and only `thousands` judges it), over a digits-only `typing` (no point of its own a
 * mark could stand for, no edit of typed punctuation). A dotted date, a lakh's commas.
 */
function digitGrouping(groups: readonly number[], typing: string): boolean {
  return DIGITS.test(typing) && groups.slice(1, -1).some((n) => n !== 3);
}

/**
 * D51: a text of `_` and separators alone, at least one `_` (`__.__.____`, `__/__/____`) — a mask's blanks.
 * fill-landing.ts#priorsOf tries such an earlier text as none as well (why: ADR 0034's D51 amendment).
 */
export const maskTemplate = (text: string): boolean => text.includes('_') && [...text].every((c) => c === '_' || SEPARATORS.has(c));

/** A text's letters and digits alone (`ALNUM`), in order: what a field that regroups it keeps of it. */
export const skeleton = (text: string): string => [...text].filter((c) => ALNUM.test(c)).join('');

/**
 * The strict prefix of `whole` a reading shows: exactly, or — D28 — REFORMATTED (`reformatOf` of the prefix, its
 * rules judged over the whole typing: one separator kind, letters split only in a code, an added `.`/`,` only as a
 * thousands mark the typing does not hold itself). The prefix is the typed characters the reading shows, in order —
 * `walk`, the greedy walk `reformatOf` takes, every other reading character an added separator; nothing else may differ.
 * D60 (ADR 0034's amendment): an EAGER field adds its mark once a group is complete, so a dropped end shows a trailing
 * mark (`SK31 1200 ` for `SK3112000000`, `31.12.`). A walk that ends in an added separator is judged with the next
 * typed character after it — the strict prefix leaves one — so every rule of `reformatOf` holds for the trailing mark
 * too (it is counted in `added`): one kind, never next to another or after typed punctuation (`1 234 ` for `1234,56`),
 * a typed letter or digit before it (no empty prefix), groups of two or more, a `.`/`,` only as thousands or a D51
 * grouping (`31.` and `12.` stay none). Unless the whole typing holds that mark itself, any space for a space (as
 * `thousands`' rule): then it may be the typing's own, and the walk took it for an added one (`12/` of `1234/56` stays
 * none). The pass rule is not moved: a FULL reading with a trailing mark (`SK31 1200 0000 `) never passes.
 * Undefined when the reading is no strict prefix (the whole of it, more, or other text). Pure, O(reading).
 */
export function prefixOf(held: string, whole: string): { prefix: string; reformatted?: Reformat } | undefined {
  if (held.length < whole.length && whole.startsWith(held)) return { prefix: held };
  const wholeChars = [...whole];
  const walked = walk(held, wholeChars);
  if (walked === undefined || walked.matched >= wholeChars.length) return undefined;
  const prefix = wholeChars.slice(0, walked.matched).join('');
  // D60: an eager trailing mark, judged with the next typed character after it (one the strict prefix leaves).
  const mark = walked.tokens.at(-1) === -1 ? [...held].at(-1) : undefined;
  const next = mark !== undefined && !holdsMark(wholeChars, mark) ? wholeChars[walked.matched] : '';
  const reformatted = reformatOf(held + next, prefix + next, whole);
  return reformatted === undefined ? undefined : { prefix, reformatted };
}

/** The typing holds `mark` itself — any space for a space (D60's typed-mark guard, as `thousands`' rule). */
const holdsMark = (typing: readonly string[], mark: string): boolean =>
  typing.some((c) => c === mark || (SPACES.has(c) && SPACES.has(mark)));
