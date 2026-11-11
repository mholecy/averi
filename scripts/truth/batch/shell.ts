/**
 * The batches' one host-shell quoter (backlog A21, the review's TL8): a word in a hand line a person pastes into their
 * own shell — a RESTORE line, a state file's clean command, a `pkill -f` pattern, a `defaults` key. A leaf: every
 * batch module that prints such a line imports it from here (ios-defaults.ts, run-dir.ts, the lab plumbing, the
 * standing batches), none keeps a copy. The device's `sh` (adb shell) has its own, src/adapters/adb-shell.ts's, which
 * the chooser's hand lines use for the words adb carries (chooser-readers.ts#adbLine).
 */

/** A word single-quoted whatever it holds: nothing in it expands, a `'` written as `'\''`. */
export const singleQuoted = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;

/** A word as a shell reads it back: as given when plain, else single-quoted (singleQuoted). */
export const shellQuote = (s: string): string => (/^[\w@%+=:,./-]+$/.test(s) ? s : singleQuoted(s));
