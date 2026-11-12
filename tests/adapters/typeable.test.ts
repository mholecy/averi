import { describe, expect, it, vi } from 'vitest';
import { AndroidAdapter } from '../../src/adapters/android.js';
import type { ExecFn } from '../../src/adapters/exec.js';
import { IosAdapter } from '../../src/adapters/ios.js';
import { parseIdbDescribeAll, type IosTreeSource } from '../../src/adapters/ios-tree-source.js';
import { AutoTreeSource, idbFallbackNote } from '../../src/adapters/auto-tree-source.js';
import { IDB_TYPEABLE, WDA_TYPEABLE } from '../../src/adapters/ios-typing.js';
import { refusalOf, type Typeable } from '../../src/adapters/typeable.js';
import type { DeviceAdapter } from '../../src/adapters/types.js';
import { drawnOverStrip } from '../helpers/android-dumps.js';

vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));

/**
 * Typeability is a per-adapter fact (docs/adr/0037-a-value-the-adapter-cannot-type-is-refused-before-any-device-call.md,
 * D43a): the characters each adapter's `typeText` can deliver, declared on the adapter (`DeviceAdapter.typeable`) and
 * read by one function (adapters/typeable.ts#refusalOf).
 * - iOS over a source that does not type (idb's, the differential harness's recorded one): printable ASCII and `\n` —
 *   idb's KEY_MAP (fb-idb idb/common/hid.py), anything else fails the whole call with a Python trace, the field
 *   untouched. Over a source that types (IosTreeSource.typeText: WDA's, D43): WDA_TYPEABLE (ios-typing.test.ts).
 * - Android: printable ASCII — `input text` NPEs (exit 255) on a character outside the virtual key map, after every
 *   earlier one landed. Conservative: an extended letter the key map may hold (é) is unmeasured, refused too.
 */
/** The code point `refusalOf` names first in its refusal of `text` — the first character it cannot type — or undefined. */
const refused = (text: string, typeable: Typeable): string | undefined => refusalOf(text, typeable)?.match(/^cannot type (U\+[0-9A-F]{4,})/)?.[1];

const recordingExec = () => {
  const calls: string[] = [];
  const fn: ExecFn = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    return { stdout: Buffer.alloc(0), stderr: '' };
  };
  return { fn, calls };
};

/** A tree source of `kind` — with a typer (IosTreeSource.typeText, WDA's since D43) only when `types`. */
const treeSource = (kind: 'idb' | 'wda', types = false): IosTreeSource => ({
  kind,
  read: () => Promise.reject(new Error('this test reads no tree')),
  applicationLabel: () => Promise.reject(new Error('this test reads no tree')),
  dispose: () => Promise.resolve(),
  ...(types && { typeText: () => Promise.resolve() }),
});

const ios = (kind: 'idb' | 'wda', types = false): DeviceAdapter => new IosAdapter({ udid: 'AAAA-1111', exec: recordingExec().fn, treeSource: treeSource(kind, types) });
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
  ['iOS (a source of kind wda that does not type: the recorded one)', () => ios('wda')],
  ['Android', android],
];

/**
 * D43: the set follows the source's typer, not its kind — an IosAdapter over a source with `typeText` (WDA's) declares
 * WDA_TYPEABLE; over one without it (idb's, and the differential harness's RecordedTreeSource, kind `wda` but no
 * typer) IDB_TYPEABLE.
 */
describe('IosAdapter.typeable comes from the tree source', () => {
  it('a source that types (WDA\'s): WDA_TYPEABLE', () => {
    expect(ios('wda', true).typeable).toBe(WDA_TYPEABLE);
  });

  it('auto (A41a): WDA_TYPEABLE until its first read chose idb, IDB_TYPEABLE from then on; its claim note forwarded', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const wda = { ...treeSource('wda', true), bringUp: () => Promise.reject(new Error('no WebDriverAgent')), buildCached: async () => true };
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: recordingExec().fn, treeSource: new AutoTreeSource({ wda, idb: { ...treeSource('idb'), read: async () => parseIdbDescribeAll('[]') } }) });
    expect(adapter.typeable).toBe(WDA_TYPEABLE);
    expect(adapter.claimNote).toBeUndefined();
    await adapter.uiTree();
    expect(adapter.typeable).toBe(IDB_TYPEABLE);
    expect(adapter.claimNote).toBe(idbFallbackNote('no WebDriverAgent'));
    errors.mockRestore();
  });

  it.each([['idb'], ['wda']] as const)('a source of kind %s without a typer: IDB_TYPEABLE', (kind) => {
    expect(ios(kind).typeable).toBe(IDB_TYPEABLE);
  });

  it('over WDA\'s source: the gate\'s corpus typeable, an emoji, a combining mark and a ZWJ refused, whole', () => {
    const { typeable } = ios('wda', true);
    for (const text of ['Jan Šťastný', 'O’Brien “Jr.” – Co…', '1\u00a0234,50', 'Ђорђе', '東京', 'Καλημέρα']) expect(refused(text, typeable)).toBeUndefined();
    expect(refused('a😀', typeable)).toBe('U+1F600');
    expect(refused('e\u0301', typeable)).toBe('U+0301');
    expect(refused('a\u200db', typeable)).toBe('U+200D');
  });
});

describe.each(adapters)('%s declares what its typeText types: printable ASCII', (_name, make) => {
  it.each(UNTYPEABLE)('%j (%s) is untypeable — and named whole, as the first untypeable character after ASCII', (ch, code) => {
    const adapter = make();
    expect(refused(ch, adapter.typeable)).toBe(code);
    expect(refused(`heslo-${ch}-123`, adapter.typeable)).toBe(code);
  });

  it('the first untypeable character, not a later one', () => {
    expect(refused('a–Šb', make().typeable)).toBe('U+2013');
  });

  it('the boundaries: U+0020 and U+007E typeable, U+007F not (also the control-character refusal\'s), U+0080 not', () => {
    const { typeable } = make();
    expect(refused(' ', typeable)).toBeUndefined();
    expect(refused('~', typeable)).toBeUndefined();
    expect(refused('\x7f', typeable)).toBe('U+007F');
    expect(refused('\x80', typeable)).toBe('U+0080');
  });

  it('every printable ASCII character is typeable', () => {
    const all = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
    expect(refused(all, make().typeable)).toBeUndefined();
  });
});

describe('the newline: in idb\'s key map, not Android\'s — and refused on both before typing as a control character (type-text.ts)', () => {
  it.each([['idb', false], ['wda', false], ['wda', true]] as const)('iOS (%s tree source, a typer: %s): an ASCII value with \\n is typeable by the adapter', (kind, types) => {
    expect(refused('line one\nline two', ios(kind, types).typeable)).toBeUndefined();
  });

  it('Android: \\n is not typeable text (`input text` may send it as ENTER)', () => {
    expect(refused('line one\nline two', android().typeable)).toBe('U+000A');
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
