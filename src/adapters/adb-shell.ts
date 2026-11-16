/**
 * What `adb shell` hands the device: ONE command line, run by the device's
 * `sh -c`. The one owner of turning an argv into that line.
 *
 * Why this module exists. The adb client does not pass an argv through: it
 * JOINS every argument after `shell` with a single space — unescaped, "just
 * like ssh(1)" (adb's commandline.cpp) — and sends that
 * string to the device, where `sh` (mksh on Android) splits it again — words,
 * quotes, `&`, `;`, `$`, backticks, globs and newlines all interpreted.
 * execFile adds no shell on the host, so the host side is safe and the
 * device side is not. Measured on emulator-5554 (API 33), with
 * harmless commands only, all three exiting 0:
 *
 *   -d app://login?a=1&b=2    the activity got `app://login?a=1`; `b=2` ran in the background
 *   --es key "hello world"     the extra arrived as `hello`, with a stray word `world`
 *   -d app://x/$HOME;id       `$HOME` was expanded and `id` was executed
 *
 * A test cannot see the loss through a fake exec that joins the argv with a
 * space: that join is exactly as lossy as adb's.
 *
 * The rule here: every word that is not made only of characters `sh` never
 * interprets goes inside single quotes, where POSIX sh (mksh included)
 * interprets NOTHING — a `'` inside the word is the one character that needs
 * care, written `'\''` (close, an escaped quote, reopen). The empty string is
 * `''`, so it stays an argument instead of vanishing. Plain words (`input`,
 * `tap`, `540`, `md.bank.app`, `md.bank.app/.MainActivity`,
 * `android.intent.action.VIEW`, `%s`) pass unquoted, so the command lines in
 * ExecError messages and in the tests stay readable.
 *
 * Deliberately NOT here:
 * - `adb exec-out`: there the adb CLIENT escapes every word after the
 *   command itself (`escape_arg`, adb_utils.cpp — the same single-quote
 *   scheme), so quoting here as well would deliver literal quotes. The
 *   adapter's `execOut` passes its argv to adb as it is.
 * - a command whose shell syntax IS the point — a pipe, `|| true` — is a
 *   raw line, written by its caller as one string (the adapter's
 *   `rawShell`). Any user-supplied word inside it still goes through
 *   `shellCommandLine` (isAppRunning's package name), so the line's own
 *   syntax is the only unquoted text that reaches the device.
 * - what a COMMAND does with its argument after the shell has delivered it:
 *   `input text` reads `%s` as a space — that is `input`'s vocabulary, and
 *   typeText keeps it.
 *
 * What this means for the adapter's callers, and what is not yet measured:
 * - typeText: each character is one quoted word. The argv `input text`
 *   receives for `'`, `\` and the other shell metacharacters is UNVERIFIED
 *   on a device (the per-char typing and its pacing were measured in
 *   e594a21 / 00db84c / 2070647).
 * - typeText REFUSES every C0 control character and DEL. Delivering a
 *   newline literally could submit a form mid-fill — `input text` likely
 *   turns it into an ENTER key event (UNVERIFIED on a device; not risked).
 *   The deliberate route is `pressKey('enter')`. The refusal is stated where
 *   text is ACCEPTED, interact/type-text.ts, on BOTH platforms, before any
 *   device call, so a fill does not tap and clear its field first. The
 *   adapter's own check stays, as a defensive assert.
 * - isAppRunning: the package name is quoted into its `rawShell` line, not
 *   validated; a name that is no real package simply matches no process.
 * - launch (intent data, extras) and openDeepLink: the three measured cases
 *   above are theirs.
 */

/**
 * The characters `sh` never interprets in a word, anywhere in it. Notably
 * absent: `=` (a first word `A=b` is an assignment), `~` and `#` (special at
 * a word's start), and every non-ASCII character (quoted rather than trusting
 * the device's locale).
 */
const PLAIN_WORD_RE = /^[A-Za-z0-9_@%+:,./-]+$/;

/** One argv word as the device's `sh` must see it to deliver it unchanged. */
export function shellQuote(word: string): string {
  if (PLAIN_WORD_RE.test(word)) return word;
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * The argv as one command line for the device's `sh -c`: each word quoted,
 * joined with a space — which is also what adb's own join produces from the
 * quoted words, so passing `argv.map(shellQuote)` as separate adb arguments
 * and passing this one string are the same bytes on the device.
 */
export function shellCommandLine(argv: readonly string[]): string {
  return argv.map(shellQuote).join(' ');
}

/**
 * `adb -s <serial> shell <argv>` as the argv handed to the `adb` binary, each
 * device word quoted by shellQuote — the one builder of a device shell
 * command, so no caller spells the quoting itself.
 */
export function adbShellArgv(serial: string, argv: readonly string[]): string[] {
  return ['-s', serial, 'shell', ...argv.map(shellQuote)];
}
