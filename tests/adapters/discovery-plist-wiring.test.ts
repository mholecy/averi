import { homedir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The production wiring of D22's proof, which discovery.test.ts's injected
 * reader cannot see: the real reader's path under the real home directory.
 * node:fs/promises is mocked, so no host file is read.
 */
const readFile = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', () => ({ readFile }));

const { defaultIosBooted } = await import('../../src/mcp/registry.js');

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

describe('defaultIosBooted — the server\'s proof reads the default device set under the home directory', () => {
  // A block body: a hook that returns a function has it called as its teardown, and mockReset returns the mock.
  beforeEach(() => {
    readFile.mockReset();
  });

  it('reads <home>/Library/Developer/CoreSimulator/Devices/<udid>/device.plist as UTF-8, and believes a booted one', async () => {
    readFile.mockResolvedValue(BOOTED);
    expect(await defaultIosBooted(UDID)).toBe(true);
    expect(readFile.mock.calls).toEqual([[`${homedir()}/Library/Developer/CoreSimulator/Devices/${UDID}/device.plist`, 'utf8']]);
  });

  it('a missing file proves nothing', async () => {
    readFile.mockImplementation(async () => {
      throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    });
    expect(await defaultIosBooted(UDID)).toBe(false);
    expect(readFile).toHaveBeenCalledTimes(1);
  });
});
