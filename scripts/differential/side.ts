import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DeviceAdapter, UiNode } from '../../src/adapters/types.js';
import type { AdapterFactory, AdapterRegistry } from '../../src/mcp/registry.js';
import type { DeviceDiscovery } from '../../src/adapters/discovery.js';
import type { createAveriServer } from '../../src/mcp/tools.js';
import type { IosAdapter } from '../../src/adapters/ios.js';
import type { IosTreeSourceKind } from '../../src/adapters/ios-node.js';
import type { IosTreeSourceDeps } from '../../src/adapters/ios-tree-source.js';
import type { Recording } from './corpus.js';
import { logCall, useDevice, type DeviceProfile } from './fake-device.js';
import { RecordedTreeSource } from './recorded-source.js';

/**
 * One side of a differential run: a code root (a checkout of averi) and the
 * few things the harness takes from it. Deliberately only the TOOL interface
 * and the adapter SEAM — what tests/mcp/tools.test.ts builds a server from,
 * plus the iOS adapter and its WDA parser to put a recorded source behind:
 *
 *   src/mcp/tools.ts            createAveriServer (the tool handlers)
 *   src/mcp/registry.ts         AdapterRegistry, defaultFactory (the live wiring) — the registry built through
 *                               `registry` below, which also takes the constructor an older side had; iosAdapterFor,
 *                               when the side has it (since D7a, 2026-10-31) — the live golden's iOS adapter (`liveIos`)
 *   src/adapters/discovery.ts   discoveryOver, when the side has it (since A3) — its discovery over the harness's listing
 *   src/adapters/ios.ts         IosAdapter (takes any IosTreeSource)
 *   src/adapters/wda-source.ts  parseWdaSourceValue (WdaTreeSource's parser)
 *   src/adapters/idb-helper.ts  idbHelperDisabled, when the side has it — the kill switch `liveIos` reports
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
   * Whether the side's WdaTreeSource names WDA's active app by bundle id for the launch's foreground wait (D48: its
   * WdaServer has `activeAppInfo`) — what RecordedTreeSource answers it; an older side declined, and its wait cannot
   * match a bundle. Told by the side's own WdaServer, not by a date.
   */
  asksWdaBundle: boolean;
  /**
   * The side's registry over `deps`, whichever constructor the side has: since 8413120 (2026-10-08) it takes
   * `{ factory, discovery }`; before, the factory alone, and devices were listed by an UNBOUND adapter's
   * `listDevices()` — so an older side gets a factory that answers an unbound call with the listing. Which one is
   * told by the constructor's own behaviour (`takesDeps`), not by what else the module exports. The harness hands a
   * listing; each side gets it as the discovery it reads (`discoveryFor`).
   */
  registry(deps: { factory: AdapterFactory; discovery: Listing }): AdapterRegistry;
  /**
   * The side's iOS adapter for a real simulator — what the live golden (scripts/truth/live.ts, `--side` or not) drives
   * the lab simulator with; the replay does not use it. A side with src/mcp/registry.ts#iosAdapterFor (D7a, 2026-10-31)
   * gets the server's own wiring, its idb helper included (ADR 0032, A23), so Gate C runs the transport users get. An
   * older side gets the construction the live golden had before A23: its IosAdapter over its
   * src/adapters/ios-tree-source.ts#createIosTreeSource, no helper (every idb call the CLI). `wiring` tags which, and
   * for the server's wiring whether the kill switch (`AVERI_IDB_HELPER=off`, read when the side is loaded) puts every
   * idb call on the CLI as well; `liveIosLine` words it for the run's log. A side with neither has none.
   */
  liveIos?: LiveIos;
}

/**
 * Which wiring builds a side's live iOS adapter: the side's registry.ts#iosAdapterFor with its idb helper on or off
 * (the kill switch), or the fallback for a side without it.
 */
export type LiveIosWiring = 'registry-helper-on' | 'registry-helper-off' | 'fallback';

