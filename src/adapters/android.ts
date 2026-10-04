import { XMLParser } from 'fast-xml-parser';
import { exec as defaultExec, ExecError, type ExecFn } from './exec.js';
import { sleep } from '../util/sleep.js';
import { zeroRect, type Device, type DeviceAdapter, type Key, type KeyboardOracle, type KeyboardWitness, type LaunchIntent, type LaunchOptions, type Rect, type SoftKeyboard, type UiNode } from './types.js';

const KEYCODES: Record<Key, string> = { back: '4', home: '3', enter: '66' };

/** uiautomator's "the app has no window yet" status — a transient, not a failure. */
const NULL_ROOT_RE = /null root node/i;
const NULL_ROOT_RETRY_MS = 1_000;
const DUMP_TIMEOUT_MS = 15_000;

/**
 * Budget for the soft-keyboard question (the measured cost of the call is on
 * keyboardState, the one place it is written down). Two seconds is "the host
 * is badly loaded", and past it the
 * answer is `unknown` — a tap must not wait 30 s (exec's default) on a
 * question whose only job is to make the tap safer.
 */
const KEYBOARD_QUERY_TIMEOUT_MS = 2_000;
/** The same reasoning for the independent witness (keyboardWitness): past it, `unknown`. */
const KEYBOARD_WITNESS_TIMEOUT_MS = 2_000;

/**
 * A line of `am start` output that means the activity was not started: am's
 * own `Error: …` / `Error type N`, or an uncaught Java exception. See amStart.
 *
 * Each part is load-bearing, and pinned (tests/adapters/android.test.ts):
 * - anchored at the line start, with no leading whitespace allowed (am's own
 *   diagnoses start in column 0; the indented lines are stack frames). A
 *   SUCCESSFUL launch echoes the intent
 *   ("Starting: Intent { dat=app://x/Error/y cmp=pkg/.ErrorActivity }"), and
 *   user data or a class name containing "Error" mid-line is not a failure;
 * - `\b` after Error: "Errors: none" is not am's `Error`;
 * - case-sensitive, deliberately: am capitalises its own diagnoses, and a
 *   lowercase "error: …" on a launch that exited 0 is somebody else's line
 *   (a shell wrapper, the app's own stdout) — not grounds to fail a launch;
 * - the exception branch: a refused launch ("java.lang.SecurityException:
 *   Permission Denial … not exported from uid …") has no `Error` line at all.
 *
 * Deliberately NOT matched, and pinned as such: the old-style prefixed form
 * `Exception in thread "main" java.lang.…` at exit 0. Acceptable because an
 * uncaught exception in am exits non-zero through adb shell v2 (API 24+),
 * so it still fails loudly as the raw ExecError; only shell-v1 devices
 * (Android 6 or older) could show it at exit 0.
 */
const AM_ERROR_LINE_RE = /^(?:Error\b|java\.lang\.\w+(?:Exception|Error)\b).*$/gm;

/** The parts of an intent `am` resolves on, for an error a reader can act on. */
function describeIntent(intent: LaunchIntent): string {
  const parts = [
    intent.action !== undefined && `action ${intent.action}`,
    intent.data !== undefined && `data ${intent.data}`,
    intent.mimeType !== undefined && `mime type ${intent.mimeType}`,
    intent.categories?.length ? `categories ${intent.categories.join(', ')}` : false,
  ].filter((part): part is string => typeof part === 'string');
  return parts.length > 0 ? parts.join(', ') : 'no action, data or mime type given';
}

/** android.widget.* class (last segment) → normalized role. */
const ROLE_MAP: Record<string, string> = {
  Button: 'button',
  ImageButton: 'button',
  TextView: 'text',
  EditText: 'textfield',
  AutoCompleteTextView: 'textfield',
  ImageView: 'image',
  CheckBox: 'checkbox',
  Switch: 'switch',
  ToggleButton: 'switch',
  RadioButton: 'radiobutton',
  SeekBar: 'slider',
  ProgressBar: 'progress',
  WebView: 'webview',
  RecyclerView: 'scrollable',
  ListView: 'scrollable',
  ScrollView: 'scrollable',
  HorizontalScrollView: 'scrollable',
  ViewPager: 'scrollable',
};

export class AndroidAdapter implements DeviceAdapter {
  readonly platform = 'android' as const;
  /**
   * The soft-keyboard oracle (KeyboardOracle in types.ts): Android is the
   * platform whose keyboard is a separate window that `back` hides, so it is
   * the one adapter that has one. Two device questions behind it, each one
   * adb call with its own budget: keyboardState (`dumpsys window displays`,
   * the frame) and keyboardWitness (`dumpsys input_method`, the input
   * method's own word). Their measured costs are on those two methods.
   */
  readonly keyboard: KeyboardOracle = {
    state: () => this.keyboardState(),
    witness: () => this.keyboardWitness(),
  };
  private readonly exec: ExecFn;
  private readonly serial: string | undefined;

  constructor(opts: { serial?: string; exec?: ExecFn } = {}) {
    this.serial = opts.serial;
    this.exec = opts.exec ?? defaultExec;
  }

