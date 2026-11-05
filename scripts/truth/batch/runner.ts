import { join } from 'node:path';
import { AbortGuard, type AbortBlock, type WindowSpec } from './abort.js';
import type { Call, Run } from './bounded.js';
import { completeness, runFiles, runsIn, selectorOf, stepOutcome, writeCases, type Asked } from './cases.js';
import { isEexist, nodeFs, type BatchFs } from './io.js';
import { liveTableOf, type LiveSelection, type LiveTable } from './live-table.js';
import { ancestor, casesOnMain, cellsOnMain, checkout, preconditionLine, type Git, type Precondition } from './preconditions.js';
import { nodeProcess, type ProcessSeam } from './proc.js';
import { layoutOf, META, newRunId, openRun, plainSegment, refusalLines, refusals, type Stateful } from './run-dir.js';
import {
  backstopLine,
  checkoutLine,
  detailLines,
  detailsLines,
  deviceArgs,
  errorLinesIn,
  hasVerdictOf,
  LAB,
  labLine,
  liveArgs,
  liveStepText,
  NOT_READ_CHECKOUT,
  needsLine,
  recordFiles,
  recordGap,
  recordOf,
  rejudgeArgs,
  linesIn,
  stepsOfRun,
  type AskedRun,
  type BatchConfig,
  type BlockRecord,
  type ConfigRead,
  type DetailSpec,
  type NeedResult,
} from './runner-lines.js';
import { knobs as readKnobs, selectBlocks, type KnobSpec, type KnobValues } from './select.js';
import { StepLog, terminalOf, type Terminal } from './steps.js';
import { EXIT, exitCodeOf, firstLineOf, messageOf, oneLine, parseVerdictLine, summaryLines, verdictLine, type StepWord, type Verdict } from './words.js';

/**
 * runBatch: a device batch's run, start to end, composed of the module's parts — a batch, kept outside the repo, gives
 * only its blocks, knobs, needs and probes. In this order:
 *
 * 1. the config (runner-lines.ts#configOf: `--out`, `--udid`, `--serial`, or their env), ONLY= and the knobs
 *    (select.ts), each error a refusal;
 * 2. the refusals (run-dir.ts): a RESTORE left, an earlier run's state file not clean, an out folder inside the checkout,
 *    the batch's own reasons — every refusal exits 2 with nothing done: no folder, no call;
 * 3. the run opened: one fresh `run-<id>` folder per wanted block, meta's, and the lab folder on every run; its own
 *    `.out` and steps.log (steps.ts, no tee);
 * 4. the AbortGuard armed (abort.ts): a signal, a throw out of a block or an uncaught error from here on puts the dirty
 *    windows back and prints the abort SUMMARY, exit 130;
 * 5. the preconditions (preconditions.ts): the checkout, then each wanted block's own, all before the first block runs.
 *    One not shown makes its block INCONCLUSIVE naming why, never a refusal (the S3 choice: batch-11's way); a failed
 *    checkout does so for every block, and the SUMMARY is still written;
 * 6. each wanted block, in the batch's order: its needs (each checked once, by the first block that names it; S6b
 *    supplies the checks — the lab simulator, the lab emulator), a failed one making it INCONCLUSIVE, not run; then its
 *    `run(ctx)`;
 * 7. the normal end: every window still open to RESTORE (finish); each block that ran with no verdict of its own judged
 *    (`judge`, device-free); the backstop for a wanted block still without one; the details; the SUMMARY; the exit code
 *    (words.ts#exitCodeOf).
 *
 * A block gets, through its ctx: the steps (`step`, `note`, `err`), bounded probes (its `bounded`), dirty windows
 * (`open`, `close`), its folder, its verdict lines (several allowed), `restoreHand` (RESTORE now, exit 1),
 * `verdictAndHand` (S4's compare and S5's cleanup: a line and its hand lines), the protected-key line slot, `liveRun`
 * (S3: `.cases` first, live.ts with its record, then its rejudge) and a non-live block's records (`asks`, `record`).
 * The SUMMARY's ERROR lines are this run's steps' and every ERROR line of this run's logs (`*.log`, analyze.txt).
 *
 * A batch, outside the repo (`node --import tsx batch-13.ts --out <dir> --udid <sim> --serial <emu>`):
 *
 *     const at = (f) => pathToFileURL(join(repo, 'scripts/truth/batch', f)).href;
 *     const { runBatch } = await import(at('runner.ts'));
 *     const { configOf } = await import(at('runner-lines.ts'));
 *     await runBatch({ name: 'batch-13', knobs, needs: { android: androidLab }, blocks: [kf, E5],
 *       config: configOf(process.argv.slice(2), process.env, repo) });
 *
 * Not here (S6b, lab plumbing): the needs' checks themselves, the WDA window's orchestration, the lab build, the
 * tri-state reads around a block. Nothing here calls a device: every call is the batch's, through `bounded`.
 */

