import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { PNG, type PackerOptions } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { decodePng, fastDecode } from '../../src/verify/png.js';

/**
 * verify/png.ts is the one PNG decoder of the pixel readers. Its contract is
 * pngjs's answer, byte for byte: the fast path may only take an input whose
 * decode it reproduces exactly, and every other input — and every error — is
 * pngjs's own. So each test compares against `PNG.sync.read` (the reference
 * the callers used before), and the fast-path tests also pin WHICH inputs it
 * takes, or the equality would hold trivially through the fallback.
 */

const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url));

function pngsUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? pngsUnder(join(dir, e.name)) : e.name.endsWith('.png') ? [join(dir, e.name)] : [],
  );
}

/** pngjs's decode, the three fields every caller reads. */
function reference(bytes: Buffer): { width: number; height: number; data: Buffer } {
  const png = PNG.sync.read(bytes);
  return { width: png.width, height: png.height, data: png.data };
}

/** The fast path took `bytes` and its answer is pngjs's, byte for byte. */
function expectFastAndIdentical(bytes: Buffer): void {
  const fast = fastDecode(bytes);
  expect(fast, 'the fast path declined').toBeDefined();
  const want = reference(bytes);
  expect({ width: fast!.width, height: fast!.height }).toEqual({ width: want.width, height: want.height });
  expect(Buffer.compare(Buffer.from(fast!.data), want.data)).toBe(0);
  expect(Buffer.compare(decodePng(bytes).data, want.data)).toBe(0);
}

/** The fast path declined `bytes`, and `decodePng` is pngjs's answer — its pixels, or its error. */
function expectDeclinedToPngjs(bytes: Buffer): void {
  expect(fastDecode(bytes)).toBeUndefined();
  let want: ReturnType<typeof reference> | Error;
  try {
    want = reference(bytes);
  } catch (e) {
    want = e as Error;
  }
  if (want instanceof Error) {
    expect(() => decodePng(bytes)).toThrow(want.message);
  } else {
    const got = decodePng(bytes);
    expect({ width: got.width, height: got.height }).toEqual({ width: want.width, height: want.height });
    expect(Buffer.compare(got.data, want.data)).toBe(0);
  }
}

