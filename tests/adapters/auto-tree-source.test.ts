import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoTreeSource, fallbackReason, idbFallbackNote, type WdaSide } from '../../src/adapters/auto-tree-source.js';
import { createIosTreeSource, IdbTreeSource, type ApplicationLabel, type IosTreeSource } from '../../src/adapters/ios-tree-source.js';
import { WdaTreeSource } from '../../src/adapters/wda-tree-source.js';
import { IOS_TREE_SOURCE_SETTINGS, DEFAULT_IOS_TREE_SOURCE } from '../../src/adapters/ios-node.js';
import { zeroRect, type UiNode } from '../../src/adapters/types.js';
import { fakeExec, fakeFetch, fakeSpawn, tempDerivedData } from '../helpers/fake-wda.js';

/**
 * `treeSource: auto` (A41a, docs/adr/0046-the-ios-tree-source-is-webdriveragent-when-it-comes-up.md): one source per
 * adapter, chosen at the first tree read by whether WebDriverAgent comes up, kept for the adapter's life.
 */

const tree = (from: string): UiNode => ({ identifier: from, role: 'other', label: null, value: null, rect: zeroRect(), children: [] }) as unknown as UiNode;

interface FakeWda extends WdaSide {
  bringUps: number;
  /** How often startBeforeLaunch asked whether the build is cached. */
  cachedAsks: number;
  reads: number;
  typed: string[];
  disposed: number;
}

function fakeWda(bringUp: () => Promise<void> = async () => undefined, cached: () => Promise<boolean> = async () => true): FakeWda {
  const wda: FakeWda = {
    kind: 'wda',
    bringUps: 0,
    cachedAsks: 0,
    reads: 0,
    typed: [],
    disposed: 0,
    async bringUp() {
      wda.bringUps++;
      await bringUp();
    },
    async buildCached() {
      wda.cachedAsks++;
      return cached();
    },
    async read() {
      wda.reads++;
      return tree('wda');
    },
    async applicationLabel(): Promise<ApplicationLabel> {
      return { kind: 'declined' };
    },
    async systemAlert() {
      return { title: 'from wda', buttons: [] } as never;
    },
    async typeText(text: string) {
      wda.typed.push(text);
    },
    async dispose() {
      wda.disposed++;
    },
  };
  return wda;
}

function fakeIdb(): IosTreeSource & { reads: number; labels: number } {
  const idb = {
    kind: 'idb' as const,
    settleCadenceMs: 300,
    reads: 0,
    labels: 0,
    async read() {
      idb.reads++;
      return tree('idb');
    },
    async applicationLabel(): Promise<ApplicationLabel> {
      idb.labels++;
      return { kind: 'label', label: 'Lab' };
    },
    async dispose() {},
  };
  return idb;
}

