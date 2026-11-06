/** What exec knows of a failed host command: ExecError's own fields, which keep every byte for detectors and logs. */
export interface CommandFailure {
  command: string;
  exitCode: number | null;
  stderr: string;
  timedOut: boolean;
  note?: string;
}

/** A traceback's header on its own line, behind the margin an exception group prints; the margin's width is where its lines start. */
const TRACEBACK_HEADER = /^([ |+]*)(?:Exception Group )?Traceback \(most recent call last\):$/;
/** A header behind a log prefix (`[ERROR] Traceback …`). Only a frame beneath tells it from a sentence that mentions one. */
const PREFIXED_HEADER = /\bTraceback \(most recent call last\):$/;
const FRAME = /^\s+File "/;
const isHeader = (lines: readonly string[], at: number): boolean =>
  TRACEBACK_HEADER.test(lines[at]) || (PREFIXED_HEADER.test(lines[at]) && FRAME.test(lines[at + 1]));

/** The longest exception line a reply holds, in code points: a message can carry a whole response. */
const EXCEPTION_MAX = 300;
function bounded(exception: string): string {
  const points = [...exception];
  return points.length > EXCEPTION_MAX ? `${points.slice(0, EXCEPTION_MAX).join('')}…` : exception;
}

/**
 * The exception under a traceback's header: the first line at the header's margin, frames being indented further and an
 * exception group's rules made of `+` and `-`. A line that ends at its colon takes the next line with text as its message,
 * rules skipped, when that line is indented; one that is not may be a log line, and stays out.
 */
function exceptionUnder(below: readonly string[], margin: number): string | undefined {
  const lines = below.map((line) => line.slice(margin));
  const at = lines.findIndex((line) => line !== '' && !/^[ +-]/.test(line));
  if (at === -1) return undefined;
  const exception = lines[at].trimEnd();
  if (!exception.endsWith(':')) return exception;
  const why = lines.slice(at + 1).find((line) => line.trim() !== '' && !/^\s*[+-]/.test(line));
  return why === undefined || !/^\s/.test(why) ? exception : `${exception} ${why.trim()}`;
}

/** The tool a command line runs: its first word's last path segment, and for xcrun what it runs. */
function toolOf(command: string): string {
  const [first, second] = command.split(' ');
  return first === 'xcrun' && second !== undefined ? second : first.split('/').at(-1)!;
}

/** `stderr` as an agent reads it: trimmed, or one line when it holds a Python traceback, scrubbed before it is bounded: a cut home would no longer match. */
function stderrForAgent(command: string, stderr: string, home: string): string {
  const lines = stderr.split(/\r?\n/);
  const header = lines.map((_, at) => isHeader(lines, at)).lastIndexOf(true);
  if (header === -1) return stderr.trim();
  const margin = TRACEBACK_HEADER.exec(lines[header])?.[1].length ?? 0;
  const exception = exceptionUnder(lines.slice(header + 1), margin);
  return `${toolOf(command)} crashed${exception === undefined ? '' : `: ${bounded(withoutHostPaths(exception, home))}`} (Python traceback left out: run the command by hand, with the real text and paths, to see it)`;
}

/** What stands where a typed text stood. */
const TYPED_TEXT = '<typed text>';

/**
 * The two argvs that hold a typed text: `idb ui text <text> --udid U` (ios.ts#typeText), `adb [-s S] shell input text
 * <one character>` (android.ts#typeText). Their shapes are those adapters'; a comment at each site names this list, and
 * the adapters' own tests drive their real argv through it.
 */
const IDB_TYPING = /^(idb ui text )[\s\S]*( --udid \S+)$/;
// The empty group: withoutTypedText's one replacement names `$2` for both shapes.
const ADB_TYPING = /^(adb(?: -s \S+)? shell input text )[\s\S]*()$/;

const withoutTypedText = (command: string): string =>
  [IDB_TYPING, ADB_TYPING].reduce((out, argv) => out.replace(argv, `$1${TYPED_TEXT}$2`), command);

/**
 * argparse's own line, `idb[ …]: error: <why>`, whose why quotes a text taken for an option (`-hunter2`, `--log=s3cret`),
 * across lines if the text holds one. argparse exits right after it, with 2 (idb-helper-script.ts keeps that code), so it
 * goes to stderr's end.
 */
const ARGPARSE_ERROR = /^idb[^:\n]*: error: [\s\S]*/m;
const ARGPARSE_EXIT = 2;
const IDB_REJECTED = 'idb rejected its arguments (its error line, which can quote the typed text, is left out)';

