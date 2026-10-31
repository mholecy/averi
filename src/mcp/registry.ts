import { AndroidAdapter } from '../adapters/android.js';
import { IosAdapter } from '../adapters/ios.js';
import { DEFAULT_IOS_TREE_SOURCE, type IosTreeSourceKind } from '../adapters/ios-node.js';
import { createIosTreeSource } from '../adapters/ios-tree-source.js';
import { IdbHelper } from '../adapters/idb-helper.js';
import { androidUnusable, iosBootedFromDevicePlist, listAndroidDevices, listIosDevices, type ListOpts } from '../adapters/discovery.js';
import { exec as defaultExec, type ExecFn } from '../adapters/exec.js';
import type { Device, DeviceAdapter, Platform } from '../adapters/types.js';
import { drawnOverStrip } from '../ui-tree/draw-order.js';

/**
 * An Android device adb lists but averi cannot drive, named for a refusal:
 * `"<serial>" is unauthorized: …` — the quoted serial, then the reason and
 * remedy (adapters/discovery.ts#androidUnusable). One spelling for the
 * registry's three refusals — select_device, a pinned device, the auto-pick
 * (code review S8). undefined for a device that can be driven, one not on
 * Android, or none.
 */
function unusableNamed(device: Device | undefined): string | undefined {
  const why = device === undefined ? undefined : androidUnusable(device);
  return why === undefined || device === undefined ? undefined : `"${device.id}" ${why}`;
}

/** Per-call adapter options — today only the iOS tree-source kind (averi.yaml `app.ios.treeSource`). */
export interface AdapterOpts {
  treeSource?: IosTreeSourceKind;
}

/**
 * Builds the adapter that drives ONE device — the id is required: listing
 * devices is DeviceDiscovery's (below), so there is no unbound adapter
 * (2026-10-08; until then a factory call without an id built a probe
 * adapter whose only use was `listDevices()`). The registry resolves `opts`
 * to a kind before calling (kindFor): an ios call always carries one, an
 * android call never does.
 */
export type AdapterFactory = (
  platform: Platform,
  deviceId: string,
  opts?: AdapterOpts,
) => DeviceAdapter;

/**
 * Which devices a platform has, booted or not — the registry's second
 * dependency beside the factory (2026-10-08, the iOS adapter stack review's
 * candidate 1). A platform question, so it is not a member of the bound
 * adapter; adapters/discovery.ts holds the adb and simctl listings, and the
 * registry's tests hand in a list.
 *
 * `opts.versions: false` (D13) says the caller reads no OS version — the
 * listing may leave them `unknown` (adapters/discovery.ts#ListOpts); omitted,
 * the versions are read.
 */
export type DeviceDiscovery = (platform: Platform, opts?: ListOpts) => Promise<Device[]>;

/** The platform → listing wiring over one exec — exported so its tests can hand in a fake exec. */
export const discoveryWith = (exec: ExecFn = defaultExec): DeviceDiscovery => (platform, opts) =>
  platform === 'android' ? listAndroidDevices(exec, opts) : listIosDevices(exec);

export const defaultDiscovery: DeviceDiscovery = discoveryWith();

/**
 * Whether the bound simulator is PROVEN booted without a listing — `true`
 * only when proven; `false` (or a rejection) is "cannot tell", and the
 * registry asks discovery as before. The registry's optional third seam
 * (D22, 2026-10-31), asked on get()'s bound iOS path alone.
 */
export type IosBootedProof = (udid: string) => Promise<boolean>;

/** The real proof: the simulator's own device.plist (adapters/discovery.ts#iosBootedFromDevicePlist, where why and the trade are). */
export const defaultIosBooted: IosBootedProof = (udid) => iosBootedFromDevicePlist(udid);

/**
 * Exported for its tests: the registry's own tests inject a factory, so this
 * is the one piece of wiring they cannot see (review 2026-10-02). Which
 * backend serves a kind is NOT decided here — adapters/ios-tree-source.ts
 * owns that (review 2026-10-03); this only hands it the bound device id —
 * and, to Android's parser, the draw order's judgement it asks before
 * widening a node (adapters/types.ts#DrawnOverStrip).
 */
