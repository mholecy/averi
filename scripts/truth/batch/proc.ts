import { spawn, type ChildProcess } from 'node:child_process';
import { writeSync } from 'node:fs';
import { messageOf } from './words.js';

/**
 * The batch module's one process seam: every process it starts, every signal it sends or takes, and its exit go
 * through a `ProcessSeam`. Thin on purpose — the decisions (which bound, when to send which signal, how long to read a
 * child's pipes, what an interrupt puts back) are bounded.ts's and abort.ts's, tested over a fake seam; this file only
 * reports what happened, and is tested with real children
 * (tests/truth/batch/bounded-proc.test.ts, abort-proc.test.ts).
 *
 * Every child starts in a process group of its own (`detached`, setsid: batch-11's `perl -e 'setpgrp(0, 0)'`), stdin
 * from /dev/null, its output to pipes or to the fd of its log (opened through io.ts, the one fs seam: nothing here
 * opens a file), never to the terminal. So the terminal's Ctrl-C reaches the
 * runner alone: a probe is stopped by the runner (abort.ts), a restore is not stopped at all — a second Ctrl-C cannot
 * kill it (batch-11's restore child ran in the batch's foreground group and died of one). And a group can be ended
 * whole, grandchildren too: src/adapters/exec.ts kills only the direct child.
 */

export interface StartOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * An fd the child's stdout and stderr go to as it runs: a log opened for append through io.ts (bounded.ts), which
   * the caller closes after start — the child holds its own copy.
   */
  logFd?: number;
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
  /** Settles when its leader has ended, or when it never started. Never rejects. */
  exited: Promise<Ended>;
  /** Settles when its stdout and stderr have closed — never while a grandchild still holds them. */
  closed: Promise<void>;
  /** What it wrote to stdout and stderr so far, when not to a log. */
  out(): string;
  err(): string;
  /** Stop reading its pipes (a grandchild holds them open); `closed` then settles. */
  release(): void;
}

/** What a group kill did: delivered; no group left to deliver to; or not delivered, and the error's code. */
export type KillResult = 'sent' | 'gone' | { notSent: string };

/** What the runner takes instead of the default exits: SIGINT, SIGTERM, SIGHUP; an uncaught exception or rejection. */
export interface Handlers {
  signal(name: NodeJS.Signals): void;
  fatal(error: unknown): void;
}

export interface ProcessSeam {
  /** Start `cmd` in a process group of its own, stdin /dev/null. */
  start(cmd: string, args: readonly string[], options: StartOptions): Started;
  /**
   * Send `signal` to the whole group `pid` leads. Never throws: `'sent'`; `'gone'` when no such group is left
   * (ESRCH); else not sent and why (EPERM: delivery not proven — bounded.ts tries once more). Signal 0 sends nothing:
   * it only asks whether the group still exists.
   */
  killGroup(pid: number, signal: NodeJS.Signals | 0): KillResult;
  /**
   * Route the abort signals and the fatal errors to `handlers`, replacing their default exits — a listener on SIGINT
   * is what ignoring it means in Node (zsh's `trap '' INT` once the handler ignores it). And drop errors on stdout and
   * stderr: an EPIPE there (the reader gone) is no fatal error. SIGPIPE itself Node ignores already (`trap '' PIPE`).
   */
  install(handlers: Handlers): void;
  /** End the runner with `code`. Called once, after the abort has put back what it could. */
  exit(code: number): void;
  /** The last place to say something when the run's own files cannot be written. Never throws. */
  stderr(text: string): void;
}

/** The signals that abort a run: a Ctrl-C, a kill, a closed terminal (`trap on_abort INT TERM HUP`). */
export const ABORT_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;


function notStarted(error: unknown): Started {
  const exited = Promise.resolve({ code: null, signal: null, error: messageOf(error) });
  return { pid: undefined, exited, closed: Promise.resolve(), out: () => '', err: () => '', release: () => {} };
}

function startedOf(child: ChildProcess): Started {
  let [out, err] = ['', ''];
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (err += d.toString()));
  const exited = new Promise<Ended>((resolve) => {
    child.once('error', (e) => resolve({ code: null, signal: null, error: e.message }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const closed = new Promise<void>((resolve) => {
    child.once('error', () => resolve());
    child.once('close', () => resolve());
  });
  const release = () => {
    child.stdout?.destroy();
    child.stderr?.destroy();
  };
  return { pid: child.pid, exited, closed, out: () => out, err: () => err, release };
}

/** The real seam. */
export const nodeProcess: ProcessSeam = {
  start(cmd, args, { cwd, env, logFd }) {
    try {
      const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', logFd ?? 'pipe', logFd ?? 'pipe'] });
      // No such command: no pid, and its 'error' settles `exited`.
      return startedOf(child);
    } catch (e) {
      return notStarted(e);
    }
  },
  killGroup(pid, signal) {
    try {
      process.kill(-pid, signal);
      return 'sent';
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      return code === 'ESRCH' ? 'gone' : { notSent: code ?? messageOf(e) };
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
  stderr(text) {
    try {
      writeSync(2, text);
    } catch {
      // stderr gone too: nothing is left to say it with
    }
  },
};
