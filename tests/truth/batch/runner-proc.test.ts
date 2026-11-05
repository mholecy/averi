import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { endChildren } from './proc-cleanup.js';

vi.setConfig({ testTimeout: 15_000, hookTimeout: 10_000 });

// scripts/truth/batch/runner.ts on the real process seam: runBatch in a child of its own group, a Ctrl-C to that whole
// group mid-block (b11-dry's int-d55 under the runner), and a run that ends by itself. The child is
// tests/fixtures/batch/runner-child.ts; pids and markers go through files in a temp dir (the sandbox blocks ps and
// pgrep). Every wait is bounded, and every child's group is killed in afterEach. In the normal suite only, as
// abort-proc.test.ts: it starts processes.

const ROOT = join(import.meta.dirname, '..', '..', '..');
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'batch', 'runner-child.ts');
let dir: string;
let child: ChildProcess | undefined;
let pids: number[];
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'batch-runner-proc-')));
  child = undefined;
  pids = [];
});
afterEach(async () => {
  await endChildren(child === undefined ? [] : [child], pids);
  rmSync(dir, { recursive: true, force: true });
}, 10_000);

const at = (...names: string[]) => join(dir, ...names);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, ms = 6000): Promise<boolean> {
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

function start(scenario: string) {
  const c = spawn(process.execPath, ['--import', 'tsx', FIXTURE, dir, scenario], { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child = c;
  let [out, err] = ['', ''];
  c.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  c.stderr?.on('data', (d: Buffer) => (err += d.toString()));
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => c.on('exit', (code, signal) => resolve({ code, signal })));
  return { child: c, exit, stdout: () => out, stderr: () => err };
}
async function exited(run: ReturnType<typeof start>, ms = 9000) {
  const r = await Promise.race([run.exit, sleep(ms).then(() => 'late' as const)]);
  if (r === 'late') throw new Error(`the child did not exit within ${ms} ms; stderr: ${run.stderr()}`);
  return r;
}
/** This run's meta folder: the one run-<id> under out/meta. */
const meta = () => at('out', 'meta', readdirSync(at('out', 'meta'))[0]);
const summary = () => readFileSync(join(meta(), 'summary.txt'), 'utf8').split('\n');

describe('runBatch on the real process seam (T2 S6a; b11-dry int.sh under the runner)', () => {
  it('Ctrl-C mid-block: the probe\'s group stopped, the window put back, the abort SUMMARY with INTERRUPTED on the terminal, exit 130', async () => {
    const run = start('int');
    expect(await until(() => existsSync(at('ready')) && existsSync(at('probe.pids')) && readFileSync(at('probe.pids'), 'utf8').includes(' '))).toBe(true);
    const probe = readFileSync(at('probe.pids'), 'utf8').split(' ').map(Number);
    pids.push(...probe);
    process.kill(-(run.child.pid ?? 0), 'SIGINT');
    expect(await exited(run)).toEqual({ code: 130, signal: null });
    expect(existsSync(at('E5.done'))).toBe(true);
    expect(await until(() => probe.every((p) => !alive(p)))).toBe(true);
    const s = summary();
    expect(s[0]).toBe('======== SUMMARY');
    expect(s[1]).toBe("OK checkout: main's HEAD " + s[1].slice(25, 33) + ', clean');
    expect(s).toContain('kf live verdict: PASS — a fixture');
    expect(s).toContain('E5: INTERRUPTED — its records are not complete, not judged (rerun ONLY=E5)');
    expect(s).toContain('E5 cleanup: OK — its state read back (verified by the abort)');
    expect(s).toContain('RESTORE: none — everything dirty was put back and verified');
    expect(s.at(-2)).toMatch(/^======== SUMMARY end \(run \d{8}-\d{6}-\d+, INTERRUPTED\)$/);
    expect(run.stdout()).toContain(s.join('\n'));
    expect(existsSync(at('out', 'RESTORE.txt'))).toBe(false);
  });

  it('a run that ends by itself: its SUMMARY on the terminal and in summary.txt, exit 0', async () => {
    const run = start('quick');
    expect(await exited(run)).toEqual({ code: 0, signal: null });
    const s = summary();
    expect(s).toContain('E5 verdict: PASS — the probe ended');
    expect(s).toContain('kf live verdict: PASS — a fixture');
    expect(run.stdout()).toContain(s.join('\n'));
    expect(run.stderr()).toBe('');
  });
});
