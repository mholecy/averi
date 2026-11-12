import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tapElement } from '../../src/interact/tap.js';
import { tapText } from '../../src/mcp/tool-text.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { FIRST_KEY_ALONE_MS, IDB_EMPTY_RETRY_MS, IosAdapter, PGREP_TIMEOUT_MS } from '../../src/adapters/ios.js';
import { IDB_SETTLE_CADENCE_MS, IdbEmptyTreeError, IdbTreeSource, parseIdbDescribeAll, type IosTreeSource } from '../../src/adapters/ios-tree-source.js';
import { WDA_SETTLE_CADENCE_MS, WdaTreeSource } from '../../src/adapters/wda-tree-source.js';
import { AutoTreeSource } from '../../src/adapters/auto-tree-source.js';
import { ReadHandOff } from '../../src/ui-tree/read-handoff.js';
import { fakeFetch, fakeSpawn } from '../helpers/fake-wda.js';
import { ExecError, type ExecFn, type ExecResult } from '../../src/adapters/exec.js';
import { NoLinkHandlerError } from '../../src/adapters/ios-link-failure.js';
import { captureRefusal } from '../../src/verify/capture.js';
import type { IdbHelper } from '../../src/adapters/idb-helper.js';
import type { DeviceAdapter, UiNode } from '../../src/adapters/types.js';
import { resetSleeps, sleeps } from '../helpers/sleep-recorder.js';
import { fillField } from '../../src/interact/fill.js';
import { typeIntoFocused } from '../../src/interact/type-text.js';
import { el, FAST, resetLayout, screen } from '../helpers/fake.js';
import { execErrorLikeExec, typingExecError } from '../helpers/exec-error.js';
import { appinfo } from '../helpers/simctl-appinfo.js';
import { NO_EYES } from '../helpers/eyes.js';

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
  applicationLabel: () => Promise.reject(new Error('this test reads no tree')),
  dispose: () => Promise.resolve(),
};

