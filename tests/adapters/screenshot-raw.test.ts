import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { screencapRaw, type ScreenshotSource } from '../../src/adapters/screenshot-bytes.js';
import { decodePng } from '../../src/verify/png.js';

/**
 * D19: Android captures with `screencap 2>/dev/null | gzip -1` — the raw frame, gzipped on the device — and screenshot-bytes.ts
 * judges what came back: a frame, a refusal of the raw path (the adapter then asks `screencap -p`), or a transport
 * error, the same one an empty `screencap -p` gives.
 */

const FIXTURES = fileURLToPath(new URL('../fixtures/screencap/', import.meta.url));
/** A real pair from the lab AVD (API 33, the `bands` cell), taken back to back: the gzipped raw stream as exec-out handed it over, and `screencap -p`. */
const RAW_GZ = readFileSync(`${FIXTURES}android-lab-bands-api33.raw.gz`);
const DEVICE_PNG = readFileSync(`${FIXTURES}android-lab-bands-api33.png`);

const SOURCE: ScreenshotSource = {
  device: 'device emulator-5554',
  command: "adb -s emulator-5554 exec-out 'screencap 2>/dev/null | gzip -1'",
  remedy: 'Re-check `adb devices` and retry.',
};

/** A raw stream: the header words (little-endian uint32), then the pixels. */
function raw(header: number[], pixels: Buffer): Buffer {
  const head = Buffer.alloc(header.length * 4);
  header.forEach((v, i) => head.writeUInt32LE(v, i * 4));
  return gzipSync(Buffer.concat([head, pixels]));
}

const PIXELS_2x3 = Buffer.from(Array.from({ length: 2 * 3 * 4 }, (_, i) => (i * 37) & 255));

describe('screencapRaw — the raw frame, or why not', () => {
  it("a real API 33 capture's pixels are its `screencap -p` PNG's, byte for byte", () => {
    const got = screencapRaw(RAW_GZ, SOURCE);
    expect('image' in got).toBe(true);
    const image = (got as { image: { width: number; height: number; data: Buffer } }).image;
    const png = decodePng(DEVICE_PNG);
    expect({ width: image.width, height: image.height }).toEqual({ width: 1080, height: 2220 });
    expect({ width: png.width, height: png.height }).toEqual({ width: 1080, height: 2220 });
    expect(Buffer.compare(image.data, png.data)).toBe(0);
  });

  it('reads the 16-byte header (API 28+: width, height, format, colour space)', () => {
    const got = screencapRaw(raw([2, 3, 1, 1], PIXELS_2x3), SOURCE);
    expect(got).toEqual({ image: { width: 2, height: 3, data: PIXELS_2x3 } });
  });

  it('reads the 12-byte header (before API 28: width, height, format)', () => {
    const got = screencapRaw(raw([2, 3, 1], PIXELS_2x3), SOURCE);
    expect(got).toEqual({ image: { width: 2, height: 3, data: PIXELS_2x3 } });
  });

  it('refuses the raw path for a format other than RGBA_8888 (RGBX_8888, RGB_565), naming it', () => {
    expect(screencapRaw(raw([2, 3, 2, 1], PIXELS_2x3), SOURCE)).toEqual({ refused: 'screencap wrote pixel format 2, not RGBA_8888 (1)', lasting: true });
    const rgb565 = PIXELS_2x3.subarray(0, 2 * 3 * 2);
    expect(screencapRaw(raw([2, 3, 4, 1], rgb565), SOURCE)).toEqual({ refused: 'screencap wrote pixel format 4, not RGBA_8888 (1)', lasting: true });
  });

  it('refuses the raw path when the device did not gzip (no gzip on it: the shell said so instead)', () => {
    expect(screencapRaw(Buffer.from('/system/bin/sh: gzip: inaccessible or not found\n'), SOURCE)).toEqual({
      refused: 'the device answered 48 bytes starting "/system/bin/sh: gzip: inaccessible or not found", not a gzip stream',
      lasting: true,
    });
    expect(screencapRaw(Buffer.from('sh: gzip: not found\n'), SOURCE)).toMatchObject({ lasting: true });
  });

  // screencap's stderr goes to /dev/null and its stdout into gzip, so what can come ahead of the stream is the shell's
  // own word (exec-out merges its stderr), or a stream cut short.
  it('any other answer that is not gzip is refused for this call only: no evidence the device lacks gzip (MINOR-1)', () => {
    for (const answer of ['Killed\n', "/system/bin/sh: can't fork: Try again\n", '\x1f']) {
      expect(screencapRaw(Buffer.from(answer, 'latin1'), SOURCE), JSON.stringify(answer)).toMatchObject({ lasting: false });
    }
  });

  it('an empty answer is the transport error an empty `screencap -p` gives', () => {
    expect(() => screencapRaw(Buffer.alloc(0), SOURCE)).toThrow(
      "`adb -s emulator-5554 exec-out 'screencap 2>/dev/null | gzip -1'` on device emulator-5554 returned 0 bytes — not a screenshot, " +
        'though the command reported success: the device transport failed (a dying or hung emulator / simulator), ' +
        "not the app's screen. Re-check `adb devices` and retry.",
    );
  });

  it('a gzip stream with nothing in it (screencap failed, its words in /dev/null; gzip ran) is refused for this call only', () => {
    // Round 3, NIT-1: not a transport error here — the adapter's `-p` then fails with the device's own message.
    expect(screencapRaw(gzipSync(Buffer.alloc(0)), SOURCE)).toEqual({ refused: 'screencap wrote an empty frame (0 bytes after gunzip)', lasting: false });
  });

  it('a gzip stream cut short is a transport error', () => {
    const cut = RAW_GZ.subarray(0, RAW_GZ.length >> 1);
    expect(() => screencapRaw(cut, SOURCE)).toThrow(/returned a damaged gzip stream \(\d+ bytes: .+\) — not a screenshot/);
  });

  it('a frame whose length is not its header plus width × height × 4 is a transport error, saying both', () => {
    const short = PIXELS_2x3.subarray(0, PIXELS_2x3.length - 8);
    expect(() => screencapRaw(raw([2, 3, 1, 1], short), SOURCE)).toThrow(
      /returned a 2x3 frame of 32 bytes, not the 16- or 12-byte header plus 24 pixel bytes — not a screenshot/,
    );
    const long = Buffer.concat([PIXELS_2x3, Buffer.alloc(4)]);
    expect(() => screencapRaw(raw([2, 3, 1, 1], long), SOURCE)).toThrow(/returned a 2x3 frame of 44 bytes/);
  });

  it('a frame of zero width or height is a transport error, not an image', () => {
    expect(() => screencapRaw(raw([0, 3, 1, 1], Buffer.alloc(0)), SOURCE)).toThrow(/returned a 0x3 frame/);
  });

  it('a frame shorter than any header is a transport error', () => {
    expect(() => screencapRaw(gzipSync(Buffer.alloc(8)), SOURCE)).toThrow(/returned a frame of 8 bytes, shorter than its header/);
  });
});
