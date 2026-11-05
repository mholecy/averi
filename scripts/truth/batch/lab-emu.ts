import { join } from 'node:path';
import { adbShellArgv } from '../../../src/adapters/adb-shell.js';
import { CHOOSER_FOCUS_COMMAND } from '../../../src/adapters/android-chooser.js';
import { AndroidLab, pause } from '../lab-device.js';
import { markDirty, type Putback, type WindowSpec } from './abort.js';
import { execOf, type Call, type CallResult, type Run } from './bounded.js';
import { nodeFs, type BatchFs } from './io.js';
import { stateOf } from './run-dir.js';
import {
  adbLine,
  cellsHand,
  CHECK_EXIT,
  CHECK_OUTCOME,
  CLIPBOARD_ARGV,
  checkExit,
  checkHand,
  checkLine,
  checkWhy,
  chooserOf,
  CLEANUP_LABEL,
  defaultHand,
  focusOf,
  handlersOf,
  installedOf,
  LAB_PACKAGE,
  missingHand,
  PREFERRED_ARGV,
  preferredOf,
  ROLE_HOLDERS_ARGV,
  stateFileHand,
  stateHand,
  safeTap,
  shellReadOf,
  treeOf,
  unknownInstallHand,
  unreachableOf,
  type AcceptedEntry,
  type CheckExit,
  type HandBase,
  type FocusRead,
  type Installed,
  type PreferredRead,
  type ShellRead,
  type TapRefusal,
  type TapTarget,
} from './lab-chooser.js';
import { exitText, failedCall, firstLineOf, messageOf, nameInLine, verdictLine, type Verdict } from './words.js';
import type { Point } from '../../../src/adapters/types.js';

/**
 * The lab emulator around a block that may leave the chooser up or a preferred activity behind (batch-9's D55 to
 * batch-12's E5), over the emulator: --check's reads, the chooser dismissed, the one guarded tap, the install read
 * (`adb get-state` first), the abort-safe reinstall that clears a lab default, the cleanup that branches on --check's
 * exit, and the chooser's dirty window for the abort. What is decided and said is lab-chooser.ts's; here are the calls,
 * through the injected Run, and the files, through io.ts.
 *
 * Every call goes to the lab AVD only: a `LabEmu` is had only through lab-device.ts's Android guard (`adb -s <serial>
 * emu avd name` says `averi_lab`), and every adb call names its serial first. Nothing here taps but `tapSafely`, at the
 * point safeTap gives, never inside an "Always" node; nothing writes a setting, a role or a preferred activity; the
 * only writes are the reinstall's own uninstall and install, after the state file is marked dirty. Files are never
 * overwritten: a pulled APK is a fresh file.
 *
 * What S6 adds around it: the block's steps, its `.cases`, the SUMMARY assembly, the probe's own state put back (its
 * `--restore`, handed in as a `StateRestore`).
 */

/** `unzip -p`'s bound (a host read of the pulled APK, no device call). */
export const UNZIP_SECS = 30;
/** The wait after a key event before the next read (batch-11's `sleep 1`, d55-b11.ts's 1000 ms). */
export const SETTLE_MS = 1000;
/** How many BACKs a dismissal presses at most while a chooser is in front (d55-b11.ts's restore: 3). */
export const MAX_BACKS = 3;
/** The catalog's copy inside the lab APK (batch-11.sh: `unzip -p … assets/cells.json`). */
export const CELLS_ENTRY = 'assets/cells.json';

// ----------------------------------------------------------------------------------------- the lab emulator

/**
 * The lab emulator, guarded: had only through `LabEmu.open`, which runs lab-device.ts's Android guard (`emu avd name`
 * must say `averi_lab`). `using` gives the same guarded emulator over another Run (an abort's detached runner).
 */
export class LabEmu {
  private constructor(
    readonly serial: string,
    /** The Run its calls go through: a `StateRestore` is handed this one. */
    readonly run: Run,
    readonly fs: BatchFs,
    /** The wait after a key event (tests pass none). */
    readonly settle: (ms: number) => Promise<unknown>,
  ) {}

