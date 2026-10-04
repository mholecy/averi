import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, Platform, UiNode } from '../../src/adapters/types.js';
import { AdapterRegistry, type AdapterFactory } from '../../src/mcp/registry.js';
import { createAveriServer } from '../../src/mcp/tools.js';
import { el, FakeAdapter, resetLayout, screen } from '../helpers/fake.js';
import { TOOL_NAMES } from '../helpers/tool-names.js';

/**
 * The MCP layer through its interface: every call here goes client →
 * in-memory transport → the real McpServer → the registered handler, so what
 * is pinned is what an MCP client sees (tool names, response content,
 * `isError`), not how a handler is written. The one seam used is the
 * registry's AdapterFactory; averi.yaml and contract files are real files in
 * a temp dir, passed as `configPath`/`contract` the way a user passes them.
 *
 * Why these and not all 18 tools: each test below is a decision the handler
 * makes that no lower layer can make for it — which ambiguity mode, a
 * settled frame rather than a bare screenshot, when the config is consulted
 * and when its absence or invalidity is tolerated, what is loaded before a
 * device is touched. The one-line delegations (terminate_app, press_key, …)
 * are pinned only by name in the vocabulary test.
 */

// The one sleep owner (util/sleep.ts) is recorded, not waited on — as in
// tests/verify/capture.test.ts. Yields a macrotask so a deadline loop on
// Date.now still advances and nothing spins.
const { sleeps } = vi.hoisted(() => ({ sleeps: [] as number[] }));
vi.mock('../../src/util/sleep.js', () => ({
  sleep: async (ms: number) => {
    sleeps.push(ms);
    await new Promise((r) => setTimeout(r, 0));
  },
}));

let dir: string;
const closers: (() => Promise<void>)[] = [];
beforeEach(async () => {
  sleeps.length = 0;
  resetLayout();
  dir = await mkdtemp(join(tmpdir(), 'averi-tools-'));
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  await rm(dir, { recursive: true, force: true });
});

const booted = (platform: Platform): Device => ({
  id: `${platform}-1`,
  platform,
  name: `${platform} device`,
  osVersion: '1',
  state: 'booted',
});

/**
 * A server built by the module under test, over a registry whose factory
 * hands out the test's fakes, connected to a real SDK client in memory.
 * `factoryCalls` records every adapter the registry asked for — probes
 * (no deviceId) included — which is how "no device was touched" is asserted.
 *
 * Without arguments both platforms get a `home()` device, returned as
 * `fakes`; a test that needs a particular screen passes its own.
 */
async function connect(
  fakes: Partial<Record<Platform, FakeAdapter>> = { android: home(), ios: home() },
  version = '0.0.0-test',
) {
  const factoryCalls: { platform: Platform; deviceId?: string; treeSource?: string }[] = [];
  const factory: AdapterFactory = (platform, deviceId, opts) => {
    factoryCalls.push({ platform, deviceId, treeSource: opts?.treeSource });
    if (deviceId === undefined) {
      const probe = new FakeAdapter({}, 'none');
      probe.listDevices = async () => [booted(platform)];
      return probe;
    }
    const fake = fakes[platform];
    if (fake === undefined) throw new Error(`test harness: no ${platform} fake`);
    fake.platform = platform;
    return fake;
  };
  const server = createAveriServer({ registry: new AdapterRegistry(factory), version });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'tools-test', version: '0' });
  await client.connect(clientSide);
  closers.push(async () => {
    await client.close();
    await server.close();
  });

  type Content = { type: string; text?: string; data?: string; mimeType?: string };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Content[];
    return {
      isError: result.isError === true,
      text: content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'),
      images: content.filter((c) => c.type === 'image').map((c) => Buffer.from(c.data ?? '', 'base64')),
      /** The content blocks IN ORDER, as `[type]` or `[type, mimeType]` — `text` and `images` above lose the order. */
      shape: content.map((c) => (c.mimeType === undefined ? [c.type] : [c.type, c.mimeType])),
    };
  };
  /** The adapters the registry BOUND to a device (probes excluded), in order. */
  const bound = () => factoryCalls.filter((c) => c.deviceId !== undefined);
  return { client, call, factoryCalls, bound, fakes };
}

