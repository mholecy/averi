import childProcess from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { PNG } from 'pngjs';
import type { Platform, Screen } from './corpus.js';
import type { ImeCapture } from '../truth/schema.js';

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
 * other way to start a process (`spawn`, `exec`, the sync forms, `fork`) and
 * `fetch` throw, and an `execFile` of an unknown binary fails as a missing one.
 * A command of a known binary this fake does not model is answered with
 * nothing and logged as `UNMODELLED <command>` — the run counts them, so a
 * tool that starts asking something new shows up instead of reading a silent
 * empty answer.
 *
 * What it answers:
 *  - iOS: `idb describe --json` the screen in points (no screen: it fails),
 *    `idb ui describe-all --json` the recording's raw idb payload, `xcrun
 *    simctl io … screenshot <file>` the frame written to the file, every `idb
 *    ui` input accepted; `simctl launch`, `terminate`, the accessibility
 *    `defaults write`, `appinfo` (the recording's app as its display name),
 *    the app running (`launchctl list`), no log.
 *  - Android: `uiautomator dump` the recording's raw XML, `wm size` the
 *    screen (no screen: it fails), `dumpsys window displays` a captured
 *    device in tests/fixtures (API 33 Pixel_3a, keyboard hidden or shown; API
 *    36 without an IME source), the `mInputShown` witness and the touchable
 *    region (docked or floating Gboard, tests/helpers/android-dumps.ts's
 *    measurements), `screencap -p` the frame, every `input` accepted — and
 *    `input keyevent 4` (back) hides a shown keyboard, as Gboard does; the app
 *    running (`pidof`), no log. A ground-truth capture with the IME up serves
 *    the device's own three keyboard answers instead (DeviceProfile.ime).
 *  - The frame: one grey PNG, one rect of it painted (`paint`) when the
 *    caller asks — what a colour assert on that rect must sample; or, for
 *    a ground-truth capture (golden.ts), the screenshot the device showed.
 *  - `swiftc` compiles nothing (an empty file where the binary goes), and
 *    the "recognizer" reads no text in any region.
 */

/** The soft keyboard: hidden, docked (the API 33 band), or floating (Gboard's panel over a collapsed strip). */
export type KeyboardState = 'hidden' | 'shown' | 'floating';

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
  /** Android: whose `dumpsys window displays` — the API 33 Pixel_3a (default) or the API 36 device with no IME source. */
  displays?: 'api33' | 'api36';
  /** iOS: the app's display name `simctl appinfo` answers. */
  app?: string;
  /** The captured screenshot (PNG): answered as it is, in place of the grey frame — `frame` must be its size. */
  screenshot?: Buffer;
  /**
   * Android, a ground-truth capture with the IME up (scripts/truth/schema.ts#ImeCapture): the device's own answers to
   * the three keyboard queries, served in place of the stock dumps — `shown` while the keyboard is (set `keyboard:
   * 'shown'`), `hidden` once a `back` hid it.
   */
  ime?: ImeCapture;
}

/** A rect of the frame, in its pixels, painted one colour. */
export interface Paint {
  rect: { x: number; y: number; width: number; height: number };
  rgb: readonly [number, number, number];
}

interface DeviceState {
  profile: DeviceProfile;
  keyboard: KeyboardState;
  paint?: Paint;
  calls: string[];
}

let current: DeviceState | undefined;

/** Point the fake at a device for the calls that follow; the call log, the keyboard and the paint start over. */
export function useDevice(profile: DeviceProfile): void {
  if (profile.screenshot !== undefined) servedScreenshot(profile.frame, profile.screenshot);
  current = { profile, keyboard: profile.keyboard ?? 'hidden', calls: [] };
}

/** Paint `paint.rect` of every frame until the next reset (one call). */
export function paintFrame(paint: Paint): void {
  if (current !== undefined) current.paint = paint;
}

/** The device calls made since `useDevice` (or the last `resetDevice`), consecutive repeats folded as `×N`. */
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

/** A new call: an empty log, the profile's keyboard again, no paint. */
export function resetDevice(): void {
  if (current !== undefined) useDevice(current.profile);
}

// --- PNG frames, built once per size and paint ---

const frames = new Map<string, Buffer>();
/** A PNG's size, from its IHDR chunk (bytes 16–23, big-endian). */
export const pngSize = (png: Buffer): Screen => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
/**
 * A captured screenshot, checked against the profile's frame: the tools read the size from the PNG they are served, so a
 * profile whose frame says otherwise would describe one device and serve another. Asserted when the profile is set
 * (useDevice) and again when the frame is served.
 */
function servedScreenshot(screen: Screen, screenshot: Buffer): Buffer {
  const size = pngSize(screenshot);
  if (size.width !== screen.width || size.height !== screen.height) {
    throw new Error(`differential: the captured screenshot is ${size.width}x${size.height}, the profile's frame ${screen.width}x${screen.height}`);
  }
  return screenshot;
}
function frame(screen: Screen, paint: Paint | undefined, screenshot?: Buffer): Buffer {
  if (screenshot !== undefined) return servedScreenshot(screen, screenshot);
  const key = `${screen.width}x${screen.height} ${JSON.stringify(paint ?? null)}`;
  let png = frames.get(key);
  if (png === undefined) {
    const img = new PNG({ width: screen.width, height: screen.height });
    for (let i = 0; i < img.data.length; i += 4) img.data.set([0x80, 0x80, 0x80, 0xff], i);
    if (paint !== undefined) {
      const x0 = Math.max(0, Math.round(paint.rect.x)), y0 = Math.max(0, Math.round(paint.rect.y));
      const x1 = Math.min(screen.width, Math.round(paint.rect.x + paint.rect.width)), y1 = Math.min(screen.height, Math.round(paint.rect.y + paint.rect.height));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set([...paint.rgb, 0xff], (y * screen.width + x) * 4);
    }
    // 8-bit RGB (no alpha): a quarter less to inflate than RGBA, the same pixels once decoded.
    png = PNG.sync.write(img, { colorType: 2, inputColorType: 6 });
    frames.set(key, png);
  }
  return png;
}

