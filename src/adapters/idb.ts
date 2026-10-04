import type { ExecFn, ExecResult } from './exec.js';
import { detectXcodeEnv } from './xcode-env.js';

/**
 * One idb invocation, the way every idb caller makes it — IosAdapter's input
 * methods (tap, swipe, text, keys, viewport) and the idb tree source alike:
 * the Xcode env probe first (xcode-env.ts, memoized per ExecFn), then
 * `idb <args> --udid <udid>` — the flag LAST, as idb's CLI wants it after the
 * subcommand. A leaf beside xcode-env.ts, not part of the tree-source seam,
 * because input uses it and input is not behind that seam (review
 * 2026-10-03). Written once since 2026-10-03; the two copies were identical.
 */
export function runIdb(
  exec: ExecFn,
  udid: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<ExecResult> {
  return detectXcodeEnv(exec).then((env) =>
    exec('idb', [...args, '--udid', udid], { env, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) }),
  );
}
