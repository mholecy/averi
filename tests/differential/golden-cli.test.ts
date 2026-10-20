import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { cellOf, checkOf, exitCode, faultsOf, parseOnly, selectRecordings, type GoldenJson, type GoldenResult } from '../../scripts/differential/golden.js';
import { loadSide, takesDeps } from '../../scripts/differential/side.js';
import { AdapterRegistry } from '../../src/mcp/registry.js';
import type { DeviceAdapter } from '../../src/adapters/types.js';

// golden.ts's command line (--only) and the side seam an older checkout is loaded through (side.ts#registry): what the
// calibration (scripts/truth/calibrate.ts) runs golden with, at each note's before and after commit.

const IOS = 'ios-iphone17-ios27';
const ANDROID = 'android-averi_lab-api33';
const corpus = [
  { run: ANDROID, file: 'alert-dim.xml' },
  { run: ANDROID, file: 'open.xml' },
  { run: IOS, file: 'alert-dim.idb.json' },
  { run: IOS, file: 'alert-dim.wda.json' },
  { run: IOS, file: 'form-keyboard.idb.json' },
  { run: IOS, file: 'form-keyboard.wda.json' },
];
const ids = (rs: readonly { run: string; file: string }[]) => rs.map((r) => `${r.run}/${r.file}`);

describe('golden --only', () => {
  it('splits on commas and drops blanks; no flag, no filter', () => {
    expect(parseOnly('alert-dim, form-keyboard.wda,,')).toEqual(['alert-dim', 'form-keyboard.wda']);
    expect(parseOnly(undefined)).toBeUndefined();
  });

  it("a capture's cell is its file name up to the first dot", () => {
    expect(cellOf({ file: 'form-keyboard.wda.json' })).toBe('form-keyboard');
    expect(cellOf({ file: 'alert-dim.xml' })).toBe('alert-dim');
  });

  it.each([
    ['a cell: every source of it, both platforms', ['alert-dim'], [`${ANDROID}/alert-dim.xml`, `${IOS}/alert-dim.idb.json`, `${IOS}/alert-dim.wda.json`]],
    ['a capture without its extension', ['form-keyboard.wda'], [`${IOS}/form-keyboard.wda.json`]],
    ['a capture by its file name', ['form-keyboard.idb.json'], [`${IOS}/form-keyboard.idb.json`]],
    ['a cell behind its run: that run only', [`${IOS}/alert-dim`], [`${IOS}/alert-dim.idb.json`, `${IOS}/alert-dim.wda.json`]],
    ['several tokens, in corpus order, each capture once', ['form-keyboard.wda', 'alert-dim.wda', 'alert-dim'], [`${ANDROID}/alert-dim.xml`, `${IOS}/alert-dim.idb.json`, `${IOS}/alert-dim.wda.json`, `${IOS}/form-keyboard.wda.json`]],
  ])('%s', (_, only, want) => {
    expect(ids(selectRecordings(corpus, only))).toEqual(want);
  });

  it('no --only: the whole corpus', () => {
    expect(ids(selectRecordings(corpus, undefined))).toEqual(ids(corpus));
  });

  it('a token that names no capture is refused by name — a filter matching nothing would read as all green', () => {
    expect(() => selectRecordings(corpus, ['alert-dim', 'sheet-medium', `${ANDROID}/form-keyboard`])).toThrow(
      `golden --only: sheet-medium, ${ANDROID}/form-keyboard names no capture of the corpus`,
    );
    expect(() => selectRecordings(corpus, ['form-keyboard.wda.xml'])).toThrow('names no capture');
  });
});

