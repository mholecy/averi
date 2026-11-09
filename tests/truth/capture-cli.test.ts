import { describe, expect, it } from 'vitest';
import type { CaptureResult } from '../../scripts/truth/capture-run.js';
import { outcome } from '../../scripts/truth/capture.js';

const manifest = { platform: 'android' as const, captures: [] };
const result = (over: Partial<CaptureResult>): CaptureResult => ({ broken: [], skipped: [], failed: [], carried: [], manifest, ...over });

describe("capture.ts's outcome: what the command line says of a run, and its exit code", () => {
  it('a clean run: nothing said, exit 0, nothing to rethrow', () => {
    expect(outcome(result({ skipped: ['x: built for ios only'] }))).toEqual({ lines: [], exitCode: 0 });
  });

  it('a failed cell is said loudly, with its reason, and fails the run — as a broken one does', () => {
    const { lines, exitCode } = outcome(result({ broken: ['open/A: no touch'], failed: ['carousel-lazy: adb: device offline'] }));
    expect(exitCode).toBe(1);
    expect(lines).toEqual([
      "\nBROKEN CELLS — the truth's sources disagree:\n  open/A: no touch",
      '\nFAILED CELLS — the capture threw; nothing of them written this run (an earlier capture, if any, kept; manifest.json lists them under `failed`):\n  carousel-lazy: adb: device offline',
    ]);
    expect(outcome(result({ failed: ['bad: x'] })).exitCode).toBe(1);
  });

  it('a halt is said after the failures, exits 1; a bug in the capture is handed back to rethrow', () => {
    const halted = outcome(result({ failed: ['form-k: dock it first'], halted: { cell: 'form-k', reason: 'dock it first' } }));
    expect(halted.exitCode).toBe(1);
    expect(halted.lines.at(-1)).toBe('\nHALTED at form-k — dock it first; the cells after it were not captured');
    expect(halted.rethrow).toBeUndefined();
    const bug = new TypeError('x is undefined');
    expect(outcome(result({ failed: ['bad: TypeError: x is undefined'], halted: { cell: 'bad', reason: 'TypeError: x is undefined', bug } })).rethrow).toBe(bug);
  });

  it("failures carried from an earlier run are said, but do not fail this one", () => {
    expect(outcome(result({ carried: ['carousel-lazy: adb: device offline', 'b: y'] }))).toEqual({
      lines: ['\nstill failed from an earlier run (manifest.json `failed`): carousel-lazy: adb: device offline; b: y'],
      exitCode: 0,
    });
  });
});