/** A need a block names: the lab devices (`ios`, `android`), or any other the batch gives a check for. */
export type Need = 'ios' | 'android' | (string & {});

/** What a need's check gets: bounded calls, the lab folder, the config, the steps. */
export interface NeedCtx {
  bounded: Run;
  labDir: string;
  config: BatchConfig;
  step(word: StepWord, text: string): void;
}
export type NeedCheck = (c: NeedCtx) => Promise<NeedResult>;

/** What a block's preconditions are asked through: S3's checks over this run's git and main's table. */
export interface PreconditionKit {
  git: Git;
  table: LiveTable;
  ancestor(sha: string, what?: string): Promise<Precondition>;
  casesOnMain(q: { ids: readonly string[] } & Pick<LiveSelection, 'platform'> & Partial<Pick<LiveSelection, 'app' | 'groups'>>): Promise<Precondition>;
  cellsOnMain(ids: readonly string[]): Promise<Precondition>;
}
export type PreconditionCheck = (k: PreconditionKit) => Promise<Precondition>;

/** What a judge or a block's own completeness rule reads: its folder, through the run's fs. */
export interface BlockFiles {
  dir: string;
  fs: BatchFs;
}

/** What a live run did: live.ts's step, and its rejudge's when a record was written. */
export interface LiveOutcome {
  live: ReturnType<typeof stepOutcome>;
  rejudge?: ReturnType<typeof stepOutcome>;
}

/** What a block's run is given. */
export interface BlockCtx<K = unknown> {
  readonly id: string;
  /** Its own `run-<id>` folder. */
  readonly dir: string;
  /** The lab folder of this run. */
  readonly labDir: string;
  readonly config: BatchConfig;
  readonly knobs: K;
  /** A probe, bounded in a group of its own (owner: this block); the abort stops it. */
  readonly bounded: Run;
  step(word: StepWord, text: string): void;
  note(line: string): void;
  err(text: string): void;
  /** A line to the .out only. */
  print(line: string): void;
  /** A dirty window (abort.ts), this block's unless the spec names one. */
  open(name: string, spec: WindowSpec): void;
  close(name: string): void;
  /** End this block's kept groups (idb_companion). */
  stopKept(): Promise<void>;
  /** A verdict line, `<label>: <verdict> — <why>`, the block's own label unless one is given. */
  verdict(verdict: Verdict, why?: string, label?: string): void;
  /** Lines an analyzer wrote, as they are (each one line). */
  verdictLines(lines: readonly string[]): void;
  /** Hand lines to RESTORE now (abort.ts#leave): the run exits 1, the next run refuses to start. */
  restoreHand(hand: readonly string[]): void;
  /** A line with its hand lines (S4's compare, S5's cleanUp): the line a verdict, the hand lines to RESTORE. */
  verdictAndHand(r: { line: string; hand: readonly string[] }): void;
  /** A protected key's line (the schemeapproval key), after the blocks' lines in the SUMMARY. */
  protectedLine(line: string): void;
  /** A live run (S3): its `.cases` first, then live.ts with its record, then the rejudge, each a bounded step. */
  liveRun(name: string, asked: Asked, o: { secs: number; rejudgeSecs?: number }): Promise<LiveOutcome>;
  /** What a non-live run is asked, written before it runs (never overwritten). */
  asks(name: string, record: BlockRecord): void;
  /** What it did, once it is done: the block is complete only when this matches what it was asked. */
  record(name: string, record: BlockRecord): void;
}