  /** The lab emulator `serial`, or why it is refused (nothing was done to it). */
  static async open(
    serial: string,
    run: Run,
    opts: { fs?: BatchFs; settle?: (ms: number) => Promise<unknown> } = {},
  ): Promise<{ ok: true; emu: LabEmu } | { ok: false; why: string }> {
    try {
      await new AndroidLab(serial, { exec: execOf(run) }).guard();
      return { ok: true, emu: new LabEmu(serial, run, opts.fs ?? nodeFs, opts.settle ?? pause) };
    } catch (e) {
      return { ok: false, why: `the lab guard refused ${nameInLine(serial)} (nothing was done to it): ${firstLineOf(messageOf(e))}` };
    }
  }

  using(run: Run): LabEmu {
    return new LabEmu(this.serial, run, this.fs, this.settle);
  }

  /** `adb -s <serial> <words…>`, bounded by boundFor (install and uninstall the install bound, else 120 s). */
  adb(words: readonly string[], call?: Call): Promise<CallResult> {
    return this.run('adb', ['-s', this.serial, ...words], call);
  }

  /** `adb shell <argv>`, each word quoted for the device's sh (adb-shell.ts#adbShellArgv). */
  shell(argv: readonly string[]): Promise<CallResult> {
    return this.run('adb', adbShellArgv(this.serial, argv));
  }

  /** `adb shell <command line>` as one word: a pipe in it reaches the device's sh (CHOOSER_FOCUS_COMMAND). */
  rawShell(command: string): Promise<CallResult> {
    return this.run('adb', ['-s', this.serial, 'shell', command]);
  }

  async key(code: 'KEYCODE_BACK' | 'KEYCODE_HOME'): Promise<void> {
    await this.shell(['input', 'keyevent', code]);
    await this.settle(SETTLE_MS);
  }
}

// ---------------------------------------------------------------------------------------------- the reads

/** --check's reads, its exit and its line. */
export interface Check {
  exit: CheckExit;
  focus: FocusRead;
  preferred: PreferredRead;
  line: string;
}

/** --check (d55-b11.ts --check): the focus (CHOOSER_FOCUS_COMMAND) and the preferred block, read only. */
export async function readCheck(emu: LabEmu, accepted: readonly AcceptedEntry[]): Promise<Check> {
  const focus = focusOf(await emu.rawShell(CHOOSER_FOCUS_COMMAND));
  const preferred = preferredOf(await emu.shell(PREFERRED_ARGV));
  return { exit: checkExit(focus, preferred, accepted), focus, preferred, line: checkLine(focus, preferred, accepted) };
}

/** --check, and when a chooser is in front, BACK and HOME and --check once more (batch-11's and batch-12's cleanup). */
async function checkAfterDismissal(emu: LabEmu, accepted: readonly AcceptedEntry[]): Promise<Check> {
  const first = await readCheck(emu, accepted);
  if (first.exit !== CHECK_EXIT.chooser) return first;
  await dismissChooser(emu);
  return readCheck(emu, accepted);
}

/** BACK while a chooser is in front (MAX_BACKS at most), then HOME (d55-b11.ts's restore): how many BACKs it took. */
export async function dismissChooser(emu: LabEmu): Promise<{ backs: number }> {
  let backs = 0;
  const chooserUp = async () => chooserOf(focusOf(await emu.rawShell(CHOOSER_FOCUS_COMMAND))) !== undefined;
  while (backs < MAX_BACKS && (await chooserUp())) {
    await emu.key('KEYCODE_BACK');
    backs++;
  }
  await emu.key('KEYCODE_HOME');
  return { backs };
}

/** Why `adb get-state` says the emulator cannot be asked, or undefined when it says `device`. */
export async function unreachable(emu: LabEmu): Promise<string | undefined> {
  return unreachableOf(await emu.adb(['get-state']));
}

/** The lab installed, missing or unknown: `adb get-state` first — unreachable is unknown, and `pm path` is not asked. */
export async function labInstalled(emu: LabEmu): Promise<Installed> {
  const why = await unreachable(emu);
  if (why !== undefined) return { state: 'unknown', why };
  return installedOf(await emu.shell(['pm', 'path', LAB_PACKAGE]));
}

/** The browser role holder (batch-9's read): API 33 says `Unknown command`, which is unread. */
export async function readRoleHolders(emu: LabEmu): Promise<ShellRead> {
  return shellReadOf(await emu.shell(ROLE_HOLDERS_ARGV));
}

