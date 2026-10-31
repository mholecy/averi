/**
 * What a device handed back for a screenshot, judged before anyone above the
 * adapter sees it (2026-10-08, the Android adapter review's candidate 3, its
 * screenshot half). The one owner of "these bytes are a screenshot".
 *
 * Why. `adb exec-out screencap -p` exits 0 with whatever the guest wrote:
 * the dump on the same transport was measured exiting 0 with `Killed`, then
 * with nothing at all, as the emulator died underneath it
 * (docs/bugs/2026-09-18-handoff-run5-and-finportal-login-findings.md, a1/a4;
 * the screencap shape itself is not measured, it is the same transport).
 * Until this module the adapter returned those bytes unchecked, and the
 * stability wait in verify/capture.ts compares two captures with
 * `Buffer.equals` — two empty buffers are equal, so a dead device came back
 * as a SETTLED 0-byte frame, the `screenshot` tool handed it to the agent as
 * an image with no note, and the one hint anyone got was the png decode
 * failure a measuring caller words later in verify/, by naming adb and simctl
 * commands from a layer that should know neither. `simctl io … screenshot`
 * has the same shape — it exits 0 and the file is read afterwards — so iOS
 * passes through here too.
 *
 * The check is the 8-byte PNG signature, not only the length: a guest that
 * says `Killed` on stdout is as dead as one that says nothing, and the
 * signature costs a compare of 8 bytes (no decode — capture.ts decodes only
 * when it measures). It is NOT a validity check of the whole png: a
 * truncated one still passes here and still fails capture.ts's decode, with
 * its own wording.
 *
 * Not here: why the transport failed. `adb get-state` (the Android adapter's
 * diagnoseDumpFailure) would say offline / unauthorized / slow, but it costs
 * up to 5 s and the review's candidate 3 moves that diagnosis into adb()
 * for every call — out of scope for this change.
 */

import * as zlib from 'node:zlib';
import { errorMessage } from '../util/error-message.js';
import type { RawImage } from './types.js';

/** Every PNG starts with these 8 bytes (PNG spec §5.2). */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Where the bytes came from, for the error: the device as the user knows it, and the command to re-run by hand. */
export interface ScreenshotSource {
  device: string;
  command: string;
  /** The platform's next step when it repeats — what to check, what to restart. */
  remedy: string;
}

/**
 * The bytes, when they start like a PNG; otherwise a transport error naming
 * the device, the command and what came back (0 bytes, or the size and the
 * first printable characters — `Killed`, an adb or simctl message).
 */
export function screenshotPng(bytes: Buffer, source: ScreenshotSource): Buffer {
  // A shorter buffer's subarray is shorter, so it is never equal: no separate length test.
  if (bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return bytes;
  }
  throw transportError(source, described(bytes), 'a PNG');
}

/**
 * The one wording of "the command succeeded and handed back no screenshot": what came back, what it should have been
 * (`expected`: a PNG from `screencap -p` / simctl / idb, a screenshot from the raw capture), and the remedy.
 */
function transportError(source: ScreenshotSource, what: string, expected = 'a screenshot'): Error {
  return new Error(
    `\`${source.command}\` on ${source.device} returned ${what} — not ${expected}, though the command reported success: ` +
      `the device transport failed (a dying or hung emulator / simulator), not the app's screen. ${source.remedy}`,
  );
}

