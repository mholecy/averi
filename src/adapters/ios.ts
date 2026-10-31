import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec as defaultExec, ExecError, type ExecFn } from './exec.js';
import { simctl } from './xcode-env.js';
import { runIdb } from './idb.js';
import type { IdbHelper } from './idb-helper.js';
import { screenshotPng } from './screenshot-bytes.js';
import { rebootSimulatorAdvice } from './simulator-reboot.js';
import { errorMessage } from '../util/error-message.js';
import { DESCRIBE_ALL_TIMEOUT_MS, IdbEmptyTreeError, type IosTreeSource } from './ios-tree-source.js';
import type { DeviceAdapter, DeviceScreen, Key, LaunchOptions, LaunchOutcome, Point, UiNode } from './types.js';
import { awaitForeground } from './ios-foreground.js';
import { appInfoNames } from './simctl-appinfo.js';
import { ViewportMemo } from './viewport-memo.js';
import { iosStatusBand } from './ios-status-band.js';
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
 * The budget of `idb screenshot -` (D26b): describe-all's (ios-tree-source.ts#DESCRIBE_ALL_TIMEOUT_MS, 15 s), the other read the helper serves.
 * The capture took 77 ms through a persistent fb-idb client and 168 ms through the CLI on the lab simulator (backlog
 * "### D26 diag"), so 15 s is a stuck companion, not a slow frame.
 */
export const IDB_SCREENSHOT_TIMEOUT_MS = DESCRIBE_ALL_TIMEOUT_MS;

/**
 * What to do about a failed `idb screenshot` (IosAdapter#idbScreenshot), the one text both failures say: a failed or
 * timed-out call after its first line's command, and bytes that are no PNG — that one with the reboot advice added.
 */
const idbCaptureRemedy = (reboot?: string): string =>
  'check that its idb companion (idb_companion) is running and that `idb list-targets` lists the simulator as Booted; ' +
  'if it repeats, set AVERI_IOS_SCREENSHOT=simctl to capture through simctl' +
  (reboot === undefined ? '' : `, or ${reboot}`);
const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * `AVERI_IOS_SCREENSHOT=simctl`: every iOS screenshot through `simctl io screenshot`, as before D26b, whatever the tree
 * source (SETUP.md, troubleshooting). Read once per adapter, when it is made.
 */
export function iosScreenshotViaSimctl(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AVERI_IOS_SCREENSHOT === 'simctl';
}

