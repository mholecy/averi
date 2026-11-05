import { join } from 'node:path';
import { adbShellArgv } from '../../../src/adapters/adb-shell.js';
import { CHOOSER_FOCUS_COMMAND } from '../../../src/adapters/android-chooser.js';
import { AndroidLab, pause } from '../lab-device.js';
import { markDirty, type Putback, type WindowSpec } from './abort.js';
import { execOf, type Call, type CallResult, type Run } from './bounded.js';
import { nodeFs, type BatchFs } from './io.js';
import {
  CHECK_EXIT,
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
  safeTap,
  shellReadOf,
  treeOf,
  unknownInstallHand,
  unreachableOf,
  type AcceptedEntry,
  type CheckExit,
  type FocusRead,
  type Installed,
  type PreferredRead,
  type ShellRead,
  type TapRefusal,
  type TapTarget,
} from './lab-chooser.js';
import { exitText, firstLineOf, messageOf, nameInLine, verdictLine, type Verdict } from './words.js';
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
 * `--restore`, handed in as `PutBack`).
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
    /** The Run its calls go through: a `PutBack` is handed this one. */
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

/** The lab installed, missing or unknown: `adb get-state` first — unreachable is unknown, and `pm path` is not asked. */
export async function labInstalled(emu: LabEmu): Promise<Installed> {
  const state = await emu.adb(['get-state']);
  const unreachable = unreachableOf(state);
  if (unreachable !== undefined) return { state: 'unknown', why: unreachable };
  return installedOf(state, await emu.shell(['pm', 'path', LAB_PACKAGE]));
}

