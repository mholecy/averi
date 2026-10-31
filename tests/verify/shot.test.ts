import { PNG } from 'pngjs';
import { describe, expect, it, vi } from 'vitest';
import type { RawImage, ScreenCapture } from '../../src/adapters/types.js';
import { captureFrame } from '../../src/verify/capture.js';
import { decodePng } from '../../src/verify/png.js';
import { captureShot, Shot } from '../../src/verify/shot.js';
import { resetSleeps } from '../helpers/sleep-recorder.js';

vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));

/**
 * verify/shot.ts (D19): one capture, a device PNG or raw pixels, with the other form made only when asked. The
 * stability wait compares raw captures as pixels — no PNG encoded, none decoded — and a PNG leaves the process only
 * through `png()`.
 */

const image = (fill: number, width = 4, height = 3): RawImage => ({ width, height, data: Buffer.alloc(width * height * 4, fill) });
const pngOf = (img: RawImage): Buffer => PNG.sync.write(Object.assign(new PNG({ width: img.width, height: img.height }), { data: img.data }));

describe('Shot', () => {
  it('two raw captures are equal by their pixels and size', () => {
    expect(Shot.of({ kind: 'rgba', image: image(7) }).equals(Shot.of({ kind: 'rgba', image: image(7) }))).toBe(true);
    expect(Shot.of({ kind: 'rgba', image: image(7) }).equals(Shot.of({ kind: 'rgba', image: image(8) }))).toBe(false);
    // The same bytes in another shape are another screen.
    expect(Shot.of({ kind: 'rgba', image: image(7, 4, 3) }).equals(Shot.of({ kind: 'rgba', image: image(7, 3, 4) }))).toBe(false);
  });

  it('two PNGs are equal by their bytes, never decoded', () => {
    expect(Shot.ofPng(Buffer.from('a')).equals(Shot.ofPng(Buffer.from('a')))).toBe(true);
    expect(Shot.ofPng(Buffer.from('a')).equals(Shot.ofPng(Buffer.from('b')))).toBe(false);
  });

  it('a PNG beside a raw capture (the adapter fell back between them) is compared by its pixels', () => {
    const png = pngOf(image(9));
    expect(Shot.ofPng(png).equals(Shot.of({ kind: 'rgba', image: image(9) }))).toBe(true);
    expect(Shot.of({ kind: 'rgba', image: image(9) }).equals(Shot.ofPng(png))).toBe(true);
    expect(Shot.ofPng(png).equals(Shot.of({ kind: 'rgba', image: image(10) }))).toBe(false);
    // A PNG that does not decode equals nothing.
    expect(Shot.ofPng(Buffer.from('not a png')).equals(Shot.of({ kind: 'rgba', image: image(9) }))).toBe(false);
  });

  it("a raw capture's pixels are its own; its PNG is encoded once, and decodes to them", async () => {
    const raw = image(3);
    const shot = Shot.of({ kind: 'rgba', image: raw });
    expect(shot.decode()).toBe(raw);
    const png = await shot.png();
    expect(await shot.png()).toBe(png);
    expect(decodePng(png)).toEqual({ width: 4, height: 3, data: raw.data });
  });

  it("a PNG capture's bytes are passed on as they are, and decoded once", async () => {
    const bytes = pngOf(image(5));
    const shot = Shot.ofPng(bytes);
    expect(await shot.png()).toBe(bytes);
    const first = shot.decode();
    expect(shot.decode()).toBe(first);
    expect(first.data.equals(image(5).data)).toBe(true);
  });

  it("a PNG that does not decode throws decodePng's error on every ask, and `tryDecode()` is undefined", () => {
    const shot = Shot.ofPng(Buffer.from('not a png'));
    expect(() => shot.decode()).toThrow();
    let again: unknown;
    try {
      shot.decode();
    } catch (e) {
      again = e;
    }
    expect(again).toBeInstanceOf(Error);
    expect(shot.tryDecode()).toBeUndefined();
  });
});

describe('captureShot', () => {
  it("takes the adapter's capture() when it has one, and never its screenshot()", async () => {
    const screenshot = vi.fn(async () => Buffer.from('png'));
    const capture = vi.fn(async (): Promise<ScreenCapture> => ({ kind: 'rgba', image: image(1) }));
    const shot = await captureShot({ screenshot, capture });
    expect(shot.decode().data.equals(image(1).data)).toBe(true);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('takes screenshot() from an adapter without capture() (iOS, the fakes)', async () => {
    const shot = await captureShot({ screenshot: async () => Buffer.from('png bytes') });
    expect((await shot.png()).toString()).toBe('png bytes');
  });

  it('refuses a 0-byte PNG from either', async () => {
    const empty = /the device adapter returned an empty screenshot \(0 bytes\)/;
    await expect(captureShot({ screenshot: async () => Buffer.alloc(0) })).rejects.toThrow(empty);
    await expect(captureShot({ screenshot: async () => Buffer.from('x'), capture: async () => ({ kind: 'png', bytes: Buffer.alloc(0) }) })).rejects.toThrow(empty);
  });
});

describe('captureFrame over raw captures (D19)', () => {
  it('a still screen settles on two raw captures: compared as pixels, nothing encoded, nothing decoded', async () => {
    resetSleeps();
    const screenshot = vi.fn(async () => Buffer.from('png'));
    const captures: RawImage[] = [image(1), image(1)];
    const adapter = {
      screenshot,
      capture: async (): Promise<ScreenCapture> => ({ kind: 'rgba', image: captures.shift()! }),
      uiTree: async () => {
        throw new Error('no tree asked for');
      },
      viewport: async () => ({ width: 4, height: 3 }),
    };
    const frame = await captureFrame(adapter);
    expect(frame.stability).toBe('settled');
    expect(frame.captures).toBe(2);
    expect(screenshot).not.toHaveBeenCalled();
    expect(decodePng(await frame.shot.png()).data.equals(image(1).data)).toBe(true);
  });

  it('a raw capture that changes is moving, its last capture returned', async () => {
    resetSleeps();
    let n = 0;
    const adapter = {
      screenshot: async () => Buffer.from('png'),
      capture: async (): Promise<ScreenCapture> => ({ kind: 'rgba', image: image(n++) }),
      uiTree: async () => {
        throw new Error('no tree asked for');
      },
      viewport: async () => ({ width: 4, height: 3 }),
    };
    const frame = await captureFrame(adapter);
    expect(frame.stability).toBe('moving');
    expect(frame.shot.decode().data[0]).toBe(n - 1);
  });
});
