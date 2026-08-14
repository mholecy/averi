import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec as defaultExec, type ExecFn } from '../adapters/exec.js';

/**
 * Anchored OCR: what the user actually SEES inside an element's rect, read
 * back from the screenshot with the macOS Vision recognizer.
 *
 * Why it exists (measured 2026-08-14 on the live payment form, both platforms):
 * the accessibility tree is NOT a reliable record of rendered copy. On iOS,
 * SwiftUI collapses a card or button into ONE element whose `label` is the
 * authored accessibility summary — `credit_select` reads 'To account' while the
 * screen visibly says 'Select credit account', and the visible 'CONTINUE' is
 * absent from the tree entirely. Tree-only text parity therefore covered 2 of
 * the 7 payment-form anchors. OCR removes that ceiling: six anchors read at
 * confidence 1.0, strings exact, including both the tree cannot see.
 *
 * Two checks come out of ONE recognizer call:
 * - the rendered STRING (compared platform-to-platform and vs the contract), and
 * - the rendered INK HEIGHT — Vision returns a bounding box per string, so the
 *   type-size check needs no separate binarize-and-count-rows pass. Normalized
 *   by screen width it reproduced both validation pairs: `CONTINUE` android
 *   2.96% vs ios 2.99% (0.74% apart → PASS) and the top-bar title 3.80% vs
 *   3.32% (12.63% apart → FAIL), the latter being the 22sp-vs-17pt drift that
 *   shipped past every gate and was caught only by the owner's eye.
 *
 * Engine choice: Vision via `swiftc`, i.e. zero new dependencies — no brew, no
 * tesseract, no model download. `usesLanguageCorrection` stays OFF: UI copy is
 * not prose, and correction rewrites token-shaped and truncated strings.
 *
 * macOS only. Every caller must treat unavailability as SKIPPED-with-a-reason,
 * never as a pass — see `ocrUnavailableReason`.
 */

/** One anchor's rect in PNG PIXELS (tree rect x the png/tree scale). */
export interface OcrRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One recognized string. Box is in PNG pixels, origin top-left. */
export interface OcrLine {
  text: string;
  /** Vision's confidence for the top candidate, 0..1. */
  confidence: number;
  x: number;
  y: number;
  w: number;
  /** Ink height: the rendered glyph extent, NOT the line box. */
  h: number;
}

export interface OcrRegionResult {
  id: string;
  lines: OcrLine[];
  /** Set when this one region could not be read (e.g. rect outside the png). */
  error?: string;
}

export interface OcrEngine {
  recognize(png: Buffer, regions: OcrRegion[]): Promise<OcrRegionResult[]>;
}

/**
 * Below this, a "recognized" string is noise rather than copy. Vision returned
 * 1.0 on every real UI string measured, so this only ever drops artifacts.
 */
export const MIN_OCR_CONFIDENCE = 0.5;

/**
 * Why OCR cannot run here, or undefined when it can. Callers turn this into a
 * SKIPPED note — an unreadable screen must never look like a passing one.
 */
export function ocrUnavailableReason(): string | undefined {
  return process.platform === 'darwin'
    ? undefined
    : `OCR needs the macOS Vision framework (this host is ${process.platform})`;
}

/**
 * The recognizer, embedded rather than shipped as a .swift file so it survives
 * packaging (`files: [dist]`) with no build-step change.
 *
 * Contract: one JSON request on stdin, one JSON response on stdout. Boxes are
 * converted out of Vision's normalized bottom-left space into PNG pixels with a
 * top-left origin, and lines are sorted top-to-bottom then left-to-right —
 * Vision's own ordering is not guaranteed stable, and a comparator that diffs
 * strings needs a deterministic order.
 */
