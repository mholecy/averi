// A namespace import, as in verify/png.ts: `zlib.crc32` is missing before Node 22.2 / 20.15.
import { promisify } from 'node:util';
import * as zlib from 'node:zlib';
import type { RgbaImage } from './types.js';

/**
 * THE ONE PNG ENCODER (D19, docs/adr/0035-android-captures-raw-pixels.md): a raw capture (Android's
 * `screencap 2>/dev/null | gzip -1`) becomes a PNG on the host only where a PNG leaves the process — the `screenshot`
 * tool's image, `ensure_state`'s and a `verify` leg's final frame, a stored baseline, the OCR recognizer's input — and
 * `DeviceAdapter.screenshot()` (types.ts). An 8-bit RGBA PNG (colour type 6), one IDAT: verify/png.ts decodes it on its
 * fast path to the same bytes.
 *
 * Two settings, chosen per image by how it compresses (measured 2026-10-31 on 1080×2220 frames of the lab AVD; the
 * references are the device's own `screencap -p` — zlib level 6, adaptive filters, ~230 ms on the device — and pngjs
 * at zlib level 6 with adaptive filters):
 * - a UI screen (flat colour, text — and a photo region inside one): each row None or Up by its content
 *   (`scanlines`), level 6 — about 18–21 ms on a plain UI frame, 0.76–0.93× the device's PNG (bands 19.4 vs
 *   20.9 KB, text-sample 76 vs 100 KB, form-errors 102 vs 132 KB). With a photo strip, within about 1.1× of the pngjs
 *   reference (0.57–0.99× on three lab frames with 0, 150 and 400 rows of the launcher's photo pasted in; 46–87 ms
 *   with the photo rows); all-None was 16–19 ms but up to 1.30× with a photo strip;
 * - a photo (a wallpaper behind the launcher): Up, `Z_RLE`, level 1 — 41 ms, 1.12× the device's 1.33 MB. No filter at
 *   level 6 is 1.19× but 255 ms, Up at level 6 1.02× but 330 ms: the device's size costs what the raw path saved.
 * Which one: a sample of every 16th row deflated at level 1 (~0.6 ms on a UI screen, ~3 on a photo); under
 * `PHOTO_RATIO` it is a UI screen. Measured: UI screens 0.006–0.019, the launcher's photo 0.248.
 *
 * Async (zlib on the thread pool): the iOS leg of a `verify` run goes on while an Android frame encodes.
 */
export async function encodePng(image: RgbaImage): Promise<Buffer> {
  const { width, height } = image;
  const data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length);
  if (width <= 0 || height <= 0 || data.length !== width * height * 4) {
    throw new Error(`encodePng: a ${width}x${height} image needs ${width * height * 4} bytes, it has ${data.length}`);
  }
  const photo = (await compressedRatio(data, width, height)) >= PHOTO_RATIO;
  const filtered = scanlines(data, width, height, photo);
  const idat = await deflate(filtered, photo ? { level: 1, strategy: zlib.constants.Z_RLE } : { level: 6 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit, RGBA, deflate, adaptive filtering (method 0), not interlaced
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** At or above this sampled deflate ratio an image is a photo (see `encodePng`): between UI's ≤0.02 and a photo's 0.25. */
export const PHOTO_RATIO = 0.08;

const deflate = promisify(zlib.deflate);
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Every 16th row deflated at level 1: its compressed size over its size. */
async function compressedRatio(data: Buffer, width: number, height: number): Promise<number> {
  const rowBytes = width * 4;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 16) rows.push(data.subarray(y * rowBytes, (y + 1) * rowBytes));
  const sample = Buffer.concat(rows);
  return (await deflate(sample, { level: 1 })).length / sample.length;
}

/**
 * The scanlines, each with the filter its content wants — None or Up, the two that cost no per-byte arithmetic beyond
 * Up's word subtraction. A photo (`photo`) is Up on every row after the first. A UI screen chooses per row (D19
 * review, MINOR-2):
 * - a row identical to the one above is Up, all zeros (a flat UI is mostly these);
 * - a "noisy" row — more than a quarter of its pixels differ from their left neighbour: a photo strip, a gradient — is
 *   Up, which turns a smooth image into small numbers deflate folds;
 * - every other row (text, edges, flat runs) is None: deflate finds its runs and repeats as they are, and Up would
 *   only turn them into scattered differences.
 * The first row is None either way (nothing above it). Figures: `encodePng`'s header.
 */
function scanlines(data: Buffer, width: number, height: number, photo: boolean): Buffer {
  const rowBytes = width * 4;
  const out = Buffer.allocUnsafe(height * (rowBytes + 1));
  const aligned = data.byteOffset % 4 === 0 ? data : Buffer.from(data);
  const pixels = new Uint32Array(aligned.buffer, aligned.byteOffset, width * height);
  const noisy = width * NOISY_ROW;
  const row = new Uint32Array(width);
  const rowView = Buffer.from(row.buffer);
  for (let y = 0; y < height; y++) {
    const at = y * (rowBytes + 1);
    const from = y * rowBytes;
    if (y > 0 && !photo && aligned.compare(aligned, from - rowBytes, from, from, from + rowBytes) === 0) {
      out[at] = 2;
      out.fill(0, at + 1, at + 1 + rowBytes);
      continue;
    }
    if (y > 0 && (photo || changesInRow(pixels, y, width) > noisy)) {
      out[at] = 2;
      upRow(pixels, row, y, width);
      rowView.copy(out, at + 1);
    } else {
      out[at] = 0;
      aligned.copy(out, at + 1, from, from + rowBytes);
    }
  }
  return out;
}

/** Above this share of pixels differing from their left neighbour a UI screen's row is Up-filtered (`scanlines`). */
const NOISY_ROW = 0.25;

/** How many of row `y`'s pixels differ from their left neighbour. */
function changesInRow(pixels: Uint32Array, y: number, width: number): number {
  let changes = 0;
  for (let x = 1, i = y * width + 1; x < width; x++, i++) if (pixels[i] !== pixels[i - 1]) changes++;
  return changes;
}

/**
 * Row `y` (≥ 1) Up-filtered into `row`: each byte minus the one above it, modulo 256, four bytes a step — a pixel is
 * one 32-bit word, its lanes subtracted with the borrows kept out of the neighbouring byte (the inverse of
 * verify/png.ts's Up unfilter). Byte order does not matter, the lanes are independent.
 */
function upRow(pixels: Uint32Array, row: Uint32Array, y: number, width: number): void {
  for (let x = 0, i = y * width, up = i - width; x < width; x++, i++, up++) {
    const a = pixels[i]!;
    const b = pixels[up]!;
    row[x] = ((a | 0x80808080) - (b & 0x7f7f7f7f)) ^ ((a ^ ~b) & 0x80808080);
  }
}

/** A PNG chunk: length, type, data, and the CRC of type and data. */
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(data, crc32(head.subarray(4))) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** CRC-32 (PNG's, zlib's), continued from `seed`: Node's own where it has one, a table walk on an older Node 20. */
function crc32(data: Uint8Array, seed = 0): number {
  return typeof zlib.crc32 === 'function' ? zlib.crc32(data, seed) : tableCrc32(data, seed);
}

/** The CRC-32 an older Node 20 gets — exported for the test that holds it to `zlib.crc32`. */
export function tableCrc32(data: Uint8Array, seed = 0): number {
  let c = ~seed;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
