import { AndroidAdapter } from '../adapters/android.js';
import { IosAdapter } from '../adapters/ios.js';
import { DEFAULT_IOS_TREE_SOURCE, type IosTreeSourceKind } from '../adapters/ios-node.js';
import { createIosTreeSource } from '../adapters/ios-tree-source.js';
import { listAndroidDevices, listIosDevices } from '../adapters/discovery.js';
import { exec as defaultExec, type ExecFn } from '../adapters/exec.js';
import type { Device, DeviceAdapter, Platform } from '../adapters/types.js';

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
 */
export type DeviceDiscovery = (platform: Platform) => Promise<Device[]>;

/** The platform → listing wiring over one exec — exported so its tests can hand in a fake exec. */
export const discoveryWith = (exec: ExecFn = defaultExec): DeviceDiscovery => (platform) =>
  platform === 'android' ? listAndroidDevices(exec) : listIosDevices(exec);

export const defaultDiscovery: DeviceDiscovery = discoveryWith();

/**
 * Exported for its tests: the registry's own tests inject a factory, so this
 * is the one piece of wiring they cannot see (review 2026-10-02). Which
 * backend serves a kind is NOT decided here — adapters/ios-tree-source.ts
 * owns that (review 2026-10-03); this only hands it the bound device id.
 */
export const defaultFactory: AdapterFactory = (platform, deviceId, opts) => {
  if (platform === 'android') return new AndroidAdapter({ serial: deviceId });
  // The registry hands over the resolved kind (kindFor); the fallback only
  // serves a direct caller of the factory, and names the same default.
  return new IosAdapter({
    udid: deviceId,
    treeSource: createIosTreeSource(opts?.treeSource ?? DEFAULT_IOS_TREE_SOURCE, deviceId),
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
   * `simctl list` on the host — the type does not let it.
   */
  constructor(deps: { factory: AdapterFactory; discovery: DeviceDiscovery } = { factory: defaultFactory, discovery: defaultDiscovery }) {
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
      throw new Error(`Device "${deviceId}" is ${device.state} — boot it first`);
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
      const stillBooted = (await this.probe(platform)).some(
        (d) => d.id === binding.deviceId && d.state === 'booted',
      );
      // A select() may have rebound the platform while we awaited the probe.
      // Acting on the CAPTURED binding would re-cache the evicted (already
      // disposed) device's adapter — start over against the current binding.
      // (select() always stores a fresh object, so identity detects it.)
      if (this.bindings.get(platform) !== binding) return this.get(platform, opts);
      if (stillBooted) return this.adapterFor(platform, binding.deviceId, opts);
      if (binding.pinned) {
        throw new Error(
          `Selected ${platform} device "${binding.deviceId}" is no longer booted — ` +
            'reboot it or select_device another one',
        );
      }
      this.bindings.delete(platform);
      this.evict(platform, binding.deviceId);
    }

    const booted = (await this.probe(platform)).filter((d) => d.state === 'booted');
    // Same race on the unbound path: a select() that landed during this probe
    // owns the binding now — honor it instead of auto-picking over it.
    if (this.bindings.get(platform) !== undefined) return this.get(platform, opts);
    if (booted.length === 0) {
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
   * EVERY tool call (that is how a vanished device is noticed), which on
   * Android is `adb devices -l` plus one `getprop` per attached device.
   * Not cached here — a stale "still booted" would hand out an adapter for a
   * device that is gone. Async, so a discovery that throws synchronously is
   * the same event as one that rejects (the rule disposeQuietly states) —
   * listAll's per-platform catch must see both.
   */
  private async probe(platform: Platform): Promise<Device[]> {
    return this.discovery(platform);
  }
}
