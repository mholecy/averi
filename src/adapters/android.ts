import { exec as defaultExec, ExecError, execOptions, hostPathsOut, type ExecFn } from './exec.js';
import { adbShellArgv, shellCommandLine } from './adb-shell.js';
import { CONTROL_CHAR_RE, controlCharRemedy, inputTextControlFate } from './input-text.js';
import { NOT_PRINTABLE_ASCII, refusalOf, type Typeable } from './typeable.js';
import { causeOf, runStart, startSaid, type StartRefused } from './android-start.js';
import { CHOOSER_FOCUS_COMMAND, chooserAlsoInFront, chooserInFocus, chooserSheet } from './android-chooser.js';
import { parseUiautomatorXml } from './android-tree-dialect.js';
import { FOCUSED_WINDOW_COMMAND, INPUT_SHOWN_COMMAND, TOUCHABLE_COMMAND, parseFocusedWindow, parseImeInsets, parseInputShown, parseNavigationBand, parseStatusBand, parseTouchableRegion } from './android-wm.js';
import { encodePng } from './png-encode.js';
import { screencapRaw, screenshotPng, type ScreenshotSource } from './screenshot-bytes.js';
import { ViewportMemo } from './viewport-memo.js';
import { sleep } from '../util/sleep.js';
import { formatSeconds } from '../util/duration.js';
import type { DeviceAdapter, DeviceScreen, DrawnOverStrip, FocusedWindow, Key, KeyboardOracle, KeyboardTouchable, KeyboardWitness, AppHolder, LaunchIntent, LaunchOptions, Point, ChooserSheet, LinkChooser, ScreenCapture, SoftKeyboard, UiNode } from './types.js';

const KEYCODES: Record<Key, string> = { back: '4', home: '3', enter: '66' };

/**
 * One adb call's options: its own budget. `typed` is `never` here, so a ShellCallOptions value handed to `adb`,
 * `execOut` or `rawShell` is a type error rather than a mask dropped on the way.
 */
interface AdbCallOptions {
  timeoutMs?: number;
  typed?: never;
}

/**
 * A `shell` call's options: its budget, and the indexes of its DEVICE argv that are typed text (ExecOptions.typed,
 * A17). Only `shell` takes them, and it alone moves them to exec's (past adbShellArgv's `-s S shell`): `adb`,
 * `execOut` and `rawShell` take AdbCallOptions, so no caller can declare a typed word where it would be moved wrongly.
 */
interface ShellCallOptions {
  timeoutMs?: number;
  typed?: readonly number[];
}

/** uiautomator's "the app has no window yet" status — a transient, not a failure. */
const NULL_ROOT_RE = /null root node/i;
const NULL_ROOT_RETRY_MS = 1_000;
const DUMP_TIMEOUT_MS = 15_000;
/**
 * The capture (`capture`, D19): the raw frame, gzipped on the device. One exec-out word: the device's sh runs the pipe.
 * screencap's stdout is gzip's input, so a word it prints would land INSIDE the stream; its stderr ("Capturing
 * failed.", a multi-display warning) goes to /dev/null. The shell's own `gzip: not found` is sh's, not screencap's,
 * and still arrives (exec-out merges sh's stderr). Exported for the differential's fake device.
 */
export const RAW_SCREENCAP = 'screencap 2>/dev/null | gzip -1';
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
/** The same reasoning for the window manager's word on a miss (focusedWindow): past it, `unknown` — the active-window hint. */
const FOCUSED_WINDOW_TIMEOUT_MS = 2_000;
/**
 * The focus read after a deep link's or a `-p` launch's start, or monkey's refusal (D55, D55b, android-chooser.ts): its
 * bound, as the other focus reads'.
 */
const CHOOSER_FOCUS_TIMEOUT_MS = 2_000;
/**
 * The chooser's one tree read once the focus read named it (D55c, chooserSheetInFront): twice the ≈ 2.5 s a
 * uiautomator dump takes on the lab — the chooser's own three dumps took 2514, 2020 and 2054 ms (batch-11's E2), and
 * scroll_until's 2.2–2.5 s (lab fact 15) — under waitForIdle's 10 s give-up. Past it, no sheet: the reply is D55's.
 */
const CHOOSER_TREE_TIMEOUT_MS = 5_000;

