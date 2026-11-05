import { join } from 'node:path';
import { LAB_APP, pause } from '../lab-device.js';
import type { WindowSpec } from './abort.js';
import type { Asked } from './cases.js';
import type { Call, CallResult, Run } from './bounded.js';
import type { BatchFs } from './io.js';
import { PROTECTED, protectedLine, type ProtectedRead } from './ios-defaults.js';
import { backup, compare, domainsWindow, LabSim, readProtected, restore } from './ios-domains.js';
import { CATALOG_PATH, cellsWhy, companionPattern, freshIn, LSOF_ARGV, openInAlertOf, pkillOf, compareHand, portHand, portOf, portPart, wdaBlockedOf, wdaKillPatterns, wdaRestoredOf, type PortRead } from './lab-lines.js';
import { askBuild, metWith, type BuildRef } from './lab-build.js';
import type { BlockCtx, LastStep, NeedCtx, NeedSpec } from './runner.js';
import type { BatchConfig, NeedResult } from './runner-lines.js';
import { STATE_FILE, stateOf } from './run-dir.js';
import { exitText, failedCall, nameInLine, type StepWord } from './words.js';

/**
 * The lab simulator's plumbing around a batch's iOS blocks (T2 S6b; batch-11.sh:321–361, 383–410, 623–660): the `ios`
 * need — the lab guard, the reset (boot, health), this run's build installed, the installed cells.json byte-equal to
 * main's catalog, and the finportal key's first read — and its cheap recheck; the health check before each run, the
 * Open-in alert dismissed; the WDA window (the `.cases` first, the backup, the work, the lab's WebDriverAgent ended,
 * the 4 s wait, port 8120 proven free, the restore key by key, the end check, the compare), registered as a dirty
 * window so the abort puts it back the same way; the iOS stretch's end (the finportal key's second read, its line);
 * and the run's last step that ends the lab's WebDriverAgent and idb_companion. What is decided and said is
 * lab-lines.ts's and ios-defaults.ts's; here are the calls, through the injected Run, and the files, through io.ts.
 *
 * Every call goes to the lab simulator only: an `IosSim` is had only through ios-domains.ts's LabSim, whose guard is
 * lab-device.ts's (device-check's udid refused before any call, then `averi-lab …` in simctl's list). Processes are
 * ended by the exact patterns lab-lines.ts gives — the lab's own WDA derived data, the runner under the lab
 * simulator's folder, the listeners of port 8120 — never device-check's WDA (8100, 8101) or its simulator. The only
 * tap is the Open-in alert's Cancel, at the centre of the button labelled so. The schemeapproval domain is only read.
 */

/** The wait after the lab's WebDriverAgent is ended, before the restore: its exit flips the domains (batch-10). */
export const WDA_EXIT_WAIT_MS = 4000;
/** The wait after a listener of port 8120 was killed, before the port is read again (d43-gate.ts's 1.5 s). */
export const PORT_RECHECK_MS = 1500;
/** The wait after the WebDriverAgent is ended in the health check (batch-11.sh's ios_check: `sleep 2`). */
export const CHECK_WAIT_MS = 2000;
/** The reset's waits after the boot and after the launch (batch-11.sh's ios_reset: `sleep 3`). */
export const RESET_WAIT_MS = 3000;
/** The wait after a tap on the alert's Cancel, before it is read again (open-in-alert.py's 1 s). */
export const ALERT_WAIT_MS = 1000;
/** How many taps on Cancel before the alert is called stuck (open-in-alert.py's two). */
export const ALERT_TAPS = 2;
/** pkill's, lsof's and kill's bound: host calls, each quick (d43-gate.ts's 10 s). */
export const HOST_SECS = 10;
/** The need's name in a batch's `needs`. */
export const IOS_NEED = 'ios';

/** What a lab helper is given: bounded calls and the steps (a need's ctx and a block's are both). */
export interface LabCtx {
  bounded: Run;
  step(word: StepWord, text: string): void;
}

