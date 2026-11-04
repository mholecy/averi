import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// steps.ts#terminalOf against a real closed pipe (batch-11's tee gone with the Ctrl-C): a child process whose stdout's
// reader has closed its end runs a StepLog on the default terminal. It must not die of EPIPE, and its .out must be
// whole. Kept apart from steps.test.ts: it spawns a process, which the mutation run's sandbox does not need.

const ROOT = join(import.meta.dirname, '..', '..', '..');
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'batch-terminal-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the default terminal with its reader gone (EPIPE)', () => {
  it('the run goes on: exit 0, every line and the SUMMARY in its .out, the terminal said gone', async () => {
    const outFile = join(dir, 'child.out');
    const child = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'tests/fixtures/batch/terminal-child.ts'), outFile, join(dir, 'steps.log')], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.stdout.destroy();
    child.stdin.end();
    const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) => child.on('exit', (c, s) => resolve([c, s])));
    expect({ code, signal, stderr }).toEqual({ code: 0, signal: null, stderr: '' });
    const out = readFileSync(outFile, 'utf8');
    expect(out).toMatch(/NOTE the terminal is gone \(closed\): this run writes only to/);
    expect(out).toContain('NOTE line 49');
    expect(out.endsWith('======== SUMMARY\nOK child\n======== SUMMARY end (run 1)\n')).toBe(true);
  }, 15_000);
});
