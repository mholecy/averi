import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { constants } from 'node:fs';
import { access, open } from 'node:fs/promises';
import { delimiter, isAbsolute, join, basename } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { IDB_HELPER_SCRIPT } from './idb-helper-script.js';

/**
 * What the helper answered for one argv: the CLI's exit code and its two streams, as the `idb` process would have
 * printed them — or why it did not:
 * - `died`: the helper went away with the request written to it (crashed, was killed, disposed). It may have run it —
 *   a read is retried on the CLI, an input is not (D7b, runIdb: the HID event may have reached the simulator).
 * - `unsent`: writing the request failed (a pipe with no reader — the helper had exited): it never reached the helper,
 *   and the caller runs the CLI, input or not.
 * A timeout is neither: it rejects (IdbHelperTimeout).
 */
export type IdbHelperReply = { kind: 'answer'; code: number; stdout: Buffer; stderr: string } | { kind: 'died' } | { kind: 'unsent' };

/** The caller's timeout ran out with the request in the helper: the helper was killed, and nothing is retried. */
export class IdbHelperTimeout extends Error {
  constructor(argv: readonly string[]) {
    super(`idb helper timed out: idb ${argv.join(' ')}`);
    this.name = 'IdbHelperTimeout';
  }
}

/** node's spawn, or a test's fake child (wda.ts has a SpawnFn of its own, for xcodebuild). */
export type IdbHelperSpawn = (cmd: string, args: readonly string[], opts: SpawnOptions) => ChildProcess;

export interface IdbHelperOptions {
  /** node's spawn unless a test hands in a fake child speaking the protocol. */
  spawn?: IdbHelperSpawn;
  /** The Python that runs idb, from the env the helper starts in; idbInterpreter unless a test hands one in. */
  interpreter?: (env: NodeJS.ProcessEnv) => Promise<IdbInterpreter | undefined>;
  /** How long a start may take to say `ready` before it counts as failed (READY_TIMEOUT_MS). */
  readyTimeoutMs?: number;
  /** Where the one line goes when the helper turns itself off: the server's stderr unless a test hands one in. */
  log?: (line: string) => void;
}

/** The interpreter idb's script runs under, and the script's own path (argparse's `prog`). */
export interface IdbInterpreter {
  python: string;
  idb: string;
}

/** `AVERI_IDB_HELPER=off`: no helper — every idb call is the CLI, as before D7 (SETUP.md, troubleshooting). */
export function idbHelperDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AVERI_IDB_HELPER === 'off';
}

/**
 * After this many failures in a row the helper is off for the process. A failure is:
 * - a start that never said `ready`;
 * - a helper that died before it answered any request — one that says ready and then dies under every request would
 *   otherwise restart forever (review 2026-10-31, MINOR-4).
 * The first answered request resets the count. Timeouts have a latch of their own: TIMEOUTS_IN_A_ROW.
 */
export const MAX_FAILURES_IN_A_ROW = 2;

/**
 * After this many requests in a row timed out in the helper, with no answer between, it is off for the process (review
 * round 2, NIT-B): each costs the caller's whole budget (15 s for describe-all), and a helper that hangs would make
 * every read pay it forever. One alone is not: the CLI would likely have timed out too (a stuck companion), and the
 * next helper may answer. Any answer resets the count.
 */
export const TIMEOUTS_IN_A_ROW = 2;

/** How much of the helper's own stderr is kept, to say why it turned itself off. */
const STDERR_TAIL = 2_000;

/**
 * Every live helper child in the process, for the ONE `process.once('exit')` backstop all helpers share (review
 * 2026-10-31, MINOR-3: a hook per helper would pass node's 10-listener warning with the 11th simulator).
 */
const liveChildren = new Set<ChildProcess>();
let exitHookInstalled = false;

/** SIGKILL, and nothing if it is gone already. */
function killChild(child: ChildProcess): void {
  try {
    child.kill('SIGKILL');
  } catch {
    // already gone
  }
}

