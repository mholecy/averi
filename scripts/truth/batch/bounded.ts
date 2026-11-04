import { constants } from 'node:os';
import { basename } from 'node:path';
import type { Ended, ProcessSeam } from './proc.js';

/**
 * Every call a batch makes is bounded: a wedged device call cannot hold the batch longer than its bound (batch-7's
 * `perl -e 'alarm …; exec …'`, kept to batch-12). A call past its bound is a failed call like any other, exit 142 —
 * but here its whole process group goes, not the direct child alone: live.ts or a Gradle build left grandchildren
 * that perl's alarm and src/adapters/exec.ts never reached.
 *
 * Two kinds of call, both in a group of their own (proc.ts): `bounded`, a probe, which the abort stops before it puts
 * anything back (a probe no longer gets the terminal's Ctrl-C, so the runner must stop it); and `detached`, a restore
 * or a check, which nothing but its own bound stops (batch-11's `detached`: a second Ctrl-C killed the restore).
 */

/** A call past its bound exits 142, as perl's alarm did (128 + SIGALRM): steps.ts#stepWordOf reads it as FAIL. */
export const TIMED_OUT = 142;
/** A command that could not be started: 127, as `exec … or exit 127`. */
export const NOT_STARTED = 127;
/** How long a group is given after SIGTERM before SIGKILL. */
export const GRACE_MS = 2000;

/**
 * A device tool's own bound, in seconds (batch-11's wrappers, :224–226): xcrun simctl boot and bootstatus 300,
 * simctl install the install bound, any other xcrun 120; idb 60; adb install or uninstall the install bound, any other
 * adb 120. The install bound is 600 s (batch-11), or batch-12's B_INSTALL. Any other command has none: its caller
 * names it (batch-12's B_LIVE, B_E5, …).
 */
export function boundFor(cmd: string, args: readonly string[], installSecs = 600): number | undefined {
  switch (basename(cmd)) {
    case 'xcrun':
      if (args[0] !== 'simctl') return 120;
      if (args[1] === 'boot' || args[1] === 'bootstatus') return 300;
      return args[1] === 'install' ? installSecs : 120;
    case 'idb':
      return 60;
    case 'adb':
      return args.includes('install') || args.includes('uninstall') ? installSecs : 120;
  }
  // Any other command: its caller names the bound.
  return undefined;
}

/** A call's exit code as the shell gives it: 142 past its bound, 127 not started, its code, or 128 + its signal. */
export function codeOf(ended: Ended, timedOut: boolean): number {
  if (timedOut) return TIMED_OUT;
  if (ended.error !== undefined) return NOT_STARTED;
  if (ended.code !== null) return ended.code;
  return ended.signal === null ? 1 : 128 + constants.signals[ended.signal];
}

export interface Call {
  /** The bound in seconds; none: the tool's own (`boundFor`), and a command without one is refused. */
  secs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Its stdout and stderr appended to this file as it runs; then `out` and `err` are empty. */
  log?: string;
}

export interface CallResult {
  /** The shell's exit code (`codeOf`). */
  code: number;
  timedOut: boolean;
  /** The signal that ended it, if one did. */
  signal: NodeJS.Signals | null;
  out: string;
  err: string;
}

/** Run a command, bounded. */
export type Run = (cmd: string, args: readonly string[], call?: Call) => Promise<CallResult>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A run's calls: each bounded in a group of its own; the probes among them stopped together by `stopAll`. */
export class Calls {
  /** The bounded calls still running: their group's id → their end. */
  private readonly running = new Map<number, Promise<Ended>>();
  private stopping = false;
  private readonly graceMs: number;
  private readonly installSecs: number | undefined;

  constructor(
    private readonly seam: ProcessSeam,
    { graceMs = GRACE_MS, installSecs }: { graceMs?: number; installSecs?: number } = {},
  ) {
    this.graceMs = graceMs;
    this.installSecs = installSecs;
  }

  /** A probe: past its bound its group gets SIGTERM, then SIGKILL; `stopAll` stops it; none starts once stopping. */
  readonly bounded: Run = (cmd, args, call = {}) => this.call(cmd, args, call, true);

  /** A restore or a check: the same bound, but `stopAll` leaves it running, and it starts while stopping too. */
  readonly detached: Run = (cmd, args, call = {}) => this.call(cmd, args, call, false);

  /**
   * Stop every bounded call still running, each its whole group (SIGTERM, then SIGKILL after the grace or once it
   * ended), and refuse any new one: the run is being stopped. Detached calls go on. Returns how many were stopped.
   */
  async stopAll(): Promise<number> {
    this.stopping = true;
    const stopped = [...this.running];
    await Promise.all(stopped.map(([pid, done]) => this.endGroup(pid, done)));
    return stopped.length;
  }

  /** SIGTERM to the group; SIGKILL once its leader ended or the grace passed, whichever first: a grandchild may trap TERM. */
  private async endGroup(pid: number, done: Promise<Ended>): Promise<void> {
    this.seam.killGroup(pid, 'SIGTERM');
    await Promise.race([done, sleep(this.graceMs)]);
    this.seam.killGroup(pid, 'SIGKILL');
  }

  private async call(cmd: string, args: readonly string[], { secs, cwd, env, log }: Call, probe: boolean): Promise<CallResult> {
    const bound = secs ?? boundFor(cmd, args, this.installSecs);
    if (bound === undefined || !(bound > 0)) throw new Error(`${cmd}: no bound — give its secs (only xcrun, idb and adb have one of their own)`);
    if (probe && this.stopping) throw new Error(`${cmd} not started: the run is being stopped`);
    const started = this.seam.start(cmd, args, { cwd, env, log });
    const { pid, done } = started;
    const resultOf = (end: Ended, timedOut: boolean): CallResult => ({ code: codeOf(end, timedOut), timedOut, signal: end.signal, out: started.out(), err: end.error ?? started.err() });
    // Not started (no such command): no group to bound or stop.
    if (pid === undefined) return resultOf(await done, false);
    let timedOut = false;
    let ended: Promise<void> = Promise.resolve();
    const timer = setTimeout(() => {
      timedOut = true;
      ended = this.endGroup(pid, done);
    }, bound * 1000);
    if (probe) this.running.set(pid, done);
    try {
      const end = await done;
      clearTimeout(timer);
      // Past its bound, the result waits for the SIGKILL to have been sent: the grandchildren are gone with it.
      await ended;
      return resultOf(end, timedOut);
    } finally {
      this.running.delete(pid);
    }
  }
}