/**
 * The lab simulator, guarded (LabSim's guard), with the raw calls the plumbing makes: simctl, idb, pkill, lsof, kill.
 */
export class IosSim {
  private constructor(
    readonly sim: LabSim,
    readonly run: Run,
    /** The waits (tests pass one that does not wait). */
    readonly wait: (ms: number) => Promise<unknown>,
  ) {}

  /** The lab simulator `udid`, or why it is refused (nothing was done to it). */
  static async open(udid: string, run: Run, o: { fs?: BatchFs; wait?: (ms: number) => Promise<unknown> } = {}): Promise<{ ok: true; lab: IosSim } | { ok: false; why: string }> {
    const r = await LabSim.open(udid, run, o.fs);
    return r.ok ? { ok: true, lab: new IosSim(r.sim, run, o.wait ?? pause) } : r;
  }

  get udid(): string {
    return this.sim.udid;
  }

  get fs(): BatchFs {
    return this.sim.fs;
  }

  /** The same guarded simulator over another Run (an abort's detached runner). */
  using(run: Run): IosSim {
    return new IosSim(this.sim.using(run), run, this.wait);
  }

  simctl(words: readonly string[], call?: Call): Promise<CallResult> {
    return this.run('xcrun', ['simctl', ...words], call);
  }

  idb(words: readonly string[]): Promise<CallResult> {
    return this.run('idb', [...words, '--udid', this.udid]);
  }
}

// ------------------------------------------------------------------------------------- the lab's processes

/**
 * What ends the lab's processes: a Run and the lab simulator's udid (an IosSim, or a guarded udid at the run's end).
 */
interface Killer {
  run: Run;
  udid: string;
}

/** Port 8120 read (lab-lines.ts#LSOF_ARGV). */
const portNow = async (k: Killer): Promise<PortRead> => portOf(await k.run('lsof', LSOF_ARGV, { secs: HOST_SECS }));

/** `kill -TERM` to each listener of the port, never this process. Whys of kills that failed. */
async function killListeners(k: Killer, pids: readonly number[]): Promise<string[]> {
  const whys: string[] = [];
  for (const pid of pids.filter((p) => p !== process.pid)) {
    const r = await k.run('kill', ['-TERM', String(pid)], { secs: HOST_SECS });
    if (failedCall(r)) whys.push(`kill ${pid}: ${exitText(r)}`);
  }
  return whys;
}

/**
 * The lab's WebDriverAgent ended (batch-11's kill_lab_wda): pkill by its two exact patterns, then `kill` to each
 * listener of port 8120. Returns the port as read, and the whys of what failed (none: all asked).
 */
export async function killLabWda(k: Killer): Promise<{ port: PortRead; whys: string[] }> {
  const whys: string[] = [];
  for (const p of wdaKillPatterns(k.udid)) {
    const r = pkillOf(await k.run('pkill', ['-f', p], { secs: HOST_SECS }));
    if ('why' in r) whys.push(r.why);
  }
  const port = await portNow(k);
  if (port.state === 'busy') whys.push(...(await killListeners(k, port.pids)));
  if (port.state === 'unread') whys.push(port.why);
  return { port, whys };
}

/**
 * Port 8120 proven free, after the wait (d43-gate.ts's restore): read; listened on, its listeners killed, and read
 * again after PORT_RECHECK_MS. `killed`: a listener was.
 */
async function portFree(lab: IosSim): Promise<{ port: PortRead; killed: boolean }> {
  const first = await portNow(lab);
  if (first.state !== 'busy') return { port: first, killed: false };
  await killListeners(lab, first.pids);
  await lab.wait(PORT_RECHECK_MS);
  return { port: await portNow(lab), killed: true };
}

/**
 * The run's last step (batch-11.sh:660 and the end of on_abort): the lab's WebDriverAgent and the lab simulator's
 * idb_companion ended by their exact patterns — what S2's kept groups cannot own (a runner launchd holds, a companion
 * that left its group); only for a simulator the guard cleared this run. A NOTE when done, a WARN naming what failed.
 */
