import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tapElement } from '../../src/interact/tap.js';
import { IDB_EMPTY_RETRY_MS, IosAdapter } from '../../src/adapters/ios.js';
import { IdbEmptyTreeError, IdbTreeSource, type IosTreeSource } from '../../src/adapters/ios-tree-source.js';
import type { ExecFn, ExecResult } from '../../src/adapters/exec.js';
import type { DeviceAdapter, UiNode } from '../../src/adapters/types.js';
import { resetSleeps, sleeps } from '../helpers/sleep-recorder.js';

// The one sleep owner, recorded and not waited on: uiTree's settle re-read
// waits IDB_EMPTY_RETRY_MS, pinned by value rather than spent in real time.
vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));

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

/**
 * The tree source of an adapter whose test reads no tree: required since
 * 2026-10-08 (there is no unbound adapter), and loud if a read reaches it.
 */
const NO_TREE: IosTreeSource = {
  kind: 'idb',
  read: () => Promise.reject(new Error('this test reads no tree')),
  dispose: () => Promise.resolve(),
};

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

describe('IosAdapter interactions', () => {
  it('end to end on the idb source: tapElement resolves against describe-all and taps the center through idb', async () => {
    const { fn, calls } = fakeExec({ 'idb ui describe-all': IDB_DESCRIBE_ALL });
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: new IdbTreeSource({ udid: 'AAAA-1111', exec: fn }) });
    await tapElement(adapter, 'id:login_button', { ambiguous: 'refuse' });
    expect(calls.at(-1)?.full).toBe('idb ui tap 196 724 --udid AAAA-1111');
  });

  it('rejects activity/intent launches with Android-only guidance', async () => {
    const { fn } = fakeExec({});
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE });
    await expect(adapter.launch('com.app', { activity: '.Main' })).rejects.toThrow(/Android-only/);
    await expect(adapter.launch('com.app', { intent: { action: 'SEND' } })).rejects.toThrow(/Android-only/);
  });

  it('probes for simctl once, not per call', async () => {
    const { fn, calls } = fakeExec({});
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE });
    await adapter.openDeepLink('a://b');
    await adapter.openDeepLink('c://d');
    expect(calls.filter((c) => c.full === 'xcrun --find simctl')).toHaveLength(1);
  });

  it('viewport reads point dimensions from idb describe and caches', async () => {
    const { fn, calls } = fakeExec({
      'idb describe --json': JSON.stringify({
        screen_dimensions: { width: 1206, height: 2622, density: 3, width_points: 402, height_points: 874 },
      }),
    });
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE });
    expect(await adapter.viewport()).toEqual({ width: 402, height: 874 });
    expect(await adapter.viewport()).toEqual({ width: 402, height: 874 });
    expect(calls.filter((c) => c.full.startsWith('idb describe'))).toHaveLength(1);
  });

  // adapters/types.ts#viewport since the parity code review (A3, 2026-10-07):
  // a FAILED read is not kept — one transient `idb describe` failure used to
  // strip the device-screen witness for the life of the server.
  it('viewport does not memoize a FAILED read: the next call asks idb again, and its success is kept', async () => {
    const responses: Record<string, string> = { 'idb describe --json': JSON.stringify({}) };
    const { fn, calls } = fakeExec(responses);
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE });
    await expect(adapter.viewport()).rejects.toThrow(/no screen_dimensions/);
    responses['idb describe --json'] = JSON.stringify({ screen_dimensions: { width_points: 402, height_points: 874 } });
    expect(await adapter.viewport()).toEqual({ width: 402, height: 874 });
    expect(await adapter.viewport()).toEqual({ width: 402, height: 874 });
    expect(calls.filter((c) => c.full.startsWith('idb describe'))).toHaveLength(2);
  });

  it('viewport({ fresh: true }) asks idb again and replaces the memo', async () => {
    const responses: Record<string, string> = {
      'idb describe --json': JSON.stringify({ screen_dimensions: { width_points: 402, height_points: 874 } }),
    };
    const { fn, calls } = fakeExec(responses);
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE });
    expect(await adapter.viewport()).toEqual({ width: 402, height: 874 });
    responses['idb describe --json'] = JSON.stringify({ screen_dimensions: { width_points: 820, height_points: 1180 } });
    expect(await adapter.viewport({ fresh: true })).toEqual({ width: 820, height: 1180 });
    expect(await adapter.viewport()).toEqual({ width: 820, height: 1180 });
    expect(calls.filter((c) => c.full.startsWith('idb describe'))).toHaveLength(2);
  });

  it('clearText sends backspaces then forward-deletes (position-independent)', async () => {
    const { fn, calls } = fakeExec({});
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE }).clearText(3);
    expect(calls.at(-2)?.full).toBe('idb ui key-sequence 42 42 42 --udid AAAA-1111');
    expect(calls.at(-1)?.full).toBe('idb ui key-sequence 76 76 76 --udid AAAA-1111');
  });

  it('typeText hands the text to idb ui text', async () => {
    const { fn, calls } = fakeExec({});
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE }).typeText('alice');
    expect(calls.at(-1)?.full).toBe('idb ui text alice --udid AAAA-1111');
  });

  // docs/bugs/2026-10-07-ios-fill-empty-value-fails-in-idb.md: `idb ui text ''`
  // is refused ("Request was not sent"), so a `fill` with value "" — a clear
  // alone, or a focus without typing — threw after the focus tap and after the
  // clear. The contract (DeviceAdapter.typeText) is that "" types nothing.
  it('typeText with an empty string calls idb not at all — the contract Android meets with a zero-iteration loop', async () => {
    const { fn, calls } = fakeExec({});
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE }).typeText('');
    expect(calls).toEqual([]);
  });

  it('pressKey back is rejected with guidance, home uses the HOME button', async () => {
    const { fn, calls } = fakeExec({});
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE });
    await expect(adapter.pressKey('back')).rejects.toThrow(/no iOS equivalent/);
    await adapter.pressKey('home');
    expect(calls.at(-1)?.full).toBe('idb ui button HOME --udid AAAA-1111');
  });

  it('has no keyboard oracle: on iOS the keyboard is part of the tree, so a tap pays nothing for the question and interact/ presses no key here', () => {
    const { fn } = fakeExec({});
    const adapter: DeviceAdapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE });
    expect(adapter.keyboard).toBeUndefined();
    expect('keyboard' in adapter).toBe(false); // not even a stub: the class declares nothing
  });
});