/** NO_TREE of the WDA kind — its screenshots too are idb's (ios.ts#screenshotVia). */
const WDA_NO_TREE: IosTreeSource = { ...NO_TREE, kind: 'wda' };

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
  // D66 review: a real IosAdapter over the WDA parser on the committed SWIFT form capture (wda-capture-swift-form-pushed.json,
  // CONTINUE `isEnabled` "0"): the tap is sent through idb at its centre and the reply warns. No device: the tree
  // source answers the capture, idb's exec answers nothing but the screen size.
  it('end to end on the WDA source: the SWIFT form\'s disabled CONTINUE is tapped all the same, and the reply warns', async () => {
    const capture = await readFile(new URL('../fixtures/wda-capture-swift-form-pushed.json', import.meta.url), 'utf8');
    const { fn, calls } = fakeExec({ 'idb describe': JSON.stringify({ screen_dimensions: { width_points: 402, height_points: 874 } }) });
    const wda: IosTreeSource = { ...WDA_NO_TREE, read: async () => parseWdaSource(capture) };
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: wda });
    const selector = 'id:swift_payment.form.continue_button';
    const tapped = await tapElement(adapter, selector, { eyes: NO_EYES, ambiguous: 'refuse' });
    expect(calls.at(-1)?.full).toBe('idb ui tap 201 802 --udid AAAA-1111');
    expect(tapText(selector, tapped)).toBe(`Tapped ${selector}\n⚠ The tree marks the target disabled, the tap may do nothing; read again before relying on it.`);
  });

  it('end to end on the idb source: tapElement resolves against describe-all and taps the center through idb', async () => {
    const { fn, calls } = fakeExec({ 'idb ui describe-all': IDB_DESCRIBE_ALL });
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: new IdbTreeSource({ udid: 'AAAA-1111', exec: fn }) });
    await tapElement(adapter, 'id:login_button', { eyes: NO_EYES, ambiguous: 'refuse' });
    expect(calls.at(-1)?.full).toBe('idb ui tap 196 724 --udid AAAA-1111');
  });

  // D35 → L5 (ADR 0040): the settle cadence is the tree SOURCE's fact, forwarded by the adapter.
  it("its settle cadence is its tree source's: idb's describe-all 300, WDA's /source 300 (both measured), a source without one none", () => {
    expect(IDB_SETTLE_CADENCE_MS).toBe(300);
    const { fn } = fakeExec({});
    const idb = new IdbTreeSource({ udid: 'AAAA-1111', exec: fn });
    expect(idb.settleCadenceMs).toBe(IDB_SETTLE_CADENCE_MS);
    expect(new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: idb }).settleCadenceMs).toBe(IDB_SETTLE_CADENCE_MS);
    const wda: IosTreeSource = new WdaTreeSource({ udid: 'AAAA-1111', exec: fn, fetchFn: fakeFetch(() => 'refused').fn, spawnFn: fakeSpawn().fn });
    expect(wda.settleCadenceMs).toBe(WDA_SETTLE_CADENCE_MS);
    expect(new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: wda }).settleCadenceMs).toBe(WDA_SETTLE_CADENCE_MS);
    expect(new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: WDA_NO_TREE }).settleCadenceMs).toBeUndefined();
  });

  it('the settle cadence survives the hand-off proxy (ReadHandOff.watch)', () => {
    const { fn } = fakeExec({});
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: new IdbTreeSource({ udid: 'AAAA-1111', exec: fn }) });
    expect(new ReadHandOff().watch<DeviceAdapter>(adapter).settleCadenceMs).toBe(IDB_SETTLE_CADENCE_MS);
  });

  describe('a tap settles at the source\'s cadence (ADR 0040), Date faked so a read costs 0 ms', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      resetSleeps();
    });
    afterEach(() => vi.useRealTimers());

    it('idb: one 300 ms pause between the two describe-all reads', async () => {
      const { fn, calls } = fakeExec({ 'idb ui describe-all': IDB_DESCRIBE_ALL });
      const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: new IdbTreeSource({ udid: 'AAAA-1111', exec: fn }) });
      await tapElement(adapter, 'id:login_button', { eyes: NO_EYES, ambiguous: 'refuse' });
      expect(calls.filter((c) => c.full.startsWith('idb ui describe-all'))).toHaveLength(2);
      expect(sleeps).toEqual([300]);
    });

    it('a source with no fact (WDA): the unchanged 500', async () => {
      const { fn } = fakeExec({});
      const wda: IosTreeSource = { ...WDA_NO_TREE, read: async () => parseIdbDescribeAll(IDB_DESCRIBE_ALL) };
      const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: wda });
      await tapElement(adapter, 'id:login_button', { eyes: NO_EYES, ambiguous: 'refuse' });
      expect(sleeps).toEqual([500]);
    });
  });

  it('has no drag speed (decided 2026-10-09, adapters/ios.ts#swipe): scroll_until strokes it at its 300-ms default, as before', () => {
    const adapter: DeviceAdapter = new IosAdapter({ udid: 'AAAA-1111', exec: fakeExec({}).fn, treeSource: NO_TREE });
    expect(adapter.dragSpeed).toBeUndefined();
  });

  it('its tree read does not wait for the screen at rest (types.ts#treeReadSettles): neither WDA nor idb waits, so the read after a stroke is still confirmed', () => {
    const adapter: DeviceAdapter = new IosAdapter({ udid: 'AAAA-1111', exec: fakeExec({}).fn, treeSource: NO_TREE });
    expect(adapter.treeReadSettles).toBeUndefined();
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
    expect(await adapter.viewport()).toEqual({ width: 402, height: 874, statusBand: 62 });
    expect(await adapter.viewport()).toEqual({ width: 402, height: 874, statusBand: 62 });
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
    expect(await adapter.viewport()).toEqual({ width: 402, height: 874, statusBand: 62 });
    expect(await adapter.viewport()).toEqual({ width: 402, height: 874, statusBand: 62 });
    expect(calls.filter((c) => c.full.startsWith('idb describe'))).toHaveLength(2);
  });

  it('viewport({ fresh: true }) asks idb again and replaces the memo', async () => {
    const responses: Record<string, string> = {
      'idb describe --json': JSON.stringify({ screen_dimensions: { width_points: 402, height_points: 874 } }),
    };
    const { fn, calls } = fakeExec(responses);
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE });
    expect(await adapter.viewport()).toEqual({ width: 402, height: 874, statusBand: 62 });
    responses['idb describe --json'] = JSON.stringify({ screen_dimensions: { width_points: 820, height_points: 1180 } });
    expect(await adapter.viewport({ fresh: true })).toEqual({ width: 820, height: 1180, statusBand: 20 });
    expect(await adapter.viewport()).toEqual({ width: 820, height: 1180, statusBand: 20 });
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
    expect(calls.at(-1)?.full).toBe('idb ui text --udid AAAA-1111 -- alice');
  });

  // D74: a text after `--` is argparse's positional whatever it starts with — `-h` is typed, not answered with help (exit
  // 0, nothing typed), `-hunter2` and `--log=s3cret` are no options. The --udid stands before the `--`.
  it.each(['-h', '-abc', '-hunter2', '--log=s3cret', '--', '--udid'])('typeText sends %s after `--`, the --udid before it (D74)', async (text) => {
    const { fn, calls } = fakeExec({});
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE }).typeText(text);
    expect(calls.at(-1)?.full).toBe(`idb ui text --udid AAAA-1111 -- ${text}`);
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

  describe('keyboardAdvice — what works against a covering keyboard, said for the tree source the guard does or does not act on', () => {
    const MEASURED =
      'the keyboard is part of the accessibility tree and no key hides it without a side effect: there is no back key, ' +
      "the return key submits from the field, WebDriverAgent's keyboard/dismiss fails and a swipe does nothing; " +
      "a tap on a neutral, non-interactive element (a title label) was measured to hide it without submitting, and so was the input-accessory toolbar's Done";
    const adviceOn = (kind: 'idb' | 'wda') => new IosAdapter({ udid: 'AAAA-1111', exec: fakeExec({}).fn, treeSource: { ...NO_TREE, kind } }).keyboardAdvice;

    it('under WDA it names app.ios.keyboardDismiss, which the guard taps before a covered target', () => {
      expect(adviceOn('wda')).toBe(
        `${MEASURED} — name them under app.ios.keyboardDismiss in averi.yaml (tap: { id: <title> }, accessory: true) and the guard taps the first one on screen before a covered target; ` +
          'typing with a hardware keyboard keeps the software keyboard from showing',
      );
    });

    it('under idb it says to tap one yourself: no guard acts there, so app.ios.keyboardDismiss is inert', () => {
      expect(adviceOn('idb')).toBe(
        `${MEASURED} — tap one yourself first: with treeSource: idb no guard acts, so app.ios.keyboardDismiss is inert (with treeSource: wda the guard taps its first on-screen entry before a covered target); ` +
          'typing with a hardware keyboard keeps the software keyboard from showing',
      );
    });
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
      applicationLabel: () => Promise.reject(new Error('unused')),
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
        applicationLabel: () => Promise.reject(new Error('unused')),
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
    await tapElement(adapter, 'id:home.header', { eyes: NO_EYES, ambiguous: 'refuse' });
    // The source's rects are points, the units idb taps in — center of the host view.
    expect(calls.at(-1)?.full).toBe('idb ui tap 201 125 --udid AAAA-1111');
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
    const wda: IosTreeSource = { kind: 'wda', read: () => Promise.reject(new Error('unused')), applicationLabel: async () => ({ kind: 'declined' }), dispose: () => Promise.resolve() };
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: wda }).launch('com.app');
    expect(simctlCalls(calls)).toEqual([...WRITES, 'xcrun simctl launch AAAA-1111 com.app']);
  });

  // A41b: the launch asks its source to pre-warm (WebDriverAgent's start in the background) right after `simctl launch`
  // — never before it (review r1: a start racing the app's launch is unmeasured) — and never waits for it.
  it('a launch pre-warms its tree source after simctl launch, before the foreground wait, and does not wait for it', async () => {
    const { fn, calls } = fakeExec({});
    const order: string[] = [];
    const wda: IosTreeSource = {
      kind: 'wda',
      read: () => new Promise(() => undefined),
      applicationLabel: async () => ({ kind: 'declined' }),
      prewarm: () => void order.push(`prewarm after ${calls.at(-1)?.full ?? 'nothing'}`),
      dispose: () => Promise.resolve(),
    };
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: wda }).launch('com.app');
    expect(order).toEqual(['prewarm after xcrun simctl launch AAAA-1111 com.app']);
    expect(simctlCalls(calls)).toEqual([...WRITES, 'xcrun simctl launch AAAA-1111 com.app']);
  });

  it('under auto: the launch returns while WebDriverAgent is still coming up; the first read then joins that one start', async () => {
    const { fn } = fakeExec({});
    let up!: () => void;
    let bringUps = 0;
    const wda = {
      ...WDA_NO_TREE,
      read: async () => screen(el({ identifier: 'from.wda' })),
      bringUp: () => (bringUps++, new Promise<void>((resolve) => { up = resolve; })),
      buildCached: async () => true,
    };
    const idb: IosTreeSource = { ...NO_TREE, applicationLabel: async () => ({ kind: 'declined' }) };
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: new AutoTreeSource({ wda, idb }) });
    await expect(adapter.launch('com.app')).resolves.toBeDefined();
    expect(bringUps).toBe(1); // started by the launch, not finished: the launch did not wait for it
    const reading = adapter.uiTree();
    up();
    expect(JSON.stringify(await reading)).toContain('from.wda');
    expect(bringUps).toBe(1);
  });

  it('idb has no pre-warm: a launch over it starts nothing beyond the launch', async () => {
    const { fn, calls } = fakeExec({ 'idb ui describe-all': IDB_DESCRIBE_ALL });
    const idb = new IdbTreeSource({ udid: 'AAAA-1111', exec: fn });
    expect((idb as IosTreeSource).prewarm).toBeUndefined();
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: { ...NO_TREE, applicationLabel: async () => ({ kind: 'declined' }) } });
    await adapter.launch('com.app');
    expect(simctlCalls(calls)).toEqual([...WRITES, 'xcrun simctl launch AAAA-1111 com.app']);
  });

  it('a clearState launch: terminate and wipe first, the writes right before the launch', async () => {
    const container = await mkdtemp(join(tmpdir(), 'averi-test-container-'));
    try {
      await mkdir(join(container, 'Documents'));
      await writeFile(join(container, 'Documents', 'x'), '');
      const { fn, calls } = fakeExec({ 'xcrun simctl get_app_container AAAA-1111 com.app data': `${container}\n` });
      await new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE }).launch('com.app', { clearState: true });
      expect(simctlCalls(calls)).toEqual([
        'xcrun simctl terminate AAAA-1111 com.app',
        'xcrun simctl get_app_container AAAA-1111 com.app data',
        ...WRITES,
        'xcrun simctl launch AAAA-1111 com.app',
      ]);
      // The wipe happened, and left a fresh install's folders (A44, ADR 0047): Documents/ present and empty.
      expect((await readdir(container)).sort()).toEqual(['Documents', 'Library', 'SystemData', 'tmp']);
      expect(await readdir(join(container, 'Documents'))).toEqual([]);
    } finally {
      await rm(container, { recursive: true, force: true });
    }
  });

  it('a deep link writes first too — `simctl openurl` can cold-start the app, which is a launch', async () => {
    const { fn, calls } = fakeExec({});
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE }).openDeepLink('myapp://home');
    expect(simctlCalls(calls)).toEqual([...WRITES, 'xcrun simctl openurl AAAA-1111 myapp://home']);
  });

  // D23 (2026-10-31): the two spawns overlap rather than queue — 445 → 250 ms
  // median on the lab simulator. One spawn is not possible: the runtime has
  // no shell (`simctl spawn <udid> sh -c …` → ENOENT) and `defaults write`
  // takes one key, or a whole domain that would replace the other keys.
  it('the two writes are in flight together, not one after the other, and the launch waits for both', async () => {
    const { fn, calls } = fakeExec({});
    let inFlight = 0;
    let maxInFlight = 0;
    const done: string[] = [];
    const overlapping: ExecFn = async (cmd, args, opts) => {
      if (args[0] !== 'simctl' || !args.includes('defaults')) {
        // Not a write (xcode-env's `xcrun --find simctl` probe passes straight
        // through); the launch never starts before both writes finished.
        if (args[0] === 'simctl' && args[1] === 'launch') expect(done).toHaveLength(2);
        return fn(cmd, args, opts);
      }
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      done.push(args.find((a) => a.endsWith('Enabled')) ?? '');
      return fn(cmd, args, opts);
    };
    await new IosAdapter({ udid: 'AAAA-1111', exec: overlapping, treeSource: NO_TREE }).launch('com.app');
    expect(maxInFlight).toBe(2);
    expect(simctlCalls(calls)).toEqual([...WRITES, 'xcrun simctl launch AAAA-1111 com.app']);
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

  it('a failed write does not fail the launch: both keys were tried (D23: together), one stderr line naming the first key and the way out, the launch still runs', async () => {
    const { fn, calls } = fakeExec({});
    const writes: string[] = [];
    const failing: ExecFn = (cmd, args, opts) => {
      if (!args.includes('defaults')) return fn(cmd, args, opts);
      writes.push(args.join(' '));
      // Each key fails with its own first line: the line must carry AutomationEnabled's own reason.
      const which = args.includes('AutomationEnabled') ? '' : ' (second)';
      return Promise.reject(new Error(`Command failed (exit 1): xcrun simctl spawn …${which}\nUnable to boot`));
    };
    await new IosAdapter({ udid: 'AAAA-1111', exec: failing, treeSource: NO_TREE }).launch('com.app');
    expect(writes).toHaveLength(2); // in flight together (D23), so both were tried — and still one line
    expect(simctlCalls(calls)).toEqual(['xcrun simctl launch AAAA-1111 com.app']);
    expect(stderr).toHaveBeenCalledTimes(1); // the failure line, and no success announcement
    expect(stderr.mock.calls[0]?.[0]).toBe(
      'averi: could not set com.apple.Accessibility AutomationEnabled on AAAA-1111 before launching com.app ' +
        '(Command failed (exit 1): xcrun simctl spawn …) — idb may read an empty tree after an earlier WebDriverAgent session on this simulator; ' +
        'if it does, reboot the simulator (`xcrun simctl shutdown AAAA-1111 && xcrun simctl boot AAAA-1111`)',
    );
  });

  it('only the first write fails: the one stderr line names AutomationEnabled with its own reason, no success announcement, the launch still runs', async () => {
    const { fn, calls } = fakeExec({});
    const failing: ExecFn = (cmd, args, opts) =>
      args.includes('AutomationEnabled')
        ? Promise.reject(new Error('Command failed (exit 1): xcrun simctl spawn … (first)\nUnable to write'))
        : fn(cmd, args, opts);
    await new IosAdapter({ udid: 'AAAA-1111', exec: failing, treeSource: NO_TREE }).launch('com.app');
    expect(simctlCalls(calls)).toEqual([WRITES[1], 'xcrun simctl launch AAAA-1111 com.app']);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stderr.mock.calls[0]?.[0]).toBe(
      'averi: could not set com.apple.Accessibility AutomationEnabled on AAAA-1111 before launching com.app ' +
        '(Command failed (exit 1): xcrun simctl spawn … (first)) — idb may read an empty tree after an earlier WebDriverAgent session on this simulator; ' +
        'if it does, reboot the simulator (`xcrun simctl shutdown AAAA-1111 && xcrun simctl boot AAAA-1111`)',
    );
  });

  it('only the second write fails: the one stderr line names ApplicationAccessibilityEnabled, no success announcement, the launch still runs', async () => {
    const { fn, calls } = fakeExec({});
    const failing: ExecFn = (cmd, args, opts) =>
      args.includes('ApplicationAccessibilityEnabled')
        ? Promise.reject(new Error('Command failed (exit 1): xcrun simctl spawn …\nUnable to write'))
        : fn(cmd, args, opts);
    await new IosAdapter({ udid: 'AAAA-1111', exec: failing, treeSource: NO_TREE }).launch('com.app');
    expect(simctlCalls(calls)).toEqual([WRITES[0], 'xcrun simctl launch AAAA-1111 com.app']);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stderr.mock.calls[0]?.[0]).toBe(
      'averi: could not set com.apple.Accessibility ApplicationAccessibilityEnabled on AAAA-1111 before launching com.app ' +
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
describe('IosAdapter.screenshot — the file is a PNG or the call fails (simctl: the kill switch)', () => {
  beforeEach(() => vi.stubEnv('AVERI_IOS_SCREENSHOT', 'simctl'));
  afterEach(() => vi.unstubAllEnvs());

  /** simctl's stand-in: writes `bytes` to the path it is given, as `simctl io <udid> screenshot <file>` does. */
  function writesScreenshot(bytes: Buffer): ExecFn {
    return async (cmd, args): Promise<ExecResult> => {
      if (cmd === 'xcrun' && args[0] === 'simctl' && args[1] === 'io') await writeFile(args.at(-1) as string, bytes);
      return { stdout: Buffer.alloc(0), stderr: '' };
    };
  }

  it('passes a file that starts with the PNG signature through unchanged', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
    const shot = await new IosAdapter({ udid: 'AAAA-1111', exec: writesScreenshot(png), treeSource: WDA_NO_TREE }).screenshot();
    expect(shot.equals(png)).toBe(true);
  });

  it('an empty file is a transport error naming the simulator, the command and the reboot', async () => {
    await expect(new IosAdapter({ udid: 'AAAA-1111', exec: writesScreenshot(Buffer.alloc(0)), treeSource: WDA_NO_TREE }).screenshot()).rejects.toThrow(
      '`xcrun simctl io AAAA-1111 screenshot <file>` on simulator AAAA-1111 returned 0 bytes — not a PNG, though the ' +
        'command reported success: the device transport failed (a dying or hung emulator / simulator), not the app\'s ' +
        'screen. Re-check `xcrun simctl list devices booted` and retry; if it repeats, reboot the simulator ' +
        '(`xcrun simctl shutdown AAAA-1111 && xcrun simctl boot AAAA-1111`).',
    );
  });

  it('a file that is not a PNG is refused too, quoting its start', async () => {
    const exec = writesScreenshot(Buffer.from('JFIF not a png'));
    await expect(new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: WDA_NO_TREE }).screenshot()).rejects.toThrow(/returned 14 bytes starting "JFIF not a png" — not a PNG/);
  });
});