/** The browser role holder (batch-9's read): API 33 says `Unknown command`, which is unread. */
export async function readRoleHolders(emu: LabEmu): Promise<ShellRead> {
  return shellReadOf(await emu.shell(ROLE_HOLDERS_ARGV));
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
  if (dump.code !== 0) return { tapped: false, refusal: 'no-tree', why: `uiautomator dump: ${exitText(dump)}` };
  const tree = treeOf(dump.out);
  if ('why' in tree) return { tapped: false, refusal: 'no-tree', why: tree.why };
  const guard = safeTap(tree, target, at);
  if (!guard.ok) return { tapped: false, refusal: guard.refusal, why: guard.why };
  const sent = await emu.shell(['input', 'tap', String(guard.point.x), String(guard.point.y)]);
  if (sent.code !== 0) return { tapped: false, refusal: 'not-sent', why: `input tap: ${exitText(sent)}` };
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
 * it is given; it writes its state file clean only once it has read the state back.
 */
export type PutBack = (run: Run) => Promise<Putback>;

export interface ReinstallOptions {
  /** The APK pulled at the lab check (batch-11's `lab/installed.apk`): the one reinstalled. */
  apk: string;
  /** main's catalog (fixtures/apps/cells.json): the reinstalled APK's `assets/cells.json` must equal it byte for byte. */
  catalog: string;
  /** The probe's state file: marked dirty before the uninstall. */
  stateFile: string;
  /** Where the reinstalled APK is pulled to (a fresh `reinstalled[-n].apk`, never overwritten). */
  dir: string;
  accepted: readonly AcceptedEntry[];
  progress: ReinstallProgress;
  putBack?: PutBack;
}

export type Reinstalled = { ok: true; how: string; check: Check } | { ok: false; why: string; hand: string[] };

/** A fresh path for the reinstalled APK: `reinstalled.apk`, or `reinstalled-2.apk`, … — the first not there. */
export function freshApkOf(fs: BatchFs, dir: string): string {
  if (!fs.exists(join(dir, 'reinstalled.apk'))) return join(dir, 'reinstalled.apk');
  let n = 2;
  while (fs.exists(join(dir, `reinstalled-${n}.apk`))) n++;
  return join(dir, `reinstalled-${n}.apk`);
}

/**
 * Clear a lab default by reinstalling the pulled APK (batch-11's d55_reinstall): the chooser dismissed, the probe's
 * state file marked dirty, then uninstall and install (`progress` started — an abort from here asks `adb get-state`
 * and `pm path` before anything else); proven by `pm path`, the reinstalled APK's cells.json equal to main's catalog
 * and --check after (no lab default left), only then `progress` proven and the probe's state put back (`putBack`), so
 * its state is written clean only after the proof. Refused, nothing done, with no pulled APK, no catalog to compare
 * with, or a state file that cannot be marked dirty. A last-chosen entry is never reinstalled for: no reinstall clears
 * it (batch-11 measured).
 */
export async function clearLabEntry(emu: LabEmu, o: ReinstallOptions): Promise<Reinstalled> {
  const { fs, serial } = emu;
  const nothingDone = (why: string): Reinstalled => ({ ok: false, why: `${why} — nothing done`, hand: [defaultHand(serial, o.apk)] });
  if (!fs.exists(o.apk)) return nothingDone(`no pulled APK at ${nameInLine(o.apk)} to reinstall`);
  const catalog = fs.read(o.catalog);
  if (catalog === undefined) return nothingDone(`the catalog ${nameInLine(o.catalog)} cannot be read, so a reinstall could not be proven`);
  let marked: string;
  try {
    marked = markDirty(fs, o.stateFile);
  } catch (e) {
    marked = firstLineOf(messageOf(e));
  }
  if (marked !== 'marked' && marked !== 'missing') return nothingDone(`the state file ${nameInLine(o.stateFile)} cannot be marked dirty (${marked})`);
  await dismissChooser(emu);
  o.progress.step = 'started';
  const gone = await emu.adb(['uninstall', LAB_PACKAGE]);
  if (gone.code !== 0) return notProven(emu, o, `the uninstall failed (${exitText(gone)})`);
  const put = await emu.adb(['install', o.apk]);
  const installed = await labInstalled(emu);
  if (installed.state !== 'installed') return notProven(emu, o, `after the install (${put.code === 0 ? 'exit 0' : exitText(put)})`, installed);
  const cells = await cellsOf(emu, installed.path, o.dir);
  if (typeof cells !== 'string') return notProven(emu, o, cells.why, installed);
  if (cells !== catalog) return notProven(emu, o, `the reinstalled APK's ${CELLS_ENTRY} is not the catalog's ${nameInLine(o.catalog)}`, installed);
  const check = await checkAfterDismissal(emu, o.accepted);
  if (check.exit === CHECK_EXIT.leak || check.exit === CHECK_EXIT.unproven) return notProven(emu, o, `after the reinstall, ${check.line}`, installed);
  o.progress.step = 'proven';
  const stateSaid = marked === 'missing' ? "; WARN the reinstall wiped the lab's data, and the probe recorded no state to put back" : '';
  const back = o.putBack === undefined || marked === 'missing' ? undefined : await o.putBack(emu.run);
  if (back !== undefined && !back.ok) return { ok: false, why: `reinstalled and proven, but the lab's state not put back: ${back.why}`, hand: [...(back.hand ?? [])] };
  const how = `uninstalled and reinstalled from ${nameInLine(o.apk)} (pm path ${installed.path}; its ${CELLS_ENTRY} the catalog's); ${check.line}`;
  return { ok: true, how: `${how}${back === undefined ? stateSaid : `; ${back.how}`}`, check };
}

/** The reinstall not proven: why, and the hand lines for what the lab may be left as (unknown is never "missing"). */
async function notProven(emu: LabEmu, o: ReinstallOptions, why: string, known?: Installed): Promise<Reinstalled> {
  const installed = known ?? (await labInstalled(emu));
  const said = installed.state === 'unknown' ? `whether the lab is installed is unknown (${installed.why})` : installed.state === 'missing' ? 'the lab is NOT installed' : 'the lab is installed';
  const hand = [installed.state === 'unknown' ? unknownInstallHand(emu.serial, o.apk) : installed.state === 'missing' ? missingHand(emu.serial, o.apk) : defaultHand(emu.serial, o.apk)];
  return { ok: false, why: `the reinstall not proven: ${why}; ${said}`, hand };
}

/** The installed APK pulled to a fresh file and its cells.json read (`unzip -p`), or why not. */
async function cellsOf(emu: LabEmu, devicePath: string, dir: string): Promise<string | { why: string }> {
  const local = freshApkOf(emu.fs, dir);
  const pulled = await emu.adb(['pull', devicePath, local]);
  if (pulled.code !== 0 || !emu.fs.exists(local)) return { why: `the reinstalled APK not pulled (${pulled.code === 0 ? 'exit 0 but no file' : exitText(pulled)})` };
  const cells = await emu.run('unzip', ['-p', local, CELLS_ENTRY], { secs: UNZIP_SECS });
  return cells.code === 0 ? cells.out : { why: `${CELLS_ENTRY} not read from the reinstalled APK (unzip: ${exitText(cells)})` };
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
 * a chooser is in front; then by its exit — 0 and 5 OK; 6 a WARN, no RESTORE (no reinstall clears a last-chosen entry,
 * so none is tried: batch-12 fixed batch-11's); 3 and 4 ERROR with a hand line; 1, a lab default, FAIL even when the
 * reinstall clears it ("Always" is never tapped, so a default predates the batch or is a defect), the reinstall's hand
 * lines when it does not.
 */
export async function cleanUp(emu: LabEmu, o: ReinstallOptions): Promise<Cleanup> {
  const check = await checkAfterDismissal(emu, o.accepted);
  const why = checkWhy(check.focus, check.preferred, o.accepted);
  const done = (verdict: Verdict, text: string, hand: string[] = []): Cleanup => ({ verdict, line: verdictLine(CLEANUP_LABEL, verdict, text), hand, check });
  switch (check.exit) {
    case CHECK_EXIT.clean:
    case CHECK_EXIT.accepted:
      return done('OK', why);
    case CHECK_EXIT.lastChosen:
      return done('WARN', `a last-chosen entry not accepted (mAlways=false: no default; no reinstall clears it, so none is tried — no RESTORE): ${why}`);
    case CHECK_EXIT.unproven:
      return done('ERROR', `the preferred activities or the focus not proven clean: ${why}`, [checkHand(emu.serial)]);
    case CHECK_EXIT.chooser:
      return done('ERROR', `the chooser is still in front after BACK and HOME: ${why}`, [checkHand(emu.serial)]);
    case CHECK_EXIT.leak: {
      const r = await clearLabEntry(emu, o);
      const left = `a lab default (mAlways=true) was set — "Always" is never tapped, so it predates the batch or is a defect`;
      return r.ok ? done('FAIL', `${left}; cleared: ${r.how}`) : done('FAIL', `${left}; NOT cleared: ${r.why}`, r.hand);
    }
  }
}

// ------------------------------------------------------------------------------------------------ the window

export interface ChooserWindowOptions {
  apk: string;
  accepted: readonly AcceptedEntry[];
  progress: ReinstallProgress;
  putBack?: PutBack;
  /** The probe's state file: the abort puts the window back only when it reads clean after (abort.ts). */
  stateFile?: string;
  block?: string;
  cleanup?: string;
  secs?: number;
}

/**
 * The chooser's dirty window (abort.ts): its restore this module's, over the abort's detached runner — BACK and HOME;
 * when interrupted inside the reinstall, `adb get-state` first (unreachable: unknown, never "missing" and never "put
 * back"), the lab installed again from the pulled APK when proven missing; the probe's state put back (`putBack`);
 * then --check (BACK and HOME again on a chooser): 0, 5 and 6 put back (6's WARN in its words), a default FAIL, the
 * rest ERROR, each with its hand lines. Its hand lines name the exact step.
 */
export function chooserWindow(emu: LabEmu, o: ChooserWindowOptions): WindowSpec {
  return {
    async restore(run) {
      const e = emu.using(run);
      await dismissChooser(e);
      if (o.progress.step === 'started') {
        let installed = await labInstalled(e);
        if (installed.state === 'unknown') {
          return { ok: false, why: `interrupted during the reinstall: whether the lab is installed is unknown (${installed.why})`, hand: [unknownInstallHand(e.serial, o.apk)] };
        }
        if (installed.state === 'missing') {
          await e.adb(['install', o.apk]);
          installed = await labInstalled(e);
          if (installed.state !== 'installed') {
            const said = installed.state === 'unknown' ? `unknown (${installed.why})` : 'still missing';
            return { ok: false, why: `interrupted during the reinstall: the lab was not installed; after the install it is ${said}`, hand: [installed.state === 'unknown' ? unknownInstallHand(e.serial, o.apk) : missingHand(e.serial, o.apk)] };
          }
        }
      }
      if (o.putBack !== undefined) {
        const back = await o.putBack(run);
        if (!back.ok) return back;
      }
      const check = await checkAfterDismissal(e, o.accepted);
      const why = checkWhy(check.focus, check.preferred, o.accepted);
      if (check.exit === CHECK_EXIT.clean || check.exit === CHECK_EXIT.accepted) return { ok: true, how: why };
      if (check.exit === CHECK_EXIT.lastChosen) return { ok: true, how: `WARN a last-chosen entry not accepted (no default; no reinstall clears it): ${why}` };
      if (check.exit === CHECK_EXIT.leak) return { ok: false, why, hand: [defaultHand(e.serial, o.apk)], verdict: 'FAIL' };
      const left = check.exit === CHECK_EXIT.chooser ? 'the chooser is still in front after BACK and HOME' : 'not proven clean';
      return { ok: false, why: `${left}: ${why}`, hand: [checkHand(e.serial)] };
    },
    // Read when asked (the abort writes it): inside the reinstall, the install line first.
    get hand() {
      return [...(o.progress.step === 'started' ? [unknownInstallHand(emu.serial, o.apk)] : []), checkHand(emu.serial), defaultHand(emu.serial, o.apk)];
    },
    ...(o.stateFile !== undefined && { stateFile: o.stateFile }),
    ...(o.block !== undefined && { block: o.block }),
    ...(o.cleanup !== undefined && { cleanup: o.cleanup }),
    ...(o.secs !== undefined && { secs: o.secs }),
  };
}
