import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
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

/** An adb state averi lists: what the Device's state becomes, and — for one that cannot be driven — why, and what to do (`androidUnusable`). */
interface AdbStateRow {
  state: Device['state'];
  unusable?: string;
}

/**
 * THE adb states averi lists, one row each (code review S8: until then the
 * listing and `androidUnusable` each switched on the state) — the line
 * pattern is built from its keys.
 */
const ADB_STATES: Readonly<Record<'device' | 'offline' | 'unauthorized', AdbStateRow>> = {
  device: { state: 'booted' },
  offline: {
    state: 'offline',
    unusable:
      'is offline: adb sees it but cannot talk to it. An emulator still booting reads offline for a while — ' +
      'wait until `adb devices` reads `device`; if it stays offline, `adb kill-server && adb start-server`, then ' +
      'restart the emulator or reconnect the USB cable.',
  },
  unauthorized: {
    state: 'unauthorized',
    unusable:
      'is unauthorized: adb sees it, but the device has not accepted this computer\'s debugging key. On a ' +
      'phone, unlock it and accept the "Allow USB debugging?" prompt; on an emulator, `adb kill-server`, then ' +
      '`adb devices` to reconnect (restart the emulator if it stays unauthorized).',
  },
};

type AdbState = keyof typeof ADB_STATES;

/** `<serial>  <state> …` for a state of `ADB_STATES`. */
const ADB_LINE = new RegExp(`^(\\S+)\\s+(${Object.keys(ADB_STATES).join('|')})\\b`);

/**
 * What a listing is asked for beyond which devices exist and in what state.
 * `versions: false` leaves every OS version `unknown` — on Android it skips
 * the getprop per attached device; on iOS the version comes free with the
 * listing (the runtime key), so the flag changes nothing there. Default: the
 * versions are read.
 *
 * Why the flag (D13, 2026-10-31): the registry's per-call probe
 * (mcp/registry.ts#get) asks only "is the bound device still booted?", and
 * a getprop is a full `adb shell` round trip — ≈30–35 ms, up to ~70 ms, per
 * attached device, on every tool call
 * (docs/plans/2026-10-30-performance-backlog.md, D13 note (2026-10-31,
 * averi_lab API 33)) — for a version only select_device's reply and the
 * device listing show. Those two still ask for it.
 */
export interface ListOpts {
  versions?: boolean;
}

/**
 * `adb devices -l`, then `getprop ro.build.version.release` on each device
 * adb calls `device` (an offline or unauthorized one cannot answer; its
 * version is `unknown`). The getprop's argv is adb-shell.ts#adbShellArgv's,
 * the one builder AndroidAdapter's `shell` uses too — every word quoted, even
 * words that need no quoting.
 *
 * `versions: false` (D13, 2026-10-31) lists from `adb devices -l` alone —
 * why, and what it saves, is on `ListOpts`.
 *
 * `unauthorized` is listed since 2026-10-09 (C5): until then its line did not
 * match, so a phone waiting on its "Allow USB debugging?" prompt vanished and
 * every tool said "No booted Android emulator/device found". Its line shape
 * (`<serial>  unauthorized [usb:…] transport_id:N`, no model) is adb's client
 * source, NOT measured on a device. adb's other states (`authorizing`,
 * `connecting`, `no permissions (…)`, `recovery`, `sideload`, `bootloader`,
 * …) are still left out — unmeasured, and not asked for.
 */
export async function listAndroidDevices(exec: ExecFn = defaultExec, opts: ListOpts = {}): Promise<Device[]> {
  const versions = opts.versions ?? true;
  const { stdout } = await exec('adb', ['devices', '-l']);
  const devices: Device[] = [];
  for (const line of stdout.toString('utf8').split('\n').slice(1)) {
    const match = line.trim().match(ADB_LINE);
    if (!match) continue;
    const [, id, adbState] = match;
    const state = adbState as AdbState;
    const model = line.match(/model:(\S+)/)?.[1] ?? id;
    let osVersion = 'unknown';
    if (versions && state === 'device') {
      const prop = await exec('adb', adbShellArgv(id, ['getprop', 'ro.build.version.release']));
      osVersion = prop.stdout.toString('utf8').trim() || 'unknown';
    }
    devices.push({
      id,
      platform: 'android',
      name: model,
      osVersion,
      state: ADB_STATES[state].state,
    });
  }
  return devices;
}