/** The backstop: kill every helper child dispose did not reach. Exported for its test. */
export function killIdbHelpersOnExit(): void {
  for (const child of liveChildren) killChild(child);
  liveChildren.clear();
}

/**
 * How long a start may take to say `ready`. The import measured ~90 ms (D7); a start ten seconds in is not a slow
 * import but a stuck one, and is killed and counted as failed — the calls meanwhile went to the CLI anyway.
 */
export const READY_TIMEOUT_MS = 10_000;

/**
 * The `idb` on PATH as exec would run it, and the Python its shebang names (D7a): `#!/abs/python…` as is,
 * `#!/usr/bin/env python…` through PATH. Anything else — a binary idb, a shell wrapper, a shebang with arguments, a
 * name that is not a Python — is no helper: running the CLI's import under a guessed interpreter could only fail, or
 * worse, import another fb-idb than the one the CLI runs. undefined: no helper; the CLI serves every call.
 */
export async function idbInterpreter(env: NodeJS.ProcessEnv): Promise<IdbInterpreter | undefined> {
  const idb = await onPath('idb', env.PATH);
  if (idb === undefined) return undefined;
  const head = await firstLine(idb);
  if (head === undefined || !head.startsWith('#!')) return undefined;
  const words = head.slice(2).trim().split(/\s+/);
  const isPython = (p: string) => /^python[0-9.]*$/.test(basename(p));
  if (words.length === 1 && isAbsolute(words[0]) && isPython(words[0])) return { python: words[0], idb };
  if (words.length === 2 && words[0] === '/usr/bin/env' && isPython(words[1])) {
    const python = await onPath(words[1], env.PATH);
    return python === undefined ? undefined : { python, idb };
  }
  return undefined;
}

