import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AveriConfig } from '../../src/flow/config.js';
import { EngineSession } from '../../src/flow/launch.js';
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
 * protocol cannot show cleanly — the ORDER (the pre-flight of names and environment before
 * the adapter is resolved), and what each function returns as a value. These
 * functions take the config the handler read (once, under the tool's policy
 * — flow/tool-config.ts), not a path: what a missing or broken averi.yaml
 * does to each tool is pinned through the protocol, in
 * tests/mcp/tools.test.ts, where the read happens.
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


  // D13: neither is an action and neither reads the other's
  // result, so the health line's `isAppRunning` (a pidof; its cost on
  // run/commands.ts#runOnEngine) and the final frame (its settle sleep and
  // screencaps) are out at once. The answer is held until the capture starts — or, run one
  // after the other, until a timeout gives up waiting for it — so the
  // events say whether the two overlapped.
  it('the health check and the final capture are out at once — the app is asked beside the frame', async () => {
    const fake = home();
    const events: string[] = [];
    let captureStarted!: () => void;
    const started = new Promise<void>((r) => (captureStarted = r));
    fake.isAppRunning = async () => {
      events.push('asked');
      await Promise.race([started, new Promise((r) => setTimeout(r, 100))]);
      events.push('answered');
      return true;
    };
    fake.screenshot = async () => {
      captureStarted();
      events.push('capture');
      fake.screenshots.push(frame('s'));
      return frame('s');
    };
    const { text, shot } = await runEnsureState({ session: new EngineSession(), state: 'home', project: await validProject() }, resolver(fake).resolve);
    // Out at once: asked before the frame's last capture, answered after its first.
    expect(events.indexOf('asked')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('asked')).toBeLessThan(events.lastIndexOf('capture'));
    expect(events.indexOf('capture')).toBeLessThan(events.indexOf('answered'));
    // The reply is the one the sequence gave: trace, then the health line.
    expect(text).toMatch(/home[\s\S]*\nappAlive: true$/);
    expect(shot).toEqual(frame('s'));
  });

  // Beside the frame, the health check still decides the call as it did after it: one that throws fails ensure_state,
  // as it fails every caller (run/app-health.ts, its one policy). appHealth words every device failure into the line,
  // so the throw is a broken adapter's — a log read that answers with something it cannot scan.
  it('a health check that throws still fails the call, frame or no frame', async () => {
    const fake = home();
    fake.appRunning = false;
    fake.logs = async () => null as unknown as string[];
    await expect(
      runEnsureState({ session: new EngineSession(), state: 'home', project: await validProject() }, resolver(fake).resolve),
    ).rejects.toThrow(TypeError);
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
  // theirs alike; run/preflight.ts#preflight has the why.
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

  // run/preflight.ts#preflight: a name averi.yaml does not define costs no device.
  it('a flow averi.yaml does not define is refused, naming the known ones — before the adapter is resolved', async () => {
    const r = resolver(home());
    await expect(
      runNamedFlow({ session: new EngineSession(), flow: 'open_menuu', project: await validProject() }, r.resolve),
    ).rejects.toThrow('Unknown flow "open_menuu" — known: open_menu\nNothing was run on a device.');
    expect(r.resolvedWith).toEqual([]);
  });

  it('ensure_state: a state averi.yaml does not define is refused before the adapter is resolved', async () => {
    const r = resolver(home());
    await expect(
      runEnsureState({ session: new EngineSession(), state: 'hom', project: await validProject() }, r.resolve),
    ).rejects.toThrow('Unknown state "hom" — known: home\nNothing was run on a device.');
    expect(r.resolvedWith).toEqual([]);
  });

  // runRequestOf reads "" as "none"; a call that names "" names a state or flow that cannot exist.
  it.each([
    ['ensure_state', 'state', (project: Awaited<ReturnType<typeof validProject>>, r: ReturnType<typeof resolver>) =>
      runEnsureState({ session: new EngineSession(), state: '', project }, r.resolve)],
    ['run_flow', 'flow', (project: Awaited<ReturnType<typeof validProject>>, r: ReturnType<typeof resolver>) =>
      runNamedFlow({ session: new EngineSession(), flow: '', project }, r.resolve)],
  ] as const)('%s: an empty %s name is refused as unknown, before the adapter is resolved', async (_tool, kind, run) => {
    const r = resolver(home());
    const known = kind === 'state' ? 'home' : 'open_menu';
    await expect(run(await validProject(), r)).rejects.toThrow(`Unknown ${kind} "" — known: ${known}\nNothing was run on a device.`);
    expect(r.resolvedWith).toEqual([]);
  });

  // Object.hasOwn, not `in` (flow/config.ts#defines): an inherited key is no state.
  it('a state named `constructor` is unknown, not inherited — refused before the adapter is resolved', async () => {
    const r = resolver(home());
    await expect(
      runEnsureState({ session: new EngineSession(), state: 'constructor', project: await validProject() }, r.resolve),
    ).rejects.toThrow('Unknown state "constructor" — known: home');
    expect(r.resolvedWith).toEqual([]);
  });

  it('an unknown flow and an unknown environment are ONE refusal naming both', async () => {
    const r = resolver(home());
    await expect(
      runNamedFlow({ session: new EngineSession(), flow: 'nope', environment: 'prod', project: await validProject() }, r.resolve),
    ).rejects.toThrow(
      'Unknown flow "nope" — known: open_menu\n' +
        'Unknown environment "prod" (from requested) — known: staging\n' +
        'Nothing was run on a device.',
    );
    expect(r.resolvedWith).toEqual([]);
  });

  it('with no environments declared the refusal says so in the same words', async () => {
    const r = resolver(home());
    const project = await loadForCall(
      REQUIRED_CONFIG_AND_ENV,
      await file('noenv.yaml', 'app:\n  android: { package: a.b }\nflows:\n  f:\n    steps:\n      - launch: {}\n'),
    );
    await expect(runNamedFlow({ session: new EngineSession(), flow: 'f', environment: 'prod', project }, r.resolve)).rejects.toThrow(
      'Unknown environment "prod" (from requested) — averi.yaml defines no environments\nNothing was run on a device.',
    );
    expect(r.resolvedWith).toEqual([]);
  });

  it('with no states defined the refusal says so, rather than an empty list', async () => {
    const r = resolver(home());
    const project = await loadForCall(REQUIRED_CONFIG_AND_ENV, await file('bare.yaml', 'app:\n  android: { package: a.b }\n'));
    await expect(runEnsureState({ session: new EngineSession(), state: 'home', project }, r.resolve)).rejects.toThrow(
      'Unknown state "home" — averi.yaml defines no states\nNothing was run on a device.',
    );
    expect(r.resolvedWith).toEqual([]);
  });

  // The one failure policy (run/app-health.ts): a broken adapter's throw from the health check fails run_flow, as it
  // fails ensure_state, assert and a verify leg.
  it('a health check that throws fails the call', async () => {
    const fake = home();
    fake.appRunning = false;
    fake.logs = async () => null as unknown as string[];
    await expect(
      runNamedFlow({ session: new EngineSession(), flow: 'open_menu', project: await validProject() }, resolver(fake).resolve),
    ).rejects.toThrow(TypeError);
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

  it('the whole reply, line for line: verdict, one line per assert, health line', async () => {
    expect(await run((await validProject()).cfg)).toBe(
      '1/2 asserts FAILED\n' +
        'PASS  element id:"home_root" exists\n' +
        'FAIL  element id:"nope" exists — not found within 0 s\n' +
        'appAlive: true',
    );
  });

  // The tool's schema takes an empty list (tools.ts#assertsInput sets no minimum). Its reply keeps the line the
  // missing assert lines leave, before the health line.
  it('no asserts → the vacuous verdict, an empty line, then the health line', async () => {
    const text = await runAsserts({
      adapter: home(),
      specs: [],
      baselineDir: baselineDirFor(missing()),
      cfg: (await validProject()).cfg,
    });
    expect(text).toBe('All 0 asserts passed\n\nappAlive: true');
  });

  // One failure policy for the health line (run/app-health.ts, A29): appHealth words every device failure into the
  // line itself, and anything else it throws is a broken adapter, which fails the call — here as in ensure_state,
  // run_flow and a verify leg. The throw is made where the other two callers' tests make it: a log read that answers
  // with something it cannot scan.
  it('a health check that throws fails the call, as it fails the other three callers', async () => {
    const fake = home();
    fake.appRunning = false;
    fake.logs = async () => null as unknown as string[];
    await expect(run((await validProject()).cfg, fake)).rejects.toThrow(TypeError);
  });

  // A throw from the asserts themselves is the call's failure, not a verdict to pass over.
  it('a throw from the asserts themselves fails the call', async () => {
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
 * ensure_state whose final capture throws (run/run-reply.ts#finalFrame):
 * the state WAS ensured — the trace and health line stand, one `⚠ screenshot:`
 * line says why there is no image, and no shot is returned.
 */
describe('runEnsureState — a refused final screenshot', () => {
  it('keeps the trace and the health line, adds the ⚠ line, and returns no shot', async () => {
    const fake = home();
    fake.screenshot = async () => {
      throw new Error('`adb -s emulator-5554 exec-out screencap -p` on device emulator-5554 returned 0 bytes — not a PNG\nmore');
    };
    const out = await runEnsureState({ session: new EngineSession(), state: 'home', project: await validProject() }, resolver(fake).resolve);
    expect(out.shot).toBeUndefined();
    expect(out.text).toMatch(/home[\s\S]*\nappAlive: true\n⚠ screenshot: /);
    expect(out.text.split('\n').at(-1)).toBe(
      '⚠ screenshot: `adb -s emulator-5554 exec-out screencap -p` on device emulator-5554 returned 0 bytes — not a PNG — no image is returned',
    );
  });
});
