import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { INPUT_SHOWN_COMMAND, TOUCHABLE_COMMAND } from '../../src/adapters/android-wm.js';
import type { Point } from '../../src/adapters/types.js';
import { WdaServer } from '../../src/adapters/wda.js';
import type { Platform, SourceKind } from '../differential/corpus.js';
import { appOf, type CatalogCell, type ImeCapture, type ImeWitness, type LabApp, type LabState, type NavigationMode, WINDOW_MANAGER_WORD } from './schema.js';

/**
 * A lab app on one device — the native one (SwiftUI, Compose) or the React Native one (LAB_APP), each device object
 * bound to one — driven with the raw tools only (simctl, idb, WDA's own `/source`; adb) — what the truth
 * capture (capture-run.ts) and the live golden (live.ts) share: launching a cell in a fresh process, reading the app's
 * state file, a raw tap, the screenshot and the raw trees. averi's verbs are not used here, so the oracle does not
 * depend on the code it judges. Units are the tree's: points on iOS, pixels on Android.
 */

const run = promisify(execFile);
/** How a lab runs a command — injectable, so the device guards are tested without a device. */
export type Exec = (file: string, args: string[]) => Promise<{ stdout: string }>;
const exec: Exec = (file, args) => run(file, args, { maxBuffer: 64 << 20 });
/**
 * What the harness knows of a lab app (schema.ts#LabApp): its name — a truth run's manifest `app`, which tells one app's
 * runs from the other's on the same device — its iOS bundle identifier, its Android package (the same string: each
 * platform's code says which one it means), and where its source lies per platform.
 */
export interface LabAppIdentity {
  name: string;
  bundle: string;
  package: string;
  source: Record<Platform, string>;
  /**
   * The cell layers its Android build builds, or `any`: the native app's are Lab.kt#SUPPORTED_LAYERS (its cells routed
   * by family, MainActivity.kt#CellRouter; a layer only the iOS app has yet is refused); the React Native app builds
   * its family whatever the layer (App.tsx).
   */
  androidLayers: ReadonlySet<string> | 'any';
}

export const LAB_APP: Record<LabApp, LabAppIdentity> = {
  native: {
    name: 'AveriLab',
    bundle: 'dev.averi.lab',
    package: 'dev.averi.lab',
    source: { ios: 'fixtures/apps/ios', android: 'fixtures/apps/android' },
    androidLayers: new Set(['none', 'sheet-medium', 'alert', 'dialog-fullscreen', 'bottom-sheet-dialog', 'dialog-views-fullscreen']),
  },
  'react-native': { name: 'AveriLabRN', bundle: 'dev.averi.lab.rn', package: 'dev.averi.lab.rn', source: { ios: 'fixtures/apps/rn', android: 'fixtures/apps/rn' }, androidLayers: 'any' },
};

/** Why `app` does not build `cell` (another app's family: schema.ts#appOf), or undefined when it does. */
export function otherApp(cell: Pick<CatalogCell, 'family'>, app: LabApp): string | undefined {
  const builder = appOf(cell.family);
  return builder === app ? undefined : `a cell of the ${builder} lab app (${LAB_APP[builder].name}), not of ${LAB_APP[app].name}`;
}
/** The harness's one wait: the lab drivers', run-case.ts's, and the capture's probe (capture-run.ts#probe). */
export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One raw tree of the screen as it is now: a capture of the run, its file `<cell><suffix>`. */
export interface RawTree {
  source: SourceKind;
  suffix: string;
  payload: string;
}

