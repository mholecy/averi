import { EventEmitter } from 'node:events';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecError, type ExecFn } from '../../src/adapters/exec.js';
import { runIdb } from '../../src/adapters/idb.js';
import { IdbHelper, idbInterpreter, killIdbHelpersOnExit, MAX_FAILURES_IN_A_ROW, type IdbHelperSpawn } from '../../src/adapters/idb-helper.js';
import { IosAdapter } from '../../src/adapters/ios.js';
import { createIosTreeSource } from '../../src/adapters/ios-tree-source.js';

// IdbHelper (D7a) through runIdb, the one door every idb call takes: a fake child speaking the helper's protocol
// (requests on stdin, `ready` and replies on fd 3) stands in for Python; a fake exec stands in for the CLI. What is
// checked is what a caller sees — which of the two answered, and the error text — never the helper's state.

const UDID = 'D8DACDE6-6352-437C-AA22-86FB06275C3F';
const READ = ['ui', 'describe-all', '--json'];
const CLI_ARGV = [...READ, '--udid', UDID];

/** A child process speaking the helper's protocol, driven by the test. */
class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly fd3 = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdio = [this.stdin, null, this.stderr, this.fd3];
  readonly requests: { id: number; argv: string[] }[] = [];
  readonly signals: string[] = [];
  unrefed = false;
  constructor() {
    super();
    let buf = '';
    this.stdin.on('data', (d: Buffer) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        this.requests.push(JSON.parse(buf.slice(0, nl)));
        buf = buf.slice(nl + 1);
      }
    });
  }
  unref() {
    this.unrefed = true;
  }
  kill(signal: string) {
    this.signals.push(signal);
    queueMicrotask(() => {
      this.emit('exit', null, signal);
      this.fd3.end();
    });
    return true;
  }
  ready() {
    this.fd3.write(JSON.stringify({ ready: 1 }) + '\n');
  }
  answer(code: number, stdout: string, stderr = '') {
    const { id } = this.requests.at(-1)!;
    const b64 = (t: string) => Buffer.from(t).toString('base64');
    this.fd3.write(JSON.stringify({ id, code, stdout: b64(stdout), stderr: b64(stderr) }) + '\n');
  }
  /** The helper took the last request off stdin (`{"got": id}`, D7b): gen_main runs it next. */
  ack(id = this.requests.at(-1)!.id) {
    this.fd3.write(JSON.stringify({ got: id }) + '\n');
  }
  /** It exits: node sees the exit, then fd 3's end — the order node gives no promise about either way. */
  die() {
    this.exitOnly();
    this.fd3.end();
  }
  /** It exits, and something else still holds fd 3 open (a grandchild): its end never comes. */
  exitOnly() {
    this.exitCode = 1;
    this.emit('exit', 1, null);
  }
  /** node's view of a child that has exited, before its 'exit' event has run. */
  exitCode: number | null = null;
  signalCode: string | null = null;
  exitedUnseen() {
    this.exitCode = 1;
  }
  /** Every later write to stdin fails as a write to a pipe with no reader does — nothing reaches the helper. */
  breakPipe() {
    (this.stdin as unknown as { _write: (c: unknown, e: unknown, cb: (err: Error) => void) => void })._write = (_c, _e, cb) =>
      cb(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
  }
}

/** A spawn that hands out fresh fake children and remembers them. */
function fakeSpawn() {
  const children: FakeChild[] = [];
  const calls: { cmd: string; args: readonly string[] }[] = [];
  const spawn: IdbHelperSpawn = (cmd, args) => {
    calls.push({ cmd, args });
    const c = new FakeChild();
    children.push(c);
    return c as unknown as ChildProcess;
  };
  return { spawn, children, calls };
}

/** An exec that answers idb with `cli` and remembers each call; the Xcode probe (xcrun --find) succeeds. */
function fakeExec(answer: () => Promise<Buffer> = async () => Buffer.from('cli')) {
  const idbCalls: string[][] = [];
  const exec: ExecFn = async (cmd, args) => {
    if (cmd === 'xcrun') return { stdout: Buffer.from(''), stderr: '' };
    idbCalls.push(args);
    return { stdout: await answer(), stderr: '' };
  };
  return { exec, idbCalls };
}

const interpreter = async () => ({ python: '/abs/python3', idb: '/abs/idb' });
/** Let the helper's start (an awaited interpreter lookup, then spawn) and its stream events run. */
const settle = () => new Promise((r) => setTimeout(r, 5));

