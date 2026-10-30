import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ExecError, type ExecFn } from '../../src/adapters/exec.js';
import { ocrEngineFor, OcrUnavailableError, ocrUnavailableReason, VisionOcr, type OcrEngine } from '../../src/verify/ocr.js';

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

describe('VisionOcr — which failures are permanent (2026-10-08, review 2026-10-07 assert-capture-ocr C2)', () => {
  /**
   * The ocr assert ends at once on an `OcrUnavailableError` and polls on any
   * other throw (text-parity.ts#measureOcrAssert), so the class is the
   * contract: a missing compiler and a failed compile are this instance's
   * answer from then on (the build is memoized, rejection included); a
   * recognizer run that fails is one failed read. The toolchain string is
   * unique per test, so the binary cache key never names a real binary.
   */
  const REGION = [{ id: 'element', x: 0, y: 0, w: 10, h: 10 }];
  const scripted = (handlers: Partial<Record<'version' | 'compile' | 'run', (args: string[]) => Promise<void>>>) => {
    const calls: string[] = [];
    const toolchain = `swift-driver test ${randomUUID()}`;
    const exec: ExecFn = async (cmd, args) => {
      const kind = cmd !== 'swiftc' ? 'run' : args[0] === '--version' ? 'version' : 'compile';
      calls.push(kind);
      await handlers[kind]?.(args);
      return { stdout: Buffer.from(kind === 'version' ? toolchain : kind === 'run' ? '{"results":[]}' : ''), stderr: '' };
    };
    return { exec, calls };
  };

  it('no swiftc: OcrUnavailableError, and the next read gives the same answer without asking again', () =>
    onHost('darwin', async () => {
      const { exec, calls } = scripted({
        version: async () => {
          throw new Error('Command failed (exit null): swiftc --version\nspawn swiftc ENOENT');
        },
      });
      const ocr = new VisionOcr(exec);
      await expect(ocr.recognize(Buffer.from('png'), REGION)).rejects.toBeInstanceOf(OcrUnavailableError);
      // one line, as the real ExecError's two are folded for the fail-closed sentence
      await expect(ocr.recognize(Buffer.from('png'), REGION)).rejects.toThrow(
        /OCR needs the Swift compiler.*Underlying error: Command failed \(exit null\): swiftc --version — spawn swiftc ENOENT$/,
      );
      expect(calls).toEqual(['version']);
    }));

  it('a swiftc that exits non-zero on its probe is the compiler\'s answer: OcrUnavailableError, memoized', () =>
    onHost('darwin', async () => {
      const { exec, calls } = scripted({
        version: async () => {
          throw new ExecError('swiftc --version', 1, 'xcrun: error: invalid active developer path');
        },
      });
      const ocr = new VisionOcr(exec);
      await expect(ocr.recognize(Buffer.from('png'), REGION)).rejects.toBeInstanceOf(OcrUnavailableError);
      await expect(ocr.recognize(Buffer.from('png'), REGION)).rejects.toBeInstanceOf(OcrUnavailableError);
      expect(calls).toEqual(['version']);
    }));

  it.each([
    ['timed out', new ExecError('swiftc --version', null, '', true)],
    ['was refused with EAGAIN', new ExecError('swiftc --version', null, 'spawn swiftc EAGAIN')],
  ])('a probe that %s did not answer: a plain error, forgotten, so the next read probes again and can succeed', (_, failure) =>
    onHost('darwin', async () => {
      let probes = 0;
      const { exec, calls } = scripted({
        version: async () => {
          probes += 1;
          if (probes === 1) throw failure;
        },
        compile: async () => {
          throw new Error('stop here: the probe answered');
        },
      });
      const ocr = new VisionOcr(exec);
      const first = await ocr.recognize(Buffer.from('png'), REGION).catch((e: unknown) => e);
      expect(first).toBeInstanceOf(Error);
      expect(first).not.toBeInstanceOf(OcrUnavailableError);
      expect((first as Error).message).toMatch(/^the Swift compiler probe \(`swiftc --version`\) did not answer: /);
      // The second read probes again — and this time the probe answers and the build goes on to compile.
      await expect(ocr.recognize(Buffer.from('png'), REGION)).rejects.toThrow(/did not compile.*stop here/);
      expect(calls).toEqual(['version', 'version', 'compile']);
    }));

  it('a recognizer that does not compile: OcrUnavailableError naming the compile', () =>
    onHost('darwin', async () => {
      const { exec } = scripted({
        compile: async () => {
          throw new Error('error: no such module Vision');
        },
      });
      const thrown = await new VisionOcr(exec).recognize(Buffer.from('png'), REGION).catch((e: unknown) => e);
      expect(thrown).toBeInstanceOf(OcrUnavailableError);
      expect((thrown as Error).message).toBe('the OCR recognizer did not compile (swiftc -O): error: no such module Vision');
    }));

  it('a recognizer RUN that fails is a plain error — one failed read, not an unavailable engine', () =>
    onHost('darwin', async () => {
      let binary: string | undefined;
      const { exec } = scripted({
        // The compile "publishes" a binary by writing the staging path it was asked for.
        compile: async (args) => {
          binary = args[2].replace(/\.\d+$/, '');
          await writeFile(args[2], '');
        },
        run: async () => {
          throw new Error('recognizer exited 2');
        },
      });
      try {
        const thrown = await new VisionOcr(exec).recognize(Buffer.from('png'), REGION).catch((e: unknown) => e);
        expect(thrown).toBeInstanceOf(Error);
        expect(thrown).not.toBeInstanceOf(OcrUnavailableError);
        expect((thrown as Error).message).toBe('recognizer exited 2');
      } finally {
        if (binary !== undefined) await rm(binary, { force: true });
      }
    }));
});