export const defaultFactory: AdapterFactory = (platform, deviceId, opts) => {
  if (platform === 'android') return new AndroidAdapter({ serial: deviceId, drawnOverStrip });
  // The registry hands over the resolved kind (kindFor); the fallback only
  // serves a direct caller of the factory, and names the same default.
  // One idb helper per simulator (D7a), shared like `exec` by the adapter and its tree source; it starts on the first
  // call it could serve, so a wda-backed adapter never starts one.
  const idbHelper = new IdbHelper();
  return new IosAdapter({
    udid: deviceId,
    treeSource: createIosTreeSource(opts?.treeSource ?? DEFAULT_IOS_TREE_SOURCE, deviceId, { idbHelper }),
    idbHelper,
  });
};

/**
 * The cache key's third part: which tree-source kind an opts set resolves
 * to. Normalized so equivalent calls share one cached instance: android has
 * no tree source (a stray value must not fork its cache), and on ios an
 * omitted kind IS the default — a treeSource-less get for the same device
 * gets the default-kind instance and never races the wda one, which owns a
 * WdaServer. Resolving the default HERE is what makes the cache key and the
 * factory call agree: the factory is handed the resolved kind.
 */
function kindFor(platform: Platform, opts?: AdapterOpts): IosTreeSourceKind | undefined {
  return platform === 'ios' ? opts?.treeSource ?? DEFAULT_IOS_TREE_SOURCE : undefined;
}

/** The registry's seams: the factory and discovery (both or neither), and D22's optional proof. */
export interface RegistryDeps {
  factory: AdapterFactory;
  discovery: DeviceDiscovery;
  iosBooted?: IosBootedProof;
}

/** What `new AdapterRegistry()` is built on — the server's wiring; exported so its tests can pin it. */
export const defaultRegistryDeps: Readonly<RegistryDeps> = {
  factory: defaultFactory,
  discovery: defaultDiscovery,
  iosBooted: defaultIosBooted,
};

/**
 * Dispose one adapter without letting its failure escape: the adapter is being
 * torn down either way, and a synchronous throw and a rejected promise are the
 * same event — the async wrapper is what turns the first into the second. The
 * ONE place that rule lives; both call sites below use it.
 */
const disposeQuietly = (adapter: DeviceAdapter): Promise<void> =>
  (async () => adapter.dispose?.())().catch(() => undefined);

/**
 * Resolves a platform to an adapter bound to one device: the device pinned
 * via select() when there is one, otherwise the first booted device.
 * A vanished auto-picked device invalidates its binding, a vanished PINNED
 * device is an error — the user chose it, silently running elsewhere is
 * exactly the surprise select() exists to prevent.
 *
 * The device binding is per platform; ADAPTERS are cached per
 * (platform, deviceId, tree-source kind) — a keyed cache instead of a
 * mutable treeSource setter, so two concurrent tool calls with different
 * configs cannot race each other's adapter. Evicting a device's entries
 * disposes them (the wda adapter's tree source stops its WdaServer).
 */
export class AdapterRegistry {
  /** Which device each platform's tools target. Pins survive across tree-source kinds. */
  private bindings = new Map<Platform, { deviceId: string; pinned: boolean }>();
  /** Set by shutdown(): no adapter may be created or cached after it (see `get`). */
  private closed = false;
  /** Key: JSON [platform, deviceId, kind|null] — device ids may contain ':' (adb over TCP). */
  private adapters = new Map<string, { platform: Platform; deviceId: string; adapter: DeviceAdapter }>();

  private readonly factory: AdapterFactory;
  private readonly discovery: DeviceDiscovery;
  private readonly iosBooted: IosBootedProof;

  /**
   * Both seams or neither: a caller that injected a fake factory but left
   * discovery at its default would have its tests run `adb devices` and
   * `simctl list` on the host — the type does not let it.
   *
   * `iosBooted` (D22) is the one optional seam, and its absence is the safe
   * side: a caller that injects its seams and names no proof gets one that
   * never proves anything, so every bound iOS call lists through discovery
   * as before and no host file is read. Only the default registry (and a
   * caller passing `defaultIosBooted`, as scripts/perf/baseline.ts does)
   * reads the device.plist.
   */
  constructor(deps: RegistryDeps = defaultRegistryDeps) {
    this.factory = deps.factory;
    this.discovery = deps.discovery;
    this.iosBooted = deps.iosBooted ?? (async () => false);
  }

