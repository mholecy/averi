import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec as defaultExec, ExecError, type ExecFn } from '../adapters/exec.js';
import { errorMessage } from '../util/error-message.js';

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
  /**
   * Rejects when nothing could be read at all. A rejection with
   * `OcrUnavailableError` is PERMANENT for this engine — no later call can
   * succeed — and the `ocr` assert ends at once on it (text-parity.ts#
   * measureOcrAssert); any other rejection is one failed read. For
   * `VisionOcr`, a missing or refusing `swiftc` is permanent for the whole
   * process, every later engine included (`swiftToolchain`).
   */
  recognize(png: Buffer, regions: OcrRegion[]): Promise<OcrRegionResult[]>;
}

/**
 * OCR cannot run with this engine, and asking again will not change that:
 * the host has no Vision, `swiftc` is missing or exits non-zero on its
 * probe, or the recognizer did not compile — `VisionOcr` memoizes its build,
 * so a failed one is the answer to every later call on the same instance (a
 * probe that timed out or hit EAGAIN is a plain error and is not memoized).
 * A missing or refusing `swiftc` goes further: the probe is memoized per
 * process (`swiftToolchain`), so it is every later engine's answer too, until
 * averi restarts. A class rather than a message match so the `ocr`
 * assert can tell "this engine will never read" from "this read failed":
 * until then the assert's catch swallowed both and polled a missing
 * compiler for the whole 12 s budget. Not a SetupError (flow/errors): the
 * assert fails closed with it as a reason and `assertAll` goes on; it never
 * ends a flow by itself.
 */
export class OcrUnavailableError extends Error {}

/**
 * Below this, a "recognized" string is noise rather than copy. Vision returned
 * 1.0 on every real UI string measured, so this only ever drops artifacts.
 */
const MIN_OCR_CONFIDENCE = 0.5;

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
 * An engine to recognize with, or the one reason there is none. Discriminated
 * so a caller cannot hold an engine AND a reason, and cannot read `engine`
 * without having ruled `unavailable` out.
 */
export type OcrEngineChoice =
  | { engine: OcrEngine; unavailable?: undefined }
  | { engine?: undefined; unavailable: string };

/**
 * THE engine-selection rule (2026-10-04): a supplied engine (the test seam —
 * the real one needs swiftc on macOS) is used as given; otherwise the host is
 * asked whether Vision can run here, and a `VisionOcr` is built only when it
 * can. Until now the `ocr` assert and the verify run's text table each wrote
 * this rule themselves — "ask the reason, then construct" — two copies a
 * third caller would have made three. Callers turn `unavailable` into a
 * failed assert or a SKIPPED note, never a pass (see ocrUnavailableReason).
 */
