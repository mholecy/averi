import { spawnSync } from 'node:child_process';
import type { ExecFn, ExecResult } from '../../src/adapters/exec.js';

/**
 * A REAL shell playing the device's (2026-10-07, adb-shell.ts): what the
 * device command receives is decided by sh's parsing, so a fake that only
 * joins the argv with a space — the way `fakeExec` in android.test.ts does,
 * and the way adb itself does — reads `-d app://x?a=1&b=2` as intact while
 * the device cuts it at the `&`. This one parses the line as the device does.
 *
 * Host `/bin/sh` (bash in sh mode on macOS, dash on Linux) stands in for
 * Android's mksh. What the tests here rely on — single quotes deliver their
 * contents literally, `'\''` is a quote inside them, unquoted `& ; $ \` …`
 * are interpreted — is POSIX, the same in all three. One exception the
 * tests touch: brace expansion (`a{x,y}b`) is NOT POSIX — mksh and
 * bash-as-sh expand it, dash does not — so that one case only bites on a
 * host whose /bin/sh is bash (macOS).
 *
 * Every device command the adapter sends is defined as a shell function that
 * RECORDS its argv instead of doing anything. Nothing else can run: the sh
 * gets a PATH with no directory in it, so an unlisted command (an injected
 * `id`, `touch`) is "not found", and any stderr makes `runOnDeviceSh` THROW
 * with it. A builtin that slips through (`echo`) writes outside the record
 * format, and that stray output becomes a record of its own, failing the
 * expectation with the text in the diff.
 */
const DEVICE_COMMANDS = [
  'am', 'pm', 'monkey', 'input', 'pidof', 'dumpsys', 'grep', 'wm', 'getprop', 'screencap', 'uiautomator',
];
const ARG_SEP = '\x1f';
const RECORD_SEP = '\x1e';
/** A PATH that names no existing directory: only builtins and the recorders below can run. */
const NO_PATH = '/nonexistent-averi-device-sh';
const PRELUDE = [
  `rec() { for a; do printf '%s\\037' "$a"; done; printf '\\036'; }`,
  // pidof answers "no such process" (exit 1), so `pidof x || true` takes its `||`.
  ...DEVICE_COMMANDS.map((c) => (c === 'pidof' ? `${c}() { rec ${c} "$@"; return 1; }` : `${c}() { rec ${c} "$@"; }`)),
].join('\n');

/** Run one command line through the host sh with the recording commands; the argv of every command it ran. */
export function runOnDeviceSh(line: string): string[][] {
  const result = spawnSync('/bin/sh', ['-c', `${PRELUDE}\n${line}`], { timeout: 5_000, env: { PATH: NO_PATH } });
  if (result.error) throw result.error;
  const stderr = result.stderr.toString('utf8');
  if (stderr !== '') throw new Error(`the device sh ran something it should not have: ${stderr.trim()} (line: ${line})`);
  const out = result.stdout.toString('utf8');
  const stray = out.split(RECORD_SEP).pop();
  // Anything after the last record is output of a command that is not a
  // recorder — an injected one. Surface it as a record of its own so the
  // expectation fails with the stray text in the diff.
  const records = out.split(RECORD_SEP).slice(0, -1).map((r) => r.split(ARG_SEP).slice(0, -1));
  return stray ? [...records, ['<stray output>', stray]] : records;
}

/**
 * adb's own `escape_arg` (adb_utils.cpp), written out independently of
 * src/adapters/adb-shell.ts so the fake models adb, not the code under test:
 * EVERY word single-quoted, a `'` inside as `'\''`.
 */
function adbEscapeArg(word: string): string {
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * An ExecFn that plays `adb` + the device: it does what the adb client does
 * with the arguments — after `shell`, joins them with one space, unescaped
 * (commandline.cpp: "We don't escape here, just like ssh(1)"); after
 * `exec-out`, sends the first as is and each further one through
 * `escape_arg` (commandline.cpp, exec-in/exec-out) — and hands that line to
 * `runOnDeviceSh`. `commands` is every device-side
 * argv in order; `adbArgv` the raw argv adb was given. Each call answers
 * with `reply` (empty by default).
 */
export function deviceShExec(reply: (argv: string[]) => Partial<ExecResult> = () => ({})) {
  const commands: string[][] = [];
  const adbArgv: string[][] = [];
  const fn: ExecFn = async (_cmd, args) => {
    adbArgv.push(args);
    const rest = args[0] === '-s' ? args.slice(2) : args;
    const line = rest[0] === 'shell'
      ? rest.slice(1).join(' ')
      : rest[0] === 'exec-out'
        ? [rest[1], ...rest.slice(2).map(adbEscapeArg)].join(' ')
        : undefined;
    if (line !== undefined) for (const argv of runOnDeviceSh(line)) commands.push(argv);
    const answer = reply(rest);
    return { stdout: answer.stdout ?? Buffer.alloc(0), stderr: answer.stderr ?? '' };
  };
  return { fn, commands, adbArgv };
}
