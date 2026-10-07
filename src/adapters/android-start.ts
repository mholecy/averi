import { ExecError, type ExecResult } from './exec.js';

/**
 * "Did the device start anything?" — the one owner of reading a start
 * command's result (2026-10-07, the Android adapter review's candidate 2).
 *
 * Why this module exists. `adb shell` exiting 0 does not mean an activity
 * was started: the device commands that start one report a start that did
 * not happen in their OUTPUT, and `am start` still exits 0 when it does.
 * Until this module the knowledge lived in the adapter's private `amStart`,
 * whose interface was shaped for the launch's message (package, component,
 * intent), so the two other starts could not use it:
 * - openDeepLink sent `am start -a VIEW -d <url>` and reported success for a
 *   url nothing handles — measured by the review on emulator-5554 (API 33):
 *   exit 0 and an `Error: Activity not started …` line, and `open_deep_link`
 *   answered "Opened …";
 * - the launcher launch (`monkey -p <package> -c LAUNCHER 1`) did fail —
 *   measured the same day: exit 252 — but monkey prints its reason on
 *   STDOUT, and the ExecError's message carries only stderr, so the reason
 *   was dropped.
 * The earlier review (2026-10-04, C10) left the launch code in android.ts
 * with "revisit when openDeepLink shares amStart"; this is that revisit, not
 * a split of the file.
 *
 * The interface is one call: the command's argv and a function that sends
 * it. The argv's first words pick how its result is read (`am start` or
 * `monkey`; anything else is refused before it is sent), so the rule cannot
 * disagree with the command. It answers `started` or `refused` with the
 * command's own lines; any other failure — adb's (exit 255, device offline /
 * not found), a timeout, a non-zero exit with no diagnosis of the
 * command's — is THROWN as it came, because it says nothing about whether
 * anything started and every caller would pass it on unchanged. The review
 * sketched that as a third outcome, `transport`; it is a throw on purpose,
 * since a union member every caller forwards untouched is pass-through.
 * One addition to a thrown monkey failure: monkey prints to stdout, which
 * an ExecError's message leaves out, so its last few stdout lines are
 * added to the message of a new ExecError (same class, same fields, the
 * original as its `cause`), so the reason is in its `stack` too. What a refusal means to the reader is the
 * caller's sentence (the launch names averi.yaml's `activity`, the deep link
 * names its url); the module returns the command's lines, unworded.
 *
 * The two commands are read differently, because they report differently:
 *
 * `am start` — its diagnosis is an `Error` line or an uncaught Java
 * exception (AM_ERROR_LINE_RE), on EITHER stream (am writes to stderr, older
 * adb folds stderr into stdout), at ANY exit: exit 0 for "unable to resolve
 * Intent" / "Activity class … does not exist", non-zero for a
 * SecurityException. Samples, in tests/adapters/android-start.test.ts and
 * android.test.ts:
 *
 *   Error: Activity not started, unable to resolve Intent { act=… pkg=… }
 *   Error type 3
 *   Error: Activity class {pkg/pkg.Missing} does not exist.
 *
 * `Warning:` lines are NOT refusals ("Activity not started, its current task
 * has been brought to the front" is a successful warm launch). A url two
 * apps handle starts the system chooser — an activity started, so `started`.
 *
 * `monkey` — its exit status IS the verdict (the review's measurement: exit
 * 252 for a package with nothing to launch), and its own diagnoses are the
 * lines it starts with `** ` in column 0 (MONKEY_DIAGNOSIS_LINE_RE), on
 * either stream. A non-zero exit with such a line is `refused`; exit 0 is
 * `started`, whatever it printed.
 *
 * What is NOT measured, written down here once (android.ts, the tests and
 * ARCHITECTURE.md point here): the exact text of monkey's line. The review
 * measured the exit and that the reason is on stdout, and did not quote it;
 * "** No activities found to run, monkey aborted." is the line in AOSP's
 * Monkey.java (getMainApps, printed with Logger.out — stdout; run() then
 * returns -4, which is the measured 252), and is the sample the tests use.
 * Every diagnosis in that file starts `** `, but not all go to stdout: that
 * one is Logger.out, while `** Error: Unknown option …` (run() returns -1,
 * exit 255), `** Error: Unable to connect to activity manager …` (-3, exit
 * 253) and the event-injection errors are Logger.err — both streams are
 * read, so each is a refusal with its line. The rule depends only on the
 * `** ` prefix and the non-zero exit, not on any text. Two cases read as
 * `started` (neither measured):
 * - an app that CRASHES on monkey's one launch event: per Monkey.java
 *   monkey prints `** Monkey aborted due to error.` to stdout and, with a
 *   count of 1, still exits 0. Defensible — the activity was started, and
 *   the crash is the app's, for the next step's wait and the logs to show —
 *   and not limited to old devices;
 * - a shell-v1 device (Android 6 or older), where adb loses the exit status:
 *   any monkey refusal at exit 0 reads as `started`, as an uncaught
 *   exception in `am` does (AM_ERROR_LINE_RE).
 */

/** Which device command made the start: the two report a refusal differently. */
export type StartCommand = 'am start' | 'monkey';

export interface StartRefused {
  readonly kind: 'refused';
  /** Which command refused — for the caller's quote of it. */
  readonly command: StartCommand;
  /** The command's own diagnosis lines, trimmed, in the order printed — for the caller to quote. */
  readonly lines: readonly string[];
  /** The ExecError when the command also exited non-zero; for `{ cause }`. */
  readonly cause?: ExecError;
}

export type StartOutcome = { readonly kind: 'started' } | StartRefused;