/** Deterministic noise, so every filter's predictors see varied left/up/up-left bytes. */
function noise(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let s = seed >>> 0;
  for (let i = 0; i < length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

/** An RGBA image encoded by pngjs's own packer (an independent filter implementation). */
function encoded(width: number, height: number, options: PackerOptions, seed = 1): Buffer {
  const png = new PNG({ width, height });
  noise(width * height * 4, seed).copy(png.data);
  return PNG.sync.write(png, options);
}

interface Chunk {
  type: string;
  data: Buffer;
  /** Overrides the computed CRC (a corrupt chunk). */
  crc?: number;
}

function chunksOf(png: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  for (let o = 8; o < png.length; ) {
    const length = png.readUInt32BE(o);
    chunks.push({ type: png.toString('latin1', o + 4, o + 8), data: png.subarray(o + 8, o + 8 + length) });
    o += 12 + length;
  }
  return chunks;
}

function pngOf(chunks: readonly Chunk[]): Buffer {
  const parts: Buffer[] = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  for (const c of chunks) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(c.data.length, 0);
    head.write(c.type, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(c.crc ?? crc32(Buffer.concat([head.subarray(4), c.data])) >>> 0, 0);
    parts.push(head, c.data, tail);
  }
  return Buffer.concat(parts);
}

/** `png` with `extra` inserted right after its IHDR. */
function withChunks(png: Buffer, ...extra: Chunk[]): Buffer {
  const [ihdr, ...rest] = chunksOf(png);
  return pngOf([ihdr!, ...extra, ...rest]);
}

function ihdr(width: number, height: number, depth: number, colorType: number, interlace = 0): Chunk {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data.set([depth, colorType, 0, 0, interlace], 8);
  return { type: 'IHDR', data };
}

/** A hand-built PNG whose rows are all filter 0 over `rows` (raw scanline bytes, no filter byte). */
function handBuilt(header: Chunk, rows: readonly Buffer[], ...extra: Chunk[]): Buffer {
  const raw = Buffer.concat(rows.flatMap((r) => [Buffer.from([0]), r]));
  return pngOf([header, ...extra, { type: 'IDAT', data: deflateSync(raw) }, { type: 'IEND', data: Buffer.alloc(0) }]);
}

/** Every row of `png` carries filter `type` — the premise of a per-filter test. */
function filterBytes(png: Buffer, rowBytes: number): Set<number> {
  const raw = inflateSync(Buffer.concat(chunksOf(png).filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const seen = new Set<number>();
  for (let o = 0; o < raw.length; o += rowBytes + 1) seen.add(raw[o]!);
  return seen;
}

describe('fastDecode on every fixture screenshot', () => {
  const files = pngsUnder(FIXTURES);

  it('finds the fixture corpus', () => {
    expect(files.length).toBeGreaterThanOrEqual(75);
  });

  it.each(files.map((f) => [f.slice(FIXTURES.length + 1), f]))('%s decodes on the fast path, byte-identical to pngjs', (_name, file) => {
    const bytes = readFileSync(file);
    const fast = fastDecode(bytes);
    expect(fast).toBeDefined();
    const want = reference(bytes);
    expect(fast!.width).toBe(want.width);
    expect(fast!.height).toBe(want.height);
    expect(Buffer.compare(Buffer.from(fast!.data), want.data)).toBe(0);
  });
});

describe('fastDecode on generated PNGs', () => {
  const sizes: ReadonlyArray<[number, number]> = [
    [1, 1],
    [7, 5],
    [33, 17],
  ];
  const filters = [
    [0, 'None'],
    [1, 'Sub'],
    [2, 'Up'],
    [3, 'Average'],
    [4, 'Paeth'],
  ] as const;
  for (const [colorType, bpp, name] of [
    [6, 4, 'RGBA'],
    [2, 3, 'RGB'],
  ] as const) {
    for (const [filterType, filterName] of filters) {
      it.each(sizes)(`${name}, every row ${filterName}, %i×%i`, (width, height) => {
        const png = encoded(width, height, { colorType, filterType }, width * 31 + filterType);
        expect(filterBytes(png, width * bpp)).toEqual(new Set([filterType]));
        expectFastAndIdentical(png);
      });
    }
    it(`${name}, rows mixing all five filters`, () => {
      const png = encoded(61, 40, { colorType, filterType: -1 }, 7);
      expect(filterBytes(png, 61 * bpp).size).toBeGreaterThan(1);
      expectFastAndIdentical(png);
    });
  }

  it('a full-width image whose row length is not a multiple of four (RGB, odd width)', () => {
    expectFastAndIdentical(encoded(1001, 3, { colorType: 2, filterType: 2 }, 3));
  });

  it('IDAT split across several chunks is one stream', () => {
    const png = encoded(40, 30, { colorType: 6, filterType: -1 }, 5);
    const chunks = chunksOf(png);
    const stream = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
    const split = [0, 1, 17, 18, stream.length].map((at, i, all) => stream.subarray(at, all[i + 1] ?? at));
    const idats = split.slice(0, -1).map((data) => ({ type: 'IDAT', data }));
    expect(idats.some((c) => c.data.length === 0)).toBe(false);
    const rebuilt = pngOf([chunks[0]!, ...idats, { type: 'IEND', data: Buffer.alloc(0) }]);
    expect(chunksOf(rebuilt).filter((c) => c.type === 'IDAT').length).toBe(4);
    expectFastAndIdentical(rebuilt);
  });

  it("skips the ancillary chunks real captures carry (sRGB, sBIT, eXIf, APNG's acTL), as pngjs does", () => {
    const png = encoded(9, 9, { colorType: 6 }, 9);
    expectFastAndIdentical(
      withChunks(
        png,
        { type: 'sRGB', data: Buffer.from([0]) },
        { type: 'sBIT', data: Buffer.from([8, 8, 8, 8]) },
        { type: 'acTL', data: Buffer.alloc(8, 1) },
        { type: 'eXIf', data: Buffer.from('MM\0*') },
      ),
    );
  });

  it('skips an ancillary chunk with a bad CRC — pngjs never checks the CRC of a chunk it skips', () => {
    expectFastAndIdentical(withChunks(encoded(5, 5, { colorType: 6 }, 2), { type: 'pHYs', data: Buffer.alloc(9), crc: 0xdeadbeef }));
  });

  it('reads gAMA for its CRC and does not apply it (pngjs records it, never applies it)', () => {
    const gamma = Buffer.alloc(4);
    gamma.writeUInt32BE(45455, 0);
    expectFastAndIdentical(withChunks(encoded(6, 4, { colorType: 2 }, 4), { type: 'gAMA', data: gamma }));
  });
});

describe('fastDecode declines what is not its shape; decodePng answers as pngjs does', () => {
  const rgba = (seed = 3): Buffer => encoded(8, 6, { colorType: 6, filterType: -1 }, seed);
  const ok = rgba();

  it('a palette image', () => {
    const plte = { type: 'PLTE', data: Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]) };
    expectDeclinedToPngjs(handBuilt(ihdr(3, 2, 8, 3), [Buffer.from([0, 1, 2]), Buffer.from([2, 1, 0])], plte));
  });

  it('greyscale and greyscale+alpha', () => {
    expectDeclinedToPngjs(encoded(5, 4, { colorType: 0 }));
    expectDeclinedToPngjs(encoded(5, 4, { colorType: 4 }));
  });

  it('16-bit RGBA', () => {
    expectDeclinedToPngjs(encoded(5, 4, { colorType: 6, bitDepth: 16 }));
  });

  it('an interlaced image — even a 1×1 one, whose single Adam7 pass is byte-for-byte a plain scanline', () => {
    expectDeclinedToPngjs(handBuilt(ihdr(1, 1, 8, 6, 1), [Buffer.from([10, 20, 30, 40])]));
  });

  it('tRNS on an RGB image — pngjs zeroes every pixel matching the colour key, colour and alpha', () => {
    const rows = [Buffer.from([1, 2, 3, 9, 9, 9]), Buffer.from([1, 2, 3, 1, 2, 4])];
    const key = Buffer.from([0, 1, 0, 2, 0, 3]);
    const png = handBuilt(ihdr(2, 2, 8, 2), rows, { type: 'tRNS', data: key });
    expect([...reference(png).data.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    expectDeclinedToPngjs(png);
  });

  it('PLTE on a truecolour image (a suggested palette)', () => {
    expectDeclinedToPngjs(withChunks(ok, { type: 'PLTE', data: Buffer.from([1, 2, 3]) }));
  });

  it('a bad CRC on IHDR, IDAT, gAMA or IEND — pngjs throws, and so does decodePng with its error', () => {
    const chunks = chunksOf(withChunks(ok, { type: 'gAMA', data: Buffer.from([0, 0, 177, 143]) }));
    for (const type of ['IHDR', 'IDAT', 'gAMA', 'IEND']) {
      const corrupt = pngOf(chunks.map((c) => (c.type === type ? { ...c, crc: 1 } : c)));
      expect(() => PNG.sync.read(corrupt), type).toThrow(); // its wording varies with where the parse stops
      expectDeclinedToPngjs(corrupt);
    }
  });

  it('a truncated file, at every cut', () => {
    for (const cut of [4, 8, 20, 33, ok.length - 30, ok.length - 12, ok.length - 1]) expectDeclinedToPngjs(ok.subarray(0, cut));
  });

  it('a bad signature', () => {
    const png = Buffer.from(ok);
    png[1] = 0x51;
    expectDeclinedToPngjs(png);
  });

  it('bytes after IEND', () => {
    expectDeclinedToPngjs(Buffer.concat([ok, Buffer.from([0])]));
  });

  it('an unknown critical chunk', () => {
    expectDeclinedToPngjs(withChunks(ok, { type: 'ZZZZ', data: Buffer.alloc(2) }));
  });

  it('a chunk before IHDR', () => {
    const [head, ...rest] = chunksOf(ok);
    expectDeclinedToPngjs(pngOf([{ type: 'sRGB', data: Buffer.from([0]) }, head!, ...rest]));
  });

  it('a filter byte outside 0–4', () => {
    expectDeclinedToPngjs(pngOf([ihdr(1, 1, 8, 6), { type: 'IDAT', data: deflateSync(Buffer.from([5, 1, 2, 3, 4])) }, { type: 'IEND', data: Buffer.alloc(0) }]));
  });

  it('an image stream shorter or longer than the header says', () => {
    const short = Buffer.from([0, 1, 2, 3, 4, 0, 1, 2, 3]);
    const long = Buffer.from([0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 9, 9, 9, 9]);
    // pngjs's answer to a SHORT stream reads memory it never wrote (its inflate allocates
    // unfilled), so it is not reproducible call to call — only the decline is pinned there.
    expect(fastDecode(pngOf([ihdr(1, 2, 8, 6), { type: 'IDAT', data: deflateSync(short) }, { type: 'IEND', data: Buffer.alloc(0) }]))).toBeUndefined();
    expectDeclinedToPngjs(pngOf([ihdr(1, 2, 8, 6), { type: 'IDAT', data: deflateSync(long) }, { type: 'IEND', data: Buffer.alloc(0) }]));
  });

  it('a damaged deflate stream', () => {
    const idat = Buffer.from(deflateSync(Buffer.from([0, 1, 2, 3, 4, 0, 5, 6, 7, 8])));
    idat[idat.length - 1] ^= 0xff; // the Adler-32 checksum
    expectDeclinedToPngjs(pngOf([ihdr(1, 2, 8, 6), { type: 'IDAT', data: idat }, { type: 'IEND', data: Buffer.alloc(0) }]));
  });

  it('a file with no IDAT', () => {
    // pngjs, again, decodes memory it never wrote here — only the decline is pinned.
    expect(fastDecode(pngOf([ihdr(1, 1, 8, 6), { type: 'IEND', data: Buffer.alloc(0) }]))).toBeUndefined();
  });
});
