import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdbEmptyTreeError } from '../../src/adapters/ios-tree-source.js';
import type { Device, Platform, UiNode } from '../../src/adapters/types.js';
import { AdapterRegistry, type AdapterFactory } from '../../src/mcp/registry.js';
import { createAveriServer } from '../../src/mcp/tools.js';
import { TOOL_CONFIG } from '../../src/mcp/config-policy.js';
import { el, FakeAdapter, hidesKeyboardOn, iosLoginFake, node, resetLayout, screen } from '../helpers/fake.js';
import { resetSleeps, sleeps } from '../helpers/sleep-recorder.js';
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
vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));

// File reads are COUNTED, never changed: the real readFile answers, and the
// path of every call is kept, so "a tap reads averi.yaml once" (K3,
// 2026-10-07) can be pinned on the file system rather than on stderr, where
// the loader's once-per-file memo hides a second load.
const reads = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const readFile: typeof real.readFile = ((...args: Parameters<typeof real.readFile>) => {
    reads.paths.push(String(args[0]));
    return real.readFile(...args);
  }) as typeof real.readFile;
  return { ...real, readFile };
});
/** How many times THIS config file was read since the last reset — the exact path the tool was given, not any averi.yaml. */
const configReads = (configPath: string) => reads.paths.filter((p) => p === configPath).length;
/** How many times the .env.averi beside the test's config was read since the last reset. */
const envReads = () => reads.paths.filter((p) => p === join(dir, '.env.averi')).length;

