import { describe, expect, it, vi } from 'vitest';
import { tapElement } from '../../src/ui-tree/tap-element.js';
import { AndroidAdapter, parseUiautomatorXml } from '../../src/adapters/android.js';
import { ExecError, type ExecFn, type ExecResult } from '../../src/adapters/exec.js';
import { execErrorLikeExec } from '../helpers/exec-error.js';

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

  // Measured 2026-09-17 (mp-native run 5): an emulator dying underneath answered
  // `Killed`, then `` (empty), while adb exited 0 — the message named uiautomator
  // and three calls went at the tool before `adb` said `device offline`.
  describe('uiTree with no XML names the DEVICE state, not the automation tool', () => {
    /** Scripted exec: uiautomator answers in order; get-state is a value or a thrown ExecError. */
    function scripted(dumps: string[], getState: string | ExecError) {
      const calls: string[] = [];
      let i = 0;
      const fn: ExecFn = async (cmd, args): Promise<ExecResult> => {
        const full = [cmd, ...args].join(' ');
        calls.push(full);
        if (full.includes('uiautomator dump')) {
          return { stdout: Buffer.from(dumps[Math.min(i++, dumps.length - 1)]), stderr: '' };
        }
        if (full.endsWith('get-state')) {
          if (getState instanceof ExecError) throw getState;
          return { stdout: Buffer.from(`${getState}\n`), stderr: '' };
        }
        return { stdout: Buffer.alloc(0), stderr: '' };
      };
      return { fn, calls };
    }
    const offline = new ExecError('adb -s emulator-5554 get-state', 1, 'error: device offline\n');

    it('offline device: leads with adb get-state, keeps the dump text as evidence', async () => {
      const { fn, calls } = scripted(['Killed'], offline);
      await expect(new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).uiTree()).rejects.toThrow(
        /device emulator-5554 is not reachable: adb get-state says "device offline".*uiautomator dump returned no XML: Killed/s,
      );
      expect(calls.filter((c) => c.includes('uiautomator dump'))).toHaveLength(1); // no retry on Killed
      expect(calls.at(-1)).toBe('adb -s emulator-5554 get-state');
    });

    it('empty dump on an offline device is the same diagnosis', async () => {
      const { fn } = scripted([''], offline);
      await expect(new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).uiTree()).rejects.toThrow(
        /is not reachable: adb get-state says "device offline"/,
      );
    });

    it('null root node with settle: retries once, then succeeds silently', async () => {
      const { fn, calls } = scripted(
        ['ERROR: null root node returned by UiTestAutomationBridge.', UIAUTOMATOR_XML],
        'device',
      );
      const tree = await new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).uiTree({ settle: true });
      expect(tree.children).toHaveLength(3);
      expect(calls.filter((c) => c.includes('uiautomator dump'))).toHaveLength(2);
      expect(calls.some((c) => c.endsWith('get-state'))).toBe(false);
    }, 10_000);

    it('null root node twice on a reachable device with settle: classified as settling', async () => {
      const { fn, calls } = scripted(['ERROR: null root node returned by UiTestAutomationBridge.'], 'device');
      await expect(new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).uiTree({ settle: true })).rejects.toThrow(
        /device emulator-5554 is still settling.*retried once/s,
      );
      expect(calls.filter((c) => c.includes('uiautomator dump'))).toHaveLength(2);
    }, 10_000);

    it('null root node WITHOUT settle (a poller): one dump, no hidden retry, still classified', async () => {
      const { fn, calls } = scripted(['ERROR: null root node returned by UiTestAutomationBridge.'], 'device');
      await expect(new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).uiTree()).rejects.toThrow(
        /is still settling.*read once/s,
      );
      expect(calls.filter((c) => c.includes('uiautomator dump'))).toHaveLength(1);
    });

    it('a dump TIMEOUT on a reachable device is "reachable but SLOW", not a bare "Command timed out"', async () => {
      const calls: string[] = [];
      const fn: ExecFn = async (cmd, args) => {
        const full = [cmd, ...args].join(' ');
        calls.push(full);
        if (full.includes('uiautomator dump')) throw new ExecError(full, null, '', true);
        return { stdout: Buffer.from('device\n'), stderr: '' };
      };
      await expect(new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).uiTree()).rejects.toThrow(
        /device emulator-5554 is reachable but SLOW: uiautomator dump timed out after 15 s/,
      );
      expect(calls.at(-1)).toBe('adb -s emulator-5554 get-state');
    });

    it('adb itself failing on the dump (device not found, exit 255) is diagnosed as unreachable, with the cause kept', async () => {
      const fn: ExecFn = async (cmd, args) => {
        const full = [cmd, ...args].join(' ');
        throw new ExecError(full, full.includes('get-state') ? 1 : 255, "error: device 'emulator-5554' not found");
      };
      const err = await new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).uiTree().then(() => undefined, (e: Error) => e);
      expect(err?.message).toMatch(/device emulator-5554 is not reachable: adb get-state says "device 'emulator-5554' not found"/);
      expect(err?.message).toContain('adb could not run uiautomator dump');
      expect(err?.cause).toBeInstanceOf(ExecError);
    });

    it('several devices and no serial: prescribes select_device, not adb kill-server', async () => {
      const fn: ExecFn = async (cmd, args) => {
        const full = [cmd, ...args].join(' ');
        if (full.includes('uiautomator dump')) return { stdout: Buffer.from('Killed'), stderr: '' };
        throw new ExecError(full, 1, 'adb: more than one device/emulator');
      };
      await expect(new AndroidAdapter({ exec: fn }).uiTree()).rejects.toThrow(/select_device/);
    });

    it('Killed on a reachable device: the dump died on the guest, device still named', async () => {
      const { fn } = scripted(['Killed'], 'device');
      await expect(new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).uiTree()).rejects.toThrow(
        /returned no XML: Killed — adb get-state says "device", so the dump itself died on the guest/,
      );
    });
  });

  describe('isAppRunning distinguishes "no process" from "could not ask"', () => {
    // Fixtures are built the way exec.ts builds them (tests/helpers/exec-error.ts):
    // a real ExecError never has a blank stderr.
    const realShape = execErrorLikeExec;
    const throwing = (err: ExecError): ExecFn => async () => { throw err; };

    it('asks with `pidof <pkg> || true` and reads NOT running from an empty stdout, exit 0', async () => {
      const { fn, calls } = fakeExec({});
      expect(await new AndroidAdapter({ serial: 'e', exec: fn }).isAppRunning('md.bank.app')).toBe(false);
      expect(calls).toEqual(['adb -s e shell pidof md.bank.app || true']);
    });
    it('a pid on stdout is running', async () => {
      const { fn } = fakeExec({ 'adb -s e shell pidof': '22698\n' });
      expect(await new AndroidAdapter({ serial: 'e', exec: fn }).isAppRunning('md.bank.app')).toBe(true);
    });
    it('a non-zero exit shaped like exec.ts emits it propagates — it is the transport, not the app', async () => {
      const fn = throwing(realShape('adb -s e shell pidof x || true', 1, ''));
      await expect(new AndroidAdapter({ serial: 'e', exec: fn }).isAppRunning('x')).rejects.toThrow(/Command failed/);
    });
    it('a timeout propagates (device under load is not a dead app)', async () => {
      const fn = throwing(realShape('adb -s e shell pidof x || true', null, '', true));
      await expect(new AndroidAdapter({ serial: 'e', exec: fn }).isAppRunning('x')).rejects.toThrow(/timed out/);
    });
    it('an adb-level error propagates (offline device is not a dead app)', async () => {
      const fn = throwing(realShape('adb -s e shell pidof x || true', 1, 'error: device offline'));
      await expect(new AndroidAdapter({ serial: 'e', exec: fn }).isAppRunning('x')).rejects.toThrow(/device offline/);
    });
    it('rejects a package name that could escape the shell', async () => {
      const { fn, calls } = fakeExec({});
      await expect(new AndroidAdapter({ serial: 'e', exec: fn }).isAppRunning('x; rm -rf /')).rejects.toThrow(/invalid Android package name/);
      expect(calls).toEqual([]);
    });
  });

  it('tapElement resolves a selector and taps the rect center', async () => {
    const { fn, calls } = fakeExec({ 'adb -s emulator-5554 exec-out uiautomator': UIAUTOMATOR_XML });
    await tapElement(new AndroidAdapter({ serial: 'emulator-5554', exec: fn }), 'id:pin_key_2');
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

describe('typeText pacing (measured anti-flake behaviour)', () => {
  /**
   * The 250ms per character and the 150ms settle after the cursor nudge are
   * not arbitrary: bulk injection and unpaced per-char injection were both
   * measured dropping characters on Compose fields (2026-08-05, 3-of-11 and
   * 5-of-8 respectively). Setting either to 0 must fail, or the next person
   * "simplifying" the delays gets a green suite and a flaky login.
   */
  it('waits 250ms after each character and 150ms after the commit nudge', async () => {
    vi.useFakeTimers();
    try {
      const { fn, calls } = fakeExec({});
      const waits: number[] = [];
      const spy = vi.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void, ms?: number) => {
        waits.push(ms ?? 0);
        cb();
        return 0 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout);

      await new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).typeText('abc');
      spy.mockRestore();

      // Three characters paced at 250ms, then the DPAD nudge settle at 150ms.
      expect(waits).toEqual([250, 250, 250, 150]);
      // The nudge itself must still bracket that final wait.
      expect(calls.slice(-2)).toEqual([
        'adb -s emulator-5554 shell input keyevent 21',
        'adb -s emulator-5554 shell input keyevent 22',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
