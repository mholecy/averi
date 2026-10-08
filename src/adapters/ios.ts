import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec as defaultExec, type ExecFn } from './exec.js';
import { simctl } from './xcode-env.js';
import { runIdb } from './idb.js';
import { screenshotPng } from './screenshot-bytes.js';
import { rebootSimulatorAdvice } from './simulator-reboot.js';
import { errorMessage } from '../util/error-message.js';
import { IdbEmptyTreeError, type IosTreeSource } from './ios-tree-source.js';
import type { IosTreeSourceKind } from './ios-node.js';
import type { DeviceAdapter, DeviceScreen, Key, LaunchOptions, Point, UiNode } from './types.js';
import { ViewportMemo } from './viewport-memo.js';
import { sleep } from '../util/sleep.js';

/**
 * How long uiTree({ settle: true }) waits before its one re-read of an idb
 * tree that came back empty (2026-10-08). One second because that is where
 * the measurements put the line: on a simulator whose idb was healthy all 10
 * launches had a tree with area at +1 s (0 of 30 reads empty at +1/+5/+15 s,
 * docs/bugs/2026-10-06-wda-read-wakes-stuck-idb-tree.md, I4), and
 * the transient seen on a healthy idb was empty 0.4–0.5 s after launch_app
 * returned (two cold launches) and, the once it was re-read, bare — no longer
 * empty — at +0.7 s (docs/plans/2026-10-08-round3-phase2-device-check.md, row
 * R1 and finding 5). The same length as Android's NULL_ROOT_RETRY_MS, by
 * measurement, not by copying it.
 */
