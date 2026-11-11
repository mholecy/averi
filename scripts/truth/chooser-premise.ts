import {
  adbLine,
  defaultHand,
  entryText,
  HAND_PREFIX,
  handlersArgv,
  handlersIn,
  handlersUnread,
  isChooser,
  LAB_PACKAGE,
  lastChosenOf,
  leaksOf,
  PREFERRED_ARGV,
  preferredIn,
  preferredUnread,
  unflaggedOf,
  type HandBase,
  type LabEntry,
  type PreferredRead,
} from './chooser-readers.js';
import { shellQuote } from './batch/shell.js';
import { adbSaid, APK_PATH, HOME_COMMAND, type FocusRead } from './lab-device.js';
import { frontOf, homeOf } from './live-chooser.js';

/**
 * The live golden's chooser premise (T20a; docs/adr/0041's T20a amendment): what the chooser group's cases rest on,
 * read once before them (live.ts), read only, through the lab's adb. The text is read by chooser-readers.ts (the
 * readers the batches share), the stack and HOME by live-chooser.ts (the judges' own readers). Here: the four facts,
 * each fresh, stale (with the owner's hand line) or unread, the premise's state, its summary lines, and the step that
 * reads it into a run's record (readPremiseInto). Not imported by batch/.
 */

/**
 * The facts (live-chooser.ts: lc1 and lc4'' raise the chooser, lc4' and lc4'' start from the launcher): no lab default
 * (`mAlways=true`: the default answers the link and no chooser rises — then lc1 and lc4'' SKIP), two handlers for the
 * shared link (the lab's `.MainActivity` and `.Twin`: one alone raises no chooser), no chooser on the stack (lc1's and
 * lc3's premise), and HOME a launcher (lc4' and lc4'' start from the HOME activity the device resolves).
 */
export type PremiseFactName = 'default' | 'handlers' | 'stack' | 'home';
/** fresh: the fact holds; stale: it does not (the run fails); unread: the read failed or proves nothing. */
export type PremiseState = 'fresh' | 'stale' | 'unread';
/** One fact as read: a stale one carries the owner's hand line that puts it back. */
export type PremiseFact = { fact: PremiseFactName; why: string } & (
  | { state: 'fresh' | 'unread' }
  | { state: 'stale'; hand: string }
);

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
/**
 * How the checkout builds the APK a hand line installs (lab-device.ts#APK_PATH; batch/lab-build.ts runs the same
 * `gradlew assembleDebug`, under JDK 17), from the checkout's root.
 */
export const APK_BUILD = 'from the checkout root, under JDK 17: cd fixtures/apps/android && ./gradlew assembleDebug';
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** What the premise asks of the lab: AndroidLab's guard, its adb and its focus read (lab-device.ts). */
export interface PremiseLab {
  readonly serial: string;
  guard(): Promise<void>;
  adb(...args: string[]): Promise<{ stdout: string }>;
  focus(): Promise<FocusRead>;
}

/**
 * The command that reads the premise again: the chooser group on the same emulator — a host-shell line, its serial
 * quoted by batch/shell.ts (a leaf, the batches' one host quoter), not by adb-shell.ts's device quoter.
 */
export const rerunLine = (serial: string): string =>
  `node --import tsx scripts/truth/live.ts --serial ${shellQuote(serial)} --groups chooser`;

/** The shared link's handlers not two: list them, and put the lab's build back. */
export const handlersHand = (b: HandBase, n: number): string =>
  `${HAND_PREFIX}${SHARED_LINK} has ${plural(n, 'handler', 'handlers')}, not the lab's ${SHARED_HANDLERS} ` +
  `(.MainActivity and .Twin): ${adbLine(b.serial, ['shell', ...handlersArgv(SHARED_LINK)])} lists them; another app ` +
  `among them: uninstall it; the lab's .Twin missing: build the APK (${APK_BUILD}), then ` +
  `${adbLine(b.serial, ['install', '-r', b.apk])}; then: ${b.then}`;

/** A chooser on the stack before the cases: BACK until none is left. */
export const stackHand = (b: HandBase): string =>
  `${HAND_PREFIX}a chooser on the stack before the cases: ` +
  `${adbLine(b.serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK'])} until ` +
  `${adbLine(b.serial, ['shell', 'dumpsys', 'activity', 'activities'])} lists no ResolverActivity or ChooserActivity ` +
  `record; then: ${b.then}`;

