import { describe, expect, it } from 'vitest';
import { AdapterRegistry, defaultFactory, discoveryWith, type AdapterOpts, type DeviceDiscovery } from '../../src/mcp/registry.js';
import type { ExecFn } from '../../src/adapters/exec.js';
import { AndroidAdapter } from '../../src/adapters/android.js';
import { IosAdapter } from '../../src/adapters/ios.js';
import { resetWdaPortAllocatorForTests, wdaPortFor } from '../../src/adapters/wda.js';
import type { Device, DeviceAdapter, Platform } from '../../src/adapters/types.js';
import { FakeAdapter } from '../helpers/fake.js';

/**
 * A registry over a device list that is mutable mid-test (devices boot and
 * vanish) — the discovery seam is the list itself, no adapter is built to
 * ask it. `onProbe` gates the listing — lets a test freeze a probe
 * mid-flight. `probes` counts listings per platform.
 */
function makeRegistry(devices: Device[], onProbe?: () => Promise<void> | void) {
  const bound: string[] = [];
  const created: FakeAdapter[] = [];
  const probes: Platform[] = [];
  // Records what the registry asked for: `id+kind` on ios (the registry
  // resolves the kind before calling, so the default is spelled out), a bare
  // id on android (no tree source there).
  const factory = (platform: Platform, deviceId: string, opts?: AdapterOpts): DeviceAdapter => {
    bound.push(opts?.treeSource === undefined ? deviceId : `${deviceId}+${opts.treeSource}`);
    const adapter = new FakeAdapter({}, 'none');
    created.push(adapter);
    return adapter;
  };
  const discovery: DeviceDiscovery = async (platform) => {
    probes.push(platform);
    await onProbe?.();
    return devices.filter((d) => d.platform === platform);
  };
  return { registry: new AdapterRegistry({ factory, discovery }), bound, created, devices, probes };
}

const device = (id: string, state: Device['state'] = 'booted', platform: Platform = 'android'): Device => ({
  id,
  platform,
  name: id,
  osVersion: '14',
  state,
});