  private adb(args: string[], timeoutMs?: number) {
    const target = this.serial ? ['-s', this.serial] : [];
    return this.exec('adb', [...target, ...args], timeoutMs ? { timeoutMs } : undefined);
  }

  async listDevices(): Promise<Device[]> {
    const { stdout } = await this.exec('adb', ['devices', '-l']);
    const devices: Device[] = [];
    for (const line of stdout.toString('utf8').split('\n').slice(1)) {
      const match = line.trim().match(/^(\S+)\s+(device|offline)\b/);
      if (!match) continue;
      const [, id, state] = match;
      const model = line.match(/model:(\S+)/)?.[1] ?? id;
      let osVersion = 'unknown';
      if (state === 'device') {
        const prop = await this.exec('adb', [
          '-s', id, 'shell', 'getprop', 'ro.build.version.release',
        ]);
        osVersion = prop.stdout.toString('utf8').trim() || 'unknown';
      }
      devices.push({
        id,
        platform: 'android',
        name: model,
        osVersion,
        state: state === 'device' ? 'booted' : 'offline',
      });
    }
    return devices;
  }

  async install(appPath: string): Promise<void> {
    await this.adb(['install', '-r', appPath], 120_000);
  }

  async launch(packageName: string, opts: LaunchOptions = {}): Promise<void> {
    if (opts.clearState) await this.adb(['shell', 'pm', 'clear', packageName]);
    if (opts.activity === undefined && opts.intent === undefined) {
      // monkey resolves the launcher activity for us, but picks ARBITRARILY
      // when the package declares several (LeakCanary adds one in debug
      // builds, so this may open LeakCanary) — set app.android.activity in
      // averi.yaml to pin the entry point.
      await this.adb(['shell', 'monkey', '-p', packageName, '-c',
        'android.intent.category.LAUNCHER', '1']);
      return;
    }
    const args = ['shell', 'am', 'start'];
    let component: string | undefined;
    if (opts.activity !== undefined) {
      // ".MainActivity" and "com.foo.MainActivity" both resolve against the
      // package; a full "pkg/Activity" component passes through unchanged.
      component = opts.activity.includes('/') ? opts.activity : `${packageName}/${opts.activity}`;
      args.push('-n', component);
    } else {
      // An intent with no activity is SCOPED TO THE PACKAGE: `-p <package>`
      // is parsed by Intent.parseCommandArgs (it calls setPackage) — the
      // intent-spec parser `am start` shares with `am broadcast` etc.; it is
      // NOT listed in `am help` on every Android version, which is why it is
      // spelled out here. Android resolves it against this app's own intent
      // filters, so it reaches whichever activity handles it — the share
      // target, not the launcher. Decided 2026-10-03; before that this branch
      // sent a bare implicit intent (`am start -a ACTION`), which the system
      // may hand to ANOTHER app or answer with a chooser, and a test tool
      // launching "the app" must not end up driving a different one.
      // Never beside `-n`: an explicit component already names the package,
      // and an activity given as a full "other.pkg/Activity" component would
      // contradict a `-p` for this one. The rule for which activity a launch
      // names (and when averi.yaml's applies) is flow/config.ts's
      // resolveLaunchActivity; this is only how the result is said in `am`.
      args.push('-p', packageName);
    }
    const intent = opts.intent ?? {};
    if (intent.action !== undefined) args.push('-a', intent.action);
    if (intent.data !== undefined) args.push('-d', intent.data);
    if (intent.mimeType !== undefined) args.push('-t', intent.mimeType);
    for (const category of intent.categories ?? []) args.push('-c', category);
    for (const [key, value] of Object.entries(intent.extras ?? {})) args.push('--es', key, value);
    await this.amStart(args, { packageName, component, intent: opts.intent });
  }