/**
 * The clipboard (batch-9's D43 read): API 33's clipboard service has no shell implementation (`cmd clipboard help`
 * says `No shell command implementation.`, exit 0), so the read is unread there — never "unchanged". The help is the
 * read: a release with a getter answers it with its commands, which batch-13 records before any getter is trusted.
 */
export async function readClipboard(emu: LabEmu): Promise<ShellRead> {
  return shellReadOf(await emu.shell(CLIPBOARD_ARGV));
}

/** The activities handling `url` (batch-11.sh's handlers: shared 2, cell 1), or why not. */
export async function handlers(emu: LabEmu, url: string): Promise<number | { why: string }> {
  return handlersOf(await emu.shell(['cmd', 'package', 'query-activities', '--brief', '-a', 'android.intent.action.VIEW', '-d', url]));
}

// ------------------------------------------------------------------------------------------------- the tap

export type Tapped = { tapped: true; point: Point; why: string } | { tapped: false; refusal: TapRefusal | 'no-tree' | 'not-sent'; why: string };

/**
 * The one guarded tap: a fresh `uiautomator dump /dev/tty`, safeTap over it, and `input tap` at its point only when it
 * allows one — never "Always" (the recorder's invariant). A dump that fails or does not parse taps nothing.
 */
export async function tapSafely(emu: LabEmu, target: TapTarget, at?: Point): Promise<Tapped> {
  const dump = await emu.adb(['exec-out', 'uiautomator', 'dump', '/dev/tty']);
  if (failedCall(dump)) return { tapped: false, refusal: 'no-tree', why: `uiautomator dump: ${exitText(dump)}` };
  const tree = treeOf(dump.out);
  if ('why' in tree) return { tapped: false, refusal: 'no-tree', why: tree.why };
  const guard = safeTap(tree, target, at);
  if (!guard.ok) return { tapped: false, refusal: guard.refusal, why: guard.why };
  const sent = await emu.shell(['input', 'tap', String(guard.point.x), String(guard.point.y)]);
  if (failedCall(sent)) return { tapped: false, refusal: 'not-sent', why: `input tap: ${exitText(sent)}` };
  return { tapped: true, point: guard.point, why: guard.why };
}

// ------------------------------------------------------------------------------------------- the reinstall

/** How far a reinstall got, for the abort (batch-11's REINSTALLING/REINSTALLED): from its uninstall until its proof. */
export interface ReinstallProgress {
  step: 'not started' | 'started' | 'proven';
}
export const reinstallProgress = (): ReinstallProgress => ({ step: 'not started' });

/**
 * The probe's own state put back onto the lab (its `--restore`: the reinstall wipes the lab's data), through the Run
 * it is given; it writes its state file clean only once it has read the state back. `command` is how a person runs it
 * by hand: a RESTORE line names it when the restore fails with no hand line of its own.
 */
export interface StateRestore {
  restore(run: Run): Promise<Putback>;
  command: string;
  /** The probe's run that writes its state file (`--state`), for a hand line when there is none to mark dirty. */
  stateCommand?: string;
}

/** What the reinstall and the chooser's window share. */
export interface LabOptions {
  /** The APK pulled at the lab check (batch-11's `lab/installed.apk`): the one reinstalled. */
  apk: string;
  /** main's catalog (fixtures/apps/cells.json): an installed APK's `assets/cells.json` must equal it byte for byte. */
  catalog: string;
  /** Where an installed APK is pulled to for that proof (a fresh `reinstalled[-n].apk`, never overwritten). */
  dir: string;
  accepted: readonly AcceptedEntry[];
  progress: ReinstallProgress;
  putBack?: StateRestore;
}

export interface ReinstallOptions extends LabOptions {
  /** The probe's state file: marked dirty before the uninstall, or no uninstall. */
  stateFile: string;
}

export type Reinstalled = { ok: true; how: string; check: Check } | { ok: false; why: string; hand: string[] };

/** What a hand line is built from: the serial, the pulled APK, and after it the probe's restore or the preferred read. */
const handBaseOf = (emu: LabEmu, o: LabOptions): HandBase => ({ serial: emu.serial, apk: o.apk, then: o.putBack?.command ?? adbLine(emu.serial, ['shell', ...PREFERRED_ARGV]) });

