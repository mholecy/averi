import { describe, expect, it } from 'vitest';
import { AndroidAdapter, parseUiautomatorXml } from '../../src/adapters/android.js';
import type { ExecFn, ExecResult } from '../../src/adapters/exec.js';

/** Fake exec that records calls and replays canned responses by command prefix. */
function fakeExec(responses: Record<string, string | Buffer>) {
  const calls: string[] = [];
  const fn: ExecFn = async (cmd, args): Promise<ExecResult> => {
    const full = [cmd, ...args].join(' ');
    calls.push(full);
    for (const [prefix, out] of Object.entries(responses)) {
      if (full.startsWith(prefix)) {
        return { stdout: Buffer.isBuffer(out) ? out : Buffer.from(out), stderr: '' };
      }
    }
    return { stdout: Buffer.alloc(0), stderr: '' };
  };
  return { fn, calls };
}

const DEVICES_OUTPUT = `List of devices attached
emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1
emulator-5556          offline transport_id:2

`;

// Trimmed real-world shape: hierarchy root, nested nodes, PIN field, button.
const UIAUTOMATOR_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="md.bank.app" content-desc="" bounds="[0,0][1080,2400]">
    <node index="0" text="" resource-id="md.bank.app:id/pin_keyboard" class="android.view.ViewGroup" package="md.bank.app" content-desc="PIN keyboard" bounds="[0,1200][1080,2400]">
      <node index="0" text="1" resource-id="md.bank.app:id/pin_key_1" class="android.widget.Button" package="md.bank.app" content-desc="" bounds="[0,1200][360,1500]"/>
      <node index="1" text="2" resource-id="md.bank.app:id/pin_key_2" class="android.widget.Button" package="md.bank.app" content-desc="" bounds="[360,1200][720,1500]"/>
    </node>
    <node index="1" text="user@bank.md" resource-id="md.bank.app:id/username_field" class="android.widget.EditText" package="md.bank.app" content-desc="" bounds="[100,400][980,520]"/>
    <node index="2" text="Log in" resource-id="" class="android.widget.TextView" package="md.bank.app" content-desc="" bounds="[100,600][980,700]"/>
  </node>
</hierarchy>
UI hierchary dumped to: /dev/tty`;

describe('AndroidAdapter.listDevices', () => {
  it('parses adb devices -l and fetches OS version for booted devices', async () => {
    const { fn } = fakeExec({
      'adb devices -l': DEVICES_OUTPUT,
      'adb -s emulator-5554 shell getprop': '14\n',
    });
    const devices = await new AndroidAdapter({ exec: fn }).listDevices();
    expect(devices).toEqual([
      {
        id: 'emulator-5554', platform: 'android', name: 'sdk_gphone64_arm64',
        osVersion: '14', state: 'booted',
      },
      {
        id: 'emulator-5556', platform: 'android', name: 'emulator-5556',
        osVersion: 'unknown', state: 'offline',
      },
    ]);
  });
});

describe('parseUiautomatorXml', () => {
  const tree = parseUiautomatorXml(UIAUTOMATOR_XML.slice(0, UIAUTOMATOR_XML.lastIndexOf('>') + 1));

  it('normalizes roles, identifiers, labels and bounds', () => {
    expect(tree.role).toBe('container');
    const keyboard = tree.children[0];
    expect(keyboard.identifier).toBe('pin_keyboard');
    expect(keyboard.label).toBe('PIN keyboard');
    expect(keyboard.children[0]).toMatchObject({
      role: 'button', identifier: 'pin_key_1', label: '1',
      rect: { x: 0, y: 1200, width: 360, height: 300 },
    });
  });

  it('exposes EditText text as value', () => {
    const username = tree.children[1];
    expect(username).toMatchObject({
      role: 'textfield', identifier: 'username_field', value: 'user@bank.md',
    });
  });

  it('maps TextView to text with a null identifier for empty resource-id', () => {
    expect(tree.children[2]).toMatchObject({ role: 'text', label: 'Log in', identifier: null });
  });
});

describe('AndroidAdapter interactions', () => {
  it('uiTree strips the trailing uiautomator status line', async () => {
    const { fn } = fakeExec({ 'adb -s emulator-5554 exec-out uiautomator': UIAUTOMATOR_XML });
    const tree = await new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).uiTree();
    expect(tree.children).toHaveLength(3);
  });

  it('tapElement resolves a selector and taps the rect center', async () => {
    const { fn, calls } = fakeExec({ 'adb -s emulator-5554 exec-out uiautomator': UIAUTOMATOR_XML });
    await new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).tapElement('id:pin_key_2');
    expect(calls.at(-1)).toBe('adb -s emulator-5554 shell input tap 540 1350');
  });

  it('typeText encodes spaces and escapes shell metacharacters', async () => {
    const { fn, calls } = fakeExec({});
    await new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).typeText('hi there $USER');
    expect(calls[0]).toBe('adb -s emulator-5554 shell input text hi%sthere%s\\$USER');
  });

  it('launch with clearState clears app data first', async () => {
    const { fn, calls } = fakeExec({});
    await new AndroidAdapter({ serial: 'emulator-5554', exec: fn })
      .launch('md.bank.app', { clearState: true });
    expect(calls[0]).toBe('adb -s emulator-5554 shell pm clear md.bank.app');
    expect(calls[1]).toContain('monkey -p md.bank.app');
  });

  it('setClipboard reports unsupported', async () => {
    await expect(new AndroidAdapter().setClipboard('x')).rejects.toThrow(/not supported/);
  });
});