/** A side's live iOS adapter (`Side.liveIos`): the adapter for one simulator and tree-source kind, and which wiring built it. */
export interface LiveIos {
  adapter(udid: string, kind: IosTreeSourceKind, deps: LiveIosDeps): DeviceAdapter;
  wiring: LiveIosWiring;
  /**
   * For a registry wiring, who read the kill switch: the side's own src/adapters/idb-helper.ts `idbHelperDisabled`
   * (`side`), or, for a side that does not export it, the same check on `AVERI_IDB_HELPER` here (`inline`).
   */
  switchReadBy?: 'side' | 'inline';
}

/** What the live golden hands the tree source: its own WebDriverAgent port and derived data (lab-device.ts). */
export type LiveIosDeps = Pick<IosTreeSourceDeps, 'port' | 'derivedDataPath'>;

/** A side's live iOS wiring in words, for the run's log (live.ts's `ios:` line); `undefined` is a side with no live iOS adapter. */
export function liveIosLine(live: LiveIos | undefined): string {
  if (live === undefined) return 'none — no registry.ts#iosAdapterFor nor src/adapters/ios-tree-source.ts#createIosTreeSource in this side';
  if (live.wiring === 'fallback') {
    return 'no registry.ts#iosAdapterFor in this side — IosAdapter over its createIosTreeSource, no idb helper: every idb call the CLI (the live golden before A23)';
  }
  const reader = live.switchReadBy === 'side' ? "the side's idb-helper.ts#idbHelperDisabled" : 'AVERI_IDB_HELPER read by side.ts: the side has no idbHelperDisabled';
  return live.wiring === 'registry-helper-off'
    ? `registry.ts#iosAdapterFor — the server's iOS wiring, its idb helper off (AVERI_IDB_HELPER=off; ${reader}): every idb call the CLI`
    : `registry.ts#iosAdapterFor — the server's iOS wiring, its idb helper on (ADR 0032; ${reader})`;
}

/** `Side.liveIos` from the side's registry, tree-source and idb-helper modules (see there). */
function liveIosOf(
  registry: Record<string, unknown>,
  treeSource: Record<string, unknown>,
  idbHelper: Record<string, unknown>,
  Ios: Side['IosAdapter'],
): LiveIos | undefined {
  if (typeof registry.iosAdapterFor === 'function') {
    const own = typeof idbHelper.idbHelperDisabled === 'function' ? (idbHelper.idbHelperDisabled as () => boolean) : undefined;
    const off = own !== undefined ? own() : process.env.AVERI_IDB_HELPER === 'off';
    return {
      adapter: registry.iosAdapterFor as LiveIos['adapter'],
      wiring: off ? 'registry-helper-off' : 'registry-helper-on',
      switchReadBy: own !== undefined ? 'side' : 'inline',
    };
  }
  if (typeof treeSource.createIosTreeSource !== 'function') return undefined;
  const create = treeSource.createIosTreeSource as (kind: IosTreeSourceKind, udid: string, deps: LiveIosDeps) => ConstructorParameters<Side['IosAdapter']>[0]['treeSource'];
  return { adapter: (udid, kind, deps) => new Ios({ udid, treeSource: create(kind, udid, deps) }), wiring: 'fallback' };
}

/** Which devices a platform has — what the harness fakes (adapters/discovery.ts#DeviceDiscovery's `list`). */
export type Listing = DeviceDiscovery['list'];

/** A side's adapters/discovery.ts#discoveryOver, as this checkout types it. */
type DiscoveryOver = typeof import('../../src/adapters/discovery.js').discoveryOver;

/**
 * A side's discovery over the harness's listing, read by every constructor since 8413120: callable as the listing
 * (until A3, 2026-11-01, discovery was a function), and an object with `list` and `check` (since). `check` is the
 * side's own `discoveryOver`'s, built without a proof — no host file is read, and the bound check lists, as before A3
 * when the harness passed no proof. A side without `discoveryOver` never asks `check`.
 * Delete this shim (and pass `over(listing)` straight) once no replayed side predates A3.
 */