/** A failed state restore's hand lines: its own, else its command. */
const stateHandOf = (p: Putback & { ok: false }, putBack: StateRestore): string[] => {
  const own = p.hand ?? [];
  return own.length > 0 ? [...own] : [stateHand(putBack.command)];
};

/** A fresh path for the reinstalled APK: `reinstalled.apk`, or `reinstalled-2.apk`, … — the first not there. */
export function freshApkOf(fs: BatchFs, dir: string): string {
  if (!fs.exists(join(dir, 'reinstalled.apk'))) return join(dir, 'reinstalled.apk');
  let n = 2;
  while (fs.exists(join(dir, `reinstalled-${n}.apk`))) n++;
  return join(dir, `reinstalled-${n}.apk`);
}

/**
 * Clear a lab default by reinstalling the pulled APK (batch-11's d55_reinstall): the probe's state file marked dirty
 * first — none there, or one that cannot be marked, and nothing is uninstalled (code review: the protocol needs its
 * dirty mark) — the chooser dismissed, then uninstall and install (`progress` started — an abort from here asks `adb
 * get-state` and `pm path` before anything else); proven by `pm path`, the reinstalled APK's cells.json equal to main's
 * catalog and --check after with an exit that proves the lab put back (CHECK_OUTCOME: 0, 5 or 6 — a chooser up or a
 * read that failed proves nothing: review round 1), only then `progress` proven and the probe's state put back
 * (`putBack`), so its state is written clean only after the proof. Refused, nothing done, with no pulled APK or no
 * catalog to compare with too. Each step that fails gets its own hand line. A last-chosen entry is never reinstalled
 * for: no reinstall clears it (batch-11 measured).
 */
export async function clearLabEntry(emu: LabEmu, o: ReinstallOptions): Promise<Reinstalled> {
  const { fs } = emu;
  const base = handBaseOf(emu, o);
  const nothingDone = (why: string, hand = defaultHand(base)): Reinstalled => ({ ok: false, why: `${why} — nothing done`, hand: [hand] });
  if (!fs.exists(o.apk)) return nothingDone(`no pulled APK at ${nameInLine(o.apk)} to reinstall`);
  const catalog = fs.read(o.catalog);
  if (catalog === undefined) return nothingDone(`the catalog ${nameInLine(o.catalog)} cannot be read, so a reinstall could not be proven`);
  let marked: string;
  try {
    marked = markDirty(fs, o.stateFile);
  } catch (e) {
    marked = firstLineOf(messageOf(e));
  }
  if (marked !== 'marked') return nothingDone(`the state file ${nameInLine(o.stateFile)} cannot be marked dirty (${marked})`, stateFileHand(base, o.stateFile, marked, o.putBack?.stateCommand));
  await dismissChooser(emu);
  o.progress.step = 'started';
  const notProven = (why: string, installed: Installed, hand: string): Reinstalled => ({ ok: false, why: `the reinstall not proven: ${why}; ${installedText(installed)}`, hand: [hand] });
  const uninstalled = await emu.adb(['uninstall', LAB_PACKAGE]);
  if (failedCall(uninstalled)) {
    const installed = await labInstalled(emu);
    return notProven(`the uninstall failed (${exitText(uninstalled)})`, installed, installed.state === 'installed' ? defaultHand(base) : installHandOf(base, installed));
  }
  const installCall = await emu.adb(['install', o.apk]);
  const installed = await labInstalled(emu);
  if (installed.state !== 'installed') return notProven(`after the install (${failedCall(installCall) ? exitText(installCall) : 'exit 0'})`, installed, installHandOf(base, installed));
  const cells = await provenCells(emu, installed.path, catalog, o);
  if (cells !== undefined) return notProven(cells, installed, cellsHand(base, o.catalog, cells));
  const check = await checkAfterDismissal(emu, o.accepted);
  const outcome = CHECK_OUTCOME[check.exit];
  if (!outcome.proven) return notProven(`after the reinstall, ${check.line}`, installed, outcome.hand(base)[0]);
  o.progress.step = 'proven';
  const how = `uninstalled and reinstalled from ${nameInLine(o.apk)} (pm path ${installed.path}; its ${CELLS_ENTRY} the catalog's); ${check.line}`;
  if (o.putBack === undefined) return { ok: true, how, check };
  const back = await o.putBack.restore(emu.run);
  if (!back.ok) return { ok: false, why: `reinstalled and proven, but the lab's state not put back: ${back.why}`, hand: stateHandOf(back, o.putBack) };
  return { ok: true, how: `${how}; ${back.how}`, check };
}