const down = () => Promise.reject(new Error('WebDriverAgent requires the appium-webdriveragent package, an optional dependency of averi that is not installed — reinstall averi'));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AutoTreeSource — WebDriverAgent when it comes up, idb when it does not (A41a)', () => {
  it('WDA comes up: every read is WDA\'s, the choice is made once for reads that race it, and nothing is noted', async () => {
    const wda = fakeWda();
    const idb = fakeIdb();
    const auto = new AutoTreeSource({ wda, idb });
    const [a, b] = await Promise.all([auto.read(), auto.read()]);
    expect([a.identifier, b.identifier]).toEqual(['wda', 'wda']);
    expect((await auto.read()).identifier).toBe('wda');
    expect(wda.bringUps).toBe(1);
    expect(idb.reads).toBe(0);
    expect(auto.kind).toBe('wda');
    expect(auto.fellBack).toBe(false);
    expect(auto.claimNote).toBeUndefined();
    expect(auto.settleCadenceMs).toBeUndefined();
    expect(auto.typeText).toBeDefined();
  });

  it('WDA does not come up: every read is idb\'s, said once on stderr, WDA released, and each claim carries the note', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const wda = fakeWda(down);
    const idb = fakeIdb();
    const auto = new AutoTreeSource({ wda, idb });
    expect((await auto.read()).identifier).toBe('idb');
    expect((await auto.read()).identifier).toBe('idb');
    expect(wda.bringUps).toBe(1); // cached for the session: never asked again
    expect(wda.reads).toBe(0);
    expect(wda.disposed).toBe(1);
    expect(idb.reads).toBe(2);
    expect(said.mock.calls).toEqual([
      ['averi: treeSource auto — WebDriverAgent did not come up, so this simulator\'s tree is read through idb: WebDriverAgent requires the appium-webdriveragent package, an optional dependency of averi that is not installed — reinstall averi'],
    ]);
    expect(auto.kind).toBe('idb');
    expect(auto.fellBack).toBe(true);
    expect(auto.claimNote).toBe(
      'read through idb: WebDriverAgent did not come up (WebDriverAgent requires the appium-webdriveragent package; select_device again to retry) ' +
        'and idb lists no presented layer or scroll clip — a layer over the target or a clip cutting it was not judged',
    );
    expect(auto.settleCadenceMs).toBe(300);
    expect(auto.typeText).toBeUndefined();
  });

  it('WDA chosen, then failing: the failure is WDA\'s — never a switch to idb', async () => {
    const wda = fakeWda();
    const idb = fakeIdb();
    const auto = new AutoTreeSource({ wda, idb });
    await auto.read();
    wda.read = () => Promise.reject(new Error('WDA /source request failed'));
    await expect(auto.read()).rejects.toThrow('WDA /source request failed');
    expect(idb.reads).toBe(0);
    expect(auto.claimNote).toBeUndefined();
  });

  it('before the first read: the label is idb\'s, no WDA is asked, no cadence, no note', async () => {
    const wda = fakeWda();
    const idb = fakeIdb();
    const auto = new AutoTreeSource({ wda, idb });
    expect(await auto.applicationLabel()).toEqual({ kind: 'label', label: 'Lab' });
    expect(await auto.systemAlert()).toBeUndefined();
    expect(wda.bringUps).toBe(0);
    expect(auto.kind).toBe('idb');
    expect(auto.settleCadenceMs).toBeUndefined();
    expect(auto.claimNote).toBeUndefined();
    // After WDA was chosen the label and the alert are WDA's.
    await auto.read();
    expect(await auto.applicationLabel()).toEqual({ kind: 'declined' });
    expect(await auto.systemAlert()).toEqual({ title: 'from wda', buttons: [] });
    expect(idb.labels).toBe(1);
  });

  it('typing before the first read makes the choice: WDA up types through it; WDA down types nothing and says why', async () => {
    const up = fakeWda();
    const typedUp = new AutoTreeSource({ wda: up, idb: fakeIdb() });
    await typedUp.typeText?.('Šťastný');
    expect(up.typed).toEqual(['Šťastný']);

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const gone = fakeWda(down);
    const fallen = new AutoTreeSource({ wda: gone, idb: fakeIdb() });
    await expect(fallen.typeText?.('Šťastný')).rejects.toThrow(
      /^cannot type U\+0160 .*Refused before anything was sent.*\n⚠ read through idb: WebDriverAgent did not come up \(WebDriverAgent requires the appium-webdriveragent package; select_device again to retry\) and idb lists/s,
    );
    expect(gone.typed).toEqual([]);
    expect(fallen.typeText).toBeUndefined();
  });

  it('released while choosing: the release is the answer, not a fallback to idb', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fail!: (e: Error) => void;
    const wda = fakeWda(() => new Promise((_, reject) => { fail = reject; }));
    const idb = fakeIdb();
    const auto = new AutoTreeSource({ wda, idb });
    const reading = auto.read();
    await Promise.resolve();
    await auto.dispose();
    fail(new Error('released'));
    await expect(reading).rejects.toThrow('released');
    expect(idb.reads).toBe(0);
    expect(said).not.toHaveBeenCalled();
  });

  it('dispose releases both sources, WDA once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const wda = fakeWda(down);
    const auto = new AutoTreeSource({ wda, idb: fakeIdb() });
    await auto.read();
    await auto.dispose();
    expect(wda.disposed).toBe(1);
  });
});

