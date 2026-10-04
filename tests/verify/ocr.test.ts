import { describe, expect, it } from 'vitest';
import { ocrEngineFor, ocrUnavailableReason, VisionOcr, type OcrEngine } from '../../src/verify/ocr.js';

/**
 * The ONE engine-selection rule (2026-10-04). Until then the `ocr` assert and
 * the verify run's text table each wrote "ask the reason, then construct"
 * themselves; a drift between the two would have let one caller skip a check
 * the other refused. The rule is pinned here once, and the two callers are
 * pinned to quote the same reason in tests/run/verify.test.ts.
 */
const onHost = async (platform: string, body: () => void | Promise<void>) => {
  const real = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    await body();
  } finally {
    Object.defineProperty(process, 'platform', real);
  }
};

describe('ocrEngineFor', () => {
  it('a supplied engine is used as given — the test seam, wherever the host is', () =>
    onHost('linux', () => {
      const engine: OcrEngine = { recognize: async () => [] };
      expect(ocrEngineFor(engine)).toEqual({ engine });
    }));

  it('builds the Vision recognizer only where it can run', () =>
    onHost('darwin', () => {
      const choice = ocrEngineFor();
      expect(choice.unavailable).toBeUndefined();
      expect(choice.engine).toBeInstanceOf(VisionOcr);
    }));

  it('elsewhere: no engine, the one reason — never both, never neither', () =>
    onHost('linux', () => {
      const choice = ocrEngineFor();
      expect(choice.engine).toBeUndefined();
      expect(choice.unavailable).toBe(ocrUnavailableReason());
      expect(choice.unavailable).toBe('OCR needs the macOS Vision framework (this host is linux)');
    }));
});
