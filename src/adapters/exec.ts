import { execFile } from 'node:child_process';

/** stdout stays a Buffer — screenshots come through this path as binary PNG. */
export interface ExecResult {
  stdout: Buffer;
  stderr: string;
}

export interface ExecOptions {
  timeoutMs?: number;
}

export type ExecFn = (cmd: string, args: string[], opts?: ExecOptions) => Promise<ExecResult>;

export class ExecError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
    readonly timedOut: boolean = false,
  ) {
    super(
      timedOut
        ? `Command timed out: ${command}`
        : `Command failed (exit ${exitCode}): ${command}\n${stderr.trim()}`,
    );
    this.name = 'ExecError';
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 64 * 1024 * 1024; // screenshots can be several MB

export const exec: ExecFn = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        encoding: 'buffer',
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        killSignal: 'SIGKILL',
      },
      (err, stdout, stderr) => {
        const stderrText = stderr.toString('utf8');
        if (err) {
          const command = [cmd, ...args].join(' ');
          const timedOut = err.killed === true || err.signal === 'SIGKILL';
          const exitCode = typeof err.code === 'number' ? err.code : null;
          reject(new ExecError(command, exitCode, stderrText || err.message, timedOut));
        } else {
          resolve({ stdout, stderr: stderrText });
        }
      },
    );
  });