/** A promise the test settles: `settle()` resolves it, `fail(e)` rejects it. */
function deferred(): { promise: Promise<void>; settle: () => void; fail: (e: Error) => void } {
  let settle!: () => void;
  let fail!: (e: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

/** Lets every queued promise reaction and timer of this turn run: a background start gets as far as it can. */
const drain = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AutoTreeSource.startBeforeLaunch — the choice made before a launch, awaited (A41d)', () => {
  it('makes the choice and resolves once it is made — WDA; the first read then starts nothing', async () => {
    const up = deferred();
    const wda = fakeWda(() => up.promise);
    const idb = fakeIdb();
    const auto = new AutoTreeSource({ wda, idb });
    let done = false;
    const starting = auto.startBeforeLaunch().then(() => (done = true));
    await drain();
    expect([wda.bringUps, done]).toEqual([1, false]); // awaited: not done while WDA comes up
    up.settle();
    await starting;
    expect(auto.kind).toBe('wda');
    expect((await auto.read()).identifier).toBe('wda');
    expect(wda.bringUps).toBe(1);
    expect(idb.reads).toBe(0);
  });

  it('single-flight: a start while a read is choosing joins that choice, and a second start joins it too — one bring-up', async () => {
    const up = deferred();
    const wda = fakeWda(() => up.promise);
    const auto = new AutoTreeSource({ wda, idb: fakeIdb() });
    const reading = auto.read();
    const first = auto.startBeforeLaunch();
    const second = auto.startBeforeLaunch();
    await drain();
    expect(wda.bringUps).toBe(1);
    expect(wda.cachedAsks).toBe(0); // a choice in flight is joined, whatever the build
    up.settle();
    await Promise.all([first, second, reading]);
    expect(wda.bringUps).toBe(1);
  });

  it('a bring-up that fails resolves the start (no rejection): the fallback, said once, with its claim note', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const wda = fakeWda(() => Promise.reject(new Error('WDA build failed (xcodebuild build-for-testing) — output: /tmp/x.log')));
    const idb = fakeIdb();
    const auto = new AutoTreeSource({ wda, idb });
    await expect(auto.startBeforeLaunch()).resolves.toBeUndefined();
    expect(auto.fellBack).toBe(true);
    expect(auto.claimNote).toBe(idbFallbackNote('WDA build failed'));
    expect(said).toHaveBeenCalledTimes(1);
    expect((await auto.read()).identifier).toBe('idb');
    expect(wda.bringUps).toBe(1);
  });

  it('WebDriverAgent not built: nothing is started or awaited — the first read makes the choice, the build inside it', async () => {
    const wda = fakeWda(undefined, async () => false);
    const auto = new AutoTreeSource({ wda, idb: fakeIdb() });
    await auto.startBeforeLaunch();
    expect([wda.cachedAsks, wda.bringUps]).toEqual([1, 0]);
    expect((await auto.read()).identifier).toBe('wda');
    expect(wda.bringUps).toBe(1);
  });

  it('a build check that throws is no build: nothing started, the start resolves', async () => {
    const wda = fakeWda(undefined, () => Promise.reject(new Error('EACCES')));
    const auto = new AutoTreeSource({ wda, idb: fakeIdb() });
    await expect(auto.startBeforeLaunch()).resolves.toBeUndefined();
    expect(wda.bringUps).toBe(0);
  });

  it('after the choice it asks nothing — WDA already up is not asked again, nor is a fallback retried', async () => {
    const wda = fakeWda();
    const auto = new AutoTreeSource({ wda, idb: fakeIdb() });
    await auto.read();
    await auto.startBeforeLaunch();
    expect([wda.cachedAsks, wda.bringUps]).toEqual([0, 1]);

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let wdaStarts = 0;
    const failing = Object.assign(fakeWda(down), { startBeforeLaunch: async () => void wdaStarts++ });
    const fellBack = new AutoTreeSource({ wda: failing, idb: fakeIdb() });
    await fellBack.read();
    await fellBack.startBeforeLaunch();
    expect([failing.cachedAsks, failing.bringUps, wdaStarts]).toEqual([0, 1, 0]); // a fallback's WDA is not started again
  });

  it('WDA chosen and since gone: WDA\'s own start runs before the launch — restarted, and its failure is WDA\'s error', async () => {
    let starts = 0;
    let fail: Error | undefined;
    const wda: FakeWda = Object.assign(fakeWda(), {
      async startBeforeLaunch() {
        starts++;
        if (fail !== undefined) throw fail;
      },
    });
    const auto = new AutoTreeSource({ wda, idb: fakeIdb() });
    await auto.read();
    await auto.startBeforeLaunch();
    expect([starts, wda.bringUps]).toEqual([1, 1]);
    fail = new Error('WDA did not answer /status on port 8100 within 60 s');
    await expect(auto.startBeforeLaunch()).rejects.toBe(fail);
    expect(auto.kind).toBe('wda'); // never a switch to idb
  });

  it('bounded by WDA\'s ready timeout: a real WdaTreeSource whose /status never answers falls back, its reason the timeout', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { dd } = await tempDerivedData(true);
    const spawner = fakeSpawn();
    const wda = new WdaTreeSource({
      udid: 'AAAA-1111', exec: fakeExec().fn, fetchFn: fakeFetch(() => 'refused').fn, spawnFn: spawner.fn,
      derivedDataPath: dd, readyTimeoutMs: 40, pollIntervalMs: 5,
    });
    const auto = new AutoTreeSource({ wda, idb: fakeIdb() });
    await expect(auto.startBeforeLaunch()).resolves.toBeUndefined();
    expect(auto.fellBack).toBe(true);
    expect(auto.claimNote).toMatch(/WebDriverAgent did not come up \(WDA did not answer \/status on port \d+ within 0\.04 s;/);
    expect(spawner.kills).toContain('SIGTERM');
    await auto.dispose();
  });

  it('released: starts nothing; released mid-choice: the released error, no fallback', async () => {
    const later = fakeWda();
    const released = new AutoTreeSource({ wda: later, idb: fakeIdb() });
    await released.dispose();
    await released.startBeforeLaunch();
    expect([later.cachedAsks, later.bringUps]).toEqual([0, 0]);

    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const up = deferred();
    const wda = fakeWda(() => up.promise);
    const auto = new AutoTreeSource({ wda, idb: fakeIdb() });
    const starting = auto.startBeforeLaunch();
    starting.catch(() => undefined);
    await drain();
    await auto.dispose();
    up.fail(new Error('released'));
    await expect(starting).rejects.toThrow('released');
    expect(said).not.toHaveBeenCalled();
  });

  it('released while asking whether the build is cached: nothing is started', async () => {
    const cached = deferred();
    const wda = fakeWda(undefined, () => cached.promise.then(() => true));
    const auto = new AutoTreeSource({ wda, idb: fakeIdb() });
    const starting = auto.startBeforeLaunch();
    await drain();
    await auto.dispose();
    cached.settle();
    await starting;
    expect(wda.bringUps).toBe(0);
  });
});

