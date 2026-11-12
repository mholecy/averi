import { AndroidAdapter } from '../adapters/android.js';
import { IosAdapter } from '../adapters/ios.js';
import { DEFAULT_IOS_TREE_SOURCE, type IosTreeSourceSetting } from '../adapters/ios-node.js';
import { createIosTreeSource, type IosTreeSourceDeps } from '../adapters/ios-tree-source.js';
import { IdbHelper } from '../adapters/idb-helper.js';
import { androidUnusable, defaultDiscovery, type DeviceDiscovery, type ListOpts } from '../adapters/discovery.js';
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

/**
 * Per-call adapter options — today only the iOS tree-source kind (averi.yaml `app.ios.treeSource`). Required by
 * `get` (D41, 2026-11-01): a caller states the project's kind, or that it has none (`treeSource` undefined — the
 * default, `auto`), and cannot forget it — the eight tools that once asked without it were served, in a `treeSource: wda`
 * project, by a second adapter of the default kind.
 */
export interface AdapterOpts {
  treeSource?: IosTreeSourceSetting;
}

/**
 * Builds the adapter that drives ONE device — the id is required: listing
 * devices is DeviceDiscovery's (adapters/discovery.ts), so there is no
 * unbound adapter (2026-10-08; until then a factory call without an id
 * built a probe adapter whose only use was `listDevices()`). The registry
 * resolves `opts` to a kind before calling (kindFor): an ios call always
 * carries one, an android call never does.
 */
export type AdapterFactory = (
  platform: Platform,
  deviceId: string,
  opts?: AdapterOpts,
) => DeviceAdapter;

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
  return iosAdapterFor(deviceId, opts?.treeSource ?? DEFAULT_IOS_TREE_SOURCE);
};

/**
 * The iOS adapter's wiring, in one place (review round 2 of D7a): one idb helper per adapter, shared like `exec` by
 * the adapter (which owns and disposes it) and its tree source. It starts on the first call it could serve — since D7b
 * an input too, so a wda-backed adapter starts one as well (its input is idb's). Since D41 every tool of a project asks
 * for the project's kind, so a simulator runs one helper; two only when two projects with different tree sources
 * drive it from one server (ADR 0032, amendment D41). `deps` reach the tree source: the
 * server passes none; scripts/perf/baseline.ts passes its lab WebDriverAgent's port and derived data.
 */
export function iosAdapterFor(udid: string, kind: IosTreeSourceSetting, deps: Omit<IosTreeSourceDeps, 'idbHelper'> = {}): IosAdapter {
  const idbHelper = new IdbHelper();
  return new IosAdapter({ udid, treeSource: createIosTreeSource(kind, udid, { ...deps, idbHelper }), idbHelper });
}

/**
 * The cache key's third part: which tree-source kind an opts set resolves
 * to. Normalized so equivalent calls share one cached instance: android has
 * no tree source (a stray value must not fork its cache), and on ios an
 * undefined kind IS the default — a project without a configured source gets
 * the default-kind instance. Resolving the default HERE is what makes the
 * cache key and the factory call agree: the factory is handed the resolved kind.
 */
function kindFor(platform: Platform, opts: AdapterOpts): IosTreeSourceSetting | undefined {
  return platform === 'ios' ? opts.treeSource ?? DEFAULT_IOS_TREE_SOURCE : undefined;
}

/** The registry's two seams: the factory of bound adapters and discovery (adapters/discovery.ts#DeviceDiscovery) — both or neither. */
export interface RegistryDeps {
  factory: AdapterFactory;
  discovery: DeviceDiscovery;
}

/** What `new AdapterRegistry()` is built on — the server's wiring; exported so its tests can pin it. */
export const defaultRegistryDeps: Readonly<RegistryDeps> = {
  factory: defaultFactory,
  discovery: defaultDiscovery,
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

  /**
   * Both seams or neither: a caller that injected a fake factory but left
   * discovery at its default would have its tests run `adb devices` and
   * `simctl list` — or read a simulator's device.plist — on the host; the
   * type does not let it.
   */
  constructor(deps: RegistryDeps = defaultRegistryDeps) {
    this.factory = deps.factory;
    this.discovery = deps.discovery;
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

  /**
   * Pin the platform's tools to one booted device (id from listAll). Selecting the device already bound keeps its
   * adapters, except one that fell back (DeviceAdapter.claimNote: an iOS `treeSource: auto` adapter whose WebDriverAgent
   * did not come up, A41a): that one is dropped, so the next call builds a fresh adapter that tries WebDriverAgent
   * again — the retry its note names.
   */
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
    else this.evict(platform, deviceId, (adapter) => adapter.claimNote !== undefined);
    this.bindings.set(platform, { deviceId, pinned: true });
    return device;
  }

  async get(platform: Platform, opts: AdapterOpts): Promise<DeviceAdapter> {
    this.assertOpen();
    const binding = this.bindings.get(platform);
    if (binding) {
      // Still usable? Discovery's check, asked on every call: how it proves it
      // cheaply, and why: adapters/discovery.ts#discoveryOver.
      const bound = await this.discovery.check(platform, binding.deviceId);
      // A select() may have rebound the platform while we awaited the check.
      // Acting on the CAPTURED binding would re-cache the evicted (already
      // disposed) device's adapter — start over against the current binding.
      // (select() always stores a fresh object, so identity detects it.)
      if (this.bindings.get(platform) !== binding) return this.get(platform, opts);
      if (bound.usable) return this.adapterFor(platform, binding.deviceId, opts);
      if (binding.pinned) {
        // Still listed, but unauthorized (a revoked key) or offline: say which.
        const unusable = unusableNamed(bound.listed);
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

  private adapterFor(platform: Platform, deviceId: string, opts: AdapterOpts): DeviceAdapter {
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

  /** Drop and dispose every cached adapter (every kind) bound to one device — or, with `only`, those it holds to. */
  private evict(platform: Platform, deviceId: string, only: (adapter: DeviceAdapter) => boolean = () => true): void {
    for (const [key, entry] of this.adapters) {
      if (entry.platform === platform && entry.deviceId === deviceId && only(entry.adapter)) {
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
   * One listing per call: get()'s unbound path asks with `versions: false`
   * (D13, 2026-10-31) — it reads only ids and states, and on Android a
   * version is a getprop per attached device (adapters/discovery.ts#ListOpts).
   * select() and listAll() keep the versions: select_device's reply and the
   * device listing are where a version is read. (get()'s bound path asks
   * discovery's `check` instead.)
   *
   * Not cached here — a stale "still booted" would hand out an adapter for a
   * device that is gone. Async, so a discovery that throws synchronously is
   * the same event as one that rejects (the rule disposeQuietly states) —
   * listAll's per-platform catch must see both.
   */
  private async probe(platform: Platform, opts?: ListOpts): Promise<Device[]> {
    return this.discovery.list(platform, opts);
  }
}
