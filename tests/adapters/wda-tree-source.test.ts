import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { WDA_SETTLE_CADENCE_MS, WdaTreeSource } from '../../src/adapters/wda-tree-source.js';
import { SYSTEM_ALERT_SOURCE_TIMEOUT_MS, type FetchFn } from '../../src/adapters/wda.js';
import { findAll } from '../../src/ui-tree/selectors.js';
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

/** `GET /wda/activeAppInfo`'s envelope, as FBCustomCommands.m#handleActiveAppInfo answers it (WDA 16.1.7). */
const ACTIVE_LAB = { value: { pid: 4242, bundleId: 'dev.averi.lab', name: '', processArguments: {} }, sessionId: null };

/**
 * A REAL WdaServer behind the fakes that drive its own tests: /status is
 * refused until our fake spawn ran and again once that child was signalled (a later spawn answers)
 * (the port goes quiet the moment xcodebuild's teardown runs, as on the
 * happy path), /source answers the envelope.
 */
async function setup(
  activeApp: () => 'refused' | { status: number; body?: unknown } = () => ({ status: 200, body: ACTIVE_LAB }),
  sourceAnswer: () => { status: number; body?: unknown } = () => ({ status: 200, body: WDA_ENVELOPE }),
  /** Wraps the fake fetch the server is given (D54's hung read). */
  wrap: (fn: FetchFn) => FetchFn = (fn) => fn,
) {
  const { dd } = await tempDerivedData(true);
  const spawner = fakeSpawn();
  const fetcher = fakeFetch((url) => {
    if (url.endsWith('/status')) {
      // Alive while a spawned child is not yet signalled: a kill quiets the port, a fresh spawn answers again.
      return spawner.kills.length < spawner.spawns.length ? { status: 200, body: WDA_STATUS } : 'refused';
    }
    if (url.endsWith('/wda/activeAppInfo')) return activeApp();
    return sourceAnswer();
  });
  const exec = fakeExec();
  const source = new WdaTreeSource({
    udid: 'AAAA-1111', exec: exec.fn, fetchFn: wrap(fetcher.fn), spawnFn: spawner.fn,
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
    expect(findAll(tree, 'id:home.header')).toHaveLength(1);
    expect(findAll(tree, 'id:home.header')[0]).toMatchObject({ role: 'container', rect: { x: 0, y: 100, width: 402, height: 50 } });
    expect(findAll(tree, 'id:home.title')).toHaveLength(1);
    expect(findAll(tree, 'id:home.title')[0]).toMatchObject({ role: 'text', label: 'Welcome' });
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

describe('WdaTreeSource.bringUp — WebDriverAgent up without a tree read (treeSource auto, A41a)', () => {
  it('starts ONE WebDriverAgent and reads no tree; the read after it reuses it', async () => {
    const { source, spawner, fetcher } = await setup();
    await source.bringUp();
    expect(spawner.spawns).toHaveLength(1);
    expect(fetcher.urls.filter((u) => u.includes('/source'))).toEqual([]);
    await source.read();
    expect(spawner.spawns).toHaveLength(1);
  });

  it('a WebDriverAgent that cannot come up fails it in WdaServer\'s words', async () => {
    const { dd } = await tempDerivedData(true);
    const fetcher = fakeFetch(() => ({ status: 200, body: WDA_STATUS })); // answering before we spawned: not ours
    const source = new WdaTreeSource({ udid: 'AAAA-1111', exec: fakeExec().fn, fetchFn: fetcher.fn, spawnFn: fakeSpawn().fn, derivedDataPath: dd, pollIntervalMs: 5 });
    await expect(source.bringUp()).rejects.toThrow(/but this session did not start it/);
  });

  it('after dispose: the released error, nothing started', async () => {
    const { source, spawner, fetcher } = await setup();
    await source.dispose();
    await expect(source.bringUp()).rejects.toThrow(/select the device again/);
    expect(spawner.spawns).toEqual([]);
    expect(fetcher.urls).toEqual([]);
  });
});

describe('WdaTreeSource.prewarm — WebDriverAgent started in the background, never awaited (treeSource wda, A41b)', () => {
  const drain = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('returns before anything started; the start runs in the background and the first read reuses it — one WebDriverAgent', async () => {
    const { source, spawner, fetcher } = await setup();
    expect(source.prewarm()).toBeUndefined();
    expect(spawner.spawns).toEqual([]);
    await vi.waitFor(() => expect(spawner.spawns).toHaveLength(1));
    expect(fetcher.urls.filter((u) => u.includes('/source'))).toEqual([]);
    await source.read();
    source.prewarm();
    await source.read();
    expect(spawner.spawns).toHaveLength(1);
    await source.dispose();
  });

  it('a read racing it joins the same start (WdaServer.ensureRunning is single-flight)', async () => {
    const { source, spawner } = await setup();
    source.prewarm();
    await source.read();
    expect(spawner.spawns).toHaveLength(1);
    await source.dispose();
  });

  it('WebDriverAgent not built: nothing at all — no build, no /status, no spawn; the first read builds as before', async () => {
    const { dd } = await tempDerivedData(false);
    const spawner = fakeSpawn();
    const fetcher = fakeFetch(() => 'refused');
    const exec = fakeExec();
    const source = new WdaTreeSource({ udid: 'AAAA-1111', exec: exec.fn, fetchFn: fetcher.fn, spawnFn: spawner.fn, derivedDataPath: dd, pollIntervalMs: 5 });
    source.prewarm();
    await drain();
    await drain();
    expect(spawner.spawns).toEqual([]);
    expect(fetcher.urls).toEqual([]);
    expect(exec.calls).toEqual([]);
  });

  it('a start that fails is no rejection anywhere; the read after it fails in its own words', async () => {
    const { dd } = await tempDerivedData(true);
    const fetcher = fakeFetch(() => ({ status: 200, body: WDA_STATUS })); // answering before we spawned: not ours
    const source = new WdaTreeSource({ udid: 'AAAA-1111', exec: fakeExec().fn, fetchFn: fetcher.fn, spawnFn: fakeSpawn().fn, derivedDataPath: dd, pollIntervalMs: 5 });
    const unhandled: unknown[] = [];
    const hear = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', hear);
    try {
      source.prewarm();
      await vi.waitFor(() => expect(fetcher.urls.length).toBeGreaterThan(0));
      await drain();
      await drain();
    } finally {
      process.off('unhandledRejection', hear);
    }
    expect(unhandled).toEqual([]);
    const probes = () => fetcher.urls.filter((u) => u.endsWith('/status')).length;
    const before = probes();
    await expect(source.read()).rejects.toThrow(/but this session did not start it/);
    expect(probes()).toBeGreaterThan(before); // the read started again — the failed start was not kept
  });

  it('WebDriverAgent already up: nothing is asked — no /status probe at every launch', async () => {
    const { source, fetcher } = await setup();
    await source.read();
    const asked = fetcher.urls.length;
    source.prewarm();
    await drain();
    await drain();
    expect(fetcher.urls.length).toBe(asked);
    await source.dispose();
  });

  it('released: starts nothing', async () => {
    const { source, spawner, fetcher } = await setup();
    await source.dispose();
    source.prewarm();
    await drain();
    expect(spawner.spawns).toEqual([]);
    expect(fetcher.urls).toEqual([]);
  });

  it('released while it looked for the build: starts nothing', async () => {
    const { source, spawner, fetcher } = await setup();
    source.prewarm();
    await source.dispose();
    await drain();
    await drain();
    expect(spawner.spawns).toEqual([]);
    expect(fetcher.urls.filter((u) => !u.endsWith('/status'))).toEqual([]);
  });

  it('buildCached answers whether the WebDriverAgent build is in DerivedData', async () => {
    const built = await tempDerivedData(true);
    const none = await tempDerivedData(false);
    const at = (dd: string) => new WdaTreeSource({ udid: 'AAAA-1111', exec: fakeExec().fn, fetchFn: fakeFetch(() => 'refused').fn, spawnFn: fakeSpawn().fn, derivedDataPath: dd });
    expect(await at(built.dd).buildCached()).toBe(true);
    expect(await at(none.dd).buildCached()).toBe(false);
  });
});

describe('WdaTreeSource.settleCadenceMs — measured 300 (A41b, ADR 0040)', () => {
  it('is WDA_SETTLE_CADENCE_MS, 300 ms', async () => {
    expect(WDA_SETTLE_CADENCE_MS).toBe(300);
    const { source } = await setup();
    expect(source.settleCadenceMs).toBe(WDA_SETTLE_CADENCE_MS);
  });
});

describe('WdaTreeSource.applicationLabel — which app WebDriverAgent reads, asked only of a WDA that is up (D48)', () => {
  const asked = (urls: string[]) => urls.filter((u) => u.endsWith('/wda/activeAppInfo'));

  it('before any read WDA is not up: declined — nothing spawned, nothing fetched, no idb', async () => {
    const { source, spawner, fetcher, exec } = await setup();
    expect(await source.applicationLabel()).toEqual({ kind: 'declined' });
    expect(spawner.spawns).toEqual([]);
    expect(fetcher.urls).toEqual([]);
    expect(exec.calls).toEqual([]);
  });

  // Review of D54: the ask's own 2 s budget (ACTIVE_APP_TIMEOUT_MS), not /source's 30 s.
  it('the ask runs under its own 2 s budget', async () => {
    const { source } = await setup();
    await source.read();
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await source.applicationLabel();
    expect(timeout.mock.calls).toEqual([[2_000]]);
    timeout.mockRestore();
  });

  it('after a read: one GET /wda/activeAppInfo, no /source, no /status — the bundle it names', async () => {
    const { source, spawner, fetcher } = await setup();
    await source.read();
    const before = fetcher.urls.length;
    expect(await source.applicationLabel()).toEqual({ kind: 'bundle', bundleId: 'dev.averi.lab' });
    expect(fetcher.urls.slice(before)).toEqual([expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/wda\/activeAppInfo$/)]);
    expect(spawner.spawns).toHaveLength(1);
  });

  // T4: real envelopes, as WDA 16.1.7 answered them on the averi-lab iPhone 17 simulator (iOS 27.0): batch-4's D49
  // (main 7e6d2d47) after averilab://cell/open from SpringBoard (the lab) and after https://example.com (Safari), and
  // batch-5's D49A E2 (main 28c1d37d) with the "Open in “AveriLab”?" alert up (SpringBoard). Each has `name: ""`,
  // `sessionId: null` and `processArguments` with empty `env` and `args` — what the hand-written ACTIVE_LAB abbreviates.
  it.each([
    ['wda-activeappinfo-lab-b4.json', 'dev.averi.lab'],
    ['wda-activeappinfo-mobilesafari-b4.json', 'com.apple.mobilesafari'],
    ['wda-activeappinfo-springboard-b5.json', 'com.apple.springboard'],
  ])('a real envelope (%s): the bundle it names', async (name, bundleId) => {
    const body = JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')) as { value: Record<string, unknown>; sessionId: unknown };
    expect(body).toMatchObject({ value: { name: '', processArguments: { env: {}, args: [] }, bundleId }, sessionId: null });
    const { source } = await setup(() => ({ status: 200, body }));
    await source.read();
    expect(await source.applicationLabel()).toEqual({ kind: 'bundle', bundleId });
  });

  it.each([
    ['no bundleId', { value: { pid: 1 } }],
    ['an empty bundleId', { value: { bundleId: '' } }],
    ['a bundleId that is not a string', { value: { bundleId: 7 } }],
    ['no value', {}],
    ['a null body', null],
  ])('a payload with %s: unlabelled', async (_what, body) => {
    const { source } = await setup(() => ({ status: 200, body }));
    await source.read();
    expect(await source.applicationLabel()).toEqual({ kind: 'unlabelled' });
  });

  it.each([
    ['refused', () => 'refused' as const, /activeAppInfo request failed on port \d+ \(udid AAAA-1111\): ECONNREFUSED/],
    ['HTTP 500', () => ({ status: 500 }), /activeAppInfo failed: HTTP 500 on port \d+ \(udid AAAA-1111\)/],
  ])('%s: throws in WDA\'s words, naming the port and the log — and starts or restarts nothing', async (_what, answer, words) => {
    const { source, spawner, fetcher } = await setup(answer);
    await source.read();
    const before = fetcher.urls.length;
    const err = await source.applicationLabel().then(() => undefined, (e: unknown) => e as Error);
    expect(err?.message).toMatch(words);
    expect(err?.message).toMatch(/xcodebuild log: .*averi-wda-AAAA-1111\.log/);
    expect(asked(fetcher.urls)).toHaveLength(1); // one ask, no retry
    expect(fetcher.urls.slice(before).filter((u) => !u.endsWith('/wda/activeAppInfo'))).toEqual([]);
    expect(spawner.spawns).toHaveLength(1);
    expect(spawner.kills).toEqual([]);
  });

  it('after a failed ask, the same WDA child is not asked again: each later launch gets the remembered error at once (never a silent decline); a restart asks again', async () => {
    let answer: 'refused' | { status: number; body?: unknown } = 'refused';
    const { source, fetcher } = await setup(() => answer);
    await source.read();
    const first = await source.applicationLabel().then(() => undefined, (e: unknown) => e as Error);
    expect(first?.message).toMatch(/activeAppInfo request failed/);
    answer = { status: 200, body: ACTIVE_LAB }; // even an answering server: this child is not asked again until a read proves it
    for (let i = 0; i < 2; i++) {
      const again = await source.applicationLabel().then(() => undefined, (e: unknown) => e as Error);
      expect(again).toBe(first); // the remembered error, so the launch's note still says it could not check
    }
    expect(asked(fetcher.urls)).toHaveLength(1);
    // A restart is a new child: asked again.
    (source as unknown as { server: { stop(): void } }).server.stop();
    expect(await source.applicationLabel()).toEqual({ kind: 'declined' }); // not up until a read starts it
    await source.read();
    expect(await source.applicationLabel()).toEqual({ kind: 'bundle', bundleId: 'dev.averi.lab' });
    expect(asked(fetcher.urls)).toHaveLength(2);
  });

  it('a restart is a new child, asked again even when no /source read has succeeded on it', async () => {
    let answer: 'refused' | { status: number; body?: unknown } = 'refused';
    let source500 = false;
    const { source, spawner, fetcher } = await setup(() => answer, () => (source500 ? { status: 500 } : { status: 200, body: WDA_ENVELOPE }));
    await source.read();
    await expect(source.applicationLabel()).rejects.toThrow(/activeAppInfo request failed/);
    (source as unknown as { server: { stop(): void } }).server.stop();
    source500 = true;
    await expect(source.read()).rejects.toThrow(/HTTP 500/); // the restart reached /status, its /source failed
    expect(spawner.spawns).toHaveLength(2);
    answer = { status: 200, body: ACTIVE_LAB };
    expect(await source.applicationLabel()).toEqual({ kind: 'bundle', bundleId: 'dev.averi.lab' });
    expect(asked(fetcher.urls)).toHaveLength(2);
  });

  it('a successful /source read clears a failed ask: the same child is asked again once it has answered a read', async () => {
    let answer: 'refused' | { status: number; body?: unknown } = 'refused';
    const { source, spawner, fetcher } = await setup(() => answer);
    await source.read();
    await expect(source.applicationLabel()).rejects.toThrow(/activeAppInfo request failed/);
    answer = { status: 200, body: ACTIVE_LAB };
    await source.read(); // the same child (no restart) answered /source
    expect(spawner.spawns).toHaveLength(1);
    expect(await source.applicationLabel()).toEqual({ kind: 'bundle', bundleId: 'dev.averi.lab' });
    expect(asked(fetcher.urls)).toHaveLength(2);
  });

  it('after dispose: the released error, nothing asked', async () => {
    const { source, fetcher } = await setup();
    await source.read();
    await source.dispose();
    await expect(source.applicationLabel()).rejects.toThrow(/deselected or averi is shutting down; select the device again/);
    expect(asked(fetcher.urls)).toEqual([]);
  });

  it('after our xcodebuild child exited, WDA is not up: declined — no ask, no spawn', async () => {
    const { source, spawner, fetcher } = await setup();
    await source.read();
    spawner.children[0].exit.forEach((l) => l());
    expect(await source.applicationLabel()).toEqual({ kind: 'declined' });
    expect(asked(fetcher.urls)).toEqual([]);
    expect(spawner.spawns).toHaveLength(1);
  });
});

// D54 (ADR 0032's D54 amendment): at a link's bound, with SpringBoard last named, ONE /source read for iOS's system
// alert. It is an aid to the reply, not a read the agent asked for: it never starts or restarts WebDriverAgent, never
// probes /status, and has its own short budget — a hung or failed read fails, and the wait falls back to its note.
describe('WdaTreeSource.systemAlert — one short /source read, never a start or a restart (D54)', () => {
  const ALERT_ENVELOPE = JSON.parse(readFileSync(new URL('../fixtures/wda-capture-springboard-open-in-alert.json', import.meta.url), 'utf8')) as unknown;
  const sources = (urls: string[]) => urls.filter((u) => u.includes('/source'));

  it('WDA not up (before any read): undefined — nothing spawned, nothing fetched', async () => {
    const { source, spawner, fetcher } = await setup();
    expect(await source.systemAlert()).toBeUndefined();
    expect(spawner.spawns).toEqual([]);
    expect(fetcher.urls).toEqual([]);
  });

  it('up: one GET /source, no /status — the alert in it (ios-system-alert.ts#alertInWda)', async () => {
    let body: unknown = WDA_ENVELOPE;
    const { source, fetcher } = await setup(undefined, () => ({ status: 200, body }));
    await source.read();
    body = ALERT_ENVELOPE;
    const before = fetcher.urls.length;
    expect(await source.systemAlert()).toEqual({
      title: 'Open in “AveriLab”?',
      buttons: [
        { label: 'Cancel', centre: { x: 127, y: 474 } },
        { label: 'Open', centre: { x: 275, y: 474 } },
      ],
    });
    expect(fetcher.urls.slice(before)).toEqual([expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/source\?format=json$/)]);
  });

  it(`under its own budget, ${SYSTEM_ALERT_SOURCE_TIMEOUT_MS} ms — not /source's 30 s`, async () => {
    const { source } = await setup();
    await source.read();
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await source.systemAlert();
    expect(timeout.mock.calls).toEqual([[SYSTEM_ALERT_SOURCE_TIMEOUT_MS]]);
    expect(SYSTEM_ALERT_SOURCE_TIMEOUT_MS).toBe(2_000);
    timeout.mockRestore();
  });

  it.each([
    ['refused', () => 'refused' as const, /\/source request failed on port \d+ \(udid AAAA-1111\): ECONNREFUSED/],
    ['HTTP 500', () => ({ status: 500 }), /\/source failed: HTTP 500 on port \d+ \(udid AAAA-1111\)/],
  ])('%s: throws in WDA\'s words — one request, no /status probe, no restart', async (_what, answer, words) => {
    let fail = false;
    const { source, spawner, fetcher } = await setup(undefined, () => (fail ? (answer() as { status: number }) : { status: 200, body: WDA_ENVELOPE }));
    await source.read();
    fail = true;
    const before = fetcher.urls.length;
    await expect(source.systemAlert()).rejects.toThrow(words);
    expect(fetcher.urls.slice(before)).toHaveLength(1);
    expect(sources(fetcher.urls.slice(before))).toHaveLength(1);
    expect(spawner.spawns).toHaveLength(1);
    expect(spawner.kills).toEqual([]);
  });

  it('a hung /source: aborted at its budget, then throws — no /status probe, no restart', async () => {
    let hang = false;
    let seen: AbortSignal | undefined;
    // Once `hang` is set, /source never answers: it fails only when its signal aborts.
    const { source, spawner, fetcher } = await setup(undefined, undefined, (fn) => (url, init) => {
      if (!hang || !url.includes('/source')) return fn(url, init);
      fetcher.urls.push(url);
      seen = init?.signal;
      return new Promise((_ok, fail) => {
        if (init?.signal?.aborted === true) fail(init.signal.reason);
        init?.signal?.addEventListener('abort', () => fail(init.signal!.reason));
      });
    });
    await source.read();
    hang = true;
    // Its budget runs out at once here: the signal comes pre-aborted, as it is at the budget.
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')));
    const before = fetcher.urls.length;
    await expect(source.systemAlert()).rejects.toThrow(/\/source request failed on port \d+ \(udid AAAA-1111\): .*timeout/);
    expect(seen?.aborted).toBe(true);
    expect(fetcher.urls.slice(before)).toHaveLength(1);
    expect(spawner.spawns).toHaveLength(1);
    expect(spawner.kills).toEqual([]);
    timeout.mockRestore();
  });

  it('after dispose: the released error, nothing fetched', async () => {
    const { source, fetcher } = await setup();
    await source.read();
    await source.dispose();
    const before = fetcher.urls.length;
    await expect(source.systemAlert()).rejects.toThrow(/deselected or averi is shutting down/);
    expect(sources(fetcher.urls.slice(before))).toEqual([]);
  });
});

// D43 (ADR 0037's D43 amendment): the source also types what idb cannot — WdaServer.keys, on the one server it owns.
describe('WdaTreeSource.typeText — WdaServer.keys on the source\'s own server (D43)', () => {
  async function typingSetup(keys: () => 'refused' | { status: number; body?: unknown } = () => ({ status: 200, body: { value: null } })) {
    const { dd } = await tempDerivedData(true);
    const spawner = fakeSpawn();
    const fetcher = fakeFetch((url, req) => {
      if (url.endsWith('/status')) return spawner.kills.length < spawner.spawns.length ? { status: 200, body: WDA_STATUS } : 'refused';
      if (url.endsWith('/session') && req.method === 'POST') return { status: 200, body: { value: { sessionId: 'S1' }, sessionId: 'S1' } };
      if (url.endsWith('/wda/keys')) return keys();
      return { status: 200, body: WDA_ENVELOPE };
    });
    const source = new WdaTreeSource({ udid: 'AAAA-1111', exec: fakeExec().fn, fetchFn: fetcher.fn, spawnFn: spawner.fn, derivedDataPath: dd, pollIntervalMs: 5 });
    const keyBodies = () => fetcher.requests.filter((r) => r.url.endsWith('/wda/keys')).map((r) => (r.body as { value: string[] }).value.join(''));
    return { source, spawner, fetcher, keyBodies };
  }

  it('types the text through the one server it owns: a session, then /wda/keys with the text — after a read, no second spawn', async () => {
    const { source, spawner, keyBodies } = await typingSetup();
    await source.read();
    await source.typeText('Jan Šťastný');
    expect(keyBodies()).toEqual(['Jan Šťastný']);
    expect(spawner.spawns).toHaveLength(1);
    await source.dispose();
  });

  it('a failure is WDA\'s, in its words', async () => {
    const { source } = await typingSetup(() => ({ status: 500, body: { value: { error: 'invalid element state', message: 'no focus' } } }));
    await expect(source.typeText('Šťastný')).rejects.toThrow(/^WDA \/wda\/keys failed: HTTP 500 invalid element state on port/);
    await source.dispose();
  });

  it('after dispose: the released error, nothing fetched', async () => {
    const { source, fetcher } = await typingSetup();
    await source.read();
    await source.dispose();
    const before = fetcher.urls.length;
    const err = (await source.typeText('Šťastný').catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/deselected or averi is shutting down/);
    expect(err.cause).toBeUndefined(); // released before the server is asked: no WdaServer error behind it
    expect(fetcher.urls.slice(before)).toEqual([]);
  });

  it('disposed while typing: the released error, WdaServer\'s words only as its cause', async () => {
    const { source } = await typingSetup(() => 'refused');
    await source.read();
    const typing = source.typeText('Šťastný').catch((e: Error) => e);
    const disposing = source.dispose();
    const err = (await typing) as Error;
    expect(err.message).toMatch(/deselected or averi is shutting down/);
    expect(String((err.cause as Error | undefined)?.message)).toMatch(/WDA|shut down/);
    await disposing;
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
