import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec as defaultExec, type ExecFn } from './exec.js';
import { detectXcodeEnv } from './xcode-env.js';
import { runIdb } from './idb.js';
import type { IosTreeSource } from './ios-tree-source.js';
import type { Device, DeviceAdapter, Key, KeyboardWitness, LaunchOptions, SoftKeyboard, UiNode } from './types.js';

/**
 * iOS adapter: `xcrun simctl` for lifecycle/screenshots, `idb` for input, and
 * an injected IosTreeSource for the accessibility tree (ios-tree-source.ts —
 * idb's describe-all or WebDriverAgent's /source, chosen by the registry from
 * averi.yaml). Everything idb-specific for INPUT stays in the `idb*` methods;
 * the tree read belongs to the source, so swapping the tree backend touches
 * no line of this class (ARCHITECTURE.md §3, §10). Until 2026-10-02 the
 * adapter dispatched on a `treeSource` flag and owned the WdaServer itself.
 */
export class IosAdapter implements DeviceAdapter {
  readonly platform = 'ios' as const;
  private readonly exec: ExecFn;
  private readonly udid: string | undefined;
  private readonly treeSource: IosTreeSource | undefined;

  constructor(
    opts: {
      udid?: string;
      exec?: ExecFn;
      /**
       * Where uiTree() reads from. Absent on an UNBOUND adapter: the registry
       * constructs one per platform to probe listDevices(), and a probe never
       * reads a tree. A bound adapter always gets one — both sources need the
       * concrete UDID (idb rejects simctl's `booted` alias, WDA builds
       * `-destination id=`), and the registry is the one caller that has it,
       * which is why the source is injected here and not defaulted.
       */
      treeSource?: IosTreeSource;
    } = {},
  ) {
    this.udid = opts.udid;
    this.exec = opts.exec ?? defaultExec;
    this.treeSource = opts.treeSource;
  }

  private target(): string {
    return this.udid ?? 'booted';
  }

  /** DEVELOPER_DIR probe shared with WdaServer — see xcode-env.ts. */
  private detectEnv(): Promise<Record<string, string> | undefined> {
    return detectXcodeEnv(this.exec);
  }

  private async simctl(args: string[], timeoutMs?: number) {
    const env = await this.detectEnv();
    return this.exec('xcrun', ['simctl', ...args], { env, ...(timeoutMs ? { timeoutMs } : {}) });
  }

  // --- idb boundary (input only — the tree read is the source's) ---

  /**
   * idb rejects simctl's `booted` alias — it wants a concrete UDID. Resolve
   * it once via `simctl list` when no explicit udid was given.
   */
  private bootedUdidPromise: Promise<string> | undefined;

  private resolveTarget(): Promise<string> {
    if (this.udid) return Promise.resolve(this.udid);
    this.bootedUdidPromise ??= (async () => {
      const devices = await this.listDevices();
      const booted = devices.find((d) => d.state === 'booted');
      if (!booted) throw new Error('No booted simulator — boot one with `xcrun simctl boot <name>`');
      return booted.id;
    })();
    return this.bootedUdidPromise;
  }

  private async idb(args: string[], timeoutMs?: number) {
    return runIdb(this.exec, await this.resolveTarget(), args, { timeoutMs });
  }

  private idbUi(args: string[]) {
    return this.idb(['ui', ...args]);
  }

  // `settle` (DeviceAdapter.uiTree) is accepted and ignored here on purpose:
  // neither idb nor WDA has uiautomator's "no window yet" transient — a
  // launching app simply appears in the next read.
  uiTree(): Promise<UiNode> {
    if (!this.treeSource) {
      return Promise.reject(
        new Error(
          'This IosAdapter has no tree source — it was created unbound, for device probing only; ' +
            'read trees through an adapter the registry bound to a simulator',
        ),
      );
    }
    return this.treeSource.read();
  }

  /**
   * The adapter's hop of the disposal chain (lifecycle → registry → adapter →
   * tree source → WdaServer). Returned, not fire-and-forget: the process
   * shutdown awaits it, and the WDA source's shutdown is the part that takes
   * time (it polls until the port is quiet) —
   * docs/bugs/2026-09-18-wda-orphan-after-server-restart.md. Idempotency is
   * the source's contract (an idb source has nothing to release; the WDA
   * source's WdaServer.shutdown() is terminal and a second call is a no-op).
   */
  dispose(): Promise<void> {
    return this.treeSource?.dispose() ?? Promise.resolve();
  }

  // --- simctl-backed lifecycle ---

  async listDevices(): Promise<Device[]> {
    const { stdout } = await this.simctl(['list', 'devices', '--json']);
    const parsed = JSON.parse(stdout.toString('utf8')) as {
      devices: Record<string, { udid: string; name: string; state: string; isAvailable: boolean }[]>;
    };
    const devices: Device[] = [];
    for (const [runtime, list] of Object.entries(parsed.devices)) {
      // "com.apple.CoreSimulator.SimRuntime.iOS-17-5" → "17.5"
      const osVersion = runtime.match(/iOS-([\d-]+)/)?.[1]?.replace(/-/g, '.') ?? 'unknown';
      for (const d of list) {
        if (!d.isAvailable) continue;
        devices.push({
          id: d.udid,
          platform: 'ios',
          name: d.name,
          osVersion,
          state: d.state === 'Booted' ? 'booted' : 'offline',
        });
      }
    }
    return devices;
  }

