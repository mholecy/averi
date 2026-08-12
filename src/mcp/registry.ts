import { AndroidAdapter } from '../adapters/android.js';
import { IosAdapter } from '../adapters/ios.js';
import type { Device, DeviceAdapter, Platform } from '../adapters/types.js';

/** Per-call adapter options — today only the iOS tree source (averi.yaml `app.ios.treeSource`). */
export interface AdapterOpts {
  treeSource?: 'idb' | 'wda';
}

/** Unbound (deviceId omitted) adapters probe; bound ones drive one device. */
export type AdapterFactory = (
  platform: Platform,
  deviceId?: string,
  opts?: AdapterOpts,
) => DeviceAdapter;

const defaultFactory: AdapterFactory = (platform, deviceId, opts) =>
  platform === 'android'
    ? new AndroidAdapter({ serial: deviceId })
    : new IosAdapter({ udid: deviceId, treeSource: opts?.treeSource });

/**
 * The adapter variant an opts set maps to. Normalized so equivalent calls
 * share one cached instance: treeSource is meaningless on android, and an
 * explicit 'idb' IS the default — only ios+wda forks a second adapter (the
 * one that owns a WdaServer; a treeSource-less get for the same device gets
 * the default-variant instance and never races it).
 */
type Variant = 'default' | 'wda';

function variantFor(platform: Platform, opts?: AdapterOpts): Variant {
  return platform === 'ios' && opts?.treeSource === 'wda' ? 'wda' : 'default';
}

/**
 * Resolves a platform to an adapter bound to one device: the device pinned
 * via select() when there is one, otherwise the first booted device.
 * A vanished auto-picked device invalidates its binding, a vanished PINNED
 * device is an error — the user chose it, silently running elsewhere is
 * exactly the surprise select() exists to prevent.
 *
 * The device binding is per platform; ADAPTERS are cached per
 * (platform, deviceId, variant) — a keyed cache instead of a mutable
 * treeSource setter, so two concurrent tool calls with different configs
 * cannot race each other's adapter. Evicting a device's entries disposes
 * them (stops the wda variant's orphan WdaServer).
 */
export class AdapterRegistry {
  /** Which device each platform's tools target. Pins survive across variants. */
  private bindings = new Map<Platform, { deviceId: string; pinned: boolean }>();
  /** Key: JSON [platform, deviceId, variant] — device ids may contain ':' (adb over TCP). */
  private adapters = new Map<string, { platform: Platform; deviceId: string; adapter: DeviceAdapter }>();

  constructor(private readonly factory: AdapterFactory = defaultFactory) {}

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
    const devices = await this.probe(platform);
    const device = devices.find((d) => d.id === deviceId);
    if (!device) {
      const known = devices.map((d) => `${d.id} (${d.state})`).join(', ') || 'none';
      throw new Error(`Unknown ${platform} device "${deviceId}" — known: ${known}`);
    }
    if (device.state !== 'booted') {
      throw new Error(`Device "${deviceId}" is ${device.state} — boot it first`);
    }
    const previous = this.bindings.get(platform);
    if (previous && previous.deviceId !== deviceId) this.evict(platform, previous.deviceId);
    this.bindings.set(platform, { deviceId, pinned: true });
    return device;
  }

  async get(platform: Platform, opts?: AdapterOpts): Promise<DeviceAdapter> {
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
    this.bindings.set(platform, { deviceId: booted[0].id, pinned: false });
    return this.adapterFor(platform, booted[0].id, opts);
  }

  private adapterFor(platform: Platform, deviceId: string, opts?: AdapterOpts): DeviceAdapter {
    const variant = variantFor(platform, opts);
    const key = JSON.stringify([platform, deviceId, variant]);
    let entry = this.adapters.get(key);
    if (!entry) {
      const adapter = this.factory(
        platform,
        deviceId,
        variant === 'wda' ? { treeSource: 'wda' } : undefined,
      );
      entry = { platform, deviceId, adapter };
      this.adapters.set(key, entry);
    }
    return entry.adapter;
  }

  /** Drop and dispose every cached variant bound to one device. */
  private evict(platform: Platform, deviceId: string): void {
    for (const [key, entry] of this.adapters) {
      if (entry.platform === platform && entry.deviceId === deviceId) {
        this.adapters.delete(key);
        entry.adapter.dispose?.();
      }
    }
  }

  private probe(platform: Platform): Promise<Device[]> {
    return this.factory(platform).listDevices();
  }
}
