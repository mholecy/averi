import { join } from 'node:path';
import type { Point } from '../../../src/adapters/types.js';
import { isDeviceCheckSimulator } from '../lab-device.js';
import type { CallResult } from './bounded.js';
import { HAND_PREFIX, LAB_WDA_PORT, RESTORE_LABEL, shellQuote } from './ios-defaults.js';
import { exitText, failedCall, firstLineOf, nameInLine, verdictLine } from './words.js';

/**
 * The lab plumbing's pure half (T2 S6b; ios-lab.ts, android-lab.ts and lab-build.ts hold the calls and the files):
 * what a read of the lab says — port 8120's listeners, a pkill's exit, the Open-in alert in an idb tree, an installed
 * cells.json against main's catalog, a JDK — the WDA window's restore line with its port part, and the exact patterns
 * the lab's own processes are ended by, and the shapes the three share. Strings in, strings out, as runner-lines.ts.
 */

/** What opening a guarded lab device gives: the device, or why it was refused (nothing was done to it). */
export type Opened<T> = { ok: true; value: T } | { ok: false; why: string };

/** A device need's words for this run's build: installed, or not rebuilt; and the rerun hint for an installed app off. */
export const REBUILT = "this run's build installed";
export const NOT_REBUILT = 'not rebuilt';
export const RERUN_HINT = '(rerun with ONLY=lab,…)';

/** main's catalog in the checkout under test (catalog.ts#CATALOG_FILE): every lab app bundles it. */
export const CATALOG_PATH = 'fixtures/apps/cells.json';

/** A simulator a pattern may name: never device-check's (lab-device.ts), whatever its case. */
function labUdid(udid: string): string {
  if (isDeviceCheckSimulator(udid)) throw new Error(`${udid} is the device-check simulator: no lab process is ended by its name`);
  return udid;
}

/**
 * The lab's WebDriverAgent by its exact patterns (batch-11.sh:321–325 kill_lab_wda): its own derived data
 * (lab-device.ts#LAB_WDA_DERIVED_DATA, never device-check's `averi-wda`) and the runner under the lab simulator's
 * folder.
 */
export const wdaKillPatterns = (udid: string): string[] => ['DerivedData/averi-wda-lab([/ ]|$)', `Devices/${labUdid(udid)}/.*WebDriverAgentRunner`];

/** The lab simulator's idb_companion (batch-11.sh:327, 660). */
export const companionPattern = (udid: string): string => `idb_companion --udid ${labUdid(udid)}`;

/**
 * idb's argv that drops the lab simulator's entry from idb's local companion list, and only it (batch-13): a pkill of
 * the companion leaves the entry, and every later idb call for the udid trusts it and fails ("Failed to connect to
 * companion") — fb-idb prunes dead entries only when it lists targets. Never `idb kill`, which clears every companion
 * idb knows, device-check's too.
 */
export const disconnectArgv = (udid: string): string[] => ['disconnect', labUdid(udid)];

/** What a disconnect that failed leaves: the warning (the entry may be stale), or none when it answered. */
export const disconnectWarning = (r: CallResult): string | undefined => (failedCall(r) ? `idb's companion entry may be stale — idb disconnect: ${exitText(r)}` : undefined);

/** idb's words when the companion its list names for the udid does not answer (batch-13 rerun 1). */
const STALE_SAID = /Failed to connect to companion/;
/** What those words most likely mean, said after them. */
export const STALE_COMPANION_WHY = "idb's local list names a companion for this simulator that does not answer: most likely a stale entry";

/** An idb call that failed in words (exitText), the stale entry named as the likely cause when idb's words say so. */
export const idbFailText = (r: CallResult): string => `${exitText(r)}${STALE_SAID.test(r.err + r.out) ? ` — ${STALE_COMPANION_WHY}` : ''}`;

/** pkill's answer: something ended (exit 0) or nothing matched (1); any other exit, or past its bound, why. */
export function pkillOf(r: CallResult): { ended: boolean } | { why: string } {
  if (!r.timedOut && (r.code === 0 || r.code === 1)) return { ended: r.code === 0 };
  return { why: `pkill: ${exitText(r)}` };
}