describe("an older side's registry (side.ts#registry)", () => {
  const device = { id: 'differential-simulator', platform: 'ios' as const, name: 'differential', osVersion: '0', state: 'booted' as const };
  const adapter = { marker: 'bound' } as unknown as DeviceAdapter;

  async function fakeSide(registry: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'averi-side-'));
    for (const [path, body] of [
      ['src/mcp/tools.ts', 'export const createAveriServer = () => undefined;'],
      ['src/mcp/registry.ts', registry],
      ['src/adapters/ios.ts', 'export class IosAdapter {}'],
      ['src/adapters/wda-source.ts', 'export const parseWdaSourceValue = () => undefined;'],
    ]) {
      await mkdir(join(root, dirname(path)), { recursive: true });
      await writeFile(join(root, path), body);
    }
    return root;
  }

  // The constructor is told by its behaviour, not by a sibling export: the new one without `defaultDiscovery`, the old
  // one with it.
  it('since the discovery seam (8413120): constructed with { factory, discovery }', async () => {
    const root = await fakeSide(`
      export const defaultFactory = () => undefined;
      export class AdapterRegistry {
        constructor(deps) { this.deps = deps; }
        async listAll() { return this.deps.discovery('ios'); }
        get(platform, id) { return this.deps.factory(platform, id); }
      }`);
    try {
      const side = await loadSide(root);
      const r = side.registry({ factory: () => adapter, discovery: async () => [device] }) as unknown as { listAll(): Promise<unknown>; get(p: string, id: string): unknown };
      expect(await r.listAll()).toEqual([device]);
      expect(r.get('ios', device.id)).toBe(adapter);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("before it: the factory alone, devices listed by an unbound adapter's listDevices — answered by the discovery", async () => {
    const root = await fakeSide(`
      export const defaultDiscovery = async () => [];
      export const defaultFactory = () => undefined;
      export class AdapterRegistry {
        constructor(factory = defaultFactory) { this.factory = factory; }
        async listAll() { return this.factory('ios').listDevices(); }
        get(platform, id) { return this.factory(platform, id); }
      }`);
    try {
      const side = await loadSide(root);
      const r = side.registry({ factory: () => adapter, discovery: async (p) => (p === 'ios' ? [device] : []) }) as unknown as {
        listAll(): Promise<unknown>;
        get(p: string, id: string): unknown;
      };
      expect(await r.listAll()).toEqual([device]);
      expect(r.get('ios', device.id)).toBe(adapter);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("this checkout's registry reads as the new constructor", async () => {
    expect(await takesDeps(AdapterRegistry)).toBe(true);
  });
});

describe('golden --json: the faults a check carries (faultsOf)', () => {
  it("what golden marks as a fault: a JavaScript or harness error in the reply, an UNMODELLED call; a tool's own refusal is none", () => {
    expect(faultsOf({ reply: 'ERROR this.factory is not a function', device: [] })).toEqual(['ERROR this.factory is not a function']);
    expect(faultsOf({ reply: "ERROR Cannot read properties of undefined (reading 'x')", device: [] })).toHaveLength(1);
    expect(faultsOf({ reply: 'THROW MCP error -32001: Request timed out', device: [] })).toHaveLength(1);
    expect(faultsOf({ reply: 'ERROR differential: no device for idb describe', device: [] })).toHaveLength(1);
    expect(faultsOf({ reply: 'Tapped id:"a"', device: ['idb ui tap 1 2', 'UNMODELLED xcrun foo'] })).toEqual(['UNMODELLED xcrun foo']);
    expect(faultsOf({ reply: 'ERROR id:"a" is under button "B" … close it first; nothing was tapped', device: ['idb ui describe-all --json'] })).toEqual([]);
  });
});

describe('golden --json: a fault reaches the check and the exit code (checkOf, exitCode)', () => {
  const FAULTY = { reply: 'ERROR id:"a" could not be read\n  at tap\nTypeError: this.factory is not a function', device: ['idb ui tap 1 2', 'UNMODELLED xcrun simctl foo'] };
  it('a harness error deeper than the reply\'s first line, and an UNMODELLED call, are the check\'s faults', () => {
    expect(faultsOf(FAULTY)).toEqual(['TypeError: this.factory is not a function', 'UNMODELLED xcrun simctl foo']);
    const c = checkOf('r/a.json', 'A', 'tap', 'Tapped', undefined, FAULTY);
    expect(c.faults).toEqual(['TypeError: this.factory is not a function', 'UNMODELLED xcrun simctl foo']);
    expect(c.mismatch).toBeUndefined();
    expect(c.calls).toEqual(['idb ui tap 1 2']);
    expect('faults' in checkOf('r/a.json', 'A', 'tap', 'Tapped', undefined, { reply: 'Tapped id:"a"', device: ['idb ui tap 1 2'] })).toBe(false);
    // What the row read, carried only where the row gives it (Expectation.read).
    expect(checkOf('r/a.json', 'A', 'snapshot', 's', undefined, { reply: '[', device: [] }, 'no error').read).toBe('no error');
    expect('read' in checkOf('r/a.json', 'A', 'tap', 'Tapped', undefined, { reply: 'Tapped id:"a"', device: [] })).toBe(false);
  });

  it('exit code 1 on a fault alone, as on a mismatch or a broken target; 0 when every check holds', () => {
    const result = (checks: GoldenResult['checks'], broken: GoldenResult['broken'] = []): GoldenResult => ({ recording: 'r/a.json', checks, broken });
    const green = checkOf('r/a.json', 'A', 'tap', 'Tapped', undefined, { reply: 'Tapped id:"a"', device: [] });
    expect(exitCode([result([green])])).toBe(0);
    expect(exitCode([result([green]), result([checkOf('r/a.json', 'B', 'tap', 'Tapped', undefined, FAULTY)])])).toBe(1);
    expect(exitCode([result([{ ...green, mismatch: 'not tapped' }])])).toBe(1);
    expect(exitCode([result([green], ['C'])])).toBe(1);
  });
});

describe('golden --against <base.json>: the diff against an earlier --json run, in place of the report', () => {
  const ROOT = fileURLToPath(new URL('../../', import.meta.url));
  const CAPTURE = `${IOS}/alert-dim.wda.json`;
  const golden = (...args: string[]) =>
    promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/differential/golden.ts', '--corpus', 'tests/fixtures/truth', '--only', 'alert-dim.wda', ...args], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 });

  it("names the check whose verdict and reply changed and the one the base did not ask; this checkout's ratchet holds", async () => {
    const run = JSON.parse((await golden('--json')).stdout) as GoldenJson;
    const [a, ...rest] = run.results[0].checks;
    expect(`${a.target} ${a.verb} ${a.mismatch ?? 'ok'}`).toBe('A tap ok');
    // The base: A's tap a known-looking mismatch the "fix" turned green, D's scroll_until not yet asked.
    const base: GoldenJson = { side: run.side, results: [{ ...run.results[0], checks: [{ ...a, mismatch: 'refused without "close it first": ERROR old', reply: 'ERROR old' }, ...rest.filter((c) => `${c.target} ${c.verb}` !== 'D scroll_until')] }] };
    const dir = await mkdtemp(join(tmpdir(), 'averi-golden-against-'));
    try {
      await writeFile(join(dir, 'base.json'), JSON.stringify(base));
      const { stdout } = await golden('--against', join(dir, 'base.json'));
      expect(stdout).toContain(`: 12 checks (was 11), 0 mismatches (was 1), 0 broken targets (was 0), 0 skipped (was 0)\n`);
      expect(stdout).toContain(`## Changed: 2 checks\n- ${CAPTURE} A tap\n  verdict: was MISMATCH refused without "close it first": ERROR old\n           now ok\n  reply:\n    - ERROR old\n    + ${a.reply}\n`);
      expect(stdout).toContain(`- NEW ${CAPTURE} D scroll_until: ok\n`);
      expect(stdout).toContain('## Strike from KNOWN: 0 rows\n\n## COUNTS: 0 captures\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('refuses a base no --json run wrote, and --json beside it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'averi-golden-against-'));
    try {
      await writeFile(join(dir, 'report.json'), JSON.stringify({ checks: [] }));
      await expect(golden('--against', join(dir, 'report.json'))).rejects.toThrow('is no golden --json output');
      await expect(golden('--json', '--against', join(dir, 'report.json'))).rejects.toThrow('[--json | --against <base.json>]');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
