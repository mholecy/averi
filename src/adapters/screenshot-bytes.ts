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
  throw new Error(
    `\`${source.command}\` on ${source.device} returned ${described(bytes)} — not a PNG, though the command reported success: ` +
      `the device transport failed (a dying or hung emulator / simulator), not the app's screen. ${source.remedy}`,
  );
}

/** "0 bytes", or the size and up to 60 characters of the start, non-printables as `.`. */
function described(bytes: Buffer): string {
  if (bytes.length === 0) return '0 bytes';
  const head = bytes.subarray(0, 60).toString('latin1').trim().replace(/[^\x20-\x7e]/g, '.');
  return `${bytes.length} bytes starting "${head}"`;
}
