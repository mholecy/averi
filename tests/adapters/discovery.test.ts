import { describe, expect, it } from 'vitest';
import {
  androidUnusable,
  defaultDiscoveryDeps,
  discoveryOver,
  discoveryWith,
  iosBootedFromDevicePlist,
  listAndroidDevices,
  listIosDevices,
  type BootedProof,
} from '../../src/adapters/discovery.js';
import type { Device } from '../../src/adapters/types.js';
import { device, recordingListing } from '../helpers/listing.js';
import { exec as defaultExec, type ExecFn, type ExecOptions, type ExecResult } from '../../src/adapters/exec.js';

/** Fake exec that records calls and replays canned responses by command prefix. */
function fakeExec(responses: Record<string, string>) {
  const calls: string[] = [];
  const options: (ExecOptions | undefined)[] = [];
  const fn: ExecFn = async (cmd, args, opts): Promise<ExecResult> => {
    const full = [cmd, ...args].join(' ');
    calls.push(full);
    options.push(opts);
    for (const [prefix, out] of Object.entries(responses)) {
      if (full.startsWith(prefix)) return { stdout: Buffer.from(out), stderr: '' };
    }
    return { stdout: Buffer.alloc(0), stderr: '' };
  };
  return { fn, calls, options };
}

describe('listAndroidDevices', () => {
  const DEVICES_OUTPUT = `List of devices attached
emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1
emulator-5556          offline transport_id:2

`;

  it('parses adb devices -l and asks each ONLINE device, by its own serial, for its OS version', async () => {
    const { fn, calls } = fakeExec({
      'adb devices -l': DEVICES_OUTPUT,
      'adb -s emulator-5554 shell getprop ro.build.version.release': '14\n',
    });
    expect(await listAndroidDevices(fn)).toEqual([
      { id: 'emulator-5554', platform: 'android', name: 'sdk_gphone64_arm64', osVersion: '14', state: 'booted' },
      { id: 'emulator-5556', platform: 'android', name: 'emulator-5556', osVersion: 'unknown', state: 'offline' },
    ]);
    // An offline device cannot answer a getprop: it is not asked.
    expect(calls).toEqual(['adb devices -l', 'adb -s emulator-5554 shell getprop ro.build.version.release']);
  });

  it('an online device whose getprop says nothing is `unknown`, not an empty version', async () => {
    const { fn } = fakeExec({ 'adb devices -l': 'List of devices attached\nR58M123 device usb:1-1\n' });
    expect(await listAndroidDevices(fn)).toEqual([
      { id: 'R58M123', platform: 'android', name: 'R58M123', osVersion: 'unknown', state: 'booted' },
    ]);
  });

  // D13 (2026-10-31): the registry's per-call probe (mcp/registry.ts#get)
  // asks only which devices are booted, and pays no getprop for a version
  // nothing on that path reads (why and what it costs: discovery.ts#ListOpts).
  it('without versions, lists from `adb devices -l` alone — no getprop, every version `unknown`', async () => {
    const { fn, calls } = fakeExec({
      'adb devices -l': DEVICES_OUTPUT,
      'adb -s emulator-5554 shell getprop ro.build.version.release': '14\n',
    });
    expect(await listAndroidDevices(fn, { versions: false })).toEqual([
      { id: 'emulator-5554', platform: 'android', name: 'sdk_gphone64_arm64', osVersion: 'unknown', state: 'booted' },
      { id: 'emulator-5556', platform: 'android', name: 'emulator-5556', osVersion: 'unknown', state: 'offline' },
    ]);
    expect(calls).toEqual(['adb devices -l']);
  });

  // C5 (2026-10-09): an `unauthorized` line did not match the parser, so a
  // phone waiting on its RSA prompt vanished from the listing and every tool
  // said "No booted Android emulator/device found". The line shapes are adb's
  // long listing as its client source writes it (serial, state, then usb:/
  // transport_id: — no product/model while unauthorized); NOT measured on a
  // device in this repo.
  it('lists an UNAUTHORIZED device as such, and does not ask it for its OS version', async () => {
    const { fn, calls } = fakeExec({
      'adb devices -l': 'List of devices attached\nR58M123        unauthorized usb:1-1 transport_id:3\nemulator-5556  unauthorized transport_id:4\n',
    });
    expect(await listAndroidDevices(fn)).toEqual([
      { id: 'R58M123', platform: 'android', name: 'R58M123', osVersion: 'unknown', state: 'unauthorized' },
      { id: 'emulator-5556', platform: 'android', name: 'emulator-5556', osVersion: 'unknown', state: 'unauthorized' },
    ]);
    expect(calls).toEqual(['adb devices -l']);
  });
});