export interface LabDevice {
  readonly platform: Platform;
  /** The lab app it drives (LAB_APP): one per device object, its cells only. */
  readonly app: LabApp;
  /** The manifest's `device`: model and OS, as the device reports them. */
  describe(): Promise<string>;
  /** Why this app cannot build `cell`, or undefined when it can. */
  unsupported(cell: CatalogCell): string | undefined;
  /** Launch `cell` in a fresh process and wait until the app says it has settled. */
  launch(cell: string): Promise<LabState>;
  /** What the app last wrote; undefined while there is no (readable) file. */
  state(): Promise<LabState | undefined>;
  /** A raw tap at a point, in the tree's units. */
  tap(x: number, y: number): Promise<void>;
  /** The screen as a PNG. */
  screenshot(): Promise<Buffer>;
  /** Every raw tree source of the platform, read now. */
  trees(): Promise<RawTree[]>;
  /** Stop what the device holds for the lab (WDA, the app). */
  close(): Promise<void>;
  /**
   * Android: the navigation mode (CellTruth.navigation), undefined when the device does not say. Absent on iOS.
   */
  navigation?(): Promise<NavigationMode | undefined>;
  /**
   * Android, with the IME up: what averi's keyboard queries answer now, then after one `back` hid it — all but the
   * IME-down `dumpsys window displays`, which `displays` reads (schema.ts#ImeCapture). Leaves the keyboard hidden.
   * Absent on iOS (its keyboard is in the tree).
   */
  ime?(): Promise<ImeCapture>;
  /**
   * Android: averi's touchable query (src/adapters/android-wm.ts#TOUCHABLE_COMMAND) now, raw — the IME window's
   * touchable region beside `mInputShown`, read at a kf case's launch and again once its calls are done (run-case.ts,
   * withMeasuredPanel; LabState.imeTouchable, D69). Leaves the keyboard up. Absent on iOS.
   */
  imeTouchable?(): Promise<string>;
  /**
   * Android: `dumpsys window displays` now — the dump averi's Android adapter reads its system bands from (the status
   * bar's height, the navigation bar's top: src/adapters/android.ts#systemBands) and its keyboard. Absent on iOS.
   */
  displays?(): Promise<string>;
  /**
   * Android: the window manager's word on the window that has focus now — what averi's Android adapter asks on a miss
   * (src/adapters/android.ts#focusedWindow, its FOCUSED_WINDOW_COMMAND, the same line: `WINDOW_MANAGER_WORD`), read
   * right after the trees so it is the dumped window's. Absent on iOS.
   */
  windows?(): Promise<string>;
  /**
   * Android: hide the IME as averi's tap guard does (one `input keyevent 4`, src/mcp/tools.ts tap: "the keyboard is
   * hidden (back) and the element found again first") and give it time to go. Absent on iOS.
   */
  hideKeyboard?(): Promise<void>;
}

/** Wait for a fresh launch's state: the cell named, ready (10 s at most), then 300 ms for the last write to land. */
async function settled(lab: Pick<LabDevice, 'state'>, cell: string): Promise<LabState> {
  for (let waited = 0; waited < 10_000; waited += 200) {
    await pause(200);
    const s = await lab.state();
    if (s?.cell === cell && s.ready) {
      await pause(300);
      return (await lab.state())!;
    }
  }
  throw new Error(`cell ${cell}: the app did not report ready within 10 s`);
}

// --- iOS: simctl, idb, WDA ---

/** The lab simulator's name starts so (`averi-lab iPhone 17`); any other simulator is refused. */
export const LAB_SIMULATOR_PREFIX = 'averi-lab ';
/** The device-check simulator: refused whatever it is named (its settings and WDA are device-check's). */
export const DEVICE_CHECK_SIMULATOR = '37956039-94EA-4F51-93E5-94F7723A4578';
/** Whether `udid` is the device-check simulator, whatever its case: every lab guard and pattern refuses it. */
export const isDeviceCheckSimulator = (udid: string): boolean => udid.toUpperCase() === DEVICE_CHECK_SIMULATOR;
/** The lab's AVD (`adb emu avd name`); any other emulator or device is refused. */
export const LAB_AVD = 'averi_lab';
/**
 * The native lab app's APK as the checkout builds it (batch-11.sh:48; batch/lab-build.ts builds it there): what a
 * hand line installs when no APK was pulled from the device (chooser-premise.ts, T20a).
 */
export const APK_PATH = 'fixtures/apps/android/build/outputs/apk/debug/AveriLab-debug.apk';
/** The device-check simulator's WebDriverAgent ports (averi gives the first simulator 8100, the next 8101): refused. */
export const DEVICE_CHECK_WDA_PORTS: readonly number[] = [8100, 8101];

