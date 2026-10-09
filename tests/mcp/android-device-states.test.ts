import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExecFn } from '../../src/adapters/exec.js';
import { AdapterRegistry, discoveryWith } from '../../src/mcp/registry.js';
import { createAveriServer } from '../../src/mcp/tools.js';

/**
 * What an MCP client reads when adb lists the only Android device as
 * `unauthorized` or `offline` (C5, 2026-10-09: both read "No booted Android
 * emulator/device found (adb devices)"). Through the real chain short of a
 * process: the client, createAveriServer, the AdapterRegistry, and
 * discovery.ts's `adb devices -l` parser over a fake exec. No adapter may be
 * built — the factory throws — and nothing but `adb devices -l` is run.
 */
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function connect(adbDevices: string) {
  const calls: string[] = [];
  const exec: ExecFn = async (cmd, args) => {
    const full = [cmd, ...args].join(' ');
    calls.push(full);
    if (full === 'adb devices -l') return { stdout: Buffer.from(adbDevices), stderr: '' };
    throw new Error(`test harness: unexpected command ${full}`); // xcrun too: listAll lists no iOS device
  };
  const registry = new AdapterRegistry({
    factory: () => {
      throw new Error('test harness: no adapter may be built for an unusable device');
    },
    discovery: discoveryWith(exec),
  });
  const server = createAveriServer({ registry, version: '0.0.0-test' });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'android-device-states-test', version: '0' });
  await client.connect(clientSide);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text?: string }[];
    return { isError: result.isError === true, text: content.map((c) => c.text ?? `[${c.type}]`).join('\n') };
  };
  return { call, calls };
}

// adb's long-listing shape for these states is from its client source, NOT
// measured on a device here (see tests/adapters/discovery.test.ts).
const UNAUTHORIZED = 'List of devices attached\nR58M123        unauthorized usb:1-1 transport_id:3\n\n';
const OFFLINE = 'List of devices attached\nemulator-5554  offline transport_id:1\n\n';

describe('an Android device adb lists but cannot drive — the tool reply', () => {
  it('unauthorized: a device tool names it and says to accept the debugging prompt', async () => {
    const { call, calls } = await connect(UNAUTHORIZED);
    expect(await call('screenshot', { platform: 'android' })).toEqual({
      isError: true,
      text:
        'No usable Android emulator/device found (adb devices): "R58M123" is unauthorized: adb sees it, but the ' +
        'device has not accepted this computer\'s debugging key. On a phone, unlock it and accept the "Allow USB ' +
        'debugging?" prompt; on an emulator, `adb kill-server`, then `adb devices` to reconnect (restart the ' +
        'emulator if it stays unauthorized).',
    });
    expect(calls).toEqual(['adb devices -l']);
  });

  it('unauthorized: select_device refuses it the same way', async () => {
    const { call } = await connect(UNAUTHORIZED);
    const reply = await call('select_device', { platform: 'android', device: 'R58M123' });
    expect(reply.isError).toBe(true);
    expect(reply.text).toMatch(/^Android device "R58M123" is unauthorized: adb sees it, but /);
  });

  it('unauthorized: list_devices shows the state', async () => {
    const { call } = await connect(UNAUTHORIZED);
    const reply = await call('list_devices', {});
    expect(JSON.parse(reply.text)).toEqual([
      { id: 'R58M123', platform: 'android', name: 'R58M123', osVersion: 'unknown', state: 'unauthorized' },
    ]);
  });

  it('offline: a device tool says present but offline, and to wait or restart adb', async () => {
    const { call } = await connect(OFFLINE);
    expect(await call('ui_snapshot', { platform: 'android' })).toEqual({
      isError: true,
      text:
        'No usable Android emulator/device found (adb devices): "emulator-5554" is offline: adb sees it but cannot ' +
        'talk to it. An emulator still booting reads offline for a while — wait until `adb devices` reads `device`; ' +
        'if it stays offline, `adb kill-server && adb start-server`, then restart the emulator or reconnect the USB ' +
        'cable.',
    });
  });
});