  /**
   * `am start`, with its failures made loud (2026-10-03).
   *
   * `am start` reports a launch that did not happen in its OUTPUT and, on
   * the Android versions this was written against, still exits 0:
   *
   *   Error: Activity not started, unable to resolve Intent { act=… pkg=… }
   *   Error type 3
   *   Error: Activity class {pkg/pkg.Missing} does not exist.
   *
   * `adb()` only rejects on a non-zero exit, so such a launch "succeeded",
   * and the failure surfaced one step later as a wait that timed out on
   * whatever screen happened to be up — far from its cause. With intents
   * scoped to the package (see launch) "no activity handles this" became an
   * ordinary outcome of a typo'd action or a missing intent filter, so it is
   * diagnosed here.
   *
   * The check is one test for an `Error` line (or an uncaught Java exception,
   * e.g. the SecurityException for a non-exported activity) on either
   * stream — am writes them to stderr, older adb folds stderr into stdout —
   * and it covers the explicit-activity launch too, which had the same
   * silent failure (a misspelt `app.android.activity`): same check, so not
   * left behind. `Warning:` lines are NOT failures ("Activity not started,
   * its current task has been brought to the front" is a successful warm
   * launch). A non-zero exit carrying the same lines gets the same message;
   * any other adb failure passes through untouched.
   *
   * Not covered, deliberately: the `monkey` launch above ("No activities
   * found to run, monkey aborted" is a different output and a different
   * check), `pm clear`, and openDeepLink — monkey and openDeepLink have the
   * same exits-0 shape and are a follow-up, not part of this change. A
   * timed-out `am start` is passed through as the timeout it is, whatever it
   * had printed by then.
   *
   * A deliberate exception, 2026-10-03: the two messages below name
   * averi.yaml's `app.android.activity`, the flow step's `activity:` and the
   * `launch_app` tool — the first error strings in adapters/ to speak config
   * and tool vocabulary rather than platform only. Kept, because that advice
   * is what makes the message recoverable: the reader's next move is in
   * averi.yaml or in the call, not in adb. Rejected: a typed AmStartError
   * thrown here and translated by the callers — there are two (run/ for
   * launch_app, flow/ for the launch step), so one message would have two
   * translation sites that must agree, which is the duplication this change
   * exists to remove. The DETECTION is platform knowledge and stays here
   * either way; no import crosses the layer — only words do.
   */
  private async amStart(
    args: string[],
    launch: { packageName: string; component?: string; intent?: LaunchIntent },
  ): Promise<void> {
    let output: string;
    let cause: unknown;
    try {
      const { stdout, stderr } = await this.adb(args);
      output = `${stdout.toString('utf8')}\n${stderr}`;
    } catch (e) {
      if (!(e instanceof ExecError) || e.timedOut) throw e;
      output = `${e.stdout.toString('utf8')}\n${e.stderr}`;
      cause = e;
    }
    const errors = output.match(AM_ERROR_LINE_RE);
    if (errors === null) {
      if (cause !== undefined) throw cause;
      return;
    }
    const said = `am start said: ${errors.map((line) => line.trim()).join(' / ')}`;
    const { packageName, component, intent } = launch;
    if (component !== undefined) {
      // The component's own package: an activity given as a full
      // "other.pkg/Activity" names a package that is not `packageName`.
      throw new Error(
        `Could not start ${component} — check the activity name (the launch's \`activity\`, or ` +
          `app.android.activity in averi.yaml), that the activity is exported, and that ` +
          `${component.split('/')[0]} is installed. ${said}`,
        { cause },
      );
    }
    // True for every cause am reports, not only "unable to resolve": a
    // matching activity may exist and have refused (SecurityException "not
    // exported from uid", "you do not have permission to access it", "Not
    // allowed to start activity"), so the message does not claim that none
    // handles the intent — it says nothing started, and lets am's line decide.
    throw new Error(
      `Android started no activity in ${packageName} for this intent (${describeIntent(intent ?? {})}) — an ` +
        `intent without an activity is delivered within the app's package. Either no exported activity there ` +
        `declares a matching <intent-filter> (with category DEFAULT), or the one that does refused the launch ` +
        `(not exported / permission — am's message below says which). Fix the action/mime type or the manifest, ` +
        `or name the activity explicitly: \`activity:\` on the launch step / launch_app. ${said}`,
      { cause },
    );
  }

  async terminate(packageName: string): Promise<void> {
    await this.adb(['shell', 'am', 'force-stop', packageName]);
  }

