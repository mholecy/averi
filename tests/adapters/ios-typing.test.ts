import { describe, expect, it } from 'vitest';
import { IDB_TYPEABLE, typingPathOf, WDA_TYPEABLE } from '../../src/adapters/ios-typing.js';
import { refusalOf, type Typeable } from '../../src/adapters/typeable.js';

/**
 * D43 (docs/adr/0037-a-value-the-adapter-cannot-type-is-refused-before-any-device-call.md, the D43 amendment): on a
 * project with the WDA tree source, what idb cannot type goes through WebDriverAgent's `/wda/keys`. The set it takes is
 * what batch-10's gate measured exact on iOS 27.0 (Latin, Greek, Cyrillic and Han letters of the BMP, common
 * punctuation, symbols and numbers, NBSP and U+202F); an emoji, a combining mark, a format character and every script
 * not measured stay refused.
 */
const refused = (text: string, typeable: Typeable): string | undefined => refusalOf(text, typeable)?.match(/^cannot type (U\+[0-9A-F]{4,})/)?.[1];

describe('typingPathOf: idb for every text idb can type, else WebDriverAgent', () => {
  it.each([['Jan Novak'], ['jan.stastny@example.com'], ['SK31 1200 0000 1987 4263 7541'], ['~!@#$%^&*()_+'], ['line one\nline two'], ['']])('%j: idb', (text) => {
    expect(typingPathOf(text)).toBe('idb');
  });

  it.each([['Jan Šťastný'], ['O’Brien'], ['’'], ['Jan Novak Š'], ['東京'], ['1 234']])('%j: wda — one character outside idb\'s set is enough', (text) => {
    expect(typingPathOf(text)).toBe('wda');
  });
});

describe('IDB_TYPEABLE: printable ASCII and \\n', () => {
  it('every printable ASCII character and \\n, nothing past it', () => {
    const all = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
    expect(refused(`${all}\n`, IDB_TYPEABLE)).toBeUndefined();
    expect(refused('\x7f', IDB_TYPEABLE)).toBe('U+007F');
    expect(refused('é', IDB_TYPEABLE)).toBe('U+00E9');
  });
});

describe('WDA_TYPEABLE: idb\'s set and what the gate measured exact through /wda/keys', () => {
  it.each([
    ['Latin with diacritics', 'Jan Šťastný Žluťoučký kůň Ångström Øre Großmann Łódź naïve café Ďurovič Ľubica'],
    ['typographic punctuation', 'O’Brien “Jr.” – Co… ‘quoted’ — dash'],
    ['Cyrillic', 'Ђорђе Привет мир'],
    ['Greek, with tonos', 'Καλημέρα Ωμέγα λ'],
    ['Han (BMP)', '東京 北京市朝阳区'],
    ['symbols', '€ 1 234 § © ® ™'],
    ['NBSP and U+202F', '1 234 1 234'],
    ['common numbers', '½ ² ³'],
    ['printable ASCII and \\n', 'Jan Novak & Co. <jan@example.com> ~!\n'],
  ])('%s: typeable', (_name, text) => {
    expect(refused(text, WDA_TYPEABLE)).toBeUndefined();
  });

  it.each([
    ['an emoji outside the BMP, whole (never half a pair)', 'a😀b', 'U+1F600'],
    ['an emoji in the BMP (Extended_Pictographic)', 'a☺b', 'U+263A'],
    ['a combining mark (NFD)', 'Š', 'U+030C'],
    ['an acute combining mark', 'é', 'U+0301'],
    ['a zero-width joiner (Cf)', 'a‍b', 'U+200D'],
    ['a zero-width space (Cf)', 'a​b', 'U+200B'],
    ['a private-use character', 'ab', 'U+E000'],
    ['an unassigned code point', 'a͸b', 'U+0378'],
    ['an ideographic space (a Zs not measured)', 'a　b', 'U+3000'],
    ['an em space (a Zs not measured)', 'a b', 'U+2003'],
    ['the line separator', 'a b', 'U+2028'],
    ['Arabic (RTL, not measured)', 'مرحبا', 'U+0645'],
    ['Hebrew (RTL, not measured)', 'שלום', 'U+05E9'],
    ['Devanagari (not measured)', 'नमस्ते', 'U+0928'],
    ['Thai (not measured)', 'สวัสดี', 'U+0E2A'],
    ['Hangul (composition, not measured)', '한국', 'U+D55C'],
    ['kana (not measured)', 'カナ', 'U+30AB'],
    ['a fullwidth Latin letter (fullwidth forms not measured)', 'Ａ', 'U+FF21'],
    ['a fullwidth digit', '１', 'U+FF11'],
    ['a lone surrogate', 'a\ud800b', 'U+D800'],
  ])('%s: refused (%j)', (_name, text, code) => {
    expect(refused(text, WDA_TYPEABLE)).toBe(code);
  });

  it('the first refused character, after the typeable ones', () => {
    expect(refused('Šťastný😀́', WDA_TYPEABLE)).toBe('U+1F600');
  });

  it('DEL and C1 controls stay refused (a control character is refused first, by interact/)', () => {
    expect(refused('\x7f', WDA_TYPEABLE)).toBe('U+007F');
    expect(refused('\x85', WDA_TYPEABLE)).toBe('U+0085');
  });
});

/**
 * Every refusal names a true remedy (Typeable.otherPath): idb's names the WDA tree source where WebDriverAgent types
 * the character, and no path where it does not; WDA's names none. The value is never quoted.
 */
describe('the refusals\' remedies', () => {
  it('idb, a character /wda/keys types: names `ios.treeSource: wda`', () => {
    const msg = refusalOf('Jan Šťastný', IDB_TYPEABLE)!;
    expect(msg).toMatch(/Refused before anything was sent — nothing tapped, cleared or typed\. A project with `ios\.treeSource: wda` types it through WebDriverAgent \(ADR 0037\); otherwise use a value without it, or enter it by hand\.$/);
  });

  it('idb, a character /wda/keys does not take either (an emoji): no path, and no claim that wda types it', () => {
    const msg = refusalOf('a😀', IDB_TYPEABLE)!;
    expect(msg).not.toContain('ios.treeSource: wda');
    expect(msg).toMatch(/averi has no typing path for it on iOS .*: use a value without it, or enter it by hand\.$/);
  });

  it('wda: says what it types and that the rest is not measured through /wda/keys; names no other path', () => {
    const msg = refusalOf('a😀', WDA_TYPEABLE)!;
    expect(msg).toMatch(/^cannot type U\+1F600 '😀': on iOS with WebDriverAgent /);
    expect(msg).toContain('not measured through `/wda/keys`');
    expect(msg).toMatch(/Refused before anything was sent — nothing tapped, cleared or typed\. Use a value without it, or enter it by hand\.$/);
    expect(msg).not.toContain('ios.treeSource');
  });

  it('never the value around the character', () => {
    for (const typeable of [IDB_TYPEABLE, WDA_TYPEABLE]) {
      const msg = refusalOf('heslo-😀-123', typeable)!;
      expect(msg).not.toContain('heslo');
      expect(msg).not.toContain('123');
    }
  });
});