async function onPath(name: string, path: string | undefined): Promise<string | undefined> {
  for (const dir of (path ?? '').split(delimiter)) {
    if (dir === '') continue;
    const candidate = join(dir, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return undefined;
}

async function firstLine(file: string): Promise<string | undefined> {
  try {
    const fh = await open(file, 'r');
    try {
      const buf = Buffer.alloc(512);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      return buf.subarray(0, bytesRead).toString('latin1').split('\n')[0];
    } finally {
      await fh.close();
    }
  } catch {
    return undefined;
  }
}

interface Pending {
  id: number;
  resolve: (r: IdbHelperReply) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * One persistent fb-idb client per adapter — at most one live per simulator: a wda adapter never starts its helper
 * (D7, docs/adr/0032-a-persistent-idb-helper-runs-the-cli-in-process.md): a Python process that imported idb's CLI
 * once and runs it in-process per request (idb-helper-script.ts), so a call no longer pays the CLI's Python start-up
 * — measured 114.3 → 24.7 ms a `describe-all` (D7, n = 20, the lab simulator). Created by the registry per iOS adapter
 * (registry.ts#iosAdapterFor) and shared, like `exec`, by IosAdapter and IdbTreeSource; runIdb (idb.ts) decides which
 * argv may come here.
 *
 * Its whole contract is that it is never worse than the CLI:
 * - `run` answers undefined — "use the CLI" — whenever it is not READY and idle: not started yet (it starts now, in
 *   the background: the first call pays nothing extra), starting, busy with another request (concurrent reads of an
 *   iOS leg), off (the kill switch, MAX_FAILURES_IN_A_ROW failures or TIMEOUTS_IN_A_ROW timeouts in a row, no
 *   interpreter, disposed). Turning itself off writes one line to the server's stderr, with the tail of the helper's
 *   own.
 * - A helper that dies under a request answers `died` — the caller retries a read on the CLI and reports an input
 *   (D7b, idb.ts#inputLost); one whose request could not be written answers `unsent`, and the caller runs the CLI. The
 *   next call starts a new one.
 * - The caller's timeout kills it (SIGKILL) and rejects with IdbHelperTimeout; the caller throws the CLI's timeout.
 * - No orphans: the child and its pipes are unref'd (the server stays free to exit), it exits on stdin's EOF (dispose,
 *   or node's death closing the pipe), dispose() kills it, and one `process.once('exit')` hook for all helpers
 *   (killIdbHelpersOnExit) kills it as the backstop for anything dispose did not reach — the pattern of WdaServer
 *   (wda.ts, spawnChild).
 */
export class IdbHelper {
  private readonly spawn: IdbHelperSpawn;
  private readonly interpreter: (env: NodeJS.ProcessEnv) => Promise<IdbInterpreter | undefined>;
  private readonly readyTimeoutMs: number;
  private readonly log: (line: string) => void;
  private state: 'idle' | 'starting' | 'ready' | 'busy' | 'off' = 'idle';
  private child: ChildProcess | undefined;
  /** The child this helper killed on purpose (a timeout): its death is not counted as a failure. */
  private killed: ChildProcess | undefined;
  private pending: Pending | undefined;
  private failures = 0;
  /** Requests that timed out since the last answer (TIMEOUTS_IN_A_ROW). */
  private timeoutsInARow = 0;
  private nextId = 1;
  private stderrTail = '';

  constructor(opts: IdbHelperOptions = {}) {
    this.spawn = opts.spawn ?? nodeSpawn;
    this.interpreter = opts.interpreter ?? idbInterpreter;
    this.readyTimeoutMs = opts.readyTimeoutMs ?? READY_TIMEOUT_MS;
    this.log = opts.log ?? ((line) => void process.stderr.write(line + '\n'));
  }

  /**
   * Run one idb argv (the `--udid` included) in the helper, or undefined: run it on the CLI. `env` is what exec merges
   * over process.env (the Xcode env); the helper is started with it, so its idb sees what the CLI's would.
   */
  run(argv: readonly string[], opts: { env?: Record<string, string>; timeoutMs: number }): Promise<IdbHelperReply> | undefined {
    if (idbHelperDisabled()) return undefined;
    if (this.state === 'idle') {
      void this.start(opts.env);
      return undefined;
    }
    if (this.state !== 'ready' || this.child === undefined) return undefined;
    const child = this.child;
    // Exited, its 'exit' not run yet (D7b): nothing is sent, the CLI serves; gone() restarts it on the next call.
    if (child.exitCode != null || child.signalCode != null || child.stdin?.writable !== true) return undefined;
    this.state = 'busy';
    const id = this.nextId++;
    return new Promise<IdbHelperReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        this.timeoutsInARow++;
        this.killed = child;
        this.kill(child);
        reject(new IdbHelperTimeout(argv));
      }, opts.timeoutMs);
      this.pending = { id, resolve, reject, timer };
      // A failed write never reached the helper: `unsent` (D7b — an input then runs on the CLI). The helper is killed,
      // if it is not gone already; its exit finds no pending request. A write that succeeded only says the line is in
      // the pipe: a death after it is `died` (gone()), however far the helper got.
      (child.stdin as Writable).write(JSON.stringify({ id, argv }) + '\n', (err) => {
        if (err == null || this.pending?.id !== id) return;
        clearTimeout(timer);
        this.pending = undefined;
        this.kill(child);
        resolve({ kind: 'unsent' });
      });
    });
  }

  /** Kill the helper and keep it off: the adapter is gone. Idempotent. */
  dispose(): Promise<void> {
    const child = this.child;
    this.state = 'off';
    if (child !== undefined) this.kill(child);
    return Promise.resolve();
  }

  private async start(env: Record<string, string> | undefined): Promise<void> {
    this.state = 'starting';
    const childEnv = { ...process.env, ...env };
    let interpreter: IdbInterpreter | undefined;
    try {
      interpreter = await this.interpreter(childEnv);
    } catch {
      interpreter = undefined;
    }
    if (this.state !== 'starting') return; // disposed meanwhile
    if (interpreter === undefined) {
      // No interpreter now is no interpreter later: the PATH does not change under a running server.
      this.turnOff('the `idb` on PATH names no Python interpreter in its shebang');
      return;
    }
    let child: ChildProcess;
    try {
      // No -I: the import must see what the shebang'd CLI sees (idb-helper-script.ts, the bootstrap).
      child = this.spawn(interpreter.python, ['-c', IDB_HELPER_SCRIPT, interpreter.idb], {
        env: childEnv,
        stdio: ['pipe', 'ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      this.failed(`spawn failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    this.child = child;
    liveChildren.add(child);
    if (!exitHookInstalled) {
      exitHookInstalled = true;
      process.once('exit', killIdbHelpersOnExit);
    }
    let ready = false;
    let answered = false;
    const readyTimer = setTimeout(() => {
      if (!ready) this.kill(child);
    }, this.readyTimeoutMs);
    readyTimer.unref();
    child.unref();
    for (const s of [child.stdin, child.stderr, child.stdio[3]]) (s as unknown as { unref?: () => void } | null)?.unref?.();
    this.stderrTail = '';
    child.stderr?.on('data', (d: Buffer) => {
      if (this.child === child) this.stderrTail = (this.stderrTail + d.toString('utf8')).slice(-STDERR_TAIL);
    });
    // ENOENT and friends arrive as an 'error' event; with no listener it would take the server down.
    const onGone = () => {
      clearTimeout(readyTimer);
      this.gone(child, ready, answered);
    };
    child.once('error', onGone);
    child.once('exit', onGone);
    child.stdin?.on('error', () => undefined); // EPIPE on a dead helper: 'exit' tells the story
    const lines = createInterface({ input: child.stdio[3] as Readable });
    lines.on('line', (line) => {
      let msg: { ready?: number; id?: number; code?: number; stdout?: string; stderr?: string };
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (this.child !== child) return;
      if (!ready && msg.ready !== undefined) {
        ready = true;
        clearTimeout(readyTimer);
        if (this.state === 'starting') this.state = 'ready';
        return;
      }
      const p = this.pending;
      if (p === undefined || msg.id !== p.id) return;
      clearTimeout(p.timer);
      this.pending = undefined;
      answered = true;
      this.failures = 0;
      this.timeoutsInARow = 0;
      if (this.state === 'busy') this.state = 'ready';
      // The streams come as base64 of their bytes (idb-helper-script.ts): stdout a Buffer, stderr utf-8 — exec's decoding.
      p.resolve({ kind: 'answer', code: msg.code ?? 1, stdout: Buffer.from(msg.stdout ?? '', 'base64'), stderr: Buffer.from(msg.stderr ?? '', 'base64').toString('utf8') });
    });
  }

  /**
   * The child exited (or failed to spawn). A start that never said ready, or a helper that never answered, counts
   * against it (MAX_FAILURES_IN_A_ROW); one this helper killed on a timeout turns it off at TIMEOUTS_IN_A_ROW.
   */
  private gone(child: ChildProcess, wasReady: boolean, answered: boolean): void {
    liveChildren.delete(child);
    if (this.child !== child) return;
    this.child = undefined;
    const p = this.pending;
    if (p !== undefined) {
      clearTimeout(p.timer);
      this.pending = undefined;
      p.resolve({ kind: 'died' });
    }
    if (this.state === 'off') return;
    if (this.killed === child) {
      this.killed = undefined;
      if (this.timeoutsInARow >= TIMEOUTS_IN_A_ROW) this.turnOff(`${this.timeoutsInARow} requests in a row timed out`);
      else this.state = 'idle';
    } else if (!wasReady) this.failed('it exited before it said ready');
    else if (!answered) this.failed('it died before it answered a request');
    else this.state = 'idle';
  }

  private failed(why: string): void {
    this.failures++;
    if (this.failures >= MAX_FAILURES_IN_A_ROW) this.turnOff(`${this.failures} failures in a row, the last: ${why}`);
    else this.state = 'idle';
  }

  /** Off for the process, said once on the server's stderr: why, and the tail of the helper's own stderr. */
  private turnOff(why: string): void {
    this.state = 'off';
    const tail = this.stderrTail.trim().split('\n').slice(-3).join(' | ');
    this.log(`averi: idb helper off for this process (${why}) — the idb CLI serves every call${tail ? `; its stderr: ${tail}` : ''}`);
  }

  private kill(child: ChildProcess): void {
    killChild(child);
  }
}
