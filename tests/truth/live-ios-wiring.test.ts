import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSide } from '../../scripts/differential/side.js';
import { ROOT } from '../../scripts/truth/live-cases.js';
import type { DeviceAdapter } from '../../src/adapters/types.js';

// The live golden's iOS adapter (scripts/truth/live.ts, A23): what side.ts#loadSide hands it as `liveIos` — the
// side's composition root (src/mcp/registry.ts#iosAdapterFor, the idb helper with it, ADR 0032) when the side has it,
// and the construction live.ts had before A23 (IosAdapter over createIosTreeSource, no helper) for an older side, said
// in the run's log. Gate C (truth:lab:ios) then drives the transport users get.

const DEPS = { port: 8120, derivedDataPath: '/lab/derived-data' };
const roots: string[] = [];

/** A checkout in miniature: the four modules loadSide requires, and `extra` beside them. */
async function fakeSide(extra: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'averi-live-side-'));
  roots.push(root);
  const files: Record<string, string> = {
    'src/mcp/tools.ts': 'export const createAveriServer = () => undefined;',
    'src/mcp/registry.ts': 'export class AdapterRegistry {}\nexport const defaultFactory = () => undefined;',
    'src/adapters/ios.ts': 'export class IosAdapter { constructor(opts) { this.opts = opts; } }',
    'src/adapters/wda-source.ts': 'export const parseWdaSourceValue = () => undefined;',
    'src/adapters/ios-tree-source.ts': 'export const createIosTreeSource = (kind, udid, deps) => ({ source: kind, udid, deps });',
    ...extra,
  };
  for (const [path, body] of Object.entries(files)) {
    await mkdir(join(root, dirname(path)), { recursive: true });
    await writeFile(join(root, path), body);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("live.ts's iOS adapter, from its side (side.ts#liveIos)", () => {
  it("a side with registry.ts#iosAdapterFor: its adapter is that function's, handed the udid, the kind and the lab's WDA deps", async () => {
    const side = await loadSide(
      await fakeSide({
        'src/mcp/registry.ts': [
          'export class AdapterRegistry {}',
          'export const defaultFactory = () => undefined;',
          "export const iosAdapterFor = (udid, kind, deps) => ({ wiring: 'iosAdapterFor', udid, kind, deps });",
        ].join('\n'),
      }),
    );
    expect(side.liveIos?.adapter('LAB-UDID', 'wda', DEPS)).toEqual({ wiring: 'iosAdapterFor', udid: 'LAB-UDID', kind: 'wda', deps: DEPS });
    expect(side.liveIos?.wiring).toBe('registry.ts#iosAdapterFor — the server\'s iOS wiring, its idb helper on (ADR 0032)');
  });

  it('with the kill switch on (AVERI_IDB_HELPER=off) the line says the CLI carries every idb call — read when the side is loaded', async () => {
    const root = await fakeSide({
      'src/mcp/registry.ts': ['export class AdapterRegistry {}', 'export const defaultFactory = () => undefined;', 'export const iosAdapterFor = () => ({});'].join('\n'),
    });
    const before = process.env.AVERI_IDB_HELPER;
    process.env.AVERI_IDB_HELPER = 'off';
    try {
      expect((await loadSide(root)).liveIos?.wiring).toBe(
        "registry.ts#iosAdapterFor — the server's iOS wiring, its idb helper off (AVERI_IDB_HELPER=off): every idb call the CLI",
      );
    } finally {
      if (before === undefined) delete process.env.AVERI_IDB_HELPER;
      else process.env.AVERI_IDB_HELPER = before;
    }
  });

  it('a side without it (before D7a, 2026-10-31): its IosAdapter over its createIosTreeSource, no idb helper — the fallback said', async () => {
    const side = await loadSide(await fakeSide({}));
    const adapter = side.liveIos?.adapter('LAB-UDID', 'idb', DEPS) as unknown as { opts: unknown };
    expect(adapter.opts).toEqual({ udid: 'LAB-UDID', treeSource: { source: 'idb', udid: 'LAB-UDID', deps: DEPS } });
    expect(side.liveIos?.wiring).toBe(
      'no registry.ts#iosAdapterFor in this side — IosAdapter over its createIosTreeSource, no idb helper: every idb call the CLI (the live golden before A23)',
    );
  });

  it('a side without the tree-source seam either: no live iOS adapter', async () => {
    const side = await loadSide(await fakeSide({ 'src/adapters/ios-tree-source.ts': 'export const other = 1;' }));
    expect(side.liveIos).toBeUndefined();
  });

  // The helper is read off the adapter's private field: a public seam would need an idb call, which starts the helper
  // (a spawned Python) and the CLI on the host.
  it("this checkout: the registry's own wiring, an IosAdapter holding its idb helper", async () => {
    const side = await loadSide(ROOT);
    expect(side.liveIos?.wiring).toMatch(/^registry\.ts#iosAdapterFor/);
    const adapter = side.liveIos!.adapter('LAB-UDID', 'idb', DEPS) as DeviceAdapter & { idbHelper?: object };
    try {
      expect(adapter.constructor.name).toBe('IosAdapter');
      expect(adapter.idbHelper?.constructor.name).toBe('IdbHelper');
    } finally {
      await adapter.dispose?.();
    }
  });
});
