import { describe, expect, it } from 'vitest';
import { outcome } from '../../scripts/truth/capture.js';

const manifest = { platform: 'android' as const, captures: [] };

describe("capture.ts's outcome: what the command line says of a run, and its exit code", () => {
  it('a clean run: nothing said, exit 0', () => {
    expect(outcome({ broken: [], skipped: ['x: built for ios only'], failed: [], manifest })).toEqual({ lines: [], exitCode: 0 });
  });

  it('a failed cell is said loudly, with its reason, and fails the run — as a broken one does', () => {
    const { lines, exitCode } = outcome({ broken: ['open/A: no touch'], skipped: [], failed: ['carousel-lazy: adb: device offline'], manifest });
    expect(exitCode).toBe(1);
    expect(lines).toEqual([
      "\nBROKEN CELLS — the truth's sources disagree:\n  open/A: no touch",
      '\nFAILED CELLS — the capture threw; nothing of them written this run (an earlier capture, if any, kept; manifest.json lists them under `failed`):\n  carousel-lazy: adb: device offline',
    ]);
    expect(outcome({ broken: [], skipped: [], failed: ['bad: x'], manifest }).exitCode).toBe(1);
  });
});