/** Writes a file into the test's temp dir and returns its absolute path. */
async function file(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

const missing = () => join(dir, 'no-such-averi.yaml');
const validConfig = () => file('averi.yaml', VALID_CONFIG);
const invalidConfig = () => file('averi.yaml', INVALID_CONFIG);

const VALID_CONFIG = `
app:
  android: { package: md.bank.app, activity: .MainActivity }
  ios:     { bundleId: md.bank.app }
credentials:
  username: plain-user
environments:
  staging:
    credentials:
      username: staging-user
states:
  home:
    detect: { element: { id: home_root } }
flows:
  touch_home:
    steps:
      - tap: { id: home_root }
`;

/** Present, and not a config: `app` is required. */
const INVALID_CONFIG = 'flows: 12\n';

const homeScreen = (): Record<string, UiNode> => ({
  home: screen(el({ role: 'container', identifier: 'home_root' })),
});
const home = () => new FakeAdapter(homeScreen(), 'home');

const frame = (tag: string): Buffer => Buffer.from(`frame:${tag}`);

/** Successive screenshots come from a queue; the last one repeats. */
function withFrames(fake: FakeAdapter, frames: Buffer[]): FakeAdapter {
  let i = 0;
  fake.screenshot = async () => {
    const shot = frames[Math.min(i++, frames.length - 1)];
    fake.screenshots.push(shot);
    return shot;
  };
  return fake;
}

describe('the server itself', () => {
  // A sentinel, so this is the pass-through alone. That the ENTRY hands over
  // package.json's version (it once reported 0.0.1 for every release) is
  // tests/mcp/server.test.ts's, against the real process.
  it('reports the version it was built with in serverInfo', async () => {
    const { client } = await connect({}, '9.9.9-test');
    expect(client.getServerVersion()).toMatchObject({ name: 'averi', version: '9.9.9-test' });
  });

  it('lists the 18 documented tools — the tool vocabulary', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    expect(TOOL_NAMES).toHaveLength(18);
  });
});