export function endLabProcesses(guarded: () => string | undefined): LastStep {
  return async ({ run, step }) => {
    const udid = guarded();
    if (udid === undefined) return;
    const { port: first, whys } = await killLabWda({ run, udid });
    // Its listeners were killed: read again, so the line says what is left, not what was there.
    const killed = first.state === 'busy';
    const port = killed ? await portNow({ run, udid }) : first;
    const part = portPart(port, killed);
    // An unread first read is in the whys already (killLabWda's).
    if (killed && port.state !== 'free') whys.push(part);
    const companion = pkillOf(await run('pkill', ['-f', companionPattern(udid)], { secs: HOST_SECS }));
    if ('why' in companion) whys.push(companion.why);
    const said = `the lab's WebDriverAgent (${part}) and idb_companion of ${nameInLine(udid)} ended`;
    if (whys.length === 0) step('NOTE', said);
    else step('WARN', `${said}, not all proven: ${whys.join('; ')}`);
  };
}

// ---------------------------------------------------------------------------------- health, alert, reset

/** batch-11's ios_health: `idb ui describe-all`, then a swipe; why not, or undefined when both answered. */
export async function health(lab: IosSim): Promise<string | undefined> {
  const tree = await lab.idb(['ui', 'describe-all']);
  if (failedCall(tree)) return `describe-all: ${exitText(tree)}`;
  const swipe = await lab.idb(['ui', 'swipe', '200', '600', '200', '400']);
  return failedCall(swipe) ? `swipe: ${exitText(swipe)}` : undefined;
}

export type Dismissal = { state: 'none' } | { state: 'dismissed'; how: string } | { state: 'stuck'; why: string } | { state: 'unread'; why: string };

/**
 * A leftover "Open in …?" confirmation (open-in-alert.py): read; found, Cancel tapped at its centre — at most
 * ALERT_TAPS times, each followed by ALERT_WAIT_MS and a fresh read; stuck when it has no Cancel with a frame or is
 * still up. Nothing but that Cancel is ever tapped.
 */
export async function dismissOpenIn(lab: IosSim): Promise<Dismissal> {
  const read = async () => openInAlertOf(await lab.idb(['ui', 'describe-all', '--json']));
  let found = await read();
  for (let attempt = 1; found.state === 'found'; attempt++) {
    const { cancel } = found;
    if (cancel === undefined) return { state: 'stuck', why: `the open-in alert ${nameInLine(found.label)} has no Cancel button with a frame (buttons: ${found.buttons.map(nameInLine).join(', ')})` };
    if (attempt > ALERT_TAPS) return { state: 'stuck', why: `the open-in alert ${nameInLine(found.label)} is still up after ${ALERT_TAPS} Cancel taps` };
    const [x, y] = [Math.round(cancel.x), Math.round(cancel.y)];
    await lab.idb(['ui', 'tap', String(x), String(y)]);
    await lab.wait(ALERT_WAIT_MS);
    found = await read();
    if (found.state === 'none') return { state: 'dismissed', how: `Cancel tapped at ${x},${y} (attempt ${attempt})` };
  }
  return found;
}

/**
 * batch-11's ios_reset: the companion and the lab's WebDriverAgent ended, shutdown, boot and bootstatus (each bounded
 * by boundFor's 300 s), RESET_WAIT_MS, the lab launched, RESET_WAIT_MS, the health check. No companion is started by
 * hand: idb starts its own, kept in its call's group (bounded.ts#KEEPS_GROUP), ended at the run's end. Why not, or
 * undefined.
 */
