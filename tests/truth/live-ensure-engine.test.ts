import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../../src/flow/config.js';
import { FlowEngine, formatTrace } from '../../src/flow/engine.js';
import { EngineSession } from '../../src/flow/launch.js';
import { caseConfig, selectCases } from '../../scripts/truth/live-cases.js';
import { bareEntry, heldStill } from '../../scripts/truth/replies.js';
import { FakeAdapter } from '../helpers/fake.js';
import { parseDump } from '../helpers/android-dumps.js';

// The reply lines the ensure judges read (replies.ts#bareEntry, #heldStill), taken from the ENGINE — the h1 and h3
// cases' own averi.yaml (live-cases.ts#caseConfig) run by FlowEngine over a fake held cell: a bare decor, then Welcome
// with Continue, Continue's tap showing Home — not from a hand-typed copy of engine.ts's wording. Virtual time, as in
// tests/flow/bare-tree-ladder.test.ts: every sleep recorded and the faked clock moved by it.
vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

const PKG = 'dev.averi.lab';
const androidXml = (content: string) => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="${PKG}" content-desc="" bounds="[0,0][1080,2400]">
    <node index="0" text="" resource-id="android:id/content" class="android.widget.FrameLayout" package="${PKG}" content-desc="" bounds="[0,0][1080,2400]">${content}</node>
    <node index="1" text="" resource-id="android:id/statusBarBackground" class="android.view.View" package="${PKG}" content-desc="" bounds="[0,0][1080,128]"/>
  </node>
</hierarchy>`;
const DECOR = parseDump(androidXml(''));
const WELCOME = parseDump(
  androidXml(`
      <node index="0" text="Welcome" resource-id="lab.held-no.welcome" class="android.widget.TextView" package="${PKG}" content-desc="" bounds="[340,1000][740,1100]"/>
      <node index="1" text="Continue" resource-id="lab.held-no.continue" class="android.widget.Button" package="${PKG}" content-desc="" bounds="[340,1200][740,1340]" clickable="true"/>`),
);
const HOME = parseDump(androidXml(`<node index="0" text="Home" resource-id="lab.held-no.home" class="android.widget.TextView" package="${PKG}" content-desc="" bounds="[340,1000][740,1100]"/>`));

/** The scaled-down engine (bare-tree-ladder.test.ts's FAST): Welcome at 30 ms, a 40-ms hold, a 1-s window. */
const FAST = { pollMs: 5, tapTimeoutMs: 60, waitTimeoutMs: 60, ensureTimeoutMs: 1000, optionalTimeoutMs: 30, assertTimeoutMs: 60, reachRecheckMs: 40, pinKeyDelayMs: 1, env: {} };

/** A fake held-no: the decor until 30 ms after its first read, then Welcome; a tap on Continue shows Home. */
function heldCell() {
  const fake = new FakeAdapter({}, 'unused');
  fake.viewportSize = { width: 1080, height: 2400 };
  let t0: number | undefined;
  let home = false;
  fake.uiTree = async () => {
    t0 ??= Date.now();
    return structuredClone(home ? HOME : Date.now() - t0 < 30 ? DECOR : WELCOME);
  };
  fake.tap = async () => {
    home = true;
  };
  return fake;
}

async function replyOf(id: 'h1' | 'h3'): Promise<string> {
  const [c] = await selectCases({ platform: 'android', app: 'native', groups: ['ensure'], only: [id] });
  const cfg = parseConfig(JSON.stringify(caseConfig('uiautomator', c, 'native')));
  const trace = await FlowEngine.run(cfg, heldCell(), { ...FAST, session: new EngineSession() }, { state: c.calls[0].args.state as string });
  return formatTrace(trace);
}

describe('the engine\'s own reply, read by the ensure judges\' readers', () => {
  it('h1 (no wipe ahead): the bare entry line and the held line, which names the rung and how long the screen held', async () => {
    const reply = await replyOf('h1');
    expect(reply).toContain('state home: reached after continue');
    expect(bareEntry(reply)).toBe(true);
    const held = heldStill(reply);
    expect(held?.flow).toBe('continue');
    expect(held!.heldS).toBeGreaterThanOrEqual(0.04);
    expect(held!.heldS).toBeLessThan(0.5);
  });

  it('h3 (a destructive rung ahead): the bare entry line, no held line', async () => {
    const reply = await replyOf('h3');
    expect(reply).toContain('state home: reached after continue');
    expect(bareEntry(reply)).toBe(true);
    expect(heldStill(reply)).toBeUndefined();
  });
});
