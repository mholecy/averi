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

  it('recognizes Compose text inputs dumped as focusable+long-clickable scroll views', () => {
    // Measured 2026-08-05: the login username field dumps as
    // HorizontalScrollView with the content in `text` — no EditText anywhere.
    const composeXml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="app" content-desc="" bounds="[0,0][1080,2400]">
    <node index="0" text="Martha.Key" resource-id="app:id/login.username.input" class="android.widget.HorizontalScrollView" package="app" content-desc="" focusable="true" long-clickable="true" bounds="[44,511][1036,654]"/>
    <node index="1" text="" resource-id="app:id/real_scroller" class="android.widget.HorizontalScrollView" package="app" content-desc="" focusable="false" long-clickable="false" scrollable="true" bounds="[0,700][1080,900]"/>
  </node>
</hierarchy>`;
    const t = parseUiautomatorXml(composeXml);
    expect(t.children[0]).toMatchObject({
      role: 'textfield',
      identifier: 'login.username.input',
      value: 'Martha.Key',
    });
    expect(t.children[1]).toMatchObject({ role: 'scrollable', value: null });
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

  it('typeText sends one input-text call per character (bulk injection drops chars on Compose fields)', async () => {
    const { fn, calls } = fakeExec({});
    await new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).typeText('a $b');
    expect(calls).toEqual([
      'adb -s emulator-5554 shell input text a',
      'adb -s emulator-5554 shell input text %s',
      'adb -s emulator-5554 shell input text \\$',
      'adb -s emulator-5554 shell input text b',
      // DPAD_LEFT + DPAD_RIGHT: the cursor nudge that commits GBoard's trailing
      // composition span, so the last character survives a following BACK or tap.
      'adb -s emulator-5554 shell input keyevent 21',
      'adb -s emulator-5554 shell input keyevent 22',
    ]);
  });

  it('launch with clearState clears app data first', async () => {
    const { fn, calls } = fakeExec({});
    await new AndroidAdapter({ serial: 'emulator-5554', exec: fn })
      .launch('md.bank.app', { clearState: true });
    expect(calls[0]).toBe('adb -s emulator-5554 shell pm clear md.bank.app');
    expect(calls[1]).toContain('monkey -p md.bank.app');
  });

  it('launch with an activity uses am start -n, not monkey (monkey may pick LeakCanary)', async () => {
    const { fn, calls } = fakeExec({});
    await new AndroidAdapter({ serial: 'emulator-5554', exec: fn })
      .launch('md.bank.app', { activity: '.MainActivity' });
    expect(calls).toEqual([
      'adb -s emulator-5554 shell am start -n md.bank.app/.MainActivity',
    ]);
  });

  it('launch passes a full pkg/Activity component through unchanged', async () => {
    const { fn, calls } = fakeExec({});
    await new AndroidAdapter({ serial: 'emulator-5554', exec: fn })
      .launch('md.bank.app', { activity: 'md.bank.app/md.bank.ShareActivity' });
    expect(calls[0]).toBe('adb -s emulator-5554 shell am start -n md.bank.app/md.bank.ShareActivity');
  });

  it('launch with an intent builds am start action/data/type/categories/extras', async () => {
    const { fn, calls } = fakeExec({});
    await new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).launch('md.bank.app', {
      activity: '.ShareActivity',
      intent: {
        action: 'android.intent.action.SEND',
        mimeType: 'image/png',
        categories: ['android.intent.category.DEFAULT'],
        extras: { qr: 'payload' },
      },
    });
    expect(calls[0]).toBe(
      'adb -s emulator-5554 shell am start -n md.bank.app/.ShareActivity ' +
        '-a android.intent.action.SEND -t image/png -c android.intent.category.DEFAULT --es qr payload',
    );
  });

  it('setClipboard reports unsupported', async () => {
    await expect(new AndroidAdapter().setClipboard('x')).rejects.toThrow(/not supported/);
  });

  it('viewport parses wm size (Override beats Physical) and caches', async () => {
    const { fn, calls } = fakeExec({
      'adb -s emulator-5554 shell wm size': 'Physical size: 1080x2280\nOverride size: 1000x2000\n',
    });
    const adapter = new AndroidAdapter({ serial: 'emulator-5554', exec: fn });
    expect(await adapter.viewport()).toEqual({ width: 1000, height: 2000 });
    expect(await adapter.viewport()).toEqual({ width: 1000, height: 2000 });
    expect(calls.filter((c) => c.includes('wm size'))).toHaveLength(1);
  });

  it('clearText moves to end, then one keyevent per call (batches drop events in the IME queue)', async () => {
    const { fn, calls } = fakeExec({});
    await new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).clearText(2);
    expect(calls).toEqual([
      'adb -s emulator-5554 shell input keyevent 123', // MOVE_END
      'adb -s emulator-5554 shell input keyevent 67',
      'adb -s emulator-5554 shell input keyevent 67',
      'adb -s emulator-5554 shell input keyevent 112',
      'adb -s emulator-5554 shell input keyevent 112',
    ]);
  });

  it('clearText(0) is a no-op', async () => {
    const { fn, calls } = fakeExec({});
    await new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).clearText(0);
    expect(calls).toHaveLength(0);
  });
});
