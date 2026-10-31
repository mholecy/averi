import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crc32, gunzipSync, inflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { encodePng, tableCrc32 } from '../../src/adapters/png-encode.js';
import { decodePng, fastDecode } from '../../src/verify/png.js';

/**
 * adapters/png-encode.ts: a raw capture becomes a PNG on the host (D19). Its pixels must come back from every decoder
 * as they went in — verify/png.ts's fast path (which must take it), and pngjs — and its size must stay near the
 * device's own PNG: the agent is sent it as base64.
 */

const FIXTURES = fileURLToPath(new URL('../fixtures/screencap/', import.meta.url));
/** A real API 33 frame (the lab's `bands` cell): the raw RGBA after its 16-byte header, and the device's PNG of it. */
const RAW = gunzipSync(readFileSync(`${FIXTURES}android-lab-bands-api33.raw.gz`));
const BANDS = { width: RAW.readUInt32LE(0), height: RAW.readUInt32LE(4), data: RAW.subarray(16) };
const DEVICE_PNG = readFileSync(`${FIXTURES}android-lab-bands-api33.png`);

/** A photo-like image: smooth gradients under per-pixel noise, which deflate cannot fold (a wallpaper's content). */
function photo(width: number, height: number): { width: number; height: number; data: Buffer } {
  const data = Buffer.alloc(width * height * 4);
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 24) & 31;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x + noise()) & 255;
      data[i + 1] = (y + noise()) & 255;
      data[i + 2] = (x * y + noise()) & 255;
      data[i + 3] = 255 - noise();
    }
  }
  return { width, height, data };
}

/** The filter type byte of every scanline, read back from the IDAT. */
function filterTypes(png: Buffer, width: number, height: number): Set<number> {
  const length = png.readUInt32BE(33);
  expect(png.toString('latin1', 37, 41)).toBe('IDAT');
  const scan = inflateSync(png.subarray(41, 41 + length));
  return new Set(Array.from({ length: height }, (_, y) => scan[y * (width * 4 + 1)]!));
}

/** Decoded by verify/png.ts's fast path and by pngjs, both to exactly `image`'s bytes. */
function expectRoundTrip(png: Buffer, image: { width: number; height: number; data: Buffer }): void {
  const fast = fastDecode(png);
  expect(fast, 'the fast path declined the encoded PNG').toBeDefined();
  expect({ width: fast!.width, height: fast!.height }).toEqual({ width: image.width, height: image.height });
  expect(Buffer.compare(fast!.data, image.data)).toBe(0);
  const reference = PNG.sync.read(png);
  expect(Buffer.compare(reference.data, image.data)).toBe(0);
}

describe('encodePng', () => {
  it("a real UI frame: decodes to the raw capture's bytes, which are the device PNG's", async () => {
    const png = await encodePng(BANDS);
    expectRoundTrip(png, BANDS);
    expect(Buffer.compare(decodePng(png).data, decodePng(DEVICE_PNG).data)).toBe(0);
  });

  it('a UI frame is stored unfiltered, and is no more than 1.15× the size of the device PNG', async () => {
    const png = await encodePng(BANDS);
    expect([...filterTypes(png, BANDS.width, BANDS.height)]).toEqual([0]);
    expect(png.length).toBeLessThanOrEqual(DEVICE_PNG.length * 1.15);
  });

  it('a photo is Up-filtered (the first row None) and decodes to its bytes', async () => {
    const image = photo(301, 207);
    const png = await encodePng(image);
    expect([...filterTypes(png, image.width, image.height)].sort()).toEqual([0, 2]);
    expectRoundTrip(png, image);
  });

  it('pixels under a byte-offset view (a raw frame after its header) are read from the view, not the buffer start', async () => {
    const image = photo(33, 17);
    const shifted = Buffer.concat([Buffer.from([1, 2, 3]), image.data]).subarray(3);
    expectRoundTrip(await encodePng({ ...image, data: shifted }), image);
  });

  it('refuses an image whose bytes are not width × height × 4', async () => {
    await expect(encodePng({ width: 2, height: 2, data: Buffer.alloc(15) })).rejects.toThrow('encodePng: a 2x2 image needs 16 bytes, it has 15');
  });

  it("the table CRC an older Node 20 uses is zlib's", () => {
    const bytes = Buffer.from('IHDR and some bytes after it');
    expect(tableCrc32(bytes)).toBe(crc32(bytes));
    expect(tableCrc32(bytes.subarray(4), tableCrc32(bytes.subarray(0, 4)))).toBe(crc32(bytes));
  });
});