/**
 * The lab's own WebDriverAgent build: never the default `averi-wda` derived data, which device-check builds use — a
 * lab capture must not rebuild or replace theirs.
 */
/** The lab's WebDriverAgent port: never device-check's 8100/8101. capture.ts, live.ts, baseline.ts and a41-probe.ts use it. */
export const LAB_WDA_PORT = 8120;

export const LAB_WDA_DERIVED_DATA = join(homedir(), 'Library', 'Developer', 'Xcode', 'DerivedData', 'averi-wda-lab');

export class IosLab implements LabDevice {
  readonly platform = 'ios';
  readonly app: LabApp;
  private readonly bundle: string;
  private stateFile: string | undefined;
  private wdaServer: WdaServer | undefined;

  private guarded: Promise<string> | undefined;
  /** Set once guard() has resolved: until then close() runs nothing — a refused simulator is left as it was. */
  private cleared = false;

  /**
   * `wdaPort`: never 8100/8101 (the device-check simulator's: refused); capture.ts and live.ts default to 8120. `app`:
   * the lab app it drives, the native one unless said.
   */
  constructor(
    readonly udid: string,
    private readonly opts: { wdaPort?: number; exec?: Exec; app?: LabApp } = {},
  ) {
    this.app = opts.app ?? 'native';
    this.bundle = LAB_APP[this.app].bundle;
    if (opts.wdaPort !== undefined && DEVICE_CHECK_WDA_PORTS.includes(opts.wdaPort)) {
      throw new Error(`WDA port ${opts.wdaPort} is the device-check simulator's (${DEVICE_CHECK_WDA_PORTS.join(', ')}): the lab runs WDA on a port of its own (${LAB_WDA_PORT})`);
    }
  }

  simctl(...args: string[]) {
    return (this.opts.exec ?? exec)('xcrun', ['simctl', ...args]);
  }

  idb(...args: string[]) {
    return (this.opts.exec ?? exec)('idb', [...args, '--udid', this.udid]);
  }

  /**
   * The simulator is the lab's, or nothing is done to it (launch writes its accessibility and keyboard defaults): its
   * udid listed by `simctl list devices -j` under a name starting `averi-lab `, and never the device-check simulator.
   * Resolves to its description — name and runtime as simctl reports them (`averi-lab iPhone 17 simulator, iOS 27.0`).
   */
  guard(): Promise<string> {
    this.guarded ??= (async () => {
      if (isDeviceCheckSimulator(this.udid)) throw new Error(`${this.udid} is the device-check simulator — the lab runs on its own (averi-lab …) only`);
      const { devices } = JSON.parse((await this.simctl('list', 'devices', '-j')).stdout) as { devices: Record<string, { udid: string; name: string }[]> };
      for (const [runtime, list] of Object.entries(devices)) {
        const d = list.find((x) => x.udid === this.udid);
        if (d === undefined) continue;
        if (!d.name.startsWith(LAB_SIMULATOR_PREFIX)) throw new Error(`simulator ${this.udid} is "${d.name}", not the lab's (${LAB_SIMULATOR_PREFIX}…): refused`);
        const os = /SimRuntime\.(\w+)-(\d+)-(\d+)$/.exec(runtime);
        this.cleared = true;
        return `${d.name} simulator, ${os === null ? runtime : `${os[1]} ${os[2]}.${os[3]}`}`;
      }
      throw new Error(`no simulator ${this.udid} in simctl's list: refused`);
    })();
    return this.guarded;
  }

  describe(): Promise<string> {
    return this.guard();
  }

  unsupported(cell: CatalogCell): string | undefined {
    return otherApp(cell, this.app);
  }

  async state(): Promise<LabState | undefined> {
    this.stateFile ??= join((await this.simctl('get_app_container', this.udid, this.bundle, 'data')).stdout.trim(), 'Documents', 'lab-state.json');
    try {
      return JSON.parse(await readFile(this.stateFile, 'utf8')) as LabState;
    } catch {
      return undefined;
    }
  }