describe('tap and type_text refuse an ambiguous selector', () => {
  it('tap: two interactive matches → an error listing both, and nothing is tapped', async () => {
    const fake = new FakeAdapter(
      {
        s: screen(
          el({ role: 'button', identifier: 'dup', label: 'A' }),
          el({ role: 'button', identifier: 'dup', label: 'B' }),
        ),
      },
      's',
    );
    const { call } = await connect({ android: fake });
    const result = await call('tap', { platform: 'android', selector: 'id:dup', configPath: missing() });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Selector matches 2 elements: id:dup');
    expect(result.text).toContain('button id=dup label="A"');
    expect(result.text).toContain('button id=dup label="B"');
    expect(fake.taps).toEqual([]);
  });

  it('type_text: two textfields → an error listing both, nothing focused and nothing typed', async () => {
    const fake = new FakeAdapter(
      {
        s: screen(
          el({ role: 'textfield', identifier: 'field', label: 'User' }),
          el({ role: 'textfield', identifier: 'field', label: 'Password' }),
        ),
      },
      's',
    );
    const { call } = await connect({ android: fake });
    const result = await call('type_text', {
      platform: 'android',
      selector: 'id:field',
      text: 'secret',
      configPath: missing(),
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Selector matches 2 elements: id:field');
    expect(result.text).toContain('textfield id=field label="User"');
    expect(result.text).toContain('textfield id=field label="Password"');
    expect(fake.taps).toEqual([]);
    expect(fake.typed).toEqual([]);
  });
});

describe('screenshot and ensure_state return a SETTLED frame', () => {
  it('screenshot: two differing captures, then a stable pair — the image is the stable one', async () => {
    const fake = withFrames(home(), [frame('a'), frame('b'), frame('c'), frame('c')]);
    const { call } = await connect({ android: fake });
    const result = await call('screenshot', { platform: 'android' });
    expect(result.isError).toBe(false);
    expect(result.images).toEqual([frame('c')]);
    expect(fake.screenshots).toEqual([frame('a'), frame('b'), frame('c'), frame('c')]);
  });

  it('ensure_state: the trace, the health line, and a settled image — not the first capture', async () => {
    const fake = withFrames(home(), [frame('a'), frame('b'), frame('c'), frame('c')]);
    const { call } = await connect({ android: fake });
    const result = await call('ensure_state', {
      platform: 'android',
      state: 'home',
      configPath: await validConfig(),
    });
    expect(result.isError).toBe(false);
    expect(result.text).toContain('appAlive: true');
    expect(result.images).toEqual([frame('c')]);
    expect(result.shape).toEqual([['text'], ['image', 'image/png']]); // the report first, then the frame
    expect(fake.screenshots).toEqual([frame('a'), frame('b'), frame('c'), frame('c')]);
  });
});

describe('ensure_state and run_flow — the flow tools', () => {
  it('run_flow: runs the named flow and returns its trace with the health line, as text only', async () => {
    const { call, fakes } = await connect();
    const result = await call('run_flow', { platform: 'android', flow: 'touch_home', configPath: await validConfig() });
    expect(result.isError).toBe(false);
    expect(fakes.android!.taps).toEqual(['home_root']);
    expect(result.text).toContain('home_root');
    expect(result.text).toMatch(/\nappAlive: true$/);
    expect(result.text).not.toContain('environment');
    expect(result.shape).toEqual([['text']]);
  });

  // verify takes `platforms`, the other two `platform`; each ignores the other's.
  it.each(['run_flow', 'ensure_state', 'verify'])('%s: the `environment` argument reaches the engine — the trace opens with it', async (tool) => {
    const { call } = await connect();
    const result = await call(tool, {
      platform: 'android',
      platforms: ['android'],
      flow: 'touch_home',
      state: 'home',
      environment: 'staging',
      configPath: await validConfig(),
    });
    expect(result.isError).toBe(false);
    expect(result.text).toContain('environment staging');
  });
});

describe('install_app — which build', () => {
  const installing = async (args: Record<string, unknown>) => {
    const { call, fakes } = await connect();
    const installed: string[] = [];
    fakes.android!.install = async (path: string) => {
      installed.push(path);
    };
    return { result: await call('install_app', { platform: 'android', ...args }), installed };
  };

  it('an explicit path is installed as given, and averi.yaml is never read — an INVALID one beside it is no error', async () => {
    const { result, installed } = await installing({ path: '/builds/explicit.apk', configPath: await invalidConfig() });
    expect(result.isError).toBe(false);
    expect(installed).toEqual(['/builds/explicit.apk']);
    expect(result.text).toBe('Installed /builds/explicit.apk on android');
  });

  it('an explicit path wins over the build averi.yaml names', async () => {
    const configPath = await file('averi.yaml', 'app:\n  android: { package: md.bank.app, apk: build/app.apk }\n');
    const { installed } = await installing({ path: '/builds/explicit.apk', configPath });
    expect(installed).toEqual(['/builds/explicit.apk']);
  });

  it("no path → averi.yaml's build, resolved against the config's own directory", async () => {
    const configPath = await file('averi.yaml', 'app:\n  android: { package: md.bank.app, apk: build/app.apk }\n');
    const { result, installed } = await installing({ configPath });
    expect(result.isError).toBe(false);
    expect(installed).toEqual([join(dir, 'build', 'app.apk')]);
    expect(result.text).toBe(`Installed ${join(dir, 'build', 'app.apk')} on android`);
  });

  it('no path and no build in averi.yaml → an error naming the missing key, nothing installed', async () => {
    const { result, installed } = await installing({ configPath: await validConfig() });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('No path given and averi.yaml has no app.android build path');
    expect(installed).toEqual([]);
  });
});

describe('launch_app — the entry activity', () => {
  const launch = async (
    args: Record<string, unknown>,
    { platform = 'android', configPath }: { platform?: Platform; configPath?: string } = {},
  ) => {
    const { call, fakes } = await connect();
    const result = await call('launch_app', { platform, configPath: configPath ?? (await validConfig()), ...args });
    expect(result.isError).toBe(false);
    return { launches: fakes[platform]!.launches, text: result.text };
  };

  it("android, no activity, averi.yaml describes this package → its activity, named in the response", async () => {
    const { launches, text } = await launch({ appId: 'md.bank.app' });
    expect(launches).toEqual([{ appId: 'md.bank.app', clearState: undefined, activity: '.MainActivity', intent: undefined }]);
    expect(text).toBe('Launched md.bank.app/.MainActivity on android');
  });

  it('another package → no activity: the config describes a different app', async () => {
    const { launches, text } = await launch({ appId: 'com.other.app' });
    expect(launches).toEqual([{ appId: 'com.other.app', clearState: undefined, activity: undefined, intent: undefined }]);
    expect(text).toBe('Launched com.other.app on android');
  });

  it('an explicit activity wins over the config', async () => {
    const { launches } = await launch({ appId: 'md.bank.app', activity: '.ShareActivity' });
    expect(launches[0].activity).toBe('.ShareActivity');
  });

  it('an intent alone suppresses the fallback: the launch carries the intent and no activity', async () => {
    const intent = { action: 'android.intent.action.SEND' };
    const { launches } = await launch({ appId: 'md.bank.app', intent });
    expect(launches).toEqual([{ appId: 'md.bank.app', clearState: undefined, activity: undefined, intent }]);
  });

  // 2026-10-03: one rule for both ways of launching. Until then a flow step
  // put app.android.activity beside an intent and the tool did not; what is
  // pinned is that the adapter cannot tell the two callers apart, in any of
  // the four cases — not what either hands over (the tests above and
  // tests/flow/engine.test.ts "launch step" own that).
  it.each([
    ['neither', {}, '.MainActivity'],
    ['an activity', { activity: '.ShareActivity' }, '.ShareActivity'],
    ['an intent', { intent: { action: 'android.intent.action.SEND', mimeType: 'text/plain' } }, undefined],
    ['both', { activity: '.ShareActivity', intent: { action: 'android.intent.action.SEND' } }, '.ShareActivity'],
  ])('a flow launch step and launch_app hand the adapter the same launch for %s', async (_name, entry, activity) => {
    const configPath = await file(
      'averi.yaml',
      `app:\n  android: { package: md.bank.app, activity: .MainActivity }\nflows:\n  enter:\n    steps:\n      - launch: ${JSON.stringify(entry)}\n`,
    );
    const viaTool = await connect();
    expect((await viaTool.call('launch_app', { platform: 'android', appId: 'md.bank.app', configPath, ...entry })).isError).toBe(false);
    const viaFlow = await connect();
    expect((await viaFlow.call('run_flow', { platform: 'android', flow: 'enter', configPath })).isError).toBe(false);

    const [byTool] = viaTool.fakes.android!.launches;
    expect(viaFlow.fakes.android!.launches).toEqual([byTool]);
    expect(byTool).toEqual({ appId: 'md.bank.app', ...entry, activity });
  });

  it('ios never gets an activity from the config', async () => {
    const { launches } = await launch({ appId: 'md.bank.app' }, { platform: 'ios' });
    expect(launches[0].activity).toBeUndefined();
  });

  it.each([
    ['no averi.yaml', async () => missing()],
    ['an invalid averi.yaml', invalidConfig],
  ])('%s → launches without an activity instead of failing', async (_name, configPath) => {
    const { launches } = await launch({ appId: 'md.bank.app' }, { configPath: await configPath() });
    expect(launches).toHaveLength(1);
    expect(launches[0].activity).toBeUndefined();
  });
});

describe('the config-optional tree tools (ui_snapshot, tap, type_text, scroll_until, assert)', () => {
  const snapshot = async (platform: Platform, configPath: string) => {
    const harness = await connect();
    const result = await harness.call('ui_snapshot', { platform, filter: 'id:home_root', configPath });
    return { result, bound: harness.bound() };
  };

  it('android: a present-but-INVALID averi.yaml is not even read — the call works', async () => {
    const { result } = await snapshot('android', await invalidConfig());
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toMatchObject([{ identifier: 'home_root' }]);
  });

  it('ios: the same invalid averi.yaml fails the call loudly, naming the file, before a device is bound', async () => {
    const configPath = await invalidConfig();
    const { result, bound } = await snapshot('ios', configPath);
    expect(result.isError).toBe(true);
    expect(result.text).toContain(configPath);
    expect(bound).toEqual([]);
  });

  // The rule is one helper at five call sites; ui_snapshot above and assert
  // below carry the detail, these pin that the other three go through it.
  it.each([
    ['tap', { selector: 'id:home_root' }],
    ['type_text', { selector: 'id:home_root', text: 'x' }],
    ['scroll_until', { selector: 'id:home_root' }],
  ])('ios: %s fails on the same invalid averi.yaml before a device is bound', async (tool, args) => {
    const configPath = await invalidConfig();
    const harness = await connect();
    const result = await harness.call(tool, { platform: 'ios', configPath, ...args });
    expect(result.isError).toBe(true);
    expect(result.text).toContain(configPath);
    expect(harness.bound()).toEqual([]);
  });

  it('ios: a missing averi.yaml means the default tree source (idb)', async () => {
    const { result, bound } = await snapshot('ios', missing());
    expect(result.isError).toBe(false);
    expect(bound).toEqual([{ platform: 'ios', deviceId: 'ios-1', treeSource: 'idb' }]);
  });

  it('ios: a valid averi.yaml naming treeSource: wda reaches the registry — the config IS consulted', async () => {
    const configPath = await file(
      'averi.yaml',
      'app:\n  ios: { bundleId: md.bank.app, treeSource: wda }\n',
    );
    const { result, bound } = await snapshot('ios', configPath);
    expect(result.isError).toBe(false);
    expect(bound).toEqual([{ platform: 'ios', deviceId: 'ios-1', treeSource: 'wda' }]);
  });
});

describe('assert — results always, health only with a loadable averi.yaml', () => {
  const run = async (configPath: string) => {
    const { call } = await connect();
    return call('assert', { platform: 'android', asserts: [{ element: { id: 'home_root' } }], configPath });
  };

  it('no averi.yaml → the assert results and no health line', async () => {
    const result = await run(missing());
    expect(result.isError).toBe(false);
    expect(result.text).toContain('home_root');
    expect(result.text).not.toContain('appAlive');
  });

  it('with averi.yaml → the same results with the health line appended', async () => {
    const bare = await run(missing());
    const result = await run(await validConfig());
    expect(result.isError).toBe(false);
    expect(result.text).toBe(`${bare.text}\nappAlive: true`);
  });

  it('android + an INVALID averi.yaml → results, silently no health (current behaviour; see the dated note in run/commands.ts#runAsserts)', async () => {
    const bare = await run(missing());
    const result = await run(await invalidConfig());
    expect(result.isError).toBe(false);
    expect(result.text).toBe(bare.text);
  });
});

describe('scroll_until', () => {
  it('timeoutMs is plain milliseconds, passed through: the timeout error quotes it', async () => {
    const { call, fakes } = await connect();
    const fake = fakes.android!;
    const result = await call('scroll_until', {
      platform: 'android',
      selector: 'id:never_there',
      timeoutMs: 7,
      // Out of reach in 7 ms (each mocked settle delay still yields a ≥1 ms
      // macrotask), yet finite: a handler that dropped or rescaled timeoutMs
      // ends at "after 200 swipes (maxSwipes)" and fails the assertion below
      // with a readable diff, instead of looping into the test timeout.
      maxSwipes: 200,
      configPath: missing(),
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('failed after 7ms (timeout)');
    // The settle delays between swipes were recorded, not waited on.
    expect(fake.swipes.length).toBeLessThan(200);
    expect(sleeps.length).toBe(fake.swipes.length);
    expect(new Set(sleeps)).toEqual(new Set([400]));
  });
});

describe('verify', () => {
  it("a typo'd contract path fails before any device is touched", async () => {
    const harness = await connect();
    const contract = join(dir, 'no-such-contract.json');
    const result = await harness.call('verify', {
      configPath: await validConfig(),
      contract,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('no-such-contract.json');
    expect(harness.factoryCalls).toEqual([]); // not even a device probe
  });

  // 2026-10-03: a bad field VALUE is the same class of mistake as a typo'd
  // path, and used to cost both legs before it surfaced as `FAILED:` in the
  // color table. The handler only delegates; what an MCP client sees is pinned.
  it('a contract with an invalid colour field is refused, naming the field, before any device is touched', async () => {
    const harness = await connect();
    const { android, ios } = harness.fakes;
    const contract = await file(
      'layout-contract.json',
      JSON.stringify({ screen: 'home', anchors: [{ id: 'home_root', x: 0, w: 100, bg: '#white' }] }),
    );
    const result = await harness.call('verify', { configPath: await validConfig(), contract });
    expect(result.isError).toBe(true);
    // Names the file as the user passed it, like a parse error does.
    expect(result.text).toContain(`the layout contract ${contract} has 1 invalid field`);
    expect(result.text).toContain("color parity: anchor home_root: 'bg' value '#white' is neither #RRGGBB(AA) nor");
    expect(result.text).toContain('Fix the contract and re-run; nothing was run on a device.');
    expect(result.images).toEqual([]);
    expect(harness.factoryCalls).toEqual([]); // not even a device probe
    expect([android!.screenshots.length, ios!.screenshots.length]).toEqual([0, 0]);
  });

  it('control for the above: the same contract with the fill fixed reaches both devices', async () => {
    const harness = await connect();
    const result = await harness.call('verify', {
      configPath: await validConfig(),
      contract: await file(
        'layout-contract.json',
        JSON.stringify({ screen: 'home', anchors: [{ id: 'home_root', x: 0, w: 100, bg: '#FFFFFF' }] }),
      ),
    });
    expect(result.isError).toBe(false);
    expect(result.text).toContain('## color parity');
    expect(harness.bound().map((c) => c.platform).sort()).toEqual(['android', 'ios']);
  });

  it("control for the typo'd path: without the contract the same call reaches both devices", async () => {
    const harness = await connect();
    harness.fakes.android!.nextScreenshot = frame('android');
    harness.fakes.ios!.nextScreenshot = frame('ios');
    // Input order reversed on purpose: the tool description promises the
    // legs — sections and images — android first regardless.
    const result = await harness.call('verify', { platforms: ['ios', 'android'], configPath: await validConfig() });
    expect(result.isError).toBe(false);
    expect(result.shape).toEqual([['text'], ['image', 'image/png'], ['image', 'image/png']]);
    expect(result.images).toEqual([frame('android'), frame('ios')]);
    expect(result.text.indexOf('## android')).toBeLessThan(result.text.indexOf('## ios'));
    expect(harness.bound().map((c) => c.platform).sort()).toEqual(['android', 'ios']);
  });
});

describe('tap and type_text under the Android soft keyboard', () => {
  const KEYBOARD = { x: 0, y: 1285, width: 1080, height: 935 };
  /** The measured login screen (see tests/interact/keyboard.test.ts); back hides the keyboard and the button moves down. */
  function loginFake() {
    const submit = nodeAt('button', 'login_submit', { x: 99, y: 1400, width: 300, height: 132 });
    const otp = nodeAt('textfield', 'login_otp', { x: 99, y: 1600, width: 882, height: 132 });
    const fake = new FakeAdapter({ login: { ...screen(submit, otp), rect: { x: 0, y: 0, width: 1080, height: 2220 } } }, 'login');
    fake.attachKeyboard({ state: 'shown', frame: KEYBOARD });
    fake.onKey = (key, self) => {
      if (key === 'back') for (const n of self.live().children) n.rect.y += 300;
    };
    return fake;
  }
  const nodeAt = (role: string, identifier: string, rect: UiNode['rect']): UiNode => ({ ...el({ role, identifier }), rect });

  it('tap by selector: the response carries the note, and the tap landed on the re-resolved point', async () => {
    const fake = loginFake();
    const { call } = await connect({ android: fake });
    const result = await call('tap', { platform: 'android', selector: 'id:login_submit', configPath: missing() });
    expect(result.isError).toBe(false);
    expect(result.text).toBe('Tapped id:login_submit (the soft keyboard covered id:login_submit; hidden before tapping)');
    expect(fake.keys).toEqual(['back']);
    expect(fake.tapPoints).toEqual([{ x: 249, y: 1766 }]);
  });

  it('tap by COORDINATES is not guarded: no keyboard query, no key — the caller chose the point', async () => {
    const fake = loginFake();
    const { call } = await connect({ android: fake });
    const result = await call('tap', { platform: 'android', x: 249, y: 1466 });
    expect(result.text).toBe('Tapped (249, 1466)');
    expect(fake.attachedKeyboard.windowAnswers.queries).toBe(0);
    expect(fake.keys).toEqual([]);
    expect(fake.tapPoints).toEqual([{ x: 249, y: 1466 }]);
  });

  it('type_text with a selector: the response carries the note too', async () => {
    const fake = loginFake();
    const { call } = await connect({ android: fake });
    const result = await call('type_text', { platform: 'android', selector: 'id:login_otp', text: '123456', configPath: missing() });
    expect(result.text).toBe('Filled id:login_otp (6 characters) (the soft keyboard covered id:login_otp; hidden before tapping)');
    expect(fake.tapPoints).toEqual([{ x: 540, y: 1966 }]);
  });

  it('the two keyboard sources never agree: an error response saying neither back nor the tap was sent', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.witnessAnswers.current = 'hidden';
    const { call } = await connect({ android: fake });
    const result = await call('tap', { platform: 'android', selector: 'id:login_submit', configPath: missing() });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('but the input method says no keyboard is shown, and the two still disagreed after 3000ms. Neither back nor the tap was sent');
    expect(result.text).toContain('From the MCP tools: look at the screen (ui_snapshot / screenshot), then tap again, or press_key back yourself if a keyboard is visibly up');
    expect(fake.keys).toEqual([]);
    expect(fake.taps).toEqual([]);
  });

  it('a keyboard that stays is an error response naming the recovery, and nothing is tapped', async () => {
    const fake = loginFake();
    fake.onKey = (_key, self) => {
      self.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    };
    const { call } = await connect({ android: fake });
    const result = await call('tap', { platform: 'android', selector: 'id:login_submit', configPath: missing() });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Pressed back to hide the soft keyboard covering id:login_submit, but back did not close it');
    expect(result.text).toContain('inspect the screen with ui_snapshot, then press_key back once more or tap a control above the keyboard');
    expect(fake.taps).toEqual([]);
  });
});