/**
 * typeText's wait after each character's `input text` call. Measured on Compose (and, in the 2026-10-31 run, React
 * Native) fields under Gboard:
 * - 2026-08-05: one bulk `input text` landed 3 of 11 characters (it races Compose's async text state); one call per
 *   character with no wait landed 5 of 8 after hours of emulator uptime; with 300 ms, 8 of 8. 250 ms was chosen.
 * - 2026-10-31, on the lab AVD (averi_lab, API 33): ~9,600 characters (half per call, half in one script; 4,800 per
 *   call — the shipped mode — all landed) at 250/150/100/50/0 ms into the Compose form-basic name field and the
 *   React Native rn-field — 20-character strings with '"$&;\ and spaces, idle, under host load and under load on
 *   every device vCPU — 0 dropped, garbled or added in every cell (host load measured at ≤ 100 ms, device load at 50
 *   and 0 ms). It suggests the device paces the typing itself: 0 ms landed whole, and each call takes 40–100 ms on
 *   the device.
 * 0 ms and 50 ms both landed whole on 2026-10-31, but unpaced typing dropped characters on 2026-08-05 after hours of
 * uptime (the later run did not reproduce it), so 50 ms is the floor and 100 ms doubles it — for what the later run
 * left untested: masked or formatted fields (an amount, an IBAN), long uptime, a literal %, non-ASCII, and strings
 * past 20 characters.
 */
const TYPING_PACE_MS = 100;
/** typeText's wait after the DPAD left/right nudge that commits Gboard's composing character (see typeText). */
const COMMIT_SETTLE_MS = 150;

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

/** The bands `dumpsys window displays` gives the screen (types.ts#DeviceScreen): the status bar's height, the navigation bar's top. */
type SystemBands = Pick<DeviceScreen, 'statusBand' | 'navigationBand'>;

