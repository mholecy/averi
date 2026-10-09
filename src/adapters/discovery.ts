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
 * adb calls `device` (an offline or unauthorized one cannot answer; its
 * version is `unknown`). The getprop's argv is adb-shell.ts#adbShellArgv's,
 * the one builder AndroidAdapter's `shell` uses too — every word quoted, even
 * words that need no quoting.
 *
 * `unauthorized` is listed since 2026-10-09 (C5): until then its line did not
 * match, so a phone waiting on its "Allow USB debugging?" prompt vanished and
 * every tool said "No booted Android emulator/device found". Its line shape
 * (`<serial>  unauthorized [usb:…] transport_id:N`, no model) is adb's client
 * source, NOT measured on a device. adb's other states (`authorizing`,
 * `connecting`, `no permissions (…)`, `recovery`, `sideload`, `bootloader`,
 * …) are still left out — unmeasured, and not asked for.
 */
export async function listAndroidDevices(exec: ExecFn = defaultExec): Promise<Device[]> {
  const { stdout } = await exec('adb', ['devices', '-l']);
  const devices: Device[] = [];
  for (const line of stdout.toString('utf8').split('\n').slice(1)) {
    const match = line.trim().match(/^(\S+)\s+(device|offline|unauthorized)\b/);
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
      state: state === 'device' ? 'booted' : state === 'offline' ? 'offline' : 'unauthorized',
    });
  }
  return devices;
}

/**
 * Why adb lists an Android device that cannot be driven, and what to do — a
 * reason sentence starting `is …` and ending with a full stop, which the
 * registry puts after the device's name in each of its three
 * refusals (auto-pick, select_device, a pinned device), so the remedy is
 * worded once, beside the listing that read the state. undefined for a
 * booted device, and on iOS (offline there is a shut-down simulator; the
 * registry words that).
 */
export function androidUnusable(device: Device): string | undefined {
  if (device.platform !== 'android') return undefined;
  if (device.state === 'unauthorized') {
    return 'is unauthorized: adb sees it, but the device has not accepted this computer\'s debugging key. On a ' +
      'phone, unlock it and accept the "Allow USB debugging?" prompt; on an emulator, `adb kill-server`, then ' +
      '`adb devices` to reconnect (restart the emulator if it stays unauthorized).';
  }
  if (device.state === 'offline') {
    return 'is offline: adb sees it but cannot talk to it. An emulator still booting reads offline for a while — ' +
      'wait until `adb devices` reads `device`; if it stays offline, `adb kill-server && adb start-server`, then ' +
      'restart the emulator or reconnect the USB cable.';
  }
  return undefined;
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
