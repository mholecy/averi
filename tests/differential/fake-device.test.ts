import childProcess from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installFakeDevice, pngSize, useDevice } from '../../scripts/differential/fake-device.js';

// The fake device serving a ground-truth capture's screenshot (golden mode): the PNG the device showed, as it is, on
// both platforms' screenshot commands — and never one whose size the profile does not say.

const png = (width: number, height: number) => {
  const img = new PNG({ width, height });
  img.data.fill(0x7f);
  return PNG.sync.write(img);
};

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'averi-fake-'));
  installFakeDevice();
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const execFile = (cmd: string, args: string[]) => promisify(childProcess.execFile as (c: string, a: string[], o: object, cb: (e: Error | null, out: Buffer) => void) => void)(cmd, args, { encoding: 'buffer' }) as Promise<Buffer>;

describe('the fake device serving a captured screenshot', () => {
  it('reads a PNG\'s size from its header', () => {
    expect(pngSize(png(12, 34))).toEqual({ width: 12, height: 34 });
  });

  it('iOS: simctl io screenshot writes the captured PNG, byte for byte', async () => {
    const shot = png(30, 60);
    useDevice({ platform: 'ios', screen: { width: 10, height: 20 }, frame: { width: 30, height: 60 }, screenshot: shot });
    const file = join(dir, 'shot.png');
    await execFile('xcrun', ['simctl', 'io', 'booted', 'screenshot', file]);
    expect((await readFile(file)).equals(shot)).toBe(true);
  });

  it('Android: screencap answers the captured PNG, byte for byte', async () => {
    const shot = png(20, 40);
    useDevice({ platform: 'android', screen: { width: 20, height: 40 }, frame: { width: 20, height: 40 }, screenshot: shot });
    expect((await execFile('adb', ['-s', 'emulator-5554', 'exec-out', 'screencap', '-p'])).equals(shot)).toBe(true);
  });

  it('refuses a profile whose frame is not the captured PNG\'s size', () => {
    expect(() => useDevice({ platform: 'ios', screen: { width: 10, height: 20 }, frame: { width: 30, height: 61 }, screenshot: png(30, 60) })).toThrow(
      /captured screenshot is 30x60, the profile's frame 30x61/,
    );
  });
});

describe('the fake device serving a capture\'s own dumpsys window displays (CellTruth.displays)', () => {
  const dump = (shell: string) => execFile('adb', ['-s', 'emulator-5554', 'shell', ...shell.split(' ')]).then((b) => b.toString('utf8'));
  const OWN = '  InsetsSource type=ITYPE_NAVIGATION_BAR frame=[0,2088][1080,2220] visible=true\n';

  it('answers the capture\'s own dump while the keyboard is hidden, the stock gesture-mode dump without one', async () => {
    useDevice({ platform: 'android', screen: { width: 1080, height: 2220 }, frame: { width: 1080, height: 2220 }, windowDisplays: OWN });
    expect(await dump('dumpsys window displays')).toBe(OWN);
    useDevice({ platform: 'android', screen: { width: 1080, height: 2220 }, frame: { width: 1080, height: 2220 } });
    expect(await dump('dumpsys window displays')).toMatch(/ITYPE_NAVIGATION_BAR frame=\[0,2154\]\[1080,2220\]/);
  });

  it('not while a keyboard is shown: the dump the capture holds is the IME-down one', async () => {
    useDevice({ platform: 'android', screen: { width: 1080, height: 2220 }, frame: { width: 1080, height: 2220 }, windowDisplays: OWN, keyboard: 'shown' });
    expect(await dump('dumpsys window displays')).not.toBe(OWN);
  });
});
