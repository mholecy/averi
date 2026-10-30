// A namespace import, not `{ crc32 }`: Node 20.0–20.14 has no `zlib.crc32`, and a
// named import of a missing export fails the ESM link — the whole server would
// not start. Through the namespace it is only `undefined`, and the fast path steps aside.
import * as zlib from 'node:zlib';
import { PNG } from 'pngjs';

/**
 * THE ONE PNG DECODER of the pixel readers (capture's frame and stability wait,
 * the eyes, the screenshot diff). Its answer is pngjs's `PNG.sync.read` answer,
 * byte for byte — width, height and an 8-bit RGBA buffer, row-major: the fast
 * path takes only inputs pngjs decodes, to the same bytes, and every other input
 * is decoded by pngjs itself, so a PNG that does not decode throws pngjs's own
 * error and every caller's wording of a damaged capture is unchanged.
 *
 * Why not pngjs alone: on a full-screen capture (iOS 1206×2622, Android
 * 1080×2220) pngjs spends ~90 % of its 20–30 ms in its JavaScript unfilter and
 * bitmapper, one closure call and one fresh line Buffer per row, and zlib is
 * 2–3 ms of it. Every device screenshot this server takes is the same shape —
 * 8-bit RGBA (or RGB), not interlaced — so `fastDecode` handles exactly that
 * shape with native inflate and CRC and a flat typed-array unfilter, and hands
 * anything else to pngjs. Native image libraries (sharp) and WASM/napi decoders
 * were weighed and rejected: a per-platform binary breaks the `npx` install.
 */

/**
 * A decoded RGBA screenshot — what every pixel reader reads. Defined here, beside
 * its decoder, so the dependency runs one way (capture.ts imports this module and
 * re-exports the type); readers that only index the bytes accept any Uint8Array.
 */
export interface RgbaImage {
  width: number;
  height: number;
  /** 8-bit RGBA, row-major, `width * height * 4` bytes (every PNG variant is normalized to this). */
  data: Buffer | Uint8Array;
}

/** `decodePng`'s answer: an `RgbaImage` whose bytes are a Buffer (pixelmatch, `Buffer.compare`). */
export interface DecodedPng extends RgbaImage {
  data: Buffer;
}

/**
 * Decodes `bytes` as pngjs would: the fast path when it takes the input, pngjs
 * otherwise. The fast path never throws — it declines — so whatever throws here
 * is `PNG.sync.read` on an input the fast path declined: pngjs's error, worded
 * by pngjs.
 */
export function decodePng(bytes: Uint8Array): DecodedPng {
  const buffer = asBuffer(bytes);
  const fast = fastDecode(buffer);
  if (fast !== undefined) return fast;
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: png.data };
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Chunk types as big-endian uint32, the way they sit in the stream.
const IHDR = 0x49484452;
const IDAT = 0x49444154;
const IEND = 0x49454e44;
const PLTE = 0x504c5445;
const tRNS = 0x74524e53;
const gAMA = 0x67414d41;

/** IHDR colour types the fast path decodes, to their bytes per pixel. */
const BYTES_PER_PIXEL: Readonly<Record<number, number>> = { 2: 3, 6: 4 };

/** A CRC-32 (PNG's, zlib's) of `data`. */
type Crc32 = (data: Uint8Array) => number;

/**
 * `zlib.crc32` arrived in Node 22.2 / 20.15; the package supports Node 20, so
 * on an older 20 the fast path steps aside rather than checking CRCs in
 * JavaScript (that loop alone would cost a large part of what it saves).
 */
const nativeCrc: Crc32 | null = typeof zlib.crc32 === 'function' ? zlib.crc32 : null;

/** `bytes` as a Buffer view over the same memory — no copy — for its big-endian readers. */
function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
}

