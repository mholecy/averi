import { channel } from 'node:diagnostics_channel';
import { DEFAULT_TIMEOUT_MS, ExecError, type ExecFn, type ExecResult } from './exec.js';
import { IdbHelperTimeout, type IdbHelper } from './idb-helper.js';
import { detectXcodeEnv } from './xcode-env.js';

/**
 * The idb calls the helper may serve (D7a): reads alone, so a helper that dies under one can be retried on the CLI —
 * a read twice is still one read. Input (tap, text, swipe, key) stays on the CLI until D7b decides what a helper that
 * dies under a HID event means (it may have been delivered).
 */
const HELPER_ARGV: readonly (readonly string[])[] = [['ui', 'describe-all', '--json']];

const helperServes = (args: readonly string[]) => HELPER_ARGV.some((a) => a.length === args.length && a.every((w, i) => w === args[i]));

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
 * subcommand. A leaf beside xcode-env.ts, not part of the tree-source seam,
 * because input uses it and input is not behind that seam (review
 * 2026-10-03). Written once since 2026-10-03; the two copies were identical.
 *
 * With a `helper` (D7a, docs/adr/0032-a-persistent-idb-helper-runs-the-cli-in-process.md) an argv of HELPER_ARGV is
 * offered to it first; when it takes the call, the answer is the CLI's, to the byte of the error an agent reads: a
 * nonzero code throws the ExecError exec builds for the same failure (`Command failed (exit N): idb <argv> --udid U`
 * and the stderr — exec.ts), a timeout the same `Command timed out: idb …`; a helper that died under the call (it is
 * a read) is retried once on the CLI, whose answer or error is the one returned. When it does not take the call (not
 * ready yet, busy, off), the CLI runs as before.
 */
export async function runIdb(
  exec: ExecFn,
  udid: string,
  args: string[],
  opts: { timeoutMs?: number; helper?: IdbHelper } = {},
): Promise<ExecResult> {
  const env = await detectXcodeEnv(exec);
  const argv = [...args, '--udid', udid];
  const pending = opts.helper !== undefined && helperServes(args) ? opts.helper.run(argv, { env, timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS }) : undefined;
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
  }
  return exec('idb', argv, { env, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
}
