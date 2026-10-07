import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { tapElement } from '../../src/interact/tap.js';
import { AndroidAdapter, parseImeInsets, parseInputShown, parseUiautomatorXml } from '../../src/adapters/android.js';
import { ExecError, type ExecFn, type ExecResult } from '../../src/adapters/exec.js';
import { execErrorLikeExec } from '../helpers/exec-error.js';
import { INPUT_SHOWN_LINE } from '../helpers/android-dumps.js';

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
    await tapElement(new AndroidAdapter({ serial: 'emulator-5554', exec: fn }), 'id:pin_key_2', { ambiguous: 'refuse' });
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

  // The iOS side of this (2026-10-07, docs/bugs/2026-10-07-ios-fill-empty-
  // value-fails-in-idb.md) returns before idb; Android's loop already ran zero
  // times for "" and passed, and still does — the commit nudge stays, as it
  // was, so an empty fill on Android is unchanged by the iOS fix.
  it('typeText with an empty string injects no character: the loop runs zero times, only the commit nudge is sent', async () => {
    const { fn, calls } = fakeExec({});
    await new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).typeText('');
    expect(calls).toEqual([
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

  // 2026-10-03: an intent without an activity is scoped to the package, and
  // an `am start` that says it started nothing is an error. argv, not the
  // joined string: `-p` and its value are two arguments to adb.
  describe('launch — an intent without an activity, and am start failures', () => {
    const SEND = { action: 'android.intent.action.SEND', mimeType: 'text/plain' };
    type Answer = { stdout?: string; stderr?: string } | Error;
    /** Records argv; `am start` (and, if given, `pm clear`) answers with the given streams, or throws the given error. */
    const amAnswers = (answer: Answer = {}, pmClear: Answer = {}) => {
      const argvs: string[][] = [];
      const fn: ExecFn = async (_cmd, args) => {
        argvs.push(args);
        const reply = args.includes('am') ? answer : args.includes('pm') ? pmClear : {};
        if (reply instanceof Error) throw reply;
        return { stdout: Buffer.from(reply.stdout ?? ''), stderr: reply.stderr ?? '' };
      };
      return { adapter: new AndroidAdapter({ serial: 'e', exec: fn }), argvs };
    };
    const UNRESOLVED =
      'Error: Activity not started, unable to resolve Intent { act=android.intent.action.SEND typ=text/plain flg=0x10000000 pkg=md.bank.app }';

    it('an intent and no activity → am start -p <package>: the intent stays inside the app', async () => {
      const { adapter, argvs } = amAnswers();
      await adapter.launch('md.bank.app', { intent: { ...SEND, data: 'bank://pay', categories: ['c.D'], extras: { k: 'v' } } });
      expect(argvs).toEqual([
        ['-s', 'e', 'shell', 'am', 'start', '-p', 'md.bank.app', '-a', 'android.intent.action.SEND',
          '-d', 'bank://pay', '-t', 'text/plain', '-c', 'c.D', '--es', 'k', 'v'],
      ]);
    });

    it('an intent WITH an activity → -n names the component, and there is no -p beside it', async () => {
      const { adapter, argvs } = amAnswers();
      await adapter.launch('md.bank.app', { activity: '.ShareActivity', intent: SEND });
      expect(argvs).toEqual([
        ['-s', 'e', 'shell', 'am', 'start', '-n', 'md.bank.app/.ShareActivity', '-a', 'android.intent.action.SEND', '-t', 'text/plain'],
      ]);
    });

    it('an activity alone → -n only; neither → the monkey launcher pick, no am start', async () => {
      const { adapter, argvs } = amAnswers();
      await adapter.launch('md.bank.app', { activity: '.MainActivity' });
      await adapter.launch('md.bank.app');
      expect(argvs).toEqual([
        ['-s', 'e', 'shell', 'am', 'start', '-n', 'md.bank.app/.MainActivity'],
        ['-s', 'e', 'shell', 'monkey', '-p', 'md.bank.app', '-c', 'android.intent.category.LAUNCHER', '1'],
      ]);
    });

    const noActivityStarted = (said: string) =>
      'Android started no activity in md.bank.app for this intent (action android.intent.action.SEND, mime type text/plain) — ' +
      "an intent without an activity is delivered within the app's package. Either no exported activity there " +
      'declares a matching <intent-filter> (with category DEFAULT), or the one that does refused the launch ' +
      "(not exported / permission — am's message below says which). Fix the action/mime type or the manifest, " +
      `or name the activity explicitly: \`activity:\` on the launch step / launch_app. am start said: ${said}`;
    const messageOf = (launching: Promise<void>) => launching.then(() => 'resolved', (e: Error) => e.message);

    it.each([
      ['on stderr', { stdout: 'Starting: Intent { act=android.intent.action.SEND }\n', stderr: `${UNRESOLVED}\n` }],
      ['folded into stdout', { stdout: `Starting: Intent { act=android.intent.action.SEND }\n${UNRESOLVED}\n` }],
      ['with a non-zero exit', execErrorLikeExec('adb -s e shell am start', 1, `${UNRESOLVED}\n`)],
    ])('"unable to resolve Intent" %s → throws: nothing started in the package, and how to recover', async (_where, answer) => {
      const { adapter } = amAnswers(answer);
      expect(await messageOf(adapter.launch('md.bank.app', { intent: SEND }))).toBe(noActivityStarted(UNRESOLVED));
    });

    // The activity EXISTS here and refused: the message must not say none
    // handles the intent. am prints no `Error` line for it, only the exception.
    it('a refused launch (SecurityException, exit 255) → throws the same message, quoting the exception line', async () => {
      const DENIAL =
        'java.lang.SecurityException: Permission Denial: starting Intent { act=android.intent.action.SEND typ=text/plain pkg=md.bank.app ' +
        'cmp=md.bank.app/.ShareActivity } from null (pid=4242, uid=2000) not exported from uid 10190';
      const { adapter } = amAnswers(
        execErrorLikeExec(
          'adb -s e shell am start',
          255,
          `\nException occurred while executing 'start':\n${DENIAL}\n\tat com.android.server.wm.ActivityStarter.execute(ActivityStarter.java:1)\n`,
        ),
      );
      expect(await messageOf(adapter.launch('md.bank.app', { intent: SEND }))).toBe(noActivityStarted(DENIAL));
    });

    it('an explicit activity that does not exist → throws, naming the component and both of am\'s lines', async () => {
      const { adapter } = amAnswers({
        stdout: 'Starting: Intent { cmp=md.bank.app/.Missing }\n',
        stderr: 'Error type 3\nError: Activity class {md.bank.app/md.bank.app.Missing} does not exist.\n',
      });
      expect(await messageOf(adapter.launch('md.bank.app', { activity: '.Missing' }))).toBe(
        "Could not start md.bank.app/.Missing — check the activity name (the launch's `activity`, or " +
          'app.android.activity in averi.yaml), that the activity is exported, and that md.bank.app is installed. ' +
          'am start said: Error type 3 / Error: Activity class {md.bank.app/md.bank.app.Missing} does not exist.',
      );
    });

    it("a full other.pkg/Activity component → the message names THAT package as the one to install", async () => {
      const { adapter } = amAnswers({ stderr: 'Error type 3\n' });
      expect(await messageOf(adapter.launch('md.bank.app', { activity: 'com.other/.Entry' }))).toBe(
        "Could not start com.other/.Entry — check the activity name (the launch's `activity`, or " +
          'app.android.activity in averi.yaml), that the activity is exported, and that com.other is installed. ' +
          'am start said: Error type 3',
      );
    });

    // What a SUCCESSFUL am start may print. Every row is a launch that
    // happened; failing one would break the hottest path in the tool.
    it.each([
      ['"Error" mid-line in the echoed intent data', 'Starting: Intent { act=android.intent.action.VIEW dat=app://x/Error/y pkg=md.bank.app }\n'],
      ['a component named .ErrorActivity', 'Starting: Intent { cmp=md.bank.app/.ErrorActivity }\n'],
      ['"Errors: none"', 'Starting: Intent { pkg=md.bank.app }\nErrors: none\n'],
      ['a lowercase "error:" line that is not am\'s', 'Starting: Intent { pkg=md.bank.app }\nerror: could not set locale, continuing\n'],
      ['a java.lang class mid-line', 'Starting: Intent { dat=app://x/java.lang.IllegalStateException pkg=md.bank.app }\n'],
      // The narrowing, as a decision (2026-10-03): am's diagnoses start in
      // column 0, and an "Exception in thread" line at exit 0 is left alone —
      // see AM_ERROR_LINE_RE for why that is acceptable.
      ['an indented "Error:" line', 'Starting: Intent { pkg=md.bank.app }\n  Error: something\n'],
      ['an "Exception in thread" line at exit 0', 'Exception in thread "main" java.lang.IllegalArgumentException: Unknown option: --bogus\n'],
    ])('a launch that printed %s resolves, on either stream', async (_what, printed) => {
      await expect(amAnswers({ stdout: printed }).adapter.launch('md.bank.app', { intent: SEND })).resolves.toBeUndefined();
      await expect(amAnswers({ stderr: printed }).adapter.launch('md.bank.app', { intent: SEND })).resolves.toBeUndefined();
    });

    it('a timed-out am start passes through as the timeout, whatever it had printed', async () => {
      const timedOut = execErrorLikeExec('adb -s e shell am start', null, `${UNRESOLVED}\n`, true);
      await expect(amAnswers(timedOut).adapter.launch('md.bank.app', { intent: SEND })).rejects.toBe(timedOut);
    });

    it.each([
      ['a non-zero exit', execErrorLikeExec('adb -s e shell pm clear md.bank.app', 1, 'Error: java.lang.SecurityException: PID 4242 does not have permission\n')],
    ])('pm clear is not am start: %s with an Error line is passed through, and nothing is launched', async (_how, failure) => {
      const { adapter, argvs } = amAnswers({}, failure);
      await expect(adapter.launch('md.bank.app', { clearState: true, intent: SEND })).rejects.toBe(failure);
      expect(argvs).toEqual([['-s', 'e', 'shell', 'pm', 'clear', 'md.bank.app']]);
    });

    it('pm clear printing an Error line with exit 0 does not fail the launch here (its output is not am\'s)', async () => {
      const { adapter, argvs } = amAnswers({}, { stdout: 'Error: something pm said\n' });
      await expect(adapter.launch('md.bank.app', { clearState: true, intent: SEND })).resolves.toBeUndefined();
      expect(argvs).toHaveLength(2);
    });

    it('a Warning is not a failure: a warm launch that only fronts the task resolves', async () => {
      const { adapter } = amAnswers({
        stdout: 'Starting: Intent { cmp=md.bank.app/.MainActivity }\n',
        stderr: 'Warning: Activity not started, its current task has been brought to the front\n',
      });
      await expect(adapter.launch('md.bank.app', { activity: '.MainActivity' })).resolves.toBeUndefined();
    });

    it('an adb failure that is not am\'s diagnosis passes through as it is', async () => {
      const offline = execErrorLikeExec('adb -s e shell am start', 255, "adb: device 'e' not found\n");
      const { adapter } = amAnswers(offline);
      await expect(adapter.launch('md.bank.app', { intent: SEND })).rejects.toBe(offline);
    });
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

  // adapters/types.ts promises the memo covers failure too: the layers above
  // read viewport() per captured frame and per absent check, and a device
  // that will not answer must not be re-asked on every one of them.
  it('viewport memoizes a FAILED read as well — one shell-out, however many callers', async () => {
    const { fn, calls } = fakeExec({ 'adb -s emulator-5554 shell wm size': 'error: device offline\n' });
    const adapter = new AndroidAdapter({ serial: 'emulator-5554', exec: fn });
    await expect(adapter.viewport()).rejects.toThrow(/Cannot parse wm size output/);
    await expect(adapter.viewport()).rejects.toThrow(/Cannot parse wm size output/);
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

/**
 * `adb shell dumpsys window displays`, captured whole on 2026-10-03 (the app
 * package renamed to com.example.app, nothing else touched):
 * - api33-keyboard-shown: emulator-5554 (Pixel_3a, API 33, 1080x2220), the
 *   Settings search field focused, GBoard up;
 * - api33-keyboard-hidden: the same device with no keyboard up;
 * - api36-no-ime-source: a freshly booted Pixel_4 AVD (API 36, 1080x2280) on
 *   its lock screen — it has not shown a keyboard since boot, and its insets
 *   list has NO ime entry.
 * A keyboard SHOWN on API 34+ was not captured (that AVD is PIN-locked): the
 * `type=ime` line below is built from AOSP's InsetsSource.dump on the layout
 * the API 36 fixture verifies for the other types — from documentation,
 * unverified on a device.
 */
const dumpsys = (name: string) => readFile(new URL(`../fixtures/dumpsys-window-displays-${name}.txt`, import.meta.url), 'utf8');

describe('AndroidAdapter.keyboard.state — is a soft keyboard shown, and which rect does it cover', () => {
  const STATUS_BAR_33 = '        InsetsSource type=ITYPE_STATUS_BAR frame=[0,0][1080,66] visible=true insetsRoundedCornerFrame=false';
  const STATUS_BAR_36 = '        InsetsSource id=ab460000 type=statusBars frame=[0,0][1080,66] visible=true flags= sideHint=TOP boundingRects=null';
  const IME_SHOWN_33 = '        InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220] visibleFrame=[0,1398][1080,2220] visible=true insetsRoundedCornerFrame=false';
  const IME_HIDDEN_33 = '        InsetsSource type=ITYPE_IME frame=[0,0][0,0] visibleFrame=[0,2088][1080,2220] visible=false insetsRoundedCornerFrame=false';
  /** DisplayPolicy's lines, as the real dumps print them. */
  const SHOWING = '    mIsImeShowing=true\n    mImeHeight=756\n';
  const HIDING = '    mIsImeShowing=false\n    mImeHeight=0\n';
  const lines = (...l: string[]) => `    mInsetsState:\n${l.join('\n')}\n    InsetsSourceProviders:\n`;

  it('API 33, keyboard shown (real dump): the IME frame, as a rect in screen pixels', async () => {
    expect(parseImeInsets(await dumpsys('api33-keyboard-shown'))).toEqual({
      state: 'shown',
      frame: { x: 0, y: 1398, width: 1080, height: 822 }, // frame=[0,1398][1080,2220]
    });
  });

  it('API 33, keyboard hidden (real dump): hidden — visible=false decides, though visibleFrame still holds the nav-bar strip', async () => {
    const dump = await dumpsys('api33-keyboard-hidden');
    expect(dump).toContain('InsetsSource type=ITYPE_IME frame=[0,0][0,0] visibleFrame=[0,2088][1080,2220] visible=false');
    expect(parseImeInsets(dump)).toEqual({ state: 'hidden' });
  });

  it('API 33, ~0.4 s after back (real line): visible=false with the full frame still set is HIDDEN, not shown', () => {
    const animatingOut = '        InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220] visibleFrame=[0,1398][1080,2220] visible=false insetsRoundedCornerFrame=false';
    expect(parseImeInsets(lines(STATUS_BAR_33, animatingOut))).toEqual({ state: 'hidden' });
  });

  it('the measured finportal login line (API 33): frame [0,1285][1080,2220]', () => {
    const line = '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] visibleFrame=[0,1285][1080,2220] visible=true insetsRoundedCornerFrame=false';
    expect(parseImeInsets(lines(STATUS_BAR_33, line))).toEqual({ state: 'shown', frame: { x: 0, y: 1285, width: 1080, height: 935 } });
  });

  it('API 36, no keyboard since boot (real dump): the list reads and has no ime entry — hidden', async () => {
    const dump = await dumpsys('api36-no-ime-source');
    expect(dump).toContain('InsetsSource id=ab460000 type=statusBars frame=[0,0][1080,66] visible=true');
    expect(dump).not.toMatch(/type=ime\b/);
    expect(parseImeInsets(dump)).toEqual({ state: 'hidden' });
  });

  it('API 34+ format, shown and hidden (FROM DOCUMENTATION, unverified on a device): `id=… type=ime`, no visibleFrame', () => {
    const ime = (frame: string, visible: boolean) =>
      `        InsetsSource id=3 type=ime frame=${frame} visible=${visible} flags= sideHint=BOTTOM boundingRects=null`;
    expect(parseImeInsets(lines(STATUS_BAR_36, ime('[0,1344][1080,2280]', true)))).toEqual({
      state: 'shown',
      frame: { x: 0, y: 1344, width: 1080, height: 936 },
    });
    expect(parseImeInsets(lines(STATUS_BAR_36, ime('[0,0][0,0]', false)))).toEqual({ state: 'hidden' });
  });

  // FAIL OPEN: everything below is `unknown` — the callers then behave as
  // they did before the question existed. None of it may read as shown (a
  // guessed frame) or as hidden (dismissKeyboard would stop pressing back).
  it.each([
    ['an empty dump', ''],
    ['a dump with no InsetsSource list at all', 'WINDOW MANAGER DISPLAY CONTENTS (dumpsys window displays)\n  Display: mDisplayId=0\n'],
    ['only the provider/control lines, not the state list', '        mSource=InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] visibleFrame=[0,1285][1080,2220] visible=true\n        mControl=InsetsSourceControl type=ITYPE_IME mLeash=x\n'],
    ['a list in a format that does not read (no frame=, no visible=)', '        InsetsSource type=ITYPE_STATUS_BAR bounds=Rect(0, 0 - 1080, 66) shown\n        InsetsSource type=ITYPE_IME bounds=Rect(0, 1285 - 1080, 2220) shown\n'],
    ['an IME entry whose frame does not read', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=Rect(0, 1285 - 1080, 2220) visible=true')],
    ['an IME entry with no visible=', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220]')],
    ['an IME entry whose visible is neither true nor false', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] visible=maybe')],
    ['an IME entry with only visibleFrame= (it is not the frame)', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME visibleFrame=[0,1285][1080,2220] visible=true')],
    ['a visible IME with an EMPTY frame (it says shown but not where)', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=[0,0][0,0] visible=true')],
    ['two visible IME entries with different frames (two displays)', lines(
      '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] visible=true',
      '        InsetsSource type=ITYPE_IME frame=[0,600][1920,1080] visible=true',
    )],
  ])('unrecognised → unknown: %s', (_name, dump) => {
    expect(parseImeInsets(dump)).toEqual({ state: 'unknown' });
  });

  it('a type that merely CONTAINS "ime" is not the IME: with mIsImeShowing=false the list simply has no ime entry (hidden)', () => {
    const lookalike = '        InsetsSource id=7 type=imeCaptionBar frame=[0,1285][1080,2220] visible=true flags=';
    expect(parseImeInsets(HIDING + lines(STATUS_BAR_36, lookalike))).toEqual({ state: 'hidden' });
  });

  // The second witness (review 2026-10-03): DisplayPolicy's mIsImeShowing
  // line, present in all three real dumps. A false `shown` presses back on a
  // screen with no keyboard; a silent `hidden` switches the guard off. Both
  // become `unknown` wherever the two witnesses disagree or one is missing
  // where it is needed.
  it('the real dumps carry the witness that agrees with them: true beside shown, false beside hidden and beside no-entry', async () => {
    expect(await dumpsys('api33-keyboard-shown')).toMatch(/^ {4}mIsImeShowing=true$/m);
    expect(await dumpsys('api33-keyboard-hidden')).toMatch(/^ {4}mIsImeShowing=false$/m);
    expect(await dumpsys('api36-no-ime-source')).toMatch(/^ {4}mIsImeShowing=false$/m);
  });

  it.each([
    ['two displays, d0 hidden and d1 shown (never display 1\'s frame)', lines(STATUS_BAR_33, IME_HIDDEN_33) + lines(STATUS_BAR_33, IME_SHOWN_33)],
    ['two displays whose witnesses disagree', HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33) + SHOWING + lines(STATUS_BAR_33, IME_HIDDEN_33)],
    ['no IME entry and no mIsImeShowing line (a renamed type, an older dump)', lines(STATUS_BAR_36)],
    ['no IME entry with mIsImeShowing=true (a renamed type while a keyboard is up)', SHOWING + lines(STATUS_BAR_36)],
    ['visible=true contradicted by mIsImeShowing=false', HIDING + lines(STATUS_BAR_33, IME_SHOWN_33)],
    ['visible=false contradicted by mIsImeShowing=true', SHOWING + lines(STATUS_BAR_33, IME_HIDDEN_33)],
    ['mIsImeShowing=false but NO InsetsSource list reads (the witness alone is not a recognised format)', HIDING + '  Display: mDisplayId=0\n'],
    ['mIsImeShowing=false beside an IME entry that does not read (it is not "no entry")', HIDING + lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=Rect(0, 1285 - 1080, 2220) visible=true')],
    ['a `visible=` that belongs to a later, longer token (requestedvisible=true)', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] requestedvisible=true')],
    ['a `visible=` value that only starts with true (visible=trueish)', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] visible=trueish')],
    ['a `type=` that belongs to a longer token (subtype=ITYPE_IME on another source is not an IME entry; no witness)', lines('        InsetsSource subtype=ITYPE_IME type=ITYPE_STATUS_BAR frame=[0,0][1080,66] visible=true')],
  ])('the witnesses disagree or are missing → unknown: %s', (_name, dump) => {
    expect(parseImeInsets(dump)).toEqual({ state: 'unknown' });
  });

  it('a REAL dump truncated before the IME line (the witness is cut off with it, or says true) is unknown, never hidden', async () => {
    const shown = await dumpsys('api33-keyboard-shown');
    const cut = shown.slice(0, shown.indexOf('        InsetsSource type=ITYPE_IME'));
    expect(cut).toContain('InsetsSource type=ITYPE_STATUS_BAR'); // the list was being printed
    expect(parseImeInsets(cut)).toEqual({ state: 'unknown' }); // mIsImeShowing=true, no entry
    expect(parseImeInsets(cut.replace(/^ *mIsImeShowing=.*\n/m, ''))).toEqual({ state: 'unknown' }); // no witness at all
  });

  it('when both witnesses are there and agree, or the entry speaks alone (mIsImeShowing absent — API 30–32, unverified), the entry decides', () => {
    const frame = { x: 0, y: 1398, width: 1080, height: 822 };
    expect(parseImeInsets(SHOWING + lines(STATUS_BAR_33, IME_SHOWN_33))).toEqual({ state: 'shown', frame });
    expect(parseImeInsets(lines(STATUS_BAR_33, IME_SHOWN_33))).toEqual({ state: 'shown', frame });
    expect(parseImeInsets(HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
    expect(parseImeInsets(lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
    // `mIsImeShowing=true` MID-LINE, after other text, is not the DisplayPolicy field: it must be ignored,
    // so it neither contradicts a hidden entry nor disagrees with the real witness line.
    expect(parseImeInsets('    mLastState={foo=1 mIsImeShowing=true}\n' + lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
    expect(parseImeInsets('    mLastState={foo=1 mIsImeShowing=true}\n' + HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
    // Each anchor on its own: text BEFORE the token (nothing after), and text AFTER the value (nothing before).
    expect(parseImeInsets('    mLastState: foo=1 mIsImeShowing=true\n' + HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
    expect(parseImeInsets('    mIsImeShowing=true mImeHeight=756\n' + HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
    // Two displays that agree are not a contradiction.
    expect(parseImeInsets(HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33) + HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
  });

  it('is exactly one adb call — `shell dumpsys window displays`, with a 2 s budget — and is asked afresh every time', async () => {
    const calls: { full: string; timeoutMs?: number }[] = [];
    const dump = await dumpsys('api33-keyboard-shown');
    const fn: ExecFn = async (cmd, args, opts) => {
      calls.push({ full: [cmd, ...args].join(' '), timeoutMs: opts?.timeoutMs });
      return { stdout: Buffer.from(dump), stderr: '' };
    };
    const adapter = new AndroidAdapter({ serial: 'emulator-5554', exec: fn });
    expect((await adapter.keyboard.state()).state).toBe('shown');
    expect(calls).toEqual([{ full: 'adb -s emulator-5554 shell dumpsys window displays', timeoutMs: 2_000 }]);
    await adapter.keyboard.state();
    expect(calls).toHaveLength(2); // not memoized: the answer changes with every focus
  });

  it.each([
    ['adb exits non-zero', execErrorLikeExec('adb shell dumpsys window displays', 1, "error: device 'emulator-5554' not found")],
    ['the call times out', execErrorLikeExec('adb shell dumpsys window displays', null, '', true)],
    ['adb cannot be spawned', new Error('spawn adb ENOENT')],
  ])('a failing call does not throw into the tap — %s → unknown', async (_name, failure) => {
    const fn: ExecFn = async () => {
      throw failure;
    };
    await expect(new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).keyboard.state()).resolves.toEqual({ state: 'unknown' });
  });

  // The guard driven end to end through this adapter — the adb call order of
  // a dismissal and of the stale-window wait — is tests/integration/android-keyboard.test.ts
  // (moved 2026-10-04: it pinned interact/'s cadence from the adapter's test file).
});

describe('AndroidAdapter.keyboard.witness — the input method\'s own word, asked before a keyboard back', () => {
  it('reads mInputShown=true as shown and mInputShown=false as hidden (the real line)', () => {
    expect(parseInputShown(INPUT_SHOWN_LINE(true))).toBe('shown');
    expect(parseInputShown(INPUT_SHOWN_LINE(false))).toBe('hidden');
    expect(parseInputShown('mInputShown=true')).toBe('shown'); // the word alone, no newline
    expect(parseInputShown('  mInputShown=false mOther=1\n')).toBe('hidden'); // not necessarily last on the line
  });

  it.each([
    ['empty output', ''],
    ['no such word', '  mShowRequested=false mShowForced=false\n'],
    ['a value that only STARTS with true (mInputShown=trueish; "truthy" too)', '  mShowForced=false mInputShown=trueish\n  mInputShown=truthy\n'],
    ['a value that only starts with false (mInputShown=falsey)', '  mShowForced=false mInputShown=falsey\n'],
    ['a value that is neither (mInputShown=1)', '  mInputShown=1\n'],
    ['a value in another case (mInputShown=TRUE)', '  mInputShown=TRUE\n'],
    ['a value in another case (mInputShown=False)', '  mInputShown=False\n'],
    ['the name in another case (minputshown=true)', '  minputshown=true\n'],
    ['the name as the TAIL of a longer one (mPrevmInputShown=true)', '  mShowForced=false mPrevmInputShown=true\n'],
    ['the name glued to other text mid-word (xmInputShown=false)', '  foo=xmInputShown=false\n'],
    ['two words that disagree', '  mInputShown=true\n  mInputShown=false\n'],
  ])('cannot tell → unknown: %s', (_name, out) => {
    expect(parseInputShown(out)).toBe('unknown');
  });

  it('two words that agree are one answer', () => {
    expect(parseInputShown('  mInputShown=false\n  mInputShown=false\n')).toBe('hidden');
  });

  it('is exactly one adb call, filtered on the device, with its own 2 s budget', async () => {
    const calls: { cmd: string; args: string[]; timeoutMs?: number }[] = [];
    const fn: ExecFn = async (cmd, args, opts) => {
      calls.push({ cmd, args, timeoutMs: opts?.timeoutMs });
      return { stdout: Buffer.from(INPUT_SHOWN_LINE(true)), stderr: '' };
    };
    await expect(new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).keyboard.witness()).resolves.toBe('shown');
    expect(calls).toEqual([
      // ONE argument after `shell`: the device's sh runs the pipe; -w matches the name as a whole word.
      { cmd: 'adb', args: ['-s', 'emulator-5554', 'shell', 'dumpsys input_method | grep -m1 -w mInputShown'], timeoutMs: 2_000 },
    ]);
  });

  it('is NOT memoized: two calls are two queries, and the second answer is the device\'s new one', async () => {
    const outputs = [INPUT_SHOWN_LINE(false), INPUT_SHOWN_LINE(true)];
    let n = 0;
    const fn: ExecFn = async () => ({ stdout: Buffer.from(outputs[n++]), stderr: '' });
    const adapter = new AndroidAdapter({ serial: 'emulator-5554', exec: fn });
    expect([await adapter.keyboard.witness(), await adapter.keyboard.witness()]).toEqual(['hidden', 'shown']);
    expect(n).toBe(2);
  });

  it.each([
    ['grep finds no line (exit 1 — an Android that does not print mInputShown)', execErrorLikeExec('adb shell dumpsys input_method | grep -m1 mInputShown', 1, '')],
    ['adb exits non-zero', execErrorLikeExec('adb shell …', 1, "error: device 'emulator-5554' not found")],
    ['the call times out', execErrorLikeExec('adb shell …', null, '', true)],
    ['adb cannot be spawned', new Error('spawn adb ENOENT')],
  ])('a failing call does not throw — %s → unknown', async (_name, failure) => {
    const fn: ExecFn = async () => {
      throw failure;
    };
    await expect(new AndroidAdapter({ serial: 'emulator-5554', exec: fn }).keyboard.witness()).resolves.toBe('unknown');
  });
});