/**
 * How long a typing into an app seen dropping a tail waits after its first character, before the rest in one burst
 * (D24, docs/adr/0023-fill-types-a-dropped-tail-again.md, amendment 2026-10-31; lowered 150 → 50 ms by D25, the same
 * ADR's D25 amendment). Measured 2026-10-31 on the lab simulator (iPhone 17, iOS 27.0), `Jan Novak Bratislava` or its
 * prefixes typed into AveriLabRN's `rn-field` (React Native 0.88's controlled single-line TextInput), read back from
 * the app's state file (the scripts and the figures: docs/plans/2026-10-30-performance-backlog.md, "### D7 and D24
 * measured" and "### D25 diag").
 *
 * D24, 15 runs a mode, 20 characters, typed through the `idb ui text` CLI (a Python start-up on every call, ADR 0032):
 *
 * | typing                                       | whole  | time    |
 * |----------------------------------------------|--------|---------|
 * | one burst (averi until D24)                  | 5/15   | —       |
 * | first character, 150 ms, the rest in a burst | 15/15  | 614 ms  |
 * | one call, 10 ms after each key               | 15/15  | 705 ms  |
 * | chunks of 5                                  | 15/15  | 784 ms  |
 * | chunks of 1                                  | 15/15  | 3.8 s   |
 *
 * D25, 40 rounds, every combination once a round in a shuffled order, typed through fb-idb's gRPC client in-process,
 * one client a call — as averi's helper does (a gen_main per request), never through `idb ui text`; whole/40 by length:
 *
 * | typing          | 1     | 2     | 3     | 4     | 5     | 6     | 8     | 12    | 20    |
 * |-----------------|-------|-------|-------|-------|-------|-------|-------|-------|-------|
 * | one burst       | 40/40 | 36/40 | 36/40 | 37/40 | 40/40 | 33/40 | 35/40 | 10/40 | 4/40  |
 * | split, 150 ms   | —     | 40/40 | 40/40 | 40/40 | 40/40 | 40/40 | 40/40 | 40/40 | 40/40 |
 *
 * A burst lands in ~93 ms, the 150 ms split in ~335 ms (+240 ms at lengths 2–8; +215–220 at 12 and 20, where the
 * burst's drops skew its median). A burst already drops at 2 characters (4 of 40 lost the second key), so splitting
 * only above some length — D25's first idea, to spare short texts the split — would leave drops in: there is no safe
 * threshold. The gap is the lever instead: at 8 and 20 characters (40 rounds each, 80 typings a mode) the split with 0
 * ms kept 80/80 (185 / 238 ms), with 50 ms 80/80 (235 / 292 ms), with 100 ms 80/80, with 150 ms 80/80; one call with a
 * companion-side 50 ms HID delay between the first key and the rest 80/80 (148 / 204 ms). So any pause after the first
 * key of at least ~50 ms appears to let the controlled input catch up after its first keystroke (whose JS value
 * round-trip is what the keys arriving behind it are dropped against — ADR 0023's measurement: the END of a burst) and
 * the rest land: 0, 50, 100 and 150 ms between two calls all landed, and so did one call with a bare 50 ms HID pause
 * and no second round trip. The second call's own round trip (~90 ms) already gives such a pause, and 150 ms bought
 * nothing over it. Why 50 and not 0: the margin is kept, and 50 ms is the pause measured to land on its own — hid:50
 * had no round trip at all — so a 50 ms sleep lands the rest even if the second call's round trip through averi's
 * helper shrank to nothing; −100 ms a typing against 150. Not done: the one-call variant with a companion-side delay
 * (~90 ms less again) — it needs a new helper verb carrying the delay. Not measured: other RN versions and fields,
 * multi-line inputs (which dropped nothing in ADR 0023's runs), the 50 ms gap through averi's helper (the device check
 * of D25), loaded hosts.
 */
export const FIRST_KEY_ALONE_MS = 50;

/**
 * The app the typing goes into, as far as an IosAdapter knows (D24 — what its memory of tail-dropping apps is keyed
 * by):
 * - `unlaunched`: before any launch through this adapter — an app opened by hand, or before the server started:
 *   whatever is in front, one key for all of it (UNLAUNCHED);
 * - `launched`: the bundle this adapter last launched. A deep link that brings another app forward, or a tap that
 *   does, is not seen: the key stays the launched app's;
 * - `forgotten`: that bundle was terminated through this adapter — NOT known, so nothing is split and nothing learned
 *   until the next launch (D24 review: a key must not outlive its app).
 */
type FrontApp = { kind: 'unlaunched' } | { kind: 'launched'; bundleId: string } | { kind: 'forgotten' };

/** The key of the app in front before any launch — no bundle id can equal it. */
const UNLAUNCHED = Symbol('unlaunched');
type AppKey = string | typeof UNLAUNCHED;

/** The key a FrontApp's memory is kept under; undefined: not known (`forgotten`) — no split, no learning. */
function appKey(front: FrontApp): AppKey | undefined {
  switch (front.kind) {
    case 'unlaunched':
      return UNLAUNCHED;
    case 'launched':
      return front.bundleId;
    case 'forgotten':
      return undefined;
  }
}

/**
 * iOS adapter: `xcrun simctl` for lifecycle (and screenshots on WDA), `idb` for input (and screenshots on idb, D26b), and
 * an injected IosTreeSource for the accessibility tree (ios-tree-source.ts —
 * idb's describe-all or WebDriverAgent's /source, chosen by the registry from
 * averi.yaml). Everything idb-specific for INPUT stays in the `idb*` methods;
 * the tree read belongs to the source, so swapping the tree backend touches
 * no line of this class (ARCHITECTURE.md §3, §10). Until 2026-10-02 the
 * adapter dispatched on a `treeSource` flag and owned the WdaServer itself.
 */