/** What the helpers said on the server's stderr. */
let logged: string[] = [];
const log = (line: string) => void logged.push(line);

let savedDeveloperDir: string | undefined;
beforeEach(() => {
  logged = [];
  savedDeveloperDir = process.env.DEVELOPER_DIR;
  process.env.DEVELOPER_DIR = '/fake/Developer'; // the Xcode probe answers without exec
  delete process.env.AVERI_IDB_HELPER;
});
afterEach(() => {
  if (savedDeveloperDir === undefined) delete process.env.DEVELOPER_DIR;
  else process.env.DEVELOPER_DIR = savedDeveloperDir;
  delete process.env.AVERI_IDB_HELPER;
});

/** A helper whose first child has said ready. */
async function readyHelper() {
  const s = fakeSpawn();
  const helper = new IdbHelper({ spawn: s.spawn, interpreter, log });
  const cli = fakeExec();
  await runIdb(cli.exec, UDID, READ, { helper }); // starts it
  await settle();
  s.children[0].ready();
  await settle();
  return { helper, s, cli };
}

/** One read that times out in the helper, then the call that starts the next helper, which says ready. */
async function timeOutAndRestart(h: { helper: IdbHelper; s: ReturnType<typeof fakeSpawn>; cli: ReturnType<typeof fakeExec> }) {
  const got = await runIdb(h.cli.exec, UDID, READ, { helper: h.helper, timeoutMs: 10 }).catch((e: unknown) => e);
  expect(got).toBeInstanceOf(ExecError);
  await settle();
  await runIdb(h.cli.exec, UDID, READ, { helper: h.helper }); // starts the next, if it is not off
  await settle();
  h.s.children.at(-1)!.ready();
  await settle();
}

