import { Calls, MAX_SECS, undeliveredText, type Run, type Undelivered } from './bounded.js';
import type { BatchFs } from './io.js';
import type { ProcessSeam } from './proc.js';
import { stateOf, writeRestore } from './run-dir.js';
import type { StepLog } from './steps.js';
import { EXIT, firstLineOf, messageOf, stepLine, summaryLines, timeOf, twoDigits, verdictLine, type BlockReport } from './words.js';

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
 *
 * What the abort relies on, and what it does not:
 * - The windows it puts back are those open when it began, taken before its first await. The run's body goes on
 *   meanwhile — a probe the abort stopped returns to it — so its close() and finish() are only noted from then on: a
 *   body that closes its window after its probe was killed must not leave the device dirty with `RESTORE: none`.
 * - The log is not relied on: a line it cannot write (ENOSPC, the out folder gone) is dropped, and each window is
 *   put back on its own. When the RESTORE file itself cannot be written, its lines go to stderr once.
 * - A block's own restore, on the normal path, runs as a probe (`bounded`), so the abort may stop it part-way and then
 *   run the window's restore again: every restore must be safe to run twice (batch-12's were).
 * - A restore that passes its bound is stopped there with the detached calls it started, and its RESTORE lines say
 *   so: the state it left is part-way. Its scope then refuses any further call, so the restore cannot go on to its
 *   next step; a judge past the budget likewise.
 * - A group kill the system refuses (EPERM under load) is said, never thrown: the windows are put back whatever
 *   stopping the probes did.
 * - The running probes are stopped first; the kept groups (a daemon such as idb_companion) only last, after the
 *   restores and the judging, which may need them — as batch-11 pkilled the companion at the end of on_abort. The
 *   normal end (finish) ends them too: a companion lives across blocks, not past the run; a block may end its own
 *   earlier with stopKept(owner), as batch-12 did after each iOS block.
 *
 * How long it can take, at worst: the probes' stop (`graceMs`, 2 s), then each dirty window's restore bound (`secs`,
 * 300 s by default) and its stop (2 s), then the judges' one budget (`judgeBudgetSecs`, 120 s) and its stop (2 s),
 * then the kept groups' stop (2 s) — one window at the defaults, about 7 minutes. No block is judged once a restore has
 * passed its bound.
 *
 * Should this file grow further, the judging (reports, judged, the budget) and the RESTORE writing (writeRestore,
 * undeliveredHand) are the parts to move into files of their own, each behind the guard.
 */

/**
 * A restore's outcome: put back and verified (`how`, for the step line; WARN when what is left is no change to put
 * back, but worth saying: the chooser's last-chosen entry), or not (`why`, its hand lines, its word).
 */
export type Putback = { ok: true; how: string; verdict?: 'WARN' } | { ok: false; why: string; hand?: readonly string[]; verdict?: 'FAIL' | 'ERROR' };

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
  /**
   * Its records complete, so it can be judged without a device (batch-12's block_complete): true; else false, or why
   * not (a string, said in its INTERRUPTED line). Its reading may be async; it is read within the judges' budget.
   */
  complete(): boolean | string | Promise<boolean | string>;
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
  /** The SUMMARY's fixed lines and, when given, its ERROR section (AbortHead), read when it is written. */
  head(): AbortHead;
  /** The wanted blocks, in the batch's order. */
  blocks: readonly AbortBlock[];
  clock?: () => Date;
  /** bounded.ts#Calls' grace between SIGTERM and SIGKILL. */
  graceMs?: number;
  /** bounded.ts#boundFor's install bound (batch-12's B_INSTALL). */
  installSecs?: number;
  /** The judges' one budget in seconds, for all blocks together (120 by default). */
  judgeBudgetSecs?: number;
  /**
   * The run's last steps, on both ends, after the kept groups are ended (T2 S6b: what S2's kept groups cannot own — the
   * lab's WebDriverAgent, a companion that left its group — ended by an exact pattern), through detached calls, bounded
   * by `lastlySecs`. A throw or a pass of the bound is an ERROR line; the end goes on.
   */
  lastly?: (run: Run) => Promise<void>;
  /** Their bound in seconds (LASTLY_SECS by default). */
  lastlySecs?: number;
}

/** What the abort SUMMARY says besides the blocks: the checkout line, the lab lines, the protected keys', ERRORs. */
export interface AbortHead {
  checkout: string;
  labs: readonly string[];
  protectedLines: readonly string[];
  /** Its whole ERROR section (runner.ts: the steps' and the logs', counted together); none: the steps' ERROR lines. */
  errors?: readonly string[];
}