export async function reset(c: LabCtx, lab: IosSim): Promise<string | undefined> {
  c.step('NOTE', `ios-reset: ${nameInLine(lab.udid)}, its idb companion and the lab's WebDriverAgent`);
  await lab.run('pkill', ['-f', companionPattern(lab.udid)], { secs: HOST_SECS });
  await killLabWda(lab);
  await lab.simctl(['shutdown', lab.udid]);
  for (const words of [['boot', lab.udid], ['bootstatus', lab.udid, '-b']]) {
    const r = await lab.simctl(words);
    if (failedCall(r)) return `simctl ${words[0]}: ${exitText(r)}`;
  }
  await lab.wait(RESET_WAIT_MS);
  await lab.simctl(['launch', lab.udid, LAB_APP.native.bundle]);
  await lab.wait(RESET_WAIT_MS);
  const sick = await health(lab);
  if (sick !== undefined) return `the health check after the reset: ${sick}`;
  c.step('OK', 'ios-reset');
  return undefined;
}

/**
 * batch-11's ios_check before `label`: the lab's WebDriverAgent ended, CHECK_WAIT_MS, the Open-in alert dismissed, the
 * health check; a stuck alert or a failed health check resets the simulator. Why it is not fit to run, or undefined.
 */
export async function iosCheck(c: LabCtx, lab: IosSim, label: string): Promise<string | undefined> {
  await killLabWda(lab);
  await lab.wait(CHECK_WAIT_MS);
  const alert = await dismissOpenIn(lab);
  if (alert.state === 'dismissed') c.step('WARN', `open-in alert before ${label}: dismissed — ${alert.how}`);
  if (alert.state === 'unread') c.step('NOTE', `open-in alert before ${label} not read: ${alert.why}`);
  let sick = alert.state === 'stuck' ? `the open-in alert could not be dismissed: ${alert.why}` : await health(lab);
  if (sick === undefined) {
    c.step('OK', `ios-health before ${label}`);
    return undefined;
  }
  c.step('WARN', `ios-health before ${label}: ${sick} — resetting`);
  sick = await reset(c, lab);
  if (sick === undefined) return undefined;
  c.step('ERROR', `ios-reset before ${label} failed: ${sick}`);
  return `the iOS reset before ${label} failed: ${sick}`;
}

// --------------------------------------------------------------------------------------- the installed lab

/**
 * The installed app's cells.json against main's catalog, byte for byte (batch-11.sh:402–404): its container read
 * through simctl (bounded), the file read and kept in the lab folder as evidence. Why not, or undefined.
 */
export async function installedCells(lab: IosSim, o: { repo: string; labDir: string }): Promise<string | undefined> {
  const r = await lab.simctl(['get_app_container', lab.udid, LAB_APP.native.bundle, 'app']);
  if (failedCall(r) || r.out.trim() === '') return `the lab app is not installed (simctl get_app_container: ${failedCall(r) ? exitText(r) : 'no path'})`;
  const app = r.out.trim();
  const installed = lab.fs.read(join(app, 'cells.json'));
  if (installed !== undefined) lab.fs.createExclusive(freshIn(lab.fs, o.labDir, 'ios-installed-cells.json'), installed);
  return cellsWhy(installed, lab.fs.read(join(o.repo, CATALOG_PATH)), `the installed app (${nameInLine(app)})`);
}

// ------------------------------------------------------------------------------------------------ the need

export interface IosLabOptions {
  /** This run's build (lab-build.ts's `kit.ios`): asked by the need itself, installed before the cells check when met. */
  build?: BuildRef;
  /** A build that failed makes the need not met (default: the app already installed is used, as batch-11). */
  requireBuild?: boolean;
  /** The reset at the need's check (batch-11's initial reset); true unless said. */
  reset?: boolean;
  /** The waits; lab-device.ts's pause unless given (tests pass one that does not wait). */
  wait?: (ms: number) => Promise<unknown>;
}

/**
 * What a batch has of the lab simulator: the need, the guarded simulator for a block, the stretch's end, the last step.
 */
export interface IosLab {
  need: NeedSpec;
  /** The lab simulator over a block's (or a need's) calls, guarded; why not. */
  open(c: { bounded: Run; config: BatchConfig; fs: BatchFs }): Promise<{ ok: true; lab: IosSim } | { ok: false; why: string }>;
  /** The iOS stretch's end: the finportal key read again, its line to the SUMMARY's protected-key slot. */
  endStretch(ctx: BlockCtx, lab: IosSim): Promise<void>;
  /** The run's last step: the lab's WebDriverAgent and idb_companion ended, once the guard cleared the simulator. */
  lastly: LastStep;
}

