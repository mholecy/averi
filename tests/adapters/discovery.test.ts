import { describe, expect, it } from 'vitest';
import { listAndroidDevices, listIosDevices } from '../../src/adapters/discovery.js';
import type { ExecFn, ExecOptions, ExecResult } from '../../src/adapters/exec.js';

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
