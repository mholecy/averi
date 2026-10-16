import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DeviceAdapter, UiNode } from '../../src/adapters/types.js';
import type { AdapterFactory, AdapterRegistry, DeviceDiscovery } from '../../src/mcp/registry.js';
import type { createAveriServer } from '../../src/mcp/tools.js';
import type { IosAdapter } from '../../src/adapters/ios.js';
import type { Recording } from './corpus.js';
import { logCall, useDevice, type DeviceProfile } from './fake-device.js';
import { RecordedTreeSource } from './recorded-source.js';

/**
 * One side of a differential run: a code root (a checkout of averi) and the
 * few things the harness takes from it. Deliberately only the TOOL interface
 * and the adapter SEAM — what tests/mcp/tools.test.ts builds a server from,
 * plus the iOS adapter and its WDA parser to put a recorded source behind:
 *
 *   src/mcp/tools.ts          createAveriServer (the tool handlers)
 *   src/mcp/registry.ts       AdapterRegistry, defaultFactory (the live wiring) — the registry built through
 *                             `registry` below, which also takes the constructor an older side had
 *   src/adapters/ios.ts       IosAdapter (takes any IosTreeSource)
 *   src/adapters/wda-source.ts parseWdaSourceValue (WdaTreeSource's parser)
 *
 * No module behind the tools (standing, scroll rounds, tap judgement …) is
 * imported, so a refactor inside averi needs no change here. The types are
 * this checkout's; an older side is held to them only structurally.
 */
export interface Side {
  root: string;
  createAveriServer: typeof createAveriServer;
  defaultFactory: AdapterFactory;
  IosAdapter: new (opts: ConstructorParameters<typeof IosAdapter>[0]) => DeviceAdapter;
  parseWdaSourceValue: (value: unknown) => UiNode;
  /**
   * The side's registry over `deps`, whichever constructor the side has: since 8413120 (2026-10-08) it takes
   * `{ factory, discovery }`; before, the factory alone, and devices were listed by an UNBOUND adapter's
   * `listDevices()` — so an older side gets a factory that answers an unbound call with the discovery. Which one is
   * told by the constructor's own behaviour (`takesDeps`), not by what else the module exports.
   */
  registry(deps: { factory: AdapterFactory; discovery: DeviceDiscovery }): AdapterRegistry;
  /**
   * The side's iOS tree-source seam (src/adapters/ios-tree-source.ts#createIosTreeSource), when it has one — what the
   * live golden (scripts/truth/live.ts `--side`) builds a real WDA or idb source with; the replay does not use it.
   */
  createIosTreeSource?: (kind: 'idb' | 'wda', udid: string, deps: { port?: number; derivedDataPath?: string }) => unknown;
}

export async function loadSide(root: string): Promise<Side> {
  const at = async (path: string, names: readonly string[]): Promise<Record<string, unknown>> => {
    const mod = (await import(pathToFileURL(resolve(root, path)).href)) as Record<string, unknown>;
    // A side that renamed or dropped one of the four is refused here, by name — not later as "x is not a function".
    for (const name of names) if (typeof mod[name] !== 'function') throw new Error(`side ${root}: ${path} has no export ${name}`);
    return mod;
  };
  const [tools, registry, ios, wda] = await Promise.all([
    at('src/mcp/tools.ts', ['createAveriServer']),
    at('src/mcp/registry.ts', ['AdapterRegistry', 'defaultFactory']),
    at('src/adapters/ios.ts', ['IosAdapter']),
    at('src/adapters/wda-source.ts', ['parseWdaSourceValue']),
  ]);
  // Optional: a side without the seam loads all the same (the replay never needs it).
  const treeSource = (await import(pathToFileURL(resolve(root, 'src/adapters/ios-tree-source.ts')).href).catch(() => ({}))) as Record<string, unknown>;
  const Registry = registry.AdapterRegistry as new (deps: { factory: AdapterFactory; discovery: DeviceDiscovery }) => AdapterRegistry;
  const discoverySeam = await takesDeps(Registry);
  return {
    root: resolve(root),
    createAveriServer: tools.createAveriServer as Side['createAveriServer'],
    defaultFactory: registry.defaultFactory as Side['defaultFactory'],
    IosAdapter: ios.IosAdapter as Side['IosAdapter'],
    parseWdaSourceValue: wda.parseWdaSourceValue as Side['parseWdaSourceValue'],
    ...(typeof treeSource.createIosTreeSource === 'function' && { createIosTreeSource: treeSource.createIosTreeSource as NonNullable<Side['createIosTreeSource']> }),
    registry: (deps) => {
      if (discoverySeam) return new Registry(deps);
      const legacy = Registry as unknown as new (factory: AdapterFactory) => AdapterRegistry;
      return new legacy((platform, deviceId, opts) =>
        deviceId === undefined ? ({ listDevices: () => deps.discovery(platform) } as unknown as DeviceAdapter) : deps.factory(platform, deviceId, opts),
      );
    },
  };
}