/**
 * The fast path: the decode of an 8-bit, non-interlaced RGB (colour type 2) or
 * RGBA (colour type 6) PNG, or `undefined` — "not mine, ask pngjs". It returns a
 * result only where it is byte-identical to pngjs, so it mirrors pngjs's PARSER
 * as well as the PNG spec. The rules, each with its reason:
 *
 * - Signature, then IHDR first (13 bytes), then chunks up to IEND, with nothing
 *   after IEND's CRC: pngjs throws on a bad signature, a first chunk that is not
 *   IHDR, a stream that ends early and trailing bytes after IEND, so each of
 *   those declines and pngjs words the error.
 * - CRC: pngjs checks the CRC of every chunk it reads (IHDR, IDAT, IEND, gAMA —
 *   and PLTE, tRNS) and throws on a mismatch, so the fast path checks the same
 *   chunks (natively) and declines on a mismatch — a corrupt capture must not
 *   decode here when pngjs would have refused it.
 * - Ancillary chunks pngjs does not know (sRGB, sBIT, eXIf, pHYs, iCCP, Apple's
 *   iDOT, APNG's acTL/fcTL/fdAT…) are skipped WITHOUT a CRC check, exactly as
 *   pngjs skips them; real screenshots carry them (iOS: sRGB+sBIT, Android:
 *   sRGB+eXIf), so declining on them would decline every capture. An unknown
 *   CRITICAL chunk declines (pngjs throws "Unsupported critical chunk type").
 * - gAMA is read for its CRC only: pngjs records the gamma on its result but
 *   never applies it to the pixels, and no caller reads it.
 * - tRNS declines: on an RGB image pngjs turns the pixels matching its colour
 *   key to transparent black (alpha AND colour zeroed). PLTE declines too —
 *   allowed as a suggested palette on a truecolour image, but rare enough that
 *   pngjs is the cheaper place to get it exactly right.
 * - Bit depth other than 8, colour types 0/3/4 (grey, palette, grey+alpha),
 *   interlacing, a compression or filter method other than 0, a zero width or
 *   height: pngjs's (or its error), never reimplemented here.
 * - The concatenated IDAT data must be one zlib stream, consumed to its last
 *   byte, that inflates cleanly to exactly `height * (1 + width * bpp)` bytes.
 *   Anything else declines and pngjs decides: a short, long or damaged stream,
 *   and bytes after the stream's end inside IDAT — Node's inflate ignores those,
 *   pngjs throws on them.
 * - A row whose filter byte is not 0–4 declines (pngjs throws on it).
 *
 * `crc32` is the CRC the chunks are checked with — Node's native one; `null`
 * (an older Node 20) declines every input. A parameter so that a test can stand
 * in for the older Node.
 *
 * Exported for the tests (tests/verify/png.test.ts), which pin which inputs the
 * fast path takes; no production importer — callers decode with `decodePng`.
 */
export function fastDecode(input: Uint8Array, crc32: Crc32 | null = nativeCrc): DecodedPng | undefined {
  if (crc32 === null) return undefined;
  const bytes = asBuffer(input);
  if (bytes.length < SIGNATURE.length || !bytes.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;

  let header: Header | undefined;
  const idat: Buffer[] = [];
  let offset = SIGNATURE.length;
  for (;;) {
    if (offset + 8 > bytes.length) return undefined;
    const length = bytes.readUInt32BE(offset);
    const type = bytes.readUInt32BE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) return undefined;
    if (header === undefined && type !== IHDR) return undefined;
    const crcOk = (): boolean => crc32(bytes.subarray(offset + 4, dataEnd)) >>> 0 === bytes.readUInt32BE(dataEnd);

    if (type === IHDR) {
      if (header !== undefined || length !== 13 || !crcOk()) return undefined;
      header = parseHeader(bytes.subarray(dataStart, dataEnd));
      if (header === undefined) return undefined;
    } else if (type === IDAT) {
      if (!crcOk()) return undefined;
      idat.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === gAMA) {
      if (length !== 4 || !crcOk()) return undefined;
    } else if (type === IEND) {
      if (!crcOk() || dataEnd + 4 !== bytes.length) return undefined;
      break;
    } else if (type === PLTE || type === tRNS) {
      return undefined;
    } else if ((bytes[offset + 4]! & 0x20) === 0) {
      return undefined; // an unknown critical chunk
    }
    offset = dataEnd + 4;
  }
  if (header === undefined || idat.length === 0) return undefined;

  const { width, height, bpp } = header;
  const rowBytes = width * bpp;
  const expected = height * (rowBytes + 1);
  const stream = idat.length === 1 ? idat[0]! : Buffer.concat(idat);
  let inflated: Buffer;
  try {
    const { buffer, engine } = zlib.inflateSync(stream, { maxOutputLength: expected, info: true }) as unknown as InflateInfo;
    if (engine.bytesWritten !== stream.length) return undefined; // bytes after the zlib stream
    inflated = buffer;
  } catch {
    return undefined;
  }
  if (inflated.length !== expected) return undefined;

  // RGBA unfilters straight into the result; RGB into a scratch image, expanded after.
  const out = Buffer.allocUnsafe(width * height * 4);
  const pixels = bpp === 4 ? out : Buffer.allocUnsafe(rowBytes * height);
  if (!unfilter(inflated, pixels, rowBytes, height, bpp)) return undefined;
  if (bpp === 3) {
    for (let src = 0, dst = 0; src < pixels.length; src += 3, dst += 4) {
      out[dst] = pixels[src]!;
      out[dst + 1] = pixels[src + 1]!;
      out[dst + 2] = pixels[src + 2]!;
      out[dst + 3] = 255;
    }
  }
  return { width, height, data: out };
}

