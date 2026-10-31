import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { probeRecognizer } from '../../scripts/differential/ocr-probe.js';

/**
 * The harness's own Vision probe compiles like src/verify/ocr.ts#compileRecognizer (D15): on per-BUILD source and
 * staging paths (pid + a random suffix — a pid is reused across sandboxes sharing a temp dir), and a failed compile
 * leaves neither behind. Rename is the only publishing step.
 */
describe('probeRecognizer — per-build staging (D15)', () => {
  const onDarwin = async (body: () => Promise<void>) => {
    const real = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    try {
      await body();
    } finally {
      Object.defineProperty(process, 'platform', real);
    }
  };

  it('two builds stage on different paths, and a failed compile removes its staging output and source', () =>
    onDarwin(async () => {
      const toolchain = `swift-driver test ${randomUUID()}`;
      const compiles: { staging: string; source: string }[] = [];
      const exec = async (cmd: string, args: string[]) => {
        if (args[0] === '--version') return { stdout: Buffer.from(toolchain), stderr: '' };
        if (cmd === 'swiftc') {
          compiles.push({ staging: args[2], source: args[3] });
          await writeFile(args[2], 'half a binary');
          throw new Error('swiftc: error: no such module Vision');
        }
        throw new Error(`unexpected ${cmd}`);
      };
      const first = await probeRecognizer(exec, 'shot.png');
      await probeRecognizer(exec, 'shot.png');
      expect(first).toMatchObject({ run: { error: 'swiftc: error: no such module Vision' } });
      expect(compiles).toHaveLength(2);
      expect(compiles[0].staging).not.toBe(compiles[1].staging);
      expect(compiles[0].source).not.toBe(compiles[1].source);
      for (const c of compiles) {
        expect(c.staging).toMatch(new RegExp(`\\.${process.pid}\\.[0-9a-f-]{36}$`));
        expect(existsSync(c.staging)).toBe(false);
        expect(existsSync(c.source)).toBe(false);
      }
    }));
});
