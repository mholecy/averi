import { exec as defaultExec, type ExecFn } from './exec.js';
import { adbShellArgv } from './adb-shell.js';
import { simctl } from './xcode-env.js';
import type { Device } from './types.js';

/**
 * Which devices a platform has — a question about the PLATFORM, not about a
 * device, so it is not a member of the bound DeviceAdapter (2026-10-08, the
 * iOS adapter stack review's candidate 1). Until then `listDevices()` sat on
 * the adapter interface, and both adapters carried an "unbound" mode for it
 * that the registry used for nothing else: an IosAdapter without a udid
 * (simctl's `booted` alias, a lazily resolved UDID for idb, a uiTree() that
 * refused, a `<udid>` placeholder in a reboot hint) and an AndroidAdapter
 * without a serial (adb with no `-s`, a "the default adb device" wording, a
 * "more than one device" diagnosis `adb -s <serial> get-state` never
 * returns). The registry built one such probe adapter per probe. Now the
 * registry has two dependencies — this listing (mcp/registry.ts,
 * `DeviceDiscovery`) and the factory of bound adapters, whose device id is a
 * constructor invariant — and the unbound mode is gone.
 *
 * Plain functions over an `ExecFn`, like the adapters: the tests hand them a
 * fake exec, and the registry's tests fake the listing itself.
 */

/**
 * `adb devices -l`, then `getprop ro.build.version.release` on each device
 * adb calls `device` (an offline one cannot answer; its version is
 * `unknown`). The getprop's argv is adb-shell.ts#adbShellArgv's, the one
 * builder AndroidAdapter's `shell` uses too — every word quoted, even words
 * that need no quoting.
 */
export async function listAndroidDevices(exec: ExecFn = defaultExec): Promise<Device[]> {
  const { stdout } = await exec('adb', ['devices', '-l']);
  const devices: Device[] = [];
  for (const line of stdout.toString('utf8').split('\n').slice(1)) {
    const match = line.trim().match(/^(\S+)\s+(device|offline)\b/);
    if (!match) continue;
    const [, id, state] = match;
    const model = line.match(/model:(\S+)/)?.[1] ?? id;
    let osVersion = 'unknown';
    if (state === 'device') {
      const prop = await exec('adb', adbShellArgv(id, ['getprop', 'ro.build.version.release']));
      osVersion = prop.stdout.toString('utf8').trim() || 'unknown';
    }
    devices.push({
      id,
      platform: 'android',
      name: model,
      osVersion,
      state: state === 'device' ? 'booted' : 'offline',
    });
  }
  return devices;
}

/**
 * `xcrun simctl list devices --json` through xcode-env.ts#simctl, the one
 * spelling of a simctl call the iOS adapter uses too (under the DEVELOPER_DIR probe
 * WdaServer shares). Unavailable simulators (a
 * runtime that is not installed) are left out; the OS version is read from
 * the runtime key.
 */
export async function listIosDevices(exec: ExecFn = defaultExec): Promise<Device[]> {
  const { stdout } = await simctl(exec, ['list', 'devices', '--json']);
  const parsed = JSON.parse(stdout.toString('utf8')) as {
    devices: Record<string, { udid: string; name: string; state: string; isAvailable: boolean }[]>;
  };
  const devices: Device[] = [];
  for (const [runtime, list] of Object.entries(parsed.devices)) {
    // "com.apple.CoreSimulator.SimRuntime.iOS-17-5" → "17.5"
    const osVersion = runtime.match(/iOS-([\d-]+)/)?.[1]?.replace(/-/g, '.') ?? 'unknown';
    for (const d of list) {
      if (!d.isAvailable) continue;
      devices.push({
        id: d.udid,
        platform: 'ios',
        name: d.name,
        osVersion,
        state: d.state === 'Booted' ? 'booted' : 'offline',
      });
    }
  }
  return devices;
}