let dir: string;
const closers: (() => Promise<void>)[] = [];
beforeEach(async () => {
  resetSleeps();
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
      /** The text blocks one by one — `text` joins them, which hides where one ends (ui_snapshot's array + note). */
      texts: content.filter((c) => c.type === 'text').map((c) => c.text ?? ''),
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

  // 2026-10-08: the policy table (mcp/config-policy.ts#TOOL_CONFIG) declares
  // what every config-reading tool reads. A tool given a `configPath` but
  // missing from the table would choose its own loader again; one in the
  // table without the argument could not be pointed at a config.
  it('the tools that take a configPath are exactly the ones the config policy table declares', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const taking = tools.filter((t) => 'configPath' in (t.inputSchema.properties ?? {})).map((t) => t.name);
    expect(taking.sort()).toEqual(Object.keys(TOOL_CONFIG).sort());
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
    expect(result.shape).toEqual([['image', 'image/png']]); // a settled frame comes alone: no note block
    expect(fake.screenshots).toEqual([frame('a'), frame('b'), frame('c'), frame('c')]);
  });

  it('screenshot: a screen that never settles returns its LAST frame with one note before the image (2026-10-05)', async () => {
    const fake = withFrames(home(), ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(frame));
    const { call } = await connect({ android: fake });
    const result = await call('screenshot', { platform: 'android' });
    expect(result.isError).toBe(false);
    expect(result.shape).toEqual([['text'], ['image', 'image/png']]);
    expect(result.text).toBe('⚠ frame: the screen did not settle: 6 captures, each different from the last, before the stability budget or the deadline ran out — an animation or live content; wait for it to finish or hide the live content and re-run — the last capture is returned as the best available');
    expect(result.images).toEqual([frame('f')]); // 6 captures: the last one
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

  /**
   * The `⚠ clearState` line's running count is the SESSION's — the server's,
   * shared by every tool that runs the engine. Until 2026-10-07 it was a
   * module-level `let` in flow/engine.ts: a second server in the same process
   * (every test file, and anything that embeds createAveriServer) continued
   * the first one's count, and the engine's tests reset it by hand.
   */
  // The pre-flight (run/preflight.ts#refuseUnknownEnvironment) through the
  // protocol: each engine tool answers isError, naming the environment.
  it.each(['run_flow', 'ensure_state', 'verify'])('%s: an `environment` averi.yaml does not declare is an error naming it', async (tool) => {
    const { call, bound } = await connect();
    const result = await call(tool, {
      platform: 'android',
      platforms: ['android'],
      flow: 'touch_home',
      state: 'home',
      environment: 'nope',
      configPath: await validConfig(),
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Unknown environment "nope"');
    expect(bound()).toEqual([]); // refused before any device
  });

  // `required` + env (flow/tool-config.ts): moved here from
  // tests/run/commands.test.ts on 2026-10-08, when the read moved up into
  // the handler.
  it.each([
    ['run_flow', 'missing', async () => missing()],
    ['run_flow', 'invalid', invalidConfig],
    ['ensure_state', 'missing', async () => missing()],
    ['ensure_state', 'invalid', invalidConfig],
  ])('%s: a %s averi.yaml is an error naming the file, before any device is bound', async (tool, _name, path) => {
    const { call, bound } = await connect();
    const configPath = await path();
    const result = await call(tool, { platform: 'android', flow: 'touch_home', state: 'home', configPath });
    expect(result.isError).toBe(true);
    expect(result.text).toContain(configPath);
    expect(bound()).toEqual([]);
  });

  it.each(['run_flow', 'ensure_state', 'verify'])('%s: averi.yaml and .env.averi are each read ONCE per call', async (tool) => {
    const { call } = await connect();
    const configPath = await validConfig();
    await file('.env.averi', 'AVERI_TOOLS_TEST=1\n');
    reads.paths.length = 0;
    const result = await call(tool, { platform: 'android', platforms: ['android'], flow: 'touch_home', state: 'home', configPath });
    expect(result.isError).toBe(false);
    expect(configReads(configPath)).toBe(1);
    expect(envReads()).toBe(1);
  });

  it('the clearState count belongs to the server: its three engine tools share it, both verify legs too, a second server starts at 1', async () => {
    const configPath = await file(
      'averi.yaml',
      VALID_CONFIG.replace(
        'states:\n',
        'states:\n  wiped:\n    detect: { element: { id: login_root } }\n    reach: [wipe]\n',
      ) + '  wipe:\n    steps:\n      - launch: { clearState: true }\n',
    );
    // A device whose wipe lands on the login screen, so `wiped` is reached by its one rung.
    resetLayout();
    const wipeable = () => {
      const fake = new FakeAdapter(
        {
          // Rendered, not bare: a labeled control, so the ladder may run its destructive rung.
          home: screen(el({ role: 'container', identifier: 'home_root' }), el({ role: 'button', label: 'Settings' })),
          login: screen(el({ role: 'container', identifier: 'login_root' }), el({ role: 'button', label: 'Log in' })),
        },
        'home',
      );
      const launch = fake.launch.bind(fake);
      fake.launch = async (appId, opts) => {
        await launch(appId, opts);
        if (opts?.clearState === true) fake.current = 'login';
      };
      return fake;
    };
    const counts = (text: string) => [...text.matchAll(/\((\d+) this session\)/g)].map((m) => Number(m[1]));
    const first = await connect({ android: wipeable(), ios: wipeable() });
    const ensured = await first.call('ensure_state', { platform: 'android', state: 'wiped', configPath });
    expect(ensured.isError).toBe(false);
    expect(counts(ensured.text)).toEqual([1]);
    const flow = await first.call('run_flow', { platform: 'android', flow: 'wipe', configPath });
    expect(counts(flow.text)).toEqual([2]);
    // Two legs, run concurrently: one wipe each, both counted in the one session.
    const verify = await first.call('verify', { platforms: ['android', 'ios'], flow: 'wipe', configPath });
    expect(counts(verify.text).sort()).toEqual([3, 4]);

    const second = await connect();
    const fresh = await second.call('run_flow', { platform: 'android', flow: 'wipe', configPath });
    expect(counts(fresh.text)).toEqual([1]);
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

  // `required` (flow/tool-config.ts): without a path the config is the only
  // source of the build, so neither a missing nor a broken one can be passed over.
  it.each([
    ['missing', async () => missing()],
    ['invalid', invalidConfig],
  ])('no path and a %s averi.yaml → an error naming the file, nothing installed', async (_name, path) => {
    const configPath = await path();
    const { result, installed } = await installing({ configPath });
    expect(result.isError).toBe(true);
    expect(result.text).toContain(configPath);
    expect(installed).toEqual([]);
  });

  it('no path: averi.yaml is read once, and .env.averi beside it not at all — a build path needs no credentials', async () => {
    const configPath = await file('averi.yaml', 'app:\n  android: { package: md.bank.app, apk: build/app.apk }\n');
    await file('.env.averi', 'AVERI_TOOLS_TEST=1\n');
    reads.paths.length = 0;
    const { result } = await installing({ configPath });
    expect(result.isError).toBe(false);
    expect(configReads(configPath)).toBe(1);
    expect(envReads()).toBe(0);
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

  it('no averi.yaml → launches without an activity instead of failing (`optional`)', async () => {
    const { launches } = await launch({ appId: 'md.bank.app' }, { configPath: missing() });
    expect(launches).toHaveLength(1);
    expect(launches[0].activity).toBeUndefined();
  });

  // 2026-10-08: until then a catch-all launched here without the activity —
  // on a debug build bundling LeakCanary, the wrong app, silently.
  it('android, nothing named, an INVALID averi.yaml → an error naming the file, nothing launched, no device bound', async () => {
    const { call, fakes, bound } = await connect();
    const configPath = await invalidConfig();
    const result = await call('launch_app', { platform: 'android', appId: 'md.bank.app', configPath });
    expect(result.isError).toBe(true);
    expect(result.text).toContain(configPath);
    expect(fakes.android!.launches).toEqual([]);
    expect(bound()).toEqual([]);
  });

  // The same broken file beside a call that would use nothing from it: not read.
  it.each([
    ['android, an activity named', 'android', { activity: '.ShareActivity' }],
    ['android, an intent given', 'android', { intent: { action: 'android.intent.action.SEND' } }],
    ['ios', 'ios', {}],
  ] as const)('%s → the invalid averi.yaml is not read, and the launch goes ahead', async (_name, platform, entry) => {
    const configPath = await invalidConfig();
    reads.paths.length = 0;
    const { launches } = await launch({ appId: 'md.bank.app', ...entry }, { platform, configPath });
    expect(launches).toHaveLength(1);
    expect(configReads(configPath)).toBe(0);
  });

  it('the fallback reads averi.yaml once, and .env.averi not at all — an activity needs no credentials', async () => {
    const configPath = await validConfig();
    await file('.env.averi', 'AVERI_TOOLS_TEST=1\n');
    reads.paths.length = 0;
    const { launches } = await launch({ appId: 'md.bank.app' }, { configPath });
    expect(launches[0].activity).toBe('.MainActivity');
    expect(configReads(configPath)).toBe(1);
    expect(envReads()).toBe(0);
  });
});

// docs/bugs/2026-10-07-ios-fill-empty-value-fails-in-idb.md: `text: ""` is a
// legal call on both of the tool's paths — with a selector it is a clear
// alone or a focus without typing; without one it is a no-op — and the
// handler hands the "" to the adapter on both, which is why the guard lives
// in IosAdapter.typeText (idb refuses `ui text ''`) and not in fillField:
// a fill-only skip would have left the selector-less path throwing idb's
// bare error. Pinned here: the response, and that "" reaches the adapter.
describe('type_text with an empty text', () => {
  const form = () => new FakeAdapter({ form: screen(el({ role: 'textfield', identifier: 'amount_input', value: '2.50' })) }, 'form');

  it('without a selector: the adapter is handed "", and the response counts 0 characters', async () => {
    const fake = form();
    const { call } = await connect({ ios: fake });
    const result = await call('type_text', { platform: 'ios', text: '', configPath: missing() });
    expect(result.isError).toBe(false);
    expect(result.text).toBe('Typed 0 characters');
    expect(fake.typed).toEqual(['']);
    expect(fake.taps).toEqual([]);
  });

  it('with a selector and clear: the field is focused and cleared, the "" handed over, and the response says so', async () => {
    const fake = form();
    const { call } = await connect({ ios: fake });
    const result = await call('type_text', { platform: 'ios', selector: 'id:amount_input', text: '', clear: true, configPath: missing() });
    expect(result.isError).toBe(false);
    expect(result.text).toBe('Filled id:amount_input (0 characters, cleared first)');
    expect(fake.taps).toEqual(['amount_input']);
    expect(fake.deletes).toEqual([4]);
    expect(fake.typed).toEqual(['']); // deliberate: the "" reaches the adapter, whose contract makes it a no-op — fillField adds no second guard
    expect(fake.focused?.value ?? '').toBe(''); // the fake appends the "" to a cleared (null) field: nothing held
  });
});

// interact/type-text.ts (code review 2026-10-07): the device check saw the
// tool's selector tap go out before the Android adapter refused a tab. Now the
// refusal comes first, on both platforms, with or without a selector.
describe('type_text refuses a control character before anything is sent', () => {
  const form = () => new FakeAdapter({ form: screen(el({ role: 'textfield', identifier: 'amount_input', value: '2.50' })) }, 'form');

  for (const p of ['android', 'ios'] as const) {
    it(`${p}, with a selector and clear: no tap, no clear, nothing typed`, async () => {
      const fake = form();
      fake.platform = p;
      const { call } = await connect({ [p]: fake });
      const result = await call('type_text', { platform: p, selector: 'id:amount_input', text: 'tab\there', clear: true, configPath: missing() });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('cannot type U+0009');
      expect(result.text).toContain("pressKey('enter')");
      expect(fake.taps).toEqual([]);
      expect(fake.deletes).toEqual([]);
      expect(fake.typed).toEqual([]);
    });

    it(`${p}, without a selector: nothing typed`, async () => {
      const fake = form();
      fake.platform = p;
      const { call } = await connect({ [p]: fake });
      const result = await call('type_text', { platform: p, text: 'x\x1by', configPath: missing() });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('cannot type U+001B');
      expect(fake.typed).toEqual([]);
    });
  }
});

describe('the config-optional tree tools (ui_snapshot, tap, type_text, scroll_until — and assert on ios)', () => {
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

  // 2026-10-06 (docs/bugs/2026-10-06-ui-snapshot-empty-right-after-launch.md):
  // `ui_snapshot { filter: role:button }` 2 s after launch_app returned `[]`
  // on a PIN screen with ten buttons. The array stays as it was — a parser
  // reading the first text block sees exactly what it saw before — and a
  // no-match or a bare tree gains a SECOND text block, the screenshot
  // tool's unsettled-note mechanism. The wording's rule is pinned in
  // tool-text.test.ts against the real tree-source shapes; here: the blocks.
  const pin = () =>
    new FakeAdapter({ pin: screen(el({ role: 'button', label: 'Forgot PIN?' }), el({ role: 'text', label: 'Enter your PIN' })) }, 'pin');
  /** idb for an app with no accessible elements yet: the synthetic root alone. */
  const launching = () => new FakeAdapter({ launching: node({ role: 'container', rect: { x: 0, y: 0, width: 0, height: 0 } }) }, 'launching');

  it('ui_snapshot: a filter that matches returns the array ALONE, byte-identical to before', async () => {
    const { call } = await connect();
    const result = await call('ui_snapshot', { platform: 'android', filter: 'id:home_root' });
    expect(result.isError).toBe(false);
    expect(result.shape).toEqual([['text']]);
    expect(result.texts[0]).toBe(
      JSON.stringify([{ role: 'container', label: null, identifier: 'home_root', value: null, rect: { x: 0, y: 20, width: 100, height: 10 } }], null, 2),
    );
  });

  it('ui_snapshot: a filter nothing matches in a tree WITH content returns `[]` and a second block with the tree size — no warning', async () => {
    const { call } = await connect({ android: pin(), ios: home() });
    const result = await call('ui_snapshot', { platform: 'android', filter: 'role:textfield' });
    expect(result.isError).toBe(false);
    expect(result.shape).toEqual([['text'], ['text']]);
    expect(result.texts[0]).toBe('[]');
    expect(result.texts[1]).toBe('0 matches for role:textfield in a tree of 3 nodes (roles: button ×1, container ×1, text ×1)');
  });

  it('ui_snapshot: a filter on a BARE tree (idb right after launch: the synthetic root alone) returns `[]` and says the screen is probably still loading', async () => {
    const { call } = await connect({ ios: launching(), android: home() });
    const result = await call('ui_snapshot', { platform: 'ios', filter: 'role:button', configPath: missing() });
    expect(result.isError).toBe(false);
    expect(result.shape).toEqual([['text'], ['text']]);
    expect(result.texts[0]).toBe('[]');
    expect(result.texts[1]).toMatch(/^⚠ 0 matches for role:button, and the tree is bare: 1 node, none readable or interactive .*\. The accessibility tree is empty or unrendered/);
    expect(result.texts[1]).toContain('do not read the element as absent. assert polls (3 s by default');
  });

  it('ui_snapshot: unfiltered, a tree with content comes alone; a bare tree comes with the loading note after it', async () => {
    const { call } = await connect({ ios: launching(), android: pin() });
    const full = await call('ui_snapshot', { platform: 'android' });
    expect(full.shape).toEqual([['text']]);
    expect(JSON.parse(full.texts[0])).toMatchObject({ role: 'container', children: [{ label: 'Forgot PIN?' }, { label: 'Enter your PIN' }] });
    const empty = await call('ui_snapshot', { platform: 'ios', configPath: missing() });
    expect(empty.shape).toEqual([['text'], ['text']]);
    expect(JSON.parse(empty.texts[0])).toEqual({ role: 'container', label: null, identifier: null, value: null, rect: { x: 0, y: 0, width: 0, height: 0 }, children: [] });
    expect(empty.texts[1]).toMatch(/^⚠ The tree is bare: 1 node, none readable or interactive/);
  });

  // 2026-10-06 (docs/bugs/2026-10-06-ios-idb-empty-tree-persists-on-pin-
  // screen.md): idb's stuck 0×0 tree is a read error at the source now, so
  // ui_snapshot no longer shows it as a bare `[]` — the call fails, carrying
  // the cause and the advice.
  it('ui_snapshot: an idb read that returns no tree (IdbEmptyTreeError) is an error result naming the cause and the way out', async () => {
    const stuck = new FakeAdapter({}, 'none');
    stuck.uiTree = async () => {
      throw new IdbEmptyTreeError(['Application']);
    };
    const { call } = await connect({ ios: stuck, android: home() });
    const result = await call('ui_snapshot', { platform: 'ios', filter: 'role:button', configPath: missing() });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('idb returned an empty accessibility tree (only a 0×0 Application)');
    expect(result.text).toContain('Compare with screenshot');
    expect(result.text).toContain('app.ios.treeSource: wda');
  });

  it('ui_snapshot: an EMPTY filter string means no filter, as it always did — the whole tree, alone', async () => {
    const { call } = await connect({ android: pin(), ios: home() });
    const result = await call('ui_snapshot', { platform: 'android', filter: '' });
    expect(result.isError).toBe(false);
    expect(result.shape).toEqual([['text']]);
    expect(JSON.parse(result.texts[0])).toMatchObject({ role: 'container', children: [{ label: 'Forgot PIN?' }, { label: 'Enter your PIN' }] });
  });

  /**
   * The same policy for every tool in the group, not only ui_snapshot: each
   * declares it in mcp/config-policy.ts#TOOL_CONFIG and reads through the one
   * loader (2026-10-08; until then a shared helper, which an `it.each` over
   * tap, type_text and scroll_until pinned for the ios-invalid row only). `assert` is in the iOS half only — on
   * android it reads averi.yaml for its health line (its own describe).
   */
  const TREE_CALLS: Record<string, Record<string, unknown>> = {
    ui_snapshot: { filter: 'id:home_root' },
    tap: { selector: 'id:home_root' },
    type_text: { text: 'x' },
    scroll_until: { selector: 'id:home_root' },
    assert: { asserts: [{ element: { id: 'home_root' } }] },
  };

  it.each(Object.keys(TREE_CALLS))('ios %s: an INVALID averi.yaml fails the call naming the file, before a device is bound', async (tool) => {
    const harness = await connect();
    const configPath = await invalidConfig();
    const result = await harness.call(tool, { platform: 'ios', configPath, ...TREE_CALLS[tool] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain(configPath);
    expect(harness.bound()).toEqual([]);
  });

  it.each(Object.keys(TREE_CALLS))('ios %s: a MISSING averi.yaml is the default tree source, and the call works', async (tool) => {
    const harness = await connect();
    const result = await harness.call(tool, { platform: 'ios', configPath: missing(), ...TREE_CALLS[tool] });
    expect(result.isError).toBe(false);
    expect(harness.bound()).toEqual([{ platform: 'ios', deviceId: 'ios-1', treeSource: 'idb' }]);
  });

  it.each(['ui_snapshot', 'tap', 'type_text', 'scroll_until'])('android %s: an INVALID averi.yaml is not read at all, and the call works', async (tool) => {
    const harness = await connect();
    const configPath = await invalidConfig();
    reads.paths.length = 0;
    const result = await harness.call(tool, { platform: 'android', configPath, ...TREE_CALLS[tool] });
    expect(result.isError).toBe(false);
    expect(configReads(configPath)).toBe(0);
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

/**
 * Stage B (2026-10-07): the tap and type_text tools hand averi.yaml's
 * `app.ios.keyboardDismiss` to the keyboard guard (flow/tool-config.ts#
 * iosToolSettings over the call's one read, which also gives the tree
 * source; flow/load.ts#iosToolSettingsFor until 2026-10-08). The measured iOS login in points: `login_submit` under the band
 * the WDA source marks, the title above it; the fake plays the app (K5b: a
 * tap on the title hides the keyboard).
 */
describe('tap / type_text pass app.ios.keyboardDismiss to the guard', () => {
  /** The password field under the band, so type_text's focus tap is the guarded one. */
  const iosLogin = (hides = true) => iosLoginFake({ password: { x: 90, y: 600, width: 222, height: 20 }, onTap: hides ? hidesKeyboardOn('login_title') : undefined });
  const CONFIGURED = 'app:\n  ios: { bundleId: md.bank.app, treeSource: wda, keyboardDismiss: [{ tap: { id: login_title } }, { accessory: true }] }\n';

  it('tap: the configured title is tapped first, the target after it, and the response says so', async () => {
    const fake = iosLogin();
    const { call } = await connect({ ios: fake });
    const result = await call('tap', { platform: 'ios', selector: 'id:login_submit', configPath: await file('averi.yaml', CONFIGURED) });
    expect(result.isError).toBe(false);
    expect(result.text).toBe('Tapped id:login_submit (the soft keyboard covered id:login_submit; hidden by tapping id:"login_title" before tapping)');
    expect(fake.taps).toEqual(['login_title', 'login_submit']);
    expect(fake.keys).toEqual([]);
  });

  it('tap: without the key in averi.yaml the covered target is refused, saying no dismissal is configured — and nothing is tapped', async () => {
    const fake = iosLogin();
    const { call } = await connect({ ios: fake });
    const result = await call('tap', { platform: 'ios', selector: 'id:login_submit', configPath: await file('averi.yaml', 'app:\n  ios: { bundleId: md.bank.app, treeSource: wda }\n') });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('this adapter cannot hide it on its own (ADVICE), and no dismissal is configured');
    expect(fake.taps).toEqual([]);
  });

  it('tap: a dismissal that does not hide the keyboard fails the call naming the tap that was sent, and the target is not tapped', async () => {
    const fake = iosLogin(false);
    const { call } = await connect({ ios: fake });
    const result = await call('tap', { platform: 'ios', selector: 'id:login_submit', configPath: await file('averi.yaml', CONFIGURED) });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^Tapped id:"login_title" at \(201,303\) to hide the soft keyboard covering id:login_submit, but it is still up/);
    expect(fake.taps).toEqual(['login_title']);
  });

  it('type_text: the focus tap on a field under the band goes through the same dismissal, then the text is typed', async () => {
    const fake = iosLogin();
    const { call } = await connect({ ios: fake });
    const result = await call('type_text', { platform: 'ios', selector: 'id:login_password', text: 'secret', configPath: await file('averi.yaml', CONFIGURED) });
    expect(result.isError).toBe(false);
    expect(result.text).toBe('Filled id:login_password (6 characters) (the soft keyboard covered id:login_password; hidden by tapping id:"login_title" before tapping)');
    expect(fake.taps).toEqual(['login_title', 'login_password']);
    expect(fake.typed).toEqual(['secret']);
    expect(fake.keys).toEqual([]); // nothing dismissed AFTER typing: the tool has no dismissKeyboard
  });

  it('android: the config is not read for the dismissals either — a present-but-invalid averi.yaml does not break an android tap, and the file is not read at all', async () => {
    const fake = home();
    const { call } = await connect({ android: fake });
    const configPath = await invalidConfig();
    reads.paths.length = 0;
    const result = await call('tap', { platform: 'android', selector: 'id:home_root', configPath });
    expect(result.isError).toBe(false);
    expect(fake.taps).toEqual(['home_root']);
    expect(configReads(configPath)).toBe(0);
  });

  /**
   * K3 (2026-10-07): the tree source and the dismissals come from ONE load
   * per call. Until then each tool call read and parsed averi.yaml twice —
   * once for the registry's tree source, once for the guard's dismissals —
   * and the loader's inert-note memo hid the second load on stderr, which
   * is why this counts reads of the file itself.
   */
  it('tap and type_text read averi.yaml ONCE per call: the tree source and the dismissals come from one load', async () => {
    const fake = iosLogin();
    const { call } = await connect({ ios: fake });
    const configPath = await file('averi.yaml', CONFIGURED);
    reads.paths.length = 0;
    expect((await call('tap', { platform: 'ios', selector: 'id:login_submit', configPath })).isError).toBe(false);
    expect(configReads(configPath)).toBe(1);
    reads.paths.length = 0;
    expect((await call('type_text', { platform: 'ios', selector: 'id:login_password', text: 'secret', configPath })).isError).toBe(false);
    expect(configReads(configPath)).toBe(1);
  });
});

describe('assert — results always, health only with a loadable averi.yaml', () => {
  const run = async (configPath: string, platform: Platform = 'android') => {
    const harness = await connect();
    const result = await harness.call('assert', { platform, asserts: [{ element: { id: 'home_root' } }], configPath });
    return { ...result, bound: harness.bound() };
  };

  it.each(['android', 'ios'] as const)('%s: no averi.yaml → the assert results and no health line', async (platform) => {
    const result = await run(missing(), platform);
    expect(result.isError).toBe(false);
    expect(result.text).toContain('home_root');
    expect(result.text).not.toContain('appAlive');
  });

  it.each(['android', 'ios'] as const)('%s: with averi.yaml → the same results with the health line appended', async (platform) => {
    const bare = await run(missing(), platform);
    const result = await run(await validConfig(), platform);
    expect(result.isError).toBe(false);
    expect(result.text).toBe(`${bare.text}\nappAlive: true`);
  });

  // 2026-10-08: until then the android call passed and silently dropped the
  // health line (a catch-all in run/commands.ts#runAsserts) while the ios
  // call failed — one broken file, two verdicts by platform. Now one.
  it.each(['android', 'ios'] as const)('%s: an INVALID averi.yaml fails the call naming the file, before a device is bound', async (platform) => {
    const configPath = await invalidConfig();
    const result = await run(configPath, platform);
    expect(result.isError).toBe(true);
    expect(result.text).toContain(configPath);
    expect(result.bound).toEqual([]);
  });

  // Device check (2026-10-08): a YAML SYNTAX error used to surface as the
  // parser's bare message, naming no file.
  it('android: an averi.yaml that is not even YAML → an error naming the file, before a device is bound', async () => {
    const configPath = await file('averi.yaml', 'app: {}\nflows: { f:\n  steps:\n    - tap: x\n}\n');
    const result = await run(configPath);
    expect(result.isError).toBe(true);
    expect(result.text).toContain(`Invalid ${configPath}: `);
    expect(result.text).toMatch(/at line \d+, column \d+/);
    expect(result.bound).toEqual([]);
  });

  // Review round 1: only a MISSING file means "no averi.yaml". A path the
  // file cannot be read from for another reason (here a directory) fails the
  // call as it came — until 2026-10-08 the android call's catch-all passed it.
  it('android: a configPath that is a directory → an error (EISDIR), before a device is bound', async () => {
    const configPath = join(dir, 'averi.yaml');
    await mkdir(configPath);
    const result = await run(configPath);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('EISDIR');
    expect(result.bound).toEqual([]);
  });

  // The ios call needs averi.yaml twice — the tree source and the health
  // line — and until 2026-10-08 read it twice, the second time strictly and
  // with .env.averi, which the health line has no use for.
  it.each(['android', 'ios'] as const)('%s: averi.yaml is read ONCE per call, and .env.averi not at all', async (platform) => {
    const configPath = await file('averi.yaml', `${VALID_CONFIG.replace('ios:     { bundleId: md.bank.app }', 'ios:     { bundleId: md.bank.app, treeSource: wda }')}`);
    await file('.env.averi', 'AVERI_TOOLS_TEST=1\n');
    reads.paths.length = 0;
    const result = await run(configPath, platform);
    expect(result.isError).toBe(false);
    expect(result.text).toContain('appAlive: true');
    expect(configReads(configPath)).toBe(1);
    expect(envReads()).toBe(0);
    // ...and that one read served the tree source too.
    expect(result.bound).toEqual([{ platform, deviceId: `${platform}-1`, treeSource: platform === 'ios' ? 'wda' : undefined }]);
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
  /** The measured login screen (see tests/interact/keyboard-window.test.ts); back hides the keyboard and the button moves down. */
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