function discoveryFor(listing: Listing, over: DiscoveryOver | undefined): Listing & DeviceDiscovery {
  const shaped: DeviceDiscovery = over?.(listing) ?? {
    list: listing,
    check: () => Promise.reject(new Error('side.ts: this side has no discoveryOver, so nothing asks check')),
  };
  return Object.assign((platform: Parameters<Listing>[0], opts?: Parameters<Listing>[1]) => listing(platform, opts), shaped);
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
  /** A module a side may lack: its exports, or none. */
  const optional = async (path: string): Promise<Record<string, unknown>> =>
    (await import(pathToFileURL(resolve(root, path)).href).catch(() => ({}))) as Record<string, unknown>;
  // Optional: a side without the seam loads all the same (the replay never needs it); a side before D48 has no
  // WdaServer.activeAppInfo (RecordedTreeSource then declines, as its WdaTreeSource did); a side before A3 lists
  // through a discovery that is a plain function; a side before D7a has no idb helper (its kill switch then read here).
  const [treeSource, wdaServer, discovery, idbHelper] = await Promise.all([
    optional('src/adapters/ios-tree-source.ts'),
    optional('src/adapters/wda.ts'),
    optional('src/adapters/discovery.ts'),
    optional('src/adapters/idb-helper.ts'),
  ]);
  const over = typeof discovery.discoveryOver === 'function' ? (discovery.discoveryOver as DiscoveryOver) : undefined;
  const Registry = registry.AdapterRegistry as new (deps: { factory: AdapterFactory; discovery: DeviceDiscovery }) => AdapterRegistry;
  const discoverySeam = await takesDeps(Registry);
  const liveIos = liveIosOf(registry, treeSource, idbHelper, ios.IosAdapter as Side['IosAdapter']);
  return {
    root: resolve(root),
    createAveriServer: tools.createAveriServer as Side['createAveriServer'],
    defaultFactory: registry.defaultFactory as Side['defaultFactory'],
    IosAdapter: ios.IosAdapter as Side['IosAdapter'],
    parseWdaSourceValue: wda.parseWdaSourceValue as Side['parseWdaSourceValue'],
    asksWdaBundle: typeof (wdaServer.WdaServer as { prototype?: Record<string, unknown> } | undefined)?.prototype?.activeAppInfo === 'function',
    ...(liveIos !== undefined && { liveIos }),
    registry: (deps) => {
      if (discoverySeam) return new Registry({ factory: deps.factory, discovery: discoveryFor(deps.discovery, over) });
      const legacy = Registry as unknown as new (factory: AdapterFactory) => AdapterRegistry;
      return new legacy((platform, deviceId, opts) =>
        deviceId === undefined ? ({ listDevices: () => deps.discovery(platform) } as unknown as DeviceAdapter) : deps.factory(platform, deviceId, opts),
      );
    },
  };
}

/**
 * Whether a registry constructor takes `{ factory, discovery }`: one built so lists its devices through that
 * discovery (called, or asked `list` — `discoveryFor`). The old constructor keeps the object as its factory, and its
 * listing calls it — a TypeError, caught (or caught by `listAll` itself) — so the discovery is never asked. Nothing is
 * bound and no adapter is built.
 */
export async function takesDeps(Registry: new (deps: { factory: AdapterFactory; discovery: DeviceDiscovery }) => AdapterRegistry): Promise<boolean> {
  let asked = false;
  const probe = new Registry({
    factory: () => {
      throw new Error('side.ts: the registry probe builds no adapter');
    },
    discovery: discoveryFor(async () => {
      asked = true;
      return [];
    }, undefined),
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
    return new side.IosAdapter({ udid: IOS_UDID, treeSource: new RecordedTreeSource(recording, side.parseWdaSourceValue, logCall, side.asksWdaBundle) });
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
