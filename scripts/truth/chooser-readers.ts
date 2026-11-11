import { shellQuote } from '../../src/adapters/adb-shell.js';
import { LAB_APP } from './lab-device.js';

/**
 * The lab emulator's "Open with" chooser as text read and lines said, pure: what the device batches
 * (batch/lab-chooser.ts, batch/lab-emu.ts) and the live golden's chooser premise (chooser-premise.ts, T20a) both
 * need, moved here from lab-chooser.ts, which re-exports it. A leaf: it imports src's shellQuote and lab-device.ts's
 * LAB_APP, nothing of batch/ and nothing live-*, so a batch loads no live module through it. The preferred-activities
 * text (only its `Preferred Activities User N:` block), a lab default (`mAlways=true`, a leak) told from the
 * last-chosen entry "Just once" writes (`mAlways=false`), a link's handler query and its count, the focused activity
 * and whether it is the platform's chooser (the chooser group's own reader, live-chooser.ts's, moved here so --check
 * reads the focus with it: TL5), an entry as a line quotes it, and the hand lines that clear a default or read the
 * chooser back. A failed call is the caller's to tell, its words worded here (preferredUnread, handlersUnread):
 * lab-chooser.ts#preferredOf and #handlersOf give a batch's exit, chooser-premise.ts adb's error.
 */

/**
 * The lab app's package (lab-device.ts#LAB_APP's native app): the one the preferred read, the install and --check
 * ask.
 */
export const LAB_PACKAGE = LAB_APP.native.package;

/** A RESTORE line's start (batch-11's `D55 (Android): …`): every hand line of the chooser's. */
export const HAND_PREFIX = 'D55 (Android): ';

/**
 * The preferred read: `dumpsys package preferred` (batch-10's and batch-11's; batch-9's `preferred-activities` reads
 * alike).
 */
export const PREFERRED_ARGV = ['dumpsys', 'package', 'preferred'] as const;

// --------------------------------------------------------------------------------------- the preferred activities

/** One lab entry of the block: its lines joined, its component, its mAlways (none: no such line), its Authority. */
export interface LabEntry {
  text: string;
  component: string;
  always: boolean | undefined;
  authority?: string;
}

/** The block read — every user's, each lab entry in it — or unread, with why: never "no lab entry" unshown. */
export type PreferredRead = { state: 'read'; users: number; lab: LabEntry[] } | { state: 'unread'; why: string };

const BLOCK_HEADER = /^Preferred Activities User \d+:\s*$/;
/** An entry's first line: its hash and component (`eb6cdf5 com.google.android.gm/.ComposeActivityGmailExternal`). */
const ENTRY_LINE = /^(\s+)[0-9a-f]+ ([\w.$]+\/[\w.$]+)\s*$/;
const indentOf = (line: string): number => line.length - line.trimStart().length;

/** Whether an entry names the lab: its component is the lab app's, or it answers the lab's scheme. */
const isLab = (component: string, lines: readonly string[]): boolean =>
  component.startsWith(`${LAB_PACKAGE}/`) || lines.some((l) => l.trim() === 'Scheme: "averilab"');

/** An entry while it is read: its first line's indent and component, and its lines so far. */
interface OpenEntry {
  indent: number;
  component: string;
  lines: string[];
}

/** A read entry as a lab entry, or undefined when it does not name the lab. */
function labEntryOf(e: OpenEntry): LabEntry | undefined {
  if (!isLab(e.component, e.lines)) return undefined;
  const text = e.lines
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .join(' | ');
  // mAlways on the entry's own first line after it (`mMatch=0x300000 mAlways=false`) only, never further down; an entry
  // of one line has none (`String`: "undefined" holds no mAlways).
  const flag = /\bmAlways=(true|false)\b/.exec(String(e.lines.slice(1).find((l) => l.trim() !== '')))?.[1];
  const authority = /Authority: "([^"]+)"/.exec(text)?.[1];
  const always = flag === undefined ? undefined : flag === 'true';
  return { text, component: e.component, always, ...(authority !== undefined && { authority }) };
}

/**
 * The preferred read's text (d55-b11.ts's preferredOf, a call that answered): only the `Preferred Activities User N:`
 * block(s), each running to the next top-level line; in a block, each entry is its first line (a hash and a component)
 * and every line after it indented deeper, or blank. A dump with no such block (API 33's whole dump cut short, another
 * command's output) is unread.
 */