describe('runIdb with an IdbHelper', () => {
  it('runs the CLI until the helper is ready — the first call starts it and pays nothing', async () => {
    const s = fakeSpawn();
    const helper = new IdbHelper({ spawn: s.spawn, interpreter, log });
    const cli = fakeExec();
    const first = await runIdb(cli.exec, UDID, READ, { helper });
    expect(first.stdout.toString()).toBe('cli');
    await settle();
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].cmd).toBe('/abs/python3');
    expect(s.calls[0].args[0]).toBe('-c');
    expect(s.calls[0].args.at(-1)).toBe('/abs/idb');
    const second = await runIdb(cli.exec, UDID, READ, { helper }); // started, not ready
    expect(second.stdout.toString()).toBe('cli');
    expect(cli.idbCalls).toEqual([CLI_ARGV, CLI_ARGV]);
    expect(s.children[0].requests).toEqual([]);
  });

  it('serves a read from the helper once it is ready, with the CLI argv, the --udid last', async () => {
    const { helper, s, cli } = await readyHelper();
    const read = runIdb(cli.exec, UDID, READ, { helper });
    await settle();
    expect(s.children[0].requests).toEqual([{ id: 1, argv: CLI_ARGV }]);
    s.children[0].answer(0, '[{"type":"Application"}]');
    expect((await read).stdout.toString()).toBe('[{"type":"Application"}]');
    expect(cli.idbCalls).toEqual([CLI_ARGV]); // the starting call only
  });

  it.each([
    ['the viewport read', ['describe', '--json']],
    ['a tap short of a coordinate', ['ui', 'tap', '10']],
    ['a coordinate that is no plain decimal', ['ui', 'tap', '1e3', '20']],
    ['a button averi never presses', ['ui', 'button', 'SIRI']],
    ['an empty key sequence', ['ui', 'key-sequence']],
    ['a key sequence with a word that is no number', ['ui', 'key-sequence', '42', 'x']],
    ['a read with a flag more', ['ui', 'describe-all', '--json', '--nested']],
  ])('sends a call it does not allowlist to the CLI — %s', async (_, args) => {
    const { helper, s, cli } = await readyHelper();
    await runIdb(cli.exec, UDID, args, { helper });
    expect(cli.idbCalls.at(-1)).toEqual([...args, '--udid', UDID]);
    expect(s.children[0].requests).toEqual([]);
  });

  it('sends a read to the CLI while the helper is busy with another', async () => {
    const { helper, s, cli } = await readyHelper();
    const first = runIdb(cli.exec, UDID, READ, { helper });
    await settle();
    const second = await runIdb(cli.exec, UDID, READ, { helper });
    expect(second.stdout.toString()).toBe('cli');
    s.children[0].answer(0, 'helper');
    expect((await first).stdout.toString()).toBe('helper');
    expect(s.children[0].requests).toHaveLength(1);
  });

  it('throws on a nonzero code the same ExecError exec builds for the CLI failing alike', async () => {
    const { helper, s, cli } = await readyHelper();
    const stderr = "Failed to connect to companion at address TCPAddress(host='localhost', port=1)\n";
    const read = runIdb(cli.exec, UDID, READ, { helper });
    await settle();
    s.children[0].answer(1, '', stderr);
    const got = await read.catch((e: unknown) => e);
    // What exec.ts builds from execFile's error for `idb <argv>` exiting 1 with this stderr.
    const want = new ExecError(['idb', ...CLI_ARGV].join(' '), 1, stderr);
    expect(got).toBeInstanceOf(ExecError);
    expect((got as ExecError).message).toBe(want.message);
    expect((got as ExecError).message).toBe(`Command failed (exit 1): idb ui describe-all --json --udid ${UDID}\n${stderr.trim()}`);
    expect((got as ExecError).exitCode).toBe(1);
  });

  it('retries a read on the CLI when the helper dies under it, and starts a new helper on the next call', async () => {
    const { helper, s, cli } = await readyHelper();
    const read = runIdb(cli.exec, UDID, READ, { helper });
    await settle();
    s.children[0].die();
    expect((await read).stdout.toString()).toBe('cli');
    expect(cli.idbCalls).toEqual([CLI_ARGV, CLI_ARGV]);
    await runIdb(cli.exec, UDID, READ, { helper });
    await settle();
    expect(s.children).toHaveLength(2);
  });

  it('kills the helper on the caller\'s timeout and throws the CLI\'s timeout text, not retried', async () => {
    const { helper, s, cli } = await readyHelper();
    const got = await runIdb(cli.exec, UDID, READ, { helper, timeoutMs: 20 }).catch((e: unknown) => e);
    expect(got).toBeInstanceOf(ExecError);
    expect((got as ExecError).timedOut).toBe(true);
    expect((got as ExecError).message).toBe(`Command timed out: idb ui describe-all --json --udid ${UDID}`);
    expect(s.children[0].signals).toEqual(['SIGKILL']);
    expect(cli.idbCalls).toEqual([CLI_ARGV]); // the starting call only
  });

  it('turns itself off after two starts that never said ready', async () => {
    const s = fakeSpawn();
    const helper = new IdbHelper({ spawn: s.spawn, interpreter, log });
    const cli = fakeExec();
    for (let i = 0; i < MAX_FAILURES_IN_A_ROW; i++) {
      await runIdb(cli.exec, UDID, READ, { helper });
      await settle();
      s.children[i].die();
      await settle();
    }
    for (let i = 0; i < 3; i++) await runIdb(cli.exec, UDID, READ, { helper });
    await settle();
    expect(s.children).toHaveLength(MAX_FAILURES_IN_A_ROW);
    expect(cli.idbCalls).toHaveLength(MAX_FAILURES_IN_A_ROW + 3);
  });

  it('never starts with AVERI_IDB_HELPER=off', async () => {
    process.env.AVERI_IDB_HELPER = 'off';
    const s = fakeSpawn();
    const helper = new IdbHelper({ spawn: s.spawn, interpreter, log });
    const cli = fakeExec();
    await runIdb(cli.exec, UDID, READ, { helper });
    await settle();
    expect(s.calls).toEqual([]);
    expect(cli.idbCalls).toEqual([CLI_ARGV]);
  });

  it('starts no helper when idb\'s interpreter is unknown', async () => {
    const s = fakeSpawn();
    const helper = new IdbHelper({ spawn: s.spawn, interpreter: async () => undefined, log });
    const cli = fakeExec();
    await runIdb(cli.exec, UDID, READ, { helper });
    await settle();
    await runIdb(cli.exec, UDID, READ, { helper });
    await settle();
    expect(s.calls).toEqual([]);
  });

  it('unrefs the child, kills it on dispose and stays off after', async () => {
    const { helper, s, cli } = await readyHelper();
    expect(s.children[0].unrefed).toBe(true);
    await helper.dispose();
    expect(s.children[0].signals).toEqual(['SIGKILL']);
    await runIdb(cli.exec, UDID, READ, { helper });
    await settle();
    expect(s.children).toHaveLength(1);
    expect(cli.idbCalls.at(-1)).toEqual(CLI_ARGV);
  });

  it('kills every child on process exit through ONE hook, however many helpers — the backstop for a dispose that never came', async () => {
    const hooks = () => process.listeners('exit').filter((l) => l === killIdbHelpersOnExit).length;
    const helpers = await Promise.all(Array.from({ length: 11 }, () => readyHelper()));
    expect(hooks()).toBe(1);
    expect(process.listenerCount('exit')).toBeLessThan(11);
    killIdbHelpersOnExit();
    for (const { s } of helpers) expect(s.children[0].signals).toEqual(['SIGKILL']);
  });

  it('kills a start that never says ready by its deadline, counts it, and the CLI serves meanwhile', async () => {
    const s = fakeSpawn();
    const helper = new IdbHelper({ spawn: s.spawn, interpreter, log, readyTimeoutMs: 20 });
    const cli = fakeExec();
    for (let i = 0; i < MAX_FAILURES_IN_A_ROW; i++) {
      await runIdb(cli.exec, UDID, READ, { helper });
      await new Promise((r) => setTimeout(r, 40));
      expect(s.children[i].signals).toEqual(['SIGKILL']);
    }
    await runIdb(cli.exec, UDID, READ, { helper });
    await settle();
    expect(s.children).toHaveLength(MAX_FAILURES_IN_A_ROW);
    expect(cli.idbCalls).toEqual(Array(MAX_FAILURES_IN_A_ROW + 1).fill(CLI_ARGV));
  });

  it('drops the ready deadline of a start that already exited — nothing is killed after', async () => {
    const s = fakeSpawn();
    const helper = new IdbHelper({ spawn: s.spawn, interpreter, log, readyTimeoutMs: 20 });
    await runIdb(fakeExec().exec, UDID, READ, { helper });
    await settle();
    s.children[0].die();
    await new Promise((r) => setTimeout(r, 40));
    expect(s.children[0].signals).toEqual([]);
  });

  it('turns off a helper that says ready and then dies under every request — it does not restart forever', async () => {
    const s = fakeSpawn();
    const helper = new IdbHelper({ spawn: s.spawn, interpreter, log });
    const cli = fakeExec();
    for (let i = 0; i < MAX_FAILURES_IN_A_ROW; i++) {
      await runIdb(cli.exec, UDID, READ, { helper }); // starts child i
      await settle();
      s.children[i].ready();
      await settle();
      const read = runIdb(cli.exec, UDID, READ, { helper });
      await settle();
      s.children[i].die();
      expect((await read).stdout.toString()).toBe('cli'); // retried on the CLI
    }
    for (let i = 0; i < 3; i++) await runIdb(cli.exec, UDID, READ, { helper });
    await settle();
    expect(s.children).toHaveLength(MAX_FAILURES_IN_A_ROW);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/^averi: idb helper off for this process \(2 failures in a row, the last: it died before it answered a request\)/);
  });

  it('does not count a timeout with an answer after it — a helper that answers between timeouts restarts every time', async () => {
    const h = await readyHelper();
    for (let i = 0; i < 4; i++) {
      await timeOutAndRestart(h);
      const read = runIdb(h.cli.exec, UDID, READ, { helper: h.helper });
      await settle();
      h.s.children.at(-1)!.answer(0, 'helper');
      expect((await read).stdout.toString()).toBe('helper');
    }
    expect(h.s.children).toHaveLength(5);
    expect(logged).toEqual([]);
  });

  it('starts the timeout count afresh after an answer — a timeout after one is a first one again', async () => {
    const h = await readyHelper();
    await timeOutAndRestart(h);
    const read = runIdb(h.cli.exec, UDID, READ, { helper: h.helper });
    await settle();
    h.s.children.at(-1)!.answer(0, 'helper');
    await read;
    // A timeout (first in a row again: no failure), then a start that dies (one failure): not off.
    await runIdb(h.cli.exec, UDID, READ, { helper: h.helper, timeoutMs: 10 }).catch(() => undefined);
    await settle();
    await runIdb(h.cli.exec, UDID, READ, { helper: h.helper });
    await settle();
    h.s.children.at(-1)!.die();
    await settle();
    await runIdb(h.cli.exec, UDID, READ, { helper: h.helper });
    await settle();
    expect(h.s.children).toHaveLength(4);
    expect(logged).toEqual([]);
  });

  it('turns off a helper after two requests in a row time out with no answer between — the CLI then serves', async () => {
    const h = await readyHelper();
    await timeOutAndRestart(h); // one timeout alone: restarted
    expect(h.s.children).toHaveLength(2);
    expect(logged).toEqual([]);
    const got = await runIdb(h.cli.exec, UDID, READ, { helper: h.helper, timeoutMs: 10 }).catch((e: unknown) => e);
    expect((got as ExecError).timedOut).toBe(true);
    await settle();
    const before = h.cli.idbCalls.length;
    expect((await runIdb(h.cli.exec, UDID, READ, { helper: h.helper })).stdout.toString()).toBe('cli');
    await settle();
    expect(h.cli.idbCalls).toHaveLength(before + 1);
    expect(h.s.children).toHaveLength(2);
    expect(logged).toEqual(['averi: idb helper off for this process (2 requests in a row timed out) — the idb CLI serves every call']);
  });

  it('answers a read in flight when the adapter is disposed under it — retried on the CLI', async () => {
    const { helper, s, cli } = await readyHelper();
    const read = runIdb(cli.exec, UDID, READ, { helper });
    await settle();
    expect(s.children[0].requests).toHaveLength(1);
    await helper.dispose();
    expect((await read).stdout.toString()).toBe('cli');
    expect(cli.idbCalls).toEqual([CLI_ARGV, CLI_ARGV]);
  });

  it('says once, on the server\'s stderr, why it turned itself off — with the tail of the helper\'s own stderr', async () => {
    const s = fakeSpawn();
    const helper = new IdbHelper({ spawn: s.spawn, interpreter, log });
    const cli = fakeExec();
    for (let i = 0; i < MAX_FAILURES_IN_A_ROW; i++) {
      await runIdb(cli.exec, UDID, READ, { helper });
      await settle();
      s.children[i].stderr.write("ModuleNotFoundError: No module named 'idb'\n");
      await settle();
      s.children[i].die();
      await settle();
    }
    expect(logged).toEqual([
      "averi: idb helper off for this process (2 failures in a row, the last: it exited before it said ready) — the idb CLI serves every call; its stderr: ModuleNotFoundError: No module named 'idb'",
    ]);
  });
});