// --------------------------------------------------------------------------------------------- port 8120

/** lsof's argv for the lab port's listeners (d43-gate.ts's listeners): the lab's 8120 only, never 8100 or 8101. */
export const LSOF_ARGV: readonly string[] = ['-t', '-n', '-P', '-sTCP:LISTEN', '-i', `tcp:${LAB_WDA_PORT}`];

/** Port 8120 as lsof read it: free, listened on by these pids, or unread — never free unread. */
export type PortRead = { state: 'free' } | { state: 'busy'; pids: number[] } | { state: 'unread'; why: string };

/** lsof's answer: exit 1 with nothing printed free; exit 0 its pids (one a line); anything else unread. */
export function portOf(r: CallResult): PortRead {
  if (r.code === 1 && !r.timedOut && `${r.out}${r.err}`.trim() === '') return { state: 'free' };
  if (failedCall(r)) return { state: 'unread', why: `lsof: ${exitText(r)}` };
  const lines = r.out.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  if (lines.length === 0 || !lines.every((l) => /^\d+$/.test(l))) return { state: 'unread', why: `lsof printed no pid: ${firstLineOf(r.out)}` };
  return { state: 'busy', pids: lines.map(Number) };
}

/**
 * The restore line's port part (d43-gate.ts's restoreLine): free, free after a kill, still listened on, or not read.
 */
export function portPart(p: PortRead, killed: boolean): string {
  if (p.state === 'free') return `port ${LAB_WDA_PORT} free${killed ? ' (a listener killed)' : ''}`;
  if (p.state === 'busy') return `port ${LAB_WDA_PORT} still has a listener (pid ${p.pids.join(', ')})`;
  return `port ${LAB_WDA_PORT} not read (${p.why})`;
}

/** The lab's WebDriverAgent ended by hand, first: d43-gate.ts's hand line, the patterns quoted. */
export const portHand = (udid: string): string =>
  `${HAND_PREFIX}first end the lab's WebDriverAgent (a runner still running undoes a restore at its exit): ${wdaKillPatterns(udid)
    .map((p) => `pkill -f ${shellQuote(p)}`)
    .join('; ')}; lsof ${LSOF_ARGV.join(' ')} | xargs kill`;

/** The last hand line of a window not put back: the domains read back against their backups, then the state cleared. */
export const compareHand = (stateFile: string): string =>
  `${HAND_PREFIX}then read each domain back (defaults export) and compare it with its backup beside ${shellQuote(stateFile)}; only when every one is equal, set the state file's dirty to false`;

/**
 * The WDA window's hand lines, the one builder for every end (code review, MAJOR 1): the WebDriverAgent's kill first,
 * then each domain's (S4's), then the compare.
 */
export const wdaHandOf = (udid: string, domainsHand: readonly string[], stateFile: string): string[] => [portHand(udid), ...domainsHand, compareHand(stateFile)];

/**
 * The WDA window's restore line when the domains were restored with port 8120 proven free: S4's line, the port part;
 * not verified, the window's hand lines.
 */
export function wdaRestoredOf(r: { ok: boolean; line: string }, killed: boolean, hand: readonly string[]): { ok: boolean; line: string; hand: string[] } {
  return { ok: r.ok, line: `${r.line}; ${portPart({ state: 'free' }, killed)}`, hand: r.ok ? [] : [...hand] };
}

/**
 * The WDA window while port 8120 is not proven free (T2 S6b review round 1, BLOCKER): nothing restored — a runner still
 * running undoes a restore at its exit — so the state file stays dirty and the window is not put back; its hand lines
 * the window's (wdaHandOf).
 */
export function wdaBlockedOf(port: PortRead, killed: boolean, hand: readonly string[]): { ok: false; line: string; hand: string[] } {
  const why = `NOT VERIFIED — ${portPart(port, killed)}: the domains not put back (a WebDriverAgent still running undoes a restore at its exit); the state file left dirty`;
  return { ok: false, line: verdictLine(RESTORE_LABEL, 'ERROR', why), hand: [...hand] };
}

// ----------------------------------------------------------------------------------------- the Open-in alert

/**
 * A SpringBoard "Open in “<app>”?" confirmation in an idb tree: none, found (Cancel's centre if it has one), unread.
 */