export interface Block<K = unknown> {
  /** Its folder's name and ONLY='s: one plain path segment. */
  id: string;
  /** Its verdict line's label (`kf live verdict`): its INCONCLUSIVE lines and the backstop use it. */
  label: string;
  needs: readonly Need[];
  /** Asked before any block runs; one not shown makes it INCONCLUSIVE. The clean checkout is every block's. */
  preconditions?: readonly PreconditionCheck[];
  /** Its run folders may hold a state file: a dirty one refuses the next run (run-dir.ts#refusals). */
  stateful?: Omit<Stateful, 'block'>;
  run(ctx: BlockCtx<K>): Promise<void>;
  /**
   * Its analyzer, device-free: its verdict lines from its folder. Run at the normal end when it wrote no verdict of
   * its label, and by the abort when its records are complete.
   */
  judge?(j: BlockFiles & { run: Run }): Promise<readonly string[]>;
  /** Its records complete, for the abort (batch-12's block_complete); none: every asked run complete. */
  complete?(j: BlockFiles): boolean;
  /** What the details print of its files. */
  details?: readonly DetailSpec[];
}

/** The runner's io: every file and process through the module's seams; the clock and pid for the run's id. */
export interface RunIo {
  fs: BatchFs;
  seam: ProcessSeam;
  terminal: Terminal | ((text: string) => void);
  clock: () => Date;
  pid: number;
  /** Main's live-cases table (the checkout's own, by default). */
  table: LiveTable;
  /** abort.ts's options: the grace between SIGTERM and SIGKILL, the install bound, the judges' budget. */
  graceMs?: number;
  installSecs?: number;
  judgeBudgetSecs?: number;
}

export interface RunBatchOptions<S extends KnobSpec> {
  name: string;
  blocks: readonly Block<KnobValues<S>>[];
  knobs?: S;
  /** A check for every need a block names. */
  needs?: Readonly<Record<string, NeedCheck>>;
  config: ConfigRead;
  /** The batch's own refusals (run-dir.ts#refusals' batchReasons). */
  batchReasons?: readonly string[];
  io?: Partial<RunIo>;
}

/** A live rejudge's bound when none is given: it only judges a record, device-free. */
export const REJUDGE_SECS = 120;

/** The batch's own mistakes, thrown before anything is done. */
function checkBlocks(blocks: readonly Block<never>[], needs: Readonly<Record<string, NeedCheck>>): void {
  const ids = blocks.map((b) => b.id);
  for (const b of blocks) {
    plainSegment('block', b.id);
    if (ids.indexOf(b.id) !== ids.lastIndexOf(b.id)) throw new Error(`block ${b.id} is named twice`);
    verdictLine(b.label, 'INCONCLUSIVE');
    for (const n of b.needs) if (needs[n] === undefined) throw new Error(`${b.id} needs ${n}, which has no check (needs: ${Object.keys(needs).join(', ')})`);
  }
}

/** The run's whole: the order above. Resolves to the exit code; the seam's exit is called with it too. */
export async function runBatch<S extends KnobSpec>(o: RunBatchOptions<S>): Promise<number> {
  const needs = o.needs ?? {};
  checkBlocks(o.blocks, needs);
  const base = { fs: nodeFs, seam: nodeProcess, terminal: terminalOf(), clock: () => new Date(), pid: process.pid, ...o.io };
  const refused = (lines: readonly string[]): number => {
    for (const l of lines) base.terminal(`${l}\n`);
    base.seam.exit(EXIT.refused);
    return EXIT.refused;
  };
  if (!o.config.ok) return refused(o.config.errors);
  const config = o.config.config;
  const io: RunIo = { ...base, table: base.table ?? liveTableOf(config.repo) };
  const ids = o.blocks.map((b) => b.id);
  const selection = selectBlocks(ids, config.env.ONLY);
  if (!selection.ok) return refused(selection.errors);
  const knobs = readKnobs(o.knobs ?? {}, config.env);
  if (!knobs.ok) return refused([...selection.warnings, ...knobs.errors]);
  const stateful = o.blocks.flatMap((b) => (b.stateful === undefined ? [] : [{ block: b.id, ...b.stateful }]));
  const reasons = refusals(io.fs, { out: config.out, repo: config.repo, stateful, batchReasons: o.batchReasons });
  if (reasons.length > 0) return refused(refusalLines(o.name, reasons));
  const runId = newRunId(io.clock(), io.pid);
  const all = ids.includes(LAB) ? ids : [LAB, ...ids];
  const wanted = selection.wanted.includes(LAB) ? selection.wanted : [LAB, ...selection.wanted];
  const opened = openRun(io.fs, { out: config.out, runId, blocks: all, wanted });
  if (!opened.ok) return refused([opened.error]);
  const blocks = o.blocks.filter((b) => selection.wanted.includes(b.id));
  const run = new BatchRun(o.name, runId, config, knobs.values, blocks, needs, opened.dirs, io);
  for (const w of selection.warnings) run.log.note(w);
  return run.go();
}

