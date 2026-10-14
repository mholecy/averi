import childProcess from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { PNG } from 'pngjs';
import type { Platform, Screen } from './corpus.js';

/**
 * The fake device of the differential harness: the PROCESS boundary, faked
 * once for the whole process. Every command averi runs goes through
 * `child_process.execFile` (adapters/exec.ts is the one caller), so that is
 * the one place a device can be answered without reaching into either side's
 * modules: `idb`, `xcrun simctl`, `adb` and the OCR recognizer's `swiftc`
 * are answered here from the recording and a small device profile, and each
 * command is written to the call log — what the tool would have SENT. Both
 * sides of a run share it; the harness runs one call at a time and resets
 * the device between calls.
 *
 * It is also the guarantee that a differential run touches no device: every
 * other way to start a process (`spawn`, `exec`, the sync forms, `fork`)
 * throws, and an `execFile` of an unknown command fails as a missing binary.
 *
 * What it answers:
 *  - iOS: `idb describe --json` the screen in points (no screen: it fails),
 *    `idb ui describe-all --json` the recording's raw idb payload, `xcrun
 *    simctl io … screenshot <file>` a grey PNG written to the file, every
 *    `idb ui` input accepted, the app running (`launchctl list`), no log.
 *  - Android: `uiautomator dump` the recording's raw XML, `wm size` the
 *    screen (no screen: it fails), `dumpsys window displays` the API 33
 *    Pixel_3a captures in tests/fixtures (keyboard hidden or shown), the
 *    `mInputShown` witness and the touchable region the docked Gboard's,
 *    `screencap -p` a grey PNG, every `input` accepted — and `input keyevent
 *    4` (back) hides a shown keyboard, as Gboard does; the app running
 *    (`pidof`), no log.
 *  - `swiftc` compiles nothing (an empty file where the binary goes), and
 *    the "recognizer" reads no text in any region.
 */

export type KeyboardState = 'hidden' | 'shown';

export interface DeviceProfile {
  platform: Platform;
  /** undefined: the screen query fails (`idb describe` / `wm size`) — the tools' no-screen path. */
  screen: Screen | undefined;
  /** The screenshot's size, in pixels — answered whether or not the screen query is. */
  frame: Screen;
  /** iOS raw idb: what `ui describe-all` prints. */
  idbPayload?: string;
  /** Android raw: what `uiautomator dump /dev/tty` prints (the status line is appended). */
  dumpXml?: string;
  /** Android: the soft keyboard at the start of each call. */
  keyboard?: KeyboardState;
}

interface DeviceState {
  profile: DeviceProfile;
  keyboard: KeyboardState;
  calls: string[];
}

let current: DeviceState | undefined;

/** Point the fake at a device for the calls that follow; the call log and the keyboard start over. */
export function useDevice(profile: DeviceProfile): void {
  current = { profile, keyboard: profile.keyboard ?? 'hidden', calls: [] };
}

/** The device calls made since `useDevice` (or the last `resetCalls`), consecutive repeats folded as `×N`. */
export function deviceCalls(): string[] {
  const out: string[] = [];
  let last: string | undefined;
  let n = 0;
  for (const c of current?.calls ?? []) {
    if (c === last) {
      n++;
      continue;
    }
    if (last !== undefined) out.push(n > 1 ? `${last} ×${n}` : last);
    last = c;
    n = 1;
  }
  if (last !== undefined) out.push(n > 1 ? `${last} ×${n}` : last);
  return out;
}

/** Log a device read the fake did not answer itself — a recorded tree served at the tree-source seam. */
export function logCall(line: string): void {
  current?.calls.push(line);
}

/** A new call: an empty log, the profile's keyboard again. */
export function resetDevice(): void {
  if (current !== undefined) useDevice(current.profile);
}

// --- PNG frames, one per size, built once ---

const frames = new Map<string, Buffer>();
function frame(screen: Screen): Buffer {
  const key = `${screen.width}x${screen.height}`;
  let png = frames.get(key);
  if (png === undefined) {
    const img = new PNG({ width: screen.width, height: screen.height });
    for (let i = 0; i < img.data.length; i += 4) img.data.set([0x80, 0x80, 0x80, 0xff], i);
    // 8-bit greyscale: the same #808080 once decoded, a quarter of the bytes to inflate.
    png = PNG.sync.write(img, { colorType: 0, inputColorType: 6 });
    frames.set(key, png);
  }
  return png;
}

// --- the Android device profile: the API 33 Pixel_3a captures ---

const FIXTURES = new URL('../../tests/fixtures/', import.meta.url);
const displays = {
  hidden: readFileSync(new URL('dumpsys-window-displays-api33-keyboard-hidden.txt', FIXTURES), 'utf8'),
  shown: readFileSync(new URL('dumpsys-window-displays-api33-keyboard-shown.txt', FIXTURES), 'utf8'),
};
const inputShown = (shown: boolean) => `  mShowRequested=${shown} mShowExplicitlyRequested=false mShowForced=false mInputShown=${shown}\n`;
const touchable = (shown: boolean) => `  touchable region=SkRegion((0,${shown ? 1398 : 2088},1080,2220))\n`;

// --- answering a command ---

class CommandError extends Error {
  constructor(message: string, readonly code: number | string) {
    super(message);
  }
}

type Answer = Buffer | string;

