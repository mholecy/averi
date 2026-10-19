import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { capture } from '../../scripts/truth/capture-run.js';
import { AndroidLab, DEVICE_CHECK_SIMULATOR, IosLab, type Exec } from '../../scripts/truth/lab-device.js';
import { parseLabApp, type CatalogCell } from '../../scripts/truth/schema.js';

// The lab devices' guards (scripts/truth/lab-device.ts): a capture or a live run touches the lab's own simulator or
// AVD, or nothing — checked against what simctl and adb report, through a fake exec (no device).

const LAB_UDID = '0F6C2D3E-1111-4222-8333-944455556666';
const OTHER_UDID = 'A1B2C3D4-0000-4000-8000-000000000000';
const SUFFIXED_UDID = 'B2C3D4E5-0000-4000-8000-000000000000';
const OLD_LAB_UDID = 'C3D4E5F6-0000-4000-8000-000000000000';
const SIMCTL = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
      { udid: LAB_UDID, name: 'averi-lab iPhone 17', state: 'Booted' },
      { udid: DEVICE_CHECK_SIMULATOR, name: 'averi-lab iPhone 17 (device check)', state: 'Booted' },
      { udid: OTHER_UDID, name: 'iPhone 17', state: 'Shutdown' },
      { udid: SUFFIXED_UDID, name: 'iPhone 17 averi-lab', state: 'Shutdown' },
    ],
    'com.apple.CoreSimulator.SimRuntime.iOS-26-2': [{ udid: OLD_LAB_UDID, name: 'averi-lab iPhone 16', state: 'Shutdown' }],
  },
});

/** A fake exec answering simctl's list and adb's AVD name and getprop; every other command recorded and refused. */
function fakeExec(avd = 'averi_lab\r\nOK') {
  const calls: string[] = [];
  const exec: Exec = async (file, args) => {
    const line = `${file} ${args.join(' ')}`;
    calls.push(line);
    if (line === 'xcrun simctl list devices -j') return { stdout: SIMCTL };
    if (/^adb -s \S+ emu avd name$/.test(line)) return { stdout: avd };
    if (/getprop ro\.build\.version\.sdk$/.test(line)) return { stdout: '33\n' };
    if (/getprop ro\.build\.version\.release$/.test(line)) return { stdout: '13\n' };
    if (/simctl terminate|am force-stop/.test(line)) return { stdout: '' };
    throw new Error(`refused in the test: ${line}`);
  };
  return { exec, calls };
}

