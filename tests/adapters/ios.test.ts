import { describe, expect, it } from 'vitest';
import { IosAdapter, parseIdbDescribeAll } from '../../src/adapters/ios.js';
import type { ExecFn, ExecResult } from '../../src/adapters/exec.js';

function fakeExec(responses: Record<string, string | Buffer>) {
  const calls: { full: string; stdin?: string }[] = [];
  const fn: ExecFn = async (cmd, args, opts): Promise<ExecResult> => {
    const full = [cmd, ...args].join(' ');
    calls.push({ full, stdin: opts?.stdin });
    for (const [prefix, out] of Object.entries(responses)) {
      if (full.startsWith(prefix)) {
        return { stdout: Buffer.isBuffer(out) ? out : Buffer.from(out), stderr: '' };
      }
    }
    return { stdout: Buffer.alloc(0), stderr: '' };
  };
  return { fn, calls };
}

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

const IDB_DESCRIBE_ALL = JSON.stringify([
  {
    type: 'Button', AXLabel: 'Log in', AXUniqueId: 'login_button', AXValue: '',
    frame: { x: 20.5, y: 700, width: 350, height: 48 },
  },
  {
    type: 'TextField', AXLabel: 'Username', AXUniqueId: 'username_field', AXValue: 'alice',
    frame: { x: 20, y: 400, width: 350, height: 44 },
  },
  { type: 'StaticText', AXLabel: 'Welcome back', AXUniqueId: null, AXValue: null },
]);

describe('IosAdapter.listDevices', () => {
  it('parses simctl JSON, derives OS version, filters unavailable devices', async () => {
    const { fn } = fakeExec({ 'xcrun simctl list devices --json': SIMCTL_LIST });
    const devices = await new IosAdapter({ exec: fn }).listDevices();
    expect(devices).toEqual([
      { id: 'AAAA-1111', platform: 'ios', name: 'iPhone 15', osVersion: '17.5', state: 'booted' },
      { id: 'BBBB-2222', platform: 'ios', name: 'iPhone 15 Pro', osVersion: '17.5', state: 'offline' },
      { id: 'DDDD-4444', platform: 'ios', name: 'iPhone 14', osVersion: '16.4', state: 'offline' },
    ]);
  });
});

describe('parseIdbDescribeAll', () => {
  const tree = parseIdbDescribeAll(IDB_DESCRIBE_ALL);

  it('wraps the flat element list under a synthetic root', () => {
    expect(tree.role).toBe('container');
    expect(tree.children).toHaveLength(3);
  });

  it('normalizes roles, identifiers, values and rounds frames', () => {
    expect(tree.children[0]).toMatchObject({
      role: 'button', label: 'Log in', identifier: 'login_button', value: null,
      rect: { x: 21, y: 700, width: 350, height: 48 },
    });
    expect(tree.children[1]).toMatchObject({ role: 'textfield', value: 'alice' });
    expect(tree.children[2]).toMatchObject({
      role: 'text', identifier: null, rect: { x: 0, y: 0, width: 0, height: 0 },
    });
  });

  it('pairs a same-identifier text BELOW a textfield as its error; the title above is not an error', () => {
    // Measured convention (payment form, 2026-08-05): the field's title AND
    // its validation message share the field's accessibilityIdentifier.
    const withError = parseIdbDescribeAll(
      JSON.stringify([
        {
          type: 'StaticText', AXLabel: 'Amount', AXUniqueId: 'payment.form.amount_input', AXValue: null,
          frame: { x: 20, y: 380, width: 100, height: 18 },
        },
        {
          type: 'TextField', AXLabel: 'Amount', AXUniqueId: 'payment.form.amount_input', AXValue: '',
          frame: { x: 20, y: 400, width: 350, height: 44 },
        },
        {
          type: 'StaticText', AXLabel: 'Value is too small', AXUniqueId: 'payment.form.amount_input', AXValue: null,
          frame: { x: 20, y: 448, width: 200, height: 16 },
        },
        {
          type: 'TextField', AXLabel: 'Note', AXUniqueId: 'note_input', AXValue: null,
          frame: { x: 20, y: 500, width: 350, height: 44 },
        },
      ]),
    );
    const amount = withError.children.find((n) => n.role === 'textfield' && n.identifier === 'payment.form.amount_input');
    expect(amount?.error).toBe('Value is too small');
    const note = withError.children.find((n) => n.identifier === 'note_input');
    expect(note?.error).toBeUndefined();
  });

  it('leaves error unset when no same-identifier text sits below the field', () => {
    expect(tree.children[1].error).toBeUndefined();
  });
});

describe('IosAdapter interactions', () => {
  it('tapElement resolves against the idb tree and taps the center', async () => {
    const { fn, calls } = fakeExec({ 'idb ui describe-all': IDB_DESCRIBE_ALL });
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn }).tapElement('id:login_button');
    expect(calls.at(-1)?.full).toBe('idb ui tap 196 724 --udid AAAA-1111');
  });

  it('targets "booted" when no udid is given', async () => {
    const { fn, calls } = fakeExec({});
    await new IosAdapter({ exec: fn }).openDeepLink('myapp://home');
    expect(calls.at(-1)?.full).toBe('xcrun simctl openurl booted myapp://home');
  });

  it('probes for simctl once, not per call', async () => {
    const { fn, calls } = fakeExec({});
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn });
    await adapter.openDeepLink('a://b');
    await adapter.openDeepLink('c://d');
    expect(calls.filter((c) => c.full === 'xcrun --find simctl')).toHaveLength(1);
  });

  it('setClipboard pipes text to simctl pbcopy via stdin', async () => {
    const { fn, calls } = fakeExec({});
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn }).setClipboard('secret');
    expect(calls.at(-1)).toMatchObject({ full: 'xcrun simctl pbcopy AAAA-1111', stdin: 'secret' });
  });

  it('viewport reads point dimensions from idb describe and caches', async () => {
    const { fn, calls } = fakeExec({
      'idb describe --json': JSON.stringify({
        screen_dimensions: { width: 1206, height: 2622, density: 3, width_points: 402, height_points: 874 },
      }),
    });
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn });
    expect(await adapter.viewport()).toEqual({ width: 402, height: 874 });
    expect(await adapter.viewport()).toEqual({ width: 402, height: 874 });
    expect(calls.filter((c) => c.full.startsWith('idb describe'))).toHaveLength(1);
  });

  it('clearText sends backspaces then forward-deletes (position-independent)', async () => {
    const { fn, calls } = fakeExec({});
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn }).clearText(3);
    expect(calls.at(-2)?.full).toBe('idb ui key-sequence 42 42 42 --udid AAAA-1111');
    expect(calls.at(-1)?.full).toBe('idb ui key-sequence 76 76 76 --udid AAAA-1111');
  });

  it('pressKey back is rejected with guidance, home uses the HOME button', async () => {
    const { fn, calls } = fakeExec({});
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn });
    await expect(adapter.pressKey('back')).rejects.toThrow(/no iOS equivalent/);
    await adapter.pressKey('home');
    expect(calls.at(-1)?.full).toBe('idb ui button HOME --udid AAAA-1111');
  });
});
