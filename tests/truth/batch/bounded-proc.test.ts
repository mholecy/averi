import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Calls, NOT_STARTED, TIMED_OUT } from '../../../scripts/truth/batch/bounded.js';
import { nodeProcess } from '../../../scripts/truth/batch/proc.js';

// scripts/truth/batch/bounded.ts over the real process seam (proc.ts): real children in process groups of their own.
// src/adapters/exec.ts kills only the direct child on a timeout, so live.ts or a Gradle build would leave its
// grandchildren running; a batch call must take its whole group with it. Kept apart from bounded.test.ts: it spawns
// processes, which the mutation run does not. Every child is ended in afterEach, whatever the test did.

const HELPER = join(import.meta.dirname, '..', '..', 'fixtures', 'batch', 'proc-child.mjs');
const node = process.execPath;
let dir: string;
let pids: number[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'batch-bounded-'));
  pids = [];
});
afterEach(() => {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // gone already: what the tests want
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Poll until `ok`, at most `ms`: the test's own bound. */
async function until(ok: () => boolean, ms = 3000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (ok()) return true;
  return ok();
}
const pidsIn = async (file: string): Promise<number[]> => {
  expect(await until(() => existsSync(file) && readFileSync(file, 'utf8').trim() !== '')).toBe(true);
  const read = readFileSync(file, 'utf8').trim().split(' ').map(Number);
  pids.push(...read);
  return read;
};

describe('bounded over real processes: a call past its bound is gone with its grandchildren (backlog T2 S2, the risk gate)', () => {
  it('the grandchild gone: SIGTERM then SIGKILL to the whole group; a grandchild that traps SIGTERM dies too; exit 142', async () => {
    const calls = new Calls(nodeProcess, { graceMs: 200 });
    const pidfile = join(dir, 'tree.pids');
    const r = calls.bounded(node, [HELPER, 'tree', pidfile], { secs: 0.8 });
    const [child, grandchild] = await pidsIn(pidfile);
    expect([alive(child), alive(grandchild)]).toEqual([true, true]);
    expect(await r).toMatchObject({ code: TIMED_OUT, timedOut: true });
    expect(await until(() => !alive(child) && !alive(grandchild))).toBe(true);
  }, 10_000);

  it('a call in time: its code, its stdout and stderr', async () => {
    const calls = new Calls(nodeProcess);
    expect(await calls.bounded(node, [HELPER, 'echo', 'the out', 'the err', '3'], { secs: 5 })).toEqual({ code: 3, timedOut: false, signal: null, out: 'the out', err: 'the err' });
  }, 10_000);

  it('with a log: its stdout and stderr appended to the file as it runs, what was there kept (never truncated)', async () => {
    const calls = new Calls(nodeProcess);
    const log = join(dir, 'probe.log');
    writeFileSync(log, 'earlier\n');
    expect(await calls.bounded(node, [HELPER, 'echo', 'o', 'e'], { secs: 5, log })).toMatchObject({ code: 0, out: '', err: '' });
    expect(readFileSync(log, 'utf8')).toMatch(/^earlier\n(oe|eo)$/);
  }, 10_000);

  it('a command that does not exist: 127 and why', async () => {
    const calls = new Calls(nodeProcess);
    const r = await calls.bounded(join(dir, 'no-such-tool'), [], { secs: 5 });
    expect(r).toMatchObject({ code: NOT_STARTED, timedOut: false });
    expect(r.err).toMatch(/ENOENT/);
  }, 10_000);

  it('stdin is /dev/null, as batch-11\'s `detached … < /dev/null`: a child that reads it sees it end at once', async () => {
    const calls = new Calls(nodeProcess);
    expect((await calls.detached(node, [HELPER, 'stdin'], { secs: 5 })).out).toBe('stdin 0');
  }, 10_000);

  it('a call that exits leaving a grandchild on its pipes does not hold the batch: its result comes within the close grace', async () => {
    const calls = new Calls(nodeProcess);
    const pidfile = join(dir, 'left.pid');
    const started = Date.now();
    expect(await calls.bounded(node, [HELPER, 'leave', pidfile], { secs: 20 })).toMatchObject({ code: 0, timedOut: false });
    expect(Date.now() - started).toBeLessThan(5000);
    await pidsIn(pidfile);
  }, 10_000);

  it('stopAll ends a running bounded call\'s whole group and leaves a detached one running (batch-11\'s restores)', async () => {
    const calls = new Calls(nodeProcess, { graceMs: 200 });
    const probe = join(dir, 'probe.pids');
    const p = calls.bounded(node, [HELPER, 'tree', probe], { secs: 20 });
    const started = join(dir, 'restore.started');
    const done = join(dir, 'restore.done');
    const restore = calls.detached(node, [HELPER, 'slow', started, done, '600'], { secs: 20 });
    const [child, grandchild] = await pidsIn(probe);
    await pidsIn(started);
    expect(await calls.stopAll()).toBe(1);
    expect(await p).toMatchObject({ timedOut: false });
    expect(await until(() => !alive(child) && !alive(grandchild))).toBe(true);
    expect(await restore).toMatchObject({ code: 0 });
    expect(existsSync(done)).toBe(true);
  }, 10_000);
});