describe('androidUnusable — why adb lists a device that cannot be driven', () => {
  const android = (state: Device['state']): Device => ({ id: 'R58M123', platform: 'android', name: 'R58M123', osVersion: 'unknown', state });

  it('unauthorized: accept the debugging prompt on the device, or re-key the emulator', () => {
    expect(androidUnusable(android('unauthorized'))).toBe(
      'is unauthorized: adb sees it, but the device has not accepted this computer\'s debugging key. On a phone, ' +
        'unlock it and accept the "Allow USB debugging?" prompt; on an emulator, `adb kill-server`, then ' +
        '`adb devices` to reconnect (restart the emulator if it stays unauthorized).',
    );
  });

  it('offline: present but not answering — wait, then restart adb', () => {
    expect(androidUnusable(android('offline'))).toBe(
      'is offline: adb sees it but cannot talk to it. An emulator still booting reads offline for a while — wait ' +
        'until `adb devices` reads `device`; if it stays offline, `adb kill-server && adb start-server`, then ' +
        'restart the emulator or reconnect the USB cable.',
    );
  });

  it('nothing to say about a booted device, nor about iOS (offline there is "shut down")', () => {
    expect(androidUnusable(android('booted'))).toBeUndefined();
    expect(androidUnusable({ ...android('offline'), platform: 'ios' })).toBeUndefined();
  });
});

describe('listIosDevices', () => {
  const SIMCTL_LIST = JSON.stringify({
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-17-5': [
        { udid: 'AAAA-1111', name: 'iPhone 15', state: 'Booted', isAvailable: true },
        { udid: 'BBBB-2222', name: 'iPhone 15 Pro', state: 'Shutdown', isAvailable: true },
        { udid: 'CCCC-3333', name: 'Broken runtime', state: 'Shutdown', isAvailable: false },
      ],
      'com.apple.CoreSimulator.SimRuntime.iOS-16-4': [
        { udid: 'DDDD-4444', name: 'iPhone 14', state: 'Shutdown', isAvailable: true },
      ],
    },
  });

  it('parses simctl JSON, derives the OS version from the runtime, filters unavailable devices', async () => {
    const { fn, calls, options } = fakeExec({ 'xcrun simctl list devices --json': SIMCTL_LIST });
    expect(await listIosDevices(fn)).toEqual([
      { id: 'AAAA-1111', platform: 'ios', name: 'iPhone 15', osVersion: '17.5', state: 'booted' },
      { id: 'BBBB-2222', platform: 'ios', name: 'iPhone 15 Pro', osVersion: '17.5', state: 'offline' },
      { id: 'DDDD-4444', platform: 'ios', name: 'iPhone 14', osVersion: '16.4', state: 'offline' },
    ]);
    // Under the DEVELOPER_DIR probe the adapter and WdaServer share (xcode-env.ts).
    expect(calls).toContain('xcrun --find simctl');
    // Through xcode-env.ts#simctl (pinned in xcode-env.test.ts): the listing has no timeout of its own.
    expect(options[calls.indexOf('xcrun simctl list devices --json')]).not.toHaveProperty('timeoutMs');
  });
});

