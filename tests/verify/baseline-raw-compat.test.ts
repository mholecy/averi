import { readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screencapRaw } from '../../src/adapters/screenshot-bytes.js';
import type { RawImage, ScreenCapture } from '../../src/adapters/types.js';
import { Verifier } from '../../src/verify/assert.js';
import { decodePng } from '../../src/verify/png.js';
import { FakeAdapter, node } from '../helpers/fake.js';
import { resetSleeps } from '../helpers/sleep-recorder.js';

vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));

/**
 * D19 review, MINOR-4: a baseline stored before D19 is the DEVICE's PNG (`screencap -p`); after it, Android's frame is
 * the raw capture. The screenshot assert must compare the two equal — by pixels, threshold 0 — and a baseline it
 * creates from a raw capture (averi's own PNG) must hold the same pixels. One real pair from the lab AVD.
 */

const FIXTURES = fileURLToPath(new URL('../fixtures/screencap/', import.meta.url));
const DEVICE_PNG = readFileSync(`${FIXTURES}android-lab-bands-api33.png`);
const RAW_GZ = readFileSync(`${FIXTURES}android-lab-bands-api33.raw.gz`);
const RAW_IMAGE = (screencapRaw(RAW_GZ, { device: 'd', command: 'c', remedy: 'r' }) as { image: RawImage }).image;

describe('a device-PNG baseline against a raw capture (D19)', () => {
  let dir: string;
  beforeEach(async () => {
    resetSleeps();
    dir = await mkdtemp(join(tmpdir(), 'averi-d19-baseline-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A fake whose captures are the raw frame; `captures` counts them, `fake.screenshots` the PNG path's. */
  function rawDevice(): { fake: FakeAdapter; captures: () => number } {
    const fake = new FakeAdapter({ s: node({ role: 'container' }) }, 's');
    let n = 0;
    Object.assign(fake, {
      capture: async (): Promise<ScreenCapture> => {
        n++;
        return { kind: 'rgba', image: RAW_IMAGE };
      },
    });
    return { fake, captures: () => n };
  }

  it('an old device-PNG baseline matches a raw capture of the same screen at threshold 0, through captures alone', async () => {
    await mkdir(join(dir, 'android'), { recursive: true });
    await copyFile(`${FIXTURES}android-lab-bands-api33.png`, join(dir, 'android', 'old.png'));
    const { fake, captures } = rawDevice();
    const result = await new Verifier(fake, { pollMs: 5, timeoutMs: 5_000, baselineDir: dir }).assert({ screenshot: { baseline: 'old', threshold: 0 } });
    expect(result.pass, result.detail).toBe(true);
    expect(captures()).toBeGreaterThanOrEqual(2);
    expect(fake.screenshots).toHaveLength(0);
  });

  it("a baseline created from a raw capture is averi's PNG of the same pixels as the device's", async () => {
    const { fake } = rawDevice();
    const created = await new Verifier(fake, { pollMs: 5, timeoutMs: 5_000, baselineDir: dir }).assert({ screenshot: { baseline: 'new' } });
    expect(created.pass, created.detail).toBe(true);
    const written = await readFile(join(dir, 'android', 'new.png'));
    expect(written.equals(DEVICE_PNG)).toBe(false);
    expect(decodePng(written).data.equals(decodePng(DEVICE_PNG).data)).toBe(true);
  });
});
