import type { DeviceAdapter, Platform } from '../adapters/types.js';
import type { AveriConfig } from '../flow/config.js';
import { errorMessage } from '../util/error-message.js';

/**
 * App health: is the app under test still running, and if not, what the device's logs say about why — the
 * `appAlive:` line (ARCHITECTURE.md §8) — and the device-log excerpt `get_logs` returns. One module since A29
 * (docs/plans/2026-10-30-performance-backlog.md; docs/adr/0039-ios-liveness-asks-the-hosts-process-list.md, the A29
 * amendment): until then the crash signatures sat in verify/assert.ts, which never used them, and the line and the
 * excerpt in run/verify.ts, the `verify` tool's orchestration.
 *
 * Its place is run/ (A24's order, tests/architecture/layering.test.ts): the app to ask about is averi.yaml's
 * (`app.<platform>`, flow/config.ts), above verify/, and its callers are run/'s compositions and mcp/'s get_logs.
 * It is not an assert (verify/), and not a device command (adapters/): it reads the adapter's two answers,
 * `isAppRunning` and `logs`, and words them.
 *
 * The failure policy, one for every caller (A29): **appHealth words every device failure into the line, and has no
 * other failure.** A question the device cannot answer is `appAlive: unknown`; logs that cannot be read cost the crash
 * excerpt, never the verdict. So the callers — `ensure_state`, `run_flow`, `assert` and each `verify` leg — await it
 * bare. What is left to throw is an adapter that breaks its contract (a `logs` that resolves to no array), and that
 * is a bug, so it fails the call as any other throw in it does: `ensure_state`, `run_flow` and `assert` reject, a
 * `verify` leg is its `FAILED:` section (the leg's containment of any throw, run/verify.ts). Until A29 `assert`
 * alone caught it and dropped the line; no real adapter reaches that (run/commands.ts#runAsserts).
 */

/** Crash signatures per platform, scanned over recent device logs. */
const CRASH_PATTERNS: Record<Platform, RegExp[]> = {
  android: [/FATAL EXCEPTION/, /ANR in /, /Force finishing activity/, /native crash/i, /SIGSEGV|SIGABRT/],
  ios: [
    /Terminating app due to uncaught exception/,
    /NSInvalidArgumentException|NSRangeException/,
    /EXC_BAD_ACCESS|EXC_CRASH/,
    /abort\(\) called/,
    /Fatal error:/,
  ],
};

/** Crash-related log lines, each with a little trailing context for its stack trace. */
function scanForCrashes(lines: string[], platform: Platform): string[] {
  const patterns = CRASH_PATTERNS[platform];
  const excerpt: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((p) => p.test(lines[i]))) {
      excerpt.push(...lines.slice(i, i + 8));
      i += 7;
    }
  }
  return excerpt;
}

/**
 * The health line, opening with its own newline, or '' when averi.yaml names no app for the adapter's platform. When
 * the app died, a crash excerpt from the last 60 s of logs follows, so a run that ended on a blank screen says why.
 * Which replies carry it is the callers' call (run/commands.ts, run/verify.ts); what it does on a failure is this
 * module's (above).
 */
export async function appHealth(adapter: DeviceAdapter, cfg: AveriConfig): Promise<string> {
  const app = cfg.app[adapter.platform];
  if (!app) return '';
  const appId = 'package' in app ? app.package : app.bundleId;
  let running: boolean;
  try {
    running = await adapter.isAppRunning(appId);
  } catch (e) {
    // The question could not be ASKED — a device under load or unreachable is
    // not a dead app, and saying `false` here sends the caller after a crash
    // that never happened (measured 2026-09-17, finportal b4).
    const why = errorMessage(e).split('\n')[0];
    const check = adapter.platform === 'android'
      ? 'check `adb devices` and host load'
      : 'check `xcrun simctl list devices booted` and host load (reboot the simulator if it does not answer)';
    return (
      `\nappAlive: unknown — could not ask the device whether ${appId} runs (${why}); ` +
      `the device is unreachable or under load. NOT evidence that the app died — ${check}, then retry.`
    );
  }
  if (running) return '\nappAlive: true';
  const lines = await adapter.logs(Date.now() - 60_000).catch(() => [] as string[]);
  const crashes = scanForCrashes(lines, adapter.platform).slice(0, 24);
  return (
    `\nappAlive: false — ${appId} is not running!` +
    (crashes.length > 0 ? `\nCrash excerpt:\n${crashes.join('\n')}` : '\n(no crash signature in the last 60s of logs)')
  );
}

/**
 * The flags a log grep compiles with — case-insensitive, nothing else. Named
 * so get_logs' schema validates the pattern under the same flags
 * (util/regex.ts) rather than a copy of them. Never `g` or `y`:
 * formatLogExcerpt compiles the pattern once and calls `.test` on every line,
 * and a global or sticky regex carries `lastIndex` from one line into the
 * next, silently dropping matches.
 */
export const LOG_GREP_FLAGS = 'i';

/**
 * How many matching lines a log excerpt keeps when the caller names no
 * budget — the tail, where the failure is. Owned here, where the limit is
 * applied; the MCP get_logs tool's schema default and description quote it.
 * (Until 2026-10-08 this function defaulted to 2000 while the tool's schema
 * said 400, two defaults for one limit.)
 */
export const LOG_MAX_LINES = 400;

/**
 * Device-log excerpt: filter to a regex, keep the tail, and say what that did.
 * Pure — it takes the lines rather than the device — because the COUNTING is
 * the part that misleads when it is wrong: a grep that silently matched
 * nothing reads exactly like a quiet device, and a truncated pull that does
 * not admit it reads like the whole story. Worth a test; untestable inside a
 * tool handler.
 */
export function formatLogExcerpt(all: string[], grep: string | undefined, maxLines = LOG_MAX_LINES): string {
  const re = grep === undefined ? undefined : new RegExp(grep, LOG_GREP_FLAGS);
  const lines = re === undefined ? all : all.filter((l) => re.test(l));
  const tail = lines.slice(-maxLines);
  const header: string[] = [];
  if (grep !== undefined) header.push(`[grep /${grep}/${LOG_GREP_FLAGS} matched ${lines.length} of ${all.length} lines]`);
  if (lines.length > tail.length) {
    header.push(`[truncated: showing last ${maxLines} of ${lines.length} lines]`);
  }
  return [...header, ...tail].join('\n');
}
