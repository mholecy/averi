/**
 * iOS app liveness from the HOST's process list (D33, ADR 0039): a
 * simulator app is a macOS process, so `/usr/bin/pgrep -f` of its exact
 * executable path answers "is it running" in ~19 ms where
 * `simctl spawn launchctl list` takes ~240 ms. No I/O here — the pattern,
 * the reading of pgrep's outcome and its reason (it imports exec.ts only for
 * the ExecError class its `instanceof` reads); IosAdapter owns the calls,
 * the cache and the launchctl confirmation of every "no".
 */
import { ExecError } from './exec.js';
import { withoutHostPaths } from './failure-text.js';
import type { AppBinary } from './simctl-appinfo.js';
import { errorMessage } from '../util/error-message.js';

/**
 * The POSIX-ERE pattern `pgrep -f` matches the app's process by: the
 * bundle's `Path`, `/`, its `CFBundleExecutable`, then a space or the end
 * (`/Foo.app/FooHelper`, `/Foo.app/PlugIns/W.appex/W` are not the app).
 * The exact Path carries this simulator's UDID and the bundle container's
 * GUID, so the same app on another simulator, or another bundle with the
 * same executable name (every Flutter app's `Runner`), never matches. Not
 * anchored at the start: an argv[0] that differs from Path in a prefix
 * still matches. The pattern never matches its own text (a concurrent
 * pgrep's argv): it holds `\.app` where the path has `.app`.
 *
 * Undefined — ask launchctl — when either key is missing, or the Path is
 * not one of THIS simulator's user-app bundle containers (compared without
 * case, as APFS compares paths — a UDID may come in either): a system app's
 * Path is in the runtime root, the same on every simulator of that
 * runtime, so the host list cannot tell which simulator runs it.
 */
export function hostProcessPattern(info: AppBinary, udid: string): string | undefined {
  const { path, executable } = info;
  if (path === undefined || executable === undefined || executable === '') return undefined;
  const containers = `/${udid}/data/Containers/Bundle/Application/`.toLowerCase();
  if (!path.toLowerCase().includes(containers)) return undefined;
  return `${ereEscape(path)}/${ereEscape(executable)}( |$)`;
}

/**
 * Backslash before each POSIX-ERE special and nothing else: a backslash
 * before an ordinary character is undefined in ERE (so not a JS escaper
 * that also escapes `-` or `/`). The same 14 characters as
 * util/regex.ts#escapeRegExp, kept apart because ERE is another grammar
 * (T22): a change to one JS escape is no change to what pgrep reads.
 */
function ereEscape(text: string): string {
  return text.replace(/[\\.[\]()*+?{}|^$]/g, '\\$&');
}

/**
 * What pgrep's outcome says (undefined = it exited 0): `yes` a process
 * matched; `no` none did (exit 1); `timeout` it did not answer in time
 * (this call only); `unreadable` anything else — exit 2 (usage, a regex
 * error), exit 3 (it could not get the process list: measured inside the
 * Claude Code sandbox, 2026-11-02), no exit code at all (spawn failed) or
 * an error that is not exec's.
 */
export function pgrepVerdict(error: unknown): 'yes' | 'no' | 'timeout' | 'unreadable' {
  if (error === undefined) return 'yes';
  if (!(error instanceof ExecError)) return 'unreadable';
  if (error.timedOut) return 'timeout';
  return error.exitCode === 1 ? 'no' : 'unreadable';
}

/**
 * Why pgrep failed, for the one stderr line that says liveness falls back
 * to launchctl: `exit N: <stderr's last non-empty line>` — not the error's
 * message, whose head is the whole command line with its long pattern.
 * exec puts node's "Command failed: <cmd>" in stderr when the child wrote
 * nothing; that line is dropped (`exit N` alone). No exit code (a spawn
 * failure): the line alone. Not exec's error: its message's first line. Host paths leave the line; `home` is the
 * caller's, as this leaf reads nothing.
 */
export function pgrepReason(error: unknown, home: string): string {
  if (!(error instanceof ExecError)) return errorMessage(error).split('\n')[0];
  const last = error.stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('Command failed:'))
    .at(-1);
  const line = last === undefined ? undefined : withoutHostPaths(last, home);
  if (error.exitCode === null) return line ?? 'no exit code';
  return line === undefined ? `exit ${error.exitCode}` : `exit ${error.exitCode}: ${line}`;
}
