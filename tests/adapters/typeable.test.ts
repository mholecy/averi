import { describe, expect, it, vi } from 'vitest';
import { AndroidAdapter } from '../../src/adapters/android.js';
import type { ExecFn } from '../../src/adapters/exec.js';
import { IosAdapter } from '../../src/adapters/ios.js';
import type { IosTreeSource } from '../../src/adapters/ios-tree-source.js';
import { firstUntypeable } from '../../src/adapters/typeable.js';
import type { DeviceAdapter } from '../../src/adapters/types.js';
import { drawnOverStrip } from '../helpers/android-dumps.js';

vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));

/**
 * Typeability is a per-adapter fact (docs/adr/0037-a-value-the-adapter-cannot-type-is-refused-before-any-device-call.md,
 * D43a): the characters each adapter's `typeText` can deliver, declared on the adapter (`DeviceAdapter.typeable`) and
 * read by one checker (adapters/typeable.ts#firstUntypeable).
 * - iOS, under both tree sources (the typing is `idb ui text` on either): printable ASCII and `\n` — idb's KEY_MAP
 *   (fb-idb idb/common/hid.py), anything else fails the whole call with a Python trace, the field untouched.
 * - Android: printable ASCII — `input text` NPEs (exit 255) on a character outside the virtual key map, after every
 *   earlier one landed. Conservative: an extended letter the key map may hold (é) is unmeasured, refused too.
 */
const recordingExec = () => {
  const calls: string[] = [];
  const fn: ExecFn = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    return { stdout: Buffer.alloc(0), stderr: '' };
  };
  return { fn, calls };
};

const treeSource = (kind: 'idb' | 'wda'): IosTreeSource => ({
  kind,
  read: () => Promise.reject(new Error('this test reads no tree')),
  applicationLabel: () => Promise.reject(new Error('this test reads no tree')),
  dispose: () => Promise.resolve(),
});

const ios = (kind: 'idb' | 'wda'): DeviceAdapter => new IosAdapter({ udid: 'AAAA-1111', exec: recordingExec().fn, treeSource: treeSource(kind) });
const android = (): DeviceAdapter => new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: recordingExec().fn });

/** Every character the analysis named (D43): a Czech letter, typographic quotes and dashes, NBSP, a Latin-1 letter, an astral emoji. */
const UNTYPEABLE: [string, string][] = [
  ['Š', 'U+0160'],
  ['’', 'U+2019'],
  ['“', 'U+201C'],
  ['–', 'U+2013'],
  ['…', 'U+2026'],
  [' ', 'U+00A0'],
  ['é', 'U+00E9'],
  ['😀', 'U+1F600'],
];

const adapters: [string, () => DeviceAdapter][] = [
  ['iOS (idb tree source)', () => ios('idb')],
  ['iOS (WDA tree source)', () => ios('wda')],
  ['Android', android],
];

describe.each(adapters)('%s declares what its typeText types: printable ASCII', (_name, make) => {
  it.each(UNTYPEABLE)('%j (%s) is untypeable — and named whole, as the first untypeable character after ASCII', (ch) => {
    const adapter = make();
    expect(firstUntypeable(ch, adapter.typeable)).toBe(ch);
    expect(firstUntypeable(`heslo-${ch}-123`, adapter.typeable)).toBe(ch);
  });

  it('the first untypeable character, not a later one', () => {
    expect(firstUntypeable('a–Šb', make().typeable)).toBe('–');
  });

  it('the boundaries: U+0020 and U+007E typeable, U+007F not (also the control-character refusal\'s), U+0080 not', () => {
    const { typeable } = make();
    expect(firstUntypeable(' ', typeable)).toBeUndefined();
    expect(firstUntypeable('~', typeable)).toBeUndefined();
    expect(firstUntypeable('\x7f', typeable)).toBe('\x7f');
    expect(firstUntypeable('\x80', typeable)).toBe('\x80');
  });

  it('every printable ASCII character is typeable', () => {
    const all = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
    expect(firstUntypeable(all, make().typeable)).toBeUndefined();
  });
});

describe('the newline: in idb\'s key map, not Android\'s — and refused on both before typing as a control character (type-text.ts)', () => {
  it.each([['idb'], ['wda']] as const)('iOS (%s tree source): an ASCII value with \\n is typeable by the adapter', (kind) => {
    expect(firstUntypeable('line one\nline two', ios(kind).typeable)).toBeUndefined();
  });

  it('Android: \\n is not typeable text (`input text` may send it as ENTER)', () => {
    expect(firstUntypeable('line one\nline two', android().typeable)).toBe('\n');
  });
});

/**
 * D43a's defensive check: a caller that bypasses interact/ (assertTypeable) must not half-type a value on Android —
 * `input text` used to type `Jan ` and then exit 255 on `Š` (docs/bugs/2026-10-16-lab-android-type-text-types-a-prefix-then-fails-on-non-ascii.md).
 */
describe('AndroidAdapter.typeText refuses an untypeable character before any exec', () => {
  it.each(UNTYPEABLE)('%j (%s): throws, nothing sent to the device', async (ch, code) => {
    const { fn, calls } = recordingExec();
    const typing = new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).typeText(`Jan ${ch}tastny`);
    await expect(typing).rejects.toThrow(`cannot type ${code}`);
    await expect(typing).rejects.toThrow('Refused before anything was sent');
    expect(calls).toEqual([]);
  });

  it('the refusal never quotes the value around the character', async () => {
    const { fn } = recordingExec();
    const error = (await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).typeText('heslo-Š-123').catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain('heslo');
    expect(error.message).not.toContain('123');
  });

  it('an ASCII value takes today\'s path: one `input text` per character, then the commit nudge', async () => {
    const { fn, calls } = recordingExec();
    await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).typeText('a b');
    expect(calls.filter((c) => c.includes(' input '))).toEqual([
      'adb -s emulator-5554 shell input text a',
      'adb -s emulator-5554 shell input text %s',
      'adb -s emulator-5554 shell input text b',
      'adb -s emulator-5554 shell input keyevent 21',
      'adb -s emulator-5554 shell input keyevent 22',
    ]);
  });
});
