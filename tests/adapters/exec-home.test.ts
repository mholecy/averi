import { describe, expect, it, vi } from 'vitest';

/**
 * `os.homedir()` throws when $HOME is unset and the uid has no passwd entry (a container's). Thrown from ExecError's
 * constructor inside exec's callback it would never settle the promise and take the process down.
 */
vi.mock('node:os', async (real) => ({
  ...(await real<typeof import('node:os')>()),
  homedir: () => {
    throw new Error('ENOENT: no such file or directory, uv_os_get_passwd');
  },
}));

const { exec, ExecError, hostHome } = await import('../../src/adapters/exec.js');

describe('a host whose home cannot be read', () => {
  it('hostHome answers no home', () => {
    expect(hostHome()).toBe('');
  });

  it('the error is still worded: every rule but the own home holds', () => {
    expect(new ExecError('c', 1, '/Users/lab/a').message).toBe('Command failed (exit 1): c\n~/a');
  });

  it('exec still rejects with it', async () => {
    await expect(exec('sh', ['-c', 'echo boom >&2; exit 3'])).rejects.toMatchObject({ name: 'ExecError', exitCode: 3 });
  });
});
