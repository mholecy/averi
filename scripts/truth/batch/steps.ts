import { writeSync } from 'node:fs';
import type { BatchFs } from './io.js';
import { oneLine, stepLine, type StepWord } from './words.js';

/**
 * A run's own output. The runner writes its `<name>.out` and steps.log itself, never through `| tee`: batch-11's tee
 * died with the Ctrl-C and took the run's output with it (its on_abort had to switch to steps.log). The terminal gets
 * two things only — the .out's path at the start and the SUMMARY at the end — and when it is gone the run goes on
 * writing its files.
 *
 * The terminal is safe only if it writes synchronously: `process.stdout.write` into a pipe whose reader has gone
 * reports EPIPE later, as an `'error'` event that kills the process unless handled — perhaps in the middle of a
 * restore. So the default terminal (`terminalOf`) writes fd 1 with `writeSync` and says `'gone'` on EPIPE, EBADF
 * or EIO at the call itself; StepLog then drops it and notes why.
 */

/** A terminal: write `text`; `'gone'` when the reader has gone. A throw drops it too. */
export type Terminal = (text: string) => 'gone' | undefined;

const sleepMs = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** The errors that mean the terminal's reader is gone: its end closed (EPIPE), no such fd (EBADF), its tty hung up (EIO). */
const GONE = new Set(['EPIPE', 'EBADF', 'EIO']);

/**
 * The default terminal: `text` written whole to `fd` (1, stdout) with a synchronous write, looping over partial
 * writes. EPIPE, EBADF and EIO say `'gone'`. A write that takes nothing — EAGAIN (a non-blocking pipe that is full) or
 * 0 bytes — is tried again `waitMs` later, until `deadlineMs` pass with no byte taken: then `'gone'` too, never a
 * hang. Any byte taken starts the deadline afresh, so a slow reader is never dropped. Any other failure is thrown.
 */
export function terminalOf(
  fd = 1,
  write: (fd: number, buf: Buffer) => number = writeSync,
  { waitMs = 2, deadlineMs = 1500, now = Date.now }: { waitMs?: number; deadlineMs?: number; now?: () => number } = {},
): Terminal {
  return (text) => {
    let buf = Buffer.from(text);
    let since = now();
    while (buf.length > 0) {
      let taken = 0;
      try {
        taken = write(fd, buf);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? '';
        if (GONE.has(code)) return 'gone';
        if (code !== 'EAGAIN') throw e;
      }
      if (taken > 0) {
        buf = buf.subarray(taken);
        since = now();
      } else if (now() - since >= deadlineMs) return 'gone';
      else sleepMs(waitMs);
    }
    return undefined;
  };
}

/** The first words of live.ts's judged summary line (live-cases.ts#summarize): its exit 1 judged a run. */
export const LIVE_GOLDEN_HEADER = '# Live golden:';

/**
 * A step's word by its exit code. 0 is OK. 1 is DONE only for a judged step (a live.ts run: exit 1 means a MISMATCH or
 * a known case off, which the batch's analyzer judges) whose log holds live.ts's `# Live golden:` line at a line's
 * start — without it live.ts died before judging. Anything else is FAIL (142: the bound's alarm).
 */
export function stepWordOf(code: number, judged?: { judged: boolean; log: string }): 'OK' | 'DONE' | 'FAIL' {
  if (code === 0) return 'OK';
  if (code !== 1 || judged?.judged !== true) return 'FAIL';
  return judged.log.split('\n').some((l) => l.startsWith(LIVE_GOLDEN_HEADER)) ? 'DONE' : 'FAIL';
}

export interface StepLogOptions {
  name: string;
  runId: string;
  /** The wanted blocks, for the header. */
  blocks: readonly string[];
  /** This run's own output (run-dir.ts#layoutOf's outFile): created, never overwritten. */
  outFile: string;
  /** Every run's steps, appended. */
  stepsFile: string;
  /** A symlink to point at `outFile` (run-dir.ts#layoutOf's latestOut); none: no link. */
  latestOut?: string;
  /**
   * The terminal: the start line and the SUMMARY (`terminalOf()` for stdout). One that says `'gone'` or throws is
   * dropped for the rest of the run.
   */
  terminal: Terminal | ((text: string) => void);
  /** Where the SUMMARY is appended alone (run-dir.ts#layoutOf's summaryFile); none: only the .out and the terminal. */
  summaryFile?: string;
  clock?: () => Date;
}