/** `{ cause }` for an Error's options only when there is one — no own `cause: undefined`. */
export function causeOf(refused: StartRefused): ErrorOptions {
  return refused.cause ? { cause: refused.cause } : {};
}

/**
 * A line of `am start` output that means the activity was not started: am's
 * own `Error: …` / `Error type N`, or an uncaught Java exception.
 *
 * Each part is load-bearing, and pinned (tests/adapters/android-start.test.ts):
 * - anchored at the line start, with no leading whitespace allowed (am's own
 *   diagnoses start in column 0; the indented lines are stack frames). A
 *   SUCCESSFUL start echoes the intent
 *   ("Starting: Intent { dat=app://x/Error/y cmp=pkg/.ErrorActivity }"), and
 *   user data or a class name containing "Error" mid-line is not a failure;
 * - `\b` after Error: "Errors: none" is not am's `Error`;
 * - case-sensitive, deliberately: am capitalises its own diagnoses, and a
 *   lowercase "error: …" on a start that exited 0 is somebody else's line
 *   (a shell wrapper, the app's own stdout) — not grounds to fail a start;
 * - the exception branch: a refused start ("java.lang.SecurityException:
 *   Permission Denial … not exported from uid …") has no `Error` line at all.
 *
 * Deliberately NOT matched, and pinned as such: the old-style prefixed form
 * `Exception in thread "main" java.lang.…` at exit 0. Acceptable because an
 * uncaught exception in am exits non-zero through adb shell v2 (API 24+),
 * so it still fails loudly as the raw ExecError; only shell-v1 devices
 * (Android 6 or older) could show it at exit 0.
 */
const AM_ERROR_LINE_RE = /^(?:Error\b|java\.lang\.\w+(?:Exception|Error)\b).*$/gm;

/**
 * monkey's own diagnosis: a line starting `** ` in column 0. Counted only
 * when monkey exited non-zero (see the header) — the exit is the verdict,
 * the line is the reason.
 */
const MONKEY_DIAGNOSIS_LINE_RE = /^\*\* .*$/gm;

/** How many of monkey's last stdout lines a thrown failure carries. */
const STDOUT_TAIL_LINES = 3;

/**
 * How each command's result is read — the one place the two differ.
 * `exit0IsVerdict`: exit 0 is `started` without reading the output.
 * `diagnosis`: the command's own lines that mean it started nothing.
 * `stdoutIntoFailure`: a thrown non-zero exit gets the command's stdout tail.
 */
const READING: Record<StartCommand, { exit0IsVerdict: boolean; diagnosis: RegExp; stdoutIntoFailure: boolean }> = {
  'am start': { exit0IsVerdict: false, diagnosis: AM_ERROR_LINE_RE, stdoutIntoFailure: false },
  monkey: { exit0IsVerdict: true, diagnosis: MONKEY_DIAGNOSIS_LINE_RE, stdoutIntoFailure: true },
};

/** The start command an argv is, or undefined when it is none. */
function startCommandOf(argv: readonly string[]): StartCommand | undefined {
  if (argv[0] === 'am' && argv[1] === 'start') return 'am start';
  if (argv[0] === 'monkey') return 'monkey';
  return undefined;
}

/**
 * Send one start command and read whether the device started anything.
 * `send` is the adapter's `shell` and gets the argv as it is; this module
 * never quotes or rebuilds it, so how a word reaches the device stays
 * adb-shell.ts's.
 */
export async function runStart(
  argv: readonly string[],
  send: (argv: readonly string[]) => Promise<ExecResult>,
): Promise<StartOutcome> {
  const command = startCommandOf(argv);
  if (command === undefined) {
    throw new Error(`runStart reads \`am start\` and \`monkey\` only, not: ${argv.slice(0, 2).join(' ')}`);
  }
  const reading = READING[command];
  let output: string;
  let cause: ExecError | undefined;
  try {
    const { stdout, stderr } = await send(argv);
    if (reading.exit0IsVerdict) return { kind: 'started' };
    output = `${stdout.toString('utf8')}\n${stderr}`;
  } catch (e) {
    // A timeout is passed through as the timeout it is, whatever the
    // command had printed by then.
    if (!(e instanceof ExecError) || e.timedOut) throw e;
    output = `${e.stdout.toString('utf8')}\n${e.stderr}`;
    cause = e;
  }
  const lines = output.match(reading.diagnosis);
  if (lines === null) {
    if (cause === undefined) return { kind: 'started' };
    throw reading.stdoutIntoFailure ? withStdoutTail(cause, command) : cause;
  }
  return { kind: 'refused', command, lines: lines.map((line) => line.trim()), ...(cause && { cause }) };
}

/**
 * A non-zero exit with no diagnosis is NOT read as a refusal — exit 255 is
 * also adb's own transport failure — but what the command printed to stdout
 * is kept: its last non-empty lines go onto the message of a NEW ExecError
 * with the same fields, the one that was thrown as its `cause`. Until the
 * 2026-10-07 code review the tail was appended to the thrown error's
 * `message`, after V8 had already written `stack`'s header from the old one,
 * so anything that logged the stack showed the failure without monkey's
 * reason. With no stdout to add, the error is thrown as it came.
 */
function withStdoutTail(error: ExecError, command: StartCommand): ExecError {
  const tail = error.stdout
    .toString('utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(-STDOUT_TAIL_LINES);
  if (tail.length === 0) return error;
  return new ExecError(error.command, error.exitCode, error.stderr, error.timedOut, error.stdout, {
    note: `${command} printed: ${tail.join(' / ')}`,
    cause: error,
  });
}
