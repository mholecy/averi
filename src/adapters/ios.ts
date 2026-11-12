import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec as defaultExec, ExecError, hostHome, type ExecFn } from './exec.js';
import { simctl } from './xcode-env.js';
import { runIdb } from './idb.js';
import type { IdbHelper } from './idb-helper.js';
import { screenshotPng } from './screenshot-bytes.js';
import { rebootSimulatorAdvice } from './simulator-reboot.js';
import { errorMessage } from '../util/error-message.js';
import { DESCRIBE_ALL_TIMEOUT_MS, IdbEmptyTreeError, type IosTreeSource } from './ios-tree-source.js';
import type { AppHolder, DeepLinkOptions, DeviceAdapter, DeviceScreen, Key, LaunchOptions, Point, UiNode } from './types.js';
import { awaitForeground, type ForegroundCheck } from './ios-foreground.js';
import { appInfoBundle, appInfoNames, type AppBinary } from './simctl-appinfo.js';
import { noLinkHandler } from './ios-link-failure.js';
import { isSystemScheme, isWebScheme, linkScheme, PLUTIL_NO_SUCH_KEY, SCHEME_APPROVAL_DOMAIN, schemeApprovalKey, schemeApprovalWrite, urlSchemes } from './ios-url-schemes.js';
import { hostProcessPattern, pgrepReason, pgrepVerdict } from './ios-liveness.js';
import { ViewportMemo } from './viewport-memo.js';
import { iosStatusBand } from './ios-status-band.js';
import { resetDataContainer } from './ios-data-container.js';
import { sleep } from '../util/sleep.js';
import type { Typeable } from './typeable.js';
import { withNoteLine } from '../util/note-line.js';
import { IDB_TYPEABLE, idbTypingRefusal, typingPathOf, WDA_TYPEABLE } from './ios-typing.js';

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
 * `AVERI_IOS_SCREENSHOT=simctl`: every iOS screenshot through `simctl io screenshot`, as before D26b (SETUP.md,
 * troubleshooting). Read once per adapter, when it is made.
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
 * threshold. The gap is the lever instead: at 8 and 20 characters (40 rounds each, 80 typings a mode) the split
 * with 0 ms kept 80/80 (185 / 238 ms), with 50 ms 80/80 (235 / 292 ms), with 100 ms 80/80, with 150 ms 80/80; one call
 * with a companion-side 50 ms HID delay between the first key and the rest 80/80 (148 / 204 ms). So any pause after the
 * first key of at least ~50 ms appears to let the controlled input catch up after its first keystroke (whose JS value
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
 * The host pgrep's budget in isAppRunning (D33): it answers in ~19 ms (median, lab simulator); a host too loaded to
 * answer in 5 s gets launchctl for that check, and pgrep again next time.
 */
export const PGREP_TIMEOUT_MS = 5_000;

/**
 * How many checks in a row of one bundle may find pgrep saying no while launchctl says running before its liveness
 * asks launchctl alone (D33 review): one is a stale path (dropped, appinfo read again); two, the second after a fresh
 * appinfo, is a pattern that misses the app's process.
 */
const DISAGREEMENTS_TO_GIVE_UP = 2;

/** One bundle's `simctl appinfo`, as IosAdapter caches it: the launch's names, the liveness check's binary. */
interface AppInfo extends AppBinary {
  names: readonly string[];
}

/** A link's scheme (lower-cased) and the project's app that declares it: what D58 pre-approves for simctl's opener. */
interface SchemeApproval {
  scheme: string;
  bundleId: string;
}
/** The key schemeApprovals keeps a pre-approval's state under — this adapter's, not iOS's `<opener>--><scheme>`. */
const approvalCacheKey = ({ scheme, bundleId }: SchemeApproval): string => `${bundleId}-->${scheme}`;

/**
 * The app the typing goes into, as far as an IosAdapter knows (D24 — what its memory of tail-dropping apps is keyed
 * by):
 * - `unlaunched`: before any launch through this adapter — an app opened by hand, or before the server started:
 *   whatever is in front, one key for all of it (UNLAUNCHED);
 * - `launched`: the bundle this adapter last launched — or brought forward by a link to its own scheme, once the
 *   foreground wait saw it in front (D49a). A link that brings another app forward, or a tap that does, is not seen:
 *   the key stays the launched app's;
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
 * iOS adapter: `xcrun simctl` for lifecycle, `idb` for input and screenshots (screenshotVia), and an
 * injected IosTreeSource for the accessibility tree (ios-tree-source.ts —
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
  /**
   * What this adapter types (ios-typing.ts, ADR 0037's D43 amendment): WDA_TYPEABLE over a tree source that types
   * (IosTreeSource.typeText — WDA's), else IDB_TYPEABLE. Decided by the source's typer, not its kind: the differential
   * harness's recorded source is of kind `wda` and types nothing. Asked of the source per call: fixed for idb and wda,
   * and under `auto` (A41a) WDA's until its first read chose idb, IDB_TYPEABLE from then on.
   */
  get typeable(): Typeable {
    return this.treeSource.typeText !== undefined ? WDA_TYPEABLE : IDB_TYPEABLE;
  }

  /** The source's line for every claiming reply (DeviceAdapter.claimNote): `auto`'s, once it fell back (A41a). */
  get claimNote(): string | undefined {
    return this.treeSource.claimNote;
  }

  /** Whether the source fell back (DeviceAdapter.fellBack, IosTreeSource.fellBack): `auto` read through idb (A41a). */
  get fellBack(): boolean {
    return this.treeSource.fellBack === true;
  }
  private readonly exec: ExecFn;
  private readonly udid: string;
  private readonly treeSource: IosTreeSource;
  /** The simulator's idb helper (D7a, idb-helper.ts) — owned here: dispose() kills it. */
  private readonly idbHelper: IdbHelper | undefined;
  /**
   * Where screenshot() captures: `idb` (D26b; on the WDA tree source too since D44, ADR 0032 amendment) — the helper
   * first, the `idb` CLI as its fallback — and `simctl` under AVERI_IOS_SCREENSHOT=simctl. Fixed for the adapter's
   * life: one source for every frame (types.ts#DeviceAdapter.screenshot).
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
    this.screenshotVia = iosScreenshotViaSimctl() ? 'simctl' : 'idb';
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
   * `idb ui text --udid U -- <text>`, the one argv that types (D74): after `--` argparse takes the text as its
   * positional whatever it starts with, so `-h` is typed rather than answered with help (exit 0, nothing typed) and
   * `-hunter2` or `--log=s3cret` is no option (runIdb puts the --udid before the `--`: withUdid). The text's index is
   * declared typed (A17, ExecOptions.typed), so no failure shows it.
   */
  private idbText(text: string) {
    return runIdb(this.exec, this.udid, ['ui', 'text', '--', text], { helper: this.idbHelper, typed: [3] });
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
    // A reinstall can move the bundle container (a new GUID in Path) and rename the app or its executable: every
    // appinfo this adapter read may be stale now, and so may what pgrep and launchctl disagreed on (D33). The bundle id
    // is not known here (an .app path), so every bundle's.
    this.appInfoCache.clear();
    this.urlSchemesCache.clear();
    this.schemeApprovals.clear();
    this.disagreements.clear();
    this.launchctlOnly.clear();
    await this.simctl(['install', this.udid, appPath], 120_000);
  }

  async launch(bundleId: string, opts: LaunchOptions = {}): Promise<AppHolder> {
    if (opts.activity !== undefined || opts.intent !== undefined) {
      throw new Error(
        'activity/intent launch is Android-only (iOS apps have a single entry point) — ' +
          'use open_deep_link, or wrap the step in an `android:` platform override',
      );
    }
    if (opts.clearState) await this.clearAppData(bundleId);
    await this.prepareForOpen(`launching ${bundleId}`);
    await this.simctl(['launch', this.udid, bundleId]);
    this.front = { kind: 'launched', bundleId };
    // A41b: WebDriverAgent's start, if it is not up, runs beside the foreground wait — never awaited
    // (IosTreeSource.prewarm; idb has none). After `simctl launch`, never before it: a start racing the app's own
    // launch is unmeasured (ADR 0046's A41b amendment).
    this.treeSource.prewarm?.();
    // `simctl launch` returns before the app is in front: for ~1–2 s idb (and
    // WDA's /source, D48) can still hand out the previous app's (or
    // SpringBoard's) tree, complete and labelled, which no reader doubts. Wait
    // here — the one place both launch_app and a flow's `launch:` pass, once —
    // until the source names this app (idb: the tree's Application; WDA, once
    // up: its active app's bundle id), bounded and failing open; the facts,
    // the bound and the cost are ios-foreground.ts's. When iOS's system alert
    // holds the launch (D56), the answer names it and its buttons' centres.
    return awaitForeground(this.foregroundCheck(bundleId));
  }

  /**
   * One `simctl appinfo` per bundle, read once per adapter (D33: the launch's names and the liveness check's
   * executable path share it) — a name or a path does not change under a session; install() clears it (a reinstall
   * can move the container and rename the app), and a liveness check whose pgrep and launchctl disagree drops that
   * bundle's entry. An answer is cached when it carries a name or a Path — a name-less one with a Path too (appNames
   * throws on it from the cache: the launch's note says so without asking again); a failed call, or an answer with
   * neither (a format drift, maybe a bundle not installed), is asked again.
   * Also what the foreground note's `ownerOf` searches (2026-10-09): a stale label that is another app's name from here is that app's tree, not a localized name. It holds only what this adapter looked up (an idb-source launch — WDA answers a bundle id and is never matched by name; a liveness check; this process), so an app never launched or checked through this server is not in it.
   */
  private readonly appInfoCache = new Map<string, AppInfo>();

  /** The bundle in `appInfoCache` one of whose names is `label` — the first when several share it; undefined when none does. No device call. */
  private ownerOf(label: string): string | undefined {
    for (const [bundle, info] of this.appInfoCache) if (info.names.includes(label)) return bundle;
    return undefined;
  }

  /**
   * The bundle's `simctl appinfo`, cached per appInfoCache's rule; throws when the call fails. 10 s, not simctl's
   * 30 s default: the lookup is an aid to the launch (and to the liveness check, which falls back without it), not
   * part of it, and a simulator that cannot answer it in 10 s fails the reads that follow anyway (the same reasoning
   * as the defaults writes below).
   */
  private async appInfo(bundleId: string): Promise<AppInfo> {
    const cached = this.appInfoCache.get(bundleId);
    if (cached !== undefined) return cached;
    const { stdout } = await this.simctl(['appinfo', this.udid, bundleId], 10_000);
    const text = stdout.toString('utf8');
    const info: AppInfo = { names: appInfoNames(text), ...appInfoBundle(text) };
    if (info.names.length > 0 || info.path !== undefined) this.appInfoCache.set(bundleId, info);
    return info;
  }

  /**
   * The bundle's display names, from `simctl appinfo` — THROWS when the
   * call fails or lists neither name, and the foreground wait then says it
   * could not check, quoting the first line (review 2026-10-09: appinfo's
   * format is unmeasured, and a drift must not switch the check off
   * unseen). Through appInfo's cache rule: a failed lookup, or one with
   * neither a name nor a Path, is asked again on the next launch.
   */
  private async appNames(bundleId: string): Promise<readonly string[]> {
    const { names } = await this.appInfo(bundleId);
    if (names.length === 0) throw new Error('simctl appinfo listed neither CFBundleDisplayName nor CFBundleName');
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
   *
   * A link to the project's own scheme (`approval`, D58) adds a third
   * write to the same batch: the scheme's pre-approval for simctl's opener
   * (judgeSchemeApproval). It runs beside the two, so it costs no wall
   * time of its own, and its result is judged apart from theirs.
   */
  private async prepareForOpen(what: string, approval?: SchemeApproval): Promise<void> {
    const keys = ['AutomationEnabled', 'ApplicationAccessibilityEnabled'] as const;
    const approving = approval !== undefined && this.schemeApprovals.get(approvalCacheKey(approval)) !== 'failed';
    const results = await Promise.allSettled([
      ...keys.map((key) => this.simctl(['spawn', this.udid, 'defaults', 'write', 'com.apple.Accessibility', key, '-bool', 'true'], 10_000)),
      ...(approving ? [this.simctl(['spawn', this.udid, ...schemeApprovalWrite(approval.scheme, approval.bundleId)], 10_000)] : []),
    ]);
    const writes = results.slice(0, keys.length);
    if (approving) this.judgeSchemeApproval(approval, results[keys.length]);
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

  /**
   * Each pre-approval (D58) this adapter wrote, by `<bundleId>--><scheme>`: `'written'` once said on stderr, `'failed'`
   * once a write failed — not tried again until install(), as the scheme cache (a simulator that refused one write
   * refuses the next, and one stderr line per bundle, not one per link, says so). A written one is written again on
   * every link: the write is idempotent, runs beside the accessibility writes, and a key deleted under the session
   * (by hand, or a check like batch-7's) is restored by the next link rather than raising the alert.
   */
  private readonly schemeApprovals = new Map<string, 'written' | 'failed'>();

  /**
   * One pre-approval's result (D58): the first success per key said on stderr (the keys are simulator-wide and persist,
   * as the accessibility write's announcement); a failure said once and remembered. A failure never fails the link —
   * `openurl` runs as before, and if iOS then asks "Open in “…”?", the wait names the alert (D54/D56).
   */
  private judgeSchemeApproval(approval: SchemeApproval, result: PromiseSettledResult<unknown> | undefined): void {
    const key = approvalCacheKey(approval);
    const { scheme, bundleId } = approval;
    if (result?.status === 'rejected') {
      this.schemeApprovals.set(key, 'failed');
      console.error(
        `averi: could not pre-approve ${scheme} links to ${bundleId} for simctl openurl on ${this.udid} ` +
          `(${errorMessage(result.reason).split('\n')[0]}) — iOS may ask "Open in “…”?" first, and the reply names the ` +
          'alert if it does; not tried again until the app is installed again',
      );
      return;
    }
    if (this.schemeApprovals.get(key) === 'written') return;
    this.schemeApprovals.set(key, 'written');
    console.error(
      `averi: recorded iOS's "Open" answer for ${scheme} links to ${bundleId} from simctl openurl on ${this.udid} ` +
        `(${SCHEME_APPROVAL_DOMAIN} ${schemeApprovalKey(scheme)} = ${bundleId}; simulator-wide, not restored; ` +
        `before every link to the app's own scheme, so iOS should not ask "Open in “…”?")`,
    );
  }

  async terminate(bundleId: string): Promise<void> {
    // simctl terminate fails if the app is not running — that's fine.
    await this.simctl(['terminate', this.udid, bundleId]).catch(() => undefined);
    if (this.front.kind === 'launched' && this.front.bundleId === bundleId) this.front = { kind: 'forgotten' };
  }

  /**
   * `simctl openurl`, after launch's accessibility writes (a link can cold-start the app: that is a launch). Then, only
   * for a link to a scheme the project's app (`opts.appId`) declares, launch's foreground wait (D49a,
   * ios-foreground.ts: iOS may ask "Open in …?" first, and `openurl` returns either way) — with a note whenever it did
   * not confirm the app, a WDA not up yet included; every other link — none given, `http(s)`, iOS's own schemes,
   * another app's scheme, schemes that could not be read — expects no app and reads nothing of the UI after `openurl`,
   * as before D49a. The scheme lookup runs first (D58: it decides the pre-approval, which must land before `openurl`):
   * one `simctl appinfo` (shared with launch's cache) and one host `plutil` per bundle, cached until install() — a
   * failed one too. For an own-scheme link the accessibility writes carry the scheme's pre-approval for simctl's opener
   * (prepareForOpen, D58), so iOS should not ask "Open in “…”?" at all; every other link writes what it wrote before.
   * `front` moves to the app only when the wait saw it in front. When iOS's system alert holds the link (D54), the
   * answer names it instead of `unknown`: on idb from the wait's own reads, on WDA from one short `/source`
   * read at the bound (IosTreeSource.systemAlert) — never a tap. A link no app on the simulator handles throws that
   * fact (ios-link-failure.ts, D65); any other `openurl` failure is exec's error.
   */
  async openDeepLink(url: string, opts: DeepLinkOptions = {}): Promise<AppHolder> {
    const approval = await this.linkHandler(url, opts.appId);
    await this.prepareForOpen(`opening ${url}`, approval);
    await this.simctl(['openurl', this.udid, url]).catch((e: unknown) => {
      throw noLinkHandler(e, url) ?? e;
    });
    if (approval === undefined) return { holder: 'none' };
    const handler = approval.bundleId;
    // A link's wait answers `unknown` or an alert in every case but a match (ios-foreground.ts#awaitForeground).
    const answer = await awaitForeground(this.foregroundCheck(handler, { link: url }));
    if (answer.holder === 'none') this.front = { kind: 'launched', bundleId: handler };
    return answer;
  }

  /**
   * The foreground wait's check of `bundleId` through this adapter's source and caches — launch's and a link's. The
   * alert read is the source's own, for both (D54, D56: WDA's short /source); idb has none — its label reads carry the
   * alert's shape.
   */
  private foregroundCheck(bundleId: string, extra: Pick<ForegroundCheck, 'link'> = {}): ForegroundCheck {
    return {
      bundleId,
      label: () => this.treeSource.applicationLabel(),
      names: () => this.appNames(bundleId),
      ownerOf: (label) => this.ownerOf(label),
      source: this.treeSource.kind,
      alert: this.treeSource.systemAlert?.bind(this.treeSource),
      ...extra,
    };
  }

  /**
   * `appId` and the link's (lower-cased) scheme when it is one `appId` declares — the app the link waits for and the
   * scheme D58 pre-approves; undefined otherwise — no app, no scheme, a web or system scheme (no lookup at all), another
   * app's, or schemes that could not be read.
   */
  private async linkHandler(url: string, appId: string | undefined): Promise<SchemeApproval | undefined> {
    const scheme = linkScheme(url);
    if (appId === undefined || scheme === undefined || isWebScheme(scheme) || isSystemScheme(scheme)) return undefined;
    return (await this.urlSchemes(appId, url))?.includes(scheme) === true ? { scheme, bundleId: appId } : undefined;
  }

  /**
   * The schemes a bundle declares (its Info.plist's CFBundleURLTypes, lower-cased; ios-url-schemes.ts), per bundle
   * until install() — "declares none" included, and `undefined` for a plutil read that failed on a bundle whose
   * appinfo named its Path (review of D49a: one lookup and one stderr line per bundle, not one per link). An appinfo
   * failure, or no Path, is NOT cached, as appInfo's own rule (review round 2): the app may be installed later outside
   * averi (Xcode, `simctl install` by hand), and every later own-scheme link would then reply a bare "Opened".
   */
  private readonly urlSchemesCache = new Map<string, readonly string[] | undefined>();

  /**
   * One bundle's schemes: `plutil` on the host, on the Info.plist at appinfo's Path (appInfo, cached); undefined when
   * they could not be read — appinfo failed or listed no Path (asked again next link), plutil failed other than on a
   * missing key, or its answer has another shape (cached) — said on stderr (this layer's channel for a non-fatal
   * note), so a drift in the lookup does not switch the wait off unseen (ios-foreground.ts's "never silent"). 10 s,
   * as appinfo: a host read of milliseconds (measured on the lab app).
   */
  private async urlSchemes(bundleId: string, url: string): Promise<readonly string[] | undefined> {
    if (this.urlSchemesCache.has(bundleId)) return this.urlSchemesCache.get(bundleId);
    const unread = (e: unknown, then: string): undefined => {
      console.error(
        `averi: could not read ${bundleId}'s URL schemes (${errorMessage(e).split('\n')[0]}) — ` +
          `opening ${url} without waiting for ${bundleId} to come forward${then}`,
      );
      return undefined;
    };
    let path: string | undefined;
    try {
      ({ path } = await this.appInfo(bundleId));
    } catch (e) {
      return unread(e, '; asked again on the next link');
    }
    if (path === undefined) return unread(new Error('simctl appinfo listed no Path'), '; asked again on the next link');
    let schemes: readonly string[] | undefined;
    try {
      schemes = await this.readUrlSchemes(path);
    } catch (e) {
      schemes = unread(e, ', and will not wait for it on later links until the app is installed again');
    }
    this.urlSchemesCache.set(bundleId, schemes);
    return schemes;
  }

  /** The schemes in the Info.plist of the `.app` at `path`, uncached; a missing key is none; throws otherwise. */
  private async readUrlSchemes(path: string): Promise<readonly string[]> {
    try {
      const { stdout } = await this.exec('plutil', ['-extract', 'CFBundleURLTypes', 'json', '-o', '-', join(path, 'Info.plist')], { timeoutMs: 10_000 });
      return urlSchemes(stdout.toString('utf8'));
    } catch (e) {
      if (e instanceof ExecError && PLUTIL_NO_SUCH_KEY.test(e.stderr)) return [];
      throw e;
    }
  }

  /**
   * One frame, as a PNG — from the one source this adapter captures with (screenshotVia):
   * - idb: `idb screenshot - --udid U`, the PNG on stdout, through runIdb — the helper when it is ready and idle, the
   *   `idb` CLI otherwise, and the CLI again when the helper dies under it (a read). Measured on the lab simulator, 120
   *   interleaved rounds each (backlog "### D26 diag"): through a persistent fb-idb client 77 ms p50 / 88 p90 and no
   *   stall, the CLI 168 / 179 and no stall, where `simctl io screenshot` took 398 / 417 and stalled ~+1 000 ms in 8 of
   *   120 (no simctl variant avoided it). No simctl fallback when idb fails (one source,
   *   types.ts#DeviceAdapter.screenshot): idb draws the Dynamic Island where simctl shows the app's background — the
   *   idb error is the answer, and the kill switch is the way back (AVERI_IOS_SCREENSHOT=simctl).
   * - simctl (the kill switch): `xcrun simctl io <udid> screenshot <file>`, as before D26b.
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
   * 524 pt in 1502 ms; its `minDurationMs` floor is kept equal to this
   * 300 ms default — change both) —
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
    // D43 (ios-typing.ts): a text idb cannot type goes whole to the source's typer — WDA's `/wda/keys`, which delivers
    // on return (batch-10's G1: 20/20), so `typingDelivery` holds for it too. No D24 split there: batch-10's G5 typed
    // 10/10 into the RN field with no tail dropped, and the fill's retype stays the net. Every text idb can type stays
    // on idb, byte for byte; over a source without a typer every text does, as before D43.
    if (this.treeSource.typeText !== undefined && typingPathOf(text) === 'wda') {
      await this.treeSource.typeText(text);
      return;
    }
    // A backstop, not a path (A41a review M2): a source that fell back (IosTreeSource.fellBack — `auto` whose
    // WebDriverAgent did not come up) lost its typer after a caller checked `typeable`. A text only WDA types gets
    // ADR 0037's refusal, nothing sent, instead of idb's trace. Over idb and the recorded source (never fallen back)
    // nothing changes.
    if (this.fellBack && typingPathOf(text) === 'wda') {
      throw new Error(withNoteLine(idbTypingRefusal(text), this.treeSource.claimNote));
    }
    // Every typing here goes through idbText: `ui text --udid U -- <text>`, so a leading dash is typed (D74), and its
    // text declared typed (A17), so no failure shows it.
    // An app seen dropping a tail (D24, FIRST_KEY_ALONE_MS): its first character alone, a wait, then the rest. The
    // first character is a grapheme (Intl.Segmenter), so a surrogate pair or a letter with its combining mark is never
    // split between two idb calls. A one-character text has no rest: one call, no wait.
    const key = appKey(this.front);
    if (key !== undefined && this.dropsTail.has(key)) {
      const [first] = new Intl.Segmenter().segment(text);
      if (first !== undefined && first.segment.length < text.length) {
        await this.idbText(first.segment);
        await sleep(FIRST_KEY_ALONE_MS);
        await this.idbText(text.slice(first.segment.length));
        return;
      }
    }
    await this.idbText(text);
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
   * The settle cadence (types.ts#DeviceAdapter.settleCadenceMs, ADR 0040): the tree source's own fact
   * (ios-tree-source.ts#IosTreeSource.settleCadenceMs) — idb's 300, WDA's 300 (A41b). Forwarded, not chosen here: no
   * dispatch on the source's kind.
   */
  get settleCadenceMs(): number | undefined {
    return this.treeSource.settleCadenceMs;
  }

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

  /** Set when pgrep could not read the host's process list (exit 2/3, spawn failure): launchctl from then on. */
  private hostListUnreadable = false;
  /** Per bundle, how many checks in a row pgrep said no and launchctl said running (DISAGREEMENTS_TO_GIVE_UP). */
  private readonly disagreements = new Map<string, number>();
  /** The bundles whose liveness asks launchctl alone for the adapter's life (a stuck disagreement). */
  private readonly launchctlOnly = new Set<string>();

  /**
   * Liveness from the HOST's process list first (D33, docs/adr/0039-ios-liveness-asks-the-hosts-process-list.md):
   * a simulator app is a macOS process, and `/usr/bin/pgrep -f` of the bundle's exact executable path (Path from
   * the cached appinfo, ios-liveness.ts#hostProcessPattern) answers in ~19 ms where `simctl spawn launchctl list`
   * takes ~240 ms (D33 measurement, lab simulator). A match is the answer. A NO is never trusted alone: launchctl
   * confirms it, and when launchctl says running the cached path is stale and dropped — so the new path can never
   * produce a false "not running", the verdict SKILL.md has the agent report as a crash. No pattern (appinfo failed,
   * a key missing, a system app whose Path is the same on every simulator of its runtime) → launchctl. A timeout →
   * launchctl this call. An unreadable list (exit 2/3, spawn failure — the Claude Code sandbox, measured
   * 2026-11-02) → launchctl for the adapter's life, said once on stderr with pgrep's reason. A disagreement twice in a
   * row for one bundle (pgrep no, launchctl running — even after the second check re-read appinfo) means the pattern
   * misses that app's process (an argv form not seen yet): launchctl alone for that bundle from then on, said once —
   * otherwise every check would pay appinfo + pgrep + launchctl. A launchctl that cannot be asked throws, as
   * before (appHealth's `unknown`). `/usr/bin/pgrep`, absolute: a Homebrew procps pgrep earlier on PATH has other exit
   * codes and regex flavour.
   */
  async isAppRunning(bundleId: string): Promise<boolean> {
    if (this.hostListUnreadable || this.launchctlOnly.has(bundleId)) return this.launchctlLists(bundleId);
    let info: AppBinary;
    try {
      info = await this.appInfo(bundleId);
    } catch {
      return this.launchctlLists(bundleId);
    }
    const pattern = hostProcessPattern(info, this.udid);
    if (pattern === undefined) return this.launchctlLists(bundleId);
    let failure: unknown = undefined;
    try {
      await this.exec('/usr/bin/pgrep', ['-f', pattern], { timeoutMs: PGREP_TIMEOUT_MS });
    } catch (err) {
      failure = err;
    }
    switch (pgrepVerdict(failure)) {
      case 'yes':
        this.disagreements.delete(bundleId);
        return true;
      case 'no':
        return this.confirmNo(bundleId);
      case 'unreadable':
        this.hostListUnreadable = true;
        console.error(
          `averi: the host process list is unreadable (${pgrepReason(failure, hostHome())}) — ` +
            `app liveness on ${this.udid} asks launchctl instead (~240 ms a check)`,
        );
        return this.launchctlLists(bundleId);
      default: // a timeout: launchctl this call, pgrep again next time
        return this.launchctlLists(bundleId);
    }
  }

  /** pgrep found no process: launchctl's answer is the verdict; a disagreement drops the cached path, a stuck one pgrep. */
  private async confirmNo(bundleId: string): Promise<boolean> {
    const running = await this.launchctlLists(bundleId);
    if (!running) {
      this.disagreements.delete(bundleId);
      return false;
    }
    this.appInfoCache.delete(bundleId);
    const inARow = (this.disagreements.get(bundleId) ?? 0) + 1;
    this.disagreements.set(bundleId, inARow);
    if (inARow >= DISAGREEMENTS_TO_GIVE_UP) {
      this.launchctlOnly.add(bundleId);
      console.error(
        `averi: the host process list and launchctl disagree ${DISAGREEMENTS_TO_GIVE_UP} times in a row on ${bundleId} (pgrep: not running; launchctl: running) — ` +
          `its liveness on ${this.udid} asks launchctl alone from now on (~240 ms a check)`,
      );
    }
    return true;
  }

  /**
   * The simulator's launchd lists the app: `UIKitApplication:<bundle>[` — the bracket makes it exact (D33, a
   * deliberate verdict change: the old `includes` without it read `com.x.app` running while only `com.x.app.dev` ran).
   */
  private async launchctlLists(bundleId: string): Promise<boolean> {
    const { stdout } = await this.simctl(['spawn', this.udid, 'launchctl', 'list']);
    return stdout.toString('utf8').includes(`UIKitApplication:${bundleId}[`);
  }

  async logs(sinceMs: number): Promise<string[]> {
    const start = formatLogDate(new Date(sinceMs));
    const { stdout } = await this.simctl(
      ['spawn', this.udid, 'log', 'show', '--style', 'compact', '--start', start],
      60_000,
    );
    return stdout.toString('utf8').split('\n').filter((l) => l.trim() !== '');
  }

  /**
   * Wipe the app's data container in place (simctl has no `pm clear` equivalent), leaving a fresh install's folders
   * (ios-data-container.ts, ADR 0047).
   */
  private async clearAppData(bundleId: string): Promise<void> {
    await this.terminate(bundleId);
    const { stdout } = await this.simctl(['get_app_container', this.udid, bundleId, 'data']);
    const container = stdout.toString('utf8').trim();
    if (!container.startsWith('/')) throw new Error(`Unexpected app container path: ${container}`);
    await resetDataContainer(container);
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