/**
 * ios.ts#screenshotVia (docs/adr/0032-a-persistent-idb-helper-runs-the-cli-in-process.md, "D26b" and amendment D44): on
 * either tree source the screenshot is `idb screenshot -` — through runIdb, so the helper first and the idb CLI as its
 * fallback — never `simctl io screenshot`, which stalls ~+1 000 ms in ~7 % of calls (backlog "### D26 diag"). No simctl
 * fallback at run time: a capture pair from two sources compares two different images (the Dynamic Island) and reads as
 * moving.
 */
describe('IosAdapter.screenshot — through idb on either tree source (D26b, D44)', () => {
  const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x0a, 0xff]);
  beforeEach(() => vi.stubEnv('AVERI_IOS_SCREENSHOT', undefined));
  afterEach(() => vi.unstubAllEnvs());

  /** Answers `idb screenshot -` with `idb`, writes `simctl` to simctl's file; logs every call but the Xcode probe. */
  function both(idb: Buffer | Error, simctlBytes: Buffer = PNG_BYTES) {
    const calls: string[] = [];
    const exec: ExecFn = async (cmd, args): Promise<ExecResult> => {
      if (cmd === 'xcrun' && args[0] === '--find') return { stdout: Buffer.from('/x/simctl\n'), stderr: '' };
      calls.push([cmd, ...args].join(' '));
      if (cmd === 'idb') {
        if (idb instanceof Error) throw idb;
        return { stdout: idb, stderr: '' };
      }
      if (cmd === 'xcrun' && args[1] === 'io') await writeFile(args.at(-1) as string, simctlBytes);
      return { stdout: Buffer.alloc(0), stderr: '' };
    };
    return { exec, calls };
  }

  it('sends `idb screenshot - --udid U` and returns its stdout as it came', async () => {
    const { exec, calls } = both(PNG_BYTES);
    const shot = await new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: NO_TREE }).screenshot();
    expect(shot.equals(PNG_BYTES)).toBe(true);
    expect(calls).toEqual(['idb screenshot - --udid AAAA-1111']);
  });

  it('sends `idb screenshot -` on the WDA tree source too, and no simctl call (D44)', async () => {
    const { exec, calls } = both(PNG_BYTES);
    const shot = await new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: WDA_NO_TREE }).screenshot();
    expect(shot.equals(PNG_BYTES)).toBe(true);
    expect(calls).toEqual(['idb screenshot - --udid AAAA-1111']);
  });

  it('on the WDA tree source hands the helper the `screenshot` argv: no CLI, no simctl call (D44)', async () => {
    const helperArgv: string[][] = [];
    const idbHelper = {
      run: async (argv: string[]) => {
        helperArgv.push(argv);
        return { kind: 'answer' as const, code: 0, stdout: PNG_BYTES, stderr: '' };
      },
    } as unknown as IdbHelper;
    const { exec, calls } = both(PNG_BYTES);
    const shot = await new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: WDA_NO_TREE, idbHelper }).screenshot();
    expect(shot.equals(PNG_BYTES)).toBe(true);
    expect(helperArgv).toEqual([['screenshot', '-', '--udid', 'AAAA-1111']]);
    expect(calls).toEqual([]);
  });

  it('keeps `simctl io screenshot` on the WDA tree source under AVERI_IOS_SCREENSHOT=simctl', async () => {
    vi.stubEnv('AVERI_IOS_SCREENSHOT', 'simctl');
    const { exec, calls } = both(PNG_BYTES);
    await new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: WDA_NO_TREE }).screenshot();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^xcrun simctl io AAAA-1111 screenshot \S+screen\.png$/);
  });

  it('keeps `simctl io screenshot` with AVERI_IOS_SCREENSHOT=simctl — read once, when the adapter is made', async () => {
    vi.stubEnv('AVERI_IOS_SCREENSHOT', 'simctl');
    const { exec, calls } = both(PNG_BYTES);
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: NO_TREE });
    vi.stubEnv('AVERI_IOS_SCREENSHOT', undefined);
    await adapter.screenshot();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^xcrun simctl io AAAA-1111 screenshot /);
    // …and set after an adapter is made, it changes nothing for that adapter: one source for its whole life.
    const later = both(PNG_BYTES);
    const made = new IosAdapter({ udid: 'AAAA-1111', exec: later.exec, treeSource: NO_TREE });
    vi.stubEnv('AVERI_IOS_SCREENSHOT', 'simctl');
    await made.screenshot();
    expect(later.calls).toEqual(['idb screenshot - --udid AAAA-1111']);
  });

  it('refuses bytes that are no PNG, naming the idb command, the companion and `idb list-targets`', async () => {
    const { exec } = both(Buffer.alloc(0));
    await expect(new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: NO_TREE }).screenshot()).rejects.toThrow(
      '`idb screenshot - --udid AAAA-1111` on simulator AAAA-1111 returned 0 bytes — not a PNG, though the command ' +
        'reported success: the device transport failed (a dying or hung emulator / simulator), not the app\'s screen. ' +
        'Check that its idb companion (idb_companion) is running and that `idb list-targets` lists the simulator as Booted; ' +
        'if it repeats, set AVERI_IOS_SCREENSHOT=simctl to capture through simctl, or ' +
        'reboot the simulator (`xcrun simctl shutdown AAAA-1111 && xcrun simctl boot AAAA-1111`).',
    );
    const foreign = both(Buffer.from('Traceback (most recent call last)'));
    await expect(new IosAdapter({ udid: 'AAAA-1111', exec: foreign.exec, treeSource: NO_TREE }).screenshot()).rejects.toThrow(
      /^`idb screenshot - --udid AAAA-1111` on simulator AAAA-1111 returned 33 bytes starting "Traceback/,
    );
  });

  it('does NOT fall back to simctl when idb fails — the idb error is the answer', async () => {
    const { exec, calls } = both(new Error('Command failed (exit 1): idb screenshot - --udid AAAA-1111\nFailed to connect to companion'));
    await expect(new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: NO_TREE }).screenshot()).rejects.toThrow(/Failed to connect to companion/);
    expect(calls).toEqual(['idb screenshot - --udid AAAA-1111']);
  });

  it('puts the remedy on the FIRST line of a failed or timed-out idb capture — the line every capture caller quotes', async () => {
    const failed = both(new ExecError('idb screenshot - --udid AAAA-1111', 1, 'Failed to connect to companion'));
    const got = await new IosAdapter({ udid: 'AAAA-1111', exec: failed.exec, treeSource: NO_TREE }).screenshot().catch((e: unknown) => e);
    const remedy =
      ' — check that its idb companion (idb_companion) is running and that `idb list-targets` lists the simulator as Booted; ' +
      'if it repeats, set AVERI_IOS_SCREENSHOT=simctl to capture through simctl';
    expect(captureRefusal(got)).toBe('Command failed (exit 1): idb screenshot - --udid AAAA-1111' + remedy);
    expect((got as Error).message).toBe('Command failed (exit 1): idb screenshot - --udid AAAA-1111' + remedy + '\nFailed to connect to companion');
    expect((got as Error).cause).toBeInstanceOf(ExecError);
    const timedOut = both(new ExecError('idb screenshot - --udid AAAA-1111', null, '', true));
    const late = await new IosAdapter({ udid: 'AAAA-1111', exec: timedOut.exec, treeSource: NO_TREE }).screenshot().catch((e: unknown) => e);
    expect(captureRefusal(late)).toBe('Command timed out: idb screenshot - --udid AAAA-1111' + remedy);
  });

  it('nor when idb answers bytes that are no PNG', async () => {
    const { exec, calls } = both(Buffer.from('nope'));
    await expect(new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: NO_TREE }).screenshot()).rejects.toThrow(/not a PNG/);
    expect(calls).toEqual(['idb screenshot - --udid AAAA-1111']);
  });

  it('gives the capture 15 s, as describe-all', async () => {
    const timeouts: (number | undefined)[] = [];
    const exec: ExecFn = async (cmd, args, opts): Promise<ExecResult> => {
      if (cmd === 'idb') timeouts.push(opts?.timeoutMs);
      return { stdout: cmd === 'idb' ? PNG_BYTES : Buffer.alloc(0), stderr: '' };
    };
    await new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: NO_TREE }).screenshot();
    expect(timeouts).toEqual([15_000]);
  });
});

