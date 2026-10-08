import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AveriConfig } from '../../src/flow/config.js';
import { EngineSession } from '../../src/flow/engine.js';
import { Verifier } from '../../src/verify/assert.js';
import { loadForCall, REQUIRED_CONFIG_AND_ENV } from '../../src/flow/tool-config.js';
import {
  baselineDirFor,
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
 * protocol cannot show cleanly — the ORDER (the environment pre-flight before
 * the adapter is resolved), and what each function returns as a value. Since
 * 2026-10-08 these functions take the config the handler read (once, under
 * the tool's policy — flow/tool-config.ts), not a path: what a missing or
 * broken averi.yaml does to each tool is pinned through the protocol, in
 * tests/mcp/tools.test.ts, where the read now happens.
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
const missing = () => join(dir, 'no-such-averi.yaml');
/** The project an ensure_state / run_flow handler hands down: the valid config and its environment, read as the tool's policy reads them. */
const validProject = async () => loadForCall(REQUIRED_CONFIG_AND_ENV, await validConfig());

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
    const out = await runEnsureState({ session: new EngineSession(), state: 'home', project: await validProject() }, resolve);
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
    const out = await runEnsureState({ session: new EngineSession(), state: 'home', project: await validProject() }, resolver(fake).resolve);
    expect(out.text).toMatch(/\nappAlive: true\n⚠ frame: /);
    expect(out.text.split('\n').at(-1)).toBe('⚠ frame: the screen did not settle: 6 captures, each different from the last, before the stability budget or the deadline ran out — an animation or live content; wait for it to finish or hide the live content and re-run — the last capture is returned as the best available');
    expect(out.shot).toEqual(frame('moving 5'));
  });

  it('runs in the environment the call names: the trace opens with it', async () => {
    const out = await runEnsureState(
      { session: new EngineSession(), state: 'home', environment: 'staging', project: await validProject() },
      resolver(home()).resolve,
    );
    expect(out.text).toContain('environment staging');
    expect(out.text).toContain('overrides: username');
  });


  it('an unknown state is the engine\'s error, and no frame is captured for it', async () => {
    const fake = home();
    await expect(
      runEnsureState({ session: new EngineSession(), state: 'nowhere', project: await validProject() }, resolver(fake).resolve),
    ).rejects.toThrow(/nowhere/);
    expect(fake.screenshots).toEqual([]);
  });
});

describe('runNamedFlow', () => {
  it('runs the flow on the resolved adapter and returns the trace with the health line', async () => {
    const fake = home();
    const { resolve, resolvedWith } = resolver(fake);
    const text = await runNamedFlow({ session: new EngineSession(), flow: 'open_menu', project: await validProject() }, resolve);
    expect(fake.taps).toEqual(['menu_button']);
    expect(text).toMatch(/menu_button[\s\S]*\nappAlive: true$/);
    expect(resolvedWith).toHaveLength(1);
    expect(fake.screenshots).toEqual([]); // run_flow returns no frame
  });

  it('runs in the environment the call names; without one the trace names none', async () => {
    const project = await validProject();
    const named = await runNamedFlow({ session: new EngineSession(), flow: 'open_menu', environment: 'staging', project }, resolver(home()).resolve);
    expect(named).toContain('environment staging');
    expect(named).toContain('overrides: username');
    const plain = await runNamedFlow({ session: new EngineSession(), flow: 'open_menu', project }, resolver(home()).resolve);
    expect(plain).not.toContain('environment');
  });

  // run_flow and ensure_state share runOnEngine, so the pre-flight below is
  // theirs alike; run/preflight.ts#refuseUnknownEnvironment has the why.
  it('an environment averi.yaml does not declare is refused, naming the known ones — before the adapter is resolved', async () => {
    const r = resolver(home());
    await expect(
      runNamedFlow({ session: new EngineSession(), flow: 'open_menu', environment: 'nope', project: await validProject() }, r.resolve),
    ).rejects.toThrow('Unknown environment "nope" (from requested) — known: staging');
    expect(r.resolvedWith).toEqual([]);
  });

  it('ensure_state takes the same pre-flight: no adapter is resolved for an undeclared environment', async () => {
    const r = resolver(home());
    await expect(
      runEnsureState({ session: new EngineSession(), state: 'home', environment: 'nope', project: await validProject() }, r.resolve),
    ).rejects.toThrow('Unknown environment "nope" (from requested) — known: staging');
    expect(r.resolvedWith).toEqual([]);
  });

  it('the health line is the app\'s: a dead app is reported, not thrown', async () => {
    const fake = home();
    fake.appRunning = false;
    const text = await runNamedFlow({ session: new EngineSession(), flow: 'open_menu', project: await validProject() }, resolver(fake).resolve);
    expect(text).toContain('appAlive: false — md.bank.app is not running!');
  });

});

