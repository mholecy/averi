import { shellQuote } from '../../src/adapters/adb-shell.js';
import { adbSaid, APK_PATH, HOME_COMMAND, LAB_APP, type FocusRead } from './lab-device.js';
import { frontOf, homeOf, isChooser } from './live-chooser.js';

/**
 * The lab emulator's "Open with" chooser premise: what the device batches (batch/lab-chooser.ts, batch/lab-emu.ts) and
 * the live golden's chooser group (live.ts, T20a) both read of it, pure, in one place — moved here from lab-chooser.ts so
 * live.ts reads it without importing the owner-run batch layer. The preferred-activities read (only its `Preferred
 * Activities User N:` block), a lab default (`mAlways=true`, a leak) told from the last-chosen entry "Just once" writes
 * (`mAlways=false`), the handler query of a link, and the hand lines that clear a default or read the chooser back.
 * The batch's CallResult wrappers (lab-chooser.ts#preferredOf, #handlersOf) say a failed call; here is the text read.
 */

/** The lab app's package (lab-device.ts#LAB_APP's native app): the one the preferred read, the install and --check ask. */
export const LAB_PACKAGE = LAB_APP.native.package;

/** A RESTORE line's start (batch-11's `D55 (Android): …`): every hand line of the chooser's. */
export const HAND_PREFIX = 'D55 (Android): ';

/** The preferred read: `dumpsys package preferred` (batch-10's and batch-11's; batch-9's `preferred-activities` reads alike). */
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
  return { text, component: e.component, always: flag === undefined ? undefined : flag === 'true', ...(authority !== undefined && { authority }) };
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
  return users === 0 ? { state: 'unread', why: 'no `Preferred Activities User N:` block in the dump' } : { state: 'read', users, lab };
}

/** The leaks: the lab's defaults (`mAlways=true`). */
export const leaksOf = (p: { lab: readonly LabEntry[] }): LabEntry[] => p.lab.filter((e) => e.always === true);
/** Entries with no mAlways line: neither a default nor last-chosen as read — they cannot be compared, so unproven. */
export const unflaggedOf = (p: { lab: readonly LabEntry[] }): LabEntry[] => p.lab.filter((e) => e.always === undefined);
/** The last-chosen entries "Just once" writes (`mAlways=false`): no default; AOSP 13's uninstall does not clear them. */
export const lastChosenOf = (p: { lab: readonly LabEntry[] }): LabEntry[] => p.lab.filter((e) => e.always === false);

// ----------------------------------------------------------------------------------------------- the handlers

/** The handler query of a link: `cmd package query-activities --brief -a VIEW -d <url>` (batch-11.sh's handlers). */
export const handlersArgv = (url: string): string[] => ['cmd', 'package', 'query-activities', '--brief', '-a', 'android.intent.action.VIEW', '-d', url];

/**
 * The handler query's text counted (a call that answered): the component lines, which must be as many as its `N
 * activities found:` line says (`No activities found` is 0); else why not.
 */
export function handlersIn(text: string): number | { why: string } {
  const out = text.replace(/\r/g, '');
  if (/^No activities found\s*$/m.test(out)) return 0;
  const said = /^(\d+) activit(?:y|ies) found:\s*$/m.exec(out);
  // The first line, trimmed (`out` holds no \r: words.ts#firstLineOf's line).
  if (said === null) return { why: `query-activities printed no \`N activities found:\` line: ${out.split('\n', 1)[0].trim()}` };
  const listed = out.split('\n').filter((l) => /^\s*[\w.]+\/[\w.$]+\s*$/.test(l)).length;
  return listed === Number(said[1]) ? listed : { why: `query-activities said ${said[1]} activities but listed ${listed}` };
}

// ---------------------------------------------------------------------------------------------- the hand lines

/** What a hand line is built from: the lab's serial, the APK to install, and the command to run after (`then: …`). */
export interface HandBase {
  serial: string;
  apk: string;
  then: string;
}

/** `adb -s <serial> <words…>`, each word quoted as a shell reads it back (adb-shell.ts#shellQuote). */
export const adbLine = (serial: string, words: readonly string[]): string => ['adb', '-s', serial, ...words].map(shellQuote).join(' ');

/** A lab default left: what clears it (batch-12's hand line; the uninstall wipes the lab's data), then `then`. */
export const defaultHand = (b: HandBase): string =>
  `${HAND_PREFIX}a lab default (mAlways=true) is set — "Always" is never tapped, so it predates the batch or is a defect: ` +
  `${adbLine(b.serial, ['uninstall', LAB_PACKAGE])} && ${adbLine(b.serial, ['install', b.apk])} (clears it; wipes the lab's data); then: ${b.then}`;

/** The chooser or the preferred activities not proven put back: what to read, and what to press. */
export const checkHand = (serial: string): string =>
  `${HAND_PREFIX}the chooser and the preferred activities not proven put back: ${adbLine(serial, ['shell', ...PREFERRED_ARGV])} ` +
  `(no lab entry with mAlways=true may be left); a chooser in front: ${adbLine(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK'])}`;

// --------------------------------------------------------------------------------- the chooser group's premise

