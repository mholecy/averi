import { describe, expect, it } from 'vitest';
import { runStart, type StartCommand } from '../../src/adapters/android-start.js';
import { ExecError, type ExecResult } from '../../src/adapters/exec.js';
import { execErrorLikeExec } from '../helpers/exec-error.js';

/**
 * runStart — "did the device start anything?" — read from what the start
 * command printed (android-start.ts). The `am start` lines are the shapes
 * the 2026-10-03 launch tests used (android.test.ts) and the review's
 * 2026-10-07 measurement of a deep link nothing handles (exit 0 and an
 * `Error: Activity not started` line). The monkey line is AOSP Monkey.java's,
 * at the review's measured exit 252; its exact device text is the one
 * unmeasured sample (android-start.ts says so, once).
 */

const prints = (stdout: string, stderr = '') => async (): Promise<ExecResult> => ({ stdout: Buffer.from(stdout), stderr });
const throws = (error: unknown) => async (): Promise<ExecResult> => {
  throw error;
};

const UNRESOLVED_VIEW =
  'Error: Activity not started, unable to resolve Intent { act=android.intent.action.VIEW dat=nosuch://x flg=0x10000000 }';
const MONKEY_ABORTED = '** No activities found to run, monkey aborted.';
const AM = ['am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'nosuch://x'];
const MONKEY = ['monkey', '-p', 'p', '-c', 'android.intent.category.LAUNCHER', '1'];
const ARGV: Record<StartCommand, string[]> = { 'am start': AM, monkey: MONKEY };

describe('runStart — am start', () => {
  it.each([
    ['on stderr at exit 0', prints('Starting: Intent { act=android.intent.action.VIEW dat=nosuch://x }\n', `${UNRESOLVED_VIEW}\n`)],
    ['folded into stdout at exit 0', prints(`Starting: Intent { act=android.intent.action.VIEW dat=nosuch://x }\n${UNRESOLVED_VIEW}\n`)],
  ])('an Error line %s → refused, quoting it', async (_where, send) => {
    expect(await runStart(AM, send)).toEqual({
      kind: 'refused',
      command: 'am start',
      lines: [UNRESOLVED_VIEW],
    });
  });

  it('several diagnosis lines → all of them, in order, joined with " / "', async () => {
    const outcome = await runStart(AM, prints('', 'Error type 3\nError: Activity class {p/p.Missing} does not exist.\n'));
    expect(outcome).toMatchObject({
      kind: 'refused',
      lines: ['Error type 3', 'Error: Activity class {p/p.Missing} does not exist.'],
    });
  });

  it('trailing whitespace on a diagnosis line is not quoted (the lines are trimmed)', async () => {
    expect(await runStart(AM, prints('Error type 3  \t\n'))).toMatchObject({ lines: ['Error type 3'] });
  });

  it('a non-zero exit carrying an exception line → refused, with the ExecError as the cause', async () => {
    const DENIAL = 'java.lang.SecurityException: Permission Denial: starting Intent { cmp=p/.A } not exported from uid 10190';
    const failure = execErrorLikeExec('adb -s e shell am start', 255, `\nException occurred while executing 'start':\n${DENIAL}\n\tat x.y(Z.java:1)\n`);
    expect(await runStart(AM, throws(failure))).toEqual({
      kind: 'refused',
      command: 'am start',
      lines: [DENIAL],
      cause: failure,
    });
  });

  // What a SUCCESSFUL start may print. Every row is a start that happened.
  it.each([
    ['nothing'],
    ['"Error" mid-line in the echoed intent data', 'Starting: Intent { act=android.intent.action.VIEW dat=app://x/Error/y }\n'],
    ['a component named .ErrorActivity', 'Starting: Intent { cmp=p/.ErrorActivity }\n'],
    ['"Errors: none"', 'Starting: Intent { pkg=p }\nErrors: none\n'],
    ['a lowercase "error:" line that is not am\'s', 'Starting: Intent { pkg=p }\nerror: could not set locale, continuing\n'],
    ['a java.lang class mid-line', 'Starting: Intent { dat=app://x/java.lang.IllegalStateException }\n'],
    ['a Warning (a warm launch that only fronts the task)', 'Warning: Activity not started, its current task has been brought to the front\n'],
    // The narrowing, as a decision (2026-10-03): am's diagnoses start in
    // column 0, and an "Exception in thread" line at exit 0 is left alone —
    // see AM_ERROR_LINE_RE for why that is acceptable.
    ['an indented "Error:" line', 'Starting: Intent { pkg=p }\n  Error: something\n'],
    ['an "Exception in thread" line at exit 0', 'Exception in thread "main" java.lang.IllegalArgumentException: Unknown option: --bogus\n'],
  ])('exit 0 having printed %s, on either stream → started', async (_what, printed = '') => {
    expect(await runStart(AM, prints(printed))).toEqual({ kind: 'started' });
    expect(await runStart(AM, prints('', printed))).toEqual({ kind: 'started' });
  });
});

describe('runStart — monkey', () => {
  it('exit 252 with its `** ` reason on STDOUT → refused, quoting the reason the ExecError message drops', async () => {
    const failure = execErrorLikeExec('adb -s e shell monkey -p p', 252, '', { stdout: `${MONKEY_ABORTED}\n` });
    expect(failure.message).not.toContain('No activities');
    expect(await runStart(MONKEY, throws(failure))).toEqual({
      kind: 'refused',
      command: 'monkey',
      lines: [MONKEY_ABORTED],
      cause: failure,
    });
  });

  it('exit 0 → started, whatever it printed (the exit is monkey\'s verdict)', async () => {
    expect(await runStart(MONKEY, prints(`${MONKEY_ABORTED}\n`))).toEqual({ kind: 'started' });
  });

  it("an am-style Error line is not monkey's diagnosis: a non-zero exit without `** ` lines passes through", async () => {
    const failure = execErrorLikeExec('adb -s e shell monkey -p p', 1, 'Error: something\n', { stdout: 'Error: else\n' });
    await expect(runStart(MONKEY, throws(failure))).rejects.toMatchObject({ cause: failure, exitCode: 1 });
  });

  it('a non-zero exit whose only `** ` is indented or mid-line passes through: the diagnosis starts in column 0', async () => {
    const failure = execErrorLikeExec('adb -s e shell monkey -p p', 1, '', { stdout: `  ${MONKEY_ABORTED}\nsaid ${MONKEY_ABORTED}\n` });
    await expect(runStart(MONKEY, throws(failure))).rejects.toMatchObject({ cause: failure, exitCode: 1 });
  });

  it("a non-zero exit with no `** ` line is re-thrown as a new ExecError, monkey's last 3 stdout lines added to its message and stack, the original as its cause", async () => {
    const failure = execErrorLikeExec('adb -s e shell monkey -p p', 255, "adb: device 'e' not found\n", {
      stdout: 'one\n\ntwo\nthree\n  four  \n\n',
    });
    const before = failure.message;
    const thrown = await runStart(MONKEY, throws(failure)).then(
      () => expect.fail('runStart resolved'),
      (e: unknown) => e as ExecError,
    );
    expect(thrown).toBeInstanceOf(ExecError);
    expect(thrown.message).toBe(`${before}\nmonkey printed: two / three / four`);
    // A new error, so the reason is in the stack too (V8 writes its header at
    // construction — a message mutated afterwards never reached it).
    expect(thrown.stack).toContain('monkey printed: two / three / four');
    expect(thrown.cause).toBe(failure);
    expect(failure.message).toBe(before);
    expect([thrown.command, thrown.exitCode, thrown.stderr, thrown.timedOut, thrown.stdout]).toEqual([
      failure.command,
      failure.exitCode,
      failure.stderr,
      failure.timedOut,
      failure.stdout,
    ]);
  });

  it('a non-zero exit with nothing on stdout leaves the message as it was', async () => {
    const failure = execErrorLikeExec('adb -s e shell monkey -p p', 255, "adb: device 'e' not found\n", { stdout: '\n  \n' });
    const before = failure.message;
    await expect(runStart(MONKEY, throws(failure))).rejects.toBe(failure);
    expect(failure.message).toBe(before);
  });

  it("am start's thrown failure is not given its stdout (only monkey's diagnosis lives there)", async () => {
    const failure = execErrorLikeExec('adb -s e shell am start', 255, "adb: device 'e' not found\n", { stdout: 'something\n' });
    const before = failure.message;
    await expect(runStart(AM, throws(failure))).rejects.toBe(failure);
    expect(failure.message).toBe(before);
  });

  it("`** ` lines are monkey's only: am start ignores them", async () => {
    expect(await runStart(AM, prints(`${MONKEY_ABORTED}\n`))).toEqual({ kind: 'started' });
  });
});

describe('runStart — what is not about starting is thrown as it came', () => {
  const commands: StartCommand[] = ['am start', 'monkey'];

  it.each(commands)('%s: a timeout, even one that had printed a diagnosis', async (command) => {
    const timedOut = execErrorLikeExec(`adb -s e shell ${command}`, null, `${UNRESOLVED_VIEW}\n`, { timedOut: true, stdout: `${MONKEY_ABORTED}\n` });
    await expect(runStart(ARGV[command], throws(timedOut))).rejects.toBe(timedOut);
  });

  it.each(commands)("%s: adb's own failure (device not found, exit 255)", async (command) => {
    const offline = execErrorLikeExec(`adb -s e shell ${command}`, 255, "adb: device 'e' not found\n");
    await expect(runStart(ARGV[command], throws(offline))).rejects.toBe(offline);
  });

  it.each(commands)('%s: anything that is not an ExecError', async (command) => {
    const odd = new TypeError('spawn adb ENOENT');
    await expect(runStart(ARGV[command], throws(odd))).rejects.toBe(odd);
  });
});

describe('runStart — the argv picks the reading, and is sent as it is', () => {
  it('send gets the argv unchanged', async () => {
    const sent: (readonly string[])[] = [];
    const send = async (argv: readonly string[]): Promise<ExecResult> => {
      sent.push(argv);
      return { stdout: Buffer.alloc(0), stderr: '' };
    };
    await runStart(AM, send);
    await runStart(MONKEY, send);
    expect(sent).toEqual([AM, MONKEY]);
  });

  it('the rule follows the argv: an am start printing a `** ` line at a non-zero exit is not a monkey refusal', async () => {
    const failure = execErrorLikeExec('adb -s e shell am start', 1, '', { stdout: `${MONKEY_ABORTED}\n` });
    await expect(runStart(AM, throws(failure))).rejects.toBe(failure);
  });

  it.each([
    ['am force-stop', ['am', 'force-stop', 'p']],
    ['pm clear', ['pm', 'clear', 'p']],
    ['an empty argv', []],
  ])('%s is not a start command: refused before anything is sent', async (_what, argv) => {
    let sent = false;
    const send = async (): Promise<ExecResult> => {
      sent = true;
      return { stdout: Buffer.alloc(0), stderr: '' };
    };
    await expect(runStart(argv, send)).rejects.toThrow(/runStart reads `am start` and `monkey` only/);
    expect(sent).toBe(false);
  });
});
