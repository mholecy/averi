import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tapElement } from '../../src/interact/tap.js';
import { IosAdapter } from '../../src/adapters/ios.js';
import { IdbTreeSource, type IosTreeSource } from '../../src/adapters/ios-tree-source.js';
import type { ExecFn, ExecResult } from '../../src/adapters/exec.js';
import type { DeviceAdapter, UiNode } from '../../src/adapters/types.js';

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

describe('IosAdapter interactions', () => {
  it('end to end on the idb source: tapElement resolves against describe-all and taps the center through idb', async () => {
    const { fn, calls } = fakeExec({ 'idb ui describe-all': IDB_DESCRIBE_ALL });
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: new IdbTreeSource({ udid: 'AAAA-1111', exec: fn }) });
    await tapElement(adapter, 'id:login_button', { ambiguous: 'refuse' });
    expect(calls.at(-1)?.full).toBe('idb ui tap 196 724 --udid AAAA-1111');
  });

  it('rejects activity/intent launches with Android-only guidance', async () => {
    const { fn } = fakeExec({});
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn });
    await expect(adapter.launch('com.app', { activity: '.Main' })).rejects.toThrow(/Android-only/);
    await expect(adapter.launch('com.app', { intent: { action: 'SEND' } })).rejects.toThrow(/Android-only/);
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

  // adapters/types.ts promises the memo covers failure too: the layers above
  // read viewport() per captured frame and per absent check, and a device
  // that will not answer must not be re-asked on every one of them.
  it('viewport memoizes a FAILED read as well — one idb call, however many callers', async () => {
    const { fn, calls } = fakeExec({ 'idb describe --json': JSON.stringify({}) });
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn });
    await expect(adapter.viewport()).rejects.toThrow(/no screen_dimensions/);
    await expect(adapter.viewport()).rejects.toThrow(/no screen_dimensions/);
    expect(calls.filter((c) => c.full.startsWith('idb describe'))).toHaveLength(1);
  });

  it('clearText sends backspaces then forward-deletes (position-independent)', async () => {
    const { fn, calls } = fakeExec({});
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn }).clearText(3);
    expect(calls.at(-2)?.full).toBe('idb ui key-sequence 42 42 42 --udid AAAA-1111');
    expect(calls.at(-1)?.full).toBe('idb ui key-sequence 76 76 76 --udid AAAA-1111');
  });

  it('typeText hands the text to idb ui text', async () => {
    const { fn, calls } = fakeExec({});
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn }).typeText('alice');
    expect(calls.at(-1)?.full).toBe('idb ui text alice --udid AAAA-1111');
  });

  // docs/bugs/2026-10-07-ios-fill-empty-value-fails-in-idb.md: `idb ui text ''`
  // is refused ("Request was not sent"), so a `fill` with value "" — a clear
  // alone, or a focus without typing — threw after the focus tap and after the
  // clear. The contract (DeviceAdapter.typeText) is that "" types nothing.
  it('typeText with an empty string calls idb not at all — the contract Android meets with a zero-iteration loop', async () => {
    const { fn, calls } = fakeExec({});
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn }).typeText('');
    expect(calls).toEqual([]);
  });

  it('pressKey back is rejected with guidance, home uses the HOME button', async () => {
    const { fn, calls } = fakeExec({});
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn });
    await expect(adapter.pressKey('back')).rejects.toThrow(/no iOS equivalent/);
    await adapter.pressKey('home');
    expect(calls.at(-1)?.full).toBe('idb ui button HOME --udid AAAA-1111');
  });

  it('has no keyboard oracle: on iOS the keyboard is part of the tree, so a tap pays nothing for the question and interact/ presses no key here', () => {
    const { fn } = fakeExec({});
    const adapter: DeviceAdapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn });
    expect(adapter.keyboard).toBeUndefined();
    expect('keyboard' in adapter).toBe(false); // not even a stub: the class declares nothing
  });
});

