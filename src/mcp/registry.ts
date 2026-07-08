import { AndroidAdapter } from '../adapters/android.js';
import { IosAdapter } from '../adapters/ios.js';
import type { Device, DeviceAdapter, Platform } from '../adapters/types.js';

/**
 * Resolves a platform to an adapter bound to the first booted device.
 * Bindings are cached; a vanished device invalidates its cache entry.
 */
export class AdapterRegistry {
  private cache = new Map<Platform, { adapter: DeviceAdapter; deviceId: string }>();

  async listAll(): Promise<Device[]> {
    const [android, ios] = await Promise.all([
      new AndroidAdapter().listDevices().catch(() => [] as Device[]), // adb missing → no devices
      new IosAdapter().listDevices().catch(() => [] as Device[]),
    ]);
    return [...android, ...ios];
  }

  async get(platform: Platform): Promise<DeviceAdapter> {
    const cached = this.cache.get(platform);
    if (cached) {
      const stillBooted = (await this.probe(platform)).some(
        (d) => d.id === cached.deviceId && d.state === 'booted',
      );
      if (stillBooted) return cached.adapter;
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
    const adapter: DeviceAdapter =
      platform === 'android'
        ? new AndroidAdapter({ serial: device.id })
        : new IosAdapter({ udid: device.id });
    this.cache.set(platform, { adapter, deviceId: device.id });
    return adapter;
  }

  private probe(platform: Platform): Promise<Device[]> {
    return platform === 'android'
      ? new AndroidAdapter().listDevices()
      : new IosAdapter().listDevices();
  }
}
