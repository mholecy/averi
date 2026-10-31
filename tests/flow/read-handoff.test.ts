import { describe, expect, it, vi } from 'vitest';

// The one sleep owner as a zero-delay macrotask yield, as in engine.test.ts.
vi.mock('../../src/util/sleep.js', () => ({ sleep: () => new Promise((r) => setTimeout(r, 0)) }));
import { parseConfig } from '../../src/flow/config.js';
import { FlowEngine, FlowError, type RunRequest } from '../../src/flow/engine.js';
import { EngineSession } from '../../src/flow/launch.js';
import { FakeAdapter, node, screen } from '../helpers/fake.js';

// The flow engine's share of the read hand-off (docs/adr/0030-a-read-is-handed-on-only-as-a-first-sample-or-a-
// positive-verdict.md), counted in device reads on a fake: the ladder's re-detect after a rung that ended in a
// `wait:` reads nothing; after a tap, or on a detect that asks an absence, it reads fresh; a flow's tap after a
// `wait:` settles on one fresh read; nothing crosses runs; and a handed `no` never becomes the ladder's knowledge.

const CFG = parseConfig(`
app:
  android: { package: com.example.app }
states:
  home:
    detect: { element: { id: home } }
    reach: [open_home]
  home_by_tap:
    detect: { element: { id: home } }
    reach: [tap_home]
  home_no_prompt:
    detect:
      all:
        - element: { id: home }
        - element: { id: prompt }
          absent: true
    reach: [open_home]
  guarded:
    detect: { element: { id: home } }
    reach: [wait_go, wipe]
flows:
  open_home:
    steps:
      - tap: { id: go }
      - wait: { element: { id: home } }
  tap_home:
    steps:
      - tap: { id: go }
  wait_go:
    steps:
      - wait: { element: { id: go } }
  wait_then_tap:
    steps:
      - wait: { element: { id: go } }
      - tap: { id: go }
  tap_go:
    steps:
      - tap: { id: go }
  wipe:
    steps:
      - launch: { clearState: true }
`);

const OPTS = { pollMs: 5, tapTimeoutMs: 200, waitTimeoutMs: 300, ensureTimeoutMs: 100, reachRecheckMs: 50, env: {} };

/** A start screen with a `go` button that leads home, every read counted. */
function counted() {
  const label = (id: string, y: number) =>
    node({ role: 'button', identifier: id, label: id, rect: { x: 0, y, width: 200, height: 40 } });
  const fake = new FakeAdapter(
    { start: screen(label('go', 100), label('other', 200)), home: screen(label('home', 100), label('other', 200)) },
    'start',
    (id, self) => {
      if (id === 'go') self.current = 'home';
    },
  );
  let reads = 0;
  const real = fake.uiTree.bind(fake);
  fake.uiTree = async () => {
    reads++;
    return real();
  };
  return { fake, reads: () => reads };
}

const run = (fake: FakeAdapter, request: RunRequest) =>
  FlowEngine.run(CFG, fake, { ...OPTS, session: new EngineSession() }, request);

describe('FlowEngine — the read hand-off', () => {
  // The entry probe is a producer too: the rung's tap takes its read as the settle's first sample, so the tap reads
  // once. Every count below starts with those two.
  it('a rung ending in a wait: the re-detect after it reads nothing (entry 1, tap 1, wait 1)', async () => {
    const { fake, reads } = counted();
    const trace = await run(fake, { state: 'home' });
    expect(trace.at(-1)).toEqual({ action: 'state home', detail: 'reached after open_home' });
    expect(reads()).toBe(3);
  });

  it('a rung ending in a tap: the re-detect reads fresh (entry 1, tap 1, detect 1)', async () => {
    const { fake, reads } = counted();
    await run(fake, { state: 'home_by_tap' });
    expect(reads()).toBe(3);
  });

  it('a detect that asks an absence reads fresh after a wait (entry 1, tap 1, wait 1, detect 1)', async () => {
    const { fake, reads } = counted();
    await run(fake, { state: 'home_no_prompt' });
    expect(reads()).toBe(4);
  });

  it('a tap after a wait settles on the wait\'s read and one fresh read', async () => {
    const { fake, reads } = counted();
    await run(fake, { flow: 'wait_then_tap' });
    expect(fake.taps).toEqual(['go']);
    expect(reads()).toBe(2);
  });

  it('nothing crosses runs: a run that starts with a tap settles on two fresh reads', async () => {
    const { fake, reads } = counted();
    await run(fake, { flow: 'wait_go' });
    await run(fake, { flow: 'tap_go' });
    expect(reads()).toBe(3);
  });

  // The ladder's safety rests on its probe's `bare` and `unknown`: a destructive rung is refused when the probe
  // before it read nothing rendered. The rung's wait read a rendered screen without `home`; every read after it is
  // the bare decor of a relaunching app. Counted as rendered, that handed tree would make the probe `no`, and the
  // wipe would run.
  it('a handed `no` is not knowledge: bare fresh reads after it still refuse the destructive rung', async () => {
    const { fake, reads } = counted();
    const counting = fake.uiTree;
    fake.uiTree = async () => (reads() >= 2 ? screen() : counting());
    const failure = await run(fake, { state: 'guarded' }).then(() => undefined, (e: unknown) => e);
    expect(failure).toBeInstanceOf(FlowError);
    expect(String((failure as Error).message)).toMatch(/refused/);
    expect(fake.launches).toEqual([]);
  });
});
