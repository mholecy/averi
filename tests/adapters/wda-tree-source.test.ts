import { describe, expect, it, vi } from 'vitest';
import { WdaTreeSource } from '../../src/adapters/wda-tree-source.js';
import type { FetchFn } from '../../src/adapters/wda.js';
import { findOne } from '../../src/ui-tree/selectors.js';
import { fakeExec, fakeFetch, fakeSpawn, tempDerivedData, WDA_STATUS } from '../helpers/fake-wda.js';

// Raw /source envelope as WdaServer.source() returns it — the host-view
// `Other` node carrying the identifier is what the wda path exists for.
const WDA_ENVELOPE = {
  value: {
    type: 'Application',
    rawIdentifier: null,
    label: 'MyPort',
    rect: { x: 0, y: 0, width: 402, height: 874 },
    children: [
      {
        type: 'Other',
        rawIdentifier: 'home.header',
        label: null,
        rect: { x: 0, y: 100, width: 402, height: 50 },
        children: [
          {
            type: 'StaticText',
            rawIdentifier: 'home.title',
            label: 'Welcome',
            rect: { x: 16, y: 110, width: 200, height: 20 },
            children: [],
          },
        ],
      },
    ],
  },
  sessionId: 'abc-123',
};

/**
 * A REAL WdaServer behind the fakes that drive its own tests: /status is
 * refused until our fake spawn ran and again once our child was signalled
 * (the port goes quiet the moment xcodebuild's teardown runs, as on the
 * happy path), /source answers the envelope.
 */
async function setup() {
  const { dd } = await tempDerivedData(true);
  const spawner = fakeSpawn();
  const fetcher = fakeFetch((url) => {
    if (url.endsWith('/status')) {
      return spawner.spawns.length === 0 || spawner.kills.length > 0 ? 'refused' : { status: 200, body: WDA_STATUS };
    }
    return { status: 200, body: WDA_ENVELOPE };
  });
  const exec = fakeExec();
  const source = new WdaTreeSource({
    udid: 'AAAA-1111', exec: exec.fn, fetchFn: fetcher.fn, spawnFn: spawner.fn,
    derivedDataPath: dd, pollIntervalMs: 5,
  });
  return { source, spawner, fetcher, exec };
}

describe('WdaTreeSource — the WebDriverAgent adapter at the seam', () => {
  it('read brings ONE WebDriverAgent up for the bound UDID and returns the nested tree normalized', async () => {
    const { source, spawner, fetcher } = await setup();
    const tree = await source.read();
    await source.read();
    expect(spawner.spawns).toHaveLength(1); // one server, reused across reads
    expect(spawner.spawns[0].args).toContain('id=AAAA-1111');
    expect(fetcher.urls.filter((u) => u.endsWith('/source?format=json'))).toHaveLength(2);
    expect(tree).toMatchObject({ role: 'container', label: 'MyPort' }); // Application root, not a synthetic wrapper
    expect(findOne(tree, 'id:home.header')).toMatchObject({ role: 'container', rect: { x: 0, y: 100, width: 402, height: 50 } });
    expect(findOne(tree, 'id:home.title')).toMatchObject({ role: 'text', label: 'Welcome' });
  });

  it('constructing the source starts nothing: dispose before any read spawns, signals and probes nothing', async () => {
    const { source, spawner, fetcher, exec } = await setup();
    await source.dispose();
    expect(spawner.spawns).toEqual([]);
    expect(spawner.kills).toEqual([]);
    expect(fetcher.urls).toEqual([]);
    expect(exec.calls).toEqual([]);
  });

  it('dispose after a read IS WdaServer.shutdown: the child is signalled and the port is verified quiet before it resolves', async () => {
    const { source, spawner, fetcher } = await setup();
    await source.read();
    await source.dispose();
    expect(spawner.kills).toEqual(['SIGTERM']);
    // The last request is the port probe shutdown() polls — proof the wait
    // ran, i.e. dispose resolved on "port quiet", not on "signal sent".
    expect(fetcher.urls.at(-1)).toMatch(/\/status$/);
  });

  it('after dispose the source is terminal: a read is refused with the deselected/shutting-down hint, never a fresh server', async () => {
    // Reachable mid-flow: run_flow holds the adapter while a select_device
    // evicts and disposes it. The refusal must name THAT, not WdaServer's
    // "the process is exiting" — the process is not.
    const { source, spawner } = await setup();
    await source.read();
    await source.dispose();
    const refusal = source.read();
    await expect(refusal).rejects.toThrow(/deselected or averi is shutting down; select the device again/);
    await expect(refusal).rejects.not.toThrow(/process is exiting/);
    expect(spawner.spawns).toHaveLength(1);
  });

  it('a dispose before any read still makes later reads refuse — no server is ever started for a released source', async () => {
    const { source, spawner } = await setup();
    await source.dispose();
    await expect(source.read()).rejects.toThrow(/select the device again/);
    expect(spawner.spawns).toEqual([]);
  });

  it('dispose is idempotent — a second dispose signals nothing more', async () => {
    const { source, spawner } = await setup();
    await source.read();
    await source.dispose();
    await source.dispose();
    expect(spawner.kills).toEqual(['SIGTERM']);
  });
});