// D26b: `idb screenshot -` (the PNG on stdout) is a read — served by the helper, its bytes base64 on fd 3, and a
// helper that dies under it is retried on the CLI. Only that one argv: a file destination, or none, is the CLI's.
describe('runIdb with an IdbHelper — screenshot (D26b)', () => {
  const SHOT = ['screenshot', '-'];

  /** Bytes a PNG may hold and a text protocol would mangle: NUL, newlines, 0xFF, a lone CR — 5 MB of them. */
  function binary(size: number): Buffer {
    const b = Buffer.alloc(size);
    for (let i = 0; i < size; i++) b[i] = [0x00, 0x0a, 0xff, 0x0d, 0x89, i & 0xff][i % 6];
    return b;
  }

  it.each([
    ['a ~170 KB PNG-sized payload', 170_000],
    ['a 5 MB payload', 5 * 1024 * 1024],
  ])('serves `screenshot -` from the helper and hands its stdout back byte-equal — %s', async (_, size) => {
    const { helper, s, cli } = await readyHelper();
    const bytes = binary(size);
    const call = runIdb(cli.exec, UDID, SHOT, { helper });
    await settle();
    expect(s.children[0].requests).toEqual([{ id: 1, argv: [...SHOT, '--udid', UDID] }]);
    const { id } = s.children[0].requests[0];
    s.children[0].fd3.write(JSON.stringify({ id, code: 0, stdout: bytes.toString('base64'), stderr: '' }) + '\n');
    expect((await call).stdout.equals(bytes)).toBe(true);
    expect(cli.idbCalls).toEqual([CLI_ARGV]); // the starting call only
  });

  it.each([
    ['a file destination', ['screenshot', '/tmp/x']],
    ['no destination', ['screenshot']],
    ['a flag more', ['screenshot', '-', '--json']],
  ])('sends a screenshot argv it does not allowlist to the CLI — %s', async (_, args) => {
    const { helper, s, cli } = await readyHelper();
    await runIdb(cli.exec, UDID, args, { helper });
    expect(cli.idbCalls.at(-1)).toEqual([...args, '--udid', UDID]);
    expect(s.children[0].requests).toEqual([]);
  });

  it('retries `screenshot -` on the CLI when the helper dies under it, even after it took it — a read', async () => {
    const { helper, s, cli } = await readyHelper();
    const call = runIdb(cli.exec, UDID, SHOT, { helper });
    await settle();
    s.children[0].ack();
    await settle();
    s.children[0].die();
    expect((await call).stdout.toString()).toBe('cli');
    expect(cli.idbCalls).toEqual([CLI_ARGV, [...SHOT, '--udid', UDID]]);
  });

  it('counts a `screenshot -` timeout toward TIMEOUTS_IN_A_ROW with the reads', async () => {
    const h = await readyHelper();
    const first = await runIdb(h.cli.exec, UDID, SHOT, { helper: h.helper, timeoutMs: 10 }).catch((e: unknown) => e);
    expect((first as ExecError).timedOut).toBe(true);
    expect((first as ExecError).message).toBe(`Command timed out: idb screenshot - --udid ${UDID}`);
    await settle();
    await runIdb(h.cli.exec, UDID, READ, { helper: h.helper }); // starts the next
    await settle();
    h.s.children.at(-1)!.ready();
    await settle();
    await runIdb(h.cli.exec, UDID, READ, { helper: h.helper, timeoutMs: 10 }).catch(() => undefined);
    await settle();
    expect(logged).toEqual(['averi: idb helper off for this process (2 requests in a row timed out) — the idb CLI serves every call']);
  });
});