  /**
   * The last process's state file is removed first: it names the same cell, ready, and would be read as this one's
   * before the new process has drawn anything.
   */
  async launch(cell: string): Promise<LabState> {
    await this.guard();
    await this.simctl('terminate', this.udid, this.bundle).catch(() => undefined);
    // As averi's own launch does (src/adapters/ios.ts#enableAccessibilityAutomation): after a WebDriverAgent session
    // on the simulator, an app launched without these reads as an empty idb tree (docs/bugs/2026-10-07-one-wda-session-
    // makes-idb-stick-until-reboot.md) — the capture's WDA would leave every later launch stuck for idb.
    for (const key of ['AutomationEnabled', 'ApplicationAccessibilityEnabled']) {
      await this.simctl('spawn', this.udid, 'defaults', 'write', 'com.apple.Accessibility', key, '-bool', 'true');
    }
    // The soft keyboard back: once the simulator has seen HID typing (idb ui text) it sets these two (THIS simulator's
    // own com.apple.keyboard.preferences — no host or Simulator.app setting) and shows no soft keyboard for a focused
    // field, reboot or not; written back off, the next launch shows it again (measured 2026-10-15, iOS 27.0).
    for (const key of ['AutomaticMinimizationEnabled', 'HardwareKeyboardLastSeen']) {
      await this.simctl('spawn', this.udid, 'defaults', 'write', 'com.apple.keyboard.preferences', key, '-bool', 'false');
    }
    await this.state();
    await rm(this.stateFile!, { force: true });
    await this.simctl('launch', this.udid, this.bundle, '-cell', cell);
    return settled(this, cell);
  }

  async tap(x: number, y: number): Promise<void> {
    await this.idb('ui', 'tap', String(Math.round(x)), String(Math.round(y)));
  }

  async screenshot(): Promise<Buffer> {
    const file = join(process.env.TMPDIR ?? '/tmp', `averi-lab-${this.udid}-${process.pid}.png`);
    await this.simctl('io', this.udid, 'screenshot', file);
    try {
      return await readFile(file);
    } finally {
      await rm(file, { force: true });
    }
  }

  /** WDA's raw `/source?format=json` body and idb's raw `ui describe-all --json` list. */
  async trees(): Promise<RawTree[]> {
    this.wdaServer ??= this.wda();
    const source = await this.wdaServer.source();
    // idb's first read on a freshly booted simulator can fail ("No translation object returned"): one retry.
    const idb = (await this.idb('ui', 'describe-all', '--json').catch(async () => (await pause(2_000), this.idb('ui', 'describe-all', '--json')))).stdout;
    return [
      { source: 'wda', suffix: '.wda.json', payload: JSON.stringify(source, null, 1) + '\n' },
      { source: 'idb', suffix: '.idb.json', payload: idb },
    ];
  }

  private wda(): WdaServer {
    const port = this.opts.wdaPort ?? LAB_WDA_PORT;
    console.error(`WDA: port ${port}, derived data ${LAB_WDA_DERIVED_DATA}`);
    return new WdaServer({ udid: this.udid, port, derivedDataPath: LAB_WDA_DERIVED_DATA });
  }

  /** Nothing unless guard() resolved: a refused (or never checked) simulator is left as it was. */
  async close(): Promise<void> {
    if (!this.cleared) return;
    await this.wdaServer?.shutdown();
    await this.simctl('terminate', this.udid, this.bundle).catch(() => undefined);
  }
}

// --- Android: adb ---

/**
 * The kf cases' device read (run-case.ts; LabState.imeTouchable): the state with what averi's touchable query answered —
 * right after the launch, and again once the calls are done (D69). A device the guard refuses rethrows — the run stops,
 * as any other call there would; a read that fails past the guard is said on stderr (`log`) and kept as `{ error }`,
 * which live-forms.ts#measuredPanel reads as "no measured panel (the IME region read failed)".
 */