/** HOME not a launcher: the Home app chosen by hand, then read back. */
export const homeHand = (b: HandBase): string =>
  `${HAND_PREFIX}HOME is not a launcher: choose the launcher as the Home app on the emulator (Settings, Apps, ` +
  `Default apps, Home app), then ${adbLine(b.serial, ['shell', ...HOME_COMMAND.split(' ')])} must name it; ` +
  `then: ${b.then}`;

/**
 * What the preferred activities prove: a default stale (its hand the batches' defaultHand, predating this run, the APK
 * built first), an entry with no mAlways line unread (lab-chooser.ts#checkExit's order).
 */
function defaultFact(p: PreferredRead, b: HandBase): PremiseFact {
  const fact = 'default';
  if (p.state === 'unread') return { fact, state: 'unread', why: `the preferred activities unread (${p.why})` };
  const leaks = leaksOf(p);
  if (leaks.length > 0) {
    const defaults = plural(leaks.length, 'lab default', 'lab defaults');
    const why = `${defaults} (mAlways=true) for ${LAB_PACKAGE}, first: ${entryText(leaks[0])}`;
    return { fact, state: 'stale', why, hand: defaultHand(b, { predates: 'this run', build: APK_BUILD }) };
  }
  const unflagged = unflaggedOf(p);
  if (unflagged.length > 0) {
    const entries = plural(unflagged.length, 'lab entry', 'lab entries');
    const first = entryText(unflagged[0]);
    const why = `the preferred activities not proven: ${entries} with no mAlways line, first: ${first}`;
    return { fact, state: 'unread', why };
  }
  return { fact, state: 'fresh', why: `no lab default (mAlways=true) for ${LAB_PACKAGE}` };
}

function handlersFact(n: number | { why: string }, b: HandBase): PremiseFact {
  const fact = 'handlers';
  if (typeof n !== 'number') return { fact, state: 'unread', why: `the handlers of ${SHARED_LINK} unread (${n.why})` };
  if (n === SHARED_HANDLERS) return { fact, state: 'fresh', why: `${n} handlers for ${SHARED_LINK}` };
  const why = `${plural(n, 'handler', 'handlers')} for ${SHARED_LINK}, not ${SHARED_HANDLERS}`;
  return { fact, state: 'stale', why, hand: handlersHand(b, n) };
}

/** The stack as live-chooser.ts#frontOf reads it: any record of the platform's chooser is stale. */
function stackFact(read: FocusRead, b: HandBase): PremiseFact {
  const fact = 'stack';
  const front = frontOf(read);
  if ('why' in front) return { fact, state: 'unread', why: `the stack unread (${front.why})` };
  const up = front.records.filter(isChooser);
  if (up.length === 0) return { fact, state: 'fresh', why: 'no chooser on the stack' };
  return { fact, state: 'stale', why: `a chooser on the stack (${up.join(', ')})`, hand: stackHand(b) };
}

/**
 * HOME as live-chooser.ts#homeOf reads it: stale only when it is the platform's chooser (two Home apps, none chosen)
 * or the lab. A negative rule on purpose: it is the judges' own (live-chooser.ts#launcherPremise wants the HOME
 * activity in front and no lab or chooser record on the stack, so a HOME that is the lab or the chooser always SKIPs
 * there), so the premise never disagrees with the cases; a positive list of launchers would be a guess. Known fresh
 * but wrong, for both: Settings' FallbackHome (`com.android.settings/.FallbackHome`, HOME while the device is still
 * locked after a boot), which no launcher case should start from.
 */
function homeFact(resolved: string | { why: string }, b: HandBase): PremiseFact {
  const fact = 'home';
  if (typeof resolved !== 'string') return { fact, state: 'unread', why: `HOME unread (${resolved.why})` };
  const stale = (what: string): PremiseFact => ({
    fact,
    state: 'stale',
    why: `HOME is ${resolved}, ${what}, not a launcher`,
    hand: homeHand(b),
  });
  if (isChooser(resolved)) return stale("the platform's chooser");
  if (resolved.startsWith(`${LAB_PACKAGE}/`)) return stale('the lab');
  return { fact, state: 'fresh', why: `HOME ${resolved}` };
}