  async openDeepLink(url: string): Promise<void> {
    await this.adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url]);
  }

  async screenshot(): Promise<Buffer> {
    const { stdout } = await this.adb(['exec-out', 'screencap', '-p']);
    return stdout;
  }

  async uiTree(opts: { settle?: boolean } = {}): Promise<UiNode> {
    // Dump to stdout; uiautomator appends a status line after the XML.
    for (let attempt = 0; ; attempt++) {
      let raw: string;
      try {
        raw = (await this.adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], DUMP_TIMEOUT_MS)).stdout.toString('utf8');
      } catch (e) {
        // adb itself failing is the OTHER offline shape (exit 255, "device
        // '<id>' not found" / "device offline"); a dump that never returns is
        // the loaded-host shape (measured 2026-09-17, finportal: 11.4 s at
        // load avg 28). Diagnose both like a dump that returned nothing, so the
        // caller never has to read a bare adb error (review 2026-09-18).
        if (e instanceof ExecError) {
          const last = e.stderr.trim().split('\n').pop() ?? '';
          throw new Error(await this.diagnoseDumpFailure(e.timedOut ? 'timeout' : 'exec-error', last, false), { cause: e });
        }
        throw e;
      }
      const xmlEnd = raw.lastIndexOf('>');
      if (xmlEnd !== -1) return parseUiautomatorXml(raw.slice(0, xmlEnd + 1));
      const status = raw.trim().slice(0, 200);
      // "null root node" is uiautomator saying the app has no window to dump YET
      // (cold launch, ~2-3 s; mid-animation). The one-shot MCP tools opt into a
      // single bounded retry with `settle`; pollers do NOT —
      // their own poll interval already is the retry, and a hidden extra
      // second per miss would only shrink the number of probes their deadline
      // affords (review 2026-09-18).
      if (opts.settle && NULL_ROOT_RE.test(status) && attempt === 0) {
        await sleep(NULL_ROOT_RETRY_MS);
        continue;
      }
      throw new Error(await this.diagnoseDumpFailure('no-xml', status, opts.settle === true));
    }
  }

  /**
   * Turn a dump that produced no XML into a diagnosis the caller can act on.
   *
   * The dump's own text names the automation tool, never the device:
   * measured 2026-09-17 (mp-native run 5), an emulator dying underneath
   * answered `Killed`, then an empty string, then `null root node` — and adb
   * itself still exited 0 each time, so the ExecError path never fired. Three
   * calls were spent on uiautomator hypotheses before `adb shell wm size`
   * said `device offline`. `adb get-state` is that one-line discriminator,
   * so run it HERE, after the failure, and lead with what it says. (Spends up
   * to 5 s of device time — hence "diagnose", not "explain".)
   */
  private async diagnoseDumpFailure(
    kind: 'no-xml' | 'timeout' | 'exec-error',
    status: string,
    retried: boolean,
  ): Promise<string> {
    const dump = kind === 'timeout'
      ? `uiautomator dump timed out after ${DUMP_TIMEOUT_MS / 1000} s`
      : kind === 'exec-error'
        ? `adb could not run uiautomator dump: ${status}`
        : `uiautomator dump returned no XML: ${status}`;
    const id = this.serial ?? 'the default adb device';
    let state: string;
    try {
      state = (await this.adb(['get-state'], 5_000)).stdout.toString('utf8').trim();
    } catch (e) {
      // `adb get-state` on an offline/missing device exits 1 with
      // "error: device offline" / "error: device '<id>' not found" on stderr.
      state = e instanceof ExecError
        ? (e.stderr.trim().replace(/^(Command failed:.*\n)?\s*(error|adb):\s*/s, '') || `exit ${e.exitCode}`)
        : String(e);
    }
    if (/more than one device/i.test(state)) {
      return `several Android devices are attached and none is selected — \`list_devices\` then ` +
        `\`select_device\` before reading a tree (adb: "${state}"). (${dump})`;
    }
    if (state !== 'device') {
      return `device ${id} is not reachable: adb get-state says "${state || 'unknown'}" — ` +
        `recover the device (wait for \`adb devices\` to read \`device\`; \`adb kill-server && adb start-server\` ` +
        `if it does not) before reading its tree. Not an averi or uiautomator fault. (${dump})`;
    }
    if (kind === 'exec-error') {
      return `${dump} — yet adb get-state says "device"; adb itself failed, not the app. Re-check \`adb devices\` and retry once.`;
    }
    if (kind === 'timeout') {
      return `device ${id} is reachable but SLOW: ${dump} while adb get-state says "device" — the host or ` +
        `emulator is under load (measured 2026-09-17: an 11.4 s dump at load avg 28). Not a dead app and not a ` +
        `code defect; ease the load (builds, other emulators) and retry.`;
    }
    if (NULL_ROOT_RE.test(status)) {
      return `device ${id} is still settling: uiautomator has no window to dump yet ` +
        `(cold launch or animation; ${retried ? `retried once after ${NULL_ROOT_RETRY_MS} ms` : 'read once'}). ` +
        `Wait for the screen (\`screenshot\` waits for stability) and retry. (${dump})`;
    }
    return `${dump} — adb get-state says "device", so the dump itself died on the guest ` +
      `(hung or memory-pressured emulator: "Killed" / empty output). Re-check \`adb devices\` and retry; ` +
      `if it repeats, the emulator, not the app, needs attention.`;
  }

  async tap(x: number, y: number): Promise<void> {
    await this.adb(['shell', 'input', 'tap', String(x), String(y)]);
  }

  private viewportPromise: Promise<{ width: number; height: number }> | undefined;

  /** Screen size in device pixels — the units uiautomator bounds use. */
  viewport(): Promise<{ width: number; height: number }> {
    this.viewportPromise ??= (async () => {
      const { stdout } = await this.adb(['shell', 'wm', 'size']);
      const raw = stdout.toString('utf8');
      // "Physical size: 1080x2280", optionally overridden ("Override size: ...")
      const m = raw.match(/Override size:\s*(\d+)x(\d+)/) ?? raw.match(/Physical size:\s*(\d+)x(\d+)/);
      if (!m) throw new Error(`Cannot parse wm size output: ${raw.slice(0, 120)}`);
      return { width: Number(m[1]), height: Number(m[2]) };
    })();
    return this.viewportPromise;
  }

  async longPress(x: number, y: number, durationMs = 800): Promise<void> {
    await this.adb(['shell', 'input', 'swipe',
      String(x), String(y), String(x), String(y), String(durationMs)]);
  }

  async swipe(
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs = 300,
  ): Promise<void> {
    await this.adb(['shell', 'input', 'swipe',
      String(from.x), String(from.y), String(to.x), String(to.y), String(durationMs)]);
  }

  async typeText(text: string): Promise<void> {
    // One `input text` call PER CHARACTER, with explicit pacing. Bulk injection
    // races Compose's async text state and silently drops most characters
    // (measured 2026-08-05 on the login username field: 3 of 11 landed). The adb
    // round-trip alone is NOT enough pacing on a loaded emulator — re-measured
    // the same evening after hours of uptime: per-char with no delay landed 5 of
    // 8, per-char with 300ms landed 8/8. 250ms keeps a 12-char value at ~3s.
    for (const ch of text) {
      const escaped = ch.replace(/([\\"'`$&*()[\]{}|;<>?~#])/, '\\$1').replace(/ /, '%s');
      await this.adb(['shell', 'input', 'text', escaped]);
      await sleep(250);
    }
    // Force the IME to COMMIT the final composing character: GBoard holds the
    // last injected char in a composition span for seconds, and a BACK or a
    // focus-moving tap discards it — a fixed post-type sleep (tried 500ms) is
    // NOT enough. Moving the cursor left and back right commits the span
    // deterministically (measured 2026-08-05: verified-8/submitted-7 with the
    // sleep; 8/8 submitted with the cursor nudge even when BACK follows
    // immediately).
    await this.adb(['shell', 'input', 'keyevent', '21']); // DPAD_LEFT
    await this.adb(['shell', 'input', 'keyevent', '22']); // DPAD_RIGHT
    await sleep(150);
  }

  async pressKey(key: Key): Promise<void> {
    await this.adb(['shell', 'input', 'keyevent', KEYCODES[key]]);
  }

  /**
   * Is the soft keyboard (IME) shown, and which screen rect does it cover?
   * One adb call: `dumpsys window displays`, read by parseImeInsets below.
   *
   * Why that command — measured 2026-10-03 on emulator-5554 (Pixel_3a, API
   * 33, 1080x2220), three to five runs each, wall time of the whole adb call:
   *
   *   dumpsys window displays      15.9 KB    56–96 ms   has the IME InsetsSource line
   *   dumpsys window InputMethod    4.0 KB    76–83 ms   the IME WINDOW: its frame is the whole
   *                                                      display below the status bar
   *                                                      ([0,66][1080,2220]) shown or hidden —
   *                                                      the covered area is only in
   *                                                      "touchable region=SkRegion(…)"
   *   dumpsys window windows       33.0 KB   82–110 ms   no InsetsSource line on this device,
   *                                                      shown or hidden ("Requested
   *                                                      visibilities: ITYPE_IME: …" only)
   *   dumpsys input_method        791 KB   276–318 ms   mInputShown, but no frame — and over
   *                                                      the budget on its own
   *
   * THE COST OF THIS CALL — the one place the figures live (2026-10-03);
   * every other comment and ARCHITECTURE.md §8 point here:
   *   - from a shell (the table above; process start included): 56–96 ms;
   *   - through this adapter's execFile, eleven runs: 18–37 ms.
   *
   * `displays` is the one that yields "shown" AND the frame from a single
   * line, in a format that is the same line on API 36 (40 ms, 11.7 KB there).
   * Rejected: `dumpsys input_method | grep mInputShown` plus a second call
   * for the frame (two calls, the first alone ~300 ms); the IME window's
   * touchable region (an SkRegion string whose shape differs with a floating
   * or split keyboard, and present while hidden too, as the nav-bar strip).
   *
   * FAILS OPEN: any failure of the call — adb exit, timeout, offline device —
   * is `unknown`, not a throw. This question exists to make a tap safer; it
   * must never be the reason a tap did not happen. A device that is really
   * gone fails the tap itself one call later, in the tap's own words.
   */
  private async keyboardState(): Promise<SoftKeyboard> {
    let dump: string;
    try {
      dump = (await this.adb(['shell', 'dumpsys', 'window', 'displays'], KEYBOARD_QUERY_TIMEOUT_MS)).stdout.toString('utf8');
    } catch {
      return { state: 'unknown' };
    }
    return parseImeInsets(dump);
  }

  /**
   * The independent witness (2026-10-04): what the input method manager
   * itself says — `mInputShown=true|false` in `dumpsys input_method` — as
   * opposed to the window manager's insets that keyboardState reads.
   *
   * Why a second source. Measured that day (Pixel_3a AVD, API 33), right
   * after a tap that made the app navigate away: `dumpsys window displays`
   * STILL printed `mIsImeShowing=true` and `InsetsSource type=ITYPE_IME
   * frame=[0,1398][1080,2220] … visible=true`, while `dumpsys input_method`
   * already said `mInputShown=false`; a few seconds later (three samples a
   * second apart) the window state read `mIsImeShowing=false` /
   * `frame=[0,0][0,0] … visible=false`. So the two witnesses parseImeInsets
   * cross-checks come from the SAME dump and go stale TOGETHER — and a
   * guarded tap inside that window, on a target under the stale frame,
   * would press `back` with no keyboard up and navigate away. With the
   * keyboard genuinely up, `mInputShown=true` was observed beside
   * `mIsImeShowing=true`. Rejected: trusting the window state alone (the
   * above); using this INSTEAD of it (it has no frame, so it cannot say
   * whether the keyboard covers the tap point).
   *
   * The command filters ON THE DEVICE — the whole dump is 776 KB. THE COST,
   * the one place the figures live (measured 2026-10-04, emulator-5554,
   * six runs each, wall time of the spawned adb process, keyboard hidden):
   *   adb shell "dumpsys input_method | grep -m1 mInputShown"   90 bytes   20–32 ms (one 75)
   *   adb shell "dumpsys input_method | grep mInputShown"       90 bytes   55–59 ms
   *   adb shell dumpsys input_method                           776 KB      60–66 ms (one 136)
   * `-m1` lets grep stop at the line (line 134 of ~11 000) instead of
   * reading the rest. The line as printed there:
   *   "  mShowRequested=false mShowExplicitlyRequested=false mShowForced=false mInputShown=false"
   *
   * The command actually sent (INPUT_SHOWN_COMMAND) matches the name as a
   * whole WORD — `grep -m1 -w mInputShown` — so an earlier line holding a
   * name that merely ENDS in it (`…mPrevmInputShown=`) cannot be the one
   * `-m1` returns, which would read `unknown` and switch the veto off
   * silently. `=` is not a word character, so `mInputShown=` still matches.
   * toybox grep has -w and -m; the `-w` form is UNVERIFIED on a device
   * (written in a round with no adb access) — the timings above are of the
   * plain pattern.
   *
   * Not memoized: the answer changes with every focus, and the registry
   * keeps one adapter for a whole session — a cached `hidden` would veto
   * every later dismissal.
   *
   * `unknown` — never a throw — when the call fails or times out, and when
   * grep finds no such line (it exits 1, so that IS a failed call): an
   * Android version that does not print `mInputShown` is UNVERIFIED either
   * way (only API 33 was measured), and there the caller keeps the decision
   * it had without this witness.
   */
  private async keyboardWitness(): Promise<KeyboardWitness> {
    let out: string;
    try {
      out = (
        await this.adb(['shell', INPUT_SHOWN_COMMAND], KEYBOARD_WITNESS_TIMEOUT_MS)
      ).stdout.toString('utf8');
    } catch {
      return 'unknown';
    }
    return parseInputShown(out);
  }

  async clearText(count: number): Promise<void> {
    if (count <= 0) return;
    // One keyevent per adb call: batched multi-keycode calls drop events in
    // the IME queue (measured 2026-08-05 — `input keyevent 67 67 67 67` on
    // the amount field landed only 3 of 4). MOVE_END first, then backspaces;
    // a forward-delete pass cleans up in case the cursor did not move.
    await this.adb(['shell', 'input', 'keyevent', '123']); // KEYCODE_MOVE_END
    for (let i = 0; i < count; i++) await this.adb(['shell', 'input', 'keyevent', '67']); // DEL
    for (let i = 0; i < count; i++) await this.adb(['shell', 'input', 'keyevent', '112']); // FORWARD_DEL
  }

  async setClipboard(_text: string): Promise<void> {
    // No reliable pure-adb clipboard write across API levels; revisit with a helper app if needed.
    throw new Error('setClipboard is not supported on Android yet');
  }

  async isAppRunning(packageName: string): Promise<boolean> {
    // `|| true` makes the device shell exit 0 whether or not a process matched,
    // so an EMPTY stdout is the one "not running" signal and any ExecError is
    // the TRANSPORT failing — adb timing out under host load, the device
    // offline — i.e. a question that could not be asked, never a dead app
    // (measured 2026-09-17, finportal: a timed-out adb call here became
    // `appAlive: false` for an app alive on the expected screen). The exit code
    // cannot carry that distinction: exec.ts substitutes err.message when
    // stderr is empty, so ExecError.stderr is never blank (review 2026-09-18).
    if (!/^[A-Za-z0-9_.]+$/.test(packageName)) throw new Error(`invalid Android package name: ${packageName}`);
    const { stdout } = await this.adb(['shell', `pidof ${packageName} || true`]);
    return stdout.toString('utf8').trim() !== '';
  }

  async logs(sinceMs: number): Promise<string[]> {
    const seconds = (sinceMs / 1000).toFixed(3);
    const { stdout } = await this.adb(['logcat', '-d', '-T', seconds]);
    return stdout.toString('utf8').split('\n').filter((l) => l.trim() !== '');
  }
}

/**
 * `mInputShown=<bool>` as a whole `key=value` word: it follows whitespace (it
 * is the LAST word of a line of such words) and its value ends at whitespace
 * or the line's end, so neither `…mInputShown=` as the tail of a longer name
 * (`mPrevmInputShown=`) nor
 * `mInputShown=trueish` reads as an answer.
 */
const INPUT_SHOWN_RE = /(?:^|\s)mInputShown=(true|false)(?=\s|$)/g;

/**
 * ONE argument for `adb shell`: adb hands the string to the device's sh, and
 * execFile adds no host shell, so the pipe runs on the device. No quoting to
 * get wrong: `-w` needs none.
 */
const INPUT_SHOWN_COMMAND = 'dumpsys input_method | grep -m1 -w mInputShown';

/**
 * The input method manager's own "is the keyboard shown" out of (a grep of)
 * `dumpsys input_method`. One value, or several that agree; anything else —
 * no such word, an unreadable value, two that disagree — is `unknown`. (The
 * device-side `grep -m1` returns one line, so "two that disagree" only
 * guards multi-line input: fixtures, or a future unfiltered read.)
 */
export function parseInputShown(out: string): KeyboardWitness {
  const values = new Set([...out.matchAll(INPUT_SHOWN_RE)].map((m) => m[1]));
  if (values.size !== 1) return 'unknown';
  return values.has('true') ? 'shown' : 'hidden';
}

/** One `InsetsSource …` entry of a display's InsetsState, as `dumpsys window displays` lists it. */
const INSETS_SOURCE_LINE_RE = /^[ \t]*InsetsSource (.*)$/gm;
/** The IME's insets type: `ITYPE_IME` up to Android 13, `ime` (WindowInsets.Type.toString) from 14. */
const IME_INSETS_TYPES = new Set(['ITYPE_IME', 'ime']);
/**
 * A screen rect as Android prints it everywhere — `[l,t][r,b]`, in a
 * uiautomator `bounds` attribute and in an InsetsSource `frame=` alike. ONE
 * pattern for both readers (hoisted 2026-10-03: parseImeInsets had grown a
 * second copy to test "is this a frame" before parseBounds read it).
 */
const BOUNDS_PATTERN = String.raw`\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]`;
const BOUNDS_RE = new RegExp(BOUNDS_PATTERN);
/**
 * The three tokens of an InsetsSource entry parseImeInsets reads (named
 * 2026-10-03). Each is anchored on BOTH sides — a token starts the entry or
 * follows whitespace, and its value ends at whitespace or the line's end —
 * because the entry is a run of `key=value` words and an unanchored match
 * reads a neighbour: `frame=` is the tail of `visibleFrame=` (API ≤ 33
 * prints both, and the hidden keyboard's visibleFrame is NOT empty),
 * `visible=` the tail of any `…visible=`, `type=` of any `…type=`; and
 * `visible=trueish` must not read as true. All pinned.
 */
const INSETS_TYPE_RE = /(?:^|\s)type=(\S+)/;
const INSETS_FRAME_RE = new RegExp(String.raw`(?:^|\s)frame=(${BOUNDS_PATTERN})(?=\s|$)`);
const INSETS_VISIBLE_RE = /(?:^|\s)visible=(true|false)(?=\s|$)/;
/**
 * DisplayPolicy's own line in the same dump — the second witness
 * parseImeInsets asks. A whole line, nothing else on it: the same text
 * mid-line (inside some other object's toString) is not that field.
 */
const IME_SHOWING_LINE_RE = /^[ \t]*mIsImeShowing=(true|false)[ \t]*$/gm;

/**
 * Read the soft keyboard's state out of `dumpsys window displays`.
 *
 * The line it reads is the display's InsetsState entry for the IME — the
 * insets the window manager hands to apps, i.e. the screen area the keyboard
 * takes from them, in screen pixels (uiautomator's units):
 *
 *   API 33, shown   (measured 2026-10-03, emulator, Settings search):
 *     InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220] visibleFrame=[0,1398][1080,2220] visible=true insetsRoundedCornerFrame=false
 *   API 33, hidden  (same device):
 *     InsetsSource type=ITYPE_IME frame=[0,0][0,0] visibleFrame=[0,2088][1080,2220] visible=false insetsRoundedCornerFrame=false
 *   API 33, ~0.4 s after `back` hid it (the hide animation still running):
 *     InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220] visibleFrame=[0,1398][1080,2220] visible=false insetsRoundedCornerFrame=false
 *   API 36, a booted device that has not shown a keyboard yet (measured the
 *   same day): NO ime entry — the list holds only
 *     InsetsSource id=ab460000 type=statusBars frame=[0,0][1080,66] visible=true flags= sideHint=TOP boundingRects=null
 *   API 34+, shown: `InsetsSource id=… type=ime frame=[l,t][r,b] visible=true …`
 *   — FROM AOSP's InsetsSource.dump, NOT captured on a device (the one API 36
 *   AVD available was PIN-locked, so no keyboard could be raised on it); the
 *   line's layout is verified on that device for the other types.
 *
 * What the measurements force:
 * - `visible=` decides, never the frame alone: a hidden keyboard keeps a
 *   non-empty `visibleFrame` (the nav-bar strip) and, while it animates out,
 *   its full `frame`. `visibleFrame` is not read at all (absent from 14 on).
 * - Only the `InsetsSource …` lines that START a line are read — the state
 *   list. The same text recurs as `mSource=InsetsSource …` under each
 *   provider, and `InsetsSourceControl …` is a different object.
 *
 * The second witness, since the review of 2026-10-03: DisplayPolicy's
 * `mIsImeShowing=<bool>` line, printed in the same dump. Measured that day:
 * `mIsImeShowing=true` (with `mImeHeight=756`) beside the shown line on API
 * 33, `mIsImeShowing=false` beside the hidden one, and `mIsImeShowing=false`
 * on the API 36 device with no ime entry. Its value DURING the show/hide
 * animations was not captured. On API 30–32 the line may not be printed at
 * all — UNVERIFIED, no such device was at hand — which is why its absence is
 * tolerated where the InsetsSource entry speaks for itself.
 *
 * Never guess (the answer gates a `back` key press, which NAVIGATES when no
 * keyboard is up — so the worst outcome is a false `shown`, the second worst
 * a silent `hidden`; `unknown` costs nothing, the callers behave as before):
 * - no InsetsSource entry that reads fully (type, frame, visible) → unknown:
 *   the format is not one this parser knows;
 * - an IME entry that does not read fully, or a visible one with an empty
 *   frame → unknown;
 * - several IME entries, or several `mIsImeShowing` lines, that do not all
 *   say the same thing (state, and frame when visible) → unknown. That is
 *   the multi-display case: display 0 hidden and display 1 shown must not
 *   read as `shown` with display 1's frame. Chosen over scoping to the
 *   default display because all three real dumps are single-display — where
 *   one display's section ends is not something they can verify. The
 *   consequence, by design and not a bug: a device with a second display
 *   reads `unknown` whenever a keyboard is shown (the displays' witnesses
 *   disagree), i.e. it behaves as before the guard existed;
 * - `shown` = a visible IME entry with a frame, and `mIsImeShowing` not
 *   saying false (true, or absent);
 * - `hidden` = an IME entry with visible=false, and `mIsImeShowing` not
 *   saying true (false, or absent);
 * - NO IME entry: `hidden` only when `mIsImeShowing=false` says so (the API
 *   36 measurement). Otherwise unknown — a dump truncated before the entry,
 *   or an Android that renamed the type, must not silently switch the guard
 *   off or stop `dismissKeyboard` pressing back.
 */
export function parseImeInsets(dump: string): SoftKeyboard {
  const unknown: SoftKeyboard = { state: 'unknown' };
  let recognised = 0;
  /** What each IME entry says: 'hidden', or the frame text of a visible one. */
  const entries = new Set<string>();
  for (const [, body] of dump.matchAll(INSETS_SOURCE_LINE_RE)) {
    const type = body.match(INSETS_TYPE_RE)?.[1];
    const frame = body.match(INSETS_FRAME_RE)?.[1];
    const visible = body.match(INSETS_VISIBLE_RE)?.[1];
    const reads = type !== undefined && frame !== undefined && visible !== undefined;
    if (reads) recognised++;
    if (type === undefined || !IME_INSETS_TYPES.has(type)) continue;
    if (!reads) return unknown;
    entries.add(visible === 'true' ? frame : 'hidden');
  }
  const flags = new Set([...dump.matchAll(IME_SHOWING_LINE_RE)].map((m) => m[1]));
  if (recognised === 0 || entries.size > 1 || flags.size > 1) return unknown;
  const [entry] = entries;
  const [showing] = flags; // 'true' | 'false' | undefined (line absent)
  if (entry === undefined) return showing === 'false' ? { state: 'hidden' } : unknown;
  if (entry === 'hidden') return showing === 'true' ? unknown : { state: 'hidden' };
  const rect = parseBounds(entry);
  if (rect.width <= 0 || rect.height <= 0 || showing === 'false') return unknown;
  return { state: 'shown', frame: rect };
}

interface RawNode {
  class?: string;
  'resource-id'?: string;
  text?: string;
  'content-desc'?: string;
  focusable?: string;
  'long-clickable'?: string;
  bounds?: string;
  node?: RawNode | RawNode[];
}

export function parseUiautomatorXml(xml: string): UiNode {
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    isArray: (name) => name === 'node',
  }).parse(xml);
  const roots: RawNode[] = parsed.hierarchy?.node ?? [];
  if (roots.length === 0) throw new Error('uiautomator dump contained no nodes');
  const children = roots.map(normalizeNode);
  if (children.length === 1) return children[0];
  return {
    role: 'container', label: null, identifier: null, value: null,
    rect: zeroRect(), children,
  };
}

