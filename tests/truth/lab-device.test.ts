import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { capture } from '../../scripts/truth/capture-run.js';
import { ACTIVITIES_COMMAND, AndroidLab, DEVICE_CHECK_SIMULATOR, FOCUS_WINDOW_COMMAND, HOME_COMMAND, IosLab, withMeasuredPanel, type Exec } from '../../scripts/truth/lab-device.js';
import { INPUT_SHOWN_COMMAND, TOUCHABLE_COMMAND } from '../../src/adapters/android.js';
import { parseLabApp, type CatalogCell, type LabState } from '../../scripts/truth/schema.js';

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

/** A touchable dump of the shape averi's query prints (batch-11's panel). */
const B11_DUMP = '  mShowRequested=true mShowExplicitlyRequested=true mShowForced=false mInputShown=true\n    touchable region=SkRegion((87,1243,1024,2035)(0,2088,1080,2220))\n';

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

  it("batch-13: a guard read that fails keeps adb's first stderr line (execFile's), else its error's first line — still refused, nothing launched", async () => {
    const down = (e: Error): Exec => async () => Promise.reject(e);
    const failed = (stderr: string) => Object.assign(new Error(`Command failed: adb -s emulator-5554 emu avd name\n${stderr}`), { stderr });
    for (const [e, part] of [
      [failed("error: device 'emulator-5554' not found\n"), "(adb: error: device 'emulator-5554' not found)"],
      [failed('\nerror: could not connect to TCP port 5554: Connection refused\n'), '(adb: error: could not connect to TCP port 5554: Connection refused)'],
      [Object.assign(new Error('spawn adb ENOENT'), { stderr: '' }), '(adb: spawn adb ENOENT)'],
      [new Error('spawn adb ENOENT\nat …'), '(adb: spawn adb ENOENT)'],
    ] as const) {
      await expect(new AndroidLab('emulator-5554', { exec: down(e) }).guard()).rejects.toThrow(`emulator-5554 is no emulator adb can name ${part}, not the lab's averi_lab: refused`);
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

  it('swipe(): one raw `input swipe x1 y1 x2 y2 ms`, rounded, only of the lab AVD (T7a, the carousel pre-drag)', async () => {
    const { exec, calls } = fakeExec();
    const answering: Exec = async (file, args) => (args.join(' ').includes('input swipe') ? (calls.push(`${file} ${args.join(' ')}`), { stdout: '' }) : exec(file, args));
    await new AndroidLab('emulator-5556', { exec: answering }).swipe({ x: 871.6, y: 497 }, { x: 431.6, y: 497.4 }, 1000);
    expect(calls).toEqual(['adb -s emulator-5556 emu avd name', 'adb -s emulator-5556 shell input swipe 872 497 432 497 1000']);
    const refused = fakeExec('Pixel_7_API_34\r\nOK');
    await expect(new AndroidLab('emulator-5554', { exec: refused.exec }).swipe({ x: 1, y: 2 }, { x: 3, y: 4 }, 1000)).rejects.toThrow(/refused/);
    expect(refused.calls.filter((c) => c.includes('input swipe'))).toEqual([]);
  });

  it('imeTouchable(): averi\'s own TOUCHABLE_COMMAND, its output raw, only of the lab AVD (D67, the kf launch read)', async () => {
    const { exec, calls } = fakeExec();
    const answering: Exec = async (file, args) => (args.includes(TOUCHABLE_COMMAND) ? (calls.push(`${file} ${args.join(' ')}`), { stdout: B11_DUMP }) : exec(file, args));
    expect(await new AndroidLab('emulator-5556', { exec: answering }).imeTouchable()).toBe(B11_DUMP);
    expect(calls).toEqual(['adb -s emulator-5556 emu avd name', `adb -s emulator-5556 shell ${TOUCHABLE_COMMAND}`]);
    const refused = fakeExec('Pixel_7_API_34\r\nOK');
    await expect(new AndroidLab('emulator-5554', { exec: refused.exec }).imeTouchable()).rejects.toThrow(/refused/);
  });
  it('ime(): the capture asks averi\'s own INPUT_SHOWN_COMMAND and TOUCHABLE_COMMAND, shown and again hidden (D69: one command, no copy)', async () => {
    const { exec, calls } = fakeExec();
    const answers: Record<string, string> = { [INPUT_SHOWN_COMMAND]: 'mInputShown=true\n', [TOUCHABLE_COMMAND]: B11_DUMP, 'dumpsys window displays': 'displays\n', 'input keyevent 4': '' };
    const answering: Exec = async (file, args) => {
      const asked = Object.keys(answers).find((k) => args.slice(3).join(' ') === k);
      if (asked === undefined) return exec(file, args);
      calls.push(`${file} ${args.join(' ')}`);
      return { stdout: answers[asked] };
    };
    // ime() hides the keyboard with a back and waits 1.5 s for it: on fake time, real timers back after.
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const pending = new AndroidLab('emulator-5556', { exec: answering }).ime();
      await vi.runAllTimersAsync();
      expect(await pending).toEqual({ shown: { displays: 'displays\n', inputShown: 'mInputShown=true\n', touchable: B11_DUMP }, hidden: { inputShown: 'mInputShown=true\n', touchable: B11_DUMP } });
    } finally {
      vi.useRealTimers();
    }
    const shell = (command: string) => `adb -s emulator-5556 shell ${command}`;
    expect(calls).toEqual(['adb -s emulator-5556 emu avd name', shell('dumpsys window displays'), shell(INPUT_SHOWN_COMMAND), shell(TOUCHABLE_COMMAND), shell('input keyevent 4'), shell(INPUT_SHOWN_COMMAND), shell(TOUCHABLE_COMMAND)]);
  });
});