export function ocrEngineFor(override?: OcrEngine): OcrEngineChoice {
  if (override !== undefined) return { engine: override };
  const unavailable = ocrUnavailableReason();
  return unavailable === undefined ? { engine: new VisionOcr() } : { unavailable };
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
 * The probe timed out or the spawn was refused for want of resources
 * (EAGAIN) — a transient host condition, not the compiler's answer. The real
 * exec reports a spawn failure as an ExecError with no exit code and the
 * spawn's message (`spawn swiftc EAGAIN`), so the code is read off the message.
 */
const probeDidNotAnswer = (e: unknown): boolean =>
  (e instanceof ExecError && e.timedOut) || /\bEAGAIN\b/.test(errorMessage(e));

/**
 * The compiler's answer to `swiftc --version`, memoized per ExecFn (as in
 * adapters/xcode-env.ts): every Verifier builds its own VisionOcr, and every
 * flow step and verify leg its own Verifier, so a per-engine probe paid 0.1–0.5 s
 * per Verifier. Production engines all share the real exec, so the probe runs
 * once per process; a test's fake exec is a cache of its own.
 *
 * Which outcomes the process keeps:
 * - the version string — the binary cache key below is derived from it, and
 *   the on-disk check for that binary still runs per engine, so a binary the
 *   OS swept out of the temp dir is rebuilt rather than trusted;
 * - an `OcrUnavailableError` — the compiler is missing (ENOENT) or refused
 *   (a non-zero exit, e.g. no active developer dir). That is the host's
 *   answer; installing the Command Line Tools mid-process needs a restart of
 *   the server to be seen, the same as the xcode-env probe.
 * A probe that did not ANSWER (timed out, spawn refused with EAGAIN) says
 * nothing about the compiler, so it is dropped and the next engine probes
 * again. The compile is NOT memoized here: its failures (a timeout, a killed
 * swiftc, a full disk) are not reliably told apart from a real compile error,
 * so they stay the answer of the engines that asked for that compile only
 * (`VisionOcr#binary`, `VisionOcr#buildBinary`), and the next Verifier tries
 * again.
 */
const toolchainProbes = new WeakMap<ExecFn, Promise<string>>();

function swiftToolchain(exec: ExecFn): Promise<string> {
  let probe = toolchainProbes.get(exec);
  if (probe === undefined) {
    probe = probeSwiftToolchain(exec).catch((e: unknown) => {
      if (!(e instanceof OcrUnavailableError)) toolchainProbes.delete(exec);
      throw e;
    });
    toolchainProbes.set(exec, probe);
  }
  return probe;
}

async function probeSwiftToolchain(exec: ExecFn): Promise<string> {
  try {
    const { stdout } = await exec('swiftc', ['--version']);
    return stdout.toString('utf8');
  } catch (e) {
    // A probe that did not ANSWER says nothing about the compiler: a plain
    // error, not memoized, so one flaky probe does not fail every OCR read of
    // the process. A missing binary (ENOENT) or a non-zero exit is the
    // compiler's answer, and permanent.
    // One line: the reason ends up inside an assert's one-line fail-closed
    // sentence and the text table's note, and ExecError puts the spawn error
    // under its own line (`Command failed (exit null): swiftc --version⏎spawn
    // swiftc ENOENT`, device check 2026-10-08).
    const cause = errorMessage(e).replace(/\s*\n\s*/g, ' — ');
    if (probeDidNotAnswer(e)) {
      throw new Error(`the Swift compiler probe (\`swiftc --version\`) did not answer: ${cause}`);
    }
    throw new OcrUnavailableError(
      'OCR needs the Swift compiler: `swiftc --version` failed — install the Xcode Command Line ' +
        `Tools (xcode-select --install), then restart averi. Underlying error: ${cause}`,
    );
  }
}

/**
 * The compiles running in this process, by the binary they publish. Never a
 * cache of answers: an entry lives exactly as long as its compile (see
 * `VisionOcr#buildBinary`); the cache is the binary on disk.
 */
const compilesInFlight = new Map<string, Promise<string>>();

async function compileRecognizer(exec: ExecFn, dir: string, binary: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  // BOTH the source and the binary are per-BUILD until the compile is done.
  // A shared source path is not merely untidy: a second averi process
  // truncating and rewriting it mid-compile makes THIS process's swiftc fail
  // with a spurious syntax error in a file that looks perfectly valid
  // afterwards. The pid alone is not enough: it is reused across sandboxes
  // and containers sharing a temp dir, so a random suffix makes every build
  // its own. Rename is the only step that publishes anything.
  const staging = `${binary}.${process.pid}.${randomUUID()}`;
  const source = `${staging}.swift`;
  try {
    // Inside the try so a write that fails half-way (ENOSPC) removes its
    // partial source too. It stays OUTSIDE the compile's catch: a source that
    // could not be written says nothing about the compiler, so it is a plain
    // error the engine forgets, not an OcrUnavailableError.
    await writeFile(source, RECOGNIZER_SWIFT);
    try {
      await exec('swiftc', ['-O', '-o', staging, source], { timeoutMs: COMPILE_TIMEOUT_MS });
      await rename(staging, binary);
    } catch (e) {
      // A swiftc killed mid-link or a rename that failed leaves the staging
      // binary behind; nothing will ever publish it. A cleanup that fails must
      // not replace the compile's answer.
      await rm(staging, { force: true }).catch(() => {});
      throw new OcrUnavailableError(`the OCR recognizer did not compile (swiftc -O): ${errorMessage(e)}`);
    }
  } finally {
    await rm(source, { force: true }).catch(() => {});
  }
  return binary;
}

/**
 * Vision-backed engine. The recognizer is compiled ONCE and cached under the
 * system temp dir, keyed by a hash of the source and the toolchain version:
 * `swift <file>` recompiles on every invocation and that cost dominates a run
 * of 14 anchor reads. Same reasoning (and same shape) as the WDA build cache in
 * adapters/wda.ts. The toolchain version comes from the process-wide probe
 * (`swiftToolchain`), so a fresh engine costs one existence check of the
 * cached binary, not a `swiftc --version`.
 */
export class VisionOcr implements OcrEngine {
  private binaryPromise: Promise<string> | undefined;

  constructor(private readonly exec: ExecFn = defaultExec) {}

  async recognize(png: Buffer, regions: OcrRegion[]): Promise<OcrRegionResult[]> {
    const unavailable = ocrUnavailableReason();
    if (unavailable !== undefined) throw new OcrUnavailableError(unavailable);
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

  /**
   * Compile-once-and-cache; concurrent callers share one promise per instance
   * — a rejected one too when the rejection is an `OcrUnavailableError`: a
   * missing compiler or a failed compile is this instance's answer from then
   * on, so one Verifier's reads do not each pay a doomed compile. Any other
   * rejection is dropped and the next call builds again. A missing compiler is
   * also the process's answer (`swiftToolchain`); a failed compile is not, so
   * the next Verifier's engine compiles afresh. Across engines, concurrent
   * builds of one binary share ONE compile per process (`compilesInFlight`,
   * D15): an engine that joined a compile that failed keeps that failure as
   * its own answer, exactly as if it had compiled itself.
   */
  private binary(): Promise<string> {
    this.binaryPromise ??= this.buildBinary().catch((e: unknown) => {
      // Only a permanent failure is this instance's answer from then on; a
      // transient one (a probe that timed out, a spawn refused with EAGAIN)
      // is forgotten so the next read builds again.
      if (!(e instanceof OcrUnavailableError)) this.binaryPromise = undefined;
      throw e;
    });
    return this.binaryPromise;
  }

  private async buildBinary(): Promise<string> {
    const toolchain = await swiftToolchain(this.exec);
    const key = createHash('sha256').update(RECOGNIZER_SWIFT).update(toolchain).digest('hex').slice(0, 16);
    const dir = join(tmpdir(), 'averi-ocr-bin');
    const binary = join(dir, `recognizer-${key}`);
    if (existsSync(binary)) return binary;

    // One compile per binary per process (D15): an engine that finds a build
    // of the same binary in flight joins it. The entry is dropped when the
    // build settles, so nothing outlives it — a failed compile is the answer
    // of every engine that asked for it while it ran (each memoizes it in its
    // own `binary()`, exactly as if it had compiled itself: the same source on
    // the same toolchain), and the next engine to ask compiles afresh.
    let build = compilesInFlight.get(binary);
    if (build === undefined) {
      build = compileRecognizer(this.exec, dir, binary).finally(() => compilesInFlight.delete(binary));
      compilesInFlight.set(binary, build);
    }
    return build;
  }
}
