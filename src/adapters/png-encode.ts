// A namespace import, as in verify/png.ts: `zlib.crc32` is missing before Node 22.2 / 20.15.
import { promisify } from 'node:util';
import * as zlib from 'node:zlib';
import type { RgbaImage } from './types.js';

/**
 * THE ONE PNG ENCODER (D19, docs/adr/0035-android-captures-raw-pixels.md): a raw capture (Android's
 * `screencap | gzip -1`) becomes a PNG on the host only where a PNG leaves the process — the `screenshot` tool's image,
 * `ensure_state`'s and a `verify` leg's final frame, a stored baseline, the OCR recognizer's input — and
 * `DeviceAdapter.screenshot()` (types.ts). An 8-bit RGBA PNG (colour type 6), one IDAT: verify/png.ts decodes it on its
 * fast path to the same bytes.
 *
 * Two settings, chosen per image by how it compresses (measured 2026-10-31 on 1080×2220 frames of the lab AVD, against
 * the device's own `screencap -p`, which is zlib level 6 with adaptive filters and costs ~230 ms on the device):
 * - a UI screen (flat colour, text): no filter, level 6 — 15–19 ms, 0.76–1.11× the device's PNG (bands 23 vs 21 KB,
 *   text-sample 78 vs 100 KB, form-errors 101 vs 132 KB). Filtering made these larger at every level tried (Up, Sub,
 *   Paeth: 1.0–1.9×) — the rows repeat, which deflate finds unfiltered;
 * - a photo (a wallpaper behind the launcher): Up, `Z_RLE`, level 1 — 39 ms, 1.12× the device's 1.33 MB. No filter at
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
  const filtered = photo ? upFiltered(data, width, height) : unfiltered(data, width, height);
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

/** The scanlines with filter type 0 (None) in front of each. */
function unfiltered(data: Buffer, width: number, height: number): Buffer {
  const rowBytes = width * 4;
  const out = Buffer.allocUnsafe(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    const at = y * (rowBytes + 1);
    out[at] = 0;
    data.copy(out, at + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  return out;
}

/**
 * The scanlines with filter type 2 (Up: each byte minus the one above it, modulo 256), the first row None. Four bytes
 * per step, a pixel being one 32-bit word: the lanes subtracted with the borrows kept out of the neighbouring byte —
 * the inverse of verify/png.ts's Up unfilter. Byte order does not matter, the lanes are independent.
 */
function upFiltered(data: Buffer, width: number, height: number): Buffer {
  const rowBytes = width * 4;
  const out = Buffer.allocUnsafe(height * (rowBytes + 1));
  const aligned = data.byteOffset % 4 === 0 ? data : Buffer.from(data);
  const pixels = new Uint32Array(aligned.buffer, aligned.byteOffset, width * height);
  const row = new Uint32Array(width);
  const rowView = Buffer.from(row.buffer);
  out[0] = 0;
  aligned.copy(out, 1, 0, rowBytes);
  for (let y = 1; y < height; y++) {
    for (let x = 0, i = y * width, up = i - width; x < width; x++, i++, up++) {
      const a = pixels[i]!;
      const b = pixels[up]!;
      row[x] = ((a | 0x80808080) - (b & 0x7f7f7f7f)) ^ ((a ^ ~b) & 0x80808080);
    }
    const at = y * (rowBytes + 1);
    out[at] = 2;
    rowView.copy(out, at + 1);
  }
  return out;
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