// D24 (2026-10-31, docs/adr/0023-fill-types-a-dropped-tail-again.md, amendment): once a fill has seen an app's field
// drop the tail of a typing (noteDroppedTail), later typings into that app send the first character alone, wait
// FIRST_KEY_ALONE_MS, then the rest — measured 15/15 whole where one burst kept 5/15. The wait is pinned as a literal
// (50 ms since the ADR's D25 amendment: any pause of ~50 ms after the first key landed the rest; 150 bought nothing).
describe('IosAdapter.typeText — the first key alone, on an app seen dropping a tail', () => {
  beforeEach(() => {
    resetSleeps();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  /** The idb text calls, each after the sleeps recorded before it — the order of keys and waits; `log()` drains it. */
  function typingLog() {
    const log: (string | number)[] = [];
    const fn: ExecFn = async (cmd, args) => {
      const full = [cmd, ...args].join(' ');
      if (full.startsWith('idb ui text')) {
        log.push(...sleeps.splice(0), full);
      }
      return { stdout: Buffer.alloc(0), stderr: '' };
    };
    return { fn, log: () => [...log.splice(0), ...sleeps.splice(0)] };
  }

  it('after a dropped tail in the launched app, the next typing sends the first character, waits 50 ms, then the rest', async () => {
    const { fn, log } = typingLog();
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE });
    await adapter.launch('com.lab.rn');
    resetSleeps();
    adapter.noteDroppedTail();
    await adapter.typeText('Jan Novak');
    expect(log()).toEqual(['idb ui text --udid AAAA-1111 -- J', 50, 'idb ui text --udid AAAA-1111 -- an Novak']);
    expect(FIRST_KEY_ALONE_MS).toBe(50);
  });

  it('sticky per app: another app launched after the drop types in one burst; back in the app that dropped, it splits again', async () => {
    const { fn, log } = typingLog();
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE });
    await adapter.launch('com.lab.rn');
    adapter.noteDroppedTail();
    await adapter.launch('com.lab.native');
    resetSleeps();
    await adapter.typeText('Jan');
    expect(log()).toEqual(['idb ui text --udid AAAA-1111 -- Jan']);
    await adapter.launch('com.lab.rn');
    resetSleeps();
    await adapter.typeText('Jan');
    expect(log()).toEqual(['idb ui text --udid AAAA-1111 -- J', 50, 'idb ui text --udid AAAA-1111 -- an']);
  });

  it('terminating the launched app forgets which app is in front: no split, and nothing learned, until the next launch', async () => {
    const { fn, log } = typingLog();
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE });
    adapter.noteDroppedTail(); // the app in front before any launch dropped a tail
    await adapter.launch('com.lab.rn');
    adapter.noteDroppedTail();
    await adapter.terminate('com.lab.other'); // another bundle: the key stays
    resetSleeps();
    await adapter.typeText('Jan');
    expect(log()).toEqual(['idb ui text --udid AAAA-1111 -- J', 50, 'idb ui text --udid AAAA-1111 -- an']);
    await adapter.terminate('com.lab.rn');
    adapter.noteDroppedTail(); // not known what is in front: nothing to learn
    await adapter.typeText('Jan');
    expect(log()).toEqual(['idb ui text --udid AAAA-1111 -- Jan']);
    await adapter.launch('com.lab.rn');
    resetSleeps();
    await adapter.typeText('Jan');
    expect(log()).toEqual(['idb ui text --udid AAAA-1111 -- J', 50, 'idb ui text --udid AAAA-1111 -- an']);
  });

  it('an app never seen dropping a tail types in one burst, with no wait — native apps never pay', async () => {
    const { fn, log } = typingLog();
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE });
    await adapter.launch('com.lab.rn');
    resetSleeps();
    await adapter.typeText('Jan Novak');
    expect(log()).toEqual(['idb ui text --udid AAAA-1111 -- Jan Novak']);
  });

  it('a one-character text has no rest: one call, no wait, even in an app that dropped', async () => {
    const { fn, log } = typingLog();
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE });
    await adapter.launch('com.lab.rn');
    adapter.noteDroppedTail();
    resetSleeps();
    await adapter.typeText('J');
    await adapter.typeText('👍');
    expect(log()).toEqual(['idb ui text --udid AAAA-1111 -- J', 'idb ui text --udid AAAA-1111 -- 👍']);
  });

  it('the first key is a whole character: a surrogate pair is never cut between the two calls', async () => {
    const { fn, log } = typingLog();
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: NO_TREE });
    adapter.noteDroppedTail(); // before any launch: the app in front, whichever it is
    await adapter.typeText('👍ok');
    expect(log()).toEqual(['idb ui text --udid AAAA-1111 -- 👍', 50, 'idb ui text --udid AAAA-1111 -- ok']);
  });
});