describe('VisionOcr — the toolchain probe runs once per process, not once per engine (P6)', () => {
  /**
   * Every Verifier builds its own VisionOcr, and every flow step and verify
   * leg builds its own Verifier — so a per-instance probe paid `swiftc
   * --version` (0.1–0.5 s) per Verifier. The probe is memoised per ExecFn,
   * like xcode-env's: the real exec is shared by every production engine, so
   * the probe runs once per process; a test's fake exec is its own cache.
   * What the shared memo keeps is the compiler's ANSWER — its version, or its
   * refusal; a probe that did not answer is forgotten. A failed compile is
   * not the probe's business and stays per engine.
   */
  const REGION = [{ id: 'element', x: 0, y: 0, w: 10, h: 10 }];
  const recorder = (version: (n: number) => Promise<void>) => {
    const calls: string[] = [];
    let probes = 0;
    const toolchain = `swift-driver test ${randomUUID()}`;
    const exec: ExecFn = async (cmd, args) => {
      const kind = cmd !== 'swiftc' ? 'run' : args[0] === '--version' ? 'version' : 'compile';
      calls.push(kind);
      if (kind === 'version') await version(++probes);
      // The probe answered: stop each build at its compile, which is per engine.
      if (kind === 'compile') throw new Error('stop here: the probe answered');
      return { stdout: Buffer.from(toolchain), stderr: '' };
    };
    return { exec, calls };
  };
  const read = (ocr: VisionOcr) => ocr.recognize(Buffer.from('png'), REGION).catch((e: unknown) => e);

  it('three engines on one exec probe the toolchain once — concurrently or one after another', () =>
    onHost('darwin', async () => {
      const { exec, calls } = recorder(async () => {});
      await Promise.all([read(new VisionOcr(exec)), read(new VisionOcr(exec))]);
      await read(new VisionOcr(exec));
      expect(calls).toEqual(['version', 'compile', 'compile', 'compile']);
    }));

  it('a compiler that answered "no" is the process\'s answer: the next engine fails the same way without probing', () =>
    onHost('darwin', async () => {
      const { exec, calls } = recorder(async () => {
        throw new ExecError('swiftc --version', 1, 'xcrun: error: invalid active developer path');
      });
      const first = await read(new VisionOcr(exec));
      const second = await read(new VisionOcr(exec));
      expect(first).toBeInstanceOf(OcrUnavailableError);
      expect(second).toBe(first);
      expect(calls).toEqual(['version']);
    }));

  it('a probe that did not answer is forgotten process-wide: the next engine probes again and gets the answer', () =>
    onHost('darwin', async () => {
      const { exec, calls } = recorder(async (n) => {
        if (n === 1) throw new ExecError('swiftc --version', null, '', true);
      });
      const first = await read(new VisionOcr(exec));
      expect(first).not.toBeInstanceOf(OcrUnavailableError);
      expect((first as Error).message).toMatch(/did not answer/);
      expect(await read(new VisionOcr(exec))).toMatchObject({ message: expect.stringMatching(/did not compile.*stop here/) });
      // ...and that answer is now the process's: a third engine goes straight to its compile.
      await read(new VisionOcr(exec));
      expect(calls).toEqual(['version', 'version', 'compile', 'compile']);
    }));

  it('a failed compile stays the failing engine\'s answer: the next engine compiles again, without probing', () =>
    onHost('darwin', async () => {
      const { exec, calls } = recorder(async () => {});
      const ocr = new VisionOcr(exec);
      await read(ocr);
      await read(ocr);
      await read(new VisionOcr(exec));
      expect(calls).toEqual(['version', 'compile', 'compile']);
    }));
});