/** `inflateSync` with `info: true` — its result and the engine, whose `bytesWritten` is the input it consumed. */
interface InflateInfo {
  buffer: Buffer;
  engine: { bytesWritten: number };
}

/** The IHDR fields the decode needs: the size, and bytes per pixel (3 for RGB, 4 for RGBA). */
interface Header {
  width: number;
  height: number;
  bpp: number;
}

/** The IHDR fields, or `undefined` when they are not the fast path's shape. */
function parseHeader(ihdr: Buffer): Header | undefined {
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const [depth, colorType, compression, filter, interlace] = [ihdr[8], ihdr[9], ihdr[10], ihdr[11], ihdr[12]];
  const bpp = BYTES_PER_PIXEL[colorType!];
  if (depth !== 8 || bpp === undefined || compression !== 0 || filter !== 0 || interlace !== 0) return undefined;
  if (width === 0 || height === 0) return undefined;
  return { width, height, bpp };
}

/**
 * Reverses the per-row filters of PNG spec §9.2 from `raw` (one filter byte,
 * then `rowBytes` bytes, per row) into `out` (rows packed, no filter bytes).
 * "Left" is the same channel one pixel back (`bpp` bytes, zero before the first
 * pixel); "up" is the decoded row above (zero on the first row). Stores into the
 * Uint8Array wrap modulo 256, which is the spec's arithmetic. `false` on a
 * filter type outside 0–4.
 *
 * Up is the filter screenshots are made of (≈90 % of rows on both platforms'
 * captures: a flat UI repeats the row above), so when rows are whole 32-bit
 * words (RGBA always is) it adds four bytes per step: copy the row, then add the
 * row above lane by lane with the carries kept out of the neighbouring byte —
 * the low seven bits of each byte summed, the top bit XORed back in. That alone
 * takes a full-screen decode from ~11 ms to ~5–8 ms. The lanes are independent,
 * so the platform's byte order does not matter.
 */
function unfilter(raw: Uint8Array, out: Uint8Array, rowBytes: number, height: number, bpp: number): boolean {
  const words = rowBytes % 4 === 0 && out.byteOffset % 4 === 0 ? new Uint32Array(out.buffer, out.byteOffset, out.length >> 2) : undefined;
  for (let y = 0; y < height; y++) {
    const filterType = raw[y * (rowBytes + 1)]!;
    const src = y * (rowBytes + 1) + 1;
    const row = y * rowBytes;
    const above = row - rowBytes; // negative on the first row: "up" is then 0
    switch (filterType) {
      case 0: // None
        out.set(raw.subarray(src, src + rowBytes), row);
        break;
      case 1: // Sub: + left
        for (let x = 0; x < bpp; x++) out[row + x] = raw[src + x]!;
        for (let x = bpp; x < rowBytes; x++) out[row + x] = raw[src + x]! + out[row + x - bpp]!;
        break;
      case 2: // Up: + up
        out.set(raw.subarray(src, src + rowBytes), row);
        if (y > 0) {
          if (words !== undefined) {
            for (let i = row >> 2, end = (row + rowBytes) >> 2, up = above >> 2; i < end; i++, up++) {
              const a = words[i]!;
              const b = words[up]!;
              words[i] = ((a & 0x7f7f7f7f) + (b & 0x7f7f7f7f)) ^ ((a ^ b) & 0x80808080);
            }
          } else for (let x = 0; x < rowBytes; x++) out[row + x] += out[above + x]!;
        }
        break;
      case 3: // Average: + floor((left + up) / 2)
        for (let x = 0; x < rowBytes; x++) {
          const left = x >= bpp ? out[row + x - bpp]! : 0;
          const up = y > 0 ? out[above + x]! : 0;
          out[row + x] = raw[src + x]! + ((left + up) >> 1);
        }
        break;
      case 4: // Paeth: + whichever of left, up, up-left is nearest left + up - upLeft
        for (let x = 0; x < rowBytes; x++) {
          const left = x >= bpp ? out[row + x - bpp]! : 0;
          const up = y > 0 ? out[above + x]! : 0;
          const upLeft = x >= bpp && y > 0 ? out[above + x - bpp]! : 0;
          const p = left + up - upLeft;
          const pLeft = Math.abs(p - left);
          const pUp = Math.abs(p - up);
          const pUpLeft = Math.abs(p - upLeft);
          out[row + x] = raw[src + x]! + (pLeft <= pUp && pLeft <= pUpLeft ? left : pUp <= pUpLeft ? up : upLeft);
        }
        break;
      default:
        return false;
    }
  }
  return true;
}