/** The install read in words. */
const installedText = (i: Installed): string =>
  i.state === 'unknown' ? `whether the lab is installed is unknown (${i.why})` : i.state === 'missing' ? 'the lab is NOT installed' : 'the lab is installed';

/** The hand line for a lab not proven installed: unknown (never "missing"), or missing. */
const installHandOf = (b: HandBase, i: Exclude<Installed, { state: 'installed' }>): string => (i.state === 'unknown' ? unknownInstallHand(b) : missingHand(b));

/** Why the installed APK is not proven the catalog's — not pulled, its cells.json not read, or another — or undefined. */
async function provenCells(emu: LabEmu, devicePath: string, catalog: string, o: { catalog: string; dir: string }): Promise<string | undefined> {
  const local = freshApkOf(emu.fs, o.dir);
  const pulled = await emu.adb(['pull', devicePath, local]);
  if (failedCall(pulled) || !emu.fs.exists(local)) return `the reinstalled APK not pulled (${failedCall(pulled) ? exitText(pulled) : 'exit 0 but no file'})`;
  const cells = await emu.run('unzip', ['-p', local, CELLS_ENTRY], { secs: UNZIP_SECS });
  if (failedCall(cells)) return `${CELLS_ENTRY} not read from the reinstalled APK (unzip: ${exitText(cells)})`;
  return cells.out === catalog ? undefined : `the reinstalled APK's ${CELLS_ENTRY} is not the catalog's ${nameInLine(o.catalog)}`;
}

// ------------------------------------------------------------------------------------------------- the cleanup

export interface Cleanup {
  verdict: Verdict;
  /** `D55 cleanup: <verdict> — <why>`. */
  line: string;
  /** RESTORE lines: none when nothing is left to do by hand. */
  hand: string[];
  check: Check;
}

/**
 * The block's cleanup (batch-11.sh's D55 cleanup, batch-12's e5_check): --check, BACK and HOME and --check again when
 * a chooser is in front; then by its exit, CHECK_OUTCOME's word, words and hand lines — 0 and 5 OK; 6 a WARN, no
 * RESTORE (no reinstall clears a last-chosen entry, so none is tried: batch-12 fixed batch-11's); 3 and 4 ERROR; 1, a
 * lab default, FAIL even when the reinstall clears it ("Always" is never tapped, so a default predates the batch or is
 * a defect), the reinstall's hand lines when it does not.
 */
export async function cleanUp(emu: LabEmu, o: ReinstallOptions): Promise<Cleanup> {
  const check = await checkAfterDismissal(emu, o.accepted);
  const outcome = CHECK_OUTCOME[check.exit];
  const words = outcome.words(checkWhy(check.focus, check.preferred, o.accepted));
  const done = (text: string, hand: string[]): Cleanup => ({ verdict: outcome.word, line: verdictLine(CLEANUP_LABEL, outcome.word, text), hand, check });
  if (check.exit !== CHECK_EXIT.leak) return done(words, outcome.hand(handBaseOf(emu, o)));
  const r = await clearLabEntry(emu, o);
  return r.ok ? done(`${words}; cleared: ${r.how}`, []) : done(`${words}; NOT cleared: ${r.why}`, r.hand);
}

// ------------------------------------------------------------------------------------------------ the window

export interface ChooserWindowOptions extends LabOptions {
  /** The probe's state file: the abort puts the window back only when it reads clean after (abort.ts). */
  stateFile?: string;
  block?: string;
  cleanup?: string;
  secs?: number;
}

/** Interrupted inside the reinstall with the install not known: never "missing", never "put back". */
const unknownDuringReinstall = (b: HandBase, why: string): Putback => ({ ok: false, why: `interrupted during the reinstall: whether the lab is installed is unknown (${why})`, hand: [unknownInstallHand(b)] });