function normalizeNode(raw: RawNode): UiNode {
  const className = raw.class?.split('.').pop() ?? '';
  const text = emptyToNull(raw.text);
  const contentDesc = emptyToNull(raw['content-desc']);
  const rawChildren = raw.node === undefined ? [] : Array.isArray(raw.node) ? raw.node : [raw.node];
  // Compose text inputs don't always dump as EditText: a BasicTextField with
  // scroll semantics surfaces as (Horizontal)ScrollView carrying the content
  // in `text` (measured 2026-08-05, login username field — value came back
  // null and fill's clear silently no-oped). A focusable AND long-clickable
  // scroll view is a text input; real scroll containers are neither.
  const composeTextInput =
    (className === 'HorizontalScrollView' || className === 'ScrollView') &&
    raw.focusable === 'true' &&
    raw['long-clickable'] === 'true';
  const isTextInput = className.endsWith('EditText') || composeTextInput;
  return {
    role: isTextInput ? 'textfield' : (ROLE_MAP[className] ?? (rawChildren.length > 0 ? 'container' : 'other')),
    label: contentDesc ?? text,
    // resource-id is "com.example.app:id/login_button" — selectors use the short name
    identifier: emptyToNull(raw['resource-id']?.split('/').pop()),
    value: isTextInput ? text : null,
    rect: parseBounds(raw.bounds),
    children: rawChildren.map(normalizeNode),
  };
}

function parseBounds(bounds: string | undefined): Rect {
  const m = bounds?.match(BOUNDS_RE);
  if (!m) return zeroRect();
  const [, l, t, r, b] = m.map(Number);
  return { x: l, y: t, width: r - l, height: b - t };
}

function emptyToNull(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : String(value);
}
