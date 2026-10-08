import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The probe's fallback: Xcode at its default location exists on this "host".
vi.mock('node:fs', async (importOriginal) => ({ ...(await importOriginal<typeof import('node:fs')>()), existsSync: () => true }));
import type { ExecFn, ExecOptions } from '../../src/adapters/exec.js';
import { simctl } from '../../src/adapters/xcode-env.js';

/**
 * xcode-env.ts#simctl, the one spelling of a simctl call (IosAdapter's
 * `simctl` and discovery.ts's listing both call it): the argv after
 * `xcrun simctl`, the probe's DEVELOPER_DIR as the env, and a timeout only
 * when one is given.
 */
describe('simctl', () => {
  beforeEach(() => vi.stubEnv('DEVELOPER_DIR', ''));
  afterEach(() => vi.unstubAllEnvs());

  function fakeExec() {
    const calls: { cmd: string; args: string[]; opts?: ExecOptions }[] = [];
    const fn: ExecFn = async (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      // xcode-select points at CommandLineTools: the probe falls back to /Applications/Xcode.app.
      if (args[0] === '--find') throw new Error('xcrun: error: unable to find utility "simctl"');
      return { stdout: Buffer.from('ok'), stderr: '' };
    };
    return { fn, calls };
  }

  const XCODE_ENV = { DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer' };

  it('runs `xcrun simctl <args>` under the probed DEVELOPER_DIR, with no timeout unless given one', async () => {
    const { fn, calls } = fakeExec();
    await simctl(fn, ['list', 'devices', '--json']);
    expect(calls.at(-1)).toStrictEqual({ cmd: 'xcrun', args: ['simctl', 'list', 'devices', '--json'], opts: { env: XCODE_ENV } });
  });

  it('passes a given timeout beside the env, and probes once per exec', async () => {
    const { fn, calls } = fakeExec();
    await simctl(fn, ['install', 'AAAA-1111', '/tmp/App.app'], 120_000);
    await simctl(fn, ['launch', 'AAAA-1111', 'com.example']);
    expect(calls.map((c) => [c.cmd, ...c.args].join(' '))).toEqual([
      'xcrun --find simctl',
      'xcrun simctl install AAAA-1111 /tmp/App.app',
      'xcrun simctl launch AAAA-1111 com.example',
    ]);
    expect(calls[1].opts).toStrictEqual({ env: XCODE_ENV, timeoutMs: 120_000 });
    expect(calls[2].opts).toStrictEqual({ env: XCODE_ENV });
  });
});
