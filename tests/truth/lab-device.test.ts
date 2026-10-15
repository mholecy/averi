import { describe, expect, it } from 'vitest';
import { AndroidLab, DEVICE_CHECK_SIMULATOR, IosLab, type Exec } from '../../scripts/truth/lab-device.js';

// The lab devices' guards (scripts/truth/lab-device.ts): a capture or a live run touches the lab's own simulator or
// AVD, or nothing — checked against what simctl and adb report, through a fake exec (no device).

const LAB_UDID = '0F6C2D3E-1111-4222-8333-944455556666';
const OTHER_UDID = 'A1B2C3D4-0000-4000-8000-000000000000';
const SIMCTL = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
      { udid: LAB_UDID, name: 'averi-lab iPhone 17', state: 'Booted' },
      { udid: DEVICE_CHECK_SIMULATOR, name: 'averi-lab iPhone 17 (device check)', state: 'Booted' },
      { udid: OTHER_UDID, name: 'iPhone 17', state: 'Shutdown' },
    ],
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

  it('a --device label replaces the description, not the guard', async () => {
    const { exec } = fakeExec();
    expect(await new IosLab(LAB_UDID, { exec, device: 'label' }).describe()).toBe('label');
    await expect(new IosLab(OTHER_UDID, { exec, device: 'label' }).describe()).rejects.toThrow(/refused/);
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
      ['', /is no emulator adb can name, not the lab's averi_lab: refused/],
    ] as const) {
      const { exec, calls } = fakeExec(avd);
      const lab = new AndroidLab('emulator-5554', { exec });
      await expect(lab.describe()).rejects.toThrow(why);
      await expect(lab.launch('open')).rejects.toThrow(why);
      expect(calls.filter((c) => !c.endsWith('emu avd name'))).toEqual([]);
    }
  });
});