  async listAll(): Promise<Device[]> {
    const [android, ios] = await Promise.all([
      this.probe('android').catch(() => [] as Device[]), // adb missing → no devices
      this.probe('ios').catch(() => [] as Device[]),
    ]);
    return [...android, ...ios];
  }

  /** Device id the platform's tools currently target, if any binding exists. */
  boundId(platform: Platform): string | undefined {
    return this.bindings.get(platform)?.deviceId;
  }

  /** Pin the platform's tools to one booted device (id from listAll). */
  async select(platform: Platform, deviceId: string): Promise<Device> {
    this.assertOpen();
    const devices = await this.probe(platform);
    const device = devices.find((d) => d.id === deviceId);
    if (!device) {
      const known = devices.map((d) => `${d.id} (${d.state})`).join(', ') || 'none';
      throw new Error(`Unknown ${platform} device "${deviceId}" — known: ${known}`);
    }
    if (device.state !== 'booted') {
      const unusable = unusableNamed(device);
      throw new Error(unusable === undefined ? `Device "${deviceId}" is ${device.state} — boot it first` : `Android device ${unusable}`);
    }
    this.assertOpen(); // before the write, as in get(): a shutdown during the probe must not leave a binding behind
    const previous = this.bindings.get(platform);
    if (previous && previous.deviceId !== deviceId) this.evict(platform, previous.deviceId);
    this.bindings.set(platform, { deviceId, pinned: true });
    return device;
  }

  async get(platform: Platform, opts?: AdapterOpts): Promise<DeviceAdapter> {
    this.assertOpen();
    const binding = this.bindings.get(platform);
    if (binding) {
      // iOS first asks the simulator's own device.plist (D22): proven booted,
      // the adapter is handed out without `simctl list devices` (~110 ms a
      // call); anything short of proof lists below, as before. What the file
      // cannot prove, and the trade: docs/adr/0031-the-bound-simulator-is-proven-booted-from-its-own-record.md.
      if (platform === 'ios' && (await this.provenBooted(binding.deviceId))) {
        // The select() race, as after the probe below.
        if (this.bindings.get(platform) !== binding) return this.get(platform, opts);
        return this.adapterFor(platform, binding.deviceId, opts);
      }
      // Every entry with the serial: cheap phones can share one, and any
      // booted entry keeps the binding, as before the C5 refusals.
      const matches = (await this.probe(platform, { versions: false })).filter((d) => d.id === binding.deviceId);
      const stillBooted = matches.some((d) => d.state === 'booted');
      const listed = matches[0];
      // A select() may have rebound the platform while we awaited the probe.
      // Acting on the CAPTURED binding would re-cache the evicted (already
      // disposed) device's adapter — start over against the current binding.
      // (select() always stores a fresh object, so identity detects it.)
      if (this.bindings.get(platform) !== binding) return this.get(platform, opts);
      if (stillBooted) return this.adapterFor(platform, binding.deviceId, opts);
      if (binding.pinned) {
        // Still listed, but unauthorized (a revoked key) or offline: say which.
        const unusable = unusableNamed(listed);
        throw new Error(
          unusable === undefined
            ? `Selected ${platform} device "${binding.deviceId}" is no longer booted — ` +
              'reboot it or select_device another one'
            : `Selected ${platform} device ${unusable} Or select_device another one.`,
        );
      }
      this.bindings.delete(platform);
      this.evict(platform, binding.deviceId);
    }

    const devices = await this.probe(platform, { versions: false });
    const booted = devices.filter((d) => d.state === 'booted');
    // Same race on the unbound path: a select() that landed during this probe
    // owns the binding now — honor it instead of auto-picking over it.
    if (this.bindings.get(platform) !== undefined) return this.get(platform, opts);
    if (booted.length === 0) {
      // adb lists devices it cannot drive (unauthorized, offline): name them
      // and the remedy rather than "no booted device" (C5, 2026-10-09).
      const unusable = devices.flatMap((d) => unusableNamed(d) ?? []);
      if (unusable.length > 0) {
        throw new Error(`No usable Android emulator/device found (adb devices): ${unusable.join(' ')}`);
      }
      throw new Error(
        platform === 'android'
          ? 'No booted Android emulator/device found (adb devices)'
          : 'No booted iOS simulator found (xcrun simctl list)',
      );
    }
    this.assertOpen(); // before the write: a shutdown during the probe must not leave a binding behind
    this.bindings.set(platform, { deviceId: booted[0].id, pinned: false });
    return this.adapterFor(platform, booted[0].id, opts);
  }