/** One run of a batch: its log, its guard, what each block said. */
class BatchRun<K> {
  readonly log: StepLog;
  private readonly guard: AbortGuard;
  private readonly lines = new Map<string, string[]>();
  private readonly labs: string[] = [];
  private readonly protectedLines: string[] = [];
  private readonly needResults = new Map<string, Promise<NeedResult>>();
  private checkout: string | undefined;
  private readonly restoreFile: string;
  private readonly stepsFile: string;

  constructor(
    private readonly name: string,
    private readonly runId: string,
    private readonly config: BatchConfig,
    private readonly knobs: K,
    private readonly blocks: readonly Block<K>[],
    private readonly needs: Readonly<Record<string, NeedCheck>>,
    private readonly dirs: Readonly<Record<string, string>>,
    private readonly io: RunIo,
  ) {
    const layout = layoutOf(config.out, name, dirs[META]);
    this.restoreFile = layout.restoreFile;
    this.stepsFile = layout.stepsFile;
    this.log = StepLog.open(io.fs, { name, runId, blocks: blocks.map((b) => b.id), outFile: layout.outFile, stepsFile: layout.stepsFile, latestOut: layout.latestOut, terminal: io.terminal, summaryFile: layout.summaryFile, clock: io.clock });
    this.guard = new AbortGuard({
      name,
      runId,
      fs: io.fs,
      log: this.log,
      seam: io.seam,
      restoreFile: layout.restoreFile,
      clock: io.clock,
      graceMs: io.graceMs,
      installSecs: io.installSecs,
      judgeBudgetSecs: io.judgeBudgetSecs,
      head: () => ({ checkout: this.checkout ?? NOT_READ_CHECKOUT, labs: this.labs, protectedLines: this.protectedLines, errors: this.logErrors() }),
      blocks: blocks.map((b) => this.abortBlock(b)),
    });
    for (const b of blocks) this.lines.set(b.id, []);
  }

  private get git(): Git {
    return { repo: this.config.repo, run: this.guard.bounded, fs: this.io.fs };
  }

  /** Steps 4 to 7. The abort, once begun, prints its own SUMMARY and exits: the body only stops then. */
  async go(): Promise<number> {
    try {
      return await this.guard.run(async () => {
        const pre = await this.preconditions();
        for (const b of this.blocks) {
          if (this.guard.interrupted) return EXIT.interrupted;
          await this.runBlock(b, pre.get(b.id));
        }
        if (this.guard.interrupted) return EXIT.interrupted;
        const restore = await this.guard.finish();
        // A block not run has its INCONCLUSIVE line already: only the blocks that ran are judged.
        for (const b of this.blocks) await this.judgeAtEnd(b);
        for (const b of this.blocks) await this.backstop(b);
        if (this.guard.interrupted) return EXIT.interrupted;
        return this.end(restore);
      });
    } catch {
      // The abort ran (guard.run rejects only then): it printed its SUMMARY and called exit(130).
      return EXIT.interrupted;
    }
  }

  /**
   * The checkout, then each block's own: its INCONCLUSIVE line when one is not shown. Interrupted meanwhile: none, and
   * the checkout line not set — git's answer to a stopped call is no checkout's.
   */
  private async preconditions(): Promise<Map<string, string | undefined>> {
    const lines = new Map<string, string | undefined>();
    const ck = await checkout(this.git);
    if (this.guard.interrupted) return lines;
    this.checkout = checkoutLine(ck);
    this.log.note(this.checkout);
    const kit = this.kit();
    for (const b of this.blocks) {
      if (!ck.ok) lines.set(b.id, preconditionLine(b.label, [ck]));
      else {
        const results: Precondition[] = [];
        for (const check of b.preconditions ?? []) results.push(await shown(check, kit));
        lines.set(b.id, preconditionLine(b.label, results));
      }
    }
    return lines;
  }

