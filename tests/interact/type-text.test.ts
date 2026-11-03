import { describe, expect, it } from 'vitest';
import { AndroidAdapter } from '../../src/adapters/android.js';
import { IosAdapter } from '../../src/adapters/ios.js';
import type { DeviceAdapter } from '../../src/adapters/types.js';
import { assertTypeable } from '../../src/interact/type-text.js';
import { drawnOverStrip } from '../helpers/android-dumps.js';
import { FakeAdapter } from '../helpers/fake.js';

const noExec = () => Promise.reject(new Error('this test sends nothing'));
const IOS = new IosAdapter({
  udid: 'AAAA-1111',
  exec: noExec,
  treeSource: { kind: 'idb', read: noExec, applicationLabel: noExec, dispose: () => Promise.resolve() },
});
const ANDROID = new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: noExec });
/** An iOS adapter over a source that types (IosTreeSource.typeText — WDA's, D43). */
const IOS_WDA = new IosAdapter({
  udid: 'AAAA-1111',
  exec: noExec,
  treeSource: { kind: 'wda', read: noExec, applicationLabel: noExec, dispose: () => Promise.resolve(), typeText: () => Promise.resolve() },
});

/** The refusal's text, or a failure when nothing was refused. */
function refusal(value: string, adapter: Pick<DeviceAdapter, 'typeable'> = new FakeAdapter({}, 'none')): string {
  try {
    assertTypeable(value, adapter.typeable);
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

/**
 * Round 7 (2026-10-09, F-1.2 of the round-6b device check): a refused U+0007
 * was told `input text` would turn it into "a newline into ENTER". ENTER is
 * named for a newline and a return only; any other is a key event.
 */
describe('assertTypeable names ENTER only for a newline and a return', () => {
  it.each([
    ['\n', 'a newline into ENTER'],
    ['\r', 'a return into ENTER'],
  ])('%j: `input text` may turn it into ENTER', (ch, enter) => {
    expect(refusal(`a${ch}b`)).toContain(`\`input text\` may turn it into a key event (${enter}, which submits the form mid-fill), on iOS`);
  });

  it.each(['\x07', '\t', '\x1b', '\x7f'])('%j: a key event, and no ENTER', (ch) => {
    const msg = refusal(`a${ch}b`);
    expect(msg).toContain('`input text` may send it as a key event, on iOS idb types it as a key press');
    expect(msg).not.toMatch(/into ENTER|a newline/);
  });
});

/**
 * Code review of round 7, P2: the remedy after the fate told U+0007, a tab
 * and ESC to "send the key deliberately — pressKey('enter')" — a key that is
 * not theirs, and submits the form. `pressKey('enter')` is named for a
 * newline and a return only (adapters/input-text.ts#controlCharRemedy).
 */
describe('assertTypeable names pressKey(\'enter\') as the remedy only for a newline and a return', () => {
  it.each(['\n', '\r'])('%j: send ENTER deliberately', (ch) => {
    expect(refusal(`a${ch}b`)).toMatch(/before anything was sent\. Type the text without it and send the key deliberately — pressKey\('enter'\) \(the `press_key` tool, `key: enter`\)\.$/);
  });

  it('a tab: there is no tab key, and no ENTER', () => {
    const msg = refusal('a\tb');
    expect(msg).toMatch(/before anything was sent\. Type the text without it; there is no tab key, so a tab cannot be typed\.$/);
    expect(msg).not.toContain('pressKey');
  });

  it.each(['\x00', '\x07', '\x0b', '\x1b', '\x7f'])('%j: no key for it at all, and no ENTER', (ch) => {
    const msg = refusal(`a${ch}b`);
    expect(msg).toMatch(/before anything was sent\. Type the text without it; there is no key for it, so it cannot be typed\.$/);
    expect(msg).not.toMatch(/pressKey|tab key/);
  });
});

/**
 * D43a (docs/adr/0037-a-value-the-adapter-cannot-type-is-refused-before-any-device-call.md): a character the adapter
 * cannot type is refused here too, after the control-character check, before anything is sent — iOS's `idb ui text`
 * failed the whole call on it with a Python trace, Android's `input text` typed the characters before it and then
 * crashed. The message names the character by code point (and shows it where it is visible), says nothing was sent
 * and what the adapter types — and never the value around it.
 */
describe('assertTypeable refuses a character the adapter cannot type', () => {
  it.each([
    ['iOS', IOS, /idb ui text/],
    ['Android', ANDROID, /input text/],
  ] as const)('%s: names the character by code point and shows it, says nothing was sent and that it types only printable ASCII', (_name, adapter, tool) => {
    const msg = refusal('Jan Šťastný', adapter);
    expect(msg).toMatch(/^cannot type U\+0160 'Š': /);
    expect(msg).toContain('only printable ASCII (U+0020–U+007E)');
    expect(msg).toMatch(tool);
    expect(msg).toContain('Refused before anything was sent — nothing tapped, cleared or typed.');
  });

  it.each([
    ['’', "U+2019 '’'"],
    ['“', "U+201C '“'"],
    ['–', "U+2013 '–'"],
    ['…', "U+2026 '…'"],
    ['é', "U+00E9 'é'"],
    ['😀', "U+1F600 '😀'"],
  ])('%j reads %s', (ch, shown) => {
    expect(refusal(`a${ch}b`, IOS)).toMatch(new RegExp(`^cannot type ${shown.replace(/[+.]/g, '\\$&')}: `));
  });

  it('a space other than U+0020 is named, not shown (a quoted NBSP reads as a plain space)', () => {
    const msg = refusal('99\u00a090', ANDROID);
    expect(msg).toMatch(/^cannot type U\+00A0 \(a space other than U\+0020\): /);
    expect(msg).not.toContain('\u00a0');
  });

  it('an invisible character (a combining mark, a zero-width space) is named by code point alone', () => {
    expect(refusal('e\u0301', IOS)).toMatch(/^cannot type U\+0301: /);
    expect(refusal('a\u200bb', IOS)).toMatch(/^cannot type U\+200B: /);
  });

  it('never echoes the value — it may be a credential', () => {
    for (const adapter of [IOS, ANDROID]) {
      const msg = refusal('heslo-Š-123', adapter);
      expect(msg).not.toContain('heslo');
      expect(msg).not.toContain('123');
    }
  });

  it('the control-character refusal comes first: a value holding both is refused as the control character, on either platform', () => {
    expect(refusal('Š\n', IOS)).toMatch(/^cannot type U\+000A \("\\n", a control character\)/);
    expect(refusal('Š\n', ANDROID)).toMatch(/^cannot type U\+000A \("\\n", a control character\)/);
  });

  it('printable ASCII passes, on both', () => {
    for (const adapter of [IOS, ANDROID]) expect(() => assertTypeable('Jan Novak & Co. <jan@example.com> ~!', adapter.typeable)).not.toThrow();
  });
});

/**
 * D43 (ADR 0037's D43 amendment): every refusal ends with the remedy true for its adapter (Typeable.otherPath) — no
 * longer "averi has no other typing path yet" on every one. idb's names the WDA tree source for a character
 * WebDriverAgent types, and no path for one it does not; Android names none on API 33; WDA's names none, its set saying
 * what is not measured. None of them quotes the value.
 */
describe('assertTypeable ends each refusal with its adapter\'s remedy', () => {
  it('iOS (idb): a character WebDriverAgent types — names `ios.treeSource: wda`', () => {
    expect(refusal('Jan Šťastný', IOS)).toMatch(/nothing tapped, cleared or typed\. A project with `ios\.treeSource: wda` types it through WebDriverAgent \(ADR 0037\); otherwise use a value without it, or enter it by hand\.$/);
  });

  it('iOS (idb): an emoji, which WebDriverAgent\'s set does not take — no path on iOS, no wda claim', () => {
    const msg = refusal('a😀', IOS);
    expect(msg).toMatch(/nothing tapped, cleared or typed\. averi has no typing path for it on iOS \(WebDriverAgent's `\/wda\/keys` is not measured for it; ADR 0037\): use a value without it, or enter it by hand\.$/);
    expect(msg).not.toContain('ios.treeSource');
  });

  it('Android: no path on API 33, said so', () => {
    const msg = refusal('Jan Šťastný', ANDROID);
    expect(msg).toMatch(/nothing tapped, cleared or typed\. averi has no typing path for it on Android \(no shell clipboard setter on API 33; ADR 0037\): use a value without it, or enter it by hand\.$/);
    expect(msg).not.toContain('WebDriverAgent');
  });

  it('iOS (WDA): Šťastný and O’Brien are not refused; an emoji is, as not measured through /wda/keys, with no other path', () => {
    expect(() => assertTypeable('Jan Šťastný', IOS_WDA.typeable)).not.toThrow();
    expect(() => assertTypeable('O’Brien “Jr.” – Co…', IOS_WDA.typeable)).not.toThrow();
    const msg = refusal('a😀', IOS_WDA);
    expect(msg).toMatch(/^cannot type U\+1F600 '😀': on iOS with WebDriverAgent .*not measured through `\/wda\/keys`\. Refused before anything was sent — nothing tapped, cleared or typed\. Use a value without it, or enter it by hand\.$/);
  });

  it('no refusal says "no other typing path yet" any more, and none quotes the value', () => {
    for (const [adapter, value] of [[IOS, 'heslo-Š-123'], [IOS, 'heslo-😀-123'], [ANDROID, 'heslo-Š-123'], [IOS_WDA, 'heslo-😀-123']] as const) {
      const msg = refusal(value, adapter);
      expect(msg).not.toContain('no other typing path yet');
      expect(msg).not.toContain('heslo');
      expect(msg).not.toContain('123');
    }
  });

  it('the control-character refusal still comes first over WDA\'s set', () => {
    expect(refusal('Š\n', IOS_WDA)).toMatch(/^cannot type U\+000A \("\\n", a control character\)/);
  });
});
