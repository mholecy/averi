import { describe, expect, it } from 'vitest';
import { escapeRegExp } from '../../src/verify/text-hint.js';

/**
 * T18: escapeRegExp's only indirect test ("1 of 13 selected") has no regex
 * metacharacter, so a broken escape passed it. Its consumers — the text hint's
 * recommended `match:`, scripts/truth/replies.ts#BAND_SAID and
 * tests/run/verify.test.ts — need the string matched as literal text.
 */
describe('escapeRegExp', () => {
  // Every character the escape's class claims: . * + ? ^ $ { } ( ) | [ ] \
  const EVERY_META = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o';

  it('a string of every metacharacter matches itself, anchored, as literal text', () => {
    expect(new RegExp(`^${escapeRegExp(EVERY_META)}$`).test(EVERY_META)).toBe(true);
  });

  it('each metacharacter is literal on its own, anchored', () => {
    for (const meta of '.*+?^${}()|[]\\') {
      const literal = `x${meta}y`;
      expect(new RegExp(`^${escapeRegExp(literal)}$`).test(literal), JSON.stringify(literal)).toBe(true);
    }
  });

  it('a near miss does not match: `.` is not any character, `(c)` is not a group', () => {
    const re = new RegExp(escapeRegExp('a.b(c)'));
    expect(re.test('a.b(c)')).toBe(true);
    expect(re.test('axb(c)')).toBe(false);
    expect(re.test('a.bc')).toBe(false);
  });

  it('under the unicode flag, where a lone `{`, `}` or `]` is a syntax error, it still round-trips', () => {
    // Without `u` an unescaped `{`, `}` or `]` reads as itself, so only the
    // strict grammar tells an escaped one from a forgotten one.
    expect(new RegExp(`^${escapeRegExp(EVERY_META)}$`, 'u').test(EVERY_META)).toBe(true);
  });

  it('`|` is not alternation: `x|y` matches neither `x` nor `y` alone', () => {
    const re = new RegExp(escapeRegExp('x|y'));
    expect(re.test('x|y')).toBe(true);
    expect(re.test('x')).toBe(false);
    expect(re.test('y')).toBe(false);
  });

  it('quantifiers and alternation stay literal: `a+|b?` matches neither `aa` nor `b`', () => {
    const re = new RegExp(`^${escapeRegExp('a+|b?')}$`);
    expect(re.test('a+|b?')).toBe(true);
    expect(re.test('aa')).toBe(false);
    expect(re.test('b')).toBe(false);
  });

  it('escapes exactly with a backslash before each metacharacter, nothing else', () => {
    // Known-good literal, written by hand: letters and `/` (unclaimed — a
    // RegExp constructor needs no `/` escape) pass through untouched.
    expect(escapeRegExp('a.b(c)/d')).toBe('a\\.b\\(c\\)/d');
    expect(escapeRegExp('$9.99')).toBe('\\$9\\.99');
    expect(escapeRegExp('.*+?^${}()|[]\\')).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
  });
});