// D43 (docs/adr/0037-a-value-the-adapter-cannot-type-is-refused-before-any-device-call.md, the D43 amendment): over a
// tree source that types (IosTreeSource.typeText: WDA's), each typeText is routed by its own characters — idb for every
// text idb can type, unchanged (the D24 split included); WebDriverAgent's `/wda/keys`, whole, for any other.
describe('IosAdapter.typeText — routed per call: idb for what idb types, the source\'s typer for the rest (D43)', () => {
  beforeEach(() => {
    resetSleeps();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  /** A WDA-kind source with a typer, and an exec, both recording into one log — the order of idb calls, waits and WDA typings. */
  function routed() {
    const log: (string | number)[] = [];
    const fn: ExecFn = async (cmd, args) => {
      const full = [cmd, ...args].join(' ');
      if (full.startsWith('idb ui text')) log.push(...sleeps.splice(0), full);
      return { stdout: Buffer.alloc(0), stderr: '' };
    };
    const source: IosTreeSource = {
      ...WDA_NO_TREE,
      typeText: async (text: string) => {
        log.push(...sleeps.splice(0), `wda ${text}`);
      },
    };
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: source });
    return { adapter, log: () => [...log.splice(0), ...sleeps.splice(0)] };
  }

  it('an ASCII text goes to idb ui text and never to the source\'s typer', async () => {
    const { adapter, log } = routed();
    await adapter.typeText('Jan Novak');
    expect(log()).toEqual(['idb ui text --udid AAAA-1111 -- Jan Novak']);
  });

  it('a text idb cannot type goes to the source\'s typer once, whole, and no idb ui text is sent', async () => {
    const { adapter, log } = routed();
    await adapter.typeText('Jan Šťastný');
    expect(log()).toEqual(['wda Jan Šťastný']);
  });

  it('one character outside idb\'s set is enough: the whole text goes to WDA, never split between the two', async () => {
    const { adapter, log } = routed();
    await adapter.typeText('O’Brien');
    expect(log()).toEqual(['wda O’Brien']);
  });

  it('"" types nothing on either path', async () => {
    const { adapter, log } = routed();
    await adapter.typeText('');
    expect(log()).toEqual([]);
  });

  it('in an app seen dropping a tail: ASCII still splits on idb (D24); the WDA path sends one call, with no FIRST_KEY_ALONE_MS wait', async () => {
    const { adapter, log } = routed();
    await adapter.launch('com.lab.rn');
    adapter.noteDroppedTail();
    resetSleeps();
    await adapter.typeText('Jan Novak');
    expect(log()).toEqual(['idb ui text --udid AAAA-1111 -- J', FIRST_KEY_ALONE_MS, 'idb ui text --udid AAAA-1111 -- an Novak']);
    await adapter.typeText('Jan Šťastný');
    expect(log()).toEqual(['wda Jan Šťastný']);
  });

  it('over a source without a typer (idb\'s, the recorded one), a non-ASCII text still goes to idb — as before D43', async () => {
    const { fn, calls } = fakeExec({});
    await new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: WDA_NO_TREE }).typeText('Šťastný');
    expect(calls.at(-1)?.full).toBe('idb ui text --udid AAAA-1111 -- Šťastný');
  });

  it('a failure of the source\'s typer is the typing\'s failure, as WDA said it', async () => {
    const source: IosTreeSource = { ...WDA_NO_TREE, typeText: () => Promise.reject(new Error('WDA /wda/keys failed: HTTP 500')) };
    const { fn, calls } = fakeExec({});
    await expect(new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: source }).typeText('Šťastný')).rejects.toThrow('WDA /wda/keys failed: HTTP 500');
    expect(calls).toEqual([]);
  });
});