/**
 * Every HID argv IosAdapter sends (D7b, src/adapters/ios.ts — tap, longPress, swipe, typeText and D24's split, clearText,
 * pressKey), as the adapter builds it.
 */
const HID: readonly (readonly string[])[] = [
  ['ui', 'tap', '120', '640'],
  ['ui', 'tap', '120', '640', '--duration', '0.8'],
  ['ui', 'swipe', '200', '700', '200', '176', '--duration', '0.3'],
  ['ui', 'text', 'Jan Novak Bratislava'],
  ['ui', 'text', 'J'],
  ['ui', 'key-sequence', '42', '42', '42'],
  ['ui', 'key-sequence', '76'],
  ['ui', 'key', '40'],
  ['ui', 'button', 'HOME'],
];

describe('runIdb with an IdbHelper — input (D7b)', () => {
  it.each(HID.map((a) => [a.join(' '), a]))('serves `%s` from the helper once it is ready, the --udid last', async (_, args) => {
    const { helper, s, cli } = await readyHelper();
    const call = runIdb(cli.exec, UDID, [...args], { helper });
    await settle();
    expect(s.children[0].requests).toEqual([{ id: 1, argv: [...args, '--udid', UDID] }]);
    s.children[0].answer(0, '');
    expect((await call).stdout.toString()).toBe('');
    expect(cli.idbCalls).toEqual([CLI_ARGV]); // the starting call only
  });

  it.each([
    ['a lone surrogate (the CLI\'s argv carries U+FFFD, the helper\'s JSON the surrogate)', 'ab\uD83D'],
    ['a NUL (execFile refuses the argv; the helper would type it)', 'a\u0000b'],
  ])('leaves a text the two would type differently to the CLI — %s', async (_, text) => {
    const { helper, s, cli } = await readyHelper();
    await runIdb(cli.exec, UDID, ['ui', 'text', text], { helper });
    expect(s.children[0].requests).toEqual([]);
    expect(cli.idbCalls.at(-1)).toEqual(['ui', 'text', text, '--udid', UDID]);
  });

  it('does NOT retry an input the helper died under — it may have landed — and says so, ExecError-shaped', async () => {
    const { helper, s, cli } = await readyHelper();
    const tap = runIdb(cli.exec, UDID, ['ui', 'tap', '120', '640'], { helper });
    await settle();
    expect(s.children[0].requests).toHaveLength(1); // sent
    s.children[0].ack(); // and taken: gen_main was running it
    await settle();
    s.children[0].die();
    const got = await tap.catch((e: unknown) => e);
    expect(got).toBeInstanceOf(ExecError);
    expect((got as ExecError).message).toBe(
      `Command failed (exit null): idb ui tap 120 640 --udid ${UDID}\n` +
        'the idb helper exited during this input; it may or may not have reached the simulator — look at the screen before repeating it',
    );
    expect((got as ExecError).exitCode).toBeNull();
    expect((got as ExecError).timedOut).toBe(false);
    expect(cli.idbCalls).toEqual([CLI_ARGV]); // the starting call only: no CLI tap
  });

  it('runs an input on the CLI when the helper died before it took the request off stdin — gen_main never ran it', async () => {
    const { helper, s, cli } = await readyHelper();
    const tap = runIdb(cli.exec, UDID, ['ui', 'tap', '120', '640'], { helper });
    await settle();
    expect(s.children[0].requests).toHaveLength(1); // written, never acknowledged
    s.children[0].die();
    expect((await tap).stdout.toString()).toBe('cli');
    expect(cli.idbCalls).toEqual([CLI_ARGV, ['ui', 'tap', '120', '640', '--udid', UDID]]);
  });

  it('reads an acknowledgement that comes after the exit — fd 3 is drained before the input is judged unsent', async () => {
    const { helper, s, cli } = await readyHelper();
    const tap = runIdb(cli.exec, UDID, ['ui', 'tap', '120', '640'], { helper });
    await settle();
    s.children[0].exitOnly();
    s.children[0].ack();
    s.children[0].fd3.end();
    expect(((await tap.catch((e: unknown) => e)) as ExecError).exitCode).toBeNull();
    expect(cli.idbCalls).toEqual([CLI_ARGV]);
  });

  it('reports an input whose fd 3 never ends after the exit — unknown is not unsent', async () => {
    const s = fakeSpawn();
    const helper = new IdbHelper({ spawn: s.spawn, interpreter, log, drainMs: 20 });
    const cli = fakeExec();
    await runIdb(cli.exec, UDID, READ, { helper });
    await settle();
    s.children[0].ready();
    await settle();
    const tap = runIdb(cli.exec, UDID, ['ui', 'tap', '120', '640'], { helper });
    await settle();
    s.children[0].exitOnly();
    expect(((await tap.catch((e: unknown) => e)) as ExecError).exitCode).toBeNull();
    expect(cli.idbCalls).toEqual([CLI_ARGV]);
  });

  it('ignores an acknowledgement of another request — a stale id does not make the pending one taken', async () => {
    const { helper, s, cli } = await readyHelper();
    const read = runIdb(cli.exec, UDID, READ, { helper });
    await settle();
    s.children[0].ack();
    s.children[0].answer(0, 'helper');
    await read;
    const tap = runIdb(cli.exec, UDID, ['ui', 'tap', '120', '640'], { helper });
    await settle();
    s.children[0].ack(1); // the read's id again
    await settle();
    s.children[0].die();
    expect((await tap).stdout.toString()).toBe('cli');
  });

  it('runs an input on the CLI when the helper had already exited before it was sent — its exit not seen yet', async () => {
    const { helper, s, cli } = await readyHelper();
    s.children[0].exitedUnseen();
    await runIdb(cli.exec, UDID, ['ui', 'tap', '120', '640'], { helper });
    expect(s.children[0].requests).toEqual([]);
    expect(cli.idbCalls.at(-1)).toEqual(['ui', 'tap', '120', '640', '--udid', UDID]);
  });

  it('runs an input on the CLI when writing it to the helper failed — a pipe with no reader took none of it', async () => {
    const { helper, s, cli } = await readyHelper();
    s.children[0].breakPipe();
    const text = await runIdb(cli.exec, UDID, ['ui', 'text', 'abc'], { helper });
    expect(text.stdout.toString()).toBe('cli');
    expect(s.children[0].requests).toEqual([]);
    expect(cli.idbCalls).toEqual([CLI_ARGV, ['ui', 'text', 'abc', '--udid', UDID]]);
    s.children[0].die(); // the exit that follows: no second answer, no second CLI call
    await settle();
    expect(cli.idbCalls).toHaveLength(2);
  });

  it('times an input out as a read: killed, the CLI\'s text, not retried — and counted toward TIMEOUTS_IN_A_ROW with reads', async () => {
    const h = await readyHelper();
    await timeOutAndRestart(h); // a read times out: one in a row
    const swipe = ['ui', 'swipe', '200', '700', '200', '176', '--duration', '0.3'];
    const got = await runIdb(h.cli.exec, UDID, swipe, { helper: h.helper, timeoutMs: 10 }).catch((e: unknown) => e);
    expect((got as ExecError).timedOut).toBe(true);
    expect((got as ExecError).message).toBe(`Command timed out: idb ${swipe.join(' ')} --udid ${UDID}`);
    expect(h.s.children[1].signals).toEqual(['SIGKILL']);
    await settle();
    expect(h.cli.idbCalls.filter((a) => a[1] === 'swipe')).toEqual([]); // not retried
    expect(logged).toEqual(['averi: idb helper off for this process (2 requests in a row timed out) — the idb CLI serves every call']);
  });

  it('runs an input the helper never took once on the CLI when the adapter is disposed under it — as a CLI call in flight before D7 would', async () => {
    const { helper, s, cli } = await readyHelper();
    const tap = runIdb(cli.exec, UDID, ['ui', 'tap', '120', '640'], { helper });
    await settle();
    expect(s.children[0].requests).toHaveLength(1); // written, not acknowledged
    await helper.dispose();
    expect((await tap).stdout.toString()).toBe('cli');
    expect(cli.idbCalls).toEqual([CLI_ARGV, ['ui', 'tap', '120', '640', '--udid', UDID]]);
  });

  it('reports an input in flight when the adapter is disposed under it — not retried either', async () => {
    const { helper, s, cli } = await readyHelper();
    const text = runIdb(cli.exec, UDID, ['ui', 'text', 'abc'], { helper });
    await settle();
    s.children[0].ack();
    await settle();
    await helper.dispose();
    expect(((await text.catch((e: unknown) => e)) as ExecError).message).toMatch(/\nthe idb helper exited during this input; it may or may not have reached the simulator/);
    expect(s.children[0].requests).toHaveLength(1);
    expect(cli.idbCalls).toEqual([CLI_ARGV]);
  });
});

