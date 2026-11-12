import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoTreeSource, fallbackReason, idbFallbackNote, type WdaSide } from '../../src/adapters/auto-tree-source.js';
import { createIosTreeSource, IdbTreeSource, type ApplicationLabel, type IosTreeSource } from '../../src/adapters/ios-tree-source.js';
import { WdaTreeSource } from '../../src/adapters/wda-tree-source.js';
import { IOS_TREE_SOURCE_SETTINGS, DEFAULT_IOS_TREE_SOURCE } from '../../src/adapters/ios-node.js';
import { zeroRect, type UiNode } from '../../src/adapters/types.js';

/**
 * `treeSource: auto` (A41a, docs/adr/0046-the-ios-tree-source-is-webdriveragent-when-it-comes-up.md): one source per
 * adapter, chosen at the first tree read by whether WebDriverAgent comes up, kept for the adapter's life.
 */

const tree = (from: string): UiNode => ({ identifier: from, role: 'other', label: null, value: null, rect: zeroRect(), children: [] }) as unknown as UiNode;

interface FakeWda extends WdaSide {
  bringUps: number;
  reads: number;
  typed: string[];
  disposed: number;
}

function fakeWda(bringUp: () => Promise<void> = async () => undefined): FakeWda {
  const wda: FakeWda = {
    kind: 'wda',
    bringUps: 0,
    reads: 0,
    typed: [],
    disposed: 0,
    async bringUp() {
      wda.bringUps++;
      await bringUp();
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