describe('AndroidLab: the chooser group\'s reads and steps (T7b)', () => {
  /** A fake exec that answers `answers` (by the shell words after `adb -s <serial> shell`), else fakeExec's. */
  const answeringWith = (answers: Record<string, string | Error>) => {
    const { exec, calls } = fakeExec();
    const answering: Exec = async (file, args) => {
      const asked = Object.keys(answers).find((k) => args.slice(3).join(' ') === k);
      if (asked === undefined) return exec(file, args);
      calls.push(`${file} ${args.join(' ')}`);
      const answer = answers[asked];
      if (answer instanceof Error) throw answer;
      return { stdout: answer };
    };
    return { answering, calls };
  };
  const shell = (command: string) => `adb -s emulator-5556 shell ${command}`;
  /** The lab's own waits run on fake time (1 s after each key), real timers back after. */
  async function onFakeTime<T>(run: () => Promise<T>): Promise<T> {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const pending = run();
      await vi.runAllTimersAsync();
      return await pending;
    } finally {
      vi.useRealTimers();
    }
  }

  it('focus(): the window manager\'s focus lines and the activity stack\'s records, raw, after the guard', async () => {
    const { answering, calls } = answeringWith({ [FOCUS_WINDOW_COMMAND]: 'mFocusedApp=…\n', [ACTIVITIES_COMMAND]: '* Hist  #0: …\n' });
    expect(await new AndroidLab('emulator-5556', { exec: answering }).focus()).toEqual({ window: 'mFocusedApp=…\n', activities: '* Hist  #0: …\n' });
    expect(calls).toEqual(['adb -s emulator-5556 emu avd name', shell(FOCUS_WINDOW_COMMAND), shell(ACTIVITIES_COMMAND)]);
    expect(FOCUS_WINDOW_COMMAND).toBe("dumpsys window displays | grep -E 'mCurrentFocus=|mFocusedApp='");
    expect(ACTIVITIES_COMMAND).toBe("dumpsys activity activities | grep -E 'Hist +#'");
  });

  it('focus(): a window read mid-transition (`mCurrentFocus=null`) is read again every 300 ms until it names a window, 5 s at most; the stack read once it has, the wait and the first window read kept', async () => {
    const { exec, calls } = fakeExec();
    const windows = ['  mCurrentFocus=null\n  mFocusedApp=A\n', '  mCurrentFocus=null\n  mFocusedApp=A\n', '  mCurrentFocus=Window{1 u0 a/b}\n  mFocusedApp=A\n'];
    let w = 0;
    const answering: Exec = async (file, args) => {
      const asked = args.slice(3).join(' ');
      if (asked !== FOCUS_WINDOW_COMMAND && asked !== ACTIVITIES_COMMAND) return exec(file, args);
      calls.push(asked === FOCUS_WINDOW_COMMAND ? 'window' : 'activities');
      return { stdout: asked === FOCUS_WINDOW_COMMAND ? windows[Math.min(w++, windows.length - 1)] : 'stack' };
    };
    expect(await onFakeTime(() => new AndroidLab('emulator-5556', { exec: answering }).focus())).toEqual({ window: windows[2], activities: 'stack', waitedMs: 600, firstWindow: windows[0] });
    expect(calls.slice(1)).toEqual(['window', 'window', 'window', 'activities']);
    // Never settled: the last read kept after exactly 5 s (16 polls of 300 ms, one of 200), the wait said.
    const stuck: Exec = async (file, args) => (args.slice(3).join(' ') === FOCUS_WINDOW_COMMAND ? { stdout: '  mCurrentFocus=null\n' } : args.slice(3).join(' ') === ACTIVITIES_COMMAND ? { stdout: 'stack' } : exec(file, args));
    expect(await onFakeTime(() => new AndroidLab('emulator-5556', { exec: stuck }).focus())).toEqual({ window: '  mCurrentFocus=null\n', activities: 'stack', waitedMs: 5_000, firstWindow: '  mCurrentFocus=null\n' });
  });

  it('focus(): a read that fails is kept as adb\'s words, never thrown; a refused device throws', async () => {
    const failed = Object.assign(new Error('Command failed'), { stderr: 'error: device offline\n' });
    const { answering } = answeringWith({ [FOCUS_WINDOW_COMMAND]: 'x', [ACTIVITIES_COMMAND]: failed });
    expect(await new AndroidLab('emulator-5556', { exec: answering }).focus()).toEqual({ error: 'error: device offline' });
    const refused = fakeExec('Pixel_7_API_34\r\nOK');
    await expect(new AndroidLab('emulator-5554', { exec: refused.exec }).focus()).rejects.toThrow(/refused/);
  });

  it('toLauncher(): the lab force-stopped, HOME pressed, a second to settle, then the HOME activity the device resolves, raw; only of the lab AVD', async () => {
    const { answering, calls } = answeringWith({ 'input keyevent KEYCODE_HOME': '', [HOME_COMMAND]: 'priority=0\nl/.Home\n' });
    expect(await onFakeTime(() => new AndroidLab('emulator-5556', { exec: answering }).toLauncher())).toEqual({ resolved: 'priority=0\nl/.Home\n' });
    expect(calls).toEqual(['adb -s emulator-5556 emu avd name', shell('am force-stop dev.averi.lab'), shell('input keyevent KEYCODE_HOME'), shell(HOME_COMMAND)]);
    expect(HOME_COMMAND).toBe('cmd package resolve-activity --brief -c android.intent.category.HOME -a android.intent.action.MAIN');
    const failed = Object.assign(new Error('Command failed'), { stderr: 'error: closed\n' });
    const broken = answeringWith({ 'input keyevent KEYCODE_HOME': '', [HOME_COMMAND]: failed });
    expect(await onFakeTime(() => new AndroidLab('emulator-5556', { exec: broken.answering }).toLauncher())).toEqual({ error: 'error: closed' });
    const refused = fakeExec('Pixel_7_API_34\r\nOK');
    await expect(new AndroidLab('emulator-5554', { exec: refused.exec }).toLauncher()).rejects.toThrow(/refused/);
    expect(refused.calls.filter((c) => c.includes('shell'))).toEqual([]);
  });

  it('back(): one BACK, a second to settle; only of the lab AVD', async () => {
    const { answering, calls } = answeringWith({ 'input keyevent KEYCODE_BACK': '' });
    await onFakeTime(() => new AndroidLab('emulator-5556', { exec: answering }).back());
    expect(calls).toEqual(['adb -s emulator-5556 emu avd name', shell('input keyevent KEYCODE_BACK')]);
    const refused = fakeExec('Pixel_7_API_34\r\nOK');
    await expect(new AndroidLab('emulator-5554', { exec: refused.exec }).back()).rejects.toThrow(/refused/);
  });
});