/**
 * Why adb lists an Android device that cannot be driven, and what to do — a
 * reason sentence starting `is …` and ending with a full stop, which the
 * registry puts after the device's name in each of its three
 * refusals (auto-pick, select_device, a pinned device), so the remedy is
 * worded once, beside the listing that read the state (`ADB_STATES`).
 * undefined for a booted device, and on iOS (offline there is a shut-down
 * simulator; the registry words that).
 */
export function androidUnusable(device: Device): string | undefined {
  if (device.platform !== 'android') return undefined;
  return Object.values(ADB_STATES).find((s) => s.state === device.state)?.unusable;
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

/** Reads one file as UTF-8 text — the seam `iosBootedFromDevicePlist`'s tests fake; a missing file rejects. */
export type ReadText = (path: string) => Promise<string>;

export const readText: ReadText = (path) => readFile(path, 'utf8');

/**
 * Whether the simulator `udid` is booted, read from its own record in the
 * default device set — `~/Library/Developer/CoreSimulator/Devices/<udid>/device.plist`
 * — without spawning simctl. `true` only when that file says so; `false`
 * means "cannot tell from the file", NOT "shut down": the caller then asks
 * simctl (`listIosDevices`), which words every refusal as before (D22).
 *
 * Why (D22, docs/plans/2026-10-30-performance-backlog.md, "iOS per-call
 * costs"): the registry proves the bound device is still booted on EVERY
 * tool call (mcp/registry.ts#get), and on iOS that was `xcrun simctl list
 * devices --json` — ~110 ms in the D0 windows on the lab iPhone 17
 * (iOS 27.0), 80 ms timed alone on an idle host (2026-10-31) — for one bit.
 * This read and parse: 0.045 ms median, 0.09 ms p95, ~0.4 ms cold, over
 * 3 × 200 reads of the lab simulator's 701-byte file (2026-10-31, Node 22).
 *
 * The file is CoreSimulator's private, undocumented format. What is relied
 * on was read on this machine (CoreSimulator-1174.9.2, Xcode 27): an XML
 * plist, one flat `<dict>`, with `UDID` (the directory's own name), `state`
 * an integer — 3 while booted, 1 shut down (simctl's own `Booted` /
 * `Shutdown` at the same moment) — and `isDeleted`. So the file must say
 * all of this, or it is not believed: it is XML (a binary plist, `bplist00…`,
 * matches nothing), `UDID` and `state` each appear exactly once, the UDID is
 * the one asked for, the state is exactly `3`, and `isDeleted` is not
 * `<true/>`. Anything else — another state (Booting, Shutting Down), a
 * missing or unreadable file, garbage, another UDID — returns false, and
 * the cost is simctl's, as before. A future Xcode that changes the format
 * therefore costs time, not correctness.
 *
 * The device set: averi never passes simctl `--set`, and neither simctl nor
 * CoreSimulator (strings of both, 2026-10-31) reads a device-set override
 * from the environment, so simctl's set is the default one under the home
 * directory; `home` is `os.homedir()` ($HOME). A $HOME that is not the
 * user's finds no file and falls back.
 *
 * The residual: the file is CoreSimulator's record of the state it last
 * wrote, not a live probe. A CoreSimulatorService that crashed, or a host
 * that lost power, can leave a stale 3 behind for a device that is not
 * running. Then the verb's own simctl or idb call fails with its own error,
 * as when a device dies mid-call today — the registry's "no longer booted"
 * wording is not given for it. simctl list would have told the truth there
 * (it asks the service, which reconciles on start); that is the trade.
 *
 * The decision and its trade: docs/adr/0031-the-bound-simulator-is-proven-booted-from-its-own-record.md.
 */
export async function iosBootedFromDevicePlist(udid: string, read: ReadText = readText, home: string = homedir()): Promise<boolean> {
  let text: string;
  try {
    text = await read(`${home}/Library/Developer/CoreSimulator/Devices/${udid}/device.plist`);
  } catch {
    return false;
  }
  const one = (pattern: RegExp): string | undefined => {
    const all = [...text.matchAll(pattern)];
    return all.length === 1 ? all[0][1] : undefined;
  };
  return (
    one(/<key>UDID<\/key>\s*<string>([^<]*)<\/string>/g) === udid &&
    one(/<key>state<\/key>\s*<integer>([^<]*)<\/integer>/g) === '3' &&
    !/<key>isDeleted<\/key>\s*<true\/>/.test(text)
  );
}