const two = (n: number) => String(n).padStart(2, '0');
const timeOf = (d: Date) => `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;

/** The run's step log: its `.out` (everything), steps.log (the timed notes), and the terminal (the start and the SUMMARY). */
export class StepLog {
  private readonly errorLines: string[] = [];
  private terminalUp = true;

  private constructor(
    private readonly fs: BatchFs,
    private readonly o: StepLogOptions,
  ) {}

  /**
   * Open the run's output: create its .out (throws when one exists — a run folder is never reused), point the latest
   * link at it (a plain file there is kept, and said), append the run's header to steps.log and tell the terminal where
   * to look.
   */
  static open(fs: BatchFs, o: StepLogOptions): StepLog {
    const log = new StepLog(fs, o);
    const header = `${log.time()} ---- ${o.name} run ${o.runId}, blocks ${o.blocks.join(',')}`;
    try {
      fs.createExclusive(o.outFile, `${header}\n`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`${o.outFile} already exists: a run's output is never overwritten`);
      throw e;
    }
    fs.append(o.stepsFile, `${header}\n`);
    const notLinked = o.latestOut === undefined ? undefined : fs.linkLatest(o.latestOut, o.outFile);
    if (notLinked !== undefined) log.note(stepLine('WARN', `${o.latestOut} not pointed at this run: ${notLinked}`));
    const also = o.latestOut !== undefined && notLinked === undefined ? ` (also ${o.latestOut})` : '';
    log.toTerminal(`${o.name} run ${o.runId}: blocks ${o.blocks.join(',')} — writing ${o.outFile}${also}; tail -f it; the SUMMARY follows here at the end.\n`);
    return log;
  }

  private time(): string {
    return timeOf((this.o.clock ?? (() => new Date()))());
  }

  private toTerminal(text: string): void {
    if (!this.terminalUp) return;
    let why: string | undefined;
    try {
      why = this.o.terminal(text) === 'gone' ? 'closed' : undefined;
    } catch (e) {
      why = (e as Error).message;
    }
    if (why === undefined) return;
    this.terminalUp = false;
    this.note(stepLine('NOTE', `the terminal is gone (${why}): this run writes only to ${this.o.outFile} and ${this.o.stepsFile} now`));
  }

  /** A line to the .out only (a step's banner, a detail). */
  print(line: string): void {
    this.fs.append(this.o.outFile, `${oneLine(line)}\n`);
  }

  /** A timed line to the .out and steps.log. An ERROR line is kept for the SUMMARY. */
  note(line: string): void {
    const timed = `${this.time()} ${oneLine(line)}`;
    if (line.startsWith('ERROR')) this.errorLines.push(timed);
    this.fs.append(this.o.outFile, `${timed}\n`);
    this.fs.append(this.o.stepsFile, `${timed}\n`);
  }

  /** A step line, timed (`09:44:26 OK   kf analyze`). */
  step(word: StepWord, text: string): void {
    this.note(stepLine(word, text));
  }

  /** `ERROR <text>`, timed, kept for the SUMMARY. */
  error(text: string): void {
    this.step('ERROR', text);
  }

  /** This run's ERROR lines, as written, in order: the SUMMARY's last section (an earlier run's are not this run's). */
  errors(): readonly string[] {
    return [...this.errorLines];
  }

  /** The SUMMARY (words.ts#summaryLines, its lines checked there): to the .out, to summaryFile, then to the terminal. */
  summary(lines: readonly string[]): void {
    const text = `${lines.join('\n')}\n`;
    this.fs.append(this.o.outFile, text);
    if (this.o.summaryFile !== undefined) this.fs.append(this.o.summaryFile, text);
    this.toTerminal(text);
  }
}