/**
 * D19 (docs/adr/0035-android-captures-raw-pixels.md): Android's capture is `screencap 2>/dev/null | gzip -1` on the
 * device — the raw frame, gzipped where it is made, so neither the device's PNG encode (~230 ms on a lab screen, over
 * a second on a photo) nor the 9.6 MB raw transfer over exec-out (~11–30 MB/s) is paid. This judges what came back,
 * three ways:
 *
 * - a frame: the gunzipped stream is a header and `width × height × 4` bytes of RGBA_8888 — the header 16 bytes
 *   (API 28+: width, height, format, colour space) or 12 (before: no colour space), told apart by the length, which
 *   must be exactly one of the two. Its pixels are the device's `screencap -p` decoded, byte for byte (pinned on a
 *   real pair: tests/adapters/screenshot-raw.test.ts). The image is a view of the stream, not a copy;
 * - `refused`: the raw path gave no frame this time, though the device answered. `lasting` says whether it never
 *   will on this device — only on positive evidence (the D19 review, MINOR-1): the shell's word that there is no
 *   gzip (`gzip: not found`, `inaccessible or not found`), or a format other than RGBA_8888 (RGBX_8888's alpha is
 *   undefined, RGB_565 is another layout). Refused for this call only: an answer that is not a gzip stream otherwise —
 *   screencap's stdout is gzip's input and its stderr goes to /dev/null, so what comes ahead of the stream is the
 *   device shell's own (exec-out merges its stderr): `Killed` on a dying guest, a shell that could not fork — or a
 *   stream cut before its second byte; and an EMPTY frame — screencap failed, its own words ("Capturing failed.")
 *   went to /dev/null, and gzip compressed nothing (round 3, NIT-1). Either way the adapter captures with
 *   `screencap -p`, whose own check decides whether the device is alive (`screenshotPng`) — and for a failing
 *   screencap, `-p` hands back the device's message that the redirection dropped;
 * - a transport error, worded as `screenshotPng`'s: nothing at all came back, a gzip stream that breaks, or a length
 *   that is not the header plus the pixels — the raw counterpart of the signature check, and stronger. A stream cut
 *   in transit already fails gunzip (its trailer holds the length and a CRC); the length check catches screencap
 *   itself writing short. One shape it cannot tell: a 16-byte-header frame exactly 4 bytes short reads as a
 *   12-byte-header one, its pixels shifted by one.
 */
export function screencapRaw(bytes: Buffer, source: ScreenshotSource): RawVerdict {
  if (bytes.length === 0) throw transportError(source, '0 bytes');
  if (bytes[0] !== GZIP_MAGIC[0] || bytes[1] !== GZIP_MAGIC[1]) {
    return { refused: `the device answered ${described(bytes)}, not a gzip stream`, lasting: NO_GZIP.test(bytes.toString('latin1')) };
  }
  let frame: Buffer;
  try {
    // Sync: 1–2 ms for a UI frame's 9.6 MB, 7 ms for a photo's (up to ~22 under load, review round 1); the thread
    // pool's chunked inflate took 6–8 ms and ~4× the CPU on a UI frame (2026-10-31).
    frame = zlib.gunzipSync(bytes);
  } catch (e) {
    throw transportError(source, `a damaged gzip stream (${bytes.length} bytes: ${errorMessage(e)})`);
  }
  if (frame.length === 0) return { refused: 'screencap wrote an empty frame (0 bytes after gunzip)', lasting: false };
  if (frame.length < LEGACY_HEADER_BYTES) throw transportError(source, `a frame of ${frame.length} bytes, shorter than its header`);
  const width = frame.readUInt32LE(0);
  const height = frame.readUInt32LE(4);
  const format = frame.readUInt32LE(8);
  // Before the length: a format's bytes per pixel are its own (RGB_565: 2), and the adapter's fallback decides then.
  if (format !== RGBA_8888) return { refused: `screencap wrote pixel format ${format}, not RGBA_8888 (${RGBA_8888})`, lasting: true };
  const pixelBytes = width * height * 4;
  const header = [HEADER_BYTES, LEGACY_HEADER_BYTES].find((h) => frame.length === h + pixelBytes);
  if (width === 0 || height === 0 || header === undefined) {
    throw transportError(
      source,
      `a ${width}x${height} frame of ${frame.length} bytes, not the ${HEADER_BYTES}- or ${LEGACY_HEADER_BYTES}-byte header plus ${pixelBytes} pixel bytes`,
    );
  }
  return { image: { width, height, data: frame.subarray(header) } };
}

/** What `screencapRaw` makes of an answer that is not a transport error: a frame, or why not and whether for good. */
export type RawVerdict = { image: RawImage } | { refused: string; lasting: boolean };

const GZIP_MAGIC = [0x1f, 0x8b] as const;
/** The device's shell saying there is no gzip to run: toybox's sh (`inaccessible or not found`), mksh and others (`not found`). */
const NO_GZIP = /\bgzip\b[^\n]*\b(?:not found|inaccessible)/i;
/** screencap's raw header since API 28 (width, height, format, colour space) and before it (no colour space). */
const HEADER_BYTES = 16;
const LEGACY_HEADER_BYTES = 12;
/** android.graphics.PixelFormat.RGBA_8888 — the one format whose bytes are the PNG's pixels as they are. */
const RGBA_8888 = 1;

/** "0 bytes", or the size and up to 60 characters of the start, non-printables as `.`. */
function described(bytes: Buffer): string {
  if (bytes.length === 0) return '0 bytes';
  const head = bytes.subarray(0, 60).toString('latin1').trim().replace(/[^\x20-\x7e]/g, '.');
  return `${bytes.length} bytes starting "${head}"`;
}