describe('AdapterRegistry', () => {
  it('lists through discovery alone — no adapter is built to ask which devices exist', async () => {
    const { registry, created, probes } = makeRegistry([device('phone'), device('sim', 'booted', 'ios')]);
    expect((await registry.listAll()).map((d) => d.id)).toEqual(['phone', 'sim']);
    expect(probes.sort()).toEqual(['android', 'ios']);
    expect(created).toEqual([]);
  });

  it('a platform whose discovery throws (adb or xcrun missing) lists nothing; the other still lists', async () => {
    const discovery: DeviceDiscovery = async (platform) => {
      if (platform === 'android') throw new Error('spawn adb ENOENT');
      return [device('sim', 'booted', 'ios')];
    };
    const registry = new AdapterRegistry({ factory: () => new FakeAdapter({}, 'none'), discovery });
    expect((await registry.listAll()).map((d) => d.id)).toEqual(['sim']);
    // A discovery that throws SYNCHRONOUSLY is the same event, not an escape from listAll.
    const throwsSync: DeviceDiscovery = (platform) => {
      if (platform === 'ios') throw new Error('xcrun not found');
      return Promise.resolve([device('phone')]);
    };
    const sync = new AdapterRegistry({ factory: () => new FakeAdapter({}, 'none'), discovery: throwsSync });
    expect((await sync.listAll()).map((d) => d.id)).toEqual(['phone']);
  });

  it('no booted device in the listing: each platform says where it looked, and nothing is built', async () => {
    const { registry, created } = makeRegistry([device('phone', 'offline'), device('sim', 'offline', 'ios')]);
    await expect(registry.get('android')).rejects.toThrow('No booted Android emulator/device found (adb devices)');
    await expect(registry.get('ios')).rejects.toThrow('No booted iOS simulator found (xcrun simctl list)');
    expect(created).toEqual([]);
  });

  it('get() resolves the device through discovery and builds ONE adapter, bound to it — every call asks discovery again', async () => {
    const { registry, bound, created, probes } = makeRegistry([device('offline-one', 'offline'), device('phone')]);
    const adapter = await registry.get('android');
    expect(created).toEqual([adapter]);
    expect(bound).toEqual(['phone']);
    expect(probes).toEqual(['android']);
    expect(await registry.get('android')).toBe(adapter); // cached, but the binding is re-checked
    expect(probes).toEqual(['android', 'android']);
  });

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

  it('caches per tree-source kind: same kind shares an instance, wda gets its own', async () => {
    const { registry, bound } = makeRegistry([device('sim', 'booted', 'ios')]);
    const dflt = await registry.get('ios');
    const wda = await registry.get('ios', { treeSource: 'wda' });
    expect(await registry.get('ios', { treeSource: 'wda' })).toBe(wda);
    expect(wda).not.toBe(dflt);
    // an explicit idb IS the default — no third instance
    expect(await registry.get('ios', { treeSource: 'idb' })).toBe(dflt);
    expect(bound).toEqual(['sim+idb', 'sim+wda']);
  });

  it('android has no tree source — a stray kind neither forks the cache nor reaches the factory', async () => {
    const { registry, bound } = makeRegistry([device('phone')]);
    const plain = await registry.get('android');
    expect(await registry.get('android', { treeSource: 'wda' })).toBe(plain);
    expect(bound).toEqual(['phone']);
  });

  it('select() pins ALL tree-source kinds of the platform to the device', async () => {
    const { registry, bound } = makeRegistry([
      device('a', 'booted', 'ios'),
      device('b', 'booted', 'ios'),
    ]);
    await registry.select('ios', 'b');
    await registry.get('ios');
    await registry.get('ios', { treeSource: 'wda' });
    expect(bound).toEqual(['b+idb', 'b+wda']);
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
    expect(bound).toEqual(['a+idb']);

    let release!: () => void;
    gate = new Promise((r) => { release = r; });
    const racing = registry.get('ios'); // captures binding a, freezes on the probe
    gate = undefined; // select()'s own probe must run through
    await registry.select('ios', 'b'); // evicts + disposes a's adapter, binds b
    expect(first.disposed).toBe(1);

    release();
    const resumed = (await racing) as FakeAdapter;
    expect(resumed).not.toBe(first);
    expect(bound).toEqual(['a+idb', 'b+idb']); // no second adapter for the deselected a
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

describe('AdapterRegistry.shutdown — the process-shutdown path', () => {
  it('disposes every cached adapter, drops bindings, and WAITS for async disposals', async () => {
    const { registry, created } = makeRegistry([device('phone'), device('sim', 'booted', 'ios')]);
    await registry.get('android');
    await registry.get('ios', { treeSource: 'wda' });
    expect(created).toHaveLength(2);
    // An async dispose (the iOS wda variant shuts its WdaServer down) must be
    // awaited, or process.exit would race the kill and orphan the WDA.
    let stopped = false;
    created[1].onDispose = () =>
      new Promise<void>((resolve) => setTimeout(() => { stopped = true; resolve(); }, 20));
    await registry.shutdown();
    expect(created[0].disposed).toBe(1);
    expect(created[1].disposed).toBe(1);
    expect(stopped).toBe(true);
    expect(registry.boundId('android')).toBeUndefined();
    expect(registry.boundId('ios')).toBeUndefined();
  });

  it('tolerates a dispose that throws or rejects — the other adapters are still disposed', async () => {
    const { registry, created } = makeRegistry([device('a'), device('b', 'booted', 'ios')]);
    await registry.get('android');
    await registry.get('ios');
    created[0].dispose = () => { throw new Error('boom'); };
    created[1].onDispose = () => Promise.reject(new Error('later boom'));
    await expect(registry.shutdown()).resolves.toBeUndefined();
    expect(created[1].disposed).toBe(1);
  });

  it('a get() parked on a probe when shutdown ran cannot cache a fresh adapter afterwards', async () => {
    // Otherwise the in-flight tool call would create — and on iOS/wda spawn —
    // exactly the server the shutdown just stopped, into a registry nobody
    // disposes again (review 2026-09-18).
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let gated = true;
    const { registry, created } = makeRegistry([device('sim', 'booted', 'ios')], async () => { if (gated) await gate; });
    const inflight = registry.get('ios', { treeSource: 'wda' });
    await new Promise((r) => setTimeout(r, 5)); // let it park on the probe
    gated = false;
    await registry.shutdown();
    release();
    await expect(inflight).rejects.toThrow(/shutting down/);
    expect(created.filter((a) => a.disposed === 0)).toHaveLength(0);
    await expect(registry.get('ios')).rejects.toThrow(/shutting down/);
    await expect(registry.select('ios', 'sim')).rejects.toThrow(/shutting down/);
  });
});

describe('defaultFactory — the wiring the injected factories above never see', () => {
  // No device is touched. Which backend a kind gets is adapters/ knowledge and
  // is pinned there (ios-tree-source.test.ts, createIosTreeSource); this file
  // pins only what the registry adds: the bound device id goes through and
  // android gets its own adapter. (There is no unbound call since 2026-10-08:
  // the id is required by the type, and listing is DeviceDiscovery's.)

  it('a bound wda adapter is bound to the GIVEN device id — its WebDriverAgent holds that udid\'s port, not `booted`\'s', () => {
    // The one consequence of the udid a wda source is constructed with that
    // is visible without a device: WdaServer allocates its port per UDID at
    // construction (wdaPortFor). After a reset, the FIRST udid asked for gets
    // 8100 — so if construction asked for ours, ours already holds it.
    resetWdaPortAllocatorForTests();
    defaultFactory('ios', 'AAAA-1111', { treeSource: 'wda' });
    expect(wdaPortFor('AAAA-1111')).toBe(8100);
    expect(wdaPortFor('booted')).toBe(8101);
  });

  it("'idb', and an omitted kind, build NO WebDriverAgent: no port is allocated for the device", () => {
    // The inverse of the pin above, and the one that catches a factory that
    // ignores the kind: with no wda source constructed, nothing has asked the
    // allocator for this udid, so the first asker after the reset still gets
    // 8100 — here, this test.
    resetWdaPortAllocatorForTests();
    defaultFactory('ios', 'AAAA-1111', { treeSource: 'idb' });
    defaultFactory('ios', 'BBBB-2222');
    expect(wdaPortFor('X')).toBe(8100);
  });

  it("'wda' DOES allocate the device's port — the kind, not the call, decides", () => {
    resetWdaPortAllocatorForTests();
    defaultFactory('ios', 'AAAA-1111', { treeSource: 'wda' });
    expect(wdaPortFor('X')).toBe(8101);
  });

  it('a bound ios adapter REPORTS the kind it was built with — an omitted kind as idb — so the engine never re-derives it from the config', () => {
    // Construction only: a wda source allocates a port and nothing else
    // (the pins above rely on the same), so no WebDriverAgent, xcodebuild or
    // idb is started here.
    resetWdaPortAllocatorForTests();
    expect(defaultFactory('ios', 'AAAA-1111').treeSourceKind).toBe('idb');
    expect(defaultFactory('ios', 'AAAA-1111', { treeSource: 'idb' }).treeSourceKind).toBe('idb');
    expect(defaultFactory('ios', 'AAAA-1111', { treeSource: 'wda' }).treeSourceKind).toBe('wda');
    expect(defaultFactory('android', 'emulator-5554').treeSourceKind).toBeUndefined();
  });

  it('the default discovery lists android with adb and ios with simctl — the platform reaches the right listing', async () => {
    const calls: string[] = [];
    const exec: ExecFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { stdout: Buffer.from(cmd === 'xcrun' && args[0] === 'simctl' ? '{"devices":{}}' : ''), stderr: '' };
    };
    const discover = discoveryWith(exec);
    expect(await discover('android')).toEqual([]);
    expect(calls).toEqual(['adb devices -l']);
    calls.length = 0;
    expect(await discover('ios')).toEqual([]);
    expect(calls).toContain('xcrun simctl list devices --json');
    expect(calls.some((c) => c.startsWith('adb'))).toBe(false);
  });

  it('android gets an AndroidAdapter, whatever the kind says; ios an IosAdapter', () => {
    expect(defaultFactory('android', 'emulator-5554')).toBeInstanceOf(AndroidAdapter);
    expect(defaultFactory('android', 'emulator-5554', { treeSource: 'wda' })).toBeInstanceOf(AndroidAdapter);
    resetWdaPortAllocatorForTests();
    expect(defaultFactory('ios', 'AAAA-1111')).toBeInstanceOf(IosAdapter);
  });
});
