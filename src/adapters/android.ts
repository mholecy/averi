import { XMLParser } from 'fast-xml-parser';
import { exec as defaultExec, ExecError, type ExecFn } from './exec.js';
import { adbShellArgv, shellCommandLine } from './adb-shell.js';
import { CONTROL_CHAR_RE, controlCharRemedy, inputTextControlFate } from './input-text.js';
import { causeOf, runStart, type StartRefused } from './android-start.js';
import { screenshotPng } from './screenshot-bytes.js';
import { ViewportMemo } from './viewport-memo.js';
import { sleep } from '../util/sleep.js';
import { formatSeconds } from '../util/duration.js';
import { everyNode, rectArea, zeroRect, type ClippedSide, type DeviceAdapter, type DeviceScreen, type DrawnOverStrip, type Key, type KeyboardOracle, type KeyboardTouchable, type KeyboardWitness, type LaunchIntent, type LaunchOptions, type LaunchOutcome, type Point, type Rect, type ScrollAxis, type SoftKeyboard, type UiNode } from './types.js';

const KEYCODES: Record<Key, string> = { back: '4', home: '3', enter: '66' };

/** One adb call's options: its own budget. */
interface AdbCallOptions {
  timeoutMs?: number;
}

/** uiautomator's "the app has no window yet" status — a transient, not a failure. */
const NULL_ROOT_RE = /null root node/i;
const NULL_ROOT_RETRY_MS = 1_000;
const DUMP_TIMEOUT_MS = 15_000;
/** diagnoseDumpFailure's `adb get-state` — a one-line answer; past this, adb is not answering. */
const GET_STATE_TIMEOUT_MS = 5_000;

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
/** The same reasoning for the status band beside the screen size (statusBand): past it, no band. */
const STATUS_BAND_QUERY_TIMEOUT_MS = 2_000;

/** A refusal's lines as the messages below quote them: `<command> said: a / b`. */
function startSaid(refused: StartRefused): string {
  return `${refused.command} said: ${refused.lines.join(' / ')}`;
}

// The advice the start refusals below share, written once (launchRefused
// says why an adapter message may name config keys and tools).
/** An activity may exist and have refused; am's quoted line tells which. */
const REFUSED_BY_ACTIVITY = "(not exported / permission — am's message below says which)";
/** Where a launch names its activity in the call. */
const NAME_THE_ACTIVITY = '`activity:` on the launch step / launch_app';
/** Where it is named in the config. */
const ACTIVITY_IN_CONFIG = 'app.android.activity in averi.yaml';

/** What a launch starts: the package, and the component or intent it names. */
interface LaunchTarget {
  packageName: string;
  component?: string;
  intent?: LaunchIntent;
}

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

/**
 * The launch's sentence for an `am start` that started nothing — the
 * DETECTION is android-start.ts's (runStart); what the refusal means for a
 * launch, and how to recover, is said here.
 *
 * A deliberate exception: the two messages below name
 * averi.yaml's `app.android.activity`, the flow step's `activity:` and the
 * `launch_app` tool — the first error strings in adapters/ to speak config
 * and tool vocabulary rather than platform only (the monkey launch's message
 * in `launch` does the same). Kept, because that advice is
 * what makes the message recoverable: the reader's next move is in
 * averi.yaml or in the call, not in adb. Rejected: a typed AmStartError
 * thrown here and translated by the callers — there are two (run/ for
 * launch_app, flow/ for the launch step), so one message would have two
 * translation sites that must agree. No import crosses the layer — only
 * words do.
 *
 * Why a launch is checked at all: `adb()` only rejects on a
 * non-zero exit, so a launch am refused at exit 0 "succeeded", and the
 * failure surfaced one step later as a wait that timed out on whatever
 * screen happened to be up — far from its cause. With intents scoped to the
 * package "no activity handles this" became an ordinary outcome of a typo'd
 * action or a missing intent filter; the explicit-activity launch (a
 * misspelt `app.android.activity`) had the same silent failure.
 */
