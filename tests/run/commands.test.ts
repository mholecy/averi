import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AveriConfig } from '../../src/flow/config.js';
import {
  baselineDirFor,
  launchActivityFor,
  runAsserts,
  runEnsureState,
  runNamedFlow,
} from '../../src/run/commands.js';
import { el, FakeAdapter, resetLayout, screen } from '../helpers/fake.js';
import { resetSleeps, sleeps } from '../helpers/sleep-recorder.js';

/**
 * The single-platform tool compositions at their own level: a FakeAdapter, a
 * real averi.yaml in a temp dir, no MCP server. tests/mcp/tools.test.ts pins
 * the same behaviour through the protocol; what is pinned here is what the
 * protocol cannot show cleanly — the ORDER (config before the adapter is
 * resolved), and what each function returns as a value.
 */

// The one sleep owner is recorded, not waited on (as in tests/verify/capture.test.ts).
vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));

let dir: string;
beforeEach(async () => {
  resetSleeps();
  resetLayout();
  dir = await mkdtemp(join(tmpdir(), 'averi-commands-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

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
  open_menu:
    steps:
      - tap: { id: menu_button }
`;
const INVALID_CONFIG = 'flows: 12\n';

async function file(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}
const validConfig = () => file('averi.yaml', VALID_CONFIG);
const invalidConfig = () => file('broken.yaml', INVALID_CONFIG);
const missing = () => join(dir, 'no-such-averi.yaml');

const home = () =>
  new FakeAdapter(
    { home: screen(el({ role: 'container', identifier: 'home_root' }), el({ role: 'button', identifier: 'menu_button' })) },
    'home',
  );

const frame = (tag: string): Buffer => Buffer.from(`frame:${tag}`);

/** A resolver that records the config it was handed — and that it was called at all. */
function resolver(adapter: FakeAdapter) {
  const resolvedWith: AveriConfig[] = [];
  return {
    resolvedWith,
    resolve: async (cfg: AveriConfig) => {
      resolvedWith.push(cfg);
      return adapter;
    },
  };
}

describe('runEnsureState', () => {
  it('returns the trace with the health line, and the SETTLED frame — not the first capture', async () => {
    const fake = home();
    const frames = [frame('a'), frame('b'), frame('c'), frame('c')];
    let i = 0;
    fake.screenshot = async () => {
      const shot = frames[Math.min(i++, frames.length - 1)];
      fake.screenshots.push(shot);
      return shot;
    };
    const { resolve, resolvedWith } = resolver(fake);
    const out = await runEnsureState({ state: 'home', configPath: await validConfig() }, resolve);
    expect(out.text).toMatch(/home[\s\S]*\nappAlive: true$/);
    expect(out.shot).toEqual(frame('c'));
    expect(fake.screenshots).toEqual(frames);
    // The adapter is resolved FROM the loaded config (it names the iOS tree source).
    expect(resolvedWith.map((cfg) => cfg.app.android?.package)).toEqual(['md.bank.app']);
  });

  it('a frame that never settled is returned with ONE note line after the health line; a settled one adds nothing (2026-10-05)', async () => {
    const fake = home();
    let i = 0;
    fake.screenshot = async () => {
      const shot = frame(`moving ${i++}`);
      fake.screenshots.push(shot);
      return shot;
    };
    const out = await runEnsureState({ state: 'home', configPath: await validConfig() }, resolver(fake).resolve);
    expect(out.text).toMatch(/\nappAlive: true\n⚠ frame: /);
    expect(out.text.split('\n').at(-1)).toBe('⚠ frame: the screen did not settle: 6 captures, each different from the last, before the stability budget or the deadline ran out — an animation or live content; wait for it to finish or hide the live content and re-run — the last capture is returned as the best available');
    expect(out.shot).toEqual(frame('moving 5'));
  });

  it('runs in the environment the call names: the trace opens with it', async () => {
    const out = await runEnsureState(
      { state: 'home', environment: 'staging', configPath: await validConfig() },
      resolver(home()).resolve,
    );
    expect(out.text).toContain('environment staging');
    expect(out.text).toContain('overrides: username');
  });

  it('a missing or invalid averi.yaml fails before the adapter is resolved', async () => {
    for (const configPath of [missing(), await invalidConfig()]) {
      const { resolve, resolvedWith } = resolver(home());
      await expect(runEnsureState({ state: 'home', configPath }, resolve)).rejects.toThrow();
      expect(resolvedWith).toEqual([]);
    }
  });

  it('an unknown state is the engine\'s error, and no frame is captured for it', async () => {
    const fake = home();
    await expect(
      runEnsureState({ state: 'nowhere', configPath: await validConfig() }, resolver(fake).resolve),
    ).rejects.toThrow(/nowhere/);
    expect(fake.screenshots).toEqual([]);
  });
});

describe('runNamedFlow', () => {
  it('runs the flow on the resolved adapter and returns the trace with the health line', async () => {
    const fake = home();
    const { resolve, resolvedWith } = resolver(fake);
    const text = await runNamedFlow({ flow: 'open_menu', configPath: await validConfig() }, resolve);
    expect(fake.taps).toEqual(['menu_button']);
    expect(text).toMatch(/menu_button[\s\S]*\nappAlive: true$/);
    expect(resolvedWith).toHaveLength(1);
    expect(fake.screenshots).toEqual([]); // run_flow returns no frame
  });

  it('runs in the environment the call names; without one the trace names none', async () => {
    const configPath = await validConfig();
    const named = await runNamedFlow({ flow: 'open_menu', environment: 'staging', configPath }, resolver(home()).resolve);
    expect(named).toContain('environment staging');
    expect(named).toContain('overrides: username');
    const plain = await runNamedFlow({ flow: 'open_menu', configPath }, resolver(home()).resolve);
    expect(plain).not.toContain('environment');
  });

  it('an environment averi.yaml does not declare is refused, naming the known ones', async () => {
    await expect(
      runNamedFlow({ flow: 'open_menu', environment: 'nope', configPath: await validConfig() }, resolver(home()).resolve),
    ).rejects.toThrow(/Unknown environment "nope".*known: staging/);
  });

  it('the health line is the app\'s: a dead app is reported, not thrown', async () => {
    const fake = home();
    fake.appRunning = false;
    const text = await runNamedFlow({ flow: 'open_menu', configPath: await validConfig() }, resolver(fake).resolve);
    expect(text).toContain('appAlive: false — md.bank.app is not running!');
  });

  it('a missing averi.yaml fails before the adapter is resolved', async () => {
    const { resolve, resolvedWith } = resolver(home());
    await expect(runNamedFlow({ flow: 'open_menu', configPath: missing() }, resolve)).rejects.toThrow();
    expect(resolvedWith).toEqual([]);
  });
});

describe('runAsserts', () => {
  const run = (configPath: string, adapter = home()) =>
    runAsserts({
      adapter,
      specs: [{ element: { id: 'home_root' } }, { element: { id: 'nope' }, timeout: '0ms' }],
      baselineDir: baselineDirFor(configPath),
      configPath,
    });

  it('no averi.yaml → the verdict and one line per assert, and no health line', async () => {
    const text = await run(missing());
    expect(text).toMatch(/^1\/2 asserts FAILED\n/);
    expect(text).toContain('home_root');
    expect(text).toContain('FAIL  element id:"nope" exists');
    expect(text).not.toContain('appAlive');
  });

  it('with averi.yaml → the same text with the health line appended', async () => {
    const bare = await run(missing());
    expect(await run(await validConfig())).toBe(`${bare}\nappAlive: true`);
  });

  it('an INVALID averi.yaml → the results, silently no health (current behaviour; see the dated note in runAsserts)', async () => {
    const bare = await run(missing());
    expect(await run(await invalidConfig())).toBe(bare);
  });

  it('a throw from the health check itself is swallowed too (the catch is that broad; pinned, not endorsed)', async () => {
    const bare = await run(missing());
    // appHealth contains its own device errors, so the throw has to come from
    // somewhere it does not guard: the first thing it reads off the adapter.
    const fake = home();
    Object.defineProperty(fake, 'platform', {
      get() {
        throw new Error('adapter gone');
      },
    });
    expect(await run(await validConfig(), fake)).toBe(bare);
  });
});

describe('baselineDirFor', () => {
  it('hangs .averi/baselines off the directory of the averi.yaml the call named', () => {
    expect(baselineDirFor(join(dir, 'sub', 'averi.yaml'))).toBe(join(dir, 'sub', '.averi', 'baselines'));
  });

  it('with no configPath, off the cwd — where the default averi.yaml is looked up', () => {
    expect(baselineDirFor()).toBe(join(process.cwd(), '.averi', 'baselines'));
  });
});

describe('launchActivityFor — which activity a launch_app call starts', () => {
  const call = { platform: 'android' as const, appId: 'md.bank.app' };

  it('android, nothing named, averi.yaml describes this package → its activity', async () => {
    expect(await launchActivityFor({ ...call, configPath: await validConfig() })).toBe('.MainActivity');
  });

  it('another package → none', async () => {
    expect(await launchActivityFor({ ...call, appId: 'com.other.app', configPath: await validConfig() })).toBeUndefined();
  });

  it('a named activity is returned as given, on either platform', async () => {
    const configPath = await validConfig();
    expect(await launchActivityFor({ ...call, activity: '.ShareActivity', configPath })).toBe('.ShareActivity');
    expect(await launchActivityFor({ ...call, platform: 'ios', activity: '.X', configPath })).toBe('.X');
  });

  it('an intent alone suppresses the fallback — the one rule, shared with a flow launch step (resolveLaunchActivity)', async () => {
    expect(
      await launchActivityFor({ ...call, intent: { action: 'android.intent.action.SEND' }, configPath: await validConfig() }),
    ).toBeUndefined();
  });

  it('ios never gets one from the config', async () => {
    expect(await launchActivityFor({ ...call, platform: 'ios', configPath: await validConfig() })).toBeUndefined();
  });

  // The android half of the guard changes no answer (the rule says undefined
  // off android); what it does is keep an ios launch from loading averi.yaml
  // and .env.averi at all. Since 2026-10-04 the env file is read into a value,
  // not into process.env, so the observable is the stderr line the load
  // prints — each test gets its own temp dir, so the line is fresh each time.
  describe('beside a .env.averi', () => {
    const VAR = 'AVERI_COMMANDS_TEST_LAUNCH_ENV';
    const LOADED = `averi: loaded ${VAR} from .env.averi`;
    let stderr: ReturnType<typeof vi.spyOn>;
    beforeEach(async () => {
      stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
      await file('.env.averi', `${VAR}=loaded\n`);
    });
    afterEach(() => {
      stderr.mockRestore();
      expect(process.env[VAR]).toBeUndefined(); // never written, loaded or not
    });

    it('an ios call does not load the project config: nothing is said about the env file', async () => {
      expect(await launchActivityFor({ ...call, platform: 'ios', configPath: await validConfig() })).toBeUndefined();
      expect(stderr).not.toHaveBeenCalledWith(LOADED);
    });

    // The load is skipped by the RULE's own "when", not by platform alone:
    // an android call that names its entry point has no use for the config.
    it.each([
      ['an activity', { activity: '.ShareActivity' }, '.ShareActivity'],
      ['an intent', { intent: { action: 'android.intent.action.SEND' } }, undefined],
    ])('an android call naming %s does not load it either', async (_what, entry, activity) => {
      expect(await launchActivityFor({ ...call, ...entry, configPath: await validConfig() })).toBe(activity);
      expect(stderr).not.toHaveBeenCalledWith(LOADED);
    });

    it('control: the same call on android does load it', async () => {
      expect(await launchActivityFor({ ...call, configPath: await validConfig() })).toBe('.MainActivity');
      expect(stderr).toHaveBeenCalledWith(LOADED);
    });
  });

  it.each([
    ['missing', async () => missing()],
    ['present but invalid', invalidConfig],
  ])('a %s averi.yaml → none, not an error (the catch-all; pinned, see the dated follow-up)', async (_name, path) => {
    expect(await launchActivityFor({ ...call, configPath: await path() })).toBeUndefined();
  });
});