function answer(cmd: string, args: string[], stdin: string | undefined): Answer {
  if (cmd === 'swiftc') {
    if (args[0] === '--version') return 'differential fake swiftc\n';
    const out = args[args.indexOf('-o') + 1];
    writeFileSync(out, '');
    return '';
  }
  if (cmd.includes('averi-ocr-bin')) {
    const regions = (JSON.parse(stdin ?? '{}') as { regions?: { id: string }[] }).regions ?? [];
    return JSON.stringify({ results: regions.map((r) => ({ id: r.id, lines: [] })) });
  }
  const device = current;
  if (device === undefined) throw new CommandError(`differential: no device for ${cmd} ${args.join(' ')}`, 1);
  const { profile } = device;
  if (cmd === 'xcrun') {
    if (args[0] === '--find') return '/fake/simctl\n';
    if (args[0] === 'simctl' && args[1] === 'io' && args[3] === 'screenshot') {
      device.calls.push('simctl screenshot');
      writeFileSync(args[4], frame(profile.frame));
      return '';
    }
    // The app named in averi.yaml (differential.app) is running; its log is empty.
    if (args[0] === 'simctl' && args[1] === 'spawn' && args[3] === 'launchctl') return 'PID\tStatus\tLabel\n1\t0\tUIKitApplication:differential.app[1][rb-legacy]\n';
    device.calls.push(`xcrun ${args.join(' ')}`);
    return '';
  }
  if (cmd === 'idb') {
    const argv = args.slice(0, args.indexOf('--udid') === -1 ? undefined : args.indexOf('--udid'));
    const line = argv.join(' ');
    device.calls.push(`idb ${line}`);
    if (line === 'describe --json') {
      if (profile.screen === undefined) throw new CommandError('differential: idb describe answered nothing', 1);
      return JSON.stringify({ screen_dimensions: { width_points: profile.screen.width, height_points: profile.screen.height } });
    }
    if (line === 'ui describe-all --json') {
      if (profile.idbPayload === undefined) throw new CommandError('differential: no idb payload recorded', 1);
      return profile.idbPayload;
    }
    return '';
  }
  if (cmd === 'adb') {
    const argv = args[0] === '-s' ? args.slice(2) : args;
    const line = argv.join(' ');
    if (argv[0] === 'exec-out' && argv[1] === 'uiautomator') {
      device.calls.push('adb uiautomator dump');
      if (profile.dumpXml === undefined) throw new CommandError('differential: no uiautomator dump recorded', 1);
      return `${profile.dumpXml}\nUI hierchary dumped to: /dev/tty\n`;
    }
    if (argv[0] === 'exec-out' && argv[1] === 'screencap') {
      device.calls.push('adb screencap');
      return frame(profile.frame);
    }
    device.calls.push(`adb ${line}`);
    if (argv[0] === 'get-state') return 'device\n';
    if (argv[0] !== 'shell') return '';
    if (argv[1]?.includes('pidof')) return '4242\n';
    const shell = argv.slice(1).join(' ');
    const shown = device.keyboard === 'shown';
    if (shell === 'wm size') {
      if (profile.screen === undefined) throw new CommandError('differential: wm size answered nothing', 1);
      return `Physical size: ${profile.screen.width}x${profile.screen.height}\n`;
    }
    if (shell === 'dumpsys window displays') return shown ? displays.shown : displays.hidden;
    if (shell.startsWith('dumpsys input_method')) return shell.includes('touchable region') ? inputShown(shown) + touchable(shown) : inputShown(shown);
    if (shell === 'input keyevent 4') device.keyboard = 'hidden';
    return '';
  }
  throw new CommandError(`spawn ${cmd} ENOENT`, 'ENOENT');
}

// --- the process boundary ---

type ExecFileCallback = (err: (Error & { code?: number | string; killed?: boolean; signal?: string }) | null, stdout: Buffer, stderr: Buffer) => void;

function fakeExecFile(cmd: string, args: readonly string[] | undefined, opts: unknown, cb?: ExecFileCallback) {
  const callback = (typeof opts === 'function' ? opts : cb) as ExecFileCallback;
  let stdin: string | undefined;
  const child = {
    stdin: {
      end(data?: string) {
        stdin = data;
      },
    },
  };
  // Answered after the caller's synchronous `child.stdin.end(…)` (adapters/exec.ts), never on its stack.
  void Promise.resolve().then(() => {
    try {
      const out = answer(cmd, [...(args ?? [])], stdin);
      callback(null, Buffer.isBuffer(out) ? out : Buffer.from(out), Buffer.alloc(0));
    } catch (e) {
      const err = e as CommandError;
      callback(Object.assign(new Error(err.message), { code: err.code }), Buffer.alloc(0), Buffer.from(err.message));
    }
  });
  return child;
}

const refuse = (name: string) => () => {
  throw new Error(`differential: ${name} is not allowed — the harness runs no process`);
};

let installed = false;

/**
 * Replace the process functions — before either side is imported, so their
 * `import { execFile } from 'node:child_process'` binds the fake
 * (syncBuiltinESMExports updates the ESM view of the builtin). Idempotent.
 * DEVELOPER_DIR is set so xcode-env.ts skips its `xcrun --find` probe.
 */
export function installFakeDevice(): void {
  if (installed) return;
  installed = true;
  const cp = childProcess as unknown as Record<string, unknown>;
  cp.execFile = fakeExecFile;
  for (const name of ['spawn', 'exec', 'execSync', 'execFileSync', 'spawnSync', 'fork']) cp[name] = refuse(name);
  syncBuiltinESMExports();
  process.env.DEVELOPER_DIR = '/differential/fake/Developer';
}