function launchRefused(refused: StartRefused, launch: LaunchTarget): Error {
  const { packageName, component, intent } = launch;
  const said = startSaid(refused);
  if (component !== undefined) {
    // The component's own package: an activity given as a full
    // "other.pkg/Activity" names a package that is not `packageName`.
    return new Error(
      `Could not start ${component} — check the activity name (the launch's \`activity\`, or ` +
        `${ACTIVITY_IN_CONFIG}), that the activity is exported, and that ` +
        `${component.split('/')[0]} is installed. ${said}`,
      causeOf(refused),
    );
  }
  // True for every cause am reports, not only "unable to resolve": a
  // matching activity may exist and have refused (SecurityException "not
  // exported from uid", "you do not have permission to access it", "Not
  // allowed to start activity"), so the message does not claim that none
  // handles the intent — it says nothing started, and lets am's line decide.
  return new Error(
    `Android started no activity in ${packageName} for this intent (${describeIntent(intent ?? {})}) — an ` +
      `intent without an activity is delivered within the app's package. Either no exported activity there ` +
      `declares a matching <intent-filter> (with category DEFAULT), or the one that does refused the launch ` +
      `${REFUSED_BY_ACTIVITY}. Fix the action/mime type or the manifest, ` +
      `or name the activity explicitly: ${NAME_THE_ACTIVITY}. ${said}`,
    causeOf(refused),
  );
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

/**
 * The classes whose type fixes the one axis they scroll on (types.ts#UiNode.scrollAxis): the classic views, and a
 * Compose scroller with no collection info, which the accessibility bridge names `ScrollView` for vertical scroll
 * semantics and `HorizontalScrollView` for horizontal (the lab app's `verticalScroll` forms and lists, measured: 12
 * `scrollable="true"` nodes, all `android.widget.ScrollView`). Not here, so unknown: a lazy list or grid
 * (`LazyColumn` dumps as `android.view.View` — the lab's form picker and sticky list), a RecyclerView (either axis;
 * the dump names no orientation), a ViewPager2.
 */
const AXIS_BY_CLASS: Readonly<Record<string, ScrollAxis>> = {
  ScrollView: 'vertical',
  NestedScrollView: 'vertical',
  ListView: 'vertical',
  GridView: 'vertical',
  HorizontalScrollView: 'horizontal',
  ViewPager: 'horizontal',
};

export class AndroidAdapter implements DeviceAdapter {
  readonly platform = 'android' as const;
  /** One tree (uiautomator), so no kind to report (DeviceAdapter.treeSourceKind). */
  readonly treeSourceKind = undefined;
  /**
   * The soft-keyboard oracle (KeyboardOracle in types.ts): Android is the
   * platform whose keyboard is a separate window that `back` hides, so it is
   * the one adapter that has one. Two device questions behind it, each one
   * adb call with its own budget: keyboardState (`dumpsys window displays`,
   * the frame) and keyboardWitness (`dumpsys input_method`, the input
   * method's own word). Their measured costs are on those two methods.
   * A third, keyboardTouchable (the IME window's touchable
   * region with `mInputShown`, one adb call), asked only once `state()` has
   * read the band up — the floating-Gboard panel.
   */
  readonly keyboard: KeyboardOracle = {
    state: () => this.keyboardState(),
    witness: () => this.keyboardWitness(),
    touchable: () => this.keyboardTouchable(),
  };
  private readonly exec: ExecFn;
  /**
   * The device every call targets, as `adb -s <serial>` — required:
   * listing devices is discovery.ts's, not an adapter's, so there is no
   * unbound adapter, no adb without `-s` (whichever single device adb
   * picked), no "the default adb device" wording and no "more than one
   * device" diagnosis.
   */
  private readonly serial: string;
  /** What the parser asks before widening a node cut short of its content (types.ts#DrawnOverStrip) — required: the composition root wires it. */
  private readonly drawnOverStrip: DrawnOverStrip;

  constructor(opts: { serial: string; exec?: ExecFn; drawnOverStrip: DrawnOverStrip }) {
    this.serial = opts.serial;
    this.exec = opts.exec ?? defaultExec;
    this.drawnOverStrip = opts.drawnOverStrip;
  }

  /**
   * adb itself, for its own subcommands (`install`, `get-state`, `logcat`).
   * NOT for anything the device's shell runs: that is `shell`, `execOut` or
   * `rawShell` below — for `shell` adb joins the arguments with a space for
   * the device's `sh -c` unescaped, so `shell` quotes them (adb-shell.ts);
   * for `exec-out` adb escapes them itself (see execOut).
   */
  private adb(args: string[], opts: AdbCallOptions = {}) {
    return this.runAdb(['-s', this.serial, ...args], opts);
  }

  /** The `adb` binary with a complete argv — `adb` and `shell` both end here. */
  private runAdb(argv: string[], opts: AdbCallOptions) {
    return this.exec('adb', argv, opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : undefined);
  }

  /**
   * `adb shell <argv>`, the argv delivered to the device command word for
   * word: each word quoted for the device's sh by adb-shell.ts,
   * so a deep link's `&`, an extra's space, a typed `$` or `'` reach the
   * command as data and are never run. Every device command in this adapter
   * goes through here, `execOut` (where adb quotes) or `rawShell` — none
   * builds a `shell` argv of its own.
   */
  private shell(argv: readonly string[], opts: AdbCallOptions = {}) {
    return this.runAdb(adbShellArgv(this.serial, argv), opts);
  }

  /**
   * `adb exec-out <argv>` — the same device sh as `shell` (no pty,
   * binary-safe stdout), but adb QUOTES this one itself: the client sends
   * `"exec:" + argv[0] + " " + escape_arg(each further word)`
   * (commandline.cpp, exec-in/exec-out; escape_arg in adb_utils.cpp
   * single-quotes with '\''), whereas for `shell` it joins unescaped. So the
   * argv goes to adb as it is — quoting it here would put literal quotes in
   * the device command's arguments. The one word adb does not escape is the
   * first, the command itself: always a constant here.
   */
  private execOut(argv: readonly string[], opts: AdbCallOptions = {}) {
    return this.adb(['exec-out', ...argv], opts);
  }

  /**
   * `adb shell <line>`, unquoted, for a command whose shell syntax is the point — a
   * pipe, `|| true` — sent as ONE argument and run by the device's sh as
   * written. The named exception to `shell`: the caller owns the line, and
   * any word in it that did not come from this file goes through
   * `shellCommandLine` first (isAppRunning).
   */
  private rawShell(line: string, opts: AdbCallOptions = {}) {
    return this.adb(['shell', line], opts);
  }

  async install(appPath: string): Promise<void> {
    await this.adb(['install', '-r', appPath], { timeoutMs: 120_000 });
  }

  /**
   * Returns once `am start`/monkey has started something — no wait for the
   * tree to be the app's, unlike iOS (ios-foreground.ts). Whether
   * uiautomator hands out the previous app's tree for a moment after a
   * switch, as idb does, has not been measured on Android (it dumps the
   * focused window, which may close the gap or not), so nothing waits here
   * and LaunchOutcome carries no note.
   */
  async launch(packageName: string, opts: LaunchOptions = {}): Promise<LaunchOutcome> {
    // The foreground app changes here, and with it whether the status bar shows: the band is read again
    // (`#band`). Dropped once the launch is over, so a read that started before or during it keeps nothing.
    try {
      return await this.launchApp(packageName, opts);
    } finally {
      this.dropStatusBand();
    }
  }

  /** Forget the status band read so far (`#band`), and keep no answer from a read already in flight. */
  private dropStatusBand(): void {
    this.#band = undefined;
    this.#bandRead = undefined;
    this.#bandEpoch++;
  }

  private async launchApp(packageName: string, opts: LaunchOptions): Promise<LaunchOutcome> {
    if (opts.clearState) await this.shell(['pm', 'clear', packageName]);
    if (opts.activity === undefined && opts.intent === undefined) {
      // monkey resolves the launcher activity for us, but picks ARBITRARILY
      // when the package declares several (LeakCanary adds one in debug
      // builds, so this may open LeakCanary) — set app.android.activity in
      // averi.yaml to pin the entry point.
      const outcome = await runStart(
        ['monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'],
        (argv) => this.shell(argv),
      );
      if (outcome.kind === 'refused') {
        // monkey's reason may be on its stdout, which the ExecError's
        // message drops — read here, or this would fail with no reason at
        // all. Not every reason is the package's: monkey itself may have
        // failed to run (android-start.ts lists its lines), and its line says.
        throw new Error(
          `monkey started nothing in ${packageName} — check that ${packageName} is installed and has a launcher ` +
            `activity, or name the activity to start: ${NAME_THE_ACTIVITY}, or ` +
            `${ACTIVITY_IN_CONFIG} — or monkey itself could not run; its line says which. ` +
            startSaid(outcome),
          causeOf(outcome),
        );
      }
      return {};
    }
    const argv = ['am', 'start'];
    let component: string | undefined;
    if (opts.activity !== undefined) {
      // ".MainActivity" and "com.foo.MainActivity" both resolve against the
      // package; a full "pkg/Activity" component passes through unchanged.
      component = opts.activity.includes('/') ? opts.activity : `${packageName}/${opts.activity}`;
      argv.push('-n', component);
    } else {
      // An intent with no activity is SCOPED TO THE PACKAGE: `-p <package>`
      // is parsed by Intent.parseCommandArgs (it calls setPackage) — the
      // intent-spec parser `am start` shares with `am broadcast` etc.; it is
      // NOT listed in `am help` on every Android version, which is why it is
      // spelled out here. Android resolves it against this app's own intent
      // filters, so it reaches whichever activity handles it — the share
      // target, not the launcher. Never a bare implicit intent (`am start -a
      // ACTION`), which the system may hand to ANOTHER app or answer with a chooser, and a test tool
      // launching "the app" must not end up driving a different one.
      // Never beside `-n`: an explicit component already names the package,
      // and an activity given as a full "other.pkg/Activity" component would
      // contradict a `-p` for this one. The rule for which activity a launch
      // names (and when averi.yaml's applies) is flow/config.ts's
      // resolveLaunchActivity; this is only how the result is said in `am`.
      argv.push('-p', packageName);
    }
    const intent = opts.intent ?? {};
    // Data and extras are the user's (averi.yaml, launch_app) and may hold
    // anything — `&`, spaces, quotes: `shell` delivers each as one word.
    if (intent.action !== undefined) argv.push('-a', intent.action);
    if (intent.data !== undefined) argv.push('-d', intent.data);
    if (intent.mimeType !== undefined) argv.push('-t', intent.mimeType);
    for (const category of intent.categories ?? []) argv.push('-c', category);
    for (const [key, value] of Object.entries(intent.extras ?? {})) argv.push('--es', key, value);
    const outcome = await runStart(argv, (start) => this.shell(start));
    if (outcome.kind === 'refused') throw launchRefused(outcome, { packageName, component, intent: opts.intent });
    return {};
  }

  async terminate(packageName: string): Promise<void> {
    await this.shell(['am', 'force-stop', packageName]);
  }

  async openDeepLink(url: string): Promise<void> {
    // The url as ONE word: the device's sh would cut it at the first `&`
    // (and run the rest), at a space, and expand `$` — adb-shell.ts.
    const outcome = await runStart(
      ['am', 'start', '-a', 'android.intent.action.VIEW', '-d', url],
      (argv) => this.shell(argv),
    );
    if (outcome.kind === 'refused') {
      // A refusal throws: returning would have open_deep_link answer "Opened"
      // for a url nothing handles (am exits 0 — android-start.ts). Worded,
      // like the launch's message, for every cause am reports: a matching
      // activity may exist and have refused.
      throw new Error(
        `Android opened nothing for ${url} — either no installed app has an activity whose intent filter ` +
          `matches it (action VIEW and the url's scheme / host / path), or the one that does refused it ` +
          `${REFUSED_BY_ACTIVITY}. Check the url, and that the app ` +
          `meant to handle it is installed. ${startSaid(outcome)}`,
        causeOf(outcome),
      );
    }
  }

  async screenshot(): Promise<Buffer> {
    const { stdout } = await this.execOut(['screencap', '-p']);
    // exec-out exits 0 with whatever the guest wrote — nothing, or `Killed`,
    // on a dying emulator — so the bytes are judged here (screenshot-bytes.ts).
    return screenshotPng(stdout, {
      device: `device ${this.serial}`,
      command: `adb -s ${this.serial} exec-out screencap -p`,
      remedy: 'Re-check `adb devices` and retry; if it repeats, the emulator, not the app, needs attention.',
    });
  }

  async uiTree(opts: { settle?: boolean } = {}): Promise<UiNode> {
    // Dump to stdout; uiautomator appends a status line after the XML.
    for (let attempt = 0; ; attempt++) {
      let raw: string;
      try {
        raw = (await this.execOut(['uiautomator', 'dump', '/dev/tty'], { timeoutMs: DUMP_TIMEOUT_MS })).stdout.toString('utf8');
      } catch (e) {
        // adb itself failing is the OTHER offline shape (exit 255, "device
        // '<id>' not found" / "device offline"); a dump that never returns is
        // the loaded-host shape (measured on finportal: 11.4 s at load avg
        // 28). Diagnose both like a dump that returned nothing, so the caller
        // never has to read a bare adb error.
        if (e instanceof ExecError) {
          const last = e.stderr.trim().split('\n').pop() ?? '';
          throw new Error(await this.diagnoseDumpFailure(e.timedOut ? 'timeout' : 'exec-error', last, false), { cause: e });
        }
        throw e;
      }
      const xmlEnd = raw.lastIndexOf('>');
      if (xmlEnd !== -1) return parseUiautomatorXml(raw.slice(0, xmlEnd + 1), this.drawnOverStrip);
      const status = raw.trim().slice(0, 200);
      // "null root node" is uiautomator saying the app has no window to dump YET
      // (cold launch, ~2-3 s; mid-animation). The one-shot MCP tools opt into a
      // single bounded retry with `settle`; pollers do NOT —
      // their own poll interval already is the retry, and a hidden extra
      // second per miss would only shrink the number of probes their deadline
      // affords.
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
   * measured on mp-native, an emulator dying underneath
   * answered `Killed`, then an empty string, then `null root node` — and adb
   * itself still exited 0 each time, so the ExecError path never fired. Three
   * calls were spent on uiautomator hypotheses before `adb shell wm size`
   * said `device offline`. `adb get-state` is that one-line discriminator,
   * so run it HERE, after the failure, and lead with what it says. (Spends up
   * to GET_STATE_TIMEOUT_MS of device time — hence "diagnose", not "explain".)
   */
  private async diagnoseDumpFailure(
    kind: 'no-xml' | 'timeout' | 'exec-error',
    status: string,
    retried: boolean,
  ): Promise<string> {
    const dump = kind === 'timeout'
      ? `uiautomator dump timed out after ${formatSeconds(DUMP_TIMEOUT_MS)}`
      : kind === 'exec-error'
        ? `adb could not run uiautomator dump: ${status}`
        : `uiautomator dump returned no XML: ${status}`;
    let state: string;
    try {
      state = (await this.adb(['get-state'], { timeoutMs: GET_STATE_TIMEOUT_MS })).stdout.toString('utf8').trim();
    } catch (e) {
      // A get-state that never answered has no state to quote: its stderr is
      // node's "Command failed: <cmd>" (exec.ts substitutes it for an empty
      // one), and the reply read `adb get-state says "Command failed: …"`
      // What hangs is adb — its server or this device's
      // transport — so say that, and how to tell which.
      if (e instanceof ExecError && e.timedOut) {
        return `device ${this.serial} is not answering: adb get-state timed out after ${formatSeconds(GET_STATE_TIMEOUT_MS)} — ` +
          `the adb server or this device's transport is hung, not the app. Run \`adb devices\`: if it hangs too, ` +
          `\`adb kill-server && adb start-server\`; if only this device is stuck, restart the emulator (or reconnect ` +
          `the USB cable). Not an averi or uiautomator fault. (${dump})`;
      }
      // `adb get-state` on an offline/missing device exits 1 with
      // "error: device offline" / "error: device '<id>' not found" on stderr.
      state = e instanceof ExecError
        ? (e.stderr.trim().replace(/^(Command failed:.*\n)?\s*(error|adb):\s*/s, '') || `exit ${e.exitCode}`)
        : String(e);
    }
    if (state !== 'device') {
      return `device ${this.serial} is not reachable: adb get-state says "${state || 'unknown'}" — ` +
        `recover the device (wait for \`adb devices\` to read \`device\`; \`adb kill-server && adb start-server\` ` +
        `if it does not) before reading its tree. Not an averi or uiautomator fault. (${dump})`;
    }
    if (kind === 'exec-error') {
      return `${dump} — yet adb get-state says "device"; adb itself failed, not the app. Re-check \`adb devices\` and retry once.`;
    }
    if (kind === 'timeout') {
      return `device ${this.serial} is reachable but SLOW: ${dump} while adb get-state says "device" — the host or ` +
        `emulator is under load (measured 2026-09-17: an 11.4 s dump at load avg 28). Not a dead app and not a ` +
        `code defect; ease the load (builds, other emulators) and retry.`;
    }
    if (NULL_ROOT_RE.test(status)) {
      return `device ${this.serial} is still settling: uiautomator has no window to dump yet ` +
        `(cold launch or animation; ${retried ? `retried once after ${formatSeconds(NULL_ROOT_RETRY_MS)}` : 'read once'}). ` +
        `Wait for the screen (\`screenshot\` waits for stability) and retry. (${dump})`;
    }
    return `${dump} — adb get-state says "device", so the dump itself died on the guest ` +
      `(hung or memory-pressured emulator: "Killed" / empty output). Re-check \`adb devices\` and retry; ` +
      `if it repeats, the emulator, not the app, needs attention.`;
  }

  async tap(x: number, y: number): Promise<void> {
    await this.shell(['input', 'tap', String(x), String(y)]);
  }

  /**
   * The screen SIZE: `wm size`, memoized (viewport-memo.ts) — read once per
   * adapter, and again on `viewport({ fresh: true })`. The status band
   * beside it has a lifetime of its own (`#band`, below).
   */
  private readonly viewportMemo = new ViewportMemo(async () => {
    const { stdout } = await this.shell(['wm', 'size']);
    const raw = stdout.toString('utf8');
    // "Physical size: 1080x2280", optionally overridden ("Override size: ...")
    const m = raw.match(/Override size:\s*(\d+)x(\d+)/) ?? raw.match(/Physical size:\s*(\d+)x(\d+)/);
    if (!m) throw new Error(`Cannot parse wm size output: ${raw.slice(0, 120)}`);
    // An Android app window may sit beside a side nav bar or a cutout (types.ts#DeviceScreen).
    return { width: Number(m[1]), height: Number(m[2]), windowsBesideSystemBars: true };
  });

  /**
   * The system bands as last READ: `{ band }` once a
   * `dumpsys window displays` call answered — `band` holding each band that
   * dump said (none for a bar it did not show as one visible band) — and
   * undefined while there is no such answer to keep. Its lifetime, the
   * choice stated: the registry keeps ONE adapter
   * per device for the MCP server's life (mcp/registry.ts), so whatever is
   * kept here is kept that long unless something drops it.
   * - A call that FAILED FAST (adb exited non-zero, could not be spawned)
   *   is not an answer: nothing is kept, and the next `viewport()` asks
   *   again — until one answers (kept as "no band", a failed first read
   *   would let a tap under the bar through for the server's life). Retried
   *   every call, by choice: such a failure costs
   *   milliseconds (adb answers at once), and it is the transient kind — a
   *   device reconnecting, an adb server restarting — whose next call
   *   answers. Each such call judges with no band (fail open).
   * - A call that TIMED OUT (its 2 s budget: a cold or loaded device, a
   *   hung dumpsys) is kept as "no band" (`timedOut`), so it is not paid
   *   again: retried every call, it cost up to 2 s more on each `viewport()`
   *   — a tap made two such calls, a two-swipe `scroll_until` seven.
   *   Dropped like an answer, below: the
   *   next `launch` or fresh read asks again. Until then no band (fail
   *   open).
   * - An answer is dropped by `launch` — the foreground app changes there,
   *   and with it whether the bar shows (an immersive app hides it) — and
   *   replaced by `viewport({ fresh: true })`: the tap's refusal path
   *   (tap-judgement.ts#judgeTap) and the window witness (verify/
   *   capture.ts). Otherwise it is kept: read per call, it would cost one
   *   adb call (18–37 ms through execFile, keyboardState's figures) on every
   *   `viewport()`, where the keyboard guard already spends one.
   * What that leaves, stated — a bar the app shows or hides WITHOUT a
   * launch (a video going full screen, an app opened from another by an
   * intent, the user's own navigation):
   * - HIDDEN since the read: the band is stale, so a point in the top of the
   *   screen is judged off it. A tap there is refused only after the refusal
   *   path's fresh read, which sees the bar gone and taps — the tap is right;
   *   `scroll_until` keeps the stale band, so it strokes on, or fails naming
   *   the status bar, for a target the app shows at the very top — a
   *   refusal, never a false "visible";
   * - SHOWN since an answer that found none: no band until the next launch
   *   or fresh read — a point under the bar is judged on the screen, as
   *   before the band existed (fail open).
   * And a launch's own: the band is read at the first `viewport()` after
   * `launch`, which may come right after it — while the app's STARTING
   * window shows, before an app that hides the bar in onCreate (or later)
   * has hidden it. The band then read is the starting window's bar: stale
   * as above, so it errs toward a refusal (the tap's fresh re-read corrects
   * it; `scroll_until` keeps it).
   *
   * Why this memo is written out beside `viewportMemo` rather than folded
   * into ViewportMemo (weighed and left): an
   * invalidate hook for `launch` would be clean — ViewportMemo's identity
   * check (`#pending === attempt`) already keeps a superseded read from
   * landing, so a `forget()` would do what `#bandEpoch` does — and the
   * three outcomes could be mapped onto it (a timeout resolved as none and
   * kept, a fast failure rejected and dropped, the caller catching it). What
   * does not map is a FRESH read: here the last answer stands until the
   * fresh read settles — a concurrent plain `viewport()` is answered from it
   * meanwhile, and a fresh read that fails fast leaves it kept — where
   * ViewportMemo's fresh read becomes the memo at once and a failed one
   * empties it (types.ts#viewport's contract, both adapters' sizes). Folding
   * would change one of the two: the band's lifetime stated above, or the
   * size's on iOS and Android. Neither is this refactor's to change.
   */
  #band: { band: SystemBands; timedOut?: true } | undefined;
  /** The band read in flight, shared by concurrent `viewport()` calls. */
  #bandRead: Promise<SystemBands> | undefined;
  /** Bumped by `launch`: a read that started before it does not keep its answer. */
  #bandEpoch = 0;

  /**
   * The VISIBLE system status bar's height (types.ts#DeviceScreen.statusBand):
   * `dumpsys window displays`, read by parseStatusBand below —
   * the call keyboardState makes, whose cost is written there. An app that
   * draws edge-to-edge (Google Contacts, measured: its list and its
   * collapsing app bar start at y 0) has nodes under the bar, and a tap on
   * one goes to the bar. Reported whatever the app: in an app that does not
   * draw under the bar no node lies in the band, so it changes nothing there.
   * docs/bugs/2026-10-10-android-tap-and-scroll-until-treat-the-system-status-bar-as-app-screen.md
   *
   * FAILS OPEN, as keyboardState does: a failed call, or a dump that does not
   * say one visible bar, is no band — the judgements behave as before the
   * band existed. Kept or not as `#band` says. The size's own failure is
   * still the screen's.
   *
   * The navigation bar's band (types.ts#DeviceScreen.navigationBand) comes
   * out of the same dump, parseNavigationBand below, and is kept with the
   * status band: one call, one lifetime.
   */
  private systemBands(fresh: boolean): Promise<SystemBands> {
    if (!fresh && this.#band !== undefined) return Promise.resolve(this.#band.band);
    if (!fresh && this.#bandRead !== undefined) return this.#bandRead;
    const epoch = this.#bandEpoch;
    const read = (async () => {
      try {
        const dump = (await this.shell(['dumpsys', 'window', 'displays'], { timeoutMs: STATUS_BAND_QUERY_TIMEOUT_MS })).stdout.toString('utf8');
        const status = parseStatusBand(dump);
        const navigation = parseNavigationBand(dump);
        const band: SystemBands = { ...(status !== undefined && { statusBand: status }), ...(navigation !== undefined && { navigationBand: navigation }) };
        if (epoch === this.#bandEpoch) this.#band = { band };
        return band;
      } catch (e) {
        // A timeout is kept as no band until a launch or a fresh read (`#band`); any other failure keeps nothing.
        if (e instanceof ExecError && e.timedOut && epoch === this.#bandEpoch) this.#band = { band: {}, timedOut: true };
        return {};
      }
    })().finally(() => {
      if (this.#bandRead === read) this.#bandRead = undefined;
    });
    this.#bandRead = read;
    return read;
  }

  /**
   * Screen size in device pixels — the units uiautomator bounds use — and
   * the system bands (the status bar's, the navigation bar's). The size is
   * memoized (types.ts#viewport); the bands are read after it, kept as
   * `#band` says. `fresh` reads both again.
   */
  async viewport(opts?: { fresh?: boolean }): Promise<DeviceScreen> {
    const size = await this.viewportMemo.get(opts);
    return { ...size, ...(await this.systemBands(opts?.fresh === true)) };
  }

  async longPress(x: number, y: number, durationMs = 800): Promise<void> {
    await this.shell(['input', 'swipe',
      String(x), String(y), String(x), String(y), String(durationMs)]);
  }

  /**
   * 0.45 screens a second — 999 px/s on the Pixel_3a's 2220-px side, 364
   * dp/s at its 2.75 density (types.ts#DeviceAdapter.dragSpeed).
   * docs/bugs/2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md
   *
   * Measured: `input swipe 540 1776 540 444 300` — 1332 px in 300 ms, 4440
   * px/s — moved Settings' RecyclerView ≈ 2190 px, more than its 1417-px
   * height plus a 198-px row, so a row could pass from below the list to
   * above it between two reads (a quarter of Settings' rows were in no
   * read); a 500-px swipe over 1500 ms (333 px/s) moved it 485 px. `input
   * swipe` moves the finger at one speed and lifts, so the lift speed is the
   * average. AOSP's OverScroller spline (DECELERATION_RATE ln 0.78 / ln 0.9,
   * INFLEXION 0.35, friction 0.015, gravity × 39.37 in/m × 160·density ppi
   * × 0.84) gives a fling of 2140·(0.35·v/2140)^1.736 px at the Pixel_3a's
   * density: ≈ 1230 px at 4440 px/s (measured ≈ 860 past the finger's
   * travel), ≈ 14 at 333 (measured ≈ 7 past the travel less the 22-px
   * slop) — the model overestimates, the safe way — and ≈ 90 px at 999
   * px/s, under half a 143–198 px row. In SCREENS per second, not px, so a
   * lower-density screen (fewer px for the same inches) gets a slower px
   * speed, roughly the same dp speed: the fling is computed in px from a
   * px/s velocity scaled by ppi, so the same dp speed flings about the same
   * dp. Not measured beyond the two points above; one emulator, one density.
   *
   * Cost, stated (the `scroll_until` default budget stays 15 s): a stroke
   * takes length ÷ 999 px/s instead of 300 ms — the screen stroke 1332 px
   * 1.33 s (+1.03 s), Settings' list stroke 850 px 0.85 s (+0.55 s), the
   * SWIFT form's 1042 px 1.04 s (+0.74 s), a probe or a halved stroke
   * floored at 300 ms (+0) — so the 6 default swipes cost up to ≈ 6 s more
   * of the 15 s, where the measured fling runs spent ≈ 3 s a round; and a
   * stroke now moves the content ≈ its own length, not ≈ 1.6×, so content
   * far below the fold takes more strokes. What it buys: no row is carried
   * across the list between two reads.
   *
   * NET, in one place: within the unchanged
   * 15 s default, Settings' list is reached about 40 % less far — the
   * measured fling runs fit 5 rounds of ≈ 3 s, ≈ 5 × 1332 ≈ 6700 px of
   * finger travel (≈ 6800 px of content once flung, rows skipped); now ≈ 4
   * rounds of ≈ 3.5 s, each ≈ 850 px over the list plus ≈ 90 of fling,
   * ≈ 3950 px, every row read. And the deadline is checked once a round,
   * before the stroke, so the last round can overrun `timeoutMs` by a
   * stroke (up to ≈ 1.33 s, the full-screen one), a settle (400 ms) and a
   * tree read.
   */
  readonly dragSpeed = 0.45;
  /** `input text` hands keys to the IME's queue, which may still deliver them after the call (types.ts#TypingDelivery). */
  readonly typingDelivery = 'may-arrive-late' as const;

  async swipe(from: Point, to: Point, durationMs = 300): Promise<void> {
    await this.shell(['input', 'swipe',
      String(from.x), String(from.y), String(to.x), String(to.y), String(durationMs)]);
  }

  async typeText(text: string): Promise<void> {
    // "" types nothing (the DeviceAdapter.typeText contract), on this side
    // too: the loop below already ran zero times for it, but the commit
    // nudge after it — two key events and a sleep for a composition that
    // does not exist — would still go to the device, and the contract's
    // "types nothing" would be false of it.
    if (text === '') return;
    // One `input text` call PER CHARACTER, with explicit pacing. Bulk injection
    // races Compose's async text state and silently drops most characters
    // (measured on the login username field: 3 of 11 landed). The adb
    // round-trip alone is NOT enough pacing on a loaded emulator — re-measured
    // the same evening after hours of uptime: per-char with no delay landed 5 of
    // 8, per-char with 300ms landed 8/8. 250ms keeps a 12-char value at ~3s.
    //
    // Each character is one quoted `shell` word; a space is `input text`'s
    // own `%s`; a control character is refused up front — by interact/
    // first (type-text.ts), here again defensively — see adb-shell.ts.
    // Defensive only: it stops a caller that bypasses interact/. The
    // character set and the words are input-text.ts's, shared with
    // type-text.ts.
    const control = text.match(CONTROL_CHAR_RE);
    if (control !== null) {
      const ch = control[0];
      throw new Error(
        `typeText cannot type ${JSON.stringify(ch)} on Android: \`input text\` ${inputTextControlFate(ch)}. ${controlCharRemedy(ch)}`,
      );
    }
    for (const ch of text) {
      await this.shell(['input', 'text', ch === ' ' ? '%s' : ch]);
      await sleep(250);
    }
    // Force the IME to COMMIT the final composing character: GBoard holds the
    // last injected char in a composition span for seconds, and a BACK or a
    // focus-moving tap discards it — a fixed post-type sleep (tried 500ms) is
    // NOT enough. Moving the cursor left and back right commits the span
    // deterministically (measured: verified-8/submitted-7 with the
    // sleep; 8/8 submitted with the cursor nudge even when BACK follows
    // immediately).
    await this.shell(['input', 'keyevent', '21']); // DPAD_LEFT
    await this.shell(['input', 'keyevent', '22']); // DPAD_RIGHT
    await sleep(150);
  }

  async pressKey(key: Key): Promise<void> {
    await this.shell(['input', 'keyevent', KEYCODES[key]]);
  }

  /**
   * Is the soft keyboard (IME) shown, and which screen rect does it cover?
   * One adb call: `dumpsys window displays`, read by parseImeInsets below.
   *
   * Why that command — measured on emulator-5554 (Pixel_3a, API
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
   * THE COST OF THIS CALL — the one place the figures live;
   * every other comment and ARCHITECTURE.md §8 point here:
   *   - from a shell (the table above; process start included): 56–96 ms;
   *   - through this adapter's execFile, eleven runs: 18–37 ms.
   *
   * `displays` is the one that yields "shown" AND the frame from a single
   * line, in a format that is the same line on API 36 (40 ms, 11.7 KB there).
   * Rejected: `dumpsys input_method | grep mInputShown` plus a second call
   * for the frame (two calls, the first alone ~300 ms); the IME window's
   * touchable region (an SkRegion string whose shape differs with a floating
   * or split keyboard, and present while hidden too, as the nav-bar strip)
   * — rejected as THE frame, still; it is read BESIDE this
   * one, only once this has said shown, for a floating keyboard's panel
   * (keyboardTouchable, below).
   *
   * The inset's top is the docked keyboard's line, and the right one —
   * measured with Gboard docked (1080x2220): `dumpsys window InputMethod`'s
   * touchable region (the one keyboardTouchable reads) started at 1398, the
   * top of the ITYPE_IME frame measured docked before (`frame=[0,1398]
   * [1080,2220]`, below; this probe did not capture the frame); `dumpsys
   * input_method`'s `touchableRegion` started at 1332, over Gboard's
   * transparent top strip. A guarded tap on a field centred in that strip
   * judged it clear of the keyboard, pressed no back, sent `input tap 540
   * 1367`, and the field took focus — the strip routes to the app, so 1332
   * would be the wrong line.
   *
   * FAILS OPEN: any failure of the call — adb exit, timeout, offline device —
   * is `unknown`, not a throw. This question exists to make a tap safer; it
   * must never be the reason a tap did not happen. A device that is really
   * gone fails the tap itself one call later, in the tap's own words.
   */
  private async keyboardState(): Promise<SoftKeyboard> {
    let dump: string;
    try {
      dump = (await this.shell(['dumpsys', 'window', 'displays'], { timeoutMs: KEYBOARD_QUERY_TIMEOUT_MS })).stdout.toString('utf8');
    } catch {
      return { state: 'unknown' };
    }
    return parseImeInsets(dump);
  }

  /**
   * The independent witness: what the input method manager
   * itself says — `mInputShown=true|false` in `dumpsys input_method` — as
   * opposed to the window manager's insets that keyboardState reads.
   *
   * Why a second source. Measured on the Pixel_3a AVD (API 33), right
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
   * the one place the figures live (measured on emulator-5554,
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
   * (written with no adb access) — the timings above are of the
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
        await this.rawShell(INPUT_SHOWN_COMMAND, { timeoutMs: KEYBOARD_WITNESS_TIMEOUT_MS })
      ).stdout.toString('utf8');
    } catch {
      return 'unknown';
    }
    return parseInputShown(out);
  }

  /**
   * The IME window's touchable region, and `mInputShown` beside it, in ONE
   * adb call (the floating-Gboard device check, the three "Device check"
   * sections of the bug note below; emulator-5554, API 33, 1080x2220). Why: a
   * floating Gboard keeps an IME inset of only its 132-px collapse strip
   * (`ITYPE_IME frame=[0,2088][1080,2220] visible=true`), so keyboardState's
   * band missed the panel drawn at x 359–1040, y 1269–1912 — a guarded tap on
   * a field there pressed Gboard's `d` key, and `scroll_until … fully` called
   * a row behind it "fully visible after 0 swipes". The panel is in
   * `dumpsys window InputMethod` only, as a second rect of
   *   touchable region=SkRegion((359,1269,1040,1912)(0,2088,1080,2220))
   * Docked, the region was one rect equal to the band (`SkRegion((0,1398,1080,2220))`).
   * Hidden, it was NOT empty (`SkRegion((0,2088,1080,2220))`), and after a
   * landscape keyboard it was stale, in landscape coordinates, back in
   * portrait (`SkRegion((0,948,2220,1080))`) — which is why this is read only
   * once `state()` said shown, why `mInputShown` comes from the same call
   * (the two are of one moment), and why what counts is decided by
   * ui-tree/keyboard-cover.ts#panelsBeyond, not here.
   *
   * Cost: one adb call running two filtered dumpsys commands on the device
   * (TOUCHABLE_COMMAND) — UNMEASURED as one command (written with no adb
   * access); its parts were measured from a shell at 20–32 ms
   * (`dumpsys input_method | grep -m1 mInputShown`, keyboardWitness) and
   * 76–83 ms (`dumpsys window InputMethod`, the table on keyboardState). Asked
   * per keyboard READ that finds the band up (the tap guard's looks, a pixel
   * poll round, a scroll_until round), never while the keyboard reads hidden
   * or unknown. `; true` ends the line so a grep that matched nothing does not
   * fail the call: the other half is still read.
   *
   * Never throws: a failed or timed-out call is `{ witness: 'unknown',
   * region: undefined }` — no panel, the band alone.
   * docs/bugs/2026-10-05-android-floating-gboard-keyboard.md
   */
  private async keyboardTouchable(): Promise<KeyboardTouchable> {
    let out: string;
    try {
      out = (await this.rawShell(TOUCHABLE_COMMAND, { timeoutMs: KEYBOARD_QUERY_TIMEOUT_MS })).stdout.toString('utf8');
    } catch {
      return { witness: 'unknown', region: undefined };
    }
    return { witness: parseInputShown(out), region: parseTouchableRegion(out) };
  }

  async clearText(count: number): Promise<void> {
    if (count <= 0) return;
    // One keyevent per adb call: batched multi-keycode calls drop events in
    // the IME queue (measured: `input keyevent 67 67 67 67` on
    // the amount field landed only 3 of 4). MOVE_END first, then backspaces;
    // a forward-delete pass cleans up in case the cursor did not move.
    await this.shell(['input', 'keyevent', '123']); // KEYCODE_MOVE_END
    for (let i = 0; i < count; i++) await this.shell(['input', 'keyevent', '67']); // DEL
    for (let i = 0; i < count; i++) await this.shell(['input', 'keyevent', '112']); // FORWARD_DEL
  }

  async isAppRunning(packageName: string): Promise<boolean> {
    // `|| true` makes the device shell exit 0 whether or not a process matched,
    // so an EMPTY stdout is the one "not running" signal and any ExecError is
    // the TRANSPORT failing — adb timing out under host load, the device
    // offline — i.e. a question that could not be asked, never a dead app
    // (measured on finportal: a timed-out adb call here became
    // `appAlive: false` for an app alive on the expected screen). The exit code
    // cannot carry that distinction: exec.ts substitutes err.message when
    // stderr is empty, so ExecError.stderr is never blank.
    //
    // rawShell (the `||` is the point), the name quoted into it — see adb-shell.ts.
    const { stdout } = await this.rawShell(`${shellCommandLine(['pidof', packageName])} || true`);
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
 * A `rawShell` line (the adapter's named exception to quoted argv, adb-shell.ts):
 * ONE argument for `adb shell`, run by the device's sh as written, so the
 * pipe runs on the device. Every word in it is a constant that needs no
 * quoting.
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

/**
 * keyboardTouchable's one `rawShell` line: the witness's own filtered read,
 * then every `touchable region=` line of the IME window's dump (no `-m1`:
 * two that disagree must be seen, parseTouchableRegion reads them as none),
 * then `true`, so a grep that matched nothing does not fail the call. Every
 * word a constant.
 */
const TOUCHABLE_COMMAND = `${INPUT_SHOWN_COMMAND}; dumpsys window InputMethod | grep -F 'touchable region='; true`;

/** `touchable region=SkRegion(<rects>)` — the whole line's value, the rects read by TOUCHABLE_RECT_RE. */
const TOUCHABLE_REGION_RE = /(?:^|\s)touchable region=SkRegion\(((?:\s*\(\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\s*\))*)\s*\)/;
/** One `(l,t,r,b)` of an SkRegion. */
const TOUCHABLE_RECT_RE = /\(\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g;

/**
 * The IME window's touchable region out of (a grep of) `dumpsys window
 * InputMethod`. The shape, measured on API 33:
 *   touchable region=SkRegion((359,1269,1040,1912)(0,2088,1080,2220))   floating Gboard
 *   touchable region=SkRegion((0,1398,1080,2220))                       docked
 * — Skia's region as `(left,top,right,bottom)` per rect, any number of them,
 * in screen pixels (uiautomator's units). Read as rects `{x, y, width,
 * height}`; whitespace between the numbers and groups is tolerated. Never
 * guessed: no such line, a line whose region is not wholly `(l,t,r,b)`
 * groups (a different notation, a truncated dump), a rect with right < left
 * or bottom < top, or several lines that do not all say the same thing →
 * `undefined`, and the caller reads no panel (the band alone, as before the
 * question existed). `SkRegion()` — an empty region — is `[]`.
 */
export function parseTouchableRegion(out: string): readonly Rect[] | undefined {
  const lines = out.split('\n').filter((line) => line.includes('touchable region='));
  if (lines.length === 0) return undefined;
  const bodies = new Set<string>();
  for (const line of lines) {
    const body = line.match(TOUCHABLE_REGION_RE)?.[1];
    if (body === undefined) return undefined;
    bodies.add(body.replace(/\s+/g, ''));
  }
  if (bodies.size !== 1) return undefined;
  const [body] = bodies;
  const rects: Rect[] = [];
  for (const [, l, t, r, b] of body.matchAll(TOUCHABLE_RECT_RE)) {
    const [left, top, right, bottom] = [l, t, r, b].map(Number);
    if (right < left || bottom < top) return undefined;
    rects.push({ x: left, y: top, width: right - left, height: bottom - top });
  }
  return rects;
}

/** One `InsetsSource …` entry of a display's InsetsState, as `dumpsys window displays` lists it. */
const INSETS_SOURCE_LINE_RE = /^[ \t]*InsetsSource (.*)$/gm;
/** The IME's insets type: `ITYPE_IME` up to Android 13, `ime` (WindowInsets.Type.toString) from 14. */
const IME_INSETS_TYPES = new Set(['ITYPE_IME', 'ime']);
/** The status bar's insets type: `ITYPE_STATUS_BAR` up to Android 13, `statusBars` from 14 (both in the real dumps, tests/fixtures). */
const STATUS_BAR_INSETS_TYPES = new Set(['ITYPE_STATUS_BAR', 'statusBars']);
/** The navigation bar's insets type: `ITYPE_NAVIGATION_BAR` up to Android 13 (in the real dumps, tests/fixtures), `navigationBars` from 14. */
const NAVIGATION_BAR_INSETS_TYPES = new Set(['ITYPE_NAVIGATION_BAR', 'navigationBars']);
/** A display's size and rotation as `dumpsys window displays` lists it, one line a display: `DisplayFrames w=1080 h=2220 r=0` (API 33 and 36 alike, tests/fixtures). */
const DISPLAY_FRAMES_RE = /^[ \t]*DisplayFrames w=(\d+) h=(\d+) r=(\d+)[ \t]*$/gm;
/**
 * A screen rect as Android prints it everywhere — `[l,t][r,b]`, in a
 * uiautomator `bounds` attribute and in an InsetsSource `frame=` alike. ONE
 * pattern for both readers, so parseImeInsets keeps no second copy to test
 * "is this a frame" before parseBounds reads it.
 */
const BOUNDS_PATTERN = String.raw`\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]`;
const BOUNDS_RE = new RegExp(BOUNDS_PATTERN);
/**
 * The three tokens of an InsetsSource entry parseImeInsets reads. Each is anchored on BOTH sides — a token starts the entry or
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
 *   API 33, shown   (measured on the emulator, Settings search):
 *     InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220] visibleFrame=[0,1398][1080,2220] visible=true insetsRoundedCornerFrame=false
 *   API 33, hidden  (same device):
 *     InsetsSource type=ITYPE_IME frame=[0,0][0,0] visibleFrame=[0,2088][1080,2220] visible=false insetsRoundedCornerFrame=false
 *   API 33, ~0.4 s after `back` hid it (the hide animation still running):
 *     InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220] visibleFrame=[0,1398][1080,2220] visible=false insetsRoundedCornerFrame=false
 *   API 36, a booted device that has not shown a keyboard yet (measured):
 *   NO ime entry — the list holds only
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
 * The second witness: DisplayPolicy's `mIsImeShowing=<bool>` line,
 * printed in the same dump. Measured:
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

/**
 * The VISIBLE system status bar's height, in screen pixels, out of `dumpsys
 * window displays` — the band at the top of the screen a tap
 * goes to the bar in (types.ts#DeviceScreen.statusBand). The line it reads
 * is the display's InsetsState entry for the status bar, the same list
 * parseImeInsets reads (and with the same anchored tokens):
 *
 *   API 33 (tests/fixtures/dumpsys-window-displays-api33-*.txt, emulator
 *   Pixel_3a, 1080x2220; a device check read the same line under Google
 *   Contacts):
 *     InsetsSource type=ITYPE_STATUS_BAR frame=[0,0][1080,66] visible=true insetsRoundedCornerFrame=false
 *   API 36 (…-api36-no-ime-source.txt, Pixel_4 AVD, 1080x2280):
 *     InsetsSource id=ab460000 type=statusBars frame=[0,0][1080,66] visible=true flags= sideHint=TOP boundingRects=null
 *
 * The band is the frame's BOTTOM, of a frame that starts at the screen's
 * top and is not empty. Not measured: a hidden bar (an immersive app) —
 * read by `visible=false`, as a hidden keyboard is, so no band; a
 * landscape screen, whose bar is still at the top (no band is cut in
 * landscape — a residual of ui-tree/standing.ts#Scene).
 *
 * Never guesses — no band (the judgements fail open) on: no status-bar entry; one that does not read fully (type, frame,
 * visible); a hidden one; an empty frame or one below the top; several
 * entries (one per display) that do not all say the same band — the
 * multi-display case parseImeInsets refuses alike.
 */
export function parseStatusBand(dump: string): number | undefined {
  /** What each status-bar entry says: its band, or 'none' (hidden, unread, empty, not at the top). */
  const entries = new Set<number | 'none'>();
  for (const [, body] of dump.matchAll(INSETS_SOURCE_LINE_RE)) {
    const type = body.match(INSETS_TYPE_RE)?.[1];
    if (type === undefined || !STATUS_BAR_INSETS_TYPES.has(type)) continue;
    const frame = body.match(INSETS_FRAME_RE)?.[1];
    const visible = body.match(INSETS_VISIBLE_RE)?.[1];
    const rect = frame === undefined ? undefined : parseBounds(frame);
    entries.add(rect === undefined || visible !== 'true' || rect.y !== 0 || rect.width <= 0 || rect.height <= 0 ? 'none' : rect.height);
  }
  const [band] = entries;
  return entries.size === 1 && band !== 'none' ? band : undefined;
}

/** The bands `dumpsys window displays` gives the screen (types.ts#DeviceScreen): the status bar's height, the navigation bar's top. */
type SystemBands = Pick<DeviceScreen, 'statusBand' | 'navigationBand'>;

/**
 * The VISIBLE navigation bar's TOP, in screen pixels, out of `dumpsys window
 * displays` (types.ts#DeviceScreen.navigationBand) — the band at the bottom
 * of the screen held upright that is the system's, not the app's. The line
 * it reads is the display's InsetsState entry for the navigation bar,
 * beside the status bar's (parseStatusBand: the same anchored tokens, the
 * same refusals):
 *
 *   API 33 (tests/fixtures/dumpsys-window-displays-api33-*.txt, emulator
 *   Pixel_3a, 1080x2220, gesture navigation):
 *     DisplayFrames w=1080 h=2220 r=0
 *     InsetsSource type=ITYPE_NAVIGATION_BAR frame=[0,2154][1080,2220] visible=true insetsRoundedCornerFrame=false
 *   API 34+: `type=navigationBars` (WindowInsets.Type.toString), unmeasured —
 *   the API 36 fixture lists no navigation-bar entry at all.
 *
 * The bottom is the display's own, read from the same dump: its
 * `DisplayFrames w=… h=… r=…` line, the size the insets frames are laid out
 * in. The band is the frame's TOP, of a frame that spans the display's
 * width from x 0, starts below the top, is wider than it is tall and ENDS
 * AT THE BOTTOM (`h`) — a bar at the left or right side, or one the width
 * of half the display, is no bottom band. Only on a display in its natural
 * rotation (`r=0`) that is itself portrait (`w <= h`): a turned display
 * (landscape, where 3-button navigation moves the bar to a side) has no
 * band, and neither has a display whose natural rotation is landscape (a
 * tablet, `w=2560 h=1600 r=0`) — its band, kept with the status band until
 * a launch or a fresh read, would be applied to the turned portrait box
 * after a rotation: `scroll_until`'s stop would refuse every centre from
 * 1504 down (the tap's refusal reads the bands again first). So a band, when
 * there is one, is always the portrait screen's own: the only portrait box
 * of that device. Portrait phones only, a residual. Never
 * guesses — no band on: no entry; one that does not read fully (type,
 * frame, visible); a hidden one (an immersive app); a frame of any other
 * shape; no DisplayFrames line, or several that do not all say the same
 * size; several entries that do not all say the same band.
 */
export function parseNavigationBand(dump: string): number | undefined {
  const frames = [...dump.matchAll(DISPLAY_FRAMES_RE)];
  if (new Set(frames.map(([line]) => line.trim())).size !== 1) return undefined; // none, or displays of different sizes
  const [, w, h, r] = frames[0].map(Number);
  if (r !== 0 || w > h) return undefined;
  /** What each navigation-bar entry says: its top, or 'none' (hidden, unread, or not a bar across the display's bottom). */
  const entries = new Set<number | 'none'>();
  for (const [, body] of dump.matchAll(INSETS_SOURCE_LINE_RE)) {
    const type = body.match(INSETS_TYPE_RE)?.[1];
    if (type === undefined || !NAVIGATION_BAR_INSETS_TYPES.has(type)) continue;
    const frame = body.match(INSETS_FRAME_RE)?.[1];
    const visible = body.match(INSETS_VISIBLE_RE)?.[1];
    const rect = frame === undefined ? undefined : parseBounds(frame);
    const acrossTheBottom = rect !== undefined && rect.x === 0 && rect.width === w && rect.y > 0 && rect.y + rect.height === h && rect.height > 0 && rect.height < rect.width;
    entries.add(rect === undefined || visible !== 'true' || !acrossTheBottom ? 'none' : rect.y);
  }
  const [band] = entries;
  return entries.size === 1 && band !== 'none' ? band : undefined;
}

interface RawNode {
  class?: string;
  'resource-id'?: string;
  text?: string;
  /** Not in the API 33 dump (measured); read when a newer one carries it — see normalizeNode. */
  hint?: string;
  'content-desc'?: string;
  focusable?: string;
  'long-clickable'?: string;
  /** "true" on a node that takes a click — read only for a sheet's scrim (`presentedWindow`). */
  clickable?: string;
  /** "true" on a node that scrolls now — its descendants' bounds are clipped to it (types.ts#UiNode.clipsDescendants). */
  scrollable?: string;
  bounds?: string;
  node?: RawNode | RawNode[];
}

/**
 * A uiautomator dump as a normalized tree. `drawnOverStrip` judges whether a
 * node cut short of its own content lies under something drawn there
 * (`widenUnderCovers`) — the UI-tree layer's draw order, handed in
 * (types.ts#DrawnOverStrip).
 */
export function parseUiautomatorXml(xml: string, drawnOverStrip: DrawnOverStrip): UiNode {
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    // uiautomator writes a newline, a tab and every code point beyond the BMP (an emoji) as a numeric character
    // reference (`&#10;`, `&#127482;`); the parser decodes those with the named ones, once — `&amp;#10;` stays `&#10;`.
    // Here, not after parsing: a second pass could not tell an app's literal `&#10;` from a reference. HTML's named
    // entities (`&nbsp;`, `&copy;` …) decode too — harmless, as uiautomator escapes every `&` it does not mean as one.
    htmlEntities: true,
    isArray: (name) => name === 'node',
  }).parse(xml);
  const roots: RawNode[] = parsed.hierarchy?.node ?? [];
  if (roots.length === 0) throw new Error('uiautomator dump contained no nodes');
  // An arrow, not `roots.map(normalizeNode)`: map would hand its index in as `around`.
  const grown = new Map<UiNode, Rect>();
  const children = roots.map((root) => normalizeNode(root, { grown }));
  // The source's marks: Compose lists a control's touch target as its wrapper (types.ts#UiNode.paddedTouchTargets),
  // the dump lists the active window only (`activeWindowOnly`), and that window, when the dump shows it presented, is
  // marked so (`presentation`, `presentedWindow`). Set before the widening: the draw order judging it reads the marks.
  const presented = children.length === 1 ? presentedWindow(roots[0], children[0].rect) : undefined;
  const tree: UiNode =
    children.length === 1
      ? { ...children[0], paddedTouchTargets: true, activeWindowOnly: true, ...(presented !== undefined && { presentation: presented }) }
      : { role: 'container', label: null, identifier: null, value: null, rect: zeroRect(), children, paddedTouchTargets: true, activeWindowOnly: true };
  widenUnderCovers(tree, grown, drawnOverStrip);
  return tree;
}

/**
 * The PRESENTED WINDOW the dump is, when its one window shows it is one (types.ts#UiNode.presentation on the root):
 * `uiautomator dump` lists the active window only (`UiNode.activeWindowOnly`), so with a dialog or a bottom sheet up
 * the dump IS that window and the screen beneath is not in it. Read here, where the raw dump is — the scrim's
 * `clickable` never reaches the normalized tree — as the WDA parser reads WDA's own flags
 * (wda-source.ts#presentedLayers); the presentation module reads the mark (ui-tree/presentation.ts#byMarks,
 * #byUiautomator). The window is asked of each recognizer in `PRESENTED_WINDOWS`, in order; the first that knows it
 * names it.
 * Residuals, stated: a fully expanded Compose sheet dumps no scrim (form-picker's country picker: only the sheet and
 *   its drag handle) and is no presented window here; a floating window against the top or the left edge (a popup at
 *   the top-left corner, a bottom-anchored full-width dialog) and a full-screen dialog (dialog-fullscreen: Compose lays
 *   it between the bars against the left edge, no fact telling it from an app's screen) are none either; an app's own
 *   sheet built without Material's dialog layout is none, nor is Material's `SideSheetDialog` (other ids; unmeasured);
 *   a window offset on both axes that is the app's own — a freeform (desktop-mode) window, a compat-mode app boxed on
 *   both axes — reads as a `dialog`; an app's own clickable, labelled leaf laid from its window's top edge at full
 *   width, with a full-width sibling under it to the bottom, reads as a scrim, and an app's own views it gave
 *   Material's three ids, laid so, as Material's sheet dialog. What a mark changes is asked only for a target the tree
 *   does not hold (presentation.ts#Presentation.topmostAt, #alone), so a misreading costs a refusal, never a false
 *   `Tapped`.
 * docs/bugs/2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md
 */
function presentedWindow(window: RawNode, rect: Rect): 'dialog' | 'screen' | undefined {
  if (rectArea(rect) === 0) return undefined;
  return PRESENTED_WINDOWS.find((r) => r.holds(window, rect))?.as;
}

/** One kind of presented window the dump can show: what it is presented as, and whether this window is one. */
interface PresentedWindowRecognizer {
  as: 'dialog' | 'screen';
  /** `window` the dump's one window, raw; `rect` its bounds as normalized, of some area. */
  holds(window: RawNode, rect: Rect): boolean;
}

/**
 * A window that FLOATS OFF THE SCREEN'S EDGES ON BOTH AXES — its left edge past x 0 AND its top edge past y 0 — is a
 * `dialog`. An app's window lies against at least one of the screen's top and left edges: a phone's full-screen window
 * at 0,0 whatever its bars, and also one offset on ONE axis only — a landscape window beside a cutout the app does not
 * draw into, a letterboxed or pillarboxed compat-mode app on a tablet or a foldable, the lower window of a split
 * screen. A dialog laid in the middle floats off both. Measured: the lab's Compose AlertDialog, `[155,851][925,1368]`
 * on 1080x2220 (alert-dim); a touch outside it dismisses it. Why not "smaller than the screen", the round-5 plan: the
 * parser has no screen size — the adapter's `wm size` is memoized as a pending read (viewport-memo.ts), with no answer
 * to peek at before a tree's first read, and awaiting it would add an adb call before the first dump and make the mark
 * depend on which verb read first.
 */
const floatingDialog: PresentedWindowRecognizer = {
  as: 'dialog',
  holds: (_window, rect) => rect.x > 0 && rect.y > 0,
};

/**
 * A full-screen window whose content lays a SCRIM above a SHEET is a `screen`: some node's child that is clickable,
 * labelled and childless, spanning the window's width from its top edge, followed at once by a sibling spanning the
 * width down to the window's bottom edge from no lower than the scrim's bottom. Measured: the lab's half-expanded
 * Material 3 ModalBottomSheet (sheet-medium), its scrim `content-desc="Close sheet"` `[0,0][1080,1110]`, the sheet
 * `[0,1110][1080,2220]`; a stroke inside the sheet drags it to full height. The label is the guard: an unlabelled
 * full-width clickable leaf over a full-width sibling is common app content (a card's touch layer).
 */
const composeSheetScrim: PresentedWindowRecognizer = {
  as: 'screen',
  holds: (window, rect) =>
    someAdjacentPair(window, (_parent, scrim, sheet) => {
      const s = parseBounds(scrim.bounds);
      const below = parseBounds(sheet.bounds);
      return (
        scrim.clickable === 'true' &&
        emptyToNull(scrim['content-desc']) !== null &&
        childrenOf(scrim).length === 0 &&
        s.x === rect.x && s.width === rect.width && s.y === rect.y && s.height > 0 &&
        below.x === rect.x && below.width === rect.width && below.y + below.height === rect.y + rect.height && below.y > s.y && below.y <= s.y + s.height
      );
    }),
};

/**
 * A Views `BottomSheetDialog` (Material Components' own layout, `design_bottom_sheet_dialog.xml`) is a `screen`: under
 * a `…:id/coordinator`, a clickable, childless `…:id/touch_outside` scrim followed at once by its sibling
 * `…:id/design_bottom_sheet`, the sheet of the scrim's left, width and bottom, its top inside the scrim — at or below
 * the scrim's top (a fully expanded sheet starts where the scrim does; unmeasured). Read by the ids' ENTRIES, never
 * localized (the package is the app's), and against the SCRIM's edges, not the window's: the coordinator fits the
 * system bars. Measured: the lab's sheet over its slots (bottom-sheet-dialog, Material 1.13.0), the window
 * `[0,0][1080,2220]`, `touch_outside` `[0,66][1080,2154]` UNLABELLED (`NAF="true"`), the sheet `[0,1164][1080,2154]`;
 * a touch on the scrim dismisses the sheet. The ids are the guard `composeSheetScrim`'s label is — the scrim rule is
 * not relaxed to unlabelled leaves. A `BottomSheetDialogFragment` lays the same layout (unmeasured).
 * docs/bugs/2026-10-19-lab-android-views-bottom-sheet-dialog-is-no-presented-window-scroll-until-strokes-its-scrim-and-dismisses-it.md
 */
const materialSheetDialog: PresentedWindowRecognizer = {
  as: 'screen',
  holds: (window) =>
    someAdjacentPair(window, (parent, scrim, sheet) => {
      if (idEntry(parent) !== 'coordinator' || idEntry(scrim) !== 'touch_outside' || idEntry(sheet) !== 'design_bottom_sheet') return false;
      const s = parseBounds(scrim.bounds);
      const below = parseBounds(sheet.bounds);
      return (
        scrim.clickable === 'true' &&
        childrenOf(scrim).length === 0 &&
        s.height > 0 &&
        below.x === s.x && below.width === s.width && below.y + below.height === s.y + s.height && below.y >= s.y && below.height > 0
      );
    }),
};

/** The recognizers `presentedWindow` asks, in order. */
const PRESENTED_WINDOWS: readonly PresentedWindowRecognizer[] = [floatingDialog, composeSheetScrim, materialSheetDialog];

const childrenOf = (n: RawNode): RawNode[] => (n.node === undefined ? [] : Array.isArray(n.node) ? n.node : [n.node]);

/** Whether some node of `root`'s subtree has two children, one followed at once by the other, that `pair` accepts. */
function someAdjacentPair(root: RawNode, pair: (parent: RawNode, first: RawNode, next: RawNode) => boolean): boolean {
  const kids = childrenOf(root);
  return kids.some((kid, i) => i + 1 < kids.length && pair(root, kid, kids[i + 1])) || kids.some((kid) => someAdjacentPair(kid, pair));
}

/** A view id's entry name — `touch_outside` of `com.bank.app:id/touch_outside` — or undefined for no `…:id/…` id. */
function idEntry(n: RawNode): string | undefined {
  const id = n['resource-id'] ?? '';
  const at = id.indexOf(':id/');
  return at < 0 ? undefined : id.slice(at + ':id/'.length);
}

/**
 * Where a node lies in the dump: its parent's rect as normalized, and its
 * nearest clipping ancestor's (`UiNode.clipsDescendants`), when it has them;
 * and the dump's `grown` — each node `uncut` would widen, with the rect,
 * applied by `widenUnderCovers` once the whole tree is read.
 */
interface Around {
  parent?: Rect;
  clip?: Rect;
  grown: Map<UiNode, Rect>;
}

function normalizeNode(raw: RawNode, around: Around): UiNode {
  const className = raw.class?.split('.').pop() ?? '';
  const text = emptyToNull(raw.text);
  const contentDesc = emptyToNull(raw['content-desc']);
  const rawChildren = raw.node === undefined ? [] : Array.isArray(raw.node) ? raw.node : [raw.node];
  // Compose text inputs don't always dump as EditText: a BasicTextField with
  // scroll semantics surfaces as (Horizontal)ScrollView carrying the content
  // in `text` (measured on the login username field — value came back
  // null and fill's clear silently no-oped). A focusable AND long-clickable
  // scroll view is a text input; real scroll containers are neither.
  const composeTextInput =
    (className === 'HorizontalScrollView' || className === 'ScrollView') &&
    raw.focusable === 'true' &&
    raw['long-clickable'] === 'true';
  const isTextInput = className.endsWith('EditText') || composeTextInput;
  const { rect, clippedOut } = nodeBounds(raw.bounds, around.parent);
  const clips = raw.scrollable === 'true';
  const children = rawChildren.map((child) => normalizeNode(child, { parent: rect, clip: clips ? rect : around.clip, grown: around.grown }));
  const whole = around.clip === undefined ? undefined : uncut(rect, children, around.clip);
  const node: UiNode = {
    role: isTextInput ? 'textfield' : (ROLE_MAP[className] ?? (rawChildren.length > 0 ? 'container' : 'other')),
    label: contentDesc ?? text,
    // resource-id is "com.example.app:id/login_button" — selectors use the short name
    identifier: emptyToNull(raw['resource-id']?.split('/').pop()),
    value: isTextInput ? text : null,
    rect,
    children,
    // The one fact the role cannot carry: uiautomator has already cut every
    // descendant's bounds to this node (types.ts#UiNode.clipsDescendants —
    // why a flag and not a `scrollable` role for a Compose scroller).
    ...(clips && { clipsDescendants: true as const }),
    // Dumped inverted: wholly outside its container, on this side (types.ts#UiNode.clippedOut).
    ...(clippedOut !== undefined && { clippedOut }),
    // The axis its class fixes (AXIS_BY_CLASS) — never a text input's, whose class is a scroll view's too.
    ...(!isTextInput && AXIS_BY_CLASS[className] !== undefined && { scrollAxis: AXIS_BY_CLASS[className] }),
  };
  // An EMPTY classic EditText dumps its HINT as `text` — AccessibilityNodeInfo
  // .getText() returns the hint while isShowingHintText() — and the API 33
  // dump has no attribute that says so (measured on the Pixel_3a AVD,
  // Android 13: the Contacts editor's `text="Last name"`, the Settings
  // search's `text="Search settings"`, both empty). A dump that
  // DOES name the hint (newer uiautomator builds, the uiautomator2 server's
  // `hint`) hands it to fill as the node's placeholder (UiNode), read
  // opportunistically: no captured dump carries it yet. Compose placeholders
  // are not dumped as text at all (measured), so need none.
  // docs/bugs/2026-10-09-android-clear-reads-edittext-hint-as-content.md
  const hint = isTextInput ? emptyToNull(raw.hint) : null;
  if (hint !== null) node.placeholder = hint;
  if (whole !== undefined) around.grown.set(node, whole);
  return node;
}

/**
 * The node's whole extent when uiautomator cut its bounds short of its own
 * descendants (the bug note below): Compose subtracts what an overlay
 * sibling drawn over a node covers from that node's bounds, and not from
 * its descendants' — mp-native's Account Detail row under its sticky date
 * header (`0,401 1080x79`) dumps as `row_0 66,480 948x66`, its own label
 * and button as `66,403 948x143`, the row's true rect. The cut rect lies
 * whole in the list and clear of the header, so it read "fully visible".
 * Only a CANDIDATE here: `widenUnderCovers` widens it when something is
 * drawn over the strip gained.
 *
 * Only descendants with the node's EXACT x and width count — a row's own
 * label or button, which ARE the row; not a badge or an icon hanging off
 * one side, and not a full-bleed child (a carousel breaking out of a
 * card's padding: counted, it widened the card sideways, and the card's
 * own button no longer spanned it, so its label read covered). And the node grows along y alone, on ONE side: a
 * cut leaves the node's other edge where its descendants' is (row_0's
 * bottom, 546; the rows cut at the tab bar, their tops), while a child
 * overflowing both edges (a touch target, an offset) is no cut. The
 * residual that rule leaves, stated: a node cut
 * at BOTH ends — a tall card between a sticky header and a floating tab
 * bar, dumped `66,480 948x1360` over its own `66,420 948x1480` — is not
 * widened either, and reads whole. Vertical only: every cut measured was a list's row under a bar
 * across it, and no sideways one was seen. The grown rect is cut to the
 * nearest clipping ancestor's, as uiautomator cut the descendants, so a node
 * cut by the list's own edge (or by the display) is not widened past it —
 * the flush probe (interact/scroll-rounds.ts#PROBE_REACH) judges that one —
 * and a node in no clipping container is left as dumped: the overlay cut
 * was measured inside a scroller only. A node with no area (collapsed, or
 * scrolled off) stays so: widening it would make a target of a node the
 * dump says is not shown. Undefined when nothing grows — a control and its
 * padded touch target lie inside their wrapper (measured: wrapper 132,
 * control 110, label 66), so they never widen it.
 * docs/bugs/2026-10-09-android-fully-trusts-row-bounds-cut-at-a-sticky-header.md
 */
function uncut(rect: Rect, children: readonly UiNode[], clip: Rect): Rect | undefined {
  if (rectArea(rect) === 0) return undefined;
  const bottom = rect.y + rect.height;
  let [top, low] = [rect.y, bottom];
  for (const child of children) {
    for (const d of everyNode(child)) {
      if (rectArea(d.rect) === 0 || d.rect.x !== rect.x || d.rect.width !== rect.width) continue;
      [top, low] = [Math.min(top, d.rect.y), Math.max(low, d.rect.y + d.rect.height)];
    }
  }
  // What is gained is cut to the clip; what was dumped stays, even past it (a wrapper Compose dumps overhanging its list).
  [top, low] = [Math.min(rect.y, Math.max(top, clip.y)), Math.max(bottom, Math.min(low, clip.y + clip.height))];
  const grewUp = top < rect.y;
  const grewDown = low > bottom;
  if (grewUp === grewDown) return undefined; // nothing gained, or both sides: overflow, not a cut
  return { ...rect, y: top, height: low - top };
}

/**
 * Widen each `grown` node whose gained strip — the part of the grown rect
 * outside the dumped one — something is drawn over, as draw order's target
 * column judges it for that node (`drawnOverStrip`,
 * types.ts#DrawnOverStrip; what draws is ui-tree/draw-order.ts's
 * `NOT_DRAWN`): the
 * overlay that cut it lies there — row_0's sticky header, the floating tab
 * bar over the rows cut at it. A strip nothing draws over is the node's own
 * overflow, and widening it would make the node overlap what it does not.
 * Judged on
 * the dumped rects, every decision before any is applied; the dumped rect
 * is kept as `cutBounds` (types.ts#UiNode.cutBounds, which states the
 * residual: the next row of the same list is drawn over the strip exactly
 * as a sticky header is).
 */
function widenUnderCovers(tree: UiNode, grown: ReadonlyMap<UiNode, Rect>, drawnOverStrip: DrawnOverStrip): void {
  if (grown.size === 0) return;
  const drawnOver = drawnOverStrip(tree);
  const widen = [...grown].filter(([node, whole]) => {
    const strip: Rect =
      whole.y < node.rect.y ? { ...whole, height: node.rect.y - whole.y } : { ...whole, y: node.rect.y + node.rect.height, height: whole.y + whole.height - (node.rect.y + node.rect.height) };
    return drawnOver(node, strip);
  });
  for (const [node, whole] of widen) {
    node.cutBounds = node.rect;
    node.rect = whole;
  }
}

/**
 * A node's bounds as dumped — unless uiautomator dumped them INVERTED, bottom
 * above top or right left of left (the bug note below: Settings'
 * rows scrolled under the collapsing app bar, `text="Apps"
 * bounds="[198,297][324,58]"`, `homepage_title` `[66,66][428,44]`). The
 * node is clipped OUT of its container: one edge is the container's (the
 * clip, 297: the list's top), the other the node's own, already past it
 * (58). Which edge is the clip's is read off the parent, whose rect is cut
 * to the same clip: the edge of the two nearer the parent's same edge —
 * the top to its top, the bottom to its bottom (a tie, and a root, read
 * top or left). Such a node is clamped to zero size AT the clip edge — a
 * node with no area is never a target (interact/resolve.ts), and none
 * other reads a negative side — and the side it lies past is kept as
 * `clippedOut` (types.ts#UiNode.clippedOut), for the scroll and the wait's
 * hint. Both axes are clamped; the vertical side is the one named when
 * both are inverted.
 * docs/bugs/2026-10-09-android-inverted-uiautomator-bounds-pass-through-as-negative-heights.md
 */
function nodeBounds(bounds: string | undefined, parent: Rect | undefined): { rect: Rect; clippedOut?: ClippedSide } {
  const m = bounds?.match(BOUNDS_RE);
  if (!m) return { rect: zeroRect() };
  const [, l, t, r, b] = m.map(Number);
  const nearer = (a: number, edgeA: number, z: number, edgeZ: number) => Math.abs(z - edgeZ) < Math.abs(a - edgeA);
  const vertical: ClippedSide | undefined = b >= t ? undefined : parent !== undefined && nearer(t, parent.y, b, parent.y + parent.height) ? 'bottom' : 'top';
  const sideways: ClippedSide | undefined = r >= l ? undefined : parent !== undefined && nearer(l, parent.x, r, parent.x + parent.width) ? 'right' : 'left';
  const rect: Rect = {
    x: sideways === 'right' ? r : l,
    y: vertical === 'bottom' ? b : t,
    width: sideways === undefined ? r - l : 0,
    height: vertical === undefined ? b - t : 0,
  };
  const clippedOut = vertical ?? sideways;
  return clippedOut === undefined ? { rect } : { rect, clippedOut };
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