// D24 end to end: interact/fill.ts reports what the field showed, the adapter decides how it types — through the real
// IosAdapter, idb faked: an RN-like field that keeps only the first `keep` characters of each `idb ui text` burst.
describe('IosAdapter + fillField — a dropped tail on one fill makes the next fill into that app send its first key alone', () => {
  beforeEach(() => {
    resetSleeps();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  /** The lab's rn-field on a fake simulator: each `idb ui text` lands the first keeps.shift() characters (all, when none is left). */
  function rnLab(...keeps: number[]) {
    resetLayout();
    const field = el({ role: 'textfield', identifier: 'rn-field', value: null });
    const tree = screen(field);
    const texts: (string | number)[] = [];
    const fn: ExecFn = async (cmd, args) => {
      const full = [cmd, ...args].join(' ');
      if (full.startsWith('idb ui text ')) {
        const text = args.at(-1)!; // `ui text --udid U -- <text>` (D74)
        texts.push(...sleeps.splice(0).filter((ms) => ms === FIRST_KEY_ALONE_MS), text);
        field.value = (field.value ?? '') + text.slice(0, keeps.shift() ?? text.length);
      }
      return { stdout: Buffer.alloc(0), stderr: '' };
    };
    const source: IosTreeSource = {
      kind: 'idb',
      read: async () => structuredClone(tree),
      applicationLabel: async () => ({ kind: 'declined' }),
      dispose: () => Promise.resolve(),
    };
    const adapter = new IosAdapter({ udid: 'AAAA-1111', exec: fn, treeSource: source });
    /** The texts idb typed since the last call, with the 50-ms first-key wait where it fell; then the field emptied. */
    const typed = () => {
      const out = texts.splice(0);
      field.value = null;
      return out;
    };
    return { adapter, typed };
  }

  it('fill 1 keeps a prefix and gets its tail typed again; fill 2 into the same app: the first character, 50 ms, the rest', async () => {
    const { adapter, typed } = rnLab(3);
    await adapter.launch('com.lab.rn');
    const first = await fillField(adapter, { id: 'rn-field' }, 'Jan Novak', FAST);
    expect(first.retyped).toEqual([6]);
    expect(typed()).toEqual(['Jan Novak', ' Novak']); // fill 1 as before D24: one burst, then the tail
    const second = await fillField(adapter, { id: 'rn-field' }, 'Jan Novak', FAST);
    expect(second.retyped).toBeUndefined();
    expect(typed()).toEqual(['J', FIRST_KEY_ALONE_MS, 'an Novak']);
  });

  it('a split fill that still drops still gets its tail typed again — ADR 0023\'s retype stays the safety net', async () => {
    const { adapter, typed } = rnLab(3, 6, 1, 4); // fill 1: `Jan`, its tail whole; fill 2: `J`, then 4 of the rest
    await adapter.launch('com.lab.rn');
    await fillField(adapter, { id: 'rn-field' }, 'Jan Novak', FAST);
    typed();
    const second = await fillField(adapter, { id: 'rn-field' }, 'Jan Novak', FAST);
    expect(second.retyped).toEqual([4]);
    // The split's rest kept 4 of 8 (`an N`): the tail `ovak` typed again — itself split, as every typing into this app.
    expect(typed()).toEqual(['J', FIRST_KEY_ALONE_MS, 'an Novak', 'o', FIRST_KEY_ALONE_MS, 'vak']);
  });

  // D28 code review: a flow's `type:` (and `type_text` without a selector) is blind, but types through the same adapter —
  // after a fill reported the app's drop, it too sends its first key alone (ADR 0034's D28 amendment, rf4).
  it('after a fill reported a drop, a flow\'s blind `type:` into that app sends its first key alone too', async () => {
    const { adapter, typed } = rnLab(3);
    await adapter.launch('com.lab.rn');
    await fillField(adapter, { id: 'rn-field' }, 'Jan Novak', FAST);
    typed();
    await typeIntoFocused(adapter, 'SK3112000000');
    expect(typed()).toEqual(['S', FIRST_KEY_ALONE_MS, 'K3112000000']);
  });

  // D24 review: a native field capped at 5 characters keeps `Jan N` for good; its fill fails after one retype that
  // moved nothing, and the app is not marked — the next fill is one burst.
  it('a capped field\'s failed fill marks nothing: the next fill into that app is one burst', async () => {
    const { adapter, typed } = rnLab(5, 0);
    await adapter.launch('com.lab.native');
    await expect(fillField(adapter, { id: 'rn-field' }, 'Jan Novak', FAST)).rejects.toThrow(/but the field shows 5/);
    expect(typed()).toEqual(['Jan Novak', 'ovak']);
    await fillField(adapter, { id: 'rn-field' }, 'Jan', FAST);
    expect(typed()).toEqual(['Jan']);
  });

  it('a fill into another app after the drop types in one burst', async () => {
    const { adapter, typed } = rnLab(3);
    await adapter.launch('com.lab.rn');
    await fillField(adapter, { id: 'rn-field' }, 'Jan Novak', FAST);
    typed();
    await adapter.launch('com.lab.native');
    await fillField(adapter, { id: 'rn-field' }, 'Jan Novak', FAST);
    expect(typed()).toEqual(['Jan Novak']);
  });
});

describe('IosAdapter.isAppRunning — the host process list first, a no confirmed by launchctl (D33, ADR 0039)', () => {
  const UDID = 'AAAA-1111';
  const BUNDLE = 'com.x.app';
  const PATH = `/Users/me/Library/Developer/CoreSimulator/Devices/${UDID}/data/Containers/Bundle/Application/G-1/Runner.app`;
  const INFO = appinfo(undefined, 'Runner', { path: PATH, executable: 'Runner' });
  const PATTERN = `/Users/me/Library/Developer/CoreSimulator/Devices/${UDID}/data/Containers/Bundle/Application/G-1/Runner\\.app/Runner( |$)`;
  const LISTED = `PID\tStatus\tLabel\n123\t0\tUIKitApplication:${BUNDLE}[0x1a2b][rb-legacy]\n`;
  const NOT_LISTED = 'PID\tStatus\tLabel\n1\t0\tcom.apple.springboard\n';
  const fail = (cmd: string, code: number | null, stderr = '', timedOut = false) => execErrorLikeExec(cmd, code, stderr, { timedOut });

  type Answer = string | Error;
  /** An exec answering per command prefix in turn (the last answer repeats); every command line is recorded. */
  function device(answers: { appinfo?: Answer[]; pgrep?: Answer[]; launchctl?: Answer[] }) {
    const calls: string[] = [];
    const turn: Record<string, number> = {};
    const next = (key: 'appinfo' | 'pgrep' | 'launchctl', fallback: Answer): Answer => {
      const list = answers[key] ?? [fallback];
      const i = turn[key] ?? 0;
      turn[key] = i + 1;
      return list[Math.min(i, list.length - 1)];
    };
    const fn: ExecFn = async (cmd, args, opts): Promise<ExecResult> => {
      const full = [cmd, ...args].join(' ');
      if (full.startsWith('xcrun --find')) return { stdout: Buffer.alloc(0), stderr: '' }; // xcode-env's one-time probe
      calls.push(full);
      let a: Answer = '';
      if (full.startsWith(`xcrun simctl appinfo ${UDID} `)) a = next('appinfo', INFO);
      else if (cmd === '/usr/bin/pgrep') {
        expect(args).toEqual(['-f', expect.any(String)]);
        expect(opts?.timeoutMs).toBe(PGREP_TIMEOUT_MS);
        a = next('pgrep', '');
      } else if (full.startsWith(`xcrun simctl spawn ${UDID} launchctl list`)) a = next('launchctl', LISTED);
      if (a instanceof Error) throw a;
      return { stdout: Buffer.from(a), stderr: '' };
    };
    const adapter = new IosAdapter({ udid: UDID, exec: fn, treeSource: NO_TREE });
    const count = (prefix: string) => calls.filter((c) => c.startsWith(prefix)).length;
    return {
      adapter,
      calls,
      appinfos: () => count('xcrun simctl appinfo'),
      pgreps: () => count('/usr/bin/pgrep'),
      launchctls: () => count(`xcrun simctl spawn ${UDID} launchctl`),
    };
  }

  let stderr: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("pgrep's budget is 5 s", () => {
    expect(PGREP_TIMEOUT_MS).toBe(5_000);
  });

  it('running: one appinfo, one pgrep of the exact path, no launchctl — and a second check is pgrep alone', async () => {
    const d = device({});
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true);
    expect(d.calls).toEqual([`xcrun simctl appinfo ${UDID} ${BUNDLE}`, `/usr/bin/pgrep -f ${PATTERN}`]);
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true);
    expect(d.calls.slice(2)).toEqual([`/usr/bin/pgrep -f ${PATTERN}`]);
    expect(stderr).not.toHaveBeenCalled();
  });

  it('pgrep finds nothing but launchctl lists the app: running — and the stale path is dropped (appinfo asked again)', async () => {
    const d = device({ pgrep: [fail('pgrep', 1), ''] });
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true);
    expect(d.launchctls()).toBe(1);
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true);
    expect(d.appinfos()).toBe(2);
    expect(d.launchctls()).toBe(1);
  });

  it('pgrep finds nothing and launchctl agrees: not running — the path stays cached', async () => {
    const d = device({ pgrep: [fail('pgrep', 1)], launchctl: [NOT_LISTED] });
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(false);
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(false);
    expect(d.appinfos()).toBe(1);
    expect(d.pgreps()).toBe(2);
    expect(d.launchctls()).toBe(2);
  });

  it('appinfo fails: launchctl decides, no pgrep — and the next check asks appinfo again', async () => {
    const d = device({ appinfo: [new Error('appinfo timed out')] });
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true);
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true);
    expect(d.appinfos()).toBe(2);
    expect(d.pgreps()).toBe(0);
  });

  it('an unreadable process list (pgrep exit 3): launchctl now and for the adapter\'s life, said once on stderr', async () => {
    const d = device({ pgrep: [fail('/usr/bin/pgrep -f x', 3, 'sysmon request failed with error: sysmond service not found\n')] });
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true);
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true);
    expect(d.pgreps()).toBe(1);
    expect(d.appinfos()).toBe(1);
    expect(d.launchctls()).toBe(2);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0][0])).toMatch(
      new RegExp(`^averi: the host process list is unreadable \\(exit 3: sysmon request failed with error: sysmond service not found\\) — app liveness on ${UDID} asks launchctl instead`),
    );
  });

  it('that line asks the host\'s home: the adapter hands it to the pure leaf', async () => {
    vi.stubEnv('HOME', '/opt/me');
    try {
      const d = device({ pgrep: [fail('/usr/bin/pgrep -f x', 3, 'pgrep: https://h/opt/me/x\n')] });
      await d.adapter.isAppRunning(BUNDLE);
      expect(String(stderr.mock.calls[0][0])).toContain('(exit 3: pgrep: https://h~/x)');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('a spawn failure of pgrep is an unreadable list too', async () => {
    const d = device({ pgrep: [fail('/usr/bin/pgrep -f x', null, 'spawn /usr/bin/pgrep EPERM')] });
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true);
    await d.adapter.isAppRunning(BUNDLE);
    expect(d.pgreps()).toBe(1);
    expect(String(stderr.mock.calls[0][0])).toContain('(spawn /usr/bin/pgrep EPERM)');
  });

  it('pgrep timed out: launchctl decides this check, and the next check asks pgrep again — nothing on stderr', async () => {
    const d = device({ pgrep: [fail('pgrep', null, '', true), ''], launchctl: [NOT_LISTED] });
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(false);
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true);
    expect(d.pgreps()).toBe(2);
    expect(d.launchctls()).toBe(1);
    expect(d.appinfos()).toBe(1);
    expect(stderr).not.toHaveBeenCalled();
  });

  it('pgrep finds nothing and launchctl cannot be asked: the check rejects (appHealth\'s `unknown`), never false', async () => {
    const d = device({ pgrep: [fail('pgrep', 1)], launchctl: [fail('xcrun simctl spawn', null, '', true)] });
    await expect(d.adapter.isAppRunning(BUNDLE)).rejects.toThrow(/timed out/);
  });

  it('launchctl matches the bundle id exactly: com.x.app.dev running is not com.x.app (a verdict change, ADR 0039)', async () => {
    const d = device({ pgrep: [fail('pgrep', 1)], launchctl: ['123\t0\tUIKitApplication:com.x.app.dev[0x1][rb-legacy]\n'] });
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(false);
  });

  it('a Path outside this simulator\'s bundle containers (a system app): launchctl, no pgrep', async () => {
    const system = appinfo(undefined, 'Contacts', { path: '/Library/Developer/CoreSimulator/RuntimeRoot/Applications/Contacts.app' });
    const d = device({ appinfo: [system] });
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true);
    expect(d.pgreps()).toBe(0);
    expect(d.launchctls()).toBe(1);
  });

  it('a user app whose appinfo lists no name: pgrep still answers, and the answer is cached (appinfo asked once)', async () => {
    const d = device({ appinfo: [appinfo(undefined, undefined, { path: PATH, executable: 'Runner' })] });
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true);
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true);
    expect(d.appinfos()).toBe(1);
    expect(d.pgreps()).toBe(2);
    expect(d.launchctls()).toBe(0);
  });

  it('pgrep no / launchctl yes twice in a row, even after a fresh appinfo: launchctl alone for that bundle from then on, said once', async () => {
    const d = device({ pgrep: [fail('pgrep', 1)] });
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true);
    expect(stderr).not.toHaveBeenCalled();
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true);
    expect([d.appinfos(), d.pgreps(), d.launchctls()]).toEqual([2, 2, 2]);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0][0])).toBe(
      `averi: the host process list and launchctl disagree 2 times in a row on ${BUNDLE} (pgrep: not running; launchctl: running) — ` +
        `its liveness on ${UDID} asks launchctl alone from now on (~240 ms a check)`,
    );
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true);
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true);
    expect([d.appinfos(), d.pgreps(), d.launchctls()]).toEqual([2, 2, 4]);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(await d.adapter.isAppRunning('com.y.app')).toBe(false); // another bundle still asks pgrep
    expect(d.pgreps()).toBe(3);
  });

  it('a disagreement between agreements is not "in a row": pgrep stays in use', async () => {
    const no = fail('pgrep', 1);
    const d = device({ pgrep: [no, '', no, no, no, no], launchctl: [LISTED, LISTED, NOT_LISTED, LISTED, LISTED] });
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true); // disagree
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true); // pgrep yes: agreement
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true); // disagree — one in a row
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(false); // both no: agreement
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true); // disagree — one in a row
    expect(await d.adapter.isAppRunning(BUNDLE)).toBe(true); // disagree — two: now launchctl alone
    expect(d.pgreps()).toBe(6);
    expect(stderr).toHaveBeenCalledTimes(1);
  });

  it('install() forgets every bundle\'s appinfo: the next check asks it again', async () => {
    const d = device({});
    await d.adapter.isAppRunning(BUNDLE);
    await d.adapter.install('/tmp/App.app');
    await d.adapter.isAppRunning(BUNDLE);
    expect(d.appinfos()).toBe(2);
  });

  it('install() also forgets the disagreements: a count in progress and a bundle given over to launchctl', async () => {
    const d = device({ pgrep: [fail('pgrep', 1)] });
    await d.adapter.isAppRunning(BUNDLE); // one disagreement
    await d.adapter.install('/tmp/App.app');
    await d.adapter.isAppRunning(BUNDLE); // one again, not two
    expect(stderr).not.toHaveBeenCalled();
    await d.adapter.isAppRunning(BUNDLE); // two: launchctl alone
    expect(stderr).toHaveBeenCalledTimes(1);
    await d.adapter.install('/tmp/App.app');
    await d.adapter.isAppRunning(BUNDLE);
    expect(d.pgreps()).toBe(4);
  });

  it('a name-less, Path-less appinfo answer (maybe not installed) is asked again on the next check', async () => {
    const d = device({ appinfo: [''] });
    await d.adapter.isAppRunning(BUNDLE);
    await d.adapter.isAppRunning(BUNDLE);
    expect(d.appinfos()).toBe(2);
  });
});

