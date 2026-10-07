import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec as defaultExec, type ExecFn } from './exec.js';
import { detectXcodeEnv } from './xcode-env.js';
import { runIdb } from './idb.js';
import type { IosTreeSource } from './ios-tree-source.js';
import type { IosTreeSourceKind } from './ios-node.js';
import type { Device, DeviceAdapter, Key, LaunchOptions, UiNode } from './types.js';

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

  /** The injected source's kind; undefined on an unbound adapter, which never reads a tree (DeviceAdapter.treeSourceKind). */
  get treeSourceKind(): IosTreeSourceKind | undefined {
    return this.treeSource?.kind;
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
    await this.enableAccessibilityAutomation(`launching ${bundleId}`);
    await this.simctl(['launch', this.target(), bundleId]);
  }

  /** The simulator-wide write below is announced once per adapter, not per launch. */
  private accessibilityAutomationAnnounced = false;

  /**
   * Before EVERY launch, on EVERY tree source: write the simulator's
   * `com.apple.Accessibility` `AutomationEnabled` and
   * `ApplicationAccessibilityEnabled` to true. Measured 2026-10-07
   * (docs/bugs/2026-10-07-one-wda-session-makes-idb-stick-until-reboot.md):
   * one WebDriverAgent start and stop leaves both keys at 0, and from then
   * on every app process launched on that simulator starts with an empty
   * `idb ui describe-all` tree (15/15; a never-WDA simulator 0/30) until a
   * reboot. Writing both true before the launch made 15/15 healthy; deleting
   * them did not help, and a WDA attach cures only until the next launch.
   * Regardless of the source because a `treeSource: wda` project's teardown
   * poisons idb for every other reader of the same simulator (another
   * project's averi on idb, idb by hand), and the write is idempotent and
   * expected to be sub-second (not yet timed). Every launch, not once: each
   * later teardown presumably writes 0 again. A deep link that cold-starts
   * the app (`openDeepLink`) is a launch too, so it writes first as well.
   *
   * The keys are simulator-wide and averi never restores them, so the first
   * successful write per adapter says so on stderr — the finding asked for
   * the write to be at least logged; it is on by default, without a config
   * switch, because it was measured to cure and not measured to harm (not
   * measured on mp-native or VoiceOver-sensitive apps). `defaults write`
   * takes one key per call, so two calls, each under 10 s rather than the
   * 30 s default: a simulator that cannot answer a `defaults write` in 10 s
   * fails the launch that follows anyway, and should not hold it for a
   * minute first. A failed write never fails the launch — the app still
   * launches, idb may just read an empty tree — and stderr is the channel
   * this adapter's layer already uses for a non-fatal note (wda.ts); the
   * first failure ends the pair, since the second write would fail the same
   * way and one line says it.
   */
  private async enableAccessibilityAutomation(what: string): Promise<void> {
    for (const key of ['AutomationEnabled', 'ApplicationAccessibilityEnabled']) {
      try {
        await this.simctl(['spawn', this.target(), 'defaults', 'write', 'com.apple.Accessibility', key, '-bool', 'true'], 10_000);
      } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e)).split('\n')[0];
        console.error(
          `averi: could not set com.apple.Accessibility ${key} on ${this.target()} before ${what} (${reason}) — ` +
            'idb may read an empty tree after an earlier WebDriverAgent session on this simulator; ' +
            `if it does, reboot the simulator (xcrun simctl shutdown ${this.udid ?? '<udid>'} && xcrun simctl boot ${this.udid ?? '<udid>'})`,
        );
        return;
      }
    }
    if (!this.accessibilityAutomationAnnounced) {
      this.accessibilityAutomationAnnounced = true;
      console.error(
        `averi: set com.apple.Accessibility AutomationEnabled and ApplicationAccessibilityEnabled to true on ${this.target()} ` +
          '(simulator-wide, not restored; before every launch, so an earlier WebDriverAgent session cannot leave idb reading an empty tree)',
      );
    }
  }

  async terminate(bundleId: string): Promise<void> {
    // simctl terminate fails if the app is not running — that's fine.
    await this.simctl(['terminate', this.target(), bundleId]).catch(() => undefined);
  }

  async openDeepLink(url: string): Promise<void> {
    // A link can cold-start the app: that is a launch (enableAccessibilityAutomation).
    await this.enableAccessibilityAutomation(`opening ${url}`);
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
    // "" types nothing (the DeviceAdapter.typeText contract): idb refuses
    // `ui text ''` with a bare `('Request was not sent',)` — measured
    // 2026-10-07, docs/bugs/2026-10-07-ios-fill-empty-value-fails-in-idb.md.
    // Guarded here, once, because the refusal is idb's, a platform fact no
    // caller owns, and every caller hands its text through unexamined.
    if (text === '') return;
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

  // No `keyboard` oracle (KeyboardOracle, types.ts): the iOS keyboard is part
  // of the accessibility tree — its keys are nodes — so "which rect does it
  // cover" is a tree question, answered since 2026-10-07 by the WDA source
  // (wda-source.ts#keyboardMarks: the band the keyboard draws over, and the
  // Windows that are its own UI) and read by ui-tree/soft-keyboard.ts off
  // the tree that resolved the target; interact/keyboard.ts queries no
  // device here and presses no key — a covered target is refused, with the
  // sentence below. The idb source carries no keyboard, so under it the
  // guard is as it was. Until 2026-10-04 this class answered `unknown` from
  // two stub methods without running anything.

  /**
   * Why a covering keyboard cannot be hidden from here, and what was
   * measured to work (DeviceAdapter.keyboardAdvice) — measured 2026-10-07 on
   * the finportal login, iPhone 17 simulator, docs/bugs/2026-10-05-ios-tap-
   * lands-on-soft-keyboard.md K5: WebDriverAgent's `/wda/keyboard/dismiss`
   * answered "Did not know how to dismiss the keyboard" with and without
   * `keyNames`; the keyboard's return key SUBMITTED the form (the dummy
   * login was rejected, the fields cleared); a swipe over the form did
   * nothing; a tap on the screen's title (a neutral, non-interactive point)
   * hid it and submitted nothing, twice; and there is no back key
   * (`pressKey('back')` throws above). The simulator shows no software
   * keyboard while it believes a hardware keyboard is typing, which is the
   * other way the target is clear. Since stage B (the same day) the
   * sentence also says where the measured dismissal is configured —
   * `app.ios.keyboardDismiss` in averi.yaml (flow/config.ts), which the
   * guard taps before a covered target — so the refusals above this layer
   * point at the fix without naming an iOS config key themselves.
   */
  readonly keyboardAdvice =
    'the keyboard is part of the accessibility tree and no key hides it without a side effect: there is no back key, ' +
    "the return key submits from the field, WebDriverAgent's keyboard/dismiss fails and a swipe does nothing; " +
    'a tap on a neutral, non-interactive element (a title label) was measured to hide it without submitting, ' +
    'and so was the input-accessory toolbar\'s Done — name them under app.ios.keyboardDismiss in averi.yaml ' +
    '(tap: { id: <title> }, accessory: true) and the guard taps the first one on screen before a covered target; ' +
    'typing with a hardware keyboard keeps the software keyboard from showing';

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
