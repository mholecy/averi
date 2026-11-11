import { afterEach, describe, expect, it, vi } from 'vitest';
import { homedir } from 'node:os';
import { exec, ExecError, hostHome, hostPathsOut } from '../../src/adapters/exec.js';

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

  it('ExecError keeps what the command printed to STDOUT (xcodebuild puts diagnostics there)', async () => {
    const err = await exec('sh', ['-c', 'echo "error: details on stdout"; echo trailer >&2; exit 65'])
      .then(() => undefined, (e: unknown) => e as InstanceType<typeof ExecError>);
    expect(err).toBeInstanceOf(ExecError);
    expect(err?.stdout.toString('utf8')).toContain('error: details on stdout');
    expect(err?.stderr).toContain('trailer');
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

describe('ExecError: its message is commandFailureText, its fields every byte (D70)', () => {
  const TRACE = `Traceback (most recent call last):\n  File "${homedir()}/idb/main.py", line 1, in m\nException: boom\n`;

  it('a crash reads one line with no home in the message, and stderr, command and stack keep what detectors and logs read', async () => {
    const script = `cat >&2 <<'T'\n${TRACE}T\nexit 1`;
    const err = await exec('sh', ['-c', script]).then(() => undefined, (e: unknown) => e as ExecError);
    expect(err?.message).toBe(`Command failed (exit 1): sh -c ${script.replace(homedir(), '~')}\nsh crashed: Exception: boom (Python traceback left out: run the command by hand, with the real text and paths, to see it)`);
    expect(err?.stderr).toBe(TRACE);
    expect(err?.command).toBe(`sh -c ${script}`);
    expect(err?.exitCode).toBe(1);
    expect(err?.stack).toContain('ExecError');
  });

  it('a word declared typed (ExecOptions.typed) is <typed text> in command, message and stack, and in node\'s own line for a silent child (A17)', async () => {
    const err = await exec('sh', ['-c', 'exit 3', 'hunter2'], { typed: [2] }).then(() => undefined, (e: unknown) => e as ExecError);
    expect(err?.command).toBe('sh -c exit 3 <typed text>');
    expect(err?.message).toBe('Command failed (exit 3): sh -c exit 3 <typed text>\nCommand failed: sh -c exit 3 <typed text>');
    expect(err?.stderr).toBe('Command failed: sh -c exit 3 <typed text>\n');
    expect(err?.stack).not.toContain('hunter2');
  });

  it('a typed word stays out of a timeout too; what the child prints is not exec\'s to mask', async () => {
    const late = await exec('sh', ['-c', 'sleep 5', 'hunter2'], { typed: [2], timeoutMs: 100 }).then(() => undefined, (e: unknown) => e as ExecError);
    expect(late?.timedOut).toBe(true);
    expect(late?.command).toBe('sh -c sleep 5 <typed text>');
    expect(`${late?.message}${late?.stack}${late?.stderr}`).not.toContain('hunter2');
    const said = await exec('sh', ['-c', 'echo "$0" >&2; exit 1', 'hunter2'], { typed: [2] }).then(() => undefined, (e: unknown) => e as ExecError);
    expect(said?.command).toBe('sh -c echo "$0" >&2; exit 1 <typed text>');
    expect(said?.stderr).toBe('hunter2\n');
  });

  it('a note and a cause still go through it', () => {
    const cause = new Error('c');
    const err = new ExecError('adb devices', 1, 'said', false, Buffer.alloc(0), { note: 'tail', cause });
    expect(err.message).toBe('Command failed (exit 1): adb devices\nsaid\ntail');
    expect(err.cause).toBe(cause);
  });

  describe('the home it passes', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('is the real one: the rule only an own home has, past a word\'s start, reaches it', () => {
      vi.stubEnv('HOME', '/opt/me');
      expect(new ExecError('c', 1, 'https://h/opt/me/a').message).toBe('Command failed (exit 1): c\nhttps://h~/a');
    });

    it('hostHome reads it too, and hostPathsOut asks it', () => {
      vi.stubEnv('HOME', '/opt/me');
      expect(hostHome()).toBe('/opt/me');
      expect(hostPathsOut('https://h/opt/me/a')).toBe('https://h~/a');
    });
  });

  it('a failure to word it never destroys the error: the raw shape stands, and the fields', () => {
    const err = new ExecError('adb devices', 1, undefined as unknown as string, false, Buffer.alloc(0), { note: 'tail' });
    expect(err.message).toBe('Command failed (exit 1): adb');
    expect(err.exitCode).toBe(1);
    expect(err.stack).toContain('ExecError');
    expect(new ExecError(undefined as unknown as string, null, '', true).message).toBe('Command timed out: undefined');
    expect(new ExecError('idb ui text hunter2 --udid U', 1, undefined as unknown as string).message).toBe('Command failed (exit 1): idb');
  });

  it('the same failure without any of it stays exec\'s bytes', () => {
    expect(new ExecError("adb -s emulator-9998 shell monkey -p dev.averi.lab", 1, "adb: device 'emulator-9998' not found\n").message)
      .toBe("Command failed (exit 1): adb -s emulator-9998 shell monkey -p dev.averi.lab\nadb: device 'emulator-9998' not found");
  });
});