describe('IosAdapter.uiTree and dispose — one delegation each to the tree source', () => {
  // A nested tree of the shape the WDA source returns; the fake stands at the
  // seam so these tests pin the ADAPTER's half of the contract alone.
  const TREE: UiNode = {
    role: 'container', label: 'MyPort', identifier: null, value: null,
    rect: { x: 0, y: 0, width: 402, height: 874 },
    children: [
      {
        role: 'container', label: null, identifier: 'home.header', value: null,
        rect: { x: 0, y: 100, width: 402, height: 50 },
        children: [
          {
            role: 'text', label: 'Welcome', identifier: 'home.title', value: null,
            rect: { x: 16, y: 110, width: 200, height: 20 }, children: [],
          },
        ],
      },
    ],
  };

  const fakeSource = () => {
    const state = { reads: 0, disposes: 0 };
    const source: IosTreeSource = {
      kind: 'idb',
      read: async () => {
        state.reads++;
        return structuredClone(TREE);
      },
      // Resolves on a MACROTASK, so `await adapter.dispose()` observes the
      // release only if dispose really returned this chain — a fire-and-forget
      // dispose would pass on microtask ordering alone (review 2026-09-18).
      dispose: () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            state.disposes++;
            resolve();
          }, 5),
        ),
    };
    return { source, state };
  };

  it("uiTree is the source's read: no idb call for the tree, `settle` accepted and ignored", async () => {
    const { fn, calls } = fakeExec({});
    const { source, state } = fakeSource();
    // Through the interface: `settle` is DeviceAdapter's option, and iOS has no transient to wait out.
    const adapter: DeviceAdapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: source });
    const tree = await adapter.uiTree({ settle: true });
    expect(tree).toEqual(TREE);
    expect(state.reads).toBe(1);
    expect(calls.filter((c) => c.full.startsWith('idb'))).toEqual([]); // the tree read left idb entirely
  });

  it("taps resolve against the source's tree and still go through idb — only the tree read is the source's", async () => {
    const { fn, calls } = fakeExec({});
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: fakeSource().source });
    await tapElement(adapter, 'id:home.header', { ambiguous: 'refuse' });
    // The source's rects are points, the units idb taps in — center of the host view.
    expect(calls.at(-1)?.full).toBe('idb ui tap 201 125 --udid AAAA-1111');
  });

  it("treeSourceKind is the injected source's kind — the flow engine's wait hint reads it from here, not from averi.yaml", () => {
    const bound = new IosAdapter({ udid: 'AAAA-1111', exec: fakeExec({}).fn, treeSource: fakeSource().source });
    expect(bound.treeSourceKind).toBe('idb');
    const wda = new IosAdapter({ udid: 'AAAA-1111', exec: fakeExec({}).fn, treeSource: { ...fakeSource().source, kind: 'wda' } });
    expect(wda.treeSourceKind).toBe('wda');
    expect(new IosAdapter({ exec: fakeExec({}).fn }).treeSourceKind).toBeUndefined(); // unbound: no source, nothing to report
  });

  it("dispose returns the source's release — the process shutdown awaits it", async () => {
    const { source, state } = fakeSource();
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fakeExec({}).fn, treeSource: source });
    await adapter.uiTree();
    await adapter.dispose(); // resolves only once the source has released — the process shutdown awaits this
    expect(state.disposes).toBe(1);
  });

  it('an unbound adapter (no udid, no source) probes only: listDevices works, uiTree is a loud error, dispose is a no-op', async () => {
    const { fn } = fakeExec({ 'xcrun simctl list devices --json': SIMCTL_LIST });
    const adapter = new IosAdapter({ exec: fn });
    expect(await adapter.listDevices()).toHaveLength(3);
    await expect(adapter.uiTree()).rejects.toThrow(/no tree source/);
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });
});