describe('iosBootedFromDevicePlist — the bound simulator\'s own record, before simctl (D22)', () => {
  const UDID = 'D8DACDE6-6352-437C-AA22-86FB06275C3F';
  /** The lab simulator's device.plist as CoreSimulator wrote it (Xcode 27, iOS 27.0; 701 bytes, 2026-10-31), its state a parameter. */
  const plist = (state: string, udid = UDID, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>UDID</key>
\t<string>${udid}</string>
\t<key>deviceType</key>
\t<string>com.apple.CoreSimulator.SimDeviceType.iPhone-17</string>
\t<key>isDeleted</key>
\t<false/>
\t<key>isEphemeral</key>
\t<false/>
\t<key>lastUsedAt</key>
\t<date>2026-10-31T09:34:48Z</date>
\t<key>name</key>
\t<string>averi-lab iPhone 17</string>
\t<key>runtime</key>
\t<string>com.apple.CoreSimulator.SimRuntime.iOS-27-0</string>
\t<key>runtimePolicy</key>
\t<string>System</string>${extra}
\t<key>state</key>
\t<integer>${state}</integer>
</dict>
</plist>
`;
  /** A reader over one file's text; records each path asked for. A thrown value stands for a missing or unreadable file. */
  const reader = (text: string | Error) => {
    const paths: string[] = [];
    const read = async (path: string) => {
      paths.push(path);
      if (text instanceof Error) throw text;
      return text;
    };
    return { read, paths };
  };

  it('state 3 in the default device set\'s file for that UDID reads booted', async () => {
    const { read, paths } = reader(plist('3'));
    expect(await iosBootedFromDevicePlist(UDID, read, '/Users/lab')).toBe(true);
    expect(paths).toEqual([`/Users/lab/Library/Developer/CoreSimulator/Devices/${UDID}/device.plist`]);
  });

  // false is "ask simctl", never "shut down": each of these leaves the answer to the listing.
  it.each([
    ['state 1 (shut down)', plist('1')],
    ['state 2 (booting, unmeasured)', plist('2')],
    ['state 3 recorded for another UDID', plist('3', 'AAAA-1111')],
    ['state 3 on a deleted device', plist('3').replace('<key>isDeleted</key>\n\t<false/>', '<key>isDeleted</key>\n\t<true/>')],
    // A 3 in some other dict is not the device's own: not the flat shape read, so not believed.
    ['a second state key, 3, before the device\'s own 1', plist('1', UDID, '\n\t<key>state</key>\n\t<integer>3</integer>')],
    ['a second state key, 1, before a 3', plist('3', UDID, '\n\t<key>state</key>\n\t<integer>1</integer>')],
    ['two state keys, both 3', plist('3', UDID, '\n\t<key>state</key>\n\t<integer>3</integer>')],
    [
      'state 3 only inside a nested dict, the device\'s own state missing',
      plist('3')
        .replace(/\t<key>state<\/key>\n\t<integer>3<\/integer>\n/, '')
        .replace('<string>System</string>', '<string>System</string>\n\t<key>extra</key>\n\t<dict>\n\t\t<key>state</key>\n\t\t<integer>3</integer>\n\t</dict>'),
    ],
    ['state 3 on a deleted device, spelled <true />', plist('3').replace('<key>isDeleted</key>\n\t<false/>', '<key>isDeleted</key>\n\t<true />')],
    ['no state key', plist('3').replace(/\t<key>state<\/key>\n\t<integer>3<\/integer>\n/, '')],
    ['a binary plist', 'bplist00\u00d4\u0001\u0002state'],
    ['garbage', 'not a plist'],
  ])('%s reads not-proven-booted', async (_why, text) => {
    expect(await iosBootedFromDevicePlist(UDID, reader(text).read, '/Users/lab')).toBe(false);
  });

  it('a missing or unreadable file reads not-proven-booted, without throwing', async () => {
    const missing = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    expect(await iosBootedFromDevicePlist(UDID, reader(missing).read, '/Users/lab')).toBe(false);
  });
});

describe('DeviceDiscovery.check — is the bound device still usable? (discoveryOver)', () => {
  /** A discovery over a fixed device list (`recordingListing`); `proofs` records each udid the proof was asked about. No proof given: none is wired. */
  function over(devices: Device[], proof?: BootedProof) {
    const { listing, platforms, versions } = recordingListing(devices);
    const proofs: string[] = [];
    const discovery = discoveryOver(listing, proof === undefined ? undefined : (udid) => (proofs.push(udid), proof(udid)));
    return { discovery, platforms, versions, proofs };
  }

  it('listed and booted: usable, from a listing without versions (D13)', async () => {
    const { discovery, platforms, versions } = over([device('phone')]);
    expect(await discovery.check('android', 'phone')).toEqual({ usable: true });
    expect(platforms).toEqual(['android']);
    expect(versions).toEqual([false]);
  });

  it('listed but not booted: unusable, the entry kept for the refusal\'s wording', async () => {
    const { discovery } = over([device('other'), device('R58M123', 'unauthorized')]);
    expect(await discovery.check('android', 'R58M123')).toEqual({ usable: false, listed: device('R58M123', 'unauthorized') });
  });

  it('not listed: unusable, nothing listed', async () => {
    const { discovery } = over([device('other')]);
    expect(await discovery.check('android', 'phone')).toEqual({ usable: false, listed: undefined });
  });

  it('listed twice (a shared serial): usable while one entry is booted; unusable names the FIRST entry', async () => {
    expect(await over([device('0123', 'unauthorized'), device('0123')]).discovery.check('android', '0123')).toEqual({ usable: true });
    const { discovery } = over([device('0123', 'unauthorized'), device('0123', 'offline')]);
    expect(await discovery.check('android', '0123')).toEqual({ usable: false, listed: device('0123', 'unauthorized') });
  });

  it('iOS proven booted (D22): usable without a listing', async () => {
    const { discovery, platforms, versions, proofs } = over([], async () => true);
    expect(await discovery.check('ios', 'sim')).toEqual({ usable: true });
    expect(proofs).toEqual(['sim']);
    expect(platforms).toEqual([]);
    expect(versions).toEqual([]);
  });

  // Not proven is "ask simctl", never "shut down": the listing decides, with the same options.
  it.each([
    ['not proven', async () => false],
    ['a proof that rejects', async () => Promise.reject(new Error('EACCES'))],
    ['a proof that throws synchronously', (() => { throw new Error('boom'); }) as unknown as BootedProof],
  ])('%s: the listing decides, without versions', async (_why, proof) => {
    const { discovery, platforms, versions, proofs } = over([device('sim', 'booted', 'ios'), device('off', 'offline', 'ios')], proof);
    expect(await discovery.check('ios', 'sim')).toEqual({ usable: true });
    expect(await discovery.check('ios', 'off')).toEqual({ usable: false, listed: device('off', 'offline', 'ios') });
    expect(proofs).toEqual(['sim', 'off']);
    expect(platforms).toEqual(['ios', 'ios']);
    expect(versions).toEqual([false, false]);
  });

  it('Android never asks the proof: it lists with adb', async () => {
    const { discovery, platforms, versions, proofs } = over([device('phone')], async () => true);
    expect(await discovery.check('android', 'phone')).toEqual({ usable: true });
    expect(proofs).toEqual([]);
    expect(platforms).toEqual(['android']);
    expect(versions).toEqual([false]);
  });

  it('a discovery built without a proof never proves: the iOS check lists', async () => {
    const { discovery, platforms, versions } = over([device('sim', 'booted', 'ios')]);
    expect(await discovery.check('ios', 'sim')).toEqual({ usable: true });
    expect(platforms).toEqual(['ios']);
    expect(versions).toEqual([false]);
  });

  it('list is the listing itself, its options passed through', async () => {
    const { discovery, platforms, versions } = over([device('phone'), device('sim', 'booted', 'ios')]);
    expect((await discovery.list('ios')).map((d) => d.id)).toEqual(['sim']);
    await discovery.list('android', { versions: false });
    expect(platforms).toEqual(['ios', 'android']);
    expect(versions).toEqual([true, false]);
  });
});

describe('discoveryWith — the adb and simctl listings over one exec', () => {
  it('lists android with adb and ios with simctl — the platform reaches the right listing', async () => {
    const { fn, calls } = fakeExec({ 'xcrun simctl': '{"devices":{}}' });
    const discovery = discoveryWith(fn);
    expect(await discovery.list('android')).toEqual([]);
    expect(calls).toEqual(['adb devices -l']);
    calls.length = 0;
    expect(await discovery.list('ios')).toEqual([]);
    expect(calls).toContain('xcrun simctl list devices --json');
    expect(calls.some((c) => c.startsWith('adb'))).toBe(false);
  });

  it('hands the listing its options — `versions: false` reaches adb as no getprop', async () => {
    const { fn, calls } = fakeExec({ 'adb devices': 'List of devices attached\nemulator-5554 device\n', 'adb -s': '14\n' });
    const discovery = discoveryWith(fn);
    expect((await discovery.list('android', { versions: false })).map((d) => d.osVersion)).toEqual(['unknown']);
    expect(calls).toEqual(['adb devices -l']);
    expect((await discovery.list('android')).map((d) => d.osVersion)).toEqual(['14']);
  });

  it('check lists without versions: on Android `adb devices -l` alone', async () => {
    const { fn, calls } = fakeExec({ 'adb devices': 'List of devices attached\nemulator-5554 device\n' });
    expect(await discoveryWith(fn).check('android', 'emulator-5554')).toEqual({ usable: true });
    expect(calls).toEqual(['adb devices -l']);
  });

  it('the server\'s discovery is built on the real exec and the device.plist proof', () => {
    expect(defaultDiscoveryDeps).toEqual({ exec: defaultExec, iosBooted: iosBootedFromDevicePlist });
  });
});
