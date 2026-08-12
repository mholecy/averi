import { AndroidAdapter } from '../adapters/android.js';
import { IosAdapter } from '../adapters/ios.js';
import type { Device, DeviceAdapter, Platform } from '../adapters/types.js';

/** Unbound (deviceId omitted) adapters probe; bound ones drive one device. */
export type AdapterFactory = (platform: Platform, deviceId?: string) => DeviceAdapter;

const defaultFactory: AdapterFactory = (platform, deviceId) =>
  platform === 'android'
    ? new AndroidAdapter({ serial: deviceId })
    : new IosAdapter({ udid: deviceId });

/**
 * Resolves a platform to an adapter bound to one device: the device pinned
 * via select() when there is one, otherwise the first booted device.
 * Bindings are cached; a vanished auto-picked device invalidates its cache
 * entry, a vanished PINNED device is an error — the user chose it, silently
 * running elsewhere is exactly the surprise select() exists to prevent.
 */
export class AdapterRegistry {
  private cache = new Map<Platform, { adapter: DeviceAdapter; deviceId: string; pinned: boolean }>();

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
    return this.cache.get(platform)?.deviceId;
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
    this.cache.set(platform, {
      adapter: this.factory(platform, deviceId),
      deviceId,
      pinned: true,
    });
    return device;
  }

  async get(platform: Platform): Promise<DeviceAdapter> {
    const cached = this.cache.get(platform);
    if (cached) {
      const stillBooted = (await this.probe(platform)).some(
        (d) => d.id === cached.deviceId && d.state === 'booted',
      );
      if (stillBooted) return cached.adapter;
      if (cached.pinned) {
        throw new Error(
          `Selected ${platform} device "${cached.deviceId}" is no longer booted — ` +
            'reboot it or select_device another one',
        );
      }
      this.cache.delete(platform);
    }

    const booted = (await this.probe(platform)).filter((d) => d.state === 'booted');
    if (booted.length === 0) {
      throw new Error(
        platform === 'android'
          ? 'No booted Android emulator/device found (adb devices)'
          : 'No booted iOS simulator found (xcrun simctl list)',
      );
    }
    const device = booted[0];
    this.cache.set(platform, {
      adapter: this.factory(platform, device.id),
      deviceId: device.id,
      pinned: false,
    });
    return this.cache.get(platform)!.adapter;
  }

  private probe(platform: Platform): Promise<Device[]> {
    return this.factory(platform).listDevices();
  }
}