describe('IosAdapter.uiTree and dispose — one delegation each to the tree source', () => {
  beforeEach(() => resetSleeps());

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

  it("uiTree is the source's read: one read, no idb call for the tree", async () => {
    const { fn, calls } = fakeExec({});
    const { source, state } = fakeSource();
    // Through the interface: `settle` is DeviceAdapter's option. A read that
    // succeeds is read once, with or without it, and nothing waits.
    const adapter: DeviceAdapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: source });
    expect(await adapter.uiTree({ settle: true })).toEqual(TREE);
    expect(await adapter.uiTree()).toEqual(TREE);
    expect(state.reads).toBe(2);
    expect(sleeps).toEqual([]);
    expect(calls.filter((c) => c.full.startsWith('idb'))).toEqual([]); // the tree read left idb entirely
  });

  // 2026-10-08 (docs/plans/2026-10-08-round3-phase2-device-check.md, finding
  // 5): a healthy idb read 0.4 s after launch_app can be the same 0×0
  // Application the stuck state is, and is bare at +0.7 s. With `settle` (a
  // one-shot caller — ui_snapshot) that one error is read again, once, after
  // IDB_EMPTY_RETRY_MS; anything else, and a poller's read, is as it was.
  describe('settle: one re-read of an idb empty tree', () => {
    /** A source whose reads answer in turn: a tree, or an error thrown. */
    const scripted = (...answers: (UiNode | Error)[]) => {
      const state = { reads: 0 };
      const source: IosTreeSource = {
        kind: 'idb',
        read: async () => {
          const answer = answers[state.reads++];
          if (answer === undefined) throw new Error('read past the script');
          if (answer instanceof Error) throw answer;
          return structuredClone(answer);
        },
        dispose: () => Promise.resolve(),
      };
      return { source, state };
    };
    const empty = () => new IdbEmptyTreeError('AAAA-1111', ['Application']);
    const adapterOn = (source: IosTreeSource): DeviceAdapter => new IosAdapter({ udid: 'AAAA-1111', exec: fakeExec({}).fn, treeSource: source });

    it('the waited value is one second, as measured', () => {
      expect(IDB_EMPTY_RETRY_MS).toBe(1_000);
    });

    it('an empty tree then a tree: two reads, one wait of IDB_EMPTY_RETRY_MS between them, and the tree', async () => {
      const { source, state } = scripted(empty(), TREE);
      expect(await adapterOn(source).uiTree({ settle: true })).toEqual(TREE);
      expect(state.reads).toBe(2);
      expect(sleeps).toEqual([IDB_EMPTY_RETRY_MS]);
    });

    it('empty twice (the stuck state): two reads, and an IdbEmptyTreeError that states the re-read and keeps the first line', async () => {
      // The second read's shape, not the first's, is the one reported.
      const second = new IdbEmptyTreeError('AAAA-1111', []);
      const { source, state } = scripted(empty(), second);
      const error = await adapterOn(source).uiTree({ settle: true }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(IdbEmptyTreeError);
      const retried = error as IdbEmptyTreeError;
      expect(retried.reread).toBe(IDB_EMPTY_RETRY_MS);
      expect(retried.udid).toBe('AAAA-1111');
      const [first, ...rest] = retried.message.split('\n');
      expect(first).toBe(second.message.split('\n')[0]); // what a trace quotes, verbatim
      expect(rest.join('\n')).toMatch(/^The read was retried once after 1 s and was still empty; /);
      expect(state.reads).toBe(2);
      expect(sleeps).toEqual([IDB_EMPTY_RETRY_MS]);
    });

    it('without settle (a poller): one read, the error thrown as the source threw it (no re-read clause), nothing waited — the poll interval is the retry', async () => {
      const first = empty();
      const { source, state } = scripted(first, TREE);
      const error = await adapterOn(source).uiTree().catch((e: unknown) => e);
      expect(error).toBe(first);
      expect((error as IdbEmptyTreeError).reread).toBeUndefined();
      expect(state.reads).toBe(1);
      expect(sleeps).toEqual([]);
    });

    it('settle and any OTHER read error (a WDA failure, an idb exec error): one read, rethrown, nothing waited', async () => {
      const other = new Error('WebDriverAgent /source failed: socket hang up');
      const { source, state } = scripted(other, TREE);
      const error = await adapterOn(source).uiTree({ settle: true }).catch((e: unknown) => e);
      expect(error).toBe(other);
      expect(state.reads).toBe(1);
      expect(sleeps).toEqual([]);
    });
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
  });

  it("dispose returns the source's release — the process shutdown awaits it", async () => {
    const { source, state } = fakeSource();
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fakeExec({}).fn, treeSource: source });
    await adapter.uiTree();
    await adapter.dispose(); // resolves only once the source has released — the process shutdown awaits this
    expect(state.disposes).toBe(1);
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
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE }).launch('com.app');
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
      await new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE }).launch('com.app', { clearState: true });
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
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE }).openDeepLink('myapp://home');
    expect(simctlCalls(calls)).toEqual([...WRITES, 'xcrun simctl openurl AAAA-1111 myapp://home']);
  });

  it('the simulator-wide write is announced on stderr once per adapter, not per launch', async () => {
    const { fn } = fakeExec({});
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE });
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
    await new IosAdapter({ udid: 'AAAA-1111', exec: failing, treeSource: NO_TREE }).launch('com.app');
    expect(writes).toHaveLength(1); // the first failure ends the pair
    expect(simctlCalls(calls)).toEqual(['xcrun simctl launch AAAA-1111 com.app']);
    expect(stderr).toHaveBeenCalledTimes(1); // the failure line, and no success announcement
    expect(stderr.mock.calls[0]?.[0]).toBe(
      'averi: could not set com.apple.Accessibility AutomationEnabled on AAAA-1111 before launching com.app ' +
        '(Command failed (exit 1): xcrun simctl spawn …) — idb may read an empty tree after an earlier WebDriverAgent session on this simulator; ' +
        'if it does, reboot the simulator (`xcrun simctl shutdown AAAA-1111 && xcrun simctl boot AAAA-1111`)',
    );
  });
});