describe('openDeepLink when simctl answers (D65)', () => {
  const failing = (stderr: string, exitCode: number): ExecFn => async (cmd, args) => {
    if (args.includes('openurl')) throw new ExecError([cmd, ...args].join(' '), exitCode, stderr);
    return { stdout: Buffer.alloc(0), stderr: '' };
  };
  const TEL_STDERR = readFileSync(new URL('../fixtures/simctl-openurl-tel-exit115-b13-stderr.txt', import.meta.url), 'utf8');

  it('code 115 throws the fact, with no trace and no argv in the reply', async () => {
    const opening = new IosAdapter({ udid: 'AAAA-1111', exec: failing(TEL_STDERR, 115), treeSource: NO_TREE }).openDeepLink('tel:+421900123456');
    await expect(opening).rejects.toBeInstanceOf(NoLinkHandlerError);
    await expect(opening).rejects.toThrow(
      /^No app on this simulator handles tel: links, so nothing opened \(simctl openurl: LSApplicationWorkspaceErrorDomain, code 115\)\. A link to an app's own scheme needs that app installed\.$/,
    );
  });

  it('any other simctl failure stays exec\'s error, to the byte', async () => {
    const opening = new IosAdapter({ udid: 'AAAA-1111', exec: failing('Unable to lookup in current state: Shutdown\n', 149), treeSource: NO_TREE }).openDeepLink('tel:1');
    await expect(opening).rejects.toBeInstanceOf(ExecError);
    await expect(opening).rejects.toThrow(/^Command failed \(exit 149\): xcrun simctl openurl AAAA-1111 tel:1\nUnable to lookup in current state: Shutdown$/);
  });
});

