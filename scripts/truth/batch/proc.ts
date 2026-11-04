import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';

/**
 * The batch module's one process seam: every process it starts, every signal it sends or takes, and its exit go
 * through a `ProcessSeam`. Thin on purpose — the decisions (which bound, when to send which signal, what an interrupt
 * puts back) are bounded.ts's and abort.ts's, tested over a fake seam; this file is tested with real children
 * (tests/truth/batch/bounded-proc.test.ts, abort-proc.test.ts).
 *
 * Every child starts in a process group of its own (`detached`, setsid: batch-11's `perl -e 'setpgrp(0, 0)'`), stdin
 * from /dev/null, its output to pipes or to its log file, never to the terminal. So the terminal's Ctrl-C reaches the
 * runner alone: a probe is stopped by the runner (abort.ts), a restore is not stopped at all — a second Ctrl-C cannot
 * kill it (batch-11's restore child ran in the batch's foreground group and died of one). And a group can be ended
 * whole, grandchildren too: src/adapters/exec.ts kills only the direct child.
 */

export interface StartOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** A log file the child's stdout and stderr are appended to as it runs (opened for append: never truncated). */
  log?: string;
}

/** How a child ended: its code or its signal; `error` when it never started (no such command). */
export interface Ended {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
}

export interface Started {
  /** Its pid, which is also its group's id; undefined when it never started. */
  pid: number | undefined;
  /** Settles once it has ended and its pipes are read (or `CLOSE_GRACE_MS` after its end: see below). Never rejects. */
  done: Promise<Ended>;
  /** What it wrote to stdout and stderr, when not to a log. */
  out(): string;
  err(): string;
}

/** What the runner takes instead of the default exits: SIGINT, SIGTERM, SIGHUP; an uncaught exception or rejection. */
export interface Handlers {
  signal(name: NodeJS.Signals): void;
  fatal(error: unknown): void;
}

export interface ProcessSeam {
  /** Start `cmd` in a process group of its own, stdin /dev/null. */
  start(cmd: string, args: readonly string[], options: StartOptions): Started;
  /** Send `signal` to the whole group `pid` leads; a group already gone is no error. */
  killGroup(pid: number, signal: NodeJS.Signals): void;
  /**
   * Route the abort signals and the fatal errors to `handlers`, replacing their default exits — a listener on SIGINT
   * is what ignoring it means in Node (zsh's `trap '' INT` once the handler ignores it). And drop errors on stdout and
   * stderr: an EPIPE there (the reader gone) is no fatal error. SIGPIPE itself Node ignores already (`trap '' PIPE`).
   */
  install(handlers: Handlers): void;
  /** End the runner with `code`. Called once, after the abort has put back what it could. */
  exit(code: number): void;
}

/** The signals that abort a run: a Ctrl-C, a kill, a closed terminal (`trap on_abort INT TERM HUP`). */
export const ABORT_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

/**
 * How long a child's pipes are read after it has ended. A grandchild that outlives it holds them open, which would
 * hold its result for ever; after this the pipes are let go and the result is what was read.
 */
export const CLOSE_GRACE_MS = 1000;

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function notStarted(error: unknown): Started {
  return { pid: undefined, done: Promise.resolve({ code: null, signal: null, error: messageOf(error) }), out: () => '', err: () => '' };
}

function startedOf(child: ChildProcess): Started {
  let [out, err] = ['', ''];
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (err += d.toString()));
  const done = new Promise<Ended>((resolve) => {
    let ended: Ended | undefined;
    child.once('error', (e) => resolve({ code: null, signal: null, error: e.message }));
    child.once('close', (code, signal) => resolve(ended ?? { code, signal }));
    child.once('exit', (code, signal) => {
      ended = { code, signal };
      const letGo = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        resolve({ code, signal });
      }, CLOSE_GRACE_MS);
      letGo.unref();
    });
  });
  return { pid: child.pid, done, out: () => out, err: () => err };
}

/** The real seam. */
export const nodeProcess: ProcessSeam = {
  start(cmd, args, { cwd, env, log }) {
    let fd: number | undefined;
    try {
      fd = log === undefined ? undefined : openSync(log, 'a');
      const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', fd ?? 'pipe', fd ?? 'pipe'] });
      // No such command: no pid, and its 'error' settles `done`.
      return startedOf(child);
    } catch (e) {
      return notStarted(e);
    } finally {
      // The child holds its own copy of the log's fd.
      if (fd !== undefined) closeSync(fd);
    }
  },
  killGroup(pid, signal) {
    try {
      process.kill(-pid, signal);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
    }
  },
  install(handlers) {
    for (const name of ABORT_SIGNALS) process.on(name, () => handlers.signal(name));
    process.on('uncaughtException', (e) => handlers.fatal(e));
    process.on('unhandledRejection', (e) => handlers.fatal(e));
    for (const stream of [process.stdout, process.stderr]) stream.on('error', () => {});
  },
  exit(code) {
    process.exit(code);
  },
};
