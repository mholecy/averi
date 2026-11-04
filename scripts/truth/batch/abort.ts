import { Calls, type Run } from './bounded.js';
import type { BatchFs } from './io.js';
import type { ProcessSeam } from './proc.js';
import { stateOf, writeRestore } from './run-dir.js';
import type { StepLog } from './steps.js';
import { EXIT, stepLine, summaryLines, twoDigits, verdictLine, type BlockReport } from './words.js';

/**
 * The dirty windows, and what stops a run inside one: batch-6's `on_abort`, batch-7's TRAPEXIT, batch-11's detached
 * restores, batch-12's abort SUMMARY.
 *
 * A **dirty window** is open from before a run's first change to a device until a verified restore closes it (the
 * remembered "Open" answer, the chooser, the simulator settings, a worktree registered in the repo). Whatever stops the
 * run inside one puts it back first:
 * - SIGINT, SIGTERM or SIGHUP (a Ctrl-C, a kill, a closed terminal);
 * - a throw out of the run's body or an uncaught exception or unhandled rejection anywhere — TRAPEXIT's port, which
 *   batch-7 added for a fatal `set -u` inside a window. Never the `exit` event: it is synchronous, and a restore is not.
 *
 * The abort, once: later signals are only noted; the running probes are stopped, each its whole group (they no longer
 * get the terminal's Ctrl-C); each dirty window is put back, the last opened first, by its own restore through
 * detached calls (a second Ctrl-C cannot kill them) and within its bound; what is not provably put back goes to the
 * RESTORE file as hand lines; then the SUMMARY — INTERRUPTED, each block whose records are complete judged now,
 * device-free, the others INTERRUPTED — and exit 130. Everything durable is written before the terminal gets the
 * SUMMARY: a tty paused with Ctrl-S blocks inside that last write (steps.ts#terminalOf), and so holds only the exit.
 */

/** A restore's outcome: put back and verified (`how`, for the step line), or not (`why`, its hand lines, its word). */
export type Putback = { ok: true; how: string } | { ok: false; why: string; hand?: readonly string[]; verdict?: 'FAIL' | 'ERROR' };

export interface WindowSpec {
  /** Put it back and verify it, with the detached runner only (a second Ctrl-C must not kill it). */
  restore(run: Run): Promise<Putback>;
  /** The hand commands for when it is not put back, one RESTORE line each: at least one. */
  hand: readonly string[];
  /** The restore's bound in seconds (batch-12's B_RESTORE, 300 by default). */
  secs?: number;
  /** The block it belongs to: a block interrupted inside its window is never judged — a leg of it was cut short. */
  block?: string;
  /** The block's cleanup verdict label (`E5 cleanup`): the abort writes `E5 cleanup: OK — … (verified by the abort)`. */
  cleanup?: string;
  /**
   * Its probe's state file (`{dirty, …}`): marked dirty when the window opens over one, and the window is put back
   * only if it reads clean after the restore. None written yet is no change yet: the probe writes it before its first.
   */
  stateFile?: string;
}

/** A wanted block, as the abort SUMMARY sees it. */
export interface AbortBlock {
  block: string;
  /** Its records complete, so it can be judged without a device (batch-12's block_complete). */
  complete(): boolean;
  /** Its verdict lines, judged now — device-free, through the detached runner (batch-12's b12-analyze.ts). */
  judge(run: Run): Promise<readonly string[]>;
  /** The lines it wrote before the interrupt (its verdict.txt). */
  linesSoFar(): readonly string[];
}

export interface AbortGuardOptions {
  name: string;
  runId: string;
  fs: BatchFs;
  log: StepLog;
  seam: ProcessSeam;
  /** run-dir.ts#layoutOf's restoreFile. */
  restoreFile: string;
  /** The SUMMARY's fixed lines, read when it is written. */
  head(): { checkout: string; labs: readonly string[]; protectedLines: readonly string[] };
  /** The wanted blocks, in the batch's order. */
  blocks: readonly AbortBlock[];
  clock?: () => Date;
  /** bounded.ts#Calls' grace between SIGTERM and SIGKILL. */
  graceMs?: number;
  /** bounded.ts#boundFor's install bound (batch-12's B_INSTALL). */
  installSecs?: number;
  /** A judge's bound in seconds (300 by default, as batch-12's analyzer). */
  judgeSecs?: number;
}