describe('the wiring — the tree source reads through the helper, the adapter owns it', () => {
  it('an idb tree source built with the helper sends its describe-all there, and the adapter\'s dispose kills it', async () => {
    const { helper, s, cli } = await readyHelper();
    const source = createIosTreeSource('idb', UDID, { exec: cli.exec, idbHelper: helper });
    const adapter = new IosAdapter({ udid: UDID, exec: cli.exec, treeSource: source, idbHelper: helper });
    const read = adapter.uiTree();
    await settle();
    expect(s.children[0].requests).toEqual([{ id: 1, argv: CLI_ARGV }]);
    s.children[0].answer(0, JSON.stringify([{ type: 'Application', AXLabel: 'Lab', frame: { x: 0, y: 0, width: 390, height: 844 } }, { type: 'Button', AXLabel: 'OK', frame: { x: 10, y: 10, width: 100, height: 40 } }]));
    await read;
    expect(cli.idbCalls).toEqual([CLI_ARGV]); // the starting call only
    await adapter.dispose();
    expect(s.children[0].signals).toEqual(['SIGKILL']);
  });
});

describe('the adapter\'s input through the helper (D7b) — one HID call at a time, in order', () => {
  it('sends clearText\'s second key sequence only after the first was answered — nothing to overtake it', async () => {
    const { helper, s, cli } = await readyHelper();
    const source = createIosTreeSource('idb', UDID, { exec: cli.exec, idbHelper: helper });
    const adapter = new IosAdapter({ udid: UDID, exec: cli.exec, treeSource: source, idbHelper: helper });
    const clear = adapter.clearText(2);
    await settle();
    expect(s.children[0].requests.map((r) => r.argv)).toEqual([['ui', 'key-sequence', '42', '42', '--udid', UDID]]);
    s.children[0].answer(0, '');
    await settle();
    expect(s.children[0].requests.map((r) => r.argv).at(-1)).toEqual(['ui', 'key-sequence', '76', '76', '--udid', UDID]);
    s.children[0].answer(0, '');
    await clear;
    expect(cli.idbCalls).toEqual([CLI_ARGV]); // the starting call only
    await adapter.dispose();
  });
});

