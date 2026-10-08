/**
 * What `adb shell` hands the device: ONE command line, run by the device's
 * `sh -c`. The one owner of turning an argv into that line (2026-10-07, the
 * Android adapter review's candidate 1).
 *
 * Why this module exists. The adb client does not pass an argv through: it
 * JOINS every argument after `shell` with a single space — unescaped, "just
 * like ssh(1)" (adb's commandline.cpp) — and sends that
 * string to the device, where `sh` (mksh on Android) splits it again — words,
 * quotes, `&`, `;`, `$`, backticks, globs and newlines all interpreted.
 * execFile adds no shell on the host, so the host side is safe and the
 * device side is not. Measured on emulator-5554 (API 33) by the review, with
 * harmless commands only, all three exiting 0:
 *
 *   -d app://login?a=1&b=2    the activity got `app://login?a=1`; `b=2` ran in the background
 *   --es key "hello world"     the extra arrived as `hello`, with a stray word `world`
 *   -d app://x/$HOME;id       `$HOME` was expanded and `id` was executed
 *
 * Before this module the adapter knew about the join in three places, each
 * its own way — typeText's backslash-escape regex, isAppRunning's package-name
 * validation ("could escape the shell"), INPUT_SHOWN_COMMAND's comment — and
 * the launch's intent data / extras and openDeepLink did not know at all: a
 * deep link with a second query parameter opened silently without it. The
 * tests could not see it, because their fake exec joined the argv with a
 * space exactly as lossily as adb does.
 *
 * The rule here: every word that is not made only of characters `sh` never
 * interprets goes inside single quotes, where POSIX sh (mksh included)
 * interprets NOTHING — a `'` inside the word is the one character that needs
 * care, written `'\''` (close, an escaped quote, reopen). The empty string is
 * `''`, so it stays an argument instead of vanishing. Plain words (`input`,
 * `tap`, `540`, `md.bank.app`, `md.bank.app/.MainActivity`,
 * `android.intent.action.VIEW`, `%s`) pass unquoted, so the command lines in
 * ExecError messages and in the tests read as they always did.
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
 * What changed for the adapter's callers, and what is not yet measured —
 * the ONE place this is written down (android.ts, its tests and
 * ARCHITECTURE.md §3 point here):
 * - typeText: until 2026-10-07 it escaped a list of shell metacharacters
 *   with a backslash of its own, a partial copy of this rule that missed
 *   `!`, `^`, a tab and a newline. Now each character is one quoted word.
 *   For `'`, `\` and the other escaped characters the argv `input text`
 *   receives is the same as before; UNVERIFIED on a device (the per-char
 *   typing and its pacing were measured in e594a21 / 00db84c / 2070647).
 * - typeText REFUSES a newline, a return or a tab. The old escaping let the
 *   device sh swallow them as separators (`input text` got no argument and
 *   failed), so refusing is no regression; delivering them literally would
 *   be one — `input text` likely turns a newline into an ENTER key event,
 *   which submits a form mid-fill (UNVERIFIED on a device; not risked). The
 *   deliberate route is `pressKey('enter')`. Since the code review the same
 *   day the refusal is stated where text is ACCEPTED, interact/type-text.ts,
 *   and widened: every C0 control character and DEL, on BOTH platforms,
 *   before any device call — a fill used to tap and clear its field before
 *   this adapter refused, and iOS still typed the characters. That CHANGED
 *   iOS: a `\n` in a value used to reach idb's `ui text` (typed as Return);
 *   it is refused now. The adapter's own check stays, as a defensive assert.
 * - isAppRunning: it validated the package name instead ("could escape the
 *   shell"), a third private answer to the same fact. The name is now quoted
 *   into its `rawShell` line; a name that is no real package simply matches
 *   no process.
 * - launch (intent data, extras) and openDeepLink had no answer at all; the
 *   three measured cases above are theirs.
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
 * command (2026-10-08): AndroidAdapter's `shell` and discovery.ts's getprop
 * on a listed device both call it, so neither spells the quoting itself.
 */
export function adbShellArgv(serial: string, argv: readonly string[]): string[] {
  return ['-s', serial, 'shell', ...argv.map(shellQuote)];
}
