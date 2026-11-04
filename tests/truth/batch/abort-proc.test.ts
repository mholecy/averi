import { spawn, type ChildProcess } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// scripts/truth/batch/abort.ts on the real process seam, with real signals: b11-dry's int.sh scenarios (a process
// group sent SIGINT, a second SIGINT, a fatal error inside a window) as vitest tests. The child is
// tests/fixtures/batch/abort-child.ts, started in a process group of its own as a terminal's foreground job is; a
// Ctrl-C is SIGINT to that whole group. Pids and markers go through files in a temp dir (the sandbox blocks ps and
// pgrep). Every wait is bounded, and every child's group is killed in afterEach, whatever the test did.

const ROOT = join(import.meta.dirname, '..', '..', '..');
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'batch', 'abort-child.ts');
let dir: string;
let child: ChildProcess | undefined;
let pids: number[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'batch-abort-proc-'));
  child = undefined;
  pids = [];
});
afterEach(() => {
  for (const pid of [...(child?.pid === undefined ? [] : [-child.pid]), ...pids]) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // gone already
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

const at = (name: string) => join(dir, name);
const text = (name: string) => readFileSync(at(name), 'utf8');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, ms = 5000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (ok()) return true;
  return ok();
}
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

interface Run {
  child: ChildProcess;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stdout: () => string;
  stderr: () => string;
}

/** Start the fixture in a process group of its own (a terminal's foreground job). */
function start(scenario: string): Run {
  const c = spawn(process.execPath, ['--import', 'tsx', FIXTURE, dir, scenario], { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child = c;
  let [out, err] = ['', ''];
  c.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  c.stdout?.on('error', () => {});
  c.stderr?.on('data', (d: Buffer) => (err += d.toString()));
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => c.on('exit', (code, signal) => resolve({ code, signal })));
  return { child: c, exit, stdout: () => out, stderr: () => err };
}

/** The exit, or a throw after `ms`: a hung child fails the test, never the suite (afterEach kills it). */
async function exited(run: Run, ms = 8000) {
  const late = sleep(ms).then(() => 'late' as const);
  const r = await Promise.race([run.exit, late]);
  if (r === 'late') throw new Error(`the child did not exit within ${ms} ms; stderr: ${run.stderr()}`);
  return r;
}

/** A Ctrl-C at the terminal: the signal to the child's whole group. */
const ctrlC = (run: Run, signal: NodeJS.Signals = 'SIGINT') => process.kill(-(run.child.pid ?? 0), signal);

async function ready(run: Run): Promise<number[]> {
  expect(await until(() => existsSync(at('ready')) && existsSync(at('probe.pids')) && text('probe.pids').includes(' '))).toBe(true);
  const probe = text('probe.pids').split(' ').map(Number);
  pids.push(...probe);
  return probe;
}

const summary = () => text('summary.txt').split('\n');

describe('SIGINT on the real process seam: restores run, RESTORE for the failed one, exit 130 (b11-dry int.sh)', () => {
  it('int-d55: Ctrl-C inside a dirty window — the probe\'s group stopped (grandchild too), the restore run and verified, the abort SUMMARY on the terminal, exit 130', async () => {
    const run = start('int');
    const [probe, grandchild] = await ready(run);
    ctrlC(run);
    expect(await exited(run)).toEqual({ code: 130, signal: null });
    expect(existsSync(at('E5.done'))).toBe(true);
    expect(existsSync(at('RESTORE.txt'))).toBe(false);
    expect(await until(() => !alive(probe) && !alive(grandchild))).toBe(true);
    expect(summary()).toEqual([
      '======== SUMMARY',
      'OK checkout: a fixture',
      expect.stringMatching(/^INTERRUPTED: batch-t run 1 was interrupted at \d\d:\d\d:\d\d$/),
      'kf live verdict: PASS',
      '(before the interrupt) E5 a verdict: PASS',
      'E5: INTERRUPTED — its records are not complete, not judged (rerun ONLY=E5)',
      'E5 cleanup: OK — its state read back (verified by the abort)',
      'RESTORE: none — everything dirty was put back and verified',
      expect.stringMatching(/^\d\d:\d\d:\d\d ERROR batch-t interrupted \(run 1\) by SIGINT$/),
      '======== SUMMARY end (run 1, INTERRUPTED)',
      '',
    ]);
    expect(run.stdout()).toContain(text('summary.txt'));
    expect(run.stderr()).toBe('');
  }, 15_000);

  it('SIGHUP (a closed terminal) does the same', async () => {
    const run = start('int');
    await ready(run);
    ctrlC(run, 'SIGHUP');
    expect(await exited(run)).toEqual({ code: 130, signal: null });
    expect(existsSync(at('E5.done'))).toBe(true);
    expect(text('summary.txt')).toContain('interrupted (run 1) by SIGHUP');
  }, 15_000);

  it('d43-restorefail: a restore that is not verified writes its RESTORE line, and the SUMMARY points at it; exit 130', async () => {
    const run = start('int-fail');
    await ready(run);
    ctrlC(run);
    expect(await exited(run)).toEqual({ code: 130, signal: null });
    expect(text('RESTORE.txt')).toMatch(/^batch-t run 1 interrupted at \d{4}-\d\d-\d\d \d\d:\d\d:\d\d; state to put back by hand:\nE5: not proven clean \(check exit 3\) — node e5\.ts --check\n$/);
    expect(summary()).toContain(`RESTORE: state not provably put back — ${at('RESTORE.txt')}:`);
    expect(summary()).toContain('E5 cleanup: ERROR — its check exit 3 (the abort)');
  }, 15_000);

  it('int-twice: a second Ctrl-C does not kill the detached restore (batch-11: the restore child ran in the batch\'s foreground group)', async () => {
    const run = start('int-twice');
    await ready(run);
    ctrlC(run);
    expect(await until(() => existsSync(at('E5.started')))).toBe(true);
    const restorePid = Number(text('E5.started'));
    pids.push(restorePid);
    ctrlC(run);
    await sleep(50);
    ctrlC(run, 'SIGTERM');
    expect(alive(restorePid)).toBe(true);
    expect(await exited(run)).toEqual({ code: 130, signal: null });
    expect(text('E5.done')).toBe('done');
    expect(existsSync(at('RESTORE.txt'))).toBe(false);
    expect(text('steps.log')).toMatch(/NOTE SIGINT ignored: the abort is putting state back[\s\S]*NOTE SIGTERM ignored/);
  }, 15_000);

  it('batch-12\'s worktree window: interrupted with the worktree up, it is removed and verified unregistered', async () => {
    const run = start('worktree');
    await ready(run);
    expect(existsSync(at('wt'))).toBe(true);
    ctrlC(run);
    expect(await exited(run)).toEqual({ code: 130, signal: null });
    expect(existsSync(at('wt'))).toBe(false);
    const list = execFileSync('git', ['-C', at('repo'), 'worktree', 'list', '--porcelain'], { encoding: 'utf8', timeout: 10_000 });
    expect(list).not.toMatch(/\/wt$/m);
    expect(text('steps.log')).toContain('OK   WT put back (verified by the abort): removed, unregistered');
  }, 15_000);
});

describe('TRAPEXIT\'s port on the real seam: a throw, a rejection or an uncaught exception inside a window restores, exit 130 — never through the `exit` event', () => {
  it.each([
    ['throw', 'by an error: EVIL is not defined'],
    ['reject', 'by an uncaught error: lost promise'],
    ['uncaught', 'by an uncaught error: thrown in a timer'],
  ])('setu-%s: the window restored, the SUMMARY names the error', async (scenario, why) => {
    const run = start(scenario);
    expect(await exited(run)).toEqual({ code: 130, signal: null });
    expect(existsSync(at('E5.done'))).toBe(true);
    expect(text('summary.txt')).toContain(`ERROR batch-t interrupted (run 1) ${why}`);
    expect(existsSync(at('RESTORE.txt'))).toBe(false);
    if (existsSync(at('probe.pids'))) {
      const probe = text('probe.pids').split(' ').map(Number);
      pids.push(...probe);
      expect(await until(() => probe.every((p) => !alive(p)))).toBe(true);
    }
  }, 15_000);
});

describe('the terminal gone or paused does not stop a restore (batch-11: the tee died with the Ctrl-C)', () => {
  it('stdout EPIPE: the reader closed, the restore writes to stdout anyway — it finishes, the run notes the terminal gone, exit 130', async () => {
    const run = start('epipe');
    await ready(run);
    run.child.stdout?.destroy();
    ctrlC(run);
    expect(await exited(run)).toEqual({ code: 130, signal: null });
    expect(existsSync(at('E5.done'))).toBe(true);
    expect(run.stderr()).toBe('');
    const out = text('batch-t.out');
    expect(out).toMatch(/NOTE the terminal is gone \(closed\)/);
    expect(out).toContain('======== SUMMARY end (run 1, INTERRUPTED)');
    // The EPIPE is no error of the run: not an uncaught error (which would abort a run still going), not an ERROR line.
    expect(out).not.toMatch(/uncaught error|EPIPE/);
  }, 15_000);

  it('a tty paused with Ctrl-S blocks only the last write: the restore done, RESTORE and summary.txt written before it', async () => {
    const run = start('paused');
    await ready(run);
    ctrlC(run);
    expect(await until(() => existsSync(at('summary.txt')) && text('summary.txt').includes('SUMMARY end'))).toBe(true);
    expect(existsSync(at('E5.done'))).toBe(true);
    expect(text('batch-t.out')).toContain('E5 cleanup: OK');
    // Still blocked in the terminal write: it has not exited; the afterEach kills its group.
    expect(await Promise.race([run.exit.then(() => 'exited'), sleep(300).then(() => 'blocked')])).toBe('blocked');
  }, 15_000);
});