describe('withMeasuredPanel: the kf launch read kept on the launch (D67)', () => {
  const launched = { cell: 'form-keyboard-floating', ready: true, screen: { x: 0, y: 0, width: 1080, height: 2220 }, scale: 1, frames: {}, events: [] } satisfies LabState;

  it('a read that answers: its output raw on the launch, nothing said', async () => {
    const said: string[] = [];
    const lab = { guard: async () => undefined, imeTouchable: async () => B11_DUMP };
    expect(await withMeasuredPanel(launched, lab, (l) => said.push(l))).toEqual({ ...launched, imeTouchable: B11_DUMP });
    expect(said).toEqual([]);
  });

  it('a read that fails past the guard: kept as its error, said on the log — the run goes on', async () => {
    const said: string[] = [];
    const lab = { guard: async () => undefined, imeTouchable: async () => Promise.reject(new Error('adb: device offline')) };
    expect(await withMeasuredPanel(launched, lab, (l) => said.push(l))).toEqual({ ...launched, imeTouchable: { error: 'adb: device offline' } });
    expect(said).toEqual(['the IME region read failed: adb: device offline']);
  });

  it('a device the guard refuses: rethrown, never read, nothing kept', async () => {
    const said: string[] = [];
    const { exec, calls } = fakeExec('Pixel_7_API_34\r\nOK');
    await expect(withMeasuredPanel(launched, new AndroidLab('emulator-5554', { exec }), (l) => said.push(l))).rejects.toThrow(/not the lab's averi_lab: refused/);
    expect(calls.filter((c) => !c.endsWith('emu avd name'))).toEqual([]);
    expect(said).toEqual([]);
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