export function preferredIn(out: string): PreferredRead {
  let users = 0;
  let inBlock = false;
  let open: OpenEntry | undefined;
  const lab: LabEntry[] = [];
  const close = (): void => {
    const e = open === undefined ? undefined : labEntryOf(open);
    if (e !== undefined) lab.push(e);
    open = undefined;
  };
  for (const line of out.replace(/\r/g, '').split('\n')) {
    if (open !== undefined && (line.trim() === '' || indentOf(line) > open.indent)) {
      open.lines.push(line);
      continue;
    }
    close();
    if (BLOCK_HEADER.test(line)) {
      users++;
      inBlock = true;
    } else if (/^\S/.test(line)) inBlock = false;
    else {
      const m = inBlock ? ENTRY_LINE.exec(line) : null;
      if (m !== null) open = { indent: m[1].length, component: m[2], lines: [line] };
    }
  }
  close();
  if (users === 0) return { state: 'unread', why: 'no `Preferred Activities User N:` block in the dump' };
  return { state: 'read', users, lab };
}

/** The preferred read that failed, `why` the caller's words for it (a batch's exit, adb's error). */
export const preferredUnread = (why: string): PreferredRead => ({
  state: 'unread',
  why: `${PREFERRED_ARGV.join(' ')}: ${why}`,
});

/** How much of an entry's text a line quotes, before `…`. */
export const ENTRY_CHARS = 200;
/** An entry's text as a line quotes it: ENTRY_CHARS at most, then `…`. */
export const entryText = (e: LabEntry): string =>
  e.text.length > ENTRY_CHARS ? `${e.text.slice(0, ENTRY_CHARS)}…` : e.text;

/** The leaks: the lab's defaults (`mAlways=true`). */
export const leaksOf = (p: { lab: readonly LabEntry[] }): LabEntry[] => p.lab.filter((e) => e.always === true);
/** Entries with no mAlways line: neither a default nor last-chosen as read — they cannot be compared, so unproven. */
export const unflaggedOf = (p: { lab: readonly LabEntry[] }): LabEntry[] => p.lab.filter((e) => e.always === undefined);
/**
 * The last-chosen entries "Just once" writes (`mAlways=false`): no default; AOSP 13's uninstall does not clear
 * them.
 */
export const lastChosenOf = (p: { lab: readonly LabEntry[] }): LabEntry[] => p.lab.filter((e) => e.always === false);

// ----------------------------------------------------------------------------------------------- the handlers

/** The handler query of a link: `cmd package query-activities --brief -a VIEW -d <url>` (batch-11.sh's handlers). */
export const handlersArgv = (url: string): string[] => [
  ...['cmd', 'package', 'query-activities', '--brief'],
  ...['-a', 'android.intent.action.VIEW', '-d', url],
];

/** The handler query that failed, `why` the caller's words for it (a batch's exit, adb's error). */
export const handlersUnread = (why: string): { why: string } => ({ why: `query-activities: ${why}` });

/**
 * The handler query's text counted (a call that answered): the component lines, which must be as many as its `N
 * activities found:` line says (`No activities found` is 0); else why not.
 */
export function handlersIn(text: string): number | { why: string } {
  const out = text.replace(/\r/g, '');
  if (/^No activities found\s*$/m.test(out)) return 0;
  const said = /^(\d+) activit(?:y|ies) found:\s*$/m.exec(out);
  // The first line, trimmed (`out` holds no \r: words.ts#firstLineOf's line).
  const first = out.split('\n', 1)[0].trim();
  if (said === null) return { why: `query-activities printed no \`N activities found:\` line: ${first}` };
  const listed = out.split('\n').filter((l) => /^\s*[\w.]+\/[\w.$]+\s*$/.test(l)).length;
  if (listed === Number(said[1])) return listed;
  return { why: `query-activities said ${said[1]} activities but listed ${listed}` };
}

// ------------------------------------------------------------------------------------------------ the focus

/**
 * An ActivityRecord's component: after its hash and user, ended by a space (API 36: the task follows) or `}` (API 33).
 * The harness's own reading of the window manager's lines (live-chooser.ts's, T7b), written apart from src's
 * android-chooser.ts#chooserInFocus and never importing it: an oracle that does not share the code it judges (ADR
 * 0020). --check's focus read (batch/lab-chooser.ts#focusOf) is judged by it too, through focusedChooserOf (TL5, A22).
 */
export const ACTIVITY_RECORD = String.raw`ActivityRecord\{[0-9a-f]+ u\d+ ([^\s}/]+\/[^\s}]+)[\s}]`;
const FOCUSED_APP = new RegExp(String.raw`mFocusedApp=[^\n]*?${ACTIVITY_RECORD}`);