export class AndroidAdapter implements DeviceAdapter {
  readonly platform = 'android' as const;
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
    return this.runAdb(['-s', this.serial, ...args], { timeoutMs: opts.timeoutMs });
  }

  /** The `adb` binary with a complete argv — `adb` and `shell` both end here; `typed` indexes this argv (exec's). */
  private runAdb(argv: string[], opts: ShellCallOptions) {
    return this.exec('adb', argv, execOptions(opts.timeoutMs, opts.typed));
  }

  /**
   * `adb shell <argv>`, the argv delivered to the device command word for
   * word: each word quoted for the device's sh by adb-shell.ts,
   * so a deep link's `&`, an extra's space, a typed `$` or `'` reach the
   * command as data and are never run. Every device command in this adapter
   * goes through here, `execOut` (where adb quotes) or `rawShell` — none
   * builds a `shell` argv of its own.
   */
  private shell(argv: readonly string[], opts: ShellCallOptions = {}) {
    // adbShellArgv is its prefix (`-s S shell`) and then the device argv word for word: a typed index moves past it.
    const prefix = adbShellArgv(this.serial, []).length;
    return this.runAdb(adbShellArgv(this.serial, argv), { ...opts, typed: opts.typed?.map((i) => i + prefix) });
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
   * focused window, which may close the gap or not), so nothing waits here.
   * The answer names one holder: Android's chooser in front after a `-p`
   * start (D55b, launchApp below).
   */
  async launch(packageName: string, opts: LaunchOptions = {}): Promise<AppHolder> {
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

  private async launchApp(packageName: string, opts: LaunchOptions): Promise<AppHolder> {
    if (opts.clearState) await this.shell(['pm', 'clear', packageName]);
    if (opts.activity === undefined && opts.intent === undefined) {
      // monkey resolves the launcher activity for us, but picks ARBITRARILY
      // when the package declares several (LeakCanary adds one in debug
      // builds, so this may open LeakCanary) — set app.android.activity in
      // averi.yaml to pin the entry point.
      // The three `--pct-… 0` (D73, ADR 0041's D73 amendment): monkey checks its key categories before any event and aborts
      // on one with a share of events and no key in the device's key map: `** SYS_KEYS has no physical keys…`, exit 251, 8
      // of 8 launches refused on the lab AVD. NAV_KEYS and MAJOR_NAV_KEYS abort the same way, per AOSP. Its one event is
      // the launch, so no key category has a part in it.
      const outcome = await runStart(
        ['monkey', '-p', packageName, '--pct-syskeys', '0', '--pct-nav', '0', '--pct-majornav', '0', '-c', 'android.intent.category.LAUNCHER', '1'],
        (argv) => this.shell(argv),
      );
      if (outcome.kind === 'refused') {
        // One focus read, on the refusal only (a monkey that started something pays nothing): the chooser is not why
        // monkey refused (D73), but it is what is in front, so it is named after monkey's reason. No chooser named (a
        // failed or unmatched read): the refusal alone.
        const chooser = await this.chooserInFront();
        // monkey's reason may be on its stdout, which the ExecError's
        // message drops — read here, or this would fail with no reason at
        // all. Not every reason is the package's: monkey itself may have
        // failed to run (android-start.ts lists its lines), and its line says.
        const monkeyRefusal =
          `monkey started nothing in ${packageName} — check that ${packageName} is installed and has a launcher ` +
          `activity, or name the activity to start: ${NAME_THE_ACTIVITY}, or ` +
          `${ACTIVITY_IN_CONFIG} — or monkey itself could not run; its line says which. ` +
          startSaid(outcome);
        throw new Error(
          chooser === undefined ? monkeyRefusal : `${monkeyRefusal} ${chooserAlsoInFront(chooser)}`,
          causeOf(outcome),
        );
      }
      return { holder: 'none' };
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
    // D55b (ADR 0041's D55b amendment): a `-p` intent two of the package's activities handle, none preferred, starts
    // Android's chooser, and am reports it `started` (batch-11: 10 of 10). So D55's one focus read after a `-p` start
    // (≈ 70 ms measured, batch-11) — never after `-n`, which names the activity and cannot raise it. The chooser named
    // holds the launch (a ⚠ line under "Launched", D56's shape on iOS: the start happened); a failed or unmatched read
    // names no holder. D55c: the chooser named, one dump of its tree reads its sheet (linkChooserInFront).
    if (component !== undefined) return { holder: 'none' };
    return this.chooserHolder();
  }

  async terminate(packageName: string): Promise<void> {
    await this.shell(['am', 'force-stop', packageName]);
  }

  async openDeepLink(url: string): Promise<AppHolder> {
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
    // No wait and no note (D49a is iOS's). A link two activities handle, none of them preferred, starts Android's
    // "Open with" chooser, which am reports as `started` (android-start.ts; measured, batch-9 D55): so ONE focus read
    // after the start asks whether the chooser is in front (D55, android-chooser.ts; ADR 0041). Only a positive
    // match names a holder; a failed or unreadable read, or a chooser not in front yet, names none.
    // D55c: the chooser named, one dump of its tree reads its sheet (linkChooserInFront); none is D55's `{ component }`.
    return this.chooserHolder();
  }

  /** What holds the app after averi's own start, on both verbs: the chooser when the focus names it, else nothing named. */
  private async chooserHolder(): Promise<AppHolder> {
    const chooser = await this.linkChooserInFront();
    return chooser === undefined ? { holder: 'none' } : { holder: 'chooser', chooser };
  }

  /**
   * The chooser after averi's own start (openDeepLink, a `-p` launch): the focus read (chooserInFront) and, only once
   * it named the chooser, the one dump of its tree (chooserSheetInFront, D55c) — `{ component, sheet? }`, or undefined
   * when the focus names no chooser. monkey's refusal asks chooserInFront alone.
   */
  private async linkChooserInFront(): Promise<LinkChooser | undefined> {
    const component = await this.chooserInFront();
    if (component === undefined) return undefined;
    const sheet = await this.chooserSheetInFront();
    return { component, ...(sheet !== undefined && { sheet }) };
  }

  /**
   * The chooser's component when the window manager's focus names it (android-chooser.ts#chooserInFocus), else
   * undefined. One `dumpsys window displays | grep` (ADR 0041 estimated ≈ 20–26 ms from FOCUSED_WINDOW_COMMAND's
   * 25–26 ms; batch-11 measured it at a median 70 ms, 58–99, n=10 — ADR 0041's D55b amendment). Never throws: a failed
   * or timed-out call is undefined, so the reply falls back to today's ("Opened", "Launched", monkey's error).
   */
  private async chooserInFront(): Promise<string | undefined> {
    try {
      return chooserInFocus((await this.rawShell(CHOOSER_FOCUS_COMMAND, { timeoutMs: CHOOSER_FOCUS_TIMEOUT_MS })).stdout.toString('utf8'));
    } catch {
      return undefined;
    }
  }

  /**
   * The chooser's sheet (android-chooser.ts#chooserSheet) from ONE `uiautomator dump`, asked only once chooserInFront
   * named the chooser (D55c; ADR 0041's D55c amendment). Its own 5 s bound (CHOOSER_TREE_TIMEOUT_MS), and never
   * uiTree(): its 15 s bound, its "null root node" retry and its diagnosis (an `adb get-state`) are the costs of a read
   * the caller needs, not of an optional enrichment. ≈ 2–2.5 s on the chooser path only — the ui_snapshot today's
   * advice sends the agent to is the same dump. Never throws: a failed, timed-out or XML-less dump, or a tree that is
   * not the measured layout, is undefined, and the reply is D55's (or D55b's) byte for byte.
   */
  private async chooserSheetInFront(): Promise<ChooserSheet | undefined> {
    try {
      const raw = (await this.execOut(['uiautomator', 'dump', '/dev/tty'], { timeoutMs: CHOOSER_TREE_TIMEOUT_MS })).stdout.toString('utf8');
      const tree = this.dumpedTree(raw);
      return tree === undefined ? undefined : chooserSheet(tree);
    } catch {
      return undefined;
    }
  }

  /**
   * The tree in a `uiautomator dump /dev/tty`'s output: the XML up to its last `>`, parsed (uiautomator appends a status
   * line after it); undefined when the output holds no XML (its status alone: `null root node`, `Killed`, nothing).
   * Throws what the parser throws. uiTree's and chooserSheetInFront's one reading of a dump.
   */
  private dumpedTree(raw: string): UiNode | undefined {
    const xmlEnd = raw.lastIndexOf('>');
    return xmlEnd === -1 ? undefined : parseUiautomatorXml(raw.slice(0, xmlEnd + 1), this.drawnOverStrip);
  }

  /**
   * D19 (docs/adr/0035-android-captures-raw-pixels.md): `RAW_SCREENCAP`, the raw frame gzipped on the device —
   * measured 2026-10-31 on the lab AVD (API 33, n=10 each, interleaved, medians) against `screencap -p`: 77–79 ms vs
   * 101–104 on four lab cells, 76 vs 103 on Settings, 171 vs 446 on the launcher's photo wallpaper (the device's PNG
   * encode is what `-p` pays, and it grows with the content). `shell screencap <file>` + `adb pull` was 110 ms flat, 155 with the
   * file's removal — a 9.6 MB file left behind by a killed server, and one per concurrent server; raw over exec-out
   * 321 ms. No file is written here.
   *
   * The command is ONE word, the pipe in it — exec-out's first word reaches the device's sh unescaped (execOut).
   * screenshot-bytes.ts#screencapRaw judges the answer: a frame, a transport error, or a refusal of the raw path. On a
   * refusal this call captures with `screencap -p`, whose own check says whether the device is alive. A LASTING
   * refusal (the shell says there is no gzip; a format other than RGBA_8888) on a live device pins this adapter to
   * `-p` (`#rawPinned`) — today's path, never a slower one — said once on stderr with its reason; any other refusal
   * (the shell's `Killed`, a stream cut short) costs that one call a `-p` and the next one tries raw again.
   */
  async capture(): Promise<ScreenCapture> {
    if (!this.#rawPinned) {
      const { stdout } = await this.execOut([RAW_SCREENCAP]);
      const raw = screencapRaw(stdout, this.screenshotSource(`'${RAW_SCREENCAP}'`));
      if ('image' in raw) return { kind: 'rgba', image: raw.image };
      const bytes = await this.pngScreenshot();
      // Checked and set with no await between: of two captures refused at once, one pins and says so.
      if (raw.lasting && !this.#rawPinned) {
        this.#rawPinned = true;
        console.error(`averi: device ${this.serial}: ${raw.refused} — captures with \`screencap -p\` from now on (slower: the device encodes a PNG)`);
      }
      return { kind: 'png', bytes };
    }
    return { kind: 'png', bytes: await this.pngScreenshot() };
  }

  /** Set once the raw capture was refused for good on a live device (`capture`): from then on every capture is `-p`. */
  #rawPinned = false;

  /** The capture as a PNG: the device's when it gave one, else encoded here (adapters/png-encode.ts). */
  async screenshot(): Promise<Buffer> {
    const shot = await this.capture();
    return shot.kind === 'png' ? shot.bytes : encodePng(shot.image);
  }

  /** `screencap -p`: the device's PNG — the capture before D19, and its fallback (`capture`). */
  private async pngScreenshot(): Promise<Buffer> {
    const { stdout } = await this.execOut(['screencap', '-p']);
    // exec-out exits 0 with whatever the guest wrote — nothing, or `Killed`,
    // on a dying emulator — so the bytes are judged here (screenshot-bytes.ts).
    return screenshotPng(stdout, this.screenshotSource('screencap -p'));
  }

  /** Where a capture's bytes came from, for its transport error: this device and the exec-out command as typed. */
  private screenshotSource(command: string): ScreenshotSource {
    return {
      device: `device ${this.serial}`,
      command: `adb -s ${this.serial} exec-out ${command}`,
      remedy: 'Re-check `adb devices` and retry; if it repeats, the emulator, not the app, needs attention.',
    };
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
          const last = hostPathsOut(e.stderr.trim().split('\n').pop() ?? '');
          throw new Error(await this.diagnoseDumpFailure(e.timedOut ? 'timeout' : 'exec-error', last, false), { cause: e });
        }
        throw e;
      }
      const tree = this.dumpedTree(raw);
      if (tree !== undefined) return tree;
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
        ? (hostPathsOut(e.stderr.trim().replace(/^(Command failed:.*\n)?\s*(error|adb):\s*/s, '')) || `exit ${e.exitCode}`)
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
   * `dumpsys window displays`, read by android-wm.ts#parseStatusBand —
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
   * out of the same dump, android-wm.ts#parseNavigationBand, and is kept with the
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
  /**
   * The read after a stroke is the settled read (types.ts#DeviceAdapter.treeReadSettles, ADR 0021 decision 7).
   *
   * `uiautomator dump` waits before it snapshots: AOSP's DumpCommand#run calls `uiAutomation.waitForIdle(1000,
   * 1000 * 10)` — UiAutomation#waitForIdle returns once no accessibility event has arrived for 1 s, and throws after
   * 10 s, upon which the command prints `ERROR: could not get idle state.` and dumps nothing (a read that fails, read
   * again like any other) — frameworks/base cmds/uiautomator/cmds/uiautomator/src/com/android/commands/uiautomator/
   * DumpCommand.java, android13-release (the lab AVD's API 33; the same call on `main`). A scroll view emits
   * TYPE_VIEW_SCROLLED and TYPE_WINDOW_CONTENT_CHANGED while its content moves, so a dump's snapshot is taken after the content has been
   * still for that second. And `input swipe` returns once the finger has lifted.
   *
   * Measured (lab AVD, API 33, 2026-10-30; `input swipe`, then a dump at once and a second right after it, compared):
   * the Compose picker (`form-picker`) 6 of 6 the same at the drag speed, 4 of 4 after a 300 ms fling; the Views list
   * of `scroll-collapsing` (a NestedScrollView under a collapsing AppBarLayout), whole dumps byte for byte, 6 of 6 at
   * the drag speed, 6 of 6 after a 300 ms fling, 4 of 4 after a 100 ms one; the Compose carousel of
   * `carousel-in-list`, stroked sideways as the scroll strokes it, 5 of 5 at the drag speed and 4 of 4 after a 150 ms
   * fling — the content had moved each time.
   *
   * Residual: content that goes on moving while it raises no accessibility event (a canvas animation, a view moved
   * without telling the framework, a fling still running after a second of silence) can be read mid-motion — the
   * same exposure as a stop at 0 swipes, which no read confirms either.
   */
  readonly treeReadSettles = true as const;
  /** `input text` hands keys to the IME's queue, which may still deliver them after the call (types.ts#TypingDelivery). */
  readonly typingDelivery = 'may-arrive-late' as const;
  /**
   * What `input text` types (types.ts#DeviceAdapter.typeable, ADR 0037): printable ASCII. A character outside the
   * virtual key map makes `KeyCharacterMap.getEvents` return null and `input` exit 255 on an NPE — after every
   * character before it has landed, the field half-typed (docs/bugs/2026-10-16-lab-android-type-text-types-a-prefix-
   * then-fails-on-non-ascii.md). Conservative: an extended letter the virtual key map may hold (`é`) is unmeasured, so
   * refused too. No other path types it (D43, ADR 0037's D43 amendment): API 33's shell has no clipboard setter, and
   * API 34+'s `cmd clipboard` is unmeasured.
   */
  readonly typeable: Typeable = {
    refuses: NOT_PRINTABLE_ASCII,
    says: 'on Android averi types only printable ASCII (U+0020–U+007E): `input text` crashes on another character after typing the ones before it',
    otherPath: 'averi has no typing path for it on Android (no shell clipboard setter on API 33; ADR 0037): use a value without it, or enter it by hand.',
  };

  /** `durationMs` defaults to 300 ms, kept equal to interact/swipe.ts#MIN_DRAG_MS — change both. */
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
    // One `input text` call PER CHARACTER, each followed by TYPING_PACE_MS
    // (its doc holds the measurements): bulk injection races Compose's async
    // text state and silently drops characters, and unpaced calls once did too.
    // An n-char value waits n x TYPING_PACE_MS + COMMIT_SETTLE_MS on top of
    // its n + 2 adb round-trips.
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
    // The same defence for a character `input text` cannot type (ADR 0037): refused before the first `input text`, so
    // a direct caller cannot leave the field half-typed. An ASCII value pays one regex test, no device call.
    const refusal = refusalOf(text, this.typeable);
    if (refusal !== undefined) throw new Error(`typeText ${refusal}`);
    // Each character is declared typed (A17, ExecOptions.typed): no failure shows it. A leading `-` cannot form an
    // option (D74): it is the one word `-` (by code; read back by
    // docs/truth/live-records/d74-dash-text/android-input-dash.sh).
    for (const ch of text) {
      await this.shell(['input', 'text', ch === ' ' ? '%s' : ch], { typed: [2] });
      await sleep(TYPING_PACE_MS);
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
    await sleep(COMMIT_SETTLE_MS);
  }

  async pressKey(key: Key): Promise<void> {
    await this.shell(['input', 'keyevent', KEYCODES[key]]);
  }

  /**
   * Is the soft keyboard (IME) shown, and which screen rect does it cover?
   * One adb call: `dumpsys window displays`, read by android-wm.ts#parseImeInsets.
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

  /**
   * The window manager's word on the focused window (types.ts#FocusedWindow), in ONE adb call (FOCUSED_WINDOW_COMMAND,
   * read by parseFocusedWindow). Why: `uiautomator dump` lists the active window only and its XML says nothing of the
   * window itself — `<hierarchy rotation>` and each node's `package` are the same for an activity and its dialog — so a
   * full-screen dialog Compose lays between the bars (`[0,66][1080,2153]`), a Views dialog laid full screen (`[0,0]
   * [1080,2220]`, an activity's very shape) and an expanded sheet with no scrim dump as the app's screen. The window
   * manager types every window, whatever the theme or the toolkit: an activity's is TYPE_BASE_APPLICATION (set by
   * ActivityThread); every `android.app.Dialog` — AppCompat's, Material's, a DialogFragment, a BottomSheetDialog,
   * Compose's `Dialog` and, in material3 1.3.1, its ModalBottomSheet — is TYPE_APPLICATION, the default of
   * `WindowManager.LayoutParams`; a PopupWindow or a Compose `Popup` a panel. Measured on averi_lab (API 33): every
   * presented lab cell's focus is TYPE_APPLICATION at the dumped root's bounds, the plain screen's the activity's with
   * nothing else of an app visible (ADR 0018, "Android's window by the window manager's word"; the captures'
   * `<cell>.windows.txt`). Rejected: `mTopFullscreenOpaqueWindowState` ≠ the focus (one line of the `displays` dump,
   * already read) — it tells only a window that is not MATCH_PARENT at 0,0 (Compose's own size), and reads a Views dialog
   * laid full screen, a sheet dialog or Compose's sheet as the app's screen; `uiautomator dump --windows` — the
   * accessibility window list stops at a touch-modal window, and types the activity and the dialog alike.
   *
   * Cost: 41 KB, 25–26 ms through execFile (the whole `windows` dump alone 21–23 ms; filtered on the device 26–30 ms,
   * no gain), measured ten times each. Asked on a MISS only — after a wait that found nothing, before `scroll_until`'s
   * first stroke for a target its read does not hold (ui-tree/window-mark.ts) — never per poll.
   *
   * Never throws: a failed or timed-out call, or a dump parseFocusedWindow cannot read, is `unknown`.
   */
  async focusedWindow(): Promise<FocusedWindow> {
    try {
      return parseFocusedWindow((await this.rawShell(FOCUSED_WINDOW_COMMAND, { timeoutMs: FOCUSED_WINDOW_TIMEOUT_MS })).stdout.toString('utf8'));
    } catch {
      return { of: 'unknown' };
    }
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