  private adapterFor(platform: Platform, deviceId: string, opts?: AdapterOpts): DeviceAdapter {
    // Defence in depth, currently unreachable: both callers re-check
    // assertOpen() after their awaits (get()'s binding-identity recursion and
    // the check before its unbound write). It stays because THIS is the line
    // that creates and caches — a get() parked on a probe when shutdown() ran
    // would otherwise cache a fresh adapter nobody disposes and, on iOS/wda,
    // spawn the very WebDriverAgent just stopped (review 2026-09-18). Do not
    // remove the earlier guards on the strength of this one being here.
    this.assertOpen();
    const kind = kindFor(platform, opts);
    const key = JSON.stringify([platform, deviceId, kind ?? null]);
    let entry = this.adapters.get(key);
    if (!entry) {
      const adapter = this.factory(platform, deviceId, kind === undefined ? undefined : { treeSource: kind });
      entry = { platform, deviceId, adapter };
      this.adapters.set(key, entry);
    }
    return entry.adapter;
  }

  /** Drop and dispose every cached adapter (every kind) bound to one device. */
  private evict(platform: Platform, deviceId: string): void {
    for (const [key, entry] of this.adapters) {
      if (entry.platform === platform && entry.deviceId === deviceId) {
        this.adapters.delete(key);
        void disposeQuietly(entry.adapter);
      }
    }
  }

  /**
   * The process-shutdown path: close the registry to new adapters, drop the
   * bindings, dispose every cached adapter and WAIT for the disposals — an
   * iOS/wda adapter's dispose stops its WebDriverAgent and polls until the
   * port is quiet, and `process.exit` must not pre-empt that
   * (docs/bugs/2026-09-18-wda-orphan-after-server-restart.md). The caller
   * (mcp/lifecycle.ts) bounds the wait; this method does not.
   */
  async shutdown(): Promise<void> {
    this.closed = true;
    const entries = [...this.adapters.values()];
    this.adapters.clear();
    this.bindings.clear();
    await Promise.all(entries.map((e) => disposeQuietly(e.adapter)));
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('averi is shutting down — no device work is accepted any more');
  }

  /**
   * One listing per call, as before discovery left the adapter: get() asks on
   * EVERY tool call (that is how a vanished device is noticed). get() reads
   * only ids and states, so it asks with `versions: false` (D13, 2026-10-31):
   * on Android that is `adb devices -l` alone, without the getprop per
   * attached device (its cost: adapters/discovery.ts#ListOpts). select() and
   * listAll() keep the versions: select_device's reply and the device
   * listing are where a version is read.
   *
   * Not cached here — a stale "still booted" would hand out an adapter for a
   * device that is gone. (D22's device.plist proof, `provenBooted`, is no
   * cache either: CoreSimulator's own record, read afresh on each call.) Async, so a discovery that throws synchronously is
   * the same event as one that rejects (the rule disposeQuietly states) —
   * listAll's per-platform catch must see both.
   */
  private async probe(platform: Platform, opts?: ListOpts): Promise<Device[]> {
    return this.discovery(platform, opts);
  }

  /**
   * The bound simulator proven booted without a listing (D22). Not a cache
   * either: the proof is read afresh on every call, as the listing was. A
   * proof that throws (synchronously or not) proves nothing — the listing
   * decides, as before.
   */
  private async provenBooted(udid: string): Promise<boolean> {
    try {
      return await this.iosBooted(udid); // awaited HERE, so the catch sees a rejection too
    } catch {
      return false;
    }
  }
}
