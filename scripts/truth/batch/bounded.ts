import { constants } from 'node:os';
import { basename } from 'node:path';
import type { Ended, KillResult, ProcessSeam } from './proc.js';

/**
 * Every call a batch makes is bounded: a wedged device call cannot hold the batch longer than its bound (batch-7's
 * `perl -e 'alarm …; exec …'`, kept to batch-12). A call past its bound is a failed call like any other, exit 142 —
 * but here its whole process group goes, not the direct child alone: live.ts or a Gradle build left grandchildren
 * that perl's alarm and src/adapters/exec.ts never reached.
 *
 * Two kinds of call, both in a group of their own (proc.ts): `bounded`, a probe, which the abort stops before it puts
 * anything back (a probe no longer gets the terminal's Ctrl-C, so the runner must stop it); and `detached`, a restore
 * or a check, which nothing but its own bound stops (batch-11's `detached`: a second Ctrl-C killed the restore) — or
 * its `scope`'s stop, when the restore that started it passed its own bound.
 *
 * Once a call's leader has ended, its group gets SIGKILL: nothing it started outlives it, unless the call keeps its
 * group (`keepGroup`, by default per tool: `KEEPS_GROUP`), and then stopAll ends that group at the abort. Its result
 * comes once its pipes have closed, or `CLOSE_GRACE_MS` after its leader's end if a grandchild in another group holds
 * them; what a grandchild writes after that is dropped on purpose — the result is the leader's, and a daemon's output
 * is no part of it. Its code is its leader's: a leader that ended before the bound is never 142, however long its
 * pipes took.
 *
 * A group kill never rejects a call or a stop. A kill the system refuses with EPERM (seen under load: delivery not
 * proven) is tried once more `EPERM_RETRY_MS` later; one still not delivered is kept in `unproven()`, and stopAll and
 * a scope's stop name theirs, for the abort to say. A group already gone (ESRCH) is ended.
 *
 * A kept group is kept only if it still exists once its leader has ended (`kill(-id, 0)`: an idb call that started no
 * companion leaves none), and asked again just before stopAll signals it: one gone by then is dropped, never
 * signalled; every new call asks about the kept groups first too, and drops those gone. While any process of a group
 * lives, its id cannot be reused. Residual: between the last call or check and the signal the group could end and its
 * id be taken; telling groups apart needs a process's start time (ps, which the sandbox blocks). A refused check
 * (EPERM) keeps the group, on purpose the safe side: the abort signals it, and a kill refused too gets its RESTORE hand
 * line, so the next run refuses to start.
 */

/** A call past its bound exits 142, as perl's alarm did (128 + SIGALRM): steps.ts#stepWordOf reads it as FAIL. */
export const TIMED_OUT = 142;
/** A command that could not be started: 127, as `exec … or exit 127`. */
export const NOT_STARTED = 127;
/** How long a group is given after SIGTERM before SIGKILL. */
export const GRACE_MS = 2000;
/** How long a call's pipes are read after its leader has ended, when something outside its group holds them. */
export const CLOSE_GRACE_MS = 1000;
/** The longest bound taken, a day: setTimeout's delay overflows past 2^31 - 1 ms (24.8 days) and fires at once. */
export const MAX_SECS = 86_400;
/** How long to wait before a group kill refused with EPERM is tried once more. */
export const EPERM_RETRY_MS = 50;

/**
 * Whether a tool's calls keep their group past their leader, and why: a tool whose leader may leave a daemon in its
 * group, which the SIGKILL at the leader's end would kill. A call's own `keepGroup` overrides it.
 */
export const KEEPS_GROUP: Readonly<Record<string, { keep: boolean; why: string }>> = {
  idb: {
    keep: true,
    why: 'a local idb client may start idb_companion without a session of its own, in the call\'s group; until a lab check shows it leaves the group, the companion is kept (residual: that check)',
  },
  emulator: { keep: true, why: 'the emulator binary is the Android device itself: a call starts it to keep it running' },
  adb: { keep: false, why: 'the adb server it starts calls setsid(), so it leaves the call\'s group and outlives the SIGKILL' },
  xcrun: { keep: false, why: 'simctl hands the simulator to launchd: nothing of the device is in the call\'s group' },
};

/** Whether `cmd`'s calls keep their group by default (`KEEPS_GROUP`, by the command's base name; others do not). */
export const keepsGroup = (cmd: string): boolean => KEEPS_GROUP[basename(cmd)]?.keep === true;

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
  /**
   * Its group outlives its leader (a daemon it starts on purpose): no SIGKILL at its end. stopAll ends it with SIGTERM
   * and SIGKILL straight after — its leader is gone, so nothing tells when the daemon has finished.
   */
  keepGroup?: boolean;
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