export const IDB_EMPTY_RETRY_MS = 1_000;

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
  private readonly udid: string;
  private readonly treeSource: IosTreeSource;

  constructor(opts: {
    /**
     * The simulator this adapter drives — required (2026-10-08): listing
     * simulators is discovery.ts's, not an adapter's, so there is no unbound
     * adapter any more, and with it went simctl's `booted` alias and the
     * lazy `simctl list` that resolved a UDID for idb (which rejects the
     * alias).
     */
    udid: string;
    exec?: ExecFn;
    /**
     * Where uiTree() reads from. Injected, not defaulted: both sources need
     * the concrete UDID (idb rejects simctl's `booted` alias, WDA builds
     * `-destination id=`), and the registry is the one caller that has it.
     */
    treeSource: IosTreeSource;
  }) {
    this.udid = opts.udid;
    this.exec = opts.exec ?? defaultExec;
    this.treeSource = opts.treeSource;
  }

  /** The injected source's kind (DeviceAdapter.treeSourceKind). */
  get treeSourceKind(): IosTreeSourceKind {
    return this.treeSource.kind;
  }

  /** `xcrun simctl` under the DEVELOPER_DIR probe shared with WdaServer — see xcode-env.ts. */
  private simctl(args: string[], timeoutMs?: number) {
    return simctl(this.exec, args, timeoutMs);
  }

  // --- idb boundary (input only — the tree read is the source's) ---

  private idb(args: string[], timeoutMs?: number) {
    return runIdb(this.exec, this.udid, args, { timeoutMs });
  }

  private idbUi(args: string[]) {
    return this.idb(['ui', ...args]);
  }

  /**
   * The source's read, and with `settle` (DeviceAdapter.uiTree — a one-shot
   * caller, `ui_snapshot` today) one bounded retry of an idb read that came
   * back with no tree: IdbEmptyTreeError, once, after IDB_EMPTY_RETRY_MS —
   * Android's null-root retry (android.ts), for iOS's own launch transient.
   * Until 2026-10-08 `settle` was ignored here on the belief that neither idb
   * nor WDA had a "no window yet" transient; the round-3 device check
   * (docs/plans/2026-10-08-round3-phase2-device-check.md, finding 5)
   * falsified it for idb: a single `ui_snapshot` 0.4 s after launch_app read
   * the 0×0 Application that IdbEmptyTreeError names, a read 0.3 s later was a
   * bare tree, and the screen rendered within ~4 s. WDA has shown no such
   * shape, and its errors are not retried.
   *
   * Only the one error, only once: any other error propagates unchanged, and
   * a second empty tree is thrown again with `reread` set — the same first
   * line (what a trace quotes), and a message that says the read was already
   * retried, so the rest of the advice applies — telling the reader to read
   * again only for the unmeasured case of a first render slower than the
   * re-read (launch_app under about two seconds ago). A stuck idb (measured empty from +0.3 s to 30.4 s and for
   * 18 min, docs/bugs/2026-10-06-wda-read-wakes-stuck-idb-tree.md) therefore
   * still fails the call, one second later. Here and not in
   * IdbTreeSource.read: the source stays one read per call, so the pollers —
   * which never pass `settle`, their interval already is the retry — pay
   * nothing, and the stuck path every waiting caller and the ensure_state
   * ladder's refusal sees is the one it was.
   */
  async uiTree(opts: { settle?: boolean } = {}): Promise<UiNode> {
    try {
      return await this.treeSource.read();
    } catch (e) {
      if (!opts.settle || !(e instanceof IdbEmptyTreeError)) throw e;
    }
    await sleep(IDB_EMPTY_RETRY_MS);
    try {
      return await this.treeSource.read();
    } catch (e) {
      // Still empty: the same error, saying it was a re-read — the cause line
      // unchanged, the advice that of a stuck idb.
      if (e instanceof IdbEmptyTreeError) throw new IdbEmptyTreeError(e.udid, e.types, { reread: IDB_EMPTY_RETRY_MS });
      throw e;
    }
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
    return this.treeSource.dispose();
  }

  // --- simctl-backed lifecycle ---

  async install(appPath: string): Promise<void> {
    await this.simctl(['install', this.udid, appPath], 120_000);
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
    await this.simctl(['launch', this.udid, bundleId]);
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
   * ≈0.27 s per key (device check I6). Every launch, not once: every WDA
   * teardown writes 0 again (read back in device check I4). A deep link that cold-starts
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
        await this.simctl(['spawn', this.udid, 'defaults', 'write', 'com.apple.Accessibility', key, '-bool', 'true'], 10_000);
      } catch (e) {
        const reason = errorMessage(e).split('\n')[0];
        console.error(
          `averi: could not set com.apple.Accessibility ${key} on ${this.udid} before ${what} (${reason}) — ` +
            'idb may read an empty tree after an earlier WebDriverAgent session on this simulator; ' +
            `if it does, ${rebootSimulatorAdvice(this.udid)}`,
        );
        return;
      }
    }
    if (!this.accessibilityAutomationAnnounced) {
      this.accessibilityAutomationAnnounced = true;
      console.error(
        `averi: set com.apple.Accessibility AutomationEnabled and ApplicationAccessibilityEnabled to true on ${this.udid} ` +
          '(simulator-wide, not restored; before every launch, so an earlier WebDriverAgent session cannot leave idb reading an empty tree)',
      );
    }
  }

  async terminate(bundleId: string): Promise<void> {
    // simctl terminate fails if the app is not running — that's fine.
    await this.simctl(['terminate', this.udid, bundleId]).catch(() => undefined);
  }

  async openDeepLink(url: string): Promise<void> {
    // A link can cold-start the app: that is a launch (enableAccessibilityAutomation).
    await this.enableAccessibilityAutomation(`opening ${url}`);
    await this.simctl(['openurl', this.udid, url]);
  }

  async screenshot(): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), 'averi-'));
    const file = join(dir, 'screen.png');
    try {
      await this.simctl(['io', this.udid, 'screenshot', file]);
      // simctl exits 0 and the file is read after it — an empty or foreign
      // file is judged here, as on Android (screenshot-bytes.ts).
      return screenshotPng(await readFile(file), {
        device: `simulator ${this.udid}`,
        command: `xcrun simctl io ${this.udid} screenshot <file>`,
        remedy: `Re-check \`xcrun simctl list devices booted\` and retry; if it repeats, ${rebootSimulatorAdvice(this.udid)}.`,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // --- input (idb) ---

  async tap(x: number, y: number): Promise<void> {
    await this.idbUi(['tap', String(x), String(y)]);
  }

  private readonly viewportMemo = new ViewportMemo(async () => {
    const { stdout } = await this.idb(['describe', '--json']);
    const parsed = JSON.parse(stdout.toString('utf8')) as {
      screen_dimensions?: { width_points?: number; height_points?: number };
    };
    const dims = parsed.screen_dimensions;
    if (!dims?.width_points || !dims.height_points) {
      throw new Error('idb describe returned no screen_dimensions.{width,height}_points');
    }
    return { width: dims.width_points, height: dims.height_points };
  });

  /** Screen size in POINTS — the units idb AX frames use. Memoized: types.ts#viewport. */
  viewport(opts?: { fresh?: boolean }): Promise<DeviceScreen> {
    return this.viewportMemo.get(opts);
  }

  async longPress(x: number, y: number, durationMs = 800): Promise<void> {
    await this.idbUi(['tap', String(x), String(y), '--duration', String(durationMs / 1000)]);
  }

  async swipe(from: Point, to: Point, durationMs = 300): Promise<void> {
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
  // the tree that resolved the target; the in-tree keyboard model (interact/
  // keyboard-in-tree.ts, what an adapter without the oracle gets) queries no
  // device here and presses no key of its own — a covered target is refused,
  // with the sentence below, unless `app.ios.keyboardDismiss` names a
  // dismissal on screen, which the guard taps first (stage B, 2026-10-07;
  // the advice's doc). The idb source carries no keyboard, so under it the
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

  async isAppRunning(bundleId: string): Promise<boolean> {
    const { stdout } = await this.simctl(['spawn', this.udid, 'launchctl', 'list']);
    return stdout.toString('utf8').includes(`UIKitApplication:${bundleId}`);
  }

  async logs(sinceMs: number): Promise<string[]> {
    const start = formatLogDate(new Date(sinceMs));
    const { stdout } = await this.simctl(
      ['spawn', this.udid, 'log', 'show', '--style', 'compact', '--start', start],
      60_000,
    );
    return stdout.toString('utf8').split('\n').filter((l) => l.trim() !== '');
  }

  /** Wipe the app's data container in place (simctl has no `pm clear` equivalent). */
  private async clearAppData(bundleId: string): Promise<void> {
    await this.terminate(bundleId);
    const { stdout } = await this.simctl(['get_app_container', this.udid, bundleId, 'data']);
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
