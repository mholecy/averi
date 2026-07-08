import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { z } from 'zod';
import type { DeviceAdapter } from '../adapters/types.js';
import { elementSpecSchema, parseDuration, type ElementSpec } from '../flow/config.js';
import { findBySpec } from '../flow/engine.js';

/**
 * Declarative checks (ARCHITECTURE.md §5). Three tiers, cheapest first:
 * element asserts (deterministic), agent-vision screenshots (not here — the
 * agent looks at `screenshot` output itself), pixel-diff vs. stored baseline.
 */

const elementAssert = z
  .object({
    element: elementSpecSchema,
    absent: z.boolean().optional(),
    text: z.string().optional(),
    match: z.string().optional(),
    timeout: z.union([z.number(), z.string()]).optional(),
  })
  .strict()
  .refine((a) => !(a.absent && (a.text !== undefined || a.match !== undefined)), {
    message: 'absent cannot be combined with text/match',
  });

const screenshotAssert = z
  .object({
    screenshot: z
      .object({
        baseline: z.string().describe('Baseline name; stored under .averi/baselines/<platform>/'),
        threshold: z.number().min(0).max(1).optional(),
      })
      .strict(),
  })
  .strict();

export const assertSpecSchema = z.union([elementAssert, screenshotAssert]);
export type AssertSpec = z.infer<typeof assertSpecSchema>;

export interface AssertResult {
  description: string;
  pass: boolean;
  detail?: string;
}

export interface VerifierOptions {
  baselineDir?: string;
  pollMs?: number;
  timeoutMs?: number;
}

export class Verifier {
  private readonly baselineDir: string;
  private readonly pollMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly adapter: DeviceAdapter,
    opts: VerifierOptions = {},
  ) {
    this.baselineDir = opts.baselineDir ?? '.averi/baselines';
    this.pollMs = opts.pollMs ?? 300;
    this.timeoutMs = opts.timeoutMs ?? 3_000;
  }

  async assertAll(specs: AssertSpec[]): Promise<AssertResult[]> {
    const results: AssertResult[] = [];
    for (const spec of specs) results.push(await this.assert(spec));
    return results;
  }

  async assert(spec: AssertSpec): Promise<AssertResult> {
    if ('screenshot' in spec) {
      return this.assertScreenshot(spec.screenshot.baseline, spec.screenshot.threshold ?? 0.01);
    }
    const timeoutMs = spec.timeout !== undefined ? parseDuration(spec.timeout) : this.timeoutMs;
    if (spec.absent) return this.assertAbsent(spec.element, timeoutMs);
    return this.assertElement(spec.element, spec.text, spec.match, timeoutMs);
  }

  private async assertElement(
    element: ElementSpec,
    text: string | undefined,
    match: string | undefined,
    timeoutMs: number,
  ): Promise<AssertResult> {
    const wants =
      text !== undefined ? ` with text ${JSON.stringify(text)}`
      : match !== undefined ? ` matching /${match}/`
      : '';
    const description = `element ${describe(element)}${wants} exists`;
    const deadline = Date.now() + timeoutMs;
    let lastSeen: string | undefined;
    for (;;) {
      const found = findBySpec(await this.adapter.uiTree(), element);
      const matching = found.filter((n) => {
        const values = [n.label, n.value].filter((v): v is string => v !== null);
        if (text !== undefined) return values.includes(text);
        if (match !== undefined) return values.some((v) => new RegExp(match).test(v));
        return true;
      });
      if (matching.length > 0) return { description, pass: true };
      if (found.length > 0) {
        lastSeen = found
          .slice(0, 3)
          .map((n) => JSON.stringify(n.label ?? n.value))
          .join(', ');
      }
      if (Date.now() >= deadline) {
        const detail =
          lastSeen !== undefined
            ? `element found but content was: ${lastSeen}`
            : `not found within ${timeoutMs}ms`;
        return { description, pass: false, detail };
      }
      await sleep(this.pollMs);
    }
  }

  private async assertAbsent(element: ElementSpec, timeoutMs: number): Promise<AssertResult> {
    const description = `element ${describe(element)} is absent`;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = findBySpec(await this.adapter.uiTree(), element);
      if (found.length === 0) return { description, pass: true };
      if (Date.now() >= deadline) {
        return { description, pass: false, detail: `still present after ${timeoutMs}ms` };
      }
      await sleep(this.pollMs);
    }
  }

  private async assertScreenshot(name: string, threshold: number): Promise<AssertResult> {
    const description = `screenshot matches baseline "${name}" (threshold ${threshold * 100}%)`;
    const path = join(this.baselineDir, this.adapter.platform, `${name}.png`);
    const current = await this.adapter.screenshot();

    let baseline: Buffer;
    try {
      baseline = await readFile(path);
    } catch {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, current);
      return { description, pass: true, detail: `baseline created at ${path}` };
    }

    const a = PNG.sync.read(baseline);
    const b = PNG.sync.read(current);
    if (a.width !== b.width || a.height !== b.height) {
      return {
        description,
        pass: false,
        detail: `size mismatch: baseline ${a.width}x${a.height}, current ${b.width}x${b.height}`,
      };
    }
    const diffPixels = pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: 0.1 });
    const ratio = diffPixels / (a.width * a.height);
    const pct = (ratio * 100).toFixed(2);
    return {
      description,
      pass: ratio <= threshold,
      detail: `${pct}% of pixels differ`,
    };
  }
}

/** Crash signatures per platform, scanned over recent device logs. */
const CRASH_PATTERNS: Record<'android' | 'ios', RegExp[]> = {
  android: [/FATAL EXCEPTION/, /ANR in /, /Force finishing activity/, /native crash/i, /SIGSEGV|SIGABRT/],
  ios: [
    /Terminating app due to uncaught exception/,
    /NSInvalidArgumentException|NSRangeException/,
    /EXC_BAD_ACCESS|EXC_CRASH/,
    /abort\(\) called/,
    /Fatal error:/,
  ],
};

/** Returns crash-related log lines (with a little trailing context for stack traces). */
export function scanForCrashes(lines: string[], platform: 'android' | 'ios'): string[] {
  const patterns = CRASH_PATTERNS[platform];
  const excerpt: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((p) => p.test(lines[i]))) {
      excerpt.push(...lines.slice(i, i + 8));
      i += 7;
    }
  }
  return excerpt;
}

function describe(spec: ElementSpec): string {
  return Object.entries(spec)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
    .join(' ');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