/** The finportal key's read in words, for the step at the stretch's start. */
const readText = (p: ProtectedRead): string => (p.state === 'value' ? nameInLine(p.value) : p.state === 'absent' ? 'absent' : `unreadable (${p.why})`);

/**
 * The lab simulator kit. The need's check (batch-11.sh:383–410): the udid given and guarded; the reset; the finportal
 * key's first read (the iOS stretch's start, read only); this run's build installed if there is one; the installed
 * cells.json main's. Its `alive`: the guard and `idb ui describe-all` (a read, no swipe).
 */
export function iosLab(o: IosLabOptions = {}): IosLab {
  let start: ProtectedRead | undefined;
  let guarded: string | undefined;
  const open: IosLab['open'] = async (c) =>
    c.config.udid === undefined ? { ok: false, why: 'no lab simulator udid given (--udid or AVERI_LAB_UDID)' } : IosSim.open(c.config.udid, c.bounded, { fs: c.fs, wait: o.wait });
  const check = async (c: NeedCtx): Promise<NeedResult> => {
    const opened = await open(c);
    if (!opened.ok) return opened;
    const { lab } = opened;
    guarded = lab.udid;
    if (o.reset !== false) {
      const why = await reset(c, lab);
      if (why !== undefined) return { ok: false, why: `the initial iOS reset failed: ${why}` };
    }
    start = await readProtected(lab.sim);
    c.step('NOTE', `${PROTECTED.domain}'s finportal key at the iOS stretch's start: ${readText(start)} (read only: no batch writes it)`);
    const asked = await askBuild(c, o);
    if ('why' in asked) return { ok: false, why: asked.why };
    const { built } = asked;
    if (built !== undefined) {
      const r = await lab.simctl(['install', lab.udid, built]);
      if (failedCall(r)) return { ok: false, why: `this run's build not installed (simctl install: ${exitText(r)})` };
    }
    const cells = await installedCells(lab, { repo: c.config.repo, labDir: c.labDir });
    if (cells !== undefined) return { ok: false, why: `${cells} (rerun with ONLY=lab,…)` };
    return metWith(`${lab.sim.description}${o.reset === false ? '' : ', reset'}; ${built === undefined ? 'not rebuilt' : "this run's build installed"}; the installed cells.json is main's`, asked.warn);
  };
  const alive = async (c: NeedCtx): Promise<NeedResult> => {
    const opened = await open(c);
    if (!opened.ok) return opened;
    const tree = await opened.lab.idb(['ui', 'describe-all']);
    return failedCall(tree) ? { ok: false, why: `idb ui describe-all: ${exitText(tree)}` } : { ok: true, how: 'idb answers' };
  };
  return {
    need: { check, alive },
    open,
    async endStretch(ctx, lab) {
      const end = await readProtected(lab.sim);
      ctx.protectedLine(protectedLine(start ?? { state: 'unreadable', why: "not read at the iOS stretch's start" }, end));
    },
    lastly: endLabProcesses(() => guarded),
  };
}

// ----------------------------------------------------------------------------------------- the WDA window

/** The WDA window's dirty window's name. */
export const WDA_WINDOW = 'WDA window';

/**
 * The window put back (normal path and abort alike): the lab's WebDriverAgent ended, WDA_EXIT_WAIT_MS, port 8120
 * proven free, then the domains restored key by key (ios-domains.ts#restore); its line with the port part.
 */
async function putBackWda(lab: IosSim, stateFile: string): Promise<{ ok: boolean; line: string; hand: string[] }> {
  await killLabWda(lab);
  await lab.wait(WDA_EXIT_WAIT_MS);
  const { port, killed } = await portFree(lab);
  // A runner still listening would undo a restore at its exit: nothing is put back until it is gone.
  if (port.state !== 'free') return wdaBlockedOf(port, killed, lab.udid, domainsWindow(lab.sim, stateFile).hand, stateFile);
  const r = await restore(lab.sim, stateFile);
  return wdaRestoredOf({ ok: r.ok, line: r.line, hand: r.ok ? [] : r.hand }, killed);
}