// --- the Android device profiles ---

const FIXTURES = new URL('../../tests/fixtures/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, FIXTURES), 'utf8');
const API33 = { hidden: fixture('dumpsys-window-displays-api33-keyboard-hidden.txt'), shown: fixture('dumpsys-window-displays-api33-keyboard-shown.txt') };
/** Floating Gboard (tests/helpers/android-dumps.ts GBOARD.floating): the IME inset is only the 132-px collapse strip. */
const API33_FLOATING = API33.hidden
  .replaceAll(
    'InsetsSource type=ITYPE_IME frame=[0,0][0,0] visibleFrame=[0,2088][1080,2220] visible=false',
    'InsetsSource type=ITYPE_IME frame=[0,2088][1080,2220] visibleFrame=[0,2088][1080,2220] visible=true',
  )
  .replaceAll('mIsImeShowing=false', 'mIsImeShowing=true');
const API36 = fixture('dumpsys-window-displays-api36-no-ime-source.txt');
const inputShown = (shown: boolean) => `  mShowRequested=${shown} mShowExplicitlyRequested=false mShowForced=false mInputShown=${shown}\n`;
const TOUCHABLE: Record<KeyboardState, string> = {
  hidden: '  touchable region=SkRegion((0,2088,1080,2220))\n',
  shown: '  touchable region=SkRegion((0,1398,1080,2220))\n',
  floating: '  touchable region=SkRegion((359,1269,1040,1912)(0,2088,1080,2220))\n',
};

/** The captured IME readings for the keyboard's state now (DeviceProfile.ime), when the profile has them. */
const captured = (profile: DeviceProfile, keyboard: KeyboardState) => profile.ime?.[keyboard === 'hidden' ? 'hidden' : 'shown'];

function displays(profile: DeviceProfile, keyboard: KeyboardState): string {
  const ime = captured(profile, keyboard);
  if (ime !== undefined) return ime.displays;
  if (profile.displays === 'api36') return API36;
  return keyboard === 'hidden' ? API33.hidden : keyboard === 'shown' ? API33.shown : API33_FLOATING;
}

const appinfo = (name: string) => `{\n    CFBundleDisplayName = "${name}";\n    CFBundleIdentifier = "differential.app";\n    CFBundleName = "${name}";\n}\n`;

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
  const unmodelled = (line: string): string => {
    device.calls.push(`UNMODELLED ${line}`);
    return '';
  };
  if (cmd === 'xcrun') {
    if (args[0] === '--find') return '/fake/simctl\n';
    if (args[0] !== 'simctl') return unmodelled(`xcrun ${args.join(' ')}`);
    const [, verb, , ...rest] = args;
    if (verb === 'io' && rest[0] === 'screenshot') {
      device.calls.push('simctl screenshot');
      writeFileSync(rest[1], frame(profile.frame, device.paint, profile.screenshot));
      return '';
    }
    if (verb === 'spawn' && rest[0] === 'launchctl') return 'PID\tStatus\tLabel\n1\t0\tUIKitApplication:differential.app[1][rb-legacy]\n';
    device.calls.push(`simctl ${verb} ${rest.join(' ')}`);
    if (verb === 'spawn' && rest[0] === 'log') return '';
    if (verb === 'spawn' && rest[0] === 'defaults') return '';
    if (verb === 'launch') return `${rest[0]}: 4242\n`;
    if (verb === 'terminate') return '';
    if (verb === 'appinfo') return appinfo(profile.app ?? 'Differential');
    return unmodelled(`simctl ${verb} ${rest.join(' ')}`);
  }
  if (cmd === 'idb') {
    const argv = args.slice(0, args.indexOf('--udid') === -1 ? undefined : args.indexOf('--udid'));
    const line = argv.join(' ');
    if (line === 'describe --json') {
      device.calls.push(`idb ${line}`);
      if (profile.screen === undefined) throw new CommandError('differential: idb describe answered nothing', 1);
      return JSON.stringify({ screen_dimensions: { width_points: profile.screen.width, height_points: profile.screen.height } });
    }
    if (line === 'ui describe-all --json') {
      device.calls.push(`idb ${line}`);
      if (profile.idbPayload === undefined) throw new CommandError('differential: no idb payload recorded', 1);
      return profile.idbPayload;
    }
    if (argv[0] === 'ui' && ['tap', 'swipe', 'text', 'key', 'key-sequence', 'button'].includes(argv[1])) {
      device.calls.push(`idb ${line}`);
      return '';
    }
    return unmodelled(`idb ${line}`);
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
      return frame(profile.frame, device.paint, profile.screenshot);
    }
    if (argv[0] === 'get-state') {
      device.calls.push(`adb ${line}`);
      return 'device\n';
    }
    if (argv[0] === 'logcat') {
      device.calls.push(`adb ${line}`);
      return '';
    }
    if (argv[0] !== 'shell') return unmodelled(`adb ${line}`);
    const shell = argv.slice(1).join(' ');
    device.calls.push(`adb shell ${shell}`);
    const keyboard = device.keyboard;
    if (shell.includes('pidof')) return '4242\n';
    if (shell === 'wm size') {
      if (profile.screen === undefined) throw new CommandError('differential: wm size answered nothing', 1);
      return `Physical size: ${profile.screen.width}x${profile.screen.height}\n`;
    }
    if (shell === 'dumpsys window displays') return displays(profile, keyboard);
    if (shell.startsWith('dumpsys input_method')) {
      const ime = captured(profile, keyboard);
      if (ime !== undefined) return shell.includes('touchable region') ? ime.touchable : ime.inputShown;
      const shown = keyboard !== 'hidden';
      return shell.includes('touchable region') ? inputShown(shown) + TOUCHABLE[keyboard] : inputShown(shown);
    }
    if (argv[1] === 'input') {
      if (shell === 'input keyevent 4') device.keyboard = 'hidden';
      return '';
    }
    device.calls.pop();
    return unmodelled(`adb shell ${shell}`);
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
  throw new Error(`differential: ${name} is not allowed — the harness runs no process and opens no connection`);
};

let installed = false;

/**
 * Replace the process functions — before either side is imported, so their
 * `import { execFile } from 'node:child_process'` binds the fake
 * (syncBuiltinESMExports updates the ESM view of the builtin) — and `fetch`
 * (WdaServer's transport). Idempotent. DEVELOPER_DIR is set so xcode-env.ts
 * skips its `xcrun --find` probe.
 */
export function installFakeDevice(): void {
  if (installed) return;
  installed = true;
  const cp = childProcess as unknown as Record<string, unknown>;
  cp.execFile = fakeExecFile;
  for (const name of ['spawn', 'exec', 'execSync', 'execFileSync', 'spawnSync', 'fork']) cp[name] = refuse(name);
  syncBuiltinESMExports();
  globalThis.fetch = refuse('fetch') as unknown as typeof fetch;
  process.env.DEVELOPER_DIR = '/differential/fake/Developer';
}