/**
 * The focused activity's component: the first `mFocusedApp` line's ActivityRecord; none when no line names one. Not
 * scoped to a display: `dumpsys window displays` prints one pair per display, and this reads the first line across
 * all of them (unlike src's chooserInFocus, which reads display 0's block): the chooser group's reads, on the lab
 * emulator's one display. --check reads through focusedChooserOf, which asks for exactly one line.
 */
export const focusedAppOf = (text: string): string | undefined => FOCUSED_APP.exec(text)?.[1];

/** The packages the platform's chooser runs in (AOSP: the framework's; later releases' IntentResolver module). */
export const CHOOSER_PACKAGES: ReadonlySet<string> = new Set(['android', 'com.android.intentresolver']);

/** The platform's resolver or chooser activity: its package one of CHOOSER_PACKAGES, its class `….ResolverActivity` or `….ChooserActivity`. */
export function isChooser(component: string | undefined): boolean {
  if (component === undefined) return false;
  const [pkg, cls] = component.split('/');
  return CHOOSER_PACKAGES.has(pkg) && /\.(?:Resolver|Chooser)Activity$/.test(cls);
}

/** A focus read as --check takes it: the chooser in front (its component) or not (undefined), or unread with why. */
export type FocusedChooser = { state: 'read'; chooser: string | undefined } | { state: 'unread'; why: string };

/**
 * The chooser a focus read shows, fail closed (TL5, A22): exactly one `mFocusedApp=` line, or unread — none proves no
 * "no chooser" (the focused window alone is not this reader's word), and more than one is a second display's (or a
 * doubled line), whose link this reader does not guess. That line's activity decides: the platform's chooser, or none.
 * Only `mFocusedApp=null` reads as no activity, so no chooser; any other line it cannot parse is unread with its own
 * reason. The lab emulator has one display, so one line.
 */
export function focusedChooserOf(text: string): FocusedChooser {
  const lines = text.split('\n').filter((l) => l.includes('mFocusedApp='));
  if (lines.length === 0) return { state: 'unread', why: 'the focus read holds no mFocusedApp= line' };
  if (lines.length > 1) return { state: 'unread', why: `the focus read holds ${lines.length} mFocusedApp= lines, not one (one display's expected)` };
  const focused = focusedAppOf(lines[0]);
  if (focused !== undefined) return { state: 'read', chooser: isChooser(focused) ? focused : undefined };
  if (/mFocusedApp=null[ \t\r]*$/.test(lines[0])) return { state: 'read', chooser: undefined };
  return { state: 'unread', why: "the focus read's mFocusedApp= line names no activity the reader can parse" };
}

// ---------------------------------------------------------------------------------------------- the hand lines

/** What a hand line is built from: the lab's serial, the APK to install, and the command to run after (`then: …`). */
export interface HandBase {
  serial: string;
  apk: string;
  then: string;
}

/** `adb -s <serial> <words…>`, each word quoted as a shell reads it back (adb-shell.ts#shellQuote). */
export const adbLine = (serial: string, words: readonly string[]): string =>
  ['adb', '-s', serial, ...words].map(shellQuote).join(' ');

/**
 * What a default's hand line says of where it came from: what it predates (`the batch`, a batch's words; `this run`,
 * the live premise's), and, when the APK must be built first (the live premise installs the checkout's build, it
 * pulled none), how.
 */
export interface DefaultCause {
  predates?: 'the batch' | 'this run';
  build?: string;
}

/**
 * A lab default left: what clears it (batch-12's hand line; the uninstall wipes the lab's data), then `then`. A batch
 * gives no cause: `the batch`, its line as before.
 */
export const defaultHand = (b: HandBase, { predates = 'the batch', build }: DefaultCause = {}): string =>
  `${HAND_PREFIX}a lab default (mAlways=true) is set — "Always" is never tapped, so it predates ${predates} or is a ` +
  `defect: ${build === undefined ? '' : `build the APK first (${build}), then `}` +
  `${adbLine(b.serial, ['uninstall', LAB_PACKAGE])} && ${adbLine(b.serial, ['install', b.apk])} ` +
  `(clears it; wipes the lab's data); then: ${b.then}`;

/** The chooser or the preferred activities not proven put back: what to read, and what to press. */
export const checkHand = (serial: string): string =>
  `${HAND_PREFIX}the chooser and the preferred activities not proven put back: ` +
  `${adbLine(serial, ['shell', ...PREFERRED_ARGV])} (no lab entry with mAlways=true may be left); ` +
  'a chooser in front: ' +
  adbLine(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