/**
 * The WDA window as a dirty window (abort.ts): its restore putBackWda over the abort's detached runner, its state file
 * (put back only when it reads clean after), its hand lines S4's per domain and the WebDriverAgent's kill by hand.
 */
export function wdaWindowSpec(lab: IosSim, stateFile: string, o: { block?: string; secs?: number | undefined } = {}): WindowSpec {
  const domains = domainsWindow(lab.sim, stateFile, o);
  return {
    async restore(run) {
      const r = await putBackWda(lab.using(run), stateFile);
      return r.ok ? { ok: true, how: r.line } : { ok: false, why: r.line, hand: r.hand };
    },
    // Read when asked, as S4's: the state file's domains then.
    get hand() {
      return [portHand(lab.udid), ...domains.hand, compareHand(stateFile)];
    },
    stateFile,
    ...(o.block !== undefined && { block: o.block }),
    ...(o.secs !== undefined && { secs: o.secs }),
  };
}

export interface WdaWindowOptions {
  /**
   * The live runs the window holds: their `.cases` written first, so a run it never reaches is seen (asked, not run).
   */
  runs?: readonly { name: string; asked: Asked }[];
  /** What runs under WebDriverAgent (the block's live runs, each after its health check). */
  work(): Promise<void>;
  /** The state file, the backups beside it: the block's `state.json` unless given (the block is then `stateful`). */
  stateFile?: string;
  /** The restore's bound in the abort (abort.ts's RESTORE_SECS unless given). */
  secs?: number;
}

/**
 * batch-11's WDA window (623–655), in its order: the `.cases` of its runs; the health check; the backup (S4) — failed,
 * the block's INCONCLUSIVE naming why, and nothing changed or run (b11-dry d43-backupfail); the window opened; the
 * work; the window put back (the WebDriverAgent ended, the 4 s wait, port 8120 free, the domains key by key) — its line
 * one of the block's verdict lines, and the window closed only when it verified, else left for RESTORE; the end check;
 * then, with the state clean, the compare (a late writer: its line a verdict line, its hand lines to RESTORE). Whether
 * the work ran.
 */
export async function wdaWindow(ctx: BlockCtx, lab: IosSim, o: WdaWindowOptions): Promise<boolean> {
  for (const r of o.runs ?? []) ctx.asksLive(r.name, r.asked);
  const stateFile = o.stateFile ?? join(ctx.dir, STATE_FILE);
  const notRun = (why: string): false => {
    ctx.err(`the WDA window: ${why}`);
    ctx.verdict('INCONCLUSIVE', `the WDA window did not run: ${why}`);
    return false;
  };
  const sick = await iosCheck(ctx, lab, 'the WDA window');
  if (sick !== undefined) return notRun(`${sick} — no wda run (nothing changed)`);
  const b = await backup(lab.sim, stateFile);
  if (!b.ok) return notRun(`the simulator domains could not be backed up — no wda run (nothing changed): ${b.why}`);
  ctx.note(b.line);
  ctx.open(WDA_WINDOW, wdaWindowSpec(lab, stateFile, { block: ctx.id, secs: o.secs }));
  await o.work();
  const put = await putBackWda(lab, stateFile);
  ctx.verdictLines([put.line]);
  if (put.ok) ctx.close(WDA_WINDOW);
  else ctx.err(`the WDA window: the simulator not provably put back — the window stays open, its hand lines go to RESTORE`);
  await iosCheck(ctx, lab, 'iOS end');
  // Compared only once the restore verified (compare refuses a dirty state itself): a late writer is caught here.
  if (stateOf(lab.fs, stateFile) === 'clean') ctx.verdictAndHand(await compare(lab.sim, stateFile));
  return true;
}