const RECOGNIZER_SWIFT = String.raw`
import Foundation
import Vision
import AppKit

struct Region: Decodable { let id: String; let x: Int; let y: Int; let w: Int; let h: Int }
struct Request: Decodable { let png: String; let regions: [Region] }
struct Line: Encodable { let text: String; let confidence: Double; let x: Int; let y: Int; let w: Int; let h: Int }
struct RegionResult: Encodable { let id: String; let lines: [Line]; let error: String? }
struct Response: Encodable { let results: [RegionResult] }

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(2)
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard let request = try? JSONDecoder().decode(Request.self, from: input) else {
    fail("ocr: could not decode the JSON request on stdin")
}
guard let image = NSImage(contentsOfFile: request.png),
      let full = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fail("ocr: could not read image at " + request.png)
}

var results: [RegionResult] = []
for region in request.regions {
    let box = CGRect(x: region.x, y: region.y, width: region.w, height: region.h)
    guard region.w > 0, region.h > 0, let cropped = full.cropping(to: box) else {
        results.append(RegionResult(id: region.id, lines: [], error: "region outside the screenshot"))
        continue
    }
    let request0 = VNRecognizeTextRequest()
    request0.recognitionLevel = .accurate
    // UI copy is not prose: correction rewrites token-shaped and truncated strings.
    request0.usesLanguageCorrection = false
    request0.recognitionLanguages = ["en-US"]
    do {
        try VNImageRequestHandler(cgImage: cropped, options: [:]).perform([request0])
    } catch {
        results.append(RegionResult(id: region.id, lines: [], error: "recognizer failed: \(error)"))
        continue
    }
    var lines: [Line] = []
    for observation in (request0.results ?? []) {
        guard let best = observation.topCandidates(1).first else { continue }
        let b = observation.boundingBox // normalized, origin bottom-left, relative to the CROP
        lines.append(Line(
            text: best.string,
            confidence: Double(best.confidence),
            x: region.x + Int((b.minX * CGFloat(cropped.width)).rounded()),
            y: region.y + Int(((1 - b.maxY) * CGFloat(cropped.height)).rounded()),
            w: Int((b.width * CGFloat(cropped.width)).rounded()),
            h: Int((b.height * CGFloat(cropped.height)).rounded())
        ))
    }
    // Deterministic reading order; Vision's own order is not guaranteed.
    lines.sort { $0.y != $1.y ? $0.y < $1.y : $0.x < $1.x }
    results.append(RegionResult(id: region.id, lines: lines, error: nil))
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
FileHandle.standardOutput.write(try encoder.encode(Response(results: results)))
`;

const COMPILE_TIMEOUT_MS = 180_000;
const RECOGNIZE_TIMEOUT_MS = 120_000;

/**
 * Vision-backed engine. The recognizer is compiled ONCE and cached under the
 * system temp dir, keyed by a hash of the source and the toolchain version:
 * `swift <file>` recompiles on every invocation and that cost dominates a run
 * of 14 anchor reads. Same reasoning (and same shape) as the WDA build cache in
 * adapters/wda.ts.
 */
export class VisionOcr implements OcrEngine {
  private binaryPromise: Promise<string> | undefined;

  constructor(private readonly exec: ExecFn = defaultExec) {}

  async recognize(png: Buffer, regions: OcrRegion[]): Promise<OcrRegionResult[]> {
    const unavailable = ocrUnavailableReason();
    if (unavailable !== undefined) throw new Error(unavailable);
    if (regions.length === 0) return [];

    const binary = await this.binary();
    const dir = await mkdtemp(join(tmpdir(), 'averi-ocr-'));
    const pngPath = join(dir, 'shot.png');
    try {
      await writeFile(pngPath, png);
      const request = JSON.stringify({
        png: pngPath,
        regions: regions.map((r) => ({
          id: r.id,
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.w),
          h: Math.round(r.h),
        })),
      });
      const { stdout } = await this.exec(binary, [], {
        stdin: request,
        timeoutMs: RECOGNIZE_TIMEOUT_MS,
      });
      const parsed = JSON.parse(stdout.toString('utf8')) as { results: OcrRegionResult[] };
      return parsed.results.map((r) => ({
        ...r,
        lines: (r.lines ?? []).filter((l) => l.confidence >= MIN_OCR_CONFIDENCE),
      }));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Compile-once-and-cache; concurrent callers share one promise per instance. */
  private binary(): Promise<string> {
    this.binaryPromise ??= this.buildBinary();
    return this.binaryPromise;
  }

  private async buildBinary(): Promise<string> {
    let toolchain: string;
    try {
      const { stdout } = await this.exec('swiftc', ['--version']);
      toolchain = stdout.toString('utf8');
    } catch (e) {
      throw new Error(
        'OCR needs the Swift compiler: `swiftc --version` failed — install the Xcode Command Line ' +
          `Tools (xcode-select --install). Underlying error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const key = createHash('sha256').update(RECOGNIZER_SWIFT).update(toolchain).digest('hex').slice(0, 16);
    const dir = join(tmpdir(), 'averi-ocr-bin');
    const binary = join(dir, `recognizer-${key}`);
    if (existsSync(binary)) return binary;

    await mkdir(dir, { recursive: true });
    // BOTH the source and the binary are per-process until the compile is done.
    // A shared source path is not merely untidy: a second averi process
    // truncating and rewriting it mid-compile makes THIS process's swiftc fail
    // with a spurious syntax error in a file that looks perfectly valid
    // afterwards. Rename is the only step that publishes anything.
    const source = `${binary}.${process.pid}.swift`;
    const staging = `${binary}.${process.pid}`;
    await writeFile(source, RECOGNIZER_SWIFT);
    try {
      await this.exec('swiftc', ['-O', '-o', staging, source], { timeoutMs: COMPILE_TIMEOUT_MS });
      await rename(staging, binary);
    } finally {
      await rm(source, { force: true });
    }
    return binary;
  }
}