  private kit(): PreconditionKit {
    const { git } = this;
    const table = this.io.table;
    return {
      git,
      table,
      ancestor: (sha, what) => ancestor({ ...git, sha, what }),
      casesOnMain: (q) => casesOnMain({ ...q, table }),
      cellsOnMain: (ids) => cellsOnMain({ ids, table }),
    };
  }

  /** A block: not run for a precondition or a need, its INCONCLUSIVE written; else run. */
  private async runBlock(b: Block<K>, precondition: string | undefined): Promise<void> {
    if (precondition !== undefined) return this.notRun(b, precondition);
    const failed: { need: string; why: string }[] = [];
    for (const need of b.needs) {
      const r = await this.needOf(need);
      if (!r.ok) failed.push({ need, why: r.why });
    }
    if (failed.length > 0) return this.notRun(b, needsLine(b.label, failed));
    // A need checked while the abort began (its probe stopped): the block is not started.
    if (this.guard.interrupted) return;
    this.log.print(`== ${b.id} (${this.dirs[b.id]}/) ==`);
    await b.run(this.ctxOf(b));
  }

  private notRun(b: Block<K>, line: string): void {
    this.verdict(b, line);
    // A line of verdictLine's own making, with a why: it parses.
    this.log.step('SKIP', `${b.id} not run: ${parseVerdictLine(line)!.why}`);
  }

  /** A need's answer, checked once: by the first block that names it. Its lab line in the order checked. */
  private needOf(need: string): Promise<NeedResult> {
    let r = this.needResults.get(need);
    if (r === undefined) {
      r = this.checkNeed(need);
      this.needResults.set(need, r);
    }
    return r;
  }

  private async checkNeed(need: string): Promise<NeedResult> {
    let r: NeedResult;
    try {
      r = await this.needs[need]({ bounded: this.guard.bounded, labDir: this.dirs[LAB], config: this.config, step: (w, t) => this.log.step(w, t) });
    } catch (e) {
      r = { ok: false, why: `its check threw: ${firstLineOf(messageOf(e))}` };
      this.log.error(`LAB ${need}: ${r.why}`);
    }
    const line = labLine(need, r);
    this.labs.push(line);
    this.log.note(line);
    return r;
  }

  /**
   * A verdict line kept for the SUMMARY and in the block's verdict.txt — checked first: one holding a line break is the
   * batch's mistake, thrown before it is kept, so no SUMMARY (the abort's too) ever refuses it. Once interrupted, only
   * noted: a block whose probe the abort stopped goes on, and what it says then is not trusted.
   */
  private verdict(b: Block<K>, line: string): void {
    oneLine(line, `${b.id}'s verdict line`);
    if (this.guard.interrupted) return this.log.step('NOTE', `${b.id}: a verdict after the interrupt not kept: ${line}`);
    this.lines.get(b.id)!.push(line);
    this.io.fs.append(join(this.dirs[b.id], 'verdict.txt'), `${line}\n`);
    this.log.print(line);
  }