describe('IosLab: the lab simulator or nothing', () => {
  it('describes the lab simulator by the name and runtime simctl reports', async () => {
    const { exec } = fakeExec();
    expect(await new IosLab(LAB_UDID, { exec }).describe()).toBe('averi-lab iPhone 17 simulator, iOS 27.0');
  });

  it('refuses a simulator not named averi-lab …, one simctl does not list, and the device-check simulator by its udid, before launching anything', async () => {
    for (const [udid, why] of [
      [OTHER_UDID, /is "iPhone 17", not the lab's \(averi-lab …\): refused/],
      [SUFFIXED_UDID, /is "iPhone 17 averi-lab", not the lab's \(averi-lab …\): refused/],
      ['00000000-0000-4000-8000-00000000FFFF', /no simulator .* in simctl's list: refused/],
      [DEVICE_CHECK_SIMULATOR, /is the device-check simulator/],
      [DEVICE_CHECK_SIMULATOR.toLowerCase(), /is the device-check simulator/],
    ] as const) {
      const { exec, calls } = fakeExec();
      const lab = new IosLab(udid, { exec });
      await expect(lab.describe()).rejects.toThrow(why);
      await expect(lab.launch('open')).rejects.toThrow(why);
      expect(calls.filter((c) => !c.startsWith('xcrun simctl list'))).toEqual([]);
    }
  });

  it("refuses the device-check simulator's WDA ports, 8100 and 8101, before anything runs", () => {
    for (const wdaPort of [8100, 8101]) {
      const { exec, calls } = fakeExec();
      expect(() => new IosLab(LAB_UDID, { exec, wdaPort })).toThrow(new RegExp(`WDA port ${wdaPort} is the device-check simulator's`));
      expect(calls).toEqual([]);
    }
    expect(() => new IosLab(LAB_UDID, { wdaPort: 8120 })).not.toThrow();
  });

  it('close() runs nothing on a refused simulator, nor on one never checked; on the lab simulator it stops the app', async () => {
    for (const udid of [OTHER_UDID, DEVICE_CHECK_SIMULATOR]) {
      const { exec, calls } = fakeExec();
      const lab = new IosLab(udid, { exec });
      await expect(lab.guard()).rejects.toThrow(/refused|device-check/);
      const before = calls.length;
      await lab.close();
      expect(calls.slice(before)).toEqual([]);
    }
    const unchecked = fakeExec();
    await new IosLab(LAB_UDID, { exec: unchecked.exec }).close();
    expect(unchecked.calls).toEqual([]);
    const { exec, calls } = fakeExec();
    const lab = new IosLab(LAB_UDID, { exec });
    await lab.guard();
    await lab.close();
    expect(calls).toEqual(['xcrun simctl list devices -j', `xcrun simctl terminate ${LAB_UDID} dev.averi.lab`]);
  });

  it("a run of some cells into a manifest of another lab simulator is refused: the same-device check reads the guard's description", async () => {
    const out = await mkdtemp(join(tmpdir(), 'averi-lab-device-'));
    try {
      const { exec } = fakeExec();
      expect(await new IosLab(OLD_LAB_UDID, { exec }).describe()).toBe('averi-lab iPhone 16 simulator, iOS 26.2');
      await writeFile(join(out, 'manifest.json'), JSON.stringify({ platform: 'ios', app: 'AveriLab', device: 'averi-lab iPhone 16 simulator, iOS 26.2', note: 'x', captures: [] }));
      await expect(capture(new IosLab(LAB_UDID, { exec }), [], { out, note: 'x', catalog: [], log: () => undefined })).rejects.toThrow(
        /holds captures of AveriLab on ios "averi-lab iPhone 16 simulator, iOS 26\.2", not AveriLab on ios "averi-lab iPhone 17 simulator, iOS 27\.0"/,
      );
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});

describe('AndroidLab: the averi_lab AVD or nothing', () => {
  it('describes the lab AVD by its Android version', async () => {
    const { exec } = fakeExec();
    expect(await new AndroidLab('emulator-5556', { exec }).describe()).toBe('averi_lab emulator, Android 13 (API 33)');
  });

  it('refuses another AVD, or a device adb cannot name, before launching anything', async () => {
    for (const [avd, why] of [
      ['Pixel_7_API_34\r\nOK', /is AVD "Pixel_7_API_34", not the lab's averi_lab: refused/],
      ['averi_lab2\r\nOK', /is AVD "averi_lab2", not the lab's averi_lab: refused/],
      ['averi_lab_old\r\nOK', /is AVD "averi_lab_old", not the lab's averi_lab: refused/],
      ['', /is no emulator adb can name, not the lab's averi_lab: refused/],
    ] as const) {
      const { exec, calls } = fakeExec(avd);
      const lab = new AndroidLab('emulator-5554', { exec });
      await expect(lab.describe()).rejects.toThrow(why);
      await expect(lab.launch('open')).rejects.toThrow(why);
      expect(calls.filter((c) => !c.endsWith('emu avd name'))).toEqual([]);
    }
  });

  it('close() runs nothing on a refused device, nor on one never checked; on the lab AVD it stops the app', async () => {
    const refused = fakeExec('Pixel_7_API_34\r\nOK');
    const other = new AndroidLab('emulator-5554', { exec: refused.exec });
    await expect(other.guard()).rejects.toThrow(/refused/);
    const before = refused.calls.length;
    await other.close();
    expect(refused.calls.slice(before)).toEqual([]);
    const unchecked = fakeExec();
    await new AndroidLab('emulator-5556', { exec: unchecked.exec }).close();
    expect(unchecked.calls).toEqual([]);
    const { exec, calls } = fakeExec();
    const lab = new AndroidLab('emulator-5556', { exec });
    await lab.guard();
    await lab.close();
    expect(calls).toEqual(['adb -s emulator-5556 emu avd name', 'adb -s emulator-5556 shell am force-stop dev.averi.lab']);
  });
  it('reads the navigation mode from settings (0 three buttons, 2 gestures), only of the lab AVD', async () => {
    for (const [mode, want] of [['2\n', 'gesture'], ['0\n', 'three-button'], ['1\n', 'two-button'], ['null\n', undefined]] as const) {
      const { exec, calls } = fakeExec();
      const answering: Exec = async (file, args) => (args.join(' ').endsWith('settings get secure navigation_mode') ? (calls.push(`${file} ${args.join(' ')}`), { stdout: mode }) : exec(file, args));
      expect(await new AndroidLab('emulator-5556', { exec: answering }).navigation()).toBe(want);
      expect(calls).toEqual(['adb -s emulator-5556 emu avd name', 'adb -s emulator-5556 shell settings get secure navigation_mode']);
    }
    const refused = fakeExec('Pixel_7_API_34\r\nOK');
    await expect(new AndroidLab('emulator-5554', { exec: refused.exec }).navigation()).rejects.toThrow(/refused/);
  });
});

describe('the lab apps: each device object drives one app, its cells only', () => {
  const NATIVE_CELL = { id: 'own-parts', family: 'false-covers', layer: 'none', targets: [] } satisfies CatalogCell;
  const RN_CELL = { id: 'rn-field', family: 'react-native', layer: 'none', targets: [] } satisfies CatalogCell;

  it("the native app refuses the React Native app's cells, and the React Native app every other family's, on both platforms", () => {
    for (const lab of [new IosLab(LAB_UDID), new AndroidLab('emulator-5554')]) {
      expect(lab.unsupported(NATIVE_CELL)).toBeUndefined();
      expect(lab.unsupported(RN_CELL)).toBe('a cell of the react-native lab app (AveriLabRN), not of AveriLab');
    }
    for (const lab of [new IosLab(LAB_UDID, { app: 'react-native' }), new AndroidLab('emulator-5554', { app: 'react-native' })]) {
      expect(lab.unsupported(RN_CELL)).toBeUndefined();
      expect(lab.unsupported(NATIVE_CELL)).toBe('a cell of the native lab app (AveriLab), not of AveriLabRN');
    }
  });

  it("the Android layers each app builds are its own: the native app's set, the React Native app's any", () => {
    const own = { id: 'rn-sheet', family: 'react-native', layer: 'rn-sheet', targets: [] } satisfies CatalogCell;
    expect(new AndroidLab('emulator-5554', { app: 'react-native' }).unsupported(own)).toBeUndefined();
    const native = { id: 'x', family: 'presented', layer: 'rn-sheet', targets: [] } satisfies CatalogCell;
    expect(new AndroidLab('emulator-5554').unsupported(native)).toBe('layer rn-sheet is not one the Android app builds');
  });

  it('--app: the native app when not given, a lab app by its name, anything else refused', () => {
    expect(parseLabApp(undefined)).toBe('native');
    expect(parseLabApp('react-native')).toBe('react-native');
    expect(() => parseLabApp('rn')).toThrow('no lab app rn (native, react-native)');
  });

  it('the React Native app launches its own bundle on iOS and reads its own container', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'averi-rn-container-'));
    try {
      const { exec: base, calls } = fakeExec();
      const exec: Exec = async (file, args) => {
        const line = `${file} ${args.join(' ')}`;
        if (/simctl (terminate|spawn) /.test(line)) return (calls.push(line), { stdout: '' });
        if (/simctl get_app_container /.test(line)) return (calls.push(line), { stdout: `${dir}\n` });
        if (/simctl launch /.test(line)) {
          calls.push(line);
          await mkdir(join(dir, 'Documents'), { recursive: true });
          await writeFile(join(dir, 'Documents', 'lab-state.json'), JSON.stringify({ cell: 'rn-field', ready: true }));
          return { stdout: '' };
        }
        return base(file, args);
      };
      expect((await new IosLab(LAB_UDID, { exec, app: 'react-native' }).launch('rn-field')).cell).toBe('rn-field');
      expect(calls.filter((c) => /terminate|get_app_container|simctl launch/.test(c))).toEqual([
        `xcrun simctl terminate ${LAB_UDID} dev.averi.lab.rn`,
        `xcrun simctl get_app_container ${LAB_UDID} dev.averi.lab.rn data`,
        `xcrun simctl launch ${LAB_UDID} dev.averi.lab.rn -cell rn-field`,
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('the React Native app starts its own package on Android and reads its own state file', async () => {
    const { exec: base, calls } = fakeExec();
    let started = false;
    const exec: Exec = async (file, args) => {
      const line = `${file} ${args.join(' ')}`;
      if (/ am start | run-as .* rm /.test(line)) return (calls.push(line), (started ||= / am start /.test(line)), { stdout: '' });
      if (/ run-as .* cat /.test(line)) return (calls.push(line), { stdout: started ? JSON.stringify({ cell: 'rn-field', ready: true }) : '' });
      return base(file, args);
    };
    expect((await new AndroidLab('emulator-5554', { exec, app: 'react-native' }).launch('rn-field')).cell).toBe('rn-field');
    expect(calls.filter((c) => /force-stop|run-as|am start/.test(c))).toEqual(
      expect.arrayContaining([
        'adb -s emulator-5554 shell am force-stop dev.averi.lab.rn',
        'adb -s emulator-5554 shell run-as dev.averi.lab.rn rm -f files/lab-state.json',
        'adb -s emulator-5554 shell am start -W -n dev.averi.lab.rn/.MainActivity --es cell rn-field',
        'adb -s emulator-5554 exec-out run-as dev.averi.lab.rn cat files/lab-state.json',
      ]),
    );
    expect(calls.filter((c) => /dev\.averi\.lab( |\/|$)/.test(c))).toEqual([]);
  });

  it("a run of one app's captures refuses the other app's: the manifest names its app", async () => {
    const out = await mkdtemp(join(tmpdir(), 'averi-lab-device-'));
    try {
      const { exec } = fakeExec();
      await writeFile(join(out, 'manifest.json'), JSON.stringify({ platform: 'ios', app: 'AveriLab', device: 'averi-lab iPhone 17 simulator, iOS 27.0', note: 'x', captures: [] }));
      await expect(capture(new IosLab(LAB_UDID, { exec, app: 'react-native' }), [], { out, note: 'x', catalog: [], log: () => undefined })).rejects.toThrow(
        /holds captures of AveriLab on ios "averi-lab iPhone 17 simulator, iOS 27\.0", not AveriLabRN on ios "averi-lab iPhone 17 simulator, iOS 27\.0"/,
      );
      const { manifest } = await capture(new IosLab(LAB_UDID, { exec }), [], { out, note: 'x', catalog: [], log: () => undefined });
      expect(manifest.app).toBe('AveriLab');
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
