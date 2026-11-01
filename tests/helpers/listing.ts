import type { DeviceDiscovery } from '../../src/adapters/discovery.js';
import type { Device, Platform } from '../../src/adapters/types.js';

/** One device-list entry, booted on Android unless told otherwise; its name is its id. */
export const device = (id: string, state: Device['state'] = 'booted', platform: Platform = 'android'): Device => ({
  id,
  platform,
  name: id,
  osVersion: '14',
  state,
});

/**
 * A listing over `devices`, which a test may change mid-flight (devices boot and vanish) — what the discovery and
 * registry tests hand `discoveryOver`. `platforms` records each listing's platform; `versions`, whether it asked for OS
 * versions (a listing's default: yes). `onList` gates each listing — lets a test freeze one mid-flight.
 */
export function recordingListing(devices: Device[], onList?: () => Promise<void> | void) {
  const platforms: Platform[] = [];
  const versions: boolean[] = [];
  const listing: DeviceDiscovery['list'] = async (platform, opts) => {
    platforms.push(platform);
    versions.push(opts?.versions ?? true);
    await onList?.();
    return devices.filter((d) => d.platform === platform);
  };
  return { listing, platforms, versions };
}
