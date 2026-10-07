import { execFile } from 'node:child_process';

/** stdout stays a Buffer — screenshots come through this path as binary PNG. */
export interface ExecResult {
  stdout: Buffer;
  stderr: string;
}

export interface ExecOptions {
  timeoutMs?: number;
  /** Written to the child's stdin, then stdin is closed. */
  stdin?: string;
  /** Merged over process.env for the child. */
  env?: Record<string, string>;
}

export type ExecFn = (cmd: string, args: string[], opts?: ExecOptions) => Promise<ExecResult>;

export class ExecError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
    readonly timedOut: boolean = false,
    /**
     * What the failed command printed to stdout. xcodebuild-style tools put
     * their diagnostics THERE (stderr carries little more than the "BUILD
     * FAILED" trailer) — callers that persist failure logs need both streams.
     */
    readonly stdout: Buffer = Buffer.alloc(0),
    /**
     * A line a reader of the failure adds to the message (android-start.ts's
     * monkey stdout tail), and the error it re-reads as `cause`. It is given
     * HERE, to a new error, never appended to a thrown one's `message`: V8
     * writes `stack`'s header once, at construction, so a message extended
     * afterwards is missing from every logged stack (code review, 2026-10-07).
     */
    options: { note?: string; cause?: unknown } = {},
  ) {
    super(
      (timedOut
        ? `Command timed out: ${command}`
        : `Command failed (exit ${exitCode}): ${command}\n${stderr.trim()}`) +
        (options.note === undefined ? '' : `\n${options.note}`),
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'ExecError';
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 64 * 1024 * 1024; // screenshots can be several MB

export const exec: ExecFn = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      {
        encoding: 'buffer',
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        killSignal: 'SIGKILL',
        env: opts.env ? { ...process.env, ...opts.env } : undefined,
      },
      (err, stdout, stderr) => {
        const stderrText = stderr.toString('utf8');
        if (err) {
          const command = [cmd, ...args].join(' ');
          const timedOut = err.killed === true || err.signal === 'SIGKILL';
          const exitCode = typeof err.code === 'number' ? err.code : null;
          reject(new ExecError(command, exitCode, stderrText || err.message, timedOut, stdout));
        } else {
          resolve({ stdout, stderr: stderrText });
        }
      },
    );
    if (opts.stdin !== undefined) child.stdin?.end(opts.stdin);
  });