/**
 * What the chooser group's cases rest on (T20a; live-chooser.ts: lc1 and lc4'' raise the chooser, lc4' and lc4'' start
 * from the launcher), each fact read once before the cases, read only: no lab default (`mAlways=true`: the default
 * answers the link and no chooser rises — lc1's and lc4'''s SKIP), two handlers for the shared link (the lab's
 * `.MainActivity` and `.Twin`: one alone raises no chooser), no chooser on the stack (lc1's and lc3's premise), and
 * HOME a launcher (lc4' and lc4'' start from the HOME activity the device resolves).
 */
export type PremiseFactName = 'default' | 'handlers' | 'stack' | 'home';
/** fresh: the fact holds; stale: it does not (the run fails); unread: the read failed or proves nothing. */
export type PremiseState = 'fresh' | 'stale' | 'unread';
export interface PremiseFact {
  fact: PremiseFactName;
  state: PremiseState;
  why: string;
}

/**
 * The premise as the record keeps it (RunRecord `chooserPremise`): each fact, the premise's state (stale when any fact
 * is, else unread when any is, else fresh), and the summary's lines as the run printed them — `--rejudge` prints them
 * as they are, reading no device.
 */
export interface ChooserPremise {
  state: PremiseState;
  facts: PremiseFact[];
  lines: string[];
}

/** The link lc4'' opens, which the lab's two activities answer (lc1's `averilab://shared/x`: the same host). */
export const SHARED_LINK = 'averilab://shared/open';
/** Its handlers: the lab's `.MainActivity` and `.Twin` (tests/truth/lab-manifest.test.ts). */
export const SHARED_HANDLERS = 2;
/** How much of an entry's text a line quotes, before `…` (lab-chooser.ts's checkWhy quotes as much). */
const ENTRY_CHARS = 200;
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** What the premise asks of the lab: AndroidLab's guard, its adb and its focus read (lab-device.ts). */
export interface PremiseLab {
  readonly serial: string;
  guard(): Promise<void>;
  adb(...args: string[]): Promise<{ stdout: string }>;
  focus(): Promise<FocusRead>;
}

/** What the preferred activities prove: a default stale, an entry with no mAlways line unread (checkExit's order). */
function defaultFact(p: PreferredRead): PremiseFact {
  const fact = 'default';
  if (p.state === 'unread') return { fact, state: 'unread', why: `the preferred activities unread (${p.why})` };
  const leaks = leaksOf(p);
  if (leaks.length > 0) return { fact, state: 'stale', why: `${plural(leaks.length, 'lab default', 'lab defaults')} (mAlways=true) for ${LAB_PACKAGE}, first: ${cut(leaks[0].text, ENTRY_CHARS)}` };
  const unflagged = unflaggedOf(p);
  if (unflagged.length > 0) return { fact, state: 'unread', why: `the preferred activities not proven: ${plural(unflagged.length, 'lab entry', 'lab entries')} with no mAlways line, first: ${cut(unflagged[0].text, ENTRY_CHARS)}` };
  return { fact, state: 'fresh', why: `no lab default (mAlways=true) for ${LAB_PACKAGE}` };
}

function handlersFact(n: number | { why: string }): PremiseFact {
  const fact = 'handlers';
  if (typeof n !== 'number') return { fact, state: 'unread', why: `the handlers of ${SHARED_LINK} unread (${n.why})` };
  if (n === SHARED_HANDLERS) return { fact, state: 'fresh', why: `${n} handlers for ${SHARED_LINK}` };
  return { fact, state: 'stale', why: `${plural(n, 'handler', 'handlers')} for ${SHARED_LINK}, not ${SHARED_HANDLERS}` };
}

/** The stack as live-chooser.ts#frontOf reads it: any record of the platform's chooser is stale. */
function stackFact(read: FocusRead): PremiseFact {
  const fact = 'stack';
  const front = frontOf(read);
  if ('why' in front) return { fact, state: 'unread', why: `the stack unread (${front.why})` };
  const up = front.records.filter(isChooser);
  return up.length === 0 ? { fact, state: 'fresh', why: 'no chooser on the stack' } : { fact, state: 'stale', why: `a chooser on the stack (${up.join(', ')})` };
}

/** HOME as live-chooser.ts#homeOf reads it: the platform's chooser (two Home apps, none chosen) or the lab is stale. */
function homeFact(resolved: string | { why: string }): PremiseFact {
  const fact = 'home';
  if (typeof resolved !== 'string') return { fact, state: 'unread', why: `HOME unread (${resolved.why})` };
  if (isChooser(resolved)) return { fact, state: 'stale', why: `HOME is ${resolved}, the platform's chooser, not a launcher` };
  if (resolved.startsWith(`${LAB_PACKAGE}/`)) return { fact, state: 'stale', why: `HOME is ${resolved}, the lab, not a launcher` };
  return { fact, state: 'fresh', why: `HOME ${resolved}` };
}

/** The command that reads the premise again: the chooser group on the same emulator. */
export const rerunLine = (serial: string): string => `node --import tsx scripts/truth/live.ts --serial ${shellQuote(serial)} --groups chooser`;

