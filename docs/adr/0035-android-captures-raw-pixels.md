# 35. Android captures raw pixels; a PNG is encoded on the host only where one leaves the process

Status: accepted 2026-10-31 (performance backlog row D19, docs/plans/2026-10-30-performance-backlog.md, with D5's
measurements). Implemented on `perf/d19-raw-capture`.

## Context

- Every Android capture was `adb exec-out screencap -p`: the device encodes a PNG (zlib level 6, adaptive filters) and
  averi decodes it again to compare or measure (verify/png.ts). A `screenshot` call takes 2–4 captures, a colour assert
  2 per poll round, a baseline up to 6.
- Measured 2026-10-31 on the lab AVD (averi_lab, API 33, 1080×2220), n=10 per path, interleaved, medians:

  | screen | `screencap -p` | `screencap \| gzip -1` | `shell screencap <f>` + `pull` (+ `rm`) | raw `exec-out screencap` |
  |---|---|---|---|---|
  | lab cells (bands, text-sample, form-errors, form-keyboard) | 101–104 | 77–79 | 110 (155) | 321 |
  | Settings | 103 | 76 | 121 (bg `rm`) | — |
  | launcher, photo wallpaper | 446 | 171 | 110 (155) | — |

  `-p` grows with the content (the device's encode); exec-out moves a 9.6 MB raw frame slowly; pull is flat but leaves
  a 9.6 MB file to remove — a third adb call (+45 ms), a leftover when the server is killed between the two, and a name
  that concurrent servers must not share. Pure noise (the worst case for gzip, a frame no screen shows) costs ~380 ms
  through `gzip -1`, still under `-p` on a photo.
- The raw frame's pixels equal `decodePng` of the device's PNG byte for byte (D5: 6 lab screens; here 4 more and the
  launcher; pinned by tests/adapters/screenshot-raw.test.ts on a real pair).

## Decision

**Android captures with `exec-out 'screencap | gzip -1'` — raw RGBA, gzipped on the device, no file — and keeps it as
pixels. A PNG is encoded on the host only where one leaves the process.**

- `DeviceAdapter.capture?(): Promise<ScreenCapture>` — optional, Android's: `{ kind: 'rgba', image }`, or
  `{ kind: 'png', bytes }` on a device that refuses the raw path. `screenshot()` stays a PNG Buffer: the capture,
  encoded on the host when it is pixels. iOS and every fake keep `screenshot()` alone.
- adapters/screenshot-bytes.ts#screencapRaw judges the answer, as `screenshotPng` judges a PNG: a frame (header 16
  bytes on API 28+, 12 before, told apart by the length, which must be exactly header + w·h·4); a REFUSAL (not a gzip
  stream; a format other than RGBA_8888); or a transport error (0 bytes, a damaged gzip stream, an empty frame, a
  wrong length). On a refusal the adapter captures with `screencap -p`, whose check decides whether the device is
  alive. Only a LASTING refusal — positive evidence that the raw path never works on this device: the shell's
  `gzip: not found` / `inaccessible or not found`, or a format other than RGBA_8888 — pins the adapter to `-p`, once
  `-p` has succeeded, and says so once on stderr with its reason. Any other non-gzip answer (`Killed`, screencap's
  "Capturing failed." or a multi-display warning on stdout, a stream cut after one byte) costs that call a `-p` and
  pins nothing (amended after review round 1, MINOR-1: the first cut pinned on any of them). So a device without
  gzip pays today's cost, never more, and a dying one says what it said before.
- verify/shot.ts#Shot is one capture in either form, the other made on demand once: `equals` (two raw captures by
  pixels, two PNGs by bytes), `decode()`, `png()`. `Frame.shot` is a Shot. The stability wait, the baseline
  confirmations and the eyes capture through `captureShot` (the adapter's `capture()` when it has one) and never
  encode or decode a raw frame.
- `png()` is called by the `screenshot` tool, `ensure_state` and a `verify` leg (the image), a created baseline (the
  file), and the OCR recognizer (its input file). adapters/png-encode.ts is the one encoder, async on the thread pool:
  a UI screen at level 6 with each row None or Up by its content — Up for a row identical to the one above or one
  where more than a quarter of the pixels differ from their left neighbour (a photo strip), None otherwise — 17–21 ms,
  0.76–0.93× the device's PNG on lab frames, and 0.57–0.99× zlib 6 with pngjs's adaptive filters on lab frames with
  0, 150 or 400 rows of a photo pasted in (45–85 ms with them). Round 1 had every UI row unfiltered: up to 1.30× (the
  reviewer measured ~1.4×) on a UI screen with a photo region. A whole photo is Up-filtered with `Z_RLE` at level 1
  (41 ms; 1.12× the device's), chosen by a sampled deflate ratio (every 16th row at level 1: UI ≤ 0.02, photo 0.25;
  the line at 0.08). Matching the device's size on a photo costs 250–330 ms, which is what the raw path saved.

## Consequences

- Per capture, lab screens: −22…27 ms; photo screens: −275 ms. A frame that is measured skips its decode (5–8 ms),
  and the one PNG a tool returns costs 17–41 ms on the host. The gunzip is synchronous: 1–2 ms for a UI frame's
  9.6 MB, 7 ms for the launcher's photo (the reviewer measured ~22 under load), where the thread pool's chunked
  inflate took 6–8 ms and ~4× the CPU on a UI frame (it ate the lab-screen gain in the first A/B).
- A settled two-capture frame plus its PNG (captureFrame + `png()`, n=10 interleaved, medians): the launcher's photo
  1240 → 717 ms; text-sample 529 → 518; the `open` cell 501 → 469. scripts/perf/baseline.ts (5 repeats, medians; main
  run twice, the host's drift between them as large as the change): `screenshot` 1437 / 1387 → 1370 ms, `color`
  2664 / 2609 → 2588, `ensure-cold` 9005 / 8939 → 9017 (its 2 captures 273 → 203 ms, under ~8 s of tree dumps). On the
  lab's flat screens the gain is small; on content that makes `-p` slow it is ~0.5 s a frame. Host CPU (gunzip,
  compare, encode; the device-side `-p` cost no host CPU): one settled frame plus its PNG +34 ms on a UI screen
  (3 → 37), +119 ms on the photo (16 → 135); baseline.ts's `screenshot` call on the lab `open` cell, which takes 4
  captures, 14 → 159 ms, the instrumented MCP server's figure.
- The PNG an agent receives from Android is averi's, not the device's: the same pixels; on lab UI frames smaller
  than the device's (0.76–0.93×), on a full photo 1.12×. Pinned by tests/verify/baseline-raw-compat.test.ts: a
  device-PNG baseline equals a raw capture of the same frame at threshold 0. Stored baselines are averi's PNGs; ones stored before compare by pixels, as
  every baseline always did.
- `gzip` is toybox's (Android 9+ ships it; older images may not): a device without it falls back once, then stays on
  `-p`. RGBX_8888 and RGB_565 devices fall back the same way — not measured, no lab device has them.
- adapters depends on nothing above it: the encoder and the `RgbaImage` type live in adapters/ (verify/png.ts
  re-exports the type); verify/shot.ts imports the encoder downward.
- A device without gzip is told by its shell's wording (`screenshot-bytes.ts`'s NO_GZIP); a shell that words it
  otherwise is refused call by call — each capture tries raw, then `-p` — slower than pinned, never wrong.
- One shape the length check cannot tell: a 16-byte-header frame exactly 4 bytes short reads as a 12-byte-header one.
  A stream cut in transit fails gunzip first (its trailer carries the length and a CRC).