export async function withMeasuredPanel(
  launched: LabState,
  lab: { guard(): Promise<unknown>; imeTouchable(): Promise<string> },
  log: (line: string) => void = console.error,
): Promise<LabState> {
  await lab.guard();
  try {
    return { ...launched, imeTouchable: await lab.imeTouchable() };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log(`the IME region read failed: ${error}`);
    return { ...launched, imeTouchable: { error } };
  }
}

/**
 * One focus read as the device printed it (AndroidLab.focus; the chooser group's, live-chooser.ts): the two greps, the
 * window the last one read; `settle` when it waited for the window transition (`windowInTransition`) — how long, and the
 * first window read, what the device showed when averi had replied; or the error that stopped it. Review round 1's
 * records keep `waitedMs` and `firstWindow` at the top instead (live-chooser.ts#frontOf reads both).
 */
export type FocusRead = { window: string; activities: string; settle?: { waitedMs: number; firstWindow: string } } | { error: string };

/** A window read taken mid-transition: no window has the focus yet (`mCurrentFocus=null`). */
export const windowInTransition = (window: string): boolean => /mCurrentFocus=null\b/.test(window);

/** The HOME activity as `cmd package resolve-activity --brief` prints it (HOME_COMMAND), raw, or the error that stopped it. */
export type HomeRead = { resolved: string } | { error: string };

/**
 * The chooser group's focus read (live-chooser.ts, T7b), the harness's own, beside src's (android-wm.ts
 * #CHOOSER_FOCUS_COMMAND) and not imported from it, so the oracle does not share the code it judges: the window
 * manager's focus lines, and every activity record on the stack (`* Hist  #<n>: ActivityRecord{…}`, top first).
 */
export const FOCUS_WINDOW_COMMAND = "dumpsys window displays | grep -E 'mCurrentFocus=|mFocusedApp='";
export const ACTIVITIES_COMMAND = "dumpsys activity activities | grep -E 'Hist +#'";
/** The HOME activity the device resolves (read-only): the launcher a start from it must find in front. */
export const HOME_COMMAND = 'cmd package resolve-activity --brief -c android.intent.category.HOME -a android.intent.action.MAIN';
/** How long a key (HOME, BACK) is given to take effect before the next read. */
const KEY_SETTLE_MS = 1_000;
/**
 * A focus read taken mid-transition (`mCurrentFocus=null`) is taken again every FOCUS_POLL_MS, FOCUS_SETTLE_MS at most
 * (the last poll shortened to end there): the stack is read once a window has focus. Measured 2026-11-09 (T7b's first run, emulator-5554, API 33): after monkey
 * started the force-stopped lab over the chooser, `mCurrentFocus` read null and the ResolverActivity record stayed on the
 * stack for about 1.3 s, both gone together.
 */
const FOCUS_POLL_MS = 300;
const FOCUS_SETTLE_MS = 5_000;

/** A text's first non-blank line, trimmed ('' for none): the guard's AVD name and adb's words alike. */
const firstSaid = (text: string): string => text.split(/\r?\n/).find((l) => l.trim() !== '')?.trim() ?? '';

/**
 * What adb said when a call of it failed: its stderr's first line (execFile's error, and bounded.ts#execOf's, carry
 * it), else the error's own first line (adb not started).
 */
export function adbSaid(e: unknown): string {
  const stderr = typeof e === 'object' && e !== null && 'stderr' in e && typeof e.stderr === 'string' ? firstSaid(e.stderr) : '';
  return stderr !== '' ? stderr : firstSaid(e instanceof Error ? e.message : String(e));
}

export class AndroidLab implements LabDevice {
  readonly platform = 'android';
  readonly app: LabApp;
  private readonly package: string;

  private guarded: Promise<void> | undefined;
  /** Set once guard() has resolved: until then close() runs nothing (see IosLab). */
  private cleared = false;

  /** Every adb command names the serial; nothing restarts the adb server. `app`: as IosLab's. */
  constructor(
    readonly serial: string,
    private readonly opts: { exec?: Exec; app?: LabApp } = {},
  ) {
    this.app = opts.app ?? 'native';
    this.package = LAB_APP[this.app].package;
  }

