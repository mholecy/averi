import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveIosLine, loadSide, type LiveIos, type Side } from '../../scripts/differential/side.js';
import { SwipeHook } from '../../scripts/truth/live-carousel.js';
import { liveFactory } from '../../scripts/truth/live-factory.js';
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

const SWITCH = process.env.AVERI_IDB_HELPER;
afterEach(async () => {
  if (SWITCH === undefined) delete process.env.AVERI_IDB_HELPER;
  else process.env.AVERI_IDB_HELPER = SWITCH;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A registry.ts with iosAdapterFor, which answers what it was handed. */
const REGISTRY = [
  'export class AdapterRegistry {}',
  'export const defaultFactory = () => undefined;',
  "export const iosAdapterFor = (udid, kind, deps) => ({ wiring: 'iosAdapterFor', udid, kind, deps });",
].join('\n');

describe("live.ts's iOS adapter, from its side (side.ts#liveIos)", () => {
  it("a side with registry.ts#iosAdapterFor: its adapter is that function's, handed the udid, the kind and the lab's WDA deps", async () => {
    delete process.env.AVERI_IDB_HELPER;
    const side = await loadSide(await fakeSide({ 'src/mcp/registry.ts': REGISTRY }));
    expect(side.liveIos?.adapter('LAB-UDID', 'wda', DEPS)).toEqual({ wiring: 'iosAdapterFor', udid: 'LAB-UDID', kind: 'wda', deps: DEPS });
    expect(side.liveIos).toMatchObject({ wiring: 'registry-helper-on', switchReadBy: 'inline' });
  });

  it("the kill switch is the side's own idbHelperDisabled when it exports one — not the environment read here", async () => {
    delete process.env.AVERI_IDB_HELPER;
    const off = await fakeSide({ 'src/mcp/registry.ts': REGISTRY, 'src/adapters/idb-helper.ts': 'export const idbHelperDisabled = () => true;' });
    expect((await loadSide(off)).liveIos).toMatchObject({ wiring: 'registry-helper-off', switchReadBy: 'side' });
    process.env.AVERI_IDB_HELPER = 'off';
    const on = await fakeSide({ 'src/mcp/registry.ts': REGISTRY, 'src/adapters/idb-helper.ts': 'export const idbHelperDisabled = () => false;' });
    expect((await loadSide(on)).liveIos).toMatchObject({ wiring: 'registry-helper-on', switchReadBy: 'side' });
  });

  it('a side without idbHelperDisabled: AVERI_IDB_HELPER=off read inline, when the side is loaded', async () => {
    process.env.AVERI_IDB_HELPER = 'off';
    const root = await fakeSide({ 'src/mcp/registry.ts': REGISTRY, 'src/adapters/idb-helper.ts': 'export const other = 1;' });
    expect((await loadSide(root)).liveIos).toMatchObject({ wiring: 'registry-helper-off', switchReadBy: 'inline' });
    process.env.AVERI_IDB_HELPER = 'on';
    expect((await loadSide(root)).liveIos).toMatchObject({ wiring: 'registry-helper-on', switchReadBy: 'inline' });
  });

  it('a side without iosAdapterFor (before D7a, 2026-10-31): its IosAdapter over its createIosTreeSource, no idb helper', async () => {
    const side = await loadSide(await fakeSide({}));
    const adapter = side.liveIos?.adapter('LAB-UDID', 'idb', DEPS) as unknown as { opts: unknown };
    expect(adapter.opts).toEqual({ udid: 'LAB-UDID', treeSource: { source: 'idb', udid: 'LAB-UDID', deps: DEPS } });
    expect(side.liveIos?.wiring).toBe('fallback');
    expect(side.liveIos?.switchReadBy).toBeUndefined();
  });

  it('a side without the tree-source seam either: no live iOS adapter', async () => {
    const side = await loadSide(await fakeSide({ 'src/adapters/ios-tree-source.ts': 'export const other = 1;' }));
    expect(side.liveIos).toBeUndefined();
  });

  it('the `ios:` line words the kill switch and who read it (liveIosLine)', () => {
    const live = { adapter: () => ({}) as DeviceAdapter, wiring: 'registry-helper-off', switchReadBy: 'inline' } satisfies LiveIos;
    expect(liveIosLine(live)).toBe(
      "registry.ts#iosAdapterFor — the server's iOS wiring, its idb helper off (AVERI_IDB_HELPER=off; AVERI_IDB_HELPER read by side.ts: the side has no idbHelperDisabled): every idb call the CLI",
    );
  });

  // The helper is read off the adapter's private field: a public seam would need an idb call, which starts the helper
  // (a spawned Python) and the CLI on the host.
  it("this checkout: the registry's own wiring, its switch read by its own idb-helper.ts, an IosAdapter holding its idb helper", async () => {
    const side = await loadSide(ROOT);
    expect(side.liveIos?.wiring).toMatch(/^registry-helper-/);
    expect(side.liveIos?.switchReadBy).toBe('side');
    const adapter = side.liveIos!.adapter('LAB-UDID', 'idb', DEPS) as DeviceAdapter & { idbHelper?: object };
    try {
      expect(adapter.constructor.name).toBe('IosAdapter');
      expect(adapter.idbHelper?.constructor.name).toBe('IdbHelper');
    } finally {
      await adapter.dispose?.();
    }
  });
});

describe("live.ts's adapter factory (live-factory.ts#liveFactory)", () => {
  const swipeHook = new SwipeHook();
  const sideWith = (liveIos: LiveIos | undefined, android: DeviceAdapter = {} as DeviceAdapter) =>
    ({ root: '/side', defaultFactory: vi.fn(() => android), ...(liveIos !== undefined && { liveIos }) }) as Pick<Side, 'root' | 'defaultFactory' | 'liveIos'>;

  it("iOS: the side's live adapter, handed the device, the call's kind (idb when none) and the lab's WDA deps — never defaultFactory", () => {
    const built = { built: true } as unknown as DeviceAdapter;
    const adapter = vi.fn(() => built);
    const side = sideWith({ adapter, wiring: 'registry-helper-on', switchReadBy: 'side' });
    const factory = liveFactory(side, { wda: DEPS, swipeHook });
    expect(factory('ios', 'LAB-UDID', { treeSource: 'wda' })).toBe(built);
    expect(factory('ios', 'LAB-UDID')).toBe(built);
    expect(adapter.mock.calls).toEqual([
      ['LAB-UDID', 'wda', DEPS],
      ['LAB-UDID', 'idb', DEPS],
    ]);
    expect(side.defaultFactory).not.toHaveBeenCalled();
  });

  it("Android: the side's defaultFactory, its strokes routed through the swipe hook", () => {
    const send = vi.fn(async () => undefined);
    const android = { swipe: send } as unknown as DeviceAdapter;
    const side = sideWith(undefined, android);
    const got = liveFactory(side, { wda: DEPS, swipeHook })('android', 'emulator-5554');
    expect(side.defaultFactory).toHaveBeenCalledWith('android', 'emulator-5554', undefined);
    expect(got).toBe(android);
    expect(got.swipe).not.toBe(send);
  });

  it('iOS on a side with no live adapter: refused, both seams named', () => {
    expect(() => liveFactory(sideWith(undefined), { wda: DEPS, swipeHook })('ios', 'LAB-UDID')).toThrow(`side /side: ${liveIosLine(undefined)}`);
  });
});
