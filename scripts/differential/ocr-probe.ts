import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Whether the golden mode's `ocr` rows can be asked on this host (golden.ts#ocrAvailability) — decided by the HARNESS's
 * own minimal recognizer, never by the src under test: a src recognizer that does not compile, reads nothing or reads
 * wrong must turn the rows red, not skip them. The rows are skipped only on the named host conditions (ocrSkip): not
 * macOS, no `swiftc`, or Vision refusing to run with `nilError` (what it answers inside a sandbox). Anything else —
 * the probe failing to compile, reading nothing — asks the rows, each side's own recognizer then judged by them.
 */

/** Vision on a whole PNG: the strings it reads, one per line — or `ERROR <error>` when the request fails. */
export const PROBE_SWIFT = String.raw`
import Foundation
import Vision
import AppKit

let path = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: path), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("ERROR could not read " + path)
    exit(0)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
do {
    try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
} catch {
    print("ERROR \(error)")
    exit(0)
}
for o in request.results ?? [] { if let c = o.topCandidates(1).first { print(c.string) } }
`;

/** What the probe saw of the host, as ocrSkip reads it. */
export interface ProbeOutcome {
  platform: NodeJS.Platform;
  /** `swiftc --version` failed: its error code (`ENOENT`: no compiler) and message. Absent when it answered. */
  compiler?: { code?: unknown; message: string };
  /** What `swiftc --version` answered: the toolchain every recognizer (the probe's, each side's) is compiled with. */
  toolchain?: string;
  /** The probe's output (its readings, or `ERROR …`), or why it could not be built or run. */
  run?: { stdout: string } | { error: string };
}

/**
 * The one rule: the reason to skip the `ocr` rows on this host, or undefined to ask them. Skipped only on not macOS, no
 * `swiftc` (ENOENT), or Vision answering `nilError`; any other failure asks the rows (their own recognizers judged).
 */
export function ocrSkip(o: ProbeOutcome): string | undefined {
  if (o.platform !== 'darwin') return `the macOS recognizer: this host is ${o.platform}`;
  if (o.compiler !== undefined && o.compiler.code === 'ENOENT') return 'no swiftc on this host (ENOENT)';
  // Only the probe's own error line (PROBE_SWIFT: `ERROR <error>` on stdout): a string Vision READ can never skip.
  if (o.run !== undefined && 'stdout' in o.run && /^ERROR .*\bnilError\b/m.test(o.run.stdout)) return 'Vision answers nilError (it does not run here: a sandbox)';
  return undefined;
}

type HostExec = (cmd: string, args: string[]) => Promise<{ stdout: Buffer; stderr: string }>;

/** Runs the probe on `png` with the host's processes: compiled once per toolchain into the temp dir. */
export async function probeRecognizer(exec: HostExec, png: string): Promise<ProbeOutcome> {
  const platform = process.platform;
  if (platform !== 'darwin') return { platform };
  let toolchain: string;
  try {
    toolchain = (await exec('swiftc', ['--version'])).stdout.toString('utf8');
  } catch (e) {
    return { platform, compiler: { code: (e as { code?: unknown }).code, message: e instanceof Error ? e.message : String(e) } };
  }
  const key = createHash('sha256').update(PROBE_SWIFT).update(toolchain).digest('hex').slice(0, 16);
  const dir = join(tmpdir(), 'averi-golden-ocr-probe');
  const binary = join(dir, `probe-${key}`);
  try {
    if (!existsSync(binary)) {
      await mkdir(dir, { recursive: true });
      const source = `${binary}.${process.pid}.swift`;
      await writeFile(source, PROBE_SWIFT);
      try {
        await exec('swiftc', ['-O', '-o', `${binary}.${process.pid}`, source]);
        await rename(`${binary}.${process.pid}`, binary);
      } finally {
        await rm(source, { force: true });
      }
    }
    return { platform, toolchain, run: { stdout: (await exec(binary, [png])).stdout.toString('utf8') } };
  } catch (e) {
    return { platform, toolchain, run: { error: e instanceof Error ? e.message : String(e) } };
  }
}

/** The image the harness's probe reads (any committed screenshot: only whether Vision runs at all is asked of it). */
const OCR_PROBE_PNG = fileURLToPath(new URL('../../tests/fixtures/truth/ios-iphone17-ios27/form-basic.png', import.meta.url));

/**
 * The harness's probe (probeRecognizer on its own image): what golden.ts#ocrAvailability decides the `ocr` rows by, and
 * what calibrate's side cache keys the host by (side-cache.ts#thisHost) — one probe, so the two cannot disagree.
 */
export const probeHarness = (exec: HostExec): Promise<ProbeOutcome> => probeRecognizer(exec, OCR_PROBE_PNG);

/**
 * What golden does with the probe's verdict (golden.ts#ocrAvailability): `ask` the rows (no reason to skip), `skip`
 * them with the reason — or, under `GOLDEN_OCR=require`, throw it: a run that must judge the rows cannot pass without.
 */
export function ocrDecision(why: string | undefined, env: Record<string, string | undefined>): { ask: true } | { ask: false; skip: string } {
  if (why === undefined) return { ask: true };
  if (env.GOLDEN_OCR === 'require') throw new Error(`GOLDEN_OCR=require, but the ocr rows cannot be asked here: ${why}`);
  return { ask: false, skip: why };
}
