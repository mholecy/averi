import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceAdapter } from '../../src/adapters/types.js';
import { ADAPTER_SURFACE, HANDOFF_MAX_AGE_MS, ReadHandOff } from '../../src/ui-tree/read-handoff.js';
import { FakeAdapter, node, screen } from '../helpers/fake.js';

// The hand-off of one tree read to the next poll (docs/adr/0030-a-read-is-handed-on-only-as-a-first-sample-or-a-
// positive-verdict.md): kept only from a producer, invalidated by any adapter call that is not a read, aged out, and
// given once.

const fake = () => new FakeAdapter({ home: screen(node({ identifier: 'title' })) }, 'home');

/** One argument list per acting method — enough for the fake to accept the call. */
const ACTS: { [K in keyof DeviceAdapter]?: (a: DeviceAdapter) => unknown } = {
  install: (a) => a.install('x.apk'),
  launch: (a) => a.launch('app'),
  terminate: (a) => a.terminate('app'),
  openDeepLink: (a) => a.openDeepLink('app://x'),
  tap: (a) => a.tap(5, 5),
  longPress: (a) => a.longPress(5, 5),
  swipe: (a) => a.swipe({ x: 0, y: 0 }, { x: 1, y: 1 }),
  typeText: (a) => a.typeText('x'),
  clearText: (a) => a.clearText(1),
  pressKey: (a) => a.pressKey('back'),
  dispose: (a) => a.dispose?.(),
};

afterEach(() => {
  vi.useRealTimers();
});

describe('ReadHandOff', () => {
  it('hands on a read taken while producing, once', async () => {
    const handOff = new ReadHandOff();
    const adapter = handOff.watch(fake());
    const tree = await handOff.producing(() => adapter.uiTree());
    expect(handOff.take()?.tree).toEqual(tree);
    expect(handOff.take()).toBeUndefined();
  });

  it('keeps nothing from a read outside a producer, and a later such read drops what a producer kept', async () => {
    const handOff = new ReadHandOff();
    const adapter = handOff.watch(fake());
    await adapter.uiTree();
    expect(handOff.take()).toBeUndefined();
    await handOff.producing(() => adapter.uiTree());
    await adapter.uiTree();
    expect(handOff.take()).toBeUndefined();
  });

  it('drops the kept read on a failed read', async () => {
    const handOff = new ReadHandOff();
    const f = fake();
    const adapter = handOff.watch(f);
    await handOff.producing(() => adapter.uiTree());
    f.uiTree = async () => {
      throw new Error('null root node');
    };
    await expect(handOff.producing(() => adapter.uiTree())).rejects.toThrow('null root node');
    expect(handOff.take()).toBeUndefined();
  });

  // Every method of DeviceAdapter the surface does not call a read is an action: after it, nothing read before it is
  // handed on. Listed from the surface itself, so a method classified `acts` is tested here once it has an argument
  // list in ACTS.
  const acting = (Object.keys(ADAPTER_SURFACE) as (keyof DeviceAdapter)[]).filter((k) => ADAPTER_SURFACE[k] === 'acts');
  it('classifies every acting method this test can call', () => {
    expect(acting.sort()).toEqual(Object.keys(ACTS).sort());
  });
  for (const method of acting) {
    it(`${method} invalidates the kept read`, async () => {
      const handOff = new ReadHandOff();
      const adapter = handOff.watch(fake());
      await handOff.producing(() => adapter.uiTree());
      await ACTS[method]!(adapter);
      expect(handOff.take()).toBeUndefined();
    });
  }

  it('a read in flight across an action is not handed on', async () => {
    const handOff = new ReadHandOff();
    const f = fake();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = f.uiTree.bind(f);
    f.uiTree = async () => {
      await gate;
      return real();
    };
    const adapter = handOff.watch(f);
    const reading = handOff.producing(() => adapter.uiTree());
    await adapter.tap(5, 5).catch(() => {});
    release();
    await reading;
    expect(handOff.take()).toBeUndefined();
  });

  // An action invalidates on both edges: while it runs, nothing read before it is handed on; once it ends, nothing
  // read while it ran is.
  const gatedTap = (f: FakeAdapter) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = f.tap.bind(f);
    f.tap = async (x, y) => {
      await gate;
      return real(x, y);
    };
    return release;
  };

  it('nothing read before an action is handed on while the action runs', async () => {
    const handOff = new ReadHandOff();
    const f = fake();
    const release = gatedTap(f);
    const adapter = handOff.watch(f);
    await handOff.producing(() => adapter.uiTree());
    const tapping = adapter.tap(5, 5);
    expect(handOff.take()).toBeUndefined();
    release();
    await tapping;
  });

  it('nothing read while an action ran is handed on once it ends', async () => {
    const handOff = new ReadHandOff();
    const f = fake();
    const release = gatedTap(f);
    const adapter = handOff.watch(f);
    const tapping = adapter.tap(5, 5);
    await handOff.producing(() => adapter.uiTree());
    release();
    await tapping;
    expect(handOff.take()).toBeUndefined();
  });

  it('a method DeviceAdapter does not declare counts as an action', async () => {
    const handOff = new ReadHandOff();
    const f = Object.assign(fake(), { reboot: async () => {} });
    const adapter = handOff.watch(f);
    await handOff.producing(() => adapter.uiTree());
    await adapter.reboot();
    expect(handOff.take()).toBeUndefined();
  });

  it('read-only methods leave the kept read standing', async () => {
    const handOff = new ReadHandOff();
    const f = fake();
    f.focusedWindow = async () => ({ of: 'unknown' });
    f.attachKeyboard();
    const adapter = handOff.watch<DeviceAdapter>(f);
    await handOff.producing(() => adapter.uiTree());
    await adapter.screenshot();
    await adapter.viewport();
    await adapter.focusedWindow!();
    await adapter.keyboard!.state();
    await adapter.isAppRunning('app');
    await adapter.logs(0);
    expect(handOff.take()).toBeDefined();
  });

  it('ages out HANDOFF_MAX_AGE_MS after the read ended', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const handOff = new ReadHandOff();
    const adapter = handOff.watch(fake());
    await handOff.producing(() => adapter.uiTree());
    vi.setSystemTime(Date.now() + HANDOFF_MAX_AGE_MS);
    expect(handOff.take()).toBeDefined();
    await handOff.producing(() => adapter.uiTree());
    vi.setSystemTime(Date.now() + HANDOFF_MAX_AGE_MS + 1);
    expect(handOff.take()).toBeUndefined();
  });

  it('a second hand-off over the same adapter keeps nothing of the first one', async () => {
    const f = fake();
    const first = new ReadHandOff();
    await first.producing(() => first.watch(f).uiTree());
    const second = new ReadHandOff();
    expect(second.take()).toBeUndefined();
  });

  it('watching its own proxy again returns it, and keeps absent optional members absent', () => {
    const handOff = new ReadHandOff();
    const f = fake();
    const adapter = handOff.watch(f);
    expect(handOff.watch(adapter)).toBe(adapter);
    expect(adapter.focusedWindow).toBeUndefined();
    expect(adapter.keyboard).toBeUndefined();
    expect(adapter.platform).toBe('android');
  });
});