  private ctxOf(b: Block<K>): BlockCtx<K> {
    const dir = this.dirs[b.id];
    const { log, guard, io } = this;
    const bounded: Run = (cmd, args, call: Call = {}) => guard.bounded(cmd, args, { owner: b.id, ...call });
    const exclusive = (path: string, text: string, what: string) => {
      try {
        io.fs.createExclusive(path, text);
      } catch (e) {
        if (isEexist(e)) throw new Error(`${path} already exists: what a run ${what} is never overwritten`);
        throw e;
      }
    };
    const recordText = (name: string, record: BlockRecord): string => {
      plainSegment('run name', name);
      if (recordOf(record) === undefined) throw new Error(`${name}: ${JSON.stringify(record)} is no record of runs`);
      return `${JSON.stringify(record)}\n`;
    };
    return {
      id: b.id,
      dir,
      labDir: this.dirs[LAB],
      config: this.config,
      knobs: this.knobs,
      bounded,
      step: (w, t) => log.step(w, t),
      note: (l) => log.note(l),
      err: (t) => log.error(t),
      print: (l) => log.print(l),
      open: (name, spec) => guard.open(name, { block: b.id, ...spec }),
      close: (name) => guard.close(name),
      stopKept: () => guard.stopKept(b.id),
      verdict: (v, why, label = b.label) => this.verdict(b, verdictLine(label, v, why)),
      verdictLines: (lines) => {
        for (const l of linesIn(lines)) this.verdict(b, l);
      },
      restoreHand: (hand) => void guard.leave(b.id, hand),
      verdictAndHand: (r) => {
        this.verdict(b, r.line);
        guard.leave(b.id, r.hand);
      },
      protectedLine: (l) => void this.protectedLines.push(oneLine(l, 'a protected-key line')),
      liveRun: (name, asked, o) => this.liveRun(b, bounded, name, asked, o),
      asks: (name, record) => exclusive(recordFiles(dir, name).asked, recordText(name, record), 'was asked'),
      record: (name, record) => {
        const f = recordFiles(dir, name);
        const text = recordText(name, record);
        if (!io.fs.exists(f.asked)) throw new Error(`${name}: recorded before it was asked (asks first)`);
        exclusive(f.done, text, 'recorded');
      },
    };
  }

  /** batch-11's live_run: the `.cases` first, live.ts with its record, then its rejudge — each a bounded step. */
  private async liveRun(b: Block<K>, bounded: Run, name: string, asked: Asked, o: { secs: number; rejudgeSecs?: number }): Promise<LiveOutcome> {
    const { fs } = this.io;
    const { repo } = this.config;
    const dir = this.dirs[b.id];
    writeCases(fs, dir, name, asked);
    const f = runFiles(dir, name);
    const what = `${b.id} live ${name}`;
    const device = deviceArgs(asked, this.config);
    if ('why' in device) {
      this.log.step('FAIL', `${what}: ${device.why}`);
      return { live: { word: 'FAIL', why: device.why } };
    }
    this.log.print(`== ${what} (log: ${f.log}) ==`);
    const r = await bounded(process.execPath, liveArgs({ repo, asked, device: device.args, record: f.record }), { secs: o.secs, cwd: repo, log: f.log });
    const live = stepOutcome(r.code, fs.read(f.log) ?? '');
    this.log.step(live.word, liveStepText(what, live, f.log));
    if ((fs.read(f.record) ?? '') === '') {
      this.log.step('FAIL', `${b.id} ${name}: no record written (${f.record})`);
      return { live };
    }
    const rj = await bounded(process.execPath, rejudgeArgs({ repo, asked, record: f.record }), { secs: o.rejudgeSecs ?? REJUDGE_SECS, cwd: repo, log: f.summary });
    const rejudge = stepOutcome(rj.code, fs.read(f.summary) ?? '');
    this.log.step(rejudge.word, liveStepText(`${b.id} rejudge ${name}`, rejudge, f.summary));
    return { live, rejudge };
  }

  /** The names of the records a block asked: each `<name>.asked.json` in its folder, sorted. */
  private askedRecords(dir: string): string[] {
    return this.io.fs
      .list(dir)
      .filter((n) => n.endsWith('.asked.json'))
      .map((n) => n.slice(0, -'.asked.json'.length));
  }

  private recordGapOf(dir: string, name: string): string | undefined {
    const f = recordFiles(dir, name);
    return recordGap(name, this.io.fs.read(f.asked), this.io.fs.read(f.done));
  }

  /**
   * Whether a block's records are complete without a device or the table (batch-12's block_complete): one run asked at
   * least; every live run's record and rejudge summary written; every record what it was asked.
   */
  private recordsComplete(dir: string): boolean {
    const { fs } = this.io;
    const live = runsIn(fs, dir);
    const records = this.askedRecords(dir);
    const written = (p: string) => (fs.read(p) ?? '') !== '';
    return live.length + records.length > 0 && live.every((n) => written(runFiles(dir, n).record) && written(runFiles(dir, n).summary)) && records.every((n) => this.recordGapOf(dir, n) === undefined);
  }