export type OpenInAlert = { state: 'none' } | { state: 'found'; label: string; buttons: string[]; cancel: Point | undefined } | { state: 'unread'; why: string };

const OPEN_IN = /^Open in\b/;
const AX_FRAME = /\{\{([-\d.]+),\s*([-\d.]+)\},\s*\{([-\d.]+),\s*([-\d.]+)\}\}/;

type Element = Record<string, unknown> | null;
const text = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

/** An element's centre (open-in-alert.py's centre): its `frame`, else its `AXFrame` string; none without one. */
function centreOf(e: NonNullable<Element>): Point | undefined {
  const f = e.frame as Record<string, unknown> | null | undefined;
  if (typeof f === 'object' && f !== null && ['x', 'y', 'width', 'height'].every((k) => typeof f[k] === 'number')) {
    const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => f[k] as number);
    return { x: x + w / 2, y: y + h / 2 };
  }
  const m = AX_FRAME.exec(text(e.AXFrame));
  if (m === null) return undefined;
  const [x, y, w, h] = m.slice(1).map(Number);
  return { x: x + w / 2, y: y + h / 2 };
}

/**
 * `idb ui describe-all --json` read for the alert (open-in-alert.py's find): an element labelled, or valued, "Open in
 * …" is the alert; its buttons; Cancel — a button whose label, trimmed, is "cancel" in any case — and its centre. A
 * read that failed or printed no JSON list is unread, never none.
 */
export function openInAlertOf(r: CallResult): OpenInAlert {
  if (failedCall(r)) return { state: 'unread', why: `idb ui describe-all: ${exitText(r)}` };
  let els: unknown;
  try {
    els = JSON.parse(r.out);
  } catch {
    // no JSON: said below
  }
  if (!Array.isArray(els)) return { state: 'unread', why: `idb ui describe-all printed no JSON list: ${firstLineOf(r.out)}` };
  // An entry that is no element (null, a number) holds no label: never the alert, never a button.
  const all = els as Element[];
  // Found only by a label: never a null entry.
  const alert = all.find((e) => OPEN_IN.test(text(e?.AXLabel)) || OPEN_IN.test(text(e?.AXValue))) as NonNullable<Element> | undefined;
  if (alert === undefined) return { state: 'none' };
  const buttons = all.filter((e): e is NonNullable<Element> => e?.type === 'Button');
  const cancel = buttons.find((e) => text(e.AXLabel).trim().toLowerCase() === 'cancel');
  return { state: 'found', label: text(alert.AXLabel) === '' ? text(alert.AXValue) : text(alert.AXLabel), buttons: buttons.map((b) => text(b.AXLabel)), cancel: cancel === undefined ? undefined : centreOf(cancel) };
}

// ----------------------------------------------------------------------------------------- the installed lab

/** Why an installed cells.json is not main's catalog byte for byte (batch-11's `cmp -s`), or undefined when it is. */
export function cellsWhy(installed: string | undefined, catalog: string | undefined, where: string): string | undefined {
  if (catalog === undefined) return `main's catalog (${CATALOG_PATH}) could not be read`;
  if (installed === undefined) return `${where}'s cells.json could not be read`;
  return installed === catalog ? undefined : `${where}'s cells.json is not main's`;
}

// -------------------------------------------------------------------------------------------- the builds

/** Where a JDK 17 is looked for last (T23): macOS's folder of installed JDKs, each `<name>.jdk/Contents/Home`. */
export const JVM_DIR = '/Library/Java/JavaVirtualMachines';

/** The JVM folders, in the order tried: JVM_DIR, then the user's (java_home scans both; azul-17.0.19 lived there). */
export const jvmDirs = (home: string): string[] => [JVM_DIR, join(home, 'Library', 'Java', 'JavaVirtualMachines')];

/** Where the JDK 17 was found: JAVA_HOME, `java_home -v 17`, or a JVM folder. */
export type JdkFrom = 'JAVA_HOME' | 'java_home' | 'JavaVirtualMachines';

/** The JDK 17 found: its home, its source, and — when an earlier source was passed over — what it said. */
export interface Jdk17 {
  home: string;
  from: JdkFrom;
  /** `<what the passed-over sources said> — the build used <jdkLine>`; none when none was passed over. */
  warning?: string;
}