/** `p`'s settling or `ms` passing, whichever first; the timer cleared, so none is left to hold the run open. */
async function untilOr(p: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([p, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** A thrown error's code (or text), whatever was thrown: reading it must not throw in turn. */
function whyOf(e: unknown): string {
  try {
    return (e as NodeJS.ErrnoException).code ?? String(e);
  } catch {
    return 'an error that cannot be read';
  }
}

/**
 * A signal not proven delivered: its group may still be running. `owner` says what to check after killing it by hand
 * (`E5's state`), when a scope's call sent it.
 */
export interface Undelivered {
  pid: number;
  signal: NodeJS.Signals;
  why: string;
  owner?: string;
}

/** `<signal> to group <id>: <why>`. */
export const undeliveredText = (u: Undelivered): string => `${u.signal} to group ${u.pid}: ${u.why}`;

/** What a stop did: how many groups it ended, and each signal not proven delivered. */
export interface Stopped {
  stopped: number;
  notSent: Undelivered[];
}

/** A restore's own calls: `run` is detached, and `stop` ends the groups of those still running and refuses new ones. */
export interface Scope {
  run: Run;
  stop(): Promise<Stopped>;
}

/** Calls tracked together: their groups by id (→ their leader's end), and whether new ones are refused, and why. */
class Tracked {
  readonly groups = new Map<number, Promise<Ended>>();
  refused: string | undefined;
  constructor(readonly owner?: string) {}
}

/** A run's calls: each bounded in a group of its own; the probes among them stopped together by `stopAll`. */
export class Calls {
  /** The bounded calls still running, and the groups kept past their leader. */
  private readonly running = new Tracked();
  private readonly notDelivered: Undelivered[] = [];
  /** The groups kept past their leader (also in `running`): asked again at every new call and at stopAll. */
  private readonly kept = new Set<number>();
  private readonly graceMs: number;
  private readonly closeGraceMs: number;
  private readonly installSecs: number | undefined;
  private readonly onUndelivered: (u: Undelivered) => void;

  constructor(
    private readonly seam: ProcessSeam,
    {
      graceMs = GRACE_MS,
      closeGraceMs = CLOSE_GRACE_MS,
      installSecs,
      onUndelivered = () => {},
    }: { graceMs?: number; closeGraceMs?: number; installSecs?: number; onUndelivered?: (u: Undelivered) => void } = {},
  ) {
    this.graceMs = graceMs;
    this.closeGraceMs = closeGraceMs;
    this.installSecs = installSecs;
    this.onUndelivered = onUndelivered;
  }

  /** A probe: past its bound its group gets SIGTERM, then SIGKILL; `stopAll` stops it; none starts once stopping. */
  readonly bounded: Run = (cmd, args, call = {}) => this.call(cmd, args, call, this.running);

  /** A restore or a check: the same bound, but `stopAll` leaves it running, and it starts while stopping too. */
  readonly detached: Run = (cmd, args, call = {}) => this.call(cmd, args, call, undefined);

  /**
   * Detached calls tracked together, so that a restore past its bound can be stopped with what it started. `owner`:
   * what to check when one of its kills is not delivered (`E5's state`).
   */
  scope(owner?: string): Scope {
    const mine = new Tracked(owner);
    return {
      run: (cmd, args, call = {}) => this.call(cmd, args, call, mine),
      stop: () => this.endAll(mine, 'its restore or judge was stopped at its bound'),
    };
  }

  /**
   * Stop every bounded call still running and every group kept, each whole (SIGTERM, then SIGKILL after the grace or
   * once its leader ended), and refuse any new probe: the run is being stopped. Detached calls go on. Never rejects.
   */
  stopAll(): Promise<Stopped> {
    return this.endAll(this.running, 'the run is being stopped');
  }

  /** Every signal not proven delivered so far — stopAll's, the scopes' and those after a leader's end — in order. */
  unproven(): Undelivered[] {
    return [...this.notDelivered];
  }

  /**
   * Refuse new calls, then end every group: first each is asked whether it still exists (`kill(-id, 0)`); one gone
   * (ESRCH) is dropped and never signalled — its id may since belong to another group.
   */
  private async endAll(tracked: Tracked, why: string): Promise<Stopped> {
    tracked.refused = why;
    const ending = [...tracked.groups].filter(([pid]) => {
      if (this.tryKill(pid, 0) !== 'gone') return true;
      tracked.groups.delete(pid);
      return false;
    });
    const notSent = (await Promise.all(ending.map(([pid, exited]) => this.endGroup(pid, exited, tracked.owner)))).flat();
    return { stopped: ending.length, notSent };
  }

  /**
   * SIGTERM to the group; SIGKILL once its leader ended or the grace passed, whichever first: a grandchild may trap
   * TERM. A group gone at the TERM is ended. Returns the signals not proven delivered.
   */
  private async endGroup(pid: number, exited: Promise<Ended>, owner: string | undefined): Promise<Undelivered[]> {
    const term = await this.signal(pid, 'SIGTERM', owner);
    if (term === 'gone') return [];
    await untilOr(exited, this.graceMs);
    const kill = await this.signal(pid, 'SIGKILL', owner);
    return [term, kill].filter((r): r is Undelivered => typeof r === 'object');
  }

  /**
   * A group kill that never throws: EPERM tried once more after EPERM_RETRY_MS; one not delivered kept as unproven and
   * reported (onUndelivered) at once.
   */
  private async signal(pid: number, signal: NodeJS.Signals, owner: string | undefined): Promise<'sent' | 'gone' | Undelivered> {
    let r = this.tryKill(pid, signal);
    if (typeof r === 'object' && r.notSent === 'EPERM') {
      await untilOr(new Promise(() => {}), EPERM_RETRY_MS);
      r = this.tryKill(pid, signal);
    }
    if (typeof r !== 'object') return r;
    const u: Undelivered = { pid, signal, why: r.notSent, ...(owner === undefined ? {} : { owner }) };
    this.notDelivered.push(u);
    this.onUndelivered(u);
    return u;
  }

  /** Drop every kept group that is gone (ESRCH): its id may be another group's by the abort. */
  private dropGoneKept(): void {
    for (const pid of this.kept) {
      if (this.tryKill(pid, 0) !== 'gone') continue;
      this.kept.delete(pid);
      this.running.groups.delete(pid);
    }
  }

  /** The seam's kill, never thrown; signal 0 only asks whether the group still exists. */
  private tryKill(pid: number, signal: NodeJS.Signals | 0): KillResult {
    try {
      return this.seam.killGroup(pid, signal);
    } catch (e) {
      return { notSent: whyOf(e) };
    }
  }

  private async call(cmd: string, args: readonly string[], { secs, cwd, env, log, keepGroup = keepsGroup(cmd) }: Call, tracked: Tracked | undefined): Promise<CallResult> {
    const bound = secs ?? boundFor(cmd, args, this.installSecs);
    if (bound === undefined || !(bound > 0)) throw new Error(`${cmd}: no bound — give its secs (only xcrun, idb and adb have one of their own)`);
    if (bound > MAX_SECS) throw new Error(`${cmd}: a bound of ${bound} s is above ${MAX_SECS} s, the longest taken`);
    if (tracked?.refused !== undefined) throw new Error(`${cmd} not started: ${tracked.refused}`);
    this.dropGoneKept();
    const started = this.seam.start(cmd, args, { cwd, env, log });
    const { pid, exited } = started;
    const resultOf = (end: Ended, timedOut: boolean): CallResult => ({ code: codeOf(end, timedOut), timedOut, signal: end.signal, out: started.out(), err: end.error ?? started.err() });
    // Not started (no such command): no group to bound or stop.
    if (pid === undefined) return resultOf(await exited, false);
    let timedOut = false;
    let ending: Promise<unknown> = Promise.resolve();
    const timer = setTimeout(() => {
      timedOut = true;
      ending = this.endGroup(pid, exited, tracked?.owner);
    }, bound * 1000);
    tracked?.groups.set(pid, exited);
    let end: Ended;
    try {
      // The leader's end, not its pipes': past this the bound no longer runs (no 142 for a call that ended in time).
      end = await exited;
      clearTimeout(timer);
      // Past its bound, the result waits for the SIGKILL to have been sent: the grandchildren are gone with it.
      await ending;
    } finally {
      tracked?.groups.delete(pid);
    }
    // A kept group is kept only while something of it lives: an empty one's id could be reused before the abort.
    if (!keepGroup) await this.signal(pid, 'SIGKILL', tracked?.owner);
    else if (this.tryKill(pid, 0) !== 'gone') {
      this.running.groups.set(pid, exited);
      this.kept.add(pid);
    }
    await untilOr(started.closed, this.closeGraceMs);
    started.release();
    return resultOf(end, timedOut);
  }
}