/**
 * `simctl io … screenshot` exits 0 and the file is read after it
 * (2026-10-08, adapters/screenshot-bytes.ts): an empty or non-PNG file is a
 * transport error naming the simulator and the command, as on Android.
 */
describe('IosAdapter.screenshot — the file is a PNG or the call fails', () => {
  /** simctl's stand-in: writes `bytes` to the path it is given, as `simctl io <udid> screenshot <file>` does. */
  function writesScreenshot(bytes: Buffer): ExecFn {
    return async (cmd, args): Promise<ExecResult> => {
      if (cmd === 'xcrun' && args[0] === 'simctl' && args[1] === 'io') await writeFile(args.at(-1) as string, bytes);
      return { stdout: Buffer.alloc(0), stderr: '' };
    };
  }

  it('passes a file that starts with the PNG signature through unchanged', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
    const shot = await new IosAdapter({ udid: 'AAAA-1111', exec: writesScreenshot(png), treeSource: NO_TREE }).screenshot();
    expect(shot.equals(png)).toBe(true);
  });

  it('an empty file is a transport error naming the simulator, the command and the reboot', async () => {
    await expect(new IosAdapter({ udid: 'AAAA-1111', exec: writesScreenshot(Buffer.alloc(0)), treeSource: NO_TREE }).screenshot()).rejects.toThrow(
      '`xcrun simctl io AAAA-1111 screenshot <file>` on simulator AAAA-1111 returned 0 bytes — not a PNG, though the ' +
        'command reported success: the device transport failed (a dying or hung emulator / simulator), not the app\'s ' +
        'screen. Re-check `xcrun simctl list devices booted` and retry; if it repeats, reboot the simulator ' +
        '(`xcrun simctl shutdown AAAA-1111 && xcrun simctl boot AAAA-1111`).',
    );
  });

  it('a file that is not a PNG is refused too, quoting its start', async () => {
    const exec = writesScreenshot(Buffer.from('JFIF not a png'));
    await expect(new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: NO_TREE }).screenshot()).rejects.toThrow(/returned 14 bytes starting "JFIF not a png" — not a PNG/);
  });
});
