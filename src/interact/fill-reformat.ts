/**
 * What a field's reading IS of the text it should hold, character by character — a pure leaf (D28 review, MINOR-2):
 * the rules that read a reformatting field (D18, docs/adr/0034-a-fill-passes-a-field-that-reformats-as-it-is-typed.md)
 * and a strict prefix of the typing, exact or reformatted (D28, that ADR's amendment). Two modules ask it:
 * interact/fill-type.ts, the typing — whether a reading landed (`reformatOf`) and what tail to type again (`tailOf`) —
 * and interact/fill-verdict.ts, the judge — whether a mismatch is a dropped tail (`tailOf`), so the retype and the
 * error judge a prefix alike. It imports only the facts (fill-facts.ts) and the mask characters; nothing here types,
 * reads a device or words a sentence.
 */

import { hasBullet } from '../ui-tree/masked-value.js';
import { heldText, isPoint, type Reformat } from './fill-facts.js';

/** What the field should hold: the value typed, after its earlier text (`before`, a placeholder no text) unless `clear`. */
export interface Expectation {
  value: string;
  clear: boolean;
  before: string | null;
  placeholder: string | undefined;
}

/** The spaces a field may show for one another: a space, a no-break (U+00A0) and a narrow no-break (U+202F) space. */
const SPACES = new Set([' ', '\u00A0', '\u202F']);
/** What a formatting field may add between typed characters: the spaces, and `.` `,` `-` `/`. */
const SEPARATORS = new Set([...SPACES, '.', ',', '-', '/']);
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
 *   with a caveat (`point`), not silently.
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
  const walked = walk(observed, expectedChars);
  if (walked === undefined || walked.matched !== expectedChars.length) return undefined;
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
  const point = isPoint(sep) ? sep : undefined;
  if (point !== undefined && !thousands(chars, tokens, typing, point)) return undefined;
  const count = groups.length - 1;
  if (count + respaced === 0) return undefined;
  return { added: count, respaced, ...(point !== undefined && { point }) };
}

/**
 * The reading walked against `expectedChars`, greedily (see `reformatOf`): each reading character the next expected one
 * (or a space shown for a typed space — `respaced`), else an added separator (-1 in `tokens`, an expected character's
 * index otherwise); undefined at the first character that is neither. `matched`: how many expected characters it
 * showed — all of them for `reformatOf`, fewer for a prefix (`prefixOf`). The one walk both ask.
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

/** The text the typing lands after: the field's text before the typing (its placeholder aside), or none once cleared. */
export const priorText = (intent: Pick<Expectation, 'clear' | 'before' | 'placeholder'>): string => (intent.clear ? '' : heldText(intent.before, intent.placeholder));

/**
 * The strict prefix of `whole` a reading shows: exactly, or — D28 — REFORMATTED (`reformatOf` of the prefix, its
 * rules judged over the whole typing: one separator kind, letters split only in a code, an added `.`/`,` only as a
 * thousands mark the typing does not hold itself). The prefix is the typed characters the reading shows, in order —
 * `walk`, the greedy walk `reformatOf` takes, every other reading character an added separator; nothing else may differ.
 * Undefined when the reading is no strict prefix (the whole of it, more, or other text). Pure, O(reading).
 */
export function prefixOf(held: string, whole: string): { prefix: string; reformatted?: Reformat } | undefined {
  if (held.length < whole.length && whole.startsWith(held)) return { prefix: held };
  const wholeChars = [...whole];
  const walked = walk(held, wholeChars);
  if (walked === undefined || walked.matched >= wholeChars.length) return undefined;
  const prefix = wholeChars.slice(0, walked.matched).join('');
  const reformatted = reformatOf(held, prefix, whole);
  return reformatted === undefined ? undefined : { prefix, reformatted };
}

/**
 * A reading that is a strict prefix of what the field should hold (`tailOf`): `missing` the rest, `landed` how many
 * characters of the TYPING the prefix holds (UTF-16 units, as a value's length is counted — 0 when only the field's
 * earlier text is there), `reformatted` when the field reformatted the prefix (separators added, spaces respaced).
 */
export interface Tail {
  missing: string;
  landed: number;
  reformatted?: Reformat;
}

/** Some of the typing is in the prefix: a tail the field dropped, not a typing that never reached it. */
export const landedSome = (tail: Tail | undefined): tail is Tail => tail !== undefined && tail.landed > 0;

/**
 * What the field is missing of what it should hold (its text before the typing, unless cleared, then the value),
 * when its reading is a strict prefix of that — exactly or reformatted (`prefixOf`, D28) — and shows no bullet:
 * a `Tail`, else undefined. Pure.
 */
export function tailOf(observed: string, intent: Expectation): Tail | undefined {
  const held = heldText(observed, intent.placeholder);
  const prior = priorText(intent);
  if (hasBullet(held) || hasBullet(prior)) return undefined;
  const whole = prior + intent.value;
  const shown = prefixOf(held, whole);
  if (shown === undefined) return undefined;
  const { prefix, reformatted } = shown;
  return { missing: whole.slice(prefix.length), landed: prefix.length - prior.length, ...(reformatted !== undefined && { reformatted }) };
}