/** Where a path word ends: the marks around a path in a message, whitespace. */
const STOP = String.raw`\s"'` + '`' + String.raw`()\[\],<>`;
/** Where a host path may start: a line's or word's start, after an opening mark, `=` or `file://`. So `/data/local/tmp/…`, inside a word, never matches. */
const WORD_START = String.raw`(?<=^|[\s"'` + '`' + String.raw`(\[<,=]|file://)`;
const PATH_REST = `(/[^${STOP}]*)?(?![^${STOP}])`;

/** Any macOS or Linux home at a word's start. `/Users/Shared` is nobody's home. */
const ANY_HOME = new RegExp(
  String.raw`${WORD_START}/(?:Users/(?!Shared(?![^${STOP}/]))[^${STOP}/]+|home/[^${STOP}/]+|root(?![^${STOP}/]))`,
  'g',
);
/** Folders only a host has, each reduced to a mark and the path's last word. */
const HOST_FOLDERS: readonly (readonly [RegExp, string])[] = [
  [new RegExp(String.raw`${WORD_START}/(?:private/)?(?:tmp|var/tmp|var/folders)${PATH_REST}`, 'g'), '<tmp>'],
  [new RegExp(String.raw`${WORD_START}/(?:Volumes|opt)${PATH_REST}`, 'g'), '…'],
];

const escaped = (literal: string): string => literal.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** A home of two folders or more is the user's alone, so it goes anywhere; `/tmp` or `/root` may end any device path, so it goes at a word's start. */
function withoutOwnHome(text: string, home: string): string {
  const folder = home.replace(/\/+$/, '');
  if (!folder.startsWith('/')) return text;
  const anywhere = folder.split('/').length > 2;
  return text.replace(new RegExp(`${anywhere ? '' : WORD_START}${escaped(folder)}(?![\\w.-])`, 'gm'), '~');
}

/** A word holding `scheme://` or starting `scheme:`: what looks like a path inside it is the URL's. `file:`'s is the host's. */
const URL_WORD = /(?<![a-z0-9+.-])(?!file:)[a-z][a-z0-9+.-]*:\/\/|^(?!file:)[a-z][a-z0-9+.-]*:/i;

function wordWithoutHostFolders(word: string): string {
  if (URL_WORD.test(word)) return word;
  let out = word.replace(ANY_HOME, '~');
  for (const [folder, mark] of HOST_FOLDERS) {
    out = out.replace(folder, (_whole, rest: string | undefined) => {
      const last = rest?.split('/').filter((part) => part !== '').at(-1);
      return last === undefined ? mark : `${mark}/${last}`;
    });
  }
  return out;
}

/**
 * `text` with its host paths out: the rule of every quote of a host command's words, the three readers that quote
 * `stderr` themselves included (android.ts's dump and get-state diagnosis, ios-liveness.ts#pgrepReason). The own home goes
 * first, over the whole text, since it may hold a space; every other rule goes word by word.
 */
export function withoutHostPaths(text: string, home: string): string {
  return withoutOwnHome(text, home).replace(/\S+/g, wordWithoutHostFolders);
}

/** The longest a tool's name is read: a near-maximal argv must not make the last resort throw as well. */
const TOOL_NAME_MAX = 256;

/**
 * The words when commandFailureText threw: only the tool and the exit, or the timeout, so nothing it takes out can stand
 * here. It cannot throw itself, on any value: the error it words must survive.
 */
export function lastResortText({ command, exitCode, timedOut }: CommandFailure): string {
  try {
    const tool = toolOf(String(command).slice(0, TOOL_NAME_MAX));
    return timedOut ? `Command timed out: ${tool}` : `Command failed (exit ${exitCode}): ${tool}`;
  } catch {
    return 'Command failed';
  }
}

/**
 * The message of a failed host command (D70, ADR 0043). exec's shape, `Command failed (exit N): <argv>⏎<stderr>` or
 * `Command timed out: <argv>`, byte for byte, except that a Python traceback shrinks to one line, a typed text leaves
 * the argv and argparse's line, and host paths leave the whole text. `home` is a parameter so this stays pure: ExecError
 * passes the host's.
 */
export function commandFailureText(failure: CommandFailure, home: string): string {
  const { exitCode, stderr, timedOut, note } = failure;
  const command = withoutTypedText(failure.command);
  const tail = note === undefined ? '' : `\n${note}`;
  if (timedOut) return withoutHostPaths(`Command timed out: ${command}${tail}`, home);
  // Node's own `Command failed: <argv>` stands in stderr for a silent child (exec.ts), with the text in it.
  const withoutArgvText = stderr.split(failure.command).join(command);
  const argparseRefused = exitCode === ARGPARSE_EXIT && IDB_TYPING.test(failure.command);
  const said = stderrForAgent(command, argparseRefused ? withoutArgvText.replace(ARGPARSE_ERROR, IDB_REJECTED) : withoutArgvText, home);
  return withoutHostPaths(`Command failed (exit ${exitCode}): ${command}\n${said}${tail}`, home);
}