/** The JDK the build ran under, for its line: `JDK 17: <home> (from <source>)`. */
export const jdkLine = (jdk: { home: string; from: JdkFrom }): string => `JDK 17: ${nameInLine(jdk.home)} (from ${jdk.from})`;

/** What the JDK lookup asks (T23), each answer injected: lab-build.ts gives the config's env, the call, the fs. */
export interface JdkProbes {
  /** JAVA_HOME as the env says it (empty: unset). */
  javaHomeEnv: string | undefined;
  /** `java_home -v 17`, asked only when JAVA_HOME is no JDK 17. */
  javaHome(): Promise<CallResult>;
  /** The JVM folders, in the order tried (JVM_DIR, then the user's; a test's own). */
  jvms: readonly string[];
  /** A folder's entries ([] when unreadable). */
  list(dir: string): string[];
  /** A home's release file, or undefined when it cannot be read. */
  release(home: string): string | undefined;
  /** A home holds `bin/javac`: a JDK, not a JRE (Gradle needs the compiler). */
  javac(home: string): boolean;
}

/** A JDK's release file says it is 17: `JAVA_VERSION="17"` or `"17.…"`, on a line of its own. */
export const says17 = (release: string): boolean => /^JAVA_VERSION="17[."]/m.test(release);

/** One candidate home: undefined when it is a JDK 17 (its release says 17, it has bin/javac), else why not. */
const notJdk17 = (home: string, p: JdkProbes): string | undefined => {
  const said = p.release(home);
  if (said === undefined) return 'its release file not read';
  if (!says17(said)) return 'its release says no 17';
  return p.javac(home) ? undefined : 'no bin/javac (a JRE)';
};

/**
 * The JDK 17 for the Android build (batch-11.sh:309–310; T23): JAVA_HOME when it is a JDK 17; else
 * `java_home -v 17`'s home, checked the same; else the first `*.jdk` in each JVM folder in turn, sorted, whose
 * `Contents/Home` is one — `java_home` finds nothing inside the agent's sandbox although the JDK is installed.
 * A JDK 17: its release says 17 and it has bin/javac. Each source asked only when the ones before it failed. The
 * JDK, with a warning naming the sources passed over (JAVA_HOME unset is none); or why none — each source tried and
 * what it said.
 */
export async function jdk17Of(p: JdkProbes): Promise<Jdk17 | { why: string }> {
  const passed: string[] = [];
  const found = (home: string, from: JdkFrom): Jdk17 =>
    passed.length === 0 ? { home, from } : { home, from, warning: `${passed.join('; ')} — the build used ${jdkLine({ home, from })}` };
  const env = p.javaHomeEnv ?? '';
  if (env !== '') {
    const why = notJdk17(env, p);
    if (why === undefined) return found(env, 'JAVA_HOME');
    passed.push(`JAVA_HOME '${env}': ${why}`);
  }
  const r = await p.javaHome();
  const home = failedCall(r) ? '' : r.out.trim();
  if (home === '') passed.push(`java_home -v 17 → nothing${failedCall(r) ? `: ${exitText(r)}` : ''}`);
  else {
    const why = notJdk17(home, p);
    if (why === undefined) return found(home, 'java_home');
    passed.push(`java_home -v 17 → '${home}': ${why}`);
  }
  for (const dir of p.jvms) {
    const jdks = p.list(dir).filter((e) => e.endsWith('.jdk')).sort();
    const nots: string[] = [];
    for (const jdk of jdks) {
      const jdkHome = join(dir, jdk, 'Contents', 'Home');
      const why = notJdk17(jdkHome, p);
      if (why === undefined) return found(jdkHome, 'JavaVirtualMachines');
      nots.push(`${jdk} (${why})`);
    }
    passed.push(jdks.length === 0 ? `${dir}: no *.jdk (or unreadable)` : `${dir}: no JDK 17 among ${nots.join(', ')}`);
  }
  return { why: `no JDK 17 (${[...(env === '' ? ['JAVA_HOME unset'] : []), ...passed].join('; ')})` };
}