/**
 * The chooser's dirty window (abort.ts): its restore this module's, over the abort's detached runner — `adb get-state`
 * first (unreachable: unknown at once, nothing pressed, never "missing" and never "put back"; review round 1); BACK and
 * HOME; when interrupted inside the reinstall, the install read: missing is installed again from the pulled APK, and
 * the lab installed — again or found so — is proven by its cells.json as the reinstall proves it, or not put back; the
 * probe's state put back (`putBack`) whenever its state file is not clean (review round 4); then
 * --check (BACK and HOME again on a chooser), judged by CHECK_OUTCOME: the cleanup's word and words, exit by exit, a
 * WARN put back for 6. Its hand lines name the exact step, and an uninstall only for a default measured.
 */
export function chooserWindow(emu: LabEmu, o: ChooserWindowOptions): WindowSpec {
  const base = handBaseOf(emu, o);
  return {
    async restore(run) {
      const lab = emu.using(run);
      const why = await unreachable(lab);
      if (why !== undefined) return o.progress.step === 'started' ? unknownDuringReinstall(base, why) : { ok: false, why: `adb unreachable, so nothing could be read or put back (${why})`, hand: [checkHand(base.serial)] };
      await dismissChooser(lab);
      if (o.progress.step === 'started') {
        const proof = await reinstalledProof(lab, o, base);
        if (proof !== undefined) return proof;
      }
      // The probe's restore whenever its state file is not clean: it also undoes what the probe changed itself (it
      // force-stops the lab, puts its state file back), whatever the reinstall did (review round 4, as batch-11 and
      // batch-12 ran it); a note, after it verified, when no reinstall started: nothing was wiped, the state put back.
      let kept = '';
      if (o.putBack !== undefined) {
        if (o.stateFile !== undefined && stateOf(lab.fs, o.stateFile) === 'clean') kept = "; the probe's state file is clean: nothing to put back";
        else {
          const back = await o.putBack.restore(run);
          if (!back.ok) return { ...back, hand: stateHandOf(back, o.putBack) };
          if (o.progress.step === 'not started') kept = "; nothing was wiped; the probe's state put back";
        }
      }
      const check = await checkAfterDismissal(lab, o.accepted);
      const outcome = CHECK_OUTCOME[check.exit];
      const words = outcome.words(checkWhy(check.focus, check.preferred, o.accepted));
      if (outcome.proven) return { ok: true, how: `${words}${kept}`, ...(outcome.word === 'WARN' && { verdict: 'WARN' as const }) };
      return { ok: false, why: words, hand: outcome.hand(base), ...(outcome.word === 'FAIL' && { verdict: 'FAIL' as const }) };
    },
    // Read when asked (the abort writes it): inside the reinstall, the install line first; the state restore's command.
    get hand() {
      return [...(o.progress.step === 'started' ? [unknownInstallHand(base)] : []), checkHand(base.serial), ...(o.putBack === undefined ? [] : [stateHand(o.putBack.command)])];
    },
    ...(o.stateFile !== undefined && { stateFile: o.stateFile }),
    ...(o.block !== undefined && { block: o.block }),
    ...(o.cleanup !== undefined && { cleanup: o.cleanup }),
    ...(o.secs !== undefined && { secs: o.secs }),
  };
}

/**
 * Interrupted inside the reinstall: the lab installed again when missing, then proven the pulled APK by its cells.json;
 * undefined when it is, else the window's outcome, not put back.
 */
async function reinstalledProof(lab: LabEmu, o: ChooserWindowOptions, base: HandBase): Promise<Putback | undefined> {
  let installed = await labInstalled(lab);
  if (installed.state === 'unknown') return unknownDuringReinstall(base, installed.why);
  if (installed.state === 'missing') {
    await lab.adb(['install', o.apk]);
    installed = await labInstalled(lab);
    if (installed.state !== 'installed') {
      const said = installed.state === 'unknown' ? `unknown (${installed.why})` : 'still missing';
      return { ok: false, why: `interrupted during the reinstall: the lab was not installed; after the install it is ${said}`, hand: [installHandOf(base, installed)] };
    }
  }
  const catalog = lab.fs.read(o.catalog);
  const cells = catalog === undefined ? `the catalog ${nameInLine(o.catalog)} cannot be read` : await provenCells(lab, installed.path, catalog, o);
  if (cells === undefined) return undefined;
  return { ok: false, why: `interrupted during the reinstall: the installed lab not proven the pulled APK: ${cells}`, hand: [cellsHand(base, o.catalog, cells)] };
}