export class IosAdapter implements DeviceAdapter {
  readonly platform = 'ios' as const;
  /** `idb ui text` delivers its HID events before it returns (types.ts#TypingDelivery, measured 2026-10-19). */
  readonly typingDelivery = 'on-return' as const;
  private readonly exec: ExecFn;
  private readonly udid: string;
  private readonly treeSource: IosTreeSource;
  /** The simulator's idb helper (D7a, idb-helper.ts) — owned here: dispose() kills it. */
  private readonly idbHelper: IdbHelper | undefined;
  /**
   * Where screenshot() captures (D26b): `idb` on the idb tree source — the helper first, the `idb` CLI as its fallback —
   * and `simctl` on the WDA one or under AVERI_IOS_SCREENSHOT=simctl. Fixed for the adapter's life: one source for every
   * frame, so a capture pair never compares two (screenshot()).
   */
  private readonly screenshotVia: 'idb' | 'simctl';
  /** The app the typing goes into, as far as this adapter knows (FrontApp). */
  private front: FrontApp = { kind: 'unlaunched' };
  /**
   * The apps (by `appKey`) whose field a fill saw drop the tail of a typing (noteDroppedTail) — sticky for this
   * adapter's life, so typeText sends their first key alone (FIRST_KEY_ALONE_MS).
   */
  private readonly dropsTail = new Set<AppKey>();

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
    /**
     * The simulator's idb helper (D7a), the same one the tree source was handed. Every idb call is offered to it
     * (runIdb decides which it serves: `ui describe-all`, and since D7b every HID argv this adapter sends — a death under
     * an input is reported, not retried); this adapter owns it and disposes it.
     */
    idbHelper?: IdbHelper;
  }) {
    this.udid = opts.udid;
    this.exec = opts.exec ?? defaultExec;
    this.treeSource = opts.treeSource;
    this.idbHelper = opts.idbHelper;
    this.screenshotVia = this.treeSource.kind === 'idb' && !iosScreenshotViaSimctl() ? 'idb' : 'simctl';
  }

  /** `xcrun simctl` under the DEVELOPER_DIR probe shared with WdaServer — see xcode-env.ts. */
  private simctl(args: string[], timeoutMs?: number) {
    return simctl(this.exec, args, timeoutMs);
  }

  // --- idb boundary (input only — the tree read is the source's) ---

  private idb(args: string[], timeoutMs?: number) {
    return runIdb(this.exec, this.udid, args, { timeoutMs, helper: this.idbHelper });
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
   * The idb helper (D7a) is killed beside it: this adapter owns it, the source only borrows it.
   */
  dispose(): Promise<void> {
    return Promise.all([this.treeSource.dispose(), this.idbHelper?.dispose()]).then(() => undefined);
  }

  // --- simctl-backed lifecycle ---

  async install(appPath: string): Promise<void> {
    await this.simctl(['install', this.udid, appPath], 120_000);
  }

  async launch(bundleId: string, opts: LaunchOptions = {}): Promise<LaunchOutcome> {
    if (opts.activity !== undefined || opts.intent !== undefined) {
      throw new Error(
        'activity/intent launch is Android-only (iOS apps have a single entry point) — ' +
          'use open_deep_link, or wrap the step in an `android:` platform override',
      );
    }
    if (opts.clearState) await this.clearAppData(bundleId);
    await this.enableAccessibilityAutomation(`launching ${bundleId}`);
    await this.simctl(['launch', this.udid, bundleId]);
    this.front = { kind: 'launched', bundleId };
    // `simctl launch` returns before the app is in front: for ~1–2 s idb can
    // still hand out the previous app's (or SpringBoard's) tree, complete and
    // labelled, which no reader doubts. Wait here — the one place both
    // launch_app and a flow's `launch:` pass, once — until the tree's
    // Application is this app's, bounded and failing open; the facts, the
    // bound and the cost are ios-foreground.ts's.
    const note = await awaitForeground({
      bundleId,
      label: () => this.treeSource.applicationLabel(),
      names: () => this.appNames(bundleId),
      ownerOf: (label) => this.ownerOf(label),
    });
    return note === undefined ? {} : { note };
  }

  /**
   * appInfoNames per bundle, read once per adapter — a name does not change under a session (a reinstall that renames the app is the exception, and costs one stale note at most).
   * Also what the foreground note's `ownerOf` searches (2026-10-09): a stale label that is another app's name from here is that app's tree, not a localized name. It holds only what this adapter's launches looked up (the idb source — WDA declines the check before asking; this process), so an app opened by hand or before the server started is not in it.
   */
  private readonly appNamesCache = new Map<string, readonly string[]>();

  /** The bundle in `appNamesCache` one of whose names is `label` — the first when several share it; undefined when none does. No device call. */
  private ownerOf(label: string): string | undefined {
    for (const [bundle, names] of this.appNamesCache) if (names.includes(label)) return bundle;
    return undefined;
  }

  /**
   * The bundle's display names, from `simctl appinfo` — THROWS when the
   * call fails or lists neither name, and the foreground wait then says it
   * could not check, quoting the first line (review 2026-10-09: appinfo's
   * format is unmeasured, and a drift must not switch the check off
   * unseen). Only a lookup that found names is cached, so a failed one is
   * asked again on the next launch. 10 s, not simctl's 30 s default: the
   * lookup is an aid to the launch, not part of it, and a simulator that
   * cannot answer it in 10 s fails the reads that follow anyway (the same
   * reasoning as the defaults writes below).
   */
  private async appNames(bundleId: string): Promise<readonly string[]> {
    const cached = this.appNamesCache.get(bundleId);
    if (cached !== undefined) return cached;
    const { stdout } = await this.simctl(['appinfo', this.udid, bundleId], 10_000);
    const names = appInfoNames(stdout.toString('utf8'));
    if (names.length === 0) throw new Error('simctl appinfo listed neither CFBundleDisplayName nor CFBundleName');
    this.appNamesCache.set(bundleId, names);
    return names;
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
   * ≈0.27 s per key (device check I6, when the two ran in series — see D23
   * below). Every launch, not once: every WDA teardown writes 0 again (read
   * back in device check I4). A deep link that cold-starts the app
   * (`openDeepLink`) is a launch too, so it writes first as well.
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
   * this adapter's layer already uses for a non-fatal note (wda.ts); one
   * line however many writes failed, naming the first key in this order
   * that did (both failing usually means the same cause).
   *
   * The two calls run together, not one after the other (D23, 2026-10-31):
   * each is one `simctl spawn`, and the spawn, not the write, is the cost —
   * timed with simctl from the host on the lab simulator (averi-lab iPhone
   * 17, iOS 27.0, 2026-10-31, 15 interleaved pairs of these same writes):
   * serial 445 ms median (415–462), together 250 ms (233–252). One spawn
   * writing both keys was the plan and is not possible: the simulator
   * runtime has no shell (`simctl spawn <udid> sh -c …` → ENOENT;
   * RuntimeRoot/bin holds only `df` and `launchctl`), and `defaults write
   * <domain> '{…}'` replaces the whole domain, dropping the dozen other keys
   * com.apple.Accessibility holds there. Two `defaults write`s of different keys in one domain at once
   * both land — cfprefsd applies each key on its own (20/20 on a scratch
   * domain on the lab simulator, both keys read back) — and the launch
   * still waits for both.
   */
  private async enableAccessibilityAutomation(what: string): Promise<void> {
    const keys = ['AutomationEnabled', 'ApplicationAccessibilityEnabled'] as const;
    const writes = await Promise.allSettled(
      keys.map((key) => this.simctl(['spawn', this.udid, 'defaults', 'write', 'com.apple.Accessibility', key, '-bool', 'true'], 10_000)),
    );
    const failed = writes.findIndex((w) => w.status === 'rejected');
    const write = writes[failed];
    if (write?.status === 'rejected') {
      const reason = errorMessage(write.reason).split('\n')[0];
      console.error(
        `averi: could not set com.apple.Accessibility ${keys[failed]} on ${this.udid} before ${what} (${reason}) — ` +
          'idb may read an empty tree after an earlier WebDriverAgent session on this simulator; ' +
          `if it does, ${rebootSimulatorAdvice(this.udid)}`,
      );
      return;
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
    if (this.front.kind === 'launched' && this.front.bundleId === bundleId) this.front = { kind: 'forgotten' };
  }

  async openDeepLink(url: string): Promise<void> {
    // A link can cold-start the app: that is a launch (enableAccessibilityAutomation).
    // But no foreground wait (launch's): a link may legitimately bring
    // ANOTHER app forward, and there is no bundle here to wait for.
    await this.enableAccessibilityAutomation(`opening ${url}`);
    await this.simctl(['openurl', this.udid, url]);
  }

  /**
   * One frame, as a PNG — from the one source this adapter captures with (screenshotVia):
   * - idb (D26b, the idb tree source): `idb screenshot - --udid U`, the PNG on stdout, through runIdb — the helper when
   *   it is ready and idle, the `idb` CLI otherwise, and the CLI again when the helper dies under it (a read). Measured
   *   on the lab simulator, 120 interleaved rounds each (backlog "### D26 diag"): through a persistent fb-idb client 77
   *   ms p50 / 88 p90 and no stall, the CLI 168 / 179 and no stall, where `simctl io screenshot` took 398 / 417 and
   *   stalled ~+1 000 ms in 8 of 120 (no simctl variant avoided it). No simctl fallback when idb fails: idb draws the
   *   Dynamic Island where simctl shows the app's background, so a stability pair of one frame from each compares two
   *   different images and reads as moving (verify/capture.ts) — the idb error is the answer, and the kill switch is
   *   the way back (AVERI_IOS_SCREENSHOT=simctl).
   * - simctl (the WDA tree source, or the kill switch): `xcrun simctl io <udid> screenshot <file>`, as before D26b.
   * Either way the bytes are judged here (screenshot-bytes.ts): a command that succeeds with an empty or foreign answer
   * is a transport error naming that command.
   */
  async screenshot(): Promise<Buffer> {
    if (this.screenshotVia === 'idb') return this.idbScreenshot();
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

  /**
   * `idb screenshot -`, judged. A failed or timed-out call is exec's error (or runIdb's, alike) with the remedy put on
   * its FIRST line, after the command: that line is all a capture's callers quote (verify/capture.ts#captureRefusal —
   * the pixel and baseline asserts' fail-closed reason, a run's `⚠ screenshot:` line), and without it an agent would
   * read only `Command failed (exit 1): idb screenshot - --udid U`, the companion's stderr below it unseen. The rest of
   * the message (the stderr) follows as before, and the ExecError is the `cause`.
   */
  private async idbScreenshot(): Promise<Buffer> {
    let stdout: Buffer;
    try {
      ({ stdout } = await this.idb(['screenshot', '-'], IDB_SCREENSHOT_TIMEOUT_MS));
    } catch (e) {
      if (!(e instanceof ExecError)) throw e;
      // A plain Error, the ExecError as `cause`: the remedy must sit on the first line, the one captureRefusal quotes.
      const [first, ...rest] = e.message.split('\n');
      throw new Error([`${first} — ${idbCaptureRemedy()}`, ...rest].join('\n'), { cause: e });
    }
    return screenshotPng(stdout, {
      device: `simulator ${this.udid}`,
      command: `idb screenshot - --udid ${this.udid}`,
      remedy: `${capitalized(idbCaptureRemedy(rebootSimulatorAdvice(this.udid)))}.`,
    });
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
    const size = { width: dims.width_points, height: dims.height_points };
    return { ...size, statusBand: iosStatusBand(size) };
  });

  /** Screen size in POINTS — the units idb AX frames use — and its status band (ios-status-band.ts). Memoized: types.ts#viewport. */
  viewport(opts?: { fresh?: boolean }): Promise<DeviceScreen> {
    return this.viewportMemo.get(opts);
  }

  async longPress(x: number, y: number, durationMs = 800): Promise<void> {
    await this.idbUi(['tap', String(x), String(y), '--duration', String(durationMs / 1000)]);
  }

  /**
   * The stroke's duration defaults to 300 ms, and `scroll_until` passes
   * a feeler's (interact/stroke-plan.ts#FEELER, 600 ms) and, on idb's flat
   * list, a paced full stroke's (interact/stroke-plan.ts#PACED, 349 pt/s:
   * 524 pt in 1502 ms; its `minDurationMs` floor is this 300 ms default —
   * keep the two in step) —
   * on a WDA tree none: this adapter sets no `dragSpeed` (types.ts#DeviceAdapter
   * .dragSpeed; decided 2026-10-09 with the Android one), which would pace
   * WDA's strokes too and switch the motion ledger to drag rules. A
   * UIScrollView decelerates by a rate per ms, its fling roughly linear in
   * the lift speed (measured under WDA: a 344-pt stroke in 300 ms, 1147
   * pt/s, carried the SwiftUI form 729–970 pt), so a speed tuned on
   * Android's spline would still fling here. idb's step timing over a long
   * duration is measured once (D20, 2026-10-31, the lab's form-picker
   * sheet, three runs each): 524 pt in 300 ms flung the SwiftUI List
   * ~1 040 pt, in 1.5 s it carried it ~570 pt — the paced speed. Strokes
   * between 300 ms and 1.5 s, a UIKit table and a horizontal stroke are
   * unmeasured. The scroll's turn — every turn
   * halving the reach — was device-checked on that form, and a lazy list's
   * dropped row now turns the stroke too (interact/scroll-rounds.ts) —
   * and, on WDA's trees, no stroke reaches further than the target still
   * needs at what a stroke of the scroll was seen to carry it, the fling
   * included (interact/course.ts#stillNeeds: a 108-pt drag flung a
   * 180-pt scroll view ~259 pt, past a 116-pt window, one run in three).
   * Unmeasured: an iOS List under WDA that drops its rows.
   */
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
    // An app seen dropping a tail (D24, FIRST_KEY_ALONE_MS): its first character alone, a wait, then the rest. The
    // first character is a grapheme (Intl.Segmenter), so a surrogate pair or a letter with its combining mark is never
    // split between two idb calls. A one-character text has no rest: one call, no wait.
    const key = appKey(this.front);
    if (key !== undefined && this.dropsTail.has(key)) {
      const [first] = new Intl.Segmenter().segment(text);
      if (first !== undefined && first.segment.length < text.length) {
        await this.idbUi(['text', first.segment]);
        await sleep(FIRST_KEY_ALONE_MS);
        await this.idbUi(['text', text.slice(first.segment.length)]);
        return;
      }
    }
    await this.idbUi(['text', text]);
  }

  /**
   * A fill saw the field keep a strict prefix of its typing, typed the tail again, and the typing then landed whole
   * (interact/fill-type.ts, ADR 0023 — a capped field whose retype moves nothing is never reported): the app in front
   * drops the end of a burst. Learned for the app in front (`appKey`); nothing when it is not known (`forgotten`). Its
   * later typings through this adapter send the first key alone (typeText, FIRST_KEY_ALONE_MS) — a platform remedy,
   * measured on iOS only, so it is this adapter's and the fill only reports what it saw. Sticky: an app that dropped
   * once is an RN controlled field's app, and the split costs FIRST_KEY_ALONE_MS where a drop costs a poll of up to
   * 5 × 400 ms and a retype; apps never seen dropping never pay. No device call.
   */
  noteDroppedTail(): void {
    const key = appKey(this.front);
    if (key !== undefined) this.dropsTail.add(key);
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
  // the advice's doc). The idb source marks no node as the keyboard (on
  // iOS 27 it lists the keys, as plain `button`s, and the band, as an
  // unmapped `other` — ios-tree-source.ts's IOS_ROLE_MAP has no keyboard
  // role; docs/bugs/2026-10-09-ios-inert-keyboard-dismiss-note-says-idb-
  // carries-no-keyboard.md), so under it the guard is as it was. Until 2026-10-04 this class answered `unknown` from
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
   * point at the fix without naming an iOS config key themselves. That holds
   * under WDA only: under idb no guard acts (the idb source marks no node as
   * the keyboard — the comment above), the list is inert
   * (config.ts#inertKeyboardDismissNote), and the refusal that reaches an
   * idb user is the band line's (ADR 0006) — so there the sentence says to
   * tap the dismissal yourself, and that the list applies under WDA.
   */
  get keyboardAdvice(): string {
    const fix =
      this.treeSource.kind === 'wda'
        ? 'name them under app.ios.keyboardDismiss in averi.yaml (tap: { id: <title> }, accessory: true) and the guard taps the first one on screen before a covered target'
        : 'tap one yourself first: with treeSource: idb no guard acts, so app.ios.keyboardDismiss is inert ' +
          '(with treeSource: wda the guard taps its first on-screen entry before a covered target)';
    return (
      'the keyboard is part of the accessibility tree and no key hides it without a side effect: there is no back key, ' +
      "the return key submits from the field, WebDriverAgent's keyboard/dismiss fails and a swipe does nothing; " +
      'a tap on a neutral, non-interactive element (a title label) was measured to hide it without submitting, ' +
      `and so was the input-accessory toolbar's Done — ${fix}; ` +
      'typing with a hardware keyboard keeps the software keyboard from showing'
    );
  }

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
