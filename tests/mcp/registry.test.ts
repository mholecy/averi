import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/mcp/registry.js';
import type { Device, DeviceAdapter, Platform } from '../../src/adapters/types.js';
import { FakeAdapter } from '../helpers/fake.js';

/** Factory whose device list is mutable mid-test (devices boot and vanish). */
function makeRegistry(devices: Device[]) {
  const bound: string[] = [];
  const factory = (platform: Platform, deviceId?: string): DeviceAdapter => {
    if (deviceId !== undefined) bound.push(deviceId);
    const adapter = new FakeAdapter({}, 'none');
    adapter.listDevices = async () => devices.filter((d) => d.platform === platform);
    return adapter;
  };
  return { registry: new AdapterRegistry(factory), bound, devices };
}

const device = (id: string, state: Device['state'] = 'booted'): Device => ({
  id,
  platform: 'android',
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
});