/** The shared link's handlers not two: list them, and put the lab's build back. */
export const handlersHand = (b: HandBase, n: number): string =>
  `${HAND_PREFIX}${SHARED_LINK} has ${plural(n, 'handler', 'handlers')}, not the lab's ${SHARED_HANDLERS} (.MainActivity and .Twin): ` +
  `${adbLine(b.serial, ['shell', ...handlersArgv(SHARED_LINK)])} lists them; another app among them: uninstall it; the lab's .Twin missing: ` +
  `${adbLine(b.serial, ['install', '-r', b.apk])}; then: ${b.then}`;

/** A chooser on the stack before the cases: BACK until none is left. */
export const stackHand = (b: HandBase): string =>
  `${HAND_PREFIX}a chooser on the stack before the cases: ${adbLine(b.serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK'])} until ` +
  `${adbLine(b.serial, ['shell', 'dumpsys', 'activity', 'activities'])} lists no ResolverActivity or ChooserActivity record; then: ${b.then}`;

/** HOME not a launcher: the Home app chosen by hand, then read back. */
export const homeHand = (b: HandBase): string =>
  `${HAND_PREFIX}HOME is not a launcher: choose the launcher as the Home app on the emulator (Settings, Apps, Default apps, Home app), then ` +
  `${adbLine(b.serial, ['shell', ...HOME_COMMAND.split(' ')])} must name it; then: ${b.then}`;

/**
 * The premise's lines: one naming every fact — `CHOOSER PREMISE: stale — … — the run fails` and the owner's hand line for
 * each stale fact, `Chooser premise: unread — …`, or `Chooser premise: fresh — …` — and a WARN when the lab has a
 * last-chosen entry (`mAlways=false`: no default, so no fact fails on it; no reinstall clears it, batch-11).
 */
function premiseLines(state: PremiseState, facts: readonly PremiseFact[], hands: readonly string[], last: readonly LabEntry[]): string[] {
  const whys = facts.map((f) => f.why).join('; ');
  const head = state === 'stale' ? `CHOOSER PREMISE: stale — ${whys} — the run fails` : `Chooser premise: ${state} — ${whys}`;
  const warn = last.length === 0 ? [] : [`Chooser premise: WARN — ${plural(last.length, 'last-chosen lab entry', 'last-chosen lab entries')} (mAlways=false: no default; no reinstall clears it), first: ${cut(last[0].text, ENTRY_CHARS)}`];
  return [head, ...hands, ...warn];
}

/**
 * The chooser group's premise (T20a), read once before the cases (live.ts), or undefined — nothing read, no line — for a
 * run with no Android lab or no chooser case among the cases selected (not the groups asked: `--cases` may leave none).
 * Read only: `dumpsys package preferred`, the shared link's handler query, the focus and the stack (AndroidLab.focus),
 * the HOME activity the device resolves (HOME_COMMAND), each after the lab's guard. This is the one guard on the reads:
 * a read that fails is its fact unread, with adb's words (lab-device.ts#adbSaid), never a throw.
 */
export async function readChooserPremise(lab: PremiseLab | undefined, selected: readonly { group: string }[], { note }: { note?: (line: string) => void } = {}): Promise<ChooserPremise | undefined> {
  if (lab === undefined || !selected.some((c) => c.group === 'chooser')) return undefined;
  note?.('chooser premise: reading it before the cases');
  // The lab AVD or nothing (AndroidLab.guard, which live.ts has run already: its refusal is no read's failure).
  await lab.guard();
  const shell = async <T>(args: readonly string[], read: (out: string) => T, unread: (why: string) => T): Promise<T> => {
    try {
      return read((await lab.adb('shell', ...args)).stdout);
    } catch (e) {
      return unread(adbSaid(e));
    }
  };
  const preferred = await shell<PreferredRead>(PREFERRED_ARGV, preferredIn, (why) => ({ state: 'unread', why: `${PREFERRED_ARGV.join(' ')}: ${why}` }));
  const handlers = await shell<number | { why: string }>(handlersArgv(SHARED_LINK), handlersIn, (why) => ({ why: `query-activities: ${why}` }));
  const stack = stackFact(await lab.focus());
  const home = await shell([HOME_COMMAND], (resolved) => homeOf({ resolved }), (error) => homeOf({ error }));
  const facts = [defaultFact(preferred), handlersFact(handlers), stack, homeFact(home)];
  const state: PremiseState = facts.some((f) => f.state === 'stale') ? 'stale' : facts.some((f) => f.state === 'unread') ? 'unread' : 'fresh';
  const base: HandBase = { serial: lab.serial, apk: APK_PATH, then: rerunLine(lab.serial) };
  const hands = facts.flatMap((f) => (f.state !== 'stale' ? [] : f.fact === 'default' ? [defaultHand(base)] : f.fact === 'handlers' ? [handlersHand(base, handlers as number)] : f.fact === 'stack' ? [stackHand(base)] : [homeHand(base)]));
  return { state, facts, lines: premiseLines(state, facts, hands, preferred.state === 'read' ? lastChosenOf(preferred) : []) };
}
