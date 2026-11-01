import { channel } from 'node:diagnostics_channel';
import { DEFAULT_TIMEOUT_MS, ExecError, type ExecFn, type ExecResult } from './exec.js';
import { IdbHelperTimeout, type IdbHelper } from './idb-helper.js';
import { detectXcodeEnv } from './xcode-env.js';

/** A number as IosAdapter writes one into an argv (`String(x)`, `String(ms / 1000)`). */
const NUM = /^-?\d+(\.\d+)?$/;
/** Any one string — `ui text`'s text (what the CLI and the helper would both receive alike: sameForBoth). */
const ANY = /^[\s\S]*$/;
/** One or more numbers, to the end of the argv — `ui key-sequence`'s codes (clearText sends `count` of them). Last only. */
const NUMS = Symbol('one or more numbers');
/** A word of an allowlisted shape: a literal, a pattern (NUM, ANY), or NUMS as the last word. */
type Word = string | RegExp | typeof NUMS;

/**
 * The idb calls the helper may serve, word by word, the `--udid` excluded (runIdb appends it last, as for the CLI):
 * - D7a: the tree read, `ui describe-all --json`. A read: a helper that dies under one is retried on the CLI.
 * - D26b: the screenshot (on either tree source since D44), `screenshot -` (the PNG on stdout, carried as base64 of its bytes —
 *   idb-helper-script.ts). A read too: it changes nothing on the simulator, so a death under it is retried on the CLI;
 *   its timeout is the caller's (ios.ts, 15 s as describe-all's) and counts toward TIMEOUTS_IN_A_ROW like any other.
 *   `screenshot <file>` (or none) is the CLI's: averi never sends it.
 * - D7b: every HID argv IosAdapter sends (ios.ts) — tap, longPress (`tap … --duration`), swipe, typeText (D24's split
 *   included: two `ui text`), clearText (`key-sequence` 42… then 76…), pressKey (`key 40`, `button HOME`). Input: a
 *   helper that dies under one is NOT retried — the event may have reached the simulator (HID_ARGV, runIdb).
 * Exactly these shapes and nothing near them: an argv averi does not send, or a word out of shape (a number that is
 * no plain decimal, another button), is the CLI's, as before D7. `describe --json` (the memoized viewport, one call an
 * adapter) stays on the CLI: not worth a shape.
 */
const READ_ARGV: readonly (readonly Word[])[] = [
  ['ui', 'describe-all', '--json'],
  ['screenshot', '-'],
];
const HID_ARGV: readonly (readonly Word[])[] = [
  ['ui', 'tap', NUM, NUM],
  ['ui', 'tap', NUM, NUM, '--duration', NUM],
  ['ui', 'swipe', NUM, NUM, NUM, NUM, '--duration', NUM],
  ['ui', 'text', ANY],
  ['ui', 'key-sequence', NUMS],
  ['ui', 'key', NUM],
  ['ui', 'button', 'HOME'],
];

/** Whether an argv is of a shape: as many words as it has (or, ending in NUMS, at least one more), each fitting. */
function fits(shape: readonly Word[], args: readonly string[]): boolean {
  const variadic = shape.at(-1) === NUMS;
  const fixed = (variadic ? shape.slice(0, -1) : shape) as readonly (string | RegExp)[];
  if (variadic ? args.length <= fixed.length : args.length !== fixed.length) return false;
  return args.every((a, i) => {
    const w = i < fixed.length ? fixed[i] : NUM;
    return typeof w === 'string' ? w === a : w.test(a);
  });
}

/**
 * A word the CLI and the helper would receive differently (D7b, `ui text` takes any string): a lone surrogate reaches
 * the CLI's argv as U+FFFD (node encodes it so) but the helper's JSON as the surrogate itself, which fb-idb's gRPC
 * cannot encode; a NUL makes execFile refuse the call where the helper would type it. Measured 2026-10-31 (node 22).
 * Such an argv is the CLI's, so either way the outcome is what it was before D7.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const sameForBoth = (args: readonly string[]) => args.every((w) => !w.includes('\0') && !LONE_SURROGATE.test(w));

/** Which allowlist an argv is on, or none: the CLI's alone. */
function helperKind(args: readonly string[]): 'read' | 'input' | undefined {
  if (!sameForBoth(args)) return undefined;
  if (READ_ARGV.some((s) => fits(s, args))) return 'read';
  if (HID_ARGV.some((s) => fits(s, args))) return 'input';
  return undefined;
}