/**
 * Whether a registry constructor takes `{ factory, discovery }`: one built so lists its devices through that
 * discovery. The old constructor keeps the object as its factory, and its listing calls it — a TypeError, caught (or
 * caught by `listAll` itself) — so the discovery is never asked. Nothing is bound and no adapter is built.
 */
export async function takesDeps(Registry: new (deps: { factory: AdapterFactory; discovery: DeviceDiscovery }) => AdapterRegistry): Promise<boolean> {
  let asked = false;
  const probe = new Registry({
    factory: () => {
      throw new Error('side.ts: the registry probe builds no adapter');
    },
    discovery: async () => {
      asked = true;
      return [];
    },
  });
  try {
    await probe.listAll();
  } catch {
    // the old constructor's listing: `this.factory is not a function`
  }
  return asked;
}

export const IOS_UDID = 'differential-simulator';
export const ANDROID_SERIAL = 'emulator-differential';

/**
 * A side's adapter over a recording, with the fake device pointed at it (the
 * profile's screen and keyboard, the recording's raw payload where the side
 * reads it through exec). Per recording:
 *  - iOS raw WDA, iOS normalized: the side's IosAdapter over a
 *    RecordedTreeSource (recorded-source.ts);
 *  - iOS raw idb: the side's live wiring (`defaultFactory`, kind idb) — its
 *    IdbTreeSource asks the fake device for `ui describe-all`;
 *  - Android raw: the side's live wiring — its AndroidAdapter asks the fake
 *    device for the dump and parses it;
 *  - Android normalized: the same adapter, its tree read replaced by the
 *    recorded one (Android has no tree-source seam to put it behind; every
 *    other method is the adapter's own).
 */
export function recordedAdapter(side: Side, recording: Recording, profile: DeviceProfile): DeviceAdapter {
  const raw = recording.form === 'raw';
  useDevice({
    ...profile,
    ...(raw && recording.source === 'idb' && { idbPayload: recording.payload }),
    ...(raw && recording.source === 'uiautomator' && { dumpXml: recording.payload }),
  });
  if (recording.platform === 'ios') {
    if (raw && recording.source === 'idb') return side.defaultFactory('ios', IOS_UDID, { treeSource: 'idb' });
    return new side.IosAdapter({ udid: IOS_UDID, treeSource: new RecordedTreeSource(recording, side.parseWdaSourceValue, logCall) });
  }
  const adapter = side.defaultFactory('android', ANDROID_SERIAL);
  if (raw) return adapter;
  return servingTree(adapter, recording.payload);
}

/** `adapter` with `uiTree` answering a fresh copy of the normalized tree; every other member is the adapter's own, bound to it. */
function servingTree(adapter: DeviceAdapter, payload: string): DeviceAdapter {
  return new Proxy(adapter, {
    get(target, prop) {
      if (prop === 'uiTree') {
        return async () => {
          logCall('uiautomator tree read (normalized)');
          return JSON.parse(payload) as UiNode;
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}
