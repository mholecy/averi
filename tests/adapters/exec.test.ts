import { describe, expect, it } from 'vitest';
import { exec, ExecError } from '../../src/adapters/exec.js';

describe('exec', () => {
  it('captures stdout as a Buffer', async () => {
    const result = await exec('printf', ['hello']);
    expect(Buffer.isBuffer(result.stdout)).toBe(true);
    expect(result.stdout.toString('utf8')).toBe('hello');
  });

  it('captures stderr as a string on success', async () => {
    const result = await exec('sh', ['-c', 'echo warn >&2; echo out']);
    expect(result.stderr.trim()).toBe('warn');
    expect(result.stdout.toString('utf8').trim()).toBe('out');
  });

  it('rejects with ExecError carrying exit code and stderr', async () => {
    await expect(exec('sh', ['-c', 'echo boom >&2; exit 3'])).rejects.toMatchObject({
      name: 'ExecError',
      exitCode: 3,
      stderr: expect.stringContaining('boom'),
    });
  });

  it('rejects with ExecError for a missing binary', async () => {
    await expect(exec('definitely-not-a-real-binary-xyz', [])).rejects.toBeInstanceOf(ExecError);
  });

  it('kills the process and flags timedOut when the timeout elapses', async () => {
    await expect(exec('sleep', ['5'], { timeoutMs: 100 })).rejects.toMatchObject({
      name: 'ExecError',
      timedOut: true,
    });
  });
});
