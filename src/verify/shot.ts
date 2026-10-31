import { encodePng } from '../adapters/png-encode.js';
import type { DeviceAdapter, ScreenCapture } from '../adapters/types.js';
import { decodePng, type DecodedPng } from './png.js';

/**
 * ONE CAPTURE of the screen, as the pixel readers hold it (D19, docs/adr/0035-android-captures-raw-pixels.md): the
 * device's PNG (iOS; Android where the raw path is refused) or its raw pixels (Android's `screencap | gzip -1`), with
 * the other form made on demand, once:
 * - `decode()` — the pixels: a raw capture's as they are, a PNG's through verify/png.ts#decodePng, which throws on a
 *   damaged one (the caller words it). Memoized, the throw too: the region check and the frame's measurement decode a
 *   capture once between them, as a last-decode memo in capture.ts made sure before D19;
 * - `png()` — the bytes where a PNG leaves the process (the `screenshot` tool, `ensure_state`'s and a `verify` leg's
 *   image, a stored baseline, the OCR recognizer's file): the device's as they are, a raw capture's encoded on the
 *   host (adapters/png-encode.ts) — the one encode a frame pays, and only when someone asks;
 * - `equals()` — the stability wait's question: two PNGs by their bytes (the device's encoder is deterministic, as
 *   before D19), two raw captures by their pixels — no encode, no decode. A PNG beside a raw capture (the adapter
 *   fell back between them) by their decodes; one that does not decode equals nothing.
 */
export class Shot {
  /** A raw capture's PNG, once encoded. */
  #encoded: Promise<Buffer> | undefined;
  /** A PNG capture's pixels, once decoded — or its decode error. */
  #decoded: { image: DecodedPng } | { error: unknown } | undefined;

  private constructor(private readonly capture: ScreenCapture) {}

  static of(capture: ScreenCapture): Shot {
    return new Shot(capture);
  }

  /** A shot of PNG bytes — what an adapter without `capture()` hands back, and what a test fake serves. */
  static ofPng(bytes: Buffer): Shot {
    return new Shot({ kind: 'png', bytes });
  }

  /** The PNG: the device's bytes, or the raw capture encoded on the host — once. */
  png(): Promise<Buffer> {
    if (this.capture.kind === 'png') return Promise.resolve(this.capture.bytes);
    this.#encoded ??= encodePng(this.capture.image);
    return this.#encoded;
  }

  /** The pixels; throws decodePng's error for a PNG that does not decode, every time it is asked. */
  decode(): DecodedPng {
    if (this.capture.kind === 'rgba') return this.capture.image;
    if (this.#decoded === undefined) {
      try {
        this.#decoded = { image: decodePng(this.capture.bytes) };
      } catch (error) {
        this.#decoded = { error };
      }
    }
    if ('error' in this.#decoded) throw this.#decoded.error;
    return this.#decoded.image;
  }

  /** The pixels, or undefined when the PNG does not decode. */
  decoded(): DecodedPng | undefined {
    try {
      return this.decode();
    } catch {
      return undefined;
    }
  }

  /** The same screen: see the class doc for how each pair of forms is compared. */
  equals(other: Shot): boolean {
    const [a, b] = [this.capture, other.capture];
    if (a.kind === 'png' && b.kind === 'png') return a.bytes.equals(b.bytes);
    const [x, y] = [this.decoded(), other.decoded()];
    return x !== undefined && y !== undefined && x.width === y.width && x.height === y.height && x.data.equals(y.data);
  }
}

/**
 * One capture from `adapter`: its `capture()` when it has one (Android, D19), else its `screenshot()` (iOS, the test
 * fakes). Every capture of verify/capture.ts goes through here, and so does the eyes' one (verify/eyes.ts).
 *
 * A PNG of 0 bytes is refused here too (2026-10-08). The adapter is the owner of "these bytes are a screenshot" —
 * each platform refuses an empty or non-PNG result, and a raw frame of the wrong length, as a transport error naming
 * its device and command (adapters/screenshot-bytes.ts) — so in production this never fires; it is the wait's own
 * floor under that contract, for an adapter that breaks it: two empty buffers are equal, and before the adapters
 * checked, a dead emulator's two 0-byte captures came back as a SETTLED frame the `screenshot` tool returned with no
 * note. Length only, not the signature: the frames are opaque bytes to the wait (the tests' fakes use short tags),
 * and a non-PNG that reaches a measuring caller already fails its decode, with its own wording, in `captureFrame`.
 */
export async function captureShot(adapter: Pick<DeviceAdapter, 'screenshot' | 'capture'>): Promise<Shot> {
  const shot = adapter.capture !== undefined ? await adapter.capture() : ({ kind: 'png', bytes: await adapter.screenshot() } as const);
  if (shot.kind === 'png' && shot.bytes.length === 0) {
    throw new Error(
      'the device adapter returned an empty screenshot (0 bytes) — no frame can settle on nothing; ' +
        'DeviceAdapter.screenshot must throw on a failed capture instead (adapters/screenshot-bytes.ts)',
    );
  }
  return Shot.of(shot);
}