describe('idbInterpreter — the Python idb\'s shebang names', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'averi-idb-shebang-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  async function exe(name: string, body: string | Buffer) {
    const path = join(dir, name);
    await writeFile(path, body);
    await chmod(path, 0o755);
    return path;
  }

  it('takes an absolute python as it is', async () => {
    const idb = await exe('idb', '#!/opt/tools/fb-idb/bin/python\nfrom idb.cli.main import main\n');
    expect(await idbInterpreter({ PATH: dir })).toEqual({ python: '/opt/tools/fb-idb/bin/python', idb });
  });

  it('resolves `/usr/bin/env python3` through PATH', async () => {
    const idb = await exe('idb', '#!/usr/bin/env python3\n');
    const python = await exe('python3', '');
    expect(await idbInterpreter({ PATH: `/nonexistent:${dir}` })).toEqual({ python, idb });
  });

  it('has none for a binary idb, a shell wrapper, an env python not on PATH, or no idb at all', async () => {
    await exe('idb', Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00]));
    expect(await idbInterpreter({ PATH: dir })).toBeUndefined();
    await exe('idb', '#!/bin/sh\nexec python3 -m idb "$@"\n');
    expect(await idbInterpreter({ PATH: dir })).toBeUndefined();
    await exe('idb', '#!/usr/bin/env python3\n');
    expect(await idbInterpreter({ PATH: dir })).toBeUndefined();
    expect(await idbInterpreter({ PATH: '/nonexistent' })).toBeUndefined();
  });
});
