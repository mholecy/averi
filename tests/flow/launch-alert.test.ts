import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowEngine } from '../../src/flow/engine.js';
import { parseConfig } from '../../src/flow/config.js';
import { EngineSession } from '../../src/flow/launch.js';
import { resetSleeps } from '../helpers/sleep-recorder.js';
import { lab, LAB, LAUNCH_ALERT_NOTE as ALERT_NOTE, SPRINGBOARD, WDA_ALERT } from '../helpers/ios-lab.js';

// The one sleep owner, recorded and not waited on; under a Date-only fake clock each recorded sleep moves the clock
// by its length, so the foreground wait's deadline plays out in virtual time.
vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));

beforeEach(() => {
  resetSleeps();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// A flow's `launch:` behind iOS's system alert (D56; ADR 0032's D56 amendment), through a real IosAdapter on a fake
// WDA source (tests/helpers/ios-lab.ts): the launch's note is the flow's `⚠ launch` line, and the flow goes on.
describe("a flow's launch behind iOS's system alert (D56)", () => {
  it("a flow's launch: the `⚠ launch` line carries the alert note, and the flow goes on", async () => {
    const cfg = parseConfig('app:\n  ios: { bundleId: dev.averi.lab }\nflows:\n  open:\n    steps:\n      - launch: {}\n');
    const trace = await FlowEngine.run(cfg, lab([SPRINGBOARD], { tree: WDA_ALERT }).adapter, { env: {}, session: new EngineSession() }, { flow: 'open' });
    const at = trace.findIndex((t) => t.action === 'launch');
    expect(trace.slice(at, at + 2)).toEqual([
      { action: 'launch', detail: LAB },
      { action: '⚠ launch', detail: ALERT_NOTE },
    ]);
    expect(trace.at(-1)).toEqual({ action: 'flow open', detail: 'done' });
  });
});
