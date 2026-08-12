import { describe, expect, it } from 'vitest';
import { AdapterRegistry, type AdapterOpts } from '../../src/mcp/registry.js';
import type { Device, DeviceAdapter, Platform } from '../../src/adapters/types.js';
import { FakeAdapter } from '../helpers/fake.js';

/**
 * Factory whose device list is mutable mid-test (devices boot and vanish).
 * `onProbe` gates listDevices — lets a test freeze a probe mid-flight.
 */
function makeRegistry(devices: Device[], onProbe?: () => Promise<void> | void) {
  const bound: string[] = [];
  const created: FakeAdapter[] = [];
  const factory = (platform: Platform, deviceId?: string, opts?: AdapterOpts): DeviceAdapter => {
    if (deviceId !== undefined) bound.push(opts?.treeSource === undefined ? deviceId : `${deviceId}+${opts.treeSource}`);
    const adapter = new FakeAdapter({}, 'none');
    adapter.listDevices = async () => {
      await onProbe?.();
      return devices.filter((d) => d.platform === platform);
    };
    if (deviceId !== undefined) created.push(adapter);
    return adapter;
  };
  return { registry: new AdapterRegistry(factory), bound, created, devices };
}

const device = (id: string, state: Device['state'] = 'booted', platform: Platform = 'android'): Device => ({
  id,
  platform,
  name: id,
  osVersion: '14',
  state,
});

describe('AdapterRegistry', () => {
  it('binds to the first booted device when nothing is selected', async () => {
    const { registry, bound } = makeRegistry([device('watch-emulator'), device('phone')]);
    await registry.get('android');
    expect(bound).toEqual(['watch-emulator']);
    expect(registry.boundId('android')).toBe('watch-emulator');
  });

  it('select pins a specific booted device and get honors it', async () => {
    const { registry, bound } = makeRegistry([device('watch-emulator'), device('phone')]);
    const selected = await registry.select('android', 'phone');
    expect(selected.id).toBe('phone');
    await registry.get('android');
    expect(bound).toEqual(['phone']);
  });

  it('select rejects an unknown device and lists the known ones', async () => {
    const { registry } = makeRegistry([device('phone')]);
    await expect(registry.select('android', 'nope')).rejects.toThrow(/known: phone \(booted\)/);
  });

  it('select rejects an offline device', async () => {
    const { registry } = makeRegistry([device('phone', 'offline')]);
    await expect(registry.select('android', 'phone')).rejects.toThrow(/offline/);
  });

  it('a vanished PINNED device is an error, not a silent fallback', async () => {
    const { registry, devices } = makeRegistry([device('phone'), device('emulator')]);
    await registry.select('android', 'phone');
    devices.splice(0, 1); // phone disconnects
    await expect(registry.get('android')).rejects.toThrow(/no longer booted/);
  });

  it('a vanished auto-picked device falls back to the next booted one', async () => {
    const { registry, bound, devices } = makeRegistry([device('first'), device('second')]);
    await registry.get('android');
    devices.splice(0, 1); // first disconnects
    await registry.get('android');
    expect(bound).toEqual(['first', 'second']);
  });

  it('caches per treeSource: same opts share an instance, wda gets its own', async () => {
    const { registry, bound } = makeRegistry([device('sim', 'booted', 'ios')]);
    const dflt = await registry.get('ios');
    const wda = await registry.get('ios', { treeSource: 'wda' });
    expect(await registry.get('ios', { treeSource: 'wda' })).toBe(wda);
    expect(wda).not.toBe(dflt);
    // an explicit idb IS the default — no third instance
    expect(await registry.get('ios', { treeSource: 'idb' })).toBe(dflt);
    expect(bound).toEqual(['sim', 'sim+wda']);
  });

  it('android ignores treeSource — a stray value does not fork the cache', async () => {
    const { registry, bound } = makeRegistry([device('phone')]);
    const plain = await registry.get('android');
    expect(await registry.get('android', { treeSource: 'wda' })).toBe(plain);
    expect(bound).toEqual(['phone']);
  });

  it('select() pins ALL treeSource variants of the platform to the device', async () => {
    const { registry, bound } = makeRegistry([
      device('a', 'booted', 'ios'),
      device('b', 'booted', 'ios'),
    ]);
    await registry.select('ios', 'b');
    await registry.get('ios');
    await registry.get('ios', { treeSource: 'wda' });
    expect(bound).toEqual(['b', 'b+wda']);
  });

  it('select() to a DIFFERENT device disposes the old device\'s cached adapters', async () => {
    const { registry, created } = makeRegistry([
      device('a', 'booted', 'ios'),
      device('b', 'booted', 'ios'),
    ]);
    const oldDefault = (await registry.get('ios')) as FakeAdapter;
    const oldWda = (await registry.get('ios', { treeSource: 'wda' })) as FakeAdapter;
    await registry.select('ios', 'b');
    expect(oldDefault.disposed).toBe(1);
    expect(oldWda.disposed).toBe(1);
    // the new device gets fresh instances, disposed ones never resurface
    expect(await registry.get('ios', { treeSource: 'wda' })).not.toBe(oldWda);
    expect(created.filter((a) => a.disposed > 0)).toHaveLength(2);
  });

  it('re-selecting the SAME device keeps its adapters undisposed', async () => {
    const { registry } = makeRegistry([device('a', 'booted', 'ios')]);
    const adapter = (await registry.get('ios', { treeSource: 'wda' })) as FakeAdapter;
    await registry.select('ios', 'a');
    expect(adapter.disposed).toBe(0);
    expect(await registry.get('ios', { treeSource: 'wda' })).toBe(adapter);
  });

  it('get() racing select() re-reads the binding — never resurrects the evicted adapter', async () => {
    // get() captures the binding, then awaits a probe; select() runs to
    // completion during that await (evicts device a, rebinds to b). Without
    // the post-await re-read, get() resumes against the STALE binding and
    // re-caches a fresh adapter for the deselected device — a zombie that is
    // never disposed and shadows the user's explicit selection.
    let gate: Promise<void> | undefined;
    const { registry, bound, created } = makeRegistry(
      [device('a', 'booted', 'ios'), device('b', 'booted', 'ios')],
      () => gate,
    );
    const first = (await registry.get('ios')) as FakeAdapter; // auto-binds a
    expect(bound).toEqual(['a']);

    let release!: () => void;
    gate = new Promise((r) => { release = r; });
    const racing = registry.get('ios'); // captures binding a, freezes on the probe
    gate = undefined; // select()'s own probe must run through
    await registry.select('ios', 'b'); // evicts + disposes a's adapter, binds b
    expect(first.disposed).toBe(1);

    release();
    const resumed = (await racing) as FakeAdapter;
    expect(resumed).not.toBe(first);
    expect(bound).toEqual(['a', 'b']); // no second adapter for the deselected a
    expect(resumed).toBe(await registry.get('ios')); // and it IS b's cached adapter
    expect(created.filter((a) => a.disposed > 0)).toEqual([first]);
  });

  it('evicting a vanished auto-picked device disposes its adapters', async () => {
    const { registry, devices } = makeRegistry([
      device('first', 'booted', 'ios'),
      device('second', 'booted', 'ios'),
    ]);
    const orphan = (await registry.get('ios', { treeSource: 'wda' })) as FakeAdapter;
    devices.splice(0, 1); // first disconnects
    const next = await registry.get('ios', { treeSource: 'wda' });
    expect(orphan.disposed).toBe(1);
    expect(next).not.toBe(orphan);
  });
});