  /** The block as the abort sees it: a verdict of its own already kept, or its records complete and a judge to read them. */
  private abortBlock(b: Block<K>): AbortBlock {
    const dir = this.dirs[b.id];
    const files = { dir, fs: this.io.fs };
    const own = () => hasVerdictOf(this.lines.get(b.id)!, b.label);
    return {
      block: b.id,
      complete: () => own() || (b.judge !== undefined && (b.complete?.(files) ?? this.recordsComplete(dir))),
      judge: async (run) => (own() ? this.lines.get(b.id)! : linesIn(await b.judge!({ ...files, run }))),
      linesSoFar: () => this.lines.get(b.id)!,
    };
  }

  /** The normal end's judge: for a block with no verdict of its label (so one that ran). A throw is an ERROR line. */
  private async judgeAtEnd(b: Block<K>): Promise<void> {
    if (b.judge === undefined || hasVerdictOf(this.lines.get(b.id)!, b.label)) return;
    try {
      const lines = linesIn(await b.judge({ dir: this.dirs[b.id], fs: this.io.fs, run: this.guard.bounded }));
      this.log.step('OK', `${b.id} analyze`);
      for (const l of lines) this.verdict(b, l);
    } catch (e) {
      this.log.error(`${b.id} analyze: ${firstLineOf(messageOf(e))}`);
    }
  }

  /** A wanted block still without a verdict of its label: its live runs' and records' gaps, or `not run`. */
  private async backstop(b: Block<K>): Promise<void> {
    if (hasVerdictOf(this.lines.get(b.id)!, b.label)) return;
    const { fs, table } = this.io;
    const dir = this.dirs[b.id];
    const runs: AskedRun[] = [];
    for (const name of runsIn(fs, dir)) runs.push({ name, result: await completeness({ fs, dir, name, select: selectorOf(table) }) });
    for (const name of this.askedRecords(dir)) {
      const why = this.recordGapOf(dir, name);
      runs.push({ name, result: why === undefined ? { ok: true } : { ok: false, why } });
    }
    this.verdict(b, backstopLine(b.label, runs));
  }

  /** Every ERROR line of this run's logs: each run folder's `*.log` and analyze.txt, meta's and lab's first (openRun's order). */
  private logErrors(): string[] {
    const { fs } = this.io;
    return Object.values(this.dirs).flatMap((d) => fs.list(d).filter((n) => n.endsWith('.log') || n === 'analyze.txt').flatMap((n) => errorLinesIn(fs.read(join(d, n)) ?? '')));
  }

  /** The details, then the SUMMARY; the exit called with its code. */
  private end(restore: readonly string[]): number {
    const { fs } = this.io;
    const checkout = this.checkout!;
    const details = detailsLines({
      checkout,
      runId: this.runId,
      stepsFile: this.stepsFile,
      steps: stepsOfRun(fs.read(this.stepsFile) ?? '', this.name, this.runId),
      blocks: this.blocks.map((b) => ({ id: b.id, dir: this.dirs[b.id], lines: (b.details ?? []).flatMap((d) => detailLines(d, fs.read(join(this.dirs[b.id], d.file)) ?? '')) })),
      out: this.config.out,
    });
    for (const l of details) this.log.print(l);
    const summary = {
      name: this.name,
      runId: this.runId,
      checkout,
      labs: this.labs,
      blocks: this.blocks.map((b) => ({ block: b.id, lines: this.lines.get(b.id)! })),
      protectedLines: this.protectedLines,
      restore: { file: this.restoreFile, written: restore },
      errors: [...this.log.errors(), ...this.logErrors()],
    };
    this.log.summary(summaryLines(summary));
    const code = exitCodeOf(summary);
    // Synchronously after the SUMMARY: no signal can come between them and start an abort SUMMARY too.
    this.io.seam.exit(code);
    return code;
  }
}

/** A precondition check's answer, its why one line; a check that throws is not shown, never the run's error. */
async function shown(check: PreconditionCheck, kit: PreconditionKit): Promise<Precondition> {
  try {
    const r = await check(kit);
    return r.ok ? r : { ok: false, why: firstLineOf(r.why) };
  } catch (e) {
    return { ok: false, why: `its check threw: ${firstLineOf(messageOf(e))}` };
  }
}
