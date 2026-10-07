import { describe, expect, it } from 'vitest';
import { assertTypeable } from '../../src/interact/type-text.js';

/** The refusal's text, or a failure when nothing was refused. */
function refusal(value: string): string {
  try {
    assertTypeable(value);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error(`expected ${JSON.stringify(value)} to be refused`);
}

/**
 * The refused character is shown as a visible escape (device check
 * 2026-10-08): `JSON.stringify` escapes C0 but not DEL, so a DEL refusal read
 * `cannot type U+007F ("", a control character)` with the raw U+007F
 * invisible inside the quotes.
 */
describe('assertTypeable shows the refused character as a visible escape', () => {
  it('DEL reads "\\u007f" and the message holds no raw U+007F', () => {
    const msg = refusal('ab\x7fcd');
    expect(msg).not.toContain('\x7f');
    expect(msg).toContain('cannot type U+007F ("\\u007f", a control character)');
  });

  it('ESC reads "\\u001b" and the message holds no raw U+001B', () => {
    const msg = refusal('ab\x1bcd');
    expect(msg).not.toContain('\x1b');
    expect(msg).toContain('cannot type U+001B ("\\u001b", a control character)');
  });

  it.each([
    ['\n', 'U+000A ("\\n"'],
    ['\t', 'U+0009 ("\\t"'],
    ['\r', 'U+000D ("\\r"'],
  ])('%j keeps its short escape', (ch, shown) => {
    expect(refusal(`a${ch}b`)).toContain(`cannot type ${shown}, a control character)`);
  });

  it('no refused character reaches the message raw', () => {
    for (let c = 0; c <= 0x7f; c++) {
      if (c >= 0x20 && c < 0x7f) continue;
      expect(refusal(String.fromCharCode(c))).not.toMatch(/[\u0000-\u001f\u007f]/);
    }
  });
});