/** A restore's bound when its window names none (batch-12's B_RESTORE). */
export const RESTORE_SECS = 300;
/**
 * The judges' budget when none is given: all complete blocks together. batch-12 gave its analyzer 300 s per block;
 * one budget for all keeps the abort's worst case short, and a block not judged in it is INTERRUPTED and rerun.
 */
export const JUDGE_BUDGET_SECS = 120;
/** The run's last steps' bound when none is given: a few bounded kills, each with its own bound. */
export const LASTLY_SECS = 60;


/** What `p` settled to, or `late` once `secs` have passed with it unsettled (the runner's need ends too). */
export async function within<T>(secs: number, p: Promise<T>): Promise<{ late: false; value: T } | { late: true }> {
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

/** One window's put-back: its outcome, and whether its restore was stopped at its bound. */
interface PutBack {
  p: Putback;
  /** Its restore passed its bound. */
  late?: true;
  /** …and a kill of what it started was not delivered: it may still be running, not stopped part-way. */
  running?: true;
}

/** Whose state to check after killing a group by hand: the windows open then, or the device's. */
function whoseState(names: readonly string[]): string {
  if (names.length === 0) return "the device's state";
  return names.length === 1 ? `${names[0]}'s state` : `the state of ${names.join(', ')}`;
}

/** A run's guard: its bounded calls, its dirty windows, and the abort that puts them back. */
export class AbortGuard {
  private readonly calls: Calls;
  private readonly windows = new Map<string, WindowSpec>();
  private readonly restoreLines: string[] = [];
  /** How many of the calls' undelivered kills a RESTORE has already given its hand line. */
  private undeliveredWritten = 0;
  private aborting: Promise<void> | undefined;
  private installed = false;

  constructor(private readonly options: AbortGuardOptions) {
    this.calls = new Calls(options.seam, {
      graceMs: options.graceMs,
      installSecs: options.installSecs,
      onUndelivered: (u) => this.say('ERROR', `a kill not delivered: ${undeliveredText(u)} — group ${u.pid} may still be running`),
    });
  }

  /** Whether the abort has begun: the runner then starts no block and prints no SUMMARY of its own. */
  get interrupted(): boolean {
    return this.aborting !== undefined;
  }

  /** A probe, bounded in a group of its own; the abort stops it. */
  get bounded(): Run {
    return this.calls.bounded;
  }

  /**
   * Open a dirty window, before the first change it covers — inside run(), where the abort is installed. Its state
   * file, when one is there, is marked dirty.
   */
  open(name: string, spec: WindowSpec): void {
    if (!this.installed) throw new Error(`${name}: the abort is not installed yet — open windows inside run()`);
    if (this.aborting !== undefined) throw new Error(`${name}: no window opens while the run is being stopped`);
    if (this.windows.has(name)) throw new Error(`${name} is open already`);
    if (spec.hand.length === 0) throw new Error(`${name}: a window needs its hand lines, for a RESTORE when it is not put back`);
    if (spec.secs !== undefined && !(spec.secs > 0 && spec.secs <= MAX_SECS)) throw new Error(`${name}: a restore bound of ${spec.secs} s: more than 0 and at most ${MAX_SECS} s is needed`);
    const wanted = this.options.blocks.map((b) => b.block);
    if (spec.cleanup !== undefined && !wanted.some((b) => b === spec.block)) {
      throw new Error(`${name}: a cleanup line needs a wanted block (${spec.block ?? 'none given'}; wanted: ${wanted.join(', ')})`);
    }
    if (spec.stateFile !== undefined) markDirty(this.options.fs, spec.stateFile);
    this.windows.set(name, spec);
  }

  /** Close a window: its restore was verified. While the abort runs, only noted: the abort puts it back. */
  close(name: string): void {
    if (this.aborting !== undefined) return this.say('NOTE', `close(${name}) ignored: the abort is putting the windows back`);
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
   * did not prove it put back), and is closed; then the kept groups are ended — a companion lives across blocks, not
   * past the run — and a kill of them not delivered is appended. Returns every RESTORE line this run wrote, for the
   * SUMMARY (and its exit code: 1 with any). While the abort runs, only noted: the abort writes the RESTORE.
   */
  async finish(): Promise<string[]> {
    if (this.aborting !== undefined) {
      this.say('NOTE', 'finish() ignored: the abort is putting the windows back');
      return [...this.restoreLines];
    }
    const names = [...this.windows.keys()];
    const hand = [...this.undeliveredHand(names), ...[...this.windows.values()].flatMap((w) => w.hand)];
    this.windows.clear();
    const written = this.writeRestore('ended', hand);
    await this.calls.stopKept();
    await this.lastSteps();
    const late = this.writeRestore('ended', this.undeliveredHand(names));
    if (written.length + late.length > 0) this.options.log.error(`state not provably put back — the hand commands are in ${this.options.restoreFile}`);
    return [...this.restoreLines];
  }

  /**
   * State a block leaves not provably put back outside any window (S4's compare: a late writer after the restore): its
   * hand lines appended to RESTORE now, under `<name> run <id> left by <block> at <date>`, and said as an ERROR. The
   * SUMMARY's RESTORE section and the exit code count them (finish's return, the abort's SUMMARY). While the abort runs
   * too: a hand line is never dropped. A RESTORE that cannot be written sends them to stderr once, as the abort does.
   * Returns the lines written; none for no hand line.
   */
  leave(block: string, hand: readonly string[]): string[] {
    const written = this.writeRestore(`left by ${block}`, hand);
    if (written.length > 0) this.say('ERROR', `${block}: state not provably put back — the hand commands are in ${this.options.restoreFile}`);
    return written;
  }

  /**
   * End the kept groups (idb_companion) of `owner`'s calls (Call.owner), or all when none is given: a block done with
   * its companion ends it, as batch-12 did after each iOS block. A kill not delivered is said at once and gets its
   * RESTORE line at the next write (finish or the abort).
   */
  async stopKept(owner?: string): Promise<void> {
    await this.calls.stopKept(owner);
  }

  private install(): void {
    if (this.installed) return;
    this.installed = true;
    this.options.seam.install({
      signal: (name) => {
        if (this.aborting !== undefined) this.say('NOTE', `${name} ignored: the abort is putting state back`);
        else void this.abort(`by ${name}`);
      },
      fatal: (e) => {
        if (this.aborting !== undefined) this.say('ERROR', `an uncaught error while aborting: ${messageOf(e)}`);
        else void this.abort(`by an uncaught error: ${messageOf(e)}`);
      },
    });
  }

  /** A step line the abort cannot be stopped by: one the log fails to write is dropped. */
  private say(word: 'OK' | 'WARN' | 'NOTE' | 'ERROR', text: string): void {
    try {
      this.options.log.step(word, text);
    } catch {
      // The log cannot be written (ENOSPC, the out folder gone): the restores matter more than the line.
    }
  }

  /**
   * A hand line for each group whose kill was not delivered since the last RESTORE write, one per group: it may still
   * be running. `names`: the windows to check after killing it, when no scope's owner says what.
   */
  private undeliveredHand(names: readonly string[]): string[] {
    const fresh = this.calls.unproven().slice(this.undeliveredWritten);
    this.undeliveredWritten += fresh.length;
    const byGroup = new Map<number, Undelivered>();
    for (const u of fresh) byGroup.set(u.pid, u);
    return [...byGroup.values()].map((u) => `group ${u.pid} may still be running: kill -9 -${u.pid}, then check ${u.owner ?? whoseState(names)}`);
  }

  /**
   * `how`: ended (finish, which throws when it cannot write), interrupted (the abort), or `left by <block>` (leave).
   */
  private writeRestore(how: 'ended' | 'interrupted' | `left by ${string}`, hand: readonly string[]): string[] {
    const { name, runId, restoreFile, fs } = this.options;
    const now = this.now();
    const header = `${name} run ${runId} ${how} at ${dateOf(now)} ${timeOf(now)}`;
    try {
      const written = writeRestore(fs, restoreFile, { header, hand });
      this.restoreLines.push(...written);
      return written;
    } catch (e) {
      if (how === 'ended') throw e;
      // The last place left: the hand lines once on stderr, so a person can still put the state back.
      const lines = [`${header}; state to put back by hand:`, ...hand];
      this.options.seam.stderr(`${name}: ${restoreFile} could not be written (${messageOf(e)}):\n${lines.join('\n')}\n`);
      this.restoreLines.push(...lines);
      return lines;
    }
  }

  private now(): Date {
    return (this.options.clock ?? (() => new Date()))();
  }

  private abort(why: string): Promise<void> {
    this.aborting ??= this.abortOnce(why);
    return this.aborting;
  }

  private async abortOnce(why: string): Promise<void> {
    // Before any await: the windows open now are the ones to put back, whatever the body does from here. (close()
    // and finish() are only noted once aborting, so nothing changes them now; the snapshot holds even if one did.)
    const windows = [...this.windows];
    const at = this.now();
    const { log, seam } = this.options;
    try {
      this.say('ERROR', `${this.options.name} interrupted (run ${this.options.runId}) ${why}`);
      const cut = new Set(windows.map(([, w]) => w.block));
      // Its own try: whatever stopping the probes does, the windows are put back next.
      try {
        // A kill not delivered is said as it happens (onUndelivered), and gets its RESTORE line below.
        const { stopped } = await this.calls.stopAll();
        if (stopped > 0) this.say('NOTE', `${stopped} running call(s) stopped, each its whole process group`);
      } catch (e) {
        this.say('ERROR', `the running calls could not be stopped: ${messageOf(e)}`);
      }
      const { hand, cleanups, late } = await this.putBackAll(windows);
      const names = windows.map(([name]) => name);
      // The groups that may still be running first: they are killed by hand before anything is put back by hand.
      if (this.writeRestore('interrupted', [...this.undeliveredHand(names), ...hand]).length > 0) this.say('ERROR', `state not provably put back — ${this.options.restoreFile}`);
      const blocks = await this.reports(cut, cleanups, late);
      // Last, the kept groups (idb_companion): a restore or a judge may have needed them (batch-11 pkilled the
      // companion only at the end of on_abort). A judge's or a kept group's kill not delivered comes after that
      // RESTORE: its line is appended. stopKept never rejects (bounded.ts turns every kill failure into a result).
      await this.calls.stopKept();
      await this.lastSteps();
      this.writeRestore('interrupted', this.undeliveredHand(names));
      const { errors = log.errors(), ...head } = this.headOf();
      log.summary(summaryLines({ ...head, name: this.options.name, runId: this.options.runId, blocks, restore: { file: this.options.restoreFile, written: this.restoreLines }, errors, interrupted: { at: timeOf(at) } }));
    } catch (e) {
      // The abort's own failure (its SUMMARY could not be written): said on stderr, and the exit is 130 still.
      seam.stderr(`${this.options.name}: the abort failed: ${messageOf(e)}\n`);
    } finally {
      seam.exit(EXIT.interrupted);
    }
  }

  /**
   * Every window open at the interrupt, the last opened first, each on its own: put back, or its hand lines kept. And
   * its cleanup line. `late`: a restore passed its bound.
   */
  private async putBackAll(windows: readonly [string, WindowSpec][]): Promise<{ hand: string[]; cleanups: Map<string | undefined, string[]>; late: boolean }> {
    const hand: string[] = [];
    const cleanups = new Map<string | undefined, string[]>();
    let late = false;
    for (const [name, spec] of [...windows].reverse()) {
      let b: PutBack;
      try {
        b = await this.putBack(name, spec);
      } catch (e) {
        b = { p: { ok: false, why: `its put-back failed: ${messageOf(e)}` } };
      }
      const { p } = b;
      late ||= b.late === true;
      if (p.ok) this.say(p.verdict ?? 'OK', `${name} put back (verified by the abort): ${p.how}`);
      else {
        const own = p.hand !== undefined && p.hand.length > 0 ? p.hand : spec.hand;
        hand.push(...(b.late === true && b.running !== true ? [`${name}: its restore was stopped at its bound (${spec.secs ?? RESTORE_SECS} s), part-way — check the state it left before the hand commands below`] : []), ...own);
        this.say('ERROR', `${name} not provably put back: ${p.why}`);
      }
      // A cleanup label has a wanted block: open() refuses one without.
      if (spec.cleanup !== undefined) {
        const line = p.ok ? verdictLine(spec.cleanup, p.verdict ?? 'OK', `${p.how} (verified by the abort)`) : verdictLine(spec.cleanup, p.verdict ?? 'ERROR', `${p.why} (the abort)`);
        cleanups.set(spec.block, [...(cleanups.get(spec.block) ?? []), line]);
      }
    }
    return { hand, cleanups, late };
  }

  private async putBack(name: string, spec: WindowSpec): Promise<PutBack> {
    const secs = spec.secs ?? RESTORE_SECS;
    // The restore's own calls, so that a restore stopped at its bound is stopped with what it started.
    const scope = this.calls.scope(`${name}'s state`);
    let r: Awaited<ReturnType<typeof within<Putback>>>;
    try {
      r = await within(secs, spec.restore(scope.run));
    } catch (e) {
      return { p: { ok: false, why: `its restore threw: ${messageOf(e)}` } };
    }
    if (r.late) {
      if ((await scope.stop()).notSent.length > 0) return { p: { ok: false, why: `its restore passed its bound (${secs} s) and may still be running` }, late: true, running: true };
      return { p: { ok: false, why: `its restore passed its bound (${secs} s) and was stopped there` }, late: true };
    }
    const file = spec.stateFile;
    if (r.value.ok && file !== undefined && this.options.fs.exists(file)) {
      const state = stateOf(this.options.fs, file);
      if (state !== 'clean') return { p: { ok: false, why: `its restore said done, but ${file} is ${state}` } };
    }
    return { p: r.value };
  }

  /**
   * Each wanted block: judged when complete, not cut inside a window, and the judges' budget not spent — else
   * INTERRUPTED, with why when its records were complete; then its cleanup lines. Nothing is judged once a restore
   * has passed its bound.
   */
  private async reports(cut: ReadonlySet<string | undefined>, cleanups: ReadonlyMap<string | undefined, readonly string[]>, lateRestore: boolean): Promise<BlockReport[]> {
    const budget = this.options.judgeBudgetSecs ?? JUDGE_BUDGET_SECS;
    const until = Date.now() + budget * 1000;
    const spent = `the abort's judging budget of ${budget} s was spent`;
    const skip = lateRestore ? 'a restore passed its bound, so the abort judges nothing more' : undefined;
    const reports: BlockReport[] = [];
    for (const b of this.options.blocks) {
      let report: BlockReport;
      // One budget for reading each block's completeness and judging it: none left, nothing more is read.
      const left = (until - Date.now()) / 1000;
      const c = cut.has(b.block) ? {} : left <= 0 ? { why: spent } : await this.completeOf(b, left);
      if (c !== true) report = { block: b.block, lines: b.linesSoFar(), interrupted: true, why: c.why };
      else {
        // A judge past what was left spent the budget (within settles late at once on none): the next finds none left.
        const judged = skip === undefined ? await this.judged(b, (until - Date.now()) / 1000) : { why: skip };
        if (judged === 'late') report = { block: b.block, lines: b.linesSoFar(), interrupted: true, why: spent };
        else report = 'lines' in judged ? { block: b.block, lines: judged.lines } : { block: b.block, lines: b.linesSoFar(), interrupted: true, why: judged.why };
      }
      reports.push(report);
      const cleanup = cleanups.get(b.block);
      if (cleanup !== undefined) reports.push({ block: b.block, lines: cleanup });
    }
    return reports;
  }

  /**
   * Whether a block is complete, read within `left` seconds of the judges' budget (T2 S6a review round 6): true; or not,
   * and why when known — its own why, `completeness not read in time`, or a throw's first line.
   */
  private async completeOf(b: AbortBlock, left: number): Promise<true | { why?: string }> {
    let r: Awaited<ReturnType<typeof within<boolean | string>>>;
    try {
      r = await within(left, Promise.resolve().then(() => b.complete()));
    } catch (e) {
      return { why: `completeness not read: ${firstLineOf(messageOf(e))}` };
    }
    if (r.late) return { why: 'completeness not read in time' };
    if (r.value === true) return true;
    return typeof r.value === 'string' ? { why: r.value } : {};
  }

  /** A block judged within what is left of the budget: its lines; or why not; or `late`, its calls stopped. */
  private async judged(b: AbortBlock, secs: number): Promise<{ lines: readonly string[] } | { why: string } | 'late'> {
    const scope = this.calls.scope(`the judge of ${b.block} (device-free)`);
    try {
      const r = await within(secs, b.judge(scope.run));
      if (!r.late) return { lines: r.value };
      // A kill of it not delivered is said and gets its RESTORE line (abortOnce), as every undelivered kill does.
      await scope.stop();
      return 'late';
    } catch (e) {
      this.say('ERROR', `${b.block} not judged by the abort: ${messageOf(e)}`);
      return { why: `its judge failed: ${messageOf(e)}` };
    }
  }

  /**
   * The run's last steps (`lastly`), through a scope of detached calls, within their bound: past it their calls are
   * stopped; a throw or a pass of the bound an ERROR line. Never rejects.
   */
  private async lastSteps(): Promise<void> {
    const { lastly } = this.options;
    if (lastly === undefined) return;
    const secs = this.options.lastlySecs ?? LASTLY_SECS;
    const scope = this.calls.scope("what the run's last steps end");
    try {
      const r = await within(secs, lastly(scope.run));
      if (!r.late) return;
      await scope.stop();
      this.say('ERROR', `the run's last steps passed their bound (${secs} s): stopped there`);
    } catch (e) {
      this.say('ERROR', `the run's last steps failed: ${firstLineOf(messageOf(e))}`);
    }
  }

  private headOf(): AbortHead {
    try {
      return this.options.head();
    } catch (e) {
      return { checkout: stepLine('ERROR', `the checkout line is not known (${messageOf(e)})`), labs: [], protectedLines: [] };
    }
  }
}