// docs/bugs/2026-10-07-one-wda-session-makes-idb-stick-until-reboot.md: one
// WebDriverAgent start and stop leaves the simulator's com.apple.Accessibility
// AutomationEnabled/ApplicationAccessibilityEnabled at 0, and every LATER app
// launch starts with an empty idb tree until a reboot (15/15; a never-WDA
// simulator 0/30). Writing both true before the launch made 15/15 healthy, so
// launch writes them before every `simctl launch`, whatever the tree source.
describe('IosAdapter re-enables accessibility automation before every launch and deep link', () => {
  const WRITES = [
    'xcrun simctl spawn AAAA-1111 defaults write com.apple.Accessibility AutomationEnabled -bool true',
    'xcrun simctl spawn AAAA-1111 defaults write com.apple.Accessibility ApplicationAccessibilityEnabled -bool true',
  ];
  const simctlCalls = (calls: { full: string }[]) => calls.map((c) => c.full).filter((f) => f.startsWith('xcrun simctl'));
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('a plain launch: both defaults writes on the target simulator, then the launch, in that order', async () => {
    const { fn, calls } = fakeExec({});
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn }).launch('com.app');
    expect(simctlCalls(calls)).toEqual([...WRITES, 'xcrun simctl launch AAAA-1111 com.app']);
  });

  it('the same on a WDA-source adapter — a wda project\'s teardown poisons idb for every other reader of the simulator', async () => {
    const { fn, calls } = fakeExec({});
    const wda: IosTreeSource = { kind: 'wda', read: () => Promise.reject(new Error('unused')), dispose: () => Promise.resolve() };
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: wda }).launch('com.app');
    expect(simctlCalls(calls)).toEqual([...WRITES, 'xcrun simctl launch AAAA-1111 com.app']);
  });

  it('a clearState launch: terminate and wipe first, the writes right before the launch', async () => {
    const container = await mkdtemp(join(tmpdir(), 'averi-test-container-'));
    try {
      await writeFile(join(container, 'Library'), '');
      const { fn, calls } = fakeExec({ 'xcrun simctl get_app_container AAAA-1111 com.app data': `${container}\n` });
      await new IosAdapter({ udid: 'AAAA-1111', exec: fn }).launch('com.app', { clearState: true });
      expect(simctlCalls(calls)).toEqual([
        'xcrun simctl terminate AAAA-1111 com.app',
        'xcrun simctl get_app_container AAAA-1111 com.app data',
        ...WRITES,
        'xcrun simctl launch AAAA-1111 com.app',
      ]);
      expect(await readdir(container)).toEqual([]); // the wipe still happened
    } finally {
      await rm(container, { recursive: true, force: true });
    }
  });

  it('a deep link writes first too — `simctl openurl` can cold-start the app, which is a launch', async () => {
    const { fn, calls } = fakeExec({});
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn }).openDeepLink('myapp://home');
    expect(simctlCalls(calls)).toEqual([...WRITES, 'xcrun simctl openurl AAAA-1111 myapp://home']);
  });

  it('the simulator-wide write is announced on stderr once per adapter, not per launch', async () => {
    const { fn } = fakeExec({});
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn });
    await adapter.launch('com.app');
    await adapter.launch('com.app');
    await adapter.openDeepLink('myapp://home');
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stderr.mock.calls[0]?.[0]).toBe(
      'averi: set com.apple.Accessibility AutomationEnabled and ApplicationAccessibilityEnabled to true on AAAA-1111 ' +
        '(simulator-wide, not restored; before every launch, so an earlier WebDriverAgent session cannot leave idb reading an empty tree)',
    );
  });

  it('a failed write does not fail the launch: the second key is not tried, one stderr line naming the way out, the launch still runs', async () => {
    const { fn, calls } = fakeExec({});
    const writes: string[] = [];
    const failing: ExecFn = (cmd, args, opts) => {
      if (!args.includes('defaults')) return fn(cmd, args, opts);
      writes.push(args.join(' '));
      return Promise.reject(new Error('Command failed (exit 1): xcrun simctl spawn …\nUnable to boot'));
    };
    await new IosAdapter({ udid: 'AAAA-1111', exec: failing }).launch('com.app');
    expect(writes).toHaveLength(1); // the first failure ends the pair
    expect(simctlCalls(calls)).toEqual(['xcrun simctl launch AAAA-1111 com.app']);
    expect(stderr).toHaveBeenCalledTimes(1); // the failure line, and no success announcement
    expect(stderr.mock.calls[0]?.[0]).toBe(
      'averi: could not set com.apple.Accessibility AutomationEnabled on AAAA-1111 before launching com.app ' +
        '(Command failed (exit 1): xcrun simctl spawn …) — idb may read an empty tree after an earlier WebDriverAgent session on this simulator; ' +
        'if it does, reboot the simulator (xcrun simctl shutdown AAAA-1111 && xcrun simctl boot AAAA-1111)',
    );
  });
});