describe('fallbackReason — WDA\'s error in a few words for the note', () => {
  it.each([
    ['WebDriverAgent requires the appium-webdriveragent package, an optional dependency of averi …', 'WebDriverAgent requires the appium-webdriveragent package'],
    ['A WebDriverAgent answers /status on port 8100, but this session did not start it (udid U). …', 'A WebDriverAgent answers /status on port 8100'],
    ['WDA did not answer /status on port 8100 within 60 s — xcodebuild log: /tmp/x.log. First install …', 'WDA did not answer /status on port 8100 within 60 s'],
    ['WDA build failed (xcodebuild build-for-testing, timed out after 10 min) — output: /tmp/x.log', 'WDA build failed'],
    ['spawn xcodebuild ENOENT: no such file', 'spawn xcodebuild ENOENT'],
    ['WdaServer for U was stopped during startup. Then\nmore', 'WdaServer for U was stopped during startup'],
  ])('%s → %s', (message, reason) => {
    expect(fallbackReason(new Error(message))).toBe(reason);
  });

  it('a long clause is cut at 80 characters with an ellipsis; an empty one says so', () => {
    const cut = fallbackReason(new Error('x'.repeat(200)));
    expect(cut).toBe(`${'x'.repeat(79)}…`);
    expect(fallbackReason(new Error(''))).toBe('no reason given');
    expect(fallbackReason('plain string, not an Error')).toBe('plain string');
  });

  it('the note carries it', () => {
    expect(idbFallbackNote('WDA build failed')).toContain('(WDA build failed; select_device again to retry)');
  });
});

describe('the setting', () => {
  it('auto is the default and a setting of its own; createIosTreeSource builds both sources behind it', () => {
    expect(DEFAULT_IOS_TREE_SOURCE).toBe('auto');
    expect(IOS_TREE_SOURCE_SETTINGS).toEqual(['auto', 'idb', 'wda']);
    expect(createIosTreeSource('auto', 'AAAA-1111')).toBeInstanceOf(AutoTreeSource);
    expect(createIosTreeSource('idb', 'AAAA-1111')).toBeInstanceOf(IdbTreeSource);
    expect(createIosTreeSource('wda', 'AAAA-1111')).toBeInstanceOf(WdaTreeSource);
  });
});