describe('a failed typing keeps its text out of the error (D70, A17, ADR 0043)', () => {
  const secret = 'hunter2secret';
  /** An exec that fails `ui text` as exec does: its command shown with the typed words the call declared (ExecOptions.typed). */
  const failingText = (stderr: string): ExecFn => async (cmd, args, opts) => {
    if (args[1] === 'text') throw typingExecError(cmd, args, opts?.typed, 1, stderr);
    return { stdout: Buffer.alloc(0), stderr: '' };
  };

  it('the whole text on idb: neither the command field nor the message holds it', async () => {
    const typing = new IosAdapter({ udid: 'AAAA-1111', exec: failingText('companion gone\n'), treeSource: NO_TREE }).typeText(secret);
    await expect(typing).rejects.toThrow(/^Command failed \(exit 1\): idb ui text --udid AAAA-1111 -- <typed text>\ncompanion gone$/);
    await expect(typing).rejects.toMatchObject({ command: 'idb ui text --udid AAAA-1111 -- <typed text>' });
  });

  it("a reader's `.message` of a crash during a typing shows neither the text nor the trace", async () => {
    const exec = failingText('Traceback (most recent call last):\n  File "/Users/me/x.py", line 1, in m\nException: gone\n');
    await expect(new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: NO_TREE }).typeText(secret)).rejects.toThrow(
      /^Command failed \(exit 1\): idb ui text --udid AAAA-1111 -- <typed text>\nidb crashed: Exception: gone \(Python traceback left out: run the command by hand, with the real text and paths, to see it\)$/,
    );
  });
});