  adb(...args: string[]) {
    return (this.opts.exec ?? exec)('adb', ['-s', this.serial, ...args]);
  }

  /**
   * The emulator is the lab's AVD (`adb emu avd name` says `averi_lab`), or nothing is done to it. A read that fails
   * keeps adb's own words in the refusal (batch-13: an emulator that is down reads as itself, "device '…' not found").
   */
  guard(): Promise<void> {
    this.guarded ??= (async () => {
      const { stdout, said } = await this.adb('emu', 'avd', 'name').then(
        (r) => ({ stdout: r.stdout, said: '' }),
        (e: unknown) => ({ stdout: '', said: adbSaid(e) }),
      );
      const avd = firstSaid(stdout);
      const none = `no emulator adb can name${said === '' ? '' : ` (adb: ${said})`}`;
      if (avd !== LAB_AVD) throw new Error(`${this.serial} is ${avd === '' ? none : `AVD "${avd}"`}, not the lab's ${LAB_AVD}: refused`);
      this.cleared = true;
    })();
    return this.guarded;
  }

  async describe(): Promise<string> {
    await this.guard();
    const sdk = (await this.adb('shell', 'getprop', 'ro.build.version.sdk')).stdout.trim();
    const release = (await this.adb('shell', 'getprop', 'ro.build.version.release')).stdout.trim();
    return `${LAB_AVD} emulator, Android ${release} (API ${sdk})`;
  }

  unsupported(cell: CatalogCell): string | undefined {
    const other = otherApp(cell, this.app);
    if (other !== undefined) return other;
    const layers = LAB_APP[this.app].androidLayers;
    if (layers === 'any') return undefined;
    // A form cell builds its own picker sheet (Forms.kt): its `sheet-large` is the form's, not a presented layer's.
    if (cell.form !== undefined && cell.layer === 'sheet-large') return undefined;
    if (!layers.has(cell.layer)) return `layer ${cell.layer} is not one the Android app builds`;
    return undefined;
  }

  async state(): Promise<LabState | undefined> {
    try {
      return JSON.parse((await this.adb('exec-out', 'run-as', this.package, 'cat', 'files/lab-state.json')).stdout) as LabState;
    } catch {
      return undefined;
    }
  }

  /** A fresh process: `am force-stop`, the last state file removed (see IosLab.launch), `am start … --es cell <id>`. */
  async launch(cell: string): Promise<LabState> {
    await this.guard();
    await this.adb('shell', 'am', 'force-stop', this.package);
    await this.adb('shell', 'run-as', this.package, 'rm', '-f', 'files/lab-state.json');
    await this.adb('shell', 'am', 'start', '-W', '-n', `${this.package}/.MainActivity`, '--es', 'cell', cell);
    return settled(this, cell);
  }