/**
 * The premise's lines: one naming every fact — `CHOOSER PREMISE: stale — … — the run fails` and the owner's hand line
 * for each stale fact, `Chooser premise: unread — …`, or `Chooser premise: fresh — …` — and a WARN when the lab has a
 * last-chosen entry (`mAlways=false`: no default, so no fact fails on it; no reinstall clears it, batch-11).
 */
function premiseLines(state: PremiseState, facts: readonly PremiseFact[], last: readonly LabEntry[]): string[] {
  const whys = facts.map((f) => f.why).join('; ');
  const head =
    state === 'stale' ? `CHOOSER PREMISE: stale — ${whys} — the run fails` : `Chooser premise: ${state} — ${whys}`;
  const hands = facts.flatMap((f) => (f.state === 'stale' ? [f.hand] : []));
  const lastChosen = plural(last.length, 'last-chosen lab entry', 'last-chosen lab entries');
  // The first entry quoted; none, no line.
  const said = `Chooser premise: WARN — ${lastChosen} (mAlways=false: no default; no reinstall clears it), first: `;
  const warn = last.slice(0, 1).map((e) => said + entryText(e));
  return [head, ...hands, ...warn];
}

/**
 * The chooser group's premise (T20a), or undefined — nothing read, no line — for a run with no Android lab or no
 * chooser case among the cases selected (not the groups asked: `--cases` may leave none). Read only, after the lab's
 * guard: `dumpsys package preferred`, the shared link's handler query, the focus and the stack (AndroidLab.focus), the
 * HOME activity the device resolves (HOME_COMMAND). This is the one guard on the reads: a read that fails is its fact
 * unread, with adb's words (lab-device.ts#adbSaid), never a throw.
 */
export async function readChooserPremise(
  lab: PremiseLab | undefined,
  selected: readonly { group: string }[],
  { note }: { note?: (line: string) => void } = {},
): Promise<ChooserPremise | undefined> {
  if (lab === undefined || !selected.some((c) => c.group === 'chooser')) return undefined;
  note?.('chooser premise: reading it before the cases');
  // The lab AVD or nothing (AndroidLab.guard, which live.ts has run already: its refusal is no read's failure).
  await lab.guard();
  type Read<T> = (out: string) => T;
  const shell = async <T>(args: readonly string[], read: Read<T>, unread: (why: string) => T): Promise<T> => {
    try {
      return read((await lab.adb('shell', ...args)).stdout);
    } catch (e) {
      return unread(adbSaid(e));
    }
  };
  const base: HandBase = { serial: lab.serial, apk: APK_PATH, then: rerunLine(lab.serial) };
  const preferred = await shell(PREFERRED_ARGV, preferredIn, preferredUnread);
  const handlers = await shell<number | { why: string }>(handlersArgv(SHARED_LINK), handlersIn, handlersUnread);
  const stack = stackFact(await lab.focus(), base);
  const home = await shell([HOME_COMMAND], (resolved) => homeOf({ resolved }), (error) => homeOf({ error }));
  const facts = [defaultFact(preferred, base), handlersFact(handlers, base), stack, homeFact(home, base)];
  const any = (state: PremiseState): boolean => facts.some((f) => f.state === state);
  const state: PremiseState = any('stale') ? 'stale' : any('unread') ? 'unread' : 'fresh';
  return { state, facts, lines: premiseLines(state, facts, preferred.state === 'read' ? lastChosenOf(preferred) : []) };
}

/**
 * live.ts's premise step: the premise read (readChooserPremise), kept in the run's record (`chooserPremise`, which the
 * summary reads: live-cases.ts#summarizeRecord), and its lines echoed through `note` at once, so the owner can stop a
 * run on a stale lab before its cases; the summary prints them again. Nothing read, nothing kept.
 */
export async function readPremiseInto(
  record: { chooserPremise?: ChooserPremise },
  lab: PremiseLab | undefined,
  selected: readonly { group: string }[],
  { note }: { note?: (line: string) => void } = {},
): Promise<void> {
  const premise = await readChooserPremise(lab, selected, { note });
  if (premise === undefined) return;
  record.chooserPremise = premise;
  for (const line of premise.lines) note?.(line);
}
