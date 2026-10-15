import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cellOf, faultsOf, parseOnly, selectRecordings } from '../../scripts/differential/golden.js';
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