describe('runAsserts', () => {
  const run = (cfg: AveriConfig | undefined, adapter = home()) =>
    runAsserts({
      adapter,
      specs: [{ element: { id: 'home_root' } }, { element: { id: 'nope' }, timeout: '0ms' }],
      baselineDir: baselineDirFor(missing()),
      cfg,
    });

  it('no config → the verdict and one line per assert, and no health line', async () => {
    const text = await run(undefined);
    expect(text).toMatch(/^1\/2 asserts FAILED\n/);
    expect(text).toContain('home_root');
    expect(text).toContain('FAIL  element id:"nope" exists');
    expect(text).not.toContain('appAlive');
  });

  it('with a config → the same text with the health line appended', async () => {
    const bare = await run(undefined);
    expect(await run((await validProject()).cfg)).toBe(`${bare}\nappAlive: true`);
  });

  // A throw outside appHealth's own guard costs the health line and nothing
  // else — the narrow guard kept from the old catch-all (2026-10-08 code
  // review: the verdict change the wide removal made was not taken).
  it('a throw from the health check itself omits the health line; the verdict and the results stand', async () => {
    const bare = await run(undefined);
    const fake = home();
    // appHealth contains its own device errors, so the throw has to come from
    // somewhere it does not guard: the first thing it reads off the adapter.
    Object.defineProperty(fake, 'platform', {
      get() {
        throw new Error('adapter gone');
      },
    });
    expect(await run((await validProject()).cfg, fake)).toBe(bare);
  });

  // The guard is the health check's ALONE: a throw from the asserts
  // themselves is the call's failure, not a verdict to pass over.
  it('a throw from the asserts themselves fails the call — the guard does not reach them', async () => {
    const assertAll = vi.spyOn(Verifier.prototype, 'assertAll').mockRejectedValue(new Error('verifier broke'));
    try {
      await expect(run((await validProject()).cfg)).rejects.toThrow('verifier broke');
    } finally {
      assertAll.mockRestore();
    }
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

/**
 * ensure_state whose final capture throws (2026-10-08, run/verify.ts#finalFrame):
 * the state WAS ensured — the trace and health line stand, one `⚠ screenshot:`
 * line says why there is no image, and no shot is returned.
 */
describe('runEnsureState — a refused final screenshot', () => {
  it('keeps the trace and the health line, adds the ⚠ line, and returns no shot', async () => {
    const fake = home();
    fake.screenshot = async () => {
      throw new Error('`adb exec-out screencap -p` on the default adb device returned 0 bytes — not a PNG\nmore');
    };
    const out = await runEnsureState({ session: new EngineSession(), state: 'home', project: await validProject() }, resolver(fake).resolve);
    expect(out.shot).toBeUndefined();
    expect(out.text).toMatch(/home[\s\S]*\nappAlive: true\n⚠ screenshot: /);
    expect(out.text.split('\n').at(-1)).toBe(
      '⚠ screenshot: `adb exec-out screencap -p` on the default adb device returned 0 bytes — not a PNG — no image is returned',
    );
  });
});