describe('WdaTreeSource — a read already in flight when the source is disposed', () => {
  // The common case during run_flow: the flow's adapter is mid-read when a
  // select_device evicts and disposes it. WdaServer fails the read in its
  // own words; the source must translate them into the deselection hint.
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  /** /status answers once spawned until killed; /source is held open until `fail()` rejects it. */
  async function holdable(ready: boolean) {
    const { dd } = await tempDerivedData(true);
    const spawner = fakeSpawn();
    let sourceRequested = false;
    let fail!: (err: Error) => void;
    const fetchFn: FetchFn = (url) => {
      if (url.endsWith('/status')) {
        if (!ready || spawner.spawns.length === 0 || spawner.kills.length > 0) return Promise.reject(new Error('ECONNREFUSED'));
        return Promise.resolve({ ok: true, status: 200, json: async () => WDA_STATUS });
      }
      sourceRequested = true;
      return new Promise((_, reject) => { fail = reject; });
    };
    const source = new WdaTreeSource({
      udid: 'AAAA-1111', exec: fakeExec().fn, fetchFn, spawnFn: spawner.fn, derivedDataPath: dd, pollIntervalMs: 5,
    });
    return { source, spawner, sourceRequested: () => sourceRequested, fail: (err: Error) => fail(err) };
  }

  it('mid-/source: dispose, then the socket dies — the read fails with the deselection hint, WdaServer\'s wording only as the cause', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined); // WdaServer logs its one restart attempt
    try {
      const { source, spawner, sourceRequested, fail } = await holdable(true);
      const inflight = source.read();
      while (!sourceRequested()) await sleep(2);
      await source.dispose();
      fail(new Error('ECONNRESET'));
      const err = await inflight.then(() => undefined, (e: unknown) => e as Error);
      expect(err?.message).toMatch(/deselected or averi is shutting down; select the device again/);
      expect(err?.message).not.toMatch(/process is exiting/);
      expect((err?.cause as Error)?.message).toMatch(/has been shut down/); // the server's reason is kept, underneath
      expect(spawner.spawns).toHaveLength(1); // the "restart once" path did not resurrect a server
    } finally {
      quiet.mockRestore();
    }
  });

  it('mid-startup: dispose while the read still waits for /status — the same hint, not "stopped during startup"', async () => {
    const { source, spawner } = await holdable(false); // /status never answers: the read polls in awaitReady
    const inflight = source.read();
    while (spawner.spawns.length === 0) await sleep(2);
    await source.dispose();
    const err = await inflight.then(() => undefined, (e: unknown) => e as Error);
    expect(err?.message).toMatch(/select the device again/);
    expect(err?.message).not.toMatch(/stopped during startup/);
    expect((err?.cause as Error)?.message).toMatch(/stopped during startup/);
  });

  it('a read that fails BEFORE any dispose keeps WdaServer\'s own wording — the hint is not a blanket rewrite', async () => {
    const { source, sourceRequested, fail } = await holdable(true);
    const inflight = source.read();
    while (!sourceRequested()) await sleep(2);
    fail(new Error('boom')); // /status still answers, so the server reports a wedged /source, no restart
    await expect(inflight).rejects.toThrow(/answered \/status but GET \/source did not complete \(boom\)/);
    await expect(inflight).rejects.not.toThrow(/select the device again/);
  });
});
