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
 */
async function connect(fakes: Partial<Record<Platform, FakeAdapter>> = {}, version = '0.0.0-test') {
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

  type Content = { type: string; text?: string; data?: string };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Content[];
    return {
      isError: result.isError === true,
      text: content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'),
      images: content.filter((c) => c.type === 'image').map((c) => Buffer.from(c.data ?? '', 'base64')),
    };
  };
  /** The adapters the registry BOUND to a device (probes excluded), in order. */
  const bound = () => factoryCalls.filter((c) => c.deviceId !== undefined);
  return { client, call, factoryCalls, bound };
}

/** Writes a file into the test's temp dir and returns its absolute path. */
async function file(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

const missing = () => join(dir, 'no-such-averi.yaml');

const VALID_CONFIG = `
app:
  android: { package: md.bank.app, activity: .MainActivity }
  ios:     { bundleId: md.bank.app }
states:
  home:
    detect: { element: { id: home_root } }
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
    expect(tools.map((t) => t.name)).toEqual([
      'list_devices',
      'select_device',
      'install_app',
      'launch_app',
      'terminate_app',
      'open_deep_link',
      'screenshot',
      'ui_snapshot',
      'tap',
      'swipe',
      'type_text',
      'scroll_until',
      'press_key',
      'ensure_state',
      'run_flow',
      'assert',
      'verify',
      'get_logs',
    ]);
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
      configPath: await file('averi.yaml', VALID_CONFIG),
    });
    expect(result.isError).toBe(false);
    expect(result.text).toContain('appAlive: true');
    expect(result.images).toEqual([frame('c')]);
    expect(fake.screenshots).toEqual([frame('a'), frame('b'), frame('c'), frame('c')]);
  });
});

describe('launch_app — the entry activity', () => {
  const launch = async (args: Record<string, unknown>, platform: Platform = 'android') => {
    const fake = home();
    const { call } = await connect({ [platform]: fake });
    const result = await call('launch_app', {
      platform,
      configPath: await file('averi.yaml', VALID_CONFIG),
      ...args,
    });
    expect(result.isError).toBe(false);
    return { launches: fake.launches, text: result.text };
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

  it('an intent alone suppresses the fallback (the tool differs from a flow launch step here — pinned as it is)', async () => {
    const intent = { action: 'android.intent.action.SEND' };
    const { launches } = await launch({ appId: 'md.bank.app', intent });
    expect(launches).toEqual([{ appId: 'md.bank.app', clearState: undefined, activity: undefined, intent }]);
  });

  it('ios never gets an activity from the config', async () => {
    const { launches } = await launch({ appId: 'md.bank.app' }, 'ios');
    expect(launches[0].activity).toBeUndefined();
  });

  it('no averi.yaml, or an invalid one → launches without an activity instead of failing', async () => {
    for (const configPath of [missing(), await file('broken.yaml', INVALID_CONFIG)]) {
      const fake = home();
      const { call } = await connect({ android: fake });
      const result = await call('launch_app', { platform: 'android', appId: 'md.bank.app', configPath });
      expect(result.isError).toBe(false);
      expect(fake.launches[0].activity).toBeUndefined();
    }
  });
});

describe('the config-optional tree tools (ui_snapshot, tap, type_text, scroll_until, assert)', () => {
  const snapshot = async (platform: Platform, configPath: string) => {
    const harness = await connect({ [platform]: home() });
    const result = await harness.call('ui_snapshot', { platform, filter: 'id:home_root', configPath });
    return { result, bound: harness.bound() };
  };

  it('android: a present-but-INVALID averi.yaml is not even read — the call works', async () => {
    const { result } = await snapshot('android', await file('averi.yaml', INVALID_CONFIG));
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toMatchObject([{ identifier: 'home_root' }]);
  });

  it('ios: the same invalid averi.yaml fails the call loudly, naming the file, before a device is bound', async () => {
    const configPath = await file('averi.yaml', INVALID_CONFIG);
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
    const configPath = await file('averi.yaml', INVALID_CONFIG);
    const fake = home();
    const harness = await connect({ ios: fake });
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
    const { call } = await connect({ android: home() });
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
    const result = await run(await file('averi.yaml', VALID_CONFIG));
    expect(result.isError).toBe(false);
    expect(result.text).toBe(`${bare.text}\nappAlive: true`);
  });

  it('android + an INVALID averi.yaml → results, silently no health (current behaviour; see the dated note in the handler)', async () => {
    const bare = await run(missing());
    const result = await run(await file('averi.yaml', INVALID_CONFIG));
    expect(result.isError).toBe(false);
    expect(result.text).toBe(bare.text);
  });
});

describe('scroll_until', () => {
  it('timeoutMs is plain milliseconds, passed through: the timeout error quotes it', async () => {
    const fake = home();
    const { call } = await connect({ android: fake });
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
    const harness = await connect({ android: home(), ios: home() });
    const contract = join(dir, 'no-such-contract.json');
    const result = await harness.call('verify', {
      configPath: await file('averi.yaml', VALID_CONFIG),
      contract,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('no-such-contract.json');
    expect(harness.factoryCalls).toEqual([]); // not even a device probe
  });

  it('control for the above: without the contract the same call reaches both devices', async () => {
    const harness = await connect({ android: home(), ios: home() });
    const result = await harness.call('verify', { configPath: await file('averi.yaml', VALID_CONFIG) });
    expect(result.isError).toBe(false);
    expect(harness.bound().map((c) => c.platform).sort()).toEqual(['android', 'ios']);
  });
});