  async tap(x: number, y: number): Promise<void> {
    await this.adb('shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y)));
  }

  /**
   * The device's word on what is in front and on the stack (FOCUS_WINDOW_COMMAND, ACTIVITIES_COMMAND), raw, after the
   * guard, once settled: a window read mid-transition is taken again (FOCUS_SETTLE_MS), and the wait kept (`settle`:
   * `waitedMs`, and the first window read, `firstWindow`, what the device showed when averi had replied). A read that
   * fails is kept as adb's words (`{ error }`): the judge reads it as unread, never as nothing in front.
   */
  async focus(): Promise<FocusRead> {
    await this.guard();
    try {
      const windowRead = async () => (await this.adb('shell', FOCUS_WINDOW_COMMAND)).stdout;
      const firstWindow = await windowRead();
      let window = firstWindow;
      let waitedMs = 0;
      while (windowInTransition(window) && waitedMs < FOCUS_SETTLE_MS) {
        const step = Math.min(FOCUS_POLL_MS, FOCUS_SETTLE_MS - waitedMs);
        await pause(step);
        waitedMs += step;
        window = await windowRead();
      }
      const activities = (await this.adb('shell', ACTIVITIES_COMMAND)).stdout;
      return { window, activities, ...(waitedMs > 0 && { settle: { waitedMs, firstWindow } }) };
    } catch (e) {
      return { error: adbSaid(e) };
    }
  }

  /**
   * The chooser group's launcher start (Case.fromLauncher): the lab force-stopped, HOME, a second to settle; then the
   * HOME activity the device resolves (HOME_COMMAND, read-only), raw, for the judge's premise — a read that fails kept as
   * adb's words.
   */
  async toLauncher(): Promise<HomeRead> {
    await this.guard();
    await this.adb('shell', 'am', 'force-stop', this.package);
    await this.adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
    await pause(KEY_SETTLE_MS);
    try {
      return { resolved: (await this.adb('shell', HOME_COMMAND)).stdout };
    } catch (e) {
      return { error: adbSaid(e) };
    }
  }

  /** One BACK, a second to settle: the chooser group's teardown of a chooser left in front (batch-9: one dismissed it). */
  async back(): Promise<void> {
    await this.guard();
    await this.adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await pause(KEY_SETTLE_MS);
  }

  /**
   * A raw stroke, in px: one `input swipe x1 y1 x2 y2 ms`, after the guard — the carousel group's pre-drag
   * (live-carousel.ts#preDrag), drawn without averi.
   */
  async swipe(from: Point, to: Point, durationMs: number): Promise<void> {
    await this.guard();
    await this.adb('shell', 'input', 'swipe', ...[from.x, from.y, to.x, to.y, durationMs].map((n) => String(Math.round(n))));
  }

  /** `settings get secure navigation_mode`: 0 three buttons, 1 two buttons, 2 gestures; anything else undefined. */
  async navigation(): Promise<NavigationMode | undefined> {
    await this.guard();
    const mode = (await this.adb('shell', 'settings', 'get', 'secure', 'navigation_mode')).stdout.trim();
    return ({ '0': 'three-button', '1': 'two-button', '2': 'gesture' } as const)[mode as '0' | '1' | '2'];
  }

  /**
   * averi's own queries, imported (src/adapters/android-wm.ts#INPUT_SHOWN_COMMAND, #TOUCHABLE_COMMAND): the capture
   * asks the device what averi asks it, shown and again after a back hid the keyboard.
   */
  async ime(): Promise<ImeCapture> {
    await this.guard();
    const witness = async (): Promise<ImeWitness> => ({
      inputShown: (await this.adb('shell', INPUT_SHOWN_COMMAND).catch(() => ({ stdout: '' }))).stdout,
      touchable: (await this.adb('shell', TOUCHABLE_COMMAND)).stdout,
    });
    const shown = { displays: (await this.adb('shell', 'dumpsys', 'window', 'displays')).stdout, ...(await witness()) };
    await this.hideKeyboard();
    return { shown, hidden: await witness() };
  }

  async imeTouchable(): Promise<string> {
    await this.guard();
    return (await this.adb('shell', TOUCHABLE_COMMAND)).stdout;
  }

  async displays(): Promise<string> {
    await this.guard();
    return (await this.adb('shell', 'dumpsys', 'window', 'displays')).stdout;
  }

  async windows(): Promise<string> {
    await this.guard();
    return (await this.adb('shell', WINDOW_MANAGER_WORD)).stdout;
  }

  async hideKeyboard(): Promise<void> {
    await this.adb('shell', 'input', 'keyevent', '4');
    await pause(1_500);
  }

  async screenshot(): Promise<Buffer> {
    return (await run('adb', ['-s', this.serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20, encoding: 'buffer' })).stdout;
  }

  /** The raw `uiautomator dump /dev/tty` output, status line and all — what averi's adapter reads. */
  async trees(): Promise<RawTree[]> {
    return [{ source: 'uiautomator', suffix: '.xml', payload: (await this.adb('exec-out', 'uiautomator', 'dump', '/dev/tty')).stdout }];
  }

  /** Nothing unless guard() resolved: a refused (or never checked) device is left as it was. */
  async close(): Promise<void> {
    if (!this.cleared) return;
    await this.adb('shell', 'am', 'force-stop', this.package);
  }
}
