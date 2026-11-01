import { homedir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The production wiring of D22's proof, which discovery.test.ts's injected
 * reader cannot see: the real reader's path under the real home directory,
 * and which discovery reads it. node:fs/promises is mocked, so no host file
 * is read; and the real exec is one that throws, so a proof that fails to
 * short-circuit cannot spawn simctl on the host.
 */
const readFile = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', () => ({ readFile }));
vi.mock('../../src/adapters/exec.js', () => ({
  exec: async (cmd: string, args: string[]) => {
    throw new Error(`test harness: no command may run here — ${[cmd, ...args].join(' ')}`);
  },
}));

const { defaultDiscovery, defaultDiscoveryDeps, discoveryWith } = await import('../../src/adapters/discovery.js');

const UDID = 'D8DACDE6-6352-437C-AA22-86FB06275C3F';
const BOOTED = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
\t<key>UDID</key>
\t<string>${UDID}</string>
\t<key>isDeleted</key>
\t<false/>
\t<key>state</key>
\t<integer>3</integer>
</dict>
</plist>
`;

describe('the server\'s proof reads the default device set under the home directory', () => {
  // A block body: a hook that returns a function has it called as its teardown, and mockReset returns the mock.
  beforeEach(() => {
    readFile.mockReset();
  });

  it('the default discovery reads <home>/Library/Developer/CoreSimulator/Devices/<udid>/device.plist as UTF-8, and believes a booted one', async () => {
    readFile.mockResolvedValue(BOOTED);
    expect(await defaultDiscovery.check('ios', UDID)).toEqual({ usable: true });
    expect(readFile.mock.calls).toEqual([[`${homedir()}/Library/Developer/CoreSimulator/Devices/${UDID}/device.plist`, 'utf8']]);
  });

  it('a missing file proves nothing', async () => {
    readFile.mockImplementation(async () => {
      throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    });
    expect(await defaultDiscoveryDeps.iosBooted(UDID)).toBe(false);
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('a discovery over an exec alone reads no file: its iOS check lists with simctl', async () => {
    readFile.mockResolvedValue(BOOTED);
    const calls: string[] = [];
    const exec = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '));
      return { stdout: Buffer.from(args.includes('list') ? '{"devices":{}}' : ''), stderr: '' };
    };
    expect(await discoveryWith(exec).check('ios', UDID)).toEqual({ usable: false, listed: undefined });
    expect(readFile).not.toHaveBeenCalled();
    expect(calls).toContain('xcrun simctl list devices --json');
  });
});
