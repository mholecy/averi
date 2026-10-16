import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { WdaServer } from '../../src/adapters/wda.js';
import type { Platform, SourceKind } from '../differential/corpus.js';
import type { CatalogCell, LabState, NavigationMode } from './schema.js';

/**
 * The lab app on one device, driven with the raw tools only (simctl, idb, WDA's own `/source`; adb) — what the truth
 * capture (capture-run.ts) and the live golden (live.ts) share: launching a cell in a fresh process, reading the app's
 * state file, a raw tap, the screenshot and the raw trees. averi's verbs are not used here, so the oracle does not
 * depend on the code it judges. Units are the tree's: points on iOS, pixels on Android.
 */

const run = promisify(execFile);
/** How a lab runs a command — injectable, so the device guards are tested without a device. */
export type Exec = (file: string, args: string[]) => Promise<{ stdout: string }>;
const exec: Exec = (file, args) => run(file, args, { maxBuffer: 64 << 20 });
export const BUNDLE = 'dev.averi.lab';
export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One raw tree of the screen as it is now: a capture of the run, its file `<cell><suffix>`. */
export interface RawTree {
  source: SourceKind;
  suffix: string;
  payload: string;
}

export interface LabDevice {
  readonly platform: Platform;
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
/** The lab's AVD (`adb emu avd name`); any other emulator or device is refused. */
export const LAB_AVD = 'averi_lab';
/** The device-check simulator's WebDriverAgent ports (averi gives the first simulator 8100, the next 8101): refused. */
export const DEVICE_CHECK_WDA_PORTS: readonly number[] = [8100, 8101];

/**
 * The lab's own WebDriverAgent build: never the default `averi-wda` derived data, which device-check builds use — a
 * lab capture must not rebuild or replace theirs.
 */
export const LAB_WDA_DERIVED_DATA = join(homedir(), 'Library', 'Developer', 'Xcode', 'DerivedData', 'averi-wda-lab');

export class IosLab implements LabDevice {
  readonly platform = 'ios';
  private stateFile: string | undefined;
  private wdaServer: WdaServer | undefined;

  private guarded: Promise<string> | undefined;
  /** Set once guard() has resolved: until then close() runs nothing — a refused simulator is left as it was. */
  private cleared = false;

  /** `wdaPort`: never 8100/8101 (the device-check simulator's: refused); capture.ts and live.ts default to 8120. */
  constructor(
    readonly udid: string,
    private readonly opts: { wdaPort?: number; exec?: Exec } = {},
  ) {
    if (opts.wdaPort !== undefined && DEVICE_CHECK_WDA_PORTS.includes(opts.wdaPort)) {
      throw new Error(`WDA port ${opts.wdaPort} is the device-check simulator's (${DEVICE_CHECK_WDA_PORTS.join(', ')}): the lab runs WDA on a port of its own (8120)`);
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
      if (this.udid.toUpperCase() === DEVICE_CHECK_SIMULATOR) throw new Error(`${this.udid} is the device-check simulator — the lab runs on its own (averi-lab …) only`);
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

  unsupported(): string | undefined {
    return undefined;
  }

  async state(): Promise<LabState | undefined> {
    this.stateFile ??= join((await this.simctl('get_app_container', this.udid, BUNDLE, 'data')).stdout.trim(), 'Documents', 'lab-state.json');
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
    await this.simctl('terminate', this.udid, BUNDLE).catch(() => undefined);
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
    await this.simctl('launch', this.udid, BUNDLE, '-cell', cell);
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
    const port = this.opts.wdaPort ?? 8120;
    console.error(`WDA: port ${port}, derived data ${LAB_WDA_DERIVED_DATA}`);
    return new WdaServer({ udid: this.udid, port, derivedDataPath: LAB_WDA_DERIVED_DATA });
  }

  /** Nothing unless guard() resolved: a refused (or never checked) simulator is left as it was. */
  async close(): Promise<void> {
    if (!this.cleared) return;
    await this.wdaServer?.shutdown();
    await this.simctl('terminate', this.udid, BUNDLE).catch(() => undefined);
  }
}

// --- Android: adb ---

/**
 * The cell layers the Android app builds (Lab.kt#SUPPORTED_LAYERS; its cells routed by family,
 * MainActivity.kt#CellRouter).
 */
const ANDROID_LAYERS = new Set(['none', 'sheet-medium', 'alert']);

export class AndroidLab implements LabDevice {
  readonly platform = 'android';

  private guarded: Promise<void> | undefined;
  /** Set once guard() has resolved: until then close() runs nothing (see IosLab). */
  private cleared = false;

  /** Every adb command names the serial; nothing restarts the adb server. */
  constructor(
    readonly serial: string,
    private readonly opts: { exec?: Exec } = {},
  ) {}

  adb(...args: string[]) {
    return (this.opts.exec ?? exec)('adb', ['-s', this.serial, ...args]);
  }

  /** The emulator is the lab's AVD (`adb emu avd name` says `averi_lab`), or nothing is done to it. */
  guard(): Promise<void> {
    this.guarded ??= (async () => {
      const avd = (await this.adb('emu', 'avd', 'name').catch(() => ({ stdout: '' }))).stdout.split(/\r?\n/)[0].trim();
      if (avd !== LAB_AVD) throw new Error(`${this.serial} is ${avd === '' ? 'no emulator adb can name' : `AVD "${avd}"`}, not the lab's ${LAB_AVD}: refused`);
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
    if (!ANDROID_LAYERS.has(cell.layer)) return `layer ${cell.layer} is not one the Android app builds`;
    if (cell.form !== undefined) return 'a form cell — the Android app builds them from phase 2b on';
    return undefined;
  }

  async state(): Promise<LabState | undefined> {
    try {
      return JSON.parse((await this.adb('exec-out', 'run-as', BUNDLE, 'cat', 'files/lab-state.json')).stdout) as LabState;
    } catch {
      return undefined;
    }
  }

  /** A fresh process: `am force-stop`, the last state file removed (see IosLab.launch), `am start … --es cell <id>`. */
  async launch(cell: string): Promise<LabState> {
    await this.guard();
    await this.adb('shell', 'am', 'force-stop', BUNDLE);
    await this.adb('shell', 'run-as', BUNDLE, 'rm', '-f', 'files/lab-state.json');
    await this.adb('shell', 'am', 'start', '-W', '-n', `${BUNDLE}/.MainActivity`, '--es', 'cell', cell);
    return settled(this, cell);
  }

  async tap(x: number, y: number): Promise<void> {
    await this.adb('shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y)));
  }

  /** `settings get secure navigation_mode`: 0 three buttons, 1 two buttons, 2 gestures; anything else undefined. */
  async navigation(): Promise<NavigationMode | undefined> {
    await this.guard();
    const mode = (await this.adb('shell', 'settings', 'get', 'secure', 'navigation_mode')).stdout.trim();
    return ({ '0': 'three-button', '1': 'two-button', '2': 'gesture' } as const)[mode as '0' | '1' | '2'];
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
    await this.adb('shell', 'am', 'force-stop', BUNDLE);
  }
}
