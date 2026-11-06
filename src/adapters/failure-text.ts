/** What exec knows of a failed host command: ExecError's own fields, which keep every byte for detectors and logs. */
export interface CommandFailure {
  command: string;
  exitCode: number | null;
  stderr: string;
  timedOut: boolean;
  note?: string;
}

/** A traceback's header, behind the margin an exception group prints; the margin's width is where its lines start. */
const TRACEBACK_HEADER = /^([ |+]*)(?:Exception Group )?Traceback \(most recent call last\):$/;

/** The exception under a traceback's header: the first line at the header's margin, frames being indented further and an exception group's rules made of `+` and `-`. */
function exceptionUnder(below: readonly string[], margin: number): string | undefined {
  return below
    .map((line) => line.slice(margin))
    .find((line) => line !== '' && !/^[ +-]/.test(line));
}

/** The tool a command line runs: its first word's last path segment, and for xcrun what it runs. */
function toolOf(command: string): string {
  const [first, second] = command.split(' ');
  return first === 'xcrun' && second !== undefined ? second : first.split('/').at(-1)!;
}

/** `stderr` as an agent reads it: trimmed, or one line when it holds a Python traceback. */
function saidBy(command: string, stderr: string): string {
  const lines = stderr.split('\n');
  const header = lines.map((line) => TRACEBACK_HEADER.test(line)).lastIndexOf(true);
  if (header === -1) return stderr.trim();
  const margin = TRACEBACK_HEADER.exec(lines[header])![1].length;
  const exception = exceptionUnder(lines.slice(header + 1), margin);
  return `${toolOf(command)} crashed${exception === undefined ? '' : `: ${exception}`} (Python traceback left out: run the command in a terminal to see it)`;
}

/** What stands where a typed text stood. */
const TYPED_TEXT = '<typed text>';

/** The two argvs that hold a typed text: `idb ui text <text> --udid U` (ios.ts#typeText), `adb [-s S] shell input text <one quoted character>` (android.ts#typeText). */
const TYPING_ARGVS = [/^(idb ui text )[\s\S]*( --udid \S+)$/, /^(adb(?: -s \S+)? shell input text )[\s\S]*()$/];

function withoutTypedText(command: string): string {
  return TYPING_ARGVS.reduce((out, argv) => out.replace(argv, `$1${TYPED_TEXT}$2`), command);
}

/** Where a path word ends: the marks around a path in a message, whitespace. */
const STOP = String.raw`\s"'` + '`' + String.raw`()\[\],<>`;
/** Where a host path may start: a line's or word's start, after an opening mark. So a URL's path, `/data/local/tmp/…` and `x=/tmp/…`, inside a word, never match. */
const WORD_START = String.raw`(?<=^|[\s"'` + '`' + String.raw`(\[<,])`;
const PATH_REST = `(/[^${STOP}]*)?(?![^${STOP}])`;

/** Any macOS or Linux home at a word's start; file:// too, whose path is the host's by definition. `/Users/Shared` is nobody's home. */
const ANY_HOME = new RegExp(
  String.raw`(?:${WORD_START}|(?<=file://))/(?:Users/(?!Shared(?![^${STOP}/]))[^${STOP}/]+|home/[^${STOP}/]+|root(?![^${STOP}/]))`,
  'gm',
);
/** Folders only a host has, each reduced to a mark and the path's last word. */
const HOST_FOLDERS: readonly (readonly [RegExp, string])[] = [
  [new RegExp(String.raw`${WORD_START}/(?:private/)?(?:tmp|var/tmp|var/folders)${PATH_REST}`, 'gm'), '<tmp>'],
  [new RegExp(String.raw`${WORD_START}/(?:Volumes|opt)${PATH_REST}`, 'gm'), '…'],
];

const escaped = (literal: string): string => literal.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

function withoutHostPaths(text: string, home: string): string {
  // Longer than `/`: a container's home may be the root folder, and every path would match it.
  const own = home.length > 1 ? text.replace(new RegExp(`${escaped(home)}(?![\\w.-])`, 'g'), '~') : text;
  let out = own.replace(ANY_HOME, '~');
  for (const [folder, mark] of HOST_FOLDERS) {
    out = out.replace(folder, (_whole, rest: string | undefined) => {
      const last = rest?.split('/').filter((word) => word !== '').at(-1);
      return last === undefined ? mark : `${mark}/${last}`;
    });
  }
  return out;
}

/**
 * The text of a failed host command, the one place an ExecError becomes words (D70, ADR 0043). exec's shape, `Command failed (exit
 * N): <argv>⏎<stderr>` or `Command timed out: <argv>`, byte for byte, except that a Python traceback shrinks to one line,
 * a typed text leaves the argv, and host paths leave the whole text. `home` is a parameter so this stays pure:
 * ExecError passes `os.homedir()`.
 */
export function commandFailureText(failure: CommandFailure, home: string): string {
  const { exitCode, stderr, timedOut, note } = failure;
  const command = withoutTypedText(failure.command);
  // Node's own `Command failed: <argv>` stands in stderr for a silent child (exec.ts), with the text in it.
  const said = saidBy(command, stderr.split(failure.command).join(command));
  const text = timedOut ? `Command timed out: ${command}` : `Command failed (exit ${exitCode}): ${command}\n${said}`;
  return withoutHostPaths(text + (note === undefined ? '' : `\n${note}`), home);
}