  async install(appPath: string): Promise<void> {
    await this.simctl(['install', this.target(), appPath], 120_000);
  }

  async launch(bundleId: string, opts: LaunchOptions = {}): Promise<void> {
    if (opts.activity !== undefined || opts.intent !== undefined) {
      throw new Error(
        'activity/intent launch is Android-only (iOS apps have a single entry point) — ' +
          'use open_deep_link, or wrap the step in an `android:` platform override',
      );
    }
    if (opts.clearState) await this.clearAppData(bundleId);
    await this.simctl(['launch', this.target(), bundleId]);
  }

  async terminate(bundleId: string): Promise<void> {
    // simctl terminate fails if the app is not running — that's fine.
    await this.simctl(['terminate', this.target(), bundleId]).catch(() => undefined);
  }

  async openDeepLink(url: string): Promise<void> {
    await this.simctl(['openurl', this.target(), url]);
  }

  async screenshot(): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), 'averi-'));
    const file = join(dir, 'screen.png');
    try {
      await this.simctl(['io', this.target(), 'screenshot', file]);
      return await readFile(file);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // --- input (idb) ---

  async tap(x: number, y: number): Promise<void> {
    await this.idbUi(['tap', String(x), String(y)]);
  }

  private viewportPromise: Promise<{ width: number; height: number }> | undefined;

  /** Screen size in POINTS — the units idb AX frames use. */
  viewport(): Promise<{ width: number; height: number }> {
    this.viewportPromise ??= (async () => {
      const { stdout } = await this.idb(['describe', '--json']);
      const parsed = JSON.parse(stdout.toString('utf8')) as {
        screen_dimensions?: { width_points?: number; height_points?: number };
      };
      const dims = parsed.screen_dimensions;
      if (!dims?.width_points || !dims.height_points) {
        throw new Error('idb describe returned no screen_dimensions.{width,height}_points');
      }
      return { width: dims.width_points, height: dims.height_points };
    })();
    return this.viewportPromise;
  }

  async longPress(x: number, y: number, durationMs = 800): Promise<void> {
    await this.idbUi(['tap', String(x), String(y), '--duration', String(durationMs / 1000)]);
  }

  async swipe(
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs = 300,
  ): Promise<void> {
    await this.idbUi(['swipe',
      String(from.x), String(from.y), String(to.x), String(to.y),
      '--duration', String(durationMs / 1000)]);
  }

  async typeText(text: string): Promise<void> {
    await this.idbUi(['text', text]);
  }

  async clearText(count: number): Promise<void> {
    if (count <= 0) return;
    // HID 42 = Backspace, HID 76 = Forward Delete — both verified against the
    // simulator 2026-08-05. Together they clear regardless of cursor position.
    await this.idbUi(['key-sequence', ...Array(count).fill('42')]);
    await this.idbUi(['key-sequence', ...Array(count).fill('76')]);
  }

  async pressKey(key: Key): Promise<void> {
    if (key === 'back') throw new Error('pressKey("back") has no iOS equivalent — use a back button selector or swipe');
    if (key === 'home') await this.idbUi(['button', 'HOME']);
    else await this.idbUi(['key', '40']); // HID usage 40 = Return/Enter
  }

  /**
   * Always `unknown`, and no process is run (2026-10-03): the iOS keyboard is
   * part of the accessibility tree, so "which rect does it cover" is a tree
   * question nobody has needed answered yet. See DeviceAdapter.softKeyboard.
   */
  async softKeyboard(): Promise<SoftKeyboard> {
    return { state: 'unknown' };
  }

  /** Always `unknown`, and no process is run — as softKeyboard above (2026-10-04). */
  async softKeyboardWitness(): Promise<KeyboardWitness> {
    return 'unknown';
  }

  async setClipboard(text: string): Promise<void> {
    const env = await this.detectEnv();
    await this.exec('xcrun', ['simctl', 'pbcopy', this.target()], { stdin: text, env });
  }

  async isAppRunning(bundleId: string): Promise<boolean> {
    const { stdout } = await this.simctl(['spawn', this.target(), 'launchctl', 'list']);
    return stdout.toString('utf8').includes(`UIKitApplication:${bundleId}`);
  }

  async logs(sinceMs: number): Promise<string[]> {
    const start = formatLogDate(new Date(sinceMs));
    const { stdout } = await this.simctl(
      ['spawn', this.target(), 'log', 'show', '--style', 'compact', '--start', start],
      60_000,
    );
    return stdout.toString('utf8').split('\n').filter((l) => l.trim() !== '');
  }

  /** Wipe the app's data container in place (simctl has no `pm clear` equivalent). */
  private async clearAppData(bundleId: string): Promise<void> {
    await this.terminate(bundleId);
    const { stdout } = await this.simctl(['get_app_container', this.target(), bundleId, 'data']);
    const container = stdout.toString('utf8').trim();
    if (!container.startsWith('/')) throw new Error(`Unexpected app container path: ${container}`);
    for (const entry of await readdir(container)) {
      await rm(join(container, entry), { recursive: true, force: true });
    }
  }
}

/** `log show --start` expects "YYYY-MM-DD HH:MM:SS" in local time. */
function formatLogDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