/** A restore's bound when its window names none (batch-12's B_RESTORE). */
export const RESTORE_SECS = 300;
/** A judge's bound when none is given (batch-12's `detached 300` analyzer). */
export const JUDGE_SECS = 300;

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** What `p` settled to, or `late` once `secs` have passed with it unsettled. */
async function within<T>(secs: number, p: Promise<T>): Promise<{ late: false; value: T } | { late: true }> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<{ late: true }>((resolve) => (timer = setTimeout(() => resolve({ late: true }), secs * 1000)));
  try {
    return await Promise.race([p.then((value) => ({ late: false as const, value })), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mark a probe's state file dirty: `dirty: true`, every other field kept, the file replaced whole. `missing` when there
 * is none (the probe has recorded no before-state yet); `unreadable` when it is no JSON object, left as it is — it is
 * evidence, and stateOf reads it as not clean already.
 */
export function markDirty(fs: BatchFs, file: string): 'marked' | 'missing' | 'unreadable' {
  if (!fs.exists(file)) return 'missing';
  let state: unknown;
  try {
    state = JSON.parse(fs.read(file) ?? '');
  } catch {
    // no JSON: no object, so unreadable
  }
  if (typeof state !== 'object' || state === null || Array.isArray(state)) return 'unreadable';
  fs.replace(file, JSON.stringify({ ...state, dirty: true }));
  return 'marked';
}

const dateOf = (d: Date) => `${d.getFullYear()}-${twoDigits(d.getMonth() + 1)}-${twoDigits(d.getDate())}`;
const timeOf = (d: Date) => `${twoDigits(d.getHours())}:${twoDigits(d.getMinutes())}:${twoDigits(d.getSeconds())}`;

/** A run's guard: its bounded calls, its dirty windows, and the abort that puts them back. */
export class AbortGuard {
  private readonly calls: Calls;
  private readonly windows = new Map<string, WindowSpec>();
  private readonly restoreLines: string[] = [];
  private aborting: Promise<void> | undefined;
  private installed = false;

  constructor(private readonly options: AbortGuardOptions) {
    this.calls = new Calls(options.seam, { graceMs: options.graceMs, installSecs: options.installSecs });
  }

  /** A probe, bounded in a group of its own; the abort stops it. */
  get bounded(): Run {
    return this.calls.bounded;
  }

  /** Open a dirty window, before the first change it covers. Its state file, when one is there, is marked dirty. */
  open(name: string, spec: WindowSpec): void {
    if (this.aborting !== undefined) throw new Error(`${name}: no window opens while the run is being stopped`);
    if (this.windows.has(name)) throw new Error(`${name} is open already`);
    if (spec.hand.length === 0) throw new Error(`${name}: a window needs its hand lines, for a RESTORE when it is not put back`);
    if (spec.cleanup !== undefined && spec.block === undefined) throw new Error(`${name}: a cleanup line needs the block it belongs to`);
    if (spec.stateFile !== undefined) markDirty(this.options.fs, spec.stateFile);
    this.windows.set(name, spec);
  }

  /** Close a window: its restore was verified. */
  close(name: string): void {
    if (!this.windows.delete(name)) throw new Error(`${name} is not open`);
  }

  /**
   * Run the batch's body with the abort installed. A throw out of it aborts the run (TRAPEXIT's port). It returns
   * only when the body finished and no abort began; else it rejects once the abort is done (the real seam has exited).
   */
  async run<T>(body: () => Promise<T>): Promise<T> {
    this.install();
    let result: T;
    try {
      result = await body();
    } catch (e) {
      await this.abort(`by an error: ${messageOf(e)}`);
    }
    if (this.aborting !== undefined) {
      await this.aborting;
      throw new Error(`${this.options.name} run ${this.options.runId} was interrupted`);
    }
    return result!;
  }

  /**
   * The normal end: every window still open goes to the RESTORE file with its hand lines (the block's own restore
   * did not prove it put back), and is closed. Returns every RESTORE line this run wrote, for the SUMMARY.
   */
  finish(): string[] {
    const hand = [...this.windows.values()].flatMap((w) => w.hand);
    this.windows.clear();
    const written = this.writeRestore('ended', hand);
    if (written.length > 0) this.options.log.error(`state not provably put back — the hand commands are in ${this.options.restoreFile}`);
    return [...this.restoreLines];
  }

  private install(): void {
    if (this.installed) return;
    this.installed = true;
    this.options.seam.install({
      signal: (name) => {
        if (this.aborting !== undefined) this.options.log.step('NOTE', `${name} ignored: the abort is putting state back`);
        else void this.abort(`by ${name}`);
      },
      fatal: (e) => {
        if (this.aborting !== undefined) this.options.log.error(`an uncaught error while aborting: ${messageOf(e)}`);
        else void this.abort(`by an uncaught error: ${messageOf(e)}`);
      },
    });
  }

  private writeRestore(how: 'ended' | 'interrupted', hand: readonly string[]): string[] {
    const { name, runId, restoreFile, fs } = this.options;
    const now = this.now();
    const header = `${name} run ${runId} ${how} at ${dateOf(now)} ${timeOf(now)}`;
    const written = writeRestore(fs, restoreFile, { header, hand });
    this.restoreLines.push(...written);
    return written;
  }

  private now(): Date {
    return (this.options.clock ?? (() => new Date()))();
  }

  private abort(why: string): Promise<void> {
    this.aborting ??= this.abortOnce(why);
    return this.aborting;
  }

  private async abortOnce(why: string): Promise<void> {
    const { log, seam } = this.options;
    try {
      const at = this.now();
      log.error(`${this.options.name} interrupted (run ${this.options.runId}) ${why}`);
      const cut = new Set([...this.windows.values()].map((w) => w.block));
      const stopped = await this.calls.stopAll();
      if (stopped > 0) log.step('NOTE', `${stopped} running call(s) stopped, each its whole process group`);
      const { hand, cleanups } = await this.putBackAll();
      if (this.writeRestore('interrupted', hand).length > 0) log.error(`state not provably put back — ${this.options.restoreFile}`);
      const blocks = await this.reports(cut, cleanups);
      log.summary(summaryLines({ ...this.headOf(), name: this.options.name, runId: this.options.runId, blocks, restore: { file: this.options.restoreFile, written: this.restoreLines }, errors: log.errors(), interrupted: { at: timeOf(at) } }));
    } catch (e) {
      // The abort's own failure (a file it could not write): said on stderr, and the exit is 130 still.
      process.stderr.write(`${this.options.name}: the abort failed: ${messageOf(e)}\n`);
    } finally {
      seam.exit(EXIT.interrupted);
    }
  }

  /** Every dirty window, the last opened first: put back, or its hand lines kept. And its cleanup line. */
  private async putBackAll(): Promise<{ hand: string[]; cleanups: Map<string | undefined, string[]> }> {
    const hand: string[] = [];
    const cleanups = new Map<string | undefined, string[]>();
    for (const [name, spec] of [...this.windows].reverse()) {
      const p = await this.putBack(spec);
      if (p.ok) {
        this.options.log.step('OK', `${name} put back (verified by the abort): ${p.how}`);
      } else {
        hand.push(...(p.hand !== undefined && p.hand.length > 0 ? p.hand : spec.hand));
        this.options.log.error(`${name} not provably put back: ${p.why}`);
      }
      // A cleanup label has its block: open() refuses one without.
      if (spec.cleanup !== undefined) {
        const line = p.ok ? verdictLine(spec.cleanup, 'OK', `${p.how} (verified by the abort)`) : verdictLine(spec.cleanup, p.verdict ?? 'ERROR', `${p.why} (the abort)`);
        cleanups.set(spec.block, [...(cleanups.get(spec.block) ?? []), line]);
      }
    }
    return { hand, cleanups };
  }

  private async putBack(spec: WindowSpec): Promise<Putback> {
    const secs = spec.secs ?? RESTORE_SECS;
    let p: Putback;
    try {
      const r = await within(secs, spec.restore(this.calls.detached));
      p = r.late ? { ok: false, why: `its restore passed its bound (${secs} s)` } : r.value;
    } catch (e) {
      p = { ok: false, why: `its restore threw: ${messageOf(e)}` };
    }
    const file = spec.stateFile;
    if (p.ok && file !== undefined && this.options.fs.exists(file)) {
      const state = stateOf(this.options.fs, file);
      if (state !== 'clean') return { ok: false, why: `its restore said done, but ${file} is ${state}` };
    }
    return p;
  }

  /** Each wanted block: judged when complete and not cut inside a window, else INTERRUPTED; then its cleanup lines. */
  private async reports(cut: ReadonlySet<string | undefined>, cleanups: ReadonlyMap<string | undefined, readonly string[]>): Promise<BlockReport[]> {
    const reports: BlockReport[] = [];
    for (const b of this.options.blocks) {
      const lines = cut.has(b.block) || !this.completeOf(b) ? undefined : await this.judged(b);
      reports.push(lines === undefined ? { block: b.block, lines: b.linesSoFar(), interrupted: true } : { block: b.block, lines });
      const cleanup = cleanups.get(b.block);
      if (cleanup !== undefined) reports.push({ block: b.block, lines: cleanup });
    }
    return reports;
  }

  private completeOf(b: AbortBlock): boolean {
    try {
      return b.complete();
    } catch {
      return false;
    }
  }

  private async judged(b: AbortBlock): Promise<readonly string[] | undefined> {
    const secs = this.options.judgeSecs ?? JUDGE_SECS;
    try {
      const r = await within(secs, b.judge(this.calls.detached));
      if (!r.late) return r.value;
      this.options.log.error(`${b.block} not judged by the abort: its judge passed its bound (${secs} s)`);
      return undefined;
    } catch (e) {
      this.options.log.error(`${b.block} not judged by the abort: ${messageOf(e)}`);
      return undefined;
    }
  }

  private headOf(): { checkout: string; labs: readonly string[]; protectedLines: readonly string[] } {
    try {
      return this.options.head();
    } catch (e) {
      return { checkout: stepLine('ERROR', `the checkout line is not known (${messageOf(e)})`), labs: [], protectedLines: [] };
    }
  }
}