/**
 * The helper died with an input request it had taken (D7b): it acknowledged the line (`{"got": id}`, idb-helper.ts),
 * so gen_main was running it, and the HID event may or may not have reached the simulator — fb-idb sends it over the
 * companion's gRPC before it answers, and a death between the two is indistinguishable from one before. Not retried:
 * a tap repeated is two taps, a `ui text` repeated types the text twice. (A request the helper never took is `unsent`
 * and runs on the CLI.) Thrown in exec's shape — an ExecError, exit `null` as a CLI killed by a signal reads, not
 * timed out — so the first line is exec's, `Command failed (exit null): idb ui tap 120 640 --udid U`, and INPUT_LOST
 * stands where the CLI's stderr would. The one error text the helper adds (ADR 0032, D7b); nothing in averi matches
 * idb's input errors by text (grep 2026-10-31: only ExecError.timedOut is read, by OCR and Android).
 */
export const INPUT_LOST =
  'the idb helper exited during this input; it may or may not have reached the simulator — look at the screen before repeating it';

export function inputLost(command: string): ExecError {
  return new ExecError(command, null, INPUT_LOST);
}

/**
 * A helper call, as the D0 harness sees it (scripts/perf/instrument.ts): it is no process, so the execFile wrapper
 * never sees it. `start` is published with `{ argv }` when the helper takes a call, `end` with the same object and
 * `ok` set when it answers (a nonzero code, a death, a timeout: not ok) — the subscriber keys its record by the object.
 */
export const IDB_HELPER_CALL_START = channel('averi:idb-helper:start');
export const IDB_HELPER_CALL_END = channel('averi:idb-helper:end');
export interface IdbHelperCall {
  argv: readonly string[];
  ok?: boolean;
}

/**
 * One idb invocation, the way every idb caller makes it — IosAdapter's input
 * methods (tap, swipe, text, keys, viewport) and the idb tree source alike:
 * the Xcode env probe first (xcode-env.ts, memoized per ExecFn), then
 * `idb <args> --udid <udid>` — the flag LAST, as idb's CLI wants it after the
 * subcommand. Beside xcode-env.ts, not part of the tree-source seam, because
 * input uses it and input is not behind that seam (review 2026-10-03).
 * Written once since 2026-10-03; the two copies were identical. Since D7a it
 * also routes to the idb helper (idb-helper.ts) and publishes the helper's
 * calls on the diagnostics channels above.
 *
 * With a `helper` (D7a, docs/adr/0032-a-persistent-idb-helper-runs-the-cli-in-process.md) an argv on READ_ARGV or
 * HID_ARGV (helperKind) is offered to it first; when it takes the call, the answer is the CLI's, to the byte of the
 * error an agent reads: a nonzero code throws the ExecError exec builds for the same failure (`Command failed (exit
 * N): idb <argv> --udid U` and the stderr — exec.ts), a timeout the same `Command timed out: idb …`; a helper that
 * died under a read is retried once on the CLI, whose answer or error is the one returned — under an input it had
 * taken (D7b) it is not: inputLost says the event may or may not have landed. A request the helper never took
 * (`unsent`: the write failed, or it died before it acknowledged the line) runs on the CLI either way. When the helper
 * does not take the call (not ready yet, busy, off), the CLI runs as before.
 */
export async function runIdb(
  exec: ExecFn,
  udid: string,
  args: string[],
  opts: { timeoutMs?: number; helper?: IdbHelper } = {},
): Promise<ExecResult> {
  const env = await detectXcodeEnv(exec);
  const argv = [...args, '--udid', udid];
  const kind = helperKind(args);
  const pending = opts.helper !== undefined && kind !== undefined ? opts.helper.run(argv, { env, timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS }) : undefined;
  if (pending !== undefined) {
    const command = ['idb', ...argv].join(' ');
    const call: IdbHelperCall = { argv };
    IDB_HELPER_CALL_START.publish(call);
    const end = (ok: boolean) => {
      call.ok = ok;
      IDB_HELPER_CALL_END.publish(call);
    };
    let reply;
    try {
      reply = await pending;
    } catch (e) {
      end(false);
      if (e instanceof IdbHelperTimeout) throw new ExecError(command, null, '', true);
      throw e;
    }
    end(reply.kind === 'answer' && reply.code === 0);
    if (reply.kind === 'answer') {
      // exec passes node's own message when stderr is empty: `Command failed: <command>\n` (child_process.execFile).
      if (reply.code !== 0) throw new ExecError(command, reply.code, reply.stderr || `Command failed: ${command}\n`, false, reply.stdout);
      return { stdout: reply.stdout, stderr: reply.stderr };
    }
    // `unsent` never reached the helper: the CLI runs it below, input or not. A read the helper died under is retried
    // there too; an input it died under may already have reached the simulator.
    if (reply.kind === 'died' && kind === 'input') throw inputLost(command);
  }
  return exec('idb', argv, { env, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
}
